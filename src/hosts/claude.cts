/** Claude Code project-native adapter with narrow JSON section and file ownership. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
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
  HostStatusContext,
  HostUninstallContext,
} from "./host-adapter.cjs";

type JsonMap = Record<string, unknown>;

interface ClaudeObservationDetails {
  readonly stateBytes?: Buffer;
  readonly legacyState?: LegacyInstallState;
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

export const claudeAdapter: HostAdapter = Object.freeze({
  id: "claude",
  managedRoots: MANAGED_ROOTS,
  detect: detectClaude,
  renderInstall,
  renderUninstall,
  status: claudeStatus,
});

exports.STATE_PATH = STATE_PATH;
exports.managedPaths = managedPaths;
