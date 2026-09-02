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
      .filter((file) => file.id.startsWith("navigation:skill"))
      .map((file) => file.sourcePath),
    [NAVIGATION_SKILL, NAVIGATION_METADATA],
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
