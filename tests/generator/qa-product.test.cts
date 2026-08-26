const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

interface GeneratorModule {
  generatePackage(options: {
    readonly package: "qa";
    readonly group: "all";
    readonly sourceRoot: string;
    readonly outputRoot: string;
  }): { readonly ok: boolean; readonly writtenPaths: readonly string[] };
}

const repositoryRoot = path.resolve(__dirname, "../..");
const generator = require("../../dist/generator/index.cjs") as GeneratorModule;
const EXPECTED_NON_DOCUMENT = Object.freeze([
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".codex.mcp.json",
  ".mcp.json",
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
]);

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function filesBelow(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      if (entry.isFile()) output.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  };
  visit(root);
  return output.sort(compare);
}

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

test("QA non-document product is a closed deterministic seventeen-file inventory", () => {
  const qaRoot = path.join(repositoryRoot, "kcoderag-qa");
  assert.deepEqual(filesBelow(qaRoot).filter((member) => member !== "README.md"), EXPECTED_NON_DOCUMENT);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "kcoderag-dev")), false);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-qa-product-"));
  try {
    const generated = generator.generatePackage({
      package: "qa",
      group: "all",
      sourceRoot: repositoryRoot,
      outputRoot: temporary,
    });
    assert.equal(generated.ok, true);
    for (const member of EXPECTED_NON_DOCUMENT) {
      assert.equal(
        sha256(path.join(temporary, "kcoderag-qa", ...member.split("/"))),
        sha256(path.join(qaRoot, ...member.split("/"))),
        member,
      );
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("QA guidance and registration expose only the current QA product", () => {
  const packageVersion = (JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    version: string;
  }).version;
  for (const manifest of [
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
  ]) {
    const value = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "kcoderag-qa", ...manifest.split("/")), "utf8")) as {
      name?: string;
      version?: string;
    };
    assert.equal(value.name, "kcoderag-qa", manifest);
    assert.equal(value.version, packageVersion, manifest);
  }

  const activeText = [
    "agents/kcode-explorer.md",
    "hooks/hooks.json",
    "skills/code-lookup-discipline/SKILL.md",
  ].map((member) => fs.readFileSync(path.join(repositoryRoot, "kcoderag-qa", ...member.split("/")), "utf8")).join("\n");
  assert.match(activeText, /QA/u);
  assert.match(activeText, /run_hook/u);
  assert.doesNotMatch(activeText, /kcoderag-dev|--environment\s+dev|mcp__plugin_kcoderag-dev/iu);
});
