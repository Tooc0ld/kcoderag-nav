const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

interface DispatcherModule {
  readonly MAX_ADDITIONAL_CONTEXT_CHARS: number;
  dispatchRawInput(
    rawInput: string,
    contributors?: readonly ((payload: Readonly<Record<string, unknown>>) => string | undefined)[],
    parseInput?: (rawInput: string) => unknown,
  ): Readonly<Record<string, unknown>> | undefined;
  main(
    rawInput?: string,
    writeOutput?: (text: string) => void,
    contributors?: readonly ((payload: Readonly<Record<string, unknown>>) => string | undefined)[],
  ): number;
}

const dispatcher = require("../../dist/hooks/pre-tool-dispatcher.cjs") as DispatcherModule;
const compiledDispatcher = path.resolve("dist/hooks/pre-tool-dispatcher.cjs");

test("dispatcher parses once, isolates contributors, and emits one bounded response", () => {
  let parseCount = 0;
  let observedPayload: Readonly<Record<string, unknown>> | undefined;
  const output = dispatcher.dispatchRawInput(
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: "src/player.cpp" } }),
    [
      (payload) => {
        observedPayload = payload;
        return "navigation";
      },
      () => {
        throw new Error("isolated handler failure");
      },
      (payload) => {
        assert.equal(payload, observedPayload);
        return "x".repeat(dispatcher.MAX_ADDITIONAL_CONTEXT_CHARS);
      },
    ],
    (rawInput) => {
      parseCount += 1;
      return JSON.parse(rawInput) as unknown;
    },
  ) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };

  assert.equal(parseCount, 1);
  assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
  assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(
    output.hookSpecificOutput.additionalContext.length,
    dispatcher.MAX_ADDITIONAL_CONTEXT_CHARS,
  );
  assert.match(output.hookSpecificOutput.additionalContext, /^navigation\n\n/u);
});

test("dispatcher main serializes at most one object and every invalid boundary is silent", () => {
  const writes: string[] = [];
  assert.equal(
    dispatcher.main(
      JSON.stringify({ tool_name: "Write", tool_input: { file_path: "src/player.cpp" } }),
      (text) => writes.push(text),
      [() => "first", () => "second"],
    ),
    0,
  );
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0] ?? "null").hookSpecificOutput.additionalContext, "first\n\nsecond");

  for (const rawInput of ["", "not-json", JSON.stringify([]), "x".repeat(131_073)]) {
    const invalidWrites: string[] = [];
    assert.equal(dispatcher.main(rawInput, (text) => invalidWrites.push(text), [() => "bad"]), 0);
    assert.deepEqual(invalidWrites, []);
  }

  assert.equal(dispatcher.main("{}", () => { throw new Error("output failure"); }, [() => "ok"]), 0);
});

test("direct ZCode process invocation emits strict advisory context and fails open", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-zcode-dispatcher-"));
  try {
    const stateDirectory = path.join(root, ".zcode", "kcoderag-nav");
    fs.mkdirSync(stateDirectory, { recursive: true });
    fs.writeFileSync(path.join(stateDirectory, "install-state.json"), `${JSON.stringify({
      schemaVersion: 1,
      packageVersion: "0.2.2",
      host: "zcode",
    })}\n`);
    const result = childProcess.spawnSync(process.execPath, [compiledDispatcher, "zcode"], {
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "zcode-session",
        cwd: root,
        tool_name: "Grep",
        tool_input: { pattern: "LoginMgr", path: "src" },
      }),
      encoding: "utf8",
      env: { ...process.env, ZCODE_PROJECT_DIR: root },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout) as Record<string, any>;
    assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
    assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(typeof output.hookSpecificOutput.additionalContext, "string");
    assert.equal("permissionDecision" in output.hookSpecificOutput, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
