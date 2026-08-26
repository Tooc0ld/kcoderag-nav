const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor" | "opencode";

interface MarkerModule {
  readonly MCP_CALL_MARKER_TTL_MS: number;
  readonly MAX_MCP_CALL_MARKERS: number;
  recordKCodeRagCall(payload: unknown, options: {
    readonly host: HostId;
    readonly cacheRoot: string;
    readonly now?: () => number;
    readonly cwd?: string;
  }): { readonly recorded: boolean; readonly key?: string };
}

const marker = require("../../dist/hooks/mcp-call-marker.cjs") as MarkerModule;
const compiledMarker = path.resolve("dist/hooks/mcp-call-marker.cjs");

function fixture(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-marker-"));
}

function markerFiles(root: string): string[] {
  const directory = path.join(root, "mcp-calls");
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

test("records only successful KCodeRag calls for all four host payload shapes", () => {
  const root = fixture();
  try {
    const cases: readonly [HostId, Record<string, unknown>][] = [
      ["codex", { hook_event_name: "PostToolUse", session_id: "codex-s", turn_id: "t", tool_name: "mcp__kcoderag-qa__search_code" }],
      ["claude", { hook_event_name: "PostToolUse", session_id: "claude-s", tool_name: "mcp__kcoderag-qa__context" }],
      ["cursor", { hook_event_name: "afterMCPExecution", conversation_id: "cursor-s", generation_id: "g", mcp_server_name: "kcoderag", tool_name: "search_code" }],
      ["opencode", { sessionID: "open-s", callID: "c", tool: "kcoderag-qa_get_call_chain" }],
    ];
    for (const [host, payload] of cases) {
      const result = marker.recordKCodeRagCall(payload, { host, cacheRoot: root, now: () => 1_000 });
      assert.equal(result.recorded, true, host);
      assert.match(result.key ?? "", /^[0-9a-f]{64}$/u, host);
    }
    assert.equal(markerFiles(root).length, 4);
    const records = markerFiles(root).map((name) =>
      JSON.parse(fs.readFileSync(path.join(root, "mcp-calls", name), "utf8")) as Record<string, unknown>);
    assert.deepEqual(records.map((record) => record.host).sort(), ["claude", "codex", "cursor", "opencode"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unrelated tools, malformed payloads, and write failures are silent and fail open", () => {
  const root = fixture();
  try {
    const cases: readonly [HostId, unknown][] = [
      ["codex", { tool_name: "Bash", session_id: "s" }],
      ["claude", { tool_name: "mcp__other__search", session_id: "s" }],
      ["cursor", { mcp_server_name: "other", conversation_id: "s" }],
      ["opencode", { tool: "other_search", sessionID: "s" }],
      ["opencode", null],
    ];
    for (const [host, payload] of cases) {
      assert.equal(marker.recordKCodeRagCall(payload, { host, cacheRoot: root }).recorded, false);
    }
    const impossibleRoot = path.join(root, "file");
    fs.writeFileSync(impossibleRoot, "not a directory\n");
    assert.equal(marker.recordKCodeRagCall(
      { tool: "kcoderag-qa_search_code", sessionID: "s" },
      { host: "opencode", cacheRoot: impossibleRoot },
    ).recorded, false);
    assert.deepEqual(markerFiles(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("marker files contain no raw session, tool arguments, result, URL, or Bearer", () => {
  const root = fixture();
  const secrets = ["raw-session", "raw-turn", "Bearer SECRET", "https://qa.invalid/mcp", "sensitive-result"];
  try {
    marker.recordKCodeRagCall({
      hook_event_name: "PostToolUse",
      session_id: secrets[0],
      turn_id: secrets[1],
      tool_name: "mcp__kcoderag-qa__search_code",
      tool_input: { Authorization: secrets[2], url: secrets[3] },
      tool_response: secrets[4],
    }, { host: "codex", cacheRoot: root, now: () => 2_000 });
    const bytes = Buffer.concat(markerFiles(root).map((name) =>
      fs.readFileSync(path.join(root, "mcp-calls", name))));
    for (const secret of secrets) assert.equal(bytes.includes(secret), false, secret);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("prunes expired and over-limit markers while keeping the current marker", () => {
  const root = fixture();
  const directory = path.join(root, "mcp-calls");
  const now = 50_000_000;
  try {
    fs.mkdirSync(directory, { recursive: true });
    for (let index = 0; index < marker.MAX_MCP_CALL_MARKERS + 5; index += 1) {
      const name = `${index.toString(16).padStart(64, "0")}.json`;
      const filePath = path.join(directory, name);
      fs.writeFileSync(filePath, "{}\n");
      const age = index === 0 ? marker.MCP_CALL_MARKER_TTL_MS + 1 : index;
      fs.utimesSync(filePath, new Date(now - age), new Date(now - age));
    }
    marker.recordKCodeRagCall(
      { tool: "kcoderag-qa_context", sessionID: "fresh" },
      { host: "opencode", cacheRoot: root, now: () => now },
    );
    const files = markerFiles(root);
    assert.equal(files.length <= marker.MAX_MCP_CALL_MARKERS, true);
    assert.equal(files.includes(`${"0".repeat(64)}.json`), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI entry emits no output and always exits zero for valid, malformed, and oversized stdin", () => {
  const root = fixture();
  try {
    for (const input of [
      JSON.stringify({ tool_name: "mcp__kcoderag-qa__search_code", session_id: "s" }),
      "{not-json",
      "x".repeat(70 * 1024),
    ]) {
      const result = childProcess.spawnSync(process.execPath, [compiledMarker, "codex"], {
        input,
        encoding: "utf8",
        env: { ...process.env, LOCALAPPDATA: root },
      });
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
