const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const zlib = require("node:zlib") as typeof import("node:zlib");

type CandidateConsumer = "workflow-upload";

interface CandidatePackageArtifact {
  readonly name: "kcoderag-nav";
  readonly version: string;
  readonly sha256: string;
  readonly memberCount: number;
  readonly dryRunCount: 1;
  readonly actualPackCount: 1;
}

interface CandidatePackageArtifactLease {
  readonly artifact: CandidatePackageArtifact;
  dispose(): void;
}

interface ReleaseReadinessModule {
  createCandidatePackageArtifact(
    options: { readonly root: string; readonly consumers: readonly CandidateConsumer[] },
    dependencies: { readonly runNpm: (root: string, args: readonly string[]) => Buffer },
  ): CandidatePackageArtifactLease;
  withCandidatePackageBytes<T>(
    lease: CandidatePackageArtifactLease,
    consumer: CandidateConsumer,
    callback: (bytes: Buffer, artifact: CandidatePackageArtifact) => T,
  ): T;
}

interface UploadModule {
  GitHubArtifactUploadError: new (code: string) => Error & {
    readonly code: string;
    readonly stage?: string;
    readonly statusClass?: string;
  };
  uploadCandidateArtifactFromLease(
    lease: CandidatePackageArtifactLease,
    options?: {
      readonly runtimeToken?: string;
      readonly resultsUrl?: string;
      readonly fetcher?: typeof fetch;
      readonly timeoutMs?: number;
      readonly blockSizeBytes?: number;
      readonly maxAttempts?: number;
      readonly cleanupTimeoutMs?: number;
      readonly maxArtifactBytes?: number;
    },
  ): Promise<Readonly<Record<string, unknown>>>;
}

const readiness = require("../../dist/maintainer/release-readiness.cjs") as ReleaseReadinessModule;
const upload = require("../../dist/maintainer/github-artifact-upload.cjs") as UploadModule;

interface FixtureEntry {
  readonly name: string;
  readonly body: Buffer;
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void {
  target.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}

function tarHeader(entry: FixtureEntry): Buffer {
  const output = Buffer.alloc(512);
  output.write(entry.name, 0, 100, "utf8");
  writeOctal(output, 100, 8, 0o644);
  writeOctal(output, 108, 8, 0);
  writeOctal(output, 116, 8, 0);
  writeOctal(output, 124, 12, entry.body.length);
  writeOctal(output, 136, 12, 0);
  output.fill(0x20, 148, 156);
  output[156] = 0x30;
  output.write("ustar\0", 257, 6, "ascii");
  output.write("00", 263, 2, "ascii");
  const checksum = output.reduce((sum, byte) => sum + byte, 0);
  output.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  output[154] = 0;
  output[155] = 0x20;
  return output;
}

function archive(entries: readonly FixtureEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(tarHeader(entry), entry.body);
    const padding = (512 - (entry.body.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

function manifest(files: readonly string[]): Buffer {
  return Buffer.from(JSON.stringify([{
    name: "kcoderag-nav",
    version: "0.3.0",
    filename: "kcoderag-nav-0.3.0.tgz",
    files: files.map((relativePath) => ({ path: relativePath })),
  }]), "utf8");
}

function packageFixture(): {
  readonly root: string;
  readonly bytes: Buffer;
  readonly lease: CandidatePackageArtifactLease;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-artifact-upload-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "kcoderag-nav",
    version: "0.3.0",
  }), "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "neutral candidate\n", "utf8");
  const bytes = archive([
    { name: "package/README.md", body: Buffer.from("neutral candidate\n") },
    { name: "package/package.json", body: Buffer.from('{"name":"kcoderag-nav","version":"0.3.0"}\n') },
  ]);
  const runNpm = (_candidateRoot: string, args: readonly string[]): Buffer => {
    if (!args.includes("--dry-run")) {
      const destination = args[args.indexOf("--pack-destination") + 1];
      assert.equal(typeof destination, "string");
      fs.writeFileSync(path.join(destination as string, "kcoderag-nav-0.3.0.tgz"), bytes);
    }
    return manifest(["README.md", "package.json"]);
  };
  const lease = readiness.createCandidatePackageArtifact({
    root,
    consumers: ["workflow-upload"],
  }, { runNpm });
  return { root, bytes, lease };
}

function runtimeToken(): string {
  const payload = Buffer.from(JSON.stringify({
    scp: "Actions.Results:run-backend-id:job-backend-id",
  })).toString("base64url");
  return `header.${payload}.signature`;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function trackedResponse(status: number, canary: string): {
  readonly response: Response;
  readonly state: { cancelled: number; pulled: number };
} {
  const state = { cancelled: 0, pulled: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      controller.enqueue(Buffer.from(canary, "utf8"));
    },
    cancel() {
      state.cancelled += 1;
    },
  }, { highWaterMark: 0 });
  return { response: new Response(body, { status }), state };
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  assert.equal(typeof body, "string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

function expectUploadCode(call: () => Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(call, (error: unknown) =>
    error instanceof Error && "code" in error && (error as Error & { code: string }).code === code);
}

function restoreArtifactRuntimeEnvironment(): () => void {
  const keys = ["ACTIONS_RUNTIME_TOKEN", "ACTIONS_RESULTS_URL"] as const;
  const snapshot = keys.map((key) => ({
    key,
    owned: Object.prototype.hasOwnProperty.call(process.env, key),
    value: process.env[key],
  }));
  return () => {
    for (const entry of snapshot) {
      if (entry.owned) {
        assert.notEqual(entry.value, undefined);
        process.env[entry.key] = entry.value as string;
      } else {
        delete process.env[entry.key];
      }
    }
  };
}

test("block stage and block list commit preserve the exact private lease buffer", async () => {
  const fixture = packageFixture();
  const events: string[] = [];
  const bodies: unknown[] = [];
  const stagedIds: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname.endsWith("/CreateArtifact")) {
      events.push("create");
      bodies.push(requestBody(init));
      assert.match(new Headers(init?.headers).get("authorization") ?? "", /^Bearer /u);
      return jsonResponse({
        ok: true,
        signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sv=trusted&sig=private",
      });
    }
    if (method === "PUT" && url.hostname === "candidate.blob.core.windows.net") {
      assert.equal(url.searchParams.get("sv"), "trusted");
      assert.equal(url.searchParams.get("sig"), "private");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-ms-version"), "2021-12-02");
      if (url.searchParams.get("comp") === "block") {
        events.push("stage_block");
        const blockId = url.searchParams.get("blockid");
        assert.notEqual(blockId, null);
        stagedIds.push(blockId as string);
        assert.equal(Buffer.from(blockId as string, "base64").toString("ascii"), "00000000");
        assert.equal(headers.get("content-type"), "application/octet-stream");
        assert.equal(headers.get("content-length"), String(fixture.bytes.length));
        assert.ok(Buffer.isBuffer(init?.body));
        assert.ok((init?.body as Buffer).equals(fixture.bytes));
        bodies.push(init?.body);
        return new Response(null, { status: 201 });
      }
      if (url.searchParams.get("comp") === "blocklist") {
        events.push("commit_block_list");
        assert.equal(url.searchParams.has("blockid"), false);
        assert.equal(headers.get("content-type"), "application/xml; charset=utf-8");
        assert.ok(Buffer.isBuffer(init?.body));
        const body = (init?.body as Buffer).toString("utf8");
        assert.equal(headers.get("content-length"), String(Buffer.byteLength(body)));
        assert.deepEqual([...body.matchAll(/<Latest>([^<]+)<\/Latest>/gu)].map((match) => match[1]), stagedIds);
        bodies.push(init?.body);
        return new Response(null, { status: 201 });
      }
      throw new Error("unexpected_bare_put");
    }
    if (url.pathname.endsWith("/FinalizeArtifact")) {
      events.push("finalize");
      bodies.push(requestBody(init));
      return jsonResponse({ ok: true, artifactId: "4242" });
    }
    throw new Error("unexpected_request");
  };

  try {
    const receipt = await upload.uploadCandidateArtifactFromLease(fixture.lease, {
      runtimeToken: runtimeToken(),
      resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
      fetcher,
    });
    assert.deepEqual(events, ["create", "stage_block", "commit_block_list", "finalize"]);
    assert.deepEqual(bodies[0], {
      workflowRunBackendId: "run-backend-id",
      workflowJobRunBackendId: "job-backend-id",
      name: "kcoderag-nav-0.3.0.tgz",
      mimeType: { value: "application/gzip" },
      version: 7,
    });
    assert.deepEqual(bodies[3], {
      workflowRunBackendId: "run-backend-id",
      workflowJobRunBackendId: "job-backend-id",
      name: "kcoderag-nav-0.3.0.tgz",
      size: String(fixture.bytes.length),
      hash: { value: `sha256:${crypto.createHash("sha256").update(fixture.bytes).digest("hex")}` },
    });
    assert.deepEqual(receipt, {
      artifactId: "4242",
      name: "kcoderag-nav-0.3.0.tgz",
      sha256: crypto.createHash("sha256").update(fixture.bytes).digest("hex"),
      memberCount: 2,
      size: fixture.bytes.length,
    });
    assert.deepEqual(Object.keys(receipt).sort(), ["artifactId", "memberCount", "name", "sha256", "size"]);
    const serialized = JSON.stringify(receipt);
    assert.doesNotMatch(serialized, /runtimeToken|resultsUrl|Authorization|Bearer|sig=|run-backend-id|job-backend-id/iu);
    assert.throws(
      () => readiness.withCandidatePackageBytes(fixture.lease, "workflow-upload", () => undefined),
      (error: unknown) => (error as { code?: unknown }).code === "artifact_disposed",
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("safe upload failure reports commit status class, cleans up, and disposes the lease", async () => {
  const fixture = packageFixture();
  const events: string[] = [];
  const secretCanary = "azure-error-secret-canary";
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/CreateArtifact")) {
      events.push("create");
      return jsonResponse({
        ok: true,
        signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sig=signed-secret-canary",
      });
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "block") {
      events.push("stage_block");
      return new Response(null, { status: 201 });
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "blocklist") {
      events.push("commit_block_list");
      return new Response(secretCanary, { status: 503 });
    }
    if (url.pathname.endsWith("/DeleteArtifact")) {
      events.push("delete");
      return jsonResponse({ ok: true, artifactId: "4242" });
    }
    if (url.pathname.endsWith("/FinalizeArtifact")) events.push("finalize");
    throw new Error("unexpected_request");
  };

  try {
    let failure: unknown;
    try {
      await upload.uploadCandidateArtifactFromLease(fixture.lease, {
        runtimeToken: runtimeToken(),
        resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
        fetcher,
        maxAttempts: 1,
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error);
    assert.equal((failure as Error & { code?: string }).code, "artifact_upload_failed");
    assert.equal((failure as Error & { stage?: string }).stage, "commit_block_list");
    assert.equal((failure as Error & { statusClass?: string }).statusClass, "5xx");
    assert.deepEqual(events, ["create", "stage_block", "commit_block_list", "delete"]);
    assert.doesNotMatch(JSON.stringify(failure), /signed-secret-canary|azure-error-secret-canary/iu);
    assert.throws(
      () => readiness.withCandidatePackageBytes(fixture.lease, "workflow-upload", () => undefined),
      (error: unknown) => (error as { code?: unknown }).code === "artifact_disposed",
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("reads runner authentication only from process env and preserves create stage commit finalize", async () => {
  const fixture = packageFixture();
  const restoreEnvironment = restoreArtifactRuntimeEnvironment();
  const events: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/CreateArtifact")) {
      events.push("create");
      return jsonResponse({
        ok: true,
        signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sig=private",
      });
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "block") {
      events.push("stage_block");
      assert.ok(Buffer.isBuffer(init.body));
      assert.ok((init.body as Buffer).equals(fixture.bytes));
      return new Response(null, { status: 201 });
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "blocklist") {
      events.push("commit_block_list");
      return new Response(null, { status: 201 });
    }
    if (url.pathname.endsWith("/FinalizeArtifact")) {
      events.push("finalize");
      return jsonResponse({ ok: true, artifactId: "4242" });
    }
    throw new Error("unexpected_request");
  };

  try {
    process.env.ACTIONS_RUNTIME_TOKEN = runtimeToken();
    process.env.ACTIONS_RESULTS_URL = "https://results-receiver.actions.githubusercontent.com/";
    const receipt = await upload.uploadCandidateArtifactFromLease(fixture.lease, { fetcher });
    assert.deepEqual(events, ["create", "stage_block", "commit_block_list", "finalize"]);
    assert.deepEqual(receipt, {
      artifactId: "4242",
      name: "kcoderag-nav-0.3.0.tgz",
      sha256: crypto.createHash("sha256").update(fixture.bytes).digest("hex"),
      memberCount: 2,
      size: fixture.bytes.length,
    });
    assert.throws(
      () => readiness.withCandidatePackageBytes(fixture.lease, "workflow-upload", () => undefined),
      (error: unknown) => (error as { code?: unknown }).code === "artifact_disposed",
    );
  } finally {
    restoreEnvironment();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("multi-block upload uses deterministic ascending IDs and exact leased bytes", async () => {
  const fixture = packageFixture();
  const blockSizeBytes = Math.max(1, Math.floor(fixture.bytes.length / 4));
  const stageIds: string[] = [];
  const stageBodies: Buffer[] = [];
  let committedIds: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/CreateArtifact")) {
      return jsonResponse({
        ok: true,
        signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sv=trusted&sig=private",
      });
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "block") {
      const id = url.searchParams.get("blockid");
      assert.notEqual(id, null);
      assert.ok(Buffer.isBuffer(init.body));
      stageIds.push(id as string);
      stageBodies.push(Buffer.from(init.body as Buffer));
      return new Response(null, { status: 201 });
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "blocklist") {
      assert.ok(Buffer.isBuffer(init.body));
      committedIds = [...(init.body as Buffer).toString("utf8").matchAll(/<Latest>([^<]+)<\/Latest>/gu)]
        .map((match) => match[1] as string);
      return new Response(null, { status: 201 });
    }
    if (url.pathname.endsWith("/FinalizeArtifact")) return jsonResponse({ ok: true, artifactId: "4242" });
    throw new Error("unexpected_request");
  };

  try {
    await upload.uploadCandidateArtifactFromLease(fixture.lease, {
      runtimeToken: runtimeToken(),
      resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
      fetcher,
      blockSizeBytes,
    });
    assert.ok(stageIds.length >= 4);
    assert.equal(new Set(stageIds).size, stageIds.length);
    assert.ok(stageIds.every((id) => id.length === stageIds[0]?.length));
    assert.deepEqual(stageIds.map((id) => Buffer.from(id, "base64").toString("ascii")),
      stageIds.map((_id, index) => index.toString(10).padStart(8, "0")));
    assert.deepEqual(committedIds, stageIds);
    assert.ok(Buffer.concat(stageBodies).equals(fixture.bytes));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("retryable stage responses cancel bodies before retry without changing ID or bytes", async () => {
  const fixture = packageFixture();
  const stageResponses = [
    trackedResponse(503, "retry-stage-response-secret"),
    trackedResponse(201, "success-stage-response-secret"),
  ];
  const commitResponse = trackedResponse(201, "success-commit-response-secret");
  const stageIds: string[] = [];
  const stageBodies: Buffer[] = [];
  let stageAttempt = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/CreateArtifact")) {
      return jsonResponse({
        ok: true,
        signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sig=private",
      });
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "block") {
      if (stageAttempt > 0) assert.equal(stageResponses[stageAttempt - 1]?.state.cancelled, 1);
      stageIds.push(url.searchParams.get("blockid") as string);
      stageBodies.push(Buffer.from(init.body as Buffer));
      const response = stageResponses[stageAttempt]?.response;
      stageAttempt += 1;
      assert.notEqual(response, undefined);
      return response as Response;
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "blocklist") {
      assert.equal(stageResponses[1]?.state.cancelled, 1);
      return commitResponse.response;
    }
    if (url.pathname.endsWith("/FinalizeArtifact")) {
      assert.equal(commitResponse.state.cancelled, 1);
      return jsonResponse({ ok: true, artifactId: "4242" });
    }
    throw new Error("unexpected_request");
  };

  try {
    await upload.uploadCandidateArtifactFromLease(fixture.lease, {
      runtimeToken: runtimeToken(),
      resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
      fetcher,
      maxAttempts: 2,
      cleanupTimeoutMs: 25,
    });
    assert.equal(stageAttempt, 2);
    assert.deepEqual(stageIds, [stageIds[0], stageIds[0]]);
    assert.ok(stageBodies.every((body) => body.equals(fixture.bytes)));
    for (const item of [...stageResponses, commitResponse]) {
      assert.equal(item.state.cancelled, 1);
      assert.equal(item.state.pulled, 0);
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("response cancellation timeout and rejection never block successful progression", async () => {
  const fixture = packageFixture();
  const cleanup = { hanging: 0, rejected: 0 };
  const hangingResponse = new Response(new ReadableStream<Uint8Array>({
    cancel() {
      cleanup.hanging += 1;
      return new Promise<void>(() => { /* intentionally unsettled */ });
    },
  }, { highWaterMark: 0 }), { status: 201 });
  const rejectedResponse = new Response(new ReadableStream<Uint8Array>({
    cancel() {
      cleanup.rejected += 1;
      throw new Error("cancel-rejection-secret-canary");
    },
  }, { highWaterMark: 0 }), { status: 201 });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/CreateArtifact")) {
      return jsonResponse({
        ok: true,
        signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sig=private",
      });
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "block") return hangingResponse;
    if (init?.method === "PUT" && url.searchParams.get("comp") === "blocklist") return rejectedResponse;
    if (url.pathname.endsWith("/FinalizeArtifact")) return jsonResponse({ ok: true, artifactId: "4242" });
    throw new Error("unexpected_request");
  };

  try {
    const started = Date.now();
    const receipt = await upload.uploadCandidateArtifactFromLease(fixture.lease, {
      runtimeToken: runtimeToken(),
      resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
      fetcher,
      cleanupTimeoutMs: 25,
    });
    assert.equal(receipt.artifactId, "4242");
    assert.deepEqual(cleanup, { hanging: 1, rejected: 1 });
    assert.ok(Date.now() - started < 1_000);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("terminal commit 4xx cancels without retry and cleanup failure preserves original metadata", async () => {
  const fixture = packageFixture();
  const stageResponse = trackedResponse(201, "success-stage-secret");
  const commitResponse = trackedResponse(400, "terminal-commit-secret");
  const events: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/CreateArtifact")) {
      events.push("create");
      return jsonResponse({
        ok: true,
        signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sig=private",
      });
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "block") {
      events.push("stage_block");
      return stageResponse.response;
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "blocklist") {
      events.push("commit_block_list");
      return commitResponse.response;
    }
    if (url.pathname.endsWith("/DeleteArtifact")) {
      events.push("delete");
      return jsonResponse({ ok: false }, 503);
    }
    if (url.pathname.endsWith("/FinalizeArtifact")) events.push("finalize");
    throw new Error("unexpected_request");
  };

  try {
    let failure: unknown;
    try {
      await upload.uploadCandidateArtifactFromLease(fixture.lease, {
        runtimeToken: runtimeToken(),
        resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
        fetcher,
        maxAttempts: 3,
        cleanupTimeoutMs: 25,
      });
    } catch (error) {
      failure = error;
    }
    assert.equal((failure as { code?: string }).code, "artifact_upload_failed");
    assert.equal((failure as { stage?: string }).stage, "commit_block_list");
    assert.equal((failure as { statusClass?: string }).statusClass, "4xx");
    assert.deepEqual(events, ["create", "stage_block", "commit_block_list", "delete"]);
    assert.equal(stageResponse.state.cancelled, 1);
    assert.equal(commitResponse.state.cancelled, 1);
    assert.equal(stageResponse.state.pulled + commitResponse.state.pulled, 0);
    assert.doesNotMatch(JSON.stringify(failure), /terminal-commit-secret|success-stage-secret/iu);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("retry classes are bounded while redirects and ordinary 4xx stop immediately", async () => {
  const retryable = [408, 429, 503, "network", "timeout"] as const;
  for (const outcome of retryable) {
    const fixture = packageFixture();
    let stageAttempts = 0;
    let firstResponse: ReturnType<typeof trackedResponse> | undefined;
    const ids: string[] = [];
    const bodies: Buffer[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/CreateArtifact")) {
        return jsonResponse({
          ok: true,
          signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sig=private",
        });
      }
      if (init?.method === "PUT" && url.searchParams.get("comp") === "block") {
        stageAttempts += 1;
        ids.push(url.searchParams.get("blockid") as string);
        bodies.push(Buffer.from(init.body as Buffer));
        if (stageAttempts === 1) {
          if (outcome === "network") throw new Error("network-secret-canary");
          if (outcome === "timeout") throw new DOMException("timeout-secret-canary", "AbortError");
          firstResponse = trackedResponse(outcome, `status-${outcome}-secret-canary`);
          return firstResponse.response;
        }
        return new Response(null, { status: 201 });
      }
      if (init?.method === "PUT" && url.searchParams.get("comp") === "blocklist") {
        return new Response(null, { status: 201 });
      }
      if (url.pathname.endsWith("/FinalizeArtifact")) return jsonResponse({ ok: true, artifactId: "4242" });
      throw new Error("unexpected_request");
    };
    try {
      await upload.uploadCandidateArtifactFromLease(fixture.lease, {
        runtimeToken: runtimeToken(),
        resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
        fetcher,
        maxAttempts: 2,
        cleanupTimeoutMs: 25,
      });
      assert.equal(stageAttempts, 2);
      assert.deepEqual(ids, [ids[0], ids[0]]);
      assert.ok(bodies[0]?.equals(bodies[1] as Buffer));
      if (firstResponse !== undefined) {
        assert.equal(firstResponse.state.cancelled, 1);
        assert.equal(firstResponse.state.pulled, 0);
      }
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  for (const terminalStatus of [302, 400]) {
    const fixture = packageFixture();
    let stageAttempts = 0;
    let deleteCalls = 0;
    const terminal = trackedResponse(terminalStatus, `terminal-${terminalStatus}-secret-canary`);
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/CreateArtifact")) {
        return jsonResponse({
          ok: true,
          signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sig=private",
        });
      }
      if (init?.method === "PUT" && url.searchParams.get("comp") === "block") {
        assert.equal(init.redirect, "manual");
        stageAttempts += 1;
        return terminal.response;
      }
      if (url.pathname.endsWith("/DeleteArtifact")) {
        deleteCalls += 1;
        return jsonResponse({ ok: true, artifactId: "4242" });
      }
      throw new Error("unexpected_request");
    };
    try {
      await expectUploadCode(() => upload.uploadCandidateArtifactFromLease(fixture.lease, {
        runtimeToken: runtimeToken(),
        resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
        fetcher,
        maxAttempts: 3,
        cleanupTimeoutMs: 25,
      }), "artifact_upload_failed");
      assert.equal(stageAttempts, 1);
      assert.equal(deleteCalls, 1);
      assert.equal(terminal.state.cancelled, 1);
      assert.equal(terminal.state.pulled, 0);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  const fixture = packageFixture();
  let attempts = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/CreateArtifact")) {
      return jsonResponse({
        ok: true,
        signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sig=private",
      });
    }
    if (init?.method === "PUT" && url.searchParams.get("comp") === "block") {
      attempts += 1;
      return new Response(null, { status: 503 });
    }
    if (url.pathname.endsWith("/DeleteArtifact")) return jsonResponse({ ok: true, artifactId: "4242" });
    throw new Error("unexpected_request");
  };
  try {
    await expectUploadCode(() => upload.uploadCandidateArtifactFromLease(fixture.lease, {
      runtimeToken: runtimeToken(),
      resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
      fetcher,
      maxAttempts: 2,
    }), "artifact_upload_failed");
    assert.equal(attempts, 2);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("post-create failure matrix deletes once and finalizes only after block-list commit", async () => {
  const targets = ["stage-0", "stage-1", "stage-2", "commit", "finalize"] as const;
  for (const target of targets) {
    const fixture = packageFixture();
    const blockSizeBytes = Math.ceil(fixture.bytes.length / 3);
    const events: string[] = [];
    let stageIndex = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/CreateArtifact")) {
        events.push("create");
        return jsonResponse({
          ok: true,
          signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sig=private",
        });
      }
      if (init?.method === "PUT" && url.searchParams.get("comp") === "block") {
        const event = `stage-${stageIndex}`;
        events.push(event);
        stageIndex += 1;
        return new Response(null, { status: event === target ? 400 : 201 });
      }
      if (init?.method === "PUT" && url.searchParams.get("comp") === "blocklist") {
        events.push("commit");
        return new Response(null, { status: target === "commit" ? 400 : 201 });
      }
      if (url.pathname.endsWith("/FinalizeArtifact")) {
        events.push("finalize");
        return target === "finalize"
          ? jsonResponse({ safe: false }, 500)
          : jsonResponse({ ok: true, artifactId: "4242" });
      }
      if (url.pathname.endsWith("/DeleteArtifact")) {
        events.push("delete");
        return jsonResponse({ ok: true, artifactId: "4242" });
      }
      throw new Error("unexpected_request");
    };
    try {
      let failure: unknown;
      try {
        await upload.uploadCandidateArtifactFromLease(fixture.lease, {
          runtimeToken: runtimeToken(),
          resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
          fetcher,
          blockSizeBytes,
          maxAttempts: 1,
        });
      } catch (error) {
        failure = error;
      }
      assert.equal((failure as { code?: string }).code, "artifact_upload_failed");
      assert.equal(events.filter((event) => event === "delete").length, 1);
      assert.equal(events.filter((event) => event === "finalize").length, target === "finalize" ? 1 : 0);
      assert.equal((failure as { stage?: string }).stage,
        target.startsWith("stage") ? "stage_block" : target === "commit" ? "commit_block_list" : "finalize_artifact");
      assert.throws(
        () => readiness.withCandidatePackageBytes(fixture.lease, "workflow-upload", () => undefined),
        (error: unknown) => (error as { code?: unknown }).code === "artifact_disposed",
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("resource and signed-query bounds fail before finalize without leaking inputs", async () => {
  for (const options of [
    { blockSizeBytes: 0 },
    { maxAttempts: 0 },
    { maxAttempts: 6 },
    { cleanupTimeoutMs: 0 },
    { maxArtifactBytes: 64 * 1024 * 1024 + 1 },
  ]) {
    const fixture = packageFixture();
    let called = false;
    try {
      await expectUploadCode(() => upload.uploadCandidateArtifactFromLease(fixture.lease, {
        runtimeToken: runtimeToken(),
        resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
        fetcher: async () => { called = true; throw new Error("must_not_call"); },
        ...options,
      }), "artifact_auth_invalid");
      assert.equal(called, false);
      let consumed = false;
      readiness.withCandidatePackageBytes(fixture.lease, "workflow-upload", () => { consumed = true; });
      assert.equal(consumed, true);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  for (const limits of [
    { maxArtifactBytes: 1 },
    { blockSizeBytes: 1 },
  ]) {
    const fixture = packageFixture();
    let called = false;
    try {
      await expectUploadCode(() => upload.uploadCandidateArtifactFromLease(fixture.lease, {
        runtimeToken: runtimeToken(),
        resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
        fetcher: async () => { called = true; throw new Error("must_not_call"); },
        ...limits,
      }), "artifact_metadata_drift");
      assert.equal(called, false);
      assert.throws(
        () => readiness.withCandidatePackageBytes(fixture.lease, "workflow-upload", () => undefined),
        (error: unknown) => (error as { code?: unknown }).code === "artifact_disposed",
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  for (const signedUploadUrl of [
    "https://candidate.blob.core.windows.net/results/candidate?sig=private&comp=block",
    "https://candidate.blob.core.windows.net/results/candidate?sig=",
    "https://candidate.blob.core.windows.net/results/candidate?sig=one&sig=two",
  ]) {
    const fixture = packageFixture();
    const events: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/CreateArtifact")) {
        events.push("create");
        return jsonResponse({ ok: true, signedUploadUrl });
      }
      if (url.pathname.endsWith("/DeleteArtifact")) {
        events.push("delete");
        return jsonResponse({ ok: true, artifactId: "4242" });
      }
      throw new Error("unexpected_request");
    };
    try {
      await expectUploadCode(() => upload.uploadCandidateArtifactFromLease(fixture.lease, {
        runtimeToken: runtimeToken(),
        resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
        fetcher,
      }), "artifact_service_invalid");
      assert.deepEqual(events, ["create", "delete"]);
      assert.doesNotMatch(JSON.stringify(events), /private|sig=one|sig=two/iu);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("missing process env authentication makes no fetch and does not consume the lease", async () => {
  const fixture = packageFixture();
  const restoreEnvironment = restoreArtifactRuntimeEnvironment();
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  try {
    delete process.env.ACTIONS_RUNTIME_TOKEN;
    delete process.env.ACTIONS_RESULTS_URL;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("must_not_call");
    };
    await expectUploadCode(() => upload.uploadCandidateArtifactFromLease(fixture.lease),
      "artifact_auth_invalid");
    assert.equal(fetchCalled, false);
    let consumed = false;
    readiness.withCandidatePackageBytes(fixture.lease, "workflow-upload", () => { consumed = true; });
    assert.equal(consumed, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("failed upload deletes the partial artifact before the lease is disposed and never finalizes", async () => {
  const fixture = packageFixture();
  const events: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/CreateArtifact")) {
      events.push("create");
      return jsonResponse({
        ok: true,
        signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sig=private",
      });
    }
    if (init?.method === "PUT") {
      events.push("upload");
      return new Response(null, { status: 503 });
    }
    if (url.endsWith("/DeleteArtifact")) {
      events.push("delete");
      assert.deepEqual(requestBody(init), {
        workflowRunBackendId: "run-backend-id",
        workflowJobRunBackendId: "job-backend-id",
        name: "kcoderag-nav-0.3.0.tgz",
      });
      return jsonResponse({ ok: true, artifactId: "4242" });
    }
    if (url.endsWith("/FinalizeArtifact")) events.push("finalize");
    throw new Error("unexpected_request");
  };

  try {
    await expectUploadCode(() => upload.uploadCandidateArtifactFromLease(fixture.lease, {
      runtimeToken: runtimeToken(),
      resultsUrl: "https://results-receiver.actions.githubusercontent.com/",
      fetcher,
      maxAttempts: 1,
    }), "artifact_upload_failed");
    assert.deepEqual(events, ["create", "upload", "delete"]);
    assert.throws(
      () => readiness.withCandidatePackageBytes(fixture.lease, "workflow-upload", () => undefined),
      (error: unknown) => (error as { code?: unknown }).code === "artifact_disposed",
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects non-runner auth and untrusted service origins before consuming the lease", async () => {
  for (const options of [
    { runtimeToken: "not-a-jwt", resultsUrl: "https://results-receiver.actions.githubusercontent.com/" },
    { runtimeToken: runtimeToken(), resultsUrl: "https://attacker.example.invalid/" },
  ]) {
    const fixture = packageFixture();
    let called = false;
    try {
      await expectUploadCode(() => upload.uploadCandidateArtifactFromLease(fixture.lease, {
        ...options,
        fetcher: async () => { called = true; throw new Error("must_not_call"); },
      }), "artifact_auth_invalid");
      assert.equal(called, false);
      let observed = false;
      readiness.withCandidatePackageBytes(fixture.lease, "workflow-upload", () => { observed = true; });
      assert.equal(observed, true);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
