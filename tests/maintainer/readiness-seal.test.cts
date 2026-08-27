const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const seal = require("../../dist/maintainer/readiness-seal.cjs") as {
  readonly runReadinessSeal: (options: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
};

function git(root: string, args: readonly string[]): string {
  return childProcess.execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(root: string, relativePath: string, contents: string): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents, "utf8");
}

function fixture(): { readonly root: string; readonly candidate: string; readonly final: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-readiness-seal-"));
  git(root, ["init", "--quiet", "--initial-branch=master"]);
  git(root, ["config", "user.email", "tests@example.invalid"]);
  git(root, ["config", "user.name", "KCodeRag Tests"]);
  write(root, "package.json", JSON.stringify({
    name: "kcoderag-nav", version: "0.3.0", files: ["dist/bin/kcoderag-nav.cjs", "docs/MCP_QA_EXPERIENCE_GUIDE.md"],
  }) + "\n");
  write(root, "dist/bin/kcoderag-nav.cjs", "#!/usr/bin/env node\n");
  write(root, "docs/MCP_QA_EXPERIENCE_GUIDE.md", "local authority\n");
  git(root, ["add", "--", "."]);
  git(root, ["commit", "--quiet", "-m", "candidate"]);
  const candidate = git(root, ["rev-parse", "HEAD"]);
  write(root, ".planning/phases/04.2-public-debranding/04.2-10-SUMMARY.md", "summary child\n");
  git(root, ["add", "--", ".planning/phases/04.2-public-debranding/04.2-10-SUMMARY.md"]);
  git(root, ["commit", "--quiet", "-m", "documentation child"]);
  return { root, candidate, final: git(root, ["rev-parse", "HEAD"]) };
}

test("documentation-only final child passes without renaming it as the tested candidate", () => {
  const item = fixture();
  try {
    const before = git(item.root, ["status", "--porcelain=v1"]);
    const result = seal.runReadinessSeal({
      root: item.root,
      candidateSubject: item.candidate,
      finalSubject: item.final,
    });
    assert.equal(result.ok, true);
    assert.equal(result.candidateSubject, item.candidate);
    assert.equal(result.finalSubject, item.final);
    assert.notEqual(result.candidateSubject, result.finalSubject);
    assert.equal(result.changedDocumentationCount, 1);
    assert.equal(git(item.root, ["status", "--porcelain=v1"]), before);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("seal rejects package or local-guide drift and final Git brand findings", () => {
  for (const relativePath of ["dist/bin/kcoderag-nav.cjs", "docs/MCP_QA_EXPERIENCE_GUIDE.md"] as const) {
    const item = fixture();
    try {
      write(item.root, relativePath, "changed product\n");
      git(item.root, ["add", "--", relativePath]);
      git(item.root, ["commit", "--quiet", "-m", "product drift"]);
      assert.throws(
        () => seal.runReadinessSeal({
          root: item.root, candidateSubject: item.candidate, finalSubject: git(item.root, ["rev-parse", "HEAD"]),
        }),
        (error: unknown) => (error as { code?: unknown }).code === "candidate_product_drift",
      );
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});
