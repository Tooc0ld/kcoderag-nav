const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

interface NavigationContribution {
  readonly capabilityId: "kcoderag-navigation";
  readonly files: readonly {
    readonly id: string;
    readonly sourcePath: string;
    readonly kind: string;
  }[];
}

const registry = require("../../dist/capabilities/registry.cjs") as {
  readonly BUILT_IN_CAPABILITIES: readonly { readonly id: string }[];
  getCapabilityProvider(id: "kcoderag-navigation"): {
    contribution(): NavigationContribution;
  };
};

const NAVIGATION_SKILL = "plugin-src/skills/kcoderag/SKILL.md";
const NAVIGATION_METADATA = "plugin-src/skills/kcoderag/agents/openai.yaml";
const MANAGEMENT_SKILL = "plugin-src/skills/kcoderag-manage/SKILL.md";
const MANAGEMENT_METADATA = "plugin-src/skills/kcoderag-manage/agents/openai.yaml";
const UPDATE_SKILL = "plugin-src/skills/kcoderag-update/SKILL.md";
const UPDATE_METADATA = "plugin-src/skills/kcoderag-update/agents/openai.yaml";
const FEEDBACK_SKILL = "plugin-src/skills/kcoderag-feedback/SKILL.md";
const FEEDBACK_METADATA = "plugin-src/skills/kcoderag-feedback/agents/openai.yaml";
const STYLE_SKILL = "plugin-src/capabilities/code-style-nudge/skill/SKILL.md";
const STYLE_METADATA = "plugin-src/capabilities/code-style-nudge/skill/agents/openai.yaml";
const RETIRED_NAVIGATION_SKILL = "plugin-src/skills/code-lookup-discipline/SKILL.md";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function quotedYamlValue(source: string, key: string): string {
  const match = source.match(new RegExp(`^\\s*${key}:\\s*"([^"]+)"\\s*$`, "mu"));
  assert.ok(match, `${key} must be a quoted string`);
  return match[1] ?? "";
}

test("$kcoderag is the sole read-only navigation Skill identity", () => {
  assert.equal(fs.existsSync(path.resolve(RETIRED_NAVIGATION_SKILL)), false);

  const skill = read(NAVIGATION_SKILL);
  assert.match(skill, /^name: kcoderag$/mu);
  assert.match(skill, /^description: .*read-only.*KCodeRag.*$/imu);
  for (const tool of ["search_code", "context", "get_call_chain", "list_indexes", "cypher"]) {
    assert.match(skill, new RegExp(`\\b${tool}\\b`, "u"), tool);
  }
  assert.match(skill, /local (?:Read\/Grep\/Glob|search)/u);
  assert.match(skill, /snapshot/u);
  assert.doesNotMatch(skill, /\b(?:update|uninstall|submit_feedback|apply_patch)\b/u);

  const metadata = read(NAVIGATION_METADATA);
  assert.equal(quotedYamlValue(metadata, "display_name"), "KCodeRag");
  const shortDescription = quotedYamlValue(metadata, "short_description");
  assert.ok(shortDescription.length >= 25 && shortDescription.length <= 64);
  assert.match(quotedYamlValue(metadata, "default_prompt"), /\$kcoderag\b/u);
  assert.match(metadata, /^\s*allow_implicit_invocation:\s*true\s*$/mu);

  const contribution = registry
    .getCapabilityProvider("kcoderag-navigation")
    .contribution();
  assert.equal(contribution.capabilityId, "kcoderag-navigation");
  assert.deepEqual(
    contribution.files
      .filter((file) => file.sourcePath.startsWith("plugin-src/skills/"))
      .map((file) => file.sourcePath),
    [
      NAVIGATION_SKILL,
      NAVIGATION_METADATA,
      MANAGEMENT_SKILL,
      MANAGEMENT_METADATA,
      UPDATE_SKILL,
      UPDATE_METADATA,
      FEEDBACK_SKILL,
      FEEDBACK_METADATA,
    ],
  );
  assert.equal(
    contribution.files.some((file) => file.sourcePath.includes("code-lookup-discipline")),
    false,
  );
  assert.deepEqual(
    registry.BUILT_IN_CAPABILITIES.map((manifest) => manifest.id),
    ["kcoderag-navigation", "code-style-nudge"],
  );
});

test("the five public Skills have distinct authority boundaries and Codex metadata", () => {
  const management = read(MANAGEMENT_SKILL);
  assert.match(management, /^name: kcoderag-manage$/mu);
  assert.match(management, /status/u);
  assert.match(management, /doctor/u);
  assert.match(management, /load and follow `\$kcoderag-update`/u);
  assert.doesNotMatch(management, /npx kcoderag-nav@latest update/u);
  assert.match(management, /Uninstall.*explicit user request/isu);

  const update = read(UPDATE_SKILL);
  assert.match(update, /^name: kcoderag-update$/mu);
  assert.match(update, /<objective>[\s\S]*<\/objective>/u);
  assert.match(update, /<quick_start>[\s\S]*<\/quick_start>/u);
  assert.match(update, /<success_criteria>[\s\S]*<\/success_criteria>/u);
  assert.match(update, /explicitly asks for an update/iu);
  assert.match(update, /npx kcoderag-nav@latest update --target <absolute-project-root> --host <host> --yes/u);
  assert.match(update, /exactly one host per CLI invocation/iu);
  assert.match(update, /Never bypass the refusal or delete files manually/u);
  assert.match(update, /MCP URLs.*headers.*Bearer.*tokens.*configuration bodies.*subprocess bodies/isu);
  assert.doesNotMatch(update, /^\s*#{1,6}\s/mu);

  const feedback = read(FEEDBACK_SKILL);
  assert.match(feedback, /^name: kcoderag-feedback$/mu);
  assert.match(feedback, /submit_feedback/u);
  assert.match(feedback, /actual query result/u);
  assert.match(feedback, /do not invent/iu);
  assert.match(feedback, /MCP URLs.*headers.*bearer.*tokens/isu);

  const style = read(STYLE_SKILL);
  assert.match(style, /^name: kcoderag-code-style$/mu);
  assert.match(style, /\$kcoderag-code-style review <file or current changes>/u);
  assert.match(style, /defines no `apply` subcommand/u);

  for (const [metadataPath, displayName, skillName] of [
    [MANAGEMENT_METADATA, "KCodeRag Manage", "$kcoderag-manage"],
    [UPDATE_METADATA, "KCodeRag Update", "$kcoderag-update"],
    [FEEDBACK_METADATA, "KCodeRag Feedback", "$kcoderag-feedback"],
    [STYLE_METADATA, "KCodeRag Code Style", "$kcoderag-code-style"],
  ] as const) {
    const metadata = read(metadataPath);
    assert.equal(quotedYamlValue(metadata, "display_name"), displayName);
    const shortDescription = quotedYamlValue(metadata, "short_description");
    assert.ok(shortDescription.length >= 25 && shortDescription.length <= 64, metadataPath);
    assert.match(quotedYamlValue(metadata, "default_prompt"), new RegExp(`\\${skillName}\\b`, "u"));
    assert.match(metadata, /^\s*allow_implicit_invocation:\s*true\s*$/mu);
  }
});
