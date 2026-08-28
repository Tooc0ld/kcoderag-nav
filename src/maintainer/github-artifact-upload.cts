/** Upload one readiness-owned tgz directly to the job-scoped GitHub Actions artifact service. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const releaseReadiness = require("./release-readiness.cjs") as typeof import("./release-readiness.cjs");

import type {
  CandidatePackageArtifactLease,
} from "./release-readiness.cjs";

type JsonMap = Record<string, unknown>;

export interface GitHubArtifactUploadOptions {
  readonly runtimeToken?: string;
  readonly resultsUrl?: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
  readonly blockSizeBytes?: number;
  readonly maxAttempts?: number;
  readonly cleanupTimeoutMs?: number;
  readonly maxArtifactBytes?: number;
}

export interface GitHubArtifactUploadReceipt {
  readonly artifactId: string;
  readonly name: string;
  readonly sha256: string;
  readonly memberCount: number;
  readonly size: number;
}

export type GitHubArtifactUploadStage =
  | "create_artifact"
  | "stage_block"
  | "commit_block_list"
  | "finalize_artifact";

export type GitHubArtifactUploadStatusClass =
  | "network"
  | "timeout"
  | "3xx"
  | "4xx"
  | "408"
  | "429"
  | "5xx"
  | "other";

interface BackendIds {
  readonly workflowRunBackendId: string;
  readonly workflowJobRunBackendId: string;
}

const ARTIFACT_SERVICE = "github.actions.results.api.v1.ArtifactService";
const MAX_CONTROL_RESPONSE_BYTES = 64 * 1024;
const MAX_TOKEN_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const AZURE_STORAGE_VERSION = "2021-12-02";
const DEFAULT_BLOCK_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_BLOCK_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_BLOCK_COUNT = 128;
const BLOCK_ID_WIDTH = 8;
const MAX_SIGNED_URL_BYTES = 16 * 1024;
const MAX_OPERATION_URL_BYTES = 24 * 1024;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS = 5;
const DEFAULT_CLEANUP_TIMEOUT_MS = 1_000;
const MAX_CLEANUP_TIMEOUT_MS = 5_000;
const MAX_TOTAL_DATA_REQUESTS = 512;
const MAX_TOTAL_TIMEOUT_BUDGET_MS = 2 * 60 * 60 * 1_000;
const BACKEND_ID_RE = /^[A-Za-z0-9._-]{1,128}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ARTIFACT_ID_RE = /^[1-9][0-9]{0,30}$/u;

export class GitHubArtifactUploadError extends Error {
  readonly code: string;
  readonly stage: GitHubArtifactUploadStage | undefined;
  readonly statusClass: GitHubArtifactUploadStatusClass | undefined;

  constructor(code: string, metadata: {
    readonly stage?: GitHubArtifactUploadStage;
    readonly statusClass?: GitHubArtifactUploadStatusClass;
  } = {}) {
    super(code);
    this.name = "GitHubArtifactUploadError";
    this.code = code;
    this.stage = metadata.stage;
    this.statusClass = metadata.statusClass;
  }
}

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new GitHubArtifactUploadError(code);
}

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is JsonMap {
  return isRecord(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function decodeBackendIds(token: string): BackendIds {
  failUnless(token.length > 0 && Buffer.byteLength(token, "utf8") <= MAX_TOKEN_BYTES,
    "artifact_auth_invalid");
  const segments = token.split(".");
  failUnless(segments.length === 3 && segments.every((segment) => segment.length > 0),
    "artifact_auth_invalid");
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(segments[1] as string, "base64url").toString("utf8"));
  } catch {
    throw new GitHubArtifactUploadError("artifact_auth_invalid");
  }
  failUnless(isRecord(payload) && typeof payload.scp === "string", "artifact_auth_invalid");
  const resultsScopes = payload.scp.split(" ").filter((scope) => scope.startsWith("Actions.Results:"));
  failUnless(resultsScopes.length === 1, "artifact_auth_invalid");
  const parts = (resultsScopes[0] as string).split(":");
  failUnless(
    parts.length === 3
      && parts[0] === "Actions.Results"
      && BACKEND_ID_RE.test(parts[1] as string)
      && BACKEND_ID_RE.test(parts[2] as string),
    "artifact_auth_invalid",
  );
  return Object.freeze({
    workflowRunBackendId: parts[1] as string,
    workflowJobRunBackendId: parts[2] as string,
  });
}

function resultsOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new GitHubArtifactUploadError("artifact_auth_invalid");
  }
  const hostname = parsed.hostname.toLowerCase();
  failUnless(
    parsed.protocol === "https:"
      && parsed.username.length === 0
      && parsed.password.length === 0
      && parsed.search.length === 0
      && parsed.hash.length === 0
      && (hostname === "actions.githubusercontent.com" || hostname.endsWith(".actions.githubusercontent.com")),
    "artifact_auth_invalid",
  );
  return parsed.origin;
}

function signedBlobUrl(value: unknown): URL {
  failUnless(typeof value === "string" && value.length > 0 && value.length <= MAX_SIGNED_URL_BYTES,
    "artifact_service_invalid");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new GitHubArtifactUploadError("artifact_service_invalid");
  }
  const hostname = parsed.hostname.toLowerCase();
  failUnless(
    parsed.protocol === "https:"
      && parsed.username.length === 0
      && parsed.password.length === 0
      && parsed.hash.length === 0
      && parsed.searchParams.getAll("sig").length === 1
      && (parsed.searchParams.get("sig") ?? "").length > 0
      && !parsed.searchParams.has("comp")
      && !parsed.searchParams.has("blockid")
      && (hostname.endsWith(".blob.core.windows.net") || hostname.endsWith(".blob.storage.azure.net")),
    "artifact_service_invalid",
  );
  return parsed;
}

function statusClass(status: number): GitHubArtifactUploadStatusClass {
  if (status === 408) return "408";
  if (status === 429) return "429";
  if (status >= 300 && status <= 399) return "3xx";
  if (status >= 400 && status <= 499) return "4xx";
  if (status >= 500 && status <= 599) return "5xx";
  return "other";
}

function blockId(index: number): string {
  failUnless(Number.isSafeInteger(index) && index >= 0 && index < MAX_BLOCK_COUNT,
    "artifact_metadata_drift");
  return Buffer.from(index.toString(10).padStart(BLOCK_ID_WIDTH, "0"), "ascii").toString("base64");
}

function blockPlan(
  bytes: Buffer,
  blockSizeBytes: number,
  maxArtifactBytes: number,
  maxAttempts: number,
  timeoutMs: number,
): readonly { readonly id: string; readonly body: Buffer }[] {
  failUnless(bytes.length > 0 && bytes.length <= maxArtifactBytes, "artifact_metadata_drift");
  const count = Math.ceil(bytes.length / blockSizeBytes);
  failUnless(count > 0 && count <= MAX_BLOCK_COUNT, "artifact_metadata_drift");
  failUnless(
    (count + 1) * maxAttempts <= MAX_TOTAL_DATA_REQUESTS
      && (count + 1) * maxAttempts * timeoutMs <= MAX_TOTAL_TIMEOUT_BUDGET_MS,
    "artifact_metadata_drift",
  );
  const blocks = Array.from({ length: count }, (_, index) => Object.freeze({
    id: blockId(index),
    body: bytes.subarray(index * blockSizeBytes, Math.min(bytes.length, (index + 1) * blockSizeBytes)),
  }));
  const decodedLengths = new Set(blocks.map((block) => Buffer.from(block.id, "base64").length));
  failUnless(
    new Set(blocks.map((block) => block.id)).size === blocks.length
      && decodedLengths.size === 1
      && blocks.every((block, index) =>
        block.body.length > 0
          && Buffer.from(block.id, "base64").toString("ascii") === index.toString(10).padStart(BLOCK_ID_WIDTH, "0")),
    "artifact_metadata_drift",
  );
  return Object.freeze(blocks);
}

function operationUrl(signed: URL, operation: "block" | "blocklist", id?: string): string {
  const target = new URL(signed.href);
  target.searchParams.append("comp", operation);
  if (id !== undefined) target.searchParams.append("blockid", id);
  failUnless(target.href.length <= MAX_OPERATION_URL_BYTES, "artifact_service_invalid");
  return target.href;
}

function blockListBody(ids: readonly string[]): Buffer {
  failUnless(ids.length > 0 && ids.length <= MAX_BLOCK_COUNT && new Set(ids).size === ids.length,
    "artifact_metadata_drift");
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?><BlockList>${ids.map((id) => `<Latest>${id}</Latest>`).join("")}</BlockList>`,
    "utf8",
  );
}

async function dataPlanePut(
  fetcher: typeof fetch,
  url: string,
  body: Buffer,
  contentType: string,
  stage: "stage_block" | "commit_block_list",
  timeoutMs: number,
  maxAttempts: number,
  cleanupTimeoutMs: number,
): Promise<void> {
  const init: RequestInit = {
    method: "PUT",
    headers: {
      "content-length": String(body.length),
      "content-type": contentType,
      "x-ms-version": AZURE_STORAGE_VERSION,
    },
    body: body as unknown as BodyInit,
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal: controller.signal, redirect: "manual" });
    } catch (error) {
      const classification: GitHubArtifactUploadStatusClass = timedOut
        || error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : "network";
      if (attempt < maxAttempts) continue;
      throw new GitHubArtifactUploadError("artifact_upload_failed", {
        stage,
        statusClass: classification,
      });
    } finally {
      clearTimeout(timeout);
    }
    const classification = response.ok ? undefined : statusClass(response.status);
    await cancelDataPlaneResponse(response, cleanupTimeoutMs);
    if (response.ok) return;
    if (classification !== undefined && retryableStatusClass(classification) && attempt < maxAttempts) continue;
    throw new GitHubArtifactUploadError("artifact_upload_failed", {
      stage,
      ...(classification === undefined ? {} : { statusClass: classification }),
    });
  }
  throw new GitHubArtifactUploadError("artifact_upload_failed", { stage, statusClass: "other" });
}

function retryableStatusClass(value: GitHubArtifactUploadStatusClass): boolean {
  return value === "network" || value === "timeout" || value === "408" || value === "429" || value === "5xx";
}

async function cancelDataPlaneResponse(response: Response, cleanupTimeoutMs: number): Promise<void> {
  if (response.body === null) return;
  let cancellation: Promise<unknown>;
  try {
    cancellation = Promise.resolve(response.body.cancel());
  } catch {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      cancellation.catch(() => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, cleanupTimeoutMs); }),
    ]);
  } catch {
    // Data-plane response content is never authoritative and never enters diagnostics.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  failUnless(contentType.toLowerCase().startsWith("application/json"), "artifact_service_invalid");
  failUnless(response.body !== null, "artifact_service_invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      failUnless(length <= MAX_CONTROL_RESPONSE_BYTES, "artifact_service_invalid");
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  failUnless(length > 0, "artifact_service_invalid");
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length).toString("utf8"));
  } catch {
    throw new GitHubArtifactUploadError("artifact_service_invalid");
  }
}

async function fetchBounded(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  stage?: GitHubArtifactUploadStage,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal, redirect: "error" });
  } catch (error) {
    throw new GitHubArtifactUploadError("artifact_upload_failed", {
      ...(stage === undefined ? {} : { stage }),
      statusClass: timedOut || error instanceof Error && error.name === "AbortError" ? "timeout" : "network",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function artifactControlRequest(
  fetcher: typeof fetch,
  origin: string,
  token: string,
  method: "CreateArtifact" | "FinalizeArtifact" | "DeleteArtifact",
  body: JsonMap,
  timeoutMs: number,
): Promise<unknown> {
  const stage = method === "CreateArtifact"
    ? "create_artifact"
    : method === "FinalizeArtifact"
      ? "finalize_artifact"
      : undefined;
  const response = await fetchBounded(
    fetcher,
    `${origin}/twirp/${ARTIFACT_SERVICE}/${method}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "kcoderag-nav-readiness/0.3.0",
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
    stage,
  );
  if (!response.ok) {
    await cancelDataPlaneResponse(response, Math.min(timeoutMs, DEFAULT_CLEANUP_TIMEOUT_MS));
    throw new GitHubArtifactUploadError("artifact_upload_failed", {
      ...(stage === undefined ? {} : { stage }),
      statusClass: statusClass(response.status),
    });
  }
  return readBoundedJson(response);
}

async function deletePartialArtifact(
  fetcher: typeof fetch,
  origin: string,
  token: string,
  ids: BackendIds,
  name: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await artifactControlRequest(fetcher, origin, token, "DeleteArtifact", {
      workflowRunBackendId: ids.workflowRunBackendId,
      workflowJobRunBackendId: ids.workflowJobRunBackendId,
      name,
    }, timeoutMs);
  } catch {
    // The original stable upload failure wins; cleanup remains best effort and secret-free.
  }
}

/** Consume the private candidate bytes once and finalize one immutable raw-file Actions artifact. */
export async function uploadCandidateArtifactFromLease(
  lease: CandidatePackageArtifactLease,
  options: GitHubArtifactUploadOptions = {},
): Promise<GitHubArtifactUploadReceipt> {
  const runtimeToken = options.runtimeToken ?? process.env.ACTIONS_RUNTIME_TOKEN ?? "";
  const origin = resultsOrigin(options.resultsUrl ?? process.env.ACTIONS_RESULTS_URL ?? "");
  const ids = decodeBackendIds(runtimeToken);
  const fetcher = options.fetcher ?? globalThis.fetch;
  failUnless(typeof fetcher === "function", "artifact_auth_invalid");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const blockSizeBytes = options.blockSizeBytes ?? DEFAULT_BLOCK_SIZE_BYTES;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  const maxArtifactBytes = options.maxArtifactBytes ?? MAX_ARTIFACT_BYTES;
  failUnless(
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 300_000
      && Number.isSafeInteger(blockSizeBytes) && blockSizeBytes >= 1 && blockSizeBytes <= MAX_BLOCK_SIZE_BYTES
      && Number.isSafeInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= MAX_ATTEMPTS
      && Number.isSafeInteger(cleanupTimeoutMs) && cleanupTimeoutMs >= 1
      && cleanupTimeoutMs <= MAX_CLEANUP_TIMEOUT_MS
      && Number.isSafeInteger(maxArtifactBytes) && maxArtifactBytes >= 1
      && maxArtifactBytes <= MAX_ARTIFACT_BYTES
      && timeoutMs * maxAttempts <= MAX_TOTAL_TIMEOUT_BUDGET_MS,
    "artifact_auth_invalid");

  return releaseReadiness.withCandidatePackageBytes(lease, "workflow-upload", async (bytes, artifact) => {
    const name = `${artifact.name}-${artifact.version}.tgz`;
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    failUnless(SHA256_RE.test(artifact.sha256) && digest === artifact.sha256 && bytes.length > 0,
      "artifact_metadata_drift");
    const blocks = blockPlan(bytes, blockSizeBytes, maxArtifactBytes, maxAttempts, timeoutMs);
    let created = false;
    try {
      const create = await artifactControlRequest(fetcher, origin, runtimeToken, "CreateArtifact", {
        workflowRunBackendId: ids.workflowRunBackendId,
        workflowJobRunBackendId: ids.workflowJobRunBackendId,
        name,
        mimeType: { value: "application/gzip" },
        version: 7,
      }, timeoutMs);
      failUnless(exactKeys(create, ["ok", "signedUploadUrl"]) && create.ok === true,
        "artifact_service_invalid");
      created = true;
      const uploadUrl = signedBlobUrl(create.signedUploadUrl);
      for (const block of blocks) {
        await dataPlanePut(
          fetcher,
          operationUrl(uploadUrl, "block", block.id),
          block.body,
          "application/octet-stream",
          "stage_block",
          timeoutMs,
          maxAttempts,
          cleanupTimeoutMs,
        );
      }
      const commitBody = blockListBody(blocks.map((block) => block.id));
      await dataPlanePut(
        fetcher,
        operationUrl(uploadUrl, "blocklist"),
        commitBody,
        "application/xml; charset=utf-8",
        "commit_block_list",
        timeoutMs,
        maxAttempts,
        cleanupTimeoutMs,
      );

      const finalize = await artifactControlRequest(fetcher, origin, runtimeToken, "FinalizeArtifact", {
        workflowRunBackendId: ids.workflowRunBackendId,
        workflowJobRunBackendId: ids.workflowJobRunBackendId,
        name,
        size: String(bytes.length),
        hash: { value: `sha256:${digest}` },
      }, timeoutMs);
      failUnless(
        exactKeys(finalize, ["ok", "artifactId"])
          && finalize.ok === true
          && typeof finalize.artifactId === "string"
          && ARTIFACT_ID_RE.test(finalize.artifactId),
        "artifact_service_invalid",
      );
      return Object.freeze({
        artifactId: finalize.artifactId,
        name,
        sha256: digest,
        memberCount: artifact.memberCount,
        size: bytes.length,
      });
    } catch (error) {
      if (created) await deletePartialArtifact(fetcher, origin, runtimeToken, ids, name, timeoutMs);
      if (error instanceof GitHubArtifactUploadError) throw error;
      throw new GitHubArtifactUploadError("artifact_upload_failed");
    }
  });
}
