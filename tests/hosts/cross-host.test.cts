const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor" | "opencode" | "zcode";
const registry = require("../../dist/hosts/index.cjs") as Record<string, any>;
const codex = require("../../dist/hosts/codex.cjs") as Record<string, any>;
const claude = require("../../dist/hosts/claude.cjs") as Record<string, any>;
const cursor = require("../../dist/hosts/cursor.cjs") as Record<string, any>;
const opencode = require("../../dist/hosts/opencode.cjs") as Record<string, any>;
const zcode = require("../../dist/hosts/zcode.cjs") as Record<string, any>;
const targets = require("../../dist/core/project-target.cjs") as Record<string, any>;
const transaction = require("../../dist/core/transaction.cjs") as Record<string, any>;
const PACKAGE_ROOT = path.resolve(".");
const NAVIGATION = "kcoderag-navigation";
const CODE_STYLE = "code-style-nudge";

function digestTree(root: string, relativePaths: readonly string[]): readonly string[] {
  const output: string[] = [];
  const visit = (absolute: string, logical: string): void => {
    if (!fs.existsSync(absolute)) return;
    const metadata = fs.lstatSync(absolute);
    if (metadata.isFile()) {
      output.push(`${logical}:${crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")}:${metadata.mtimeMs}`);
      return;
    }
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      visit(path.join(absolute, entry.name), `${logical}/${entry.name}`);
    }
  };
  for (const relativePath of relativePaths) visit(path.join(root, ...relativePath.split("/")), relativePath);
  return Object.freeze(output);
}

function snapshot(root: string, host: HostId): readonly string[] {
  if (host === "codex") return digestTree(root, [".codex", ".agents"]);
  if (host === "claude") return digestTree(root, [".claude", ".mcp.json"]);
  if (host === "cursor") return digestTree(root, [".cursor"]);
  if (host === "opencode") return digestTree(root, [".opencode", "opencode.json", "opencode.jsonc"]);
  return digestTree(root, [".zcode"]);
}

function adapter(host: HostId): any {
  const common = { evidenceRoot: PACKAGE_ROOT, readUserSources: () => ({}) };
  if (host === "codex") return codex.createCodexAdapter({ ...common, hostVersion: "0.146.1" });
  if (host === "claude") return claude.createClaudeAdapter({ ...common, hostVersion: "2.1.241" });
  if (host === "cursor") return cursor.createCursorAdapter({ ...common, hostVersion: "3.17.8" });
  if (host === "opencode") return opencode.createOpenCodeAdapter({ ...common, hostVersion: "1.18.23" });
  return zcode.createZCodeAdapter({ ...common, hostVersion: "0.0.0" });
}

function installContext(target: any, observation: any, selectedCapabilities: readonly string[]) {
  return { target, packageRoot: PACKAGE_ROOT, command: "install", environment: "qa", observation, selectedCapabilities };
}

test("registry exposes manual style on every host and exact-receipt native automation", async () => {
  assert.deepEqual(registry.HOST_ADAPTERS.map((entry: any) => entry.id), ["codex", "claude", "cursor", "opencode", "zcode"]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-matrix-"));
  try {
    const target = targets.resolveProjectTarget(root);
    const evidence: Array<{
      readonly host: HostId;
      readonly layer: "packaged";
      readonly manualSkill: string;
      readonly automaticNudge: string;
      readonly navigationPreserved: boolean;
    }> = [];
    for (const host of ["codex", "cursor", "opencode", "zcode"] as const) {
      const current = adapter(host);
      await transaction.applyTransaction(current.renderInstall(installContext(
        target,
        current.detect({ target, packageRoot: PACKAGE_ROOT }),
        [NAVIGATION],
      )));
      await transaction.applyTransaction(current.renderInstall(installContext(
        target,
        current.detect({ target, packageRoot: PACKAGE_ROOT }),
        [CODE_STYLE],
      )));
      const observation = current.detect({ target, packageRoot: PACKAGE_ROOT });
      const status = current.status({ target, packageRoot: PACKAGE_ROOT, environment: "qa", observation });
      evidence.push(Object.freeze({
        host,
        layer: "packaged",
        manualSkill: status.codeStyle.manualSkill,
        automaticNudge: status.codeStyle.automaticNudge,
        navigationPreserved: observation.currentState?.capabilities.some(
          (entry: any) => entry.id === NAVIGATION,
        ) === true,
      }));
    }
    assert.deepEqual(evidence, [
      { host: "codex", layer: "packaged", manualSkill: "available", automaticNudge: "unsupported", navigationPreserved: true },
      { host: "cursor", layer: "packaged", manualSkill: "available", automaticNudge: "unsupported", navigationPreserved: true },
      { host: "opencode", layer: "packaged", manualSkill: "available", automaticNudge: "unsupported", navigationPreserved: true },
      { host: "zcode", layer: "packaged", manualSkill: "available", automaticNudge: "unsupported", navigationPreserved: true },
    ]);
    const current = adapter("claude");
    const desired = current.renderInstall(installContext(target, current.detect({ target, packageRoot: PACKAGE_ROOT }), [CODE_STYLE]));
    assert.equal(desired.host, "claude");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("five hosts coexist and one-host capability removal leaves every sibling byte unchanged", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-five-host-"));
  try {
    fs.writeFileSync(path.join(root, "opencode.jsonc"), "{\n  // keep\n}\n");
    const target = targets.resolveProjectTarget(root);
    const adapters = Object.fromEntries((["codex", "claude", "cursor", "opencode", "zcode"] as const).map((host) => [host, adapter(host)])) as Record<HostId, any>;
    for (const host of ["codex", "cursor", "opencode", "zcode"] as const) {
      const current = adapters[host];
      await transaction.applyTransaction(current.renderInstall(installContext(target, current.detect({ target, packageRoot: PACKAGE_ROOT }), [NAVIGATION])));
    }
    await transaction.applyTransaction(adapters.claude.renderInstall(installContext(target, adapters.claude.detect({ target, packageRoot: PACKAGE_ROOT }), [NAVIGATION, CODE_STYLE])));

    for (const host of ["codex", "claude", "cursor", "opencode", "zcode"] as const) {
      const observation = adapters[host].detect({ target, packageRoot: PACKAGE_ROOT });
      assert.equal(adapters[host].status({ target, packageRoot: PACKAGE_ROOT, environment: "qa", observation, doctor: true }).status, "healthy", host);
    }
    const before = Object.fromEntries((["codex", "cursor", "opencode", "zcode"] as const).map((host) => [host, snapshot(root, host)])) as Record<string, readonly string[]>;
    const claudeInstalled = adapters.claude.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapters.claude.renderUninstall({ target, packageRoot: PACKAGE_ROOT, environment: "qa", observation: claudeInstalled, selectedCapabilities: [CODE_STYLE] }));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".claude/kcoderag-nav/install-state.json"), "utf8")).capabilities.map((entry: any) => entry.id), [NAVIGATION]);
    for (const host of ["codex", "cursor", "opencode", "zcode"] as const) assert.deepEqual(snapshot(root, host), before[host], host);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
