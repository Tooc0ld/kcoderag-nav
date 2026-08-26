const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type Product = "qa" | "cursor";
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

const expectedGroups: GeneratorModule["ASSET_GROUP_PATHS"] = {
  qa: {
    "runtime-cjs": ["hooks/grep-nudge.cjs", "hooks/mcp-call-marker.cjs", "hooks/update-check.cjs", "hooks/update-worker.cjs"],
    "runtime-launcher": ["hooks/run_hook.cmd", "hooks/run_hook.sh", "hooks/run_marker.cmd", "hooks/run_marker.sh"],
    "runtime-registration": ["hooks/hooks.json", "opencode/kcoderag-nav.js"],
    "runtime-code": [
      "hooks/grep-nudge.cjs",
      "hooks/mcp-call-marker.cjs",
      "hooks/run_hook.cmd",
      "hooks/run_hook.sh",
      "hooks/run_marker.cmd",
      "hooks/run_marker.sh",
      "hooks/update-check.cjs",
      "hooks/update-worker.cjs",
    ],
    runtime: [
      "hooks/grep-nudge.cjs",
      "hooks/hooks.json",
      "hooks/mcp-call-marker.cjs",
      "hooks/run_hook.cmd",
      "hooks/run_hook.sh",
      "hooks/run_marker.cmd",
      "hooks/run_marker.sh",
      "hooks/update-check.cjs",
      "hooks/update-worker.cjs",
      "opencode/kcoderag-nav.js",
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
      "hooks/mcp-call-marker.cjs",
      "hooks/run_hook.cmd",
      "hooks/run_hook.sh",
      "hooks/run_marker.cmd",
      "hooks/run_marker.sh",
      "hooks/update-check.cjs",
      "hooks/update-worker.cjs",
      "opencode/kcoderag-nav.js",
      "skills/code-lookup-discipline/SKILL.md",
    ],
  },
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
  write(sourceRoot, "dist/hooks/mcp-call-marker.cjs", "module.exports={name:'marker'};\n");
  write(sourceRoot, "dist/hooks/update-check.cjs", "module.exports={name:'check'};\n");
  write(sourceRoot, "dist/hooks/update-worker.cjs", "module.exports={name:'worker'};\n");
  write(sourceRoot, "plugin-src/opencode/kcoderag-nav.js", "export const KCodeRagNav=async()=>({});\n");
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
      "kcoderag-qa/hooks/mcp-call-marker.cjs",
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
    assert.equal(first.writtenPaths.length, 22);
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
      ["--package", "unknown", "--group", "docs"],
      ["--package", "qa", "--group", "unknown"],
      ["--package", "qa", "--group", ""],
      ["--package", "cursor", "--group", "runtime-cjs"],
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
