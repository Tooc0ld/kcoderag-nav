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
