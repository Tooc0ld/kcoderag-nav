const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const commands = require("../../dist/cli/commands.cjs") as Record<string, any>;
const state = require("../../dist/core/state.cjs") as Record<string, any>;
const projectTarget = require("../../dist/core/project-target.cjs") as Record<string, any>;
const sources = require("../../dist/hosts/user-sources.cjs") as Record<string, any>;
const codex = require("../../dist/hosts/codex.cjs") as Record<string, any>;
const claude = require("../../dist/hosts/claude.cjs") as Record<string, any>;
const cursor = require("../../dist/hosts/cursor.cjs") as Record<string, any>;
const opencode = require("../../dist/hosts/opencode.cjs") as Record<string, any>;

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

function writeNativeSource(homeDirectory: string, relativePath: string, content: string | Buffer): void {
  const absolutePath = path.join(homeDirectory, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

const NATIVE_SOURCE_CASES = Object.freeze([
  {
    name: "Codex raw MCP registration",
    host: "codex" as const,
    expectedPath: ".codex/config.toml",
    expectedFinding: "raw_mcp_source",
    arrange(home: string) {
      writeNativeSource(home, ".codex/config.toml", [
        "[mcp_servers.kcoderag-qa]",
        `url = "${SECRET_CANARIES[0]}"`,
        `http_headers = { Authorization = "${SECRET_CANARIES[1]}" }`,
        "",
      ].join("\n"));
    },
  },
  {
    name: "Claude legacy hook registration",
    host: "claude" as const,
    expectedPath: ".claude/settings.json",
    expectedFinding: "manual_hook_source",
    arrange(home: string) {
      writeNativeSource(home, ".claude/settings.json", JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "python /legacy/grep_nudge.py" }] }] },
        env: { MCP_URL: SECRET_CANARIES[0], AUTHORIZATION: SECRET_CANARIES[1] },
      }));
    },
  },
  {
    name: "Cursor manual Rule identity",
    host: "cursor" as const,
    expectedPath: ".cursor/rules/kcoderag-manual.mdc",
    expectedFinding: "manual_rule_source",
    arrange(home: string) {
      writeNativeSource(home, ".cursor/rules/kcoderag-manual.mdc", SECRET_CANARIES.join("\n"));
    },
  },
  {
    name: "OpenCode active plugin registration",
    host: "opencode" as const,
    expectedPath: ".config/opencode/opencode.json",
    expectedFinding: "active_plugin_source",
    arrange(home: string) {
      writeNativeSource(home, ".config/opencode/opencode.json", JSON.stringify({
        plugin: ["./plugins/kcoderag-nav.js"],
        mcp: { unrelated: { url: SECRET_CANARIES[0], headers: { Authorization: SECRET_CANARIES[1] } } },
      }));
    },
  },
  {
    name: "OpenCode JSON and JSONC ambiguity",
    host: "opencode" as const,
    expectedPath: ".config/opencode/opencode.json",
    expectedFinding: "ambiguous_source",
    arrange(home: string) {
      writeNativeSource(home, ".config/opencode/opencode.json", "{}\n");
      writeNativeSource(home, ".config/opencode/opencode.jsonc", "{}\n");
    },
  },
  {
    name: "bounded oversized Codex hook configuration",
    host: "codex" as const,
    expectedPath: ".codex/hooks.json",
    expectedFinding: "ambiguous_source",
    arrange(home: string) {
      writeNativeSource(home, ".codex/hooks.json", Buffer.alloc(sources.MAX_NATIVE_SOURCE_BYTES + 1, 0x78));
    },
  },
] as const);

function nativeAdapter(host: HostId, homeDirectory: string): Record<string, unknown> {
  if (host === "codex") return codex.createCodexAdapter({ homeDirectory });
  if (host === "claude") return claude.createClaudeAdapter({ homeDirectory });
  if (host === "cursor") return cursor.createCursorAdapter({ homeDirectory });
  return opencode.createOpenCodeAdapter({ homeDirectory });
}

test("filesystem-backed adapters structurally gate bounded native sources for every mutation", async () => {
  for (const sourceCase of NATIVE_SOURCE_CASES) {
    for (const command of ["install", "update", "uninstall"] as const) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-native-source-red-"));
      const home = path.join(root, "home");
      const target = path.join(root, "project");
      fs.mkdirSync(home);
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, "unrelated.txt"), "preserve\n");
      sourceCase.arrange(home);
      try {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const exitCode = await commands.executeCommand([
          command,
          "--host", sourceCase.host,
          "--capability", NAVIGATION,
          "--yes",
          "--json",
        ], {
          cwd: target,
          packageRoot: path.resolve("."),
          nodeVersion: "22.0.0",
          mutationLockRoot: path.join(root, "locks"),
          stdout: (text: string) => stdout.push(text),
          stderr: (text: string) => stderr.push(text),
          getAdapter: (host: HostId) => {
            assert.equal(host, sourceCase.host);
            return nativeAdapter(host, home);
          },
        });
        assert.equal(exitCode, 1, `${sourceCase.name}: ${command}`);
        assert.equal(stdout.length, 1, `${sourceCase.name}: ${command}`);
        assert.equal(stderr.length, 0, `${sourceCase.name}: ${command}`);
        const output = JSON.parse(stdout[0] as string) as Record<string, any>;
        assert.equal(output.error.code, "source_conflict", `${sourceCase.name}: ${command}`);
        assert.equal(output.error.path, sourceCase.expectedPath, `${sourceCase.name}: ${command}`);
        assert.deepEqual(fs.readdirSync(target), ["unrelated.txt"], `${sourceCase.name}: ${command}`);
        for (const canary of SECRET_CANARIES) {
          assert.equal(stdout[0]?.includes(canary), false, `${sourceCase.name}: ${command}`);
          assert.equal(stderr.some((line) => line.includes(canary)), false, `${sourceCase.name}: ${command}`);
        }
        const adapter = nativeAdapter(sourceCase.host, home) as Record<string, any>;
        const observation = adapter.detect({ target: projectTarget.resolveProjectTarget(target) });
        const scan = await adapter.scanUserSources({
          target: observation.target,
          packageRoot: path.resolve("."),
          observation,
          mode: "gate",
        });
        assert.equal(scan.findings.some((finding: Record<string, unknown>) =>
          finding.code === sourceCase.expectedFinding && finding.safePath === sourceCase.expectedPath), true);
        assert.equal(JSON.stringify(scan).includes(SECRET_CANARIES[0] as string), false);
        assert.equal(JSON.stringify(scan).includes(SECRET_CANARIES[1] as string), false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});
