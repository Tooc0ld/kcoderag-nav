const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const acceptance = require("../../dist/maintainer/head-acceptance.cjs") as {
  readonly validateHeadAcceptance: (value: unknown) => Readonly<Record<string, unknown>>;
};

const RELEASE_SHA = "1".repeat(40);
const ACCEPTANCE_COMMIT_SHA = "2".repeat(40);
const TAR_SHA256 = "3".repeat(64);
const ARTIFACT_SHA512 = "ab".repeat(64);
const DIST_INTEGRITY = `sha512-${Buffer.from(ARTIFACT_SHA512, "hex").toString("base64")}`;
const CLEANUP_FINGERPRINT = "sha256:612aca1ad8d2e4d370fa4755e5c15df2e5cb9d2d180f4afed8bbd7658bac0dac";
const STATE_DIGEST = `sha256:${"5".repeat(64)}`;
const LAUNCHER_DIGEST = `sha256:${"6".repeat(64)}`;
const MANAGED_PATHS = Object.freeze([
  ".agents/skills/kcoderag-nav/SKILL.md",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".codex/kcoderag-nav/qa/hooks/grep-nudge.cjs",
  ".codex/kcoderag-nav/qa/hooks/run_hook.cmd",
  ".codex/kcoderag-nav/qa/hooks/run_hook.sh",
  ".codex/kcoderag-nav/qa/hooks/update-check.cjs",
  ".codex/kcoderag-nav/qa/hooks/update-worker.cjs",
  ".codex/kcoderag-nav/install-state.json",
] as const);

function publicationIdentity(): Record<string, unknown> {
  return {
    package: "kcoderag-nav",
    version: "0.2.0",
    tag: "v0.2.0",
    releaseSha: RELEASE_SHA,
    gitHead: RELEASE_SHA,
    distIntegrity: DIST_INTEGRITY,
    tarSha256: TAR_SHA256,
    artifactSha512: ARTIFACT_SHA512,
  };
}

function unchanged(digit: string): Record<string, unknown> {
  return { unchanged: true, digest: `sha256:${digit.repeat(64)}` };
}

function validFixture(): Record<string, any> {
  return {
    schemaVersion: 1,
    publication: {
      receipt: publicationIdentity(),
      validatedReceipt: publicationIdentity(),
    },
    baseline: {
      selectedHost: "codex",
      managedDriftCount: 0,
      finding: {
        count: 1,
        code: "owned_marketplace_source",
        sourceType: "owned_marketplace_registration",
        scope: "user",
        marketplaceName: "kcoderag-nav",
        safePath: ".codex/config.toml",
        sourcePathDigest: `sha256:${"7".repeat(64)}`,
        recognizedSourcePathDigest: `sha256:${"7".repeat(64)}`,
        provenanceId: "kcoderag-nav-repository-v1",
        failureAttribution: "marketplace_load",
        pluginListErrorCode: "marketplace_load",
        marketplaceListErrorCode: "marketplace_load",
        exclusiveUserMarketplace: true,
        cleanupEligible: true,
      },
      capability: {
        host: "codex",
        cli: "codex",
        minimumVersion: "0.146.1",
        observedVersion: "0.200.0",
        inventorySchemaId: "codex-plugin-v1",
        completeInventory: false,
        route: "degraded_owned_registration",
        marketplaceRemoveSupported: true,
      },
      cleanupPlanFingerprint: CLEANUP_FINGERPRINT,
    },
    cleanup: {
      planFingerprint: CLEANUP_FINGERPRINT,
      replayedFingerprint: CLEANUP_FINGERPRINT,
      native: {
        argv: ["codex", "plugin", "marketplace", "remove", "kcoderag-nav", "--json"],
        timeoutMs: 5_000,
        exitCode: 0,
        timedOut: false,
        success: true,
      },
      postRemoval: {
        beforeProjectWrites: true,
        plugins: {
          argv: ["codex", "plugin", "list", "--json"],
          timeoutMs: 5_000,
          success: true,
          complete: true,
          ownedSourceAbsent: true,
        },
        marketplaces: {
          argv: ["codex", "plugin", "marketplace", "list", "--json"],
          timeoutMs: 5_000,
          success: true,
          complete: true,
          ownedSourceAbsent: true,
        },
      },
    },
    final: {
      status: {
        schemaVersion: 1,
        host: "codex",
        environment: "qa",
        packageVersion: "0.2.0",
        status: "healthy",
        activeConflictCount: 0,
        managedDriftCount: 0,
      },
      doctor: {
        schemaVersion: 1,
        host: "codex",
        environment: "qa",
        packageVersion: "0.2.0",
        status: "healthy",
        ok: true,
        activeConflictCount: 0,
        managedDriftCount: 0,
      },
      hooks: {
        root: {
          ran: true,
          nearestStateDigest: STATE_DIGEST,
          launcherDigest: LAUNCHER_DIGEST,
          protocolClass: "advisory",
        },
        deep: {
          ran: true,
          unicodeAndSpaceCwd: true,
          nearestStateDigest: STATE_DIGEST,
          launcherDigest: LAUNCHER_DIGEST,
          protocolClass: "advisory",
        },
      },
    },
    scope: {
      declaredCodexManagedPaths: [...MANAGED_PATHS],
      changed: [
        ...MANAGED_PATHS.map((id, index) => ({
          kind: "managed",
          id,
          fingerprint: `sha256:${String((index % 9) + 1).repeat(64)}`,
        })),
        { kind: "cleanup", id: "marketplace:kcoderag-nav", fingerprint: CLEANUP_FINGERPRINT },
      ],
      unchanged: {
        unrelatedHeadPaths: unchanged("8"),
        claudeProjectTree: unchanged("9"),
        cursorProjectTree: unchanged("a"),
        siblingProjects: unchanged("b"),
        unrelatedCodexUserConfig: unchanged("c"),
      },
    },
    acceptance: {
      receiptSha256: `sha256:${"d".repeat(64)}`,
      receiptCommitSha: ACCEPTANCE_COMMIT_SHA,
      publicReceiptSha256: `sha256:${"e".repeat(64)}`,
      publicReleaseSha: RELEASE_SHA,
    },
  };
}

function expectCode(mutator: (fixture: Record<string, any>) => void, code: string): void {
  const fixture = validFixture();
  mutator(fixture);
  assert.throws(
    () => acceptance.validateHeadAcceptance(fixture),
    (error: unknown) => {
      assert.deepEqual(
        { name: (error as Error).name, message: (error as Error).message, code: (error as { code?: unknown }).code },
        { name: "HeadAcceptanceError", message: code, code },
      );
      return true;
    },
  );
}

test("accepts exact 0.2.0 publication, degraded cleanup, healthy Head, hook, and scope evidence", () => {
  const result = acceptance.validateHeadAcceptance(validFixture());
  assert.deepEqual(result, {
    ok: true,
    version: "0.2.0",
    releaseSha: RELEASE_SHA,
    acceptanceCommitSha: ACCEPTANCE_COMMIT_SHA,
    managedPathCount: MANAGED_PATHS.length,
  });
  assert.equal(Object.isFrozen(result), true);
});

test("rejects version, artifact, release, and publication-receipt mismatch", () => {
  expectCode((fixture) => { fixture.publication.receipt.version = "0.2.1"; }, "publication_identity_mismatch");
  expectCode((fixture) => { fixture.publication.receipt.gitHead = "f".repeat(40); }, "publication_identity_mismatch");
  expectCode((fixture) => { fixture.publication.receipt.distIntegrity = "sha512-invalid"; }, "invalid_publication_identity");
  expectCode((fixture) => { fixture.publication.validatedReceipt.tarSha256 = "f".repeat(64); }, "publication_receipt_mismatch");
});

test("rejects baseline drift or any degraded-owned identity substitution", () => {
  expectCode((fixture) => { fixture.baseline.managedDriftCount = 1; }, "baseline_drift");
  expectCode((fixture) => { fixture.baseline.finding.marketplaceName = "other"; }, "degraded_source_mismatch");
  expectCode((fixture) => { fixture.baseline.finding.recognizedSourcePathDigest = `sha256:${"8".repeat(64)}`; }, "degraded_source_mismatch");
  expectCode((fixture) => { fixture.baseline.finding.provenanceId = "other"; }, "degraded_source_mismatch");
  expectCode((fixture) => { fixture.baseline.capability.route = "normal"; }, "cleanup_capability_mismatch");
  expectCode((fixture) => { fixture.baseline.capability.observedVersion = "0.201.0"; }, "cleanup_fingerprint_mismatch");
});

test("rejects changed fingerprints, native identity drift, and incomplete post-removal inventories", () => {
  expectCode((fixture) => { fixture.cleanup.replayedFingerprint = `sha256:${"0".repeat(64)}`; }, "cleanup_fingerprint_mismatch");
  expectCode((fixture) => { fixture.cleanup.native.argv[3] = "add"; }, "cleanup_native_mismatch");
  expectCode((fixture) => { fixture.cleanup.native.timeoutMs = 5_001; }, "cleanup_native_mismatch");
  expectCode((fixture) => { fixture.cleanup.postRemoval.beforeProjectWrites = false; }, "post_removal_incomplete");
  expectCode((fixture) => { fixture.cleanup.postRemoval.plugins.complete = false; }, "post_removal_incomplete");
  expectCode((fixture) => { fixture.cleanup.postRemoval.marketplaces.ownedSourceAbsent = false; }, "post_removal_incomplete");
});

test("rejects unhealthy final diagnostics or root/deep Hook identity divergence", () => {
  expectCode((fixture) => { fixture.final.status.activeConflictCount = 1; }, "final_diagnostics_unhealthy");
  expectCode((fixture) => { fixture.final.doctor.ok = false; }, "final_diagnostics_unhealthy");
  expectCode((fixture) => { fixture.final.hooks.deep.nearestStateDigest = `sha256:${"0".repeat(64)}`; }, "hook_identity_mismatch");
  expectCode((fixture) => { fixture.final.hooks.deep.unicodeAndSpaceCwd = false; }, "hook_execution_incomplete");
});

test("rejects undeclared changes, unrelated mutations, or a public-identity acceptance receipt", () => {
  expectCode((fixture) => { fixture.scope.changed.pop(); }, "changed_scope_mismatch");
  expectCode((fixture) => { fixture.scope.changed.push({ kind: "managed", id: ".codex/other", fingerprint: STATE_DIGEST }); }, "changed_scope_mismatch");
  expectCode((fixture) => { fixture.scope.unchanged.claudeProjectTree.unchanged = false; }, "unrelated_scope_changed");
  expectCode((fixture) => { fixture.acceptance.receiptSha256 = fixture.acceptance.publicReceiptSha256; }, "acceptance_identity_not_separate");
  expectCode((fixture) => { fixture.acceptance.receiptCommitSha = RELEASE_SHA; }, "acceptance_identity_not_separate");
});

test("rejects arbitrary sensitive or raw evidence fields without echoing their values", () => {
  expectCode((fixture) => { fixture.headers = { Authorization: "redacted" }; }, "invalid_acceptance_schema");
  expectCode((fixture) => { fixture.cleanup.native.stdout = "raw process body"; }, "invalid_acceptance_schema");
  expectCode((fixture) => { fixture.baseline.finding.sourcePath = "C:/absolute/user/path"; }, "invalid_acceptance_schema");
  expectCode((fixture) => { fixture.publication.receipt.registryUrl = "https://registry.npmjs.org/"; }, "invalid_acceptance_schema");
});
