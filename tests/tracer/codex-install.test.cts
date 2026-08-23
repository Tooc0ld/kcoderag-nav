const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const childProcess = require("node:child_process") as typeof import("node:child_process");

interface InstallResult {
  host: "codex";
  environment: "qa";
  target: string;
  version: string;
  managedFiles: string[];
}

interface TracerModule {
  installCodexQa(options: {
    target: string;
    packageRoot: string;
    failAtStage?: number;
    failAtCommit?: number;
    onCommit?: (relativePath: string) => void;
  }): InstallResult;
  runCli(
    argv: string[],
    dependencies: {
      cwd: string;
      packageRoot: string;
      nodeVersion?: string;
      stdout: (text: string) => void;
      stderr: (text: string) => void;
      confirm: (prompt: string) => boolean;
    },
  ): Promise<number>;
}

const tracerModule = require("../../dist/tracer/codex-install.cjs") as TracerModule;

const STATE_PATH = ".codex/kcoderag-nav/install-state.json";
const EXPECTED_MANAGED = [
  ".agents/skills/kcoderag-nav/SKILL.md",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".codex/kcoderag-nav/qa/hooks/grep-nudge.cjs",
  ".codex/kcoderag-nav/qa/hooks/run_hook.cmd",
  ".codex/kcoderag-nav/qa/hooks/run_hook.sh",
  ".codex/kcoderag-nav/qa/hooks/update-check.cjs",
  ".codex/kcoderag-nav/qa/hooks/update-worker.cjs",
  STATE_PATH,
];

function write(root: string, relativePath: string, bytes: string | Buffer): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
}

function makePackageRoot(base: string): { root: string; secret: string } {
  const root = path.join(base, "package");
  const secret = `sensitive-${crypto.randomUUID()}`;
  write(
    root,
    "package.json",
    `${JSON.stringify({
      name: "kcoderag-nav",
      version: "0.1.4",
      bin: { "kcoderag-nav": "dist/bin/kcoderag-nav.cjs" },
      engines: { node: ">=22" },
    })}\n`,
  );
  write(
    root,
    "kcoderag-qa/.codex.mcp.json",
    `${JSON.stringify({
      "kcoderag-qa": {
        url: "https://qa.invalid/mcp",
        http_headers: { Authorization: `Bearer ${secret}` },
      },
    })}\n`,
  );
  write(root, "kcoderag-qa/hooks/grep-nudge.cjs", "process.exitCode = 0;\n");
  write(root, "kcoderag-qa/hooks/update-check.cjs", "process.exitCode = 0;\n");
  write(root, "kcoderag-qa/hooks/update-worker.cjs", "process.exitCode = 0;\n");
  write(root, "kcoderag-qa/hooks/run_hook.cmd", "@node \"%~dp0grep-nudge.cjs\"\n");
  write(root, "kcoderag-qa/hooks/run_hook.sh", "#!/bin/sh\nnode \"$(dirname \"$0\")/grep-nudge.cjs\"\n");
  write(root, "kcoderag-qa/skills/code-lookup-discipline/SKILL.md", "# KCodeRag QA\n");
  return { root, secret };
}

function makeTarget(base: string, name = "target"): string {
  const target = path.join(base, name);
  fs.mkdirSync(path.join(target, ".codex"), { recursive: true });
  write(target, ".codex/config.toml", "[features]\nexisting = true\n");
  write(target, ".codex/hooks.json", `${JSON.stringify({ hooks: { Stop: [{ hooks: [] }] } })}\n`);
  write(target, "ordinary.bin", Buffer.from([0, 1, 2, 3]));
  return target;
}

function snapshotTree(root: string): string[] {
  const records: string[] = [];
  function visit(directory: string): void {
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
        records.push(`f:${relative}:${crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")}`);
      }
    }
  }
  visit(root);
  return records;
}

function capturedIo(cwd: string, packageRoot: string, overrides: Partial<{
  nodeVersion: string;
  confirm: (prompt: string) => boolean;
}> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const prompts: string[] = [];
  const dependencies: {
    cwd: string;
    packageRoot: string;
    nodeVersion?: string;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    confirm: (prompt: string) => boolean;
  } = {
    cwd,
    packageRoot,
    stdout: (text: string) => {
      stdout.push(text);
    },
    stderr: (text: string) => {
      stderr.push(text);
    },
    confirm: (prompt: string) => {
      prompts.push(prompt);
      return overrides.confirm ? overrides.confirm(prompt) : true;
    },
  };
  if (overrides.nodeVersion !== undefined) dependencies.nodeVersion = overrides.nodeVersion;
  return {
    stdout,
    stderr,
    prompts,
    dependencies,
  };
}

test("compiled CLI installs the Codex QA project slice with one safe JSON value", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-tracer-cli-"));
  try {
    const fixture = makePackageRoot(base);
    const compiledBin = fs.readFileSync(path.resolve("dist/bin/kcoderag-nav.cjs"), "utf8");
    assert.ok(compiledBin.startsWith("#!/usr/bin/env node\n"));
    assert.doesNotMatch(compiledBin, /\.cts|python/i);
    fs.cpSync(path.resolve("dist"), path.join(fixture.root, "dist"), { recursive: true });
    const target = makeTarget(base);
    const npmCli = [
      process.env.npm_execpath,
      path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
      path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    ].find((candidate): candidate is string =>
      typeof candidate === "string" && fs.existsSync(candidate),
    );
    assert.equal(typeof npmCli, "string");
    const result = childProcess.spawnSync(
      process.execPath,
      [
        npmCli as string,
        "exec",
        "--yes",
        "--offline",
        "--ignore-scripts",
        `--package=${fixture.root}`,
        "--",
        "kcoderag-nav",
        "install",
        "--host",
        "codex",
        "--environment",
        "qa",
        "--target",
        target,
        "--yes",
        "--json",
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout) as InstallResult & { ok: boolean };
    assert.equal(output.ok, true);
    assert.equal(output.target, fs.realpathSync(target));
    assert.deepEqual(output.managedFiles, EXPECTED_MANAGED);
    assert.ok(!result.stdout.includes(fixture.secret));
    assert.ok(!result.stderr.includes(fixture.secret));

    const installed = snapshotTree(target).join("\n");
    for (const managed of EXPECTED_MANAGED) {
      assert.match(installed, new RegExp(`[fd]:${managed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    }
    assert.doesNotMatch(installed, /\.(?:py|cts)(?::|$)/);
    assert.match(fs.readFileSync(path.join(target, ".codex/config.toml"), "utf8"), /\[features\]/);
    const state = fs.readFileSync(path.join(target, ...STATE_PATH.split("/")), "utf8");
    assert.ok(!state.includes(fixture.secret));
    assert.equal((JSON.parse(state) as { schemaVersion: number }).schemaVersion, 1);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cwd default, absolute confirmation, cancellation, and Node 22 gate are zero-write", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-tracer-gates-"));
  try {
    const fixture = makePackageRoot(base);
    const target = makeTarget(base);
    const before = snapshotTree(target);

    const cancelled = capturedIo(target, fixture.root, { confirm: () => false });
    assert.equal(await tracerModule.runCli(["install", "--host", "codex"], cancelled.dependencies), 2);
    assert.equal(cancelled.prompts.length, 1);
    assert.ok(cancelled.prompts[0]?.includes(fs.realpathSync(target)));
    assert.deepEqual(snapshotTree(target), before);

    const oldNode = capturedIo(target, fixture.root, { nodeVersion: "21.9.0" });
    assert.equal(
      await tracerModule.runCli(
        ["install", "--host", "codex", "--environment", "qa", "--yes", "--json"],
        oldNode.dependencies,
      ),
      1,
    );
    assert.deepEqual(snapshotTree(target), before);
    assert.equal(oldNode.stdout.length, 1);
    assert.equal((JSON.parse(oldNode.stdout[0] ?? "") as { code: string }).code, "unsupported_node");
    assert.ok(!oldNode.stdout.join("").includes(fixture.secret));
    assert.ok(!oldNode.stderr.join("").includes(fixture.secret));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("unmanaged conflicts, managed drift, and unsafe targets refuse before writes", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-tracer-refuse-"));
  try {
    const fixture = makePackageRoot(base);
    const conflict = makeTarget(base, "conflict");
    write(conflict, ".agents/skills/kcoderag-nav/SKILL.md", "unowned\n");
    const beforeConflict = snapshotTree(conflict);
    assert.throws(
      () => tracerModule.installCodexQa({ target: conflict, packageRoot: fixture.root }),
      (error: unknown) =>
        error instanceof Error && "code" in error &&
        (error as Error & { code: string }).code === "unmanaged_name_conflict",
    );
    assert.deepEqual(snapshotTree(conflict), beforeConflict);

    const drift = makeTarget(base, "drift");
    tracerModule.installCodexQa({ target: drift, packageRoot: fixture.root });
    const installed = snapshotTree(drift);
    tracerModule.installCodexQa({ target: drift, packageRoot: fixture.root });
    assert.deepEqual(snapshotTree(drift), installed);
    write(drift, ".codex/kcoderag-nav/qa/hooks/grep-nudge.cjs", "locally changed\n");
    const beforeDrift = snapshotTree(drift);
    assert.throws(
      () => tracerModule.installCodexQa({ target: drift, packageRoot: fixture.root }),
      (error: unknown) =>
        error instanceof Error && "code" in error &&
        (error as Error & { code: string }).code === "managed_content_changed",
    );
    assert.deepEqual(snapshotTree(drift), beforeDrift);

    const root = path.parse(path.resolve(base)).root;
    assert.throws(
      () => tracerModule.installCodexQa({ target: root, packageRoot: fixture.root }),
      (error: unknown) =>
        error instanceof Error && "code" in error &&
        (error as Error & { code: string }).code === "unsafe_target",
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("symlinked managed roots cannot escape the explicit project", (context) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-tracer-link-"));
  try {
    const fixture = makePackageRoot(base);
    const target = path.join(base, "target");
    const outside = path.join(base, "outside");
    fs.mkdirSync(target);
    fs.mkdirSync(outside);
    try {
      fs.symlinkSync(outside, path.join(target, ".codex"), "junction");
    } catch (error) {
      context.skip(`symlink unavailable: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`);
      return;
    }
    const beforeTarget = snapshotTree(target);
    const beforeOutside = snapshotTree(outside);
    assert.throws(
      () => tracerModule.installCodexQa({ target, packageRoot: fixture.root }),
      (error: unknown) =>
        error instanceof Error && "code" in error &&
        (error as Error & { code: string }).code === "symlink_escape",
    );
    assert.deepEqual(snapshotTree(target), beforeTarget);
    assert.deepEqual(snapshotTree(outside), beforeOutside);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("every transaction commit failure restores the complete pre-install tree and commits state last", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-tracer-rollback-"));
  try {
    const fixture = makePackageRoot(base);
    const successfulTarget = makeTarget(base, "successful");
    const order: string[] = [];
    tracerModule.installCodexQa({
      target: successfulTarget,
      packageRoot: fixture.root,
      onCommit: (relativePath) => order.push(relativePath),
    });
    assert.equal(order.at(-1), STATE_PATH);
    assert.deepEqual([...order].sort(), [...EXPECTED_MANAGED].sort());

    for (let failAtStage = 0; failAtStage < order.length; failAtStage += 1) {
      const target = makeTarget(base, `stage-failure-${failAtStage}`);
      const before = snapshotTree(target);
      assert.throws(
        () =>
          tracerModule.installCodexQa({
            target,
            packageRoot: fixture.root,
            failAtStage,
          }),
        (error: unknown) =>
          error instanceof Error && "code" in error &&
          (error as Error & { code: string }).code === "transaction_failed",
      );
      assert.deepEqual(snapshotTree(target), before, `failed stage ${failAtStage}`);
    }

    for (let failAtCommit = 0; failAtCommit < order.length; failAtCommit += 1) {
      const target = makeTarget(base, `failure-${failAtCommit}`);
      const before = snapshotTree(target);
      assert.throws(
        () =>
          tracerModule.installCodexQa({
            target,
            packageRoot: fixture.root,
            failAtCommit,
          }),
        (error: unknown) =>
          error instanceof Error && "code" in error &&
          (error as Error & { code: string }).code === "transaction_failed",
      );
      assert.deepEqual(snapshotTree(target), before, `failed commit ${failAtCommit}`);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
