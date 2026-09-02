const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

const skillRoot = path.resolve("plugin-src/capabilities/code-style-nudge/skill");
const skillPath = path.join(skillRoot, "SKILL.md");
const expectedRuleIds = Object.freeze([
  ...Array.from({ length: 19 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`),
]);
const expectedReferences = Object.freeze([
  "references/cpp-lifetime-control-flow.md",
  "references/protocol-serialization-data.md",
  "references/lua-contracts.md",
  "references/change-hygiene-self-review.md",
]);
const expectedPartitions: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "references/cpp-lifetime-control-flow.md": Object.freeze([
    "R01", "R02", "R05", "R06", "R07",
    "R11", "R14", "R15", "R17", "S02",
  ]),
  "references/protocol-serialization-data.md": Object.freeze([
    "R03", "R04", "R12", "R13", "R16",
    "R19", "S03", "S04", "S05", "S06",
  ]),
  "references/lua-contracts.md": Object.freeze([
    "R08", "R09", "R10", "R18",
  ]),
  "references/change-hygiene-self-review.md": Object.freeze([
    "S01", "S07", "S08",
  ]),
});

function readSkill(): string {
  return fs.readFileSync(skillPath, "utf8");
}

function extractRuleIds(markdown: string): readonly string[] {
  return markdown.match(/\b[RS]\d{2}\b/g) ?? [];
}

function extractReferenceTargets(markdown: string): readonly string[] {
  return Array.from(markdown.matchAll(/\[[^\]]+\]\((references\/[^)]+\.md)\)/g), (match) => match[1] as string);
}

function extractRuleSection(markdown: string, id: string): string | undefined {
  const sectionStart = markdown.indexOf(`## ${id}`);
  if (sectionStart < 0) return undefined;
  const followingSection = markdown.slice(sectionStart + 1).search(/\n## [RS]\d{2}/u);
  return markdown.slice(
    sectionStart,
    followingSection < 0 ? undefined : sectionStart + 1 + followingSection,
  );
}

test("canonical Code Style Skill is a nav-managed non-overridable asset", () => {
  assert.equal(fs.existsSync(skillPath), true, "canonical SKILL.md must exist");
  const markdown = readSkill();

  assert.match(markdown, /nav-managed/i);
  assert.match(markdown, /do not (?:directly )?edit/i);
  assert.match(markdown, /do not (?:create|use).{0,30}override/i);
  assert.match(markdown, /AGENTS\.md.{0,80}project (?:documentation|instructions)/i);
  assert.match(markdown, /^name: kcoderag-code-style$/m);
  assert.match(markdown, /^# KCodeRag Code Style$/m);
});

test("SKILL.md alone contains the exact 27-rule compact index", () => {
  const markdown = readSkill();
  const actualRuleIds = extractRuleIds(markdown);

  assert.equal(actualRuleIds.length, expectedRuleIds.length);
  assert.deepEqual([...new Set(actualRuleIds)].sort(), [...expectedRuleIds].sort());

  const summaryLines = markdown
    .split(/\r?\n/u)
    .filter((line) => /^- `[RS]\d{2}` — \S.{20,}$/u.test(line));
  assert.equal(summaryLines.length, expectedRuleIds.length, "every rule needs one compact prescriptive line");
  assert.deepEqual([...extractRuleIds(summaryLines.join("\n"))].sort(), [...expectedRuleIds].sort());
});

test("the compact index fixes precedence and discloses conflicts", () => {
  const markdown = readSkill();

  assert.match(markdown, /user instructions?\s*>\s*project (?:documentation|instructions?)\s*>\s*(?:the )?Code Style Skill/i);
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
  assert.match(markdown, /\$kcoderag-code-style review <file or current changes>/u);
  assert.match(markdown, /defines no `apply` subcommand/u);
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
