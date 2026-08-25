const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const evidence = require("../../dist/maintainer/pre-release-evidence.cjs") as {
  readonly validatePreReleaseEvidence: (value: unknown) => Readonly<Record<string, unknown>>;
};

const SUBJECT_SHA = "1".repeat(40);
const SUBJECT_TREE = "2".repeat(40);
const EVIDENCE_SHA = "3".repeat(40);
const EVIDENCE_PATHS = Object.freeze([
  ".planning/phases/04-deployment-reliability/04-REVIEW.md",
  ".planning/phases/04-deployment-reliability/04-SECURITY.md",
  ".planning/phases/04-deployment-reliability/04-PRE-RELEASE-VERIFICATION.md",
] as const);
const REQUIREMENTS = Object.freeze(["DEP-01", "DEP-02", "DEP-03"] as const);
const DECISIONS = Object.freeze(Array.from({ length: 16 }, (_, index) => `D-${String(index + 1).padStart(2, "0")}`));

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
  expectCode((fixture) => { fixture.ci.jobs[0].url = "https://example.invalid/run/1"; }, "invalid_evidence_schema");
  expectCode((fixture) => { fixture.artifacts.review.subjectSha = SUBJECT_SHA.toUpperCase(); }, "invalid_subject");
  expectCode((fixture) => { fixture.authorization = "Bearer not-for-diagnostics"; }, "invalid_evidence_schema");
});
