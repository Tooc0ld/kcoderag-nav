const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor";

function digest(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

interface CommandModule {
  executeCommand(argv: string[], dependencies: Record<string, unknown>): Promise<number>;
}

const commands = require("../../dist/cli/commands.cjs") as CommandModule;
const coreState = require("../../dist/core/state.cjs") as {
  createDesiredState(input: Record<string, unknown>): unknown;
};
const userSources = require("../../dist/hosts/user-sources.cjs") as {
  createNativeHostCapability(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
  createNativeCleanupPlan(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
  createSourceFinding(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
  createSourceScanResult(
    mode: string,
    findings: readonly Readonly<Record<string, unknown>>[],
    plans?: readonly Readonly<Record<string, unknown>>[],
  ): Readonly<Record<string, unknown>>;
};

function fixture(): { root: string; target: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cli-red-"));
  const target = path.join(root, "target");
  fs.mkdirSync(target);
  return { root, target };
}

function makeAdapter(
  host: HostId,
  calls: string[],
  options: { legacy?: boolean; legacyDev?: boolean } = {},
): Record<string, unknown> {
  return {
    id: host,
    managedRoots: [`.fixture-${host}`],
    detect(context: Record<string, unknown>) {
      calls.push(`${host}:detect`);
      return {
        host,
        target: context.target,
        ...(options.legacy
          ? { legacyUserRemoval: { path: path.join(os.tmpdir(), "legacy-kcoderag-nav") } }
          : {}),
        ...(options.legacyDev ? { legacyEnvironment: "dev" } : {}),
      };
    },
    renderInstall(context: Record<string, any>) {
      calls.push(
        `${host}:renderInstall:${String(context.allowLegacyUserRemoval)}:${String(context.allowLegacyDevMigration)}`,
      );
      const payloadPath = path.join(context.target.root, `.fixture-${host}/payload.txt`);
      const statePath = path.join(context.target.root, `.fixture-${host}/install-state.json`);
      const currentPayload = fs.existsSync(payloadPath) ? fs.readFileSync(payloadPath) : undefined;
      const currentState = fs.existsSync(statePath) ? fs.readFileSync(statePath) : undefined;
      return coreState.createDesiredState({
        host,
        target: context.target,
        managedRoots: [`.fixture-${host}`],
        statePath: `.fixture-${host}/install-state.json`,
        entries: [
          {
            relativePath: `.fixture-${host}/payload.txt`,
            expectedDigest: currentPayload === undefined ? null : digest(currentPayload),
            content: Buffer.from(`${host}:${String(context.command)}\n`, "utf8"),
          },
          {
            relativePath: `.fixture-${host}/install-state.json`,
            expectedDigest: currentState === undefined ? null : digest(currentState),
            content: Buffer.from('{"schemaVersion":1}\n', "utf8"),
          },
        ],
      });
    },
    renderUninstall(context: Record<string, any>) {
      calls.push(`${host}:renderUninstall`);
      const entries = ["payload.txt", "install-state.json"].map((name) => {
        const relativePath = `.fixture-${host}/${name}`;
        const absolutePath = path.join(context.target.root, ...relativePath.split("/"));
        const current = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath) : undefined;
        return {
          relativePath,
          expectedDigest: current === undefined ? null : digest(current),
          content: null,
        };
      });
      return coreState.createDesiredState({
        host,
        target: context.target,
        managedRoots: [`.fixture-${host}`],
        statePath: `.fixture-${host}/install-state.json`,
        entries,
      });
    },
    status(context: Record<string, unknown>) {
      calls.push(`${host}:status`);
      return {
        schemaVersion: 1,
        status: "not_installed",
        host,
        issues: [],
        target: context.target,
      };
    },
  };
}

function io(target: string, adapters: Record<HostId, Record<string, unknown>>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    dependencies: {
      cwd: target,
      packageRoot: path.resolve("."),
      nodeVersion: "22.0.0",
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
      confirmTarget: () => true,
      confirmLegacyUserRemoval: () => false,
      selectHost: () => "codex",
      getAdapter: (host: HostId) => adapters[host],
    },
  };
}

test("one explicit host selects one pure adapter and commits through shared desired state", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls),
    };
    const captured = io(item.target, adapters);
    const exitCode = await commands.executeCommand(
      ["install", "--host", "codex", "--yes", "--json"],
      captured.dependencies,
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, ["codex:detect", "codex:renderInstall:false:false"]);
    assert.equal(
      fs.readFileSync(path.join(item.target, ".fixture-codex/payload.txt"), "utf8"),
      "codex:install\n",
    );
    assert.equal(fs.existsSync(path.join(item.target, ".fixture-claude")), false);
    assert.equal(fs.existsSync(path.join(item.target, ".fixture-cursor")), false);
    assert.equal(captured.stderr.length, 0);
    const output = JSON.parse(captured.stdout[0] ?? "") as Record<string, unknown>;
    assert.equal(output.ok, true);
    assert.equal(output.environment, "qa");
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("retired environment selectors refuse before adapter detection and preserve the target", async () => {
  for (const environment of ["qa", "dev"] as const) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const adapters = {
        codex: makeAdapter("codex", calls),
        claude: makeAdapter("claude", calls),
        cursor: makeAdapter("cursor", calls),
      };
      const captured = io(item.target, adapters);
      const before = fs.readdirSync(item.target);
      const exitCode = await commands.executeCommand(
        ["install", "--host", "codex", "--yes", "--json", "--environment", environment],
        captured.dependencies,
      );

      assert.equal(exitCode, 2);
      assert.deepEqual(calls, []);
      assert.deepEqual(fs.readdirSync(item.target), before);
      assert.equal(captured.stdout.length, 1);
      assert.equal(captured.stderr.length, 0);
      assert.equal(
        JSON.parse(captured.stdout[0] ?? "").error.code,
        "environment_selector_retired",
      );
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("legacy Dev migration authority is independent, mutation-only, and observation-bound", async () => {
  const scenarios = [
    {
      argv: ["status", "--host", "codex", "--json", "--allow-legacy-dev-migration"],
      legacyDev: true,
      expectedCode: "legacy_dev_migration_authority_invalid",
      expectedCalls: [],
    },
    {
      argv: ["uninstall", "--host", "codex", "--yes", "--json", "--allow-legacy-dev-migration"],
      legacyDev: true,
      expectedCode: "legacy_dev_migration_authority_invalid",
      expectedCalls: [],
    },
    {
      argv: ["install", "--host", "codex", "--yes", "--json"],
      legacyDev: true,
      expectedCode: "legacy_dev_migration_authority_required",
      expectedCalls: ["codex:detect"],
    },
    {
      argv: ["install", "--host", "codex", "--yes", "--json", "--allow-legacy-dev-migration"],
      legacyDev: false,
      expectedCode: "legacy_dev_migration_authority_invalid",
      expectedCalls: ["codex:detect"],
    },
  ] as const;

  for (const scenario of scenarios) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const adapters = {
        codex: makeAdapter("codex", calls, { legacyDev: scenario.legacyDev }),
        claude: makeAdapter("claude", calls),
        cursor: makeAdapter("cursor", calls),
      };
      const captured = io(item.target, adapters);
      const before = fs.readdirSync(item.target);
      const exitCode = await commands.executeCommand([...scenario.argv], captured.dependencies);

      assert.equal(exitCode, 2);
      assert.deepEqual(calls, scenario.expectedCalls);
      assert.deepEqual(fs.readdirSync(item.target), before);
      assert.equal(captured.stdout.length, 1);
      assert.equal(captured.stderr.length, 0);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, scenario.expectedCode);
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }

  const allowed = fixture();
  try {
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls, { legacyDev: true }),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls),
    };
    const captured = io(allowed.target, adapters);
    assert.equal(
      await commands.executeCommand(
        ["update", "--host", "codex", "--yes", "--json", "--allow-legacy-dev-migration"],
        captured.dependencies,
      ),
      0,
    );
    assert.deepEqual(calls, ["codex:detect", "codex:renderInstall:false:true"]);
    assert.equal(JSON.parse(captured.stdout[0] ?? "").environment, "qa");
  } finally {
    fs.rmSync(allowed.root, { recursive: true, force: true });
  }
});

test("JSON mutation without an explicit host refuses before adapter selection or writes", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls),
    };
    const captured = io(item.target, adapters);
    const before = fs.readdirSync(item.target);
    const exitCode = await commands.executeCommand(
      ["install", "--yes", "--json"],
      captured.dependencies,
    );

    assert.notEqual(exitCode, 0);
    assert.deepEqual(calls, []);
    assert.deepEqual(fs.readdirSync(item.target), before);
    assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, "host_required");
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("--yes never implies Cursor legacy user-directory removal authority", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls, { legacy: true }),
    };
    const captured = io(item.target, adapters);
    const exitCode = await commands.executeCommand(
      ["install", "--host", "cursor", "--yes", "--json"],
      captured.dependencies,
    );

    assert.notEqual(exitCode, 0);
    assert.deepEqual(calls, ["cursor:detect"]);
    assert.equal(fs.existsSync(path.join(item.target, ".fixture-cursor")), false);
    assert.equal(
      JSON.parse(captured.stdout[0] ?? "").error.code,
      "legacy_removal_authority_required",
    );
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("all five commands dispatch through the lifecycle seam and read-only commands never mutate", async () => {
  for (const command of ["install", "update", "uninstall"] as const) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const adapters = {
        codex: makeAdapter("codex", calls),
        claude: makeAdapter("claude", calls),
        cursor: makeAdapter("cursor", calls),
      };
      if (command !== "install") {
        fs.mkdirSync(path.join(item.target, ".fixture-codex"));
        fs.writeFileSync(path.join(item.target, ".fixture-codex/payload.txt"), "before\n");
        fs.writeFileSync(path.join(item.target, ".fixture-codex/install-state.json"), "before-state\n");
      }
      const captured = io(item.target, adapters);
      assert.equal(
        await commands.executeCommand(
          [command, "--host", "codex", "--yes", "--json"],
          captured.dependencies,
        ),
        0,
      );
      assert.equal(captured.stderr.length, 0);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").command, command);
      assert.equal(calls[0], "codex:detect");
      assert.equal(
        calls[1],
        command === "uninstall"
          ? "codex:renderUninstall"
          : `codex:renderInstall:false:false`,
      );
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }

  for (const command of ["status", "doctor"] as const) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const secret = `opaque-mcp-${crypto.randomUUID()}`;
      const adapter = makeAdapter("claude", calls);
      const originalDetect = adapter.detect as (context: Record<string, unknown>) => Record<string, unknown>;
      adapter.detect = (context: Record<string, unknown>) => ({
        ...originalDetect(context),
        details: { secret },
      });
      const adapters = {
        codex: makeAdapter("codex", calls),
        claude: adapter,
        cursor: makeAdapter("cursor", calls),
      };
      const captured = io(item.target, adapters);
      const before = fs.readdirSync(item.target);
      assert.equal(
        await commands.executeCommand(
          [command, "--host", "claude", "--json"],
          { ...captured.dependencies, nodeVersion: "21.9.0" },
        ),
        0,
      );
      assert.deepEqual(calls, ["claude:detect", "claude:status"]);
      assert.deepEqual(fs.readdirSync(item.target), before);
      const output = captured.stdout.join("\n");
      assert.equal(JSON.parse(output).status, "invalid");
      assert.match(output, /unsupported_node/);
      assert.doesNotMatch(output, new RegExp(secret));
      assert.equal(captured.stderr.length, 0);
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("interactive selection uses the fixed host list, cwd/target confirmation, and cancellation", async () => {
  const item = fixture();
  try {
    const explicit = path.join(item.root, "explicit");
    fs.mkdirSync(explicit);
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls),
    };
    const captured = io(item.target, adapters);
    const hostLists: HostId[][] = [];
    const confirmations: Record<string, unknown>[] = [];
    const exitCode = await commands.executeCommand(
      ["install", "--target", explicit],
      {
        ...captured.dependencies,
        selectHost: (hosts: readonly HostId[]) => {
          hostLists.push([...hosts]);
          return "claude";
        },
        confirmTarget: (request: Record<string, unknown>) => {
          confirmations.push(request);
          return false;
        },
      },
    );

    assert.equal(exitCode, 2);
    assert.deepEqual(hostLists, [["codex", "claude", "cursor"]]);
    assert.equal(confirmations[0]?.target, fs.realpathSync(explicit));
    assert.equal("environment" in (confirmations[0] ?? {}), false);
    assert.deepEqual(calls, []);
    assert.equal(fs.readdirSync(explicit).length, 0);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("selected-host global targets fail before adapter detection while other-host directories remain legal", async () => {
  const item = fixture();
  try {
    const home = path.join(item.root, "home");
    const codexRoot = path.join(home, ".codex");
    const codexCache = path.join(codexRoot, "plugins", "cache");
    const claudeProject = path.join(home, ".claude", "project");
    fs.mkdirSync(codexCache, { recursive: true });
    fs.mkdirSync(claudeProject, { recursive: true });
    const globalRoots = (host: HostId): readonly string[] => [path.join(home, `.${host}`)];

    for (const unsafe of [home, codexRoot, codexCache]) {
      const calls: string[] = [];
      const adapters = {
        codex: makeAdapter("codex", calls),
        claude: makeAdapter("claude", calls),
        cursor: makeAdapter("cursor", calls),
      };
      const captured = io(unsafe, adapters);
      const before = fs.readdirSync(unsafe);
      assert.equal(
        await commands.executeCommand(
          ["install", "--host", "codex", "--yes", "--json"],
          { ...captured.dependencies, homeDirectory: home, hostGlobalRoots: globalRoots },
        ),
        1,
      );
      assert.deepEqual(calls, []);
      assert.deepEqual(fs.readdirSync(unsafe), before);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, "unsafe_target");
    }

    const legalCalls: string[] = [];
    const legalAdapters = {
      codex: makeAdapter("codex", legalCalls),
      claude: makeAdapter("claude", legalCalls),
      cursor: makeAdapter("cursor", legalCalls),
    };
    const legal = io(claudeProject, legalAdapters);
    assert.equal(
      await commands.executeCommand(
        ["install", "--host", "codex", "--yes", "--json"],
        { ...legal.dependencies, homeDirectory: home, hostGlobalRoots: globalRoots },
      ),
      0,
    );
    assert.deepEqual(legalCalls, ["codex:detect", "codex:renderInstall:false:false"]);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("Node below 22 rejects mutations before adapter work while read-only commands still report", async () => {
  const item = fixture();
  try {
    for (const command of ["install", "update", "uninstall"] as const) {
      const calls: string[] = [];
      const adapters = {
        codex: makeAdapter("codex", calls),
        claude: makeAdapter("claude", calls),
        cursor: makeAdapter("cursor", calls),
      };
      const captured = io(item.target, adapters);
      assert.equal(
        await commands.executeCommand(
          [command, "--host", "codex", "--yes", "--json"],
          { ...captured.dependencies, nodeVersion: "20.19.0" },
        ),
        1,
      );
      assert.deepEqual(calls, []);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, "unsupported_node");
    }
    assert.equal(fs.readdirSync(item.target).length, 0);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("explicit legacy authority is forwarded only to Cursor and never inferred or downgraded", async () => {
  const item = fixture();
  try {
    const cursorCalls: string[] = [];
    const cursorAdapters = {
      codex: makeAdapter("codex", cursorCalls),
      claude: makeAdapter("claude", cursorCalls),
      cursor: makeAdapter("cursor", cursorCalls),
    };
    const cursorIo = io(item.target, cursorAdapters);
    assert.equal(
      await commands.executeCommand(
        [
          "install",
          "--host",
          "cursor",
          "--yes",
          "--json",
          "--allow-legacy-user-removal",
        ],
        cursorIo.dependencies,
      ),
      0,
    );
    assert.deepEqual(cursorCalls, ["cursor:detect", "cursor:renderInstall:true:false"]);

    const mismatchTarget = path.join(item.root, "mismatch");
    fs.mkdirSync(mismatchTarget);
    const mismatchCalls: string[] = [];
    const mismatchAdapters = {
      codex: makeAdapter("codex", mismatchCalls),
      claude: makeAdapter("claude", mismatchCalls),
      cursor: makeAdapter("cursor", mismatchCalls),
    };
    const mismatchIo = io(mismatchTarget, mismatchAdapters);
    assert.notEqual(
      await commands.executeCommand(
        [
          "install",
          "--host",
          "codex",
          "--yes",
          "--json",
          "--allow-legacy-user-removal",
        ],
        mismatchIo.dependencies,
      ),
      0,
    );
    assert.deepEqual(mismatchCalls, []);
    assert.equal(fs.readdirSync(mismatchTarget).length, 0);
    assert.equal(
      JSON.parse(mismatchIo.stdout[0] ?? "").error.code,
      "legacy_removal_authority_invalid",
    );
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("machine output and exit codes are stable and redact unexpected adapter failures", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls),
    };

    const invalid = io(item.target, adapters);
    assert.equal(
      await commands.executeCommand(
        ["install", "--host", "opencode", "--yes", "--json"],
        invalid.dependencies,
      ),
      2,
    );
    assert.equal(invalid.stdout.length, 1);
    assert.equal(invalid.stderr.length, 0);
    assert.equal(JSON.parse(invalid.stdout[0] ?? "").error.code, "unsupported_host");

    const confirmation = io(item.target, adapters);
    assert.equal(
      await commands.executeCommand(
        ["install", "--host", "codex", "--json"],
        confirmation.dependencies,
      ),
      2,
    );
    assert.equal(confirmation.stdout.length, 1);
    assert.equal(confirmation.stderr.length, 0);
    assert.equal(
      JSON.parse(confirmation.stdout[0] ?? "").error.code,
      "confirmation_required",
    );

    const secret = `Bearer-${crypto.randomUUID()}`;
    const failed = io(item.target, adapters);
    assert.equal(
      await commands.executeCommand(
        ["status", "--host", "codex", "--json"],
        {
          ...failed.dependencies,
          getAdapter: () => ({
            ...makeAdapter("codex", calls),
            detect: () => {
              throw new Error(secret);
            },
          }),
        },
      ),
      1,
    );
    assert.equal(failed.stdout.length, 1);
    assert.equal(failed.stderr.length, 0);
    assert.equal(JSON.parse(failed.stdout[0] ?? "").error.code, "command_failed");
    assert.doesNotMatch(failed.stdout[0] ?? "", new RegExp(secret));
    assert.deepEqual(calls, []);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("human mutation verbs are stable and read-only commands reject removal authority", async () => {
  const item = fixture();
  try {
    fs.mkdirSync(path.join(item.target, ".fixture-codex"));
    fs.writeFileSync(path.join(item.target, ".fixture-codex/payload.txt"), "before\n");
    fs.writeFileSync(path.join(item.target, ".fixture-codex/install-state.json"), "before-state\n");
    const calls: string[] = [];
    const adapters = {
      codex: makeAdapter("codex", calls),
      claude: makeAdapter("claude", calls),
      cursor: makeAdapter("cursor", calls),
    };
    const updated = io(item.target, adapters);
    assert.equal(
      await commands.executeCommand(
        ["update", "--host", "codex", "--yes"],
        updated.dependencies,
      ),
      0,
    );
    assert.match(updated.stdout[0] ?? "", /^updated: codex at /);
    assert.doesNotMatch(updated.stdout[0] ?? "", /\/(?:qa|dev)\b/i);
    assert.equal(updated.stderr.length, 0);

    const readOnly = io(item.target, adapters);
    assert.equal(
      await commands.executeCommand(
        ["status", "--host", "cursor", "--json", "--allow-legacy-user-removal"],
        readOnly.dependencies,
      ),
      2,
    );
    assert.equal(
      JSON.parse(readOnly.stdout[0] ?? "").error.code,
      "legacy_removal_authority_invalid",
    );
    assert.equal(readOnly.stderr.length, 0);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

function sourceConflict(withCleanup = false): {
  readonly finding: Readonly<Record<string, unknown>>;
  readonly plan?: Readonly<Record<string, unknown>>;
} {
  if (!withCleanup) {
    return {
      finding: userSources.createSourceFinding({
        code: "raw_mcp_source",
        severity: "conflict",
        sourceType: "raw_mcp",
        scope: "user",
        safePath: ".codex/mcp",
        cleanupEligible: false,
      }),
    };
  }
  const capability = userSources.createNativeHostCapability({
    host: "codex",
    cli: "codex",
    minimumVersion: "0.146.1",
    observedVersion: "0.146.1",
    inventorySchemaId: "codex-plugin-v1",
    completeInventory: true,
    route: "normal",
  });
  const plan = userSources.createNativeCleanupPlan({
    host: "codex",
    sourceType: "owned_plugin",
    safePath: ".codex/plugins/kcoderag-nav@kcoderag-nav",
    capability,
    argv: ["codex", "plugin", "remove", "kcoderag-nav@kcoderag-nav", "--json"],
    scope: "plugin:kcoderag-nav",
    timeoutMs: 5_000,
  });
  return {
    plan,
    finding: userSources.createSourceFinding({
      code: "owned_plugin_source",
      severity: "conflict",
      sourceType: "owned_plugin",
      scope: "user",
      safePath: ".codex/plugins/kcoderag-nav@kcoderag-nav",
      cleanupEligible: true,
      cleanupCommand: plan.command,
      cleanupFingerprint: plan.fingerprint,
    }),
  };
}

test("status is fast, doctor is deep and read-only, and top-level health follows source conflicts", async () => {
  for (const command of ["status", "doctor"] as const) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const adapter = makeAdapter("codex", calls);
      adapter.scanUserSources = (context: Record<string, unknown>) => {
        calls.push(`codex:scan:${String(context.mode)}`);
        const conflict = sourceConflict();
        return userSources.createSourceScanResult(String(context.mode), [conflict.finding]);
      };
      const adapters = { codex: adapter, claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls) };
      const captured = io(item.target, adapters);
      const before = fs.readdirSync(item.target);
      const exitCode = await commands.executeCommand(
        [command, "--host", "codex", "--json"],
        captured.dependencies,
      );
      assert.equal(exitCode, 1);
      assert.deepEqual(calls, ["codex:detect", `codex:scan:${command === "status" ? "fast" : "deep"}`, "codex:status"]);
      assert.deepEqual(fs.readdirSync(item.target), before);
      const output = JSON.parse(captured.stdout[0] ?? "") as Record<string, any>;
      assert.equal(output.ok, false);
      assert.equal(output.status, "source_conflict");
      assert.equal(output.findings[0].code, "raw_mcp_source");
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("doctor reports deep preinstall readiness while ordinary not-installed remains successful", async () => {
  const item = fixture();
  try {
    const calls: string[] = [];
    const adapter = makeAdapter("codex", calls);
    adapter.scanUserSources = (context: Record<string, unknown>) => {
      calls.push(`codex:scan:${String(context.mode)}`);
      const residue = userSources.createSourceFinding({
        code: "cache_residue",
        severity: "info",
        sourceType: "cache_residue",
        scope: "user",
        safePath: ".codex/plugins/cache/kcoderag-nav",
        cleanupEligible: false,
      });
      return userSources.createSourceScanResult(String(context.mode), [residue]);
    };
    const captured = io(item.target, { codex: adapter, claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls) });
    assert.equal(await commands.executeCommand(["doctor", "--host", "codex", "--json"], captured.dependencies), 0);
    assert.deepEqual(calls, ["codex:detect", "codex:scan:deep", "codex:status"]);
    const output = JSON.parse(captured.stdout[0] ?? "") as Record<string, any>;
    assert.equal(output.ok, true);
    assert.equal(output.status, "not_installed");
    assert.equal(output.findings[0].severity, "info");
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("install and update run a full no-write source gate while uninstall remains project-only", async () => {
  for (const command of ["install", "update"] as const) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const adapter = makeAdapter("codex", calls);
      adapter.scanUserSources = (context: Record<string, unknown>) => {
        calls.push(`codex:scan:${String(context.mode)}`);
        const conflict = sourceConflict();
        return userSources.createSourceScanResult(String(context.mode), [conflict.finding]);
      };
      const captured = io(item.target, { codex: adapter, claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls) });
      const before = fs.readdirSync(item.target);
      assert.equal(await commands.executeCommand([command, "--host", "codex", "--yes", "--json"], captured.dependencies), 1);
      assert.deepEqual(calls, ["codex:detect", "codex:scan:gate"]);
      assert.deepEqual(fs.readdirSync(item.target), before);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, "source_conflict");
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }

  const uninstall = fixture();
  try {
    fs.mkdirSync(path.join(uninstall.target, ".fixture-codex"));
    fs.writeFileSync(path.join(uninstall.target, ".fixture-codex/payload.txt"), "before\n");
    fs.writeFileSync(path.join(uninstall.target, ".fixture-codex/install-state.json"), "before-state\n");
    const calls: string[] = [];
    const adapter = makeAdapter("codex", calls);
    adapter.scanUserSources = () => { throw new Error("uninstall must not scan unrelated user sources"); };
    const captured = io(uninstall.target, { codex: adapter, claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls) });
    assert.equal(await commands.executeCommand(["uninstall", "--host", "codex", "--yes", "--json"], captured.dependencies), 0);
    assert.deepEqual(calls, ["codex:detect", "codex:renderUninstall"]);
  } finally {
    fs.rmSync(uninstall.root, { recursive: true, force: true });
  }
});

test("owned cleanup needs its dedicated flag and exact fresh fingerprint before render", async () => {
  const fixturePlan = sourceConflict(true);
  const fingerprint = String(fixturePlan.plan?.fingerprint);
  for (const scenario of [
    { extra: [] as string[], code: "owned_source_cleanup_authority_required" },
    { extra: ["--allow-owned-source-cleanup"], code: "cleanup_fingerprint_required" },
    { extra: ["--allow-owned-source-cleanup", "--cleanup-fingerprint", `sha256:${"0".repeat(64)}`], code: "cleanup_fingerprint_mismatch" },
    { extra: ["--cleanup-fingerprint", fingerprint], code: "owned_source_cleanup_authority_required" },
  ]) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const adapter = makeAdapter("codex", calls);
      adapter.scanUserSources = (context: Record<string, unknown>) => {
        calls.push(`codex:scan:${String(context.mode)}`);
        return userSources.createSourceScanResult(String(context.mode), [fixturePlan.finding], [fixturePlan.plan as Readonly<Record<string, unknown>>]);
      };
      adapter.cleanupOwnedSource = () => { calls.push("codex:cleanup"); return userSources.createSourceScanResult("gate", []); };
      const captured = io(item.target, { codex: adapter, claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls) });
      assert.equal(await commands.executeCommand(["install", "--host", "codex", "--yes", "--json", ...scenario.extra], captured.dependencies), 2);
      assert.deepEqual(calls, ["codex:detect", "codex:scan:gate"]);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, scenario.code);
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }

  const allowed = fixture();
  try {
    const calls: string[] = [];
    const adapter = makeAdapter("codex", calls);
    adapter.scanUserSources = (context: Record<string, unknown>) => {
      calls.push(`codex:scan:${String(context.mode)}`);
      return userSources.createSourceScanResult(String(context.mode), [fixturePlan.finding], [fixturePlan.plan as Readonly<Record<string, unknown>>]);
    };
    adapter.cleanupOwnedSource = (_plan: unknown, authority: Record<string, unknown>) => {
      calls.push(`codex:cleanup:${String(authority.allowOwnedSourceCleanup)}:${String(authority.cleanupFingerprint === fingerprint)}`);
      return userSources.createSourceScanResult("gate", []);
    };
    const captured = io(allowed.target, { codex: adapter, claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls) });
    assert.equal(await commands.executeCommand([
      "install", "--host", "codex", "--yes", "--json",
      "--allow-owned-source-cleanup", "--cleanup-fingerprint", fingerprint,
    ], captured.dependencies), 0);
    assert.deepEqual(calls, ["codex:detect", "codex:scan:gate", "codex:cleanup:true:true", "codex:renderInstall:false:false"]);
  } finally {
    fs.rmSync(allowed.root, { recursive: true, force: true });
  }
});

test("cleanup flags are mutation-only and doctor refuses every fix-like argument", async () => {
  for (const argv of [
    ["status", "--host", "codex", "--json", "--allow-owned-source-cleanup"],
    ["doctor", "--host", "codex", "--json", "--cleanup-fingerprint", `sha256:${"0".repeat(64)}`],
    ["doctor", "--host", "codex", "--json", "--fix"],
  ]) {
    const item = fixture();
    try {
      const calls: string[] = [];
      const captured = io(item.target, { codex: makeAdapter("codex", calls), claude: makeAdapter("claude", calls), cursor: makeAdapter("cursor", calls) });
      assert.equal(await commands.executeCommand(argv, captured.dependencies), 2);
      assert.deepEqual(calls, []);
      assert.equal(JSON.parse(captured.stdout[0] ?? "").error.code, "owned_source_cleanup_authority_invalid");
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});
