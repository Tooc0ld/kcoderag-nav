const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const childProcess = require("node:child_process") as typeof import("node:child_process");

type Policy = "user-docs" | "project-instructions" | "planning";

interface Diagnostic {
  readonly code: string;
  readonly path: string;
  readonly line: number;
}

interface DocsCheckModule {
  checkDocs(
    paths: readonly string[],
    policy: Policy,
    options?: { readonly repoRoot?: string },
  ): { readonly checkedFiles: number; readonly diagnostics: readonly Diagnostic[] };
  checkCanonicalPublicDocs(options?: { readonly repoRoot?: string }): {
    readonly checkedFiles: number;
    readonly diagnostics: readonly Diagnostic[];
  };
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

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[]): CliResult {
  const result = childProcess.spawnSync(
    process.execPath,
    [path.resolve("dist/maintainer/docs-check.cjs"), ...args],
    { cwd: path.resolve("."), encoding: "utf8" },
  );
  assert.equal(result.error, undefined);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function cliPayload(result: CliResult): Record<string, unknown> {
  const raw = result.stdout.trim() || result.stderr.trim();
  return JSON.parse(raw) as Record<string, unknown>;
}

const CANONICAL_REPO_DOCS = Object.freeze([
  "README.md",
  "plugin-src/README.md.tmpl",
  "plugin-src/cursor/README.md.tmpl",
  "kcoderag-qa/README.md",
  "kcoderag-cursor/README.md",
  "docs/MCP_QA_EXPERIENCE_GUIDE.md",
] as const);

function completePublicContract(): string {
  return [
    "# Install capabilities into one project",
    "QA is the only public environment for MCP. The current directory is the exact project target.",
    "The built-ins are kcoderag-navigation and code-style-nudge.",
    "Install composes installed ∪ selected. Uninstall needs an explicit capability or --all and never defaults to everything.",
    "status is a fast read-only project check; doctor is a read-only deep source scan.",
    "An active source is source_conflict with ok: false. The same source gate covers all mutations before writes.",
    "The CLI does not migrate, adopt, or automatically clean manual sources.",
    "Current state binds one composite digest and every managed file; drift reports capability_drift.",
    "Close every related host session, remove kcoderag-nav/nudges, then reopen. status and doctor remain read-only; failure is fail-open.",
    "Claude Code 2.1.241 is supported with PASS.",
    "Codex 0.146.1 is UNSUPPORTED; Cursor 3.17.8 is UNSUPPORTED; OpenCode 1.18.23 is UNSUPPORTED.",
    "Codex and Claude find the nearest state; a damaged boundary never falls through; complete project move works.",
    "Cursor uses an always-on Rule and does not use an equivalent PreToolUse Hook.",
    "ZCode uses .zcode/config.json with hooks.enabled, advisory PreToolUse, PostToolUse, and `npx kcoderag-nav@latest update --host zcode`; users must trust the workspace Hook.",
    "Automatic update is automatic version awareness only; it never runs install/update and the explicit update command remains required.",
    "runtimeContract.layer: `packaged` does not prove native host admission.",
    "Phase 06 owns authenticated real-host MCP query evidence.",
    "",
    "```powershell",
    "npx kcoderag-nav@latest install --host codex --capability kcoderag-navigation",
    "npx kcoderag-nav@latest status --host codex",
    "npx kcoderag-nav@latest doctor --host codex",
    "npx kcoderag-nav@latest update --host codex",
    "npx kcoderag-nav@latest uninstall --host codex --capability kcoderag-navigation",
    "```",
    "",
  ].join("\n");
}

function completeUserGuide(): string {
  return [
    "# KCodeRag Nav installation and use",
    "Node.js 22+ users run npx kcoderag-nav@latest install in one project.",
    "The built-ins are kcoderag-navigation and code-style-nudge.",
    "Codex, Claude Code, Cursor, OpenCode, and ZCode are supported hosts.",
    "install, status, doctor, update, and uninstall are the five lifecycle commands.",
    "Run status and doctor, then reopen the host session.",
    "Daily use calls search_code, context, get_call_chain, and list_indexes.",
    "Claude Code 2.1.241 is supported for code-style-nudge; other hosts are not enabled and users should not select it.",
    "",
  ].join("\n");
}

function writeCanonicalContract(root: string): void {
  for (const relativePath of CANONICAL_REPO_DOCS) {
    write(
      root,
      relativePath,
      relativePath === "docs/MCP_QA_EXPERIENCE_GUIDE.md"
        ? completeUserGuide()
        : completePublicContract(),
    );
  }
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

test("reports links, obsolete commands, host flags, Cursor hook claims, and secrets safely", () => {
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

test("canonical public contract requires capability lifecycle, support, integrity, D-19, Hook, and evidence topics", () => {
  const root = temporaryDirectory("kcoderag-docs-contract-");
  try {
    writeCanonicalContract(root);
    assert.deepEqual(docsCheck.checkCanonicalPublicDocs({ repoRoot: root }), {
      checkedFiles: 6,
      diagnostics: [],
    });

    const cases: readonly [string, string, string, string?][] = [
      ["status is a fast read-only project check; doctor is a read-only deep source scan.", "status and doctor are commands.", "missing_topic_status_doctor"],
      ["The built-ins are kcoderag-navigation and code-style-nudge.", "The built-ins are navigation only.", "missing_topic_capabilities"],
      ["Install composes installed ∪ selected.", "Install replaces selection.", "missing_topic_additive_lifecycle"],
      ["The same source gate covers all mutations before writes.", "Sources are listed.", "missing_topic_all_mutation_gate"],
      ["The CLI does not migrate, adopt, or automatically clean manual sources.", "Sources are listed.", "missing_topic_no_source_authority"],
      ["Current state binds one composite digest and every managed file; drift reports capability_drift.", "Current state records files.", "missing_topic_complete_integrity"],
      ["Close every related host session, remove kcoderag-nav/nudges, then reopen. status and doctor remain read-only; failure is fail-open.", "Markers are cached.", "missing_topic_d19_manual_reset"],
      ["Codex 0.146.1 is UNSUPPORTED; Cursor 3.17.8 is UNSUPPORTED; OpenCode 1.18.23 is UNSUPPORTED.", "Other hosts vary.", "missing_topic_exact_host_support"],
      ["a damaged boundary never falls through; complete project move works", "a boundary exists", "missing_topic_nearest_state"],
      ["does not use an equivalent PreToolUse Hook", "uses integrations", "missing_topic_cursor_boundary", "plugin-src/cursor/README.md.tmpl"],
      ["ZCode uses .zcode/config.json with hooks.enabled, advisory PreToolUse, PostToolUse, and `npx kcoderag-nav@latest update --host zcode`; users must trust the workspace Hook.", "ZCode uses project files.", "missing_topic_zcode_boundary"],
      ["Automatic update is automatic version awareness only; it never runs install/update and the explicit update command remains required.", "Updates exist.", "missing_topic_update_awareness"],
      ["runtimeContract.layer: `packaged` does not prove native host admission.", "Runtime is tested.", "missing_topic_packaged_native_boundary"],
    ];
    for (const [before, after, expectedCode, relativePath = "plugin-src/README.md.tmpl"] of cases) {
      writeCanonicalContract(root);
      const target = path.join(root, ...relativePath.split("/"));
      fs.writeFileSync(target, fs.readFileSync(target, "utf8").replace(before, after), "utf8");
      assert.ok(codes(docsCheck.checkCanonicalPublicDocs({ repoRoot: root })).includes(expectedCode));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the user guide requires actionable onboarding without maintainer-only evidence topics", () => {
  const root = temporaryDirectory("kcoderag-user-guide-contract-");
  try {
    writeCanonicalContract(root);
    const guide = path.join(root, "docs", "MCP_QA_EXPERIENCE_GUIDE.md");
    const source = fs.readFileSync(guide, "utf8");
    assert.equal(/receipt|digest|runtimeContract|Phase\s+0/iu.test(source), false);
    assert.deepEqual(docsCheck.checkCanonicalPublicDocs({ repoRoot: root }).diagnostics, []);

    fs.writeFileSync(guide, source.replace("search_code", "find_code"), "utf8");
    assert.ok(
      codes(docsCheck.checkCanonicalPublicDocs({ repoRoot: root }))
        .includes("missing_topic_daily_use"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("active docs reject retired authorities, scanner claims, unsupported code-style parity, and obsolete install surfaces", () => {
  const root = temporaryDirectory("kcoderag-docs-active-policy-");
  try {
    const fixtures: readonly [string, string][] = [
      ["npx kcoderag-nav@latest install --host codex --environment dev", "public_dev_instruction"],
      ["Copy kcoderag-dev/hooks into the project.", "public_dev_instruction"],
      ["Install from .claude-plugin/marketplace.json.", "forbidden_marketplace_catalog"],
      ["git clone https://example.invalid/kcoderag-nav.git", "forbidden_clone_command"],
      ["python scripts/manage_project_install.py install", "forbidden_python_command"],
      ["codex plugin marketplace remove another-marketplace --json", "unsafe_cleanup_command"],
      ["npx kcoderag-nav@latest doctor --host codex --fix", "doctor_fix_claim"],
      ["npx kcoderag-nav@latest update --host codex --yes --allow-owned-source-cleanup --cleanup-fingerprint sha256:abc", "retired_authority_claim"],
      ["npx kcoderag-nav@latest update --host codex --yes --allow-legacy-dev-migration", "retired_authority_claim"],
      ["codex plugin remove PLUGIN@MARKETPLACE --json", "retired_cleanup_command"],
      ["Run the code-style scanner and report scanner passed.", "scanner_claim"],
      ["Cursor supports native pre-write code-style guidance.", "unsupported_code_style_claim"],
    ];
    for (const [instruction, expectedCode] of fixtures) {
      write(root, "README.md", `# Install\n\n${instruction}\n`);
      assert.ok(codes(docsCheck.checkDocs(["README.md"], "user-docs", { repoRoot: root })).includes(expectedCode));
    }

    write(root, "README.md", [
      "# Historical migration record",
      "The retired release used --allow-legacy-dev-migration and codex plugin remove OLD@SOURCE --json.",
      "Those authorities are unavailable now.",
    ].join("\n"));
    assert.deepEqual(docsCheck.checkDocs(["README.md"], "user-docs", { repoRoot: root }).diagnostics, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("zero-argument CLI checks the canonical repository documents and local guide together", () => {
  const parent = temporaryDirectory("kcoderag-docs-zero-argument-");
  const repo = path.join(parent, "kcoderag-nav");
  try {
    writeCanonicalContract(repo);
    const compiledEntry = path.join(repo, "dist", "maintainer", "docs-check.cjs");
    write(repo, "dist/maintainer/docs-check.cjs", fs.readFileSync(path.resolve("dist/maintainer/docs-check.cjs"), "utf8"));
    const completed = childProcess.spawnSync(process.execPath, [compiledEntry], {
      cwd: repo,
      encoding: "utf8",
    });
    assert.equal(completed.error, undefined);
    const result = {
      status: completed.status,
      stdout: completed.stdout,
      stderr: completed.stderr,
    };
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(cliPayload(result), { ok: true, checkedFiles: 6 });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
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

    let linkedInput = "linked.md";
    try {
      fs.symlinkSync(path.join(outside, "outside.md"), path.join(root, linkedInput), "file");
    } catch {
      linkedInput = "linked/outside.md";
      try {
        fs.symlinkSync(outside, path.join(root, "linked"), "junction");
      } catch (error) {
        context.skip(`symlink unavailable: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`);
        return;
      }
    }
    assert.throws(
      () => docsCheck.checkDocs([linkedInput], "planning", { repoRoot: root }),
      (error: unknown) => errorCode(error) === "symlink_not_allowed",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("compiled CLI accepts every repository policy with explicit scoped paths", () => {
  const repositoryRoot = path.resolve(".");
  const fixtureRoot = fs.mkdtempSync(path.join(repositoryRoot, ".docs-check-cli-"));
  const relativeRoot = path.relative(repositoryRoot, fixtureRoot).replace(/\\/g, "/");
  try {
    write(fixtureRoot, "user.md", "# Install\n\nRequires Node.js 22+.\n```sh\nnpx kcoderag-nav@latest status --host codex\n```\n");
    write(fixtureRoot, "instructions.md", "# Project rules\n\nCursor uses a Rule, not a hook.\n");
    write(fixtureRoot, "planning.md", "# Migration history\n\nThe former Python path is historical.\n");

    for (const [policy, file] of [
      ["user-docs", "user.md"],
      ["project-instructions", "instructions.md"],
      ["planning", "planning.md"],
    ] as const) {
      const result = runCli(["--policy", policy, `${relativeRoot}/${file}`]);
      assert.equal(result.status, 0, `${policy}: ${result.stderr}`);
      assert.deepEqual(cliPayload(result), { ok: true, checkedFiles: 1 });
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("compiled CLI rejects unknown arguments, empty scope, and absolute repository paths", () => {
  const cases: readonly [readonly string[], string][] = [
    [["--policy", "planning"], "empty_scope"],
    [["--policy", "unknown", "README.md"], "unknown_policy"],
    [["--wat", "README.md"], "unknown_flag"],
    [["--policy", "planning", path.resolve("README.md")], "absolute_path_not_allowed"],
  ];
  for (const [args, expectedCode] of cases) {
    const result = runCli(args);
    assert.equal(result.status, 2);
    assert.equal(cliPayload(result).code, expectedCode);
  }
});

test("canonical docs require the repository-owned guide", () => {
  const root = temporaryDirectory("kcoderag-local-guide-required-");
  try {
    writeCanonicalContract(root);
    fs.rmSync(path.join(root, "docs", "MCP_QA_EXPERIENCE_GUIDE.md"));
    assert.throws(
      () => docsCheck.checkCanonicalPublicDocs({ repoRoot: root }),
      (error: unknown) => errorCode(error) === "path_not_found",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
