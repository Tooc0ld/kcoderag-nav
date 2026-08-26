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
const expectedReceipts = Object.freeze([
  { host: "claude" as const, version: "2.1.241", verdict: "PASS" as const, reason: "verified" },
  {
    host: "codex" as const,
    version: "0.146.1",
    verdict: "UNSUPPORTED" as const,
    reason: "native_context_unproved",
  },
  {
    host: "cursor" as const,
    version: "3.17.8",
    verdict: "UNSUPPORTED" as const,
    reason: "headless_host_unsupported",
  },
  {
    host: "opencode" as const,
    version: "1.18.23",
    verdict: "UNSUPPORTED" as const,
    reason: "native_context_unproved",
  },
]);

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

test("published support table is self-contained and never needs repository receipts at runtime", () => {
  const isolatedRoot = fs.mkdtempSync(path.join(repositoryRoot, ".tmp-host-support-runtime-"));
  const isolatedModule = path.join(isolatedRoot, "host-version-support.cjs");
  try {
    fs.copyFileSync(path.join(repositoryRoot, "dist", "hosts", "host-version-support.cjs"), isolatedModule);
    const isolated = require(isolatedModule) as HostVersionSupportModule;
    assert.deepEqual(isolated.evaluateHostVersionSupport("claude", "2.1.241", path.join(isolatedRoot, "absent")), {
      navigation: true,
      jx3StyleNudge: true,
      receiptDigest: support.HOST_VERSION_SUPPORT_ROWS[0]?.receiptDigest,
    });
    assert.deepEqual(isolated.evaluateHostVersionSupport("opencode", "1.18.23", path.join(isolatedRoot, "absent")), {
      navigation: true,
      jx3StyleNudge: false,
      code: "host_version_unsupported",
    });
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
});

test("every real host probe emits one closed receipt without inferring unsupported PASS claims", () => {
  for (const expected of expectedReceipts) {
    const fixturePath = path.join(
      repositoryRoot,
      "fixtures",
      "host-delivery",
      `${expected.host}-${expected.version}.json`,
    );
    const receipt = delivery.verifyReceiptFile(fixturePath);
    assert.equal(receipt.host, expected.host);
    assert.equal(receipt.version, expected.version);
    assert.equal(receipt.verdict, expected.verdict);
    assert.equal(receipt.reason, expected.reason);
    assert.equal(receipt.observations.nativeInstall, true);
    assert.match(delivery.receiptDigest(receipt), /^[a-f0-9]{64}$/u);

    if (receipt.verdict !== "PASS") {
      assert.equal(receipt.stableSessionField, null);
      assert.equal(
        delivery.OBSERVATION_KEYS.some((key) => receipt.observations[key] !== true),
        true,
      );
      assert.throws(() => delivery.verifyReceiptFile(fixturePath, true), {
        message: "receipt_not_pass",
      });
    }
  }
});

test("JX3 support rows are exact and exist only for frozen PASS receipts", () => {
  assert.deepEqual(
    support.HOST_VERSION_SUPPORT_ROWS.map(({ host, version }) => ({ host, version })),
    [{ host: "claude", version: "2.1.241" }],
  );

  for (const expected of expectedReceipts) {
    const result = support.evaluateHostVersionSupport(expected.host, expected.version, repositoryRoot);
    assert.equal(result.navigation, true);
    assert.equal(result.jx3StyleNudge, expected.verdict === "PASS");
    if (expected.verdict !== "PASS") {
      assert.equal(result.code, "host_version_unsupported");
      assert.equal(result.receiptDigest, undefined);
    }
  }
});
