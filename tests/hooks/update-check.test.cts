const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

interface UpdateCheckFiles {
  readText(filePath: string): string | undefined;
  ensureDirectory(directoryPath: string): void;
  createExclusive(filePath: string, contents: string): boolean;
  listFiles(directoryPath: string): readonly { readonly name: string; readonly mtimeMs: number }[];
  remove(filePath: string): void;
}

interface UpdateCheckOptions {
  readonly cacheRoot?: string;
  readonly now?: () => number;
  readonly files?: UpdateCheckFiles;
  readonly spawn?: (...args: readonly unknown[]) => { unref?(): void };
  readonly workerPath?: string;
}

interface UpdateCheckModule {
  readonly CACHE_TTL_MS: number;
  readonly MAX_SESSION_MARKERS: number;
  readUpdateHint(installedVersion: string | undefined, options?: UpdateCheckOptions): string | undefined;
  scheduleRefresh(hookPayload: unknown, options?: UpdateCheckOptions): boolean;
}

const update = require("../../dist/hooks/update-check.cjs") as UpdateCheckModule;

class MemoryFiles implements UpdateCheckFiles {
  readonly entries = new Map<string, { contents: string; mtimeMs: number }>();
  failReads = false;
  failCreates = false;

  readText(filePath: string): string | undefined {
    if (this.failReads) throw new Error("permission denied");
    return this.entries.get(path.resolve(filePath))?.contents;
  }

  ensureDirectory(_directoryPath: string): void {
    if (this.failCreates) throw new Error("permission denied");
  }

  createExclusive(filePath: string, contents: string): boolean {
    if (this.failCreates) throw new Error("permission denied");
    const resolved = path.resolve(filePath);
    if (this.entries.has(resolved)) return false;
    this.entries.set(resolved, { contents, mtimeMs: Date.now() });
    return true;
  }

  listFiles(directoryPath: string): readonly { readonly name: string; readonly mtimeMs: number }[] {
    const directory = `${path.resolve(directoryPath)}${path.sep}`;
    return [...this.entries]
      .filter(([entryPath]) => entryPath.startsWith(directory) && !entryPath.slice(directory.length).includes(path.sep))
      .map(([entryPath, value]) => ({ name: path.basename(entryPath), mtimeMs: value.mtimeMs }));
  }

  remove(filePath: string): void {
    this.entries.delete(path.resolve(filePath));
  }

  put(filePath: string, contents: string, mtimeMs = 0): void {
    this.entries.set(path.resolve(filePath), { contents, mtimeMs });
  }
}

const cacheRoot = path.resolve("virtual-cache");
const cachePath = path.join(cacheRoot, "remote-cache.json");
const relevantPayload = {
  tool_name: "Bash",
  tool_input: { command: "rg KPlayer src", authorization: "Bearer must-not-leak" },
  session_id: "session-a",
};

function cache(checkedAt: number, latest: string): string {
  return JSON.stringify({ schemaVersion: 1, checkedAt, latest });
}

test("fresh validated cache produces only an exact newer-version npx hint", () => {
  const files = new MemoryFiles();
  const now = 2_000_000_000_000;
  files.put(cachePath, cache(now - update.CACHE_TTL_MS + 1, "0.1.5"));

  assert.equal(
    update.readUpdateHint("0.1.4", { cacheRoot, files, now: () => now }),
    "KCodeRag Nav update available: 0.1.4 -> 0.1.5. Ask the user first; do not update automatically. Run: npx kcoderag-nav@latest update",
  );
  assert.equal(update.readUpdateHint("0.1.5", { cacheRoot, files, now: () => now }), undefined);
  assert.equal(update.readUpdateHint("0.1.6", { cacheRoot, files, now: () => now }), undefined);
  assert.equal(update.readUpdateHint("invalid", { cacheRoot, files, now: () => now }), undefined);

  const spawnCalls: unknown[][] = [];
  assert.equal(update.scheduleRefresh(relevantPayload, {
    cacheRoot,
    files,
    now: () => now,
    spawn: (...args) => { spawnCalls.push([...args]); return { unref() {} }; },
  }), false);
  assert.deepEqual(spawnCalls, []);
});

test("stale or missing cache schedules at most one detached worker per session", () => {
  const files = new MemoryFiles();
  const now = 2_000_000_000_000;
  files.put(cachePath, cache(now - update.CACHE_TTL_MS, "0.1.5"));
  const spawnCalls: unknown[][] = [];
  let unrefCalls = 0;
  const options: UpdateCheckOptions = {
    cacheRoot,
    files,
    now: () => now,
    workerPath: path.resolve("worker.cjs"),
    spawn: (...args) => {
      spawnCalls.push([...args]);
      return { unref() { unrefCalls += 1; } };
    },
  };

  assert.equal(update.scheduleRefresh(relevantPayload, options), true);
  assert.equal(update.scheduleRefresh(relevantPayload, options), false);
  assert.equal(spawnCalls.length, 1);
  assert.equal(unrefCalls, 1);
  assert.equal(spawnCalls[0]?.[0], process.execPath);
  assert.deepEqual(spawnCalls[0]?.[1], [path.resolve("worker.cjs"), "--refresh", cacheRoot]);
  assert.deepEqual(spawnCalls[0]?.[2], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  const serializedEntries = JSON.stringify([...files.entries]);
  assert.doesNotMatch(serializedEntries, /must-not-leak|KPlayer|Bearer/u);
});

test("invalid cache, clock skew, races, permissions, and spawn failures fail open", () => {
  const now = 2_000_000_000_000;
  for (const invalidCache of [
    "not-json",
    cache(now + 1, "0.1.5"),
    cache(now - 1, "1.2"),
    JSON.stringify({ schemaVersion: 2, checkedAt: now, latest: "0.1.5" }),
  ]) {
    const files = new MemoryFiles();
    files.put(cachePath, invalidCache);
    assert.equal(update.readUpdateHint("0.1.4", { cacheRoot, files, now: () => now }), undefined);
  }

  const unreadable = new MemoryFiles();
  unreadable.failReads = true;
  assert.equal(update.readUpdateHint("0.1.4", { cacheRoot, files: unreadable, now: () => now }), undefined);
  assert.equal(update.scheduleRefresh(relevantPayload, { cacheRoot, files: unreadable, now: () => now }), false);

  const race = new MemoryFiles();
  race.createExclusive(path.join(cacheRoot, "sessions", "occupied"), "");
  race.createExclusive = () => false;
  assert.equal(update.scheduleRefresh(relevantPayload, { cacheRoot, files: race, now: () => now }), false);

  const spawnFailure = new MemoryFiles();
  assert.equal(update.scheduleRefresh(relevantPayload, {
    cacheRoot,
    files: spawnFailure,
    now: () => now,
    spawn: () => { throw new Error("offline"); },
  }), false);

  assert.equal(update.scheduleRefresh({ tool_name: "Unknown", tool_input: {} }, {
    cacheRoot,
    files: new MemoryFiles(),
    now: () => now,
  }), false);
  assert.equal(update.scheduleRefresh({ tool_name: "Bash", tool_input: [] }, {
    cacheRoot,
    files: new MemoryFiles(),
    now: () => Number.NaN,
  }), false);
});

test("session markers remain bounded and foreground source has no network client", () => {
  const files = new MemoryFiles();
  const now = 2_000_000_000_000;
  const sessionsRoot = path.join(cacheRoot, "sessions");
  for (let index = 0; index < update.MAX_SESSION_MARKERS; index += 1) {
    files.put(path.join(sessionsRoot, `session-old-${index}.seen`), "", index);
  }

  assert.equal(update.scheduleRefresh({ ...relevantPayload, session_id: "new-session" }, {
    cacheRoot,
    files,
    now: () => now,
    spawn: () => ({ unref() {} }),
  }), true);
  assert.ok(files.listFiles(sessionsRoot).length <= update.MAX_SESSION_MARKERS);

  const foregroundSource = fs.readFileSync(path.resolve("src/hooks/update-check.cts"), "utf8");
  assert.doesNotMatch(foregroundSource, /node:https|https:\/\/registry\.npmjs/u);
});
