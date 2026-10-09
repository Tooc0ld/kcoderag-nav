#!/usr/bin/env node
/** Publication success and public registry availability are separate, bounded states. */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { verifyPackage, type ExactPackageManifest } from "./exact-package.cjs";
import { resolveSmokeNpmCli, runProcessAsync, safeEnvironment } from "../smoke/host-smoke.cjs";

const REGISTRY = "https://registry.npmjs.org";
type ProbeStatus = "READY" | "PENDING";
export class RegistryError extends Error {
  constructor(readonly code: string) { super(code); }
}
export interface RegistryReceipt {
  readonly status: "AVAILABLE" | "PUBLISHED_PENDING_REGISTRY" | "FAILED";
  readonly version: string;
  readonly packageSha256: string;
  readonly provenance: "exact_tarball_sha256_and_sha512";
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly code: string;
}
export interface RegistryDependencies {
  readonly probe: (manifest: ExactPackageManifest, timeoutMs: number) => Promise<ProbeStatus>;
  readonly now: () => number;
  readonly sleep: (delayMs: number) => Promise<void>;
}
/** Convert bounded npm diagnostics to stable codes without retaining raw output. */
export function classifyNpmFailure(stderr: string): string | undefined {
  const bounded = stderr.slice(0, 64 * 1024);
  if (/\bE(?:401|403)\b/u.test(bounded)) return "registry_authorization_failed";
  if (/\bEINTEGRITY\b/u.test(bounded)) return "registry_integrity_mismatch";
  return undefined;
}
function hash(bytes: Buffer, algorithm: "sha256" | "sha512"): string {
  return createHash(algorithm).update(bytes).digest(algorithm === "sha256" ? "hex" : "base64");
}
async function fetchBytes(url: string, maxBytes: number, timeoutMs: number): Promise<Buffer | undefined> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs),
    headers: { "Cache-Control": "no-cache", Accept: "application/json" } });
  if (response.status === 401 || response.status === 403) throw new RegistryError("registry_authorization_failed");
  if (response.status === 404 || response.status === 408 || response.status === 429 || response.status >= 500) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.ok) throw new RegistryError("registry_response_invalid");
  const reader = response.body?.getReader();
  if (!reader) throw new RegistryError("registry_response_invalid");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new RegistryError("registry_response_oversized");
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); }
}
function json(bytes: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value as Record<string, unknown>;
  } catch { throw new RegistryError("registry_metadata_invalid"); }
}
/** No publish/dist-tag operations; every attempt uses a new private npm cache. */
export async function probeRegistry(manifest: ExactPackageManifest, timeoutMs: number): Promise<ProbeStatus> {
  const started = Date.now();
  const remaining = (): number => Math.max(1, timeoutMs - (Date.now() - started));
  const exactBytes = await fetchBytes(`${REGISTRY}/kcoderag-nav/${manifest.version}`, 1024 * 1024, Math.min(20_000, remaining()));
  if (!exactBytes) return "PENDING";
  const exact = json(exactBytes);
  if (exact.name !== manifest.name || exact.version !== manifest.version || !exact.dist || typeof exact.dist !== "object") {
    throw new RegistryError("registry_identity_mismatch");
  }
  if (exact.gitHead !== undefined && exact.gitHead !== manifest.candidateSha) {
    throw new RegistryError("registry_candidate_mismatch");
  }
  const dist = exact.dist as Record<string, unknown>;
  const tarballUrl = `${REGISTRY}/kcoderag-nav/-/kcoderag-nav-${manifest.version}.tgz`;
  if (dist.integrity !== manifest.integrity || dist.tarball !== tarballUrl) {
    throw new RegistryError("registry_integrity_mismatch");
  }
  const latestBytes = await fetchBytes(`${REGISTRY}/kcoderag-nav/latest`, 1024 * 1024, Math.min(20_000, remaining()));
  if (!latestBytes || json(latestBytes).version !== manifest.version) return "PENDING";
  const bytes = await fetchBytes(tarballUrl, 64 * 1024 * 1024, Math.min(20_000, remaining()));
  if (!bytes) return "PENDING";
  if (hash(bytes, "sha256") !== manifest.sha256 || `sha512-${hash(bytes, "sha512")}` !== manifest.integrity) {
    throw new RegistryError("registry_integrity_mismatch");
  }
  if (remaining() <= 1) return "PENDING";
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-registry-readiness-"));
  try {
    const environment = safeEnvironment(temporary);
    const npmCli = resolveSmokeNpmCli();
    if (process.platform === "win32" && !npmCli) throw new RegistryError("npm_runtime_unavailable");
    const result = await runProcessAsync(npmCli ? process.execPath : "npm", [...(npmCli ? [npmCli] : []), "pack",
      `kcoderag-nav@${manifest.version}`, "--ignore-scripts", "--json", "--prefer-online",
      "--fetch-retries=0", "--fetch-timeout=15000", `--registry=${REGISTRY}/`,
      "--pack-destination", temporary], { cwd: temporary, env: environment, timeout: Math.min(35_000, remaining()) });
    if (result.code !== 0) {
      const terminal = classifyNpmFailure(result.stderr);
      if (terminal) throw new RegistryError(terminal);
      return "PENDING";
    }
    const tgz = path.join(temporary, `kcoderag-nav-${manifest.version}.tgz`);
    const stat = fs.lstatSync(tgz);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes.length
      || hash(fs.readFileSync(tgz), "sha256") !== manifest.sha256) throw new RegistryError("npm_artifact_mismatch");
    return "READY";
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
export async function waitForRegistry(
  manifest: ExactPackageManifest,
  dependencies: RegistryDependencies = { probe: probeRegistry, now: Date.now,
    sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)) },
  maxWaitMs = 10 * 60_000,
): Promise<RegistryReceipt> {
  if (!Number.isInteger(maxWaitMs) || maxWaitMs <= 0 || maxWaitMs > 10 * 60_000) throw new RegistryError("deadline_invalid");
  const started = dependencies.now();
  let attempts = 0;
  let code = "registry_not_ready";
  const finish = (status: RegistryReceipt["status"]): RegistryReceipt => ({
    status, version: manifest.version, packageSha256: manifest.sha256,
    provenance: "exact_tarball_sha256_and_sha512",
    attempts, elapsedMs: Math.max(0, dependencies.now() - started), code,
  });
  while (attempts < 16 && dependencies.now() - started < maxWaitMs) {
    attempts += 1;
    try {
      const status = await dependencies.probe(manifest, Math.min(90_000, maxWaitMs - (dependencies.now() - started)));
      if (status === "READY") { code = "registry_verified"; return finish("AVAILABLE"); }
    } catch (error) {
      if (error instanceof RegistryError) { code = error.code; return finish("FAILED"); }
      code = "registry_temporarily_unreachable";
    }
    const remaining = maxWaitMs - (dependencies.now() - started);
    if (remaining <= 0 || attempts >= 16) break;
    await dependencies.sleep(Math.min(5_000 * 2 ** Math.min(attempts - 1, 4), 60_000, remaining));
  }
  return finish("PUBLISHED_PENDING_REGISTRY");
}
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [root, candidateSha, manifestSha, output] = argv;
  try {
    if (argv.length !== 4 || !root || !candidateSha || !manifestSha || !output) throw new RegistryError("arguments_invalid");
    const { manifest } = verifyPackage(root, candidateSha, manifestSha);
    const result = await waitForRegistry(manifest);
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "AVAILABLE" ? 0 : 1;
  } catch (error) {
    const result = { status: "FAILED", code: error instanceof RegistryError ? error.code : "registry_verification_failed" };
    if (output) fs.writeFileSync(output, `${JSON.stringify(result)}\n`);
    process.stderr.write(`${JSON.stringify(result)}\n`);
    return 1;
  }
}
if (require.main === module) void main().then((code) => { process.exitCode = code; });
