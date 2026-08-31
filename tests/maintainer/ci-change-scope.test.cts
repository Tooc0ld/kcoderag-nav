const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type CiChangeScope = "documentation" | "full";

interface CiScopeResult {
  readonly scope: CiChangeScope;
  readonly changedCount: number;
}

interface CiChangeScopeModule {
  classifyChangedPaths(paths: readonly string[]): CiChangeScope;
  evaluateCiChangeScope(options: {
    readonly eventName: string;
    readonly event: unknown;
    readonly githubSha?: string;
    readonly readDiff?: (range: string) => Buffer;
  }): CiScopeResult;
  main(
    argv: readonly string[],
    environment: Readonly<Record<string, string | undefined>>,
    readDiff?: (range: string) => Buffer,
  ): number;
  resolveDiffRange(eventName: string, event: unknown, githubSha?: string): string | undefined;
}

const scope = require("../../dist/maintainer/ci-change-scope.cjs") as CiChangeScopeModule;
const compiledCli = path.resolve(__dirname, "../../dist/maintainer/ci-change-scope.cjs");
const A_SHA = "a".repeat(40);
const B_SHA = "b".repeat(40);

function git(cwd: string, args: readonly string[]): string {
  return childProcess.execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

test("the closed documentation set covers only local authority and planning paths", () => {
  assert.equal(
    scope.classifyChangedPaths([
      "README.md",
      "docs/MCP_QA_EXPERIENCE_GUIDE.md",
      ".planning/STATE.md",
      ".planning/quick/example/SUMMARY.md",
    ]),
    "documentation",
  );
  for (const productPath of [
    "AGENTS.md",
    "package.json",
    ".github/workflows/ci.yml",
    "src/maintainer/docs-check.cts",
    "plugin-src/capabilities/code-style-nudge/skill/SKILL.md",
    "kcoderag-qa/README.md",
    "kcoderag-cursor/rules/kcoderag-navigation.mdc",
  ]) {
    assert.equal(scope.classifyChangedPaths([productPath]), "full", productPath);
  }
  assert.equal(scope.classifyChangedPaths(["README.md", "src/bin/kcoderag-nav.cts"]), "full");
});

test("empty, unsafe, ambiguous, and oversized path sets fail safe to full CI", () => {
  for (const changedPaths of [
    [],
    ["../README.md"],
    ["docs\\guide.md"],
    ["/docs/guide.md"],
    ["docs//guide.md"],
    ["docs/guide.md\nsource.cts"],
  ]) {
    assert.equal(scope.classifyChangedPaths(changedPaths), "full");
  }
  assert.equal(
    scope.classifyChangedPaths(Array.from({ length: 3001 }, (_, index) => `docs/${String(index)}.md`)),
    "full",
  );
});

test("push and pull request ranges are strict while new branches and manual runs select full", () => {
  assert.equal(scope.resolveDiffRange("push", { before: A_SHA, after: B_SHA }), `${A_SHA}..${B_SHA}`);
  assert.equal(
    scope.resolveDiffRange("pull_request", {
      pull_request: { base: { sha: A_SHA }, head: { sha: B_SHA } },
    }),
    `${A_SHA}...${B_SHA}`,
  );
  assert.equal(scope.resolveDiffRange("push", { before: "0".repeat(40), after: B_SHA }), undefined);
  assert.equal(scope.resolveDiffRange("push", { before: A_SHA, after: "bad" }, B_SHA), `${A_SHA}..${B_SHA}`);
  assert.equal(scope.resolveDiffRange("workflow_dispatch", {}, B_SHA), undefined);
  assert.equal(scope.resolveDiffRange("pull_request", { pull_request: {} }), undefined);
});

test("bounded NUL-delimited diffs classify without exposing path contents", () => {
  let observedRange = "";
  const documentation = scope.evaluateCiChangeScope({
    eventName: "push",
    event: { before: A_SHA, after: B_SHA },
    readDiff(range) {
      observedRange = range;
      return Buffer.from("README.md\0docs/guide.md\0", "utf8");
    },
  });
  assert.equal(observedRange, `${A_SHA}..${B_SHA}`);
  assert.deepEqual(documentation, { scope: "documentation", changedCount: 2 });

  assert.deepEqual(
    scope.evaluateCiChangeScope({
      eventName: "push",
      event: { before: A_SHA, after: B_SHA },
      readDiff: () => Buffer.from("README.md\0src/index.cts\0", "utf8"),
    }),
    { scope: "full", changedCount: 2 },
  );
  assert.deepEqual(
    scope.evaluateCiChangeScope({
      eventName: "push",
      event: { before: A_SHA, after: B_SHA },
      readDiff: () => {
        throw new Error("private failure");
      },
    }),
    { scope: "full", changedCount: 0 },
  );
  assert.deepEqual(
    scope.evaluateCiChangeScope({ eventName: "workflow_dispatch", event: {} }),
    { scope: "full", changedCount: 0 },
  );
});

test("CLI writes only bounded metadata and falls back to full on malformed events", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-ci-scope-"));
  try {
    const eventPath = path.join(root, "event.json");
    const outputPath = path.join(root, "output.txt");
    fs.writeFileSync(eventPath, JSON.stringify({ before: A_SHA, after: B_SHA, secret: "do-not-copy" }), "utf8");
    assert.equal(
      scope.main(
        [],
        {
          GITHUB_EVENT_NAME: "push",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
          GITHUB_SHA: B_SHA,
        },
        () => Buffer.from("docs/guide.md\0", "utf8"),
      ),
      0,
    );
    assert.equal(fs.readFileSync(outputPath, "utf8"), "scope=documentation\nchanged_count=1\n");

    fs.writeFileSync(eventPath, "{", "utf8");
    assert.equal(
      scope.main([], { GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath }),
      0,
    );
    assert.equal(
      fs.readFileSync(outputPath, "utf8"),
      "scope=documentation\nchanged_count=1\nscope=full\nchanged_count=0\n",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("compiled CLI classifies a real two-dot Git documentation diff", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-ci-scope-git-"));
  try {
    git(root, ["init", "--quiet"]);
    git(root, ["config", "user.email", "ci-scope@example.invalid"]);
    git(root, ["config", "user.name", "CI Scope Test"]);
    fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "--quiet", "-m", "baseline"]);
    const before = git(root, ["rev-parse", "HEAD"]);

    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs", "guide.md"), "guide\n", "utf8");
    git(root, ["add", "docs/guide.md"]);
    git(root, ["commit", "--quiet", "-m", "docs"]);
    const after = git(root, ["rev-parse", "HEAD"]);

    const eventPath = path.join(root, "event.json");
    const outputPath = path.join(root, "output.txt");
    fs.writeFileSync(eventPath, JSON.stringify({ before, after }), "utf8");
    const result = childProcess.spawnSync(process.execPath, [compiledCli], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "push",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_SHA: after,
      },
      windowsHide: true,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(fs.readFileSync(outputPath, "utf8"), "scope=documentation\nchanged_count=1\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
