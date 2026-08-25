/** Codex project-native adapter with narrow section/file ownership. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const { TextDecoder } = require("node:util") as typeof import("node:util");

import {
  CORE_SCHEMA_VERSION,
  InstallError,
  type CurrentEnvironmentId,
  type DesiredState,
  type InstallState,
  type LegacyEnvironmentId,
  type ManagedSectionRecord,
  type OriginalRecord,
  type ProjectTarget,
  type StatusIssue,
} from "../core/contracts.cjs";
import { validateManagedPath } from "../core/project-target.cjs";
import { renderProjectHookCommands } from "../core/project-root.cjs";
import {
  removeJsonArrayElement,
  removeJsonObjectProperty,
  upsertJsonArrayElement,
  upsertJsonObjectProperty,
} from "../core/json-splice.cjs";
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
  HostSourceScanContext,
  HostStatusContext,
  HostUninstallContext,
} from "./host-adapter.cjs";
import {
  createNativeCleanupPlan,
  createNativeHostCapability,
  createSourceFinding,
  createSourceScanResult,
  runOwnedSourceCleanup,
  type NativeCleanupPlan,
  type NativeHostCapability,
  type NativeRunRequest,
  type OwnedCleanupAuthority,
  type SourceScanMode,
  type SourceScanResult,
} from "./user-sources.cjs";

type JsonMap = Record<string, unknown>;

interface CodexObservationDetails {
  readonly stateBytes?: Buffer;
  readonly legacyState?: LegacyInstallState;
}

export interface CodexNativeResult {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly stdout?: string;
  /** Closed classification only; raw stderr is never retained or returned. */
  readonly failureAttribution?: "marketplace_load" | "unrelated_failure";
}

export type CodexNativeRunner = (request: NativeRunRequest) => Promise<CodexNativeResult>;

export interface CodexRegistrationMetadata {
  readonly host: "codex";
  readonly sourceType: "owned_marketplace_registration";
  readonly marketplaceName: "kcoderag-nav";
  readonly sourcePath: string;
  readonly recognizedSourcePath: string;
  readonly provenanceId: "kcoderag-nav-repository-v1";
  readonly safePath: ".codex/config.toml";
  readonly failureAttribution: "marketplace_load";
  readonly exclusiveUserMarketplace: boolean;
}

export interface CodexUserSourceMetadata {
  readonly registrations: readonly CodexRegistrationMetadata[];
  readonly rawMcpPaths: readonly string[];
  readonly manualHookPaths: readonly string[];
  readonly cachePaths: readonly string[];
  readonly ambiguousPaths: readonly string[];
}

export type CodexUserSourceReader = () => CodexUserSourceMetadata | Promise<CodexUserSourceMetadata>;

export interface CodexAdapterOptions {
  readonly runner?: CodexNativeRunner;
  readonly readUserSources?: CodexUserSourceReader;
  readonly homeDirectory?: string;
}

const STATE_PATH = ".codex/kcoderag-nav/install-state.json";
const CONFIG_PATH = ".codex/config.toml";
const HOOKS_PATH = ".codex/hooks.json";
const SKILL_PATH = ".agents/skills/kcoderag-nav/SKILL.md";
const MANAGED_ROOTS = Object.freeze([".agents", ".codex"] as const);
const CODEX_TIMEOUT_MS = 5_000;
const CODEX_MINIMUM_VERSION = "0.146.1";
const CODEX_INVENTORY_SCHEMA = "codex-plugin-v1";
const LEGACY_PROVENANCE_ID = "kcoderag-nav-repository-v1";
const LEGACY_REPOSITORY_URL = "git+https://github.com/Tooc0ld/kcoderag-nav.git";
const USER_CONFIG_SAFE_PATH = ".codex/config.toml";
const USER_HOOKS_SAFE_PATH = ".codex/hooks.json";
const USER_CACHE_SAFE_PATH = ".codex/.tmp/marketplaces/kcoderag-nav";
const OWNED_MARKETPLACE = "kcoderag-nav";
const OWNED_PLUGIN_NAMES = new Set(["kcoderag-nav", "kcoderag-qa", "kcoderag-dev"]);
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

function losslessHooks(
  current: Buffer,
  operation: (text: string) => string,
  code = "invalid_json",
): Buffer {
  try {
    return Buffer.from(operation(decodeUtf8(current, HOOKS_PATH)), "utf8");
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError(code, HOOKS_PATH);
  }
}

function sectionDigest(value: unknown): string {
  return sha256(Buffer.from(JSON.stringify(value), "utf8"));
}

function sectionRecord(
  id: string,
  value: Buffer | unknown,
  fileExisted: boolean,
  createdContainers: readonly string[] = [],
): ManagedSectionRecord {
  return {
    id,
    digest: Buffer.isBuffer(value) ? sha256(value) : sectionDigest(value),
    fileExisted,
    createdContainers: [...createdContainers],
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

function hookPrefix(environment: LegacyEnvironmentId): string {
  return `.codex/kcoderag-nav/${environment}/hooks`;
}

function managedPaths(environment: CurrentEnvironmentId = "qa"): readonly string[] {
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

function legacyRequiredPaths(environment: LegacyEnvironmentId): readonly string[] {
  return Object.freeze([
    CONFIG_PATH,
    HOOKS_PATH,
    SKILL_PATH,
    ...LEGACY_HOOK_ASSETS.map((name) => `${hookPrefix(environment)}/${name}`),
  ]);
}

function legacyAllowedPaths(environment: LegacyEnvironmentId): readonly string[] {
  return Object.freeze([
    ...legacyRequiredPaths(environment),
    ...HOOK_ASSETS.map((name) => `${hookPrefix(environment)}/${name}`),
    `${hookPrefix(environment)}/hooks.json`,
    STATE_PATH,
  ]);
}

function legacyNodeManagedPaths(environment: LegacyEnvironmentId): readonly string[] {
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

function packageName(environment: CurrentEnvironmentId): string {
  return `kcoderag-${environment}`;
}

function readMcpEntry(packageRoot: string, environment: CurrentEnvironmentId): {
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

interface TomlKeyPath {
  readonly keys: readonly string[];
  readonly end: number;
}

function skipTomlWhitespace(input: string, start: number): number {
  let index = start;
  while (index < input.length && /[ \t]/.test(input[index] as string)) index += 1;
  return index;
}

function parseTomlKey(input: string, start: number): { readonly key: string; readonly end: number } | undefined {
  let index = skipTomlWhitespace(input, start);
  const quote = input[index];
  if (quote === "\"" || quote === "'") {
    const begin = index;
    index += 1;
    let value = "";
    while (index < input.length) {
      const character = input[index] as string;
      if (character === quote) {
        if (quote === "\"") {
          try {
            return { key: JSON.parse(input.slice(begin, index + 1)) as string, end: index + 1 };
          } catch {
            return undefined;
          }
        }
        return { key: value, end: index + 1 };
      }
      if (quote === "\"" && character === "\\") {
        index += 2;
        continue;
      }
      value += character;
      index += 1;
    }
    return undefined;
  }
  const match = /^[A-Za-z0-9_-]+/.exec(input.slice(index));
  return match === null ? undefined : { key: match[0], end: index + match[0].length };
}

function parseTomlKeyPath(input: string, start = 0): TomlKeyPath | undefined {
  const keys: string[] = [];
  let index = start;
  while (true) {
    const parsed = parseTomlKey(input, index);
    if (parsed === undefined) return keys.length === 0 ? undefined : { keys, end: index };
    keys.push(parsed.key);
    index = skipTomlWhitespace(input, parsed.end);
    if (input[index] !== ".") return { keys, end: index };
    index += 1;
  }
}

function tomlStatements(text: string): readonly string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  let triple = false;
  let escaped = false;
  let braces = 0;
  let brackets = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] as string;
    if (quote !== undefined) {
      current += character;
      if (triple && text.slice(index, index + 3) === quote.repeat(3)) {
        current += text.slice(index + 1, index + 3);
        index += 2;
        quote = undefined;
        triple = false;
        escaped = false;
      } else if (!triple && !escaped && character === quote) {
        quote = undefined;
      } else if (quote === "\"" && !escaped && character === "\\") {
        escaped = true;
      } else {
        escaped = false;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      triple = text.slice(index, index + 3) === character.repeat(3);
      current += triple ? character.repeat(3) : character;
      if (triple) index += 2;
      continue;
    }
    if (character === "#") {
      while (index + 1 < text.length && text[index + 1] !== "\n") index += 1;
      continue;
    }
    if (character === "{") braces += 1;
    if (character === "}") braces = Math.max(0, braces - 1);
    if (character === "[") brackets += 1;
    if (character === "]") brackets = Math.max(0, brackets - 1);
    if (character === "\n" && braces === 0 && brackets === 0) {
      if (current.trim().length > 0) statements.push(current.trim());
      current = "";
    } else {
      current += character === "\r" ? "" : character;
    }
  }
  if (current.trim().length > 0) statements.push(current.trim());
  return statements;
}

function isManagedTomlPath(keys: readonly string[]): boolean {
  return keys[0] === "mcp_servers" &&
    (keys[1] === "kcoderag-qa" || keys[1] === "kcoderag-dev");
}

function inlineTableDefinesManaged(input: string, start: number): boolean {
  let index = skipTomlWhitespace(input, start);
  if (input[index] !== "{") return false;
  index += 1;
  let depth = 1;
  let expectingKey = true;
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  while (index < input.length && depth > 0) {
    index = skipTomlWhitespace(input, index);
    if (depth === 1 && expectingKey) {
      if (input[index] === "}") break;
      const parsed = parseTomlKeyPath(input, index);
      if (parsed !== undefined) {
        const equals = skipTomlWhitespace(input, parsed.end);
        if (input[equals] === "=") {
          if (parsed.keys[0] === "kcoderag-qa" || parsed.keys[0] === "kcoderag-dev" ||
              parsed.keys[0] === "kcoderag-nav") {
            return true;
          }
          index = equals + 1;
          expectingKey = false;
          continue;
        }
      }
    }
    const character = input[index] as string;
    if (quote !== undefined) {
      if (!escaped && character === quote) quote = undefined;
      escaped = quote === "\"" && !escaped && character === "\\";
      if (character !== "\\") escaped = false;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
    } else if (character === "," && depth === 1) {
      expectingKey = true;
    }
    index += 1;
  }
  return false;
}

function hasManagedTomlDefinition(text: string): boolean {
  let table: readonly string[] = [];
  for (const statement of tomlStatements(text)) {
    if (statement.startsWith("[")) {
      const offset = statement.startsWith("[[") ? 2 : 1;
      const endOffset = statement.endsWith("]]") ? 2 : 1;
      const parsed = parseTomlKeyPath(statement.slice(offset, statement.length - endOffset));
      if (parsed !== undefined) {
        table = parsed.keys;
        if (isManagedTomlPath(table)) return true;
      }
      continue;
    }
    const parsed = parseTomlKeyPath(statement);
    if (parsed === undefined) continue;
    const equals = skipTomlWhitespace(statement, parsed.end);
    if (statement[equals] !== "=") continue;
    const completePath = [...table, ...parsed.keys];
    if (isManagedTomlPath(completePath)) return true;
    if (
      completePath.length === 1 &&
      completePath[0] === "mcp_servers" &&
      inlineTableDefinesManaged(statement, equals + 1)
    ) {
      return true;
    }
  }
  return false;
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
  environment: CurrentEnvironmentId,
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
    hasManagedTomlDefinition(originalText)
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

function managedHook(environment: CurrentEnvironmentId): JsonMap {
  const commands = renderProjectHookCommands("codex");
  return {
    matcher: "Grep|Glob|Bash",
    hooks: [
      {
        type: "command",
        command: commands.command,
        commandWindows: commands.commandWindows,
        timeout: 5,
        statusMessage: `Checking code lookup strategy (${environment.toUpperCase()})`,
      },
    ],
  };
}

function hookEnvironment(entry: unknown): LegacyEnvironmentId | undefined {
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
  environment: CurrentEnvironmentId,
  owned: ManagedSectionRecord | undefined,
  fileExisted: boolean,
): { readonly bytes: Buffer; readonly section: ManagedSectionRecord } {
  const document = current === undefined
    ? { hooks: {} as JsonMap }
    : parseJsonBytes(current, "invalid_json", HOOKS_PATH);
  const hooksExisted = current !== undefined && document.hooks !== undefined;
  if (document.hooks === undefined) document.hooks = {};
  if (!isRecord(document.hooks)) throw new InstallError("invalid_json", HOOKS_PATH);
  const hooks = document.hooks;
  const preToolUseExisted = hooks.PreToolUse !== undefined;
  if (hooks.PreToolUse === undefined) hooks.PreToolUse = [];
  if (!Array.isArray(hooks.PreToolUse) || !hooks.PreToolUse.every(isRecord)) {
    throw new InstallError("invalid_json", HOOKS_PATH);
  }
  const ownedIndexes = hooks.PreToolUse
    .map((entry, index) => ({ index, environment: hookEnvironment(entry) }))
    .filter((entry) => entry.environment !== undefined);
  let insertionIndex: number | undefined;
  let previousOwnedEntry: unknown;
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
    previousOwnedEntry = hooks.PreToolUse[matched[0].index];
    hooks.PreToolUse.splice(matched[0].index, 1);
    insertionIndex = matched[0].index;
  } else if (ownedIndexes.length > 0) {
    throw new InstallError("unmanaged_name_conflict", HOOKS_PATH);
  }
  const entry = managedHook(environment);
  if (insertionIndex === undefined) hooks.PreToolUse.push(entry);
  else hooks.PreToolUse.splice(insertionIndex, 0, entry);
  const renderedIndex = hooks.PreToolUse.length - 1;
  const preserveManaged = owned !== undefined && previousOwnedEntry !== undefined &&
    sectionDigest(previousOwnedEntry) === sectionDigest(entry);
  const bytes = current === undefined
    ? Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8")
    : losslessHooks(current, (original) => {
        if (preserveManaged) return original;
        if (owned !== undefined && insertionIndex !== undefined) {
          return upsertJsonArrayElement(original, ["hooks", "PreToolUse"], insertionIndex, entry);
        }
        return preToolUseExisted
          ? upsertJsonArrayElement(original, ["hooks", "PreToolUse"], renderedIndex, entry)
          : upsertJsonObjectProperty(original, ["hooks"], "PreToolUse", [entry]);
      });
  return {
    bytes,
    section: sectionRecord(
      `hooks.PreToolUse.kcoderag-nav.${environment}`,
      entry,
      fileExisted,
      owned?.createdContainers ?? [
        ...(hooksExisted ? [] : ["hooks"]),
        ...(preToolUseExisted ? [] : ["hooks.PreToolUse"]),
      ],
    ),
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

function validateOwnedSections(
  target: ProjectTarget,
  state: Pick<LegacyInstallState, "environment" | "sections"> | InstallState,
): void {
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

function legacyEnvironment(bytes: Buffer): LegacyEnvironmentId | undefined {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(value)) return undefined;
    if (
      value.version === 1 &&
      !("schemaVersion" in value) &&
      Array.isArray(value.active_environments) &&
      value.active_environments.length === 1 &&
      (value.active_environments[0] === "qa" || value.active_environments[0] === "dev")
    ) return value.active_environments[0];
    if (
      value.schemaVersion === CORE_SCHEMA_VERSION &&
      (value.environment === "qa" || value.environment === "dev")
    ) return value.environment;
  } catch {
    // The schema parser below produces the stable invalid_state refusal.
  }
  return undefined;
}

function isUserKCodeRagTomlPath(keys: readonly string[]): boolean {
  return keys[0] === "mcp_servers" &&
    (keys[1] === "kcoderag-qa" || keys[1] === "kcoderag-dev" || keys[1] === "kcoderag-nav");
}

function validateLegacyState(target: ProjectTarget, legacy: LegacyInstallState): void {
  if (legacy.source === "node") {
    if (legacy.host !== "codex") throw new InstallError("invalid_state", STATE_PATH);
    const expected = legacyNodeManagedPaths(legacy.environment);
    const owned = expected.filter((relativePath) => relativePath !== STATE_PATH);
    const dedicated = owned.filter((relativePath) =>
      !SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number]));
    const secureState = legacy.sections !== undefined;
    if (
      legacy.managedFiles.join("\0") !== expected.join("\0") ||
      Object.keys(legacy.originals).sort().join("\0") !==
        [...(secureState ? dedicated : owned)].sort().join("\0") ||
      Object.keys(legacy.digests).sort().join("\0") !==
        [...(secureState ? dedicated : owned)].sort().join("\0") ||
      (secureState && Object.keys(legacy.sections ?? {}).sort().join("\0") !==
        [...SHARED_PATHS].sort().join("\0")) ||
      (secureState && legacy.sections?.[CONFIG_PATH]?.id !==
        `mcp_servers.kcoderag-${legacy.environment}`) ||
      (secureState && legacy.sections?.[HOOKS_PATH]?.id !==
        `hooks.PreToolUse.kcoderag-nav.${legacy.environment}`)
    ) {
      throw new InstallError("invalid_state", STATE_PATH);
    }
    if (secureState) validateOwnedSections(target, legacy);
    return;
  }
  const required = legacyRequiredPaths(legacy.environment);
  if (
    legacy.managedFiles.some((relativePath) => !legacyAllowedPaths(legacy.environment).includes(relativePath)) ||
    required.some((relativePath) =>
      !legacy.managedFiles.includes(relativePath) ||
      legacy.originals[relativePath] === undefined ||
      legacy.digests[relativePath] === undefined)
  ) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
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
  const encodedLegacyEnvironment = legacyEnvironment(stateBytes);
  try {
    let currentState: InstallState | undefined;
    try {
      currentState = validateCurrentState(parseInstallState(stateBytes));
    } catch {
      // Exact legacy decoding below owns compatibility; invalid inputs remain invalid.
    }
    if (currentState !== undefined) {
      if (currentState.sections !== undefined) validateOwnedSections(context.target, currentState);
      for (const [relativePath, digest] of Object.entries(currentState.digests)) {
        const current = readManagedOptional(context.target, relativePath);
        if (current === undefined || sha256(current) !== digest) {
          throw new InstallError("managed_content_changed", relativePath);
        }
      }
      return Object.freeze({
        host: "codex" as const,
        target: context.target,
        currentState,
        details: Object.freeze({ stateBytes: Buffer.from(stateBytes) } satisfies CodexObservationDetails),
      });
    }
    if (encodedLegacyEnvironment !== undefined) {
      const legacyState = parseLegacyInstallState(stateBytes, {
        allowedPaths: legacyAllowedPaths(encodedLegacyEnvironment),
        requiredPaths: [CONFIG_PATH, HOOKS_PATH, SKILL_PATH],
      });
      validateLegacyState(context.target, legacyState);
      for (const [relativePath, digest] of Object.entries(legacyState.digests)) {
        const current = readManagedOptional(context.target, relativePath);
        if (current === undefined || sha256(current) !== digest) {
          throw new InstallError("managed_content_changed", relativePath);
        }
      }
      return Object.freeze({
        host: "codex" as const,
        target: context.target,
        legacyEnvironment: legacyState.environment,
        details: Object.freeze({
          stateBytes: Buffer.from(stateBytes),
          legacyState,
        } satisfies CodexObservationDetails),
      });
    }
    throw new InstallError("invalid_state", STATE_PATH);
  } catch (error) {
    const observation: {
      host: "codex";
      target: ProjectTarget;
      issues: readonly StatusIssue[];
      legacyEnvironment?: LegacyEnvironmentId;
      details: Readonly<CodexObservationDetails>;
    } = {
      host: "codex" as const,
      target: context.target,
      issues: Object.freeze([issueFrom(error)]),
      details: Object.freeze({ stateBytes: Buffer.from(stateBytes) } satisfies CodexObservationDetails),
    };
    if (encodedLegacyEnvironment !== undefined) observation.legacyEnvironment = encodedLegacyEnvironment;
    return Object.freeze(observation);
  }
}

function refuseIssues(observation: HostObservation): void {
  const issue = observation.issues?.[0];
  if (issue !== undefined) throw new InstallError(issue.code, issue.path);
}

function captureOriginals(
  target: ProjectTarget,
  environment: CurrentEnvironmentId,
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
  priorSections?: Readonly<Record<string, ManagedSectionRecord>>,
): { readonly payloads: Map<string, Buffer>; readonly sections: Record<string, ManagedSectionRecord> } {
  const environment = context.environment;
  const name = packageName(environment);
  const existing = context.observation.currentState;
  const currentConfig = priorOriginals === undefined || priorSections !== undefined
    ? readManagedOptional(context.target, CONFIG_PATH)
    : decodeOriginal(priorOriginals[CONFIG_PATH], CONFIG_PATH) ?? undefined;
  const currentHooks = priorOriginals === undefined || priorSections !== undefined
    ? readManagedOptional(context.target, HOOKS_PATH)
    : decodeOriginal(priorOriginals[HOOKS_PATH], HOOKS_PATH) ?? undefined;
  const config = renderConfig(
    currentConfig,
    context.packageRoot,
    environment,
    priorSections?.[CONFIG_PATH] ??
      (priorOriginals === undefined ? existing?.sections?.[CONFIG_PATH] : undefined),
    priorSections?.[CONFIG_PATH]?.fileExisted ?? existing?.sections?.[CONFIG_PATH]?.fileExisted ??
      (priorOriginals === undefined
        ? currentConfig !== undefined
        : priorOriginals[CONFIG_PATH]?.kind !== "absent"),
  );
  const hooks = renderHooks(
    currentHooks,
    environment,
    priorSections?.[HOOKS_PATH] ??
      (priorOriginals === undefined ? existing?.sections?.[HOOKS_PATH] : undefined),
    priorSections?.[HOOKS_PATH]?.fileExisted ?? existing?.sections?.[HOOKS_PATH]?.fileExisted ??
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
  legacy: LegacyInstallState,
): Record<string, OriginalRecord> {
  const originals: Record<string, OriginalRecord> = {};
  for (const relativePath of managedPaths()) {
    if (relativePath === STATE_PATH) continue;
    if (SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])) {
      if (legacy.sections !== undefined) continue;
      const legacyOriginal = legacy.originals[relativePath];
      if (legacyOriginal === undefined) throw new InstallError("invalid_state", STATE_PATH);
      originals[relativePath] = legacyOriginal;
      continue;
    }
    if (relativePath === SKILL_PATH || legacy.managedFiles.includes(relativePath)) {
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
  if (legacy.environment === "dev" && !context.allowLegacyDevMigration) {
    throw new InstallError("legacy_dev_migration_authority_required", STATE_PATH);
  }
  if (legacy.environment !== "dev" && context.allowLegacyDevMigration) {
    throw new InstallError("legacy_dev_migration_authority_invalid", STATE_PATH);
  }
  const environment: CurrentEnvironmentId = "qa";
  const paths = managedPaths(environment);
  const legacyOriginals = migrationOriginals(context.target, legacy);
  const originals = Object.fromEntries(Object.entries(legacyOriginals).filter(([relativePath]) =>
    !SHARED_PATHS.includes(relativePath as typeof SHARED_PATHS[number])));
  const rendered = desiredPayloads(context, legacyOriginals, legacy.sections);
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
  const replacementPaths = new Set(paths);
  const legacyOnlyPaths = legacy.managedFiles.filter((relativePath) =>
    relativePath !== STATE_PATH && !replacementPaths.has(relativePath));
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
          : (() => {
              const current = readManagedOptional(context.target, relativePath);
              return current === undefined ? null : sha256(current);
            })(),
        content: payloads.get(relativePath) ?? null,
      })),
      ...legacyOnlyPaths.map((relativePath) => ({
        relativePath,
        expectedDigest: (() => {
          const current = readManagedOptional(context.target, relativePath);
          return current === undefined ? null : sha256(current);
        })(),
        content: decodeOriginal(legacy.originals[relativePath], relativePath),
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
  let renderedHooks = losslessHooks(currentHooks, (original) =>
    removeJsonArrayElement(original, ["hooks", "PreToolUse"], matched[0]!.index), "managed_content_changed");
  if (hooksDocument.hooks.PreToolUse.length === 0 &&
      hooksRecord.createdContainers?.includes("hooks.PreToolUse")) {
    delete hooksDocument.hooks.PreToolUse;
  }
  if (hooksDocument.hooks.PreToolUse === undefined) {
    renderedHooks = losslessHooks(renderedHooks, (original) =>
      removeJsonObjectProperty(original, ["hooks"], "PreToolUse"), "managed_content_changed");
  }
  if (Object.keys(hooksDocument.hooks).length === 0 &&
      hooksRecord.createdContainers?.includes("hooks")) {
    delete hooksDocument.hooks;
  }
  if (hooksDocument.hooks === undefined) {
    renderedHooks = losslessHooks(renderedHooks, (original) =>
      removeJsonObjectProperty(original, [], "hooks"), "managed_content_changed");
  }
  result.set(
    HOOKS_PATH,
    !hooksRecord.fileExisted && Object.keys(hooksDocument).length === 0
      ? null
      : renderedHooks,
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

function codexProcessInvocation(request: NativeRunRequest): {
  readonly executable: string;
  readonly args: readonly string[];
} {
  if (process.platform !== "win32" || request.executable !== "codex") {
    return { executable: request.executable, args: request.args };
  }
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory.length === 0) continue;
    const bin = path.join(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
    try {
      const metadata = fs.lstatSync(bin);
      if (!metadata.isSymbolicLink() && metadata.isFile()) {
        return { executable: process.execPath, args: Object.freeze([bin, ...request.args]) };
      }
    } catch {
      // Continue to the next PATH root without exposing it.
    }
  }
  return { executable: request.executable, args: request.args };
}

function defaultCodexRunner(request: NativeRunRequest): Promise<CodexNativeResult> {
  return new Promise((resolve) => {
    const invocation = codexProcessInvocation(request);
    childProcess.execFile(
      invocation.executable,
      [...invocation.args],
      {
        encoding: "utf8",
        timeout: request.timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        shell: false,
      },
      (error, stdout, stderr) => {
        const timedOut = error !== null && (
          error.killed === true ||
          error.code === "ETIMEDOUT" ||
          error.signal === "SIGTERM"
        );
        const exitCode = error === null
          ? 0
          : typeof error.code === "number"
            ? error.code
            : 1;
        const result: {
          exitCode: number;
          timedOut: boolean;
          stdout?: string;
          failureAttribution?: "marketplace_load" | "unrelated_failure";
        } = { exitCode, timedOut };
        if (typeof stdout === "string" && Buffer.byteLength(stdout, "utf8") <= 1024 * 1024) {
          result.stdout = stdout;
        }
        if (error !== null) {
          const diagnostic = typeof stderr === "string" && Buffer.byteLength(stderr, "utf8") <= 1024 * 1024
            ? stderr
            : "";
          result.failureAttribution =
            /kcoderag-nav/i.test(diagnostic) &&
            /failed to load marketplace|supported (?:marketplace )?manifest/i.test(diagnostic)
              ? "marketplace_load"
              : "unrelated_failure";
        }
        resolve(Object.freeze(result));
      },
    );
  });
}

function readBoundedRegularText(filePath: string, maximumBytes: number): string | undefined {
  try {
    const metadata = fs.lstatSync(filePath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > maximumBytes) return undefined;
    return new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(filePath));
  } catch {
    return undefined;
  }
}

function normalizedAbsolute(input: string): string | undefined {
  if (typeof input !== "string" || input.length === 0 || input.length > 4096 || /[\r\n\0]/.test(input)) {
    return undefined;
  }
  const normalized = path.resolve(input);
  return path.normalize(input) === normalized ? normalized : undefined;
}

function samePlatformPath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function recognizedLegacySource(input: string): string | undefined {
  const normalized = normalizedAbsolute(input);
  if (normalized === undefined) return undefined;
  try {
    const rootMetadata = fs.lstatSync(normalized);
    const packagePath = path.join(normalized, "package.json");
    const packageMetadata = fs.lstatSync(packagePath);
    if (
      rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory() ||
      packageMetadata.isSymbolicLink() || !packageMetadata.isFile() ||
      packageMetadata.size > 64 * 1024
    ) return undefined;
    const value: unknown = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    if (!isRecord(value) || value.name !== "kcoderag-nav" || !isRecord(value.repository) ||
        value.repository.type !== "git" || value.repository.url !== LEGACY_REPOSITORY_URL) {
      return undefined;
    }
    const retiredManifests = [
      path.join(normalized, ".codex-plugin", "marketplace.json"),
      path.join(normalized, ".claude-plugin", "marketplace.json"),
    ];
    if (retiredManifests.some((candidate) => fs.existsSync(candidate))) return undefined;
    return normalized;
  } catch {
    return undefined;
  }
}

function parseTomlStringLiteral(input: string): string | undefined {
  const value = input.trim();
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && !value.slice(1, -1).includes("'")) {
    return value.slice(1, -1);
  }
  return undefined;
}

function defaultUserSourceReader(codexHome: string): CodexUserSourceReader {
  return () => {
    const configPath = path.join(codexHome, "config.toml");
    const hooksPath = path.join(codexHome, "hooks.json");
    const cachePath = path.join(codexHome, ".tmp", "marketplaces", OWNED_MARKETPLACE);
    const rawMcpPaths = new Set<string>();
    const manualHookPaths = new Set<string>();
    const cachePaths = new Set<string>();
    const ambiguousPaths = new Set<string>();
    const registrations: CodexRegistrationMetadata[] = [];
    const config = readBoundedRegularText(configPath, 1024 * 1024);
    if (fs.existsSync(configPath) && config === undefined) ambiguousPaths.add(USER_CONFIG_SAFE_PATH);
    if (config !== undefined) {
      let section: readonly string[] = [];
      let ownedSectionCount = 0;
      let marketplaceCount = 0;
      let sourceType: string | undefined;
      let source: string | undefined;
      for (const rawLine of config.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith("#")) continue;
        if (line.startsWith("[") && line.endsWith("]")) {
          const offset = line.startsWith("[[") ? 2 : 1;
          const endOffset = line.endsWith("]]" ) ? 2 : 1;
          const parsed = parseTomlKeyPath(line.slice(offset, line.length - endOffset));
          section = parsed?.keys ?? [];
          if (section[0] === "marketplaces" && section.length === 2) {
            marketplaceCount += 1;
            if (section[1] === OWNED_MARKETPLACE) ownedSectionCount += 1;
          }
          if (isUserKCodeRagTomlPath(section)) rawMcpPaths.add(USER_CONFIG_SAFE_PATH);
          continue;
        }
        const parsed = parseTomlKeyPath(line);
        if (parsed === undefined) continue;
        const equals = skipTomlWhitespace(line, parsed.end);
        if (line[equals] !== "=") continue;
        const completePath = [...section, ...parsed.keys];
        if (isUserKCodeRagTomlPath(completePath) || (
          completePath.length === 1 && completePath[0] === "mcp_servers" &&
          inlineTableDefinesManaged(line, equals + 1)
        )) rawMcpPaths.add(USER_CONFIG_SAFE_PATH);
        if (section[0] === "marketplaces" && section[1] === OWNED_MARKETPLACE && section.length === 2) {
          const key = parsed.keys.length === 1 ? parsed.keys[0] : undefined;
          if (key === "source_type") sourceType = parseTomlStringLiteral(line.slice(equals + 1));
          if (key === "source") source = parseTomlStringLiteral(line.slice(equals + 1));
        }
      }
      if (ownedSectionCount > 1) ambiguousPaths.add(USER_CONFIG_SAFE_PATH);
      if (ownedSectionCount === 1) {
        const recognized = sourceType === "local" && source !== undefined
          ? recognizedLegacySource(source)
          : undefined;
        if (recognized === undefined) {
          ambiguousPaths.add(USER_CONFIG_SAFE_PATH);
        } else {
          registrations.push(Object.freeze({
            host: "codex",
            sourceType: "owned_marketplace_registration",
            marketplaceName: OWNED_MARKETPLACE,
            sourcePath: recognized,
            recognizedSourcePath: recognized,
            provenanceId: LEGACY_PROVENANCE_ID,
            safePath: USER_CONFIG_SAFE_PATH,
            failureAttribution: "marketplace_load",
            exclusiveUserMarketplace: marketplaceCount === 1,
          }));
        }
      }
    }
    const hooks = readBoundedRegularText(hooksPath, 1024 * 1024);
    if (fs.existsSync(hooksPath) && hooks === undefined) ambiguousPaths.add(USER_HOOKS_SAFE_PATH);
    if (hooks !== undefined) {
      try {
        const document: unknown = JSON.parse(hooks);
        if (!isRecord(document) || (document.hooks !== undefined && !isRecord(document.hooks))) {
          ambiguousPaths.add(USER_HOOKS_SAFE_PATH);
        } else if (document.hooks !== undefined && /kcoderag-(?:nav|qa|dev)|kcoderag_nav/i.test(JSON.stringify(document.hooks))) {
          manualHookPaths.add(USER_HOOKS_SAFE_PATH);
        }
      } catch {
        ambiguousPaths.add(USER_HOOKS_SAFE_PATH);
      }
    }
    try {
      const metadata = fs.lstatSync(cachePath);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) ambiguousPaths.add(USER_CACHE_SAFE_PATH);
      else cachePaths.add(USER_CACHE_SAFE_PATH);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") ambiguousPaths.add(USER_CACHE_SAFE_PATH);
    }
    return Object.freeze({
      registrations: Object.freeze(registrations),
      rawMcpPaths: Object.freeze([...rawMcpPaths]),
      manualHookPaths: Object.freeze([...manualHookPaths]),
      cachePaths: Object.freeze([...cachePaths]),
      ambiguousPaths: Object.freeze([...ambiguousPaths]),
    });
  };
}

interface ParsedPluginEntry {
  readonly pluginId: string;
  readonly name: string;
  readonly marketplaceName: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly sourceKind: string;
  readonly localPath?: string;
  readonly marketplaceSourceType?: string;
  readonly marketplaceLocalSource?: string;
}

interface ParsedMarketplaceEntry {
  readonly name: string;
  readonly root: string;
  readonly marketplaceSourceType?: string;
  readonly marketplaceLocalSource?: string;
}

function exactKeys(value: JsonMap, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function boundedString(value: unknown, maximum = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\r\n\0]/.test(value);
}

function parseMarketplaceSource(value: unknown): {
  readonly sourceType: string;
  readonly localSource?: string;
} | undefined {
  if (!isRecord(value) || !exactKeys(value, ["sourceType", "source"]) ||
      !boundedString(value.sourceType, 32) || !boundedString(value.source)) return undefined;
  if (value.sourceType !== "local" && value.sourceType !== "git") return undefined;
  return value.sourceType === "local"
    ? { sourceType: value.sourceType, localSource: value.source }
    : { sourceType: value.sourceType };
}

function parsePluginSource(value: unknown): { readonly kind: string; readonly localPath?: string } | undefined {
  if (!isRecord(value) || !boundedString(value.source, 32)) return undefined;
  if (value.source === "local") {
    return exactKeys(value, ["source", "path"]) && boundedString(value.path)
      ? { kind: "local", localPath: value.path }
      : undefined;
  }
  if (value.source === "git") {
    return exactKeys(value, ["source", "url"], ["ref", "sha"]) &&
      boundedString(value.url) &&
      (value.ref === undefined || boundedString(value.ref, 256)) &&
      (value.sha === undefined || boundedString(value.sha, 128))
      ? { kind: "git" }
      : undefined;
  }
  if (value.source === "git-subdir") {
    return exactKeys(value, ["source", "url", "path"], ["ref", "sha"]) &&
      boundedString(value.url) && boundedString(value.path) &&
      (value.ref === undefined || boundedString(value.ref, 256)) &&
      (value.sha === undefined || boundedString(value.sha, 128))
      ? { kind: "git-subdir" }
      : undefined;
  }
  if (value.source === "npm") {
    return exactKeys(value, ["source", "package"], ["version", "registry"]) &&
      boundedString(value.package, 256) &&
      (value.version === undefined || boundedString(value.version, 128)) &&
      (value.registry === undefined || boundedString(value.registry))
      ? { kind: "npm" }
      : undefined;
  }
  return undefined;
}

function parsePluginEntry(value: unknown): ParsedPluginEntry | undefined {
  if (!isRecord(value) || !exactKeys(
    value,
    ["pluginId", "name", "marketplaceName", "version", "installed", "enabled", "source", "installPolicy", "authPolicy"],
    ["marketplaceSource"],
  ) ||
      !boundedString(value.pluginId, 320) || !boundedString(value.name, 160) ||
      !boundedString(value.marketplaceName, 160) ||
      (value.version !== null && !boundedString(value.version, 128)) ||
      typeof value.installed !== "boolean" || typeof value.enabled !== "boolean" ||
      !boundedString(value.installPolicy, 64) || !boundedString(value.authPolicy, 64)) {
    return undefined;
  }
  const source = parsePluginSource(value.source);
  if (source === undefined) return undefined;
  const marketplace = value.marketplaceSource === undefined
    ? undefined
    : parseMarketplaceSource(value.marketplaceSource);
  if (value.marketplaceSource !== undefined && marketplace === undefined) return undefined;
  const result: {
    pluginId: string;
    name: string;
    marketplaceName: string;
    installed: boolean;
    enabled: boolean;
    sourceKind: string;
    localPath?: string;
    marketplaceSourceType?: string;
    marketplaceLocalSource?: string;
  } = {
    pluginId: value.pluginId,
    name: value.name,
    marketplaceName: value.marketplaceName,
    installed: value.installed,
    enabled: value.enabled,
    sourceKind: source.kind,
  };
  if (source.localPath !== undefined) result.localPath = source.localPath;
  if (marketplace !== undefined) result.marketplaceSourceType = marketplace.sourceType;
  if (marketplace?.localSource !== undefined) result.marketplaceLocalSource = marketplace.localSource;
  return Object.freeze(result);
}

function parsePluginInventory(stdout: string): readonly ParsedPluginEntry[] | undefined {
  if (Buffer.byteLength(stdout, "utf8") > 1024 * 1024) return undefined;
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { return undefined; }
  if (!isRecord(value) || !exactKeys(value, ["installed", "available"]) ||
      !Array.isArray(value.installed) || !Array.isArray(value.available)) return undefined;
  const installed = value.installed.map(parsePluginEntry);
  const available = value.available.map(parsePluginEntry);
  if (installed.some((entry) => entry === undefined) || available.some((entry) => entry === undefined)) return undefined;
  const normalizedInstalled = installed as ParsedPluginEntry[];
  const normalizedAvailable = available as ParsedPluginEntry[];
  if (normalizedInstalled.some((entry) => !entry.installed) || normalizedAvailable.some((entry) => entry.installed)) {
    return undefined;
  }
  const all = [...normalizedInstalled, ...normalizedAvailable];
  if (new Set(all.map((entry) => entry.pluginId)).size !== all.length) return undefined;
  return Object.freeze(all);
}

function parseMarketplaceEntry(value: unknown): ParsedMarketplaceEntry | undefined {
  if (!isRecord(value) || !exactKeys(value, ["name", "root"], ["marketplaceSource"]) ||
      !boundedString(value.name, 160) || !boundedString(value.root)) return undefined;
  const source = value.marketplaceSource === undefined
    ? undefined
    : parseMarketplaceSource(value.marketplaceSource);
  if (value.marketplaceSource !== undefined && source === undefined) return undefined;
  const result: {
    name: string;
    root: string;
    marketplaceSourceType?: string;
    marketplaceLocalSource?: string;
  } = { name: value.name, root: value.root };
  if (source !== undefined) result.marketplaceSourceType = source.sourceType;
  if (source?.localSource !== undefined) result.marketplaceLocalSource = source.localSource;
  return Object.freeze(result);
}

function parseMarketplaceInventory(stdout: string): readonly ParsedMarketplaceEntry[] | undefined {
  if (Buffer.byteLength(stdout, "utf8") > 1024 * 1024) return undefined;
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { return undefined; }
  if (!isRecord(value) || !exactKeys(value, ["marketplaces"]) || !Array.isArray(value.marketplaces)) {
    return undefined;
  }
  const entries = value.marketplaces.map(parseMarketplaceEntry);
  if (entries.some((entry) => entry === undefined)) return undefined;
  const normalized = entries as ParsedMarketplaceEntry[];
  if (new Set(normalized.map((entry) => entry.name)).size !== normalized.length ||
      new Set(normalized.map((entry) => entry.root)).size !== normalized.length) return undefined;
  return Object.freeze(normalized);
}

function semverTuple(value: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function versionAtLeast(value: string, minimum: string): boolean {
  const left = semverTuple(value);
  const right = semverTuple(minimum);
  if (left === undefined || right === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] as number) - (right[index] as number);
    if (delta !== 0) return delta > 0;
  }
  return true;
}

function observedCodexVersion(stdout: string | undefined): string | undefined {
  if (stdout === undefined || Buffer.byteLength(stdout, "utf8") > 1024) return undefined;
  const match = /^codex-cli (\d+\.\d+\.\d+)\s*$/.exec(stdout);
  return match?.[1];
}

function helpMatches(command: string, stdout: string | undefined): boolean {
  if (stdout === undefined || Buffer.byteLength(stdout, "utf8") > 64 * 1024) return false;
  if (!stdout.includes("--json")) return false;
  if (command === "plugin remove") return /PLUGIN/i.test(stdout);
  if (command === "plugin marketplace remove") return /MARKETPLACE/i.test(stdout);
  return true;
}

async function observeCapability(
  runner: CodexNativeRunner,
  mode: SourceScanMode,
): Promise<NativeHostCapability | undefined> {
  const versionResult = await runner(Object.freeze({
    executable: "codex",
    args: Object.freeze(["--version"]),
    timeoutMs: CODEX_TIMEOUT_MS,
  }));
  const version = versionResult.exitCode === 0 && !versionResult.timedOut
    ? observedCodexVersion(versionResult.stdout)
    : undefined;
  if (version === undefined || !versionAtLeast(version, CODEX_MINIMUM_VERSION)) return undefined;
  if (mode !== "fast") {
    const helpCommands = [
      ["plugin", "list"],
      ["plugin", "marketplace", "list"],
      ["plugin", "remove"],
      ["plugin", "marketplace", "remove"],
    ] as const;
    for (const parts of helpCommands) {
      const result = await runner(Object.freeze({
        executable: "codex",
        args: Object.freeze([...parts, "--help"]),
        timeoutMs: CODEX_TIMEOUT_MS,
      }));
      if (result.exitCode !== 0 || result.timedOut || !helpMatches(parts.join(" "), result.stdout)) {
        return undefined;
      }
    }
  }
  return createNativeHostCapability({
    host: "codex",
    cli: "codex",
    minimumVersion: CODEX_MINIMUM_VERSION,
    observedVersion: version,
    inventorySchemaId: CODEX_INVENTORY_SCHEMA,
    completeInventory: true,
    route: "normal",
  });
}

function safeMetadataPath(value: unknown): value is string {
  return typeof value === "string" && [
    USER_CONFIG_SAFE_PATH,
    USER_HOOKS_SAFE_PATH,
    USER_CACHE_SAFE_PATH,
  ].includes(value);
}

function normalizeUserSourceMetadata(value: unknown): CodexUserSourceMetadata {
  const ambiguous = (): CodexUserSourceMetadata => Object.freeze({
    registrations: Object.freeze([]),
    rawMcpPaths: Object.freeze([]),
    manualHookPaths: Object.freeze([]),
    cachePaths: Object.freeze([]),
    ambiguousPaths: Object.freeze([USER_CONFIG_SAFE_PATH]),
  });
  if (!isRecord(value) || !exactKeys(value, [
    "registrations", "rawMcpPaths", "manualHookPaths", "cachePaths", "ambiguousPaths",
  ]) ||
      !Array.isArray(value.registrations) || !Array.isArray(value.rawMcpPaths) ||
      !Array.isArray(value.manualHookPaths) || !Array.isArray(value.cachePaths) ||
      !Array.isArray(value.ambiguousPaths)) return ambiguous();
  const pathGroups = [value.rawMcpPaths, value.manualHookPaths, value.cachePaths, value.ambiguousPaths];
  if (pathGroups.some((group) => group.some((item) => !safeMetadataPath(item)))) return ambiguous();
  const registrations: CodexRegistrationMetadata[] = [];
  for (const item of value.registrations) {
    if (!isRecord(item) || !exactKeys(item, [
      "host", "sourceType", "marketplaceName", "sourcePath", "recognizedSourcePath",
      "provenanceId", "safePath", "failureAttribution", "exclusiveUserMarketplace",
    ]) ||
        item.host !== "codex" || item.sourceType !== "owned_marketplace_registration" ||
        item.marketplaceName !== OWNED_MARKETPLACE || item.provenanceId !== LEGACY_PROVENANCE_ID ||
        item.safePath !== USER_CONFIG_SAFE_PATH || item.failureAttribution !== "marketplace_load" ||
        typeof item.exclusiveUserMarketplace !== "boolean" ||
        typeof item.sourcePath !== "string" || typeof item.recognizedSourcePath !== "string") {
      return ambiguous();
    }
    const sourcePath = normalizedAbsolute(item.sourcePath);
    const recognizedSourcePath = normalizedAbsolute(item.recognizedSourcePath);
    if (sourcePath === undefined || recognizedSourcePath === undefined ||
        !samePlatformPath(sourcePath, recognizedSourcePath)) return ambiguous();
    registrations.push(Object.freeze({
      host: "codex",
      sourceType: "owned_marketplace_registration",
      marketplaceName: OWNED_MARKETPLACE,
      sourcePath,
      recognizedSourcePath,
      provenanceId: LEGACY_PROVENANCE_ID,
      safePath: USER_CONFIG_SAFE_PATH,
      failureAttribution: "marketplace_load",
      exclusiveUserMarketplace: item.exclusiveUserMarketplace,
    }));
  }
  return Object.freeze({
    registrations: Object.freeze(registrations),
    rawMcpPaths: Object.freeze([...(value.rawMcpPaths as string[])]),
    manualHookPaths: Object.freeze([...(value.manualHookPaths as string[])]),
    cachePaths: Object.freeze([...(value.cachePaths as string[])]),
    ambiguousPaths: Object.freeze([...(value.ambiguousPaths as string[])]),
  });
}

function conflictFinding(
  code: "raw_mcp_source" | "manual_hook_source" | "ambiguous_source" | "source_scan_unavailable",
  sourceType: "raw_mcp" | "manual_hook" | "ambiguous",
  safePath: string,
) {
  return createSourceFinding({
    code,
    severity: "conflict",
    sourceType,
    scope: "user",
    safePath,
    cleanupEligible: false,
  });
}

function metadataFindings(metadata: CodexUserSourceMetadata, mode: SourceScanMode) {
  const findings = [
    ...metadata.rawMcpPaths.map((safePath) => conflictFinding("raw_mcp_source", "raw_mcp", safePath)),
    ...metadata.manualHookPaths.map((safePath) => conflictFinding("manual_hook_source", "manual_hook", safePath)),
    ...metadata.ambiguousPaths.map((safePath) => conflictFinding("ambiguous_source", "ambiguous", safePath)),
  ];
  if (mode !== "fast") {
    findings.push(...metadata.cachePaths.map((safePath) => createSourceFinding({
      code: "cache_residue",
      severity: "info",
      sourceType: "cache_residue",
      scope: "user",
      safePath,
      cleanupEligible: false,
    })));
  }
  return findings;
}

function matchesRegistrationSource(
  registration: CodexRegistrationMetadata | undefined,
  source: string | undefined,
): boolean {
  if (registration === undefined || source === undefined) return false;
  const normalized = normalizedAbsolute(source);
  return normalized !== undefined && samePlatformPath(normalized, registration.sourcePath);
}

function containedPluginPath(registration: CodexRegistrationMetadata, pluginPath: string | undefined): boolean {
  if (pluginPath === undefined) return false;
  const normalized = normalizedAbsolute(pluginPath);
  if (normalized === undefined) return false;
  const relative = path.relative(registration.sourcePath, normalized);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function exactOwnedPlugin(entry: ParsedPluginEntry, registration: CodexRegistrationMetadata | undefined): boolean {
  return registration !== undefined &&
    OWNED_PLUGIN_NAMES.has(entry.name) &&
    entry.marketplaceName === OWNED_MARKETPLACE &&
    entry.pluginId === `${entry.name}@${OWNED_MARKETPLACE}` &&
    entry.sourceKind === "local" &&
    containedPluginPath(registration, entry.localPath) &&
    entry.marketplaceSourceType === "local" &&
    matchesRegistrationSource(registration, entry.marketplaceLocalSource);
}

function exactOwnedMarketplace(
  entry: ParsedMarketplaceEntry,
  registration: CodexRegistrationMetadata | undefined,
): boolean {
  return entry.name === OWNED_MARKETPLACE &&
    entry.marketplaceSourceType === "local" &&
    matchesRegistrationSource(registration, entry.marketplaceLocalSource);
}

function findingWithPlan(
  plan: NativeCleanupPlan,
  code: "owned_plugin_source" | "owned_marketplace_source",
) {
  return createSourceFinding({
    code,
    severity: "conflict",
    sourceType: plan.sourceType,
    scope: "user",
    safePath: plan.safePath,
    cleanupEligible: true,
    cleanupCommand: plan.command,
    cleanupFingerprint: plan.fingerprint,
  });
}

function manualOwnedFinding(
  sourceType: "owned_plugin" | "owned_marketplace_registration",
  safePath: string,
) {
  return createSourceFinding({
    code: sourceType === "owned_plugin" ? "owned_plugin_source" : "owned_marketplace_source",
    severity: "conflict",
    sourceType,
    scope: "user",
    safePath,
    cleanupEligible: false,
  });
}

function sourceScanUnavailable(mode: SourceScanMode, findings: readonly ReturnType<typeof createSourceFinding>[]) {
  return createSourceScanResult(mode, [
    ...findings,
    conflictFinding("source_scan_unavailable", "ambiguous", ".codex/plugins"),
  ]);
}

async function nativeInventory(runner: CodexNativeRunner): Promise<{
  readonly pluginResult: CodexNativeResult;
  readonly marketplaceResult: CodexNativeResult;
}> {
  const pluginResult = await runner(Object.freeze({
    executable: "codex",
    args: Object.freeze(["plugin", "list", "--json"]),
    timeoutMs: CODEX_TIMEOUT_MS,
  }));
  const marketplaceResult = await runner(Object.freeze({
    executable: "codex",
    args: Object.freeze(["plugin", "marketplace", "list", "--json"]),
    timeoutMs: CODEX_TIMEOUT_MS,
  }));
  return { pluginResult, marketplaceResult };
}

async function scanCodexUserSources(
  mode: SourceScanMode,
  runner: CodexNativeRunner,
  readUserSources: CodexUserSourceReader,
  allowDegraded: boolean,
): Promise<SourceScanResult> {
  let metadata: CodexUserSourceMetadata;
  try {
    metadata = normalizeUserSourceMetadata(await readUserSources());
  } catch {
    metadata = normalizeUserSourceMetadata({});
  }
  const findings = metadataFindings(metadata, mode);
  let capability: NativeHostCapability | undefined;
  try {
    capability = await observeCapability(runner, mode);
  } catch {
    capability = undefined;
  }
  if (capability === undefined) return sourceScanUnavailable(mode, findings);
  let pluginResult: CodexNativeResult;
  let marketplaceResult: CodexNativeResult;
  try {
    ({ pluginResult, marketplaceResult } = await nativeInventory(runner));
  } catch {
    return sourceScanUnavailable(mode, findings);
  }
  const pluginSucceeded = pluginResult.exitCode === 0 && !pluginResult.timedOut && pluginResult.stdout !== undefined;
  const marketplaceSucceeded = marketplaceResult.exitCode === 0 && !marketplaceResult.timedOut &&
    marketplaceResult.stdout !== undefined;
  if (!pluginSucceeded || !marketplaceSucceeded) {
    const registration = metadata.registrations.length === 1 ? metadata.registrations[0] : undefined;
    const degradedExact = allowDegraded && mode !== "fast" &&
      !pluginSucceeded && !marketplaceSucceeded && !pluginResult.timedOut && !marketplaceResult.timedOut &&
      pluginResult.failureAttribution === "marketplace_load" &&
      marketplaceResult.failureAttribution === "marketplace_load" &&
      registration !== undefined && registration.exclusiveUserMarketplace &&
      metadata.rawMcpPaths.length === 0 && metadata.manualHookPaths.length === 0 &&
      metadata.ambiguousPaths.length === 0;
    if (!degradedExact || registration === undefined) return sourceScanUnavailable(mode, findings);
    const degradedCapability = createNativeHostCapability({
      host: "codex",
      cli: "codex",
      minimumVersion: capability.minimumVersion,
      observedVersion: capability.observedVersion,
      inventorySchemaId: capability.inventorySchemaId,
      completeInventory: false,
      route: "degraded_owned_registration",
    });
    const plan = createNativeCleanupPlan({
      host: "codex",
      sourceType: "owned_marketplace_registration",
      safePath: USER_CONFIG_SAFE_PATH,
      capability: degradedCapability,
      argv: ["codex", "plugin", "marketplace", "remove", OWNED_MARKETPLACE, "--json"],
      scope: "marketplace:kcoderag-nav",
      timeoutMs: CODEX_TIMEOUT_MS,
    });
    return createSourceScanResult(mode, [...findings, findingWithPlan(plan, "owned_marketplace_source")], [plan]);
  }
  const plugins = parsePluginInventory(pluginResult.stdout as string);
  const marketplaces = parseMarketplaceInventory(marketplaceResult.stdout as string);
  if (plugins === undefined || marketplaces === undefined) return sourceScanUnavailable(mode, findings);
  const registration = metadata.registrations.length === 1 ? metadata.registrations[0] : undefined;
  const relatedPlugins = plugins.filter((entry) =>
    /kcoderag/i.test(entry.name) || entry.marketplaceName === OWNED_MARKETPLACE || /kcoderag/i.test(entry.pluginId));
  const relatedMarketplaces = marketplaces.filter((entry) => /kcoderag/i.test(entry.name));
  const malformedRelated = relatedPlugins.some((entry) => entry.installed && entry.enabled &&
    !exactOwnedPlugin(entry, registration)) ||
    relatedMarketplaces.some((entry) => !exactOwnedMarketplace(entry, registration)) ||
    metadata.registrations.length > 1 ||
    (registration !== undefined && relatedMarketplaces.length !== 1);
  if (malformedRelated) {
    return createSourceScanResult(mode, [
      ...findings,
      conflictFinding("ambiguous_source", "ambiguous", ".codex/plugins"),
    ]);
  }
  const activePlugins = relatedPlugins.filter((entry) => entry.installed && entry.enabled);
  const disabledPlugins = relatedPlugins.filter((entry) => entry.installed && !entry.enabled);
  if (mode !== "fast") {
    findings.push(...disabledPlugins.map(() => createSourceFinding({
      code: "disabled_source",
      severity: "info",
      sourceType: "disabled_registration",
      scope: "user",
      safePath: ".codex/plugins",
      cleanupEligible: false,
    })));
  }
  const hasManualConflict = findings.some((finding) => finding.severity === "conflict");
  if (activePlugins.length > 1) {
    return createSourceScanResult(mode, [
      ...findings,
      conflictFinding("ambiguous_source", "ambiguous", ".codex/plugins"),
    ]);
  }
  if (activePlugins[0] !== undefined) {
    const entry = activePlugins[0];
    if (mode === "fast" || hasManualConflict) {
      return createSourceScanResult(mode, [...findings, manualOwnedFinding("owned_plugin", ".codex/plugins")]);
    }
    const plan = createNativeCleanupPlan({
      host: "codex",
      sourceType: "owned_plugin",
      safePath: ".codex/plugins",
      capability,
      argv: ["codex", "plugin", "remove", `${entry.name}@${OWNED_MARKETPLACE}`, "--json"],
      scope: `plugin:${entry.name}`,
      timeoutMs: CODEX_TIMEOUT_MS,
    });
    return createSourceScanResult(mode, [...findings, findingWithPlan(plan, "owned_plugin_source")], [plan]);
  }
  if (relatedMarketplaces[0] !== undefined || registration !== undefined) {
    if (mode === "fast" || hasManualConflict || relatedMarketplaces.length !== 1) {
      return createSourceScanResult(mode, [
        ...findings,
        manualOwnedFinding("owned_marketplace_registration", USER_CONFIG_SAFE_PATH),
      ]);
    }
    const plan = createNativeCleanupPlan({
      host: "codex",
      sourceType: "owned_marketplace_registration",
      safePath: USER_CONFIG_SAFE_PATH,
      capability,
      argv: ["codex", "plugin", "marketplace", "remove", OWNED_MARKETPLACE, "--json"],
      scope: "marketplace:kcoderag-nav",
      timeoutMs: CODEX_TIMEOUT_MS,
    });
    return createSourceScanResult(mode, [...findings, findingWithPlan(plan, "owned_marketplace_source")], [plan]);
  }
  return createSourceScanResult(mode, findings);
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

export function createCodexAdapter(options: CodexAdapterOptions = {}): HostAdapter {
  const runner = options.runner ?? defaultCodexRunner;
  const codexHome = options.homeDirectory === undefined
    ? path.resolve(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"))
    : path.resolve(options.homeDirectory, ".codex");
  const readUserSources = options.readUserSources ?? defaultUserSourceReader(codexHome);
  const issuedPlans = new Map<string, NativeCleanupPlan>();

  const scanUserSources = async (context: HostSourceScanContext): Promise<SourceScanResult> => {
    if (context.observation.host !== "codex" || context.observation.target !== context.target) {
      throw new InstallError("invalid_host_adapter");
    }
    const result = await scanCodexUserSources(context.mode, runner, readUserSources, true);
    issuedPlans.clear();
    for (const plan of result.cleanupPlans) issuedPlans.set(plan.fingerprint, plan);
    return result;
  };

  const cleanupOwnedSource = async (
    plan: NativeCleanupPlan,
    authority: OwnedCleanupAuthority,
  ): Promise<SourceScanResult> => {
    if (plan.host !== "codex" || issuedPlans.get(plan.fingerprint) !== plan) {
      throw new InstallError("cleanup_fingerprint_mismatch");
    }
    issuedPlans.delete(plan.fingerprint);
    await runOwnedSourceCleanup(plan, authority, async (request) => {
      const result = await runner(request);
      return Object.freeze({ exitCode: result.exitCode, timedOut: result.timedOut });
    });
    const result = await scanCodexUserSources("gate", runner, readUserSources, false);
    issuedPlans.clear();
    for (const nextPlan of result.cleanupPlans) issuedPlans.set(nextPlan.fingerprint, nextPlan);
    return result;
  };

  return Object.freeze({
    id: "codex" as const,
    managedRoots: MANAGED_ROOTS,
    detect: detectCodex,
    renderInstall,
    renderUninstall,
    status: codexStatus,
    scanUserSources,
    cleanupOwnedSource,
  });
}

export const codexAdapter: HostAdapter = createCodexAdapter();

exports.STATE_PATH = STATE_PATH;
exports.managedPaths = managedPaths;
exports.createCodexAdapter = createCodexAdapter;
