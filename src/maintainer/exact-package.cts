#!/usr/bin/env node
/** One audited tarball travels unchanged through packaged tests and publication. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createCandidatePackageArtifact, scanCandidatePackageArtifact, withCandidatePackageBytes } from "./release-readiness.cjs";
import { auditPackArtifact } from "./pack-audit.cjs";
import { readTarArchive, DEFAULT_TAR_ARCHIVE_LIMITS } from "./tar-archive.cjs";
import { openDownloadedLease } from "./readiness-workflow.cjs";
import { runHostSmoke } from "../smoke/host-smoke.cjs";

const SHA = /^[0-9a-f]{40}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
export interface ExactPackageManifest {
  readonly schemaVersion: 1;
  readonly name: "kcoderag-nav";
  readonly version: string;
  readonly candidateSha: string;
  readonly sha256: string;
  readonly integrity: string;
  readonly memberCount: number;
  readonly memberDigest: string;
}
export class ExactPackageError extends Error {
  constructor(readonly code: string) { super(code); }
}
function requireFact(value: unknown, code: string): asserts value {
  if (!value) throw new ExactPackageError(code);
}
export function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function regularBytes(file: string, maxBytes: number): Buffer {
  const stat = fs.lstatSync(file);
  requireFact(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maxBytes, "artifact_file_invalid");
  const bytes = fs.readFileSync(file);
  requireFact(bytes.length === stat.size, "artifact_file_changed");
  return bytes;
}
export function describePackage(bytes: Buffer, candidateSha: string): ExactPackageManifest {
  requireFact(SHA.test(candidateSha), "candidate_invalid");
  const entries = readTarArchive(bytes);
  const manifests = entries.filter((entry) => entry.path === "package.json" && entry.type === "file");
  requireFact(manifests.length === 1, "package_identity_invalid");
  const value = JSON.parse(manifests[0]!.body.toString("utf8")) as { name?: unknown; version?: unknown };
  requireFact(value.name === "kcoderag-nav" && typeof value.version === "string" && VERSION.test(value.version), "package_identity_invalid");
  const members = entries.map((entry) => [entry.path, entry.type, entry.body.length, digest(entry.body)])
    .sort((left, right) => String(left[0]) < String(right[0]) ? -1 : String(left[0]) > String(right[0]) ? 1 : 0);
  return Object.freeze({
    schemaVersion: 1, name: "kcoderag-nav", version: value.version, candidateSha,
    sha256: digest(bytes), integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    memberCount: entries.length, memberDigest: digest(JSON.stringify(members)),
  });
}
export function verifyPackage(root: string, candidateSha: string, manifestSha: string): {
  readonly manifest: ExactPackageManifest; readonly tarballPath: string;
} {
  requireFact(SHA.test(candidateSha) && HASH.test(manifestSha), "expected_identity_invalid");
  const rootStat = fs.lstatSync(root);
  requireFact(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "artifact_root_invalid");
  const names = fs.readdirSync(root).sort();
  requireFact(names.join(",") === "manifest.json,package", "artifact_inventory_invalid");
  const packageRoot = path.join(root, "package");
  const directory = fs.lstatSync(packageRoot);
  requireFact(directory.isDirectory() && !directory.isSymbolicLink()
    && fs.readdirSync(packageRoot).join(",") === "candidate.tgz", "artifact_inventory_invalid");
  const manifestBytes = regularBytes(path.join(root, "manifest.json"), 16 * 1024);
  requireFact(digest(manifestBytes) === manifestSha, "manifest_hash_mismatch");
  const manifest: unknown = JSON.parse(manifestBytes.toString("utf8"));
  const tarballPath = path.join(packageRoot, "candidate.tgz");
  const expected = describePackage(regularBytes(tarballPath, DEFAULT_TAR_ARCHIVE_LIMITS.maxArchiveBytes), candidateSha);
  requireFact(manifest !== null && typeof manifest === "object" && !Array.isArray(manifest), "manifest_invalid");
  const actual = manifest as Record<string, unknown>;
  requireFact(Object.keys(actual).sort().join(",") === Object.keys(expected).sort().join(",")
    && Object.entries(expected).every(([key, value]) => actual[key] === value), "package_manifest_mismatch");
  return Object.freeze({ manifest: expected, tarballPath });
}
/** The recorded candidate must describe source bytes, not merely the current branch label. */
export function assertCandidateCheckout(root: string, candidateSha: string): void {
  requireFact(SHA.test(candidateSha), "candidate_invalid");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  requireFact(head === candidateSha, "candidate_mismatch");
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"],
    { cwd: root, encoding: "utf8" });
  requireFact(status.length === 0, "candidate_checkout_dirty");
}
export function producePackage(root: string, output: string, candidateSha: string): {
  readonly manifest: ExactPackageManifest; readonly manifestSha: string;
} {
  assertCandidateCheckout(root, candidateSha);
  fs.mkdirSync(output, { recursive: false });
  fs.mkdirSync(path.join(output, "package"));
  const lease = createCandidatePackageArtifact({ root, consumers: ["pack-audit", "tar-scan", "workflow-upload"] });
  try {
    auditPackArtifact(lease, { root });
    scanCandidatePackageArtifact(lease);
    return withCandidatePackageBytes(lease, "workflow-upload", (bytes) => {
      const manifest = describePackage(bytes, candidateSha);
      const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
      fs.writeFileSync(path.join(output, "package", "candidate.tgz"), bytes, { flag: "wx" });
      fs.writeFileSync(path.join(output, "manifest.json"), manifestBytes, { flag: "wx" });
      return { manifest, manifestSha: digest(manifestBytes) };
    });
  } finally { lease.dispose(); }
}
export async function smokePackage(root: string, candidateSha: string, manifestSha: string, receipt: string): Promise<boolean> {
  const checked = verifyPackage(root, candidateSha, manifestSha);
  const manifest = checked.manifest;
  const runnerTempInput = process.env.RUNNER_TEMP;
  requireFact(runnerTempInput !== undefined && path.isAbsolute(runnerTempInput), "smoke_environment_invalid");
  const runnerTemp = fs.realpathSync(runnerTempInput);
  requireFact(fs.statSync(runnerTemp).isDirectory(), "smoke_environment_invalid");
  // Downloaded leases own and remove their directory; the producer archive belongs to the caller.
  const temporary = fs.mkdtempSync(path.join(runnerTemp, "kcoderag-exact-smoke-"));
  let lease: ReturnType<typeof openDownloadedLease> | undefined;
  try {
    fs.copyFileSync(checked.tarballPath, path.join(temporary, "candidate.tgz"), fs.constants.COPYFILE_EXCL);
    // Reopen the copy with the original hash so a changed source cannot enter the smoke lease.
    lease = openDownloadedLease({
      laneId: "windows-node22", artifactRoot: temporary,
      artifactName: `kcoderag-nav-${manifest.version}.tgz`, artifactSha256: manifest.sha256,
      memberCount: manifest.memberCount,
    });
    const result = await runHostSmoke({ mode: "required-contract", artifactLease: lease });
    const passed = result.status === "PASS" && result.hosts.length === 5
      && result.hosts.every((host) => host.status === "PASS" && host.evidenceLevel === "PACKAGED")
      && result.provenance?.lifecycleTarballSha256 === manifest.sha256
      && result.provenance.artifactMemberCount === manifest.memberCount;
    fs.writeFileSync(receipt, `${JSON.stringify({ status: passed ? "PASS" : "FAIL", candidateSha,
      manifestSha, artifactSha256: manifest.sha256, evidenceLevel: "PACKAGED",
      nativeHostExecution: false, result }, null, 2)}\n`);
    return passed;
  } finally {
    try { lease?.dispose(); }
    finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
}
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [command, root, subject, identity, receipt] = argv;
  try {
    requireFact(root !== undefined && subject !== undefined, "arguments_invalid");
    if (command === "produce" && argv.length === 3) {
      const result = producePackage(process.cwd(), root, subject);
      const output = process.env.GITHUB_OUTPUT;
      if (output) fs.appendFileSync(output, `manifest-sha256=${result.manifestSha}\npackage-sha256=${result.manifest.sha256}\nversion=${result.manifest.version}\n`);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (command === "verify" && argv.length === 4 && identity !== undefined) {
      const result = verifyPackage(root, subject, identity);
      process.stdout.write(`${JSON.stringify(result.manifest)}\n`);
    } else if (command === "smoke" && argv.length === 5 && identity !== undefined && receipt !== undefined) {
      return await smokePackage(root, subject, identity, receipt) ? 0 : 1;
    } else throw new ExactPackageError("arguments_invalid");
    return 0;
  } catch (error) {
    const code = error instanceof ExactPackageError ? error.code : "exact_package_failed";
    const result = { status: "FAIL", code };
    if (command === "smoke" && receipt !== undefined) fs.writeFileSync(receipt, `${JSON.stringify(result)}\n`);
    process.stderr.write(`${JSON.stringify(result)}\n`);
    return 1;
  }
}
if (require.main === module) void main().then((code) => { process.exitCode = code; });
