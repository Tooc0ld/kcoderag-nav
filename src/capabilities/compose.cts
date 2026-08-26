/** Deterministic capability ownership composition before the single transaction boundary. */

const crypto = require("node:crypto") as typeof import("node:crypto");

import {
  CORE_SCHEMA_VERSION,
  InstallError,
  type InstallState,
  type CapabilityManagedFileRecord,
  type CapabilityManagedSectionRecord,
  type DesiredState,
  type HostId,
  type OriginalRecord,
  type ProjectTarget,
} from "../core/contracts.cjs";
import {
  createInstallState,
  createDesiredState,
  isValidatedInstallState,
} from "../core/state.cjs";
import { validateManagedPath } from "../core/project-target.cjs";
import type { CapabilityId } from "./contracts.cjs";
import { resolveCapabilitySelection } from "./registry.cjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export interface ProjectedCapabilityFile {
  readonly relativePath: string;
  readonly expectedDigest: string | null;
  readonly content: Buffer;
  /** Required for a newly managed path; existing state remains the sole original authority. */
  readonly original?: OriginalRecord;
  /** Duplicate path contributions are valid only when every contributor declares the path shared. */
  readonly shared: boolean;
}

export interface ProjectedCapabilitySection {
  readonly relativePath: string;
  readonly id: string;
  readonly digest: string;
  readonly fileExisted: boolean;
  readonly createdContainers?: readonly string[];
  readonly shared: boolean;
}

/** Host-native, read/render-only projection for exactly one selected capability. */
export interface ProjectedCapabilityContribution {
  readonly capabilityId: CapabilityId;
  readonly files: readonly ProjectedCapabilityFile[];
  readonly sections: readonly ProjectedCapabilitySection[];
}

export interface CapabilityCompositionInput {
  readonly host: HostId;
  readonly target: ProjectTarget;
  readonly packageVersion: string;
  readonly managedRoots: readonly string[];
  readonly statePath: string;
  readonly stateExpectedDigest: string | null;
  readonly selectedCapabilities: readonly CapabilityId[];
  readonly contributions: readonly ProjectedCapabilityContribution[];
  readonly previousState?: InstallState;
}

interface MutableFileComposition {
  readonly path: string;
  readonly expectedDigest: string | null;
  readonly content: Buffer;
  readonly original: OriginalRecord;
  readonly contributors: Set<CapabilityId>;
  readonly shared: boolean;
}

interface MutableSectionComposition {
  readonly path: string;
  readonly id: string;
  readonly digest: string;
  readonly fileExisted: boolean;
  readonly createdContainers: readonly string[];
  readonly contributors: Set<CapabilityId>;
  readonly shared: boolean;
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalCapabilityIds(ids: readonly CapabilityId[]): readonly CapabilityId[] {
  return Object.freeze(resolveCapabilitySelection(ids).map((manifest) => manifest.id));
}

function canonicalContributors(
  selected: readonly CapabilityId[],
  contributors: ReadonlySet<CapabilityId>,
): readonly CapabilityId[] {
  return Object.freeze(selected.filter((id) => contributors.has(id)));
}

function sectionReference(relativePath: string, id: string): string {
  return `${relativePath}#${id}`;
}

function copyOriginal(record: OriginalRecord): OriginalRecord {
  return Object.freeze(record.kind === "absent"
    ? { kind: "absent" as const }
    : { kind: "base64" as const, data: record.data as string });
}

function sameOriginal(left: OriginalRecord, right: OriginalRecord): boolean {
  return left.kind === right.kind && left.data === right.data;
}

function originalBytes(record: OriginalRecord): Buffer | null {
  return record.kind === "absent" ? null : Buffer.from(record.data ?? "", "base64");
}

function validateOriginal(record: OriginalRecord | undefined): record is OriginalRecord {
  if (record === undefined || (record.kind !== "absent" && record.kind !== "base64")) return false;
  if (record.kind === "absent") return record.data === undefined;
  return typeof record.data === "string" &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.data) &&
    Buffer.from(record.data, "base64").toString("base64") === record.data;
}

function assertInitialOriginal(
  original: OriginalRecord | undefined,
  expectedDigest: string | null,
): asserts original is OriginalRecord {
  if (!validateOriginal(original)) throw new InstallError("invalid_capability_composition");
  const bytes = originalBytes(original);
  if (
    (bytes === null && expectedDigest !== null) ||
    (bytes !== null && expectedDigest !== sha256(bytes))
  ) {
    throw new InstallError("invalid_capability_composition");
  }
}

function assertCompositionInput(input: CapabilityCompositionInput): readonly CapabilityId[] {
  if (
    typeof input.packageVersion !== "string" ||
    input.packageVersion.length === 0 ||
    !Array.isArray(input.selectedCapabilities) ||
    !Array.isArray(input.contributions) ||
    !Array.isArray(input.managedRoots)
  ) {
    throw new InstallError("invalid_capability_composition");
  }
  if (input.previousState === undefined) {
    if (input.selectedCapabilities.length === 0 || input.stateExpectedDigest !== null) {
      throw new InstallError("invalid_capability_composition");
    }
  } else if (
    !isValidatedInstallState(input.previousState) ||
    input.previousState.host !== input.host ||
    typeof input.stateExpectedDigest !== "string" ||
    !DIGEST_PATTERN.test(input.stateExpectedDigest)
  ) {
    throw new InstallError("invalid_capability_composition");
  }
  if (input.selectedCapabilities.length === 0) {
    if (input.contributions.length !== 0) throw new InstallError("invalid_capability_composition");
    return Object.freeze([]);
  }
  const selected = canonicalCapabilityIds(input.selectedCapabilities);
  if (selected.length !== new Set(input.selectedCapabilities).size) {
    throw new InstallError("invalid_capability_composition");
  }
  const contributionIds = input.contributions.map((contribution) => contribution.capabilityId);
  if (
    contributionIds.length !== selected.length ||
    new Set(contributionIds).size !== contributionIds.length ||
    selected.some((id) => !contributionIds.includes(id))
  ) {
    throw new InstallError("invalid_capability_composition");
  }
  return selected;
}

function assertProjectedFile(file: ProjectedCapabilityFile): void {
  if (
    typeof file !== "object" ||
    file === null ||
    typeof file.relativePath !== "string" ||
    (file.expectedDigest !== null && !DIGEST_PATTERN.test(file.expectedDigest)) ||
    !Buffer.isBuffer(file.content) ||
    typeof file.shared !== "boolean"
  ) {
    throw new InstallError("invalid_capability_composition");
  }
}

function assertProjectedSection(section: ProjectedCapabilitySection): void {
  if (
    typeof section !== "object" ||
    section === null ||
    typeof section.relativePath !== "string" ||
    typeof section.id !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(section.id) ||
    typeof section.digest !== "string" ||
    !DIGEST_PATTERN.test(section.digest) ||
    typeof section.fileExisted !== "boolean" ||
    typeof section.shared !== "boolean" ||
    (section.createdContainers !== undefined && (
      !Array.isArray(section.createdContainers) ||
      new Set(section.createdContainers).size !== section.createdContainers.length ||
      !section.createdContainers.every((container) =>
        typeof container === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(container))
    ))
  ) {
    throw new InstallError("invalid_capability_composition");
  }
}

function composeFiles(
  input: CapabilityCompositionInput,
  selected: readonly CapabilityId[],
  contributions: readonly ProjectedCapabilityContribution[],
): Map<string, MutableFileComposition> {
  const previousFiles = new Map((input.previousState?.files ?? []).map((file) => [file.path, file]));
  const files = new Map<string, MutableFileComposition>();
  for (const contribution of contributions) {
    if (!Array.isArray(contribution.files)) throw new InstallError("invalid_capability_composition");
    const ownPaths = new Set<string>();
    for (const file of contribution.files) {
      assertProjectedFile(file);
      if (file.relativePath === input.statePath || ownPaths.has(file.relativePath)) {
        throw new InstallError("capability_collision", file.relativePath);
      }
      ownPaths.add(file.relativePath);
      const previous = previousFiles.get(file.relativePath);
      let original: OriginalRecord;
      if (previous === undefined) {
        assertInitialOriginal(file.original, file.expectedDigest);
        original = copyOriginal(file.original);
      } else {
        if (file.expectedDigest !== previous.digest ||
          (file.original !== undefined && (!validateOriginal(file.original) || !sameOriginal(file.original, previous.original)))) {
          throw new InstallError("invalid_capability_composition", file.relativePath);
        }
        original = copyOriginal(previous.original);
      }
      const existing = files.get(file.relativePath);
      if (existing === undefined) {
        files.set(file.relativePath, {
          path: file.relativePath,
          expectedDigest: file.expectedDigest,
          content: Buffer.from(file.content),
          original,
          contributors: new Set([contribution.capabilityId]),
          shared: file.shared,
        });
        continue;
      }
      if (
        !existing.shared ||
        !file.shared ||
        existing.expectedDigest !== file.expectedDigest ||
        !existing.content.equals(file.content) ||
        !sameOriginal(existing.original, original)
      ) {
        throw new InstallError("capability_collision", file.relativePath);
      }
      existing.contributors.add(contribution.capabilityId);
    }
  }
  for (const file of files.values()) {
    if (file.contributors.size === 0 || [...file.contributors].some((id) => !selected.includes(id))) {
      throw new InstallError("invalid_capability_composition", file.path);
    }
  }
  return files;
}

function composeSections(
  selected: readonly CapabilityId[],
  contributions: readonly ProjectedCapabilityContribution[],
  files: ReadonlyMap<string, MutableFileComposition>,
): Map<string, MutableSectionComposition> {
  const sections = new Map<string, MutableSectionComposition>();
  for (const contribution of contributions) {
    if (!Array.isArray(contribution.sections)) throw new InstallError("invalid_capability_composition");
    const ownFilePaths = new Set(contribution.files.map((file) => file.relativePath));
    const ownRefs = new Set<string>();
    for (const section of contribution.sections) {
      assertProjectedSection(section);
      const reference = sectionReference(section.relativePath, section.id);
      if (!files.has(section.relativePath) || !ownFilePaths.has(section.relativePath) || ownRefs.has(reference)) {
        throw new InstallError("capability_collision", section.relativePath);
      }
      ownRefs.add(reference);
      const createdContainers = Object.freeze([...(section.createdContainers ?? [])].sort(codeUnitCompare));
      const existing = sections.get(reference);
      if (existing === undefined) {
        sections.set(reference, {
          path: section.relativePath,
          id: section.id,
          digest: section.digest,
          fileExisted: section.fileExisted,
          createdContainers,
          contributors: new Set([contribution.capabilityId]),
          shared: section.shared,
        });
        continue;
      }
      if (
        !existing.shared ||
        !section.shared ||
        existing.digest !== section.digest ||
        existing.fileExisted !== section.fileExisted ||
        existing.createdContainers.join("\0") !== createdContainers.join("\0")
      ) {
        throw new InstallError("capability_collision", section.relativePath);
      }
      existing.contributors.add(contribution.capabilityId);
    }
  }
  for (const section of sections.values()) {
    if (section.contributors.size === 0 || [...section.contributors].some((id) => !selected.includes(id))) {
      throw new InstallError("invalid_capability_composition", section.path);
    }
  }
  return sections;
}

function createState(
  input: CapabilityCompositionInput,
  selected: readonly CapabilityId[],
  files: ReadonlyMap<string, MutableFileComposition>,
  sections: ReadonlyMap<string, MutableSectionComposition>,
): InstallState {
  const fileRecords: CapabilityManagedFileRecord[] = [...files.values()]
    .map((file) => Object.freeze({
      path: file.path,
      digest: sha256(file.content),
      original: copyOriginal(file.original),
      contributors: canonicalContributors(selected, file.contributors),
    }));
  const sectionRecords: CapabilityManagedSectionRecord[] = [...sections.values()]
    .map((section) => Object.freeze({
      path: section.path,
      id: section.id,
      digest: section.digest,
      fileExisted: section.fileExisted,
      ...(section.createdContainers.length === 0
        ? {}
        : { createdContainers: Object.freeze([...section.createdContainers]) }),
      contributors: canonicalContributors(selected, section.contributors),
    }));
  return createInstallState({
    schemaVersion: CORE_SCHEMA_VERSION,
    packageVersion: input.packageVersion,
    host: input.host,
    capabilities: selected.map((id) => Object.freeze({
      id,
      files: Object.freeze(fileRecords
        .filter((file) => file.contributors.includes(id))
        .map((file) => file.path)
        .sort(codeUnitCompare)),
      sections: Object.freeze(sectionRecords
        .filter((section) => section.contributors.includes(id))
        .map((section) => sectionReference(section.path, section.id))
        .sort(codeUnitCompare)),
    })),
    files: fileRecords,
    sections: sectionRecords,
  });
}

function encodeState(state: InstallState): Buffer {
  return Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * Resolve every ownership/collision invariant before returning one immutable
 * desired state. No filesystem mutation occurs in this function.
 */
export function composeCapabilitySet(input: CapabilityCompositionInput): DesiredState {
  const selected = assertCompositionInput(input);
  const contributionById = new Map(input.contributions.map((contribution) => [contribution.capabilityId, contribution]));
  const contributions = selected.map((id) => {
    const contribution = contributionById.get(id);
    if (contribution === undefined) throw new InstallError("invalid_capability_composition");
    return contribution;
  });
  const files = composeFiles(input, selected, contributions);
  const sections = composeSections(selected, contributions, files);
  validateManagedPath(input.target, input.statePath, input.managedRoots);
  for (const relativePath of files.keys()) {
    validateManagedPath(input.target, relativePath, input.managedRoots);
  }

  const entries: {
    relativePath: string;
    expectedDigest: string | null;
    content: Buffer | null;
  }[] = [...files.values()].map((file) => ({
    relativePath: file.path,
    expectedDigest: file.expectedDigest,
    content: Buffer.from(file.content),
  }));
  const currentPaths = new Set(files.keys());
  for (const previous of input.previousState?.files ?? []) {
    if (currentPaths.has(previous.path)) continue;
    entries.push({
      relativePath: previous.path,
      expectedDigest: previous.digest,
      content: originalBytes(previous.original),
    });
  }
  entries.sort((left, right) => codeUnitCompare(left.relativePath, right.relativePath));
  entries.push({
    relativePath: input.statePath,
    expectedDigest: input.stateExpectedDigest,
    content: selected.length === 0 ? null : encodeState(createState(input, selected, files, sections)),
  });
  return createDesiredState({
    host: input.host,
    target: input.target,
    managedRoots: input.managedRoots,
    statePath: input.statePath,
    entries,
  });
}

/** Compose first, then cross the injected transaction boundary exactly once. */
export function applyCapabilitySet<T>(
  input: CapabilityCompositionInput,
  apply: (desired: DesiredState) => T,
): T {
  const desired = composeCapabilitySet(input);
  return apply(desired);
}
