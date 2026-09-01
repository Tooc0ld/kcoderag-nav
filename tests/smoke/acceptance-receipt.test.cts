/** Closed Phase 05 receipt state-machine tests. */

const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const test: typeof import("node:test") = require("node:test");

type HostId = "codex" | "claude" | "cursor" | "opencode" | "zcode";

interface ReceiptModule {
  readonly RECEIPT_STATUSES: readonly string[];
  readonly AGGREGATE_VERDICTS: readonly string[];
  readonly RECEIPT_STAGES: readonly string[];
  readonly RECEIPT_REASON_CODE_STAGES: Readonly<Record<string, string>>;
  readonly COMMON_OBSERVATION_KEYS: readonly string[];
  readonly HOST_OBSERVATION_KEYS: Readonly<Record<HostId, readonly string[]>>;
  completeCommonObservations(overrides?: Readonly<Record<string, boolean>>): Readonly<Record<string, boolean>>;
  completeHostObservations(host: HostId, overrides?: Readonly<Record<string, boolean>>): Readonly<Record<string, boolean>>;
  createHostReceipt(input: Readonly<Record<string, unknown>>): Readonly<Record<string, any>>;
  parseHostReceipt(input: unknown): Readonly<Record<string, any>>;
  aggregateHostReceipts(
    receipts: readonly unknown[],
    options?: { readonly requiredHosts?: readonly HostId[]; readonly candidateSha?: string },
  ): "PASS" | "FAIL" | "INCOMPLETE";
}

const receipt = require("../../dist/smoke/acceptance-receipt.cjs") as ReceiptModule;

const DIGEST = "a".repeat(64);

function baseReceipt(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  const host = (overrides.host ?? "codex") as HostId;
  return {
    schemaVersion: 1,
    host,
    hostVersion: "0.146.1",
    os: "windows",
    nodeVersion: "22.18.0",
    evidenceLevel: "LIVE",
    status: "PASS",
    stage: "evidence_integrity",
    reasonCode: "none",
    attempted: true,
    candidateSha: DIGEST,
    packageSha256: "b".repeat(64),
    packageMemberDigest: "c".repeat(64),
    workflowRunId: "run-123",
    startedAt: "2026-09-02T00:00:00.000Z",
    completedAt: "2026-09-02T00:00:01.000Z",
    durationMs: 1_000,
    artifactDigest: "d".repeat(64),
    logDigest: "e".repeat(64),
    observations: {
      common: receipt.completeCommonObservations(),
      host: receipt.completeHostObservations(host),
    },
    ...overrides,
  };
}

test("receipt and aggregate vocabularies are separate closed enums", () => {
  assert.deepEqual(receipt.RECEIPT_STATUSES, ["PASS", "FAIL", "NOT_RUN"]);
  assert.deepEqual(receipt.AGGREGATE_VERDICTS, ["PASS", "FAIL", "INCOMPLETE"]);
  assert.deepEqual(receipt.RECEIPT_STAGES, [
    "environment",
    "admission",
    "package",
    "install",
    "native_event",
    "prompt_semantics",
    "mcp",
    "feedback",
    "evidence_integrity",
  ]);
  assert.throws(() => receipt.parseHostReceipt({ ...baseReceipt(), status: "INCOMPLETE" }), /invalid_receipt/u);
});

test("every reasonCode has one exact stage and accepted status combination", () => {
  const expected: Readonly<Record<string, readonly string[]>> = {
    environment: ["host_unavailable", "runner_unavailable", "node_version_unsupported"],
    admission: ["host_version_unsupported", "workspace_trust_missing", "protected_environment_denied", "untrusted_ref"],
    package: ["package_acquisition_failed", "package_hash_mismatch", "package_inventory_mismatch"],
    install: ["install_failed", "status_unhealthy", "update_failed", "uninstall_failed"],
    native_event: ["native_event_missing", "native_event_failed"],
    prompt_semantics: ["prompt_missing", "prompt_unexpected", "prompt_dedupe_failed"],
    mcp: ["mcp_registration_missing", "list_indexes_unavailable", "mcp_call_failed", "structured_result_invalid"],
    feedback: ["feedback_reminder_missing", "submit_feedback_failed", "feedback_suppression_failed"],
    evidence_integrity: ["candidate_mismatch", "receipt_invalid", "secret_detected", "cleanup_failed"],
  };
  assert.deepEqual(
    Object.fromEntries(receipt.RECEIPT_STAGES.map((stage) => [
      stage,
      Object.entries(receipt.RECEIPT_REASON_CODE_STAGES)
        .filter(([, mappedStage]) => mappedStage === stage)
        .map(([reasonCode]) => reasonCode),
    ])),
    expected,
  );

  for (const [stage, reasonCodes] of Object.entries(expected)) {
    for (const reasonCode of reasonCodes) {
      const status = stage === "environment" || stage === "admission" ? "NOT_RUN" : "FAIL";
      const parsed = receipt.parseHostReceipt(baseReceipt({
        status,
        stage,
        reasonCode,
        attempted: status === "FAIL",
        observations: {
          common: receipt.completeCommonObservations({ packageInstalled: false }),
          host: receipt.completeHostObservations("codex", { directMcpRegistrationObserved: false }),
        },
      }));
      assert.equal(parsed.reasonCode, reasonCode);

      const wrongStage = receipt.RECEIPT_STAGES.find((candidate) => candidate !== stage);
      assert.throws(() => receipt.parseHostReceipt(baseReceipt({
        status,
        stage: wrongStage,
        reasonCode,
        attempted: status === "FAIL",
      })), /invalid_receipt/u);
    }
  }
});

test("PASS, FAIL and NOT_RUN enforce attempted and observation implications", () => {
  assert.equal(receipt.createHostReceipt(baseReceipt()).status, "PASS");
  assert.throws(() => receipt.createHostReceipt(baseReceipt({ reasonCode: "receipt_invalid" })), /invalid_receipt/u);
  assert.throws(() => receipt.createHostReceipt(baseReceipt({ attempted: false })), /invalid_receipt/u);
  assert.throws(() => receipt.createHostReceipt(baseReceipt({
    observations: {
      common: receipt.completeCommonObservations({ searchCodeSucceeded: false }),
      host: receipt.completeHostObservations("codex"),
    },
  })), /invalid_receipt/u);

  assert.throws(() => receipt.createHostReceipt(baseReceipt({
    status: "FAIL",
    stage: "mcp",
    reasonCode: "mcp_call_failed",
    attempted: false,
  })), /invalid_receipt/u);
  assert.equal(receipt.createHostReceipt(baseReceipt({
    status: "FAIL",
    stage: "mcp",
    reasonCode: "mcp_call_failed",
  })).status, "FAIL");

  assert.equal(receipt.createHostReceipt(baseReceipt({
    status: "NOT_RUN",
    stage: "environment",
    reasonCode: "runner_unavailable",
    attempted: false,
    observations: {
      common: receipt.completeCommonObservations({ packageInstalled: false }),
      host: receipt.completeHostObservations("codex", { directMcpRegistrationObserved: false }),
    },
  })).status, "NOT_RUN");
  assert.throws(() => receipt.createHostReceipt(baseReceipt({
    status: "NOT_RUN",
    stage: "mcp",
    reasonCode: "mcp_call_failed",
    attempted: false,
  })), /invalid_receipt/u);
});

test("PACKAGED PASS closes packaged observations but cannot claim native observations", () => {
  const packaged = receipt.createHostReceipt(baseReceipt({
    evidenceLevel: "PACKAGED",
    observations: {
      common: receipt.completeCommonObservations({
        nativeHostProcess: false,
        sessionBaselineObserved: false,
      }),
      host: receipt.completeHostObservations("codex", {
        directMcpRegistrationObserved: false,
        nativeSessionStartObserved: false,
        nativeHookOutputObserved: false,
      }),
    },
  }));
  assert.equal(packaged.status, "PASS");
  assert.equal(packaged.observations.common.nativeHostProcess, false);

  assert.throws(() => receipt.createHostReceipt(baseReceipt({
    evidenceLevel: "PACKAGED",
  })), /invalid_receipt/u);
  assert.throws(() => receipt.createHostReceipt(baseReceipt({
    evidenceLevel: "LIVE",
    observations: {
      common: receipt.completeCommonObservations({ nativeHostProcess: false }),
      host: receipt.completeHostObservations("codex"),
    },
  })), /invalid_receipt/u);
});

test("closed common and per-host observation schemas reject omissions, unknown fields and secret material", () => {
  assert.deepEqual(receipt.COMMON_OBSERVATION_KEYS, [
    "packageInstalled",
    "statusHealthy",
    "updateIdempotent",
    "uninstallRestored",
    "nativeHostProcess",
    "sessionBaselineObserved",
    "mcpRegistered",
    "listIndexesSucceeded",
    "searchCodeSucceeded",
    "structuredResultValid",
    "feedbackReminderObserved",
    "submitFeedbackSucceeded",
    "feedbackSuppressed",
    "malformedFailOpen",
    "successMarkerRecorded",
    "processTreeCleaned",
  ]);
  assert.deepEqual(receipt.HOST_OBSERVATION_KEYS.codex, [
    "directMcpRegistrationObserved",
    "nativeSessionStartObserved",
    "nativeHookOutputObserved",
  ]);
  assert.deepEqual(receipt.HOST_OBSERVATION_KEYS.claude, [
    "nativeSessionStartObserved",
    "nativeGrepHookObserved",
    "nativeGlobHookObserved",
    "nativeBashHookObserved",
  ]);
  assert.deepEqual(receipt.HOST_OBSERVATION_KEYS.cursor, [
    "reloadObserved",
    "realMcpObserved",
    "ruleObserved",
    "skillObserved",
    "afterMcpExecutionObserved",
  ]);
  assert.deepEqual(receipt.HOST_OBSERVATION_KEYS.opencode, [
    "projectLifecycleObserved",
    "pluginLoaded",
    "pluginCallbackObserved",
    "realToolBehaviorObserved",
  ]);
  assert.deepEqual(receipt.HOST_OBSERVATION_KEYS.zcode, [
    "frozenVersionMatched",
    "workspaceTrustApproved",
    "workspaceSkillObserved",
    "nativePreToolObserved",
    "nativePostToolObserved",
  ]);

  const valid = baseReceipt();
  assert.equal(Object.isFrozen(receipt.parseHostReceipt(valid)), true);
  assert.throws(() => receipt.parseHostReceipt({ ...valid, unexpected: true }), /invalid_receipt/u);
  assert.throws(() => receipt.parseHostReceipt({
    ...valid,
    observations: {
      ...(valid.observations as Record<string, unknown>),
      common: { ...receipt.completeCommonObservations(), extra: true },
    },
  }), /invalid_receipt/u);
  assert.throws(() => receipt.parseHostReceipt({
    ...valid,
    workflowRunId: "Bearer secret-canary",
  }), /invalid_receipt/u);
  assert.throws(() => receipt.parseHostReceipt({
    ...valid,
    authorizationHeader: "secret-canary",
  }), /invalid_receipt/u);
});

test("aggregate verdict never serializes INCOMPLETE into a host receipt", () => {
  const hosts: HostId[] = ["codex", "claude", "cursor", "opencode", "zcode"];
  const passing = hosts.map((host) => receipt.createHostReceipt(baseReceipt({
    host,
    hostVersion: host === "zcode" ? "0.0.0" : "1.0.0",
    observations: {
      common: receipt.completeCommonObservations(),
      host: receipt.completeHostObservations(host),
    },
  })));
  assert.equal(receipt.aggregateHostReceipts(passing, { requiredHosts: hosts, candidateSha: DIGEST }), "PASS");
  assert.equal(receipt.aggregateHostReceipts(passing.slice(0, -1), { requiredHosts: hosts }), "INCOMPLETE");

  const failed = receipt.createHostReceipt(baseReceipt({
    status: "FAIL",
    stage: "feedback",
    reasonCode: "submit_feedback_failed",
  }));
  assert.equal(receipt.aggregateHostReceipts([failed], { requiredHosts: ["codex"] }), "FAIL");

  const notRun = receipt.createHostReceipt(baseReceipt({
    status: "NOT_RUN",
    stage: "admission",
    reasonCode: "workspace_trust_missing",
    attempted: false,
    observations: {
      common: receipt.completeCommonObservations({ packageInstalled: false }),
      host: receipt.completeHostObservations("codex", { nativeHostProcessObserved: false }),
    },
  }));
  assert.equal(receipt.aggregateHostReceipts([notRun], { requiredHosts: ["codex"] }), "INCOMPLETE");
});
