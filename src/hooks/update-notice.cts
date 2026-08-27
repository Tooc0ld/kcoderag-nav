#!/usr/bin/env node
/** Host protocol adapters over the shared offline update cache and detached worker. */

const fs = require("node:fs") as typeof import("node:fs");

import type { UpdateCheckOptions, UpdateHost } from "./update-check.cjs";

interface UpdateRuntime {
  readInstalledVersion(statePath?: string): string | undefined;
  readUpdateHint(installedVersion: string | undefined, options?: UpdateCheckOptions): string | undefined;
  scheduleRefresh(hookPayload: unknown, options?: UpdateCheckOptions): boolean;
}

const updateCheck = require("./update-check.cjs") as UpdateRuntime;
const HOSTS = new Set<UpdateHost>(["codex", "claude", "cursor", "opencode", "zcode"]);
const MAX_INPUT_CHARS = 64 * 1_024;
const MAX_ID_CHARS = 512;
const MAX_CONTEXT_CHARS = 600;

export interface HostUpdateNoticeOptions {
  readonly installedVersion?: string;
  readonly statePath?: string;
  readonly runtimePath?: string;
  readonly cwd?: string;
  readonly updateRuntime?: UpdateRuntime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedIdentity(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim().slice(0, MAX_ID_CHARS);
  return normalized.length > 0 ? normalized : undefined;
}

function sessionIdentity(host: UpdateHost, payload: Record<string, unknown>): string | undefined {
  const fields = host === "opencode"
    ? ["sessionID", "session_id", "conversation_id", "thread_id"]
    : ["session_id", "conversation_id", "thread_id", "sessionID"];
  for (const field of fields) {
    const identity = boundedIdentity(payload[field]);
    if (identity !== undefined) return `${host}:${identity}`;
  }
  return undefined;
}

function boundedCwd(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return (candidate.length > 0 ? candidate : fallback).slice(0, 2_048);
}

export function hostPayload(
  host: UpdateHost,
  payload: unknown,
  cwd = process.cwd(),
): Record<string, unknown> | undefined {
  if (!HOSTS.has(host) || !isRecord(payload)) return undefined;
  const identity = sessionIdentity(host, payload);
  const normalizedCwd = boundedCwd(payload.cwd, cwd);
  return {
    tool_name: "Bash",
    tool_input: {},
    ...(identity === undefined ? {} : { session_id: identity }),
    cwd: identity === undefined ? `[${host}]${normalizedCwd}` : normalizedCwd,
  };
}

function installedVersion(options: HostUpdateNoticeOptions, runtime: UpdateRuntime): string | undefined {
  return options.installedVersion ?? runtime.readInstalledVersion(options.statePath);
}

export function readHostUpdateNotice(
  host: UpdateHost,
  payload: unknown,
  options: HostUpdateNoticeOptions = {},
): string | undefined {
  try {
    const runtime = options.updateRuntime ?? updateCheck;
    const version = installedVersion(options, runtime);
    const normalized = hostPayload(host, payload, options.cwd);
    if (version === undefined || normalized === undefined) return undefined;
    return runtime.readUpdateHint(version, { hookPayload: normalized, host });
  } catch {
    return undefined;
  }
}

export function scheduleHostUpdateRefresh(
  host: UpdateHost,
  payload: unknown,
  options: HostUpdateNoticeOptions = {},
): boolean {
  try {
    const runtime = options.updateRuntime ?? updateCheck;
    const version = installedVersion(options, runtime);
    const normalized = hostPayload(host, payload, options.cwd);
    if (version === undefined || normalized === undefined) return false;
    return runtime.scheduleRefresh(normalized, {
      host,
      ...(options.runtimePath === undefined ? {} : { runtimePath: options.runtimePath }),
    });
  } catch {
    return false;
  }
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

export function main(
  argv: readonly string[] = process.argv.slice(2),
  rawInput?: string,
  writeOutput: (text: string) => void = (text) => { process.stdout.write(text); },
  options: HostUpdateNoticeOptions = {},
): number {
  try {
    if (argv.length !== 1 || argv[0] !== "cursor") return 0;
    const raw = rawInput ?? readBoundedStdin();
    if (raw.length === 0 || raw.length > MAX_INPUT_CHARS) return 0;
    const payload: unknown = JSON.parse(raw);
    const notice = readHostUpdateNotice("cursor", payload, options);
    if (notice !== undefined) {
      writeOutput(JSON.stringify({ additional_context: notice.slice(0, MAX_CONTEXT_CHARS) }));
    }
    scheduleHostUpdateRefresh("cursor", payload, options);
  } catch {
    return 0;
  }
  return 0;
}

if (require.main === module) process.exitCode = main();
