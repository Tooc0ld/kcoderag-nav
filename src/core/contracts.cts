/** Host-neutral installer contracts. Runtime diagnostics never carry payload bytes. */

import type { CapabilityId } from "../capabilities/contracts.cjs";

export const CORE_SCHEMA_VERSION = 1 as const;

export type HostId = "codex" | "claude" | "cursor" | "opencode" | "zcode";
export type CurrentEnvironmentId = "qa";
export type InstallStatus =
  | "healthy"
  | "not_installed"
  | "drifted"
  | "update_available"
  | "source_conflict"
  | "invalid";

export type SourceSeverity = "info" | "conflict";
export type SourceScope = "project" | "user";
export type SourceType =
  | "active_plugin"
  | "owned_plugin"
  | "owned_marketplace_registration"
  | "raw_mcp"
  | "manual_hook"
  | "manual_rule"
  | "cache_residue"
  | "disabled_registration"
  | "ambiguous";

/** Closed public source metadata. Configuration and subprocess values never enter this shape. */
export interface SourceFinding {
  readonly code: string;
  readonly severity: SourceSeverity;
  readonly sourceType: SourceType;
  readonly scope: SourceScope;
  readonly safePath: string;
}

export interface StatusIssue {
  readonly code: string;
  readonly path: string;
}

export interface StatusResult {
  readonly schemaVersion: typeof CORE_SCHEMA_VERSION;
  readonly status: InstallStatus;
  readonly host?: HostId;
  readonly environment?: CurrentEnvironmentId;
  readonly issues: readonly StatusIssue[];
  readonly findings: readonly SourceFinding[];
}

export type CliResult<T> =
  | {
      readonly schemaVersion: typeof CORE_SCHEMA_VERSION;
      readonly ok: true;
      readonly data: T;
    }
  | {
      readonly schemaVersion: typeof CORE_SCHEMA_VERSION;
      readonly ok: false;
      readonly error: StatusIssue;
    };

export interface ProjectTarget {
  readonly root: string;
}

export interface ValidatedPath {
  readonly relativePath: string;
  readonly absolutePath: string;
}

export interface DesiredEntry {
  readonly path: ValidatedPath;
  /** null means the destination must be absent at commit preflight. */
  readonly expectedDigest: string | null;
  /** null means delete the destination. */
  readonly content: Buffer | null;
}

export interface DesiredState {
  readonly schemaVersion: typeof CORE_SCHEMA_VERSION;
  readonly host: HostId;
  readonly target: ProjectTarget;
  readonly managedRoots: readonly string[];
  readonly statePath: ValidatedPath;
  readonly entries: readonly DesiredEntry[];
}

export interface OriginalRecord {
  readonly kind: "absent" | "base64";
  readonly data?: string;
}

/** Non-sensitive identity and integrity metadata for one entry in a shared config file. */
export interface ManagedSectionRecord {
  readonly id: string;
  readonly digest: string;
  readonly fileExisted: boolean;
  /** Parent containers created by the installer and removable only while still empty. */
  readonly createdContainers?: readonly string[];
}

/** Exact ownership for one installed capability in the capability-scoped schema. */
export interface CapabilityStateRecord {
  readonly id: CapabilityId;
  readonly files: readonly string[];
  readonly sections: readonly string[];
}

/** One complete managed file payload and the contributors that require it. */
export interface CapabilityManagedFileRecord {
  readonly path: string;
  readonly digest: string;
  readonly original: OriginalRecord;
  readonly contributors: readonly CapabilityId[];
}

/** Non-sensitive ownership metadata for one logical section of a managed file. */
export interface CapabilityManagedSectionRecord {
  readonly path: string;
  readonly id: string;
  readonly digest: string;
  readonly fileExisted: boolean;
  readonly createdContainers?: readonly string[];
  readonly contributors: readonly CapabilityId[];
}

/**
 * Exact current capability state. The composite digest binds the selected set and
 * every ownership record without exposing any managed payload in diagnostics.
 */
export interface InstallState {
  readonly schemaVersion: typeof CORE_SCHEMA_VERSION;
  readonly packageVersion: string;
  readonly host: HostId;
  readonly capabilities: readonly CapabilityStateRecord[];
  readonly files: readonly CapabilityManagedFileRecord[];
  readonly sections: readonly CapabilityManagedSectionRecord[];
  readonly compositeDigest: string;
}

export function sanitizeSafeRelativePath(input?: string): string | undefined {
  if (input === undefined) return undefined;
  const normalized = input.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    return ".";
  }
  return normalized;
}

/** An expected refusal containing only a stable code and a safe relative path. */
export class InstallError extends Error {
  readonly code: string;
  readonly safePath?: string;

  constructor(code: string, safePath?: string) {
    super(code);
    this.name = "InstallError";
    this.code = code;
    const normalized = sanitizeSafeRelativePath(safePath);
    if (normalized !== undefined) this.safePath = normalized;
  }
}
