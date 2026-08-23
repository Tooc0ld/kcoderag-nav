const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor";

const commands = require("../../dist/cli/commands.cjs") as {
  executeCommand(argv: string[], dependencies?: Record<string, unknown>): Promise<number>;
};
const registry = require("../../dist/hosts/index.cjs") as {
  readonly HOST_ADAPTERS: readonly Record<string, unknown>[];
  getHostAdapter(host: HostId): Record<string, unknown>;
};

function write(root: string, relativePath: string, value: string | Buffer): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, value);
}

function packageFixture(base: string): string {
  const root = path.join(base, "package");
  const secret = `opaque-${crypto.randomUUID()}`;
  write(root, "package.json", `${JSON.stringify({ name: "kcoderag-nav", version: "0.1.4" })}\n`);
  for (const environment of ["qa", "dev"] as const) {
    const name = `kcoderag-${environment}`;
    const server = {
      type: "http",
      url: `https://${environment}.invalid/mcp`,
      headers: { Authorization: `Bearer ${secret}-${environment}` },
    };
    write(root, `${name}/.mcp.json`, `${JSON.stringify({ mcpServers: { [name]: server } })}\n`);
    write(root, `${name}/.codex.mcp.json`, `${JSON.stringify({ [name]: {
      url: server.url,
      http_headers: server.headers,
    } })}\n`);
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
  write(root, "kcoderag-cursor/rules/kcoderag-navigation.mdc", "---\nalwaysApply: true\n---\nUse KCodeRag.\n");
  write(root, "kcoderag-cursor/skills/code-lookup-discipline/SKILL.md", "# Cursor\n");
  return root;
}

function targetFixture(base: string): string {
  const root = path.join(base, "target");
  fs.mkdirSync(root);
  write(root, ".codex/config.toml", "# codex unrelated\n");
  write(root, ".codex/hooks.json", '{"hooks":{"Stop":[]}}\n');
  write(root, ".claude/settings.json", '{"permissions":{"allow":["Read"]}}\n');
  write(root, ".mcp.json", '{"mcpServers":{"claude-unrelated":{"command":"safe"}}}\n');
  write(root, ".cursor/mcp.json", '{"mcpServers":{"cursor-unrelated":{"command":"safe"}}}\n');
  return root;
}

function snapshotPaths(root: string, relativePaths: readonly string[]): readonly string[] {
  const records: string[] = [];
  const visit = (absolute: string, logicalRoot: string): void => {
    if (!fs.existsSync(absolute)) return;
    const metadata = fs.lstatSync(absolute);
    if (metadata.isFile()) {
      records.push(`f:${logicalRoot}:${crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")}`);
      return;
    }
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(absolute, entry.name);
      const logical = `${logicalRoot}/${entry.name}`;
      if (entry.isDirectory()) {
        records.push(`d:${logical}`);
        visit(child, logical);
      } else {
        records.push(`f:${logical}:${crypto.createHash("sha256").update(fs.readFileSync(child)).digest("hex")}`);
      }
    }
  };
  for (const relativePath of relativePaths) visit(path.join(root, ...relativePath.split("/")), relativePath);
  return records;
}

function hostSnapshot(root: string, host: HostId): readonly string[] {
  if (host === "codex") return snapshotPaths(root, [".codex", ".agents"]);
  if (host === "claude") return snapshotPaths(root, [".claude", ".mcp.json"]);
  return snapshotPaths(root, [".cursor"]);
}

async function run(
  target: string,
  packageRoot: string,
  command: "install" | "status" | "doctor" | "update" | "uninstall",
  host: HostId | undefined,
  environment = "qa",
  extraDependencies: Record<string, unknown> = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const argv = [command, "--json", "--environment", environment];
  if (host !== undefined) argv.push("--host", host);
  if (["install", "update", "uninstall"].includes(command)) argv.push("--yes");
  const exitCode = await commands.executeCommand(argv, {
    cwd: target,
    packageRoot,
    nodeVersion: "22.20.0",
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    ...extraDependencies,
  });
  return { exitCode, output: JSON.parse(stdout[0] ?? "{}") as Record<string, unknown>, stderr };
}

test("registry exposes exactly three fixed adapters and rejects unsupported hosts", () => {
  assert.deepEqual(registry.HOST_ADAPTERS.map((adapter: any) => adapter.id), ["codex", "claude", "cursor"]);
  for (const host of ["codex", "claude", "cursor"] as const) {
    assert.equal(registry.getHostAdapter(host).id, host);
  }
  assert.throws(() => registry.getHostAdapter("opencode" as HostId), /unsupported_host/);
  assert.equal(JSON.stringify(registry.HOST_ADAPTERS).includes("opencode"), false);
});

test("Codex, Claude, and Cursor coexist while one-host update and uninstall leave siblings unchanged", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cross-host-"));
  try {
    const packageRoot = packageFixture(base);
    const target = targetFixture(base);
    for (const host of ["codex", "claude", "cursor"] as const) {
      assert.equal((await run(target, packageRoot, "install", host)).exitCode, 0, host);
      assert.equal((await run(target, packageRoot, "status", host)).output.status, "healthy", host);
    }

    const claudeBefore = hostSnapshot(target, "claude");
    const cursorBefore = hostSnapshot(target, "cursor");
    write(packageRoot, "kcoderag-qa/hooks/grep-nudge.cjs", "qa:updated\n");
    assert.equal((await run(target, packageRoot, "update", "codex")).exitCode, 0);
    assert.deepEqual(hostSnapshot(target, "claude"), claudeBefore);
    assert.deepEqual(hostSnapshot(target, "cursor"), cursorBefore);

    const codexBefore = hostSnapshot(target, "codex");
    const cursorStillBefore = hostSnapshot(target, "cursor");
    assert.equal((await run(target, packageRoot, "uninstall", "claude")).exitCode, 0);
    assert.deepEqual(hostSnapshot(target, "codex"), codexBefore);
    assert.deepEqual(hostSnapshot(target, "cursor"), cursorStillBefore);
    assert.equal((await run(target, packageRoot, "status", "codex")).output.status, "healthy");
    assert.equal((await run(target, packageRoot, "status", "cursor")).output.status, "healthy");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("same-host environment conflict and interactive selection affect only the selected adapter", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cross-select-"));
  try {
    const packageRoot = packageFixture(base);
    const target = targetFixture(base);
    assert.equal((await run(target, packageRoot, "install", "codex")).exitCode, 0);
    assert.equal((await run(target, packageRoot, "install", "cursor")).exitCode, 0);
    const codexBefore = hostSnapshot(target, "codex");
    const cursorBefore = hostSnapshot(target, "cursor");
    const conflict = await run(target, packageRoot, "install", "codex", "dev");
    assert.equal(conflict.output.code, "environment_conflict");
    assert.deepEqual(hostSnapshot(target, "codex"), codexBefore);
    assert.deepEqual(hostSnapshot(target, "cursor"), cursorBefore);

    const interactiveTarget = path.join(base, "interactive");
    fs.mkdirSync(interactiveTarget);
    write(interactiveTarget, ".mcp.json", '{"mcpServers":{}}\n');
    const seen: HostId[][] = [];
    const selected = await commands.executeCommand(["install", "--yes"], {
      cwd: interactiveTarget,
      packageRoot,
      nodeVersion: "22.20.0",
      stdout: () => undefined,
      stderr: () => undefined,
      selectHost: (hosts: readonly HostId[]) => {
        seen.push([...hosts]);
        return "claude";
      },
    });
    assert.equal(selected, 0);
    assert.deepEqual(seen, [["codex", "claude", "cursor"]]);
    assert.equal(fs.existsSync(path.join(interactiveTarget, ".claude/kcoderag-nav/install-state.json")), true);
    assert.equal(fs.existsSync(path.join(interactiveTarget, ".codex")), false);
    assert.equal(fs.existsSync(path.join(interactiveTarget, ".cursor")), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
