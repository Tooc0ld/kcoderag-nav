/** Claude Code project-native adapter with narrow JSON section and file ownership. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

import {
  CORE_SCHEMA_VERSION,
  InstallError,
  type DesiredState,
  type EnvironmentId,
  type InstallState,
  type ManagedSectionRecord,
  type OriginalRecord,
  type ProjectTarget,
  type StatusIssue,
} from "../core/contracts.cjs";
import { validateManagedPath } from "../core/project-target.cjs";
import { createDesiredState, createStatusResult, parseInstallState } from "../core/state.cjs";
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

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function packageName(environment: EnvironmentId): string {
  return `kcoderag-${environment}`;
}

function hookPrefix(environment: EnvironmentId): string {
  return `.claude/kcoderag-nav/${environment}/hooks`;
}

function managedPaths(environment: EnvironmentId): readonly string[] {
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
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(value)) throw new Error("not_object");
    return value;
  } catch {
    throw new InstallError(code, safePath);
  }
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderJsonLike(original: Buffer | undefined, value: unknown): Buffer {
  if (original === undefined) return canonicalJson(value);
  const text = original.toString("utf8");
  const indentMatch = /(?:^|\r?\n)([ \t]+)"/.exec(text);
  const indent = indentMatch?.[1]?.includes("\t")
    ? "\t"
    : Math.max(0, indentMatch?.[1]?.length ?? (text.includes("\n") ? 2 : 0));
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const rendered = JSON.stringify(value, null, indent).replaceAll("\n", eol);
  return Buffer.from(text.endsWith("\n") ? `${rendered}${eol}` : rendered, "utf8");
}

function sectionDigest(value: unknown): string {
  return sha256(Buffer.from(JSON.stringify(value), "utf8"));
}

function sectionRecord(id: string, value: unknown, fileExisted: boolean): ManagedSectionRecord {
  return { id, digest: sectionDigest(value), fileExisted };
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

function readMcpServer(packageRoot: string, environment: EnvironmentId): {
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
  environment: EnvironmentId,
  owned: ManagedSectionRecord | undefined,
  allowLegacyOwned: boolean,
  fileExisted: boolean,
): { readonly bytes: Buffer; readonly section: ManagedSectionRecord } {
  const document = current === undefined
    ? { mcpServers: {} as JsonMap }
    : parseJsonBytes(current, "invalid_json", MCP_PATH);
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
  } else if (currentName !== undefined) {
    delete document.mcpServers[currentName];
  }
  const source = readMcpServer(packageRoot, environment);
  document.mcpServers[source.name] = source.entry;
  return {
    bytes: renderJsonLike(current, document),
    section: sectionRecord(`mcpServers.${source.name}`, source.entry, fileExisted),
  };
}

function managedHook(environment: EnvironmentId): JsonMap {
  const prefix = hookPrefix(environment);
  return {
    matcher: "^(Grep|Glob|Bash)$",
    hooks: [{
      type: "command",
      command: `sh \"${prefix}/run_hook.sh\"`,
      commandWindows: `call \"${prefix.replaceAll("/", "\\\\")}\\\\run_hook.cmd\"`,
      timeout: 5,
      statusMessage: `Checking code lookup strategy (KCodeRag ${environment.toUpperCase()})`,
      additionalContextLimit: 600,
    }],
  };
}

function hookEnvironment(entry: unknown): EnvironmentId | undefined {
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
  environment: EnvironmentId,
  owned: ManagedSectionRecord | undefined,
  allowLegacyOwned: boolean,
  fileExisted: boolean,
): { readonly bytes: Buffer; readonly section: ManagedSectionRecord } {
  const document = current === undefined
    ? {}
    : parseJsonBytes(current, "invalid_json", SETTINGS_PATH);
  if (document.hooks === undefined) document.hooks = {};
  if (!isRecord(document.hooks)) throw new InstallError("invalid_json", SETTINGS_PATH);
  const hooks = document.hooks;
  if (hooks.PreToolUse === undefined) hooks.PreToolUse = [];
  if (!Array.isArray(hooks.PreToolUse) || !hooks.PreToolUse.every(isRecord)) {
    throw new InstallError("invalid_json", SETTINGS_PATH);
  }
  const ownedIndexes = hooks.PreToolUse
    .map((entry, index) => ({ index, environment: hookEnvironment(entry) }))
    .filter((entry) => entry.environment !== undefined);
  if (owned !== undefined) {
    const expectedEnvironment = owned.id.split(".").at(-1);
    const matched = ownedIndexes.filter((entry) => entry.environment === expectedEnvironment);
    if (matched.length !== 1) throw new InstallError("managed_content_changed", SETTINGS_PATH);
    const index = matched[0]?.index;
    if (index === undefined) throw new InstallError("managed_content_changed", SETTINGS_PATH);
    verifySection(owned, `hooks.PreToolUse.kcoderag-nav.${expectedEnvironment}`, hooks.PreToolUse[index], SETTINGS_PATH);
    hooks.PreToolUse.splice(index, 1);
  } else if (allowLegacyOwned) {
    for (const entry of [...ownedIndexes].sort((left, right) => right.index - left.index)) {
      hooks.PreToolUse.splice(entry.index, 1);
    }
  } else if (ownedIndexes.length > 0 || JSON.stringify(document).includes("Checking code lookup strategy (KCodeRag")) {
    throw new InstallError("unmanaged_name_conflict", SETTINGS_PATH);
  }
  const entry = managedHook(environment);
  hooks.PreToolUse.push(entry);
  return {
    bytes: renderJsonLike(current, document),
    section: sectionRecord(`hooks.PreToolUse.kcoderag-nav.${environment}`, entry, fileExisted),
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
    Object.keys(state.digests).sort().join("\0") !== [...owned].sort().join("\0") ||
    (secureState && Object.keys(state.sections ?? {}).sort().join("\0") !== [...SHARED_PATHS].sort().join("\0"))
  ) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  return state;
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
  try {
    const state = validateCurrentState(parseInstallState(stateBytes));
    for (const [relativePath, digest] of Object.entries(state.digests)) {
      const current = readManagedOptional(context.target, relativePath);
      if (current === undefined || sha256(current) !== digest) {
        throw new InstallError("managed_content_changed", relativePath);
      }
    }
    return Object.freeze({
      host: "claude" as const,
      target: context.target,
      currentState: state,
      details: Object.freeze({ stateBytes: Buffer.from(stateBytes) } satisfies ClaudeObservationDetails),
    });
  } catch (error) {
    return Object.freeze({
      host: "claude" as const,
      target: context.target,
      issues: Object.freeze([issueFrom(error)]),
      details: Object.freeze({ stateBytes: Buffer.from(stateBytes) } satisfies ClaudeObservationDetails),
    });
  }
}

function refuseIssues(observation: HostObservation): void {
  const issue = observation.issues?.[0];
  if (issue !== undefined) throw new InstallError(issue.code, issue.path);
}

function captureOriginals(target: ProjectTarget, environment: EnvironmentId): Record<string, OriginalRecord> {
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
  if (state !== undefined) return state.digests[relativePath] ?? null;
  const current = readManagedOptional(target, relativePath);
  return current === undefined ? null : sha256(current);
}

function desiredPayloads(
  context: HostInstallContext,
): { readonly payloads: Map<string, Buffer>; readonly sections: Record<string, ManagedSectionRecord> } {
  const name = packageName(context.environment);
  const existing = context.observation.currentState;
  const currentMcp = readManagedOptional(context.target, MCP_PATH);
  const currentSettings = readManagedOptional(context.target, SETTINGS_PATH);
  const legacyState = existing !== undefined && existing.sections === undefined;
  const mcp = renderMcp(
    currentMcp,
    context.packageRoot,
    context.environment,
    existing?.sections?.[MCP_PATH],
    legacyState,
    existing?.sections?.[MCP_PATH]?.fileExisted ??
      (legacyState ? existing?.originals[MCP_PATH]?.kind !== "absent" : currentMcp !== undefined),
  );
  const settings = renderSettings(
    currentSettings,
    context.environment,
    existing?.sections?.[SETTINGS_PATH],
    legacyState,
    existing?.sections?.[SETTINGS_PATH]?.fileExisted ??
      (legacyState ? existing?.originals[SETTINGS_PATH]?.kind !== "absent" : currentSettings !== undefined),
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

function renderInstall(context: HostInstallContext): DesiredState {
  refuseIssues(context.observation);
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
  for (const [relativePath, bytes] of payloads) digests[relativePath] = sha256(bytes);
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
  state: InstallState,
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
  if (Object.keys(mcpDocument.mcpServers).length === 0) delete mcpDocument.mcpServers;
  result.set(
    MCP_PATH,
    !mcpRecord.fileExisted && Object.keys(mcpDocument).length === 0
      ? null
      : renderJsonLike(currentMcp, mcpDocument),
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
  if (settingsDocument.hooks.PreToolUse.length === 0) delete settingsDocument.hooks.PreToolUse;
  if (Object.keys(settingsDocument.hooks).length === 0) delete settingsDocument.hooks;
  result.set(
    SETTINGS_PATH,
    !settingsRecord.fileExisted && Object.keys(settingsDocument).length === 0
      ? null
      : renderJsonLike(currentSettings, settingsDocument),
  );
  return result;
}

function renderUninstall(context: HostUninstallContext): DesiredState {
  refuseIssues(context.observation);
  const state = context.observation.currentState;
  const stateBytes = details(context.observation).stateBytes;
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
      expectedDigest: relativePath === STATE_PATH ? sha256(stateBytes) : state.digests[relativePath] ?? null,
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
