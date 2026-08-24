const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type JsonMap = Record<string, any>;

interface ReceiptModule {
  PublishReceiptError: new (code: string) => Error & { code: string };
  verifyPublishReceipt(value: unknown): JsonMap;
  recordPublishReceipt(filePath: string, value: unknown): JsonMap;
  runCli(
    argv: readonly string[],
    io?: {
      readonly stdinText?: string;
      readonly stdout?: (text: string) => void;
      readonly stderr?: (text: string) => void;
    },
  ): number;
}

const receipt = require("../../dist/maintainer/publish-receipt.cjs") as ReceiptModule;
const repositoryRoot = path.resolve(__dirname, "../..");

function validReceipt(): JsonMap {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  return {
    schema_version: 1,
    package: "kcoderag-nav",
    version: "1.2.3",
    tag: "v1.2.3",
    release_commit_sha: sha,
    workflow: {
      run_id: "123456789",
      head_sha: sha,
      event: "push",
      conclusion: "success",
    },
    registry: {
      latest: "1.2.3",
      bin: { "kcoderag-nav": "dist/bin/kcoderag-nav.cjs" },
      engines: { node: ">=22" },
      repository: "git+https://github.com/Tooc0ld/kcoderag-nav.git",
    },
    evidence: {
      registry_metadata: true,
      npx_install: true,
      codex: true,
      claude: true,
      cursor: true,
    },
    timestamp: "2026-08-24T00:00:00.000Z",
  };
}

const HOST_EVIDENCE_KEYS = [
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
] as const;

function completeHostEvidence(): JsonMap {
  return Object.fromEntries(HOST_EVIDENCE_KEYS.map((key) => [key, true]));
}

function validV2Receipt(): JsonMap {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const digest = "89abcdef".repeat(8);
  const lifecycle = (requestedPackageSpec: string): JsonMap => ({
    requestedPackageSpec,
    expectedVersion: "1.2.3",
    resolvedPackageName: "kcoderag-nav",
    resolvedVersion: "1.2.3",
    lifecycleTarballSha256: digest,
    hosts: {
      codex: completeHostEvidence(),
      claude: completeHostEvidence(),
      cursor: completeHostEvidence(),
    },
  });
  return {
    schema_version: 2,
    package: "kcoderag-nav",
    version: "1.2.3",
    tag: "v1.2.3",
    release_commit_sha: sha,
    registry: {
      exact: {
        requestedVersion: "1.2.3",
        resolvedVersion: "1.2.3",
      },
      latest: {
        resolvedVersion: "1.2.3",
      },
      gitHead: sha,
      bin: { "kcoderag-nav": "dist/bin/kcoderag-nav.cjs" },
      engines: { node: ">=22" },
      repository: "git+https://github.com/Tooc0ld/kcoderag-nav.git",
    },
    workflow: {
      name: "Release",
      path: ".github/workflows/release.yml",
      run_id: "123456789",
      tag: "v1.2.3",
      ref: "refs/tags/v1.2.3",
      head_sha: sha,
      event: "push",
      conclusion: "success",
      lanes: {
        "ubuntu-latest-node-22": true,
        "ubuntu-latest-node-24": true,
        "windows-latest-node-22": true,
        "windows-latest-node-24": true,
      },
      publish: true,
    },
    lifecycle: {
      exact_version: lifecycle("kcoderag-nav@1.2.3"),
      latest: lifecycle("kcoderag-nav@latest"),
    },
    timestamp: "2026-08-24T00:00:00.000Z",
  };
}

function expectCode(value: unknown, code: string): void {
  assert.throws(
    () => receipt.verifyPublishReceipt(value),
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as Error & { code: string }).code === code,
  );
}

test("accepts only the exact sanitized receipt and proves all cross-field links", () => {
  const input = validReceipt();
  assert.deepEqual(receipt.verifyPublishReceipt(input), input);

  const extra = validReceipt();
  extra.command_output = "npm output";
  expectCode(extra, "invalid_receipt_schema");

  const nestedExtra = validReceipt();
  nestedExtra.workflow.headers = {};
  expectCode(nestedExtra, "invalid_receipt_schema");
});

test("historical schema v1 receipt remains immutable and verifies without migration", () => {
  const historicalPath = path.join(
    repositoryRoot,
    ".planning",
    "phases",
    "03.1-javascript-npx",
    "03.1-14-PUBLISH-RECEIPT.json",
  );
  const before = fs.readFileSync(historicalPath);
  const historical: unknown = JSON.parse(before.toString("utf8"));
  assert.equal(receipt.verifyPublishReceipt(historical).schema_version, 1);
  assert.deepEqual(fs.readFileSync(historicalPath), before);
});

test("accepts one closed v2 receipt binding registry, workflow lanes, publish, and dual host evidence", () => {
  const input = validV2Receipt();
  assert.deepEqual(receipt.verifyPublishReceipt(input), input);

  const nestedExtras: Array<(value: JsonMap) => void> = [
    (value) => { value.raw_output = "redacted output"; },
    (value) => { value.registry.exact.extra = true; },
    (value) => { value.workflow.lanes.extra = true; },
    (value) => { value.lifecycle.latest.hosts.codex.headers = {}; },
  ];
  for (const mutate of nestedExtras) {
    const value = validV2Receipt();
    mutate(value);
    expectCode(value, "invalid_receipt_schema");
  }
});

test("v2 rejects registry, release, workflow identity, lane, and publish divergence", () => {
  const fixtures: Array<[name: string, mutate: (value: JsonMap) => void, code: string]> = [
    ["registry exact request", (value) => { value.registry.exact.requestedVersion = "1.2.4"; }, "registry_version_mismatch"],
    ["registry exact resolution", (value) => { value.registry.exact.resolvedVersion = "1.2.2"; }, "registry_version_mismatch"],
    ["registry latest race", (value) => { value.registry.latest.resolvedVersion = "1.2.4"; }, "registry_version_mismatch"],
    ["registry gitHead", (value) => { value.registry.gitHead = "f".repeat(40); }, "registry_git_head_mismatch"],
    ["workflow name", (value) => { value.workflow.name = "CI"; }, "invalid_workflow_identity"],
    ["workflow path", (value) => { value.workflow.path = ".github/workflows/ci.yml"; }, "invalid_workflow_identity"],
    ["workflow tag", (value) => { value.workflow.tag = "v1.2.4"; }, "workflow_ref_mismatch"],
    ["workflow ref", (value) => { value.workflow.ref = "refs/heads/master"; }, "workflow_ref_mismatch"],
    ["workflow head", (value) => { value.workflow.head_sha = "f".repeat(40); }, "workflow_sha_mismatch"],
    ["workflow event", (value) => { value.workflow.event = "workflow_dispatch"; }, "invalid_workflow_event"],
    ["workflow conclusion", (value) => { value.workflow.conclusion = "failure"; }, "workflow_not_successful"],
    ["publish false", (value) => { value.workflow.publish = false; }, "publish_not_successful"],
    ["publish NOT_RUN", (value) => { value.workflow.publish = "NOT_RUN"; }, "publish_not_successful"],
  ];
  for (const lane of [
    "ubuntu-latest-node-22",
    "ubuntu-latest-node-24",
    "windows-latest-node-22",
    "windows-latest-node-24",
  ]) {
    fixtures.push([
      `lane ${lane}`,
      (value) => { value.workflow.lanes[lane] = false; },
      "incomplete_workflow_lanes",
    ]);
  }
  for (const [name, mutate, code] of fixtures) {
    const value = validV2Receipt();
    mutate(value);
    assert.throws(
      () => receipt.verifyPublishReceipt(value),
      (error: unknown) => {
        assert.equal((error as Error & { code?: string }).code, code, name);
        assert.doesNotMatch(error instanceof Error ? error.message : "", /1\.2\.4|refs\/heads|workflow_dispatch/iu);
        return true;
      },
    );
  }
});

test("v2 rejects exact/latest provenance substitution, latest races, digest drift, and every incomplete host bit", () => {
  const fixtures: Array<[name: string, mutate: (value: JsonMap) => void, code: string]> = [
    ["exact requested specifier", (value) => { value.lifecycle.exact_version.requestedPackageSpec = "kcoderag-nav@latest"; }, "lifecycle_provenance_mismatch"],
    ["exact expected version", (value) => { value.lifecycle.exact_version.expectedVersion = "1.2.4"; }, "lifecycle_provenance_mismatch"],
    ["exact resolved version", (value) => { value.lifecycle.exact_version.resolvedVersion = "1.2.2"; }, "lifecycle_provenance_mismatch"],
    ["exact package name", (value) => { value.lifecycle.exact_version.resolvedPackageName = "other-package"; }, "lifecycle_provenance_mismatch"],
    ["exact digest", (value) => { value.lifecycle.exact_version.lifecycleTarballSha256 = "short"; }, "invalid_lifecycle_digest"],
    ["latest requested specifier", (value) => { value.lifecycle.latest.requestedPackageSpec = "kcoderag-nav@next"; }, "lifecycle_provenance_mismatch"],
    ["latest expected version", (value) => { value.lifecycle.latest.expectedVersion = "1.2.4"; }, "lifecycle_provenance_mismatch"],
    ["latest acquired race", (value) => { value.lifecycle.latest.resolvedVersion = "1.2.4"; }, "lifecycle_provenance_mismatch"],
    ["latest package name", (value) => { value.lifecycle.latest.resolvedPackageName = "other-package"; }, "lifecycle_provenance_mismatch"],
    ["latest digest", (value) => { value.lifecycle.latest.lifecycleTarballSha256 = "g".repeat(64); }, "invalid_lifecycle_digest"],
  ];
  for (const [name, mutate, code] of fixtures) {
    const value = validV2Receipt();
    mutate(value);
    assert.throws(
      () => receipt.verifyPublishReceipt(value),
      (error: unknown) => {
        assert.equal((error as Error & { code?: string }).code, code, name);
        return true;
      },
    );
  }

  for (const lifecycleName of ["exact_version", "latest"] as const) {
    for (const host of ["codex", "claude", "cursor"] as const) {
      for (const key of HOST_EVIDENCE_KEYS) {
        for (const unavailable of [false, "NOT_RUN"] as const) {
          const value = validV2Receipt();
          value.lifecycle[lifecycleName].hosts[host][key] = unavailable;
          expectCode(value, "incomplete_evidence");
        }
      }
    }
  }
});

test("v2 recursively rejects output, environment, header, credential, npm, MCP, and Bearer material", () => {
  const secretValues = [
    "Bearer value-that-must-not-appear",
    "NPM_TOKEN=value-that-must-not-appear",
    "NODE_AUTH_TOKEN=value-that-must-not-appear",
    "MCP_AUTHORIZATION=value-that-must-not-appear",
    "https://user:password@example.invalid/package",
    "https://example.invalid/package?secret=value-that-must-not-appear",
  ];
  for (const secret of secretValues) {
    const value = validV2Receipt();
    value.registry.repository = secret;
    expectCode(value, "secret_like_value");
  }

  for (const extraKey of ["raw_output", "environment", "headers", "command_output"]) {
    const value = validV2Receipt();
    value.lifecycle.latest.hosts.cursor[extraKey] = "redacted";
    expectCode(value, "invalid_receipt_schema");
  }
});

test("record accepts a verified v2 receipt without widening the atomic JSON output", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-publish-receipt-v2-"));
  try {
    const target = path.join(root, "receipt.json");
    const input = validV2Receipt();
    assert.deepEqual(receipt.recordPublishReceipt(target, input), input);
    assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), input);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects wrong run, SHA, tag, version, failure, and incomplete evidence", () => {
  const fixtures: Array<[mutate: (value: JsonMap) => void, code: string]> = [
    [(value) => { value.workflow.run_id = "not-a-run"; }, "invalid_workflow_run"],
    [(value) => { value.workflow.head_sha = "f".repeat(40); }, "workflow_sha_mismatch"],
    [(value) => { value.tag = "v1.2.4"; }, "tag_version_mismatch"],
    [(value) => { value.registry.latest = "1.2.2"; }, "registry_version_mismatch"],
    [(value) => { value.workflow.conclusion = "failure"; }, "workflow_not_successful"],
    [(value) => { value.workflow.event = "workflow_dispatch"; }, "invalid_workflow_event"],
    [(value) => { value.evidence.cursor = false; }, "incomplete_evidence"],
    [(value) => { value.evidence.cursor = "NOT_RUN"; }, "incomplete_evidence"],
  ];
  for (const [mutate, code] of fixtures) {
    const value = validReceipt();
    mutate(value);
    expectCode(value, code);
  }
});

test("rejects command, environment, header, credential URL, and secret sentinels anywhere", () => {
  for (const secret of [
    "Bearer value-that-must-not-appear",
    "NPM_TOKEN=value-that-must-not-appear",
    "NODE_AUTH_TOKEN=value-that-must-not-appear",
    "https://user:password@example.invalid/package",
    "https://example.invalid/package?token=value-that-must-not-appear",
  ]) {
    const value = validReceipt();
    value.registry.repository = secret;
    expectCode(value, "secret_like_value");
  }
});

test("record and verify CLI writes one private atomic allow-listed JSON document", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-publish-receipt-"));
  const target = path.join(root, "receipt.json");
  const stdout: string[] = [];
  const stderr: string[] = [];
  assert.equal(receipt.runCli(["--record", target], {
    stdinText: JSON.stringify(validReceipt()),
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  }), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), validReceipt());
  if (process.platform !== "win32") assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.equal(receipt.runCli(["--verify", target], {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  }), 0);
  assert.equal(stderr.join(""), "");
  assert.match(stdout.join(""), /"ok":true/u);
  assert.doesNotMatch(stdout.join(""), /0123456789abcdef|run_id|repository/iu);
});

test("CLI fails closed for invalid modes, missing fields, and secret input without leaking values", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-publish-receipt-bad-"));
  const target = path.join(root, "receipt.json");
  for (const [argv, stdinText] of [
    [["--record"], JSON.stringify(validReceipt())],
    [["--unknown", target], JSON.stringify(validReceipt())],
    [["--record", target, "--verify", target], JSON.stringify(validReceipt())],
    [["--record", target], JSON.stringify({ ...validReceipt(), bearer: "sentinel-secret" })],
  ] as Array<[string[], string]>) {
    const errors: string[] = [];
    assert.notEqual(receipt.runCli(argv, { stdinText, stdout() {}, stderr: (text) => errors.push(text) }), 0);
    assert.doesNotMatch(errors.join(""), /sentinel-secret|0123456789abcdef/iu);
  }
});

test("validator source is offline and has no process environment or command-output seam", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "src", "maintainer", "publish-receipt.cts"), "utf8");
  assert.doesNotMatch(source, /node:https|node:http|fetch\s*\(|process\.env|child_process|execFile|spawn/iu);
  assert.doesNotMatch(source, /command_output|headers|authorization/iu);
});
