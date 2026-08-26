/** Claude Code current-state observation and metadata-only source boundary. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

import {
  InstallError,
  type InstallState,
  type ProjectTarget,
  type StatusIssue,
} from "../core/contracts.cjs";
import { hasManagedRootResidue, validateManagedPath } from "../core/project-target.cjs";
import { createStatusResult, parseInstallState } from "../core/state.cjs";
import type { HostAdapter, HostObservation, HostSourceScanContext, HostStatusContext } from "./host-adapter.cjs";
import { createSourceFinding, createSourceScanResult, type SourceScanResult } from "./user-sources.cjs";

export interface ClaudeUserSourceMetadata {
  readonly ownedPluginPaths?: readonly string[];
  readonly ownedMarketplacePaths?: readonly string[];
  readonly rawMcpPaths?: readonly string[];
  readonly manualHookPaths?: readonly string[];
  readonly cachePaths?: readonly string[];
  readonly disabledPaths?: readonly string[];
  readonly ambiguousPaths?: readonly string[];
}

export interface ClaudeAdapterOptions {
  readonly homeDirectory?: string;
  readonly readUserSources?: () => ClaudeUserSourceMetadata | Promise<ClaudeUserSourceMetadata>;
  readonly [key: string]: unknown;
}

const STATE_PATH = ".claude/kcoderag-nav/install-state.json";
const MANAGED_ROOTS = Object.freeze([".claude", ".mcp.json"] as const);

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function issueFrom(error: unknown): StatusIssue {
  return error instanceof InstallError
    ? { code: error.code, path: error.safePath ?? "." }
    : { code: "invalid", path: "." };
}

function readRegular(target: ProjectTarget, relativePath: string): Buffer | undefined {
  const validated = validateManagedPath(target, relativePath, MANAGED_ROOTS);
  try {
    const metadata = fs.lstatSync(validated.absolutePath);
    if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape", relativePath);
    if (!metadata.isFile()) throw new InstallError("special_file", relativePath);
    return fs.readFileSync(validated.absolutePath);
  } catch (error) {
    if (error instanceof InstallError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new InstallError("unreadable", relativePath);
  }
}

function verifyStateFiles(target: ProjectTarget, state: InstallState): void {
  if (state.host !== "claude") throw new InstallError("invalid_state", STATE_PATH);
  for (const record of state.files) {
    const current = readRegular(target, record.path);
    if (current === undefined || sha256(current) !== record.digest) {
      throw new InstallError("managed_content_changed", record.path);
    }
  }
}

function detectClaude(context: { readonly target: ProjectTarget }): HostObservation {
  let stateBytes: Buffer | undefined;
  try {
    stateBytes = readRegular(context.target, STATE_PATH);
    if (stateBytes === undefined) return Object.freeze({ host: "claude" as const, target: context.target });
    const currentState = parseInstallState(stateBytes);
    verifyStateFiles(context.target, currentState);
    return Object.freeze({
      host: "claude" as const,
      target: context.target,
      currentState,
      details: Object.freeze({ stateBytes: Buffer.from(stateBytes) }),
    });
  } catch (error) {
    return Object.freeze({
      host: "claude" as const,
      target: context.target,
      issues: Object.freeze([issueFrom(error)]),
      details: Object.freeze(stateBytes === undefined ? {} : { stateBytes: Buffer.from(stateBytes) }),
    });
  }
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
  if (context.observation.currentState !== undefined) return createStatusResult({ status: "healthy", host: "claude" });
  const root = validateManagedPath(context.target, STATE_PATH, MANAGED_ROOTS);
  if (hasManagedRootResidue(path.dirname(root.absolutePath))) {
    return createStatusResult({
      status: "invalid",
      host: "claude",
      issues: [{ code: "orphaned_managed_root", path: ".claude/kcoderag-nav" }],
    });
  }
  return createStatusResult({ host: "claude" });
}

function defaultMetadata(homeDirectory: string): ClaudeUserSourceMetadata {
  const ambiguousPaths: string[] = [];
  for (const relativePath of [
    ".claude/plugins/kcoderag-nav",
    ".claude/plugins/cache/kcoderag-nav",
    ".claude/skills/kcoderag-nav/SKILL.md",
  ]) {
    try {
      fs.lstatSync(path.join(homeDirectory, ...relativePath.split("/")));
      ambiguousPaths.push(relativePath);
    } catch {
      // No configuration body is opened at this metadata-only boundary.
    }
  }
  return Object.freeze({ ambiguousPaths: Object.freeze(ambiguousPaths) });
}

function values(metadata: ClaudeUserSourceMetadata, key: keyof ClaudeUserSourceMetadata): readonly string[] {
  const value = metadata[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

async function scanClaudeSources(
  context: HostSourceScanContext,
  reader: () => ClaudeUserSourceMetadata | Promise<ClaudeUserSourceMetadata>,
): Promise<SourceScanResult> {
  let metadata: ClaudeUserSourceMetadata;
  try { metadata = await reader(); }
  catch { metadata = { ambiguousPaths: [".claude/plugins"] }; }
  const findings = [
    ...values(metadata, "ownedPluginPaths").map((safePath) => createSourceFinding({
      code: "owned_plugin_source", severity: "conflict", sourceType: "owned_plugin", scope: "user", safePath,
    })),
    ...values(metadata, "ownedMarketplacePaths").map((safePath) => createSourceFinding({
      code: "owned_marketplace_source", severity: "conflict", sourceType: "owned_marketplace_registration", scope: "user", safePath,
    })),
    ...values(metadata, "rawMcpPaths").map((safePath) => createSourceFinding({
      code: "raw_mcp_source", severity: "conflict", sourceType: "raw_mcp", scope: "user", safePath,
    })),
    ...values(metadata, "manualHookPaths").map((safePath) => createSourceFinding({
      code: "manual_hook_source", severity: "conflict", sourceType: "manual_hook", scope: "user", safePath,
    })),
    ...values(metadata, "ambiguousPaths").map((safePath) => createSourceFinding({
      code: "ambiguous_source", severity: "conflict", sourceType: "ambiguous", scope: "user", safePath,
    })),
  ];
  if (context.mode !== "fast") {
    findings.push(
      ...values(metadata, "cachePaths").map((safePath) => createSourceFinding({
        code: "cache_residue", severity: "info", sourceType: "cache_residue", scope: "user", safePath,
      })),
      ...values(metadata, "disabledPaths").map((safePath) => createSourceFinding({
        code: "disabled_source", severity: "info", sourceType: "disabled_registration", scope: "user", safePath,
      })),
    );
  }
  return createSourceScanResult(context.mode, findings);
}

function projectionPending(): never {
  throw new InstallError("capability_projection_required", STATE_PATH);
}

export function createClaudeAdapter(options: ClaudeAdapterOptions = {}): HostAdapter {
  const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
  const reader = options.readUserSources ?? (() => defaultMetadata(homeDirectory));
  return Object.freeze({
    id: "claude" as const,
    managedRoots: MANAGED_ROOTS,
    detect: detectClaude,
    renderInstall: projectionPending,
    renderUninstall: projectionPending,
    status: claudeStatus,
    scanUserSources: (context: HostSourceScanContext) => scanClaudeSources(context, reader),
  });
}

export const claudeAdapter: HostAdapter = createClaudeAdapter();

exports.STATE_PATH = STATE_PATH;
exports.managedPaths = () => Object.freeze([STATE_PATH]);
exports.createClaudeAdapter = createClaudeAdapter;
