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

const CURRENT_GATE_COMMANDS = Object.freeze([
  "npm run build",
  "npm run test:capabilities",
  "node --test dist-tests/skills/code-style-correction.test.cjs dist-tests/skills/code-style-correction.behavior.test.cjs",
  "npm run test:capability-hooks",
  "npm run test:manual-conflict",
  "npm run test:generator",
  "npm run test:generator:repository",
  "npm run audit:retirement",
  "npm run generate:check",
]);

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

test("complete generated-product staging runs checks while preserving unrelated dirty and untracked work", () => {
  for (const product of ["kcoderag-qa", "kcoderag-cursor"] as const) {
    const current = fixture(`${product} complete group`);
    const generated = path.join(current.root, product, "README.md");
    const untracked = path.join(current.root, "local scratch.txt");
    fs.mkdirSync(path.dirname(generated), { recursive: true });
    fs.writeFileSync(generated, `${product}\n`);
    git(current.root, ["add", `${product}/README.md`], current.env);
    fs.writeFileSync(path.join(current.root, "notes.txt"), "unrelated dirty bytes\n");
    fs.writeFileSync(untracked, "unrelated untracked bytes\n");
    const indexBefore = bytes(current.index);
    const dirtyBefore = bytes(path.join(current.root, "notes.txt"));
    const untrackedBefore = bytes(untracked);
    const commands: string[] = [];

    const result = preCommit.runPreCommit({
      root: current.root,
      env: current.env,
      runCommand: (command, args) => {
        commands.push([command, ...args].join(" "));
        return { status: 0 };
      },
    });

    assert.equal(result.ok, true, product);
    assert.equal(result.code, "verified", product);
    assert.deepEqual(commands, CURRENT_GATE_COMMANDS, product);
    assert.deepEqual(bytes(current.index), indexBefore, product);
    assert.deepEqual(bytes(path.join(current.root, "notes.txt")), dirtyBefore, product);
    assert.deepEqual(bytes(untracked), untrackedBefore, product);
  }
});

test("staged retired Dev and marketplace roots fail before build without changing the alternate index", () => {
  for (const item of [
    { relativePath: "kcoderag-dev/hooks/grep-nudge.cjs", deleted: true },
    { relativePath: ".agents/plugins/kcoderag-nav/manifest.json", deleted: false },
    { relativePath: ".claude-plugin/marketplace.json", deleted: false },
    { relativePath: ".cursor-plugin/marketplace.json", deleted: false },
  ] as const) {
    const { relativePath } = item;
    const current = fixture("retired product");
    const destination = path.join(current.root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, "retired\n");
    git(current.root, ["add", relativePath], current.env);
    if (item.deleted) {
      git(current.root, ["commit", "--quiet", "-m", "retired baseline"], current.env);
      fs.rmSync(destination);
      git(current.root, ["add", "--update", "--", relativePath], current.env);
    }
    const indexBefore = bytes(current.index);
    const stagedBlob = item.deleted ? undefined : git(current.root, ["rev-parse", `:${relativePath}`], current.env);
    let commands = 0;

    const result = preCommit.runPreCommit({
      root: current.root,
      env: current.env,
      runCommand: () => {
        commands += 1;
        return { status: 0 };
      },
    });

    assert.equal(result.ok, false, relativePath);
    assert.equal(result.code, "retired_product_staged", relativePath);
    assert.equal(commands, 0, relativePath);
    assert.deepEqual(bytes(current.index), indexBefore, relativePath);
    if (stagedBlob === undefined) {
      assert.equal(fs.existsSync(destination), false, relativePath);
    } else {
      assert.equal(git(current.root, ["rev-parse", `:${relativePath}`], current.env), stagedBlob, relativePath);
      assert.equal(fs.readFileSync(destination, "utf8"), "retired\n", relativePath);
    }
  }
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

test("stale staged QA or Cursor blob cannot be approved through a fresh working blob", () => {
  for (const product of ["kcoderag-qa", "kcoderag-cursor"] as const) {
    const current = fixture(`${product} partial stage`);
    const relativePath = `${product}/README.md`;
    const generated = path.join(current.root, product, "README.md");
    fs.mkdirSync(path.dirname(generated), { recursive: true });
    fs.writeFileSync(generated, "base\n");
    git(current.root, ["add", relativePath], current.env);
    git(current.root, ["commit", "--quiet", "-m", "generated base"], current.env);

    fs.writeFileSync(generated, "staged-A\n");
    git(current.root, ["add", relativePath], current.env);
    const stagedBlob = git(current.root, ["rev-parse", `:${relativePath}`], current.env);
    fs.writeFileSync(generated, "working-B\n");
    const workingBefore = bytes(generated);
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

    assert.equal(result.ok, false, product);
    assert.equal(result.code, `${product === "kcoderag-qa" ? "qa" : "cursor"}_generated_unstaged_changes`, product);
    assert.equal(commands, 0, product);
    assert.deepEqual(bytes(current.index), indexBefore, product);
    assert.equal(git(current.root, ["rev-parse", `:${relativePath}`], current.env), stagedBlob, product);
    assert.deepEqual(bytes(generated), workingBefore, product);
  }
});


test("managed staging runs every current capability and generation gate", () => {
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
  assert.deepEqual(commands, CURRENT_GATE_COMMANDS);
  assert.deepEqual(bytes(current.index), before);
});

test("every current gate is required and reports its own safe failure code", () => {
  const failures = [
    "build_failed",
    "capability_tests_failed",
    "skill_tests_failed",
    "capability_hook_tests_failed",
    "manual_conflict_tests_failed",
    "generator_tests_failed",
    "repository_generator_tests_failed",
    "retirement_audit_failed",
    "generation_drift",
  ] as const;

  for (const [failureIndex, code] of failures.entries()) {
    const current = fixture(`required gate ${failureIndex}`);
    fs.writeFileSync(path.join(current.root, "package.json"), '{"name":"fixture","version":"1.0.1"}\n');
    git(current.root, ["add", "package.json"], current.env);
    const commands: string[] = [];

    const result = preCommit.runPreCommit({
      root: current.root,
      env: current.env,
      runCommand: (command, args) => {
        commands.push([command, ...args].join(" "));
        return { status: commands.length - 1 === failureIndex ? 1 : 0 };
      },
    });

    assert.equal(result.ok, false, code);
    assert.equal(result.code, code);
    assert.deepEqual(commands, CURRENT_GATE_COMMANDS.slice(0, failureIndex + 1), code);
  }
});

test("generation drift fails with safe diagnostics and leaves dirty paths untouched", () => {
  const current = fixture("drift path");
  fs.mkdirSync(path.join(current.root, "src"));
  fs.writeFileSync(path.join(current.root, "src", "input.cts"), "export {};\n");
  git(current.root, ["add", "src/input.cts"], current.env);
  fs.writeFileSync(path.join(current.root, "notes.txt"), "unrelated dirty bytes\n");
  const workingBefore = bytes(path.join(current.root, "notes.txt"));
  const indexBefore = bytes(current.index);
  const result = preCommit.runPreCommit({
    root: current.root,
    env: current.env,
    runCommand: (_command, args) => ({ status: args.join(" ") === "run generate:check" ? 1 : 0 }),
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
  assert.doesNotMatch(source, /test:migration|legacy-state\.test/iu);
});
