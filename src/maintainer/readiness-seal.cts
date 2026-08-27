#!/usr/bin/env node
/** Prove a documentation-only final child preserves the exact tested package product. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const brandAudit = require("./brand-audit.cjs") as typeof import("./brand-audit.cjs");
const releaseReadiness = require("./release-readiness.cjs") as typeof import("./release-readiness.cjs");

type JsonMap = Record<string, unknown>;

export interface ReadinessSealOptions {
  readonly root: string;
  readonly candidateSubject: string;
  readonly finalSubject: string;
  readonly receiptPath?: string;
}

export interface ReadinessSealResult {
  readonly schemaVersion: 1;
  readonly ok: true;
  readonly candidateSubject: string;
  readonly candidateTree: string;
  readonly finalSubject: string;
  readonly finalTree: string;
  readonly packageProductTreeDigest: string;
  readonly changedDocumentationCount: number;
  readonly finalScannedCount: number;
  readonly finalFindingCount: 0;
}

const GIT_OID_RE = /^[0-9a-f]{40}$/u;
const DIGEST_RE = /^[0-9a-f]{64}$/u;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 256 * 1024;
const SECRET_KEY_RE = /^(?:authorization|body|command|credential|environment|header|npm_token|node_auth_token|stderr|stdout|token|secret|url)$/iu;

export class ReadinessSealError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReadinessSealError";
    this.code = code;
  }
}

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ReadinessSealError(code);
}

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gitBuffer(root: string, args: readonly string[], code: string): Buffer {
  const result = childProcess.spawnSync("git", [...args], {
    cwd: root,
    encoding: "buffer",
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
  });
  failUnless(result.status === 0 && Buffer.isBuffer(result.stdout), code);
  failUnless(result.stdout.length <= MAX_GIT_OUTPUT_BYTES, code);
  return result.stdout;
}

function gitOid(root: string, args: readonly string[], code: string): string {
  const value = gitBuffer(root, args, code).toString("ascii").trim();
  failUnless(GIT_OID_RE.test(value), code);
  return value;
}

function resolveSubject(root: string, subject: string, code: string): {
  readonly subject: string;
  readonly tree: string;
} {
  failUnless(subject === "HEAD" || GIT_OID_RE.test(subject), code);
  const resolved = gitOid(root, ["rev-parse", "--verify", `${subject}^{commit}`], code);
  if (subject !== "HEAD") failUnless(resolved === subject, code);
  return Object.freeze({
    subject: resolved,
    tree: gitOid(root, ["rev-parse", "--verify", `${resolved}^{tree}`], code),
  });
}

function changedPaths(root: string, candidate: string, finalSubject: string): readonly string[] {
  const raw = gitBuffer(root, ["diff", "--name-only", "-z", candidate, finalSubject, "--"], "seal_git_failed");
  if (raw.length === 0) return Object.freeze([]);
  failUnless(raw[raw.length - 1] === 0, "seal_git_failed");
  const values = raw.subarray(0, raw.length - 1).toString("utf8").split("\0");
  failUnless(values.length <= 1024, "seal_git_failed");
  for (const value of values) {
    failUnless(
      value.length > 0
        && !value.includes("\\")
        && !value.includes("\0")
        && !path.posix.isAbsolute(value)
        && path.posix.normalize(value) === value,
      "seal_git_failed",
    );
  }
  return Object.freeze(values);
}

function assertSafeReceipt(value: unknown): asserts value is JsonMap {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const item = pending.pop();
    visited += 1;
    failUnless(visited <= 1024, "invalid_readiness_receipt");
    if (Array.isArray(item)) {
      failUnless(item.length <= 128, "invalid_readiness_receipt");
      pending.push(...item);
    } else if (isRecord(item)) {
      const entries = Object.entries(item);
      failUnless(entries.length <= 128, "invalid_readiness_receipt");
      for (const [key, child] of entries) {
        failUnless(!SECRET_KEY_RE.test(key), "invalid_readiness_receipt");
        pending.push(child);
      }
    } else {
      failUnless(
        item === null || typeof item === "boolean" || typeof item === "string"
          || (typeof item === "number" && Number.isSafeInteger(item)),
        "invalid_readiness_receipt",
      );
      if (typeof item === "string") failUnless(item.length <= 4096, "invalid_readiness_receipt");
    }
  }
  failUnless(isRecord(value), "invalid_readiness_receipt");
}

function validateReceipt(root: string, receiptPath: string, candidate: string, digest: string): void {
  const resolvedPath = path.resolve(root, receiptPath);
  const relative = path.relative(root, resolvedPath);
  failUnless(relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative), "invalid_readiness_receipt");
  let stat: import("node:fs").Stats;
  try {
    stat = fs.lstatSync(resolvedPath);
  } catch {
    throw new ReadinessSealError("invalid_readiness_receipt");
  }
  failUnless(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_RECEIPT_BYTES,
    "invalid_readiness_receipt");
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch {
    throw new ReadinessSealError("invalid_readiness_receipt");
  }
  assertSafeReceipt(value);
  failUnless(
    value.schemaVersion === 1
      && value.candidateSubject === candidate
      && typeof value.packageProductTreeDigest === "string"
      && DIGEST_RE.test(value.packageProductTreeDigest)
      && value.packageProductTreeDigest === digest,
    "readiness_receipt_mismatch",
  );
}

/** Compare immutable Git subjects; only non-package planning evidence may differ. */
export function runReadinessSeal(options: ReadinessSealOptions): ReadinessSealResult {
  failUnless(isRecord(options), "invalid_seal_options");
  failUnless(typeof options.root === "string" && options.root.length > 0, "invalid_seal_options");
  const root = fs.realpathSync(path.resolve(options.root));
  const candidate = resolveSubject(root, options.candidateSubject, "invalid_candidate_subject");
  const finalSubject = resolveSubject(root, options.finalSubject, "invalid_final_subject");
  const candidateProduct = releaseReadiness.readPackageProductSnapshot(root, candidate.subject);
  const finalProduct = releaseReadiness.readPackageProductSnapshot(root, finalSubject.subject);
  failUnless(
    candidateProduct.digest === finalProduct.digest
      && candidateProduct.paths.length === finalProduct.paths.length
      && candidateProduct.paths.every((relativePath, index) => relativePath === finalProduct.paths[index])
      && candidateProduct.paths.every((relativePath) =>
        candidateProduct.oids[relativePath] === finalProduct.oids[relativePath]),
    "candidate_product_drift",
  );
  const changed = changedPaths(root, candidate.subject, finalSubject.subject);
  const packagePaths = new Set(candidateProduct.paths);
  failUnless(changed.every((relativePath) => !packagePaths.has(relativePath) && relativePath.startsWith(".planning/")),
    "final_child_scope_invalid");
  let audit: ReturnType<typeof brandAudit.scanGitTree>;
  try {
    audit = brandAudit.scanGitTree({ root, subject: finalSubject.subject });
  } catch (error) {
    if (error instanceof brandAudit.BrandAuditError) throw new ReadinessSealError(error.code);
    throw error;
  }
  failUnless(audit.findingCount === 0, "final_brand_audit_failed");
  if (options.receiptPath !== undefined) {
    failUnless(typeof options.receiptPath === "string" && options.receiptPath.length > 0, "invalid_readiness_receipt");
    validateReceipt(root, options.receiptPath, candidate.subject, candidateProduct.digest);
  }
  return Object.freeze({
    schemaVersion: 1,
    ok: true,
    candidateSubject: candidate.subject,
    candidateTree: candidate.tree,
    finalSubject: finalSubject.subject,
    finalTree: finalSubject.tree,
    packageProductTreeDigest: candidateProduct.digest,
    changedDocumentationCount: changed.length,
    finalScannedCount: audit.scannedCount,
    finalFindingCount: 0,
  });
}

function parseArguments(argv: readonly string[]): {
  readonly candidateSubject: string;
  readonly finalSubject: string;
  readonly receiptPath: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    failUnless(flag !== undefined && value !== undefined && !values.has(flag), "invalid_arguments");
    failUnless(flag === "--candidate" || flag === "--final" || flag === "--receipt", "invalid_arguments");
    values.set(flag, value);
  }
  const candidateSubject = values.get("--candidate");
  const finalSubject = values.get("--final");
  const receiptPath = values.get("--receipt");
  failUnless(candidateSubject !== undefined && finalSubject !== undefined && receiptPath !== undefined
    && values.size === 3, "invalid_arguments");
  return { candidateSubject, finalSubject, receiptPath };
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const parsed = parseArguments(argv);
    const result = runReadinessSeal({ root: process.cwd(), ...parsed });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof ReadinessSealError ? error.code : "readiness_seal_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
