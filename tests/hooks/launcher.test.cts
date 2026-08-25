const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const sourceHooks = path.resolve("plugin-src/hooks");
const compiledHook = path.resolve("dist/hooks/grep-nudge.cjs");
const projectRoot = require("../../dist/core/project-root.cjs") as {
  findNearestProjectHook(options: {
    readonly cwd: string;
    readonly host: "codex" | "claude";
    readonly stateRelativePath: string;
    readonly launcherRelativePath: string;
    readonly maxAncestors?: number;
  }): { readonly projectRoot: string; readonly launcherPath: string } | undefined;
};
const targets = require("../../dist/core/project-target.cjs") as {
  resolveProjectTarget(target: string): Record<string, unknown>;
};
const transaction = require("../../dist/core/transaction.cjs") as {
  applyTransaction(desired: Record<string, unknown>): unknown;
};
const codex = require("../../dist/hosts/codex.cjs") as {
  codexAdapter: Record<string, any>;
};
const claude = require("../../dist/hosts/claude.cjs") as {
  claudeAdapter: Record<string, any>;
};
const structuralPayload = JSON.stringify({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "rg KPlayer::GetLevel src" },
});

interface Deployment {
  readonly root: string;
  readonly hooks: string;
  readonly cwd: string;
}

function sha256(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function write(root: string, relativePath: string, value: string | Buffer): string {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, value);
  return destination;
}

function managedProject(
  root: string,
  host: "codex" | "claude",
  launcherName: string = process.platform === "win32" ? "run_hook.cmd" : "run_hook.sh",
  marker: string = host,
): { readonly statePath: string; readonly launcherPath: string } {
  const hostRoot = host === "codex" ? ".codex" : ".claude";
  const stateRelativePath = `${hostRoot}/kcoderag-nav/install-state.json`;
  const launcherRelativePath = `${hostRoot}/kcoderag-nav/qa/hooks/${launcherName}`;
  const launcher = Buffer.from(`${marker}\n`, "utf8");
  const launcherPath = write(root, launcherRelativePath, launcher);
  const statePath = write(root, stateRelativePath, `${JSON.stringify({
    schemaVersion: 1,
    packageVersion: "0.2.0",
    host,
    environment: "qa",
    managedFiles: [launcherRelativePath, stateRelativePath],
    originals: {},
    digests: { [launcherRelativePath]: sha256(launcher) },
  })}\n`);
  return { statePath, launcherPath };
}

function discoveryOptions(
  cwd: string,
  host: "codex" | "claude",
  launcherName = process.platform === "win32" ? "run_hook.cmd" : "run_hook.sh",
) {
  const hostRoot = host === "codex" ? ".codex" : ".claude";
  return {
    cwd,
    host,
    stateRelativePath: `${hostRoot}/kcoderag-nav/install-state.json`,
    launcherRelativePath: `${hostRoot}/kcoderag-nav/qa/hooks/${launcherName}`,
  } as const;
}

function adapterPackage(base: string): string {
  const root = path.join(base, "package");
  write(root, "package.json", `${JSON.stringify({ name: "kcoderag-nav", version: "0.2.0" })}\n`);
  write(root, "kcoderag-qa/.codex.mcp.json", `${JSON.stringify({
    mcpServers: {
      "kcoderag-qa": {
        url: "https://qa.invalid/mcp",
        http_headers: { Authorization: "opaque-test-value" },
      },
    },
  })}\n`);
  write(root, "kcoderag-qa/.mcp.json", `${JSON.stringify({
    mcpServers: {
      "kcoderag-qa": {
        type: "http",
        url: "https://qa.invalid/mcp",
        headers: { Authorization: "opaque-test-value" },
      },
    },
  })}\n`);
  write(root, "kcoderag-qa/skills/code-lookup-discipline/SKILL.md", "# QA lookup\n");
  for (const asset of [
    "grep-nudge.cjs",
    "run_hook.cmd",
    "run_hook.sh",
    "update-check.cjs",
    "update-worker.cjs",
  ]) {
    const source = path.resolve("kcoderag-qa", "hooks", asset);
    write(root, `kcoderag-qa/hooks/${asset}`, fs.readFileSync(source));
  }
  return root;
}

interface InstalledCommand {
  readonly command: string;
  readonly commandWindows: string;
}

function installHost(
  base: string,
  host: "codex" | "claude",
  packageRoot: string,
): { readonly root: string; readonly command: InstalledCommand } {
  const root = path.join(base, `${host}-project`);
  fs.mkdirSync(root);
  const target = targets.resolveProjectTarget(root);
  const adapter = host === "codex" ? codex.codexAdapter : claude.claudeAdapter;
  const observation = adapter.detect({ target, packageRoot });
  const desired = adapter.renderInstall({
    target,
    packageRoot,
    command: "install",
    environment: "qa",
    observation,
    allowLegacyUserRemoval: false,
    allowLegacyDevMigration: false,
  });
  transaction.applyTransaction(desired);
  const settingsPath = host === "codex" ? ".codex/hooks.json" : ".claude/settings.json";
  const document = JSON.parse(fs.readFileSync(path.join(root, ...settingsPath.split("/")), "utf8"));
  const entries = document.hooks.PreToolUse as readonly Record<string, any>[];
  const entry = entries.find((candidate) =>
    JSON.stringify(candidate).includes("Checking code lookup strategy"));
  const command = entry?.hooks?.[0] as InstalledCommand | undefined;
  assert.ok(command);
  return { root, command };
}

function runRenderedWindows(
  command: string,
  cwd: string,
  input = structuralPayload,
  env = environment(),
): ReturnType<typeof childProcess.spawnSync> {
  const comspec = process.env.COMSPEC ?? "cmd.exe";
  return childProcess.spawnSync(comspec, ["/d", "/c", command], {
    cwd,
    input: `${input}\n`,
    encoding: "utf8",
    timeout: 7_000,
    env,
  });
}

function runRenderedPosix(
  shellExecutable: string,
  command: string,
  cwd: string,
  input = structuralPayload,
  env = environment(),
): ReturnType<typeof childProcess.spawnSync> {
  return childProcess.spawnSync(shellExecutable, ["-c", command], {
    cwd,
    input,
    encoding: "utf8",
    timeout: 7_000,
    env,
  });
}

function deployment(): Deployment {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-launcher-"));
  const hooks = path.join(root, "插件 with spaces", "hooks");
  const cwd = path.join(root, "nested cwd", "子目录");
  fs.mkdirSync(hooks, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  for (const name of ["run_hook.cmd", "run_hook.sh"]) {
    fs.copyFileSync(path.join(sourceHooks, name), path.join(hooks, name));
  }
  fs.copyFileSync(compiledHook, path.join(hooks, "grep-nudge.cjs"));
  return { root, hooks, cwd };
}

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KCODERAG_NAV_UPDATE_CHECK: "0",
    ...overrides,
  };
}

function runWindows(
  fixture: Deployment,
  input = structuralPayload,
  env = environment(),
): ReturnType<typeof childProcess.spawnSync> {
  const comspec = process.env.COMSPEC ?? "cmd.exe";
  return childProcess.spawnSync(
    comspec,
    ["/d", "/c", "call", path.join(fixture.hooks, "run_hook.cmd")],
    { cwd: fixture.cwd, input: `${input}\n`, encoding: "utf8", timeout: 5_000, env },
  );
}

function posixShell(): string | undefined {
  for (const candidate of process.platform === "win32"
    ? ["C:/Program Files/Git/bin/sh.exe", "C:/Program Files/Git/usr/bin/sh.exe"]
    : ["/bin/sh", "/usr/bin/sh"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function runPosix(
  shell: string,
  fixture: Deployment,
  input = structuralPayload,
  env = environment(),
): ReturnType<typeof childProcess.spawnSync> {
  return childProcess.spawnSync(shell, [path.join(fixture.hooks, "run_hook.sh")], {
    cwd: fixture.cwd,
    input,
    encoding: "utf8",
    timeout: 5_000,
    env,
  });
}

function assertProtocolResult(result: ReturnType<typeof childProcess.spawnSync>): void {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, String(result.stderr));
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(String(result.stdout)) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  assert.equal(parsed.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(parsed.hookSpecificOutput.additionalContext, /Structural lookup/);
}

function assertSilentSuccess(result: ReturnType<typeof childProcess.spawnSync>): void {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, String(result.stderr));
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
}

test("hook registration is limited to the required PreToolUse tools and launchers", () => {
  const registration = JSON.parse(fs.readFileSync(path.join(sourceHooks, "hooks.json"), "utf8")) as {
    hooks: Record<string, readonly {
      matcher: string;
      hooks: readonly { command: string; commandWindows: string }[];
    }[]>;
  };
  assert.deepEqual(Object.keys(registration.hooks), ["PreToolUse"]);
  assert.equal(registration.hooks.PreToolUse?.length, 1);
  assert.equal(registration.hooks.PreToolUse?.[0]?.matcher, "^(Grep|Glob|Bash)$");
  assert.match(registration.hooks.PreToolUse?.[0]?.hooks[0]?.command ?? "", /run_hook\.sh/);
  assert.match(registration.hooks.PreToolUse?.[0]?.hooks[0]?.commandWindows ?? "", /run_hook\.cmd/);
  assert.match(registration.hooks.PreToolUse?.[0]?.hooks[0]?.command ?? "", /install-state\.json/);
  assert.match(registration.hooks.PreToolUse?.[0]?.hooks[0]?.commandWindows ?? "", /install-state\.json/);
  assert.doesNotMatch(JSON.stringify(registration), /CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT/);

  for (const launcher of ["run_hook.cmd", "run_hook.sh"]) {
    const source = fs.readFileSync(path.join(sourceHooks, launcher), "utf8");
    assert.match(source, /grep-nudge\.cjs/);
    assert.match(source, />= 22/);
    assert.doesNotMatch(source, /python|grep_nudge\.py|https?:|curl|wget/iu);
    assert.doesNotMatch(source, /CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT/iu);
    assert.doesNotMatch(source, /%CD%|\$PWD/iu);
  }
});

test("installed Codex and Claude commands run from project root and a Unicode deep child", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-rendered-command-"));
  try {
    const packageRoot = adapterPackage(base);
    for (const host of ["codex", "claude"] as const) {
      const installed = installHost(base, host, packageRoot);
      const deep = path.join(installed.root, "workspace with spaces", "子目录", "src");
      fs.mkdirSync(deep, { recursive: true });
      if (process.platform === "win32") {
        assertProtocolResult(runRenderedWindows(installed.command.commandWindows, installed.root));
        assertProtocolResult(runRenderedWindows(installed.command.commandWindows, deep));
      }
      const shellExecutable = posixShell();
      if (shellExecutable !== undefined) {
        assertProtocolResult(runRenderedPosix(shellExecutable, installed.command.command, installed.root));
        assertProtocolResult(runRenderedPosix(shellExecutable, installed.command.command, deep));
      }
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("nearest-state discovery selects the first valid selected-host boundary", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-root-nearest-"));
  try {
    const outer = path.join(base, "outer");
    const inner = path.join(outer, "packages", "inner");
    const deep = path.join(inner, "Unicode 空格", "src");
    fs.mkdirSync(deep, { recursive: true });
    managedProject(outer, "codex", undefined, "outer");
    const nearest = managedProject(inner, "codex", undefined, "inner");

    assert.deepEqual(projectRoot.findNearestProjectHook(discoveryOptions(deep, "codex")), {
      projectRoot: inner,
      launcherPath: nearest.launcherPath,
    });
    assert.equal(
      projectRoot.findNearestProjectHook(discoveryOptions(deep, "claude")),
      undefined,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("damaged nearest state is a silent boundary and never falls through", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-root-damaged-"));
  try {
    const outer = path.join(base, "outer");
    const inner = path.join(outer, "inner");
    const deep = path.join(inner, "deep");
    fs.mkdirSync(deep, { recursive: true });
    managedProject(outer, "claude", undefined, "outer");
    const nearest = managedProject(inner, "claude", undefined, "inner");
    fs.writeFileSync(nearest.statePath, "{malformed", "utf8");

    assert.equal(projectRoot.findNearestProjectHook(discoveryOptions(deep, "claude")), undefined);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("nearest-state discovery rejects drift, missing launchers, symlinks, and unsafe inputs", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-root-invalid-"));
  try {
    const drifted = path.join(base, "drifted");
    fs.mkdirSync(drifted);
    const driftedFiles = managedProject(drifted, "codex");
    fs.appendFileSync(driftedFiles.launcherPath, "changed\n");
    assert.equal(projectRoot.findNearestProjectHook(discoveryOptions(drifted, "codex")), undefined);

    const missing = path.join(base, "missing");
    fs.mkdirSync(missing);
    const missingFiles = managedProject(missing, "codex");
    fs.rmSync(missingFiles.launcherPath);
    assert.equal(projectRoot.findNearestProjectHook(discoveryOptions(missing, "codex")), undefined);

    const linked = path.join(base, "linked");
    const outside = path.join(base, "outside");
    fs.mkdirSync(linked);
    fs.mkdirSync(outside);
    const linkedFiles = managedProject(linked, "codex");
    const outsideLauncher = path.join(outside, "run_hook.cmd");
    fs.writeFileSync(outsideLauncher, fs.readFileSync(linkedFiles.launcherPath));
    fs.rmSync(linkedFiles.launcherPath);
    try {
      fs.symlinkSync(outsideLauncher, linkedFiles.launcherPath, "file");
      assert.equal(projectRoot.findNearestProjectHook(discoveryOptions(linked, "codex")), undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }

    assert.equal(projectRoot.findNearestProjectHook({
      ...discoveryOptions(base, "codex"),
      stateRelativePath: "../install-state.json",
    }), undefined);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("nearest-state traversal stops at the configured fixed bound", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-root-bound-"));
  try {
    const managed = path.join(base, "managed");
    const first = path.join(managed, "one");
    const second = path.join(first, "two");
    fs.mkdirSync(second, { recursive: true });
    managedProject(managed, "codex");

    assert.equal(projectRoot.findNearestProjectHook({
      ...discoveryOptions(second, "codex"),
      maxAncestors: 2,
    }), undefined);
    assert.ok(projectRoot.findNearestProjectHook({
      ...discoveryOptions(second, "codex"),
      maxAncestors: 3,
    }));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

if (process.platform === "win32") {
  test("Windows launcher is self-relative across Unicode paths and nested cwd", () => {
    const fixture = deployment();
    try {
      assertProtocolResult(runWindows(fixture));
      assertSilentSuccess(runWindows(fixture, "not-json"));
      assertSilentSuccess(runWindows(fixture, JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "rg TODO logs" },
      })));
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("Windows launcher silently fails open when Node or hook execution is unavailable", () => {
    const fixture = deployment();
    try {
      const emptyPath = path.join(fixture.root, "empty-path");
      fs.mkdirSync(emptyPath);
      assertSilentSuccess(runWindows(fixture, structuralPayload, environment({ PATH: emptyPath })));

      fs.writeFileSync(path.join(fixture.hooks, "grep-nudge.cjs"), "process.stdout.write('must-not-leak'); process.exit(7);\n");
      assertSilentSuccess(runWindows(fixture));

      fs.rmSync(path.join(fixture.hooks, "grep-nudge.cjs"));
      assertSilentSuccess(runWindows(fixture));
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

const shell = posixShell();
if (shell !== undefined) {
  test("POSIX launcher is self-relative across Unicode paths and nested cwd", () => {
    const fixture = deployment();
    try {
      assertProtocolResult(runPosix(shell, fixture));
      assertSilentSuccess(runPosix(shell, fixture, "not-json"));
      assertSilentSuccess(runPosix(shell, fixture, JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "rg TODO logs" },
      })));
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("POSIX launcher silently fails open when Node or hook execution is unavailable", () => {
    const fixture = deployment();
    try {
      const emptyPath = path.join(fixture.root, "empty-path");
      fs.mkdirSync(emptyPath);
      assertSilentSuccess(runPosix(shell, fixture, structuralPayload, environment({ PATH: emptyPath })));

      fs.writeFileSync(path.join(fixture.hooks, "grep-nudge.cjs"), "process.stdout.write('must-not-leak'); process.exit(7);\n");
      assertSilentSuccess(runPosix(shell, fixture));

      fs.rmSync(path.join(fixture.hooks, "grep-nudge.cjs"));
      assertSilentSuccess(runPosix(shell, fixture));
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}
