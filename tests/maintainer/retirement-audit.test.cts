const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type JsonMap = Record<string, any>;

interface RetirementModule {
  RetirementAuditError: new (code: string) => Error & { code: string };
  CACHE_ROOT_COUNTS: Readonly<Record<string, number>>;
  canonicalJson(value: unknown): string;
  compareCodePointPaths(left: string, right: string): number;
  validateSortedUniquePaths(paths: readonly string[]): readonly string[];
  hashCanonical(value: unknown): string;
  buildTrackedProductionInventory(root: string, commit: string): readonly JsonMap[];
  hashTrackedProductionInventory(inventory: readonly JsonMap[]): string;
  verifyProductionBaseline(receipt: JsonMap, currentHead: string, root: string): void;
  collectPreCacheInventory(root: string): JsonMap;
  collectUnrelatedStatus(root: string): JsonMap;
  collectRootExternalDigests(root: string): readonly JsonMap[];
  buildPreReceipt(input: {
    root: string;
    repoHead: string;
    suites: readonly JsonMap[];
    generatedSha256: string;
    packSha256: string;
    timestamp: string;
  }): JsonMap;
  verifyPreReceipt(receipt: unknown, root: string, currentHead?: string): JsonMap;
  auditRetirement(root: string, mode: string): JsonMap;
}

const retirement = require("../../dist/maintainer/retirement-audit.cjs") as RetirementModule;
const repositoryRoot = path.resolve(__dirname, "../..");

const CACHE_LAYOUT: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "plugin-src/hooks/__pycache__": ["grep_nudge.cpython-314.pyc", "update_check.cpython-314.pyc"],
  "kcoderag-qa/hooks/__pycache__": ["grep_nudge.cpython-314.pyc", "update_check.cpython-314.pyc"],
  "kcoderag-dev/hooks/__pycache__": ["grep_nudge.cpython-314.pyc", "update_check.cpython-314.pyc"],
  "scripts/__pycache__": [
    "__init__.cpython-314.pyc",
    "generate_plugins.cpython-314.pyc",
    "manage_cursor_local_install.cpython-314.pyc",
    "manage_project_install.cpython-314.pyc",
    "run_host_smoke.cpython-314.pyc",
    "update_plugin.cpython-314.pyc",
  ],
  "tests/__pycache__": Array.from({ length: 14 }, (_, index) => `test_${String(index).padStart(2, "0")}.cpython-314.pyc`),
});

function run(root: string, command: string, args: readonly string[]): string {
  return childProcess.execFileSync(command, [...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(root: string, relativePath: string, bytes: string | Buffer): void {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function initRepository(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-retirement-"));
  run(root, "git", ["init", "-q"]);
  run(root, "git", ["config", "user.email", "test@example.invalid"]);
  run(root, "git", ["config", "user.name", "Retirement Test"]);
  write(root, "src/runtime.cts", "export const runtime = true;\n");
  write(root, ".planning/state.md", "planning\n");
  run(root, "git", ["add", "--", "src/runtime.cts", ".planning/state.md"]);
  run(root, "git", ["commit", "-qm", "baseline"]);
  return root;
}

function createCaches(root: string): void {
  for (const [cacheRoot, names] of Object.entries(CACHE_LAYOUT)) {
    for (const [index, name] of names.entries()) {
      write(root, `${cacheRoot}/${name}`, Buffer.from(`pyc-${cacheRoot}-${index}`, "utf8"));
    }
    write(root, `${cacheRoot}/../adjacent.txt`, `adjacent-${cacheRoot}\n`);
  }
}

function validSuites(): readonly JsonMap[] {
  return Object.freeze([
    Object.freeze({ name: "node", status: "PASS", selected: 127, sha256: "1".repeat(64) }),
    Object.freeze({ name: "python-legacy", status: "PASS", selected: 55, sha256: "2".repeat(64) }),
  ]);
}

function validReceipt(root: string): JsonMap {
  const repoHead = run(root, "git", ["rev-parse", "HEAD"]);
  return retirement.buildPreReceipt({
    root,
    repoHead,
    suites: validSuites(),
    generatedSha256: "3".repeat(64),
    packSha256: "4".repeat(64),
    timestamp: "2026-08-24T00:00:00.000Z",
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function expectCode(call: () => unknown, code: string): void {
  assert.throws(call, (error: unknown) =>
    error instanceof Error && "code" in error && (error as Error & { code: string }).code === code);
}

test("canonical JSON and path ordering use Unicode scalar values and reject ambiguous values", () => {
  const astral = "\u{10000}";
  const bmp = "\uE000";
  assert.ok(retirement.compareCodePointPaths(bmp, astral) < 0);
  assert.equal(retirement.canonicalJson({ z: 1, [astral]: 2, [bmp]: 3, a: { y: 2, x: 1 } }),
    `{"a":{"x":1,"y":2},"z":1,"${bmp}":3,"${astral}":2}`);
  assert.deepEqual(retirement.validateSortedUniquePaths(["a/file.pyc", "b/file.pyc"]), ["a/file.pyc", "b/file.pyc"]);

  for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date(), new Map()]) {
    expectCode(() => retirement.canonicalJson(value), "non_canonical_value");
  }
  const sparse = [1, 2];
  delete sparse[0];
  expectCode(() => retirement.canonicalJson(sparse), "non_canonical_value");
  for (const paths of [
    ["b/file.pyc", "a/file.pyc"],
    ["a/file.pyc", "a/file.pyc"],
    ["a/file.pyc", "A/file.pyc"],
    ["../escape.pyc"],
    ["/absolute.pyc"],
    ["a\\file.pyc"],
    ["a/./file.pyc"],
  ]) expectCode(() => retirement.validateSortedUniquePaths(paths), "invalid_path_list");
});

test("tracked production inventory is canonical and planning-only descendants preserve the baseline", () => {
  const root = initRepository();
  createCaches(root);
  const receipt = validReceipt(root);
  const baseline = receipt.repo_head as string;
  assert.equal(receipt.tracked_production_inventory_sha256,
    retirement.hashTrackedProductionInventory(receipt.tracked_production_inventory));
  assert.deepEqual(receipt.tracked_production_inventory,
    retirement.buildTrackedProductionInventory(root, baseline));

  write(root, ".planning/descendant.md", "allowed\n");
  run(root, "git", ["add", "--", ".planning/descendant.md"]);
  run(root, "git", ["commit", "-qm", "planning descendant"]);
  const descendant = run(root, "git", ["rev-parse", "HEAD"]);
  assert.doesNotThrow(() => retirement.verifyProductionBaseline(receipt, descendant, root));
  assert.doesNotThrow(() => retirement.verifyPreReceipt(receipt, root, descendant));

  write(root, "src/runtime.cts", "export const runtime = false;\n");
  run(root, "git", ["add", "--", "src/runtime.cts"]);
  run(root, "git", ["commit", "-qm", "production drift"]);
  expectCode(() => retirement.verifyProductionBaseline(receipt, run(root, "git", ["rev-parse", "HEAD"]), root),
    "production_baseline_drift");

  run(root, "git", ["checkout", "--orphan", "unrelated"]);
  run(root, "git", ["rm", "-qrf", "--", "."]);
  write(root, ".planning/unrelated.md", "unrelated\n");
  run(root, "git", ["add", "--", ".planning/unrelated.md"]);
  run(root, "git", ["commit", "-qm", "unrelated"]);
  expectCode(() => retirement.verifyProductionBaseline(receipt, run(root, "git", ["rev-parse", "HEAD"]), root),
    "production_baseline_not_ancestor");
});

test("pre receipt exact schema, hashes, cache inventory, status, and external evidence fail closed", () => {
  const root = initRepository();
  createCaches(root);
  const receipt = validReceipt(root);
  assert.equal(receipt.pre_cache_inventory.total, 26);
  assert.deepEqual(receipt.pre_cache_inventory.root_counts, retirement.CACHE_ROOT_COUNTS);
  assert.equal(receipt.pre_cache_inventory.files.length, 26);
  assert.doesNotThrow(() => retirement.verifyPreReceipt(receipt, root));

  const mutations: Array<[string, (value: JsonMap) => void]> = [
    ["invalid_receipt_schema", (value) => { value.extra = true; }],
    ["invalid_receipt_schema", (value) => { delete value.suites; }],
    ["invalid_receipt_hash", (value) => { value.receipt_sha256 = "0".repeat(64); }],
    ["invalid_authorized_set_hash", (value) => { value.authorized_set_sha256 = "0".repeat(64); }],
    ["invalid_production_inventory_hash", (value) => { value.tracked_production_inventory_sha256 = "0".repeat(64); }],
    ["invalid_suite", (value) => { value.suites[0].status = "NOT_RUN"; }],
    ["invalid_suite", (value) => { value.suites[0].selected = 0; }],
    ["invalid_cache_inventory", (value) => { value.pre_cache_inventory.total = 24; }],
    ["invalid_path_list", (value) => { value.pre_cache_inventory.files.reverse(); }],
    ["unrelated_status_changed", (value) => { value.unrelated_status_before.sha256 = "0".repeat(64); }],
    ["root_external_changed", (value) => { value.root_external_digests_before[0].sha256 = "0".repeat(64); }],
  ];
  for (const [code, mutate] of mutations) {
    const value = clone(receipt);
    mutate(value);
    if (code !== "invalid_receipt_hash" && code !== "invalid_receipt_schema") {
      const withoutSelf = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "receipt_sha256"));
      value.receipt_sha256 = retirement.hashCanonical(withoutSelf);
    }
    expectCode(() => retirement.verifyPreReceipt(value, root), code);
  }

  const file = receipt.pre_cache_inventory.files[0].path as string;
  fs.writeFileSync(path.join(root, ...file.split("/")), "changed");
  expectCode(() => retirement.verifyPreReceipt(receipt, root), "cache_inventory_changed");
});

test("pre receipt accepts only exact cache inventory or all five roots absent", () => {
  const root = initRepository();
  createCaches(root);
  const receipt = validReceipt(root);
  for (const cacheRoot of Object.keys(CACHE_LAYOUT)) fs.rmSync(path.join(root, ...cacheRoot.split("/")), { recursive: true });
  assert.doesNotThrow(() => retirement.verifyPreReceipt(receipt, root));

  createCaches(root);
  fs.rmSync(path.join(root, ...Object.keys(CACHE_LAYOUT)[0]!.split("/")), { recursive: true });
  expectCode(() => retirement.verifyPreReceipt(receipt, root), "partial_cache_state");
});

test("retirement modes advance monotonically across the exact legacy inventories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-retirement-modes-"));
  const sourcePaths = [
    "plugin-src/version.txt", "plugin-src/hooks/grep_nudge.py", "plugin-src/hooks/update_check.py",
    "plugin-src/hooks/test_grep_nudge.py", "kcoderag-qa/hooks/grep_nudge.py",
    "kcoderag-qa/hooks/update_check.py", "kcoderag-qa/hooks/test_grep_nudge.py",
    "kcoderag-dev/hooks/grep_nudge.py", "kcoderag-dev/hooks/update_check.py",
    "kcoderag-dev/hooks/test_grep_nudge.py", "kcoderag-update.json",
  ];
  const scriptPaths = [
    "scripts/manage_project_install.py", "scripts/manage_cursor_local_install.py", "scripts/generate_plugins.py",
    "scripts/update_plugin.py", "scripts/pre_commit_generate.py", "scripts/run_host_smoke.py", "scripts/__init__.py",
  ];
  const testPaths = [
    "tests/test_project_install.py", "tests/test_cursor_local_install.py", "tests/test_generation.py",
    "tests/test_hook_runtime.py", "tests/test_update_check.py", "tests/test_routing_and_hooks.py",
    "tests/test_host_smoke.py", "tests/test_pre_commit_generate.py", "tests/test_plugin_update.py",
    "tests/stub_mcp_server.py", "tests/__init__.py",
  ];
  for (const file of [...sourcePaths, ...scriptPaths, ...testPaths]) write(root, file, "legacy\n");
  assert.equal(retirement.auditRetirement(root, "pre").mode, "pre");
  for (const file of sourcePaths) fs.unlinkSync(path.join(root, ...file.split("/")));
  assert.equal(retirement.auditRetirement(root, "post-source").mode, "post-source");
  expectCode(() => retirement.auditRetirement(root, "pre"), "retirement_mode_mismatch");
  for (const file of scriptPaths) fs.unlinkSync(path.join(root, ...file.split("/")));
  assert.equal(retirement.auditRetirement(root, "post-scripts").mode, "post-scripts");
  for (const file of testPaths) fs.unlinkSync(path.join(root, ...file.split("/")));
  assert.equal(retirement.auditRetirement(root, "post-tests").mode, "post-tests");
});

test("post retirement rejects every active retired authority, product, workflow, and runtime class", () => {
  const fixtures = [
    {
      relativePath: "src/core/legacy-decoder.cts",
      bytes: "export function parseLegacyInstallState() { return {}; }\n",
      code: "legacy_authority_remains",
    },
    {
      relativePath: "src/cli/migrate.cts",
      bytes: "export const allowLegacyDevMigration = true;\n",
      code: "legacy_authority_remains",
    },
    {
      relativePath: "src/core/source-finding-cleanup-eligible.cts",
      bytes: "export interface SourceFinding { readonly cleanupEligible?: boolean; }\n",
      code: "cleanup_authority_remains",
    },
    {
      relativePath: "src/core/source-finding-cleanup-command.cts",
      bytes: "export interface SourceFinding { readonly cleanupCommand?: string; }\n",
      code: "cleanup_authority_remains",
    },
    {
      relativePath: "src/core/source-finding-cleanup-fingerprint.cts",
      bytes: "export interface SourceFinding { readonly cleanupFingerprint?: string; }\n",
      code: "cleanup_authority_remains",
    },
    {
      relativePath: "src/hosts/source-scan-result.cts",
      bytes: "export interface SourceScanResult { readonly cleanupPlans: readonly unknown[]; }\n",
      code: "cleanup_authority_remains",
    },
    {
      relativePath: "src/hosts/native-cleanup-plan.cts",
      bytes: "export interface NativeCleanupPlan { readonly safePath: string; }\n",
      code: "cleanup_authority_remains",
    },
    {
      relativePath: "src/hosts/owned-cleanup-authority.cts",
      bytes: "export interface OwnedCleanupAuthority { readonly allowOwnedSourceCleanup: boolean; }\n",
      code: "cleanup_authority_remains",
    },
    {
      relativePath: "src/hosts/legacy-observation-environment.cts",
      bytes: "export interface HostObservation { readonly legacyEnvironment?: 'dev'; }\n",
      code: "legacy_authority_remains",
    },
    {
      relativePath: "src/hosts/legacy-observation-user-removal.cts",
      bytes: "export interface HostObservation { readonly legacyUserRemoval?: { readonly path: string }; }\n",
      code: "legacy_authority_remains",
    },
    {
      relativePath: "src/hosts/legacy-install-context.cts",
      bytes: "export interface HostInstallContext { readonly allowLegacyUserRemoval: boolean; }\n",
      code: "legacy_authority_remains",
    },
    {
      relativePath: "src/cli/false-dev-authority.cts",
      bytes: "export const context = { allowLegacyDevMigration: false };\n",
      code: "legacy_authority_remains",
    },
    {
      relativePath: "src/cli/false-user-authority.cts",
      bytes: "export const context = { allowLegacyUserRemoval: false };\n",
      code: "legacy_authority_remains",
    },
    {
      relativePath: "package.json",
      bytes: '{"scripts":{"test:migration":"node --test dist-tests/migration/legacy-state.test.cjs"}}\n',
      code: "legacy_authority_remains",
    },
    {
      relativePath: "src/hosts/codex.cts",
      bytes: "export async function cleanupOwnedSource() { return undefined; }\n",
      code: "cleanup_authority_remains",
    },
    {
      relativePath: "src/hosts/optional-cleanup-callback.cts",
      bytes: "export interface HostAdapter { cleanupOwnedSource?(plan: unknown): Promise<unknown>; }\n",
      code: "cleanup_authority_remains",
    },
    {
      relativePath: "src/hosts/cleanup-runner.cts",
      bytes: "export function runOwnedSourceCleanup() { return undefined; }\n",
      code: "cleanup_authority_remains",
    },
    {
      relativePath: "kcoderag-dev/README.md",
      bytes: "retired product\n",
      code: "retired_product_remains",
    },
    {
      relativePath: "scripts/legacy.py",
      bytes: "print('legacy')\n",
      code: "python_runtime_remains",
    },
    {
      relativePath: `scripts/run-${String.fromCodePoint(0x6a, 0x78, 0x33)}-scanner.cjs`,
      bytes: "module.exports = {};\n",
      code: "retired_workflow_remains",
    },
    {
      relativePath: "scripts/svn-review.cjs",
      bytes: "module.exports = {};\n",
      code: "retired_workflow_remains",
    },
    {
      relativePath: "plugin-src/hooks/runtime.cts",
      bytes: "export const runtime = true;\n",
      code: "runtime_source_remains",
    },
    {
      relativePath: ".claude-plugin/marketplace.json",
      bytes: "{}\n",
      code: "root_marketplace_remains",
    },
    {
      relativePath: "README.md",
      bytes: "Run npx kcoderag-nav@latest update --allow-legacy-dev-migration.\n",
      code: "retired_instruction_remains",
    },
  ] as const;

  for (const item of fixtures) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-retirement-active-"));
    write(root, item.relativePath, item.bytes);
    expectCode(() => retirement.auditRetirement(root, "post"), item.code);
  }
});

test("post retirement permits negative contracts and explicitly historical document regions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-retirement-history-"));
  write(root, "src/core/state.cts", [
    "export const currentState = true;",
    "// Legacy state and owned cleanup authority are rejected.",
    "export const conflictCode = 'manual_cleanup_required';",
    "export const retiredFlags = '--allow-legacy-user-removal --allow-legacy-dev-migration';",
    "",
  ].join("\n"));
  write(root, "fixtures/host-delivery/frozen-legacy-labels.json", JSON.stringify({
    cleanupEligible: true,
    cleanupCommand: "historical receipt label",
    allowLegacyDevMigration: false,
  }));
  write(root, "tests/current-only-negative.test.cts", [
    "assert.equal('cleanupOwnedSource' in adapter, false);",
    "assert.equal('cleanupPlans' in scan, false);",
    "",
  ].join("\n"));
  write(root, "README.md", [
    "# Current product",
    "Use the capability-aware project installer.",
    "",
    "## Historical migration record",
    "The retired command was npx kcoderag-nav@latest update --allow-legacy-dev-migration.",
    "",
  ].join("\n"));
  write(root, ".planning/history/legacy.md", [
    "python scripts/manage_project_install.py install",
    "svn status",
    "kcoderag-dev",
    "",
  ].join("\n"));

  assert.doesNotThrow(() => retirement.auditRetirement(root, "post"));
});

test("receipt evidence contains hashes and safe paths, never cache bytes", () => {
  const root = initRepository();
  createCaches(root);
  const receipt = validReceipt(root);
  const serialized = retirement.canonicalJson(receipt);
  assert.equal(crypto.createHash("sha256").update(retirement.canonicalJson(receipt.pre_cache_inventory)).digest("hex"),
    receipt.authorized_set_sha256);
  assert.doesNotMatch(serialized, /pyc-plugin-src|adjacent-plugin-src/u);
  assert.match(serialized, /plugin-src\/hooks\/__pycache__/u);
});

test("historical Python suite labels and cache identifiers remain valid receipt data", () => {
  const root = initRepository();
  createCaches(root);
  const receipt = validReceipt(root);

  assert.deepEqual(receipt.suites.map((suite: JsonMap) => suite.name), ["node", "python-legacy"]);
  assert.ok(receipt.pre_cache_inventory.files.every((file: JsonMap) => file.path.endsWith(".pyc")));
  assert.doesNotThrow(() => retirement.verifyPreReceipt(receipt, root));
});

test("compiled CLI retires the parity route while keeping the post-retirement audit executable", () => {
  const executable = path.join(repositoryRoot, "dist", "maintainer", "retirement-audit.cjs");
  const retired = childProcess.spawnSync(process.execPath, [
    executable,
    "--run-parity",
    "--mode",
    "pre",
    "--receipt",
    ".planning/phases/03.1-javascript-npx/obsolete.json",
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(retired.status, 1);
  assert.deepEqual(JSON.parse(retired.stderr), { ok: false, code: "invalid_arguments" });

  const post = childProcess.spawnSync(process.execPath, [executable, "--mode", "post"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(post.status, 0);
  assert.deepEqual(JSON.parse(post.stdout), {
    ok: true,
    schema_version: "kcoderag-nav/retirement-audit@1",
    mode: "post",
    source_remaining: 0,
    scripts_remaining: 0,
    tests_remaining: 0,
  });

  const defaultPost = childProcess.spawnSync(process.execPath, [executable], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(defaultPost.status, 0);
  assert.deepEqual(JSON.parse(defaultPost.stdout), JSON.parse(post.stdout));
});
