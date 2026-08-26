/** OpenCode project capability projection with JSON/JSONC ambiguity and evidence gates. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

import { composeCapabilitySet, type ProjectedCapabilityContribution, type ProjectedCapabilityFile, type ProjectedCapabilitySection } from "../capabilities/compose.cjs";
import type { CapabilityId } from "../capabilities/contracts.cjs";
import { getCapabilityProvider, resolveCapabilitySelection } from "../capabilities/registry.cjs";
import { InstallError, type InstallState, type OriginalRecord, type ProjectTarget, type StatusIssue } from "../core/contracts.cjs";
import { parseJsoncObject, upsertJsonObjectProperty } from "../core/json-splice.cjs";
import { hasManagedRootResidue, validateManagedPath } from "../core/project-target.cjs";
import { createStatusResult, parseInstallState } from "../core/state.cjs";
import { evaluateJx3Integrity } from "../hooks/jx3-style-nudge.cjs";
import type { HostAdapter, HostInstallContext, HostObservation, HostSourceScanContext, HostStatusContext, HostUninstallContext } from "./host-adapter.cjs";
import {
  createSourceFinding,
  createSourceScanResult,
  inspectNativeDirectory,
  inspectNativeJsonSource,
  inspectNativePath,
  type NativeJsonSourceInspection,
  type SourceScanResult,
} from "./user-sources.cjs";

type JsonMap = Record<string, unknown>;
export interface OpenCodeUserSourceMetadata { readonly activePluginPaths?: readonly string[]; readonly rawMcpPaths?: readonly string[]; readonly manualHookPaths?: readonly string[]; readonly manualRulePaths?: readonly string[]; readonly cachePaths?: readonly string[]; readonly disabledPaths?: readonly string[]; readonly ambiguousPaths?: readonly string[] }
export interface OpenCodeAdapterOptions { readonly homeDirectory?: string; readonly readUserSources?: () => OpenCodeUserSourceMetadata | Promise<OpenCodeUserSourceMetadata>; readonly hostVersion?: string; readonly evidenceRoot?: string; readonly readHostVersion?: () => string | undefined; readonly [key: string]: unknown }
interface Extras { readonly selectedCapabilities?: readonly CapabilityId[]; readonly hostVersion?: string; readonly evidenceRoot?: string }
interface Details { readonly stateBytes?: Buffer; readonly configPath?: ConfigPath }
const STATE_PATH = ".opencode/kcoderag-nav/install-state.json";
const PLUGIN_PATH = ".opencode/plugins/kcoderag-nav.js";
const NAV_SKILL_PATH = ".opencode/skills/kcoderag-nav/SKILL.md";
const JX3_SKILL_ROOT = ".opencode/skills/jx3-code-style-correction";
const HOOK_ROOT = ".opencode/kcoderag-nav/hooks";
const CONFIG_CANDIDATES = Object.freeze(["opencode.json", "opencode.jsonc"] as const);
type ConfigPath = (typeof CONFIG_CANDIDATES)[number];
const MANAGED_ROOTS = Object.freeze([".opencode", ...CONFIG_CANDIDATES] as const);
const NAVIGATION = "kcoderag-navigation" as const;
const JX3 = "jx3-style-nudge" as const;

function isRecord(value: unknown): value is JsonMap { return typeof value === "object" && value !== null && !Array.isArray(value); }
function sha256(value: Buffer | string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function parseJson(bytes: Buffer, code: string, safePath: string): JsonMap { try { const value: unknown = JSON.parse(bytes.toString("utf8")); if (isRecord(value)) return value; } catch { /* stable refusal below */ } throw new InstallError(code, safePath); }
function issueFrom(error: unknown): StatusIssue { return error instanceof InstallError ? { code: error.code, path: error.safePath ?? "." } : { code: "invalid", path: "." }; }
function readRegular(target: ProjectTarget, relativePath: string): Buffer | undefined {
  const validated = validateManagedPath(target, relativePath, MANAGED_ROOTS);
  try { const metadata = fs.lstatSync(validated.absolutePath); if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape", relativePath); if (!metadata.isFile()) throw new InstallError("special_file", relativePath); return fs.readFileSync(validated.absolutePath); }
  catch (error) { if (error instanceof InstallError) throw error; if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new InstallError("unreadable", relativePath); }
}
function sourceAsset(packageRoot: string, relativePath: string): Buffer {
  try { const root = path.resolve(packageRoot); const absolute = path.resolve(root, ...relativePath.split("/")); const relation = path.relative(root, absolute); if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw new Error("escape"); const metadata = fs.lstatSync(absolute); if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("not regular"); return fs.readFileSync(absolute); }
  catch { throw new InstallError("missing_package_asset", relativePath); }
}
function packageVersion(packageRoot: string): string { const value = parseJson(sourceAsset(packageRoot, "package.json"), "invalid_package", "package.json"); if (value.name !== "kcoderag-nav" || typeof value.version !== "string" || value.version.length === 0) throw new InstallError("invalid_package", "package.json"); return value.version; }
function remoteEntry(packageRoot: string): JsonMap { const safePath = "kcoderag-qa/.mcp.json"; const source = parseJson(sourceAsset(packageRoot, safePath), "invalid_mcp_source", safePath); const raw = isRecord(source.mcpServers) ? source.mcpServers["kcoderag-qa"] : undefined; if (!isRecord(raw) || typeof raw.url !== "string") throw new InstallError("invalid_mcp_source", safePath); const headers = isRecord(raw.headers) ? raw.headers : isRecord(raw.http_headers) ? raw.http_headers : undefined; if (headers === undefined || !Object.values(headers).every((value) => typeof value === "string")) throw new InstallError("invalid_mcp_source", safePath); return { type: "remote", url: raw.url, enabled: true, headers }; }
function encodeOriginal(bytes: Buffer | undefined): OriginalRecord { return bytes === undefined ? Object.freeze({ kind: "absent" as const }) : Object.freeze({ kind: "base64" as const, data: bytes.toString("base64") }); }
function stateBytes(observation: HostObservation): Buffer | undefined { const bytes = (observation.details as Details | undefined)?.stateBytes; return bytes === undefined ? undefined : Buffer.from(bytes); }
function configFromState(state: InstallState): ConfigPath | undefined { const matches = CONFIG_CANDIDATES.filter((candidate) => state.files.some((record) => record.path === candidate)); return matches.length === 1 ? matches[0] : undefined; }
function selectConfig(target: ProjectTarget, state?: InstallState): ConfigPath {
  const existing = CONFIG_CANDIDATES.filter((candidate) => readRegular(target, candidate) !== undefined);
  const owned = state === undefined ? undefined : configFromState(state);
  if (state !== undefined && owned === undefined) throw new InstallError("invalid_state", STATE_PATH);
  if (existing.length > 1 || (owned !== undefined && existing.some((candidate) => candidate !== owned))) throw new InstallError("ambiguous_project_config", ".");
  return owned ?? existing[0] ?? "opencode.json";
}
function verifyState(target: ProjectTarget, state: InstallState): void {
  if (state.host !== "opencode") throw new InstallError("invalid_state", STATE_PATH);
  selectConfig(target, state);
  for (const record of state.files) { const bytes = readRegular(target, record.path); if (bytes === undefined || sha256(bytes) !== record.digest) throw new InstallError(record.contributors.includes(JX3) ? "capability_drift" : "managed_content_changed", record.path); }
  if (state.capabilities.some((entry) => entry.id === JX3)) { const integrity = evaluateJx3Integrity({ host: "opencode", managedRoot: target.root }); if (!integrity.ok) throw new InstallError("capability_drift", integrity.finding?.path ?? "."); }
}
function detectOpenCode(context: { readonly target: ProjectTarget }): HostObservation {
  let bytes: Buffer | undefined;
  try { bytes = readRegular(context.target, STATE_PATH); const currentState = bytes === undefined ? undefined : parseInstallState(bytes); const configPath = selectConfig(context.target, currentState); if (currentState !== undefined) verifyState(context.target, currentState); return Object.freeze({ host: "opencode" as const, target: context.target, ...(currentState === undefined ? {} : { currentState }), details: Object.freeze({ configPath, ...(bytes === undefined ? {} : { stateBytes: Buffer.from(bytes) }) }) }); }
  catch (error) { return Object.freeze({ host: "opencode" as const, target: context.target, issues: Object.freeze([issueFrom(error)]), details: Object.freeze(bytes === undefined ? {} : { stateBytes: Buffer.from(bytes) }) }); }
}
function refuse(observation: HostObservation): void { const issue = observation.issues?.[0]; if (issue !== undefined) throw new InstallError(issue.code, issue.path); }
function selectedInstall(context: HostInstallContext): readonly CapabilityId[] { const request = (context as HostInstallContext & Extras).selectedCapabilities ?? (context.command === "update" ? context.observation.currentState?.capabilities.map((entry) => entry.id) : [NAVIGATION]); if (request === undefined) throw new InstallError("not_installed", STATE_PATH); const existing = context.observation.currentState?.capabilities.map((entry) => entry.id) ?? []; return Object.freeze(resolveCapabilitySelection([...existing, ...request]).map((entry) => entry.id)); }
function selectedUninstall(context: HostUninstallContext): readonly CapabilityId[] { const state = context.observation.currentState; if (state === undefined) throw new InstallError("not_installed", STATE_PATH); const removals = (context as HostUninstallContext & Extras).selectedCapabilities; if (removals === undefined) return Object.freeze([]); const remove = new Set(resolveCapabilitySelection(removals).map((entry) => entry.id)); return Object.freeze(state.capabilities.map((entry) => entry.id).filter((id) => !remove.has(id))); }
function defaultVersion(): string | undefined { try { const result = childProcess.spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 5_000, maxBuffer: 8_192, windowsHide: true }); if (result.error !== undefined || result.status !== 0 || typeof result.stdout !== "string") return undefined; return /^(\d+\.\d+\.\d+)\r?\n?$/u.exec(result.stdout)?.[1]; } catch { return undefined; } }
function assertSupport(selected: readonly CapabilityId[], context: HostInstallContext | HostUninstallContext, options: OpenCodeAdapterOptions): void { if (!selected.includes(JX3)) return; const extras = context as (HostInstallContext | HostUninstallContext) & Extras; const hostVersion = extras.hostVersion ?? options.hostVersion ?? options.readHostVersion?.() ?? defaultVersion(); if (hostVersion === undefined) throw new InstallError("host_version_unsupported"); const decision = getCapabilityProvider(JX3).evaluateSupport({ host: "opencode", hostVersion, evidenceRoot: extras.evidenceRoot ?? options.evidenceRoot ?? context.packageRoot }); if (!decision.eligible) throw new InstallError(decision.code); }

function mergeConfig(current: Buffer | undefined, configPath: ConfigPath, packageRoot: string, selected: readonly CapabilityId[], owned: boolean) {
  const original = current?.toString("utf8") ?? "{}\n";
  let document: JsonMap;
  try { document = parseJsoncObject(original); } catch { throw new InstallError("invalid_json", configPath); }
  const mcp = document.mcp === undefined ? {} : document.mcp; if (!isRecord(mcp)) throw new InstallError("invalid_json", configPath);
  const plugins = document.plugin === undefined ? [] : document.plugin; if (!Array.isArray(plugins) || !plugins.every((entry) => typeof entry === "string")) throw new InstallError("invalid_json", configPath);
  const pluginId = `./${PLUGIN_PATH}`; const hadMcp = mcp["kcoderag-qa"] !== undefined; const hadPlugin = plugins.includes(pluginId);
  if (!owned && (hadMcp || hadPlugin)) throw new InstallError("unmanaged_name_conflict", configPath);
  const unrelatedPlugins = plugins.filter((entry) => entry !== pluginId);
  let text = original; let entry: JsonMap | undefined;
  if (selected.includes(NAVIGATION)) { entry = remoteEntry(packageRoot); text = upsertJsonObjectProperty(text, ["mcp"], "kcoderag-qa", entry); text = upsertJsonObjectProperty(text, [], "plugin", [...unrelatedPlugins, pluginId]); }
  else { text = upsertJsonObjectProperty(text, [], "plugin", unrelatedPlugins); }
  return Object.freeze({ bytes: Buffer.from(text.endsWith("\n") ? text : `${text}\n`, "utf8"), entry, pluginId });
}
function previousFile(state: InstallState | undefined, relativePath: string) { return state?.files.find((record) => record.path === relativePath); }
function projectedFile(target: ProjectTarget, state: InstallState | undefined, relativePath: string, content: Buffer, shared: boolean, allowExisting = false): ProjectedCapabilityFile { const previous = previousFile(state, relativePath); if (previous !== undefined) return Object.freeze({ relativePath, expectedDigest: previous.digest, content, shared }); const current = readRegular(target, relativePath); if (current !== undefined && !allowExisting) throw new InstallError("unmanaged_name_conflict", relativePath); return Object.freeze({ relativePath, expectedDigest: current === undefined ? null : sha256(current), content, original: encodeOriginal(current), shared }); }
function section(relativePath: string, id: string, value: unknown, fileExisted: boolean): ProjectedCapabilitySection { return Object.freeze({ relativePath, id, digest: sha256(JSON.stringify(value)), fileExisted, shared: true }); }
const REFERENCES = Object.freeze(["cpp-lifetime-control-flow.md", "protocol-serialization-data.md", "lua-contracts.md", "change-hygiene-self-review.md"] as const);
function contributions(target: ProjectTarget, packageRoot: string, selected: readonly CapabilityId[], state: InstallState | undefined, configPath: ConfigPath): readonly ProjectedCapabilityContribution[] {
  const result: ProjectedCapabilityContribution[] = []; const currentConfig = readRegular(target, configPath); const config = mergeConfig(currentConfig, configPath, packageRoot, selected, state !== undefined);
  if (selected.includes(NAVIGATION)) result.push(Object.freeze({ capabilityId: NAVIGATION, files: Object.freeze([
    projectedFile(target, state, configPath, config.bytes, true, true), projectedFile(target, state, PLUGIN_PATH, sourceAsset(packageRoot, "kcoderag-qa/opencode/kcoderag-nav.js"), false), projectedFile(target, state, NAV_SKILL_PATH, sourceAsset(packageRoot, "kcoderag-qa/skills/code-lookup-discipline/SKILL.md"), false), projectedFile(target, state, `${HOOK_ROOT}/mcp-call-marker.cjs`, sourceAsset(packageRoot, "dist/hooks/mcp-call-marker.cjs"), false), projectedFile(target, state, `${HOOK_ROOT}/update-check.cjs`, sourceAsset(packageRoot, "dist/hooks/update-check.cjs"), false), projectedFile(target, state, `${HOOK_ROOT}/update-notice.cjs`, sourceAsset(packageRoot, "dist/hooks/update-notice.cjs"), false), projectedFile(target, state, `${HOOK_ROOT}/update-worker.cjs`, sourceAsset(packageRoot, "dist/hooks/update-worker.cjs"), false),
  ]), sections: Object.freeze([section(configPath, "navigation:mcp", config.entry, currentConfig !== undefined), section(configPath, "navigation:post-tool", config.pluginId, currentConfig !== undefined)]) }));
  if (selected.includes(JX3)) result.push(Object.freeze({ capabilityId: JX3, files: Object.freeze([
    projectedFile(target, state, `${JX3_SKILL_ROOT}/SKILL.md`, sourceAsset(packageRoot, "plugin-src/capabilities/jx3-style-nudge/skill/SKILL.md"), false), ...REFERENCES.map((name) => projectedFile(target, state, `${JX3_SKILL_ROOT}/references/${name}`, sourceAsset(packageRoot, `plugin-src/capabilities/jx3-style-nudge/skill/references/${name}`), false)), projectedFile(target, state, `${HOOK_ROOT}/jx3-style-nudge.cjs`, sourceAsset(packageRoot, "dist/hooks/jx3-style-nudge.cjs"), false), projectedFile(target, state, `${HOOK_ROOT}/pre-tool-dispatcher.cjs`, sourceAsset(packageRoot, "dist/hooks/pre-tool-dispatcher.cjs"), false), projectedFile(target, state, `${HOOK_ROOT}/once-marker.cjs`, sourceAsset(packageRoot, "dist/hooks/once-marker.cjs"), false),
  ]), sections: Object.freeze([]) }));
  return Object.freeze(result);
}
function compose(context: HostInstallContext | HostUninstallContext, selected: readonly CapabilityId[]) { const previousState = context.observation.currentState; const bytes = stateBytes(context.observation); const configPath = (context.observation.details as Details | undefined)?.configPath ?? selectConfig(context.target, previousState); return composeCapabilitySet({ host: "opencode", target: context.target, packageVersion: packageVersion(context.packageRoot), managedRoots: MANAGED_ROOTS, statePath: STATE_PATH, stateExpectedDigest: bytes === undefined ? null : sha256(bytes), selectedCapabilities: selected, contributions: contributions(context.target, context.packageRoot, selected, previousState, configPath), ...(previousState === undefined ? {} : { previousState }) }); }
function status(context: HostStatusContext) { const issue = context.observation.issues?.[0]; if (issue !== undefined) return createStatusResult({ status: issue.code === "capability_drift" || issue.code === "managed_content_changed" ? "drifted" : "invalid", host: "opencode", issues: [issue] }); if (context.observation.currentState !== undefined) return createStatusResult({ status: "healthy", host: "opencode" }); const root = validateManagedPath(context.target, STATE_PATH, MANAGED_ROOTS); return hasManagedRootResidue(path.dirname(root.absolutePath)) ? createStatusResult({ status: "invalid", host: "opencode", issues: [{ code: "orphaned_managed_root", path: ".opencode/kcoderag-nav" }] }) : createStatusResult({ host: "opencode" }); }

function defaultMetadata(homeDirectory: string): OpenCodeUserSourceMetadata {
  const activePluginPaths: string[] = [];
  const rawMcpPaths: string[] = [];
  const manualHookPaths: string[] = [];
  const ambiguousPaths: string[] = [];
  const configPaths = [".config/opencode/opencode.json", ".config/opencode/opencode.jsonc"] as const;
  const configs = configPaths.map((relativePath) => [relativePath, inspectNativeJsonSource(homeDirectory, relativePath)] as const);
  const existing = configs.filter(([, inspection]) => inspection.exists);
  if (existing.length > 1) {
    ambiguousPaths.push(...existing.map(([relativePath]) => relativePath));
  } else {
    const selected = existing[0] as readonly [string, NativeJsonSourceInspection] | undefined;
    if (selected !== undefined) {
      const [relativePath, inspection] = selected;
      if (inspection.rawMcp) rawMcpPaths.push(relativePath);
      if (inspection.manualHook) manualHookPaths.push(relativePath);
      if (inspection.activePlugin) activePluginPaths.push(relativePath);
      if (inspection.ambiguous) ambiguousPaths.push(relativePath);
    }
  }
  const plugins = inspectNativeDirectory(homeDirectory, ".config/opencode/plugins");
  activePluginPaths.push(...plugins.matches);
  if (plugins.ambiguous) ambiguousPaths.push(".config/opencode/plugins");
  const hooks = inspectNativeDirectory(homeDirectory, ".config/opencode/hooks");
  manualHookPaths.push(...hooks.matches);
  if (hooks.ambiguous) ambiguousPaths.push(".config/opencode/hooks");
  const skillPath = ".config/opencode/skills/kcoderag-nav/SKILL.md";
  if (inspectNativePath(homeDirectory, skillPath) !== "absent") ambiguousPaths.push(skillPath);
  return Object.freeze({
    activePluginPaths: Object.freeze([...new Set(activePluginPaths)].sort()),
    rawMcpPaths: Object.freeze([...new Set(rawMcpPaths)].sort()),
    manualHookPaths: Object.freeze([...new Set(manualHookPaths)].sort()),
    ambiguousPaths: Object.freeze([...new Set(ambiguousPaths)].sort()),
  });
}
function values(metadata: OpenCodeUserSourceMetadata, key: keyof OpenCodeUserSourceMetadata): readonly string[] { const value = metadata[key]; return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : []; }
async function scanSources(context: HostSourceScanContext, reader: () => OpenCodeUserSourceMetadata | Promise<OpenCodeUserSourceMetadata>): Promise<SourceScanResult> { let metadata: OpenCodeUserSourceMetadata; try { metadata = await reader(); } catch { metadata = { ambiguousPaths: [".config/opencode"] }; } const findings = [
  ...values(metadata, "activePluginPaths").map((safePath) => createSourceFinding({ code: "active_plugin_source", severity: "conflict", sourceType: "active_plugin", scope: "user", safePath })), ...values(metadata, "rawMcpPaths").map((safePath) => createSourceFinding({ code: "raw_mcp_source", severity: "conflict", sourceType: "raw_mcp", scope: "user", safePath })), ...values(metadata, "manualRulePaths").map((safePath) => createSourceFinding({ code: "manual_rule_source", severity: "conflict", sourceType: "manual_rule", scope: "user", safePath })), ...values(metadata, "ambiguousPaths").map((safePath) => createSourceFinding({ code: "ambiguous_source", severity: "conflict", sourceType: "ambiguous", scope: "user", safePath })),
  ...values(metadata, "manualHookPaths").map((safePath) => createSourceFinding({ code: "manual_hook_source", severity: "conflict", sourceType: "manual_hook", scope: "user", safePath })),
]; if (context.mode !== "fast") findings.push(...values(metadata, "cachePaths").map((safePath) => createSourceFinding({ code: "cache_residue", severity: "info", sourceType: "cache_residue", scope: "user", safePath })), ...values(metadata, "disabledPaths").map((safePath) => createSourceFinding({ code: "disabled_source", severity: "info", sourceType: "disabled_registration", scope: "user", safePath }))); return createSourceScanResult(context.mode, findings); }

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions = {}): HostAdapter { const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir()); const reader = options.readUserSources ?? (() => defaultMetadata(homeDirectory)); return Object.freeze({ id: "opencode" as const, managedRoots: MANAGED_ROOTS, detect: detectOpenCode,
  renderInstall: (context: HostInstallContext) => { refuse(context.observation); if (context.command === "update" && context.observation.currentState === undefined) throw new InstallError("not_installed", STATE_PATH); const selected = selectedInstall(context); assertSupport(selected, context, options); return compose(context, selected); }, renderUninstall: (context: HostUninstallContext) => { refuse(context.observation); const selected = selectedUninstall(context); assertSupport(selected, context, options); return compose(context, selected); }, status, scanUserSources: (context: HostSourceScanContext) => scanSources(context, reader) }); }
export const opencodeAdapter: HostAdapter = createOpenCodeAdapter();
exports.STATE_PATH = STATE_PATH;
exports.managedPaths = () => Object.freeze([STATE_PATH]);
exports.createOpenCodeAdapter = createOpenCodeAdapter;
