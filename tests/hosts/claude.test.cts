const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor";

interface HostAdapter {
  readonly id: HostId;
  detect(context: Record<string, unknown>): Record<string, unknown>;
  renderInstall(context: Record<string, unknown>): Record<string, any>;
  renderUninstall(context: Record<string, unknown>): Record<string, any>;
  scanUserSources?(context: Record<string, unknown>): Promise<Record<string, any>>;
  cleanupOwnedSource?(
    plan: Record<string, any>,
    authority: Record<string, unknown>,
  ): Promise<Record<string, any>>;
}

interface ClaudeModule {
  readonly claudeAdapter: HostAdapter;
  createClaudeAdapter(options?: Record<string, unknown>): HostAdapter;
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

const claude = require("../../dist/hosts/claude.cjs") as ClaudeModule;
const commands = require("../../dist/cli/commands.cjs") as CommandModule;
const transaction = require("../../dist/core/transaction.cjs") as TransactionModule;
const targets = require("../../dist/core/project-target.cjs") as {
  resolveProjectTarget(target: string): Record<string, unknown>;
};

const STATE_PATH = ".claude/kcoderag-nav/install-state.json";

type NativeRequest = Readonly<{ executable: string; args: readonly string[]; timeoutMs: number }>;
type NativeResult = Readonly<{ exitCode: number; timedOut: boolean; stdout?: string }>;

const EMPTY_CLAUDE_PLUGIN_INVENTORY = "[]";
const EMPTY_CLAUDE_MARKETPLACE_INVENTORY = "[]";

function healthyClaudeNativeResult(request: NativeRequest): NativeResult {
  const command = [request.executable, ...request.args].join(" ");
  if (command === "claude --version") {
    return { exitCode: 0, timedOut: false, stdout: "2.1.241 (Claude Code)\n" };
  }
  if (command.endsWith(" --help")) {
    if (command.includes("plugin uninstall")) {
      return {
        exitCode: 0,
        timedOut: false,
        stdout: "Usage: claude plugin uninstall <PLUGIN@MARKETPLACE> --scope <scope> user project local",
      };
    }
    if (command.includes("marketplace remove")) {
      return {
        exitCode: 0,
        timedOut: false,
        stdout: "Usage: claude plugin marketplace remove <name> --scope <scope>",
      };
    }
    return { exitCode: 0, timedOut: false, stdout: "Usage: list --json" };
  }
  if (command === "claude plugin list --json") {
    return { exitCode: 0, timedOut: false, stdout: EMPTY_CLAUDE_PLUGIN_INVENTORY };
  }
  if (command === "claude plugin marketplace list --json") {
    return { exitCode: 0, timedOut: false, stdout: EMPTY_CLAUDE_MARKETPLACE_INVENTORY };
  }
  return { exitCode: 0, timedOut: false, stdout: "{}" };
}

function emptyClaudeUserSources(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rawMcpPaths: [],
    manualHookPaths: [],
    cachePaths: [],
    ambiguousPaths: [],
    ...overrides,
  };
}

function claudePluginInventory(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify([{
    id: "kcoderag-qa@kcoderag-nav",
    version: "0.1.8",
    scope: "user",
    enabled: true,
    installPath: path.join(os.tmpdir(), ".claude", "plugins", "cache", "kcoderag-nav", "kcoderag-qa"),
    installedAt: "2026-08-25T00:00:00.000Z",
    lastUpdated: "2026-08-25T00:00:00.000Z",
    ...overrides,
  }]);
}

function claudeMarketplaceInventory(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([{
    name: "kcoderag-nav",
    source: "git",
    repo: "Tooc0ld/kcoderag-nav",
    installLocation: path.join(os.tmpdir(), ".claude", "plugins", "marketplaces", "kcoderag-nav"),
    ...overrides,
  }]);
}

function claudeScannerContext(
  adapter: HostAdapter,
  mode: "fast" | "deep" | "gate",
): Promise<Record<string, any>> {
  const target = { root: path.resolve(".") };
  if (adapter.scanUserSources === undefined) throw new Error("scanner missing");
  return adapter.scanUserSources({
    mode,
    target,
    packageRoot: path.resolve("."),
    observation: { host: "claude", target },
  });
}

const testAdapter = claude.createClaudeAdapter({
  runner: async (request: NativeRequest) => healthyClaudeNativeResult(request),
  readUserSources: () => emptyClaudeUserSources(),
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
    const name = `kcoderag-${environment}`;
    write(root, `${name}/.mcp.json`, `${JSON.stringify({
      mcpServers: {
        [name]: {
          type: "http",
          url: `https://${environment}.invalid/mcp`,
          headers: { Authorization: `Bearer ${secret}-${environment}` },
        },
      },
    })}\n`);
    for (const asset of [
      "grep-nudge.cjs",
      "update-check.cjs",
      "update-worker.cjs",
      "run_hook.cmd",
      "run_hook.sh",
    ]) {
      write(root, `${name}/hooks/${asset}`, `${environment}:${asset}\n`);
    }
    write(root, `${name}/skills/code-lookup-discipline/SKILL.md`, `# ${environment}\n`);
  }
  return { root, secret };
}

function targetFixture(base: string, name = "target") {
  const root = path.join(base, name);
  fs.mkdirSync(root);
  const settings = Buffer.from(`${JSON.stringify({
    permissions: { allow: ["Read"] },
    hooks: { Stop: [{ matcher: "*", hooks: [] }] },
  }, null, 4)}\n`);
  const mcp = Buffer.from(`${JSON.stringify({
    mcpServers: { unrelated: { command: "safe-command" } },
    unrelated: true,
  }, null, 4)}\n`);
  write(root, ".claude/settings.json", settings);
  write(root, ".mcp.json", mcp);
  write(root, ".claude/skills/unrelated/SKILL.md", "# unrelated\n");
  return { root, settings, mcp };
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
        records.push(`l:${relative}`);
      } else {
        records.push(`f:${relative}:${crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")}`);
      }
    }
  };
  visit(root);
  return records;
}

async function run(
  target: string,
  packageRoot: string,
  command: "install" | "status" | "doctor" | "update" | "uninstall",
  allowLegacyDevMigration = false,
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const argv = [command, "--host", "claude", "--json"];
  if (["install", "update", "uninstall"].includes(command)) argv.push("--yes");
  if (allowLegacyDevMigration) argv.push("--allow-legacy-dev-migration");
  const exitCode = await commands.executeCommand(argv, {
    cwd: target,
    packageRoot,
    nodeVersion: "22.20.0",
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    getAdapter: (host: HostId) => {
      if (host !== "claude") throw new Error("unexpected host");
      return testAdapter;
    },
  });
  return {
    exitCode,
    stdout,
    stderr,
    output: JSON.parse(stdout[0] ?? "{}") as Record<string, unknown>,
  };
}

test("Claude lifecycle preserves unrelated JSON and restores exact original bytes", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-claude-life-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const installed = await run(target.root, pkg.root, "install");
    assert.equal(installed.exitCode, 0);
    assert.doesNotMatch(installed.stdout.join("\n") + installed.stderr.join("\n"), new RegExp(pkg.secret));
    const settings = JSON.parse(fs.readFileSync(path.join(target.root, ".claude/settings.json"), "utf8"));
    const mcp = JSON.parse(fs.readFileSync(path.join(target.root, ".mcp.json"), "utf8"));
    assert.deepEqual(settings.permissions, { allow: ["Read"] });
    assert.equal(settings.hooks.Stop.length, 1);
    assert.equal(settings.hooks.PreToolUse.length, 1);
    assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ["kcoderag-qa", "unrelated"]);
    assert.equal(fs.existsSync(path.join(target.root, ".claude/skills/unrelated/SKILL.md")), true);
    const installedTree = snapshot(target.root);

    assert.equal((await run(target.root, pkg.root, "status")).output.status, "healthy");
    assert.equal((await run(target.root, pkg.root, "doctor")).output.status, "healthy");
    assert.equal((await run(target.root, pkg.root, "install")).exitCode, 0);
    assert.deepEqual(snapshot(target.root), installedTree);

    const state = JSON.parse(fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")), "utf8"));
    assert.equal(state.environment, "qa");
    assert.ok(state.managedFiles.every((relativePath: string) => !relativePath.includes("/dev/")));
    const managedCommand = JSON.stringify(settings.hooks.PreToolUse);
    assert.match(managedCommand, /\.claude\/kcoderag-nav\/install-state\.json/);
    assert.doesNotMatch(managedCommand, new RegExp(target.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    write(pkg.root, "kcoderag-qa/hooks/grep-nudge.cjs", "qa:v2\n");
    assert.equal((await run(target.root, pkg.root, "status")).output.status, "update_available");
    assert.equal((await run(target.root, pkg.root, "update")).exitCode, 0);
    assert.equal((await run(target.root, pkg.root, "status")).output.status, "healthy");

    assert.equal((await run(target.root, pkg.root, "uninstall")).exitCode, 0);
    assert.deepEqual(fs.readFileSync(path.join(target.root, ".claude/settings.json")), target.settings);
    assert.deepEqual(fs.readFileSync(path.join(target.root, ".mcp.json")), target.mcp);
    assert.equal(fs.existsSync(path.join(target.root, ...STATE_PATH.split("/"))), false);
    assert.equal(fs.existsSync(path.join(target.root, ".claude/skills/kcoderag-nav/SKILL.md")), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Claude shared JSON lifecycle preserves unowned lexical bytes and unsafe integer literals", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-claude-lossless-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const mcpPath = path.join(target.root, ".mcp.json");
    const settingsPath = path.join(target.root, ".claude/settings.json");
    const mcpOriginal = "{\r\n  \"huge\" : 9007199254740993,\r\n  \"escaped\" : \"\\u006b\\u0065\\u0065\\u0070\",\r\n  \"mcpServers\" : { \"user\" : {\"command\":\"keep\"} }\r\n}\r\n";
    const settingsOriginal = "{\r\n \"huge\" : 9007199254740993,\r\n \"escaped\" : \"\\u006b\\u0065\\u0065\\u0070\",\r\n \"hooks\" : { \"Stop\" : [{\"matcher\":\"*\",\"hooks\":[]}] }\r\n}\r\n";
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(mcpPath, mcpOriginal, "utf8");
    fs.writeFileSync(settingsPath, settingsOriginal, "utf8");
    const unowned = "\"huge\" : 9007199254740993";
    const escaped = "\"escaped\" : \"\\u006b\\u0065\\u0065\\u0070\"";

    assert.equal((await run(target.root, pkg.root, "install")).exitCode, 0);
    for (const filePath of [mcpPath, settingsPath]) {
      const installed = fs.readFileSync(filePath, "utf8");
      assert.ok(installed.includes(unowned));
      assert.ok(installed.includes(escaped));
    }
    assert.equal((await run(target.root, pkg.root, "update")).exitCode, 0);
    for (const filePath of [mcpPath, settingsPath]) {
      const updated = fs.readFileSync(filePath, "utf8");
      assert.ok(updated.includes(unowned));
      assert.ok(updated.includes(escaped));
    }
    assert.equal((await run(target.root, pkg.root, "uninstall")).exitCode, 0);
    assert.equal(fs.readFileSync(mcpPath, "utf8"), mcpOriginal);
    assert.equal(fs.readFileSync(settingsPath, "utf8"), settingsOriginal);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Claude preserves pre-existing empty shared JSON containers across install update and uninstall", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-claude-empty-parents-"));
  try {
    const pkg = packageFixture(base);
    const mcpOriginal = "{ \"mcpServers\" : {} }\n";
    for (const [name, settingsOriginal, expectedCreated] of [
      ["hooks", "{ \"hooks\" : {} }\n", ["hooks.PreToolUse"]],
      ["pretool", "{ \"hooks\" : { \"PreToolUse\" : [] } }\n", []],
    ] as const) {
      const target = targetFixture(base, name);
      const mcpPath = path.join(target.root, ".mcp.json");
      const settingsPath = path.join(target.root, ".claude", "settings.json");
      fs.writeFileSync(mcpPath, mcpOriginal, "utf8");
      fs.writeFileSync(settingsPath, settingsOriginal, "utf8");

      assert.equal((await run(target.root, pkg.root, "install")).exitCode, 0, name);
      assert.equal((await run(target.root, pkg.root, "update")).exitCode, 0, name);
      const installState = JSON.parse(fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")), "utf8"));
      assert.deepEqual(installState.sections[".mcp.json"].createdContainers, [], name);
      assert.deepEqual(installState.sections[".claude/settings.json"].createdContainers, expectedCreated, name);
      assert.equal((await run(target.root, pkg.root, "uninstall")).exitCode, 0, name);
      assert.equal(fs.readFileSync(mcpPath, "utf8"), mcpOriginal, name);
      assert.equal(fs.readFileSync(settingsPath, "utf8"), settingsOriginal, name);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Claude install state never snapshots shared-config credentials", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-claude-secret-state-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const unrelatedSecret = `unrelated-${crypto.randomUUID()}`;
    const mcp = JSON.parse(target.mcp.toString("utf8"));
    mcp.mcpServers.unrelated.env = { TOKEN: unrelatedSecret };
    const originalMcp = Buffer.from(`${JSON.stringify(mcp, null, 4)}\n`, "utf8");
    write(target.root, ".mcp.json", originalMcp);

    assert.equal((await run(target.root, pkg.root, "install")).exitCode, 0);
    const stateBytes = fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")));
    assert.equal(stateBytes.includes(unrelatedSecret), false);
    assert.equal(stateBytes.includes(pkg.secret), false);
    assert.equal(
      fs.readdirSync(target.root).some((entry) => entry.startsWith(".kcoderag-nav-recovery-")),
      false,
    );

    assert.equal((await run(target.root, pkg.root, "uninstall")).exitCode, 0);
    assert.deepEqual(fs.readFileSync(path.join(target.root, ".mcp.json")), originalMcp);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Claude update and uninstall preserve unrelated shared-config edits made after install", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-claude-section-life-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    assert.equal((await run(target.root, pkg.root, "install")).exitCode, 0);

    const mcpPath = path.join(target.root, ".mcp.json");
    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    mcp.mcpServers["user-added"] = { command: "keep-me" };
    fs.writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 4)}\n`);
    const settingsPath = path.join(target.root, ".claude/settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    settings.afterInstall = { keep: true };
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 4)}\n`);

    assert.equal((await run(target.root, pkg.root, "status")).output.status, "healthy");
    write(pkg.root, "kcoderag-qa/hooks/grep-nudge.cjs", "qa:section-v2\n");
    assert.equal((await run(target.root, pkg.root, "update")).exitCode, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(mcpPath, "utf8")).mcpServers["user-added"], {
      command: "keep-me",
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, "utf8")).afterInstall, { keep: true });

    assert.equal((await run(target.root, pkg.root, "uninstall")).exitCode, 0);
    const remainingMcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    assert.equal(remainingMcp.mcpServers["kcoderag-qa"], undefined);
    assert.deepEqual(remainingMcp.mcpServers["user-added"], { command: "keep-me" });
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, "utf8")).afterInstall, { keep: true });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Claude rejects malformed UTF-8 in every shared JSON config before any write", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-claude-utf8-"));
  try {
    const pkg = packageFixture(base);
    for (const [name, relativePath, prefix] of [
      ["settings", ".claude/settings.json", "{\"hooks\":{},\"value\":\""],
      ["mcp", ".mcp.json", "{\"mcpServers\":{},\"value\":\""],
    ] as const) {
      const target = targetFixture(base, name);
      write(target.root, relativePath, Buffer.concat([
        Buffer.from(prefix, "utf8"),
        Buffer.from([0x80]),
        Buffer.from("\"}\\n", "utf8"),
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


test("Claude refuses JSON conflicts and managed drift before writes", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-claude-refuse-"));
  try {
    const pkg = packageFixture(base);
    for (const [name, relativePath, value, code] of [
      ["settings-type", ".claude/settings.json", '{"hooks":"wrong"}\n', "invalid_json"],
      ["mcp-type", ".mcp.json", '{"mcpServers":"wrong"}\n', "invalid_json"],
      ["mcp-name", ".mcp.json", '{"mcpServers":{"kcoderag-qa":{"command":"other"}}}\n', "unmanaged_name_conflict"],
      ["skill-name", ".claude/skills/kcoderag-nav/SKILL.md", "unowned\n", "unmanaged_name_conflict"],
    ] as const) {
      const target = targetFixture(base, name);
      write(target.root, relativePath, value);
      const before = snapshot(target.root);
      const result = await run(target.root, pkg.root, "install");
      assert.equal(result.output.code, code);
      assert.deepEqual(snapshot(target.root), before);
    }

    const drift = targetFixture(base, "drift");
    assert.equal((await run(drift.root, pkg.root, "install")).exitCode, 0);
    write(drift.root, ".claude/kcoderag-nav/qa/hooks/grep-nudge.cjs", "edited\n");
    const before = snapshot(drift.root);
    assert.equal((await run(drift.root, pkg.root, "doctor")).output.status, "drifted");
    for (const command of ["update", "uninstall"] as const) {
      const result = await run(drift.root, pkg.root, command);
      assert.equal(result.output.code, "managed_content_changed");
      assert.deepEqual(snapshot(drift.root), before);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Claude symlink and injected transaction failures leave no partial install", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-claude-atomic-"));
  try {
    const pkg = packageFixture(base);
    const rollback = targetFixture(base, "rollback");
    const target = targets.resolveProjectTarget(rollback.root);
    const observation = claude.claudeAdapter.detect({ target, packageRoot: pkg.root });
    const desired = claude.claudeAdapter.renderInstall({
      target,
      packageRoot: pkg.root,
      command: "install",
      environment: "qa",
      observation,
      allowLegacyUserRemoval: false,
      allowLegacyDevMigration: false,
    });
    const before = snapshot(rollback.root);
    assert.throws(() => transaction.applyTransaction(desired, { failAtCommit: 2 }), /transaction_failed/);
    assert.deepEqual(snapshot(rollback.root), before);

    const linked = targetFixture(base, "linked");
    const outside = path.join(base, "outside");
    fs.mkdirSync(outside);
    fs.rmSync(path.join(linked.root, ".claude"), { recursive: true });
    try {
      fs.symlinkSync(outside, path.join(linked.root, ".claude"), "junction");
      const linkedTarget = targets.resolveProjectTarget(linked.root);
      assert.throws(
        () => claude.claudeAdapter.detect({ target: linkedTarget, packageRoot: pkg.root }),
        /symlink_escape/,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Claude exact legacy Dev requires authority and migrates shared JSON to QA atomically", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-claude-legacy-dev-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const mcpPath = path.join(target.root, ".mcp.json");
    const settingsPath = path.join(target.root, ".claude/settings.json");
    const mcp = JSON.parse(target.mcp.toString("utf8"));
    mcp.mcpServers["kcoderag-dev"] = {
      type: "http",
      url: "https://legacy-dev.invalid/mcp",
      headers: { Authorization: "Bearer LEGACY_CLAUDE_SECRET" },
    };
    const settings = JSON.parse(target.settings.toString("utf8"));
    settings.hooks.PreToolUse = [{
      matcher: "^(Grep|Glob|Bash)$",
      hooks: [{ command: "sh \".claude/kcoderag-nav/dev/hooks/run_hook.sh\"" }],
    }];
    fs.writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 4)}\n`);
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 4)}\n`);

    const managed = [
      ".mcp.json",
      ".claude/settings.json",
      ".claude/skills/kcoderag-nav/SKILL.md",
      ...["grep-nudge.cjs", "run_hook.cmd", "run_hook.sh", "update-check.cjs", "update-worker.cjs"]
        .map((asset) => `.claude/kcoderag-nav/dev/hooks/${asset}`),
    ];
    write(target.root, ".claude/skills/kcoderag-nav/SKILL.md", "# legacy dev\n");
    for (const relativePath of managed.filter((item) => item.includes("/dev/hooks/"))) {
      write(target.root, relativePath, `legacy:${path.basename(relativePath)}\n`);
    }
    const originals: Record<string, { kind: "absent" | "base64"; data?: string }> = {};
    const digests: Record<string, string> = {};
    for (const relativePath of managed) {
      const bytes = fs.readFileSync(path.join(target.root, ...relativePath.split("/")));
      digests[relativePath] = crypto.createHash("sha256").update(bytes).digest("hex");
      originals[relativePath] = relativePath === ".mcp.json"
        ? { kind: "base64", data: target.mcp.toString("base64") }
        : relativePath === ".claude/settings.json"
          ? { kind: "base64", data: target.settings.toString("base64") }
          : { kind: "absent" };
    }
    write(target.root, STATE_PATH, `${JSON.stringify({
      schemaVersion: 1,
      packageVersion: "0.1.8",
      host: "claude",
      environment: "dev",
      managedFiles: [...managed, STATE_PATH].sort((left, right) => {
        if (left === STATE_PATH) return 1;
        if (right === STATE_PATH) return -1;
        return left.localeCompare(right);
      }),
      originals,
      digests,
    }, null, 2)}\n`);

    const legacyHookPath = ".claude/kcoderag-nav/dev/hooks/grep-nudge.cjs";
    const legacyHookBytes = fs.readFileSync(path.join(target.root, ...legacyHookPath.split("/")));
    write(target.root, legacyHookPath, "locally drifted\n");
    const drifted = snapshot(target.root);
    const driftRefusal = await run(target.root, pkg.root, "update", true);
    assert.equal(driftRefusal.output.code, "managed_content_changed");
    assert.deepEqual(snapshot(target.root), drifted);
    write(target.root, legacyHookPath, legacyHookBytes);

    const before = snapshot(target.root);
    const preview = await run(target.root, pkg.root, "doctor");
    assert.equal(preview.output.status, "update_available");
    assert.match(JSON.stringify(preview.output), /legacy_migration_available/);
    assert.deepEqual(snapshot(target.root), before);

    const denied = await run(target.root, pkg.root, "update");
    assert.equal(denied.output.code, "legacy_dev_migration_authority_required");
    assert.deepEqual(snapshot(target.root), before);

    const resolvedTarget = targets.resolveProjectTarget(target.root);
    const observation = claude.claudeAdapter.detect({ target: resolvedTarget, packageRoot: pkg.root });
    const desired = claude.claudeAdapter.renderInstall({
      target: resolvedTarget,
      packageRoot: pkg.root,
      command: "update",
      environment: "qa",
      observation,
      allowLegacyUserRemoval: false,
      allowLegacyDevMigration: true,
    });
    for (let failAtCommit = 0; failAtCommit < desired.entries.length; failAtCommit += 1) {
      assert.throws(
        () => transaction.applyTransaction(desired, { failAtCommit }),
        /transaction_failed/,
      );
      assert.deepEqual(snapshot(target.root), before, `failAtCommit=${failAtCommit}`);
    }

    const migrated = await run(target.root, pkg.root, "update", true);
    assert.equal(migrated.exitCode, 0);
    assert.doesNotMatch(migrated.stdout.join("\n") + migrated.stderr.join("\n"), /LEGACY_CLAUDE_SECRET/);
    const currentState = JSON.parse(fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")), "utf8"));
    assert.equal(currentState.environment, "qa");
    assert.ok(currentState.managedFiles.every((relativePath: string) => !relativePath.includes("/dev/")));
    const currentMcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    assert.equal(currentMcp.mcpServers["kcoderag-dev"], undefined);
    assert.ok(currentMcp.mcpServers["kcoderag-qa"]);
    assert.deepEqual(currentMcp.mcpServers.unrelated, { command: "safe-command" });
    assert.equal((await run(target.root, pkg.root, "status")).output.status, "healthy");

    assert.equal((await run(target.root, pkg.root, "uninstall")).exitCode, 0);
    assert.deepEqual(fs.readFileSync(mcpPath), target.mcp);
    assert.deepEqual(fs.readFileSync(settingsPath), target.settings);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Claude exact inventory exposes only the observed scoped native plugin cleanup", async () => {
  const calls: NativeRequest[] = [];
  const adapter = claude.createClaudeAdapter({
    runner: async (request: NativeRequest) => {
      calls.push(request);
      const command = [request.executable, ...request.args].join(" ");
      if (command === "claude plugin list --json") {
        return { exitCode: 0, timedOut: false, stdout: claudePluginInventory() };
      }
      if (command === "claude plugin marketplace list --json") {
        return { exitCode: 0, timedOut: false, stdout: claudeMarketplaceInventory() };
      }
      return healthyClaudeNativeResult(request);
    },
    readUserSources: () => emptyClaudeUserSources(),
  });

  const scan = await claudeScannerContext(adapter, "deep");
  assert.equal(scan.hasConflict, true);
  assert.equal(scan.cleanupPlans.length, 1);
  assert.equal(
    scan.cleanupPlans[0].command,
    "claude plugin uninstall kcoderag-qa@kcoderag-nav --scope user",
  );
  assert.equal(scan.cleanupPlans[0].capability.inventorySchemaId, "claude-plugin-v2.1.241-array-v1");
  assert.match(scan.cleanupPlans[0].fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(scan.findings[0].cleanupFingerprint, scan.cleanupPlans[0].fingerprint);
  assert.ok(calls.every((call) => call.executable === "claude" && call.timeoutMs === 5_000));
  assert.deepEqual(calls.map((call) => call.args.join(" ")), [
    "--version",
    "plugin list --help",
    "plugin marketplace list --help",
    "plugin uninstall --help",
    "plugin marketplace remove --help",
    "plugin list --json",
    "plugin marketplace list --json",
  ]);
});

test("Claude accepts bounded project metadata and URL marketplace inventory variants", async () => {
  const sentinel = `Bearer-${crypto.randomUUID()}`;
  const pluginInventory = claudePluginInventory({
    scope: "project",
    projectPath: path.join(os.tmpdir(), "project"),
    mcpServers: { ignored: { authorization: sentinel } },
  });
  const marketplaceInventory = JSON.stringify([{
    name: "kcoderag-nav",
    source: "url",
    url: `https://marketplace.invalid/${sentinel}`,
    installLocation: path.join(os.tmpdir(), ".claude", "plugins", "marketplaces", "kcoderag-nav"),
  }]);
  const adapter = claude.createClaudeAdapter({
    runner: async (request: NativeRequest) => {
      const command = [request.executable, ...request.args].join(" ");
      if (command === "claude plugin list --json") {
        return { exitCode: 0, timedOut: false, stdout: pluginInventory };
      }
      if (command === "claude plugin marketplace list --json") {
        return { exitCode: 0, timedOut: false, stdout: marketplaceInventory };
      }
      return healthyClaudeNativeResult(request);
    },
    readUserSources: () => emptyClaudeUserSources(),
  });

  const scan = await claudeScannerContext(adapter, "deep");
  assert.equal(scan.cleanupPlans.length, 1);
  assert.equal(
    scan.cleanupPlans[0].command,
    "claude plugin uninstall kcoderag-qa@kcoderag-nav --scope project",
  );
  assert.ok(scan.findings.every((finding: Record<string, unknown>) =>
    finding.code !== "source_scan_unavailable"));
  assert.doesNotMatch(JSON.stringify(scan), new RegExp(sentinel));
});

test("Claude distinguishes repeated project plugin ids by project path", async () => {
  const first = JSON.parse(claudePluginInventory({
    id: "foreign@other-marketplace",
    scope: "project",
    projectPath: path.join(os.tmpdir(), "project-a"),
    mcpServers: {},
  }))[0];
  const second = {
    ...first,
    projectPath: path.join(os.tmpdir(), "project-b"),
  };
  const adapter = claude.createClaudeAdapter({
    runner: async (request: NativeRequest) => {
      const command = [request.executable, ...request.args].join(" ");
      if (command === "claude plugin list --json") {
        return { exitCode: 0, timedOut: false, stdout: JSON.stringify([first, second]) };
      }
      if (command === "claude plugin marketplace list --json") {
        return { exitCode: 0, timedOut: false, stdout: "[]" };
      }
      return healthyClaudeNativeResult(request);
    },
    readUserSources: () => emptyClaudeUserSources(),
  });

  const scan = await claudeScannerContext(adapter, "deep");
  assert.equal(scan.hasConflict, false);
  assert.ok(scan.findings.every((finding: Record<string, unknown>) =>
    finding.code !== "source_scan_unavailable"));
});

test("Claude rejects malformed neighbors of the accepted inventory variants", async () => {
  const sentinel = `Bearer-${crypto.randomUUID()}`;
  const validUrlMarketplace = JSON.stringify([{
    name: "kcoderag-nav",
    source: "url",
    url: "https://marketplace.invalid/catalog",
    installLocation: path.join(os.tmpdir(), ".claude", "plugins", "marketplaces", "kcoderag-nav"),
  }]);
  const bothMarketplaceLocations = JSON.stringify([{
    name: "kcoderag-nav",
    source: "url",
    repo: "Tooc0ld/kcoderag-nav",
    url: "https://marketplace.invalid/catalog",
    installLocation: path.join(os.tmpdir(), ".claude", "plugins", "marketplaces", "kcoderag-nav"),
  }]);
  const duplicateProjectPlugin = JSON.parse(claudePluginInventory({
    id: "foreign@other-marketplace",
    scope: "project",
    projectPath: path.join(os.tmpdir(), "same-project"),
    mcpServers: {},
  }))[0];
  const variants = [
    {
      plugins: claudePluginInventory({ projectPath: { sentinel } }),
      marketplaces: validUrlMarketplace,
    },
    {
      plugins: claudePluginInventory({ mcpServers: [sentinel] }),
      marketplaces: validUrlMarketplace,
    },
    {
      plugins: claudePluginInventory(),
      marketplaces: bothMarketplaceLocations,
    },
    {
      plugins: JSON.stringify([duplicateProjectPlugin, { ...duplicateProjectPlugin }]),
      marketplaces: "[]",
    },
  ];

  for (const variant of variants) {
    const adapter = claude.createClaudeAdapter({
      runner: async (request: NativeRequest) => {
        const command = [request.executable, ...request.args].join(" ");
        if (command === "claude plugin list --json") {
          return { exitCode: 0, timedOut: false, stdout: variant.plugins };
        }
        if (command === "claude plugin marketplace list --json") {
          return { exitCode: 0, timedOut: false, stdout: variant.marketplaces };
        }
        return healthyClaudeNativeResult(request);
      },
      readUserSources: () => emptyClaudeUserSources(),
    });
    const scan = await claudeScannerContext(adapter, "deep");
    assert.equal(scan.cleanupPlans.length, 0);
    assert.ok(scan.findings.some((finding: Record<string, unknown>) =>
      finding.code === "source_scan_unavailable"));
    assert.doesNotMatch(JSON.stringify(scan), new RegExp(sentinel));
  }
});

test("Claude does not classify KCodeRag settings outside hooks as manual Hook sources", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-claude-user-"));
  try {
    write(home, ".claude.json", `${JSON.stringify({ projects: {} })}\n`);
    const settingsPath = ".claude/settings.json";
    write(home, settingsPath, `${JSON.stringify({
      hooks: { Stop: [{ matcher: "*", hooks: [] }] },
      enabledPlugins: { "kcoderag-nav": false },
      extraKnownMarketplaces: {
        archived: { source: { source: "github", repo: "Tooc0ld/kcoderag-nav" } },
      },
    }, null, 2)}\n`);
    const adapter = claude.createClaudeAdapter({
      homeDirectory: home,
      runner: async (request: NativeRequest) => healthyClaudeNativeResult(request),
    });

    const scan = await claudeScannerContext(adapter, "deep");
    assert.equal(scan.hasConflict, false);
    assert.ok(scan.findings.every((finding: Record<string, unknown>) =>
      finding.code !== "manual_hook_source"));

    write(home, settingsPath, `${JSON.stringify({
      hooks: {
        PreToolUse: [{
          matcher: "Grep",
          hooks: [{ type: "command", command: ".claude/kcoderag-nav/qa/hooks/run_hook.sh" }],
        }],
      },
      enabledPlugins: { "kcoderag-nav": false },
    }, null, 2)}\n`);
    const actualHook = await claudeScannerContext(adapter, "deep");
    assert.equal(actualHook.hasConflict, true);
    assert.ok(actualHook.findings.some((finding: Record<string, unknown>) =>
      finding.code === "manual_hook_source"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Claude scan modes keep disabled/cache residue informational and raw/manual sources manual-only", async () => {
  const adapter = claude.createClaudeAdapter({
    runner: async (request: NativeRequest) => {
      const command = [request.executable, ...request.args].join(" ");
      if (command === "claude plugin list --json") {
        return { exitCode: 0, timedOut: false, stdout: claudePluginInventory({ enabled: false }) };
      }
      if (command === "claude plugin marketplace list --json") {
        return { exitCode: 0, timedOut: false, stdout: claudeMarketplaceInventory() };
      }
      return healthyClaudeNativeResult(request);
    },
    readUserSources: () => emptyClaudeUserSources({
      rawMcpPaths: [".claude.json"],
      manualHookPaths: [".claude/settings.json"],
      cachePaths: [".claude/plugins/cache/kcoderag-nav"],
    }),
  });

  const fast = await claudeScannerContext(adapter, "fast");
  assert.deepEqual(new Set(fast.findings.map((finding: Record<string, unknown>) => finding.sourceType)),
    new Set(["raw_mcp", "manual_hook", "owned_marketplace_registration"]));
  assert.equal(fast.cleanupPlans.length, 0);

  const deep = await claudeScannerContext(adapter, "deep");
  assert.deepEqual(
    new Set(deep.findings.map((finding: Record<string, unknown>) => finding.sourceType)),
    new Set([
      "raw_mcp",
      "manual_hook",
      "cache_residue",
      "disabled_registration",
      "owned_marketplace_registration",
    ]),
  );
  assert.equal(deep.cleanupPlans.length, 0);
  assert.ok(deep.findings.every((finding: Record<string, unknown>) => finding.cleanupEligible === false));
});

test("Claude marketplace cleanup requires one complete exclusively owned scope", async () => {
  async function scanWith(pluginInventory: string, marketplaceInventory = claudeMarketplaceInventory()) {
    const adapter = claude.createClaudeAdapter({
      runner: async (request: NativeRequest) => {
        const command = [request.executable, ...request.args].join(" ");
        if (command === "claude plugin list --json") {
          return { exitCode: 0, timedOut: false, stdout: pluginInventory };
        }
        if (command === "claude plugin marketplace list --json") {
          return { exitCode: 0, timedOut: false, stdout: marketplaceInventory };
        }
        return healthyClaudeNativeResult(request);
      },
      readUserSources: () => emptyClaudeUserSources(),
    });
    return claudeScannerContext(adapter, "gate");
  }

  const exclusive = await scanWith(claudePluginInventory({ enabled: false }));
  assert.equal(exclusive.cleanupPlans.length, 1);
  assert.equal(
    exclusive.cleanupPlans[0].command,
    "claude plugin marketplace remove kcoderag-nav --scope user",
  );

  const foreign = JSON.parse(claudePluginInventory({ enabled: false }));
  foreign.push({ ...foreign[0], id: "foreign@kcoderag-nav" });
  const shared = await scanWith(JSON.stringify(foreign));
  assert.equal(shared.hasConflict, true);
  assert.equal(shared.cleanupPlans.length, 0);
  assert.ok(shared.findings.every((finding: Record<string, unknown>) => finding.cleanupEligible === false));

  const mixedScopes = JSON.parse(claudePluginInventory({ enabled: false }));
  mixedScopes.push({ ...mixedScopes[0], id: "kcoderag-dev@kcoderag-nav", scope: "project" });
  const ambiguous = await scanWith(JSON.stringify(mixedScopes));
  assert.equal(ambiguous.cleanupPlans.length, 0);
});

test("Claude rejects old capability and malformed process schemas without leaking process bodies", async () => {
  const sentinel = `Bearer-${crypto.randomUUID()}`;
  const scenarios = [
    async (request: NativeRequest): Promise<NativeResult> => {
      if (request.args.join(" ") === "--version") {
        return { exitCode: 0, timedOut: false, stdout: "2.1.240 (Claude Code)\n" };
      }
      return healthyClaudeNativeResult(request);
    },
    async (request: NativeRequest): Promise<NativeResult> => {
      if (request.args.join(" ") === "plugin uninstall --help") {
        return { exitCode: 0, timedOut: false, stdout: `unknown ${sentinel}` };
      }
      return healthyClaudeNativeResult(request);
    },
    async (request: NativeRequest): Promise<NativeResult> => {
      if (request.args.join(" ") === "plugin list --json") {
        return { exitCode: 0, timedOut: false, stdout: JSON.stringify([{ id: sentinel }]) };
      }
      return healthyClaudeNativeResult(request);
    },
    async (_request: NativeRequest): Promise<NativeResult> => { throw new Error(sentinel); },
  ];
  for (const runner of scenarios) {
    const adapter = claude.createClaudeAdapter({
      runner,
      readUserSources: () => emptyClaudeUserSources(),
    });
    const scan = await claudeScannerContext(adapter, "gate");
    assert.equal(scan.hasConflict, true);
    assert.equal(scan.cleanupPlans.length, 0);
    assert.ok(scan.findings.some((finding: Record<string, unknown>) =>
      finding.code === "source_scan_unavailable"));
    assert.doesNotMatch(JSON.stringify(scan), new RegExp(sentinel));
  }
});

test("Claude cleanup uses fixed argv then requires a complete clean rescan", async () => {
  let removed = false;
  const calls: string[] = [];
  const sentinel = `Bearer-${crypto.randomUUID()}`;
  const adapter = claude.createClaudeAdapter({
    runner: async (request: NativeRequest) => {
      const command = [request.executable, ...request.args].join(" ");
      calls.push(command);
      if (command === "claude plugin list --json") {
        return {
          exitCode: 0,
          timedOut: false,
          stdout: removed ? EMPTY_CLAUDE_PLUGIN_INVENTORY : claudePluginInventory(),
        };
      }
      if (command === "claude plugin marketplace list --json") {
        return {
          exitCode: 0,
          timedOut: false,
          stdout: removed ? EMPTY_CLAUDE_MARKETPLACE_INVENTORY : claudeMarketplaceInventory(),
        };
      }
      if (command === "claude plugin uninstall kcoderag-qa@kcoderag-nav --scope user") {
        removed = true;
        return { exitCode: 0, timedOut: false, stdout: sentinel };
      }
      return healthyClaudeNativeResult(request);
    },
    readUserSources: () => emptyClaudeUserSources(),
  });
  const initial = await claudeScannerContext(adapter, "gate");
  const plan = initial.cleanupPlans[0] as Record<string, any>;
  assert.ok(plan);
  if (adapter.cleanupOwnedSource === undefined) throw new Error("cleanup missing");
  const after = await adapter.cleanupOwnedSource(plan, {
    allowOwnedSourceCleanup: true,
    cleanupFingerprint: plan.fingerprint,
  });
  assert.equal(after.hasConflict, false);
  assert.equal(after.cleanupPlans.length, 0);
  assert.equal(
    calls.filter((command) => command ===
      "claude plugin uninstall kcoderag-qa@kcoderag-nav --scope user").length,
    1,
  );
  assert.doesNotMatch(JSON.stringify(after), new RegExp(sentinel));
});
