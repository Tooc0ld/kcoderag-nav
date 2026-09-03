const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor" | "opencode" | "zcode";
type LogicalTool = "search_code" | "context" | "get_call_chain" | "list_indexes" | "submit_feedback";

interface NavigationModule {
  navigationContribution(
    payload: unknown,
    updateNotice?: string,
    options?: { readonly host: HostId; readonly managedRoot: string; readonly cacheRoot: string },
  ): string | undefined;
}

interface FeedbackModule {
  readonly FEEDBACK_NUDGE: string;
  normalizeKCodeRagOutcome(
    payload: unknown,
    options: { readonly host: HostId },
  ): { readonly toolName: LogicalTool; readonly success: boolean; readonly usableIndex: boolean } | undefined;
  feedbackNudgeContribution(
    payload: unknown,
    options: { readonly host: HostId; readonly managedRoot: string; readonly cacheRoot: string },
  ): string | undefined;
  indexAvailableForSession(
    payload: unknown,
    options: { readonly host: HostId; readonly managedRoot: string; readonly cacheRoot: string },
  ): boolean;
}

interface MarkerModule {
  recordKCodeRagCall(
    payload: unknown,
    options: { readonly host: HostId; readonly cacheRoot: string; readonly cwd: string },
  ): { readonly recorded: boolean; readonly key?: string };
}

interface CodeStyleModule {
  structuredMutationPaths(payload: unknown): readonly string[];
  codeStyleContribution(
    payload: unknown,
    options: { readonly host: HostId; readonly managedRoot: string; readonly cacheRoot: string },
  ): string | undefined;
}

interface OnceMarkerModule {
  contextEpochForSession(payload: unknown, options: {
    readonly host: HostId;
    readonly managedRoot: string;
    readonly capability: "kcoderag-navigation";
    readonly source: "clear" | "compact";
    readonly cacheRoot: string;
  }): string | undefined;
}

const navigation = require("../../dist/hooks/grep-nudge.cjs") as NavigationModule;
const feedback = require("../../dist/hooks/feedback-nudge.cjs") as FeedbackModule;
const marker = require("../../dist/hooks/mcp-call-marker.cjs") as MarkerModule;
const codeStyle = require("../../dist/hooks/code-style-nudge.cjs") as CodeStyleModule;
const onceMarker = require("../../dist/hooks/once-marker.cjs") as OnceMarkerModule;

function fixture(prefix: string): { readonly root: string; readonly project: string; readonly cache: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const project = path.join(root, "project");
  const cache = path.join(root, "cache");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  return Object.freeze({ root, project, cache });
}

function options(fixtureRoot: ReturnType<typeof fixture>, host: HostId = "codex") {
  return { host, managedRoot: fixtureRoot.project, cacheRoot: fixtureRoot.cache };
}

function codexOutcome(
  toolName: LogicalTool,
  sessionId: string,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    hook_event_name: "PostToolUse",
    session_id: sessionId,
    turn_id: "turn-a",
    tool_name: `mcp__kcoderag-qa__${toolName}`,
    tool_response: { status: "ok" },
    ...extra,
  };
}

function reminderFiles(cacheRoot: string): readonly string[] {
  const directory = path.join(cacheRoot, "nudges");
  return fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((name) => name.endsWith(".claim")).sort()
    : [];
}

test("lookup intent keeps local-only shapes silent and admits only broad structural symbols", () => {
  const localOnly: readonly unknown[] = [
    { tool_name: "Grep", session_id: "s", tool_input: { pattern: "SyntheticSymbol", fixed_string: true, path: "src" } },
    { tool_name: "Bash", session_id: "s", tool_input: { command: "rg -F SyntheticSymbol src" } },
    { tool_name: "Bash", session_id: "s", tool_input: { command: "rg SyntheticSymbol one.cpp two.cpp" } },
    { tool_name: "Grep", session_id: "s", tool_input: { pattern: "SyntheticSymbol", path: "src/one.cpp" } },
    { tool_name: "Grep", session_id: "s", tool_input: { pattern: "SyntheticSymbol", path: "logs" } },
    { tool_name: "Grep", session_id: "s", tool_input: { pattern: "SyntheticSymbol", path: "generated" } },
    { tool_name: "Bash", session_id: "s", tool_input: { command: "git diff -- src/synthetic.cpp" } },
    { tool_name: "Grep", session_id: "s", tool_input: { pattern: "SyntheticSymbol", path: "src/components/player/internal" } },
    { tool_name: "Grep", session_id: "s", tool_input: { pattern: "onInit", path: "scripts/player" } },
    { tool_name: "Grep", session_id: "s", tool_input: { pattern: "onUpdate", path: "scripts" } },
  ];
  for (const payload of localOnly) {
    assert.equal(navigation.navigationContribution(payload), undefined, JSON.stringify(payload));
  }

  for (const payload of [
    { tool_name: "Grep", session_id: "cpp", tool_input: { pattern: "SyntheticSymbol", path: "src" } },
    { tool_name: "Bash", session_id: "cpp-shell", tool_input: { command: "rg SyntheticSymbol src" } },
    { tool_name: "Grep", session_id: "lua", tool_input: { pattern: "PlayerState:onEnter", path: "scripts" } },
    { tool_name: "Grep", session_id: "lua-dot", tool_input: { pattern: "PlayerState.onEnter", path: "scripts" } },
  ]) {
    assert.match(navigation.navigationContribution(payload) ?? "", /KCodeRag/u, JSON.stringify(payload));
  }
});

test("structured write shapes are classified before integrity and never claim on ineligible input", () => {
  const current = fixture("kcoderag-semantic-write-");
  try {
    assert.deepEqual(codeStyle.structuredMutationPaths({
      tool_name: "apply_patch",
      tool_input: {
        command: "*** Begin Patch\n*** Update File: docs/readme.md\n@@\n-old\n+new\n*** Add File: src/player.hpp\n+int player;\n*** End Patch",
      },
    }), ["docs/readme.md", "src/player.hpp"]);
    for (const payload of [
      { tool_name: "Bash", session_id: "s", tool_input: { command: "echo x > src/player.cpp" } },
      { tool_name: "Write", session_id: "s", tool_input: { file_path: "docs/readme.md" } },
      { tool_name: "Write", session_id: "s", tool_input: { file_path: "data/config.json" } },
      { tool_name: "Write", session_id: "s", tool_input: { file_path: "logs/build.log" } },
      { tool_name: "apply_patch", session_id: "s", tool_input: { command: "*** Add File: src/no-envelope.cpp" } },
      { tool_name: "Write", session_id: "s", tool_input: { file_path: "src/player.cpp" } },
    ]) {
      assert.equal(codeStyle.codeStyleContribution(payload, options(current)), undefined);
    }
    assert.deepEqual(reminderFiles(current.cache), []);
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("all five host outcome shapes normalize one bounded logical tool and reliable success", () => {
  const cases: readonly [HostId, Record<string, unknown>, LogicalTool][] = [
    ["codex", codexOutcome("search_code", "codex"), "search_code"],
    ["claude", { hook_event_name: "PostToolUse", session_id: "claude", tool_name: "mcp__kcoderag_qa__context", tool_response: { is_error: false } }, "context"],
    ["cursor", { hook_event_name: "afterMCPExecution", conversation_id: "cursor", mcp_server_name: "kcoderag", tool_name: "get_call_chain", success: true }, "get_call_chain"],
    ["opencode", { sessionID: "open", tool: "kcoderag-qa_search_code", status: "completed" }, "search_code"],
    ["zcode", { hook_event_name: "PostToolUse", session_id: "zcode", tool_name: "krag.context/1", tool_response: { status: "ok" } }, "context"],
  ];
  for (const [host, payload, toolName] of cases) {
    assert.deepEqual(feedback.normalizeKCodeRagOutcome(payload, { host }), {
      toolName,
      success: true,
      usableIndex: false,
    });
  }

  for (const payload of [
    { ...codexOutcome("search_code", "failed"), success: false },
    { ...codexOutcome("search_code", "cancelled"), status: "cancelled" },
    { ...codexOutcome("search_code", "timeout"), timed_out: true },
    { ...codexOutcome("search_code", "error"), error: "redacted" },
    { ...codexOutcome("search_code", "ambiguous"), status: "mystery" },
  ]) {
    assert.equal(feedback.normalizeKCodeRagOutcome(payload, { host: "codex" })?.success, false);
  }
  assert.equal(feedback.normalizeKCodeRagOutcome(
    { ...codexOutcome("cypher" as LogicalTool, "unsupported") },
    { host: "codex" },
  ), undefined);
});

test("successful results prompt once per epoch and submitted feedback suppresses the session", () => {
  const current = fixture("kcoderag-semantic-feedback-");
  const runtime = options(current);
  try {
    const search = codexOutcome("search_code", "feedback-session", {
      tool_input: { query: "SyntheticSymbol" },
      tool_response: { status: "ok", result: "sensitive-result" },
    });
    assert.equal(feedback.feedbackNudgeContribution(search, runtime), feedback.FEEDBACK_NUDGE);
    assert.equal(feedback.feedbackNudgeContribution(search, runtime), undefined);
    assert.equal(onceMarker.contextEpochForSession(search, {
      ...runtime,
      capability: "kcoderag-navigation",
      source: "clear",
    }), "1");
    assert.equal(feedback.feedbackNudgeContribution(search, runtime), feedback.FEEDBACK_NUDGE);

    const submitted = codexOutcome("submit_feedback", "feedback-session");
    assert.equal(feedback.feedbackNudgeContribution(submitted, runtime), undefined);
    assert.equal(onceMarker.contextEpochForSession(search, {
      ...runtime,
      capability: "kcoderag-navigation",
      source: "compact",
    }), "2");
    assert.equal(feedback.feedbackNudgeContribution(search, runtime), undefined);
    assert.equal(
      feedback.feedbackNudgeContribution(codexOutcome("context", "another-session"), runtime),
      feedback.FEEDBACK_NUDGE,
    );

    const stored = Buffer.concat(reminderFiles(current.cache).map((name) =>
      fs.readFileSync(path.join(current.cache, "nudges", name))));
    for (const secret of ["feedback-session", "SyntheticSymbol", "sensitive-result", "submit_feedback"]) {
      assert.equal(stored.includes(secret), false, secret);
    }
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("failures, cancellations, timeouts, and ambiguous results consume no success state", () => {
  const current = fixture("kcoderag-semantic-failures-");
  const runtime = options(current);
  try {
    const excluded = [
      { ...codexOutcome("search_code", "failed"), success: false },
      { ...codexOutcome("context", "cancelled"), status: "cancelled" },
      { ...codexOutcome("get_call_chain", "timeout"), timed_out: true },
      { ...codexOutcome("search_code", "error"), error: "redacted" },
      { ...codexOutcome("search_code", "ambiguous"), status: "mystery" },
      { ...codexOutcome("submit_feedback", "feedback-failed"), success: false },
    ];
    for (const event of excluded) {
      assert.equal(feedback.feedbackNudgeContribution(event, runtime), undefined);
      assert.equal(marker.recordKCodeRagCall(event, {
        host: "codex",
        cwd: current.project,
        cacheRoot: current.cache,
      }).recorded, false);
    }
    assert.deepEqual(reminderFiles(current.cache), []);
    assert.equal(
      feedback.feedbackNudgeContribution(codexOutcome("search_code", "feedback-failed"), runtime),
      feedback.FEEDBACK_NUDGE,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("index availability is session-scoped and gates semantic or hybrid routing", () => {
  const current = fixture("kcoderag-semantic-index-");
  const runtime = options(current);
  try {
    const fallbackPayload = {
      tool_name: "Grep",
      session_id: "no-index",
      tool_input: { pattern: "SyntheticSymbol", path: "src" },
    };
    const fallback = navigation.navigationContribution(fallbackPayload, undefined, runtime) ?? "";
    assert.match(fallback, /keyword.*context.*get_call_chain/isu);
    assert.doesNotMatch(fallback, /semantic|hybrid/iu);

    const available = codexOutcome("list_indexes", "indexed", {
      tool_response: { status: "ok", indexes: [{ name: "qa", status: "ready" }] },
    });
    assert.equal(feedback.feedbackNudgeContribution(available, runtime), undefined);
    assert.equal(feedback.indexAvailableForSession(available, runtime), true);
    const indexedPayload = {
      tool_name: "Grep",
      session_id: "indexed",
      tool_input: { pattern: "SyntheticSymbol", path: "src" },
    };
    assert.match(navigation.navigationContribution(indexedPayload, undefined, runtime) ?? "", /semantic|hybrid/iu);

    for (const event of [
      codexOutcome("list_indexes", "empty", { tool_response: { status: "ok", indexes: [] } }),
      { ...codexOutcome("list_indexes", "failed"), success: false },
      { ...codexOutcome("list_indexes", "ambiguous"), status: "mystery" },
    ]) {
      assert.equal(feedback.feedbackNudgeContribution(event, runtime), undefined);
      assert.equal(feedback.indexAvailableForSession(event, runtime), false);
    }
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("successful result plus exact local verification creates no structural claim or query state", () => {
  const current = fixture("kcoderag-semantic-recheck-");
  const runtime = options(current);
  try {
    const result = codexOutcome("get_call_chain", "recheck", {
      tool_input: { query: "SyntheticSymbol" },
      tool_response: { status: "ok", result: "secret-result" },
    });
    assert.equal(marker.recordKCodeRagCall(result, {
      host: "codex",
      cwd: current.project,
      cacheRoot: current.cache,
    }).recorded, true);
    assert.equal(feedback.feedbackNudgeContribution(result, runtime), feedback.FEEDBACK_NUDGE);
    const before = reminderFiles(current.cache);
    assert.equal(navigation.navigationContribution({
      tool_name: "Grep",
      session_id: "recheck",
      turn_id: "turn-a",
      tool_input: {
        pattern: "SyntheticSymbol",
        path: "src/synthetic.cpp",
        fixed_string: true,
      },
    }, undefined, runtime), undefined);
    assert.deepEqual(reminderFiles(current.cache), before);

    const allCacheBytes = Buffer.concat((function collect(directory: string): Buffer[] {
      const buffers: Buffer[] = [];
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) buffers.push(...collect(absolute));
        else buffers.push(fs.readFileSync(absolute));
      }
      return buffers;
    })(current.cache));
    for (const secret of ["SyntheticSymbol", "secret-result", "src/synthetic.cpp"]) {
      assert.equal(allCacheBytes.includes(secret), false, secret);
    }
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});
