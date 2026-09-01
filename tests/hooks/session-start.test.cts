const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor" | "opencode" | "zcode";
type ReminderKind =
  | "navigation"
  | "code-style"
  | "feedback-reminded"
  | "feedback-submitted"
  | "index-available";

interface ReminderFiles {
  ensureDirectory(directoryPath: string): void;
  createExclusive(filePath: string, contents?: string): boolean;
  listFiles(directoryPath: string): readonly string[];
  remove(filePath: string): void;
}

interface OnceMarkerModule {
  contextEpochForSession(payload: unknown, options: {
    readonly host: HostId;
    readonly managedRoot: string;
    readonly capability: "kcoderag-navigation" | "code-style-nudge";
    readonly source: "startup" | "resume" | "clear" | "compact";
    readonly cacheRoot: string;
  }): string | undefined;
  reminderMarkerKey(payload: unknown, options: {
    readonly host: HostId;
    readonly managedRoot: string;
    readonly capability: "kcoderag-navigation" | "code-style-nudge";
    readonly reminderKind: ReminderKind;
    readonly contextEpoch?: string;
  }): string | undefined;
  claimReminder(payload: unknown, options: {
    readonly host: HostId;
    readonly managedRoot: string;
    readonly capability: "kcoderag-navigation" | "code-style-nudge";
    readonly reminderKind: ReminderKind;
    readonly contextEpoch?: string;
    readonly cacheRoot: string;
    readonly files?: ReminderFiles;
  }): { readonly claimed: boolean; readonly key?: string };
}

interface DispatcherModule {
  readonly MAX_ADDITIONAL_CONTEXT_CHARS: number;
  normalizeHookEvent(payload: unknown, runtime?: Record<string, unknown>): Record<string, any> | undefined;
  dispatchRawInput(
    raw: string,
    contributors?: undefined,
    parseInput?: (raw: string) => unknown,
    runtime?: Record<string, unknown>,
  ): Record<string, any> | undefined;
}

interface CleanupModule {
  cleanupSessionClaim(payload: unknown, options: {
    readonly host: HostId;
    readonly managedRoot: string;
    readonly capability: "kcoderag-navigation" | "code-style-nudge";
    readonly cacheRoot: string;
    readonly receiptProvesSessionEnd: (host: HostId, field: string) => boolean;
  }): boolean;
}

const marker = require("../../dist/hooks/once-marker.cjs") as OnceMarkerModule;
const dispatcher = require("../../dist/hooks/pre-tool-dispatcher.cjs") as DispatcherModule;
const cleanup = require("../../dist/hooks/session-cleanup.cjs") as CleanupModule;

function fixture(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function payload(source: "startup" | "resume" | "clear" | "compact", sessionId = "session-a") {
  return { hook_event_name: "SessionStart", source, session_id: sessionId };
}

function context(output: Record<string, any> | undefined): string | undefined {
  return output?.hookSpecificOutput?.additionalContext;
}

test("epoch governor keeps resume stable and rearms only clear or compact", () => {
  const root = fixture("kcoderag-session-epoch-");
  const managedRoot = path.join(root, "managed");
  fs.mkdirSync(managedRoot, { recursive: true });
  try {
    const options = {
      host: "codex" as const,
      managedRoot,
      capability: "kcoderag-navigation" as const,
      cacheRoot: root,
    };
    assert.equal(marker.contextEpochForSession(payload("startup"), { ...options, source: "startup" }), "0");
    assert.equal(marker.contextEpochForSession(payload("resume"), { ...options, source: "resume" }), "0");
    assert.equal(marker.contextEpochForSession(payload("clear"), { ...options, source: "clear" }), "1");
    assert.equal(marker.contextEpochForSession(payload("compact"), { ...options, source: "compact" }), "2");

    const first = marker.claimReminder(payload("startup"), {
      ...options,
      reminderKind: "navigation",
      contextEpoch: "2",
    });
    const repeat = marker.claimReminder(payload("startup"), {
      ...options,
      reminderKind: "navigation",
      contextEpoch: "2",
    });
    assert.equal(first.claimed, true);
    assert.equal(repeat.claimed, false);
    const markerPath = path.join(root, "nudges", `${first.key}.claim`);
    const record = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    assert.deepEqual(Object.keys(record).sort(), [
      "capability",
      "host",
      "recordedAt",
      "reminderKind",
      "schemaVersion",
      "scope",
    ]);
    assert.equal(record.scope, "epoch");
    assert.doesNotMatch(`${first.key}${JSON.stringify(record)}`, /session-a|managed/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SessionStart uses one bounded baseline and exact opaque identities", () => {
  const root = fixture("kcoderag-session-baseline-");
  const managedRoot = path.join(root, "project");
  fs.mkdirSync(managedRoot, { recursive: true });
  try {
    const runtime = { host: "codex", managedRoot, cacheRoot: root };
    const startup = dispatcher.dispatchRawInput(JSON.stringify(payload("startup")), undefined, JSON.parse, runtime);
    assert.match(context(startup) ?? "", /Use KCodeRag/u);
    assert.ok((context(startup)?.length ?? 0) <= dispatcher.MAX_ADDITIONAL_CONTEXT_CHARS);
    assert.equal(dispatcher.dispatchRawInput(
      JSON.stringify(payload("resume")), undefined, JSON.parse, runtime,
    ), undefined);
    const clear = dispatcher.dispatchRawInput(JSON.stringify(payload("clear")), undefined, JSON.parse, runtime);
    const compact = dispatcher.dispatchRawInput(JSON.stringify(payload("compact")), undefined, JSON.parse, runtime);
    assert.equal(context(clear), context(compact));
    assert.equal(dispatcher.normalizeHookEvent(
      { hook_event_name: "SessionStart", source: "unknown", session_id: "session-a" }, runtime,
    ), undefined);

    const nfc = dispatcher.dispatchRawInput(JSON.stringify(payload("startup", "caf\u00e9")), undefined, JSON.parse, runtime);
    const nfd = dispatcher.dispatchRawInput(JSON.stringify(payload("startup", "cafe\u0301")), undefined, JSON.parse, runtime);
    assert.match(context(nfc) ?? "", /Use KCodeRag/u);
    assert.match(context(nfd) ?? "", /Use KCodeRag/u);

    const normalizedRoot = path.join(managedRoot, ".");
    const keyA = marker.reminderMarkerKey(payload("startup"), {
      host: "codex",
      managedRoot,
      capability: "kcoderag-navigation",
      reminderKind: "navigation",
      contextEpoch: "9",
    });
    const keyB = marker.reminderMarkerKey(payload("startup"), {
      host: "codex",
      managedRoot: normalizedRoot,
      capability: "kcoderag-navigation",
      reminderKind: "navigation",
      contextEpoch: "9",
    });
    assert.equal(keyA, keyB);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SessionStart update fragment is fresh-cache only and stale cache detaches once", () => {
  const root = fixture("kcoderag-session-update-");
  const managedRoot = path.join(root, "project");
  const cacheRoot = path.join(root, "cache");
  const now = 2_000_000_000_000;
  fs.mkdirSync(managedRoot, { recursive: true });
  fs.mkdirSync(cacheRoot, { recursive: true });
  try {
    fs.writeFileSync(path.join(cacheRoot, "remote-cache.json"), JSON.stringify({
      schemaVersion: 1,
      checkedAt: now - 1,
      latest: "0.3.2",
    }));
    const fresh = dispatcher.dispatchRawInput(JSON.stringify(payload("startup", "fresh")), undefined, JSON.parse, {
      host: "codex",
      managedRoot,
      cacheRoot,
      installedVersion: "0.3.1",
      now: () => now,
    });
    assert.match(context(fresh) ?? "", /0\.3\.1 -> 0\.3\.2/u);
    assert.match(context(fresh) ?? "", /Ask the user first; do not update automatically/u);

    fs.writeFileSync(path.join(cacheRoot, "remote-cache.json"), JSON.stringify({
      schemaVersion: 1,
      checkedAt: now - (24 * 60 * 60 * 1_000),
      latest: "0.3.2",
    }));
    let spawnCalls = 0;
    let unrefCalls = 0;
    const staleRuntime = {
      host: "codex",
      managedRoot,
      cacheRoot,
      installedVersion: "0.3.1",
      now: () => now,
      updateSpawn: () => {
        spawnCalls += 1;
        return { unref() { unrefCalls += 1; } };
      },
    };
    const stale = dispatcher.dispatchRawInput(JSON.stringify(payload("startup", "stale")), undefined, JSON.parse, staleRuntime);
    assert.doesNotMatch(context(stale) ?? "", /update available/u);
    dispatcher.dispatchRawInput(JSON.stringify(payload("resume", "stale")), undefined, JSON.parse, staleRuntime);
    assert.equal(spawnCalls, 1);
    assert.equal(unrefCalls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("receipt-proven SessionEnd removes only the exact session reminder family", () => {
  const root = fixture("kcoderag-session-cleanup-family-");
  const projectA = path.join(root, "a");
  const projectB = path.join(root, "b");
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });
  try {
    const target = { hook_event_name: "SessionEnd", session_id: "target" };
    const other = { hook_event_name: "SessionEnd", session_id: "other" };
    for (const reminderKind of ["navigation", "feedback-reminded", "feedback-submitted"] as const) {
      marker.claimReminder(target, {
        host: "codex",
        managedRoot: projectA,
        capability: "kcoderag-navigation",
        reminderKind,
        ...(reminderKind === "feedback-submitted" ? {} : { contextEpoch: "0" }),
        cacheRoot: root,
      });
      marker.claimReminder(other, {
        host: "codex",
        managedRoot: projectA,
        capability: "kcoderag-navigation",
        reminderKind,
        ...(reminderKind === "feedback-submitted" ? {} : { contextEpoch: "0" }),
        cacheRoot: root,
      });
    }
    assert.equal(cleanup.cleanupSessionClaim(target, {
      host: "codex",
      managedRoot: projectA,
      capability: "kcoderag-navigation",
      cacheRoot: root,
      receiptProvesSessionEnd: (host, field) => host === "codex" && field === "session_id",
    }), true);
    const remaining = fs.readdirSync(path.join(root, "nudges"));
    assert.equal(remaining.filter((name) => name.endsWith(".claim")).length, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
