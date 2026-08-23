#!/usr/bin/env node
/** Foreground-only update cache reader and detached refresh scheduler. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

export const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_SESSION_MARKERS = 128;
export const CACHE_SCHEMA_VERSION = 1;
const MAX_CACHE_CHARS = 8 * 1_024;
const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const RELEVANT_TOOLS = new Set(["Grep", "Glob", "Bash"]);

export interface UpdateCheckFiles {
  readText(filePath: string): string | undefined;
  ensureDirectory(directoryPath: string): void;
  createExclusive(filePath: string, contents: string): boolean;
  listFiles(directoryPath: string): readonly { readonly name: string; readonly mtimeMs: number }[];
  remove(filePath: string): void;
}

export interface UpdateCheckOptions {
  readonly cacheRoot?: string;
  readonly now?: () => number;
  readonly files?: UpdateCheckFiles;
  readonly spawn?: (...args: readonly unknown[]) => { unref?(): void };
  readonly workerPath?: string;
  readonly hookPayload?: unknown;
}

export function readInstalledVersion(statePath = path.resolve(__dirname, "..", "install-state.json")): string | undefined {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    if (raw.length > 256 * 1_024) return undefined;
    const document: unknown = JSON.parse(raw);
    return isRecord(document) && isSimpleVersion(document.packageVersion) ? document.packageVersion : undefined;
  } catch {
    return undefined;
  }
}

interface UpdateCache {
  readonly checkedAt: number;
  readonly latest: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultCacheRoot(): string {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "kcoderag-nav");
  }
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "kcoderag-nav");
}

const nodeFiles: UpdateCheckFiles = {
  readText(filePath) {
    try {
      const contents = fs.readFileSync(filePath, "utf8");
      return contents.length <= MAX_CACHE_CHARS ? contents : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  ensureDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  },
  createExclusive(filePath, contents) {
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(filePath, "wx", 0o600);
      fs.writeFileSync(descriptor, contents, { encoding: "utf8" });
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      return true;
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch { /* fail open */ }
        try { fs.unlinkSync(filePath); } catch { /* fail open */ }
      }
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  },
  listFiles(directoryPath) {
    try {
      return fs.readdirSync(directoryPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => ({
          name: entry.name,
          mtimeMs: fs.statSync(path.join(directoryPath, entry.name)).mtimeMs,
        }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  },
  remove(filePath) {
    try { fs.unlinkSync(filePath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  },
};

function validNow(clock: (() => number) | undefined): number | undefined {
  const value = clock === undefined ? Date.now() : clock();
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function versionParts(version: string | undefined): readonly [number, number, number] | undefined {
  if (version === undefined) return undefined;
  const match = VERSION_RE.exec(version);
  if (match === null) return undefined;
  const parts = match.slice(1).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part))) return undefined;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function isSimpleVersion(version: unknown): version is string {
  return typeof version === "string" && versionParts(version) !== undefined;
}

function isNewerVersion(installed: string, latest: string): boolean {
  const left = versionParts(installed);
  const right = versionParts(latest);
  if (left === undefined || right === undefined) return false;
  for (let index = 0; index < left.length; index += 1) {
    if ((right[index] ?? 0) > (left[index] ?? 0)) return true;
    if ((right[index] ?? 0) < (left[index] ?? 0)) return false;
  }
  return false;
}

function readCache(files: UpdateCheckFiles, cacheRoot: string): UpdateCache | undefined {
  const raw = files.readText(path.join(cacheRoot, "remote-cache.json"));
  if (raw === undefined || raw.length > MAX_CACHE_CHARS) return undefined;
  const document: unknown = JSON.parse(raw);
  if (
    !isRecord(document) ||
    Object.keys(document).sort().join(",") !== "checkedAt,latest,schemaVersion" ||
    document.schemaVersion !== CACHE_SCHEMA_VERSION ||
    typeof document.checkedAt !== "number" ||
    !Number.isFinite(document.checkedAt) ||
    document.checkedAt < 0 ||
    !isSimpleVersion(document.latest)
  ) return undefined;
  return { checkedAt: document.checkedAt, latest: document.latest };
}

function isFresh(cache: UpdateCache | undefined, now: number): cache is UpdateCache {
  return cache !== undefined && now >= cache.checkedAt && now - cache.checkedAt < CACHE_TTL_MS;
}

function relevantPayload(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.tool_name === "string" && RELEVANT_TOOLS.has(value.tool_name) &&
    isRecord(value.tool_input);
}

function sessionKey(payload: Record<string, unknown>, now: number): string {
  let material: string | undefined;
  for (const field of ["session_id", "thread_id", "conversation_id"] as const) {
    const candidate = payload[field];
    if ((typeof candidate === "string" || typeof candidate === "number") && typeof candidate !== "boolean") {
      const normalized = String(candidate).trim().slice(0, 512);
      if (normalized.length > 0) {
        material = `${field}\0${normalized}`;
        break;
      }
    }
  }
  if (material === undefined) {
    const candidate = payload.cwd;
    const cwd = typeof candidate === "string" || typeof candidate === "number" ? String(candidate) : ".";
    const normalized = path.normalize(cwd.trim().slice(0, 2_048) || ".").toLowerCase();
    material = `fallback\0${normalized}\0${Math.floor(now / (60 * 60 * 1_000))}`;
  }
  return crypto.createHash("sha256").update(material, "utf8").digest("hex");
}

function pruneSessionMarkers(files: UpdateCheckFiles, directoryPath: string, keepName: string): void {
  const markers = files.listFiles(directoryPath)
    .filter((entry) => entry.name.startsWith("session-") && entry.name.endsWith(".seen"));
  if (markers.length <= MAX_SESSION_MARKERS) return;
  const removable = markers
    .filter((entry) => entry.name !== keepName)
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
  for (const entry of removable.slice(0, markers.length - MAX_SESSION_MARKERS)) {
    try { files.remove(path.join(directoryPath, entry.name)); } catch { /* fail open */ }
  }
}

function claimSession(
  files: UpdateCheckFiles,
  cacheRoot: string,
  hookPayload: Record<string, unknown>,
  now: number,
): boolean {
  const sessionsRoot = path.join(cacheRoot, "sessions");
  files.ensureDirectory(sessionsRoot);
  const markerName = `session-${sessionKey(hookPayload, now)}.seen`;
  if (!files.createExclusive(path.join(sessionsRoot, markerName), "")) return false;
  try { pruneSessionMarkers(files, sessionsRoot, markerName); } catch { return false; }
  return true;
}

export function readUpdateHint(
  installedVersion: string | undefined,
  options: UpdateCheckOptions = {},
): string | undefined {
  try {
    if (process.env.KCODERAG_NAV_UPDATE_CHECK === "0" || !isSimpleVersion(installedVersion)) return undefined;
    const now = validNow(options.now);
    if (now === undefined) return undefined;
    const files = options.files ?? nodeFiles;
    const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
    const latest = readCache(files, cacheRoot);
    if (!isFresh(latest, now)) return undefined;
    if (options.hookPayload !== undefined) {
      if (!relevantPayload(options.hookPayload) || !claimSession(files, cacheRoot, options.hookPayload, now)) {
        return undefined;
      }
    }
    if (!isNewerVersion(installedVersion, latest.latest)) return undefined;
    return `KCodeRag Nav update available: ${installedVersion} -> ${latest.latest}. ` +
      "Ask the user first; do not update automatically. Run: npx kcoderag-nav@latest update";
  } catch {
    return undefined;
  }
}

export function scheduleRefresh(
  hookPayload: unknown,
  options: UpdateCheckOptions = {},
): boolean {
  try {
    if (process.env.KCODERAG_NAV_UPDATE_CHECK === "0" || !relevantPayload(hookPayload)) return false;
    const now = validNow(options.now);
    if (now === undefined) return false;
    const files = options.files ?? nodeFiles;
    const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
    if (isFresh(readCache(files, cacheRoot), now)) return false;

    if (!claimSession(files, cacheRoot, hookPayload, now)) return false;

    const spawn = options.spawn ?? childProcess.spawn;
    const workerPath = path.resolve(options.workerPath ?? path.join(__dirname, "update-worker.cjs"));
    const child = spawn(process.execPath, [workerPath, "--refresh", cacheRoot], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
