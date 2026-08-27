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
  GitHubArtifactUploadError: new (code: string) => Error & { readonly code: string };
  uploadCandidateArtifactFromLease(
    lease: CandidatePackageArtifactLease,
    options: {
      readonly runtimeToken: string;
      readonly resultsUrl: string;
      readonly fetcher: typeof fetch;
      readonly timeoutMs?: number;
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

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  assert.equal(typeof body, "string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

function expectUploadCode(call: () => Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(call, (error: unknown) =>
    error instanceof Error && "code" in error && (error as Error & { code: string }).code === code);
}

test("uploads the private lease buffer once through create raw-put finalize and returns metadata only", async () => {
  const fixture = packageFixture();
  const events: string[] = [];
  const bodies: unknown[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/CreateArtifact")) {
      events.push("create");
      bodies.push(requestBody(init));
      assert.equal(init?.headers instanceof Headers ? init.headers.get("authorization") : undefined, null);
      assert.match(JSON.stringify(init?.headers), /Bearer /u);
      return jsonResponse({
        ok: true,
        signedUploadUrl: "https://candidate.blob.core.windows.net/results/candidate?sig=private",
      });
    }
    if (method === "PUT") {
      events.push("upload");
      bodies.push(init?.body);
      assert.equal(init?.body, fixture.bytes);
      assert.match(JSON.stringify(init?.headers), /BlockBlob/u);
      return new Response(null, { status: 201 });
    }
    if (url.endsWith("/FinalizeArtifact")) {
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
    assert.deepEqual(events, ["create", "upload", "finalize"]);
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
