#!/usr/bin/env node
/** Protected exact-candidate acceptance workflow validation and receipt production. */

import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { HostId } from "../core/contracts.cjs";
import {
  RECEIPT_STAGES,
  aggregateHostReceipts,
  createHostReceipt,
  type AcceptanceObservations,
  type FailureReasonCode,
  type HostReceipt,
  type ReceiptReasonCode,
  type ReceiptStage,
} from "../smoke/acceptance-receipt.cjs";
import {
  runLiveHostCoordinator,
  type LaneAdmission,
  type LaneContext,
  type LaneOutcome,
} from "../smoke/live-host-coordinator.cjs";
import { runHostSmoke } from "../smoke/host-smoke.cjs";
import type { CandidatePackageArtifactLease } from "./release-readiness.cjs";

const readinessWorkflow = require("./readiness-workflow.cjs") as {
  openDownloadedLease(input: {
    readonly laneId: "linux-node22" | "linux-node24" | "windows-node22" | "windows-node24";
    readonly artifactRoot: string;
    readonly artifactName: string;
    readonly artifactSha256: string;
    readonly memberCount: number;
  }): CandidatePackageArtifactLease;
};

export const ACCEPTANCE_WORKFLOW_STAGES = RECEIPT_STAGES;
export const PACKAGED_LANES = Object.freeze([
  "ubuntu-node22",
  "ubuntu-node24",
  "windows-node22",
  "windows-node24",
] as const);
export const ACCEPTANCE_HOSTS = Object.freeze(["codex", "claude", "cursor", "opencode", "zcode"] as const);
const LIVE_RUNNER = Object.freeze(["self-hosted", "Windows", "X64", "kcoderag-live"] as const);
const SHA_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
const MAX_DRIVER_BYTES = 512 * 1024;
const DRIVER_TIMEOUT_MS = 15 * 60 * 1000;
const FORBIDDEN_KEY_RE = /^(?:query|result|url|authorization|headers?|bearer|token|config|credential|secret)$/iu;
const FORBIDDEN_VALUE_RE = /(?:https?:\/\/|bearer\s|authorization\s*[:=]|token\s*[:=]|credential\s*[:=]|secret\s*[:=])/iu;

export class AcceptanceWorkflowError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AcceptanceWorkflowError";
    this.code = code;
  }
}

export interface AcceptanceWorkflowContract {
  readonly schemaVersion: 1;
  readonly producerJob: "package";
  readonly packagedLanes: typeof PACKAGED_LANES;
  readonly liveJob: "live";
  readonly liveRunner: typeof LIVE_RUNNER;
  readonly coordinatorOrder: readonly ["codex", "claude", "opencode", "cursor", "zcode"];
}

function count(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

function jobBody(source: string, job: string, next?: string): string {
  const start = source.indexOf(`  ${job}:`);
  if (start < 0) throw new AcceptanceWorkflowError("workflow_topology_invalid");
  const end = next === undefined ? source.length : source.indexOf(`  ${next}:`, start + 1);
  if (end < 0) throw new AcceptanceWorkflowError("workflow_topology_invalid");
  return source.slice(start, end);
}

function requireMatch(source: string, expression: RegExp, code: string): void {
  if (!expression.test(source)) throw new AcceptanceWorkflowError(code);
}

/** Validate topology and trust boundaries without parsing or evaluating untrusted YAML. */
export function validateAcceptanceWorkflow(source: string): AcceptanceWorkflowContract {
  if (typeof source !== "string" || source.length === 0 || Buffer.byteLength(source, "utf8") > 256 * 1024) {
    throw new AcceptanceWorkflowError("workflow_invalid");
  }
  if (/continue-on-error|allow_failure|\|\|\s*true/iu.test(source)) {
    throw new AcceptanceWorkflowError("acceptance_bypass_forbidden");
  }
  requireMatch(source, /workflow_dispatch:[\s\S]*?candidateSha:[\s\S]*?required:\s*true/u, "candidate_input_missing");
  requireMatch(source, /workflow_dispatch:[\s\S]*?candidateRef:[\s\S]*?required:\s*true/u,
    "candidate_ref_input_missing");
  requireMatch(source, /workflow_dispatch:[\s\S]*?packageSha256:[\s\S]*?required:\s*true/u, "package_input_missing");
  requireMatch(source, /workflow_dispatch:[\s\S]*?packageMemberDigest:[\s\S]*?required:\s*true/u,
    "package_input_missing");
  requireMatch(source, /workflow_dispatch:[\s\S]*?workflowBlobSha:[\s\S]*?required:\s*true/u,
    "workflow_input_missing");
  requireMatch(source, /^permissions:\s*\r?\n\s+contents:\s*read\s*$/mu, "permissions_invalid");
  if (/contents:\s*write|actions:\s*write|packages:\s*write|id-token:\s*write/iu.test(source)) {
    throw new AcceptanceWorkflowError("permissions_invalid");
  }
  const jobsSource = source.slice(source.indexOf("\njobs:"));
  const jobNames = [...jobsSource.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gmu)].map((match) => match[1]);
  if (jobNames.join(",") !== "package,packaged,live,verify") {
    throw new AcceptanceWorkflowError("workflow_topology_invalid");
  }
  if (count(source, /uses:\s*\.\/\.github\/actions\/readiness-upload/gu) !== 1) {
    throw new AcceptanceWorkflowError("producer_count_invalid");
  }
  const packageJob = jobBody(source, "package", "packaged");
  requireMatch(packageJob, /READINESS_PROVENANCE_PROFILE:\s*acceptance/u, "producer_provenance_missing");
  requireMatch(packageJob, /READINESS_CANDIDATE_SHA:\s*\$\{\{ env\.ACCEPTANCE_SUBJECT \}\}/u,
    "producer_provenance_missing");
  requireMatch(packageJob, /READINESS_CANDIDATE_REF:\s*\$\{\{ inputs\.candidateRef \|\| github\.ref \}\}/u,
    "producer_provenance_missing");
  requireMatch(packageJob, /READINESS_WORKFLOW_COMMIT:\s*\$\{\{ github\.workflow_sha \}\}/u,
    "producer_provenance_missing");
  requireMatch(packageJob, /READINESS_WORKFLOW_BLOB_SHA:\s*\$\{\{ inputs\.workflowBlobSha \}\}/u,
    "producer_provenance_missing");
  const packaged = jobBody(source, "packaged", "live");
  for (const [lane, os, runner, node] of [
    ["ubuntu-node22", "linux", "ubuntu-latest", "22"],
    ["ubuntu-node24", "linux", "ubuntu-latest", "24"],
    ["windows-node22", "windows", "windows-latest", "22"],
    ["windows-node24", "windows", "windows-latest", "24"],
  ] as const) {
    requireMatch(packaged, new RegExp(`- lane:\\s*${lane}\\s*\\r?\\n\\s*os:\\s*${os}\\s*\\r?\\n\\s*runner:\\s*${runner}\\s*\\r?\\n\\s*node:\\s*[\"']${node}[\"']`, "u"),
      "packaged_matrix_invalid");
  }
  if (count(packaged, /- lane:/gu) !== 4 || !/evidence-level\s+PACKAGED/iu.test(packaged)) {
    throw new AcceptanceWorkflowError("packaged_matrix_invalid");
  }
  const live = jobBody(source, "live", "verify");
  requireMatch(live, /runs-on:\s*\[self-hosted, Windows, X64, kcoderag-live\]/u, "live_runner_invalid");
  requireMatch(live, /node-version:\s*["']22["']/u, "live_runner_invalid");
  requireMatch(live, /environment:\s*\r?\n\s+name:\s*kcoderag-live/u, "protected_environment_missing");
  requireMatch(live, /github\.event_name == 'workflow_dispatch'/u, "untrusted_ref_guard_missing");
  requireMatch(live, /github\.event\.repository\.fork == false/u, "untrusted_ref_guard_missing");
  requireMatch(live, /inputs\.candidateSha == needs\.package\.outputs\.candidate-sha/u,
    "candidate_binding_missing");
  requireMatch(live, /inputs\.candidateRef == github\.ref/u, "candidate_binding_missing");
  requireMatch(live, /inputs\.packageSha256 == needs\.package\.outputs\.artifact-sha256/u,
    "package_binding_missing");
  requireMatch(live, /inputs\.packageMemberDigest == needs\.package\.outputs\.package-member-digest/u,
    "package_binding_missing");
  requireMatch(live, /name:\s*Bind candidate native driver/u, "native_driver_binding_missing");
  requireMatch(live, /Resolve-Path\s+["']dist\/maintainer\/native-host-driver\.cjs["']/u,
    "native_driver_binding_missing");
  requireMatch(live, /SHA256\]::HashData/u, "native_driver_binding_missing");
  requireMatch(live, /KCODERAG_NATIVE_DRIVER=\$driver/u, "native_driver_binding_missing");
  requireMatch(live, /KCODERAG_NATIVE_DRIVER_SHA256=\$digest/u, "native_driver_binding_missing");
  requireMatch(live, /KCODERAG_ZCODE_WORKSPACE_TRUST:\s*\$\{\{ vars\.KCODERAG_ZCODE_WORKSPACE_TRUST \}\}/u,
    "workspace_trust_projection_missing");
  requireMatch(live, /npm run acceptance:live/u, "coordinator_missing");
  if (/npm\s+(?:pack|publish|view)|pack:audit|smoke:required|dist-tag|git\s+(?:tag|push)|@latest/iu.test(live)) {
    throw new AcceptanceWorkflowError("live_rebuild_forbidden");
  }
  if (count(source, /artifact-ids:\s*\$\{\{ needs\.package\.outputs\.artifact-id \}\}/gu) !== 2) {
    throw new AcceptanceWorkflowError("artifact_binding_invalid");
  }
  const externalActions = [...source.matchAll(/uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)]
    .map((match) => match[1] as string)
    .filter((action) => !action.startsWith("./"));
  if (externalActions.some((action) => !/^[^@\s]+@[0-9a-f]{40}$/u.test(action))) {
    throw new AcceptanceWorkflowError("action_pin_invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    producerJob: "package",
    packagedLanes: PACKAGED_LANES,
    liveJob: "live",
    liveRunner: LIVE_RUNNER,
    coordinatorOrder: Object.freeze(["codex", "claude", "opencode", "cursor", "zcode"] as const),
  });
}

export function validateAcceptanceWorkflowFile(
  filePath = path.resolve(".github", "workflows", "acceptance.yml"),
): AcceptanceWorkflowContract {
  try {
    const metadata = fs.lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256 * 1024) throw new Error("invalid");
    return validateAcceptanceWorkflow(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error instanceof AcceptanceWorkflowError) throw error;
    throw new AcceptanceWorkflowError("workflow_invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function secretShaped(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string") return FORBIDDEN_VALUE_RE.test(value);
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => secretShaped(item, seen));
  return Object.entries(value).some(([key, item]) => FORBIDDEN_KEY_RE.test(key) || secretShaped(item, seen));
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function packageMemberDigest(packageSha256: string, memberCount: number): string {
  return sha256(`${packageSha256}:${memberCount}`);
}

function writeMetadata(outputPath: string, value: unknown): void {
  if (secretShaped(value)) throw new AcceptanceWorkflowError("secret_detected");
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(bytes, "utf8") > MAX_DRIVER_BYTES) throw new AcceptanceWorkflowError("receipt_invalid");
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
  try {
    fs.writeFileSync(temporary, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, resolved);
  } catch {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best-effort private temporary cleanup */ }
    throw new AcceptanceWorkflowError("receipt_write_failed");
  }
}

function parseFlags(argv: readonly string[]): Readonly<Record<string, string>> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === undefined || value === undefined || !/^--[a-z][a-z0-9-]*$/u.test(name) || flags[name.slice(2)] !== undefined) {
      throw new AcceptanceWorkflowError("arguments_invalid");
    }
    flags[name.slice(2)] = value;
  }
  return Object.freeze(flags);
}

function requiredFlag(flags: Readonly<Record<string, string>>, name: string): string {
  const value = flags[name];
  if (value === undefined || value.length === 0) throw new AcceptanceWorkflowError("arguments_invalid");
  return value;
}

function parseMemberCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 10_000) throw new AcceptanceWorkflowError("arguments_invalid");
  return parsed;
}

function parsePackagedLane(value: string): (typeof PACKAGED_LANES)[number] {
  if (!PACKAGED_LANES.includes(value as (typeof PACKAGED_LANES)[number])) {
    throw new AcceptanceWorkflowError("arguments_invalid");
  }
  return value as (typeof PACKAGED_LANES)[number];
}

function rebindPackagedReceipt(
  receipt: HostReceipt,
  input: {
    readonly candidateSha: string;
    readonly workflowRunId: string;
    readonly packageSha256: string;
    readonly memberDigest: string;
    readonly os: "windows" | "linux";
    readonly nodeVersion: string;
    readonly lane: string;
  },
): HostReceipt {
  return createHostReceipt({
    ...receipt,
    candidateSha: input.candidateSha,
    workflowRunId: input.workflowRunId,
    packageSha256: input.packageSha256,
    packageMemberDigest: input.memberDigest,
    os: input.os,
    nodeVersion: input.nodeVersion,
    artifactDigest: input.packageSha256,
    logDigest: sha256(`${input.lane}:${receipt.host}:${receipt.status}:${receipt.stage}:${receipt.reasonCode}`),
  });
}

async function runPackaged(flags: Readonly<Record<string, string>>): Promise<number> {
  const lane = parsePackagedLane(requiredFlag(flags, "lane"));
  const candidateSha = requiredFlag(flags, "candidate-sha");
  const packageSha256 = requiredFlag(flags, "package-sha256");
  const workflowRunId = requiredFlag(flags, "workflow-run-id");
  const artifactRoot = requiredFlag(flags, "artifact-root");
  const artifactName = requiredFlag(flags, "artifact-name");
  const output = requiredFlag(flags, "output");
  const memberCount = parseMemberCount(requiredFlag(flags, "member-count"));
  if (!SHA_RE.test(candidateSha) || !SHA256_RE.test(packageSha256) || !SAFE_ID_RE.test(workflowRunId)) {
    throw new AcceptanceWorkflowError("arguments_invalid");
  }
  const [os, nodeVersion] = lane.startsWith("ubuntu-") ? ["linux", lane.endsWith("22") ? "22" : "24"] as const
    : ["windows", lane.endsWith("22") ? "22" : "24"] as const;
  const leaseLane = `${os}-node${nodeVersion}` as "linux-node22" | "linux-node24" | "windows-node22" | "windows-node24";
  const lease = readinessWorkflow.openDownloadedLease({
    laneId: leaseLane,
    artifactRoot,
    artifactName,
    artifactSha256: packageSha256,
    memberCount,
  });
  try {
    const smoke = await runHostSmoke({ mode: "required-contract", artifactLease: lease });
    const memberDigest = packageMemberDigest(packageSha256, memberCount);
    const receipts = Object.freeze(smoke.hosts.map((host) => rebindPackagedReceipt(host.receipt, {
      candidateSha,
      workflowRunId,
      packageSha256,
      memberDigest,
      os,
      nodeVersion,
      lane,
    })));
    const verdict = aggregateHostReceipts(receipts, { requiredHosts: ACCEPTANCE_HOSTS, candidateSha });
    writeMetadata(output, Object.freeze({ schemaVersion: 1, lane, evidenceLevel: "PACKAGED", verdict, receipts }));
    return verdict === "PASS" ? 0 : 1;
  } finally {
    lease.dispose();
  }
}

interface DriverResult {
  readonly code: number;
  readonly value?: unknown;
}

export function resolveTrustedDriver(driver: string | undefined, expected: string | undefined): string | undefined {
  if (driver === undefined || expected === undefined || !SHA256_RE.test(expected)) return undefined;
  try {
    const metadata = fs.lstatSync(driver);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > 16 * 1024 * 1024) return undefined;
    return sha256(fs.readFileSync(driver)) === expected ? path.resolve(driver) : undefined;
  } catch {
    return undefined;
  }
}

function trustedDriver(): string | undefined {
  return resolveTrustedDriver(process.env.KCODERAG_NATIVE_DRIVER, process.env.KCODERAG_NATIVE_DRIVER_SHA256);
}

export function nativeDriverSpawnSpec(
  driver: string,
  args: readonly string[],
): Readonly<{ readonly executable: string; readonly args: readonly string[] }> {
  return Object.freeze({ executable: process.execPath, args: Object.freeze([driver, ...args]) });
}

async function invokeDriver(driver: string, action: "probe" | "run" | "cleanup", context: LaneContext, packagePath: string): Promise<DriverResult> {
  return await new Promise<DriverResult>((resolve) => {
    const args = [action, "--host", context.host, "--project", context.projectRoot, "--cache", context.cacheRoot,
      "--npm-cache", context.npmCacheRoot, "--package", packagePath];
    const command = nativeDriverSpawnSpec(driver, args);
    const child = childProcess.spawn(command.executable, command.args, {
      cwd: context.laneRoot,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        PATHEXT: process.env.PATHEXT,
        TEMP: context.cacheRoot,
        TMP: context.cacheRoot,
        npm_config_cache: context.npmCacheRoot,
        npm_execpath: process.env.npm_execpath,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        HOMEDRIVE: process.env.HOMEDRIVE,
        HOMEPATH: process.env.HOMEPATH,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        APPDATA: process.env.APPDATA,
        CODEX_HOME: process.env.CODEX_HOME,
        CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
        KCODERAG_CODEX_VERSION: process.env.KCODERAG_CODEX_VERSION,
        KCODERAG_CLAUDE_VERSION: process.env.KCODERAG_CLAUDE_VERSION,
        KCODERAG_CURSOR_VERSION: process.env.KCODERAG_CURSOR_VERSION,
        KCODERAG_OPENCODE_VERSION: process.env.KCODERAG_OPENCODE_VERSION,
        KCODERAG_ZCODE_VERSION: process.env.KCODERAG_ZCODE_VERSION,
        KCODERAG_ZCODE_WORKSPACE_TRUST: process.env.KCODERAG_ZCODE_WORKSPACE_TRUST,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (code: number, value?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(value === undefined ? { code } : { code, value });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length <= MAX_DRIVER_BYTES) chunks.push(Buffer.from(chunk));
      else child.kill();
    });
    child.stderr.resume();
    child.on("error", () => { finish(1); });
    child.on("close", (code) => {
      if (length > MAX_DRIVER_BYTES || code !== 0) return finish(1);
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        finish(secretShaped(parsed) ? 1 : 0, parsed);
      } catch {
        finish(1);
      }
    });
    timer = setTimeout(() => {
      try {
        if (process.platform === "win32" && child.pid !== undefined) {
          childProcess.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        } else child.kill("SIGKILL");
      } catch { /* coordinator turns timeout into one closed failure */ }
      finish(1);
    }, DRIVER_TIMEOUT_MS);
    timer.unref();
  });
}

function parseAdmission(value: unknown): LaneAdmission {
  if (!isRecord(value) || typeof value.admitted !== "boolean") {
    return Object.freeze({ admitted: false, stage: "environment", reasonCode: "runner_unavailable" });
  }
  if (value.admitted) return Object.freeze({ admitted: true });
  const stage = value.stage;
  const reasonCode = value.reasonCode;
  if ((stage !== "environment" && stage !== "admission") || typeof reasonCode !== "string") {
    return Object.freeze({ admitted: false, stage: "environment", reasonCode: "runner_unavailable" });
  }
  if (reasonCode === "none") {
    return Object.freeze({ admitted: false, stage: "environment", reasonCode: "runner_unavailable" });
  }
  return Object.freeze({ admitted: false, stage, reasonCode: reasonCode as FailureReasonCode });
}

function parseLaneOutcome(value: unknown): LaneOutcome {
  if (!isRecord(value) || (value.status !== "PASS" && value.status !== "FAIL")
    || typeof value.stage !== "string" || !RECEIPT_STAGES.includes(value.stage as ReceiptStage)
    || typeof value.reasonCode !== "string" || !isRecord(value.observations)
    || !isRecord(value.observations.common) || !isRecord(value.observations.host)) {
    return Object.freeze({
      status: "FAIL",
      stage: "evidence_integrity",
      reasonCode: "receipt_invalid",
      observations: Object.freeze({ common: Object.freeze({}), host: Object.freeze({}) }) as AcceptanceObservations,
    });
  }
  return Object.freeze({
    status: value.status,
    stage: value.stage as ReceiptStage,
    reasonCode: value.reasonCode as ReceiptReasonCode,
    observations: Object.freeze({
      common: Object.freeze({ ...value.observations.common }),
      host: Object.freeze({ ...value.observations.host }),
    }) as AcceptanceObservations,
  });
}

function singleArtifactFile(artifactRoot: string, expectedSha: string): string {
  try {
    const entries = fs.readdirSync(artifactRoot, { withFileTypes: true });
    if (entries.length !== 1 || entries[0] === undefined || !entries[0].isFile() || entries[0].isSymbolicLink()) {
      throw new Error("invalid");
    }
    const filePath = path.join(artifactRoot, entries[0].name);
    if (sha256(fs.readFileSync(filePath)) !== expectedSha) throw new Error("invalid");
    return filePath;
  } catch {
    throw new AcceptanceWorkflowError("package_hash_mismatch");
  }
}

async function runLive(flags: Readonly<Record<string, string>>): Promise<number> {
  const candidateSha = requiredFlag(flags, "candidate-sha");
  const packageSha256 = requiredFlag(flags, "package-sha256");
  const expectedMemberDigest = requiredFlag(flags, "package-member-digest");
  const workflowRunId = requiredFlag(flags, "workflow-run-id");
  const artifactRoot = requiredFlag(flags, "artifact-root");
  const output = requiredFlag(flags, "output");
  const memberCount = parseMemberCount(requiredFlag(flags, "member-count"));
  if (!SHA_RE.test(candidateSha) || !SHA256_RE.test(packageSha256) || !SHA256_RE.test(expectedMemberDigest)
    || packageMemberDigest(packageSha256, memberCount) !== expectedMemberDigest || !SAFE_ID_RE.test(workflowRunId)) {
    throw new AcceptanceWorkflowError("arguments_invalid");
  }
  const packagePath = singleArtifactFile(artifactRoot, packageSha256);
  const driver = trustedDriver();
  const hostVersions = Object.fromEntries(ACCEPTANCE_HOSTS.map((host) => {
    const value = process.env[`KCODERAG_${host.toUpperCase()}_VERSION`] ?? "unknown";
    return [host, SAFE_VERSION_RE.test(value) ? value : "unknown"];
  })) as Record<HostId, string>;
  const result = await runLiveHostCoordinator({
    root: path.join(path.dirname(path.resolve(output)), "lanes"),
    candidateSha,
    packageSha256,
    packageMemberDigest: expectedMemberDigest,
    workflowRunId,
    artifactDigest: packageSha256,
    nodeVersion: process.versions.node,
    os: "windows",
    hostVersions,
  }, {
    async probeLane(context) {
      if (driver === undefined) return Object.freeze({ admitted: false, stage: "environment", reasonCode: "host_unavailable" });
      const response = await invokeDriver(driver, "probe", context, packagePath);
      return response.code === 0 ? parseAdmission(response.value)
        : Object.freeze({ admitted: false, stage: "environment", reasonCode: "runner_unavailable" });
    },
    async runLane(context) {
      if (driver === undefined) return parseLaneOutcome(undefined);
      const response = await invokeDriver(driver, "run", context, packagePath);
      return response.code === 0 ? parseLaneOutcome(response.value) : parseLaneOutcome(undefined);
    },
    async cleanupLane(context) {
      if (driver !== undefined) {
        const response = await invokeDriver(driver, "cleanup", context, packagePath);
        if (response.code !== 0) throw new AcceptanceWorkflowError("cleanup_failed");
      }
    },
  });
  writeMetadata(output, result);
  return result.verdict === "PASS" ? 0 : 1;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0];
  try {
    if (command === "check") {
      const contract = validateAcceptanceWorkflowFile(argv[1]);
      process.stdout.write(`${JSON.stringify({ ok: true, ...contract })}\n`);
      return 0;
    }
    const flags = parseFlags(argv.slice(1));
    if (command === "packaged") return await runPackaged(flags);
    if (command === "live") return await runLive(flags);
    throw new AcceptanceWorkflowError("arguments_invalid");
  } catch (error) {
    const code = error instanceof AcceptanceWorkflowError ? error.code : "acceptance_workflow_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

exports.ACCEPTANCE_WORKFLOW_STAGES = ACCEPTANCE_WORKFLOW_STAGES;
exports.PACKAGED_LANES = PACKAGED_LANES;
exports.ACCEPTANCE_HOSTS = ACCEPTANCE_HOSTS;
exports.AcceptanceWorkflowError = AcceptanceWorkflowError;
exports.validateAcceptanceWorkflow = validateAcceptanceWorkflow;
exports.validateAcceptanceWorkflowFile = validateAcceptanceWorkflowFile;
exports.resolveTrustedDriver = resolveTrustedDriver;
exports.nativeDriverSpawnSpec = nativeDriverSpawnSpec;
exports.main = main;

if (require.main === module) {
  void main().then((code) => { process.exitCode = code; });
}
