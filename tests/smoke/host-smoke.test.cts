const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");

type HostId = "codex" | "claude" | "cursor";
type SmokeMode = "required-contract" | "optional-live";
type SmokeStatus = "PASS" | "FAIL" | "NOT_RUN";

interface SmokeEvidence {
  readonly packageAcquired: boolean;
  readonly install: boolean;
  readonly status: boolean;
  readonly toolRegistration: boolean;
  readonly navigation: boolean;
  readonly mcpInitialize: boolean;
  readonly mcpList: boolean;
  readonly mcpCall: boolean;
  readonly update: boolean;
  readonly uninstall: boolean;
  readonly stubReceipt: boolean;
}

interface HostSmokeResult {
  readonly schemaVersion: 1;
  readonly host: HostId;
  readonly mode: SmokeMode;
  readonly status: SmokeStatus;
  readonly reason: string;
  readonly evidence: SmokeEvidence;
  readonly provenance?: PackageProvenance;
}

interface PackageProvenance {
  readonly requestedPackageSpec: string;
  readonly expectedVersion: string;
  readonly resolvedPackageName: "kcoderag-nav";
  readonly resolvedVersion: string;
  readonly lifecycleTarballSha256: string;
  readonly publicRegistryArtifact?: {
    readonly registry: "https://registry.npmjs.org/";
    readonly resolvedTarballUrl: string;
    readonly distIntegrity: string;
    readonly artifactSha256: string;
    readonly artifactSha512: string;
  };
}

interface AcquiredPackage extends PackageProvenance {
  readonly lifecyclePackageSpec: string;
}

interface SmokeModule {
  readonly EVIDENCE_KEYS: readonly (keyof SmokeEvidence)[];
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
  runHostSmoke(options: {
    readonly mode: SmokeMode;
    readonly packageSpec: string;
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
  }): Promise<{
    readonly schemaVersion: 1;
    readonly mode: SmokeMode;
    readonly status: SmokeStatus;
    readonly provenance?: PackageProvenance;
    readonly hosts: readonly HostSmokeResult[];
  }>;
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

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function writeSyntheticMcpSources(packageRoot: string, stubUrl: string): void {
  for (const environment of ["qa", "dev"] as const) {
    const name = `kcoderag-${environment}`;
    const httpEntry = {
      type: "http",
      url: stubUrl,
      headers: { Authorization: "Bearer synthetic-contract-only" },
    };
    fs.writeFileSync(
      path.join(packageRoot, name, ".mcp.json"),
      `${JSON.stringify({ mcpServers: { [name]: httpEntry } }, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(packageRoot, name, ".codex.mcp.json"),
      `${JSON.stringify({ [name]: {
        url: stubUrl,
        http_headers: { Authorization: "Bearer synthetic-contract-only" },
      } }, null, 2)}\n`,
      "utf8",
    );
  }
}

function syntheticAcquisition(
  requestedPackageSpec: string,
  expectedVersion: string,
  root: string,
  stubUrl: string,
  repositoryRoot: string,
): AcquiredPackage {
  const sourcePack = path.join(root, "fixture-source-pack");
  fs.mkdirSync(sourcePack, { recursive: true });
  const sourceTarball = packFilename(
    runNpm(["pack", repositoryRoot, "--json", "--ignore-scripts", "--pack-destination", sourcePack], root),
    sourcePack,
  );
  const installRoot = path.join(root, "fixture-acquired");
  fs.mkdirSync(installRoot, { recursive: true });
  runNpm([
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false",
    "--prefix", installRoot, sourceTarball,
  ], root);
  const packageRoot = path.join(installRoot, "node_modules", "kcoderag-nav");
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    readonly name: "kcoderag-nav";
  };
  const sourceBytes = fs.readFileSync(sourceTarball);
  const artifactSha512 = crypto.createHash("sha512").update(sourceBytes).digest("hex");
  writeSyntheticMcpSources(packageRoot, stubUrl);
  const syntheticPack = path.join(root, "fixture-synthetic-pack");
  fs.mkdirSync(syntheticPack, { recursive: true });
  const lifecyclePackageSpec = packFilename(
    runNpm(["pack", packageRoot, "--json", "--ignore-scripts", "--pack-destination", syntheticPack], root),
    syntheticPack,
  );
  return {
    requestedPackageSpec,
    expectedVersion,
    resolvedPackageName: manifest.name,
    resolvedVersion: expectedVersion,
    lifecycleTarballSha256: sha256(lifecyclePackageSpec),
    lifecyclePackageSpec,
    publicRegistryArtifact: {
      registry: "https://registry.npmjs.org/",
      resolvedTarballUrl: `https://registry.npmjs.org/kcoderag-nav/-/kcoderag-nav-${expectedVersion}.tgz`,
      distIntegrity: `sha512-${Buffer.from(artifactSha512, "hex").toString("base64")}`,
      artifactSha256: crypto.createHash("sha256").update(sourceBytes).digest("hex"),
      artifactSha512,
    },
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
  ]);

  const passing = smoke.evaluateHostEvidence({
    host: "codex",
    mode: "required-contract",
    evidence: smoke.completeEvidence(),
  });
  assert.equal(passing.status, "PASS");
  assert.equal(passing.reason, "verified");
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
    unavailableReason: "package_unavailable",
  });
  assert.equal(unavailable.status, "NOT_RUN");
  assert.equal(smoke.smokeExitCode(unavailable), 1);
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
});

test("loopback stub performs initialize, list, and call with metadata-only receipts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-node-stub-"));
  const receiptPath = path.join(root, "receipts.jsonl");
  const server = await stub.startStubMcpServer(receiptPath);
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/u);
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
        mode: "required-contract",
        packageSpec: "kcoderag-nav@0.0.0",
        temporaryRoot: root,
        hosts: ["codex", "claude", "cursor"],
      },
      {
        acquirePackage: async () => {
          throw new Error("synthetic acquisition failure with private detail");
        },
      },
    );
    assert.equal(result.status, "NOT_RUN");
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
    for (const fixture of ["redirected", "integrity-mismatch"] as const) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-public-boundary-"));
      let npmCalls = 0;
      try {
        const result = await smoke.runHostSmoke(
          {
            mode: "required-contract",
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
        assert.equal(result.status, "NOT_RUN", fixture);
        assert.equal(result.provenance, undefined, fixture);
        assert.equal(fs.existsSync(path.join(root, "projects")), false, fixture);
        assert.equal(npmCalls, fixture === "redirected" ? 1 : 2, fixture);
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

test("exact and latest preserve acquired-manifest and synthetic-tarball provenance across all hosts", async () => {
  for (const requestedPackageSpec of ["kcoderag-nav@1.2.3", "kcoderag-nav@latest"] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-provenance-happy-"));
    try {
      let mutableAcquisition: AcquiredPackage | undefined;
      const result = await smoke.runHostSmoke(
        {
          mode: "required-contract",
          packageSpec: requestedPackageSpec,
          ...(requestedPackageSpec === "kcoderag-nav@latest" ? { expectedVersion: "1.2.3" } : {}),
          temporaryRoot: root,
          hosts: ["codex", "claude", "cursor"],
        },
        {
          acquirePackage: async (normalizedSpec, temporaryRoot, stubUrl, repositoryRoot, expectedVersion) => {
            assert.equal(normalizedSpec, requestedPackageSpec);
            assert.equal(expectedVersion, "1.2.3");
            const acquired = syntheticAcquisition(
              requestedPackageSpec,
              "1.2.3",
              temporaryRoot,
              stubUrl,
              repositoryRoot,
            );
            mutableAcquisition = acquired;
            setTimeout(() => {
              (acquired as { expectedVersion: string }).expectedVersion = "9.9.9";
            }, 0);
            return acquired;
          },
        },
      );
      assert.equal(result.status, "PASS", JSON.stringify(result));
      assert.deepEqual(result.provenance, {
        requestedPackageSpec,
        expectedVersion: "1.2.3",
        resolvedPackageName: "kcoderag-nav",
        resolvedVersion: "1.2.3",
        lifecycleTarballSha256: result.provenance?.lifecycleTarballSha256,
        publicRegistryArtifact: result.provenance?.publicRegistryArtifact,
      });
      assert.match(result.provenance?.lifecycleTarballSha256 ?? "", /^[a-f0-9]{64}$/u);
      assert.equal(Object.isFrozen(result.provenance), true);
      assert.equal(mutableAcquisition?.expectedVersion, "9.9.9");
      for (const host of result.hosts) {
        assert.equal(host.status, "PASS");
        assert.equal(host.provenance, result.provenance);
        assert.deepEqual(host.evidence, smoke.completeEvidence());
      }
      const serialized = JSON.stringify(result);
      assert.doesNotMatch(serialized, /fixture-|node_modules|synthetic-pack|Authorization|Bearer/iu);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("public specifier validation fails before acquisition or host project writes", async () => {
  const invalidSpecs = [
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
        { mode: "required-contract", packageSpec, expectedVersion: "1.2.3", temporaryRoot: root },
        {
          acquirePackage: async () => {
            acquisitions += 1;
            throw new Error("must not run");
          },
        },
      );
      assert.equal(result.status, "NOT_RUN", packageSpec);
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
  ] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-invalid-expected-"));
    let acquisitions = 0;
    try {
      const result = await smoke.runHostSmoke(
        {
          mode: "required-contract",
          packageSpec: input.packageSpec,
          ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
          temporaryRoot: root,
        },
        { acquirePackage: async () => { acquisitions += 1; throw new Error("must not run"); } },
      );
      assert.equal(result.status, "NOT_RUN");
      assert.equal(acquisitions, 0);
      assert.deepEqual(fs.readdirSync(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("acquired identity, latest races, missing provenance, and tarball digest drift fail before host writes", async () => {
  const cases: readonly {
    readonly name: string;
    readonly packageSpec: string;
    readonly mutate: (acquired: AcquiredPackage) => unknown;
  }[] = [
    {
      name: "exact installed-manifest mismatch",
      packageSpec: "kcoderag-nav@1.2.3",
      mutate: (acquired) => ({ ...acquired, resolvedVersion: "1.2.4" }),
    },
    {
      name: "latest acquired previous version",
      packageSpec: "kcoderag-nav@latest",
      mutate: (acquired) => ({ ...acquired, resolvedVersion: "1.2.2" }),
    },
    {
      name: "latest acquired next version",
      packageSpec: "kcoderag-nav@latest",
      mutate: (acquired) => ({ ...acquired, resolvedVersion: "1.2.4" }),
    },
    {
      name: "wrong acquired package name",
      packageSpec: "kcoderag-nav@1.2.3",
      mutate: (acquired) => ({ ...acquired, resolvedPackageName: "not-kcoderag-nav" }),
    },
    {
      name: "missing provenance",
      packageSpec: "kcoderag-nav@1.2.3",
      mutate: (acquired) => ({ lifecyclePackageSpec: acquired.lifecyclePackageSpec }),
    },
    {
      name: "synthetic tgz digest mismatch",
      packageSpec: "kcoderag-nav@1.2.3",
      mutate: (acquired) => ({ ...acquired, lifecycleTarballSha256: "0".repeat(64) }),
    },
  ];

  for (const fixture of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-provenance-fail-"));
    try {
      const tarball = path.join(root, "synthetic.tgz");
      fs.writeFileSync(tarball, "synthetic tarball bytes", "utf8");
      const acquired: AcquiredPackage = {
        requestedPackageSpec: fixture.packageSpec,
        expectedVersion: "1.2.3",
        resolvedPackageName: "kcoderag-nav",
        resolvedVersion: "1.2.3",
        lifecycleTarballSha256: sha256(tarball),
        lifecyclePackageSpec: tarball,
      };
      const result = await smoke.runHostSmoke(
        {
          mode: "required-contract",
          packageSpec: fixture.packageSpec,
          expectedVersion: "1.2.3",
          temporaryRoot: root,
        },
        { acquirePackage: async () => fixture.mutate(acquired) as AcquiredPackage },
      );
      assert.equal(result.status, "NOT_RUN", fixture.name);
      assert.equal(result.provenance, undefined, fixture.name);
      assert.equal(fs.existsSync(path.join(root, "projects")), false, fixture.name);
      assert.doesNotMatch(JSON.stringify(result), /not-kcoderag-nav|1\.2\.2|1\.2\.4|synthetic\.tgz/iu);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("every host fails when a per-command content-addressed tarball is replaced after execution", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-invocation-drift-"));
  const version = (JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as { version: string }).version;
  let replaced = false;
  try {
    const result = await smoke.runHostSmoke(
      {
        mode: "required-contract",
        packageSpec: `kcoderag-nav@${version}`,
        expectedVersion: version,
        temporaryRoot: root,
        hosts: ["codex", "claude", "cursor"],
      },
      {
        acquirePackage: async (requestedPackageSpec, temporaryRoot, stubUrl, repoRoot, expectedVersion) =>
          syntheticAcquisition(
            requestedPackageSpec,
            expectedVersion as string,
            temporaryRoot,
            stubUrl,
            repoRoot,
          ),
        runNpm: (args, cwd, env) => {
          const completed = runNpmResult(args, cwd, env);
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
          return completed;
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
    fs.rmSync(root, { recursive: true, force: true });
  }
});
