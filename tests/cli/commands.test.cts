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
    assert.deepEqual(calls, ["codex:detect", "codex:renderInstall:false"]);
    assert.equal(
      fs.readFileSync(path.join(item.target, ".fixture-codex/payload.txt"), "utf8"),
      "codex:install\n",
    );
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
          : `codex:renderInstall:false`,
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
    assert.deepEqual(calls, []);
    assert.equal(fs.readdirSync(explicit).length, 0);
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
    assert.deepEqual(cursorCalls, ["cursor:detect", "cursor:renderInstall:true"]);

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
