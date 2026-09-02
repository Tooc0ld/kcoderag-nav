/** Codex capability projection with receipt-gated code-style support and path-only source findings. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

import { composeCapabilitySet, type ProjectedCapabilityContribution, type ProjectedCapabilityFile, type ProjectedCapabilitySection } from "../capabilities/compose.cjs";
import type { CapabilityId } from "../capabilities/contracts.cjs";
import { resolveCapabilitySelection } from "../capabilities/registry.cjs";
import { InstallError, type InstallState, type OriginalRecord, type ProjectTarget, type StatusIssue } from "../core/contracts.cjs";
import { normalizeRemoteMcpUrl } from "../core/mcp-endpoint.cjs";
import { hasManagedRootResidue, validateManagedPath } from "../core/project-target.cjs";
import { renderProjectHookCommands } from "../core/project-root.cjs";
import { createStatusResult, deriveCodeStyleDelivery, parseInstallState } from "../core/state.cjs";
import { evaluateCodeStyleIntegrity } from "../hooks/code-style-nudge.cjs";
import type { HostAdapter, HostInstallContext, HostObservation, HostSourceScanContext, HostStatusContext, HostUninstallContext } from "./host-adapter.cjs";
import {
  CONFLICTING_SKILL_SOURCE_NAMES,
  createSourceFinding,
  createSourceScanResult,
  inspectNativeDirectory,
  inspectNativeJsonSource,
  inspectNativePath,
  inspectNativeTomlMcpSource,
  type SourceScanResult,
} from "./user-sources.cjs";

type JsonMap = Record<string, unknown>;
export interface CodexUserSourceMetadata {
  readonly ownedPluginPaths?: readonly string[];
  readonly ownedMarketplacePaths?: readonly string[];
  readonly rawMcpPaths?: readonly string[];
  readonly manualHookPaths?: readonly string[];
  readonly cachePaths?: readonly string[];
  readonly disabledPaths?: readonly string[];
  readonly ambiguousPaths?: readonly string[];
}
export interface CodexAdapterOptions {
  readonly homeDirectory?: string;
  readonly readUserSources?: () => CodexUserSourceMetadata | Promise<CodexUserSourceMetadata>;
  readonly hostVersion?: string;
  readonly evidenceRoot?: string;
  readonly readHostVersion?: () => string | undefined;
  readonly [key: string]: unknown;
}
interface Details { readonly stateBytes?: Buffer }
interface Extras { readonly selectedCapabilities?: readonly CapabilityId[]; readonly hostVersion?: string; readonly evidenceRoot?: string }

const STATE_PATH = ".codex/kcoderag-nav/install-state.json";
const CONFIG_PATH = ".codex/config.toml";
const HOOKS_PATH = ".codex/hooks.json";
const NAV_SKILL_ROOT = ".agents/skills/kcoderag";
const MANAGE_SKILL_ROOT = ".agents/skills/kcoderag-manage";
const FEEDBACK_SKILL_ROOT = ".agents/skills/kcoderag-feedback";
const CODE_STYLE_SKILL_ROOT = ".agents/skills/kcoderag-code-style";
const HOOK_ROOT = ".codex/kcoderag-nav/qa/hooks";
const MANAGED_ROOTS = Object.freeze([".codex", ".agents/skills"] as const);
const NAVIGATION = "kcoderag-navigation" as const;
const CODE_STYLE = "code-style-nudge" as const;
const TOML_BEGIN = "# BEGIN kcoderag-nav:kcoderag-navigation";
const TOML_END = "# END kcoderag-nav:kcoderag-navigation";

function isRecord(value: unknown): value is JsonMap { return typeof value === "object" && value !== null && !Array.isArray(value); }
function sha256(value: Buffer | string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function parseJson(bytes: Buffer, code: string, safePath: string): JsonMap {
  try { const value: unknown = JSON.parse(bytes.toString("utf8")); if (isRecord(value)) return value; } catch { /* stable refusal below */ }
  throw new InstallError(code, safePath);
}
function issueFrom(error: unknown): StatusIssue { return error instanceof InstallError ? { code: error.code, path: error.safePath ?? "." } : { code: "invalid", path: "." }; }
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
    const root = path.resolve(packageRoot);
    const absolute = path.resolve(root, ...relativePath.split("/"));
    const relation = path.relative(root, absolute);
    if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw new Error("escape");
    const metadata = fs.lstatSync(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("not regular");
    return fs.readFileSync(absolute);
  } catch { throw new InstallError("missing_package_asset", relativePath); }
}
function packageVersion(packageRoot: string): string {
  const value = parseJson(sourceAsset(packageRoot, "package.json"), "invalid_package", "package.json");
  if (value.name !== "kcoderag-nav" || typeof value.version !== "string" || value.version.length === 0) throw new InstallError("invalid_package", "package.json");
  return value.version;
}
function qaMcpEntry(packageRoot: string): JsonMap {
  const safePath = "kcoderag-qa/.codex.mcp.json";
  const source = parseJson(sourceAsset(packageRoot, safePath), "invalid_mcp_source", safePath);
  const entry = source["kcoderag-qa"];
  if (!isRecord(entry) || typeof entry.url !== "string") throw new InstallError("invalid_mcp_source", safePath);
  return Object.freeze({ ...entry, url: normalizeRemoteMcpUrl(entry.url, safePath) });
}
function encodeOriginal(bytes: Buffer | undefined): OriginalRecord { return bytes === undefined ? Object.freeze({ kind: "absent" as const }) : Object.freeze({ kind: "base64" as const, data: bytes.toString("base64") }); }
function stateBytes(observation: HostObservation): Buffer | undefined { const bytes = (observation.details as Details | undefined)?.stateBytes; return bytes === undefined ? undefined : Buffer.from(bytes); }

function verifyStateFiles(target: ProjectTarget, state: InstallState): void {
  if (state.host !== "codex") throw new InstallError("invalid_state", STATE_PATH);
  for (const record of state.files) {
    const current = readRegular(target, record.path);
    if (current === undefined || sha256(current) !== record.digest) throw new InstallError(record.contributors.includes(CODE_STYLE) ? "capability_drift" : "managed_content_changed", record.path);
  }
  if (state.capabilities.some((entry) => entry.id === CODE_STYLE)) {
    const integrity = evaluateCodeStyleIntegrity({ host: "codex", managedRoot: target.root });
    if (!integrity.ok) throw new InstallError("capability_drift", integrity.finding?.path ?? ".");
  }
}
function detectCodex(context: { readonly target: ProjectTarget }): HostObservation {
  let bytes: Buffer | undefined;
  let currentState: InstallState | undefined;
  try {
    bytes = readRegular(context.target, STATE_PATH);
    if (bytes === undefined) return Object.freeze({ host: "codex" as const, target: context.target, details: Object.freeze({}) });
    currentState = parseInstallState(bytes);
    verifyStateFiles(context.target, currentState);
    return Object.freeze({ host: "codex" as const, target: context.target, currentState, details: Object.freeze({ stateBytes: Buffer.from(bytes) }) });
  } catch (error) {
    return Object.freeze({ host: "codex" as const, target: context.target, ...(currentState === undefined ? {} : { currentState }), issues: Object.freeze([issueFrom(error)]), details: Object.freeze(bytes === undefined ? {} : { stateBytes: Buffer.from(bytes) }) });
  }
}
function refuseIssues(observation: HostObservation): void { const issue = observation.issues?.[0]; if (issue !== undefined) throw new InstallError(issue.code, issue.path); }
function selectedInstall(context: HostInstallContext): readonly CapabilityId[] {
  const request = (context as HostInstallContext & Extras).selectedCapabilities ?? (context.command === "update" ? context.observation.currentState?.capabilities.map((entry) => entry.id) : [NAVIGATION]);
  if (request === undefined) throw new InstallError("not_installed", STATE_PATH);
  const existing = context.observation.currentState?.capabilities.map((entry) => entry.id) ?? [];
  return Object.freeze(resolveCapabilitySelection([...existing, ...request]).map((entry) => entry.id));
}
function preservedForUpdate(context: HostInstallContext, selected: readonly CapabilityId[]): readonly CapabilityId[] {
  if (context.command !== "update" || context.observation.currentState === undefined) return Object.freeze([]);
  const projected = new Set(context.selectedCapabilities ?? selected);
  return Object.freeze(selected.filter((id) => !projected.has(id)));
}
function selectedUninstall(context: HostUninstallContext): readonly CapabilityId[] {
  const state = context.observation.currentState;
  if (state === undefined) throw new InstallError("not_installed", STATE_PATH);
  const removals = (context as HostUninstallContext & Extras).selectedCapabilities;
  if (removals === undefined) return Object.freeze([]);
  const remove = new Set(resolveCapabilitySelection(removals).map((entry) => entry.id));
  return Object.freeze(state.capabilities.map((entry) => entry.id).filter((id) => !remove.has(id)));
}
function hookEntries(packageRoot: string, selected: readonly CapabilityId[]): {
  readonly start?: unknown;
  readonly pre?: unknown;
  readonly post?: unknown;
} {
  const template = parseJson(sourceAsset(packageRoot, "kcoderag-qa/hooks/hooks.json"), "invalid_package", "kcoderag-qa/hooks/hooks.json");
  const hooks = isRecord(template.hooks) ? template.hooks : {};
  const render = (value: unknown, commands: { readonly command: string; readonly commandWindows: string }): unknown => {
    const copy = JSON.parse(JSON.stringify(value)) as unknown;
    if (!isRecord(copy) || !Array.isArray(copy.hooks) || !isRecord(copy.hooks[0])) throw new InstallError("invalid_package", "kcoderag-qa/hooks/hooks.json");
    copy.hooks[0].command = commands.command;
    copy.hooks[0].commandWindows = commands.commandWindows;
    return copy;
  };
  const genericShell = process.platform === "win32" ? "windows" : "posix";
  const advisoryCommands = renderProjectHookCommands("codex", "advisory", genericShell);
  const startTemplate = Array.isArray(hooks.SessionStart)
    ? hooks.SessionStart[0]
    : Array.isArray(hooks.PreToolUse)
      ? hooks.PreToolUse[0]
      : undefined;
  const start = startTemplate === undefined ? undefined : render(startTemplate, advisoryCommands);
  if (isRecord(start)) start.matcher = "^(startup|resume|clear|compact)$";
  return Object.freeze({
    ...(!selected.includes(NAVIGATION) || start === undefined ? {} : { start }),
    ...(!selected.includes(NAVIGATION) || !Array.isArray(hooks.PreToolUse) ? {} : { pre: render(hooks.PreToolUse[0], advisoryCommands) }),
    ...(!selected.includes(NAVIGATION) || !Array.isArray(hooks.PostToolUse) ? {} : { post: render(hooks.PostToolUse[0], renderProjectHookCommands("codex", "mcp-call-marker", genericShell)) }),
  });
}
function mergeHooks(current: Buffer | undefined, packageRoot: string, selected: readonly CapabilityId[], owned: boolean) {
  const document = current === undefined ? {} : parseJson(current, "invalid_json", HOOKS_PATH);
  const hooks = document.hooks === undefined ? {} : document.hooks;
  if (!isRecord(hooks)) throw new InstallError("invalid_json", HOOKS_PATH);
  const managed = hookEntries(packageRoot, selected);
  for (const event of ["SessionStart", "PreToolUse", "PostToolUse"] as const) {
    const currentEntries = hooks[event] === undefined ? [] : hooks[event];
    if (!Array.isArray(currentEntries)) throw new InstallError("invalid_json", HOOKS_PATH);
    const unrelated = currentEntries.filter((entry) => !JSON.stringify(entry).includes("kcoderag-nav"));
    if (!owned && unrelated.length !== currentEntries.length) throw new InstallError("unmanaged_name_conflict", HOOKS_PATH);
    const entry = event === "SessionStart"
      ? managed.start
      : event === "PreToolUse"
        ? managed.pre
        : managed.post;
    if (entry === undefined) { if (unrelated.length === 0) delete hooks[event]; else hooks[event] = unrelated; }
    else hooks[event] = [...unrelated, entry];
  }
  if (Object.keys(hooks).length === 0) delete document.hooks; else document.hooks = hooks;
  return Object.freeze({ bytes: canonicalJson(document), ...managed });
}
function tomlString(value: string): string { return JSON.stringify(value); }
function renderTomlEntry(entry: JsonMap): string {
  if (typeof entry.url !== "string") throw new InstallError("invalid_mcp_source", "kcoderag-qa/.codex.mcp.json");
  const headers = isRecord(entry.http_headers) ? entry.http_headers : isRecord(entry.headers) ? entry.headers : undefined;
  if (headers === undefined || !Object.values(headers).every((value) => typeof value === "string")) throw new InstallError("invalid_mcp_source", "kcoderag-qa/.codex.mcp.json");
  const pairs = Object.entries(headers).map(([key, value]) => `${tomlString(key)} = ${tomlString(value as string)}`).join(", ");
  return `${TOML_BEGIN}\n[mcp_servers.kcoderag-qa]\nurl = ${tomlString(entry.url)}\nhttp_headers = { ${pairs} }\n${TOML_END}`;
}
function mergeToml(current: Buffer | undefined, packageRoot: string, owned: boolean) {
  const original = current?.toString("utf8") ?? "";
  const start = original.indexOf(TOML_BEGIN);
  const end = original.indexOf(TOML_END);
  const unmanagedDefinition = /^\s*\[mcp_servers(?:\.kcoderag-qa|\."kcoderag-qa")\]\s*$/mu.test(original);
  if (!owned && (start >= 0 || end >= 0 || unmanagedDefinition)) throw new InstallError("unmanaged_name_conflict", CONFIG_PATH);
  if (owned && (start < 0 || end < start)) throw new InstallError("managed_content_changed", CONFIG_PATH);
  const entry = qaMcpEntry(packageRoot);
  const block = renderTomlEntry(entry);
  const stripped = owned ? `${original.slice(0, start)}${original.slice(end + TOML_END.length)}` : original;
  const prefix = stripped.trimEnd();
  return Object.freeze({ bytes: Buffer.from(`${prefix}${prefix.length === 0 ? "" : "\n\n"}${block}\n`, "utf8"), entry });
}
function previousFile(state: InstallState | undefined, relativePath: string) { return state?.files.find((record) => record.path === relativePath); }
function projectedFile(target: ProjectTarget, state: InstallState | undefined, relativePath: string, content: Buffer, shared: boolean, allowExisting = false): ProjectedCapabilityFile {
  const previous = previousFile(state, relativePath);
  if (previous !== undefined) return Object.freeze({ relativePath, expectedDigest: previous.digest, content, shared });
  const current = readRegular(target, relativePath);
  if (current !== undefined && !allowExisting) throw new InstallError("unmanaged_name_conflict", relativePath);
  return Object.freeze({ relativePath, expectedDigest: current === undefined ? null : sha256(current), content, original: encodeOriginal(current), shared });
}
function section(relativePath: string, id: string, value: unknown, fileExisted: boolean): ProjectedCapabilitySection { return Object.freeze({ relativePath, id, digest: sha256(JSON.stringify(value)), fileExisted, shared: true }); }
const NAV_RUNTIME = Object.freeze([
  ["dist/hooks/feedback-nudge.cjs", "feedback-nudge.cjs"], ["dist/hooks/grep-nudge.cjs", "grep-nudge.cjs"], ["dist/hooks/update-check.cjs", "update-check.cjs"], ["dist/hooks/update-notice.cjs", "update-notice.cjs"], ["dist/hooks/update-worker.cjs", "update-worker.cjs"], ["dist/hooks/mcp-call-marker.cjs", "mcp-call-marker.cjs"],
  ["kcoderag-qa/hooks/run_marker.cmd", "run_marker.cmd"], ["kcoderag-qa/hooks/run_marker.sh", "run_marker.sh"],
  ["dist/hooks/pre-tool-dispatcher.cjs", "pre-tool-dispatcher.cjs"], ["dist/hooks/code-style-nudge.cjs", "code-style-nudge.cjs"], ["dist/hooks/once-marker.cjs", "once-marker.cjs"], ["kcoderag-qa/hooks/run_hook.cmd", "run_hook.cmd"], ["kcoderag-qa/hooks/run_hook.sh", "run_hook.sh"],
] as const);
const REFERENCES = Object.freeze(["cpp-lifetime-control-flow.md", "protocol-serialization-data.md", "lua-contracts.md", "change-hygiene-self-review.md"] as const);
function contributions(target: ProjectTarget, packageRoot: string, selected: readonly CapabilityId[], projected: readonly CapabilityId[], state: InstallState | undefined): readonly ProjectedCapabilityContribution[] {
  const result: ProjectedCapabilityContribution[] = [];
  const hooksCurrent = readRegular(target, HOOKS_PATH);
  const hooks = mergeHooks(hooksCurrent, packageRoot, selected, previousFile(state, HOOKS_PATH) !== undefined);
  if (projected.includes(NAVIGATION)) {
    const configCurrent = readRegular(target, CONFIG_PATH);
    const config = mergeToml(configCurrent, packageRoot, previousFile(state, CONFIG_PATH) !== undefined);
    result.push(Object.freeze({ capabilityId: NAVIGATION, files: Object.freeze([
      projectedFile(target, state, CONFIG_PATH, config.bytes, true, true), projectedFile(target, state, HOOKS_PATH, hooks.bytes, true, true),
      projectedFile(target, state, `${NAV_SKILL_ROOT}/SKILL.md`, sourceAsset(packageRoot, "kcoderag-qa/skills/kcoderag/SKILL.md"), false),
      projectedFile(target, state, `${NAV_SKILL_ROOT}/agents/openai.yaml`, sourceAsset(packageRoot, "kcoderag-qa/skills/kcoderag/agents/openai.yaml"), false),
      projectedFile(target, state, `${MANAGE_SKILL_ROOT}/SKILL.md`, sourceAsset(packageRoot, "kcoderag-qa/skills/kcoderag-manage/SKILL.md"), false),
      projectedFile(target, state, `${MANAGE_SKILL_ROOT}/agents/openai.yaml`, sourceAsset(packageRoot, "kcoderag-qa/skills/kcoderag-manage/agents/openai.yaml"), false),
      projectedFile(target, state, `${FEEDBACK_SKILL_ROOT}/SKILL.md`, sourceAsset(packageRoot, "kcoderag-qa/skills/kcoderag-feedback/SKILL.md"), false),
      projectedFile(target, state, `${FEEDBACK_SKILL_ROOT}/agents/openai.yaml`, sourceAsset(packageRoot, "kcoderag-qa/skills/kcoderag-feedback/agents/openai.yaml"), false),
      ...NAV_RUNTIME.map(([source, name]) => projectedFile(target, state, `${HOOK_ROOT}/${name}`, sourceAsset(packageRoot, source), true)),
    ]), sections: Object.freeze([
      section(CONFIG_PATH, "navigation:mcp", config.entry, configCurrent !== undefined), section(HOOKS_PATH, "navigation:session-start", hooks.start, hooksCurrent !== undefined), section(HOOKS_PATH, "navigation:pre-tool", hooks.pre, hooksCurrent !== undefined), section(HOOKS_PATH, "navigation:post-tool", hooks.post, hooksCurrent !== undefined),
    ]) }));
  }
  if (projected.includes(CODE_STYLE)) {
    result.push(Object.freeze({ capabilityId: CODE_STYLE, files: Object.freeze([
      projectedFile(target, state, `${CODE_STYLE_SKILL_ROOT}/SKILL.md`, sourceAsset(packageRoot, "plugin-src/capabilities/code-style-nudge/skill/SKILL.md"), false),
      projectedFile(target, state, `${CODE_STYLE_SKILL_ROOT}/agents/openai.yaml`, sourceAsset(packageRoot, "plugin-src/capabilities/code-style-nudge/skill/agents/openai.yaml"), false),
      ...REFERENCES.map((name) => projectedFile(target, state, `${CODE_STYLE_SKILL_ROOT}/references/${name}`, sourceAsset(packageRoot, `plugin-src/capabilities/code-style-nudge/skill/references/${name}`), false)),
    ]), sections: Object.freeze([]) }));
  }
  return Object.freeze(result);
}
function compose(context: HostInstallContext | HostUninstallContext, selected: readonly CapabilityId[], preserved: readonly CapabilityId[] = []) {
  const previousState = context.observation.currentState;
  const bytes = stateBytes(context.observation);
  const projected = selected.filter((id) => !preserved.includes(id));
  const reconciled = preserved.length === 0 ? Object.freeze([]) : contributions(context.target, context.packageRoot, selected, preserved, previousState);
  return composeCapabilitySet({ host: "codex", target: context.target, packageVersion: packageVersion(context.packageRoot), managedRoots: MANAGED_ROOTS, statePath: STATE_PATH, stateExpectedDigest: bytes === undefined ? null : sha256(bytes), selectedCapabilities: selected, preservedCapabilities: preserved, contributions: contributions(context.target, context.packageRoot, selected, projected, previousState), reconciledContributions: reconciled, ...(previousState === undefined ? {} : { previousState }) });
}

function codexStatus(context: HostStatusContext) {
  const issue = context.observation.issues?.[0];
  if (issue !== undefined) {
    const status = issue.code === "capability_drift" || issue.code === "managed_content_changed" ? "drifted" : "invalid";
    return createStatusResult({ status, host: "codex", issues: [issue], codeStyle: deriveCodeStyleDelivery(context.observation.currentState, status) });
  }
  if (context.observation.currentState !== undefined) return createStatusResult({ status: "healthy", host: "codex", codeStyle: deriveCodeStyleDelivery(context.observation.currentState, "healthy") });
  const root = validateManagedPath(context.target, STATE_PATH, MANAGED_ROOTS);
  return hasManagedRootResidue(path.dirname(root.absolutePath)) ? createStatusResult({ status: "invalid", host: "codex", issues: [{ code: "orphaned_managed_root", path: ".codex/kcoderag-nav" }] }) : createStatusResult({ host: "codex" });
}
function existingMetadata(homeDirectory: string): CodexUserSourceMetadata {
  const rawMcpPaths: string[] = [];
  const manualHookPaths: string[] = [];
  const ambiguousPaths: string[] = [];
  const config = inspectNativeTomlMcpSource(homeDirectory, ".codex/config.toml");
  if (config.rawMcp) rawMcpPaths.push(".codex/config.toml");
  if (config.ambiguous) ambiguousPaths.push(".codex/config.toml");
  const hooks = inspectNativeJsonSource(homeDirectory, ".codex/hooks.json");
  if (hooks.manualHook) manualHookPaths.push(".codex/hooks.json");
  if (hooks.ambiguous) ambiguousPaths.push(".codex/hooks.json");
  const hookDirectory = inspectNativeDirectory(homeDirectory, ".codex/hooks");
  manualHookPaths.push(...hookDirectory.matches);
  if (hookDirectory.ambiguous) ambiguousPaths.push(".codex/hooks");
  for (const relativePath of [
    ".codex/plugins/local/kcoderag-nav",
    ...CONFLICTING_SKILL_SOURCE_NAMES.map((name) => `.codex/skills/${name}/SKILL.md`),
  ]) {
    const inspection = inspectNativePath(homeDirectory, relativePath);
    if (inspection !== "absent") ambiguousPaths.push(relativePath);
  }
  return Object.freeze({
    rawMcpPaths: Object.freeze([...new Set(rawMcpPaths)].sort()),
    manualHookPaths: Object.freeze([...new Set(manualHookPaths)].sort()),
    ambiguousPaths: Object.freeze([...new Set(ambiguousPaths)].sort()),
  });
}
function values(metadata: CodexUserSourceMetadata, key: keyof CodexUserSourceMetadata): readonly string[] { const value = metadata[key]; return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : []; }
async function scanCodexSources(context: HostSourceScanContext, reader: () => CodexUserSourceMetadata | Promise<CodexUserSourceMetadata>): Promise<SourceScanResult> {
  let metadata: CodexUserSourceMetadata; try { metadata = await reader(); } catch { metadata = { ambiguousPaths: [".codex/plugins"] }; }
  const findings = [
    ...values(metadata, "ownedPluginPaths").map((safePath) => createSourceFinding({ code: "owned_plugin_source", severity: "conflict", sourceType: "owned_plugin", scope: "user", safePath })),
    ...values(metadata, "ownedMarketplacePaths").map((safePath) => createSourceFinding({ code: "owned_marketplace_source", severity: "conflict", sourceType: "owned_marketplace_registration", scope: "user", safePath })),
    ...values(metadata, "rawMcpPaths").map((safePath) => createSourceFinding({ code: "raw_mcp_source", severity: "conflict", sourceType: "raw_mcp", scope: "user", safePath })),
    ...values(metadata, "manualHookPaths").map((safePath) => createSourceFinding({ code: "manual_hook_source", severity: "conflict", sourceType: "manual_hook", scope: "user", safePath })),
    ...values(metadata, "ambiguousPaths").map((safePath) => createSourceFinding({ code: "ambiguous_source", severity: "conflict", sourceType: "ambiguous", scope: "user", safePath })),
  ];
  if (context.mode !== "fast") findings.push(...values(metadata, "cachePaths").map((safePath) => createSourceFinding({ code: "cache_residue", severity: "info", sourceType: "cache_residue", scope: "user", safePath })), ...values(metadata, "disabledPaths").map((safePath) => createSourceFinding({ code: "disabled_source", severity: "info", sourceType: "disabled_registration", scope: "user", safePath })));
  return createSourceScanResult(context.mode, findings);
}

export function createCodexAdapter(options: CodexAdapterOptions = {}): HostAdapter {
  const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
  const reader = options.readUserSources ?? (() => existingMetadata(homeDirectory));
  return Object.freeze({ id: "codex" as const, managedRoots: MANAGED_ROOTS, detect: detectCodex,
    renderInstall: (context: HostInstallContext) => { refuseIssues(context.observation); if (context.command === "update" && context.observation.currentState === undefined) throw new InstallError("not_installed", STATE_PATH); const selected = selectedInstall(context); return compose(context, selected, preservedForUpdate(context, selected)); },
    renderUninstall: (context: HostUninstallContext) => { refuseIssues(context.observation); const selected = selectedUninstall(context); return compose(context, selected); },
    status: codexStatus, scanUserSources: (context: HostSourceScanContext) => scanCodexSources(context, reader) });
}
export const codexAdapter: HostAdapter = createCodexAdapter();
exports.STATE_PATH = STATE_PATH;
exports.managedPaths = () => Object.freeze([STATE_PATH]);
exports.createCodexAdapter = createCodexAdapter;
