#!/usr/bin/env node
"use strict";
/** Host protocol adapters over the shared offline update cache and detached worker. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hostPayload = hostPayload;
exports.readHostUpdateNotice = readHostUpdateNotice;
exports.scheduleHostUpdateRefresh = scheduleHostUpdateRefresh;
exports.main = main;
const fs = require("node:fs");
const updateCheck = require("./update-check.cjs");
const HOSTS = new Set(["codex", "claude", "cursor", "opencode", "zcode"]);
const MAX_INPUT_CHARS = 64 * 1_024;
const MAX_ID_CHARS = 512;
const MAX_CONTEXT_CHARS = 600;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedIdentity(value) {
    if (typeof value !== "string" && typeof value !== "number")
        return undefined;
    const normalized = String(value).trim().slice(0, MAX_ID_CHARS);
    return normalized.length > 0 ? normalized : undefined;
}
function sessionIdentity(host, payload) {
    const fields = host === "opencode"
        ? ["sessionID", "session_id", "conversation_id", "thread_id"]
        : ["session_id", "conversation_id", "thread_id", "sessionID"];
    for (const field of fields) {
        const identity = boundedIdentity(payload[field]);
        if (identity !== undefined)
            return `${host}:${identity}`;
    }
    return undefined;
}
function boundedCwd(value, fallback) {
    const candidate = typeof value === "string" ? value.trim() : "";
    return (candidate.length > 0 ? candidate : fallback).slice(0, 2_048);
}
function hostPayload(host, payload, cwd = process.cwd()) {
    if (!HOSTS.has(host) || !isRecord(payload))
        return undefined;
    const identity = sessionIdentity(host, payload);
    const normalizedCwd = boundedCwd(payload.cwd, cwd);
    return {
        tool_name: "Bash",
        tool_input: {},
        ...(identity === undefined ? {} : { session_id: identity }),
        cwd: identity === undefined ? `[${host}]${normalizedCwd}` : normalizedCwd,
    };
}
function installedVersion(options, runtime) {
    return options.installedVersion ?? runtime.readInstalledVersion(options.statePath);
}
function readHostUpdateNotice(host, payload, options = {}) {
    try {
        const runtime = options.updateRuntime ?? updateCheck;
        const version = installedVersion(options, runtime);
        const normalized = hostPayload(host, payload, options.cwd);
        if (version === undefined || normalized === undefined)
            return undefined;
        return runtime.readUpdateHint(version, { hookPayload: normalized, host });
    }
    catch {
        return undefined;
    }
}
function scheduleHostUpdateRefresh(host, payload, options = {}) {
    try {
        const runtime = options.updateRuntime ?? updateCheck;
        const version = installedVersion(options, runtime);
        const normalized = hostPayload(host, payload, options.cwd);
        if (version === undefined || normalized === undefined)
            return false;
        return runtime.scheduleRefresh(normalized, {
            host,
            ...(options.runtimePath === undefined ? {} : { runtimePath: options.runtimePath }),
        });
    }
    catch {
        return false;
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
function main(argv = process.argv.slice(2), rawInput, writeOutput = (text) => { process.stdout.write(text); }, options = {}) {
    try {
        if (argv.length !== 1 || argv[0] !== "cursor")
            return 0;
        const raw = rawInput ?? readBoundedStdin();
        if (raw.length === 0 || raw.length > MAX_INPUT_CHARS)
            return 0;
        const payload = JSON.parse(raw);
        const notice = readHostUpdateNotice("cursor", payload, options);
        if (notice !== undefined) {
            writeOutput(JSON.stringify({ additional_context: notice.slice(0, MAX_CONTEXT_CHARS) }));
        }
        scheduleHostUpdateRefresh("cursor", payload, options);
    }
    catch {
        return 0;
    }
    return 0;
}
if (require.main === module)
    process.exitCode = main();
