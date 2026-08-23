const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type Policy = "user-docs" | "project-instructions" | "planning" | "sibling-guide";

interface Diagnostic {
  readonly code: string;
  readonly path: string;
  readonly line: number;
}

interface DocsCheckModule {
  checkDocs(
    paths: readonly string[],
    policy: Policy,
    options?: { readonly repoRoot?: string; readonly siblingGuidePath?: string },
  ): { readonly checkedFiles: number; readonly diagnostics: readonly Diagnostic[] };
}

const docsCheck = require("../../dist/maintainer/docs-check.cjs") as DocsCheckModule;

function temporaryDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(root: string, relativePath: string, content: string): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content, "utf8");
}

function codes(result: ReturnType<DocsCheckModule["checkDocs"]>): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code).sort();
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as Error & { code: unknown }).code)
    : undefined;
}

test("accepts valid scoped user documentation and local Markdown links", () => {
  const root = temporaryDirectory("kcoderag-docs-valid-");
  try {
    write(root, "docs/details.md", "# Details\n");
    write(
      root,
      "README.md",
      [
        "# Install",
        "",
        "Requires Node.js 22 or newer. Cursor uses an always-on Rule, not a PreToolUse hook.",
        "See [details](docs/details.md#details).",
        "",
        "```sh",
        "npx kcoderag-nav@latest install --host cursor",
        "npx kcoderag-nav@latest status --host codex",
        "```",
        "",
      ].join("\n"),
    );

    const result = docsCheck.checkDocs(["README.md"], "user-docs", { repoRoot: root });
    assert.equal(result.checkedFiles, 1);
    assert.deepEqual(result.diagnostics, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reports links, obsolete commands, host flags, Cursor hook claims, guide copies, and secrets safely", () => {
  const root = temporaryDirectory("kcoderag-docs-invalid-");
  const sentinel = "Bearer secret-value-that-must-never-echo";
  try {
    write(
      root,
      "MCP_QA_EXPERIENCE_GUIDE.md",
      [
        "# Installation",
        "[missing](missing.md)",
        "Cursor uses a PreToolUse hook.",
        "```powershell",
        "python scripts/manage_project_install.py install",
        "git clone https://example.invalid/repo.git",
        "codex plugin marketplace add example",
        "npx kcoderag-nav install --host vscode",
        sentinel,
        "```",
      ].join("\n"),
    );

    const result = docsCheck.checkDocs(["MCP_QA_EXPERIENCE_GUIDE.md"], "user-docs", {
      repoRoot: root,
    });
    assert.deepEqual(codes(result), [
      "broken_markdown_link",
      "cursor_hook_claim",
      "forbidden_clone_command",
      "forbidden_marketplace_command",
      "forbidden_python_command",
      "invalid_host_flag",
      "invalid_npx_command",
      "local_guide_copy",
      "secret_like_value",
    ]);
    assert.equal(JSON.stringify(result).includes(sentinel), false);
    assert.equal(
      result.diagnostics.every(
        (diagnostic) =>
          Object.keys(diagnostic).sort().join(",") === "code,line,path" &&
          !path.isAbsolute(diagnostic.path) &&
          diagnostic.line > 0,
      ),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("does not treat explanatory history or HTML comments as active user instructions", () => {
  const root = temporaryDirectory("kcoderag-docs-history-");
  try {
    write(
      root,
      "history.md",
      [
        "# Migration history",
        "",
        "The former release used python and marketplace installation; those paths are retired.",
        "<!-- python scripts/old.py; git clone https://example.invalid/old.git -->",
        "",
        "# Planning notes",
        "",
        "A future plan may scan the phrase `codex plugin marketplace add` as historical text.",
      ].join("\n"),
    );

    assert.deepEqual(
      docsCheck.checkDocs(["history.md"], "planning", { repoRoot: root }).diagnostics,
      [],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects empty scope, traversal, absolute repo paths, and symlink input before reading", (context) => {
  const root = temporaryDirectory("kcoderag-docs-scope-");
  const outside = temporaryDirectory("kcoderag-docs-outside-");
  try {
    write(root, "docs/readme.md", "# Safe\n");
    write(outside, "outside.md", "# Outside\n");

    assert.throws(
      () => docsCheck.checkDocs([], "planning", { repoRoot: root }),
      (error: unknown) => errorCode(error) === "empty_scope",
    );
    assert.throws(
      () => docsCheck.checkDocs(["../outside.md"], "planning", { repoRoot: root }),
      (error: unknown) => errorCode(error) === "path_escape",
    );
    assert.throws(
      () => docsCheck.checkDocs([path.join(root, "docs/readme.md")], "planning", { repoRoot: root }),
      (error: unknown) => errorCode(error) === "absolute_path_not_allowed",
    );

    try {
      fs.symlinkSync(path.join(outside, "outside.md"), path.join(root, "linked.md"), "file");
    } catch (error) {
      context.skip(`symlink unavailable: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`);
      return;
    }
    assert.throws(
      () => docsCheck.checkDocs(["linked.md"], "planning", { repoRoot: root }),
      (error: unknown) => errorCode(error) === "symlink_not_allowed",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
