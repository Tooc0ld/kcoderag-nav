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
  }): {
    readonly ok: boolean;
    readonly changedPaths: readonly string[];
    readonly writtenPaths: readonly string[];
  };
  checkGenerated(options: {
    readonly package: "cursor";
    readonly group: "all";
    readonly sourceRoot: string;
    readonly outputRoot: string;
  }): {
    readonly ok: boolean;
    readonly changedPaths: readonly string[];
    readonly writtenPaths: readonly string[];
  };
}

interface CursorManifest {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly mcpServers?: string;
  readonly rules?: string;
  readonly skills?: string;
}

interface MemberEvidence {
  readonly member: string;
  readonly size: number;
  readonly sha256: string;
}

interface CursorEvidence {
  readonly members: readonly MemberEvidence[];
  readonly version: string;
  readonly qaOnly: boolean;
  readonly ruleBoundary: boolean;
  readonly referencesResolve: boolean;
}

const repositoryRoot = path.resolve(__dirname, "../..");
const generator = require("../../dist/generator/index.cjs") as GeneratorModule;
const cursor = require("../../dist/hosts/cursor.cjs") as Record<string, any>;
const projectTarget = require("../../dist/core/project-target.cjs") as Record<string, any>;
const transaction = require("../../dist/core/transaction.cjs") as Record<string, any>;
const NAVIGATION = "kcoderag-navigation";
const CODE_STYLE = "code-style-nudge";
const STYLE_SKILL_ROOT = "skills/code-style-correction";
const EXPECTED_NON_DOCUMENT = Object.freeze([
  ".cursor-plugin/plugin.json",
  "mcp.json",
  "rules/kcoderag-navigation.mdc",
  "skills/code-lookup-discipline/SKILL.md",
  `${STYLE_SKILL_ROOT}/SKILL.md`,
  `${STYLE_SKILL_ROOT}/references/change-hygiene-self-review.md`,
  `${STYLE_SKILL_ROOT}/references/cpp-lifetime-control-flow.md`,
  `${STYLE_SKILL_ROOT}/references/lua-contracts.md`,
  `${STYLE_SKILL_ROOT}/references/protocol-serialization-data.md`,
]);
const CANONICAL_STYLE_MEMBERS = Object.freeze([
  ["SKILL.md", "SKILL.md"],
  ["references/change-hygiene-self-review.md", "references/change-hygiene-self-review.md"],
  ["references/cpp-lifetime-control-flow.md", "references/cpp-lifetime-control-flow.md"],
  ["references/lua-contracts.md", "references/lua-contracts.md"],
  ["references/protocol-serialization-data.md", "references/protocol-serialization-data.md"],
] as const);

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

function fail(code: string): never {
  throw new Error(code);
}

function productPath(root: string, member: string): string {
  return path.join(root, ...member.split("/"));
}

function formerStyleRoot(): string {
  return `skills/${String.fromCharCode(106, 120, 51)}-code-style-correction`;
}

function snapshotTree(root: string): readonly string[] {
  if (!fs.existsSync(root)) return Object.freeze([]);
  return Object.freeze(filesBelow(root).map((member) => {
    const absolute = productPath(root, member);
    const metadata = fs.statSync(absolute);
    return `${member}:${metadata.size}:${metadata.mtimeMs}:${sha256(absolute)}`;
  }));
}

function safeReference(root: string, reference: string, expected: "file" | "directory"): boolean {
  if (!/^\.\/[A-Za-z0-9._/-]+$/u.test(reference)) return false;
  const resolved = path.resolve(root, reference);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return false;
  }
  try {
    const stat = fs.lstatSync(resolved);
    return expected === "file" ? stat.isFile() : stat.isDirectory();
  } catch {
    return false;
  }
}

function inspectCursorProduct(root: string, expectedVersion: string): CursorEvidence {
  const members = filesBelow(root).filter((member) => member !== "README.md");
  if (JSON.stringify(members) !== JSON.stringify(EXPECTED_NON_DOCUMENT)) fail("closed_inventory");

  const manifest = JSON.parse(fs.readFileSync(productPath(root, ".cursor-plugin/plugin.json"), "utf8")) as CursorManifest;
  if (manifest.name !== "kcoderag-nav" || manifest.version !== expectedVersion) fail("version_identity");
  if (manifest.mcpServers !== "./mcp.json" || manifest.rules !== "./rules/" || manifest.skills !== "./skills/") {
    fail("manifest_reference");
  }
  const referencesResolve = safeReference(root, manifest.mcpServers, "file")
    && safeReference(root, manifest.rules, "directory")
    && safeReference(root, manifest.skills, "directory");
  if (!referencesResolve) fail("reference_resolution");

  const activeText = [
    "rules/kcoderag-navigation.mdc",
    "skills/code-lookup-discipline/SKILL.md",
  ].map((member) => fs.readFileSync(productPath(root, member), "utf8")).join("\n");
  const qaOnly = /QA/u.test(`${manifest.description ?? ""}\n${activeText}`)
    && !/kcoderag-dev|--environment\s+dev/iu.test(activeText);
  if (!qaOnly) fail("qa_only_boundary");
  const ruleBoundary = /Rule|alwaysApply/u.test(activeText)
    && !/PreToolUse|Hook[- ]equivalent|native pre[- ]write/iu.test(activeText);
  if (!ruleBoundary) fail("rule_capability_boundary");

  return Object.freeze({
    members: Object.freeze(EXPECTED_NON_DOCUMENT.map((member) => Object.freeze({
      member,
      size: fs.statSync(productPath(root, member)).size,
      sha256: sha256(productPath(root, member)),
    }))),
    version: manifest.version,
    qaOnly,
    ruleBoundary,
    referencesResolve,
  });
}

function assertEvidenceSafe(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("unsafe_evidence");
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([
    "members",
    "qaOnly",
    "referencesResolve",
    "ruleBoundary",
    "version",
  ])) fail("unsafe_evidence");
  if (!Array.isArray(record.members)) fail("unsafe_evidence");
  for (const item of record.members) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) fail("unsafe_evidence");
    const member = item as Record<string, unknown>;
    if (JSON.stringify(Object.keys(member).sort()) !== JSON.stringify(["member", "sha256", "size"])) {
      fail("unsafe_evidence");
    }
    if (typeof member.member !== "string" || !EXPECTED_NON_DOCUMENT.includes(member.member)) fail("unsafe_evidence");
    if (typeof member.size !== "number" || !Number.isSafeInteger(member.size) || member.size < 0) fail("unsafe_evidence");
    if (typeof member.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(member.sha256)) fail("unsafe_evidence");
  }
  if (typeof record.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(record.version)) fail("unsafe_evidence");
  for (const field of ["qaOnly", "ruleBoundary", "referencesResolve"] as const) {
    if (typeof record[field] !== "boolean") fail("unsafe_evidence");
  }
}

function generateCursorFixture(): { readonly root: string; readonly productRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-product-"));
  const generated = generator.generatePackage({
    package: "cursor",
    group: "all",
    sourceRoot: repositoryRoot,
    outputRoot: root,
  });
  if (!generated.ok) {
    fs.rmSync(root, { recursive: true, force: true });
    fail("fixture_generation");
  }
  return Object.freeze({ root, productRoot: path.join(root, "kcoderag-cursor") });
}

test("Cursor non-document product is a closed deterministic nine-file inventory", () => {
  const cursorRoot = path.join(repositoryRoot, "kcoderag-cursor");
  const packageVersion = (JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    version: string;
  }).version;
  const repositoryEvidence = inspectCursorProduct(cursorRoot, packageVersion);
  assertEvidenceSafe(repositoryEvidence);
  assert.equal(fs.existsSync(productPath(cursorRoot, formerStyleRoot())), false);

  const fixture = generateCursorFixture();
  try {
    const fixtureEvidence = inspectCursorProduct(fixture.productRoot, packageVersion);
    assertEvidenceSafe(fixtureEvidence);
    assert.deepEqual(fixtureEvidence, repositoryEvidence);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Cursor five-file style Skill is byte-equal to the canonical Markdown family", () => {
  const cursorRoot = path.join(repositoryRoot, "kcoderag-cursor");
  const canonicalRoot = path.join(repositoryRoot, "plugin-src/capabilities/code-style-nudge/skill");
  for (const [generated, canonical] of CANONICAL_STYLE_MEMBERS) {
    assert.deepEqual(
      fs.readFileSync(productPath(cursorRoot, `${STYLE_SKILL_ROOT}/${generated}`)),
      fs.readFileSync(productPath(canonicalRoot, canonical)),
      generated,
    );
  }
});

test("Cursor scoped materialization is a deterministic no-op after the canonical projection", () => {
  const fixture = generateCursorFixture();
  try {
    const result = generator.checkGenerated({
      package: "cursor",
      group: "all",
      sourceRoot: repositoryRoot,
      outputRoot: fixture.root,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.changedPaths, []);
    assert.deepEqual(result.writtenPaths, []);
    assert.equal(fs.existsSync(productPath(fixture.productRoot, formerStyleRoot())), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Cursor style asset presence does not grant support or reach a transaction", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-cursor-style-boundary-"));
  try {
    const target = projectTarget.resolveProjectTarget(root);
    const adapter = cursor.createCursorAdapter({ hostVersion: "3.17.8", evidenceRoot: repositoryRoot });
    await transaction.applyTransaction(adapter.renderInstall({
      target,
      packageRoot: repositoryRoot,
      command: "install",
      environment: "qa",
      observation: adapter.detect({ target, packageRoot: repositoryRoot }),
      selectedCapabilities: [NAVIGATION],
    }));
    const before = snapshotTree(path.join(root, ".cursor"));
    let renderAttempts = 0;
    let transactionCalls = 0;
    const renderAndApply = async (): Promise<void> => {
      renderAttempts += 1;
      const desired = adapter.renderInstall({
        target,
        packageRoot: repositoryRoot,
        command: "install",
        environment: "qa",
        observation: adapter.detect({ target, packageRoot: repositoryRoot }),
        selectedCapabilities: [CODE_STYLE],
      });
      transactionCalls += 1;
      await transaction.applyTransaction(desired);
    };

    await assert.rejects(renderAndApply(), (error: any) => error?.code === "host_version_unsupported");
    assert.equal(renderAttempts, 1);
    assert.equal(transactionCalls, 0);
    assert.deepEqual(snapshotTree(path.join(root, ".cursor")), before);
    const installed = adapter.detect({ target, packageRoot: repositoryRoot }).currentState;
    assert.deepEqual(installed?.capabilities.map((entry: any) => entry.id), [NAVIGATION]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Cursor keeps the QA Rule, skill, and MCP capability boundary", () => {
  const packageVersion = (JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    version: string;
  }).version;
  const evidence = inspectCursorProduct(path.join(repositoryRoot, "kcoderag-cursor"), packageVersion);
  assert.equal(evidence.qaOnly, true);
  assert.equal(evidence.ruleBoundary, true);
  assert.equal(evidence.referencesResolve, true);
});

test("Cursor product rejects missing or extra members with stable metadata-only failures", () => {
  const packageVersion = (JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    version: string;
  }).version;
  for (const mutation of ["missing", "extra"] as const) {
    const fixture = generateCursorFixture();
    try {
      if (mutation === "missing") fs.rmSync(productPath(fixture.productRoot, "mcp.json"));
      if (mutation === "extra") fs.writeFileSync(productPath(fixture.productRoot, "unexpected.txt"), "fixture\n");
      assert.throws(() => inspectCursorProduct(fixture.productRoot, packageVersion), /^Error: closed_inventory$/u);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("Cursor product rejects Dev and Hook-equivalence wording deterministically", () => {
  const packageVersion = (JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    version: string;
  }).version;
  const fixtures = [
    { member: "rules/kcoderag-navigation.mdc", text: "\nInstall kcoderag-dev.\n", code: "qa_only_boundary" },
    { member: "skills/code-lookup-discipline/SKILL.md", text: "\nPreToolUse Hook-equivalent.\n", code: "rule_capability_boundary" },
    { member: "skills/code-lookup-discipline/SKILL.md", text: "\nNative pre-write context.\n", code: "rule_capability_boundary" },
  ] as const;
  for (const mutation of fixtures) {
    const fixture = generateCursorFixture();
    try {
      fs.appendFileSync(productPath(fixture.productRoot, mutation.member), mutation.text);
      assert.throws(
        () => inspectCursorProduct(fixture.productRoot, packageVersion),
        new RegExp(`^Error: ${mutation.code}$`, "u"),
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("Cursor evidence schema rejects any content-bearing field", () => {
  const packageVersion = (JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    version: string;
  }).version;
  const evidence = inspectCursorProduct(path.join(repositoryRoot, "kcoderag-cursor"), packageVersion);
  assertEvidenceSafe(evidence);
  assert.throws(
    () => assertEvidenceSafe({ ...evidence, contents: "SENSITIVE-CURSOR-FIXTURE" }),
    /^Error: unsafe_evidence$/u,
  );
});
