/** Candidate-bound Windows native-host driver admission and honesty tests. */

const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");

type HostId = "codex" | "claude" | "cursor" | "opencode" | "zcode";

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
}

interface DriverDependencies {
  readonly resolveCommand: (name: string) => string | undefined;
  readonly runCommand: (
    executable: string,
    args: readonly string[],
    options: Readonly<Record<string, unknown>>,
  ) => Promise<CommandResult>;
  readonly pathExists?: (filePath: string) => boolean;
}

interface DriverModule {
  readonly DRIVER_HOSTS: readonly HostId[];
  discoverHostExecutable(
    host: HostId,
    environment: NodeJS.ProcessEnv,
    resolveCommand: (name: string) => string | undefined,
    pathExists: (filePath: string) => boolean,
  ): string | undefined;
  probeNativeHost(
    input: Readonly<Record<string, string>>,
    dependencies: DriverDependencies,
  ): Promise<Readonly<Record<string, unknown>>>;
  runNativeHost(
    input: Readonly<Record<string, string>>,
    dependencies: DriverDependencies,
  ): Promise<Readonly<Record<string, any>>>;
  cleanupNativeHost(input: Readonly<Record<string, string>>): Promise<Readonly<{ cleaned: true }>>;
}

const driver = require("../../dist/maintainer/native-host-driver.cjs") as DriverModule;

function input(root: string, host: HostId): Readonly<Record<string, string>> {
  return Object.freeze({
    host,
    project: path.join(root, "project"),
    cache: path.join(root, "cache"),
    npmCache: path.join(root, "npm-cache"),
    package: path.join(root, "candidate.tgz"),
  });
}

test("discovers ZCode from its bounded per-user install path when PATH has no shim", () => {
  const expected = path.join("C:\\Users\\runner", "AppData", "Local", "Programs", "ZCode", "ZCode.exe");
  const found = driver.discoverHostExecutable(
    "zcode",
    { LOCALAPPDATA: path.join("C:\\Users\\runner", "AppData", "Local") },
    () => undefined,
    (candidate) => candidate === expected,
  );
  assert.equal(found, expected);
});

test("probe emits honest environment and admission taxonomy", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-native-probe-"));
  try {
    const missing = await driver.probeNativeHost(input(root, "codex"), {
      resolveCommand: () => undefined,
      runCommand: async () => ({ code: 1, stdout: "" }),
    });
    assert.deepEqual(missing, { admitted: false, stage: "environment", reasonCode: "host_unavailable" });

    const untrusted = await driver.probeNativeHost(input(root, "zcode"), {
      resolveCommand: () => "ZCode.exe",
      runCommand: async () => ({ code: 0, stdout: "3.10.1" }),
      pathExists: () => true,
    });
    assert.deepEqual(untrusted, { admitted: false, stage: "admission", reasonCode: "workspace_trust_missing" });

    const cursorWithoutAgent = await driver.probeNativeHost(input(root, "cursor"), {
      resolveCommand: () => "cursor.exe",
      runCommand: async () => ({ code: 0, stdout: "3.17.8" }),
      pathExists: () => true,
    });
    assert.deepEqual(cursorWithoutAgent, { admitted: false, stage: "environment", reasonCode: "host_cli_missing" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ZCode freezes desktop and runtime versions and reports native auth absence without leaking output", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-native-zcode-"));
  const previousLocal = process.env.LOCALAPPDATA;
  const previousVersion = process.env.KCODERAG_ZCODE_VERSION;
  const previousTrust = process.env.KCODERAG_ZCODE_WORKSPACE_TRUST;
  try {
    process.env.LOCALAPPDATA = root;
    process.env.KCODERAG_ZCODE_VERSION = "3.10.1";
    process.env.KCODERAG_ZCODE_WORKSPACE_TRUST = "approved";
    const runtime = path.join(root, "Programs", "ZCode", "resources", "glm", "zcode.cjs");
    const calls: readonly string[][] = [];
    const mutableCalls = calls as string[][];
    const admission = await driver.probeNativeHost(input(root, "zcode"), {
      resolveCommand: () => undefined,
      pathExists: (candidate) => candidate === runtime,
      runCommand: async (_executable, args) => {
        mutableCalls.push([...args]);
        return args.includes("--version")
          ? { code: 0, stdout: "zcode 0.16.5" }
          : { code: 1, stdout: "login required Authorization: Bearer never-copy" };
      },
    });
    assert.deepEqual(admission, { admitted: false, stage: "admission", reasonCode: "host_auth_missing" });
    assert.equal(JSON.stringify(admission).includes("Bearer"), false);
    assert.equal(calls.length, 2);
  } finally {
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previousLocal;
    if (previousVersion === undefined) delete process.env.KCODERAG_ZCODE_VERSION; else process.env.KCODERAG_ZCODE_VERSION = previousVersion;
    if (previousTrust === undefined) delete process.env.KCODERAG_ZCODE_WORKSPACE_TRUST; else process.env.KCODERAG_ZCODE_WORKSPACE_TRUST = previousTrust;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native run never converts partial or natural-language claims into PASS observations", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-native-honesty-"));
  try {
    fs.mkdirSync(path.join(root, "project"), { recursive: true });
    fs.writeFileSync(path.join(root, "candidate.tgz"), "candidate", "utf8");
    const outcome = await driver.runNativeHost(input(root, "codex"), {
      resolveCommand: (name) => name,
      runCommand: async (_executable, args) => {
        if (args.includes("--version")) return { code: 0, stdout: "codex-cli 0.151.0" };
        return { code: 0, stdout: "all hooks and MCP calls passed" };
      },
    });
    assert.equal(outcome.status, "FAIL");
    assert.notEqual(outcome.reasonCode, "none");
    assert.equal(Object.values(outcome.observations.common).every((value) => value === true), false);
    assert.equal(Object.values(outcome.observations.host).every((value) => value === true), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("driver output schema never carries native stdout or secret-shaped fields", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-native-secret-"));
  try {
    fs.mkdirSync(path.join(root, "project"), { recursive: true });
    fs.writeFileSync(path.join(root, "candidate.tgz"), "candidate", "utf8");
    const canary = "Authorization: Bearer should-never-escape";
    const outcome = await driver.runNativeHost(input(root, "opencode"), {
      resolveCommand: (name) => name,
      runCommand: async () => ({ code: 1, stdout: canary }),
    });
    const serialized = JSON.stringify(outcome);
    assert.doesNotMatch(serialized, /Authorization|Bearer|should-never-escape/u);
    assert.deepEqual(Object.keys(outcome).sort(), ["observations", "reasonCode", "stage", "status"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup removes only the lane-owned process ledger", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-native-cleanup-"));
  try {
    const cache = path.join(root, "cache");
    fs.mkdirSync(cache, { recursive: true });
    const ledger = path.join(cache, "native-processes.json");
    fs.writeFileSync(ledger, "[]\n", "utf8");
    assert.deepEqual(await driver.cleanupNativeHost(input(root, "codex")), { cleaned: true });
    assert.equal(fs.existsSync(ledger), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
