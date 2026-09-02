# Phase 06: 四 Skill 公共接口与宿主交付模式 - Pattern Map

**Mapped:** 2026-09-02  
**Files analyzed:** 63 declared paths, grouped into 18 implementation surfaces  
**Analogs found:** 16 / 18 surfaces

## Scope Notes

- Phase 06 keeps exactly two internal capability IDs: \`kcoderag-navigation\` and \`code-style-nudge\`.
- The four public Skill names are delivery assets, not four new capabilities:
  \`$kcoderag\`, \`$kcoderag-manage\`, \`$kcoderag-feedback\`, and
  \`$kcoderag-code-style\`.
- Manual code-style delivery is required on all five hosts. Automatic native
  pre-write nudging remains receipt-gated to Claude Code \`2.1.241\`.
- No \`06-RESEARCH.md\` exists. Pattern assignments therefore use the live
  codebase and the locked decisions in \`06-CONTEXT.md\`.
- The current schema-v1 ownership graph remains authoritative. Do not add a
  migration, adoption, cleanup, alias capability, or root marketplace catalog.

## File Classification

| New/Modified File or Surface | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| \`plugin-src/skills/kcoderag/SKILL.md\` | component / instruction contract | request-response | \`plugin-src/skills/code-lookup-discipline/SKILL.md\` | exact role |
| \`plugin-src/skills/kcoderag-manage/SKILL.md\` | component / instruction contract | request-response | \`plugin-src/skills/code-lookup-discipline/SKILL.md\` plus \`src/cli/commands.cts\` | role + flow |
| \`plugin-src/skills/kcoderag-feedback/SKILL.md\` | component / instruction contract | request-response | \`plugin-src/skills/code-lookup-discipline/SKILL.md\` | role-match |
| \`plugin-src/capabilities/code-style-nudge/skill/SKILL.md\` and four \`references/*.md\` | component / reference content | transform | existing code-style Skill and references | exact |
| Four \`agents/openai.yaml\` files | config / discovery metadata | request-response | no repository-local analog | none |
| Removal of \`plugin-src/skills/code-lookup-discipline/\` and old public style name | config / owned asset rename | file-I/O | \`src/capabilities/compose.cts\` previous-owned-file deletion | flow-match |
| \`src/capabilities/contracts.cts\`, \`registry.cts\`, \`navigation.cts\`, \`code-style-nudge.cts\` | provider / model | transform | current two providers and registry | exact |
| \`src/capabilities/compose.cts\` | service | file-I/O / transform | current complete desired-state composer | exact |
| \`src/hosts/host-version-support.cts\` | policy provider | request-response | current receipt support table | exact |
| \`src/hosts/codex.cts\`, \`claude.cts\`, \`cursor.cts\`, \`opencode.cts\`, \`zcode.cts\` | provider / adapter | file-I/O / transform | existing five host adapters | exact |
| \`src/core/contracts.cts\`, \`src/core/state.cts\`, \`src/cli/commands.cts\` | model + controller | request-response / read-only file-I/O | current status/doctor capability reporting | role-match |
| \`src/hooks/code-style-nudge.cts\`, \`src/hooks/pre-tool-dispatcher.cts\` | hook | event-driven | current fail-open, integrity-gated hook dispatch | exact |
| \`src/generator/index.cts\`, generated \`kcoderag-qa/skills/\`, \`kcoderag-cursor/skills/\` | generator / generated product | batch / file-I/O | current canonical-to-generated asset projection | exact |
| \`package.json\`, \`src/maintainer/pack-audit.cts\` | config + assurance | batch / file-I/O | current exact package inventory audit | exact |
| \`src/maintainer/docs-check.cts\`, \`pre-commit.cts\`, \`native-host-driver.cts\` | maintainer gate | batch | current required-gate and host-driver registries | exact |
| \`src/smoke/host-smoke.cts\` | smoke test / harness | request-response + file-I/O | current receipt/non-receipt lifecycle matrix | exact |
| Capability, CLI, host, hook, generator, maintainer, and smoke tests listed in \`06-CONTEXT.md\` | test | mixed, matching subject | adjacent tests in each existing suite | exact |
| \`README.md\`, \`plugin-src/README.md.tmpl\`, \`kcoderag-qa/README.md\`, \`docs/MCP_QA_EXPERIENCE_GUIDE.md\`, planning/AGENTS summaries | documentation | transform | current capability/status/lifecycle sections | role-match |

## Pattern Assignments

### 1. Canonical public Skill assets

**Targets**

- \`plugin-src/skills/kcoderag/SKILL.md\`
- \`plugin-src/skills/kcoderag-manage/SKILL.md\`
- \`plugin-src/skills/kcoderag-feedback/SKILL.md\`
- \`plugin-src/capabilities/code-style-nudge/skill/SKILL.md\`
- \`plugin-src/capabilities/code-style-nudge/skill/references/*.md\`
- deletion of the explicitly owned old public Skill paths

**Primary analog:** \`plugin-src/skills/code-lookup-discipline/SKILL.md\`

The current navigation Skill already supplies the concise routing and
tool-selection shape that the three navigation-family Skills should split
without creating a new internal capability.

**Tool routing pattern** (lines 21-32):

~~~markdown
| Need | Use |
| --- | --- |
| Find code by behavior or concept | semantic/code search |
| Inspect callers and callees | call relations |
| Understand a symbol in context | contextual lookup |
| Enumerate known projects or indexes | project/index listing |
| Traverse related code | graph navigation |
~~~

**Bounded workflow pattern** (lines 34-43):

~~~markdown
1. Identify the narrowest useful structural question.
2. Query KCodeRag before broad local text search.
3. Use returned paths and symbols to guide targeted local inspection.
4. Fall back to grep/glob when the graph is unavailable or the request is
   literal text search.
~~~

Copy this concise, action-oriented shape into \`$kcoderag\`. For
\`$kcoderag-manage\`, keep the same bounded structure but route only to the
existing CLI lifecycle: status and doctor by default, update only on an
explicit request. For \`$kcoderag-feedback\`, make a real KCodeRag result a
precondition and prohibit invented source text, credentials, endpoint details,
headers, or tokens.

**Secondary analog:** \`plugin-src/capabilities/code-style-nudge/skill/SKILL.md\`

The current style Skill already separates selection, bounded workflow, and
evidence. Preserve that structure and rename only the public interface.

**Review router pattern** (lines 77-85):

~~~markdown
| Change area | Load |
| --- | --- |
| C/C++ implementation | C++ reference |
| Protocol-facing code | protocol reference |
| Lua/UI script | Lua reference |
| Cleanup or review-only pass | hygiene reference |
~~~

**Evidence boundary pattern** (lines 87-94):

~~~markdown
- Report only findings supported by the inspected file or current diff.
- Keep the review bounded to the requested target.
- Do not claim repository-wide compliance from a local review.
- Do not expose configuration contents or credentials.
~~~

The new style Skill should expose natural-language pre-write guidance plus
\`review <file or current changes>\`. Do not add an \`apply\` command. The
existing hook's recognition of the host editing tool \`apply_patch\` is a
different concern and must remain.

**Reference preservation:** Keep the existing four references as the sole
long-form style payload. Their opening sections already implement selective
loading and evidence boundaries:

- \`references/cpp.md\` lines 3-6
- \`references/protocols.md\` lines 3-6
- \`references/lua.md\` lines 3-5
- \`references/code-hygiene.md\` lines 3-5 and bounded review lines 45-57

Do not duplicate those rules into the short \`SKILL.md\`.

### 2. Codex discovery metadata

**Targets:** each public Skill's \`agents/openai.yaml\`

**Analog:** none in this repository.

Use the locked metadata contract directly:

~~~yaml
interface:
  display_name: "<human-readable name>"
  short_description: "<25-64 character description>"
  default_prompt: "Use $<exact-public-skill-name> ..."
policy:
  allow_implicit_invocation: true
~~~

The exact schema spelling should be verified by generator/pack tests. The
important repository-specific rule is that implicit discovery only selects an
instruction surface; it never grants update, uninstall, cleanup, or any other
mutation authority.

### 3. Capability providers remain the only source of delivery ownership

**Targets**

- \`src/capabilities/contracts.cts\`
- \`src/capabilities/registry.cts\`
- \`src/capabilities/navigation.cts\`
- \`src/capabilities/code-style-nudge.cts\`
- \`src/hosts/host-version-support.cts\`

**Analog:** current capability provider contract and code-style provider.

**Provider contract pattern** — \`src/capabilities/contracts.cts\` lines 56-70:

~~~typescript
export type CapabilitySupportDecision =
  | {
      readonly supported: true;
      readonly receiptDigest?: string;
    }
  | {
      readonly supported: false;
      readonly code: "host_version_unsupported";
    };
~~~

The current binary support union is the seam to evolve. Phase 06 needs to
represent two independent delivery dimensions:

- manual Skill delivery: supported on all five hosts;
- automatic nudge delivery: supported only for the frozen Claude receipt.

Prefer an explicit immutable support result over inferring delivery from host
names or file shapes. Keep \`host_version_unsupported\` scoped to the automatic
nudge selection, not to manual style installation.

**Stable internal registry pattern** — \`src/capabilities/registry.cts\`
lines 15-22:

~~~typescript
const CAPABILITY_PROVIDERS = Object.freeze({
  "kcoderag-navigation": navigationCapabilityProvider,
  "code-style-nudge": codeStyleNudgeCapabilityProvider,
});
~~~

Do not add public Skill names to this registry. The first three Skills are
contributors of \`kcoderag-navigation\`; the style Skill and its references are
contributors of \`code-style-nudge\`.

**Receipt table pattern** — \`src/hosts/host-version-support.cts\` lines 12-49:

~~~typescript
export interface HostVersionSupportResult {
  readonly navigation: true;
  readonly codeStyleNudge: boolean;
  readonly code?: "host_version_unsupported";
  readonly receiptDigest?: string;
}

// The checked-in table contains only Claude Code 2.1.241.
// Unknown or unreceipted hosts keep navigation available and native style
// nudging unavailable.
~~~

Retain this exact receipt authority for automatic mode. Extend the result so
callers cannot confuse “manual style Skill is installed” with “native
pre-write hook is eligible.”

**Provider projection pattern** — \`src/capabilities/code-style-nudge.cts\`
lines 85-105:

~~~typescript
return Object.freeze({
  id: "code-style-nudge",
  files: Object.freeze(renderedFiles),
  sections: Object.freeze(renderedSections),
  supportReceiptDigest: support.receiptDigest,
});
~~~

Keep the provider pure: it selects deterministic files/sections and returns
them; it must not read host-global configuration, write files, spawn a process,
or access the network.

### 4. Five-host adapter projection: manual base plus optional native overlay

**Targets:** all files under \`src/hosts/\` named in the phase scope.

**Primary analog:** \`src/hosts/claude.cts\`

Claude already has the closest combined delivery shape: Skill/reference files
plus native hook sections and runtime files, guarded by an exact receipt.

**Exact native eligibility** (lines 239-254):

~~~typescript
const support = evaluateHostVersionSupport("claude", input.hostVersion);
if (!support.codeStyleNudge || support.receiptDigest === undefined) {
  throw new InstallError("host_version_unsupported");
}
return support.receiptDigest;
~~~

**Contributor composition** (lines 386-432, abbreviated only at repeated file
entries):

~~~typescript
const contributions = [];

if (capabilityIds.includes("kcoderag-navigation")) {
  contributions.push({
    capabilityId: "kcoderag-navigation",
    files: [navigationSkill, handler, dispatcher, marker],
    sections: [mcpSection, preToolSection, postToolSection],
  });
}

if (capabilityIds.includes("code-style-nudge")) {
  contributions.push({
    capabilityId: "code-style-nudge",
    files: [styleSkill, ...styleReferences, handler, dispatcher],
    sections: [stylePreToolSection],
  });
}
~~~

Refactor this into a shared conceptual shape for every host:

~~~text
code-style-nudge contributor
  = manual Skill + references                         (all five hosts)
  + native runtime + native pre-write section/receipt (Claude 2.1.241 only)
~~~

Avoid all-or-nothing \`assertSupport\` calls before the manual contribution is
rendered.

**Pure projected-file helper** — \`src/hosts/codex.cts\` lines 239-247:

~~~typescript
function projectedFile(path: string, content: string): ProjectedFile {
  return Object.freeze({
    path,
    content: normalizeGeneratedText(content),
  });
}
~~~

Use the adapter's current normalization, ordering, and freezing conventions for
each of the four new public Skill trees.

**Manual-only host pattern:** \`src/hosts/cursor.cts\` lines 89-115.

Cursor's current configuration already documents that it has no equivalent
PreToolUse behavior and owns only its real \`afterMCPExecution\` marker section.
Use that honesty as the model:

~~~typescript
const nextHooks = mergeCursorHooks(currentHooks, {
  afterMCPExecution: markerCommand,
});

// Do not create a fake PreToolUse section for Cursor.
~~~

For Phase 06, Cursor, Codex, OpenCode, and ZCode should still receive the manual
style Skill and references. They should not receive style pre-write runtime,
receipt, or section ownership. Existing navigation-related success markers
remain independent.

**ZCode gap to repair:** \`src/hosts/zcode.cts\` lines 410-452 currently returns
early unless navigation is selected and builds contributions only for
\`kcoderag-navigation\`. Copy the multi-contributor structure used by Codex and
Claude so style-only installation is representable without requiring
navigation.

**OpenCode configuration selection:** preserve
\`src/hosts/opencode.cts\` lines 63-70. JSON/JSONC ambiguity remains a hard
write-before-stop and manual style delivery does not weaken that boundary.

### 5. Complete ownership, rename cleanup, and atomic lifecycle

**Targets**

- \`src/capabilities/compose.cts\`
- \`src/core/state.cts\`
- \`src/core/transaction.cts\`
- all adapter desired-state assembly

**Primary analog:** current complete capability composer.

**Owned stale-file removal** — \`src/capabilities/compose.cts\` lines 624-638:

~~~typescript
for (const previousFile of previous.files) {
  if (!nextFilePaths.has(previousFile.path)) {
    entries.push({
      kind: "file",
      path: previousFile.path,
      content: undefined,
      expectedDigest: previousFile.digest,
    });
  }
}

entries.push(stateEntry); // state remains last
~~~

This is the correct path for deleting explicitly owned
\`code-lookup-discipline\` and old style public paths during update. Never scan
and broadly delete similarly named user files. If the old path is not owned by
the current valid state, report the conflict and stop.

**Strict state validation** — \`src/core/state.cts\` lines 323-363:

~~~typescript
if (compositeDigest !== computeCompositeDigest({
  host,
  capabilities,
  files,
  sections,
})) {
  throw new InstallError("state_invalid", statePath);
}

return Object.freeze({
  schemaVersion: 1,
  host,
  capabilities: Object.freeze(capabilities),
  files: Object.freeze(files),
  sections: Object.freeze(sections),
  compositeDigest,
});
~~~

Do not infer manual or automatic delivery from mere path existence. First
decode the exact schema-v1 state and validate composite/per-contributor
ownership. Then inspect the actual owned contributor files and sections.

**Preflight-before-write** — \`src/core/transaction.cts\` lines 682-710:

~~~typescript
for (const entry of orderedEntries) {
  const before = await readEntryBeforeState(entry);
  assertExpectedDigest(entry, before);
  beforeStates.set(entryKey(entry), before);
}

// No target is staged or committed until all expected state has passed.
~~~

Preserve the transaction boundary for Skill renames and all host combinations.
The desired state must be complete, state must commit last, and any failure must
roll back the selected host as one unit.

### 6. Status and doctor report delivery dimensions, not capability guesses

**Targets**

- \`src/core/contracts.cts\`
- \`src/core/state.cts\`
- \`src/cli/commands.cts\`
- each adapter's \`status\` implementation

**Analog:** current stable, sorted \`StatusResult\` construction.

**Sanitized result construction** — \`src/core/state.cts\` lines 70-93:

~~~typescript
export function createStatusResult(input: StatusResult): StatusResult {
  return Object.freeze({
    ok: input.ok,
    code: input.code,
    host: input.host,
    projectRoot: normalizeSafePath(input.projectRoot),
    capabilities: Object.freeze([...input.capabilities].sort()),
    managedFiles: Object.freeze([...input.managedFiles].sort()),
    managedSections: Object.freeze([...input.managedSections].sort()),
  });
}
~~~

Extend this pattern with a stable delivery object for code style. Suggested
shape for planning purposes:

~~~typescript
interface CodeStyleDeliveryStatus {
  readonly manualSkill: "available" | "absent" | "drifted" | "unknown";
  readonly automaticNudge:
    | "available"
    | "unsupported"
    | "absent"
    | "drifted"
    | "unknown";
}
~~~

Exact enum names are at planner discretion, but the derivation is locked:

| Validated evidence | \`manualSkill\` | \`automaticNudge\` |
|---|---|---|
| healthy style contributor owns Skill + required references | available | derive separately |
| exact Claude receipt plus required native runtime and pre-write section | unchanged | available |
| non-receipted host with healthy manual files and no native ownership | available | unsupported |
| expected owned file/section digest differs | drifted | drifted if its delivery subset is affected |
| invalid/corrupt state or ambiguous ownership | unknown | unknown |
| capability not installed | absent | absent |

Do not make one aggregate capability health flag stand in for both columns.
Human and \`--json\` output must expose both fields consistently, and
\`status\`/\`doctor\` must remain read-only.

**CLI capability-result analog:** \`src/cli/commands.cts\` lines 518-567
already derives JSON payloads from adapter status and formats stable codes.
Extend that formatter; do not read MCP configuration bodies to populate the new
fields.

### 7. Automatic hook remains fail-open and changes only its public prompt

**Targets**

- \`src/hooks/code-style-nudge.cts\`
- \`src/hooks/pre-tool-dispatcher.cts\`
- generated hook payloads and tests

**Primary analog:** current code-style hook integrity gate.

**Required managed-state verification** —
\`src/hooks/code-style-nudge.cts\` lines 176-277:

~~~typescript
const state = await readNearestManagedState(input.cwd);
if (state === undefined || !state.capabilities.includes("code-style-nudge")) {
  return undefined;
}

if (!(await verifyCompositeDigest(state))) {
  return undefined;
}

if (!(await verifyRequiredManagedFiles(state, requiredPaths))) {
  return undefined;
}
~~~

Keep this boundary for native Claude automatic nudging. Change the emitted
advice from the retired public style name to:

~~~text
Load $kcoderag-code-style before editing.
~~~

Do not broaden the integrity requirement to manual-only hosts. A host that does
not install native pre-write runtime must not be expected to own the handler,
dispatcher, or native hook section merely to report its manual Skill healthy.

**Independent fail-open contributors** —
\`src/hooks/pre-tool-dispatcher.cts\` lines 351-367:

~~~typescript
for (const contributor of contributors) {
  try {
    const contribution = await contributor(input);
    if (contribution !== undefined) {
      output.push(contribution);
    }
  } catch {
    // A failed advisory contributor never blocks the host tool call.
  }
}
~~~

Keep raw-input bounds and top-level error handling from lines 386-431. Hook
stdout remains either valid host protocol output or empty, with exit code 0.

The exact Claude baseline remains centralized in
\`pre-tool-dispatcher.cts\` lines 23-26. Do not add non-Claude baselines or
infer compatibility from host type.

### 8. Deterministic generation and exact package inventory

**Targets**

- \`src/generator/index.cts\`
- \`kcoderag-qa/skills/**\`
- \`kcoderag-cursor/skills/**\`
- \`package.json\`
- \`src/maintainer/pack-audit.cts\`
- generator and pack tests

**Primary analog:** generator capability-group inventories.

**Canonical inventory pattern** — \`src/generator/index.cts\` lines 146-234:

~~~typescript
const CAPABILITY_GROUPS = Object.freeze({
  "kcoderag-navigation": Object.freeze([
    /* canonical navigation Skill/template inputs */
  ]),
  "code-style-nudge": Object.freeze([
    /* canonical style Skill, references, and eligible runtime inputs */
  ]),
});
~~~

Update the navigation group to include three public Skills and their three
Codex metadata files. Update the style group to include the renamed Skill,
metadata file, and four existing references. Keep the group count at exactly
two.

**Route-table pattern** — \`src/generator/index.cts\` lines 310-324:

~~~typescript
const TEMPLATE_ROUTES = Object.freeze([
  {
    source: canonicalPath,
    targets: Object.freeze([qaPath, cursorPath]),
  },
]);
~~~

Add explicit routes for every host product that consumes each asset. Do not
derive target paths by string replacement of an old public name; explicit
routes make the per-host ownership auditable.

**Deterministic rendering pattern** — \`src/generator/index.cts\`
lines 421-445:

~~~typescript
function renderTemplate(source: string, replacements: ReadonlyMap<string, string>): string {
  let rendered = normalizeGeneratedText(source);
  for (const [token, value] of [...replacements].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    rendered = rendered.replaceAll(token, value);
  }
  return rendered;
}
~~~

Preserve LF normalization, sorted output, and byte equality. The current
QA/Cursor render sections at lines 670-794 are the closest per-product analog.
Extend them to the four public names and all five adapter destinations.

**Orphan removal pattern** — \`src/generator/index.cts\` lines 969-985:

~~~typescript
for (const existingPath of existingGeneratedPaths) {
  if (!expectedPaths.has(existingPath)) {
    orphanedPaths.push(existingPath);
  }
}
~~~

The generator may remove retired generated assets because its output roots are
fully owned. This is distinct from installation cleanup, which may remove only
paths proven owned by current schema-v1 state.

**Exact pack allowlist** — \`src/maintainer/pack-audit.cts\` lines 38-84 and
199-252:

~~~typescript
const REQUIRED_PACKAGE_ASSETS = Object.freeze([
  /* every canonical/generated runtime and Skill asset */
]);

assertExactPathSet(archivePaths, expectedPackagePaths);
~~~

Update both the required canonical assets and exact archive inventory.
Pack validation at lines 294-367 must continue rejecting missing files,
unexpected files, placeholders, and credential-like material.

### 9. Tests copy the current matrix style, then change the expected policy

**Targets:** all capability, CLI, host, hook, generator, maintainer, and smoke
tests named in the phase context.

**Capability provider analog:**
\`tests/capabilities/providers.test.cts\` lines 55-115.

~~~typescript
assert.deepEqual(
  contribution.files.map((file) => file.path),
  expectedPaths,
);
assert.deepEqual(
  contribution.sections.map((section) => section.id),
  expectedSectionIds,
);
~~~

Use exact arrays for:

- the three navigation-family Skills plus metadata;
- the style Skill plus metadata and four references;
- Claude's additional automatic runtime/section;
- the four manual-only hosts' absence of style automatic runtime/section.

**Support-matrix analog:** the same test file lines 117-168 currently proves
one supported Claude version and four unsupported hosts. Change the expected
matrix to:

~~~text
all five hosts: manual style installation succeeds
Claude 2.1.241: automaticNudge = available
Codex/Cursor/OpenCode/ZCode and unreceipted versions:
  manualSkill = available
  automaticNudge = unsupported
~~~

Retain an explicit test that unsupported automatic mode makes zero writes if a
future CLI flag directly requests native automatic delivery.

**Cross-host isolation analog:** \`tests/hosts/cross-host.test.cts\`
lines 111-134 proves five-host coexistence and preservation of sibling bytes
when one capability is removed. Extend it to style-only and combined installs
on every host, including preservation across public-path renames.

**CLI read-only analog:** \`tests/cli/commands.test.cts\` lines 1213-1317
already verifies status/doctor read-only behavior, human/JSON output, and
conservative unknown membership on drift. Add exact manual/automatic delivery
assertions there rather than creating a second diagnostic path.

**Generator convergence analog:**
\`tests/generator/generation.test.cts\` lines 452-505:

~~~typescript
const first = await generate(...);
assert.deepEqual(first.changedPaths, expectedChangedPaths);

const second = await generate(...);
assert.deepEqual(second.changedPaths, []);

const before = await snapshotTree(...);
await check(...);
assert.deepEqual(await snapshotTree(...), before);
~~~

Add exact old-name absence assertions to canonical, generated, package, and
test inventories. Keep second generation a no-op and check mode read-only.

**Five-host smoke analog:** \`src/smoke/host-smoke.cts\` lines 2579-2737.
The current harness branches between receipt-host success and non-receipt-host
refusal. Replace that branch with a shared manual-success lifecycle and a
Claude-only automatic-evidence overlay:

~~~text
install style-only
  -> all hosts own manual Skill + references
  -> only receipted Claude owns native pre-write contribution
install combined
  -> navigation and style contributors coexist
status + doctor
  -> report manualSkill and automaticNudge independently
update
  -> rename/remove only state-owned retired public paths
partial uninstall
  -> preserves the sibling capability byte-for-byte
uninstall --all
  -> restores unrelated host configuration
~~~

Keep the existing runtime drift and transaction probes at lines 2398-2533.
Keep host versions centralized at lines 232-242.

### 10. Documentation and repository gates

**Targets**

- \`README.md\`
- \`plugin-src/README.md.tmpl\`
- \`kcoderag-qa/README.md\`
- \`docs/MCP_QA_EXPERIENCE_GUIDE.md\`
- \`src/maintainer/docs-check.cts\`
- \`src/maintainer/pre-commit.cts\`
- \`package.json\`
- generated planning/AGENTS summaries where maintained by their generator

**Analog:** current exact-topic documentation checks and required-gate
registries.

\`src/maintainer/docs-check.cts\` lines 69-77 and 150-170 already checks
capability names, status/doctor language, and the Claude-only support claim.
Update the checked phrases so documentation must state both truths:

1. manual \`$kcoderag-code-style\` is delivered on all five hosts;
2. automatic pre-write nudging is supported only for Claude Code \`2.1.241\`.

The forbidden-claim checks at lines 372-375 should reject language claiming
automatic parity on Codex, Cursor, OpenCode, or ZCode.

\`src/maintainer/pre-commit.cts\` lines 34-105 is the registry pattern for
canonical/generated roots and required test scripts. Rename the retired
style-test script entries there and in \`package.json\`; add the exhaustive
old-public-name scan as a required gate. Preserve index/worktree protection at
lines 247-281.

Do not hand-edit generated summaries if their existing repository generator
owns them; update the canonical source and prove convergence.

## Shared Patterns

### Immutable provider output

**Sources:** \`src/capabilities/*.cts\`, \`src/hosts/*.cts\`

Apply to every new Skill contributor and delivery-status object:

~~~typescript
return Object.freeze({
  ...value,
  files: Object.freeze([...files]),
  sections: Object.freeze([...sections]),
});
~~~

Adapters detect and render only. They do not commit.

### Host-neutral core, host-specific projection

**Sources:** \`src/hosts/host-adapter.cts\` lines 69-81 and
\`src/hosts/index.cts\`

Core contracts may describe \`manualSkill\` and \`automaticNudge\`, but path
selection, native section shape, config merge semantics, and host version
receipt checks remain in adapters.

### Capability-scoped ownership

**Sources:** \`src/capabilities/compose.cts\` lines 441-588 and
\`src/core/state.cts\` lines 373-417

Every new file and section must have one contributor capability. Compose the
complete selected-host state, sort it deterministically, compute its composite
digest, and commit state last.

### Secret-safe errors and diagnostics

**Sources:** \`src/core/contracts.cts\` lines 144-169,
\`src/core/state.cts\` lines 70-93, \`src/maintainer/pack-audit.cts\`
lines 294-367

Errors and receipts may include stable codes, host IDs, versions, digests, and
safe relative paths. They must never include MCP URL values, authorization
headers, bearer tokens, config bodies, or captured subprocess/network output.

### Fail-open advisory hooks

**Sources:** \`src/hooks/code-style-nudge.cts\` lines 394-423 and
\`src/hooks/pre-tool-dispatcher.cts\` lines 351-431

Malformed input, missing runtime, unsupported host, invalid state, drift, and
marker failures all return no advisory and exit successfully. They never block
the user's original tool call.

### Deterministic generated products

**Sources:** \`src/generator/index.cts\` lines 421-445 and 826-864

Canonical templates are the maintenance source. Generated QA/Cursor/host trees
are products. Sort inventories, normalize LF bytes, and verify that a second
generation changes nothing.

### Exact positive and negative inventories

**Sources:** \`src/maintainer/pack-audit.cts\` lines 38-84 and
\`tests/generator/generation.test.cts\` lines 365-446

Test both presence of every required new Skill/metadata/reference asset and
absence of both retired public names across canonical sources, generated
products, adapters, package inventory, maintainer gates, and tests.

## No Analog Found

| File / Contract | Role | Data Flow | Reason and Planner Guidance |
|---|---|---|---|
| Four \`agents/openai.yaml\` files | config | request-response | No current project asset uses Codex Skill discovery metadata. Implement the locked schema from \`06-CONTEXT.md\` and protect it with exact generator/pack tests. |
| Split delivery status (\`manualSkill\` vs \`automaticNudge\`) | model / diagnostics | request-response | Current status reports aggregate capability health only. Extend the existing immutable/sanitized result path; do not create a parallel state file or infer from host name. |

## Planner Warnings

- Do not implement four capabilities. Implement four public Skills projected by
  two existing capabilities.
- Do not retain aliases, frontmatter names, directories, generated artifacts,
  tests, package paths, or documentation using \`code-lookup-discipline\` or
  \`code-style-correction\`.
- Do not keep the current all-or-nothing style support refusal on non-Claude
  hosts; it blocks required manual delivery.
- Do not install native style handlers/dispatchers/sections on a manual-only
  host merely because the files already exist in the current provider.
- Do not weaken source-conflict, symlink, special-file, drift, ambiguity, or
  rollback rules while renaming owned paths.
- Do not add \`apply\` to the public style Skill. Do preserve recognition of
  the host's \`apply_patch\` editing tool in automatic hook classification.
- Do not claim authenticated MCP or non-Claude native pre-write evidence in
  Phase 06.

## Metadata

**Analog search scope:** \`plugin-src/\`, \`src/capabilities/\`,
\`src/core/\`, \`src/hosts/\`, \`src/hooks/\`, \`src/generator/\`,
\`src/maintainer/\`, \`src/smoke/\`, \`tests/\`, package/docs inventories  
**Strong analog families:** 5  
**Implementation surfaces classified:** 18  
**Pattern extraction date:** 2026-09-02
