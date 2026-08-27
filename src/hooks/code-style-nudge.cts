#!/usr/bin/env node
/** Bounded structured-write classifier for the nav-managed code-style Skill reminder. */

import type { HostId } from "../core/contracts.cjs";
import { claimNudgeOnce } from "./once-marker.cjs";

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

export const CODE_STYLE_NUDGE =
  "Code-style source change: before writing, load and follow $code-style-correction and its compact checklist. " +
  "Explicit user and project instructions take precedence. Before finishing, review only the regions changed in this task.";

export const CODE_STYLE_SOURCE_EXTENSIONS = Object.freeze([
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
const CODE_STYLE_EXTENSION_SET = new Set<string>(CODE_STYLE_SOURCE_EXTENSIONS);
const MAX_PATCH_CHARS = 131_072;
const MAX_PATCH_LINES = 8_192;
const MAX_PATCH_FILES = 64;
const MAX_TARGET_PATH_CHARS = 4_096;

export interface CodeStyleContributionOptions {
  readonly host: HostId;
  readonly managedRoot: string;
  readonly cacheRoot?: string;
  readonly statePath?: string;
}

export interface CodeStyleIntegrityOptions {
  readonly host: HostId;
  readonly managedRoot: string;
  readonly statePath?: string;
}

export interface CodeStyleIntegrityResult {
  readonly ok: boolean;
  readonly finding?: {
    readonly code: "capability_drift";
    readonly path: string;
  };
}

const REQUIRED_REFERENCE_NAMES = Object.freeze([
  "cpp-lifetime-control-flow.md",
  "protocol-serialization-data.md",
  "lua-contracts.md",
  "change-hygiene-self-review.md",
]);
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_MANAGED_ASSET_BYTES = 1024 * 1024;
const DIGEST_RE = /^[0-9a-f]{64}$/u;

interface PatchRecord {
  readonly kind: "add" | "delete" | "update";
  readonly path: string;
  movePath?: string;
  hasContentHunk: boolean;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    return false;
  }
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function stateRelativePath(host: HostId): string {
  const hostRoot = host === "codex" ? ".codex" : host === "claude" ? ".claude" :
    host === "cursor" ? ".cursor" : ".opencode";
  return `${hostRoot}/kcoderag-nav/install-state.json`;
}

function containedRegularFile(root: string, relativePath: string): string | undefined {
  if (!safeRelativePath(relativePath)) return undefined;
  let current = root;
  const parts = relativePath.split("/");
  try {
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const metadata = fs.lstatSync(current);
      if (metadata.isSymbolicLink()) return undefined;
      const last = index === parts.length - 1;
      if ((last && !metadata.isFile()) || (!last && !metadata.isDirectory())) return undefined;
    }
    const relation = path.relative(root, current);
    if (relation.length === 0 || relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
      return undefined;
    }
    return current;
  } catch {
    return undefined;
  }
}

function drift(relativePath = "."): CodeStyleIntegrityResult {
  return Object.freeze({
    ok: false,
    finding: Object.freeze({ code: "capability_drift" as const, path: relativePath }),
  });
}

function exactCompositeDigest(state: Readonly<Record<string, unknown>>): boolean {
  if (typeof state.compositeDigest !== "string" || !DIGEST_RE.test(state.compositeDigest)) return false;
  const bytes = Buffer.from(JSON.stringify({
    schemaVersion: state.schemaVersion,
    packageVersion: state.packageVersion,
    host: state.host,
    capabilities: state.capabilities,
    files: state.files,
    sections: state.sections,
  }), "utf8");
  return crypto.createHash("sha256").update(bytes).digest("hex") === state.compositeDigest;
}

function singlePathEnding(paths: readonly string[], suffix: string): string | undefined {
  const matches = paths.filter((candidate) => candidate.endsWith(suffix));
  return matches.length === 1 ? matches[0] : undefined;
}

function unexpectedSkillPath(root: string, skillPath: string): string | undefined {
  const skillRoot = path.dirname(path.join(root, ...skillPath.split("/")));
  const referencesRoot = path.join(skillRoot, "references");
  try {
    const skillEntries = fs.readdirSync(skillRoot, { withFileTypes: true });
    const expectedSkillEntries = new Set(["SKILL.md", "references"]);
    for (const entry of skillEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (
        !expectedSkillEntries.has(entry.name) ||
        entry.isSymbolicLink() ||
        (entry.name === "SKILL.md" && !entry.isFile()) ||
        (entry.name === "references" && !entry.isDirectory())
      ) {
        return path.relative(root, path.join(skillRoot, entry.name)).split(path.sep).join("/");
      }
    }
    if (skillEntries.length !== expectedSkillEntries.size) return skillPath;

    const referenceEntries = fs.readdirSync(referencesRoot, { withFileTypes: true });
    const expectedReferences = new Set<string>(REQUIRED_REFERENCE_NAMES);
    for (const entry of referenceEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!expectedReferences.has(entry.name) || entry.isSymbolicLink() || !entry.isFile()) {
        return path.relative(root, path.join(referencesRoot, entry.name)).split(path.sep).join("/");
      }
    }
    if (referenceEntries.length !== expectedReferences.size) return skillPath;
    return undefined;
  } catch {
    return skillPath;
  }
}

export function evaluateCodeStyleIntegrity(options: CodeStyleIntegrityOptions): CodeStyleIntegrityResult {
  try {
    if (!path.isAbsolute(options.managedRoot)) return drift();
    const root = path.resolve(options.managedRoot);
    const rootMetadata = fs.lstatSync(root);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) return drift();
    const expectedStateRelativePath = stateRelativePath(options.host);
    const statePath = options.statePath === undefined
      ? containedRegularFile(root, expectedStateRelativePath)
      : (() => {
          const resolved = path.resolve(options.statePath);
          const relative = path.relative(root, resolved).split(path.sep).join("/");
          return containedRegularFile(root, relative);
        })();
    if (statePath === undefined) return drift(expectedStateRelativePath);
    const stateBytes = fs.readFileSync(statePath);
    if (stateBytes.length === 0 || stateBytes.length > MAX_STATE_BYTES) return drift(expectedStateRelativePath);
    const state: unknown = JSON.parse(stateBytes.toString("utf8"));
    if (
      !isRecord(state) ||
      state.schemaVersion !== 1 ||
      state.host !== options.host ||
      typeof state.packageVersion !== "string" ||
      !Array.isArray(state.capabilities) ||
      !Array.isArray(state.files) ||
      !Array.isArray(state.sections) ||
      !exactCompositeDigest(state)
    ) {
      return drift(expectedStateRelativePath);
    }
    const capabilities = state.capabilities.filter(isRecord);
    const codeStyleCapabilities = capabilities.filter((capability) => capability.id === "code-style-nudge");
    if (codeStyleCapabilities.length !== 1) return drift(expectedStateRelativePath);
    const capability = codeStyleCapabilities[0];
    if (capability === undefined || !Array.isArray(capability.files) || !capability.files.every(safeRelativePath)) {
      return drift(expectedStateRelativePath);
    }
    const capabilityPaths = capability.files as string[];
    const skillPath = singlePathEnding(capabilityPaths, "/SKILL.md");
    const handlerPath = singlePathEnding(capabilityPaths, "/code-style-nudge.cjs");
    const dispatcherPath = singlePathEnding(capabilityPaths, "/pre-tool-dispatcher.cjs");
    const referencePaths = REQUIRED_REFERENCE_NAMES.map((name) =>
      singlePathEnding(capabilityPaths, `/references/${name}`));
    if (
      skillPath === undefined ||
      handlerPath === undefined ||
      dispatcherPath === undefined ||
      referencePaths.some((value) => value === undefined)
    ) {
      return drift(expectedStateRelativePath);
    }
    const requiredPaths = [skillPath, ...referencePaths, handlerPath, dispatcherPath] as string[];
    const managedRecords = new Map<string, Readonly<{
      digest: string;
      contributors: readonly string[];
    }>>();
    for (const record of state.files) {
      const contributors = isRecord(record) ? record.contributors : undefined;
      if (
        !isRecord(record) ||
        !safeRelativePath(record.path) ||
        typeof record.digest !== "string" ||
        !DIGEST_RE.test(record.digest) ||
        !Array.isArray(contributors) ||
        contributors.length === 0 ||
        !contributors.every((contributor): contributor is string => typeof contributor === "string") ||
        managedRecords.has(record.path)
      ) {
        return drift(expectedStateRelativePath);
      }
      managedRecords.set(record.path, Object.freeze({
        digest: record.digest,
        contributors: Object.freeze([...contributors]),
      }));
    }
    if (new Set(capabilityPaths).size !== capabilityPaths.length) return drift(expectedStateRelativePath);
    for (const relativePath of capabilityPaths) {
      const record = managedRecords.get(relativePath);
      if (record === undefined || !record.contributors.includes("code-style-nudge")) {
        return drift(relativePath);
      }
    }
    for (const relativePath of requiredPaths) {
      if (!managedRecords.has(relativePath)) return drift(relativePath);
    }
    for (const [relativePath, record] of managedRecords) {
      const filePath = containedRegularFile(root, relativePath);
      if (filePath === undefined) return drift(relativePath);
      const metadata = fs.lstatSync(filePath);
      if (metadata.size > MAX_MANAGED_ASSET_BYTES) return drift(relativePath);
      const bytes = fs.readFileSync(filePath);
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== record.digest) {
        return drift(relativePath);
      }
    }
    const extraPath = unexpectedSkillPath(root, skillPath);
    if (extraPath !== undefined) return drift(extraPath);
    return Object.freeze({ ok: true });
  } catch {
    return drift();
  }
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

export function isCodeStyleSourcePath(value: unknown): boolean {
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
  return CODE_STYLE_EXTENSION_SET.has(finalSegment.slice(dotIndex).toLowerCase());
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
  try {
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
  } catch {
    return Object.freeze([]);
  }
}

export function codeStyleContribution(
  payload: unknown,
  options?: CodeStyleContributionOptions,
): string | undefined {
  try {
    if (options === undefined || !structuredMutationPaths(payload).some(isCodeStyleSourcePath)) {
      return undefined;
    }
    if (!evaluateCodeStyleIntegrity(options).ok) return undefined;
    const claim = claimNudgeOnce(payload, {
      host: options.host,
      managedRoot: options.managedRoot,
      capability: "code-style-nudge",
      ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
    });
    return claim.claimed ? CODE_STYLE_NUDGE : undefined;
  } catch {
    return undefined;
  }
}
