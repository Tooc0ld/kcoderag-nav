#!/usr/bin/env node
"use strict";
/** Foreground-only update cache reader and detached refresh scheduler. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_SCHEMA_VERSION = exports.MAX_SESSION_MARKERS = exports.RENEWAL_TOKEN_TTL_MS = exports.SESSIONLESS_MARKER_TTL_MS = exports.CACHE_TTL_MS = void 0;
exports.readInstalledVersion = readInstalledVersion;
exports.readInstalledHost = readInstalledHost;
exports.isSimpleVersion = isSimpleVersion;
exports.readVersionStatus = readVersionStatus;
exports.readUpdateHint = readUpdateHint;
exports.scheduleRefresh = scheduleRefresh;
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
exports.CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
exports.SESSIONLESS_MARKER_TTL_MS = exports.CACHE_TTL_MS;
exports.RENEWAL_TOKEN_TTL_MS = 5 * 60 * 1_000;
exports.MAX_SESSION_MARKERS = 128;
exports.CACHE_SCHEMA_VERSION = 1;
const MAX_CACHE_CHARS = 8 * 1_024;
const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const RELEVANT_TOOLS = new Set(["Grep", "Glob", "Bash"]);
const UPDATE_HOSTS = new Set(["codex", "claude", "cursor", "opencode", "zcode"]);
function readInstalledState(statePath) {
    try {
        const raw = fs.readFileSync(statePath, "utf8");
        if (raw.length > 256 * 1_024)
            return undefined;
        const document = JSON.parse(raw);
        return isRecord(document) ? document : undefined;
    }
    catch {
        return undefined;
    }
}
function readInstalledVersion(statePath = path.resolve(__dirname, "..", "install-state.json")) {
    const document = readInstalledState(statePath);
    return document !== undefined && isSimpleVersion(document.packageVersion) ? document.packageVersion : undefined;
}
function readInstalledHost(statePath = path.resolve(__dirname, "..", "install-state.json")) {
    const host = readInstalledState(statePath)?.host;
    return typeof host === "string" && UPDATE_HOSTS.has(host) ? host : undefined;
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
    replace(filePath, contents) {
        const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
        let descriptor;
        try {
            descriptor = fs.openSync(temporaryPath, "wx", 0o600);
            fs.writeFileSync(descriptor, contents, { encoding: "utf8" });
            fs.fsyncSync(descriptor);
            fs.closeSync(descriptor);
            descriptor = undefined;
            fs.renameSync(temporaryPath, filePath);
        }
        catch (error) {
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
function updateCommand(host) {
    return host !== undefined && UPDATE_HOSTS.has(host)
        ? `npx kcoderag-nav@latest update --host ${host}`
        : "npx kcoderag-nav@latest update";
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
function sameVersion(left, right) {
    const leftParts = versionParts(left);
    const rightParts = versionParts(right);
    return leftParts !== undefined && rightParts !== undefined &&
        leftParts.every((part, index) => part === rightParts[index]);
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
/** Read a fresh, validated local cache without performing foreground network I/O. */
function readVersionStatus(installedVersion, options = {}) {
    const installed = isSimpleVersion(installedVersion) ? installedVersion : null;
    const unknown = (latest = undefined) => Object.freeze({
        installedVersion: installed,
        latestVersion: latest?.latest ?? null,
        versionStatus: "unknown",
        checkedAt: latest?.checkedAt ?? null,
    });
    try {
        if (process.env.KCODERAG_NAV_UPDATE_CHECK === "0")
            return unknown();
        const now = validNow(options.now);
        if (now === undefined)
            return unknown();
        const files = options.files ?? nodeFiles;
        const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
        const latest = readCache(files, cacheRoot);
        if (!isFresh(latest, now) || installed === null)
            return unknown();
        return Object.freeze({
            installedVersion: installed,
            latestVersion: latest.latest,
            versionStatus: isNewerVersion(installed, latest.latest)
                ? "update_available"
                : sameVersion(installed, latest.latest)
                    ? "up_to_date"
                    : "unknown",
            checkedAt: latest.checkedAt,
        });
    }
    catch {
        return unknown();
    }
}
function relevantPayload(value) {
    if (!isRecord(value))
        return false;
    if (value.hook_event_name === "SessionStart" &&
        (value.source === "startup" || value.source === "resume" || value.source === "clear" ||
            value.source === "compact")) {
        return ["session_id", "thread_id", "conversation_id"].some((field) => {
            const identity = value[field];
            return typeof identity === "string" && identity.length > 0 && identity.length <= 512 &&
                identity.trim().length > 0;
        });
    }
    return typeof value.tool_name === "string" && RELEVANT_TOOLS.has(value.tool_name) &&
        isRecord(value.tool_input);
}
function sessionMarker(payload) {
    let material;
    for (const field of ["session_id", "thread_id", "conversation_id"]) {
        const candidate = payload[field];
        if ((typeof candidate === "string" || typeof candidate === "number") && typeof candidate !== "boolean") {
            const exact = String(candidate);
            if (exact.length > 0 && exact.length <= 512 && exact.trim().length > 0) {
                material = `${field}\0${exact}`;
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
function renewalMarkerName(tokenName) {
    const match = /^renew-([a-f0-9]{64})-[a-f0-9]{64}\.claim$/u.exec(tokenName);
    return match === null ? undefined : `session-${match[1]}.seen`;
}
function pruneRenewalTokens(files, directoryPath, now) {
    const activeMarkers = new Set();
    const tokens = files.listFiles(directoryPath)
        .filter((entry) => renewalMarkerName(entry.name) !== undefined);
    for (const token of tokens) {
        const markerName = renewalMarkerName(token.name);
        if (markerName === undefined)
            continue;
        const tokenContents = files.readText(path.join(directoryPath, token.name));
        const markerContents = files.readText(path.join(directoryPath, markerName));
        const tokenFresh = Number.isFinite(token.mtimeMs) &&
            (token.mtimeMs > now || now - token.mtimeMs < exports.RENEWAL_TOKEN_TTL_MS);
        if (tokenContents !== undefined && markerContents === tokenContents && tokenFresh) {
            activeMarkers.add(markerName);
            continue;
        }
        try {
            files.remove(path.join(directoryPath, token.name));
        }
        catch { /* fail open */ }
    }
    return activeMarkers;
}
function pruneSessionMarkers(files, directoryPath, keepName, now) {
    const activeRenewals = pruneRenewalTokens(files, directoryPath, now);
    const markers = files.listFiles(directoryPath)
        .filter((entry) => entry.name.startsWith("session-") && entry.name.endsWith(".seen"));
    if (markers.length <= exports.MAX_SESSION_MARKERS)
        return;
    const removable = markers
        .filter((entry) => entry.name !== keepName && !activeRenewals.has(entry.name))
        .sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
    for (const entry of removable.slice(0, markers.length - exports.MAX_SESSION_MARKERS)) {
        try {
            files.remove(path.join(directoryPath, entry.name));
        }
        catch { /* fail open */ }
    }
    pruneRenewalTokens(files, directoryPath, now);
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
        const observedContents = files.readText(markerPath);
        const claimedAt = Number(observedContents);
        if (observedContents === undefined || !Number.isFinite(claimedAt) || claimedAt < 0 || now < claimedAt
            || now - claimedAt < exports.SESSIONLESS_MARKER_TTL_MS) {
            return false;
        }
        const observedDigest = crypto.createHash("sha256").update(observedContents, "utf8").digest("hex");
        const renewalPath = path.join(sessionsRoot, `renew-${marker.key}-${observedDigest}.claim`);
        pruneRenewalTokens(files, sessionsRoot, now);
        if (!files.createExclusive(renewalPath, observedContents))
            return false;
        if (files.readText(markerPath) !== observedContents) {
            try {
                files.remove(renewalPath);
            }
            catch { /* fail open */ }
            return false;
        }
        // Contenders for one expired generation share an exclusive token. The winner atomically
        // replaces that exact observed generation; delayed contenders re-read and fail closed.
        try {
            files.replace(markerPath, contents);
        }
        catch {
            const markerAfterFailure = files.readText(markerPath);
            if (markerAfterFailure === contents) {
                // The atomic replacement completed before the adapter reported failure.
                try {
                    files.remove(renewalPath);
                }
                catch { /* Mismatched contents make later pruning safe. */ }
            }
            else {
                if (markerAfterFailure === observedContents) {
                    // Nothing changed, so releasing our exact-generation token makes a later retry possible.
                    try {
                        files.remove(renewalPath);
                    }
                    catch { /* The bounded token lease recovers later. */ }
                }
                // A third state is genuinely ambiguous and keeps the token until marker change or lease expiry.
                return false;
            }
        }
        try {
            files.remove(renewalPath);
        }
        catch { /* stale token is safely pruned later */ }
    }
    try {
        pruneSessionMarkers(files, sessionsRoot, markerName, now);
    }
    catch {
        return false;
    }
    return true;
}
function readUpdateHint(installedVersion, options = {}) {
    try {
        const version = readVersionStatus(installedVersion, options);
        if (version.versionStatus !== "update_available" || version.latestVersion === null)
            return undefined;
        const now = validNow(options.now);
        if (now === undefined)
            return undefined;
        const files = options.files ?? nodeFiles;
        const cacheRoot = path.resolve(options.cacheRoot ?? defaultCacheRoot());
        if (options.hookPayload !== undefined) {
            if (!relevantPayload(options.hookPayload) || !claimSession(files, cacheRoot, options.hookPayload, now)) {
                return undefined;
            }
        }
        return `KCodeRag Nav update available: ${installedVersion} -> ${version.latestVersion}. ` +
            `Ask the user first; do not update automatically. Run: ${updateCommand(options.host)}`;
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
        const runtimePath = typeof options.runtimePath === "string" && options.runtimePath.length > 0
            ? options.runtimePath
            : process.execPath;
        const child = spawn(runtimePath, [workerPath, "--refresh", cacheRoot], {
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
