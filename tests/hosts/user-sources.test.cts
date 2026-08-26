const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

interface UserSourcesModule {
  readonly SOURCE_SCAN_MODES: readonly string[];
  readonly createNativeCleanupPlan?: unknown;
  readonly runOwnedSourceCleanup?: unknown;
  createSourceFinding(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
  createSourceScanResult(
    mode: string,
    findings: readonly Readonly<Record<string, unknown>>[],
  ): Readonly<Record<string, unknown>>;
}

const sources = require("../../dist/hosts/user-sources.cjs") as UserSourcesModule;

const SENTINELS = Object.freeze([
  "https://qa.invalid/mcp?credential=sentinel",
  "Authorization",
  "Bearer sentinel-secret",
  "sentinel subprocess body",
]);

test("source findings are immutable metadata-only records in deterministic code-unit order", () => {
  assert.deepEqual(sources.SOURCE_SCAN_MODES, ["fast", "deep", "gate"]);
  assert.equal(sources.createNativeCleanupPlan, undefined);
  assert.equal(sources.runOwnedSourceCleanup, undefined);

  const findings = [
    sources.createSourceFinding({
      code: "manual_hook_source",
      severity: "conflict",
      sourceType: "manual_hook",
      scope: "user",
      safePath: ".codex/z-hook",
    }),
    sources.createSourceFinding({
      code: "owned_marketplace_source",
      severity: "conflict",
      sourceType: "owned_marketplace_registration",
      scope: "user",
      safePath: ".codex/A-marketplace",
    }),
  ];
  const result = sources.createSourceScanResult("deep", findings);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.findings), true);
  assert.equal(Object.isFrozen((result.findings as readonly object[])[0]), true);
  assert.deepEqual(
    (result.findings as readonly Record<string, unknown>[]).map((finding) => finding.safePath),
    [".codex/A-marketplace", ".codex/z-hook"],
  );
  assert.deepEqual(Object.keys((result.findings as readonly object[])[0] ?? {}).sort(), [
    "code",
    "safePath",
    "scope",
    "severity",
    "sourceType",
  ]);
  assert.equal("cleanupPlans" in result, false);
  assert.equal(result.hasConflict, true);
});

test("source finding inputs cannot smuggle retired cleanup authority into output", () => {
  const finding = sources.createSourceFinding({
    code: "owned_plugin_source",
    severity: "conflict",
    sourceType: "owned_plugin",
    scope: "user",
    safePath: ".codex/plugins",
    cleanupEligible: true,
    cleanupCommand: "codex plugin remove kcoderag-nav",
    cleanupFingerprint: `sha256:${"0".repeat(64)}`,
  });
  assert.equal("cleanupEligible" in finding, false);
  assert.equal("cleanupCommand" in finding, false);
  assert.equal("cleanupFingerprint" in finding, false);
});

test("source serialization rejects secret-like paths without echoing them", () => {
  for (const sentinel of SENTINELS) {
    assert.throws(
      () => sources.createSourceFinding({
        code: "raw_mcp_source",
        severity: "conflict",
        sourceType: "raw_mcp",
        scope: "user",
        safePath: sentinel,
      }),
      (error: unknown) => {
        assert.equal(JSON.stringify(error).includes(sentinel), false);
        return (error as { readonly code?: string }).code === "invalid_source_finding";
      },
    );
  }
});
