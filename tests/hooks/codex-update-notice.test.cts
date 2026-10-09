const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const dispatcher = require("../../dist/hooks/pre-tool-dispatcher.cjs") as {
  dispatchRawInput(raw: string, contributors: undefined, parse: typeof JSON.parse,
    runtime: Readonly<Record<string, unknown>>): Record<string, any> | undefined;
};
const worker = require("../../dist/hooks/update-worker.cjs") as {
  REGISTRY_URL: string;
  refreshLatest(options: {
    cacheRoot: string; now: () => number;
    request: () => Promise<{ statusCode: number; url: string; headers: Record<string, string>; body: Buffer }>;
  }): Promise<boolean>;
};

test("Codex emits one visible warning across startup and tool events without changing other hosts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-notice-"));
  const now = 2_000_000_000_000;
  try {
    for (const host of ["codex", "claude", "zcode"] as const) {
      const cacheRoot = path.join(root, host);
      fs.mkdirSync(cacheRoot);
      fs.writeFileSync(path.join(cacheRoot, "remote-cache.json"), JSON.stringify({
        schemaVersion: 1, checkedAt: now, latest: "0.3.9",
      }));
      const runtime = { host, managedRoot: root, cacheRoot, installedVersion: "0.3.8", now: () => now };
      const run = (payload: unknown) => dispatcher.dispatchRawInput(JSON.stringify(payload), undefined, JSON.parse, runtime);
      const first = run({ hook_event_name: "SessionStart", source: "startup", session_id: "fresh" });
      assert.match(first?.hookSpecificOutput?.additionalContext ?? "", /0.3.8 -> 0.3.9/u);
      if (host === "codex") {
        assert.ok((first?.systemMessage ?? "").includes("$kcoderag-update"));
        assert.ok(first!.systemMessage.length <= 600);
      } else assert.equal(first?.systemMessage, undefined);
      const repeat = run({ hook_event_name: "PreToolUse", session_id: "fresh",
        tool_name: "Bash", tool_input: { command: "pwd" } });
      assert.equal(repeat?.systemMessage, undefined);
      assert.doesNotMatch(repeat?.hookSpecificOutput?.additionalContext ?? "", /update available/u);
      const post = run({ hook_event_name: "PostToolUse", session_id: "post" });
      assert.equal(post?.systemMessage, undefined);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Codex recovers malformed cache with a worker result and shows the late warning once", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-cold-cache-"));
  const cacheRoot = path.join(root, "cache");
  const now = 2_000_000_000_000;
  let spawns = 0;
  try {
    fs.mkdirSync(cacheRoot);
    fs.writeFileSync(path.join(cacheRoot, "remote-cache.json"), "{interrupted");
    const runtime = { host: "codex" as const, managedRoot: root, cacheRoot,
      installedVersion: "0.3.8", now: () => now,
      updateSpawn: () => { spawns += 1; return { unref() {} }; } };
    const run = (payload: unknown) => dispatcher.dispatchRawInput(JSON.stringify(payload), undefined, JSON.parse, runtime);
    const startup = { hook_event_name: "SessionStart", source: "startup", session_id: "cold" };
    const tool = { hook_event_name: "PreToolUse", session_id: "cold", cwd: path.join(root, "nested"),
      tool_name: "Bash", tool_input: { command: "pwd" } };
    assert.equal(run(startup)?.systemMessage, undefined);
    assert.equal(run(tool)?.systemMessage, undefined);
    assert.equal(spawns, 1);
    assert.equal(await worker.refreshLatest({
      cacheRoot, now: () => now,
      request: async () => ({ statusCode: 200, url: worker.REGISTRY_URL,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ name: "kcoderag-nav", "dist-tags": { latest: "0.3.9" } })) }),
    }), true);
    const late = run(tool);
    assert.match(late?.systemMessage ?? "", /0.3.8 -> 0.3.9/u);
    assert.ok((late?.systemMessage ?? "").includes("$kcoderag-update"));
    assert.equal(run(tool)?.systemMessage, undefined);
    assert.equal(run({ ...startup, source: "resume" })?.systemMessage, undefined);
    assert.equal(spawns, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
