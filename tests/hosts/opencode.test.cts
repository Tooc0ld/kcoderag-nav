const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type HostId = "codex" | "claude" | "cursor" | "opencode";

const commands = require("../../dist/cli/commands.cjs") as {
  executeCommand(argv: string[], dependencies: Record<string, unknown>): Promise<number>;
};
const opencode = require("../../dist/hosts/opencode.cjs") as {
  createOpenCodeAdapter(options?: { readonly homeDirectory?: string }): Record<string, any>;
};
const jsonSplice = require("../../dist/core/json-splice.cjs") as {
  parseJsoncObject(text: string): Record<string, any>;
};

const STATE_PATH = ".opencode/kcoderag-nav/install-state.json";

function write(root: string, relativePath: string, value: string | Buffer): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, value);
}

function packageFixture(base: string) {
  const root = path.join(base, "package");
  const secret = `opaque-${crypto.randomUUID()}`;
  write(root, "package.json", `${JSON.stringify({ name: "kcoderag-nav", version: "0.2.2" })}\n`);
  write(root, "kcoderag-qa/.mcp.json", `${JSON.stringify({
    mcpServers: {
      "kcoderag-qa": {
        type: "http",
        url: "https://qa.invalid/mcp",
        headers: { Authorization: `Bearer ${secret}` },
      },
    },
  })}\n`);
  write(root, "kcoderag-qa/hooks/mcp-call-marker.cjs", "module.exports={recordKCodeRagCall(){}};\n");
  write(root, "kcoderag-qa/hooks/update-check.cjs", "module.exports={};\n");
  write(root, "kcoderag-qa/hooks/update-notice.cjs", "module.exports={};\n");
  write(root, "kcoderag-qa/hooks/update-worker.cjs", "module.exports={};\n");
  write(root, "kcoderag-qa/opencode/kcoderag-nav.js", "export const KCodeRagNav=async()=>({});\n");
  write(root, "kcoderag-qa/skills/code-lookup-discipline/SKILL.md", "# OpenCode QA lookup\n");
  return { root, secret };
}

function snapshot(root: string): readonly string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        result.push(`d:${relative}`);
        visit(absolute);
      } else {
        result.push(`f:${relative}:${crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")}`);
      }
    }
  };
  visit(root);
  return result;
}

async function run(
  target: string,
  packageRoot: string,
  adapter: Record<string, unknown>,
  command: "install" | "status" | "doctor" | "update" | "uninstall",
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const argv = [command, "--host", "opencode", "--json"];
  if (["install", "update", "uninstall"].includes(command)) argv.push("--yes");
  const exitCode = await commands.executeCommand(argv, {
    cwd: target,
    packageRoot,
    nodeVersion: "22.20.0",
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    getAdapter: (host: HostId) => {
      if (host !== "opencode") throw new Error("unexpected host");
      return adapter;
    },
  });
  return {
    exitCode,
    stdout,
    stderr,
    output: JSON.parse(stdout[0] ?? "{}") as Record<string, any>,
  };
}

test("OpenCode JSONC lifecycle is project-only, lossless, idempotent, and QA-only", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-opencode-life-"));
  try {
    const pkg = packageFixture(base);
    const target = path.join(base, "target");
    const home = path.join(base, "home");
    fs.mkdirSync(target);
    const original = '{\r\n  // preserve comment and unsafe integer\r\n  "huge": 9007199254740993,\r\n  "mcp": { "unrelated": { "type": "local", "command": ["safe"] }, },\r\n}\r\n';
    write(target, "opencode.jsonc", original);
    const adapter = opencode.createOpenCodeAdapter({ homeDirectory: home });

    const installed = await run(target, pkg.root, adapter, "install");
    assert.equal(installed.exitCode, 0);
    assert.doesNotMatch(installed.stdout.join("\n") + installed.stderr.join("\n"), new RegExp(pkg.secret));
    const installedText = fs.readFileSync(path.join(target, "opencode.jsonc"), "utf8");
    assert.match(installedText, /preserve comment/u);
    assert.match(installedText, /9007199254740993/u);
    const document = jsonSplice.parseJsoncObject(installedText);
    assert.deepEqual(Object.keys(document.mcp).sort(), ["kcoderag-qa", "unrelated"]);
    assert.equal(document.mcp["kcoderag-qa"].type, "remote");
    assert.equal(document.mcp["kcoderag-qa"].enabled, true);
    assert.equal(fs.existsSync(path.join(target, ".opencode/plugins/kcoderag-nav.js")), true);
    assert.equal(fs.existsSync(path.join(target, ".opencode/skills/kcoderag-nav/SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(target, ".opencode/kcoderag-nav/hooks/mcp-call-marker.cjs")), true);
    assert.equal(fs.existsSync(path.join(target, ".opencode/kcoderag-nav/hooks/update-notice.cjs")), true);
    const state = JSON.parse(fs.readFileSync(path.join(target, ...STATE_PATH.split("/")), "utf8"));
    assert.equal(state.host, "opencode");
    assert.equal(state.environment, "qa");
    assert.equal(state.managedFiles.includes("opencode.jsonc"), true);
    assert.equal(JSON.stringify(state).includes(pkg.secret), false);

    const installedTree = snapshot(target);
    assert.equal((await run(target, pkg.root, adapter, "status")).output.status, "healthy");
    assert.equal((await run(target, pkg.root, adapter, "doctor")).output.status, "healthy");
    assert.equal((await run(target, pkg.root, adapter, "install")).exitCode, 0);
    assert.deepEqual(snapshot(target), installedTree);

    write(pkg.root, "kcoderag-qa/opencode/kcoderag-nav.js", "export const KCodeRagNav=async()=>({updated:true});\n");
    assert.equal((await run(target, pkg.root, adapter, "status")).output.status, "update_available");
    assert.equal((await run(target, pkg.root, adapter, "update")).exitCode, 0);
    assert.equal((await run(target, pkg.root, adapter, "status")).output.status, "healthy");
    assert.equal((await run(target, pkg.root, adapter, "uninstall")).exitCode, 0);
    assert.equal(fs.readFileSync(path.join(target, "opencode.jsonc"), "utf8"), original);
    assert.equal(fs.existsSync(path.join(target, ".opencode/plugins/kcoderag-nav.js")), false);
    assert.equal(fs.existsSync(path.join(target, ".opencode/kcoderag-nav/hooks/update-notice.cjs")), false);
    assert.equal(fs.existsSync(path.join(target, ...STATE_PATH.split("/"))), false);
    assert.equal((await run(target, pkg.root, adapter, "status")).output.status, "not_installed");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("OpenCode creates opencode.json when absent and removes it on uninstall", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-opencode-new-"));
  try {
    const pkg = packageFixture(base);
    const target = path.join(base, "target");
    fs.mkdirSync(target);
    const adapter = opencode.createOpenCodeAdapter({ homeDirectory: path.join(base, "home") });
    assert.equal((await run(target, pkg.root, adapter, "install")).exitCode, 0);
    assert.equal(fs.existsSync(path.join(target, "opencode.json")), true);
    assert.equal(fs.existsSync(path.join(target, "opencode.jsonc")), false);
    assert.equal((await run(target, pkg.root, adapter, "uninstall")).exitCode, 0);
    assert.equal(fs.existsSync(path.join(target, "opencode.json")), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("OpenCode ignores only empty managed-directory residue after uninstall", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-opencode-residue-"));
  try {
    const pkg = packageFixture(base);
    const target = path.join(base, "target");
    fs.mkdirSync(path.join(target, ".opencode/kcoderag-nav/hooks"), { recursive: true });
    const adapter = opencode.createOpenCodeAdapter({ homeDirectory: path.join(base, "home") });

    assert.equal((await run(target, pkg.root, adapter, "status")).output.status, "not_installed");
    write(target, ".opencode/kcoderag-nav/hooks/unknown.txt", "keep\n");
    const status = await run(target, pkg.root, adapter, "status");
    assert.equal(status.output.status, "invalid");
    assert.equal(status.output.issues[0].code, "orphaned_managed_root");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("OpenCode refuses ambiguous config names and managed drift without writing", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-opencode-refuse-"));
  try {
    const pkg = packageFixture(base);
    const ambiguous = path.join(base, "ambiguous");
    fs.mkdirSync(ambiguous);
    write(ambiguous, "opencode.json", "{}\n");
    write(ambiguous, "opencode.jsonc", "{/* keep */}\n");
    const adapter = opencode.createOpenCodeAdapter({ homeDirectory: path.join(base, "home") });
    const before = snapshot(ambiguous);
    const refused = await run(ambiguous, pkg.root, adapter, "install");
    assert.equal(refused.exitCode, 1);
    assert.equal(refused.output.error.code, "ambiguous_project_config");
    assert.deepEqual(snapshot(ambiguous), before);

    const drifted = path.join(base, "drifted");
    fs.mkdirSync(drifted);
    assert.equal((await run(drifted, pkg.root, adapter, "install")).exitCode, 0);
    const pluginPath = path.join(drifted, ".opencode/plugins/kcoderag-nav.js");
    fs.writeFileSync(pluginPath, "locally edited\n");
    const driftBefore = snapshot(drifted);
    assert.equal((await run(drifted, pkg.root, adapter, "status")).output.status, "drifted");
    assert.equal((await run(drifted, pkg.root, adapter, "update")).output.error.code, "managed_content_changed");
    assert.equal((await run(drifted, pkg.root, adapter, "uninstall")).output.error.code, "managed_content_changed");
    assert.deepEqual(snapshot(drifted), driftBefore);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("OpenCode doctor reports user-scope duplicates without reading credentials into output", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-opencode-source-"));
  try {
    const pkg = packageFixture(base);
    const target = path.join(base, "target");
    const home = path.join(base, "home");
    fs.mkdirSync(target);
    const secret = `Bearer-${crypto.randomUUID()}`;
    write(home, ".config/opencode/opencode.json", `${JSON.stringify({
      mcp: { "kcoderag-qa": { type: "remote", headers: { Authorization: secret } } },
    })}\n`);
    write(home, ".config/opencode/plugins/kcoderag-nav.js", `// ${secret}\n`);
    const adapter = opencode.createOpenCodeAdapter({ homeDirectory: home });
    const result = await run(target, pkg.root, adapter, "doctor");
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.status, "source_conflict");
    assert.equal(Array.isArray(result.output.findings), true);
    assert.equal(result.output.findings.length >= 2, true);
    const encoded = JSON.stringify(result.output);
    assert.match(encoded, /raw_mcp_source|active_plugin_source/u);
    assert.doesNotMatch(encoded, new RegExp(secret));
    assert.deepEqual(snapshot(target), []);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("OpenCode refuses symlinked dedicated paths before any project mutation", async (context) => {
  if (process.platform === "win32") {
    context.skip("Windows symlink creation requires privileges on some runners");
    return;
  }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-opencode-link-"));
  try {
    const pkg = packageFixture(base);
    const target = path.join(base, "target");
    fs.mkdirSync(path.join(target, ".opencode/plugins"), { recursive: true });
    write(base, "outside.js", "outside\n");
    fs.symlinkSync(path.join(base, "outside.js"), path.join(target, ".opencode/plugins/kcoderag-nav.js"));
    const adapter = opencode.createOpenCodeAdapter({ homeDirectory: path.join(base, "home") });
    const before = snapshot(target);
    const result = await run(target, pkg.root, adapter, "install");
    assert.equal(result.output.error.code, "symlink_escape");
    assert.deepEqual(snapshot(target), before);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
