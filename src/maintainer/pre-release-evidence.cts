#!/usr/bin/env node
/** Closed, metadata-only validator for immutable-subject pre-release evidence. */

type JsonMap = Record<string, any>;

export interface PreReleaseEvidenceResult {
  readonly ok: true;
  readonly subjectSha: string;
  readonly subjectTree: string;
  readonly evidenceCommitSha: string;
  readonly ciJobCount: 4;
}

const SHA_RE = /^[0-9a-f]{40}$/u;
const EVIDENCE_PATHS = Object.freeze([
  ".planning/phases/04-deployment-reliability/04-REVIEW.md",
  ".planning/phases/04-deployment-reliability/04-SECURITY.md",
  ".planning/phases/04-deployment-reliability/04-PRE-RELEASE-VERIFICATION.md",
] as const);
const REQUIREMENTS = Object.freeze(["DEP-01", "DEP-02", "DEP-03"] as const);
const DECISIONS = Object.freeze(Array.from(
  { length: 16 },
  (_, index) => `D-${String(index + 1).padStart(2, "0")}`,
));
const CI_TUPLES = Object.freeze([
  "ubuntu\0" + "22",
  "ubuntu\0" + "24",
  "windows\0" + "22",
  "windows\0" + "24",
] as const);

export class PreReleaseEvidenceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "PreReleaseEvidenceError";
    this.code = code;
  }
}

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new PreReleaseEvidenceError(code);
}

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is JsonMap {
  return isRecord(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function exactStringSet(value: unknown, expected: readonly string[], code: string): void {
  failUnless(Array.isArray(value) && value.length === expected.length, code);
  failUnless(value.every((item) => typeof item === "string"), code);
  const actual = [...value].sort().join("\0");
  failUnless(new Set(value).size === value.length && actual === [...expected].sort().join("\0"), code);
}

function validSha(value: unknown): value is string {
  return typeof value === "string" && SHA_RE.test(value);
}

export function validatePreReleaseEvidence(value: unknown): PreReleaseEvidenceResult {
  failUnless(exactKeys(value, [
    "schemaVersion",
    "subject",
    "artifacts",
    "evidenceCommit",
    "finalRef",
    "ci",
  ]), "invalid_evidence_schema");
  failUnless(value.schemaVersion === 1, "invalid_evidence_schema");

  failUnless(exactKeys(value.subject, ["sha", "tree"]), "invalid_evidence_schema");
  failUnless(validSha(value.subject.sha) && validSha(value.subject.tree), "invalid_subject");
  const subjectSha = value.subject.sha;
  const subjectTree = value.subject.tree;

  failUnless(exactKeys(value.artifacts, ["review", "security", "verification"]), "invalid_evidence_schema");
  failUnless(exactKeys(value.artifacts.review, [
    "path", "subjectSha", "subjectTree", "verdict", "openHigh", "openCritical",
  ]), "invalid_evidence_schema");
  failUnless(
    value.artifacts.review.path === EVIDENCE_PATHS[0]
      && validSha(value.artifacts.review.subjectSha)
      && validSha(value.artifacts.review.subjectTree),
    "invalid_evidence_schema",
  );
  failUnless(
    value.artifacts.review.subjectSha === subjectSha && value.artifacts.review.subjectTree === subjectTree,
    "subject_mismatch",
  );
  failUnless(
    value.artifacts.review.verdict === "CLEAN"
      && value.artifacts.review.openHigh === 0
      && value.artifacts.review.openCritical === 0,
    "review_not_clean",
  );

  failUnless(exactKeys(value.artifacts.security, [
    "path", "subjectSha", "subjectTree", "verdict", "openHighThreats", "openCriticalThreats",
  ]), "invalid_evidence_schema");
  failUnless(
    value.artifacts.security.path === EVIDENCE_PATHS[1]
      && validSha(value.artifacts.security.subjectSha)
      && validSha(value.artifacts.security.subjectTree),
    "invalid_evidence_schema",
  );
  failUnless(
    value.artifacts.security.subjectSha === subjectSha && value.artifacts.security.subjectTree === subjectTree,
    "subject_mismatch",
  );
  failUnless(
    value.artifacts.security.verdict === "SECURED"
      && value.artifacts.security.openHighThreats === 0
      && value.artifacts.security.openCriticalThreats === 0,
    "security_not_secured",
  );

  failUnless(exactKeys(value.artifacts.verification, [
    "path", "subjectSha", "subjectTree", "verdict", "requirements", "decisions",
  ]), "invalid_evidence_schema");
  failUnless(
    value.artifacts.verification.path === EVIDENCE_PATHS[2]
      && validSha(value.artifacts.verification.subjectSha)
      && validSha(value.artifacts.verification.subjectTree),
    "invalid_evidence_schema",
  );
  failUnless(
    value.artifacts.verification.subjectSha === subjectSha
      && value.artifacts.verification.subjectTree === subjectTree,
    "subject_mismatch",
  );
  failUnless(value.artifacts.verification.verdict === "PASS", "verification_incomplete");
  exactStringSet(value.artifacts.verification.requirements, REQUIREMENTS, "verification_incomplete");
  exactStringSet(value.artifacts.verification.decisions, DECISIONS, "verification_incomplete");

  failUnless(exactKeys(value.evidenceCommit, ["sha", "parentSha", "changedPaths"]), "invalid_evidence_schema");
  failUnless(validSha(value.evidenceCommit.sha) && validSha(value.evidenceCommit.parentSha), "invalid_evidence_commit");
  failUnless(value.evidenceCommit.sha !== subjectSha, "evidence_self_binding");
  failUnless(value.evidenceCommit.parentSha === subjectSha, "evidence_parent_mismatch");
  exactStringSet(value.evidenceCommit.changedPaths, EVIDENCE_PATHS, "evidence_path_mismatch");

  failUnless(exactKeys(value.finalRef, ["localHeadSha", "remoteHeadSha"]), "invalid_evidence_schema");
  failUnless(validSha(value.finalRef.localHeadSha) && validSha(value.finalRef.remoteHeadSha), "invalid_final_head");
  failUnless(
    value.finalRef.localHeadSha === value.evidenceCommit.sha
      && value.finalRef.remoteHeadSha === value.evidenceCommit.sha,
    "final_head_mismatch",
  );

  failUnless(exactKeys(value.ci, ["jobs"]), "invalid_evidence_schema");
  failUnless(Array.isArray(value.ci.jobs) && value.ci.jobs.length <= 8, "invalid_evidence_schema");
  const tuples: string[] = [];
  for (const job of value.ci.jobs) {
    failUnless(exactKeys(job, ["os", "node", "headSha", "conclusion"]), "invalid_evidence_schema");
    failUnless(
      (job.os === "ubuntu" || job.os === "windows") && (job.node === "22" || job.node === "24"),
      "invalid_evidence_schema",
    );
    failUnless(validSha(job.headSha), "invalid_evidence_schema");
    failUnless(job.headSha === value.evidenceCommit.sha, "ci_head_mismatch");
    failUnless(job.conclusion === "success", "ci_not_successful");
    tuples.push(`${job.os}\0${job.node}`);
  }
  failUnless(
    tuples.length === CI_TUPLES.length
      && new Set(tuples).size === tuples.length
      && tuples.sort().join("\0") === [...CI_TUPLES].sort().join("\0"),
    "ci_matrix_mismatch",
  );

  return Object.freeze({
    ok: true,
    subjectSha,
    subjectTree,
    evidenceCommitSha: value.evidenceCommit.sha,
    ciJobCount: 4,
  });
}

exports.PreReleaseEvidenceError = PreReleaseEvidenceError;
exports.validatePreReleaseEvidence = validatePreReleaseEvidence;
