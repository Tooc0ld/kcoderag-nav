#!/usr/bin/env node
/** Offline validator and atomic writer for sanitized npm publication evidence. */

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

type JsonMap = Record<string, any>;

export interface PublishReceiptV1 {
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

interface ReceiptHostEvidence {
  readonly packageAcquired: true;
  readonly install: true;
  readonly status: true;
  readonly toolRegistration: true;
  readonly navigation: true;
  readonly mcpInitialize: true;
  readonly mcpList: true;
  readonly mcpCall: true;
  readonly update: true;
  readonly uninstall: true;
  readonly stubReceipt: true;
}

interface ReceiptLifecycleEvidence {
  readonly requestedPackageSpec: string;
  readonly expectedVersion: string;
  readonly resolvedPackageName: "kcoderag-nav";
  readonly resolvedVersion: string;
  readonly lifecycleTarballSha256: string;
  readonly hosts: {
    readonly codex: ReceiptHostEvidence;
    readonly claude: ReceiptHostEvidence;
    readonly cursor: ReceiptHostEvidence;
  };
}

interface ReceiptPublicRegistryArtifact {
  readonly registry: "https://registry.npmjs.org/";
  readonly resolvedTarballUrl: string;
  readonly distIntegrity: string;
  readonly artifactSha256: string;
  readonly artifactSha512: string;
}

interface ReceiptLifecycleEvidenceV3 extends ReceiptLifecycleEvidence {
  readonly publicRegistryArtifact: ReceiptPublicRegistryArtifact;
}

export interface PublishReceiptV2 {
  readonly schema_version: 2;
  readonly package: "kcoderag-nav";
  readonly version: string;
  readonly tag: string;
  readonly release_commit_sha: string;
  readonly registry: {
    readonly exact: {
      readonly requestedVersion: string;
      readonly resolvedVersion: string;
    };
    readonly latest: {
      readonly resolvedVersion: string;
    };
    readonly gitHead: string;
    readonly bin: { readonly "kcoderag-nav": "dist/bin/kcoderag-nav.cjs" };
    readonly engines: { readonly node: ">=22" };
    readonly repository: "git+https://github.com/Tooc0ld/kcoderag-nav.git";
  };
  readonly workflow: {
    readonly name: "Release";
    readonly path: ".github/workflows/release.yml";
    readonly run_id: string;
    readonly tag: string;
    readonly ref: string;
    readonly head_sha: string;
    readonly event: "push";
    readonly conclusion: "success";
    readonly lanes: {
      readonly "ubuntu-latest-node-22": true;
      readonly "ubuntu-latest-node-24": true;
      readonly "windows-latest-node-22": true;
      readonly "windows-latest-node-24": true;
    };
    readonly publish: true;
  };
  readonly lifecycle: {
    readonly exact_version: ReceiptLifecycleEvidence;
    readonly latest: ReceiptLifecycleEvidence;
  };
  readonly timestamp: string;
}

export interface PublishReceiptV3 extends Omit<PublishReceiptV2, "schema_version" | "lifecycle"> {
  readonly schema_version: 3;
  readonly lifecycle: {
    readonly exact_version: ReceiptLifecycleEvidenceV3;
    readonly latest: ReceiptLifecycleEvidenceV3;
  };
}

export type PublishReceipt = PublishReceiptV1 | PublishReceiptV2 | PublishReceiptV3;

const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const SHA_RE = /^[0-9a-f]{40}$/u;
const DIGEST_RE = /^[0-9a-f]{64}$/u;
const SHA512_RE = /^[0-9a-f]{128}$/u;
const RUN_ID_RE = /^[1-9][0-9]*$/u;
const SECRET_RE = /(?:bearer\s+|npm_token\s*=|node_auth_token\s*=|mcp[_ -]?(?:auth|token|credential)|:\/\/[^/@\s:]+:[^/@\s]+@|[?&](?:token|key|secret)=)/iu;
const HOSTS = Object.freeze(["codex", "claude", "cursor"] as const);
const HOST_EVIDENCE_KEYS = Object.freeze([
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
] as const);
const RELEASE_LANES = Object.freeze([
  "ubuntu-latest-node-22",
  "ubuntu-latest-node-24",
  "windows-latest-node-22",
  "windows-latest-node-24",
] as const);

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

function verifyPublishReceiptV1(value: JsonMap): PublishReceiptV1 {
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
  return value as PublishReceiptV1;
}

function verifyHostEvidence(value: unknown): asserts value is ReceiptHostEvidence {
  failUnless(exactKeys(value, HOST_EVIDENCE_KEYS), "invalid_receipt_schema");
  failUnless(HOST_EVIDENCE_KEYS.every((key) => value[key] === true), "incomplete_evidence");
}

function verifyLifecycleEvidence(
  value: unknown,
  requestedPackageSpec: string,
  expectedVersion: string,
): asserts value is ReceiptLifecycleEvidence {
  failUnless(exactKeys(value, [
    "requestedPackageSpec",
    "expectedVersion",
    "resolvedPackageName",
    "resolvedVersion",
    "lifecycleTarballSha256",
    "hosts",
  ]), "invalid_receipt_schema");
  failUnless(
    value.requestedPackageSpec === requestedPackageSpec &&
      value.expectedVersion === expectedVersion &&
      value.resolvedPackageName === "kcoderag-nav" &&
      value.resolvedVersion === expectedVersion,
    "lifecycle_provenance_mismatch",
  );
  failUnless(
    typeof value.lifecycleTarballSha256 === "string" && DIGEST_RE.test(value.lifecycleTarballSha256),
    "invalid_lifecycle_digest",
  );
  failUnless(exactKeys(value.hosts, HOSTS), "invalid_receipt_schema");
  for (const host of HOSTS) verifyHostEvidence(value.hosts[host]);
}

function verifyPublishReceiptV2(value: JsonMap): PublishReceiptV2 {
  failUnless(exactKeys(value, [
    "schema_version",
    "package",
    "version",
    "tag",
    "release_commit_sha",
    "registry",
    "workflow",
    "lifecycle",
    "timestamp",
  ]), "invalid_receipt_schema");
  failUnless(value.schema_version === 2 && value.package === "kcoderag-nav", "invalid_receipt_schema");
  failUnless(typeof value.version === "string" && VERSION_RE.test(value.version), "invalid_version");
  failUnless(value.tag === `v${value.version}`, "tag_version_mismatch");
  failUnless(typeof value.release_commit_sha === "string" && SHA_RE.test(value.release_commit_sha), "invalid_release_sha");
  failUnless(validTimestamp(value.timestamp), "invalid_timestamp");

  failUnless(
    exactKeys(value.registry, ["exact", "latest", "gitHead", "bin", "engines", "repository"])
      && exactKeys(value.registry.exact, ["requestedVersion", "resolvedVersion"])
      && exactKeys(value.registry.latest, ["resolvedVersion"])
      && exactKeys(value.registry.bin, ["kcoderag-nav"])
      && exactKeys(value.registry.engines, ["node"]),
    "invalid_receipt_schema",
  );
  failUnless(
    value.registry.exact.requestedVersion === value.version &&
      value.registry.exact.resolvedVersion === value.version &&
      value.registry.latest.resolvedVersion === value.version,
    "registry_version_mismatch",
  );
  failUnless(value.registry.gitHead === value.release_commit_sha, "registry_git_head_mismatch");
  failUnless(value.registry.bin["kcoderag-nav"] === "dist/bin/kcoderag-nav.cjs", "registry_metadata_mismatch");
  failUnless(value.registry.engines.node === ">=22", "registry_metadata_mismatch");
  failUnless(
    value.registry.repository === "git+https://github.com/Tooc0ld/kcoderag-nav.git",
    "registry_metadata_mismatch",
  );

  failUnless(exactKeys(value.workflow, [
    "name",
    "path",
    "run_id",
    "tag",
    "ref",
    "head_sha",
    "event",
    "conclusion",
    "lanes",
    "publish",
  ]), "invalid_receipt_schema");
  failUnless(
    value.workflow.name === "Release" && value.workflow.path === ".github/workflows/release.yml",
    "invalid_workflow_identity",
  );
  failUnless(typeof value.workflow.run_id === "string" && RUN_ID_RE.test(value.workflow.run_id), "invalid_workflow_run");
  failUnless(
    value.workflow.tag === value.tag && value.workflow.ref === `refs/tags/${value.tag}`,
    "workflow_ref_mismatch",
  );
  failUnless(value.workflow.head_sha === value.release_commit_sha, "workflow_sha_mismatch");
  failUnless(value.workflow.event === "push", "invalid_workflow_event");
  failUnless(value.workflow.conclusion === "success", "workflow_not_successful");
  failUnless(exactKeys(value.workflow.lanes, RELEASE_LANES), "invalid_receipt_schema");
  failUnless(RELEASE_LANES.every((lane) => value.workflow.lanes[lane] === true), "incomplete_workflow_lanes");
  failUnless(value.workflow.publish === true, "publish_not_successful");

  failUnless(exactKeys(value.lifecycle, ["exact_version", "latest"]), "invalid_receipt_schema");
  verifyLifecycleEvidence(value.lifecycle.exact_version, `kcoderag-nav@${value.registry.exact.requestedVersion}`, value.registry.exact.resolvedVersion);
  verifyLifecycleEvidence(value.lifecycle.latest, "kcoderag-nav@latest", value.registry.latest.resolvedVersion);
  return value as PublishReceiptV2;
}

function verifyPublicRegistryArtifact(value: unknown, version: string): asserts value is ReceiptPublicRegistryArtifact {
  failUnless(exactKeys(value, [
    "registry",
    "resolvedTarballUrl",
    "distIntegrity",
    "artifactSha256",
    "artifactSha512",
  ]), "invalid_receipt_schema");
  failUnless(value.registry === "https://registry.npmjs.org/", "invalid_registry_origin");
  let tarballUrl: URL;
  try {
    tarballUrl = new URL(value.resolvedTarballUrl);
  } catch {
    throw new PublishReceiptError("invalid_registry_artifact");
  }
  failUnless(
    tarballUrl.protocol === "https:" && tarballUrl.hostname === "registry.npmjs.org" && tarballUrl.port === "" &&
      tarballUrl.username === "" && tarballUrl.password === "" && tarballUrl.search === "" && tarballUrl.hash === "" &&
      tarballUrl.pathname === `/kcoderag-nav/-/kcoderag-nav-${version}.tgz`,
    "invalid_registry_artifact",
  );
  failUnless(typeof value.artifactSha256 === "string" && DIGEST_RE.test(value.artifactSha256), "invalid_registry_digest");
  failUnless(typeof value.artifactSha512 === "string" && SHA512_RE.test(value.artifactSha512), "invalid_registry_digest");
  failUnless(
    value.distIntegrity === `sha512-${Buffer.from(value.artifactSha512, "hex").toString("base64")}`,
    "registry_integrity_mismatch",
  );
}

function verifyLifecycleEvidenceV3(
  value: unknown,
  requestedPackageSpec: string,
  expectedVersion: string,
): asserts value is ReceiptLifecycleEvidenceV3 {
  failUnless(exactKeys(value, [
    "requestedPackageSpec",
    "expectedVersion",
    "resolvedPackageName",
    "resolvedVersion",
    "lifecycleTarballSha256",
    "publicRegistryArtifact",
    "hosts",
  ]), "invalid_receipt_schema");
  const { publicRegistryArtifact, ...legacyEvidence } = value;
  verifyLifecycleEvidence(legacyEvidence, requestedPackageSpec, expectedVersion);
  verifyPublicRegistryArtifact(publicRegistryArtifact, expectedVersion);
}

function verifyPublishReceiptV3(value: JsonMap): PublishReceiptV3 {
  failUnless(exactKeys(value, [
    "schema_version",
    "package",
    "version",
    "tag",
    "release_commit_sha",
    "registry",
    "workflow",
    "lifecycle",
    "timestamp",
  ]), "invalid_receipt_schema");
  failUnless(value.schema_version === 3 && value.package === "kcoderag-nav", "invalid_receipt_schema");
  failUnless(exactKeys(value.lifecycle, ["exact_version", "latest"]), "invalid_receipt_schema");
  const withoutPublicArtifact = (lifecycle: JsonMap): JsonMap => {
    const { publicRegistryArtifact: _publicRegistryArtifact, ...legacy } = lifecycle;
    return legacy;
  };
  verifyPublishReceiptV2({
    ...value,
    schema_version: 2,
    lifecycle: {
      exact_version: withoutPublicArtifact(value.lifecycle.exact_version),
      latest: withoutPublicArtifact(value.lifecycle.latest),
    },
  });
  verifyLifecycleEvidenceV3(
    value.lifecycle.exact_version,
    `kcoderag-nav@${value.registry.exact.requestedVersion}`,
    value.registry.exact.resolvedVersion,
  );
  verifyLifecycleEvidenceV3(value.lifecycle.latest, "kcoderag-nav@latest", value.registry.latest.resolvedVersion);
  return value as PublishReceiptV3;
}

export function verifyPublishReceipt(value: unknown): PublishReceipt {
  assertNoSecretLikeValue(value);
  failUnless(isRecord(value), "invalid_receipt_schema");
  if (value.schema_version === 1) return verifyPublishReceiptV1(value);
  if (value.schema_version === 2) return verifyPublishReceiptV2(value);
  if (value.schema_version === 3) return verifyPublishReceiptV3(value);
  throw new PublishReceiptError("invalid_receipt_schema");
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
