const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor";

interface CommandModule {
  executeCommand(argv: string[], dependencies: Record<string, unknown>): Promise<number>;
}

const commands = require("../../dist/cli/commands.cjs") as CommandModule;
const coreState = require("../../dist/core/state.cjs") as {
  createDesiredState(input: Record<string, unknown>): unknown;
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
  options: { legacy?: boolean } = {},
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
      };
    },
    renderInstall(context: Record<string, any>) {
      calls.push(`${host}:renderInstall:${String(context.allowLegacyUserRemoval)}`);
      return coreState.createDesiredState({
        host,
        target: context.target,
        managedRoots: [`.fixture-${host}`],
        statePath: `.fixture-${host}/install-state.json`,
        entries: [
          {
            relativePath: `.fixture-${host}/payload.txt`,
            expectedDigest: null,
            content: Buffer.from(`${host}\n`, "utf8"),
          },
          {
            relativePath: `.fixture-${host}/install-state.json`,
            expectedDigest: null,
            content: Buffer.from('{"schemaVersion":1}\n', "utf8"),
          },
        ],
      });
    },
    renderUninstall() {
      calls.push(`${host}:renderUninstall`);
      throw new Error("not used by RED fixture");
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
    assert.deepEqual(calls, ["codex:detect", "codex:renderInstall:false"]);
    assert.equal(fs.readFileSync(path.join(item.target, ".fixture-codex/payload.txt"), "utf8"), "codex\n");
    assert.equal(fs.existsSync(path.join(item.target, ".fixture-claude")), false);
    assert.equal(fs.existsSync(path.join(item.target, ".fixture-cursor")), false);
    assert.equal(captured.stderr.length, 0);
    assert.equal(JSON.parse(captured.stdout[0] ?? "").ok, true);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
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
