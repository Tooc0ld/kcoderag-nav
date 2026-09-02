/** Candidate-bound Windows native-host driver admission and honesty tests. */

const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess: typeof import("node:child_process") = require("node:child_process");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");

type HostId = "codex" | "claude" | "cursor" | "opencode" | "zcode";

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly nativeErrorKind?: string;
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
  classifyNativeError(value: Record<string, unknown>): string;
  parseNativeEvidence(output: string): Readonly<Record<string, any>>;
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
  defaultRunCommand(
    executable: string,
    args: readonly string[],
    options: Readonly<Record<string, unknown>>,
  ): Promise<CommandResult>;
  processStartTime(pid: number): number | undefined;
}

const driver = require("../../dist/maintainer/native-host-driver.cjs") as DriverModule;

test("native errors use closed admission-safe categories without exposing bodies", () => {
  assert.equal(driver.classifyNativeError({ type: "error", message: "permission denied" }), "permission");
  assert.equal(driver.classifyNativeError({ type: "error", kind: "protocol_handshake" }), "protocol");
  assert.equal(driver.classifyNativeError({ type: "error", code: "tool_not_found" }), "tool_unavailable");
  assert.equal(driver.classifyNativeError({ type: "error", message: "Transport channel closed after HTTP 502" }), "connect");
});

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

test("verified Cursor agent uses one isolated authenticated environment for probe and run without an unsupported workspace flag", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-native-cursor-env-"));
  const previousVersion = process.env.KCODERAG_CURSOR_VERSION;
  const previousKey = process.env.CURSOR_API_KEY;
  const captured: { readonly args: readonly string[]; readonly env: NodeJS.ProcessEnv }[] = [];
  try {
    process.env.KCODERAG_CURSOR_VERSION = "3.17.8";
    process.env.CURSOR_API_KEY = "opaque-test-key";
    fs.mkdirSync(path.join(root, "project"), { recursive: true });
    fs.writeFileSync(path.join(root, "candidate.tgz"), "candidate", "utf8");
    const dependencies: DriverDependencies = {
      resolveCommand: (name) => name === "agent" ? path.join(root, "agent.exe") : undefined,
      pathExists: () => true,
      runCommand: async (_executable, args, options) => {
        const env = options.env as NodeJS.ProcessEnv;
        captured.push({ args: [...args], env });
        if (args.includes("--help")) return { code: 0, stdout: "Cursor Agent mcp --output-format" };
        if (args.includes("kcoderag-nav")) {
          if (args.includes("status")) return { code: 0, stdout: JSON.stringify({ ok: true, status: "healthy" }) };
          return { code: 0, stdout: JSON.stringify({ ok: true }) };
        }
        return { code: 0, stdout: "{}\n" };
      },
    };
    assert.deepEqual(await driver.probeNativeHost(input(root, "cursor"), dependencies), { admitted: true });
    await driver.runNativeHost(input(root, "cursor"), dependencies);
    const nativeCalls = captured.filter((call) => call.args.includes("--output-format"));
    assert.ok(nativeCalls.length >= 2);
    assert.equal(nativeCalls.every((call) => call.env.CURSOR_API_KEY === "opaque-test-key"), true);
    assert.equal(nativeCalls.every((call) => call.env.USERPROFILE === path.join(root, "cache", "host-home")), true);
    assert.equal(nativeCalls.every((call) => !call.args.includes("--workspace")), true);
  } finally {
    if (previousVersion === undefined) delete process.env.KCODERAG_CURSOR_VERSION; else process.env.KCODERAG_CURSOR_VERSION = previousVersion;
    if (previousKey === undefined) delete process.env.CURSOR_API_KEY; else process.env.CURSOR_API_KEY = previousKey;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("host-specific native prompts trigger fixed Codex search and Claude Grep Glob Bash canaries", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-native-prompts-"));
  try {
    for (const host of ["codex", "claude"] as const) {
      const hostRoot = path.join(root, host);
      fs.mkdirSync(path.join(hostRoot, "project"), { recursive: true });
      fs.writeFileSync(path.join(hostRoot, "candidate.tgz"), "candidate", "utf8");
      if (host === "codex") {
        fs.mkdirSync(path.join(hostRoot, "project", ".codex"), { recursive: true });
        fs.writeFileSync(path.join(hostRoot, "project", ".codex", "config.toml"), [
          "# BEGIN kcoderag-nav:kcoderag-navigation",
          "[mcp_servers.kcoderag-qa]",
          "command = \"node\"",
          "# END kcoderag-nav:kcoderag-navigation",
          "",
        ].join("\n"), "utf8");
        fs.writeFileSync(path.join(hostRoot, "project", ".codex", "hooks.json"), JSON.stringify({ hooks: {} }), "utf8");
      }
      const calls: readonly string[][] = [];
      const mutableCalls = calls as string[][];
      await driver.runNativeHost(input(hostRoot, host), {
        resolveCommand: (name) => name,
        pathExists: () => true,
        runCommand: async (_executable, args) => {
          mutableCalls.push([...args]);
          if (args.includes("kcoderag-nav")) {
            if (args.includes("status")) return { code: 0, stdout: JSON.stringify({ ok: true, status: "healthy" }) };
            return { code: 0, stdout: JSON.stringify({ ok: true }) };
          }
          return { code: 0, stdout: "{}\n" };
        },
      });
      const serialized = JSON.stringify(calls);
      assert.match(serialized, /KCODERAG_NATIVE_ACCEPTANCE_CANARY/u);
      assert.match(serialized, /feedback-observation-v1/u);
      assert.match(serialized, /usability_report/u);
      assert.match(serialized, /severity low/u);
      assert.doesNotMatch(serialized, /acceptance-only rating/u);
      if (host === "codex") {
        const native = calls.filter((args) => args[0] === "exec" && args.includes("--enable"));
        assert.equal(native.length, 2);
        assert.equal(native.every((args) => !args.includes("--approve-for-me")), true);
        assert.equal(native.every((args) => args.includes("--sandbox") && args.includes("read-only")), true);
        assert.equal(native.every((args) => args.includes('approval_policy="never"')), true);
        assert.equal(native.filter((args) => JSON.stringify(args).includes("KCODERAG_NATIVE_ACCEPTANCE_CANARY")).length, 2);
        assert.equal(native.filter((args) => JSON.stringify(args).includes("feedback-observation-v1")).length, 1);
      }
      if (host === "claude") {
        const native = calls.filter((args) => args[0] === "-p");
        assert.equal(native.length, 2);
        assert.equal(native.filter((args) => JSON.stringify(args).includes("Use Glob once")).length, 1);
        assert.equal(native.filter((args) => JSON.stringify(args).includes("feedback-observation-v1")).length, 1);
        assert.match(serialized, /Use Glob once/u);
        assert.match(serialized, /Use Grep once/u);
        assert.match(serialized, /Use Bash once/u);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Claude stream-json hook lifecycle is correlated with real Grep Glob and Bash tool-use blocks", () => {
  const output = [
    { type: "system", subtype: "hook_response", hook_event: "SessionStart", hook_name: "kcoderag-nav session-start", additionalContext: "KCodeRag ready" },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Glob" }] } },
    { type: "system", subtype: "hook_started", hook_event: "PreToolUse", hook_id: "glob-hook", hook_name: "PreToolUse:Glob" },
    { type: "system", subtype: "hook_response", hook_event: "PreToolUse", hook_id: "glob-hook", hook_name: "PreToolUse:Glob", exit_code: 0 },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Grep" }] } },
    { type: "system", subtype: "hook_started", hook_event: "PreToolUse", hook_id: "grep-hook", hook_name: "PreToolUse:Grep" },
    { type: "system", subtype: "hook_response", hook_event: "PreToolUse", hook_id: "grep-hook", hook_name: "PreToolUse:Grep", exit_code: 0 },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } },
    { type: "system", subtype: "hook_started", hook_event: "PreToolUse", hook_id: "bash-hook", hook_name: "PreToolUse:Bash" },
    { type: "system", subtype: "hook_response", hook_event: "PreToolUse", hook_id: "bash-hook", hook_name: "PreToolUse:Bash", exit_code: 0 },
  ].map((value) => JSON.stringify(value)).join("\n");
  const evidence = driver.parseNativeEvidence(output);
  assert.equal(evidence.sessionStart, true);
  assert.equal(evidence.grepHook, true);
  assert.equal(evidence.globHook, true);
  assert.equal(evidence.bashHook, true);
});

test("Claude stream-json correlates structured MCP envelopes and rejects failed feedback results", () => {
  const success = (toolUseId: string) => ({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content: "bounded" }] },
    tool_use_result: { content: [], structuredContent: { ok: true } },
  });
  const output = [
    { type: "assistant", message: { content: [{ type: "tool_use", id: "list-1", name: "mcp__kcoderag-qa__list_indexes" }] } },
    success("list-1"),
    { type: "assistant", message: { content: [{ type: "tool_use", id: "search-1", name: "mcp__kcoderag-qa__search_code" }] } },
    success("search-1"),
    { type: "assistant", message: { content: [{ type: "tool_use", id: "feedback-1", name: "mcp__kcoderag-qa__submit_feedback" }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "feedback-1", is_error: true, content: "unavailable" }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "search-2", name: "mcp__kcoderag-qa__search_code" }] } },
    success("search-2"),
  ].map((value) => JSON.stringify(value)).join("\n");
  const evidence = driver.parseNativeEvidence(output);
  assert.equal(evidence.listIndexes, true);
  assert.equal(evidence.searchCodeCount, 2);
  assert.equal(evidence.structuredResult, true);
  assert.equal(evidence.submitFeedback, false);
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

test("Codex native registration is closed and independent from missing list_indexes execution", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-native-codex-registration-"));
  try {
    const project = path.join(root, "project");
    fs.mkdirSync(path.join(project, ".codex", "kcoderag-nav", "qa", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(root, "candidate.tgz"), "candidate", "utf8");
    fs.writeFileSync(path.join(project, ".codex", "config.toml"), [
      "# BEGIN kcoderag-nav:kcoderag-navigation",
      "[mcp_servers.kcoderag-qa]",
      "command = \"node\"",
      "# END kcoderag-nav:kcoderag-navigation",
      "",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(project, ".codex", "hooks.json"), JSON.stringify({ hooks: {} }), "utf8");
    fs.writeFileSync(
      path.join(project, ".codex", "kcoderag-nav", "qa", "hooks", "pre-tool-dispatcher.cjs"),
      "process.exitCode=0;\n",
      "utf8",
    );
    const outcome = await driver.runNativeHost(input(root, "codex"), {
      resolveCommand: () => path.join(root, "codex.cmd"),
      pathExists: () => true,
      runCommand: async (_executable, args) => {
        if (args.includes("kcoderag-nav")) {
          if (args.includes("status")) return { code: 0, stdout: JSON.stringify({ ok: true, status: "healthy" }) };
          return { code: 0, stdout: JSON.stringify({ ok: true }) };
        }
        if (args[0] === "mcp") return { code: 0, stdout: JSON.stringify([{ name: "kcoderag-qa", enabled: true }]) };
        if (args.some((item) => item.endsWith("pre-tool-dispatcher.cjs"))) return { code: 0, stdout: "" };
        return { code: 0, stdout: [
          JSON.stringify({ type: "SessionStart", additionalContext: "KCodeRag ready" }),
          JSON.stringify({ type: "hook", additionalContext: "KCodeRag ready" }),
          JSON.stringify({ type: "error", message: "MCP tool approval permission denied" }),
        ].join("\n") };
      },
    });
    assert.equal(outcome.observations.common.mcpRegistered, true);
    assert.equal(outcome.observations.host.directMcpRegistrationObserved, true);
    assert.equal(outcome.status, "FAIL");
    assert.equal(outcome.stage, "mcp");
    assert.equal(outcome.reasonCode, "mcp_permission_denied");
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

test("normal process exit removes ownership and cleanup matches a still-running process start identity", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-native-owned-process-"));
  try {
    const cache = path.join(root, "cache");
    const completed = await driver.defaultRunCommand(process.execPath, ["-e", "process.stdout.write('ok')"], {
      cwd: root,
      env: process.env,
      timeoutMs: 10_000,
      pidRoot: cache,
    });
    assert.deepEqual(completed, { code: 0, stdout: "ok" });
    assert.equal(fs.existsSync(path.join(cache, "native-processes.json")), false);

    const transportFailure = await driver.defaultRunCommand(process.execPath, [
      "-e",
      "process.stderr.write('UnexpectedServerResponse HTTP 502: private-body')",
    ], {
      cwd: root,
      env: process.env,
      timeoutMs: 10_000,
      pidRoot: cache,
    });
    assert.deepEqual(transportFailure, { code: 0, stdout: "", nativeErrorKind: "connect" });
    assert.doesNotMatch(JSON.stringify(transportFailure), /private-body/u);

    if (process.platform === "win32") {
      const child = childProcess.spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        cwd: root,
        windowsHide: true,
        stdio: "ignore",
      });
      try {
        assert.ok(child.pid !== undefined);
        let startedAt: number | undefined;
        const deadline = Date.now() + 5_000;
        while (startedAt === undefined && Date.now() < deadline) {
          startedAt = driver.processStartTime(child.pid as number);
          if (startedAt === undefined) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.ok(startedAt !== undefined);
        fs.mkdirSync(cache, { recursive: true });
        fs.writeFileSync(path.join(cache, "native-processes.json"), `${JSON.stringify([{ pid: child.pid, startedAt }])}\n`, "utf8");
        await driver.cleanupNativeHost(input(root, "codex"));
        await new Promise<void>((resolve) => child.once("close", () => resolve()));
        assert.notEqual(child.exitCode, null);
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
