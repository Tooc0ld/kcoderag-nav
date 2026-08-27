const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const childProcess = require("node:child_process") as typeof import("node:child_process");

type JsonMap = Record<string, any>;

interface AuditModule {
  auditDependencyGraph(input: {
    packageJson: JsonMap;
    packageLock: JsonMap;
    npmTree: JsonMap;
  }): { directDependencies: number; transitiveDependencies: number; packages: string[] };
}

const auditModule = require("../../dist/maintainer/dependency-audit.cjs") as AuditModule;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function actualGraph(): { packageJson: JsonMap; packageLock: JsonMap; npmTree: JsonMap } {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm ls --all --json --long"]
    : ["ls", "--all", "--json", "--long"];
  return {
    packageJson: JSON.parse(fs.readFileSync("package.json", "utf8")),
    packageLock: JSON.parse(fs.readFileSync("package-lock.json", "utf8")),
    npmTree: JSON.parse(
      childProcess.execFileSync(executable, args, {
        encoding: "utf8",
      }),
    ),
  };
}

function expectAuditError(input: ReturnType<typeof actualGraph>, code: string): void {
  assert.throws(
    () => auditModule.auditDependencyGraph(input),
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as Error & { code: string }).code === code,
  );
}

test("accepts only the closed approved development graph", () => {
  const result = auditModule.auditDependencyGraph(actualGraph());
  assert.deepEqual(result, {
    directDependencies: 2,
    transitiveDependencies: 1,
    packages: ["@types/node@22.20.1", "typescript@6.0.3", "undici-types@6.21.0"],
  });
});

test("rejects production dependencies and direct dependency drift", () => {
  const production = actualGraph();
  production.packageJson.dependencies = { surprise: "1.0.0" };
  expectAuditError(production, "unexpected_production_dependency");

  const direct = actualGraph();
  direct.packageJson.devDependencies.surprise = "1.0.0";
  expectAuditError(direct, "direct_dependency_drift");
});

test("rejects overrides, resolutions, lifecycle scripts, and extra lock nodes", () => {
  for (const key of ["overrides", "resolutions"]) {
    const input = actualGraph();
    input.packageJson[key] = { typescript: "6.0.3" };
    expectAuditError(input, "policy_override");
  }

  const rootScript = actualGraph();
  rootScript.packageJson.scripts.postinstall = "node unexpected.cjs";
  expectAuditError(rootScript, "lifecycle_script");

  const packageScript = actualGraph();
  packageScript.packageLock.packages["node_modules/typescript"].hasInstallScript = true;
  expectAuditError(packageScript, "lifecycle_script");

  const extra = actualGraph();
  extra.packageLock.packages["node_modules/surprise"] = {
    version: "1.0.0",
    resolved: "https://registry.npmjs.org/surprise/-/surprise-1.0.0.tgz",
    integrity: "sha512-unapproved",
  };
  expectAuditError(extra, "lock_graph_drift");
});

test("rejects public package, runtime engine, bin, and compiled-script policy drift", () => {
  for (const mutate of [
    (input: ReturnType<typeof actualGraph>) => {
      input.packageJson.name = "renamed-package";
    },
    (input: ReturnType<typeof actualGraph>) => {
      input.packageJson.engines.node = ">=20";
    },
    (input: ReturnType<typeof actualGraph>) => {
      input.packageJson.bin["kcoderag-nav"] = "src/bin/kcoderag-nav.cts";
    },
  ]) {
    const input = actualGraph();
    mutate(input);
    expectAuditError(input, "package_contract_drift");
  }

  for (const command of [
    "node src/tool.cts",
    "python scripts/tool.py",
    "ts-node src/tool.cts",
    "tsc -p another.json",
    "npm run build && node dist/tool.cjs",
  ]) {
    const input = actualGraph();
    input.packageJson.scripts["unexpected"] = command;
    expectAuditError(input, "script_policy_drift");
  }

  for (const mutate of [
    (input: ReturnType<typeof actualGraph>) => {
      input.packageJson.scripts["ci:local"] =
        "npm run build && npm run deps:audit && npm test && npm run generate:check && npm run pack:audit";
    },
    (input: ReturnType<typeof actualGraph>) => {
      input.packageJson.scripts["smoke:required"] =
        "node dist/smoke/host-smoke.cjs --mode optional-live";
    },
    (input: ReturnType<typeof actualGraph>) => {
      input.packageJson.scripts["smoke:live"] =
        "node dist/smoke/host-smoke.cjs --mode required-contract";
    },
  ]) {
    const input = actualGraph();
    mutate(input);
    expectAuditError(input, "script_policy_drift");
  }
});

test("requires current capability, hook, and manual-conflict scripts without migration authority", () => {
  const accepted = actualGraph();
  assert.equal(Object.hasOwn(accepted.packageJson.scripts, "test:migration"), false);
  assert.equal(
    accepted.packageJson.scripts["test:capabilities"],
    "node --test dist-tests/capabilities/*.test.cjs",
  );
  assert.equal(
    accepted.packageJson.scripts["test:capability-hooks"],
    "node --test dist-tests/hooks/pre-tool-dispatcher.test.cjs dist-tests/hooks/code-style-nudge.test.cjs dist-tests/hooks/once-marker.test.cjs dist-tests/hooks/session-cleanup.test.cjs",
  );
  assert.equal(
    accepted.packageJson.scripts["test:manual-conflict"],
    "node --test dist-tests/migration/manual-source-conflict.test.cjs",
  );

  for (const scriptName of ["test:capabilities", "test:capability-hooks", "test:manual-conflict"]) {
    const missing = actualGraph();
    delete missing.packageJson.scripts[scriptName];
    expectAuditError(missing, "script_policy_drift");
  }

  const legacy = actualGraph();
  legacy.packageJson.scripts["test:migration"] = "node --test dist-tests/migration/legacy-state.test.cjs";
  expectAuditError(legacy, "script_policy_drift");
});

test("rejects parent-edge, exact version, resolution, and integrity drift", () => {
  const edge = actualGraph();
  delete edge.packageLock.packages["node_modules/@types/node"].dependencies["undici-types"];
  expectAuditError(edge, "lock_graph_drift");

  const version = actualGraph();
  version.packageLock.packages["node_modules/typescript"].version = "6.0.2";
  expectAuditError(version, "lock_graph_drift");

  const resolution = actualGraph();
  resolution.packageLock.packages["node_modules/typescript"].resolved =
    "https://example.invalid/typescript.tgz";
  expectAuditError(resolution, "resolution_drift");

  const integrity = actualGraph();
  integrity.packageLock.packages["node_modules/typescript"].integrity = "sha512-drifted";
  expectAuditError(integrity, "integrity_drift");
});

test("cross-checks the complete npm ls tree rather than trusting the lock alone", () => {
  const missingEdge = actualGraph();
  delete missingEdge.npmTree.dependencies["@types/node"].dependencies["undici-types"];
  expectAuditError(missingEdge, "npm_tree_drift");

  const unexpectedNode = actualGraph();
  unexpectedNode.npmTree.dependencies.surprise = {
    version: "1.0.0",
    resolved: "https://registry.npmjs.org/surprise/-/surprise-1.0.0.tgz",
    integrity: "sha512-unapproved",
  };
  expectAuditError(unexpectedNode, "npm_tree_drift");

  const metadataDrift = actualGraph();
  metadataDrift.npmTree.dependencies.typescript.integrity = "sha512-drifted";
  expectAuditError(metadataDrift, "npm_tree_drift");
});

test("does not mutate any audit input", () => {
  const input = actualGraph();
  const before = clone(input);
  auditModule.auditDependencyGraph(input);
  assert.deepEqual(input, before);
});
