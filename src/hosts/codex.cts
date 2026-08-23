/** Codex project-native adapter with narrow section/file ownership. */

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

interface CodexObservationDetails {
  readonly stateBytes?: Buffer;
}

const STATE_PATH = ".codex/kcoderag-nav/install-state.json";
const CONFIG_PATH = ".codex/config.toml";
const HOOKS_PATH = ".codex/hooks.json";
const SKILL_PATH = ".agents/skills/kcoderag-nav/SKILL.md";
const MANAGED_ROOTS = Object.freeze([".agents", ".codex"] as const);
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

function hookPrefix(environment: EnvironmentId): string {
  return `.codex/kcoderag-nav/${environment}/hooks`;
}

function managedPaths(environment: EnvironmentId): readonly string[] {
  return Object.freeze(
    [
      SKILL_PATH,
      CONFIG_PATH,
      HOOKS_PATH,
      ...HOOK_ASSETS.map((name) => `${hookPrefix(environment)}/${name}`),
      STATE_PATH,
    ].sort((left, right) => {
      if (left === STATE_PATH) return 1;
      if (right === STATE_PATH) return -1;
      return left.localeCompare(right);
    }),
  );
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

function readPackageVersion(packageRoot: string): string {
  const relativePath = "package.json";
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(packageRoot, relativePath));
  } catch {
    throw new InstallError("invalid_package", relativePath);
  }
  const document = parseJsonBytes(bytes, "invalid_package", relativePath);
  if (document.name !== "kcoderag-nav" || typeof document.version !== "string") {
    throw new InstallError("invalid_package", relativePath);
  }
  return document.version;
}

function packageName(environment: EnvironmentId): string {
  return `kcoderag-${environment}`;
}

function readMcpEntry(packageRoot: string, environment: EnvironmentId): {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
} {
  const name = packageName(environment);
  const relativePath = `${name}/.codex.mcp.json`;
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(packageRoot, ...relativePath.split("/")));
  } catch {
    throw new InstallError("invalid_mcp_source", relativePath);
  }
  const source = parseJsonBytes(bytes, "invalid_mcp_source", relativePath);
  const servers = isRecord(source.mcpServers) ? source.mcpServers : source;
  const entry = servers[name];
  if (!isRecord(entry) || typeof entry.url !== "string") {
    throw new InstallError("invalid_mcp_source", relativePath);
  }
  const headers = isRecord(entry.http_headers)
    ? entry.http_headers
    : isRecord(entry.headers)
      ? entry.headers
      : undefined;
  if (
    headers === undefined ||
    !Object.entries(headers).every(([key, value]) => key.length > 0 && typeof value === "string")
  ) {
    throw new InstallError("invalid_mcp_source", relativePath);
  }
  return { name, url: entry.url, headers: headers as Record<string, string> };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function renderConfig(
  original: Buffer | undefined,
  packageRoot: string,
  environment: EnvironmentId,
): Buffer {
  let originalText: string;
  try {
    originalText = (original ?? Buffer.alloc(0)).toString("utf8");
  } catch {
    throw new InstallError("invalid_utf8", CONFIG_PATH);
  }
  if (
    originalText.includes("# BEGIN KCODERAG-NAV") ||
    /\[\s*mcp_servers\.(?:"|')?kcoderag-(?:qa|dev)(?:"|')?\s*\]/m.test(originalText)
  ) {
    throw new InstallError("unmanaged_name_conflict", CONFIG_PATH);
  }
  const entry = readMcpEntry(packageRoot, environment);
  const headers = Object.entries(entry.headers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`)
    .join(", ");
  const block = [
    `# BEGIN KCODERAG-NAV ${environment}`,
    `[mcp_servers.${tomlString(entry.name)}]`,
    `url = ${tomlString(entry.url)}`,
    `http_headers = { ${headers} }`,
    `# END KCODERAG-NAV ${environment}`,
    "",
  ].join("\n");
  const separator = originalText.length === 0 || originalText.endsWith("\n\n")
    ? ""
    : originalText.endsWith("\n")
      ? "\n"
      : "\n\n";
  return Buffer.from(`${originalText}${separator}${block}`, "utf8");
}

function renderHooks(original: Buffer | undefined, environment: EnvironmentId): Buffer {
  const document = original === undefined
    ? { hooks: {} as JsonMap }
    : parseJsonBytes(original, "invalid_json", HOOKS_PATH);
  if (document.hooks === undefined) document.hooks = {};
  if (!isRecord(document.hooks)) throw new InstallError("invalid_json", HOOKS_PATH);
  const hooks = document.hooks;
  if (hooks.PreToolUse === undefined) hooks.PreToolUse = [];
  if (!Array.isArray(hooks.PreToolUse) || !hooks.PreToolUse.every(isRecord)) {
    throw new InstallError("invalid_json", HOOKS_PATH);
  }
  const encoded = JSON.stringify(document);
  if (
    encoded.includes(".codex/kcoderag-nav/") ||
    encoded.includes(".codex\\kcoderag-nav\\")
  ) {
    throw new InstallError("unmanaged_name_conflict", HOOKS_PATH);
  }
  const prefix = hookPrefix(environment);
  hooks.PreToolUse.push({
    matcher: "Grep|Glob|Bash",
    hooks: [
      {
        type: "command",
        command: `sh \"${prefix}/run_hook.sh\"`,
        commandWindows: `call \"${prefix.replaceAll("/", "\\\\")}\\\\run_hook.cmd\"`,
        timeout: 5,
        statusMessage: `Checking code lookup strategy (${environment.toUpperCase()})`,
      },
    ],
  });
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function encodeOriginal(bytes: Buffer | undefined): OriginalRecord {
  return bytes === undefined
    ? { kind: "absent" }
    : { kind: "base64", data: bytes.toString("base64") };
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
  if (error instanceof InstallError) {
    return { code: error.code, path: error.safePath ?? "." };
  }
  return { code: "invalid", path: "." };
}

function validateCurrentState(state: InstallState): InstallState {
  if (state.host !== "codex") throw new InstallError("invalid_state", STATE_PATH);
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

function details(observation: HostObservation): CodexObservationDetails {
  return (observation.details ?? {}) as CodexObservationDetails;
}

function detectCodex(context: { readonly target: ProjectTarget }): HostObservation {
  const stateBytes = readManagedOptional(context.target, STATE_PATH);
  if (stateBytes === undefined) {
    return Object.freeze({
      host: "codex" as const,
      target: context.target,
      details: Object.freeze({} satisfies CodexObservationDetails),
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
      host: "codex" as const,
      target: context.target,
      currentState: state,
      details: Object.freeze({ stateBytes: Buffer.from(stateBytes) } satisfies CodexObservationDetails),
    });
  } catch (error) {
    return Object.freeze({
      host: "codex" as const,
      target: context.target,
      issues: Object.freeze([issueFrom(error)]),
      details: Object.freeze({ stateBytes: Buffer.from(stateBytes) } satisfies CodexObservationDetails),
    });
  }
}

function refuseIssues(observation: HostObservation): void {
  const issue = observation.issues?.[0];
  if (issue !== undefined) throw new InstallError(issue.code, issue.path);
}

function captureOriginals(
  target: ProjectTarget,
  environment: EnvironmentId,
): Record<string, OriginalRecord> {
  const originals: Record<string, OriginalRecord> = {};
  for (const relativePath of managedPaths(environment)) {
    if (relativePath === STATE_PATH) continue;
    const current = readManagedOptional(target, relativePath);
    if (![CONFIG_PATH, HOOKS_PATH].includes(relativePath) && current !== undefined) {
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
  const environment = context.environment;
  const name = packageName(environment);
  const originalConfig = decodeOriginal(originals[CONFIG_PATH], CONFIG_PATH) ?? undefined;
  const originalHooks = decodeOriginal(originals[HOOKS_PATH], HOOKS_PATH) ?? undefined;
  const payloads = new Map<string, Buffer>();
  payloads.set(CONFIG_PATH, renderConfig(originalConfig, context.packageRoot, environment));
  payloads.set(HOOKS_PATH, renderHooks(originalHooks, environment));
  payloads.set(
    SKILL_PATH,
    sourceAsset(context.packageRoot, `${name}/skills/code-lookup-discipline/SKILL.md`),
  );
  for (const asset of HOOK_ASSETS) {
    payloads.set(
      `${hookPrefix(environment)}/${asset}`,
      sourceAsset(context.packageRoot, `${name}/hooks/${asset}`),
    );
  }
  return payloads;
}

function renderInstall(context: HostInstallContext): DesiredState {
  refuseIssues(context.observation);
  const existing = context.observation.currentState;
  if (context.command === "update" && existing === undefined) {
    throw new InstallError("not_installed", STATE_PATH);
  }
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
    host: "codex",
    environment: context.environment,
    managedFiles: [...paths],
    originals,
    digests,
  };
  payloads.set(STATE_PATH, Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8"));
  const stateBytes = details(context.observation).stateBytes;
  return createDesiredState({
    host: "codex",
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
  if (state === undefined || stateBytes === undefined) {
    throw new InstallError("not_installed", STATE_PATH);
  }
  if (state.environment !== context.environment) {
    throw new InstallError("environment_not_installed", STATE_PATH);
  }
  return createDesiredState({
    host: "codex",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: managedPaths(state.environment).map((relativePath) => ({
      relativePath,
      expectedDigest: relativePath === STATE_PATH
        ? sha256(stateBytes)
        : state.digests[relativePath] ?? null,
      content: relativePath === STATE_PATH
        ? null
        : decodeOriginal(state.originals[relativePath], relativePath),
    })),
  });
}

function codexStatus(context: HostStatusContext) {
  const issue = context.observation.issues?.[0];
  if (issue !== undefined) {
    return createStatusResult({
      status: issue.code === "managed_content_changed" ? "drifted" : "invalid",
      host: "codex",
      issues: [issue],
    });
  }
  const state = context.observation.currentState;
  if (state === undefined) {
    const managedRoot = validateManagedPath(
      context.target,
      ".codex/kcoderag-nav/install-state.json",
      MANAGED_ROOTS,
    );
    const rootPath = path.dirname(managedRoot.absolutePath);
    if (fs.existsSync(rootPath)) {
      return createStatusResult({
        status: "invalid",
        host: "codex",
        issues: [{ code: "orphaned_managed_root", path: ".codex/kcoderag-nav" }],
      });
    }
    return createStatusResult({ host: "codex" });
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
      host: "codex",
      environment: state.environment,
      issues: updateAvailable
        ? [{ code: "source_update_available", path: ".codex/kcoderag-nav" }]
        : [],
    });
  } catch (error) {
    return createStatusResult({
      status: "invalid",
      host: "codex",
      environment: state.environment,
      issues: [issueFrom(error)],
    });
  }
}

export const codexAdapter: HostAdapter = Object.freeze({
  id: "codex",
  managedRoots: MANAGED_ROOTS,
  detect: detectCodex,
  renderInstall,
  renderUninstall,
  status: codexStatus,
});

exports.STATE_PATH = STATE_PATH;
exports.managedPaths = managedPaths;
