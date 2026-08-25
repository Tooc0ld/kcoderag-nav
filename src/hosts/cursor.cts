/** Cursor project adapter and separately authorized legacy user-local migration. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const { TextDecoder } = require("node:util") as typeof import("node:util");

import {
  CORE_SCHEMA_VERSION,
  InstallError,
  type CurrentEnvironmentId,
  type DesiredState,
  type InstallState,
  type LegacyEnvironmentId,
  type ManagedSectionRecord,
  type OriginalRecord,
  type ProjectTarget,
  type StatusIssue,
} from "../core/contracts.cjs";
import { validateManagedPath } from "../core/project-target.cjs";
import { removeJsonObjectProperty, upsertJsonObjectProperty } from "../core/json-splice.cjs";
import {
  createDesiredState,
  createStatusResult,
  parseInstallState,
  parseLegacyInstallState,
  type LegacyInstallState,
} from "../core/state.cjs";
import { applyTransaction, type TransactionResult } from "../core/transaction.cjs";
import type {
  HostAdapter,
  HostInstallContext,
  HostObservation,
  HostStatusContext,
  HostUninstallContext,
} from "./host-adapter.cjs";

type JsonMap = Record<string, unknown>;

interface LegacyCursorSnapshot {
  readonly localRoot: string;
  readonly pluginRoot: string;
  readonly statePath: string;
  readonly stateBytes: Buffer;
  readonly files: ReadonlyMap<string, Buffer>;
  readonly digests: Readonly<Record<string, string>>;
  readonly environment: CurrentEnvironmentId;
}

interface CursorObservationDetails {
  readonly stateBytes?: Buffer;
  readonly legacy?: LegacyCursorSnapshot;
  readonly legacyProjectState?: LegacyInstallState;
}

interface CursorAdapterOptions {
  readonly legacyLocalRoot?: string;
}

interface MigrationOptions {
  readonly failAtLegacyDelete?: number;
  readonly onBeforeLegacyMutation?: (operation: string, legacyPath: string) => void;
}

interface LegacyObjectIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
}

interface LegacyMutationIdentity {
  readonly localRoot: LegacyObjectIdentity;
  readonly pluginRoot: LegacyObjectIdentity;
  readonly state: LegacyObjectIdentity;
}

interface LegacyQuarantine {
  readonly pluginRoot: string;
  readonly statePath: string;
  readonly identity: LegacyMutationIdentity;
}

interface VerifiedMigrationBackup {
  readonly pluginFiles: ReadonlyMap<string, Buffer>;
  readonly stateBytes: Buffer;
}

interface CursorMigrationAdapter extends HostAdapter {
  migrateLegacy(desired: DesiredState, observation: HostObservation): TransactionResult;
}

const STATE_PATH = ".cursor/kcoderag-nav/install-state.json";
const MCP_PATH = ".cursor/mcp.json";
const RULE_PATH = ".cursor/rules/kcoderag-navigation.mdc";
const SKILL_PATH = ".cursor/skills/kcoderag-nav/SKILL.md";
const MANAGED_ROOTS = Object.freeze([".cursor"] as const);
const LEGACY_PLUGIN_NAME = "kcoderag-nav";
const LEGACY_STATE_NAME = ".kcoderag-nav.install-state.json";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeUtf8(bytes: Buffer, safePath: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InstallError("invalid_utf8", safePath);
  }
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function losslessMcp(
  current: Buffer,
  operation: (text: string) => string,
  code = "invalid_json",
): Buffer {
  try {
    return Buffer.from(operation(decodeUtf8(current, MCP_PATH)), "utf8");
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError(code, MCP_PATH);
  }
}

function sectionDigest(value: unknown): string {
  return sha256(Buffer.from(JSON.stringify(value), "utf8"));
}

function sectionRecord(
  value: unknown,
  fileExisted: boolean,
  createdContainers: readonly string[] = [],
): ManagedSectionRecord {
  return {
    id: "mcpServers.kcoderag",
    digest: sectionDigest(value),
    fileExisted,
    createdContainers: [...createdContainers],
  };
}

function verifyMcpSection(record: ManagedSectionRecord, value: unknown): void {
  if (record.id !== "mcpServers.kcoderag" || sectionDigest(value) !== record.digest) {
    throw new InstallError("managed_content_changed", MCP_PATH);
  }
}

function packageName(environment: CurrentEnvironmentId): string {
  return `kcoderag-${environment}`;
}

function managedPaths(): readonly string[] {
  return Object.freeze([MCP_PATH, RULE_PATH, SKILL_PATH, STATE_PATH].sort((left, right) => {
    if (left === STATE_PATH) return 1;
    if (right === STATE_PATH) return -1;
    return left.localeCompare(right);
  }));
}

function parseJsonBytes(bytes: Buffer, code: string, safePath: string): JsonMap {
  const text = decodeUtf8(bytes, safePath);
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) throw new Error("not_object");
    return value;
  } catch {
    throw new InstallError(code, safePath);
  }
}

function readOptional(filePath: string, safePath: string): Buffer | undefined {
  try {
    const metadata = fs.lstatSync(filePath);
    if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape", safePath);
    if (!metadata.isFile()) throw new InstallError("special_file", safePath);
    return fs.readFileSync(filePath);
  } catch (error) {
    if (error instanceof InstallError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new InstallError("unreadable", safePath);
  }
}

function readManagedOptional(target: ProjectTarget, relativePath: string): Buffer | undefined {
  const managed = validateManagedPath(target, relativePath, MANAGED_ROOTS);
  return readOptional(managed.absolutePath, relativePath);
}

function readPackageVersion(packageRoot: string): string {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(packageRoot, "package.json"));
  } catch {
    throw new InstallError("invalid_package", "package.json");
  }
  const value = parseJsonBytes(bytes, "invalid_package", "package.json");
  if (value.name !== "kcoderag-nav" || typeof value.version !== "string") {
    throw new InstallError("invalid_package", "package.json");
  }
  return value.version;
}

function environmentMcpEntry(packageRoot: string, environment: CurrentEnvironmentId): {
  readonly entry: JsonMap;
} {
  const name = packageName(environment);
  const relativePath = `${name}/.mcp.json`;
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(packageRoot, ...relativePath.split("/")));
  } catch {
    throw new InstallError("invalid_mcp_source", relativePath);
  }
  const source = parseJsonBytes(bytes, "invalid_mcp_source", relativePath);
  const entry = isRecord(source.mcpServers) ? source.mcpServers[name] : undefined;
  if (!isRecord(entry) || typeof entry.url !== "string") {
    throw new InstallError("invalid_mcp_source", relativePath);
  }
  const headers = isRecord(entry.headers)
    ? entry.headers
    : isRecord(entry.http_headers)
      ? entry.http_headers
      : undefined;
  if (headers === undefined || !Object.entries(headers).every(([key, value]) =>
    key.length > 0 && typeof value === "string")) {
    throw new InstallError("invalid_mcp_source", relativePath);
  }
  return { entry };
}

function renderMcp(
  current: Buffer | undefined,
  packageRoot: string,
  environment: CurrentEnvironmentId,
  owned: ManagedSectionRecord | undefined,
  allowLegacyOwned: boolean,
  fileExisted: boolean,
  ownershipBaseline?: Buffer,
): { readonly bytes: Buffer; readonly section: ManagedSectionRecord } {
  const document = current === undefined
    ? { mcpServers: {} as JsonMap }
    : parseJsonBytes(current, "invalid_json", MCP_PATH);
  const baselineDocument = ownershipBaseline === undefined
    ? undefined
    : parseJsonBytes(ownershipBaseline, "invalid_state", MCP_PATH);
  const mcpServersExisted = baselineDocument === undefined
    ? current !== undefined && document.mcpServers !== undefined
    : baselineDocument.mcpServers !== undefined;
  if (document.mcpServers === undefined) document.mcpServers = {};
  if (!isRecord(document.mcpServers)) throw new InstallError("invalid_json", MCP_PATH);
  if (owned !== undefined) verifyMcpSection(owned, document.mcpServers.kcoderag);
  if (owned === undefined && !allowLegacyOwned && document.mcpServers.kcoderag !== undefined) {
    throw new InstallError("unmanaged_name_conflict", MCP_PATH);
  }
  const entry = environmentMcpEntry(packageRoot, environment).entry;
  const preserveManaged = owned !== undefined &&
    sectionDigest(document.mcpServers.kcoderag) === sectionDigest(entry);
  document.mcpServers.kcoderag = entry;
  return {
    bytes: current === undefined
      ? canonicalJson(document)
      : losslessMcp(current, (original) =>
          preserveManaged ? original : upsertJsonObjectProperty(original, ["mcpServers"], "kcoderag", entry)),
    section: sectionRecord(
      entry,
      fileExisted,
      owned?.createdContainers ?? (mcpServersExisted ? [] : ["mcpServers"]),
    ),
  };
}

function removeInstalledMcp(
  current: Buffer | null,
  record: ManagedSectionRecord | undefined,
): Buffer | null {
  if (current === null || record === undefined) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  const document = parseJsonBytes(current, "invalid_json", MCP_PATH);
  if (!isRecord(document.mcpServers)) throw new InstallError("managed_content_changed", MCP_PATH);
  verifyMcpSection(record, document.mcpServers.kcoderag);
  delete document.mcpServers.kcoderag;
  let rendered = losslessMcp(current, (original) =>
    removeJsonObjectProperty(original, ["mcpServers"], "kcoderag"), "managed_content_changed");
  if (Object.keys(document.mcpServers).length === 0 &&
      record.createdContainers?.includes("mcpServers")) {
    delete document.mcpServers;
  }
  if (document.mcpServers === undefined) {
    rendered = losslessMcp(rendered, (original) =>
      removeJsonObjectProperty(original, [], "mcpServers"), "managed_content_changed");
  }
  return !record.fileExisted && Object.keys(document).length === 0
    ? null
    : rendered;
}

function sourceAsset(packageRoot: string, relativePath: string): Buffer {
  try {
    return fs.readFileSync(path.join(packageRoot, ...relativePath.split("/")));
  } catch {
    throw new InstallError("missing_package_asset", relativePath);
  }
}

function encodeOriginal(bytes: Buffer | undefined): OriginalRecord {
  return bytes === undefined ? { kind: "absent" } : { kind: "base64", data: bytes.toString("base64") };
}

function decodeOriginal(record: OriginalRecord | undefined, relativePath: string): Buffer | null {
  if (record === undefined) throw new InstallError("invalid_state", STATE_PATH);
  if (record.kind === "absent") return null;
  if (typeof record.data !== "string") throw new InstallError("invalid_state", relativePath);
  return Buffer.from(record.data, "base64");
}

function issueFrom(error: unknown): StatusIssue {
  return error instanceof InstallError
    ? { code: error.code, path: error.safePath ?? "." }
    : { code: "invalid", path: "." };
}

function details(observation: HostObservation): CursorObservationDetails {
  return (observation.details ?? {}) as CursorObservationDetails;
}

function validateCurrentState(state: InstallState): InstallState {
  if (state.host !== "cursor") throw new InstallError("invalid_state", STATE_PATH);
  const paths = managedPaths();
  const owned = paths.filter((relativePath) => relativePath !== STATE_PATH);
  const dedicated = owned.filter((relativePath) => relativePath !== MCP_PATH);
  const secureState = state.sections !== undefined;
  if (
    state.managedFiles.join("\0") !== paths.join("\0") ||
    Object.keys(state.originals).sort().join("\0") !==
      [...(secureState ? dedicated : owned)].sort().join("\0") ||
    Object.keys(state.digests).sort().join("\0") !==
      [...(secureState ? dedicated : owned)].sort().join("\0") ||
    (secureState && Object.keys(state.sections ?? {}).join("\0") !== MCP_PATH) ||
    (secureState && state.sections?.[MCP_PATH]?.id !== "mcpServers.kcoderag")
  ) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  return state;
}

function validateOwnedSection(
  target: ProjectTarget,
  state: Pick<LegacyInstallState, "sections"> | InstallState,
): void {
  const record = state.sections?.[MCP_PATH];
  const current = readManagedOptional(target, MCP_PATH);
  if (record === undefined || current === undefined) {
    throw new InstallError("managed_content_changed", MCP_PATH);
  }
  const document = parseJsonBytes(current, "invalid_json", MCP_PATH);
  if (!isRecord(document.mcpServers)) throw new InstallError("managed_content_changed", MCP_PATH);
  verifyMcpSection(record, document.mcpServers.kcoderag);
}

function legacyTreeDigest(digests: Readonly<Record<string, string>>): string {
  const identity = Object.entries(digests)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, digest]) => `${relativePath}\0${digest}\n`)
    .join("");
  return sha256(identity);
}

function validateLegacyRelativePath(relativePath: string): void {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new InstallError("invalid_legacy_state", LEGACY_STATE_NAME);
  }
}

function parseLegacyState(bytes: Buffer): {
  readonly digests: Readonly<Record<string, string>>;
  readonly treeDigest: string;
} {
  const value = parseJsonBytes(bytes, "invalid_legacy_state", LEGACY_STATE_NAME);
  if (
    Object.keys(value).sort().join("\0") !==
      "files\0package_version\0plugin_name\0schema_version\0tree_digest" ||
    value.schema_version !== 1 ||
    value.plugin_name !== LEGACY_PLUGIN_NAME ||
    typeof value.package_version !== "string" ||
    typeof value.tree_digest !== "string" ||
    !DIGEST_PATTERN.test(value.tree_digest) ||
    !isRecord(value.files) ||
    Object.keys(value.files).length === 0
  ) {
    throw new InstallError("invalid_legacy_state", LEGACY_STATE_NAME);
  }
  const digests: Record<string, string> = {};
  for (const [relativePath, digest] of Object.entries(value.files)) {
    validateLegacyRelativePath(relativePath);
    if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
      throw new InstallError("invalid_legacy_state", LEGACY_STATE_NAME);
    }
    digests[relativePath] = digest;
  }
  if (legacyTreeDigest(digests) !== value.tree_digest) {
    throw new InstallError("invalid_legacy_state", LEGACY_STATE_NAME);
  }
  return { digests: Object.freeze(digests), treeDigest: value.tree_digest };
}

function readLegacyTree(pluginRoot: string, directories?: Set<string>): ReadonlyMap<string, Buffer> {
  const files = new Map<string, Buffer>();
  const visit = (directory: string): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      throw new InstallError("unreadable_legacy_install", LEGACY_PLUGIN_NAME);
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relativePath = path.relative(pluginRoot, absolute).split(path.sep).join("/");
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) throw new InstallError("legacy_symlink_present", relativePath);
      if (metadata.isDirectory()) {
        directories?.add(relativePath);
        visit(absolute);
      }
      else if (metadata.isFile()) files.set(relativePath, fs.readFileSync(absolute));
      else throw new InstallError("legacy_special_path", relativePath);
    }
  };
  visit(pluginRoot);
  return files;
}

function expectedLegacyDirectories(relativePaths: Iterable<string>): ReadonlySet<string> {
  const directories = new Set<string>();
  for (const relativePath of relativePaths) {
    let parent = path.posix.dirname(relativePath);
    while (parent !== ".") {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  return directories;
}

function validateLegacyManifest(files: ReadonlyMap<string, Buffer>): void {
  const safePath = ".cursor-plugin/plugin.json";
  const manifestBytes = files.get(safePath);
  if (manifestBytes === undefined) throw new InstallError("invalid_legacy_state", safePath);
  const manifest = parseJsonBytes(manifestBytes, "invalid_legacy_state", safePath);
  if (
    manifest.name !== LEGACY_PLUGIN_NAME ||
    typeof manifest.version !== "string" ||
    manifest.version.length === 0
  ) {
    throw new InstallError("invalid_legacy_state", safePath);
  }
}

function encodedProjectEnvironment(bytes: Buffer): LegacyEnvironmentId | undefined {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (
      isRecord(value) &&
      value.schemaVersion === CORE_SCHEMA_VERSION &&
      (value.environment === "qa" || value.environment === "dev")
    ) return value.environment;
  } catch {
    // The exact state decoder owns the stable invalid_state response.
  }
  return undefined;
}

function validateLegacyProjectState(target: ProjectTarget, state: LegacyInstallState): void {
  if (state.source !== "node" || state.host !== "cursor") {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  const paths = managedPaths();
  const owned = paths.filter((relativePath) => relativePath !== STATE_PATH);
  const dedicated = owned.filter((relativePath) => relativePath !== MCP_PATH);
  const secureState = state.sections !== undefined;
  if (
    state.managedFiles.join("\0") !== paths.join("\0") ||
    Object.keys(state.originals).sort().join("\0") !==
      [...(secureState ? dedicated : owned)].sort().join("\0") ||
    Object.keys(state.digests).sort().join("\0") !==
      [...(secureState ? dedicated : owned)].sort().join("\0") ||
    (secureState && Object.keys(state.sections ?? {}).join("\0") !== MCP_PATH) ||
    (secureState && state.sections?.[MCP_PATH]?.id !== "mcpServers.kcoderag")
  ) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  if (secureState) validateOwnedSection(target, state);
}

export function inspectCursorLegacyInstall(
  rawLocalRoot: string,
  _packageRoot: string,
): LegacyCursorSnapshot | undefined {
  const localRoot = path.resolve(rawLocalRoot);
  const pluginRoot = path.join(localRoot, LEGACY_PLUGIN_NAME);
  const statePath = path.join(localRoot, LEGACY_STATE_NAME);
  for (const [candidate, safePath] of [[localRoot, "."], [pluginRoot, LEGACY_PLUGIN_NAME], [statePath, LEGACY_STATE_NAME]] as const) {
    try {
      const metadata = fs.lstatSync(candidate);
      if (metadata.isSymbolicLink()) throw new InstallError("legacy_symlink_present", safePath);
      if (candidate === localRoot && !metadata.isDirectory()) throw new InstallError("invalid_legacy_root", ".");
    } catch (error) {
      if (error instanceof InstallError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new InstallError("unreadable_legacy_install", safePath);
    }
  }
  const pluginExists = fs.existsSync(pluginRoot);
  const stateExists = fs.existsSync(statePath);
  if (!pluginExists && !stateExists) return undefined;
  if (!pluginExists || !stateExists) {
    throw new InstallError(pluginExists ? "legacy_state_missing" : "legacy_install_missing", pluginExists ? LEGACY_STATE_NAME : LEGACY_PLUGIN_NAME);
  }
  const pluginMetadata = fs.lstatSync(pluginRoot);
  const stateMetadata = fs.lstatSync(statePath);
  if (!pluginMetadata.isDirectory() || !stateMetadata.isFile()) {
    throw new InstallError("invalid_legacy_state", LEGACY_STATE_NAME);
  }
  const stateBytes = fs.readFileSync(statePath);
  const state = parseLegacyState(stateBytes);
  const directories = new Set<string>();
  const files = readLegacyTree(pluginRoot, directories);
  const actualPaths = [...files.keys()].sort((left, right) => left.localeCompare(right));
  const expectedPaths = Object.keys(state.digests).sort((left, right) => left.localeCompare(right));
  if (actualPaths.join("\0") !== expectedPaths.join("\0")) {
    throw new InstallError("unmanaged_legacy_path", LEGACY_PLUGIN_NAME);
  }
  const expectedDirectories = expectedLegacyDirectories(expectedPaths);
  if ([...directories].sort().join("\0") !== [...expectedDirectories].sort().join("\0")) {
    throw new InstallError("unmanaged_legacy_path", LEGACY_PLUGIN_NAME);
  }
  for (const [relativePath, expected] of Object.entries(state.digests)) {
    const bytes = files.get(relativePath);
    if (bytes === undefined || sha256(bytes) !== expected) {
      throw new InstallError("managed_content_changed", relativePath);
    }
  }
  validateLegacyManifest(files);
  return Object.freeze({
    localRoot,
    pluginRoot,
    statePath,
    stateBytes: Buffer.from(stateBytes),
    files,
    digests: state.digests,
    environment: "qa" as const,
  });
}

function detectCursor(
  context: { readonly target: ProjectTarget; readonly packageRoot: string },
  legacyLocalRoot: string,
): HostObservation {
  const stateBytes = readManagedOptional(context.target, STATE_PATH);
  const legacyProjectEnvironment = stateBytes === undefined
    ? undefined
    : encodedProjectEnvironment(stateBytes);
  try {
    const legacy = inspectCursorLegacyInstall(legacyLocalRoot, context.packageRoot);
    let currentState: InstallState | undefined;
    let legacyProjectState: LegacyInstallState | undefined;
    if (stateBytes !== undefined) {
      try {
        currentState = validateCurrentState(parseInstallState(stateBytes));
      } catch {
        // Exact legacy decoding below owns compatibility; invalid inputs remain invalid.
      }
      if (currentState !== undefined) {
        if (currentState.sections !== undefined) validateOwnedSection(context.target, currentState);
      } else {
        if (legacyProjectEnvironment === undefined) throw new InstallError("invalid_state", STATE_PATH);
        legacyProjectState = parseLegacyInstallState(stateBytes, {
          allowedPaths: managedPaths(),
          requiredPaths: [MCP_PATH, RULE_PATH, SKILL_PATH],
        });
        validateLegacyProjectState(context.target, legacyProjectState);
      }
      const state = currentState ?? legacyProjectState;
      if (state === undefined) throw new InstallError("invalid_state", STATE_PATH);
      for (const [relativePath, digest] of Object.entries(state.digests)) {
        const current = readManagedOptional(context.target, relativePath);
        if (current === undefined || sha256(current) !== digest) {
          throw new InstallError("managed_content_changed", relativePath);
        }
      }
    }
    if (legacy !== undefined && (currentState !== undefined || legacyProjectState !== undefined)) {
      throw new InstallError("legacy_install_conflict", STATE_PATH);
    }
    const result: {
      host: "cursor";
      target: ProjectTarget;
      currentState?: InstallState;
      legacyEnvironment?: LegacyEnvironmentId;
      legacyUserRemoval?: { path: string };
      details: CursorObservationDetails;
    } = {
      host: "cursor",
      target: context.target,
      details: Object.freeze({
        ...(stateBytes === undefined ? {} : { stateBytes: Buffer.from(stateBytes) }),
        ...(legacy === undefined ? {} : { legacy }),
        ...(legacyProjectState === undefined ? {} : { legacyProjectState }),
      }),
    };
    if (currentState !== undefined) result.currentState = currentState;
    if (legacyProjectState !== undefined) result.legacyEnvironment = legacyProjectState.environment;
    if (legacy !== undefined) result.legacyUserRemoval = { path: legacy.pluginRoot };
    return Object.freeze(result);
  } catch (error) {
    const observation: {
      host: "cursor";
      target: ProjectTarget;
      issues: readonly StatusIssue[];
      legacyEnvironment?: LegacyEnvironmentId;
      details: Readonly<CursorObservationDetails>;
    } = {
      host: "cursor" as const,
      target: context.target,
      issues: Object.freeze([issueFrom(error)]),
      details: Object.freeze(stateBytes === undefined ? {} : { stateBytes: Buffer.from(stateBytes) }),
    };
    if (legacyProjectEnvironment !== undefined) observation.legacyEnvironment = legacyProjectEnvironment;
    return Object.freeze(observation);
  }
}

function refuseIssues(observation: HostObservation): void {
  const issue = observation.issues?.[0];
  if (issue !== undefined) throw new InstallError(issue.code, issue.path);
}

function captureOriginals(target: ProjectTarget): Record<string, OriginalRecord> {
  const originals: Record<string, OriginalRecord> = {};
  for (const relativePath of managedPaths()) {
    if (relativePath === STATE_PATH) continue;
    if (relativePath === MCP_PATH) continue;
    const current = readManagedOptional(target, relativePath);
    if (current !== undefined) {
      throw new InstallError("unmanaged_name_conflict", relativePath);
    }
    originals[relativePath] = encodeOriginal(current);
  }
  return originals;
}

function expectedDigest(
  target: ProjectTarget,
  relativePath: string,
  state: InstallState | undefined,
  stateBytes: Buffer | undefined,
): string | null {
  if (relativePath === STATE_PATH) return stateBytes === undefined ? null : sha256(stateBytes);
  if (state !== undefined && relativePath === MCP_PATH) {
    const current = readManagedOptional(target, relativePath);
    return current === undefined ? null : sha256(current);
  }
  if (state !== undefined) return state.digests[relativePath] ?? null;
  const current = readManagedOptional(target, relativePath);
  return current === undefined ? null : sha256(current);
}

function renderInstall(context: HostInstallContext): DesiredState {
  refuseIssues(context.observation);
  const observationDetails = details(context.observation);
  const legacy = observationDetails.legacy;
  if (legacy !== undefined) {
    if (!context.allowLegacyUserRemoval) throw new InstallError("legacy_removal_authority_required");
  }
  const legacyProject = observationDetails.legacyProjectState;
  if (legacyProject?.environment === "dev" && !context.allowLegacyDevMigration) {
    throw new InstallError("legacy_dev_migration_authority_required", STATE_PATH);
  }
  if (legacyProject?.environment !== "dev" && context.allowLegacyDevMigration) {
    throw new InstallError("legacy_dev_migration_authority_invalid", STATE_PATH);
  }
  const existing = context.observation.currentState;
  if (context.command === "update" && existing === undefined && legacy === undefined && legacyProject === undefined) {
    throw new InstallError("not_installed", STATE_PATH);
  }
  if (existing !== undefined && existing.environment !== context.environment) {
    throw new InstallError("environment_conflict", STATE_PATH);
  }
  const priorState = legacyProject ?? existing;
  const originals = priorState === undefined
    ? captureOriginals(context.target)
    : Object.fromEntries(Object.entries(priorState.originals).filter(([relativePath]) =>
      relativePath !== MCP_PATH));
  const currentMcp = readManagedOptional(context.target, MCP_PATH);
  const legacyState = priorState !== undefined && priorState.sections === undefined;
  const mcpOriginalRecord = priorState?.originals[MCP_PATH];
  const mcpOwnershipBaseline = legacyState
    ? decodeOriginal(mcpOriginalRecord, MCP_PATH) ?? Buffer.from("{}", "utf8")
    : undefined;
  const renderedMcp = renderMcp(
    currentMcp,
    context.packageRoot,
    context.environment,
    priorState?.sections?.[MCP_PATH],
    legacyProject !== undefined || legacyState,
    priorState?.sections?.[MCP_PATH]?.fileExisted ??
      (legacyState ? mcpOriginalRecord?.kind !== "absent" : currentMcp !== undefined),
    mcpOwnershipBaseline,
  );
  const payloads = new Map<string, Buffer>([
    [MCP_PATH, renderedMcp.bytes],
    [RULE_PATH, sourceAsset(context.packageRoot, "kcoderag-cursor/rules/kcoderag-navigation.mdc")],
    [SKILL_PATH, sourceAsset(context.packageRoot, "kcoderag-cursor/skills/code-lookup-discipline/SKILL.md")],
  ]);
  const digests: Record<string, string> = {};
  for (const [relativePath, bytes] of payloads) {
    if (relativePath !== MCP_PATH) digests[relativePath] = sha256(bytes);
  }
  const state: InstallState = {
    schemaVersion: CORE_SCHEMA_VERSION,
    packageVersion: readPackageVersion(context.packageRoot),
    host: "cursor",
    environment: "qa",
    managedFiles: [...managedPaths()],
    originals,
    digests,
    sections: { [MCP_PATH]: renderedMcp.section },
  };
  payloads.set(STATE_PATH, canonicalJson(state));
  const stateBytes = observationDetails.stateBytes;
  return createDesiredState({
    host: "cursor",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: managedPaths().map((relativePath) => ({
      relativePath,
      expectedDigest: legacyProject === undefined
        ? expectedDigest(context.target, relativePath, existing, stateBytes)
        : relativePath === STATE_PATH
          ? stateBytes === undefined ? null : sha256(stateBytes)
          : (() => {
              const current = readManagedOptional(context.target, relativePath);
              return current === undefined ? null : sha256(current);
            })(),
      content: payloads.get(relativePath) ?? null,
    })),
  });
}

function renderUninstall(context: HostUninstallContext): DesiredState {
  refuseIssues(context.observation);
  const observationDetails = details(context.observation);
  if (observationDetails.legacy !== undefined) {
    throw new InstallError("legacy_migration_required", LEGACY_STATE_NAME);
  }
  const legacyProject = observationDetails.legacyProjectState;
  if (legacyProject !== undefined) {
    const stateBytes = observationDetails.stateBytes;
    if (stateBytes === undefined) throw new InstallError("invalid_state", STATE_PATH);
    const currentMcp = readManagedOptional(context.target, MCP_PATH);
    const mcpPayload = legacyProject.sections === undefined
      ? decodeOriginal(legacyProject.originals[MCP_PATH], MCP_PATH)
      : removeInstalledMcp(currentMcp ?? null, legacyProject.sections[MCP_PATH]);
    return createDesiredState({
      host: "cursor",
      target: context.target,
      managedRoots: MANAGED_ROOTS,
      statePath: STATE_PATH,
      entries: managedPaths().map((relativePath) => ({
        relativePath,
        expectedDigest: relativePath === STATE_PATH
          ? sha256(stateBytes)
          : (() => {
              const current = readManagedOptional(context.target, relativePath);
              return current === undefined ? null : sha256(current);
            })(),
        content: relativePath === STATE_PATH
          ? null
          : relativePath === MCP_PATH
            ? mcpPayload
            : decodeOriginal(legacyProject.originals[relativePath], relativePath),
      })),
    });
  }
  const state = context.observation.currentState;
  const stateBytes = observationDetails.stateBytes;
  if (state === undefined || stateBytes === undefined) throw new InstallError("not_installed", STATE_PATH);
  if (state.environment !== context.environment) throw new InstallError("environment_not_installed", STATE_PATH);
  let mcpPayload: Buffer | null | undefined;
  if (state.sections !== undefined) {
    const record = state.sections[MCP_PATH];
    const current = readManagedOptional(context.target, MCP_PATH);
    if (record === undefined || current === undefined) {
      throw new InstallError("managed_content_changed", MCP_PATH);
    }
    mcpPayload = removeInstalledMcp(current, record);
  }
  return createDesiredState({
    host: "cursor",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: managedPaths().map((relativePath) => ({
      relativePath,
      expectedDigest: expectedDigest(context.target, relativePath, state, stateBytes),
      content: relativePath === STATE_PATH
        ? null
        : relativePath === MCP_PATH && state.sections !== undefined
          ? mcpPayload ?? null
          : decodeOriginal(state.originals[relativePath], relativePath),
    })),
  });
}

function cursorStatus(context: HostStatusContext) {
  const issue = context.observation.issues?.[0];
  if (issue !== undefined) {
    return createStatusResult({
      status: issue.code === "managed_content_changed" ? "drifted" : "invalid",
      host: "cursor",
      issues: [issue],
    });
  }
  const legacyProject = details(context.observation).legacyProjectState;
  if (legacyProject !== undefined) {
    return createStatusResult({
      status: "update_available",
      host: "cursor",
      environment: legacyProject.environment,
      issues: [{ code: "legacy_migration_available", path: STATE_PATH }],
    });
  }
  const legacy = details(context.observation).legacy;
  if (legacy !== undefined) {
    return createStatusResult({
      status: "update_available",
      host: "cursor",
      environment: legacy.environment,
      issues: [{ code: "legacy_migration_available", path: LEGACY_STATE_NAME }],
    });
  }
  const state = context.observation.currentState;
  if (state === undefined) {
    const root = validateManagedPath(context.target, STATE_PATH, MANAGED_ROOTS);
    if (fs.existsSync(path.dirname(root.absolutePath))) {
      return createStatusResult({
        status: "invalid",
        host: "cursor",
        issues: [{ code: "orphaned_managed_root", path: ".cursor/kcoderag-nav" }],
      });
    }
    return createStatusResult({ host: "cursor" });
  }
  try {
    const rendered = renderInstall({
      target: context.target,
      packageRoot: context.packageRoot,
      command: "install",
      environment: state.environment,
      observation: context.observation,
      allowLegacyUserRemoval: false,
      allowLegacyDevMigration: false,
    });
    const updateAvailable = state.packageVersion !== readPackageVersion(context.packageRoot) ||
      rendered.entries.some((entry) => {
        if (entry.path.relativePath === STATE_PATH || entry.content === null) return false;
        const current = readManagedOptional(context.target, entry.path.relativePath);
        return current === undefined || !current.equals(entry.content);
      });
    return createStatusResult({
      status: updateAvailable ? "update_available" : "healthy",
      host: "cursor",
      environment: state.environment,
      issues: updateAvailable ? [{ code: "source_update_available", path: ".cursor/kcoderag-nav" }] : [],
    });
  } catch (error) {
    return createStatusResult({
      status: "invalid",
      host: "cursor",
      environment: state.environment,
      issues: [issueFrom(error)],
    });
  }
}

function verifyLegacySnapshot(snapshot: LegacyCursorSnapshot): void {
  const currentState = readOptional(snapshot.statePath, LEGACY_STATE_NAME);
  if (currentState === undefined || !currentState.equals(snapshot.stateBytes)) {
    throw new InstallError("managed_content_changed", LEGACY_STATE_NAME);
  }
  const directories = new Set<string>();
  const currentFiles = readLegacyTree(snapshot.pluginRoot, directories);
  if ([...currentFiles.keys()].sort().join("\0") !== [...snapshot.files.keys()].sort().join("\0")) {
    throw new InstallError("unmanaged_legacy_path", LEGACY_PLUGIN_NAME);
  }
  const expectedDirectories = expectedLegacyDirectories(snapshot.files.keys());
  if ([...directories].sort().join("\0") !== [...expectedDirectories].sort().join("\0")) {
    throw new InstallError("unmanaged_legacy_path", LEGACY_PLUGIN_NAME);
  }
  for (const [relativePath, bytes] of snapshot.files) {
    const current = currentFiles.get(relativePath);
    if (current === undefined || !current.equals(bytes)) {
      throw new InstallError("managed_content_changed", relativePath);
    }
  }
}

function legacyIdentity(filePath: string, kind: "directory" | "file", safePath: string): LegacyObjectIdentity {
  let metadata: import("node:fs").Stats;
  try {
    metadata = fs.lstatSync(filePath);
  } catch {
    throw new InstallError("filesystem_race", safePath);
  }
  if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape", safePath);
  if ((kind === "directory" && !metadata.isDirectory()) || (kind === "file" && !metadata.isFile())) {
    throw new InstallError("special_file", safePath);
  }
  return { dev: metadata.dev, ino: metadata.ino, mode: metadata.mode };
}

function sameLegacyIdentity(left: LegacyObjectIdentity, right: LegacyObjectIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function assertLegacyIdentity(
  filePath: string,
  kind: "directory" | "file",
  expected: LegacyObjectIdentity,
  safePath: string,
): void {
  if (!sameLegacyIdentity(expected, legacyIdentity(filePath, kind, safePath))) {
    throw new InstallError("filesystem_race", safePath);
  }
}

function captureLegacyMutationIdentity(snapshot: LegacyCursorSnapshot): LegacyMutationIdentity {
  verifyLegacySnapshot(snapshot);
  return {
    localRoot: legacyIdentity(snapshot.localRoot, "directory", LEGACY_PLUGIN_NAME),
    pluginRoot: legacyIdentity(snapshot.pluginRoot, "directory", LEGACY_PLUGIN_NAME),
    state: legacyIdentity(snapshot.statePath, "file", LEGACY_STATE_NAME),
  };
}

function restoreMovedObject(source: string, destination: string, kind: "directory" | "file", safePath: string): void {
  let sourceExists = false;
  let destinationExists = false;
  try { legacyIdentity(source, kind, safePath); sourceExists = true; } catch { /* Missing or replaced. */ }
  try { fs.lstatSync(destination); destinationExists = true; } catch { /* Destination is absent. */ }
  if (sourceExists && !destinationExists) fs.renameSync(source, destination);
}

function quarantineLegacy(
  snapshot: LegacyCursorSnapshot,
  identity: LegacyMutationIdentity,
  options: MigrationOptions,
): LegacyQuarantine {
  const nonce = crypto.randomUUID();
  const pluginQuarantine = path.join(snapshot.localRoot, `.kcoderag-plugin-quarantine-${nonce}`);
  const stateQuarantine = path.join(snapshot.localRoot, `.kcoderag-state-quarantine-${nonce}`);
  let pluginMoved = false;
  let stateMoved = false;
  try {
    assertLegacyIdentity(snapshot.localRoot, "directory", identity.localRoot, LEGACY_PLUGIN_NAME);
    assertLegacyIdentity(snapshot.pluginRoot, "directory", identity.pluginRoot, LEGACY_PLUGIN_NAME);
    options.onBeforeLegacyMutation?.("quarantine-plugin", snapshot.pluginRoot);
    fs.renameSync(snapshot.pluginRoot, pluginQuarantine);
    pluginMoved = true;
    assertLegacyIdentity(snapshot.localRoot, "directory", identity.localRoot, LEGACY_PLUGIN_NAME);
    assertLegacyIdentity(pluginQuarantine, "directory", identity.pluginRoot, LEGACY_PLUGIN_NAME);

    assertLegacyIdentity(snapshot.statePath, "file", identity.state, LEGACY_STATE_NAME);
    options.onBeforeLegacyMutation?.("quarantine-state", snapshot.statePath);
    fs.renameSync(snapshot.statePath, stateQuarantine);
    stateMoved = true;
    assertLegacyIdentity(snapshot.localRoot, "directory", identity.localRoot, LEGACY_PLUGIN_NAME);
    assertLegacyIdentity(stateQuarantine, "file", identity.state, LEGACY_STATE_NAME);
    return { pluginRoot: pluginQuarantine, statePath: stateQuarantine, identity };
  } catch (error) {
    try {
      if (stateMoved) restoreMovedObject(stateQuarantine, snapshot.statePath, "file", LEGACY_STATE_NAME);
      if (pluginMoved) restoreMovedObject(pluginQuarantine, snapshot.pluginRoot, "directory", LEGACY_PLUGIN_NAME);
    } catch {
      throw new InstallError("filesystem_race", LEGACY_PLUGIN_NAME);
    }
    throw error;
  }
}

function restoreLegacyQuarantine(
  snapshot: LegacyCursorSnapshot,
  quarantine: LegacyQuarantine,
  backup: VerifiedMigrationBackup,
): void {
  assertLegacyIdentity(snapshot.localRoot, "directory", quarantine.identity.localRoot, LEGACY_PLUGIN_NAME);
  restoreMovedObject(quarantine.statePath, snapshot.statePath, "file", LEGACY_STATE_NAME);
  restoreMovedObject(quarantine.pluginRoot, snapshot.pluginRoot, "directory", LEGACY_PLUGIN_NAME);
  restoreMissingLegacyObjects(snapshot, quarantine.identity.localRoot, backup);
  verifyLegacySnapshot(snapshot);
}

function removeLegacyQuarantine(
  snapshot: LegacyCursorSnapshot,
  quarantine: LegacyQuarantine,
  options: MigrationOptions,
): void {
  assertLegacyIdentity(snapshot.localRoot, "directory", quarantine.identity.localRoot, LEGACY_PLUGIN_NAME);
  assertLegacyIdentity(quarantine.pluginRoot, "directory", quarantine.identity.pluginRoot, LEGACY_PLUGIN_NAME);
  const directories = new Set<string>();
  const files = readLegacyTree(quarantine.pluginRoot, directories);
  if ([...files.keys()].sort().join("\0") !== [...snapshot.files.keys()].sort().join("\0")) {
    throw new InstallError("filesystem_race", LEGACY_PLUGIN_NAME);
  }
  for (const [relativePath, bytes] of snapshot.files) {
    if (!files.get(relativePath)?.equals(bytes)) throw new InstallError("filesystem_race", relativePath);
  }
  options.onBeforeLegacyMutation?.("remove-plugin-quarantine", quarantine.pluginRoot);
  assertLegacyIdentity(snapshot.localRoot, "directory", quarantine.identity.localRoot, LEGACY_PLUGIN_NAME);
  assertLegacyIdentity(quarantine.pluginRoot, "directory", quarantine.identity.pluginRoot, LEGACY_PLUGIN_NAME);
  fs.rmSync(quarantine.pluginRoot, { recursive: true });
  assertLegacyIdentity(snapshot.localRoot, "directory", quarantine.identity.localRoot, LEGACY_PLUGIN_NAME);
  options.onBeforeLegacyMutation?.("after-remove-plugin-quarantine", quarantine.pluginRoot);

  assertLegacyIdentity(quarantine.statePath, "file", quarantine.identity.state, LEGACY_STATE_NAME);
  if (!fs.readFileSync(quarantine.statePath).equals(snapshot.stateBytes)) {
    throw new InstallError("filesystem_race", LEGACY_STATE_NAME);
  }
  options.onBeforeLegacyMutation?.("remove-state-quarantine", quarantine.statePath);
  assertLegacyIdentity(snapshot.localRoot, "directory", quarantine.identity.localRoot, LEGACY_PLUGIN_NAME);
  assertLegacyIdentity(quarantine.statePath, "file", quarantine.identity.state, LEGACY_STATE_NAME);
  fs.unlinkSync(quarantine.statePath);
  assertLegacyIdentity(snapshot.localRoot, "directory", quarantine.identity.localRoot, LEGACY_PLUGIN_NAME);
  options.onBeforeLegacyMutation?.("after-remove-state-quarantine", quarantine.statePath);
}

function projectRollbackState(desired: DesiredState): DesiredState {
  const stateEntry = desired.entries.find((entry) => entry.path.relativePath === STATE_PATH);
  if (stateEntry?.content === null || stateEntry?.content === undefined) {
    throw new InstallError("invalid_desired_state", STATE_PATH);
  }
  const state = validateCurrentState(parseInstallState(stateEntry.content));
  return createDesiredState({
    host: "cursor",
    target: desired.target,
    managedRoots: desired.managedRoots,
    statePath: STATE_PATH,
    entries: desired.entries.map((entry) => ({
      relativePath: entry.path.relativePath,
      expectedDigest: entry.content === null ? null : sha256(entry.content),
      content: entry.path.relativePath === STATE_PATH
        ? null
        : entry.path.relativePath === MCP_PATH && state.sections !== undefined
          ? removeInstalledMcp(entry.content, state.sections[MCP_PATH])
          : decodeOriginal(state.originals[entry.path.relativePath], entry.path.relativePath),
    })),
  });
}

function pruneEmptyProjectDirectories(desired: DesiredState): void {
  const directories = new Set<string>();
  for (const entry of desired.entries) {
    let current = path.dirname(entry.path.absolutePath);
    while (current.startsWith(`${desired.target.root}${path.sep}`)) {
      directories.add(current);
      current = path.dirname(current);
    }
  }
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") {
        throw error;
      }
    }
  }
}

interface MigrationBackup {
  readonly root: string;
  readonly filesRoot: string;
  readonly relativePath: string;
  readonly entries: readonly { readonly relativePath: string; readonly bytes: Buffer; readonly digest: string }[];
  readonly pluginEntries: readonly {
    readonly relativePath: string;
    readonly backupPath: string;
    readonly digest: string;
  }[];
  readonly stateEntry: { readonly backupPath: string; readonly digest: string };
}

function createMigrationBackup(
  desired: DesiredState,
  snapshot: LegacyCursorSnapshot,
): MigrationBackup {
  const name = `.legacy-migration-${crypto.randomUUID()}`;
  const relativePath = `.cursor/kcoderag-nav/${name}`;
  const root = path.join(desired.target.root, ".cursor", "kcoderag-nav", name);
  const filesRoot = path.join(root, "files");
  const entries: { relativePath: string; bytes: Buffer; digest: string }[] = [];
  const pluginEntries: { relativePath: string; backupPath: string; digest: string }[] = [];
  const records: { readonly path: string; readonly digest: string; readonly backup: string }[] = [];
  for (const [index, [relativePathEntry, bytes]] of [...snapshot.files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .entries()) {
    const backup = `${index.toString().padStart(4, "0")}.bin`;
    const backupPath = `${relativePath}/files/${backup}`;
    const digest = sha256(bytes);
    entries.push({ relativePath: backupPath, bytes, digest });
    pluginEntries.push({ relativePath: relativePathEntry, backupPath, digest });
    records.push({ path: relativePathEntry, digest, backup });
  }
  const stateEntry = {
    backupPath: `${relativePath}/legacy-state.bin`,
    digest: sha256(snapshot.stateBytes),
  };
  entries.push({
    relativePath: stateEntry.backupPath,
    bytes: snapshot.stateBytes,
    digest: stateEntry.digest,
  });
  const journal = canonicalJson({
    schemaVersion: CORE_SCHEMA_VERSION,
    operation: "cursor-legacy-migration",
    environment: snapshot.environment,
    legacyPath: snapshot.pluginRoot,
    stateDigest: sha256(snapshot.stateBytes),
    files: records,
  });
  entries.push({ relativePath: `${relativePath}/journal.json`, bytes: journal, digest: sha256(journal) });
  return { root, filesRoot, relativePath, entries, pluginEntries, stateEntry };
}

function verifiedMigrationBackup(desired: DesiredState, backup: MigrationBackup): VerifiedMigrationBackup {
  for (const entry of backup.entries) {
    const current = readManagedOptional(desired.target, entry.relativePath);
    if (current === undefined || sha256(current) !== entry.digest) {
      throw new InstallError("managed_content_changed", backup.relativePath);
    }
  }
  const pluginFiles = new Map<string, Buffer>();
  for (const entry of backup.pluginEntries) {
    const current = readManagedOptional(desired.target, entry.backupPath);
    if (current === undefined || sha256(current) !== entry.digest) {
      throw new InstallError("managed_content_changed", backup.relativePath);
    }
    pluginFiles.set(entry.relativePath, current);
  }
  const stateBytes = readManagedOptional(desired.target, backup.stateEntry.backupPath);
  if (stateBytes === undefined || sha256(stateBytes) !== backup.stateEntry.digest) {
    throw new InstallError("managed_content_changed", backup.relativePath);
  }
  return { pluginFiles, stateBytes };
}

function pathAbsent(filePath: string, safePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw new InstallError("unreadable_legacy_install", safePath);
  }
}

function writeExclusiveLegacyFile(filePath: string, bytes: Buffer, safePath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* Retain the verified project backup. */ }
    }
    if (error instanceof InstallError) throw error;
    throw new InstallError("filesystem_race", safePath);
  }
}

function restoreMissingLegacyObjects(
  snapshot: LegacyCursorSnapshot,
  localRootIdentity: LegacyObjectIdentity,
  backup: VerifiedMigrationBackup,
): void {
  assertLegacyIdentity(snapshot.localRoot, "directory", localRootIdentity, LEGACY_PLUGIN_NAME);
  if (pathAbsent(snapshot.pluginRoot, LEGACY_PLUGIN_NAME)) {
    const temporaryRoot = path.join(snapshot.localRoot, `.kcoderag-plugin-restore-${crypto.randomUUID()}`);
    fs.mkdirSync(temporaryRoot, { mode: 0o700 });
    const temporaryIdentity = legacyIdentity(temporaryRoot, "directory", LEGACY_PLUGIN_NAME);
    for (const [relativePath, bytes] of [...backup.pluginFiles].sort(([left], [right]) => left.localeCompare(right))) {
      assertLegacyIdentity(snapshot.localRoot, "directory", localRootIdentity, LEGACY_PLUGIN_NAME);
      assertLegacyIdentity(temporaryRoot, "directory", temporaryIdentity, LEGACY_PLUGIN_NAME);
      const destination = path.join(temporaryRoot, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      writeExclusiveLegacyFile(destination, bytes, relativePath);
    }
    const restoredDirectories = new Set<string>();
    const restoredFiles = readLegacyTree(temporaryRoot, restoredDirectories);
    if ([...restoredFiles.keys()].sort().join("\0") !== [...backup.pluginFiles.keys()].sort().join("\0")) {
      throw new InstallError("filesystem_race", LEGACY_PLUGIN_NAME);
    }
    for (const [relativePath, bytes] of backup.pluginFiles) {
      if (!restoredFiles.get(relativePath)?.equals(bytes)) throw new InstallError("filesystem_race", relativePath);
    }
    assertLegacyIdentity(snapshot.localRoot, "directory", localRootIdentity, LEGACY_PLUGIN_NAME);
    assertLegacyIdentity(temporaryRoot, "directory", temporaryIdentity, LEGACY_PLUGIN_NAME);
    if (!pathAbsent(snapshot.pluginRoot, LEGACY_PLUGIN_NAME)) {
      throw new InstallError("filesystem_race", LEGACY_PLUGIN_NAME);
    }
    fs.renameSync(temporaryRoot, snapshot.pluginRoot);
  }

  assertLegacyIdentity(snapshot.localRoot, "directory", localRootIdentity, LEGACY_PLUGIN_NAME);
  if (pathAbsent(snapshot.statePath, LEGACY_STATE_NAME)) {
    const temporaryState = path.join(snapshot.localRoot, `.kcoderag-state-restore-${crypto.randomUUID()}`);
    writeExclusiveLegacyFile(temporaryState, backup.stateBytes, LEGACY_STATE_NAME);
    assertLegacyIdentity(snapshot.localRoot, "directory", localRootIdentity, LEGACY_PLUGIN_NAME);
    if (!pathAbsent(snapshot.statePath, LEGACY_STATE_NAME)) {
      throw new InstallError("filesystem_race", LEGACY_STATE_NAME);
    }
    fs.renameSync(temporaryState, snapshot.statePath);
  }
}

function withMigrationBackup(desired: DesiredState, backup: MigrationBackup): DesiredState {
  return createDesiredState({
    host: "cursor",
    target: desired.target,
    managedRoots: desired.managedRoots,
    statePath: desired.statePath.relativePath,
    entries: [
      ...desired.entries.map((entry) => ({
        relativePath: entry.path.relativePath,
        expectedDigest: entry.expectedDigest,
        content: entry.content,
      })),
      ...backup.entries.map((entry) => ({
        relativePath: entry.relativePath,
        expectedDigest: null,
        content: entry.bytes,
      })),
    ],
  });
}

function removeMigrationBackup(desired: DesiredState, backup: MigrationBackup): void {
  const cleanup = createDesiredState({
    host: "cursor",
    target: desired.target,
    managedRoots: desired.managedRoots,
    statePath: backup.entries.at(-1)?.relativePath ?? backup.relativePath,
    entries: backup.entries.map((entry) => ({
      relativePath: entry.relativePath,
      expectedDigest: entry.digest,
      content: null,
    })),
  });
  applyTransaction(cleanup);
  fs.rmdirSync(backup.filesRoot);
  fs.rmdirSync(backup.root);
}

export function migrateCursorLegacyInstall(
  desired: DesiredState,
  observation: HostObservation,
  options: MigrationOptions = {},
): TransactionResult {
  const snapshot = details(observation).legacy;
  if (desired.host !== "cursor" || snapshot === undefined || observation.legacyUserRemoval === undefined) {
    throw new InstallError("invalid_legacy_migration");
  }
  const legacyIdentitySnapshot = captureLegacyMutationIdentity(snapshot);
  const backup = createMigrationBackup(desired, snapshot);
  let projectResult: TransactionResult;
  try {
    const combinedResult = applyTransaction(withMigrationBackup(desired, backup));
    projectResult = Object.freeze({
      schemaVersion: combinedResult.schemaVersion,
      host: combinedResult.host,
      changedPaths: Object.freeze(desired.entries.map((entry) => entry.path.relativePath)),
    });
  } catch (error) {
    try {
      pruneEmptyProjectDirectories(desired);
    } catch {
      throw new InstallError("rollback_failed", backup.relativePath);
    }
    throw error;
  }
  let quarantine: LegacyQuarantine | undefined;
  try {
    quarantine = quarantineLegacy(snapshot, legacyIdentitySnapshot, options);
    if (options.failAtLegacyDelete !== undefined) throw new Error("injected_legacy_delete_failure");
    removeLegacyQuarantine(snapshot, quarantine, options);
    quarantine = undefined;
    removeMigrationBackup(desired, backup);
    return projectResult;
  } catch {
    let rollbackFailed = false;
    let legacyRestored = false;
    let projectRestored = false;
    try {
      const verifiedBackup = verifiedMigrationBackup(desired, backup);
      if (quarantine !== undefined) restoreLegacyQuarantine(snapshot, quarantine, verifiedBackup);
      else {
        restoreMissingLegacyObjects(snapshot, legacyIdentitySnapshot.localRoot, verifiedBackup);
        verifyLegacySnapshot(snapshot);
      }
      legacyRestored = true;
    } catch {
      rollbackFailed = true;
    }
    try {
      applyTransaction(projectRollbackState(desired));
      projectRestored = true;
    } catch {
      rollbackFailed = true;
    }
    if (projectRestored) {
      try {
        pruneEmptyProjectDirectories(desired);
      } catch {
        rollbackFailed = true;
      }
    }
    if (!rollbackFailed && legacyRestored && projectRestored) {
      try {
        removeMigrationBackup(desired, backup);
        pruneEmptyProjectDirectories(desired);
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) throw new InstallError("rollback_failed", backup.relativePath);
    throw new InstallError("transaction_failed");
  }
}

export function createCursorAdapter(options: CursorAdapterOptions = {}): CursorMigrationAdapter {
  const legacyLocalRoot = path.resolve(
    options.legacyLocalRoot ?? path.join(os.homedir(), ".cursor", "plugins", "local"),
  );
  const adapter: CursorMigrationAdapter = {
    id: "cursor" as const,
    managedRoots: MANAGED_ROOTS,
    detect: (context) => detectCursor(context, legacyLocalRoot),
    renderInstall,
    renderUninstall,
    status: cursorStatus,
    migrateLegacy: (desired, observation) => migrateCursorLegacyInstall(desired, observation),
  };
  return Object.freeze(adapter);
}

export const cursorAdapter = createCursorAdapter();

exports.STATE_PATH = STATE_PATH;
exports.managedPaths = managedPaths;
