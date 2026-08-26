/** Cursor project capability projection; Rule/post-events never imply JX3 pre-write support. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

import { composeCapabilitySet, type ProjectedCapabilityContribution, type ProjectedCapabilityFile, type ProjectedCapabilitySection } from "../capabilities/compose.cjs";
import type { CapabilityId } from "../capabilities/contracts.cjs";
import { getCapabilityProvider, resolveCapabilitySelection } from "../capabilities/registry.cjs";
import { InstallError, type InstallState, type OriginalRecord, type ProjectTarget, type StatusIssue } from "../core/contracts.cjs";
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
  type SourceScanResult,
} from "./user-sources.cjs";

type JsonMap = Record<string, unknown>;
export interface CursorUserSourceMetadata {
  readonly activePluginPaths?: readonly string[]; readonly rawMcpPaths?: readonly string[]; readonly manualRulePaths?: readonly string[];
  readonly manualHookPaths?: readonly string[];
  readonly cachePaths?: readonly string[]; readonly disabledPaths?: readonly string[]; readonly ambiguousPaths?: readonly string[];
}
export interface CursorAdapterOptions {
  readonly homeDirectory?: string; readonly readUserSources?: () => CursorUserSourceMetadata | Promise<CursorUserSourceMetadata>;
  readonly hostVersion?: string; readonly evidenceRoot?: string; readonly readHostVersion?: () => string | undefined; readonly [key: string]: unknown;
}
interface Extras { readonly selectedCapabilities?: readonly CapabilityId[]; readonly hostVersion?: string; readonly evidenceRoot?: string }
interface Details { readonly stateBytes?: Buffer }
const STATE_PATH = ".cursor/kcoderag-nav/install-state.json";
const MCP_PATH = ".cursor/mcp.json";
const HOOKS_PATH = ".cursor/hooks.json";
const NAV_SKILL_PATH = ".cursor/skills/kcoderag-nav/SKILL.md";
const RULE_PATH = ".cursor/rules/kcoderag-navigation.mdc";
const JX3_SKILL_ROOT = ".cursor/skills/jx3-code-style-correction";
const HOOK_ROOT = ".cursor/kcoderag-nav/hooks";
const MANAGED_ROOTS = Object.freeze([".cursor"] as const);
const NAVIGATION = "kcoderag-navigation" as const;
const JX3 = "jx3-style-nudge" as const;
const MCP_SERVER = "kcoderag";

function isRecord(value: unknown): value is JsonMap { return typeof value === "object" && value !== null && !Array.isArray(value); }
function sha256(value: Buffer | string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
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
function qaEntry(packageRoot: string): JsonMap { const safePath = "kcoderag-qa/.mcp.json"; const source = parseJson(sourceAsset(packageRoot, safePath), "invalid_mcp_source", safePath); const entry = isRecord(source.mcpServers) ? source.mcpServers["kcoderag-qa"] : undefined; if (!isRecord(entry)) throw new InstallError("invalid_mcp_source", safePath); return entry; }
function encodeOriginal(bytes: Buffer | undefined): OriginalRecord { return bytes === undefined ? Object.freeze({ kind: "absent" as const }) : Object.freeze({ kind: "base64" as const, data: bytes.toString("base64") }); }
function stateBytes(observation: HostObservation): Buffer | undefined { const bytes = (observation.details as Details | undefined)?.stateBytes; return bytes === undefined ? undefined : Buffer.from(bytes); }
function verifyState(target: ProjectTarget, state: InstallState): void {
  if (state.host !== "cursor") throw new InstallError("invalid_state", STATE_PATH);
  for (const record of state.files) { const bytes = readRegular(target, record.path); if (bytes === undefined || sha256(bytes) !== record.digest) throw new InstallError(record.contributors.includes(JX3) ? "capability_drift" : "managed_content_changed", record.path); }
  if (state.capabilities.some((entry) => entry.id === JX3)) { const integrity = evaluateJx3Integrity({ host: "cursor", managedRoot: target.root }); if (!integrity.ok) throw new InstallError("capability_drift", integrity.finding?.path ?? "."); }
}
function detectCursor(context: { readonly target: ProjectTarget }): HostObservation {
  let bytes: Buffer | undefined;
  try { bytes = readRegular(context.target, STATE_PATH); if (bytes === undefined) return Object.freeze({ host: "cursor" as const, target: context.target }); const currentState = parseInstallState(bytes); verifyState(context.target, currentState); return Object.freeze({ host: "cursor" as const, target: context.target, currentState, details: Object.freeze({ stateBytes: Buffer.from(bytes) }) }); }
  catch (error) { return Object.freeze({ host: "cursor" as const, target: context.target, issues: Object.freeze([issueFrom(error)]), details: Object.freeze(bytes === undefined ? {} : { stateBytes: Buffer.from(bytes) }) }); }
}
function refuse(observation: HostObservation): void { const issue = observation.issues?.[0]; if (issue !== undefined) throw new InstallError(issue.code, issue.path); }
function selectedInstall(context: HostInstallContext): readonly CapabilityId[] { const request = (context as HostInstallContext & Extras).selectedCapabilities ?? (context.command === "update" ? context.observation.currentState?.capabilities.map((entry) => entry.id) : [NAVIGATION]); if (request === undefined) throw new InstallError("not_installed", STATE_PATH); const existing = context.observation.currentState?.capabilities.map((entry) => entry.id) ?? []; return Object.freeze(resolveCapabilitySelection([...existing, ...request]).map((entry) => entry.id)); }
function selectedUninstall(context: HostUninstallContext): readonly CapabilityId[] { const state = context.observation.currentState; if (state === undefined) throw new InstallError("not_installed", STATE_PATH); const removals = (context as HostUninstallContext & Extras).selectedCapabilities; if (removals === undefined) return Object.freeze([]); const remove = new Set(resolveCapabilitySelection(removals).map((entry) => entry.id)); return Object.freeze(state.capabilities.map((entry) => entry.id).filter((id) => !remove.has(id))); }
function defaultVersion(): string | undefined { try { const result = childProcess.spawnSync("cursor", ["--version"], { encoding: "utf8", timeout: 5_000, maxBuffer: 8_192, windowsHide: true }); if (result.error !== undefined || result.status !== 0 || typeof result.stdout !== "string") return undefined; return /^(\d+\.\d+\.\d+)\r?\n?$/u.exec(result.stdout)?.[1]; } catch { return undefined; } }
function assertSupport(selected: readonly CapabilityId[], context: HostInstallContext | HostUninstallContext, options: CursorAdapterOptions): void { if (!selected.includes(JX3)) return; const extras = context as (HostInstallContext | HostUninstallContext) & Extras; const hostVersion = extras.hostVersion ?? options.hostVersion ?? options.readHostVersion?.() ?? defaultVersion(); if (hostVersion === undefined) throw new InstallError("host_version_unsupported"); const decision = getCapabilityProvider(JX3).evaluateSupport({ host: "cursor", hostVersion, evidenceRoot: extras.evidenceRoot ?? options.evidenceRoot ?? context.packageRoot }); if (!decision.eligible) throw new InstallError(decision.code); }

function mergeMcp(current: Buffer | undefined, packageRoot: string, owned: boolean) {
  const document = current === undefined ? {} : parseJson(current, "invalid_json", MCP_PATH); const servers = document.mcpServers === undefined ? {} : document.mcpServers; if (!isRecord(servers)) throw new InstallError("invalid_json", MCP_PATH); if (!owned && servers[MCP_SERVER] !== undefined) throw new InstallError("unmanaged_name_conflict", MCP_PATH); const entry = qaEntry(packageRoot); servers[MCP_SERVER] = entry; document.mcpServers = servers; return Object.freeze({ bytes: canonicalJson(document), entry });
}
function managedHook(command: string): JsonMap { return { command, timeout: 5 }; }
function mergeHooks(current: Buffer | undefined, selected: readonly CapabilityId[], owned: boolean) {
  const document = current === undefined ? { version: 1 } as JsonMap : parseJson(current, "invalid_json", HOOKS_PATH); if (document.version === undefined) document.version = 1; if (document.version !== 1) throw new InstallError("invalid_json", HOOKS_PATH); const hooks = document.hooks === undefined ? {} : document.hooks; if (!isRecord(hooks)) throw new InstallError("invalid_json", HOOKS_PATH);
  const desired = new Map<string, JsonMap | undefined>([
    ["afterMCPExecution", selected.includes(NAVIGATION) ? managedHook(`node ${HOOK_ROOT}/mcp-call-marker.cjs cursor`) : undefined],
    ["postToolUse", selected.includes(NAVIGATION) ? managedHook(`node ${HOOK_ROOT}/update-notice.cjs cursor`) : undefined],
    ["preToolUse", selected.includes(JX3) ? managedHook(`node ${HOOK_ROOT}/pre-tool-dispatcher.cjs cursor`) : undefined],
  ]);
  for (const [event, entry] of desired) { const existing = hooks[event] === undefined ? [] : hooks[event]; if (!Array.isArray(existing)) throw new InstallError("invalid_json", HOOKS_PATH); const unrelated = existing.filter((value) => !JSON.stringify(value).includes("kcoderag-nav")); if (!owned && unrelated.length !== existing.length) throw new InstallError("unmanaged_name_conflict", HOOKS_PATH); if (entry === undefined) { if (unrelated.length === 0) delete hooks[event]; else hooks[event] = unrelated; } else hooks[event] = [...unrelated, entry]; }
  document.hooks = hooks; return Object.freeze({ bytes: canonicalJson(document), marker: desired.get("afterMCPExecution"), notice: desired.get("postToolUse"), pre: desired.get("preToolUse") });
}
function previousFile(state: InstallState | undefined, relativePath: string) { return state?.files.find((record) => record.path === relativePath); }
function projectedFile(target: ProjectTarget, state: InstallState | undefined, relativePath: string, content: Buffer, shared: boolean, allowExisting = false): ProjectedCapabilityFile { const previous = previousFile(state, relativePath); if (previous !== undefined) return Object.freeze({ relativePath, expectedDigest: previous.digest, content, shared }); const current = readRegular(target, relativePath); if (current !== undefined && !allowExisting) throw new InstallError("unmanaged_name_conflict", relativePath); return Object.freeze({ relativePath, expectedDigest: current === undefined ? null : sha256(current), content, original: encodeOriginal(current), shared }); }
function section(relativePath: string, id: string, value: unknown, fileExisted: boolean): ProjectedCapabilitySection { return Object.freeze({ relativePath, id, digest: sha256(JSON.stringify(value)), fileExisted, shared: true }); }
const REFERENCES = Object.freeze(["cpp-lifetime-control-flow.md", "protocol-serialization-data.md", "lua-contracts.md", "change-hygiene-self-review.md"] as const);
function contributions(target: ProjectTarget, packageRoot: string, selected: readonly CapabilityId[], state: InstallState | undefined): readonly ProjectedCapabilityContribution[] {
  const result: ProjectedCapabilityContribution[] = []; const hooksCurrent = readRegular(target, HOOKS_PATH); const hooks = mergeHooks(hooksCurrent, selected, state !== undefined);
  if (selected.includes(NAVIGATION)) { const mcpCurrent = readRegular(target, MCP_PATH); const mcp = mergeMcp(mcpCurrent, packageRoot, state !== undefined); result.push(Object.freeze({ capabilityId: NAVIGATION, files: Object.freeze([
    projectedFile(target, state, MCP_PATH, mcp.bytes, true, true), projectedFile(target, state, HOOKS_PATH, hooks.bytes, true, true), projectedFile(target, state, RULE_PATH, sourceAsset(packageRoot, "kcoderag-cursor/rules/kcoderag-navigation.mdc"), false), projectedFile(target, state, NAV_SKILL_PATH, sourceAsset(packageRoot, "kcoderag-cursor/skills/code-lookup-discipline/SKILL.md"), false),
    projectedFile(target, state, `${HOOK_ROOT}/mcp-call-marker.cjs`, sourceAsset(packageRoot, "dist/hooks/mcp-call-marker.cjs"), false), projectedFile(target, state, `${HOOK_ROOT}/update-check.cjs`, sourceAsset(packageRoot, "dist/hooks/update-check.cjs"), false), projectedFile(target, state, `${HOOK_ROOT}/update-notice.cjs`, sourceAsset(packageRoot, "dist/hooks/update-notice.cjs"), false), projectedFile(target, state, `${HOOK_ROOT}/update-worker.cjs`, sourceAsset(packageRoot, "dist/hooks/update-worker.cjs"), false),
  ]), sections: Object.freeze([section(MCP_PATH, "navigation:mcp", mcp.entry, mcpCurrent !== undefined), section(HOOKS_PATH, "navigation:post-tool", [hooks.marker, hooks.notice], hooksCurrent !== undefined)]) })); }
  if (selected.includes(JX3)) result.push(Object.freeze({ capabilityId: JX3, files: Object.freeze([
    projectedFile(target, state, HOOKS_PATH, hooks.bytes, true, true), projectedFile(target, state, `${JX3_SKILL_ROOT}/SKILL.md`, sourceAsset(packageRoot, "plugin-src/capabilities/jx3-style-nudge/skill/SKILL.md"), false), ...REFERENCES.map((name) => projectedFile(target, state, `${JX3_SKILL_ROOT}/references/${name}`, sourceAsset(packageRoot, `plugin-src/capabilities/jx3-style-nudge/skill/references/${name}`), false)), projectedFile(target, state, `${HOOK_ROOT}/jx3-style-nudge.cjs`, sourceAsset(packageRoot, "dist/hooks/jx3-style-nudge.cjs"), false), projectedFile(target, state, `${HOOK_ROOT}/pre-tool-dispatcher.cjs`, sourceAsset(packageRoot, "dist/hooks/pre-tool-dispatcher.cjs"), false), projectedFile(target, state, `${HOOK_ROOT}/once-marker.cjs`, sourceAsset(packageRoot, "dist/hooks/once-marker.cjs"), false),
  ]), sections: Object.freeze([section(HOOKS_PATH, "jx3:pre-tool", hooks.pre, hooksCurrent !== undefined)]) }));
  return Object.freeze(result);
}
function compose(context: HostInstallContext | HostUninstallContext, selected: readonly CapabilityId[]) { const previousState = context.observation.currentState; const bytes = stateBytes(context.observation); return composeCapabilitySet({ host: "cursor", target: context.target, packageVersion: packageVersion(context.packageRoot), managedRoots: MANAGED_ROOTS, statePath: STATE_PATH, stateExpectedDigest: bytes === undefined ? null : sha256(bytes), selectedCapabilities: selected, contributions: contributions(context.target, context.packageRoot, selected, previousState), ...(previousState === undefined ? {} : { previousState }) }); }
function status(context: HostStatusContext) { const issue = context.observation.issues?.[0]; if (issue !== undefined) return createStatusResult({ status: issue.code === "capability_drift" || issue.code === "managed_content_changed" ? "drifted" : "invalid", host: "cursor", issues: [issue] }); if (context.observation.currentState !== undefined) return createStatusResult({ status: "healthy", host: "cursor" }); const root = validateManagedPath(context.target, STATE_PATH, MANAGED_ROOTS); return hasManagedRootResidue(path.dirname(root.absolutePath)) ? createStatusResult({ status: "invalid", host: "cursor", issues: [{ code: "orphaned_managed_root", path: ".cursor/kcoderag-nav" }] }) : createStatusResult({ host: "cursor" }); }

function defaultMetadata(homeDirectory: string): CursorUserSourceMetadata {
  const activePluginPaths: string[] = [];
  const rawMcpPaths: string[] = [];
  const manualHookPaths: string[] = [];
  const manualRulePaths: string[] = [];
  const ambiguousPaths: string[] = [];
  const mcp = inspectNativeJsonSource(homeDirectory, ".cursor/mcp.json");
  if (mcp.rawMcp) rawMcpPaths.push(".cursor/mcp.json");
  if (mcp.ambiguous) ambiguousPaths.push(".cursor/mcp.json");
  const hooks = inspectNativeJsonSource(homeDirectory, ".cursor/hooks.json");
  if (hooks.manualHook) manualHookPaths.push(".cursor/hooks.json");
  if (hooks.ambiguous) ambiguousPaths.push(".cursor/hooks.json");
  const rules = inspectNativeDirectory(homeDirectory, ".cursor/rules");
  manualRulePaths.push(...rules.matches);
  if (rules.ambiguous) ambiguousPaths.push(".cursor/rules");
  const plugins = inspectNativeDirectory(homeDirectory, ".cursor/plugins");
  activePluginPaths.push(...plugins.matches);
  if (plugins.ambiguous) ambiguousPaths.push(".cursor/plugins");
  for (const relativePath of [".cursor/plugins/local/kcoderag-nav", ".cursor/skills/kcoderag-nav/SKILL.md"]) {
    const inspection = inspectNativePath(homeDirectory, relativePath);
    if (inspection !== "absent") ambiguousPaths.push(relativePath);
  }
  return Object.freeze({
    activePluginPaths: Object.freeze([...new Set(activePluginPaths)].sort()),
    rawMcpPaths: Object.freeze([...new Set(rawMcpPaths)].sort()),
    manualHookPaths: Object.freeze([...new Set(manualHookPaths)].sort()),
    manualRulePaths: Object.freeze([...new Set(manualRulePaths)].sort()),
    ambiguousPaths: Object.freeze([...new Set(ambiguousPaths)].sort()),
  });
}
function values(metadata: CursorUserSourceMetadata, key: keyof CursorUserSourceMetadata): readonly string[] { const value = metadata[key]; return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : []; }
async function scanSources(context: HostSourceScanContext, reader: () => CursorUserSourceMetadata | Promise<CursorUserSourceMetadata>): Promise<SourceScanResult> { let metadata: CursorUserSourceMetadata; try { metadata = await reader(); } catch { metadata = { ambiguousPaths: [".cursor/plugins"] }; } const findings = [
  ...values(metadata, "activePluginPaths").map((safePath) => createSourceFinding({ code: "active_plugin_source", severity: "conflict", sourceType: "active_plugin", scope: "user", safePath })), ...values(metadata, "rawMcpPaths").map((safePath) => createSourceFinding({ code: "raw_mcp_source", severity: "conflict", sourceType: "raw_mcp", scope: "user", safePath })), ...values(metadata, "manualRulePaths").map((safePath) => createSourceFinding({ code: "manual_rule_source", severity: "conflict", sourceType: "manual_rule", scope: "user", safePath })), ...values(metadata, "ambiguousPaths").map((safePath) => createSourceFinding({ code: "ambiguous_source", severity: "conflict", sourceType: "ambiguous", scope: "user", safePath })),
  ...values(metadata, "manualHookPaths").map((safePath) => createSourceFinding({ code: "manual_hook_source", severity: "conflict", sourceType: "manual_hook", scope: "user", safePath })),
]; if (context.mode !== "fast") findings.push(...values(metadata, "cachePaths").map((safePath) => createSourceFinding({ code: "cache_residue", severity: "info", sourceType: "cache_residue", scope: "user", safePath })), ...values(metadata, "disabledPaths").map((safePath) => createSourceFinding({ code: "disabled_source", severity: "info", sourceType: "disabled_registration", scope: "user", safePath }))); return createSourceScanResult(context.mode, findings); }

export function createCursorAdapter(options: CursorAdapterOptions = {}): HostAdapter { const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir()); const reader = options.readUserSources ?? (() => defaultMetadata(homeDirectory)); return Object.freeze({ id: "cursor" as const, managedRoots: MANAGED_ROOTS, detect: detectCursor,
  renderInstall: (context: HostInstallContext) => { refuse(context.observation); if (context.command === "update" && context.observation.currentState === undefined) throw new InstallError("not_installed", STATE_PATH); const selected = selectedInstall(context); assertSupport(selected, context, options); return compose(context, selected); }, renderUninstall: (context: HostUninstallContext) => { refuse(context.observation); const selected = selectedUninstall(context); assertSupport(selected, context, options); return compose(context, selected); }, status, scanUserSources: (context: HostSourceScanContext) => scanSources(context, reader) }); }
export const cursorAdapter: HostAdapter = createCursorAdapter();
exports.STATE_PATH = STATE_PATH;
exports.managedPaths = () => Object.freeze([STATE_PATH]);
exports.createCursorAdapter = createCursorAdapter;
