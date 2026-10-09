const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const statusline = require("../../dist/hooks/claude-statusline.cjs") as Record<string, any>;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nav-statusline-"));
  const projectRoot = path.join(root, "project with spaces");
  const homeDirectory = path.join(root, "home");
  const cacheRoot = path.join(root, "cache");
  fs.mkdirSync(path.join(projectRoot, ".claude/kcoderag-nav"), { recursive: true });
  fs.mkdirSync(path.join(homeDirectory, ".claude"), { recursive: true });
  fs.mkdirSync(cacheRoot);
  const write = (relative: string, data: unknown) => {
    const target = path.join(projectRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(data));
  };
  const state = (local: unknown = undefined) => write(".claude/kcoderag-nav/install-state.json", {
    packageVersion: "0.3.8",
    files: [{
      path: ".claude/settings.local.json",
      original: local === undefined ? { kind: "absent" } : {
        kind: "base64", data: Buffer.from(JSON.stringify(local)).toString("base64"),
      },
    }],
  });
  const script = (name: string, source: string) => {
    const absolute = path.join(root, name + ".cjs");
    fs.writeFileSync(absolute, source);
    return { type: "command", command: '"' + process.execPath + '" "' + absolute + '"' };
  };
  const options = {
    projectRoot, homeDirectory, cwd: projectRoot,
    environment: { ...process.env, CLAUDE_CONFIG_DIR: "", KCODERAG_NAV_STATUSLINE_ACTIVE: "" },
    updateOptions: { cacheRoot, now: () => 1000 },
  };
  state();
  return { root, projectRoot, homeDirectory, cacheRoot, write, state, script, options };
}

test("Claude statusline preserves upstream raw input/output and reads fresh update without consuming markers", async () => {
  const f = fixture();
  try {
    f.write(".claude/settings.json", { statusLine: f.script("upstream", "process.stdin.pipe(process.stdout);") });
    fs.writeFileSync(path.join(f.cacheRoot, "remote-cache.json"), JSON.stringify({ schemaVersion: 1, checkedAt: 999, latest: "0.3.9" }));
    const before = fs.readdirSync(f.cacheRoot);
    const raw = Buffer.from('{"cwd":"unchanged","secret":"synthetic-fixture"}\n');
    const output = await statusline.renderClaudeStatusline(raw, f.options);
    assert.equal(output.toString(), raw.toString().trimEnd() + "  " + statusline.STATUSLINE_BADGE + "\n");
    assert.deepEqual(fs.readdirSync(f.cacheRoot), before);
    assert.equal(fs.existsSync(path.join(f.cacheRoot, "nudges")), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("Claude statusline resolves original local then project then live user GSD settings", async () => {
  const f = fixture();
  try {
    const userSettings = path.join(f.homeDirectory, ".claude/settings.json");
    fs.writeFileSync(userSettings, JSON.stringify({ statusLine: f.script("user", 'process.stdout.write("GSD user");') }));
    assert.equal((await statusline.renderClaudeStatusline(Buffer.from("{}"), f.options)).toString(), "GSD user");
    f.write(".claude/settings.json", { statusLine: f.script("project", 'process.stdout.write("GSD project");') });
    assert.equal((await statusline.renderClaudeStatusline(Buffer.from("{}"), f.options)).toString(), "GSD project");
    f.state({ statusLine: f.script("local", 'process.stdout.write("GSD local");'), unrelated: true });
    assert.equal((await statusline.renderClaudeStatusline(Buffer.from("{}"), f.options)).toString(), "GSD local");
    f.state({ statusLine: null });
    assert.equal((await statusline.renderClaudeStatusline(Buffer.from("{}"), f.options)).toString(), "");
    f.state();
    f.write(".claude/settings.json", {});
    fs.writeFileSync(userSettings, JSON.stringify({ statusLine: f.script("user-new", 'process.stdout.write("GSD updated");') }));
    assert.equal((await statusline.renderClaudeStatusline(Buffer.from("{}"), f.options)).toString(), "GSD updated");
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("Claude statusline honors custom Claude configuration directory without copying command into state", async () => {
  const f = fixture();
  try {
    const config = path.join(f.root, "custom-config");
    fs.mkdirSync(config);
    const setting = f.script("custom", 'process.stdout.write("custom GSD");');
    fs.writeFileSync(path.join(config, "settings.json"), JSON.stringify({ statusLine: setting }));
    const result = await statusline.renderClaudeStatusline(Buffer.from("{}"), {
      ...f.options, environment: { ...f.options.environment, CLAUDE_CONFIG_DIR: config },
    });
    assert.equal(result.toString(), "custom GSD");
    assert.equal(fs.readFileSync(path.join(f.projectRoot, ".claude/kcoderag-nav/install-state.json"), "utf8").includes(setting.command), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("Claude statusline fails open and preserves partial stdout while suppressing errors and bounding hung descendants", async () => {
  const f = fixture();
  try {
    f.write(".claude/settings.json", { statusLine: f.script("failed",
      'process.stdout.write("GSD survives");process.stderr.write("private configuration must not appear");process.exitCode=1;') });
    assert.equal((await statusline.renderClaudeStatusline(Buffer.from("{}"), f.options)).toString(), "GSD survives");
    const done = path.join(f.root, "late-effect");
    f.write(".claude/settings.json", { statusLine: f.script("hung",
      'process.stdout.write("partial");setTimeout(()=>require("node:fs").writeFileSync(' + JSON.stringify(done) + ',"bad"),700);') });
    const start = Date.now();
    assert.equal((await statusline.renderClaudeStatusline(Buffer.from("{}"), { ...f.options, timeoutMs: 100 })).toString(), "partial");
    assert.ok(Date.now() - start < 1000);
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(fs.existsSync(done), false, "our timed-out subprocess must not continue");
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("Claude statusline bounds output/input and refuses direct and indirect recursion", async () => {
  const f = fixture();
  try {
    f.write(".claude/settings.json", { statusLine: f.script("large",
      'process.stdout.write("x".repeat(300000));') });
    assert.equal((await statusline.renderClaudeStatusline(Buffer.from("{}"), f.options)).length, statusline.MAX_OUTPUT_BYTES);
    assert.equal((await statusline.renderClaudeStatusline(Buffer.alloc(statusline.MAX_INPUT_BYTES + 1), f.options)).length, 0);
    assert.equal((await statusline.renderClaudeStatusline(Buffer.from("{}"), {
      ...f.options, environment: { ...f.options.environment, KCODERAG_NAV_STATUSLINE_ACTIVE: "1" },
    })).length, 0);
    f.write(".claude/settings.json", { statusLine: { type: "command", command: statusline.renderClaudeStatuslineCommand() } });
    assert.equal((await statusline.renderClaudeStatusline(Buffer.from("{}"), f.options)).length, 0);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("Claude statusline missing, stale, corrupt and current caches preserve exact upstream ANSI bytes without badge", async () => {
  const f = fixture();
  try {
    const bytes = "\u001b[36mGSD\u001b[0m\nsecond line\n";
    f.write(".claude/settings.json", { statusLine: f.script("ansi", "process.stdout.write(" + JSON.stringify(bytes) + ");") });
    for (const cache of [undefined, "{", JSON.stringify({ schemaVersion: 1, checkedAt: 0, latest: "0.3.8" }),
      JSON.stringify({ schemaVersion: 1, checkedAt: 0, latest: "0.3.9" })]) {
      if (cache !== undefined) fs.writeFileSync(path.join(f.cacheRoot, "remote-cache.json"), cache);
      const output = await statusline.renderClaudeStatusline(Buffer.from("{}"), {
        ...f.options, updateOptions: { cacheRoot: f.cacheRoot, now: () => 25 * 60 * 60 * 1000 },
      });
      assert.equal(output.toString(), bytes);
    }
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("Claude statusline selects Git Bash before PowerShell on Windows and preserves the command as one argument", () => {
  const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
  const config = statusline.statuslineShell({ CLAUDE_CODE_GIT_BASH_PATH: bash }, "win32", (candidate: string) => candidate === bash);
  assert.deepEqual(config, { executable: bash, args: ["-c"] });
  const fallback = statusline.statuslineShell({ PATH: "C:\\Windows\\System32" }, "win32",
    (candidate: string) => candidate === "C:\\Windows\\System32\\bash.exe");
  assert.deepEqual(fallback, { executable: "pwsh.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] });
});


test("Claude cancellation stops the owned POSIX upstream group before a delayed write", { skip: process.platform === "win32" }, async () => {
  const f = fixture();
  const childProcess = require("node:child_process") as typeof import("node:child_process");
  try {
    const ready = path.join(f.root, "upstream-ready");
    const late = path.join(f.root, "upstream-late-write");
    f.write(".claude/settings.json", { statusLine: f.script("cancelled",
      'require("node:fs").writeFileSync(' + JSON.stringify(ready) + ',"ready");setTimeout(()=>require("node:fs").writeFileSync(' + JSON.stringify(late) + ',"unexpected"),700);') });
    const runner = path.join(f.root, "renderer.cjs");
    fs.writeFileSync(runner,
      "require(" + JSON.stringify(path.resolve("dist/hooks/claude-statusline.cjs")) + ").renderClaudeStatusline(Buffer.from('{}')," +
      JSON.stringify({ projectRoot: f.projectRoot, homeDirectory: f.homeDirectory, cwd: f.projectRoot }) +
      ").then(out=>process.stdout.write(out));");
    const child = childProcess.spawn(process.execPath, [runner], { stdio: "ignore" });
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    for (let attempt = 0; attempt < 100 && !fs.existsSync(ready); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(fs.existsSync(ready), true, "owned upstream must have started before cancelling the renderer");
    child.kill("SIGTERM");
    await exited;
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(fs.existsSync(late), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});


test("Windows output-limit completion waits for both upstream and taskkill close acknowledgements", async () => {
  const f = fixture();
  const childProcess = require("node:child_process") as typeof import("node:child_process");
  const { EventEmitter } = require("node:events") as typeof import("node:events");
  const { PassThrough } = require("node:stream") as typeof import("node:stream");
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const originalSpawn = childProcess.spawn;
  const upstream = Object.assign(new EventEmitter(), {
    pid: 7654321, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: () => true, unref: () => {},
  });
  const killer = Object.assign(new EventEmitter(), { kill: () => true, unref: () => {} });
  let treeClosed = false;
  let upstreamClosed = false;
  let calls = 0;
  try {
    f.write(".claude/settings.json", { statusLine: { type: "command", command: "synthetic-upstream" } });
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    childProcess.spawn = ((executable: string) => {
      calls += 1;
      if (calls === 1) {
        setTimeout(() => upstream.stdout.write(Buffer.alloc(statusline.MAX_OUTPUT_BYTES + 1)), 0);
        return upstream;
      }
      assert.equal(executable, "taskkill.exe");
      setTimeout(() => { upstreamClosed = true; upstream.emit("close", 1); }, 5);
      setTimeout(() => { treeClosed = true; killer.emit("close", 0); }, 60);
      return killer;
    }) as typeof childProcess.spawn;
    const output = await statusline.renderClaudeStatusline(Buffer.from("{}"), f.options);
    assert.equal(output.length, statusline.MAX_OUTPUT_BYTES);
    assert.equal(upstreamClosed, true, "the upstream must have closed before the renderer resolves");
    assert.equal(treeClosed, true, "taskkill must acknowledge tree termination before the renderer resolves");
    assert.equal(calls, 2);
  } finally {
    childProcess.spawn = originalSpawn;
    if (platform !== undefined) Object.defineProperty(process, "platform", platform);
    upstream.stdin.destroy();
    upstream.stdout.destroy();
    upstream.stderr.destroy();
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("Output-limit completion leaves no running owned upstream or descendant", async () => {
  const f = fixture();
  try {
    const inventory = path.join(f.root, "owned-pids.json");
    const descendant = 'process.send("ready");setInterval(()=>{},1000);';
    f.write(".claude/settings.json", { statusLine: f.script("owned-tree",
      'const c=require("node:child_process").spawn(process.execPath,["-e",' + JSON.stringify(descendant) +
      '],{stdio:["ignore","ignore","ignore","ipc"]});c.once("message",()=>{require("node:fs").writeFileSync(' +
      JSON.stringify(inventory) + ',JSON.stringify([process.pid,c.pid]));process.stdout.write("x".repeat(300000));});setInterval(()=>{},1000);') });
    const output = await statusline.renderClaudeStatusline(Buffer.from("{}"), { ...f.options, timeoutMs: 5000 });
    assert.equal(output.length, statusline.MAX_OUTPUT_BYTES);
    const pids = JSON.parse(fs.readFileSync(inventory, "utf8")) as number[];
    assert.equal(pids.length, 2);
    for (const pid of pids) {
      let running = true;
      try {
        process.kill(pid, 0);
        // POSIX orphan zombies have exited and cannot retain cwd handles/work;
        // the host init process owns their final bookkeeping, not this renderer.
        if (process.platform === "linux") {
          const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
          running = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ESRCH" || code === "ENOENT") running = false;
        else throw error;
      }
      assert.equal(running, false, "no owned process may keep running after output-limit completion");
    }
    // This must work immediately. Do not mask lingering cwd handles with retries.
    fs.rmSync(f.projectRoot, { recursive: true, force: true });
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
