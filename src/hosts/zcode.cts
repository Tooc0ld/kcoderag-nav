/** ZCode project-only navigation projection; current project Hooks are intentionally unsupported. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const { URL } = require("node:url") as typeof import("node:url");

import {
  composeCapabilitySet,
  type ProjectedCapabilityContribution,
  type ProjectedCapabilityFile,
  type ProjectedCapabilitySection,
} from "../capabilities/compose.cjs";
import type { CapabilityId } from "../capabilities/contracts.cjs";
import { getCapabilityProvider, resolveCapabilitySelection } from "../capabilities/registry.cjs";
import {
  InstallError,
  type InstallState,
  type OriginalRecord,
  type ProjectTarget,
  type StatusIssue,
} from "../core/contracts.cjs";
import { upsertJsonObjectProperty } from "../core/json-splice.cjs";
import { hasManagedRootResidue, validateManagedPath } from "../core/project-target.cjs";
import { createStatusResult, parseInstallState } from "../core/state.cjs";
import type {
  HostAdapter,
  HostInstallContext,
  HostObservation,
  HostSourceScanContext,
  HostStatusContext,
  HostUninstallContext,
} from "./host-adapter.cjs";
import {
  createSourceFinding,
  createSourceScanResult,
  inspectNativeJsonSource,
  inspectNativePath,
  type SourceScanResult,
} from "./user-sources.cjs";

type JsonMap = Record<string, unknown>;

export interface ZCodeUserSourceMetadata {
  readonly activePluginPaths?: readonly string[];
  readonly rawMcpPaths?: readonly string[];
  readonly manualHookPaths?: readonly string[];
  readonly cachePaths?: readonly string[];
  readonly disabledPaths?: readonly string[];
  readonly ambiguousPaths?: readonly string[];
}

export interface ZCodeAdapterOptions {
  readonly homeDirectory?: string;
  readonly readUserSources?: () => ZCodeUserSourceMetadata | Promise<ZCodeUserSourceMetadata>;
  readonly hostVersion?: string;
  readonly evidenceRoot?: string;
  readonly readHostVersion?: () => string | undefined;
}

interface Extras {
  readonly selectedCapabilities?: readonly CapabilityId[];
  readonly hostVersion?: string;
  readonly evidenceRoot?: string;
}

interface Details {
  readonly stateBytes?: Buffer;
}

const STATE_PATH = ".zcode/kcoderag-nav/install-state.json";
const CONFIG_PATH = ".zcode/config.json";
const NAV_SKILL_PATH = ".zcode/skills/kcoderag-nav/SKILL.md";
const MANAGED_ROOTS = Object.freeze([".zcode"] as const);
const NAVIGATION = "kcoderag-navigation" as const;
const JX3 = "jx3-style-nudge" as const;

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseJson(bytes: Buffer, code: string, safePath: string): JsonMap {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (isRecord(value)) return value;
  } catch {
    // Stable refusal below.
  }
  throw new InstallError(code, safePath);
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
    const root = path.resolve(packageRoot);
    const absolute = path.resolve(root, ...relativePath.split("/"));
    const relation = path.relative(root, absolute);
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
  const value = parseJson(sourceAsset(packageRoot, "package.json"), "invalid_package", "package.json");
  if (value.name !== "kcoderag-nav" || typeof value.version !== "string" || value.version.length === 0) {
    throw new InstallError("invalid_package", "package.json");
  }
  return value.version;
}

function zcodeRemoteUrl(value: string, safePath: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InstallError("invalid_mcp_source", safePath);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InstallError("invalid_mcp_source", safePath);
  }
  if (!parsed.pathname.endsWith("/mcp/")) return value;

  // ZCode 3.9.2 treats the final slash as a distinct endpoint and does not follow it.
  const suffixIndex = [value.indexOf("?"), value.indexOf("#")]
    .filter((index) => index >= 0)
    .reduce((current, index) => Math.min(current, index), value.length);
  return `${value.slice(0, suffixIndex - 1)}${value.slice(suffixIndex)}`;
}

function remoteEntry(packageRoot: string): JsonMap {
  const safePath = "kcoderag-qa/.mcp.json";
  const source = parseJson(sourceAsset(packageRoot, safePath), "invalid_mcp_source", safePath);
  const raw = isRecord(source.mcpServers) ? source.mcpServers["kcoderag-qa"] : undefined;
  if (!isRecord(raw) || typeof raw.url !== "string") {
    throw new InstallError("invalid_mcp_source", safePath);
  }
  const headers = isRecord(raw.headers)
    ? raw.headers
    : isRecord(raw.http_headers)
      ? raw.http_headers
      : undefined;
  if (headers === undefined || !Object.values(headers).every((value) => typeof value === "string")) {
    throw new InstallError("invalid_mcp_source", safePath);
  }
  // Native ZCode treats a missing `enable` field as enabled and writes only `enable: false` on disable.
  return Object.freeze({ type: "http", url: zcodeRemoteUrl(raw.url, safePath), headers });
}

function encodeOriginal(bytes: Buffer | undefined): OriginalRecord {
  return bytes === undefined
    ? Object.freeze({ kind: "absent" as const })
    : Object.freeze({ kind: "base64" as const, data: bytes.toString("base64") });
}

function stateBytes(observation: HostObservation): Buffer | undefined {
  const bytes = (observation.details as Details | undefined)?.stateBytes;
  return bytes === undefined ? undefined : Buffer.from(bytes);
}

function verifyState(target: ProjectTarget, state: InstallState): void {
  if (state.host !== "zcode") throw new InstallError("invalid_state", STATE_PATH);
  for (const record of state.files) {
    const bytes = readRegular(target, record.path);
    if (bytes === undefined || sha256(bytes) !== record.digest) {
      throw new InstallError("managed_content_changed", record.path);
    }
  }
}

function detectZCode(context: { readonly target: ProjectTarget }): HostObservation {
  let bytes: Buffer | undefined;
  try {
    bytes = readRegular(context.target, STATE_PATH);
    const currentState = bytes === undefined ? undefined : parseInstallState(bytes);
    if (currentState !== undefined) verifyState(context.target, currentState);
    return Object.freeze({
      host: "zcode" as const,
      target: context.target,
      ...(currentState === undefined ? {} : { currentState }),
      details: Object.freeze(bytes === undefined ? {} : { stateBytes: Buffer.from(bytes) }),
    });
  } catch (error) {
    return Object.freeze({
      host: "zcode" as const,
      target: context.target,
      issues: Object.freeze([issueFrom(error)]),
      details: Object.freeze(bytes === undefined ? {} : { stateBytes: Buffer.from(bytes) }),
    });
  }
}

function refuse(observation: HostObservation): void {
  const issue = observation.issues?.[0];
  if (issue !== undefined) throw new InstallError(issue.code, issue.path);
}

function selectedInstall(context: HostInstallContext): readonly CapabilityId[] {
  const request = (context as HostInstallContext & Extras).selectedCapabilities ??
    (context.command === "update"
      ? context.observation.currentState?.capabilities.map((entry) => entry.id)
      : [NAVIGATION]);
  if (request === undefined) throw new InstallError("not_installed", STATE_PATH);
  const existing = context.observation.currentState?.capabilities.map((entry) => entry.id) ?? [];
  return Object.freeze(resolveCapabilitySelection([...existing, ...request]).map((entry) => entry.id));
}

function preservedForUpdate(
  context: HostInstallContext,
  selected: readonly CapabilityId[],
): readonly CapabilityId[] {
  if (context.command !== "update" || context.observation.currentState === undefined) {
    return Object.freeze([]);
  }
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

function assertSupport(
  selected: readonly CapabilityId[],
  context: HostInstallContext | HostUninstallContext,
  options: ZCodeAdapterOptions,
): void {
  if (!selected.includes(JX3)) return;
  const extras = context as (HostInstallContext | HostUninstallContext) & Extras;
  const hostVersion = extras.hostVersion ?? options.hostVersion ?? options.readHostVersion?.();
  if (hostVersion === undefined) throw new InstallError("host_version_unsupported");
  const decision = getCapabilityProvider(JX3).evaluateSupport({
    host: "zcode",
    hostVersion,
    evidenceRoot: extras.evidenceRoot ?? options.evidenceRoot ?? context.packageRoot,
  });
  if (!decision.eligible) throw new InstallError(decision.code);
}

function mergeConfig(current: Buffer | undefined, packageRoot: string, owned: boolean) {
  const original = current?.toString("utf8") ?? "{}\n";
  let document: JsonMap;
  try {
    const value: unknown = JSON.parse(original);
    if (!isRecord(value)) throw new Error("not object");
    document = value;
  } catch {
    throw new InstallError("invalid_json", CONFIG_PATH);
  }
  const mcp = document.mcp === undefined ? {} : document.mcp;
  if (!isRecord(mcp)) throw new InstallError("invalid_json", CONFIG_PATH);
  const servers = mcp.servers === undefined ? {} : mcp.servers;
  if (!isRecord(servers)) throw new InstallError("invalid_json", CONFIG_PATH);
  if (!owned && servers["kcoderag-qa"] !== undefined) {
    throw new InstallError("unmanaged_name_conflict", CONFIG_PATH);
  }
  const entry = remoteEntry(packageRoot);
  let text: string;
  try {
    text = upsertJsonObjectProperty(original, ["mcp", "servers"], "kcoderag-qa", entry);
  } catch {
    throw new InstallError("invalid_json", CONFIG_PATH);
  }
  return Object.freeze({
    bytes: Buffer.from(text.endsWith("\n") ? text : `${text}\n`, "utf8"),
    entry,
  });
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
  if (previous !== undefined) {
    return Object.freeze({ relativePath, expectedDigest: previous.digest, content, shared });
  }
  const current = readRegular(target, relativePath);
  if (current !== undefined && !allowExisting) {
    throw new InstallError("unmanaged_name_conflict", relativePath);
  }
  return Object.freeze({
    relativePath,
    expectedDigest: current === undefined ? null : sha256(current),
    content,
    original: encodeOriginal(current),
    shared,
  });
}

function section(
  relativePath: string,
  id: string,
  value: unknown,
  fileExisted: boolean,
): ProjectedCapabilitySection {
  return Object.freeze({
    relativePath,
    id,
    digest: sha256(JSON.stringify(value)),
    fileExisted,
    shared: true,
  });
}

function contributions(
  target: ProjectTarget,
  packageRoot: string,
  projected: readonly CapabilityId[],
  state: InstallState | undefined,
): readonly ProjectedCapabilityContribution[] {
  if (!projected.includes(NAVIGATION)) return Object.freeze([]);
  const currentConfig = readRegular(target, CONFIG_PATH);
  const config = mergeConfig(currentConfig, packageRoot, state !== undefined);
  return Object.freeze([
    Object.freeze({
      capabilityId: NAVIGATION,
      files: Object.freeze([
        projectedFile(target, state, CONFIG_PATH, config.bytes, true, true),
        projectedFile(
          target,
          state,
          NAV_SKILL_PATH,
          sourceAsset(packageRoot, "kcoderag-qa/skills/code-lookup-discipline/SKILL.md"),
          false,
        ),
      ]),
      sections: Object.freeze([
        section(CONFIG_PATH, "navigation:mcp", config.entry, currentConfig !== undefined),
      ]),
    }),
  ]);
}

function compose(
  context: HostInstallContext | HostUninstallContext,
  selected: readonly CapabilityId[],
  preserved: readonly CapabilityId[] = [],
) {
  const previousState = context.observation.currentState;
  const bytes = stateBytes(context.observation);
  const projected = selected.filter((id) => !preserved.includes(id));
  const reconciled = preserved.length === 0
    ? Object.freeze([])
    : contributions(context.target, context.packageRoot, preserved, previousState);
  return composeCapabilitySet({
    host: "zcode",
    target: context.target,
    packageVersion: packageVersion(context.packageRoot),
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    stateExpectedDigest: bytes === undefined ? null : sha256(bytes),
    selectedCapabilities: selected,
    preservedCapabilities: preserved,
    contributions: contributions(context.target, context.packageRoot, projected, previousState),
    reconciledContributions: reconciled,
    ...(previousState === undefined ? {} : { previousState }),
  });
}

function status(context: HostStatusContext) {
  const issue = context.observation.issues?.[0];
  if (issue !== undefined) {
    return createStatusResult({
      status: issue.code === "managed_content_changed" ? "drifted" : "invalid",
      host: "zcode",
      issues: [issue],
    });
  }
  if (context.observation.currentState !== undefined) {
    return createStatusResult({ status: "healthy", host: "zcode" });
  }
  const root = validateManagedPath(context.target, STATE_PATH, MANAGED_ROOTS);
  return hasManagedRootResidue(path.dirname(root.absolutePath))
    ? createStatusResult({
        status: "invalid",
        host: "zcode",
        issues: [{ code: "orphaned_managed_root", path: ".zcode/kcoderag-nav" }],
      })
    : createStatusResult({ host: "zcode" });
}

function defaultMetadata(homeDirectory: string): ZCodeUserSourceMetadata {
  const configPath = ".zcode/cli/config.json";
  const config = inspectNativeJsonSource(homeDirectory, configPath);
  const ambiguousPaths: string[] = [];
  if (config.ambiguous) ambiguousPaths.push(configPath);
  const skillPath = ".zcode/skills/kcoderag-nav/SKILL.md";
  if (inspectNativePath(homeDirectory, skillPath) !== "absent") ambiguousPaths.push(skillPath);
  return Object.freeze({
    activePluginPaths: Object.freeze(config.activePlugin ? [configPath] : []),
    rawMcpPaths: Object.freeze(config.rawMcp ? [configPath] : []),
    manualHookPaths: Object.freeze(config.manualHook ? [configPath] : []),
    ambiguousPaths: Object.freeze([...new Set(ambiguousPaths)].sort()),
  });
}

function values(
  metadata: ZCodeUserSourceMetadata,
  key: keyof ZCodeUserSourceMetadata,
): readonly string[] {
  const value = metadata[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

async function scanSources(
  context: HostSourceScanContext,
  reader: () => ZCodeUserSourceMetadata | Promise<ZCodeUserSourceMetadata>,
): Promise<SourceScanResult> {
  let metadata: ZCodeUserSourceMetadata;
  try {
    metadata = await reader();
  } catch {
    metadata = { ambiguousPaths: [".zcode/cli/config.json"] };
  }
  const findings = [
    ...values(metadata, "activePluginPaths").map((safePath) => createSourceFinding({
      code: "active_plugin_source",
      severity: "conflict",
      sourceType: "active_plugin",
      scope: "user",
      safePath,
    })),
    ...values(metadata, "rawMcpPaths").map((safePath) => createSourceFinding({
      code: "raw_mcp_source",
      severity: "conflict",
      sourceType: "raw_mcp",
      scope: "user",
      safePath,
    })),
    ...values(metadata, "manualHookPaths").map((safePath) => createSourceFinding({
      code: "manual_hook_source",
      severity: "conflict",
      sourceType: "manual_hook",
      scope: "user",
      safePath,
    })),
    ...values(metadata, "ambiguousPaths").map((safePath) => createSourceFinding({
      code: "ambiguous_source",
      severity: "conflict",
      sourceType: "ambiguous",
      scope: "user",
      safePath,
    })),
  ];
  if (context.mode !== "fast") {
    findings.push(
      ...values(metadata, "cachePaths").map((safePath) => createSourceFinding({
        code: "cache_residue",
        severity: "info",
        sourceType: "cache_residue",
        scope: "user",
        safePath,
      })),
      ...values(metadata, "disabledPaths").map((safePath) => createSourceFinding({
        code: "disabled_source",
        severity: "info",
        sourceType: "disabled_registration",
        scope: "user",
        safePath,
      })),
    );
  }
  return createSourceScanResult(context.mode, findings);
}

export function createZCodeAdapter(options: ZCodeAdapterOptions = {}): HostAdapter {
  const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
  const reader = options.readUserSources ?? (() => defaultMetadata(homeDirectory));
  return Object.freeze({
    id: "zcode" as const,
    managedRoots: MANAGED_ROOTS,
    detect: detectZCode,
    renderInstall: (context: HostInstallContext) => {
      refuse(context.observation);
      if (context.command === "update" && context.observation.currentState === undefined) {
        throw new InstallError("not_installed", STATE_PATH);
      }
      const selected = selectedInstall(context);
      assertSupport(selected, context, options);
      return compose(context, selected, preservedForUpdate(context, selected));
    },
    renderUninstall: (context: HostUninstallContext) => {
      refuse(context.observation);
      const selected = selectedUninstall(context);
      assertSupport(selected, context, options);
      return compose(context, selected);
    },
    status,
    scanUserSources: (context: HostSourceScanContext) => scanSources(context, reader),
  });
}

export const zcodeAdapter: HostAdapter = createZCodeAdapter();

exports.STATE_PATH = STATE_PATH;
exports.managedPaths = () => Object.freeze([STATE_PATH]);
exports.createZCodeAdapter = createZCodeAdapter;
