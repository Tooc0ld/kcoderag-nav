const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

interface GenerationEvidence {
  readonly ok: boolean;
  readonly changedPaths: readonly string[];
  readonly writtenPaths: readonly string[];
}

interface ReleaseModule {
  readonly RELEASE_OWNED_PATHS: readonly string[];
  readonly VERSION_MANIFEST_PATHS: readonly string[];
  ReleaseError: new (code: string) => Error & { code: string };
  prepareRelease(options: {
    readonly root: string;
    readonly level: "patch" | "minor" | "major";
    readonly dryRun: boolean;
    readonly yes: boolean;
    readonly failAfter?: "commit-before-rev-parse" | "commit" | "tag";
    readonly runGates?: (root: string) => void;
    readonly runGenerator?: (input: {
      readonly root: string;
      readonly check: boolean;
    }) => GenerationEvidence;
  }): {
    readonly ok: true;
    readonly dryRun: boolean;
    readonly previousVersion: string;
    readonly version: string;
    readonly tag: string;
    readonly commit: string | null;
    readonly releasePaths: readonly string[];
  };
}

const release = require("../../dist/maintainer/release.cjs") as ReleaseModule;
const repositoryRoot = path.resolve(__dirname, "../..");

function git(root: string, args: readonly string[]): string {
  return childProcess.execFileSync("git", [...args], { cwd: root, encoding: "utf8" }).trim();
}

function publicStatus(root: string): readonly string[] {
  return git(root, ["status", "--short", "--untracked-files=all"])
    .split(/\r?\n/u)
    .filter((line) => line.length > 0 && !/^.. \.planning(?:\/|$)|^.. \.gsd(?:\/|$)/u.test(line));
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-release-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "release-test@example.invalid"]);
  git(root, ["config", "user.name", "Release Test"]);
  fs.writeFileSync(
    path.join(root, ".gitignore"),
    "/node_modules/\n/dist/\n/dist-tests/\n",
    "utf8",
  );
  writeJson(root, "package.json", { name: "kcoderag-nav", version: "1.2.3" });
  writeJson(root, "package-lock.json", {
    name: "kcoderag-nav",
    version: "1.2.3",
    lockfileVersion: 3,
    packages: { "": { name: "kcoderag-nav", version: "1.2.3" } },
  });
  for (const manifest of release.VERSION_MANIFEST_PATHS) {
    writeJson(root, manifest, { name: path.basename(path.dirname(manifest)), version: "1.2.3" });
  }
  fs.mkdirSync(path.join(root, ".planning"), { recursive: true });
  fs.mkdirSync(path.join(root, ".gsd"), { recursive: true });
  fs.writeFileSync(path.join(root, ".planning", "state.json"), "planning baseline\n", "utf8");
  fs.writeFileSync(path.join(root, ".gsd", "activity.jsonl"), "gsd baseline\n", "utf8");
  git(root, ["add", ".gitignore", "package.json", "package-lock.json", ...release.VERSION_MANIFEST_PATHS]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

function generator(
  observed: readonly string[] = release.VERSION_MANIFEST_PATHS,
  mutateIgnored?: ".planning" | ".gsd",
): NonNullable<Parameters<typeof release.prepareRelease>[0]["runGenerator"]> {
  return ({ root, check }) => {
    if (check) return { ok: true, changedPaths: [], writtenPaths: [] };
    const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version as string;
    for (const manifest of release.VERSION_MANIFEST_PATHS) {
      const target = path.join(root, ...manifest.split("/"));
      const value = JSON.parse(fs.readFileSync(target, "utf8")) as Record<string, unknown>;
      value.version = version;
      fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }
    if (mutateIgnored !== undefined) {
      fs.writeFileSync(path.join(root, mutateIgnored, "mutated.txt"), "unexpected\n", "utf8");
    }
    return { ok: true, changedPaths: observed, writtenPaths: observed };
  };
}

function expectCode(run: () => unknown, code: string): void {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as Error & { code: string }).code === code,
  );
}

test("creates one exact QA/Cursor release commit and matching immutable tag", () => {
  const root = createFixture();
  const result = release.prepareRelease({
    root,
    level: "minor",
    dryRun: false,
    yes: true,
    runGates() {},
    runGenerator: generator(),
  });

  assert.equal(result.previousVersion, "1.2.3");
  assert.equal(result.version, "1.3.0");
  assert.equal(result.tag, "v1.3.0");
  assert.match(result.commit ?? "", /^[0-9a-f]{40}$/u);
  assert.deepEqual(result.releasePaths, release.RELEASE_OWNED_PATHS);
  assert.deepEqual(
    git(root, ["show", "--pretty=format:", "--name-only", "HEAD"]).split(/\r?\n/u).filter(Boolean).sort(),
    [...release.RELEASE_OWNED_PATHS].sort(),
  );
  assert.equal(git(root, ["tag", "--points-at", "HEAD"]), "v1.3.0");
  assert.deepEqual(publicStatus(root), []);
});

test("post-commit discovery, post-commit, and post-tag failures restore every release mutation", () => {
  for (const failAfter of ["commit-before-rev-parse", "commit", "tag"] as const) {
    const root = createFixture();
    const originalHead = git(root, ["rev-parse", "HEAD"]);
    const originalStatus = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const originalFiles = new Map(release.RELEASE_OWNED_PATHS.map((relativePath) => [
      relativePath,
      fs.readFileSync(path.join(root, ...relativePath.split("/"))),
    ]));

    expectCode(
      () => release.prepareRelease({
        root,
        level: "patch",
        dryRun: false,
        yes: true,
        failAfter,
        runGates() {},
        runGenerator: generator(),
      }),
      failAfter === "commit-before-rev-parse"
        ? "injected_before_release_commit_discovery"
        : failAfter === "commit"
          ? "injected_after_commit"
          : "injected_after_tag",
    );

    assert.equal(git(root, ["rev-parse", "HEAD"]), originalHead, failAfter);
    assert.equal(git(root, ["tag", "--list", "v1.2.4"]), "", failAfter);
    assert.equal(
      git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
      originalStatus,
      failAfter,
    );
    for (const [relativePath, bytes] of originalFiles) {
      assert.deepEqual(
        fs.readFileSync(path.join(root, ...relativePath.split("/"))),
        bytes,
        `${failAfter}:${relativePath}`,
      );
    }
  }
});

test("accepts the canonical repository root through a filesystem alias", (context) => {
  const root = createFixture();
  const subdirectory = path.join(root, "nested");
  fs.mkdirSync(subdirectory);
  expectCode(
    () => release.prepareRelease({
      root: subdirectory,
      level: "patch",
      dryRun: true,
      yes: false,
      runGates() {},
      runGenerator() { return { ok: true, changedPaths: [], writtenPaths: [] }; },
    }),
    "invalid_repository_root",
  );
  const alias = path.join(path.dirname(root), `${path.basename(root)}-alias`);
  try {
    fs.symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    context.skip(`directory alias unavailable: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`);
    return;
  }
  try {
    const result = release.prepareRelease({
      root: alias,
      level: "patch",
      dryRun: true,
      yes: false,
      runGates() {},
      runGenerator() { return { ok: true, changedPaths: [], writtenPaths: [] }; },
    });
    assert.equal(result.version, "1.2.4");
  } finally {
    fs.rmSync(alias, { force: true });
  }
});

test("release commit preserves tracked local planning changes outside the exact release paths", () => {
  const root = createFixture();
  const trackedState = path.join(root, ".planning", "tracked.json");
  fs.writeFileSync(trackedState, "baseline\n", "utf8");
  git(root, ["add", ".planning/tracked.json"]);
  git(root, ["commit", "-q", "-m", "track planning state"]);
  fs.writeFileSync(trackedState, "local state\n", "utf8");

  const result = release.prepareRelease({
    root,
    level: "patch",
    dryRun: false,
    yes: true,
    runGates() {},
    runGenerator: generator(),
  });

  assert.equal(result.version, "1.2.4");
  assert.equal(fs.readFileSync(trackedState, "utf8"), "local state\n");
  assert.deepEqual(
    git(root, ["show", "--pretty=format:", "--name-only", "HEAD"]).split(/\r?\n/u).filter(Boolean).sort(),
    [...release.RELEASE_OWNED_PATHS].sort(),
  );
  assert.equal(git(root, ["status", "--short", "--", ".planning/tracked.json"]), "M .planning/tracked.json");
});

test("allows only root build ignores and rejects every other dirty source/product path", () => {
  const root = createFixture();
  for (const relativePath of ["node_modules/probe", "dist/probe", "dist-tests/probe"]) {
    const target = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "ignored\n", "utf8");
  }
  assert.deepEqual(publicStatus(root), []);

  const nested = path.join(root, "src", "node_modules", "not-ignored.txt");
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, "dirty\n", "utf8");
  expectCode(
    () => release.prepareRelease({ root, level: "patch", dryRun: true, yes: false, runGates() {}, runGenerator: generator() }),
    "dirty_worktree",
  );
});

test("rejects existing tags, version drift, gate failure, and missing confirmation", () => {
  const tagged = createFixture();
  git(tagged, ["tag", "v1.2.4"]);
  expectCode(
    () => release.prepareRelease({ root: tagged, level: "patch", dryRun: true, yes: false, runGates() {}, runGenerator: generator() }),
    "tag_exists",
  );

  const drifted = createFixture();
  writeJson(drifted, release.VERSION_MANIFEST_PATHS[0] ?? "", { version: "9.9.9" });
  git(drifted, ["add", release.VERSION_MANIFEST_PATHS[0] ?? ""]);
  git(drifted, ["commit", "-q", "-m", "drift"]);
  expectCode(
    () => release.prepareRelease({ root: drifted, level: "patch", dryRun: true, yes: false, runGates() {}, runGenerator: generator() }),
    "version_drift",
  );

  const failed = createFixture();
  expectCode(
    () => release.prepareRelease({ root: failed, level: "patch", dryRun: true, yes: false, runGates() { throw new Error("gate"); }, runGenerator: generator() }),
    "gate_failed",
  );
  expectCode(
    () => release.prepareRelease({ root: createFixture(), level: "patch", dryRun: false, yes: false, runGates() {}, runGenerator: generator() }),
    "confirmation_required",
  );
});

test("rejects short, extra, cross-group, and ignored-local-state generator writes", () => {
  for (const observed of [
    release.VERSION_MANIFEST_PATHS.slice(1),
    [...release.VERSION_MANIFEST_PATHS, "kcoderag-qa/README.md"],
  ]) {
    const root = createFixture();
    const baseline = git(root, ["status", "--short", "--untracked-files=all"]);
    expectCode(
      () => release.prepareRelease({ root, level: "patch", dryRun: false, yes: true, runGates() {}, runGenerator: generator(observed) }),
      "generator_write_set_drift",
    );
    assert.equal(git(root, ["status", "--short", "--untracked-files=all"]), baseline);
  }

  for (const localState of [".planning", ".gsd"] as const) {
    const root = createFixture();
    expectCode(
      () => release.prepareRelease({ root, level: "patch", dryRun: false, yes: true, runGates() {}, runGenerator: generator(release.VERSION_MANIFEST_PATHS, localState) }),
      "ignored_state_changed",
    );
  }
});

test("real repository snapshot dry-run tolerates local GSD state and preserves exact status", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-release-real-"));
  childProcess.execFileSync("git", ["clone", "--quiet", "--no-local", repositoryRoot, root], {
    stdio: "ignore",
  });
  for (const localState of [".planning", ".gsd"]) {
    const source = path.join(repositoryRoot, localState);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(root, localState), { recursive: true, force: true });
  }
  const before = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const result = release.prepareRelease({
    root,
    level: "patch",
    dryRun: true,
    yes: false,
    runGates() {},
    runGenerator() { return { ok: true, changedPaths: [], writtenPaths: [] }; },
  });
  const after = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const sourceVersion = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")).version as string;
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(sourceVersion);
  assert.notEqual(match, null);
  assert.equal(result.tag, `v${match?.[1]}.${match?.[2]}.${Number(match?.[3]) + 1}`);
  assert.equal(after, before);
});
