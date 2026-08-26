const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

const skillRoot = path.resolve("plugin-src/capabilities/jx3-style-nudge/skill");
const skillPath = path.join(skillRoot, "SKILL.md");
const expectedRuleIds = Object.freeze([
  ...Array.from({ length: 19 }, (_, index) => `JX3-R${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, index) => `JX3-S${String(index + 1).padStart(2, "0")}`),
]);
const expectedReferences = Object.freeze([
  "references/cpp-lifetime-control-flow.md",
  "references/protocol-serialization-data.md",
  "references/lua-contracts.md",
  "references/change-hygiene-self-review.md",
]);

function readSkill(): string {
  return fs.readFileSync(skillPath, "utf8");
}

function extractRuleIds(markdown: string): readonly string[] {
  return markdown.match(/\bJX3-[RS]\d{2}\b/g) ?? [];
}

function extractReferenceTargets(markdown: string): readonly string[] {
  return Array.from(markdown.matchAll(/\[[^\]]+\]\((references\/[^)]+\.md)\)/g), (match) => match[1] as string);
}

test("canonical JX3 Skill is a nav-managed non-overridable asset", () => {
  assert.equal(fs.existsSync(skillPath), true, "canonical SKILL.md must exist");
  const markdown = readSkill();

  assert.match(markdown, /nav-managed/i);
  assert.match(markdown, /do not (?:directly )?edit/i);
  assert.match(markdown, /do not (?:create|use).{0,30}override/i);
  assert.match(markdown, /AGENTS\.md.{0,80}project (?:documentation|instructions)/i);
});

test("SKILL.md alone contains the exact 27-rule compact index", () => {
  const markdown = readSkill();
  const actualRuleIds = extractRuleIds(markdown);

  assert.equal(actualRuleIds.length, expectedRuleIds.length);
  assert.deepEqual([...new Set(actualRuleIds)].sort(), [...expectedRuleIds].sort());

  const summaryLines = markdown
    .split(/\r?\n/u)
    .filter((line) => /^- `JX3-[RS]\d{2}` — \S.{20,}$/u.test(line));
  assert.equal(summaryLines.length, expectedRuleIds.length, "every rule needs one compact prescriptive line");
  assert.deepEqual([...extractRuleIds(summaryLines.join("\n"))].sort(), [...expectedRuleIds].sort());
});

test("the compact index fixes precedence and discloses conflicts", () => {
  const markdown = readSkill();

  assert.match(markdown, /user instructions?\s*>\s*project (?:documentation|instructions?)\s*>\s*(?:the )?JX3 Skill/i);
  assert.match(markdown, /disclose.{0,80}conflict/i);
  assert.match(markdown, /follow.{0,80}higher-priority/i);
});

test("the index routes progressive detail through exactly four shallow references", () => {
  const markdown = readSkill();
  const targets = extractReferenceTargets(markdown);

  assert.deepEqual(targets, expectedReferences);
  assert.equal(new Set(targets).size, expectedReferences.length);
  for (const target of targets) {
    assert.equal(path.dirname(target), "references");
    assert.equal(target.includes(".."), false);
  }
});

test("the compact Skill remains prescriptive and contains no executable legacy workflow", () => {
  const markdown = readSkill();
  const lineCount = markdown.split(/\r?\n/u).length;

  assert.ok(lineCount < 200, `SKILL.md has ${lineCount} lines`);
  assert.ok(Buffer.byteLength(markdown, "utf8") < 24_000, "SKILL.md exceeds the compact index budget");
  assert.doesNotMatch(markdown, /```(?:bash|powershell|python|shell|cmd)/i);
  assert.doesNotMatch(markdown, /audit_added_lines|historical-revisions|svn\s+(?:status|diff|cat)|python\s+scripts|clang-format|scan(?:ner)?\s+passed/i);
  assert.match(markdown, /pre-write/i);
  assert.match(markdown, /guidance, not (?:a )?(?:scan|scanner)/i);
});
