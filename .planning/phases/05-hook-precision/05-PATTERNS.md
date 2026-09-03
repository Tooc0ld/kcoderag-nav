# Phase 5: 统一 Hook 策略与真实宿主验证 - Pattern Map

**Mapped:** 2026-09-02
**Scope source:** `05-CONTEXT.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`
**RESEARCH.md:** Not present; assignments below prefer current repository code and the locked phase decisions.
**Classified file/file-family entries:** 36
**Analogs found:** 33 / 36

## Scope Notes

- `05-CONTEXT.md` names 13 canonical implementation files directly and implies normalized event dispatch, SessionStart, feedback, host registration, generator/package, test/smoke, receipt, and CI work.
- Generated `kcoderag-qa/`, `kcoderag-cursor/`, `dist/`, and `dist-tests/` trees are products, not maintenance sources. Plans must change `.cts`/`plugin-src`/tests and regenerate.
- The working tree already contains unrelated changes, including `docs/MCP_QA_EXPERIENCE_GUIDE.md`. Any plan touching that guide must preserve the existing hunk baseline rather than replacing the file wholesale.
- The current `optional-live` path is only a partial analog. It intentionally permits `NOT_RUN` and the workflow uses `continue-on-error`; D-14/D-19 explicitly require Phase 5 LIVE gates to reject `FAIL`, `NOT_RUN`, missing receipts, and artifact hash mismatch.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/hooks/event-dispatcher.cts` (new, implied) | middleware | event-driven / transform | `src/hooks/pre-tool-dispatcher.cts` | role-match |
| `src/hooks/reminder-governor.cts` (new, implied) | utility | event-driven / file-I/O | `src/hooks/once-marker.cts` | role-match |
| `src/hooks/session-start.cts` (new, implied) | middleware | event-driven / file-I/O | `src/hooks/pre-tool-dispatcher.cts` + `src/hooks/update-notice.cts` | role-match |
| `src/hooks/feedback-nudge.cts` (new, implied) | middleware | event-driven / file-I/O | Component patterns only: `src/hooks/mcp-call-marker.cts` + `src/hooks/once-marker.cts` | none |
| `src/hooks/pre-tool-dispatcher.cts` | middleware | event-driven / transform | itself | exact |
| `src/hooks/grep-nudge.cts` | utility | transform | itself | exact |
| `src/hooks/code-style-nudge.cts` | utility | transform / file-I/O | itself | exact |
| `src/hooks/once-marker.cts` | utility | file-I/O / event-driven | itself | exact |
| `src/hooks/session-cleanup.cts` | utility | event-driven / file-I/O | itself | exact |
| `src/hooks/mcp-call-marker.cts` | middleware | event-driven / file-I/O | itself | exact |
| `src/hooks/update-check.cts`, `update-worker.cts`, `update-notice.cts` (3) | service / middleware | file-I/O / event-driven | themselves | exact |
| `src/capabilities/contracts.cts`, `navigation.cts`, `code-style-nudge.cts` (3) | config / provider | transform | current provider declarations | exact |
| `src/hosts/host-version-support.cts` | config | transform | current frozen receipt table | exact |
| `src/hosts/codex.cts`, `claude.cts`, `zcode.cts` (3) | provider | request-response / transform | current native hook merge implementations | exact |
| `src/hosts/cursor.cts` | provider | event-driven / transform | current Cursor Rule/event projection | exact |
| `src/hosts/opencode.cts` | provider | event-driven / transform | current project plugin projection | exact |
| `src/generator/index.cts` | service / config | batch / file-I/O / transform | current capability asset groups | exact |
| `plugin-src/hooks/hooks.json` | config | event-driven | current `PreToolUse`/`PostToolUse` registration | exact |
| `plugin-src/opencode/kcoderag-nav.js` | middleware / plugin | event-driven | current `tool.execute.after` callback | exact |
| `plugin-src/skills/code-lookup-discipline/SKILL.md` | config / guidance | request-response | current routing table and fallback policy | exact |
| `src/fixtures/host-delivery.cts`, `src/hosts/host-version-support.cts` (2) | fixture / config | batch / file-I/O / transform | current closed PASS receipt and digest binding | exact |
| `src/smoke/acceptance-receipt.cts` (new, implied) | model / utility | transform | Component patterns only: `src/fixtures/host-delivery.cts` + `src/maintainer/readiness-workflow.cts` | none |
| `src/smoke/live-host-coordinator.cts` (new, implied) | service | batch / event-driven | Component patterns only: `src/smoke/host-smoke.cts` | none |
| `src/smoke/host-smoke.cts` | service | batch / request-response / file-I/O | itself | exact |
| `src/maintainer/acceptance-workflow.cts` (new, implied) | service | batch / file-I/O | `src/maintainer/readiness-workflow.cts` | role-match |
| `src/maintainer/pack-audit.cts` | utility | batch / file-I/O | current closed package inventory | exact |
| `package.json` | config | batch | current explicit package allow-list and focused scripts | exact |
| `.github/workflows/ci.yml`, `.github/workflows/acceptance.yml` (2) | config | batch / event-driven | `.github/workflows/readiness.yml` | role-match |
| `docs/MCP_QA_EXPERIENCE_GUIDE.md` | config / documentation | request-response | current repository-owned guide | exact |
| `tests/hooks/event-dispatcher.test.cts`, `reminder-governor.test.cts`, `session-start.test.cts`, `feedback-nudge.test.cts` (4 new, implied) | test | event-driven / file-I/O | `tests/hooks/pre-tool-dispatcher.test.cts`, `once-marker.test.cts`, `mcp-call-marker.test.cts` | role-match |
| Existing `tests/hooks/{pre-tool-dispatcher,grep-nudge,code-style-nudge,once-marker,session-cleanup,mcp-call-marker,update-check,update-notice}.test.cts` (8) | test | transform / event-driven / file-I/O | themselves | exact |
| `tests/hosts/{codex,claude,cursor,opencode,zcode,cross-host}.test.cts` (6) | test | request-response / event-driven | current lifecycle and native merge tests | exact |
| `tests/generator/{generation,qa-product,repository-generation}.test.cts` (3) | test | batch / file-I/O | current exact inventory/drift tests | exact |
| `tests/fixtures/host-delivery.test.cts` | test | transform / file-I/O | current receipt schema/secret tests | exact |
| `tests/smoke/host-smoke.test.cts`, `tests/smoke/live-host-coordinator.test.cts` (1 modified, 1 new) | test | batch / event-driven | current smoke evidence tests | role-match |
| `tests/maintainer/{ci-contract,pack-audit}.test.cts` (2) | test | batch / file-I/O | current workflow and inventory contract tests | exact |
| `tests/maintainer/docs-check.test.cts` | test | transform | current host-honesty documentation checks | exact |

## Pattern Assignments

### `src/hooks/event-dispatcher.cts`, `src/hooks/pre-tool-dispatcher.cts`, `src/hooks/session-start.cts`

**Analog:** `src/hooks/pre-tool-dispatcher.cts`

Keep the single-parse, contributor isolation, deterministic order, and one bounded protocol response. Generalize the normalized event and response renderer; do not duplicate a dispatcher per capability.

**Imports and optional-module fail-open pattern** (`src/hooks/pre-tool-dispatcher.cts:4-7`, `39-53`):

```typescript
const fs = require("node:fs") as typeof import("node:fs");
import type { HostId } from "../core/contracts.cjs";
import { codeStyleContribution } from "./code-style-nudge.cjs";

const navigation: NavigationModule | undefined = (() => {
  try {
    return require("./grep-nudge.cjs") as NavigationModule;
  } catch {
    return undefined;
  }
})();
```

**Ordered contributor registry pattern** (`src/hooks/pre-tool-dispatcher.cts:70-104`):

```typescript
export function createDefaultContributors(
  runtime: DispatcherRuntimeOptions = {},
): readonly PreToolContributor[] {
  // Normalize host/root/state once, then give every contributor the same payload.
  return Object.freeze([
    (payload) => {
      const contribution = navigation?.navigationContribution(payload, notice);
      // Scheduling is advisory; foreground output never waits for the worker.
      return contribution;
    },
    (payload) => codeStyleContribution(payload, options),
  ]);
}
```

**Bounded response and exception isolation** (`src/hooks/pre-tool-dispatcher.cts:107-149`):

```typescript
function responseForContexts(contexts: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (contexts.length === 0) return undefined;
  const additionalContext = contexts.join("\n\n").slice(0, MAX_ADDITIONAL_CONTEXT_CHARS);
  if (additionalContext.length === 0) return undefined;
  return Object.freeze({
    hookSpecificOutput: Object.freeze({ hookEventName: "PreToolUse", additionalContext }),
  });
}

for (const contributor of contributors) {
  try {
    const context = contributor(payload);
    if (typeof context === "string" && context.length > 0) contexts.push(context);
  } catch {
    continue;
  }
}
```

Apply the same shape to `SessionStart`, but render the real event name and host-native output shape. `startup`, `resume`, `clear`, and `compact` should call the same baseline contributors; epoch transitions belong in the governor, not in prompt text.

---

### `src/hooks/reminder-governor.cts`, `src/hooks/once-marker.cts`, `src/hooks/session-cleanup.cts`

**Analog:** `src/hooks/once-marker.cts`

Use one hash-only scope material builder for `host + normalized managed root + capability + stable session identity + context epoch + reminder kind`. Preserve exclusive-create capacity locking and fail-open saturation. Extend the current capability restriction instead of adding unrelated marker implementations.

**Secret-free key pattern** (`src/hooks/once-marker.cts:147-162`):

```typescript
const material = [
  "kcoderag-nav-nudge-v1",
  options.host,
  managedRoot,
  options.capability,
  identity.field,
  identity.value,
].join("\0");
return crypto.createHash("sha256").update(material, "utf8").digest("hex");
```

**Exclusive capacity/claim pattern** (`src/hooks/once-marker.cts:171-214`):

```typescript
const lockPath = path.join(directoryPath, CAPACITY_LOCK);
if (!files.createExclusive(lockPath)) return suppressed(key);
try {
  const names = files.listFiles(directoryPath);
  const markerName = `${key}.claim`;
  if (names.includes(markerName)) return suppressed(key);
  if (names.filter((name) => MARKER_NAME_RE.test(name)).length >= MAX_NUDGE_MARKERS) {
    return suppressed(key);
  }
  claimed = files.createExclusive(path.join(directoryPath, markerName));
} finally {
  // Release failure retracts the new claim; the original tool remains unaffected.
}
```

**Receipt-gated cleanup pattern** (`src/hooks/session-cleanup.cts:44-60`):

```typescript
if (!isRecord(payload) || payload.hook_event_name !== "SessionEnd") return false;
const identity = stableSessionIdentity(payload);
if (identity === undefined) return false;
const isProven = options.receiptProvesSessionEnd ?? sessionEndCleanupProven;
if (!isProven(options.host, identity.field)) return false;
const key = nudgeMarkerKey(payload, options);
if (key === undefined) return false;
return (options.remove ?? removeExactFile)(markerPath);
```

Do not infer `clear`, `compact`, `resume`, or `SessionEnd` from tool counts or elapsed time. Normalize a new epoch only when the native event source is reliable. Keep automatic cleanup disabled per host until the exact LIVE receipt proves stable SessionEnd identity.

---

### `src/hooks/grep-nudge.cts` and `src/hooks/code-style-nudge.cts`

**Analogs:** themselves

Keep matchers broad only as wake-up filters; final visibility is a pure semantic decision made before a once claim.

**Navigation classifier boundary** (`src/hooks/grep-nudge.cts:288-331`):

```typescript
if (explicitPatterns.length > 0) return isLocalOnlyScope(positional) ? [] : explicitPatterns;
if (isLocalOnlyScope(positional.slice(1))) return [];

export function navigationContribution(data: unknown, updateNotice?: string): string | undefined {
  if (!isRecord(data)) return undefined;
  if (typeof data.tool_name === "string" && !SUPPORTED_TOOLS.has(data.tool_name)) return undefined;
  if (!isRecord(data.tool_input)) return undefined;
  const structural = lookupPatterns(data.tool_input).some((pattern) => looksLikeSymbolLookup(pattern));
  if (!structural && !updateNotice) return undefined;
  return contexts.join("\n\n").slice(0, 600);
}
```

Extend this classifier with explicit fields for fixed-string mode, multiple explicit files, generated/log text, deep narrow directories, Lua global handlers, qualified Lua methods, and unique C++ symbols. The classifier should return an intent decision; the governor should consume a marker only after that decision is eligible.

**Structured-write-before-claim pattern** (`src/hooks/code-style-nudge.cts:374-409`):

```typescript
export function structuredMutationPaths(payload: unknown): readonly string[] {
  if (!isRecord(payload) || typeof payload.tool_name !== "string" || !isRecord(payload.tool_input)) {
    return Object.freeze([]);
  }
  if (STRUCTURED_WRITE_TOOLS.has(payload.tool_name)) return Object.freeze([path]);
  if (payload.tool_name === "apply_patch") return nativePatchMutationPaths(payload.tool_input.command);
  return Object.freeze([]);
}

if (!structuredMutationPaths(payload).some(isCodeStyleSourcePath)) return undefined;
if (!evaluateCodeStyleIntegrity(options).ok) return undefined;
const claim = claimNudgeOnce(payload, scope);
return claim.claimed ? CODE_STYLE_NUDGE : undefined;
```

Preserve the order: structured target -> eligible source extension -> full managed integrity -> governor claim -> prompt. Bash writes, docs, JSON, logs, malformed patches, or integrity failures must not consume the epoch claim.

---

### `src/hooks/feedback-nudge.cts` and `src/hooks/mcp-call-marker.cts`

**Analog:** `src/hooks/mcp-call-marker.cts` (partial)

Reuse per-host payload normalization, but split the result into a normalized logical tool name and a reliable success decision before updating either feedback state. The existing function recognizes a namespace but does not yet prove success or distinguish `list_indexes`, result tools, and `submit_feedback`.

**Host-specific narrowing pattern** (`src/hooks/mcp-call-marker.cts:99-117`):

```typescript
if (host === "cursor") {
  return (payload.mcp_server_name === "kcoderag" || payload.mcp_server_name === "kcoderag-qa") &&
    (payload.hook_event_name === undefined || payload.hook_event_name === "afterMCPExecution");
}
if (host === "opencode") {
  const tool = boundedString(payload.tool);
  return tool !== undefined && /^kcoderag-qa_/u.test(tool);
}
const toolName = boundedString(payload.tool_name);
return toolName !== undefined && /^mcp__kcoderag[-_]qa__.+/u.test(toolName);
```

**Metadata-only record pattern** (`src/hooks/mcp-call-marker.cts:150-171`):

```typescript
const markerIdentity = identity(payload, options.host, options.cwd ?? process.cwd());
if (markerIdentity === undefined) return Object.freeze({ recorded: false });
files.createExclusive(path.join(directoryPath, name), `${JSON.stringify({
  schemaVersion: MCP_CALL_MARKER_SCHEMA_VERSION,
  host: options.host,
  scope: markerIdentity.scope,
  recordedAt: now,
})}\n`);
return Object.freeze({ recorded: true, key: name.slice(0, -5) });
```

Implement two state kinds through the governor:

- `feedback-reminded`: keyed by context epoch; a successful `search_code`, `context`, or `get_call_chain` may claim it once.
- `feedback-submitted`: keyed by the whole stable session; only successful `submit_feedback` writes it and it suppresses later epochs.

`list_indexes`, failures, cancellations, timeouts, ambiguous success, and failed feedback submissions write neither success state nor a new reminder claim.

---

### `src/hooks/update-check.cts`, `src/hooks/update-worker.cts`, `src/hooks/update-notice.cts`

**Analogs:** themselves

SessionStart should reuse the existing strict cache and detached worker; change only event eligibility/normalization. Do not move registry access into the foreground dispatcher.

**Strict cache and newer-only prompt** (`src/hooks/update-check.cts:186-204`, `335-357`):

```typescript
if (
  !isRecord(document) ||
  Object.keys(document).sort().join(",") !== "checkedAt,latest,schemaVersion" ||
  document.schemaVersion !== CACHE_SCHEMA_VERSION ||
  typeof document.checkedAt !== "number" ||
  !isSimpleVersion(document.latest)
) return undefined;

if (!isFresh(latest, now)) return undefined;
if (!isNewerVersion(installedVersion, latest.latest)) return undefined;
return `KCodeRag Nav update available: ${installedVersion} -> ${latest.latest}. ` +
  `Ask the user first; do not update automatically. Run: ${updateCommand(options.host)}`;
```

**Detached foreground scheduling** (`src/hooks/update-check.cts:360-388`):

```typescript
if (isFresh(readCache(files, cacheRoot), now)) return false;
if (!claimSession(files, cacheRoot, hookPayload, now)) return false;
const child = spawn(runtimePath, [workerPath, "--refresh", cacheRoot], {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});
child.unref?.();
return true;
```

**Fixed registry, bounded response, atomic write** (`src/hooks/update-worker.cts:63-83`, `133-153`):

```typescript
if (response.statusCode !== 200 || response.url !== REGISTRY_URL ||
    response.body.length > MAX_RESPONSE_BYTES) return undefined;
const latest = document["dist-tags"].latest;
return updateCheck.isSimpleVersion(latest) ? latest : undefined;

handle = await fs.open(temporaryPath, "wx", 0o600);
await handle.writeFile(`${JSON.stringify(cache)}\n`, "utf8");
await handle.sync();
await handle.close();
await fs.rename(temporaryPath, path.join(cacheRoot, "remote-cache.json"));
```

---

### Capability declarations, host adapters, and canonical host assets

**Analogs:** `src/capabilities/navigation.cts`, `src/hosts/codex.cts`, `src/hosts/zcode.cts`, `plugin-src/opencode/kcoderag-nav.js`

Add every new compiled handler/launcher/registration as a provider requirement first, then project it through each adapter. Adapters remain read/render-only and preserve unrelated native entries.

**Closed provider inventory pattern** (`src/capabilities/navigation.cts:10-98`):

```typescript
const NAVIGATION_REQUIREMENTS: CapabilityContribution = copyCapabilityContribution({
  capabilityId: "kcoderag-navigation",
  files: [
    { id: "navigation:pre-tool-handler", sourcePath: "dist/hooks/grep-nudge.cjs", kind: "handler", shared: true },
    { id: "navigation:success-marker", sourcePath: "dist/hooks/mcp-call-marker.cjs", kind: "marker", shared: true },
  ],
  sections: [
    { id: "navigation:mcp", kind: "mcp", shared: true },
    { id: "navigation:pre-tool", kind: "pre-tool", shared: true },
    { id: "navigation:post-tool", kind: "post-tool", shared: true },
  ],
});
```

The section kind union in `src/capabilities/contracts.cts:17` currently covers only `mcp | pre-tool | post-tool`; extend it for SessionStart/SessionEnd only if those sections are genuinely managed separately.

**Unrelated-entry-preserving native merge** (`src/hosts/codex.cts:184-199`):

```typescript
for (const event of ["PreToolUse", "PostToolUse"] as const) {
  const currentEntries = hooks[event] === undefined ? [] : hooks[event];
  if (!Array.isArray(currentEntries)) throw new InstallError("invalid_json", HOOKS_PATH);
  const unrelated = currentEntries.filter((entry) => !JSON.stringify(entry).includes("kcoderag-nav"));
  if (!owned && unrelated.length !== currentEntries.length) {
    throw new InstallError("unmanaged_name_conflict", HOOKS_PATH);
  }
  hooks[event] = managed === undefined ? unrelated : [...unrelated, managed];
}
```

**ZCode native process event pattern** (`src/hosts/zcode.cts:259-279`, `329-336`):

```typescript
function processHook(scriptName: string, args: readonly string[] = []): JsonMap {
  return Object.freeze({
    type: "process",
    command: "node",
    args: Object.freeze([`${MANAGED_HOOK_ARGUMENT_PREFIX}${scriptName}`, ...args]),
    timeoutMs: 5_000,
  });
}

events: Object.freeze({
  ...events,
  PreToolUse: Object.freeze([...existingPre.filter((item) => !isManagedHookEntry(item)), pre]),
  PostToolUse: Object.freeze([...existingPost.filter((item) => !isManagedHookEntry(item)), post]),
}),
```

Add SessionStart/SessionEnd arrays with the same preservation rule only for hosts whose native contract is proven. Do not add them to Cursor/OpenCode to manufacture parity.

**Cursor honest native-event projection** (`src/hosts/cursor.cts:89-109`):

```typescript
const desired = new Map<string, JsonMap | undefined>([
  ["afterMCPExecution", selected.includes(NAVIGATION) ? managedHook(markerCommand) : undefined],
  ["postToolUse", selected.includes(NAVIGATION) ? managedHook(updateCommand) : undefined],
]);
// Rule + Skill + MCP stay the navigation baseline; no fake SessionStart/PreToolUse claim.
```

**OpenCode callback isolation** (`plugin-src/opencode/kcoderag-nav.js:10-29`):

```javascript
export const KCodeRagNav = async ({ client, directory }) => ({
  "tool.execute.after": async (input) => {
    try { recordKCodeRagCall(input, { host: "opencode" }); } catch {}
    try {
      const notice = readHostUpdateNotice("opencode", input, { cwd: directory });
      scheduleHostUpdateRefresh("opencode", input, { cwd: directory, runtimePath: "node" });
      if (notice) void Promise.resolve(client.tui.showToast({ body: { message: notice, variant: "warning" } })).catch(() => {});
    } catch {}
  },
});
```

---

### `src/generator/index.cts`, `package.json`, and pack inventory

**Analog:** current generator capability projection

**Capability-owned asset groups** (`src/generator/index.cts:188-217`):

```typescript
const NAVIGATION_QA_GROUPS = canonicalGroups({
  runtime: [
    "hooks/grep-nudge.cjs",
    "hooks/mcp-call-marker.cjs",
    "hooks/pre-tool-dispatcher.cjs",
    "hooks/update-check.cjs",
    "hooks/update-notice.cjs",
    "hooks/update-worker.cjs",
  ],
  registration: QA_RUNTIME_LAUNCHER.concat(QA_RUNTIME_REGISTRATION),
  guidance: QA_METADATA_GUIDANCE,
});
```

**Canonical source routing and capability filtering** (`src/generator/index.cts:636-679`):

```typescript
if (relativePath === "hooks/pre-tool-dispatcher.cjs") {
  return readBytes(inputs.sourceRoot, "dist/hooks/pre-tool-dispatcher.cjs");
}
if (relativePath === "hooks/hooks.json") {
  const registration = readJson(inputs.sourceRoot, "plugin-src/hooks/hooks.json");
  const rendered = renderCommand(registration);
  const hooks = { ...rendered.hooks };
  if (!capabilities.includes("kcoderag-navigation")) delete hooks.PostToolUse;
  return canonicalJson({ ...rendered, hooks });
}
```

For every new runtime asset, update together: capability provider, generator group, render routing, package `files`, pack audit inventory, generated-product tests, repository-generation test, and focused npm scripts. Do not add generated outputs as independent edit tasks.

---

### Receipt schema and LIVE coordinator

**Analogs:** `src/fixtures/host-delivery.cts`, `src/smoke/host-smoke.cts`, `src/maintainer/readiness-workflow.cts`

Use a new exact-key schema with independent `status`, `stage`, `reasonCode`, and `evidenceLevel`. Reuse strict parsing/freezing/digest binding; do not reuse the old single `reason` field as the new schema.

**Closed receipt parser** (`src/fixtures/host-delivery.cts:319-355`):

```typescript
if (!isRecord(value) || !exactKeys(value, RECEIPT_KEYS) || value.schemaVersion !== 1 ||
    !HOSTS.includes(value.host as HostId) || !EXACT_VERSION.test(value.version) ||
    !safeReason(value.reason)) {
  throw new Error("invalid_receipt");
}
if (value.verdict === "PASS" && (
  value.reason !== "verified" || value.stableSessionField === null ||
  OBSERVATION_KEYS.some((key) => !observations[key])
)) throw new Error("invalid_receipt");
return Object.freeze({ ...closedFields, observations });
```

**Atomic receipt write** (`src/fixtures/host-delivery.cts:790-799`):

```typescript
fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
const temporaryPath = `${receiptPath}.${process.pid}.tmp`;
fs.writeFileSync(temporaryPath, canonicalJson(receipt), { flag: "wx", mode: 0o600 });
fs.renameSync(temporaryPath, receiptPath);
```

**Current smoke result is only a migration source** (`src/smoke/host-smoke.cts:299-348`):

```typescript
if (input.unavailableReason !== undefined) {
  return Object.freeze({ status: "NOT_RUN", reason: input.unavailableReason, evidence });
}
const complete = requiredKeys.every((key) => evidence[key]);
return Object.freeze({
  status: complete ? "PASS" : "FAIL",
  reason: complete ? "verified" : (input.failureReason ?? "evidence_incomplete"),
  evidence,
});
```

Replace this for Phase 5 receipts with stage-specific reason codes. A missing host binary/login/trust is `NOT_RUN + reasonCode`; an executed native host that violates SessionStart, semantic prompt, MCP, feedback, or fail-open behavior is `FAIL + reasonCode`.

The current coordinator is serial (`src/smoke/host-smoke.cts:2875-2898`). The new coordinator must instead run Codex/Claude/OpenCode in isolated parallel lanes, then Cursor and ZCode serially, with per-host timeout, process-tree cleanup, and independent metadata-only receipts.

---

### Exact tgz handoff and GitHub workflows

**Analog:** `src/maintainer/readiness-workflow.cts` and `.github/workflows/readiness.yml`

Reuse the one-package job -> artifact download -> SHA verification model. Do not rebuild inside LIVE.

**Single package creation and upload** (`src/maintainer/readiness-workflow.cts:326-356`):

```typescript
lease = releaseReadiness.createCandidatePackageArtifact({
  root: provenance.root,
  consumers: ["pack-audit", "tar-scan", "host-smoke", "workflow-upload"],
});
const artifact = lease.artifact;
packAudit.auditPackArtifact(lease, { root: provenance.root });
const smoke = await runHostSmoke({ mode: "required-contract", artifactLease: lease });
assertSmokePass(smoke, artifact);
const uploaded = await uploadCandidateArtifactFromLease(lease);
failUnless(uploaded.sha256 === artifact.sha256, "artifact_metadata_drift");
```

**Downloaded artifact identity check** (`src/maintainer/readiness-workflow.cts:411-456`):

```typescript
const rootEntries = fs.readdirSync(artifactRoot, { withFileTypes: true });
failUnless(rootEntries.length === 1, "downloaded_artifact_root_invalid");
handle = fs.openSync(realFile, fs.constants.O_RDONLY | noFollow);
const opened = fs.fstatSync(handle);
const bytes = fs.readFileSync(handle);
const digest = crypto.createHash("sha256").update(bytes).digest("hex");
failUnless(
  opened.isFile() && !fileMetadata.isSymbolicLink() &&
  digest === input.artifactSha256 && entries.length === input.memberCount,
  "downloaded_artifact_identity_invalid",
);
```

**Workflow dependency pattern** (`.github/workflows/readiness.yml:48-81`):

```yaml
linux-node22:
  needs: package
  runs-on: ubuntu-latest
  steps:
    - uses: actions/download-artifact@<immutable-sha>
      with:
        artifact-ids: ${{ needs.package.outputs.artifact-id }}
        path: ${{ runner.temp }}/candidate-artifact
    - run: >-
        npm run readiness:workflow-lane --
        --artifact-sha256 "${{ needs.package.outputs.artifact-sha256 }}"
```

Phase 5 workflow changes must enforce:

- Hosted `windows/linux x node 22/24` PACKAGED matrix on ordinary PRs.
- Windows self-hosted Node 22 LIVE only behind protected branch/manual approval/`workflow_dispatch`; never on untrusted fork code.
- LIVE job downloads the hosted job's exact tgz and validates the SHA before any host starts.
- No `continue-on-error` on the required LIVE gate; every host must produce a current receipt and `PASS`.
- `liveOs: windows` and `packagedOs: [windows, linux]` remain explicit; no Linux LIVE claim.

---

### Test files

**Analogs:** `tests/hooks/grep-nudge.test.cts`, `tests/hooks/pre-tool-dispatcher.test.cts`, `tests/hooks/once-marker.test.cts`, `tests/hooks/mcp-call-marker.test.cts`

Use Node's built-in runner, compiled imports, table-driven host/payload matrices, temporary directories, injected filesystem/clock/spawner seams, real subprocess checks, and explicit secret canaries.

**Classifier table pattern** (`tests/hooks/grep-nudge.test.cts:19-69`):

```typescript
const patternCases: readonly (readonly [unknown, boolean])[] = [
  ["KPlayer::GetLevel", true],
  [String.raw`\.GetLevel\(`, true],
  ["player.cpp", false],
  ["TODO.*fixme", false],
  [null, false],
];
for (const [pattern, expected] of patternCases) {
  assert.equal(hook.looksLikeSymbolLookup(pattern), expected, String(pattern));
}
```

Expand this style into locked positive/negative matrices for `-F`, multiple files, single files, logs/generated text, narrow directories, C++, Lua globals/methods, semantic/hybrid availability, query success/failure, feedback state, and every host payload shape.

**Dispatcher isolation pattern** (`tests/hooks/pre-tool-dispatcher.test.cts:25-79`):

```typescript
const output = dispatcher.dispatchRawInput(raw, [
  () => "navigation",
  () => { throw new Error("isolated handler failure"); },
  () => "x".repeat(dispatcher.MAX_ADDITIONAL_CONTEXT_CHARS),
], parseOnce);
assert.equal(parseCount, 1);
assert.equal(output.hookSpecificOutput.additionalContext.length,
  dispatcher.MAX_ADDITIONAL_CONTEXT_CHARS);
```

Marker tests must continue asserting hash-only filenames, zero/no-sensitive contents, exact scope separation, concurrency winner count, capacity saturation, lock-release rollback, and silent errors. LIVE tests must assert that direct launcher execution produces only `PACKAGED` evidence and cannot populate a `LIVE PASS` receipt.

## Shared Patterns

### Fail-open protocol boundary

**Sources:** `src/hooks/pre-tool-dispatcher.cts:135-177`, `src/hooks/mcp-call-marker.cts:193-205`, `src/hooks/update-worker.cts:211-250`

Apply to every installed handler and plugin callback: bounded input, narrow unknown values, catch all exceptions, emit either one valid host response or nothing, and exit 0. LIVE harness failures are different: they must produce a metadata receipt with `FAIL`/`NOT_RUN`, never silently pass the gate.

### Secret-safe state and evidence

**Sources:** `src/hooks/once-marker.cts:147-162`, `src/hooks/mcp-call-marker.cts:150-171`, `src/fixtures/host-delivery.cts:319-371`

Persist hashes and closed metadata only. Never persist or emit query text, source/result content, tool arguments, URL, headers, Bearer, config body, model reply, or raw stderr. Add secret scans over receipts, logs, summaries, and uploaded artifacts.

### Native capability honesty

**Sources:** `src/hosts/cursor.cts:89-109`, `plugin-src/opencode/kcoderag-nav.js:10-29`, `src/hosts/zcode.cts:259-336`

Codex/Claude/ZCode may register only proven native lifecycle events. Cursor remains Rule/Skill/MCP plus its actual after-events. OpenCode remains project plugin callbacks. Shared policy/state is allowed; invented event equivalence is not.

### Full integrity before consumption

**Source:** `src/hooks/code-style-nudge.cts:176-277`, `394-409`

Code-style prompt fragments and first-write reminders require exact host support receipt, current composite digest, and every managed file digest. Any failure is silent and must not consume an epoch marker.

### Deterministic generation and one transaction

**Sources:** `src/generator/index.cts:188-217`, `636-679`; host adapter `projectedFile`/`section` patterns

Canonical sources render immutable desired state. Host adapters only read/render; project mutation remains in the shared transaction. Generator check and pack inventory must fail on drift.

### Closed receipt vocabulary

**Sources:** `src/fixtures/host-delivery.cts:319-355`, `src/maintainer/readiness-workflow.cts:159-210`

Define exact keys, enums, reason-code vocabulary, size limits, and PASS implications. Keep `status`, `stage`, and `reasonCode` independent; do not collapse environment absence and behavioral failure.

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|---|---|---|---|
| `src/hooks/feedback-nudge.cts` dual reminded/submitted lifecycle | middleware | event-driven / file-I/O | Existing markers provide hashing and bounds, but no implementation has epoch-scoped reminder plus session-scoped successful submission semantics. |
| `src/smoke/acceptance-receipt.cts` Phase 5 schema | model / utility | transform | Existing receipts use `verdict/reason` or `status/reason`; none has independent `status`, `stage`, `reasonCode`, and `evidenceLevel` with the Phase 5 reason taxonomy. |
| `src/smoke/live-host-coordinator.cts` mixed coordinator | service | batch / event-driven | Current host smoke loops serially and treats Cursor/ZCode as headless unsupported; no code performs three isolated parallel CLI lanes followed by two desktop serial lanes with per-host process-tree cleanup. |

## Planner Guardrails

1. Build the normalized event/governor contract before host registration so every adapter projects the same state machine without claiming the same native events.
2. Classify eligibility and success before claiming any marker. An integrity failure, ambiguous source, failed/cancelled/timeout tool, or `list_indexes` must not consume feedback/result state.
3. Treat current `optional-live` and `acceptance.yml` as migration inputs, not behavior to preserve: `NOT_RUN` and `continue-on-error` cannot complete Phase 5.
4. Keep authenticated MCP configuration opaque. The host reads it; the harness observes protocol/boolean metadata without parsing or printing connection values.
5. Create and upload the tgz once. Hosted PACKAGED and protected Windows LIVE lanes must verify the same SHA and must not rebuild.
6. Regenerate product trees and update provider/generator/package/pack/test inventories atomically in the plan; never hand-edit generated CJS or generated host trees.
7. Preserve the existing dirty guide changes and all unrelated worktree state.

## Metadata

**Analog search scope:** `src/hooks`, `src/capabilities`, `src/hosts`, `src/generator`, `src/fixtures`, `src/smoke`, `src/maintainer`, `tests`, `plugin-src`, `.github/workflows`, `docs`, `package.json`
**Files scanned:** 137
**Strong analog families read:** dispatcher/classifiers, marker lifecycle, update cache/worker, capability/host projection, generator, smoke/receipt, exact-artifact workflow, Node tests
**Pattern extraction date:** 2026-09-02
