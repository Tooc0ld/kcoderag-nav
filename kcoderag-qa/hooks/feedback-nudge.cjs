#!/usr/bin/env node
"use strict";
/** Reliable KCodeRag result transitions with hash-only, session/epoch-scoped state. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FEEDBACK_NUDGE = void 0;
exports.normalizeKCodeRagOutcome = normalizeKCodeRagOutcome;
exports.indexAvailableForSession = indexAvailableForSession;
exports.feedbackNudgeContribution = feedbackNudgeContribution;
const once_marker_cjs_1 = require("./once-marker.cjs");
exports.FEEDBACK_NUDGE = "KCodeRag returned a result. If it was useful or misleading, call submit_feedback once with concise, non-sensitive feedback.";
const MAX_TOOL_NAME_CHARS = 96;
const MAX_INDEX_RECORDS = 256;
const SUCCESS_STATUSES = new Set(["ok", "success", "succeeded", "complete", "completed"]);
const FAILURE_STATUSES = new Set([
    "cancelled", "canceled", "error", "failed", "failure", "timeout", "timed_out", "aborted",
]);
const RESULT_TOOLS = new Set(["search_code", "context", "get_call_chain"]);
const LOGICAL_TOOLS = new Set([
    ...RESULT_TOOLS,
    "list_indexes",
    "submit_feedback",
]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedString(value) {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_TOOL_NAME_CHARS
        ? value
        : undefined;
}
function expectedEvent(payload, host) {
    if (host === "cursor") {
        return payload.hook_event_name === undefined || payload.hook_event_name === "afterMCPExecution";
    }
    if (host === "opencode")
        return payload.hook_event_name === undefined;
    return payload.hook_event_name === undefined || payload.hook_event_name === "PostToolUse";
}
function logicalToolName(payload, host) {
    let candidate;
    if (host === "cursor") {
        if (payload.mcp_server_name !== "kcoderag" && payload.mcp_server_name !== "kcoderag-qa")
            return undefined;
        candidate = boundedString(payload.tool_name);
    }
    else if (host === "opencode") {
        const raw = boundedString(payload.tool);
        candidate = raw === undefined ? undefined : /^kcoderag-qa_([A-Za-z][A-Za-z0-9_]*)$/u.exec(raw)?.[1];
    }
    else {
        const raw = boundedString(payload.tool_name);
        if (raw === undefined)
            return undefined;
        candidate = /^mcp__kcoderag[-_]qa__([A-Za-z][A-Za-z0-9_]*)$/u.exec(raw)?.[1];
        if (candidate === undefined && host === "zcode") {
            candidate = /^(?:kcoderag[-_]qa|krag)[._/]([A-Za-z][A-Za-z0-9_]*)(?:\/[0-9]+)?$/u.exec(raw)?.[1];
        }
    }
    return candidate !== undefined && LOGICAL_TOOLS.has(candidate)
        ? candidate
        : undefined;
}
function inspectSuccessRecord(value) {
    if (!isRecord(value))
        return { failed: false, ambiguous: false };
    let failed = false;
    let ambiguous = false;
    for (const key of ["success", "ok"]) {
        if (value[key] !== undefined) {
            if (typeof value[key] !== "boolean")
                ambiguous = true;
            else if (value[key] === false)
                failed = true;
        }
    }
    if (value.is_error !== undefined) {
        if (typeof value.is_error !== "boolean")
            ambiguous = true;
        else if (value.is_error)
            failed = true;
    }
    for (const key of ["cancelled", "canceled", "timed_out"]) {
        if (value[key] !== undefined) {
            if (typeof value[key] !== "boolean")
                ambiguous = true;
            else if (value[key])
                failed = true;
        }
    }
    if (value.error !== undefined && value.error !== null && value.error !== false && value.error !== "") {
        failed = true;
    }
    if (value.status !== undefined) {
        if (typeof value.status !== "string" || value.status.length > 64)
            ambiguous = true;
        else {
            const status = value.status.toLowerCase();
            if (FAILURE_STATUSES.has(status))
                failed = true;
            else if (!SUCCESS_STATUSES.has(status))
                ambiguous = true;
        }
    }
    return { failed, ambiguous };
}
function reliableSuccess(payload, host) {
    if (!expectedEvent(payload, host))
        return false;
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
function indexList(value) {
    if (Array.isArray(value))
        return value.length <= MAX_INDEX_RECORDS ? value : undefined;
    if (!isRecord(value))
        return undefined;
    if (Array.isArray(value.indexes))
        return value.indexes.length <= MAX_INDEX_RECORDS ? value.indexes : undefined;
    return indexList(value.result);
}
function usableIndexResult(payload) {
    for (const candidate of [payload.tool_response, payload.result, payload.output]) {
        const indexes = indexList(candidate);
        if (indexes === undefined)
            continue;
        return indexes.some((entry) => {
            if (typeof entry === "string")
                return entry.length > 0 && entry.length <= 256;
            if (!isRecord(entry) || entry.enabled === false)
                return false;
            const status = typeof entry.status === "string" ? entry.status.toLowerCase() : "ready";
            return !["disabled", "error", "failed", "missing", "offline", "unavailable"].includes(status);
        });
    }
    return false;
}
/** Normalize only a known KCodeRag tool and a host-reliable completion outcome. */
function normalizeKCodeRagOutcome(payload, options) {
    try {
        if (!isRecord(payload))
            return undefined;
        const toolName = logicalToolName(payload, options.host);
        if (toolName === undefined)
            return undefined;
        const success = reliableSuccess(payload, options.host);
        return Object.freeze({
            toolName,
            success,
            usableIndex: success && toolName === "list_indexes" && usableIndexResult(payload),
        });
    }
    catch {
        return undefined;
    }
}
function submitted(payload, options) {
    return (0, once_marker_cjs_1.reminderClaimExists)(payload, {
        host: options.host,
        managedRoot: options.managedRoot,
        capability: "kcoderag-navigation",
        reminderKind: "feedback-submitted",
        ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
    });
}
/** True only for a successful usable list_indexes fact in this exact stable session. */
function indexAvailableForSession(payload, options) {
    return (0, once_marker_cjs_1.reminderClaimExists)(payload, {
        host: options.host,
        managedRoot: options.managedRoot,
        capability: "kcoderag-navigation",
        reminderKind: "index-available",
        ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
    });
}
/** Apply one reliable MCP transition; output is constant and all state is hash-addressed. */
function feedbackNudgeContribution(payload, options) {
    try {
        const outcome = normalizeKCodeRagOutcome(payload, options);
        if (outcome === undefined || !outcome.success)
            return undefined;
        const claimOptions = {
            host: options.host,
            managedRoot: options.managedRoot,
            capability: "kcoderag-navigation",
            ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
            ...(options.now === undefined ? {} : { now: options.now }),
        };
        if (outcome.toolName === "list_indexes") {
            if (outcome.usableIndex) {
                (0, once_marker_cjs_1.claimReminder)(payload, { ...claimOptions, reminderKind: "index-available" });
            }
            return undefined;
        }
        if (outcome.toolName === "submit_feedback") {
            (0, once_marker_cjs_1.claimReminder)(payload, { ...claimOptions, reminderKind: "feedback-submitted" });
            return undefined;
        }
        if (!RESULT_TOOLS.has(outcome.toolName) || submitted(payload, options))
            return undefined;
        const contextEpoch = (0, once_marker_cjs_1.contextEpochForSession)(payload, {
            host: options.host,
            managedRoot: options.managedRoot,
            capability: "kcoderag-navigation",
            source: "resume",
            ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
        });
        if (contextEpoch === undefined)
            return undefined;
        return (0, once_marker_cjs_1.claimReminder)(payload, {
            ...claimOptions,
            reminderKind: "feedback-reminded",
            contextEpoch,
        }).claimed
            ? exports.FEEDBACK_NUDGE
            : undefined;
    }
    catch {
        return undefined;
    }
}
