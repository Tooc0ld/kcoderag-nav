#!/usr/bin/env node
/** Secret-free, bounded record of a successful KCodeRag MCP tool execution. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

import type { HostId } from "../core/contracts.cjs";

export type MarkerHost = HostId;

export const MCP_CALL_MARKER_SCHEMA_VERSION = 1 as const;
export const MCP_CALL_MARKER_TTL_MS = 4 * 60 * 60 * 1_000;
export const MAX_MCP_CALL_MARKERS = 128;
const MAX_INPUT_BYTES = 64 * 1_024;
const MAX_IDENTITY_CHARS = 4 * 1_024;
const MARKER_DIRECTORY = "mcp-calls";

export interface MarkerFiles {
  ensureDirectory(directoryPath: string): void;
  createExclusive(filePath: string, contents: string): boolean;
  listFiles(directoryPath: string): readonly { readonly name: string; readonly mtimeMs: number }[];
  remove(filePath: string): void;
}

export interface MarkerOptions {
  readonly host: MarkerHost;
  readonly cacheRoot?: string;
  readonly now?: () => number;
  readonly cwd?: string;
  readonly files?: MarkerFiles;
}

export interface MarkerResult {
  readonly recorded: boolean;
  readonly key?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTITY_CHARS
    ? value
    : undefined;
}

function defaultCacheRoot(): string {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "kcoderag-nav");
  }
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "kcoderag-nav");
}

const nodeFiles: MarkerFiles = {
  ensureDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  },
  createExclusive(filePath, contents) {
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(filePath, "wx", 0o600);
      fs.writeFileSync(descriptor, contents, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      return true;
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch { /* fail open */ }
        try { fs.unlinkSync(filePath); } catch { /* fail open */ }
      }
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  },
  listFiles(directoryPath) {
    try {
      return fs.readdirSync(directoryPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => ({
          name: entry.name,
          mtimeMs: fs.statSync(path.join(directoryPath, entry.name)).mtimeMs,
        }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  },
  remove(filePath) {
    try { fs.unlinkSync(filePath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  },
};

function isKCodeRagTool(payload: Record<string, unknown>, host: MarkerHost): boolean {
  if (host === "cursor") {
    return (payload.mcp_server_name === "kcoderag" || payload.mcp_server_name === "kcoderag-qa") &&
      (payload.hook_event_name === undefined || payload.hook_event_name === "afterMCPExecution");
  }
  if (host === "opencode") {
    const tool = boundedString(payload.tool);
    return tool !== undefined && /^kcoderag-qa_/u.test(tool);
  }
  const toolName = boundedString(payload.tool_name);
  return toolName !== undefined && /^mcp__kcoderag-qa__.+/u.test(toolName) &&
    (payload.hook_event_name === undefined || payload.hook_event_name === "PostToolUse");
}

function identity(payload: Record<string, unknown>, host: MarkerHost, cwd: string): {
  readonly raw: string;
  readonly scope: "turn" | "session";
} | undefined {
  const session = boundedString(payload.session_id) ??
    boundedString(payload.conversation_id) ??
    boundedString(payload.sessionID);
  const turn = boundedString(payload.turn_id) ?? boundedString(payload.generation_id);
  const fallback = boundedString(cwd);
  const sessionIdentity = session ?? fallback;
  if (sessionIdentity === undefined) return undefined;
  return turn === undefined
    ? { raw: `${host}\0session\0${sessionIdentity}`, scope: "session" }
    : { raw: `${host}\0turn\0${sessionIdentity}\0${turn}`, scope: "turn" };
}

function markerName(rawIdentity: string): string {
  return `${crypto.createHash("sha256").update(rawIdentity).digest("hex")}.json`;
}

function prune(files: MarkerFiles, directoryPath: string, keepName: string, now: number): void {
  const candidates = files.listFiles(directoryPath)
    .filter((entry) => /^[0-9a-f]{64}\.json$/u.test(entry.name) && entry.name !== keepName)
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
  for (const [index, entry] of candidates.entries()) {
    if (now - entry.mtimeMs > MCP_CALL_MARKER_TTL_MS || index >= MAX_MCP_CALL_MARKERS - 1) {
      files.remove(path.join(directoryPath, entry.name));
    }
  }
}

/** Record only metadata required to recognize a same-session/turn local verification. */
export function recordKCodeRagCall(payload: unknown, options: MarkerOptions): MarkerResult {
  try {
    if (!isRecord(payload) || !isKCodeRagTool(payload, options.host)) return Object.freeze({ recorded: false });
    const now = options.now?.() ?? Date.now();
    if (!Number.isFinite(now) || now < 0) return Object.freeze({ recorded: false });
    const markerIdentity = identity(payload, options.host, options.cwd ?? process.cwd());
    if (markerIdentity === undefined) return Object.freeze({ recorded: false });
    const files = options.files ?? nodeFiles;
    const directoryPath = path.join(options.cacheRoot ?? defaultCacheRoot(), MARKER_DIRECTORY);
    const name = markerName(markerIdentity.raw);
    files.ensureDirectory(directoryPath);
    files.createExclusive(path.join(directoryPath, name), `${JSON.stringify({
      schemaVersion: MCP_CALL_MARKER_SCHEMA_VERSION,
      host: options.host,
      scope: markerIdentity.scope,
      recordedAt: now,
    })}\n`);
    prune(files, directoryPath, name, now);
    return Object.freeze({ recorded: true, key: name.slice(0, -5) });
  } catch {
    return Object.freeze({ recorded: false });
  }
}

function readBoundedStdin(): string | undefined {
  const chunks: Buffer[] = [];
  let total = 0;
  const buffer = Buffer.allocUnsafe(8 * 1_024);
  try {
    while (true) {
      const count = fs.readSync(0, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      if (total > MAX_INPUT_BYTES) return undefined;
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch {
    return undefined;
  }
}

/** Host hook entry point. It always emits nothing and exits successfully. */
export function main(hostArgument = process.argv[2]): number {
  try {
    if (!(["codex", "claude", "cursor", "opencode"] as const).includes(hostArgument as MarkerHost)) return 0;
    const raw = readBoundedStdin();
    if (raw === undefined) return 0;
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return 0; }
    recordKCodeRagCall(payload, { host: hostArgument as MarkerHost });
  } catch {
    // Marker failures must never affect the host tool result.
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

exports.recordKCodeRagCall = recordKCodeRagCall;
exports.main = main;
