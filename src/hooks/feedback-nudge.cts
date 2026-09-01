#!/usr/bin/env node
/** Reliable KCodeRag result transitions with hash-only, session/epoch-scoped state. */

import type { HostId } from "../core/contracts.cjs";
import {
  claimReminder,
  contextEpochForSession,
  reminderClaimExists,
} from "./once-marker.cjs";

export const FEEDBACK_NUDGE =
  "KCodeRag returned a result. If it was useful or misleading, call submit_feedback once with concise, non-sensitive feedback.";

const MAX_TOOL_NAME_CHARS = 96;
const MAX_INDEX_RECORDS = 256;
const SUCCESS_STATUSES = new Set(["ok", "success", "succeeded", "complete", "completed"]);
const FAILURE_STATUSES = new Set([
  "cancelled", "canceled", "error", "failed", "failure", "timeout", "timed_out", "aborted",
]);
const RESULT_TOOLS = new Set<LogicalKCodeRagTool>(["search_code", "context", "get_call_chain"]);
const LOGICAL_TOOLS = new Set<LogicalKCodeRagTool>([
  ...RESULT_TOOLS,
  "list_indexes",
  "submit_feedback",
]);

export type LogicalKCodeRagTool =
  | "search_code"
  | "context"
  | "get_call_chain"
  | "list_indexes"
  | "submit_feedback";

export interface NormalizedKCodeRagOutcome {
  readonly toolName: LogicalKCodeRagTool;
  readonly success: boolean;
  readonly usableIndex: boolean;
}

export interface KCodeRagOutcomeOptions {
  readonly host: HostId;
}

export interface FeedbackNudgeOptions extends KCodeRagOutcomeOptions {
  readonly managedRoot: string;
  readonly cacheRoot?: string;
  readonly now?: () => number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TOOL_NAME_CHARS
    ? value
    : undefined;
}

function expectedEvent(payload: Readonly<Record<string, unknown>>, host: HostId): boolean {
  if (host === "cursor") {
    return payload.hook_event_name === undefined || payload.hook_event_name === "afterMCPExecution";
  }
  if (host === "opencode") return payload.hook_event_name === undefined;
  return payload.hook_event_name === undefined || payload.hook_event_name === "PostToolUse";
}

function logicalToolName(
  payload: Readonly<Record<string, unknown>>,
  host: HostId,
): LogicalKCodeRagTool | undefined {
  let candidate: string | undefined;
  if (host === "cursor") {
    if (payload.mcp_server_name !== "kcoderag" && payload.mcp_server_name !== "kcoderag-qa") return undefined;
    candidate = boundedString(payload.tool_name);
  } else if (host === "opencode") {
    const raw = boundedString(payload.tool);
    candidate = raw === undefined ? undefined : /^kcoderag-qa_([A-Za-z][A-Za-z0-9_]*)$/u.exec(raw)?.[1];
  } else {
    const raw = boundedString(payload.tool_name);
    if (raw === undefined) return undefined;
    candidate = /^mcp__kcoderag[-_]qa__([A-Za-z][A-Za-z0-9_]*)$/u.exec(raw)?.[1];
    if (candidate === undefined && host === "zcode") {
      candidate = /^(?:kcoderag[-_]qa|krag)[._/]([A-Za-z][A-Za-z0-9_]*)(?:\/[0-9]+)?$/u.exec(raw)?.[1];
    }
  }
  return candidate !== undefined && LOGICAL_TOOLS.has(candidate as LogicalKCodeRagTool)
    ? candidate as LogicalKCodeRagTool
    : undefined;
}

interface SuccessEvidence {
  readonly failed: boolean;
  readonly ambiguous: boolean;
}

function inspectSuccessRecord(value: unknown): SuccessEvidence {
  if (!isRecord(value)) return { failed: false, ambiguous: false };
  let failed = false;
  let ambiguous = false;
  for (const key of ["success", "ok"] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean") ambiguous = true;
      else if (value[key] === false) failed = true;
    }
  }
  if (value.is_error !== undefined) {
    if (typeof value.is_error !== "boolean") ambiguous = true;
    else if (value.is_error) failed = true;
  }
  for (const key of ["cancelled", "canceled", "timed_out"] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean") ambiguous = true;
      else if (value[key]) failed = true;
    }
  }
  if (value.error !== undefined && value.error !== null && value.error !== false && value.error !== "") {
    failed = true;
  }
  if (value.status !== undefined) {
    if (typeof value.status !== "string" || value.status.length > 64) ambiguous = true;
    else {
      const status = value.status.toLowerCase();
      if (FAILURE_STATUSES.has(status)) failed = true;
      else if (!SUCCESS_STATUSES.has(status)) ambiguous = true;
    }
  }
  return { failed, ambiguous };
}

function reliableSuccess(payload: Readonly<Record<string, unknown>>, host: HostId): boolean {
  if (!expectedEvent(payload, host)) return false;
  const records = [payload, payload.tool_response, payload.result, payload.output];
  let failed = false;
  let ambiguous = false;
  for (const record of records) {
    const evidence = inspectSuccessRecord(record);
    failed ||= evidence.failed;
    ambiguous ||= evidence.ambiguous;
  }
  return !failed && !ambiguous;
}

function indexList(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) return value.length <= MAX_INDEX_RECORDS ? value : undefined;
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.indexes)) return value.indexes.length <= MAX_INDEX_RECORDS ? value.indexes : undefined;
  return indexList(value.result);
}

function usableIndexResult(payload: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [payload.tool_response, payload.result, payload.output]) {
    const indexes = indexList(candidate);
    if (indexes === undefined) continue;
    return indexes.some((entry) => {
      if (typeof entry === "string") return entry.length > 0 && entry.length <= 256;
      if (!isRecord(entry) || entry.enabled === false) return false;
      const status = typeof entry.status === "string" ? entry.status.toLowerCase() : "ready";
      return !["disabled", "error", "failed", "missing", "offline", "unavailable"].includes(status);
    });
  }
  return false;
}

/** Normalize only a known KCodeRag tool and a host-reliable completion outcome. */
export function normalizeKCodeRagOutcome(
  payload: unknown,
  options: KCodeRagOutcomeOptions,
): NormalizedKCodeRagOutcome | undefined {
  try {
    if (!isRecord(payload)) return undefined;
    const toolName = logicalToolName(payload, options.host);
    if (toolName === undefined) return undefined;
    const success = reliableSuccess(payload, options.host);
    return Object.freeze({
      toolName,
      success,
      usableIndex: success && toolName === "list_indexes" && usableIndexResult(payload),
    });
  } catch {
    return undefined;
  }
}

function submitted(payload: unknown, options: FeedbackNudgeOptions): boolean {
  return reminderClaimExists(payload, {
    host: options.host,
    managedRoot: options.managedRoot,
    capability: "kcoderag-navigation",
    reminderKind: "feedback-submitted",
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
  });
}

/** True only for a successful usable list_indexes fact in this exact stable session. */
export function indexAvailableForSession(payload: unknown, options: FeedbackNudgeOptions): boolean {
  return reminderClaimExists(payload, {
    host: options.host,
    managedRoot: options.managedRoot,
    capability: "kcoderag-navigation",
    reminderKind: "index-available",
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
  });
}

/** Apply one reliable MCP transition; output is constant and all state is hash-addressed. */
export function feedbackNudgeContribution(
  payload: unknown,
  options: FeedbackNudgeOptions,
): string | undefined {
  try {
    const outcome = normalizeKCodeRagOutcome(payload, options);
    if (outcome === undefined || !outcome.success) return undefined;
    const claimOptions = {
      host: options.host,
      managedRoot: options.managedRoot,
      capability: "kcoderag-navigation" as const,
      ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
      ...(options.now === undefined ? {} : { now: options.now }),
    };
    if (outcome.toolName === "list_indexes") {
      if (outcome.usableIndex) {
        claimReminder(payload, { ...claimOptions, reminderKind: "index-available" });
      }
      return undefined;
    }
    if (outcome.toolName === "submit_feedback") {
      claimReminder(payload, { ...claimOptions, reminderKind: "feedback-submitted" });
      return undefined;
    }
    if (!RESULT_TOOLS.has(outcome.toolName) || submitted(payload, options)) return undefined;
    const contextEpoch = contextEpochForSession(payload, {
      host: options.host,
      managedRoot: options.managedRoot,
      capability: "kcoderag-navigation",
      source: "resume",
      ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
    });
    if (contextEpoch === undefined) return undefined;
    return claimReminder(payload, {
      ...claimOptions,
      reminderKind: "feedback-reminded",
      contextEpoch,
    }).claimed
      ? FEEDBACK_NUDGE
      : undefined;
  } catch {
    return undefined;
  }
}
