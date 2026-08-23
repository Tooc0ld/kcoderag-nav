const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor";
type SmokeMode = "required-contract" | "optional-live";
type SmokeStatus = "PASS" | "FAIL" | "NOT_RUN";

interface SmokeEvidence {
  readonly packageAcquired: boolean;
  readonly install: boolean;
  readonly status: boolean;
  readonly toolRegistration: boolean;
  readonly navigation: boolean;
  readonly mcpInitialize: boolean;
  readonly mcpList: boolean;
  readonly mcpCall: boolean;
  readonly update: boolean;
  readonly uninstall: boolean;
  readonly stubReceipt: boolean;
}

interface HostSmokeResult {
  readonly schemaVersion: 1;
  readonly host: HostId;
  readonly mode: SmokeMode;
  readonly status: SmokeStatus;
  readonly reason: string;
  readonly evidence: SmokeEvidence;
}

interface SmokeModule {
  readonly EVIDENCE_KEYS: readonly (keyof SmokeEvidence)[];
  completeEvidence(overrides?: Partial<SmokeEvidence>): SmokeEvidence;
  evaluateHostEvidence(input: {
    readonly host: HostId;
    readonly mode: SmokeMode;
    readonly evidence?: Partial<SmokeEvidence>;
    readonly unavailableReason?: string;
    readonly failureReason?: string;
  }): HostSmokeResult;
  smokeExitCode(result: {
    readonly mode: SmokeMode;
    readonly status: SmokeStatus;
  }): number;
  runHostSmoke(options: {
    readonly mode: SmokeMode;
    readonly packageSpec: string;
    readonly temporaryRoot: string;
    readonly hosts?: readonly HostId[];
  }, dependencies?: {
    readonly acquirePackage?: (packageSpec: string, root: string) => Promise<string>;
  }): Promise<{
    readonly schemaVersion: 1;
    readonly mode: SmokeMode;
    readonly status: SmokeStatus;
    readonly hosts: readonly HostSmokeResult[];
  }>;
}

interface StubModule {
  readonly MCP_PATH: string;
  readonly SYNTHETIC_TOOL: string;
  startStubMcpServer(receiptPath: string): Promise<{
    readonly url: string;
    close(): Promise<void>;
  }>;
  readReceipts(receiptPath: string): readonly Readonly<Record<string, unknown>>[];
}

const smoke = require("../../dist/smoke/host-smoke.cjs") as SmokeModule;
const stub = require("../../dist/smoke/stub-mcp-server.cjs") as StubModule;

async function postJson(url: string, payload: unknown): Promise<{ status: number; body?: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-private-header": "must-not-be-recorded" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return {
    status: response.status,
    ...(text.length === 0 ? {} : { body: JSON.parse(text) }),
  };
}

test("required contract has an explicit all-evidence PASS matrix", () => {
  assert.deepEqual(smoke.EVIDENCE_KEYS, [
    "packageAcquired",
    "install",
    "status",
    "toolRegistration",
    "navigation",
    "mcpInitialize",
    "mcpList",
    "mcpCall",
    "update",
    "uninstall",
    "stubReceipt",
  ]);

  const passing = smoke.evaluateHostEvidence({
    host: "codex",
    mode: "required-contract",
    evidence: smoke.completeEvidence(),
  });
  assert.equal(passing.status, "PASS");
  assert.equal(passing.reason, "verified");
  assert.equal(smoke.smokeExitCode(passing), 0);

  for (const key of smoke.EVIDENCE_KEYS) {
    const evidence = smoke.completeEvidence({ [key]: false });
    const result = smoke.evaluateHostEvidence({
      host: "claude",
      mode: "required-contract",
      evidence,
    });
    assert.equal(result.status, "FAIL", `${key} must be required`);
    assert.equal(result.reason, "evidence_incomplete");
    assert.equal(smoke.smokeExitCode(result), 1);
  }

  const unavailable = smoke.evaluateHostEvidence({
    host: "cursor",
    mode: "required-contract",
    unavailableReason: "package_unavailable",
  });
  assert.equal(unavailable.status, "NOT_RUN");
  assert.equal(smoke.smokeExitCode(unavailable), 1);
});

test("optional live keeps NOT_RUN honest and never converts a failure into success", () => {
  const unavailable = smoke.evaluateHostEvidence({
    host: "codex",
    mode: "optional-live",
    unavailableReason: "host_cli_missing",
  });
  assert.equal(unavailable.status, "NOT_RUN");
  assert.equal(unavailable.reason, "host_cli_missing");
  assert.equal(smoke.smokeExitCode(unavailable), 0);

  const failed = smoke.evaluateHostEvidence({
    host: "claude",
    mode: "optional-live",
    evidence: smoke.completeEvidence({ mcpCall: false }),
    failureReason: "host_execution_failed",
  });
  assert.equal(failed.status, "FAIL");
  assert.equal(smoke.smokeExitCode(failed), 1);

  const passing = smoke.evaluateHostEvidence({
    host: "claude",
    mode: "optional-live",
    evidence: smoke.completeEvidence(),
  });
  assert.equal(passing.status, "PASS");
  assert.equal(smoke.smokeExitCode(passing), 0);
});

test("loopback stub performs initialize, list, and call with metadata-only receipts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-node-stub-"));
  const receiptPath = path.join(root, "receipts.jsonl");
  const server = await stub.startStubMcpServer(receiptPath);
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/u);
    const initialized = await postJson(server.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "contract-smoke", version: "1" } },
    });
    assert.equal(initialized.status, 200);
    assert.equal(initialized.body.result.serverInfo.name, "synthetic-loopback");

    const listed = await postJson(server.url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    assert.deepEqual(listed.body.result.tools.map((tool: { name: string }) => tool.name), [
      "search_code",
    ]);

    const called = await postJson(server.url, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "search_code", arguments: { query: "SyntheticSymbol" } },
    });
    assert.equal(called.body.result.isError, false);
  } finally {
    await server.close();
  }

  const receipts = stub.readReceipts(receiptPath);
  assert.deepEqual(
    receipts.map((receipt) => [receipt.method, receipt.toolName]),
    [["initialize", ""], ["tools/list", ""], ["tools/call", "search_code"]],
  );
  for (const receipt of receipts) {
    assert.deepEqual(Object.keys(receipt).sort(), ["method", "path", "requestId", "toolName"]);
    const serialized = JSON.stringify(receipt);
    assert.doesNotMatch(serialized, /arguments|headers|private|Bearer|SyntheticSymbol/iu);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("package acquisition failure occurs before any host project is created", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-acquire-first-"));
  try {
    const result = await smoke.runHostSmoke(
      {
        mode: "required-contract",
        packageSpec: "kcoderag-nav@0.0.0",
        temporaryRoot: root,
        hosts: ["codex", "claude", "cursor"],
      },
      {
        acquirePackage: async () => {
          throw new Error("synthetic acquisition failure with private detail");
        },
      },
    );
    assert.equal(result.status, "NOT_RUN");
    assert.equal(smoke.smokeExitCode(result), 1);
    assert.deepEqual(fs.readdirSync(root), []);
    assert.doesNotMatch(JSON.stringify(result), /private detail|Bearer|Authorization/iu);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
