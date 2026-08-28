#!/usr/bin/env node
/** Own the single bounded package artifact consumed by local release-readiness gates. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const brandAudit = require("./brand-audit.cjs") as typeof import("./brand-audit.cjs");
const tarArchive = require("./tar-archive.cjs") as typeof import("./tar-archive.cjs");

type JsonMap = Record<string, unknown>;

export type CandidatePackageConsumer =
  | "pack-audit"
  | "tar-scan"
  | "host-smoke"
  | "workflow-upload";

export interface CandidatePackageArtifact {
  readonly name: "kcoderag-nav";
  readonly version: string;
  readonly sha256: string;
  readonly memberCount: number;
  readonly dryRunCount: 1;
  readonly actualPackCount: 1;
}

export interface CreateCandidatePackageArtifactOptions {
  readonly root: string;
  readonly consumers?: readonly CandidatePackageConsumer[];
}

interface CandidatePackageArtifactDependencies {
  readonly runNpm?: (root: string, args: readonly string[]) => Buffer;
}

interface CandidateTarScanDependencies {
  readonly scanTarball?: typeof brandAudit.scanTarball;
  readonly observeCandidateBytes?: (bytes: Buffer) => void;
}

interface PackManifest {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly paths: readonly string[];
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
}

const PACKAGE_NAME = "kcoderag-nav" as const;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const MAX_NPM_OUTPUT_BYTES = 16 * 1024 * 1024;
const ALL_CONSUMERS: readonly CandidatePackageConsumer[] = Object.freeze([
  "pack-audit",
  "tar-scan",
  "host-smoke",
  "workflow-upload",
]);

export class CandidatePackageArtifactError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CandidatePackageArtifactError";
    this.code = code;
  }
}

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new CandidatePackageArtifactError(code);
}

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePackPath(value: unknown): string {
  failUnless(typeof value === "string", "pack_manifest_invalid");
  failUnless(
    value.length > 0
      && !value.includes("\\")
      && !value.includes("\0")
      && !path.posix.isAbsolute(value)
      && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
      && path.posix.normalize(value) === value,
    "pack_manifest_invalid",
  );
  return value;
}

function parsePackManifest(stdout: Buffer): PackManifest {
  failUnless(Buffer.isBuffer(stdout) && stdout.length > 0 && stdout.length <= MAX_NPM_OUTPUT_BYTES,
    "pack_manifest_invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.toString("utf8"));
  } catch {
    throw new CandidatePackageArtifactError("pack_manifest_invalid");
  }
  failUnless(Array.isArray(parsed) && parsed.length === 1 && isRecord(parsed[0]), "pack_manifest_invalid");
  const record = parsed[0];
  failUnless(
    typeof record.name === "string"
      && typeof record.version === "string"
      && typeof record.filename === "string"
      && Array.isArray(record.files)
      && record.files.length > 0,
    "pack_manifest_invalid",
  );
  const paths = record.files.map((entry) => {
    failUnless(isRecord(entry), "pack_manifest_invalid");
    return normalizePackPath(entry.path);
  }).sort(compare);
  failUnless(new Set(paths).size === paths.length, "pack_manifest_invalid");
  return Object.freeze({
    name: record.name,
    version: record.version,
    filename: record.filename,
    paths: Object.freeze(paths),
  });
}

function assertManifestIdentity(manifest: PackManifest, version: string): void {
  failUnless(
    manifest.name === PACKAGE_NAME && manifest.version === version && SEMVER_RE.test(version),
    "package_identity_invalid",
  );
}

function assertPredictedPaths(paths: readonly string[]): void {
  for (const relativePath of paths) {
    const result = brandAudit.scanBrandText(relativePath, {
      scope: "tar_path",
      exactPath: relativePath,
    });
    failUnless(result.findingCount === 0, "brand_family_detected");
  }
}

function npmInvocation(): { readonly executable: string; readonly prefix: readonly string[] } {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const cli = candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  return cli === undefined
    ? Object.freeze({ executable: process.platform === "win32" ? "npm.cmd" : "npm", prefix: Object.freeze([]) })
    : Object.freeze({ executable: process.execPath, prefix: Object.freeze([cli]) });
}

function runNpm(root: string, args: readonly string[]): Buffer {
  const invocation = npmInvocation();
  const result = childProcess.spawnSync(invocation.executable, [...invocation.prefix, ...args], {
    cwd: root,
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 120_000,
    maxBuffer: MAX_NPM_OUTPUT_BYTES,
  });
  failUnless(result.status === 0, "npm_pack_failed");
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
  failUnless(stdout.length <= MAX_NPM_OUTPUT_BYTES, "pack_manifest_invalid");
  return stdout;
}

function packageVersion(root: string): string {
  let value: unknown;
  try {
    const bytes = fs.readFileSync(path.join(root, "package.json"));
    failUnless(bytes.length > 0 && bytes.length <= 1024 * 1024, "package_identity_invalid");
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (error instanceof CandidatePackageArtifactError) throw error;
    throw new CandidatePackageArtifactError("package_identity_invalid");
  }
  failUnless(isRecord(value) && value.name === PACKAGE_NAME && typeof value.version === "string"
    && SEMVER_RE.test(value.version), "package_identity_invalid");
  return value.version;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function fileIdentity(stats: import("node:fs").Stats): FileIdentity {
  return Object.freeze({ dev: stats.dev, ino: stats.ino, size: stats.size });
}

function sameFileIdentity(left: FileIdentity, right: import("node:fs").Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function normalizeConsumers(value: readonly CandidatePackageConsumer[] | undefined): ReadonlySet<CandidatePackageConsumer> {
  const selected = value ?? ALL_CONSUMERS;
  failUnless(selected.length > 0, "invalid_candidate_consumers");
  const consumers = new Set<CandidatePackageConsumer>();
  for (const consumer of selected) {
    failUnless(ALL_CONSUMERS.includes(consumer), "invalid_candidate_consumers");
    failUnless(!consumers.has(consumer), "invalid_candidate_consumers");
    consumers.add(consumer);
  }
  return consumers;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === "object" && value !== null || typeof value === "function")
    && typeof (value as { readonly then?: unknown }).then === "function";
}

export class CandidatePackageArtifactLease {
  readonly #artifact: CandidatePackageArtifact;
  readonly #canonicalTgzPath: string;
  readonly #temporaryRoot: string;
  readonly #handle: number;
  readonly #fileIdentity: FileIdentity;
  readonly #bytes: Buffer;
  readonly #requiredConsumers: ReadonlySet<CandidatePackageConsumer>;
  readonly #consumed = new Set<CandidatePackageConsumer>();
  #activeConsumer: CandidatePackageConsumer | undefined;
  #disposed = false;

  constructor(input: {
    readonly artifact: CandidatePackageArtifact;
    readonly canonicalTgzPath: string;
    readonly temporaryRoot: string;
    readonly handle: number;
    readonly fileIdentity: FileIdentity;
    readonly bytes: Buffer;
    readonly consumers: ReadonlySet<CandidatePackageConsumer>;
  }) {
    this.#artifact = input.artifact;
    this.#canonicalTgzPath = input.canonicalTgzPath;
    this.#temporaryRoot = input.temporaryRoot;
    this.#handle = input.handle;
    this.#fileIdentity = input.fileIdentity;
    this.#bytes = input.bytes;
    this.#requiredConsumers = input.consumers;
  }

  get artifact(): CandidatePackageArtifact {
    return this.#artifact;
  }

  toJSON(): CandidatePackageArtifact {
    return this.#artifact;
  }

  #assertIntegrity(): void {
    failUnless(!this.#disposed, "artifact_disposed");
    failUnless(SHA256_RE.test(this.#artifact.sha256) && sha256(this.#bytes) === this.#artifact.sha256,
      "artifact_integrity_failed");
    try {
      const byHandle = fs.fstatSync(this.#handle);
      const byPath = fs.lstatSync(this.#canonicalTgzPath);
      const realPath = fs.realpathSync(this.#canonicalTgzPath);
      failUnless(
        byHandle.isFile()
          && byPath.isFile()
          && !byPath.isSymbolicLink()
          && realPath === this.#canonicalTgzPath
          && sameFileIdentity(this.#fileIdentity, byHandle)
          && sameFileIdentity(this.#fileIdentity, byPath)
          && sha256(fs.readFileSync(this.#canonicalTgzPath)) === this.#artifact.sha256,
        "artifact_integrity_failed",
      );
    } catch (error) {
      if (error instanceof CandidatePackageArtifactError) throw error;
      throw new CandidatePackageArtifactError("artifact_integrity_failed");
    }
  }

  #completeConsumer(consumer: CandidatePackageConsumer): void {
    this.#assertIntegrity();
    this.#consumed.add(consumer);
    this.#activeConsumer = undefined;
    if (this.#consumed.size === this.#requiredConsumers.size) this.dispose();
  }

  consume<T>(consumer: CandidatePackageConsumer, callback: (bytes: Buffer, artifact: CandidatePackageArtifact) => T): T {
    this.#assertIntegrity();
    failUnless(this.#requiredConsumers.has(consumer), "artifact_consumer_out_of_scope");
    failUnless(!this.#consumed.has(consumer) && this.#activeConsumer === undefined, "artifact_consumer_reused");
    failUnless(typeof callback === "function", "artifact_consumer_invalid");
    this.#activeConsumer = consumer;
    let result: T;
    try {
      result = callback(this.#bytes, this.#artifact);
    } catch (error) {
      try {
        this.#completeConsumer(consumer);
      } catch (integrityError) {
        this.#activeConsumer = undefined;
        this.dispose();
        throw integrityError;
      }
      throw error;
    }
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(
        (value) => {
          this.#completeConsumer(consumer);
          return value;
        },
        (error: unknown) => {
          try {
            this.#completeConsumer(consumer);
          } catch (integrityError) {
            this.#activeConsumer = undefined;
            this.dispose();
            throw integrityError;
          }
          throw error;
        },
      ) as T;
    }
    try {
      this.#completeConsumer(consumer);
      return result;
    } catch (error) {
      this.#activeConsumer = undefined;
      this.dispose();
      throw error;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#activeConsumer = undefined;
    let failed = false;
    try {
      fs.closeSync(this.#handle);
    } catch {
      failed = true;
    }
    try {
      fs.rmSync(this.#temporaryRoot, { recursive: true, force: true });
    } catch {
      failed = true;
    }
    if (failed) throw new CandidatePackageArtifactError("artifact_cleanup_failed");
  }
}

/** Perform one manifest prediction and one actual pack, then lease the exact resulting bytes. */
export function createCandidatePackageArtifact(
  options: CreateCandidatePackageArtifactOptions,
  dependencies: CandidatePackageArtifactDependencies = {},
): CandidatePackageArtifactLease {
  const root = path.resolve(options.root);
  const consumers = normalizeConsumers(options.consumers);
  let metadata: import("node:fs").Stats;
  try {
    metadata = fs.lstatSync(root);
  } catch {
    throw new CandidatePackageArtifactError("candidate_root_invalid");
  }
  failUnless(metadata.isDirectory() && !metadata.isSymbolicLink(), "candidate_root_invalid");
  const version = packageVersion(root);
  const run = dependencies.runNpm ?? runNpm;
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-candidate-package-"));
  let handle: number | undefined;
  try {
    const dryRun = parsePackManifest(run(root, [
      "pack",
      root,
      "--dry-run",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      temporaryRoot,
    ]));
    assertManifestIdentity(dryRun, version);
    assertPredictedPaths(dryRun.paths);

    const actual = parsePackManifest(run(root, [
      "pack",
      root,
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      temporaryRoot,
    ]));
    assertManifestIdentity(actual, version);
    assertPredictedPaths(actual.paths);
    failUnless(
      actual.paths.length === dryRun.paths.length
        && actual.paths.every((relativePath, index) => relativePath === dryRun.paths[index]),
      "pack_manifest_drift",
    );
    failUnless(
      actual.filename === path.basename(actual.filename)
        && !actual.filename.includes("\\")
        && actual.filename.toLowerCase().endsWith(".tgz"),
      "pack_filename_invalid",
    );
    const candidatePath = path.join(temporaryRoot, actual.filename);
    const realTemporaryRoot = fs.realpathSync(temporaryRoot);
    const candidateMetadata = fs.lstatSync(candidatePath);
    const canonicalTgzPath = fs.realpathSync(candidatePath);
    failUnless(
      candidateMetadata.isFile()
        && !candidateMetadata.isSymbolicLink()
        && isPathInside(realTemporaryRoot, canonicalTgzPath),
      "pack_filename_invalid",
    );
    const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    handle = fs.openSync(canonicalTgzPath, fs.constants.O_RDONLY | noFollow);
    const openMetadata = fs.fstatSync(handle);
    failUnless(openMetadata.isFile() && sameFileIdentity(fileIdentity(candidateMetadata), openMetadata),
      "pack_filename_invalid");
    const bytes = fs.readFileSync(handle);
    failUnless(bytes.length > 0 && bytes.length <= tarArchive.DEFAULT_TAR_ARCHIVE_LIMITS.maxArchiveBytes,
      "candidate_archive_invalid");
    const entries = tarArchive.readTarArchive(bytes);
    const artifact = Object.freeze({
      name: PACKAGE_NAME,
      version,
      sha256: sha256(bytes),
      memberCount: entries.length,
      dryRunCount: 1 as const,
      actualPackCount: 1 as const,
    });
    const lease = new CandidatePackageArtifactLease({
      artifact,
      canonicalTgzPath,
      temporaryRoot: realTemporaryRoot,
      handle,
      fileIdentity: fileIdentity(openMetadata),
      bytes,
      consumers,
    });
    handle = undefined;
    return lease;
  } catch (error) {
    if (handle !== undefined) {
      try { fs.closeSync(handle); } catch { /* original safe code wins */ }
    }
    try { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } catch { /* original safe code wins */ }
    if (error instanceof CandidatePackageArtifactError) throw error;
    if (error instanceof tarArchive.TarArchiveError) {
      throw new CandidatePackageArtifactError("candidate_archive_invalid");
    }
    throw new CandidatePackageArtifactError("candidate_artifact_failed");
  }
}

/** Give one declared consumer the process-local snapshot without exposing its path or handle. */
export function withCandidatePackageBytes<T>(
  lease: CandidatePackageArtifactLease,
  consumer: CandidatePackageConsumer,
  callback: (bytes: Buffer, artifact: CandidatePackageArtifact) => T,
): T {
  failUnless(lease instanceof CandidatePackageArtifactLease, "artifact_lease_invalid");
  return lease.consume(consumer, callback);
}

/** Scan paths and bodies from the leased snapshot and bind the result to its public metadata. */
export function scanCandidatePackageArtifact(
  lease: CandidatePackageArtifactLease,
  dependencies: CandidateTarScanDependencies = {},
): ReturnType<typeof brandAudit.scanTarball> {
  return withCandidatePackageBytes(lease, "tar-scan", (bytes, artifact) => {
    dependencies.observeCandidateBytes?.(bytes);
    let result: ReturnType<typeof brandAudit.scanTarball>;
    try {
      result = (dependencies.scanTarball ?? brandAudit.scanTarball)({
        bytes,
        expectedSha256: artifact.sha256,
      });
    } catch (error) {
      if (error instanceof brandAudit.BrandAuditError) {
        throw new CandidatePackageArtifactError(error.code);
      }
      throw error;
    }
    failUnless(
      result.artifactSha256 === artifact.sha256 && result.memberCount === artifact.memberCount,
      "artifact_metadata_drift",
    );
    failUnless(result.findingCount === 0, "brand_family_detected");
    return result;
  });
}

export type ReleaseReadinessConclusion = "PASS" | "BLOCKED";

export interface ReleaseReadinessCheck {
  readonly name: string;
  readonly conclusion: "PASS";
}

export interface PlatformLaneEvidence {
  readonly laneId: "linux-node22" | "linux-node24" | "windows-node22" | "windows-node24";
  readonly candidateSubject: string;
  readonly artifactSha256: string;
  readonly memberCount: number;
  readonly conclusion: "PASS";
}

export interface ReleaseReadinessOptions {
  readonly root: string;
  readonly candidateSubject: string;
  readonly semanticReviewReceipt: string;
  readonly artifact: CandidatePackageArtifact;
  readonly checks: readonly ReleaseReadinessCheck[];
  readonly platformLanes?: readonly PlatformLaneEvidence[];
}

export interface PackageProductSnapshot {
  readonly subject: string;
  readonly tree: string;
  readonly version: "0.3.0";
  readonly digest: string;
  readonly localGuideDigest: string;
  readonly paths: readonly string[];
  readonly sourcePaths: readonly string[];
  readonly generatedPaths: readonly string[];
  readonly oids: Readonly<Record<string, string>>;
}

export interface ReleaseReadinessResult {
  readonly schemaVersion: 1;
  readonly result: ReleaseReadinessConclusion;
  readonly candidateSubject: string;
  readonly candidateTree: string;
  readonly packageVersion: "0.3.0";
  readonly packageProductTreeDigest: string;
  readonly artifactSha256: string;
  readonly memberCount: number;
  readonly dryRunCount: 1;
  readonly actualPackCount: 1;
  readonly localGuideDigest: string;
  readonly semanticReview: {
    readonly verdict: "PASS";
    readonly reviewedSubject: string;
    readonly reviewedTree: string;
    readonly blobCount: 5;
  };
  readonly checks: readonly ReleaseReadinessCheck[];
  readonly platformLanes: "NOT_RUN" | readonly PlatformLaneEvidence[];
  readonly externalActions: {
    readonly tag: "NOT_RUN_BY_SCOPE";
    readonly publish: "NOT_RUN_BY_SCOPE";
    readonly registry_refetch: "NOT_RUN_BY_SCOPE";
  };
}

const EXACT_CANDIDATE_VERSION = "0.3.0" as const;
const GIT_OID_RE = /^[0-9a-f]{40}$/u;
const CANONICAL_SKILL_PATHS = Object.freeze([
  "plugin-src/capabilities/code-style-nudge/skill/SKILL.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/cpp-lifetime-control-flow.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/protocol-serialization-data.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/lua-contracts.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/change-hygiene-self-review.md",
] as const);
const VERSION_MANIFEST_PATHS = Object.freeze([
  "kcoderag-cursor/.cursor-plugin/plugin.json",
  "kcoderag-qa/.claude-plugin/plugin.json",
  "kcoderag-qa/.codex-plugin/plugin.json",
] as const);
const LOCAL_GUIDE_PATH = "docs/MCP_QA_EXPERIENCE_GUIDE.md";
const LOCAL_CHECK_NAMES = Object.freeze([
  "dependency-audit", "build", "full-tests", "generated-qa", "generated-cursor",
  "docs-check", "local-guide", "retirement-audit", "git-brand-audit", "pack-audit",
  "tar-brand-audit", "required-smoke",
] as const);
const PLATFORM_LANE_IDS = Object.freeze([
  "linux-node22", "linux-node24", "windows-node22", "windows-node24",
] as const);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;

export class ReleaseReadinessError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReleaseReadinessError";
    this.code = code;
  }
}

function readinessFailUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ReleaseReadinessError(code);
}

function exactKeys(value: unknown, keys: readonly string[]): value is JsonMap {
  return isRecord(value)
    && Object.keys(value).sort(compare).join("\0") === [...keys].sort(compare).join("\0");
}

function validProductPath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\\")
    && !value.includes("\0")
    && !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function runGit(root: string, args: readonly string[], code: string): Buffer {
  const result = childProcess.spawnSync("git", [...args], {
    cwd: root,
    encoding: "buffer",
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
  });
  readinessFailUnless(result.status === 0 && Buffer.isBuffer(result.stdout), code);
  readinessFailUnless(result.stdout.length <= MAX_GIT_OUTPUT_BYTES, code);
  return result.stdout;
}

function gitLine(root: string, args: readonly string[], code: string): string {
  const value = runGit(root, args, code).toString("ascii").trim();
  readinessFailUnless(GIT_OID_RE.test(value), code);
  return value;
}

function resolveSubject(root: string, subject: string): { readonly subject: string; readonly tree: string } {
  readinessFailUnless(GIT_OID_RE.test(subject), "invalid_candidate_subject");
  const resolved = gitLine(root, ["rev-parse", "--verify", `${subject}^{commit}`], "invalid_candidate_subject");
  readinessFailUnless(resolved === subject, "invalid_candidate_subject");
  return Object.freeze({
    subject: resolved,
    tree: gitLine(root, ["rev-parse", "--verify", `${resolved}^{tree}`], "invalid_candidate_tree"),
  });
}

function readGitBlob(root: string, subject: string, relativePath: string, code: string): {
  readonly oid: string;
  readonly bytes: Buffer;
} {
  readinessFailUnless(validProductPath(relativePath), code);
  const oid = gitLine(root, ["rev-parse", "--verify", `${subject}:${relativePath}`], code);
  const type = runGit(root, ["cat-file", "-t", oid], code).toString("ascii").trim();
  readinessFailUnless(type === "blob", code);
  const bytes = runGit(root, ["cat-file", "blob", oid], code);
  return Object.freeze({ oid, bytes });
}

function parseJsonBlob(bytes: Buffer, code: string): JsonMap {
  readinessFailUnless(bytes.length > 0 && bytes.length <= 1024 * 1024, code);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ReleaseReadinessError(code);
  }
  readinessFailUnless(isRecord(value), code);
  return value;
}

function readSemanticReceipt(root: string, receiptPath: string): JsonMap {
  const resolvedRoot = fs.realpathSync(root);
  const resolvedPath = path.resolve(receiptPath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  readinessFailUnless(
    relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    "semantic_review_stale",
  );
  let stat: import("node:fs").Stats;
  try {
    stat = fs.lstatSync(resolvedPath);
  } catch {
    throw new ReleaseReadinessError("semantic_review_stale");
  }
  readinessFailUnless(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_RECEIPT_BYTES,
    "semantic_review_stale");
  return parseJsonBlob(fs.readFileSync(resolvedPath), "semantic_review_stale");
}

function validateSemanticReview(root: string, candidateSubject: string, receiptPath: string): ReleaseReadinessResult["semanticReview"] {
  const receipt = readSemanticReceipt(root, receiptPath);
  readinessFailUnless(exactKeys(receipt, [
    "schemaVersion", "verdict", "reviewedSubject", "reviewedTree", "entryPath", "referencePaths",
    "blobDigests", "ruleCounts", "behaviorCaseCount",
  ]), "semantic_review_stale");
  readinessFailUnless(
    receipt.schemaVersion === 1
      && receipt.verdict === "PASS"
      && typeof receipt.reviewedSubject === "string"
      && GIT_OID_RE.test(receipt.reviewedSubject)
      && typeof receipt.reviewedTree === "string"
      && GIT_OID_RE.test(receipt.reviewedTree)
      && receipt.entryPath === CANONICAL_SKILL_PATHS[0]
      && Array.isArray(receipt.referencePaths)
      && receipt.referencePaths.length === 4
      && receipt.referencePaths.every((value, index) => value === CANONICAL_SKILL_PATHS[index + 1])
      && exactKeys(receipt.ruleCounts, ["R", "S"])
      && receipt.ruleCounts.R === 19
      && receipt.ruleCounts.S === 8
      && receipt.behaviorCaseCount === 15
      && isRecord(receipt.blobDigests)
      && Object.keys(receipt.blobDigests).sort(compare).join("\0") === [...CANONICAL_SKILL_PATHS].sort(compare).join("\0"),
    "semantic_review_stale",
  );
  const reviewed = resolveSubject(root, receipt.reviewedSubject);
  readinessFailUnless(reviewed.tree === receipt.reviewedTree, "semantic_review_stale");
  for (const relativePath of CANONICAL_SKILL_PATHS) {
    const reviewedBlob = readGitBlob(root, reviewed.subject, relativePath, "semantic_review_stale");
    const candidateBlob = readGitBlob(root, candidateSubject, relativePath, "semantic_review_stale");
    const expectedDigest = receipt.blobDigests[relativePath];
    readinessFailUnless(
      typeof expectedDigest === "string"
        && SHA256_RE.test(expectedDigest)
        && sha256(reviewedBlob.bytes) === expectedDigest
        && sha256(candidateBlob.bytes) === expectedDigest
        && reviewedBlob.bytes.equals(candidateBlob.bytes),
      "semantic_review_stale",
    );
  }
  return Object.freeze({
    verdict: "PASS",
    reviewedSubject: reviewed.subject,
    reviewedTree: reviewed.tree,
    blobCount: 5,
  });
}

/** Bind immutable source blobs and the exact declared clean-build output inventory. */
export function readPackageProductSnapshot(rootInput: string, subjectInput: string): PackageProductSnapshot {
  const root = fs.realpathSync(path.resolve(rootInput));
  const resolved = resolveSubject(root, subjectInput);
  const packageBlob = readGitBlob(root, resolved.subject, "package.json", "package_identity_invalid");
  const packageJson = parseJsonBlob(packageBlob.bytes, "package_identity_invalid");
  readinessFailUnless(
    packageJson.name === PACKAGE_NAME
      && packageJson.version === EXACT_CANDIDATE_VERSION
      && Array.isArray(packageJson.files)
      && packageJson.files.length > 0
      && packageJson.files.every(validProductPath),
    "package_identity_invalid",
  );
  const declared = packageJson.files as string[];
  readinessFailUnless(
    new Set(declared).size === declared.length
      && !declared.includes("package.json")
      && declared.includes(LOCAL_GUIDE_PATH),
    "package_inventory_invalid");
  const paths = Object.freeze(["package.json", ...declared].sort(compare));
  const generatedPaths = Object.freeze(declared.filter((relativePath) => relativePath.startsWith("dist/")).sort(compare));
  const generatedPathSet = new Set(generatedPaths);
  const sourcePaths = Object.freeze(paths.filter((relativePath) => !generatedPathSet.has(relativePath)));
  const oids: Record<string, string> = {};
  const digest = crypto.createHash("sha256");
  digest.update("kcoderag-nav:package-product-snapshot:v2\0", "utf8");
  for (const relativePath of paths) {
    digest.update("declared\0", "utf8").update(relativePath, "utf8").update("\0");
  }
  for (const relativePath of generatedPaths) {
    digest.update("generated\0", "utf8").update(relativePath, "utf8").update("\0");
  }
  let localGuideDigest = "";
  for (const relativePath of sourcePaths) {
    const blob = readGitBlob(root, resolved.subject, relativePath, "package_inventory_invalid");
    oids[relativePath] = blob.oid;
    const bodyDigest = sha256(blob.bytes);
    digest.update("source\0", "utf8").update(relativePath, "utf8").update("\0")
      .update(blob.oid, "ascii").update("\0")
      .update(bodyDigest, "ascii").update("\0");
    if (relativePath === LOCAL_GUIDE_PATH) localGuideDigest = bodyDigest;
  }
  readinessFailUnless(SHA256_RE.test(localGuideDigest), "local_guide_invalid");
  return Object.freeze({
    subject: resolved.subject,
    tree: resolved.tree,
    version: EXACT_CANDIDATE_VERSION,
    digest: digest.digest("hex"),
    localGuideDigest,
    paths,
    sourcePaths,
    generatedPaths,
    oids: Object.freeze(oids),
  });
}

function validateCandidateVersions(root: string, subject: string): void {
  const packageLock = parseJsonBlob(readGitBlob(root, subject, "package-lock.json", "version_drift").bytes,
    "version_drift");
  readinessFailUnless(
    packageLock.name === PACKAGE_NAME
      && packageLock.version === EXACT_CANDIDATE_VERSION
      && isRecord(packageLock.packages)
      && isRecord(packageLock.packages[""])
      && packageLock.packages[""].name === PACKAGE_NAME
      && packageLock.packages[""].version === EXACT_CANDIDATE_VERSION,
    "version_drift",
  );
  for (const relativePath of VERSION_MANIFEST_PATHS) {
    const manifest = parseJsonBlob(readGitBlob(root, subject, relativePath, "version_drift").bytes, "version_drift");
    readinessFailUnless(manifest.version === EXACT_CANDIDATE_VERSION, "version_drift");
  }
}

function validateChecks(value: readonly ReleaseReadinessCheck[]): readonly ReleaseReadinessCheck[] {
  readinessFailUnless(Array.isArray(value) && value.length === LOCAL_CHECK_NAMES.length, "readiness_incomplete");
  const names: string[] = [];
  for (const check of value) {
    readinessFailUnless(exactKeys(check, ["name", "conclusion"]) && typeof check.name === "string"
      && check.conclusion === "PASS", "readiness_incomplete");
    names.push(check.name);
  }
  readinessFailUnless(new Set(names).size === names.length
    && names.sort(compare).join("\0") === [...LOCAL_CHECK_NAMES].sort(compare).join("\0"), "readiness_incomplete");
  return Object.freeze(value.map((check) => Object.freeze({ name: check.name, conclusion: "PASS" as const })));
}

function validatePlatformLanes(
  value: readonly PlatformLaneEvidence[] | undefined,
  candidateSubject: string,
  artifact: CandidatePackageArtifact,
): "NOT_RUN" | readonly PlatformLaneEvidence[] {
  if (value === undefined) return "NOT_RUN";
  readinessFailUnless(Array.isArray(value) && value.length === PLATFORM_LANE_IDS.length,
    "platform_lanes_incomplete");
  const lanes: PlatformLaneEvidence[] = [];
  for (const lane of value) {
    readinessFailUnless(exactKeys(lane, [
      "laneId", "candidateSubject", "artifactSha256", "memberCount", "conclusion",
    ]), "platform_lanes_incomplete");
    readinessFailUnless(
      PLATFORM_LANE_IDS.includes(lane.laneId as PlatformLaneEvidence["laneId"])
        && lane.candidateSubject === candidateSubject
        && lane.artifactSha256 === artifact.sha256
        && lane.memberCount === artifact.memberCount
        && lane.conclusion === "PASS",
      "platform_lanes_incomplete",
    );
    lanes.push(Object.freeze({
      laneId: lane.laneId as PlatformLaneEvidence["laneId"],
      candidateSubject: lane.candidateSubject as string,
      artifactSha256: lane.artifactSha256 as string,
      memberCount: lane.memberCount as number,
      conclusion: "PASS",
    }));
  }
  readinessFailUnless(new Set(lanes.map((lane) => lane.laneId)).size === PLATFORM_LANE_IDS.length,
    "platform_lanes_incomplete");
  return Object.freeze(lanes.sort((left, right) => compare(left.laneId, right.laneId)));
}

/** Aggregate immutable local assurance while keeping external release actions explicitly out of scope. */
export function runReleaseReadiness(options: ReleaseReadinessOptions): ReleaseReadinessResult {
  readinessFailUnless(isRecord(options), "invalid_readiness_options");
  readinessFailUnless(typeof options.root === "string" && options.root.length > 0, "invalid_readiness_options");
  const root = fs.realpathSync(path.resolve(options.root));
  const candidate = resolveSubject(root, options.candidateSubject);
  readinessFailUnless(exactKeys(options.artifact, [
    "name", "version", "sha256", "memberCount", "dryRunCount", "actualPackCount",
  ]), "artifact_metadata_drift");
  readinessFailUnless(
    options.artifact.name === PACKAGE_NAME
      && options.artifact.version === EXACT_CANDIDATE_VERSION
      && SHA256_RE.test(options.artifact.sha256)
      && Number.isSafeInteger(options.artifact.memberCount)
      && options.artifact.memberCount > 0
      && options.artifact.dryRunCount === 1
      && options.artifact.actualPackCount === 1,
    "artifact_metadata_drift",
  );
  const product = readPackageProductSnapshot(root, candidate.subject);
  validateCandidateVersions(root, candidate.subject);
  const semanticReview = validateSemanticReview(root, candidate.subject, options.semanticReviewReceipt);
  const checks = validateChecks(options.checks);
  const platformLanes = validatePlatformLanes(options.platformLanes, candidate.subject, options.artifact);
  return Object.freeze({
    schemaVersion: 1,
    result: platformLanes === "NOT_RUN" ? "BLOCKED" : "PASS",
    candidateSubject: candidate.subject,
    candidateTree: candidate.tree,
    packageVersion: EXACT_CANDIDATE_VERSION,
    packageProductTreeDigest: product.digest,
    artifactSha256: options.artifact.sha256,
    memberCount: options.artifact.memberCount,
    dryRunCount: 1,
    actualPackCount: 1,
    localGuideDigest: product.localGuideDigest,
    semanticReview,
    checks,
    platformLanes,
    externalActions: Object.freeze({
      tag: "NOT_RUN_BY_SCOPE",
      publish: "NOT_RUN_BY_SCOPE",
      registry_refetch: "NOT_RUN_BY_SCOPE",
    }),
  });
}

function readCliJson(root: string, inputPath: string): unknown {
  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);
  readinessFailUnless(relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative), "invalid_arguments");
  let stat: import("node:fs").Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new ReleaseReadinessError("invalid_arguments");
  }
  readinessFailUnless(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 256 * 1024,
    "invalid_arguments");
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
  } catch {
    throw new ReleaseReadinessError("invalid_arguments");
  }
}

/** Evaluate already-produced local metadata; package creation remains owned by the private lease API. */
export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const values = new Map<string, string>();
    for (let index = 0; index < argv.length; index += 2) {
      const flag = argv[index];
      const value = argv[index + 1];
      readinessFailUnless(flag !== undefined && value !== undefined && !values.has(flag), "invalid_arguments");
      readinessFailUnless([
        "--candidate", "--semantic-review", "--artifact", "--checks", "--platform-evidence",
      ].includes(flag), "invalid_arguments");
      values.set(flag, value);
    }
    const candidateSubject = values.get("--candidate");
    const semanticReviewReceipt = values.get("--semantic-review");
    const artifactPath = values.get("--artifact");
    const checksPath = values.get("--checks");
    readinessFailUnless(candidateSubject !== undefined && semanticReviewReceipt !== undefined
      && artifactPath !== undefined && checksPath !== undefined, "invalid_arguments");
    const root = fs.realpathSync(process.cwd());
    const artifact = readCliJson(root, artifactPath) as CandidatePackageArtifact;
    const checks = readCliJson(root, checksPath) as readonly ReleaseReadinessCheck[];
    const platformPath = values.get("--platform-evidence");
    const result = runReleaseReadiness({
      root,
      candidateSubject,
      semanticReviewReceipt,
      artifact,
      checks,
      ...(platformPath === undefined
        ? {}
        : { platformLanes: readCliJson(root, platformPath) as readonly PlatformLaneEvidence[] }),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.result === "PASS" ? 0 : 2;
  } catch (error) {
    const code = error instanceof ReleaseReadinessError ? error.code : "release_readiness_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
