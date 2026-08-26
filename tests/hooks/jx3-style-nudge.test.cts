const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

interface Jx3NudgeModule {
  readonly JX3_NUDGE: string;
  readonly JX3_SOURCE_EXTENSIONS: readonly string[];
  isJx3SourcePath(value: unknown): boolean;
  structuredMutationPaths(payload: unknown): readonly string[];
  jx3StyleContribution(payload: unknown): string | undefined;
}

const jx3 = require("../../dist/hooks/jx3-style-nudge.cjs") as Jx3NudgeModule;

const allowedExtensions = [
  ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".inl", ".ipp", ".lua",
] as const;

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
  for (const toolName of ["Write", "Edit", "MultiEdit"]) {
    const payload = { tool_name: toolName, tool_input: { file_path: "src/player.CPP" } };
    assert.deepEqual(jx3.structuredMutationPaths(payload), ["src/player.CPP"]);
    assert.equal(jx3.jx3StyleContribution(payload), jx3.JX3_NUDGE);
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
    assert.equal(jx3.jx3StyleContribution(payload), undefined);
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
    assert.deepEqual(jx3.structuredMutationPaths(payload), paths, command);
    assert.equal(jx3.jx3StyleContribution(payload), paths.some(jx3.isJx3SourcePath) ? jx3.JX3_NUDGE : undefined);
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
});

test("the reminder is constant, short, precedence-aware, and makes no scan claim", () => {
  assert.match(jx3.JX3_NUDGE, /\$jx3-code-style-correction/u);
  assert.match(jx3.JX3_NUDGE, /user and project instructions take precedence/iu);
  assert.match(jx3.JX3_NUDGE, /regions changed in this task/iu);
  assert.ok(jx3.JX3_NUDGE.split(/\s+/u).length <= 50);
  assert.doesNotMatch(jx3.JX3_NUDGE, /scan(?:ner|ned)?|SVN|Python|https?:|[A-Za-z]:[\\/]/iu);
});
