#!/usr/bin/env node
/** Bind the exact candidate tgz to four real GitHub Actions platform-lane receipts. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const artifactUpload = require("./github-artifact-upload.cjs") as typeof import("./github-artifact-upload.cjs");
const packAudit = require("./pack-audit.cjs") as typeof import("./pack-audit.cjs");
const releaseReadiness = require("./release-readiness.cjs") as typeof import("./release-readiness.cjs");
const tarArchive = require("./tar-archive.cjs") as typeof import("./tar-archive.cjs");
const hostSmoke = require("../smoke/host-smoke.cjs") as typeof import("../smoke/host-smoke.cjs");

import type { HostId } from "../core/contracts.cjs";
import type { CandidatePackageArtifactLease } from "./release-readiness.cjs";
import type { SmokeRunResult } from "../smoke/host-smoke.cjs";

type JsonMap = Record<string, unknown>;

export interface ReadinessWorkflowDependencies {
  readonly runHostSmoke?: typeof hostSmoke.runHostSmoke;
  readonly uploadCandidateArtifactFromLease?: typeof artifactUpload.uploadCandidateArtifactFromLease;
}

export type PlatformLaneId = "linux-node22" | "linux-node24" | "windows-node22" | "windows-node24";

export interface PlatformLaneReceipt {
  readonly schemaVersion: 1;
  readonly laneId: PlatformLaneId;
  readonly os: "linux" | "windows";
  readonly nodeMajor: 22 | 24;
  readonly candidateSubject: string;
  readonly triggerEvent: "push";
  readonly triggerRef: "refs/heads/readiness/04.2-candidate";
  readonly headSha: string;
  readonly workflowCommit: string;
  readonly workflowBlobOid: string;
  readonly artifactSha256: string;
  readonly memberCount: number;
  readonly dryRunCount: 1;
  readonly actualPackCount: 1;
  readonly workflowConclusion: "PASS";
  readonly hostOutcomes: Readonly<Record<HostId, "PASS">>;
  readonly packagedOnly: true;
  readonly trueHostAcceptance: "NOT_RUN_BY_SCOPE";
}

const LANE_IDS: readonly PlatformLaneId[] = Object.freeze([
  "linux-node22",
  "linux-node24",
  "windows-node22",
  "windows-node24",
]);
const HOST_IDS: readonly HostId[] = Object.freeze(["codex", "claude", "cursor", "opencode", "zcode"]);
const RECEIPT_KEYS = Object.freeze([
  "schemaVersion",
  "laneId",
  "os",
  "nodeMajor",
  "candidateSubject",
  "triggerEvent",
  "triggerRef",
  "headSha",
  "workflowCommit",
  "workflowBlobOid",
  "artifactSha256",
  "memberCount",
  "dryRunCount",
  "actualPackCount",
  "workflowConclusion",
  "hostOutcomes",
  "packagedOnly",
  "trueHostAcceptance",
] as const);
const CANDIDATE_REF = "refs/heads/readiness/04.2-candidate" as const;
const WORKFLOW_PATH = ".github/workflows/readiness.yml";
const ACCEPTANCE_WORKFLOW_PATH = ".github/workflows/acceptance.yml";
const ACCEPTANCE_PROFILE = "acceptance" as const;
const PHASE05_REF_PREFIX = "refs/heads/phase05-live-candidate-";
const BRANCH_REF_RE = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,239}$/u;
const OBJECT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const PACKAGE_VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const PACKAGE_NAME = "kcoderag-nav" as const;
const MAX_RECEIPT_BYTES = 16 * 1024;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = tarArchive.DEFAULT_TAR_ARCHIVE_LIMITS.maxArchiveBytes;
const SAFE_DOWNLOADED_ARTIFACT_CODES = Object.freeze([
  "downloaded_artifact_environment_invalid",
  "downloaded_artifact_root_invalid",
  "downloaded_artifact_name_invalid",
  "downloaded_artifact_path_invalid",
  "downloaded_artifact_open_invalid",
  "downloaded_artifact_archive_invalid",
  "downloaded_artifact_identity_invalid",
  "downloaded_artifact_package_invalid",
] as const);
const SAFE_UPLOAD_STAGES = Object.freeze([
  "create_artifact", "stage_block", "commit_block_list", "finalize_artifact",
] as const);
const SAFE_UPLOAD_STATUS_CLASSES = Object.freeze([
  "network", "timeout", "3xx", "4xx", "408", "429", "5xx", "other",
] as const);

export class ReadinessWorkflowError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReadinessWorkflowError";
    this.code = code;
  }
}

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ReadinessWorkflowError(code);
}

/** Render only a closed failure class as a GitHub annotation; untrusted values are never serialized. */
export function hostedLaneFailureAnnotation(reason: string, enabled: boolean): string | undefined {
  return enabled && SAFE_DOWNLOADED_ARTIFACT_CODES.some((code) => code === reason)
    ? `::error title=readiness-lane::${reason}`
    : undefined;
}

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function downloadedPackageIdentity(entries: readonly import("./tar-archive.cjs").TarArchiveEntry[]): {
  readonly name: typeof PACKAGE_NAME;
  readonly version: string;
} {
  const manifests = entries.filter((entry) => entry.path === "package.json");
  failUnless(
    manifests.length === 1
      && manifests[0]?.type === "file"
      && manifests[0].body.length > 0
      && manifests[0].body.length <= MAX_PACKAGE_MANIFEST_BYTES,
    "downloaded_artifact_package_invalid",
  );
  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(manifests[0].body);
    failUnless(!text.includes("\ufeff"), "downloaded_artifact_package_invalid");
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof ReadinessWorkflowError) throw error;
    throw new ReadinessWorkflowError("downloaded_artifact_package_invalid");
  }
  failUnless(
    isRecord(parsed)
      && parsed.name === PACKAGE_NAME
      && typeof parsed.version === "string"
      && PACKAGE_VERSION_RE.test(parsed.version),
    "downloaded_artifact_package_invalid",
  );
  return Object.freeze({ name: PACKAGE_NAME, version: parsed.version });
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is JsonMap {
  return isRecord(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function parseJson(value: string): unknown {
  failUnless(value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_RECEIPT_BYTES,
    "invalid_lane_receipt");
  try {
    return JSON.parse(value);
  } catch {
    throw new ReadinessWorkflowError("invalid_lane_receipt");
  }
}

function laneShape(laneId: PlatformLaneId): { readonly os: "linux" | "windows"; readonly nodeMajor: 22 | 24 } {
  switch (laneId) {
    case "linux-node22": return Object.freeze({ os: "linux", nodeMajor: 22 });
    case "linux-node24": return Object.freeze({ os: "linux", nodeMajor: 24 });
    case "windows-node22": return Object.freeze({ os: "windows", nodeMajor: 22 });
    case "windows-node24": return Object.freeze({ os: "windows", nodeMajor: 24 });
  }
}

function parseHostOutcomes(value: unknown): Readonly<Record<HostId, "PASS">> {
  failUnless(hasExactKeys(value, HOST_IDS), "invalid_lane_receipt");
  for (const host of HOST_IDS) failUnless(value[host] === "PASS", "invalid_lane_receipt");
  return Object.freeze({
    codex: "PASS",
    claude: "PASS",
    cursor: "PASS",
    opencode: "PASS",
    zcode: "PASS",
  });
}

/** Parse only the closed metadata receipt schema used by the final four-lane validator. */
export function parsePlatformLaneReceipt(value: unknown): PlatformLaneReceipt {
  failUnless(hasExactKeys(value, RECEIPT_KEYS), "invalid_lane_receipt");
  failUnless(typeof value.laneId === "string" && LANE_IDS.includes(value.laneId as PlatformLaneId),
    "invalid_lane_receipt");
  const laneId = value.laneId as PlatformLaneId;
  const shape = laneShape(laneId);
  failUnless(
    value.schemaVersion === 1
      && value.os === shape.os
      && value.nodeMajor === shape.nodeMajor
      && typeof value.candidateSubject === "string"
      && OBJECT_ID_RE.test(value.candidateSubject)
      && value.triggerEvent === "push"
      && value.triggerRef === CANDIDATE_REF
      && typeof value.headSha === "string"
      && OBJECT_ID_RE.test(value.headSha)
      && typeof value.workflowCommit === "string"
      && OBJECT_ID_RE.test(value.workflowCommit)
      && typeof value.workflowBlobOid === "string"
      && OBJECT_ID_RE.test(value.workflowBlobOid)
      && typeof value.artifactSha256 === "string"
      && SHA256_RE.test(value.artifactSha256)
      && Number.isSafeInteger(value.memberCount)
      && (value.memberCount as number) > 0
      && value.dryRunCount === 1
      && value.actualPackCount === 1
      && value.workflowConclusion === "PASS"
      && value.packagedOnly === true
      && value.trueHostAcceptance === "NOT_RUN_BY_SCOPE",
    "invalid_lane_receipt",
  );
  return Object.freeze({
    schemaVersion: 1,
    laneId,
    os: shape.os,
    nodeMajor: shape.nodeMajor,
    candidateSubject: value.candidateSubject,
    triggerEvent: "push",
    triggerRef: CANDIDATE_REF,
    headSha: value.headSha,
    workflowCommit: value.workflowCommit,
    workflowBlobOid: value.workflowBlobOid,
    artifactSha256: value.artifactSha256,
    memberCount: value.memberCount as number,
    dryRunCount: 1,
    actualPackCount: 1,
    workflowConclusion: "PASS",
    hostOutcomes: parseHostOutcomes(value.hostOutcomes),
    packagedOnly: true,
    trueHostAcceptance: "NOT_RUN_BY_SCOPE",
  });
}

function gitObject(root: string, subject: string, relativePath: string): string {
  try {
    const value = childProcess.execFileSync("git", ["-C", root, "rev-parse", `${subject}:${relativePath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
      maxBuffer: 16 * 1024,
      windowsHide: true,
    }).trim();
    failUnless(OBJECT_ID_RE.test(value), "platform_lane_mismatch");
    return value;
  } catch (error) {
    if (error instanceof ReadinessWorkflowError) throw error;
    throw new ReadinessWorkflowError("platform_lane_mismatch");
  }
}

/** Require the exact four receipts and bind their workflow blob to the candidate commit. */
export function verifyPlatformLaneSet(
  receipts: readonly unknown[],
  options: {
    readonly root: string;
    readonly candidateSubject: string;
    readonly artifactSha256: string;
    readonly memberCount: number;
  },
): readonly PlatformLaneReceipt[] {
  failUnless(
    Array.isArray(receipts)
      && receipts.length === LANE_IDS.length
      && OBJECT_ID_RE.test(options.candidateSubject)
      && SHA256_RE.test(options.artifactSha256)
      && Number.isSafeInteger(options.memberCount)
      && options.memberCount > 0,
    "platform_lanes_incomplete",
  );
  let parsed: readonly PlatformLaneReceipt[];
  try {
    parsed = receipts.map(parsePlatformLaneReceipt);
  } catch (error) {
    if (error instanceof ReadinessWorkflowError && error.code === "invalid_lane_receipt") {
      throw new ReadinessWorkflowError("platform_lane_mismatch");
    }
    throw error;
  }
  const byLane = new Map(parsed.map((receipt) => [receipt.laneId, receipt]));
  failUnless(byLane.size === LANE_IDS.length && LANE_IDS.every((laneId) => byLane.has(laneId)),
    "platform_lanes_incomplete");
  const workflowBlobOid = gitObject(path.resolve(options.root), options.candidateSubject, WORKFLOW_PATH);
  const ordered = LANE_IDS.map((laneId) => byLane.get(laneId) as PlatformLaneReceipt);
  for (const receipt of ordered) {
    failUnless(
      receipt.candidateSubject === options.candidateSubject
        && receipt.triggerEvent === "push"
        && receipt.triggerRef === CANDIDATE_REF
        && receipt.headSha === options.candidateSubject
        && receipt.workflowCommit === options.candidateSubject
        && receipt.workflowBlobOid === workflowBlobOid
        && receipt.artifactSha256 === options.artifactSha256
        && receipt.memberCount === options.memberCount
        && receipt.workflowConclusion === "PASS"
        && receipt.packagedOnly === true
        && receipt.trueHostAcceptance === "NOT_RUN_BY_SCOPE",
      "platform_lane_mismatch",
    );
  }
  return Object.freeze(ordered);
}

function acceptanceDispatchRefMatches(triggerRef: string, candidateSubject: string): boolean {
  if (!triggerRef.startsWith(PHASE05_REF_PREFIX)) return false;
  const suffix = triggerRef.slice(PHASE05_REF_PREFIX.length);
  return /^[0-9a-f]{7,40}$/u.test(suffix) && candidateSubject.startsWith(suffix);
}

function acceptanceWorkflowBlobMatches(
  root: string,
  candidateSubject: string,
  expectedBlob: string,
  requireExplicitBlob: boolean,
): boolean {
  if (requireExplicitBlob && !OBJECT_ID_RE.test(expectedBlob)) return false;
  if (!requireExplicitBlob && expectedBlob.length > 0 && !OBJECT_ID_RE.test(expectedBlob)) return false;
  try {
    const actualBlob = gitObject(root, candidateSubject, ACCEPTANCE_WORKFLOW_PATH);
    return expectedBlob.length === 0 || expectedBlob === actualBlob;
  } catch {
    return false;
  }
}

function assertWorkflowProvenance(): { readonly root: string; readonly candidateSubject: string } {
  const root = path.resolve(__dirname, "../..");
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  const triggerRef = process.env.GITHUB_REF ?? "";
  const headSha = process.env.GITHUB_SHA ?? "";
  const workflowCommit = process.env.READINESS_WORKFLOW_COMMIT ?? "";
  const legacyReadiness =
    eventName === "push"
      && triggerRef === CANDIDATE_REF
      && OBJECT_ID_RE.test(headSha)
      && workflowCommit === headSha;
  if (legacyReadiness) return Object.freeze({ root, candidateSubject: headSha });

  const candidateSubject = process.env.READINESS_CANDIDATE_SHA ?? "";
  const expectedRef = process.env.READINESS_CANDIDATE_REF ?? "";
  const expectedWorkflowBlob = process.env.READINESS_WORKFLOW_BLOB_SHA ?? "";
  const acceptanceEvent = eventName === "push" || eventName === "workflow_dispatch";
  const dispatchRefValid = eventName !== "workflow_dispatch"
    || acceptanceDispatchRefMatches(triggerRef, candidateSubject);
  const acceptance = process.env.READINESS_PROVENANCE_PROFILE === ACCEPTANCE_PROFILE
    && acceptanceEvent
    && BRANCH_REF_RE.test(triggerRef)
    && expectedRef === triggerRef
    && dispatchRefValid
    && OBJECT_ID_RE.test(headSha)
    && candidateSubject === headSha
    && workflowCommit === headSha
    && acceptanceWorkflowBlobMatches(
      root,
      candidateSubject,
      expectedWorkflowBlob,
      eventName === "workflow_dispatch",
    );
  failUnless(acceptance, "workflow_provenance_invalid");
  return Object.freeze({ root, candidateSubject });
}

function appendOutput(key: string, value: string | number): void {
  const outputPath = process.env.GITHUB_OUTPUT ?? "";
  failUnless(outputPath.length > 0 && !value.toString().includes("\n") && !value.toString().includes("\r"),
    "workflow_output_invalid");
  try {
    fs.appendFileSync(outputPath, `${key}=${value}\n`, { encoding: "utf8" });
  } catch {
    throw new ReadinessWorkflowError("workflow_output_invalid");
  }
}

function assertSmokePass(result: SmokeRunResult, artifact: {
  readonly sha256: string;
  readonly memberCount: number;
}): Readonly<Record<HostId, "PASS">> {
  failUnless(
    result.status === "PASS"
      && result.mode === "required-contract"
      && result.provenance?.lifecycleTarballSha256 === artifact.sha256
      && result.provenance.artifactMemberCount === artifact.memberCount
      && result.hosts.length === HOST_IDS.length,
    "platform_smoke_failed",
  );
  const byHost = new Map(result.hosts.map((host) => [host.host, host.status]));
  failUnless(HOST_IDS.every((host) => byHost.get(host) === "PASS"), "platform_smoke_failed");
  return Object.freeze({ codex: "PASS", claude: "PASS", cursor: "PASS", opencode: "PASS", zcode: "PASS" });
}

async function packageAndUpload(dependencies: ReadinessWorkflowDependencies = {}): Promise<void> {
  const provenance = assertWorkflowProvenance();
  artifactUpload.assertGitHubArtifactRuntime();
  const runHostSmoke = dependencies.runHostSmoke ?? hostSmoke.runHostSmoke;
  const uploadCandidateArtifactFromLease = dependencies.uploadCandidateArtifactFromLease
    ?? artifactUpload.uploadCandidateArtifactFromLease;
  let lease: CandidatePackageArtifactLease | undefined;
  let smokeRoot: string | undefined;
  try {
    lease = releaseReadiness.createCandidatePackageArtifact({
      root: provenance.root,
      consumers: ["pack-audit", "tar-scan", "host-smoke", "workflow-upload"],
    });
    const artifact = lease.artifact;
    packAudit.auditPackArtifact(lease, { root: provenance.root });
    releaseReadiness.scanCandidatePackageArtifact(lease);
    smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-readiness-package-smoke-"));
    const smoke = await runHostSmoke({
      mode: "required-contract",
      artifactLease: lease,
      repositoryRoot: provenance.root,
      temporaryRoot: smokeRoot,
    });
    assertSmokePass(smoke, artifact);
    const uploaded = await uploadCandidateArtifactFromLease(lease);
    failUnless(uploaded.sha256 === artifact.sha256 && uploaded.memberCount === artifact.memberCount,
      "artifact_metadata_drift");
    appendOutput("artifact-id", uploaded.artifactId);
    appendOutput("artifact-name", uploaded.name);
    appendOutput("artifact-sha256", uploaded.sha256);
    appendOutput("member-count", uploaded.memberCount);
    appendOutput("candidate-subject", provenance.candidateSubject);
    process.stdout.write(`${JSON.stringify(uploaded)}\n`);
  } finally {
    if (lease !== undefined) {
      try { lease.dispose(); } catch { /* stable workflow failure remains authoritative */ }
    }
    if (smokeRoot !== undefined) {
      try { fs.rmSync(smokeRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

function parseLaneArguments(argv: readonly string[]): {
  readonly laneId: PlatformLaneId;
  readonly artifactRoot: string;
  readonly artifactName: string;
  readonly artifactSha256: string;
  readonly memberCount: number;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    failUnless(key !== undefined && value !== undefined && key.startsWith("--") && !values.has(key),
      "invalid_arguments");
    values.set(key, value);
  }
  failUnless(
    values.size === 5
      && values.has("--lane")
      && values.has("--artifact-root")
      && values.has("--artifact-name")
      && values.has("--artifact-sha256")
      && values.has("--member-count"),
    "invalid_arguments",
  );
  const laneId = values.get("--lane") as PlatformLaneId;
  const artifactRoot = values.get("--artifact-root") as string;
  const artifactName = values.get("--artifact-name") as string;
  const artifactSha256 = values.get("--artifact-sha256") as string;
  const memberCount = Number(values.get("--member-count"));
  failUnless(
    LANE_IDS.includes(laneId)
      && artifactName === path.basename(artifactName)
      && artifactName === "kcoderag-nav-0.3.0.tgz"
      && SHA256_RE.test(artifactSha256)
      && Number.isSafeInteger(memberCount)
      && memberCount > 0,
    "invalid_arguments",
  );
  return Object.freeze({ laneId, artifactRoot, artifactName, artifactSha256, memberCount });
}

export function openDownloadedLease(input: ReturnType<typeof parseLaneArguments>): CandidatePackageArtifactLease {
  const artifactRoot = path.resolve(input.artifactRoot);
  let handle: number | undefined;
  let nativeFailureCode = "downloaded_artifact_root_invalid";
  try {
    const runnerTempInput = process.env.RUNNER_TEMP ?? "";
    failUnless(runnerTempInput.length > 0, "downloaded_artifact_environment_invalid");
    const rootMetadata = fs.lstatSync(artifactRoot);
    const rootEntries = fs.readdirSync(artifactRoot, { withFileTypes: true });
    failUnless(rootEntries.length === 1, "downloaded_artifact_root_invalid");
    const artifactPath = path.join(artifactRoot, rootEntries[0]?.name ?? "");
    const fileMetadata = fs.lstatSync(artifactPath);
    nativeFailureCode = "downloaded_artifact_path_invalid";
    const runnerTemp = fs.realpathSync(path.resolve(runnerTempInput));
    const realRoot = fs.realpathSync(artifactRoot);
    const realFile = fs.realpathSync(artifactPath);
    const relativeRoot = path.relative(runnerTemp, realRoot);
    failUnless(
      rootMetadata.isDirectory()
        && !rootMetadata.isSymbolicLink()
        && relativeRoot.length > 0
        && relativeRoot !== ".."
        && !relativeRoot.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relativeRoot)
        && fileMetadata.isFile()
        && !fileMetadata.isSymbolicLink()
        && path.dirname(realFile) === realRoot,
      "downloaded_artifact_path_invalid",
    );
    const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    nativeFailureCode = "downloaded_artifact_open_invalid";
    handle = fs.openSync(realFile, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(handle);
    const bytes = fs.readFileSync(handle);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    nativeFailureCode = "downloaded_artifact_archive_invalid";
    const entries = tarArchive.readTarArchive(bytes);
    failUnless(
      opened.isFile()
        && opened.dev === fileMetadata.dev
        && opened.ino === fileMetadata.ino
        && opened.size === fileMetadata.size
        && bytes.length > 0
        && bytes.length <= MAX_ARTIFACT_BYTES
        && digest === input.artifactSha256
        && entries.length === input.memberCount,
      "downloaded_artifact_identity_invalid",
    );
    const packageIdentity = downloadedPackageIdentity(entries);
    const lease = new releaseReadiness.CandidatePackageArtifactLease({
      artifact: Object.freeze({
        name: packageIdentity.name,
        version: packageIdentity.version,
        sha256: digest,
        memberCount: entries.length,
        dryRunCount: 1 as const,
        actualPackCount: 1 as const,
      }),
      canonicalTgzPath: realFile,
      temporaryRoot: realRoot,
      handle,
      fileIdentity: { dev: opened.dev, ino: opened.ino, size: opened.size },
      bytes,
      consumers: new Set(["host-smoke"] as const),
    });
    handle = undefined;
    return lease;
  } catch (error) {
    if (handle !== undefined) {
      try { fs.closeSync(handle); } catch { /* normalized below */ }
    }
    if (error instanceof ReadinessWorkflowError) throw error;
    throw new ReadinessWorkflowError(nativeFailureCode);
  }
}

async function runLane(argv: readonly string[]): Promise<void> {
  const provenance = assertWorkflowProvenance();
  const args = parseLaneArguments(argv);
  const shape = laneShape(args.laneId);
  failUnless(
    (process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "unsupported") === shape.os
      && Number(process.versions.node.split(".")[0]) === shape.nodeMajor,
    "platform_lane_mismatch",
  );
  let lease: CandidatePackageArtifactLease | undefined;
  let smokeRoot: string | undefined;
  try {
    lease = openDownloadedLease(args);
    const artifact = lease.artifact;
    smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-readiness-lane-smoke-"));
    const smoke = await hostSmoke.runHostSmoke({
      mode: "required-contract",
      artifactLease: lease,
      repositoryRoot: provenance.root,
      temporaryRoot: smokeRoot,
    });
    const hostOutcomes = assertSmokePass(smoke, artifact);
    const receipt = parsePlatformLaneReceipt({
      schemaVersion: 1,
      laneId: args.laneId,
      os: shape.os,
      nodeMajor: shape.nodeMajor,
      candidateSubject: provenance.candidateSubject,
      triggerEvent: "push",
      triggerRef: CANDIDATE_REF,
      headSha: provenance.candidateSubject,
      workflowCommit: provenance.candidateSubject,
      workflowBlobOid: gitObject(provenance.root, provenance.candidateSubject, WORKFLOW_PATH),
      artifactSha256: artifact.sha256,
      memberCount: artifact.memberCount,
      dryRunCount: artifact.dryRunCount,
      actualPackCount: artifact.actualPackCount,
      workflowConclusion: "PASS",
      hostOutcomes,
      packagedOnly: true,
      trueHostAcceptance: "NOT_RUN_BY_SCOPE",
    });
    const serialized = JSON.stringify(receipt);
    appendOutput("receipt", serialized);
    process.stdout.write(`${serialized}\n`);
  } finally {
    if (lease !== undefined) {
      try { lease.dispose(); } catch { /* stable workflow failure remains authoritative */ }
    }
    if (smokeRoot !== undefined) {
      try { fs.rmSync(smokeRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

function verifyLanes(): void {
  const provenance = assertWorkflowProvenance();
  const artifactSha256 = process.env.CANDIDATE_ARTIFACT_SHA256 ?? "";
  const memberCount = Number(process.env.CANDIDATE_MEMBER_COUNT);
  const receipts = [
    process.env.LANE_LINUX_NODE22,
    process.env.LANE_LINUX_NODE24,
    process.env.LANE_WINDOWS_NODE22,
    process.env.LANE_WINDOWS_NODE24,
  ].map((value) => parseJson(value ?? ""));
  const verified = verifyPlatformLaneSet(receipts, {
    root: provenance.root,
    candidateSubject: provenance.candidateSubject,
    artifactSha256,
    memberCount,
  });
  process.stdout.write(`${JSON.stringify(Object.freeze({
    schemaVersion: 1,
    verified: true,
    candidateSubject: provenance.candidateSubject,
    artifactSha256,
    memberCount,
    laneIds: verified.map((receipt) => receipt.laneId),
  }))}\n`);
}

/** Execute one workflow-only operation; no command publishes, tags, pushes, or reads a registry candidate. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: ReadinessWorkflowDependencies = {},
): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === "package-upload" && rest.length === 0) await packageAndUpload(dependencies);
    else if (command === "lane") await runLane(rest);
    else if (command === "verify" && rest.length === 0) verifyLanes();
    else throw new ReadinessWorkflowError("invalid_arguments");
    return 0;
  } catch (error) {
    const reason = error instanceof ReadinessWorkflowError
      || error instanceof artifactUpload.GitHubArtifactUploadError
      || error instanceof releaseReadiness.CandidatePackageArtifactError
      ? error.code
      : "readiness_workflow_failed";
    const metadata = error instanceof artifactUpload.GitHubArtifactUploadError
      && typeof error.stage === "string"
      && SAFE_UPLOAD_STAGES.includes(error.stage)
      && typeof error.statusClass === "string"
      && SAFE_UPLOAD_STATUS_CLASSES.includes(error.statusClass)
      ? { stage: error.stage, statusClass: error.statusClass }
      : {};
    const annotation = hostedLaneFailureAnnotation(reason, process.env.GITHUB_ACTIONS === "true");
    if (annotation !== undefined) process.stdout.write(`${annotation}\n`);
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: "FAIL", reason, ...metadata })}\n`);
    return 1;
  }
}

if (require.main === module) {
  void main().then((code) => { process.exitCode = code; });
}
