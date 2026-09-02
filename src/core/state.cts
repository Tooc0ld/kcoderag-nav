/** Schema, desired-state, runtime, and status helpers. This module never mutates disk. */

const crypto = require("node:crypto") as typeof import("node:crypto");

import {
  CORE_SCHEMA_VERSION,
  InstallError,
  type CapabilityManagedFileRecord,
  type CapabilityManagedSectionRecord,
  type CodeStyleDeliveryStatus,
  type CapabilityStateRecord,
  sanitizeSafeRelativePath,
  type CurrentEnvironmentId,
  type DesiredState,
  type HostId,
  type InstallState,
  type InstallStatus,
  type OriginalRecord,
  type ProjectTarget,
  type SourceFinding,
  type StatusIssue,
  type StatusResult,
} from "./contracts.cjs";
import type { CapabilityId } from "../capabilities/contracts.cjs";
import { isProjectTarget, validateManagedPath } from "./project-target.cjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const validatedDesiredStates = new WeakSet<object>();
const validatedInstallStates = new WeakSet<object>();
const CAPABILITY_ORDER = Object.freeze([
  "kcoderag-navigation",
  "code-style-nudge",
] as const satisfies readonly CapabilityId[]);

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
  readonly environment?: CurrentEnvironmentId;
  readonly issues?: readonly { readonly code: string; readonly path?: string }[];
  readonly findings?: readonly SourceFinding[];
  readonly codeStyle?: CodeStyleDeliveryStatus;
};

const ABSENT_CODE_STYLE = Object.freeze({ manualSkill: "absent", automaticNudge: "absent" } as const);

/** Derive independent manual/native claims strictly from validated schema-v1 ownership. */
export function deriveCodeStyleDelivery(
  state: InstallState | undefined,
  status: InstallStatus,
): CodeStyleDeliveryStatus {
  const capability = state?.capabilities.find((entry) => entry.id === "code-style-nudge");
  if (capability === undefined) {
    return status === "invalid" || status === "source_conflict"
      ? Object.freeze({ manualSkill: "unknown", automaticNudge: "unknown" })
      : ABSENT_CODE_STYLE;
  }
  if (status === "drifted") return Object.freeze({ manualSkill: "drifted", automaticNudge: "drifted" });
  if (status === "invalid" || status === "source_conflict") {
    return Object.freeze({ manualSkill: "unknown", automaticNudge: "unknown" });
  }
  const files = new Set(capability.files);
  const manualSkill = [...files].filter((candidate) => candidate.endsWith("/kcoderag-code-style/SKILL.md")).length === 1
    && [
      "cpp-lifetime-control-flow.md",
      "protocol-serialization-data.md",
      "lua-contracts.md",
      "change-hygiene-self-review.md",
    ].every((name) => [...files].filter((candidate) => candidate.endsWith(`/kcoderag-code-style/references/${name}`)).length === 1)
    ? "available"
    : "unknown";
  const automaticNudge = capability.sections.some((reference) => reference.endsWith("#code-style:pre-tool"))
    && [...files].some((candidate) => candidate.endsWith("/code-style-nudge.cjs"))
    && [...files].some((candidate) => candidate.endsWith("/pre-tool-dispatcher.cjs"))
    ? "available"
    : "unsupported";
  return Object.freeze({ manualSkill, automaticNudge });
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
    environment?: CurrentEnvironmentId;
    codeStyle: CodeStyleDeliveryStatus;
    issues: readonly StatusIssue[];
    findings: readonly SourceFinding[];
  } = {
    schemaVersion: CORE_SCHEMA_VERSION,
    status: input.status ?? "not_installed",
    codeStyle: input.codeStyle ?? ABSENT_CODE_STYLE,
    issues: Object.freeze(issues),
    findings: Object.freeze([...(input.findings ?? [])]),
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
  return value === "codex" || value === "claude" || value === "cursor" || value === "opencode" ||
    value === "zcode";
}

function validateOriginal(value: unknown): value is OriginalRecord {
  if (!isRecord(value) || (value.kind !== "absent" && value.kind !== "base64")) return false;
  if (value.kind === "absent") return value.data === undefined;
  if (typeof value.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) {
    return false;
  }
  return Buffer.from(value.data, "base64").toString("base64") === value.data;
}

type InstallStateInput = Omit<InstallState, "compositeDigest">;

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCapabilityId(value: unknown): value is CapabilityId {
  return value === "kcoderag-navigation" || value === "code-style-nudge";
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort(codeUnitCompare).join("\0") === [...keys].sort(codeUnitCompare).join("\0");
}

function isSafeStatePath(value: unknown): value is string {
  return typeof value === "string" && sanitizeSafeRelativePath(value) === value && value !== ".";
}

function sortedUniqueStrings(value: unknown, validate: (item: string) => boolean): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && validate(item)) &&
    value.every((item, index) => index === 0 || codeUnitCompare(value[index - 1] as string, item) < 0);
}

function sortedCapabilityIds(value: unknown, allowEmpty = false): value is CapabilityId[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || !value.every(isCapabilityId)) return false;
  const canonical = CAPABILITY_ORDER.filter((id) => value.includes(id));
  return canonical.length === value.length && canonical.every((id, index) => value[index] === id);
}

function sectionReference(pathValue: string, id: string): string {
  return `${pathValue}#${id}`;
}

function capabilityDigestPayload(input: InstallStateInput): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: input.schemaVersion,
    packageVersion: input.packageVersion,
    host: input.host,
    capabilities: input.capabilities,
    files: input.files,
    sections: input.sections,
  }), "utf8");
}

function calculateCapabilityCompositeDigest(input: InstallStateInput): string {
  return crypto.createHash("sha256").update(capabilityDigestPayload(input)).digest("hex");
}

function decodeInstallState(value: unknown): InstallState {
  if (!isRecord(value) || !exactKeys(value, [
    "capabilities",
    "compositeDigest",
    "files",
    "host",
    "packageVersion",
    "schemaVersion",
    "sections",
  ])) {
    throw new InstallError("invalid_state");
  }
  if (
    value.schemaVersion !== CORE_SCHEMA_VERSION ||
    typeof value.packageVersion !== "string" ||
    value.packageVersion.length === 0 ||
    value.packageVersion.length > 160 ||
    !isHost(value.host) ||
    !Array.isArray(value.capabilities) ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.sections) ||
    typeof value.compositeDigest !== "string" ||
    !DIGEST_PATTERN.test(value.compositeDigest)
  ) {
    throw new InstallError("invalid_state");
  }

  const capabilities: CapabilityStateRecord[] = value.capabilities.map((raw): CapabilityStateRecord => {
    if (!isRecord(raw) || !exactKeys(raw, ["files", "id", "sections"]) || !isCapabilityId(raw.id)) {
      throw new InstallError("invalid_state");
    }
    if (
      !sortedUniqueStrings(raw.files, isSafeStatePath) ||
      !sortedUniqueStrings(raw.sections, (item) => {
        const separator = item.lastIndexOf("#");
        return separator > 0 &&
          isSafeStatePath(item.slice(0, separator)) &&
          /^[A-Za-z0-9_.:-]{1,160}$/.test(item.slice(separator + 1));
      })
    ) {
      throw new InstallError("invalid_state");
    }
    return Object.freeze({
      id: raw.id,
      files: Object.freeze([...raw.files]),
      sections: Object.freeze([...raw.sections]),
    });
  });
  if (!sortedCapabilityIds(capabilities.map((capability) => capability.id))) {
    throw new InstallError("invalid_state");
  }

  const files: CapabilityManagedFileRecord[] = value.files.map((raw): CapabilityManagedFileRecord => {
    if (
      !isRecord(raw) ||
      !exactKeys(raw, ["contributors", "digest", "original", "path"]) ||
      !isSafeStatePath(raw.path) ||
      typeof raw.digest !== "string" ||
      !DIGEST_PATTERN.test(raw.digest) ||
      !validateOriginal(raw.original) ||
      !sortedCapabilityIds(raw.contributors)
    ) {
      throw new InstallError("invalid_state");
    }
    const original = raw.original.kind === "absent"
      ? Object.freeze({ kind: "absent" as const })
      : Object.freeze({ kind: "base64" as const, data: raw.original.data as string });
    return Object.freeze({
      path: raw.path,
      digest: raw.digest,
      original,
      contributors: Object.freeze([...raw.contributors]),
    });
  });
  if (!files.every((file, index) => index === 0 || codeUnitCompare(files[index - 1]?.path ?? "", file.path) < 0)) {
    throw new InstallError("invalid_state");
  }

  const sections: CapabilityManagedSectionRecord[] = value.sections.map((raw): CapabilityManagedSectionRecord => {
    if (!isRecord(raw)) throw new InstallError("invalid_state");
    const keys = raw.createdContainers === undefined
      ? ["contributors", "digest", "fileExisted", "id", "path"]
      : ["contributors", "createdContainers", "digest", "fileExisted", "id", "path"];
    if (
      !exactKeys(raw, keys) ||
      !isSafeStatePath(raw.path) ||
      typeof raw.id !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,160}$/.test(raw.id) ||
      typeof raw.digest !== "string" ||
      !DIGEST_PATTERN.test(raw.digest) ||
      typeof raw.fileExisted !== "boolean" ||
      !sortedCapabilityIds(raw.contributors) ||
      (raw.createdContainers !== undefined &&
        !sortedUniqueStrings(raw.createdContainers, (item) => /^[A-Za-z0-9_.:-]{1,160}$/.test(item)))
    ) {
      throw new InstallError("invalid_state");
    }
    return Object.freeze({
      path: raw.path,
      id: raw.id,
      digest: raw.digest,
      fileExisted: raw.fileExisted,
      ...(raw.createdContainers === undefined
        ? {}
        : { createdContainers: Object.freeze([...raw.createdContainers]) }),
      contributors: Object.freeze([...raw.contributors]),
    });
  });
  if (!sections.every((section, index) => {
    if (index === 0) return true;
    const previous = sections[index - 1];
    if (previous === undefined) return false;
    return codeUnitCompare(
      sectionReference(previous.path, previous.id),
      sectionReference(section.path, section.id),
    ) < 0;
  })) {
    throw new InstallError("invalid_state");
  }

  const capabilityIds = new Set(capabilities.map((capability) => capability.id));
  const filePaths = new Set(files.map((file) => file.path));
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const sectionRefs = new Set(sections.map((section) => sectionReference(section.path, section.id)));
  if (
    files.some((file) => file.contributors.some((id) => !capabilityIds.has(id))) ||
    sections.some((section) =>
      !filePaths.has(section.path) ||
      section.contributors.some((id) =>
        !capabilityIds.has(id) || !fileByPath.get(section.path)?.contributors.includes(id))) ||
    capabilities.some((capability) =>
      capability.files.some((file) => !filePaths.has(file)) ||
      capability.sections.some((section) => !sectionRefs.has(section)))
  ) {
    throw new InstallError("invalid_state");
  }
  for (const capability of capabilities) {
    const expectedFiles = files
      .filter((file) => file.contributors.includes(capability.id))
      .map((file) => file.path);
    const expectedSections = sections
      .filter((section) => section.contributors.includes(capability.id))
      .map((section) => sectionReference(section.path, section.id));
    if (
      capability.files.join("\0") !== expectedFiles.join("\0") ||
      capability.sections.join("\0") !== expectedSections.join("\0")
    ) {
      throw new InstallError("invalid_state");
    }
  }

  const withoutComposite: InstallStateInput = Object.freeze({
    schemaVersion: CORE_SCHEMA_VERSION,
    packageVersion: value.packageVersion,
    host: value.host,
    capabilities: Object.freeze(capabilities),
    files: Object.freeze(files),
    sections: Object.freeze(sections),
  });
  if (calculateCapabilityCompositeDigest(withoutComposite) !== value.compositeDigest) {
    throw new InstallError("invalid_state");
  }
  const decoded = Object.freeze({
    ...withoutComposite,
    compositeDigest: value.compositeDigest,
  });
  validatedInstallStates.add(decoded);
  return decoded;
}

/** Build and deep-freeze a canonical current capability state. */
export function createInstallState(input: InstallStateInput): InstallState {
  const capabilityRank = (id: CapabilityId): number => CAPABILITY_ORDER.indexOf(id);
  const capabilities = [...input.capabilities]
    .map((capability) => ({
      id: capability.id,
      files: [...capability.files].sort(codeUnitCompare),
      sections: [...capability.sections].sort(codeUnitCompare),
    }))
    .sort((left, right) => capabilityRank(left.id) - capabilityRank(right.id));
  const files = [...input.files]
    .map((file) => ({
      path: file.path,
      digest: file.digest,
      original: file.original,
      contributors: [...file.contributors].sort((left, right) => capabilityRank(left) - capabilityRank(right)),
    }))
    .sort((left, right) => codeUnitCompare(left.path, right.path));
  const sections = [...input.sections]
    .map((section) => ({
      path: section.path,
      id: section.id,
      digest: section.digest,
      fileExisted: section.fileExisted,
      ...(section.createdContainers === undefined ? {} : {
        createdContainers: [...section.createdContainers].sort(codeUnitCompare),
      }),
      contributors: [...section.contributors].sort((left, right) => capabilityRank(left) - capabilityRank(right)),
    }))
    .sort((left, right) => codeUnitCompare(
      sectionReference(left.path, left.id),
      sectionReference(right.path, right.id),
    ));
  const normalized: InstallStateInput = {
    schemaVersion: CORE_SCHEMA_VERSION,
    packageVersion: input.packageVersion,
    host: input.host,
    capabilities,
    files,
    sections,
  };
  return decodeInstallState({
    ...normalized,
    compositeDigest: calculateCapabilityCompositeDigest(normalized),
  });
}

/** Parse only the exact capability schema; legacy product/environment records are rejected. */
export function parseInstallState(bytes: Buffer): InstallState {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new InstallError("invalid_state");
  }
  return decodeInstallState(value);
}

export function isValidatedInstallState(value: unknown): value is InstallState {
  return typeof value === "object" && value !== null && validatedInstallStates.has(value);
}
