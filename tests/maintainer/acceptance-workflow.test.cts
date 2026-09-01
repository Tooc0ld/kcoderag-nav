const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor" | "opencode" | "zcode";
type HostReceipt = Readonly<{ readonly host: HostId }>;
type AcceptanceObservations = Readonly<{
  readonly common: Readonly<Record<string, boolean>>;
  readonly host: Readonly<Record<string, boolean>>;
}>;
interface LaneContext {
  readonly host: HostId;
  readonly laneRoot: string;
  readonly projectRoot: string;
  readonly cacheRoot: string;
  readonly npmCacheRoot: string;
}
interface LiveCoordinatorOptions {
  readonly root: string;
  readonly candidateSha: string;
  readonly packageSha256: string;
  readonly packageMemberDigest: string;
  readonly workflowRunId: string;
  readonly artifactDigest: string;
  readonly nodeVersion: string;
  readonly os: "windows" | "linux";
  readonly hostVersions: Readonly<Record<HostId, string>>;
}

interface AcceptanceWorkflowContract {
  readonly schemaVersion: 1;
  readonly producerJob: "package";
  readonly packagedLanes: readonly [
    "ubuntu-node22",
    "ubuntu-node24",
    "windows-node22",
    "windows-node24",
  ];
  readonly liveJob: "live";
  readonly liveRunner: readonly ["self-hosted", "Windows", "X64", "kcoderag-live"];
  readonly coordinatorOrder: readonly ["codex", "claude", "opencode", "cursor", "zcode"];
}

interface AcceptanceWorkflowModule {
  readonly ACCEPTANCE_WORKFLOW_STAGES: readonly string[];
  validateAcceptanceWorkflow(source: string): AcceptanceWorkflowContract;
  validateAcceptanceWorkflowFile(filePath?: string): AcceptanceWorkflowContract;
}

interface CoordinatorModule {
  runLiveHostCoordinator(
    options: LiveCoordinatorOptions,
    dependencies: {
      readonly probeLane: (context: LaneContext) => Promise<Readonly<{ admitted: true }>>;
      readonly runLane: (context: LaneContext) => Promise<Readonly<{
        status: "PASS";
        stage: "evidence_integrity";
        reasonCode: "none";
        observations: AcceptanceObservations;
      }>>;
      readonly cleanupLane: (context: LaneContext) => Promise<void>;
      readonly now: () => number;
    },
  ): Promise<Readonly<{ verdict: string; receipts: readonly HostReceipt[] }>>;
}

const workflowContract = require("../../dist/maintainer/acceptance-workflow.cjs") as AcceptanceWorkflowModule;
const receiptContract = require("../../dist/smoke/acceptance-receipt.cjs") as {
  completeCommonObservations(): AcceptanceObservations["common"];
  completeHostObservations(host: HostId): AcceptanceObservations["host"];
};
const coordinator = require("../../dist/smoke/live-host-coordinator.cjs") as CoordinatorModule;
const repositoryRoot = path.resolve(__dirname, "../..");
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "acceptance.yml");

function workflow(): string {
  return fs.readFileSync(workflowPath, "utf8");
}

function expectCode(call: () => unknown, code: string): void {
  assert.throws(call, (error: unknown) =>
    error instanceof Error && "code" in error && (error as Error & { code: string }).code === code);
}

test("acceptance workflow has one producer, four PACKAGED lanes and one protected exact-candidate LIVE lane", () => {
  const source = workflow();
  assert.deepEqual(workflowContract.validateAcceptanceWorkflow(source), {
    schemaVersion: 1,
    producerJob: "package",
    packagedLanes: ["ubuntu-node22", "ubuntu-node24", "windows-node22", "windows-node24"],
    liveJob: "live",
    liveRunner: ["self-hosted", "Windows", "X64", "kcoderag-live"],
    coordinatorOrder: ["codex", "claude", "opencode", "cursor", "zcode"],
  });
  assert.deepEqual(workflowContract.validateAcceptanceWorkflowFile(workflowPath),
    workflowContract.validateAcceptanceWorkflow(source));
  assert.deepEqual(workflowContract.ACCEPTANCE_WORKFLOW_STAGES, [
    "environment", "admission", "package", "install", "native_event",
    "prompt_semantics", "mcp", "feedback", "evidence_integrity",
  ]);
});

test("workflow binds every consumer to the producer artifact and never rebuilds in LIVE", () => {
  const source = workflow();
  assert.equal(source.match(/uses:\s*\.\/\.github\/actions\/readiness-upload/gu)?.length, 1);
  assert.deepEqual(
    [...source.matchAll(/- lane:\s*([^\s]+)\s*\r?\n\s*os:\s*([^\s]+)\s*\r?\n\s*runner:\s*([^\s]+)\s*\r?\n\s*node:\s*["']([^"']+)["']/gu)]
      .map((match) => [match[1], match[2], match[3], match[4]].join("|")),
    [
      "ubuntu-node22|linux|ubuntu-latest|22",
      "ubuntu-node24|linux|ubuntu-latest|24",
      "windows-node22|windows|windows-latest|22",
      "windows-node24|windows|windows-latest|24",
    ],
  );
  assert.equal(source.match(/artifact-ids:\s*\$\{\{ needs\.package\.outputs\.artifact-id \}\}/gu)?.length, 2);
  assert.match(source, /candidateSha:[\s\S]*?required:\s*true[\s\S]*?packageSha256:[\s\S]*?required:\s*true[\s\S]*?packageMemberDigest:[\s\S]*?required:\s*true/u);
  assert.match(source, /environment:\s*\r?\n\s+name:\s*kcoderag-live/u);
  assert.match(source, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(source, /github\.event\.repository\.fork == false/u);
  assert.match(source, /inputs\.candidateSha == needs\.package\.outputs\.candidate-sha/u);
  assert.match(source, /node-version:\s*["']22["']/u);

  const live = source.slice(source.indexOf("  live:"), source.indexOf("  verify:", source.indexOf("  live:")));
  assert.match(live, /npm run acceptance:live/u);
  assert.match(live, /package-sha256/u);
  assert.match(live, /package-member-digest/u);
  assert.doesNotMatch(live, /npm\s+(?:pack|publish|view)|pack:audit|smoke:required|dist-tag|git\s+(?:tag|push)|@latest/iu);
  assert.doesNotMatch(source, /continue-on-error|allow_failure|\|\|\s*true/iu);
});

test("workflow validator fails closed for trust, identity, bypass and LIVE rebuild drift", () => {
  const source = workflow();
  const cases = [
    [source.replace(/\n\s+candidateSha:[\s\S]*?\n\s+packageSha256:/u, "\n      packageSha256:"), "candidate_input_missing"],
    [source.replace("name: kcoderag-live", "name: unprotected"), "protected_environment_missing"],
    [source.replace("github.event.repository.fork == false", "github.event.repository.fork == true"), "untrusted_ref_guard_missing"],
    [source.replace("node-version: \"22\"", "node-version: \"24\""), "live_runner_invalid"],
    [source.replace("npm run acceptance:live", "npm pack && npm run acceptance:live"), "live_rebuild_forbidden"],
    [`${source}\n# continue-on-error: true\n`, "acceptance_bypass_forbidden"],
  ] as const;
  for (const [changed, code] of cases) expectCode(() => workflowContract.validateAcceptanceWorkflow(changed), code);
});

test("the packaged coordinator keeps three parallel lanes before serial Cursor and ZCode with lane cleanup", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-acceptance-workflow-order-"));
  const events: string[] = [];
  let active = 0;
  let maximum = 0;
  let clock = 0;
  const options: LiveCoordinatorOptions = {
    root,
    candidateSha: "a".repeat(40),
    packageSha256: "b".repeat(64),
    packageMemberDigest: "c".repeat(64),
    workflowRunId: "workflow-1",
    artifactDigest: "d".repeat(64),
    nodeVersion: "22.0.0",
    os: "windows",
    hostVersions: { codex: "1", claude: "1", cursor: "1", opencode: "1", zcode: "1" },
  };
  try {
    const result = await coordinator.runLiveHostCoordinator(options, {
      async probeLane() { return { admitted: true }; },
      async runLane(context) {
        active += 1;
        maximum = Math.max(maximum, active);
        events.push(`start:${context.host}`);
        await new Promise<void>((resolve) => { setImmediate(resolve); });
        events.push(`end:${context.host}`);
        active -= 1;
        return {
          status: "PASS",
          stage: "evidence_integrity",
          reasonCode: "none",
          observations: {
            common: receiptContract.completeCommonObservations(),
            host: receiptContract.completeHostObservations(context.host),
          },
        };
      },
      async cleanupLane(context) { events.push(`cleanup:${context.host}`); },
      now: () => { clock += 1; return clock; },
    });
    assert.equal(result.verdict, "PASS");
    assert.equal(maximum, 3);
    assert.ok(events.indexOf("start:cursor") > events.indexOf("cleanup:opencode"));
    assert.ok(events.indexOf("start:zcode") > events.indexOf("cleanup:cursor"));
    for (const host of ["codex", "claude", "opencode", "cursor", "zcode"]) {
      assert.equal(events.filter((event) => event === `cleanup:${host}`).length, 1);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
