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

test("Cursor rejects instruction-only code-style nudge and keeps native navigation update projection", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-cursor-"));
  try {
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cursor/mcp.json"), `${JSON.stringify({ unrelated: { keep: true } }, null, 2)}\n`);
    fs.writeFileSync(path.join(root, ".cursor/hooks.json"), `${JSON.stringify({ version: 1, hooks: { beforeSubmitPrompt: [{ command: "keep" }] } }, null, 2)}\n`);
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = cursor.createCursorAdapter({ hostVersion: "3.17.8", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    assert.throws(() => adapter.renderInstall(context(target, observation, [NAVIGATION, CODE_STYLE])), (error: any) => error?.code === "host_version_unsupported");
    assert.equal(fs.existsSync(path.join(root, ".cursor/rules/kcoderag-navigation.mdc")), false);

    await transaction.applyTransaction(adapter.renderInstall(context(target, observation, [NAVIGATION])));
    const state = JSON.parse(fs.readFileSync(path.join(root, ".cursor/kcoderag-nav/install-state.json"), "utf8"));
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION]);
    const mcp = JSON.parse(fs.readFileSync(path.join(root, ".cursor/mcp.json"), "utf8"));
    assert.deepEqual(mcp.unrelated, { keep: true });
    assert.equal(typeof mcp.mcpServers.kcoderag, "object");
    assert.equal(typeof mcp.mcpServers.kcoderag.url, "string");
    assert.equal(mcp.mcpServers.kcoderag.url.endsWith("/"), false);
    assert.equal(mcp.mcpServers["kcoderag-qa"], undefined);
    const hooks = JSON.parse(fs.readFileSync(path.join(root, ".cursor/hooks.json"), "utf8"));
    assert.deepEqual(hooks.hooks.beforeSubmitPrompt, [{ command: "keep" }]);
    assert.match(JSON.stringify(hooks.hooks.afterMCPExecution), /mcp-call-marker\.cjs cursor/u);
    assert.match(JSON.stringify(hooks.hooks.postToolUse), /update-notice\.cjs cursor/u);
    for (const relativePath of [
      ".cursor/rules/kcoderag-navigation.mdc",
      ".cursor/skills/kcoderag-nav/SKILL.md",
      ".cursor/kcoderag-nav/hooks/mcp-call-marker.cjs",
      ".cursor/kcoderag-nav/hooks/update-check.cjs",
      ".cursor/kcoderag-nav/hooks/update-notice.cjs",
      ".cursor/kcoderag-nav/hooks/update-worker.cjs",
    ]) assert.equal(fs.existsSync(path.join(root, ...relativePath.split("/"))), true, relativePath);
    assert.equal(fs.existsSync(path.join(root, ".cursor/skills/code-style-correction/SKILL.md")), false);
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
