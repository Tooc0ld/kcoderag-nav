const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

interface Jx3NudgeModule {
  readonly JX3_NUDGE: string;
  readonly JX3_SOURCE_EXTENSIONS: readonly string[];
  isJx3SourcePath(value: unknown): boolean;
  structuredMutationPaths(payload: unknown): readonly string[];
  jx3StyleContribution(payload: unknown, options?: {
    readonly host: "claude";
    readonly managedRoot: string;
    readonly cacheRoot: string;
    readonly statePath?: string;
  }): string | undefined;
  evaluateJx3Integrity(options: {
    readonly host: "claude";
    readonly managedRoot: string;
    readonly statePath?: string;
  }): {
    readonly ok: boolean;
    readonly finding?: { readonly code: "capability_drift"; readonly path: string };
  };
}

const jx3 = require("../../dist/hooks/jx3-style-nudge.cjs") as Jx3NudgeModule;
const installState = require("../../dist/core/state.cjs") as {
  createInstallState(input: Record<string, unknown>): Record<string, unknown>;
};

const allowedExtensions = [
  ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".inl", ".ipp", ".lua",
] as const;

const integrityAssets = [
  [".claude/skills/jx3-code-style-correction/SKILL.md", "plugin-src/capabilities/jx3-style-nudge/skill/SKILL.md"],
  [".claude/skills/jx3-code-style-correction/references/cpp-lifetime-control-flow.md", "plugin-src/capabilities/jx3-style-nudge/skill/references/cpp-lifetime-control-flow.md"],
  [".claude/skills/jx3-code-style-correction/references/protocol-serialization-data.md", "plugin-src/capabilities/jx3-style-nudge/skill/references/protocol-serialization-data.md"],
  [".claude/skills/jx3-code-style-correction/references/lua-contracts.md", "plugin-src/capabilities/jx3-style-nudge/skill/references/lua-contracts.md"],
  [".claude/skills/jx3-code-style-correction/references/change-hygiene-self-review.md", "plugin-src/capabilities/jx3-style-nudge/skill/references/change-hygiene-self-review.md"],
  [".claude/kcoderag-nav/hooks/jx3-style-nudge.cjs", "dist/hooks/jx3-style-nudge.cjs"],
  [".claude/kcoderag-nav/hooks/pre-tool-dispatcher.cjs", "dist/hooks/pre-tool-dispatcher.cjs"],
] as const;

interface IntegrityFixture {
  readonly root: string;
  readonly statePath: string;
  readonly cacheRoot: string;
  readonly installedPaths: readonly string[];
}

function digest(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function integrityFixture(): IntegrityFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-jx3-integrity-"));
  const installedPaths: string[] = [];
  const files = integrityAssets.map(([relativePath, sourcePath]) => {
    const bytes = fs.readFileSync(path.resolve(sourcePath));
    const destination = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    installedPaths.push(destination);
    return {
      path: relativePath,
      digest: digest(bytes),
      original: { kind: "absent" as const },
      contributors: ["jx3-style-nudge" as const],
    };
  });
  const state = installState.createInstallState({
    schemaVersion: 1,
    packageVersion: "0.2.2",
    host: "claude",
    capabilities: [{
      id: "jx3-style-nudge",
      files: files.map((file) => file.path),
      sections: [],
    }],
    files,
    sections: [],
  });
  const statePath = path.join(root, ".claude", "kcoderag-nav", "install-state.json");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state)}\n`, "utf8");
  return { root, statePath, cacheRoot: path.join(root, "cache"), installedPaths };
}

function integrityOptions(fixture: IntegrityFixture) {
  return {
    host: "claude" as const,
    managedRoot: fixture.root,
    statePath: fixture.statePath,
  };
}

test("JX3 source extensions are exact, case-insensitive, and directory-neutral", () => {
  assert.deepEqual(jx3.JX3_SOURCE_EXTENSIONS, allowedExtensions);
  for (const extension of allowedExtensions) {
    assert.equal(jx3.isJx3SourcePath(`src/vendor/generated/player${extension}`), true, extension);
    assert.equal(jx3.isJx3SourcePath(`ANY/DIRECTORY/PLAYER${extension.toUpperCase()}`), true, extension);
  }
  for (const path of [
    "player.cpp.txt", "player.inc", "player.proto", "player.luac", "player", ".cpp", "player.ts", "",
  ]) {
    assert.equal(jx3.isJx3SourcePath(path), false, path);
  }
});

test("only fixed structured content-write tools expose their exact file_path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-jx3-contribution-"));
  let session = 0;
  const contribution = (payload: Readonly<Record<string, unknown>>): string | undefined =>
    jx3.jx3StyleContribution(
      { ...payload, session_id: `session-${session += 1}` },
      { host: "claude", managedRoot: path.join(root, "project"), cacheRoot: root },
    );
  try {
  for (const toolName of ["Write", "Edit", "MultiEdit"]) {
    const payload = { tool_name: toolName, tool_input: { file_path: "src/player.CPP" } };
    assert.deepEqual(jx3.structuredMutationPaths(payload), ["src/player.CPP"]);
    assert.equal(contribution(payload), jx3.JX3_NUDGE);
  }

  for (const payload of [
    { tool_name: "Bash", tool_input: { command: "printf text > player.cpp" } },
    { tool_name: "Delete", tool_input: { file_path: "player.cpp" } },
    { tool_name: "Rename", tool_input: { file_path: "player.cpp", new_path: "renamed.cpp" } },
    { tool_name: "Read", tool_input: { file_path: "player.cpp" } },
    { tool_name: "Write", tool_input: { path: "player.cpp" } },
    { tool_name: "write", tool_input: { file_path: "player.cpp" } },
    { tool_name: "Unknown", tool_input: { file_path: "player.cpp" } },
  ]) {
    assert.deepEqual(jx3.structuredMutationPaths(payload), []);
    assert.equal(contribution(payload), undefined);
  }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native apply_patch uses bounded envelope headers and coalesces relevant mutations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-jx3-patch-"));
  let session = 0;
  try {
  const patchCases: readonly (readonly [string, readonly string[]])[] = [
    ["*** Begin Patch\n*** Add File: src/new.lua\n+return true\n*** End Patch", ["src/new.lua"]],
    ["*** Begin Patch\n*** Update File: src/player.cpp\n@@\n-old\n+new\n*** End Patch", ["src/player.cpp"]],
    ["*** Begin Patch\n*** Delete File: src/player.cpp\n*** End Patch", []],
    ["*** Begin Patch\n*** Update File: src/old.cpp\n*** Move to: src/new.cpp\n*** End Patch", []],
    [
      "*** Begin Patch\n*** Update File: docs/readme.md\n@@\n-old\n+new\n*** Add File: src/a.hpp\n+int a;\n*** Add File: src/b.lua\n+return 1\n*** End Patch",
      ["docs/readme.md", "src/a.hpp", "src/b.lua"],
    ],
  ];

  for (const [command, paths] of patchCases) {
    const payload = { tool_name: "apply_patch", tool_input: { command } };
    assert.deepEqual(jx3.structuredMutationPaths(payload), paths, command);
    assert.equal(
      jx3.jx3StyleContribution(
        { ...payload, session_id: `patch-${session += 1}` },
        { host: "claude", managedRoot: path.join(root, "project"), cacheRoot: root },
      ),
      paths.some(jx3.isJx3SourcePath) ? jx3.JX3_NUDGE : undefined,
    );
  }

  for (const command of [
    "*** Add File: src/no-envelope.cpp\n+body",
    "*** Begin Patch\n*** Add File src/malformed.cpp\n+body\n*** End Patch",
    "*** Begin Patch\n*** Delete File: src/old.txt\n+*** Add File: src/body-decoy.cpp\n*** End Patch",
    "*** Begin Patch\n*** Add File: src/new.cpp\n+body\n*** End Patch\ntrailing",
    "*** Begin Patch\n*** Add File: src/new.cpp\n+" + "x".repeat(131_073) + "\n*** End Patch",
  ]) {
    assert.deepEqual(jx3.structuredMutationPaths({ tool_name: "apply_patch", tool_input: { command } }), []);
  }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("JX3 contribution requires a stable identity and emits once per host/root/session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-jx3-once-"));
  const runtime = { host: "claude" as const, managedRoot: path.join(root, "project"), cacheRoot: root };
  const event = { tool_name: "Write", tool_input: { file_path: "src/player.cpp" }, session_id: "stable" };
  try {
    assert.equal(jx3.jx3StyleContribution({ ...event, session_id: undefined }, runtime), undefined);
    assert.equal(jx3.jx3StyleContribution({ ...event, session_id: 123 }, runtime), undefined);
    assert.equal(jx3.jx3StyleContribution(event), undefined);
    assert.equal(jx3.jx3StyleContribution(event, runtime), jx3.JX3_NUDGE);
    assert.equal(jx3.jx3StyleContribution(event, runtime), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the reminder is constant, short, precedence-aware, and makes no scan claim", () => {
  assert.match(jx3.JX3_NUDGE, /\$jx3-code-style-correction/u);
  assert.match(jx3.JX3_NUDGE, /user and project instructions take precedence/iu);
  assert.match(jx3.JX3_NUDGE, /regions changed in this task/iu);
  assert.ok(jx3.JX3_NUDGE.split(/\s+/u).length <= 50);
  assert.doesNotMatch(jx3.JX3_NUDGE, /scan(?:ner|ned)?|SVN|Python|https?:|[A-Za-z]:[\\/]/iu);
});

test("complete managed JX3 tree passes every digest before claiming once", () => {
  const fixture = integrityFixture();
  try {
    assert.deepEqual(jx3.evaluateJx3Integrity(integrityOptions(fixture)), { ok: true });
    const event = {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "src/player.cpp" },
      session_id: "integrity-session",
    };
    assert.equal(jx3.jx3StyleContribution(event, {
      ...integrityOptions(fixture),
      cacheRoot: fixture.cacheRoot,
    }), jx3.JX3_NUDGE);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("every missing or edited managed asset is silent before marker creation", () => {
  for (const [assetIndex, [relativePath]] of integrityAssets.entries()) {
    for (const mutation of ["missing", "edited"] as const) {
      const fixture = integrityFixture();
      try {
        const target = fixture.installedPaths[assetIndex];
        assert.ok(target);
        if (mutation === "missing") fs.rmSync(target);
        else fs.appendFileSync(target, "\nmanaged drift\n", "utf8");

        const result = jx3.evaluateJx3Integrity(integrityOptions(fixture));
        assert.equal(result.ok, false, `${mutation}: ${relativePath}`);
        assert.deepEqual(result.finding, { code: "capability_drift", path: relativePath });
        assert.equal(jx3.jx3StyleContribution({
          tool_name: "Write",
          tool_input: { file_path: "src/player.cpp" },
          session_id: `${mutation}-${assetIndex}`,
        }, {
          ...integrityOptions(fixture),
          cacheRoot: fixture.cacheRoot,
        }), undefined);
        assert.equal(fs.existsSync(path.join(fixture.cacheRoot, "nudges")), false);
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    }
  }
});

test("an extra Skill override source is drift and cannot consume the once claim", () => {
  for (const relativeOverride of [
    ".claude/skills/jx3-code-style-correction/OVERRIDE.md",
    ".claude/skills/jx3-code-style-correction/references/extra.md",
  ]) {
    const fixture = integrityFixture();
    try {
      const overridePath = path.join(fixture.root, ...relativeOverride.split("/"));
      fs.mkdirSync(path.dirname(overridePath), { recursive: true });
      fs.writeFileSync(overridePath, "override\n", "utf8");
      const result = jx3.evaluateJx3Integrity(integrityOptions(fixture));
      assert.equal(result.ok, false, relativeOverride);
      assert.deepEqual(result.finding, { code: "capability_drift", path: relativeOverride });
      assert.equal(jx3.jx3StyleContribution({
        tool_name: "Write",
        tool_input: { file_path: "src/player.cpp" },
        session_id: "override-session",
      }, {
        ...integrityOptions(fixture),
        cacheRoot: fixture.cacheRoot,
      }), undefined);
      assert.equal(fs.existsSync(path.join(fixture.cacheRoot, "nudges")), false);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
