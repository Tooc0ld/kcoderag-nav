const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const codex = require("../../dist/hosts/codex.cjs") as Record<string, any>;
const projectTarget = require("../../dist/core/project-target.cjs") as Record<string, any>;
const projectRoot = require("../../dist/core/project-root.cjs") as Record<string, any>;
const transaction = require("../../dist/core/transaction.cjs") as Record<string, any>;

const PACKAGE_ROOT = path.resolve(".");
const NAVIGATION = "kcoderag-navigation";
const CODE_STYLE = "code-style-nudge";

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

test("Codex bootstrap accepts only the closed neutral capability inventory", () => {
  const command = projectRoot.renderProjectHookCommands("codex").command as string;
  const encoded = command.split(" ")[3];
  assert.equal(typeof encoded, "string");
  const source = Buffer.from(encoded ?? "", "base64").toString("utf8");
  assert.match(source, /A=\['kcoderag-navigation','code-style-nudge'\]/u);
  assert.equal(source.includes(["j", "x3-style-nudge"].join("")), false);
});

test("Codex installs manual code-style while keeping native automation navigation-only", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-codex-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = codex.createCodexAdapter({ hostVersion: "0.146.1", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });

    const desired = adapter.renderInstall(context(target, observation, [NAVIGATION, CODE_STYLE]));
    await transaction.applyTransaction(desired);
    const state = JSON.parse(fs.readFileSync(path.join(root, ".codex/kcoderag-nav/install-state.json"), "utf8"));
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION, CODE_STYLE]);
    const style = state.capabilities.find((entry: any) => entry.id === CODE_STYLE);
    assert.deepEqual(style.sections, []);
    assert.equal(style.files.some((file: string) => file.endsWith("code-style-nudge.cjs")), false);
    assert.equal(fs.existsSync(path.join(root, ".codex/config.toml")), true);
    const config = fs.readFileSync(path.join(root, ".codex/config.toml"), "utf8");
    const remoteUrl = config.match(/^url\s*=\s*"([^"]+)"$/mu)?.[1];
    assert.equal(typeof remoteUrl, "string");
    assert.equal(remoteUrl?.endsWith("/"), false);
    assert.equal(fs.existsSync(path.join(root, ".codex/hooks.json")), true);
    assert.equal(fs.existsSync(path.join(root, ".agents/skills/kcoderag/SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(root, ".codex/kcoderag-nav/qa/hooks/update-notice.cjs")), true);
    assert.equal(fs.existsSync(path.join(root, ".codex/kcoderag-nav/qa/hooks/pre-tool-dispatcher.cjs")), true);
    assert.equal(fs.existsSync(path.join(root, ".agents/skills/kcoderag-code-style/SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(root, ".agents/skills/kcoderag-code-style/agents/openai.yaml")), true);
    const hooks = JSON.parse(fs.readFileSync(path.join(root, ".codex/hooks.json"), "utf8"));
    assert.match(JSON.stringify(hooks), /PreToolUse/u);
    assert.match(JSON.stringify(hooks), /PostToolUse/u);
    const status = adapter.status({ target, packageRoot: PACKAGE_ROOT, environment: "qa", observation: adapter.detect({ target, packageRoot: PACKAGE_ROOT }) });
    assert.deepEqual(status.codeStyle, { manualSkill: "available", automaticNudge: "unsupported" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex can add navigation after a manual-only code-style install", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-codex-reverse-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = codex.createCodexAdapter({ hostVersion: "0.146.1", evidenceRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(
      target,
      adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
      [CODE_STYLE],
    )));
    await transaction.applyTransaction(adapter.renderInstall(context(
      target,
      adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
      [NAVIGATION],
    )));
    const state = JSON.parse(fs.readFileSync(path.join(root, ".codex/kcoderag-nav/install-state.json"), "utf8"));
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION, CODE_STYLE]);
    assert.equal(fs.existsSync(path.join(root, ".codex/config.toml")), true);
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
