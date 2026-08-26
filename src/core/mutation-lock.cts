/** Exclusive user-cache lock for one host and one canonical project target. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

import { InstallError, type HostId } from "./contracts.cjs";

const LOCK_SCHEMA_VERSION = 1;
const MAX_LOCK_BYTES = 2_048;

interface MutationLockInput {
  readonly host: HostId;
  readonly targetRoot: string;
  readonly lockRoot?: string;
}

interface LockRecord {
  readonly schemaVersion: typeof LOCK_SCHEMA_VERSION;
  readonly host: HostId;
  readonly targetHash: string;
  readonly pid: number;
  readonly createdAt: string;
  readonly token: string;
}

export interface MutationLockInspection {
  readonly status: "clear" | "active" | "stale";
  readonly safePath: ".";
}

export interface MutationLockHandle {
  readonly release: () => void;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function defaultMutationLockRoot(): string {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "kcoderag-nav", "locks");
  }
  if (process.env.XDG_CACHE_HOME) {
    return path.join(process.env.XDG_CACHE_HOME, "kcoderag-nav", "locks");
  }
  return path.join(os.homedir(), ".cache", "kcoderag-nav", "locks");
}

function identity(input: MutationLockInput): { readonly lockPath: string; readonly targetHash: string } {
  const canonicalTarget = fs.realpathSync.native(path.resolve(input.targetRoot));
  const targetHash = sha256(`${input.host}\0${canonicalTarget}`);
  const lockRoot = path.resolve(input.lockRoot ?? defaultMutationLockRoot());
  return Object.freeze({ lockPath: path.join(lockRoot, `${targetHash}.lock`), targetHash });
}

function decodeRecord(bytes: Buffer): LockRecord | undefined {
  if (bytes.length === 0 || bytes.length > MAX_LOCK_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (
      typeof value !== "object" || value === null ||
      (value as Partial<LockRecord>).schemaVersion !== LOCK_SCHEMA_VERSION ||
      !["codex", "claude", "cursor", "opencode"].includes(String((value as Partial<LockRecord>).host)) ||
      !/^[0-9a-f]{64}$/u.test(String((value as Partial<LockRecord>).targetHash)) ||
      !Number.isSafeInteger((value as Partial<LockRecord>).pid) ||
      Number((value as Partial<LockRecord>).pid) <= 0 ||
      typeof (value as Partial<LockRecord>).createdAt !== "string" ||
      !/^[0-9a-f]{32}$/u.test(String((value as Partial<LockRecord>).token))
    ) return undefined;
    return value as LockRecord;
  } catch {
    return undefined;
  }
}

function readRecord(lockPath: string): LockRecord | undefined {
  try {
    const stats = fs.lstatSync(lockPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_LOCK_BYTES) return undefined;
    return decodeRecord(fs.readFileSync(lockPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function inspectMutationLock(input: MutationLockInput): MutationLockInspection {
  let lockPath: string;
  try {
    lockPath = identity(input).lockPath;
  } catch {
    return Object.freeze({ status: "stale", safePath: "." });
  }
  if (!fs.existsSync(lockPath)) return Object.freeze({ status: "clear", safePath: "." });
  const record = readRecord(lockPath);
  return Object.freeze({
    status: record !== undefined && processIsAlive(record.pid) ? "active" : "stale",
    safePath: ".",
  });
}

export function acquireMutationLock(input: MutationLockInput): MutationLockHandle {
  let lockPath: string;
  let targetHash: string;
  try {
    ({ lockPath, targetHash } = identity(input));
    fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  } catch {
    throw new InstallError("target_busy", ".");
  }
  const token = crypto.randomBytes(16).toString("hex");
  const record: LockRecord = Object.freeze({
    schemaVersion: LOCK_SCHEMA_VERSION,
    host: input.host,
    targetHash,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    token,
  });
  let descriptor: number;
  try {
    descriptor = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
  } catch (error) {
    if (typeof descriptor! === "number") {
      try { fs.closeSync(descriptor!); } catch { /* best effort */ }
    }
    throw new InstallError("target_busy", ".");
  }
  let released = false;
  return Object.freeze({
    release: () => {
      if (released) return;
      released = true;
      try {
        if (readRecord(lockPath)?.token === token) fs.unlinkSync(lockPath);
      } catch {
        // A failed release deliberately leaves a diagnosable stale lock.
      }
    },
  });
}
