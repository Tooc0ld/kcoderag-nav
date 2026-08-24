/** Single-host atomic filesystem transaction. No other core module writes to disk. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

import {
  CORE_SCHEMA_VERSION,
  InstallError,
  type DesiredEntry,
  type DesiredState,
} from "./contracts.cjs";
import { validateManagedPath } from "./project-target.cjs";
import { isValidatedDesiredState } from "./state.cjs";

export interface TransactionOptions {
  readonly failAtStage?: number;
  readonly failAtCommit?: number;
  readonly failAtRollback?: number;
  /** Test seam fired after identity capture and before the first managed read. */
  readonly onAfterValidation?: () => void;
  readonly onCommit?: (relativePath: string) => void;
}

export interface TransactionResult {
  readonly schemaVersion: typeof CORE_SCHEMA_VERSION;
  readonly host: DesiredState["host"];
  readonly changedPaths: readonly string[];
}

interface RecoveryLocation {
  readonly relativePath: string;
  readonly absolutePath: string;
}

interface RecoveryManifestEntry {
  readonly relativePath: string;
  readonly kind: "absent" | "file";
  readonly digest?: string;
  readonly backup?: string;
}

interface DirectoryIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly realPath: string;
}

type DirectoryIdentities = Map<string, DirectoryIdentity | null>;

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parentDirectories(desired: DesiredState, entry: DesiredEntry): readonly string[] {
  const directories = [desired.target.root];
  let current = desired.target.root;
  for (const part of entry.path.relativePath.split("/").slice(0, -1)) {
    current = path.join(current, part);
    directories.push(current);
  }
  return directories;
}

function inspectDirectory(
  desired: DesiredState,
  directory: string,
  safePath: string,
): DirectoryIdentity | null {
  try {
    const metadata = fs.lstatSync(directory);
    if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape", safePath);
    if (!metadata.isDirectory()) throw new InstallError("special_file", safePath);
    const realPath = fs.realpathSync(directory);
    const relation = path.relative(desired.target.root, realPath);
    if (relation.startsWith("..") || path.isAbsolute(relation)) {
      throw new InstallError("symlink_escape", safePath);
    }
    return {
      dev: metadata.dev,
      ino: metadata.ino,
      mode: metadata.mode,
      realPath,
    };
  } catch (error) {
    if (error instanceof InstallError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new InstallError("unreadable", safePath);
  }
}

function sameDirectory(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.realPath === right.realPath;
}

function captureDirectoryIdentities(
  desired: DesiredState,
  entries: readonly DesiredEntry[],
): DirectoryIdentities {
  const identities: DirectoryIdentities = new Map();
  for (const entry of entries) {
    for (const directory of parentDirectories(desired, entry)) {
      if (!identities.has(directory)) {
        identities.set(directory, inspectDirectory(desired, directory, entry.path.relativePath));
      }
    }
  }
  return identities;
}

function assertParentIdentities(
  desired: DesiredState,
  entry: DesiredEntry,
  identities: DirectoryIdentities,
): void {
  for (const directory of parentDirectories(desired, entry)) {
    const expected = identities.get(directory);
    if (expected === undefined) throw new InstallError("invalid_desired_state", entry.path.relativePath);
    const current = inspectDirectory(desired, directory, entry.path.relativePath);
    if (
      (expected === null && current !== null) ||
      (expected !== null && (current === null || !sameDirectory(expected, current)))
    ) {
      throw new InstallError("filesystem_race", entry.path.relativePath);
    }
  }
}

function rememberDirectory(
  desired: DesiredState,
  entry: DesiredEntry,
  directory: string,
  identities: DirectoryIdentities,
): void {
  const identity = inspectDirectory(desired, directory, entry.path.relativePath);
  if (identity === null) throw new InstallError("filesystem_race", entry.path.relativePath);
  identities.set(directory, identity);
}

function readOptional(
  desired: DesiredState,
  entry: DesiredEntry,
  identities: DirectoryIdentities,
): Buffer | undefined {
  assertParentIdentities(desired, entry, identities);
  try {
    const metadata = fs.lstatSync(entry.path.absolutePath);
    if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape", entry.path.relativePath);
    if (!metadata.isFile()) throw new InstallError("special_file", entry.path.relativePath);
    return fs.readFileSync(entry.path.absolutePath);
  } catch (error) {
    if (error instanceof InstallError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new InstallError("unreadable", entry.path.relativePath);
  }
}

function verifyExpected(entry: DesiredEntry, current: Buffer | undefined): void {
  const matches = entry.expectedDigest === null
    ? current === undefined
    : current !== undefined && sha256(current) === entry.expectedDigest;
  if (!matches) throw new InstallError("managed_content_changed", entry.path.relativePath);
}

function orderedEntries(desired: DesiredState): readonly DesiredEntry[] {
  return [...desired.entries].sort((left, right) => {
    if (left.path.relativePath === desired.statePath.relativePath) return 1;
    if (right.path.relativePath === desired.statePath.relativePath) return -1;
    return left.path.relativePath.localeCompare(right.path.relativePath);
  });
}

function ensureParentDirectories(
  desired: DesiredState,
  entry: DesiredEntry,
  createdDirectories: string[],
  identities: DirectoryIdentities,
): void {
  const parts = entry.path.relativePath.split("/").slice(0, -1);
  let current = desired.target.root;
  for (const part of parts) {
    assertParentIdentities(desired, entry, identities);
    current = path.join(current, part);
    try {
      const metadata = fs.lstatSync(current);
      if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape", entry.path.relativePath);
      if (!metadata.isDirectory()) throw new InstallError("special_file", entry.path.relativePath);
    } catch (error) {
      if (error instanceof InstallError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new InstallError("unreadable", entry.path.relativePath);
      }
      try {
        fs.mkdirSync(current, { mode: 0o700 });
        createdDirectories.push(current);
        rememberDirectory(desired, entry, current, identities);
      } catch {
        throw new InstallError("transaction_failed", entry.path.relativePath);
      }
    }
  }
}

function writeTemporary(
  destination: string,
  bytes: Buffer,
  onCreated?: (temporary: string) => void,
): string {
  const temporary = path.join(path.dirname(destination), `.kcoderag-stage-${crypto.randomUUID()}`);
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    onCreated?.(temporary);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    return temporary;
  } catch (error) {
    try {
      removeFileIfPresent(temporary);
    } catch {
      // The outer transaction will report cleanup failure if a tracked file remains.
    }
    throw error;
  }
}

function writeSecureFile(destination: string, bytes: Buffer): void {
  try {
    const descriptor = fs.openSync(destination, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    try {
      removeFileIfPresent(destination);
    } catch {
      // createRecovery removes the private recovery tree on propagation.
    }
    throw error;
  }
}

function allocateRecovery(desired: DesiredState): RecoveryLocation {
  const relativePath = `.kcoderag-nav-recovery-${crypto.randomUUID()}`;
  return { relativePath, absolutePath: path.join(desired.target.root, relativePath) };
}

function createRecovery(
  recovery: RecoveryLocation,
  desired: DesiredState,
  entries: readonly DesiredEntry[],
  originals: ReadonlyMap<string, Buffer | undefined>,
): void {
  try {
    fs.mkdirSync(recovery.absolutePath, { mode: 0o700 });
    const filesDirectory = path.join(recovery.absolutePath, "files");
    fs.mkdirSync(filesDirectory, { mode: 0o700 });

    const manifestEntries: RecoveryManifestEntry[] = [];
    for (const [index, entry] of entries.entries()) {
      const original = originals.get(entry.path.relativePath);
      if (original === undefined) {
        manifestEntries.push({ relativePath: entry.path.relativePath, kind: "absent" });
        continue;
      }
      const backup = `files/${index.toString().padStart(4, "0")}.bin`;
      writeSecureFile(path.join(recovery.absolutePath, ...backup.split("/")), original);
      manifestEntries.push({
        relativePath: entry.path.relativePath,
        kind: "file",
        digest: sha256(original),
        backup,
      });
    }
    const manifest = Buffer.from(`${JSON.stringify({
      schemaVersion: CORE_SCHEMA_VERSION,
      host: desired.host,
      entries: manifestEntries,
    }, null, 2)}\n`, "utf8");
    writeSecureFile(path.join(recovery.absolutePath, "manifest.json"), manifest);
  } catch (error) {
    try {
      fs.rmSync(recovery.absolutePath, { recursive: true, force: true });
    } catch {
      // No managed destination has changed yet; the transaction reports a safe failure code.
    }
    throw error;
  }
}

function removeFileIfPresent(filePath: string): void {
  try {
    const metadata = fs.lstatSync(filePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("unsafe_unlink");
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function restorePath(
  desired: DesiredState,
  entry: DesiredEntry,
  identities: DirectoryIdentities,
  original: Buffer | undefined,
): void {
  assertParentIdentities(desired, entry, identities);
  const destination = entry.path.absolutePath;
  if (original === undefined) {
    removeFileIfPresent(destination);
    return;
  }
  const temporary = writeTemporary(destination, original);
  try {
    assertParentIdentities(desired, entry, identities);
    fs.renameSync(temporary, destination);
  } catch (error) {
    try {
      removeFileIfPresent(temporary);
    } catch {
      // The caller records rollback failure and retains the recovery directory.
    }
    throw error;
  }
}

function pruneCreatedDirectories(createdDirectories: readonly string[]): boolean {
  let complete = true;
  for (const directory of [...createdDirectories].reverse()) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" &&
          (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") {
        complete = false;
      }
    }
  }
  return complete;
}

function validateTransactionInput(desired: DesiredState): readonly DesiredEntry[] {
  if (!isValidatedDesiredState(desired)) throw new InstallError("invalid_desired_state");
  const entries = orderedEntries(desired);
  for (const entry of entries) {
    const current = validateManagedPath(
      desired.target,
      entry.path.relativePath,
      desired.managedRoots,
    );
    if (current.absolutePath !== entry.path.absolutePath) {
      throw new InstallError("invalid_desired_state", entry.path.relativePath);
    }
  }
  return entries;
}

export function applyTransaction(
  desired: DesiredState,
  options: TransactionOptions = {},
): TransactionResult {
  const entries = validateTransactionInput(desired);
  const identities = captureDirectoryIdentities(desired, entries);
  options.onAfterValidation?.();
  const originals = new Map<string, Buffer | undefined>();
  const payloads = new Map<string, Buffer | null>();

  // Complete pre-read and digest validation occurs before the first directory or file write.
  for (const entry of entries) {
    const current = readOptional(desired, entry, identities);
    verifyExpected(entry, current);
    originals.set(entry.path.relativePath, current === undefined ? undefined : Buffer.from(current));
    payloads.set(entry.path.relativePath, entry.content === null ? null : Buffer.from(entry.content));
  }

  const createdDirectories: string[] = [];
  const staged = new Map<string, string>();
  const committed = new Set<string>();
  let recovery: RecoveryLocation | undefined;
  let transactionStarted = false;

  try {
    for (const [index, entry] of entries.entries()) {
      if (options.failAtStage === index) throw new Error("injected_stage_failure");
      const payload = payloads.get(entry.path.relativePath);
      if (payload !== null && payload !== undefined) {
        ensureParentDirectories(desired, entry, createdDirectories, identities);
        assertParentIdentities(desired, entry, identities);
        writeTemporary(entry.path.absolutePath, payload, (temporary) => {
          staged.set(entry.path.relativePath, temporary);
        });
      }
    }

    recovery = allocateRecovery(desired);
    createRecovery(recovery, desired, entries, originals);
    transactionStarted = true;
    for (const [index, entry] of entries.entries()) {
      if (options.failAtCommit === index) throw new Error("injected_commit_failure");
      const payload = payloads.get(entry.path.relativePath);
      const current = readOptional(desired, entry, identities);
      verifyExpected(entry, current);
      if (payload === null) {
        assertParentIdentities(desired, entry, identities);
        removeFileIfPresent(entry.path.absolutePath);
      } else {
        const temporary = staged.get(entry.path.relativePath);
        if (temporary === undefined) throw new Error("missing_staged_file");
        assertParentIdentities(desired, entry, identities);
        fs.renameSync(temporary, entry.path.absolutePath);
        staged.delete(entry.path.relativePath);
      }
      committed.add(entry.path.relativePath);
      options.onCommit?.(entry.path.relativePath);
    }
    fs.rmSync(recovery.absolutePath, { recursive: true, force: true });
    return Object.freeze({
      schemaVersion: CORE_SCHEMA_VERSION,
      host: desired.host,
      changedPaths: Object.freeze(entries.map((entry) => entry.path.relativePath)),
    });
  } catch {
    let rollbackFailed = false;
    for (const [relativePath, temporary] of staged) {
      try {
        const entry = entries.find((candidate) => candidate.path.relativePath === relativePath);
        if (entry === undefined) throw new Error("missing_staged_entry");
        assertParentIdentities(desired, entry, identities);
        removeFileIfPresent(temporary);
      } catch {
        rollbackFailed = true;
      }
    }

    if (transactionStarted) {
      for (const [index, entry] of entries.entries()) {
        if (!committed.has(entry.path.relativePath)) continue;
        try {
          if (options.failAtRollback === index) throw new Error("injected_rollback_failure");
          const current = readOptional(desired, entry, identities);
          const payload = payloads.get(entry.path.relativePath);
          const payloadMatches = payload === null
            ? current === undefined
            : payload !== undefined && current !== undefined && current.equals(payload);
          if (!payloadMatches) throw new Error("rollback_destination_changed");
          assertParentIdentities(desired, entry, identities);
          restorePath(desired, entry, identities, originals.get(entry.path.relativePath));
        } catch {
          rollbackFailed = true;
        }
      }
    }

    if (recovery !== undefined && fs.existsSync(recovery.absolutePath)) {
      const manifestPath = path.join(recovery.absolutePath, "manifest.json");
      if (!fs.existsSync(manifestPath)) rollbackFailed = true;
    }

    if (!rollbackFailed && !pruneCreatedDirectories(createdDirectories)) rollbackFailed = true;
    if (!rollbackFailed && recovery !== undefined) {
      try {
        fs.rmSync(recovery.absolutePath, { recursive: true, force: true });
      } catch {
        rollbackFailed = true;
      }
    }

    if (rollbackFailed && recovery !== undefined) {
      throw new InstallError("rollback_failed", recovery.relativePath);
    }
    throw new InstallError("transaction_failed");
  }
}
