#!/usr/bin/env node
"use strict";
/** Single bounded PreToolUse dispatcher; every contributor and output boundary fails open. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ADDITIONAL_CONTEXT_CHARS = void 0;
exports.createDefaultContributors = createDefaultContributors;
exports.dispatchPayload = dispatchPayload;
exports.dispatchRawInput = dispatchRawInput;
exports.main = main;
const fs = require("node:fs");
const jx3_style_nudge_cjs_1 = require("./jx3-style-nudge.cjs");
exports.MAX_ADDITIONAL_CONTEXT_CHARS = 600;
const MAX_INPUT_CHARS = 131_072;
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
    return value === "codex" || value === "claude" || value === "cursor" || value === "opencode";
}
function defaultStatePath(host, managedRoot) {
    const hostRoot = host === "codex" ? ".codex" : host === "claude" ? ".claude" :
        host === "cursor" ? ".cursor" : ".opencode";
    return require("node:path").join(managedRoot, hostRoot, "kcoderag-nav", "install-state.json");
}
function createDefaultContributors(runtime = {}) {
    const runtimeHost = isHost(runtime.host) ? runtime.host : undefined;
    const managedRoot = typeof runtime.managedRoot === "string" && runtime.managedRoot.length > 0
        ? runtime.managedRoot
        : undefined;
    const statePath = runtimeHost !== undefined && managedRoot !== undefined
        ? runtime.statePath ?? defaultStatePath(runtimeHost, managedRoot)
        : undefined;
    return Object.freeze([
        (payload) => {
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
        (payload) => {
            if (runtimeHost === undefined || managedRoot === undefined)
                return undefined;
            return (0, jx3_style_nudge_cjs_1.jx3StyleContribution)(payload, {
                host: runtimeHost,
                managedRoot,
                ...(statePath === undefined ? {} : { statePath }),
                ...(runtime.cacheRoot === undefined ? {} : { cacheRoot: runtime.cacheRoot }),
            });
        },
    ]);
}
function responseForContexts(contexts) {
    if (contexts.length === 0)
        return undefined;
    const additionalContext = contexts.join("\n\n").slice(0, exports.MAX_ADDITIONAL_CONTEXT_CHARS);
    if (additionalContext.length === 0)
        return undefined;
    return Object.freeze({
        hookSpecificOutput: Object.freeze({
            hookEventName: "PreToolUse",
            additionalContext,
        }),
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
    return responseForContexts(contexts);
}
function dispatchRawInput(rawInput, contributors, parseInput = JSON.parse, runtime = {}) {
    if (rawInput.length === 0 || rawInput.length > MAX_INPUT_CHARS)
        return undefined;
    try {
        const payload = parseInput(rawInput);
        return isRecord(payload)
            ? dispatchPayload(payload, contributors ?? createDefaultContributors(runtime))
            : undefined;
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
if (require.main === module)
    process.exitCode = main();
