/** OpenCode project adapter using project config, skill, and the stable local plugin API. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const { TextDecoder } = require("node:util") as typeof import("node:util");

import {
  CORE_SCHEMA_VERSION,
  InstallError,
  type DesiredState,
  type InstallState,
  type ManagedSectionRecord,
  type OriginalRecord,
  type ProjectTarget,
  type StatusIssue,
} from "../core/contracts.cjs";
import {
  parseJsoncObject,
  removeJsonObjectProperty,
  upsertJsonObjectProperty,
} from "../core/json-splice.cjs";
import { hasManagedRootResidue, validateManagedPath } from "../core/project-target.cjs";
import { createDesiredState, createStatusResult, parseInstallState } from "../core/state.cjs";
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
  type SourceScanResult,
} from "./user-sources.cjs";

type JsonMap = Record<string, unknown>;

interface OpenCodeObservationDetails {
  readonly stateBytes?: Buffer;
  readonly configPath: typeof CONFIG_CANDIDATES[number];
}

export interface OpenCodeAdapterOptions {
  readonly homeDirectory?: string;
}

const STATE_PATH = ".opencode/kcoderag-nav/install-state.json";
const PLUGIN_PATH = ".opencode/plugins/kcoderag-nav.js";
const SKILL_PATH = ".opencode/skills/kcoderag-nav/SKILL.md";
const MARKER_PATH = ".opencode/kcoderag-nav/hooks/mcp-call-marker.cjs";
const CONFIG_CANDIDATES = Object.freeze(["opencode.json", "opencode.jsonc"] as const);
const MANAGED_ROOTS = Object.freeze([".opencode", ...CONFIG_CANDIDATES] as const);
const MCP_NAME = "kcoderag-qa";
const MAX_USER_SOURCE_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function decodeUtf8(bytes: Buffer, safePath: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InstallError("invalid_utf8", safePath);
  }
}

function parseStrictJson(bytes: Buffer, code: string, safePath: string): JsonMap {
  try {
    const value: unknown = JSON.parse(decodeUtf8(bytes, safePath));
    if (!isRecord(value)) throw new Error("not_object");
    return value;
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError(code, safePath);
  }
}

function parseConfig(bytes: Buffer, code: string, safePath: string): JsonMap {
  try {
    return parseJsoncObject(decodeUtf8(bytes, safePath));
  } catch (error) {
    if (error instanceof InstallError) throw error;
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
  return readOptional(validateManagedPath(target, relativePath, MANAGED_ROOTS).absolutePath, relativePath);
}

function sourceAsset(packageRoot: string, relativePath: string): Buffer {
  try {
    return fs.readFileSync(path.join(packageRoot, ...relativePath.split("/")));
  } catch {
    throw new InstallError("missing_package_asset", relativePath);
  }
}

function readPackageVersion(packageRoot: string): string {
  let bytes: Buffer;
  try { bytes = fs.readFileSync(path.join(packageRoot, "package.json")); }
  catch { throw new InstallError("invalid_package", "package.json"); }
  const value = parseStrictJson(bytes, "invalid_package", "package.json");
  if (value.name !== "kcoderag-nav" || typeof value.version !== "string") {
    throw new InstallError("invalid_package", "package.json");
  }
  return value.version;
}

function environmentMcpEntry(packageRoot: string): JsonMap {
  const safePath = "kcoderag-qa/.mcp.json";
  const source = parseStrictJson(sourceAsset(packageRoot, safePath), "invalid_mcp_source", safePath);
  const sourceEntry = isRecord(source.mcpServers) ? source.mcpServers[MCP_NAME] : undefined;
  if (!isRecord(sourceEntry) || typeof sourceEntry.url !== "string") {
    throw new InstallError("invalid_mcp_source", safePath);
  }
  const headers = isRecord(sourceEntry.headers)
    ? sourceEntry.headers
    : isRecord(sourceEntry.http_headers)
      ? sourceEntry.http_headers
      : undefined;
  if (headers === undefined || !Object.entries(headers).every(([name, value]) =>
    name.length > 0 && typeof value === "string")) {
    throw new InstallError("invalid_mcp_source", safePath);
  }
  return { type: "remote", url: sourceEntry.url, enabled: true, headers };
}

function sectionDigest(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sectionRecord(
  value: unknown,
  fileExisted: boolean,
  createdContainers: readonly string[] = [],
): ManagedSectionRecord {
  return {
    id: `mcp.${MCP_NAME}`,
    digest: sectionDigest(value),
    fileExisted,
    createdContainers: [...createdContainers],
  };
}

function verifySection(record: ManagedSectionRecord, value: unknown, configPath: string): void {
  if (record.id !== `mcp.${MCP_NAME}` || sectionDigest(value) !== record.digest) {
    throw new InstallError("managed_content_changed", configPath);
  }
}

function renderConfig(
  current: Buffer | undefined,
  configPath: string,
  packageRoot: string,
  owned: ManagedSectionRecord | undefined,
): { readonly bytes: Buffer; readonly section: ManagedSectionRecord } {
  const document = current === undefined ? { mcp: {} as JsonMap } : parseConfig(current, "invalid_json", configPath);
  const mcpExisted = current !== undefined && document.mcp !== undefined;
  if (document.mcp === undefined) document.mcp = {};
  if (!isRecord(document.mcp)) throw new InstallError("invalid_json", configPath);
  if (owned !== undefined) verifySection(owned, document.mcp[MCP_NAME], configPath);
  else if (document.mcp[MCP_NAME] !== undefined) throw new InstallError("unmanaged_name_conflict", configPath);
  const entry = environmentMcpEntry(packageRoot);
  const preserve = owned !== undefined && sectionDigest(document.mcp[MCP_NAME]) === sectionDigest(entry);
  document.mcp[MCP_NAME] = entry;
  let bytes: Buffer;
  if (current === undefined) bytes = canonicalJson(document);
  else {
    try {
      bytes = preserve
        ? Buffer.from(current)
        : Buffer.from(upsertJsonObjectProperty(decodeUtf8(current, configPath), ["mcp"], MCP_NAME, entry), "utf8");
    } catch (error) {
      if (error instanceof InstallError) throw error;
      throw new InstallError("invalid_json", configPath);
    }
  }
  return {
    bytes,
    section: sectionRecord(entry, owned?.fileExisted ?? current !== undefined,
      owned?.createdContainers ?? (mcpExisted ? [] : ["mcp"])),
  };
}

function removeInstalledConfig(
  current: Buffer | null,
  configPath: string,
  record: ManagedSectionRecord | undefined,
): Buffer | null {
  if (current === null || record === undefined) throw new InstallError("invalid_state", STATE_PATH);
  const document = parseConfig(current, "invalid_json", configPath);
  if (!isRecord(document.mcp)) throw new InstallError("managed_content_changed", configPath);
  verifySection(record, document.mcp[MCP_NAME], configPath);
  delete document.mcp[MCP_NAME];
  let rendered: Buffer;
  try {
    rendered = Buffer.from(removeJsonObjectProperty(decodeUtf8(current, configPath), ["mcp"], MCP_NAME), "utf8");
    if (Object.keys(document.mcp).length === 0 && record.createdContainers?.includes("mcp")) {
      delete document.mcp;
      rendered = Buffer.from(removeJsonObjectProperty(decodeUtf8(rendered, configPath), [], "mcp"), "utf8");
    }
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError("managed_content_changed", configPath);
  }
  return !record.fileExisted && Object.keys(document).length === 0 ? null : rendered;
}

function configPathFromState(state: InstallState): typeof CONFIG_CANDIDATES[number] | undefined {
  const matches = CONFIG_CANDIDATES.filter((candidate) => state.managedFiles.includes(candidate));
  return matches.length === 1 ? matches[0] : undefined;
}

function selectConfigPath(
  target: ProjectTarget,
  state?: InstallState,
): typeof CONFIG_CANDIDATES[number] {
  const existing = CONFIG_CANDIDATES.filter((candidate) => readManagedOptional(target, candidate) !== undefined);
  const owned = state === undefined ? undefined : configPathFromState(state);
  if (state !== undefined && owned === undefined) throw new InstallError("invalid_state", STATE_PATH);
  if (existing.length > 1 || (owned !== undefined && existing.some((candidate) => candidate !== owned))) {
    throw new InstallError("ambiguous_project_config", ".");
  }
  return owned ?? existing[0] ?? "opencode.json";
}

function managedPaths(configPath: typeof CONFIG_CANDIDATES[number]): readonly string[] {
  return Object.freeze([configPath, PLUGIN_PATH, SKILL_PATH, MARKER_PATH, STATE_PATH].sort((left, right) => {
    if (left === STATE_PATH) return 1;
    if (right === STATE_PATH) return -1;
    return left.localeCompare(right);
  }));
}

function validateCurrentState(state: InstallState): InstallState {
  if (state.host !== "opencode") throw new InstallError("invalid_state", STATE_PATH);
  const configPath = configPathFromState(state);
  if (configPath === undefined) throw new InstallError("invalid_state", STATE_PATH);
  const paths = managedPaths(configPath);
  const dedicated = paths.filter((relativePath) => relativePath !== STATE_PATH && relativePath !== configPath);
  if (
    state.managedFiles.join("\0") !== paths.join("\0") ||
    Object.keys(state.originals).sort().join("\0") !== [...dedicated].sort().join("\0") ||
    Object.keys(state.digests).sort().join("\0") !== [...dedicated].sort().join("\0") ||
    Object.keys(state.sections ?? {}).join("\0") !== configPath ||
    state.sections?.[configPath]?.id !== `mcp.${MCP_NAME}`
  ) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  return state;
}

function issueFrom(error: unknown): StatusIssue {
  return error instanceof InstallError
    ? { code: error.code, path: error.safePath ?? "." }
    : { code: "invalid", path: "." };
}

function details(observation: HostObservation): OpenCodeObservationDetails {
  return observation.details as OpenCodeObservationDetails;
}

function detectOpenCode(context: { readonly target: ProjectTarget }): HostObservation {
  const stateBytes = readManagedOptional(context.target, STATE_PATH);
  try {
    const currentState = stateBytes === undefined ? undefined : validateCurrentState(parseInstallState(stateBytes));
    const configPath = selectConfigPath(context.target, currentState);
    if (currentState !== undefined) {
      const configBytes = readManagedOptional(context.target, configPath);
      const record = currentState.sections?.[configPath];
      if (configBytes === undefined || record === undefined) {
        throw new InstallError("managed_content_changed", configPath);
      }
      const document = parseConfig(configBytes, "invalid_json", configPath);
      if (!isRecord(document.mcp)) throw new InstallError("managed_content_changed", configPath);
      verifySection(record, document.mcp[MCP_NAME], configPath);
      for (const [relativePath, digest] of Object.entries(currentState.digests)) {
        const current = readManagedOptional(context.target, relativePath);
        if (current === undefined || sha256(current) !== digest) {
          throw new InstallError("managed_content_changed", relativePath);
        }
      }
    }
    return Object.freeze({
      host: "opencode" as const,
      target: context.target,
      ...(currentState === undefined ? {} : { currentState }),
      details: Object.freeze({
        configPath,
        ...(stateBytes === undefined ? {} : { stateBytes: Buffer.from(stateBytes) }),
      }),
    });
  } catch (error) {
    return Object.freeze({
      host: "opencode" as const,
      target: context.target,
      issues: Object.freeze([issueFrom(error)]),
      details: Object.freeze({ configPath: "opencode.json", ...(stateBytes === undefined ? {} : { stateBytes }) }),
    });
  }
}

function refuseIssues(observation: HostObservation): void {
  const issue = observation.issues?.[0];
  if (issue !== undefined) throw new InstallError(issue.code, issue.path);
}

function encodeOriginal(bytes: Buffer | undefined): OriginalRecord {
  return bytes === undefined ? { kind: "absent" } : { kind: "base64", data: bytes.toString("base64") };
}

function decodeOriginal(record: OriginalRecord | undefined, relativePath: string): Buffer | null {
  if (record === undefined) throw new InstallError("invalid_state", relativePath);
  return record.kind === "absent" ? null : Buffer.from(record.data ?? "", "base64");
}

function expectedDigest(
  target: ProjectTarget,
  relativePath: string,
  state: InstallState | undefined,
  stateBytes: Buffer | undefined,
  configPath: string,
): string | null {
  if (relativePath === STATE_PATH) return stateBytes === undefined ? null : sha256(stateBytes);
  if (state !== undefined && relativePath !== configPath) return state.digests[relativePath] ?? null;
  const current = readManagedOptional(target, relativePath);
  return current === undefined ? null : sha256(current);
}

function renderInstall(context: HostInstallContext): DesiredState {
  refuseIssues(context.observation);
  const existing = context.observation.currentState;
  if (context.command === "update" && existing === undefined) throw new InstallError("not_installed", STATE_PATH);
  const observationDetails = details(context.observation);
  const configPath = observationDetails.configPath;
  const paths = managedPaths(configPath);
  const originals: Record<string, OriginalRecord> = existing === undefined ? {} : { ...existing.originals };
  for (const relativePath of paths) {
    if (relativePath === STATE_PATH || relativePath === configPath || originals[relativePath] !== undefined) continue;
    const current = readManagedOptional(context.target, relativePath);
    if (current !== undefined) throw new InstallError("unmanaged_name_conflict", relativePath);
    originals[relativePath] = encodeOriginal(undefined);
  }
  const currentConfig = readManagedOptional(context.target, configPath);
  const renderedConfig = renderConfig(currentConfig, configPath, context.packageRoot, existing?.sections?.[configPath]);
  const payloads = new Map<string, Buffer>([
    [configPath, renderedConfig.bytes],
    [PLUGIN_PATH, sourceAsset(context.packageRoot, "kcoderag-qa/opencode/kcoderag-nav.js")],
    [SKILL_PATH, sourceAsset(context.packageRoot, "kcoderag-qa/skills/code-lookup-discipline/SKILL.md")],
    [MARKER_PATH, sourceAsset(context.packageRoot, "kcoderag-qa/hooks/mcp-call-marker.cjs")],
  ]);
  const digests: Record<string, string> = {};
  for (const [relativePath, bytes] of payloads) {
    if (relativePath !== configPath) digests[relativePath] = sha256(bytes);
  }
  const state: InstallState = {
    schemaVersion: CORE_SCHEMA_VERSION,
    packageVersion: readPackageVersion(context.packageRoot),
    host: "opencode",
    environment: "qa",
    managedFiles: [...paths],
    originals,
    digests,
    sections: { [configPath]: renderedConfig.section },
  };
  payloads.set(STATE_PATH, canonicalJson(state));
  return createDesiredState({
    host: "opencode",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: paths.map((relativePath) => ({
      relativePath,
      expectedDigest: expectedDigest(
        context.target, relativePath, existing, observationDetails.stateBytes, configPath,
      ),
      content: payloads.get(relativePath) ?? null,
    })),
  });
}

function renderUninstall(context: HostUninstallContext): DesiredState {
  refuseIssues(context.observation);
  const state = context.observation.currentState;
  const observationDetails = details(context.observation);
  if (state === undefined || observationDetails.stateBytes === undefined) {
    throw new InstallError("not_installed", STATE_PATH);
  }
  const configPath = observationDetails.configPath;
  const configPayload = removeInstalledConfig(
    readManagedOptional(context.target, configPath) ?? null,
    configPath,
    state.sections?.[configPath],
  );
  return createDesiredState({
    host: "opencode",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: state.managedFiles.map((relativePath) => ({
      relativePath,
      expectedDigest: expectedDigest(
        context.target, relativePath, state, observationDetails.stateBytes, configPath,
      ),
      content: relativePath === STATE_PATH
        ? null
        : relativePath === configPath
          ? configPayload
          : decodeOriginal(state.originals[relativePath], relativePath),
    })),
  });
}

function openCodeStatus(context: HostStatusContext) {
  const issue = context.observation.issues?.[0];
  if (issue !== undefined) {
    return createStatusResult({
      status: issue.code === "managed_content_changed" ? "drifted" : "invalid",
      host: "opencode",
      issues: [issue],
    });
  }
  const state = context.observation.currentState;
  if (state === undefined) {
    const root = validateManagedPath(context.target, STATE_PATH, MANAGED_ROOTS);
    if (hasManagedRootResidue(path.dirname(root.absolutePath))) {
      return createStatusResult({
        status: "invalid",
        host: "opencode",
        issues: [{ code: "orphaned_managed_root", path: ".opencode/kcoderag-nav" }],
      });
    }
    return createStatusResult({ host: "opencode" });
  }
  try {
    const rendered = renderInstall({
      target: context.target,
      packageRoot: context.packageRoot,
      command: "install",
      environment: "qa",
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
      host: "opencode",
      environment: "qa",
      issues: updateAvailable ? [{ code: "source_update_available", path: ".opencode/kcoderag-nav" }] : [],
    });
  } catch (error) {
    return createStatusResult({
      status: "invalid",
      host: "opencode",
      environment: "qa",
      issues: [issueFrom(error)],
    });
  }
}

function boundedUserText(filePath: string): string | undefined {
  try {
    const metadata = fs.lstatSync(filePath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_USER_SOURCE_BYTES) return undefined;
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

function scanOpenCodeUserSources(homeDirectory: string, context: HostSourceScanContext): SourceScanResult {
  const root = path.join(homeDirectory, ".config", "opencode");
  const findings = [];
  for (const name of CONFIG_CANDIDATES) {
    const text = boundedUserText(path.join(root, name));
    if (text !== undefined && /kcoderag(?:-qa|-nav)?/iu.test(text)) {
      findings.push(createSourceFinding({
        code: "raw_mcp_source",
        severity: "conflict",
        sourceType: "raw_mcp",
        scope: "user",
        safePath: `.config/opencode/${name}`,
        cleanupEligible: false,
      }));
    }
  }
  for (const [relativePath, sourceType] of [
    ["plugins/kcoderag-nav.js", "active_plugin"],
    ["plugins/kcoderag-nav.ts", "active_plugin"],
    ["skills/kcoderag-nav/SKILL.md", "manual_rule"],
  ] as const) {
    try {
      const metadata = fs.lstatSync(path.join(root, ...relativePath.split("/")));
      if (metadata.isSymbolicLink() || !metadata.isFile()) continue;
      findings.push(createSourceFinding({
        code: sourceType === "active_plugin" ? "active_plugin_source" : "manual_skill_source",
        severity: "conflict",
        sourceType,
        scope: "user",
        safePath: `.config/opencode/${relativePath}`,
        cleanupEligible: false,
      }));
    } catch {
      // Missing and unreadable user paths do not expose their contents; other sources still report.
    }
  }
  return createSourceScanResult(context.mode, findings);
}

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions = {}): HostAdapter {
  const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
  return Object.freeze({
    id: "opencode" as const,
    managedRoots: MANAGED_ROOTS,
    detect: detectOpenCode,
    renderInstall,
    renderUninstall,
    status: openCodeStatus,
    scanUserSources: (context: HostSourceScanContext) => scanOpenCodeUserSources(homeDirectory, context),
  });
}

export const opencodeAdapter: HostAdapter = createOpenCodeAdapter();

exports.STATE_PATH = STATE_PATH;
exports.managedPaths = managedPaths;
exports.createOpenCodeAdapter = createOpenCodeAdapter;
