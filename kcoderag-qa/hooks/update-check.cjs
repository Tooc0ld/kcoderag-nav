#!/usr/bin/env node
"use strict";
/** Foreground-only update cache reader and detached refresh scheduler. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_SCHEMA_VERSION = exports.MAX_SESSION_MARKERS = exports.SESSIONLESS_MARKER_TTL_MS = exports.CACHE_TTL_MS = void 0;
exports.readInstalledVersion = readInstalledVersion;
exports.isSimpleVersion = isSimpleVersion;
exports.readUpdateHint = readUpdateHint;
exports.scheduleRefresh = scheduleRefresh;
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
exports.CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
exports.SESSIONLESS_MARKER_TTL_MS = exports.CACHE_TTL_MS;
exports.MAX_SESSION_MARKERS = 128;
exports.CACHE_SCHEMA_VERSION = 1;
const MAX_CACHE_CHARS = 8 * 1_024;
const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const RELEVANT_TOOLS = new Set(["Grep", "Glob", "Bash"]);
function readInstalledVersion(statePath = path.resolve(__dirname, "..", "install-state.json")) {
    try {
        const raw = fs.readFileSync(statePath, "utf8");
        if (raw.length > 256 * 1_024)
            return undefined;
        const document = JSON.parse(raw);
        return isRecord(document) && isSimpleVersion(document.packageVersion) ? document.packageVersion : undefined;
    }
    catch {
        return undefined;
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function defaultCacheRoot() {
    if (process.platform === "win32") {
        return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "kcoderag-nav");
    }
    return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "kcoderag-nav");
}
const nodeFiles = {
    readText(filePath) {
        try {
            const contents = fs.readFileSync(filePath, "utf8");
            return contents.length <= MAX_CACHE_CHARS ? contents : undefined;
        }
        catch (error) {
            if (error.code === "ENOENT")
                return undefined;
            throw error;
        }
    },
    ensureDirectory(directoryPath) {
        fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
    },
    createExclusive(filePath, contents) {
        let descriptor;
        try {
            descriptor = fs.openSync(filePath, "wx", 0o600);
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
function validNow(clock) {
    const value = clock === undefined ? Date.now() : clock();
    return Number.isFinite(value) && value >= 0 ? value : undefined;
}
function versionParts(version) {
    if (version === undefined)
        return undefined;
    const match = VERSION_RE.exec(version);
    if (match === null)
        return undefined;
    const parts = match.slice(1).map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part)))
        return undefined;
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}
function isSimpleVersion(version) {
    return typeof version === "string" && versionParts(version) !== undefined;
}
function isNewerVersion(installed, latest) {
    const left = versionParts(installed);
    const right = versionParts(latest);
    if (left === undefined || right === undefined)
        return false;
    for (let index = 0; index < left.length; index += 1) {
        if ((right[index] ?? 0) > (left[index] ?? 0))
            return true;
        if ((right[index] ?? 0) < (left[index] ?? 0))
            return false;
    }
    return false;
}
function readCache(files, cacheRoot) {
    const raw = files.readText(path.join(cacheRoot, "remote-cache.json"));
    if (raw === undefined || raw.length > MAX_CACHE_CHARS)
        return undefined;
    const document = JSON.parse(raw);
    if (!isRecord(document) ||
        Object.keys(document).sort().join(",") !== "checkedAt,latest,schemaVersion" ||
        document.schemaVersion !== exports.CACHE_SCHEMA_VERSION ||
        typeof document.checkedAt !== "number" ||
        !Number.isFinite(document.checkedAt) ||
        document.checkedAt < 0 ||
        !isSimpleVersion(document.latest))
        return undefined;
    return { checkedAt: document.checkedAt, latest: document.latest };
}
function isFresh(cache, now) {
    return cache !== undefined && now >= cache.checkedAt && now - cache.checkedAt < exports.CACHE_TTL_MS;
}
function relevantPayload(value) {
    return isRecord(value) && typeof value.tool_name === "string" && RELEVANT_TOOLS.has(value.tool_name) &&
        isRecord(value.tool_input);
}
function sessionMarker(payload) {
    let material;
    for (const field of ["session_id", "thread_id", "conversation_id"]) {
        const candidate = payload[field];
        if ((typeof candidate === "string" || typeof candidate === "number") && typeof candidate !== "boolean") {
            const normalized = String(candidate).trim().slice(0, 512);
            if (normalized.length > 0) {
                material = `${field}\0${normalized}`;
                break;
            }
        }
    }
    if (material === undefined) {
        const candidate = payload.cwd;
        const cwd = typeof candidate === "string" || typeof candidate === "number" ? String(candidate) : ".";
        const normalized = path.normalize(cwd.trim().slice(0, 2_048) || ".").toLowerCase();
        material = `fallback\0${normalized}`;
    }
    return {
        key: crypto.createHash("sha256").update(material, "utf8").digest("hex"),
        sessionless: material.startsWith("fallback\0"),
    };
}
function pruneSessionMarkers(files, directoryPath, keepName) {
    const markers = files.listFiles(directoryPath)
        .filter((entry) => entry.name.startsWith("session-") && entry.name.endsWith(".seen"));
    if (markers.length <= exports.MAX_SESSION_MARKERS)
        return;
    const removable = markers
        .filter((entry) => entry.name !== keepName)
        .sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
    for (const entry of removable.slice(0, markers.length - exports.MAX_SESSION_MARKERS)) {
        try {
            files.remove(path.join(directoryPath, entry.name));
        }
        catch { /* fail open */ }
    }
}
function claimSession(files, cacheRoot, hookPayload, now) {
    const sessionsRoot = path.join(cacheRoot, "sessions");
    files.ensureDirectory(sessionsRoot);
    const marker = sessionMarker(hookPayload);
    const markerName = `session-${marker.key}.seen`;
    const markerPath = path.join(sessionsRoot, markerName);
    const contents = marker.sessionless ? String(now) : "";
    if (!files.createExclusive(markerPath, contents)) {
        if (!marker.sessionless)
            return false;
        const claimedAt = Number(files.readText(markerPath));
        if (!Number.isFinite(claimedAt) || claimedAt < 0 || now < claimedAt
            || now - claimedAt < exports.SESSIONLESS_MARKER_TTL_MS) {
            return false;
        }
        // A protocol without a session ID gets a stable project marker. Its lifetime is anchored to
        // the first claim instead of a wall-clock bucket, so crossing an hour cannot reschedule work.
        files.remove(markerPath);
        if (!files.createExclusive(markerPath, contents))
            return false;
    }
    try {
        pruneSessionMarkers(files, sessionsRoot, markerName);
    }
    catch {
        return false;
    }
    return true;
}
function readUpdateHint(installedVersion, options = {}) {
    try {
        if (process.env.KCODERAG_NAV_UPDATE_CHECK === "0" || !isSimpleVersion(installedVersion))
            return undefined;
        const now = validNow(options.now);
        if (now === undefined)
            return undefined;
        const files = options.files ?? nodeFiles;
        const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
        const latest = readCache(files, cacheRoot);
        if (!isFresh(latest, now))
            return undefined;
        if (options.hookPayload !== undefined) {
            if (!relevantPayload(options.hookPayload) || !claimSession(files, cacheRoot, options.hookPayload, now)) {
                return undefined;
            }
        }
        if (!isNewerVersion(installedVersion, latest.latest))
            return undefined;
        return `KCodeRag Nav update available: ${installedVersion} -> ${latest.latest}. ` +
            "Ask the user first; do not update automatically. Run: npx kcoderag-nav@latest update";
    }
    catch {
        return undefined;
    }
}
function scheduleRefresh(hookPayload, options = {}) {
    try {
        if (process.env.KCODERAG_NAV_UPDATE_CHECK === "0" || !relevantPayload(hookPayload))
            return false;
        const now = validNow(options.now);
        if (now === undefined)
            return false;
        const files = options.files ?? nodeFiles;
        const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
        if (isFresh(readCache(files, cacheRoot), now))
            return false;
        if (!claimSession(files, cacheRoot, hookPayload, now))
            return false;
        const spawn = options.spawn ?? childProcess.spawn;
        const workerPath = path.resolve(options.workerPath ?? path.join(__dirname, "update-worker.cjs"));
        const child = spawn(process.execPath, [workerPath, "--refresh", cacheRoot], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
        });
        child.unref?.();
        return true;
    }
    catch {
        return false;
    }
}
