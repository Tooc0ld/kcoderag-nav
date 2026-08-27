const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const codex = require("../../dist/hosts/codex.cjs") as Record<string, any>;
const projectTarget = require("../../dist/core/project-target.cjs") as Record<string, any>;
const transaction = require("../../dist/core/transaction.cjs") as Record<string, any>;

const PACKAGE_ROOT = path.resolve(".");
const NAVIGATION = "kcoderag-navigation";
const JX3 = "jx3-style-nudge";

function context(target: any, observation: any, selectedCapabilities: readonly string[], command = "install") {
  return {
    target,
    packageRoot: PACKAGE_ROOT,
    command,
    environment: "qa",
    observation,
    selectedCapabilities,
  };
}

test("Codex rejects unsupported JX3 before desired state while navigation remains complete", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-codex-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = codex.createCodexAdapter({ hostVersion: "0.146.1", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });

    assert.throws(
      () => adapter.renderInstall(context(target, observation, [NAVIGATION, JX3])),
      (error: any) => error?.code === "host_version_unsupported",
    );
    assert.deepEqual(fs.readdirSync(root), []);

    const desired = adapter.renderInstall(context(target, observation, [NAVIGATION]));
    await transaction.applyTransaction(desired);
    const state = JSON.parse(fs.readFileSync(path.join(root, ".codex/kcoderag-nav/install-state.json"), "utf8"));
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION]);
    assert.equal(fs.existsSync(path.join(root, ".codex/config.toml")), true);
    const config = fs.readFileSync(path.join(root, ".codex/config.toml"), "utf8");
    const remoteUrl = config.match(/^url\s*=\s*"([^"]+)"$/mu)?.[1];
    assert.equal(typeof remoteUrl, "string");
    assert.equal(remoteUrl?.endsWith("/"), false);
    assert.equal(fs.existsSync(path.join(root, ".codex/hooks.json")), true);
    assert.equal(fs.existsSync(path.join(root, ".agents/skills/kcoderag-nav/SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(root, ".codex/kcoderag-nav/qa/hooks/update-notice.cjs")), true);
    assert.equal(fs.existsSync(path.join(root, ".codex/kcoderag-nav/qa/hooks/pre-tool-dispatcher.cjs")), true);
    assert.equal(fs.existsSync(path.join(root, ".agents/skills/jx3-code-style-correction/SKILL.md")), false);
    const hooks = JSON.parse(fs.readFileSync(path.join(root, ".codex/hooks.json"), "utf8"));
    assert.match(JSON.stringify(hooks), /PreToolUse/u);
    assert.match(JSON.stringify(hooks), /PostToolUse/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex source observations stay path-only and never gain cleanup authority", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-codex-source-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = codex.createCodexAdapter({
      readUserSources: () => ({
        rawMcpPaths: [".codex/config.toml"],
        manualHookPaths: [".codex/hooks.json"],
        ambiguousPaths: [".codex/plugins/kcoderag-nav"],
      }),
    });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    const scan = await adapter.scanUserSources({
      target,
      packageRoot: PACKAGE_ROOT,
      mode: "deep",
      observation,
    });
    assert.deepEqual(scan.findings.map((finding: any) => finding.code), [
      "raw_mcp_source",
      "manual_hook_source",
      "ambiguous_source",
    ]);
    for (const finding of scan.findings) {
      assert.deepEqual(Object.keys(finding).sort(), ["code", "safePath", "scope", "severity", "sourceType"]);
    }
    assert.equal("cleanupOwnedSource" in adapter, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
