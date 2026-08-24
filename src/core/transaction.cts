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
  /** Test seam fired after the last identity check and immediately before a pathname operation. */
  readonly onBeforePathOperation?: (operation: string, relativePath: string) => void;
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

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly size: number;
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

function fileIdentity(metadata: import("node:fs").Stats): FileIdentity {
  return { dev: metadata.dev, ino: metadata.ino, mode: metadata.mode, size: metadata.size };
}

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.size === right.size;
}

function inspectFile(filePath: string, safePath: string): FileIdentity | null {
  try {
    const metadata = fs.lstatSync(filePath);
    if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape", safePath);
    if (!metadata.isFile()) throw new InstallError("special_file", safePath);
    return fileIdentity(metadata);
  } catch (error) {
    if (error instanceof InstallError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new InstallError("unreadable", safePath);
  }
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
  options: TransactionOptions,
): Buffer | undefined {
  assertParentIdentities(desired, entry, identities);
  options.onBeforePathOperation?.("read", entry.path.relativePath);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(entry.path.absolutePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) throw new InstallError("special_file", entry.path.relativePath);
    const openedIdentity = fileIdentity(opened);
    assertParentIdentities(desired, entry, identities);
    const namedIdentity = inspectFile(entry.path.absolutePath, entry.path.relativePath);
    if (namedIdentity === null || !sameFile(openedIdentity, namedIdentity)) {
      throw new InstallError("filesystem_race", entry.path.relativePath);
    }
    const bytes = fs.readFileSync(descriptor);
    assertParentIdentities(desired, entry, identities);
    const finalIdentity = inspectFile(entry.path.absolutePath, entry.path.relativePath);
    if (finalIdentity === null || !sameFile(openedIdentity, finalIdentity)) {
      throw new InstallError("filesystem_race", entry.path.relativePath);
    }
    return bytes;
  } catch (error) {
    if (error instanceof InstallError) throw error;
    try {
      assertParentIdentities(desired, entry, identities);
    } catch (identityError) {
      throw identityError;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new InstallError("symlink_escape", entry.path.relativePath);
    }
    throw new InstallError("unreadable", entry.path.relativePath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
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
  desired: DesiredState,
  entry: DesiredEntry,
  identities: DirectoryIdentities,
  options: TransactionOptions,
  bytes: Buffer,
  onCreated?: (temporary: string) => void,
): string {
  const destination = entry.path.absolutePath;
  const temporary = path.join(path.dirname(destination), `.kcoderag-stage-${crypto.randomUUID()}`);
  let descriptor: number | undefined;
  let createdIdentity: FileIdentity | undefined;
  try {
    assertParentIdentities(desired, entry, identities);
    options.onBeforePathOperation?.("stage", entry.path.relativePath);
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    onCreated?.(temporary);
    createdIdentity = fileIdentity(fs.fstatSync(descriptor));
    assertParentIdentities(desired, entry, identities);
    const namedIdentity = inspectFile(temporary, entry.path.relativePath);
    if (namedIdentity === null || !sameFile(createdIdentity, namedIdentity)) {
      throw new InstallError("filesystem_race", entry.path.relativePath);
    }
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const writtenIdentity = fileIdentity(fs.fstatSync(descriptor));
    assertParentIdentities(desired, entry, identities);
    const finalIdentity = inspectFile(temporary, entry.path.relativePath);
    if (finalIdentity === null || !sameFile(writtenIdentity, finalIdentity)) {
      throw new InstallError("filesystem_race", entry.path.relativePath);
    }
    fs.closeSync(descriptor);
    descriptor = undefined;
    return temporary;
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* Best-effort close before identity-bound cleanup. */ }
      descriptor = undefined;
    }
    try {
      const current = inspectFile(temporary, entry.path.relativePath);
      if (current !== null && createdIdentity !== undefined && sameFile(current, createdIdentity)) {
        fs.unlinkSync(temporary);
      }
    } catch {
      // The outer transaction will report cleanup failure if a tracked file remains.
    }
    throw error;
  }
}

function quarantineExisting(
  desired: DesiredState,
  entry: DesiredEntry,
  identities: DirectoryIdentities,
  options: TransactionOptions,
): string {
  const destination = entry.path.absolutePath;
  const originalIdentity = inspectFile(destination, entry.path.relativePath);
  if (originalIdentity === null) throw new InstallError("filesystem_race", entry.path.relativePath);
  const quarantine = path.join(path.dirname(destination), `.kcoderag-quarantine-${crypto.randomUUID()}`);
  assertParentIdentities(desired, entry, identities);
  options.onBeforePathOperation?.("quarantine", entry.path.relativePath);
  let moved = false;
  try {
    fs.renameSync(destination, quarantine);
    moved = true;
    assertParentIdentities(desired, entry, identities);
    const movedIdentity = inspectFile(quarantine, entry.path.relativePath);
    if (movedIdentity === null || !sameFile(originalIdentity, movedIdentity)) {
      throw new InstallError("filesystem_race", entry.path.relativePath);
    }
    return quarantine;
  } catch (error) {
    if (moved) {
      try {
        const movedIdentity = inspectFile(quarantine, entry.path.relativePath);
        const destinationIdentity = inspectFile(destination, entry.path.relativePath);
        // The random quarantine name did not exist before rename. Even when the parent was swapped,
        // moving that exact object back preserves replacement data without reading its bytes.
        if (movedIdentity !== null && destinationIdentity === null) {
          fs.renameSync(quarantine, destination);
        }
      } catch {
        // The private recovery journal remains authoritative when the exact object cannot be restored.
      }
    }
    throw error;
  }
}

function commitStaged(
  desired: DesiredState,
  entry: DesiredEntry,
  identities: DirectoryIdentities,
  options: TransactionOptions,
  temporary: string,
): void {
  const stagedIdentity = inspectFile(temporary, entry.path.relativePath);
  if (stagedIdentity === null) throw new InstallError("filesystem_race", entry.path.relativePath);
  assertParentIdentities(desired, entry, identities);
  options.onBeforePathOperation?.("commit", entry.path.relativePath);
  fs.renameSync(temporary, entry.path.absolutePath);
  assertParentIdentities(desired, entry, identities);
  const destinationIdentity = inspectFile(entry.path.absolutePath, entry.path.relativePath);
  if (destinationIdentity === null || !sameFile(stagedIdentity, destinationIdentity)) {
    throw new InstallError("filesystem_race", entry.path.relativePath);
  }
}

function assertExactDirectory(
  desired: DesiredState,
  directory: string,
  expected: DirectoryIdentity,
  safePath: string,
): void {
  const current = inspectDirectory(desired, directory, safePath);
  if (current === null || !sameDirectory(expected, current)) {
    throw new InstallError("filesystem_race", safePath);
  }
}

function writeSecureFile(
  destination: string,
  bytes: Buffer,
  desired: DesiredState,
  guardEntry: DesiredEntry,
  identities: DirectoryIdentities,
  directoryPath: string,
  directoryIdentity: DirectoryIdentity,
  options: TransactionOptions,
): void {
  let descriptor: number | undefined;
  let createdIdentity: FileIdentity | undefined;
  try {
    assertParentIdentities(desired, guardEntry, identities);
    assertExactDirectory(desired, directoryPath, directoryIdentity, guardEntry.path.relativePath);
    options.onBeforePathOperation?.("recovery-write", guardEntry.path.relativePath);
    descriptor = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    createdIdentity = fileIdentity(fs.fstatSync(descriptor));
    assertParentIdentities(desired, guardEntry, identities);
    assertExactDirectory(desired, directoryPath, directoryIdentity, guardEntry.path.relativePath);
    const namedIdentity = inspectFile(destination, guardEntry.path.relativePath);
    if (namedIdentity === null || !sameFile(createdIdentity, namedIdentity)) {
      throw new InstallError("filesystem_race", guardEntry.path.relativePath);
    }
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* Best-effort close before exact cleanup. */ }
    }
    try {
      const current = inspectFile(destination, guardEntry.path.relativePath);
      if (current !== null && createdIdentity !== undefined && sameFile(current, createdIdentity)) {
        fs.unlinkSync(destination);
      }
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
  identities: DirectoryIdentities,
  options: TransactionOptions,
): DirectoryIdentity {
  const guardEntry = entries.find((entry) => entry.path.relativePath === desired.statePath.relativePath) ?? entries[0];
  if (guardEntry === undefined) throw new InstallError("invalid_desired_state");
  let recoveryIdentity: DirectoryIdentity | undefined;
  try {
    assertParentIdentities(desired, guardEntry, identities);
    options.onBeforePathOperation?.("recovery-create", recovery.relativePath);
    fs.mkdirSync(recovery.absolutePath, { mode: 0o700 });
    assertParentIdentities(desired, guardEntry, identities);
    recoveryIdentity = inspectDirectory(desired, recovery.absolutePath, recovery.relativePath) ?? undefined;
    if (recoveryIdentity === undefined) throw new InstallError("filesystem_race", recovery.relativePath);
    const filesDirectory = path.join(recovery.absolutePath, "files");
    assertExactDirectory(desired, recovery.absolutePath, recoveryIdentity, recovery.relativePath);
    fs.mkdirSync(filesDirectory, { mode: 0o700 });
    assertParentIdentities(desired, guardEntry, identities);
    assertExactDirectory(desired, recovery.absolutePath, recoveryIdentity, recovery.relativePath);
    const filesIdentity = inspectDirectory(desired, filesDirectory, recovery.relativePath);
    if (filesIdentity === null) throw new InstallError("filesystem_race", recovery.relativePath);

    const manifestEntries: RecoveryManifestEntry[] = [];
    for (const [index, entry] of entries.entries()) {
      const original = originals.get(entry.path.relativePath);
      if (original === undefined) {
        manifestEntries.push({ relativePath: entry.path.relativePath, kind: "absent" });
        continue;
      }
      const backup = `files/${index.toString().padStart(4, "0")}.bin`;
      writeSecureFile(
        path.join(recovery.absolutePath, ...backup.split("/")),
        original,
        desired,
        guardEntry,
        identities,
        filesDirectory,
        filesIdentity,
        options,
      );
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
    writeSecureFile(
      path.join(recovery.absolutePath, "manifest.json"),
      manifest,
      desired,
      guardEntry,
      identities,
      recovery.absolutePath,
      recoveryIdentity,
      options,
    );
    return recoveryIdentity;
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
  options: TransactionOptions,
  original: Buffer | undefined,
  discarded: string[],
): void {
  assertParentIdentities(desired, entry, identities);
  const destination = entry.path.absolutePath;
  const current = inspectFile(destination, entry.path.relativePath);
  if (current !== null) discarded.push(quarantineExisting(desired, entry, identities, options));
  if (original === undefined) {
    return;
  }
  const temporary = writeTemporary(desired, entry, identities, options, original);
  try {
    commitStaged(desired, entry, identities, options, temporary);
  } catch (error) {
    try {
      removeFileIfPresent(temporary);
    } catch {
      // The caller records rollback failure and retains the recovery directory.
    }
    throw error;
  }
}

function removeRecovery(
  recovery: RecoveryLocation,
  desired: DesiredState,
  guardEntry: DesiredEntry,
  identities: DirectoryIdentities,
  recoveryIdentity: DirectoryIdentity,
  options: TransactionOptions,
): void {
  assertParentIdentities(desired, guardEntry, identities);
  assertExactDirectory(desired, recovery.absolutePath, recoveryIdentity, recovery.relativePath);
  options.onBeforePathOperation?.("recovery-cleanup", recovery.relativePath);
  assertParentIdentities(desired, guardEntry, identities);
  assertExactDirectory(desired, recovery.absolutePath, recoveryIdentity, recovery.relativePath);
  fs.rmSync(recovery.absolutePath, { recursive: true });
  assertParentIdentities(desired, guardEntry, identities);
}

function removePrivateFile(
  desired: DesiredState,
  entry: DesiredEntry,
  identities: DirectoryIdentities,
  options: TransactionOptions,
  filePath: string,
): void {
  const expected = inspectFile(filePath, entry.path.relativePath);
  if (expected === null) return;
  assertParentIdentities(desired, entry, identities);
  options.onBeforePathOperation?.("cleanup", entry.path.relativePath);
  assertParentIdentities(desired, entry, identities);
  const current = inspectFile(filePath, entry.path.relativePath);
  if (current === null || !sameFile(expected, current)) {
    throw new InstallError("filesystem_race", entry.path.relativePath);
  }
  fs.unlinkSync(filePath);
  assertParentIdentities(desired, entry, identities);
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
    const current = readOptional(desired, entry, identities, options);
    verifyExpected(entry, current);
    originals.set(entry.path.relativePath, current === undefined ? undefined : Buffer.from(current));
    payloads.set(entry.path.relativePath, entry.content === null ? null : Buffer.from(entry.content));
  }

  const createdDirectories: string[] = [];
  const staged = new Map<string, string>();
  const quarantined = new Map<string, string>();
  const discarded: string[] = [];
  const committed = new Set<string>();
  let recovery: RecoveryLocation | undefined;
  let recoveryIdentity: DirectoryIdentity | undefined;
  let transactionStarted = false;

  try {
    for (const [index, entry] of entries.entries()) {
      if (options.failAtStage === index) throw new Error("injected_stage_failure");
      const payload = payloads.get(entry.path.relativePath);
      if (payload !== null && payload !== undefined) {
        ensureParentDirectories(desired, entry, createdDirectories, identities);
        assertParentIdentities(desired, entry, identities);
        writeTemporary(desired, entry, identities, options, payload, (temporary) => {
          staged.set(entry.path.relativePath, temporary);
        });
      }
    }

    recovery = allocateRecovery(desired);
    recoveryIdentity = createRecovery(recovery, desired, entries, originals, identities, options);
    transactionStarted = true;
    for (const [index, entry] of entries.entries()) {
      if (options.failAtCommit === index) throw new Error("injected_commit_failure");
      const payload = payloads.get(entry.path.relativePath);
      const current = readOptional(desired, entry, identities, options);
      verifyExpected(entry, current);
      if (current !== undefined) {
        quarantined.set(entry.path.relativePath, quarantineExisting(desired, entry, identities, options));
      }
      if (payload !== null) {
        const temporary = staged.get(entry.path.relativePath);
        if (temporary === undefined) throw new Error("missing_staged_file");
        commitStaged(desired, entry, identities, options, temporary);
        staged.delete(entry.path.relativePath);
      }
      committed.add(entry.path.relativePath);
      options.onCommit?.(entry.path.relativePath);
    }
    for (const [relativePath, quarantine] of quarantined) {
      const entry = entries.find((candidate) => candidate.path.relativePath === relativePath);
      if (entry === undefined) throw new Error("missing_quarantined_entry");
      removePrivateFile(desired, entry, identities, options, quarantine);
    }
    quarantined.clear();
    const recoveryGuard = entries.find((entry) => entry.path.relativePath === desired.statePath.relativePath) ?? entries[0];
    if (recoveryGuard === undefined || recoveryIdentity === undefined) throw new Error("missing_recovery_identity");
    removeRecovery(recovery, desired, recoveryGuard, identities, recoveryIdentity, options);
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
        const originalQuarantine = quarantined.get(entry.path.relativePath);
        if (!committed.has(entry.path.relativePath) && originalQuarantine === undefined) continue;
        try {
          if (options.failAtRollback === index) throw new Error("injected_rollback_failure");
          const current = readOptional(desired, entry, identities, options);
          if (current === undefined && originalQuarantine !== undefined) {
            commitStaged(desired, entry, identities, options, originalQuarantine);
            quarantined.delete(entry.path.relativePath);
            continue;
          }
          const payload = payloads.get(entry.path.relativePath);
          const payloadMatches = payload === null
            ? current === undefined
            : payload !== undefined && current !== undefined && current.equals(payload);
          if (!payloadMatches) throw new Error("rollback_destination_changed");
          assertParentIdentities(desired, entry, identities);
          restorePath(desired, entry, identities, options, originals.get(entry.path.relativePath), discarded);
        } catch {
          rollbackFailed = true;
        }
      }
    }

    for (const [relativePath, quarantine] of quarantined) {
      try {
        const entry = entries.find((candidate) => candidate.path.relativePath === relativePath);
        if (entry === undefined) throw new Error("missing_quarantined_entry");
        removePrivateFile(desired, entry, identities, options, quarantine);
      } catch {
        rollbackFailed = true;
      }
    }
    for (const filePath of discarded) {
      try {
        const entry = entries.find((candidate) => path.dirname(candidate.path.absolutePath) === path.dirname(filePath));
        if (entry === undefined) throw new Error("missing_discarded_entry");
        removePrivateFile(desired, entry, identities, options, filePath);
      } catch {
        rollbackFailed = true;
      }
    }

    if (recovery !== undefined && recoveryIdentity !== undefined) {
      try {
        assertExactDirectory(desired, recovery.absolutePath, recoveryIdentity, recovery.relativePath);
        if (inspectFile(path.join(recovery.absolutePath, "manifest.json"), recovery.relativePath) === null) {
          rollbackFailed = true;
        }
      } catch {
        rollbackFailed = true;
      }
    }

    if (!rollbackFailed && recovery !== undefined && recoveryIdentity !== undefined) {
      try {
        const recoveryGuard = entries.find((entry) => entry.path.relativePath === desired.statePath.relativePath) ?? entries[0];
        if (recoveryGuard === undefined) throw new Error("missing_recovery_guard");
        removeRecovery(recovery, desired, recoveryGuard, identities, recoveryIdentity, options);
      } catch {
        rollbackFailed = true;
      }
    }
    if (!rollbackFailed && !pruneCreatedDirectories(createdDirectories)) rollbackFailed = true;

    if (rollbackFailed && recovery !== undefined) {
      throw new InstallError("rollback_failed", recovery.relativePath);
    }
    throw new InstallError("transaction_failed");
  }
}
