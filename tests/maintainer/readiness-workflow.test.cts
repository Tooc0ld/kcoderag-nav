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
const actionRoot = path.join(repositoryRoot, ".github", "actions", "readiness-upload");
const actionManifestPath = path.join(actionRoot, "action.yml");
const actionEntrypointPath = path.join(actionRoot, "index.cjs");
const SHA256 = "a".repeat(64);

function artifactRuntimeToken(runId = "run-backend-id", jobId = "job-backend-id"): string {
  const payload = Buffer.from(JSON.stringify({
    scp: `Actions.Results:${runId}:${jobId}`,
  })).toString("base64url");
  return `header.${payload}.signature`;
}

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

function jobBody(source: string, jobName: string): string {
  const start = source.indexOf(`  ${jobName}:`);
  assert.notEqual(start, -1);
  const jobHeader = /^  [a-z][a-z0-9-]*:\s*$/gmu;
  jobHeader.lastIndex = start + `  ${jobName}:`.length;
  const next = jobHeader.exec(source);
  return source.slice(start, next?.index ?? source.length);
}

test("readiness workflow has one exact branch-push authority and minimal read-only permissions", () => {
  const source = workflow();
  const normalized = source.replace(/\r\n/gu, "\n");
  assert.match(source, /^on:\s*\r?\n\s+push:\s*\r?\n\s+branches:\s*\r?\n\s+- readiness\/04\.2-candidate\s*$/mu);
  assert.equal(source.match(/readiness\/04\.2-candidate/gu)?.length, 2);
  assert.doesNotMatch(source, /branches-ignore:|tags:|tags-ignore:|workflow_dispatch:|schedule:|pull_request:|workflow_call:|workflow_run:/u);
  assert.equal(
    normalized.slice(normalized.indexOf("permissions:"), normalized.indexOf("\nenv:")),
    "permissions:\n  contents: read\n",
  );
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
  assert.equal(source.match(/uses:\s*actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/gu)?.length, 6);
  assert.equal(source.match(/uses:\s*actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/gu)?.length, 6);
  assert.equal(source.match(/persist-credentials:\s*false/gu)?.length, 6);
  assert.equal(source.match(/ref:\s*\$\{\{ github\.sha \}\}/gu)?.length, 6);
  assert.equal(source.match(/uses:\s*actions\/download-artifact@[0-9a-f]{40}/gu)?.length, 4);
  assert.equal(source.match(/uses:\s*actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/gu)?.length, 4);
  assert.equal(source.match(/artifact-ids:\s*\$\{\{ needs\.package\.outputs\.artifact-id \}\}/gu)?.length, 4);
  assert.equal(source.match(/uses:\s*\.\/\.github\/actions\/readiness-upload/gu)?.length, 1);
  assert.equal(source.match(/npm run readiness:workflow-upload/gu)?.length ?? 0, 0);
  assert.equal(source.match(/npm run readiness:workflow-lane/gu)?.length, 4);
  assert.equal(source.match(/npm run readiness:workflow-verify/gu)?.length, 1);
  assert.doesNotMatch(source, /actions\/upload-artifact@/u);
  assert.doesNotMatch(source, /npm\s+(?:publish|view)|dist-tag|create-release|gh\s+release|git\s+(?:tag|push)|packageSpec|registry_refetch/iu);
});

test("missing artifact runtime inputs fail before a request or workflow output is produced", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-readiness-missing-runtime-"));
  const outputPath = path.join(temporaryRoot, "github-output.txt");
  const requestMarkerPath = path.join(temporaryRoot, "fetch-called.txt");
  const preloadPath = path.join(temporaryRoot, "reject-fetch.cjs");
  fs.writeFileSync(outputPath, "", "utf8");
  fs.writeFileSync(preloadPath, [
    '"use strict";',
    'const fs = require("node:fs");',
    "const originalFetch = globalThis.fetch;",
    `globalThis.fetch = async (...args) => { const target = String(args[0]); if (target.startsWith("https://")) fs.writeFileSync(${JSON.stringify(requestMarkerPath)}, "called", "utf8"); return originalFetch(...args); };`,
    "",
  ].join("\n"), "utf8");
  const env = { ...process.env };
  delete env.ACTIONS_RESULTS_URL;
  delete env.ACTIONS_RUNTIME_TOKEN;
  Object.assign(env, {
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/readiness/04.2-candidate",
    GITHUB_SHA: "a".repeat(40),
    READINESS_WORKFLOW_COMMIT: "a".repeat(40),
    GITHUB_OUTPUT: outputPath,
  });

  try {
    const result = childProcess.spawnSync(process.execPath, [
      "--require",
      preloadPath,
      path.join(repositoryRoot, "dist", "maintainer", "readiness-workflow.cjs"),
      "package-upload",
    ], {
      cwd: repositoryRoot,
      env,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      schemaVersion: 1,
      status: "FAIL",
      reason: "artifact_auth_invalid",
    });
    assert.equal(result.stderr, "");
    assert.equal(fs.statSync(outputPath).size, 0);
    assert.equal(fs.existsSync(requestMarkerPath), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("safe upload failure stdout exposes only commit stage and status class", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-readiness-safe-upload-failure-"));
  const outputPath = path.join(temporaryRoot, "github-output.txt");
  const preloadPath = path.join(temporaryRoot, "artifact-failure-fetch.cjs");
  const canaries = [
    "signed-query-secret-canary",
    "azure-response-secret-canary",
    "response-header-secret-canary",
    "run-secret-canary",
    "job-secret-canary",
  ];
  fs.writeFileSync(outputPath, "", "utf8");
  fs.writeFileSync(preloadPath, [
    '"use strict";',
    "const originalFetch = globalThis.fetch;",
    "globalThis.fetch = async (input, init) => {",
    "  const target = String(input);",
    "  if (!target.startsWith(\"https://\")) return originalFetch(input, init);",
    "  const url = new URL(target);",
    "  if (url.pathname.endsWith(\"/CreateArtifact\")) return new Response(JSON.stringify({ ok: true, signedUploadUrl: \"https://candidate.blob.core.windows.net/results/candidate?sv=trusted&sig=signed-query-secret-canary\" }), { status: 200, headers: { \"content-type\": \"application/json\" } });",
    "  if (init?.method === \"PUT\" && url.searchParams.get(\"comp\") === \"block\") return new Response(null, { status: 201 });",
    "  if (init?.method === \"PUT\" && url.searchParams.get(\"comp\") === \"blocklist\") return new Response(\"azure-response-secret-canary\", { status: 503, headers: { \"x-secret\": \"response-header-secret-canary\" } });",
    "  if (url.pathname.endsWith(\"/DeleteArtifact\")) return new Response(JSON.stringify({ ok: true, artifactId: \"4242\" }), { status: 200, headers: { \"content-type\": \"application/json\" } });",
    "  throw new Error(\"unexpected_request\");",
    "};",
    "",
  ].join("\n"), "utf8");
  const env = {
    ...process.env,
    ACTIONS_RESULTS_URL: "https://results-receiver.actions.githubusercontent.com/",
    ACTIONS_RUNTIME_TOKEN: artifactRuntimeToken("run-secret-canary", "job-secret-canary"),
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/readiness/04.2-candidate",
    GITHUB_SHA: "a".repeat(40),
    READINESS_WORKFLOW_COMMIT: "a".repeat(40),
    GITHUB_OUTPUT: outputPath,
  };

  try {
    const result = childProcess.spawnSync(process.execPath, [
      "--require",
      preloadPath,
      path.join(repositoryRoot, "dist", "maintainer", "readiness-workflow.cjs"),
      "package-upload",
    ], {
      cwd: repositoryRoot,
      env,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      schemaVersion: 1,
      status: "FAIL",
      reason: "artifact_upload_failed",
      stage: "commit_block_list",
      statusClass: "5xx",
    });
    assert.equal(result.stderr, "");
    assert.equal(fs.statSync(outputPath).size, 0);
    for (const canary of canaries) assert.doesNotMatch(result.stdout, new RegExp(canary, "u"));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("package producer resolves through a candidate-local JavaScript action handler", async () => {
  const source = workflow();
  const packageJob = jobBody(source, "package");
  assert.equal(packageJob.match(/uses:\s*\.\/\.github\/actions\/readiness-upload/gu)?.length, 1);
  assert.doesNotMatch(packageJob, /run:\s*npm run readiness:workflow-upload/u);
  assert.equal(fs.existsSync(actionManifestPath), true);
  assert.equal(fs.existsSync(actionEntrypointPath), true);

  const manifest = fs.readFileSync(actionManifestPath, "utf8").replace(/\r\n/gu, "\n");
  assert.deepEqual(
    [...manifest.matchAll(/^([a-z][a-z0-9-]*):/gmu)].map((match) => match[1]),
    ["name", "description", "outputs", "runs"],
  );
  const outputBlock = manifest.slice(manifest.indexOf("outputs:"), manifest.indexOf("\nruns:"));
  assert.deepEqual(
    [...outputBlock.matchAll(/^  ([a-z][a-z0-9-]*):/gmu)].map((match) => match[1]),
    ["artifact-id", "artifact-name", "artifact-sha256", "member-count", "candidate-subject"],
  );
  assert.match(manifest, /^runs:\s*\n  using:\s*node24\s*\n  main:\s*index\.cjs\s*$/mu);
  assert.doesNotMatch(manifest, /^inputs:|^permissions:|^  pre:|^  post:/mu);

  const entrypoint = fs.readFileSync(actionEntrypointPath, "utf8");
  assert.doesNotMatch(entrypoint, /node:child_process|\b(?:spawn|spawnSync|exec|execFile|fork)\b|\bnpm\b|\.tgz|node:fs|node:path|uploadCandidateArtifact/iu);
  let calls = 0;
  const processState: { exitCode?: number } = {};
  const execute = new Function("require", "process", entrypoint.replace(/^#![^\n]*\n/u, "")) as (
    loader: (specifier: string) => { readonly main: (argv: readonly string[]) => Promise<number> },
    processLike: { exitCode?: number },
  ) => void;
  execute((specifier) => {
    assert.equal(specifier, "../../../dist/maintainer/readiness-workflow.cjs");
    return {
      main: async (argv) => {
        calls += 1;
        assert.deepEqual(argv, ["package-upload"]);
        return 17;
      },
    };
  }, processState);
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  assert.equal(calls, 1);
  assert.equal(processState.exitCode, 17);
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
    const body = jobBody(source, laneId);
    assert.match(body, new RegExp(`runs-on:\\s*${runner}`, "u"));
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
