const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type Product = "qa" | "dev" | "cursor";
type ProductSelection = Product | "all";
type AssetGroup =
  | "runtime-cjs"
  | "runtime-launcher"
  | "runtime-registration"
  | "runtime-code"
  | "runtime"
  | "metadata-config"
  | "metadata-guidance"
  | "metadata"
  | "docs"
  | "version"
  | "all";

interface GeneratorOptions {
  readonly package: ProductSelection;
  readonly group: AssetGroup;
  readonly sourceRoot: string;
  readonly outputRoot: string;
  readonly io?: {
    beforeCommit?(relativePath: string, index: number): void;
  };
}

interface GenerationResult {
  readonly ok: boolean;
  readonly package: ProductSelection;
  readonly group: AssetGroup;
  readonly version: string;
  readonly selectedPaths: readonly string[];
  readonly changedPaths: readonly string[];
  readonly writtenPaths: readonly string[];
  readonly diagnostics: readonly string[];
}

interface GeneratorModule {
  readonly ASSET_GROUP_PATHS: Readonly<Record<Product, Readonly<Record<AssetGroup, readonly string[]>>>>;
  generatePackage(options: GeneratorOptions): GenerationResult;
  checkGenerated(options: GeneratorOptions): GenerationResult;
}

const generator = require("../../dist/generator/index.cjs") as GeneratorModule;

const EXPECTED_GROUPS: GeneratorModule["ASSET_GROUP_PATHS"] = {
  qa: {
    "runtime-cjs": ["hooks/grep-nudge.cjs", "hooks/update-check.cjs", "hooks/update-worker.cjs"],
    "runtime-launcher": ["hooks/run_hook.cmd", "hooks/run_hook.sh"],
    "runtime-registration": ["hooks/hooks.json"],
    "runtime-code": [
      "hooks/grep-nudge.cjs",
      "hooks/run_hook.cmd",
      "hooks/run_hook.sh",
      "hooks/update-check.cjs",
      "hooks/update-worker.cjs",
    ],
    runtime: [
      "hooks/grep-nudge.cjs",
      "hooks/hooks.json",
      "hooks/run_hook.cmd",
      "hooks/run_hook.sh",
      "hooks/update-check.cjs",
      "hooks/update-worker.cjs",
    ],
    "metadata-config": [
      ".claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      ".codex.mcp.json",
      ".mcp.json",
    ],
    "metadata-guidance": ["agents/kcode-explorer.md", "skills/code-lookup-discipline/SKILL.md"],
    metadata: [
      ".claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      ".codex.mcp.json",
      ".mcp.json",
      "agents/kcode-explorer.md",
      "skills/code-lookup-discipline/SKILL.md",
    ],
    docs: ["README.md"],
    version: [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"],
    all: [
      ".claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      ".codex.mcp.json",
      ".mcp.json",
      "README.md",
      "agents/kcode-explorer.md",
      "hooks/grep-nudge.cjs",
      "hooks/hooks.json",
      "hooks/run_hook.cmd",
      "hooks/run_hook.sh",
      "hooks/update-check.cjs",
      "hooks/update-worker.cjs",
      "skills/code-lookup-discipline/SKILL.md",
    ],
  },
  dev: {} as GeneratorModule["ASSET_GROUP_PATHS"]["dev"],
  cursor: {
    "runtime-cjs": [],
    "runtime-launcher": [],
    "runtime-registration": [],
    "runtime-code": [],
    runtime: [],
    "metadata-config": [".cursor-plugin/plugin.json", "mcp.json"],
    "metadata-guidance": ["rules/kcoderag-navigation.mdc", "skills/code-lookup-discipline/SKILL.md"],
    metadata: [
      ".cursor-plugin/plugin.json",
      "mcp.json",
      "rules/kcoderag-navigation.mdc",
      "skills/code-lookup-discipline/SKILL.md",
    ],
    docs: ["README.md"],
    version: [".cursor-plugin/plugin.json"],
    all: [
      ".cursor-plugin/plugin.json",
      "README.md",
      "mcp.json",
      "rules/kcoderag-navigation.mdc",
      "skills/code-lookup-discipline/SKILL.md",
    ],
  },
};
const expectedGroups = {
  ...EXPECTED_GROUPS,
  dev: EXPECTED_GROUPS.qa,
} as GeneratorModule["ASSET_GROUP_PATHS"];

interface Fixture {
  readonly root: string;
  readonly sourceRoot: string;
  readonly outputRoot: string;
  readonly secret: string;
}

function write(root: string, relativePath: string, contents: string | Buffer): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function environment(id: "qa" | "dev"): Record<string, string> {
  const title = id === "qa" ? "QA" : "Dev";
  return {
    id,
    plugin_name: `kcoderag-${id}`,
    server_name: `kcoderag-${id}`,
    mcp_source: `plugin-src/environments/${id}.mcp.json`,
    permission_namespace: `mcp__plugin_kcoderag-${id}_kcoderag-${id}__*`,
    agent_tool_prefix: `mcp__plugin_kcoderag-${id}_kcoderag-${id}__`,
    display_name: `KCodeRag ${title}`,
    short_description: `${title} short`,
    long_description: `${title} long`,
    manifest_description: `${title} manifest`,
    claude_description: `${title} claude`,
    marketplace_description: `${title} marketplace`,
    brand_color: id === "qa" ? "#111111" : "#222222",
  };
}

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-generator-"));
  const sourceRoot = path.join(root, "source");
  const outputRoot = path.join(root, "output");
  const secret = "SENSITIVE-FIXTURE-AUTH-MARKER";
  fs.mkdirSync(outputRoot, { recursive: true });
  write(sourceRoot, "package.json", canonicalJson({ name: "kcoderag-nav", version: "0.1.4" }));
  write(
    sourceRoot,
    "plugin-src/environments.json",
    canonicalJson({ environments: [environment("qa"), environment("dev")] }),
  );
  for (const id of ["qa", "dev"] as const) {
    write(
      sourceRoot,
      `plugin-src/environments/${id}.mcp.json`,
      canonicalJson({
        mcpServers: {
          [`kcoderag-${id}`]: {
            type: "http",
            url: `https://${id}.example.invalid/mcp`,
            headers: { Authorization: `Bearer ${secret}-${id}` },
          },
        },
      }),
    );
  }
  write(
    sourceRoot,
    "plugin-src/routing.json",
    canonicalJson({
      version: 2,
      mutually_exclusive: ["qa", "dev"],
      rules: [
        { installed: ["qa"], intent: "default", routes: ["qa"] },
        { installed: ["dev"], intent: "default", routes: ["dev"] },
      ],
    }),
  );
  write(sourceRoot, "plugin-src/hooks/hooks.json", canonicalJson({ hooks: { PreToolUse: [] } }));
  write(sourceRoot, "plugin-src/hooks/run_hook.cmd", "@node grep-nudge.cjs\r\n");
  write(sourceRoot, "plugin-src/hooks/run_hook.sh", "#!/bin/sh\r\nnode grep-nudge.cjs\r\n");
  write(sourceRoot, "dist/hooks/grep-nudge.cjs", "module.exports={name:'grep'};\n");
  write(sourceRoot, "dist/hooks/update-check.cjs", "module.exports={name:'check'};\n");
  write(sourceRoot, "dist/hooks/update-worker.cjs", "module.exports={name:'worker'};\n");
  write(
    sourceRoot,
    "plugin-src/README.md.tmpl",
    "# {{plugin_name}}\r\n{{environment}}/{{environment_upper}}/{{display_name}}\r\n{{routing_policy}}\r\n",
  );
  write(
    sourceRoot,
    "plugin-src/skills/code-lookup-discipline/SKILL.md",
    "# {{display_name}}\r\n{{routing_policy}}\r\n",
  );
  write(
    sourceRoot,
    "plugin-src/agents/kcode-explorer.md.tmpl",
    "# {{display_name}}\r\n{{tool_prefix}}\r\n{{routing_policy}}\r\n",
  );
  write(sourceRoot, "plugin-src/cursor/README.md.tmpl", "# Cursor {{plugin_version}}\r\n");
  write(sourceRoot, "plugin-src/cursor/rules/kcoderag-navigation.mdc", "alwaysApply: true\r\n");
  return { root, sourceRoot, outputRoot, secret };
}

function cleanup(fixture: Fixture): void {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function snapshot(root: string): Readonly<Record<string, { readonly digest: string; readonly mtimeMs: number }>> {
  const result: Record<string, { digest: string; mtimeMs: number }> = {};
  if (!fs.existsSync(root)) return result;
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        result[relative] = { digest: sha256(fs.readFileSync(absolute)), mtimeMs: fs.statSync(absolute).mtimeMs };
      }
    }
  };
  visit(root);
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

test("declares exact leaf and union allow-lists for every product", () => {
  assert.deepEqual(generator.ASSET_GROUP_PATHS, expectedGroups);
});

test("writes only changed selected paths and keeps check mode byte-for-byte read-only", () => {
  const fixture = createFixture();
  try {
    const untouched = "kcoderag-qa/README.md";
    write(fixture.outputRoot, untouched, "keep-me\n");
    const untouchedAbsolute = path.join(fixture.outputRoot, ...untouched.split("/"));
    fs.utimesSync(untouchedAbsolute, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    const untouchedBefore = snapshot(fixture.outputRoot)[untouched];

    const first = generator.generatePackage({
      package: "qa",
      group: "runtime-cjs",
      sourceRoot: fixture.sourceRoot,
      outputRoot: fixture.outputRoot,
    });
    assert.deepEqual(first.writtenPaths, [
      "kcoderag-qa/hooks/grep-nudge.cjs",
      "kcoderag-qa/hooks/update-check.cjs",
      "kcoderag-qa/hooks/update-worker.cjs",
    ]);
    assert.deepEqual(snapshot(fixture.outputRoot)[untouched], untouchedBefore);

    const second = generator.generatePackage({
      package: "qa",
      group: "runtime-cjs",
      sourceRoot: fixture.sourceRoot,
      outputRoot: fixture.outputRoot,
    });
    assert.deepEqual(second.changedPaths, []);
    assert.deepEqual(second.writtenPaths, []);

    write(fixture.outputRoot, "kcoderag-qa/hooks/update-check.cjs", "drift\n");
    const beforeCheck = snapshot(fixture.outputRoot);
    const checked = generator.checkGenerated({
      package: "qa",
      group: "runtime-cjs",
      sourceRoot: fixture.sourceRoot,
      outputRoot: fixture.outputRoot,
    });
    assert.equal(checked.ok, false);
    assert.deepEqual(checked.changedPaths, ["kcoderag-qa/hooks/update-check.cjs"]);
    assert.deepEqual(checked.writtenPaths, []);
    assert.deepEqual(snapshot(fixture.outputRoot), beforeCheck);

    const repaired = generator.generatePackage({
      package: "qa",
      group: "runtime-cjs",
      sourceRoot: fixture.sourceRoot,
      outputRoot: fixture.outputRoot,
    });
    assert.deepEqual(repaired.writtenPaths, ["kcoderag-qa/hooks/update-check.cjs"]);
  } finally {
    cleanup(fixture);
  }
});

test("renders all products deterministically from package.json without logging opaque values", () => {
  const fixture = createFixture();
  try {
    const first = generator.generatePackage({
      package: "all",
      group: "all",
      sourceRoot: fixture.sourceRoot,
      outputRoot: fixture.outputRoot,
    });
    assert.equal(first.ok, true);
    assert.equal(first.writtenPaths.length, 31);
    assert.equal(JSON.stringify(first).includes(fixture.secret), false);
    const firstTree = snapshot(fixture.outputRoot);
    const second = generator.generatePackage({
      package: "all",
      group: "all",
      sourceRoot: fixture.sourceRoot,
      outputRoot: fixture.outputRoot,
    });
    assert.deepEqual(second.writtenPaths, []);
    assert.deepEqual(snapshot(fixture.outputRoot), firstTree);

    for (const manifest of [
      "kcoderag-qa/.codex-plugin/plugin.json",
      "kcoderag-qa/.claude-plugin/plugin.json",
      "kcoderag-dev/.codex-plugin/plugin.json",
      "kcoderag-dev/.claude-plugin/plugin.json",
      "kcoderag-cursor/.cursor-plugin/plugin.json",
    ]) {
      const document = JSON.parse(fs.readFileSync(path.join(fixture.outputRoot, ...manifest.split("/")), "utf8")) as {
        version?: string;
      };
      assert.equal(document.version, "0.1.4", manifest);
    }
    assert.equal(
      sha256(fs.readFileSync(path.join(fixture.outputRoot, "kcoderag-qa", ".mcp.json"))),
      sha256(fs.readFileSync(path.join(fixture.sourceRoot, "plugin-src", "environments", "qa.mcp.json"))),
    );
    assert.equal(fs.existsSync(path.join(fixture.outputRoot, "kcoderag-update.json")), false);
    assert.equal(Object.keys(firstTree).some((relativePath) => /(?:^|\/)hooks\/.*\.py$/u.test(relativePath)), false);
  } finally {
    cleanup(fixture);
  }
});

test("rejects template tokens and source path escapes before any output mutation", () => {
  const fixture = createFixture();
  try {
    write(fixture.outputRoot, "unrelated/keep.txt", "keep\n");
    const before = snapshot(fixture.outputRoot);
    write(fixture.sourceRoot, "plugin-src/README.md.tmpl", "{{unknown_value}}\n");
    assert.throws(
      () => generator.generatePackage({
        package: "qa",
        group: "docs",
        sourceRoot: fixture.sourceRoot,
        outputRoot: fixture.outputRoot,
      }),
      /unknown_template_token/u,
    );
    assert.deepEqual(snapshot(fixture.outputRoot), before);

    const metadataPath = path.join(fixture.sourceRoot, "plugin-src", "environments.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as { environments: Record<string, string>[] };
    metadata.environments[0]!.mcp_source = "../outside.mcp.json";
    fs.writeFileSync(metadataPath, canonicalJson(metadata));
    assert.throws(
      () => generator.generatePackage({
        package: "qa",
        group: "metadata-config",
        sourceRoot: fixture.sourceRoot,
        outputRoot: fixture.outputRoot,
      }),
      /path_escape/u,
    );
    assert.deepEqual(snapshot(fixture.outputRoot), before);
  } finally {
    cleanup(fixture);
  }
});

test("rolls back every changed path when an atomic commit fails", () => {
  const fixture = createFixture();
  try {
    for (const relativePath of EXPECTED_GROUPS.qa["runtime-cjs"]) {
      write(fixture.outputRoot, `kcoderag-qa/${relativePath}`, `old:${relativePath}\n`);
    }
    const before = snapshot(fixture.outputRoot);
    assert.throws(
      () => generator.generatePackage({
        package: "qa",
        group: "runtime-cjs",
        sourceRoot: fixture.sourceRoot,
        outputRoot: fixture.outputRoot,
        io: {
          beforeCommit(_relativePath, index) {
            if (index === 1) throw new Error("injected commit failure");
          },
        },
      }),
      /transaction_failed/u,
    );
    assert.deepEqual(snapshot(fixture.outputRoot), before);
  } finally {
    cleanup(fixture);
  }
});
