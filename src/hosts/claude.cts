/** Claude Code capability projection with exact receipt-gated native pre-write support. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

import { composeCapabilitySet, type ProjectedCapabilityContribution, type ProjectedCapabilityFile, type ProjectedCapabilitySection } from "../capabilities/compose.cjs";
import type { CapabilityId } from "../capabilities/contracts.cjs";
import { getCapabilityProvider, resolveCapabilitySelection } from "../capabilities/registry.cjs";
import { InstallError, type InstallState, type OriginalRecord, type ProjectTarget, type StatusIssue } from "../core/contracts.cjs";
import { normalizeRemoteMcpUrl } from "../core/mcp-endpoint.cjs";
import { hasManagedRootResidue, validateManagedPath } from "../core/project-target.cjs";
import { createStatusResult, parseInstallState } from "../core/state.cjs";
import { evaluateCodeStyleIntegrity } from "../hooks/code-style-nudge.cjs";
import { renderProjectHookCommands } from "../core/project-root.cjs";
import type { HostAdapter, HostInstallContext, HostObservation, HostSourceScanContext, HostStatusContext, HostUninstallContext } from "./host-adapter.cjs";
import {
  createSourceFinding,
  createSourceScanResult,
  inspectNativeDirectory,
  inspectNativeJsonSource,
  inspectNativePath,
  type SourceScanResult,
} from "./user-sources.cjs";

type JsonMap = Record<string, unknown>;

export interface ClaudeUserSourceMetadata {
  readonly activePluginPaths?: readonly string[];
  readonly ownedPluginPaths?: readonly string[];
  readonly ownedMarketplacePaths?: readonly string[];
  readonly rawMcpPaths?: readonly string[];
  readonly manualHookPaths?: readonly string[];
  readonly cachePaths?: readonly string[];
  readonly disabledPaths?: readonly string[];
  readonly ambiguousPaths?: readonly string[];
}

export interface ClaudeAdapterOptions {
  readonly homeDirectory?: string;
  readonly readUserSources?: () => ClaudeUserSourceMetadata | Promise<ClaudeUserSourceMetadata>;
  readonly hostVersion?: string;
  readonly evidenceRoot?: string;
  readonly readHostVersion?: () => string | undefined;
  readonly [key: string]: unknown;
}

interface ClaudeObservationDetails { readonly stateBytes?: Buffer }
interface ProjectionContextExtras {
  readonly selectedCapabilities?: readonly CapabilityId[];
  readonly hostVersion?: string;
  readonly evidenceRoot?: string;
}

const STATE_PATH = ".claude/kcoderag-nav/install-state.json";
const SETTINGS_PATH = ".claude/settings.json";
const MCP_PATH = ".mcp.json";
const NAV_SKILL_PATH = ".claude/skills/kcoderag-nav/SKILL.md";
const CODE_STYLE_SKILL_ROOT = ".claude/skills/code-style-correction";
const HOOK_ROOT = ".claude/kcoderag-nav/qa/hooks";
const MANAGED_ROOTS = Object.freeze([".claude", MCP_PATH] as const);
const NAVIGATION = "kcoderag-navigation" as const;
const CODE_STYLE = "code-style-nudge" as const;

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseJson(bytes: Buffer, code: string, safePath: string): JsonMap {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(value)) throw new Error("not object");
    return value;
  } catch {
    throw new InstallError(code, safePath);
  }
}

function issueFrom(error: unknown): StatusIssue {
  return error instanceof InstallError
    ? { code: error.code, path: error.safePath ?? "." }
    : { code: "invalid", path: "." };
}

function readRegular(target: ProjectTarget, relativePath: string): Buffer | undefined {
  const validated = validateManagedPath(target, relativePath, MANAGED_ROOTS);
  try {
    const metadata = fs.lstatSync(validated.absolutePath);
    if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape", relativePath);
    if (!metadata.isFile()) throw new InstallError("special_file", relativePath);
    return fs.readFileSync(validated.absolutePath);
  } catch (error) {
    if (error instanceof InstallError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new InstallError("unreadable", relativePath);
  }
}

function sourceAsset(packageRoot: string, relativePath: string): Buffer {
  try {
    const absolute = path.resolve(packageRoot, ...relativePath.split("/"));
    const relation = path.relative(path.resolve(packageRoot), absolute);
    if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
      throw new Error("escape");
    }
    const metadata = fs.lstatSync(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("not regular");
    return fs.readFileSync(absolute);
  } catch {
    throw new InstallError("missing_package_asset", relativePath);
  }
}

function packageVersion(packageRoot: string): string {
  const document = parseJson(sourceAsset(packageRoot, "package.json"), "invalid_package", "package.json");
  if (document.name !== "kcoderag-nav" || typeof document.version !== "string" || document.version.length === 0) {
    throw new InstallError("invalid_package", "package.json");
  }
  return document.version;
}

function qaMcpEntry(packageRoot: string): JsonMap {
  const safePath = "kcoderag-qa/.mcp.json";
  const document = parseJson(sourceAsset(packageRoot, safePath), "invalid_mcp_source", safePath);
  const entry = isRecord(document.mcpServers) ? document.mcpServers["kcoderag-qa"] : undefined;
  if (!isRecord(entry) || typeof entry.url !== "string") throw new InstallError("invalid_mcp_source", safePath);
  return Object.freeze({ ...entry, url: normalizeRemoteMcpUrl(entry.url, safePath) });
}

function encodeOriginal(bytes: Buffer | undefined): OriginalRecord {
  return bytes === undefined
    ? Object.freeze({ kind: "absent" as const })
    : Object.freeze({ kind: "base64" as const, data: bytes.toString("base64") });
}

function currentStateBytes(observation: HostObservation): Buffer | undefined {
  const value = (observation.details as ClaudeObservationDetails | undefined)?.stateBytes;
  return value === undefined ? undefined : Buffer.from(value);
}

function verifyStateFiles(target: ProjectTarget, state: InstallState): void {
  if (state.host !== "claude") throw new InstallError("invalid_state", STATE_PATH);
  for (const record of state.files) {
    const current = readRegular(target, record.path);
    if (current === undefined || sha256(current) !== record.digest) {
      throw new InstallError(record.contributors.includes(CODE_STYLE) ? "capability_drift" : "managed_content_changed", record.path);
    }
  }
  if (state.capabilities.some((capability) => capability.id === CODE_STYLE)) {
    const integrity = evaluateCodeStyleIntegrity({ host: "claude", managedRoot: target.root });
    if (!integrity.ok) throw new InstallError("capability_drift", integrity.finding?.path ?? ".");
  }
}

function detectClaude(context: { readonly target: ProjectTarget }): HostObservation {
  let stateBytes: Buffer | undefined;
  try {
    stateBytes = readRegular(context.target, STATE_PATH);
    if (stateBytes === undefined) return Object.freeze({ host: "claude" as const, target: context.target });
    const currentState = parseInstallState(stateBytes);
    verifyStateFiles(context.target, currentState);
    return Object.freeze({
      host: "claude" as const,
      target: context.target,
      currentState,
      details: Object.freeze({ stateBytes: Buffer.from(stateBytes) }),
    });
  } catch (error) {
    return Object.freeze({
      host: "claude" as const,
      target: context.target,
      issues: Object.freeze([issueFrom(error)]),
      details: Object.freeze(stateBytes === undefined ? {} : { stateBytes: Buffer.from(stateBytes) }),
    });
  }
}

function refuseIssues(observation: HostObservation): void {
  const issue = observation.issues?.[0];
  if (issue !== undefined) throw new InstallError(issue.code, issue.path);
}

function selectedForInstall(context: HostInstallContext): readonly CapabilityId[] {
  const extras = context as HostInstallContext & ProjectionContextExtras;
  const requested = extras.selectedCapabilities ?? (context.command === "update"
    ? context.observation.currentState?.capabilities.map((entry) => entry.id)
    : [NAVIGATION]);
  if (requested === undefined) throw new InstallError("not_installed", STATE_PATH);
  const existing = context.observation.currentState?.capabilities.map((entry) => entry.id) ?? [];
  return Object.freeze(resolveCapabilitySelection([...existing, ...requested]).map((entry) => entry.id));
}

function preservedForUpdate(context: HostInstallContext, selected: readonly CapabilityId[]): readonly CapabilityId[] {
  if (context.command !== "update" || context.observation.currentState === undefined) return Object.freeze([]);
  const projected = new Set(context.selectedCapabilities ?? selected);
  return Object.freeze(selected.filter((id) => !projected.has(id)));
}

function selectedAfterUninstall(context: HostUninstallContext): readonly CapabilityId[] {
  const state = context.observation.currentState;
  if (state === undefined) throw new InstallError("not_installed", STATE_PATH);
  const removals = (context as HostUninstallContext & ProjectionContextExtras).selectedCapabilities;
  if (removals === undefined) return Object.freeze([]);
  const remove = new Set(resolveCapabilitySelection(removals).map((entry) => entry.id));
  return Object.freeze(state.capabilities.map((entry) => entry.id).filter((id) => !remove.has(id)));
}

export function parseClaudeVersionOutput(output: string): string | undefined {
  if (output.length > 128) return undefined;
  const match = /^(?:(?:claude(?: code)?\s+)?(\d+\.\d+\.\d+)|(\d+\.\d+\.\d+) \(Claude Code\))\r?\n?$/iu.exec(output);
  return match?.[1] ?? match?.[2];
}

function defaultClaudeVersion(): string | undefined {
  try {
    const result = childProcess.spawnSync("claude", ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 8_192,
      windowsHide: true,
    });
    if (result.error !== undefined || result.status !== 0 || typeof result.stdout !== "string") return undefined;
    return parseClaudeVersionOutput(result.stdout);
  } catch {
    return undefined;
  }
}

function assertSupport(
  selected: readonly CapabilityId[],
  context: HostInstallContext | HostUninstallContext,
  options: ClaudeAdapterOptions,
): void {
  if (!selected.includes(CODE_STYLE)) return;
  const extras = context as (HostInstallContext | HostUninstallContext) & ProjectionContextExtras;
  const hostVersion = extras.hostVersion ?? options.hostVersion ?? options.readHostVersion?.() ?? defaultClaudeVersion();
  if (hostVersion === undefined) throw new InstallError("host_version_unsupported");
  const decision = getCapabilityProvider(CODE_STYLE).evaluateSupport({
    host: "claude",
    hostVersion,
    evidenceRoot: extras.evidenceRoot ?? options.evidenceRoot ?? context.packageRoot,
  });
  if (!decision.eligible) throw new InstallError(decision.code);
}

function managedHookEntry(
  packageRoot: string,
  selected: readonly CapabilityId[],
): { readonly start?: unknown; readonly pre?: unknown; readonly post?: unknown } {
  const template = parseJson(sourceAsset(packageRoot, "kcoderag-qa/hooks/hooks.json"), "invalid_package", "kcoderag-qa/hooks/hooks.json");
  const commands = renderProjectHookCommands("claude");
  const markerCommands = renderProjectHookCommands("claude", "mcp-call-marker");
  const hooks = isRecord(template.hooks) ? template.hooks : {};
  const renderEntry = (value: unknown, renderedCommands: { readonly command: string; readonly commandWindows: string }): unknown => {
    const copy = JSON.parse(JSON.stringify(value)) as unknown;
    if (!isRecord(copy) || !Array.isArray(copy.hooks) || !isRecord(copy.hooks[0])) {
      throw new InstallError("invalid_package", "kcoderag-qa/hooks/hooks.json");
    }
    copy.hooks[0].command = renderedCommands.command;
    copy.hooks[0].commandWindows = renderedCommands.commandWindows;
    return copy;
  };
  const startTemplate = Array.isArray(hooks.SessionStart)
    ? hooks.SessionStart[0]
    : Array.isArray(hooks.PreToolUse)
      ? hooks.PreToolUse[0]
      : undefined;
  const start = startTemplate === undefined ? undefined : renderEntry(startTemplate, commands);
  if (isRecord(start)) start.matcher = "^(startup|resume|clear|compact)$";
  return Object.freeze({
    ...(!selected.includes(NAVIGATION) || start === undefined ? {} : { start }),
    ...(selected.length === 0 || !Array.isArray(hooks.PreToolUse)
      ? {}
      : { pre: renderEntry(hooks.PreToolUse[0], commands) }),
    ...(!selected.includes(NAVIGATION) || !Array.isArray(hooks.PostToolUse)
      ? {}
      : { post: renderEntry(hooks.PostToolUse[0], markerCommands) }),
  });
}

function mergeHookSettings(
  current: Buffer | undefined,
  packageRoot: string,
  selected: readonly CapabilityId[],
  owned: boolean,
): { readonly bytes: Buffer; readonly start?: unknown; readonly pre?: unknown; readonly post?: unknown } {
  const document = current === undefined ? {} : parseJson(current, "invalid_json", SETTINGS_PATH);
  const hooks = document.hooks === undefined ? {} : document.hooks;
  if (!isRecord(hooks)) throw new InstallError("invalid_json", SETTINGS_PATH);
  const entries = managedHookEntry(packageRoot, selected);
  for (const event of ["SessionStart", "PreToolUse", "PostToolUse"] as const) {
    const currentEntries = hooks[event] === undefined ? [] : hooks[event];
    if (!Array.isArray(currentEntries)) throw new InstallError("invalid_json", SETTINGS_PATH);
    const unrelated = currentEntries.filter((entry) => !JSON.stringify(entry).includes("kcoderag-nav"));
    const hadManaged = unrelated.length !== currentEntries.length;
    if (!owned && hadManaged) throw new InstallError("unmanaged_name_conflict", SETTINGS_PATH);
    const managed = event === "SessionStart"
      ? entries.start
      : event === "PreToolUse"
        ? entries.pre
        : entries.post;
    if (managed === undefined) {
      if (unrelated.length === 0) delete hooks[event];
      else hooks[event] = unrelated;
    } else {
      hooks[event] = [...unrelated, managed];
    }
  }
  if (Object.keys(hooks).length === 0) delete document.hooks;
  else document.hooks = hooks;
  return Object.freeze({
    bytes: canonicalJson(document),
    ...(entries.start === undefined ? {} : { start: entries.start }),
    ...(entries.pre === undefined ? {} : { pre: entries.pre }),
    ...(entries.post === undefined ? {} : { post: entries.post }),
  });
}

function mergeMcp(current: Buffer | undefined, packageRoot: string, owned: boolean): { readonly bytes: Buffer; readonly entry: JsonMap } {
  const document = current === undefined ? {} : parseJson(current, "invalid_json", MCP_PATH);
  const servers = document.mcpServers === undefined ? {} : document.mcpServers;
  if (!isRecord(servers)) throw new InstallError("invalid_json", MCP_PATH);
  if (!owned && servers["kcoderag-qa"] !== undefined) throw new InstallError("unmanaged_name_conflict", MCP_PATH);
  const entry = qaMcpEntry(packageRoot);
  servers["kcoderag-qa"] = entry;
  document.mcpServers = servers;
  return Object.freeze({ bytes: canonicalJson(document), entry });
}

function previousFile(state: InstallState | undefined, relativePath: string) {
  return state?.files.find((record) => record.path === relativePath);
}

function projectedFile(
  target: ProjectTarget,
  state: InstallState | undefined,
  relativePath: string,
  content: Buffer,
  shared: boolean,
  allowExisting = false,
): ProjectedCapabilityFile {
  const previous = previousFile(state, relativePath);
  if (previous !== undefined) return Object.freeze({ relativePath, expectedDigest: previous.digest, content, shared });
  const current = readRegular(target, relativePath);
  if (current !== undefined && !allowExisting) throw new InstallError("unmanaged_name_conflict", relativePath);
  return Object.freeze({ relativePath, expectedDigest: current === undefined ? null : sha256(current), content, original: encodeOriginal(current), shared });
}

function section(relativePath: string, id: string, value: unknown, fileExisted: boolean, shared: boolean): ProjectedCapabilitySection {
  return Object.freeze({ relativePath, id, digest: sha256(JSON.stringify(value)), fileExisted, shared });
}

const NAV_RUNTIME = Object.freeze([
  ["dist/hooks/feedback-nudge.cjs", "feedback-nudge.cjs"],
  ["dist/hooks/grep-nudge.cjs", "grep-nudge.cjs"],
  ["dist/hooks/update-check.cjs", "update-check.cjs"],
  ["dist/hooks/update-notice.cjs", "update-notice.cjs"],
  ["dist/hooks/update-worker.cjs", "update-worker.cjs"],
  ["dist/hooks/mcp-call-marker.cjs", "mcp-call-marker.cjs"],
  ["kcoderag-qa/hooks/run_marker.cmd", "run_marker.cmd"],
  ["kcoderag-qa/hooks/run_marker.sh", "run_marker.sh"],
  // The canonical launcher imports the composed dispatcher even in navigation-only installs.
  ["dist/hooks/pre-tool-dispatcher.cjs", "pre-tool-dispatcher.cjs"],
  ["dist/hooks/code-style-nudge.cjs", "code-style-nudge.cjs"],
  ["dist/hooks/once-marker.cjs", "once-marker.cjs"],
  ["kcoderag-qa/hooks/run_hook.cmd", "run_hook.cmd"],
  ["kcoderag-qa/hooks/run_hook.sh", "run_hook.sh"],
] as const);
const CODE_STYLE_REFERENCES = Object.freeze([
  "cpp-lifetime-control-flow.md",
  "protocol-serialization-data.md",
  "lua-contracts.md",
  "change-hygiene-self-review.md",
] as const);

function projectContributions(
  target: ProjectTarget,
  packageRoot: string,
  selected: readonly CapabilityId[],
  projected: readonly CapabilityId[],
  state: InstallState | undefined,
): readonly ProjectedCapabilityContribution[] {
  const settingsCurrent = readRegular(target, SETTINGS_PATH);
  const settings = mergeHookSettings(settingsCurrent, packageRoot, selected, state !== undefined);
  const contributions: ProjectedCapabilityContribution[] = [];
  if (projected.includes(NAVIGATION)) {
    const mcpCurrent = readRegular(target, MCP_PATH);
    const mcpOwned = previousFile(state, MCP_PATH) !== undefined;
    const mcp = mergeMcp(mcpCurrent, packageRoot, mcpOwned);
    const files: ProjectedCapabilityFile[] = [
      projectedFile(target, state, MCP_PATH, mcp.bytes, true, true),
      projectedFile(target, state, SETTINGS_PATH, settings.bytes, true, true),
      projectedFile(target, state, NAV_SKILL_PATH, sourceAsset(packageRoot, "kcoderag-qa/skills/code-lookup-discipline/SKILL.md"), false),
      ...NAV_RUNTIME.map(([source, name]) => projectedFile(target, state, `${HOOK_ROOT}/${name}`, sourceAsset(packageRoot, source), true)),
    ];
    contributions.push(Object.freeze({
      capabilityId: NAVIGATION,
      files: Object.freeze(files),
      sections: Object.freeze([
        section(MCP_PATH, "navigation:mcp", mcp.entry, mcpCurrent !== undefined, true),
        section(SETTINGS_PATH, "navigation:session-start", settings.start, settingsCurrent !== undefined, true),
        section(SETTINGS_PATH, "navigation:pre-tool", settings.pre, settingsCurrent !== undefined, true),
        section(SETTINGS_PATH, "navigation:post-tool", settings.post, settingsCurrent !== undefined, true),
      ]),
    }));
  }
  if (projected.includes(CODE_STYLE)) {
    const files: ProjectedCapabilityFile[] = [
      projectedFile(target, state, SETTINGS_PATH, settings.bytes, true, true),
      projectedFile(target, state, `${CODE_STYLE_SKILL_ROOT}/SKILL.md`, sourceAsset(packageRoot, "plugin-src/capabilities/code-style-nudge/skill/SKILL.md"), false),
      ...CODE_STYLE_REFERENCES.map((name) => projectedFile(target, state, `${CODE_STYLE_SKILL_ROOT}/references/${name}`, sourceAsset(packageRoot, `plugin-src/capabilities/code-style-nudge/skill/references/${name}`), false)),
      projectedFile(target, state, `${HOOK_ROOT}/code-style-nudge.cjs`, sourceAsset(packageRoot, "dist/hooks/code-style-nudge.cjs"), true),
      projectedFile(target, state, `${HOOK_ROOT}/pre-tool-dispatcher.cjs`, sourceAsset(packageRoot, "dist/hooks/pre-tool-dispatcher.cjs"), true),
      projectedFile(target, state, `${HOOK_ROOT}/once-marker.cjs`, sourceAsset(packageRoot, "dist/hooks/once-marker.cjs"), true),
      projectedFile(target, state, `${HOOK_ROOT}/run_hook.cmd`, sourceAsset(packageRoot, "kcoderag-qa/hooks/run_hook.cmd"), true),
      projectedFile(target, state, `${HOOK_ROOT}/run_hook.sh`, sourceAsset(packageRoot, "kcoderag-qa/hooks/run_hook.sh"), true),
    ];
    contributions.push(Object.freeze({
      capabilityId: CODE_STYLE,
      files: Object.freeze(files),
      sections: Object.freeze([section(SETTINGS_PATH, "code-style:pre-tool", settings.pre, settingsCurrent !== undefined, true)]),
    }));
  }
  return Object.freeze(contributions);
}

function compose(
  context: HostInstallContext | HostUninstallContext,
  selected: readonly CapabilityId[],
  preserved: readonly CapabilityId[] = [],
): ReturnType<typeof composeCapabilitySet> {
  const state = context.observation.currentState;
  const stateBytes = currentStateBytes(context.observation);
  const projected = selected.filter((id) => !preserved.includes(id));
  const reconciled = preserved.length === 0
    ? Object.freeze([])
    : projectContributions(context.target, context.packageRoot, selected, preserved, state);
  return composeCapabilitySet({
    host: "claude",
    target: context.target,
    packageVersion: packageVersion(context.packageRoot),
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    stateExpectedDigest: stateBytes === undefined ? null : sha256(stateBytes),
    selectedCapabilities: selected,
    preservedCapabilities: preserved,
    contributions: projectContributions(context.target, context.packageRoot, selected, projected, state),
    reconciledContributions: reconciled,
    ...(state === undefined ? {} : { previousState: state }),
  });
}

function claudeStatus(context: HostStatusContext) {
  const issue = context.observation.issues?.[0];
  if (issue !== undefined) {
    return createStatusResult({ status: issue.code === "capability_drift" || issue.code === "managed_content_changed" ? "drifted" : "invalid", host: "claude", issues: [issue] });
  }
  if (context.observation.currentState !== undefined) return createStatusResult({ status: "healthy", host: "claude" });
  const root = validateManagedPath(context.target, STATE_PATH, MANAGED_ROOTS);
  return hasManagedRootResidue(path.dirname(root.absolutePath))
    ? createStatusResult({ status: "invalid", host: "claude", issues: [{ code: "orphaned_managed_root", path: ".claude/kcoderag-nav" }] })
    : createStatusResult({ host: "claude" });
}

function defaultMetadata(homeDirectory: string): ClaudeUserSourceMetadata {
  const activePluginPaths: string[] = [];
  const rawMcpPaths: string[] = [];
  const manualHookPaths: string[] = [];
  const ambiguousPaths: string[] = [];
  for (const relativePath of [".claude.json", ".claude/settings.json"] as const) {
    const inspection = inspectNativeJsonSource(homeDirectory, relativePath);
    if (inspection.rawMcp) rawMcpPaths.push(relativePath);
    if (inspection.manualHook) manualHookPaths.push(relativePath);
    if (inspection.activePlugin) activePluginPaths.push(relativePath);
    if (inspection.ambiguous) ambiguousPaths.push(relativePath);
  }
  const inventoryPath = ".claude/plugins/installed_plugins.json";
  const inventory = inspectNativeJsonSource(homeDirectory, inventoryPath, { wholeDocumentIsPluginInventory: true });
  if (inventory.activePlugin) activePluginPaths.push(inventoryPath);
  if (inventory.ambiguous) ambiguousPaths.push(inventoryPath);
  const hooks = inspectNativeDirectory(homeDirectory, ".claude/hooks");
  manualHookPaths.push(...hooks.matches);
  if (hooks.ambiguous) ambiguousPaths.push(".claude/hooks");
  for (const relativePath of [".claude/plugins/kcoderag-nav", ".claude/plugins/cache/kcoderag-nav", ".claude/skills/kcoderag-nav/SKILL.md"]) {
    const inspection = inspectNativePath(homeDirectory, relativePath);
    if (inspection !== "absent") ambiguousPaths.push(relativePath);
  }
  return Object.freeze({
    activePluginPaths: Object.freeze([...new Set(activePluginPaths)].sort()),
    rawMcpPaths: Object.freeze([...new Set(rawMcpPaths)].sort()),
    manualHookPaths: Object.freeze([...new Set(manualHookPaths)].sort()),
    ambiguousPaths: Object.freeze([...new Set(ambiguousPaths)].sort()),
  });
}

function values(metadata: ClaudeUserSourceMetadata, key: keyof ClaudeUserSourceMetadata): readonly string[] {
  const value = metadata[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

async function scanClaudeSources(context: HostSourceScanContext, reader: () => ClaudeUserSourceMetadata | Promise<ClaudeUserSourceMetadata>): Promise<SourceScanResult> {
  let metadata: ClaudeUserSourceMetadata;
  try { metadata = await reader(); } catch { metadata = { ambiguousPaths: [".claude/plugins"] }; }
  const findings = [
    ...values(metadata, "activePluginPaths").map((safePath) => createSourceFinding({ code: "active_plugin_source", severity: "conflict", sourceType: "active_plugin", scope: "user", safePath })),
    ...values(metadata, "ownedPluginPaths").map((safePath) => createSourceFinding({ code: "owned_plugin_source", severity: "conflict", sourceType: "owned_plugin", scope: "user", safePath })),
    ...values(metadata, "ownedMarketplacePaths").map((safePath) => createSourceFinding({ code: "owned_marketplace_source", severity: "conflict", sourceType: "owned_marketplace_registration", scope: "user", safePath })),
    ...values(metadata, "rawMcpPaths").map((safePath) => createSourceFinding({ code: "raw_mcp_source", severity: "conflict", sourceType: "raw_mcp", scope: "user", safePath })),
    ...values(metadata, "manualHookPaths").map((safePath) => createSourceFinding({ code: "manual_hook_source", severity: "conflict", sourceType: "manual_hook", scope: "user", safePath })),
    ...values(metadata, "ambiguousPaths").map((safePath) => createSourceFinding({ code: "ambiguous_source", severity: "conflict", sourceType: "ambiguous", scope: "user", safePath })),
  ];
  if (context.mode !== "fast") {
    findings.push(
      ...values(metadata, "cachePaths").map((safePath) => createSourceFinding({ code: "cache_residue", severity: "info", sourceType: "cache_residue", scope: "user", safePath })),
      ...values(metadata, "disabledPaths").map((safePath) => createSourceFinding({ code: "disabled_source", severity: "info", sourceType: "disabled_registration", scope: "user", safePath })),
    );
  }
  return createSourceScanResult(context.mode, findings);
}

export function createClaudeAdapter(options: ClaudeAdapterOptions = {}): HostAdapter {
  const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
  const reader = options.readUserSources ?? (() => defaultMetadata(homeDirectory));
  return Object.freeze({
    id: "claude" as const,
    managedRoots: MANAGED_ROOTS,
    detect: detectClaude,
    renderInstall: (context: HostInstallContext) => {
      refuseIssues(context.observation);
      if (context.command === "update" && context.observation.currentState === undefined) throw new InstallError("not_installed", STATE_PATH);
      const selected = selectedForInstall(context);
      assertSupport(selected, context, options);
      return compose(context, selected, preservedForUpdate(context, selected));
    },
    renderUninstall: (context: HostUninstallContext) => {
      refuseIssues(context.observation);
      const selected = selectedAfterUninstall(context);
      assertSupport(selected, context, options);
      return compose(context, selected);
    },
    status: claudeStatus,
    scanUserSources: (context: HostSourceScanContext) => scanClaudeSources(context, reader),
  });
}

export const claudeAdapter: HostAdapter = createClaudeAdapter();

exports.STATE_PATH = STATE_PATH;
exports.managedPaths = () => Object.freeze([STATE_PATH]);
exports.createClaudeAdapter = createClaudeAdapter;
exports.parseClaudeVersionOutput = parseClaudeVersionOutput;
