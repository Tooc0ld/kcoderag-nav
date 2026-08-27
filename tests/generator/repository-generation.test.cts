const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type Product = "qa" | "cursor";
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

interface GenerationResult {
  readonly ok: boolean;
  readonly changedPaths: readonly string[];
  readonly writtenPaths: readonly string[];
}

interface GeneratorModule {
  readonly GenerationError: new (code: string, safePath?: string) => Error & {
    readonly code: string;
    readonly safePath?: string;
  };
  readonly ASSET_GROUP_PATHS: Readonly<Record<Product, Readonly<Record<AssetGroup, readonly string[]>>>>;
  checkGenerated(options: {
    readonly package: Product | "all";
    readonly group: AssetGroup;
    readonly sourceRoot: string;
    readonly outputRoot: string;
  }): GenerationResult;
  generatePackage(options: {
    readonly package: Product | "all";
    readonly group: AssetGroup;
    readonly capabilities?: readonly ("kcoderag-navigation" | "code-style-nudge")[];
    readonly sourceRoot: string;
    readonly outputRoot: string;
  }): GenerationResult & { readonly capabilities: readonly string[] };
}

interface FileEvidence {
  readonly digest: string;
  readonly mtimeMs: number;
  readonly size: number;
}

const repositoryRoot = path.resolve(__dirname, "..", "..");
const generator = require(path.join(repositoryRoot, "dist", "generator", "index.cjs")) as GeneratorModule;
const products = ["qa", "cursor"] as const;
const expectedProductInventory: Readonly<Record<Product, readonly string[]>> = Object.freeze({
  qa: Object.freeze([
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
    "hooks/update-notice.cjs",
    "hooks/update-worker.cjs",
    "opencode/kcoderag-nav.js",
    "skills/code-lookup-discipline/SKILL.md",
  ]),
  cursor: Object.freeze([
    ".cursor-plugin/plugin.json",
    "README.md",
    "mcp.json",
    "rules/kcoderag-navigation.mdc",
    "skills/code-lookup-discipline/SKILL.md",
  ]),
});

function productPath(root: string, product: Product, relativePath: string): string {
  return path.join(root, `kcoderag-${product}`, ...relativePath.split("/"));
}

function readJson(root: string, relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, ...relativePath.split("/")), "utf8")) as Record<
    string,
    unknown
  >;
}

function sortedKeys(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function normalizeText(bytes: Buffer): Buffer {
  return Buffer.from(`${bytes.toString("utf8").replace(/\r\n?/gu, "\n").replace(/\n*$/u, "")}\n`, "utf8");
}

function evidenceForSelectedAssets(): Readonly<Record<string, FileEvidence>> {
  const evidence: Record<string, FileEvidence> = {};
  for (const product of products) {
    for (const relativePath of expectedProductInventory[product]) {
      const absolute = productPath(repositoryRoot, product, relativePath);
      const bytes = fs.readFileSync(absolute);
      const stat = fs.statSync(absolute);
      evidence[`kcoderag-${product}/${relativePath}`] = {
        digest: crypto.createHash("sha256").update(bytes).digest("hex"),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      };
    }
  }
  return Object.fromEntries(
    Object.entries(evidence).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
  );
}

function assertNoTemplateTokens(root: string): void {
  for (const product of products) {
    for (const relativePath of generator.ASSET_GROUP_PATHS[product].all) {
      const bytes = fs.readFileSync(productPath(root, product, relativePath));
      assert.equal(/\{\{[^{}]*\}\}/u.test(bytes.toString("utf8")), false, `${product}/${relativePath}`);
    }
  }
}

function walkProductFiles(root: string, product: Product): readonly string[] {
  const productRoot = path.join(root, `kcoderag-${product}`);
  const visit = (directory: string, prefix = ""): string[] => fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory()
        ? visit(path.join(directory, entry.name), relativePath)
        : [relativePath];
    });
  return Object.freeze(visit(productRoot).sort());
}

function assertQaStructure(root: string, version: string): void {
  const expectedName = "kcoderag-qa";
  const codexManifest = readJson(root, "kcoderag-qa/.codex-plugin/plugin.json");
  const claudeManifest = readJson(root, "kcoderag-qa/.claude-plugin/plugin.json");
  assert.equal(codexManifest.name === expectedName && codexManifest.version === version, true, "qa:codex");
  assert.equal(claudeManifest.name === expectedName && claudeManifest.version === version, true, "qa:claude");

  const codexMcp = readJson(root, "kcoderag-qa/.codex.mcp.json");
  const claudeMcp = readJson(root, "kcoderag-qa/.mcp.json");
  assert.deepEqual(sortedKeys(codexMcp), [expectedName], "qa:codex-mcp-namespace");
  const claudeServers = claudeMcp.mcpServers;
  assert.deepEqual(sortedKeys(claudeServers), [expectedName], "qa:claude-mcp-namespace");

  for (const runtime of ["grep-nudge.cjs", "mcp-call-marker.cjs", "update-check.cjs", "update-notice.cjs", "update-worker.cjs"] as const) {
    assert.equal(
      fs.readFileSync(productPath(root, "qa", `hooks/${runtime}`)).equals(
        fs.readFileSync(path.join(repositoryRoot, "dist", "hooks", runtime)),
      ),
      true,
      `qa:${runtime}`,
    );
  }
  for (const launcher of ["run_hook.cmd", "run_hook.sh", "run_marker.cmd", "run_marker.sh"] as const) {
    assert.equal(
      fs.readFileSync(productPath(root, "qa", `hooks/${launcher}`)).equals(
        normalizeText(fs.readFileSync(path.join(repositoryRoot, "plugin-src", "hooks", launcher))),
      ),
      true,
      `qa:${launcher}`,
    );
  }

  const registration = readJson(root, "kcoderag-qa/hooks/hooks.json");
  const hooks = registration.hooks;
  assert.equal(typeof hooks === "object" && hooks !== null && !Array.isArray(hooks), true, "qa:hooks");
  const preToolUse = (hooks as Record<string, unknown>).PreToolUse;
  assert.equal(Array.isArray(preToolUse) && preToolUse.length === 1, true, "qa:pre-tool-use");
  const postToolUse = (hooks as Record<string, unknown>).PostToolUse;
  assert.equal(Array.isArray(postToolUse) && postToolUse.length === 1, true, "qa:post-tool-use");
  assert.match(JSON.stringify(postToolUse), /mcp__kcoderag-qa__/u);
  assert.equal(fs.statSync(productPath(root, "qa", "opencode/kcoderag-nav.js")).size > 0, true);

  for (const relativePath of [
    "agents/kcode-explorer.md",
    "skills/code-lookup-discipline/SKILL.md",
    "README.md",
  ]) {
    assert.equal(fs.statSync(productPath(root, "qa", relativePath)).size > 0, true, `qa:${relativePath}`);
  }
}

test("compiled repository gate proves all generated products canonical without repository writes", () => {
  assert.equal(path.extname(__filename), ".cjs");
  const packageDocument = readJson(repositoryRoot, "package.json");
  const version = packageDocument.version;
  assert.equal(typeof version === "string" && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(version), true);

  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-repository-projection-"));
  const before = evidenceForSelectedAssets();
  try {
    const generated = generator.generatePackage({
      package: "all",
      group: "all",
      sourceRoot: repositoryRoot,
      outputRoot,
    });
    assert.equal(generated.writtenPaths.length, 37);
    const checked = generator.checkGenerated({
      package: "all",
      group: "all",
      sourceRoot: repositoryRoot,
      outputRoot,
    });
    assert.equal(checked.ok, true, `isolated drift: ${checked.changedPaths.join(",")}`);
    assert.deepEqual(checked.changedPaths, []);
    assert.deepEqual(checked.writtenPaths, []);
    assert.deepEqual(evidenceForSelectedAssets(), before);

    assertQaStructure(outputRoot, version as string);
    assert.equal(fs.existsSync(path.join(outputRoot, "kcoderag-dev")), false, "retired Dev tree");

    const cursorManifest = readJson(outputRoot, "kcoderag-cursor/.cursor-plugin/plugin.json");
  assert.equal(cursorManifest.name === "kcoderag-nav" && cursorManifest.version === version, true, "cursor:manifest");
    const cursorMcp = readJson(outputRoot, "kcoderag-cursor/mcp.json");
  assert.deepEqual(sortedKeys(cursorMcp.mcpServers), ["kcoderag"], "cursor:mcp-namespace");
  for (const relativePath of [
    "rules/kcoderag-navigation.mdc",
    "skills/code-lookup-discipline/SKILL.md",
    "README.md",
  ]) {
      assert.equal(fs.statSync(productPath(outputRoot, "cursor", relativePath)).size > 0, true, `cursor:${relativePath}`);
    }
    assertNoTemplateTokens(outputRoot);
    for (const product of products) {
      assert.deepEqual(walkProductFiles(outputRoot, product), generator.ASSET_GROUP_PATHS[product].all);
    }
    assert.deepEqual(evidenceForSelectedAssets(), before);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("Dev canonical selection, generated directory, and compatibility manifest fail independently", () => {
  assert.throws(
    () => generator.checkGenerated({
      package: "dev" as unknown as Product,
      group: "all",
      sourceRoot: repositoryRoot,
      outputRoot: repositoryRoot,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { readonly code: string }).code === "retired_product",
  );

  for (const relativePath of ["README.md", ".codex-plugin/plugin.json"] as const) {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-retired-product-"));
    try {
      const retired = path.join(outputRoot, "kcoderag-dev", ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(retired), { recursive: true });
      fs.writeFileSync(retired, "retired\n", { mode: 0o600 });
      const checked = generator.checkGenerated({
        package: "all",
        group: "all",
        sourceRoot: repositoryRoot,
        outputRoot,
      });
      assert.equal(checked.ok, false);
      assert.equal(checked.changedPaths.includes("kcoderag-dev"), true);
      assert.deepEqual(checked.writtenPaths, []);
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  }
});

test("missing and stale generated asset fixtures fail closed while check mode remains read-only", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-repository-check-"));
  try {
    const missingBefore = evidenceForSelectedAssets();
    const missing = generator.checkGenerated({
      package: "qa",
      group: "runtime-registration",
      sourceRoot: repositoryRoot,
      outputRoot: fixtureRoot,
    });
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.changedPaths, [
      "kcoderag-qa/hooks/hooks.json",
      "kcoderag-qa/opencode/kcoderag-nav.js",
    ]);
    assert.deepEqual(missing.writtenPaths, []);
    assert.deepEqual(evidenceForSelectedAssets(), missingBefore);

    const stalePath = path.join(fixtureRoot, "kcoderag-qa", "hooks", "hooks.json");
    fs.mkdirSync(path.dirname(stalePath), { recursive: true });
    fs.writeFileSync(stalePath, "{}\n", { mode: 0o600 });
    const staleBefore = fs.readFileSync(stalePath);
    const staleMtime = fs.statSync(stalePath).mtimeMs;
    const stale = generator.checkGenerated({
      package: "qa",
      group: "runtime-registration",
      sourceRoot: repositoryRoot,
      outputRoot: fixtureRoot,
    });
    assert.equal(stale.ok, false);
    assert.deepEqual(stale.changedPaths, [
      "kcoderag-qa/hooks/hooks.json",
      "kcoderag-qa/opencode/kcoderag-nav.js",
    ]);
    assert.deepEqual(stale.writtenPaths, []);
    assert.equal(fs.readFileSync(stalePath).equals(staleBefore), true);
    assert.equal(fs.statSync(stalePath).mtimeMs, staleMtime);
    assert.deepEqual(evidenceForSelectedAssets(), missingBefore);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("capability generation from repository sources writes only an isolated output root", () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-capability-projection-"));
  const repositoryBefore = evidenceForSelectedAssets();
  try {
    const generated = (generator as GeneratorModule & {
      generatePackage(options: {
        readonly package: "qa";
        readonly group: "guidance";
        readonly capabilities: readonly ["code-style-nudge"];
        readonly sourceRoot: string;
        readonly outputRoot: string;
      }): GenerationResult & { readonly capabilities: readonly string[] };
    }).generatePackage({
      package: "qa",
      group: "guidance",
      capabilities: ["code-style-nudge"],
      sourceRoot: repositoryRoot,
      outputRoot,
    });
    assert.deepEqual(generated.capabilities, ["code-style-nudge"]);
    assert.equal(generated.writtenPaths.length, 5);
    assert.equal(
      fs.readFileSync(path.join(outputRoot, "kcoderag-qa", "skills", "code-style-correction", "SKILL.md")).equals(
        fs.readFileSync(path.join(repositoryRoot, "plugin-src", "capabilities", "code-style-nudge", "skill", "SKILL.md")),
      ),
      true,
    );
    assert.deepEqual(evidenceForSelectedAssets(), repositoryBefore);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
