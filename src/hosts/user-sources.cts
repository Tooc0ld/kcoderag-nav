/** Secret-safe selected-host source findings. This module never authorizes mutation. */

import {
  InstallError,
  sanitizeSafeRelativePath,
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
  "manual_skill_source",
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
const INFORMATIONAL_TYPES = new Set<SourceType>(["cache_residue", "disabled_registration"]);

export interface SourceScanResult {
  readonly mode: SourceScanMode;
  readonly findings: readonly SourceFinding[];
  readonly hasConflict: boolean;
  /** Compile-only Plan 07 seam. Current runtime results intentionally omit this property. */
  readonly cleanupPlans: readonly NativeCleanupPlan[];
}

/** Compile-only shape consumed by the Plan 07-owned controller; no runtime factory exists. */
export interface NativeCleanupPlan {
  readonly safePath: string;
  readonly command: string;
  readonly fingerprint: string;
}

/** Compile-only shape consumed by the Plan 07-owned controller; no adapter accepts it. */
export interface OwnedCleanupAuthority {
  readonly allowOwnedSourceCleanup: boolean;
  readonly cleanupFingerprint?: string;
}

/** Read-only host probes may execute bounded native inventory commands. */
export interface NativeRunRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

type SourceFindingInput = {
  readonly code: string;
  readonly severity: SourceSeverity;
  readonly sourceType: SourceType;
  readonly scope: SourceScope;
  readonly safePath: string;
};

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSecretLike(value: string): boolean {
  return /[\r\n\0]|:\/\/|authorization|bearer|subprocess|[{}]/i.test(value);
}

function safePath(input: string): string {
  if (typeof input !== "string" || isSecretLike(input)) {
    throw new InstallError("invalid_source_finding");
  }
  const normalized = sanitizeSafeRelativePath(input);
  if (normalized === undefined || (normalized === "." && input !== ".")) {
    throw new InstallError("invalid_source_finding");
  }
  return normalized;
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
  return Object.freeze({
    code: input.code,
    severity: input.severity,
    sourceType: input.sourceType,
    scope: input.scope,
    safePath: safePath(input.safePath),
  });
}

export function createSourceScanResult(
  mode: SourceScanMode,
  findings: readonly SourceFinding[],
): SourceScanResult {
  if (!SOURCE_SCAN_MODES.includes(mode)) throw new InstallError("invalid_source_scan");
  const sortedFindings = [...findings].sort((left, right) =>
    compareCodeUnits(left.safePath, right.safePath) ||
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(left.sourceType, right.sourceType));
  return Object.freeze({
    mode,
    findings: Object.freeze(sortedFindings),
    hasConflict: sortedFindings.some((finding) => finding.severity === "conflict"),
  }) as SourceScanResult;
}
