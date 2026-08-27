const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type PlatformLaneId = "linux-node22" | "linux-node24" | "windows-node22" | "windows-node24";

interface PlatformLaneReceipt {
  readonly schemaVersion: 1;
  readonly laneId: PlatformLaneId;
  readonly os: "linux" | "windows";
  readonly nodeMajor: 22 | 24;
  readonly candidateSubject: string;
  readonly triggerEvent: "push";
  readonly triggerRef: "refs/heads/readiness/04.2-candidate";
  readonly headSha: string;
  readonly workflowCommit: string;
  readonly workflowBlobOid: string;
  readonly artifactSha256: string;
  readonly memberCount: number;
  readonly dryRunCount: 1;
  readonly actualPackCount: 1;
  readonly workflowConclusion: "PASS";
  readonly hostOutcomes: Readonly<Record<"codex" | "claude" | "cursor" | "opencode" | "zcode", "PASS">>;
  readonly packagedOnly: true;
  readonly trueHostAcceptance: "NOT_RUN_BY_SCOPE";
}

interface ReadinessWorkflowModule {
  parsePlatformLaneReceipt(value: unknown): PlatformLaneReceipt;
  verifyPlatformLaneSet(
    receipts: readonly unknown[],
    options: {
      readonly root: string;
      readonly candidateSubject: string;
      readonly artifactSha256: string;
      readonly memberCount: number;
    },
  ): readonly PlatformLaneReceipt[];
}

const workflowContract = require("../../dist/maintainer/readiness-workflow.cjs") as ReadinessWorkflowModule;
const repositoryRoot = path.resolve(__dirname, "../..");
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "readiness.yml");
const SHA256 = "a".repeat(64);

function workflow(): string {
  return fs.readFileSync(workflowPath, "utf8");
}

function git(root: string, args: readonly string[]): string {
  return childProcess.execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fixture(): {
  readonly root: string;
  readonly candidateSubject: string;
  readonly workflowBlobOid: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-readiness-workflow-"));
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(root, ".github", "workflows", "readiness.yml"), "name: fixture\n", "utf8");
  git(root, ["init", "--quiet", "--initial-branch=master"]);
  git(root, ["config", "user.email", "tests@example.invalid"]);
  git(root, ["config", "user.name", "KCodeRag Tests"]);
  git(root, ["add", "--", ".github/workflows/readiness.yml"]);
  git(root, ["commit", "--quiet", "-m", "candidate"]);
  const candidateSubject = git(root, ["rev-parse", "HEAD"]);
  return {
    root,
    candidateSubject,
    workflowBlobOid: git(root, ["rev-parse", `${candidateSubject}:.github/workflows/readiness.yml`]),
  };
}

function laneReceipt(
  laneId: PlatformLaneId,
  candidateSubject: string,
  workflowBlobOid: string,
): PlatformLaneReceipt {
  const [os, node] = laneId.split("-node") as ["linux" | "windows", "22" | "24"];
  return {
    schemaVersion: 1,
    laneId,
    os,
    nodeMajor: Number(node) as 22 | 24,
    candidateSubject,
    triggerEvent: "push",
    triggerRef: "refs/heads/readiness/04.2-candidate",
    headSha: candidateSubject,
    workflowCommit: candidateSubject,
    workflowBlobOid,
    artifactSha256: SHA256,
    memberCount: 97,
    dryRunCount: 1,
    actualPackCount: 1,
    workflowConclusion: "PASS",
    hostOutcomes: {
      codex: "PASS",
      claude: "PASS",
      cursor: "PASS",
      opencode: "PASS",
      zcode: "PASS",
    },
    packagedOnly: true,
    trueHostAcceptance: "NOT_RUN_BY_SCOPE",
  };
}

function receiptSet(candidateSubject: string, workflowBlobOid: string): readonly PlatformLaneReceipt[] {
  return ["linux-node22", "linux-node24", "windows-node22", "windows-node24"].map((laneId) =>
    laneReceipt(laneId as PlatformLaneId, candidateSubject, workflowBlobOid));
}

function expectCode(call: () => unknown, code: string): void {
  assert.throws(call, (error: unknown) =>
    error instanceof Error && "code" in error && (error as Error & { code: string }).code === code);
}

function jobNames(source: string): readonly string[] {
  const jobs = source.slice(source.indexOf("\njobs:"));
  return [...jobs.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gmu)].map((match) => match[1] as string);
}

test("readiness workflow has one exact branch-push authority and minimal read-only permissions", () => {
  const source = workflow();
  assert.match(source, /^on:\s*\r?\n\s+push:\s*\r?\n\s+branches:\s*\r?\n\s+- readiness\/04\.2-candidate\s*$/mu);
  assert.equal(source.match(/readiness\/04\.2-candidate/gu)?.length, 2);
  assert.doesNotMatch(source, /branches-ignore:|tags:|tags-ignore:|workflow_dispatch:|schedule:|pull_request:|workflow_call:|workflow_run:/u);
  assert.match(source, /permissions:\s*\r?\n\s+contents:\s*read/u);
  assert.doesNotMatch(source, /contents:\s*write|actions:\s*write|packages:\s*write|id-token:\s*write|deployments:\s*write/u);
  assert.match(source, /github\.event_name == 'push'/u);
  assert.match(source, /github\.ref == 'refs\/heads\/readiness\/04\.2-candidate'/u);
  assert.match(source, /github\.sha == github\.workflow_sha/u);
});

test("one package job uploads one lease artifact then four lanes consume that artifact ID", () => {
  const source = workflow();
  assert.deepEqual(jobNames(source), [
    "package",
    "linux-node22",
    "linux-node24",
    "windows-node22",
    "windows-node24",
    "verify-lanes",
  ]);
  assert.equal(source.match(/uses:\s*actions\/checkout@[0-9a-f]{40}/gu)?.length, 6);
  assert.equal(source.match(/persist-credentials:\s*false/gu)?.length, 6);
  assert.equal(source.match(/ref:\s*\$\{\{ github\.sha \}\}/gu)?.length, 6);
  assert.equal(source.match(/uses:\s*actions\/download-artifact@[0-9a-f]{40}/gu)?.length, 4);
  assert.equal(source.match(/artifact-ids:\s*\$\{\{ needs\.package\.outputs\.artifact-id \}\}/gu)?.length, 4);
  assert.equal(source.match(/npm run readiness:workflow-upload/gu)?.length, 1);
  assert.equal(source.match(/npm run readiness:workflow-lane/gu)?.length, 4);
  assert.equal(source.match(/npm run readiness:workflow-verify/gu)?.length, 1);
  assert.doesNotMatch(source, /actions\/upload-artifact@/u);
  assert.doesNotMatch(source, /npm\s+(?:publish|view)|dist-tag|create-release|gh\s+release|git\s+(?:tag|push)|packageSpec|registry_refetch/iu);
});

test("workflow keeps one exact four-lane Windows/Linux Node 22/24 fan-out", () => {
  const source = workflow();
  const expected = [
    ["linux-node22", "ubuntu-latest", "22"],
    ["linux-node24", "ubuntu-latest", "24"],
    ["windows-node22", "windows-latest", "22"],
    ["windows-node24", "windows-latest", "24"],
  ] as const;
  for (const [laneId, runner, nodeMajor] of expected) {
    const start = source.indexOf(`  ${laneId}:`);
    assert.notEqual(start, -1);
    const next = source.indexOf("\n  ", start + 3);
    const body = source.slice(start, next === -1 ? source.length : next);
    assert.match(body, new RegExp(`runs-on:\\s*${runner.replace("-", "\\-")}`, "u"));
    assert.match(body, new RegExp(`node-version:\\s*[\"']${nodeMajor}[\"']`, "u"));
    assert.match(body, new RegExp(`--lane ${laneId}`, "u"));
    assert.match(body, /needs:\s*package/u);
  }
});

test("strict lane receipts bind push ref head workflow blob and one artifact before platform PASS", () => {
  const value = fixture();
  try {
    const receipts = receiptSet(value.candidateSubject, value.workflowBlobOid);
    const verified = workflowContract.verifyPlatformLaneSet(receipts, {
      root: value.root,
      candidateSubject: value.candidateSubject,
      artifactSha256: SHA256,
      memberCount: 97,
    });
    assert.deepEqual(verified.map((receipt) => receipt.laneId), [
      "linux-node22", "linux-node24", "windows-node22", "windows-node24",
    ]);
    assert.deepEqual(workflowContract.parsePlatformLaneReceipt(receipts[0]), receipts[0]);
    assert.ok(Object.isFrozen(verified));
    assert.ok(verified.every(Object.isFrozen));
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("lane validator rejects missing duplicate and provenance-mismatched receipts", () => {
  const value = fixture();
  try {
    const baseline = receiptSet(value.candidateSubject, value.workflowBlobOid);
    const options = {
      root: value.root,
      candidateSubject: value.candidateSubject,
      artifactSha256: SHA256,
      memberCount: 97,
    };
    expectCode(() => workflowContract.verifyPlatformLaneSet(baseline.slice(0, 3), options), "platform_lanes_incomplete");
    expectCode(() => workflowContract.verifyPlatformLaneSet([...baseline.slice(0, 3), baseline[0]], options),
      "platform_lanes_incomplete");
    for (const patch of [
      { triggerEvent: "workflow_dispatch" },
      { triggerRef: "refs/tags/v0.3.0" },
      { headSha: "b".repeat(40) },
      { workflowCommit: "b".repeat(40) },
      { workflowBlobOid: "b".repeat(40) },
      { artifactSha256: "b".repeat(64) },
      { memberCount: 96 },
      { workflowConclusion: "FAIL" },
      { packagedOnly: false },
      { trueHostAcceptance: "PASS" },
    ]) {
      const changed = baseline.map((receipt, index) => index === 0 ? { ...receipt, ...patch } : receipt);
      expectCode(() => workflowContract.verifyPlatformLaneSet(changed, options), "platform_lane_mismatch");
    }
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("receipt parser rejects unknown fields and incomplete host outcomes without leaking values", () => {
  const value = fixture();
  try {
    const receipt = laneReceipt("linux-node22", value.candidateSubject, value.workflowBlobOid);
    expectCode(() => workflowContract.parsePlatformLaneReceipt({ ...receipt, unexpected: "secret" }),
      "invalid_lane_receipt");
    const { zcode: _zcode, ...incompleteHosts } = receipt.hostOutcomes;
    expectCode(() => workflowContract.parsePlatformLaneReceipt({ ...receipt, hostOutcomes: incompleteHosts }),
      "invalid_lane_receipt");
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});
