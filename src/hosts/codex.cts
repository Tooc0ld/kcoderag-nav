/** Codex current-state observation and metadata-only source boundary. */

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
import type {
  HostAdapter,
  HostObservation,
  HostSourceScanContext,
  HostStatusContext,
} from "./host-adapter.cjs";
import {
  createSourceFinding,
  createSourceScanResult,
  type SourceScanResult,
} from "./user-sources.cjs";

export interface CodexUserSourceMetadata {
  readonly ownedPluginPaths?: readonly string[];
  readonly ownedMarketplacePaths?: readonly string[];
  readonly rawMcpPaths?: readonly string[];
  readonly manualHookPaths?: readonly string[];
  readonly cachePaths?: readonly string[];
  readonly disabledPaths?: readonly string[];
  readonly ambiguousPaths?: readonly string[];
}

export interface CodexAdapterOptions {
  readonly homeDirectory?: string;
  readonly readUserSources?: () => CodexUserSourceMetadata | Promise<CodexUserSourceMetadata>;
  readonly [key: string]: unknown;
}

interface CodexObservationDetails {
  readonly stateBytes?: Buffer;
}

const STATE_PATH = ".codex/kcoderag-nav/install-state.json";
const MANAGED_ROOTS = Object.freeze([".codex", ".agents/skills"] as const);

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
  if (state.host !== "codex") throw new InstallError("invalid_state", STATE_PATH);
  for (const record of state.files) {
    const current = readRegular(target, record.path);
    if (current === undefined || sha256(current) !== record.digest) {
      throw new InstallError("managed_content_changed", record.path);
    }
  }
}

function detectCodex(context: { readonly target: ProjectTarget }): HostObservation {
  let stateBytes: Buffer | undefined;
  try {
    stateBytes = readRegular(context.target, STATE_PATH);
    if (stateBytes === undefined) {
      return Object.freeze({
        host: "codex" as const,
        target: context.target,
        details: Object.freeze({} satisfies CodexObservationDetails),
      });
    }
    const currentState = parseInstallState(stateBytes);
    verifyStateFiles(context.target, currentState);
    return Object.freeze({
      host: "codex" as const,
      target: context.target,
      currentState,
      details: Object.freeze({ stateBytes: Buffer.from(stateBytes) } satisfies CodexObservationDetails),
    });
  } catch (error) {
    return Object.freeze({
      host: "codex" as const,
      target: context.target,
      issues: Object.freeze([issueFrom(error)]),
      details: Object.freeze(stateBytes === undefined ? {} : { stateBytes: Buffer.from(stateBytes) }),
    });
  }
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
  if (context.observation.currentState !== undefined) {
    return createStatusResult({ status: "healthy", host: "codex" });
  }
  const root = validateManagedPath(context.target, STATE_PATH, MANAGED_ROOTS);
  if (hasManagedRootResidue(path.dirname(root.absolutePath))) {
    return createStatusResult({
      status: "invalid",
      host: "codex",
      issues: [{ code: "orphaned_managed_root", path: ".codex/kcoderag-nav" }],
    });
  }
  return createStatusResult({ host: "codex" });
}

function existingMetadata(homeDirectory: string): CodexUserSourceMetadata {
  const present: string[] = [];
  for (const relativePath of [
    ".codex/plugins/local/kcoderag-nav",
    ".codex/skills/kcoderag-nav/SKILL.md",
    ".codex/hooks/kcoderag-nav.json",
  ]) {
    try {
      fs.lstatSync(path.join(homeDirectory, ...relativePath.split("/")));
      present.push(relativePath);
    } catch {
      // Metadata-only observation treats missing and unreadable user paths as absent.
    }
  }
  return Object.freeze({ ambiguousPaths: Object.freeze(present) });
}

function values(metadata: CodexUserSourceMetadata, key: keyof CodexUserSourceMetadata): readonly string[] {
  const value = metadata[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

async function scanCodexSources(
  context: HostSourceScanContext,
  reader: () => CodexUserSourceMetadata | Promise<CodexUserSourceMetadata>,
): Promise<SourceScanResult> {
  let metadata: CodexUserSourceMetadata;
  try { metadata = await reader(); }
  catch { metadata = { ambiguousPaths: [".codex/plugins"] }; }
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

export function createCodexAdapter(options: CodexAdapterOptions = {}): HostAdapter {
  const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
  const reader = options.readUserSources ?? (() => existingMetadata(homeDirectory));
  return Object.freeze({
    id: "codex" as const,
    managedRoots: MANAGED_ROOTS,
    detect: detectCodex,
    renderInstall: projectionPending,
    renderUninstall: projectionPending,
    status: codexStatus,
    scanUserSources: (context: HostSourceScanContext) => scanCodexSources(context, reader),
  });
}

export const codexAdapter: HostAdapter = createCodexAdapter();

exports.STATE_PATH = STATE_PATH;
exports.managedPaths = () => Object.freeze([STATE_PATH]);
exports.createCodexAdapter = createCodexAdapter;
