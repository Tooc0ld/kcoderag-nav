/** Secret-safe selected-host source findings. This module never authorizes mutation. */

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

import {
  InstallError,
  sanitizeSafeRelativePath,
  type SourceFinding,
  type SourceScope,
  type SourceSeverity,
  type SourceType,
} from "../core/contracts.cjs";
import { parseJsoncObject } from "../core/json-splice.cjs";

export type { SourceFinding } from "../core/contracts.cjs";

export const SOURCE_SCAN_MODES = Object.freeze(["fast", "deep", "gate"] as const);
export type SourceScanMode = (typeof SOURCE_SCAN_MODES)[number];

const SOURCE_CODES = new Set([
  "active_plugin_source",
  "owned_plugin_source",
  "owned_marketplace_source",
  "raw_mcp_source",
  "manual_hook_source",
  "manual_rule_source",
  "manual_skill_source",
  "cache_residue",
  "disabled_source",
  "ambiguous_source",
  "source_scan_unavailable",
  "manual_cleanup_required",
]);
const SOURCE_TYPES = new Set<SourceType>([
  "active_plugin",
  "owned_plugin",
  "owned_marketplace_registration",
  "raw_mcp",
  "manual_hook",
  "manual_rule",
  "cache_residue",
  "disabled_registration",
  "ambiguous",
]);
const INFORMATIONAL_TYPES = new Set<SourceType>(["cache_residue", "disabled_registration"]);

export interface SourceScanResult {
  readonly mode: SourceScanMode;
  readonly findings: readonly SourceFinding[];
  readonly hasConflict: boolean;
}

/** Read-only host probes may execute bounded native inventory commands. */
export interface NativeRunRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface NativeJsonSourceInspection {
  readonly exists: boolean;
  readonly rawMcp: boolean;
  readonly manualHook: boolean;
  readonly activePlugin: boolean;
  readonly ambiguous: boolean;
}

export interface NativeDirectoryInspection {
  readonly matches: readonly string[];
  readonly ambiguous: boolean;
}

export const MAX_NATIVE_SOURCE_BYTES = 262_144;
const MAX_NATIVE_SOURCE_NODES = 4_096;
const MAX_NATIVE_DIRECTORY_ENTRIES = 256;
const MCP_CONTAINER_KEYS = new Set(["mcp", "mcpservers", "mcp_servers"]);
const HOOK_CONTAINER_KEYS = new Set([
  "hooks",
  "hook",
  "pretooluse",
  "posttooluse",
  "aftermcpexecution",
  "toolexecuteafter",
]);
const PLUGIN_CONTAINER_KEYS = new Set([
  "plugin",
  "plugins",
  "enabledplugins",
  "installedplugins",
  "installed_plugins",
]);

type BoundedRead =
  | { readonly status: "absent" }
  | { readonly status: "ambiguous" }
  | { readonly status: "ok"; readonly text: string };

function nativePath(homeDirectory: string, relativePath: string): { readonly absolutePath: string; readonly safePath: string } {
  const safe = sanitizeSafeRelativePath(relativePath);
  if (safe === undefined || safe === ".") throw new InstallError("invalid_source_scan");
  const root = path.resolve(homeDirectory);
  const absolutePath = path.resolve(root, ...safe.split("/"));
  const relation = path.relative(root, absolutePath);
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new InstallError("invalid_source_scan");
  }
  return Object.freeze({ absolutePath, safePath: safe });
}

function readBoundedNativeFile(homeDirectory: string, relativePath: string): BoundedRead {
  const target = nativePath(homeDirectory, relativePath);
  let descriptor: number | undefined;
  try {
    const metadata = fs.lstatSync(target.absolutePath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_NATIVE_SOURCE_BYTES) {
      return Object.freeze({ status: "ambiguous" as const });
    }
    const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    descriptor = fs.openSync(target.absolutePath, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size > MAX_NATIVE_SOURCE_BYTES) {
      return Object.freeze({ status: "ambiguous" as const });
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== bytes.length) return Object.freeze({ status: "ambiguous" as const });
    return Object.freeze({ status: "ok" as const, text: bytes.toString("utf8") });
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? Object.freeze({ status: "absent" as const })
      : Object.freeze({ status: "ambiguous" as const });
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* read-only probe stays fail closed */ }
    }
  }
}

function isRegistrationIdentity(value: string): boolean {
  return /(?:^|[^a-z0-9])(?:kcoderag|kcode-rag)(?:-nav|-qa)?(?:$|[^a-z0-9])/iu.test(value) ||
    /(?:grep_nudge|update_check|manage_project_install|manage_cursor_local_install|update_plugin)\.py(?:$|[^a-z0-9])/iu.test(value);
}

const PLUGIN_IDENTITY_FIELDS = new Set(["id", "name", "path", "plugin", "package", "source"]);
const HOOK_IDENTITY_FIELDS = new Set(["args", "command", "executable", "module", "path", "script"]);
const SECRET_VALUE_FIELDS = /(?:authorization|bearer|body|content|credential|header|secret|token|url)/iu;

function containsPluginIdentity(value: unknown, budget: { count: number }, depth = 0): boolean {
  if (depth > 32 || budget.count >= MAX_NATIVE_SOURCE_NODES) throw new InstallError("invalid_source_scan");
  budget.count += 1;
  if (typeof value === "string") return isRegistrationIdentity(value);
  if (Array.isArray(value)) {
    return value.some((entry) => containsPluginIdentity(entry, budget, depth + 1));
  }
  if (typeof value !== "object" || value === null) return false;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isRegistrationIdentity(key)) return true;
    if (PLUGIN_IDENTITY_FIELDS.has(key.toLowerCase()) && containsPluginIdentity(entry, budget, depth + 1)) return true;
  }
  return false;
}

function containsHookIdentity(value: unknown, budget: { count: number }, depth = 0): boolean {
  if (depth > 32 || budget.count >= MAX_NATIVE_SOURCE_NODES) throw new InstallError("invalid_source_scan");
  budget.count += 1;
  if (Array.isArray(value)) return value.some((entry) => containsHookIdentity(entry, budget, depth + 1));
  if (typeof value !== "object" || value === null) return false;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (isRegistrationIdentity(key)) return true;
    if (SECRET_VALUE_FIELDS.test(normalized)) continue;
    if (HOOK_IDENTITY_FIELDS.has(normalized) && typeof entry === "string" && isRegistrationIdentity(entry)) return true;
    if ((Array.isArray(entry) || (typeof entry === "object" && entry !== null)) &&
      containsHookIdentity(entry, budget, depth + 1)) return true;
  }
  return false;
}

export function inspectNativeJsonSource(
  homeDirectory: string,
  relativePath: string,
  options: { readonly wholeDocumentIsPluginInventory?: boolean } = {},
): NativeJsonSourceInspection {
  const bounded = readBoundedNativeFile(homeDirectory, relativePath);
  if (bounded.status === "absent") {
    return Object.freeze({ exists: false, rawMcp: false, manualHook: false, activePlugin: false, ambiguous: false });
  }
  if (bounded.status === "ambiguous") {
    return Object.freeze({ exists: true, rawMcp: false, manualHook: false, activePlugin: false, ambiguous: true });
  }
  try {
    const document = parseJsoncObject(bounded.text);
    let count = 0;
    let rawMcp = false;
    let manualHook = false;
    let activePlugin = options.wholeDocumentIsPluginInventory === true &&
      containsPluginIdentity(document, { count: 0 });
    const visit = (value: unknown, depth = 0): void => {
      if (depth > 32 || count >= MAX_NATIVE_SOURCE_NODES) throw new InstallError("invalid_source_scan");
      count += 1;
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry, depth + 1);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const normalized = key.toLowerCase();
        if (MCP_CONTAINER_KEYS.has(normalized) && typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
          const mcpContainer = entry as Record<string, unknown>;
          rawMcp ||= Object.keys(mcpContainer).some(isRegistrationIdentity);
          const nestedServers = normalized === "mcp" ? mcpContainer.servers : undefined;
          if (typeof nestedServers === "object" && nestedServers !== null && !Array.isArray(nestedServers)) {
            rawMcp ||= Object.keys(nestedServers as Record<string, unknown>).some(isRegistrationIdentity);
          }
        }
        if (HOOK_CONTAINER_KEYS.has(normalized)) {
          manualHook ||= containsHookIdentity(entry, { count: 0 });
        }
        if (PLUGIN_CONTAINER_KEYS.has(normalized)) {
          activePlugin ||= containsPluginIdentity(entry, { count: 0 });
        }
        visit(entry, depth + 1);
      }
    };
    visit(document);
    return Object.freeze({ exists: true, rawMcp, manualHook, activePlugin, ambiguous: false });
  } catch {
    return Object.freeze({ exists: true, rawMcp: false, manualHook: false, activePlugin: false, ambiguous: true });
  }
}

export function inspectNativeTomlMcpSource(
  homeDirectory: string,
  relativePath: string,
): Readonly<{ exists: boolean; rawMcp: boolean; ambiguous: boolean }> {
  const bounded = readBoundedNativeFile(homeDirectory, relativePath);
  if (bounded.status === "absent") return Object.freeze({ exists: false, rawMcp: false, ambiguous: false });
  if (bounded.status === "ambiguous") return Object.freeze({ exists: true, rawMcp: false, ambiguous: true });
  const rawMcp = bounded.text.split(/\r?\n/u).some((line) => {
    const match = /^\s*\[\s*mcp_servers(?:\.([A-Za-z0-9_.-]+)|\."([^"]{1,128})")\s*\]\s*(?:#.*)?$/u.exec(line);
    return match !== null && isRegistrationIdentity(match[1] ?? match[2] ?? "");
  });
  return Object.freeze({ exists: true, rawMcp, ambiguous: false });
}

export function inspectNativePath(
  homeDirectory: string,
  relativePath: string,
): "absent" | "present" | "ambiguous" {
  const target = nativePath(homeDirectory, relativePath);
  try {
    const metadata = fs.lstatSync(target.absolutePath);
    return metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())
      ? "ambiguous"
      : "present";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "ambiguous";
  }
}

export function inspectNativeDirectory(
  homeDirectory: string,
  relativePath: string,
): NativeDirectoryInspection {
  const target = nativePath(homeDirectory, relativePath);
  try {
    const metadata = fs.lstatSync(target.absolutePath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      return Object.freeze({ matches: Object.freeze([]), ambiguous: true });
    }
    const entries = fs.readdirSync(target.absolutePath, { withFileTypes: true });
    if (entries.length > MAX_NATIVE_DIRECTORY_ENTRIES) {
      return Object.freeze({ matches: Object.freeze([]), ambiguous: true });
    }
    const matches = entries
      .filter((entry) => isRegistrationIdentity(entry.name))
      .map((entry) => `${target.safePath}/${entry.name}`)
      .sort(compareCodeUnits);
    return Object.freeze({ matches: Object.freeze(matches), ambiguous: false });
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? Object.freeze({ matches: Object.freeze([]), ambiguous: false })
      : Object.freeze({ matches: Object.freeze([]), ambiguous: true });
  }
}

type SourceFindingInput = {
  readonly code: string;
  readonly severity: SourceSeverity;
  readonly sourceType: SourceType;
  readonly scope: SourceScope;
  readonly safePath: string;
};

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSecretLike(value: string): boolean {
  return /[\r\n\0]|:\/\/|authorization|bearer|subprocess|[{}]/i.test(value);
}

function safePath(input: string): string {
  if (typeof input !== "string" || isSecretLike(input)) {
    throw new InstallError("invalid_source_finding");
  }
  const normalized = sanitizeSafeRelativePath(input);
  if (normalized === undefined || (normalized === "." && input !== ".")) {
    throw new InstallError("invalid_source_finding");
  }
  return normalized;
}

export function createSourceFinding(input: SourceFindingInput): SourceFinding {
  if (
    !SOURCE_CODES.has(input.code) ||
    (input.severity !== "info" && input.severity !== "conflict") ||
    !SOURCE_TYPES.has(input.sourceType) ||
    (input.scope !== "project" && input.scope !== "user") ||
    INFORMATIONAL_TYPES.has(input.sourceType) !== (input.severity === "info")
  ) {
    throw new InstallError("invalid_source_finding");
  }
  return Object.freeze({
    code: input.code,
    severity: input.severity,
    sourceType: input.sourceType,
    scope: input.scope,
    safePath: safePath(input.safePath),
  });
}

export function createSourceScanResult(
  mode: SourceScanMode,
  findings: readonly SourceFinding[],
): SourceScanResult {
  if (!SOURCE_SCAN_MODES.includes(mode)) throw new InstallError("invalid_source_scan");
  const sortedFindings = [...findings].sort((left, right) =>
    compareCodeUnits(left.safePath, right.safePath) ||
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(left.sourceType, right.sourceType));
  return Object.freeze({
    mode,
    findings: Object.freeze(sortedFindings),
    hasConflict: sortedFindings.some((finding) => finding.severity === "conflict"),
  }) as SourceScanResult;
}
