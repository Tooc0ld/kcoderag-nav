/** Codex project-native adapter with narrow section/file ownership. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const { TextDecoder } = require("node:util") as typeof import("node:util");

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
import {
  createDesiredState,
  createStatusResult,
  parseInstallState,
  parseLegacyInstallState,
  type LegacyInstallState,
} from "../core/state.cjs";
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
  readonly legacyState?: LegacyInstallState;
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
const LEGACY_HOOK_ASSETS = Object.freeze([
  "grep_nudge.py",
  "run_hook.sh",
  "run_hook.cmd",
  "update_check.py",
]);
const LEGACY_PYTHON_ASSETS = Object.freeze(["grep_nudge.py", "update_check.py"]);
const SHARED_PATHS = Object.freeze([CONFIG_PATH, HOOKS_PATH] as const);

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeUtf8(bytes: Buffer, safePath: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InstallError("invalid_utf8", safePath);
  }
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function renderJsonLike(original: Buffer | undefined, value: unknown): Buffer {
  if (original === undefined) return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const text = decodeUtf8(original, HOOKS_PATH);
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

function sectionRecord(
  id: string,
  value: Buffer | unknown,
  fileExisted: boolean,
): ManagedSectionRecord {
  return {
    id,
    digest: Buffer.isBuffer(value) ? sha256(value) : sectionDigest(value),
    fileExisted,
  };
}

function verifyJsonSection(
  record: ManagedSectionRecord,
  expectedId: string,
  value: unknown,
  safePath: string,
): void {
  if (record.id !== expectedId || sectionDigest(value) !== record.digest) {
    throw new InstallError("managed_content_changed", safePath);
  }
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

function legacyRequiredPaths(environment: EnvironmentId): readonly string[] {
  return Object.freeze([
    CONFIG_PATH,
    HOOKS_PATH,
    SKILL_PATH,
    ...LEGACY_HOOK_ASSETS.map((name) => `${hookPrefix(environment)}/${name}`),
  ]);
}

function legacyAllowedPaths(environment: EnvironmentId): readonly string[] {
  return Object.freeze([
    ...legacyRequiredPaths(environment),
    `${hookPrefix(environment)}/hooks.json`,
  ]);
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
  const text = decodeUtf8(bytes, safePath);
  try {
    const value: unknown = JSON.parse(text);
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

interface ConfigRange {
  readonly start: number;
  readonly markerStart: number;
  readonly end: number;
}

function configRange(text: string, record: ManagedSectionRecord): ConfigRange {
  const environment = record.id.endsWith("-qa") ? "qa" : record.id.endsWith("-dev") ? "dev" : undefined;
  if (environment === undefined || record.id !== `mcp_servers.kcoderag-${environment}`) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  const begin = `# BEGIN KCODERAG-NAV ${environment}`;
  const endMarker = `# END KCODERAG-NAV ${environment}`;
  const markerStart = text.indexOf(begin);
  const markerEnd = text.indexOf(endMarker, markerStart + begin.length);
  if (markerStart < 0 || markerEnd < 0 || text.indexOf(begin, markerStart + 1) >= 0) {
    throw new InstallError("managed_content_changed", CONFIG_PATH);
  }
  let end = markerEnd + endMarker.length;
  if (text.slice(end, end + 2) === "\r\n") end += 2;
  else if (text[end] === "\n") end += 1;
  const candidates = [markerStart];
  if (markerStart > 0 && text[markerStart - 1] === "\n") candidates.push(markerStart - 1);
  if (markerStart > 1 && text.slice(markerStart - 2, markerStart) === "\n\n") {
    candidates.push(markerStart - 2);
  }
  const start = candidates.find((candidate) =>
    sha256(Buffer.from(text.slice(candidate, end), "utf8")) === record.digest);
  if (start === undefined) throw new InstallError("managed_content_changed", CONFIG_PATH);
  return { start, markerStart, end };
}

function renderConfig(
  current: Buffer | undefined,
  packageRoot: string,
  environment: EnvironmentId,
  owned: ManagedSectionRecord | undefined,
  fileExisted: boolean,
): { readonly bytes: Buffer; readonly section: ManagedSectionRecord } {
  const currentText = decodeUtf8(current ?? Buffer.alloc(0), CONFIG_PATH);
  let originalText = currentText;
  let replacementRange: ConfigRange | undefined;
  if (owned !== undefined) {
    replacementRange = configRange(originalText, owned);
    originalText = originalText.slice(0, replacementRange.start) +
      originalText.slice(replacementRange.end);
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
  const separator = replacementRange === undefined
    ? originalText.length === 0 || originalText.endsWith("\n\n")
      ? ""
      : originalText.endsWith("\n")
        ? "\n"
        : "\n\n"
    : currentText.slice(replacementRange.start, replacementRange.markerStart);
  const ownedBytes = Buffer.from(`${separator}${block}`, "utf8");
  return {
    bytes: replacementRange === undefined
      ? Buffer.concat([Buffer.from(originalText, "utf8"), ownedBytes])
      : Buffer.concat([
          Buffer.from(currentText.slice(0, replacementRange.start), "utf8"),
          ownedBytes,
          Buffer.from(currentText.slice(replacementRange.end), "utf8"),
        ]),
    section: sectionRecord(`mcp_servers.${entry.name}`, ownedBytes, fileExisted),
  };
}

function managedHook(environment: EnvironmentId): JsonMap {
  const prefix = hookPrefix(environment);
  return {
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

function renderHooks(
  current: Buffer | undefined,
  environment: EnvironmentId,
  owned: ManagedSectionRecord | undefined,
  fileExisted: boolean,
): { readonly bytes: Buffer; readonly section: ManagedSectionRecord } {
  const document = current === undefined
    ? { hooks: {} as JsonMap }
    : parseJsonBytes(current, "invalid_json", HOOKS_PATH);
  if (document.hooks === undefined) document.hooks = {};
  if (!isRecord(document.hooks)) throw new InstallError("invalid_json", HOOKS_PATH);
  const hooks = document.hooks;
  if (hooks.PreToolUse === undefined) hooks.PreToolUse = [];
  if (!Array.isArray(hooks.PreToolUse) || !hooks.PreToolUse.every(isRecord)) {
    throw new InstallError("invalid_json", HOOKS_PATH);
  }
  const ownedIndexes = hooks.PreToolUse
    .map((entry, index) => ({ index, environment: hookEnvironment(entry) }))
    .filter((entry) => entry.environment !== undefined);
  let insertionIndex: number | undefined;
  if (owned !== undefined) {
    const expectedEnvironment = owned.id.split(".").at(-1);
    const matched = ownedIndexes.filter((entry) => entry.environment === expectedEnvironment);
    if (matched.length !== 1 || matched[0] === undefined) {
      throw new InstallError("managed_content_changed", HOOKS_PATH);
    }
    verifyJsonSection(
      owned,
      `hooks.PreToolUse.kcoderag-nav.${expectedEnvironment}`,
      hooks.PreToolUse[matched[0].index],
      HOOKS_PATH,
    );
    hooks.PreToolUse.splice(matched[0].index, 1);
    insertionIndex = matched[0].index;
  } else if (ownedIndexes.length > 0) {
    throw new InstallError("unmanaged_name_conflict", HOOKS_PATH);
  }
  const entry = managedHook(environment);
  if (insertionIndex === undefined) hooks.PreToolUse.push(entry);
  else hooks.PreToolUse.splice(insertionIndex, 0, entry);
  return {
    bytes: renderJsonLike(current, document),
    section: sectionRecord(`hooks.PreToolUse.kcoderag-nav.${environment}`, entry, fileExisted),
  };
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
  const dedicated = owned.filter((relativePath) =>
    !SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number]));
  const secureState = state.sections !== undefined;
  if (
    state.managedFiles.join("\0") !== paths.join("\0") ||
    Object.keys(state.originals).sort().join("\0") !==
      [...(secureState ? dedicated : owned)].sort().join("\0") ||
    Object.keys(state.digests).sort().join("\0") !==
      [...(secureState ? dedicated : owned)].sort().join("\0") ||
    (secureState && Object.keys(state.sections ?? {}).sort().join("\0") !== [...SHARED_PATHS].sort().join("\0")) ||
    (secureState && state.sections?.[CONFIG_PATH]?.id !== `mcp_servers.kcoderag-${state.environment}`) ||
    (secureState && state.sections?.[HOOKS_PATH]?.id !== `hooks.PreToolUse.kcoderag-nav.${state.environment}`)
  ) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  return state;
}

function validateOwnedSections(target: ProjectTarget, state: InstallState): void {
  const configRecord = state.sections?.[CONFIG_PATH];
  const hooksRecord = state.sections?.[HOOKS_PATH];
  const currentConfig = readManagedOptional(target, CONFIG_PATH);
  const currentHooks = readManagedOptional(target, HOOKS_PATH);
  if (
    configRecord === undefined ||
    hooksRecord === undefined ||
    currentConfig === undefined ||
    currentHooks === undefined
  ) {
    throw new InstallError("managed_content_changed", CONFIG_PATH);
  }
  configRange(decodeUtf8(currentConfig, CONFIG_PATH), configRecord);

  const hooksDocument = parseJsonBytes(currentHooks, "invalid_json", HOOKS_PATH);
  if (!isRecord(hooksDocument.hooks) || !Array.isArray(hooksDocument.hooks.PreToolUse)) {
    throw new InstallError("managed_content_changed", HOOKS_PATH);
  }
  const environment = hooksRecord.id.split(".").at(-1);
  const matched = hooksDocument.hooks.PreToolUse.filter((entry) =>
    hookEnvironment(entry) === environment);
  if (matched.length !== 1 || matched[0] === undefined) {
    throw new InstallError("managed_content_changed", HOOKS_PATH);
  }
  verifyJsonSection(
    hooksRecord,
    `hooks.PreToolUse.kcoderag-nav.${environment}`,
    matched[0],
    HOOKS_PATH,
  );
}

function legacyEnvironment(bytes: Buffer): EnvironmentId | undefined {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (
      isRecord(value) &&
      value.version === 1 &&
      !("schemaVersion" in value) &&
      Array.isArray(value.active_environments) &&
      value.active_environments.length === 1 &&
      (value.active_environments[0] === "qa" || value.active_environments[0] === "dev")
    ) {
      return value.active_environments[0];
    }
  } catch {
    // The schema parser below produces the stable invalid_state refusal.
  }
  return undefined;
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
    const legacyEnvironmentId = legacyEnvironment(stateBytes);
    if (legacyEnvironmentId !== undefined) {
      const legacyState = parseLegacyInstallState(stateBytes, {
        allowedPaths: legacyAllowedPaths(legacyEnvironmentId),
        requiredPaths: legacyRequiredPaths(legacyEnvironmentId),
      });
      for (const [relativePath, digest] of Object.entries(legacyState.digests)) {
        const current = readManagedOptional(context.target, relativePath);
        if (current === undefined || sha256(current) !== digest) {
          throw new InstallError("managed_content_changed", relativePath);
        }
      }
      return Object.freeze({
        host: "codex" as const,
        target: context.target,
        details: Object.freeze({
          stateBytes: Buffer.from(stateBytes),
          legacyState,
        } satisfies CodexObservationDetails),
      });
    }
    const state = validateCurrentState(parseInstallState(stateBytes));
    if (state.sections !== undefined) validateOwnedSections(context.target, state);
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
  if (
    state !== undefined &&
    SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])
  ) {
    const current = readManagedOptional(target, relativePath);
    return current === undefined ? null : sha256(current);
  }
  if (state !== undefined) return state.digests[relativePath] ?? null;
  const current = readManagedOptional(target, relativePath);
  return current === undefined ? null : sha256(current);
}

function desiredPayloads(
  context: HostInstallContext,
  priorOriginals?: Readonly<Record<string, OriginalRecord>>,
): { readonly payloads: Map<string, Buffer>; readonly sections: Record<string, ManagedSectionRecord> } {
  const environment = context.environment;
  const name = packageName(environment);
  const existing = context.observation.currentState;
  const currentConfig = priorOriginals === undefined
    ? readManagedOptional(context.target, CONFIG_PATH)
    : decodeOriginal(priorOriginals[CONFIG_PATH], CONFIG_PATH) ?? undefined;
  const currentHooks = priorOriginals === undefined
    ? readManagedOptional(context.target, HOOKS_PATH)
    : decodeOriginal(priorOriginals[HOOKS_PATH], HOOKS_PATH) ?? undefined;
  const config = renderConfig(
    currentConfig,
    context.packageRoot,
    environment,
    priorOriginals === undefined ? existing?.sections?.[CONFIG_PATH] : undefined,
    existing?.sections?.[CONFIG_PATH]?.fileExisted ??
      (priorOriginals === undefined
        ? currentConfig !== undefined
        : priorOriginals[CONFIG_PATH]?.kind !== "absent"),
  );
  const hooks = renderHooks(
    currentHooks,
    environment,
    priorOriginals === undefined ? existing?.sections?.[HOOKS_PATH] : undefined,
    existing?.sections?.[HOOKS_PATH]?.fileExisted ??
      (priorOriginals === undefined
        ? currentHooks !== undefined
        : priorOriginals[HOOKS_PATH]?.kind !== "absent"),
  );
  const payloads = new Map<string, Buffer>();
  payloads.set(CONFIG_PATH, config.bytes);
  payloads.set(HOOKS_PATH, hooks.bytes);
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
  return {
    payloads,
    sections: { [CONFIG_PATH]: config.section, [HOOKS_PATH]: hooks.section },
  };
}

function migrationOriginals(
  target: ProjectTarget,
  environment: EnvironmentId,
  legacy: LegacyInstallState,
): Record<string, OriginalRecord> {
  const originals: Record<string, OriginalRecord> = {};
  for (const relativePath of managedPaths(environment)) {
    if (relativePath === STATE_PATH) continue;
    if ([CONFIG_PATH, HOOKS_PATH, SKILL_PATH].includes(relativePath)) {
      const legacyOriginal = legacy.originals[relativePath];
      if (legacyOriginal === undefined) throw new InstallError("invalid_state", STATE_PATH);
      originals[relativePath] = legacyOriginal;
      continue;
    }
    const fileName = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    if (fileName === "run_hook.cmd" || fileName === "run_hook.sh") {
      const legacyOriginal = legacy.originals[relativePath];
      if (legacyOriginal === undefined) throw new InstallError("invalid_state", STATE_PATH);
      originals[relativePath] = legacyOriginal;
      continue;
    }
    const current = readManagedOptional(target, relativePath);
    if (current !== undefined) throw new InstallError("unmanaged_name_conflict", relativePath);
    originals[relativePath] = encodeOriginal(undefined);
  }
  return originals;
}

function renderLegacyInstall(
  context: HostInstallContext,
  legacy: LegacyInstallState,
  stateBytes: Buffer,
): DesiredState {
  if (legacy.environment !== context.environment) {
    throw new InstallError("environment_conflict", STATE_PATH);
  }
  const environment = legacy.environment;
  const paths = managedPaths(environment);
  const legacyOriginals = migrationOriginals(context.target, environment, legacy);
  const originals = Object.fromEntries(Object.entries(legacyOriginals).filter(([relativePath]) =>
    !SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])));
  const rendered = desiredPayloads(context, legacyOriginals);
  const payloads = rendered.payloads;
  const digests: Record<string, string> = {};
  for (const [relativePath, bytes] of payloads) {
    if (!SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])) {
      digests[relativePath] = sha256(bytes);
    }
  }
  const state: InstallState = {
    schemaVersion: CORE_SCHEMA_VERSION,
    packageVersion: readPackageVersion(context.packageRoot),
    host: "codex",
    environment,
    managedFiles: [...paths],
    originals,
    digests,
    sections: rendered.sections,
  };
  payloads.set(STATE_PATH, Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8"));
  const legacyPythonPaths = LEGACY_PYTHON_ASSETS.map((name) => `${hookPrefix(environment)}/${name}`);
  return createDesiredState({
    host: "codex",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: [
      ...paths.map((relativePath) => ({
        relativePath,
        expectedDigest: relativePath === STATE_PATH
          ? sha256(stateBytes)
          : legacy.digests[relativePath] ?? null,
        content: payloads.get(relativePath) ?? null,
      })),
      ...legacyPythonPaths.map((relativePath) => ({
        relativePath,
        expectedDigest: legacy.digests[relativePath] ?? null,
        content: null,
      })),
    ],
  });
}

function renderInstall(context: HostInstallContext): DesiredState {
  refuseIssues(context.observation);
  const observationDetails = details(context.observation);
  if (observationDetails.legacyState !== undefined) {
    if (observationDetails.stateBytes === undefined) {
      throw new InstallError("invalid_state", STATE_PATH);
    }
    return renderLegacyInstall(
      context,
      observationDetails.legacyState,
      observationDetails.stateBytes,
    );
  }
  const existing = context.observation.currentState;
  if (context.command === "update" && existing === undefined) {
    throw new InstallError("not_installed", STATE_PATH);
  }
  if (existing !== undefined && existing.environment !== context.environment) {
    throw new InstallError("environment_conflict", STATE_PATH);
  }
  const paths = managedPaths(context.environment);
  const originals = existing === undefined
    ? captureOriginals(context.target, context.environment)
    : Object.fromEntries(Object.entries(existing.originals).filter(([relativePath]) =>
      !SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])));
  const priorOriginals = existing !== undefined && existing.sections === undefined
    ? existing.originals
    : undefined;
  const rendered = desiredPayloads(context, priorOriginals);
  const payloads = rendered.payloads;
  const digests: Record<string, string> = {};
  for (const [relativePath, bytes] of payloads) {
    if (!SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])) {
      digests[relativePath] = sha256(bytes);
    }
  }
  const state: InstallState = {
    schemaVersion: CORE_SCHEMA_VERSION,
    packageVersion: readPackageVersion(context.packageRoot),
    host: "codex",
    environment: context.environment,
    managedFiles: [...paths],
    originals,
    digests,
    sections: rendered.sections,
  };
  payloads.set(STATE_PATH, Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8"));
  const stateBytes = observationDetails.stateBytes;
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

function uninstallShared(
  target: ProjectTarget,
  state: InstallState,
): Map<string, Buffer | null> {
  const result = new Map<string, Buffer | null>();
  const configRecord = state.sections?.[CONFIG_PATH];
  const hooksRecord = state.sections?.[HOOKS_PATH];
  if (configRecord === undefined || hooksRecord === undefined) {
    throw new InstallError("invalid_state", STATE_PATH);
  }

  const currentConfig = readManagedOptional(target, CONFIG_PATH);
  if (currentConfig === undefined) throw new InstallError("managed_content_changed", CONFIG_PATH);
  const configText = decodeUtf8(currentConfig, CONFIG_PATH);
  const range = configRange(configText, configRecord);
  const remainingConfig = Buffer.from(
    configText.slice(0, range.start) + configText.slice(range.end),
    "utf8",
  );
  result.set(CONFIG_PATH, !configRecord.fileExisted && remainingConfig.length === 0
    ? null
    : remainingConfig);

  const currentHooks = readManagedOptional(target, HOOKS_PATH);
  if (currentHooks === undefined) throw new InstallError("managed_content_changed", HOOKS_PATH);
  const hooksDocument = parseJsonBytes(currentHooks, "invalid_json", HOOKS_PATH);
  if (!isRecord(hooksDocument.hooks) || !Array.isArray(hooksDocument.hooks.PreToolUse)) {
    throw new InstallError("managed_content_changed", HOOKS_PATH);
  }
  const environment = hooksRecord.id.split(".").at(-1);
  const matched = hooksDocument.hooks.PreToolUse
    .map((entry, index) => ({ entry, index, environment: hookEnvironment(entry) }))
    .filter((entry) => entry.environment === environment);
  if (matched.length !== 1 || matched[0] === undefined) {
    throw new InstallError("managed_content_changed", HOOKS_PATH);
  }
  verifyJsonSection(
    hooksRecord,
    `hooks.PreToolUse.kcoderag-nav.${environment}`,
    matched[0].entry,
    HOOKS_PATH,
  );
  hooksDocument.hooks.PreToolUse.splice(matched[0].index, 1);
  if (hooksDocument.hooks.PreToolUse.length === 0) delete hooksDocument.hooks.PreToolUse;
  if (Object.keys(hooksDocument.hooks).length === 0) delete hooksDocument.hooks;
  result.set(
    HOOKS_PATH,
    !hooksRecord.fileExisted && Object.keys(hooksDocument).length === 0
      ? null
      : renderJsonLike(currentHooks, hooksDocument),
  );
  return result;
}

function renderUninstall(context: HostUninstallContext): DesiredState {
  refuseIssues(context.observation);
  const observationDetails = details(context.observation);
  const legacy = observationDetails.legacyState;
  if (legacy !== undefined) {
    const stateBytes = observationDetails.stateBytes;
    if (stateBytes === undefined) throw new InstallError("invalid_state", STATE_PATH);
    if (legacy.environment !== context.environment) {
      throw new InstallError("environment_not_installed", STATE_PATH);
    }
    return createDesiredState({
      host: "codex",
      target: context.target,
      managedRoots: MANAGED_ROOTS,
      statePath: STATE_PATH,
      entries: [
        ...legacy.managedFiles.map((relativePath) => ({
          relativePath,
          expectedDigest: legacy.digests[relativePath] ?? null,
          content: decodeOriginal(legacy.originals[relativePath], relativePath),
        })),
        {
          relativePath: STATE_PATH,
          expectedDigest: sha256(stateBytes),
          content: null,
        },
      ],
    });
  }
  const state = context.observation.currentState;
  const stateBytes = observationDetails.stateBytes;
  if (state === undefined || stateBytes === undefined) {
    throw new InstallError("not_installed", STATE_PATH);
  }
  if (state.environment !== context.environment) {
    throw new InstallError("environment_not_installed", STATE_PATH);
  }
  const sharedPayloads = state.sections === undefined
    ? new Map<string, Buffer | null>()
    : uninstallShared(context.target, state);
  return createDesiredState({
    host: "codex",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: managedPaths(state.environment).map((relativePath) => ({
      relativePath,
      expectedDigest: expectedDigest(context.target, relativePath, state, stateBytes),
      content: relativePath === STATE_PATH
        ? null
        : sharedPayloads.has(relativePath)
          ? sharedPayloads.get(relativePath) ?? null
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
  const legacy = details(context.observation).legacyState;
  if (legacy !== undefined) {
    return createStatusResult({
      status: "update_available",
      host: "codex",
      environment: legacy.environment,
      issues: [{ code: "legacy_migration_available", path: STATE_PATH }],
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
