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
