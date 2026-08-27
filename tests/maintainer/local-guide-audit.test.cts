const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

interface LocalGuideResult {
  readonly pathToken: "docs/MCP_QA_EXPERIENCE_GUIDE.md";
  readonly sha256: string;
  readonly topicCount: number;
}

interface LocalGuideAuditModule {
  readonly LocalGuideAuditError: new (code: string, safePath?: string) => Error & {
    readonly code: string;
    readonly safePath?: string;
  };
  auditLocalGuide(options?: { readonly root?: string }): LocalGuideResult;
  main(argv?: readonly string[]): number;
}

const audit = require("../../dist/maintainer/local-guide-audit.cjs") as LocalGuideAuditModule;
const GUIDE = "docs/MCP_QA_EXPERIENCE_GUIDE.md";

function temporaryRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-local-guide-"));
}

function completeGuide(): string {
  return [
    "# QA project integration guide",
    "Node.js 22+ users run npx kcoderag-nav@latest install.",
    "The built-ins are kcoderag-navigation and code-style-nudge.",
    "Codex, Claude Code, Cursor, OpenCode, and ZCode are project-scoped hosts.",
    "install, status, doctor, update, and uninstall are the five lifecycle commands.",
    "source_conflict has ok: false and the same gate covers all mutations before zero writes.",
    "The CLI does not migrate, adopt, or automatically clean manual sources.",
    "Current schema v1 binds a composite digest and every managed file; drift reports capability_drift.",
    "Close every related host session, remove kcoderag-nav/nudges, then reopen; status and doctor remain read-only and failures are fail-open.",
    "Claude Code 2.1.241 is supported with exact PASS.",
    "Codex 0.146.1 is UNSUPPORTED; Cursor 3.17.8 is UNSUPPORTED; OpenCode 1.18.23 is UNSUPPORTED; ZCode has no PASS receipt.",
    "ZCode uses .zcode/config.json, hooks.enabled, PreToolUse and PostToolUse; users must trust the workspace Hook.",
    "runtimeContract.layer: packaged does not prove native host admission or authenticated real-host MCP queries.",
    "Phase 04.2 is readiness-only and performs no publish, tag, release, or dist-tag change.",
    "Phase 05 owns Hook precision, Phase 06 real-host evidence, Phase 07 global Hook work, and Phase 08 production security.",
    "",
  ].join("\n");
}

function writeGuide(root: string, contents = completeGuide()): void {
  const destination = path.join(root, ...GUIDE.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents, "utf8");
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as Error & { readonly code: unknown }).code)
    : undefined;
}

test("audits only the exact repository-local regular guide and returns bounded metadata", () => {
  const root = temporaryRoot();
  try {
    const source = completeGuide();
    writeGuide(root, source);
    const result = audit.auditLocalGuide({ root });
    assert.deepEqual(Object.keys(result).sort(), ["pathToken", "sha256", "topicCount"]);
    assert.equal(result.pathToken, GUIDE);
    assert.equal(result.sha256, crypto.createHash("sha256").update(source).digest("hex"));
    assert.equal(result.topicCount, 13);
    assert.equal(JSON.stringify(result).includes(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fails safely for absent, empty, oversized, and incomplete local guides", () => {
  const root = temporaryRoot();
  try {
    assert.throws(
      () => audit.auditLocalGuide({ root }),
      (error: unknown) => errorCode(error) === "guide_not_found",
    );
    writeGuide(root, "");
    assert.throws(
      () => audit.auditLocalGuide({ root }),
      (error: unknown) => errorCode(error) === "guide_empty",
    );
    writeGuide(root, "x".repeat(256 * 1024 + 1));
    assert.throws(
      () => audit.auditLocalGuide({ root }),
      (error: unknown) => errorCode(error) === "guide_too_large",
    );
    writeGuide(root, completeGuide().replace("source_conflict", "source issue"));
    assert.throws(
      () => audit.auditLocalGuide({ root }),
      (error: unknown) =>
        errorCode(error) === "missing_topic_source_gate" &&
        !(error as Error).message.includes("source issue"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a symlink guide before reading when the platform permits link fixtures", (context) => {
  const root = temporaryRoot();
  const outside = temporaryRoot();
  try {
    const destination = path.join(root, ...GUIDE.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    writeGuide(outside);
    try {
      fs.symlinkSync(path.join(outside, ...GUIDE.split("/")), destination, "file");
    } catch (fileLinkError) {
      fs.rmSync(path.dirname(destination), { recursive: true, force: true });
      try {
        fs.symlinkSync(
          path.join(outside, "docs"),
          path.join(root, "docs"),
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch (directoryLinkError) {
        const fileCode = (fileLinkError as NodeJS.ErrnoException).code ?? "unknown";
        const directoryCode = (directoryLinkError as NodeJS.ErrnoException).code ?? "unknown";
        context.skip(`symlink unavailable: ${fileCode}/${directoryCode}`);
        return;
      }
    }
    assert.throws(
      () => audit.auditLocalGuide({ root }),
      (error: unknown) => errorCode(error) === "symlink_not_allowed",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("rejects special and ambiguous guide identities before reading", () => {
  const root = temporaryRoot();
  try {
    const destination = path.join(root, ...GUIDE.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.mkdirSync(destination);
    assert.throws(
      () => audit.auditLocalGuide({ root }),
      (error: unknown) => errorCode(error) === "special_file_not_allowed",
    );
    fs.rmSync(destination, { recursive: true });
    writeGuide(root);
    fs.writeFileSync(path.join(root, "MCP_QA_EXPERIENCE_GUIDE.md"), completeGuide(), "utf8");
    assert.throws(
      () => audit.auditLocalGuide({ root }),
      (error: unknown) => errorCode(error) === "ambiguous_guide",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("compiled CLI emits one secret-safe local result and rejects arguments", () => {
  const root = temporaryRoot();
  const entry = path.resolve("dist/maintainer/local-guide-audit.cjs");
  try {
    writeGuide(root);
    const success = require("node:child_process").spawnSync(
      process.execPath,
      [entry],
      { cwd: root, encoding: "utf8" },
    ) as import("node:child_process").SpawnSyncReturns<string>;
    assert.equal(success.status, 0, success.stderr);
    const payload = JSON.parse(success.stdout) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ["ok", "pathToken", "sha256", "topicCount"]);
    assert.equal(payload.ok, true);
    assert.equal(success.stdout.includes(root), false);

    const rejected = require("node:child_process").spawnSync(
      process.execPath,
      [entry, "--external"],
      { cwd: root, encoding: "utf8" },
    ) as import("node:child_process").SpawnSyncReturns<string>;
    assert.equal(rejected.status, 2);
    assert.deepEqual(JSON.parse(rejected.stderr), { ok: false, code: "unexpected_argument" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source, package inventory, and scripts contain no cross-repository guide coupling", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
    readonly files: readonly string[];
    readonly scripts: Readonly<Record<string, string>>;
  };
  assert.ok(packageJson.files.includes("docs/MCP_QA_EXPERIENCE_GUIDE.md"));
  assert.ok(packageJson.files.includes("dist/maintainer/local-guide-audit.cjs"));
  assert.equal(packageJson.files.some((member) => /sibling-guide-audit/i.test(member)), false);
  assert.equal(Object.hasOwn(packageJson.scripts, "test:sibling-guide-audit"), false);
  assert.equal(packageJson.scripts["guide:check"], "node dist/maintainer/local-guide-audit.cjs");
  assert.equal(
    packageJson.scripts["test:local-guide-audit"],
    "node --test dist-tests/maintainer/local-guide-audit.test.cjs",
  );

  const maintainerFiles = fs.readdirSync("src/maintainer").filter((name) => name.endsWith(".cts"));
  assert.equal(maintainerFiles.some((name) => /sibling-guide-audit/i.test(name)), false);
  const forbiddenIdentifiers = [
    "SiblingGuideAudit",
    "siblingGuidePath",
    "expectedGuideCommit",
    "expectedGuideDigest",
    "siblingRepoDigest",
  ];
  for (const file of maintainerFiles) {
    const source = fs.readFileSync(path.join("src/maintainer", file), "utf8");
    for (const identifier of forbiddenIdentifiers) {
      assert.equal(source.includes(identifier), false, `${file}: ${identifier}`);
    }
  }
});
