const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

interface TarArchiveModule {
  readTarArchive(bytes: Buffer): readonly unknown[];
}

type JsonMap = Record<string, any>;

interface PackAuditModule {
  PackAuditError: new (code: string) => Error & { code: string };
  expandPackageFiles(root: string, packageJson: JsonMap): readonly string[];
  validatePack(input: {
    readonly packageJson: JsonMap;
    readonly expectedPaths: readonly string[];
    readonly archiveEntries: ReadonlyMap<string, Buffer>;
  }): { readonly version: string; readonly entryCount: number };
  auditPackArtifact(
    lease: CandidatePackageArtifactLease,
    options: { readonly root: string },
  ): {
    readonly version: string;
    readonly entryCount: number;
    readonly artifactSha256: string;
    readonly memberCount: number;
    readonly statusPreserved: boolean;
    readonly treePreserved: boolean;
  };
  auditPack(options: { readonly root: string }, dependencies?: {
    readonly scanTarball?: (options: { readonly bytes: Buffer; readonly expectedSha256: string }) => {
      readonly schemaVersion: 1;
      readonly scope: "tar";
      readonly artifactSha256: string;
      readonly memberCount: number;
      readonly scannedCount: number;
      readonly findingCount: number;
      readonly findings: readonly unknown[];
    };
  }): {
    readonly version: string;
    readonly entryCount: number;
    readonly statusPreserved: boolean;
    readonly treePreserved: boolean;
  };
}

interface CandidatePackageArtifactLease {
  readonly artifact: {
    readonly sha256: string;
    readonly memberCount: number;
    readonly dryRunCount: 1;
    readonly actualPackCount: 1;
  };
  dispose(): void;
}

interface ReleaseReadinessModule {
  createCandidatePackageArtifact(options: {
    readonly root: string;
    readonly consumers: readonly ["pack-audit"];
  }): CandidatePackageArtifactLease;
}

const packAudit = require("../../dist/maintainer/pack-audit.cjs") as PackAuditModule;
const releaseReadiness = require("../../dist/maintainer/release-readiness.cjs") as ReleaseReadinessModule;
const tarArchive = require("../../dist/maintainer/tar-archive.cjs") as TarArchiveModule;
const repositoryRoot = path.resolve(__dirname, "../..");
const RETIREMENT_AUDITOR_PATH = "dist/maintainer/retirement-audit.cjs";
const PRE_RELEASE_EVIDENCE_PATH = "dist/maintainer/pre-release-evidence.cjs";
const HEAD_ACCEPTANCE_PATH = "dist/maintainer/head-acceptance.cjs";
const SCRUB_BASELINE_PATH = "dist/maintainer/scrub-baseline.cjs";
const HOST_DELIVERY_FIXTURE_PATH = "dist/fixtures/host-delivery.cjs";
const HOST_VERSION_SUPPORT_PATH = "dist/hosts/host-version-support.cjs";
const MUTATION_LOCK_PATH = "dist/core/mutation-lock.cjs";
const CAPABILITY_REGISTRY_PATH = "dist/capabilities/registry.cjs";
const DISPATCHER_PATH = "dist/hooks/pre-tool-dispatcher.cjs";
const FEEDBACK_NUDGE_PATH = "dist/hooks/feedback-nudge.cjs";
const ACCEPTANCE_RECEIPT_PATH = "dist/smoke/acceptance-receipt.cjs";
const HOST_SMOKE_PATH = "dist/smoke/host-smoke.cjs";
const LIVE_COORDINATOR_PATH = "dist/smoke/live-host-coordinator.cjs";
const CODE_STYLE_RUNTIME_PATHS = Object.freeze([
  "dist/hooks/code-style-nudge.cjs",
  "dist/hooks/once-marker.cjs",
  "dist/hooks/session-cleanup.cjs",
]);
const CODE_STYLE_SKILL_PATHS = Object.freeze([
  "plugin-src/capabilities/code-style-nudge/skill/SKILL.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/change-hygiene-self-review.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/cpp-lifetime-control-flow.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/lua-contracts.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/protocol-serialization-data.md",
]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function packageJson(): JsonMap {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
}

function baseline(input = packageJson()): {
  packageJson: JsonMap;
  expectedPaths: readonly string[];
  archiveEntries: Map<string, Buffer>;
} {
  const expectedPaths = packAudit.expandPackageFiles(repositoryRoot, input);
  const archiveEntries = new Map(
    expectedPaths.map((relativePath) => [relativePath, Buffer.from(`asset:${relativePath}\n`)]),
  );
  archiveEntries.set("package.json", Buffer.from(`${JSON.stringify(input)}\n`));
  for (const manifest of [
    "kcoderag-qa/.codex-plugin/plugin.json",
    "kcoderag-qa/.claude-plugin/plugin.json",
    "kcoderag-cursor/.cursor-plugin/plugin.json",
  ]) {
    archiveEntries.set(manifest, Buffer.from(`${JSON.stringify({ version: input.version })}\n`));
  }
  return { packageJson: input, expectedPaths, archiveEntries };
}

function expectCode(run: () => unknown, code: string): void {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as Error & { code: string }).code === code,
  );
}

test("audits a real temporary npm tgz and preserves repository status and tree", () => {
  const statusBefore = childProcess.execFileSync("git", ["status", "--short"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  let scanCount = 0;
  const result = packAudit.auditPack({ root: repositoryRoot }, {
    scanTarball: (options) => {
      scanCount += 1;
      const digest = crypto.createHash("sha256").update(options.bytes).digest("hex");
      const memberCount = tarArchive.readTarArchive(options.bytes).length;
      assert.equal(options.expectedSha256, digest);
      return Object.freeze({
        schemaVersion: 1,
        scope: "tar",
        artifactSha256: digest,
        memberCount,
        scannedCount: memberCount,
        findingCount: 0,
        findings: Object.freeze([]),
      });
    },
  });
  const statusAfter = childProcess.execFileSync("git", ["status", "--short"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  assert.equal(result.version, packageJson().version);
  assert.ok(result.entryCount > 25);
  assert.equal(result.statusPreserved, true);
  assert.equal(result.treePreserved, true);
  assert.equal(scanCount, 1);
  assert.equal(statusAfter, statusBefore);
});

test("requires exact archive equality and all self-contained host assets", () => {
  const exact = baseline();
  assert.equal(packAudit.validatePack(exact).entryCount, exact.expectedPaths.length);
  assert.equal(exact.expectedPaths.includes(MUTATION_LOCK_PATH), true);

  const missing = baseline();
  missing.archiveEntries.delete("kcoderag-qa/hooks/grep-nudge.cjs");
  expectCode(() => packAudit.validatePack(missing), "archive_path_drift");

  const missingHost = baseline();
  const reduced = missingHost.expectedPaths.filter(
    (relativePath) => relativePath !== "kcoderag-cursor/rules/kcoderag-navigation.mdc",
  );
  missingHost.packageJson.files = missingHost.packageJson.files.filter(
    (relativePath: string) => relativePath !== "kcoderag-cursor/rules/kcoderag-navigation.mdc",
  );
  missingHost.archiveEntries.delete("kcoderag-cursor/rules/kcoderag-navigation.mdc");
  expectCode(
    () => packAudit.validatePack({ ...missingHost, expectedPaths: reduced }),
    "missing_self_contained_asset",
  );

  const missingLock = baseline();
  const withoutLock = missingLock.expectedPaths.filter((relativePath) => relativePath !== MUTATION_LOCK_PATH);
  missingLock.packageJson.files = missingLock.packageJson.files.filter(
    (relativePath: string) => relativePath !== MUTATION_LOCK_PATH,
  );
  missingLock.archiveEntries.delete(MUTATION_LOCK_PATH);
  expectCode(
    () => packAudit.validatePack({ ...missingLock, expectedPaths: withoutLock }),
    "missing_self_contained_asset",
  );
});

test("injected artifact is audited without a second pack and preserves its SHA and member count", () => {
  const lease = releaseReadiness.createCandidatePackageArtifact({
    root: repositoryRoot,
    consumers: ["pack-audit"],
  });
  const before = { ...lease.artifact };
  const result = packAudit.auditPackArtifact(lease, { root: repositoryRoot });
  assert.deepEqual(
    {
      artifactSha256: result.artifactSha256,
      memberCount: result.memberCount,
      dryRunCount: before.dryRunCount,
      actualPackCount: before.actualPackCount,
    },
    {
      artifactSha256: before.sha256,
      memberCount: before.memberCount,
      dryRunCount: 1,
      actualPackCount: 1,
    },
  );
  assert.equal(result.version, packageJson().version);
  assert.equal(result.entryCount, before.memberCount);
  assert.equal(result.statusPreserved, true);
  assert.equal(result.treePreserved, true);
});

test("requires the capability registry, dispatcher runtime, and canonical code style Skill tree", () => {
  const exact = baseline();
  for (const required of [
    CAPABILITY_REGISTRY_PATH,
    DISPATCHER_PATH,
    ...CODE_STYLE_RUNTIME_PATHS,
    ...CODE_STYLE_SKILL_PATHS,
  ]) {
    assert.equal(exact.expectedPaths.includes(required), true, required);
  }

  for (const required of CODE_STYLE_SKILL_PATHS) {
    const missing = baseline();
    missing.packageJson.files = missing.packageJson.files.filter((item: string) => item !== required);
    const expectedPaths = missing.expectedPaths.filter((item) => item !== required);
    missing.archiveEntries.delete(required);
    expectCode(
      () => packAudit.validatePack({ ...missing, expectedPaths }),
      "missing_self_contained_asset",
    );
  }
});

test("closes the Phase 05 public receipt runtime and Cursor generated family", () => {
  const exact = baseline();
  for (const required of [
    FEEDBACK_NUDGE_PATH,
    ACCEPTANCE_RECEIPT_PATH,
    HOST_SMOKE_PATH,
    LIVE_COORDINATOR_PATH,
    "kcoderag-cursor/rules/kcoderag-navigation.mdc",
    "kcoderag-cursor/skills/code-lookup-discipline/SKILL.md",
  ]) {
    assert.equal(exact.packageJson.files.includes(required), true, required);
    assert.equal(exact.expectedPaths.includes(required), true, required);
    assert.equal(exact.archiveEntries.has(required), true, required);
  }

  assert.equal(
    fs.readFileSync(path.join(repositoryRoot, "plugin-src/cursor/rules/kcoderag-navigation.mdc"), "utf8"),
    fs.readFileSync(path.join(repositoryRoot, "kcoderag-cursor/rules/kcoderag-navigation.mdc"), "utf8"),
  );
  assert.equal(
    fs.readFileSync(path.join(repositoryRoot, "plugin-src/skills/code-lookup-discipline/SKILL.md"), "utf8"),
    fs.readFileSync(path.join(repositoryRoot, "kcoderag-cursor/skills/code-lookup-discipline/SKILL.md"), "utf8"),
  );
  const routing = fs.readFileSync(
    path.join(repositoryRoot, "kcoderag-cursor/rules/kcoderag-navigation.mdc"),
    "utf8",
  );
  assert.match(routing, /list_indexes/iu);
  assert.match(routing, /semantic\/hybrid/iu);
  assert.match(routing, /keyword.*context.*get_call_chain/isu);
});

test("two actual packs from one tree have identical SHA and closed member inventory", () => {
  const first = releaseReadiness.createCandidatePackageArtifact({
    root: repositoryRoot,
    consumers: ["pack-audit"],
  });
  const second = releaseReadiness.createCandidatePackageArtifact({
    root: repositoryRoot,
    consumers: ["pack-audit"],
  });
  try {
    const firstAudit = packAudit.auditPackArtifact(first, { root: repositoryRoot });
    const secondAudit = packAudit.auditPackArtifact(second, { root: repositoryRoot });
    assert.equal(first.artifact.sha256, second.artifact.sha256);
    assert.equal(first.artifact.memberCount, second.artifact.memberCount);
    assert.equal(firstAudit.artifactSha256, secondAudit.artifactSha256);
    assert.equal(firstAudit.memberCount, secondAudit.memberCount);
  } finally {
    first.dispose();
    second.dispose();
  }
});

test("rejects the explicitly non-publishable retirement auditor at every pure inventory boundary", () => {
  const declared = packageJson();
  if (!declared.files.includes(RETIREMENT_AUDITOR_PATH)) {
    declared.files.push(RETIREMENT_AUDITOR_PATH);
  }
  expectCode(
    () => packAudit.expandPackageFiles(repositoryRoot, declared),
    "non_publishable_compiled_output",
  );

  const expected = baseline();
  expectCode(
    () => packAudit.validatePack({
      ...expected,
      expectedPaths: [...new Set([...expected.expectedPaths, RETIREMENT_AUDITOR_PATH])],
    }),
    "non_publishable_compiled_output",
  );

  const archived = baseline();
  archived.archiveEntries.set(RETIREMENT_AUDITOR_PATH, Buffer.from("repository-only\n"));
  expectCode(
    () => packAudit.validatePack(archived),
    "non_publishable_compiled_output",
  );
});

test("rejects an undeclared compiled member even when expected and archive inventories agree", () => {
  const extra = baseline();
  const extraPath = "dist/maintainer/undeclared-wrapper.cjs";
  extra.archiveEntries.set(extraPath, Buffer.from("module.exports = {};\n"));
  expectCode(
    () => packAudit.validatePack({
      ...extra,
      expectedPaths: [...extra.expectedPaths, extraPath].sort(),
    }),
    "archive_path_drift",
  );
});

test("accepts historical Python and parity vocabulary as data inside declared archive members", () => {
  const historical = baseline();
  historical.archiveEntries.set("dist/core/state.cjs", Buffer.from([
    "// Historical receipt label: python-legacy.",
    "const migratedPath = 'scripts/run_host_smoke.py';",
    "const retiredFlag = '--run-parity';",
    "const computedRuntimeName = ['py', 'thon'].join('');",
    "module.exports = { migratedPath, retiredFlag, computedRuntimeName };",
    "",
  ].join("\n"), "utf8"));

  assert.equal(packAudit.validatePack(historical).entryCount, historical.expectedPaths.length);
  assert.equal(Object.hasOwn(historical.packageJson.scripts, "verify:parity-before-retire"), false);
});

test("publishes host support runtime and keeps repository-only evidence outputs outside the archive", () => {
  const exact = baseline();
  assert.equal(exact.expectedPaths.includes(HOST_VERSION_SUPPORT_PATH), true);
  assert.equal(exact.expectedPaths.includes(HOST_DELIVERY_FIXTURE_PATH), false);

  for (const validatorPath of [
    HOST_DELIVERY_FIXTURE_PATH,
    PRE_RELEASE_EVIDENCE_PATH,
    HEAD_ACCEPTANCE_PATH,
  ]) {
    for (const boundary of ["declared", "expected", "archive"] as const) {
      const current = baseline();
      if (boundary === "declared") current.packageJson.files.push(validatorPath);
      if (boundary === "expected") {
        current.expectedPaths = [...current.expectedPaths, validatorPath];
      }
      if (boundary === "archive") {
        current.archiveEntries.set(validatorPath, Buffer.from("repository-only\n"));
      }
      expectCode(() => packAudit.validatePack(current), "non_publishable_compiled_output");
    }
  }
});

test("keeps the scrub baseline maintainer outside every publish inventory boundary", () => {
  const declared = packageJson();
  declared.files.push(SCRUB_BASELINE_PATH);
  expectCode(
    () => packAudit.expandPackageFiles(repositoryRoot, declared),
    "non_publishable_compiled_output",
  );

  const expected = baseline();
  expectCode(
    () => packAudit.validatePack({
      ...expected,
      expectedPaths: [...expected.expectedPaths, SCRUB_BASELINE_PATH],
    }),
    "non_publishable_compiled_output",
  );

  const archived = baseline();
  archived.archiveEntries.set(SCRUB_BASELINE_PATH, Buffer.from("repository-only\n"));
  expectCode(() => packAudit.validatePack(archived), "non_publishable_compiled_output");
});

test("rejects retired Dev package entries and archive members without broad content matching", () => {
  for (const retiredPath of [
    "kcoderag-dev/README.md",
    "kcoderag-dev/.codex-plugin/plugin.json",
  ]) {
    const declared = packageJson();
    declared.files.push(retiredPath);
    expectCode(
      () => packAudit.expandPackageFiles(repositoryRoot, declared),
      "retired_product",
    );
  }

  const archived = baseline();
  archived.archiveEntries.set("kcoderag-dev/hooks/grep-nudge.cjs", Buffer.from("retired\n"));
  expectCode(() => packAudit.validatePack(archived), "retired_product");

  const historical = baseline();
  historical.archiveEntries.set(
    "dist/core/state.cjs",
    Buffer.from("const legacyDirectory = 'kcoderag-dev';\n", "utf8"),
  );
  assert.equal(packAudit.validatePack(historical).entryCount, historical.expectedPaths.length);
});

test("rejects Python, runtime compiler, source, tests, planning, dependency, and credential fixtures", () => {
  for (const [forbiddenPath, expectedCode] of [
    ["kcoderag-qa/hooks/runtime.py", "forbidden_archive_path"],
    ["kcoderag-dev/hooks/runtime.pyc", "retired_product"],
    ["src/runtime.cts", "forbidden_archive_path"],
    ["dist/runtime.ts", "forbidden_archive_path"],
    ["dist-tests/runtime.test.cjs", "forbidden_archive_path"],
    ["tests/runtime.test.cjs", "forbidden_archive_path"],
    [".planning/private.md", "forbidden_archive_path"],
    ["node_modules/runtime/index.cjs", "forbidden_archive_path"],
    ["credential-fixtures/bearer.txt", "forbidden_archive_path"],
  ] as const) {
    const current = baseline();
    current.archiveEntries.set(forbiddenPath, Buffer.from("KCODERAG_PACK_CREDENTIAL_FIXTURE"));
    expectCode(() => packAudit.validatePack(current), expectedCode);
  }
});

test("rejects root marketplace and retired scanner or SVN workflow surfaces", () => {
  for (const forbiddenPath of [
    ".claude-plugin/marketplace.json",
    ".cursor-plugin/marketplace.json",
    `scripts/run-${String.fromCodePoint(0x6a, 0x78, 0x33)}-scanner.cjs`,
    "scripts/svn-review.cjs",
  ]) {
    const current = baseline();
    current.packageJson.files.push(forbiddenPath);
    current.expectedPaths = [...current.expectedPaths, forbiddenPath].sort();
    current.archiveEntries.set(forbiddenPath, Buffer.from("retired workflow\n"));
    expectCode(() => packAudit.validatePack(current), "forbidden_archive_path");
  }
});

test("rejects unexpected ignored compiled outputs and scans compiled runtime bytes", () => {
  const extra = path.join(repositoryRoot, "dist", "extra.cjs");
  fs.writeFileSync(extra, "module.exports = {};\n", "utf8");
  try {
    expectCode(
      () => packAudit.expandPackageFiles(repositoryRoot, packageJson()),
      "compiled_output_drift",
    );
  } finally {
    fs.unlinkSync(extra);
  }

  const credential = baseline();
  credential.archiveEntries.set(
    "dist/core/state.cjs",
    Buffer.from("KCODERAG_PACK_CREDENTIAL_FIXTURE", "ascii"),
  );
  expectCode(() => packAudit.validatePack(credential), "credential_fixture_in_archive");

  const unresolved = baseline();
  unresolved.archiveEntries.set(
    "dist/hosts/codex.cjs",
    Buffer.from("const value = '{{unexpected_runtime_token}}';\n", "utf8"),
  );
  expectCode(() => packAudit.validatePack(unresolved), "unresolved_placeholder");
});


test("rejects broad product files entries, missing entries, engine drift, and bin drift", () => {
  const broad = packageJson();
  broad.files = ["dist/", "kcoderag-qa/", "kcoderag-cursor/"];
  expectCode(() => packAudit.expandPackageFiles(repositoryRoot, broad), "files_policy_invalid");

  const missing = packageJson();
  missing.files = missing.files.filter(
    (value: string) => value !== "kcoderag-qa/hooks/grep-nudge.cjs",
  );
  const missingInput = baseline(missing);
  expectCode(() => packAudit.validatePack(missingInput), "missing_self_contained_asset");

  const engine = baseline();
  engine.packageJson.engines.node = ">=20";
  expectCode(() => packAudit.validatePack(engine), "engine_drift");

  const bin = baseline();
  bin.packageJson.bin["kcoderag-nav"] = "src/bin/kcoderag-nav.cts";
  expectCode(() => packAudit.validatePack(bin), "bin_drift");
});

test("rejects package or manifest version drift and unresolved template content", () => {
  const manifest = baseline();
  manifest.archiveEntries.set(
    "kcoderag-qa/.codex-plugin/plugin.json",
    Buffer.from('{"version":"0.0.0"}\n'),
  );
  expectCode(() => packAudit.validatePack(manifest), "version_drift");

  const packageManifest = baseline();
  const packedPackage = clone(packageManifest.packageJson);
  packedPackage.version = "9.9.9";
  packageManifest.archiveEntries.set("package.json", Buffer.from(JSON.stringify(packedPackage)));
  expectCode(() => packAudit.validatePack(packageManifest), "version_drift");

  const unresolved = baseline();
  unresolved.archiveEntries.set("README.md", Buffer.from("install {{unresolved_value}}\n"));
  expectCode(() => packAudit.validatePack(unresolved), "unresolved_placeholder");
});

test("pack implementation is local-only and disables lifecycle scripts", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "src", "maintainer", "pack-audit.cts"), "utf8");
  const ownerSource = fs.readFileSync(
    path.join(repositoryRoot, "src", "maintainer", "release-readiness.cts"),
    "utf8",
  );
  assert.match(source, /createCandidatePackageArtifact/u);
  assert.doesNotMatch(source, /\[\s*"pack"/u);
  assert.match(ownerSource, /\[\s*"pack",[\s\S]*?"--dry-run"/u);
  assert.match(ownerSource, /--ignore-scripts/u);
  assert.doesNotMatch(`${source}\n${ownerSource}`, /npm\s+publish|NPM_TOKEN|NODE_AUTH_TOKEN/iu);
});

test("pack audit delegates all gzip and tar parsing to the shared non-extracting parser", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "src", "maintainer", "pack-audit.cts"), "utf8");
  assert.match(source, /readTarArchive/u);
  assert.match(source, /scanTarball/u);
  assert.doesNotMatch(source, /gunzipSync|parsePaxPath|function readTarEntries/u);
  assert.doesNotMatch(source, /execFileSync\([^)]*tar|spawnSync\([^)]*tar/iu);
});
