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

