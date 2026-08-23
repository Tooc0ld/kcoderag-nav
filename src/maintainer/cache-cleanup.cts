#!/usr/bin/env node
/** Exact five-root Python cache cleanup authorization and evidence CLI. */

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const retirement = require("./retirement-audit.cjs") as {
  readonly CACHE_ROOTS: readonly string[];
  readonly canonicalJson: (value: unknown) => string;
  readonly compareCodePointPaths: (left: string, right: string) => number;
  readonly validateSortedUniquePaths: (paths: readonly string[]) => readonly string[];
  readonly verifyProductionBaseline: (receipt: Record<string, any>, currentHead: string, root?: string) => void;
  readonly verifyPreReceipt: (receipt: unknown, root?: string, currentHead?: string) => Record<string, any>;
  readonly hashBytes: (bytes: string | Buffer) => string;
  readonly hashCanonical: (value: unknown) => string;
  readonly collectUnrelatedStatus: (root: string) => Record<string, any>;
  readonly collectRootExternalDigests: (root: string) => readonly Record<string, any>[];
};

type JsonMap = Record<string, any>;

interface CleanupPlanFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly sha256: string;
}

interface CleanupPlan {
  readonly unlinkTargets: readonly CleanupPlanFile[];
  readonly rmdirTargets: readonly string[];
}

interface MutationAdapter {
  unlink(filePath: string): void;
  rmdir(directoryPath: string): void;
}

const AUTHORIZATION_KEYS = Object.freeze([
  "schema_version", "source_schema_version", "repo_head", "tracked_production_inventory",
  "tracked_production_inventory_sha256", "plan15_receipt_sha256", "authorized_set_sha256",
  "pre_cache_inventory", "unrelated_status_before", "root_external_digests_before", "receipt_sha256",
]);

const CLEANUP_KEYS = Object.freeze([
  "schema_version", "repo_head", "tracked_production_inventory_sha256", "plan15_receipt_sha256",
  "authorization_receipt_sha256", "authorized_set_sha256", "pre_cache_inventory",
  "observed_deletions", "deletion_set_equal", "removed_roots", "unrelated_status_before",
  "unrelated_status_after", "root_external_digests_before", "root_external_digests_after",
  "receipt_sha256",
]);

const SHA256_RE = /^[0-9a-f]{64}$/u;

export class CacheCleanupError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CacheCleanupError";
    this.code = code;
  }
}

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new CacheCleanupError(code);
}

function isPlainObject(value: unknown): value is JsonMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: unknown, expected: readonly string[]): value is JsonMap {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort(retirement.compareCodePointPaths);
  const wanted = [...expected].sort(retirement.compareCodePointPaths);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return retirement.canonicalJson(left) === retirement.canonicalJson(right);
}

function deepCopy<T>(value: T): T {
  return JSON.parse(retirement.canonicalJson(value)) as T;
}

function withoutSelfHash(value: JsonMap): JsonMap {
  const copy: JsonMap = {};
  for (const [key, item] of Object.entries(value)) if (key !== "receipt_sha256") copy[key] = item;
  return copy;
}

function resolveContained(root: string, relativePath: string): string {
  retirement.validateSortedUniquePaths([relativePath]);
  const resolvedRoot = fs.realpathSync(root);
  const candidate = path.resolve(resolvedRoot, ...relativePath.split("/"));
  const relative = path.relative(resolvedRoot, candidate);
  failUnless(relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative), "cache_path_escape");
  let current = path.dirname(candidate);
  while (current !== resolvedRoot) {
    if (fs.existsSync(current)) failUnless(!fs.lstatSync(current).isSymbolicLink(), "cache_path_escape");
    current = path.dirname(current);
  }
  return candidate;
}

function assertRegularAuthorizedFile(root: string, relativePath: string, sha256: string): string {
  failUnless(relativePath.endsWith(".pyc") && !relativePath.endsWith(".pyo") && SHA256_RE.test(sha256),
    "invalid_cache_target");
  const absolute = resolveContained(root, relativePath);
  let stat: import("node:fs").Stats;
  try { stat = fs.lstatSync(absolute); } catch { throw new CacheCleanupError("invalid_cache_target"); }
  failUnless(stat.isFile() && !stat.isSymbolicLink(), "invalid_cache_target");
  failUnless(retirement.hashBytes(fs.readFileSync(absolute)) === sha256, "cache_hash_mismatch");
  const real = fs.realpathSync(absolute);
  failUnless(path.resolve(real) === path.resolve(absolute), "cache_path_escape");
  return absolute;
}

function currentHead(root: string): string {
  const childProcess = require("node:child_process") as typeof import("node:child_process");
  const result = childProcess.spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  failUnless(result.status === 0, "git_failed");
  return result.stdout.trim();
}

export function validateProducerReceipt(value: unknown, root: string, head?: string): JsonMap {
  try {
    return retirement.verifyPreReceipt(value, root, head ?? currentHead(root));
  } catch {
    throw new CacheCleanupError("invalid_producer_receipt");
  }
}

function validateAuthorizationStatic(value: unknown, producer: JsonMap): JsonMap {
  failUnless(exactKeys(value, AUTHORIZATION_KEYS)
    && value.schema_version === "kcoderag-nav/cache-cleanup-authorization@1"
    && value.source_schema_version === producer.schema_version
    && value.repo_head === producer.repo_head
    && value.tracked_production_inventory_sha256 === producer.tracked_production_inventory_sha256
    && value.plan15_receipt_sha256 === producer.receipt_sha256
    && value.authorized_set_sha256 === producer.authorized_set_sha256
    && typeof value.receipt_sha256 === "string" && SHA256_RE.test(value.receipt_sha256),
  "invalid_authorization_receipt");
  failUnless(canonicalEqual(value.tracked_production_inventory, producer.tracked_production_inventory)
    && canonicalEqual(value.pre_cache_inventory, producer.pre_cache_inventory)
    && canonicalEqual(value.unrelated_status_before, producer.unrelated_status_before)
    && canonicalEqual(value.root_external_digests_before, producer.root_external_digests_before),
  "invalid_authorization_receipt");
  failUnless(value.receipt_sha256 === retirement.hashCanonical(withoutSelfHash(value)), "invalid_authorization_receipt");
  return value;
}

export function validateAuthorizationReceipt(
  value: unknown,
  producer: JsonMap,
  root: string,
  head?: string,
): JsonMap {
  validateProducerReceipt(producer, root, head);
  try { return validateAuthorizationStatic(value, producer); } catch { throw new CacheCleanupError("invalid_authorization_receipt"); }
}

export function buildCleanupPlan(root: string, producer: JsonMap, head?: string): CleanupPlan {
  const verified = validateProducerReceipt(producer, root, head);
  const files = verified.pre_cache_inventory.files as readonly JsonMap[];
  retirement.validateSortedUniquePaths(files.map((file) => file.path as string));
  const unlinkTargets = files.map((file) => Object.freeze({
    relativePath: file.path as string,
    absolutePath: assertRegularAuthorizedFile(root, file.path as string, file.sha256 as string),
    sha256: file.sha256 as string,
  }));
  failUnless(unlinkTargets.length === 26, "invalid_cleanup_plan");
  const roots = [...retirement.CACHE_ROOTS].sort(retirement.compareCodePointPaths);
  retirement.validateSortedUniquePaths(roots);
  for (const cacheRoot of roots) {
    const absolute = resolveContained(root, cacheRoot);
    const stat = fs.lstatSync(absolute);
    failUnless(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(absolute) === absolute,
      "cache_path_escape");
  }
  return Object.freeze({ unlinkTargets: Object.freeze(unlinkTargets), rmdirTargets: Object.freeze(roots) });
}

function writeCanonicalAtomic(filePath: string, value: unknown): void {
  const absolute = path.resolve(filePath);
  failUnless(!fs.existsSync(absolute), "receipt_exists");
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, retirement.canonicalJson(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, absolute);
    try { fs.chmodSync(absolute, 0o600); } catch { /* Windows has no POSIX mode contract. */ }
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
  }
}

export function authorizeCleanup(input: {
  readonly root: string;
  readonly producer: JsonMap;
  readonly authorizationPath: string;
  readonly currentHead?: string;
}): JsonMap {
  try {
    const producer = validateProducerReceipt(input.producer, input.root, input.currentHead);
    buildCleanupPlan(input.root, producer, input.currentHead);
    const authorization: JsonMap = {
      schema_version: "kcoderag-nav/cache-cleanup-authorization@1",
      source_schema_version: producer.schema_version,
      repo_head: producer.repo_head,
      tracked_production_inventory: deepCopy(producer.tracked_production_inventory),
      tracked_production_inventory_sha256: producer.tracked_production_inventory_sha256,
      plan15_receipt_sha256: producer.receipt_sha256,
      authorized_set_sha256: producer.authorized_set_sha256,
      pre_cache_inventory: deepCopy(producer.pre_cache_inventory),
      unrelated_status_before: deepCopy(producer.unrelated_status_before),
      root_external_digests_before: deepCopy(producer.root_external_digests_before),
    };
    authorization.receipt_sha256 = retirement.hashCanonical(authorization);
    validateAuthorizationStatic(authorization, producer);
    writeCanonicalAtomic(input.authorizationPath, authorization);
    return Object.freeze(authorization);
  } catch (error) {
    if (error instanceof CacheCleanupError && error.code === "receipt_exists") throw error;
    throw new CacheCleanupError("invalid_producer_receipt");
  }
}

function defaultMutationAdapter(): MutationAdapter {
  return Object.freeze({
    unlink(filePath: string) { fs.unlinkSync(filePath); },
    rmdir(directoryPath: string) { fs.rmdirSync(directoryPath); },
  });
}

function assertPreflight(
  root: string,
  producer: JsonMap,
  authorization: JsonMap,
  head?: string,
): CleanupPlan {
  validateProducerReceipt(producer, root, head);
  validateAuthorizationStatic(authorization, producer);
  return buildCleanupPlan(root, producer, head);
}

export function executeCleanupPlan(input: {
  readonly root: string;
  readonly producer: JsonMap;
  readonly authorization: JsonMap;
  readonly cleanupReceiptPath: string;
  readonly currentHead?: string;
  readonly mutationAdapter?: MutationAdapter;
}): JsonMap {
  let plan: CleanupPlan;
  try {
    failUnless(!fs.existsSync(input.cleanupReceiptPath), "receipt_exists");
    plan = assertPreflight(input.root, input.producer, input.authorization, input.currentHead);
  } catch {
    throw new CacheCleanupError("cleanup_preflight_failed");
  }
  const mutation = input.mutationAdapter ?? defaultMutationAdapter();
  const observed: string[] = [];
  try {
    for (const target of plan.unlinkTargets) {
      assertRegularAuthorizedFile(input.root, target.relativePath, target.sha256);
      mutation.unlink(target.absolutePath);
      observed.push(target.relativePath);
    }
    retirement.validateSortedUniquePaths(observed);
    const authorized = plan.unlinkTargets.map((target) => target.relativePath);
    failUnless(canonicalEqual(observed, authorized), "deletion_set_mismatch");
    const removedRoots: string[] = [];
    for (const cacheRoot of plan.rmdirTargets) {
      const absolute = resolveContained(input.root, cacheRoot);
      const stat = fs.lstatSync(absolute);
      failUnless(stat.isDirectory() && !stat.isSymbolicLink() && fs.readdirSync(absolute).length === 0,
        "cache_root_not_empty");
      mutation.rmdir(absolute);
      failUnless(!fs.existsSync(absolute), "cache_root_remains");
      removedRoots.push(cacheRoot);
    }
    retirement.validateSortedUniquePaths(removedRoots);
    const unrelatedAfter = retirement.collectUnrelatedStatus(input.root);
    const externalAfter = retirement.collectRootExternalDigests(input.root);
    failUnless(canonicalEqual(unrelatedAfter, input.producer.unrelated_status_before), "unrelated_status_changed");
    failUnless(canonicalEqual(externalAfter, input.producer.root_external_digests_before), "root_external_changed");
    const receipt: JsonMap = {
      schema_version: "kcoderag-nav/cache-cleanup-receipt@1",
      repo_head: input.producer.repo_head,
      tracked_production_inventory_sha256: input.producer.tracked_production_inventory_sha256,
      plan15_receipt_sha256: input.producer.receipt_sha256,
      authorization_receipt_sha256: input.authorization.receipt_sha256,
      authorized_set_sha256: input.producer.authorized_set_sha256,
      pre_cache_inventory: deepCopy(input.producer.pre_cache_inventory),
      observed_deletions: Object.freeze([...observed]),
      deletion_set_equal: true,
      removed_roots: Object.freeze([...removedRoots]),
      unrelated_status_before: deepCopy(input.producer.unrelated_status_before),
      unrelated_status_after: deepCopy(unrelatedAfter),
      root_external_digests_before: deepCopy(input.producer.root_external_digests_before),
      root_external_digests_after: deepCopy(externalAfter),
    };
    receipt.receipt_sha256 = retirement.hashCanonical(receipt);
    verifyCleanupReceipt(receipt, input.producer, input.authorization, input.root, input.currentHead);
    writeCanonicalAtomic(input.cleanupReceiptPath, receipt);
    return Object.freeze(receipt);
  } catch (error) {
    if (error instanceof CacheCleanupError) throw error;
    throw new CacheCleanupError("cleanup_execute_failed");
  }
}

export function verifyCleanupReceipt(
  value: unknown,
  producer: JsonMap,
  authorization: JsonMap,
  root: string,
  head?: string,
): JsonMap {
  try {
    validateProducerReceipt(producer, root, head);
    validateAuthorizationStatic(authorization, producer);
    failUnless(exactKeys(value, CLEANUP_KEYS)
      && value.schema_version === "kcoderag-nav/cache-cleanup-receipt@1"
      && value.repo_head === producer.repo_head
      && value.tracked_production_inventory_sha256 === producer.tracked_production_inventory_sha256
      && value.plan15_receipt_sha256 === producer.receipt_sha256
      && value.authorization_receipt_sha256 === authorization.receipt_sha256
      && value.authorized_set_sha256 === producer.authorized_set_sha256
      && value.deletion_set_equal === true
      && typeof value.receipt_sha256 === "string" && SHA256_RE.test(value.receipt_sha256),
    "invalid_cleanup_receipt");
    failUnless(canonicalEqual(value.pre_cache_inventory, producer.pre_cache_inventory)
      && canonicalEqual(value.unrelated_status_before, producer.unrelated_status_before)
      && canonicalEqual(value.unrelated_status_after, producer.unrelated_status_before)
      && canonicalEqual(value.root_external_digests_before, producer.root_external_digests_before)
      && canonicalEqual(value.root_external_digests_after, producer.root_external_digests_before),
    "invalid_cleanup_receipt");
    const authorizedPaths = (producer.pre_cache_inventory.files as readonly JsonMap[]).map((file) => file.path as string);
    failUnless(Array.isArray(value.observed_deletions) && canonicalEqual(value.observed_deletions, authorizedPaths),
      "invalid_cleanup_receipt");
    retirement.validateSortedUniquePaths(value.observed_deletions);
    const expectedRoots = [...retirement.CACHE_ROOTS].sort(retirement.compareCodePointPaths);
    failUnless(Array.isArray(value.removed_roots) && canonicalEqual(value.removed_roots, expectedRoots),
      "invalid_cleanup_receipt");
    retirement.validateSortedUniquePaths(value.removed_roots);
    failUnless(value.receipt_sha256 === retirement.hashCanonical(withoutSelfHash(value)), "invalid_cleanup_receipt");
    for (const cacheRoot of retirement.CACHE_ROOTS) failUnless(!fs.existsSync(resolveContained(root, cacheRoot)),
      "cache_root_remains");
    failUnless(canonicalEqual(retirement.collectUnrelatedStatus(root), producer.unrelated_status_before),
      "unrelated_status_changed");
    failUnless(canonicalEqual(retirement.collectRootExternalDigests(root), producer.root_external_digests_before),
      "root_external_changed");
    return value;
  } catch (error) {
    if (error instanceof CacheCleanupError && ["unrelated_status_changed", "root_external_changed"].includes(error.code)) throw error;
    throw new CacheCleanupError("invalid_cleanup_receipt");
  }
}

function readJson(filePath: string): JsonMap {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    failUnless(isPlainObject(parsed), "invalid_json");
    return parsed;
  } catch (error) {
    if (error instanceof CacheCleanupError) throw error;
    throw new CacheCleanupError("invalid_json");
  }
}

function parseArguments(argv: readonly string[]): {
  readonly command: "authorize" | "execute" | "verify";
  readonly producer: string;
  readonly authorization: string;
  readonly cleanupReceipt?: string;
} {
  const command = argv[0];
  failUnless(command === "authorize" || command === "execute" || command === "verify", "invalid_arguments");
  const expectedLength = command === "authorize" ? 5 : 7;
  failUnless(argv.length === expectedLength, "invalid_arguments");
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    failUnless(typeof flag === "string" && typeof value === "string" && value.length > 0 && !values.has(flag),
      "invalid_arguments");
    values.set(flag, value);
  }
  failUnless(values.has("--producer") && values.has("--authorization")
    && (command === "authorize" ? values.size === 2 : values.size === 3 && values.has("--cleanup-receipt")),
  "invalid_arguments");
  if (command === "authorize") return {
    command,
    producer: values.get("--producer")!,
    authorization: values.get("--authorization")!,
  };
  return {
    command: command as "execute" | "verify",
    producer: values.get("--producer")!,
    authorization: values.get("--authorization")!,
    cleanupReceipt: values.get("--cleanup-receipt")!,
  };
}

export function main(
  argv: readonly string[] = process.argv.slice(2),
  options: { readonly root?: string; readonly mutationAdapter?: MutationAdapter } = {},
): number {
  try {
    const parsed = parseArguments(argv);
    const root = fs.realpathSync(options.root ?? path.resolve(__dirname, "../.."));
    const producer = readJson(parsed.producer);
    if (parsed.command === "authorize") {
      authorizeCleanup({ root, producer, authorizationPath: parsed.authorization });
    } else {
      const authorization = readJson(parsed.authorization);
      if (parsed.command === "execute") executeCleanupPlan({
        root,
        producer,
        authorization,
        cleanupReceiptPath: parsed.cleanupReceipt!,
        ...(options.mutationAdapter === undefined ? {} : { mutationAdapter: options.mutationAdapter }),
      });
      else verifyCleanupReceipt(readJson(parsed.cleanupReceipt!), producer, authorization, root);
    }
    process.stdout.write(`${retirement.canonicalJson({ ok: true, command: parsed.command })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof CacheCleanupError ? error.code : "cache_cleanup_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

exports.CacheCleanupError = CacheCleanupError;
exports.validateProducerReceipt = validateProducerReceipt;
exports.validateAuthorizationReceipt = validateAuthorizationReceipt;
exports.buildCleanupPlan = buildCleanupPlan;
exports.authorizeCleanup = authorizeCleanup;
exports.executeCleanupPlan = executeCleanupPlan;
exports.verifyCleanupReceipt = verifyCleanupReceipt;
exports.main = main;

if (require.main === module) process.exitCode = main();
