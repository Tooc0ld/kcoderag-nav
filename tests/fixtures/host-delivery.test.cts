const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor" | "opencode";

interface HostDeliveryReceipt {
  readonly schemaVersion: 1;
  readonly host: HostId;
  readonly version: string;
  readonly stableSessionField: "session_id" | "thread_id" | "conversation_id" | null;
  readonly observations: Readonly<Record<string, boolean>>;
  readonly fixtureDigest: string;
  readonly provenanceDigest: string;
  readonly capturedAt: string;
  readonly verdict: "PASS" | "FAIL" | "UNSUPPORTED";
  readonly reason: string;
}

interface HostDeliveryModule {
  readonly OBSERVATION_KEYS: readonly string[];
  parseHostDeliveryReceipt(value: unknown): HostDeliveryReceipt;
  receiptDigest(value: unknown): string;
  verifyReceiptFile(receiptPath: string, requirePass?: boolean): HostDeliveryReceipt;
  main(argv: readonly string[]): Promise<number>;
}

interface HostVersionSupportModule {
  readonly HOST_VERSION_SUPPORT_ROWS: readonly {
    readonly host: HostId;
    readonly version: string;
    readonly receiptPath: string;
    readonly receiptDigest: string;
  }[];
  evaluateHostVersionSupport(
    host: HostId,
    version: string,
    repositoryRoot?: string,
  ): {
    readonly navigation: true;
    readonly jx3StyleNudge: boolean;
    readonly code?: "host_version_unsupported";
    readonly receiptDigest?: string;
  };
}

const delivery = require("../../dist/fixtures/host-delivery.cjs") as HostDeliveryModule;
const support = require("../../dist/hosts/host-version-support.cjs") as HostVersionSupportModule;
const repositoryRoot = path.resolve(__dirname, "../..");
const receiptPath = path.join(repositoryRoot, "fixtures", "host-delivery", "claude-2.1.241.json");

function completeObservations(overrides: Readonly<Record<string, boolean>> = {}): Readonly<Record<string, boolean>> {
  return Object.freeze({
    ...Object.fromEntries(delivery.OBSERVATION_KEYS.map((key) => [key, true])),
    ...overrides,
  });
}

function validReceipt(overrides: Partial<HostDeliveryReceipt> = {}): HostDeliveryReceipt {
  return {
    schemaVersion: 1,
    host: "claude",
    version: "2.1.241",
    stableSessionField: "session_id",
    observations: completeObservations(),
    fixtureDigest: "a".repeat(64),
    provenanceDigest: "b".repeat(64),
    capturedAt: "2026-08-26T00:00:00.000Z",
    verdict: "PASS",
    reason: "verified",
    ...overrides,
  };
}

test("closed receipt schema accepts only complete native Claude PASS evidence", () => {
  assert.deepEqual(delivery.OBSERVATION_KEYS, [
    "nativeInstall",
    "cppCreated",
    "cppModified",
    "luaWritten",
    "structuredTargets",
    "stableSessionRepeated",
    "sentinelVisible",
    "sentinelOnce",
    "validWriteCompleted",
    "emptyWriteCompleted",
    "malformedWriteCompleted",
    "nonzeroWriteCompleted",
    "timeoutWriteCompleted",
  ]);

  const parsed = delivery.parseHostDeliveryReceipt(validReceipt());
  assert.equal(parsed.verdict, "PASS");
  assert.equal(parsed.reason, "verified");
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.observations), true);
  assert.match(delivery.receiptDigest(parsed), /^[a-f0-9]{64}$/u);

  for (const key of delivery.OBSERVATION_KEYS) {
    assert.throws(
      () => delivery.parseHostDeliveryReceipt(validReceipt({
        observations: completeObservations({ [key]: false }),
      })),
      { message: "invalid_receipt" },
      `${key} must be mandatory for PASS`,
    );
  }
});

test("receipt validation rejects extra fields, secret canaries, raw paths, and unbound PASS claims", () => {
  assert.throws(
    () => delivery.parseHostDeliveryReceipt({ ...validReceipt(), prompt: "private prompt" }),
    { message: "invalid_receipt" },
  );
  assert.throws(
    () => delivery.parseHostDeliveryReceipt({
      ...validReceipt(),
      reason: "Bearer private-token",
    }),
    { message: "invalid_receipt" },
  );
  assert.throws(
    () => delivery.parseHostDeliveryReceipt({
      ...validReceipt(),
      stableSessionField: "raw-session-id",
    }),
    { message: "invalid_receipt" },
  );
  assert.throws(
    () => delivery.parseHostDeliveryReceipt({
      ...validReceipt(),
      capturedAt: "D:/private/project",
    }),
    { message: "invalid_receipt" },
  );
});

test("require-pass rejects valid non-PASS receipts without disclosing their contents", async () => {
  const temporaryReceipt = path.join(repositoryRoot, ".tmp-host-delivery-nonpass.json");
  const nonPass = validReceipt({
    stableSessionField: null,
    observations: completeObservations({ sentinelVisible: false }),
    verdict: "UNSUPPORTED",
    reason: "native_context_unproved",
  });
  fs.writeFileSync(temporaryReceipt, `${JSON.stringify(nonPass, null, 2)}\n`, "utf8");
  try {
    assert.equal(delivery.verifyReceiptFile(temporaryReceipt).verdict, "UNSUPPORTED");
    assert.throws(
      () => delivery.verifyReceiptFile(temporaryReceipt, true),
      { message: "receipt_not_pass" },
    );
    assert.equal(await delivery.main([
      "--verify", "--receipt", temporaryReceipt, "--require-pass",
    ]), 1);
  } finally {
    fs.rmSync(temporaryReceipt, { force: true });
  }
});

test("Claude support is exact-version and frozen-receipt-digest bound", () => {
  const receipt = delivery.verifyReceiptFile(receiptPath, true);
  const digest = delivery.receiptDigest(receipt);
  const row = support.HOST_VERSION_SUPPORT_ROWS.find((candidate) => candidate.host === "claude");
  assert.deepEqual(row, {
    host: "claude",
    version: "2.1.241",
    receiptPath: "fixtures/host-delivery/claude-2.1.241.json",
    receiptDigest: digest,
  });

  assert.deepEqual(support.evaluateHostVersionSupport("claude", "2.1.241", repositoryRoot), {
    navigation: true,
    jx3StyleNudge: true,
    receiptDigest: digest,
  });
  for (const version of ["2.1.240", "2.1.242", "invalid"]) {
    assert.deepEqual(support.evaluateHostVersionSupport("claude", version, repositoryRoot), {
      navigation: true,
      jx3StyleNudge: false,
      code: "host_version_unsupported",
    });
  }
});

