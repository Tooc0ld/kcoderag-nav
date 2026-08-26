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
const HOSTS = new Set<HostId>(["codex", "claude", "cursor", "opencode"]);
const STABLE_FIELDS = Object.freeze([
  "session_id",
  "thread_id",
  "conversation_id",
] as const);

export type StableSessionField = typeof STABLE_FIELDS[number];

export interface StableSessionIdentity {
  readonly field: StableSessionField;
  readonly value: string;
}

export interface OnceMarkerFiles {
  ensureDirectory(directoryPath: string): void;
  createExclusive(filePath: string): boolean;
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
  createExclusive(filePath: string): boolean {
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(filePath, "wx", 0o600);
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
    options.capability === "jx3-style-nudge" &&
    normalizedManagedRoot(options.managedRoot) !== undefined;
}

export function nudgeMarkerKey(
  payload: unknown,
  options: OnceMarkerScope,
): string | undefined {
  const identity = stableSessionIdentity(payload);
  const managedRoot = normalizedManagedRoot(options.managedRoot);
  if (identity === undefined || managedRoot === undefined || !validScope(options)) return undefined;
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
    try {
      const names = files.listFiles(directoryPath);
      const markerName = `${key}.claim`;
      if (names.includes(markerName)) return suppressed(key);
      if (names.filter((name) => MARKER_NAME_RE.test(name)).length >= MAX_NUDGE_MARKERS) {
        return suppressed(key);
      }
      claimed = files.createExclusive(path.join(directoryPath, markerName));
    } finally {
      try {
        files.remove(lockPath);
        lockReleased = true;
      } catch {
        lockReleased = false;
      }
    }
    return claimed && lockReleased
      ? Object.freeze({ claimed: true, key })
      : suppressed(key);
  } catch {
    return suppressed(key);
  }
}
