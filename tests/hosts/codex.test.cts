const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor" | "opencode";

interface HostAdapter {
  readonly id: HostId;
  detect(context: Record<string, unknown>): Record<string, unknown>;
  renderInstall(context: Record<string, unknown>): Record<string, unknown>;
  renderUninstall(context: Record<string, unknown>): Record<string, unknown>;
  scanUserSources?(context: Record<string, unknown>): Promise<Record<string, any>>;
}

interface CodexModule {
  readonly codexAdapter: HostAdapter;
  createCodexAdapter(options?: Record<string, unknown>): HostAdapter;
}

interface CommandModule {
  executeCommand(argv: string[], dependencies: Record<string, unknown>): Promise<number>;
}

interface TransactionModule {
  applyTransaction(
    desired: Record<string, unknown>,
    options?: { readonly failAtCommit?: number },
  ): unknown;
}

const codex = require("../../dist/hosts/codex.cjs") as CodexModule;
const commands = require("../../dist/cli/commands.cjs") as CommandModule;
const transaction = require("../../dist/core/transaction.cjs") as TransactionModule;

const STATE_PATH = ".codex/kcoderag-nav/install-state.json";

type NativeRequest = Readonly<{ executable: string; args: readonly string[]; timeoutMs: number }>;
type NativeResult = Readonly<{
  exitCode: number;
  timedOut: boolean;
  stdout?: string;
  failureAttribution?: string;
}>;

const EMPTY_PLUGIN_INVENTORY = JSON.stringify({ installed: [], available: [] });
const EMPTY_MARKETPLACE_INVENTORY = JSON.stringify({ marketplaces: [] });

function healthyNativeResult(request: NativeRequest): NativeResult {
  const command = [request.executable, ...request.args].join(" ");
  if (command === "codex --version") {
    return { exitCode: 0, timedOut: false, stdout: "codex-cli 0.146.1\n" };
  }
  if (command.endsWith(" --help")) {
    return {
      exitCode: 0,
      timedOut: false,
      stdout: command.includes("marketplace remove")
        ? "Usage: codex plugin marketplace remove <MARKETPLACE_NAME> --json"
        : command.includes("plugin remove")
          ? "Usage: codex plugin remove <PLUGIN[@MARKETPLACE]> --json"
          : "Usage: list --json",
    };
  }
  if (command === "codex plugin list --json") {
    return { exitCode: 0, timedOut: false, stdout: EMPTY_PLUGIN_INVENTORY };
  }
  if (command === "codex plugin marketplace list --json") {
    return { exitCode: 0, timedOut: false, stdout: EMPTY_MARKETPLACE_INVENTORY };
  }
  return { exitCode: 0, timedOut: false, stdout: "{}" };
}

const testAdapter = codex.createCodexAdapter({
  runner: async (request: NativeRequest) => healthyNativeResult(request),
  readUserSources: () => ({
    registrations: [],
    rawMcpPaths: [],
    manualHookPaths: [],
    cachePaths: [],
    ambiguousPaths: [],
  }),
});

function write(root: string, relativePath: string, value: string | Buffer): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, value);
}

function packageFixture(base: string): { readonly root: string; readonly secret: string } {
  const root = path.join(base, "package");
  const secret = `opaque-${crypto.randomUUID()}`;
  write(root, "package.json", `${JSON.stringify({ name: "kcoderag-nav", version: "0.1.4" })}\n`);
  for (const environment of ["qa"] as const) {
    const packageName = `kcoderag-${environment}`;
    write(
      root,
      `${packageName}/.codex.mcp.json`,
      `${JSON.stringify({
        mcpServers: {
          [packageName]: {
            url: `https://${environment}.invalid/mcp`,
            http_headers: { Authorization: `Bearer ${secret}-${environment}` },
          },
        },
      })}\n`,
    );
    for (const asset of [
      "grep-nudge.cjs",
      "mcp-call-marker.cjs",
      "update-check.cjs",
      "update-notice.cjs",
      "update-worker.cjs",
      "run_hook.cmd",
      "run_hook.sh",
      "run_marker.cmd",
      "run_marker.sh",
    ]) {
      write(root, `${packageName}/hooks/${asset}`, `${environment}:${asset}\n`);
    }
    write(
      root,
      `${packageName}/skills/code-lookup-discipline/SKILL.md`,
      `# ${environment.toUpperCase()} lookup\n`,
    );
  }
  return { root, secret };
}

function targetFixture(base: string, name = "target"): {
  readonly root: string;
  readonly config: Buffer;
  readonly hooks: Buffer;
} {
  const root = path.join(base, name);
  fs.mkdirSync(root);
  const config = Buffer.from("# unrelated\n[features]\nexisting = true\n", "utf8");
  const hooks = Buffer.from(
    `${JSON.stringify({ hooks: { Stop: [{ matcher: "*", hooks: [] }] }, unrelated: true }, null, 4)}\n`,
    "utf8",
  );
  write(root, ".codex/config.toml", config);
  write(root, ".codex/hooks.json", hooks);
  write(root, "ordinary.bin", Buffer.from([0, 1, 2, 3]));
  return { root, config, hooks };
}

function snapshot(root: string): readonly string[] {
  const records: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        records.push(`d:${relative}`);
        visit(absolute);
      } else if (entry.isSymbolicLink()) {
        records.push(`l:${relative}:${fs.readlinkSync(absolute)}`);
      } else {
        const digest = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
        records.push(`f:${relative}:${digest}`);
      }
    }
  };
  visit(root);
  return records;
}

function io(target: string, packageRoot: string, adapter: HostAdapter = testAdapter): {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly dependencies: Record<string, unknown>;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    dependencies: {
      cwd: target,
      packageRoot,
      nodeVersion: "22.20.0",
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
      getAdapter: (host: HostId) => {
        if (host !== "codex") throw new Error("unexpected host");
        return adapter;
      },
    },
  };
}

async function run(
  target: string,
  packageRoot: string,
  command: "install" | "status" | "doctor" | "update" | "uninstall",
  allowLegacyDevMigration = false,
  adapter: HostAdapter = testAdapter,
) {
  const captured = io(target, packageRoot, adapter);
  const argv = [command, "--host", "codex", "--json"];
  if (command === "install" || command === "update" || command === "uninstall") argv.push("--yes");
  if (allowLegacyDevMigration) argv.push("--allow-legacy-dev-migration");
  const exitCode = await commands.executeCommand(argv, captured.dependencies);
  return {
    ...captured,
    exitCode,
    output: JSON.parse(captured.stdout[0] ?? "{}") as Record<string, unknown>,
  };
}

test("Codex QA lifecycle is idempotent, reports health, and restores unrelated bytes", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-life-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const installed = await run(target.root, pkg.root, "install");
    assert.equal(installed.exitCode, 0);
    assert.equal(installed.output.environment, "qa");
    assert.doesNotMatch(installed.stdout.join("\n") + installed.stderr.join("\n"), new RegExp(pkg.secret));
    const firstTree = snapshot(target.root);

    const statusBefore = snapshot(target.root);
    const status = await run(target.root, pkg.root, "status");
    const doctor = await run(target.root, pkg.root, "doctor");
    assert.equal(status.output.status, "healthy");
    assert.equal(doctor.output.status, "healthy");
    assert.deepEqual(snapshot(target.root), statusBefore);

    assert.equal((await run(target.root, pkg.root, "install")).exitCode, 0);
    assert.deepEqual(snapshot(target.root), firstTree);

    const state = JSON.parse(fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")), "utf8"));
    assert.equal(state.environment, "qa");
    assert.ok(state.managedFiles.every((relativePath: string) => !relativePath.includes("/dev/")));
    const installedHooks = JSON.parse(fs.readFileSync(path.join(target.root, ".codex/hooks.json"), "utf8"));
    const managedCommand = JSON.stringify(installedHooks.hooks.PreToolUse);
    assert.match(managedCommand, /\.codex\/kcoderag-nav\/install-state\.json/);
    assert.doesNotMatch(managedCommand, new RegExp(target.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    write(pkg.root, "kcoderag-qa/hooks/grep-nudge.cjs", "qa:grep-nudge.cjs:v2\n");
    assert.equal((await run(target.root, pkg.root, "status")).output.status, "update_available");
    assert.equal((await run(target.root, pkg.root, "update")).exitCode, 0);
    assert.equal((await run(target.root, pkg.root, "status")).output.status, "healthy");

    const removed = await run(target.root, pkg.root, "uninstall");
    assert.equal(removed.exitCode, 0);
    assert.deepEqual(fs.readFileSync(path.join(target.root, ".codex/config.toml")), target.config);
    assert.deepEqual(fs.readFileSync(path.join(target.root, ".codex/hooks.json")), target.hooks);
    assert.equal(fs.existsSync(path.join(target.root, ...STATE_PATH.split("/"))), false);
    assert.equal(fs.existsSync(path.join(target.root, ".agents/skills/kcoderag-nav/SKILL.md")), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Codex hooks lifecycle preserves unowned lexical bytes and unsafe integer literals", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-lossless-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const hooksPath = path.join(target.root, ".codex/hooks.json");
    const original = "{\r\n \"huge\" : 9007199254740993,\r\n \"escaped\" : \"\\u006b\\u0065\\u0065\\u0070\",\r\n \"hooks\" : { \"Stop\" : [{\"matcher\":\"*\",\"hooks\":[]}] }\r\n}\r\n";
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(hooksPath, original, "utf8");

    for (const command of ["install", "update"] as const) {
      assert.equal((await run(target.root, pkg.root, command)).exitCode, 0);
      const current = fs.readFileSync(hooksPath, "utf8");
      assert.ok(current.includes("\"huge\" : 9007199254740993"));
      assert.ok(current.includes("\"escaped\" : \"\\u006b\\u0065\\u0065\\u0070\""));
    }
    assert.equal((await run(target.root, pkg.root, "uninstall")).exitCode, 0);
    assert.equal(fs.readFileSync(hooksPath, "utf8"), original);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Codex preserves pre-existing empty hook containers across install update and uninstall", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-empty-parents-"));
  try {
    const pkg = packageFixture(base);
    for (const [name, hooksOriginal, expectedCreated] of [
      ["hooks", "{ \"hooks\" : {} }\n", ["hooks.PreToolUse", "hooks.PostToolUse"]],
      ["pretool", "{ \"hooks\" : { \"PreToolUse\" : [] } }\n", ["hooks.PostToolUse"]],
    ] as const) {
      const target = targetFixture(base, name);
      const hooksPath = path.join(target.root, ".codex", "hooks.json");
      fs.writeFileSync(hooksPath, hooksOriginal, "utf8");

      assert.equal((await run(target.root, pkg.root, "install")).exitCode, 0, name);
      assert.equal((await run(target.root, pkg.root, "update")).exitCode, 0, name);
      const installState = JSON.parse(fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")), "utf8"));
      assert.deepEqual(installState.sections[".codex/hooks.json"].createdContainers, expectedCreated, name);
      assert.equal((await run(target.root, pkg.root, "uninstall")).exitCode, 0, name);
      assert.equal(fs.readFileSync(hooksPath, "utf8"), hooksOriginal, name);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Codex install state never snapshots shared-config credentials", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-secret-state-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const unrelatedSecret = `unrelated-${crypto.randomUUID()}`;
    const config = Buffer.concat([
      target.config,
      Buffer.from(`# unrelated credential ${unrelatedSecret}\n`, "utf8"),
    ]);
    write(target.root, ".codex/config.toml", config);

    assert.equal((await run(target.root, pkg.root, "install")).exitCode, 0);
    const stateBytes = fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")));
    assert.equal(stateBytes.includes(unrelatedSecret), false);
    assert.equal(stateBytes.includes(pkg.secret), false);
    assert.equal(
      fs.readdirSync(target.root).some((entry) => entry.startsWith(".kcoderag-nav-recovery-")),
      false,
    );

    assert.equal((await run(target.root, pkg.root, "uninstall")).exitCode, 0);
    assert.deepEqual(fs.readFileSync(path.join(target.root, ".codex/config.toml")), config);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Codex update and uninstall preserve unrelated shared-config edits made after install", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-section-life-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    assert.equal((await run(target.root, pkg.root, "install")).exitCode, 0);

    const configPath = path.join(target.root, ".codex/config.toml");
    fs.appendFileSync(configPath, "[mcp_servers.user-added]\nurl = \"https://user.invalid/mcp\"\n");
    const hooksPath = path.join(target.root, ".codex/hooks.json");
    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    hooks.afterInstall = { keep: true };
    fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 4)}\n`);

    assert.equal((await run(target.root, pkg.root, "status")).output.status, "healthy");
    write(pkg.root, "kcoderag-qa/hooks/grep-nudge.cjs", "qa:grep-nudge.cjs:section-v2\n");
    assert.equal((await run(target.root, pkg.root, "update")).exitCode, 0);
    assert.match(fs.readFileSync(configPath, "utf8"), /\[mcp_servers\.user-added\]/);
    assert.deepEqual(JSON.parse(fs.readFileSync(hooksPath, "utf8")).afterInstall, { keep: true });

    assert.equal((await run(target.root, pkg.root, "uninstall")).exitCode, 0);
    const remainingConfig = fs.readFileSync(configPath, "utf8");
    assert.doesNotMatch(remainingConfig, /BEGIN KCODERAG-NAV/);
    assert.match(remainingConfig, /\[mcp_servers\.user-added\]/);
    assert.deepEqual(JSON.parse(fs.readFileSync(hooksPath, "utf8")).afterInstall, { keep: true });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Codex QA managed drift blocks update and uninstall before writes", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-drift-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    assert.equal((await run(target.root, pkg.root, "install")).exitCode, 0);
    assert.equal((await run(target.root, pkg.root, "status")).output.status, "healthy");
    write(target.root, ".codex/kcoderag-nav/qa/hooks/grep-nudge.cjs", "locally edited\n");
    const before = snapshot(target.root);
    for (const command of ["update", "uninstall"] as const) {
      const result = await run(target.root, pkg.root, command);
      assert.equal(result.exitCode, 1);
      assert.equal(result.output.code, "managed_content_changed");
      assert.deepEqual(snapshot(target.root), before);
    }
    assert.equal((await run(target.root, pkg.root, "doctor")).output.status, "drifted");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Codex refuses every semantic TOML spelling of a managed MCP key before writes", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-toml-conflict-"));
  try {
    const pkg = packageFixture(base);
    const fixtures = [
      ["spaced-table", "[mcp_servers . \"kcoderag-qa\"]\nurl = \"https://other.invalid\"\n"],
      ["quoted-keys", "['mcp_servers'.'kcoderag-dev']\nurl = \"https://other.invalid\"\n"],
      ["dotted-assignment", "\"mcp_servers\" . \"kcoderag-qa\" = { url = \"https://other.invalid\" }\n"],
      ["inline-table", "mcp_servers = { unrelated = {}, \"kcoderag-dev\" = { url = \"https://other.invalid\" } }\n"],
      ["parent-table", "[mcp_servers]\n\"kcoderag-qa\" = { url = \"https://other.invalid\" }\n"],
    ] as const;
    for (const [name, config] of fixtures) {
      const target = targetFixture(base, name);
      write(target.root, ".codex/config.toml", config);
      const before = snapshot(target.root);
      const result = await run(target.root, pkg.root, "install");
      assert.equal(result.output.code, "unmanaged_name_conflict", name);
      assert.deepEqual(snapshot(target.root), before, name);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});


test("Codex rejects malformed UTF-8 in TOML and JSON before any write", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-utf8-"));
  try {
    const pkg = packageFixture(base);
    for (const [name, relativePath, prefix, suffix] of [
      ["toml", ".codex/config.toml", "[features]\nvalue = \"", "\"\n"],
      ["json", ".codex/hooks.json", "{\"hooks\":{},\"value\":\"", "\"}\n"],
    ] as const) {
      const target = targetFixture(base, name);
      write(target.root, relativePath, Buffer.concat([
        Buffer.from(prefix, "utf8"),
        Buffer.from([0x80]),
        Buffer.from(suffix, "utf8"),
      ]));
      const before = snapshot(target.root);
      const result = await run(target.root, pkg.root, "install");
      assert.equal(result.output.code, "invalid_utf8");
      assert.deepEqual(snapshot(target.root), before);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});


test("Codex refuses type conflicts, unowned exclusive files, symlinks, and transaction failures", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-refuse-"));
  try {
    const pkg = packageFixture(base);
    const invalidHooks = targetFixture(base, "invalid-hooks");
    write(invalidHooks.root, ".codex/hooks.json", `${JSON.stringify({ hooks: "wrong" })}\n`);
    const invalidBefore = snapshot(invalidHooks.root);
    const invalidTarget = require("../../dist/core/project-target.cjs").resolveProjectTarget(invalidHooks.root);
    const invalidObservation = codex.codexAdapter.detect({ target: invalidTarget, packageRoot: pkg.root });
    assert.throws(
      () => codex.codexAdapter.renderInstall({
        target: invalidTarget,
        packageRoot: pkg.root,
        command: "install",
        environment: "qa",
        observation: invalidObservation,
        allowLegacyUserRemoval: false,
        allowLegacyDevMigration: false,
      }),
      (error: unknown) => error instanceof Error && "code" in error &&
        (error as Error & { code: string }).code === "invalid_json",
    );
    assert.deepEqual(snapshot(invalidHooks.root), invalidBefore);

    const ownedName = targetFixture(base, "owned-name");
    write(ownedName.root, ".agents/skills/kcoderag-nav/SKILL.md", "unowned\n");
    const ownedBefore = snapshot(ownedName.root);
    const ownedTarget = require("../../dist/core/project-target.cjs").resolveProjectTarget(ownedName.root);
    const ownedObservation = codex.codexAdapter.detect({ target: ownedTarget, packageRoot: pkg.root });
    assert.throws(() => codex.codexAdapter.renderInstall({
      target: ownedTarget,
      packageRoot: pkg.root,
      command: "install",
      environment: "qa",
      observation: ownedObservation,
      allowLegacyUserRemoval: false,
      allowLegacyDevMigration: false,
    }), /unmanaged_name_conflict/);
    assert.deepEqual(snapshot(ownedName.root), ownedBefore);

    const rollback = targetFixture(base, "rollback");
    const rollbackTarget = require("../../dist/core/project-target.cjs").resolveProjectTarget(rollback.root);
    const desired = codex.codexAdapter.renderInstall({
      target: rollbackTarget,
      packageRoot: pkg.root,
      command: "install",
      environment: "qa",
      observation: codex.codexAdapter.detect({ target: rollbackTarget, packageRoot: pkg.root }),
      allowLegacyUserRemoval: false,
      allowLegacyDevMigration: false,
    });
    const beforeRollback = snapshot(rollback.root);
    assert.throws(() => transaction.applyTransaction(desired, { failAtCommit: 2 }), /transaction_failed/);
    assert.deepEqual(snapshot(rollback.root), beforeRollback);

    const link = targetFixture(base, "link");
    const outside = path.join(base, "outside");
    fs.mkdirSync(outside);
    fs.rmSync(path.join(link.root, ".codex"), { recursive: true });
    try {
      fs.symlinkSync(outside, path.join(link.root, ".codex"), "junction");
      const linkTarget = require("../../dist/core/project-target.cjs").resolveProjectTarget(link.root);
      assert.throws(() => codex.codexAdapter.detect({ target: linkTarget, packageRoot: pkg.root }), /symlink_escape/);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

function ownedRegistration(sourcePath: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    host: "codex",
    sourceType: "owned_marketplace_registration",
    marketplaceName: "kcoderag-nav",
    sourcePath,
    recognizedSourcePath: sourcePath,
    provenanceId: "kcoderag-nav-repository-v1",
    safePath: ".codex/config.toml",
    failureAttribution: "marketplace_load",
    exclusiveUserMarketplace: true,
    ...overrides,
  };
}

function ownedPluginInventory(sourcePath: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    installed: [{
      pluginId: "kcoderag-qa@kcoderag-nav",
      name: "kcoderag-qa",
      marketplaceName: "kcoderag-nav",
      version: "0.1.8",
      installed: true,
      enabled: true,
      source: { source: "local", path: path.join(sourcePath, "kcoderag-qa") },
      marketplaceSource: { sourceType: "local", source: sourcePath },
      installPolicy: "AVAILABLE",
      authPolicy: "ON_USE",
      ...overrides,
    }],
    available: [],
  });
}

function ownedMarketplaceInventory(sourcePath: string): string {
  return JSON.stringify({
    marketplaces: [{
      name: "kcoderag-nav",
      root: path.join(os.tmpdir(), ".codex", ".tmp", "marketplaces", "kcoderag-nav"),
      marketplaceSource: { sourceType: "local", source: sourcePath },
    }],
  });
}

function scannerContext(adapter: HostAdapter, mode: "fast" | "deep" | "gate"):
Promise<Record<string, any>> {
  const target = { root: path.resolve(".") };
  if (adapter.scanUserSources === undefined) throw new Error("scanner missing");
  return adapter.scanUserSources({
    mode,
    target,
    packageRoot: path.resolve("."),
    observation: { host: "codex", target },
  });
}

test("Codex normal inventory exposes only a capability-gated fixed plugin cleanup plan", async () => {
  const sourcePath = path.resolve("legacy-kcoderag-nav");
  const calls: NativeRequest[] = [];
  const adapter = codex.createCodexAdapter({
    runner: async (request: NativeRequest) => {
      calls.push(request);
      const command = [request.executable, ...request.args].join(" ");
      if (command === "codex plugin list --json") {
        return { exitCode: 0, timedOut: false, stdout: ownedPluginInventory(sourcePath) };
      }
      if (command === "codex plugin marketplace list --json") {
        return { exitCode: 0, timedOut: false, stdout: ownedMarketplaceInventory(sourcePath) };
      }
      return healthyNativeResult(request);
    },
    readUserSources: () => ({
      registrations: [ownedRegistration(sourcePath)],
      rawMcpPaths: [], manualHookPaths: [], cachePaths: [], ambiguousPaths: [],
    }),
  });

  const scan = await scannerContext(adapter, "deep");
  assert.equal(scan.hasConflict, true);
  assert.equal(scan.cleanupPlans.length, 1);
  assert.equal(scan.cleanupPlans[0].command, "codex plugin remove kcoderag-qa@kcoderag-nav --json");
  assert.match(scan.cleanupPlans[0].fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(scan.findings[0].cleanupFingerprint, scan.cleanupPlans[0].fingerprint);
  assert.ok(calls.every((call) => call.executable === "codex" && call.timeoutMs === 5_000));
  assert.deepEqual(calls.map((call) => call.args.join(" ")), [
    "--version",
    "plugin list --help",
    "plugin marketplace list --help",
    "plugin remove --help",
    "plugin marketplace remove --help",
    "plugin list --json",
    "plugin marketplace list --json",
  ]);
});

test("Codex scan modes keep cache and disabled residue informational and never auto-clean raw/manual sources", async () => {
  const sourcePath = path.resolve("legacy-kcoderag-nav");
  const adapter = codex.createCodexAdapter({
    runner: async (request: NativeRequest) => {
      const command = [request.executable, ...request.args].join(" ");
      if (command === "codex plugin list --json") {
        return {
          exitCode: 0,
          timedOut: false,
          stdout: ownedPluginInventory(sourcePath, { enabled: false }),
        };
      }
      if (command === "codex plugin marketplace list --json") {
        return { exitCode: 0, timedOut: false, stdout: EMPTY_MARKETPLACE_INVENTORY };
      }
      return healthyNativeResult(request);
    },
    readUserSources: () => ({
      registrations: [],
      rawMcpPaths: [".codex/config.toml"],
      manualHookPaths: [".codex/hooks.json"],
      cachePaths: [".codex/.tmp/marketplaces/kcoderag-nav"],
      ambiguousPaths: [],
    }),
  });

  const fast = await scannerContext(adapter, "fast");
  assert.deepEqual(fast.findings.map((finding: Record<string, unknown>) => finding.sourceType), ["raw_mcp", "manual_hook"]);
  assert.equal(fast.cleanupPlans.length, 0);
  const deep = await scannerContext(adapter, "deep");
  assert.deepEqual(
    new Set(deep.findings.map((finding: Record<string, unknown>) => finding.sourceType)),
    new Set(["raw_mcp", "manual_hook", "cache_residue", "disabled_registration"]),
  );
  assert.equal(deep.cleanupPlans.length, 0);
  assert.ok(deep.findings.filter((finding: Record<string, unknown>) => finding.severity === "info").length >= 2);
});

test("Codex degraded cleanup recognizes only the exact stale owned marketplace registration", async () => {
  const sourcePath = path.resolve("legacy-kcoderag-nav");
  async function scanWith(
    registration: Record<string, unknown>,
    failureAttribution = "marketplace_load",
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    const adapter = codex.createCodexAdapter({
      runner: async (request: NativeRequest) => {
        const command = [request.executable, ...request.args].join(" ");
        if (command === "codex plugin list --json" || command === "codex plugin marketplace list --json") {
          return {
            exitCode: 1,
            timedOut: false,
            stdout: "sentinel subprocess body",
            failureAttribution,
          };
        }
        return healthyNativeResult(request);
      },
      readUserSources: () => ({
        registrations: [registration], rawMcpPaths: [], manualHookPaths: [], cachePaths: [], ambiguousPaths: [],
        ...extra,
      }),
    });
    return scannerContext(adapter, "deep");
  }

  const exact = await scanWith(ownedRegistration(sourcePath));
  assert.equal(exact.cleanupPlans.length, 1);
  assert.equal(exact.cleanupPlans[0].command, "codex plugin marketplace remove kcoderag-nav --json");
  assert.equal(exact.cleanupPlans[0].timeoutMs, 5_000);
  assert.doesNotMatch(JSON.stringify(exact), /sentinel subprocess body/);

  const coexisting = await scanWith(ownedRegistration(sourcePath, {
    exclusiveUserMarketplace: false,
  }));
  assert.equal(coexisting.cleanupPlans.length, 1);
  assert.equal(
    coexisting.cleanupPlans[0].command,
    "codex plugin marketplace remove kcoderag-nav --json",
  );

  const variants = [
    () => scanWith(ownedRegistration(sourcePath, { marketplaceName: "other" })),
    () => scanWith(ownedRegistration(sourcePath, { sourcePath: path.resolve("other") })),
    () => scanWith(ownedRegistration(sourcePath, { provenanceId: "unknown" })),
    () => scanWith(ownedRegistration(sourcePath), "unrelated_failure"),
    () => scanWith(ownedRegistration(sourcePath), "marketplace_load", { rawMcpPaths: [".codex/config.toml"] }),
    () => scanWith(ownedRegistration(sourcePath), "marketplace_load", { registrations: [ownedRegistration(sourcePath), ownedRegistration(sourcePath)] }),
  ];
  for (const variant of variants) {
    const scan = await variant();
    assert.equal(scan.hasConflict, true);
    assert.equal(scan.cleanupPlans.length, 0);
    assert.ok(scan.findings.every((finding: Record<string, unknown>) => finding.cleanupEligible === false));
  }
});

test("Codex rejects incomplete or shared inventories instead of widening marketplace deletion", async () => {
  const sourcePath = path.resolve("legacy-kcoderag-nav");
  const malformedInventories = [
    "not-json",
    JSON.stringify({ installed: [] }),
    JSON.stringify({ installed: [{ pluginId: "bad" }], available: [] }),
    JSON.stringify({
      installed: [
        JSON.parse(ownedPluginInventory(sourcePath)).installed[0],
        {
          ...JSON.parse(ownedPluginInventory(sourcePath)).installed[0],
          pluginId: "foreign@kcoderag-nav",
          name: "foreign",
        },
      ],
      available: [],
    }),
  ];
  for (const inventory of malformedInventories) {
    const adapter = codex.createCodexAdapter({
      runner: async (request: NativeRequest) => {
        const command = [request.executable, ...request.args].join(" ");
        if (command === "codex plugin list --json") return { exitCode: 0, timedOut: false, stdout: inventory };
        if (command === "codex plugin marketplace list --json") {
          return { exitCode: 0, timedOut: false, stdout: ownedMarketplaceInventory(sourcePath) };
        }
        return healthyNativeResult(request);
      },
      readUserSources: () => ({
        registrations: [ownedRegistration(sourcePath)], rawMcpPaths: [], manualHookPaths: [], cachePaths: [], ambiguousPaths: [],
      }),
    });
    const scan = await scannerContext(adapter, "gate");
    assert.equal(scan.hasConflict, true);
    assert.equal(scan.cleanupPlans.length, 0);
  }
});

test("Codex treats unsupported version, unknown help, timeout, and runner errors as manual-only", async () => {
  const scenarios = [
    async (request: NativeRequest): Promise<NativeResult> => {
      if (request.args.join(" ") === "--version") {
        return { exitCode: 0, timedOut: false, stdout: "codex-cli 0.145.9\n" };
      }
      return healthyNativeResult(request);
    },
    async (request: NativeRequest): Promise<NativeResult> => {
      if (request.args.join(" ") === "plugin marketplace remove --help") {
        return { exitCode: 0, timedOut: false, stdout: "unknown help" };
      }
      return healthyNativeResult(request);
    },
    async (request: NativeRequest): Promise<NativeResult> => {
      if (request.args.join(" ") === "plugin list --json") {
        return { exitCode: 1, timedOut: true, stdout: "Bearer sentinel" };
      }
      return healthyNativeResult(request);
    },
    async (_request: NativeRequest): Promise<NativeResult> => { throw new Error("Bearer sentinel"); },
  ];
  for (const runner of scenarios) {
    const adapter = codex.createCodexAdapter({
      runner,
      readUserSources: () => ({
        registrations: [], rawMcpPaths: [], manualHookPaths: [], cachePaths: [], ambiguousPaths: [],
      }),
    });
    const scan = await scannerContext(adapter, "gate");
    assert.equal(scan.hasConflict, true);
    assert.equal(scan.cleanupPlans.length, 0);
    assert.ok(scan.findings.some((finding: Record<string, unknown>) => finding.code === "source_scan_unavailable"));
    assert.doesNotMatch(JSON.stringify(scan), /Bearer sentinel/);
  }
});

test("Codex cleanup executes fixed argv then requires a complete clean rescan before project writes", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-source-clean-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const sourcePath = path.resolve("legacy-kcoderag-nav");
    let removed = false;
    const nativeCalls: string[] = [];
    const adapter = codex.createCodexAdapter({
      runner: async (request: NativeRequest) => {
        const command = [request.executable, ...request.args].join(" ");
        nativeCalls.push(command);
        if (command === "codex plugin list --json") {
          return { exitCode: 0, timedOut: false, stdout: removed ? EMPTY_PLUGIN_INVENTORY : ownedPluginInventory(sourcePath) };
        }
        if (command === "codex plugin marketplace list --json") {
          return { exitCode: 0, timedOut: false, stdout: removed ? EMPTY_MARKETPLACE_INVENTORY : ownedMarketplaceInventory(sourcePath) };
        }
        if (command === "codex plugin remove kcoderag-qa@kcoderag-nav --json") {
          removed = true;
          return { exitCode: 0, timedOut: false, stdout: "{\"removed\":true}" };
        }
        return healthyNativeResult(request);
      },
      readUserSources: () => ({
        registrations: removed ? [] : [ownedRegistration(sourcePath)],
        rawMcpPaths: [], manualHookPaths: [], cachePaths: [".codex/.tmp/marketplaces/kcoderag-nav"], ambiguousPaths: [],
      }),
    });
    const initial = await scannerContext(adapter, "gate");
    const fingerprint = String(initial.cleanupPlans[0].fingerprint);
    const captured = io(target.root, pkg.root, adapter);
    const exitCode = await commands.executeCommand([
      "install", "--host", "codex", "--yes", "--json",
      "--allow-owned-source-cleanup", "--cleanup-fingerprint", fingerprint,
    ], captured.dependencies);
    assert.equal(exitCode, 0);
    assert.equal(removed, true);
    assert.equal(nativeCalls.filter((command) => command === "codex plugin remove kcoderag-qa@kcoderag-nav --json").length, 1);
    assert.ok(fs.existsSync(path.join(target.root, STATE_PATH)));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Codex cleanup failure, timeout, residual identity, and rescan error preserve project bytes secret-safely", async () => {
  for (const failure of ["nonzero", "timeout", "residual", "rescan"] as const) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `kcoderag-codex-source-${failure}-`));
    try {
      const pkg = packageFixture(base);
      const target = targetFixture(base);
      const sourcePath = path.resolve("legacy-kcoderag-nav");
      const sentinel = `Bearer-${crypto.randomUUID()}`;
      let cleanupAttempted = false;
      const adapter = codex.createCodexAdapter({
        runner: async (request: NativeRequest) => {
          const command = [request.executable, ...request.args].join(" ");
          if (command === "codex plugin remove kcoderag-qa@kcoderag-nav --json") {
            cleanupAttempted = true;
            if (failure === "nonzero") return { exitCode: 1, timedOut: false, stdout: sentinel };
            if (failure === "timeout") return { exitCode: 1, timedOut: true, stdout: sentinel };
            return { exitCode: 0, timedOut: false, stdout: sentinel };
          }
          if (command === "codex plugin list --json") {
            if (cleanupAttempted && failure === "rescan") return { exitCode: 1, timedOut: false, stdout: sentinel, failureAttribution: "unrelated_failure" };
            return { exitCode: 0, timedOut: false, stdout: ownedPluginInventory(sourcePath) };
          }
          if (command === "codex plugin marketplace list --json") {
            return { exitCode: 0, timedOut: false, stdout: ownedMarketplaceInventory(sourcePath) };
          }
          return healthyNativeResult(request);
        },
        readUserSources: () => ({
          registrations: [ownedRegistration(sourcePath)], rawMcpPaths: [], manualHookPaths: [], cachePaths: [], ambiguousPaths: [],
        }),
      });
      const initial = await scannerContext(adapter, "gate");
      const before = snapshot(target.root);
      const captured = io(target.root, pkg.root, adapter);
      const exitCode = await commands.executeCommand([
        "install", "--host", "codex", "--yes", "--json",
        "--allow-owned-source-cleanup", "--cleanup-fingerprint", String(initial.cleanupPlans[0].fingerprint),
      ], captured.dependencies);
      assert.notEqual(exitCode, 0);
      assert.deepEqual(snapshot(target.root), before);
      assert.doesNotMatch(captured.stdout.join("\n") + captured.stderr.join("\n"), new RegExp(sentinel));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }
});
