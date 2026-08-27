const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

type HostId = "codex" | "claude" | "cursor" | "opencode";

interface UpdateRuntime {
  readInstalledVersion(statePath?: string): string | undefined;
  readUpdateHint(
    installedVersion: string | undefined,
    options?: { readonly hookPayload?: unknown; readonly host?: HostId },
  ): string | undefined;
  scheduleRefresh(
    hookPayload: unknown,
    options?: { readonly host?: HostId; readonly runtimePath?: string },
  ): boolean;
}

interface NoticeOptions {
  readonly installedVersion?: string;
  readonly statePath?: string;
  readonly runtimePath?: string;
  readonly cwd?: string;
  readonly updateRuntime?: UpdateRuntime;
}

interface UpdateNoticeModule {
  hostPayload(host: HostId, payload: unknown, cwd?: string): Record<string, unknown> | undefined;
  readHostUpdateNotice(host: HostId, payload: unknown, options?: NoticeOptions): string | undefined;
  scheduleHostUpdateRefresh(host: HostId, payload: unknown, options?: NoticeOptions): boolean;
  main(
    argv?: readonly string[],
    rawInput?: string,
    writeOutput?: (text: string) => void,
    options?: NoticeOptions,
  ): number;
}

const notice = require("../../dist/hooks/update-notice.cjs") as UpdateNoticeModule;

function runtime(overrides: Partial<UpdateRuntime> = {}): UpdateRuntime {
  return {
    readInstalledVersion: () => "0.2.2",
    readUpdateHint: () => undefined,
    scheduleRefresh: () => false,
    ...overrides,
  };
}

test("normalizes four hook-capable host payloads into secret-free update identities", () => {
  const cases: readonly [HostId, unknown, string][] = [
    ["codex", { thread_id: "codex-thread", tool_input: { authorization: "Bearer secret" } }, "codex:codex-thread"],
    ["claude", { session_id: "claude-session", tool_input: { url: "https://secret.invalid" } }, "claude:claude-session"],
    ["cursor", { conversation_id: "cursor-conversation", tool_output: "secret output" }, "cursor:cursor-conversation"],
    ["opencode", { sessionID: "opencode-session", input: { token: "secret" } }, "opencode:opencode-session"],
  ];

  for (const [host, payload, sessionId] of cases) {
    assert.deepEqual(notice.hostPayload(host, payload, "C:/project"), {
      tool_name: "Bash",
      tool_input: {},
      session_id: sessionId,
      cwd: "C:/project",
    });
  }
  assert.deepEqual(notice.hostPayload("cursor", {}, "C:/project"), {
    tool_name: "Bash",
    tool_input: {},
    cwd: "[cursor]C:/project",
  });
  assert.equal(notice.hostPayload("cursor", [], "C:/project"), undefined);
});

test("routes an exact host-scoped hint without exposing native payload fields", () => {
  const seen: unknown[] = [];
  const updateRuntime = runtime({
    readUpdateHint: (installedVersion, options) => {
      seen.push(installedVersion, options);
      return "cached update";
    },
  });

  assert.equal(notice.readHostUpdateNotice("opencode", {
    sessionID: "session-a",
    tool: "bash",
    args: { authorization: "Bearer must-not-leak" },
  }, { updateRuntime, cwd: "C:/project" }), "cached update");
  assert.deepEqual(seen, [
    "0.2.2",
    {
      host: "opencode",
      hookPayload: {
        tool_name: "Bash",
        tool_input: {},
        session_id: "opencode:session-a",
        cwd: "C:/project",
      },
    },
  ]);
});

test("uses an explicit Node runtime for OpenCode's detached refresh", () => {
  const seen: unknown[] = [];
  const updateRuntime = runtime({
    scheduleRefresh: (payload, options) => {
      seen.push(payload, options);
      return true;
    },
  });

  assert.equal(notice.scheduleHostUpdateRefresh("opencode", { sessionID: "session-a" }, {
    updateRuntime,
    runtimePath: "node",
    cwd: "C:/project",
  }), true);
  assert.deepEqual(seen, [
    {
      tool_name: "Bash",
      tool_input: {},
      session_id: "opencode:session-a",
      cwd: "C:/project",
    },
    { host: "opencode", runtimePath: "node" },
  ]);
});

test("Cursor protocol emits cached context before scheduling and always fails open", () => {
  const order: string[] = [];
  const output: string[] = [];
  const updateRuntime = runtime({
    readUpdateHint: (_installedVersion, options) => {
      assert.equal(options?.host, "cursor");
      return "KCodeRag Nav update available. Ask first; do not update automatically.";
    },
    scheduleRefresh: () => { order.push("schedule"); return true; },
  });

  assert.equal(notice.main(
    ["cursor"],
    JSON.stringify({ session_id: "cursor-session", cwd: "C:/project" }),
    (text) => { order.push("output"); output.push(text); },
    { updateRuntime },
  ), 0);
  assert.deepEqual(order, ["output", "schedule"]);
  assert.deepEqual(JSON.parse(output[0] ?? ""), {
    additional_context: "KCodeRag Nav update available. Ask first; do not update automatically.",
  });

  for (const [argv, input] of [
    [[], "{}"],
    [["opencode"], "{}"],
    [["cursor"], "not-json"],
    [["cursor", "extra"], "{}"],
  ] as const) {
    assert.equal(notice.main(argv, input, () => { throw new Error("must stay silent"); }, {
      updateRuntime: runtime(),
    }), 0);
  }
});

test("missing installed state suppresses both notice and refresh", () => {
  let readHintCalls = 0;
  let refreshCalls = 0;
  const updateRuntime = runtime({
    readInstalledVersion: () => undefined,
    readUpdateHint: () => { readHintCalls += 1; return "unexpected"; },
    scheduleRefresh: () => { refreshCalls += 1; return true; },
  });

  assert.equal(notice.readHostUpdateNotice("cursor", { session_id: "s" }, { updateRuntime }), undefined);
  assert.equal(notice.scheduleHostUpdateRefresh("cursor", { session_id: "s" }, { updateRuntime }), false);
  assert.equal(readHintCalls, 0);
  assert.equal(refreshCalls, 0);
});
