const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

type JsonMap = Record<string, any>;

interface PackAuditModule {
  PackAuditError: new (code: string) => Error & { code: string };
  expandPackageFiles(root: string, packageJson: JsonMap): readonly string[];
  validatePack(input: {
    readonly packageJson: JsonMap;
    readonly expectedPaths: readonly string[];
    readonly archiveEntries: ReadonlyMap<string, Buffer>;
  }): { readonly version: string; readonly entryCount: number };
  auditPack(options: { readonly root: string }): {
    readonly version: string;
    readonly entryCount: number;
    readonly statusPreserved: boolean;
    readonly treePreserved: boolean;
  };
}

const packAudit = require("../../dist/maintainer/pack-audit.cjs") as PackAuditModule;
const repositoryRoot = path.resolve(__dirname, "../..");

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
    "kcoderag-dev/.codex-plugin/plugin.json",
    "kcoderag-dev/.claude-plugin/plugin.json",
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
  const result = packAudit.auditPack({ root: repositoryRoot });
  const statusAfter = childProcess.execFileSync("git", ["status", "--short"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  assert.equal(result.version, packageJson().version);
  assert.ok(result.entryCount > 40);
  assert.equal(result.statusPreserved, true);
  assert.equal(result.treePreserved, true);
  assert.equal(statusAfter, statusBefore);
});

test("requires exact archive equality and all self-contained host assets", () => {
  const exact = baseline();
  assert.equal(packAudit.validatePack(exact).entryCount, exact.expectedPaths.length);

  const missing = baseline();
  missing.archiveEntries.delete("kcoderag-qa/hooks/grep-nudge.cjs");
  expectCode(() => packAudit.validatePack(missing), "archive_path_drift");

  const missingHost = baseline();
  const reduced = missingHost.expectedPaths.filter(
    (relativePath) => relativePath !== "kcoderag-cursor/rules/kcoderag-navigation.mdc",
  );
  missingHost.archiveEntries.delete("kcoderag-cursor/rules/kcoderag-navigation.mdc");
  expectCode(
    () => packAudit.validatePack({ ...missingHost, expectedPaths: reduced }),
    "missing_self_contained_asset",
  );
});

test("rejects Python, runtime compiler, source, tests, planning, dependency, and credential fixtures", () => {
  for (const forbiddenPath of [
    "kcoderag-qa/hooks/runtime.py",
    "kcoderag-dev/hooks/runtime.pyc",
    "src/runtime.cts",
    "dist/runtime.ts",
    "dist-tests/runtime.test.cjs",
    "tests/runtime.test.cjs",
    ".planning/private.md",
    "node_modules/runtime/index.cjs",
    "credential-fixtures/bearer.txt",
  ]) {
    const current = baseline();
    current.archiveEntries.set(forbiddenPath, Buffer.from("KCODERAG_PACK_CREDENTIAL_FIXTURE"));
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
  broad.files = ["dist/", "kcoderag-qa/", "kcoderag-dev/", "kcoderag-cursor/"];
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
  assert.match(source, /npm[\s\S]*pack/iu);
  assert.match(source, /--ignore-scripts/u);
  assert.doesNotMatch(source, /npm\s+publish|NPM_TOKEN|NODE_AUTH_TOKEN/iu);
});
