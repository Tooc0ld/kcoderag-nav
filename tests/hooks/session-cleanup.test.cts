const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor" | "opencode";
type StableField = "session_id" | "thread_id" | "conversation_id";

interface OnceMarkerModule {
  claimNudgeOnce(payload: unknown, options: {
    readonly host: HostId;
    readonly managedRoot: string;
    readonly capability: "code-style-nudge";
    readonly cacheRoot: string;
  }): { readonly claimed: boolean; readonly key?: string };
}

interface SessionCleanupModule {
  sessionEndCleanupProven(host: HostId): boolean;
  cleanupSessionClaim(payload: unknown, options: {
    readonly host: HostId;
    readonly managedRoot: string;
    readonly capability: "code-style-nudge";
    readonly cacheRoot: string;
    readonly receiptProvesSessionEnd?: (host: HostId, field: StableField) => boolean;
  }): boolean;
  main(rawInput?: string): number;
}

const marker = require("../../dist/hooks/once-marker.cjs") as OnceMarkerModule;
const cleanup = require("../../dist/hooks/session-cleanup.cjs") as SessionCleanupModule;
const compiledCleanup = path.resolve("dist/hooks/session-cleanup.cjs");

function fixture(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-nudge-cleanup-"));
}

function options(root: string, host: HostId, managedRoot: string) {
  return { host, managedRoot, capability: "code-style-nudge" as const, cacheRoot: root };
}

test("checked-in delivery receipts do not infer unproved SessionEnd cleanup", () => {
  for (const host of ["codex", "claude", "cursor", "opencode"] as const) {
    assert.equal(cleanup.sessionEndCleanupProven(host), false, host);
  }

  const root = fixture();
  try {
    const lane = options(root, "claude", path.join(root, "project"));
    const claim = marker.claimNudgeOnce({ session_id: "live" }, lane);
    assert.equal(claim.claimed, true);
    assert.equal(cleanup.cleanupSessionClaim({ hook_event_name: "SessionEnd", session_id: "live" }, lane), false);
    assert.equal(fs.existsSync(path.join(root, "nudges", `${claim.key}.claim`)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a receipt-proven SessionEnd deletes only its exact host/root/session lane", () => {
  const root = fixture();
  const projectA = path.join(root, "project-a");
  const projectB = path.join(root, "project-b");
  try {
    const lanes = [
      { payload: { session_id: "target" }, options: options(root, "claude", projectA) },
      { payload: { session_id: "other" }, options: options(root, "claude", projectA) },
      { payload: { session_id: "target" }, options: options(root, "claude", projectB) },
      { payload: { session_id: "target" }, options: options(root, "codex", projectA) },
    ] as const;
    const claims = lanes.map((lane) => marker.claimNudgeOnce(lane.payload, lane.options));
    assert.equal(claims.every((claim) => claim.claimed), true);

    const proof = (host: HostId, field: StableField): boolean => host === "claude" && field === "session_id";
    assert.equal(cleanup.cleanupSessionClaim(
      { hook_event_name: "SessionEnd", session_id: "target" },
      { ...lanes[0].options, receiptProvesSessionEnd: proof },
    ), true);
    assert.equal(fs.existsSync(path.join(root, "nudges", `${claims[0]?.key}.claim`)), false);
    for (const claim of claims.slice(1)) {
      assert.equal(fs.existsSync(path.join(root, "nudges", `${claim.key}.claim`)), true);
    }

    assert.equal(cleanup.cleanupSessionClaim(
      { hook_event_name: "PreToolUse", session_id: "other" },
      { ...lanes[1].options, receiptProvesSessionEnd: proof },
    ), false);
    assert.equal(cleanup.cleanupSessionClaim(
      { hook_event_name: "SessionEnd", cwd: projectA },
      { ...lanes[1].options, receiptProvesSessionEnd: proof },
    ), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup errors and the compiled handler are silent and exit zero", () => {
  const root = fixture();
  try {
    const impossibleRoot = path.join(root, "not-a-directory");
    fs.writeFileSync(impossibleRoot, "blocked");
    assert.equal(cleanup.cleanupSessionClaim(
      { hook_event_name: "SessionEnd", session_id: "target" },
      {
        ...options(impossibleRoot, "claude", path.join(root, "project")),
        receiptProvesSessionEnd: () => true,
      },
    ), false);

    for (const input of [
      JSON.stringify({ hook_event_name: "SessionEnd", session_id: "target" }),
      "not-json",
      "x".repeat(131_073),
    ]) {
      const result = childProcess.spawnSync(process.execPath, [compiledCleanup], {
        input,
        encoding: "utf8",
        timeout: 5_000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
    assert.equal(cleanup.main("not-json"), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
