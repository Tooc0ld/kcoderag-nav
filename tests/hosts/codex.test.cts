const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type EnvironmentId = "qa" | "dev";
type HostId = "codex" | "claude" | "cursor";

interface HostAdapter {
  readonly id: HostId;
  detect(context: Record<string, unknown>): Record<string, unknown>;
  renderInstall(context: Record<string, unknown>): Record<string, unknown>;
  renderUninstall(context: Record<string, unknown>): Record<string, unknown>;
}

interface CodexModule {
  readonly codexAdapter: HostAdapter;
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

function write(root: string, relativePath: string, value: string | Buffer): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, value);
}

function packageFixture(base: string): { readonly root: string; readonly secret: string } {
  const root = path.join(base, "package");
  const secret = `opaque-${crypto.randomUUID()}`;
  write(root, "package.json", `${JSON.stringify({ name: "kcoderag-nav", version: "0.1.4" })}\n`);
  for (const environment of ["qa", "dev"] as const) {
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
      "update-check.cjs",
      "update-worker.cjs",
      "run_hook.cmd",
      "run_hook.sh",
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

function io(target: string, packageRoot: string): {
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
        return codex.codexAdapter;
      },
    },
  };
}

async function run(
  target: string,
  packageRoot: string,
  command: "install" | "status" | "doctor" | "update" | "uninstall",
  environment?: EnvironmentId,
) {
  const captured = io(target, packageRoot);
  const argv = [command, "--host", "codex", "--json"];
  if (command === "install" || command === "update" || command === "uninstall") argv.push("--yes");
  if (environment !== undefined) argv.push("--environment", environment);
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

    const conflictBefore = snapshot(target.root);
    const conflict = await run(target.root, pkg.root, "install", "dev");
    assert.equal(conflict.exitCode, 1);
    assert.equal(conflict.output.code, "environment_conflict");
    assert.deepEqual(snapshot(target.root), conflictBefore);

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

test("Codex Dev is explicit and a managed drift blocks update and uninstall before writes", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-codex-dev-"));
  try {
    const pkg = packageFixture(base);
    const target = targetFixture(base);
    assert.equal((await run(target.root, pkg.root, "install", "dev")).exitCode, 0);
    assert.equal((await run(target.root, pkg.root, "status", "dev")).output.status, "healthy");
    write(target.root, ".codex/kcoderag-nav/dev/hooks/grep-nudge.cjs", "locally edited\n");
    const before = snapshot(target.root);
    for (const command of ["update", "uninstall"] as const) {
      const result = await run(target.root, pkg.root, command, "dev");
      assert.equal(result.exitCode, 1);
      assert.equal(result.output.code, "managed_content_changed");
      assert.deepEqual(snapshot(target.root), before);
    }
    assert.equal((await run(target.root, pkg.root, "doctor", "dev")).output.status, "drifted");
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
