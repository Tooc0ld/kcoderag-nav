/** Cursor project adapter and separately authorized legacy user-local migration. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
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
import { applyTransaction, type TransactionResult } from "../core/transaction.cjs";
import type {
  HostAdapter,
  HostInstallContext,
  HostObservation,
  HostStatusContext,
  HostUninstallContext,
} from "./host-adapter.cjs";

type JsonMap = Record<string, unknown>;

interface LegacyCursorSnapshot {
  readonly localRoot: string;
  readonly pluginRoot: string;
  readonly statePath: string;
  readonly stateBytes: Buffer;
  readonly files: ReadonlyMap<string, Buffer>;
  readonly digests: Readonly<Record<string, string>>;
  readonly environment: EnvironmentId;
}

interface CursorObservationDetails {
  readonly stateBytes?: Buffer;
  readonly legacy?: LegacyCursorSnapshot;
}

interface CursorAdapterOptions {
  readonly legacyLocalRoot?: string;
}

interface MigrationOptions {
  readonly failAtLegacyDelete?: number;
}

interface CursorMigrationAdapter extends HostAdapter {
  migrateLegacy(desired: DesiredState, observation: HostObservation): TransactionResult;
}

const STATE_PATH = ".cursor/kcoderag-nav/install-state.json";
const MCP_PATH = ".cursor/mcp.json";
const RULE_PATH = ".cursor/rules/kcoderag-navigation.mdc";
const SKILL_PATH = ".cursor/skills/kcoderag-nav/SKILL.md";
const MANAGED_ROOTS = Object.freeze([".cursor"] as const);
const LEGACY_PLUGIN_NAME = "kcoderag-nav";
const LEGACY_STATE_NAME = ".kcoderag-nav.install-state.json";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function packageName(environment: EnvironmentId): string {
  return `kcoderag-${environment}`;
}

function managedPaths(): readonly string[] {
  return Object.freeze([MCP_PATH, RULE_PATH, SKILL_PATH, STATE_PATH].sort((left, right) => {
    if (left === STATE_PATH) return 1;
    if (right === STATE_PATH) return -1;
    return left.localeCompare(right);
  }));
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

function readPackageVersion(packageRoot: string): string {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(packageRoot, "package.json"));
  } catch {
    throw new InstallError("invalid_package", "package.json");
  }
  const value = parseJsonBytes(bytes, "invalid_package", "package.json");
  if (value.name !== "kcoderag-nav" || typeof value.version !== "string") {
    throw new InstallError("invalid_package", "package.json");
  }
  return value.version;
}

function environmentMcpEntry(packageRoot: string, environment: EnvironmentId): {
  readonly entry: JsonMap;
  readonly url: string;
  readonly bearer: string;
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
  const entry = isRecord(source.mcpServers) ? source.mcpServers[name] : undefined;
  if (!isRecord(entry) || typeof entry.url !== "string") {
    throw new InstallError("invalid_mcp_source", relativePath);
  }
  const headers = isRecord(entry.headers)
    ? entry.headers
    : isRecord(entry.http_headers)
      ? entry.http_headers
      : undefined;
  const authorization = headers === undefined
    ? undefined
    : Object.entries(headers).find(([key]) => key.toLowerCase() === "authorization")?.[1];
  const match = typeof authorization === "string" ? /^Bearer\s+(.+)$/u.exec(authorization) : null;
  if (match?.[1] === undefined || match[1].length === 0) {
    throw new InstallError("invalid_mcp_source", relativePath);
  }
  return { entry, url: entry.url, bearer: match[1] };
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
  if (document.mcpServers.kcoderag !== undefined) {
    throw new InstallError("unmanaged_name_conflict", MCP_PATH);
  }
  document.mcpServers.kcoderag = environmentMcpEntry(packageRoot, environment).entry;
  return canonicalJson(document);
}

function sourceAsset(packageRoot: string, relativePath: string): Buffer {
  try {
    return fs.readFileSync(path.join(packageRoot, ...relativePath.split("/")));
  } catch {
    throw new InstallError("missing_package_asset", relativePath);
  }
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

function issueFrom(error: unknown): StatusIssue {
  return error instanceof InstallError
    ? { code: error.code, path: error.safePath ?? "." }
    : { code: "invalid", path: "." };
}

function details(observation: HostObservation): CursorObservationDetails {
  return (observation.details ?? {}) as CursorObservationDetails;
}

function validateCurrentState(state: InstallState): InstallState {
  if (state.host !== "cursor") throw new InstallError("invalid_state", STATE_PATH);
  const paths = managedPaths();
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

function legacyTreeDigest(digests: Readonly<Record<string, string>>): string {
  const identity = Object.entries(digests)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, digest]) => `${relativePath}\0${digest}\n`)
    .join("");
  return sha256(identity);
}

function validateLegacyRelativePath(relativePath: string): void {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new InstallError("invalid_legacy_state", LEGACY_STATE_NAME);
  }
}

function parseLegacyState(bytes: Buffer): {
  readonly digests: Readonly<Record<string, string>>;
  readonly treeDigest: string;
} {
  const value = parseJsonBytes(bytes, "invalid_legacy_state", LEGACY_STATE_NAME);
  if (
    Object.keys(value).sort().join("\0") !==
      "files\0package_version\0plugin_name\0schema_version\0tree_digest" ||
    value.schema_version !== 1 ||
    value.plugin_name !== LEGACY_PLUGIN_NAME ||
    typeof value.package_version !== "string" ||
    typeof value.tree_digest !== "string" ||
    !DIGEST_PATTERN.test(value.tree_digest) ||
    !isRecord(value.files) ||
    Object.keys(value.files).length === 0
  ) {
    throw new InstallError("invalid_legacy_state", LEGACY_STATE_NAME);
  }
  const digests: Record<string, string> = {};
  for (const [relativePath, digest] of Object.entries(value.files)) {
    validateLegacyRelativePath(relativePath);
    if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
      throw new InstallError("invalid_legacy_state", LEGACY_STATE_NAME);
    }
    digests[relativePath] = digest;
  }
  if (legacyTreeDigest(digests) !== value.tree_digest) {
    throw new InstallError("invalid_legacy_state", LEGACY_STATE_NAME);
  }
  return { digests: Object.freeze(digests), treeDigest: value.tree_digest };
}

function readLegacyTree(pluginRoot: string, directories?: Set<string>): ReadonlyMap<string, Buffer> {
  const files = new Map<string, Buffer>();
  const visit = (directory: string): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      throw new InstallError("unreadable_legacy_install", LEGACY_PLUGIN_NAME);
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relativePath = path.relative(pluginRoot, absolute).split(path.sep).join("/");
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) throw new InstallError("legacy_symlink_present", relativePath);
      if (metadata.isDirectory()) {
        directories?.add(relativePath);
        visit(absolute);
      }
      else if (metadata.isFile()) files.set(relativePath, fs.readFileSync(absolute));
      else throw new InstallError("legacy_special_path", relativePath);
    }
  };
  visit(pluginRoot);
  return files;
}

function expectedLegacyDirectories(relativePaths: Iterable<string>): ReadonlySet<string> {
  const directories = new Set<string>();
  for (const relativePath of relativePaths) {
    let parent = path.posix.dirname(relativePath);
    while (parent !== ".") {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  return directories;
}

function legacyEnvironment(
  files: ReadonlyMap<string, Buffer>,
  packageRoot: string,
): EnvironmentId {
  const safePath = ".cursor-plugin/plugin.json";
  const manifestBytes = files.get(safePath);
  if (manifestBytes === undefined) throw new InstallError("invalid_legacy_state", safePath);
  const manifest = parseJsonBytes(manifestBytes, "invalid_legacy_state", safePath);
  const properties = isRecord(manifest.variables) && isRecord(manifest.variables.properties)
    ? manifest.variables.properties
    : undefined;
  const url = properties !== undefined && isRecord(properties.KCODERAG_MCP_URL)
    ? properties.KCODERAG_MCP_URL.default
    : undefined;
  const bearer = properties !== undefined && isRecord(properties.KCODERAG_BEARER_TOKEN)
    ? properties.KCODERAG_BEARER_TOKEN.default
    : undefined;
  if (typeof url !== "string" || typeof bearer !== "string") {
    throw new InstallError("invalid_legacy_state", safePath);
  }
  for (const environment of ["qa", "dev"] as const) {
    const expected = environmentMcpEntry(packageRoot, environment);
    if (url === expected.url && bearer === expected.bearer) return environment;
  }
  throw new InstallError("unknown_legacy_environment", safePath);
}

export function inspectCursorLegacyInstall(
  rawLocalRoot: string,
  packageRoot: string,
): LegacyCursorSnapshot | undefined {
  const localRoot = path.resolve(rawLocalRoot);
  const pluginRoot = path.join(localRoot, LEGACY_PLUGIN_NAME);
  const statePath = path.join(localRoot, LEGACY_STATE_NAME);
  for (const [candidate, safePath] of [[localRoot, "."], [pluginRoot, LEGACY_PLUGIN_NAME], [statePath, LEGACY_STATE_NAME]] as const) {
    try {
      const metadata = fs.lstatSync(candidate);
      if (metadata.isSymbolicLink()) throw new InstallError("legacy_symlink_present", safePath);
      if (candidate === localRoot && !metadata.isDirectory()) throw new InstallError("invalid_legacy_root", ".");
    } catch (error) {
      if (error instanceof InstallError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new InstallError("unreadable_legacy_install", safePath);
    }
  }
  const pluginExists = fs.existsSync(pluginRoot);
  const stateExists = fs.existsSync(statePath);
  if (!pluginExists && !stateExists) return undefined;
  if (!pluginExists || !stateExists) {
    throw new InstallError(pluginExists ? "legacy_state_missing" : "legacy_install_missing", pluginExists ? LEGACY_STATE_NAME : LEGACY_PLUGIN_NAME);
  }
  const pluginMetadata = fs.lstatSync(pluginRoot);
  const stateMetadata = fs.lstatSync(statePath);
  if (!pluginMetadata.isDirectory() || !stateMetadata.isFile()) {
    throw new InstallError("invalid_legacy_state", LEGACY_STATE_NAME);
  }
  const stateBytes = fs.readFileSync(statePath);
  const state = parseLegacyState(stateBytes);
  const directories = new Set<string>();
  const files = readLegacyTree(pluginRoot, directories);
  const actualPaths = [...files.keys()].sort((left, right) => left.localeCompare(right));
  const expectedPaths = Object.keys(state.digests).sort((left, right) => left.localeCompare(right));
  if (actualPaths.join("\0") !== expectedPaths.join("\0")) {
    throw new InstallError("unmanaged_legacy_path", LEGACY_PLUGIN_NAME);
  }
  const expectedDirectories = expectedLegacyDirectories(expectedPaths);
  if ([...directories].sort().join("\0") !== [...expectedDirectories].sort().join("\0")) {
    throw new InstallError("unmanaged_legacy_path", LEGACY_PLUGIN_NAME);
  }
  for (const [relativePath, expected] of Object.entries(state.digests)) {
    const bytes = files.get(relativePath);
    if (bytes === undefined || sha256(bytes) !== expected) {
      throw new InstallError("managed_content_changed", relativePath);
    }
  }
  return Object.freeze({
    localRoot,
    pluginRoot,
    statePath,
    stateBytes: Buffer.from(stateBytes),
    files,
    digests: state.digests,
    environment: legacyEnvironment(files, packageRoot),
  });
}

function detectCursor(
  context: { readonly target: ProjectTarget; readonly packageRoot: string },
  legacyLocalRoot: string,
): HostObservation {
  const stateBytes = readManagedOptional(context.target, STATE_PATH);
  try {
    const legacy = inspectCursorLegacyInstall(legacyLocalRoot, context.packageRoot);
    let currentState: InstallState | undefined;
    if (stateBytes !== undefined) {
      currentState = validateCurrentState(parseInstallState(stateBytes));
      for (const [relativePath, digest] of Object.entries(currentState.digests)) {
        const current = readManagedOptional(context.target, relativePath);
        if (current === undefined || sha256(current) !== digest) {
          throw new InstallError("managed_content_changed", relativePath);
        }
      }
    }
    if (legacy !== undefined && currentState !== undefined) {
      throw new InstallError("legacy_install_conflict", STATE_PATH);
    }
    const result: {
      host: "cursor";
      target: ProjectTarget;
      currentState?: InstallState;
      legacyUserRemoval?: { path: string };
      details: CursorObservationDetails;
    } = {
      host: "cursor",
      target: context.target,
      details: Object.freeze({
        ...(stateBytes === undefined ? {} : { stateBytes: Buffer.from(stateBytes) }),
        ...(legacy === undefined ? {} : { legacy }),
      }),
    };
    if (currentState !== undefined) result.currentState = currentState;
    if (legacy !== undefined) result.legacyUserRemoval = { path: legacy.pluginRoot };
    return Object.freeze(result);
  } catch (error) {
    return Object.freeze({
      host: "cursor" as const,
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

function captureOriginals(target: ProjectTarget): Record<string, OriginalRecord> {
  const originals: Record<string, OriginalRecord> = {};
  for (const relativePath of managedPaths()) {
    if (relativePath === STATE_PATH) continue;
    const current = readManagedOptional(target, relativePath);
    if (relativePath !== MCP_PATH && current !== undefined) {
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

function renderInstall(context: HostInstallContext): DesiredState {
  refuseIssues(context.observation);
  const observationDetails = details(context.observation);
  const legacy = observationDetails.legacy;
  if (legacy !== undefined) {
    if (!context.allowLegacyUserRemoval) throw new InstallError("legacy_removal_authority_required");
    if (legacy.environment !== context.environment) throw new InstallError("environment_conflict", STATE_PATH);
  }
  const existing = context.observation.currentState;
  if (context.command === "update" && existing === undefined && legacy === undefined) {
    throw new InstallError("not_installed", STATE_PATH);
  }
  if (existing !== undefined && existing.environment !== context.environment) {
    throw new InstallError("environment_conflict", STATE_PATH);
  }
  const originals = existing?.originals ?? captureOriginals(context.target);
  const originalMcp = decodeOriginal(originals[MCP_PATH], MCP_PATH) ?? undefined;
  const payloads = new Map<string, Buffer>([
    [MCP_PATH, renderMcp(originalMcp, context.packageRoot, context.environment)],
    [RULE_PATH, sourceAsset(context.packageRoot, "kcoderag-cursor/rules/kcoderag-navigation.mdc")],
    [SKILL_PATH, sourceAsset(context.packageRoot, "kcoderag-cursor/skills/code-lookup-discipline/SKILL.md")],
  ]);
  const digests: Record<string, string> = {};
  for (const [relativePath, bytes] of payloads) digests[relativePath] = sha256(bytes);
  const state: InstallState = {
    schemaVersion: CORE_SCHEMA_VERSION,
    packageVersion: readPackageVersion(context.packageRoot),
    host: "cursor",
    environment: context.environment,
    managedFiles: [...managedPaths()],
    originals,
    digests,
  };
  payloads.set(STATE_PATH, canonicalJson(state));
  const stateBytes = observationDetails.stateBytes;
  return createDesiredState({
    host: "cursor",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: managedPaths().map((relativePath) => ({
      relativePath,
      expectedDigest: expectedDigest(context.target, relativePath, existing, stateBytes),
      content: payloads.get(relativePath) ?? null,
    })),
  });
}

function renderUninstall(context: HostUninstallContext): DesiredState {
  refuseIssues(context.observation);
  if (details(context.observation).legacy !== undefined) {
    throw new InstallError("legacy_migration_required", LEGACY_STATE_NAME);
  }
  const state = context.observation.currentState;
  const stateBytes = details(context.observation).stateBytes;
  if (state === undefined || stateBytes === undefined) throw new InstallError("not_installed", STATE_PATH);
  if (state.environment !== context.environment) throw new InstallError("environment_not_installed", STATE_PATH);
  return createDesiredState({
    host: "cursor",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: managedPaths().map((relativePath) => ({
      relativePath,
      expectedDigest: relativePath === STATE_PATH ? sha256(stateBytes) : state.digests[relativePath] ?? null,
      content: relativePath === STATE_PATH ? null : decodeOriginal(state.originals[relativePath], relativePath),
    })),
  });
}

function cursorStatus(context: HostStatusContext) {
  const issue = context.observation.issues?.[0];
  if (issue !== undefined) {
    return createStatusResult({
      status: issue.code === "managed_content_changed" ? "drifted" : "invalid",
      host: "cursor",
      issues: [issue],
    });
  }
  const legacy = details(context.observation).legacy;
  if (legacy !== undefined) {
    return createStatusResult({
      status: "update_available",
      host: "cursor",
      environment: legacy.environment,
      issues: [{ code: "legacy_migration_available", path: LEGACY_STATE_NAME }],
    });
  }
  const state = context.observation.currentState;
  if (state === undefined) {
    const root = validateManagedPath(context.target, STATE_PATH, MANAGED_ROOTS);
    if (fs.existsSync(path.dirname(root.absolutePath))) {
      return createStatusResult({
        status: "invalid",
        host: "cursor",
        issues: [{ code: "orphaned_managed_root", path: ".cursor/kcoderag-nav" }],
      });
    }
    return createStatusResult({ host: "cursor" });
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
      host: "cursor",
      environment: state.environment,
      issues: updateAvailable ? [{ code: "source_update_available", path: ".cursor/kcoderag-nav" }] : [],
    });
  } catch (error) {
    return createStatusResult({
      status: "invalid",
      host: "cursor",
      environment: state.environment,
      issues: [issueFrom(error)],
    });
  }
}

function verifyLegacySnapshot(snapshot: LegacyCursorSnapshot): void {
  const currentState = readOptional(snapshot.statePath, LEGACY_STATE_NAME);
  if (currentState === undefined || !currentState.equals(snapshot.stateBytes)) {
    throw new InstallError("managed_content_changed", LEGACY_STATE_NAME);
  }
  const directories = new Set<string>();
  const currentFiles = readLegacyTree(snapshot.pluginRoot, directories);
  if ([...currentFiles.keys()].sort().join("\0") !== [...snapshot.files.keys()].sort().join("\0")) {
    throw new InstallError("unmanaged_legacy_path", LEGACY_PLUGIN_NAME);
  }
  const expectedDirectories = expectedLegacyDirectories(snapshot.files.keys());
  if ([...directories].sort().join("\0") !== [...expectedDirectories].sort().join("\0")) {
    throw new InstallError("unmanaged_legacy_path", LEGACY_PLUGIN_NAME);
  }
  for (const [relativePath, bytes] of snapshot.files) {
    const current = currentFiles.get(relativePath);
    if (current === undefined || !current.equals(bytes)) {
      throw new InstallError("managed_content_changed", relativePath);
    }
  }
}

function projectRollbackState(desired: DesiredState): DesiredState {
  const stateEntry = desired.entries.find((entry) => entry.path.relativePath === STATE_PATH);
  if (stateEntry?.content === null || stateEntry?.content === undefined) {
    throw new InstallError("invalid_desired_state", STATE_PATH);
  }
  const state = validateCurrentState(parseInstallState(stateEntry.content));
  return createDesiredState({
    host: "cursor",
    target: desired.target,
    managedRoots: desired.managedRoots,
    statePath: STATE_PATH,
    entries: desired.entries.map((entry) => ({
      relativePath: entry.path.relativePath,
      expectedDigest: entry.content === null ? null : sha256(entry.content),
      content: entry.path.relativePath === STATE_PATH
        ? null
        : decodeOriginal(state.originals[entry.path.relativePath], entry.path.relativePath),
    })),
  });
}

function restoreLegacy(snapshot: LegacyCursorSnapshot): void {
  for (const [relativePath, bytes] of snapshot.files) {
    const destination = path.join(snapshot.pluginRoot, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
  fs.mkdirSync(snapshot.localRoot, { recursive: true });
  fs.writeFileSync(snapshot.statePath, snapshot.stateBytes);
}

function pruneLegacyDirectories(snapshot: LegacyCursorSnapshot): void {
  const directories = new Set<string>();
  for (const relativePath of snapshot.files.keys()) {
    let current = path.dirname(path.join(snapshot.pluginRoot, ...relativePath.split("/")));
    while (current.startsWith(`${snapshot.pluginRoot}${path.sep}`)) {
      directories.add(current);
      current = path.dirname(current);
    }
  }
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
    }
  }
  fs.rmdirSync(snapshot.pluginRoot);
}

function pruneEmptyProjectDirectories(desired: DesiredState): void {
  const directories = new Set<string>();
  for (const entry of desired.entries) {
    let current = path.dirname(entry.path.absolutePath);
    while (current.startsWith(`${desired.target.root}${path.sep}`)) {
      directories.add(current);
      current = path.dirname(current);
    }
  }
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") {
        throw error;
      }
    }
  }
}

interface MigrationBackup {
  readonly root: string;
  readonly relativePath: string;
}

function writePrivateFile(destination: string, bytes: Buffer): void {
  const descriptor = fs.openSync(destination, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function createMigrationBackup(
  desired: DesiredState,
  snapshot: LegacyCursorSnapshot,
): MigrationBackup {
  const name = `.legacy-migration-${crypto.randomUUID()}`;
  const relativePath = `.cursor/kcoderag-nav/${name}`;
  const root = path.join(desired.target.root, ".cursor", "kcoderag-nav", name);
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const filesRoot = path.join(root, "files");
    fs.mkdirSync(filesRoot, { mode: 0o700 });
    const records: { readonly path: string; readonly digest: string; readonly backup: string }[] = [];
    for (const [index, [relativePathEntry, bytes]] of [...snapshot.files.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .entries()) {
      const backup = `${index.toString().padStart(4, "0")}.bin`;
      writePrivateFile(path.join(filesRoot, backup), bytes);
      records.push({ path: relativePathEntry, digest: sha256(bytes), backup });
    }
    writePrivateFile(path.join(root, "legacy-state.bin"), snapshot.stateBytes);
    writePrivateFile(path.join(root, "journal.json"), canonicalJson({
      schemaVersion: CORE_SCHEMA_VERSION,
      operation: "cursor-legacy-migration",
      environment: snapshot.environment,
      legacyPath: snapshot.pluginRoot,
      stateDigest: sha256(snapshot.stateBytes),
      files: records,
    }));
    return { root, relativePath };
  } catch {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // No project or user installation bytes have changed yet.
    }
    throw new InstallError("transaction_failed");
  }
}

function removeMigrationBackup(backup: MigrationBackup): void {
  fs.rmSync(backup.root, { recursive: true });
}

export function migrateCursorLegacyInstall(
  desired: DesiredState,
  observation: HostObservation,
  options: MigrationOptions = {},
): TransactionResult {
  const snapshot = details(observation).legacy;
  if (desired.host !== "cursor" || snapshot === undefined || observation.legacyUserRemoval === undefined) {
    throw new InstallError("invalid_legacy_migration");
  }
  verifyLegacySnapshot(snapshot);
  const backup = createMigrationBackup(desired, snapshot);
  let projectResult: TransactionResult;
  try {
    projectResult = applyTransaction(desired);
  } catch (error) {
    try {
      removeMigrationBackup(backup);
      pruneEmptyProjectDirectories(desired);
    } catch {
      throw new InstallError("rollback_failed", backup.relativePath);
    }
    throw error;
  }
  let deletionIndex = 0;
  try {
    for (const relativePath of [...snapshot.files.keys()].sort((left, right) => left.localeCompare(right))) {
      if (options.failAtLegacyDelete === deletionIndex++) throw new Error("injected_legacy_delete_failure");
      fs.unlinkSync(path.join(snapshot.pluginRoot, ...relativePath.split("/")));
    }
    if (options.failAtLegacyDelete === deletionIndex) throw new Error("injected_legacy_delete_failure");
    fs.unlinkSync(snapshot.statePath);
    pruneLegacyDirectories(snapshot);
    removeMigrationBackup(backup);
    return projectResult;
  } catch {
    let rollbackFailed = false;
    try {
      restoreLegacy(snapshot);
    } catch {
      rollbackFailed = true;
    }
    try {
      applyTransaction(projectRollbackState(desired));
      removeMigrationBackup(backup);
      pruneEmptyProjectDirectories(desired);
    } catch {
      rollbackFailed = true;
    }
    if (rollbackFailed) throw new InstallError("rollback_failed", backup.relativePath);
    throw new InstallError("transaction_failed");
  }
}

export function createCursorAdapter(options: CursorAdapterOptions = {}): CursorMigrationAdapter {
  const legacyLocalRoot = path.resolve(
    options.legacyLocalRoot ?? path.join(os.homedir(), ".cursor", "plugins", "local"),
  );
  const adapter: CursorMigrationAdapter = {
    id: "cursor" as const,
    managedRoots: MANAGED_ROOTS,
    detect: (context) => detectCursor(context, legacyLocalRoot),
    renderInstall,
    renderUninstall,
    status: cursorStatus,
    migrateLegacy: (desired, observation) => migrateCursorLegacyInstall(desired, observation),
  };
  return Object.freeze(adapter);
}

export const cursorAdapter = createCursorAdapter();

exports.STATE_PATH = STATE_PATH;
exports.managedPaths = managedPaths;
