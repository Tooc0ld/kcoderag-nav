import * as assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

interface AcceptanceEvidenceErrorInstance extends Error {
  readonly stage: string;
  readonly reasonCode: string;
}

interface AcceptanceArtifactReader {
  readWorkflowRun(runId: string, artifactName: string): Promise<readonly unknown[]>;
}

interface AcceptanceEvidenceModule {
  readonly AcceptanceEvidenceError: {
    new (...args: readonly unknown[]): AcceptanceEvidenceErrorInstance;
  };
  buildAcceptanceEvidence(input: Readonly<Record<string, unknown>>): Readonly<Record<string, any>>;
  classifyEvidenceSource(source: string): "PACKAGED" | "LIVE";
  consumeAcceptanceArtifacts(
    input: Readonly<Record<string, unknown>>,
    reader: AcceptanceArtifactReader,
  ): Promise<Readonly<Record<string, any>>>;
  writeAcceptanceEvidence(outputPath: string, document: Readonly<Record<string, unknown>>): void;
}

const receipt = require("../../dist/smoke/acceptance-receipt.cjs") as {
  completeCommonObservations(overrides: Readonly<Record<string, boolean>>): Readonly<Record<string, boolean>>;
  emptyHostObservations(host: string): Readonly<Record<string, boolean>>;
};
const evidence = require("../../dist/maintainer/acceptance-evidence.cjs") as AcceptanceEvidenceModule;
const {
  AcceptanceEvidenceError,
  buildAcceptanceEvidence,
  classifyEvidenceSource,
  consumeAcceptanceArtifacts,
  writeAcceptanceEvidence,
} = evidence;

const CANDIDATE_SHA = "a".repeat(40);
const PACKAGE_MEMBER_DIGEST = "b".repeat(64);
const WORKFLOW_RUN_ID = "run-05-05";

function sha256(bytes: string | Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function collectKeys(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => [key, ...collectKeys(item)]);
}

function packagedReceipt(packageSha256: string, host = "codex"): Record<string, unknown> {
  return {
    schemaVersion: 1,
    host,
    hostVersion: "0.146.1",
    os: "windows",
    nodeVersion: "22.22.0",
    evidenceLevel: "PACKAGED",
    status: "PASS",
    stage: "evidence_integrity",
    reasonCode: "none",
    attempted: true,
    candidateSha: CANDIDATE_SHA,
    packageSha256,
    packageMemberDigest: PACKAGE_MEMBER_DIGEST,
    workflowRunId: WORKFLOW_RUN_ID,
    startedAt: "2026-09-02T00:00:00.000Z",
    completedAt: "2026-09-02T00:00:01.000Z",
    durationMs: 1_000,
    artifactDigest: "c".repeat(64),
    logDigest: "d".repeat(64),
    observations: {
      common: receipt.completeCommonObservations({
        nativeHostProcess: false,
        sessionBaselineObserved: false,
      }),
      host: receipt.emptyHostObservations(host),
    },
  };
}

function evidenceInput(packagePath: string, packageSha256: string, receipt: unknown) {
  return {
    candidateSha: CANDIDATE_SHA,
    packagePath,
    packageSha256,
    packageMemberDigest: PACKAGE_MEMBER_DIGEST,
    workflowRunId: WORKFLOW_RUN_ID,
    evidenceLevel: "PACKAGED" as const,
    sourceKind: "actual_tgz" as const,
    requiredHosts: ["codex"] as const,
    receipts: [receipt],
    preparedAt: "2026-09-02T00:00:02.000Z",
  };
}

test("consumes one actual-tgz PACKAGED Codex receipt without native promotion", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-acceptance-evidence-"));
  const packagePath = path.join(root, "kcoderag-nav-0.3.1.tgz");
  const packageBytes = Buffer.from("exact actual package fixture", "utf8");
  fs.writeFileSync(packagePath, packageBytes);
  const packageSha256 = sha256(packageBytes);

  const document = buildAcceptanceEvidence(
    evidenceInput(packagePath, packageSha256, packagedReceipt(packageSha256)),
  );

  assert.equal(document.aggregateVerdict, "PASS");
  assert.equal(document.evidenceLevel, "PACKAGED");
  assert.equal(document.packageSha256, packageSha256);
  assert.equal(document.receipts[0]?.observations.common.nativeHostProcess, false);
  assert.equal(document.receipts[0]?.observations.common.sessionBaselineObserved, false);
  assert.deepEqual(document.receipts[0]?.observations.host, {
    directMcpRegistrationObserved: false,
    nativeSessionStartObserved: false,
    nativeHookOutputObserved: false,
  });
});

test("validates the exact closed five-host PACKAGED receipt set", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-acceptance-five-host-"));
  const packagePath = path.join(root, "candidate.tgz");
  fs.writeFileSync(packagePath, "candidate");
  const packageSha256 = sha256("candidate");
  const hosts = ["codex", "claude", "cursor", "opencode", "zcode"] as const;
  const document = buildAcceptanceEvidence({
    ...evidenceInput(packagePath, packageSha256, packagedReceipt(packageSha256)),
    requiredHosts: hosts,
    receipts: hosts.map((host) => packagedReceipt(packageSha256, host)),
  });

  assert.equal(document.aggregateVerdict, "PASS");
  assert.deepEqual(document.receipts.map((item: { readonly host: string }) => item.host).sort(), [...hosts].sort());

  const unknownHostObservation = packagedReceipt(packageSha256, "cursor");
  const observations = unknownHostObservation.observations as Record<string, unknown>;
  unknownHostObservation.observations = {
    ...observations,
    host: {
      ...(observations.host as Record<string, unknown>),
      syntheticNativeEvent: true,
    },
  };
  assert.throws(
    () => buildAcceptanceEvidence({
      ...evidenceInput(packagePath, packageSha256, unknownHostObservation),
      requiredHosts: ["cursor"],
    }),
    (error: unknown) => error instanceof AcceptanceEvidenceError
      && error.stage === "evidence_integrity"
      && error.reasonCode === "receipt_invalid",
  );
});

test("LIVE consumption rejects direct-launcher and missing Codex native observations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-acceptance-live-"));
  const packagePath = path.join(root, "candidate.tgz");
  fs.writeFileSync(packagePath, "candidate");
  const packageSha256 = sha256("candidate");
  const packaged = packagedReceipt(packageSha256);

  assert.equal(classifyEvidenceSource("direct_launcher"), "PACKAGED");
  assert.throws(
    () => buildAcceptanceEvidence({
      ...evidenceInput(packagePath, packageSha256, packaged),
      evidenceLevel: "LIVE",
      sourceKind: "direct_launcher",
    }),
    (error: unknown) => error instanceof AcceptanceEvidenceError
      && error.stage === "native_event"
      && error.reasonCode === "native_event_missing",
  );

  const live = structuredClone(packaged);
  live.evidenceLevel = "LIVE";
  assert.throws(
    () => buildAcceptanceEvidence({
      ...evidenceInput(packagePath, packageSha256, live),
      evidenceLevel: "LIVE",
      sourceKind: "native_host",
    }),
    (error: unknown) => error instanceof AcceptanceEvidenceError
      && error.stage === "native_event"
      && error.reasonCode === "native_event_missing",
  );
});

test("fails closed on candidate, package and workflow-run identity mismatch", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-acceptance-identity-"));
  const packagePath = path.join(root, "candidate.tgz");
  fs.writeFileSync(packagePath, "candidate");
  const packageSha256 = sha256("candidate");
  const base = packagedReceipt(packageSha256);

  for (const [mutate, stage, reasonCode] of [
    [(value: Record<string, unknown>) => { value.candidateSha = "e".repeat(40); }, "evidence_integrity", "candidate_mismatch"],
    [(value: Record<string, unknown>) => { value.packageSha256 = "e".repeat(64); }, "package", "package_hash_mismatch"],
    [(value: Record<string, unknown>) => { value.packageMemberDigest = "e".repeat(64); }, "package", "package_inventory_mismatch"],
    [(value: Record<string, unknown>) => { value.workflowRunId = "different-run"; }, "evidence_integrity", "receipt_invalid"],
  ] as const) {
    const receipt = structuredClone(base);
    mutate(receipt);
    assert.throws(
      () => buildAcceptanceEvidence(evidenceInput(packagePath, packageSha256, receipt)),
      (error: unknown) => error instanceof AcceptanceEvidenceError
        && error.stage === stage
        && error.reasonCode === reasonCode,
    );
  }
});

test("rejects missing, unknown and secret-shaped receipt content before serialization", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-acceptance-secret-"));
  const packagePath = path.join(root, "candidate.tgz");
  fs.writeFileSync(packagePath, "candidate");
  const packageSha256 = sha256("candidate");
  const base = packagedReceipt(packageSha256);
  const forbiddenKeys = ["query", "result", "url", "authorization", "header", "bearer", "token", "config"];

  for (const forbidden of forbiddenKeys) {
    const receipt = structuredClone(base);
    receipt[forbidden] = "opaque fixture value";
    assert.throws(
      () => buildAcceptanceEvidence(evidenceInput(packagePath, packageSha256, receipt)),
      (error: unknown) => error instanceof AcceptanceEvidenceError
        && error.stage === "evidence_integrity"
        && error.reasonCode === "secret_detected",
    );
  }

  const missing = structuredClone(base);
  const common = (missing.observations as Record<string, unknown>).common as Record<string, unknown>;
  delete common.searchCodeSucceeded;
  assert.throws(
    () => buildAcceptanceEvidence(evidenceInput(packagePath, packageSha256, missing)),
    (error: unknown) => error instanceof AcceptanceEvidenceError
      && error.reasonCode === "receipt_invalid",
  );
});

test("opens an explicit workflow-run artifact and writes metadata atomically", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-acceptance-reader-"));
  const packagePath = path.join(root, "candidate.tgz");
  const outputPath = path.join(root, "evidence.json");
  fs.writeFileSync(packagePath, "candidate");
  const packageSha256 = sha256("candidate");
  const receipt = packagedReceipt(packageSha256);
  const calls: string[] = [];
  const reader: AcceptanceArtifactReader = {
    async readWorkflowRun(runId, artifactName) {
      calls.push(`${runId}:${artifactName}`);
      return [receipt];
    },
  };

  const document = await consumeAcceptanceArtifacts({
    ...evidenceInput(packagePath, packageSha256, receipt),
    receipts: undefined,
    artifactName: "packaged-codex",
    outputPath,
  }, reader);

  assert.deepEqual(calls, [`${WORKFLOW_RUN_ID}:packaged-codex`]);
  const serialized = JSON.parse(fs.readFileSync(outputPath, "utf8")) as unknown;
  assert.deepEqual(serialized, document);
  assert.equal(fs.readdirSync(root).some((name) => name.includes(".tmp-")), false);
  assert.deepEqual(
    collectKeys(serialized).filter((key) => /^(?:query|result|url|authorization|headers?|bearer|token|config)$/iu.test(key)),
    [],
  );

  const secondOutput = path.join(root, "direct-write.json");
  writeAcceptanceEvidence(secondOutput, document);
  assert.deepEqual(JSON.parse(fs.readFileSync(secondOutput, "utf8")), document);
});
