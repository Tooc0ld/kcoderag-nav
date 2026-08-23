const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const childProcess = require("node:child_process") as typeof import("node:child_process");

type JsonMap = Record<string, any>;

interface AuditInput {
  packageJson: JsonMap;
  packageLock: JsonMap;
  npmTree: JsonMap;
}

interface AuditResult {
  directDependencies: number;
  transitiveDependencies: number;
  packages: string[];
}

interface ApprovedPackage {
  version: string;
  resolved: string;
  integrity: string;
  dependencies: Record<string, string>;
}

const APPROVED_RANGES = Object.freeze({
  "@types/node": ">=22.0.0 <23.0.0",
  typescript: ">=5.7.0 <7.0.0",
});

const APPROVED_PACKAGES: Readonly<Record<string, ApprovedPackage>> = Object.freeze({
  "@types/node": Object.freeze({
    version: "22.20.1",
    resolved: "https://registry.npmjs.org/@types/node/-/node-22.20.1.tgz",
    integrity:
      "sha512-EANqOCF9QFyra+4pfxUcX9STKJpCLjMbObVzljIJomAWSnuSIEAvyzEU53GaajbXJEgdh0iEcPL+DGvpUd4k1Q==",
    dependencies: Object.freeze({ "undici-types": "~6.21.0" }),
  }),
  typescript: Object.freeze({
    version: "6.0.3",
    resolved: "https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz",
    integrity:
      "sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==",
    dependencies: Object.freeze({}),
  }),
  "undici-types": Object.freeze({
    version: "6.21.0",
    resolved: "https://registry.npmjs.org/undici-types/-/undici-types-6.21.0.tgz",
    integrity:
      "sha512-iwDZqg0QAGrg9Rav5H4n0M64c3mkR59cJ6wQp+7C4nI0gsmExaedaYLNO44eT4AtBBwjbTiGPMlt2Md0T9H9JQ==",
    dependencies: Object.freeze({}),
  }),
});

const DIRECT_PACKAGE_NAMES = Object.freeze(["@types/node", "typescript"]);
const ALL_PACKAGE_NAMES = Object.freeze(["@types/node", "typescript", "undici-types"]);
const LIFECYCLE_SCRIPTS = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
  "prepublishOnly",
]);

class DependencyAuditError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "DependencyAuditError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : [];
}

function sameStringMap(actual: unknown, expected: Record<string, string>): boolean {
  if (!isRecord(actual) || ownKeys(actual).join("\0") !== Object.keys(expected).sort().join("\0")) {
    return false;
  }
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function throwUnless(condition: unknown, code: string): asserts condition {
  if (!condition) {
    throw new DependencyAuditError(code);
  }
}

function assertNoLifecycleScripts(packageJson: JsonMap, packageLock: JsonMap): void {
  const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
  throwUnless(!Object.keys(scripts).some((name) => LIFECYCLE_SCRIPTS.has(name)), "lifecycle_script");

  const packages = packageLock.packages as JsonMap;
  for (const metadata of Object.values(packages)) {
    throwUnless(!isRecord(metadata) || metadata.hasInstallScript !== true, "lifecycle_script");
    if (isRecord(metadata) && isRecord(metadata.scripts)) {
      throwUnless(
        !Object.keys(metadata.scripts).some((name) => LIFECYCLE_SCRIPTS.has(name)),
        "lifecycle_script",
      );
    }
  }
}

function assertPackageAndScriptPolicy(packageJson: JsonMap): void {
  throwUnless(
    packageJson.name === "kcoderag-nav" &&
      packageJson.engines?.node === ">=22" &&
      packageJson.bin?.["kcoderag-nav"] === "dist/bin/kcoderag-nav.cjs",
    "package_contract_drift",
  );
  throwUnless(isRecord(packageJson.scripts), "script_policy_drift");
  for (const [name, value] of Object.entries(packageJson.scripts)) {
    throwUnless(typeof value === "string", "script_policy_drift");
    throwUnless(!/\.cts|\bpython(?:3)?\b|\bts-node\b/i.test(value), "script_policy_drift");
    if (name !== "build") throwUnless(!/\btsc\b/.test(value), "script_policy_drift");
    if (name !== "ci:local") {
      throwUnless(!/npm run build/.test(value), "script_policy_drift");
    }
  }
  throwUnless(
    packageJson.scripts.build === "tsc -p tsconfig.json && tsc -p tsconfig.tests.json",
    "script_policy_drift",
  );
  throwUnless(
    packageJson.scripts["ci:local"] ===
      "npm run build && npm run deps:audit && npm test && npm run generate:check && npm run pack:audit",
    "script_policy_drift",
  );
}

function lockPath(packageName: string): string {
  return `node_modules/${packageName}`;
}

function assertLockGraph(packageJson: JsonMap, packageLock: JsonMap): void {
  throwUnless(packageLock.lockfileVersion === 3, "lock_graph_drift");
  throwUnless(isRecord(packageLock.packages), "lock_graph_drift");
  const packages = packageLock.packages as JsonMap;
  const expectedPaths = ["", ...ALL_PACKAGE_NAMES.map(lockPath)].sort();
  throwUnless(ownKeys(packages).join("\0") === expectedPaths.join("\0"), "lock_graph_drift");
  throwUnless(isRecord(packages[""]), "lock_graph_drift");
  throwUnless(
    sameStringMap((packages[""] as JsonMap).devDependencies, APPROVED_RANGES),
    "direct_dependency_drift",
  );
  throwUnless(
    (packages[""] as JsonMap).name === "kcoderag-nav" &&
      (packages[""] as JsonMap).version === packageJson.version,
    "lock_graph_drift",
  );

  for (const packageName of ALL_PACKAGE_NAMES) {
    const actual = packages[lockPath(packageName)];
    const approved = APPROVED_PACKAGES[packageName];
    throwUnless(isRecord(actual) && approved !== undefined, "lock_graph_drift");
    throwUnless(actual.version === approved.version, "lock_graph_drift");
    throwUnless(actual.resolved === approved.resolved, "resolution_drift");
    throwUnless(actual.integrity === approved.integrity, "integrity_drift");
    const dependencies = isRecord(actual.dependencies) ? actual.dependencies : {};
    throwUnless(sameStringMap(dependencies, approved.dependencies), "lock_graph_drift");
  }
}

function assertNpmNode(node: unknown, packageName: string): void {
  const approved = APPROVED_PACKAGES[packageName];
  throwUnless(isRecord(node) && approved !== undefined, "npm_tree_drift");
  throwUnless(node.version === approved.version, "npm_tree_drift");
  throwUnless(node.resolved === approved.resolved, "npm_tree_drift");
  throwUnless(node.integrity === approved.integrity, "npm_tree_drift");
  throwUnless(node.extraneous !== true && node.invalid !== true, "npm_tree_drift");
  const actualDependencies = isRecord(node.dependencies) ? node.dependencies : {};
  throwUnless(
    ownKeys(actualDependencies).join("\0") === Object.keys(approved.dependencies).sort().join("\0"),
    "npm_tree_drift",
  );
  for (const dependencyName of Object.keys(approved.dependencies)) {
    assertNpmNode(actualDependencies[dependencyName], dependencyName);
  }
}

function assertNpmTree(npmTree: JsonMap): void {
  throwUnless(npmTree.name === "kcoderag-nav", "npm_tree_drift");
  throwUnless(isRecord(npmTree.dependencies), "npm_tree_drift");
  throwUnless(
    ownKeys(npmTree.dependencies).join("\0") === [...DIRECT_PACKAGE_NAMES].sort().join("\0"),
    "npm_tree_drift",
  );
  for (const packageName of DIRECT_PACKAGE_NAMES) {
    assertNpmNode(npmTree.dependencies[packageName], packageName);
  }
}

function auditDependencyGraph(input: AuditInput): AuditResult {
  const { packageJson, packageLock, npmTree } = input;
  throwUnless(isRecord(packageJson) && isRecord(packageLock) && isRecord(npmTree), "invalid_audit_input");
  throwUnless(ownKeys(packageJson.dependencies).length === 0, "unexpected_production_dependency");
  throwUnless(
    sameStringMap(packageJson.devDependencies, APPROVED_RANGES),
    "direct_dependency_drift",
  );
  throwUnless(!Object.hasOwn(packageJson, "overrides") && !Object.hasOwn(packageJson, "resolutions"), "policy_override");
  assertPackageAndScriptPolicy(packageJson);
  assertNoLifecycleScripts(packageJson, packageLock);
  assertLockGraph(packageJson, packageLock);
  assertNpmTree(npmTree);
  return {
    directDependencies: DIRECT_PACKAGE_NAMES.length,
    transitiveDependencies: ALL_PACKAGE_NAMES.length - DIRECT_PACKAGE_NAMES.length,
    packages: ALL_PACKAGE_NAMES.map(
      (packageName) => `${packageName}@${APPROVED_PACKAGES[packageName]?.version ?? ""}`,
    ).sort(),
  };
}

function readJson(filePath: string): JsonMap {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  throwUnless(isRecord(parsed), "invalid_audit_input");
  return parsed;
}

function readInstalledTree(packageRoot: string): JsonMap {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm ls --all --json --long"]
    : ["ls", "--all", "--json", "--long"];
  return JSON.parse(
    childProcess.execFileSync(executable, args, {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ) as JsonMap;
}

function main(argv: string[] = process.argv.slice(2)): number {
  if (argv.length !== 0) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "invalid_arguments" })}\n`);
    return 2;
  }
  try {
    const packageRoot = path.resolve(__dirname, "../..");
    const npmTree = readInstalledTree(packageRoot);
    const result = auditDependencyGraph({
      packageJson: readJson(path.join(packageRoot, "package.json")),
      packageLock: readJson(path.join(packageRoot, "package-lock.json")),
      npmTree,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof DependencyAuditError ? error.code : "dependency_audit_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

exports.APPROVED_GRAPH = APPROVED_PACKAGES;
exports.DependencyAuditError = DependencyAuditError;
exports.auditDependencyGraph = auditDependencyGraph;
exports.main = main;

if (require.main === module) {
  process.exitCode = main();
}
