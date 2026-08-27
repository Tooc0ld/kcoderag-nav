const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const evidence = require("../../dist/maintainer/pre-release-evidence.cjs") as {
  readonly validatePreReleaseEvidence: (value: unknown) => Readonly<Record<string, unknown>>;
  readonly validatePhaseReadinessEvidence: (value: unknown) => Readonly<Record<string, unknown>>;
  readonly runCli: (
    argv: readonly string[],
    io: {
      readonly root: string;
      readonly stdout: (text: string) => void;
      readonly stderr: (text: string) => void;
    },
  ) => number;
};

test("phase readiness evidence stays closed and cannot promote NOT_RUN platform lanes", () => {
  const value = {
    schemaVersion: 1,
    result: "BLOCKED",
    candidateSubject: "1".repeat(40),
    candidateTree: "2".repeat(40),
    packageVersion: "0.3.0",
    packageProductTreeDigest: "3".repeat(64),
    artifactSha256: "4".repeat(64),
    memberCount: 7,
    dryRunCount: 1,
    actualPackCount: 1,
    localGuideDigest: "5".repeat(64),
    semanticReview: { verdict: "PASS", reviewedSubject: "6".repeat(40), reviewedTree: "7".repeat(40), blobCount: 5 },
    checks: ["dependency-audit", "build", "full-tests", "generated-qa", "generated-cursor", "docs-check", "local-guide", "retirement-audit", "git-brand-audit", "pack-audit", "tar-brand-audit", "required-smoke"].map((name) => ({ name, conclusion: "PASS" })),
    platformLanes: "NOT_RUN",
    externalActions: { tag: "NOT_RUN_BY_SCOPE", publish: "NOT_RUN_BY_SCOPE", registry_refetch: "NOT_RUN_BY_SCOPE" },
  };
  assert.deepEqual(evidence.validatePhaseReadinessEvidence(value), value);
  assert.throws(
    () => evidence.validatePhaseReadinessEvidence({ ...value, result: "PASS" }),
    (error: unknown) => (error as { code?: unknown }).code === "platform_lanes_incomplete",
  );
  assert.throws(
    () => evidence.validatePhaseReadinessEvidence({ ...value, rawOutput: "private" }),
    (error: unknown) => (error as { code?: unknown }).code === "invalid_readiness_schema",
  );
});

const SUBJECT_SHA = "1".repeat(40);
const SUBJECT_TREE = "2".repeat(40);
const EVIDENCE_SHA = "3".repeat(40);
const EVIDENCE_PATHS = Object.freeze([
  ".planning/phases/04-deployment-reliability/04-REVIEW.md",
  ".planning/phases/04-deployment-reliability/04-SECURITY.md",
  ".planning/phases/04-deployment-reliability/04-PRE-RELEASE-VERIFICATION.md",
] as const);
const REQUIREMENTS = Object.freeze([
  "PLAT-01", "PLAT-02", "PLAT-03", "LEG-01",
  String.fromCodePoint(0x4a, 0x58, 0x33, 0x2d, 0x30, 0x31),
  "TEST-10",
] as const);
const DECISIONS = Object.freeze(Array.from({ length: 28 }, (_, index) => `D-${String(index + 1).padStart(2, "0")}`));
const RECEIPTS = Object.freeze([
  {
    host: "claude", version: "2.1.241", verdict: "PASS",
    path: "fixtures/host-delivery/claude-2.1.241.json",
    receiptDigest: "bb00429dbca08a026604c6f2aeeac988d757fbe10751a92ed7b7d7c2093bd119",
  },
  {
    host: "codex", version: "0.146.1", verdict: "UNSUPPORTED",
    path: "fixtures/host-delivery/codex-0.146.1.json",
    receiptDigest: "c91ba5c2076543e24cb230a5b92799223f713dcd2746420f3a60c47e1ba25656",
  },
  {
    host: "cursor", version: "3.17.8", verdict: "UNSUPPORTED",
    path: "fixtures/host-delivery/cursor-3.17.8.json",
    receiptDigest: "851af61862a80bd9b3bbb1c1714fa23f3aafb208ddada0f4f0a41a047b49b8d1",
  },
  {
    host: "opencode", version: "1.18.23", verdict: "UNSUPPORTED",
    path: "fixtures/host-delivery/opencode-1.18.23.json",
    receiptDigest: "401716d80a6f77ce9d218fc6a56996c03132bfa90a6974681e6621ee30a05d45",
  },
] as const);
const READINESS_CHECKS = Object.freeze([
  "generated-qa", "generated-cursor", "pack-audit", "required-smoke",
  "docs-check", "security-review", "retirement-audit",
] as const);

function validFixture(): Record<string, any> {
  return {
    schemaVersion: 1,
    subject: { sha: SUBJECT_SHA, tree: SUBJECT_TREE },
    artifacts: {
      review: {
        path: EVIDENCE_PATHS[0],
        subjectSha: SUBJECT_SHA,
        subjectTree: SUBJECT_TREE,
        verdict: "CLEAN",
        openHigh: 0,
        openCritical: 0,
      },
      security: {
        path: EVIDENCE_PATHS[1],
        subjectSha: SUBJECT_SHA,
        subjectTree: SUBJECT_TREE,
        verdict: "SECURED",
        openHighThreats: 0,
        openCriticalThreats: 0,
      },
      verification: {
        path: EVIDENCE_PATHS[2],
        subjectSha: SUBJECT_SHA,
        subjectTree: SUBJECT_TREE,
        verdict: "PASS",
        requirements: [...REQUIREMENTS],
        decisions: [...DECISIONS],
        receipts: RECEIPTS.map((receipt) => ({ ...receipt })),
        checks: READINESS_CHECKS.map((name) => ({ name, conclusion: "PASS" })),
      },
    },
    evidenceCommit: {
      sha: EVIDENCE_SHA,
      parentSha: SUBJECT_SHA,
      changedPaths: [...EVIDENCE_PATHS],
    },
    finalRef: { localHeadSha: EVIDENCE_SHA, remoteHeadSha: EVIDENCE_SHA },
    ci: {
      jobs: [
        { os: "ubuntu", node: "22", headSha: EVIDENCE_SHA, conclusion: "success" },
        { os: "ubuntu", node: "24", headSha: EVIDENCE_SHA, conclusion: "success" },
        { os: "windows", node: "22", headSha: EVIDENCE_SHA, conclusion: "success" },
        { os: "windows", node: "24", headSha: EVIDENCE_SHA, conclusion: "success" },
      ],
    },
  };
}

function expectCode(mutator: (fixture: Record<string, any>) => void, code: string): void {
  const fixture = validFixture();
  mutator(fixture);
  assert.throws(
    () => evidence.validatePreReleaseEvidence(fixture),
    (error: unknown) => {
      assert.deepEqual(
        { name: (error as Error).name, message: (error as Error).message, code: (error as { code?: unknown }).code },
        { name: "PreReleaseEvidenceError", message: code, code },
      );
      return true;
    },
  );
}

test("accepts one immutable subject, evidence-only child, pushed head, and exact successful CI matrix", () => {
  const result = evidence.validatePreReleaseEvidence(validFixture());
  assert.deepEqual(result, {
    ok: true,
    subjectSha: SUBJECT_SHA,
    subjectTree: SUBJECT_TREE,
    evidenceCommitSha: EVIDENCE_SHA,
    requirementCount: 6,
    decisionCount: 28,
    receiptCount: 4,
    readinessCheckCount: 7,
    ciJobCount: 4,
  });
  assert.equal(Object.isFrozen(result), true);
});

test("rejects self-binding, stale subjects, non-evidence deltas, and final-head disagreement", () => {
  expectCode((fixture) => {
    fixture.subject.sha = EVIDENCE_SHA;
    fixture.artifacts.review.subjectSha = EVIDENCE_SHA;
    fixture.artifacts.security.subjectSha = EVIDENCE_SHA;
    fixture.artifacts.verification.subjectSha = EVIDENCE_SHA;
    fixture.evidenceCommit.parentSha = EVIDENCE_SHA;
  }, "evidence_self_binding");
  expectCode((fixture) => { fixture.artifacts.security.subjectTree = "4".repeat(40); }, "subject_mismatch");
  expectCode((fixture) => { fixture.evidenceCommit.changedPaths.push("src/runtime.cts"); }, "evidence_path_mismatch");
  expectCode((fixture) => { fixture.finalRef.remoteHeadSha = "4".repeat(40); }, "final_head_mismatch");
});

test("rejects bad verdicts and incomplete requirement or decision coverage", () => {
  expectCode((fixture) => { fixture.artifacts.review.verdict = "PASS"; }, "review_not_clean");
  expectCode((fixture) => { fixture.artifacts.security.openHighThreats = 1; }, "security_not_secured");
  expectCode((fixture) => { fixture.artifacts.verification.requirements.pop(); }, "verification_incomplete");
  expectCode((fixture) => { fixture.artifacts.verification.decisions[15] = "D-15"; }, "verification_incomplete");
});

test("requires exact receipt digests, mandatory Claude PASS, and closed readiness checks", () => {
  expectCode((fixture) => { fixture.artifacts.verification.receipts.pop(); }, "receipt_inventory_mismatch");
  expectCode((fixture) => {
    fixture.artifacts.verification.receipts.push({ ...RECEIPTS[0], host: "extra" });
  }, "receipt_inventory_mismatch");
  expectCode((fixture) => {
    fixture.artifacts.verification.receipts[0].receiptDigest = "4".repeat(64);
  }, "receipt_digest_mismatch");
  expectCode((fixture) => {
    fixture.artifacts.verification.receipts[0].verdict = "NOT_RUN";
  }, "receipt_verdict_mismatch");
  expectCode((fixture) => {
    fixture.artifacts.verification.receipts[1].verdict = "PASS";
  }, "receipt_verdict_mismatch");
  expectCode((fixture) => { fixture.artifacts.verification.checks.pop(); }, "readiness_incomplete");
  expectCode((fixture) => {
    fixture.artifacts.verification.checks.push({ name: "extra", conclusion: "PASS" });
  }, "readiness_incomplete");
  expectCode((fixture) => {
    fixture.artifacts.verification.checks[0].conclusion = "NOT_RUN";
  }, "readiness_incomplete");
  expectCode((fixture) => {
    fixture.artifacts.verification.checks[0].conclusion = "FAIL";
  }, "readiness_incomplete");
});

test("rejects secret-bearing evidence with one stable code and never echoes the value", () => {
  const sentinel = "Bearer pre-release-secret-value";
  const fixture = validFixture();
  fixture.artifacts.verification.checks[0].detail = sentinel;
  assert.throws(
    () => evidence.validatePreReleaseEvidence(fixture),
    (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, "secret_like_value");
      assert.equal((error as Error).message.includes(sentinel), false);
      return true;
    },
  );
});

test("rejects missing, extra, duplicate, failed, or stale CI lanes", () => {
  expectCode((fixture) => { fixture.ci.jobs.pop(); }, "ci_matrix_mismatch");
  expectCode((fixture) => {
    fixture.ci.jobs.push({ os: "linux", node: "22", headSha: EVIDENCE_SHA, conclusion: "success" });
  }, "invalid_evidence_schema");
  expectCode((fixture) => { fixture.ci.jobs[3] = { ...fixture.ci.jobs[2] }; }, "ci_matrix_mismatch");
  expectCode((fixture) => { fixture.ci.jobs[1].conclusion = "failure"; }, "ci_not_successful");
  expectCode((fixture) => { fixture.ci.jobs[0].headSha = SUBJECT_SHA; }, "ci_head_mismatch");
});

test("schema and diagnostics stay closed when untrusted fields or values are supplied", () => {
  expectCode((fixture) => { fixture.rawGithubResponse = "untrusted"; }, "invalid_evidence_schema");
  expectCode((fixture) => { fixture.ci.jobs[0].url = "https://example.invalid/run/1"; }, "secret_like_value");
  expectCode((fixture) => { fixture.artifacts.review.subjectSha = "A".repeat(40); }, "invalid_evidence_schema");
  expectCode((fixture) => { fixture.authorization = "Bearer not-for-diagnostics"; }, "secret_like_value");
});

function git(root: string, args: readonly string[]): string {
  return childProcess.execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function artifact(kind: "review" | "security" | "verification", subjectSha: string, subjectTree: string): string {
  const shared = [
    "---",
    "schemaVersion: 1",
    `artifact: ${kind}`,
    `subjectSha: ${subjectSha}`,
    `subjectTree: ${subjectTree}`,
  ];
  if (kind === "review") shared.push("verdict: CLEAN", "openHigh: 0", "openCritical: 0");
  else if (kind === "security") shared.push("verdict: SECURED", "openHighThreats: 0", "openCriticalThreats: 0");
  else shared.push(
    "verdict: PASS",
    `requirements: ${JSON.stringify(REQUIREMENTS)}`,
    `decisions: ${JSON.stringify(DECISIONS)}`,
    `receipts: ${JSON.stringify(RECEIPTS)}`,
    `checks: ${JSON.stringify(READINESS_CHECKS.map((name) => ({ name, conclusion: "PASS" })))}`,
  );
  return `${shared.join("\n")}\n---\n\n# ${kind}\n\nBound audit evidence.\n`;
}

function cliFixture(): { readonly root: string; readonly argv: readonly string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-pre-release-cli-"));
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  git(repo, ["init", "--quiet", "--initial-branch=master"]);
  git(repo, ["config", "user.email", "tests@example.invalid"]);
  git(repo, ["config", "user.name", "KCodeRag Tests"]);
  fs.writeFileSync(path.join(repo, "README.md"), "subject\n", "utf8");
  git(repo, ["add", "--", "README.md"]);
  git(repo, ["commit", "--quiet", "-m", "subject"]);
  const subjectSha = git(repo, ["rev-parse", "HEAD"]);
  const subjectTree = git(repo, ["rev-parse", "HEAD^{tree}"]);
  const phase = path.join(repo, ".planning", "phases", "04-deployment-reliability");
  fs.mkdirSync(phase, { recursive: true });
  const files = [
    ["04-REVIEW.md", artifact("review", subjectSha, subjectTree)],
    ["04-SECURITY.md", artifact("security", subjectSha, subjectTree)],
    ["04-PRE-RELEASE-VERIFICATION.md", artifact("verification", subjectSha, subjectTree)],
  ] as const;
  for (const [name, contents] of files) fs.writeFileSync(path.join(phase, name), contents, "utf8");
  git(repo, ["add", "--", ...files.map(([name]) => `.planning/phases/04-deployment-reliability/${name}`)]);
  git(repo, ["commit", "--quiet", "-m", "evidence"]);
  const evidenceSha = git(repo, ["rev-parse", "HEAD"]);
  childProcess.execFileSync("git", ["init", "--quiet", "--bare", remote], { stdio: "ignore" });
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "--quiet", "origin", "master"]);
  fs.writeFileSync(path.join(repo, "ci.json"), JSON.stringify({
    jobs: [
      { os: "ubuntu", node: "22", headSha: evidenceSha, conclusion: "success" },
      { os: "ubuntu", node: "24", headSha: evidenceSha, conclusion: "success" },
      { os: "windows", node: "22", headSha: evidenceSha, conclusion: "success" },
      { os: "windows", node: "24", headSha: evidenceSha, conclusion: "success" },
    ],
  }), "utf8");
  return {
    root,
    argv: [
      "--verify",
      "--review", ".planning/phases/04-deployment-reliability/04-REVIEW.md",
      "--security", ".planning/phases/04-deployment-reliability/04-SECURITY.md",
      "--verification", ".planning/phases/04-deployment-reliability/04-PRE-RELEASE-VERIFICATION.md",
      "--from-git",
      "--require-remote", "origin/master",
      "--require-ci-evidence", "ci.json",
    ],
  };
}

test("compiled CLI binds strict Markdown frontmatter to Git and normalized CI evidence", () => {
  const item = cliFixture();
  const repo = path.join(item.root, "repo");
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    assert.equal(evidence.runCli(item.argv, {
      root: repo,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    }), 0);
    assert.equal(stderr.length, 0);
    const result = JSON.parse(stdout.join("")) as Record<string, unknown>;
    assert.deepEqual(result, {
      ok: true,
      subjectSha: git(repo, ["rev-parse", "HEAD^"]),
      subjectTree: git(repo, ["rev-parse", "HEAD^^{tree}"]),
      evidenceCommitSha: git(repo, ["rev-parse", "HEAD"]),
      requirementCount: 6,
      decisionCount: 28,
      receiptCount: 4,
      readinessCheckCount: 7,
      ciJobCount: 4,
    });
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("compiled CLI rejects widened artifacts and CI evidence without echoing values", () => {
  for (const scenario of ["artifact", "ci"] as const) {
    const item = cliFixture();
    const repo = path.join(item.root, "repo");
    const output: string[] = [];
    try {
      if (scenario === "artifact") {
        const reviewPath = path.join(repo, ".planning", "phases", "04-deployment-reliability", "04-REVIEW.md");
        fs.writeFileSync(reviewPath, fs.readFileSync(reviewPath, "utf8").replace("verdict: CLEAN", "note: widened\nverdict: CLEAN"));
      } else {
        const ciPath = path.join(repo, "ci.json");
        const ci = JSON.parse(fs.readFileSync(ciPath, "utf8")) as Record<string, any>;
        ci.jobs[0].url = "https://example.invalid/private-run";
        fs.writeFileSync(ciPath, JSON.stringify(ci));
      }
      assert.equal(evidence.runCli(item.argv, {
        root: repo,
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
      }), 1);
      assert.equal(output.join("").includes("example.invalid"), false);
      assert.match(output.join(""), /"ok":false/);
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});
