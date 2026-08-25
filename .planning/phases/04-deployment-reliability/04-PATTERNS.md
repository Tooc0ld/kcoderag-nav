# Phase 04: 已部署项目与安装来源可靠性 - Pattern Map

**Mapped:** 2026-08-25
**Files analyzed:** 22 logical new/modified file sets
**Analogs found:** 21 / 22

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, managed `AGENTS.md` | config/docs | transform | Current Phase 03.1 product contract sections | self-extension |
| `src/core/contracts.cts` | model | transform | Existing `StatusResult`, `InstallState`, `InstallError` contracts in the same file | exact |
| `src/core/state.cts` | model/utility | transform | `parseLegacyInstallState` and `parseInstallState` in the same file | exact |
| `src/core/project-target.cts` | utility | file-I/O | Existing canonical target and managed-path validation in the same file | exact |
| `src/core/project-root.cts` or equivalent root-discovery module (new) | utility | file-I/O | `src/core/project-target.cts` | role-match |
| `src/hosts/user-sources.cts` or equivalent shared finding/provider contract (new) | provider/model | request-response + file-I/O | `HostObservation` plus Cursor legacy inspection | role-match |
| `src/hosts/host-adapter.cts` | provider contract | request-response | Existing pure `detect/render/status` seam in the same file | exact |
| `src/cli/commands.cts`, `src/bin/kcoderag-nav.cts` | controller | request-response | Existing five-command controller | exact |
| `src/hosts/codex.cts` | provider | file-I/O + request-response | Existing Codex adapter; Cursor authorized legacy flow for source-cleanup shape | self-extension |
| `src/hosts/claude.cts` | provider | file-I/O + request-response | Existing Claude adapter; Cursor authorized legacy flow for source-cleanup shape | self-extension |
| `src/hosts/cursor.cts` | provider | file-I/O + request-response | Existing Cursor detection, drift gate, backup and compensation flow | exact |
| `src/hosts/index.cts` | provider registry | transform | Existing frozen single-host adapter registry | exact |
| `src/hooks/project-bootstrap.cts` or equivalent command renderer (new) | hook/utility | event-driven + file-I/O | `plugin-src/hooks/run_hook.cmd`, `run_hook.sh`, and launcher tests | role-match |
| `plugin-src/hooks/hooks.json`, `plugin-src/hooks/run_hook.cmd`, `plugin-src/hooks/run_hook.sh` | hook/config | event-driven | Current self-relative, fail-open launchers | self-extension |
| `src/generator/index.cts` | service/utility | batch + file-I/O | Existing product-scoped deterministic renderer | exact |
| `plugin-src/environments.json`, `plugin-src/routing.json`, `plugin-src/cursor/**`, shared templates | config/templates | transform | Existing QA/Dev canonical inputs | self-extension |
| `package.json`, `package-lock.json`, generated `kcoderag-qa/**`, `kcoderag-cursor/**`; delete generated `kcoderag-dev/**` | config/artifacts | batch | Generator product and asset-group map | exact |
| `src/maintainer/release.cts`, pack/docs/retirement audits | service/gate | batch + file-I/O | Existing exact-write-set release helper | exact |
| `tests/cli/commands.test.cts`, `tests/core/*.test.cts` | test | request-response + file-I/O | Existing injected dependency and temporary-project tests | exact |
| `tests/hosts/{codex,claude,cursor,cross-host}.test.cts` | test | request-response + file-I/O | Existing adapter lifecycle and cross-host isolation tests | exact |
| `tests/hooks/launcher.test.cts`, generator/maintainer/smoke tests | test | event-driven + batch | Existing real launcher, generation drift, pack and exact package tests | exact |
| `README.md`, `../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md` | docs | transform | Current npx lifecycle documentation | exact |
| Phase 04 public-release and Head migration evidence artifact | config/evidence | batch | `03.1-14-PUBLISH-RECEIPT.json` / publish receipt schema | role-match |

## Pattern Assignments

### `src/core/contracts.cts` and `src/core/state.cts` (model/utility, transform)

**Analog:** `src/core/state.cts`

**Status normalization pattern** (`src/core/state.cts` lines 71-92):

```typescript
export function createStatusResult(input: StatusInput = {}): StatusResult {
  const issues = [...(input.issues ?? [])]
    .map((issue) => Object.freeze({
      code: issue.code,
      path: sanitizeSafeRelativePath(issue.path) ?? ".",
    }))
    .sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  // ...
  return Object.freeze(result);
}
```

Copy the immutable/sorted result construction, but extend the model deliberately:

- Add the top-level `source_conflict` status required by D-15.
- Add a dedicated source finding shape for `code`, `severity`, `sourceType`, `scope`, safe path and optional native cleanup command. Do not overload a two-field `StatusIssue` until it accidentally carries unsafe user values.
- Keep current install output QA-only. Do not leave `EnvironmentId = "qa" | "dev"` as a public CLI capability. Prefer a QA-only current type plus a separate legacy decoder type that can still read `"dev"`.
- `status` and `doctor --json` must serialize one stable document. Findings must be deterministically sorted.

**Legacy decoder pattern** (`src/core/state.cts` lines 197-253):

```typescript
export function parseLegacyInstallState(
  bytes: Buffer,
  options: LegacyStateOptions,
): LegacyInstallState {
  // Exact schema, allowed paths, required paths and digest checks happen here.
  // ...
  return Object.freeze({
    version: 1 as const,
    environment,
    managedFiles: Object.freeze([...digestPaths].sort((left, right) => left.localeCompare(right))),
    originals: Object.freeze(originals),
    digests: Object.freeze(digests),
  });
}
```

Use the exact-key/digest/allowed-path style to keep old Dev readable for one-time migration or uninstall. Do not make Dev a renderable desired state. A damaged or drifted legacy Dev state must become a refusal before any write.

**Desired-state validation pattern** (`src/core/state.cts` lines 94-129):

```typescript
export function createDesiredState(input: DesiredStateInput): DesiredState {
  if (!isProjectTarget(input.target) || input.entries.length === 0) {
    throw new InstallError("invalid_desired_state");
  }
  const statePath = validateManagedPath(input.target, input.statePath, input.managedRoots);
  // Every entry is path-validated and digest-validated before the immutable plan is returned.
}
```

The legacy Dev -> QA migration must render one complete QA desired state, including removal of old Dev-owned paths and a QA state written last by the shared transaction.

---

### `src/core/project-target.cts` and root discovery (utility, file-I/O)

**Analog:** `src/core/project-target.cts`

**Canonical target pattern** (lines 40-61):

```typescript
export function resolveProjectTarget(rawTarget: string, cwd = process.cwd()): ProjectTarget {
  const candidate = path.resolve(cwd, rawTarget);
  const metadata = fs.lstatSync(candidate);
  if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape");
  if (!metadata.isDirectory()) throw new InstallError("invalid_target");
  const canonical = fs.realpathSync(candidate);
  if (isRootPath(canonical)) throw new InstallError("unsafe_target");
  const target = Object.freeze({ root: canonical });
  validatedTargets.add(target);
  return target;
}
```

Extend this target gate with canonical comparisons against:

- the user home directory;
- selected hosts' user config/plugin/cache roots;
- filesystem roots on Windows and POSIX.

Compare real paths with platform-appropriate casing rules. The default `cwd` and explicit `--target` remain the exact target; do not infer Git/SVN roots.

**Managed containment pattern** (lines 68-116):

```typescript
const absolutePath = path.resolve(target.root, ...parts);
const relation = path.relative(target.root, absolutePath);
if (relation.length === 0 || relation.startsWith("..") || path.isAbsolute(relation)) {
  throw new InstallError("path_escape", relativePath);
}
// Walk every existing component with lstat/realpath and reject symlinks/special files.
```

The upward Hook lookup is a separate read-only operation and should return relative project identity, not bind the installation state to an absolute path. Required algorithm:

1. Start at the actual tool session `cwd`.
2. At each ancestor, test only the selected host's state path (`.codex/...`, `.claude/...`; Cursor has no hook bootstrap).
3. The first existing state pathname is the boundary. Return it even before parsing.
4. If that nearest state is unreadable, invalid, incompatible, or its launcher is missing, stop and fail open; never continue to an outer project.
5. Only `ENOENT` advances to the parent; terminate at the filesystem root with a bounded loop.

This preserves nearest-project precedence and makes a copied/moved project work because all state and launcher paths remain project-relative.

---

### `src/cli/commands.cts` (controller, request-response)

**Analog:** `src/cli/commands.cts`

**Single-host composition-root pattern** (lines 249-348):

```typescript
const host = await selectHost(args, dependencies);
const target = resolveProjectTarget(args.target ?? ".", dependencies.cwd ?? process.cwd());
const adapter = assertHostAdapter(dependencies.getAdapter?.(host) ?? getHostAdapter(host), host);
const observation = adapter.detect({ target, packageRoot });

if (!isMutation(args.command)) {
  const status = adapter.status({
    target,
    packageRoot,
    environment: args.environment,
    observation,
    doctor: args.command === "doctor",
  });
  // one JSON result
}

const desired = args.command === "uninstall"
  ? adapter.renderUninstall(/* ... */)
  : adapter.renderInstall(/* ... */);
const transaction = applyTransaction(desired);
```

Keep one selected adapter per invocation. Phase 04 should change orchestration as follows:

- Remove public environment selection; QA is implicit and is the only newly rendered environment.
- Add separate explicit flags/confirmations for legacy Dev migration and known owned user-plugin cleanup. General `--yes` must not imply either authority.
- `install`/`update`: run the selected host's complete source gate before rendering/applying desired state.
- `uninstall`: validate the project's own state and drift, but skip blocking on unrelated active user sources because uninstall reduces one active source.
- `status`: quick project health plus conflict summary. `doctor`: deep selected-host source findings, including preinstall findings when project status is `not_installed`.
- Do not require users to run `doctor` before a mutation; mutations invoke the same full source gate internally.

**Current defect to fix** (`src/cli/commands.cts` lines 303-315):

```typescript
const payload = {
  schemaVersion: CORE_SCHEMA_VERSION,
  ok: true,
  // ...
  status: status.status,
  issues: status.issues,
};
```

`ok` cannot remain hard-coded. For `source_conflict`, it must be `false`; ordinary `not_installed` remains a successful read-only command result unless the stable JSON contract intentionally distinguishes command success from health.

**Safe error pattern** (`src/cli/commands.cts` lines 147-169, 369-380): expected refusals expose only stable codes and sanitized paths. Never append subprocess output, parsed MCP content, URL, headers or Bearer values.

---

### `src/hosts/host-adapter.cts` and selected-host source provider (provider, request-response/file-I/O)

**Analog:** `src/hosts/host-adapter.cts`

**Pure observation/render seam** (lines 26-37 and 59-70):

```typescript
export interface HostObservation {
  readonly host: HostId;
  readonly target: ProjectTarget;
  readonly currentState?: InstallState;
  readonly issues?: readonly StatusIssue[];
  readonly legacyUserRemoval?: LegacyUserRemovalObservation;
  readonly details?: unknown;
}

export interface HostAdapter {
  readonly id: HostId;
  readonly managedRoots: readonly string[];
  detect(context: HostReadContext): HostObservation;
  renderInstall(context: HostInstallContext): DesiredState;
  renderUninstall(context: HostUninstallContext): DesiredState;
  status(context: HostStatusContext): StatusResult;
}
```

Preserve two boundaries:

- Adapter detection/status/source inspection may read and return immutable metadata. Adapter render functions produce a complete desired state but do not write.
- Adapter-private `details` is never serialized. Public findings are separately sanitized.

Prefer an explicit scan mode or provider method instead of making `detect()` always perform every user-level scan. The caller needs distinct paths for fast status, deep doctor/full mutation gate and project-only uninstall. Host-specific source enumeration remains behind the selected adapter so Codex cannot scan Claude/Cursor locations during a Codex command.

Suggested provider outputs:

```typescript
interface SourceFinding {
  readonly code: string;
  readonly severity: "info" | "conflict";
  readonly sourceType: "owned_plugin" | "marketplace" | "raw_mcp" | "manual_hook" | "cache" | "disabled";
  readonly scope: "project" | "user";
  readonly path: string;          // safe/redacted path only
  readonly cleanupCommand?: string; // verified host-native command only
  readonly cleanupEligible: boolean;
}
```

The exact field names are discretionary, but do not place values from configuration documents in this object.

---

### `src/hosts/{codex,claude,cursor}.cts` and native cleanup planning (provider, file-I/O/request-response)

**Primary analog:** `src/hosts/cursor.cts`

**Exact ownership before mutation** (`src/hosts/cursor.cts` lines 476-531):

```typescript
const state = parseLegacyState(stateBytes);
const files = readLegacyTree(pluginRoot, directories);
if (actualPaths.join("\0") !== expectedPaths.join("\0")) {
  throw new InstallError("unmanaged_legacy_path", LEGACY_PLUGIN_NAME);
}
for (const [relativePath, expected] of Object.entries(state.digests)) {
  const bytes = files.get(relativePath);
  if (bytes === undefined || sha256(bytes) !== expected) {
    throw new InstallError("managed_content_changed", relativePath);
  }
}
```

Reuse exact ownership, complete-set and drift checks for cleanup eligibility. Known owned plugin/marketplace registrations may produce a confirmation plan. Raw MCP/manual Hook/ambiguous sources must only produce hard-stop findings and manual instructions.

**Do not copy this credential comparison into source diagnosis** (`src/hosts/cursor.cts` lines 458-473):

```typescript
const url = properties.KCODERAG_MCP_URL.default;
const bearer = properties.KCODERAG_BEARER_TOKEN.default;
for (const environment of ["qa", "dev"] as const) {
  const expected = environmentMcpEntry(packageRoot, environment);
  if (url === expected.url && bearer === expected.bearer) return environment;
}
```

D-11 forbids reading, comparing, recording or displaying URL/Header/Bearer for raw MCP/manual Hook diagnosis. New scanners must classify by safe keys, paths, enabled state and trusted ownership metadata. If a source cannot be proven owned without secret inspection, mark it ambiguous and refuse automatic cleanup.

**Write gate pattern** (`src/hosts/cursor.cts` lines 617-678):

```typescript
function renderInstall(context: HostInstallContext): DesiredState {
  refuseIssues(context.observation);
  // authority, current state and environment checks
  // render all payloads and digests
  return createDesiredState({
    host: "cursor",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: managedPaths().map(/* expected digest + content */),
  });
}
```

Every source gate, legacy-state check and current-project drift check must finish before the first project write. Generalize current Cursor-only authority; do not leave `--allow-legacy-user-removal` hard-coded to Cursor.

**Compensation pattern** (`src/hosts/cursor.cts` lines 1162-1235): first create a verified project backup through `applyTransaction`, then quarantine/remove the owned legacy source, and restore both sides on failure. For Phase 04 native plugin cleanup, use this as the safety model, not as permission to `rm -r` host configuration. Invoke only the host's documented uninstall capability after explicit authority. If the host lacks a safe native uninstall for the exact source, emit a manual-cleanup finding and stop.

Source cleanup is an external, independently authorized step. Keep it outside the project filesystem transaction, with an injected process runner, bounded timeout and stable error codes. Never serialize stdout/stderr or construct commands from config values.

---

### `src/core/transaction.cts` (service, batch/file-I/O)

**Analog:** `src/core/transaction.cts`

**No-write-before-gate and state-last ordering** (lines 223-235 and 682-741):

```typescript
function verifyExpected(entry: DesiredEntry, current: Buffer | undefined): void {
  const matches = entry.expectedDigest === null
    ? current === undefined
    : current !== undefined && sha256(current) === entry.expectedDigest;
  if (!matches) throw new InstallError("managed_content_changed", entry.path.relativePath);
}

function orderedEntries(desired: DesiredState): readonly DesiredEntry[] {
  return [...desired.entries].sort((left, right) => {
    if (left.path.relativePath === desired.statePath.relativePath) return 1;
    if (right.path.relativePath === desired.statePath.relativePath) return -1;
    return left.path.relativePath.localeCompare(right.path.relativePath);
  });
}

// Complete pre-read and digest validation occurs before the first directory or file write.
for (const entry of entries) {
  const current = readOptional(desired, entry, identities, options);
  verifyExpected(entry, current);
}
```

Do not add filesystem writes to adapters, scanners, `status` or `doctor`. The legacy Dev -> QA project conversion must be one desired state passed once to `applyTransaction`; state remains last. Existing rollback/recovery semantics already satisfy project-side D-20 and should be extended by desired-state inputs, not bypassed with ad-hoc deletes.

---

### Hook registration, root bootstrap and launcher tests (hook/test, event-driven)

**Analog:** `tests/hooks/launcher.test.cts` plus `plugin-src/hooks/run_hook.{cmd,sh}`

**Current fail-open launcher contract** (`tests/hooks/launcher.test.cts` lines 80-96):

```typescript
function assertProtocolResult(result: ReturnType<typeof childProcess.spawnSync>): void {
  assert.equal(result.status, 0, String(result.stderr));
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(String(result.stdout));
  assert.equal(parsed.hookSpecificOutput.hookEventName, "PreToolUse");
}

function assertSilentSuccess(result: ReturnType<typeof childProcess.spawnSync>): void {
  assert.equal(result.status, 0, String(result.stderr));
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
}
```

**Current test limitation** (`tests/hooks/launcher.test.cts` lines 43-77): tests invoke an already-known absolute launcher path while changing `cwd`. This proves the launcher is self-relative only after it has been found; it does not prove the host's installed relative hook command can find the project from a nested directory.

Phase 04 tests must render the real Codex/Claude hook command, then execute that command from:

- project root;
- a Unicode/space-containing deep child;
- a nested project with its own nearest state;
- a nearest damaged/incompatible state with a healthy outer state (must be silent, never fall through);
- a copied/moved temporary project on Windows and POSIX;
- missing Node, launcher or malformed state (exit 0, empty stdout/stderr).

The rootless bootstrap has to be present in the registered command itself (or use a verified host-native project-root token). A project-contained bootstrap cannot be reached by a relative path before project discovery. Once found, retain the existing sibling-relative launcher pattern:

```cmd
node -e "..." "%~dp0grep-nudge.cjs" >"%KCODERAG_HOOK_OUTPUT%" 2>nul
exit /b 0
```

```sh
output=$(node "$hook_script" 2>/dev/null)
status=$?
[ "$status" -eq 0 ] && printf '%s' "$output"
exit 0
```

Do not widen matchers or change grep-nudge precision in this phase; that belongs to Phase 05.

---

### `src/generator/index.cts`, canonical inputs and package allow-list (service/config, batch)

**Analog:** `src/generator/index.cts`

**Central product/asset map** (lines 8-21, 89-177):

```typescript
export type Product = "qa" | "dev" | "cursor";
const PRODUCTS = Object.freeze(["qa", "dev", "cursor"] as const);
const PRODUCT_DIRECTORIES = Object.freeze({
  qa: "kcoderag-qa",
  dev: "kcoderag-dev",
  cursor: "kcoderag-cursor",
});
export const ASSET_GROUP_PATHS = Object.freeze({ qa: qaGroups, dev: qaGroups, cursor: cursorGroups() });
```

Make QA-only a subtraction at the canonical map:

- Public products become QA and Cursor-host assets only; no Dev product selection, output directory or asset group.
- `plugin-src/environments.json` becomes one QA record; routing text no longer describes mutual exclusion or Dev fallback.
- Cursor template defaults and descriptions must stop offering Dev replacement.
- Delete `plugin-src/environments/dev.mcp.json` and generated `kcoderag-dev/**` only after tests and allow-lists are updated to expect their absence.

**Deterministic rendering pattern** (`src/generator/index.cts` lines 619-654):

```typescript
for (const product of selectedProducts(selection.product, selection.group)) {
  const packageDirectory = PRODUCT_DIRECTORIES[product];
  for (const assetPath of ASSET_GROUP_PATHS[product][selection.group]) {
    const outputPath = validateRelativePath(`${packageDirectory}/${assetPath}`);
    rendered.set(outputPath, bytes);
  }
}
return {
  outputs: new Map([...rendered].sort(([left], [right]) => compareCodeUnits(left, right))),
  // ...
};
```

Keep sorted, byte-deterministic generation and atomic commit behavior. Add an explicit retired-output check so `generate --check` and pack audit fail if `kcoderag-dev/**` is still publishable. The root `package.json` `files` list currently includes Dev at lines 49-61; removal there is part of the public contract, not cleanup-only work.

---

### Release `0.2.0`, public verification and Head deployment (gate/evidence, batch)

**Analog:** `src/maintainer/release.cts` and `src/maintainer/publish-receipt.cts`

**Exact release write-set pattern** (`src/maintainer/release.cts` lines 39-51, 337-416):

```typescript
export const VERSION_MANIFEST_PATHS = Object.freeze([
  "kcoderag-qa/.codex-plugin/plugin.json",
  "kcoderag-qa/.claude-plugin/plugin.json",
  "kcoderag-dev/.codex-plugin/plugin.json",
  "kcoderag-dev/.claude-plugin/plugin.json",
  "kcoderag-cursor/.cursor-plugin/plugin.json",
]);

const previousVersion = currentVersion(root);
const version = bumpVersion(previousVersion, options.level);
const tag = `v${version}`;
// generation check -> ci:local -> exact write-set -> commit -> tag
```

Remove Dev manifests from version/release-owned sets. From `0.1.8`, the authorized minor release path yields `0.2.0`. The user already authorized publish after all gates, so execution may use the existing non-interactive `--yes` path without another approval checkpoint.

**Public identity pattern** (`src/maintainer/publish-receipt.cts` lines 333-409): receipt verification ties together exact requested/resolved version, `latest`, npm `gitHead`, tag/ref, release SHA, all four required CI lanes and exact/latest lifecycle evidence. Reuse this schema for Phase 04 publication proof; do not substitute a local pack for public exact acquisition.

Head acceptance must be a separate post-publication sequence using `kcoderag-nav@0.2.0` exactly:

1. `doctor` for Codex at `I:\JX3_SVN\Head`.
2. Show and explicitly authorize the known owned stale user-level source cleanup; use the verified native uninstall command.
3. Run exact `update`/legacy migration.
4. Run exact `status` and `doctor` and capture metadata-only evidence.
5. Prove the rendered Hook command from Head root and a deep child resolves the same project state/launcher.
6. Compare before/after metadata or digests for unrelated project and user configuration paths without recording their contents.

If public `0.2.0` exists and Head migration fails, keep the tag, npm version and `latest`; rely on project transaction rollback and fix forward with `0.2.1`. Do not unpublish or move the dist-tag backward.

---

### Tests and documentation (test/docs, mixed flows)

Use the existing Node test style: `node:test`, `node:assert/strict`, injected dependencies, `mkdtempSync`, exact stdout/stderr assertions, and `finally` cleanup. Required Phase 04 coverage should include:

- CLI rejects Dev as a public install/update choice and does not show Dev in help/interactive prompts.
- Owned, undrifted legacy Dev -> QA requires its own confirmation/automation flag and commits once; drift writes nothing.
- Each host's install/update source gate blocks active raw MCP/manual Hook/plugin conflicts before project writes.
- Status is fast; doctor is deeper; both read-only; `source_conflict` is top-level and `ok: false`.
- Doctor findings expose only stable metadata and verified native cleanup commands; sentinel URL/Header/Bearer strings never occur in output, errors, receipts or snapshots.
- Uninstall succeeds for an undrifted project even when another user source exists.
- Cross-host sources and project installations do not block the selected host.
- Root/home/global host roots are unsafe targets; ordinary non-VCS directories remain valid.
- QA-only generation, pack, release write-set, docs check and retirement scans prove Dev is absent from the public artifact while the legacy parser still accepts owned old Dev state.
- Exact public `0.2.0` acquisition and Head acceptance remain distinct from Phase 06 real MCP tool/query evidence.

Documentation edits must preserve history honestly: Phase 1-3/03.1 delivered their old QA/Dev contract, while Phase 04 explicitly supersedes it for `0.2.0`. README and the sibling authoritative guide should document only QA public usage, separate legacy migration/cleanup authorities, project-root behavior, status/doctor semantics and exact update/recovery. Do not add a local copy of `MCP_QA_EXPERIENCE_GUIDE.md`.

## Shared Patterns

### Read/Render/Commit Separation

**Sources:** `src/hosts/host-adapter.cts` lines 59-70; `src/core/transaction.cts` lines 682-840  
**Apply to:** every host adapter, source scanner, CLI mutation and legacy migration.

- Read everything and construct immutable observations/findings first.
- Render one complete project desired state second.
- Commit project files only through `applyTransaction`.
- Host-native user cleanup is independently authorized and must not masquerade as a project transaction.

### Secret-Safe Diagnostics

**Sources:** `src/core/contracts.cts` lines 91-116; `src/cli/commands.cts` lines 147-169  
**Apply to:** status, doctor, source gates, native command failures, release/Head evidence.

Only stable codes, host/scope/source metadata and safe paths cross the public boundary. Never include raw file contents, subprocess bodies, URLs, headers or credentials. Tests should use sentinel secrets and assert their absence.

### Deterministic State and Output

**Sources:** `src/core/state.cts` lines 71-92; `src/generator/index.cts` lines 99-177 and 619-654  
**Apply to:** findings, desired-state entries, generated asset paths, JSON output, evidence.

Sort keys/paths/findings and freeze returned structures. Keep root `package.json` as the version source and generated products as outputs, never independent hand-edited sources.

### Fail-Open Hook Boundary

**Sources:** `plugin-src/hooks/run_hook.cmd` lines 4-15; `plugin-src/hooks/run_hook.sh` lines 4-19; `tests/hooks/launcher.test.cts` lines 80-96  
**Apply to:** upward root discovery, launcher invocation, malformed state, missing runtime and nested-project boundaries.

Any operational failure yields exit 0 with empty stdout/stderr. A valid advisory response is the only non-empty stdout.

### QA-Only Public / Legacy-Readable Split

**Sources:** current generator product map and legacy state parsers  
**Apply to:** CLI types, state parsing, adapters, generator, pack/release audits, docs.

No public flag, generated tree, npm file or user guide may offer Dev. Only the legacy read/migrate/uninstall path may recognize Dev, under exact ownership/drift checks and explicit authority.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Host-native owned-plugin enumerator/uninstaller abstraction | provider | request-response | The repository has filesystem-based Cursor legacy cleanup and maintainer subprocess helpers, but no production selected-host native plugin API wrapper with bounded timeout, injected runner and secret-safe metadata contract. Use official host research plus the shared safety patterns above. |

## Implementation Cautions

- Do not reinterpret the current Cursor raw credential comparison as permission to inspect user MCP values.
- Do not let `doctor` mutate, add `doctor --fix`, or make install/update depend on a prior doctor run.
- Do not let a bad nearest state fall through to an outer project during Hook root discovery.
- Do not bind state to the old absolute project root; relative managed paths/digests are what make moves work.
- Do not scan other hosts during a selected-host command.
- Do not automatically delete raw MCP/manual Hook/ambiguous sources, even with `--yes`.
- Do not use `latest` or a local tarball as Head migration evidence after publication.
- Do not absorb Phase 05 Hook precision, Phase 06 real MCP queries, Phase 07 GSD Hook cleanup or Phase 08 identity/HTTPS/token rotation.

## Metadata

**Analog search scope:** `src/`, `tests/`, `plugin-src/`, `package.json`, `.github/workflows/`, `.planning/`, sibling KCodeRag guide  
**Files scanned:** 70+ source, test, generated-input, workflow and planning paths  
**Primary analog families:** 5 (CLI lifecycle, core state/target/transaction, host migration, Hook launcher, generator/release)  
**Pattern extraction date:** 2026-08-25
