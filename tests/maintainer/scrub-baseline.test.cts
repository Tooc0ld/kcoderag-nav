const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

interface ScrubHunkRange {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
}

interface ScrubPathMetadata {
  readonly pathToken: string;
  readonly kind: "tracked" | "untracked";
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly stagedDigest: string | null;
  readonly unstagedDigest: string | null;
  readonly contentDigest: string | null;
  readonly stagedHunks: readonly ScrubHunkRange[];
  readonly unstagedHunks: readonly ScrubHunkRange[];
}

interface ScrubBaselineResult {
  readonly schemaVersion: 1;
  readonly code: "baseline_captured" | "scrub_overlap_requires_checkpoint";
  readonly requiresCheckpoint: boolean;
  readonly baselineDigest: string;
  readonly explicitPathTokens: readonly string[];
  readonly paths: readonly ScrubPathMetadata[];
}

interface ScrubVerificationResult {
  readonly schemaVersion: 1;
  readonly code: "scrub_baseline_preserved";
  readonly ok: true;
  readonly committedPathCount: number;
  readonly baselineDigest: string;
}

interface ScrubBaselineModule {
  ScrubBaselineError: new (code: string) => Error & { readonly code: string };
  captureScrubBaseline(options: {
    readonly root: string;
    readonly explicitPaths: readonly string[];
    readonly temporaryRoot?: string;
    readonly limits?: {
      readonly maxStatusBytes?: number;
      readonly maxDiffBytes?: number;
      readonly maxUntrackedBytes?: number;
      readonly maxPaths?: number;
    };
  }, dependencies?: {
    readonly onPrivateDirectory?: (directory: string) => void;
  }): ScrubBaselineResult;
  assertScrubBaselinePreserved(
    baseline: ScrubBaselineResult,
    options?: { readonly requireCommitted?: boolean },
  ): ScrubVerificationResult;
}

const scrub = require("../../dist/maintainer/scrub-baseline.cjs") as ScrubBaselineModule;

function git(root: string, args: readonly string[]): string {
  return childProcess.execFileSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(root: string, relativePath: string, body: string | Buffer): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, body);
}

function createRepository(files: Readonly<Record<string, string>>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-scrub-fixture-"));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  for (const [relativePath, body] of Object.entries(files)) write(root, relativePath, body);
  git(root, ["add", "--", ...Object.keys(files)]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return root;
}

function expectCode(call: () => unknown, code: string): void {
  assert.throws(call, (error: unknown) =>
    error instanceof Error && "code" in error && (error as Error & { code: string }).code === code);
}

function remove(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

function statusBytes(root: string): Buffer {
  return childProcess.execFileSync("git", [
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
  ], {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function unrelatedIndexBytes(root: string, excluded: ReadonlySet<string>): Buffer {
  const output = childProcess.execFileSync("git", ["ls-files", "--stage", "-z"], {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const kept = output.toString("utf8").split("\0").filter((record) => {
    if (record.length === 0) return false;
    const tab = record.indexOf("\t");
    assert.ok(tab > 0);
    return !excluded.has(record.slice(tab + 1));
  });
  return Buffer.from(kept.join("\0"), "utf8");
}

test("capture keeps raw tracked diffs private and exposes only classified metadata", () => {
  const root = createRepository({
    "target.txt": "target\n",
    "dirty-stage.txt": "stage-base\n",
    "dirty-work.txt": "work-base\n",
  });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-scrub-private-test-"));
  let privateDirectory = "";
  try {
    write(root, "dirty-stage.txt", "stage-base\nPRIVATE_STAGE_CANARY\n");
    git(root, ["add", "--", "dirty-stage.txt"]);
    write(root, "dirty-work.txt", "work-base\nPRIVATE_WORK_CANARY\n");
    write(root, "private-untracked.txt", "PRIVATE_UNTRACKED_CANARY\n");

    const result = scrub.captureScrubBaseline({
      root,
      explicitPaths: ["target.txt"],
      temporaryRoot,
    }, {
      onPrivateDirectory(directory) {
        privateDirectory = directory;
      },
    });

    assert.deepEqual(Object.keys(result), [
      "schemaVersion",
      "code",
      "requiresCheckpoint",
      "baselineDigest",
      "explicitPathTokens",
      "paths",
    ]);
    assert.equal(result.code, "baseline_captured");
    assert.equal(result.requiresCheckpoint, false);
    assert.match(result.baselineDigest, /^[0-9a-f]{64}$/u);
    assert.equal(result.explicitPathTokens.length, 1);
    assert.match(result.explicitPathTokens[0]!, /^[0-9a-f]{64}$/u);
    assert.equal(result.paths.length, 3);
    assert.equal(result.paths.filter((entry) => entry.staged).length, 1);
    assert.equal(result.paths.filter((entry) => entry.unstaged).length, 1);
    assert.equal(result.paths.filter((entry) => entry.untracked).length, 1);
    for (const entry of result.paths) {
      assert.deepEqual(Object.keys(entry), [
        "pathToken",
        "kind",
        "staged",
        "unstaged",
        "untracked",
        "stagedDigest",
        "unstagedDigest",
        "contentDigest",
        "stagedHunks",
        "unstagedHunks",
      ]);
      assert.match(entry.pathToken, /^[0-9a-f]{64}$/u);
    }

    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /target\.txt|dirty-stage|dirty-work|private-untracked/u);
    assert.doesNotMatch(serialized, /PRIVATE_(?:STAGE|WORK|UNTRACKED)_CANARY/u);
    assert.notEqual(privateDirectory, "");
    assert.equal(path.relative(temporaryRoot, privateDirectory).startsWith(".."), false);
    const privateFiles = fs.readdirSync(privateDirectory).sort();
    assert.deepEqual(privateFiles, ["staged.diff", "unstaged.diff"]);
    const privateBytes = Buffer.concat(privateFiles.map((name) =>
      fs.readFileSync(path.join(privateDirectory, name))));
    assert.match(privateBytes.toString("utf8"), /PRIVATE_STAGE_CANARY/u);
    assert.match(privateBytes.toString("utf8"), /PRIVATE_WORK_CANARY/u);
    assert.doesNotMatch(privateBytes.toString("utf8"), /PRIVATE_UNTRACKED_CANARY/u);
  } finally {
    remove(root);
    remove(temporaryRoot);
  }
});

test("overlap requires a checkpoint for staged, unstaged, or untracked explicit paths", () => {
  for (const state of ["staged", "unstaged", "untracked"] as const) {
    const root = createRepository({ "target.txt": "base\n", "other.txt": "other\n" });
    try {
      const explicitPath = state === "untracked" ? "new-target.txt" : "target.txt";
      write(root, explicitPath, `${state}-change\n`);
      if (state === "staged") git(root, ["add", "--", explicitPath]);

      const result = scrub.captureScrubBaseline({ root, explicitPaths: [explicitPath] });
      assert.equal(result.code, "scrub_overlap_requires_checkpoint");
      assert.equal(result.requiresCheckpoint, true);
      assert.equal(result.explicitPathTokens.length, 1);
      assert.equal(result.paths.some((entry) =>
        entry.pathToken === result.explicitPathTokens[0] &&
        (entry.staged || entry.unstaged || entry.untracked)), true);
      assert.doesNotMatch(JSON.stringify(result), /target\.txt|change/u);
    } finally {
      remove(root);
    }
  }
});

test("capture fails closed for unsafe paths, private links, binary diffs, and oversized output", () => {
  const root = createRepository({ "target.txt": "base\n", "binary.bin": "base\n" });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-scrub-outside-"));
  try {
    expectCode(
      () => scrub.captureScrubBaseline({ root, explicitPaths: ["../outside.txt"] }),
      "scrub_invalid_path",
    );
    expectCode(
      () => scrub.captureScrubBaseline({ root, explicitPaths: ["target.txt", "target.txt"] }),
      "scrub_duplicate_path",
    );
    fs.mkdirSync(path.join(outside, "nested"));
    write(outside, "nested/file.txt", "outside\n");
    const link = path.join(root, "linked");
    fs.symlinkSync(path.join(outside, "nested"), link, process.platform === "win32" ? "junction" : "dir");
    expectCode(
      () => scrub.captureScrubBaseline({ root, explicitPaths: ["linked/file.txt"] }),
      "scrub_symlink_path",
    );
    fs.mkdirSync(path.join(root, "directory-target"));
    expectCode(
      () => scrub.captureScrubBaseline({ root, explicitPaths: ["directory-target"] }),
      "scrub_special_file",
    );

    write(root, "binary.bin", Buffer.from([0x00, 0x01, 0x02, 0x03]));
    expectCode(
      () => scrub.captureScrubBaseline({ root, explicitPaths: ["target.txt"] }),
      "scrub_binary_diff_unsupported",
    );
    write(root, "binary.bin", `${"large-change\n".repeat(128)}`);
    expectCode(
      () => scrub.captureScrubBaseline({
        root,
        explicitPaths: ["target.txt"],
        limits: { maxDiffBytes: 64 },
      }),
      "scrub_diff_too_large",
    );
  } finally {
    remove(root);
    remove(outside);
  }
});

test("post-edit and post-commit verification preserves exact unrelated status and index bytes", () => {
  const root = createRepository({
    "target.txt": "target-base\n",
    "dirty-stage.txt": "stage-base\n",
    "dirty-work.txt": "work-base\n",
  });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-scrub-verify-private-"));
  let privateDirectory = "";
  try {
    write(root, "dirty-stage.txt", "stage-base\nuser-stage\n");
    git(root, ["add", "--", "dirty-stage.txt"]);
    write(root, "dirty-work.txt", "work-base\nuser-work\n");
    write(root, "user-draft.txt", "user-untracked\n");
    const beforeStatus = statusBytes(root);
    const beforeIndex = unrelatedIndexBytes(root, new Set(["target.txt"]));
    const baseline = scrub.captureScrubBaseline({
      root,
      explicitPaths: ["target.txt"],
      temporaryRoot,
    }, {
      onPrivateDirectory(directory) {
        privateDirectory = directory;
      },
    });

    write(root, "target.txt", "target-neutralized\n");
    git(root, ["add", "--", "target.txt"]);
    const postEdit = scrub.assertScrubBaselinePreserved(baseline, { requireCommitted: false });
    assert.deepEqual(postEdit, {
      schemaVersion: 1,
      code: "scrub_baseline_preserved",
      ok: true,
      committedPathCount: 0,
      baselineDigest: baseline.baselineDigest,
    });
    assert.equal(fs.existsSync(privateDirectory), true);

    git(root, ["commit", "--quiet", "--only", "-m", "explicit scrub", "--", "target.txt"]);
    const verified = scrub.assertScrubBaselinePreserved(baseline);
    assert.equal(verified.ok, true);
    assert.equal(verified.committedPathCount, 1);
    assert.equal(verified.baselineDigest, baseline.baselineDigest);
    assert.deepEqual(statusBytes(root), beforeStatus);
    assert.deepEqual(unrelatedIndexBytes(root, new Set(["target.txt"])), beforeIndex);
    assert.equal(fs.existsSync(privateDirectory), false);
  } finally {
    remove(root);
    remove(temporaryRoot);
  }
});

test("verification rejects a newly staged unrelated path and a changed user hunk", () => {
  for (const scenario of ["new-stage", "changed-hunk"] as const) {
    const root = createRepository({
      "target.txt": "target\n",
      "user-work.txt": "user-base\n",
      "other.txt": "other-base\n",
    });
    try {
      write(root, "user-work.txt", "user-base\noriginal-user-hunk\n");
      const baseline = scrub.captureScrubBaseline({ root, explicitPaths: ["target.txt"] });
      if (scenario === "new-stage") {
        write(root, "other.txt", "other-new\n");
        git(root, ["add", "--", "other.txt"]);
      } else {
        write(root, "user-work.txt", "user-base\nchanged-user-hunk\n");
      }
      expectCode(
        () => scrub.assertScrubBaselinePreserved(baseline, { requireCommitted: false }),
        "scrub_unrelated_status_changed",
      );
    } finally {
      remove(root);
    }
  }
});

test("verification rejects lost untracked work and an unexpected unrelated rename", () => {
  for (const scenario of ["lost-untracked", "unexpected-rename"] as const) {
    const root = createRepository({
      "target.txt": "target\n",
      "rename-source.txt": "rename\n",
    });
    try {
      write(root, "user-draft.txt", "private draft\n");
      const baseline = scrub.captureScrubBaseline({ root, explicitPaths: ["target.txt"] });
      if (scenario === "lost-untracked") {
        fs.unlinkSync(path.join(root, "user-draft.txt"));
      } else {
        git(root, ["mv", "rename-source.txt", "rename-destination.txt"]);
      }
      expectCode(
        () => scrub.assertScrubBaselinePreserved(baseline, { requireCommitted: false }),
        "scrub_unrelated_status_changed",
      );
    } finally {
      remove(root);
    }
  }
});

test("commit verification rejects unexpected paths, partial batches, and residual target dirt", () => {
  const scenarios = [
    {
      name: "unexpected-commit-path",
      explicitPaths: ["target-a.txt"],
      edit(root: string): void {
        write(root, "target-a.txt", "new-a\n");
        write(root, "unrelated.txt", "unexpected\n");
        git(root, ["add", "--", "target-a.txt", "unrelated.txt"]);
      },
      afterCommit(_root: string): void {},
      code: "scrub_unexpected_commit_path",
    },
    {
      name: "partial-explicit-batch",
      explicitPaths: ["target-a.txt", "target-b.txt"],
      edit(root: string): void {
        write(root, "target-a.txt", "new-a\n");
        git(root, ["add", "--", "target-a.txt"]);
      },
      afterCommit(_root: string): void {},
      code: "scrub_explicit_path_not_committed",
    },
    {
      name: "residual-explicit-dirt",
      explicitPaths: ["target-a.txt"],
      edit(root: string): void {
        write(root, "target-a.txt", "new-a\n");
        git(root, ["add", "--", "target-a.txt"]);
      },
      afterCommit(root: string): void {
        write(root, "target-a.txt", "post-commit-dirt\n");
      },
      code: "scrub_explicit_path_dirty",
    },
  ] as const;

  for (const scenario of scenarios) {
    const root = createRepository({
      "target-a.txt": "a\n",
      "target-b.txt": "b\n",
      "unrelated.txt": "unrelated\n",
    });
    try {
      const baseline = scrub.captureScrubBaseline({ root, explicitPaths: scenario.explicitPaths });
      scenario.edit(root);
      git(root, ["commit", "--quiet", "-m", scenario.name]);
      scenario.afterCommit(root);
      expectCode(() => scrub.assertScrubBaselinePreserved(baseline), scenario.code);
    } finally {
      remove(root);
    }
  }
});

test("verification rejects a checkpoint baseline and any detached serialized copy", () => {
  const root = createRepository({ "target.txt": "base\n" });
  try {
    write(root, "target.txt", "dirty\n");
    const baseline = scrub.captureScrubBaseline({ root, explicitPaths: ["target.txt"] });
    expectCode(() => scrub.assertScrubBaselinePreserved(baseline), "scrub_checkpoint_required");
    const detached = JSON.parse(JSON.stringify(baseline)) as ScrubBaselineResult;
    expectCode(() => scrub.assertScrubBaselinePreserved(detached), "scrub_unknown_baseline");
  } finally {
    remove(root);
  }
});

test("private capture rejects repository-local storage and cleans callback failures", () => {
  const root = createRepository({ "target.txt": "base\n" });
  let privateDirectory = "";
  try {
    expectCode(
      () => scrub.captureScrubBaseline({
        root,
        explicitPaths: ["target.txt"],
        temporaryRoot: root,
      }),
      "scrub_private_root_unsafe",
    );
    expectCode(
      () => scrub.captureScrubBaseline({ root, explicitPaths: ["target.txt"] }, {
        onPrivateDirectory(directory) {
          privateDirectory = directory;
          throw new Error("private callback canary");
        },
      }),
      "scrub_private_callback_failed",
    );
    assert.notEqual(privateDirectory, "");
    assert.equal(fs.existsSync(privateDirectory), false);
  } finally {
    remove(root);
  }
});

test("package script runs only the focused scrub tests and is absent from ordinary live gates", () => {
  const repositoryRoot = path.resolve(__dirname, "../..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    readonly scripts: Readonly<Record<string, string>>;
  };
  assert.equal(
    packageJson.scripts["test:scrub-baseline"],
    "node --test dist-tests/maintainer/scrub-baseline.test.cjs",
  );
  assert.doesNotMatch(packageJson.scripts["ci:local"] ?? "", /scrub-baseline/u);
  const preCommit = fs.readFileSync(path.join(repositoryRoot, "src/maintainer/pre-commit.cts"), "utf8");
  assert.doesNotMatch(preCommit, /test:scrub-baseline/u);
});
