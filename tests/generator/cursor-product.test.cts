const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

interface GeneratorModule {
  generatePackage(options: {
    readonly package: "cursor";
    readonly group: "all";
    readonly sourceRoot: string;
    readonly outputRoot: string;
  }): { readonly ok: boolean };
}

const repositoryRoot = path.resolve(__dirname, "../..");
const generator = require("../../dist/generator/index.cjs") as GeneratorModule;
const EXPECTED_NON_DOCUMENT = Object.freeze([
  ".cursor-plugin/plugin.json",
  "mcp.json",
  "rules/kcoderag-navigation.mdc",
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

test("Cursor non-document product is a closed deterministic four-file inventory", () => {
  const cursorRoot = path.join(repositoryRoot, "kcoderag-cursor");
  assert.deepEqual(filesBelow(cursorRoot).filter((member) => member !== "README.md"), EXPECTED_NON_DOCUMENT);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-product-"));
  try {
    const generated = generator.generatePackage({
      package: "cursor",
      group: "all",
      sourceRoot: repositoryRoot,
      outputRoot: temporary,
    });
    assert.equal(generated.ok, true);
    for (const member of EXPECTED_NON_DOCUMENT) {
      assert.equal(
        sha256(path.join(temporary, "kcoderag-cursor", ...member.split("/"))),
        sha256(path.join(cursorRoot, ...member.split("/"))),
        member,
      );
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("Cursor keeps the QA Rule, skill, and MCP capability boundary", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "kcoderag-cursor", ".cursor-plugin", "plugin.json"), "utf8"),
  ) as { name?: string; version?: string };
  const packageVersion = (JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    version: string;
  }).version;
  assert.equal(manifest.name, "kcoderag-nav");
  assert.equal(manifest.version, packageVersion);

  const activeText = [
    "rules/kcoderag-navigation.mdc",
    "skills/code-lookup-discipline/SKILL.md",
  ].map((member) => fs.readFileSync(path.join(repositoryRoot, "kcoderag-cursor", ...member.split("/")), "utf8")).join("\n");
  assert.match(activeText, /QA/u);
  assert.match(activeText, /Rule|alwaysApply/u);
  assert.doesNotMatch(activeText, /kcoderag-dev|--environment\s+dev|PreToolUse/iu);
});
