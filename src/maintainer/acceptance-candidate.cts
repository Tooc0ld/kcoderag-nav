#!/usr/bin/env node
/** Local immutable candidate preparation without remote, tag, publish, or LIVE authority. */

import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const releaseReadiness = require("./release-readiness.cjs") as typeof import("./release-readiness.cjs");

export const CANDIDATE_GATE_NAMES = Object.freeze([
  "build",
  "test",
  "generated",
  "pack",
  "smoke",
  "workflow",
  "candidate-tests",
] as const);
export type CandidateGateName = (typeof CANDIDATE_GATE_NAMES)[number];

const PRODUCT_PATHS = Object.freeze([
  "src",
  "tests",
  ".github/workflows/acceptance.yml",
  ".github/actions/readiness-upload",
  "package.json",
  "package-lock.json",
  "plugin-src",
  "kcoderag-qa",
  "kcoderag-cursor",
] as const);
const CANDIDATE_KEYS = Object.freeze([
  "schemaVersion",
  "candidateSha",
  "candidateTreeSha",
  "packageVersion",
  "packageSha256",
  "packageMemberDigest",
  "workflowBlobSha",
  "packageContractDigest",
  "preparedAt",
] as const);
const OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;

export class AcceptanceCandidateError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AcceptanceCandidateError";
    this.code = code;
  }
}

export interface AcceptanceCandidate {
  readonly schemaVersion: 1;
  readonly candidateSha: string;
  readonly candidateTreeSha: string;
  readonly packageVersion: string;
  readonly packageSha256: string;
  readonly packageMemberDigest: string;
  readonly workflowBlobSha: string;
  readonly packageContractDigest: string;
  readonly preparedAt: string;
}

export interface CandidatePackageSnapshot {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly memberCount: number;
}

export interface AcceptanceCandidateDependencies {
  readonly runGit?: (root: string, args: readonly string[]) => string;
  readonly runGate?: (root: string, gate: CandidateGateName) => boolean;
  readonly packCandidate?: (root: string, candidateSha: string) => CandidatePackageSnapshot;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...CANDIDATE_KEYS].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIsoTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function parseAcceptanceCandidate(value: unknown): AcceptanceCandidate {
  if (!isRecord(value) || !exactKeys(value)
    || value.schemaVersion !== 1
    || typeof value.candidateSha !== "string" || !OBJECT_ID_RE.test(value.candidateSha)
    || typeof value.candidateTreeSha !== "string" || !OBJECT_ID_RE.test(value.candidateTreeSha)
    || typeof value.packageVersion !== "string" || !SEMVER_RE.test(value.packageVersion)
    || typeof value.packageSha256 !== "string" || !SHA256_RE.test(value.packageSha256)
    || typeof value.packageMemberDigest !== "string" || !SHA256_RE.test(value.packageMemberDigest)
    || typeof value.workflowBlobSha !== "string" || !OBJECT_ID_RE.test(value.workflowBlobSha)
    || typeof value.packageContractDigest !== "string" || !SHA256_RE.test(value.packageContractDigest)
    || typeof value.preparedAt !== "string" || !isIsoTimestamp(value.preparedAt)) {
    throw new AcceptanceCandidateError("candidate_invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    candidateSha: value.candidateSha,
    candidateTreeSha: value.candidateTreeSha,
    packageVersion: value.packageVersion,
    packageSha256: value.packageSha256,
    packageMemberDigest: value.packageMemberDigest,
    workflowBlobSha: value.workflowBlobSha,
    packageContractDigest: value.packageContractDigest,
    preparedAt: value.preparedAt,
  });
}

function defaultRunGit(root: string, args: readonly string[]): string {
  try {
    return childProcess.execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
    }).trim();
  } catch {
    throw new AcceptanceCandidateError("git_identity_failed");
  }
}

const GATE_COMMANDS = Object.freeze({
  build: ["npm", ["run", "build"]],
  test: ["npm", ["test"]],
  generated: ["npm", ["run", "check:generated"]],
  pack: ["npm", ["run", "check:pack"]],
  smoke: ["npm", ["run", "smoke:required"]],
  workflow: ["npm", ["run", "check:acceptance-workflow"]],
  "candidate-tests": ["node", ["--test", "dist-tests/maintainer/acceptance-candidate.test.cjs"]],
} as const satisfies Readonly<Record<CandidateGateName, readonly [string, readonly string[]]>>);

function gateInvocation(gate: CandidateGateName): readonly [string, readonly string[]] {
  const command = GATE_COMMANDS[gate];
  if (process.platform !== "win32" || command[0] !== "npm") return command;
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const metadata = fs.lstatSync(npmCli);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new AcceptanceCandidateError("npm_runtime_invalid");
  return Object.freeze([process.execPath, Object.freeze([npmCli, ...command[1]])]);
}

/** Execute one fixed candidate gate without a command shell or caller-controlled arguments. */
export function runCandidateGate(root: string, gate: CandidateGateName): boolean {
  try {
    const [executable, args] = gateInvocation(gate);
    const result = childProcess.spawnSync(executable, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      timeout: gate === "test" || gate === "smoke" ? 20 * 60 * 1000 : 5 * 60 * 1000,
    });
    return result.error === undefined && result.signal === null && result.status === 0;
  } catch {
    return false;
  }
}

function safeTrackedPath(relativePath: string): boolean {
  return relativePath.length > 0
    && relativePath.length <= 4_096
    && !relativePath.includes("\0")
    && !path.isAbsolute(relativePath)
    && relativePath.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function gitFile(root: string, candidateSha: string, relativePath: string): Buffer {
  try {
    return childProcess.execFileSync("git", ["-C", root, "show", `${candidateSha}:${relativePath}`], {
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
    });
  } catch {
    throw new AcceptanceCandidateError("git_identity_failed");
  }
}

function copyDirectory(sourceRoot: string, destinationRoot: string): void {
  const metadata = fs.lstatSync(sourceRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new AcceptanceCandidateError("build_output_invalid");
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (entry.isDirectory()) copyDirectory(source, destination);
    else if (entry.isFile() && !entry.isSymbolicLink()) fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    else throw new AcceptanceCandidateError("build_output_invalid");
  }
}

/** Pack an exact committed tree plus build outputs generated after the clean-source gate. */
function defaultPackCandidate(root: string, candidateSha: string): CandidatePackageSnapshot {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-acceptance-candidate-"));
  try {
    const listed = childProcess.execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", "-z", candidateSha], {
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
    });
    const tracked = listed.toString("utf8").split("\0").filter((item) => item.length > 0);
    if (tracked.length === 0 || tracked.some((item) => !safeTrackedPath(item))) {
      throw new AcceptanceCandidateError("git_identity_failed");
    }
    for (const relativePath of tracked) {
      const destination = path.join(stagingRoot, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, gitFile(root, candidateSha, relativePath), { flag: "wx" });
    }
    copyDirectory(path.join(root, "dist"), path.join(stagingRoot, "dist"));
    const lease = releaseReadiness.createCandidatePackageArtifact({
      root: stagingRoot,
      consumers: ["workflow-upload"],
    });
    try {
      return releaseReadiness.withCandidatePackageBytes(lease, "workflow-upload", (bytes, artifact) => Object.freeze({
        bytes: Buffer.from(bytes),
        sha256: artifact.sha256,
        memberCount: artifact.memberCount,
      }));
    } finally {
      try { lease.dispose(); } catch { /* consumer completion may already have disposed the lease */ }
    }
  } catch (error) {
    if (error instanceof AcceptanceCandidateError) throw error;
    throw new AcceptanceCandidateError("candidate_pack_failed");
  } finally {
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch { /* private staging cleanup only */ }
  }
}

function packageContract(root: string, candidateSha: string): { readonly version: string; readonly digest: string } {
  try {
    const parsed: unknown = JSON.parse(gitFile(root, candidateSha, "package.json").toString("utf8"));
    if (!isRecord(parsed) || typeof parsed.version !== "string" || !SEMVER_RE.test(parsed.version)
      || !Array.isArray(parsed.files) || parsed.files.length === 0
      || parsed.files.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new Error("invalid");
    }
    return Object.freeze({ version: parsed.version, digest: sha256(JSON.stringify(parsed.files)) });
  } catch {
    throw new AcceptanceCandidateError("package_contract_invalid");
  }
}

function gateFailure(gate: CandidateGateName): string {
  if (gate === "generated") return "generation_drift";
  if (gate === "pack") return "pack_gate_failed";
  if (gate === "workflow") return "workflow_gate_failed";
  return `${gate.replace("-", "_")}_gate_failed`;
}

export function prepareAcceptanceCandidate(
  options: { readonly root: string; readonly preparedAt: string },
  dependencies: AcceptanceCandidateDependencies = {},
): AcceptanceCandidate {
  const root = path.resolve(options.root);
  if (!isIsoTimestamp(options.preparedAt)) throw new AcceptanceCandidateError("candidate_invalid");
  try {
    const metadata = fs.lstatSync(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("invalid");
  } catch {
    throw new AcceptanceCandidateError("candidate_root_invalid");
  }
  const runGit = dependencies.runGit ?? defaultRunGit;
  const status = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all", "--", ...PRODUCT_PATHS]);
  if (status !== "") throw new AcceptanceCandidateError("product_tree_dirty");
  const runGate = dependencies.runGate ?? runCandidateGate;
  for (const gate of CANDIDATE_GATE_NAMES) {
    if (!runGate(root, gate)) throw new AcceptanceCandidateError(gateFailure(gate));
  }
  const candidateSha = runGit(root, ["rev-parse", "HEAD"]);
  const candidateTreeSha = runGit(root, ["rev-parse", "HEAD^{tree}"]);
  const workflowBlobSha = runGit(root, ["rev-parse", "HEAD:.github/workflows/acceptance.yml"]);
  if (![candidateSha, candidateTreeSha, workflowBlobSha].every((value) => OBJECT_ID_RE.test(value))) {
    throw new AcceptanceCandidateError("git_identity_failed");
  }
  const contract = packageContract(root, candidateSha);
  const snapshot = (dependencies.packCandidate ?? defaultPackCandidate)(root, candidateSha);
  if (!Buffer.isBuffer(snapshot.bytes) || snapshot.bytes.length === 0 || !SHA256_RE.test(snapshot.sha256)
    || sha256(snapshot.bytes) !== snapshot.sha256 || !Number.isSafeInteger(snapshot.memberCount)
    || snapshot.memberCount <= 0 || snapshot.memberCount > 10_000) {
    throw new AcceptanceCandidateError("package_hash_mismatch");
  }
  return parseAcceptanceCandidate({
    schemaVersion: 1,
    candidateSha,
    candidateTreeSha,
    packageVersion: contract.version,
    packageSha256: snapshot.sha256,
    packageMemberDigest: sha256(`${snapshot.sha256}:${snapshot.memberCount}`),
    workflowBlobSha,
    packageContractDigest: contract.digest,
    preparedAt: options.preparedAt,
  });
}

export function writeAcceptanceCandidate(outputPath: string, candidate: AcceptanceCandidate): void {
  const value = parseAcceptanceCandidate(candidate);
  const resolved = path.resolve(outputPath);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(temporary, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, resolved);
  } catch {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best-effort private temporary cleanup */ }
    throw new AcceptanceCandidateError("candidate_write_failed");
  }
}

export function verifyRemoteCandidate(candidate: AcceptanceCandidate, remoteSha: string): boolean {
  try {
    return parseAcceptanceCandidate(candidate).candidateSha === remoteSha && OBJECT_ID_RE.test(remoteSha);
  } catch {
    return false;
  }
}

function parseSealArguments(argv: readonly string[]): { readonly root: string; readonly output: string } {
  let root = ".";
  let output: string | undefined;
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === undefined || value === undefined) throw new AcceptanceCandidateError("arguments_invalid");
    if (name === "--root") root = value;
    else if (name === "--output" && output === undefined) output = value;
    else throw new AcceptanceCandidateError("arguments_invalid");
  }
  if (output === undefined) throw new AcceptanceCandidateError("arguments_invalid");
  return { root, output };
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    if (argv[0] !== "seal") throw new AcceptanceCandidateError("arguments_invalid");
    const options = parseSealArguments(argv.slice(1));
    const candidate = prepareAcceptanceCandidate({
      root: options.root,
      preparedAt: new Date().toISOString(),
    });
    writeAcceptanceCandidate(options.output, candidate);
    process.stdout.write(`${JSON.stringify({ ok: true, candidateSha: candidate.candidateSha })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof AcceptanceCandidateError ? error.code : "candidate_seal_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

exports.CANDIDATE_GATE_NAMES = CANDIDATE_GATE_NAMES;
exports.AcceptanceCandidateError = AcceptanceCandidateError;
exports.parseAcceptanceCandidate = parseAcceptanceCandidate;
exports.prepareAcceptanceCandidate = prepareAcceptanceCandidate;
exports.runCandidateGate = runCandidateGate;
exports.writeAcceptanceCandidate = writeAcceptanceCandidate;
exports.verifyRemoteCandidate = verifyRemoteCandidate;
exports.main = main;

if (require.main === module) process.exitCode = main();
