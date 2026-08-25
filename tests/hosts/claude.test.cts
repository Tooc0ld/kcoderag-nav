const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor";

interface CommandModule {
  executeCommand(argv: string[], dependencies: Record<string, unknown>): Promise<number>;
}

interface TransactionModule {
  applyTransaction(
    desired: Record<string, unknown>,
    options?: { readonly failAtCommit?: number },
  ): unknown;
}

const claude = require("../../dist/hosts/claude.cjs") as {
  claudeAdapter: Record<string, any>;
};
const commands = require("../../dist/cli/commands.cjs") as CommandModule;
const transaction = require("../../dist/core/transaction.cjs") as TransactionModule;
const targets = require("../../dist/core/project-target.cjs") as {
  resolveProjectTarget(target: string): Record<string, unknown>;
};

const STATE_PATH = ".claude/kcoderag-nav/install-state.json";

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
      return claude.claudeAdapter;
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

    const before = snapshot(target.root);
    const preview = await run(target.root, pkg.root, "doctor");
    assert.equal(preview.output.status, "update_available");
    assert.match(JSON.stringify(preview.output), /legacy_migration_available/);
    assert.deepEqual(snapshot(target.root), before);

    const denied = await run(target.root, pkg.root, "update");
    assert.equal(denied.output.code, "legacy_dev_migration_authority_required");
    assert.deepEqual(snapshot(target.root), before);

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
