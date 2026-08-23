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
  original: Buffer | undefined,
  packageRoot: string,
  environment: EnvironmentId,
): Buffer {
  const document = original === undefined
    ? { mcpServers: {} as JsonMap }
    : parseJsonBytes(original, "invalid_json", MCP_PATH);
  if (document.mcpServers === undefined) document.mcpServers = {};
  if (!isRecord(document.mcpServers)) throw new InstallError("invalid_json", MCP_PATH);
  if (document.mcpServers["kcoderag-qa"] !== undefined || document.mcpServers["kcoderag-dev"] !== undefined) {
    throw new InstallError("unmanaged_name_conflict", MCP_PATH);
  }
  const source = readMcpServer(packageRoot, environment);
  document.mcpServers[source.name] = source.entry;
  return canonicalJson(document);
}

function renderSettings(original: Buffer | undefined, environment: EnvironmentId): Buffer {
  const document = original === undefined
    ? {}
    : parseJsonBytes(original, "invalid_json", SETTINGS_PATH);
  if (document.hooks === undefined) document.hooks = {};
  if (!isRecord(document.hooks)) throw new InstallError("invalid_json", SETTINGS_PATH);
  const hooks = document.hooks;
  if (hooks.PreToolUse === undefined) hooks.PreToolUse = [];
  if (!Array.isArray(hooks.PreToolUse) || !hooks.PreToolUse.every(isRecord)) {
    throw new InstallError("invalid_json", SETTINGS_PATH);
  }
  const encoded = JSON.stringify(document);
  if (
    encoded.includes(".claude/kcoderag-nav/") ||
    encoded.includes(".claude\\kcoderag-nav\\") ||
    encoded.includes("Checking code lookup strategy (KCodeRag")
  ) {
    throw new InstallError("unmanaged_name_conflict", SETTINGS_PATH);
  }
  const prefix = hookPrefix(environment);
  hooks.PreToolUse.push({
    matcher: "^(Grep|Glob|Bash)$",
    hooks: [{
      type: "command",
      command: `sh \"${prefix}/run_hook.sh\"`,
      commandWindows: `call \"${prefix.replaceAll("/", "\\\\")}\\\\run_hook.cmd\"`,
      timeout: 5,
      statusMessage: `Checking code lookup strategy (KCodeRag ${environment.toUpperCase()})`,
      additionalContextLimit: 600,
    }],
  });
  return canonicalJson(document);
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
  if (
    state.managedFiles.join("\0") !== paths.join("\0") ||
    Object.keys(state.originals).sort().join("\0") !== [...owned].sort().join("\0") ||
    Object.keys(state.digests).sort().join("\0") !== [...owned].sort().join("\0")
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
    const current = readManagedOptional(target, relativePath);
    if (![MCP_PATH, SETTINGS_PATH].includes(relativePath) && current !== undefined) {
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
  originals: Readonly<Record<string, OriginalRecord>>,
): Map<string, Buffer> {
  const name = packageName(context.environment);
  const originalMcp = decodeOriginal(originals[MCP_PATH], MCP_PATH) ?? undefined;
  const originalSettings = decodeOriginal(originals[SETTINGS_PATH], SETTINGS_PATH) ?? undefined;
  const payloads = new Map<string, Buffer>();
  payloads.set(MCP_PATH, renderMcp(originalMcp, context.packageRoot, context.environment));
  payloads.set(SETTINGS_PATH, renderSettings(originalSettings, context.environment));
  payloads.set(SKILL_PATH, sourceAsset(context.packageRoot, `${name}/skills/code-lookup-discipline/SKILL.md`));
  for (const asset of HOOK_ASSETS) {
    payloads.set(`${hookPrefix(context.environment)}/${asset}`, sourceAsset(context.packageRoot, `${name}/hooks/${asset}`));
  }
  return payloads;
}

function renderInstall(context: HostInstallContext): DesiredState {
  refuseIssues(context.observation);
  const existing = context.observation.currentState;
  if (context.command === "update" && existing === undefined) throw new InstallError("not_installed", STATE_PATH);
  if (existing !== undefined && existing.environment !== context.environment) {
    throw new InstallError("environment_conflict", STATE_PATH);
  }
  const paths = managedPaths(context.environment);
  const originals = existing?.originals ?? captureOriginals(context.target, context.environment);
  const payloads = desiredPayloads(context, originals);
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

function renderUninstall(context: HostUninstallContext): DesiredState {
  refuseIssues(context.observation);
  const state = context.observation.currentState;
  const stateBytes = details(context.observation).stateBytes;
  if (state === undefined || stateBytes === undefined) throw new InstallError("not_installed", STATE_PATH);
  if (state.environment !== context.environment) throw new InstallError("environment_not_installed", STATE_PATH);
  return createDesiredState({
    host: "claude",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: managedPaths(state.environment).map((relativePath) => ({
      relativePath,
      expectedDigest: relativePath === STATE_PATH ? sha256(stateBytes) : state.digests[relativePath] ?? null,
      content: relativePath === STATE_PATH ? null : decodeOriginal(state.originals[relativePath], relativePath),
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
