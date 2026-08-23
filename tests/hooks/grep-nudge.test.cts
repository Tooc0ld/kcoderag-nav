const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const path = require("node:path") as typeof import("node:path");

interface HookModule {
  readonly NUDGE: string;
  looksLikeSymbolLookup(pattern: unknown): boolean;
  shellLookupPatterns(command: unknown): readonly string[];
  lookupPatterns(toolInput: unknown): readonly string[];
  hookOutput(data: unknown, updateNotice?: string): Record<string, unknown> | undefined;
  main(rawInput?: string, writeOutput?: (text: string) => void): number;
}

const hook = require("../../dist/hooks/grep-nudge.cjs") as HookModule;
const compiledHook = path.resolve("dist/hooks/grep-nudge.cjs");

const patternCases: readonly (readonly [unknown, boolean])[] = [
  ["GetLevel", true],
  ["KPlayer::GetLevel", true],
  [String.raw`\bGetLevel\b`, true],
  [String.raw`GetLevel\s*\(`, true],
  [String.raw`\.GetLevel\(`, true],
  [":GetLevel(", true],
  [String.raw`\bGet.*\b`, true],
  ["GetLevel|GetHP", true],
  ["class KPlayer", true],
  ["获取玩家信息", true],
  ["foo.bar.*", false],
  ["s/old/new/g", false],
  ["m_nLevel = 123", false],
  ["TODO.*fixme", false],
  ["player.cpp", false],
  ["if.*return", false],
  ["int.*count", false],
  ["Foo.*Bar", false],
  ["default", false],
  [null, false],
  ["", false],
];

const commandCases: readonly (readonly [unknown, boolean])[] = [
  ['rg -n "KPlayer::GetLevel" src', true],
  ['rg --glob "*.cpp" "GetLevel\\s*\\(" src', true],
  ["git grep -n GetLevel", true],
  ["Select-String -Path *.cpp -Pattern GetLevel", true],
  ["findstr /S /N GetLevel *.cpp", true],
  ['findstr /C:"GetLevel" *.cpp', true],
  ['rg --files -g "*KPlayer*"', true],
  ['rg --files -g"*KPlayer*"', true],
  ['Get-ChildItem -Recurse -Filter "KPlayer*"', true],
  ['Get-ChildItem -Recurse "KPlayer*"', true],
  ['rg --files -g "*.cpp"', false],
  ["rg -n TODO src", false],
  ["rg -n -C 2 GetLevel src", true],
  ["rg -n -c GetLevel src", true],
  ["rg -eGetLevel src", true],
  ["rg -- -GetLevel src", true],
  ['pwsh -Command "rg GetLevel src"', true],
  ["rg GetLevel one.cpp", false],
  ["rg error_message logs", false],
  ["pytest -q", false],
  ['rg -n "m_nLevel = 123" src', false],
  ["rg GetLevel src && rg TODO src", true],
  ["rg GetLevel src | Select-String KPlayer", true],
  ["rg 'unterminated", false],
  [null, false],
];

test("Python pattern corpus retains exact structural classification", () => {
  for (const [pattern, expected] of patternCases) {
    assert.equal(hook.looksLikeSymbolLookup(pattern), expected, String(pattern));
  }

  const adversarialSubstitution = `s/${"/".repeat(16_000)}!`;
  const started = process.hrtime.bigint();
  assert.equal(hook.looksLikeSymbolLookup(adversarialSubstitution), false);
  const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
  assert.ok(elapsedMilliseconds < 250, `classification took ${elapsedMilliseconds}ms`);
});

test("Python shell corpus retains Grep, Glob, Bash, Windows, and POSIX normalization", () => {
  for (const [command, expected] of commandCases) {
    const patterns = hook.shellLookupPatterns(command);
    assert.equal(patterns.some((pattern) => hook.looksLikeSymbolLookup(pattern)), expected, String(command));
  }

  assert.deepEqual(hook.shellLookupPatterns(`rg GetLevel ${"x".repeat(65_536)}`), []);
  assert.deepEqual(hook.lookupPatterns({ command: ["git", "grep", "GetLevel"] }), ["GetLevel"]);
  assert.deepEqual(hook.lookupPatterns({ pattern: "KPlayer::GetLevel", command: "rg ignored" }), ["KPlayer::GetLevel"]);
});

test("hook protocol emits only bounded advisory JSON and stays silent otherwise", () => {
  const claude = hook.hookOutput({ tool_name: "Grep", tool_input: { pattern: "GetLevel" } });
  const codex = hook.hookOutput({ tool_name: "Bash", tool_input: { command: "rg -n GetLevel src" } });
  assert.ok(claude !== undefined);
  assert.ok(codex !== undefined);
  assert.equal(hook.hookOutput({ tool_name: "Bash", tool_input: { command: "rg -n TODO src" } }), undefined);
  assert.equal(hook.hookOutput({ tool_name: "Unknown", tool_input: { pattern: "GetLevel" } }), undefined);
  assert.equal(hook.hookOutput({ tool_input: [] }), undefined);

  const combined = hook.hookOutput(
    { tool_name: "Grep", tool_input: { pattern: "GetLevel" } },
    "Update available",
  ) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.deepEqual(Object.keys(combined), ["hookSpecificOutput"]);
  assert.equal(combined.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.ok(combined.hookSpecificOutput.additionalContext.length <= 600);
  assert.match(combined.hookSpecificOutput.additionalContext, /Update available/);
  assert.match(hook.NUDGE, /search_code/);
  assert.match(hook.NUDGE, /get_call_chain/);
  assert.match(hook.NUDGE, /unavailable/);
  assert.doesNotMatch(hook.NUDGE, /QA and Dev|mcp__plugin_/);
});

test("compiled entry fails open for malformed, oversized, unknown, and exceptional input", () => {
  for (const input of [
    "not-json",
    "",
    JSON.stringify(["not", "a", "mapping"]),
    JSON.stringify({ tool_name: "Unknown", tool_input: { pattern: "GetLevel" } }),
    "x".repeat(131_073),
  ]) {
    const result = childProcess.spawnSync(process.execPath, [compiledHook], {
      input,
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }

  assert.equal(hook.main(JSON.stringify({ tool_input: { pattern: "GetLevel" } }), () => {
    throw new Error("injected output failure");
  }), 0);
});

test("compiled entry emits one protocol object without diagnostics", () => {
  const payload = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "git grep KPlayer::GetLevel" },
  });
  const result = childProcess.spawnSync(process.execPath, [compiledHook], {
    input: payload,
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  assert.equal(parsed.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(parsed.hookSpecificOutput.additionalContext, /Structural lookup/);
  assert.equal(result.stdout.trim().split("\n").length, 1);
});
