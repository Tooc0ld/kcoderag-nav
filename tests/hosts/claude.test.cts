const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const claude = require("../../dist/hosts/claude.cjs") as Record<string, any>;
const projectTarget = require("../../dist/core/project-target.cjs") as Record<string, any>;
const transaction = require("../../dist/core/transaction.cjs") as Record<string, any>;

const PACKAGE_ROOT = path.resolve(".");
const NAVIGATION = "kcoderag-navigation";
const CODE_STYLE = "code-style-nudge";
const RECEIPT_PATH = path.join(PACKAGE_ROOT, "fixtures", "host-delivery", "claude-2.1.241.json");
const RECEIPT_DIGEST = "bb00429dbca08a026604c6f2aeeac988d757fbe10751a92ed7b7d7c2093bd119";

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function runNpm(args: readonly string[], cwd: string): string {
  const completed = process.platform === "win32"
    ? childProcess.spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...args], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
      })
    : childProcess.spawnSync("npm", args, { cwd, encoding: "utf8" });
  assert.equal(completed.status, 0, "private package command must succeed");
  return typeof completed.stdout === "string" ? completed.stdout : "";
}

function packRepository(root: string): string {
  const destination = path.join(root, "private-pack");
  fs.mkdirSync(destination, { recursive: true });
  const output = JSON.parse(runNpm([
    "pack",
    PACKAGE_ROOT,
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    destination,
  ], root)) as readonly [{ readonly filename: string }];
  assert.equal(output.length, 1);
  const tarball = fs.realpathSync.native(path.resolve(destination, output[0].filename));
  assert.equal(path.dirname(tarball), fs.realpathSync.native(destination));
  return tarball;
}

function acquirePackedPackage(root: string, tarball: string): string {
  const acquisition = path.join(root, "acquisition");
  fs.mkdirSync(acquisition);
  runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefix",
    acquisition,
    tarball,
  ], root);
  const packageRoot = path.join(acquisition, "node_modules", "kcoderag-nav");
  assert.equal(fs.statSync(packageRoot).isDirectory(), true);
  return packageRoot;
}

async function runInstalledClaudeCommand(
  packageRoot: string,
  target: string,
  homeDirectory: string,
  hostVersion: string,
  args: readonly string[],
): Promise<{ readonly exitCode: number; readonly stdout: readonly string[]; readonly stderr: readonly string[] }> {
  const commands = require(path.join(packageRoot, "dist", "cli", "commands.cjs")) as Record<string, any>;
  const installedClaude = require(path.join(packageRoot, "dist", "hosts", "claude.cjs")) as Record<string, any>;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await commands.executeCommand([...args], {
    cwd: target,
    packageRoot,
    nodeVersion: process.versions.node,
    mutationLockRoot: path.join(path.dirname(target), "locks"),
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    getAdapter: (host: string) => {
      assert.equal(host, "claude");
      return installedClaude.createClaudeAdapter({
        homeDirectory,
        hostVersion,
        readUserSources: () => ({}),
      });
    },
  });
  return Object.freeze({ exitCode, stdout: Object.freeze(stdout), stderr: Object.freeze(stderr) });
}

function runInstalledClaudeLauncher(
  target: string,
  homeDirectory: string,
  cacheRoot: string,
  sessionId: string,
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const launcher = path.join(
    target,
    ".claude",
    "kcoderag-nav",
    "qa",
    "hooks",
    process.platform === "win32" ? "run_hook.cmd" : "run_hook.sh",
  );
  const payload = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: "src/tracer.cpp", content: "int tracer = 1;\n" },
    session_id: sessionId,
  });
  const env = {
    ...process.env,
    HOME: homeDirectory,
    USERPROFILE: homeDirectory,
    LOCALAPPDATA: cacheRoot,
    XDG_CACHE_HOME: cacheRoot,
    KCODERAG_NAV_UPDATE_CHECK: "0",
  };
  const result = process.platform === "win32"
    ? childProcess.spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "call", launcher, "claude"], {
        cwd: target,
        input: `${payload}\n`,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        env,
      })
    : childProcess.spawnSync("/bin/sh", [launcher, "claude"], {
        cwd: target,
        input: `${payload}\n`,
        encoding: "utf8",
        timeout: 10_000,
        env,
      });
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

function projectSnapshot(root: string): readonly string[] {
  const records: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) visit(absolute);
      else records.push(`${relative}:${sha256(fs.readFileSync(absolute))}`);
    }
  };
  visit(root);
  return Object.freeze(records);
}

function markerInventory(cacheRoot: string): readonly string[] {
  const directory = path.join(cacheRoot, "kcoderag-nav", "nudges");
  try {
    return Object.freeze(fs.readdirSync(directory).sort());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]);
    throw error;
  }
}

function context(target: any, observation: any, selectedCapabilities: readonly string[], command = "install") {
  return {
    target,
    packageRoot: PACKAGE_ROOT,
    command,
    environment: "qa",
    observation,
    selectedCapabilities,
  };
}

function uninstallContext(target: any, observation: any, selectedCapabilities: readonly string[]) {
  return {
    target,
    packageRoot: PACKAGE_ROOT,
    environment: "qa",
    observation,
    selectedCapabilities,
  };
}

test("Claude version parser accepts only exact official 2.1.241 output shapes", () => {
  assert.equal(claude.parseClaudeVersionOutput("2.1.241 (Claude Code)\n"), "2.1.241");
  assert.equal(claude.parseClaudeVersionOutput("Claude Code 2.1.241\n"), "2.1.241");
  assert.equal(claude.parseClaudeVersionOutput("claude 2.1.241\n"), "2.1.241");
  for (const invalid of [
    "2.1.241 arbitrary",
    "2.1.241 (Claude Code) trailing",
    "Claude Code 2.1.241 9.9.9",
    "version=2.1.241",
    "2.1",
  ]) {
    assert.equal(claude.parseClaudeVersionOutput(invalid), undefined, invalid);
  }
});

test("Claude 2.1.241 renders and partially removes the complete receipt-backed capability set", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-claude-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = claude.createClaudeAdapter({ hostVersion: "2.1.241", evidenceRoot: PACKAGE_ROOT });
    assert.equal("cleanupOwnedSource" in adapter, false);
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(target, observation, [CODE_STYLE, NAVIGATION])));

    const statePath = path.join(root, ".claude/kcoderag-nav/install-state.json");
    let state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION, CODE_STYLE]);
    for (const relativePath of [
      ".mcp.json",
      ".claude/settings.json",
      ".claude/skills/kcoderag-nav/SKILL.md",
      ".claude/skills/code-style-correction/SKILL.md",
      ".claude/skills/code-style-correction/references/cpp-lifetime-control-flow.md",
      ".claude/skills/code-style-correction/references/protocol-serialization-data.md",
      ".claude/skills/code-style-correction/references/lua-contracts.md",
      ".claude/skills/code-style-correction/references/change-hygiene-self-review.md",
      ".claude/kcoderag-nav/qa/hooks/code-style-nudge.cjs",
      ".claude/kcoderag-nav/qa/hooks/pre-tool-dispatcher.cjs",
      ".claude/kcoderag-nav/qa/hooks/once-marker.cjs",
      ".claude/kcoderag-nav/qa/hooks/update-notice.cjs",
    ]) {
      assert.equal(fs.existsSync(path.join(root, ...relativePath.split("/"))), true, relativePath);
    }
    const settings = JSON.parse(fs.readFileSync(path.join(root, ".claude/settings.json"), "utf8"));
    assert.match(JSON.stringify(settings), /PreToolUse/u);
    assert.match(JSON.stringify(settings), /PostToolUse/u);
    const mcp = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
    assert.equal(typeof mcp.mcpServers["kcoderag-qa"].url, "string");
    assert.equal(mcp.mcpServers["kcoderag-qa"].url.endsWith("/"), false);

    const installed = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderUninstall(uninstallContext(target, installed, [CODE_STYLE])));
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.deepEqual(state.capabilities.map((entry: any) => entry.id), [NAVIGATION]);
    assert.equal(fs.existsSync(path.join(root, ".claude/skills/code-style-correction/SKILL.md")), false);
    assert.equal(fs.existsSync(path.join(root, ".claude/skills/kcoderag-nav/SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(root, ".claude/kcoderag-nav/qa/hooks/update-notice.cjs")), true);
    assert.equal(fs.existsSync(path.join(root, ".mcp.json")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Claude additive navigation install refuses an unmanaged same-name project MCP entry without writes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-claude-additive-conflict-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = claude.createClaudeAdapter({ hostVersion: "2.1.241", evidenceRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(
      target,
      adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
      [CODE_STYLE],
    )));
    fs.writeFileSync(path.join(root, ".mcp.json"), JSON.stringify({
      mcpServers: {
        "kcoderag-qa": {
          type: "http",
          url: "https://unmanaged.example.invalid/mcp",
          headers: { Authorization: "Bearer unmanaged-fixture" },
        },
      },
    }, null, 2));
    const before = projectSnapshot(root);
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });

    assert.throws(
      () => adapter.renderInstall(context(target, observation, [NAVIGATION])),
      (error: any) => error?.code === "unmanaged_name_conflict" && error?.safePath === ".mcp.json",
    );
    assert.deepEqual(projectSnapshot(root), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Claude support is exact and managed code-style drift is capability_drift", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-claude-drift-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const unsupported = claude.createClaudeAdapter({ hostVersion: "2.1.242", evidenceRoot: PACKAGE_ROOT });
    assert.throws(
      () => unsupported.renderInstall(context(
        target,
        unsupported.detect({ target, packageRoot: PACKAGE_ROOT }),
        [CODE_STYLE],
      )),
      (error: any) => error?.code === "host_version_unsupported",
    );
    assert.deepEqual(fs.readdirSync(root), []);

    const adapter = claude.createClaudeAdapter({ hostVersion: "2.1.241", evidenceRoot: PACKAGE_ROOT });
    const observation = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(target, observation, [CODE_STYLE])));
    const reference = ".claude/skills/code-style-correction/references/lua-contracts.md";
    fs.appendFileSync(path.join(root, ...reference.split("/")), "\ndrift\n");
    const drifted = adapter.detect({ target, packageRoot: PACKAGE_ROOT });
    assert.deepEqual(drifted.issues, [{ code: "capability_drift", path: reference }]);
    assert.equal(adapter.status({ target, packageRoot: PACKAGE_ROOT, environment: "qa", observation: drifted, doctor: true }).status, "drifted");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Claude extra code-style overrides are visible read-only as capability drift", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cap-claude-extra-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = claude.createClaudeAdapter({ hostVersion: "2.1.241", evidenceRoot: PACKAGE_ROOT });
    await transaction.applyTransaction(adapter.renderInstall(context(
      target,
      adapter.detect({ target, packageRoot: PACKAGE_ROOT }),
      [CODE_STYLE],
    )));
    const extra = ".claude/skills/code-style-correction/override.md";
    fs.writeFileSync(path.join(root, ...extra.split("/")), "override\n");
    assert.deepEqual(adapter.detect({ target, packageRoot: PACKAGE_ROOT }).issues, [
      { code: "capability_drift", path: extra },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("neutral Claude tracer from actual tgz", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-neutral-claude-tracer-"));
  const target = path.join(root, "target");
  const unsupportedTarget = path.join(root, "unsupported-target");
  const homeDirectory = path.join(root, "home");
  const cacheRoot = path.join(root, "cache");
  fs.mkdirSync(target);
  fs.mkdirSync(unsupportedTarget);
  fs.mkdirSync(homeDirectory);
  fs.mkdirSync(cacheRoot);
  const receiptBefore = fs.readFileSync(RECEIPT_PATH);
  assert.equal(sha256(receiptBefore), RECEIPT_DIGEST);
  try {
    const tarball = packRepository(root);
    const packedRoot = acquirePackedPackage(root, tarball);
    const install = await runInstalledClaudeCommand(
      packedRoot,
      target,
      homeDirectory,
      "2.1.241",
      ["install", "--host", "claude", "--capability", CODE_STYLE, "--target", target, "--yes", "--json"],
    );
    assert.equal(install.exitCode, 0);
    assert.equal(install.stderr.length, 0);
    assert.equal(install.stdout.length, 1);

    const statePath = path.join(target, ".claude", "kcoderag-nav", "install-state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      readonly capabilities: readonly { readonly id: string }[];
    };
    assert.deepEqual(state.capabilities.map((capability) => capability.id), [CODE_STYLE]);
    const skillPath = path.join(target, ".claude", "skills", "code-style-correction", "SKILL.md");
    const handlerPath = path.join(target, ".claude", "kcoderag-nav", "qa", "hooks", "code-style-nudge.cjs");
    assert.equal(fs.statSync(skillPath).isFile(), true);
    assert.equal(fs.statSync(handlerPath).isFile(), true);

    const handlerBytes = fs.readFileSync(handlerPath);
    fs.appendFileSync(handlerPath, "\n// tracer drift\n", "utf8");
    const drifted = runInstalledClaudeLauncher(target, homeDirectory, cacheRoot, "neutral-tracer-session");
    assert.equal(drifted.status, 0);
    assert.equal(drifted.stdout, "");
    assert.equal(drifted.stderr, "");
    assert.deepEqual(markerInventory(cacheRoot), []);

    fs.writeFileSync(handlerPath, handlerBytes);
    const valid = runInstalledClaudeLauncher(target, homeDirectory, cacheRoot, "neutral-tracer-session");
    assert.equal(valid.status, 0);
    assert.equal(valid.stderr, "");
    const response = JSON.parse(valid.stdout) as {
      readonly hookSpecificOutput?: { readonly additionalContext?: string };
    };
    const advisory = response.hookSpecificOutput?.additionalContext;
    assert.equal(typeof advisory, "string");
    assert.match(advisory ?? "", /\$code-style-correction/u);
    assert.ok((advisory?.length ?? 0) > 0 && (advisory?.length ?? 0) <= 600);
    assert.equal(markerInventory(cacheRoot).filter((name) => name.endsWith(".claim")).length, 1);

    const repeated = runInstalledClaudeLauncher(target, homeDirectory, cacheRoot, "neutral-tracer-session");
    assert.equal(repeated.status, 0);
    assert.equal(repeated.stdout, "");
    assert.equal(repeated.stderr, "");

    const unsupportedBefore = projectSnapshot(unsupportedTarget);
    const unsupported = await runInstalledClaudeCommand(
      packedRoot,
      unsupportedTarget,
      homeDirectory,
      "2.1.242",
      ["install", "--host", "claude", "--capability", CODE_STYLE, "--target", unsupportedTarget, "--yes", "--json"],
    );
    assert.notEqual(unsupported.exitCode, 0);
    assert.deepEqual(projectSnapshot(unsupportedTarget), unsupportedBefore);

    const formerCapability = ["jx", "3-style-nudge"].join("");
    const stateDocument = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, any>;
    stateDocument.capabilities[0].id = formerCapability;
    for (const file of stateDocument.files as Record<string, any>[]) {
      file.contributors = file.contributors.map((contributor: string) =>
        contributor === CODE_STYLE ? formerCapability : contributor);
    }
    for (const section of stateDocument.sections as Record<string, any>[]) {
      section.contributors = section.contributors.map((contributor: string) =>
        contributor === CODE_STYLE ? formerCapability : contributor);
    }
    stateDocument.compositeDigest = sha256(Buffer.from(JSON.stringify({
      schemaVersion: stateDocument.schemaVersion,
      packageVersion: stateDocument.packageVersion,
      host: stateDocument.host,
      capabilities: stateDocument.capabilities,
      files: stateDocument.files,
      sections: stateDocument.sections,
    }), "utf8"));
    fs.writeFileSync(statePath, `${JSON.stringify(stateDocument, null, 2)}\n`, "utf8");
    const formerBefore = projectSnapshot(target);
    const former = await runInstalledClaudeCommand(
      packedRoot,
      target,
      homeDirectory,
      "2.1.241",
      ["update", "--host", "claude", "--capability", CODE_STYLE, "--target", target, "--yes", "--json"],
    );
    assert.notEqual(former.exitCode, 0);
    assert.deepEqual(projectSnapshot(target), formerBefore);
    assert.deepEqual(fs.readFileSync(RECEIPT_PATH), receiptBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
