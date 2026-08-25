#!/usr/bin/env node
/** Closed, bounded, metadata-only validator for the real Head acceptance receipt. */

type JsonMap = Record<string, any>;

const crypto = require("node:crypto") as typeof import("node:crypto");

export interface HeadAcceptanceResult {
  readonly ok: true;
  readonly version: "0.2.0";
  readonly releaseSha: string;
  readonly acceptanceCommitSha: string;
  readonly managedPathCount: number;
}

const SHA_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SHA512_RE = /^[0-9a-f]{128}$/u;
const FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/u;
const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const MANAGED_PATHS = Object.freeze([
  ".agents/skills/kcoderag-nav/SKILL.md",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".codex/kcoderag-nav/qa/hooks/grep-nudge.cjs",
  ".codex/kcoderag-nav/qa/hooks/run_hook.cmd",
  ".codex/kcoderag-nav/qa/hooks/run_hook.sh",
  ".codex/kcoderag-nav/qa/hooks/update-check.cjs",
  ".codex/kcoderag-nav/qa/hooks/update-worker.cjs",
  ".codex/kcoderag-nav/install-state.json",
] as const);
const CLEANUP_ARGV = Object.freeze([
  "codex", "plugin", "marketplace", "remove", "kcoderag-nav", "--json",
] as const);
const PLUGIN_LIST_ARGV = Object.freeze(["codex", "plugin", "list", "--json"] as const);
const MARKETPLACE_LIST_ARGV = Object.freeze([
  "codex", "plugin", "marketplace", "list", "--json",
] as const);
const MAX_DEPTH = 16;
const MAX_NODES = 512;
const MAX_ARRAY_ITEMS = 32;
const MAX_STRING_LENGTH = 512;

export class HeadAcceptanceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "HeadAcceptanceError";
    this.code = code;
  }
}

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new HeadAcceptanceError(code);
}

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is JsonMap {
  return isRecord(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function assertBounded(value: unknown): void {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    nodes += 1;
    failUnless(nodes <= MAX_NODES && current.depth <= MAX_DEPTH, "invalid_acceptance_schema");
    if (typeof current.value === "string") {
      failUnless(current.value.length <= MAX_STRING_LENGTH, "invalid_acceptance_schema");
      continue;
    }
    if (typeof current.value !== "object" || current.value === null) continue;
    failUnless(!seen.has(current.value), "invalid_acceptance_schema");
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      failUnless(current.value.length <= MAX_ARRAY_ITEMS, "invalid_acceptance_schema");
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    const keys = Object.keys(current.value);
    failUnless(keys.length <= MAX_ARRAY_ITEMS, "invalid_acceptance_schema");
    for (const key of keys) {
      failUnless(key.length <= 80, "invalid_acceptance_schema");
      pending.push({ value: (current.value as JsonMap)[key], depth: current.depth + 1 });
    }
  }
}

function exactArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item) => typeof item === "string")
    && new Set(value).size === value.length
    && [...value].sort().join("\0") === [...expected].sort().join("\0");
}

function exactOrderedArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalCleanupFingerprint(capability: JsonMap): string {
  const nativeCapability = {
    host: capability.host,
    cli: capability.cli,
    minimumVersion: capability.minimumVersion,
    observedVersion: capability.observedVersion,
    inventorySchemaId: capability.inventorySchemaId,
    completeInventory: capability.completeInventory,
    route: capability.route,
  };
  const seed = {
    argv: [...CLEANUP_ARGV],
    capability: nativeCapability,
    host: "codex",
    safePath: ".codex/config.toml",
    scope: "marketplace:kcoderag-nav",
    sourceType: "owned_marketplace_registration",
    timeoutMs: 5_000,
  };
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalize(seed))).digest("hex")}`;
}

function validatePublicationIdentity(value: unknown): JsonMap {
  failUnless(exactKeys(value, [
    "package", "version", "tag", "releaseSha", "gitHead", "distIntegrity", "tarSha256", "artifactSha512",
  ]), "invalid_acceptance_schema");
  failUnless(
    typeof value.version === "string" && VERSION_RE.test(value.version)
      && typeof value.releaseSha === "string" && SHA_RE.test(value.releaseSha)
      && typeof value.gitHead === "string" && SHA_RE.test(value.gitHead)
      && typeof value.tarSha256 === "string" && SHA256_RE.test(value.tarSha256)
      && typeof value.artifactSha512 === "string" && SHA512_RE.test(value.artifactSha512)
      && typeof value.distIntegrity === "string"
      && value.distIntegrity === `sha512-${Buffer.from(value.artifactSha512, "hex").toString("base64")}`,
    "invalid_publication_identity",
  );
  failUnless(
    value.package === "kcoderag-nav"
      && value.version === "0.2.0"
      && value.tag === "v0.2.0"
      && value.gitHead === value.releaseSha,
    "publication_identity_mismatch",
  );
  return value;
}

function validateInventory(value: unknown, expectedArgv: readonly string[]): void {
  failUnless(exactKeys(value, [
    "argv", "timeoutMs", "success", "complete", "ownedSourceAbsent",
  ]), "invalid_acceptance_schema");
  failUnless(exactOrderedArray(value.argv, expectedArgv) && value.timeoutMs === 5_000, "post_removal_incomplete");
  failUnless(
    value.success === true && value.complete === true && value.ownedSourceAbsent === true,
    "post_removal_incomplete",
  );
}

function validateFinalDiagnostic(value: unknown, doctor: boolean): void {
  const keys = doctor
    ? ["schemaVersion", "host", "environment", "packageVersion", "status", "ok", "activeConflictCount", "managedDriftCount"]
    : ["schemaVersion", "host", "environment", "packageVersion", "status", "activeConflictCount", "managedDriftCount"];
  failUnless(exactKeys(value, keys), "invalid_acceptance_schema");
  failUnless(
    value.schemaVersion === 1
      && value.host === "codex"
      && value.environment === "qa"
      && value.packageVersion === "0.2.0"
      && value.status === "healthy"
      && value.activeConflictCount === 0
      && value.managedDriftCount === 0
      && (!doctor || value.ok === true),
    "final_diagnostics_unhealthy",
  );
}

function validateUnchanged(value: unknown): void {
  failUnless(exactKeys(value, ["unchanged", "digest"]), "invalid_acceptance_schema");
  failUnless(value.unchanged === true && typeof value.digest === "string" && FINGERPRINT_RE.test(value.digest), "unrelated_scope_changed");
}

export function validateHeadAcceptance(value: unknown): HeadAcceptanceResult {
  assertBounded(value);
  failUnless(exactKeys(value, [
    "schemaVersion", "publication", "baseline", "cleanup", "final", "scope", "acceptance",
  ]), "invalid_acceptance_schema");
  failUnless(value.schemaVersion === 1, "invalid_acceptance_schema");

  failUnless(exactKeys(value.publication, ["receipt", "validatedReceipt"]), "invalid_acceptance_schema");
  const receipt = validatePublicationIdentity(value.publication.receipt);
  const validatedReceipt = validatePublicationIdentity(value.publication.validatedReceipt);
  failUnless(
    ["package", "version", "tag", "releaseSha", "gitHead", "distIntegrity", "tarSha256", "artifactSha512"]
      .every((key) => receipt[key] === validatedReceipt[key]),
    "publication_receipt_mismatch",
  );

  failUnless(exactKeys(value.baseline, [
    "selectedHost", "managedDriftCount", "finding", "capability", "cleanupPlanFingerprint",
  ]), "invalid_acceptance_schema");
  failUnless(value.baseline.selectedHost === "codex", "degraded_source_mismatch");
  failUnless(value.baseline.managedDriftCount === 0, "baseline_drift");
  failUnless(exactKeys(value.baseline.finding, [
    "count", "code", "sourceType", "scope", "marketplaceName", "safePath", "sourcePathDigest",
    "recognizedSourcePathDigest", "provenanceId", "failureAttribution", "pluginListErrorCode",
    "marketplaceListErrorCode", "exclusiveUserMarketplace", "cleanupEligible",
  ]), "invalid_acceptance_schema");
  const finding = value.baseline.finding;
  failUnless(
    finding.count === 1
      && finding.code === "owned_marketplace_source"
      && finding.sourceType === "owned_marketplace_registration"
      && finding.scope === "user"
      && finding.marketplaceName === "kcoderag-nav"
      && finding.safePath === ".codex/config.toml"
      && typeof finding.sourcePathDigest === "string" && FINGERPRINT_RE.test(finding.sourcePathDigest)
      && finding.recognizedSourcePathDigest === finding.sourcePathDigest
      && finding.provenanceId === "kcoderag-nav-repository-v1"
      && finding.failureAttribution === "marketplace_load"
      && finding.pluginListErrorCode === "marketplace_load"
      && finding.marketplaceListErrorCode === "marketplace_load"
      && finding.exclusiveUserMarketplace === true
      && finding.cleanupEligible === true,
    "degraded_source_mismatch",
  );
  failUnless(exactKeys(value.baseline.capability, [
    "host", "cli", "minimumVersion", "observedVersion", "inventorySchemaId", "completeInventory", "route",
    "marketplaceRemoveSupported",
  ]), "invalid_acceptance_schema");
  const capability = value.baseline.capability;
  failUnless(
    capability.host === "codex"
      && capability.cli === "codex"
      && capability.minimumVersion === "0.146.1"
      && typeof capability.observedVersion === "string" && VERSION_RE.test(capability.observedVersion)
      && capability.inventorySchemaId === "codex-plugin-v1"
      && capability.completeInventory === false
      && capability.route === "degraded_owned_registration"
      && capability.marketplaceRemoveSupported === true,
    "cleanup_capability_mismatch",
  );
  failUnless(
    typeof value.baseline.cleanupPlanFingerprint === "string"
      && FINGERPRINT_RE.test(value.baseline.cleanupPlanFingerprint),
    "invalid_cleanup_fingerprint",
  );
  failUnless(
    value.baseline.cleanupPlanFingerprint === canonicalCleanupFingerprint(capability),
    "cleanup_fingerprint_mismatch",
  );

  failUnless(exactKeys(value.cleanup, [
    "planFingerprint", "replayedFingerprint", "native", "postRemoval",
  ]), "invalid_acceptance_schema");
  failUnless(
    value.cleanup.planFingerprint === value.baseline.cleanupPlanFingerprint
      && value.cleanup.replayedFingerprint === value.baseline.cleanupPlanFingerprint,
    "cleanup_fingerprint_mismatch",
  );
  failUnless(exactKeys(value.cleanup.native, [
    "argv", "timeoutMs", "exitCode", "timedOut", "success",
  ]), "invalid_acceptance_schema");
  failUnless(
    exactOrderedArray(value.cleanup.native.argv, CLEANUP_ARGV)
      && value.cleanup.native.timeoutMs === 5_000
      && value.cleanup.native.exitCode === 0
      && value.cleanup.native.timedOut === false
      && value.cleanup.native.success === true,
    "cleanup_native_mismatch",
  );
  failUnless(exactKeys(value.cleanup.postRemoval, [
    "beforeProjectWrites", "plugins", "marketplaces",
  ]), "invalid_acceptance_schema");
  failUnless(value.cleanup.postRemoval.beforeProjectWrites === true, "post_removal_incomplete");
  validateInventory(value.cleanup.postRemoval.plugins, PLUGIN_LIST_ARGV);
  validateInventory(value.cleanup.postRemoval.marketplaces, MARKETPLACE_LIST_ARGV);

  failUnless(exactKeys(value.final, ["status", "doctor", "hooks"]), "invalid_acceptance_schema");
  validateFinalDiagnostic(value.final.status, false);
  validateFinalDiagnostic(value.final.doctor, true);
  failUnless(exactKeys(value.final.hooks, ["root", "deep"]), "invalid_acceptance_schema");
  failUnless(exactKeys(value.final.hooks.root, [
    "ran", "nearestStateDigest", "launcherDigest", "protocolClass",
  ]), "invalid_acceptance_schema");
  failUnless(exactKeys(value.final.hooks.deep, [
    "ran", "unicodeAndSpaceCwd", "nearestStateDigest", "launcherDigest", "protocolClass",
  ]), "invalid_acceptance_schema");
  const rootHook = value.final.hooks.root;
  const deepHook = value.final.hooks.deep;
  failUnless(
    rootHook.ran === true && deepHook.ran === true && deepHook.unicodeAndSpaceCwd === true
      && rootHook.protocolClass === "advisory" && deepHook.protocolClass === "advisory",
    "hook_execution_incomplete",
  );
  failUnless(
    typeof rootHook.nearestStateDigest === "string" && FINGERPRINT_RE.test(rootHook.nearestStateDigest)
      && typeof rootHook.launcherDigest === "string" && FINGERPRINT_RE.test(rootHook.launcherDigest)
      && deepHook.nearestStateDigest === rootHook.nearestStateDigest
      && deepHook.launcherDigest === rootHook.launcherDigest,
    "hook_identity_mismatch",
  );

  failUnless(exactKeys(value.scope, [
    "declaredCodexManagedPaths", "changed", "unchanged",
  ]), "invalid_acceptance_schema");
  failUnless(exactArray(value.scope.declaredCodexManagedPaths, MANAGED_PATHS), "changed_scope_mismatch");
  failUnless(Array.isArray(value.scope.changed) && value.scope.changed.length === MANAGED_PATHS.length + 1, "changed_scope_mismatch");
  const changedIds = new Set<string>();
  for (const change of value.scope.changed) {
    failUnless(exactKeys(change, ["kind", "id", "fingerprint"]), "invalid_acceptance_schema");
    failUnless(typeof change.fingerprint === "string" && FINGERPRINT_RE.test(change.fingerprint), "changed_scope_mismatch");
    if (change.kind === "managed") {
      failUnless(typeof change.id === "string" && MANAGED_PATHS.includes(change.id as typeof MANAGED_PATHS[number]), "changed_scope_mismatch");
    } else {
      failUnless(
        change.kind === "cleanup"
          && change.id === "marketplace:kcoderag-nav"
          && change.fingerprint === value.baseline.cleanupPlanFingerprint,
        "changed_scope_mismatch",
      );
    }
    failUnless(!changedIds.has(`${change.kind}\0${change.id}`), "changed_scope_mismatch");
    changedIds.add(`${change.kind}\0${change.id}`);
  }
  const expectedChangedIds = new Set([
    ...MANAGED_PATHS.map((managedPath) => `managed\0${managedPath}`),
    "cleanup\0marketplace:kcoderag-nav",
  ]);
  failUnless(
    changedIds.size === expectedChangedIds.size && [...expectedChangedIds].every((id) => changedIds.has(id)),
    "changed_scope_mismatch",
  );
  failUnless(exactKeys(value.scope.unchanged, [
    "unrelatedHeadPaths", "claudeProjectTree", "cursorProjectTree", "siblingProjects", "unrelatedCodexUserConfig",
  ]), "invalid_acceptance_schema");
  for (const key of [
    "unrelatedHeadPaths", "claudeProjectTree", "cursorProjectTree", "siblingProjects", "unrelatedCodexUserConfig",
  ]) validateUnchanged(value.scope.unchanged[key]);

  failUnless(exactKeys(value.acceptance, [
    "receiptSha256", "receiptCommitSha", "publicReceiptSha256", "publicReleaseSha",
  ]), "invalid_acceptance_schema");
  failUnless(
    typeof value.acceptance.receiptSha256 === "string" && FINGERPRINT_RE.test(value.acceptance.receiptSha256)
      && typeof value.acceptance.publicReceiptSha256 === "string" && FINGERPRINT_RE.test(value.acceptance.publicReceiptSha256)
      && typeof value.acceptance.receiptCommitSha === "string" && SHA_RE.test(value.acceptance.receiptCommitSha)
      && value.acceptance.publicReleaseSha === receipt.releaseSha,
    "invalid_acceptance_identity",
  );
  failUnless(
    value.acceptance.receiptSha256 !== value.acceptance.publicReceiptSha256
      && value.acceptance.receiptCommitSha !== receipt.releaseSha,
    "acceptance_identity_not_separate",
  );

  return Object.freeze({
    ok: true,
    version: "0.2.0",
    releaseSha: receipt.releaseSha,
    acceptanceCommitSha: value.acceptance.receiptCommitSha,
    managedPathCount: MANAGED_PATHS.length,
  });
}

exports.HeadAcceptanceError = HeadAcceptanceError;
exports.validateHeadAcceptance = validateHeadAcceptance;
