#!/usr/bin/env node
/** Read-only exact-candidate artifact validation and metadata-only evidence writing. */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { HostId } from "../core/contracts.cjs";
import {
  HOST_OBSERVATION_KEYS,
  aggregateHostReceipts,
  parseHostReceipt,
  type AggregateVerdict,
  type EvidenceLevel,
  type HostReceipt,
  type ReceiptReasonCode,
  type ReceiptStage,
} from "../smoke/acceptance-receipt.cjs";

export const ACCEPTANCE_EVIDENCE_SCHEMA_VERSION = 1 as const;

export const EVIDENCE_SOURCE_KINDS = Object.freeze([
  "actual_tgz",
  "direct_launcher",
  "native_host",
] as const);
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

const HOSTS = Object.freeze(["codex", "claude", "cursor", "opencode", "zcode"] as const);
const SHA256_RE = /^[a-f0-9]{64}$/u;
const CANDIDATE_SHA_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FORBIDDEN_FIELD_RE = /^(?:query|result|url|authorization|headers?|bearer|token|config(?:value)?|credential|secret)$/iu;
const SECRET_VALUE_RE = /(?:https?:\/\/|bearer\s|authorization\s*[:=]|header\s*[:=]|token\s*[:=]|credential\s*[:=]|secret\s*[:=])/iu;
const MAX_SERIALIZED_BYTES = 512 * 1024;

export class AcceptanceEvidenceError extends Error {
  readonly stage: ReceiptStage;
  readonly reasonCode: ReceiptReasonCode;

  constructor(stage: ReceiptStage, reasonCode: ReceiptReasonCode) {
    super(reasonCode);
    this.name = "AcceptanceEvidenceError";
    this.stage = stage;
    this.reasonCode = reasonCode;
  }
}

export interface AcceptanceEvidenceInput {
  readonly candidateSha: string;
  readonly packagePath: string;
  readonly packageSha256: string;
  readonly packageMemberDigest: string;
  readonly workflowRunId: string;
  readonly evidenceLevel: EvidenceLevel;
  readonly sourceKind: EvidenceSourceKind;
  readonly requiredHosts?: readonly HostId[];
  readonly receipts?: readonly unknown[];
  readonly preparedAt: string;
}

export interface AcceptanceArtifactRequest extends AcceptanceEvidenceInput {
  readonly artifactName: string;
  readonly outputPath: string;
}

export interface AcceptanceArtifactReader {
  readWorkflowRun(runId: string, artifactName: string): Promise<readonly unknown[]>;
}

export interface AcceptanceEvidenceDocument {
  readonly schemaVersion: 1;
  readonly candidateSha: string;
  readonly packageSha256: string;
  readonly packageMemberDigest: string;
  readonly workflowRunId: string;
  readonly evidenceLevel: EvidenceLevel;
  readonly sourceKind: EvidenceSourceKind;
  readonly preparedAt: string;
  readonly aggregateVerdict: AggregateVerdict;
  readonly receiptSetDigest: string;
  readonly receipts: readonly HostReceipt[];
}

interface EvidenceFiles {
  readFile(filePath: string): Buffer;
  writeExclusive(filePath: string, bytes: string): void;
  rename(sourcePath: string, destinationPath: string): void;
  remove(filePath: string): void;
}

const DEFAULT_FILES: EvidenceFiles = Object.freeze({
  readFile(filePath: string) {
    const metadata = fs.lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new AcceptanceEvidenceError("package", "package_acquisition_failed");
    return fs.readFileSync(filePath);
  },
  writeExclusive(filePath: string, bytes: string) {
    fs.writeFileSync(filePath, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
  },
  rename(sourcePath: string, destinationPath: string) {
    fs.renameSync(sourcePath, destinationPath);
  },
  remove(filePath: string) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // The temporary file is best-effort cleanup; no evidence bytes are printed.
    }
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: string | Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isIsoTimestamp(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function containsSecretShape(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string") return SECRET_VALUE_RE.test(value);
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsSecretShape(item, seen));
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_RE.test(key) || containsSecretShape(item, seen)) return true;
  }
  return false;
}

function candidateInputValid(input: AcceptanceEvidenceInput): boolean {
  const requiredHosts = input.requiredHosts ?? HOSTS;
  return CANDIDATE_SHA_RE.test(input.candidateSha)
    && SHA256_RE.test(input.packageSha256)
    && SHA256_RE.test(input.packageMemberDigest)
    && SAFE_RUN_ID_RE.test(input.workflowRunId)
    && (input.evidenceLevel === "PACKAGED" || input.evidenceLevel === "LIVE")
    && EVIDENCE_SOURCE_KINDS.includes(input.sourceKind)
    && isIsoTimestamp(input.preparedAt)
    && requiredHosts.length > 0
    && new Set(requiredHosts).size === requiredHosts.length
    && requiredHosts.every((host) => HOSTS.includes(host));
}

export function classifyEvidenceSource(sourceKind: EvidenceSourceKind | string): EvidenceLevel {
  return sourceKind === "native_host" ? "LIVE" : "PACKAGED";
}

function assertLiveNativeEvidence(value: unknown, sourceKind: EvidenceSourceKind): void {
  if (sourceKind !== "native_host" || !isRecord(value) || value.evidenceLevel !== "LIVE") {
    throw new AcceptanceEvidenceError("native_event", "native_event_missing");
  }
  const host = value.host;
  const observations = value.observations;
  if (typeof host !== "string" || !HOSTS.includes(host as HostId) || !isRecord(observations)) {
    throw new AcceptanceEvidenceError("native_event", "native_event_missing");
  }
  const common = observations.common;
  const hostObservations = observations.host;
  if (!isRecord(common) || common.nativeHostProcess !== true || common.sessionBaselineObserved !== true
    || !isRecord(hostObservations)
    || HOST_OBSERVATION_KEYS[host as HostId].some((key) => hostObservations[key] !== true)) {
    throw new AcceptanceEvidenceError("native_event", "native_event_missing");
  }
}

function parseReceipt(value: unknown, input: AcceptanceEvidenceInput): HostReceipt {
  if (containsSecretShape(value)) throw new AcceptanceEvidenceError("evidence_integrity", "secret_detected");
  if (input.evidenceLevel === "LIVE") assertLiveNativeEvidence(value, input.sourceKind);

  let receipt: HostReceipt;
  try {
    receipt = parseHostReceipt(value);
  } catch {
    throw new AcceptanceEvidenceError("evidence_integrity", "receipt_invalid");
  }
  if (receipt.candidateSha !== input.candidateSha) {
    throw new AcceptanceEvidenceError("evidence_integrity", "candidate_mismatch");
  }
  if (receipt.packageSha256 !== input.packageSha256) {
    throw new AcceptanceEvidenceError("package", "package_hash_mismatch");
  }
  if (receipt.packageMemberDigest !== input.packageMemberDigest) {
    throw new AcceptanceEvidenceError("package", "package_inventory_mismatch");
  }
  if (receipt.workflowRunId !== input.workflowRunId || receipt.evidenceLevel !== input.evidenceLevel) {
    throw new AcceptanceEvidenceError("evidence_integrity", "receipt_invalid");
  }
  return receipt;
}

function canonicalReceiptSet(receipts: readonly HostReceipt[]): string {
  const sorted = [...receipts].sort((left, right) => left.host.localeCompare(right.host, "en"));
  return JSON.stringify(sorted);
}

export function buildAcceptanceEvidence(input: AcceptanceEvidenceInput): AcceptanceEvidenceDocument {
  if (!candidateInputValid(input)) throw new AcceptanceEvidenceError("evidence_integrity", "receipt_invalid");
  if (!Array.isArray(input.receipts)) throw new AcceptanceEvidenceError("evidence_integrity", "receipt_invalid");

  let packageBytes: Buffer;
  try {
    packageBytes = DEFAULT_FILES.readFile(input.packagePath);
  } catch (error) {
    if (error instanceof AcceptanceEvidenceError) throw error;
    throw new AcceptanceEvidenceError("package", "package_acquisition_failed");
  }
  if (sha256(packageBytes) !== input.packageSha256) {
    throw new AcceptanceEvidenceError("package", "package_hash_mismatch");
  }

  const receipts = Object.freeze(input.receipts.map((value) => parseReceipt(value, input)));
  const requiredHosts = input.requiredHosts ?? HOSTS;
  const aggregateVerdict = aggregateHostReceipts(receipts, {
    requiredHosts,
    candidateSha: input.candidateSha,
  });
  const document: AcceptanceEvidenceDocument = Object.freeze({
    schemaVersion: ACCEPTANCE_EVIDENCE_SCHEMA_VERSION,
    candidateSha: input.candidateSha,
    packageSha256: input.packageSha256,
    packageMemberDigest: input.packageMemberDigest,
    workflowRunId: input.workflowRunId,
    evidenceLevel: input.evidenceLevel,
    sourceKind: input.sourceKind,
    preparedAt: input.preparedAt,
    aggregateVerdict,
    receiptSetDigest: sha256(canonicalReceiptSet(receipts)),
    receipts,
  });
  if (containsSecretShape(document)) throw new AcceptanceEvidenceError("evidence_integrity", "secret_detected");
  return document;
}

export function writeAcceptanceEvidence(
  outputPath: string,
  document: AcceptanceEvidenceDocument,
  files: EvidenceFiles = DEFAULT_FILES,
): void {
  if (typeof outputPath !== "string" || outputPath.length === 0 || containsSecretShape(document)) {
    throw new AcceptanceEvidenceError("evidence_integrity", "secret_detected");
  }
  const bytes = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(bytes, "utf8") > MAX_SERIALIZED_BYTES) {
    throw new AcceptanceEvidenceError("evidence_integrity", "receipt_invalid");
  }
  const directoryPath = path.dirname(outputPath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(outputPath)}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`,
  );
  try {
    files.writeExclusive(temporaryPath, bytes);
    files.rename(temporaryPath, outputPath);
  } catch (error) {
    files.remove(temporaryPath);
    if (error instanceof AcceptanceEvidenceError) throw error;
    throw new AcceptanceEvidenceError("evidence_integrity", "receipt_invalid");
  }
}

export async function consumeAcceptanceArtifacts(
  request: AcceptanceArtifactRequest,
  reader: AcceptanceArtifactReader,
): Promise<AcceptanceEvidenceDocument> {
  if (!SAFE_RUN_ID_RE.test(request.workflowRunId) || !SAFE_RUN_ID_RE.test(request.artifactName)) {
    throw new AcceptanceEvidenceError("evidence_integrity", "receipt_invalid");
  }
  const receipts = await reader.readWorkflowRun(request.workflowRunId, request.artifactName);
  const document = buildAcceptanceEvidence({ ...request, receipts });
  writeAcceptanceEvidence(request.outputPath, document);
  return document;
}

export function readAcceptanceArtifactFile(filePath: string): readonly unknown[] {
  try {
    const metadata = fs.lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("invalid");
    const bytes = fs.readFileSync(filePath);
    if (bytes.length === 0 || bytes.length > MAX_SERIALIZED_BYTES) throw new Error("invalid");
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed) && Array.isArray(parsed.receipts)) return parsed.receipts;
  } catch {
    // Fall through to one stable metadata-only error.
  }
  throw new AcceptanceEvidenceError("evidence_integrity", "receipt_invalid");
}

interface CliIo {
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly stderr?: Pick<NodeJS.WriteStream, "write">;
}

function parseFlags(argv: readonly string[]): Readonly<Record<string, string>> | undefined {
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === undefined || value === undefined || !name.startsWith("--") || name.length < 3) return undefined;
    const key = name.slice(2);
    if (flags[key] !== undefined) return undefined;
    flags[key] = value;
  }
  return Object.freeze(flags);
}

export function runCli(argv: readonly string[] = process.argv.slice(2), io: CliIo = {}): number {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const flags = parseFlags(argv);
  try {
    if (flags === undefined) throw new AcceptanceEvidenceError("evidence_integrity", "receipt_invalid");
    const required = [
      "input", "output", "package", "candidate-sha", "package-sha256", "package-member-digest",
      "workflow-run-id", "evidence-level", "source-kind", "prepared-at", "hosts",
    ] as const;
    if (Object.keys(flags).length !== required.length || required.some((key) => flags[key] === undefined)) {
      throw new AcceptanceEvidenceError("evidence_integrity", "receipt_invalid");
    }
    const hostTokens = flags.hosts?.split(",") ?? [];
    if (hostTokens.some((host) => !HOSTS.includes(host as HostId))) {
      throw new AcceptanceEvidenceError("evidence_integrity", "receipt_invalid");
    }
    const document = buildAcceptanceEvidence({
      candidateSha: flags["candidate-sha"] as string,
      packagePath: flags.package as string,
      packageSha256: flags["package-sha256"] as string,
      packageMemberDigest: flags["package-member-digest"] as string,
      workflowRunId: flags["workflow-run-id"] as string,
      evidenceLevel: flags["evidence-level"] as EvidenceLevel,
      sourceKind: flags["source-kind"] as EvidenceSourceKind,
      preparedAt: flags["prepared-at"] as string,
      requiredHosts: hostTokens as HostId[],
      receipts: readAcceptanceArtifactFile(flags.input as string),
    });
    writeAcceptanceEvidence(flags.output as string, document);
    stdout.write(`${JSON.stringify({ ok: true, aggregateVerdict: document.aggregateVerdict })}\n`);
    return 0;
  } catch (error) {
    const safe = error instanceof AcceptanceEvidenceError
      ? { ok: false, stage: error.stage, reasonCode: error.reasonCode }
      : { ok: false, stage: "evidence_integrity", reasonCode: "receipt_invalid" };
    stderr.write(`${JSON.stringify(safe)}\n`);
    return 1;
  }
}

exports.ACCEPTANCE_EVIDENCE_SCHEMA_VERSION = ACCEPTANCE_EVIDENCE_SCHEMA_VERSION;
exports.EVIDENCE_SOURCE_KINDS = EVIDENCE_SOURCE_KINDS;
exports.AcceptanceEvidenceError = AcceptanceEvidenceError;
exports.classifyEvidenceSource = classifyEvidenceSource;
exports.buildAcceptanceEvidence = buildAcceptanceEvidence;
exports.writeAcceptanceEvidence = writeAcceptanceEvidence;
exports.consumeAcceptanceArtifacts = consumeAcceptanceArtifacts;
exports.readAcceptanceArtifactFile = readAcceptanceArtifactFile;
exports.runCli = runCli;

if (require.main === module) process.exitCode = runCli();
