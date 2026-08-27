const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type SourceScanMode = "fast" | "deep" | "gate";

interface SourceFindingInput {
  readonly code: string;
  readonly severity: "info" | "conflict";
  readonly sourceType: string;
  readonly scope: "project" | "user";
  readonly safePath: string;
}

interface SourceFindingRecord extends SourceFindingInput {}

interface SourceScanResultRecord {
  readonly mode: SourceScanMode;
  readonly findings: readonly SourceFindingRecord[];
  readonly hasConflict: boolean;
}

interface UserSourcesModule {
  readonly SOURCE_SCAN_MODES: readonly string[];
  readonly MAX_NATIVE_SOURCE_BYTES: number;
  readonly createNativeCleanupPlan?: unknown;
  readonly runOwnedSourceCleanup?: unknown;
  readonly cleanupOwnedSource?: unknown;
  createSourceFinding(input: SourceFindingInput): Readonly<SourceFindingRecord>;
  createSourceScanResult(
    mode: SourceScanMode,
    findings: readonly SourceFindingRecord[],
  ): Readonly<SourceScanResultRecord>;
  inspectNativeJsonSource(homeDirectory: string, relativePath: string): Readonly<Record<string, boolean>>;
}

const sources = require("../../dist/hosts/user-sources.cjs") as UserSourcesModule;

const SENTINELS = Object.freeze([
  "https://qa.invalid/mcp?credential=sentinel",
  "Authorization",
  "Bearer sentinel-secret",
  "sentinel subprocess body",
]);

test("source findings are immutable metadata-only records in deterministic code-unit order", () => {
  assert.deepEqual(sources.SOURCE_SCAN_MODES, ["fast", "deep", "gate"]);
  assert.equal(sources.createNativeCleanupPlan, undefined);
  assert.equal(sources.runOwnedSourceCleanup, undefined);
  assert.equal(sources.cleanupOwnedSource, undefined);

  const findings: readonly SourceFindingRecord[] = [
    sources.createSourceFinding({
      code: "manual_hook_source",
      severity: "conflict",
      sourceType: "manual_hook",
      scope: "user",
      safePath: ".codex/z-hook",
    }),
    sources.createSourceFinding({
      code: "owned_marketplace_source",
      severity: "conflict",
      sourceType: "owned_marketplace_registration",
      scope: "user",
      safePath: ".codex/A-marketplace",
    }),
  ];
  for (const mode of sources.SOURCE_SCAN_MODES as readonly SourceScanMode[]) {
    const result = sources.createSourceScanResult(mode, findings);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.findings), true);
    assert.equal(Object.isFrozen(result.findings[0]), true);
    assert.deepEqual(Object.keys(result).sort(), ["findings", "hasConflict", "mode"]);
    assert.deepEqual(result.findings.map((finding) => finding.safePath), [
      ".codex/A-marketplace",
      ".codex/z-hook",
    ]);
    for (const finding of result.findings) {
      assert.equal(typeof finding.safePath, "string");
      assert.deepEqual(Object.keys(finding).sort(), [
        "code",
        "safePath",
        "scope",
        "severity",
        "sourceType",
      ]);
    }
    assert.equal("cleanupPlans" in result, false);
    assert.equal(result.hasConflict, true);
  }
});

test("source finding inputs cannot smuggle retired cleanup authority into output", () => {
  const retiredInput = {
    code: "owned_plugin_source",
    severity: "conflict" as const,
    sourceType: "owned_plugin",
    scope: "user" as const,
    safePath: ".codex/plugins",
    cleanupEligible: true,
    cleanupCommand: "codex plugin remove kcoderag-nav",
    cleanupFingerprint: `sha256:${"0".repeat(64)}`,
  };
  const finding = sources.createSourceFinding(retiredInput);
  assert.equal("cleanupEligible" in finding, false);
  assert.equal("cleanupCommand" in finding, false);
  assert.equal("cleanupFingerprint" in finding, false);
});

test("source finding severity and informational type policy fail closed", () => {
  for (const input of [
    {
      code: "raw_mcp_source",
      severity: "info",
      sourceType: "raw_mcp",
      scope: "user",
      safePath: ".codex/config.toml",
    },
    {
      code: "cache_residue",
      severity: "conflict",
      sourceType: "cache_residue",
      scope: "user",
      safePath: ".codex/plugins/cache/kcoderag-nav",
    },
  ] as const) {
    assert.throws(
      () => sources.createSourceFinding(input),
      (error: unknown) => (error as { readonly code?: string }).code === "invalid_source_finding",
    );
  }
});

test("source serialization rejects secret-like paths without echoing them", () => {
  for (const sentinel of SENTINELS) {
    assert.throws(
      () => sources.createSourceFinding({
        code: "raw_mcp_source",
        severity: "conflict",
        sourceType: "raw_mcp",
        scope: "user",
        safePath: sentinel,
      }),
      (error: unknown) => {
        assert.equal(JSON.stringify(error).includes(sentinel), false);
        return (error as { readonly code?: string }).code === "invalid_source_finding";
      },
    );
  }
});

test("native JSON reader ignores credential values and inspects only registration identity", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-secret-opaque-source-"));
  const relativePath = ".claude/settings.json";
  const absolutePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const credentialCanaries = {
    url: "https://kcoderag.invalid/private/mcp",
    headers: { Authorization: "Bearer kcoderag-nav-secret" },
    token: "kcoderag-nav-token",
    body: "kcoderag-nav full subprocess body",
  };
  fs.writeFileSync(absolutePath, JSON.stringify({
    mcpServers: { unrelated: credentialCanaries },
    hooks: { PreToolUse: [{ url: credentialCanaries.url, headers: credentialCanaries.headers, body: credentialCanaries.body }] },
    plugins: [{ id: "unrelated", ...credentialCanaries }],
  }));
  try {
    assert.deepEqual(sources.inspectNativeJsonSource(root, relativePath), {
      exists: true,
      rawMcp: false,
      manualHook: false,
      activePlugin: false,
      ambiguous: false,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native JSON reader bounds bytes and refuses to follow links", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-bounded-source-"));
  const relativePath = ".claude/settings.json";
  const absolutePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  try {
    fs.writeFileSync(absolutePath, "x".repeat(sources.MAX_NATIVE_SOURCE_BYTES + 1));
    assert.deepEqual(sources.inspectNativeJsonSource(root, relativePath), {
      exists: true,
      rawMcp: false,
      manualHook: false,
      activePlugin: false,
      ambiguous: true,
    });

    const outside = path.join(root, "outside.json");
    fs.writeFileSync(outside, JSON.stringify({ mcpServers: { kcoderag: {} } }));
    fs.rmSync(absolutePath);
    try {
      fs.symlinkSync(outside, absolutePath, "file");
      assert.deepEqual(sources.inspectNativeJsonSource(root, relativePath), {
        exists: true,
        rawMcp: false,
        manualHook: false,
        activePlugin: false,
        ambiguous: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
