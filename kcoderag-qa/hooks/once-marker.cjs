#!/usr/bin/env node
"use strict";
/** Stable-session-only zero-byte once claims for advisory capability nudges. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_NUDGE_MARKERS = void 0;
exports.stableSessionIdentity = stableSessionIdentity;
exports.nudgeMarkerKey = nudgeMarkerKey;
exports.reminderMarkerKey = reminderMarkerKey;
exports.claimReminder = claimReminder;
exports.reminderClaimExists = reminderClaimExists;
exports.contextEpochForSession = contextEpochForSession;
exports.reminderMarkerKeysForSession = reminderMarkerKeysForSession;
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
const MAX_CONTEXT_EPOCH = 1_023;
const HOSTS = new Set(["codex", "claude", "cursor", "opencode", "zcode"]);
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
    createExclusive(filePath, contents = "") {
        let descriptor;
        try {
            descriptor = fs.openSync(filePath, "wx", 0o600);
            if (contents.length > 0)
                fs.writeFileSync(descriptor, contents, { encoding: "utf8" });
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
        (options.capability === "code-style-nudge" || options.capability === "kcoderag-navigation") &&
        normalizedManagedRoot(options.managedRoot) !== undefined;
}
function nudgeMarkerKey(payload, options) {
    const identity = stableSessionIdentity(payload);
    const managedRoot = normalizedManagedRoot(options.managedRoot);
    if (identity === undefined || managedRoot === undefined ||
        options.capability !== "code-style-nudge" || !validScope(options))
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
function validContextEpoch(value) {
    if (value === undefined || value.length === 0 || value.length > 128 || value.includes("\0"))
        return false;
    return /^(?:0|[1-9][0-9]{0,3})$/u.test(value) && Number(value) <= MAX_CONTEXT_EPOCH;
}
function sessionScoped(kind) {
    return kind === "feedback-submitted" || kind === "index-available";
}
function reminderMarkerKey(payload, options) {
    const identity = stableSessionIdentity(payload);
    const managedRoot = normalizedManagedRoot(options.managedRoot);
    if (identity === undefined || managedRoot === undefined || !validScope(options))
        return undefined;
    const scope = sessionScoped(options.reminderKind) ? "session" : options.contextEpoch;
    if (scope === undefined || (scope !== "session" && !validContextEpoch(scope)))
        return undefined;
    const material = [
        "kcoderag-nav-reminder-v2",
        options.host,
        managedRoot,
        options.capability,
        identity.field,
        identity.value,
        scope,
        options.reminderKind,
    ].join("\0");
    return crypto.createHash("sha256").update(material, "utf8").digest("hex");
}
function markerRecord(options, now) {
    if (!Number.isFinite(now) || now < 0)
        return undefined;
    return `${JSON.stringify({
        schemaVersion: 1,
        host: options.host,
        capability: options.capability,
        reminderKind: options.reminderKind,
        scope: sessionScoped(options.reminderKind) ? "session" : "epoch",
        recordedAt: now,
    })}\n`;
}
function claimKey(key, contents, options) {
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
        let markerPath;
        try {
            const names = files.listFiles(directoryPath);
            const markerName = `${key}.claim`;
            if (names.includes(markerName))
                return suppressed(key);
            if (names.filter((name) => MARKER_NAME_RE.test(name)).length >= exports.MAX_NUDGE_MARKERS) {
                return suppressed(key);
            }
            markerPath = path.join(directoryPath, markerName);
            claimed = files.createExclusive(markerPath, contents);
        }
        finally {
            try {
                files.remove(lockPath);
                lockReleased = true;
            }
            catch {
                lockReleased = false;
                if (claimed && markerPath !== undefined) {
                    try {
                        files.remove(markerPath);
                    }
                    catch { /* fail open */ }
                    claimed = false;
                }
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
function claimReminder(payload, options) {
    const key = reminderMarkerKey(payload, options);
    if (key === undefined)
        return suppressed();
    const record = markerRecord(options, options.now?.() ?? Date.now());
    return record === undefined ? suppressed(key) : claimKey(key, record, options);
}
/** Read only one exact hash-addressed claim and reject malformed or tampered metadata. */
function reminderClaimExists(payload, options) {
    const key = reminderMarkerKey(payload, options);
    if (key === undefined)
        return false;
    try {
        const filePath = path.join(path.resolve(options.cacheRoot ?? defaultCacheRoot()), NUDGE_DIRECTORY, `${key}.claim`);
        const metadata = fs.lstatSync(filePath);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > 512) {
            return false;
        }
        const raw = fs.readFileSync(filePath, "utf8");
        const record = JSON.parse(raw);
        const expectedScope = sessionScoped(options.reminderKind) ? "session" : "epoch";
        return isRecord(record) &&
            Object.keys(record).sort().join("\0") ===
                "capability\0host\0recordedAt\0reminderKind\0schemaVersion\0scope" &&
            record.schemaVersion === 1 &&
            record.host === options.host &&
            record.capability === options.capability &&
            record.reminderKind === options.reminderKind &&
            record.scope === expectedScope &&
            typeof record.recordedAt === "number" && Number.isFinite(record.recordedAt) &&
            record.recordedAt >= 0;
    }
    catch {
        return false;
    }
}
function epochStateKey(payload, options) {
    const identity = stableSessionIdentity(payload);
    const managedRoot = normalizedManagedRoot(options.managedRoot);
    if (identity === undefined || managedRoot === undefined || !validScope(options))
        return undefined;
    return crypto.createHash("sha256").update([
        "kcoderag-nav-epoch-v1",
        options.host,
        managedRoot,
        options.capability,
        identity.field,
        identity.value,
    ].join("\0"), "utf8").digest("hex");
}
function readEpochState(filePath) {
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        if (raw.length === 0 || raw.length > 256)
            return undefined;
        const value = JSON.parse(raw);
        if (!isRecord(value) || Object.keys(value).sort().join(",") !== "generation,schemaVersion" ||
            value.schemaVersion !== 1 || !Number.isSafeInteger(value.generation) ||
            value.generation < 0 || value.generation > MAX_CONTEXT_EPOCH)
            return undefined;
        return value.generation;
    }
    catch {
        return undefined;
    }
}
function writeEpochState(filePath, generation) {
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    try {
        descriptor = fs.openSync(temporaryPath, "wx", 0o600);
        fs.writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: 1, generation })}\n`, "utf8");
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        fs.renameSync(temporaryPath, filePath);
        return true;
    }
    catch {
        if (descriptor !== undefined) {
            try {
                fs.closeSync(descriptor);
            }
            catch { /* fail open */ }
        }
        try {
            fs.unlinkSync(temporaryPath);
        }
        catch { /* fail open */ }
        return false;
    }
}
/** Resolve one bounded epoch per stable session; only clear/compact advance it. */
function contextEpochForSession(payload, options) {
    const key = epochStateKey(payload, options);
    if (key === undefined)
        return undefined;
    const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
    const directoryPath = path.join(cacheRoot, NUDGE_DIRECTORY);
    const statePath = path.join(directoryPath, `${key}.epoch.json`);
    const lockPath = path.join(directoryPath, `${key}.epoch.lock`);
    try {
        fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
        const current = readEpochState(statePath);
        if (options.source === "startup" || options.source === "resume") {
            if (current !== undefined)
                return String(current);
            try {
                fs.writeFileSync(statePath, `${JSON.stringify({ schemaVersion: 1, generation: 0 })}\n`, {
                    flag: "wx",
                    mode: 0o600,
                });
                return "0";
            }
            catch (error) {
                if (error.code === "EEXIST") {
                    const raced = readEpochState(statePath);
                    return raced === undefined ? undefined : String(raced);
                }
                return undefined;
            }
        }
        let lock;
        try {
            lock = fs.openSync(lockPath, "wx", 0o600);
            const observed = readEpochState(statePath) ?? 0;
            const next = observed + 1;
            if (next > MAX_CONTEXT_EPOCH || !writeEpochState(statePath, next))
                return undefined;
            return String(next);
        }
        finally {
            if (lock !== undefined) {
                try {
                    fs.closeSync(lock);
                }
                catch { /* fail open */ }
                try {
                    fs.unlinkSync(lockPath);
                }
                catch { /* fail open */ }
            }
        }
    }
    catch {
        return undefined;
    }
}
/** Enumerate only bounded keys derivable from one exact stable session identity. */
function reminderMarkerKeysForSession(payload, options) {
    const epochKey = epochStateKey(payload, options);
    if (epochKey === undefined)
        return Object.freeze([]);
    const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
    const statePath = path.join(cacheRoot, NUDGE_DIRECTORY, `${epochKey}.epoch.json`);
    const generation = readEpochState(statePath) ?? 0;
    const keys = [];
    const epochKinds = options.capability === "code-style-nudge"
        ? ["code-style"]
        : ["navigation", "feedback-reminded"];
    for (let epoch = 0; epoch <= generation; epoch += 1) {
        for (const reminderKind of epochKinds) {
            const key = reminderMarkerKey(payload, {
                ...options,
                reminderKind,
                contextEpoch: String(epoch),
            });
            if (key !== undefined)
                keys.push(key);
        }
    }
    if (options.capability === "kcoderag-navigation") {
        for (const reminderKind of ["feedback-submitted", "index-available"]) {
            const key = reminderMarkerKey(payload, { ...options, reminderKind });
            if (key !== undefined)
                keys.push(key);
        }
    }
    return Object.freeze(keys);
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
        let markerPath;
        try {
            const names = files.listFiles(directoryPath);
            const markerName = `${key}.claim`;
            if (names.includes(markerName))
                return suppressed(key);
            if (names.filter((name) => MARKER_NAME_RE.test(name)).length >= exports.MAX_NUDGE_MARKERS) {
                return suppressed(key);
            }
            markerPath = path.join(directoryPath, markerName);
            claimed = files.createExclusive(markerPath);
        }
        finally {
            try {
                files.remove(lockPath);
                lockReleased = true;
            }
            catch {
                lockReleased = false;
                if (claimed && markerPath !== undefined) {
                    try {
                        files.remove(markerPath);
                    }
                    catch { /* fail open */ }
                    claimed = false;
                }
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
