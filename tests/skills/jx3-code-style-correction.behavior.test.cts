const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

const skillRoot = path.resolve("plugin-src/capabilities/jx3-style-nudge/skill");

function readAsset(relativePath: string): string {
  return fs.readFileSync(path.join(skillRoot, relativePath), "utf8");
}

interface BehaviorRubric {
  readonly id: string;
  readonly title: string;
  readonly asset: string;
  readonly rules: readonly string[];
  readonly guidance: readonly RegExp[];
  readonly restraint: readonly RegExp[];
}

const rubrics: readonly BehaviorRubric[] = Object.freeze([
  {
    id: "E01",
    title: "risky result handling distinguishes non-void from void",
    asset: "references/cpp-lifetime-control-flow.md",
    rules: ["JX3-R01"],
    guidance: [/visible declaration/i, /receive and judge/i, /business boundary/i],
    restraint: [/never invent.{0,40}void/i, /setAdditionalKerning|ResetCostume/],
  },
  {
    id: "E02",
    title: "owned acquisitions release exactly once without double-release",
    asset: "references/cpp-lifetime-control-flow.md",
    rules: ["JX3-R02"],
    guidance: [/every exit/i, /exactly once/i, /release order/i],
    restraint: [/borrowed/i, /double release/i],
  },
  {
    id: "E03",
    title: "lifecycle teardown reverses initialization per conditional path",
    asset: "references/cpp-lifetime-control-flow.md",
    rules: ["JX3-R11"],
    guidance: [/reverse order/i, /conditional/i, /failure path/i],
    restraint: [/receiver.{0,30}rename/i, /successfully acquired/i],
  },
  {
    id: "E04",
    title: "wire layout changes align protocol version and serialization",
    asset: "references/protocol-serialization-data.md",
    rules: ["JX3-R13", "JX3-R16"],
    guidance: [/same change/i, /world version/i, /persisted member/i],
    restraint: [/implementation-only/i, /transient/i],
  },
  {
    id: "E05",
    title: "packet storage follows the owner convention without a heap ban",
    asset: "references/protocol-serialization-data.md",
    rules: ["JX3-S04", "JX3-S05"],
    guidance: [/same-owner/i, /scratch buffer/i, /transport/i],
    restraint: [/not a blanket/i, /asynchronous lifetime|variable size/i],
  },
  {
    id: "E06",
    title: "server DWORD formatting stays type and context aware",
    asset: "references/cpp-lifetime-control-flow.md",
    rules: ["JX3-R14"],
    guidance: [/%u/, /DWORD/i, /explicit conversion/i],
    restraint: [/client/i, /actual type/i],
  },
  {
    id: "E07",
    title: "Lua results, guards, and stack access form one consistent contract",
    asset: "references/lua-contracts.md",
    rules: ["JX3-R08", "JX3-R09", "JX3-R10"],
    guidance: [/result count/i, /before the first push/i, /direct access/i],
    restraint: [/dynamic/i, /do not guess|never guess/i, /indirect helper/i],
  },
  {
    id: "E08",
    title: "Lua traversal requires a same-state table guard",
    asset: "references/lua-contracts.md",
    rules: ["JX3-R18"],
    guidance: [/Lua_Next/, /same Lua state/i, /table/i],
    restraint: [/already guarded/i, /same index/i],
  },
  {
    id: "E09",
    title: "table-loader changes surface external compatibility questions",
    asset: "references/protocol-serialization-data.md",
    rules: ["JX3-R19"],
    guidance: [/data column/i, /default/i, /backward\s+compatibility/i, /deployment order/i],
    restraint: [/do not mechanically/i, /source alone/i],
  },
  {
    id: "E10",
    title: "formatting review removes only unrelated drift",
    asset: "references/change-hygiene-self-review.md",
    rules: ["JX3-S01"],
    guidance: [/changed region/i, /unrelated.{0,30}(?:spacing|alignment|drift)/i],
    restraint: [/control flow/i, /goto/i, /semantic indentation/i],
  },
  {
    id: "E11",
    title: "file-byte claims require actual baseline evidence",
    asset: "references/change-hygiene-self-review.md",
    rules: ["JX3-S08"],
    guidance: [/encoding/i, /BOM/i, /line ending/i],
    restraint: [/without.{0,50}evidence/i, /not\s+verified/i],
  },
  {
    id: "E12",
    title: "activation is limited to relevant content writes",
    asset: "SKILL.md",
    rules: [],
    guidance: [/\.c, \.cc, \.cpp, \.cxx/, /\.lua/, /creating or modifying/i],
    restraint: [/read-only analysis/i, /pure rename\/delete/i, /unrelated languages/i],
  },
  {
    id: "E13",
    title: "multi-file review remains bounded to actual changed regions",
    asset: "SKILL.md",
    rules: [],
    guidance: [/review only regions changed in this task/i, /smallest necessary diff/i],
    restraint: [/do not add aliases, abstractions, state, or cleanup/i, /without demonstrated need/i],
  },
  {
    id: "E14",
    title: "missing evidence produces honest questions rather than clean claims",
    asset: "SKILL.md",
    rules: [],
    guidance: [/evidence-dependent or business\s+questions/i, /separate evidence/i],
    restraint: [/not a scanner/i, /stop short of a success claim/i],
  },
  {
    id: "E15",
    title: "higher-priority project instructions win with disclosure",
    asset: "SKILL.md",
    rules: [],
    guidance: [/user instructions?\s*>\s*project documentation\s*>\s*JX3 Skill/i, /disclose the conflict/i],
    restraint: [/never silently replace/i, /follow the higher-priority\s+instruction/i],
  },
]);

for (const rubric of rubrics) {
  test(`${rubric.id}: ${rubric.title}`, () => {
    const markdown = readAsset(rubric.asset);
    for (const rule of rubric.rules) {
      assert.match(markdown, new RegExp(`\\b${rule}\\b`), `${rubric.id} must route ${rule}`);
    }
    for (const pattern of rubric.guidance) {
      assert.match(markdown, pattern, `${rubric.id} missing guidance ${pattern}`);
    }
    for (const pattern of rubric.restraint) {
      assert.match(markdown, pattern, `${rubric.id} missing restraint ${pattern}`);
    }
  });
}

test("E01-E15 form a complete, unique rubric and never reward scan claims", () => {
  assert.deepEqual(rubrics.map(({ id }) => id), Array.from({ length: 15 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`));
  for (const rubric of rubrics) {
    assert.ok(rubric.guidance.length > 0, `${rubric.id} needs positive guidance`);
    assert.ok(rubric.restraint.length > 0, `${rubric.id} needs a negative boundary`);
  }

  const forbiddenClaim = "Static scan passed; all JX3 rules are clean.";
  assert.match(forbiddenClaim, /scan passed|rules are clean/i);
  assert.doesNotMatch(readAsset("SKILL.md"), /scan passed|rules are clean/i);
});
