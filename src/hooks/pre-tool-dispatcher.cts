#!/usr/bin/env node
/** Single bounded PreToolUse dispatcher; every contributor and output boundary fails open. */

const fs = require("node:fs") as typeof import("node:fs");
import type { HostId } from "../core/contracts.cjs";
import { jx3StyleContribution } from "./jx3-style-nudge.cjs";

export const MAX_ADDITIONAL_CONTEXT_CHARS = 600;
const MAX_INPUT_CHARS = 131_072;

export type PreToolContributor = (
  payload: Readonly<Record<string, unknown>>,
) => string | undefined;

export interface DispatcherRuntimeOptions {
  readonly host?: HostId;
  readonly managedRoot?: string;
  readonly statePath?: string;
  readonly cacheRoot?: string;
}

interface UpdateNoticeModule {
  readHostUpdateNotice(
    host: HostId,
    payload: unknown,
    options?: { readonly statePath?: string; readonly cwd?: string },
  ): string | undefined;
  scheduleHostUpdateRefresh(
    host: HostId,
    payload: unknown,
    options?: { readonly statePath?: string; readonly cwd?: string },
  ): boolean;
}

interface NavigationModule {
  navigationContribution(payload: unknown, updateNotice?: string): string | undefined;
}

const navigation: NavigationModule | undefined = (() => {
  try {
    return require("./grep-nudge.cjs") as NavigationModule;
  } catch {
    return undefined;
  }
})();

const updateNotice: UpdateNoticeModule | undefined = (() => {
  try {
    return require("./update-notice.cjs") as UpdateNoticeModule;
  } catch {
    return undefined;
  }
})();

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHost(value: unknown): value is HostId {
  return value === "codex" || value === "claude" || value === "cursor" || value === "opencode";
}

function defaultStatePath(host: HostId, managedRoot: string): string {
  const hostRoot = host === "codex" ? ".codex" : host === "claude" ? ".claude" :
    host === "cursor" ? ".cursor" : ".opencode";
  return require("node:path").join(managedRoot, hostRoot, "kcoderag-nav", "install-state.json") as string;
}

export function createDefaultContributors(
  runtime: DispatcherRuntimeOptions = {},
): readonly PreToolContributor[] {
  const runtimeHost = isHost(runtime.host) ? runtime.host : undefined;
  const managedRoot = typeof runtime.managedRoot === "string" && runtime.managedRoot.length > 0
    ? runtime.managedRoot
    : undefined;
  const statePath = runtimeHost !== undefined && managedRoot !== undefined
    ? runtime.statePath ?? defaultStatePath(runtimeHost, managedRoot)
    : undefined;
  return Object.freeze([
    (payload: Readonly<Record<string, unknown>>): string | undefined => {
      const noticeOptions = {
        ...(managedRoot === undefined ? {} : { cwd: managedRoot }),
        ...(statePath === undefined ? {} : { statePath }),
      };
      const notice = runtimeHost === undefined || managedRoot === undefined || updateNotice === undefined
        ? undefined
        : updateNotice.readHostUpdateNotice(runtimeHost, payload, noticeOptions);
      const contribution = navigation?.navigationContribution(payload, notice);
      if (runtimeHost !== undefined && managedRoot !== undefined && updateNotice !== undefined) {
        updateNotice.scheduleHostUpdateRefresh(runtimeHost, payload, noticeOptions);
      }
      return contribution;
    },
    (payload: Readonly<Record<string, unknown>>): string | undefined => {
      if (runtimeHost === undefined || managedRoot === undefined) return undefined;
      return jx3StyleContribution(payload, {
        host: runtimeHost,
        managedRoot,
        ...(statePath === undefined ? {} : { statePath }),
        ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
      });
    },
  ]);
}

function responseForContexts(contexts: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (contexts.length === 0) return undefined;
  const additionalContext = contexts.join("\n\n").slice(0, MAX_ADDITIONAL_CONTEXT_CHARS);
  if (additionalContext.length === 0) return undefined;
  return Object.freeze({
    hookSpecificOutput: Object.freeze({
      hookEventName: "PreToolUse",
      additionalContext,
    }),
  });
}

export function dispatchPayload(
  payload: Readonly<Record<string, unknown>>,
  contributors: readonly PreToolContributor[] = createDefaultContributors(),
): Readonly<Record<string, unknown>> | undefined {
  const contexts: string[] = [];
  for (const contributor of contributors) {
    try {
      const context = contributor(payload);
      if (typeof context === "string" && context.length > 0) contexts.push(context);
    } catch {
      continue;
    }
  }
  return responseForContexts(contexts);
}

export function dispatchRawInput(
  rawInput: string,
  contributors?: readonly PreToolContributor[],
  parseInput: (rawInput: string) => unknown = JSON.parse,
  runtime: DispatcherRuntimeOptions = {},
): Readonly<Record<string, unknown>> | undefined {
  if (rawInput.length === 0 || rawInput.length > MAX_INPUT_CHARS) return undefined;
  try {
    const payload = parseInput(rawInput);
    return isRecord(payload)
      ? dispatchPayload(payload, contributors ?? createDefaultContributors(runtime))
      : undefined;
  } catch {
    return undefined;
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
  rawInput?: string,
  writeOutput: (text: string) => void = (text) => { process.stdout.write(text); },
  contributors?: readonly PreToolContributor[],
  runtime: DispatcherRuntimeOptions = {},
): number {
  try {
    const output = dispatchRawInput(rawInput ?? readBoundedStdin(), contributors, JSON.parse, runtime);
    if (output !== undefined) writeOutput(JSON.stringify(output));
  } catch {
    return 0;
  }
  return 0;
}

if (require.main === module) process.exitCode = main();
