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
}

interface AuditModule {
  captureBaseline(options: AuditOptions): JsonMap;
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
    assert.equal(baseline.schemaVersion, 1);
    assert.equal(baseline.guide, GUIDE);
    assert.equal(baseline.guideClean, true);
    assert.match(baseline.head, /^[0-9a-f]{40}$/);
    assert.deepEqual(
      baseline.status,
      [
        { code: " M", path: "unrelated.txt" },
        { code: "??", path: "untracked.txt" },
      ],
    );
    assert.equal(JSON.stringify(baseline).includes("dirty but preserved"), false);
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
    assert.equal(receipt.beforeUnrelatedStatusDigest, receipt.afterUnrelatedStatusDigest);
    assert.equal(receipt.commitParent, receipt.baselineHead);
    assert.deepEqual(receipt.commitFiles, [GUIDE]);
    assert.equal(receipt.secret_scan, true);
    assert.match(receipt.kcoderag_head, /^[0-9a-f]{40}$/);
    assert.match(receipt.kcoderag_nav_head, /^[0-9a-f]{40}$/);
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

test("receipt verification rejects extra commit files, invalid hashes, digest drift, and secret values", () => {
  const item = fixture();
  try {
    const baseline = audit.captureBaseline(item);
    commitGuide(item.siblingRepo);
    const valid = audit.recordSiblingReceipt(baseline, item);
    for (const [mutate, expected] of [
      [(receipt: JsonMap) => receipt.commitFiles.push("extra.md"), "invalid_commit_files"],
      [(receipt: JsonMap) => { receipt.kcoderag_head = "abc"; }, "invalid_hash"],
      [(receipt: JsonMap) => { receipt.afterUnrelatedStatusDigest = "0".repeat(64); }, "unrelated_status_changed"],
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
