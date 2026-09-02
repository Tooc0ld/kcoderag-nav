#!/usr/bin/env node
"use strict";
/** Secret-free, bounded record of a successful KCodeRag MCP tool execution. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_MCP_CALL_MARKERS = exports.MCP_CALL_MARKER_TTL_MS = exports.MCP_CALL_MARKER_SCHEMA_VERSION = void 0;
exports.recordKCodeRagCall = recordKCodeRagCall;
exports.main = main;
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const feedback_nudge_cjs_1 = require("./feedback-nudge.cjs");
exports.MCP_CALL_MARKER_SCHEMA_VERSION = 3;
exports.MCP_CALL_MARKER_TTL_MS = 4 * 60 * 60 * 1_000;
exports.MAX_MCP_CALL_MARKERS = 128;
const MAX_INPUT_BYTES = 64 * 1_024;
const MAX_IDENTITY_CHARS = 4 * 1_024;
const MARKER_DIRECTORY = "mcp-calls";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedString(value) {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTITY_CHARS
        ? value
        : undefined;
}
function defaultCacheRoot() {
    if (process.platform === "win32") {
        return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "kcoderag-nav");
    }
    return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "kcoderag-nav");
}
const nodeFiles = {
    ensureDirectory(directoryPath) {
        fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
    },
    createExclusive(filePath, contents) {
        let descriptor;
        try {
            descriptor = fs.openSync(filePath, "wx", 0o600);
            fs.writeFileSync(descriptor, contents, "utf8");
            fs.fsyncSync(descriptor);
            fs.closeSync(descriptor);
            descriptor = undefined;
            return true;
        }
        catch (error) {
            if (descriptor !== undefined) {
                try {
                    fs.closeSync(descriptor);
                }
                catch { /* fail open */ }
                try {
                    fs.unlinkSync(filePath);
                }
                catch { /* fail open */ }
            }
            if (error.code === "EEXIST")
                return false;
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
        }
        catch (error) {
            if (error.code === "ENOENT")
                return [];
            throw error;
        }
    },
    remove(filePath) {
        try {
            fs.unlinkSync(filePath);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
    },
};
function identity(payload, host, cwd, toolName) {
    const session = boundedString(payload.session_id) ??
        boundedString(payload.conversation_id) ??
        boundedString(payload.sessionID);
    const call = boundedString(payload.tool_use_id) ??
        boundedString(payload.tool_call_id) ??
        boundedString(payload.callID) ??
        boundedString(payload.generation_id);
    const turn = boundedString(payload.turn_id);
    const fallback = boundedString(cwd);
    const sessionIdentity = session ?? fallback;
    if (sessionIdentity === undefined)
        return undefined;
    if (call !== undefined) {
        return { raw: `${host}\0call\0${sessionIdentity}\0${call}\0${toolName}`, scope: "call" };
    }
    return turn !== undefined
        ? { raw: `${host}\0turn\0${sessionIdentity}\0${turn}\0${toolName}`, scope: "turn" }
        : { raw: `${host}\0session\0${sessionIdentity}\0${toolName}`, scope: "session" };
}
function structuredResultValid(payload) {
    if (payload.structuredResultValid !== undefined)
        return payload.structuredResultValid === true;
    let remaining = 128;
    const inspect = (value, depth) => {
        if (remaining <= 0 || depth > 6 || !isRecord(value))
            return false;
        remaining -= 1;
        for (const [key, child] of Object.entries(value).slice(0, 64)) {
            if ((key === "structuredContent" || key === "structured_content") && isRecord(child))
                return true;
            if (["tool_response", "result", "output", "metadata", "data", "response"].includes(key)
                && inspect(child, depth + 1))
                return true;
        }
        return false;
    };
    return [payload.tool_response, payload.result, payload.output].some((value) => inspect(value, 0));
}
function markerName(rawIdentity) {
    return `${crypto.createHash("sha256").update(rawIdentity).digest("hex")}.json`;
}
function prune(files, directoryPath, keepName, now) {
    const candidates = files.listFiles(directoryPath)
        .filter((entry) => /^[0-9a-f]{64}\.json$/u.test(entry.name) && entry.name !== keepName)
        .sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
    for (const [index, entry] of candidates.entries()) {
        if (now - entry.mtimeMs > exports.MCP_CALL_MARKER_TTL_MS || index >= exports.MAX_MCP_CALL_MARKERS - 1) {
            files.remove(path.join(directoryPath, entry.name));
        }
    }
}
/** Record only metadata required to recognize a same-session/turn local verification. */
function recordKCodeRagCall(payload, options) {
    try {
        if (!isRecord(payload)) {
            return Object.freeze({ recorded: false });
        }
        const outcome = (0, feedback_nudge_cjs_1.normalizeKCodeRagOutcome)(payload, { host: options.host });
        if (outcome?.success !== true)
            return Object.freeze({ recorded: false });
        const now = options.now?.() ?? Date.now();
        if (!Number.isFinite(now) || now < 0)
            return Object.freeze({ recorded: false });
        const markerIdentity = identity(payload, options.host, options.cwd ?? process.cwd(), outcome.toolName);
        if (markerIdentity === undefined)
            return Object.freeze({ recorded: false });
        const files = options.files ?? nodeFiles;
        const directoryPath = path.join(options.cacheRoot ?? defaultCacheRoot(), MARKER_DIRECTORY);
        const name = markerName(markerIdentity.raw);
        files.ensureDirectory(directoryPath);
        files.createExclusive(path.join(directoryPath, name), `${JSON.stringify({
            schemaVersion: exports.MCP_CALL_MARKER_SCHEMA_VERSION,
            host: options.host,
            scope: markerIdentity.scope,
            toolName: outcome.toolName,
            structuredResultValid: structuredResultValid(payload),
            recordedAt: now,
        })}\n`);
        prune(files, directoryPath, name, now);
        return Object.freeze({ recorded: true, key: name.slice(0, -5) });
    }
    catch {
        return Object.freeze({ recorded: false });
    }
}
function readBoundedStdin() {
    const chunks = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(8 * 1_024);
    try {
        while (true) {
            const count = fs.readSync(0, buffer, 0, buffer.length, null);
            if (count === 0)
                break;
            total += count;
            if (total > MAX_INPUT_BYTES)
                return undefined;
            chunks.push(Buffer.from(buffer.subarray(0, count)));
        }
        return Buffer.concat(chunks).toString("utf8");
    }
    catch {
        return undefined;
    }
}
/** Host hook entry point. It always emits nothing and exits successfully. */
function main(hostArgument = process.argv[2]) {
    try {
        if (!["codex", "claude", "cursor", "opencode", "zcode"].includes(hostArgument))
            return 0;
        const raw = readBoundedStdin();
        if (raw === undefined)
            return 0;
        let payload;
        try {
            payload = JSON.parse(raw);
        }
        catch {
            return 0;
        }
        recordKCodeRagCall(payload, { host: hostArgument });
    }
    catch {
        // Marker failures must never affect the host tool result.
    }
    return 0;
}
if (require.main === module)
    process.exitCode = main();
exports.recordKCodeRagCall = recordKCodeRagCall;
exports.main = main;
