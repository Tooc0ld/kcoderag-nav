const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor" | "opencode";

interface OnceMarkerModule {
  readonly MAX_NUDGE_MARKERS: number;
  stableSessionIdentity(payload: unknown): {
    readonly field: "session_id" | "thread_id" | "conversation_id";
    readonly value: string;
  } | undefined;
  nudgeMarkerKey(payload: unknown, options: {
    readonly host: HostId;
    readonly managedRoot: string;
    readonly capability: "code-style-nudge";
  }): string | undefined;
  claimNudgeOnce(payload: unknown, options: {
    readonly host: HostId;
    readonly managedRoot: string;
    readonly capability: "code-style-nudge";
    readonly cacheRoot: string;
  }): { readonly claimed: boolean; readonly key?: string };
}

const marker = require("../../dist/hooks/once-marker.cjs") as OnceMarkerModule;
const compiledMarker = path.resolve("dist/hooks/once-marker.cjs");

function fixture(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-nudge-once-"));
}

function claimFiles(root: string): string[] {
  const directory = path.join(root, "nudges");
  return fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((name) => name.endsWith(".claim")).sort()
    : [];
}

function options(root: string, overrides: Partial<{ host: HostId; managedRoot: string }> = {}) {
  return {
    host: overrides.host ?? "claude" as const,
    managedRoot: overrides.managedRoot ?? path.join(root, "managed project"),
    capability: "code-style-nudge" as const,
    cacheRoot: root,
  };
}

test("stable identity accepts only the three documented non-empty string fields", () => {
  assert.deepEqual(marker.stableSessionIdentity({ session_id: "session" }), {
    field: "session_id", value: "session",
  });
  assert.deepEqual(marker.stableSessionIdentity({ thread_id: "thread" }), {
    field: "thread_id", value: "thread",
  });
  assert.deepEqual(marker.stableSessionIdentity({ conversation_id: "conversation" }), {
    field: "conversation_id", value: "conversation",
  });
  assert.equal(marker.stableSessionIdentity({ session_id: "first", thread_id: "second" })?.value, "first");
  for (const payload of [
    {}, { cwd: "project" }, { pid: 123 }, { turn_id: "turn" }, { sessionID: "open" },
    { session_id: "" }, { session_id: "   " }, { session_id: 123 }, { session_id: true },
    { session_id: {} }, null,
  ]) {
    assert.equal(marker.stableSessionIdentity(payload), undefined);
  }
});

test("claims one zero-byte hash-only marker scoped by host, root, capability, and stable ID", () => {
  const root = fixture();
  const secrets = ["raw-session", "Managed Root Secret", "player.cpp", "Bearer SECRET"];
  try {
    const base = options(root, { managedRoot: path.join(root, secrets[1] ?? "managed") });
    const first = marker.claimNudgeOnce({ session_id: secrets[0], tool_input: secrets.slice(2) }, base);
    const repeat = marker.claimNudgeOnce({ session_id: secrets[0], tool_input: secrets.slice(2) }, base);
    assert.equal(first.claimed, true);
    assert.equal(repeat.claimed, false);
    assert.match(first.key ?? "", /^[0-9a-f]{64}$/u);
    assert.equal(first.key, repeat.key);

    const files = claimFiles(root);
    assert.deepEqual(files, [`${first.key}.claim`]);
    const markerPath = path.join(root, "nudges", files[0] ?? "missing");
    assert.equal(fs.statSync(markerPath).size, 0);
    const persisted = `${files.join("\n")}\n${fs.readFileSync(markerPath, "utf8")}`;
    for (const secret of secrets) assert.equal(persisted.includes(secret), false, secret);

    const scopedKeys = [
      marker.nudgeMarkerKey({ session_id: secrets[0] }, { ...base, host: "codex" }),
      marker.nudgeMarkerKey({ session_id: secrets[0] }, { ...base, managedRoot: `${base.managedRoot}-other` }),
      marker.nudgeMarkerKey({ session_id: "other-session" }, base),
    ];
    assert.equal(new Set([first.key, ...scopedKeys]).size, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent processes have exactly one exclusive-create winner", async () => {
  const root = fixture();
  try {
    const script = [
      "const marker = require(process.argv[1]);",
      "const result = marker.claimNudgeOnce({ session_id: 'shared' }, {",
      "host: 'claude', managedRoot: process.argv[3], capability: 'code-style-nudge', cacheRoot: process.argv[2] });",
      "process.stdout.write(result.claimed ? '1' : '0');",
    ].join(" ");
    const contenders = Array.from({ length: 24 }, () => new Promise<string>((resolve, reject) => {
      const child = childProcess.spawn(process.execPath, ["-e", script, compiledMarker, root, path.join(root, "project")], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0 && stderr === "") resolve(stdout);
        else reject(new Error(`contender failed: ${String(code)} ${stderr}`));
      });
    }));
    const results = await Promise.all(contenders);
    assert.equal(results.filter((result) => result === "1").length, 1);
    assert.equal(results.filter((result) => result === "0").length, 23);
    assert.equal(claimFiles(root).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("capacity saturation never evicts a live marker and every filesystem error suppresses", () => {
  const root = fixture();
  const directory = path.join(root, "nudges");
  try {
    fs.mkdirSync(directory, { recursive: true });
    for (let index = 0; index < marker.MAX_NUDGE_MARKERS; index += 1) {
      fs.writeFileSync(path.join(directory, `${index.toString(16).padStart(64, "0")}.claim`), "");
    }
    assert.equal(marker.claimNudgeOnce({ session_id: "new" }, options(root)).claimed, false);
    assert.equal(claimFiles(root).length, marker.MAX_NUDGE_MARKERS);
    assert.equal(fs.existsSync(path.join(directory, `${"0".repeat(64)}.claim`)), true);

    const impossibleRoot = path.join(root, "not-a-directory");
    fs.writeFileSync(impossibleRoot, "blocked");
    assert.equal(marker.claimNudgeOnce({ session_id: "error" }, options(impossibleRoot)).claimed, false);
    assert.equal(marker.claimNudgeOnce({ cwd: "fallback-forbidden" }, options(root)).claimed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
