const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const fsPromises = require("node:fs/promises") as typeof import("node:fs/promises");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

interface UpdateCheckFiles {
  readText(filePath: string): string | undefined;
  ensureDirectory(directoryPath: string): void;
  createExclusive(filePath: string, contents: string): boolean;
  replace(filePath: string, contents: string): void;
  listFiles(directoryPath: string): readonly { readonly name: string; readonly mtimeMs: number }[];
  remove(filePath: string): void;
}

interface UpdateCheckOptions {
  readonly cacheRoot?: string;
  readonly now?: () => number;
  readonly files?: UpdateCheckFiles;
  readonly spawn?: (...args: readonly unknown[]) => { unref?(): void };
  readonly workerPath?: string;
  readonly hookPayload?: unknown;
  readonly host?: "codex" | "claude" | "cursor" | "opencode";
  readonly runtimePath?: string;
}

interface UpdateCheckModule {
  readonly CACHE_TTL_MS: number;
  readonly SESSIONLESS_MARKER_TTL_MS: number;
  readonly RENEWAL_TOKEN_TTL_MS: number;
  readonly MAX_SESSION_MARKERS: number;
  readVersionStatus(
    installedVersion: string | undefined,
    options?: UpdateCheckOptions,
  ): Readonly<{
    installedVersion: string | null;
    latestVersion: string | null;
    versionStatus: "up_to_date" | "update_available" | "unknown";
    checkedAt: number | null;
  }>;
  readUpdateHint(installedVersion: string | undefined, options?: UpdateCheckOptions): string | undefined;
  scheduleRefresh(hookPayload: unknown, options?: UpdateCheckOptions): boolean;
  readInstalledVersion(statePath?: string): string | undefined;
  readInstalledHost(statePath?: string): "codex" | "claude" | "cursor" | "opencode" | "zcode" | undefined;
}

const update = require("../../dist/hooks/update-check.cjs") as UpdateCheckModule;

interface RegistryResponse {
  readonly statusCode: number;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: Buffer;
}

interface RegistryRequestOptions {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly headers: Readonly<Record<string, string>>;
}

interface WorkerModule {
  readonly REGISTRY_URL: string;
  readonly REQUEST_TIMEOUT_MS: number;
  readonly MAX_RESPONSE_BYTES: number;
  refreshLatest(options: {
    readonly cacheRoot: string;
    readonly now?: () => number;
    readonly request?: (url: string, options: RegistryRequestOptions) => Promise<RegistryResponse>;
    readonly writeCache?: (cacheRoot: string, cache: unknown) => Promise<void>;
  }): Promise<boolean>;
  main(argv?: readonly string[]): Promise<number>;
}

interface HookModule {
  main(
    rawInput?: string,
    writeOutput?: (text: string) => void,
    updateRuntime?: {
      readonly installedVersion?: string;
      readonly installedHost?: "codex" | "claude" | "cursor" | "opencode";
      readonly readUpdateHint?: (
        installedVersion: string | undefined,
        options?: { readonly host?: "codex" | "claude" | "cursor" | "opencode" },
      ) => string | undefined;
      readonly scheduleRefresh?: (payload: unknown) => boolean;
    },
  ): number;
}

const worker = require("../../dist/hooks/update-worker.cjs") as WorkerModule;
const hook = require("../../dist/hooks/grep-nudge.cjs") as HookModule;

class MemoryFiles implements UpdateCheckFiles {
  readonly entries = new Map<string, { contents: string; mtimeMs: number }>();
  failReads = false;
  failCreates = false;
  failRemoves = false;
  clock = (): number => Date.now();

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
    this.entries.set(resolved, { contents, mtimeMs: this.clock() });
    return true;
  }

  replace(filePath: string, contents: string): void {
    if (this.failCreates) throw new Error("permission denied");
    this.entries.set(path.resolve(filePath), { contents, mtimeMs: this.clock() });
  }

  listFiles(directoryPath: string): readonly { readonly name: string; readonly mtimeMs: number }[] {
    const directory = `${path.resolve(directoryPath)}${path.sep}`;
    return [...this.entries]
      .filter(([entryPath]) => entryPath.startsWith(directory) && !entryPath.slice(directory.length).includes(path.sep))
      .map(([entryPath, value]) => ({ name: path.basename(entryPath), mtimeMs: value.mtimeMs }));
  }

  remove(filePath: string): void {
    if (this.failRemoves) throw new Error("permission denied");
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

  assert.deepEqual(update.readVersionStatus("0.1.4", { cacheRoot, files, now: () => now }), {
    installedVersion: "0.1.4",
    latestVersion: "0.1.5",
    versionStatus: "update_available",
    checkedAt: now - update.CACHE_TTL_MS + 1,
  });
  assert.deepEqual(update.readVersionStatus("0.1.5", { cacheRoot, files, now: () => now }), {
    installedVersion: "0.1.5",
    latestVersion: "0.1.5",
    versionStatus: "up_to_date",
    checkedAt: now - update.CACHE_TTL_MS + 1,
  });
  assert.deepEqual(update.readVersionStatus("0.1.6", { cacheRoot, files, now: () => now }), {
    installedVersion: "0.1.6",
    latestVersion: "0.1.5",
    versionStatus: "unknown",
    checkedAt: now - update.CACHE_TTL_MS + 1,
  });

  assert.equal(
    update.readUpdateHint("0.1.4", { cacheRoot, files, now: () => now }),
    "KCodeRag Nav update available: 0.1.4 -> 0.1.5. Ask the user first; do not update automatically. Run: npx kcoderag-nav@latest update",
  );
  assert.equal(update.readUpdateHint("0.1.5", { cacheRoot, files, now: () => now }), undefined);
  assert.equal(update.readUpdateHint("0.1.6", { cacheRoot, files, now: () => now }), undefined);
  assert.equal(update.readUpdateHint("invalid", { cacheRoot, files, now: () => now }), undefined);
  assert.equal(
    update.readUpdateHint("0.1.4", { cacheRoot, files, now: () => now, host: "cursor" }),
    "KCodeRag Nav update available: 0.1.4 -> 0.1.5. Ask the user first; do not update automatically. Run: npx kcoderag-nav@latest update --host cursor",
  );

  assert.match(update.readUpdateHint("0.1.4", {
    cacheRoot,
    files,
    now: () => now,
    hookPayload: relevantPayload,
  }) ?? "", /npx kcoderag-nav@latest update/u);
  assert.equal(update.readUpdateHint("0.1.4", {
    cacheRoot,
    files,
    now: () => now,
    hookPayload: relevantPayload,
  }), undefined);

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
    runtimePath: "node",
    spawn: (...args) => {
      spawnCalls.push([...args]);
      return { unref() { unrefCalls += 1; } };
    },
  };

  assert.equal(update.scheduleRefresh(relevantPayload, options), true);
  assert.equal(update.scheduleRefresh(relevantPayload, options), false);
  assert.equal(spawnCalls.length, 1);
  assert.equal(unrefCalls, 1);
  assert.equal(spawnCalls[0]?.[0], "node");
  assert.deepEqual(spawnCalls[0]?.[1], [path.resolve("worker.cjs"), "--refresh", cacheRoot]);
  assert.deepEqual(spawnCalls[0]?.[2], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  const serializedEntries = JSON.stringify([...files.entries]);
  assert.doesNotMatch(serializedEntries, /must-not-leak|KPlayer|Bearer/u);
});

test("session-less scheduling stays claimed across an hour with an explicit lifetime", () => {
  const files = new MemoryFiles();
  const payload = {
    tool_name: "Bash",
    tool_input: { command: "rg KPlayer src" },
    cwd: path.resolve("project-without-session-id"),
  };
  const firstClaimAt = 3_599_999;
  let now = firstClaimAt;
  let spawnCalls = 0;
  const options: UpdateCheckOptions = {
    cacheRoot,
    files,
    now: () => now,
    spawn: () => {
      spawnCalls += 1;
      return { unref() {} };
    },
  };

  assert.equal(update.scheduleRefresh(payload, options), true);
  now = 3_600_001;
  assert.equal(update.scheduleRefresh(payload, options), false);
  assert.equal(spawnCalls, 1);

  now = firstClaimAt + update.SESSIONLESS_MARKER_TTL_MS;
  assert.equal(update.scheduleRefresh(payload, options), true);
  assert.equal(spawnCalls, 2);
});

test("concurrent session-less expiry contenders claim exactly one renewal generation", () => {
  const files = new MemoryFiles();
  const payload = {
    tool_name: "Bash",
    tool_input: { command: "rg KPlayer src" },
    cwd: path.resolve("project-without-session-id"),
  };
  const firstClaimAt = 2_000_000_000_000;
  let now = firstClaimAt;
  files.clock = () => now;
  let spawnCalls = 0;
  const options: UpdateCheckOptions = {
    cacheRoot,
    files,
    now: () => now,
    spawn: () => {
      spawnCalls += 1;
      return { unref() {} };
    },
  };

  assert.equal(update.scheduleRefresh(payload, options), true);
  now += update.SESSIONLESS_MARKER_TTL_MS;

  const originalReadText = files.readText.bind(files);
  let nestedResult: boolean | undefined;
  let interleaved = false;
  files.readText = (filePath) => {
    const contents = originalReadText(filePath);
    if (!interleaved && path.basename(filePath).startsWith("session-") && contents === String(firstClaimAt)) {
      interleaved = true;
      nestedResult = update.scheduleRefresh(payload, options);
    }
    return contents;
  };

  const outerResult = update.scheduleRefresh(payload, options);
  assert.equal(nestedResult, true);
  assert.equal(outerResult, false);
  assert.equal(spawnCalls, 2);
});

test("a transient replacement failure releases its generation token and a later renewal retries", () => {
  const files = new MemoryFiles();
  const payload = {
    tool_name: "Bash",
    tool_input: { command: "rg KPlayer src" },
    cwd: path.resolve("transient-renewal-project"),
  };
  let now = 2_000_000_000_000;
  files.clock = () => now;
  let spawnCalls = 0;
  const options: UpdateCheckOptions = {
    cacheRoot,
    files,
    now: () => now,
    spawn: () => {
      spawnCalls += 1;
      return { unref() {} };
    },
  };

  assert.equal(update.scheduleRefresh(payload, options), true);
  now += update.SESSIONLESS_MARKER_TTL_MS;
  const originalReplace = files.replace.bind(files);
  let failed = false;
  files.replace = (filePath, contents) => {
    if (!failed) {
      failed = true;
      throw new Error("transient replace failure");
    }
    originalReplace(filePath, contents);
  };
  assert.equal(update.scheduleRefresh(payload, options), false);
  const sessionsRoot = path.join(cacheRoot, "sessions");
  assert.equal(files.listFiles(sessionsRoot).filter((entry) => entry.name.startsWith("renew-")).length, 0);

  now += update.SESSIONLESS_MARKER_TTL_MS;
  assert.equal(update.scheduleRefresh(payload, options), true);
  assert.equal(spawnCalls, 2);
  assert.equal(files.listFiles(sessionsRoot).filter((entry) => entry.name.startsWith("renew-")).length, 0);
});

test("replacement completion reported as failure is accepted from the marker contents", () => {
  const files = new MemoryFiles();
  const payload = {
    tool_name: "Bash",
    tool_input: { command: "rg KPlayer src" },
    cwd: path.resolve("completed-renewal-project"),
  };
  let now = 2_000_000_000_000;
  files.clock = () => now;
  let spawnCalls = 0;
  const options: UpdateCheckOptions = {
    cacheRoot,
    files,
    now: () => now,
    spawn: () => {
      spawnCalls += 1;
      return { unref() {} };
    },
  };

  assert.equal(update.scheduleRefresh(payload, options), true);
  now += update.SESSIONLESS_MARKER_TTL_MS;
  const originalReplace = files.replace.bind(files);
  files.replace = (filePath, contents) => {
    originalReplace(filePath, contents);
    throw new Error("reported after replacement");
  };
  assert.equal(update.scheduleRefresh(payload, options), true);
  assert.equal(spawnCalls, 2);
  assert.equal(
    files.listFiles(path.join(cacheRoot, "sessions")).filter((entry) => entry.name.startsWith("renew-")).length,
    0,
  );
});

test("an undeletable renewal token expires after a bounded lease", () => {
  const files = new MemoryFiles();
  const payload = {
    tool_name: "Bash",
    tool_input: { command: "rg KPlayer src" },
    cwd: path.resolve("leased-renewal-project"),
  };
  let now = 2_000_000_000_000;
  files.clock = () => now;
  let spawnCalls = 0;
  const options: UpdateCheckOptions = {
    cacheRoot,
    files,
    now: () => now,
    spawn: () => {
      spawnCalls += 1;
      return { unref() {} };
    },
  };

  assert.equal(update.scheduleRefresh(payload, options), true);
  now += update.SESSIONLESS_MARKER_TTL_MS;
  files.replace = () => { throw new Error("replace failed"); };
  files.failRemoves = true;
  assert.equal(update.scheduleRefresh(payload, options), false);
  const sessionsRoot = path.join(cacheRoot, "sessions");
  assert.equal(files.listFiles(sessionsRoot).filter((entry) => entry.name.startsWith("renew-")).length, 1);

  files.failRemoves = false;
  files.replace = MemoryFiles.prototype.replace.bind(files);
  now += update.RENEWAL_TOKEN_TTL_MS;
  assert.equal(update.scheduleRefresh(payload, options), true);
  assert.equal(spawnCalls, 2);
  assert.equal(files.listFiles(sessionsRoot).filter((entry) => entry.name.startsWith("renew-")).length, 0);
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
    assert.deepEqual(update.readVersionStatus("0.1.4", { cacheRoot, files, now: () => now }), {
      installedVersion: "0.1.4",
      latestVersion: null,
      versionStatus: "unknown",
      checkedAt: null,
    });
  }

  assert.deepEqual(update.readVersionStatus(undefined, {
    cacheRoot,
    files: new MemoryFiles(),
    now: () => now,
  }), {
    installedVersion: null,
    latestVersion: null,
    versionStatus: "unknown",
    checkedAt: null,
  });

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

test("installed package version is read only from a bounded validated state document", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "install-state.json");
    await fsPromises.writeFile(statePath, JSON.stringify({ packageVersion: "0.1.4", unrelated: true }), "utf8");
    assert.equal(update.readInstalledVersion(statePath), "0.1.4");
    assert.equal(update.readInstalledHost(statePath), undefined);
    await fsPromises.writeFile(statePath, JSON.stringify({ packageVersion: "0.1.4", host: "claude" }), "utf8");
    assert.equal(update.readInstalledHost(statePath), "claude");
    await fsPromises.writeFile(statePath, JSON.stringify({ packageVersion: "0.1.4", host: "zcode" }), "utf8");
    assert.equal(update.readInstalledHost(statePath), "zcode");
    await fsPromises.writeFile(statePath, JSON.stringify({ packageVersion: "0.1.4", host: "unknown" }), "utf8");
    assert.equal(update.readInstalledHost(statePath), undefined);
    await fsPromises.writeFile(statePath, JSON.stringify({ packageVersion: "0.1.4-beta.1" }), "utf8");
    assert.equal(update.readInstalledVersion(statePath), undefined);
    await fsPromises.writeFile(statePath, "not-json", "utf8");
    assert.equal(update.readInstalledVersion(statePath), undefined);
    assert.equal(update.readInstalledVersion(path.join(directory, "missing.json")), undefined);
  });
});

test("the real filesystem atomically replaces an expired session-less marker", async () => {
  await withTempDirectory(async (directory) => {
    const payload = {
      tool_name: "Bash",
      tool_input: { command: "rg KPlayer src" },
      cwd: path.resolve("real-filesystem-project-without-session-id"),
    };
    let now = 2_000_000_000_000;
    let spawnCalls = 0;
    const options: UpdateCheckOptions = {
      cacheRoot: directory,
      now: () => now,
      spawn: () => {
        spawnCalls += 1;
        return { unref() {} };
      },
    };

    assert.equal(update.scheduleRefresh(payload, options), true);
    now += update.SESSIONLESS_MARKER_TTL_MS;
    assert.equal(update.scheduleRefresh(payload, options), true);

    const sessionsRoot = path.join(directory, "sessions");
    const entries = await fsPromises.readdir(sessionsRoot);
    assert.equal(entries.length, 1);
    assert.match(entries[0] ?? "", /^session-[a-f0-9]{64}\.seen$/u);
    assert.equal(await fsPromises.readFile(path.join(sessionsRoot, entries[0] ?? ""), "utf8"), String(now));
    assert.equal(spawnCalls, 2);
  });
});

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "kcoderag-update-"));
  try {
    return await run(directory);
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
}

function registryResponse(body: unknown, overrides: Partial<RegistryResponse> = {}): RegistryResponse {
  return {
    statusCode: 200,
    url: worker.REGISTRY_URL,
    headers: { "content-type": "application/json" },
    body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8"),
    ...overrides,
  };
}

test("worker reads only dist-tags.latest with a bounded fixed registry request and atomic cache write", async () => {
  await withTempDirectory(async (directory) => {
    const calls: Array<{ url: string; options: RegistryRequestOptions }> = [];
    const result = await worker.refreshLatest({
      cacheRoot: directory,
      now: () => 2_000_000_000_000,
      request: async (url, options) => {
        calls.push({ url, options });
        return registryResponse({ name: "kcoderag-nav", "dist-tags": { latest: "0.1.5" } });
      },
    });

    assert.equal(result, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://registry.npmjs.org/kcoderag-nav");
    assert.equal(calls[0]?.options.timeoutMs, 1_500);
    assert.ok((calls[0]?.options.maxBytes ?? 0) > 0);
    assert.match(calls[0]?.options.headers.accept ?? "", /json/u);
    assert.deepEqual(
      JSON.parse(await fsPromises.readFile(path.join(directory, "remote-cache.json"), "utf8")),
      { schemaVersion: 1, checkedAt: 2_000_000_000_000, latest: "0.1.5" },
    );
    assert.deepEqual((await fsPromises.readdir(directory)).sort(), ["remote-cache.json"]);
  });
});

test("worker rejects transport, redirect, body, JSON, semver, and write failures without replacing old cache", async () => {
  await withTempDirectory(async (directory) => {
    const cacheFile = path.join(directory, "remote-cache.json");
    const oldCache = cache(1_999_999_999_000, "0.1.4");
    const failures: Array<() => Promise<RegistryResponse>> = [
      async () => { throw new Error("DNS offline"); },
      async () => registryResponse({}, { statusCode: 302 }),
      async () => registryResponse({}, { url: "http://registry.npmjs.org/kcoderag-nav" }),
      async () => registryResponse({}, { headers: { "content-type": "text/html" } }),
      async () => registryResponse("x".repeat(worker.MAX_RESPONSE_BYTES + 1)),
      async () => registryResponse("not-json"),
      async () => registryResponse({ "dist-tags": {} }),
      async () => registryResponse({ "dist-tags": { latest: "1.0.0-beta.1" } }),
    ];

    for (const request of failures) {
      await fsPromises.writeFile(cacheFile, oldCache, "utf8");
      assert.equal(await worker.refreshLatest({ cacheRoot: directory, request }), false);
      assert.equal(await fsPromises.readFile(cacheFile, "utf8"), oldCache);
      assert.deepEqual((await fsPromises.readdir(directory)).sort(), ["remote-cache.json"]);
    }

    await fsPromises.writeFile(cacheFile, oldCache, "utf8");
    assert.equal(await worker.refreshLatest({
      cacheRoot: directory,
      request: async () => registryResponse({ name: "kcoderag-nav", "dist-tags": { latest: "0.1.5" } }),
      writeCache: async () => { throw new Error("permission denied"); },
    }), false);
    assert.equal(await fsPromises.readFile(cacheFile, "utf8"), oldCache);
  });
});

test("worker lock collapses concurrent refreshes and private CLI mode always exits zero", async () => {
  await withTempDirectory(async (directory) => {
    let requestCalls = 0;
    const request = async (): Promise<RegistryResponse> => {
      requestCalls += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
      return registryResponse({ name: "kcoderag-nav", "dist-tags": { latest: "0.1.5" } });
    };
    const results = await Promise.all([
      worker.refreshLatest({ cacheRoot: directory, request }),
      worker.refreshLatest({ cacheRoot: directory, request }),
    ]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal(requestCalls, 1);
    assert.equal(await worker.main(["--bad", directory]), 0);
    assert.equal(await worker.main(["--refresh", directory, "extra"]), 0);
  });
});

test("hook emits its advisory decision before scheduling refresh and never waits for worker", () => {
  const order: string[] = [];
  let output = "";
  const returnCode = hook.main(
    JSON.stringify(relevantPayload),
    (text) => { order.push("output"); output = text; },
    {
      installedVersion: "0.1.4",
      installedHost: "claude",
      readUpdateHint: (_version, options) => {
        assert.equal(options?.host, "claude");
        return "Cached update: npx kcoderag-nav@latest update --host claude";
      },
      scheduleRefresh: () => { order.push("spawn"); return true; },
    },
  );
  assert.equal(returnCode, 0);
  assert.deepEqual(order, ["output", "spawn"]);
  assert.match(output, /Structural lookup/u);
  assert.match(output, /npx kcoderag-nav@latest update --host claude/u);

  const spawnFailure = hook.main(
    JSON.stringify(relevantPayload),
    () => { order.push("second-output"); },
    { scheduleRefresh: () => { throw new Error("offline"); } },
  );
  assert.equal(spawnFailure, 0);
  assert.equal(order.at(-1), "second-output");
});
