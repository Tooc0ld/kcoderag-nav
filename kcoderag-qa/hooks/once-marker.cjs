#!/usr/bin/env node
"use strict";
/** Stable-session-only zero-byte once claims for advisory capability nudges. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_NUDGE_MARKERS = void 0;
exports.stableSessionIdentity = stableSessionIdentity;
exports.nudgeMarkerKey = nudgeMarkerKey;
exports.claimNudgeOnce = claimNudgeOnce;
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
exports.MAX_NUDGE_MARKERS = 1_024;
const NUDGE_DIRECTORY = "nudges";
const CAPACITY_LOCK = ".capacity.lock";
const MAX_STABLE_ID_CHARS = 512;
const MAX_MANAGED_ROOT_CHARS = 4_096;
const MARKER_NAME_RE = /^[0-9a-f]{64}\.claim$/u;
const HOSTS = new Set(["codex", "claude", "cursor", "opencode"]);
const STABLE_FIELDS = Object.freeze([
    "session_id",
    "thread_id",
    "conversation_id",
]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function defaultCacheRoot() {
    if (process.platform === "win32") {
        return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "kcoderag-nav");
    }
    return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "kcoderag-nav");
}
const nodeFiles = Object.freeze({
    ensureDirectory(directoryPath) {
        fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
    },
    createExclusive(filePath) {
        let descriptor;
        try {
            descriptor = fs.openSync(filePath, "wx", 0o600);
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
                .map((entry) => entry.name);
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
});
function stableSessionIdentity(payload) {
    if (!isRecord(payload))
        return undefined;
    for (const field of STABLE_FIELDS) {
        const value = payload[field];
        if (typeof value === "string" &&
            value.length > 0 &&
            value.length <= MAX_STABLE_ID_CHARS &&
            value.trim().length > 0) {
            return Object.freeze({ field, value });
        }
    }
    return undefined;
}
function normalizedManagedRoot(value) {
    if (value.length === 0 ||
        value.length > MAX_MANAGED_ROOT_CHARS ||
        value.includes("\0") ||
        !path.isAbsolute(value)) {
        return undefined;
    }
    const normalized = path.normalize(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function validScope(options) {
    return HOSTS.has(options.host) &&
        options.capability === "jx3-style-nudge" &&
        normalizedManagedRoot(options.managedRoot) !== undefined;
}
function nudgeMarkerKey(payload, options) {
    const identity = stableSessionIdentity(payload);
    const managedRoot = normalizedManagedRoot(options.managedRoot);
    if (identity === undefined || managedRoot === undefined || !validScope(options))
        return undefined;
    const material = [
        "kcoderag-nav-nudge-v1",
        options.host,
        managedRoot,
        options.capability,
        identity.field,
        identity.value,
    ].join("\0");
    return crypto.createHash("sha256").update(material, "utf8").digest("hex");
}
function suppressed(key) {
    return key === undefined
        ? Object.freeze({ claimed: false })
        : Object.freeze({ claimed: false, key });
}
function claimNudgeOnce(payload, options) {
    const key = nudgeMarkerKey(payload, options);
    if (key === undefined)
        return suppressed();
    try {
        const files = options.files ?? nodeFiles;
        const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
        const directoryPath = path.join(cacheRoot, NUDGE_DIRECTORY);
        files.ensureDirectory(directoryPath);
        const lockPath = path.join(directoryPath, CAPACITY_LOCK);
        if (!files.createExclusive(lockPath))
            return suppressed(key);
        let claimed = false;
        let lockReleased = false;
        try {
            const names = files.listFiles(directoryPath);
            const markerName = `${key}.claim`;
            if (names.includes(markerName))
                return suppressed(key);
            if (names.filter((name) => MARKER_NAME_RE.test(name)).length >= exports.MAX_NUDGE_MARKERS) {
                return suppressed(key);
            }
            claimed = files.createExclusive(path.join(directoryPath, markerName));
        }
        finally {
            try {
                files.remove(lockPath);
                lockReleased = true;
            }
            catch {
                lockReleased = false;
            }
        }
        return claimed && lockReleased
            ? Object.freeze({ claimed: true, key })
            : suppressed(key);
    }
    catch {
        return suppressed(key);
    }
}
