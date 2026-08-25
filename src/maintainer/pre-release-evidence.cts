#!/usr/bin/env node
/** Closed, metadata-only validator for immutable-subject pre-release evidence. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

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
const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const MAX_ARTIFACT_BYTES = 256 * 1024;
const MAX_CI_EVIDENCE_BYTES = 64 * 1024;
const SECRET_RE = /(?:bearer\s+[A-Za-z0-9._~+/=-]{12,}|(?:npm_token|node_auth_token|mcp[_ -]?(?:auth|token|credential))\s*[:=])/iu;

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

interface CliIo {
  readonly root?: string;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

interface CliArguments {
  readonly review: string;
  readonly security: string;
  readonly verification: string;
  readonly remote: string;
  readonly ciEvidence: string;
}

function parseArguments(argv: readonly string[]): CliArguments {
  failUnless(argv[0] === "--verify", "invalid_arguments");
  const values = new Map<string, string>();
  let fromGit = false;
  const valueFlags = new Set([
    "--review",
    "--security",
    "--verification",
    "--require-remote",
    "--require-ci-evidence",
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    failUnless(flag !== undefined, "invalid_arguments");
    if (flag === "--from-git") {
      failUnless(!fromGit, "invalid_arguments");
      fromGit = true;
      continue;
    }
    failUnless(valueFlags.has(flag) && !values.has(flag), "invalid_arguments");
    const value = argv[index + 1];
    failUnless(value !== undefined && value.length > 0 && !value.startsWith("--"), "invalid_arguments");
    values.set(flag, value);
    index += 1;
  }
  failUnless(fromGit && values.size === valueFlags.size, "invalid_arguments");
  const review = values.get("--review");
  const security = values.get("--security");
  const verification = values.get("--verification");
  const remote = values.get("--require-remote");
  const ciEvidence = values.get("--require-ci-evidence");
  failUnless(
    review !== undefined && security !== undefined && verification !== undefined &&
      remote !== undefined && ciEvidence !== undefined,
    "invalid_arguments",
  );
  return { review, security, verification, remote, ciEvidence };
}

function git(root: string, args: readonly string[]): string {
  const result = childProcess.spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
    timeout: 10_000,
  });
  failUnless(result.status === 0, "git_metadata_failed");
  return result.stdout.trim();
}

function exactArtifactPath(root: string, rawPath: string, expectedPath: string): string {
  failUnless(!path.isAbsolute(rawPath) && rawPath.replaceAll("\\", "/") === expectedPath, "invalid_artifact_path");
  const absolutePath = path.resolve(root, rawPath);
  const relative = path.relative(root, absolutePath);
  failUnless(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "invalid_artifact_path");
  const stat = fs.lstatSync(absolutePath);
  failUnless(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_ARTIFACT_BYTES, "invalid_artifact");
  return absolutePath;
}

function parseFrontmatter(filePath: string): JsonMap {
  const source = fs.readFileSync(filePath, "utf8");
  failUnless(!SECRET_RE.test(source), "secret_like_value");
  const normalized = source.replaceAll("\r\n", "\n");
  failUnless(normalized.startsWith("---\n"), "invalid_artifact");
  const end = normalized.indexOf("\n---\n", 4);
  failUnless(end >= 4, "invalid_artifact");
  const result: JsonMap = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/u.exec(line);
    failUnless(match !== null && match[1] !== undefined && match[2] !== undefined, "invalid_artifact");
    const key = match[1];
    const rawValue = match[2];
    failUnless(!Object.hasOwn(result, key), "invalid_artifact");
    if (rawValue === "0" || rawValue === "1") result[key] = Number(rawValue);
    else if (rawValue.startsWith("[")) {
      try { result[key] = JSON.parse(rawValue) as unknown; }
      catch { throw new PreReleaseEvidenceError("invalid_artifact"); }
    } else result[key] = rawValue;
  }
  return result;
}

function readReviewArtifact(filePath: string, expectedKind: "review" | "security" | "verification"): JsonMap {
  const value = parseFrontmatter(filePath);
  const shared = ["schemaVersion", "artifact", "subjectSha", "subjectTree", "verdict"];
  const expectedKeys = expectedKind === "review"
    ? [...shared, "openHigh", "openCritical"]
    : expectedKind === "security"
      ? [...shared, "openHighThreats", "openCriticalThreats"]
      : [...shared, "requirements", "decisions"];
  failUnless(exactKeys(value, expectedKeys), "invalid_artifact");
  failUnless(value.schemaVersion === 1 && value.artifact === expectedKind, "invalid_artifact");
  failUnless(validSha(value.subjectSha) && validSha(value.subjectTree), "invalid_artifact");
  return value;
}

function readCiEvidence(filePath: string): JsonMap {
  const stat = fs.lstatSync(filePath);
  failUnless(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_CI_EVIDENCE_BYTES, "invalid_ci_evidence");
  let value: unknown;
  try { value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown; }
  catch { throw new PreReleaseEvidenceError("invalid_ci_evidence"); }
  failUnless(exactKeys(value, ["jobs"]), "invalid_ci_evidence");
  return value;
}

function buildEvidence(root: string, parsed: CliArguments): JsonMap {
  const artifactPaths = [parsed.review, parsed.security, parsed.verification] as const;
  const resolvedArtifactPaths = artifactPaths.map((rawPath, index) =>
    exactArtifactPath(root, rawPath, EVIDENCE_PATHS[index] as string));
  failUnless(git(root, ["diff", "--name-only", "HEAD", "--", ...EVIDENCE_PATHS]) === "", "evidence_worktree_drift");
  const review = readReviewArtifact(resolvedArtifactPaths[0] as string, "review");
  const security = readReviewArtifact(resolvedArtifactPaths[1] as string, "security");
  const verification = readReviewArtifact(resolvedArtifactPaths[2] as string, "verification");
  failUnless(
    review.subjectSha === security.subjectSha && review.subjectSha === verification.subjectSha &&
      review.subjectTree === security.subjectTree && review.subjectTree === verification.subjectTree,
    "subject_mismatch",
  );
  const subjectSha = review.subjectSha as string;
  const subjectTree = review.subjectTree as string;
  failUnless(git(root, ["rev-parse", `${subjectSha}^{commit}`]) === subjectSha, "invalid_subject");
  failUnless(git(root, ["rev-parse", `${subjectSha}^{tree}`]) === subjectTree, "invalid_subject");
  const evidenceCommitSha = git(root, ["rev-parse", "HEAD"]);
  const parentSha = git(root, ["rev-parse", "HEAD^"]);
  const changedPaths = git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
    .split(/\r?\n/u).filter(Boolean);
  failUnless(parsed.remote === "origin/master", "invalid_remote_ref");
  const remoteHeadSha = git(root, ["rev-parse", "--verify", parsed.remote]);
  const ci = readCiEvidence(path.resolve(root, parsed.ciEvidence));
  return {
    schemaVersion: 1,
    subject: { sha: subjectSha, tree: subjectTree },
    artifacts: {
      review: {
        path: EVIDENCE_PATHS[0], subjectSha, subjectTree,
        verdict: review.verdict, openHigh: review.openHigh, openCritical: review.openCritical,
      },
      security: {
        path: EVIDENCE_PATHS[1], subjectSha, subjectTree,
        verdict: security.verdict,
        openHighThreats: security.openHighThreats,
        openCriticalThreats: security.openCriticalThreats,
      },
      verification: {
        path: EVIDENCE_PATHS[2], subjectSha, subjectTree,
        verdict: verification.verdict,
        requirements: verification.requirements,
        decisions: verification.decisions,
      },
    },
    evidenceCommit: { sha: evidenceCommitSha, parentSha, changedPaths },
    finalRef: { localHeadSha: evidenceCommitSha, remoteHeadSha },
    ci,
  };
}

export function runCli(argv: readonly string[] = process.argv.slice(2), io: CliIo = {}): number {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
  try {
    const root = fs.realpathSync(path.resolve(io.root ?? PACKAGE_ROOT));
    const result = validatePreReleaseEvidence(buildEvidence(root, parseArguments(argv)));
    stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof PreReleaseEvidenceError ? error.code : "pre_release_evidence_failed";
    stderr(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

exports.PreReleaseEvidenceError = PreReleaseEvidenceError;
exports.validatePreReleaseEvidence = validatePreReleaseEvidence;
exports.runCli = runCli;

if (require.main === module) process.exitCode = runCli();
