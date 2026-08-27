const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type FamilyId = "F001" | "F002" | "F003";
type Scope = "git_path" | "git_content" | "tar_path" | "tar_content";

interface AuditLimits {
  readonly maxArchiveBytes: number;
  readonly maxBlobBytes: number;
  readonly maxMemberBytes: number;
  readonly maxEntries: number;
  readonly maxPathBytes: number;
}

interface Finding {
  readonly code: string;
  readonly scope: Scope;
  readonly familyId: FamilyId;
  readonly category: "path" | "content";
  readonly pathToken: string;
  readonly placeholder: string;
  readonly componentIndex?: number;
  readonly componentCount?: number;
  readonly line?: number;
  readonly column?: number;
}

interface AuditResult {
  readonly ok: boolean;
  readonly findingCount: number;
  readonly findings: readonly Finding[];
}

interface GitAuditResult {
  readonly schemaVersion: 1;
  readonly scope: "git";
  readonly subject: string;
  readonly tree: string;
  readonly scannedCount: number;
  readonly findingCount: number;
  readonly findings: readonly Finding[];
}

interface PrivateFinding {
  readonly exactPath: string;
  readonly finding: Finding;
}

interface AuditModule {
  BrandAuditError: new (code: string) => Error & { readonly code: string };
  DEFAULT_BRAND_AUDIT_LIMITS: AuditLimits;
  foldBrandCandidate(input: unknown): string;
  decodeInspectableText(input: unknown, limits?: Partial<AuditLimits>): string;
  scanBrandText(input: unknown, options: {
    readonly scope: Scope;
    readonly exactPath: string;
    readonly limits?: Partial<AuditLimits>;
    readonly onPrivateFinding?: (finding: PrivateFinding) => void;
  }): AuditResult;
  scanGitTree(options: {
    readonly root: string;
    readonly subject: string;
    readonly include?: readonly string[];
    readonly limits?: Partial<AuditLimits>;
  }, dependencies?: {
    readonly runGit?: (root: string, args: readonly string[], input: Buffer | undefined, maxBuffer: number) => Buffer;
  }): GitAuditResult;
}

const audit = require("../../dist/maintainer/brand-audit.cjs") as AuditModule;
const repositoryRoot = path.resolve(__dirname, "../..");

function points(values: readonly number[]): string {
  return String.fromCodePoint(...values);
}

const FAMILIES: Readonly<Record<FamilyId, readonly (readonly number[])[]>> = Object.freeze({
  F001: Object.freeze([
    Object.freeze([0x6a, 0x78, 0x33]),
    Object.freeze([0x52_51, 0x7f_51, 0x33]),
    Object.freeze([0x52_51, 0x7f_51, 0x4e_09]),
    Object.freeze([0x6a, 0x69, 0x61, 0x6e, 0x77, 0x61, 0x6e, 0x67, 0x33]),
    Object.freeze([0x6a, 0x69, 0x00_e0, 0x6e, 0x77, 0x01_ce, 0x6e, 0x67, 0x33]),
    Object.freeze([0x6a, 0x78, 0x6f, 0x6e, 0x6c, 0x69, 0x6e, 0x65, 0x33]),
    Object.freeze([0x52_51, 0x4f_a0, 0x60_c5, 0x7f_18, 0x7f_51, 0x7e_dc, 0x72_48, 0x53_c1]),
  ]),
  F002: Object.freeze([
    Object.freeze([0x6b, 0x69, 0x6e, 0x67, 0x73, 0x6f, 0x66, 0x74]),
    Object.freeze([0x91_d1, 0x5c_71]),
    Object.freeze([0x91_d1, 0x5c_71, 0x8f_6f, 0x4e_f6]),
  ]),
  F003: Object.freeze([
    Object.freeze([0x73, 0x65, 0x61, 0x73, 0x75, 0x6e]),
    Object.freeze([0x89_7f, 0x5c_71, 0x5c_45]),
  ]),
});

function firstAlias(familyId: FamilyId): string {
  return points(FAMILIES[familyId][0]!);
}

function expectCode(call: () => unknown, code: string): void {
  assert.throws(call, (error: unknown) =>
    error instanceof Error && "code" in error && (error as Error & { code: string }).code === code);
}

function contentScan(input: unknown, exactPath = "src/neutral.cts", limits?: Partial<AuditLimits>): AuditResult {
  return audit.scanBrandText(input, {
    scope: "git_content",
    exactPath,
    ...(limits === undefined ? {} : { limits }),
  });
}

function encodeBigEndian(value: string): Buffer {
  const little = Buffer.from(value, "utf16le");
  for (let index = 0; index < little.length; index += 2) {
    const first = little[index]!;
    little[index] = little[index + 1]!;
    little[index + 1] = first;
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), little]);
}

function git(root: string, args: readonly string[]): string {
  return childProcess.execFileSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createGitFixture(files: Readonly<Record<string, string>>): {
  readonly root: string;
  readonly subject: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-brand-git-"));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  for (const [relativePath, body] of Object.entries(files)) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, body, "utf8");
  }
  git(root, ["add", "--", ...Object.keys(files)]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return Object.freeze({ root, subject: git(root, ["rev-parse", "HEAD"]) });
}

test("matcher recognizes only the approved closed families after deterministic folding", () => {
  for (const [familyId, aliases] of Object.entries(FAMILIES) as [FamilyId, readonly (readonly number[])[]][]) {
    for (const aliasPoints of aliases) {
      const alias = points(aliasPoints);
      const result = contentScan(`prefix ${alias} suffix`);
      assert.equal(result.ok, false);
      assert.ok(result.findings.some((finding) => finding.familyId === familyId));
    }
  }

  const upper = firstAlias("F002").toUpperCase();
  assert.equal(contentScan(upper).findings[0]?.familyId, "F002");

  const separated = Array.from(firstAlias("F003")).join("\u2010_\u3000");
  assert.equal(contentScan(separated).findings[0]?.familyId, "F003");

  const fullWidth = Array.from(firstAlias("F001"), (character) => {
    const code = character.codePointAt(0)!;
    return code >= 0x21 && code <= 0x7e ? String.fromCodePoint(code + 0xfe_e0) : character;
  }).join("");
  assert.equal(contentScan(fullWidth).findings[0]?.familyId, "F001");

  const decomposed = points(FAMILIES.F001[4]!).normalize("NFD");
  assert.equal(contentScan(decomposed).findings[0]?.familyId, "F001");
});

test("matcher keeps approved product, host, and technical controls negative", () => {
  const controls = [
    "KCodeRag",
    "kcoderag-nav",
    "Codex Claude Code Cursor OpenCode ZCode",
    "PreToolUse PostToolUse MCP Node.js TypeScript C++ Lua",
    "https://example.invalid/project/path",
  ];
  for (const control of controls) {
    assert.deepEqual(contentScan(control), { ok: true, findingCount: 0, findings: [] });
  }

  const splitAcrossComponents = `${points([0x6a])}/${points([0x78, 0x33])}/file.cts`;
  assert.deepEqual(audit.scanBrandText(splitAcrossComponents, {
    scope: "git_path",
    exactPath: splitAcrossComponents,
  }), { ok: true, findingCount: 0, findings: [] });
});

test("decoder accepts strict supported text encodings and empty input", () => {
  const value = "neutral text \u4e2d\u6587";
  assert.equal(audit.decodeInspectableText(value), value);
  assert.equal(audit.decodeInspectableText(Buffer.from(value, "utf8")), value);
  assert.equal(audit.decodeInspectableText(Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(value, "utf8"),
  ])), value);
  assert.equal(audit.decodeInspectableText(Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(value, "utf16le"),
  ])), value);
  assert.equal(audit.decodeInspectableText(encodeBigEndian(value)), value);
  assert.equal(audit.decodeInspectableText(""), "");
  assert.equal(audit.decodeInspectableText(Buffer.alloc(0)), "");
  assert.deepEqual(contentScan(""), { ok: true, findingCount: 0, findings: [] });
  assert.deepEqual(contentScan(Buffer.alloc(0)), { ok: true, findingCount: 0, findings: [] });
});

test("decoder and matcher fail closed on invalid, malformed, binary, ambiguous, and oversized input", () => {
  for (const value of [null, undefined, 42, {}, []]) {
    expectCode(() => audit.decodeInspectableText(value), "invalid_audit_input");
  }
  expectCode(() => audit.decodeInspectableText(Buffer.from([0xc3, 0x28])), "malformed_text_encoding");
  expectCode(() => audit.decodeInspectableText(Buffer.from([0xff, 0xfe, 0x61])), "malformed_text_encoding");
  expectCode(() => audit.decodeInspectableText(Buffer.from([0x61, 0x00])), "binary_audit_input");
  expectCode(
    () => audit.decodeInspectableText(Buffer.from([0xef, 0xbb, 0xbf, 0xff, 0xfe])),
    "ambiguous_text_encoding",
  );
  expectCode(
    () => audit.decodeInspectableText(Buffer.from("12345", "utf8"), { maxBlobBytes: 4 }),
    "audit_input_too_large",
  );
  expectCode(
    () => contentScan("neutral", "src/long-name.cts", { maxPathBytes: 4 }),
    "audit_path_too_large",
  );
});

test("self-match scan finds no family in source, compiled core, fixture, or diagnostics", () => {
  const inspected = [
    "src/maintainer/brand-audit.cts",
    "tests/maintainer/brand-audit.test.cts",
    "dist/maintainer/brand-audit.cjs",
    "dist-tests/maintainer/brand-audit.test.cjs",
  ];
  for (const relativePath of inspected) {
    const bytes = fs.readFileSync(path.join(repositoryRoot, ...relativePath.split("/")));
    assert.deepEqual(contentScan(bytes, relativePath), { ok: true, findingCount: 0, findings: [] });
  }

  const diagnosticValues = [
    audit.DEFAULT_BRAND_AUDIT_LIMITS,
    new audit.BrandAuditError("invalid_audit_input"),
  ];
  assert.deepEqual(contentScan(JSON.stringify(diagnosticValues)), { ok: true, findingCount: 0, findings: [] });
});

test("safe diagnostic findings expose exact metadata keys without raw path or content", () => {
  const alias = firstAlias("F001");
  const secretCanary = points([0x73, 0x65, 0x63, 0x72, 0x65, 0x74, 0x2d, 0x63, 0x61, 0x6e, 0x61, 0x72, 0x79]);
  const matchingComponent = `${alias}-${secretCanary}`;
  const exactPath = `private/${matchingComponent}/config.json`;
  const pathResult = audit.scanBrandText(exactPath, { scope: "tar_path", exactPath });
  assert.equal(pathResult.findingCount, 1);
  assert.deepEqual(Object.keys(pathResult.findings[0]!).sort(), [
    "category",
    "code",
    "componentCount",
    "componentIndex",
    "familyId",
    "pathToken",
    "placeholder",
    "scope",
  ]);
  assert.deepEqual(pathResult.findings[0], {
    code: "brand_family_detected",
    scope: "tar_path",
    familyId: "F001",
    category: "path",
    pathToken: pathResult.findings[0]!.pathToken,
    placeholder: "<F001>",
    componentIndex: 2,
    componentCount: 3,
  });
  assert.match(pathResult.findings[0]!.pathToken, /^[0-9a-f]{64}$/u);

  const contentResult = contentScan(`line one\n${alias} ${secretCanary}`, exactPath);
  assert.deepEqual(Object.keys(contentResult.findings[0]!).sort(), [
    "category",
    "code",
    "column",
    "familyId",
    "line",
    "pathToken",
    "placeholder",
    "scope",
  ]);
  assert.equal(contentResult.findings[0]!.line, 2);
  assert.equal(contentResult.findings[0]!.column, 1);

  for (const serialized of [JSON.stringify(pathResult), JSON.stringify(contentResult)]) {
    assert.equal(serialized.includes(exactPath), false);
    assert.equal(serialized.includes(matchingComponent), false);
    assert.equal(serialized.includes(alias), false);
    assert.equal(serialized.includes(secretCanary), false);
  }
});

test("private remediation receives the validated path without making it serializable", () => {
  const alias = firstAlias("F002");
  const exactPath = "private/remediation/source.cts";
  const privateFindings: PrivateFinding[] = [];
  const result = audit.scanBrandText(`prefix ${alias} suffix`, {
    scope: "git_content",
    exactPath,
    onPrivateFinding: (finding) => privateFindings.push(finding),
  });

  assert.equal(privateFindings.length, 1);
  assert.equal(privateFindings[0]!.exactPath, exactPath);
  assert.strictEqual(privateFindings[0]!.finding, result.findings[0]);
  assert.equal(JSON.stringify(privateFindings[0]).includes(exactPath), false);
  assert.equal(JSON.stringify(result).includes(exactPath), false);
  assert.deepEqual(Object.keys(result).sort(), ["findingCount", "findings", "ok"]);
});

test("secret canary and callback failures collapse to one stable public error", () => {
  const alias = firstAlias("F003");
  const secretCanary = points([0x70, 0x72, 0x69, 0x76, 0x61, 0x74, 0x65, 0x2d, 0x76, 0x61, 0x6c, 0x75, 0x65]);
  const exactPath = `private/${secretCanary}/source.lua`;
  let captured: unknown;
  try {
    audit.scanBrandText(alias, {
      scope: "tar_content",
      exactPath,
      onPrivateFinding: () => {
        throw new Error(`${exactPath}:${alias}:${secretCanary}`);
      },
    });
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof Error);
  assert.equal((captured as Error & { code?: string }).code, "private_remediation_failed");
  const serialized = JSON.stringify({
    name: (captured as Error).name,
    message: (captured as Error).message,
    code: (captured as Error & { code?: string }).code,
  });
  assert.equal(serialized.includes(exactPath), false);
  assert.equal(serialized.includes(alias), false);
  assert.equal(serialized.includes(secretCanary), false);

  expectCode(() => audit.scanBrandText(alias, {
    scope: "git_content",
    exactPath,
    onPrivateFinding: 42 as unknown as (finding: PrivateFinding) => void,
  }), "invalid_audit_options");
});

test("Git scan is commit-exact, uses one batch, and ignores dirty worktree canaries", () => {
  const fixture = createGitFixture({
    "src/neutral.cts": "export const value = 'neutral';\n",
    "docs/readme.md": "neutral\n",
  });
  try {
    const initial = audit.scanGitTree({ root: fixture.root, subject: fixture.subject });
    assert.deepEqual(Object.keys(initial).sort(), [
      "findingCount", "findings", "scannedCount", "schemaVersion", "scope", "subject", "tree",
    ]);
    assert.equal(initial.scope, "git");
    assert.equal(initial.subject, fixture.subject);
    assert.match(initial.tree, /^[0-9a-f]{40}$/u);
    assert.equal(initial.scannedCount, 2);
    assert.equal(initial.findingCount, 0);

    const dirtyAlias = firstAlias("F001");
    fs.writeFileSync(path.join(fixture.root, "src", "neutral.cts"), dirtyAlias, "utf8");
    fs.writeFileSync(path.join(fixture.root, `untracked-${dirtyAlias}.txt`), dirtyAlias, "utf8");
    assert.deepEqual(audit.scanGitTree({ root: fixture.root, subject: fixture.subject }), initial);

    const included = audit.scanGitTree({
      root: fixture.root,
      subject: fixture.subject,
      include: ["src"],
    });
    assert.equal(included.scannedCount, 1);
    assert.equal(included.findingCount, 0);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Git scan rejects unsupported entries, malformed records, and oversized blobs", () => {
  const fixture = createGitFixture({ "src/base.cts": "neutral\n" });
  try {
    const blob = git(fixture.root, ["hash-object", "src/base.cts"]);
    git(fixture.root, ["update-index", "--add", "--cacheinfo", `120000,${blob},link-entry`]);
    git(fixture.root, ["commit", "--quiet", "-m", "link"]);
    const linkSubject = git(fixture.root, ["rev-parse", "HEAD"]);
    expectCode(
      () => audit.scanGitTree({ root: fixture.root, subject: linkSubject }),
      "unsupported_git_entry",
    );

    git(fixture.root, ["update-index", "--force-remove", "link-entry"]);
    git(fixture.root, ["update-index", "--add", "--cacheinfo", `160000,${fixture.subject},nested-repository`]);
    git(fixture.root, ["commit", "--quiet", "-m", "nested"]);
    expectCode(
      () => audit.scanGitTree({ root: fixture.root, subject: git(fixture.root, ["rev-parse", "HEAD"]) }),
      "unsupported_git_entry",
    );

    expectCode(
      () => audit.scanGitTree({
        root: fixture.root,
        subject: fixture.subject,
        limits: { maxBlobBytes: 4 },
      }),
      "git_blob_too_large",
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }

  const oid = "1".repeat(40);
  const tree = "2".repeat(40);
  const fakeGit = (_root: string, args: readonly string[]): Buffer => {
    if (args[0] === "rev-parse" && args[2]?.endsWith("^{commit}")) return Buffer.from(`${oid}\n`);
    if (args[0] === "rev-parse") return Buffer.from(`${tree}\n`);
    if (args[0] === "ls-tree") return Buffer.from("malformed-record\0", "utf8");
    throw new Error("unexpected fixture command");
  };
  expectCode(
    () => audit.scanGitTree({ root: repositoryRoot, subject: oid }, { runGit: fakeGit }),
    "invalid_git_tree_record",
  );
});

test("CLI emits one safe JSON document for findings, success, and argument errors", () => {
  const alias = firstAlias("F002");
  const secretCanary = points([0x63, 0x6c, 0x69, 0x2d, 0x73, 0x65, 0x63, 0x72, 0x65, 0x74]);
  const exactPath = `private/${alias}-${secretCanary}.md`;
  const fixture = createGitFixture({
    [exactPath]: `prefix ${alias} ${secretCanary} suffix\n`,
    "src/neutral.cts": "neutral\n",
  });
  const cli = path.join(repositoryRoot, "dist", "maintainer", "brand-audit.cjs");
  try {
    const finding = childProcess.spawnSync(process.execPath, [cli, "git", "--subject", fixture.subject], {
      cwd: fixture.root,
      encoding: "utf8",
    });
    assert.equal(finding.status, 1);
    assert.equal(finding.stderr, "");
    assert.equal(finding.stdout.trim().split(/\r?\n/u).length, 1);
    const findingResult = JSON.parse(finding.stdout) as GitAuditResult;
    assert.deepEqual(Object.keys(findingResult).sort(), [
      "findingCount", "findings", "scannedCount", "schemaVersion", "scope", "subject", "tree",
    ]);
    assert.equal(findingResult.findingCount, 2);
    assert.equal(finding.stdout.includes(exactPath), false);
    assert.equal(finding.stdout.includes(alias), false);
    assert.equal(finding.stdout.includes(secretCanary), false);

    const success = childProcess.spawnSync(process.execPath, [
      cli, "git", "--subject", fixture.subject, "--include", "src",
    ], { cwd: fixture.root, encoding: "utf8" });
    assert.equal(success.status, 0);
    assert.equal((JSON.parse(success.stdout) as GitAuditResult).findingCount, 0);

    const invalid = childProcess.spawnSync(process.execPath, [cli, "git", "--subject", secretCanary], {
      cwd: fixture.root,
      encoding: "utf8",
    });
    assert.equal(invalid.status, 2);
    assert.equal(invalid.stderr, "");
    assert.equal(invalid.stdout.trim().split(/\r?\n/u).length, 1);
    assert.deepEqual(JSON.parse(invalid.stdout), {
      schemaVersion: 1,
      scope: "git",
      ok: false,
      code: "invalid_git_subject",
    });
    assert.equal(invalid.stdout.includes(secretCanary), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
