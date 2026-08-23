const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type JsonMap = Record<string, any>;

interface RetirementModule {
  CACHE_ROOTS: readonly string[];
  canonicalJson(value: unknown): string;
  hashCanonical(value: unknown): string;
  buildPreReceipt(input: {
    root: string;
    repoHead: string;
    suites: readonly JsonMap[];
    generatedSha256: string;
    packSha256: string;
    timestamp: string;
  }): JsonMap;
}

interface MutationAdapter {
  unlink(filePath: string): void;
  rmdir(directoryPath: string): void;
}

interface CleanupModule {
  CacheCleanupError: new (code: string) => Error & { code: string };
  validateProducerReceipt(value: unknown, root: string, currentHead?: string): JsonMap;
  validateAuthorizationReceipt(value: unknown, producer: JsonMap, root: string, currentHead?: string): JsonMap;
  buildCleanupPlan(root: string, producer: JsonMap, currentHead?: string): JsonMap;
  authorizeCleanup(input: { root: string; producer: JsonMap; authorizationPath: string; currentHead?: string }): JsonMap;
  executeCleanupPlan(input: {
    root: string;
    producer: JsonMap;
    authorization: JsonMap;
    cleanupReceiptPath: string;
    currentHead?: string;
    mutationAdapter?: MutationAdapter;
  }): JsonMap;
  verifyCleanupReceipt(value: unknown, producer: JsonMap, authorization: JsonMap, root: string, currentHead?: string): JsonMap;
  main(argv: readonly string[], options?: { root?: string; mutationAdapter?: MutationAdapter }): number;
}

const retirement = require("../../dist/maintainer/retirement-audit.cjs") as RetirementModule;
const cleanup = require("../../dist/maintainer/cache-cleanup.cjs") as CleanupModule;

const CACHE_LAYOUT: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "plugin-src/hooks/__pycache__": ["grep_nudge.cpython-314.pyc", "update_check.cpython-314.pyc"],
  "kcoderag-qa/hooks/__pycache__": ["grep_nudge.cpython-314.pyc", "update_check.cpython-314.pyc"],
  "kcoderag-dev/hooks/__pycache__": ["grep_nudge.cpython-314.pyc", "update_check.cpython-314.pyc"],
  "scripts/__pycache__": [
    "__init__.cpython-314.pyc", "generate_plugins.cpython-314.pyc",
    "manage_cursor_local_install.cpython-314.pyc", "manage_project_install.cpython-314.pyc",
    "run_host_smoke.cpython-314.pyc", "update_plugin.cpython-314.pyc",
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

function fixture(): { root: string; producer: JsonMap } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cache-cleanup-"));
  run(root, "git", ["init", "-q"]);
  run(root, "git", ["config", "user.email", "test@example.invalid"]);
  run(root, "git", ["config", "user.name", "Cleanup Test"]);
  write(root, "src/runtime.cts", "export const runtime = true;\n");
  run(root, "git", ["add", "--", "src/runtime.cts"]);
  run(root, "git", ["commit", "-qm", "baseline"]);
  for (const [cacheRoot, names] of Object.entries(CACHE_LAYOUT)) {
    for (const [index, name] of names.entries()) write(root, `${cacheRoot}/${name}`, `cache-${cacheRoot}-${index}`);
    write(root, `${cacheRoot}/../adjacent.txt`, `adjacent-${cacheRoot}\n`);
  }
  const producer = retirement.buildPreReceipt({
    root,
    repoHead: run(root, "git", ["rev-parse", "HEAD"]),
    suites: [
      { name: "node", status: "PASS", selected: 127, sha256: "1".repeat(64) },
      { name: "python-legacy", status: "PASS", selected: 55, sha256: "2".repeat(64) },
    ],
    generatedSha256: "3".repeat(64),
    packSha256: "4".repeat(64),
    timestamp: "2026-08-24T00:00:00.000Z",
  });
  return { root, producer };
}

function treeManifest(root: string): string {
  const records: JsonMap[] = [];
  const visit = (absolute: string, relative: string): void => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (relative === "" && entry.name === ".git") continue;
      const nextRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const nextAbsolute = path.join(absolute, entry.name);
      const stat = fs.lstatSync(nextAbsolute);
      if (stat.isSymbolicLink()) records.push({ path: nextRelative, type: "symlink", hash: crypto.createHash("sha256").update(fs.readlinkSync(nextAbsolute)).digest("hex") });
      else if (stat.isDirectory()) {
        records.push({ path: nextRelative, type: "directory" });
        visit(nextAbsolute, nextRelative);
      } else records.push({ path: nextRelative, type: "file", hash: crypto.createHash("sha256").update(fs.readFileSync(nextAbsolute)).digest("hex") });
    }
  };
  visit(root, "");
  return retirement.canonicalJson(records);
}

function mutateAndRehash(value: JsonMap, mutate: (copy: JsonMap) => void): JsonMap {
  const copy = structuredClone(value) as JsonMap;
  mutate(copy);
  const withoutSelf = Object.fromEntries(Object.entries(copy).filter(([key]) => key !== "receipt_sha256"));
  copy.receipt_sha256 = retirement.hashCanonical(withoutSelf);
  return copy;
}

function expectCode(call: () => unknown, code: string): void {
  assert.throws(call, (error: unknown) =>
    error instanceof Error && "code" in error && (error as Error & { code: string }).code === code);
}

test("builds an explicit mutation-free 26-unlink and five-rmdir plan", () => {
  const { root, producer } = fixture();
  const before = treeManifest(root);
  const plan = cleanup.buildCleanupPlan(root, producer);
  assert.equal(plan.unlinkTargets.length, 26);
  assert.equal(plan.rmdirTargets.length, 5);
  assert.equal(new Set(plan.unlinkTargets.map((item: JsonMap) => item.relativePath)).size, 26);
  assert.deepEqual([...plan.rmdirTargets].sort(), [...retirement.CACHE_ROOTS].sort());
  assert.equal(treeManifest(root), before);
});

test("producer and authorization reject exact malformed matrix before mutation or receipt", () => {
  const cases: Array<[code: string, mutate: (value: JsonMap) => void]> = [
    ["invalid_producer_receipt", (value) => { delete value.suites; }],
    ["invalid_producer_receipt", (value) => { value.extra = true; }],
    ["invalid_producer_receipt", (value) => { value.receipt_sha256 = "0".repeat(64); }],
    ["invalid_producer_receipt", (value) => { value.authorized_set_sha256 = "0".repeat(64); }],
    ["invalid_producer_receipt", (value) => { value.pre_cache_inventory.files = []; }],
    ["invalid_producer_receipt", (value) => { value.pre_cache_inventory.files.reverse(); }],
    ["invalid_producer_receipt", (value) => { value.pre_cache_inventory.files[1] = value.pre_cache_inventory.files[0]; }],
    ["invalid_producer_receipt", (value) => { value.pre_cache_inventory.root_counts.scripts__pycache__ = 6; }],
    ["invalid_producer_receipt", (value) => { value.pre_cache_inventory.files[0].path = "../escape.pyc"; }],
    ["invalid_producer_receipt", (value) => { value.unrelated_status_before = undefined; }],
  ];
  for (const [code, mutate] of cases) {
    const { root, producer } = fixture();
    const target = path.join(root, ".planning", "authorization.json");
    const before = treeManifest(root);
    const malformed = structuredClone(producer) as JsonMap;
    mutate(malformed);
    expectCode(() => cleanup.authorizeCleanup({ root, producer: malformed, authorizationPath: target }), code);
    assert.equal(treeManifest(root), before);
    assert.equal(fs.existsSync(target), false);
  }
});

test("disk mismatch, extra entry, child directory, symlink, partial state, and production drift are zero-mutation refusals", () => {
  const mutations: Array<(root: string, producer: JsonMap) => void> = [
    (root, producer) => fs.writeFileSync(path.join(root, ...producer.pre_cache_inventory.files[0].path.split("/")), "changed"),
    (root) => write(root, "scripts/__pycache__/extra.pyc", "extra"),
    (root) => fs.mkdirSync(path.join(root, "scripts", "__pycache__", "child")),
    (root) => fs.rmSync(path.join(root, "plugin-src", "hooks", "__pycache__"), { recursive: true }),
    (root) => {
      const target = path.join(root, "scripts", "__pycache__", "update_plugin.cpython-314.pyc");
      fs.rmSync(target);
      try { fs.symlinkSync(path.join(root, "src", "runtime.cts"), target, "file"); } catch { write(root, "scripts/__pycache__/extra.pyo", "fallback"); }
    },
    (root) => {
      write(root, "src/runtime.cts", "export const runtime = false;\n");
      run(root, "git", ["add", "--", "src/runtime.cts"]);
      run(root, "git", ["commit", "-qm", "production drift"]);
    },
  ];
  for (const mutate of mutations) {
    const { root, producer } = fixture();
    mutate(root, producer);
    const before = treeManifest(root);
    const target = path.join(root, ".planning", "authorization.json");
    expectCode(() => cleanup.authorizeCleanup({ root, producer, authorizationPath: target }), "invalid_producer_receipt");
    assert.equal(treeManifest(root), before);
    assert.equal(fs.existsSync(target), false);
  }
});

test("authorization links exact producer fields and rejects unknown, mismatched, or non-ancestor evidence", () => {
  const { root, producer } = fixture();
  const target = path.join(root, ".planning", "authorization.json");
  const authorization = cleanup.authorizeCleanup({ root, producer, authorizationPath: target });
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), authorization);
  assert.doesNotThrow(() => cleanup.validateAuthorizationReceipt(authorization, producer, root));

  for (const malformed of [
    mutateAndRehash(authorization, (value) => { value.extra = true; }),
    mutateAndRehash(authorization, (value) => { value.authorized_set_sha256 = "0".repeat(64); }),
    mutateAndRehash(authorization, (value) => { value.pre_cache_inventory.files[0].sha256 = "0".repeat(64); }),
    mutateAndRehash(authorization, (value) => { value.plan15_receipt_sha256 = "0".repeat(64); }),
  ]) expectCode(() => cleanup.validateAuthorizationReceipt(malformed, producer, root), "invalid_authorization_receipt");

  run(root, "git", ["checkout", "--orphan", "unrelated"]);
  run(root, "git", ["rm", "-qrf", "--", "."]);
  write(root, ".planning/unrelated.md", "unrelated\n");
  run(root, "git", ["add", "--", ".planning/unrelated.md"]);
  run(root, "git", ["commit", "-qm", "unrelated"]);
  expectCode(() => cleanup.validateAuthorizationReceipt(authorization, producer, root), "invalid_producer_receipt");
});

test("successful execution performs exactly 26 unlinks then five nonrecursive rmdirs and writes sanitized evidence", () => {
  const { root, producer } = fixture();
  const authorizationPath = path.join(root, ".planning", "authorization.json");
  const cleanupPath = path.join(root, ".planning", "cleanup.json");
  const authorization = cleanup.authorizeCleanup({ root, producer, authorizationPath });
  const calls: Array<{ kind: string; path: string }> = [];
  const adapter: MutationAdapter = {
    unlink(filePath) { calls.push({ kind: "unlink", path: filePath }); fs.unlinkSync(filePath); },
    rmdir(directoryPath) { calls.push({ kind: "rmdir", path: directoryPath }); fs.rmdirSync(directoryPath); },
  };
  const receipt = cleanup.executeCleanupPlan({
    root,
    producer,
    authorization,
    cleanupReceiptPath: cleanupPath,
    mutationAdapter: adapter,
  });
  assert.equal(calls.filter((call) => call.kind === "unlink").length, 26);
  assert.equal(calls.filter((call) => call.kind === "rmdir").length, 5);
  assert.ok(calls.slice(0, 26).every((call) => call.kind === "unlink"));
  assert.ok(calls.slice(26).every((call) => call.kind === "rmdir"));
  assert.equal(receipt.deletion_set_equal, true);
  assert.equal(receipt.observed_deletions.length, 26);
  assert.equal(receipt.removed_roots.length, 5);
  assert.doesNotThrow(() => cleanup.verifyCleanupReceipt(receipt, producer, authorization, root));
  for (const cacheRoot of retirement.CACHE_ROOTS) assert.equal(fs.existsSync(path.join(root, ...cacheRoot.split("/"))), false);
  assert.doesNotMatch(fs.readFileSync(cleanupPath, "utf8"), /cache-plugin-src|adjacent-plugin-src/u);
});

test("every execute preflight refusal records zero unlink/rmdir calls and no success receipt", () => {
  for (const mutate of [
    (authorization: JsonMap) => { authorization.receipt_sha256 = "0".repeat(64); },
    (authorization: JsonMap) => { authorization.pre_cache_inventory.total = 24; },
    (_authorization: JsonMap, root: string) => fs.writeFileSync(path.join(root, "tests", "__pycache__", "test_00.cpython-314.pyc"), "drift"),
  ]) {
    const { root, producer } = fixture();
    const authorizationPath = path.join(root, ".planning", "authorization.json");
    const cleanupPath = path.join(root, ".planning", "cleanup.json");
    const persistedAuthorization = cleanup.authorizeCleanup({ root, producer, authorizationPath });
    const authorization = structuredClone(persistedAuthorization) as JsonMap;
    mutate(authorization, root);
    const before = treeManifest(root);
    let unlinkCount = 0;
    let rmdirCount = 0;
    expectCode(() => cleanup.executeCleanupPlan({
      root,
      producer,
      authorization,
      cleanupReceiptPath: cleanupPath,
      mutationAdapter: {
        unlink(filePath) { unlinkCount += 1; fs.unlinkSync(filePath); },
        rmdir(directoryPath) { rmdirCount += 1; fs.rmdirSync(directoryPath); },
      },
    }), "cleanup_preflight_failed");
    assert.equal(unlinkCount, 0);
    assert.equal(rmdirCount, 0);
    assert.equal(fs.existsSync(cleanupPath), false);
    assert.equal(treeManifest(root), before);
  }
});

test("compiled CLI authorize, execute, and verify share the same implementation", () => {
  const { root, producer } = fixture();
  const producerPath = path.join(root, ".planning", "producer.json");
  const authorizationPath = path.join(root, ".planning", "authorization.json");
  const cleanupPath = path.join(root, ".planning", "cleanup.json");
  fs.mkdirSync(path.dirname(producerPath), { recursive: true });
  fs.writeFileSync(producerPath, retirement.canonicalJson(producer));
  assert.equal(cleanup.main(["authorize", "--producer", producerPath, "--authorization", authorizationPath], { root }), 0);
  assert.equal(cleanup.main(["execute", "--producer", producerPath, "--authorization", authorizationPath,
    "--cleanup-receipt", cleanupPath], { root }), 0);
  assert.equal(cleanup.main(["verify", "--producer", producerPath, "--authorization", authorizationPath,
    "--cleanup-receipt", cleanupPath], { root }), 0);
});
