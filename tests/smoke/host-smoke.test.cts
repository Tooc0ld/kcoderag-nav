const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");

type HostId = "codex" | "claude" | "cursor" | "opencode" | "zcode";
type SmokeMode = "required-contract" | "optional-live";
type SmokeStatus = "PASS" | "FAIL" | "NOT_RUN";

interface SmokeEvidence {
  readonly packageAcquired: boolean;
  readonly preinstall: boolean;
  readonly install: boolean;
  readonly capabilityLifecycle: boolean;
  readonly qaOnly: boolean;
  readonly status: boolean;
  readonly doctor: boolean;
  readonly toolRegistration: boolean;
  readonly navigation: boolean;
  readonly mcpInitialize: boolean;
  readonly mcpList: boolean;
  readonly mcpCall: boolean;
  readonly update: boolean;
  readonly hostRuntime: boolean;
  readonly sourceConflict: boolean;
  readonly conflictInstallBlocked: boolean;
  readonly conflictUpdateBlocked: boolean;
  readonly conflictUninstallBlocked: boolean;
  readonly uninstall: boolean;
  readonly stubReceipt: boolean;
}

interface NavigationContract {
  readonly kind: "pretooluse_hook" | "rule_skill_mcp" | "plugin_skill_mcp";
  readonly root: boolean;
  readonly deep: boolean;
  readonly sameProject: boolean;
  readonly fingerprint: string;
}

interface HostRuntimeContract {
  readonly schemaVersion: 1;
  readonly layer: "packaged";
  readonly kind: "advisory_hooks" | "cursor_events" | "project_plugin";
  readonly installedAssets: boolean;
  readonly hookEvent: boolean;
  readonly successMarker: boolean;
  readonly updateNotice: boolean;
  readonly updateRefresh: boolean;
  readonly failOpen: boolean;
  readonly fingerprint: string;
}

interface SupportedCapabilityLifecycle {
  readonly schemaVersion: 1;
  readonly branch: "supported";
  readonly hostVersion: string;
  readonly receiptDigest: string;
  readonly navigationThenStyle: boolean;
  readonly styleThenNavigation: boolean;
  readonly duplicateNoop: boolean;
  readonly failedSecondAddPreserved: boolean;
  readonly update: boolean;
  readonly conflictUninstallBlocked: boolean;
  readonly partialUninstall: boolean;
  readonly finalUninstall: boolean;
  readonly nativeFirstWrite: boolean;
  readonly singleTransaction: boolean;
  readonly unrelatedTreePreserved: boolean;
  readonly rollbackRestored: boolean;
  readonly concurrentLoserBlocked: boolean;
  readonly assetDriftFailOpen: boolean;
  readonly patchEnvelope: boolean;
  readonly missingStableIdSilent: boolean;
  readonly markerSaturationSilent: boolean;
  readonly sessionEndReceiptBound: boolean;
}

interface UnsupportedCapabilityLifecycle {
  readonly schemaVersion: 1;
  readonly branch: "unsupported";
  readonly hostVersion: string;
  readonly navigationInstalled: boolean;
  readonly refusalCode: "host_version_unsupported";
  readonly zeroWrite: boolean;
  readonly navigationPreserved: boolean;
}

type CapabilityLifecycle = SupportedCapabilityLifecycle | UnsupportedCapabilityLifecycle;

interface HostSmokeResult {
  readonly schemaVersion: 1;
  readonly host: HostId;
  readonly mode: SmokeMode;
  readonly status: SmokeStatus;
  readonly reason: string;
  readonly evidenceLevel: "PACKAGED" | "LIVE";
  readonly stage: string;
  readonly reasonCode: string;
  readonly receipt: Readonly<Record<string, unknown>>;
  readonly evidence: SmokeEvidence;
  readonly navigationContract?: NavigationContract;
  readonly runtimeContract?: HostRuntimeContract;
  readonly capabilityLifecycle?: CapabilityLifecycle;
  readonly provenance?: PackageProvenance;
}

interface PackageProvenance {
  readonly requestedPackageSpec: string;
  readonly expectedVersion: string;
  readonly resolvedPackageName: "kcoderag-nav";
  readonly resolvedVersion: string;
  readonly lifecycleTarballSha256: string;
  readonly artifactMemberCount?: number;
  readonly publicRegistryArtifact?: {
    readonly registry: "https://registry.npmjs.org/";
    readonly resolvedTarballUrl: string;
    readonly distIntegrity: string;
    readonly artifactSha256: string;
    readonly artifactSha512: string;
  };
}

interface CandidatePackageArtifactLease {
  readonly artifact: {
    readonly name: "kcoderag-nav";
    readonly version: string;
    readonly sha256: string;
    readonly memberCount: number;
    readonly dryRunCount: 1;
    readonly actualPackCount: 1;
  };
  dispose(): void;
}

interface ReleaseReadinessModule {
  createCandidatePackageArtifact(options: {
    readonly root: string;
    readonly consumers: readonly ("pack-audit" | "tar-scan" | "host-smoke")[];
  }): CandidatePackageArtifactLease;
  scanCandidatePackageArtifact(lease: CandidatePackageArtifactLease, dependencies?: {
    readonly observeCandidateBytes?: (bytes: Buffer) => void;
    readonly scanTarball?: (options: { readonly bytes: Buffer; readonly expectedSha256: string }) => {
      readonly schemaVersion: 1;
      readonly scope: "tar";
      readonly artifactSha256: string;
      readonly memberCount: number;
      readonly scannedCount: number;
      readonly findingCount: number;
      readonly findings: readonly unknown[];
    };
  }): { readonly artifactSha256: string; readonly memberCount: number };
}

interface PackAuditModule {
  auditPackArtifact(
    lease: CandidatePackageArtifactLease,
    options: { readonly root: string },
    dependencies?: { readonly observeCandidateBytes?: (bytes: Buffer) => void },
  ): { readonly artifactSha256: string; readonly memberCount: number };
}

interface AcquiredPackage extends PackageProvenance {
  readonly lifecyclePackageSpec: string;
}

interface SmokeModule {
  readonly EVIDENCE_KEYS: readonly (keyof SmokeEvidence)[];
  readonly LIVE_PROMPT: string;
  completeEvidence(overrides?: Partial<SmokeEvidence>): SmokeEvidence;
  evaluateHostEvidence(input: {
    readonly host: HostId;
    readonly mode: SmokeMode;
    readonly evidence?: Partial<SmokeEvidence>;
    readonly unavailableReason?: string;
    readonly failureReason?: string;
  }): HostSmokeResult;
  smokeExitCode(result: {
    readonly mode: SmokeMode;
    readonly status: SmokeStatus;
  }): number;
  liveCommandSpec(host: HostId, projectRoot: string): {
    readonly executable: "codex" | "kscc" | "opencode";
    readonly args: readonly string[];
  };
  projectLiveCredential(host: HostId, runtimeRoot: string, sourceRoot?: string): boolean;
  projectCodexLiveConfig(projectRoot: string, runtimeRoot: string): boolean;
  safeEnvironment(root: string): NodeJS.ProcessEnv;
  liveEnvironment(host: HostId, root: string): NodeJS.ProcessEnv;
  runProcessAsync(executable: string, args: readonly string[], options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeout?: number;
    readonly commandShim?: boolean;
  }): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
  runHostSmoke(options: {
    readonly mode: SmokeMode;
    readonly packageSpec?: string;
    readonly artifactLease?: CandidatePackageArtifactLease;
    readonly expectedVersion?: string;
    readonly temporaryRoot: string;
    readonly hosts?: readonly HostId[];
  }, dependencies?: {
    readonly acquirePackage?: (
      packageSpec: string,
      root: string,
      stubUrl: string,
      repositoryRoot: string,
      expectedVersion?: string,
    ) => Promise<AcquiredPackage>;
    readonly runNpm?: (
      args: readonly string[],
      cwd: string,
      env: NodeJS.ProcessEnv,
    ) => { readonly code: number; readonly stdout: string; readonly stderr: string };
    readonly observeCandidateBytes?: (bytes: Buffer) => void;
  }): Promise<{
    readonly schemaVersion: 1;
    readonly mode: SmokeMode;
    readonly status: SmokeStatus;
    readonly provenance?: PackageProvenance;
    readonly hosts: readonly HostSmokeResult[];
  }>;
  main(argv: readonly string[], dependencies?: {
    readonly createCandidatePackageArtifact?: (options: {
      readonly root: string;
      readonly consumers: readonly string[];
    }) => CandidatePackageArtifactLease;
    readonly runHostSmoke?: (options: {
      readonly mode: SmokeMode;
      readonly artifactLease?: CandidatePackageArtifactLease;
      readonly temporaryRoot: string;
      readonly repositoryRoot: string;
      readonly hosts?: readonly HostId[];
    }) => Promise<{
      readonly schemaVersion: 1;
      readonly mode: SmokeMode;
      readonly status: SmokeStatus;
      readonly hosts: readonly HostSmokeResult[];
    }>;
    readonly stdout?: (text: string) => void;
  }): Promise<number>;
}

interface StubModule {
  readonly MCP_PATH: string;
  readonly SYNTHETIC_TOOL: string;
  startStubMcpServer(receiptPath: string): Promise<{
    readonly url: string;
    close(): Promise<void>;
  }>;
  readReceipts(receiptPath: string): readonly Readonly<Record<string, unknown>>[];
}

const smoke = require("../../dist/smoke/host-smoke.cjs") as SmokeModule;
const releaseReadiness = require("../../dist/maintainer/release-readiness.cjs") as ReleaseReadinessModule;
const packAudit = require("../../dist/maintainer/pack-audit.cjs") as PackAuditModule;
const stub = require("../../dist/smoke/stub-mcp-server.cjs") as StubModule;
const repositoryRoot = path.resolve(__dirname, "../..");

function runNpm(args: readonly string[], cwd: string): string {
  const completed = process.platform === "win32"
    ? childProcess.spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...args], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
      })
    : childProcess.spawnSync("npm", args, { cwd, encoding: "utf8" });
  assert.equal(completed.status, 0, "synthetic smoke package command must succeed");
  return typeof completed.stdout === "string" ? completed.stdout : "";
}

function packFilename(stdout: string, destination: string): string {
  const payload = JSON.parse(stdout) as readonly [{ readonly filename: string }];
  return path.resolve(destination, payload[0].filename);
}

function packTinyFixture(
  root: string,
  name: string,
  version: string,
): { readonly tarball: string; readonly manifestPath: string } {
  const source = path.join(root, `tiny-${name.replace(/[^a-z0-9]/giu, "-")}-${version.replace(/\./gu, "-")}`);
  const destination = path.join(root, "tiny-packs");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(destination, { recursive: true });
  const manifestPath = path.join(source, "package.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify({ name, version }, null, 2)}\n`, "utf8");
  return {
    tarball: packFilename(
      runNpm(["pack", source, "--json", "--ignore-scripts", "--pack-destination", destination], root),
      destination,
    ),
    manifestPath,
  };
}

function publicRegistryRunner(
  sourceTarball: string,
  metadataVersion: string,
  afterRun?: (args: readonly string[], result: { readonly code: number; readonly stdout: string; readonly stderr: string }) => void,
): (args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) => {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  const sourceBytes = fs.readFileSync(sourceTarball);
  const artifactSha512 = crypto.createHash("sha512").update(sourceBytes).digest("hex");
  return (args, cwd, env) => {
    let result: { readonly code: number; readonly stdout: string; readonly stderr: string };
    if (args[0] === "view") {
      result = {
        code: 0,
        stdout: JSON.stringify({
          name: "kcoderag-nav",
          version: metadataVersion,
          dist: {
            integrity: `sha512-${Buffer.from(artifactSha512, "hex").toString("base64")}`,
            tarball: `https://registry.npmjs.org/kcoderag-nav/-/kcoderag-nav-${metadataVersion}.tgz`,
          },
        }),
        stderr: "",
      };
    } else if (args[0] === "pack" && args[1]?.startsWith("kcoderag-nav@")) {
      const destination = args[args.indexOf("--pack-destination") + 1];
      assert.equal(typeof destination, "string");
      const filename = `kcoderag-nav-${metadataVersion}.tgz`;
      fs.copyFileSync(sourceTarball, path.join(destination as string, filename));
      result = { code: 0, stdout: JSON.stringify([{ filename }]), stderr: "" };
    } else {
      result = runNpmResult(args, cwd, env);
    }
    afterRun?.(args, result);
    return result;
  };
}

function runNpmResult(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): { readonly code: number; readonly stdout: string; readonly stderr: string } {
  const completed = process.platform === "win32"
    ? childProcess.spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...args], {
        cwd,
        env,
        encoding: "utf8",
        windowsHide: true,
      })
    : childProcess.spawnSync("npm", args, { cwd, env, encoding: "utf8" });
  return {
    code: completed.status ?? 1,
    stdout: typeof completed.stdout === "string" ? completed.stdout : "",
    stderr: typeof completed.stderr === "string" ? completed.stderr : "",
  };
}

async function postJson(url: string, payload: unknown): Promise<{ status: number; body?: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-private-header": "must-not-be-recorded" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return {
    status: response.status,
    ...(text.length === 0 ? {} : { body: JSON.parse(text) }),
  };
}

test("required contract has an explicit all-evidence PASS matrix", () => {
  assert.deepEqual(smoke.EVIDENCE_KEYS, [
    "packageAcquired",
    "preinstall",
    "install",
    "capabilityLifecycle",
    "qaOnly",
    "status",
    "doctor",
    "toolRegistration",
    "navigation",
    "mcpInitialize",
    "mcpList",
    "mcpCall",
    "update",
    "hostRuntime",
    "sourceConflict",
    "conflictInstallBlocked",
    "conflictUpdateBlocked",
    "conflictUninstallBlocked",
    "uninstall",
    "stubReceipt",
  ]);

  const passing = smoke.evaluateHostEvidence({
    host: "codex",
    mode: "required-contract",
    evidence: smoke.completeEvidence(),
  });
  assert.equal(passing.status, "PASS");
  assert.equal(passing.reason, "verified");
  assert.equal(passing.evidenceLevel, "PACKAGED");
  assert.equal(passing.stage, "evidence_integrity");
  assert.equal(passing.reasonCode, "none");
  assert.equal(passing.receipt.status, "PASS");
  assert.equal(passing.receipt.evidenceLevel, "PACKAGED");
  assert.equal((passing.receipt.observations as any).common.nativeHostProcess, false);
  assert.equal(smoke.smokeExitCode(passing), 0);

  for (const key of smoke.EVIDENCE_KEYS) {
    const evidence = smoke.completeEvidence({ [key]: false });
    const result = smoke.evaluateHostEvidence({
      host: "claude",
      mode: "required-contract",
      evidence,
    });
    assert.equal(result.status, "FAIL", `${key} must be required`);
    assert.equal(result.reason, "evidence_incomplete");
    assert.equal(smoke.smokeExitCode(result), 1);
  }

  const unavailable = smoke.evaluateHostEvidence({
    host: "cursor",
    mode: "required-contract",
    unavailableReason: "runner_unavailable",
  });
  assert.equal(unavailable.status, "NOT_RUN");
  assert.equal(unavailable.stage, "environment");
  assert.equal(unavailable.reasonCode, "runner_unavailable");
  assert.equal(smoke.smokeExitCode(unavailable), 1);
});

test("required CLI creates one local candidate lease before host smoke", async () => {
  let created = 0;
  let disposed = 0;
  const output: string[] = [];
  const lease: CandidatePackageArtifactLease = {
    artifact: {
      name: "kcoderag-nav",
      version: "0.3.0",
      sha256: "a".repeat(64),
      memberCount: 77,
      dryRunCount: 1,
      actualPackCount: 1,
    },
    dispose: () => { disposed += 1; },
  };
  const exitCode = await smoke.main(["--mode", "required-contract", "--host", "codex"], {
    createCandidatePackageArtifact: (options) => {
      created += 1;
      assert.equal(options.root, repositoryRoot);
      assert.deepEqual(options.consumers, ["host-smoke"]);
      return lease;
    },
    runHostSmoke: async (options) => {
      assert.equal(options.artifactLease, lease);
      assert.equal(options.repositoryRoot, repositoryRoot);
      assert.deepEqual(options.hosts, ["codex"]);
      return { schemaVersion: 1, mode: "required-contract", status: "PASS", hosts: [] };
    },
    stdout: (text) => output.push(text),
  });

  assert.equal(exitCode, 0);
  assert.equal(created, 1);
  assert.equal(disposed, 1);
  assert.deepEqual(JSON.parse(output.join("")), {
    schemaVersion: 1,
    mode: "required-contract",
    status: "PASS",
    hosts: [],
  });
});

test("optional live keeps NOT_RUN honest and never converts a failure into success", () => {
  const unavailable = smoke.evaluateHostEvidence({
    host: "codex",
    mode: "optional-live",
    unavailableReason: "host_cli_missing",
  });
  assert.equal(unavailable.status, "NOT_RUN");
  assert.equal(unavailable.reason, "host_cli_missing");
  assert.equal(smoke.smokeExitCode(unavailable), 0);

  const failed = smoke.evaluateHostEvidence({
    host: "claude",
    mode: "optional-live",
    evidence: smoke.completeEvidence({ mcpCall: false }),
    failureReason: "host_execution_failed",
  });
  assert.equal(failed.status, "FAIL");
  assert.equal(smoke.smokeExitCode(failed), 1);

  const passing = smoke.evaluateHostEvidence({
    host: "claude",
    mode: "optional-live",
    evidence: smoke.completeEvidence(),
  });
  assert.equal(passing.status, "PASS");
  assert.equal(smoke.smokeExitCode(passing), 0);

  const liveScope = smoke.evaluateHostEvidence({
    host: "codex",
    mode: "optional-live",
    evidence: smoke.completeEvidence({
      preinstall: false,
      capabilityLifecycle: false,
      doctor: false,
      sourceConflict: false,
      conflictInstallBlocked: false,
      conflictUpdateBlocked: false,
      conflictUninstallBlocked: false,
    }),
  });
  assert.equal(liveScope.status, "PASS");
  assert.equal(liveScope.evidence.sourceConflict, false);
});

test("live command specs support disposable non-git projects and require the MCP tool call", () => {
  const projectRoot = path.join("C:", "acceptance", "project");
  const codex = smoke.liveCommandSpec("codex", projectRoot);
  assert.equal(codex.executable, "codex");
  assert.ok(codex.args.includes("--skip-git-repo-check"));
  assert.ok(codex.args.includes("hooks"));
  assert.ok(!codex.args.includes("--ignore-user-config"));
  assert.ok(codex.args.includes("--dangerously-bypass-hook-trust"));
  assert.ok(!codex.args.includes("--approve-for-me"));
  assert.ok(!codex.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(codex.args.includes("--sandbox"));
  assert.ok(codex.args.includes("read-only"));
  assert.ok(codex.args.includes('approval_policy="never"'));
  assert.equal(codex.args.at(-1), smoke.LIVE_PROMPT);

  const claude = smoke.liveCommandSpec("claude", projectRoot);
  assert.equal(claude.executable, "kscc");
  assert.ok(claude.args.includes("--strict-mcp-config"));
  assert.ok(claude.args.includes("--include-hook-events"));
  assert.ok(claude.args.includes("--no-session-persistence"));
  assert.ok(claude.args.includes("--allowedTools"));
  assert.ok(claude.args.includes("mcp__kcoderag-qa__search_code,mcp__kcoderag_qa__search_code"));
  assert.ok(claude.args.includes(smoke.LIVE_PROMPT));

  const opencode = smoke.liveCommandSpec("opencode", projectRoot);
  assert.equal(opencode.executable, "opencode");
  assert.ok(opencode.args.includes(smoke.LIVE_PROMPT));
  assert.match(smoke.LIVE_PROMPT, /call[\s\S]*search_code[\s\S]*exactly once/iu);
  assert.match(smoke.LIVE_PROMPT, /do not inspect files or run shell commands/iu);
  assert.throws(() => smoke.liveCommandSpec("cursor", projectRoot), /headless_host_unsupported/u);
});

test("live smoke bypasses machine proxies for its loopback-only MCP transport", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-live-no-proxy-"));
  try {
    const environment = smoke.safeEnvironment(root);
    assert.equal(environment.NO_PROXY, "127.0.0.1,localhost");
    assert.equal(environment.no_proxy, "127.0.0.1,localhost");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("KSCC and OpenCode keep native login homes while declared caches remain isolated", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-live-kscc-env-"));
  try {
    const environment = smoke.liveEnvironment("claude", root);
    assert.equal(environment.CLAUDE_CONFIG_DIR, path.join(root, "host-home"));
    assert.equal(environment.LOCALAPPDATA, path.join(root, "local-app-data"));
    if (process.env.USERPROFILE !== undefined) assert.equal(environment.USERPROFILE, process.env.USERPROFILE);
    if (process.env.HOME !== undefined) assert.equal(environment.HOME, process.env.HOME);
    const openCodeEnvironment = smoke.liveEnvironment("opencode", root);
    if (process.env.USERPROFILE !== undefined) assert.equal(openCodeEnvironment.USERPROFILE, process.env.USERPROFILE);
    assert.equal(openCodeEnvironment.LOCALAPPDATA, path.join(root, "local-app-data"));
    assert.equal(openCodeEnvironment.XDG_CACHE_HOME, path.join(root, "xdg-cache"));
    const codexEnvironment = smoke.liveEnvironment("codex", root);
    if (process.platform === "win32") assert.equal(codexEnvironment.USERPROFILE, path.join(root, "host-home"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("live credential projection copies only bounded host material into the disposable home", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-live-credential-"));
  try {
    const sourceRoot = path.join(root, "source");
    const runtimeRoot = path.join(root, "runtime");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "auth.json"), "synthetic-auth", "utf8");
    fs.writeFileSync(path.join(sourceRoot, "opencode.json"), JSON.stringify({
      provider: { provider: { models: { model: {} }, options: { apiKey: "opaque" } } },
      plugin: ["must-not-copy"],
      instructions: ["must-not-copy"],
    }), "utf8");
    fs.writeFileSync(path.join(sourceRoot, "config.toml"), "must-not-copy", "utf8");

    assert.equal(smoke.projectLiveCredential("codex", runtimeRoot, sourceRoot), true);
    assert.equal(
      fs.readFileSync(path.join(runtimeRoot, "host-home", "auth.json"), "utf8"),
      "synthetic-auth",
    );
    assert.equal(fs.existsSync(path.join(runtimeRoot, "host-home", "config.toml")), false);
    assert.equal(smoke.projectLiveCredential("codex", runtimeRoot, sourceRoot), false);
    assert.equal(smoke.projectLiveCredential("opencode", runtimeRoot, sourceRoot), true);
    assert.equal(
      fs.readFileSync(path.join(runtimeRoot, "host-home", ".local", "share", "opencode", "auth.json"), "utf8"),
      "synthetic-auth",
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(runtimeRoot, "host-home", ".config", "opencode", "opencode.json"), "utf8")),
      { model: "provider/model", provider: { provider: { models: { model: {} }, options: { apiKey: "opaque" } } } },
    );

    const zcodeSourceRoot = path.join(root, "zcode-source");
    const zcodeRuntimeRoot = path.join(root, "zcode-runtime");
    fs.mkdirSync(zcodeSourceRoot, { recursive: true });
    fs.writeFileSync(path.join(zcodeSourceRoot, "credentials.json"), "encrypted-device-credential", "utf8");
    fs.writeFileSync(path.join(zcodeSourceRoot, "config.json"), "provider-configuration", "utf8");
    fs.writeFileSync(path.join(zcodeSourceRoot, "telemetry-state.json"), "must-not-copy", "utf8");
    assert.equal(smoke.projectLiveCredential("zcode", zcodeRuntimeRoot, zcodeSourceRoot), true);
    assert.equal(
      fs.readFileSync(path.join(zcodeRuntimeRoot, "host-home", ".zcode", "v2", "credentials.json"), "utf8"),
      "encrypted-device-credential",
    );
    assert.equal(
      fs.readFileSync(path.join(zcodeRuntimeRoot, "host-home", ".zcode", "v2", "config.json"), "utf8"),
      "provider-configuration",
    );
    assert.equal(
      fs.existsSync(path.join(zcodeRuntimeRoot, "host-home", ".zcode", "v2", "telemetry-state.json")),
      false,
    );

    const claudeSourceRoot = path.join(root, "claude-source");
    const claudeRuntimeRoot = path.join(root, "claude-runtime");
    fs.mkdirSync(claudeSourceRoot, { recursive: true });
    fs.writeFileSync(path.join(claudeSourceRoot, "settings.json"), JSON.stringify({
      BASE_API: "http://kscc.example.test/api",
      ksccModel: "claude-sonnet-4-5",
      env: { KSCC_AUTH_TOKEN: "synthetic-token", KSCC_AUTH_TOKEN_WORK: "must-not-copy" },
      hooks: { PreToolUse: [{ command: "must-not-copy" }] },
      plugins: { sentinel: true },
      permissions: { allow: ["must-not-copy"] },
    }), "utf8");
    assert.equal(smoke.projectLiveCredential("claude", claudeRuntimeRoot, claudeSourceRoot), true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(claudeRuntimeRoot, "host-home", "settings.json"), "utf8")),
      {
        BASE_API: "http://kscc.example.test/api",
        ksccModel: "claude-sonnet-4-5",
        env: { KSCC_AUTH_TOKEN: "synthetic-token" },
      },
    );
    assert.equal(smoke.projectLiveCredential("claude", claudeRuntimeRoot, claudeSourceRoot), false);

    const unsafeClaudeRoot = path.join(root, "unsafe-claude-source");
    fs.mkdirSync(unsafeClaudeRoot, { recursive: true });
    fs.writeFileSync(path.join(unsafeClaudeRoot, "settings.json"), JSON.stringify({
      BASE_API: "ftp://user:password@kscc.example.test/api?token=secret",
      ksccModel: "claude-sonnet-4-5",
      env: { KSCC_AUTH_TOKEN: "synthetic-token" },
    }), "utf8");
    assert.equal(smoke.projectLiveCredential("claude", path.join(root, "unsafe-runtime"), unsafeClaudeRoot), false);

    const oversizedRoot = path.join(root, "oversized");
    fs.mkdirSync(oversizedRoot, { recursive: true });
    fs.writeFileSync(path.join(oversizedRoot, "settings.json"), Buffer.alloc(64 * 1024 + 1));
    assert.equal(smoke.projectLiveCredential("claude", path.join(root, "oversized-runtime"), oversizedRoot), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex live config projection imports only the freshly installed managed MCP block", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-live-codex-config-"));
  try {
    const projectRoot = path.join(root, "project");
    const runtimeRoot = path.join(root, "runtime");
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    const managed = [
      "# BEGIN kcoderag-nav:kcoderag-navigation",
      "[mcp_servers.kcoderag-qa]",
      'url = "http://127.0.0.1:12345/mcp"',
      "# END kcoderag-nav:kcoderag-navigation",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(projectRoot, ".codex", "config.toml"), managed, "utf8");
    const managedHooks = `${JSON.stringify({ hooks: { PreToolUse: [], PostToolUse: [] } }, null, 2)}\n`;
    fs.writeFileSync(path.join(projectRoot, ".codex", "hooks.json"), managedHooks, "utf8");

    assert.equal(smoke.projectCodexLiveConfig(projectRoot, runtimeRoot), true);
    assert.equal(fs.readFileSync(path.join(runtimeRoot, "host-home", "config.toml"), "utf8"), managed);
    assert.equal(fs.readFileSync(path.join(runtimeRoot, "host-home", "hooks.json"), "utf8"), managedHooks);
    assert.equal(smoke.projectCodexLiveConfig(projectRoot, runtimeRoot), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("async live subprocess leaves the in-process loopback MCP server responsive", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-live-async-loopback-"));
  const receiptPath = path.join(root, "receipts.jsonl");
  const server = await stub.startStubMcpServer(receiptPath);
  try {
    const script = `
const url = ${JSON.stringify(server.url)};
const calls = [
  { id: 1, method: "initialize", params: { clientInfo: { name: "async-regression", version: "1" } } },
  { id: 2, method: "tools/list", params: {} },
  { id: 3, method: "tools/call", params: { name: "search_code", arguments: { query: "SyntheticSymbol" } } },
];
(async () => {
  for (const call of calls) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", ...call }) });
    if (!response.ok) process.exit(1);
    await response.json();
  }
})().catch(() => process.exit(1));
`;
    const result = await smoke.runProcessAsync(process.execPath, ["-e", script], {
      cwd: root,
      timeout: 10_000,
    });
    assert.equal(result.code, 0);
  } finally {
    await server.close();
  }
  assert.deepEqual(
    stub.readReceipts(receiptPath).map((receipt) => receipt.method),
    ["initialize", "tools/list", "tools/call"],
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("loopback stub performs initialize, list, and call with metadata-only receipts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-node-stub-"));
  const receiptPath = path.join(root, "receipts.jsonl");
  const server = await stub.startStubMcpServer(receiptPath);
  try {
    assert.match(server.url, /^http:\/\/localhost:\d+\/mcp$/u);
    const initialized = await postJson(server.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "contract-smoke", version: "1" } },
    });
    assert.equal(initialized.status, 200);
    assert.equal(initialized.body.result.serverInfo.name, "synthetic-loopback");

    const listed = await postJson(server.url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    assert.deepEqual(listed.body.result.tools.map((tool: { name: string }) => tool.name), [
      "search_code",
    ]);

    const called = await postJson(server.url, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "search_code", arguments: { query: "SyntheticSymbol" } },
    });
    assert.equal(called.body.result.isError, false);
  } finally {
    await server.close();
  }

  const receipts = stub.readReceipts(receiptPath);
  assert.deepEqual(
    receipts.map((receipt) => [receipt.method, receipt.toolName]),
    [["initialize", ""], ["tools/list", ""], ["tools/call", "search_code"]],
  );
  for (const receipt of receipts) {
    assert.deepEqual(Object.keys(receipt).sort(), ["method", "path", "requestId", "toolName"]);
    const serialized = JSON.stringify(receipt);
    assert.doesNotMatch(serialized, /arguments|headers|private|Bearer|SyntheticSymbol/iu);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("package acquisition failure occurs before any host project is created", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-acquire-first-"));
  try {
    const result = await smoke.runHostSmoke(
      {
        mode: "optional-live",
        packageSpec: "kcoderag-nav@0.0.0",
        temporaryRoot: root,
        hosts: ["codex", "claude", "cursor", "opencode", "zcode"],
      },
      {
        acquirePackage: async () => {
          throw new Error("synthetic acquisition failure with private detail");
        },
      },
    );
    assert.equal(result.status, "FAIL");
    assert.equal(result.hosts.every((host) => host.stage === "package" && host.reasonCode === "package_acquisition_failed"), true);
    assert.equal(smoke.smokeExitCode(result), 1);
    assert.deepEqual(fs.readdirSync(root), []);
    assert.doesNotMatch(JSON.stringify(result), /private detail|Bearer|Authorization/iu);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public acquisition strips inherited npm controls and rejects redirected or integrity-mismatched artifacts", async () => {
  const previousRegistry = process.env.NPM_CONFIG_REGISTRY;
  process.env.NPM_CONFIG_REGISTRY = "http://127.0.0.1:9/";
  try {
    for (const fixture of ["redirected", "wrong-version-url", "integrity-mismatch"] as const) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-public-boundary-"));
      let npmCalls = 0;
      try {
        const result = await smoke.runHostSmoke(
          {
            mode: "optional-live",
            packageSpec: "kcoderag-nav@1.2.3",
            temporaryRoot: root,
          },
          {
            runNpm: (args, _cwd, env) => {
              npmCalls += 1;
              assert.equal(env.npm_config_registry, "https://registry.npmjs.org/");
              assert.equal(Object.keys(env).some((key) => /^npm_config_/iu.test(key) && key !== key.toLowerCase()), false);
              for (const key of ["npm_config_userconfig", "npm_config_globalconfig"] as const) {
                assert.equal(typeof env[key], "string");
                assert.equal(fs.readFileSync(env[key] as string, "utf8"), "");
              }
              assert.ok(args.includes("--registry=https://registry.npmjs.org/"));
              if (args[0] === "view") {
                return {
                  code: 0,
                  stdout: JSON.stringify({
                    name: "kcoderag-nav",
                    version: "1.2.3",
                    dist: {
                      integrity: `sha512-${Buffer.alloc(64, 7).toString("base64")}`,
                      tarball: fixture === "redirected"
                        ? "https://registry.example.invalid/kcoderag-nav/-/kcoderag-nav-1.2.3.tgz"
                        : fixture === "wrong-version-url"
                          ? "https://registry.npmjs.org/kcoderag-nav/-/kcoderag-nav-1.2.4.tgz"
                          : "https://registry.npmjs.org/kcoderag-nav/-/kcoderag-nav-1.2.3.tgz",
                    },
                  }),
                  stderr: "",
                };
              }
              if (args[0] === "pack") {
                const destinationArg = args[args.indexOf("--pack-destination") + 1];
                assert.equal(typeof destinationArg, "string");
                const filename = "kcoderag-nav-1.2.3.tgz";
                fs.writeFileSync(path.join(destinationArg as string, filename), "not the registry artifact", "utf8");
                return { code: 0, stdout: JSON.stringify([{ filename }]), stderr: "" };
              }
              throw new Error("public acquisition must fail before installation");
            },
          },
        );
        assert.equal(result.status, "FAIL", fixture);
        assert.equal(result.provenance, undefined, fixture);
        assert.equal(fs.existsSync(path.join(root, "projects")), false, fixture);
        assert.equal(npmCalls, fixture === "integrity-mismatch" ? 2 : 1, fixture);
        assert.doesNotMatch(JSON.stringify(result), /127\.0\.0\.1|registry\.example|integrity|npmrc/iu);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  } finally {
    if (previousRegistry === undefined) delete process.env.NPM_CONFIG_REGISTRY;
    else process.env.NPM_CONFIG_REGISTRY = previousRegistry;
  }
});

test("public registry artifact drift during npm install fails before any host project write", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-registry-install-drift-"));
  let replaced = false;
  try {
    const fixture = packTinyFixture(root, "kcoderag-nav", "1.2.3");
    const result = await smoke.runHostSmoke(
      {
        mode: "optional-live",
        packageSpec: "kcoderag-nav@1.2.3",
        expectedVersion: "1.2.3",
        temporaryRoot: root,
      },
      {
        runNpm: publicRegistryRunner(fixture.tarball, "1.2.3", (args) => {
          if (!replaced && args[0] === "install") {
            const invocationTarball = args[args.length - 1];
            assert.equal(typeof invocationTarball, "string");
            assert.match(path.basename(invocationTarball as string), /^[a-f0-9]{64}\.tgz$/u);
            const bytes = fs.readFileSync(invocationTarball as string);
            bytes[9] = (bytes[9] ?? 0) ^ 1;
            fs.writeFileSync(invocationTarball as string, bytes);
            replaced = true;
          }
        }),
      },
    );
    assert.equal(replaced, true);
    assert.equal(result.status, "FAIL");
    assert.equal(result.provenance, undefined);
    assert.equal(fs.existsSync(path.join(root, "projects")), false);
    assert.doesNotMatch(JSON.stringify(result), /registry-install-drift|verified-artifacts|node_modules/iu);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("required readiness rejects exact and latest candidates before public acquisition", async () => {
  for (const packageSpec of ["kcoderag-nav@1.2.3", "kcoderag-nav@latest"] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-readiness-local-only-"));
    let npmCalls = 0;
    try {
      const result = await smoke.runHostSmoke(
        {
          mode: "required-contract",
          packageSpec,
          expectedVersion: "1.2.3",
          temporaryRoot: root,
        },
        {
          runNpm: () => {
            npmCalls += 1;
            throw new Error("required readiness must not acquire a registry candidate");
          },
        },
      );
      assert.equal(result.status, "FAIL");
      assert.equal(smoke.smokeExitCode(result), 1);
      assert.equal(result.provenance, undefined);
      assert.equal(npmCalls, 0);
      assert.deepEqual(fs.readdirSync(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("readiness artifact drives all five packaged hosts from the same injected SHA and member count", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-readiness-hosts-"));
  const lease = releaseReadiness.createCandidatePackageArtifact({
    root: repositoryRoot,
    consumers: ["pack-audit", "tar-scan", "host-smoke"],
  });
  const artifact = { ...lease.artifact };
  const observed: Buffer[] = [];
  const invocationPaths = new Set<string>();
  const npmCachePaths = new Set<string>();
  try {
    const packed = packAudit.auditPackArtifact(lease, { root: repositoryRoot }, {
      observeCandidateBytes: (bytes) => { observed.push(bytes); },
    });
    const scanned = releaseReadiness.scanCandidatePackageArtifact(lease, {
      observeCandidateBytes: (bytes) => { observed.push(bytes); },
      scanTarball: ({ expectedSha256 }) => Object.freeze({
        schemaVersion: 1,
        scope: "tar",
        artifactSha256: expectedSha256,
        memberCount: artifact.memberCount,
        scannedCount: artifact.memberCount,
        findingCount: 0,
        findings: Object.freeze([]),
      }),
    });
    assert.equal(packed.artifactSha256, artifact.sha256);
    assert.equal(scanned.artifactSha256, artifact.sha256);
    const result = await smoke.runHostSmoke({
      mode: "required-contract",
      artifactLease: lease,
      temporaryRoot: root,
      hosts: ["codex", "claude", "cursor", "opencode", "zcode"],
    }, {
      observeCandidateBytes: (bytes) => { observed.push(bytes); },
      runNpm: (args, cwd, env) => {
        if (args[0] === "exec") {
          const packageArgument = args.find((arg) => arg.startsWith("--package="));
          assert.equal(typeof packageArgument, "string");
          const invocationPath = (packageArgument as string).slice("--package=".length);
          assert.match(path.basename(invocationPath), /^[a-f0-9]{64}\.tgz$/u);
          invocationPaths.add(invocationPath);
          assert.equal(typeof env.npm_config_cache, "string");
          npmCachePaths.add(env.npm_config_cache as string);
        }
        return runNpmResult(args, cwd, env);
      },
    });
    assert.equal(result.status, "PASS", JSON.stringify(result));
    assert.equal(observed.length, 3);
    assert.equal(observed[0], observed[1]);
    assert.equal(observed[1], observed[2]);
    assert.equal(crypto.createHash("sha256").update(observed[0] ?? Buffer.alloc(0)).digest("hex"), artifact.sha256);
    assert.deepEqual(result.provenance, {
      requestedPackageSpec: "readiness-artifact",
      expectedVersion: artifact.version,
      resolvedPackageName: "kcoderag-nav",
      resolvedVersion: artifact.version,
      lifecycleTarballSha256: artifact.sha256,
      artifactMemberCount: artifact.memberCount,
    });
    assert.equal(result.hosts.length, 5);
    assert.equal(invocationPaths.size, 1);
    assert.equal(npmCachePaths.size, 1);
    for (const host of result.hosts) {
      assert.equal(host.status, "PASS", host.host);
      assert.equal(host.provenance, result.provenance);
      assert.equal(host.runtimeContract?.layer, "packaged");
      if (host.host === "cursor") {
        assert.equal(host.runtimeContract?.kind, "cursor_events");
        assert.equal(host.runtimeContract?.hookEvent, true);
        assert.equal(host.runtimeContract?.successMarker, true);
        assert.equal(host.runtimeContract?.updateNotice, false);
        assert.equal(host.runtimeContract?.updateRefresh, false);
      }
      if (host.host === "claude") {
        assert.equal(host.capabilityLifecycle?.branch, "supported");
        assert.equal(host.capabilityLifecycle?.hostVersion, "2.1.241");
      } else {
        assert.deepEqual(host.capabilityLifecycle, {
          schemaVersion: 1,
          branch: "unsupported",
          hostVersion: host.host === "codex"
            ? "0.146.1"
            : host.host === "cursor"
              ? "3.17.8"
              : host.host === "opencode"
                ? "1.18.23"
                : "0.0.0",
          navigationInstalled: true,
          refusalCode: "host_version_unsupported",
          zeroWrite: true,
          navigationPreserved: true,
        });
      }
    }
    assert.equal("publicRegistryArtifact" in (result.provenance ?? {}), false);
    assert.doesNotMatch(JSON.stringify(result), /registry\.npmjs|resolvedTarballUrl|workspaceTrust(?:Value|Body)|admission(?:Payload|Body)/iu);
  } finally {
    lease.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public specifier validation fails before acquisition or host project writes", async () => {
  const invalidSpecs = [
    "kcoderag-nav@01.2.3",
    "kcoderag-nav@1.02.3",
    "kcoderag-nav@1.2.03",
    `kcoderag-nav@1.${"9".repeat(65)}.3`,
    "kcoderag-nav@ 1.2.3",
    "kcoderag-nav@1.2.3 ",
    "kcoderag-nav@1.2.3-beta.1",
    "kcoderag-nav@^1.2.3",
    "kcoderag-nav@~1.2.3",
    "kcoderag-nav@>=1.2.3",
    "kcoderag-nav@next",
    "alias@npm:kcoderag-nav@1.2.3",
    "other-package@1.2.3",
    "https://example.invalid/package.tgz",
    ".",
  ];
  for (const packageSpec of invalidSpecs) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-invalid-spec-"));
    let acquisitions = 0;
    try {
      const result = await smoke.runHostSmoke(
        { mode: "optional-live", packageSpec, expectedVersion: "1.2.3", temporaryRoot: root },
        {
          acquirePackage: async () => {
            acquisitions += 1;
            throw new Error("must not run");
          },
        },
      );
      assert.equal(result.status, "FAIL", packageSpec);
      assert.equal(smoke.smokeExitCode(result), 1);
      assert.equal(acquisitions, 0, packageSpec);
      assert.deepEqual(fs.readdirSync(root), [], packageSpec);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("public expected-version rules reject exact disagreement and latest omission before acquisition", async () => {
  for (const input of [
    { packageSpec: "kcoderag-nav@1.2.3", expectedVersion: "1.2.4" },
    { packageSpec: "kcoderag-nav@latest", expectedVersion: undefined },
    { packageSpec: "kcoderag-nav@latest", expectedVersion: "1.2.3-beta.1" },
    { packageSpec: "kcoderag-nav@latest", expectedVersion: "01.2.3" },
    { packageSpec: "kcoderag-nav@latest", expectedVersion: `1.${"9".repeat(65)}.3` },
    { packageSpec: "kcoderag-nav@latest", expectedVersion: " 1.2.3" },
  ] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-invalid-expected-"));
    let acquisitions = 0;
    try {
      const result = await smoke.runHostSmoke(
        {
          mode: "optional-live",
          packageSpec: input.packageSpec,
          ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
          temporaryRoot: root,
        },
        { acquirePackage: async () => { acquisitions += 1; throw new Error("must not run"); } },
      );
      assert.equal(result.status, "FAIL");
      assert.equal(acquisitions, 0);
      assert.deepEqual(fs.readdirSync(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("real installed manifests reject exact mismatches, latest races, and wrong package identity before host writes", async () => {
  const cases = [
    { name: "exact mismatch", packageSpec: "kcoderag-nav@1.2.3", packageName: "kcoderag-nav", manifestVersion: "1.2.4" },
    { name: "latest previous", packageSpec: "kcoderag-nav@latest", packageName: "kcoderag-nav", manifestVersion: "1.2.2" },
    { name: "latest next", packageSpec: "kcoderag-nav@latest", packageName: "kcoderag-nav", manifestVersion: "1.2.4" },
    { name: "wrong name", packageSpec: "kcoderag-nav@1.2.3", packageName: "not-kcoderag-nav", manifestVersion: "1.2.3" },
  ] as const;

  for (const fixture of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-manifest-fixture-"));
    try {
      const packedFixture = packTinyFixture(root, fixture.packageName, fixture.manifestVersion);
      assert.deepEqual(JSON.parse(fs.readFileSync(packedFixture.manifestPath, "utf8")), {
        name: fixture.packageName,
        version: fixture.manifestVersion,
      });
      const result = await smoke.runHostSmoke(
        {
          mode: "optional-live",
          packageSpec: fixture.packageSpec,
          expectedVersion: "1.2.3",
          temporaryRoot: root,
        },
        { runNpm: publicRegistryRunner(packedFixture.tarball, "1.2.3") },
      );
      assert.equal(result.status, "FAIL", fixture.name);
      assert.equal(result.provenance, undefined, fixture.name);
      assert.equal(fs.existsSync(path.join(root, "projects")), false, fixture.name);
      assert.doesNotMatch(JSON.stringify(result), /not-kcoderag-nav|1\.2\.2|1\.2\.4|manifest-fixture/iu);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("every host fails when the leased content-addressed tarball is replaced after execution", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-invocation-drift-"));
  const lease = releaseReadiness.createCandidatePackageArtifact({
    root: repositoryRoot,
    consumers: ["host-smoke"],
  });
  let replaced = false;
  try {
    const result = await smoke.runHostSmoke(
      {
        mode: "required-contract",
        artifactLease: lease,
        temporaryRoot: root,
        hosts: ["codex", "claude", "cursor", "opencode", "zcode"],
      },
      {
        runNpm: (args, cwd, env) => {
          const result = runNpmResult(args, cwd, env);
          if (!replaced && args[0] === "exec") {
            const packageArgument = args.find((arg) => arg.startsWith("--package="));
            assert.equal(typeof packageArgument, "string");
            const invocationTarball = (packageArgument as string).slice("--package=".length);
            assert.match(path.basename(invocationTarball), /^[a-f0-9]{64}\.tgz$/u);
            const bytes = fs.readFileSync(invocationTarball);
            bytes[9] = (bytes[9] ?? 0) ^ 1;
            fs.writeFileSync(invocationTarball, bytes);
            replaced = true;
          }
          return result;
        },
      },
    );
    assert.equal(replaced, true);
    assert.equal(result.status, "FAIL", JSON.stringify(result));
    assert.equal(result.hosts.every((host) => host.status === "FAIL"), true);
    assert.equal(result.hosts.every((host) => host.reason === "artifact_integrity_failed"), true);
    assert.equal(smoke.smokeExitCode(result), 1);
    assert.doesNotMatch(JSON.stringify(result), /verified-artifacts|node_modules|invocation-drift/iu);
  } finally {
    lease.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
