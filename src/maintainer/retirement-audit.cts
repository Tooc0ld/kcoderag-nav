#!/usr/bin/env node
/** Immutable production-baseline and staged Python-retirement evidence. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

type JsonMap = Record<string, any>;
type RetirementMode = "pre" | "post-source" | "post-scripts" | "post-tests" | "post";

export interface ProductionRecord {
  readonly path: string;
  readonly mode: string;
  readonly blob_oid: string;
  readonly sha256: string;
}

export interface CacheFileRecord {
  readonly path: string;
  readonly sha256: string;
}

export interface PreCacheInventory {
  readonly roots: readonly { readonly path: string; readonly count: number }[];
  readonly root_counts: Readonly<Record<string, number>>;
  readonly total: number;
  readonly files: readonly CacheFileRecord[];
}

export const CACHE_ROOT_COUNTS = Object.freeze({
  "plugin-src/hooks/__pycache__": 2,
  "kcoderag-qa/hooks/__pycache__": 2,
  "kcoderag-dev/hooks/__pycache__": 2,
  "scripts/__pycache__": 6,
  "tests/__pycache__": 14,
});

export const CACHE_ROOTS = Object.freeze(Object.keys(CACHE_ROOT_COUNTS));

const SOURCE_RETIREMENT_PATHS = Object.freeze([
  "plugin-src/version.txt",
  "plugin-src/hooks/grep_nudge.py",
  "plugin-src/hooks/update_check.py",
  "plugin-src/hooks/test_grep_nudge.py",
  "kcoderag-qa/hooks/grep_nudge.py",
  "kcoderag-qa/hooks/update_check.py",
  "kcoderag-qa/hooks/test_grep_nudge.py",
  "kcoderag-dev/hooks/grep_nudge.py",
  "kcoderag-dev/hooks/update_check.py",
  "kcoderag-dev/hooks/test_grep_nudge.py",
  "kcoderag-update.json",
]);

const SCRIPT_RETIREMENT_PATHS = Object.freeze([
  "scripts/manage_project_install.py",
  "scripts/manage_cursor_local_install.py",
  "scripts/generate_plugins.py",
  "scripts/update_plugin.py",
  "scripts/pre_commit_generate.py",
  "scripts/run_host_smoke.py",
  "scripts/__init__.py",
]);

const TEST_RETIREMENT_PATHS = Object.freeze([
  "tests/test_project_install.py",
  "tests/test_cursor_local_install.py",
  "tests/test_generation.py",
  "tests/test_hook_runtime.py",
  "tests/test_update_check.py",
  "tests/test_routing_and_hooks.py",
  "tests/test_host_smoke.py",
  "tests/test_pre_commit_generate.py",
  "tests/test_plugin_update.py",
  "tests/stub_mcp_server.py",
  "tests/__init__.py",
]);

const ROOT_MARKETPLACE_PATHS = Object.freeze([
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
]);

const RECEIPT_KEYS = Object.freeze([
  "schema_version", "repo_head", "tracked_production_inventory",
  "tracked_production_inventory_sha256", "suites", "generated_sha256", "pack_sha256",
  "timestamp", "pre_cache_inventory", "authorized_set_sha256", "unrelated_status_before",
  "root_external_digests_before", "receipt_sha256",
]);

const SHA256_RE = /^[0-9a-f]{64}$/u;
const COMMIT_RE = /^[0-9a-f]{40}$/u;

export class RetirementAuditError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "RetirementAuditError";
    this.code = code;
  }
}

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new RetirementAuditError(code);
}

function isPlainObject(value: unknown): value is JsonMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function compareCodePointPaths(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalValue(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    failUnless(Number.isFinite(value) && !Object.is(value, -0), "non_canonical_value");
    return value;
  }
  failUnless(typeof value === "object" && value !== null, "non_canonical_value");
  failUnless(!seen.has(value), "non_canonical_value");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      failUnless(Object.keys(value).length === value.length, "non_canonical_value");
      return value.map((item) => canonicalValue(item, seen));
    }
    failUnless(isPlainObject(value), "non_canonical_value");
    const output: JsonMap = {};
    for (const key of Object.keys(value).sort(compareCodePointPaths)) {
      const item = value[key];
      failUnless(item !== undefined, "non_canonical_value");
      output[key] = canonicalValue(item, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, new Set<object>()));
}

export function hashBytes(bytes: string | Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function hashCanonical(value: unknown): string {
  return hashBytes(Buffer.from(canonicalJson(value), "utf8"));
}

function validRelativePath(value: string): boolean {
  if (value.length === 0 || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    && path.posix.normalize(value) === value;
}

export function validateSortedUniquePaths(paths: readonly string[]): readonly string[] {
  failUnless(Array.isArray(paths), "invalid_path_list");
  const folded = new Set<string>();
  let previous: string | undefined;
  for (const value of paths) {
    failUnless(typeof value === "string" && validRelativePath(value), "invalid_path_list");
    const fold = value.toLowerCase();
    failUnless(!folded.has(fold), "invalid_path_list");
    folded.add(fold);
    if (previous !== undefined) failUnless(compareCodePointPaths(previous, value) < 0, "invalid_path_list");
    previous = value;
  }
  return paths;
}

function exactKeys(value: unknown, expected: readonly string[]): value is JsonMap {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort(compareCodePointPaths);
  const wanted = [...expected].sort(compareCodePointPaths);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function gitBuffer(root: string, args: readonly string[]): Buffer {
  const result = childProcess.spawnSync("git", [...args], {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) throw new RetirementAuditError("git_failed");
  return result.stdout;
}

function gitText(root: string, args: readonly string[]): string {
  return gitBuffer(root, args).toString("utf8").trim();
}

function productionExcluded(relativePath: string): boolean {
  return relativePath === ".planning" || relativePath.startsWith(".planning/")
    || relativePath === ".gsd" || relativePath.startsWith(".gsd/");
}

export function buildTrackedProductionInventory(root: string, commit: string): readonly ProductionRecord[] {
  failUnless(COMMIT_RE.test(commit), "invalid_baseline_commit");
  const raw = gitBuffer(root, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  const records: ProductionRecord[] = [];
  for (const entry of raw.toString("utf8").split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    failUnless(tab > 0, "invalid_git_tree");
    const metadata = entry.slice(0, tab).split(" ");
    const relativePath = entry.slice(tab + 1);
    failUnless(metadata.length === 3 && metadata[1] === "blob", "invalid_git_tree");
    failUnless(validRelativePath(relativePath), "invalid_git_tree");
    if (productionExcluded(relativePath)) continue;
    const [mode, , blobOid] = metadata;
    failUnless(typeof mode === "string" && typeof blobOid === "string" && COMMIT_RE.test(blobOid), "invalid_git_tree");
    records.push(Object.freeze({
      path: relativePath,
      mode,
      blob_oid: blobOid,
      sha256: hashBytes(gitBuffer(root, ["cat-file", "blob", blobOid])),
    }));
  }
  records.sort((left, right) => compareCodePointPaths(left.path, right.path));
  validateSortedUniquePaths(records.map((record) => record.path));
  return Object.freeze(records);
}

function validateProductionInventory(value: unknown): asserts value is readonly ProductionRecord[] {
  failUnless(Array.isArray(value) && value.length > 0, "invalid_production_inventory");
  for (const record of value) {
    failUnless(exactKeys(record, ["path", "mode", "blob_oid", "sha256"]), "invalid_production_inventory");
    failUnless(typeof record.path === "string" && typeof record.mode === "string"
      && typeof record.blob_oid === "string" && COMMIT_RE.test(record.blob_oid)
      && typeof record.sha256 === "string" && SHA256_RE.test(record.sha256), "invalid_production_inventory");
  }
  validateSortedUniquePaths(value.map((record) => record.path));
}

export function hashTrackedProductionInventory(inventory: readonly ProductionRecord[]): string {
  validateProductionInventory(inventory);
  return hashCanonical(inventory);
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function verifyProductionBaseline(receipt: JsonMap, currentHead: string, root = process.cwd()): void {
  failUnless(typeof receipt.repo_head === "string" && COMMIT_RE.test(receipt.repo_head), "invalid_baseline_commit");
  failUnless(typeof currentHead === "string" && COMMIT_RE.test(currentHead), "invalid_current_commit");
  const ancestor = childProcess.spawnSync("git", ["merge-base", "--is-ancestor", receipt.repo_head, currentHead], {
    cwd: root,
    stdio: "ignore",
  });
  failUnless(ancestor.status === 0, "production_baseline_not_ancestor");
  validateProductionInventory(receipt.tracked_production_inventory);
  failUnless(receipt.tracked_production_inventory_sha256
    === hashTrackedProductionInventory(receipt.tracked_production_inventory), "invalid_production_inventory_hash");
  const current = buildTrackedProductionInventory(root, currentHead);
  failUnless(canonicalEqual(current, receipt.tracked_production_inventory), "production_baseline_drift");
  const diff = gitBuffer(root, ["diff", "--name-only", "-z", `${receipt.repo_head}..${currentHead}`, "--"])
    .toString("utf8").split("\0").filter(Boolean);
  failUnless(diff.every(productionExcluded), "production_baseline_drift");
}

function containedPath(root: string, relativePath: string): string {
  failUnless(validRelativePath(relativePath), "invalid_cache_inventory");
  const absoluteRoot = fs.realpathSync(root);
  const candidate = path.resolve(absoluteRoot, ...relativePath.split("/"));
  const relative = path.relative(absoluteRoot, candidate);
  failUnless(relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative),
    "cache_path_escape");
  let current = path.dirname(candidate);
  while (current !== absoluteRoot) {
    if (fs.existsSync(current)) failUnless(!fs.lstatSync(current).isSymbolicLink(), "cache_path_escape");
    current = path.dirname(current);
  }
  return candidate;
}

function expectedRootRecords(): readonly { readonly path: string; readonly count: number }[] {
  return Object.freeze(CACHE_ROOTS.map((cacheRoot) => Object.freeze({
    path: cacheRoot,
    count: CACHE_ROOT_COUNTS[cacheRoot as keyof typeof CACHE_ROOT_COUNTS],
  })));
}

export function collectPreCacheInventory(root: string): PreCacheInventory {
  const files: CacheFileRecord[] = [];
  for (const cacheRoot of CACHE_ROOTS) {
    const absoluteRoot = containedPath(root, cacheRoot);
    let rootStat: import("node:fs").Stats;
    try { rootStat = fs.lstatSync(absoluteRoot); } catch { throw new RetirementAuditError("invalid_cache_inventory"); }
    failUnless(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "invalid_cache_inventory");
    const entries = fs.readdirSync(absoluteRoot, { withFileTypes: true });
    failUnless(entries.length === CACHE_ROOT_COUNTS[cacheRoot as keyof typeof CACHE_ROOT_COUNTS], "invalid_cache_inventory");
    for (const entry of entries) {
      failUnless(entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".pyc") && !entry.name.endsWith(".pyo"),
        "invalid_cache_inventory");
      const relativePath = `${cacheRoot}/${entry.name}`;
      const absolutePath = containedPath(root, relativePath);
      const stat = fs.lstatSync(absolutePath);
      failUnless(stat.isFile() && !stat.isSymbolicLink(), "invalid_cache_inventory");
      files.push(Object.freeze({ path: relativePath, sha256: hashBytes(fs.readFileSync(absolutePath)) }));
    }
  }
  files.sort((left, right) => compareCodePointPaths(left.path, right.path));
  validateSortedUniquePaths(files.map((record) => record.path));
  return Object.freeze({
    roots: expectedRootRecords(),
    root_counts: Object.freeze({ ...CACHE_ROOT_COUNTS }),
    total: files.length,
    files: Object.freeze(files),
  });
}

function validateCacheInventory(value: unknown): asserts value is PreCacheInventory {
  failUnless(exactKeys(value, ["roots", "root_counts", "total", "files"]), "invalid_cache_inventory");
  failUnless(Array.isArray(value.roots) && exactKeys(value.root_counts, CACHE_ROOTS)
    && value.total === 26 && Array.isArray(value.files) && value.files.length === 26,
    "invalid_cache_inventory");
  failUnless(canonicalEqual(value.roots, expectedRootRecords()) && canonicalEqual(value.root_counts, CACHE_ROOT_COUNTS),
    "invalid_cache_inventory");
  for (const file of value.files) {
    failUnless(exactKeys(file, ["path", "sha256"]) && typeof file.path === "string"
      && typeof file.sha256 === "string" && SHA256_RE.test(file.sha256), "invalid_cache_inventory");
    const owner = CACHE_ROOTS.find((cacheRoot) => file.path.startsWith(`${cacheRoot}/`));
    failUnless(owner !== undefined && file.path.endsWith(".pyc") && !file.path.endsWith(".pyo"), "invalid_cache_inventory");
  }
  validateSortedUniquePaths(value.files.map((file) => file.path));
}

function ignoredStatusPath(relativePath: string): boolean {
  return productionExcluded(relativePath)
    || CACHE_ROOTS.some((cacheRoot) => relativePath === cacheRoot || relativePath.startsWith(`${cacheRoot}/`));
}

export function collectUnrelatedStatus(root: string): JsonMap {
  const raw = gitBuffer(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    .toString("utf8").split("\0").filter(Boolean);
  const entries: JsonMap[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const record = raw[index]!;
    failUnless(record.length >= 4, "invalid_git_status");
    const status = record.slice(0, 2);
    const relativePath = record.slice(3);
    failUnless(validRelativePath(relativePath), "invalid_git_status");
    if (!ignoredStatusPath(relativePath)) entries.push(Object.freeze({ path: relativePath, status }));
    if (status.includes("R") || status.includes("C")) {
      const source = raw[index + 1];
      failUnless(typeof source === "string" && validRelativePath(source), "invalid_git_status");
      if (!ignoredStatusPath(source)) entries.push(Object.freeze({ path: source, status: `${status}:source` }));
      index += 1;
    }
  }
  entries.sort((left, right) => compareCodePointPaths(left.path, right.path));
  validateSortedUniquePaths(entries.map((entry) => entry.path));
  return Object.freeze({ entries: Object.freeze(entries), sha256: hashCanonical(entries) });
}

function validateUnrelatedStatus(value: unknown): void {
  failUnless(exactKeys(value, ["entries", "sha256"]) && Array.isArray(value.entries)
    && typeof value.sha256 === "string" && SHA256_RE.test(value.sha256), "invalid_unrelated_status");
  for (const entry of value.entries) {
    failUnless(exactKeys(entry, ["path", "status"]) && typeof entry.path === "string"
      && typeof entry.status === "string" && entry.status.length > 0, "invalid_unrelated_status");
  }
  validateSortedUniquePaths(value.entries.map((entry: JsonMap) => entry.path));
  failUnless(value.sha256 === hashCanonical(value.entries), "unrelated_status_changed");
}

function externalManifest(root: string, parentRelative: string): readonly JsonMap[] {
  const parent = containedPath(root, parentRelative);
  const manifest: JsonMap[] = [];
  const visit = (absoluteDirectory: string, relativeDirectory: string): void => {
    const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
      .sort((left, right) => compareCodePointPaths(left.name, right.name));
    for (const entry of entries) {
      if (entry.name === "__pycache__") continue;
      const relativePath = `${relativeDirectory}/${entry.name}`;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) manifest.push({ path: relativePath, type: "symlink", sha256: hashBytes(fs.readlinkSync(absolutePath)) });
      else if (stat.isDirectory()) {
        manifest.push({ path: relativePath, type: "directory", sha256: hashBytes("") });
        visit(absolutePath, relativePath);
      } else if (stat.isFile()) manifest.push({ path: relativePath, type: "file", sha256: hashBytes(fs.readFileSync(absolutePath)) });
      else manifest.push({ path: relativePath, type: "special", sha256: hashBytes("") });
    }
  };
  visit(parent, parentRelative);
  manifest.sort((left, right) => compareCodePointPaths(left.path, right.path));
  validateSortedUniquePaths(manifest.map((record) => record.path));
  return Object.freeze(manifest);
}

export function collectRootExternalDigests(root: string): readonly JsonMap[] {
  const parents = CACHE_ROOTS.map((cacheRoot) => cacheRoot.slice(0, cacheRoot.lastIndexOf("/")));
  const records = parents.map((parent) => Object.freeze({ path: parent, sha256: hashCanonical(externalManifest(root, parent)) }));
  records.sort((left, right) => compareCodePointPaths(left.path, right.path));
  validateSortedUniquePaths(records.map((record) => record.path));
  failUnless(records.length === CACHE_ROOTS.length && records.every((record) => SHA256_RE.test(record.sha256)),
    "invalid_root_external_digests");
  return Object.freeze(records);
}

function validateRootExternalDigests(value: unknown): void {
  failUnless(Array.isArray(value) && value.length === CACHE_ROOTS.length, "invalid_root_external_digests");
  for (const record of value) failUnless(exactKeys(record, ["path", "sha256"])
    && typeof record.path === "string" && typeof record.sha256 === "string" && SHA256_RE.test(record.sha256),
  "invalid_root_external_digests");
  validateSortedUniquePaths(value.map((record) => record.path));
}

function validateSuites(value: unknown): void {
  failUnless(Array.isArray(value) && value.length > 0, "invalid_suite");
  for (const suite of value) {
    failUnless(exactKeys(suite, ["name", "status", "selected", "sha256"])
      && typeof suite.name === "string" && suite.name.length > 0
      && suite.status === "PASS" && Number.isSafeInteger(suite.selected) && suite.selected > 0
      && typeof suite.sha256 === "string" && SHA256_RE.test(suite.sha256), "invalid_suite");
  }
  validateSortedUniquePaths(value.map((suite) => suite.name));
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function withoutSelfHash(value: JsonMap): JsonMap {
  const copy: JsonMap = {};
  for (const [key, item] of Object.entries(value)) if (key !== "receipt_sha256") copy[key] = item;
  return copy;
}

export function hashAuthorizedSet(inventory: PreCacheInventory): string {
  validateCacheInventory(inventory);
  return hashCanonical(inventory);
}

export function buildPreReceipt(input: {
  readonly root: string;
  readonly repoHead: string;
  readonly suites: readonly JsonMap[];
  readonly generatedSha256: string;
  readonly packSha256: string;
  readonly timestamp: string;
}): JsonMap {
  failUnless(COMMIT_RE.test(input.repoHead) && SHA256_RE.test(input.generatedSha256)
    && SHA256_RE.test(input.packSha256) && validTimestamp(input.timestamp), "invalid_receipt_input");
  validateSuites(input.suites);
  const inventory = buildTrackedProductionInventory(input.root, input.repoHead);
  const cache = collectPreCacheInventory(input.root);
  const receipt: JsonMap = {
    schema_version: "kcoderag-nav/pre-retirement-receipt@1",
    repo_head: input.repoHead,
    tracked_production_inventory: inventory,
    tracked_production_inventory_sha256: hashTrackedProductionInventory(inventory),
    suites: input.suites,
    generated_sha256: input.generatedSha256,
    pack_sha256: input.packSha256,
    timestamp: input.timestamp,
    pre_cache_inventory: cache,
    authorized_set_sha256: hashAuthorizedSet(cache),
    unrelated_status_before: collectUnrelatedStatus(input.root),
    root_external_digests_before: collectRootExternalDigests(input.root),
  };
  receipt.receipt_sha256 = hashCanonical(receipt);
  return Object.freeze(receipt);
}

export function verifyPreReceipt(value: unknown, root = process.cwd(), currentHead?: string): JsonMap {
  failUnless(exactKeys(value, RECEIPT_KEYS), "invalid_receipt_schema");
  failUnless(value.schema_version === "kcoderag-nav/pre-retirement-receipt@1", "invalid_receipt_schema");
  failUnless(typeof value.receipt_sha256 === "string" && SHA256_RE.test(value.receipt_sha256)
    && value.receipt_sha256 === hashCanonical(withoutSelfHash(value)), "invalid_receipt_hash");
  validateProductionInventory(value.tracked_production_inventory);
  failUnless(value.tracked_production_inventory_sha256
    === hashTrackedProductionInventory(value.tracked_production_inventory), "invalid_production_inventory_hash");
  validateSuites(value.suites);
  failUnless(typeof value.generated_sha256 === "string" && SHA256_RE.test(value.generated_sha256)
    && typeof value.pack_sha256 === "string" && SHA256_RE.test(value.pack_sha256)
    && validTimestamp(value.timestamp), "invalid_receipt_schema");
  validateCacheInventory(value.pre_cache_inventory);
  failUnless(value.authorized_set_sha256 === hashAuthorizedSet(value.pre_cache_inventory), "invalid_authorized_set_hash");
  validateUnrelatedStatus(value.unrelated_status_before);
  validateRootExternalDigests(value.root_external_digests_before);

  const head = currentHead ?? gitText(root, ["rev-parse", "HEAD"]);
  verifyProductionBaseline(value, head, root);
  failUnless(canonicalEqual(collectUnrelatedStatus(root), value.unrelated_status_before), "unrelated_status_changed");
  failUnless(canonicalEqual(collectRootExternalDigests(root), value.root_external_digests_before), "root_external_changed");

  const rootPresence = CACHE_ROOTS.map((cacheRoot) => fs.existsSync(containedPath(root, cacheRoot)));
  if (rootPresence.every(Boolean)) {
    let current: PreCacheInventory;
    try { current = collectPreCacheInventory(root); } catch { throw new RetirementAuditError("cache_inventory_changed"); }
    failUnless(canonicalEqual(current, value.pre_cache_inventory), "cache_inventory_changed");
  } else if (!rootPresence.every((present) => !present)) throw new RetirementAuditError("partial_cache_state");
  return value;
}

function pathExists(root: string, relativePath: string): boolean {
  return fs.existsSync(path.join(root, ...relativePath.split("/")));
}

function requirePresence(root: string, paths: readonly string[], expected: boolean): void {
  failUnless(paths.every((relativePath) => pathExists(root, relativePath) === expected), "retirement_mode_mismatch");
}

function scanFinalRuntime(root: string): void {
  requirePresence(root, ROOT_MARKETPLACE_PATHS, false);
  const runtimeRoots = ["plugin-src/hooks", "kcoderag-qa/hooks", "kcoderag-dev/hooks", "scripts"];
  const visit = (relativeRoot: string): void => {
    const absolute = path.join(root, ...relativeRoot.split("/"));
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const relative = `${relativeRoot}/${entry.name}`;
      if (entry.isDirectory()) visit(relative);
      else failUnless(!entry.name.endsWith(".py") && !entry.name.endsWith(".pyc") && !entry.name.endsWith(".pyo"),
        "python_runtime_remains");
    }
  };
  for (const runtimeRoot of runtimeRoots) visit(runtimeRoot);
  for (const document of [
    "README.md", "plugin-src/README.md.tmpl", "plugin-src/cursor/README.md.tmpl",
    "kcoderag-qa/README.md", "kcoderag-dev/README.md", "kcoderag-cursor/README.md",
  ]) {
    const absolute = path.join(root, ...document.split("/"));
    if (!fs.existsSync(absolute)) continue;
    const text = fs.readFileSync(absolute, "utf8");
    failUnless(!/(?:^|[\s`])python(?:3)?\s+[^\n`]+\.py\b|raw\.githubusercontent\.com|kcoderag-update\.json/imu.test(text),
      "retired_reference_remains");
  }
}

export function auditRetirement(root: string, mode: string): JsonMap {
  failUnless((["pre", "post-source", "post-scripts", "post-tests", "post"] as readonly string[]).includes(mode),
    "invalid_retirement_mode");
  const typedMode = mode as RetirementMode;
  if (typedMode === "pre") {
    requirePresence(root, SOURCE_RETIREMENT_PATHS, true);
    requirePresence(root, SCRIPT_RETIREMENT_PATHS, true);
    requirePresence(root, TEST_RETIREMENT_PATHS, true);
  } else if (typedMode === "post-source") {
    requirePresence(root, SOURCE_RETIREMENT_PATHS, false);
    requirePresence(root, SCRIPT_RETIREMENT_PATHS, true);
    requirePresence(root, TEST_RETIREMENT_PATHS, true);
  } else if (typedMode === "post-scripts") {
    requirePresence(root, SOURCE_RETIREMENT_PATHS, false);
    requirePresence(root, SCRIPT_RETIREMENT_PATHS, false);
    requirePresence(root, TEST_RETIREMENT_PATHS, true);
  } else {
    requirePresence(root, SOURCE_RETIREMENT_PATHS, false);
    requirePresence(root, SCRIPT_RETIREMENT_PATHS, false);
    requirePresence(root, TEST_RETIREMENT_PATHS, false);
    if (typedMode === "post") scanFinalRuntime(root);
  }
  return Object.freeze({
    schema_version: "kcoderag-nav/retirement-audit@1",
    mode: typedMode,
    source_remaining: SOURCE_RETIREMENT_PATHS.filter((item) => pathExists(root, item)).length,
    scripts_remaining: SCRIPT_RETIREMENT_PATHS.filter((item) => pathExists(root, item)).length,
    tests_remaining: TEST_RETIREMENT_PATHS.filter((item) => pathExists(root, item)).length,
  });
}

function runCommand(root: string, name: string, command: string, args: readonly string[], selectedPattern: RegExp): JsonMap {
  const result = childProcess.spawnSync(command, [...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  failUnless(result.status === 0, "parity_suite_failed");
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = selectedPattern.exec(output);
  failUnless(match !== null && Number(match[1]) > 0, "parity_suite_empty");
  return Object.freeze({ name, status: "PASS", selected: Number(match[1]), sha256: hashBytes(output) });
}

function writeCanonicalAtomic(filePath: string, value: unknown): void {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, canonicalJson(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, absolute);
    try { fs.chmodSync(absolute, 0o600); } catch { /* POSIX mode is unavailable on Windows. */ }
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
  }
}

function runParity(root: string, receiptPath: string): JsonMap {
  auditRetirement(root, "pre");
  const suites = [
    runCommand(root, "node", process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm",
      process.platform === "win32" ? ["/d", "/s", "/c", "npm test"] : ["test"], /(?:ℹ|#)\s*tests\s+(\d+)/u),
    runCommand(root, "python-dev-hook", "python", ["kcoderag-dev/hooks/test_grep_nudge.py"], /(\d+)\s+cases?\s+passed/iu),
    runCommand(root, "python-legacy", "python", ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], /Ran\s+(\d+)\s+tests?/iu),
    runCommand(root, "python-plugin-hook", "python", ["plugin-src/hooks/test_grep_nudge.py"], /(\d+)\s+cases?\s+passed/iu),
    runCommand(root, "python-qa-hook", "python", ["kcoderag-qa/hooks/test_grep_nudge.py"], /(\d+)\s+cases?\s+passed/iu),
  ].sort((left, right) => compareCodePointPaths(left.name, right.name));
  const generation = childProcess.spawnSync(process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm",
    process.platform === "win32" ? ["/d", "/s", "/c", "npm run generate:check"] : ["run", "generate:check"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  failUnless(generation.status === 0 && /"ok"\s*:\s*true/u.test(generation.stdout ?? ""), "parity_suite_failed");
  const pack = childProcess.spawnSync(process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm",
    process.platform === "win32" ? ["/d", "/s", "/c", "npm run pack:audit"] : ["run", "pack:audit"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  failUnless(pack.status === 0 && /"ok"\s*:\s*true/u.test(pack.stdout ?? ""), "parity_suite_failed");
  const receipt = buildPreReceipt({
    root,
    repoHead: gitText(root, ["rev-parse", "HEAD"]),
    suites,
    generatedSha256: hashBytes(`${generation.stdout ?? ""}\n${generation.stderr ?? ""}`),
    packSha256: hashBytes(`${pack.stdout ?? ""}\n${pack.stderr ?? ""}`),
    timestamp: new Date().toISOString(),
  });
  writeCanonicalAtomic(path.resolve(root, receiptPath), receipt);
  verifyPreReceipt(JSON.parse(fs.readFileSync(path.resolve(root, receiptPath), "utf8")) as unknown, root);
  return receipt;
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const root = path.resolve(__dirname, "../..");
    if (argv[0] === "--verify-pre-receipt" && argv.length === 2) {
      verifyPreReceipt(JSON.parse(fs.readFileSync(path.resolve(root, argv[1]!), "utf8")) as unknown, root);
      process.stdout.write(`${canonicalJson({ ok: true, mode: "verify-pre-receipt" })}\n`);
      return 0;
    }
    if (argv[0] === "--run-parity") {
      const modeIndex = argv.indexOf("--mode");
      const receiptIndex = argv.indexOf("--receipt");
      failUnless(modeIndex >= 0 && argv[modeIndex + 1] === "pre" && receiptIndex >= 0
        && typeof argv[receiptIndex + 1] === "string" && argv.length === 5, "invalid_arguments");
      runParity(root, argv[receiptIndex + 1]!);
      process.stdout.write(`${canonicalJson({ ok: true, mode: "pre", receipt: path.basename(argv[receiptIndex + 1]!) })}\n`);
      return 0;
    }
    const modeIndex = argv.indexOf("--mode");
    failUnless(modeIndex >= 0 && typeof argv[modeIndex + 1] === "string" && argv.length === 2, "invalid_arguments");
    process.stdout.write(`${canonicalJson({ ok: true, ...auditRetirement(root, argv[modeIndex + 1]!) })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof RetirementAuditError ? error.code : "retirement_audit_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

exports.RetirementAuditError = RetirementAuditError;
exports.CACHE_ROOT_COUNTS = CACHE_ROOT_COUNTS;
exports.CACHE_ROOTS = CACHE_ROOTS;
exports.canonicalJson = canonicalJson;
exports.compareCodePointPaths = compareCodePointPaths;
exports.validateSortedUniquePaths = validateSortedUniquePaths;
exports.hashBytes = hashBytes;
exports.hashCanonical = hashCanonical;
exports.buildTrackedProductionInventory = buildTrackedProductionInventory;
exports.hashTrackedProductionInventory = hashTrackedProductionInventory;
exports.verifyProductionBaseline = verifyProductionBaseline;
exports.collectPreCacheInventory = collectPreCacheInventory;
exports.collectUnrelatedStatus = collectUnrelatedStatus;
exports.collectRootExternalDigests = collectRootExternalDigests;
exports.hashAuthorizedSet = hashAuthorizedSet;
exports.buildPreReceipt = buildPreReceipt;
exports.verifyPreReceipt = verifyPreReceipt;
exports.auditRetirement = auditRetirement;
exports.main = main;

if (require.main === module) process.exitCode = main();
