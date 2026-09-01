/** Mixed-parallel Phase 05 live-host coordinator tests. */

const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");

type HostId = "codex" | "claude" | "cursor" | "opencode" | "zcode";

interface ReceiptModule {
  completeCommonObservations(overrides?: Readonly<Record<string, boolean>>): Readonly<Record<string, boolean>>;
  completeHostObservations(host: HostId, overrides?: Readonly<Record<string, boolean>>): Readonly<Record<string, boolean>>;
}

interface CoordinatorModule {
  readonly PARALLEL_HOSTS: readonly HostId[];
  readonly SERIAL_HOSTS: readonly HostId[];
  runLiveHostCoordinator(options: Readonly<Record<string, unknown>>, dependencies: {
    probeLane(context: Readonly<Record<string, any>>): Promise<Readonly<Record<string, unknown>>>;
    runLane(context: Readonly<Record<string, any>>): Promise<Readonly<Record<string, unknown>>>;
    cleanupLane?(context: Readonly<Record<string, any>>): Promise<void>;
  }): Promise<{
    readonly schemaVersion: 1;
    readonly verdict: "PASS" | "FAIL" | "INCOMPLETE";
    readonly receipts: readonly Readonly<Record<string, any>>[];
  }>;
}

const receipt = require("../../dist/smoke/acceptance-receipt.cjs") as ReceiptModule;
const coordinator = require("../../dist/smoke/live-host-coordinator.cjs") as CoordinatorModule;

const DIGEST = "a".repeat(64);
const HOSTS: readonly HostId[] = ["codex", "claude", "cursor", "opencode", "zcode"];

function options(root: string): Readonly<Record<string, unknown>> {
  return {
    root,
    candidateSha: DIGEST,
    packageSha256: "b".repeat(64),
    packageMemberDigest: "c".repeat(64),
    workflowRunId: "run-123",
    artifactDigest: "d".repeat(64),
    nodeVersion: "22.18.0",
    os: "windows",
    hostVersions: {
      codex: "0.146.1",
      claude: "2.1.241",
      cursor: "3.17.8",
      opencode: "1.18.23",
      zcode: "0.0.0",
    },
  };
}

function passOutcome(host: HostId): Readonly<Record<string, unknown>> {
  return {
    status: "PASS",
    stage: "evidence_integrity",
    reasonCode: "none",
    observations: {
      common: receipt.completeCommonObservations({ processTreeCleaned: false }),
      host: receipt.completeHostObservations(host),
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("wait_timeout");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test("runs Codex, Claude and OpenCode in parallel before Cursor and ZCode serially", async () => {
  assert.deepEqual(coordinator.PARALLEL_HOSTS, ["codex", "claude", "opencode"]);
  assert.deepEqual(coordinator.SERIAL_HOSTS, ["cursor", "zcode"]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-coordinator-order-"));
  const events: string[] = [];
  const releases = new Map<HostId, () => void>();
  try {
    const running = coordinator.runLiveHostCoordinator(options(root), {
      probeLane: async ({ host }) => ({ admitted: true, host }),
      runLane: async ({ host, projectRoot, cacheRoot, npmCacheRoot }) => {
        const typedHost = host as HostId;
        assert.equal(fs.existsSync(projectRoot), true);
        assert.equal(fs.existsSync(cacheRoot), true);
        assert.equal(fs.existsSync(npmCacheRoot), true);
        events.push(`start:${typedHost}`);
        await new Promise<void>((resolve) => releases.set(typedHost, resolve));
        events.push(`finish:${typedHost}`);
        return passOutcome(typedHost);
      },
      cleanupLane: async ({ host, laneRoot }) => {
        events.push(`cleanup:${host as string}`);
        fs.rmSync(laneRoot, { recursive: true, force: true });
      },
    });

    await waitFor(() => coordinator.PARALLEL_HOSTS.every((host) => events.includes(`start:${host}`)));
    assert.equal(events.some((event) => event === "start:cursor" || event === "start:zcode"), false);
    for (const host of coordinator.PARALLEL_HOSTS) releases.get(host)?.();
    await waitFor(() => events.includes("start:cursor"));
    assert.equal(events.includes("start:zcode"), false);
    releases.get("cursor")?.();
    await waitFor(() => events.includes("start:zcode"));
    releases.get("zcode")?.();

    const result = await running;
    assert.equal(result.verdict, "PASS");
    assert.deepEqual(result.receipts.map((item) => item.host), HOSTS);
    assert.equal(result.receipts.every((item) => item.status === "PASS"), true);
    assert.equal(result.receipts.every((item) => item.observations.common.processTreeCleaned === true), true);
    assert.equal(new Set(events.filter((event) => event.startsWith("cleanup:"))).size, 5);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("normalizes environment and admission absence to NOT_RUN without executing lanes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-coordinator-not-run-"));
  const ran: HostId[] = [];
  try {
    const result = await coordinator.runLiveHostCoordinator(options(root), {
      probeLane: async ({ host }) => host === "zcode"
        ? { admitted: false, stage: "admission", reasonCode: "workspace_trust_missing" }
        : { admitted: false, stage: "environment", reasonCode: "host_unavailable" },
      runLane: async ({ host }) => {
        ran.push(host as HostId);
        return passOutcome(host as HostId);
      },
    });
    assert.deepEqual(ran, []);
    assert.equal(result.verdict, "INCOMPLETE");
    assert.equal(result.receipts.every((item) => item.status === "NOT_RUN"), true);
    assert.equal(result.receipts.find((item) => item.host === "zcode")?.reasonCode, "workspace_trust_missing");
    assert.equal(result.receipts.every((item) => item.attempted === false), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("attempted failures and cleanup interruption emit one matching FAIL receipt per lane", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-coordinator-fail-"));
  const cleanupCounts = new Map<HostId, number>();
  try {
    const result = await coordinator.runLiveHostCoordinator(options(root), {
      probeLane: async () => ({ admitted: true }),
      runLane: async ({ host }) => {
        const typedHost = host as HostId;
        if (typedHost === "claude") {
          return {
            status: "FAIL",
            stage: "mcp",
            reasonCode: "mcp_call_failed",
            observations: {
              common: receipt.completeCommonObservations({ searchCodeSucceeded: false, processTreeCleaned: false }),
              host: receipt.completeHostObservations(typedHost),
            },
          };
        }
        if (typedHost === "opencode") throw new Error("interrupted");
        return passOutcome(typedHost);
      },
      cleanupLane: async ({ host, laneRoot }) => {
        const typedHost = host as HostId;
        cleanupCounts.set(typedHost, (cleanupCounts.get(typedHost) ?? 0) + 1);
        fs.rmSync(laneRoot, { recursive: true, force: true });
        if (typedHost === "cursor") throw new Error("cleanup failed");
      },
    });
    assert.equal(result.verdict, "FAIL");
    assert.equal(result.receipts.length, 5);
    assert.equal(result.receipts.find((item) => item.host === "claude")?.reasonCode, "mcp_call_failed");
    assert.equal(result.receipts.find((item) => item.host === "opencode")?.reasonCode, "native_event_failed");
    assert.equal(result.receipts.find((item) => item.host === "cursor")?.reasonCode, "cleanup_failed");
    assert.equal(result.receipts.every((item) => item.status === "PASS" || item.status === "FAIL"), true);
    assert.equal([...cleanupCounts.values()].every((count) => count === 1), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
