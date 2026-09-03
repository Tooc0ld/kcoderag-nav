const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
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
  resolveTrustedDriver(driver: string | undefined, expected: string | undefined): string | undefined;
  nativeDriverSpawnSpec(driver: string, args: readonly string[]): {
    readonly executable: string;
    readonly args: readonly string[];
  };
  liveLaneRoot(output: string, workflowRunId: string): string;
  materializeLivePackage(sourcePackagePath: string, executionRoot: string, expectedSha: string): {
    readonly packagePath: string;
    readonly release: () => void;
  };
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
  assert.match(source, /^on:\s*\r?\n\s+push:\s*\r?\n\s+branches:\s*\r?\n\s+- "\*\*"\s*\r?\n\s+workflow_call:/mu);
  assert.doesNotMatch(source, /^\s+pull_request(?:_target)?:/mu);
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
  const packageJob = source.slice(source.indexOf("  package:"), source.indexOf("  packaged:"));
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
  assert.match(source, /candidateSha:[\s\S]*?required:\s*true[\s\S]*?candidateRef:[\s\S]*?required:\s*true[\s\S]*?packageSha256:[\s\S]*?required:\s*true[\s\S]*?packageMemberDigest:[\s\S]*?required:\s*true/u);
  assert.match(packageJob, /READINESS_PROVENANCE_PROFILE:\s*acceptance/u);
  assert.match(packageJob, /READINESS_CANDIDATE_SHA:\s*\$\{\{ env\.ACCEPTANCE_SUBJECT \}\}/u);
  assert.match(packageJob, /READINESS_CANDIDATE_REF:\s*\$\{\{ inputs\.candidateRef \|\| github\.ref \}\}/u);
  assert.match(packageJob, /READINESS_WORKFLOW_COMMIT:\s*\$\{\{ github\.workflow_sha \}\}/u);
  assert.match(packageJob, /READINESS_WORKFLOW_BLOB_SHA:\s*\$\{\{ inputs\.workflowBlobSha \}\}/u);
  assert.match(source, /environment:\s*\r?\n\s+name:\s*kcoderag-live/u);
  assert.match(source, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(source, /github\.event\.repository\.fork == false/u);
  assert.match(source, /inputs\.candidateSha == needs\.package\.outputs\.candidate-sha/u);
  assert.match(source, /inputs\.candidateRef == github\.ref/u);
  assert.match(source, /node-version:\s*["']22["']/u);

  const live = source.slice(source.indexOf("  live:"), source.indexOf("  verify:", source.indexOf("  live:")));
  assert.match(live, /Bind candidate native driver/u);
  assert.match(live, /dist[\\/]maintainer[\\/]native-host-driver\.cjs/u);
  assert.match(live, /KCODERAG_NATIVE_DRIVER=/u);
  assert.match(live, /KCODERAG_NATIVE_DRIVER_SHA256=/u);
  assert.match(live, /SHA256\]::HashData/u);
  assert.match(live, /KCODERAG_ZCODE_WORKSPACE_TRUST:\s*\$\{\{ vars\.KCODERAG_ZCODE_WORKSPACE_TRUST \}\}/u);
  assert.match(live, /npm run acceptance:live/u);
  assert.match(live, /package-sha256/u);
  assert.match(live, /package-member-digest/u);
  assert.doesNotMatch(live, /npm\s+(?:pack|publish|view)|pack:audit|smoke:required|dist-tag|git\s+(?:tag|push)|@latest/iu);
  assert.doesNotMatch(source, /continue-on-error|allow_failure|\|\|\s*true/iu);
});

test("workflow validator fails closed for trust, identity, bypass and LIVE rebuild drift", () => {
  const source = workflow();
  const cases = [
    [source.replace("  workflow_call:", "  pull_request:\n  workflow_call:"), "untrusted_event_trigger"],
    [source.replaceAll("candidateSha:", "candidateDigest:"), "candidate_input_missing"],
    [source.replaceAll("candidateRef:", "candidateBranch:"), "candidate_ref_input_missing"],
    [source.replace("name: kcoderag-live", "name: unprotected"), "protected_environment_missing"],
    [source.replace("github.event.repository.fork == false", "github.event.repository.fork == true"), "untrusted_ref_guard_missing"],
    [source.replaceAll("node-version: \"22\"", "node-version: \"24\""), "live_runner_invalid"],
    [source.replace("KCODERAG_NATIVE_DRIVER_SHA256", "KCODERAG_NATIVE_DRIVER_DIGEST"), "native_driver_binding_missing"],
    [source.replace("dist/maintainer/native-host-driver.cjs", "C:/mutable/native-driver.cjs"), "native_driver_binding_missing"],
    [source.replace("${{ vars.KCODERAG_ZCODE_WORKSPACE_TRUST }}", "approved"), "workspace_trust_projection_missing"],
    [source.replace("npm run acceptance:live", "npm pack && npm run acceptance:live"), "live_rebuild_forbidden"],
    [`${source}\n# continue-on-error: true\n`, "acceptance_bypass_forbidden"],
  ] as const;
  for (const [changed, code] of cases) expectCode(() => workflowContract.validateAcceptanceWorkflow(changed), code);
});

test("native driver path is hash-bound and spawned through the current Node runtime", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-native-driver-binding-"));
  const driverPath = path.join(root, "driver.cjs");
  try {
    fs.writeFileSync(driverPath, "process.stdout.write('{}')\n", "utf8");
    const digest = crypto.createHash("sha256").update(fs.readFileSync(driverPath)).digest("hex");
    assert.equal(workflowContract.resolveTrustedDriver(driverPath, digest), path.resolve(driverPath));
    fs.appendFileSync(driverPath, "// tampered\n", "utf8");
    assert.equal(workflowContract.resolveTrustedDriver(driverPath, digest), undefined);
    assert.equal(workflowContract.resolveTrustedDriver(driverPath, "not-a-digest"), undefined);

    const command = workflowContract.nativeDriverSpawnSpec(driverPath, ["probe", "--host", "codex"]);
    assert.equal(command.executable, process.execPath);
    assert.deepEqual(command.args, [driverPath, "probe", "--host", "codex"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("LIVE lane roots are isolated by workflow attempt on persistent runners", () => {
  const output = path.join("R:\\runner-temp", "live-receipts.json");
  const first = workflowContract.liveLaneRoot(output, "33589742940-2");
  const retry = workflowContract.liveLaneRoot(output, "33589742940-3");
  assert.notEqual(first, retry);
  assert.equal(first, workflowContract.liveLaneRoot(output, "33589742940-2"));
  assert.equal(path.dirname(path.dirname(first)), path.dirname(path.resolve(output)));
  assert.match(path.basename(first), /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(first, /33589742940/u);
});

test("LIVE materializes verified artifact bytes under the exact npm tgz suffix and cleans its bounded root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-live-package-"));
  const source = path.join(root, "kcoderag-nav-0.3.1.tgz.gz");
  const executionRoot = path.join(root, "lanes", "attempt");
  const bytes = Buffer.from("exact-candidate-bytes", "utf8");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  try {
    fs.writeFileSync(source, bytes);
    const lease = workflowContract.materializeLivePackage(source, executionRoot, digest);
    assert.equal(path.basename(lease.packagePath), "candidate.tgz");
    assert.deepEqual(fs.readFileSync(lease.packagePath), bytes);
    assert.deepEqual(fs.readFileSync(source), bytes);
    lease.release();
    lease.release();
    assert.equal(fs.existsSync(executionRoot), false);
    assert.deepEqual(fs.readFileSync(source), bytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("LIVE package materialization fails closed for stale roots and source digest drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-live-package-closed-"));
  const source = path.join(root, "artifact.tgz.gz");
  const executionRoot = path.join(root, "lanes", "attempt");
  const bytes = Buffer.from("candidate", "utf8");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  try {
    fs.writeFileSync(source, bytes);
    expectCode(() => workflowContract.materializeLivePackage(source, executionRoot, "0".repeat(64)),
      "package_hash_mismatch");
    fs.mkdirSync(executionRoot, { recursive: true });
    expectCode(() => workflowContract.materializeLivePackage(source, executionRoot, digest),
      "lane_workspace_conflict");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
