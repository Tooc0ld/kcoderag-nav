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
const CODE_STYLE_SKILL_MEMBERS = Object.freeze([
  "SKILL.md",
  "references/change-hygiene-self-review.md",
  "references/cpp-lifetime-control-flow.md",
  "references/lua-contracts.md",
  "references/protocol-serialization-data.md",
]);
const EXPECTED_NON_DOCUMENT = Object.freeze([
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".codex.mcp.json",
  ".mcp.json",
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
  "skills/kcoderag/SKILL.md",
  "skills/kcoderag/agents/openai.yaml",
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

test("YAML source and generated metadata keep deterministic LF checkout bytes", () => {
  const attributes = fs.readFileSync(path.join(repositoryRoot, ".gitattributes"), "utf8");
  assert.match(attributes, /^\*\.yaml text eol=lf$/mu);
  assert.match(attributes, /^\*\.yml text eol=lf$/mu);
});

test("QA non-document product is a closed deterministic thirty-three-file inventory", () => {
  const qaRoot = path.join(repositoryRoot, "kcoderag-qa");
  const actualNonDocument = filesBelow(qaRoot).filter((member) => member !== "README.md");
  assert.deepEqual(actualNonDocument, EXPECTED_NON_DOCUMENT);
  assert.equal(actualNonDocument.length, 33);
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

test("QA style handler and five Markdown assets are byte-identical to canonical sources", () => {
  const qaRoot = path.join(repositoryRoot, "kcoderag-qa");
  assert.equal(
    sha256(path.join(qaRoot, "hooks", "code-style-nudge.cjs")),
    sha256(path.join(repositoryRoot, "dist", "hooks", "code-style-nudge.cjs")),
  );
  for (const member of CODE_STYLE_SKILL_MEMBERS) {
    assert.equal(
      sha256(path.join(qaRoot, "skills", "kcoderag-code-style", ...member.split("/"))),
      sha256(path.join(
        repositoryRoot,
        "plugin-src",
        "capabilities",
        "code-style-nudge",
        "skill",
        ...member.split("/"),
      )),
      member,
    );
  }
});

test("QA Hook manifest retains bounded lifecycle, advisory, and success-marker lanes", () => {
  const registration = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "kcoderag-qa", "hooks", "hooks.json"), "utf8"),
  ) as {
    hooks?: {
      SessionStart?: readonly {
        hooks?: readonly {
          additionalContextLimit?: unknown;
          command?: unknown;
          commandWindows?: unknown;
        }[];
        matcher?: unknown;
      }[];
      PreToolUse?: readonly {
        hooks?: readonly {
          additionalContextLimit?: unknown;
          command?: unknown;
          commandWindows?: unknown;
        }[];
        matcher?: unknown;
      }[];
      PostToolUse?: readonly {
        hooks?: readonly {
          command?: unknown;
          commandWindows?: unknown;
        }[];
        matcher?: unknown;
      }[];
    };
  };
  assert.deepEqual(Object.keys(registration), ["hooks"]);
  assert.deepEqual(Object.keys(registration.hooks ?? {}).sort(compare), ["PostToolUse", "PreToolUse", "SessionStart"]);
  assert.equal(registration.hooks?.SessionStart?.length, 1);
  assert.equal(registration.hooks?.PreToolUse?.length, 1);
  assert.equal(registration.hooks?.PostToolUse?.length, 1);
  const lifecycle = registration.hooks?.SessionStart?.[0]?.hooks?.[0];
  const advisory = registration.hooks?.PreToolUse?.[0]?.hooks?.[0];
  const marker = registration.hooks?.PostToolUse?.[0]?.hooks?.[0];
  assert.equal(lifecycle?.additionalContextLimit, 600);
  assert.equal(typeof lifecycle?.command, "string");
  assert.equal(typeof lifecycle?.commandWindows, "string");
  assert.equal(advisory?.additionalContextLimit, 600);
  assert.equal(typeof advisory?.command, "string");
  assert.equal(typeof advisory?.commandWindows, "string");
  assert.equal(typeof marker?.command, "string");
  assert.equal(typeof marker?.commandWindows, "string");
  assert.equal(registration.hooks?.SessionStart?.[0]?.matcher, "^(startup|resume|clear|compact)$");
  assert.equal(registration.hooks?.PreToolUse?.[0]?.matcher, "^(Grep|Glob|Bash|Write|Edit|MultiEdit|apply_patch)$");
  assert.equal(registration.hooks?.PostToolUse?.[0]?.matcher, "^mcp__kcoderag[-_]qa__.*$");
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
    "skills/kcoderag/SKILL.md",
    "skills/kcoderag-code-style/SKILL.md",
  ].map((member) => fs.readFileSync(path.join(repositoryRoot, "kcoderag-qa", ...member.split("/")), "utf8")).join("\n");
  assert.match(activeText, /QA/u);
  assert.match(activeText, /run_hook/u);
  assert.match(activeText, /kcoderag-code-style/u);
  assert.doesNotMatch(activeText, /kcoderag-dev|--environment\s+dev|mcp__plugin_kcoderag-dev/iu);
});
