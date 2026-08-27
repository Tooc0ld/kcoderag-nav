#!/usr/bin/env node
/** Read-only staged-tree gate for deterministic managed project assets. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

interface CommandResult {
  readonly status: number;
}

interface RunOptions {
  readonly root: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runCommand?: (
    command: string,
    args: readonly string[],
    options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
  ) => CommandResult;
}

export interface PreCommitResult {
  readonly ok: boolean;
  readonly code: string;
  readonly stagedPaths: readonly string[];
}

interface IndexSnapshot {
  readonly bytes: Buffer;
  readonly blobs: ReadonlyMap<string, string>;
  readonly path: string;
}

const CANONICAL_PATHS = Object.freeze([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.tests.json",
  "plugin-src",
  "src",
]);

const GENERATED_GROUPS = Object.freeze([
  Object.freeze({ roots: Object.freeze(["kcoderag-qa"]), dirtyCode: "qa_generated_unstaged_changes" }),
  Object.freeze({ roots: Object.freeze(["kcoderag-cursor"]), dirtyCode: "cursor_generated_unstaged_changes" }),
]);

const GENERATED_PATHS = Object.freeze(GENERATED_GROUPS.flatMap((group) => group.roots));

const RETIRED_PATHS = Object.freeze([
  ".agents/plugins",
  ".claude-plugin",
  ".cursor-plugin",
  "kcoderag-dev",
]);

const MANAGED_PATHS = Object.freeze([...CANONICAL_PATHS, ...GENERATED_PATHS, ...RETIRED_PATHS]);

const REQUIRED_CHECKS = Object.freeze([
  Object.freeze({ command: "npm", args: Object.freeze(["run", "build"]), failureCode: "build_failed" }),
  Object.freeze({
    command: "npm",
    args: Object.freeze(["run", "test:capabilities"]),
    failureCode: "capability_tests_failed",
  }),
  Object.freeze({
    command: "node",
    args: Object.freeze([
      "--test",
      "dist-tests/skills/code-style-correction.test.cjs",
      "dist-tests/skills/code-style-correction.behavior.test.cjs",
    ]),
    failureCode: "skill_tests_failed",
  }),
  Object.freeze({
    command: "npm",
    args: Object.freeze(["run", "test:capability-hooks"]),
    failureCode: "capability_hook_tests_failed",
  }),
  Object.freeze({
    command: "npm",
    args: Object.freeze(["run", "test:manual-conflict"]),
    failureCode: "manual_conflict_tests_failed",
  }),
  Object.freeze({
    command: "npm",
    args: Object.freeze(["run", "test:generator"]),
    failureCode: "generator_tests_failed",
  }),
  Object.freeze({
    command: "npm",
    args: Object.freeze(["run", "test:generator:repository"]),
    failureCode: "repository_generator_tests_failed",
  }),
  Object.freeze({
    command: "npm",
    args: Object.freeze(["run", "audit:retirement"]),
    failureCode: "retirement_audit_failed",
  }),
  Object.freeze({
    command: "npm",
    args: Object.freeze(["run", "generate:check"]),
    failureCode: "generation_drift",
  }),
]);

function git(
  root: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): ReturnType<typeof childProcess.spawnSync> {
  return childProcess.spawnSync("git", args, {
    cwd: root,
    env,
    input: Buffer.alloc(0),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function splitZero(value: Buffer): string[] {
  const text = value.toString("utf8");
  return text.split("\0").filter((item) => item.length > 0);
}

function normalizeRelative(value: string): string {
  return value.replaceAll("\\", "/");
}

function matchesRoot(relativePath: string, candidate: string): boolean {
  return relativePath === candidate || relativePath.startsWith(`${candidate}/`);
}

function isManaged(relativePath: string): boolean {
  return MANAGED_PATHS.some((candidate) => matchesRoot(relativePath, candidate));
}

function includesRoot(paths: readonly string[], roots: readonly string[]): boolean {
  return paths.some((relativePath) => roots.some((candidate) => matchesRoot(relativePath, candidate)));
}

function resolveIndexPath(root: string, env: NodeJS.ProcessEnv): string {
  if (env.GIT_INDEX_FILE !== undefined && env.GIT_INDEX_FILE.length > 0) {
    return path.resolve(root, env.GIT_INDEX_FILE);
  }
  const result = git(root, env, ["rev-parse", "--git-path", "index"]);
  if (result.status !== 0) throw new Error("git_index_unavailable");
  const value = result.stdout.toString("utf8").trim();
  if (value.length === 0) throw new Error("git_index_unavailable");
  return path.resolve(root, value);
}

function stagedBlobs(root: string, env: NodeJS.ProcessEnv): ReadonlyMap<string, string> {
  const result = git(root, env, ["ls-files", "--stage", "-z"]);
  if (result.status !== 0) throw new Error("git_index_unavailable");
  const blobs = new Map<string, string>();
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
  for (const record of splitZero(stdout)) {
    const tab = record.indexOf("\t");
    const header = tab < 0 ? "" : record.slice(0, tab);
    const relativePath = tab < 0 ? "" : normalizeRelative(record.slice(tab + 1));
    const fields = header.split(" ");
    const oid = fields[1];
    const stage = fields[2];
    if (relativePath.length > 0 && oid !== undefined && stage === "0") blobs.set(relativePath, oid);
  }
  return blobs;
}

function snapshotIndex(root: string, env: NodeJS.ProcessEnv): IndexSnapshot {
  const indexPath = resolveIndexPath(root, env);
  return Object.freeze({
    path: indexPath,
    bytes: fs.readFileSync(indexPath),
    blobs: stagedBlobs(root, env),
  });
}

function indexMatches(root: string, env: NodeJS.ProcessEnv, before: IndexSnapshot): boolean {
  let current: IndexSnapshot;
  try {
    current = snapshotIndex(root, env);
  } catch {
    return false;
  }
  if (current.path !== before.path || !current.bytes.equals(before.bytes)) return false;
  if (current.blobs.size !== before.blobs.size) return false;
  for (const [relativePath, oid] of before.blobs) {
    if (current.blobs.get(relativePath) !== oid) return false;
  }
  return true;
}

function stagedPaths(root: string, env: NodeJS.ProcessEnv): readonly string[] {
  const result = git(root, env, ["diff", "--cached", "--name-only", "-z"]);
  if (result.status !== 0) throw new Error("git_staged_paths_unavailable");
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
  return Object.freeze(splitZero(stdout).map(normalizeRelative).sort());
}

function workingTreeIsDirty(
  root: string,
  env: NodeJS.ProcessEnv,
  roots: readonly string[],
): boolean {
  const tracked = git(root, env, ["diff", "--quiet", "--exit-code", "--", ...roots]);
  if (tracked.status !== 0 && tracked.status !== 1) throw new Error("git_worktree_unavailable");
  const untracked = git(root, env, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...roots,
  ]);
  if (untracked.status !== 0) throw new Error("git_worktree_unavailable");
  return tracked.status === 1 || untracked.stdout.length > 0;
}

function defaultRunCommand(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
): CommandResult {
  const result = process.platform === "win32"
    ? childProcess.spawnSync(options.env.ComSpec ?? process.env.ComSpec ?? "cmd.exe", [
        "/d",
        "/s",
        "/c",
        [command, ...args].join(" "),
      ], {
        cwd: options.cwd,
        env: options.env,
        stdio: "ignore",
      })
    : childProcess.spawnSync(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: "ignore",
      });
  return { status: result.status ?? 1 };
}

function result(ok: boolean, code: string, paths: readonly string[]): PreCommitResult {
  return Object.freeze({ ok, code, stagedPaths: Object.freeze([...paths]) });
}

/** Verify generated state without ever modifying the Git index or working tree. */
export function runPreCommit(options: RunOptions): PreCommitResult {
  const root = path.resolve(options.root);
  const env = { ...process.env, ...(options.env ?? {}) };
  let before: IndexSnapshot;
  let paths: readonly string[];
  try {
    before = snapshotIndex(root, env);
    paths = stagedPaths(root, env);
  } catch {
    return result(false, "git_inspection_failed", []);
  }
  if (!paths.some(isManaged)) return result(true, "not_applicable", paths);
  if (includesRoot(paths, RETIRED_PATHS)) return result(false, "retired_product_staged", paths);

  try {
    if (workingTreeIsDirty(root, env, CANONICAL_PATHS)) {
      return result(false, "canonical_unstaged_changes", paths);
    }
    for (const group of GENERATED_GROUPS) {
      if (workingTreeIsDirty(root, env, group.roots)) {
        return result(false, group.dirtyCode, paths);
      }
    }
  } catch {
    return result(false, "git_inspection_failed", paths);
  }

  const runCommand = options.runCommand ?? defaultRunCommand;
  for (const check of REQUIRED_CHECKS) {
    const outcome = runCommand(check.command, check.args, { cwd: root, env });
    if (!indexMatches(root, env, before)) return result(false, "index_changed", paths);
    if (outcome.status !== 0) return result(false, check.failureCode, paths);
  }
  return result(true, "verified", paths);
}

const MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  git_inspection_failed: "Cannot inspect the staged KCodeRag files with Git.",
  canonical_unstaged_changes:
    "Canonical KCodeRag inputs have unstaged changes. Review and stage them explicitly.",
  qa_generated_unstaged_changes:
    "Generated KCodeRag QA files have unstaged changes. Regenerate, review, and stage the complete change explicitly.",
  cursor_generated_unstaged_changes:
    "Generated KCodeRag Cursor files have unstaged changes. Regenerate, review, and stage the complete change explicitly.",
  retired_product_staged:
    "Retired KCodeRag Dev or marketplace product files are staged; remove them from the public change.",
  build_failed: "KCodeRag Node build failed. Run npm run build for details.",
  capability_tests_failed: "KCodeRag capability contract tests failed.",
  skill_tests_failed: "KCodeRag capability Skill tests failed.",
  capability_hook_tests_failed: "KCodeRag capability Hook tests failed.",
  manual_conflict_tests_failed: "KCodeRag manual-source conflict tests failed.",
  generator_tests_failed: "KCodeRag generator tests failed.",
  repository_generator_tests_failed: "KCodeRag repository generator tests failed.",
  retirement_audit_failed: "KCodeRag retirement audit failed.",
  generation_drift:
    "Generated KCodeRag files drifted. Run npm run generate, review, and stage them explicitly.",
  index_changed: "The Git index changed during KCodeRag verification; the commit was stopped.",
});

export function main(): number {
  const outcome = runPreCommit({ root: path.resolve(__dirname, "../..") });
  if (outcome.ok) return 0;
  process.stderr.write(`${MESSAGES[outcome.code] ?? "KCodeRag pre-commit verification failed."}\n`);
  return 1;
}

exports.main = main;
exports.runPreCommit = runPreCommit;

if (require.main === module) {
  process.exitCode = main();
}
