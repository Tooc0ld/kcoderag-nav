/** Schema, desired-state, runtime, and status helpers. This module never mutates disk. */

import {
  CORE_SCHEMA_VERSION,
  InstallError,
  sanitizeSafeRelativePath,
  type CurrentEnvironmentId,
  type DesiredState,
  type EnvironmentId,
  type HostId,
  type InstallState,
  type InstallStatus,
  type LegacyEnvironmentId,
  type ManagedSectionRecord,
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

export interface LegacyInstallState {
  readonly version: 1;
  readonly source: "python" | "node";
  readonly environment: LegacyEnvironmentId;
  readonly managedFiles: readonly string[];
  readonly originals: Readonly<Record<string, OriginalRecord>>;
  readonly digests: Readonly<Record<string, string>>;
  readonly packageVersion?: string;
  readonly host?: HostId;
  readonly sections?: Readonly<Record<string, ManagedSectionRecord>>;
}

interface LegacyStateOptions {
  readonly allowedPaths: readonly string[];
  readonly requiredPaths: readonly string[];
}

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

function isLegacyEnvironment(value: unknown): value is LegacyEnvironmentId {
  return value === "qa" || value === "dev";
}

function isCurrentEnvironment(value: unknown): value is CurrentEnvironmentId {
  return value === "qa";
}

function validateOriginal(value: unknown): value is OriginalRecord {
  if (!isRecord(value) || (value.kind !== "absent" && value.kind !== "base64")) return false;
  if (value.kind === "absent") return value.data === undefined;
  if (typeof value.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) {
    return false;
  }
  return Buffer.from(value.data, "base64").toString("base64") === value.data;
}

function validateSection(value: unknown): value is ManagedSectionRecord {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort().join("\0");
  if (keys !== "digest\0fileExisted\0id" && keys !== "createdContainers\0digest\0fileExisted\0id") {
    return false;
  }
  return typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 160 &&
    /^[A-Za-z0-9_.:-]+$/.test(value.id) &&
    typeof value.digest === "string" &&
    DIGEST_PATTERN.test(value.digest) &&
    typeof value.fileExisted === "boolean" &&
    (value.createdContainers === undefined || (
      Array.isArray(value.createdContainers) &&
      value.createdContainers.length <= 8 &&
      new Set(value.createdContainers).size === value.createdContainers.length &&
      value.createdContainers.every((container) =>
        typeof container === "string" && /^[A-Za-z0-9_.:-]+$/.test(container))
    ));
}

function freezeOriginals(value: Record<string, unknown>): Readonly<Record<string, OriginalRecord>> {
  const originals: Record<string, OriginalRecord> = {};
  for (const relativePath of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    const record = value[relativePath];
    if (!validateOriginal(record)) throw new InstallError("invalid_state");
    originals[relativePath] = Object.freeze(
      record.kind === "absent"
        ? { kind: "absent" }
        : { kind: "base64", data: record.data as string },
    );
  }
  return Object.freeze(originals);
}

function freezeDigests(value: Record<string, unknown>): Readonly<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const relativePath of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    const digest = value[relativePath];
    if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
      throw new InstallError("invalid_state");
    }
    digests[relativePath] = digest;
  }
  return Object.freeze(digests);
}

function freezeSections(
  value: Record<string, unknown> | undefined,
): Readonly<Record<string, ManagedSectionRecord>> | undefined {
  if (value === undefined) return undefined;
  const sections: Record<string, ManagedSectionRecord> = {};
  for (const relativePath of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    const record = value[relativePath];
    if (!validateSection(record)) throw new InstallError("invalid_state");
    const frozen: {
      id: string;
      digest: string;
      fileExisted: boolean;
      createdContainers?: readonly string[];
    } = {
      id: record.id,
      digest: record.digest,
      fileExisted: record.fileExisted,
    };
    if (record.createdContainers !== undefined) {
      frozen.createdContainers = Object.freeze([...record.createdContainers]);
    }
    sections[relativePath] = Object.freeze(frozen);
  }
  return Object.freeze(sections);
}

interface DecodedNodeState {
  readonly schemaVersion: typeof CORE_SCHEMA_VERSION;
  readonly packageVersion: string;
  readonly host: HostId;
  readonly environment: LegacyEnvironmentId;
  readonly managedFiles: readonly string[];
  readonly originals: Readonly<Record<string, OriginalRecord>>;
  readonly digests: Readonly<Record<string, string>>;
  readonly sections?: Readonly<Record<string, ManagedSectionRecord>>;
}

function decodeNodeState(value: unknown): DecodedNodeState {
  if (!isRecord(value)) throw new InstallError("invalid_state");
  const keys = Object.keys(value).sort().join("\0");
  if (
    keys !== "digests\0environment\0host\0managedFiles\0originals\0packageVersion\0schemaVersion" &&
    keys !== "digests\0environment\0host\0managedFiles\0originals\0packageVersion\0schemaVersion\0sections"
  ) {
    throw new InstallError("invalid_state");
  }
  if (
    value.schemaVersion !== CORE_SCHEMA_VERSION ||
    typeof value.packageVersion !== "string" ||
    value.packageVersion.length === 0 ||
    !isHost(value.host) ||
    !isLegacyEnvironment(value.environment) ||
    !Array.isArray(value.managedFiles) ||
    !value.managedFiles.every((item) =>
      typeof item === "string" && sanitizeSafeRelativePath(item) === item && item !== ".") ||
    new Set(value.managedFiles).size !== value.managedFiles.length ||
    !isRecord(value.originals) ||
    !isRecord(value.digests) ||
    (value.sections !== undefined && !isRecord(value.sections))
  ) {
    throw new InstallError("invalid_state");
  }
  const managedFiles = Object.freeze([...(value.managedFiles as string[])]);
  const managed = new Set(managedFiles);
  const originals = freezeOriginals(value.originals);
  const digests = freezeDigests(value.digests);
  const sections = freezeSections(isRecord(value.sections) ? value.sections : undefined);
  if (
    Object.keys(originals).some((item) => !managed.has(item)) ||
    Object.keys(digests).some((item) => !managed.has(item)) ||
    (sections !== undefined && Object.keys(sections).some((item) => !managed.has(item)))
  ) {
    throw new InstallError("invalid_state");
  }
  const decoded: {
    schemaVersion: typeof CORE_SCHEMA_VERSION;
    packageVersion: string;
    host: HostId;
    environment: LegacyEnvironmentId;
    managedFiles: readonly string[];
    originals: Readonly<Record<string, OriginalRecord>>;
    digests: Readonly<Record<string, string>>;
    sections?: Readonly<Record<string, ManagedSectionRecord>>;
  } = {
    schemaVersion: CORE_SCHEMA_VERSION,
    packageVersion: value.packageVersion,
    host: value.host,
    environment: value.environment,
    managedFiles,
    originals,
    digests,
  };
  if (sections !== undefined) decoded.sections = sections;
  return Object.freeze(decoded);
}

function assertLegacyOwnership(
  state: Pick<LegacyInstallState, "managedFiles" | "originals" | "digests" | "sections">,
  options: LegacyStateOptions,
): void {
  const allowed = new Set(options.allowedPaths);
  const required = new Set(options.requiredPaths);
  if (
    state.managedFiles.some((item) => !allowed.has(item)) ||
    [...required].some((item) => !state.managedFiles.includes(item)) ||
    Object.keys(state.originals).some((item) => !allowed.has(item)) ||
    Object.keys(state.digests).some((item) => !allowed.has(item)) ||
    Object.keys(state.sections ?? {}).some((item) => !allowed.has(item))
  ) {
    throw new InstallError("invalid_state");
  }
}

function decodeLegacyOriginal(value: unknown): OriginalRecord | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join("\0") !== "base64\0existed" ||
    typeof value.existed !== "boolean" ||
    typeof value.base64 !== "string"
  ) {
    return undefined;
  }
  if (!value.existed) return value.base64.length === 0 ? { kind: "absent" } : undefined;
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64) ||
    Buffer.from(value.base64, "base64").toString("base64") !== value.base64
  ) {
    return undefined;
  }
  return { kind: "base64", data: value.base64 };
}

/** Parse the retired Python installer schema against adapter-supplied ownership boundaries. */
export function parseLegacyInstallState(
  bytes: Buffer,
  options: LegacyStateOptions,
): LegacyInstallState {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new InstallError("invalid_state");
  }
  if (isRecord(value) && "schemaVersion" in value) {
    const decoded = decodeNodeState(value);
    const normalized: LegacyInstallState = {
      version: 1,
      source: "node",
      environment: decoded.environment,
      managedFiles: decoded.managedFiles,
      originals: decoded.originals,
      digests: decoded.digests,
      packageVersion: decoded.packageVersion,
      host: decoded.host,
      ...(decoded.sections === undefined ? {} : { sections: decoded.sections }),
    };
    assertLegacyOwnership(normalized, options);
    return Object.freeze(normalized);
  }
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join("\0") !==
      "active_environments\0digests\0originals\0version" ||
    value.version !== 1 ||
    !Array.isArray(value.active_environments) ||
    value.active_environments.length !== 1 ||
    !isLegacyEnvironment(value.active_environments[0]) ||
    !isRecord(value.originals) ||
    !isRecord(value.digests)
  ) {
    throw new InstallError("invalid_state");
  }
  const environment = value.active_environments[0];
  const allowed = new Set(options.allowedPaths);
  const required = new Set(options.requiredPaths);
  const originalPaths = Object.keys(value.originals);
  const digestPaths = Object.keys(value.digests);
  if (
    originalPaths.some((item) => !allowed.has(item)) ||
    digestPaths.some((item) => !allowed.has(item)) ||
    [...required].some((item) => !originalPaths.includes(item) || !digestPaths.includes(item)) ||
    digestPaths.some((item) => !originalPaths.includes(item))
  ) {
    throw new InstallError("invalid_state");
  }
  const originals: Record<string, OriginalRecord> = {};
  for (const [relativePath, legacyOriginal] of Object.entries(value.originals)) {
    const converted = decodeLegacyOriginal(legacyOriginal);
    if (converted === undefined) throw new InstallError("invalid_state");
    originals[relativePath] = converted;
  }
  const digests: Record<string, string> = {};
  for (const [relativePath, digest] of Object.entries(value.digests)) {
    if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
      throw new InstallError("invalid_state");
    }
    digests[relativePath] = digest;
  }
  return Object.freeze({
    version: 1 as const,
    source: "python" as const,
    environment,
    managedFiles: Object.freeze([...digestPaths].sort((left, right) => left.localeCompare(right))),
    originals: Object.freeze(originals),
    digests: Object.freeze(digests),
  });
}

/** Parse a current schema without exposing original payload bytes in errors. */
export function parseInstallState(bytes: Buffer): InstallState {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new InstallError("invalid_state");
  }
  const decoded = decodeNodeState(value);
  if (!isCurrentEnvironment(decoded.environment)) throw new InstallError("invalid_state");
  return decoded as InstallState;
}
