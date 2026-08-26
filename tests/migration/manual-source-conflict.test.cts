const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const commands = require("../../dist/cli/commands.cjs") as Record<string, any>;
const state = require("../../dist/core/state.cjs") as Record<string, any>;
const sources = require("../../dist/hosts/user-sources.cjs") as Record<string, any>;

type HostId = "codex" | "claude" | "cursor" | "opencode";

const NAVIGATION = "kcoderag-navigation";
const SECRET_CANARIES = Object.freeze([
  "https://manual.invalid/mcp?credential=sentinel",
  "Authorization: Bearer sentinel-secret",
  "sentinel subprocess body",
]);

const CONFLICTS = Object.freeze([
  { host: "codex" as const, code: "raw_mcp_source", sourceType: "raw_mcp", safePath: ".codex/mcp" },
  { host: "claude" as const, code: "active_plugin_source", sourceType: "active_plugin", safePath: ".claude/plugins/kcoderag-nav" },
  { host: "cursor" as const, code: "manual_rule_source", sourceType: "manual_rule", safePath: ".cursor/rules/kcoderag.mdc" },
  { host: "opencode" as const, code: "manual_hook_source", sourceType: "manual_hook", safePath: ".config/opencode/hooks/kcoderag.js" },
  { host: "claude" as const, code: "ambiguous_source", sourceType: "ambiguous", safePath: ".claude/kcoderag-nav-state" },
] as const);

function fixtureAdapter(
  conflict: (typeof CONFLICTS)[number],
  calls: string[],
): Record<string, unknown> {
  const host = conflict.host;
  return {
    id: host,
    managedRoots: [`.fixture-${host}`],
    detect(context: Record<string, unknown>) {
      calls.push("detect");
      return { host, target: context.target, details: { canaries: SECRET_CANARIES } };
    },
    scanUserSources(context: Record<string, unknown>) {
      calls.push(`scan:${String(context.mode)}`);
      return sources.createSourceScanResult("gate", [sources.createSourceFinding({
        code: conflict.code,
        severity: "conflict",
        sourceType: conflict.sourceType,
        scope: "user",
        safePath: conflict.safePath,
      })]);
    },
    renderInstall() { calls.push("render"); throw new Error(SECRET_CANARIES[0]); },
    renderUninstall() { calls.push("render"); throw new Error(SECRET_CANARIES[1]); },
    status() { return state.createStatusResult({ host }); },
  };
}

test("every host and mutating command hard-stops manual sources before render with zero writes", async () => {
  for (const conflict of CONFLICTS) {
    for (const command of ["install", "update", "uninstall"] as const) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-manual-source-red-"));
      const target = path.join(root, "project");
      const lockRoot = path.join(root, "locks");
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, "unrelated.txt"), "preserve\n");
      const before = fs.readFileSync(path.join(target, "unrelated.txt"));
      try {
        const calls: string[] = [];
        const stdout: string[] = [];
        const stderr: string[] = [];
        const adapter = fixtureAdapter(conflict, calls);
        const exitCode = await commands.executeCommand([
          command,
          "--host", conflict.host,
          "--capability", NAVIGATION,
          "--yes",
          "--json",
        ], {
          cwd: target,
          packageRoot: path.resolve("."),
          nodeVersion: "22.0.0",
          mutationLockRoot: lockRoot,
          stdout: (text: string) => stdout.push(text),
          stderr: (text: string) => stderr.push(text),
          getAdapter: (host: HostId) => {
            assert.equal(host, conflict.host);
            return adapter;
          },
        });
        assert.equal(exitCode, 1);
        assert.deepEqual(calls, ["detect", "scan:gate"]);
        assert.equal(stdout.length, 1);
        assert.equal(stderr.length, 0);
        const output = JSON.parse(stdout[0] as string) as Record<string, any>;
        assert.equal(output.error.code, "source_conflict");
        assert.equal(output.error.path, conflict.safePath);
        assert.equal(fs.readFileSync(path.join(target, "unrelated.txt")).equals(before), true);
        assert.deepEqual(fs.readdirSync(target), ["unrelated.txt"]);
        for (const canary of SECRET_CANARIES) {
          assert.equal(stdout[0]?.includes(canary), false);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});
