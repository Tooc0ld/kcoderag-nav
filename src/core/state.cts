/** Schema, desired-state, runtime, and status helpers. This module never mutates disk. */

import {
  CORE_SCHEMA_VERSION,
  InstallError,
  sanitizeSafeRelativePath,
  type DesiredState,
  type EnvironmentId,
  type HostId,
  type InstallState,
  type InstallStatus,
  type OriginalRecord,
  type ProjectTarget,
  type StatusIssue,
  type StatusResult,
} from "./contracts.cjs";
import { isProjectTarget, validateManagedPath } from "./project-target.cjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const validatedDesiredStates = new WeakSet<object>();

type DesiredStateInput = {
  readonly host: HostId;
  readonly target: ProjectTarget;
  readonly managedRoots: readonly string[];
  readonly statePath: string;
  readonly entries: readonly {
    readonly relativePath: string;
    readonly expectedDigest: string | null;
    readonly content: Buffer | null;
  }[];
};

type StatusInput = {
  readonly status?: InstallStatus;
  readonly host?: HostId;
  readonly environment?: EnvironmentId;
  readonly issues?: readonly { readonly code: string; readonly path?: string }[];
};

function nodeMajor(version: string): number | undefined {
  const match = /^(?:v)?(\d+)(?:\.|$)/.exec(version);
  return match === null ? undefined : Number.parseInt(match[1] as string, 10);
}

export function runtimeStatusIssue(version = process.versions.node): StatusIssue | undefined {
  const major = nodeMajor(version);
  return major !== undefined && major >= 22
    ? undefined
    : Object.freeze({ code: "unsupported_node", path: "." });
}

export function assertMutationRuntime(version = process.versions.node): void {
  if (runtimeStatusIssue(version) !== undefined) throw new InstallError("unsupported_node");
}

export function createStatusResult(input: StatusInput = {}): StatusResult {
  const issues = [...(input.issues ?? [])]
    .map((issue) => Object.freeze({
      code: issue.code,
      path: sanitizeSafeRelativePath(issue.path) ?? ".",
    }))
    .sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  const result: {
    schemaVersion: typeof CORE_SCHEMA_VERSION;
    status: InstallStatus;
    host?: HostId;
    environment?: EnvironmentId;
    issues: readonly StatusIssue[];
  } = {
    schemaVersion: CORE_SCHEMA_VERSION,
    status: input.status ?? "not_installed",
    issues: Object.freeze(issues),
  };
  if (input.host !== undefined) result.host = input.host;
  if (input.environment !== undefined) result.environment = input.environment;
  return Object.freeze(result);
}

export function createDesiredState(input: DesiredStateInput): DesiredState {
  if (!isProjectTarget(input.target) || input.entries.length === 0) {
    throw new InstallError("invalid_desired_state");
  }
  const statePath = validateManagedPath(input.target, input.statePath, input.managedRoots);
  const seen = new Set<string>();
  const entries = input.entries.map((entry) => {
    if (
      seen.has(entry.relativePath) ||
      (entry.expectedDigest !== null && !DIGEST_PATTERN.test(entry.expectedDigest)) ||
      (entry.content !== null && !Buffer.isBuffer(entry.content))
    ) {
      throw new InstallError("invalid_desired_state", entry.relativePath);
    }
    seen.add(entry.relativePath);
    const validatedPath = validateManagedPath(input.target, entry.relativePath, input.managedRoots);
    return Object.freeze({
      path: validatedPath,
      expectedDigest: entry.expectedDigest,
      content: entry.content === null ? null : Buffer.from(entry.content),
    });
  });
  if (!seen.has(statePath.relativePath)) {
    throw new InstallError("invalid_desired_state", statePath.relativePath);
  }
  const desired = Object.freeze({
    schemaVersion: CORE_SCHEMA_VERSION,
    host: input.host,
    target: input.target,
    managedRoots: Object.freeze([...input.managedRoots]),
    statePath,
    entries: Object.freeze(entries),
  });
  validatedDesiredStates.add(desired);
  return desired;
}

export function isValidatedDesiredState(value: unknown): value is DesiredState {
  return typeof value === "object" && value !== null && validatedDesiredStates.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHost(value: unknown): value is HostId {
  return value === "codex" || value === "claude" || value === "cursor";
}

function isEnvironment(value: unknown): value is EnvironmentId {
  return value === "qa" || value === "dev";
}

function validateOriginal(value: unknown): value is OriginalRecord {
  if (!isRecord(value) || (value.kind !== "absent" && value.kind !== "base64")) return false;
  if (value.kind === "absent") return value.data === undefined;
  if (typeof value.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) {
    return false;
  }
  return Buffer.from(value.data, "base64").toString("base64") === value.data;
}

/** Parse a current schema without exposing original payload bytes in errors. */
export function parseInstallState(bytes: Buffer): InstallState {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new InstallError("invalid_state");
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== CORE_SCHEMA_VERSION ||
    typeof value.packageVersion !== "string" ||
    !isHost(value.host) ||
    !isEnvironment(value.environment) ||
    !Array.isArray(value.managedFiles) ||
    !value.managedFiles.every((item) => typeof item === "string") ||
    new Set(value.managedFiles).size !== value.managedFiles.length ||
    !isRecord(value.originals) ||
    !isRecord(value.digests)
  ) {
    throw new InstallError("invalid_state");
  }
  const managed = new Set(value.managedFiles as string[]);
  if (
    Object.keys(value.originals).some((item) => !managed.has(item)) ||
    Object.keys(value.digests).some((item) => !managed.has(item)) ||
    !Object.values(value.originals).every(validateOriginal) ||
    !Object.values(value.digests).every((digest) => typeof digest === "string" && DIGEST_PATTERN.test(digest))
  ) {
    throw new InstallError("invalid_state");
  }
  return value as unknown as InstallState;
}
