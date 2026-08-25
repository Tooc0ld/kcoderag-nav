/** Host-neutral installer contracts. Runtime diagnostics never carry payload bytes. */

export const CORE_SCHEMA_VERSION = 1 as const;

export type HostId = "codex" | "claude" | "cursor";
export type CurrentEnvironmentId = "qa";
export type LegacyEnvironmentId = CurrentEnvironmentId | "dev";
/** Transitional compatibility input for legacy readers and pre-0.2.0 generators. */
export type EnvironmentId = LegacyEnvironmentId;
export type InstallStatus =
  | "healthy"
  | "not_installed"
  | "drifted"
  | "update_available"
  | "invalid";

export interface StatusIssue {
  readonly code: string;
  readonly path: string;
}

export interface StatusResult {
  readonly schemaVersion: typeof CORE_SCHEMA_VERSION;
  readonly status: InstallStatus;
  readonly host?: HostId;
  readonly environment?: EnvironmentId;
  readonly issues: readonly StatusIssue[];
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

export interface InstallState {
  readonly schemaVersion: typeof CORE_SCHEMA_VERSION;
  readonly packageVersion: string;
  readonly host: HostId;
  readonly environment: CurrentEnvironmentId;
  readonly managedFiles: readonly string[];
  readonly originals: Readonly<Record<string, OriginalRecord>>;
  readonly digests: Readonly<Record<string, string>>;
  /** Present for section-owned shared files; legacy whole-file states omit this field. */
  readonly sections?: Readonly<Record<string, ManagedSectionRecord>>;
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
