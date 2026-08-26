/** Secret-safe selected-host source findings and independently authorized native cleanup. */

import crypto from "node:crypto";
import {
  InstallError,
  sanitizeSafeRelativePath,
  type HostId,
  type SourceFinding,
  type SourceScope,
  type SourceSeverity,
  type SourceType,
} from "../core/contracts.cjs";

export type { SourceFinding } from "../core/contracts.cjs";

export const SOURCE_SCAN_MODES = Object.freeze(["fast", "deep", "gate"] as const);
export type SourceScanMode = (typeof SOURCE_SCAN_MODES)[number];

const SOURCE_CODES = new Set([
  "active_plugin_source",
  "owned_plugin_source",
  "owned_marketplace_source",
  "raw_mcp_source",
  "manual_hook_source",
  "manual_rule_source",
  "cache_residue",
  "disabled_source",
  "ambiguous_source",
  "source_scan_unavailable",
  "manual_cleanup_required",
]);
const SOURCE_TYPES = new Set<SourceType>([
  "active_plugin",
  "owned_plugin",
  "owned_marketplace_registration",
  "raw_mcp",
  "manual_hook",
  "manual_rule",
  "cache_residue",
  "disabled_registration",
  "ambiguous",
]);
const OWNED_TYPES = new Set<SourceType>(["owned_plugin", "owned_marketplace_registration"]);
const INFORMATIONAL_TYPES = new Set<SourceType>(["cache_residue", "disabled_registration"]);
const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const ARG_PATTERN = /^[A-Za-z0-9@._\/:=-]{1,256}$/;

export type NativeCapabilityRoute = "normal" | "degraded_owned_registration";

export interface NativeHostCapability {
  readonly host: HostId;
  readonly cli: string;
  readonly minimumVersion: string;
  readonly observedVersion: string;
  readonly inventorySchemaId: string;
  readonly completeInventory: boolean;
  readonly route: NativeCapabilityRoute;
}

export interface NativeCleanupPlan {
  readonly host: HostId;
  readonly sourceType: "owned_plugin" | "owned_marketplace_registration";
  readonly safePath: string;
  readonly capability: NativeHostCapability;
  readonly argv: readonly string[];
  readonly scope: string;
  readonly timeoutMs: number;
  readonly command: string;
  readonly fingerprint: string;
}

export interface SourceScanResult {
  readonly mode: SourceScanMode;
  readonly findings: readonly SourceFinding[];
  readonly cleanupPlans: readonly NativeCleanupPlan[];
  readonly hasConflict: boolean;
}

export interface OwnedCleanupAuthority {
  readonly allowOwnedSourceCleanup: boolean;
  readonly cleanupFingerprint?: string;
}

export interface NativeRunRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface NativeRunResult {
  readonly exitCode: number;
  readonly timedOut: boolean;
}

export type NativeCommandRunner = (
  request: NativeRunRequest,
) => Promise<NativeRunResult | Readonly<Record<string, unknown>>>;

type SourceFindingInput = {
  readonly code: string;
  readonly severity: SourceSeverity;
  readonly sourceType: SourceType;
  readonly scope: SourceScope;
  readonly safePath: string;
  readonly cleanupEligible: boolean;
  readonly cleanupCommand?: unknown;
  readonly cleanupFingerprint?: unknown;
};

type NativeCapabilityInput = NativeHostCapability;

type NativeCleanupPlanInput = {
  readonly host: HostId;
  readonly sourceType: SourceType;
  readonly safePath: string;
  readonly capability: NativeHostCapability;
  readonly argv: readonly string[];
  readonly scope: string;
  readonly timeoutMs: number;
};

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isHost(value: unknown): value is HostId {
  return value === "codex" || value === "claude" || value === "cursor" || value === "opencode";
}

function isSecretLike(value: string): boolean {
  return /[\r\n\0]|:\/\/|authorization|bearer|subprocess|[{}]/i.test(value);
}

function safePath(input: string, errorCode: string): string {
  if (typeof input !== "string" || isSecretLike(input)) throw new InstallError(errorCode);
  const normalized = sanitizeSafeRelativePath(input);
  if (normalized === undefined || (normalized === "." && input !== ".")) {
    throw new InstallError(errorCode);
  }
  return normalized;
}

function safeIdentifier(input: unknown, errorCode: string): string {
  if (typeof input !== "string" || !ID_PATTERN.test(input) || isSecretLike(input)) {
    throw new InstallError(errorCode);
  }
  return input;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    result[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return result;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonicalize(value)), "utf8");
}

function isCapability(value: unknown): value is NativeHostCapability {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<NativeHostCapability>;
  return isHost(item.host) &&
    typeof item.cli === "string" && ARG_PATTERN.test(item.cli) &&
    typeof item.minimumVersion === "string" && VERSION_PATTERN.test(item.minimumVersion) &&
    typeof item.observedVersion === "string" && VERSION_PATTERN.test(item.observedVersion) &&
    typeof item.inventorySchemaId === "string" && ID_PATTERN.test(item.inventorySchemaId) &&
    typeof item.completeInventory === "boolean" &&
    (item.route === "normal" || item.route === "degraded_owned_registration") &&
    ((item.route === "normal" && item.completeInventory) ||
      (item.route === "degraded_owned_registration" && !item.completeInventory));
}

export function createNativeHostCapability(input: NativeCapabilityInput): NativeHostCapability {
  if (!isCapability(input) || input.cli !== input.host) {
    throw new InstallError("invalid_native_capability");
  }
  return Object.freeze({ ...input });
}

export function createNativeCleanupPlan(input: NativeCleanupPlanInput): NativeCleanupPlan {
  if (
    !isHost(input.host) ||
    !OWNED_TYPES.has(input.sourceType) ||
    !isCapability(input.capability) ||
    input.capability.host !== input.host ||
    !Array.isArray(input.argv) ||
    input.argv.length < 2 ||
    input.argv.length > 12 ||
    input.argv.some((part) => typeof part !== "string" || !ARG_PATTERN.test(part) || isSecretLike(part)) ||
    input.argv[0] !== input.capability.cli ||
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 5_000
  ) {
    throw new InstallError("invalid_cleanup_plan");
  }
  const normalizedPath = safePath(input.safePath, "invalid_cleanup_plan");
  const normalizedScope = safeIdentifier(input.scope, "invalid_cleanup_plan");
  const seed = Object.freeze({
    argv: Object.freeze([...input.argv]),
    capability: input.capability,
    host: input.host,
    safePath: normalizedPath,
    scope: normalizedScope,
    sourceType: input.sourceType as "owned_plugin" | "owned_marketplace_registration",
    timeoutMs: input.timeoutMs,
  });
  const fingerprint = `sha256:${crypto.createHash("sha256").update(canonicalBytes(seed)).digest("hex")}`;
  return Object.freeze({
    ...seed,
    command: input.argv.join(" "),
    fingerprint,
  });
}

export function createSourceFinding(input: SourceFindingInput): SourceFinding {
  if (
    !SOURCE_CODES.has(input.code) ||
    (input.severity !== "info" && input.severity !== "conflict") ||
    !SOURCE_TYPES.has(input.sourceType) ||
    (input.scope !== "project" && input.scope !== "user") ||
    INFORMATIONAL_TYPES.has(input.sourceType) !== (input.severity === "info")
  ) {
    throw new InstallError("invalid_source_finding");
  }
  const normalizedPath = safePath(input.safePath, "invalid_source_finding");
  const eligible = input.cleanupEligible === true;
  if (
    typeof input.cleanupEligible !== "boolean" ||
    (eligible && !OWNED_TYPES.has(input.sourceType)) ||
    (!eligible && (input.cleanupCommand !== undefined || input.cleanupFingerprint !== undefined)) ||
    (eligible && (
      typeof input.cleanupCommand !== "string" ||
      input.cleanupCommand.length === 0 ||
      input.cleanupCommand.length > 512 ||
      isSecretLike(input.cleanupCommand) ||
      typeof input.cleanupFingerprint !== "string" ||
      !FINGERPRINT_PATTERN.test(input.cleanupFingerprint)
    ))
  ) {
    throw new InstallError("invalid_source_finding");
  }
  const result: {
    code: string;
    severity: SourceSeverity;
    sourceType: SourceType;
    scope: SourceScope;
    safePath: string;
    cleanupEligible: boolean;
    cleanupCommand?: string;
    cleanupFingerprint?: string;
  } = {
    code: input.code,
    severity: input.severity,
    sourceType: input.sourceType,
    scope: input.scope,
    safePath: normalizedPath,
    cleanupEligible: eligible,
  };
  if (eligible) {
    result.cleanupCommand = input.cleanupCommand as string;
    result.cleanupFingerprint = input.cleanupFingerprint as string;
  }
  return Object.freeze(result);
}

export function createSourceScanResult(
  mode: SourceScanMode,
  findings: readonly SourceFinding[],
  cleanupPlans: readonly NativeCleanupPlan[] = [],
): SourceScanResult {
  if (!SOURCE_SCAN_MODES.includes(mode)) throw new InstallError("invalid_source_scan");
  const sortedFindings = [...findings].sort((left, right) =>
    compareCodeUnits(left.safePath, right.safePath) ||
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(left.sourceType, right.sourceType));
  const sortedPlans = [...cleanupPlans].sort((left, right) => compareCodeUnits(left.fingerprint, right.fingerprint));
  const eligibleFingerprints = new Set(
    sortedFindings.filter((finding) => finding.cleanupEligible).map((finding) => finding.cleanupFingerprint),
  );
  if (
    sortedPlans.some((plan) => !FINGERPRINT_PATTERN.test(plan.fingerprint)) ||
    sortedPlans.some((plan) => !eligibleFingerprints.has(plan.fingerprint)) ||
    eligibleFingerprints.size !== sortedPlans.length
  ) {
    throw new InstallError("invalid_source_scan");
  }
  return Object.freeze({
    mode,
    findings: Object.freeze(sortedFindings),
    cleanupPlans: Object.freeze(sortedPlans),
    hasConflict: sortedFindings.some((finding) => finding.severity === "conflict"),
  });
}

export async function runOwnedSourceCleanup(
  plan: NativeCleanupPlan,
  authority: OwnedCleanupAuthority,
  runner: NativeCommandRunner,
): Promise<NativeRunResult> {
  if (!authority.allowOwnedSourceCleanup || authority.cleanupFingerprint === undefined) {
    throw new InstallError("owned_source_cleanup_not_authorized");
  }
  if (!FINGERPRINT_PATTERN.test(authority.cleanupFingerprint) || authority.cleanupFingerprint !== plan.fingerprint) {
    throw new InstallError("cleanup_fingerprint_mismatch");
  }
  const result = await runner(Object.freeze({
    executable: plan.argv[0] as string,
    args: Object.freeze(plan.argv.slice(1)),
    timeoutMs: plan.timeoutMs,
  }));
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.exitCode !== "number" ||
    !Number.isInteger(result.exitCode) ||
    typeof result.timedOut !== "boolean" ||
    result.timedOut ||
    result.exitCode !== 0
  ) {
    throw new InstallError("owned_source_cleanup_failed");
  }
  return Object.freeze({ exitCode: result.exitCode, timedOut: result.timedOut });
}
