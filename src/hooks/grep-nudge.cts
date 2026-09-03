#!/usr/bin/env node
/** Advisory, host-neutral KCodeRag lookup hook. Every boundary fails open. */

const fs = require("node:fs") as typeof import("node:fs");
import type { HostId } from "../core/contracts.cjs";
import { indexAvailableForSession } from "./feedback-nudge.cjs";
import { claimReminder, contextEpochForSession } from "./once-marker.cjs";
interface UpdateCheckModule {
  readInstalledVersion(): string | undefined;
  readInstalledHost(): "codex" | "claude" | "cursor" | "opencode" | undefined;
  readUpdateHint(installedVersion: string | undefined, options?: {
    readonly hookPayload?: unknown;
    readonly host?: "codex" | "claude" | "cursor" | "opencode";
  }): string | undefined;
  scheduleRefresh(hookPayload: unknown): boolean;
}

const updateCheck: UpdateCheckModule = (() => {
  try {
    return require("./update-check.cjs") as UpdateCheckModule;
  } catch {
    return {
      readInstalledVersion: () => undefined,
      readInstalledHost: () => undefined,
      readUpdateHint: () => undefined,
      scheduleRefresh: () => false,
    };
  }
})();

export const NUDGE =
  "Structural lookup: use KCodeRag keyword search_code, context, or get_call_chain. " +
  "Until list_indexes proves a usable index for this session, keep this degraded route. " +
  "Use local text search for exact strings, uncommitted edits, or explicit fallback when the index is unavailable.";

export const INDEXED_NUDGE =
  "Structural lookup: a usable KCodeRag index is proven for this session; semantic or hybrid search_code is available. " +
  "Use context or get_call_chain for relationships, and local text search only for exact verification.";

const MAX_COMMAND_CHARS = 65_536;
const MAX_COMMAND_SEGMENTS = 64;
const MAX_INPUT_CHARS = 131_072;

const SILENT_RES: readonly RegExp[] = [
  /^s\/(?:\\.|[^/\\\r\n])*\/(?:\\.|[^/\\\r\n])*\/[gimsx]*$/u,
  /[^=!<>]?={1,2}[^=]/u,
  /^\s*[\w./\\-]+\.(?:txt|json|yaml|yml|md|log|csv|exe|dll|so|cpp|cxx|cc|c|h|hpp|hxx|inl|inc|proto|py|pyx|ts|tsx|js|jsx|cs|go|rs|java|kt|lua|xml|ini|conf|cfg|toml|sql|sh|bat)\s*$/iu,
  /TODO|FIXME|XXX|HACK/iu,
];
const WILDCARD_RE = /\.\*/u;
const ANCHOR_RE = /\\\.|::|\\b|\\\?\(|\\\?\)/u;
const TOKEN_RE = /[\p{L}_][\p{L}\p{N}_:]*/gu;
const LOCAL_FILE_RE = /\.(?:cpp|cxx|cc|c|h|hpp|hxx|inl|inc|proto|py|pyx|ts|tsx|js|jsx|cs|go|rs|java|kt|lua)$/iu;
const TOKENIZE_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+/gu;

const NON_SYMBOL = new Set([
  "txt", "json", "yaml", "md", "log", "csv", "exe", "dll", "cpp", "hpp", "lua",
  "py", "ts", "src", "test", "tests", "http", "https", "www", "com", "org", "true",
  "false", "null", "none", "if", "else", "for", "while", "return", "break", "continue",
  "switch", "case", "default", "do", "int", "char", "bool", "float", "double", "long",
  "short", "unsigned", "auto", "void", "const", "size", "count", "len", "length", "name",
  "type", "value", "key", "data", "file", "path", "id", "idx", "num",
]);
const KEYWORD_RES = [
  "def", "function", "class", "func", "fn", "method", "inline", "virtual", "override",
  "struct", "enum", "define",
].map((keyword) => new RegExp(`\\b${keyword}\\b`, "u"));
const SEARCH_TOOLS = new Set([
  "rg", "ripgrep", "grep", "findstr", "select-string", "get-childitem", "gci",
]);
const LOCAL_TEXT_DIRS = new Set(["log", "logs"]);
const GENERATED_DIRS = new Set(["build", "dist", "gen", "generated", "out"]);
const COMMON_LUA_GLOBALS = new Set([
  "init", "onenter", "onexit", "oninit", "onload", "onstart", "ontick", "onupdate", "tick", "update",
]);
const SHELL_WRAPPER_OPTIONS = new Map<string, ReadonlySet<string>>([
  ["cmd", new Set(["/c", "/k"])],
  ["powershell", new Set(["-c", "-command"])],
  ["pwsh", new Set(["-c", "-command"])],
]);
const PATTERN_OPTIONS = new Set(["-e", "--regexp", "-pattern"]);
const FILTER_OPTIONS = new Set(["-g", "--glob", "--iglob", "-filter", "-include"]);
const SHORT_VALUE_OPTIONS = new Set(["-A", "-B", "-C", "-E", "-f", "-j", "-m", "-M", "-r", "-t", "-T"]);
const VALUE_OPTIONS = new Set([
  "--after-context", "--before-context", "--context", "--color", "--colors", "--encoding",
  "--engine", "--file", "--max-count", "--max-depth", "--max-filesize", "-context",
  "-encoding", "-literalpath", "-path", "--pre", "--pre-glob", "--sort", "--sortr",
  "--threads", "--type", "--type-not",
]);
const SUPPORTED_TOOLS = new Set(["Grep", "Glob", "Bash"]);

export interface NavigationContributionOptions {
  readonly host: HostId;
  readonly managedRoot: string;
  readonly cacheRoot?: string;
  readonly now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function looksLikeSymbolLookup(pattern: unknown): boolean {
  if (typeof pattern !== "string" || pattern.length === 0) return false;
  const candidate = pattern.trim();
  if (candidate.length < 2) return false;
  if (SILENT_RES.some((expression) => expression.test(candidate))) return false;
  const lowered = candidate.toLowerCase();
  if (KEYWORD_RES.some((expression) => expression.test(lowered))) return true;
  if (WILDCARD_RE.test(candidate) && !ANCHOR_RE.test(candidate)) return false;
  for (const match of candidate.matchAll(TOKEN_RE)) {
    const normalized = match[0].replace(/^:+|:+$/gu, "");
    if (normalized.length < 2 || /^[A-Za-z]$/u.test(normalized)) continue;
    if (NON_SYMBOL.has(normalized.toLowerCase())) continue;
    return true;
  }
  return false;
}

function unquote(rawToken: string): string {
  const token = rawToken.trim().replace(/[;|&]+$/u, "");
  if (token.length >= 2 && (token.startsWith("\"") || token.startsWith("'")) && token.at(-1) === token[0]) {
    return token.slice(1, -1);
  }
  return token;
}

function isSingleFileScope(scopes: readonly string[]): boolean {
  if (scopes.length !== 1) return false;
  const scope = scopes[0];
  return scope !== undefined && !/[*?\[\]]/u.test(scope) && LOCAL_FILE_RE.test(scope);
}

function isExplicitFileSet(scopes: readonly string[]): boolean {
  return scopes.length > 0 && scopes.every((scope) =>
    !/[*?\[\]]/u.test(scope) && LOCAL_FILE_RE.test(scope));
}

function isLocalTextScope(scopes: readonly string[]): boolean {
  if (scopes.length !== 1 || scopes[0] === undefined) return false;
  return scopes[0]
    .replaceAll("\\", "/")
    .toLowerCase()
    .split("/")
    .some((part) => LOCAL_TEXT_DIRS.has(part));
}

function normalizedScopeParts(scope: string): readonly string[] {
  return scope.replaceAll("\\", "/").split("/").filter((part) => part.length > 0 && part !== ".");
}

function isGeneratedScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => normalizedScopeParts(scope).some((part) => GENERATED_DIRS.has(part.toLowerCase())));
}

function isDeepNarrowScope(scopes: readonly string[]): boolean {
  return scopes.length === 1 && scopes[0] !== undefined &&
    !/[*?\[\]]/u.test(scopes[0]) && normalizedScopeParts(scopes[0]).length >= 4;
}

function isLocalOnlyScope(scopes: readonly string[]): boolean {
  return isSingleFileScope(scopes) || isExplicitFileSet(scopes) || isLocalTextScope(scopes) ||
    isGeneratedScope(scopes) || isDeepNarrowScope(scopes);
}

function simpleCommandSegments(command: string): readonly string[] {
  const segments: string[] = [];
  let current = "";
  let quote = "";
  let index = 0;
  while (index < command.length) {
    const character = command[index] ?? "";
    if (quote === "'") {
      current += character;
      if (character === "'") quote = "";
      index += 1;
      continue;
    }
    if (["\\", "^", "`"].includes(character)) {
      current += character;
      index += 1;
      if (index < command.length) {
        current += command[index] ?? "";
        index += 1;
      }
      continue;
    }
    if (character === "'" || character === "\"") {
      current += character;
      if (quote === character) quote = "";
      else if (quote === "") quote = character;
      index += 1;
      continue;
    }
    const next = command[index + 1];
    const isControl = quote === "" && (
      character === "|" || character === ";" || character === "\r" || character === "\n" ||
      (character === "&" && next === "&")
    );
    if (isControl) {
      const segment = current.trim();
      if (segment.length > 0) {
        segments.push(segment);
        if (segments.length > MAX_COMMAND_SEGMENTS) return [];
      }
      current = "";
      if ((character === "\r" && next === "\n") ||
          (character === "|" && (next === "|" || next === "&")) ||
          character === "&") index += 2;
      else index += 1;
      continue;
    }
    current += character;
    index += 1;
  }
  if (quote !== "") return [];
  const finalSegment = current.trim();
  if (finalSegment.length > 0) segments.push(finalSegment);
  return segments.length <= MAX_COMMAND_SEGMENTS ? segments : [];
}

function executableName(token: string): string {
  const parts = token.split(/[\\/]/u);
  return (parts.at(-1) ?? "").replace(/\.exe$/iu, "");
}

function simpleShellLookupPatterns(command: string): readonly string[] {
  const tokens = [...command.matchAll(TOKENIZE_RE)].map((match) => unquote(match[0]));
  const lowered = tokens.map((token) => token.toLowerCase());
  const first = lowered[0];
  if (first !== undefined) {
    const wrapperOptions = SHELL_WRAPPER_OPTIONS.get(executableName(first));
    if (wrapperOptions !== undefined) {
      for (let index = 1; index < lowered.length; index += 1) {
        const option = lowered[index];
        if (option !== undefined && wrapperOptions.has(option) && index + 1 < tokens.length) {
          return shellLookupPatterns(tokens.slice(index + 1).join(" "));
        }
      }
    }
  }

  let start = -1;
  let tool = "";
  for (let index = 0; index < lowered.length; index += 1) {
    const executable = executableName(lowered[index] ?? "");
    if (SEARCH_TOOLS.has(executable)) {
      start = index + 1;
      tool = executable;
      break;
    }
    if (executable === "git" && lowered[index + 1] === "grep") {
      start = index + 2;
      tool = "grep";
      break;
    }
  }
  if (start < 0) return [];

  const explicitPatterns: string[] = [];
  const globPatterns: string[] = [];
  const positional: string[] = [];
  let fixedString = false;
  let index = start;
  let optionsEnabled = true;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    const option = lowered[index] ?? "";
    if (optionsEnabled && option === "--") {
      optionsEnabled = false;
      index += 1;
      continue;
    }
    if (!optionsEnabled) {
      positional.push(token);
      index += 1;
      continue;
    }
    if (
      token === "-F" || ["--fixed-strings", "-simplematch"].includes(option) ||
      (tool === "findstr" && option === "/l")
    ) {
      fixedString = true;
      index += 1;
      continue;
    }
    if (PATTERN_OPTIONS.has(option) && index + 1 < tokens.length) {
      explicitPatterns.push(tokens[index + 1] ?? "");
      index += 2;
      continue;
    }
    if (["rg", "ripgrep", "grep"].includes(tool) && option.startsWith("-e") && token.length > 2) {
      explicitPatterns.push(token.slice(2));
      index += 1;
      continue;
    }
    if (FILTER_OPTIONS.has(option) && index + 1 < tokens.length) {
      globPatterns.push(tokens[index + 1] ?? "");
      index += 2;
      continue;
    }
    if (["rg", "ripgrep"].includes(tool) && option.startsWith("-g") && token.length > 2) {
      globPatterns.push(unquote(token.slice(2)));
      index += 1;
      continue;
    }
    if ((SHORT_VALUE_OPTIONS.has(token) || VALUE_OPTIONS.has(option)) && index + 1 < tokens.length) {
      index += 2;
      continue;
    }
    if (option.startsWith("--glob=") || option.startsWith("--iglob=")) {
      globPatterns.push(token.slice(token.indexOf("=") + 1));
      index += 1;
      continue;
    }
    if (option.startsWith("--regexp=")) {
      explicitPatterns.push(token.slice(token.indexOf("=") + 1));
      index += 1;
      continue;
    }
    if (tool === "findstr" && option.startsWith("/c:") && token.length > 3) {
      explicitPatterns.push(unquote(token.slice(3)));
      index += 1;
      continue;
    }
    if (option.startsWith("-") || (tool === "findstr" && option.startsWith("/"))) {
      index += 1;
      continue;
    }
    positional.push(token);
    index += 1;
  }

  if (fixedString) return [];
  if (explicitPatterns.length > 0) return isLocalOnlyScope(positional) ? [] : explicitPatterns;
  if (tool === "get-childitem" || tool === "gci") return globPatterns.slice(0, 1).length > 0 ? globPatterns.slice(0, 1) : positional.slice(0, 1);
  if (lowered.includes("--files")) return globPatterns;
  if (isLocalOnlyScope(positional.slice(1))) return [];
  return positional.slice(0, 1).length > 0 ? positional.slice(0, 1) : globPatterns.slice(0, 1);
}

export function shellLookupPatterns(command: unknown): readonly string[] {
  if (typeof command !== "string" || command.trim().length === 0 || command.length > MAX_COMMAND_CHARS) return [];
  const segments = simpleCommandSegments(command);
  if (segments.length === 0) return [];
  return segments.flatMap((segment) => simpleShellLookupPatterns(segment));
}

export function lookupPatterns(toolInput: unknown): readonly string[] {
  if (!isRecord(toolInput)) return [];
  if (typeof toolInput.pattern === "string" && toolInput.pattern.length > 0) return [toolInput.pattern];
  const command = Array.isArray(toolInput.command)
    ? toolInput.command.map((part) => String(part)).join(" ")
    : toolInput.command;
  return shellLookupPatterns(command);
}

function directScopes(toolInput: Readonly<Record<string, unknown>>): readonly string[] {
  const scopes: string[] = [];
  for (const field of ["path", "glob"] as const) {
    const value = toolInput[field];
    if (typeof value === "string" && value.length > 0) scopes.push(value);
  }
  for (const field of ["paths", "files"] as const) {
    const value = toolInput[field];
    if (Array.isArray(value) && value.length <= 64 && value.every((item) => typeof item === "string")) {
      scopes.push(...value as string[]);
    }
  }
  return Object.freeze(scopes);
}

function fixedStringInput(toolInput: Readonly<Record<string, unknown>>): boolean {
  return toolInput.fixed_string === true || toolInput.fixedStrings === true ||
    toolInput.literal === true || toolInput.fixed === true;
}

function commonLuaGlobal(pattern: string): boolean {
  const candidate = pattern.trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(candidate) && COMMON_LUA_GLOBALS.has(candidate.toLowerCase());
}

/** Decide structural intent before any reminder claim or cache write. */
export function structuralLookupIntent(data: unknown): boolean {
  if (!isRecord(data) || typeof data.tool_name !== "string" || !SUPPORTED_TOOLS.has(data.tool_name)) return false;
  if (!isRecord(data.tool_input) || fixedStringInput(data.tool_input)) return false;
  const scopes = directScopes(data.tool_input);
  if (isLocalOnlyScope(scopes)) return false;
  const patterns = lookupPatterns(data.tool_input);
  if (patterns.length === 0) return false;
  if (patterns.every(commonLuaGlobal)) return false;
  return patterns.some((pattern) => looksLikeSymbolLookup(pattern));
}

export function hookOutput(
  data: unknown,
  updateNotice?: string,
  options?: NavigationContributionOptions,
): Record<string, unknown> | undefined {
  const context = navigationContribution(data, updateNotice, options);
  if (context === undefined) return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: context,
    },
  };
}

export function navigationContribution(
  data: unknown,
  updateNotice?: string,
  options?: NavigationContributionOptions,
): string | undefined {
  const structuralIntent = structuralLookupIntent(data);
  let structural = structuralIntent;
  if (structural && options !== undefined) {
    const contextEpoch = contextEpochForSession(data, {
      host: options.host,
      managedRoot: options.managedRoot,
      capability: "kcoderag-navigation",
      source: "resume",
      ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
    });
    structural = contextEpoch !== undefined && claimReminder(data, {
      host: options.host,
      managedRoot: options.managedRoot,
      capability: "kcoderag-navigation",
      reminderKind: "navigation",
      contextEpoch,
      ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
      ...(options.now === undefined ? {} : { now: options.now }),
    }).claimed;
  }
  if (!structural && !updateNotice) return undefined;
  const indexed = structural && options !== undefined && indexAvailableForSession(data, options);
  const contexts = [structural ? (indexed ? INDEXED_NUDGE : NUDGE) : undefined, updateNotice].filter(
    (context): context is string => typeof context === "string" && context.length > 0,
  );
  return contexts.join("\n\n").slice(0, 600);
}

function readBoundedStdin(): string {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= MAX_INPUT_CHARS) {
    const buffer = Buffer.allocUnsafe(Math.min(8_192, MAX_INPUT_CHARS + 1 - total));
    const count = fs.readSync(0, buffer, 0, buffer.length, null);
    if (count === 0) break;
    chunks.push(buffer.subarray(0, count));
    total += count;
  }
  return total > MAX_INPUT_CHARS ? "" : Buffer.concat(chunks, total).toString("utf8");
}

export interface HookUpdateRuntime {
  readonly installedVersion?: string;
  readonly installedHost?: "codex" | "claude" | "cursor" | "opencode";
  readonly readUpdateHint?: (
    installedVersion: string | undefined,
    options?: {
      readonly hookPayload?: unknown;
      readonly host?: "codex" | "claude" | "cursor" | "opencode";
    },
  ) => string | undefined;
  readonly scheduleRefresh?: (hookPayload: unknown) => boolean;
}

export function main(
  rawInput?: string,
  writeOutput: (text: string) => void = (text) => { process.stdout.write(text); },
  updateRuntime: HookUpdateRuntime = {},
): number {
  try {
    const raw = rawInput ?? readBoundedStdin();
    if (raw.length === 0 || raw.length > MAX_INPUT_CHARS) return 0;
    const payload = JSON.parse(raw) as unknown;
    const relevantForUpdate = isRecord(payload) && typeof payload.tool_name === "string" &&
      SUPPORTED_TOOLS.has(payload.tool_name) && isRecord(payload.tool_input);
    const installedVersion = relevantForUpdate
      ? updateRuntime.installedVersion ?? updateCheck.readInstalledVersion()
      : undefined;
    const installedHost = relevantForUpdate
      ? updateRuntime.installedHost ?? updateCheck.readInstalledHost()
      : undefined;
    const updateNotice = relevantForUpdate
      ? (updateRuntime.readUpdateHint ?? updateCheck.readUpdateHint)(installedVersion, {
        hookPayload: payload,
        ...(installedHost === undefined ? {} : { host: installedHost }),
      })
      : undefined;
    const output = hookOutput(payload, updateNotice);
    if (output !== undefined) writeOutput(JSON.stringify(output));
    if (installedVersion !== undefined) {
      (updateRuntime.scheduleRefresh ?? updateCheck.scheduleRefresh)(payload);
    }
  } catch {
    return 0;
  }
  return 0;
}

if (require.main === module) process.exitCode = main();
