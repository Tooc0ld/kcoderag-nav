const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const sourceHooks = path.resolve("plugin-src/hooks");
const compiledHook = path.resolve("dist/hooks/grep-nudge.cjs");
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
    { cwd: fixture.cwd, input, encoding: "utf8", timeout: 5_000, env },
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

  for (const launcher of ["run_hook.cmd", "run_hook.sh"]) {
    const source = fs.readFileSync(path.join(sourceHooks, launcher), "utf8");
    assert.match(source, /grep-nudge\.cjs/);
    assert.doesNotMatch(source, /python|grep_nudge\.py|https?:|curl|wget/iu);
    assert.doesNotMatch(source, /CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT/iu);
  }
});

if (process.platform === "win32") {
  test("Windows launcher is self-relative across Unicode paths and nested cwd", () => {
    const fixture = deployment();
    try {
      assertProtocolResult(runWindows(fixture));
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
