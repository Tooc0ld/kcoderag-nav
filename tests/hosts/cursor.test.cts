const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const cursor = require("../../dist/hosts/cursor.cjs") as Record<string, any>;
const projectTarget = require("../../dist/core/project-target.cjs") as Record<string, any>;
const transaction = require("../../dist/core/transaction.cjs") as Record<string, any>;
const PACKAGE_ROOT = path.resolve(".");
const NAVIGATION = "kcoderag-navigation";
const CODE_STYLE = "code-style-nudge";

function context(target: any, observation: any, selectedCapabilities: readonly string[], command = "install") {
  return { target, packageRoot: PACKAGE_ROOT, command, environment: "qa", observation, selectedCapabilities };
}

test("Cursor installs manual code-style and keeps honest native navigation projection", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-cursor-"));
  try {
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cursor/mcp.json"), `${JSON.stringify({ unrelated: { keep: true } }, null, 2)}\n`);
    fs.writeFileSync(path.join(root, ".cursor/hooks.json"), `${JSON.stringify({ version: 1, hooks: { beforeSubmitPrompt: [{ command: "keep" }] } }, null, 2)}\n`);
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = cursor.createCursorAdapter({ hostVersion: "3.17.8", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(target, observation, [NAVIGATION, CODE_STYLE])));
    const state = JSON.parse(fs.readFileSync(path.join(root, ".cursor/kcoderag-nav/install-state.json"), "utf8"));
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION, CODE_STYLE]);
    const mcp = JSON.parse(fs.readFileSync(path.join(root, ".cursor/mcp.json"), "utf8"));
    assert.deepEqual(mcp.unrelated, { keep: true });
    assert.equal(typeof mcp.mcpServers.kcoderag, "object");
    assert.equal(typeof mcp.mcpServers.kcoderag.url, "string");
    assert.equal(mcp.mcpServers.kcoderag.url.endsWith("/"), false);
    assert.equal(mcp.mcpServers["kcoderag-qa"], undefined);
    const hooks = JSON.parse(fs.readFileSync(path.join(root, ".cursor/hooks.json"), "utf8"));
    assert.deepEqual(hooks.hooks.beforeSubmitPrompt, [{ command: "keep" }]);
    assert.match(JSON.stringify(hooks.hooks.afterMCPExecution), /mcp-call-marker\.cjs cursor/u);
    assert.equal(hooks.hooks.postToolUse, undefined);
    assert.equal(hooks.hooks.preToolUse, undefined);
    for (const relativePath of [
      ".cursor/rules/kcoderag-navigation.mdc",
      ".cursor/skills/kcoderag/SKILL.md",
      ".cursor/kcoderag-nav/hooks/feedback-nudge.cjs",
      ".cursor/kcoderag-nav/hooks/mcp-call-marker.cjs",
      ".cursor/kcoderag-nav/hooks/once-marker.cjs",
    ]) assert.equal(fs.existsSync(path.join(root, ...relativePath.split("/"))), true, relativePath);
    assert.equal(fs.existsSync(path.join(root, ".cursor/skills/kcoderag-code-style/SKILL.md")), true);
    const status = adapter.status({ target, packageRoot: PACKAGE_ROOT, environment: "qa", observation: adapter.detect({ target, packageRoot: PACKAGE_ROOT }) });
    assert.deepEqual(status.codeStyle, { manualSkill: "available", automaticNudge: "unsupported" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Cursor navigation uninstall restores unrelated native files exactly", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-cursor-restore-"));
  try {
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    const originalMcp = "{\n  \"keep\": true\n}\n";
    const originalHooks = "{\n  \"version\": 1,\n  \"hooks\": {}\n}\n";
    fs.writeFileSync(path.join(root, ".cursor/mcp.json"), originalMcp);
    fs.writeFileSync(path.join(root, ".cursor/hooks.json"), originalHooks);
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = cursor.createCursorAdapter({ hostVersion: "3.17.8", evidenceRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(target, adapter.detect({ target, packageRoot: PACKAGE_ROOT }), [NAVIGATION])));
    const installed = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderUninstall({ target, packageRoot: PACKAGE_ROOT, environment: "qa", observation: installed, selectedCapabilities: [NAVIGATION] }));
    assert.equal(fs.readFileSync(path.join(root, ".cursor/mcp.json"), "utf8"), originalMcp);
    assert.equal(fs.readFileSync(path.join(root, ".cursor/hooks.json"), "utf8"), originalHooks);
    assert.equal(fs.existsSync(path.join(root, ".cursor/kcoderag-nav/install-state.json")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Cursor style-only state does not claim an unmanaged same-name MCP file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-cursor-mcp-ownership-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = cursor.createCursorAdapter({ hostVersion: "3.17.8", evidenceRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(
      target,
      adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
      [CODE_STYLE],
    )));
    const mcpPath = path.join(root, ".cursor", "mcp.json");
    const statePath = path.join(root, ".cursor", "kcoderag-nav", "install-state.json");
    const original = `${JSON.stringify({
      mcpServers: { kcoderag: { url: "https://unmanaged.example.invalid/mcp" } },
    }, null, 2)}\n`;
    fs.writeFileSync(mcpPath, original, "utf8");
    const stateBefore = fs.readFileSync(statePath);

    assert.throws(
      () => adapter.renderInstall(context(
        target,
        adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
        [NAVIGATION],
      )),
      (error: any) => error?.code === "unmanaged_name_conflict" && error?.safePath === ".cursor/mcp.json",
    );
    assert.equal(fs.readFileSync(mcpPath, "utf8"), original);
    assert.deepEqual(fs.readFileSync(statePath), stateBefore);
    assert.equal(fs.existsSync(path.join(root, ".cursor/skills/kcoderag/SKILL.md")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Cursor style-only state does not claim an unmanaged same-name Hook file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-cursor-hook-ownership-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = cursor.createCursorAdapter({ hostVersion: "3.17.8", evidenceRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(
      target,
      adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
      [CODE_STYLE],
    )));
    const hooksPath = path.join(root, ".cursor", "hooks.json");
    const statePath = path.join(root, ".cursor", "kcoderag-nav", "install-state.json");
    const original = `${JSON.stringify({
      version: 1,
      hooks: { afterMCPExecution: [{ command: "node .cursor/kcoderag-nav/manual-hook.cjs" }] },
    }, null, 2)}\n`;
    fs.writeFileSync(hooksPath, original, "utf8");
    const stateBefore = fs.readFileSync(statePath);

    assert.throws(
      () => adapter.renderInstall(context(
        target,
        adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
        [NAVIGATION],
      )),
      (error: any) => error?.code === "unmanaged_name_conflict" && error?.safePath === ".cursor/hooks.json",
    );
    assert.equal(fs.readFileSync(hooksPath, "utf8"), original);
    assert.deepEqual(fs.readFileSync(statePath), stateBefore);
    assert.equal(fs.existsSync(path.join(root, ".cursor/skills/kcoderag/SKILL.md")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
