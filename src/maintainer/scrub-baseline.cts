/** Private dirty-worktree baselines for explicitly scoped repository scrubs. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const util = require("node:util") as typeof import("node:util");

export interface ScrubHunkRange {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
}

export interface ScrubPathMetadata {
  readonly pathToken: string;
  readonly kind: "tracked" | "untracked";
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly stagedDigest: string | null;
  readonly unstagedDigest: string | null;
  readonly contentDigest: string | null;
  readonly stagedHunks: readonly ScrubHunkRange[];
  readonly unstagedHunks: readonly ScrubHunkRange[];
}

export interface ScrubBaselineResult {
  readonly schemaVersion: 1;
  readonly code: "baseline_captured" | "scrub_overlap_requires_checkpoint";
  readonly requiresCheckpoint: boolean;
  readonly baselineDigest: string;
  readonly explicitPathTokens: readonly string[];
  readonly paths: readonly ScrubPathMetadata[];
}

export interface ScrubVerificationResult {
  readonly schemaVersion: 1;
  readonly code: "scrub_baseline_preserved";
  readonly ok: true;
  readonly committedPathCount: number;
  readonly baselineDigest: string;
}

interface ScrubBaselineLimits {
  readonly maxStatusBytes: number;
  readonly maxDiffBytes: number;
  readonly maxUntrackedBytes: number;
  readonly maxPaths: number;
}

interface CaptureOptions {
  readonly root: string;
  readonly explicitPaths: readonly string[];
  readonly temporaryRoot?: string;
  readonly limits?: Partial<ScrubBaselineLimits>;
}

interface CaptureDependencies {
  readonly onPrivateDirectory?: (directory: string) => void;
}

interface StatusPath {
  readonly relativePath: string;
  readonly kind: "tracked" | "untracked";
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
}

interface InspectedPath {
  readonly exact: StatusPath;
  readonly public: ScrubPathMetadata;
}

interface RepositorySnapshot {
  readonly head: string;
  readonly paths: readonly InspectedPath[];
  readonly unrelatedStatusDigest: string;
  readonly unrelatedIndexDigest: string;
}

interface PrivateBaseline {
  readonly root: string;
  readonly explicitPaths: readonly string[];
  readonly explicitSet: ReadonlySet<string>;
  readonly limits: ScrubBaselineLimits;
  readonly snapshot: RepositorySnapshot;
  readonly privateDirectory: string;
}

const DEFAULT_LIMITS: ScrubBaselineLimits = Object.freeze({
  maxStatusBytes: 1024 * 1024,
  maxDiffBytes: 8 * 1024 * 1024,
  maxUntrackedBytes: 8 * 1024 * 1024,
  maxPaths: 4096,
});
const MAX_PATH_BYTES = 4096;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const HEAD_PATTERN = /^[0-9a-f]{40}$/u;
const privateBaselines = new WeakMap<ScrubBaselineResult, PrivateBaseline>();
const pendingPrivateDirectories = new Set<string>();
let exitCleanupRegistered = false;

export class ScrubBaselineError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ScrubBaselineError";
    this.code = code;
  }
}

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ScrubBaselineError(code);
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freezeHunks(values: readonly ScrubHunkRange[]): readonly ScrubHunkRange[] {
  return Object.freeze(values.map((value) => Object.freeze({ ...value })));
}

function limits(input: Partial<ScrubBaselineLimits> | undefined): ScrubBaselineLimits {
  const merged = {
    maxStatusBytes: input?.maxStatusBytes ?? DEFAULT_LIMITS.maxStatusBytes,
    maxDiffBytes: input?.maxDiffBytes ?? DEFAULT_LIMITS.maxDiffBytes,
    maxUntrackedBytes: input?.maxUntrackedBytes ?? DEFAULT_LIMITS.maxUntrackedBytes,
    maxPaths: input?.maxPaths ?? DEFAULT_LIMITS.maxPaths,
  };
  for (const value of Object.values(merged)) {
    failUnless(Number.isSafeInteger(value) && value > 0, "scrub_invalid_limits");
  }
  return Object.freeze(merged);
}

function validRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value
  ) return false;
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function decodeUtf8(bytes: Buffer, code: string): string {
  try {
    return new util.TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ScrubBaselineError(code);
  }
}

function inspectRoot(input: string): string {
  const root = path.resolve(input);
  let metadata: import("node:fs").Stats;
  try {
    metadata = fs.lstatSync(root);
  } catch {
    throw new ScrubBaselineError("scrub_root_unavailable");
  }
  failUnless(!metadata.isSymbolicLink(), "scrub_symlink_path");
  failUnless(metadata.isDirectory(), "scrub_root_unavailable");
  return root;
}

function inspectRelativePath(root: string, relativePath: string, allowAbsent: boolean): void {
  let current = root;
  const parts = relativePath.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let metadata: import("node:fs").Stats;
    try {
      metadata = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowAbsent) return;
      throw new ScrubBaselineError("scrub_path_unavailable");
    }
    failUnless(!metadata.isSymbolicLink(), "scrub_symlink_path");
    if (index < parts.length - 1) {
      failUnless(metadata.isDirectory(), "scrub_special_file");
    } else {
      failUnless(metadata.isFile(), "scrub_special_file");
    }
  }
}

function normalizeExplicitPaths(root: string, values: readonly string[]): readonly string[] {
  failUnless(Array.isArray(values) && values.length > 0, "scrub_invalid_path");
  failUnless(values.length <= DEFAULT_LIMITS.maxPaths, "scrub_too_many_paths");
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    failUnless(typeof value === "string" && validRelativePath(value), "scrub_invalid_path");
    failUnless(!seen.has(value), "scrub_duplicate_path");
    inspectRelativePath(root, value, true);
    seen.add(value);
    normalized.push(value);
  }
  return Object.freeze(normalized.sort(comparePaths));
}

function runGit(
  root: string,
  args: readonly string[],
  maximumBytes: number,
  sizeCode: string,
): Buffer {
  const result = childProcess.spawnSync("git", [...args], {
    cwd: root,
    input: Buffer.alloc(0),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: maximumBytes,
  });
  if (result.error !== undefined) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOBUFS") {
      throw new ScrubBaselineError(sizeCode);
    }
    throw new ScrubBaselineError("scrub_git_inspection_failed");
  }
  failUnless(result.status === 0, "scrub_git_inspection_failed");
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
  failUnless(stdout.length <= maximumBytes, sizeCode);
  return stdout;
}

function assertRepositoryRoot(root: string, maximumBytes: number): void {
  const output = runGit(root, ["rev-parse", "--show-toplevel"], maximumBytes, "scrub_status_too_large");
  const reported = decodeUtf8(output, "scrub_ambiguous_status").trim();
  failUnless(reported.length > 0, "scrub_git_inspection_failed");
  let actual: import("node:fs").BigIntStats;
  let expected: import("node:fs").BigIntStats;
  try {
    actual = fs.statSync(reported, { bigint: true });
    expected = fs.statSync(root, { bigint: true });
  } catch {
    throw new ScrubBaselineError("scrub_root_unavailable");
  }
  // Hosted Windows can spell one directory through distinct aliases; require
  // a nonzero filesystem object identity so ambiguous filesystems fail closed.
  failUnless(
    actual.dev === expected.dev && actual.ino !== 0n && actual.ino === expected.ino,
    "scrub_root_mismatch",
  );
}

function fieldEnd(value: string, spaces: number): number {
  let cursor = 0;
  for (let index = 0; index < spaces; index += 1) {
    cursor = value.indexOf(" ", cursor);
    if (cursor < 0) return -1;
    cursor += 1;
  }
  return cursor;
}

function addStatusPath(target: Map<string, StatusPath>, entry: StatusPath): void {
  const current = target.get(entry.relativePath);
  if (current === undefined) {
    target.set(entry.relativePath, entry);
    return;
  }
  failUnless(current.kind === entry.kind, "scrub_ambiguous_status");
  target.set(entry.relativePath, Object.freeze({
    relativePath: entry.relativePath,
    kind: entry.kind,
    staged: current.staged || entry.staged,
    unstaged: current.unstaged || entry.unstaged,
    untracked: current.untracked || entry.untracked,
  }));
}

function parseStatus(bytes: Buffer, maximumPaths: number): readonly StatusPath[] {
  const records = decodeUtf8(bytes, "scrub_ambiguous_status").split("\0");
  if (records.at(-1) === "") records.pop();
  const paths = new Map<string, StatusPath>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.startsWith("1 ")) {
      const pathOffset = fieldEnd(record, 8);
      failUnless(pathOffset > 0, "scrub_ambiguous_status");
      const fields = record.slice(0, pathOffset - 1).split(" ");
      const relativePath = record.slice(pathOffset);
      const xy = fields[1];
      failUnless(xy !== undefined && xy.length === 2 && validRelativePath(relativePath), "scrub_ambiguous_status");
      addStatusPath(paths, Object.freeze({
        relativePath,
        kind: "tracked",
        staged: xy[0] !== ".",
        unstaged: xy[1] !== ".",
        untracked: false,
      }));
    } else if (record.startsWith("2 ")) {
      const pathOffset = fieldEnd(record, 9);
      failUnless(pathOffset > 0, "scrub_ambiguous_status");
      const fields = record.slice(0, pathOffset - 1).split(" ");
      const relativePath = record.slice(pathOffset);
      const originalPath = records[index + 1];
      const xy = fields[1];
      failUnless(
        xy !== undefined && xy.length === 2 && validRelativePath(relativePath) &&
        originalPath !== undefined && validRelativePath(originalPath),
        "scrub_ambiguous_status",
      );
      index += 1;
      for (const changedPath of [relativePath, originalPath]) {
        addStatusPath(paths, Object.freeze({
          relativePath: changedPath,
          kind: "tracked",
          staged: xy[0] !== ".",
          unstaged: xy[1] !== ".",
          untracked: false,
        }));
      }
    } else if (record.startsWith("? ")) {
      const relativePath = record.slice(2);
      failUnless(validRelativePath(relativePath), "scrub_ambiguous_status");
      addStatusPath(paths, Object.freeze({
        relativePath,
        kind: "untracked",
        staged: false,
        unstaged: false,
        untracked: true,
      }));
    } else {
      throw new ScrubBaselineError("scrub_ambiguous_status");
    }
    failUnless(paths.size <= maximumPaths, "scrub_too_many_paths");
  }
  return Object.freeze([...paths.values()].sort((left, right) =>
    comparePaths(left.relativePath, right.relativePath)));
}

function hunkRanges(bytes: Buffer): readonly ScrubHunkRange[] {
  const text = bytes.toString("latin1");
  const ranges: ScrubHunkRange[] = [];
  const pattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gmu;
  for (const match of text.matchAll(pattern)) {
    ranges.push(Object.freeze({
      oldStart: Number(match[1]),
      oldCount: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newCount: match[4] === undefined ? 1 : Number(match[4]),
    }));
  }
  return freezeHunks(ranges);
}

function hasBinaryPatch(bytes: Buffer): boolean {
  const text = bytes.toString("latin1");
  return text.includes("GIT binary patch") || text.includes("Binary files ");
}

function diffForPath(
  root: string,
  relativePath: string,
  staged: boolean,
  maximumBytes: number,
): Buffer {
  const args = [
    "diff",
    ...(staged ? ["--cached"] : []),
    "--binary",
    "--no-color",
    "--no-ext-diff",
    "--full-index",
    "--unified=0",
    "--",
    relativePath,
  ];
  return runGit(root, args, maximumBytes, "scrub_diff_too_large");
}

function readBoundedFile(root: string, relativePath: string, maximumBytes: number): Buffer {
  inspectRelativePath(root, relativePath, false);
  const absolutePath = path.join(root, ...relativePath.split("/"));
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(descriptor);
    failUnless(before.isFile(), "scrub_special_file");
    failUnless(before.size <= maximumBytes, "scrub_untracked_too_large");
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    failUnless(
      before.dev === after.dev && before.ino === after.ino && before.mode === after.mode &&
      before.size === after.size,
      "scrub_filesystem_race",
    );
    failUnless(bytes.length <= maximumBytes, "scrub_untracked_too_large");
    return bytes;
  } catch (error) {
    if (error instanceof ScrubBaselineError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new ScrubBaselineError("scrub_symlink_path");
    }
    throw new ScrubBaselineError("scrub_path_unavailable");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function pathMetadata(
  root: string,
  status: StatusPath,
  currentLimits: ScrubBaselineLimits,
): InspectedPath {
  if (status.untracked) inspectRelativePath(root, status.relativePath, false);
  else inspectRelativePath(root, status.relativePath, true);
  const stagedBytes = status.staged
    ? diffForPath(root, status.relativePath, true, currentLimits.maxDiffBytes)
    : undefined;
  const unstagedBytes = status.unstaged
    ? diffForPath(root, status.relativePath, false, currentLimits.maxDiffBytes)
    : undefined;
  if (
    (stagedBytes !== undefined && hasBinaryPatch(stagedBytes)) ||
    (unstagedBytes !== undefined && hasBinaryPatch(unstagedBytes))
  ) throw new ScrubBaselineError("scrub_binary_diff_unsupported");
  const contentBytes = status.untracked
    ? readBoundedFile(root, status.relativePath, currentLimits.maxUntrackedBytes)
    : undefined;
  const publicValue: ScrubPathMetadata = Object.freeze({
    pathToken: sha256(status.relativePath),
    kind: status.kind,
    staged: status.staged,
    unstaged: status.unstaged,
    untracked: status.untracked,
    stagedDigest: stagedBytes === undefined ? null : sha256(stagedBytes),
    unstagedDigest: unstagedBytes === undefined ? null : sha256(unstagedBytes),
    contentDigest: contentBytes === undefined ? null : sha256(contentBytes),
    stagedHunks: stagedBytes === undefined ? Object.freeze([]) : hunkRanges(stagedBytes),
    unstagedHunks: unstagedBytes === undefined ? Object.freeze([]) : hunkRanges(unstagedBytes),
  });
  return Object.freeze({ exact: status, public: publicValue });
}

function canonicalStatus(paths: readonly InspectedPath[], explicit: ReadonlySet<string>): Buffer {
  const values = paths
    .filter((entry) => !explicit.has(entry.exact.relativePath))
    .map((entry) => JSON.stringify({
      relativePath: entry.exact.relativePath,
      kind: entry.exact.kind,
      staged: entry.exact.staged,
      unstaged: entry.exact.unstaged,
      untracked: entry.exact.untracked,
      stagedDigest: entry.public.stagedDigest,
      unstagedDigest: entry.public.unstagedDigest,
      contentDigest: entry.public.contentDigest,
      stagedHunks: entry.public.stagedHunks,
      unstagedHunks: entry.public.unstagedHunks,
    }));
  return Buffer.from(values.join("\0"), "utf8");
}

function indexDigest(
  root: string,
  explicit: ReadonlySet<string>,
  maximumBytes: number,
): string {
  const bytes = runGit(
    root,
    ["ls-files", "--stage", "-z"],
    maximumBytes,
    "scrub_status_too_large",
  );
  const records = decodeUtf8(bytes, "scrub_ambiguous_index").split("\0").filter(Boolean);
  const kept: string[] = [];
  for (const record of records) {
    const tab = record.indexOf("\t");
    failUnless(tab > 0, "scrub_ambiguous_index");
    const relativePath = record.slice(tab + 1);
    failUnless(validRelativePath(relativePath), "scrub_ambiguous_index");
    if (!explicit.has(relativePath)) kept.push(record);
  }
  return sha256(Buffer.from(kept.join("\0"), "utf8"));
}

function currentHead(root: string, maximumBytes: number): string {
  const head = decodeUtf8(
    runGit(root, ["rev-parse", "HEAD"], maximumBytes, "scrub_status_too_large"),
    "scrub_git_inspection_failed",
  ).trim();
  failUnless(HEAD_PATTERN.test(head), "scrub_git_inspection_failed");
  return head;
}

function inspectRepository(
  root: string,
  explicit: ReadonlySet<string>,
  currentLimits: ScrubBaselineLimits,
): RepositorySnapshot {
  const statusBytes = runGit(
    root,
    ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
    currentLimits.maxStatusBytes,
    "scrub_status_too_large",
  );
  const statusPaths = parseStatus(statusBytes, currentLimits.maxPaths);
  const inspected = Object.freeze(statusPaths.map((entry) =>
    pathMetadata(root, entry, currentLimits)));
  return Object.freeze({
    head: currentHead(root, currentLimits.maxStatusBytes),
    paths: inspected,
    unrelatedStatusDigest: sha256(canonicalStatus(inspected, explicit)),
    unrelatedIndexDigest: indexDigest(root, explicit, currentLimits.maxStatusBytes),
  });
}

function validateTemporaryRoot(input: string | undefined, repositoryRoot: string): string {
  const root = path.resolve(input ?? os.tmpdir());
  let metadata: import("node:fs").Stats;
  try {
    metadata = fs.lstatSync(root);
  } catch {
    throw new ScrubBaselineError("scrub_private_root_unavailable");
  }
  failUnless(!metadata.isSymbolicLink(), "scrub_symlink_path");
  failUnless(metadata.isDirectory(), "scrub_private_root_unavailable");
  let realTemporary: string;
  let realRepository: string;
  try {
    realTemporary = fs.realpathSync(root);
    realRepository = fs.realpathSync(repositoryRoot);
  } catch {
    throw new ScrubBaselineError("scrub_private_root_unavailable");
  }
  const relation = path.relative(realRepository, realTemporary);
  failUnless(
    relation.length > 0 && (relation.startsWith("..") || path.isAbsolute(relation)),
    "scrub_private_root_unsafe",
  );
  return root;
}

function removePrivateDirectory(directory: string): void {
  pendingPrivateDirectories.delete(directory);
  try {
    const metadata = fs.lstatSync(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return;
    for (const name of ["staged.diff", "unstaged.diff"]) {
      const candidate = path.join(directory, name);
      try {
        const file = fs.lstatSync(candidate);
        if (!file.isSymbolicLink() && file.isFile()) fs.unlinkSync(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
      }
    }
    fs.rmdirSync(directory);
  } catch {
    // Private cleanup is best effort and never authorizes broader recursive deletion.
  }
}

function registerPrivateDirectory(directory: string): void {
  pendingPrivateDirectories.add(directory);
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;
  process.once("exit", () => {
    for (const pending of [...pendingPrivateDirectories]) removePrivateDirectory(pending);
  });
}

function writePrivateDiffs(
  root: string,
  temporaryRoot: string,
  currentLimits: ScrubBaselineLimits,
): string {
  const staged = runGit(
    root,
    ["diff", "--cached", "--binary", "--no-color", "--no-ext-diff", "--full-index"],
    currentLimits.maxDiffBytes,
    "scrub_diff_too_large",
  );
  const unstaged = runGit(
    root,
    ["diff", "--binary", "--no-color", "--no-ext-diff", "--full-index"],
    currentLimits.maxDiffBytes,
    "scrub_diff_too_large",
  );
  if (hasBinaryPatch(staged) || hasBinaryPatch(unstaged)) {
    throw new ScrubBaselineError("scrub_binary_diff_unsupported");
  }
  let directory: string | undefined;
  try {
    directory = fs.mkdtempSync(path.join(temporaryRoot, "kcoderag-scrub-baseline-"));
    fs.chmodSync(directory, 0o700);
    fs.writeFileSync(path.join(directory, "staged.diff"), staged, { flag: "wx", mode: 0o600 });
    fs.writeFileSync(path.join(directory, "unstaged.diff"), unstaged, { flag: "wx", mode: 0o600 });
  } catch {
    if (directory !== undefined) removePrivateDirectory(directory);
    throw new ScrubBaselineError("scrub_private_write_failed");
  }
  registerPrivateDirectory(directory);
  return directory;
}

function publicResult(
  snapshot: RepositorySnapshot,
  explicitPaths: readonly string[],
): ScrubBaselineResult {
  const explicitPathTokens = Object.freeze(explicitPaths.map(sha256));
  const explicitTokens = new Set(explicitPathTokens);
  const publicPaths = Object.freeze(snapshot.paths.map((entry) => entry.public));
  const requiresCheckpoint = publicPaths.some((entry) => explicitTokens.has(entry.pathToken));
  const code = requiresCheckpoint
    ? "scrub_overlap_requires_checkpoint" as const
    : "baseline_captured" as const;
  const digestInput = Buffer.from(JSON.stringify({
    code,
    explicitPathTokens,
    paths: publicPaths,
    unrelatedStatusDigest: snapshot.unrelatedStatusDigest,
    unrelatedIndexDigest: snapshot.unrelatedIndexDigest,
  }), "utf8");
  return Object.freeze({
    schemaVersion: 1 as const,
    code,
    requiresCheckpoint,
    baselineDigest: sha256(digestInput),
    explicitPathTokens,
    paths: publicPaths,
  });
}

/** Capture all pre-existing dirty state before an explicitly scoped scrub begins. */
export function captureScrubBaseline(
  options: CaptureOptions,
  dependencies: CaptureDependencies = {},
): ScrubBaselineResult {
  const root = inspectRoot(options.root);
  const currentLimits = limits(options.limits);
  assertRepositoryRoot(root, currentLimits.maxStatusBytes);
  const explicitPaths = normalizeExplicitPaths(root, options.explicitPaths);
  failUnless(explicitPaths.length <= currentLimits.maxPaths, "scrub_too_many_paths");
  const explicitSet = new Set(explicitPaths);
  const snapshot = inspectRepository(root, explicitSet, currentLimits);
  const temporaryRoot = validateTemporaryRoot(options.temporaryRoot, root);
  const privateDirectory = writePrivateDiffs(root, temporaryRoot, currentLimits);
  try {
    dependencies.onPrivateDirectory?.(privateDirectory);
  } catch {
    removePrivateDirectory(privateDirectory);
    throw new ScrubBaselineError("scrub_private_callback_failed");
  }
  const result = publicResult(snapshot, explicitPaths);
  failUnless(SHA256_PATTERN.test(result.baselineDigest), "scrub_internal_error");
  privateBaselines.set(result, Object.freeze({
    root,
    explicitPaths,
    explicitSet,
    limits: currentLimits,
    snapshot,
    privateDirectory,
  }));
  return result;
}

function changedCommitPaths(
  root: string,
  before: string,
  after: string,
  maximumBytes: number,
): ReadonlySet<string> {
  const bytes = runGit(
    root,
    ["diff", "--name-status", "-z", `${before}..${after}`],
    maximumBytes,
    "scrub_status_too_large",
  );
  const records = decodeUtf8(bytes, "scrub_ambiguous_commit").split("\0");
  if (records.at(-1) === "") records.pop();
  const changed = new Set<string>();
  for (let index = 0; index < records.length;) {
    const status = records[index++];
    failUnless(status !== undefined && /^[ACDMRTUXB][0-9]*$/u.test(status), "scrub_ambiguous_commit");
    const first = records[index++];
    failUnless(first !== undefined && validRelativePath(first), "scrub_ambiguous_commit");
    changed.add(first);
    if (status.startsWith("R") || status.startsWith("C")) {
      const second = records[index++];
      failUnless(second !== undefined && validRelativePath(second), "scrub_ambiguous_commit");
      changed.add(second);
    }
  }
  return changed;
}

/** Prove that only the declared scrub paths changed and every pre-existing hunk remains exact. */
export function assertScrubBaselinePreserved(
  baseline: ScrubBaselineResult,
  options: { readonly requireCommitted?: boolean } = {},
): ScrubVerificationResult {
  const stored = privateBaselines.get(baseline);
  failUnless(stored !== undefined, "scrub_unknown_baseline");
  failUnless(!baseline.requiresCheckpoint, "scrub_checkpoint_required");
  const current = inspectRepository(stored.root, stored.explicitSet, stored.limits);
  const requireCommitted = options.requireCommitted ?? true;
  let committedPathCount = 0;
  if (requireCommitted) {
    failUnless(current.head !== stored.snapshot.head, "scrub_commit_missing");
    const changed = changedCommitPaths(
      stored.root,
      stored.snapshot.head,
      current.head,
      stored.limits.maxStatusBytes,
    );
    failUnless(changed.size > 0, "scrub_commit_missing");
    for (const changedPath of changed) {
      failUnless(stored.explicitSet.has(changedPath), "scrub_unexpected_commit_path");
    }
    for (const expected of stored.explicitPaths) {
      failUnless(changed.has(expected), "scrub_explicit_path_not_committed");
    }
    committedPathCount = changed.size;
  } else {
    failUnless(current.head === stored.snapshot.head, "scrub_head_changed_before_commit");
  }
  failUnless(
    current.unrelatedStatusDigest === stored.snapshot.unrelatedStatusDigest,
    "scrub_unrelated_status_changed",
  );
  failUnless(
    current.unrelatedIndexDigest === stored.snapshot.unrelatedIndexDigest,
    "scrub_unrelated_index_changed",
  );
  if (requireCommitted) {
    failUnless(
      !current.paths.some((entry) => stored.explicitSet.has(entry.exact.relativePath)),
      "scrub_explicit_path_dirty",
    );
    removePrivateDirectory(stored.privateDirectory);
    privateBaselines.delete(baseline);
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    code: "scrub_baseline_preserved" as const,
    ok: true as const,
    committedPathCount,
    baselineDigest: baseline.baselineDigest,
  });
}
