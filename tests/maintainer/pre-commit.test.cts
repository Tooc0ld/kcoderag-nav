const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

interface CommandResult {
  readonly status: number;
}

interface PreCommitResult {
  readonly ok: boolean;
  readonly code: string;
  readonly stagedPaths: readonly string[];
}

interface PreCommitModule {
  runPreCommit(options: {
    readonly root: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly runCommand?: (
      command: string,
      args: readonly string[],
      options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
    ) => CommandResult;
  }): PreCommitResult;
}

const preCommit = require("../../dist/maintainer/pre-commit.cjs") as PreCommitModule;
const repositoryRoot = path.resolve(__dirname, "../..");

function git(root: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): string {
  return childProcess.execFileSync("git", args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fixture(name: string): { root: string; env: NodeJS.ProcessEnv; index: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kcoderag precommit ${name} `));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "KCodeRag Test"]);
  git(root, ["config", "user.email", "kcoderag@example.invalid"]);
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"fixture","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(root, "notes.txt"), "base\n");
  git(root, ["add", "package.json", "notes.txt"]);
  git(root, ["commit", "--quiet", "-m", "base"]);
  const index = path.join(root, ".git", "precommit-test-index");
  fs.copyFileSync(path.join(root, ".git", "index"), index);
  return { root, index, env: { ...process.env, GIT_INDEX_FILE: index } };
}

function bytes(file: string): Buffer {
  return fs.readFileSync(file);
}

function sha256(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("unrelated staged files take the fast path without invoking build or generation", () => {
  const current = fixture("fast path");
  fs.writeFileSync(path.join(current.root, "notes.txt"), "changed\n");
  git(current.root, ["add", "notes.txt"], current.env);
  const before = bytes(current.index);
  let commands = 0;

  const result = preCommit.runPreCommit({
    root: current.root,
    env: current.env,
    runCommand: () => {
      commands += 1;
      return { status: 0 };
    },
  });

  assert.deepEqual(result, { ok: true, code: "not_applicable", stagedPaths: ["notes.txt"] });
  assert.equal(commands, 0);
  assert.deepEqual(bytes(current.index), before);
});

test("partial staging preserves index bytes, staged blob A, and working bytes B exactly", () => {
  const current = fixture("partial stage");
  fs.writeFileSync(path.join(current.root, "package.json"), '{"name":"fixture","version":"1.0.1"}\n');
  git(current.root, ["add", "package.json"], current.env);
  const stagedBlob = git(current.root, ["rev-parse", ":package.json"], current.env);
  fs.writeFileSync(path.join(current.root, "package.json"), '{"name":"fixture","version":"working-B"}\n');
  const workingBefore = bytes(path.join(current.root, "package.json"));
  const indexBefore = bytes(current.index);
  let commands = 0;

  const result = preCommit.runPreCommit({
    root: current.root,
    env: current.env,
    runCommand: () => {
      commands += 1;
      return { status: 0 };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "canonical_unstaged_changes");
  assert.equal(commands, 0);
  assert.deepEqual(bytes(current.index), indexBefore);
  assert.equal(sha256(bytes(current.index)), sha256(indexBefore));
  assert.equal(git(current.root, ["rev-parse", ":package.json"], current.env), stagedBlob);
  assert.deepEqual(bytes(path.join(current.root, "package.json")), workingBefore);
});

test("managed staging runs build then the read-only generator check", () => {
  const current = fixture("managed stage");
  fs.writeFileSync(path.join(current.root, "package.json"), '{"name":"fixture","version":"1.0.1"}\n');
  git(current.root, ["add", "package.json"], current.env);
  const before = bytes(current.index);
  const commands: string[] = [];

  const result = preCommit.runPreCommit({
    root: current.root,
    env: current.env,
    runCommand: (command, args) => {
      commands.push([command, ...args].join(" "));
      return { status: 0 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "verified");
  assert.deepEqual(commands, ["npm run build", "npm run generate:check"]);
  assert.deepEqual(bytes(current.index), before);
});

test("generation drift fails with safe diagnostics and leaves dirty paths untouched", () => {
  const current = fixture("drift path");
  fs.mkdirSync(path.join(current.root, "src"));
  fs.writeFileSync(path.join(current.root, "src", "input.cts"), "export {};\n");
  git(current.root, ["add", "src/input.cts"], current.env);
  fs.writeFileSync(path.join(current.root, "notes.txt"), "unrelated dirty bytes\n");
  const workingBefore = bytes(path.join(current.root, "notes.txt"));
  const indexBefore = bytes(current.index);
  let invocation = 0;

  const result = preCommit.runPreCommit({
    root: current.root,
    env: current.env,
    runCommand: () => ({ status: ++invocation === 1 ? 0 : 1 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "generation_drift");
  assert.deepEqual(bytes(current.index), indexBefore);
  assert.deepEqual(bytes(path.join(current.root, "notes.txt")), workingBefore);
  assert.ok(result.stagedPaths.every((item) => !item.includes(current.root)));
});

test("launcher is Node-only and neither launcher nor helper can stage or reset files", () => {
  const launcher = fs.readFileSync(path.join(repositoryRoot, ".githooks", "pre-commit"), "utf8");
  const source = fs.readFileSync(path.join(repositoryRoot, "src", "maintainer", "pre-commit.cts"), "utf8");
  assert.match(launcher, /dist\/maintainer\/pre-commit\.cjs/u);
  assert.match(launcher, /node/u);
  assert.doesNotMatch(launcher, /python|pre_commit_generate\.py/iu);
  assert.doesNotMatch(`${launcher}\n${source}`, /git\s+(?:add|update-index|reset|checkout)\b/iu);
});
