const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const { pathToFileURL } = require("node:url") as typeof import("node:url");

const cursor = require("../../dist/hosts/cursor.cjs") as Record<string, any>;
const opencode = require("../../dist/hosts/opencode.cjs") as Record<string, any>;
const projectTarget = require("../../dist/core/project-target.cjs") as Record<string, any>;
const transaction = require("../../dist/core/transaction.cjs") as Record<string, any>;

const PACKAGE_ROOT = path.resolve(".");
const NAVIGATION = "kcoderag-navigation";
const SECRET = "Bearer honest-event-secret-canary";

interface PluginModule {
  KCodeRagNav(context: {
    readonly client: { readonly tui: { showToast(input: unknown): Promise<boolean> } };
    readonly directory: string;
  }): Promise<Record<string, (input: unknown) => Promise<void>>>;
}

interface CallbackFixture {
  calls: unknown[][];
  fail: boolean;
}

function callbackFixture(): CallbackFixture {
  return (globalThis as unknown as { __kcoderagHonestEvents: CallbackFixture }).__kcoderagHonestEvents;
}

function context(target: any, observation: any, command = "install") {
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

test("Cursor projects Rule, Skill, MCP and afterMCPExecution without hook equivalence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-honest-cursor-"));
  try {
    const cursorRoot = path.join(root, ".cursor");
    fs.mkdirSync(cursorRoot, { recursive: true });
    const originalMcp = `${JSON.stringify({ keep: { exact: true } }, null, 2)}\n`;
    const originalHooks = `${JSON.stringify({
      version: 1,
      hooks: { beforeSubmitPrompt: [{ command: "node keep.js" }] },
    }, null, 2)}\n`;
    fs.writeFileSync(path.join(cursorRoot, "mcp.json"), originalMcp);
    fs.writeFileSync(path.join(cursorRoot, "hooks.json"), originalHooks);
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = cursor.createCursorAdapter({ hostVersion: "3.17.8", readUserSources: () => ({}) });
    await transaction.applyTransaction(adapter.renderInstall(context(
      target,
      adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
    )));

    const hooks = JSON.parse(fs.readFileSync(path.join(cursorRoot, "hooks.json"), "utf8")) as Record<string, any>;
    assert.deepEqual(hooks.hooks.beforeSubmitPrompt, [{ command: "node keep.js" }]);
    assert.equal(hooks.hooks.afterMCPExecution.length, 1);
    assert.match(JSON.stringify(hooks.hooks.afterMCPExecution), /mcp-call-marker\.cjs cursor/u);
    for (const unsupported of ["SessionStart", "SessionEnd", "PreToolUse", "PostToolUse", "preToolUse", "postToolUse"]) {
      assert.equal(hooks.hooks[unsupported], undefined, `${unsupported} must not be projected by Cursor`);
    }
    const rule = fs.readFileSync(path.join(cursorRoot, "rules", "kcoderag-navigation.mdc"), "utf8");
    const skill = fs.readFileSync(path.join(cursorRoot, "skills", "kcoderag-nav", "SKILL.md"), "utf8");
    assert.match(rule, /alwaysApply: true/u);
    assert.match(`${rule}\n${skill}`, /search_code/u);
    assert.doesNotMatch(`${rule}\n${skill}`, /SessionStart|PreToolUse|LIVE PASS/u);

    const statePath = path.join(cursorRoot, "kcoderag-nav", "install-state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, any>;
    assert.equal(state.sections.filter((entry: any) => entry.id === "navigation:post-tool").length, 1);
    assert.equal(/"(?:status|stage|reasonCode|evidenceLevel)"/u.test(JSON.stringify(state)), false);

    const installed = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(target, installed, "update")));
    const updatedHooks = JSON.parse(fs.readFileSync(path.join(cursorRoot, "hooks.json"), "utf8")) as Record<string, any>;
    assert.equal(updatedHooks.hooks.afterMCPExecution.length, 1);

    const beforeInterruptedUninstall = snapshot(root);
    const updated = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    assert.throws(
      () => transaction.applyTransaction(adapter.renderUninstall(uninstallContext(target, updated)), { failAtCommit: 0 }),
      (error: any) => error?.code === "transaction_failed",
    );
    assert.deepEqual(snapshot(root), beforeInterruptedUninstall);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("OpenCode after callback forwards only closed outcome facts and fails open", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-honest-opencode-plugin-"));
  try {
    const pluginPath = path.join(root, ".opencode", "plugins", "kcoderag-nav.mjs");
    const hooksRoot = path.join(root, ".opencode", "kcoderag-nav", "hooks");
    fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
    fs.mkdirSync(hooksRoot, { recursive: true });
    fs.copyFileSync(path.resolve("plugin-src/opencode/kcoderag-nav.js"), pluginPath);
    fs.writeFileSync(path.join(hooksRoot, "mcp-call-marker.cjs"), [
      "exports.recordKCodeRagCall=(fact,options)=>{",
      "const f=globalThis.__kcoderagHonestEvents;f.calls.push(['marker',fact,options]);",
      "if(f.fail)throw new Error('marker failure');return {recorded:true};};\n",
    ].join(""));
    fs.writeFileSync(path.join(hooksRoot, "feedback-nudge.cjs"), [
      "exports.feedbackNudgeContribution=(fact,options)=>{",
      "const f=globalThis.__kcoderagHonestEvents;f.calls.push(['feedback',fact,options]);",
      "if(f.fail)throw new Error('feedback failure');",
      "return fact.tool==='kcoderag-qa_search_code'&&fact.success===true?'Submit safe feedback':undefined;};\n",
    ].join(""));
    fs.writeFileSync(path.join(hooksRoot, "update-notice.cjs"), [
      "exports.readHostUpdateNotice=(host,fact,options)=>{",
      "const f=globalThis.__kcoderagHonestEvents;f.calls.push(['notice',host,fact,options]);",
      "if(f.fail)throw new Error('notice failure');return undefined;};",
      "exports.scheduleHostUpdateRefresh=(host,fact,options)=>{",
      "globalThis.__kcoderagHonestEvents.calls.push(['refresh',host,fact,options]);return true;};\n",
    ].join(""));

    (globalThis as unknown as { __kcoderagHonestEvents: CallbackFixture }).__kcoderagHonestEvents = {
      calls: [],
      fail: false,
    };
    const plugin = await import(`${pathToFileURL(pluginPath).href}?honest=${Date.now()}`) as PluginModule;
    const hooks = await plugin.KCodeRagNav({
      directory: root,
      client: {
        tui: {
          showToast: async (input) => {
            callbackFixture().calls.push(["toast", input]);
            return true;
          },
        },
      },
    });
    assert.deepEqual(Object.keys(hooks), ["tool.execute.after"]);
    const after = hooks["tool.execute.after"];
    if (after === undefined) throw new Error("missing OpenCode after callback");

    await after({
      tool: "kcoderag-qa_search_code",
      sessionID: "open-session",
      status: "completed",
      args: { authorization: SECRET },
      result: { source: SECRET },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const expectedFact = {
      conversation_id: "open-session",
      tool: "kcoderag-qa_search_code",
      success: true,
    };
    assert.deepEqual(callbackFixture().calls, [
      ["marker", expectedFact, { host: "opencode", cwd: root }],
      ["feedback", expectedFact, { host: "opencode", managedRoot: root }],
      ["notice", "opencode", expectedFact, { cwd: root }],
      ["refresh", "opencode", expectedFact, { cwd: root, runtimePath: "node" }],
      ["toast", { body: { message: "Submit safe feedback", variant: "info" } }],
    ]);
    assert.equal(JSON.stringify(callbackFixture().calls).includes(SECRET), false);

    callbackFixture().calls = [];
    callbackFixture().fail = true;
    await assert.doesNotReject(after({
      tool: "kcoderag-qa_search_code",
      sessionID: "open-session",
      status: "failed",
      error: SECRET,
    }));
    assert.equal(JSON.stringify(callbackFixture().calls).includes(SECRET), false);
  } finally {
    delete (globalThis as unknown as { __kcoderagHonestEvents?: CallbackFixture }).__kcoderagHonestEvents;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("OpenCode remains project-only, idempotent, rollback-safe, and JSON/JSONC strict", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-honest-opencode-"));
  const ambiguousRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-honest-opencode-ambiguous-"));
  try {
    const original = "{\n  // unrelated\n  \"theme\": \"dark\",\n}\n";
    fs.writeFileSync(path.join(root, "opencode.jsonc"), original);
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = opencode.createOpenCodeAdapter({ hostVersion: "1.18.23", readUserSources: () => ({}) });
    await transaction.applyTransaction(adapter.renderInstall(context(
      target,
      adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
    )));
    const installed = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(target, installed, "update")));
    const rendered = fs.readFileSync(path.join(root, "opencode.jsonc"), "utf8");
    assert.equal((rendered.match(/\.\/\.opencode\/plugins\/kcoderag-nav\.js/gu) ?? []).length, 1);
    assert.equal(rendered.includes("unrelated"), true);
    const state = JSON.parse(fs.readFileSync(path.join(root, ".opencode", "kcoderag-nav", "install-state.json"), "utf8"));
    assert.equal(/"(?:status|stage|reasonCode|evidenceLevel)"/u.test(JSON.stringify(state)), false);

    const beforeInterruptedUninstall = snapshot(root);
    const updated = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    assert.throws(
      () => transaction.applyTransaction(adapter.renderUninstall(uninstallContext(target, updated)), { failAtCommit: 0 }),
      (error: any) => error?.code === "transaction_failed",
    );
    assert.deepEqual(snapshot(root), beforeInterruptedUninstall);

    fs.writeFileSync(path.join(ambiguousRoot, "opencode.json"), "{}\n");
    fs.writeFileSync(path.join(ambiguousRoot, "opencode.jsonc"), "{}\n");
    const ambiguousTarget = projectTarget.resolveProjectTarget(ambiguousRoot);
    const ambiguous = adapter.detect({ target: ambiguousTarget, packageRoot: PACKAGE_ROOT });
    assert.deepEqual(ambiguous.issues, [{ code: "ambiguous_project_config", path: "." }]);
    assert.throws(
      () => adapter.renderInstall(context(ambiguousTarget, ambiguous)),
      (error: any) => error?.code === "ambiguous_project_config",
    );
    assert.equal(fs.existsSync(path.join(ambiguousRoot, ".opencode")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(ambiguousRoot, { recursive: true, force: true });
  }
});
