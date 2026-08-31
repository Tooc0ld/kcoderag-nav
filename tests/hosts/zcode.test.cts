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
const CODE_STYLE = "code-style-nudge";

function context(target: any, observation: any, selectedCapabilities: readonly string[], command = "install") {
  return { target, packageRoot: PACKAGE_ROOT, command, environment: "qa", observation, selectedCapabilities };
}

test("ZCode projects native workspace MCP, Skill, advisory Hook, marker, and update runtime", async () => {
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
      () => adapter.renderInstall(context(target, observation, [CODE_STYLE])),
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
    assert.equal(rendered.mcp.servers["kcoderag-qa"].url.endsWith("/"), false);
    assert.equal(typeof rendered.mcp.servers["kcoderag-qa"].headers.Authorization, "string");
    assert.equal(fs.existsSync(path.join(root, ".zcode/skills/kcoderag-nav/SKILL.md")), true);
    assert.equal(rendered.hooks.enabled, true);
    assert.equal(rendered.hooks.events.PreToolUse.length, 1);
    assert.equal(rendered.hooks.events.PostToolUse.length, 1);
    const pre = rendered.hooks.events.PreToolUse[0];
    assert.equal(pre.matcher, "^(Grep|Glob|Bash)$");
    assert.deepEqual(pre.hooks, [{
      type: "process",
      command: "node",
      args: ["${ZCODE_PROJECT_DIR}/.zcode/kcoderag-nav/hooks/pre-tool-dispatcher.cjs", "zcode"],
      timeoutMs: 5_000,
    }]);
    const post = rendered.hooks.events.PostToolUse[0];
    assert.equal(post.matcher, "^(mcp__kcoderag[-_]qa__.+|kcoderag[-_]qa[._/].+|krag[._/].+)$");
    assert.deepEqual(post.hooks, [{
      type: "process",
      command: "node",
      args: ["${ZCODE_PROJECT_DIR}/.zcode/kcoderag-nav/hooks/mcp-call-marker.cjs", "zcode"],
      timeoutMs: 5_000,
    }]);
    for (const relativePath of [
      ".zcode/kcoderag-nav/hooks/pre-tool-dispatcher.cjs",
      ".zcode/kcoderag-nav/hooks/grep-nudge.cjs",
      ".zcode/kcoderag-nav/hooks/code-style-nudge.cjs",
      ".zcode/kcoderag-nav/hooks/once-marker.cjs",
      ".zcode/kcoderag-nav/hooks/update-check.cjs",
      ".zcode/kcoderag-nav/hooks/update-notice.cjs",
      ".zcode/kcoderag-nav/hooks/update-worker.cjs",
      ".zcode/kcoderag-nav/hooks/mcp-call-marker.cjs",
    ]) assert.equal(fs.existsSync(path.join(root, ...relativePath.split("/"))), true, relativePath);
    assert.equal(fs.existsSync(path.join(root, ".zcode/skills/code-style-correction/SKILL.md")), false);
    assert.deepEqual({
      host: "zcode",
      layer: "packaged",
      hostVersion: "pending_phase_06",
      zeroWrite: true,
      navigationPreserved: true,
    }, {
      host: state.host,
      layer: "packaged",
      hostVersion: "pending_phase_06",
      zeroWrite: true,
      navigationPreserved: state.capabilities.some((entry: any) => entry.id === NAVIGATION),
    });
    assert.deepEqual(state.sections.map((entry: any) => entry.id), [
      "navigation:hooks-enabled",
      "navigation:mcp",
      "navigation:post-tool",
      "navigation:pre-tool",
    ]);

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

test("ZCode preserves existing workspace Hooks without claiming the enabled flag", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-zcode-hooks-"));
  try {
    const configPath = path.join(root, ".zcode", "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const existingPre = { matcher: "Read", hooks: [{ type: "process", command: "node", args: ["keep.js"] }] };
    const existingSession = { matcher: "startup", hooks: [{ type: "process", command: "node", args: ["session.js"] }] };
    const original = `${JSON.stringify({
      hooks: {
        enabled: true,
        timeoutMs: 7_000,
        events: { PreToolUse: [existingPre], SessionStart: [existingSession] },
      },
    }, null, 2)}\n`;
    fs.writeFileSync(configPath, original);
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = zcode.createZCodeAdapter({ hostVersion: "0.0.0", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });

    await transaction.applyTransaction(adapter.renderInstall(context(target, observation, [NAVIGATION])));
    const rendered = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(rendered.hooks.timeoutMs, 7_000);
    assert.deepEqual(rendered.hooks.events.SessionStart, [existingSession]);
    assert.deepEqual(rendered.hooks.events.PreToolUse[0], existingPre);
    const state = JSON.parse(fs.readFileSync(path.join(root, ".zcode/kcoderag-nav/install-state.json"), "utf8"));
    assert.equal(state.sections.some((entry: any) => entry.id === "navigation:hooks-enabled"), false);

    const installed = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderUninstall({
      target,
      packageRoot: PACKAGE_ROOT,
      environment: "qa",
      observation: installed,
      selectedCapabilities: [NAVIGATION],
    }));
    assert.equal(fs.readFileSync(configPath, "utf8"), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ZCode refuses an unmanaged Hook that targets the managed runtime", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-zcode-hook-conflict-"));
  try {
    const configPath = path.join(root, ".zcode", "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const original = `${JSON.stringify({
      hooks: {
        enabled: true,
        events: {
          PreToolUse: [{
            matcher: "Grep",
            hooks: [{
              type: "process",
              command: "node",
              args: ["${ZCODE_PROJECT_DIR}/.zcode/kcoderag-nav/hooks/manual.cjs"],
            }],
          }],
        },
      },
    }, null, 2)}\n`;
    fs.writeFileSync(configPath, original);
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = zcode.createZCodeAdapter({ hostVersion: "0.0.0", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });

    assert.throws(
      () => adapter.renderInstall(context(target, observation, [NAVIGATION])),
      (error: any) => error?.code === "unmanaged_name_conflict",
    );
    assert.equal(fs.readFileSync(configPath, "utf8"), original);
    assert.equal(fs.existsSync(path.join(root, ".zcode/kcoderag-nav")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
