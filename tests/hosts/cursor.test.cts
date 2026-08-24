const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type EnvironmentId = "qa" | "dev";
type HostId = "codex" | "claude" | "cursor";

interface CursorModule {
  readonly cursorAdapter: Record<string, any>;
  createCursorAdapter(options: { readonly legacyLocalRoot: string }): Record<string, any>;
  migrateCursorLegacyInstall(
    desired: Record<string, unknown>,
    observation: Record<string, unknown>,
    options?: { readonly failAtLegacyDelete?: number },
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
  for (const environment of ["qa", "dev"] as const) {
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
  environment: EnvironmentId = "qa",
  allowLegacy = false,
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const argv = [command, "--host", "cursor", "--json", "--environment", environment];
  if (["install", "update", "uninstall"].includes(command)) argv.push("--yes");
  if (allowLegacy) argv.push("--allow-legacy-user-removal");
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

test("Cursor project lifecycle uses Rule, skill, and one MCP entry without hooks", async () => {
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
    assert.equal(snapshot(target.root).some((entry) => /hook/i.test(entry)), false);
    const installedTree = snapshot(target.root);

    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "status")).output.status, "healthy");
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "doctor")).output.status, "healthy");
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "install")).exitCode, 0);
    assert.deepEqual(snapshot(target.root), installedTree);

    const beforeConflict = snapshot(target.root);
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "install", "dev")).output.code, "environment_conflict");
    assert.deepEqual(snapshot(target.root), beforeConflict);

    write(pkg.root, "kcoderag-cursor/rules/kcoderag-navigation.mdc", "updated rule\n");
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "status")).output.status, "update_available");
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "update")).exitCode, 0);
    assert.equal((await run(target.root, pkg.root, cursor.cursorAdapter, "uninstall")).exitCode, 0);
    assert.deepEqual(fs.readFileSync(path.join(target.root, ".cursor/mcp.json")), target.mcp);
    assert.equal(fs.existsSync(path.join(target.root, ".cursor/rules/kcoderag-navigation.mdc")), false);
    assert.equal(fs.existsSync(path.join(target.root, ".cursor/skills/kcoderag-nav/SKILL.md")), false);
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
    assert.equal((await run(drift.root, pkg.root, cursor.cursorAdapter, "install", "dev")).exitCode, 0);
    write(drift.root, ".cursor/rules/kcoderag-navigation.mdc", "edited\n");
    const beforeDrift = snapshot(drift.root);
    assert.equal((await run(drift.root, pkg.root, cursor.cursorAdapter, "doctor", "dev")).output.status, "drifted");
    assert.equal((await run(drift.root, pkg.root, cursor.cursorAdapter, "uninstall", "dev")).output.code, "managed_content_changed");
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

test("legacy Cursor migration requires independent authority and preserves environment", async () => {
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

      const denied = await run(target.root, pkg.root, adapter, "install", environment);
      assert.equal(denied.output.code, "legacy_removal_authority_required");
      assert.deepEqual(snapshot(target.root), projectBefore);
      assert.deepEqual(snapshot(legacy.localRoot), userBefore);

      const migrated = await run(target.root, pkg.root, adapter, "install", environment, true);
      assert.equal(migrated.exitCode, 0);
      assert.equal((await run(target.root, pkg.root, adapter, "status", environment)).output.status, "healthy");
      assert.equal(fs.existsSync(path.join(legacy.localRoot, LEGACY_STATE)), false);
      assert.equal(fs.existsSync(legacy.pluginRoot), false);
      assert.equal(fs.readFileSync(path.join(legacy.localRoot, "other-plugin/keep.txt"), "utf8"), "keep\n");
      const state = JSON.parse(fs.readFileSync(path.join(target.root, ...STATE_PATH.split("/")), "utf8"));
      assert.equal(state.environment, environment);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }
});

test("legacy drift, extra files, unknown environment, and delete failure preserve both trees", async () => {
  const cases = ["invalid-state", "digest-drift", "extra-file", "extra-directory", "unknown-environment"] as const;
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
      if (kind === "unknown-environment") {
        const manifestPath = path.join(legacy.pluginRoot, ".cursor-plugin/plugin.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        manifest.variables.properties.KCODERAG_MCP_URL.default = "https://unknown.invalid/mcp";
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
        const statePath = path.join(legacy.localRoot, LEGACY_STATE);
        const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
        state.files[".cursor-plugin/plugin.json"] = sha256(fs.readFileSync(manifestPath));
        state.tree_digest = treeDigest(state.files);
        fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
      }
      const adapter = cursor.createCursorAdapter({ legacyLocalRoot: legacy.localRoot });
      const projectBefore = snapshot(target.root);
      const userBefore = snapshot(legacy.localRoot);
      const result = await run(target.root, pkg.root, adapter, "install", "qa", true);
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
