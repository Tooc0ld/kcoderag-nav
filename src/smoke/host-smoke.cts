/** Honest three-state, four-host smoke runner with package acquisition and loopback receipts. */

const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");

import type { HostId } from "../core/contracts.cjs";
import { parseJsoncObject } from "../core/json-splice.cjs";
import {
  readReceipts,
  startStubMcpServer,
  SYNTHETIC_TOOL,
  type StubReceipt,
} from "./stub-mcp-server.cjs";

export type SmokeMode = "required-contract" | "optional-live";
export type SmokeStatus = "PASS" | "FAIL" | "NOT_RUN";

export interface SmokeEvidence {
  readonly packageAcquired: boolean;
  readonly preinstall: boolean;
  readonly install: boolean;
  readonly qaOnly: boolean;
  readonly status: boolean;
  readonly doctor: boolean;
  readonly toolRegistration: boolean;
  readonly navigation: boolean;
  readonly mcpInitialize: boolean;
  readonly mcpList: boolean;
  readonly mcpCall: boolean;
  readonly update: boolean;
  readonly sourceConflict: boolean;
  readonly conflictInstallBlocked: boolean;
  readonly conflictUpdateBlocked: boolean;
  readonly conflictUninstallAllowed: boolean;
  readonly uninstall: boolean;
  readonly stubReceipt: boolean;
}

export interface NavigationContract {
  readonly kind: "pretooluse_hook" | "rule_skill_mcp" | "plugin_skill_mcp";
  readonly root: boolean;
  readonly deep: boolean;
  readonly sameProject: boolean;
  readonly fingerprint: string;
}

export interface HostSmokeResult {
  readonly schemaVersion: 1;
  readonly host: HostId;
  readonly mode: SmokeMode;
  readonly status: SmokeStatus;
  readonly reason: string;
  readonly evidence: SmokeEvidence;
  readonly navigationContract?: NavigationContract;
  readonly provenance?: PackageProvenance;
}

export interface PackageProvenance {
  readonly requestedPackageSpec: string;
  readonly expectedVersion: string;
  readonly resolvedPackageName: "kcoderag-nav";
  readonly resolvedVersion: string;
  readonly lifecycleTarballSha256: string;
  readonly publicRegistryArtifact?: PublicRegistryArtifact;
}

export interface PublicRegistryArtifact {
  readonly registry: "https://registry.npmjs.org/";
  readonly resolvedTarballUrl: string;
  readonly distIntegrity: string;
  readonly artifactSha256: string;
  readonly artifactSha512: string;
}

export interface SmokeRunResult {
  readonly schemaVersion: 1;
  readonly mode: SmokeMode;
  readonly status: SmokeStatus;
  readonly provenance?: PackageProvenance;
  readonly hosts: readonly HostSmokeResult[];
}

export interface RunHostSmokeOptions {
  readonly mode: SmokeMode;
  readonly packageSpec?: string;
  readonly expectedVersion?: string;
  readonly temporaryRoot?: string;
  readonly repositoryRoot?: string;
  readonly hosts?: readonly HostId[];
}

interface AcquiredPackage extends PackageProvenance {
  readonly lifecyclePackageSpec: string;
}

interface NormalizedPackageRequest {
  readonly sourceSpec: string;
  readonly requestedPackageSpec: string;
  readonly expectedVersion?: string;
  readonly publicRegistry: boolean;
}

interface ValidatedAcquisition {
  readonly lifecycleArtifact: VerifiedTarballArtifact;
  readonly provenance: PackageProvenance;
}

interface VerifiedTarballArtifact {
  readonly originalPath: string;
  readonly originalRealPath: string;
  readonly bytes: Buffer;
  readonly sha256: string;
  compromised: boolean;
}

interface RunHostSmokeDependencies {
  readonly acquirePackage?: (
    packageSpec: string,
    temporaryRoot: string,
    stubUrl: string,
    repositoryRoot: string,
    expectedVersion?: string,
  ) => Promise<AcquiredPackage>;
  readonly runNpm?: NpmRunner;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

type NpmRunner = (args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) => CommandResult;

interface McpConnection {
  readonly serverName: string;
  readonly url: string;
}

const HOSTS: readonly HostId[] = Object.freeze(["codex", "claude", "cursor", "opencode"] as const);
export const EVIDENCE_KEYS: readonly (keyof SmokeEvidence)[] = Object.freeze([
  "packageAcquired",
  "preinstall",
  "install",
  "qaOnly",
  "status",
  "doctor",
  "toolRegistration",
  "navigation",
  "mcpInitialize",
  "mcpList",
  "mcpCall",
  "update",
  "sourceConflict",
  "conflictInstallBlocked",
  "conflictUpdateBlocked",
  "conflictUninstallAllowed",
  "uninstall",
  "stubReceipt",
]);
const OPTIONAL_LIVE_EVIDENCE_KEYS: readonly (keyof SmokeEvidence)[] = Object.freeze([
  "packageAcquired",
  "install",
  "qaOnly",
  "status",
  "toolRegistration",
  "navigation",
  "mcpInitialize",
  "mcpList",
  "mcpCall",
  "update",
  "uninstall",
  "stubReceipt",
]);
const EXACT_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const PUBLIC_EXACT_SPEC = /^kcoderag-nav@(.+)$/u;
const PUBLIC_LATEST_SPEC = "kcoderag-nav@latest";
const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const MAX_VERSION_LENGTH = 64;
const PACKAGE_NAME = "kcoderag-nav";
const SYNTHETIC_AUTHORIZATION = "Bearer synthetic-contract-only";
const COMMAND_TIMEOUT_MS = 120_000;
const LIVE_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blankEvidence(): SmokeEvidence {
  return Object.freeze(Object.fromEntries(EVIDENCE_KEYS.map((key) => [key, false])) as unknown as SmokeEvidence);
}

export function completeEvidence(overrides: Partial<SmokeEvidence> = {}): SmokeEvidence {
  return Object.freeze({
    ...Object.fromEntries(EVIDENCE_KEYS.map((key) => [key, true])),
    ...overrides,
  } as unknown as SmokeEvidence);
}

function normalizeEvidence(value: Partial<SmokeEvidence> | undefined): SmokeEvidence {
  const evidence = { ...blankEvidence() } as Record<keyof SmokeEvidence, boolean>;
  if (value !== undefined) {
    for (const key of EVIDENCE_KEYS) evidence[key] = value[key] === true;
  }
  return Object.freeze(evidence) as SmokeEvidence;
}

export function evaluateHostEvidence(input: {
  readonly host: HostId;
  readonly mode: SmokeMode;
  readonly evidence?: Partial<SmokeEvidence>;
  readonly unavailableReason?: string;
  readonly failureReason?: string;
  readonly navigationContract?: NavigationContract;
  readonly provenance?: PackageProvenance;
}): HostSmokeResult {
  const evidence = normalizeEvidence(input.evidence);
  const provenance = input.provenance === undefined ? {} : { provenance: input.provenance };
  const navigation = input.navigationContract === undefined ? {} : { navigationContract: input.navigationContract };
  if (input.unavailableReason !== undefined) {
    return Object.freeze({
      schemaVersion: 1,
      host: input.host,
      mode: input.mode,
      status: "NOT_RUN",
      reason: input.unavailableReason,
      evidence,
      ...navigation,
      ...provenance,
    });
  }
  const requiredKeys = input.mode === "required-contract" ? EVIDENCE_KEYS : OPTIONAL_LIVE_EVIDENCE_KEYS;
  const complete = requiredKeys.every((key) => evidence[key]);
  return Object.freeze({
    schemaVersion: 1,
    host: input.host,
    mode: input.mode,
    status: complete ? "PASS" : "FAIL",
    reason: complete ? "verified" : (input.failureReason ?? "evidence_incomplete"),
    evidence,
    ...navigation,
    ...provenance,
  });
}

export function smokeExitCode(result: { readonly mode: SmokeMode; readonly status: SmokeStatus }): number {
  if (result.status === "PASS") return 0;
  if (result.status === "NOT_RUN" && result.mode === "optional-live") return 0;
  return 1;
}

function syntheticNativePreload(root: string): string {
  const preloadPath = path.join(root, "synthetic-native-runner.cjs");
  if (!fs.existsSync(preloadPath)) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(preloadPath, `"use strict";
const childProcess = require("node:child_process");
const originalExecFile = childProcess.execFile;
childProcess.execFile = function(executable, args, options, callback) {
  const argv = Array.isArray(args) ? [...args] : [];
  const done = typeof options === "function" ? options : callback;
  const normalized = String(executable).replace(/\\\\/g, "/").toLowerCase();
  const nodeCodex = normalized === String(process.execPath).replace(/\\\\/g, "/").toLowerCase() &&
    String(argv[0] || "").replace(/\\\\/g, "/").toLowerCase().endsWith("/node_modules/@openai/codex/bin/codex.js");
  const host = executable === "codex" || nodeCodex ? "codex" : executable === "claude" ? "claude" : undefined;
  if (host === undefined || typeof done !== "function") {
    return originalExecFile.apply(this, arguments);
  }
  const command = nodeCodex ? argv.slice(1) : argv;
  let stdout;
  if (command.length === 1 && command[0] === "--version") {
    stdout = host === "codex" ? "codex-cli 0.146.1\\n" : "2.1.241 (Claude Code)\\n";
  } else if (command.includes("--help")) {
    stdout = "--json --scope PLUGIN MARKETPLACE user project local\\n";
  } else if (command.includes("plugin") && command.includes("list") && command.includes("--json")) {
    const marketplace = command.includes("marketplace");
    stdout = host === "codex"
      ? JSON.stringify(marketplace ? { marketplaces: [] } : { installed: [], available: [] })
      : "[]";
  } else {
    return originalExecFile.apply(this, arguments);
  }
  process.nextTick(() => done(null, stdout, ""));
  return undefined;
};
`, { encoding: "utf8", mode: 0o600 });
  }
  return preloadPath;
}

function safeEnvironment(root: string, syntheticNative = false): NodeJS.ProcessEnv {
  const hostHome = path.join(root, "host-home");
  const localAppData = path.join(root, "local-app-data");
  const xdgCacheHome = path.join(root, "xdg-cache");
  const npmCache = path.join(root, "npm-cache");
  const npmUserConfig = path.join(root, "user.npmrc");
  const npmGlobalConfig = path.join(root, "global.npmrc");
  fs.mkdirSync(hostHome, { recursive: true });
  fs.mkdirSync(localAppData, { recursive: true });
  fs.mkdirSync(xdgCacheHome, { recursive: true });
  fs.mkdirSync(npmCache, { recursive: true });
  if (!fs.existsSync(npmUserConfig)) fs.writeFileSync(npmUserConfig, "", "utf8");
  if (!fs.existsSync(npmGlobalConfig)) fs.writeFileSync(npmGlobalConfig, "", "utf8");
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !/^(?:npm_config_.*|node_auth_token|npm_token|node_options)$/iu.test(key)),
  );
  const preload = syntheticNative ? syntheticNativePreload(root) : undefined;
  return {
    ...inheritedEnvironment,
    LOCALAPPDATA: localAppData,
    XDG_CACHE_HOME: xdgCacheHome,
    ...(process.platform === "win32" ? { USERPROFILE: hostHome } : { HOME: hostHome }),
    CODEX_HOME: hostHome,
    CLAUDE_CONFIG_DIR: hostHome,
    ...(preload === undefined ? {} : { NODE_OPTIONS: `--require=${JSON.stringify(preload)}` }),
    KCODERAG_NAV_UPDATE_CHECK: "0",
    NO_COLOR: "1",
    npm_config_audit: "false",
    npm_config_cache: npmCache,
    npm_config_fund: "false",
    npm_config_globalconfig: npmGlobalConfig,
    npm_config_loglevel: "silent",
    npm_config_registry: PUBLIC_REGISTRY,
    npm_config_userconfig: npmUserConfig,
  };
}

function isExactVersion(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_VERSION_LENGTH && EXACT_VERSION.test(value);
}

function runProcess(
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly input?: string;
    readonly timeout?: number;
    readonly commandShim?: boolean;
  },
): CommandResult {
  const useCommandShim = options.commandShim === true && process.platform === "win32";
  const selectedExecutable = useCommandShim ? (process.env.ComSpec ?? "cmd.exe") : executable;
  const selectedArgs = useCommandShim ? ["/d", "/s", "/c", executable, ...args] : [...args];
  const completed = childProcess.spawnSync(selectedExecutable, selectedArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout ?? COMMAND_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    code: completed.status ?? 1,
    stdout: typeof completed.stdout === "string" ? completed.stdout : "",
    stderr: typeof completed.stderr === "string" ? completed.stderr : "",
  };
}

function runNpmProcess(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): CommandResult {
  return runProcess("npm", args, { cwd, env, commandShim: true });
}

function isolatedRegistryArguments(env: NodeJS.ProcessEnv): readonly string[] {
  const userConfig = env.npm_config_userconfig;
  const globalConfig = env.npm_config_globalconfig;
  if (typeof userConfig !== "string" || typeof globalConfig !== "string") {
    throw new Error("package_acquisition_failed");
  }
  return Object.freeze([
    `--registry=${PUBLIC_REGISTRY}`,
    `--userconfig=${userConfig}`,
    `--globalconfig=${globalConfig}`,
  ]);
}

function parsePackFilename(stdout: string, destination: string): string {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (
      Array.isArray(parsed) &&
      isRecord(parsed[0]) &&
      typeof parsed[0].filename === "string" &&
      parsed[0].filename === path.basename(parsed[0].filename) &&
      parsed[0].filename.endsWith(".tgz")
    ) {
      const result = path.resolve(destination, parsed[0].filename);
      const stats = fs.lstatSync(result);
      const realDestination = fs.realpathSync(destination);
      const realResult = fs.realpathSync(result);
      if (stats.isFile() && !stats.isSymbolicLink() && isPathInside(realDestination, realResult)) return realResult;
    }
  } catch {
    // Safe stable error below.
  }
  throw new Error("package_acquisition_failed");
}

function packDirectory(directory: string, destination: string, env: NodeJS.ProcessEnv, runNpm: NpmRunner): string {
  fs.mkdirSync(destination, { recursive: true });
  const packed = runNpm(
    ["pack", directory, "--json", "--ignore-scripts", "--pack-destination", destination],
    destination,
    env,
  );
  if (packed.code !== 0) throw new Error("package_acquisition_failed");
  return parsePackFilename(packed.stdout, destination);
}

function publicTarballUrl(value: string, expectedVersion: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "registry.npmjs.org" && parsed.port === "" &&
      parsed.username === "" && parsed.password === "" && parsed.search === "" && parsed.hash === "" &&
      parsed.pathname === `/kcoderag-nav/-/kcoderag-nav-${expectedVersion}.tgz`;
  } catch {
    return false;
  }
}

function acquirePublicRegistryArtifact(
  sourceSpec: string,
  expectedVersion: string,
  acquisitionRoot: string,
  env: NodeJS.ProcessEnv,
  runNpm: NpmRunner,
): {
  readonly tarballPath: string;
  readonly verifiedArtifact: VerifiedTarballArtifact;
  readonly provenance: PublicRegistryArtifact;
} {
  const isolatedArgs = isolatedRegistryArguments(env);
  const metadataResult = runNpm(["view", sourceSpec, "--json", ...isolatedArgs], acquisitionRoot, env);
  if (metadataResult.code !== 0) throw new Error("package_acquisition_failed");
  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataResult.stdout);
  } catch {
    throw new Error("package_acquisition_failed");
  }
  if (
    !isRecord(metadata) || metadata.name !== PACKAGE_NAME || metadata.version !== expectedVersion ||
    !isRecord(metadata.dist) || typeof metadata.dist.integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(metadata.dist.integrity) ||
    typeof metadata.dist.tarball !== "string" || !publicTarballUrl(metadata.dist.tarball, expectedVersion)
  ) {
    throw new Error("package_acquisition_failed");
  }
  const destination = path.join(acquisitionRoot, "public-pack");
  fs.mkdirSync(destination, { recursive: true });
  const packed = runNpm([
    "pack", sourceSpec, "--json", "--ignore-scripts", "--pack-destination", destination, ...isolatedArgs,
  ], acquisitionRoot, env);
  if (packed.code !== 0) throw new Error("package_acquisition_failed");
  const tarballPath = parsePackFilename(packed.stdout, destination);
  const bytes = fs.readFileSync(tarballPath);
  const artifactSha512 = crypto.createHash("sha512").update(bytes).digest("hex");
  const artifactSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const verifiedIntegrity = `sha512-${Buffer.from(artifactSha512, "hex").toString("base64")}`;
  if (verifiedIntegrity !== metadata.dist.integrity) throw new Error("package_acquisition_failed");
  return Object.freeze({
    tarballPath,
    verifiedArtifact: {
      originalPath: tarballPath,
      originalRealPath: tarballPath,
      bytes: Buffer.from(bytes),
      sha256: artifactSha256,
      compromised: false,
    },
    provenance: Object.freeze({
      registry: PUBLIC_REGISTRY,
      resolvedTarballUrl: metadata.dist.tarball,
      distIntegrity: metadata.dist.integrity,
      artifactSha256,
      artifactSha512,
    }),
  });
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function normalizePackageRequest(
  packageSpec: string,
  expectedVersion: string | undefined,
  repositoryRoot: string,
): NormalizedPackageRequest {
  const exact = PUBLIC_EXACT_SPEC.exec(packageSpec);
  if (packageSpec !== PUBLIC_LATEST_SPEC && exact?.[1] !== undefined) {
    if (!isExactVersion(exact[1])) throw new Error("invalid_package_spec");
    if (expectedVersion !== undefined && expectedVersion !== exact[1]) throw new Error("invalid_expected_version");
    return Object.freeze({
      sourceSpec: packageSpec,
      requestedPackageSpec: packageSpec,
      expectedVersion: exact[1],
      publicRegistry: true,
    });
  }
  if (packageSpec === PUBLIC_LATEST_SPEC) {
    if (!isExactVersion(expectedVersion)) throw new Error("invalid_expected_version");
    return Object.freeze({ sourceSpec: packageSpec, requestedPackageSpec: packageSpec, expectedVersion, publicRegistry: true });
  }
  if (packageSpec.length === 0) {
    if (expectedVersion !== undefined && !isExactVersion(expectedVersion)) throw new Error("invalid_expected_version");
    return Object.freeze({
      sourceSpec: packageSpec,
      requestedPackageSpec: "local-source",
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      publicRegistry: false,
    });
  }
  if (!packageSpec.toLowerCase().endsWith(".tgz") || /(?:^|:)\/\//u.test(packageSpec)) {
    throw new Error("invalid_package_spec");
  }
  const resolved = path.resolve(repositoryRoot, packageSpec);
  try {
    const realRepositoryRoot = fs.realpathSync(repositoryRoot);
    const realResolved = fs.realpathSync(resolved);
    const stats = fs.lstatSync(resolved);
    if (!stats.isFile() || stats.isSymbolicLink() || !isPathInside(realRepositoryRoot, realResolved)) {
      throw new Error("invalid_package_spec");
    }
  } catch {
    throw new Error("invalid_package_spec");
  }
  if (expectedVersion !== undefined && !isExactVersion(expectedVersion)) throw new Error("invalid_expected_version");
  return Object.freeze({
    sourceSpec: resolved,
    requestedPackageSpec: "local-tarball",
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    publicRegistry: false,
  });
}

function writeSyntheticMcpSources(packageRoot: string, stubUrl: string): void {
  const name = "kcoderag-qa";
  const entry = {
    type: "http",
    url: stubUrl,
    headers: { Authorization: SYNTHETIC_AUTHORIZATION },
  };
  fs.writeFileSync(
    path.join(packageRoot, name, ".mcp.json"),
    `${JSON.stringify({ mcpServers: { [name]: entry } }, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(packageRoot, name, ".codex.mcp.json"),
    `${JSON.stringify({ [name]: {
      url: stubUrl,
      http_headers: { Authorization: SYNTHETIC_AUTHORIZATION },
    } }, null, 2)}\n`,
    "utf8",
  );
}

async function acquirePackage(
  packageSpec: string,
  temporaryRoot: string,
  stubUrl: string,
  repositoryRoot: string,
  expectedVersion?: string,
  runNpm: NpmRunner = runNpmProcess,
): Promise<AcquiredPackage> {
  const acquisitionRuntime = path.join(temporaryRoot, "acquisition-runtime");
  const acquisitionRoot = path.join(acquisitionRuntime, "work");
  const env = safeEnvironment(acquisitionRuntime);
  fs.mkdirSync(acquisitionRoot, { recursive: true });
  let publicRegistryArtifact: PublicRegistryArtifact | undefined;
  let publicInstallArtifact: VerifiedTarballArtifact | undefined;
  let sourceSpec: string;
  if (packageSpec.length === 0) {
    sourceSpec = packDirectory(repositoryRoot, path.join(temporaryRoot, "source-pack"), env, runNpm);
  } else if (packageSpec === PUBLIC_LATEST_SPEC || PUBLIC_EXACT_SPEC.test(packageSpec)) {
    if (expectedVersion === undefined) throw new Error("package_acquisition_failed");
    const acquired = acquirePublicRegistryArtifact(packageSpec, expectedVersion, acquisitionRoot, env, runNpm);
    sourceSpec = acquired.tarballPath;
    publicRegistryArtifact = acquired.provenance;
    publicInstallArtifact = acquired.verifiedArtifact;
  } else {
    sourceSpec = packageSpec;
  }
  const installRoot = path.join(temporaryRoot, "acquired");
  fs.mkdirSync(installRoot, { recursive: true });
  const install = (verifiedSourceSpec: string): CommandResult => runNpm([
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--prefix",
      installRoot,
      verifiedSourceSpec,
    ], acquisitionRoot, env);
  const installed = publicInstallArtifact === undefined
    ? install(sourceSpec)
    : withVerifiedInvocationTarball(publicInstallArtifact, acquisitionRuntime, "registry-install", install);
  if (installed.code !== 0) throw new Error("package_acquisition_failed");
  const packageRoot = path.join(installRoot, "node_modules", "kcoderag-nav");
  let resolvedVersion: string;
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    if (
      !isRecord(manifest) ||
      manifest.name !== PACKAGE_NAME ||
      typeof manifest.version !== "string" ||
      !isExactVersion(manifest.version) ||
      (expectedVersion !== undefined && manifest.version !== expectedVersion)
    ) {
      throw new Error("invalid_package");
    }
    resolvedVersion = manifest.version;
  } catch {
    throw new Error("package_acquisition_failed");
  }
  writeSyntheticMcpSources(packageRoot, stubUrl);
  const lifecyclePackageSpec = packDirectory(packageRoot, path.join(temporaryRoot, "synthetic-pack"), env, runNpm);
  const requestedPackageSpec = packageSpec.length === 0
    ? "local-source"
    : packageSpec.toLowerCase().endsWith(".tgz")
      ? "local-tarball"
      : packageSpec;
  return Object.freeze({
    requestedPackageSpec,
    expectedVersion: expectedVersion ?? resolvedVersion,
    resolvedPackageName: PACKAGE_NAME,
    resolvedVersion,
    lifecycleTarballSha256: crypto.createHash("sha256").update(fs.readFileSync(lifecyclePackageSpec)).digest("hex"),
    lifecyclePackageSpec,
    ...(publicRegistryArtifact === undefined ? {} : { publicRegistryArtifact }),
  });
}

function validateAcquisition(
  value: AcquiredPackage,
  request: NormalizedPackageRequest,
  temporaryRoot: string,
): ValidatedAcquisition {
  if (!isRecord(value)) throw new Error("invalid_package_provenance");
  const requestedPackageSpec = value.requestedPackageSpec;
  const resolvedPackageName = value.resolvedPackageName;
  const resolvedVersion = value.resolvedVersion;
  const lifecycleTarballSha256 = value.lifecycleTarballSha256;
  const lifecyclePackageSpec = value.lifecyclePackageSpec;
  const publicRegistryArtifact = value.publicRegistryArtifact;
  const expectedVersion = request.expectedVersion ?? value.expectedVersion;
  if (
    typeof requestedPackageSpec !== "string" || requestedPackageSpec !== request.requestedPackageSpec ||
    !isExactVersion(expectedVersion) || value.expectedVersion !== expectedVersion ||
    resolvedPackageName !== PACKAGE_NAME ||
    typeof resolvedVersion !== "string" || resolvedVersion !== expectedVersion ||
    typeof lifecycleTarballSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(lifecycleTarballSha256) ||
    typeof lifecyclePackageSpec !== "string"
  ) {
    throw new Error("invalid_package_provenance");
  }
  if (request.publicRegistry) {
    if (
      !isRecord(publicRegistryArtifact) || publicRegistryArtifact.registry !== PUBLIC_REGISTRY ||
      typeof publicRegistryArtifact.resolvedTarballUrl !== "string" ||
      !publicTarballUrl(publicRegistryArtifact.resolvedTarballUrl, expectedVersion) ||
      typeof publicRegistryArtifact.distIntegrity !== "string" ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(publicRegistryArtifact.distIntegrity) ||
      typeof publicRegistryArtifact.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(publicRegistryArtifact.artifactSha256) ||
      typeof publicRegistryArtifact.artifactSha512 !== "string" || !/^[a-f0-9]{128}$/u.test(publicRegistryArtifact.artifactSha512) ||
      `sha512-${Buffer.from(publicRegistryArtifact.artifactSha512, "hex").toString("base64")}` !== publicRegistryArtifact.distIntegrity
    ) {
      throw new Error("invalid_package_provenance");
    }
  } else if (publicRegistryArtifact !== undefined) {
    throw new Error("invalid_package_provenance");
  }
  let realTarball: string;
  let lifecycleBytes: Buffer;
  try {
    realTarball = fs.realpathSync(lifecyclePackageSpec);
    const stats = fs.lstatSync(lifecyclePackageSpec);
    if (!stats.isFile() || stats.isSymbolicLink() || !realTarball.toLowerCase().endsWith(".tgz")) {
      throw new Error("invalid_package_provenance");
    }
    const realTemporaryRoot = fs.realpathSync(temporaryRoot);
    if (!isPathInside(realTemporaryRoot, realTarball)) throw new Error("invalid_package_provenance");
    lifecycleBytes = fs.readFileSync(realTarball);
    const actualDigest = crypto.createHash("sha256").update(lifecycleBytes).digest("hex");
    if (actualDigest !== lifecycleTarballSha256) throw new Error("invalid_package_provenance");
  } catch {
    throw new Error("invalid_package_provenance");
  }
  const provenance: PackageProvenance = Object.freeze({
    requestedPackageSpec,
    expectedVersion,
    resolvedPackageName: PACKAGE_NAME,
    resolvedVersion,
    lifecycleTarballSha256,
    ...(publicRegistryArtifact === undefined ? {} : { publicRegistryArtifact: Object.freeze({ ...publicRegistryArtifact }) }),
  });
  const lifecycleArtifact: VerifiedTarballArtifact = {
    originalPath: lifecyclePackageSpec,
    originalRealPath: realTarball,
    bytes: Buffer.from(lifecycleBytes),
    sha256: lifecycleTarballSha256,
    compromised: false,
  };
  return Object.freeze({ lifecycleArtifact, provenance });
}

function assertArtifactFile(filePath: string, expectedRealPath: string, expectedSha256: string): void {
  const stats = fs.lstatSync(filePath);
  const realPath = fs.realpathSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || realPath !== expectedRealPath) {
    throw new Error("artifact_integrity_failed");
  }
  const digest = crypto.createHash("sha256").update(fs.readFileSync(realPath)).digest("hex");
  if (digest !== expectedSha256) throw new Error("artifact_integrity_failed");
}

function assertVerifiedArtifact(artifact: VerifiedTarballArtifact): void {
  try {
    assertArtifactFile(artifact.originalPath, artifact.originalRealPath, artifact.sha256);
  } catch {
    artifact.compromised = true;
    throw new Error("artifact_integrity_failed");
  }
}

function withVerifiedInvocationTarball<T>(
  artifact: VerifiedTarballArtifact,
  runtimeRoot: string,
  command: string,
  invoke: (packageSpec: string) => T,
): T {
  try {
    assertVerifiedArtifact(artifact);
    const copiesRoot = path.join(runtimeRoot, "verified-artifacts");
    fs.mkdirSync(copiesRoot, { recursive: true, mode: 0o700 });
    const invocationRoot = fs.mkdtempSync(path.join(copiesRoot, `${command}-`));
    const invocationPath = path.join(invocationRoot, `${artifact.sha256}.tgz`);
    fs.writeFileSync(invocationPath, artifact.bytes, { flag: "wx", mode: 0o600 });
    const invocationRealPath = fs.realpathSync(invocationPath);
    assertArtifactFile(invocationPath, invocationRealPath, artifact.sha256);
    const result = invoke(invocationPath);
    assertArtifactFile(invocationPath, invocationRealPath, artifact.sha256);
    assertVerifiedArtifact(artifact);
    return result;
  } catch {
    artifact.compromised = true;
    throw new Error("artifact_integrity_failed");
  }
}

function parseCliPayload(result: CommandResult, command: string): Record<string, any> | undefined {
  if (result.code !== 0) return undefined;
  try {
    const payload: unknown = JSON.parse(result.stdout.trim());
    return isRecord(payload) && payload.ok === true && payload.command === command ? payload : undefined;
  } catch {
    return undefined;
  }
}

interface PackageCliResult {
  readonly code: number;
  readonly payload?: Record<string, any>;
}

function parseCliDocument(result: CommandResult): Record<string, any> | undefined {
  try {
    const payload: unknown = JSON.parse(result.stdout.trim());
    return isRecord(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function runPackageCliResult(
  artifact: VerifiedTarballArtifact,
  projectRoot: string,
  runtimeRoot: string,
  command: "install" | "status" | "doctor" | "update" | "uninstall",
  host: HostId,
  runNpm: NpmRunner,
): PackageCliResult {
  return withVerifiedInvocationTarball(artifact, runtimeRoot, command, (packageSpec) => {
    const args = [
      "exec",
      "--yes",
      "--ignore-scripts",
      `--package=${packageSpec}`,
      "--",
      "kcoderag-nav",
      command,
      "--host",
      host,
      "--target",
      projectRoot,
      "--json",
    ];
    if (command !== "status" && command !== "doctor") args.push("--yes");
    const result = runNpm(args, projectRoot, safeEnvironment(runtimeRoot, true));
    const payload = parseCliDocument(result);
    return Object.freeze({ code: result.code, ...(payload === undefined ? {} : { payload }) });
  });
}

function runPackageCli(
  artifact: VerifiedTarballArtifact,
  projectRoot: string,
  runtimeRoot: string,
  command: "install" | "status" | "doctor" | "update" | "uninstall",
  host: HostId,
  runNpm: NpmRunner,
): Record<string, any> | undefined {
  const result = runPackageCliResult(artifact, projectRoot, runtimeRoot, command, host, runNpm);
  const normalized: CommandResult = {
    code: result.code,
    stdout: result.payload === undefined ? "" : JSON.stringify(result.payload),
    stderr: "",
  };
  return parseCliPayload(normalized, command);
}

function expectedServerName(host: HostId): string {
  return host === "cursor" ? "kcoderag" : "kcoderag-qa";
}

function readConnection(host: HostId, projectRoot: string): McpConnection | undefined {
  try {
    if (host === "codex") {
      const source = fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8");
      const block = /\[mcp_servers\."?([^"\]\s]+)"?\][\s\S]*?^url\s*=\s*("(?:\\.|[^"])*")/mu.exec(source);
      if (block?.[1] === undefined || block[2] === undefined) return undefined;
      const url: unknown = JSON.parse(block[2]);
      return typeof url === "string" ? { serverName: block[1], url } : undefined;
    }
    if (host === "opencode") {
      const configName = fs.existsSync(path.join(projectRoot, "opencode.jsonc"))
        ? "opencode.jsonc"
        : "opencode.json";
      const document = parseJsoncObject(fs.readFileSync(path.join(projectRoot, configName), "utf8"));
      if (!isRecord(document.mcp)) return undefined;
      const entry = document.mcp[expectedServerName(host)];
      return isRecord(entry) && typeof entry.url === "string"
        ? { serverName: expectedServerName(host), url: entry.url }
        : undefined;
    }
    const relativePath = host === "claude" ? ".mcp.json" : ".cursor/mcp.json";
    const document: unknown = JSON.parse(fs.readFileSync(path.join(projectRoot, ...relativePath.split("/")), "utf8"));
    if (!isRecord(document) || !isRecord(document.mcpServers)) return undefined;
    const name = expectedServerName(host);
    const entry = document.mcpServers[name];
    return isRecord(entry) && typeof entry.url === "string"
      ? { serverName: name, url: entry.url }
      : undefined;
  } catch {
    return undefined;
  }
}

function sha256Parts(parts: readonly (string | Buffer)[]): string {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part, "utf8");
    hash.update(Buffer.from(String(bytes.length), "ascii"));
    hash.update(Buffer.from([0]));
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function readRegisteredHookCommand(host: "codex" | "claude", projectRoot: string): string | undefined {
  const relativePath = host === "codex" ? [".codex", "hooks.json"] : [".claude", "settings.json"];
  const filePath = path.join(projectRoot, ...relativePath);
  try {
    const metadata = fs.lstatSync(filePath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 1024 * 1024) return undefined;
    const document: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(document) || !isRecord(document.hooks) || !Array.isArray(document.hooks.PreToolUse)) {
      return undefined;
    }
    const commands: string[] = [];
    for (const entry of document.hooks.PreToolUse) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) continue;
      for (const hook of entry.hooks) {
        if (!isRecord(hook) || hook.type !== "command") continue;
        const selected = process.platform === "win32" ? hook.commandWindows : hook.command;
        if (typeof selected === "string" && selected.length > 0 && selected.length <= 64 * 1024) {
          commands.push(selected);
        }
      }
    }
    return commands.length === 1 ? commands[0] : undefined;
  } catch {
    return undefined;
  }
}

function runRegisteredHook(command: string, cwd: string, runtimeRoot: string): CommandResult {
  const payload = `${JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "rg -n SyntheticSymbol src" },
  })}\n`;
  if (process.platform === "win32") {
    const completed = childProcess.spawnSync(command, [], {
      shell: process.env.ComSpec ?? "cmd.exe",
      cwd,
      env: safeEnvironment(runtimeRoot),
      input: payload,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return {
      code: completed.status ?? 1,
      stdout: typeof completed.stdout === "string" ? completed.stdout : "",
      stderr: typeof completed.stderr === "string" ? completed.stderr : "",
    };
  }
  return runProcess("sh", ["-c", command], {
    cwd,
    env: safeEnvironment(runtimeRoot),
    input: payload,
    timeout: 10_000,
  });
}

function validHookOutput(result: CommandResult): boolean {
  if (result.code !== 0 || Buffer.byteLength(result.stdout, "utf8") > 64 * 1024) return false;
  try {
    const output: unknown = JSON.parse(result.stdout);
    return isRecord(output) && isRecord(output.hookSpecificOutput) &&
      output.hookSpecificOutput.hookEventName === "PreToolUse";
  } catch {
    return false;
  }
}

function navigationEvidence(host: HostId, projectRoot: string, runtimeRoot: string): NavigationContract | undefined {
  const deepRoot = path.join(projectRoot, "deep folder", "Unicode-子目录");
  fs.mkdirSync(deepRoot, { recursive: true });
  if (host === "cursor") {
    try {
      const ruleBytes = fs.readFileSync(path.join(projectRoot, ".cursor", "rules", "kcoderag-navigation.mdc"));
      const skillBytes = fs.readFileSync(path.join(projectRoot, ".cursor", "skills", "kcoderag-nav", "SKILL.md"));
      const mcpBytes = fs.readFileSync(path.join(projectRoot, ".cursor", "mcp.json"));
      const hooksBytes = fs.readFileSync(path.join(projectRoot, ".cursor", "hooks.json"));
      const updateNoticeBytes = fs.readFileSync(path.join(
        projectRoot, ".cursor", "kcoderag-nav", "hooks", "update-notice.cjs",
      ));
      const rule = ruleBytes.toString("utf8");
      const skill = skillBytes.toString("utf8");
      const hooks: unknown = JSON.parse(hooksBytes.toString("utf8"));
      const postToolUse = isRecord(hooks) && isRecord(hooks.hooks) && Array.isArray(hooks.hooks.postToolUse)
        ? hooks.hooks.postToolUse
        : [];
      const updateCommand = "node .cursor/kcoderag-nav/hooks/update-notice.cjs cursor";
      const valid = /alwaysApply:\s*true/u.test(rule) && rule.includes("search_code") && skill.includes("KCodeRag") &&
        postToolUse.some((entry) => isRecord(entry) && entry.command === updateCommand) &&
        updateNoticeBytes.includes(Buffer.from("additional_context", "utf8"));
      return Object.freeze({
        kind: "rule_skill_mcp" as const,
        root: valid,
        deep: valid,
        sameProject: valid && path.relative(projectRoot, deepRoot).split(path.sep).every((part) => part !== ".."),
        fingerprint: sha256Parts([ruleBytes, skillBytes, mcpBytes, hooksBytes, updateNoticeBytes]),
      });
    } catch {
      return undefined;
    }
  }
  if (host === "opencode") {
    try {
      const pluginBytes = fs.readFileSync(path.join(projectRoot, ".opencode", "plugins", "kcoderag-nav.js"));
      const skillBytes = fs.readFileSync(path.join(projectRoot, ".opencode", "skills", "kcoderag-nav", "SKILL.md"));
      const markerBytes = fs.readFileSync(path.join(projectRoot, ".opencode", "kcoderag-nav", "hooks", "mcp-call-marker.cjs"));
      const updateNoticeBytes = fs.readFileSync(path.join(
        projectRoot, ".opencode", "kcoderag-nav", "hooks", "update-notice.cjs",
      ));
      const valid = pluginBytes.includes(Buffer.from("tool.execute.after", "utf8")) &&
        pluginBytes.includes(Buffer.from("showToast", "utf8")) &&
        skillBytes.includes(Buffer.from("KCodeRag", "utf8"));
      return Object.freeze({
        kind: "plugin_skill_mcp" as const,
        root: valid,
        deep: valid,
        sameProject: valid && path.relative(projectRoot, deepRoot).split(path.sep).every((part) => part !== ".."),
        fingerprint: sha256Parts([pluginBytes, skillBytes, markerBytes, updateNoticeBytes]),
      });
    } catch {
      return undefined;
    }
  }
  const command = readRegisteredHookCommand(host, projectRoot);
  if (command === undefined) return undefined;
  try {
    const stateBytes = fs.readFileSync(statePath(host, projectRoot));
    const rootResult = runRegisteredHook(command, projectRoot, runtimeRoot);
    const deepResult = runRegisteredHook(command, deepRoot, runtimeRoot);
    const root = validHookOutput(rootResult);
    const deep = validHookOutput(deepResult);
    const rootDigest = sha256Parts([rootResult.stdout]);
    const deepDigest = sha256Parts([deepResult.stdout]);
    return Object.freeze({
      kind: "pretooluse_hook" as const,
      root,
      deep,
      sameProject: root && deep && rootDigest === deepDigest,
      fingerprint: sha256Parts([stateBytes, command, rootDigest, deepDigest]),
    });
  } catch {
    return undefined;
  }
}

async function rpc(url: string, payload: Record<string, unknown>): Promise<Record<string, any> | undefined> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    if (text.length === 0) return {};
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function driveMcp(
  host: HostId,
  url: string,
  receiptPath: string,
): Promise<Pick<SmokeEvidence, "mcpInitialize" | "mcpList" | "mcpCall" | "stubReceipt">> {
  const before = readReceipts(receiptPath).length;
  const initialized = await rpc(url, {
    jsonrpc: "2.0",
    id: `${host}-initialize`,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "contract-smoke", version: "1" } },
  });
  const listed = await rpc(url, {
    jsonrpc: "2.0",
    id: `${host}-list`,
    method: "tools/list",
    params: {},
  });
  const called = await rpc(url, {
    jsonrpc: "2.0",
    id: `${host}-call`,
    method: "tools/call",
    params: { name: SYNTHETIC_TOOL, arguments: { query: "SyntheticSymbol" } },
  });
  const newReceipts = readReceipts(receiptPath).slice(before);
  const hasReceipt = (method: string, toolName: string = ""): boolean =>
    newReceipts.some((receipt) => receipt.method === method && receipt.toolName === toolName);
  const tools = isRecord(listed?.result) && Array.isArray(listed.result.tools) ? listed.result.tools : [];
  return {
    mcpInitialize: isRecord(initialized?.result) && initialized.result.serverInfo?.name === "synthetic-loopback" && hasReceipt("initialize"),
    mcpList: tools.some((tool: unknown) => isRecord(tool) && tool.name === SYNTHETIC_TOOL) && hasReceipt("tools/list"),
    mcpCall: isRecord(called?.result) && called.result.isError === false && hasReceipt("tools/call", SYNTHETIC_TOOL),
    stubReceipt: hasReceipt("initialize") && hasReceipt("tools/list") && hasReceipt("tools/call", SYNTHETIC_TOOL),
  };
}

function statePath(host: HostId, projectRoot: string): string {
  const hostRoot = host === "cursor"
    ? ".cursor"
    : host === "claude"
      ? ".claude"
      : host === "opencode"
        ? ".opencode"
        : ".codex";
  return path.join(projectRoot, hostRoot, "kcoderag-nav", "install-state.json");
}

function treeFingerprint(root: string): string {
  const entries: (string | Buffer)[] = [];
  const visit = (current: string, relative: string): void => {
    const metadata = fs.lstatSync(current);
    if (metadata.isSymbolicLink()) {
      entries.push(`link:${relative}`);
      return;
    }
    if (metadata.isDirectory()) {
      entries.push(`directory:${relative}`);
      for (const name of fs.readdirSync(current).sort((left, right) => left.localeCompare(right))) {
        visit(path.join(current, name), relative.length === 0 ? name : `${relative}/${name}`);
      }
      return;
    }
    entries.push(`file:${relative}`);
    entries.push(fs.readFileSync(current));
  };
  visit(root, "");
  return sha256Parts(entries);
}

function installSyntheticSourceConflict(host: HostId, runtimeRoot: string): void {
  const hostHome = path.join(runtimeRoot, "host-home");
  fs.mkdirSync(hostHome, { recursive: true });
  if (host === "codex") {
    fs.writeFileSync(path.join(hostHome, "config.toml"), "[mcp_servers.kcoderag-qa]\n", "utf8");
    return;
  }
  if (host === "claude") {
    fs.writeFileSync(path.join(hostHome, ".claude.json"), `${JSON.stringify({ mcpServers: { kcoderag: {} } })}\n`, "utf8");
    return;
  }
  if (host === "opencode") {
    const opencodeRoot = path.join(hostHome, ".config", "opencode");
    fs.mkdirSync(opencodeRoot, { recursive: true });
    fs.writeFileSync(path.join(opencodeRoot, "opencode.json"), `${JSON.stringify({ mcp: { "kcoderag-qa": {} } })}\n`, "utf8");
    return;
  }
  const cursorRoot = path.join(hostHome, ".cursor");
  fs.mkdirSync(cursorRoot, { recursive: true });
  fs.writeFileSync(path.join(cursorRoot, "mcp.json"), `${JSON.stringify({ mcpServers: { kcoderag: {} } })}\n`, "utf8");
}

function isStatusPayload(
  result: PackageCliResult,
  command: "status" | "doctor",
  status: "not_installed" | "healthy" | "source_conflict",
): boolean {
  const expectedCode = status === "source_conflict" ? 1 : 0;
  return result.code === expectedCode && result.payload?.command === command &&
    result.payload.environment === "qa" && result.payload.status === status &&
    result.payload.ok === (status !== "source_conflict");
}

function isConflictFailure(result: PackageCliResult): boolean {
  return result.code !== 0 && result.payload?.ok === false &&
    result.payload.code === "source_conflict" && result.payload.error?.code === "source_conflict";
}

async function runRequiredHost(
  host: HostId,
  artifact: VerifiedTarballArtifact,
  projectsRoot: string,
  stubUrl: string,
  receiptPath: string,
  provenance: PackageProvenance,
  runNpm: NpmRunner,
): Promise<HostSmokeResult> {
  const projectRoot = path.join(projectsRoot, host);
  const runtimeRoot = path.join(projectsRoot, `${host}-runtime`);
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "synthetic.cpp"), "int SyntheticSymbol() { return 7; }\n", "utf8");
  const evidence = { ...blankEvidence(), packageAcquired: true } as Record<keyof SmokeEvidence, boolean>;
  let installed = false;
  let navigationContract: NavigationContract | undefined;
  try {
    const preinstallStatus = runPackageCliResult(artifact, projectRoot, runtimeRoot, "status", host, runNpm);
    const preinstallDoctor = runPackageCliResult(artifact, projectRoot, runtimeRoot, "doctor", host, runNpm);
    evidence.preinstall = isStatusPayload(preinstallStatus, "status", "not_installed") &&
      isStatusPayload(preinstallDoctor, "doctor", "not_installed");

    const install = runPackageCli(artifact, projectRoot, runtimeRoot, "install", host, runNpm);
    evidence.install = install !== undefined;
    installed = evidence.install;
    if (!installed) return evaluateHostEvidence({
      host,
      mode: "required-contract",
      evidence,
      failureReason: "install_failed",
      provenance,
    });
    const status = runPackageCli(artifact, projectRoot, runtimeRoot, "status", host, runNpm);
    const doctor = runPackageCli(artifact, projectRoot, runtimeRoot, "doctor", host, runNpm);
    evidence.status = status?.status === "healthy" && status.environment === "qa";
    evidence.doctor = doctor?.status === "healthy" && doctor.environment === "qa";
    const connection = readConnection(host, projectRoot);
    evidence.toolRegistration = connection?.serverName === expectedServerName(host) && connection.url === stubUrl;
    navigationContract = navigationEvidence(host, projectRoot, runtimeRoot);
    evidence.navigation = navigationContract !== undefined && navigationContract.root && navigationContract.deep &&
      navigationContract.sameProject && /^[a-f0-9]{64}$/u.test(navigationContract.fingerprint);
    if (connection?.url === stubUrl) Object.assign(evidence, await driveMcp(host, connection.url, receiptPath));
    const update = runPackageCli(artifact, projectRoot, runtimeRoot, "update", host, runNpm);
    evidence.update = update !== undefined;
    evidence.qaOnly = [preinstallStatus.payload, preinstallDoctor.payload, install, status, doctor, update]
      .every((payload) => payload?.environment === "qa");

    installSyntheticSourceConflict(host, runtimeRoot);
    const conflictStatus = runPackageCliResult(artifact, projectRoot, runtimeRoot, "status", host, runNpm);
    const conflictDoctor = runPackageCliResult(artifact, projectRoot, runtimeRoot, "doctor", host, runNpm);
    evidence.sourceConflict = isStatusPayload(conflictStatus, "status", "source_conflict") &&
      isStatusPayload(conflictDoctor, "doctor", "source_conflict");

    const beforeUpdate = treeFingerprint(projectRoot);
    const blockedUpdate = runPackageCliResult(artifact, projectRoot, runtimeRoot, "update", host, runNpm);
    evidence.conflictUpdateBlocked = isConflictFailure(blockedUpdate) && treeFingerprint(projectRoot) === beforeUpdate;

    const uninstall = runPackageCli(artifact, projectRoot, runtimeRoot, "uninstall", host, runNpm);
    evidence.conflictUninstallAllowed = uninstall !== undefined && uninstall.environment === "qa";
    evidence.uninstall = evidence.conflictUninstallAllowed &&
      !fs.existsSync(statePath(host, projectRoot));
    installed = !evidence.uninstall;

    const beforeInstall = treeFingerprint(projectRoot);
    const blockedInstall = runPackageCliResult(artifact, projectRoot, runtimeRoot, "install", host, runNpm);
    evidence.conflictInstallBlocked = isConflictFailure(blockedInstall) && treeFingerprint(projectRoot) === beforeInstall;
    return evaluateHostEvidence({
      host,
      mode: "required-contract",
      evidence,
      ...(navigationContract === undefined ? {} : { navigationContract }),
      provenance,
    });
  } catch {
    return evaluateHostEvidence({
      host,
      mode: "required-contract",
      evidence,
      failureReason: "contract_execution_failed",
      provenance,
    });
  } finally {
    if (installed) {
      try { runPackageCli(artifact, projectRoot, runtimeRoot, "uninstall", host, runNpm); } catch { /* fail closed above */ }
    }
  }
}

function commandAvailable(command: string, cwd: string): boolean {
  const result = process.platform === "win32"
    ? runProcess("where", [command], { cwd, commandShim: true, timeout: 5_000 })
    : runProcess("sh", ["-c", `command -v ${command}`], { cwd, timeout: 5_000 });
  return result.code === 0;
}

function structuredLiveEvidence(output: string): { readonly hook: boolean; readonly tool: boolean } {
  let hook = false;
  let tool = false;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isRecord(value)) return;
    const eventName = value.hook_event_name ?? value.hookEventName;
    if (eventName === "PreToolUse") hook = true;
    if ([value.tool_name, value.name, value.tool].some((name) =>
      typeof name === "string" && (name === SYNTHETIC_TOOL || name.endsWith(`_${SYNTHETIC_TOOL}`)))) tool = true;
    for (const child of Object.values(value)) visit(child);
  };
  for (const line of output.split(/\r?\n/u)) {
    try {
      visit(JSON.parse(line));
    } catch {
      // Natural-language claims are intentionally ignored.
    }
  }
  return { hook, tool };
}

function runLiveCommand(host: HostId, projectRoot: string, runtimeRoot: string): CommandResult {
  const prompt = "Use structural code search for SyntheticSymbol, then call search_code exactly once.";
  if (host === "codex") {
    return runProcess("codex", [
      "exec", "--ephemeral", "--ignore-user-config", "--dangerously-bypass-hook-trust",
      "--json", "--sandbox", "read-only", "--cd", projectRoot, prompt,
    ], { cwd: projectRoot, env: safeEnvironment(runtimeRoot), timeout: LIVE_TIMEOUT_MS, commandShim: true });
  }
  if (host === "opencode") {
    return runProcess("opencode", [
      "run", "--format", "json", "--dir", projectRoot, prompt,
    ], { cwd: projectRoot, env: safeEnvironment(runtimeRoot), timeout: LIVE_TIMEOUT_MS, commandShim: true });
  }
  return runProcess("claude", [
    "-p", prompt, "--mcp-config", path.join(projectRoot, ".mcp.json"), "--strict-mcp-config",
    "--output-format", "stream-json", "--verbose",
  ], { cwd: projectRoot, env: safeEnvironment(runtimeRoot), timeout: LIVE_TIMEOUT_MS, commandShim: true });
}

function hasMcpCallMarker(host: HostId, runtimeRoot: string): boolean {
  const cacheBase = process.platform === "win32"
    ? path.join(runtimeRoot, "local-app-data")
    : path.join(runtimeRoot, "xdg-cache");
  const directory = path.join(cacheBase, "kcoderag-nav", "mcp-calls");
  try {
    return fs.readdirSync(directory).some((name) => {
      if (!/^[0-9a-f]{64}\.json$/u.test(name)) return false;
      const value: unknown = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
      return isRecord(value) && value.host === host &&
        (value.scope === "turn" || value.scope === "session") &&
        typeof value.recordedAt === "number";
    });
  } catch {
    return false;
  }
}

async function runOptionalHost(
  host: HostId,
  artifact: VerifiedTarballArtifact,
  projectsRoot: string,
  stubUrl: string,
  receiptPath: string,
  provenance: PackageProvenance,
  runNpm: NpmRunner,
): Promise<HostSmokeResult> {
  if (host === "cursor") {
    return evaluateHostEvidence({
      host,
      mode: "optional-live",
      evidence: { packageAcquired: true },
      unavailableReason: "headless_host_unsupported",
      provenance,
    });
  }
  const command = host === "codex" ? "codex" : host === "opencode" ? "opencode" : "claude";
  if (!commandAvailable(command, projectsRoot)) {
    return evaluateHostEvidence({
      host,
      mode: "optional-live",
      evidence: { packageAcquired: true },
      unavailableReason: "host_cli_missing",
      provenance,
    });
  }
  const projectRoot = path.join(projectsRoot, host);
  const runtimeRoot = path.join(projectsRoot, `${host}-runtime`);
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "synthetic.cpp"), "int SyntheticSymbol() { return 7; }\n", "utf8");
  const evidence = { ...blankEvidence(), packageAcquired: true } as Record<keyof SmokeEvidence, boolean>;
  let installed = false;
  try {
    const install = runPackageCli(artifact, projectRoot, runtimeRoot, "install", host, runNpm);
    evidence.install = install !== undefined;
    installed = evidence.install;
    if (!installed) return evaluateHostEvidence({
      host,
      mode: "optional-live",
      evidence,
      failureReason: "install_failed",
      provenance,
    });
    const status = runPackageCli(artifact, projectRoot, runtimeRoot, "status", host, runNpm);
    evidence.status = status?.status === "healthy";
    const connection = readConnection(host, projectRoot);
    evidence.toolRegistration = connection?.serverName === expectedServerName(host) && connection.url === stubUrl;
    const before = readReceipts(receiptPath).length;
    const live = runLiveCommand(host, projectRoot, runtimeRoot);
    const structured = structuredLiveEvidence(live.stdout);
    const markerRecorded = hasMcpCallMarker(host, runtimeRoot);
    const receipts = readReceipts(receiptPath).slice(before);
    const has = (method: string, toolName: string = ""): boolean =>
      receipts.some((receipt: StubReceipt) => receipt.method === method && receipt.toolName === toolName);
    evidence.navigation = host === "opencode" ? markerRecorded : structured.hook && markerRecorded;
    evidence.mcpInitialize = has("initialize");
    evidence.mcpList = has("tools/list");
    evidence.mcpCall = structured.tool && has("tools/call", SYNTHETIC_TOOL);
    evidence.stubReceipt = evidence.mcpInitialize && evidence.mcpList && has("tools/call", SYNTHETIC_TOOL);
    const update = runPackageCli(artifact, projectRoot, runtimeRoot, "update", host, runNpm);
    evidence.update = update !== undefined;
    const uninstall = runPackageCli(artifact, projectRoot, runtimeRoot, "uninstall", host, runNpm);
    evidence.uninstall = uninstall !== undefined &&
      !fs.existsSync(statePath(host, projectRoot));
    evidence.qaOnly = [install, status, update, uninstall].every((payload) => payload?.environment === "qa");
    installed = !evidence.uninstall;
    if (live.code !== 0) {
      const diagnostic = `${live.stdout}\n${live.stderr}`.toLowerCase();
      const authMissing = ["authentication", "not logged in", "unauthorized", "login"].some((marker) => diagnostic.includes(marker));
      return evaluateHostEvidence({
        host,
        mode: "optional-live",
        evidence,
        ...(authMissing ? { unavailableReason: "auth_missing" } : { failureReason: "host_execution_failed" }),
        provenance,
      });
    }
    return evaluateHostEvidence({ host, mode: "optional-live", evidence, provenance });
  } catch {
    return evaluateHostEvidence({
      host,
      mode: "optional-live",
      evidence,
      failureReason: "live_execution_failed",
      provenance,
    });
  } finally {
    if (installed) {
      try { runPackageCli(artifact, projectRoot, runtimeRoot, "uninstall", host, runNpm); } catch { /* fail closed above */ }
    }
  }
}

function aggregate(
  mode: SmokeMode,
  hosts: readonly HostSmokeResult[],
  provenance?: PackageProvenance,
): SmokeRunResult {
  const status: SmokeStatus = hosts.some((result) => result.status === "FAIL")
    ? "FAIL"
    : hosts.some((result) => result.status === "NOT_RUN")
      ? "NOT_RUN"
      : "PASS";
  return Object.freeze({
    schemaVersion: 1,
    mode,
    status,
    ...(provenance === undefined ? {} : { provenance }),
    hosts: Object.freeze([...hosts]),
  });
}

function artifactFailureResults(
  mode: SmokeMode,
  hosts: readonly HostId[],
  provenance: PackageProvenance,
): readonly HostSmokeResult[] {
  return hosts.map((host) => evaluateHostEvidence({
    host,
    mode,
    evidence: { packageAcquired: true },
    failureReason: "artifact_integrity_failed",
    provenance,
  }));
}

export async function runHostSmoke(
  options: RunHostSmokeOptions,
  dependencies: RunHostSmokeDependencies = {},
): Promise<SmokeRunResult> {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? path.resolve(__dirname, "../.."));
  const temporaryRoot = path.resolve(options.temporaryRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-host-smoke-")));
  const hosts = options.hosts ?? HOSTS;
  if (hosts.length === 0 || hosts.some((host) => !HOSTS.includes(host))) {
    throw new Error("unsupported_host");
  }
  let request: NormalizedPackageRequest;
  try {
    request = normalizePackageRequest(options.packageSpec ?? "", options.expectedVersion, repositoryRoot);
  } catch {
    return aggregate(options.mode, hosts.map((host) => evaluateHostEvidence({
      host,
      mode: options.mode,
      unavailableReason: "package_unavailable",
    })));
  }
  const receiptPath = path.join(temporaryRoot, "receipts.jsonl");
  const server = await startStubMcpServer(receiptPath);
  let acquiredPackage: ValidatedAcquisition;
  const runNpm = dependencies.runNpm ?? runNpmProcess;
  try {
    try {
      const acquired = dependencies.acquirePackage === undefined
        ? await acquirePackage(
            request.sourceSpec,
            temporaryRoot,
            server.url,
            repositoryRoot,
            request.expectedVersion,
            runNpm,
          )
        : await dependencies.acquirePackage(
            request.sourceSpec,
            temporaryRoot,
            server.url,
            repositoryRoot,
            request.expectedVersion,
          );
      acquiredPackage = validateAcquisition(acquired, request, temporaryRoot);
    } catch {
      return aggregate(options.mode, hosts.map((host) => evaluateHostEvidence({
        host,
        mode: options.mode,
        unavailableReason: "package_unavailable",
      })));
    }
    try {
      assertVerifiedArtifact(acquiredPackage.lifecycleArtifact);
    } catch {
      return aggregate(
        options.mode,
        artifactFailureResults(options.mode, hosts, acquiredPackage.provenance),
        acquiredPackage.provenance,
      );
    }
    const projectsRoot = path.join(temporaryRoot, "projects");
    fs.mkdirSync(projectsRoot, { recursive: true });
    const results: HostSmokeResult[] = [];
    for (const host of hosts) {
      results.push(options.mode === "required-contract"
        ? await runRequiredHost(
            host,
            acquiredPackage.lifecycleArtifact,
            projectsRoot,
            server.url,
            receiptPath,
            acquiredPackage.provenance,
            runNpm,
          )
        : await runOptionalHost(
            host,
            acquiredPackage.lifecycleArtifact,
            projectsRoot,
            server.url,
            receiptPath,
            acquiredPackage.provenance,
            runNpm,
          ));
    }
    try { assertVerifiedArtifact(acquiredPackage.lifecycleArtifact); } catch { /* normalized below */ }
    return acquiredPackage.lifecycleArtifact.compromised
      ? aggregate(
          options.mode,
          artifactFailureResults(options.mode, hosts, acquiredPackage.provenance),
          acquiredPackage.provenance,
        )
      : aggregate(options.mode, results, acquiredPackage.provenance);
  } finally {
    await server.close();
  }
}

interface ParsedArguments {
  readonly mode: SmokeMode;
  readonly packageSpec?: string;
  readonly expectedVersion?: string;
  readonly hosts?: readonly HostId[];
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  let mode: SmokeMode | undefined;
  let packageSpec: string | undefined;
  let expectedVersion: string | undefined;
  const hosts: HostId[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--mode" && value !== undefined) {
      index += 1;
      mode = value === "required" ? "required-contract" : value === "live" ? "optional-live" : value as SmokeMode;
      if (mode !== "required-contract" && mode !== "optional-live") throw new Error("invalid_arguments");
    } else if (argument === "--package-spec" && value !== undefined) {
      index += 1;
      if (packageSpec !== undefined) throw new Error("invalid_arguments");
      packageSpec = value;
    } else if (argument === "--expected-version" && value !== undefined) {
      index += 1;
      if (expectedVersion !== undefined) throw new Error("invalid_arguments");
      expectedVersion = value;
    } else if (argument === "--host" && value !== undefined) {
      index += 1;
      if (!HOSTS.includes(value as HostId)) throw new Error("unsupported_host");
      hosts.push(value as HostId);
    } else {
      throw new Error("invalid_arguments");
    }
  }
  if (mode === undefined) throw new Error("invalid_arguments");
  const result: {
    mode: SmokeMode;
    packageSpec?: string;
    expectedVersion?: string;
    hosts?: readonly HostId[];
  } = { mode };
  if (packageSpec !== undefined) result.packageSpec = packageSpec;
  if (expectedVersion !== undefined) result.expectedVersion = expectedVersion;
  if (hosts.length > 0) result.hosts = Object.freeze([...new Set(hosts)]);
  return result;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let temporaryRoot: string | undefined;
  try {
    const args = parseArguments(argv);
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-host-smoke-"));
    const options: RunHostSmokeOptions = {
      mode: args.mode,
      temporaryRoot,
      repositoryRoot: path.resolve(__dirname, "../.."),
      ...(args.packageSpec === undefined ? {} : { packageSpec: args.packageSpec }),
      ...(args.expectedVersion === undefined ? {} : { expectedVersion: args.expectedVersion }),
      ...(args.hosts === undefined ? {} : { hosts: args.hosts }),
    };
    const result = await runHostSmoke(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return smokeExitCode(result);
  } catch {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: "FAIL", reason: "smoke_runner_failed" })}\n`);
    return 1;
  } finally {
    if (temporaryRoot !== undefined) {
      try {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
      } catch {
        // Temporary cleanup cannot alter the smoke verdict or disclose its path.
      }
    }
  }
}

exports.EVIDENCE_KEYS = EVIDENCE_KEYS;
exports.completeEvidence = completeEvidence;
exports.evaluateHostEvidence = evaluateHostEvidence;
exports.smokeExitCode = smokeExitCode;
exports.runHostSmoke = runHostSmoke;
exports.main = main;

if (require.main === module) {
  main().then(
    (code) => { process.exitCode = code; },
    () => { process.exitCode = 1; },
  );
}
