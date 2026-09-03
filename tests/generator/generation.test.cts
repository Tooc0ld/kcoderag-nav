const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type Product = "qa" | "cursor";
type ProductSelection = Product | "all";
type CapabilityId = "kcoderag-navigation" | "code-style-nudge";
type AssetGroup =
  | "runtime-cjs"
  | "runtime-launcher"
  | "runtime-registration"
  | "runtime-code"
  | "runtime"
  | "registration"
  | "metadata-config"
  | "metadata-guidance"
  | "metadata"
  | "guidance"
  | "docs"
  | "version"
  | "all";

interface GeneratorOptions {
  readonly package: ProductSelection;
  readonly group: AssetGroup;
  readonly capabilities?: readonly CapabilityId[];
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
  readonly capabilities: readonly CapabilityId[];
  readonly selectedPaths: readonly string[];
  readonly changedPaths: readonly string[];
  readonly writtenPaths: readonly string[];
  readonly diagnostics: readonly string[];
}

interface GeneratorModule {
  readonly ASSET_GROUP_PATHS: Readonly<Record<Product, Readonly<Record<AssetGroup, readonly string[]>>>>;
  readonly CAPABILITY_PROJECTION_PATHS: Readonly<
    Record<CapabilityId, Readonly<Record<Product, Readonly<Record<"runtime" | "registration" | "metadata" | "guidance" | "docs" | "all", readonly string[]>>>>>
  >;
  generatePackage(options: GeneratorOptions): GenerationResult;
  checkGenerated(options: GeneratorOptions): GenerationResult;
}

const generator = require("../../dist/generator/index.cjs") as GeneratorModule;

const expectedGroups: GeneratorModule["ASSET_GROUP_PATHS"] = {
  qa: {
    "runtime-cjs": [
      "hooks/code-style-nudge.cjs",
      "hooks/feedback-nudge.cjs",
      "hooks/grep-nudge.cjs",
      "hooks/mcp-call-marker.cjs",
      "hooks/once-marker.cjs",
      "hooks/pre-tool-dispatcher.cjs",
      "hooks/session-cleanup.cjs",
      "hooks/update-check.cjs",
      "hooks/update-notice.cjs",
      "hooks/update-worker.cjs",
    ],
    "runtime-launcher": ["hooks/run_hook.cmd", "hooks/run_hook.sh", "hooks/run_marker.cmd", "hooks/run_marker.sh"],
    "runtime-registration": ["hooks/hooks.json", "opencode/kcoderag-nav.js"],
    "runtime-code": [
      "hooks/code-style-nudge.cjs",
      "hooks/feedback-nudge.cjs",
      "hooks/grep-nudge.cjs",
      "hooks/mcp-call-marker.cjs",
      "hooks/once-marker.cjs",
      "hooks/pre-tool-dispatcher.cjs",
      "hooks/run_hook.cmd",
      "hooks/run_hook.sh",
      "hooks/run_marker.cmd",
      "hooks/run_marker.sh",
      "hooks/session-cleanup.cjs",
      "hooks/update-check.cjs",
      "hooks/update-notice.cjs",
      "hooks/update-worker.cjs",
    ],
    runtime: [
      "hooks/code-style-nudge.cjs",
      "hooks/feedback-nudge.cjs",
      "hooks/grep-nudge.cjs",
      "hooks/mcp-call-marker.cjs",
      "hooks/once-marker.cjs",
      "hooks/pre-tool-dispatcher.cjs",
      "hooks/session-cleanup.cjs",
      "hooks/update-check.cjs",
      "hooks/update-notice.cjs",
      "hooks/update-worker.cjs",
    ],
    registration: [
      "hooks/hooks.json",
      "hooks/run_hook.cmd",
      "hooks/run_hook.sh",
      "hooks/run_marker.cmd",
      "hooks/run_marker.sh",
      "opencode/kcoderag-nav.js",
    ],
    "metadata-config": [
      ".claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      ".codex.mcp.json",
      ".mcp.json",
    ],
    "metadata-guidance": [
      "agents/kcode-explorer.md",
      "skills/kcoderag-code-style/SKILL.md",
      "skills/kcoderag-code-style/agents/openai.yaml",
      "skills/kcoderag-code-style/references/change-hygiene-self-review.md",
      "skills/kcoderag-code-style/references/cpp-lifetime-control-flow.md",
      "skills/kcoderag-code-style/references/lua-contracts.md",
      "skills/kcoderag-code-style/references/protocol-serialization-data.md",
      "skills/kcoderag-feedback/SKILL.md",
      "skills/kcoderag-feedback/agents/openai.yaml",
      "skills/kcoderag-manage/SKILL.md",
      "skills/kcoderag-manage/agents/openai.yaml",
      "skills/kcoderag-update/SKILL.md",
      "skills/kcoderag-update/agents/openai.yaml",
      "skills/kcoderag/SKILL.md",
      "skills/kcoderag/agents/openai.yaml",
    ],
    metadata: [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", ".codex.mcp.json", ".mcp.json"],
    guidance: [
      "agents/kcode-explorer.md",
      "skills/kcoderag-code-style/SKILL.md",
      "skills/kcoderag-code-style/agents/openai.yaml",
      "skills/kcoderag-code-style/references/change-hygiene-self-review.md",
      "skills/kcoderag-code-style/references/cpp-lifetime-control-flow.md",
      "skills/kcoderag-code-style/references/lua-contracts.md",
      "skills/kcoderag-code-style/references/protocol-serialization-data.md",
      "skills/kcoderag-feedback/SKILL.md",
      "skills/kcoderag-feedback/agents/openai.yaml",
      "skills/kcoderag-manage/SKILL.md",
      "skills/kcoderag-manage/agents/openai.yaml",
      "skills/kcoderag-update/SKILL.md",
      "skills/kcoderag-update/agents/openai.yaml",
      "skills/kcoderag/SKILL.md",
      "skills/kcoderag/agents/openai.yaml",
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
      "hooks/code-style-nudge.cjs",
      "hooks/feedback-nudge.cjs",
      "hooks/grep-nudge.cjs",
      "hooks/hooks.json",
      "hooks/mcp-call-marker.cjs",
      "hooks/once-marker.cjs",
      "hooks/pre-tool-dispatcher.cjs",
      "hooks/run_hook.cmd",
      "hooks/run_hook.sh",
      "hooks/run_marker.cmd",
      "hooks/run_marker.sh",
      "hooks/session-cleanup.cjs",
      "hooks/update-check.cjs",
      "hooks/update-notice.cjs",
      "hooks/update-worker.cjs",
      "opencode/kcoderag-nav.js",
      "skills/kcoderag-code-style/SKILL.md",
      "skills/kcoderag-code-style/agents/openai.yaml",
      "skills/kcoderag-code-style/references/change-hygiene-self-review.md",
      "skills/kcoderag-code-style/references/cpp-lifetime-control-flow.md",
      "skills/kcoderag-code-style/references/lua-contracts.md",
      "skills/kcoderag-code-style/references/protocol-serialization-data.md",
      "skills/kcoderag-feedback/SKILL.md",
      "skills/kcoderag-feedback/agents/openai.yaml",
      "skills/kcoderag-manage/SKILL.md",
      "skills/kcoderag-manage/agents/openai.yaml",
      "skills/kcoderag-update/SKILL.md",
      "skills/kcoderag-update/agents/openai.yaml",
      "skills/kcoderag/SKILL.md",
      "skills/kcoderag/agents/openai.yaml",
    ],
  },
  cursor: {
    "runtime-cjs": [],
    "runtime-launcher": [],
    "runtime-registration": [],
    "runtime-code": [],
    runtime: [],
    registration: [],
    "metadata-config": [".cursor-plugin/plugin.json", "mcp.json"],
    "metadata-guidance": [
      "rules/kcoderag-navigation.mdc",
      "skills/kcoderag-code-style/SKILL.md",
      "skills/kcoderag-code-style/references/change-hygiene-self-review.md",
      "skills/kcoderag-code-style/references/cpp-lifetime-control-flow.md",
      "skills/kcoderag-code-style/references/lua-contracts.md",
      "skills/kcoderag-code-style/references/protocol-serialization-data.md",
      "skills/kcoderag-feedback/SKILL.md",
      "skills/kcoderag-manage/SKILL.md",
      "skills/kcoderag-update/SKILL.md",
      "skills/kcoderag/SKILL.md",
    ],
    metadata: [".cursor-plugin/plugin.json", "mcp.json"],
    guidance: [
      "rules/kcoderag-navigation.mdc",
      "skills/kcoderag-code-style/SKILL.md",
      "skills/kcoderag-code-style/references/change-hygiene-self-review.md",
      "skills/kcoderag-code-style/references/cpp-lifetime-control-flow.md",
      "skills/kcoderag-code-style/references/lua-contracts.md",
      "skills/kcoderag-code-style/references/protocol-serialization-data.md",
      "skills/kcoderag-feedback/SKILL.md",
      "skills/kcoderag-manage/SKILL.md",
      "skills/kcoderag-update/SKILL.md",
      "skills/kcoderag/SKILL.md",
    ],
    docs: ["README.md"],
    version: [".cursor-plugin/plugin.json"],
    all: [
      ".cursor-plugin/plugin.json",
      "README.md",
      "mcp.json",
      "rules/kcoderag-navigation.mdc",
      "skills/kcoderag-code-style/SKILL.md",
      "skills/kcoderag-code-style/references/change-hygiene-self-review.md",
      "skills/kcoderag-code-style/references/cpp-lifetime-control-flow.md",
      "skills/kcoderag-code-style/references/lua-contracts.md",
      "skills/kcoderag-code-style/references/protocol-serialization-data.md",
      "skills/kcoderag-feedback/SKILL.md",
      "skills/kcoderag-manage/SKILL.md",
      "skills/kcoderag-update/SKILL.md",
      "skills/kcoderag/SKILL.md",
    ],
  },
};

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

function qaEnvironment(): Record<string, string> {
  return {
    id: "qa",
    plugin_name: "kcoderag-qa",
    server_name: "kcoderag-qa",
    mcp_source: "plugin-src/environments/qa.mcp.json",
    permission_namespace: "mcp__plugin_kcoderag-qa_kcoderag-qa__*",
    agent_tool_prefix: "mcp__plugin_kcoderag-qa_kcoderag-qa__",
    display_name: "KCodeRag QA",
    short_description: "QA short",
    long_description: "QA long",
    manifest_description: "QA manifest",
    claude_description: "QA claude",
    marketplace_description: "QA marketplace",
    brand_color: "#111111",
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
    canonicalJson({ environments: [qaEnvironment()] }),
  );
  write(
    sourceRoot,
    "plugin-src/environments/qa.mcp.json",
    canonicalJson({
      mcpServers: {
        "kcoderag-qa": {
          type: "http",
          url: "https://qa.example.invalid/mcp",
          headers: { Authorization: `Bearer ${secret}-qa` },
        },
      },
    }),
  );
  write(
    sourceRoot,
    "plugin-src/routing.json",
    canonicalJson({
      version: 3,
      environment: "qa",
      rule: { intent: "default", routes: ["qa"] },
    }),
  );
  write(sourceRoot, "plugin-src/hooks/hooks.json", canonicalJson({ hooks: { PreToolUse: [], PostToolUse: [] } }));
  write(sourceRoot, "plugin-src/hooks/run_hook.cmd", "@node grep-nudge.cjs\r\n");
  write(sourceRoot, "plugin-src/hooks/run_hook.sh", "#!/bin/sh\r\nnode grep-nudge.cjs\r\n");
  write(sourceRoot, "plugin-src/hooks/run_marker.cmd", "@node mcp-call-marker.cjs claude\r\n");
  write(sourceRoot, "plugin-src/hooks/run_marker.sh", "#!/bin/sh\r\nnode mcp-call-marker.cjs claude\r\n");
  write(sourceRoot, "dist/hooks/grep-nudge.cjs", "module.exports={name:'grep'};\n");
  write(sourceRoot, "dist/hooks/pre-tool-dispatcher.cjs", "module.exports={name:'dispatcher'};\n");
  write(sourceRoot, "dist/hooks/code-style-nudge.cjs", "module.exports={name:'style'};\n");
  write(sourceRoot, "dist/hooks/feedback-nudge.cjs", "module.exports={name:'feedback'};\n");
  write(sourceRoot, "dist/hooks/once-marker.cjs", "module.exports={name:'once'};\n");
  write(sourceRoot, "dist/hooks/session-cleanup.cjs", "module.exports={name:'cleanup'};\n");
  write(sourceRoot, "dist/hooks/mcp-call-marker.cjs", "module.exports={name:'marker'};\n");
  write(sourceRoot, "dist/hooks/update-check.cjs", "module.exports={name:'check'};\n");
  write(sourceRoot, "dist/hooks/update-notice.cjs", "module.exports={name:'notice'};\n");
  write(sourceRoot, "dist/hooks/update-worker.cjs", "module.exports={name:'worker'};\n");
  write(sourceRoot, "plugin-src/opencode/kcoderag-nav.js", "export const KCodeRagNav=async()=>({});\n");
  write(
    sourceRoot,
    "plugin-src/README.md.tmpl",
    "# {{plugin_name}}\r\n{{environment}}/{{environment_upper}}/{{display_name}}\r\n{{routing_policy}}\r\n",
  );
  write(
    sourceRoot,
    "plugin-src/skills/kcoderag/SKILL.md",
    "# KCodeRag QA\r\nUse the installed QA graph.\r\n",
  );
  write(sourceRoot, "plugin-src/skills/kcoderag/agents/openai.yaml", "interface:\n  display_name: \"KCodeRag\"\n");
  write(sourceRoot, "plugin-src/skills/kcoderag-manage/SKILL.md", "# KCodeRag Manage\n");
  write(sourceRoot, "plugin-src/skills/kcoderag-manage/agents/openai.yaml", "interface:\n  display_name: \"KCodeRag Manage\"\n");
  write(sourceRoot, "plugin-src/skills/kcoderag-update/SKILL.md", "<objective>Update KCodeRag Nav.</objective>\n");
  write(sourceRoot, "plugin-src/skills/kcoderag-update/agents/openai.yaml", "interface:\n  display_name: \"KCodeRag Update\"\n");
  write(sourceRoot, "plugin-src/skills/kcoderag-feedback/SKILL.md", "# KCodeRag Feedback\n");
  write(sourceRoot, "plugin-src/skills/kcoderag-feedback/agents/openai.yaml", "interface:\n  display_name: \"KCodeRag Feedback\"\n");
  write(
    sourceRoot,
    "plugin-src/agents/kcode-explorer.md.tmpl",
    "# {{display_name}}\r\n{{tool_prefix}}\r\n{{routing_policy}}\r\n",
  );
  write(sourceRoot, "plugin-src/cursor/README.md.tmpl", "# Cursor {{plugin_version}}\r\n");
  write(sourceRoot, "plugin-src/cursor/rules/kcoderag-navigation.mdc", "alwaysApply: true\r\n");
  write(sourceRoot, "plugin-src/capabilities/code-style-nudge/skill/SKILL.md", "# Canonical code style Skill\n");
  write(sourceRoot, "plugin-src/capabilities/code-style-nudge/skill/agents/openai.yaml", "interface:\n  display_name: \"KCodeRag Code Style\"\n");
  for (const reference of [
    "cpp-lifetime-control-flow.md",
    "protocol-serialization-data.md",
    "lua-contracts.md",
    "change-hygiene-self-review.md",
  ]) {
    write(
      sourceRoot,
      `plugin-src/capabilities/code-style-nudge/skill/references/${reference}`,
      `# ${reference}\n`,
    );
  }
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
        result[relative] = {
          digest: sha256(fs.readFileSync(absolute)),
          mtimeMs: Math.trunc(fs.statSync(absolute).mtimeMs),
        };
      }
    }
  };
  visit(root);
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

test("declares exact leaf and union allow-lists for every product", () => {
  assert.deepEqual(generator.ASSET_GROUP_PATHS, expectedGroups);
});

test("renders isolated capability projections from explicit canonical groups", () => {
  const fixture = createFixture();
  try {
    assert.deepEqual(Object.keys(generator.CAPABILITY_PROJECTION_PATHS), [
      "kcoderag-navigation",
      "code-style-nudge",
    ]);
    assert.deepEqual(
      Object.keys(generator.CAPABILITY_PROJECTION_PATHS["code-style-nudge"].qa),
      ["runtime", "registration", "metadata", "guidance", "docs", "all"],
    );

    const qa = generator.generatePackage({
      package: "qa",
      group: "all",
      capabilities: ["code-style-nudge"],
      sourceRoot: fixture.sourceRoot,
      outputRoot: fixture.outputRoot,
    });
    assert.deepEqual(qa.capabilities, ["code-style-nudge"]);
    assert.deepEqual(qa.writtenPaths, [
      "kcoderag-qa/hooks/code-style-nudge.cjs",
      "kcoderag-qa/hooks/hooks.json",
      "kcoderag-qa/hooks/once-marker.cjs",
      "kcoderag-qa/hooks/pre-tool-dispatcher.cjs",
      "kcoderag-qa/hooks/run_hook.cmd",
      "kcoderag-qa/hooks/run_hook.sh",
      "kcoderag-qa/hooks/session-cleanup.cjs",
      "kcoderag-qa/skills/kcoderag-code-style/SKILL.md",
      "kcoderag-qa/skills/kcoderag-code-style/agents/openai.yaml",
      "kcoderag-qa/skills/kcoderag-code-style/references/change-hygiene-self-review.md",
      "kcoderag-qa/skills/kcoderag-code-style/references/cpp-lifetime-control-flow.md",
      "kcoderag-qa/skills/kcoderag-code-style/references/lua-contracts.md",
      "kcoderag-qa/skills/kcoderag-code-style/references/protocol-serialization-data.md",
    ]);

    const cursor = generator.generatePackage({
      package: "cursor",
      group: "guidance",
      capabilities: ["code-style-nudge"],
      sourceRoot: fixture.sourceRoot,
      outputRoot: fixture.outputRoot,
    });
    assert.deepEqual(cursor.capabilities, ["code-style-nudge"]);
    assert.deepEqual(cursor.writtenPaths, [
      "kcoderag-cursor/skills/kcoderag-code-style/SKILL.md",
      "kcoderag-cursor/skills/kcoderag-code-style/references/change-hygiene-self-review.md",
      "kcoderag-cursor/skills/kcoderag-code-style/references/cpp-lifetime-control-flow.md",
      "kcoderag-cursor/skills/kcoderag-code-style/references/lua-contracts.md",
      "kcoderag-cursor/skills/kcoderag-code-style/references/protocol-serialization-data.md",
    ]);

    const canonicalSkillFiles = [
      "SKILL.md",
      "references/change-hygiene-self-review.md",
      "references/cpp-lifetime-control-flow.md",
      "references/lua-contracts.md",
      "references/protocol-serialization-data.md",
    ] as const;
    for (const product of ["kcoderag-qa", "kcoderag-cursor"] as const) {
      for (const relativePath of canonicalSkillFiles) {
        assert.equal(
          fs.readFileSync(path.join(fixture.outputRoot, product, "skills", "kcoderag-code-style", ...relativePath.split("/"))).equals(
            fs.readFileSync(path.join(fixture.sourceRoot, "plugin-src", "capabilities", "code-style-nudge", "skill", ...relativePath.split("/"))),
          ),
          true,
          `${product}:${relativePath}`,
        );
      }
    }

    const beforeUnsupported = snapshot(fixture.outputRoot);
    assert.throws(
      () => generator.generatePackage({
        package: "cursor",
        group: "runtime",
        capabilities: ["code-style-nudge"],
        sourceRoot: fixture.sourceRoot,
        outputRoot: fixture.outputRoot,
      }),
      /incompatible_group/u,
    );
    assert.deepEqual(snapshot(fixture.outputRoot), beforeUnsupported);
  } finally {
    cleanup(fixture);
  }
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
    assert.deepEqual(
      first.writtenPaths,
      expectedGroups.qa["runtime-cjs"].map((relativePath) => `kcoderag-qa/${relativePath}`),
    );
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

test("renders QA and Cursor deterministically from package.json without logging opaque values", () => {
  const fixture = createFixture();
  try {
    const first = generator.generatePackage({
      package: "all",
      group: "all",
      sourceRoot: fixture.sourceRoot,
      outputRoot: fixture.outputRoot,
    });
    assert.equal(first.ok, true);
    assert.equal(first.writtenPaths.length, 49);
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
    for (const relativePath of expectedGroups.qa["runtime-cjs"]) {
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

function expectedSelected(product: ProductSelection, group: AssetGroup): readonly string[] {
  const products = product === "all"
    ? (["qa", "cursor"] as const).filter((candidate) => expectedGroups[candidate][group].length > 0)
    : [product];
  return products.flatMap((candidate) =>
    expectedGroups[candidate][group].map((asset) => `kcoderag-${candidate}/${asset}`)
  ).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

test("every legal product and group reports the exact changed subset", () => {
  const packages: readonly ProductSelection[] = ["qa", "cursor", "all"];
  const groups = Object.keys(expectedGroups.qa) as AssetGroup[];
  for (const selectedPackage of packages) {
    for (const group of groups) {
      if (selectedPackage === "cursor" && expectedGroups.cursor[group].length === 0) continue;
      const fixture = createFixture();
      try {
        const expected = expectedSelected(selectedPackage, group);
        const first = generator.generatePackage({
          package: selectedPackage,
          group,
          sourceRoot: fixture.sourceRoot,
          outputRoot: fixture.outputRoot,
        });
        assert.deepEqual(first.selectedPaths, expected, `${selectedPackage}:${group}:selected`);
        assert.deepEqual(first.changedPaths, expected, `${selectedPackage}:${group}:changed`);
        assert.deepEqual(first.writtenPaths, expected, `${selectedPackage}:${group}:written`);

        const drifted = expected[0]!;
        write(fixture.outputRoot, drifted, "one changed byte set\n");
        const repaired = generator.generatePackage({
          package: selectedPackage,
          group,
          sourceRoot: fixture.sourceRoot,
          outputRoot: fixture.outputRoot,
        });
        assert.deepEqual(repaired.changedPaths, [drifted], `${selectedPackage}:${group}:partial changed`);
        assert.deepEqual(repaired.writtenPaths, [drifted], `${selectedPackage}:${group}:partial written`);

        const noOp = generator.generatePackage({
          package: selectedPackage,
          group,
          sourceRoot: fixture.sourceRoot,
          outputRoot: fixture.outputRoot,
        });
        assert.deepEqual(noOp.writtenPaths, [], `${selectedPackage}:${group}:no-op`);
      } finally {
        cleanup(fixture);
      }
    }
  }
});

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runGeneratorCli(fixture: Fixture, args: readonly string[]): CliResult {
  const executable = path.resolve(__dirname, "..", "..", "dist", "generator", "index.cjs");
  const result = childProcess.spawnSync(
    process.execPath,
    [executable, ...args, "--source-root", fixture.sourceRoot, "--output-root", fixture.outputRoot],
    { encoding: "utf8", cwd: fixture.root },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("CLI writes and checks one requested product without touching repository packages", () => {
  const fixture = createFixture();
  const repositoryRoot = path.resolve(__dirname, "..", "..");
  const repositoryBefore = Object.fromEntries(
    ["kcoderag-qa", "kcoderag-dev", "kcoderag-cursor"].map((directory) => [
      directory,
      snapshot(path.join(repositoryRoot, directory)),
    ]),
  );
  try {
    const generated = runGeneratorCli(fixture, ["--package", "cursor", "--group", "docs"]);
    assert.equal(generated.status, 0, generated.stderr);
    const generatedResult = JSON.parse(generated.stdout) as GenerationResult;
    assert.deepEqual(generatedResult.writtenPaths, ["kcoderag-cursor/README.md"]);
    assert.equal(`${generated.stdout}${generated.stderr}`.includes(fixture.secret), false);

    const cleanCheck = runGeneratorCli(fixture, ["--package", "cursor", "--group", "docs", "--check"]);
    assert.equal(cleanCheck.status, 0, cleanCheck.stderr);
    assert.deepEqual((JSON.parse(cleanCheck.stdout) as GenerationResult).writtenPaths, []);

    write(fixture.outputRoot, "kcoderag-cursor/README.md", "drift\n");
    const driftCheck = runGeneratorCli(fixture, ["--package", "cursor", "--group", "docs", "--check"]);
    assert.equal(driftCheck.status, 1, driftCheck.stderr);
    const driftResult = JSON.parse(driftCheck.stdout) as GenerationResult;
    assert.equal(driftResult.ok, false);
    assert.deepEqual(driftResult.changedPaths, ["kcoderag-cursor/README.md"]);
    assert.deepEqual(driftResult.writtenPaths, []);
    assert.equal(`${driftCheck.stdout}${driftCheck.stderr}`.includes(fixture.secret), false);

    assert.deepEqual(
      Object.fromEntries(
        ["kcoderag-qa", "kcoderag-dev", "kcoderag-cursor"].map((directory) => [
          directory,
          snapshot(path.join(repositoryRoot, directory)),
        ]),
      ),
      repositoryBefore,
    );
  } finally {
    cleanup(fixture);
  }
});

test("CLI rejects contradictory MCP header aliases without exposing either value", () => {
  const fixture = createFixture();
  try {
    write(fixture.outputRoot, "unrelated/keep.txt", "keep\n");
    const before = snapshot(fixture.outputRoot);
    const mcpPath = path.join(fixture.sourceRoot, "plugin-src", "environments", "qa.mcp.json");
    const document = JSON.parse(fs.readFileSync(mcpPath, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    const entry = document.mcpServers["kcoderag-qa"]!;
    const alternateSecret = "SENSITIVE-FIXTURE-HTTP-ALIAS-MARKER";
    assert.equal(new URL(entry.url as string).pathname, "/mcp");
    assert.equal((entry.url as string).endsWith("/mcp/"), false);
    entry.http_headers = { Authorization: `Bearer ${alternateSecret}` };
    fs.writeFileSync(mcpPath, canonicalJson(document));

    const rejected = runGeneratorCli(fixture, ["--package", "all", "--group", "metadata-config"]);

    assert.equal(rejected.status, 2);
    assert.equal(rejected.stdout, "");
    assert.deepEqual(JSON.parse(rejected.stderr), {
      ok: false,
      code: "environment_mismatch",
      path: "plugin-src/environments/qa.mcp.json",
    });
    assert.equal(`${rejected.stdout}${rejected.stderr}`.includes(fixture.secret), false);
    assert.equal(`${rejected.stdout}${rejected.stderr}`.includes(alternateSecret), false);
    assert.deepEqual(snapshot(fixture.outputRoot), before);
  } finally {
    cleanup(fixture);
  }
});

test("CLI product scope materializes QA atomically and is a byte-stable no-op on repeat", () => {
  const fixture = createFixture();
  try {
    const argumentsForQa = ["--package", "all", "--group", "all", "--product", "qa"] as const;
    const first = runGeneratorCli(fixture, argumentsForQa);
    assert.equal(first.status, 0, first.stderr);
    const firstResult = JSON.parse(first.stdout) as GenerationResult;
    assert.equal(firstResult.writtenPaths.length > 0, true);
    assert.equal(firstResult.writtenPaths.every((relativePath) => relativePath.startsWith("kcoderag-qa/")), true);
    assert.equal(fs.existsSync(path.join(fixture.outputRoot, "kcoderag-cursor")), false);

    const beforeRepeat = snapshot(fixture.outputRoot);
    const repeated = runGeneratorCli(fixture, argumentsForQa);
    assert.equal(repeated.status, 0, repeated.stderr);
    const repeatedResult = JSON.parse(repeated.stdout) as GenerationResult;
    assert.deepEqual(repeatedResult.changedPaths, []);
    assert.deepEqual(repeatedResult.writtenPaths, []);
    assert.deepEqual(snapshot(fixture.outputRoot), beforeRepeat);

    const checked = runGeneratorCli(fixture, [...argumentsForQa, "--check"]);
    assert.equal(checked.status, 0, checked.stderr);
    const checkedResult = JSON.parse(checked.stdout) as GenerationResult;
    assert.deepEqual(checkedResult.changedPaths, []);
    assert.deepEqual(checkedResult.writtenPaths, []);
    assert.deepEqual(snapshot(fixture.outputRoot), beforeRepeat);
  } finally {
    cleanup(fixture);
  }
});

test("CLI rejects unknown, empty, and incompatible selections without writes", () => {
  const fixture = createFixture();
  try {
    write(fixture.outputRoot, "unrelated/keep.txt", "keep\n");
    const before = snapshot(fixture.outputRoot);
    const retired = runGeneratorCli(fixture, ["--package", "dev", "--group", "docs"]);
    assert.equal(retired.status, 2);
    assert.deepEqual(JSON.parse(retired.stderr), {
      ok: false,
      code: "retired_product",
      path: "kcoderag-dev",
    });
    assert.equal(retired.stdout, "");
    assert.equal(retired.stderr.includes(fixture.secret), false);
    assert.deepEqual(snapshot(fixture.outputRoot), before);

    const invalidArguments = [
      ["--package", "all", "--group", "all", "--product", "unknown"],
      ["--package", "all", "--group", "all", "--product"],
      ["--package", "all", "--group", "all", "--product", "qa", "--product", "cursor"],
      ["--package", "cursor", "--group", "all", "--product", "qa"],
      ["--package", "unknown", "--group", "docs"],
      ["--package", "qa", "--group", "unknown"],
      ["--package", "qa", "--group", ""],
      ["--package", "cursor", "--group", "runtime-cjs"],
      ["--package", "qa", "--group", "guidance", "--capability", "unknown"],
      ["--package", "qa"],
      ["--group", "docs"],
    ];
    for (const args of invalidArguments) {
      const rejected = runGeneratorCli(fixture, args);
      assert.equal(rejected.status, 2, args.join(" "));
      assert.equal(`${rejected.stdout}${rejected.stderr}`.includes(fixture.secret), false);
      assert.deepEqual(snapshot(fixture.outputRoot), before, args.join(" "));
    }
  } finally {
    cleanup(fixture);
  }
});

test("CLI canonicalizes repeatable capability selection", () => {
  const fixture = createFixture();
  try {
    const selected = runGeneratorCli(fixture, [
      "--package", "qa",
      "--group", "guidance",
      "--capability", "code-style-nudge",
      "--capability", "code-style-nudge",
    ]);
    assert.equal(selected.status, 0, selected.stderr);
    const result = JSON.parse(selected.stdout) as GenerationResult;
    assert.deepEqual(result.capabilities, ["code-style-nudge"]);
    assert.equal(result.writtenPaths.length, 6);
  } finally {
    cleanup(fixture);
  }
});

test("all-product rendering validates every public product before committing any result", () => {
  const fixture = createFixture();
  try {
    write(fixture.outputRoot, "unrelated/keep.txt", "keep\n");
    const before = snapshot(fixture.outputRoot);
    fs.rmSync(path.join(fixture.sourceRoot, "plugin-src", "environments", "qa.mcp.json"));
    assert.throws(
      () => generator.generatePackage({
        package: "all",
        group: "metadata-config",
        sourceRoot: fixture.sourceRoot,
        outputRoot: fixture.outputRoot,
      }),
      /missing_input/u,
    );
    assert.deepEqual(snapshot(fixture.outputRoot), before);
  } finally {
    cleanup(fixture);
  }
});

test("full all/all check blocks a retired Dev directory while targeted checks ignore it", () => {
  const fixture = createFixture();
  try {
    generator.generatePackage({
      package: "all",
      group: "all",
      sourceRoot: fixture.sourceRoot,
      outputRoot: fixture.outputRoot,
    });
    write(fixture.outputRoot, "kcoderag-dev/legacy.txt", "retired product fixture\n");

    for (const selectedPackage of ["qa", "cursor"] as const) {
      const targeted = generator.checkGenerated({
        package: selectedPackage,
        group: "all",
        sourceRoot: fixture.sourceRoot,
        outputRoot: fixture.outputRoot,
      });
      assert.equal(targeted.ok, true);
      assert.deepEqual(targeted.diagnostics, []);
    }

    const repositoryCheck = generator.checkGenerated({
      package: "all",
      group: "all",
      sourceRoot: fixture.sourceRoot,
      outputRoot: fixture.outputRoot,
    });
    assert.equal(repositoryCheck.ok, false);
    assert.deepEqual(repositoryCheck.changedPaths, ["kcoderag-dev"]);
    assert.deepEqual(repositoryCheck.diagnostics, ["retired_product: kcoderag-dev"]);
    assert.equal(JSON.stringify(repositoryCheck).includes(fixture.secret), false);
  } finally {
    cleanup(fixture);
  }
});
