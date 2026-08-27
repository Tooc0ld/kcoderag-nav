#!/usr/bin/env node
/** Exact, local-only audit of the npm tarball that users install. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const brandAudit = require("./brand-audit.cjs") as typeof import("./brand-audit.cjs");
const releaseReadiness = require("./release-readiness.cjs") as typeof import("./release-readiness.cjs");
const tarArchive = require("./tar-archive.cjs") as typeof import("./tar-archive.cjs");

import type { CandidatePackageArtifactLease } from "./release-readiness.cjs";

type JsonMap = Record<string, any>;

export interface PackAuditResult {
  readonly version: string;
  readonly entryCount: number;
  readonly statusPreserved: boolean;
  readonly treePreserved: boolean;
}

export interface PackAuditArtifactResult extends PackAuditResult {
  readonly artifactSha256: string;
  readonly memberCount: number;
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
  "dist/capabilities/registry.cjs",
  "dist/cli/commands.cjs",
  "dist/core/mcp-endpoint.cjs",
  "dist/core/mutation-lock.cjs",
  "dist/core/project-root.cjs",
  "dist/core/transaction.cjs",
  "dist/hooks/code-style-nudge.cjs",
  "dist/hooks/once-marker.cjs",
  "dist/hooks/pre-tool-dispatcher.cjs",
  "dist/hooks/session-cleanup.cjs",
  "dist/hosts/codex.cjs",
  "dist/hosts/claude.cjs",
  "dist/hosts/cursor.cjs",
  "dist/hosts/opencode.cjs",
  "dist/hosts/zcode.cjs",
  "dist/hosts/user-sources.cjs",
  "kcoderag-qa/.codex.mcp.json",
  "kcoderag-qa/.mcp.json",
  "kcoderag-qa/hooks/grep-nudge.cjs",
  "kcoderag-qa/hooks/mcp-call-marker.cjs",
  "kcoderag-qa/hooks/update-check.cjs",
  "kcoderag-qa/hooks/update-notice.cjs",
  "kcoderag-qa/hooks/update-worker.cjs",
  "kcoderag-qa/hooks/run_hook.cmd",
  "kcoderag-qa/hooks/run_hook.sh",
  "kcoderag-qa/hooks/run_marker.cmd",
  "kcoderag-qa/hooks/run_marker.sh",
  "kcoderag-qa/hooks/hooks.json",
  "kcoderag-qa/opencode/kcoderag-nav.js",
  "kcoderag-qa/skills/code-lookup-discipline/SKILL.md",
  "kcoderag-cursor/.cursor-plugin/plugin.json",
  "kcoderag-cursor/mcp.json",
  "kcoderag-cursor/rules/kcoderag-navigation.mdc",
  "kcoderag-cursor/skills/code-lookup-discipline/SKILL.md",
  "plugin-src/capabilities/code-style-nudge/skill/SKILL.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/change-hygiene-self-review.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/cpp-lifetime-control-flow.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/lua-contracts.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/protocol-serialization-data.md",
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
  "scripts/",
  "src/",
  "tests/",
]);

export const NON_PUBLISHED_COMPILED_OUTPUTS = Object.freeze([
  "dist/fixtures/host-delivery.cjs",
  "dist/maintainer/head-acceptance.cjs",
  "dist/maintainer/github-artifact-upload.cjs",
  "dist/maintainer/pre-release-evidence.cjs",
  "dist/maintainer/readiness-seal.cjs",
  "dist/maintainer/release-readiness.cjs",
  "dist/maintainer/readiness-workflow.cjs",
  "dist/maintainer/retirement-audit.cjs",
  "dist/maintainer/scrub-baseline.cjs",
]);

const NON_PUBLISHED_COMPILED_OUTPUT_SET = new Set<string>(NON_PUBLISHED_COMPILED_OUTPUTS);
const RETIRED_PRODUCT_DIRECTORY = "kcoderag-dev";
const ROOT_MARKETPLACE_PATHS = new Set([
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
]);

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

interface PackAuditDependencies {
  readonly scanTarball?: typeof brandAudit.scanTarball;
}

interface PackArtifactDependencies {
  readonly observeCandidateBytes?: (bytes: Buffer) => void;
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
    ROOT_MARKETPLACE_PATHS.has(lower)
    ||
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

function archiveFileEntries(tarballBytes: Buffer): ReadonlyMap<string, Buffer> {
  try {
    const entries = new Map<string, Buffer>();
    for (const entry of tarArchive.readTarArchive(tarballBytes)) {
      if (entry.type === "file") entries.set(entry.path, Buffer.from(entry.body));
    }
    return entries;
  } catch (error) {
    if (error instanceof tarArchive.TarArchiveError) throw new PackAuditError("tar_invalid");
    throw error;
  }
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

/** Validate a readiness-owned archive snapshot without packing or reopening its private path. */
export function auditPackArtifact(
  lease: CandidatePackageArtifactLease,
  options: { readonly root: string },
  dependencies: PackArtifactDependencies = {},
): PackAuditArtifactResult {
  const root = path.resolve(options.root);
  const before = repositorySnapshot(root);
  let completed: PackAuditArtifactResult | undefined;
  let failure: unknown;
  try {
    const packageJson = parseJson(fs.readFileSync(path.join(root, "package.json")), "package_manifest_invalid");
    const expectedPaths = expandPackageFiles(root, packageJson);
    completed = releaseReadiness.withCandidatePackageBytes(lease, "pack-audit", (bytes, artifact) => {
      dependencies.observeCandidateBytes?.(bytes);
      const archiveEntries = archiveFileEntries(bytes);
      const validated = validatePack({ packageJson, expectedPaths, archiveEntries });
      if (validated.version !== artifact.version || archiveEntries.size !== artifact.memberCount) {
        throw new PackAuditError("artifact_metadata_drift");
      }
      return Object.freeze({
        ...validated,
        artifactSha256: artifact.sha256,
        memberCount: artifact.memberCount,
        statusPreserved: true,
        treePreserved: true,
      });
    });
  } catch (error) {
    failure = error;
  }
  const after = repositorySnapshot(root);
  const statusPreserved = before.status.equals(after.status);
  const treePreserved = before.tree === after.tree;
  if (!statusPreserved) throw new PackAuditError("repository_status_mutated");
  if (!treePreserved) throw new PackAuditError("repository_tree_mutated");
  if (failure !== undefined) {
    if (failure instanceof releaseReadiness.CandidatePackageArtifactError) {
      throw new PackAuditError(failure.code);
    }
    throw failure;
  }
  if (completed === undefined) throw new PackAuditError("pack_audit_failed");
  return Object.freeze({ ...completed, statusPreserved, treePreserved });
}

/** Build and inspect a real local tarball without publishing or changing the repository. */
export function auditPack(
  options: { readonly root: string },
  dependencies: PackAuditDependencies = {},
): PackAuditResult {
  const root = path.resolve(options.root);
  const before = repositorySnapshot(root);
  let completed: { readonly version: string; readonly entryCount: number } | undefined;
  let failure: unknown;
  let lease: CandidatePackageArtifactLease | undefined;
  try {
    runNpm(root, ["run", "deps:audit"]);
    lease = releaseReadiness.createCandidatePackageArtifact({
      root,
      consumers: ["pack-audit", "tar-scan"],
    });
    const packed = auditPackArtifact(lease, { root });
    releaseReadiness.scanCandidatePackageArtifact(lease, {
      ...(dependencies.scanTarball === undefined ? {} : { scanTarball: dependencies.scanTarball }),
    });
    completed = Object.freeze({ version: packed.version, entryCount: packed.entryCount });
  } catch (error) {
    failure = error;
  } finally {
    try { lease?.dispose(); } catch (error) { if (failure === undefined) failure = error; }
  }
  const after = repositorySnapshot(root);
  const statusPreserved = before.status.equals(after.status);
  const treePreserved = before.tree === after.tree;
  if (!statusPreserved) throw new PackAuditError("repository_status_mutated");
  if (!treePreserved) throw new PackAuditError("repository_tree_mutated");
  if (failure !== undefined) {
    if (failure instanceof releaseReadiness.CandidatePackageArtifactError) {
      throw new PackAuditError(failure.code);
    }
    throw failure;
  }
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
exports.auditPackArtifact = auditPackArtifact;
exports.expandPackageFiles = expandPackageFiles;
exports.main = main;
exports.validatePack = validatePack;

if (require.main === module) {
  process.exitCode = main();
}
