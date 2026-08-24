#!/usr/bin/env node
/** Exact-write-set release preparation. Publication remains a separate tag workflow. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

type ReleaseLevel = "patch" | "minor" | "major";
type JsonMap = Record<string, any>;

interface GenerationEvidence {
  readonly ok: boolean;
  readonly changedPaths: readonly string[];
  readonly writtenPaths: readonly string[];
}

interface ReleaseOptions {
  readonly root: string;
  readonly level: ReleaseLevel;
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly runGates?: (root: string) => void;
  readonly runGenerator?: (input: { readonly root: string; readonly check: boolean }) => GenerationEvidence;
  /** Deterministic post-ref-update failure seam used by recovery tests. */
  readonly failAfter?: "commit" | "tag";
}

interface ReleaseResult {
  readonly ok: true;
  readonly dryRun: boolean;
  readonly previousVersion: string;
  readonly version: string;
  readonly tag: string;
  readonly commit: string | null;
  readonly releasePaths: readonly string[];
}

export const VERSION_MANIFEST_PATHS = Object.freeze([
  "kcoderag-qa/.codex-plugin/plugin.json",
  "kcoderag-qa/.claude-plugin/plugin.json",
  "kcoderag-dev/.codex-plugin/plugin.json",
  "kcoderag-dev/.claude-plugin/plugin.json",
  "kcoderag-cursor/.cursor-plugin/plugin.json",
]);

export const RELEASE_OWNED_PATHS = Object.freeze([
  "package.json",
  "package-lock.json",
  ...VERSION_MANIFEST_PATHS,
]);

const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const SHA_RE = /^[0-9a-f]{40}$/u;

export class ReleaseError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReleaseError";
    this.code = code;
  }
}

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ReleaseError(code);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort(compareCodeUnits);
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  return sorted(actual).join("\0") === sorted(expected).join("\0");
}

function git(root: string, args: readonly string[], allowFailure = false): string {
  const result = childProcess.spawnSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    if (allowFailure) return "";
    throw new ReleaseError("git_failed");
  }
  return result.stdout.trim();
}

function readJson(filePath: string): JsonMap {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    failUnless(typeof value === "object" && value !== null && !Array.isArray(value), "invalid_json");
    return value as JsonMap;
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError("invalid_json");
  }
}

function writeJson(filePath: string, value: JsonMap): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeRoot(root: string): string {
  const resolved = fs.realpathSync(path.resolve(root));
  // Git owns repository-root discovery and avoids Windows short-path, casing, and junction aliases.
  failUnless(git(resolved, ["rev-parse", "--show-prefix"]) === "", "invalid_repository_root");
  return resolved;
}

function isIgnoredLocalState(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return normalized === ".gsd" || normalized.startsWith(".gsd/")
    || normalized === ".planning" || normalized.startsWith(".planning/");
}

function statusEntries(root: string): readonly string[] {
  const raw = childProcess.execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const records = raw.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    failUnless(record.length >= 4, "invalid_git_status");
    paths.push(record.slice(3));
    if (record[0] === "R" || record[0] === "C" || record[1] === "R" || record[1] === "C") {
      const renamedFrom = records[index + 1];
      failUnless(renamedFrom !== undefined, "invalid_git_status");
      paths.push(renamedFrom);
      index += 1;
    }
  }
  return Object.freeze(paths);
}

function assertCleanReleaseSurface(root: string): void {
  failUnless(statusEntries(root).every(isIgnoredLocalState), "dirty_worktree");
  failUnless(git(root, ["diff", "--cached", "--name-only"]).length === 0, "dirty_index");
}

function releaseSurfaceDiffPaths(root: string): readonly string[] {
  return Object.freeze(
    git(root, ["diff", "--name-only"])
      .split(/\r?\n/u)
      .filter((relativePath) => relativePath.length > 0 && !isIgnoredLocalState(relativePath)),
  );
}

function digestLocalState(root: string): string {
  const hash = crypto.createHash("sha256");
  const visit = (relativePath: string): void => {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    let entries: import("node:fs").Dirent[];
    try {
      entries = fs.readdirSync(absolutePath, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        hash.update(`missing\0${relativePath}\0`);
        return;
      }
      throw error;
    }
    hash.update(`directory\0${relativePath}\0`);
    for (const entry of entries.sort((left, right) => compareCodeUnits(left.name, right.name))) {
      const child = `${relativePath}/${entry.name}`;
      const childAbsolute = path.join(absolutePath, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) {
        hash.update(`file\0${child}\0`);
        hash.update(fs.readFileSync(childAbsolute));
        hash.update("\0");
      } else if (entry.isSymbolicLink()) {
        hash.update(`symlink\0${child}\0${fs.readlinkSync(childAbsolute)}\0`);
      } else hash.update(`special\0${child}\0`);
    }
  };
  visit(".gsd");
  visit(".planning");
  return hash.digest("hex");
}

function currentVersion(root: string): string {
  const packageJson = readJson(path.join(root, "package.json"));
  failUnless(packageJson.name === "kcoderag-nav" && typeof packageJson.version === "string", "invalid_package");
  failUnless(VERSION_RE.test(packageJson.version), "invalid_version");
  const packageLock = readJson(path.join(root, "package-lock.json"));
  failUnless(
    packageLock.name === "kcoderag-nav"
      && packageLock.version === packageJson.version
      && packageLock.packages?.[""]?.version === packageJson.version,
    "version_drift",
  );
  for (const manifest of VERSION_MANIFEST_PATHS) {
    failUnless(readJson(path.join(root, ...manifest.split("/"))).version === packageJson.version, "version_drift");
  }
  return packageJson.version;
}

function bumpVersion(version: string, level: ReleaseLevel): string {
  const match = VERSION_RE.exec(version);
  failUnless(match !== null, "invalid_version");
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (level === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === "minor") {
    minor += 1;
    patch = 0;
  } else patch += 1;
  return `${major}.${minor}.${patch}`;
}

function assertTagAbsent(root: string, tag: string): void {
  failUnless(git(root, ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], true) === "", "tag_exists");
}

function defaultRunGenerator(input: { readonly root: string; readonly check: boolean }): GenerationEvidence {
  const args = [
    path.join(input.root, "dist", "generator", "index.cjs"),
    "--package", "all",
    "--group", input.check ? "all" : "version",
    ...(input.check ? ["--check"] : []),
  ];
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: input.root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  failUnless(result.status === 0, input.check ? "generation_drift" : "generator_failed");
  try {
    const evidence = JSON.parse(result.stdout) as GenerationEvidence;
    failUnless(evidence.ok === true && Array.isArray(evidence.changedPaths) && Array.isArray(evidence.writtenPaths), "generator_failed");
    return evidence;
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError("generator_failed");
  }
}

function defaultRunGates(root: string): void {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm run ci:local"]
    : ["run", "ci:local"];
  const result = childProcess.spawnSync(executable, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new ReleaseError("gate_failed");
}

function updatePackageVersions(root: string, version: string): void {
  const packagePath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  const packageJson = readJson(packagePath);
  const packageLock = readJson(lockPath);
  packageJson.version = version;
  packageLock.version = version;
  failUnless(typeof packageLock.packages === "object" && packageLock.packages !== null, "invalid_lockfile");
  failUnless(typeof packageLock.packages[""] === "object" && packageLock.packages[""] !== null, "invalid_lockfile");
  packageLock.packages[""].version = version;
  writeJson(packagePath, packageJson);
  writeJson(lockPath, packageLock);
}

function snapshotReleaseFiles(root: string): ReadonlyMap<string, Buffer> {
  return new Map(RELEASE_OWNED_PATHS.map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(root, ...relativePath.split("/"))),
  ]));
}

function restoreReleaseFiles(root: string, snapshot: ReadonlyMap<string, Buffer>): void {
  for (const [relativePath, bytes] of snapshot) {
    fs.writeFileSync(path.join(root, ...relativePath.split("/")), bytes);
  }
  childProcess.spawnSync("git", ["restore", "--staged", "--", ...RELEASE_OWNED_PATHS], {
    cwd: root,
    stdio: "ignore",
  });
}

function compensateReleaseRefs(
  root: string,
  originalHead: string,
  releaseCommit: string,
  tag: string,
  snapshot: ReadonlyMap<string, Buffer>,
): void {
  const currentHead = git(root, ["rev-parse", "HEAD"], true);
  const tagTarget = git(root, ["rev-list", "-n", "1", tag], true);
  failUnless(
    currentHead === releaseCommit && (tagTarget === "" || tagTarget === releaseCommit),
    "release_recovery_conflict",
  );
  if (tagTarget === releaseCommit) git(root, ["tag", "-d", tag]);
  git(root, ["reset", "--mixed", originalHead]);
  restoreReleaseFiles(root, snapshot);
  failUnless(git(root, ["rev-parse", "HEAD"]) === originalHead, "release_recovery_failed");
  failUnless(git(root, ["rev-list", "-n", "1", tag], true) === "", "release_recovery_failed");
}

export function prepareRelease(options: ReleaseOptions): ReleaseResult {
  failUnless(((["patch", "minor", "major"] as const) as readonly string[]).includes(options.level), "invalid_level");
  const root = normalizeRoot(options.root);
  assertCleanReleaseSurface(root);
  if (!options.dryRun) failUnless(options.yes, "confirmation_required");

  const localStateBefore = digestLocalState(root);
  const previousVersion = currentVersion(root);
  const version = bumpVersion(previousVersion, options.level);
  const tag = `v${version}`;
  assertTagAbsent(root, tag);
  const runGenerator = options.runGenerator ?? defaultRunGenerator;
  const checkEvidence = runGenerator({ root, check: true });
  failUnless(checkEvidence.ok && checkEvidence.changedPaths.length === 0 && checkEvidence.writtenPaths.length === 0, "generation_drift");
  try {
    (options.runGates ?? defaultRunGates)(root);
  } catch (error) {
    if (error instanceof ReleaseError && error.code !== "gate_failed") throw error;
    throw new ReleaseError("gate_failed");
  }
  failUnless(digestLocalState(root) === localStateBefore, "ignored_state_changed");
  assertCleanReleaseSurface(root);

  if (options.dryRun) {
    return Object.freeze({
      ok: true,
      dryRun: true,
      previousVersion,
      version,
      tag,
      commit: null,
      releasePaths: RELEASE_OWNED_PATHS,
    });
  }

  const snapshot = snapshotReleaseFiles(root);
  const originalHead = git(root, ["rev-parse", "HEAD"]);
  failUnless(SHA_RE.test(originalHead), "invalid_repository_head");
  let releaseCommit: string | undefined;
  try {
    updatePackageVersions(root, version);
    const generated = runGenerator({ root, check: false });
    failUnless(
      generated.ok
        && sameSet(generated.changedPaths, VERSION_MANIFEST_PATHS)
        && sameSet(generated.writtenPaths, VERSION_MANIFEST_PATHS),
      "generator_write_set_drift",
    );
    failUnless(digestLocalState(root) === localStateBefore, "ignored_state_changed");
    failUnless(sameSet(releaseSurfaceDiffPaths(root), RELEASE_OWNED_PATHS), "release_write_set_drift");
    failUnless(git(root, ["diff", "--cached", "--name-only"]) === "", "dirty_index");

    git(root, ["add", "--", ...RELEASE_OWNED_PATHS]);
    failUnless(sameSet(git(root, ["diff", "--cached", "--name-only"]).split(/\r?\n/u).filter(Boolean), RELEASE_OWNED_PATHS), "staged_write_set_drift");
    git(root, ["commit", "-m", `release: ${tag}`]);
    const commit = git(root, ["rev-parse", "HEAD"]);
    releaseCommit = commit;
    failUnless(SHA_RE.test(commit), "invalid_release_commit");
    if (options.failAfter === "commit") throw new ReleaseError("injected_after_commit");
    failUnless(
      sameSet(git(root, ["show", "--pretty=format:", "--name-only", "HEAD"]).split(/\r?\n/u).filter(Boolean), RELEASE_OWNED_PATHS),
      "commit_write_set_drift",
    );
    failUnless(digestLocalState(root) === localStateBefore, "ignored_state_changed");
    git(root, ["tag", tag, commit]);
    if (options.failAfter === "tag") throw new ReleaseError("injected_after_tag");
    failUnless(git(root, ["rev-list", "-n", "1", tag]) === commit, "tag_mismatch");
    assertCleanReleaseSurface(root);
    return Object.freeze({
      ok: true,
      dryRun: false,
      previousVersion,
      version,
      tag,
      commit,
      releasePaths: RELEASE_OWNED_PATHS,
    });
  } catch (error) {
    if (releaseCommit === undefined) restoreReleaseFiles(root, snapshot);
    else compensateReleaseRefs(root, originalHead, releaseCommit, tag, snapshot);
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError("release_failed");
  }
}

interface CliInvocation {
  readonly level: ReleaseLevel;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly yes: boolean;
}

function parseArguments(argv: readonly string[]): CliInvocation {
  const level = argv[0];
  failUnless(level === "patch" || level === "minor" || level === "major", "invalid_level");
  const flags = argv.slice(1);
  failUnless(flags.every((flag) => flag === "--dry-run" || flag === "--json" || flag === "--yes"), "unknown_flag");
  failUnless(new Set(flags).size === flags.length, "duplicate_flag");
  return {
    level,
    dryRun: flags.includes("--dry-run"),
    json: flags.includes("--json"),
    yes: flags.includes("--yes"),
  };
}

export function runCli(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const parsed = parseArguments(argv);
    const result = prepareRelease({
      root: path.resolve(__dirname, "../.."),
      level: parsed.level,
      dryRun: parsed.dryRun,
      yes: parsed.yes,
    });
    process.stdout.write(parsed.json
      ? `${JSON.stringify(result)}\n`
      : `${result.dryRun ? "Release ready" : "Release prepared"}: ${result.tag}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof ReleaseError ? error.code : "release_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

exports.ReleaseError = ReleaseError;
exports.RELEASE_OWNED_PATHS = RELEASE_OWNED_PATHS;
exports.VERSION_MANIFEST_PATHS = VERSION_MANIFEST_PATHS;
exports.prepareRelease = prepareRelease;
exports.runCli = runCli;

if (require.main === module) process.exitCode = runCli();
