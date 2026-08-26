const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor" | "opencode";

function digest(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

interface CommandModule {
  executeCommand(argv: string[], dependencies: Record<string, unknown>): Promise<number>;
}

const commands = require("../../dist/cli/commands.cjs") as CommandModule;
const coreState = require("../../dist/core/state.cjs") as {
  createDesiredState(input: Record<string, unknown>): unknown;
};
const userSources = require("../../dist/hosts/user-sources.cjs") as {
  createNativeHostCapability(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
  createNativeCleanupPlan(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
  createSourceFinding(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
  createSourceScanResult(
    mode: string,
    findings: readonly Readonly<Record<string, unknown>>[],
    plans?: readonly Readonly<Record<string, unknown>>[],
  ): Readonly<Record<string, unknown>>;
};

function fixture(): { root: string; target: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cli-red-"));
  const target = path.join(root, "target");
  fs.mkdirSync(target);
  return { root, target };
}

const PUBLIC_CLI = path.resolve("dist/bin/kcoderag-nav.cjs");
const NAVIGATION = "kcoderag-navigation";
const JX3 = "jx3-style-nudge";

function runPublicCli(
  target: string,
  homeDirectory: string,
  args: readonly string[],
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = childProcess.spawnSync(
    process.execPath,
    [PUBLIC_CLI, ...args, "--target", target, "--yes", "--json"],
    {
      cwd: target,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeDirectory,
        USERPROFILE: homeDirectory,
        XDG_CONFIG_HOME: path.join(homeDirectory, ".config"),
      },
      timeout: 20_000,
      windowsHide: true,
    },
  );
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

function runInstalledClaudeLauncher(
  target: string,
  homeDirectory: string,
  sessionId: string,
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const launcher = path.join(
    target,
    ".claude",
    "kcoderag-nav",
    "qa",
    "hooks",
    process.platform === "win32" ? "run_hook.cmd" : "run_hook.sh",
  );
  const payload = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: "src/runtime-check.cpp", content: "int value = 1;\n" },
    session_id: sessionId,
  });
  const env = {
    ...process.env,
    HOME: homeDirectory,
    USERPROFILE: homeDirectory,
    XDG_CONFIG_HOME: path.join(homeDirectory, ".config"),
    KCODERAG_NAV_UPDATE_CHECK: "0",
  };
  const result = process.platform === "win32"
    ? childProcess.spawnSync(process.env.COMSPEC ?? "cmd.exe", ["/d", "/c", "call", launcher, "claude"], {
        cwd: target,
        input: `${payload}\n`,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        env,
      })
    : childProcess.spawnSync("/bin/sh", [launcher, "claude"], {
        cwd: target,
        input: `${payload}\n`,
        encoding: "utf8",
        timeout: 10_000,
        env,
      });
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

function parseOnlyJson(output: string): Record<string, any> {
  const lines = output.trim().split(/\r?\n/u).filter((line) => line.length > 0);
  assert.equal(lines.length, 1, `expected one JSON value, received: ${output}`);
  return JSON.parse(lines[0] as string) as Record<string, any>;
}

function installedCapabilities(target: string, host: "claude" | "codex"): readonly string[] {
  const statePath = host === "claude"
    ? ".claude/kcoderag-nav/install-state.json"
    : ".codex/kcoderag-nav/install-state.json";
  const state = JSON.parse(
    fs.readFileSync(path.join(target, ...statePath.split("/")), "utf8"),
  ) as { capabilities: readonly { id: string }[] };
  return state.capabilities.map((entry) => entry.id);
}

function projectSnapshot(target: string): readonly Readonly<Record<string, string | number>>[] {
  const records: Readonly<Record<string, string | number>>[] = [];
  const visit = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolutePath = path.join(directory, name);
      const stats = fs.lstatSync(absolutePath);
      if (stats.isDirectory()) visit(absolutePath);
      else if (stats.isFile()) {
        records.push(Object.freeze({
          path: path.relative(target, absolutePath).replaceAll("\\", "/"),
          digest: digest(fs.readFileSync(absolutePath)),
          mtimeMs: stats.mtimeMs,
        }));
      }
    }
  };
  visit(target);
  return Object.freeze(records);
}

function makeAdapter(
  host: HostId,
  calls: string[],
  options: { legacy?: boolean; legacyDev?: boolean } = {},
): Record<string, unknown> {
  return {
    id: host,
    managedRoots: [`.fixture-${host}`],
    detect(context: Record<string, unknown>) {
      calls.push(`${host}:detect`);
      return {
        host,
        target: context.target,
        ...(options.legacy
          ? { legacyUserRemoval: { path: path.join(os.tmpdir(), "legacy-kcoderag-nav") } }
          : {}),
        ...(options.legacyDev ? { legacyEnvironment: "dev" } : {}),
      };
    },
    renderInstall(context: Record<string, any>) {
      calls.push(
        `${host}:renderInstall:${String(context.allowLegacyUserRemoval)}:${String(context.allowLegacyDevMigration)}`,
      );
      const payloadPath = path.join(context.target.root, `.fixture-${host}/payload.txt`);
      const statePath = path.join(context.target.root, `.fixture-${host}/install-state.json`);
      const currentPayload = fs.existsSync(payloadPath) ? fs.readFileSync(payloadPath) : undefined;
      const currentState = fs.existsSync(statePath) ? fs.readFileSync(statePath) : undefined;
      return coreState.createDesiredState({
        host,
        target: context.target,
        managedRoots: [`.fixture-${host}`],
        statePath: `.fixture-${host}/install-state.json`,
        entries: [
          {
            relativePath: `.fixture-${host}/payload.txt`,
            expectedDigest: currentPayload === undefined ? null : digest(currentPayload),
            content: Buffer.from(`${host}:${String(context.command)}\n`, "utf8"),
          },
          {
            relativePath: `.fixture-${host}/install-state.json`,
            expectedDigest: currentState === undefined ? null : digest(currentState),
            content: Buffer.from('{"schemaVersion":1}\n', "utf8"),
          },
        ],
      });
    },
    renderUninstall(context: Record<string, any>) {
      calls.push(`${host}:renderUninstall`);
      const entries = ["payload.txt", "install-state.json"].map((name) => {
        const relativePath = `.fixture-${host}/${name}`;
        const absolutePath = path.join(context.target.root, ...relativePath.split("/"));
        const current = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath) : undefined;
        return {
          relativePath,
          expectedDigest: current === undefined ? null : digest(current),
          content: null,
        };
      });
      return coreState.createDesiredState({
        host,
        target: context.target,
        managedRoots: [`.fixture-${host}`],
        statePath: `.fixture-${host}/install-state.json`,
        entries,
      });
    },
    status(context: Record<string, unknown>) {
      calls.push(`${host}:status`);
      return {
        schemaVersion: 1,
        status: "not_installed",
        host,
        issues: [],
        target: context.target,
      };
    },
  };
}

function io(target: string, adapters: Readonly<Record<string, Record<string, unknown>>>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    dependencies: {
      cwd: target,
      packageRoot: path.resolve("."),
      nodeVersion: "22.0.0",
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
      confirmTarget: () => true,
      confirmLegacyUserRemoval: () => false,
      selectHost: () => "codex",
      getAdapter: (host: HostId) => {
        const adapter = adapters[host];
        if (adapter === undefined) throw new Error(`missing test adapter: ${host}`);
        return adapter;
      },
    },
  };
}

test("one explicit host selects one pure adapter and commits through shared desired state", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls),
    };
    const captured = io(item.target, adapters);
    const exitCode = await commands.executeCommand(
      ["install", "--host", "codex", "--capability", NAVIGATION, "--yes", "--json"],
      captured.dependencies,
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, ["codex:detect", "codex:renderInstall:false:false"]);
    assert.equal(
      fs.readFileSync(path.join(item.target, ".fixture-codex/payload.txt"), "utf8"),
      "codex:install\n",
    );
    assert.equal(fs.existsSync(path.join(item.target, ".fixture-claude")), false);
    assert.equal(fs.existsSync(path.join(item.target, ".fixture-cursor")), false);
    assert.equal(captured.stderr.length, 0);
    const output = JSON.parse(captured.stdout[0] ?? "") as Record<string, unknown>;
    assert.equal(output.ok, true);
    assert.equal(output.environment, "qa");
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("retired environment selectors refuse before adapter detection and preserve the target", async () => {
  for (const environment of ["qa", "dev"] as const) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const adapters = {
        codex: makeAdapter("codex", calls),
        claude: makeAdapter("claude", calls),
        cursor: makeAdapter("cursor", calls),
      };
      const captured = io(item.target, adapters);
      const before = fs.readdirSync(item.target);
      const exitCode = await commands.executeCommand(
        ["install", "--host", "codex", "--yes", "--json", "--environment", environment],
        captured.dependencies,
      );

      assert.equal(exitCode, 2);
      assert.deepEqual(calls, []);
      assert.deepEqual(fs.readdirSync(item.target), before);
      assert.equal(captured.stdout.length, 1);
      assert.equal(captured.stderr.length, 0);
      assert.equal(
        JSON.parse(captured.stdout[0] ?? "").error.code,
        "environment_selector_retired",
      );
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("JSON mutation without an explicit host refuses before adapter selection or writes", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls),
    };
    const captured = io(item.target, adapters);
    const before = fs.readdirSync(item.target);
    const exitCode = await commands.executeCommand(
      ["install", "--yes", "--json"],
      captured.dependencies,
    );

    assert.notEqual(exitCode, 0);
    assert.deepEqual(calls, []);
    assert.deepEqual(fs.readdirSync(item.target), before);
    assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, "host_required");
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("install and observation commands dispatch through the lifecycle seam without cross-host writes", async () => {
  for (const command of ["install"] as const) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const adapters = {
        codex: makeAdapter("codex", calls),
        claude: makeAdapter("claude", calls),
        cursor: makeAdapter("cursor", calls),
      };
      const captured = io(item.target, adapters);
      assert.equal(
        await commands.executeCommand(
          [command, "--host", "codex", "--capability", NAVIGATION, "--yes", "--json"],
          captured.dependencies,
        ),
        0,
      );
      assert.equal(captured.stderr.length, 0);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").command, command);
      assert.equal(calls[0], "codex:detect");
      assert.equal(calls[1], "codex:renderInstall:false:false");
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }

  for (const command of ["status", "doctor"] as const) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const secret = `opaque-mcp-${crypto.randomUUID()}`;
      const adapter = makeAdapter("claude", calls);
      const originalDetect = adapter.detect as (context: Record<string, unknown>) => Record<string, unknown>;
      adapter.detect = (context: Record<string, unknown>) => ({
        ...originalDetect(context),
        details: { secret },
      });
      const adapters = {
        codex: makeAdapter("codex", calls),
        claude: adapter,
        cursor: makeAdapter("cursor", calls),
      };
      const captured = io(item.target, adapters);
      const before = fs.readdirSync(item.target);
      assert.equal(
        await commands.executeCommand(
          [command, "--host", "claude", "--json"],
          { ...captured.dependencies, nodeVersion: "21.9.0" },
        ),
        0,
      );
      assert.deepEqual(calls, ["claude:detect", "claude:status"]);
      assert.deepEqual(fs.readdirSync(item.target), before);
      const output = captured.stdout.join("\n");
      assert.equal(JSON.parse(output).status, "invalid");
      assert.match(output, /unsupported_node/);
      assert.doesNotMatch(output, new RegExp(secret));
      assert.equal(captured.stderr.length, 0);
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("interactive selection uses the fixed host list, cwd/target confirmation, and cancellation", async () => {
  const item = fixture();
  try {
    const explicit = path.join(item.root, "explicit");
    fs.mkdirSync(explicit);
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls),
    };
    const captured = io(item.target, adapters);
    const hostLists: HostId[][] = [];
    const confirmations: Record<string, unknown>[] = [];
    const exitCode = await commands.executeCommand(
      ["install", "--target", explicit],
      {
        ...captured.dependencies,
        selectHost: (hosts: readonly HostId[]) => {
          hostLists.push([...hosts]);
          return "claude";
        },
        selectCapabilities: () => [NAVIGATION],
        confirmTarget: (request: Record<string, unknown>) => {
          confirmations.push(request);
          return false;
        },
      },
    );

    assert.equal(exitCode, 2);
    assert.deepEqual(hostLists, [["codex", "claude", "cursor", "opencode"]]);
    assert.equal(confirmations[0]?.target, fs.realpathSync(explicit));
    assert.equal("environment" in (confirmations[0] ?? {}), false);
    assert.deepEqual(calls, []);
    assert.equal(fs.readdirSync(explicit).length, 0);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("selected-host global targets fail before adapter detection while other-host directories remain legal", async () => {
  const item = fixture();
  try {
    const home = path.join(item.root, "home");
    const codexRoot = path.join(home, ".codex");
    const codexCache = path.join(codexRoot, "plugins", "cache");
    const claudeProject = path.join(home, ".claude", "project");
    fs.mkdirSync(codexCache, { recursive: true });
    fs.mkdirSync(claudeProject, { recursive: true });
    const globalRoots = (host: HostId): readonly string[] => [path.join(home, `.${host}`)];

    for (const unsafe of [home, codexRoot, codexCache]) {
      const calls: string[] = [];
      const adapters = {
        codex: makeAdapter("codex", calls),
        claude: makeAdapter("claude", calls),
        cursor: makeAdapter("cursor", calls),
      };
      const captured = io(unsafe, adapters);
      const before = fs.readdirSync(unsafe);
      assert.equal(
        await commands.executeCommand(
          ["install", "--host", "codex", "--capability", NAVIGATION, "--yes", "--json"],
          { ...captured.dependencies, homeDirectory: home, hostGlobalRoots: globalRoots },
        ),
        1,
      );
      assert.deepEqual(calls, []);
      assert.deepEqual(fs.readdirSync(unsafe), before);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, "unsafe_target");
    }

    const legalCalls: string[] = [];
    const legalAdapters = {
      codex: makeAdapter("codex", legalCalls),
      claude: makeAdapter("claude", legalCalls),
      cursor: makeAdapter("cursor", legalCalls),
    };
    const legal = io(claudeProject, legalAdapters);
    assert.equal(
      await commands.executeCommand(
        ["install", "--host", "codex", "--capability", NAVIGATION, "--yes", "--json"],
        { ...legal.dependencies, homeDirectory: home, hostGlobalRoots: globalRoots },
      ),
      0,
    );
    assert.deepEqual(legalCalls, ["codex:detect", "codex:renderInstall:false:false"]);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("Node below 22 rejects mutations before adapter work while read-only commands still report", async () => {
  const item = fixture();
  try {
    for (const command of ["install", "update", "uninstall"] as const) {
      const calls: string[] = [];
      const adapters = {
        codex: makeAdapter("codex", calls),
        claude: makeAdapter("claude", calls),
        cursor: makeAdapter("cursor", calls),
      };
      const captured = io(item.target, adapters);
      assert.equal(
        await commands.executeCommand(
          [
            command,
            "--host",
            "codex",
            ...(command === "uninstall" ? ["--all"] : ["--capability", NAVIGATION]),
            "--yes",
            "--json",
          ],
          { ...captured.dependencies, nodeVersion: "20.19.0" },
        ),
        1,
      );
      assert.deepEqual(calls, []);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, "unsupported_node");
    }
    assert.equal(fs.readdirSync(item.target).length, 0);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("machine output and exit codes are stable and redact unexpected adapter failures", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls),
    };

    const invalid = io(item.target, adapters);
    assert.equal(
      await commands.executeCommand(
        ["install", "--host", "windsurf", "--yes", "--json"],
        invalid.dependencies,
      ),
      2,
    );
    assert.equal(invalid.stdout.length, 1);
    assert.equal(invalid.stderr.length, 0);
    assert.equal(JSON.parse(invalid.stdout[0] ?? "").error.code, "unsupported_host");

    const confirmation = io(item.target, adapters);
    assert.equal(
      await commands.executeCommand(
        ["install", "--host", "codex", "--capability", NAVIGATION, "--json"],
        confirmation.dependencies,
      ),
      2,
    );
    assert.equal(confirmation.stdout.length, 1);
    assert.equal(confirmation.stderr.length, 0);
    assert.equal(
      JSON.parse(confirmation.stdout[0] ?? "").error.code,
      "confirmation_required",
    );

    const secret = `Bearer-${crypto.randomUUID()}`;
    const failed = io(item.target, adapters);
    assert.equal(
      await commands.executeCommand(
        ["status", "--host", "codex", "--json"],
        {
          ...failed.dependencies,
          getAdapter: () => ({
            ...makeAdapter("codex", calls),
            detect: () => {
              throw new Error(secret);
            },
          }),
        },
      ),
      1,
    );
    assert.equal(failed.stdout.length, 1);
    assert.equal(failed.stderr.length, 0);
    assert.equal(JSON.parse(failed.stdout[0] ?? "").error.code, "command_failed");
    assert.doesNotMatch(failed.stdout[0] ?? "", new RegExp(secret));
    assert.deepEqual(calls, []);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("human mutation verbs are stable and read-only commands reject retired authority", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls),
    };
    const installed = io(item.target, adapters);
    assert.equal(
      await commands.executeCommand(
        ["install", "--host", "codex", "--capability", NAVIGATION, "--yes"],
        installed.dependencies,
      ),
      0,
    );
    assert.match(installed.stdout[0] ?? "", /^installed: codex at /);
    assert.doesNotMatch(installed.stdout[0] ?? "", /\/(?:qa|dev)\b/i);
    assert.equal(installed.stderr.length, 0);

    const readOnly = io(item.target, adapters);
    assert.equal(
      await commands.executeCommand(
        ["status", "--host", "cursor", "--json", "--allow-legacy-user-removal"],
        readOnly.dependencies,
      ),
      2,
    );
    assert.equal(
      JSON.parse(readOnly.stdout[0] ?? "").error.code,
      "invalid_arguments",
    );
    assert.equal(readOnly.stderr.length, 0);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

function sourceConflict(): { readonly finding: Readonly<Record<string, unknown>> } {
  return {
    finding: userSources.createSourceFinding({
      code: "raw_mcp_source",
      severity: "conflict",
      sourceType: "raw_mcp",
      scope: "user",
      safePath: ".codex/mcp",
    }),
  };
}

test("status is fast, doctor is deep and read-only, and top-level health follows source conflicts", async () => {
  for (const command of ["status", "doctor"] as const) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const adapter = makeAdapter("codex", calls);
      adapter.scanUserSources = (context: Record<string, unknown>) => {
        calls.push(`codex:scan:${String(context.mode)}`);
        const conflict = sourceConflict();
        return userSources.createSourceScanResult(String(context.mode), [conflict.finding]);
      };
      const adapters = { codex: adapter, claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls) };
      const captured = io(item.target, adapters);
      const before = fs.readdirSync(item.target);
      const exitCode = await commands.executeCommand(
        [command, "--host", "codex", "--json"],
        captured.dependencies,
      );
      assert.equal(exitCode, 1);
      assert.deepEqual(calls, ["codex:detect", `codex:scan:${command === "status" ? "fast" : "deep"}`, "codex:status"]);
      assert.deepEqual(fs.readdirSync(item.target), before);
      const output = JSON.parse(captured.stdout[0] ?? "") as Record<string, any>;
      assert.equal(output.ok, false);
      assert.equal(output.status, "source_conflict");
      assert.equal(output.findings[0].code, "raw_mcp_source");
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("doctor reports deep preinstall readiness while ordinary not-installed remains successful", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapter = makeAdapter("codex", calls);
    adapter.scanUserSources = (context: Record<string, unknown>) => {
      calls.push(`codex:scan:${String(context.mode)}`);
      const residue = userSources.createSourceFinding({
        code: "cache_residue",
        severity: "info",
        sourceType: "cache_residue",
        scope: "user",
        safePath: ".codex/plugins/cache/kcoderag-nav",
        cleanupEligible: false,
      });
      return userSources.createSourceScanResult(String(context.mode), [residue]);
    };
    const captured = io(item.target, { codex: adapter, claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls) });
    assert.equal(await commands.executeCommand(["doctor", "--host", "codex", "--json"], captured.dependencies), 0);
    assert.deepEqual(calls, ["codex:detect", "codex:scan:deep", "codex:status"]);
    const output = JSON.parse(captured.stdout[0] ?? "") as Record<string, any>;
    assert.equal(output.ok, true);
    assert.equal(output.status, "not_installed");
    assert.equal(output.findings[0].severity, "info");
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("install, update, and uninstall share one full no-write source gate", async () => {
  for (const command of ["install", "update", "uninstall"] as const) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const adapter = makeAdapter("codex", calls);
      adapter.scanUserSources = (context: Record<string, unknown>) => {
        calls.push(`codex:scan:${String(context.mode)}`);
        const conflict = sourceConflict();
        return userSources.createSourceScanResult(String(context.mode), [conflict.finding]);
      };
      const captured = io(item.target, { codex: adapter, claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls) });
      const before = fs.readdirSync(item.target);
      assert.equal(await commands.executeCommand([
        command, "--host", "codex", "--yes", "--json", "--capability", NAVIGATION,
      ], captured.dependencies), 1);
      assert.deepEqual(calls, ["codex:detect", "codex:scan:gate"]);
      assert.deepEqual(fs.readdirSync(item.target), before);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, "source_conflict");
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }

});

test("source diagnosis invokes only the selected host and never lets another host conflict block it", async () => {
  for (const selected of ["codex", "claude", "cursor"] as const) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const adapters = {
        codex: makeAdapter("codex", calls),
        claude: makeAdapter("claude", calls),
        cursor: makeAdapter("cursor", calls),
      };
      for (const host of ["codex", "claude", "cursor"] as const) {
        adapters[host].scanUserSources = (context: Record<string, unknown>) => {
          calls.push(`${host}:scan:${String(context.mode)}`);
          return host === selected
            ? userSources.createSourceScanResult(String(context.mode), [])
            : userSources.createSourceScanResult(String(context.mode), [sourceConflict().finding]);
        };
      }
      const captured = io(item.target, adapters);
      assert.equal(
        await commands.executeCommand(
          ["install", "--host", selected, "--yes", "--json", "--capability", NAVIGATION],
          captured.dependencies,
        ),
        0,
      );
      assert.deepEqual(calls, [
        `${selected}:detect`,
        `${selected}:scan:gate`,
        `${selected}:renderInstall:false:false`,
      ]);
      for (const sibling of ["codex", "claude", "cursor"].filter((host) => host !== selected)) {
        assert.equal(fs.existsSync(path.join(item.target, `.fixture-${sibling}`)), false);
      }
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("retired migration and cleanup flags are rejected before detection", async () => {
  for (const argv of [
    ["install", "--host", "codex", "--yes", "--json", "--allow-legacy-dev-migration"],
    ["uninstall", "--host", "cursor", "--yes", "--json", "--allow-legacy-user-removal"],
    ["status", "--host", "codex", "--json", "--allow-owned-source-cleanup"],
    ["doctor", "--host", "codex", "--json", "--cleanup-fingerprint", `sha256:${"0".repeat(64)}`],
    ["doctor", "--host", "codex", "--json", "--fix"],
  ]) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const captured = io(item.target, { codex: makeAdapter("codex", calls), claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls) });
      assert.equal(await commands.executeCommand(argv, captured.dependencies), 2);
      assert.deepEqual(calls, []);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, "invalid_arguments");
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("repeatable capability selection is canonical and interactive selection follows host selection", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapter = makeAdapter("claude", calls);
    const originalRender = adapter.renderInstall as (context: Record<string, any>) => unknown;
    adapter.renderInstall = (context: Record<string, any>) => {
      calls.push(`selected:${(context.selectedCapabilities as readonly string[]).join(",")}`);
      return originalRender(context);
    };
    const captured = io(item.target, {
      codex: makeAdapter("codex", calls), claude: adapter, cursor: makeAdapter("cursor", calls),
    });
    const order: string[] = [];
    assert.equal(await commands.executeCommand(
      ["install", "--yes", "--capability", JX3, "--capability", NAVIGATION, "--capability", JX3],
      {
        ...captured.dependencies,
        selectHost: () => { order.push("host"); return "claude"; },
        selectCapabilities: () => { order.push("capabilities"); return [JX3, NAVIGATION]; },
      },
    ), 0);
    assert.deepEqual(order, ["host"]);
    assert.equal(calls.join("\n").includes(`selected:${NAVIGATION},${JX3}`), true);

    const interactive = fixture();
    try {
      const interactiveCalls: string[] = [];
      const interactiveAdapter = makeAdapter("claude", interactiveCalls);
      const interactiveRender = interactiveAdapter.renderInstall as (context: Record<string, any>) => unknown;
      interactiveAdapter.renderInstall = (context: Record<string, any>) => {
        interactiveCalls.push(`selected:${(context.selectedCapabilities as readonly string[]).join(",")}`);
        return interactiveRender(context);
      };
      const interactiveIo = io(interactive.target, {
        codex: makeAdapter("codex", interactiveCalls),
        claude: interactiveAdapter,
        cursor: makeAdapter("cursor", interactiveCalls),
      });
      const interactiveOrder: string[] = [];
      assert.equal(await commands.executeCommand(["install", "--yes"], {
        ...interactiveIo.dependencies,
        selectHost: () => { interactiveOrder.push("host"); return "claude"; },
        selectCapabilities: (ids: readonly string[]) => {
          interactiveOrder.push(`capabilities:${ids.join(",")}`);
          return [JX3, NAVIGATION];
        },
      }), 0);
      assert.deepEqual(interactiveOrder, ["host", `capabilities:${NAVIGATION},${JX3}`]);
      assert.equal(interactiveCalls.join("\n").includes(`selected:${NAVIGATION},${JX3}`), true);
    } finally {
      fs.rmSync(interactive.root, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("compiled public CLI installs Claude capabilities additively in both orders", () => {
  for (const order of [[NAVIGATION, JX3], [JX3, NAVIGATION]] as const) {
    const item = fixture();
    const homeDirectory = path.join(item.root, "home");
    fs.mkdirSync(homeDirectory);
    try {
      for (const capability of order) {
        const result = runPublicCli(item.target, homeDirectory, [
          "install", "--host", "claude", "--capability", capability,
        ]);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(parseOnlyJson(result.stdout).ok, true);
      }
      assert.deepEqual(installedCapabilities(item.target, "claude"), [NAVIGATION, JX3]);
      assert.equal(fs.existsSync(path.join(item.target, ".claude/skills/kcoderag-nav/SKILL.md")), true);
      assert.equal(fs.existsSync(path.join(item.target, ".claude/skills/jx3-code-style-correction/SKILL.md")), true);
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("installed Claude launcher keeps JX3 operational without the navigation runtime", () => {
  for (const lifecycle of ["jx3-only", "navigation-removed"] as const) {
    const item = fixture();
    const homeDirectory = path.join(item.root, "home");
    fs.mkdirSync(homeDirectory);
    try {
      const initialCapabilities = lifecycle === "jx3-only" ? [JX3] : [NAVIGATION, JX3];
      const installed = runPublicCli(item.target, homeDirectory, [
        "install",
        "--host",
        "claude",
        ...initialCapabilities.flatMap((capability) => ["--capability", capability]),
      ]);
      assert.equal(installed.status, 0, installed.stderr || installed.stdout);
      if (lifecycle === "navigation-removed") {
        const removed = runPublicCli(item.target, homeDirectory, [
          "uninstall", "--host", "claude", "--capability", NAVIGATION,
        ]);
        assert.equal(removed.status, 0, removed.stderr || removed.stdout);
      }

      assert.deepEqual(installedCapabilities(item.target, "claude"), [JX3]);
      assert.equal(
        fs.existsSync(path.join(item.target, ".claude/kcoderag-nav/qa/hooks/grep-nudge.cjs")),
        false,
      );
      const launched = runInstalledClaudeLauncher(
        item.target,
        homeDirectory,
        `cr01-${lifecycle}-${crypto.randomUUID()}`,
      );
      assert.equal(launched.status, 0, launched.stderr || launched.stdout);
      assert.equal(launched.stderr, "");
      const output = parseOnlyJson(launched.stdout);
      assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
      assert.match(output.hookSpecificOutput.additionalContext, /\$jx3-code-style-correction/u);
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("duplicate additive install is byte and mtime stable without a transaction write", () => {
  const item = fixture();
  const homeDirectory = path.join(item.root, "home");
  fs.mkdirSync(homeDirectory);
  try {
    const first = runPublicCli(item.target, homeDirectory, [
      "install", "--host", "claude", "--capability", NAVIGATION, "--capability", JX3,
    ]);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const before = projectSnapshot(item.target);
    const repeated = runPublicCli(item.target, homeDirectory, [
      "install", "--host", "claude", "--capability", JX3, "--capability", NAVIGATION,
    ]);
    assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
    const output = parseOnlyJson(repeated.stdout);
    assert.equal(output.changed, false, JSON.stringify(output.changedPaths));
    assert.deepEqual(output.changedPaths, []);
    assert.deepEqual(projectSnapshot(item.target), before);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("unsupported second capability add is zero-write and preserves the healthy first capability", () => {
  const item = fixture();
  const homeDirectory = path.join(item.root, "home");
  fs.mkdirSync(homeDirectory);
  try {
    const first = runPublicCli(item.target, homeDirectory, [
      "install", "--host", "codex", "--capability", NAVIGATION,
    ]);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const before = projectSnapshot(item.target);
    const refused = runPublicCli(item.target, homeDirectory, [
      "install", "--host", "codex", "--capability", JX3,
    ]);
    assert.equal(refused.status, 1, refused.stderr || refused.stdout);
    assert.equal(parseOnlyJson(refused.stdout).error.code, "host_version_unsupported");
    assert.deepEqual(installedCapabilities(item.target, "codex"), [NAVIGATION]);
    assert.deepEqual(projectSnapshot(item.target), before);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("update defaults to installed capabilities and filters cannot install an absent capability", () => {
  const item = fixture();
  const homeDirectory = path.join(item.root, "home");
  fs.mkdirSync(homeDirectory);
  try {
    const installed = runPublicCli(item.target, homeDirectory, [
      "install", "--host", "claude", "--capability", NAVIGATION, "--capability", JX3,
    ]);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    const beforeUpdate = projectSnapshot(item.target);
    const updated = runPublicCli(item.target, homeDirectory, ["update", "--host", "claude"]);
    assert.equal(updated.status, 0, updated.stderr || updated.stdout);
    const updateOutput = parseOnlyJson(updated.stdout);
    assert.deepEqual(updateOutput.capabilities, [NAVIGATION, JX3]);
    assert.equal(updateOutput.changed, false);
    assert.deepEqual(projectSnapshot(item.target), beforeUpdate);

    const separate = fixture();
    const separateHome = path.join(separate.root, "home");
    fs.mkdirSync(separateHome);
    try {
      assert.equal(runPublicCli(separate.target, separateHome, [
        "install", "--host", "claude", "--capability", NAVIGATION,
      ]).status, 0);
      const before = projectSnapshot(separate.target);
      const refused = runPublicCli(separate.target, separateHome, [
        "update", "--host", "claude", "--capability", JX3,
      ]);
      assert.equal(refused.status, 1, refused.stderr || refused.stdout);
      assert.equal(parseOnlyJson(refused.stdout).error.code, "capability_not_installed");
      assert.deepEqual(projectSnapshot(separate.target), before);
    } finally {
      fs.rmSync(separate.root, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("status and doctor report every built-in capability without writing", () => {
  const item = fixture();
  const homeDirectory = path.join(item.root, "home");
  fs.mkdirSync(homeDirectory);
  try {
    assert.equal(runPublicCli(item.target, homeDirectory, [
      "install", "--host", "claude", "--capability", NAVIGATION,
    ]).status, 0);
    const before = projectSnapshot(item.target);
    for (const command of ["status", "doctor"] as const) {
      const result = runPublicCli(item.target, homeDirectory, [command, "--host", "claude"]);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = parseOnlyJson(result.stdout);
      assert.deepEqual(output.capabilities, [
        { id: NAVIGATION, installed: true, status: "healthy" },
        { id: JX3, installed: false, status: "not_installed" },
      ]);
      assert.deepEqual(projectSnapshot(item.target), before);
    }
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("status reports conservative per-capability drift and doctor reports stale lock cleanup guidance", async () => {
  const item = fixture();
  const homeDirectory = path.join(item.root, "home");
  const mutationLockRoot = path.join(item.root, "locks");
  fs.mkdirSync(homeDirectory);
  try {
    assert.equal(runPublicCli(item.target, homeDirectory, [
      "install", "--host", "claude", "--capability", NAVIGATION, "--capability", JX3,
    ]).status, 0);
    const state = JSON.parse(fs.readFileSync(
      path.join(item.target, ".claude/kcoderag-nav/install-state.json"),
      "utf8",
    )) as { files: readonly { path: string; contributors: readonly string[] }[] };
    const jx3File = state.files.find((record) => record.contributors.includes(JX3));
    assert.notEqual(jx3File, undefined);
    fs.appendFileSync(path.join(item.target, ...(jx3File?.path.split("/") ?? [])), "drift\n");

    const drifted = runPublicCli(item.target, homeDirectory, ["status", "--host", "claude"]);
    assert.equal(drifted.status, 0, drifted.stderr || drifted.stdout);
    const driftOutput = parseOnlyJson(drifted.stdout);
    assert.equal(driftOutput.status, "drifted");
    assert.deepEqual(driftOutput.capabilities, [
      { id: NAVIGATION, installed: null, status: "capability_drift" },
      { id: JX3, installed: null, status: "capability_drift" },
    ]);

    const child = childProcess.spawnSync(process.execPath, [
      "-e",
      "require(process.env.LOCK_MODULE).acquireMutationLock({host:'claude',targetRoot:process.env.LOCK_TARGET,lockRoot:process.env.LOCK_ROOT});",
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        LOCK_MODULE: path.resolve("dist/core/mutation-lock.cjs"),
        LOCK_TARGET: item.target,
        LOCK_ROOT: mutationLockRoot,
      },
      windowsHide: true,
    });
    assert.equal(child.status, 0, child.stderr);
    const output: string[] = [];
    const exitCode = await commands.executeCommand([
      "doctor", "--host", "claude", "--json",
    ], {
      ...io(item.target, {
        codex: makeAdapter("codex", []),
        claude: makeAdapter("claude", []),
        cursor: makeAdapter("cursor", []),
      }).dependencies,
      mutationLockRoot,
      stdout: (text: string) => output.push(text),
    });
    assert.equal(exitCode, 0);
    const doctorOutput = parseOnlyJson(output[0] ?? "");
    assert.equal(doctorOutput.maintenance.mutationLock.status, "stale");
    assert.equal(doctorOutput.maintenance.manualCleanupRequired, true);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("uninstall is explicit, recomposes a subset, and --all removes the final capability", () => {
  const item = fixture();
  const homeDirectory = path.join(item.root, "home");
  fs.mkdirSync(homeDirectory);
  try {
    assert.equal(runPublicCli(item.target, homeDirectory, [
      "install", "--host", "claude", "--capability", NAVIGATION, "--capability", JX3,
    ]).status, 0);
    const missing = runPublicCli(item.target, homeDirectory, ["uninstall", "--host", "claude"]);
    assert.equal(missing.status, 2, missing.stderr || missing.stdout);
    assert.equal(parseOnlyJson(missing.stdout).error.code, "capability_selection_required");
    assert.deepEqual(installedCapabilities(item.target, "claude"), [NAVIGATION, JX3]);

    const partial = runPublicCli(item.target, homeDirectory, [
      "uninstall", "--host", "claude", "--capability", JX3,
    ]);
    assert.equal(partial.status, 0, partial.stderr || partial.stdout);
    assert.deepEqual(parseOnlyJson(partial.stdout).capabilities, [NAVIGATION]);
    assert.deepEqual(installedCapabilities(item.target, "claude"), [NAVIGATION]);

    const final = runPublicCli(item.target, homeDirectory, ["uninstall", "--host", "claude", "--all"]);
    assert.equal(final.status, 0, final.stderr || final.stdout);
    assert.deepEqual(parseOnlyJson(final.stdout).capabilities, []);
    assert.equal(fs.existsSync(path.join(item.target, ".claude/kcoderag-nav/install-state.json")), false);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("parallel mutation loser is target_busy before scan or render", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapter = makeAdapter("codex", calls);
    let releaseScan: (() => void) | undefined;
    const scanBlocked = new Promise<void>((resolve) => { releaseScan = resolve; });
    let firstScanStarted: (() => void) | undefined;
    const firstScan = new Promise<void>((resolve) => { firstScanStarted = resolve; });
    adapter.scanUserSources = async () => {
      calls.push("scan");
      firstScanStarted?.();
      await scanBlocked;
      return userSources.createSourceScanResult("gate", []);
    };
    const captured = io(item.target, {
      codex: adapter, claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls),
    });
    const mutationLockRoot = path.join(item.root, "locks");
    const first = commands.executeCommand([
      "install", "--host", "codex", "--capability", NAVIGATION, "--yes", "--json",
    ], { ...captured.dependencies, mutationLockRoot });
    await firstScan;
    const loserOutput: string[] = [];
    const loser = await commands.executeCommand([
      "install", "--host", "codex", "--capability", NAVIGATION, "--yes", "--json",
    ], {
      ...captured.dependencies,
      mutationLockRoot,
      stdout: (text: string) => loserOutput.push(text),
    });
    assert.equal(loser, 1);
    assert.equal(parseOnlyJson(loserOutput[0] as string).error.code, "target_busy");
    assert.deepEqual(calls, ["codex:detect", "scan"]);
    releaseScan?.();
    assert.equal(await first, 0);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});
