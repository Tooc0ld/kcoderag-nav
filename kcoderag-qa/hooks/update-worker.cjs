#!/usr/bin/env node
"use strict";
/** Detached, bounded npm Registry update-cache worker. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RESPONSE_BYTES = exports.REQUEST_TIMEOUT_MS = exports.REGISTRY_URL = void 0;
exports.refreshLatest = refreshLatest;
exports.main = main;
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");
const updateCheck = require("./update-check.cjs");
exports.REGISTRY_URL = "https://registry.npmjs.org/kcoderag-nav";
exports.REQUEST_TIMEOUT_MS = 1_500;
exports.MAX_RESPONSE_BYTES = 256 * 1_024;
const REFRESH_LOCK_STALE_MS = 10_000;
const EXPECTED_CONTENT_TYPES = ["application/json", "application/vnd.npm.install-v1+json"];
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorCode(error) {
    return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}
function validNow(clock) {
    const value = clock === undefined ? Date.now() : clock();
    return Number.isFinite(value) && value >= 0 ? value : undefined;
}
function headerValue(value) {
    return typeof value === "string" ? value : value?.join(",") ?? "";
}
function validateLatest(response) {
    if (response.statusCode !== 200 ||
        response.url !== exports.REGISTRY_URL ||
        response.body.length > exports.MAX_RESPONSE_BYTES)
        return undefined;
    const contentType = headerValue(response.headers["content-type"]).toLowerCase();
    if (!EXPECTED_CONTENT_TYPES.some((expected) => contentType === expected || contentType.startsWith(`${expected};`))) {
        return undefined;
    }
    let document;
    try {
        document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body));
    }
    catch {
        return undefined;
    }
    if (!isRecord(document) || document.name !== "kcoderag-nav" || !isRecord(document["dist-tags"])) {
        return undefined;
    }
    const latest = document["dist-tags"].latest;
    return updateCheck.isSimpleVersion(latest) ? latest : undefined;
}
async function defaultRequest(url, options) {
    if (url !== exports.REGISTRY_URL || new URL(url).protocol !== "https:")
        throw new Error("invalid_registry_url");
    return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, response) => {
            if (settled)
                return;
            settled = true;
            if (error !== undefined)
                reject(error);
            else if (response !== undefined)
                resolve(response);
            else
                reject(new Error("empty_registry_response"));
        };
        const request = https.get(url, {
            headers: options.headers,
            signal: AbortSignal.timeout(options.timeoutMs),
            agent: false,
        }, (response) => {
            const contentLength = Number(response.headers["content-length"] ?? 0);
            if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
                response.destroy(new Error("registry_response_too_large"));
                return;
            }
            const chunks = [];
            let total = 0;
            response.on("data", (chunk) => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                total += buffer.length;
                if (total > options.maxBytes) {
                    response.destroy(new Error("registry_response_too_large"));
                    return;
                }
                chunks.push(buffer);
            });
            response.on("error", (error) => { finish(error); });
            response.on("end", () => {
                finish(undefined, {
                    statusCode: response.statusCode ?? 0,
                    url,
                    headers: response.headers,
                    body: Buffer.concat(chunks, total),
                });
            });
        });
        request.setTimeout(options.timeoutMs, () => { request.destroy(new Error("registry_timeout")); });
        request.on("error", (error) => { finish(error); });
    });
}
async function writeCacheAtomically(cacheRoot, cache) {
    await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(cacheRoot, `.remote-cache-${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`);
    let handle;
    try {
        handle = await fs.open(temporaryPath, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify(cache)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await fs.rename(temporaryPath, path.join(cacheRoot, "remote-cache.json"));
    }
    catch (error) {
        if (handle !== undefined) {
            try {
                await handle.close();
            }
            catch { /* fail open */ }
        }
        try {
            await fs.unlink(temporaryPath);
        }
        catch { /* fail open */ }
        throw error;
    }
}
async function claimRefreshLock(cacheRoot, now) {
    await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
    const lockPath = path.join(cacheRoot, "refresh.lock");
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = crypto.randomBytes(16).toString("hex");
        let handle;
        let created = false;
        try {
            handle = await fs.open(lockPath, "wx", 0o600);
            created = true;
            await handle.writeFile(token, "ascii");
            await handle.sync();
            await handle.close();
            handle = undefined;
            const timestamp = new Date(now);
            await fs.utimes(lockPath, timestamp, timestamp);
            return { path: lockPath, token };
        }
        catch (error) {
            if (handle !== undefined) {
                try {
                    await handle.close();
                }
                catch { /* fail open */ }
            }
            if (created)
                try {
                    await fs.unlink(lockPath);
                }
                catch { /* fail open */ }
            if (errorCode(error) !== "EEXIST")
                throw error;
            let age;
            try {
                age = now - (await fs.stat(lockPath)).mtimeMs;
            }
            catch (statError) {
                if (errorCode(statError) === "ENOENT")
                    continue;
                throw statError;
            }
            if (attempt > 0 || !Number.isFinite(age) || age <= REFRESH_LOCK_STALE_MS)
                return undefined;
            try {
                await fs.unlink(lockPath);
            }
            catch (unlinkError) {
                if (errorCode(unlinkError) !== "ENOENT")
                    return undefined;
            }
        }
    }
    return undefined;
}
async function ownsLock(claim) {
    try {
        return await fs.readFile(claim.path, "ascii") === claim.token;
    }
    catch {
        return false;
    }
}
async function releaseLock(claim) {
    try {
        if (await ownsLock(claim))
            await fs.unlink(claim.path);
    }
    catch {
        // A failed cleanup must never surface through the detached worker boundary.
    }
}
async function refreshLatest(options) {
    let claim;
    try {
        const now = validNow(options.now);
        if (now === undefined || !path.isAbsolute(options.cacheRoot))
            return false;
        claim = await claimRefreshLock(options.cacheRoot, now);
        if (claim === undefined)
            return false;
        const response = await (options.request ?? defaultRequest)(exports.REGISTRY_URL, {
            timeoutMs: exports.REQUEST_TIMEOUT_MS,
            maxBytes: exports.MAX_RESPONSE_BYTES,
            headers: {
                accept: "application/vnd.npm.install-v1+json, application/json",
                "user-agent": "kcoderag-nav-update-check/1",
            },
        });
        const latest = validateLatest(response);
        if (latest === undefined || !await ownsLock(claim))
            return false;
        await (options.writeCache ?? writeCacheAtomically)(options.cacheRoot, {
            schemaVersion: updateCheck.CACHE_SCHEMA_VERSION,
            checkedAt: now,
            latest,
        });
        return true;
    }
    catch {
        return false;
    }
    finally {
        if (claim !== undefined)
            await releaseLock(claim);
    }
}
async function main(argv = process.argv.slice(2)) {
    try {
        if (argv.length !== 2 || argv[0] !== "--refresh" || argv[1] === undefined || !path.isAbsolute(argv[1])) {
            return 0;
        }
        await refreshLatest({ cacheRoot: argv[1] });
    }
    catch {
        // The worker is advisory and never owns the host tool's success or output.
    }
    return 0;
}
if (require.main === module) {
    void main().then((exitCode) => { process.exitCode = exitCode; }).catch(() => { process.exitCode = 0; });
}
