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
  readonly requirementCount: 6;
  readonly decisionCount: 28;
  readonly receiptCount: 4;
  readonly readinessCheckCount: 7;
  readonly ciJobCount: 4;
}

const SHA_RE = /^[0-9a-f]{40}$/u;
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
const DECISIONS = Object.freeze(Array.from(
  { length: 28 },
  (_, index) => `D-${String(index + 1).padStart(2, "0")}`,
));
const RECEIPTS = Object.freeze([
  Object.freeze({
    host: "claude", version: "2.1.241", verdict: "PASS",
    path: "fixtures/host-delivery/claude-2.1.241.json",
    receiptDigest: "bb00429dbca08a026604c6f2aeeac988d757fbe10751a92ed7b7d7c2093bd119",
  }),
  Object.freeze({
    host: "codex", version: "0.146.1", verdict: "UNSUPPORTED",
    path: "fixtures/host-delivery/codex-0.146.1.json",
    receiptDigest: "c91ba5c2076543e24cb230a5b92799223f713dcd2746420f3a60c47e1ba25656",
  }),
  Object.freeze({
    host: "cursor", version: "3.17.8", verdict: "UNSUPPORTED",
    path: "fixtures/host-delivery/cursor-3.17.8.json",
    receiptDigest: "851af61862a80bd9b3bbb1c1714fa23f3aafb208ddada0f4f0a41a047b49b8d1",
  }),
  Object.freeze({
    host: "opencode", version: "1.18.23", verdict: "UNSUPPORTED",
    path: "fixtures/host-delivery/opencode-1.18.23.json",
    receiptDigest: "401716d80a6f77ce9d218fc6a56996c03132bfa90a6974681e6621ee30a05d45",
  }),
] as const);
const READINESS_CHECKS = Object.freeze([
  "generated-qa", "generated-cursor", "pack-audit", "required-smoke",
  "docs-check", "security-review", "retirement-audit",
] as const);
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
const SECRET_KEY_RE = /^(?:authorization|body|command|credential|environment|header|npm_token|node_auth_token|stderr|stdout|token|secret|url)$/iu;
const DIGEST_RE = /^[a-f0-9]{64}$/u;
const MAX_EVIDENCE_NODES = 512;
const MAX_EVIDENCE_DEPTH = 8;
const PHASE_READINESS_CHECKS = Object.freeze([
  "dependency-audit", "build", "full-tests", "generated-qa", "generated-cursor",
  "docs-check", "local-guide", "retirement-audit", "git-brand-audit", "pack-audit",
  "tar-brand-audit", "required-smoke",
] as const);
const PHASE_LANE_IDS = Object.freeze([
  "linux-node22", "linux-node24", "windows-node22", "windows-node24",
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

function assertSafeEvidence(value: unknown): void {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length > 0) {
    const item = pending.pop();
    failUnless(item !== undefined, "invalid_evidence_schema");
    visited += 1;
    failUnless(visited <= MAX_EVIDENCE_NODES && item.depth <= MAX_EVIDENCE_DEPTH, "invalid_evidence_schema");
    if (typeof item.value === "string") {
      failUnless(item.value.length <= 4096, "invalid_evidence_schema");
      failUnless(!SECRET_RE.test(item.value), "secret_like_value");
    } else if (Array.isArray(item.value)) {
      failUnless(item.value.length <= 128, "invalid_evidence_schema");
      for (const child of item.value) pending.push({ value: child, depth: item.depth + 1 });
    } else if (isRecord(item.value)) {
      const entries = Object.entries(item.value);
      failUnless(entries.length <= 128, "invalid_evidence_schema");
      for (const [key, child] of entries) {
        failUnless(!SECRET_KEY_RE.test(key), "secret_like_value");
        pending.push({ value: child, depth: item.depth + 1 });
      }
    } else {
      failUnless(
        item.value === null || typeof item.value === "boolean" ||
          (typeof item.value === "number" && Number.isSafeInteger(item.value)),
        "invalid_evidence_schema",
      );
    }
  }
}

function validateReceipts(value: unknown): void {
  failUnless(Array.isArray(value) && value.length === RECEIPTS.length, "receipt_inventory_mismatch");
  const observedHosts = new Set<string>();
  for (const receipt of value) {
    failUnless(
      exactKeys(receipt, ["host", "version", "verdict", "path", "receiptDigest"])
        && typeof receipt.host === "string",
      "receipt_inventory_mismatch",
    );
    const expected = RECEIPTS.find((candidate) => candidate.host === receipt.host);
    failUnless(expected !== undefined && !observedHosts.has(receipt.host), "receipt_inventory_mismatch");
    observedHosts.add(receipt.host);
    failUnless(receipt.version === expected.version && receipt.path === expected.path, "receipt_inventory_mismatch");
    failUnless(
      typeof receipt.receiptDigest === "string"
        && DIGEST_RE.test(receipt.receiptDigest)
        && receipt.receiptDigest === expected.receiptDigest,
      "receipt_digest_mismatch",
    );
    failUnless(receipt.verdict === expected.verdict, "receipt_verdict_mismatch");
  }
  failUnless(observedHosts.size === RECEIPTS.length, "receipt_inventory_mismatch");
}

function validateReadinessChecks(value: unknown): void {
  failUnless(Array.isArray(value) && value.length === READINESS_CHECKS.length, "readiness_incomplete");
  const observed: string[] = [];
  for (const check of value) {
    failUnless(
      exactKeys(check, ["name", "conclusion"])
        && typeof check.name === "string"
        && check.conclusion === "PASS",
      "readiness_incomplete",
    );
    observed.push(check.name);
  }
  exactStringSet(observed, READINESS_CHECKS, "readiness_incomplete");
}

/** Validate the closed metadata-only Phase 04.2 readiness result without promoting absent lanes. */
export function validatePhaseReadinessEvidence(value: unknown): Readonly<JsonMap> {
  assertSafeEvidence(value);
  failUnless(exactKeys(value, [
    "schemaVersion", "result", "candidateSubject", "candidateTree", "packageVersion",
    "packageProductTreeDigest", "artifactSha256", "memberCount", "dryRunCount", "actualPackCount",
    "localGuideDigest", "semanticReview", "checks", "platformLanes", "externalActions",
  ]), "invalid_readiness_schema");
  failUnless(
    value.schemaVersion === 1
      && (value.result === "PASS" || value.result === "BLOCKED")
      && validSha(value.candidateSubject)
      && validSha(value.candidateTree)
      && value.packageVersion === "0.3.0"
      && typeof value.packageProductTreeDigest === "string"
      && DIGEST_RE.test(value.packageProductTreeDigest)
      && typeof value.artifactSha256 === "string"
      && DIGEST_RE.test(value.artifactSha256)
      && Number.isSafeInteger(value.memberCount)
      && value.memberCount > 0
      && value.dryRunCount === 1
      && value.actualPackCount === 1
      && typeof value.localGuideDigest === "string"
      && DIGEST_RE.test(value.localGuideDigest),
    "invalid_readiness_schema",
  );
  failUnless(exactKeys(value.semanticReview, [
    "verdict", "reviewedSubject", "reviewedTree", "blobCount",
  ]), "invalid_readiness_schema");
  failUnless(
    value.semanticReview.verdict === "PASS"
      && validSha(value.semanticReview.reviewedSubject)
      && validSha(value.semanticReview.reviewedTree)
      && value.semanticReview.blobCount === 5,
    "semantic_review_stale",
  );
  failUnless(Array.isArray(value.checks) && value.checks.length === PHASE_READINESS_CHECKS.length,
    "readiness_incomplete");
  const checkNames: string[] = [];
  for (const check of value.checks) {
    failUnless(exactKeys(check, ["name", "conclusion"])
      && typeof check.name === "string" && check.conclusion === "PASS", "readiness_incomplete");
    checkNames.push(check.name);
  }
  exactStringSet(checkNames, PHASE_READINESS_CHECKS, "readiness_incomplete");
  if (value.platformLanes === "NOT_RUN") {
    failUnless(value.result === "BLOCKED", "platform_lanes_incomplete");
  } else {
    failUnless(Array.isArray(value.platformLanes) && value.platformLanes.length === PHASE_LANE_IDS.length,
      "platform_lanes_incomplete");
    const laneIds: string[] = [];
    for (const lane of value.platformLanes) {
      failUnless(exactKeys(lane, [
        "laneId", "candidateSubject", "artifactSha256", "memberCount", "conclusion",
      ]), "platform_lanes_incomplete");
      failUnless(
        typeof lane.laneId === "string"
          && lane.candidateSubject === value.candidateSubject
          && lane.artifactSha256 === value.artifactSha256
          && lane.memberCount === value.memberCount
          && lane.conclusion === "PASS",
        "platform_lanes_incomplete",
      );
      laneIds.push(lane.laneId);
    }
    exactStringSet(laneIds, PHASE_LANE_IDS, "platform_lanes_incomplete");
    failUnless(value.result === "PASS", "platform_lanes_incomplete");
  }
  failUnless(exactKeys(value.externalActions, ["tag", "publish", "registry_refetch"]),
    "invalid_readiness_schema");
  failUnless(
    value.externalActions.tag === "NOT_RUN_BY_SCOPE"
      && value.externalActions.publish === "NOT_RUN_BY_SCOPE"
      && value.externalActions.registry_refetch === "NOT_RUN_BY_SCOPE",
    "external_action_out_of_scope",
  );
  return Object.freeze(value);
}

export function validatePreReleaseEvidence(value: unknown): PreReleaseEvidenceResult {
  assertSafeEvidence(value);
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
    "path", "subjectSha", "subjectTree", "verdict", "requirements", "decisions", "receipts", "checks",
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
  validateReceipts(value.artifacts.verification.receipts);
  validateReadinessChecks(value.artifacts.verification.checks);

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
    requirementCount: 6,
    decisionCount: 28,
    receiptCount: 4,
    readinessCheckCount: 7,
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
      : [...shared, "requirements", "decisions", "receipts", "checks"];
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
        receipts: verification.receipts,
        checks: verification.checks,
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
exports.validatePhaseReadinessEvidence = validatePhaseReadinessEvidence;
exports.runCli = runCli;

if (require.main === module) process.exitCode = runCli();
