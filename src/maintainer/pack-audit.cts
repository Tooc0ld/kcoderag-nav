#!/usr/bin/env node
/** Exact, local-only audit of the npm tarball that users install. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const zlib = require("node:zlib") as typeof import("node:zlib");

type JsonMap = Record<string, any>;

export interface PackAuditResult {
  readonly version: string;
  readonly entryCount: number;
  readonly statusPreserved: boolean;
  readonly treePreserved: boolean;
}

export class PackAuditError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "PackAuditError";
    this.code = code;
  }
}

const REQUIRED_ASSETS = Object.freeze([
  "dist/bin/kcoderag-nav.cjs",
  "dist/cli/commands.cjs",
  "dist/core/project-root.cjs",
  "dist/core/transaction.cjs",
  "dist/hosts/codex.cjs",
  "dist/hosts/claude.cjs",
  "dist/hosts/cursor.cjs",
  "dist/hosts/user-sources.cjs",
  "kcoderag-qa/.codex.mcp.json",
  "kcoderag-qa/.mcp.json",
  "kcoderag-qa/hooks/grep-nudge.cjs",
  "kcoderag-qa/hooks/update-check.cjs",
  "kcoderag-qa/hooks/update-worker.cjs",
  "kcoderag-qa/hooks/run_hook.cmd",
  "kcoderag-qa/hooks/run_hook.sh",
  "kcoderag-qa/hooks/hooks.json",
  "kcoderag-qa/skills/code-lookup-discipline/SKILL.md",
  "kcoderag-cursor/.cursor-plugin/plugin.json",
  "kcoderag-cursor/mcp.json",
  "kcoderag-cursor/rules/kcoderag-navigation.mdc",
  "kcoderag-cursor/skills/code-lookup-discipline/SKILL.md",
]);

const VERSION_MANIFESTS = Object.freeze([
  "kcoderag-qa/.codex-plugin/plugin.json",
  "kcoderag-qa/.claude-plugin/plugin.json",
  "kcoderag-cursor/.cursor-plugin/plugin.json",
]);

const FORBIDDEN_PREFIXES = Object.freeze([
  ".git/",
  ".github/",
  ".planning/",
  "credential-fixtures/",
  "dist-tests/",
  "node_modules/",
  "plugin-src/",
  "scripts/",
  "src/",
  "tests/",
]);

export const NON_PUBLISHED_COMPILED_OUTPUTS = Object.freeze([
  "dist/maintainer/pre-release-evidence.cjs",
  "dist/maintainer/retirement-audit.cjs",
]);

const NON_PUBLISHED_COMPILED_OUTPUT_SET = new Set<string>(NON_PUBLISHED_COMPILED_OUTPUTS);
const RETIRED_PRODUCT_DIRECTORY = "kcoderag-dev";

const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const GLOB_RE = /[*?\[\]{}]/u;
const CREDENTIAL_SENTINEL = Buffer.concat([
  Buffer.from("KCODERAG_PACK_", "ascii"),
  Buffer.from("CREDENTIAL_FIXTURE", "ascii"),
]);

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRelative(relativePath: string): string {
  const value = relativePath.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    value.length === 0
    || value.startsWith("/")
    || value.includes("\0")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
    || path.posix.normalize(value) !== value
  ) {
    throw new PackAuditError("files_policy_invalid");
  }
  return value;
}

function assertNotRetiredProductPath(relativePath: string): void {
  const lower = relativePath.toLowerCase();
  if (lower === RETIRED_PRODUCT_DIRECTORY || lower.startsWith(`${RETIRED_PRODUCT_DIRECTORY}/`)) {
    throw new PackAuditError("retired_product");
  }
}

function walkFiles(root: string, relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(root, ...relativeDirectory.split("/"));
  const output: string[] = [];
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new PackAuditError("files_policy_invalid");
    }
    if (entry.isDirectory()) output.push(...walkFiles(root, relativePath));
    else if (fs.statSync(absolutePath).isFile()) output.push(relativePath);
  }
  return output;
}

function compiledOutputPaths(root: string): readonly string[] {
  return Object.freeze(
    walkFiles(root, "src")
      .filter((relativePath) => relativePath.endsWith(".cts"))
      .map((relativePath) => `dist/${relativePath.slice("src/".length, -".cts".length)}.cjs`)
      .sort(compare),
  );
}

function assertNoNonPublishedCompiledOutputs(paths: readonly string[]): void {
  if (paths.some((relativePath) => NON_PUBLISHED_COMPILED_OUTPUT_SET.has(relativePath))) {
    throw new PackAuditError("non_publishable_compiled_output");
  }
}

function declaredPackagePaths(packageJson: JsonMap): readonly string[] {
  if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) {
    throw new PackAuditError("files_policy_invalid");
  }
  const paths = new Set<string>(["README.md", "package.json"]);
  for (const raw of packageJson.files as unknown[]) {
    if (typeof raw !== "string" || GLOB_RE.test(raw)) {
      throw new PackAuditError("files_policy_invalid");
    }
    const directory = raw.endsWith("/");
    const relativePath = normalizeRelative(directory ? raw.slice(0, -1) : raw);
    assertNotRetiredProductPath(relativePath);
    if (directory) throw new PackAuditError("files_policy_invalid");
    assertNoNonPublishedCompiledOutputs([relativePath]);
    if (paths.has(relativePath)) throw new PackAuditError("files_policy_invalid");
    paths.add(relativePath);
  }
  return Object.freeze([...paths].sort(compare));
}

function assertCompiledOutputPolicy(root: string, packageJson: JsonMap): void {
  const expected = compiledOutputPaths(root);
  if (NON_PUBLISHED_COMPILED_OUTPUTS.some((relativePath) => !expected.includes(relativePath))) {
    throw new PackAuditError("compiled_output_drift");
  }
  const publishable = expected.filter((relativePath) => !NON_PUBLISHED_COMPILED_OUTPUT_SET.has(relativePath));
  const declared = declaredPackagePaths(packageJson).filter((relativePath) => relativePath.startsWith("dist/"));
  if (
    declared.length !== publishable.length ||
    declared.some((relativePath, index) => relativePath !== publishable[index])
  ) {
    throw new PackAuditError("files_policy_invalid");
  }
  const actual = walkFiles(root, "dist").sort(compare);
  if (
    actual.length !== expected.length ||
    actual.some((relativePath, index) => relativePath !== expected[index])
  ) {
    throw new PackAuditError("compiled_output_drift");
  }
}

/** Expand the exact package allow-list to ordinary paths before npm packing. */
export function expandPackageFiles(root: string, packageJson: JsonMap): readonly string[] {
  assertCompiledOutputPolicy(root, packageJson);
  const paths = declaredPackagePaths(packageJson);
  for (const relativePath of paths) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    if (!fs.existsSync(absolutePath)) throw new PackAuditError("files_entry_missing");
    const metadata = fs.lstatSync(absolutePath);
    if (metadata.isSymbolicLink()) throw new PackAuditError("files_policy_invalid");
    if (!metadata.isFile()) throw new PackAuditError("files_policy_invalid");
  }
  return paths;
}

function forbiddenArchivePath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return (
    FORBIDDEN_PREFIXES.some((prefix) => lower.startsWith(prefix))
    || lower.endsWith(".py")
    || lower.endsWith(".pyc")
    || lower.endsWith(".ts")
    || lower.endsWith(".cts")
  );
}

function hasUnresolvedPlaceholder(bytes: Buffer): boolean {
  const open = Buffer.from([0x7b, 0x7b]);
  const close = Buffer.from([0x7d, 0x7d]);
  let cursor = 0;
  while (cursor < bytes.length) {
    const start = bytes.indexOf(open, cursor);
    if (start < 0) return false;
    const end = bytes.indexOf(close, start + open.length);
    if (end >= 0 && end - start <= 256) return true;
    cursor = start + open.length;
  }
  return false;
}

function parseJson(bytes: Buffer, code: string): JsonMap {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("not_object");
    }
    return value as JsonMap;
  } catch {
    throw new PackAuditError(code);
  }
}

/** Validate exact tar entries without returning archive contents or credential-bearing values. */
export function validatePack(input: {
  readonly packageJson: JsonMap;
  readonly expectedPaths: readonly string[];
  readonly archiveEntries: ReadonlyMap<string, Buffer>;
}): { readonly version: string; readonly entryCount: number } {
  const { packageJson, expectedPaths, archiveEntries } = input;
  if (packageJson.name !== "kcoderag-nav" || !SEMVER_RE.test(packageJson.version)) {
    throw new PackAuditError("package_contract_drift");
  }
  if (packageJson.engines?.node !== ">=22") throw new PackAuditError("engine_drift");
  if (
    packageJson.bin === null
    || typeof packageJson.bin !== "object"
    || Array.isArray(packageJson.bin)
    || packageJson.bin["kcoderag-nav"] !== "dist/bin/kcoderag-nav.cjs"
  ) {
    throw new PackAuditError("bin_drift");
  }

  const declaredPaths = declaredPackagePaths(packageJson);
  const expected = expectedPaths.map(normalizeRelative).sort(compare);
  for (const relativePath of expected) assertNotRetiredProductPath(relativePath);
  if (new Set(expected).size !== expected.length) throw new PackAuditError("archive_path_drift");
  assertNoNonPublishedCompiledOutputs(expected);
  if (
    declaredPaths.length !== expected.length
    || declaredPaths.some((relativePath, index) => relativePath !== expected[index])
  ) {
    throw new PackAuditError("archive_path_drift");
  }

  const actualPaths = [...archiveEntries.keys()].sort(compare);
  for (const relativePath of actualPaths) assertNotRetiredProductPath(relativePath);
  assertNoNonPublishedCompiledOutputs(actualPaths);
  for (const relativePath of actualPaths) {
    if (forbiddenArchivePath(relativePath)) throw new PackAuditError("forbidden_archive_path");
  }
  if (
    expected.length !== actualPaths.length
    || expected.some((relativePath, index) => relativePath !== actualPaths[index])
  ) {
    throw new PackAuditError("archive_path_drift");
  }
  for (const required of REQUIRED_ASSETS) {
    if (!archiveEntries.has(required)) throw new PackAuditError("missing_self_contained_asset");
  }
  if (!archiveEntries.has("dist/bin/kcoderag-nav.cjs")) throw new PackAuditError("bin_drift");

  for (const [relativePath, bytes] of archiveEntries) {
    if (bytes.indexOf(CREDENTIAL_SENTINEL) >= 0) {
      throw new PackAuditError("credential_fixture_in_archive");
    }
    // The compiled generator intentionally contains template-token logic; only rendered/user
    // assets are required to be token-free in the archive.
    if (relativePath !== "dist/generator/index.cjs" && hasUnresolvedPlaceholder(bytes)) {
      throw new PackAuditError("unresolved_placeholder");
    }
  }

  const packedPackageBytes = archiveEntries.get("package.json");
  if (packedPackageBytes === undefined) throw new PackAuditError("archive_path_drift");
  const packedPackage = parseJson(packedPackageBytes, "package_manifest_invalid");
  if (packedPackage.name !== packageJson.name || packedPackage.version !== packageJson.version) {
    throw new PackAuditError("version_drift");
  }
  for (const manifestPath of VERSION_MANIFESTS) {
    const bytes = archiveEntries.get(manifestPath);
    if (bytes === undefined) throw new PackAuditError("missing_self_contained_asset");
    if (parseJson(bytes, "manifest_invalid").version !== packageJson.version) {
      throw new PackAuditError("version_drift");
    }
  }
  return Object.freeze({ version: packageJson.version, entryCount: actualPaths.length });
}

function parseOctal(bytes: Buffer): number {
  const value = bytes.toString("ascii").replace(/\0.*$/u, "").trim();
  if (!/^[0-7]*$/u.test(value)) throw new PackAuditError("tar_invalid");
  return value.length === 0 ? 0 : Number.parseInt(value, 8);
}

function tarString(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString("utf8");
}

function parsePaxPath(bytes: Buffer): string | undefined {
  let offset = 0;
  let found: string | undefined;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space < 0) break;
    const length = Number.parseInt(bytes.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > bytes.length) break;
    const record = bytes.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0 && record.slice(0, equals) === "path") found = record.slice(equals + 1);
    offset += length;
  }
  return found;
}

function stripPackageRoot(value: string): string {
  if (!value.startsWith("package/")) throw new PackAuditError("tar_invalid");
  return normalizeRelative(value.slice("package/".length));
}

function readTarEntries(tarball: string): ReadonlyMap<string, Buffer> {
  let tar: Buffer;
  try {
    tar = zlib.gunzipSync(fs.readFileSync(tarball));
  } catch {
    throw new PackAuditError("tar_invalid");
  }
  const entries = new Map<string, Buffer>();
  let offset = 0;
  let pendingPath: string | undefined;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header.subarray(0, 100));
    const prefix = tarString(header.subarray(345, 500));
    const headerPath = prefix.length > 0 ? `${prefix}/${name}` : name;
    const size = parseOctal(header.subarray(124, 136));
    const type = header[156] ?? 0;
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) throw new PackAuditError("tar_invalid");
    const body = tar.subarray(bodyStart, bodyEnd);
    if (type === 0x78) {
      pendingPath = parsePaxPath(body) ?? pendingPath;
    } else if (type === 0x4c) {
      pendingPath = tarString(body);
    } else if (type === 0 || type === 0x30) {
      const relativePath = stripPackageRoot(pendingPath ?? headerPath);
      if (entries.has(relativePath)) throw new PackAuditError("tar_invalid");
      entries.set(relativePath, Buffer.from(body));
      pendingPath = undefined;
    } else if (type !== 0x35) {
      throw new PackAuditError("tar_invalid");
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function npmInvocation(): { executable: string; prefix: readonly string[] } {
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
    ? { executable: process.platform === "win32" ? "npm.cmd" : "npm", prefix: [] }
    : { executable: process.execPath, prefix: [cli] };
}

function runNpm(root: string, args: readonly string[], capture = false): Buffer {
  const invocation = npmInvocation();
  const result = childProcess.spawnSync(invocation.executable, [...invocation.prefix, ...args], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", capture ? "pipe" : "ignore", "ignore"],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new PackAuditError("npm_command_failed");
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
}

function gitBytes(root: string, args: readonly string[]): Buffer {
  const result = childProcess.spawnSync("git", args, {
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) throw new PackAuditError("git_inspection_failed");
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
}

function repositorySnapshot(root: string): { readonly status: Buffer; readonly tree: string } {
  const status = gitBytes(root, ["status", "--short", "--untracked-files=all"]);
  const listed = gitBytes(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter((value) => value.length > 0)
    .map((value) => normalizeRelative(value))
    // GSD owns these volatile, unrelated execution records while this plan is running. Their
    // path presence remains covered by the exact status snapshot, but their mutable bytes are
    // not part of the npm source/product tree digest.
    .filter((value) => value !== ".planning/milestone.lock" && !value.startsWith(".gsd/"))
    .sort(compare);
  const digest = crypto.createHash("sha256");
  for (const relativePath of listed) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const metadata = fs.lstatSync(absolutePath);
    digest.update(relativePath, "utf8");
    digest.update("\0", "ascii");
    if (metadata.isSymbolicLink()) digest.update(fs.readlinkSync(absolutePath), "utf8");
    else if (metadata.isFile()) digest.update(fs.readFileSync(absolutePath));
    else throw new PackAuditError("tree_entry_invalid");
    digest.update("\0", "ascii");
  }
  return Object.freeze({ status, tree: digest.digest("hex") });
}

function npmPackFileList(stdout: Buffer): { readonly filename: string; readonly paths: readonly string[] } {
  let value: unknown;
  try {
    value = JSON.parse(stdout.toString("utf8"));
  } catch {
    throw new PackAuditError("pack_manifest_invalid");
  }
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== "object" || value[0] === null) {
    throw new PackAuditError("pack_manifest_invalid");
  }
  const record = value[0] as JsonMap;
  if (typeof record.filename !== "string" || !Array.isArray(record.files)) {
    throw new PackAuditError("pack_manifest_invalid");
  }
  const paths = record.files.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || typeof (entry as JsonMap).path !== "string") {
      throw new PackAuditError("pack_manifest_invalid");
    }
    return normalizeRelative((entry as JsonMap).path);
  }).sort(compare);
  return Object.freeze({ filename: path.basename(record.filename), paths: Object.freeze(paths) });
}

/** Build and inspect a real local tarball without publishing or changing the repository. */
export function auditPack(options: { readonly root: string }): PackAuditResult {
  const root = path.resolve(options.root);
  const before = repositorySnapshot(root);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-pack-audit-"));
  let completed: { readonly version: string; readonly entryCount: number } | undefined;
  let failure: unknown;
  try {
    const packageJson = parseJson(fs.readFileSync(path.join(root, "package.json")), "package_manifest_invalid");
    const expectedPaths = expandPackageFiles(root, packageJson);
    runNpm(root, ["run", "deps:audit"]);
    runNpm(root, ["run", "generate:check"]);
    const packed = npmPackFileList(runNpm(root, [
      "pack",
      root,
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      temporary,
    ], true));
    const tarball = path.join(temporary, packed.filename);
    const archiveEntries = readTarEntries(tarball);
    const archivePaths = [...archiveEntries.keys()].sort(compare);
    assertNoNonPublishedCompiledOutputs(packed.paths);
    if (
      packed.paths.length !== archivePaths.length
      || packed.paths.some((relativePath, index) => relativePath !== archivePaths[index])
    ) {
      throw new PackAuditError("pack_manifest_drift");
    }
    completed = validatePack({ packageJson, expectedPaths, archiveEntries });
  } catch (error) {
    failure = error;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  const after = repositorySnapshot(root);
  const statusPreserved = before.status.equals(after.status);
  const treePreserved = before.tree === after.tree;
  if (!statusPreserved) throw new PackAuditError("repository_status_mutated");
  if (!treePreserved) throw new PackAuditError("repository_tree_mutated");
  if (failure !== undefined) throw failure;
  if (completed === undefined) throw new PackAuditError("pack_audit_failed");
  return Object.freeze({ ...completed, statusPreserved, treePreserved });
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length !== 0) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "invalid_arguments" })}\n`);
    return 2;
  }
  try {
    const outcome = auditPack({ root: path.resolve(__dirname, "../..") });
    process.stdout.write(`${JSON.stringify({ ok: true, version: outcome.version, entries: outcome.entryCount })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof PackAuditError ? error.code : "pack_audit_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

exports.PackAuditError = PackAuditError;
exports.NON_PUBLISHED_COMPILED_OUTPUTS = NON_PUBLISHED_COMPILED_OUTPUTS;
exports.auditPack = auditPack;
exports.expandPackageFiles = expandPackageFiles;
exports.main = main;
exports.validatePack = validatePack;

if (require.main === module) {
  process.exitCode = main();
}
