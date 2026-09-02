/** Closed, metadata-only Phase 05 host acceptance receipts. */

import type { HostId } from "../core/contracts.cjs";

export const RECEIPT_STATUSES = Object.freeze(["PASS", "FAIL", "NOT_RUN"] as const);
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const AGGREGATE_VERDICTS = Object.freeze(["PASS", "FAIL", "INCOMPLETE"] as const);
export type AggregateVerdict = (typeof AGGREGATE_VERDICTS)[number];

export const EVIDENCE_LEVELS = Object.freeze(["PACKAGED", "LIVE"] as const);
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const RECEIPT_STAGES = Object.freeze([
  "environment",
  "admission",
  "package",
  "install",
  "native_event",
  "prompt_semantics",
  "mcp",
  "feedback",
  "evidence_integrity",
] as const);
export type ReceiptStage = (typeof RECEIPT_STAGES)[number];

export const RECEIPT_REASON_CODE_STAGES = Object.freeze({
  host_unavailable: "environment",
  host_cli_missing: "environment",
  runner_unavailable: "environment",
  node_version_unsupported: "environment",
  host_version_unsupported: "admission",
  host_auth_missing: "admission",
  workspace_trust_missing: "admission",
  protected_environment_denied: "admission",
  untrusted_ref: "admission",
  package_acquisition_failed: "package",
  package_hash_mismatch: "package",
  package_inventory_mismatch: "package",
  install_failed: "install",
  status_unhealthy: "install",
  update_failed: "install",
  uninstall_failed: "install",
  native_event_missing: "native_event",
  native_event_failed: "native_event",
  prompt_missing: "prompt_semantics",
  prompt_unexpected: "prompt_semantics",
  prompt_dedupe_failed: "prompt_semantics",
  mcp_registration_missing: "mcp",
  list_indexes_unavailable: "mcp",
  mcp_call_failed: "mcp",
  structured_result_invalid: "mcp",
  feedback_reminder_missing: "feedback",
  submit_feedback_failed: "feedback",
  feedback_suppression_failed: "feedback",
  candidate_mismatch: "evidence_integrity",
  receipt_invalid: "evidence_integrity",
  secret_detected: "evidence_integrity",
  cleanup_failed: "evidence_integrity",
} as const satisfies Readonly<Record<string, ReceiptStage>>);
export type FailureReasonCode = keyof typeof RECEIPT_REASON_CODE_STAGES;
export type ReceiptReasonCode = "none" | FailureReasonCode;

export const COMMON_OBSERVATION_KEYS = Object.freeze([
  "packageInstalled",
  "statusHealthy",
  "updateIdempotent",
  "uninstallRestored",
  "nativeHostProcess",
  "sessionBaselineObserved",
  "mcpRegistered",
  "listIndexesSucceeded",
  "searchCodeSucceeded",
  "structuredResultValid",
  "feedbackReminderObserved",
  "submitFeedbackSucceeded",
  "feedbackSuppressed",
  "malformedFailOpen",
  "successMarkerRecorded",
  "processTreeCleaned",
] as const);
export type CommonObservationKey = (typeof COMMON_OBSERVATION_KEYS)[number];
export type CommonObservations = Readonly<Record<CommonObservationKey, boolean>>;

export const HOST_OBSERVATION_KEYS = Object.freeze({
  codex: Object.freeze([
    "directMcpRegistrationObserved",
    "nativeSessionStartObserved",
    "nativeHookOutputObserved",
  ] as const),
  claude: Object.freeze([
    "nativeSessionStartObserved",
    "nativeGrepHookObserved",
    "nativeGlobHookObserved",
    "nativeBashHookObserved",
  ] as const),
  cursor: Object.freeze([
    "reloadObserved",
    "realMcpObserved",
    "ruleObserved",
    "skillObserved",
    "afterMcpExecutionObserved",
  ] as const),
  opencode: Object.freeze([
    "projectLifecycleObserved",
    "pluginLoaded",
    "pluginCallbackObserved",
    "realToolBehaviorObserved",
  ] as const),
  zcode: Object.freeze([
    "frozenVersionMatched",
    "workspaceTrustApproved",
    "workspaceSkillObserved",
    "nativePreToolObserved",
    "nativePostToolObserved",
  ] as const),
} satisfies Readonly<Record<HostId, readonly string[]>>);
export type HostObservationKey = (typeof HOST_OBSERVATION_KEYS)[HostId][number];
export type HostObservations = Readonly<Record<string, boolean>>;

export interface AcceptanceObservations {
  readonly common: CommonObservations;
  readonly host: HostObservations;
}

export interface HostReceipt {
  readonly schemaVersion: 1;
  readonly host: HostId;
  readonly hostVersion: string;
  readonly os: "windows" | "linux";
  readonly nodeVersion: string;
  readonly evidenceLevel: EvidenceLevel;
  readonly status: ReceiptStatus;
  readonly stage: ReceiptStage;
  readonly reasonCode: ReceiptReasonCode;
  readonly attempted: boolean;
  readonly candidateSha: string;
  readonly packageSha256: string;
  readonly packageMemberDigest: string;
  readonly workflowRunId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly artifactDigest: string;
  readonly logDigest: string;
  readonly observations: AcceptanceObservations;
}

const HOSTS = Object.freeze(["codex", "claude", "cursor", "opencode", "zcode"] as const);
const RECEIPT_KEYS = Object.freeze([
  "schemaVersion",
  "host",
  "hostVersion",
  "os",
  "nodeVersion",
  "evidenceLevel",
  "status",
  "stage",
  "reasonCode",
  "attempted",
  "candidateSha",
  "packageSha256",
  "packageMemberDigest",
  "workflowRunId",
  "startedAt",
  "completedAt",
  "durationMs",
  "artifactDigest",
  "logDigest",
  "observations",
] as const);
const OBSERVATION_CONTAINER_KEYS = Object.freeze(["common", "host"] as const);
const DIGEST = /^[a-f0-9]{64}$/u;
const CANDIDATE_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._()+:/-]{0,127}$/u;
const SECRET_SHAPED_VALUE = /(?:https?:\/\/|bearer\s|authorization\s*[:=]|header\s*[:=]|token\s*[:=]|credential\s*[:=]|secret\s*[:=])/iu;
const MAX_DURATION_MS = 24 * 60 * 60 * 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && expected.slice().sort().every((key, index) => actual[index] === key);
}

function isHost(value: unknown): value is HostId {
  return typeof value === "string" && HOSTS.includes(value as HostId);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isSafeLabel(value: unknown): value is string {
  return typeof value === "string" && SAFE_LABEL.test(value) && !SECRET_SHAPED_VALUE.test(value);
}

function booleanRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, boolean>> | undefined {
  if (!isRecord(value) || !exactKeys(value, keys)) return undefined;
  const result: Record<string, boolean> = {};
  for (const key of keys) {
    const item = value[key];
    if (typeof item !== "boolean") return undefined;
    result[key] = item;
  }
  return Object.freeze(result);
}

function observationRecord(
  keys: readonly string[],
  defaultValue: boolean,
  overrides: Readonly<Record<string, boolean>>,
): Readonly<Record<string, boolean>> {
  if (Object.keys(overrides).some((key) => !keys.includes(key))) throw new Error("invalid_observations");
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, overrides[key] ?? defaultValue])));
}

export function completeCommonObservations(
  overrides: Readonly<Partial<Record<CommonObservationKey, boolean>>> = {},
): CommonObservations {
  return observationRecord(COMMON_OBSERVATION_KEYS, true, overrides) as CommonObservations;
}

export function emptyCommonObservations(
  overrides: Readonly<Partial<Record<CommonObservationKey, boolean>>> = {},
): CommonObservations {
  return observationRecord(COMMON_OBSERVATION_KEYS, false, overrides) as CommonObservations;
}

export function completeHostObservations(
  host: HostId,
  overrides: Readonly<Record<string, boolean>> = {},
): HostObservations {
  return observationRecord(HOST_OBSERVATION_KEYS[host], true, overrides);
}

export function emptyHostObservations(
  host: HostId,
  overrides: Readonly<Record<string, boolean>> = {},
): HostObservations {
  return observationRecord(HOST_OBSERVATION_KEYS[host], false, overrides);
}

function allTrue(record: Readonly<Record<string, boolean>>, keys: readonly string[]): boolean {
  return keys.every((key) => record[key] === true);
}

function allFalse(record: Readonly<Record<string, boolean>>, keys: readonly string[]): boolean {
  return keys.every((key) => record[key] === false);
}

function validPassObservations(
  evidenceLevel: EvidenceLevel,
  common: CommonObservations,
  host: HostObservations,
  hostId: HostId,
): boolean {
  const packagedKeys = COMMON_OBSERVATION_KEYS.filter((key) =>
    key !== "nativeHostProcess" && key !== "sessionBaselineObserved");
  if (evidenceLevel === "PACKAGED") {
    return allTrue(common, packagedKeys)
      && common.nativeHostProcess === false
      && common.sessionBaselineObserved === false
      && allFalse(host, HOST_OBSERVATION_KEYS[hostId]);
  }
  return allTrue(common, COMMON_OBSERVATION_KEYS) && allTrue(host, HOST_OBSERVATION_KEYS[hostId]);
}

function validStatusCombination(receipt: HostReceipt): boolean {
  if (receipt.status === "PASS") {
    return receipt.stage === "evidence_integrity"
      && receipt.reasonCode === "none"
      && receipt.attempted
      && validPassObservations(
        receipt.evidenceLevel,
        receipt.observations.common,
        receipt.observations.host,
        receipt.host,
      );
  }
  if (receipt.reasonCode === "none") return false;
  const mappedStage = RECEIPT_REASON_CODE_STAGES[receipt.reasonCode];
  if (mappedStage !== receipt.stage) return false;
  if (receipt.status === "NOT_RUN") {
    return !receipt.attempted
      && (receipt.stage === "environment" || receipt.stage === "admission")
      && allFalse(receipt.observations.common, COMMON_OBSERVATION_KEYS)
      && allFalse(receipt.observations.host, HOST_OBSERVATION_KEYS[receipt.host]);
  }
  return receipt.attempted && receipt.stage !== "environment" && receipt.stage !== "admission";
}

export function parseHostReceipt(value: unknown): HostReceipt {
  if (!isRecord(value) || !exactKeys(value, RECEIPT_KEYS)) throw new Error("invalid_receipt");
  const host = value.host;
  if (
    value.schemaVersion !== 1
    || !isHost(host)
    || !isSafeLabel(value.hostVersion)
    || (value.os !== "windows" && value.os !== "linux")
    || !isSafeLabel(value.nodeVersion)
    || !EVIDENCE_LEVELS.includes(value.evidenceLevel as EvidenceLevel)
    || !RECEIPT_STATUSES.includes(value.status as ReceiptStatus)
    || !RECEIPT_STAGES.includes(value.stage as ReceiptStage)
    || (value.reasonCode !== "none" && !(value.reasonCode as string in RECEIPT_REASON_CODE_STAGES))
    || typeof value.attempted !== "boolean"
    || typeof value.candidateSha !== "string" || !CANDIDATE_SHA.test(value.candidateSha)
    || typeof value.packageSha256 !== "string" || !DIGEST.test(value.packageSha256)
    || typeof value.packageMemberDigest !== "string" || !DIGEST.test(value.packageMemberDigest)
    || !isSafeLabel(value.workflowRunId)
    || !isIsoTimestamp(value.startedAt)
    || !isIsoTimestamp(value.completedAt)
    || typeof value.durationMs !== "number" || !Number.isSafeInteger(value.durationMs)
    || value.durationMs < 0 || value.durationMs > MAX_DURATION_MS
    || typeof value.artifactDigest !== "string" || !DIGEST.test(value.artifactDigest)
    || typeof value.logDigest !== "string" || !DIGEST.test(value.logDigest)
    || !isRecord(value.observations) || !exactKeys(value.observations, OBSERVATION_CONTAINER_KEYS)
  ) throw new Error("invalid_receipt");

  const common = booleanRecord(value.observations.common, COMMON_OBSERVATION_KEYS);
  const hostObservations = booleanRecord(value.observations.host, HOST_OBSERVATION_KEYS[host]);
  if (common === undefined || hostObservations === undefined) throw new Error("invalid_receipt");
  if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) throw new Error("invalid_receipt");

  const parsed: HostReceipt = Object.freeze({
    schemaVersion: 1,
    host,
    hostVersion: value.hostVersion,
    os: value.os,
    nodeVersion: value.nodeVersion,
    evidenceLevel: value.evidenceLevel as EvidenceLevel,
    status: value.status as ReceiptStatus,
    stage: value.stage as ReceiptStage,
    reasonCode: value.reasonCode as ReceiptReasonCode,
    attempted: value.attempted,
    candidateSha: value.candidateSha,
    packageSha256: value.packageSha256,
    packageMemberDigest: value.packageMemberDigest,
    workflowRunId: value.workflowRunId,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    durationMs: value.durationMs,
    artifactDigest: value.artifactDigest,
    logDigest: value.logDigest,
    observations: Object.freeze({ common, host: hostObservations }),
  });
  if (!validStatusCombination(parsed)) throw new Error("invalid_receipt");
  return parsed;
}

export function createHostReceipt(input: Readonly<Record<string, unknown>>): HostReceipt {
  return parseHostReceipt(input);
}

export function aggregateHostReceipts(
  values: readonly unknown[],
  options: {
    readonly requiredHosts?: readonly HostId[];
    readonly candidateSha?: string;
  } = {},
): AggregateVerdict {
  const requiredHosts = options.requiredHosts ?? HOSTS;
  if (
    requiredHosts.length === 0
    || new Set(requiredHosts).size !== requiredHosts.length
    || requiredHosts.some((host) => !HOSTS.includes(host))
  ) return "INCOMPLETE";

  const receipts: HostReceipt[] = [];
  try {
    for (const value of values) receipts.push(parseHostReceipt(value));
  } catch {
    return "INCOMPLETE";
  }
  if (receipts.length !== requiredHosts.length) return "INCOMPLETE";
  const byHost = new Map(receipts.map((item) => [item.host, item]));
  if (byHost.size !== receipts.length || requiredHosts.some((host) => !byHost.has(host))) return "INCOMPLETE";
  if (options.candidateSha !== undefined && receipts.some((item) => item.candidateSha !== options.candidateSha)) {
    return "INCOMPLETE";
  }
  if (receipts.some((item) => item.status === "FAIL")) return "FAIL";
  if (receipts.some((item) => item.status !== "PASS")) return "INCOMPLETE";
  return "PASS";
}

exports.RECEIPT_STATUSES = RECEIPT_STATUSES;
exports.AGGREGATE_VERDICTS = AGGREGATE_VERDICTS;
exports.EVIDENCE_LEVELS = EVIDENCE_LEVELS;
exports.RECEIPT_STAGES = RECEIPT_STAGES;
exports.RECEIPT_REASON_CODE_STAGES = RECEIPT_REASON_CODE_STAGES;
exports.COMMON_OBSERVATION_KEYS = COMMON_OBSERVATION_KEYS;
exports.HOST_OBSERVATION_KEYS = HOST_OBSERVATION_KEYS;
exports.completeCommonObservations = completeCommonObservations;
exports.emptyCommonObservations = emptyCommonObservations;
exports.completeHostObservations = completeHostObservations;
exports.emptyHostObservations = emptyHostObservations;
exports.parseHostReceipt = parseHostReceipt;
exports.createHostReceipt = createHostReceipt;
exports.aggregateHostReceipts = aggregateHostReceipts;
