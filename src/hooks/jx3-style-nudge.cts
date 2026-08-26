#!/usr/bin/env node
/** Bounded structured-write classifier for the nav-managed JX3 Skill reminder. */

import type { HostId } from "../core/contracts.cjs";
import { claimNudgeOnce } from "./once-marker.cjs";

export const JX3_NUDGE =
  "JX3 source change: before writing, load and follow $jx3-code-style-correction and its compact checklist. " +
  "Explicit user and project instructions take precedence. Before finishing, review only the regions changed in this task.";

export const JX3_SOURCE_EXTENSIONS = Object.freeze([
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hh",
  ".hpp",
  ".hxx",
  ".inl",
  ".ipp",
  ".lua",
] as const);

const STRUCTURED_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const JX3_EXTENSION_SET = new Set<string>(JX3_SOURCE_EXTENSIONS);
const MAX_PATCH_CHARS = 131_072;
const MAX_PATCH_LINES = 8_192;
const MAX_PATCH_FILES = 64;
const MAX_TARGET_PATH_CHARS = 4_096;

export interface Jx3ContributionOptions {
  readonly host: HostId;
  readonly managedRoot: string;
  readonly cacheRoot?: string;
}

interface PatchRecord {
  readonly kind: "add" | "delete" | "update";
  readonly path: string;
  movePath?: string;
  hasContentHunk: boolean;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedTargetPath(value: string): string | undefined {
  if (
    value.length === 0 ||
    value.length > MAX_TARGET_PATH_CHARS ||
    value !== value.trim() ||
    value.includes("\0")
  ) {
    return undefined;
  }
  return value;
}

export function isJx3SourcePath(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TARGET_PATH_CHARS) {
    return false;
  }
  const normalized = value.replaceAll("\\", "/");
  const finalSegment = normalized.split("/").at(-1);
  if (finalSegment === undefined || finalSegment.length === 0 || finalSegment.startsWith(".")) {
    return false;
  }
  const dotIndex = finalSegment.lastIndexOf(".");
  if (dotIndex <= 0) return false;
  return JX3_EXTENSION_SET.has(finalSegment.slice(dotIndex).toLowerCase());
}

function parseHeaderPath(line: string, prefix: string): string | undefined {
  if (!line.startsWith(prefix)) return undefined;
  return boundedTargetPath(line.slice(prefix.length));
}

function mutationPath(record: PatchRecord): string | undefined {
  if (record.kind === "add") return record.path;
  if (record.kind === "delete" || !record.hasContentHunk) return undefined;
  return record.movePath ?? record.path;
}

function nativePatchMutationPaths(command: unknown): readonly string[] {
  if (typeof command !== "string" || command.length === 0 || command.length > MAX_PATCH_CHARS) {
    return Object.freeze([]);
  }
  const lines = command.replaceAll("\r\n", "\n").split("\n");
  if (
    lines.length > MAX_PATCH_LINES ||
    lines[0] !== "*** Begin Patch" ||
    lines.at(-1) !== "*** End Patch"
  ) {
    return Object.freeze([]);
  }

  const mutations: string[] = [];
  let current: PatchRecord | undefined;
  let fileCount = 0;
  const finishCurrent = (): void => {
    if (current === undefined) return;
    const path = mutationPath(current);
    if (path !== undefined && !mutations.includes(path)) mutations.push(path);
    current = undefined;
  };

  for (let index = 1; index < lines.length - 1; index += 1) {
    const line = lines[index] ?? "";
    const addPath = parseHeaderPath(line, "*** Add File: ");
    const updatePath = parseHeaderPath(line, "*** Update File: ");
    const deletePath = parseHeaderPath(line, "*** Delete File: ");
    if (addPath !== undefined || updatePath !== undefined || deletePath !== undefined) {
      finishCurrent();
      fileCount += 1;
      if (fileCount > MAX_PATCH_FILES) return Object.freeze([]);
      if (addPath !== undefined) current = { kind: "add", path: addPath, hasContentHunk: true };
      else if (updatePath !== undefined) current = { kind: "update", path: updatePath, hasContentHunk: false };
      else if (deletePath !== undefined) current = { kind: "delete", path: deletePath, hasContentHunk: false };
      continue;
    }

    if (line.startsWith("*** Move to: ")) {
      const movePath = parseHeaderPath(line, "*** Move to: ");
      if (current?.kind !== "update" || movePath === undefined || current.movePath !== undefined) {
        return Object.freeze([]);
      }
      current.movePath = movePath;
      continue;
    }
    if (/^@@(?: |$)/u.test(line)) {
      if (current?.kind !== "update") return Object.freeze([]);
      current.hasContentHunk = true;
      continue;
    }
    if (line === "*** End of File") continue;
    if (line.startsWith("*** ")) return Object.freeze([]);
  }
  finishCurrent();
  return Object.freeze(mutations);
}

export function structuredMutationPaths(payload: unknown): readonly string[] {
  if (!isRecord(payload) || typeof payload.tool_name !== "string" || !isRecord(payload.tool_input)) {
    return Object.freeze([]);
  }
  if (STRUCTURED_WRITE_TOOLS.has(payload.tool_name)) {
    const path = payload.tool_input.file_path;
    return typeof path === "string" && boundedTargetPath(path) !== undefined
      ? Object.freeze([path])
      : Object.freeze([]);
  }
  if (payload.tool_name === "apply_patch") {
    return nativePatchMutationPaths(payload.tool_input.command);
  }
  return Object.freeze([]);
}

export function jx3StyleContribution(
  payload: unknown,
  options?: Jx3ContributionOptions,
): string | undefined {
  if (options === undefined || !structuredMutationPaths(payload).some(isJx3SourcePath)) {
    return undefined;
  }
  const claim = claimNudgeOnce(payload, {
    host: options.host,
    managedRoot: options.managedRoot,
    capability: "jx3-style-nudge",
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
  });
  return claim.claimed ? JX3_NUDGE : undefined;
}
