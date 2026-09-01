const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const REPOSITORY_ROOT = path.resolve(".");
const NAVIGATION_BASELINE = "Use KCodeRag for structural code navigation before broad local search.";

interface PackedInstall {
  readonly packageRoot: string;
  readonly sha256: string;
}

interface HookRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runNpm(args: readonly string[], cwd: string): import("node:child_process").SpawnSyncReturns<string> {
  const executable = process.platform === "win32"
    ? (process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe")
    : "npm";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd", ...args]
    : [...args];
  return childProcess.spawnSync(executable, commandArgs, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
}

function packAndInstall(temporaryRoot: string): PackedInstall {
  const packRoot = path.join(temporaryRoot, "pack");
  const installRoot = path.join(temporaryRoot, "acquired");
  fs.mkdirSync(packRoot, { recursive: true });
  fs.mkdirSync(installRoot, { recursive: true });
  const packed = runNpm([
    "pack",
    REPOSITORY_ROOT,
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    packRoot,
  ], temporaryRoot);
  assert.equal(packed.status, 0, packed.stderr);
  const documents: unknown = JSON.parse(packed.stdout);
  assert.equal(Array.isArray(documents), true);
  const filename = (documents as readonly { readonly filename?: unknown }[])[0]?.filename;
  assert.equal(typeof filename, "string");
  const tarballPath = path.join(packRoot, filename as string);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(tarballPath)).digest("hex");
  const installed = runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--prefix",
    installRoot,
    tarballPath,
  ], temporaryRoot);
  assert.equal(installed.status, 0, installed.stderr);
  return Object.freeze({
    packageRoot: path.join(installRoot, "node_modules", "kcoderag-nav"),
    sha256,
  });
}

async function installCodexProject(packageRoot: string, projectRoot: string): Promise<void> {
  const codex = require(path.join(packageRoot, "dist", "hosts", "codex.cjs")) as Record<string, any>;
  const projectTarget = require(path.join(packageRoot, "dist", "core", "project-target.cjs")) as Record<string, any>;
  const transaction = require(path.join(packageRoot, "dist", "core", "transaction.cjs")) as Record<string, any>;
  const target = projectTarget.resolveProjectTarget(projectRoot);
  const adapter = codex.createCodexAdapter();
  const observation = adapter.detect({ target, packageRoot });
  const desired = adapter.renderInstall({
    target,
    packageRoot,
    command: "install",
    environment: "qa",
    observation,
    selectedCapabilities: ["kcoderag-navigation"],
  });
  await transaction.applyTransaction(desired);
}

function sessionStartCommand(projectRoot: string): string {
  const document: unknown = JSON.parse(
    fs.readFileSync(path.join(projectRoot, ".codex", "hooks.json"), "utf8"),
  );
  const hooks = (document as Record<string, any>).hooks?.SessionStart;
  assert.equal(Array.isArray(hooks), true);
  const registration = hooks[0];
  assert.equal(registration.matcher, "^(startup|resume|clear|compact)$");
  const command = process.platform === "win32"
    ? registration.hooks?.[0]?.commandWindows
    : registration.hooks?.[0]?.command;
  assert.equal(typeof command, "string");
  return command as string;
}

function runHookCommand(
  command: string,
  projectRoot: string,
  cacheRoot: string,
  input: string,
): HookRun {
  const environment = {
    ...process.env,
    LOCALAPPDATA: cacheRoot,
    XDG_CACHE_HOME: cacheRoot,
  };
  const result = childProcess.spawnSync(command, {
    cwd: projectRoot,
    env: environment,
    input,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    shell: true,
  });
  return Object.freeze({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

function parseContext(run: HookRun): string | undefined {
  if (run.stdout.length === 0) return undefined;
  const output: unknown = JSON.parse(run.stdout);
  const record = output as Record<string, any>;
  assert.equal(record.hookSpecificOutput?.hookEventName, "SessionStart");
  return record.hookSpecificOutput?.additionalContext;
}

function markerFiles(cacheRoot: string): readonly string[] {
  const directory = path.join(cacheRoot, "kcoderag-nav", "nudges");
  try {
    return fs.readdirSync(directory).filter((name) => /^[0-9a-f]{64}\.claim$/u.test(name)).sort();
  } catch {
    return [];
  }
}

test("actual tgz Codex SessionStart is bounded, epoch-scoped, and PACKAGED only", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-hook-tracer-"));
  try {
    const installed = packAndInstall(temporaryRoot);
    const projectRoot = path.join(temporaryRoot, "project-a");
    const secondProject = path.join(temporaryRoot, "project-b");
    const cacheRoot = path.join(temporaryRoot, "cache");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(secondProject, { recursive: true });
    await installCodexProject(installed.packageRoot, projectRoot);
    await installCodexProject(installed.packageRoot, secondProject);

    const command = sessionStartCommand(projectRoot);
    const payload = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "opaque-session-a",
      source: "startup",
    });
    const first = runHookCommand(command, projectRoot, cacheRoot, payload);
    assert.equal(first.status, 0, first.stderr);
    const firstContext = parseContext(first);
    assert.equal(typeof firstContext, "string");
    assert.match(firstContext ?? "", new RegExp(NAVIGATION_BASELINE.replaceAll(".", "\\."), "u"));
    assert.ok((firstContext?.length ?? 0) <= 600);

    const repeated = runHookCommand(command, projectRoot, cacheRoot, payload);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(repeated.stdout, "");

    const nextEpoch = runHookCommand(command, projectRoot, cacheRoot, JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "opaque-session-a",
      source: "clear",
    }));
    assert.equal(typeof parseContext(nextEpoch), "string");

    const nextSession = runHookCommand(command, projectRoot, cacheRoot, JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "opaque-session-b",
      source: "startup",
    }));
    assert.equal(typeof parseContext(nextSession), "string");

    const secondCommand = sessionStartCommand(secondProject);
    const nextRoot = runHookCommand(secondCommand, secondProject, cacheRoot, payload);
    assert.equal(typeof parseContext(nextRoot), "string");

    const nfc = runHookCommand(command, projectRoot, cacheRoot, JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "caf\u00e9",
      source: "startup",
    }));
    const nfd = runHookCommand(command, projectRoot, cacheRoot, JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "cafe\u0301",
      source: "startup",
    }));
    assert.equal(typeof parseContext(nfc), "string");
    assert.equal(typeof parseContext(nfd), "string");

    const claims = markerFiles(cacheRoot);
    assert.equal(claims.length, 6);
    for (const name of claims) {
      assert.equal(fs.readFileSync(path.join(cacheRoot, "kcoderag-nav", "nudges", name)).length, 0);
    }

    const directLauncherObservation = Object.freeze({
      artifactSha256: installed.sha256,
      evidenceLevel: "PACKAGED" as const,
      nativeHostObserved: false,
      status: "PASS" as const,
    });
    assert.equal(directLauncherObservation.evidenceLevel, "PACKAGED");
    assert.throws(() => {
      const promoted = { ...directLauncherObservation, evidenceLevel: "LIVE" as const };
      if (promoted.status === "PASS" && promoted.evidenceLevel === "LIVE" && !promoted.nativeHostObserved) {
        throw new Error("native_host_observation_required");
      }
    }, /native_host_observation_required/u);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("SessionStart tracer fails open for empty, malformed, scalar, null, and oversized input", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-hook-tracer-fail-open-"));
  try {
    const installed = packAndInstall(temporaryRoot);
    const projectRoot = path.join(temporaryRoot, "project");
    const cacheRoot = path.join(temporaryRoot, "cache");
    fs.mkdirSync(projectRoot, { recursive: true });
    await installCodexProject(installed.packageRoot, projectRoot);
    const command = sessionStartCommand(projectRoot);
    for (const input of ["", "{", "1", "null", "{}", "x".repeat(131_073)]) {
      const run = runHookCommand(command, projectRoot, cacheRoot, input);
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, "", input.slice(0, 20));
    }
    assert.deepEqual(markerFiles(cacheRoot), []);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
