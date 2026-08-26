const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const childProcess = require("node:child_process") as typeof import("node:child_process");

type JsonMap = Record<string, any>;

interface AuditOptions {
  readonly siblingRepo: string;
  readonly navRepo: string;
  readonly expectedGuideDigest?: string;
  readonly expectedGuideCommit?: string;
}

interface AuditModule {
  captureBaseline(options: AuditOptions): JsonMap;
  auditAuthoritativeGuide(options: AuditOptions): JsonMap;
  recordSiblingReceipt(baseline: JsonMap, options: AuditOptions): JsonMap;
  verifySiblingReceipt(receipt: JsonMap): JsonMap;
  verifySiblingSummary(summaryText: string, receipt: JsonMap): void;
  runCli(
    argv: readonly string[],
    options: AuditOptions & {
      readonly writeStdout?: (text: string) => void;
      readonly writeStderr?: (text: string) => void;
    },
  ): number;
}

const audit = require("../../dist/maintainer/sibling-guide-audit.cjs") as AuditModule;
const GUIDE = "MCP_QA_EXPERIENCE_GUIDE.md";

function sha256File(filePath: string): string {
  return require("node:crypto").createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function git(repo: string, args: readonly string[]): string {
  return childProcess.execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function initializeRepo(root: string, files: Readonly<Record<string, string>>): void {
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "tests@example.invalid"]);
  git(root, ["config", "user.name", "KCodeRag Tests"]);
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, "utf8");
  }
  git(root, ["add", "--", ...Object.keys(files)]);
  git(root, ["commit", "--quiet", "-m", "initial"]);
}

function fixture(): { readonly root: string; readonly siblingRepo: string; readonly navRepo: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-sibling-audit-"));
  const siblingRepo = path.join(root, "KCodeRag");
  const navRepo = path.join(root, "kcoderag-nav");
  initializeRepo(siblingRepo, { [GUIDE]: "# QA guide\n", "unrelated.txt": "original\n" });
  initializeRepo(navRepo, { "README.md": "# Nav\n" });
  fs.writeFileSync(path.join(siblingRepo, "unrelated.txt"), "dirty but preserved\n", "utf8");
  fs.writeFileSync(path.join(siblingRepo, "untracked.txt"), "untracked\n", "utf8");
  return { root, siblingRepo, navRepo };
}

function commitGuide(siblingRepo: string, content = "# QA guide\n\nNode.js 22+ via npx.\n"): void {
  fs.writeFileSync(path.join(siblingRepo, GUIDE), content, "utf8");
  git(siblingRepo, ["add", "--", GUIDE]);
  git(siblingRepo, ["commit", "--quiet", "-m", "docs: update QA guide"]);
}

function code(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as Error & { code: unknown }).code)
    : undefined;
}

test("captures a sanitized sorted baseline without reading unrelated content", () => {
  const item = fixture();
  try {
    const baseline = audit.captureBaseline(item);
    assert.equal(baseline.schemaVersion, 2);
    assert.equal(baseline.guide, GUIDE);
    assert.equal(baseline.guideClean, true);
    assert.match(baseline.head, /^[0-9a-f]{40}$/);
    assert.match(baseline.siblingRepoDigest, /^[0-9a-f]{64}$/);
    assert.equal(baseline.guideDigest, sha256File(path.join(item.siblingRepo, GUIDE)));
    assert.equal(Object.hasOwn(baseline, "siblingRepo"), false);
    assert.deepEqual(
      baseline.status,
      [
        { code: " M", path: "unrelated.txt" },
        { code: "??", path: "untracked.txt" },
      ],
    );
    assert.equal(JSON.stringify(baseline).includes("dirty but preserved"), false);
    assert.equal(JSON.stringify(baseline).includes(item.root), false);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("records and verifies guide-only commit evidence with unchanged unrelated status", () => {
  const item = fixture();
  try {
    const baseline = audit.captureBaseline(item);
    commitGuide(item.siblingRepo);
    const receipt = audit.recordSiblingReceipt(baseline, item);
    assert.deepEqual(audit.verifySiblingReceipt(receipt), receipt);
    assert.equal(receipt.schemaVersion, 3);
    assert.equal(receipt.beforeUnrelatedStatusDigest, receipt.afterUnrelatedStatusDigest);
    assert.equal(receipt.commitParent, receipt.baselineHead);
    assert.deepEqual(receipt.commitFiles, [GUIDE]);
    assert.equal(receipt.baselineGuideDigest, baseline.guideDigest);
    assert.equal(receipt.guideDigest, sha256File(path.join(item.siblingRepo, GUIDE)));
    assert.equal(receipt.guideCommit, receipt.kcoderag_head);
    assert.equal(receipt.guideCommitParent, receipt.commitParent);
    assert.equal(receipt.guideCommitDigest, receipt.guideDigest);
    assert.equal(Object.hasOwn(receipt, "siblingRepo"), false);
    assert.equal(receipt.secret_scan, true);
    assert.equal(receipt.unrelatedStatusPreserved, true);
    assert.equal(receipt.dualHeadsValid, true);
    assert.match(receipt.kcoderag_head, /^[0-9a-f]{40}$/);
    assert.match(receipt.kcoderag_nav_head, /^[0-9a-f]{40}$/);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("audits the exact authoritative guide commit and digest without changing unrelated dirt or staging", () => {
  const item = fixture();
  try {
    commitGuide(item.siblingRepo);
    const expectedGuideCommit = git(item.siblingRepo, ["rev-parse", "HEAD"]);
    const expectedGuideDigest = sha256File(path.join(item.siblingRepo, GUIDE));
    git(item.siblingRepo, ["add", "--", "unrelated.txt"]);
    const statusBefore = git(item.siblingRepo, ["status", "--short", "--untracked-files=all"]);
    const indexBefore = git(item.siblingRepo, ["diff", "--cached", "--binary"]);

    const result = audit.auditAuthoritativeGuide({
      ...item,
      expectedGuideCommit,
      expectedGuideDigest,
    });
    assert.deepEqual(result.guideCommitFiles, [GUIDE]);
    assert.equal(result.guideDigest, expectedGuideDigest);
    assert.equal(result.guideCommit, expectedGuideCommit);
    assert.equal(result.guideCommitAncestor, true);
    assert.equal(result.guideUnchangedSinceCommit, true);
    assert.equal(result.navCopyAbsent, true);
    assert.equal(JSON.stringify(result).includes(item.root), false);
    assert.equal(git(item.siblingRepo, ["status", "--short", "--untracked-files=all"]), statusBefore);
    assert.equal(git(item.siblingRepo, ["diff", "--cached", "--binary"]), indexBefore);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("authoritative audit rejects nav copies, digest drift, unrelated commit paths, and secret guide bytes", () => {
  for (const scenario of ["nav-copy", "digest", "extra-path", "secret"] as const) {
    const item = fixture();
    try {
      const content = scenario === "secret"
        ? "# QA guide\n\nBearer secret-value-that-must-never-echo\n"
        : "# QA guide\n\nNode.js 22+ via npx.\n";
      fs.writeFileSync(path.join(item.siblingRepo, GUIDE), content, "utf8");
      if (scenario === "extra-path") {
        fs.writeFileSync(path.join(item.siblingRepo, "extra.md"), "extra\n", "utf8");
        git(item.siblingRepo, ["add", "--", GUIDE, "extra.md"]);
      } else {
        git(item.siblingRepo, ["add", "--", GUIDE]);
      }
      git(item.siblingRepo, ["commit", "--quiet", "-m", "guide evidence"]);
      const expectedGuideCommit = git(item.siblingRepo, ["rev-parse", "HEAD"]);
      const expectedGuideDigest = sha256File(path.join(item.siblingRepo, GUIDE));
      if (scenario === "nav-copy") fs.writeFileSync(path.join(item.navRepo, GUIDE), "copy\n", "utf8");

      const options = {
        ...item,
        expectedGuideCommit,
        expectedGuideDigest: scenario === "digest" ? "0".repeat(64) : expectedGuideDigest,
      };
      const expectedCode = {
        "nav-copy": "local_guide_copy",
        digest: "guide_digest_mismatch",
        "extra-path": "invalid_commit_files",
        secret: "secret_like_value",
      }[scenario];
      assert.throws(
        () => audit.auditAuthoritativeGuide(options),
        (error: unknown) => code(error) === expectedCode && !(error as Error).message.includes("secret-value"),
      );
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("authoritative audit rejects a guide commit from divergent history even when bytes match", () => {
  const item = fixture();
  try {
    const mainBranch = git(item.siblingRepo, ["branch", "--show-current"]);
    git(item.siblingRepo, ["switch", "--quiet", "-c", "side-guide"]);
    commitGuide(item.siblingRepo, "# QA guide\n\nShared final bytes.\n");
    git(item.siblingRepo, ["commit", "--quiet", "--amend", "-m", "docs: side QA guide"]);
    const sideCommit = git(item.siblingRepo, ["rev-parse", "HEAD"]);
    git(item.siblingRepo, ["switch", "--quiet", mainBranch]);
    commitGuide(item.siblingRepo, "# QA guide\n\nShared final bytes.\n");
    const expectedGuideDigest = sha256File(path.join(item.siblingRepo, GUIDE));

    assert.throws(
      () => audit.auditAuthoritativeGuide({
        ...item,
        expectedGuideCommit: sideCommit,
        expectedGuideDigest,
      }),
      (error: unknown) => code(error) === "guide_history_diverged",
    );
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("refuses added, removed, or changed unrelated sibling status", () => {
  for (const mutate of [
    (repo: string) => fs.writeFileSync(path.join(repo, "added.txt"), "added\n"),
    (repo: string) => fs.rmSync(path.join(repo, "untracked.txt")),
    (repo: string) => { git(repo, ["add", "--", "unrelated.txt"]); },
  ]) {
    const item = fixture();
    try {
      const baseline = audit.captureBaseline(item);
      commitGuide(item.siblingRepo);
      mutate(item.siblingRepo);
      assert.throws(
        () => audit.recordSiblingReceipt(baseline, item),
        (error: unknown) => code(error) === "unrelated_status_changed",
      );
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("receipt verification rejects commit binding drift, extra files, invalid hashes, status drift, and secrets", () => {
  const item = fixture();
  try {
    const baseline = audit.captureBaseline(item);
    commitGuide(item.siblingRepo);
    const valid = audit.recordSiblingReceipt(baseline, item);
    for (const [mutate, expected] of [
      [(receipt: JsonMap) => receipt.commitFiles.push("extra.md"), "invalid_commit_files"],
      [(receipt: JsonMap) => { receipt.kcoderag_head = "abc"; }, "invalid_hash"],
      [(receipt: JsonMap) => { receipt.afterUnrelatedStatusDigest = "0".repeat(64); }, "unrelated_status_changed"],
      [(receipt: JsonMap) => { receipt.guideCommit = "f".repeat(40); }, "guide_commit_binding_mismatch"],
      [(receipt: JsonMap) => { receipt.guideCommitDigest = "f".repeat(64); }, "guide_commit_binding_mismatch"],
      [(receipt: JsonMap) => { receipt.unrelatedStatusPreserved = false; }, "invalid_receipt"],
      [(receipt: JsonMap) => { receipt.dualHeadsValid = false; }, "invalid_receipt"],
      [(receipt: JsonMap) => { receipt.baselineDigest = "0".repeat(64); }, "baseline_digest_mismatch"],
      [(receipt: JsonMap) => { receipt.note = "Bearer secret-value-that-must-never-echo"; }, "secret_like_value"],
    ] as const) {
      const receipt = JSON.parse(JSON.stringify(valid)) as JsonMap;
      mutate(receipt);
      assert.throws(
        () => audit.verifySiblingReceipt(receipt),
        (error: unknown) => code(error) === expected,
      );
    }
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("summary verification requires exact validated receipt hashes", () => {
  const item = fixture();
  try {
    const baseline = audit.captureBaseline(item);
    commitGuide(item.siblingRepo);
    const receipt = audit.recordSiblingReceipt(baseline, item);
    const summary = `---\nkcoderag_nav_head: ${receipt.kcoderag_nav_head}\nkcoderag_head: ${receipt.kcoderag_head}\n---\n`;
    assert.doesNotThrow(() => audit.verifySiblingSummary(summary, receipt));
    assert.throws(
      () => audit.verifySiblingSummary(summary.replace(receipt.kcoderag_head, "f".repeat(40)), receipt),
      (error: unknown) => code(error) === "summary_hash_mismatch",
    );
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("all four compiled CLI modes write or verify only explicitly named evidence files", () => {
  const item = fixture();
  const evidence = path.join(item.navRepo, "evidence");
  fs.mkdirSync(evidence);
  const baselinePath = path.join(evidence, "baseline.json");
  const receiptPath = path.join(evidence, "receipt.json");
  const summaryPath = path.join(evidence, "summary.md");
  const outputs: string[] = [];
  const options = { ...item, writeStdout: (text: string) => outputs.push(text), writeStderr: (text: string) => outputs.push(text) };
  try {
    assert.equal(audit.runCli(["--capture-baseline", baselinePath], options), 0);
    commitGuide(item.siblingRepo);
    assert.equal(audit.runCli(["--record-receipt", receiptPath, "--baseline", baselinePath], options), 0);
    assert.equal(audit.runCli(["--verify-receipt", receiptPath], options), 0);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as JsonMap;
    fs.writeFileSync(
      summaryPath,
      `---\nkcoderag_nav_head: ${receipt.kcoderag_nav_head}\nkcoderag_head: ${receipt.kcoderag_head}\n---\n`,
      "utf8",
    );
    assert.equal(audit.runCli(["--verify-summary", summaryPath, "--receipt", receiptPath], options), 0);
    assert.equal(outputs.every((output) => !output.includes(item.siblingRepo)), true);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});
