#!/usr/bin/env node
"use strict";
/** Receipt-gated exact-lane cleanup for code-style once claims; unsupported events retain markers. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionEndCleanupProven = sessionEndCleanupProven;
exports.cleanupSessionClaim = cleanupSessionClaim;
exports.main = main;
const fs = require("node:fs");
const path = require("node:path");
const once_marker_cjs_1 = require("./once-marker.cjs");
const MAX_INPUT_CHARS = 131_072;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** No checked-in delivery receipt currently proves stable-identity SessionEnd parity. */
function sessionEndCleanupProven(_host) {
    return false;
}
function removeExactFile(filePath) {
    try {
        fs.unlinkSync(filePath);
        return true;
    }
    catch {
        return false;
    }
}
function cleanupSessionClaim(payload, options) {
    try {
        if (!isRecord(payload) || payload.hook_event_name !== "SessionEnd")
            return false;
        const identity = (0, once_marker_cjs_1.stableSessionIdentity)(payload);
        if (identity === undefined)
            return false;
        const isProven = options.receiptProvesSessionEnd ??
            ((host) => sessionEndCleanupProven(host));
        if (!isProven(options.host, identity.field))
            return false;
        const keys = [...(0, once_marker_cjs_1.reminderMarkerKeysForSession)(payload, options)];
        const legacyKey = (0, once_marker_cjs_1.nudgeMarkerKey)(payload, options);
        if (legacyKey !== undefined && !keys.includes(legacyKey))
            keys.push(legacyKey);
        if (keys.length === 0)
            return false;
        const remove = options.remove ?? removeExactFile;
        let removed = false;
        for (const key of keys) {
            const markerPath = path.join(path.resolve(options.cacheRoot), "nudges", `${key}.claim`);
            try {
                removed = remove(markerPath) || removed;
            }
            catch {
                continue;
            }
        }
        return removed;
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
function main(rawInput) {
    try {
        const raw = rawInput ?? readBoundedStdin();
        if (raw.length === 0 || raw.length > MAX_INPUT_CHARS)
            return 0;
        JSON.parse(raw);
    }
    catch {
        return 0;
    }
    return 0;
}
if (require.main === module)
    process.exitCode = main();
