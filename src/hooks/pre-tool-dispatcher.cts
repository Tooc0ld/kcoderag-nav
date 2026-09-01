#!/usr/bin/env node
/** One bounded hook-event dispatcher; every contributor and output boundary fails open. */

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
import type { CapabilityId } from "../capabilities/contracts.cjs";
import type { HostId } from "../core/contracts.cjs";
import {
  codeStyleContribution,
  evaluateCodeStyleIntegrity,
} from "./code-style-nudge.cjs";
import {
  claimReminder,
  contextEpochForSession,
  stableSessionIdentity,
  type StableSessionIdentity,
} from "./once-marker.cjs";

export const MAX_ADDITIONAL_CONTEXT_CHARS = 600;
const MAX_INPUT_CHARS = 131_072;
const SESSION_START_SOURCES = new Set(["startup", "resume", "clear", "compact"]);
const NAVIGATION_CAPABILITY: CapabilityId = "kcoderag-navigation";
const RECEIPT_PROVEN_CODE_STYLE_VERSION = "2.1.241";
const SESSION_START_BASELINE =
  "Use KCodeRag for structural code navigation before broad local search. " +
  "Prefer search_code, context, and get_call_chain; use local tools for exact verification.";

export type NormalizedHookEventName =
  | "SessionStart"
  | "SessionEnd"
  | "PreToolUse"
  | "PostToolUse";

export interface NormalizedHookEvent {
  readonly eventName: NormalizedHookEventName;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly host?: HostId;
  readonly managedRoot?: string;
  readonly stableSession?: StableSessionIdentity;
  readonly source?: "startup" | "resume" | "clear" | "compact";
  readonly contextEpoch?: string;
}

export type HookEventContributor = (
  event: NormalizedHookEvent,
) => string | undefined;

export type PreToolContributor = (
  payload: Readonly<Record<string, unknown>>,
) => string | undefined;

export interface DispatcherRuntimeOptions {
  readonly host?: HostId;
  readonly managedRoot?: string;
  readonly statePath?: string;
  readonly cacheRoot?: string;
  readonly installedVersion?: string;
  readonly hostVersion?: string;
  readonly now?: () => number;
  readonly updateSpawn?: (...args: readonly unknown[]) => { unref?(): void };
}

interface UpdateCheckModule {
  readInstalledVersion(statePath?: string): string | undefined;
  readUpdateHint(installedVersion: string | undefined, options?: Readonly<Record<string, unknown>>): string | undefined;
  scheduleRefresh(payload: unknown, options?: Readonly<Record<string, unknown>>): boolean;
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
  navigationContribution(
    payload: unknown,
    updateNotice?: string,
    options?: {
      readonly host: HostId;
      readonly managedRoot: string;
      readonly cacheRoot?: string;
    },
  ): string | undefined;
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

const updateCheck: UpdateCheckModule | undefined = (() => {
  try {
    return require("./update-check.cjs") as UpdateCheckModule;
  } catch {
    return undefined;
  }
})();

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHost(value: unknown): value is HostId {
  return value === "codex" || value === "claude" || value === "cursor" ||
    value === "opencode" || value === "zcode";
}

function eventName(payload: Readonly<Record<string, unknown>>): NormalizedHookEventName | undefined {
  const explicit = payload.hook_event_name;
  if (
    explicit === "SessionStart" || explicit === "SessionEnd" ||
    explicit === "PreToolUse" || explicit === "PostToolUse"
  ) {
    return explicit;
  }
  return typeof payload.tool_name === "string" || typeof payload.tool === "string"
    ? "PreToolUse"
    : undefined;
}

/** Normalize only documented, bounded lifecycle fields; opaque identities remain byte-distinct. */
export function normalizeHookEvent(
  payload: unknown,
  runtime: DispatcherRuntimeOptions = {},
): NormalizedHookEvent | undefined {
  if (!isRecord(payload)) return undefined;
  const normalizedName = eventName(payload);
  if (normalizedName === undefined) return undefined;
  const host = isHost(runtime.host) ? runtime.host : undefined;
  const managedRoot = typeof runtime.managedRoot === "string" && runtime.managedRoot.length > 0
    ? runtime.managedRoot
    : undefined;
  const identity = stableSessionIdentity(payload);
  if (normalizedName === "SessionStart") {
    const rawSource = payload.source;
    if (typeof rawSource !== "string" || !SESSION_START_SOURCES.has(rawSource)) return undefined;
    const source = rawSource as "startup" | "resume" | "clear" | "compact";
    const contextEpoch = host === undefined || managedRoot === undefined || identity === undefined
      ? undefined
      : contextEpochForSession(payload, {
          host,
          managedRoot,
          capability: NAVIGATION_CAPABILITY,
          source,
          ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
        });
    return Object.freeze({
      eventName: normalizedName,
      payload,
      ...(host === undefined ? {} : { host }),
      ...(managedRoot === undefined ? {} : { managedRoot }),
      ...(identity === undefined ? {} : { stableSession: identity }),
      source,
      ...(contextEpoch === undefined ? {} : { contextEpoch }),
    });
  }
  return Object.freeze({
    eventName: normalizedName,
    payload,
    ...(host === undefined ? {} : { host }),
    ...(managedRoot === undefined ? {} : { managedRoot }),
    ...(identity === undefined ? {} : { stableSession: identity }),
  });
}

function defaultStatePath(host: HostId, managedRoot: string): string {
  const hostRoot = host === "codex" ? ".codex" : host === "claude" ? ".claude" :
    host === "cursor" ? ".cursor" : host === "opencode" ? ".opencode" : ".zcode";
  return path.join(managedRoot, hostRoot, "kcoderag-nav", "install-state.json");
}

function sessionStartNavigation(
  event: NormalizedHookEvent,
  runtime: DispatcherRuntimeOptions,
): string | undefined {
  if (
    event.eventName !== "SessionStart" || event.host === undefined ||
    event.managedRoot === undefined || event.contextEpoch === undefined
  ) return undefined;
  const claim = claimReminder(event.payload, {
      host: event.host,
      managedRoot: event.managedRoot,
      capability: NAVIGATION_CAPABILITY,
      reminderKind: "navigation",
      contextEpoch: event.contextEpoch,
      ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
      ...(runtime.now === undefined ? {} : { now: runtime.now }),
    });
  return claim.claimed ? SESSION_START_BASELINE : undefined;
}

function sessionStartCodeStyle(
  event: NormalizedHookEvent,
  runtime: DispatcherRuntimeOptions,
  statePath: string | undefined,
): string | undefined {
  if (
    event.eventName !== "SessionStart" || event.host === undefined ||
    event.managedRoot === undefined || event.contextEpoch === undefined
  ) return undefined;
  if (
    runtime.hostVersion !== undefined &&
    (event.host !== "claude" || runtime.hostVersion !== RECEIPT_PROVEN_CODE_STYLE_VERSION)
  ) return undefined;
  if (!evaluateCodeStyleIntegrity({
    host: event.host,
    managedRoot: event.managedRoot,
    ...(statePath === undefined ? {} : { statePath }),
  }).ok) return undefined;
  const claim = claimReminder(event.payload, {
    host: event.host,
    managedRoot: event.managedRoot,
    capability: "code-style-nudge",
    reminderKind: "code-style",
    contextEpoch: event.contextEpoch,
    ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
    ...(runtime.now === undefined ? {} : { now: runtime.now }),
  });
  return claim.claimed
    ? "Code-style guidance is installed and integrity-verified; load $code-style-correction before C/C++ or Lua edits."
    : undefined;
}

function sessionStartUpdate(
  event: NormalizedHookEvent,
  runtime: DispatcherRuntimeOptions,
  statePath: string | undefined,
): string | undefined {
  if (event.eventName !== "SessionStart" || event.host === undefined || updateCheck === undefined) {
    return undefined;
  }
  const installedVersion = runtime.installedVersion ?? updateCheck.readInstalledVersion(statePath);
  const options = {
    host: event.host,
    hookPayload: event.payload,
    ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
    ...(runtime.now === undefined ? {} : { now: runtime.now }),
    ...(runtime.updateSpawn === undefined ? {} : { spawn: runtime.updateSpawn }),
  };
  const notice = updateCheck.readUpdateHint(installedVersion, options);
  updateCheck.scheduleRefresh(event.payload, options);
  return notice;
}

function createDefaultEventContributors(
  runtime: DispatcherRuntimeOptions = {},
): readonly HookEventContributor[] {
  const runtimeHost = isHost(runtime.host) ? runtime.host : undefined;
  const managedRoot = typeof runtime.managedRoot === "string" && runtime.managedRoot.length > 0
    ? runtime.managedRoot
    : undefined;
  const statePath = runtimeHost !== undefined && managedRoot !== undefined
    ? runtime.statePath ?? defaultStatePath(runtimeHost, managedRoot)
    : undefined;
  return Object.freeze([
    (event: NormalizedHookEvent): string | undefined => {
      if (event.eventName !== "SessionStart") return undefined;
      return sessionStartNavigation(event, runtime);
    },
    (event: NormalizedHookEvent): string | undefined => {
      return sessionStartCodeStyle(event, runtime, statePath);
    },
    (event: NormalizedHookEvent): string | undefined => {
      return sessionStartUpdate(event, runtime, statePath);
    },
    (event: NormalizedHookEvent): string | undefined => {
      if (event.eventName !== "PreToolUse") return undefined;
      const noticeOptions = {
        ...(managedRoot === undefined ? {} : { cwd: managedRoot }),
        ...(statePath === undefined ? {} : { statePath }),
      };
      const notice = runtimeHost === undefined || managedRoot === undefined || updateNotice === undefined
        ? undefined
        : updateNotice.readHostUpdateNotice(runtimeHost, event.payload, noticeOptions);
      const contribution = navigation?.navigationContribution(
        event.payload,
        notice,
        runtimeHost === undefined || managedRoot === undefined
          ? undefined
          : {
              host: runtimeHost,
              managedRoot,
              ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
            },
      );
      if (runtimeHost !== undefined && managedRoot !== undefined && updateNotice !== undefined) {
        updateNotice.scheduleHostUpdateRefresh(runtimeHost, event.payload, noticeOptions);
      }
      return contribution;
    },
    (event: NormalizedHookEvent): string | undefined => {
      if (event.eventName !== "PreToolUse" || runtimeHost === undefined || managedRoot === undefined) {
        return undefined;
      }
      return codeStyleContribution(event.payload, {
        host: runtimeHost,
        managedRoot,
        ...(statePath === undefined ? {} : { statePath }),
        ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
      });
    },
  ]);
}

export function createDefaultContributors(
  runtime: DispatcherRuntimeOptions = {},
): readonly PreToolContributor[] {
  const contributors = createDefaultEventContributors(runtime);
  return Object.freeze(contributors.map((contributor) => (
    payload: Readonly<Record<string, unknown>>,
  ): string | undefined => {
    const event = normalizeHookEvent({ ...payload, hook_event_name: "PreToolUse" }, runtime);
    return event === undefined ? undefined : contributor(event);
  }));
}

function responseForContexts(
  contexts: readonly string[],
  hookEventName: NormalizedHookEventName,
): Readonly<Record<string, unknown>> | undefined {
  if (contexts.length === 0) return undefined;
  const additionalContext = contexts.join("\n\n").slice(0, MAX_ADDITIONAL_CONTEXT_CHARS);
  if (additionalContext.length === 0) return undefined;
  return Object.freeze({
    hookSpecificOutput: Object.freeze({
      hookEventName,
      additionalContext,
    }),
  });
}

export function dispatchHookEvent(
  event: NormalizedHookEvent,
  contributors: readonly HookEventContributor[] = createDefaultEventContributors({
    ...(event.host === undefined ? {} : { host: event.host }),
    ...(event.managedRoot === undefined ? {} : { managedRoot: event.managedRoot }),
  }),
): Readonly<Record<string, unknown>> | undefined {
  const contexts: string[] = [];
  for (const contributor of contributors) {
    try {
      const context = contributor(event);
      if (typeof context === "string" && context.length > 0) contexts.push(context);
    } catch {
      continue;
    }
  }
  return responseForContexts(contexts, event.eventName);
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
  return responseForContexts(contexts, "PreToolUse");
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
    if (!isRecord(payload)) return undefined;
    if (contributors !== undefined) return dispatchPayload(payload, contributors);
    const event = normalizeHookEvent(payload, runtime);
    return event === undefined
      ? undefined
      : dispatchHookEvent(event, createDefaultEventContributors(runtime));
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

if (require.main === module) {
  const host = isHost(process.argv[2]) ? process.argv[2] : undefined;
  const managedRoot = typeof process.env.ZCODE_PROJECT_DIR === "string" &&
    process.env.ZCODE_PROJECT_DIR.length > 0
    ? process.env.ZCODE_PROJECT_DIR
    : undefined;
  process.exitCode = main(
    undefined,
    (text) => { process.stdout.write(text); },
    undefined,
    host === undefined || managedRoot === undefined ? {} : { host, managedRoot },
  );
}
