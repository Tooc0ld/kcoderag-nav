const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

interface UserSourcesModule {
  readonly SOURCE_SCAN_MODES: readonly string[];
  createNativeHostCapability(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
  createNativeCleanupPlan(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
  createSourceFinding(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
  createSourceScanResult(
    mode: string,
    findings: readonly Readonly<Record<string, unknown>>[],
    cleanupPlans?: readonly Readonly<Record<string, unknown>>[],
  ): Readonly<Record<string, unknown>>;
  runOwnedSourceCleanup(
    plan: Readonly<Record<string, unknown>>,
    authority: Readonly<Record<string, unknown>>,
    runner: (request: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>,
  ): Promise<Readonly<Record<string, unknown>>>;
}

const sources = require("../../dist/hosts/user-sources.cjs") as UserSourcesModule;

const SENTINELS = Object.freeze([
  "https://qa.invalid/mcp?credential=sentinel",
  "Authorization",
  "Bearer sentinel-secret",
  "sentinel subprocess body",
]);

function capability(completeInventory = true): Readonly<Record<string, unknown>> {
  return sources.createNativeHostCapability({
    host: "codex",
    cli: "codex",
    minimumVersion: "0.146.1",
    observedVersion: "0.146.1",
    inventorySchemaId: "codex-plugin-v1",
    completeInventory,
    route: completeInventory ? "normal" : "degraded_owned_registration",
  });
}

function ownedPlan(): Readonly<Record<string, unknown>> {
  return sources.createNativeCleanupPlan({
    host: "codex",
    sourceType: "owned_marketplace_registration",
    safePath: ".codex/plugins/marketplaces/kcoderag-nav",
    capability: capability(false),
    argv: ["codex", "plugin", "marketplace", "remove", "kcoderag-nav", "--json"],
    scope: "marketplace:kcoderag-nav",
    timeoutMs: 5_000,
  });
}

test("source findings use a closed immutable schema and deterministic code-unit ordering", () => {
  assert.deepEqual(sources.SOURCE_SCAN_MODES, ["fast", "deep", "gate"]);
  const cleanup = ownedPlan();
  const findings = [
    sources.createSourceFinding({
      code: "manual_hook_source",
      severity: "conflict",
      sourceType: "manual_hook",
      scope: "user",
      safePath: ".codex/z-hook",
      cleanupEligible: false,
    }),
    sources.createSourceFinding({
      code: "owned_marketplace_source",
      severity: "conflict",
      sourceType: "owned_marketplace_registration",
      scope: "user",
      safePath: ".codex/A-marketplace",
      cleanupEligible: true,
      cleanupCommand: cleanup.command,
      cleanupFingerprint: cleanup.fingerprint,
    }),
  ];
  const result = sources.createSourceScanResult("deep", findings, [cleanup]);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.findings), true);
  assert.equal(Object.isFrozen((result.findings as readonly object[])[0]), true);
  assert.deepEqual(
    (result.findings as readonly Record<string, unknown>[]).map((finding) => finding.safePath),
    [".codex/A-marketplace", ".codex/z-hook"],
  );
  assert.deepEqual(Object.keys((result.findings as readonly object[])[0] ?? {}).sort(), [
    "cleanupCommand",
    "cleanupEligible",
    "cleanupFingerprint",
    "code",
    "safePath",
    "scope",
    "severity",
    "sourceType",
  ]);
  assert.equal(result.hasConflict, true);
});

test("only exact owned plugin or marketplace findings can expose automatic cleanup", () => {
  const plan = ownedPlan();
  assert.match(String(plan.fingerprint), /^sha256:[0-9a-f]{64}$/);
  assert.equal(plan.command, "codex plugin marketplace remove kcoderag-nav --json");

  for (const sourceType of ["raw_mcp", "manual_hook", "ambiguous", "cache_residue", "disabled_registration"]) {
    assert.throws(
      () => sources.createSourceFinding({
        code: "manual_cleanup_required",
        severity: sourceType === "cache_residue" || sourceType === "disabled_registration" ? "info" : "conflict",
        sourceType,
        scope: "user",
        safePath: ".codex/source",
        cleanupEligible: true,
        cleanupCommand: plan.command,
        cleanupFingerprint: plan.fingerprint,
      }),
      (error: unknown) => (error as { readonly code?: string }).code === "invalid_source_finding",
    );
  }
});

test("cleanup authority is independent, fingerprint-bound, and passes only metadata to the runner", async () => {
  const plan = ownedPlan();
  const calls: Readonly<Record<string, unknown>>[] = [];
  const runner = async (request: Readonly<Record<string, unknown>>) => {
    calls.push(request);
    return Object.freeze({ exitCode: 0, timedOut: false });
  };

  await assert.rejects(
    sources.runOwnedSourceCleanup(plan, { allowOwnedSourceCleanup: false, cleanupFingerprint: plan.fingerprint }, runner),
    (error: unknown) => (error as { readonly code?: string }).code === "owned_source_cleanup_not_authorized",
  );
  await assert.rejects(
    sources.runOwnedSourceCleanup(plan, { allowOwnedSourceCleanup: true, cleanupFingerprint: `sha256:${"0".repeat(64)}` }, runner),
    (error: unknown) => (error as { readonly code?: string }).code === "cleanup_fingerprint_mismatch",
  );
  assert.equal(calls.length, 0);

  const result = await sources.runOwnedSourceCleanup(
    plan,
    { allowOwnedSourceCleanup: true, cleanupFingerprint: plan.fingerprint },
    runner,
  );
  assert.deepEqual(result, { exitCode: 0, timedOut: false });
  assert.deepEqual(calls, [{ executable: "codex", args: ["plugin", "marketplace", "remove", "kcoderag-nav", "--json"], timeoutMs: 5_000 }]);
});

test("source serialization rejects secret-like paths, commands, capabilities, and process bodies", async () => {
  const plan = ownedPlan();
  for (const sentinel of SENTINELS) {
    assert.throws(
      () => sources.createSourceFinding({
        code: "raw_mcp_source",
        severity: "conflict",
        sourceType: "raw_mcp",
        scope: "user",
        safePath: sentinel,
        cleanupEligible: false,
      }),
      (error: unknown) => {
        assert.equal(JSON.stringify(error).includes(sentinel), false);
        return (error as { readonly code?: string }).code === "invalid_source_finding";
      },
    );
  }

  await assert.rejects(
    sources.runOwnedSourceCleanup(
      plan,
      { allowOwnedSourceCleanup: true, cleanupFingerprint: plan.fingerprint },
      async () => ({ exitCode: 1, timedOut: false, stdout: SENTINELS[0], stderr: SENTINELS[2] }),
    ),
    (error: unknown) => {
      const serialized = JSON.stringify(error);
      assert.equal(SENTINELS.some((sentinel) => serialized.includes(sentinel)), false);
      return (error as { readonly code?: string }).code === "owned_source_cleanup_failed";
    },
  );
});
