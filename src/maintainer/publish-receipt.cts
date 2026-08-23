#!/usr/bin/env node
/** Offline validator and atomic writer for sanitized npm publication evidence. */

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

type JsonMap = Record<string, any>;

export interface PublishReceipt {
  readonly schema_version: 1;
  readonly package: "kcoderag-nav";
  readonly version: string;
  readonly tag: string;
  readonly release_commit_sha: string;
  readonly workflow: {
    readonly run_id: string;
    readonly head_sha: string;
    readonly event: "push";
    readonly conclusion: "success";
  };
  readonly registry: {
    readonly latest: string;
    readonly bin: { readonly "kcoderag-nav": "dist/bin/kcoderag-nav.cjs" };
    readonly engines: { readonly node: ">=22" };
    readonly repository: "git+https://github.com/Tooc0ld/kcoderag-nav.git";
  };
  readonly evidence: {
    readonly registry_metadata: true;
    readonly npx_install: true;
    readonly codex: true;
    readonly claude: true;
    readonly cursor: true;
  };
  readonly timestamp: string;
}

const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const SHA_RE = /^[0-9a-f]{40}$/u;
const RUN_ID_RE = /^[1-9][0-9]*$/u;
const SECRET_RE = /(?:bearer\s+|npm_token\s*=|node_auth_token\s*=|:\/\/[^/@\s:]+:[^/@\s]+@|[?&](?:token|key|secret)=)/iu;

export class PublishReceiptError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "PublishReceiptError";
    this.code = code;
  }
}

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new PublishReceiptError(code);
}

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, expected: readonly string[]): value is JsonMap {
  return isRecord(value)
    && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function assertNoSecretLikeValue(value: unknown): void {
  if (typeof value === "string") {
    failUnless(!SECRET_RE.test(value), "secret_like_value");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretLikeValue(item);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) assertNoSecretLikeValue(item);
  }
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

export function verifyPublishReceipt(value: unknown): PublishReceipt {
  assertNoSecretLikeValue(value);
  failUnless(exactKeys(value, [
    "schema_version",
    "package",
    "version",
    "tag",
    "release_commit_sha",
    "workflow",
    "registry",
    "evidence",
    "timestamp",
  ]), "invalid_receipt_schema");
  failUnless(value.schema_version === 1 && value.package === "kcoderag-nav", "invalid_receipt_schema");
  failUnless(typeof value.version === "string" && VERSION_RE.test(value.version), "invalid_version");
  failUnless(value.tag === `v${value.version}`, "tag_version_mismatch");
  failUnless(typeof value.release_commit_sha === "string" && SHA_RE.test(value.release_commit_sha), "invalid_release_sha");
  failUnless(validTimestamp(value.timestamp), "invalid_timestamp");

  failUnless(
    exactKeys(value.workflow, ["run_id", "head_sha", "event", "conclusion"]),
    "invalid_receipt_schema",
  );
  failUnless(typeof value.workflow.run_id === "string" && RUN_ID_RE.test(value.workflow.run_id), "invalid_workflow_run");
  failUnless(value.workflow.event === "push", "invalid_workflow_event");
  failUnless(value.workflow.conclusion === "success", "workflow_not_successful");
  failUnless(value.workflow.head_sha === value.release_commit_sha, "workflow_sha_mismatch");

  failUnless(
    exactKeys(value.registry, ["latest", "bin", "engines", "repository"])
      && exactKeys(value.registry.bin, ["kcoderag-nav"])
      && exactKeys(value.registry.engines, ["node"]),
    "invalid_receipt_schema",
  );
  failUnless(value.registry.latest === value.version, "registry_version_mismatch");
  failUnless(value.registry.bin["kcoderag-nav"] === "dist/bin/kcoderag-nav.cjs", "registry_metadata_mismatch");
  failUnless(value.registry.engines.node === ">=22", "registry_metadata_mismatch");
  failUnless(
    value.registry.repository === "git+https://github.com/Tooc0ld/kcoderag-nav.git",
    "registry_metadata_mismatch",
  );

  failUnless(
    exactKeys(value.evidence, ["registry_metadata", "npx_install", "codex", "claude", "cursor"]),
    "invalid_receipt_schema",
  );
  failUnless(Object.values(value.evidence).every((item) => item === true), "incomplete_evidence");
  return value as PublishReceipt;
}

function writeJsonAtomic(filePath: string, value: PublishReceipt): void {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporary = `${absolutePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, absolutePath);
    try { fs.chmodSync(absolutePath, 0o600); } catch { /* Windows does not expose POSIX modes. */ }
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best-effort private temporary cleanup */ }
  }
}

export function recordPublishReceipt(filePath: string, value: unknown): PublishReceipt {
  const verified = verifyPublishReceipt(value);
  writeJsonAtomic(filePath, verified);
  return verified;
}

interface CliIo {
  readonly stdinText?: string;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

export function runCli(argv: readonly string[] = process.argv.slice(2), io: CliIo = {}): number {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
  try {
    failUnless(argv.length === 2, "invalid_arguments");
    const mode = argv[0];
    const filePath = argv[1];
    failUnless((mode === "--record" || mode === "--verify") && typeof filePath === "string" && filePath.length > 0, "invalid_arguments");
    if (mode === "--record") {
      const source = io.stdinText ?? fs.readFileSync(0, "utf8");
      let parsed: unknown;
      try { parsed = JSON.parse(source) as unknown; } catch { throw new PublishReceiptError("invalid_json"); }
      recordPublishReceipt(filePath, parsed);
    } else {
      let parsed: unknown;
      try { parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown; } catch { throw new PublishReceiptError("invalid_json"); }
      verifyPublishReceipt(parsed);
    }
    stdout(`${JSON.stringify({ ok: true, mode: mode.slice(2), file: path.basename(filePath) })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof PublishReceiptError ? error.code : "publish_receipt_failed";
    stderr(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

exports.PublishReceiptError = PublishReceiptError;
exports.verifyPublishReceipt = verifyPublishReceipt;
exports.recordPublishReceipt = recordPublishReceipt;
exports.runCli = runCli;

if (require.main === module) process.exitCode = runCli();
