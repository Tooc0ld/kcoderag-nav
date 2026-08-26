const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

type CapabilityId = "kcoderag-navigation" | "jx3-style-nudge";

interface CapabilityContribution {
  readonly capabilityId: CapabilityId;
  readonly files: readonly {
    readonly id: string;
    readonly sourcePath: string;
    readonly kind: string;
    readonly shared: boolean;
  }[];
  readonly sections: readonly {
    readonly id: string;
    readonly kind: string;
    readonly shared: boolean;
  }[];
}

type SupportDecision =
  | {
      readonly eligible: true;
      readonly deliveryMode: string;
      readonly evidenceDigest?: string;
    }
  | { readonly eligible: false; readonly code: string };

interface CapabilityProvider {
  readonly id: CapabilityId;
  contribution(): CapabilityContribution;
  evaluateSupport(context: {
    readonly host: "codex" | "claude" | "cursor" | "opencode";
    readonly hostVersion: string;
    readonly evidenceRoot?: string;
  }): SupportDecision;
}

const registry = require("../../dist/capabilities/registry.cjs") as {
  readonly BUILT_IN_CAPABILITIES: readonly { readonly id: CapabilityId }[];
  getCapabilityProvider(id: CapabilityId): CapabilityProvider;
  resolveCapabilityContributions(ids: readonly string[]): readonly CapabilityContribution[];
};

const JX3_SKILL_PATHS = Object.freeze([
  "plugin-src/capabilities/jx3-style-nudge/skill/SKILL.md",
  "plugin-src/capabilities/jx3-style-nudge/skill/references/cpp-lifetime-control-flow.md",
  "plugin-src/capabilities/jx3-style-nudge/skill/references/protocol-serialization-data.md",
  "plugin-src/capabilities/jx3-style-nudge/skill/references/lua-contracts.md",
  "plugin-src/capabilities/jx3-style-nudge/skill/references/change-hygiene-self-review.md",
]);

test("synthetic providers declare canonical host-neutral requirements", () => {
  const contributions = registry.resolveCapabilityContributions([
    "jx3-style-nudge",
    "kcoderag-navigation",
  ]);
  assert.deepEqual(
    contributions.map((contribution) => contribution.capabilityId),
    ["kcoderag-navigation", "jx3-style-nudge"],
  );

  const navigation = contributions[0];
  const jx3 = contributions[1];
  assert.ok(navigation);
  assert.ok(jx3);
  assert.deepEqual(
    new Set(navigation.files.map((file) => file.kind)),
    new Set(["mcp-config", "skill", "handler", "marker", "launcher", "rule", "plugin"]),
  );
  assert.deepEqual(
    new Set(navigation.sections.map((section) => section.kind)),
    new Set(["mcp", "pre-tool", "post-tool"]),
  );

  assert.deepEqual(
    jx3.files
      .filter((file) => file.kind === "skill")
      .map((file) => file.sourcePath),
    JX3_SKILL_PATHS,
  );
  assert.deepEqual(
    new Set(jx3.files.map((file) => file.kind)),
    new Set(["skill", "handler", "dispatcher", "marker", "launcher"]),
  );
  assert.deepEqual(
    jx3.sections.map((section) => section.kind),
    ["pre-tool"],
  );
  for (const sourcePath of JX3_SKILL_PATHS) {
    assert.equal(fs.existsSync(path.resolve(sourcePath)), true, sourcePath);
  }

  assert.equal(Object.isFrozen(contributions), true);
  assert.equal(contributions.every((contribution) => Object.isFrozen(contribution)), true);
  assert.equal(contributions.every((contribution) => Object.isFrozen(contribution.files)), true);
  assert.equal(contributions.every((contribution) => Object.isFrozen(contribution.sections)), true);
  assert.equal(
    contributions.every((contribution) =>
      contribution.files.every((file) => Object.isFrozen(file))),
    true,
  );
  assert.throws(() => {
    (jx3.files as unknown as Array<Record<string, unknown>>).push({});
  }, TypeError);
  assert.throws(() => {
    Object.assign(jx3.files[0] ?? {}, { sourcePath: "caller-mutated" });
  }, TypeError);
  assert.notStrictEqual(
    contributions[0],
    registry.resolveCapabilityContributions(["kcoderag-navigation"])[0],
  );
});

test("JX3 support delegates to the exact checked-in PASS receipt", () => {
  const navigation = registry.getCapabilityProvider("kcoderag-navigation");
  const jx3 = registry.getCapabilityProvider("jx3-style-nudge");

  assert.deepEqual(
    registry.BUILT_IN_CAPABILITIES.map((manifest) => manifest.id),
    [navigation.id, jx3.id],
  );
  assert.deepEqual(
    navigation.evaluateSupport({ host: "opencode", hostVersion: "0.0.0" }),
    { eligible: true, deliveryMode: "host_native" },
  );

  const supported = jx3.evaluateSupport({
    host: "claude",
    hostVersion: "2.1.241",
    evidenceRoot: process.cwd(),
  });
  assert.deepEqual(supported, {
    eligible: true,
    deliveryMode: "native_pre_write",
    evidenceDigest: "bb00429dbca08a026604c6f2aeeac988d757fbe10751a92ed7b7d7c2093bd119",
  });
  assert.equal(Object.isFrozen(supported), true);

  for (const [host, hostVersion] of [
    ["codex", "0.146.1"],
    ["cursor", "3.17.8"],
    ["opencode", "1.18.23"],
    ["claude", "2.1.240"],
  ] as const) {
    assert.deepEqual(
      jx3.evaluateSupport({ host, hostVersion, evidenceRoot: process.cwd() }),
      { eligible: false, code: "host_version_unsupported" },
      `${host}@${hostVersion}`,
    );
    assert.equal(
      Object.isFrozen(
        jx3.evaluateSupport({ host, hostVersion, evidenceRoot: process.cwd() }),
      ),
      true,
    );
  }
});

test("navigation declares the shared four-host update notice runtime", () => {
  const contribution = registry.getCapabilityProvider("kcoderag-navigation").contribution();
  assert.deepEqual(
    contribution.files.find((file) => file.id === "navigation:update-notice"),
    {
      id: "navigation:update-notice",
      sourcePath: "dist/hooks/update-notice.cjs",
      kind: "handler",
      shared: true,
    },
  );
  assert.equal(contribution.sections.some((section) => section.id === "navigation:post-tool"), true);
});

test("providers contain no project mutation or network authority", () => {
  for (const relativePath of [
    "src/capabilities/navigation.cts",
    "src/capabilities/jx3-style-nudge.cts",
  ]) {
    const source = fs.readFileSync(path.resolve(relativePath), "utf8");
    assert.doesNotMatch(source, /node:(?:fs|http|https|net)|core\/transaction|cli\/commands/);
    assert.doesNotMatch(source, /\b(?:writeFile|mkdir|rm|rename|fetch)\b/);
  }
});
