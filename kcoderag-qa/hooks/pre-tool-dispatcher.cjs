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
const fs = require("node:fs");
const path = require("node:path");
const code_style_nudge_cjs_1 = require("./code-style-nudge.cjs");
const once_marker_cjs_1 = require("./once-marker.cjs");
exports.MAX_ADDITIONAL_CONTEXT_CHARS = 600;
const MAX_INPUT_CHARS = 131_072;
const SESSION_START_SOURCES = new Set(["startup", "resume", "clear", "compact"]);
const NAVIGATION_CAPABILITY = "kcoderag-navigation";
const RECEIPT_PROVEN_CODE_STYLE_VERSION = "2.1.241";
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
        const contextEpoch = host === undefined || managedRoot === undefined || identity === undefined
            ? undefined
            : (0, once_marker_cjs_1.contextEpochForSession)(payload, {
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
function defaultStatePath(host, managedRoot) {
    const hostRoot = host === "codex" ? ".codex" : host === "claude" ? ".claude" :
        host === "cursor" ? ".cursor" : host === "opencode" ? ".opencode" : ".zcode";
    return path.join(managedRoot, hostRoot, "kcoderag-nav", "install-state.json");
}
function sessionStartNavigation(event, runtime) {
    if (event.eventName !== "SessionStart" || event.host === undefined ||
        event.managedRoot === undefined || event.contextEpoch === undefined)
        return undefined;
    const claim = (0, once_marker_cjs_1.claimReminder)(event.payload, {
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
function sessionStartCodeStyle(event, runtime, statePath) {
    if (event.eventName !== "SessionStart" || event.host === undefined ||
        event.managedRoot === undefined || event.contextEpoch === undefined)
        return undefined;
    if (runtime.hostVersion !== undefined &&
        (event.host !== "claude" || runtime.hostVersion !== RECEIPT_PROVEN_CODE_STYLE_VERSION))
        return undefined;
    if ((0, code_style_nudge_cjs_1.evaluateCodeStyleIntegrity)({
        host: event.host,
        managedRoot: event.managedRoot,
        ...(statePath === undefined ? {} : { statePath }),
    }).automaticNudge !== "available")
        return undefined;
    const claim = (0, once_marker_cjs_1.claimReminder)(event.payload, {
        host: event.host,
        managedRoot: event.managedRoot,
        capability: "code-style-nudge",
        reminderKind: "code-style",
        contextEpoch: event.contextEpoch,
        ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
        ...(runtime.now === undefined ? {} : { now: runtime.now }),
    });
    return claim.claimed
        ? "Code-style guidance is installed and integrity-verified; load $kcoderag-code-style before C/C++ or Lua edits."
        : undefined;
}
function updateOptions(runtime, statePath) {
    return {
        ...(runtime.installedVersion === undefined ? {} : { installedVersion: runtime.installedVersion }),
        ...(runtime.managedRoot === undefined ? {} : { cwd: runtime.managedRoot }),
        ...(statePath === undefined ? {} : { statePath }),
        ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
        ...(runtime.now === undefined ? {} : { now: runtime.now }),
        ...(runtime.updateSpawn === undefined ? {} : { spawn: runtime.updateSpawn }),
    };
}
function updateContribution(host, notice, additionalContext = notice) {
    // Codex formally renders systemMessage as a warning. Other hosts retain their own UI contracts.
    if (host !== "codex" || notice === undefined)
        return additionalContext;
    return Object.freeze({
        ...(additionalContext === undefined ? {} : { additionalContext }),
        systemMessage: (notice.match(/^KCodeRag Nav update available: [0-9]+[.][0-9]+[.][0-9]+ -> [0-9]+[.][0-9]+[.][0-9]+[.]/u)?.[0]
            ?? "KCodeRag Nav update available.") + " Use $kcoderag-update to review and install.",
    });
}
function sessionStartUpdate(event, runtime, statePath) {
    if (event.eventName !== "SessionStart" || event.host === undefined || updateNotice === undefined) {
        return undefined;
    }
    const options = updateOptions(runtime, statePath);
    const notice = updateNotice.readHostUpdateNotice(event.host, event.payload, options);
    updateNotice.scheduleHostUpdateRefresh(event.host, event.payload, options);
    return updateContribution(event.host, notice);
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
            return sessionStartNavigation(event, runtime);
        },
        (event) => {
            return sessionStartCodeStyle(event, runtime, statePath);
        },
        (event) => {
            return sessionStartUpdate(event, runtime, statePath);
        },
        (event) => {
            if (event.eventName !== "PreToolUse")
                return undefined;
            const noticeOptions = updateOptions(runtime, statePath);
            const notice = runtimeHost === undefined || managedRoot === undefined || updateNotice === undefined
                ? undefined
                : updateNotice.readHostUpdateNotice(runtimeHost, event.payload, noticeOptions);
            const contribution = navigation?.navigationContribution(event.payload, notice, runtimeHost === undefined || managedRoot === undefined
                ? undefined
                : {
                    host: runtimeHost,
                    managedRoot,
                    ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
                });
            if (runtimeHost !== undefined && managedRoot !== undefined && updateNotice !== undefined) {
                updateNotice.scheduleHostUpdateRefresh(runtimeHost, event.payload, noticeOptions);
            }
            return updateContribution(runtimeHost, notice, contribution);
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
        const contribution = event === undefined ? undefined : contributor(event);
        return typeof contribution === "string" ? contribution : contribution?.additionalContext;
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
    const messages = [];
    for (const contributor of contributors) {
        try {
            const contribution = contributor(event);
            const context = typeof contribution === "string" ? contribution : contribution?.additionalContext;
            if (typeof context === "string" && context.length > 0)
                contexts.push(context);
            const message = typeof contribution === "object" ? contribution?.systemMessage : undefined;
            if (event.host === "codex" &&
                (event.eventName === "SessionStart" || event.eventName === "PreToolUse") &&
                typeof message === "string" && message.length > 0)
                messages.push(message);
        }
        catch {
            continue;
        }
    }
    const response = responseForContexts(contexts, event.eventName);
    if (messages.length === 0)
        return response;
    return Object.freeze({
        ...response,
        systemMessage: messages.join("\n\n").slice(0, exports.MAX_ADDITIONAL_CONTEXT_CHARS),
    });
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
