const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type EnvironmentId = "qa" | "dev";
type HostId = "codex" | "claude" | "cursor" | "opencode";

interface CursorModule {
  readonly cursorAdapter: Record<string, any>;
  createCursorAdapter(options?: {
    readonly legacyLocalRoot?: string;
    readonly homeDirectory?: string;
    readonly readUserSources?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  }): Record<string, any>;
  migrateCursorLegacyInstall(
    desired: Record<string, unknown>,
    observation: Record<string, unknown>,
    options?: {
      readonly failAtLegacyDelete?: number;
      readonly onBeforeLegacyMutation?: (operation: string, legacyPath: string) => void;
    },
  ): unknown;
}

interface CommandModule {
  executeCommand(argv: string[], dependencies: Record<string, unknown>): Promise<number>;
}

const cursor = require("../../dist/hosts/cursor.cjs") as CursorModule;
const commands = require("../../dist/cli/commands.cjs") as CommandModule;
const targets = require("../../dist/core/project-target.cjs") as {
  resolveProjectTarget(target: string): Record<string, unknown>;
};
const transaction = require("../../dist/core/transaction.cjs") as {
  applyTransaction(desired: Record<string, unknown>, options?: { readonly failAtCommit?: number }): unknown;
};

const STATE_PATH = ".cursor/kcoderag-nav/install-state.json";
const LEGACY_STATE = ".kcoderag-nav.install-state.json";

function emptyCursorUserSources(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activePluginPaths: [],
    rawMcpPaths: [],
    manualRulePaths: [],
    cachePaths: [],
    disabledPaths: [],
    ambiguousPaths: [],
    ...overrides,
  };
}

function cursorScannerContext(
  adapter: Record<string, any>,
  mode: "fast" | "deep" | "gate",
): Promise<Record<string, any>> {
  const target = { root: path.resolve(".") };
  if (typeof adapter.scanUserSources !== "function") throw new Error("scanner missing");
  return adapter.scanUserSources({
    mode,
    target,
    packageRoot: path.resolve("."),
    observation: { host: "cursor", target },
  });
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function treeDigest(files: Readonly<Record<string, string>>): string {
  const identity = Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, digest]) => `${relativePath}\0${digest}\n`)
    .join("");
  return sha256(identity);
}

function write(root: string, relativePath: string, value: string | Buffer): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, value);
}

function packageFixture(base: string) {
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
    write(root, `${name}/hooks/mcp-call-marker.cjs`, `${environment}:marker\n`);
    write(root, `${name}/hooks/update-check.cjs`, `${environment}:check\n`);
    write(root, `${name}/hooks/update-notice.cjs`, `${environment}:notice\n`);
    write(root, `${name}/hooks/update-worker.cjs`, `${environment}:worker\n`);
  }
  write(root, "kcoderag-cursor/rules/kcoderag-navigation.mdc", "---\nalwaysApply: true\n---\nUse KCodeRag.\n");
  write(root, "kcoderag-cursor/skills/code-lookup-discipline/SKILL.md", "# Cursor lookup\n");
  return { root, secret };
}

function targetFixture(base: string, name = "target") {
  const root = path.join(base, name);
  fs.mkdirSync(root);
  const mcp = Buffer.from(`${JSON.stringify({
    mcpServers: { unrelated: { command: "safe-command" } },
    unrelated: true,
  }, null, 4)}\n`);
  write(root, ".cursor/mcp.json", mcp);
  write(root, ".cursor/rules/unrelated.mdc", "unrelated\n");
  write(root, ".cursor/skills/unrelated/SKILL.md", "# unrelated\n");
  return { root, mcp };
}

function snapshot(root: string): readonly string[] {
  if (!fs.existsSync(root)) return [];
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
        records.push(`f:${relative}:${sha256(fs.readFileSync(absolute))}`);
      }
    }
  };
  visit(root);
  return records;
}

function legacyFixture(
  base: string,
  pkg: ReturnType<typeof packageFixture>,
  environment: EnvironmentId,
) {
  const localRoot = path.join(base, `legacy-${environment}`);
  const pluginRoot = path.join(localRoot, "kcoderag-nav");
  fs.mkdirSync(pluginRoot, { recursive: true });
  const profile = {
    url: `https://${environment}.invalid/mcp`,
    bearer: `${pkg.secret}-${environment}`,
  };
  write(pluginRoot, ".cursor-plugin/plugin.json", `${JSON.stringify({
    name: "kcoderag-nav",
    version: "0.1.4",
    variables: {
      properties: {
        KCODERAG_MCP_URL: { default: profile.url },
        KCODERAG_BEARER_TOKEN: { default: profile.bearer },
      },
    },
  })}\n`);
  write(pluginRoot, "mcp.json", '{"mcpServers":{"kcoderag":{"url":"${KCODERAG_MCP_URL}"}}}\n');
  write(pluginRoot, "rules/kcoderag-navigation.mdc", "legacy rule\n");
  write(pluginRoot, "skills/code-lookup-discipline/SKILL.md", "legacy skill\n");
  const files: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files[path.relative(pluginRoot, absolute).split(path.sep).join("/")] = sha256(fs.readFileSync(absolute));
    }
  };
  visit(pluginRoot);
  write(localRoot, LEGACY_STATE, `${JSON.stringify({
    schema_version: 1,
    plugin_name: "kcoderag-nav",
    package_version: "0.1.4",
    tree_digest: treeDigest(files),
    files,
  }, null, 2)}\n`);
  write(localRoot, "other-plugin/keep.txt", "keep\n");
  return { localRoot, pluginRoot };
}

async function run(
  target: string,
  packageRoot: string,
  adapter: Record<string, unknown>,
  command: "install" | "status" | "doctor" | "update" | "uninstall",
  allowLegacyUserRemoval = false,
  allowLegacyDevMigration = false,
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const argv = [command, "--host", "cursor", "--json"];
  if (["install", "update", "uninstall"].includes(command)) argv.push("--yes");
  if (allowLegacyUserRemoval) argv.push("--allow-legacy-user-removal");
  if (allowLegacyDevMigration) argv.push("--allow-legacy-dev-migration");
  const exitCode = await commands.executeCommand(argv, {
    cwd: target,
    packageRoot,
    nodeVersion: "22.20.0",
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    getAdapter: (host: HostId) => {
      if (host !== "cursor") throw new Error("unexpected host");
      return adapter;
    },
  });
  return {
    exitCode,
    stdout,
    stderr,
    output: JSON.parse(stdout[0] ?? "{}") as Record<string, unknown>,
  };
}

test("Cursor lifecycle uses Rule, skill, MCP, success marker, and postToolUse update notice", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-life-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const installed = await run(target.root, pkg.root, cursor.cursorAdapter, "install");
    assert.equal(installed.exitCode, 0);
    assert.doesNotMatch(installed.stdout.join("\n") + installed.stderr.join("\n"), new RegExp(pkg.secret));
    const document = JSON.parse(fs.readFileSync(path.join(target.root, ".cursor/mcp.json"), "utf8"));
    assert.deepEqual(Object.keys(document.mcpServers).sort(), ["kcoderag", "unrelated"]);
    assert.equal(fs.existsSync(path.join(target.root, ".cursor/rules/kcoderag-navigation.mdc")), true);
    assert.equal(fs.existsSync(path.join(target.root, ".cursor/skills/kcoderag-nav/SKILL.md")), true);
    const hooks = JSON.parse(fs.readFileSync(path.join(target.root, ".cursor/hooks.json"), "utf8"));
    assert.equal(hooks.hooks.afterMCPExecution.length, 1);
    assert.equal(hooks.hooks.postToolUse.length, 1);
    assert.match(JSON.stringify(hooks), /mcp-call-marker\.cjs cursor/u);
    assert.equal(
      hooks.hooks.postToolUse[0].command,
      "node .cursor/kcoderag-nav/hooks/update-notice.cjs cursor",
    );
    assert.equal(fs.existsSync(path.join(target.root, ".cursor/kcoderag-nav/hooks/mcp-call-marker.cjs")), true);
    assert.equal(fs.existsSync(path.join(target.root, ".cursor/kcoderag-nav/hooks/update-notice.cjs")), true);
    const installedTree = snapshot(target.root);

    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "status")).output.status, "healthy");
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "doctor")).output.status, "healthy");
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "install")).exitCode, 0);
    assert.deepEqual(snapshot(target.root), installedTree);

    const state = JSON.parse(fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")), "utf8"));
    assert.equal(state.environment, "qa");

    write(pkg.root, "kcoderag-cursor/rules/kcoderag-navigation.mdc", "updated rule\n");
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "status")).output.status, "update_available");
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "update")).exitCode, 0);
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "uninstall")).exitCode, 0);
    assert.deepEqual(fs.readFileSync(path.join(target.root, ".cursor/mcp.json")), target.mcp);
    assert.equal(fs.existsSync(path.join(target.root, ".cursor/rules/kcoderag-navigation.mdc")), false);
    assert.equal(fs.existsSync(path.join(target.root, ".cursor/skills/kcoderag-nav/SKILL.md")), false);
    assert.equal(fs.existsSync(path.join(target.root, ".cursor/hooks.json")), false);
    assert.equal(fs.existsSync(path.join(target.root, ".cursor/kcoderag-nav/hooks/mcp-call-marker.cjs")), false);
    assert.equal(fs.existsSync(path.join(target.root, ".cursor/kcoderag-nav/hooks/update-notice.cjs")), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Cursor exact project legacy Dev requires dedicated authority and converts to QA", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-project-legacy-dev-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "install")).exitCode, 0);

    const mcpPath = path.join(target.root, ".cursor/mcp.json");
    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    mcp.mcpServers.kcoderag = {
      type: "http",
      url: "https://legacy-cursor-dev.invalid/mcp",
      headers: { Authorization: "Bearer LEGACY_CURSOR_PROJECT_SECRET" },
    };
    fs.writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 4)}\n`);
    const statePath = path.join(target.root, ...STATE_PATH.split("/"));
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    for (const relativePath of [
      ".cursor/hooks.json",
      ".cursor/kcoderag-nav/hooks/mcp-call-marker.cjs",
    ]) {
      state.managedFiles = state.managedFiles.filter((candidate: string) => candidate !== relativePath);
      delete state.originals[relativePath];
      delete state.digests[relativePath];
      delete state.sections[relativePath];
      fs.rmSync(path.join(target.root, ...relativePath.split("/")), { force: true });
    }
    state.environment = "dev";
    state.sections[".cursor/mcp.json"].digest = sha256(
      Buffer.from(JSON.stringify(mcp.mcpServers.kcoderag), "utf8"),
    );
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const before = snapshot(target.root);
    const preview = await run(target.root, pkg.root, cursor.cursorAdapter, "doctor");
    assert.equal(preview.output.status, "update_available");
    assert.match(JSON.stringify(preview.output), /legacy_migration_available/);
    assert.deepEqual(snapshot(target.root), before);

    const denied = await run(target.root, pkg.root, cursor.cursorAdapter, "update");
    assert.equal(denied.output.code, "legacy_dev_migration_authority_required");
    assert.deepEqual(snapshot(target.root), before);

    const resolvedTarget = targets.resolveProjectTarget(target.root);
    const observation = cursor.cursorAdapter.detect({ target: resolvedTarget, packageRoot: pkg.root });
    const desired = cursor.cursorAdapter.renderInstall({
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

    const migrated = await run(target.root, pkg.root, cursor.cursorAdapter, "update", false, true);
    assert.equal(migrated.exitCode, 0);
    assert.doesNotMatch(migrated.stdout.join("\n") + migrated.stderr.join("\n"), /LEGACY_CURSOR_PROJECT_SECRET/);
    const currentState = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(currentState.environment, "qa");
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "status")).output.status, "healthy");
    const currentMcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    assert.deepEqual(currentMcp.mcpServers.unrelated, { command: "safe-command" });

    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "uninstall")).exitCode, 0);
    assert.deepEqual(fs.readFileSync(mcpPath), target.mcp);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Cursor install state never snapshots shared-config credentials", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-secret-state-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const unrelatedSecret = `unrelated-${crypto.randomUUID()}`;
    const mcp = JSON.parse(target.mcp.toString("utf8"));
    mcp.mcpServers.unrelated.env = { TOKEN: unrelatedSecret };
    const originalMcp = Buffer.from(`${JSON.stringify(mcp, null, 4)}\n`, "utf8");
    write(target.root, ".cursor/mcp.json", originalMcp);

    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "install")).exitCode, 0);
    const stateBytes = fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")));
    assert.equal(stateBytes.includes(unrelatedSecret), false);
    assert.equal(stateBytes.includes(pkg.secret), false);
    assert.equal(
      fs.readdirSync(target.root).some((entry) => entry.startsWith(".kcoderag-nav-recovery-")),
      false,
    );

    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "uninstall")).exitCode, 0);
    assert.deepEqual(fs.readFileSync(path.join(target.root, ".cursor/mcp.json")), originalMcp);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Cursor update and uninstall preserve unrelated MCP edits made after install", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-section-life-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "install")).exitCode, 0);

    const mcpPath = path.join(target.root, ".cursor/mcp.json");
    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    mcp.mcpServers["user-added"] = { command: "keep-me" };
    fs.writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 4)}\n`);

    assert.equal(
      (await run(target.root, pkg.root, cursor.cursorAdapter, "status")).output.status,
      "healthy",
    );
    write(pkg.root, "kcoderag-cursor/rules/kcoderag-navigation.mdc", "updated section rule\n");
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "update")).exitCode, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(mcpPath, "utf8")).mcpServers["user-added"], {
      command: "keep-me",
    });

    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "uninstall")).exitCode, 0);
    const remainingMcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    assert.equal(remainingMcp.mcpServers.kcoderag, undefined);
    assert.deepEqual(remainingMcp.mcpServers["user-added"], { command: "keep-me" });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Cursor preserves a pre-existing empty mcpServers container across install update and uninstall", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-empty-parent-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const mcpPath = path.join(target.root, ".cursor", "mcp.json");
    const original = "{ \"mcpServers\" : {} }\n";
    fs.writeFileSync(mcpPath, original, "utf8");

    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "install")).exitCode, 0);
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "update")).exitCode, 0);
    const installState = JSON.parse(fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")), "utf8"));
    assert.deepEqual(installState.sections[".cursor/mcp.json"].createdContainers, []);
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "uninstall")).exitCode, 0);
    assert.equal(fs.readFileSync(mcpPath, "utf8"), original);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Cursor rejects malformed UTF-8 in MCP JSON before any write", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-utf8-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    write(target.root, ".cursor/mcp.json", Buffer.concat([
      Buffer.from("{\"mcpServers\":{},\"value\":\"", "utf8"),
      Buffer.from([0x80]),
      Buffer.from("\"}\\n", "utf8"),
    ]));
    const before = snapshot(target.root);
    const result = await run(target.root, pkg.root, cursor.cursorAdapter, "install");
    assert.equal(result.output.code, "invalid_utf8");
    assert.deepEqual(snapshot(target.root), before);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});


test("Cursor conflicts, drift, symlinks, and transaction failure are zero-write", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-refuse-"));
  try {
    const pkg = packageFixture(base);
    for (const [name, relativePath, value, code] of [
      ["mcp-type", ".cursor/mcp.json", '{"mcpServers":"wrong"}\n', "invalid_json"],
      ["mcp-name", ".cursor/mcp.json", '{"mcpServers":{"kcoderag":{"command":"other"}}}\n', "unmanaged_name_conflict"],
      ["rule-name", ".cursor/rules/kcoderag-navigation.mdc", "unowned\n", "unmanaged_name_conflict"],
    ] as const) {
      const target = targetFixture(base, name);
      write(target.root, relativePath, value);
      const before = snapshot(target.root);
      assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "install")).output.code, code);
      assert.deepEqual(snapshot(target.root), before);
    }

    const drift = targetFixture(base, "drift");
    assert.equal((await run(drift.root, pkg.root, cursor.cursorAdapter, "install")).exitCode, 0);
    write(drift.root, ".cursor/rules/kcoderag-navigation.mdc", "edited\n");
    const beforeDrift = snapshot(drift.root);
    assert.equal((await run(drift.root, pkg.root, cursor.cursorAdapter, "doctor")).output.status, "drifted");
    assert.equal((await run(drift.root, pkg.root, cursor.cursorAdapter, "uninstall")).output.code, "managed_content_changed");
    assert.deepEqual(snapshot(drift.root), beforeDrift);

    const rollback = targetFixture(base, "rollback");
    const target = targets.resolveProjectTarget(rollback.root);
    const observation = cursor.cursorAdapter.detect({ target, packageRoot: pkg.root });
    const desired = cursor.cursorAdapter.renderInstall({
      target,
      packageRoot: pkg.root,
      command: "install",
      environment: "qa",
      observation,
      allowLegacyUserRemoval: false,
      allowLegacyDevMigration: false,
    });
    const beforeRollback = snapshot(rollback.root);
    assert.throws(() => transaction.applyTransaction(desired, { failAtCommit: 1 }), /transaction_failed/);
    assert.deepEqual(snapshot(rollback.root), beforeRollback);

    const linked = targetFixture(base, "linked");
    const outside = path.join(base, "outside");
    fs.mkdirSync(outside);
    fs.rmSync(path.join(linked.root, ".cursor"), { recursive: true });
    try {
      fs.symlinkSync(outside, path.join(linked.root, ".cursor"), "junction");
      const linkedTarget = targets.resolveProjectTarget(linked.root);
      assert.throws(
        () => cursor.cursorAdapter.detect({ target: linkedTarget, packageRoot: pkg.root }),
        /symlink_escape/,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("legacy Cursor user plugin removal requires independent authority and always installs QA", async () => {
  for (const environment of ["qa", "dev"] as const) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `kcoderag-cursor-legacy-${environment}-`));
    try {
      const pkg = packageFixture(base);
      const target = targetFixture(base);
      const legacy = legacyFixture(base, pkg, environment);
      const adapter = cursor.createCursorAdapter({ legacyLocalRoot: legacy.localRoot });
      const observed = adapter.detect({
        target: targets.resolveProjectTarget(target.root),
        packageRoot: pkg.root,
      });
      assert.equal(observed.legacyUserRemoval.path, fs.realpathSync(legacy.pluginRoot));
      const projectBefore = snapshot(target.root);
      const userBefore = snapshot(legacy.localRoot);

      const denied = await run(target.root, pkg.root, adapter, "install");
      assert.equal(denied.output.code, "legacy_removal_authority_required");
      assert.deepEqual(snapshot(target.root), projectBefore);
      assert.deepEqual(snapshot(legacy.localRoot), userBefore);

      const migrated = await run(target.root, pkg.root, adapter, "install", true);
      assert.equal(migrated.exitCode, 0);
      assert.doesNotMatch(migrated.stdout.join("\n") + migrated.stderr.join("\n"), new RegExp(pkg.secret));
      assert.equal((await run(target.root, pkg.root, adapter, "status")).output.status, "healthy");
      assert.equal(fs.existsSync(path.join(legacy.localRoot, LEGACY_STATE)), false);
      assert.equal(fs.existsSync(legacy.pluginRoot), false);
      assert.equal(fs.readFileSync(path.join(legacy.localRoot, "other-plugin/keep.txt"), "utf8"), "keep\n");
      const state = JSON.parse(fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")), "utf8"));
      assert.equal(state.environment, "qa");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }
});

test("legacy drift, extra files, unknown environment, and delete failure preserve both trees", async () => {
  const cases = ["invalid-state", "digest-drift", "extra-file", "extra-directory"] as const;
  for (const kind of cases) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `kcoderag-cursor-${kind}-`));
    try {
      const pkg = packageFixture(base);
      const target = targetFixture(base);
      const legacy = legacyFixture(base, pkg, "qa");
      if (kind === "invalid-state") write(legacy.localRoot, LEGACY_STATE, "{broken\n");
      if (kind === "digest-drift") write(legacy.pluginRoot, "rules/kcoderag-navigation.mdc", "edited\n");
      if (kind === "extra-file") write(legacy.pluginRoot, "extra.txt", "extra\n");
      if (kind === "extra-directory") fs.mkdirSync(path.join(legacy.pluginRoot, "extra-empty"));
      const adapter = cursor.createCursorAdapter({ legacyLocalRoot: legacy.localRoot });
      const projectBefore = snapshot(target.root);
      const userBefore = snapshot(legacy.localRoot);
      const result = await run(target.root, pkg.root, adapter, "install", true);
      assert.notEqual(result.exitCode, 0, kind);
      assert.deepEqual(snapshot(target.root), projectBefore, kind);
      assert.deepEqual(snapshot(legacy.localRoot), userBefore, kind);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }

  for (const failAtLegacyDelete of [1, 4]) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-delete-failure-"));
    try {
      const pkg = packageFixture(base);
      const targetFixtureValue = targetFixture(base);
      const legacy = legacyFixture(base, pkg, "qa");
      const adapter = cursor.createCursorAdapter({ legacyLocalRoot: legacy.localRoot });
      const target = targets.resolveProjectTarget(targetFixtureValue.root);
      const observation = adapter.detect({ target, packageRoot: pkg.root });
      const desired = adapter.renderInstall({
        target,
        packageRoot: pkg.root,
        command: "install",
        environment: "qa",
        observation,
        allowLegacyUserRemoval: true,
        allowLegacyDevMigration: false,
      });
      const projectBefore = snapshot(targetFixtureValue.root);
      const userBefore = snapshot(legacy.localRoot);
      assert.throws(
        () => cursor.migrateCursorLegacyInstall(desired, observation, { failAtLegacyDelete }),
        /transaction_failed/,
      );
      assert.deepEqual(snapshot(targetFixtureValue.root), projectBefore);
      assert.deepEqual(snapshot(legacy.localRoot), userBefore);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }
});

test("legacy deletion failures after plugin removal restore both legacy and project trees from the verified backup", () => {
  for (const failureOperation of [
    "after-remove-plugin-quarantine",
    "remove-state-quarantine",
    "after-remove-state-quarantine",
  ]) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-delete-window-"));
    try {
      const pkg = packageFixture(base);
      const targetFixtureValue = targetFixture(base);
      const legacy = legacyFixture(base, pkg, "qa");
      const adapter = cursor.createCursorAdapter({ legacyLocalRoot: legacy.localRoot });
      const target = targets.resolveProjectTarget(targetFixtureValue.root);
      const observation = adapter.detect({ target, packageRoot: pkg.root });
      const desired = adapter.renderInstall({
        target,
        packageRoot: pkg.root,
        command: "install",
        environment: "qa",
        observation,
        allowLegacyUserRemoval: true,
        allowLegacyDevMigration: false,
      });
      const projectBefore = snapshot(targetFixtureValue.root);
      const userBefore = snapshot(legacy.localRoot);

      assert.throws(
        () => cursor.migrateCursorLegacyInstall(desired, observation, {
          onBeforeLegacyMutation: (operation) => {
            if (operation === failureOperation) throw new Error(`injected-${failureOperation}`);
          },
        }),
        /transaction_failed/,
        failureOperation,
      );
      assert.deepEqual(snapshot(targetFixtureValue.root), projectBefore, failureOperation);
      assert.deepEqual(snapshot(legacy.localRoot), userBefore, failureOperation);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }
});

test("unrestorable legacy conflicts retain a complete migration backup", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-retained-backup-"));
  try {
    const pkg = packageFixture(base);
    const targetFixtureValue = targetFixture(base);
    const legacy = legacyFixture(base, pkg, "qa");
    const stateBefore = fs.readFileSync(path.join(legacy.localRoot, LEGACY_STATE));
    const pluginDigests = snapshot(legacy.pluginRoot)
      .filter((entry) => entry.startsWith("f:"))
      .map((entry) => entry.split(":").at(-1) ?? "")
      .sort();
    const adapter = cursor.createCursorAdapter({ legacyLocalRoot: legacy.localRoot });
    const target = targets.resolveProjectTarget(targetFixtureValue.root);
    const observation = adapter.detect({ target, packageRoot: pkg.root });
    const desired = adapter.renderInstall({
      target,
      packageRoot: pkg.root,
      command: "install",
      environment: "qa",
      observation,
      allowLegacyUserRemoval: true,
      allowLegacyDevMigration: false,
    });

    assert.throws(
      () => cursor.migrateCursorLegacyInstall(desired, observation, {
        onBeforeLegacyMutation: (operation) => {
          if (operation !== "after-remove-plugin-quarantine") return;
          write(legacy.pluginRoot, "replacement.txt", "replacement\n");
          throw new Error("injected-unrestorable-conflict");
        },
      }),
      /rollback_failed/,
    );

    assert.equal(fs.readFileSync(path.join(legacy.pluginRoot, "replacement.txt"), "utf8"), "replacement\n");
    assert.deepEqual(fs.readFileSync(path.join(legacy.localRoot, LEGACY_STATE)), stateBefore);
    const recoveryParent = path.join(targetFixtureValue.root, ".cursor", "kcoderag-nav");
    const backups = fs.readdirSync(recoveryParent).filter((entry) => entry.startsWith(".legacy-migration-"));
    assert.equal(backups.length, 1);
    const backupRoot = path.join(recoveryParent, backups[0] as string);
    const backupDigests = fs.readdirSync(path.join(backupRoot, "files"))
      .map((entry) => sha256(fs.readFileSync(path.join(backupRoot, "files", entry))))
      .sort();
    assert.deepEqual(backupDigests, pluginDigests);
    assert.deepEqual(fs.readFileSync(path.join(backupRoot, "legacy-state.bin")), stateBefore);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Cursor MCP lifecycle preserves unowned lexical bytes and unsafe integer literals", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-lossless-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    const mcpPath = path.join(target.root, ".cursor/mcp.json");
    const original = "{\r\n  \"huge\" : 9007199254740993,\r\n  \"escaped\" : \"\\u006b\\u0065\\u0065\\u0070\",\r\n  \"mcpServers\" : { \"user\" : {\"command\":\"keep\"} }\r\n}\r\n";
    fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
    fs.writeFileSync(mcpPath, original, "utf8");

    for (const command of ["install", "update"] as const) {
      assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, command)).exitCode, 0);
      const current = fs.readFileSync(mcpPath, "utf8");
      assert.ok(current.includes("\"huge\" : 9007199254740993"));
      assert.ok(current.includes("\"escaped\" : \"\\u006b\\u0065\\u0065\\u0070\""));
    }
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "uninstall")).exitCode, 0);
    assert.equal(fs.readFileSync(mcpPath, "utf8"), original);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("legacy migration refuses an ancestor swap in the final quarantine window without deleting replacement data", (context) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-legacy-race-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-legacy-race-outside-"));
  let parkedRoot: string | undefined;
  let linkedRoot: string | undefined;
  try {
    const pkg = packageFixture(base);
    const targetFixtureValue = targetFixture(base);
    const legacy = legacyFixture(base, pkg, "qa");
    const adapter = cursor.createCursorAdapter({ legacyLocalRoot: legacy.localRoot });
    const target = targets.resolveProjectTarget(targetFixtureValue.root);
    const observation = adapter.detect({ target, packageRoot: pkg.root });
    const desired = adapter.renderInstall({
      target,
      packageRoot: pkg.root,
      command: "install",
      environment: "qa",
      observation,
      allowLegacyUserRemoval: true,
      allowLegacyDevMigration: false,
    });
    const projectBefore = snapshot(targetFixtureValue.root);
    write(outside, "kcoderag-nav/replacement.txt", "outside-replacement\n");
    write(outside, LEGACY_STATE, "outside-state\n");
    const outsideBefore = snapshot(outside);
    linkedRoot = legacy.localRoot;
    parkedRoot = `${legacy.localRoot}-original`;
    let linkAvailable = true;

    let caught: unknown;
    try {
      cursor.migrateCursorLegacyInstall(desired, observation, {
        onBeforeLegacyMutation: (operation) => {
          if (operation !== "quarantine-plugin" || fs.existsSync(parkedRoot as string)) return;
          fs.renameSync(linkedRoot as string, parkedRoot as string);
          try {
            fs.symlinkSync(outside, linkedRoot as string, process.platform === "win32" ? "junction" : "dir");
          } catch (error) {
            fs.renameSync(parkedRoot as string, linkedRoot as string);
            linkAvailable = false;
            if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
          }
        },
      });
    } catch (error) {
      caught = error;
    }
    if (!linkAvailable) {
      context.skip("directory symlink unavailable");
      return;
    }
    assert.match(String(caught), /rollback_failed|transaction_failed|filesystem_race|symlink_escape/);
    assert.deepEqual(snapshot(outside), outsideBefore);
    const projectWithoutRecovery = snapshot(targetFixtureValue.root).filter((entry) =>
      !entry.includes(".cursor/kcoderag-nav"));
    assert.deepEqual(projectWithoutRecovery, projectBefore);
    const retainedRoot = path.join(targetFixtureValue.root, ".cursor", "kcoderag-nav");
    assert.equal(
      fs.readdirSync(retainedRoot).filter((entry) => entry.startsWith(".legacy-migration-")).length,
      1,
    );
  } finally {
    if (linkedRoot !== undefined) {
      try {
        if (fs.lstatSync(linkedRoot).isSymbolicLink()) fs.unlinkSync(linkedRoot);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (linkedRoot !== undefined && parkedRoot !== undefined && fs.existsSync(parkedRoot)) {
      fs.renameSync(parkedRoot, linkedRoot);
    }
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("Cursor source scans distinguish active plugin, raw MCP, and manual Rule without a Hook claim", async () => {
  const adapter = cursor.createCursorAdapter({
    legacyLocalRoot: path.resolve("absent-cursor-legacy"),
    readUserSources: () => emptyCursorUserSources({
      activePluginPaths: [".cursor/plugins/local/kcoderag-nav"],
      rawMcpPaths: [".cursor/mcp.json"],
      manualRulePaths: [".cursor/rules/kcoderag-navigation.mdc"],
      cachePaths: [".cursor/plugins/cache/kcoderag-nav"],
      disabledPaths: [".cursor/plugins/disabled/kcoderag-nav"],
    }),
  });

  const fast = await cursorScannerContext(adapter, "fast");
  assert.equal(fast.hasConflict, true);
  assert.deepEqual(
    new Set(fast.findings.map((finding: Record<string, unknown>) => finding.sourceType)),
    new Set(["active_plugin", "raw_mcp", "manual_rule"]),
  );
  assert.ok(fast.findings.every((finding: Record<string, unknown>) => finding.cleanupEligible === false));
  assert.equal(fast.cleanupPlans.length, 0);
  assert.doesNotMatch(JSON.stringify(fast), /manual_hook|PreToolUse/);

  const deep = await cursorScannerContext(adapter, "deep");
  assert.deepEqual(
    new Set(deep.findings.map((finding: Record<string, unknown>) => finding.sourceType)),
    new Set(["active_plugin", "raw_mcp", "manual_rule", "cache_residue", "disabled_registration"]),
  );
  assert.equal(deep.findings.filter((finding: Record<string, unknown>) => finding.severity === "info").length, 2);
  assert.equal(typeof adapter.cleanupOwnedSource, "undefined");
});

test("Cursor exact legacy metadata is diagnosed without exposing credential-bearing file bytes", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-source-legacy-"));
  try {
    const pkg = packageFixture(base);
    const legacy = legacyFixture(base, pkg, "qa");
    const adapter = cursor.createCursorAdapter({
      legacyLocalRoot: legacy.localRoot,
      homeDirectory: base,
    });
    const scan = await cursorScannerContext(adapter, "deep");
    assert.equal(scan.hasConflict, true);
    assert.equal(scan.cleanupPlans.length, 0);
    assert.deepEqual(scan.findings.map((finding: Record<string, unknown>) => finding.sourceType), [
      "active_plugin",
    ]);
    assert.deepEqual(scan.findings.map((finding: Record<string, unknown>) => finding.safePath), [
      ".cursor/plugins/local/kcoderag-nav",
    ]);
    assert.doesNotMatch(JSON.stringify(scan), new RegExp(pkg.secret));
    assert.doesNotMatch(JSON.stringify(scan), /https:\/\//);

    write(legacy.pluginRoot, "rules/kcoderag-navigation.mdc", "drifted without reading values\n");
    const ambiguous = await cursorScannerContext(adapter, "gate");
    assert.equal(ambiguous.hasConflict, true);
    assert.equal(ambiguous.cleanupPlans.length, 0);
    assert.ok(ambiguous.findings.some((finding: Record<string, unknown>) =>
      finding.sourceType === "ambiguous"));
    assert.doesNotMatch(JSON.stringify(ambiguous), new RegExp(pkg.secret));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Cursor malformed metadata stays manual-only and sentinel-safe", async () => {
  const sentinel = `Bearer-${crypto.randomUUID()}`;
  for (const metadata of [
    { ...emptyCursorUserSources(), activePluginPaths: [sentinel] },
    { ...emptyCursorUserSources(), manualRulePaths: [".cursor/hooks/kcoderag.json"] },
    { ...emptyCursorUserSources(), rawMcpPaths: "not-an-array" },
  ]) {
    const adapter = cursor.createCursorAdapter({
      legacyLocalRoot: path.resolve("absent-cursor-legacy"),
      readUserSources: () => metadata,
    });
    const scan = await cursorScannerContext(adapter, "gate");
    assert.equal(scan.hasConflict, true);
    assert.equal(scan.cleanupPlans.length, 0);
    assert.ok(scan.findings.every((finding: Record<string, unknown>) => finding.cleanupEligible === false));
    assert.doesNotMatch(JSON.stringify(scan), new RegExp(sentinel));
  }
});
