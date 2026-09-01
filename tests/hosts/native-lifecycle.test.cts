const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const claude = require("../../dist/hosts/claude.cjs") as Record<string, any>;
const zcode = require("../../dist/hosts/zcode.cjs") as Record<string, any>;
const projectTarget = require("../../dist/core/project-target.cjs") as Record<string, any>;
const transaction = require("../../dist/core/transaction.cjs") as Record<string, any>;

const PACKAGE_ROOT = path.resolve(".");
const NAVIGATION = "kcoderag-navigation";
const SESSION_MATCHER = "^(startup|resume|clear|compact)$";

function installContext(target: any, observation: any, command = "install") {
  return {
    target,
    packageRoot: PACKAGE_ROOT,
    command,
    environment: "qa",
    observation,
    selectedCapabilities: [NAVIGATION],
  };
}

function uninstallContext(target: any, observation: any) {
  return {
    target,
    packageRoot: PACKAGE_ROOT,
    environment: "qa",
    observation,
    selectedCapabilities: [NAVIGATION],
  };
}

function snapshot(root: string): readonly string[] {
  const visit = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
      return entry.isDirectory()
        ? visit(absolute)
        : [`${relative}\0${fs.readFileSync(absolute).toString("base64")}`];
    });
  return Object.freeze(visit(root).sort());
}

function markerCount(cacheRoot: string): number {
  const directory = path.join(cacheRoot, "kcoderag-nav", "nudges");
  try {
    return fs.readdirSync(directory).filter((name) => name.endsWith(".claim")).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

function runLifecycle(
  host: "claude" | "zcode",
  root: string,
  cacheRoot: string,
  payload: Readonly<Record<string, unknown>>,
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const hookRoot = host === "claude"
    ? path.join(root, ".claude", "kcoderag-nav", "qa", "hooks")
    : path.join(root, ".zcode", "kcoderag-nav", "hooks");
  const env = {
    ...process.env,
    LOCALAPPDATA: cacheRoot,
    XDG_CACHE_HOME: cacheRoot,
    KCODERAG_NAV_UPDATE_CHECK: "0",
    ...(host === "zcode" ? { ZCODE_PROJECT_DIR: root } : {}),
  };
  const input = `${JSON.stringify(payload)}\n`;
  if (host === "zcode") {
    const completed = childProcess.spawnSync(
      process.execPath,
      [path.join(hookRoot, "pre-tool-dispatcher.cjs"), host],
      { cwd: root, env, input, encoding: "utf8", windowsHide: true },
    );
    return Object.freeze({ status: completed.status, stdout: completed.stdout, stderr: completed.stderr });
  }
  const launcher = path.join(hookRoot, process.platform === "win32" ? "run_hook.cmd" : "run_hook.sh");
  const completed = process.platform === "win32"
    ? childProcess.spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "call", launcher, host], {
        cwd: root,
        env,
        input,
        encoding: "utf8",
        windowsHide: true,
      })
    : childProcess.spawnSync(launcher, [host], {
        cwd: root,
        env,
        input,
        encoding: "utf8",
      });
  return Object.freeze({ status: completed.status, stdout: completed.stdout, stderr: completed.stderr });
}

function parseAdditionalContext(stdout: string): string | undefined {
  if (stdout.length === 0) return undefined;
  const document = JSON.parse(stdout) as Record<string, any>;
  assert.equal(document.hookSpecificOutput?.hookEventName, "SessionStart");
  return document.hookSpecificOutput?.additionalContext;
}

test("Claude and ZCode merge only proven native lifecycle registrations", async () => {
  const template = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "plugin-src", "hooks", "hooks.json"), "utf8"));
  assert.equal(template.hooks.SessionStart[0].matcher, SESSION_MATCHER);
  assert.equal("SessionEnd" in template.hooks, false);

  for (const host of ["claude", "zcode"] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kcoderag-native-${host}-`));
    try {
      const configPath = host === "claude"
        ? path.join(root, ".claude", "settings.json")
        : path.join(root, ".zcode", "config.json");
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const unrelatedSession = {
        matcher: "startup",
        hooks: [{ type: "command", command: "node keep-session.js" }],
      };
      const originalDocument = host === "claude"
        ? { permissions: { allow: ["Read"] }, hooks: { SessionStart: [unrelatedSession] } }
        : { theme: "dark", hooks: { enabled: true, events: { SessionStart: [unrelatedSession] } } };
      const original = `${JSON.stringify(originalDocument, null, 2)}\n`;
      fs.writeFileSync(configPath, original);

      const target = projectTarget.resolveProjectTarget(root);
      const adapter = host === "claude"
        ? claude.createClaudeAdapter({ readUserSources: () => ({}) })
        : zcode.createZCodeAdapter({ readUserSources: () => ({}) });
      await transaction.applyTransaction(adapter.renderInstall(installContext(
        target,
        adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
      )));

      const rendered = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, any>;
      const hooks = host === "claude" ? rendered.hooks : rendered.hooks.events;
      assert.deepEqual(hooks.SessionStart[0], unrelatedSession);
      assert.equal(hooks.SessionStart.length, 2);
      assert.equal(hooks.SessionStart[1].matcher, SESSION_MATCHER);
      assert.match(JSON.stringify(hooks.SessionStart[1]), /pre-tool-dispatcher|run_hook/u);
      assert.equal(hooks.SessionEnd, undefined, "unproved SessionEnd must not be registered");
      const statePath = host === "claude"
        ? path.join(root, ".claude", "kcoderag-nav", "install-state.json")
        : path.join(root, ".zcode", "kcoderag-nav", "install-state.json");
      const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, any>;
      assert.equal(state.sections.some((entry: any) => entry.id === "navigation:session-start"), true);
      assert.equal(state.sections.some((entry: any) => entry.id === "navigation:session-end"), false);

      const installed = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
      await transaction.applyTransaction(adapter.renderInstall(installContext(target, installed, "update")));
      assert.equal((host === "claude"
        ? JSON.parse(fs.readFileSync(configPath, "utf8")).hooks
        : JSON.parse(fs.readFileSync(configPath, "utf8")).hooks.events).SessionStart.length, 2);

      const beforeInterruptedUninstall = snapshot(root);
      const updated = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
      assert.throws(
        () => transaction.applyTransaction(adapter.renderUninstall(uninstallContext(target, updated)), { failAtCommit: 0 }),
        (error: any) => error?.code === "transaction_failed",
      );
      assert.deepEqual(snapshot(root), beforeInterruptedUninstall);

      const restored = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
      await transaction.applyTransaction(adapter.renderUninstall(uninstallContext(target, restored)));
      assert.equal(fs.readFileSync(configPath, "utf8"), original);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("Claude and ZCode pass stable SessionStart source and identity to the shared governor", async () => {
  for (const host of ["claude", "zcode"] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kcoderag-native-governor-${host}-`));
    const cacheRoot = path.join(root, "cache");
    fs.mkdirSync(cacheRoot);
    try {
      const target = projectTarget.resolveProjectTarget(root);
      const adapter = host === "claude"
        ? claude.createClaudeAdapter({ readUserSources: () => ({}) })
        : zcode.createZCodeAdapter({ readUserSources: () => ({}) });
      await transaction.applyTransaction(adapter.renderInstall(installContext(
        target,
        adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
      )));

      const base = { hook_event_name: "SessionStart", session_id: `stable-${host}` };
      const startup = runLifecycle(host, root, cacheRoot, { ...base, source: "startup" });
      assert.equal(startup.status, 0);
      assert.equal(startup.stderr, "");
      assert.match(parseAdditionalContext(startup.stdout) ?? "", /Use KCodeRag/u);
      const afterStartup = markerCount(cacheRoot);
      assert.equal(afterStartup, 1);

      const resume = runLifecycle(host, root, cacheRoot, { ...base, source: "resume" });
      assert.equal(resume.status, 0);
      assert.equal(resume.stdout, "");
      assert.equal(markerCount(cacheRoot), afterStartup);

      const malformed = runLifecycle(host, root, cacheRoot, { ...base, source: "restored-from-guess" });
      assert.equal(malformed.status, 0);
      assert.equal(malformed.stdout, "");
      assert.equal(malformed.stderr, "");
      assert.equal(markerCount(cacheRoot), afterStartup);

      const compact = runLifecycle(host, root, cacheRoot, { ...base, source: "compact" });
      assert.equal(compact.status, 0);
      assert.match(parseAdditionalContext(compact.stdout) ?? "", /Use KCodeRag/u);
      assert.equal(markerCount(cacheRoot), afterStartup + 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
