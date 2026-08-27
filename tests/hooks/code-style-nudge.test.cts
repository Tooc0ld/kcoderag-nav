const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

interface CodeStyleNudgeModule {
  readonly CODE_STYLE_NUDGE: string;
  readonly CODE_STYLE_SOURCE_EXTENSIONS: readonly string[];
  isCodeStyleSourcePath(value: unknown): boolean;
  structuredMutationPaths(payload: unknown): readonly string[];
  codeStyleContribution(payload: unknown, options?: {
    readonly host: "claude";
    readonly managedRoot: string;
    readonly cacheRoot: string;
    readonly statePath?: string;
  }): string | undefined;
  evaluateCodeStyleIntegrity(options: {
    readonly host: "claude";
    readonly managedRoot: string;
    readonly statePath?: string;
  }): {
    readonly ok: boolean;
    readonly finding?: { readonly code: "capability_drift"; readonly path: string };
  };
}

const codeStyle = require("../../dist/hooks/code-style-nudge.cjs") as CodeStyleNudgeModule;
const installState = require("../../dist/core/state.cjs") as {
  createInstallState(input: Record<string, unknown>): Record<string, unknown>;
};

const allowedExtensions = [
  ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".inl", ".ipp", ".lua",
] as const;

const integrityAssets = [
  [".claude/skills/code-style-correction/SKILL.md", "plugin-src/capabilities/code-style-nudge/skill/SKILL.md"],
  [".claude/skills/code-style-correction/references/cpp-lifetime-control-flow.md", "plugin-src/capabilities/code-style-nudge/skill/references/cpp-lifetime-control-flow.md"],
  [".claude/skills/code-style-correction/references/protocol-serialization-data.md", "plugin-src/capabilities/code-style-nudge/skill/references/protocol-serialization-data.md"],
  [".claude/skills/code-style-correction/references/lua-contracts.md", "plugin-src/capabilities/code-style-nudge/skill/references/lua-contracts.md"],
  [".claude/skills/code-style-correction/references/change-hygiene-self-review.md", "plugin-src/capabilities/code-style-nudge/skill/references/change-hygiene-self-review.md"],
  [".claude/kcoderag-nav/hooks/code-style-nudge.cjs", "dist/hooks/code-style-nudge.cjs"],
  [".claude/kcoderag-nav/hooks/pre-tool-dispatcher.cjs", "dist/hooks/pre-tool-dispatcher.cjs"],
  [".claude/kcoderag-nav/hooks/once-marker.cjs", "dist/hooks/once-marker.cjs"],
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-code-style-integrity-"));
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
      contributors: ["code-style-nudge" as const],
    };
  });
  const state = installState.createInstallState({
    schemaVersion: 1,
    packageVersion: "0.2.2",
    host: "claude",
    capabilities: [{
      id: "code-style-nudge",
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

function markerInventory(cacheRoot: string): readonly string[] {
  const nudgeRoot = path.join(cacheRoot, "nudges");
  return fs.existsSync(nudgeRoot)
    ? fs.readdirSync(nudgeRoot).sort()
    : [];
}

test("code-style source extensions are exact, case-insensitive, and directory-neutral", () => {
  assert.deepEqual(codeStyle.CODE_STYLE_SOURCE_EXTENSIONS, allowedExtensions);
  for (const extension of allowedExtensions) {
    assert.equal(codeStyle.isCodeStyleSourcePath(`src/vendor/generated/player${extension}`), true, extension);
    assert.equal(codeStyle.isCodeStyleSourcePath(`ANY/DIRECTORY/PLAYER${extension.toUpperCase()}`), true, extension);
  }
  for (const path of [
    "player.cpp.txt", "player.inc", "player.proto", "player.luac", "player", ".cpp", "player.ts", "",
  ]) {
    assert.equal(codeStyle.isCodeStyleSourcePath(path), false, path);
  }
});

test("only fixed structured content-write tools expose their exact file_path", () => {
  for (const toolName of ["Write", "Edit", "MultiEdit"]) {
    const payload = { tool_name: toolName, tool_input: { file_path: "src/player.CPP" } };
    assert.deepEqual(codeStyle.structuredMutationPaths(payload), ["src/player.CPP"]);
    assert.equal(codeStyle.structuredMutationPaths(payload).some(codeStyle.isCodeStyleSourcePath), true);
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
    assert.deepEqual(codeStyle.structuredMutationPaths(payload), []);
  }
});

test("native apply_patch uses bounded envelope headers and coalesces relevant mutations", () => {
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
    assert.deepEqual(codeStyle.structuredMutationPaths(payload), paths, command);
  }

  for (const command of [
    "*** Add File: src/no-envelope.cpp\n+body",
    "*** Begin Patch\n*** Add File src/malformed.cpp\n+body\n*** End Patch",
    "*** Begin Patch\n*** Delete File: src/old.txt\n+*** Add File: src/body-decoy.cpp\n*** End Patch",
    "*** Begin Patch\n*** Add File: src/new.cpp\n+body\n*** End Patch\ntrailing",
    "*** Begin Patch\n*** Add File: src/new.cpp\n+" + "x".repeat(131_073) + "\n*** End Patch",
  ]) {
    assert.deepEqual(codeStyle.structuredMutationPaths({ tool_name: "apply_patch", tool_input: { command } }), []);
  }
});

test("malformed hostile payload access fails open without consuming the marker", () => {
  const fixture = integrityFixture();
  const runtime = { ...integrityOptions(fixture), cacheRoot: fixture.cacheRoot };
  const hostilePayload = new Proxy<Record<string, unknown>>({}, {
    get(): never {
      throw new Error("untrusted payload access");
    },
  });
  try {
    assert.doesNotThrow(() => codeStyle.structuredMutationPaths(hostilePayload));
    assert.deepEqual(codeStyle.structuredMutationPaths(hostilePayload), []);
    assert.doesNotThrow(() => codeStyle.codeStyleContribution(hostilePayload, runtime));
    assert.equal(codeStyle.codeStyleContribution(hostilePayload, runtime), undefined);
    assert.deepEqual(markerInventory(fixture.cacheRoot), []);

    assert.equal(codeStyle.codeStyleContribution({
      tool_name: "Write",
      tool_input: { file_path: "src/player.cpp" },
      session_id: "hostile-then-valid",
    }, runtime), codeStyle.CODE_STYLE_NUDGE);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("oversized paths, patches, and state fail open before the first valid event", () => {
  const fixture = integrityFixture();
  const runtime = { ...integrityOptions(fixture), cacheRoot: fixture.cacheRoot };
  const originalState = fs.readFileSync(fixture.statePath);
  try {
    const oversizedPath = `src/${"x".repeat(4_096)}.cpp`;
    assert.deepEqual(codeStyle.structuredMutationPaths({
      tool_name: "Write",
      tool_input: { file_path: oversizedPath },
    }), []);
    assert.deepEqual(codeStyle.structuredMutationPaths({
      tool_name: "apply_patch",
      tool_input: {
        command: `*** Begin Patch\n*** Add File: src/player.cpp\n+${"x".repeat(131_073)}\n*** End Patch`,
      },
    }), []);

    fs.writeFileSync(fixture.statePath, Buffer.alloc(1_048_577, 0x78));
    assert.equal(codeStyle.codeStyleContribution({
      tool_name: "Write",
      tool_input: { file_path: "src/player.cpp" },
      session_id: "oversized-then-valid",
    }, runtime), undefined);
    assert.deepEqual(markerInventory(fixture.cacheRoot), []);

    fs.writeFileSync(fixture.statePath, originalState);
    assert.equal(codeStyle.codeStyleContribution({
      tool_name: "Write",
      tool_input: { file_path: "src/player.cpp" },
      session_id: "oversized-then-valid",
    }, runtime), codeStyle.CODE_STYLE_NUDGE);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("malformed and composite-drifted states fail open without consuming the first valid event", () => {
  for (const mutateState of [
    (): Buffer => Buffer.from("{not-json", "utf8"),
    (stateBytes: Buffer): Buffer => {
      const state = JSON.parse(stateBytes.toString("utf8")) as Record<string, unknown>;
      state.packageVersion = "tampered";
      return Buffer.from(`${JSON.stringify(state)}\n`, "utf8");
    },
  ]) {
    const fixture = integrityFixture();
    const runtime = { ...integrityOptions(fixture), cacheRoot: fixture.cacheRoot };
    const originalState = fs.readFileSync(fixture.statePath);
    try {
      fs.writeFileSync(fixture.statePath, mutateState(originalState));
      assert.equal(codeStyle.codeStyleContribution({
        tool_name: "Write",
        tool_input: { file_path: "src/player.cpp" },
        session_id: "state-drift-then-valid",
      }, runtime), undefined);
      assert.deepEqual(markerInventory(fixture.cacheRoot), []);

      fs.writeFileSync(fixture.statePath, originalState);
      assert.equal(codeStyle.codeStyleContribution({
        tool_name: "Write",
        tool_input: { file_path: "src/player.cpp" },
        session_id: "state-drift-then-valid",
      }, runtime), codeStyle.CODE_STYLE_NUDGE);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("code-style contribution requires a stable identity and emits once per host/root/session", () => {
  const fixture = integrityFixture();
  const runtime = { ...integrityOptions(fixture), cacheRoot: fixture.cacheRoot };
  const event = { tool_name: "Write", tool_input: { file_path: "src/player.cpp" }, session_id: "stable" };
  try {
    assert.equal(codeStyle.codeStyleContribution({ ...event, session_id: undefined }, runtime), undefined);
    assert.equal(codeStyle.codeStyleContribution({ ...event, session_id: 123 }, runtime), undefined);
    assert.equal(codeStyle.codeStyleContribution(event), undefined);
    assert.equal(codeStyle.codeStyleContribution(event, runtime), codeStyle.CODE_STYLE_NUDGE);
    assert.equal(codeStyle.codeStyleContribution(event, runtime), undefined);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("the reminder is constant, short, precedence-aware, and makes no scan claim", () => {
  assert.match(codeStyle.CODE_STYLE_NUDGE, /\$code-style-correction/u);
  assert.match(codeStyle.CODE_STYLE_NUDGE, /user and project instructions take precedence/iu);
  assert.match(codeStyle.CODE_STYLE_NUDGE, /regions changed in this task/iu);
  assert.ok(codeStyle.CODE_STYLE_NUDGE.split(/\s+/u).length <= 50);
  assert.doesNotMatch(codeStyle.CODE_STYLE_NUDGE, /scan(?:ner|ned)?|SVN|Python|https?:|[A-Za-z]:[\\/]/iu);
});

test("complete managed code-style tree passes every digest before claiming once", () => {
  const fixture = integrityFixture();
  try {
    assert.deepEqual(codeStyle.evaluateCodeStyleIntegrity(integrityOptions(fixture)), { ok: true });
    const event = {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "src/player.cpp" },
      session_id: "integrity-session",
    };
    assert.equal(codeStyle.codeStyleContribution(event, {
      ...integrityOptions(fixture),
      cacheRoot: fixture.cacheRoot,
    }), codeStyle.CODE_STYLE_NUDGE);
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
        const originalBytes = fs.readFileSync(target);
        if (mutation === "missing") fs.rmSync(target);
        else fs.appendFileSync(target, "\nmanaged drift\n", "utf8");

        const result = codeStyle.evaluateCodeStyleIntegrity(integrityOptions(fixture));
        assert.equal(result.ok, false, `${mutation}: ${relativePath}`);
        assert.deepEqual(result.finding, { code: "capability_drift", path: relativePath });
        assert.equal(codeStyle.codeStyleContribution({
          tool_name: "Write",
          tool_input: { file_path: "src/player.cpp" },
          session_id: `${mutation}-${assetIndex}`,
        }, {
          ...integrityOptions(fixture),
          cacheRoot: fixture.cacheRoot,
        }), undefined);
        assert.equal(fs.existsSync(path.join(fixture.cacheRoot, "nudges")), false);

        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, originalBytes);
        assert.equal(codeStyle.codeStyleContribution({
          tool_name: "Write",
          tool_input: { file_path: "src/player.cpp" },
          session_id: `${mutation}-${assetIndex}`,
        }, {
          ...integrityOptions(fixture),
          cacheRoot: fixture.cacheRoot,
        }), codeStyle.CODE_STYLE_NUDGE);
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    }
  }
});

test("an extra Skill override source is drift and cannot consume the once claim", () => {
  for (const relativeOverride of [
    ".claude/skills/code-style-correction/OVERRIDE.md",
    ".claude/skills/code-style-correction/references/extra.md",
  ]) {
    const fixture = integrityFixture();
    try {
      const overridePath = path.join(fixture.root, ...relativeOverride.split("/"));
      fs.mkdirSync(path.dirname(overridePath), { recursive: true });
      fs.writeFileSync(overridePath, "override\n", "utf8");
      const result = codeStyle.evaluateCodeStyleIntegrity(integrityOptions(fixture));
      assert.equal(result.ok, false, relativeOverride);
      assert.deepEqual(result.finding, { code: "capability_drift", path: relativeOverride });
      assert.equal(codeStyle.codeStyleContribution({
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
