/** Deterministic capability ownership composition before the single transaction boundary. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");

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
  /** Installed contributors retained byte-for-byte during a capability-filtered update. */
  readonly preservedCapabilities?: readonly CapabilityId[];
  readonly contributions: readonly ProjectedCapabilityContribution[];
  /** Shared-file/section projections needed to keep preserved ownership structurally current. */
  readonly reconciledContributions?: readonly ProjectedCapabilityContribution[];
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
  if (ids.length === 0) return Object.freeze([]);
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

function assertCompositionInput(input: CapabilityCompositionInput): Readonly<{
  selected: readonly CapabilityId[];
  preserved: ReadonlySet<CapabilityId>;
}> {
  if (
    typeof input.packageVersion !== "string" ||
    input.packageVersion.length === 0 ||
    !Array.isArray(input.selectedCapabilities) ||
    (input.preservedCapabilities !== undefined && !Array.isArray(input.preservedCapabilities)) ||
    !Array.isArray(input.contributions) ||
    (input.reconciledContributions !== undefined && !Array.isArray(input.reconciledContributions)) ||
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
    if (input.contributions.length !== 0 || (input.reconciledContributions?.length ?? 0) !== 0 || (input.preservedCapabilities?.length ?? 0) !== 0) {
      throw new InstallError("invalid_capability_composition");
    }
    return Object.freeze({ selected: Object.freeze([]), preserved: new Set<CapabilityId>() });
  }
  const selected = canonicalCapabilityIds(input.selectedCapabilities);
  if (selected.length !== new Set(input.selectedCapabilities).size) {
    throw new InstallError("invalid_capability_composition");
  }
  const preservedIds = input.preservedCapabilities ?? [];
  const preserved = canonicalCapabilityIds(preservedIds);
  const previousIds = input.previousState?.capabilities.map((capability) => capability.id) ?? [];
  if (
    preserved.length !== new Set(preservedIds).size ||
    preserved.some((id) => !selected.includes(id) || !previousIds.includes(id))
  ) {
    throw new InstallError("invalid_capability_composition");
  }
  const preservedSet = new Set(preserved);
  const projected = selected.filter((id) => !preservedSet.has(id));
  const contributionIds = input.contributions.map((contribution) => contribution.capabilityId);
  if (
    contributionIds.length !== projected.length ||
    new Set(contributionIds).size !== contributionIds.length ||
    projected.some((id) => !contributionIds.includes(id))
  ) {
    throw new InstallError("invalid_capability_composition");
  }
  const reconciledIds = (input.reconciledContributions ?? []).map((contribution) => contribution.capabilityId);
  if (
    new Set(reconciledIds).size !== reconciledIds.length ||
    reconciledIds.some((id) => !preservedSet.has(id))
  ) {
    throw new InstallError("invalid_capability_composition");
  }
  return Object.freeze({ selected, preserved: preservedSet });
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

function readPreservedFile(input: CapabilityCompositionInput, record: CapabilityManagedFileRecord): Buffer {
  const validated = validateManagedPath(input.target, record.path, input.managedRoots);
  let descriptor: number | undefined;
  try {
    const metadata = fs.lstatSync(validated.absolutePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new InstallError("managed_content_changed", record.path);
    }
    const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    descriptor = fs.openSync(validated.absolutePath, fs.constants.O_RDONLY | noFollow);
    if (!fs.fstatSync(descriptor).isFile()) throw new InstallError("managed_content_changed", record.path);
    const bytes = fs.readFileSync(descriptor);
    if (sha256(bytes) !== record.digest) throw new InstallError("managed_content_changed", record.path);
    return bytes;
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError("managed_content_changed", record.path);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* transaction preflight remains authoritative */ }
    }
  }
}

function composeFiles(
  input: CapabilityCompositionInput,
  selected: readonly CapabilityId[],
  preserved: ReadonlySet<CapabilityId>,
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
  for (const previous of input.previousState?.files ?? []) {
    const retainedContributors = previous.contributors.filter((id) =>
      selected.includes(id) && preserved.has(id));
    if (retainedContributors.length === 0) continue;
    const existing = files.get(previous.path);
    if (existing !== undefined) {
      const previouslyProjected = previous.contributors.some((id) =>
        selected.includes(id) && !preserved.has(id));
      if (!previouslyProjected || !existing.shared || existing.expectedDigest !== previous.digest) {
        throw new InstallError("capability_collision", previous.path);
      }
      for (const contributor of retainedContributors) existing.contributors.add(contributor);
      continue;
    }
    files.set(previous.path, {
      path: previous.path,
      expectedDigest: previous.digest,
      content: readPreservedFile(input, previous),
      original: copyOriginal(previous.original),
      contributors: new Set(retainedContributors),
      shared: retainedContributors.length > 1,
    });
  }
  return files;
}

function composeSections(
  input: CapabilityCompositionInput,
  selected: readonly CapabilityId[],
  preserved: ReadonlySet<CapabilityId>,
  contributions: readonly ProjectedCapabilityContribution[],
  files: ReadonlyMap<string, MutableFileComposition>,
): Map<string, MutableSectionComposition> {
  const sections = new Map<string, MutableSectionComposition>();
  const previousSections = new Map((input.previousState?.sections ?? []).map((section) =>
    [sectionReference(section.path, section.id), section]));
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
      const previous = previousSections.get(reference);
      const createdContainers = Object.freeze([...(previous?.createdContainers ?? section.createdContainers ?? [])].sort(codeUnitCompare));
      const fileExisted = previous?.fileExisted ?? section.fileExisted;
      const existing = sections.get(reference);
      if (existing === undefined) {
        sections.set(reference, {
          path: section.relativePath,
          id: section.id,
          digest: section.digest,
          fileExisted,
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
        existing.fileExisted !== fileExisted ||
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
  for (const previous of input.previousState?.sections ?? []) {
    const retainedContributors = previous.contributors.filter((id) =>
      selected.includes(id) && preserved.has(id));
    if (retainedContributors.length === 0) continue;
    const reference = sectionReference(previous.path, previous.id);
    const existing = sections.get(reference);
    if (existing !== undefined) {
      const previouslyProjected = previous.contributors.some((id) =>
        selected.includes(id) && !preserved.has(id));
      if (!previouslyProjected || !existing.shared) {
        throw new InstallError("capability_collision", previous.path);
      }
      for (const contributor of retainedContributors) existing.contributors.add(contributor);
      continue;
    }
    if (!files.has(previous.path)) throw new InstallError("invalid_capability_composition", previous.path);
    sections.set(reference, {
      path: previous.path,
      id: previous.id,
      digest: previous.digest,
      fileExisted: previous.fileExisted,
      createdContainers: Object.freeze([...(previous.createdContainers ?? [])]),
      contributors: new Set(retainedContributors),
      shared: retainedContributors.length > 1,
    });
  }
  return sections;
}

function reconcilePreservedContributions(
  input: CapabilityCompositionInput,
  selected: readonly CapabilityId[],
  preserved: ReadonlySet<CapabilityId>,
  files: ReadonlyMap<string, MutableFileComposition>,
  sections: Map<string, MutableSectionComposition>,
): void {
  const previousFiles = new Map((input.previousState?.files ?? []).map((file) => [file.path, file]));
  const previousSections = new Map((input.previousState?.sections ?? []).map((section) =>
    [sectionReference(section.path, section.id), section]));
  const reconciledFiles = new Set<string>();
  const reconciledSections = new Set<string>();
  for (const contribution of input.reconciledContributions ?? []) {
    if (!preserved.has(contribution.capabilityId) || !Array.isArray(contribution.files) || !Array.isArray(contribution.sections)) {
      throw new InstallError("invalid_capability_composition");
    }
    const ownPaths = new Set<string>();
    for (const file of contribution.files) {
      assertProjectedFile(file);
      const previous = previousFiles.get(file.relativePath);
      const hadProjectedOwner = previous?.contributors.some((id) => selected.includes(id) && !preserved.has(id)) === true;
      if (previous === undefined || !previous.contributors.includes(contribution.capabilityId) || !hadProjectedOwner) {
        continue;
      }
      if (ownPaths.has(file.relativePath)) throw new InstallError("capability_collision", file.relativePath);
      ownPaths.add(file.relativePath);
      const current = files.get(file.relativePath);
      if (
        current === undefined ||
        file.expectedDigest !== previous.digest ||
        !file.shared ||
        !current.shared ||
        !current.content.equals(file.content)
      ) {
        throw new InstallError("capability_collision", file.relativePath);
      }
      reconciledFiles.add(`${contribution.capabilityId}\0${file.relativePath}`);
    }
    const ownRefs = new Set<string>();
    for (const section of contribution.sections) {
      assertProjectedSection(section);
      const reference = sectionReference(section.relativePath, section.id);
      const previous = previousSections.get(reference);
      if (!ownPaths.has(section.relativePath)) continue;
      if (
        ownRefs.has(reference) ||
        previous === undefined ||
        !previous.contributors.includes(contribution.capabilityId) ||
        !files.has(section.relativePath)
      ) {
        throw new InstallError("capability_collision", section.relativePath);
      }
      ownRefs.add(reference);
      reconciledSections.add(`${contribution.capabilityId}\0${reference}`);
      const existing = sections.get(reference);
      if (existing === undefined) {
        sections.set(reference, {
          path: section.relativePath,
          id: section.id,
          digest: section.digest,
          fileExisted: previous.fileExisted,
          createdContainers: Object.freeze([...(previous.createdContainers ?? [])]),
          contributors: new Set([contribution.capabilityId]),
          shared: section.shared,
        });
      } else if ([...existing.contributors].every((id) => preserved.has(id))) {
        sections.set(reference, {
          path: section.relativePath,
          id: section.id,
          digest: section.digest,
          fileExisted: previous.fileExisted,
          createdContainers: Object.freeze([...(previous.createdContainers ?? [])]),
          contributors: new Set([...existing.contributors, contribution.capabilityId]),
          shared: section.shared,
        });
      } else {
        if (!existing.shared || !section.shared || existing.digest !== section.digest) {
          throw new InstallError("capability_collision", section.relativePath);
        }
        existing.contributors.add(contribution.capabilityId);
      }
    }
  }
  for (const previous of input.previousState?.files ?? []) {
    const hasProjectedOwner = previous.contributors.some((id) => selected.includes(id) && !preserved.has(id));
    if (!hasProjectedOwner) continue;
    for (const contributor of previous.contributors) {
      if (preserved.has(contributor) && !reconciledFiles.has(`${contributor}\0${previous.path}`)) {
        throw new InstallError("invalid_capability_composition", previous.path);
      }
    }
  }
  for (const previous of input.previousState?.sections ?? []) {
    const previousFile = previousFiles.get(previous.path);
    const hasProjectedOwner = previousFile?.contributors.some((id) =>
      selected.includes(id) && !preserved.has(id)) === true;
    if (!hasProjectedOwner) continue;
    const reference = sectionReference(previous.path, previous.id);
    for (const contributor of previous.contributors) {
      if (preserved.has(contributor) && !reconciledSections.has(`${contributor}\0${reference}`)) {
        throw new InstallError("invalid_capability_composition", previous.path);
      }
    }
  }
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
  const { selected, preserved } = assertCompositionInput(input);
  const contributionById = new Map(input.contributions.map((contribution) => [contribution.capabilityId, contribution]));
  const contributions = selected.filter((id) => !preserved.has(id)).map((id) => {
    const contribution = contributionById.get(id);
    if (contribution === undefined) throw new InstallError("invalid_capability_composition");
    return contribution;
  });
  const files = composeFiles(input, selected, preserved, contributions);
  const sections = composeSections(input, selected, preserved, contributions, files);
  reconcilePreservedContributions(input, selected, preserved, files, sections);
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
