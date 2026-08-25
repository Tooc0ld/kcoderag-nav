/** Claude Code project-native adapter with narrow JSON section and file ownership. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const childProcess = require("node:child_process") as typeof import("node:child_process");
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
import { renderProjectHookCommands } from "../core/project-root.cjs";
import {
  removeJsonArrayElement,
  removeJsonObjectProperty,
  upsertJsonArrayElement,
  upsertJsonObjectProperty,
} from "../core/json-splice.cjs";
import {
  createDesiredState,
  createStatusResult,
  parseInstallState,
  parseLegacyInstallState,
  type LegacyInstallState,
} from "../core/state.cjs";
import type {
  HostAdapter,
  HostInstallContext,
  HostObservation,
  HostSourceScanContext,
  HostStatusContext,
  HostUninstallContext,
} from "./host-adapter.cjs";
import {
  createNativeCleanupPlan,
  createNativeHostCapability,
  createSourceFinding,
  createSourceScanResult,
  runOwnedSourceCleanup,
  type NativeCleanupPlan,
  type NativeRunRequest,
  type OwnedCleanupAuthority,
  type SourceScanMode,
  type SourceScanResult,
} from "./user-sources.cjs";

type JsonMap = Record<string, unknown>;

interface ClaudeObservationDetails {
  readonly stateBytes?: Buffer;
  readonly legacyState?: LegacyInstallState;
}

export interface ClaudeNativeResult {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly stdout?: string;
}

export type ClaudeNativeRunner = (request: NativeRunRequest) => Promise<ClaudeNativeResult>;

export interface ClaudeUserSourceMetadata {
  readonly rawMcpPaths: readonly string[];
  readonly manualHookPaths: readonly string[];
  readonly cachePaths: readonly string[];
  readonly ambiguousPaths: readonly string[];
}

export type ClaudeUserSourceReader = () => ClaudeUserSourceMetadata | Promise<ClaudeUserSourceMetadata>;

export interface ClaudeAdapterOptions {
  readonly runner?: ClaudeNativeRunner;
  readonly readUserSources?: ClaudeUserSourceReader;
  readonly homeDirectory?: string;
}

const STATE_PATH = ".claude/kcoderag-nav/install-state.json";
const SETTINGS_PATH = ".claude/settings.json";
const MCP_PATH = ".mcp.json";
const SKILL_PATH = ".claude/skills/kcoderag-nav/SKILL.md";
const MANAGED_ROOTS = Object.freeze([".claude", MCP_PATH] as const);
const HOOK_ASSETS = Object.freeze([
  "grep-nudge.cjs",
  "run_hook.cmd",
  "run_hook.sh",
  "update-check.cjs",
  "update-worker.cjs",
]);
const SHARED_PATHS = Object.freeze([MCP_PATH, SETTINGS_PATH] as const);
const CLAUDE_TIMEOUT_MS = 5_000;
const CLAUDE_MINIMUM_VERSION = "2.1.241";
const CLAUDE_INVENTORY_SCHEMA = "claude-plugin-v2.1.241-array-v1";
const USER_MCP_SAFE_PATH = ".claude.json";
const USER_SETTINGS_SAFE_PATH = ".claude/settings.json";
const USER_PLUGIN_SAFE_PATH = ".claude/plugins";
const USER_CACHE_SAFE_PATH = ".claude/plugins/cache/kcoderag-nav";
const USER_MARKETPLACE_CACHE_SAFE_PATH = ".claude/plugins/marketplaces/kcoderag-nav";
const OWNED_MARKETPLACE = "kcoderag-nav";
const OWNED_PLUGIN_NAMES = new Set(["kcoderag-nav", "kcoderag-qa", "kcoderag-dev"]);
const CLAUDE_SCOPES = new Set(["user", "project", "local"]);

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

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function packageName(environment: CurrentEnvironmentId): string {
  return `kcoderag-${environment}`;
}

function hookPrefix(environment: LegacyEnvironmentId): string {
  return `.claude/kcoderag-nav/${environment}/hooks`;
}

function managedPaths(environment: CurrentEnvironmentId = "qa"): readonly string[] {
  return Object.freeze([
    MCP_PATH,
    SETTINGS_PATH,
    SKILL_PATH,
    ...HOOK_ASSETS.map((asset) => `${hookPrefix(environment)}/${asset}`),
    STATE_PATH,
  ].sort((left, right) => {
    if (left === STATE_PATH) return 1;
    if (right === STATE_PATH) return -1;
    return left.localeCompare(right);
  }));
}

function legacyManagedPaths(environment: LegacyEnvironmentId): readonly string[] {
  return Object.freeze([
    MCP_PATH,
    SETTINGS_PATH,
    SKILL_PATH,
    ...HOOK_ASSETS.map((asset) => `${hookPrefix(environment)}/${asset}`),
    STATE_PATH,
  ].sort((left, right) => {
    if (left === STATE_PATH) return 1;
    if (right === STATE_PATH) return -1;
    return left.localeCompare(right);
  }));
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

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function losslessJson(
  current: Buffer,
  safePath: string,
  operation: (text: string) => string,
  code = "invalid_json",
): Buffer {
  try {
    return Buffer.from(operation(decodeUtf8(current, safePath)), "utf8");
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError(code, safePath);
  }
}

function sectionDigest(value: unknown): string {
  return sha256(Buffer.from(JSON.stringify(value), "utf8"));
}

function sectionRecord(
  id: string,
  value: unknown,
  fileExisted: boolean,
  createdContainers: readonly string[] = [],
): ManagedSectionRecord {
  return { id, digest: sectionDigest(value), fileExisted, createdContainers: [...createdContainers] };
}

function verifySection(
  record: ManagedSectionRecord,
  expectedId: string,
  value: unknown,
  safePath: string,
): void {
  if (record.id !== expectedId || sectionDigest(value) !== record.digest) {
    throw new InstallError("managed_content_changed", safePath);
  }
}

function readPackageVersion(packageRoot: string): string {
  const safePath = "package.json";
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(packageRoot, safePath));
  } catch {
    throw new InstallError("invalid_package", safePath);
  }
  const document = parseJsonBytes(bytes, "invalid_package", safePath);
  if (document.name !== "kcoderag-nav" || typeof document.version !== "string") {
    throw new InstallError("invalid_package", safePath);
  }
  return document.version;
}

function readMcpServer(packageRoot: string, environment: CurrentEnvironmentId): {
  readonly name: string;
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
  if (!isRecord(source.mcpServers)) throw new InstallError("invalid_mcp_source", relativePath);
  const keys = Object.keys(source.mcpServers);
  const entry = source.mcpServers[name];
  if (keys.length !== 1 || keys[0] !== name || !isRecord(entry)) {
    throw new InstallError("invalid_mcp_source", relativePath);
  }
  return { name, entry };
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
  const currentName = owned?.id.split(".").at(-1);
  const currentEntry = currentName === undefined ? undefined : document.mcpServers[currentName];
  if (owned !== undefined) verifySection(owned, `mcpServers.${currentName}`, currentEntry, MCP_PATH);
  if (
    owned === undefined &&
    !allowLegacyOwned &&
    (document.mcpServers["kcoderag-qa"] !== undefined || document.mcpServers["kcoderag-dev"] !== undefined)
  ) {
    throw new InstallError("unmanaged_name_conflict", MCP_PATH);
  }
  if (allowLegacyOwned) {
    delete document.mcpServers["kcoderag-qa"];
    delete document.mcpServers["kcoderag-dev"];
  }
  const source = readMcpServer(packageRoot, environment);
  const preserveManaged = owned !== undefined && currentName === source.name &&
    sectionDigest(currentEntry) === sectionDigest(source.entry);
  document.mcpServers[source.name] = source.entry;
  let bytes: Buffer;
  if (current === undefined) {
    bytes = canonicalJson(document);
  } else {
    bytes = losslessJson(current, MCP_PATH, (original) => {
      if (preserveManaged && !allowLegacyOwned) return original;
      let rendered = original;
      if (allowLegacyOwned) {
        const originalDocument = parseJsonBytes(current, "invalid_json", MCP_PATH);
        if (isRecord(originalDocument.mcpServers)) {
          for (const name of ["kcoderag-qa", "kcoderag-dev"] as const) {
            if (originalDocument.mcpServers[name] !== undefined) {
              rendered = removeJsonObjectProperty(rendered, ["mcpServers"], name);
            }
          }
        }
      }
      return upsertJsonObjectProperty(rendered, ["mcpServers"], source.name, source.entry);
    });
  }
  return {
    bytes,
    section: sectionRecord(
      `mcpServers.${source.name}`,
      source.entry,
      fileExisted,
      owned?.createdContainers ?? (mcpServersExisted ? [] : ["mcpServers"]),
    ),
  };
}

function managedHook(environment: CurrentEnvironmentId): JsonMap {
  const commands = renderProjectHookCommands("claude");
  return {
    matcher: "^(Grep|Glob|Bash)$",
    hooks: [{
      type: "command",
      command: commands.command,
      commandWindows: commands.commandWindows,
      timeout: 5,
      statusMessage: `Checking code lookup strategy (KCodeRag ${environment.toUpperCase()})`,
      additionalContextLimit: 600,
    }],
  };
}

function hookEnvironment(entry: unknown): LegacyEnvironmentId | undefined {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) return undefined;
  const encoded = JSON.stringify(entry);
  for (const environment of ["qa", "dev"] as const) {
    if (encoded.includes(`${hookPrefix(environment)}/run_hook.sh`) ||
        encoded.includes(`${hookPrefix(environment).replaceAll("/", "\\\\")}\\\\run_hook.cmd`)) {
      return environment;
    }
  }
  return undefined;
}

function renderSettings(
  current: Buffer | undefined,
  environment: CurrentEnvironmentId,
  owned: ManagedSectionRecord | undefined,
  allowLegacyOwned: boolean,
  fileExisted: boolean,
  ownershipBaseline?: Buffer,
): { readonly bytes: Buffer; readonly section: ManagedSectionRecord } {
  const document = current === undefined
    ? {}
    : parseJsonBytes(current, "invalid_json", SETTINGS_PATH);
  const baselineDocument = ownershipBaseline === undefined
    ? undefined
    : parseJsonBytes(ownershipBaseline, "invalid_state", SETTINGS_PATH);
  const hooksExisted = baselineDocument === undefined
    ? document.hooks !== undefined
    : baselineDocument.hooks !== undefined;
  if (document.hooks === undefined) document.hooks = {};
  if (!isRecord(document.hooks)) throw new InstallError("invalid_json", SETTINGS_PATH);
  const hooks = document.hooks;
  const baselineHooks = baselineDocument !== undefined && isRecord(baselineDocument.hooks)
    ? baselineDocument.hooks
    : undefined;
  const preToolUseExisted = baselineDocument === undefined
    ? hooks.PreToolUse !== undefined
    : baselineHooks?.PreToolUse !== undefined;
  if (hooks.PreToolUse === undefined) hooks.PreToolUse = [];
  if (!Array.isArray(hooks.PreToolUse) || !hooks.PreToolUse.every(isRecord)) {
    throw new InstallError("invalid_json", SETTINGS_PATH);
  }
  const ownedIndexes = hooks.PreToolUse
    .map((entry, index) => ({ index, environment: hookEnvironment(entry) }))
    .filter((entry) => entry.environment !== undefined);
  let insertionIndex: number | undefined;
  let previousOwnedEntry: unknown;
  if (owned !== undefined) {
    const expectedEnvironment = owned.id.split(".").at(-1);
    const matched = ownedIndexes.filter((entry) => entry.environment === expectedEnvironment);
    if (matched.length !== 1) throw new InstallError("managed_content_changed", SETTINGS_PATH);
    const index = matched[0]?.index;
    if (index === undefined) throw new InstallError("managed_content_changed", SETTINGS_PATH);
    verifySection(owned, `hooks.PreToolUse.kcoderag-nav.${expectedEnvironment}`, hooks.PreToolUse[index], SETTINGS_PATH);
    previousOwnedEntry = hooks.PreToolUse[index];
    hooks.PreToolUse.splice(index, 1);
    insertionIndex = index;
  } else if (allowLegacyOwned) {
    for (const entry of [...ownedIndexes].sort((left, right) => right.index - left.index)) {
      hooks.PreToolUse.splice(entry.index, 1);
    }
  } else if (ownedIndexes.length > 0 || JSON.stringify(document).includes("Checking code lookup strategy (KCodeRag")) {
    throw new InstallError("unmanaged_name_conflict", SETTINGS_PATH);
  }
  const entry = managedHook(environment);
  if (insertionIndex === undefined) hooks.PreToolUse.push(entry);
  else hooks.PreToolUse.splice(insertionIndex, 0, entry);
  const renderedIndex = hooks.PreToolUse.length - 1;
  const preserveManaged = owned !== undefined && previousOwnedEntry !== undefined &&
    sectionDigest(previousOwnedEntry) === sectionDigest(entry);
  let bytes: Buffer;
  if (current === undefined) {
    bytes = canonicalJson(document);
  } else {
    bytes = losslessJson(current, SETTINGS_PATH, (original) => {
      if (preserveManaged) return original;
      let rendered = original;
      if (owned !== undefined && insertionIndex !== undefined) {
        return upsertJsonArrayElement(rendered, ["hooks", "PreToolUse"], insertionIndex, entry);
      }
      if (allowLegacyOwned) {
        for (const ownedEntry of [...ownedIndexes].sort((left, right) => right.index - left.index)) {
          rendered = removeJsonArrayElement(rendered, ["hooks", "PreToolUse"], ownedEntry.index);
        }
        return upsertJsonArrayElement(rendered, ["hooks", "PreToolUse"], renderedIndex, entry);
      }
      return preToolUseExisted
        ? upsertJsonArrayElement(rendered, ["hooks", "PreToolUse"], renderedIndex, entry)
        : upsertJsonObjectProperty(rendered, ["hooks"], "PreToolUse", [entry]);
    });
  }
  return {
    bytes,
    section: sectionRecord(
      `hooks.PreToolUse.kcoderag-nav.${environment}`,
      entry,
      fileExisted,
      owned?.createdContainers ?? [
        ...(hooksExisted ? [] : ["hooks"]),
        ...(preToolUseExisted ? [] : ["hooks.PreToolUse"]),
      ],
    ),
  };
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

function sourceAsset(packageRoot: string, relativePath: string): Buffer {
  try {
    return fs.readFileSync(path.join(packageRoot, ...relativePath.split("/")));
  } catch {
    throw new InstallError("missing_package_asset", relativePath);
  }
}

function issueFrom(error: unknown): StatusIssue {
  return error instanceof InstallError
    ? { code: error.code, path: error.safePath ?? "." }
    : { code: "invalid", path: "." };
}

function details(observation: HostObservation): ClaudeObservationDetails {
  return (observation.details ?? {}) as ClaudeObservationDetails;
}

function validateCurrentState(state: InstallState): InstallState {
  if (state.host !== "claude") throw new InstallError("invalid_state", STATE_PATH);
  const paths = managedPaths(state.environment);
  const owned = paths.filter((relativePath) => relativePath !== STATE_PATH);
  const dedicated = owned.filter((relativePath) => !SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number]));
  const secureState = state.sections !== undefined;
  if (
    state.managedFiles.join("\0") !== paths.join("\0") ||
    Object.keys(state.originals).sort().join("\0") !==
      [...(secureState ? dedicated : owned)].sort().join("\0") ||
    Object.keys(state.digests).sort().join("\0") !==
      [...(secureState ? dedicated : owned)].sort().join("\0") ||
    (secureState && Object.keys(state.sections ?? {}).sort().join("\0") !== [...SHARED_PATHS].sort().join("\0"))
  ) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  return state;
}

function validateOwnedSections(
  target: ProjectTarget,
  state: Pick<LegacyInstallState, "environment" | "sections"> | InstallState,
): void {
  const mcpRecord = state.sections?.[MCP_PATH];
  const settingsRecord = state.sections?.[SETTINGS_PATH];
  const currentMcp = readManagedOptional(target, MCP_PATH);
  const currentSettings = readManagedOptional(target, SETTINGS_PATH);
  if (
    mcpRecord === undefined ||
    settingsRecord === undefined ||
    currentMcp === undefined ||
    currentSettings === undefined
  ) {
    throw new InstallError("managed_content_changed", MCP_PATH);
  }
  const mcpDocument = parseJsonBytes(currentMcp, "invalid_json", MCP_PATH);
  if (!isRecord(mcpDocument.mcpServers)) {
    throw new InstallError("managed_content_changed", MCP_PATH);
  }
  const mcpName = mcpRecord.id.split(".").at(-1);
  if (mcpName === undefined) throw new InstallError("invalid_state", STATE_PATH);
  verifySection(mcpRecord, `mcpServers.${mcpName}`, mcpDocument.mcpServers[mcpName], MCP_PATH);

  const settingsDocument = parseJsonBytes(currentSettings, "invalid_json", SETTINGS_PATH);
  if (!isRecord(settingsDocument.hooks) || !Array.isArray(settingsDocument.hooks.PreToolUse)) {
    throw new InstallError("managed_content_changed", SETTINGS_PATH);
  }
  const environment = settingsRecord.id.split(".").at(-1);
  const matched = settingsDocument.hooks.PreToolUse.filter((entry) =>
    hookEnvironment(entry) === environment);
  if (matched.length !== 1 || matched[0] === undefined) {
    throw new InstallError("managed_content_changed", SETTINGS_PATH);
  }
  verifySection(
    settingsRecord,
    `hooks.PreToolUse.kcoderag-nav.${environment}`,
    matched[0],
    SETTINGS_PATH,
  );
}

function encodedLegacyEnvironment(bytes: Buffer): LegacyEnvironmentId | undefined {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(value)) return undefined;
    if (
      value.schemaVersion === CORE_SCHEMA_VERSION &&
      (value.environment === "qa" || value.environment === "dev")
    ) return value.environment;
    if (
      value.version === 1 &&
      !("schemaVersion" in value) &&
      Array.isArray(value.active_environments) &&
      value.active_environments.length === 1 &&
      (value.active_environments[0] === "qa" || value.active_environments[0] === "dev")
    ) return value.active_environments[0];
  } catch {
    // The strict state decoder below owns the stable invalid_state result.
  }
  return undefined;
}

function validateLegacyState(target: ProjectTarget, state: LegacyInstallState): void {
  if (state.source !== "node" || state.host !== "claude") {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  const paths = legacyManagedPaths(state.environment);
  const owned = paths.filter((relativePath) => relativePath !== STATE_PATH);
  const dedicated = owned.filter((relativePath) =>
    !SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number]));
  const secureState = state.sections !== undefined;
  if (
    state.managedFiles.join("\0") !== paths.join("\0") ||
    Object.keys(state.originals).sort().join("\0") !==
      [...(secureState ? dedicated : owned)].sort().join("\0") ||
    Object.keys(state.digests).sort().join("\0") !==
      [...(secureState ? dedicated : owned)].sort().join("\0") ||
    (secureState && Object.keys(state.sections ?? {}).sort().join("\0") !==
      [...SHARED_PATHS].sort().join("\0")) ||
    (secureState && state.sections?.[MCP_PATH]?.id !== `mcpServers.kcoderag-${state.environment}`) ||
    (secureState && state.sections?.[SETTINGS_PATH]?.id !==
      `hooks.PreToolUse.kcoderag-nav.${state.environment}`)
  ) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  if (secureState) validateOwnedSections(target, state);
}

function detectClaude(context: { readonly target: ProjectTarget }): HostObservation {
  const stateBytes = readManagedOptional(context.target, STATE_PATH);
  if (stateBytes === undefined) {
    return Object.freeze({
      host: "claude" as const,
      target: context.target,
      details: Object.freeze({} satisfies ClaudeObservationDetails),
    });
  }
  const legacyEnvironment = encodedLegacyEnvironment(stateBytes);
  try {
    let currentState: InstallState | undefined;
    try {
      currentState = validateCurrentState(parseInstallState(stateBytes));
    } catch {
      // Exact legacy decoding below owns compatibility; invalid inputs remain invalid.
    }
    if (currentState !== undefined) {
      if (currentState.sections !== undefined) validateOwnedSections(context.target, currentState);
      for (const [relativePath, digest] of Object.entries(currentState.digests)) {
        const current = readManagedOptional(context.target, relativePath);
        if (current === undefined || sha256(current) !== digest) {
          throw new InstallError("managed_content_changed", relativePath);
        }
      }
      return Object.freeze({
        host: "claude" as const,
        target: context.target,
        currentState,
        details: Object.freeze({ stateBytes: Buffer.from(stateBytes) } satisfies ClaudeObservationDetails),
      });
    }
    if (legacyEnvironment === undefined) throw new InstallError("invalid_state", STATE_PATH);
    const legacyState = parseLegacyInstallState(stateBytes, {
      allowedPaths: legacyManagedPaths(legacyEnvironment),
      requiredPaths: [MCP_PATH, SETTINGS_PATH, SKILL_PATH],
    });
    validateLegacyState(context.target, legacyState);
    for (const [relativePath, digest] of Object.entries(legacyState.digests)) {
      const current = readManagedOptional(context.target, relativePath);
      if (current === undefined || sha256(current) !== digest) {
        throw new InstallError("managed_content_changed", relativePath);
      }
    }
    return Object.freeze({
      host: "claude" as const,
      target: context.target,
      legacyEnvironment: legacyState.environment,
      details: Object.freeze({
        stateBytes: Buffer.from(stateBytes),
        legacyState,
      } satisfies ClaudeObservationDetails),
    });
  } catch (error) {
    const observation: {
      host: "claude";
      target: ProjectTarget;
      issues: readonly StatusIssue[];
      legacyEnvironment?: LegacyEnvironmentId;
      details: Readonly<ClaudeObservationDetails>;
    } = {
      host: "claude" as const,
      target: context.target,
      issues: Object.freeze([issueFrom(error)]),
      details: Object.freeze({ stateBytes: Buffer.from(stateBytes) } satisfies ClaudeObservationDetails),
    };
    if (legacyEnvironment !== undefined) observation.legacyEnvironment = legacyEnvironment;
    return Object.freeze(observation);
  }
}

function refuseIssues(observation: HostObservation): void {
  const issue = observation.issues?.[0];
  if (issue !== undefined) throw new InstallError(issue.code, issue.path);
}

function captureOriginals(target: ProjectTarget, environment: CurrentEnvironmentId): Record<string, OriginalRecord> {
  const originals: Record<string, OriginalRecord> = {};
  for (const relativePath of managedPaths(environment)) {
    if (relativePath === STATE_PATH) continue;
    if (SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])) continue;
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
  if (
    state !== undefined &&
    SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])
  ) {
    const current = readManagedOptional(target, relativePath);
    return current === undefined ? null : sha256(current);
  }
  if (state !== undefined) return state.digests[relativePath] ?? null;
  const current = readManagedOptional(target, relativePath);
  return current === undefined ? null : sha256(current);
}

function desiredPayloads(
  context: HostInstallContext,
  legacy?: LegacyInstallState,
): { readonly payloads: Map<string, Buffer>; readonly sections: Record<string, ManagedSectionRecord> } {
  const name = packageName(context.environment);
  const existing = context.observation.currentState;
  const currentMcp = readManagedOptional(context.target, MCP_PATH);
  const currentSettings = readManagedOptional(context.target, SETTINGS_PATH);
  const legacyWholeFile = legacy !== undefined
    ? legacy.sections === undefined
    : existing !== undefined && existing.sections === undefined;
  const priorSections = legacy?.sections ?? existing?.sections;
  const wholeFileOriginal = (relativePath: string): Buffer | undefined => {
    if (!legacyWholeFile) return undefined;
    const record = legacy?.originals[relativePath] ?? existing?.originals[relativePath];
    const decoded = record === undefined ? null : decodeOriginal(record, relativePath);
    return decoded ?? Buffer.from("{}", "utf8");
  };
  const mcp = renderMcp(
    currentMcp,
    context.packageRoot,
    context.environment,
    priorSections?.[MCP_PATH],
    legacy !== undefined || legacyWholeFile,
    priorSections?.[MCP_PATH]?.fileExisted ??
      (legacyWholeFile
        ? (legacy?.originals[MCP_PATH] ?? existing?.originals[MCP_PATH])?.kind !== "absent"
        : currentMcp !== undefined),
    wholeFileOriginal(MCP_PATH),
  );
  const settings = renderSettings(
    currentSettings,
    context.environment,
    priorSections?.[SETTINGS_PATH],
    legacy !== undefined || legacyWholeFile,
    priorSections?.[SETTINGS_PATH]?.fileExisted ??
      (legacyWholeFile
        ? (legacy?.originals[SETTINGS_PATH] ?? existing?.originals[SETTINGS_PATH])?.kind !== "absent"
        : currentSettings !== undefined),
    wholeFileOriginal(SETTINGS_PATH),
  );
  const payloads = new Map<string, Buffer>();
  payloads.set(MCP_PATH, mcp.bytes);
  payloads.set(SETTINGS_PATH, settings.bytes);
  payloads.set(SKILL_PATH, sourceAsset(context.packageRoot, `${name}/skills/code-lookup-discipline/SKILL.md`));
  for (const asset of HOOK_ASSETS) {
    payloads.set(`${hookPrefix(context.environment)}/${asset}`, sourceAsset(context.packageRoot, `${name}/hooks/${asset}`));
  }
  return {
    payloads,
    sections: { [MCP_PATH]: mcp.section, [SETTINGS_PATH]: settings.section },
  };
}

function legacyMigrationOriginals(
  target: ProjectTarget,
  legacy: LegacyInstallState,
): Record<string, OriginalRecord> {
  const originals: Record<string, OriginalRecord> = {};
  for (const relativePath of managedPaths()) {
    if (relativePath === STATE_PATH) continue;
    if (SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])) {
      if (legacy.sections !== undefined) continue;
      const record = legacy.originals[relativePath];
      if (record === undefined) throw new InstallError("invalid_state", STATE_PATH);
      originals[relativePath] = record;
      continue;
    }
    if (relativePath === SKILL_PATH || legacy.managedFiles.includes(relativePath)) {
      const record = legacy.originals[relativePath];
      if (record === undefined) throw new InstallError("invalid_state", STATE_PATH);
      originals[relativePath] = record;
      continue;
    }
    if (readManagedOptional(target, relativePath) !== undefined) {
      throw new InstallError("unmanaged_name_conflict", relativePath);
    }
    originals[relativePath] = encodeOriginal(undefined);
  }
  return originals;
}

function renderLegacyInstall(
  context: HostInstallContext,
  legacy: LegacyInstallState,
  stateBytes: Buffer,
): DesiredState {
  if (legacy.environment === "dev" && !context.allowLegacyDevMigration) {
    throw new InstallError("legacy_dev_migration_authority_required", STATE_PATH);
  }
  if (legacy.environment !== "dev" && context.allowLegacyDevMigration) {
    throw new InstallError("legacy_dev_migration_authority_invalid", STATE_PATH);
  }
  const paths = managedPaths();
  const migrationOriginals = legacyMigrationOriginals(context.target, legacy);
  const originals = Object.fromEntries(Object.entries(migrationOriginals).filter(([relativePath]) =>
    !SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])));
  const rendered = desiredPayloads(context, legacy);
  const payloads = rendered.payloads;
  const digests: Record<string, string> = {};
  for (const [relativePath, bytes] of payloads) {
    if (!SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])) {
      digests[relativePath] = sha256(bytes);
    }
  }
  const state: InstallState = {
    schemaVersion: CORE_SCHEMA_VERSION,
    packageVersion: readPackageVersion(context.packageRoot),
    host: "claude",
    environment: "qa",
    managedFiles: [...paths],
    originals,
    digests,
    sections: rendered.sections,
  };
  payloads.set(STATE_PATH, canonicalJson(state));
  const replacements = new Set(paths);
  const legacyOnlyPaths = legacy.managedFiles.filter((relativePath) =>
    relativePath !== STATE_PATH && !replacements.has(relativePath));
  const expectedCurrentDigest = (relativePath: string): string | null => {
    const current = readManagedOptional(context.target, relativePath);
    return current === undefined ? null : sha256(current);
  };
  return createDesiredState({
    host: "claude",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: [
      ...paths.map((relativePath) => ({
        relativePath,
        expectedDigest: relativePath === STATE_PATH ? sha256(stateBytes) : expectedCurrentDigest(relativePath),
        content: payloads.get(relativePath) ?? null,
      })),
      ...legacyOnlyPaths.map((relativePath) => ({
        relativePath,
        expectedDigest: expectedCurrentDigest(relativePath),
        content: decodeOriginal(legacy.originals[relativePath], relativePath),
      })),
    ],
  });
}

function renderInstall(context: HostInstallContext): DesiredState {
  refuseIssues(context.observation);
  const observationDetails = details(context.observation);
  if (observationDetails.legacyState !== undefined) {
    if (observationDetails.stateBytes === undefined) throw new InstallError("invalid_state", STATE_PATH);
    return renderLegacyInstall(context, observationDetails.legacyState, observationDetails.stateBytes);
  }
  const existing = context.observation.currentState;
  if (context.command === "update" && existing === undefined) throw new InstallError("not_installed", STATE_PATH);
  if (existing !== undefined && existing.environment !== context.environment) {
    throw new InstallError("environment_conflict", STATE_PATH);
  }
  const paths = managedPaths(context.environment);
  const originals = existing === undefined
    ? captureOriginals(context.target, context.environment)
    : Object.fromEntries(Object.entries(existing.originals).filter(([relativePath]) =>
      !SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])));
  const rendered = desiredPayloads(context);
  const payloads = rendered.payloads;
  const digests: Record<string, string> = {};
  for (const [relativePath, bytes] of payloads) {
    if (!SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])) {
      digests[relativePath] = sha256(bytes);
    }
  }
  const state: InstallState = {
    schemaVersion: CORE_SCHEMA_VERSION,
    packageVersion: readPackageVersion(context.packageRoot),
    host: "claude",
    environment: context.environment,
    managedFiles: [...paths],
    originals,
    digests,
    sections: rendered.sections,
  };
  payloads.set(STATE_PATH, canonicalJson(state));
  const stateBytes = details(context.observation).stateBytes;
  return createDesiredState({
    host: "claude",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: paths.map((relativePath) => ({
      relativePath,
      expectedDigest: expectedDigest(context.target, relativePath, existing, stateBytes),
      content: payloads.get(relativePath) ?? null,
    })),
  });
}

function uninstallShared(
  target: ProjectTarget,
  state: Pick<LegacyInstallState, "sections"> | InstallState,
): Map<string, Buffer | null> {
  const result = new Map<string, Buffer | null>();
  const mcpRecord = state.sections?.[MCP_PATH];
  const settingsRecord = state.sections?.[SETTINGS_PATH];
  if (mcpRecord === undefined || settingsRecord === undefined) {
    throw new InstallError("invalid_state", STATE_PATH);
  }

  const currentMcp = readManagedOptional(target, MCP_PATH);
  if (currentMcp === undefined) throw new InstallError("managed_content_changed", MCP_PATH);
  const mcpDocument = parseJsonBytes(currentMcp, "invalid_json", MCP_PATH);
  if (!isRecord(mcpDocument.mcpServers)) {
    throw new InstallError("managed_content_changed", MCP_PATH);
  }
  const mcpName = mcpRecord.id.split(".").at(-1);
  if (mcpName === undefined) throw new InstallError("invalid_state", STATE_PATH);
  verifySection(mcpRecord, `mcpServers.${mcpName}`, mcpDocument.mcpServers[mcpName], MCP_PATH);
  delete mcpDocument.mcpServers[mcpName];
  let renderedMcp = losslessJson(currentMcp, MCP_PATH, (original) =>
    removeJsonObjectProperty(original, ["mcpServers"], mcpName), "managed_content_changed");
  if (Object.keys(mcpDocument.mcpServers).length === 0 &&
      mcpRecord.createdContainers?.includes("mcpServers")) {
    delete mcpDocument.mcpServers;
  }
  if (mcpDocument.mcpServers === undefined) {
    renderedMcp = losslessJson(renderedMcp, MCP_PATH, (original) =>
      removeJsonObjectProperty(original, [], "mcpServers"), "managed_content_changed");
  }
  result.set(
    MCP_PATH,
    !mcpRecord.fileExisted && Object.keys(mcpDocument).length === 0
      ? null
      : renderedMcp,
  );

  const currentSettings = readManagedOptional(target, SETTINGS_PATH);
  if (currentSettings === undefined) throw new InstallError("managed_content_changed", SETTINGS_PATH);
  const settingsDocument = parseJsonBytes(currentSettings, "invalid_json", SETTINGS_PATH);
  if (!isRecord(settingsDocument.hooks) || !Array.isArray(settingsDocument.hooks.PreToolUse)) {
    throw new InstallError("managed_content_changed", SETTINGS_PATH);
  }
  const environment = settingsRecord.id.split(".").at(-1);
  const matched = settingsDocument.hooks.PreToolUse
    .map((entry, index) => ({ entry, index, environment: hookEnvironment(entry) }))
    .filter((entry) => entry.environment === environment);
  if (matched.length !== 1 || matched[0] === undefined) {
    throw new InstallError("managed_content_changed", SETTINGS_PATH);
  }
  verifySection(
    settingsRecord,
    `hooks.PreToolUse.kcoderag-nav.${environment}`,
    matched[0].entry,
    SETTINGS_PATH,
  );
  settingsDocument.hooks.PreToolUse.splice(matched[0].index, 1);
  let renderedSettings = losslessJson(currentSettings, SETTINGS_PATH, (original) =>
    removeJsonArrayElement(original, ["hooks", "PreToolUse"], matched[0]!.index), "managed_content_changed");
  if (settingsDocument.hooks.PreToolUse.length === 0 &&
      settingsRecord.createdContainers?.includes("hooks.PreToolUse")) {
    delete settingsDocument.hooks.PreToolUse;
  }
  if (settingsDocument.hooks.PreToolUse === undefined) {
    renderedSettings = losslessJson(renderedSettings, SETTINGS_PATH, (original) =>
      removeJsonObjectProperty(original, ["hooks"], "PreToolUse"), "managed_content_changed");
  }
  if (Object.keys(settingsDocument.hooks).length === 0 &&
      settingsRecord.createdContainers?.includes("hooks")) {
    delete settingsDocument.hooks;
  }
  if (settingsDocument.hooks === undefined) {
    renderedSettings = losslessJson(renderedSettings, SETTINGS_PATH, (original) =>
      removeJsonObjectProperty(original, [], "hooks"), "managed_content_changed");
  }
  result.set(
    SETTINGS_PATH,
    !settingsRecord.fileExisted && Object.keys(settingsDocument).length === 0
      ? null
      : renderedSettings,
  );
  return result;
}

function renderUninstall(context: HostUninstallContext): DesiredState {
  refuseIssues(context.observation);
  const observationDetails = details(context.observation);
  const legacy = observationDetails.legacyState;
  if (legacy !== undefined) {
    const stateBytes = observationDetails.stateBytes;
    if (stateBytes === undefined) throw new InstallError("invalid_state", STATE_PATH);
    const sharedPayloads = legacy.sections === undefined
      ? new Map<string, Buffer | null>()
      : uninstallShared(context.target, legacy);
    return createDesiredState({
      host: "claude",
      target: context.target,
      managedRoots: MANAGED_ROOTS,
      statePath: STATE_PATH,
      entries: [
        ...legacy.managedFiles
          .filter((relativePath) => relativePath !== STATE_PATH)
          .map((relativePath) => ({
            relativePath,
            expectedDigest: (() => {
              const current = readManagedOptional(context.target, relativePath);
              return current === undefined ? null : sha256(current);
            })(),
            content: sharedPayloads.has(relativePath)
              ? sharedPayloads.get(relativePath) ?? null
              : decodeOriginal(legacy.originals[relativePath], relativePath),
          })),
        { relativePath: STATE_PATH, expectedDigest: sha256(stateBytes), content: null },
      ],
    });
  }
  const state = context.observation.currentState;
  const stateBytes = observationDetails.stateBytes;
  if (state === undefined || stateBytes === undefined) throw new InstallError("not_installed", STATE_PATH);
  if (state.environment !== context.environment) throw new InstallError("environment_not_installed", STATE_PATH);
  const sharedPayloads = state.sections === undefined
    ? new Map<string, Buffer | null>()
    : uninstallShared(context.target, state);
  return createDesiredState({
    host: "claude",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: managedPaths(state.environment).map((relativePath) => ({
      relativePath,
      expectedDigest: expectedDigest(context.target, relativePath, state, stateBytes),
      content: relativePath === STATE_PATH
        ? null
        : sharedPayloads.has(relativePath)
          ? sharedPayloads.get(relativePath) ?? null
          : decodeOriginal(state.originals[relativePath], relativePath),
    })),
  });
}

function defaultClaudeRunner(request: NativeRunRequest): Promise<ClaudeNativeResult> {
  return new Promise((resolve) => {
    childProcess.execFile(
      request.executable,
      [...request.args],
      {
        encoding: "utf8",
        timeout: request.timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        shell: false,
      },
      (error, stdout) => {
        const timedOut = error !== null && (
          error.killed === true ||
          error.code === "ETIMEDOUT" ||
          error.signal === "SIGTERM"
        );
        const result: { exitCode: number; timedOut: boolean; stdout?: string } = {
          exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
          timedOut,
        };
        if (typeof stdout === "string" && Buffer.byteLength(stdout, "utf8") <= 1024 * 1024) {
          result.stdout = stdout;
        }
        resolve(Object.freeze(result));
      },
    );
  });
}

function readBoundedRegularText(filePath: string, maximumBytes: number): string | undefined {
  try {
    const metadata = fs.lstatSync(filePath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > maximumBytes) return undefined;
    return new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(filePath));
  } catch {
    return undefined;
  }
}

function containsKCodeRagMcpKey(text: string): boolean {
  return /"mcpServers"\s*:\s*\{[\s\S]{0,262144}?"kcoderag(?:-(?:qa|dev|nav))?"\s*:/i.test(text);
}

function containsKCodeRagHookSignature(text: string): boolean {
  const signature = /kcoderag-(?:qa|dev|nav)|kcoderag_nav/i;
  try {
    const document: unknown = JSON.parse(text);
    if (!isRecord(document) || document.hooks === undefined) return false;
    return signature.test(JSON.stringify(document.hooks));
  } catch {
    // Preserve the prior fail-closed signal for malformed JSON without letting valid
    // documents match KCodeRag identifiers outside the top-level hooks subtree.
    return /"hooks"\s*:\s*\{[\s\S]{0,262144}?(?:kcoderag-(?:qa|dev|nav)|kcoderag_nav)/i.test(text);
  }
}

function defaultClaudeUserSourceReader(claudeRoot: string, userHome: string): ClaudeUserSourceReader {
  return () => {
    const rawMcpPaths = new Set<string>();
    const manualHookPaths = new Set<string>();
    const cachePaths = new Set<string>();
    const ambiguousPaths = new Set<string>();
    const mcpPath = path.join(userHome, ".claude.json");
    const settingsPath = path.join(claudeRoot, "settings.json");
    const textInputs = [
      {
        absolutePath: mcpPath,
        safePath: USER_MCP_SAFE_PATH,
        classify: containsKCodeRagMcpKey,
        destination: rawMcpPaths,
      },
      {
        absolutePath: settingsPath,
        safePath: USER_SETTINGS_SAFE_PATH,
        classify: containsKCodeRagHookSignature,
        destination: manualHookPaths,
      },
    ] as const;
    for (const input of textInputs) {
      const text = readBoundedRegularText(input.absolutePath, 1024 * 1024);
      if (fs.existsSync(input.absolutePath) && text === undefined) {
        ambiguousPaths.add(input.safePath);
      } else if (text !== undefined && input.classify(text)) {
        input.destination.add(input.safePath);
      }
    }
    for (const [safePath, absolutePath] of [
      [USER_CACHE_SAFE_PATH, path.join(claudeRoot, "plugins", "cache", OWNED_MARKETPLACE)],
      [USER_MARKETPLACE_CACHE_SAFE_PATH, path.join(claudeRoot, "plugins", "marketplaces", OWNED_MARKETPLACE)],
    ] as const) {
      try {
        const metadata = fs.lstatSync(absolutePath);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) ambiguousPaths.add(safePath);
        else cachePaths.add(safePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") ambiguousPaths.add(safePath);
      }
    }
    return Object.freeze({
      rawMcpPaths: Object.freeze([...rawMcpPaths]),
      manualHookPaths: Object.freeze([...manualHookPaths]),
      cachePaths: Object.freeze([...cachePaths]),
      ambiguousPaths: Object.freeze([...ambiguousPaths]),
    });
  };
}

interface ParsedClaudePlugin {
  readonly id: string;
  readonly inventoryIdentity: string;
  readonly name: string;
  readonly marketplace: string;
  readonly scope: "user" | "project" | "local";
  readonly enabled: boolean;
}

interface ParsedClaudeMarketplace {
  readonly name: string;
}

function exactKeys(value: JsonMap, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function boundedString(value: unknown, maximum = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\r\n\0]/.test(value);
}

function pluginIdentity(id: string): { readonly name: string; readonly marketplace: string } | undefined {
  const separator = id.lastIndexOf("@");
  if (separator <= 0 || separator === id.length - 1) return undefined;
  return { name: id.slice(0, separator), marketplace: id.slice(separator + 1) };
}

function parseClaudePlugin(value: unknown): ParsedClaudePlugin | undefined {
  if (!isRecord(value) || !exactKeys(value, [
    "id", "version", "scope", "enabled", "installPath", "installedAt", "lastUpdated",
  ], ["projectPath", "mcpServers"]) ||
      !boundedString(value.id, 320) || !boundedString(value.version, 128) ||
      !boundedString(value.scope, 16) || !CLAUDE_SCOPES.has(value.scope) ||
      typeof value.enabled !== "boolean" || !boundedString(value.installPath) ||
      !boundedString(value.installedAt, 128) || !boundedString(value.lastUpdated, 128) ||
      (value.projectPath !== undefined && !boundedString(value.projectPath)) ||
      (value.mcpServers !== undefined && !isRecord(value.mcpServers))) {
    return undefined;
  }
  const identity = pluginIdentity(value.id);
  if (identity === undefined) return undefined;
  return Object.freeze({
    id: value.id,
    inventoryIdentity: sha256(Buffer.from(JSON.stringify([
      value.id,
      value.scope,
      value.projectPath ?? null,
    ]), "utf8")),
    name: identity.name,
    marketplace: identity.marketplace,
    scope: value.scope as "user" | "project" | "local",
    enabled: value.enabled,
  });
}

function parseClaudePluginInventory(stdout: string): readonly ParsedClaudePlugin[] | undefined {
  if (Buffer.byteLength(stdout, "utf8") > 1024 * 1024) return undefined;
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { return undefined; }
  if (!Array.isArray(value)) return undefined;
  const entries = value.map(parseClaudePlugin);
  if (entries.some((entry) => entry === undefined)) return undefined;
  const normalized = entries as ParsedClaudePlugin[];
  if (new Set(normalized.map((entry) => entry.inventoryIdentity)).size !== normalized.length) return undefined;
  return Object.freeze(normalized);
}

function parseClaudeMarketplace(value: unknown): ParsedClaudeMarketplace | undefined {
  if (!isRecord(value)) return undefined;
  const repoShape = exactKeys(value, ["name", "source", "repo", "installLocation"]);
  const urlShape = exactKeys(value, ["name", "source", "url", "installLocation"]);
  if ((!repoShape && !urlShape) || !boundedString(value.name, 160) ||
      !boundedString(value.source, 64) || !boundedString(value.installLocation) ||
      (repoShape ? !boundedString(value.repo) : !boundedString(value.url))) return undefined;
  return Object.freeze({ name: value.name });
}

function parseClaudeMarketplaceInventory(stdout: string): readonly ParsedClaudeMarketplace[] | undefined {
  if (Buffer.byteLength(stdout, "utf8") > 1024 * 1024) return undefined;
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { return undefined; }
  if (!Array.isArray(value)) return undefined;
  const entries = value.map(parseClaudeMarketplace);
  if (entries.some((entry) => entry === undefined)) return undefined;
  const normalized = entries as ParsedClaudeMarketplace[];
  if (new Set(normalized.map((entry) => entry.name)).size !== normalized.length) return undefined;
  return Object.freeze(normalized);
}

function semverTuple(value: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function versionAtLeast(value: string, minimum: string): boolean {
  const left = semverTuple(value);
  const right = semverTuple(minimum);
  if (left === undefined || right === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] as number) - (right[index] as number);
    if (delta !== 0) return delta > 0;
  }
  return true;
}

function observedClaudeVersion(stdout: string | undefined): string | undefined {
  if (stdout === undefined || Buffer.byteLength(stdout, "utf8") > 1024) return undefined;
  return /^(\d+\.\d+\.\d+) \(Claude Code\)\s*$/.exec(stdout)?.[1];
}

function claudeHelpMatches(command: string, stdout: string | undefined): boolean {
  if (stdout === undefined || Buffer.byteLength(stdout, "utf8") > 64 * 1024) return false;
  if (command === "plugin list" || command === "plugin marketplace list") return stdout.includes("--json");
  if (!stdout.includes("--scope")) return false;
  if (command === "plugin uninstall") {
    return /PLUGIN/i.test(stdout) && ["user", "project", "local"].every((scope) => stdout.includes(scope));
  }
  return command === "plugin marketplace remove" && /name|marketplace/i.test(stdout);
}

async function observeClaudeCapability(
  runner: ClaudeNativeRunner,
  mode: SourceScanMode,
) {
  const versionResult = await runner(Object.freeze({
    executable: "claude",
    args: Object.freeze(["--version"]),
    timeoutMs: CLAUDE_TIMEOUT_MS,
  }));
  const observedVersion = versionResult.exitCode === 0 && !versionResult.timedOut
    ? observedClaudeVersion(versionResult.stdout)
    : undefined;
  if (observedVersion === undefined || !versionAtLeast(observedVersion, CLAUDE_MINIMUM_VERSION)) {
    return undefined;
  }
  if (mode !== "fast") {
    const commands = [
      ["plugin", "list"],
      ["plugin", "marketplace", "list"],
      ["plugin", "uninstall"],
      ["plugin", "marketplace", "remove"],
    ] as const;
    for (const parts of commands) {
      const result = await runner(Object.freeze({
        executable: "claude",
        args: Object.freeze([...parts, "--help"]),
        timeoutMs: CLAUDE_TIMEOUT_MS,
      }));
      if (result.exitCode !== 0 || result.timedOut ||
          !claudeHelpMatches(parts.join(" "), result.stdout)) return undefined;
    }
  }
  return createNativeHostCapability({
    host: "claude",
    cli: "claude",
    minimumVersion: CLAUDE_MINIMUM_VERSION,
    observedVersion,
    inventorySchemaId: CLAUDE_INVENTORY_SCHEMA,
    completeInventory: true,
    route: "normal",
  });
}

function normalizeClaudeUserSources(value: unknown): ClaudeUserSourceMetadata {
  const ambiguous = (): ClaudeUserSourceMetadata => Object.freeze({
    rawMcpPaths: Object.freeze([]),
    manualHookPaths: Object.freeze([]),
    cachePaths: Object.freeze([]),
    ambiguousPaths: Object.freeze([USER_SETTINGS_SAFE_PATH]),
  });
  if (!isRecord(value) || !exactKeys(value, [
    "rawMcpPaths", "manualHookPaths", "cachePaths", "ambiguousPaths",
  ]) || !Array.isArray(value.rawMcpPaths) || !Array.isArray(value.manualHookPaths) ||
      !Array.isArray(value.cachePaths) || !Array.isArray(value.ambiguousPaths)) return ambiguous();
  const allowed = new Set([
    USER_MCP_SAFE_PATH,
    USER_SETTINGS_SAFE_PATH,
    USER_CACHE_SAFE_PATH,
    USER_MARKETPLACE_CACHE_SAFE_PATH,
  ]);
  const groups = [value.rawMcpPaths, value.manualHookPaths, value.cachePaths, value.ambiguousPaths];
  if (groups.some((group) => group.some((item) => typeof item !== "string" || !allowed.has(item)))) {
    return ambiguous();
  }
  return Object.freeze({
    rawMcpPaths: Object.freeze([...(value.rawMcpPaths as string[])]),
    manualHookPaths: Object.freeze([...(value.manualHookPaths as string[])]),
    cachePaths: Object.freeze([...(value.cachePaths as string[])]),
    ambiguousPaths: Object.freeze([...(value.ambiguousPaths as string[])]),
  });
}

function claudeConflictFinding(
  code: "raw_mcp_source" | "manual_hook_source" | "ambiguous_source" | "source_scan_unavailable",
  sourceType: "raw_mcp" | "manual_hook" | "ambiguous",
  safePath: string,
) {
  return createSourceFinding({
    code,
    severity: "conflict",
    sourceType,
    scope: "user",
    safePath,
    cleanupEligible: false,
  });
}

function claudeMetadataFindings(metadata: ClaudeUserSourceMetadata, mode: SourceScanMode) {
  const findings = [
    ...metadata.rawMcpPaths.map((safePath) =>
      claudeConflictFinding("raw_mcp_source", "raw_mcp", safePath)),
    ...metadata.manualHookPaths.map((safePath) =>
      claudeConflictFinding("manual_hook_source", "manual_hook", safePath)),
    ...metadata.ambiguousPaths.map((safePath) =>
      claudeConflictFinding("ambiguous_source", "ambiguous", safePath)),
  ];
  if (mode !== "fast") {
    findings.push(...metadata.cachePaths.map((safePath) => createSourceFinding({
      code: "cache_residue",
      severity: "info",
      sourceType: "cache_residue",
      scope: "user",
      safePath,
      cleanupEligible: false,
    })));
  }
  return findings;
}

function claudeSourceScope(scope: ParsedClaudePlugin["scope"]): "user" | "project" {
  return scope === "user" ? "user" : "project";
}

function exactOwnedClaudePlugin(entry: ParsedClaudePlugin): boolean {
  return OWNED_PLUGIN_NAMES.has(entry.name) &&
    entry.marketplace === OWNED_MARKETPLACE &&
    entry.id === `${entry.name}@${OWNED_MARKETPLACE}`;
}

function claudeFindingWithPlan(
  plan: NativeCleanupPlan,
  code: "owned_plugin_source" | "owned_marketplace_source",
  scope: "user" | "project",
) {
  return createSourceFinding({
    code,
    severity: "conflict",
    sourceType: plan.sourceType,
    scope,
    safePath: plan.safePath,
    cleanupEligible: true,
    cleanupCommand: plan.command,
    cleanupFingerprint: plan.fingerprint,
  });
}

function claudeManualOwnedFinding(
  sourceType: "owned_plugin" | "owned_marketplace_registration",
  safePath: string,
  scope: "user" | "project" = "user",
) {
  return createSourceFinding({
    code: sourceType === "owned_plugin" ? "owned_plugin_source" : "owned_marketplace_source",
    severity: "conflict",
    sourceType,
    scope,
    safePath,
    cleanupEligible: false,
  });
}

function claudeSourceScanUnavailable(
  mode: SourceScanMode,
  findings: readonly ReturnType<typeof createSourceFinding>[],
) {
  return createSourceScanResult(mode, [
    ...findings,
    claudeConflictFinding("source_scan_unavailable", "ambiguous", USER_PLUGIN_SAFE_PATH),
  ]);
}

async function claudeNativeInventory(runner: ClaudeNativeRunner) {
  const pluginResult = await runner(Object.freeze({
    executable: "claude",
    args: Object.freeze(["plugin", "list", "--json"]),
    timeoutMs: CLAUDE_TIMEOUT_MS,
  }));
  const marketplaceResult = await runner(Object.freeze({
    executable: "claude",
    args: Object.freeze(["plugin", "marketplace", "list", "--json"]),
    timeoutMs: CLAUDE_TIMEOUT_MS,
  }));
  return { pluginResult, marketplaceResult };
}

async function scanClaudeUserSources(
  mode: SourceScanMode,
  runner: ClaudeNativeRunner,
  readUserSources: ClaudeUserSourceReader,
): Promise<SourceScanResult> {
  let metadata: ClaudeUserSourceMetadata;
  try {
    metadata = normalizeClaudeUserSources(await readUserSources());
  } catch {
    metadata = normalizeClaudeUserSources({});
  }
  const findings = claudeMetadataFindings(metadata, mode);
  let capability: ReturnType<typeof createNativeHostCapability> | undefined;
  try {
    capability = await observeClaudeCapability(runner, mode);
  } catch {
    capability = undefined;
  }
  if (capability === undefined) return claudeSourceScanUnavailable(mode, findings);
  let pluginResult: ClaudeNativeResult;
  let marketplaceResult: ClaudeNativeResult;
  try {
    ({ pluginResult, marketplaceResult } = await claudeNativeInventory(runner));
  } catch {
    return claudeSourceScanUnavailable(mode, findings);
  }
  if (pluginResult.exitCode !== 0 || pluginResult.timedOut || pluginResult.stdout === undefined ||
      marketplaceResult.exitCode !== 0 || marketplaceResult.timedOut || marketplaceResult.stdout === undefined) {
    return claudeSourceScanUnavailable(mode, findings);
  }
  const plugins = parseClaudePluginInventory(pluginResult.stdout);
  const marketplaces = parseClaudeMarketplaceInventory(marketplaceResult.stdout);
  if (plugins === undefined || marketplaces === undefined) {
    return claudeSourceScanUnavailable(mode, findings);
  }
  const marketplacePlugins = plugins.filter((entry) => entry.marketplace === OWNED_MARKETPLACE);
  const relatedPlugins = plugins.filter((entry) =>
    /kcoderag/i.test(entry.name) || /kcoderag/i.test(entry.id) || entry.marketplace === OWNED_MARKETPLACE);
  const relatedMarketplaces = marketplaces.filter((entry) => /kcoderag/i.test(entry.name));
  const exactMarketplace = relatedMarketplaces.length === 1 && relatedMarketplaces[0]?.name === OWNED_MARKETPLACE;
  const malformedRelated = relatedPlugins.some((entry) => !exactOwnedClaudePlugin(entry)) ||
    relatedMarketplaces.some((entry) => entry.name !== OWNED_MARKETPLACE) ||
    relatedMarketplaces.length > 1 ||
    (relatedPlugins.length > 0 && !exactMarketplace);
  if (malformedRelated) {
    return createSourceScanResult(mode, [
      ...findings,
      claudeConflictFinding("ambiguous_source", "ambiguous", USER_PLUGIN_SAFE_PATH),
    ]);
  }
  const activePlugins = relatedPlugins.filter((entry) => entry.enabled);
  const disabledPlugins = relatedPlugins.filter((entry) => !entry.enabled);
  if (mode !== "fast") {
    findings.push(...disabledPlugins.map((entry) => createSourceFinding({
      code: "disabled_source",
      severity: "info",
      sourceType: "disabled_registration",
      scope: claudeSourceScope(entry.scope),
      safePath: USER_PLUGIN_SAFE_PATH,
      cleanupEligible: false,
    })));
  }
  const hasManualConflict = findings.some((finding) => finding.severity === "conflict");
  if (activePlugins.length > 1) {
    return createSourceScanResult(mode, [
      ...findings,
      claudeConflictFinding("ambiguous_source", "ambiguous", USER_PLUGIN_SAFE_PATH),
    ]);
  }
  const activePlugin = activePlugins[0];
  if (activePlugin !== undefined) {
    const sourceScope = claudeSourceScope(activePlugin.scope);
    if (mode === "fast" || hasManualConflict) {
      return createSourceScanResult(mode, [
        ...findings,
        claudeManualOwnedFinding("owned_plugin", USER_PLUGIN_SAFE_PATH, sourceScope),
      ]);
    }
    const plan = createNativeCleanupPlan({
      host: "claude",
      sourceType: "owned_plugin",
      safePath: USER_PLUGIN_SAFE_PATH,
      capability,
      argv: ["claude", "plugin", "uninstall", activePlugin.id, "--scope", activePlugin.scope],
      scope: `plugin:${activePlugin.scope}:${activePlugin.name}`,
      timeoutMs: CLAUDE_TIMEOUT_MS,
    });
    return createSourceScanResult(mode, [
      ...findings,
      claudeFindingWithPlan(plan, "owned_plugin_source", sourceScope),
    ], [plan]);
  }
  if (exactMarketplace) {
    const scopes = new Set(marketplacePlugins.map((entry) => entry.scope));
    const exclusive = marketplacePlugins.length > 0 &&
      marketplacePlugins.every(exactOwnedClaudePlugin) && scopes.size === 1;
    const nativeScope = exclusive ? marketplacePlugins[0]?.scope : undefined;
    const sourceScope = nativeScope === undefined ? "user" : claudeSourceScope(nativeScope);
    if (mode === "fast" || hasManualConflict || nativeScope === undefined) {
      return createSourceScanResult(mode, [
        ...findings,
        claudeManualOwnedFinding("owned_marketplace_registration", USER_PLUGIN_SAFE_PATH, sourceScope),
      ]);
    }
    const plan = createNativeCleanupPlan({
      host: "claude",
      sourceType: "owned_marketplace_registration",
      safePath: USER_PLUGIN_SAFE_PATH,
      capability,
      argv: ["claude", "plugin", "marketplace", "remove", OWNED_MARKETPLACE, "--scope", nativeScope],
      scope: `marketplace:${nativeScope}:${OWNED_MARKETPLACE}`,
      timeoutMs: CLAUDE_TIMEOUT_MS,
    });
    return createSourceScanResult(mode, [
      ...findings,
      claudeFindingWithPlan(plan, "owned_marketplace_source", sourceScope),
    ], [plan]);
  }
  return createSourceScanResult(mode, findings);
}

function claudeStatus(context: HostStatusContext) {
  const issue = context.observation.issues?.[0];
  if (issue !== undefined) {
    return createStatusResult({
      status: issue.code === "managed_content_changed" ? "drifted" : "invalid",
      host: "claude",
      issues: [issue],
    });
  }
  const legacy = details(context.observation).legacyState;
  if (legacy !== undefined) {
    return createStatusResult({
      status: "update_available",
      host: "claude",
      environment: legacy.environment,
      issues: [{ code: "legacy_migration_available", path: STATE_PATH }],
    });
  }
  const state = context.observation.currentState;
  if (state === undefined) {
    const root = validateManagedPath(context.target, STATE_PATH, MANAGED_ROOTS);
    if (fs.existsSync(path.dirname(root.absolutePath))) {
      return createStatusResult({
        status: "invalid",
        host: "claude",
        issues: [{ code: "orphaned_managed_root", path: ".claude/kcoderag-nav" }],
      });
    }
    return createStatusResult({ host: "claude" });
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
      host: "claude",
      environment: state.environment,
      issues: updateAvailable ? [{ code: "source_update_available", path: ".claude/kcoderag-nav" }] : [],
    });
  } catch (error) {
    return createStatusResult({
      status: "invalid",
      host: "claude",
      environment: state.environment,
      issues: [issueFrom(error)],
    });
  }
}

export function createClaudeAdapter(options: ClaudeAdapterOptions = {}): HostAdapter {
  const runner = options.runner ?? defaultClaudeRunner;
  const userHome = path.resolve(options.homeDirectory ?? os.homedir());
  const claudeRoot = options.homeDirectory === undefined
    ? path.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(userHome, ".claude"))
    : path.join(userHome, ".claude");
  const readUserSources = options.readUserSources ?? defaultClaudeUserSourceReader(claudeRoot, userHome);
  const issuedPlans = new Map<string, NativeCleanupPlan>();

  const scanUserSources = async (context: HostSourceScanContext): Promise<SourceScanResult> => {
    if (context.observation.host !== "claude" || context.observation.target !== context.target) {
      throw new InstallError("invalid_host_adapter");
    }
    const result = await scanClaudeUserSources(context.mode, runner, readUserSources);
    issuedPlans.clear();
    for (const plan of result.cleanupPlans) issuedPlans.set(plan.fingerprint, plan);
    return result;
  };

  const cleanupOwnedSource = async (
    plan: NativeCleanupPlan,
    authority: OwnedCleanupAuthority,
  ): Promise<SourceScanResult> => {
    if (plan.host !== "claude" || issuedPlans.get(plan.fingerprint) !== plan) {
      throw new InstallError("cleanup_fingerprint_mismatch");
    }
    issuedPlans.delete(plan.fingerprint);
    await runOwnedSourceCleanup(plan, authority, async (request) => {
      const result = await runner(request);
      return Object.freeze({ exitCode: result.exitCode, timedOut: result.timedOut });
    });
    const result = await scanClaudeUserSources("gate", runner, readUserSources);
    issuedPlans.clear();
    for (const nextPlan of result.cleanupPlans) issuedPlans.set(nextPlan.fingerprint, nextPlan);
    return result;
  };

  return Object.freeze({
    id: "claude" as const,
    managedRoots: MANAGED_ROOTS,
    detect: detectClaude,
    renderInstall,
    renderUninstall,
    status: claudeStatus,
    scanUserSources,
    cleanupOwnedSource,
  });
}

export const claudeAdapter: HostAdapter = createClaudeAdapter();

exports.STATE_PATH = STATE_PATH;
exports.managedPaths = managedPaths;
exports.createClaudeAdapter = createClaudeAdapter;
