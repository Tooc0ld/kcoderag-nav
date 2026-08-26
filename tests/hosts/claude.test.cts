const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const claude = require("../../dist/hosts/claude.cjs") as Record<string, any>;
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
    allowLegacyUserRemoval: false,
    allowLegacyDevMigration: false,
  };
}

function uninstallContext(target: any, observation: any, selectedCapabilities: readonly string[]) {
  return {
    target,
    packageRoot: PACKAGE_ROOT,
    environment: "qa",
    observation,
    selectedCapabilities,
    allowLegacyUserRemoval: false,
    allowLegacyDevMigration: false,
  };
}

test("Claude version parser accepts only exact official 2.1.241 output shapes", () => {
  assert.equal(claude.parseClaudeVersionOutput("2.1.241 (Claude Code)\n"), "2.1.241");
  assert.equal(claude.parseClaudeVersionOutput("Claude Code 2.1.241\n"), "2.1.241");
  assert.equal(claude.parseClaudeVersionOutput("claude 2.1.241\n"), "2.1.241");
  for (const invalid of [
    "2.1.241 arbitrary",
    "2.1.241 (Claude Code) trailing",
    "Claude Code 2.1.241 9.9.9",
    "version=2.1.241",
    "2.1",
  ]) {
    assert.equal(claude.parseClaudeVersionOutput(invalid), undefined, invalid);
  }
});

test("Claude 2.1.241 renders and partially removes the complete receipt-backed capability set", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-claude-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = claude.createClaudeAdapter({ hostVersion: "2.1.241", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(target, observation, [JX3, NAVIGATION])));

    const statePath = path.join(root, ".claude/kcoderag-nav/install-state.json");
    let state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION, JX3]);
    for (const relativePath of [
      ".mcp.json",
      ".claude/settings.json",
      ".claude/skills/kcoderag-nav/SKILL.md",
      ".claude/skills/jx3-code-style-correction/SKILL.md",
      ".claude/skills/jx3-code-style-correction/references/cpp-lifetime-control-flow.md",
      ".claude/skills/jx3-code-style-correction/references/protocol-serialization-data.md",
      ".claude/skills/jx3-code-style-correction/references/lua-contracts.md",
      ".claude/skills/jx3-code-style-correction/references/change-hygiene-self-review.md",
      ".claude/kcoderag-nav/qa/hooks/jx3-style-nudge.cjs",
      ".claude/kcoderag-nav/qa/hooks/pre-tool-dispatcher.cjs",
      ".claude/kcoderag-nav/qa/hooks/once-marker.cjs",
      ".claude/kcoderag-nav/qa/hooks/update-notice.cjs",
    ]) {
      assert.equal(fs.existsSync(path.join(root, ...relativePath.split("/"))), true, relativePath);
    }
    const settings = JSON.parse(fs.readFileSync(path.join(root, ".claude/settings.json"), "utf8"));
    assert.match(JSON.stringify(settings), /PreToolUse/u);
    assert.match(JSON.stringify(settings), /PostToolUse/u);

    const installed = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderUninstall(uninstallContext(target, installed, [JX3])));
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION]);
    assert.equal(fs.existsSync(path.join(root, ".claude/skills/jx3-code-style-correction/SKILL.md")), false);
    assert.equal(fs.existsSync(path.join(root, ".claude/skills/kcoderag-nav/SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(root, ".claude/kcoderag-nav/qa/hooks/update-notice.cjs")), true);
    assert.equal(fs.existsSync(path.join(root, ".mcp.json")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Claude support is exact and managed JX3 drift is capability_drift", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-claude-drift-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const unsupported = claude.createClaudeAdapter({ hostVersion: "2.1.242", evidenceRoot: PACKAGE_ROOT });
    assert.throws(
      () => unsupported.renderInstall(context(
        target,
        unsupported.detect({ target, packageRoot: PACKAGE_ROOT }),
        [JX3],
      )),
      (error: any) => error?.code === "host_version_unsupported",
    );
    assert.deepEqual(fs.readdirSync(root), []);

    const adapter = claude.createClaudeAdapter({ hostVersion: "2.1.241", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(target, observation, [JX3])));
    const reference = ".claude/skills/jx3-code-style-correction/references/lua-contracts.md";
    fs.appendFileSync(path.join(root, ...reference.split("/")), "\ndrift\n");
    const drifted = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    assert.deepEqual(drifted.issues, [{ code: "capability_drift", path: reference }]);
    assert.equal(adapter.status({ target, packageRoot: PACKAGE_ROOT, environment: "qa", observation: drifted, doctor: true }).status, "drifted");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Claude extra JX3 overrides are visible read-only as capability drift", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-claude-extra-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = claude.createClaudeAdapter({ hostVersion: "2.1.241", evidenceRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(
      target,
      adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
      [JX3],
    )));
    const extra = ".claude/skills/jx3-code-style-correction/override.md";
    fs.writeFileSync(path.join(root, ...extra.split("/")), "override\n");
    assert.deepEqual(adapter.detect({ target, packageRoot: PACKAGE_ROOT }).issues, [
      { code: "capability_drift", path: extra },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
