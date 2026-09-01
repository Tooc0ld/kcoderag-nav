#!/usr/bin/env node
/** Stable-session-only zero-byte once claims for advisory capability nudges. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

import type { CapabilityId } from "../capabilities/contracts.cjs";
import type { HostId } from "../core/contracts.cjs";

export const MAX_NUDGE_MARKERS = 1_024;
const NUDGE_DIRECTORY = "nudges";
const CAPACITY_LOCK = ".capacity.lock";
const MAX_STABLE_ID_CHARS = 512;
const MAX_MANAGED_ROOT_CHARS = 4_096;
const MARKER_NAME_RE = /^[0-9a-f]{64}\.claim$/u;
const MAX_CONTEXT_EPOCH = 1_023;
const HOSTS = new Set<HostId>(["codex", "claude", "cursor", "opencode", "zcode"]);
const STABLE_FIELDS = Object.freeze([
  "session_id",
  "thread_id",
  "conversation_id",
] as const);

export type StableSessionField = typeof STABLE_FIELDS[number];
export type ContextEpoch = string;
export type ReminderKind =
  | "navigation"
  | "code-style"
  | "feedback-reminded"
  | "feedback-submitted"
  | "index-available";
export type SessionStartSource = "startup" | "resume" | "clear" | "compact";

export interface StableSessionIdentity {
  readonly field: StableSessionField;
  readonly value: string;
}

export interface OnceMarkerFiles {
  ensureDirectory(directoryPath: string): void;
  createExclusive(filePath: string, contents?: string): boolean;
  listFiles(directoryPath: string): readonly string[];
  remove(filePath: string): void;
}

export interface OnceMarkerScope {
  readonly host: HostId;
  readonly managedRoot: string;
  readonly capability: CapabilityId;
}

export interface OnceMarkerOptions extends OnceMarkerScope {
  readonly cacheRoot?: string;
  readonly files?: OnceMarkerFiles;
}

export interface ReminderScope extends OnceMarkerScope {
  readonly reminderKind: ReminderKind;
  readonly contextEpoch?: ContextEpoch;
}

export interface ReminderOptions extends ReminderScope {
  readonly cacheRoot?: string;
  readonly files?: OnceMarkerFiles;
  readonly now?: () => number;
}

export interface ReminderLookupOptions extends ReminderScope {
  readonly cacheRoot?: string;
}

export interface ContextEpochOptions extends OnceMarkerScope {
  readonly source: SessionStartSource;
  readonly cacheRoot?: string;
}

export interface OnceMarkerResult {
  readonly claimed: boolean;
  readonly key?: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultCacheRoot(): string {
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "kcoderag-nav",
    );
  }
  return path.join(
    process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
    "kcoderag-nav",
  );
}

const nodeFiles: OnceMarkerFiles = Object.freeze({
  ensureDirectory(directoryPath: string): void {
    fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  },
  createExclusive(filePath: string, contents = ""): boolean {
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(filePath, "wx", 0o600);
      if (contents.length > 0) fs.writeFileSync(descriptor, contents, { encoding: "utf8" });
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
  listFiles(directoryPath: string): readonly string[] {
    try {
      return fs.readdirSync(directoryPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  },
  remove(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  },
});

export function stableSessionIdentity(payload: unknown): StableSessionIdentity | undefined {
  if (!isRecord(payload)) return undefined;
  for (const field of STABLE_FIELDS) {
    const value = payload[field];
    if (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_STABLE_ID_CHARS &&
      value.trim().length > 0
    ) {
      return Object.freeze({ field, value });
    }
  }
  return undefined;
}

function normalizedManagedRoot(value: string): string | undefined {
  if (
    value.length === 0 ||
    value.length > MAX_MANAGED_ROOT_CHARS ||
    value.includes("\0") ||
    !path.isAbsolute(value)
  ) {
    return undefined;
  }
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function validScope(options: OnceMarkerScope): boolean {
  return HOSTS.has(options.host) &&
    (options.capability === "code-style-nudge" || options.capability === "kcoderag-navigation") &&
    normalizedManagedRoot(options.managedRoot) !== undefined;
}

export function nudgeMarkerKey(
  payload: unknown,
  options: OnceMarkerScope,
): string | undefined {
  const identity = stableSessionIdentity(payload);
  const managedRoot = normalizedManagedRoot(options.managedRoot);
  if (
    identity === undefined || managedRoot === undefined ||
    options.capability !== "code-style-nudge" || !validScope(options)
  ) return undefined;
  const material = [
    "kcoderag-nav-nudge-v1",
    options.host,
    managedRoot,
    options.capability,
    identity.field,
    identity.value,
  ].join("\0");
  return crypto.createHash("sha256").update(material, "utf8").digest("hex");
}

function suppressed(key?: string): OnceMarkerResult {
  return key === undefined
    ? Object.freeze({ claimed: false })
    : Object.freeze({ claimed: false, key });
}

function validContextEpoch(value: ContextEpoch | undefined): value is ContextEpoch {
  if (value === undefined || value.length === 0 || value.length > 128 || value.includes("\0")) return false;
  return /^(?:0|[1-9][0-9]{0,3})$/u.test(value) && Number(value) <= MAX_CONTEXT_EPOCH;
}

function sessionScoped(kind: ReminderKind): boolean {
  return kind === "feedback-submitted" || kind === "index-available";
}

export function reminderMarkerKey(
  payload: unknown,
  options: ReminderScope,
): string | undefined {
  const identity = stableSessionIdentity(payload);
  const managedRoot = normalizedManagedRoot(options.managedRoot);
  if (identity === undefined || managedRoot === undefined || !validScope(options)) return undefined;
  const scope = sessionScoped(options.reminderKind) ? "session" : options.contextEpoch;
  if (scope === undefined || (scope !== "session" && !validContextEpoch(scope))) return undefined;
  const material = [
    "kcoderag-nav-reminder-v2",
    options.host,
    managedRoot,
    options.capability,
    identity.field,
    identity.value,
    scope,
    options.reminderKind,
  ].join("\0");
  return crypto.createHash("sha256").update(material, "utf8").digest("hex");
}

function markerRecord(options: ReminderOptions, now: number): string | undefined {
  if (!Number.isFinite(now) || now < 0) return undefined;
  return `${JSON.stringify({
    schemaVersion: 1,
    host: options.host,
    capability: options.capability,
    reminderKind: options.reminderKind,
    scope: sessionScoped(options.reminderKind) ? "session" : "epoch",
    recordedAt: now,
  })}\n`;
}

function claimKey(
  key: string,
  contents: string,
  options: { readonly cacheRoot?: string; readonly files?: OnceMarkerFiles },
): OnceMarkerResult {
  try {
    const files = options.files ?? nodeFiles;
    const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
    const directoryPath = path.join(cacheRoot, NUDGE_DIRECTORY);
    files.ensureDirectory(directoryPath);
    const lockPath = path.join(directoryPath, CAPACITY_LOCK);
    if (!files.createExclusive(lockPath)) return suppressed(key);
    let claimed = false;
    let lockReleased = false;
    let markerPath: string | undefined;
    try {
      const names = files.listFiles(directoryPath);
      const markerName = `${key}.claim`;
      if (names.includes(markerName)) return suppressed(key);
      if (names.filter((name) => MARKER_NAME_RE.test(name)).length >= MAX_NUDGE_MARKERS) {
        return suppressed(key);
      }
      markerPath = path.join(directoryPath, markerName);
      claimed = files.createExclusive(markerPath, contents);
    } finally {
      try {
        files.remove(lockPath);
        lockReleased = true;
      } catch {
        lockReleased = false;
        if (claimed && markerPath !== undefined) {
          try { files.remove(markerPath); } catch { /* fail open */ }
          claimed = false;
        }
      }
    }
    return claimed && lockReleased
      ? Object.freeze({ claimed: true, key })
      : suppressed(key);
  } catch {
    return suppressed(key);
  }
}

export function claimReminder(payload: unknown, options: ReminderOptions): OnceMarkerResult {
  const key = reminderMarkerKey(payload, options);
  if (key === undefined) return suppressed();
  const record = markerRecord(options, options.now?.() ?? Date.now());
  return record === undefined ? suppressed(key) : claimKey(key, record, options);
}

/** Read only one exact hash-addressed claim and reject malformed or tampered metadata. */
export function reminderClaimExists(payload: unknown, options: ReminderLookupOptions): boolean {
  const key = reminderMarkerKey(payload, options);
  if (key === undefined) return false;
  try {
    const filePath = path.join(
      path.resolve(options.cacheRoot ?? defaultCacheRoot()),
      NUDGE_DIRECTORY,
      `${key}.claim`,
    );
    const metadata = fs.lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > 512) {
      return false;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const record: unknown = JSON.parse(raw);
    const expectedScope = sessionScoped(options.reminderKind) ? "session" : "epoch";
    return isRecord(record) &&
      Object.keys(record).sort().join("\0") ===
        "capability\0host\0recordedAt\0reminderKind\0schemaVersion\0scope" &&
      record.schemaVersion === 1 &&
      record.host === options.host &&
      record.capability === options.capability &&
      record.reminderKind === options.reminderKind &&
      record.scope === expectedScope &&
      typeof record.recordedAt === "number" && Number.isFinite(record.recordedAt) &&
      record.recordedAt >= 0;
  } catch {
    return false;
  }
}

function epochStateKey(payload: unknown, options: OnceMarkerScope): string | undefined {
  const identity = stableSessionIdentity(payload);
  const managedRoot = normalizedManagedRoot(options.managedRoot);
  if (identity === undefined || managedRoot === undefined || !validScope(options)) return undefined;
  return crypto.createHash("sha256").update([
    "kcoderag-nav-epoch-v1",
    options.host,
    managedRoot,
    options.capability,
    identity.field,
    identity.value,
  ].join("\0"), "utf8").digest("hex");
}

function readEpochState(filePath: string): number | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (raw.length === 0 || raw.length > 256) return undefined;
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) || Object.keys(value).sort().join(",") !== "generation,schemaVersion" ||
      value.schemaVersion !== 1 || !Number.isSafeInteger(value.generation) ||
      (value.generation as number) < 0 || (value.generation as number) > MAX_CONTEXT_EPOCH
    ) return undefined;
    return value.generation as number;
  } catch {
    return undefined;
  }
}

function writeEpochState(filePath: string, generation: number): boolean {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: 1, generation })}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    return true;
  } catch {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* fail open */ }
    }
    try { fs.unlinkSync(temporaryPath); } catch { /* fail open */ }
    return false;
  }
}

/** Resolve one bounded epoch per stable session; only clear/compact advance it. */
export function contextEpochForSession(
  payload: unknown,
  options: ContextEpochOptions,
): ContextEpoch | undefined {
  const key = epochStateKey(payload, options);
  if (key === undefined) return undefined;
  const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
  const directoryPath = path.join(cacheRoot, NUDGE_DIRECTORY);
  const statePath = path.join(directoryPath, `${key}.epoch.json`);
  const lockPath = path.join(directoryPath, `${key}.epoch.lock`);
  try {
    fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
    const current = readEpochState(statePath);
    if (options.source === "startup" || options.source === "resume") {
      if (current !== undefined) return String(current);
      try {
        fs.writeFileSync(statePath, `${JSON.stringify({ schemaVersion: 1, generation: 0 })}\n`, {
          flag: "wx",
          mode: 0o600,
        });
        return "0";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          const raced = readEpochState(statePath);
          return raced === undefined ? undefined : String(raced);
        }
        return undefined;
      }
    }
    let lock: number | undefined;
    try {
      lock = fs.openSync(lockPath, "wx", 0o600);
      const observed = readEpochState(statePath) ?? 0;
      const next = observed + 1;
      if (next > MAX_CONTEXT_EPOCH || !writeEpochState(statePath, next)) return undefined;
      return String(next);
    } finally {
      if (lock !== undefined) {
        try { fs.closeSync(lock); } catch { /* fail open */ }
        try { fs.unlinkSync(lockPath); } catch { /* fail open */ }
      }
    }
  } catch {
    return undefined;
  }
}

/** Enumerate only bounded keys derivable from one exact stable session identity. */
export function reminderMarkerKeysForSession(
  payload: unknown,
  options: OnceMarkerOptions,
): readonly string[] {
  const epochKey = epochStateKey(payload, options);
  if (epochKey === undefined) return Object.freeze([]);
  const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
  const statePath = path.join(cacheRoot, NUDGE_DIRECTORY, `${epochKey}.epoch.json`);
  const generation = readEpochState(statePath) ?? 0;
  const keys: string[] = [];
  const epochKinds: readonly ReminderKind[] = options.capability === "code-style-nudge"
    ? ["code-style"]
    : ["navigation", "feedback-reminded"];
  for (let epoch = 0; epoch <= generation; epoch += 1) {
    for (const reminderKind of epochKinds) {
      const key = reminderMarkerKey(payload, {
        ...options,
        reminderKind,
        contextEpoch: String(epoch),
      });
      if (key !== undefined) keys.push(key);
    }
  }
  if (options.capability === "kcoderag-navigation") {
    for (const reminderKind of ["feedback-submitted", "index-available"] as const) {
      const key = reminderMarkerKey(payload, { ...options, reminderKind });
      if (key !== undefined) keys.push(key);
    }
  }
  return Object.freeze(keys);
}

export function claimNudgeOnce(
  payload: unknown,
  options: OnceMarkerOptions,
): OnceMarkerResult {
  const key = nudgeMarkerKey(payload, options);
  if (key === undefined) return suppressed();
  try {
    const files = options.files ?? nodeFiles;
    const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
    const directoryPath = path.join(cacheRoot, NUDGE_DIRECTORY);
    files.ensureDirectory(directoryPath);

    const lockPath = path.join(directoryPath, CAPACITY_LOCK);
    if (!files.createExclusive(lockPath)) return suppressed(key);
    let claimed = false;
    let lockReleased = false;
    let markerPath: string | undefined;
    try {
      const names = files.listFiles(directoryPath);
      const markerName = `${key}.claim`;
      if (names.includes(markerName)) return suppressed(key);
      if (names.filter((name) => MARKER_NAME_RE.test(name)).length >= MAX_NUDGE_MARKERS) {
        return suppressed(key);
      }
      markerPath = path.join(directoryPath, markerName);
      claimed = files.createExclusive(markerPath);
    } finally {
      try {
        files.remove(lockPath);
        lockReleased = true;
      } catch {
        lockReleased = false;
        if (claimed && markerPath !== undefined) {
          try { files.remove(markerPath); } catch { /* fail open */ }
          claimed = false;
        }
      }
    }
    return claimed && lockReleased
      ? Object.freeze({ claimed: true, key })
      : suppressed(key);
  } catch {
    return suppressed(key);
  }
}
