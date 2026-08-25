const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type EnvironmentId = "qa" | "dev";

interface HostAdapter {
  detect(context: Record<string, unknown>): Record<string, unknown>;
  renderInstall(context: Record<string, unknown>): Record<string, unknown>;
  renderUninstall(context: Record<string, unknown>): Record<string, unknown>;
  status(context: Record<string, unknown>): Record<string, unknown>;
}

const codex = require("../../dist/hosts/codex.cjs") as { readonly codexAdapter: HostAdapter };
const projectTarget = require("../../dist/core/project-target.cjs") as {
  resolveProjectTarget(target: string): Record<string, unknown>;
};
const transaction = require("../../dist/core/transaction.cjs") as {
  applyTransaction(desired: Record<string, unknown>, options?: { failAtCommit?: number }): unknown;
};
const coreState = require("../../dist/core/state.cjs") as {
  parseInstallState(bytes: Buffer): Readonly<Record<string, unknown>> & {
    readonly environment: "qa";
    readonly managedFiles: readonly string[];
  };
  parseLegacyInstallState(
    bytes: Buffer,
    options: { allowedPaths: readonly string[]; requiredPaths: readonly string[] },
  ): Readonly<Record<string, unknown>> & { environment: EnvironmentId };
};

const STATE_PATH = ".codex/kcoderag-nav/install-state.json";
const CONFIG_PATH = ".codex/config.toml";
const HOOKS_PATH = ".codex/hooks.json";
const SKILL_PATH = ".agents/skills/kcoderag-nav/SKILL.md";
const PYTHON_ASSETS = ["grep_nudge.py", "update_check.py"] as const;
const LEGACY_ASSETS = ["grep_nudge.py", "run_hook.sh", "run_hook.cmd", "update_check.py"] as const;

function write(root: string, relativePath: string, value: string | Buffer): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, value);
}

function read(root: string, relativePath: string): Buffer {
  return fs.readFileSync(path.join(root, ...relativePath.split("/")));
}

function digest(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function original(value: Buffer | undefined): { existed: boolean; base64: string } {
  return value === undefined
    ? { existed: false, base64: "" }
    : { existed: true, base64: value.toString("base64") };
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
      } else {
        records.push(`f:${relative}:${digest(fs.readFileSync(absolute))}`);
      }
    }
  };
  visit(root);
  return records;
}

function currentState(environment: EnvironmentId, extra: Record<string, unknown> = {}): Buffer {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    packageVersion: "0.1.8",
    host: "codex",
    environment,
    managedFiles: [".codex/kcoderag-nav/install-state.json"],
    originals: {},
    digests: {},
    ...extra,
  })}\n`, "utf8");
}

test("current state is exact, immutable, QA-only, and independent of the project path", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-current-state-"));
  try {
    const before = path.join(base, "before");
    const after = path.join(base, "renamed");
    fs.mkdirSync(before);
    write(before, STATE_PATH, currentState("qa"));
    fs.renameSync(before, after);

    const parsed = coreState.parseInstallState(read(after, STATE_PATH));
    assert.equal(parsed.environment, "qa");
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.managedFiles), true);
    assert.equal("projectRoot" in parsed, false);
    assert.throws(() => coreState.parseInstallState(currentState("dev")), /invalid_state/);
    assert.throws(
      () => coreState.parseInstallState(currentState("qa", { projectRoot: "retired-absolute-binding" })),
      /invalid_state/,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("the named legacy decoder alone accepts exact Python and Node QA or Dev records", () => {
  const relativePath = ".codex/kcoderag-nav/install-state.json";
  const options = { allowedPaths: [relativePath], requiredPaths: [relativePath] };
  for (const environment of ["qa", "dev"] as const) {
    const python = Buffer.from(`${JSON.stringify({
      version: 1,
      active_environments: [environment],
      originals: { [relativePath]: { existed: false, base64: "" } },
      digests: { [relativePath]: "0".repeat(64) },
    })}\n`, "utf8");
    assert.equal(coreState.parseLegacyInstallState(python, options).environment, environment);
    assert.equal(
      coreState.parseLegacyInstallState(currentState(environment), options).environment,
      environment,
    );
  }

  assert.throws(
    () => coreState.parseLegacyInstallState(
      currentState("dev", { unknown: true }),
      options,
    ),
    /invalid_state/,
  );
});

function makePackage(base: string): string {
  const root = path.join(base, "package");
  write(root, "package.json", `${JSON.stringify({ name: "kcoderag-nav", version: "0.1.4" })}\n`);
  for (const environment of ["qa", "dev"] as const) {
    const name = `kcoderag-${environment}`;
    write(
      root,
      `${name}/.codex.mcp.json`,
      `${JSON.stringify({
        mcpServers: {
          [name]: {
            url: `https://${environment}.invalid/mcp`,
            http_headers: { Authorization: `Bearer opaque-${environment}` },
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
      write(root, `${name}/hooks/${asset}`, `new-${environment}-${asset}\n`);
    }
    write(root, `${name}/skills/code-lookup-discipline/SKILL.md`, `# new ${environment}\n`);
  }
  return root;
}

function legacyFixture(base: string, environment: EnvironmentId, name: string = environment): {
  readonly root: string;
  readonly configOriginal: Buffer;
  readonly hooksOriginal: Buffer;
  readonly legacyState: Record<string, unknown>;
} {
  const root = path.join(base, name);
  fs.mkdirSync(root);
  const configOriginal = Buffer.from("# user config\n[features]\nkeep = true\n", "utf8");
  const hooksOriginal = Buffer.from(`${JSON.stringify({ hooks: { Stop: [] }, keep: true }, null, 4)}\n`);
  const prefix = `.codex/kcoderag-nav/${environment}/hooks`;
  const current: Record<string, Buffer> = {
    [CONFIG_PATH]: Buffer.from(
      `${configOriginal.toString("utf8")}\n# BEGIN KCODERAG-NAV ${environment}\n` +
      `[mcp_servers.\"kcoderag-${environment}\"]\nurl = \"opaque\"\n` +
      `http_headers = { \"Authorization\" = \"opaque\" }\n` +
      `# END KCODERAG-NAV ${environment}\n`,
    ),
    [HOOKS_PATH]: Buffer.from(`${JSON.stringify({
      hooks: {
        Stop: [],
        PreToolUse: [{ matcher: "Grep|Glob|Bash", hooks: [{ command: `${prefix}/run_hook.sh` }] }],
      },
      keep: true,
    }, null, 2)}\n`),
    [SKILL_PATH]: Buffer.from(`# old ${environment}\n`),
  };
  for (const asset of LEGACY_ASSETS) current[`${prefix}/${asset}`] = Buffer.from(`old-${asset}\n`);

  const originals: Record<string, { existed: boolean; base64: string }> = {};
  const digests: Record<string, string> = {};
  for (const [relativePath, bytes] of Object.entries(current)) {
    write(root, relativePath, bytes);
    originals[relativePath] = relativePath === CONFIG_PATH
      ? original(configOriginal)
      : relativePath === HOOKS_PATH
        ? original(hooksOriginal)
        : original(undefined);
    digests[relativePath] = digest(bytes);
  }
  const legacyState = {
    version: 1,
    active_environments: [environment],
    originals,
    digests,
  };
  write(root, STATE_PATH, `${JSON.stringify(legacyState, null, 2)}\n`);
  write(root, `${prefix}/custom.py`, "unowned-local-python\n");
  write(root, "ordinary.txt", "keep\n");
  return { root, configOriginal, hooksOriginal, legacyState };
}

function observe(root: string, packageRoot: string): {
  readonly target: Record<string, unknown>;
  readonly observation: Record<string, unknown>;
} {
  const target = projectTarget.resolveProjectTarget(root);
  return {
    target,
    observation: codex.codexAdapter.detect({ target, packageRoot }),
  };
}

function renderMigration(root: string, packageRoot: string, environment: EnvironmentId) {
  const { target, observation } = observe(root, packageRoot);
  return {
    target,
    observation,
    desired: codex.codexAdapter.renderInstall({
      target,
      packageRoot,
      command: "update",
      environment,
      observation,
      allowLegacyUserRemoval: false,
    }),
  };
}

// Public desired-state migration remains QA-only; Plan 04-03 adds host-specific Dev-to-QA conversion.
for (const environment of ["qa"] as const) {
  test(`legacy ${environment.toUpperCase()} state previews migration, migrates in place, and uninstalls cleanly`, () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `kcoderag-legacy-${environment}-`));
    try {
      const packageRoot = makePackage(base);
      const fixture = legacyFixture(base, environment);
      const beforePreview = snapshot(fixture.root);
      const initial = observe(fixture.root, packageRoot);
      const preview = codex.codexAdapter.status({
        target: initial.target,
        packageRoot,
        environment: "qa",
        observation: initial.observation,
        doctor: true,
      });
      assert.equal(preview.status, "update_available");
      assert.match(JSON.stringify(preview), /legacy_migration_available/);
      assert.deepEqual(snapshot(fixture.root), beforePreview);

      const migration = renderMigration(fixture.root, packageRoot, environment);
      transaction.applyTransaction(migration.desired);
      const state = JSON.parse(read(fixture.root, STATE_PATH).toString("utf8")) as {
        schemaVersion: number;
        host: string;
        environment: string;
        managedFiles: string[];
      };
      assert.equal(state.schemaVersion, 1);
      assert.equal(state.host, "codex");
      assert.equal(state.environment, environment);
      assert.ok(state.managedFiles.every((item) => !item.endsWith(".py")));
      for (const asset of PYTHON_ASSETS) {
        assert.equal(
          fs.existsSync(path.join(fixture.root, `.codex/kcoderag-nav/${environment}/hooks/${asset}`)),
          false,
        );
      }
      assert.equal(
        fs.existsSync(path.join(fixture.root, `.codex/kcoderag-nav/${environment}/hooks/custom.py`)),
        true,
      );
      const healthy = observe(fixture.root, packageRoot);
      assert.equal(codex.codexAdapter.status({
        target: healthy.target,
        packageRoot,
        environment,
        observation: healthy.observation,
        doctor: false,
      }).status, "healthy");

      const uninstall = codex.codexAdapter.renderUninstall({
        target: healthy.target,
        packageRoot,
        environment,
        observation: healthy.observation,
        allowLegacyUserRemoval: false,
      });
      transaction.applyTransaction(uninstall);
      assert.deepEqual(read(fixture.root, CONFIG_PATH), fixture.configOriginal);
      assert.deepEqual(read(fixture.root, HOOKS_PATH), fixture.hooksOriginal);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
}

test("legacy migration refuses drift, unknown ownership, and partial state with zero writes", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-legacy-refuse-"));
  try {
    const packageRoot = makePackage(base);
    const drift = legacyFixture(base, "qa", "drift");
    write(drift.root, ".codex/kcoderag-nav/qa/hooks/grep_nudge.py", "changed\n");
    const driftBefore = snapshot(drift.root);
    assert.throws(() => renderMigration(drift.root, packageRoot, "qa"), /managed_content_changed/);
    assert.deepEqual(snapshot(drift.root), driftBefore);

    const unknown = legacyFixture(base, "qa", "unknown");
    const unknownState = JSON.parse(read(unknown.root, STATE_PATH).toString("utf8")) as {
      digests: Record<string, string>;
    };
    unknownState.digests[".codex/kcoderag-nav/qa/hooks/unknown.py"] = "0".repeat(64);
    write(unknown.root, STATE_PATH, `${JSON.stringify(unknownState, null, 2)}\n`);
    const unknownBefore = snapshot(unknown.root);
    assert.throws(() => renderMigration(unknown.root, packageRoot, "qa"), /invalid_state/);
    assert.deepEqual(snapshot(unknown.root), unknownBefore);

    const partial = legacyFixture(base, "dev", "partial");
    const partialState = JSON.parse(read(partial.root, STATE_PATH).toString("utf8")) as {
      originals: Record<string, unknown>;
    };
    delete partialState.originals[SKILL_PATH];
    write(partial.root, STATE_PATH, `${JSON.stringify(partialState, null, 2)}\n`);
    const partialBefore = snapshot(partial.root);
    assert.throws(() => renderMigration(partial.root, packageRoot, "dev"), /invalid_state/);
    assert.deepEqual(snapshot(partial.root), partialBefore);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("legacy migration rollback restores the complete Python-managed tree", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-legacy-rollback-"));
  try {
    const packageRoot = makePackage(base);
    const fixture = legacyFixture(base, "qa");
    const before = snapshot(fixture.root);
    const migration = renderMigration(fixture.root, packageRoot, "qa");
    assert.throws(
      () => transaction.applyTransaction(migration.desired, { failAtCommit: 3 }),
      /transaction_failed/,
    );
    assert.deepEqual(snapshot(fixture.root), before);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
