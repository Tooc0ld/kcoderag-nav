const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

const skillRoot = path.resolve("plugin-src/capabilities/code-style-nudge/skill");
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
const expectedPartitions: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "references/cpp-lifetime-control-flow.md": Object.freeze([
    "JX3-R01", "JX3-R02", "JX3-R05", "JX3-R06", "JX3-R07",
    "JX3-R11", "JX3-R14", "JX3-R15", "JX3-R17", "JX3-S02",
  ]),
  "references/protocol-serialization-data.md": Object.freeze([
    "JX3-R03", "JX3-R04", "JX3-R12", "JX3-R13", "JX3-R16",
    "JX3-R19", "JX3-S03", "JX3-S04", "JX3-S05", "JX3-S06",
  ]),
  "references/lua-contracts.md": Object.freeze([
    "JX3-R08", "JX3-R09", "JX3-R10", "JX3-R18",
  ]),
  "references/change-hygiene-self-review.md": Object.freeze([
    "JX3-S01", "JX3-S07", "JX3-S08",
  ]),
});

function readSkill(): string {
  return fs.readFileSync(skillPath, "utf8");
}

function extractRuleIds(markdown: string): readonly string[] {
  return markdown.match(/\bJX3-[RS]\d{2}\b/g) ?? [];
}

function extractReferenceTargets(markdown: string): readonly string[] {
  return Array.from(markdown.matchAll(/\[[^\]]+\]\((references\/[^)]+\.md)\)/g), (match) => match[1] as string);
}

function extractRuleSection(markdown: string, id: string): string | undefined {
  const sectionStart = markdown.indexOf(`## ${id}`);
  if (sectionStart < 0) return undefined;
  const nextSection = markdown.indexOf("\n## JX3-", sectionStart + 1);
  return markdown.slice(sectionStart, nextSection < 0 ? undefined : nextSection);
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

test("four detailed references exist and repeat only their assigned partition IDs", () => {
  const allReferenceIds: string[] = [];

  for (const target of expectedReferences) {
    const referencePath = path.join(skillRoot, target);
    assert.equal(fs.existsSync(referencePath), true, `${target} must exist`);
    const markdown = fs.readFileSync(referencePath, "utf8");
    const actualIds = [...extractRuleIds(markdown)];
    const assignedIds = expectedPartitions[target];
    assert.ok(assignedIds !== undefined, `missing partition declaration for ${target}`);

    assert.equal(actualIds.length, assignedIds.length, `${target} repeats or omits an ID`);
    assert.deepEqual([...actualIds].sort(), [...assignedIds].sort(), `${target} has partition drift`);
    allReferenceIds.push(...actualIds);

    for (const id of assignedIds) {
      const section = extractRuleSection(markdown, id);
      assert.ok(section !== undefined, `${target} needs a section for ${id}`);
      assert.ok(section.length >= 220, `${target} ${id} needs actionable detail`);
      assert.match(section, /\*\*Write:\*\*/);
      assert.match(section, /\*\*Boundary:\*\*/);
      assert.match(section, /\*\*Review:\*\*/);
    }

    assert.ok(markdown.split(/\r?\n/u).length < 220, `${target} exceeds its line budget`);
    assert.ok(Buffer.byteLength(markdown, "utf8") < 20_000, `${target} exceeds its byte budget`);
    assert.doesNotMatch(markdown, /```(?:bash|powershell|python|shell|cmd)|audit_added_lines|historical-revisions|svn\s+(?:status|diff|cat)|python\s+scripts/i);
  }

  assert.equal(allReferenceIds.length, expectedRuleIds.length);
  assert.deepEqual([...allReferenceIds].sort(), [...expectedRuleIds].sort());
  assert.equal(extractRuleIds(readSkill()).length, expectedRuleIds.length, "reference repetition must not affect index uniqueness");
});
