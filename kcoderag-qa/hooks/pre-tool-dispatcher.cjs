#!/usr/bin/env node
"use strict";
/** One bounded hook-event dispatcher; every contributor and output boundary fails open. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ADDITIONAL_CONTEXT_CHARS = void 0;
exports.normalizeHookEvent = normalizeHookEvent;
exports.createDefaultContributors = createDefaultContributors;
exports.dispatchHookEvent = dispatchHookEvent;
exports.dispatchPayload = dispatchPayload;
exports.dispatchRawInput = dispatchRawInput;
exports.main = main;
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const code_style_nudge_cjs_1 = require("./code-style-nudge.cjs");
const once_marker_cjs_1 = require("./once-marker.cjs");
exports.MAX_ADDITIONAL_CONTEXT_CHARS = 600;
const MAX_INPUT_CHARS = 131_072;
const MAX_EPOCH_CHARS = 128;
const SESSION_START_SOURCES = new Set(["startup", "resume", "clear", "compact"]);
const NAVIGATION_CAPABILITY = "kcoderag-navigation";
const SESSION_START_BASELINE = "Use KCodeRag for structural code navigation before broad local search. " +
    "Prefer search_code, context, and get_call_chain; use local tools for exact verification.";
const navigation = (() => {
    try {
        return require("./grep-nudge.cjs");
    }
    catch {
        return undefined;
    }
})();
const updateNotice = (() => {
    try {
        return require("./update-notice.cjs");
    }
    catch {
        return undefined;
    }
})();
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isHost(value) {
    return value === "codex" || value === "claude" || value === "cursor" ||
        value === "opencode" || value === "zcode";
}
function eventName(payload) {
    const explicit = payload.hook_event_name;
    if (explicit === "SessionStart" || explicit === "SessionEnd" ||
        explicit === "PreToolUse" || explicit === "PostToolUse") {
        return explicit;
    }
    return typeof payload.tool_name === "string" || typeof payload.tool === "string"
        ? "PreToolUse"
        : undefined;
}
function boundedEpoch(value) {
    if (typeof value === "string" && value.length > 0 && value.length <= MAX_EPOCH_CHARS) {
        return value;
    }
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        return String(value);
    }
    return undefined;
}
/** Normalize only documented, bounded lifecycle fields; opaque identities remain byte-distinct. */
function normalizeHookEvent(payload, runtime = {}) {
    if (!isRecord(payload))
        return undefined;
    const normalizedName = eventName(payload);
    if (normalizedName === undefined)
        return undefined;
    const host = isHost(runtime.host) ? runtime.host : undefined;
    const managedRoot = typeof runtime.managedRoot === "string" && runtime.managedRoot.length > 0
        ? runtime.managedRoot
        : undefined;
    const identity = (0, once_marker_cjs_1.stableSessionIdentity)(payload);
    if (normalizedName === "SessionStart") {
        const rawSource = payload.source;
        if (typeof rawSource !== "string" || !SESSION_START_SOURCES.has(rawSource))
            return undefined;
        const source = rawSource;
        const contextEpoch = boundedEpoch(payload.context_epoch) ?? source;
        return Object.freeze({
            eventName: normalizedName,
            payload,
            ...(host === undefined ? {} : { host }),
            ...(managedRoot === undefined ? {} : { managedRoot }),
            ...(identity === undefined ? {} : { stableSession: identity }),
            source,
            contextEpoch,
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
function defaultStatePath(host, managedRoot) {
    const hostRoot = host === "codex" ? ".codex" : host === "claude" ? ".claude" :
        host === "cursor" ? ".cursor" : host === "opencode" ? ".opencode" : ".zcode";
    return path.join(managedRoot, hostRoot, "kcoderag-nav", "install-state.json");
}
function normalizedManagedRoot(value) {
    if (value.length === 0 || value.length > 4_096 || value.includes("\0") || !path.isAbsolute(value)) {
        return undefined;
    }
    const normalized = path.normalize(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function sessionStartReminderKey(event) {
    if (event.eventName !== "SessionStart" || event.host === undefined ||
        event.managedRoot === undefined || event.stableSession === undefined ||
        event.contextEpoch === undefined) {
        return undefined;
    }
    const root = normalizedManagedRoot(event.managedRoot);
    if (root === undefined)
        return undefined;
    const material = [
        "kcoderag-nav-reminder-v2",
        event.host,
        root,
        NAVIGATION_CAPABILITY,
        event.stableSession.field,
        event.stableSession.value,
        event.contextEpoch,
        "navigation",
    ].join("\0");
    return crypto.createHash("sha256").update(material, "utf8").digest("hex");
}
function claimSessionStart(event, runtime) {
    const key = sessionStartReminderKey(event);
    if (key === undefined || event.host === undefined || event.managedRoot === undefined)
        return false;
    // The reusable governor lands in Task 2. Until then, feed the already-secret
    // tuple digest into the existing exclusive, bounded once-claim primitive.
    return (0, once_marker_cjs_1.claimNudgeOnce)({ session_id: key }, {
        host: event.host,
        managedRoot: event.managedRoot,
        capability: "code-style-nudge",
        ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
    }).claimed;
}
function createDefaultEventContributors(runtime = {}) {
    const runtimeHost = isHost(runtime.host) ? runtime.host : undefined;
    const managedRoot = typeof runtime.managedRoot === "string" && runtime.managedRoot.length > 0
        ? runtime.managedRoot
        : undefined;
    const statePath = runtimeHost !== undefined && managedRoot !== undefined
        ? runtime.statePath ?? defaultStatePath(runtimeHost, managedRoot)
        : undefined;
    return Object.freeze([
        (event) => {
            if (event.eventName !== "SessionStart")
                return undefined;
            return claimSessionStart(event, runtime) ? SESSION_START_BASELINE : undefined;
        },
        (event) => {
            if (event.eventName !== "PreToolUse")
                return undefined;
            const noticeOptions = {
                ...(managedRoot === undefined ? {} : { cwd: managedRoot }),
                ...(statePath === undefined ? {} : { statePath }),
            };
            const notice = runtimeHost === undefined || managedRoot === undefined || updateNotice === undefined
                ? undefined
                : updateNotice.readHostUpdateNotice(runtimeHost, event.payload, noticeOptions);
            const contribution = navigation?.navigationContribution(event.payload, notice);
            if (runtimeHost !== undefined && managedRoot !== undefined && updateNotice !== undefined) {
                updateNotice.scheduleHostUpdateRefresh(runtimeHost, event.payload, noticeOptions);
            }
            return contribution;
        },
        (event) => {
            if (event.eventName !== "PreToolUse" || runtimeHost === undefined || managedRoot === undefined) {
                return undefined;
            }
            return (0, code_style_nudge_cjs_1.codeStyleContribution)(event.payload, {
                host: runtimeHost,
                managedRoot,
                ...(statePath === undefined ? {} : { statePath }),
                ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
            });
        },
    ]);
}
function createDefaultContributors(runtime = {}) {
    const contributors = createDefaultEventContributors(runtime);
    return Object.freeze(contributors.map((contributor) => (payload) => {
        const event = normalizeHookEvent({ ...payload, hook_event_name: "PreToolUse" }, runtime);
        return event === undefined ? undefined : contributor(event);
    }));
}
function responseForContexts(contexts, hookEventName) {
    if (contexts.length === 0)
        return undefined;
    const additionalContext = contexts.join("\n\n").slice(0, exports.MAX_ADDITIONAL_CONTEXT_CHARS);
    if (additionalContext.length === 0)
        return undefined;
    return Object.freeze({
        hookSpecificOutput: Object.freeze({
            hookEventName,
            additionalContext,
        }),
    });
}
function dispatchHookEvent(event, contributors = createDefaultEventContributors({
    ...(event.host === undefined ? {} : { host: event.host }),
    ...(event.managedRoot === undefined ? {} : { managedRoot: event.managedRoot }),
})) {
    const contexts = [];
    for (const contributor of contributors) {
        try {
            const context = contributor(event);
            if (typeof context === "string" && context.length > 0)
                contexts.push(context);
        }
        catch {
            continue;
        }
    }
    return responseForContexts(contexts, event.eventName);
}
function dispatchPayload(payload, contributors = createDefaultContributors()) {
    const contexts = [];
    for (const contributor of contributors) {
        try {
            const context = contributor(payload);
            if (typeof context === "string" && context.length > 0)
                contexts.push(context);
        }
        catch {
            continue;
        }
    }
    return responseForContexts(contexts, "PreToolUse");
}
function dispatchRawInput(rawInput, contributors, parseInput = JSON.parse, runtime = {}) {
    if (rawInput.length === 0 || rawInput.length > MAX_INPUT_CHARS)
        return undefined;
    try {
        const payload = parseInput(rawInput);
        if (!isRecord(payload))
            return undefined;
        if (contributors !== undefined)
            return dispatchPayload(payload, contributors);
        const event = normalizeHookEvent(payload, runtime);
        return event === undefined
            ? undefined
            : dispatchHookEvent(event, createDefaultEventContributors(runtime));
    }
    catch {
        return undefined;
    }
}
function readBoundedStdin() {
    const chunks = [];
    let total = 0;
    while (total <= MAX_INPUT_CHARS) {
        const buffer = Buffer.allocUnsafe(Math.min(8_192, MAX_INPUT_CHARS + 1 - total));
        const count = fs.readSync(0, buffer, 0, buffer.length, null);
        if (count === 0)
            break;
        chunks.push(buffer.subarray(0, count));
        total += count;
    }
    return total > MAX_INPUT_CHARS ? "" : Buffer.concat(chunks, total).toString("utf8");
}
function main(rawInput, writeOutput = (text) => { process.stdout.write(text); }, contributors, runtime = {}) {
    try {
        const output = dispatchRawInput(rawInput ?? readBoundedStdin(), contributors, JSON.parse, runtime);
        if (output !== undefined)
            writeOutput(JSON.stringify(output));
    }
    catch {
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
    process.exitCode = main(undefined, (text) => { process.stdout.write(text); }, undefined, host === undefined || managedRoot === undefined ? {} : { host, managedRoot });
}
