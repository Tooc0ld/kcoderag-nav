/** Deterministic Windows live-host scheduling with lane-local cleanup and closed receipts. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

import type { HostId } from "../core/contracts.cjs";
import {
  aggregateHostReceipts,
  createHostReceipt,
  emptyCommonObservations,
  emptyHostObservations,
  type AcceptanceObservations,
  type AggregateVerdict,
  type FailureReasonCode,
  type HostReceipt,
  type ReceiptReasonCode,
  type ReceiptStage,
  type ReceiptStatus,
} from "./acceptance-receipt.cjs";

export const PARALLEL_HOSTS = Object.freeze(["codex", "claude", "opencode"] as const);
export const SERIAL_HOSTS = Object.freeze(["cursor", "zcode"] as const);
const HOSTS = Object.freeze(["codex", "claude", "cursor", "opencode", "zcode"] as const);

export interface LaneContext {
  readonly host: HostId;
  readonly laneRoot: string;
  readonly projectRoot: string;
  readonly cacheRoot: string;
  readonly npmCacheRoot: string;
}

export type LaneAdmission =
  | Readonly<{ readonly admitted: true }>
  | Readonly<{
      readonly admitted: false;
      readonly stage: "environment" | "admission";
      readonly reasonCode: FailureReasonCode;
    }>;

export interface LaneOutcome {
  readonly status: "PASS" | "FAIL";
  readonly stage: ReceiptStage;
  readonly reasonCode: ReceiptReasonCode;
  readonly observations: AcceptanceObservations;
}

export interface LiveCoordinatorOptions {
  readonly root: string;
  readonly candidateSha: string;
  readonly packageSha256: string;
  readonly packageMemberDigest: string;
  readonly workflowRunId: string;
  readonly artifactDigest: string;
  readonly nodeVersion: string;
  readonly os: "windows" | "linux";
  readonly hostVersions: Readonly<Record<HostId, string>>;
}

export interface LiveCoordinatorDependencies {
  readonly probeLane: (context: LaneContext) => Promise<LaneAdmission>;
  readonly runLane: (context: LaneContext) => Promise<LaneOutcome>;
  readonly cleanupLane?: (context: LaneContext) => Promise<void>;
  readonly now?: () => number;
}

export interface LiveCoordinatorResult {
  readonly schemaVersion: 1;
  readonly verdict: AggregateVerdict;
  readonly receipts: readonly HostReceipt[];
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function laneContext(root: string, host: HostId): LaneContext {
  const ordinal = String(HOSTS.indexOf(host) + 1).padStart(2, "0");
  const laneRoot = path.join(root, `${ordinal}-${host}`);
  const context = Object.freeze({
    host,
    laneRoot,
    projectRoot: path.join(laneRoot, "project"),
    cacheRoot: path.join(laneRoot, "cache"),
    npmCacheRoot: path.join(laneRoot, "npm-cache"),
  });
  for (const directory of [context.projectRoot, context.cacheRoot, context.npmCacheRoot]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return context;
}

function safeAdmission(value: LaneAdmission): value is LaneAdmission {
  if (value.admitted) return true;
  if (value.stage !== "environment" && value.stage !== "admission") return false;
  const environment = new Set(["host_unavailable", "host_cli_missing", "runner_unavailable", "node_version_unsupported"]);
  const admission = new Set([
    "host_version_unsupported",
    "host_auth_missing",
    "workspace_trust_missing",
    "protected_environment_denied",
    "untrusted_ref",
  ]);
  return value.stage === "environment"
    ? environment.has(value.reasonCode)
    : admission.has(value.reasonCode);
}

function terminalReceipt(input: {
  readonly options: LiveCoordinatorOptions;
  readonly host: HostId;
  readonly status: ReceiptStatus;
  readonly stage: ReceiptStage;
  readonly reasonCode: ReceiptReasonCode;
  readonly attempted: boolean;
  readonly observations: AcceptanceObservations;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
}): HostReceipt {
  return createHostReceipt({
    schemaVersion: 1,
    host: input.host,
    hostVersion: input.options.hostVersions[input.host],
    os: input.options.os,
    nodeVersion: input.options.nodeVersion,
    evidenceLevel: "LIVE",
    status: input.status,
    stage: input.stage,
    reasonCode: input.reasonCode,
    attempted: input.attempted,
    candidateSha: input.options.candidateSha,
    packageSha256: input.options.packageSha256,
    packageMemberDigest: input.options.packageMemberDigest,
    workflowRunId: input.options.workflowRunId,
    startedAt: new Date(input.startedAtMs).toISOString(),
    completedAt: new Date(input.completedAtMs).toISOString(),
    durationMs: Math.max(0, input.completedAtMs - input.startedAtMs),
    artifactDigest: input.options.artifactDigest,
    logDigest: sha256([
      input.host,
      input.status,
      input.stage,
      input.reasonCode,
      String(input.attempted),
    ].join(":")),
    observations: input.observations,
  });
}

function emptyObservations(host: HostId): AcceptanceObservations {
  return Object.freeze({
    common: emptyCommonObservations(),
    host: emptyHostObservations(host),
  });
}

function withCleanupObservation(
  host: HostId,
  observations: AcceptanceObservations | undefined,
  cleaned: boolean,
): AcceptanceObservations {
  const source = observations ?? emptyObservations(host);
  return Object.freeze({
    common: Object.freeze({ ...source.common, processTreeCleaned: cleaned }),
    host: source.host,
  });
}

async function executeLane(
  host: HostId,
  options: LiveCoordinatorOptions,
  dependencies: LiveCoordinatorDependencies,
): Promise<HostReceipt> {
  const now = dependencies.now ?? Date.now;
  const startedAtMs = now();
  const context = laneContext(path.resolve(options.root), host);
  let admitted = false;
  let status: ReceiptStatus = "NOT_RUN";
  let stage: ReceiptStage = "environment";
  let reasonCode: ReceiptReasonCode = "runner_unavailable";
  let observations: AcceptanceObservations | undefined;

  try {
    let admission: LaneAdmission;
    try {
      admission = await dependencies.probeLane(context);
    } catch {
      admission = Object.freeze({ admitted: false, stage: "environment", reasonCode: "runner_unavailable" });
    }
    if (!safeAdmission(admission)) {
      admission = Object.freeze({ admitted: false, stage: "environment", reasonCode: "runner_unavailable" });
    }
    if (!admission.admitted) {
      stage = admission.stage;
      reasonCode = admission.reasonCode;
    } else {
      admitted = true;
      try {
        const outcome = await dependencies.runLane(context);
        status = outcome.status;
        stage = outcome.stage;
        reasonCode = outcome.reasonCode;
        observations = outcome.observations;
      } catch {
        status = "FAIL";
        stage = "native_event";
        reasonCode = "native_event_failed";
      }
    }
  } finally {
    let cleaned = true;
    try {
      await dependencies.cleanupLane?.(context);
    } catch {
      cleaned = false;
    }
    try {
      fs.rmSync(context.laneRoot, { recursive: true, force: true });
    } catch {
      cleaned = false;
    }
    if (admitted && !cleaned) {
      status = "FAIL";
      stage = "evidence_integrity";
      reasonCode = "cleanup_failed";
    }
    observations = admitted
      ? withCleanupObservation(host, observations, cleaned)
      : emptyObservations(host);
  }

  const completedAtMs = now();
  try {
    return terminalReceipt({
      options,
      host,
      status,
      stage,
      reasonCode,
      attempted: admitted,
      observations,
      startedAtMs,
      completedAtMs,
    });
  } catch {
    return terminalReceipt({
      options,
      host,
      status: admitted ? "FAIL" : "NOT_RUN",
      stage: admitted ? "evidence_integrity" : "environment",
      reasonCode: admitted ? "receipt_invalid" : "runner_unavailable",
      attempted: admitted,
      observations: admitted
        ? withCleanupObservation(host, emptyObservations(host), false)
        : emptyObservations(host),
      startedAtMs,
      completedAtMs,
    });
  }
}

export async function runLiveHostCoordinator(
  options: LiveCoordinatorOptions,
  dependencies: LiveCoordinatorDependencies,
): Promise<LiveCoordinatorResult> {
  const parallel = await Promise.all(PARALLEL_HOSTS.map((host) => executeLane(host, options, dependencies)));
  const serial: HostReceipt[] = [];
  for (const host of SERIAL_HOSTS) serial.push(await executeLane(host, options, dependencies));
  const byHost = new Map([...parallel, ...serial].map((item) => [item.host, item]));
  const receipts = Object.freeze(HOSTS.map((host) => byHost.get(host)).filter((item): item is HostReceipt => item !== undefined));
  return Object.freeze({
    schemaVersion: 1,
    verdict: aggregateHostReceipts(receipts, { requiredHosts: HOSTS, candidateSha: options.candidateSha }),
    receipts,
  });
}

exports.PARALLEL_HOSTS = PARALLEL_HOSTS;
exports.SERIAL_HOSTS = SERIAL_HOSTS;
exports.runLiveHostCoordinator = runLiveHostCoordinator;
