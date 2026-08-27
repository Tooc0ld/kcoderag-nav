const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const zcode = require("../../dist/hosts/zcode.cjs") as Record<string, any>;
const projectTarget = require("../../dist/core/project-target.cjs") as Record<string, any>;
const transaction = require("../../dist/core/transaction.cjs") as Record<string, any>;
const PACKAGE_ROOT = path.resolve(".");
const NAVIGATION = "kcoderag-navigation";
const JX3 = "jx3-style-nudge";

function context(target: any, observation: any, selectedCapabilities: readonly string[], command = "install") {
  return { target, packageRoot: PACKAGE_ROOT, command, environment: "qa", observation, selectedCapabilities };
}

test("ZCode projects native workspace MCP and Skill without claiming project Hook support", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-zcode-"));
  try {
    const configPath = path.join(root, ".zcode", "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const original = `${JSON.stringify({
      theme: "dark",
      mcp: { servers: { memory: { command: "memory-server", args: [] } } },
    }, null, 2)}\n`;
    fs.writeFileSync(configPath, original);
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = zcode.createZCodeAdapter({ hostVersion: "0.0.0", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });

    assert.throws(
      () => adapter.renderInstall(context(target, observation, [JX3])),
      (error: any) => error?.code === "host_version_unsupported",
    );
    assert.equal(fs.readFileSync(configPath, "utf8"), original);

    await transaction.applyTransaction(adapter.renderInstall(context(target, observation, [NAVIGATION])));
    const state = JSON.parse(fs.readFileSync(path.join(root, ".zcode/kcoderag-nav/install-state.json"), "utf8"));
    assert.equal(state.host, "zcode");
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION]);

    const rendered = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(rendered.theme, "dark");
    assert.deepEqual(rendered.mcp.servers.memory, { command: "memory-server", args: [] });
    assert.equal(rendered.mcp.servers["kcoderag-qa"].type, "http");
    assert.equal("enable" in rendered.mcp.servers["kcoderag-qa"], false);
    assert.equal(typeof rendered.mcp.servers["kcoderag-qa"].url, "string");
    assert.equal(typeof rendered.mcp.servers["kcoderag-qa"].headers.Authorization, "string");
    assert.equal(fs.existsSync(path.join(root, ".zcode/skills/kcoderag-nav/SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(root, ".zcode/kcoderag-nav/hooks")), false);
    assert.equal("hooks" in rendered, false);

    const installed = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    assert.equal(adapter.status({
      target,
      packageRoot: PACKAGE_ROOT,
      environment: "qa",
      observation: installed,
      doctor: true,
    }).status, "healthy");
    await transaction.applyTransaction(adapter.renderInstall(context(target, installed, [NAVIGATION], "update")));

    const updated = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderUninstall({
      target,
      packageRoot: PACKAGE_ROOT,
      environment: "qa",
      observation: updated,
      selectedCapabilities: [NAVIGATION],
    }));
    assert.equal(fs.readFileSync(configPath, "utf8"), original);
    assert.equal(fs.existsSync(path.join(root, ".zcode/skills/kcoderag-nav/SKILL.md")), false);
    assert.equal(fs.existsSync(path.join(root, ".zcode/kcoderag-nav/install-state.json")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ZCode refuses unmanaged project identity and user-level duplicate sources before writes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-zcode-conflict-"));
  try {
    const configPath = path.join(root, ".zcode", "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const original = `${JSON.stringify({
      mcp: { servers: { "kcoderag-qa": { type: "http", url: "opaque" } } },
    }, null, 2)}\n`;
    fs.writeFileSync(configPath, original);
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = zcode.createZCodeAdapter({
      hostVersion: "0.0.0",
      readUserSources: () => ({
        rawMcpPaths: [".zcode/cli/config.json"],
        manualHookPaths: [".zcode/cli/config.json"],
        ambiguousPaths: [".zcode/skills/kcoderag-nav/SKILL.md"],
      }),
    });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    assert.throws(
      () => adapter.renderInstall(context(target, observation, [NAVIGATION])),
      (error: any) => error?.code === "unmanaged_name_conflict",
    );
    assert.equal(fs.readFileSync(configPath, "utf8"), original);
    assert.equal(fs.existsSync(path.join(root, ".zcode/kcoderag-nav")), false);

    const scan = await adapter.scanUserSources({
      target,
      packageRoot: PACKAGE_ROOT,
      observation,
      mode: "gate",
    });
    assert.equal(scan.hasConflict, true);
    assert.deepEqual(scan.findings.map((finding: any) => finding.code), [
      "manual_hook_source",
      "raw_mcp_source",
      "ambiguous_source",
    ]);
    assert.equal("cleanupOwnedSource" in adapter, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
