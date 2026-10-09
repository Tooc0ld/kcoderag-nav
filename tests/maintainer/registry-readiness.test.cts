const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
interface Manifest {
  readonly schemaVersion: 1; readonly name: "kcoderag-nav"; readonly version: string;
  readonly candidateSha: string; readonly sha256: string; readonly integrity: string;
  readonly memberCount: number; readonly memberDigest: string;
}
interface Receipt { status: string; attempts: number; elapsedMs: number; code: string; provenance: string }
const registry = require("../../dist/maintainer/registry-readiness.cjs") as {
  RegistryError: new (code: string) => Error;
  classifyNpmFailure(stderr: string): string | undefined;
  probeRegistry(manifest: Manifest, timeoutMs: number): Promise<"READY" | "PENDING">;
  waitForRegistry(manifest: Manifest, dependencies: {
    probe: (manifest: Manifest, timeoutMs: number) => Promise<"READY" | "PENDING">;
    now: () => number; sleep: (delayMs: number) => Promise<void>;
  }, maxWaitMs?: number): Promise<Receipt>;
};
const manifest: Manifest = { schemaVersion: 1, name: "kcoderag-nav", version: "1.2.3",
  candidateSha: "a".repeat(40), sha256: "b".repeat(64), integrity: "sha512-fixture",
  memberCount: 3, memberDigest: "c".repeat(64) };

test("registry polling backs off read-only attempts and distinguishes availability from publish success", async () => {
  let now = 0; let probes = 0; const delays: number[] = [];
  const result = await registry.waitForRegistry(manifest, {
    now: () => now, sleep: async (delay) => { delays.push(delay); now += delay; },
    probe: async (value, timeout) => { assert.equal(value, manifest); assert.ok(timeout <= 90_000); return ++probes === 3 ? "READY" : "PENDING"; },
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.attempts, 3);
  assert.equal(result.elapsedMs, 15_000);
  assert.deepEqual(delays, [5_000, 10_000]);
  assert.equal(result.provenance, "exact_tarball_sha256_and_sha512");
});

test("registry retry stays within its deadline and reports pending without retrying publication", async () => {
  let now = 0;
  const result = await registry.waitForRegistry(manifest, {
    now: () => now, sleep: async (delay) => { now += delay; }, probe: async () => "PENDING",
  }, 12_000);
  assert.equal(result.status, "PUBLISHED_PENDING_REGISTRY");
  assert.equal(result.elapsedMs, 12_000);
  assert.equal(result.attempts, 2);
});

test("authorization and integrity errors terminate immediately while transport failures remain bounded pending", async () => {
  for (const errorCode of ["registry_authorization_failed", "registry_integrity_mismatch", "registry_candidate_mismatch"]) {
    const result = await registry.waitForRegistry(manifest, {
      now: () => 0, sleep: async () => assert.fail("terminal error must not back off"),
      probe: async () => { throw new registry.RegistryError(errorCode); },
    });
    assert.equal(result.status, "FAILED"); assert.equal(result.attempts, 1); assert.equal(result.code, errorCode);
  }
  let now = 0;
  const result = await registry.waitForRegistry(manifest, {
    now: () => now, sleep: async (delay) => { now += delay; }, probe: async () => { throw new Error("network secret detail"); },
  }, 5_000);
  assert.equal(result.status, "PUBLISHED_PENDING_REGISTRY");
  assert.equal(result.code, "registry_temporarily_unreachable");
  assert.doesNotMatch(JSON.stringify(result), /secret/u);
});

test("npm authentication and integrity diagnostics produce closed stable codes without copying output", () => {
  for (const code of ["E401", "E403"]) assert.equal(registry.classifyNpmFailure(`npm error code ${code}\nsecret`), "registry_authorization_failed");
  assert.equal(registry.classifyNpmFailure("npm error code EINTEGRITY secret"), "registry_integrity_mismatch");
  assert.equal(registry.classifyNpmFailure("npm error code E404 processing"), undefined);
});

test("registry probe handles exact-version 404 as pending and rejects reported candidate or integrity drift", async () => {
  const original = globalThis.fetch;
  let responses: Response[] = [];
  globalThis.fetch = async () => { const response = responses.shift(); assert.ok(response); return response; };
  try {
    responses = [new Response("not ready", { status: 404 })];
    assert.equal(await registry.probeRegistry(manifest, 1_000), "PENDING");
    responses = [new Response("denied", { status: 401 })];
    await assert.rejects(registry.probeRegistry(manifest, 1_000), /registry_authorization_failed/u);
    const metadata = { name: manifest.name, version: manifest.version,
      dist: { integrity: manifest.integrity, tarball: "https://registry.npmjs.org/kcoderag-nav/-/kcoderag-nav-1.2.3.tgz" } };
    responses = [Response.json({ ...metadata, gitHead: "wrong" })];
    await assert.rejects(registry.probeRegistry(manifest, 1_000), /registry_candidate_mismatch/u);
    responses = [Response.json({ ...metadata, dist: { ...metadata.dist, integrity: "wrong" } })];
    await assert.rejects(registry.probeRegistry(manifest, 1_000), /registry_integrity_mismatch/u);
    responses = [Response.json(metadata), Response.json({ version: "1.2.2" })];
    assert.equal(await registry.probeRegistry(manifest, 1_000), "PENDING");
  } finally { globalThis.fetch = original; }
});
