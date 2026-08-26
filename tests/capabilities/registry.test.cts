const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

type CapabilityId = "kcoderag-navigation" | "jx3-style-nudge";

interface CapabilityContribution {
  readonly capabilityId: CapabilityId;
  readonly files: readonly Readonly<Record<string, unknown>>[];
  readonly sections: readonly Readonly<Record<string, unknown>>[];
}

interface CapabilityProvider {
  readonly id: CapabilityId;
  contribution(): CapabilityContribution;
}

const registry = require("../../dist/capabilities/registry.cjs") as {
  readonly BUILT_IN_CAPABILITIES: readonly CapabilityProvider[];
  getCapabilityProvider(id: CapabilityId): CapabilityProvider;
  resolveCapabilitySelection(ids: readonly string[]): readonly CapabilityProvider[];
  resolveCapabilityContributions(ids: readonly string[]): readonly CapabilityContribution[];
};

test("synthetic contract: the closed registry resolves navigation without host or installed assets", () => {
  assert.deepEqual(
    registry.BUILT_IN_CAPABILITIES.map((provider) => provider.id),
    ["kcoderag-navigation", "jx3-style-nudge"],
  );
  assert.equal(Object.isFrozen(registry.BUILT_IN_CAPABILITIES), true);
  assert.equal(
    registry.BUILT_IN_CAPABILITIES.every((provider) => Object.isFrozen(provider)),
    true,
  );

  const requested = [
    "jx3-style-nudge",
    "kcoderag-navigation",
    "kcoderag-navigation",
  ];
  const selected = registry.resolveCapabilitySelection(requested);
  assert.deepEqual(
    selected.map((provider) => provider.id),
    ["kcoderag-navigation", "jx3-style-nudge"],
  );
  assert.equal(Object.isFrozen(selected), true);
  assert.notStrictEqual(selected[0], registry.getCapabilityProvider("kcoderag-navigation"));

  requested[0] = "unknown-after-resolution";
  assert.deepEqual(
    selected.map((provider) => provider.id),
    ["kcoderag-navigation", "jx3-style-nudge"],
  );

  const contributions = registry.resolveCapabilityContributions([
    "kcoderag-navigation",
  ]);
  assert.equal(Object.isFrozen(contributions), true);
  assert.equal(contributions.length, 1);
  assert.equal(contributions[0]?.capabilityId, "kcoderag-navigation");
  assert.equal(Object.isFrozen(contributions[0]), true);
  assert.equal(Object.isFrozen(contributions[0]?.files), true);
  assert.equal(Object.isFrozen(contributions[0]?.sections), true);
  assert.notStrictEqual(
    contributions[0],
    registry.resolveCapabilityContributions(["kcoderag-navigation"])[0],
  );

  assert.throws(
    () => registry.resolveCapabilitySelection([]),
    (error: unknown) =>
      error instanceof Error && error.message === "capability_selection_required",
  );
  assert.throws(
    () => registry.resolveCapabilitySelection(["unknown-capability"]),
    (error: unknown) =>
      error instanceof Error && error.message === "unknown_capability",
  );
  assert.throws(
    () => registry.resolveCapabilitySelection([""]),
    (error: unknown) =>
      error instanceof Error && error.message === "invalid_capability_id",
  );
});
