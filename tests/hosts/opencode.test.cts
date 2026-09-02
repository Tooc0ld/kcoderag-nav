const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const opencode = require("../../dist/hosts/opencode.cjs") as Record<string, any>;
const projectTarget = require("../../dist/core/project-target.cjs") as Record<string, any>;
const transaction = require("../../dist/core/transaction.cjs") as Record<string, any>;
const PACKAGE_ROOT = path.resolve(".");
const NAVIGATION = "kcoderag-navigation";
const CODE_STYLE = "code-style-nudge";

function context(target: any, observation: any, selectedCapabilities: readonly string[], command = "install") {
  return { target, packageRoot: PACKAGE_ROOT, command, environment: "qa", observation, selectedCapabilities };
}

test("OpenCode installs manual code-style and projects navigation plugin update awareness", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-opencode-"));
  try {
    const original = "{\n  // keep comment\n  \"theme\": \"dark\",\n}\n";
    fs.writeFileSync(path.join(root, "opencode.jsonc"), original);
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = opencode.createOpenCodeAdapter({ hostVersion: "1.18.23", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(target, observation, [NAVIGATION, CODE_STYLE])));
    const state = JSON.parse(fs.readFileSync(path.join(root, ".opencode/kcoderag-nav/install-state.json"), "utf8"));
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION, CODE_STYLE]);
    assert.equal(state.sections.some((entry: any) => entry.id === "navigation:schema"), true);
    const rendered = fs.readFileSync(path.join(root, "opencode.jsonc"), "utf8");
    assert.equal(/keep comment/u.test(rendered), true);
    assert.equal(rendered.includes('"theme": "dark"'), true);
    assert.equal(/"\$schema"\s*:\s*"https:\/\/opencode\.ai\/config\.json"/u.test(rendered), true);
    assert.equal(/kcoderag-qa/u.test(rendered), true);
    const remoteUrl = rendered.match(/"url"\s*:\s*"([^"]+)"/u)?.[1];
    assert.equal(typeof remoteUrl, "string");
    assert.equal(remoteUrl?.endsWith("/"), false);
    assert.equal(/\.opencode\/plugins\/kcoderag-nav\.js/u.test(rendered), true);
    const plugin = fs.readFileSync(path.join(root, ".opencode/plugins/kcoderag-nav.js"), "utf8");
    assert.match(plugin, /readHostUpdateNotice/u);
    assert.match(plugin, /scheduleHostUpdateRefresh/u);
    for (const relativePath of [
      ".opencode/skills/kcoderag/SKILL.md",
      ".opencode/kcoderag-nav/hooks/mcp-call-marker.cjs",
      ".opencode/kcoderag-nav/hooks/update-check.cjs",
      ".opencode/kcoderag-nav/hooks/update-notice.cjs",
      ".opencode/kcoderag-nav/hooks/update-worker.cjs",
    ]) assert.equal(fs.existsSync(path.join(root, ...relativePath.split("/"))), true, relativePath);
    assert.equal(fs.existsSync(path.join(root, ".opencode/skills/kcoderag-code-style/SKILL.md")), true);
    const status = adapter.status({ target, packageRoot: PACKAGE_ROOT, environment: "qa", observation: adapter.detect({ target, packageRoot: PACKAGE_ROOT }) });
    assert.deepEqual(status.codeStyle, { manualSkill: "available", automaticNudge: "unsupported" });

    const installed = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderUninstall({ target, packageRoot: PACKAGE_ROOT, environment: "qa", observation: installed, selectedCapabilities: [NAVIGATION, CODE_STYLE] }));
    assert.equal(fs.readFileSync(path.join(root, "opencode.jsonc"), "utf8"), original);
    assert.equal(fs.existsSync(path.join(root, ".opencode/plugins/kcoderag-nav.js")), false);
    assert.equal(fs.existsSync(path.join(root, ".opencode/skills/kcoderag-code-style/SKILL.md")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("OpenCode can add navigation after a manual-only code-style install", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-opencode-reverse-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = opencode.createOpenCodeAdapter({ hostVersion: "1.18.23", evidenceRoot: PACKAGE_ROOT });
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
    const state = JSON.parse(fs.readFileSync(path.join(root, ".opencode/kcoderag-nav/install-state.json"), "utf8"));
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION, CODE_STYLE]);
    assert.equal(fs.existsSync(path.join(root, "opencode.json")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("OpenCode preserves an existing schema without claiming its ownership", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-opencode-schema-"));
  try {
    const original = "{\n  \"$schema\": \"https://example.test/custom-schema.json\",\n  \"theme\": \"dark\"\n}\n";
    fs.writeFileSync(path.join(root, "opencode.json"), original);
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = opencode.createOpenCodeAdapter({ hostVersion: "1.18.23", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });

    await transaction.applyTransaction(adapter.renderInstall(context(target, observation, [NAVIGATION])));
    const state = JSON.parse(fs.readFileSync(path.join(root, ".opencode/kcoderag-nav/install-state.json"), "utf8"));
    assert.equal(state.sections.some((entry: any) => entry.id === "navigation:schema"), false);
    const rendered = fs.readFileSync(path.join(root, "opencode.json"), "utf8");
    assert.equal(rendered.includes("https://example.test/custom-schema.json"), true);

    const installed = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderUninstall({ target, packageRoot: PACKAGE_ROOT, environment: "qa", observation: installed, selectedCapabilities: [NAVIGATION] }));
    assert.equal(fs.readFileSync(path.join(root, "opencode.json"), "utf8"), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("OpenCode JSON and JSONC ambiguity blocks all projection", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-opencode-ambiguous-"));
  try {
    fs.writeFileSync(path.join(root, "opencode.json"), "{}\n");
    fs.writeFileSync(path.join(root, "opencode.jsonc"), "{}\n");
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = opencode.createOpenCodeAdapter({ hostVersion: "1.18.23", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    assert.deepEqual(observation.issues, [{ code: "ambiguous_project_config", path: "." }]);
    assert.throws(() => adapter.renderInstall(context(target, observation, [NAVIGATION])), (error: any) => error?.code === "ambiguous_project_config");
    assert.equal(fs.existsSync(path.join(root, ".opencode")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
