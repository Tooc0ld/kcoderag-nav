/** Codex QA tracer adapter retained until the full Codex adapter lands in Plan 07. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const readline = require("node:readline/promises") as typeof import("node:readline/promises");

import { executeCommand, type CommandDependencies } from "../cli/commands.cjs";
import {
  InstallError,
  type DesiredState,
  type InstallState,
  type OriginalRecord,
  type ProjectTarget,
  type StatusIssue,
} from "../core/contracts.cjs";
import { resolveProjectTarget, validateManagedPath } from "../core/project-target.cjs";
import { createDesiredState, createStatusResult, parseInstallState } from "../core/state.cjs";
import { applyTransaction } from "../core/transaction.cjs";
import type {
  HostAdapter,
  HostInstallContext,
  HostObservation,
  HostStatusContext,
  HostUninstallContext,
} from "../hosts/host-adapter.cjs";

type JsonMap = Record<string, unknown>;

interface InstallOptions {
  readonly target: string;
  readonly packageRoot: string;
  readonly failAtStage?: number;
  readonly failAtCommit?: number;
  readonly onCommit?: (relativePath: string) => void;
}

interface InstallResult {
  readonly host: "codex";
  readonly environment: "qa";
  readonly target: string;
  readonly version: string;
  readonly managedFiles: string[];
}

interface LegacyCliDependencies {
  readonly cwd?: string;
  readonly packageRoot?: string;
  readonly nodeVersion?: string;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  readonly confirm?: (prompt: string) => boolean | Promise<boolean>;
}

interface TracerObservationDetails {
  readonly stateBytes?: Buffer;
}

const STATE_PATH = ".codex/kcoderag-nav/install-state.json";
const CONFIG_PATH = ".codex/config.toml";
const HOOKS_PATH = ".codex/hooks.json";
const SKILL_PATH = ".agents/skills/kcoderag-nav/SKILL.md";
const HOOK_PREFIX = ".codex/kcoderag-nav/qa/hooks";
const MANAGED_ROOTS = Object.freeze([".agents", ".codex"] as const);
const HOOK_ASSETS = Object.freeze([
  "grep-nudge.cjs",
  "run_hook.cmd",
  "run_hook.sh",
  "update-check.cjs",
  "update-worker.cjs",
]);
const MANAGED_PATHS = Object.freeze(
  [
    SKILL_PATH,
    CONFIG_PATH,
    HOOKS_PATH,
    ...HOOK_ASSETS.map((name) => `${HOOK_PREFIX}/${name}`),
    STATE_PATH,
  ].sort((left, right) => {
    if (left === STATE_PATH) return 1;
    if (right === STATE_PATH) return -1;
    return left.localeCompare(right);
  }),
);
const OWNED_PATHS = MANAGED_PATHS.filter((relativePath) => relativePath !== STATE_PATH);
const EXCLUSIVE_PATHS = new Set(
  MANAGED_PATHS.filter((relativePath) => ![CONFIG_PATH, HOOKS_PATH, STATE_PATH].includes(relativePath)),
);
const CONFIG_BEGIN = "# BEGIN KCODERAG-NAV qa";
const CONFIG_END = "# END KCODERAG-NAV qa";

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readOptional(filePath: string): Buffer | undefined {
  try {
    const metadata = fs.lstatSync(filePath);
    if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape");
    if (!metadata.isFile()) throw new InstallError("special_file");
    return fs.readFileSync(filePath);
  } catch (error) {
    if (error instanceof InstallError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new InstallError("unreadable");
  }
}

function readManagedOptional(target: ProjectTarget, relativePath: string): Buffer | undefined {
  const validated = validateManagedPath(target, relativePath, MANAGED_ROOTS);
  try {
    return readOptional(validated.absolutePath);
  } catch (error) {
    if (error instanceof InstallError) throw new InstallError(error.code, relativePath);
    throw error;
  }
}

function parseJsonBytes(bytes: Buffer, code: string, safePath: string): JsonMap {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new InstallError(code, safePath);
  }
}

function readPackageVersion(packageRoot: string): string {
  const document = parseJsonBytes(
    fs.readFileSync(path.join(packageRoot, "package.json")),
    "invalid_package",
    "package.json",
  );
  if (document.name !== "kcoderag-nav" || typeof document.version !== "string") {
    throw new InstallError("invalid_package", "package.json");
  }
  return document.version;
}

function readMcpEntry(packageRoot: string): {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
} {
  const relativePath = "kcoderag-qa/.codex.mcp.json";
  const source = parseJsonBytes(
    fs.readFileSync(path.join(packageRoot, ...relativePath.split("/"))),
    "invalid_mcp_source",
    relativePath,
  );
  const servers = isRecord(source.mcpServers) ? source.mcpServers : source;
  const name = "kcoderag-qa";
  const entry = servers[name];
  if (!isRecord(entry) || typeof entry.url !== "string") {
    throw new InstallError("invalid_mcp_source", relativePath);
  }
  const headerValue = isRecord(entry.http_headers)
    ? entry.http_headers
    : isRecord(entry.headers)
      ? entry.headers
      : undefined;
  if (
    headerValue === undefined ||
    !Object.entries(headerValue).every(
      ([key, value]) => typeof key === "string" && typeof value === "string",
    )
  ) {
    throw new InstallError("invalid_mcp_source", relativePath);
  }
  return { name, url: entry.url, headers: headerValue as Record<string, string> };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function renderConfig(original: Buffer | undefined, packageRoot: string): Buffer {
  const originalText = (original ?? Buffer.alloc(0)).toString("utf8");
  if (
    originalText.includes("# BEGIN KCODERAG-NAV") ||
    /\[mcp_servers\.(?:"kcoderag-qa"|kcoderag-qa)\]/.test(originalText)
  ) {
    throw new InstallError("unmanaged_name_conflict", CONFIG_PATH);
  }
  const entry = readMcpEntry(packageRoot);
  const headers = Object.entries(entry.headers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`)
    .join(", ");
  const block = [
    CONFIG_BEGIN,
    `[mcp_servers.${tomlString(entry.name)}]`,
    `url = ${tomlString(entry.url)}`,
    `http_headers = { ${headers} }`,
    CONFIG_END,
    "",
  ].join("\n");
  const separator = originalText.length === 0 || originalText.endsWith("\n\n")
    ? ""
    : originalText.endsWith("\n")
      ? "\n"
      : "\n\n";
  return Buffer.from(`${originalText}${separator}${block}`, "utf8");
}

function renderHooks(original: Buffer | undefined): Buffer {
  const document = original === undefined
    ? { hooks: {} as JsonMap }
    : parseJsonBytes(original, "invalid_json", HOOKS_PATH);
  if (!isRecord(document.hooks)) document.hooks = {};
  const hooks = document.hooks as JsonMap;
  if (hooks.PreToolUse === undefined) hooks.PreToolUse = [];
  if (!Array.isArray(hooks.PreToolUse) || !hooks.PreToolUse.every(isRecord)) {
    throw new InstallError("invalid_json", HOOKS_PATH);
  }
  const encoded = JSON.stringify(document);
  if (encoded.includes(".codex/kcoderag-nav/") || encoded.includes(".codex\\kcoderag-nav\\")) {
    throw new InstallError("unmanaged_name_conflict", HOOKS_PATH);
  }
  hooks.PreToolUse.push({
    matcher: "Grep|Glob|Bash",
    hooks: [
      {
        type: "command",
        command: `sh \"${HOOK_PREFIX}/run_hook.sh\"`,
        commandWindows: `call \"${HOOK_PREFIX.replaceAll("/", "\\\\")}\\\\run_hook.cmd\"`,
        timeout: 5,
        statusMessage: "Checking code lookup strategy (QA)",
      },
    ],
  });
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function encodeOriginal(bytes: Buffer | undefined): OriginalRecord {
  return bytes === undefined ? { kind: "absent" } : { kind: "base64", data: bytes.toString("base64") };
}

function decodeOriginal(record: OriginalRecord | undefined, relativePath: string): Buffer | null {
  if (record === undefined) throw new InstallError("invalid_state", STATE_PATH);
  if (record.kind === "absent") return null;
  if (typeof record.data !== "string") throw new InstallError("invalid_state", relativePath);
  return Buffer.from(record.data, "base64");
}

function validateTracerState(state: InstallState): InstallState {
  if (
    state.host !== "codex" ||
    state.managedFiles.join("\0") !== MANAGED_PATHS.join("\0") ||
    Object.keys(state.originals).sort().join("\0") !== [...OWNED_PATHS].sort().join("\0") ||
    Object.keys(state.digests).sort().join("\0") !== [...OWNED_PATHS].sort().join("\0")
  ) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  return state;
}

function issueFrom(error: unknown): StatusIssue {
  if (error instanceof InstallError) {
    return { code: error.code, path: error.safePath ?? "." };
  }
  return { code: "invalid", path: "." };
}

function detectCodex(context: { target: ProjectTarget }): HostObservation {
  const stateBytes = readManagedOptional(context.target, STATE_PATH);
  if (stateBytes === undefined) {
    return Object.freeze({
      host: "codex" as const,
      target: context.target,
      details: Object.freeze({} satisfies TracerObservationDetails),
    });
  }
  try {
    const state = validateTracerState(parseInstallState(stateBytes));
    for (const [relativePath, digest] of Object.entries(state.digests)) {
      const current = readManagedOptional(context.target, relativePath);
      if (current === undefined || sha256(current) !== digest) {
        throw new InstallError("managed_content_changed", relativePath);
      }
    }
    return Object.freeze({
      host: "codex" as const,
      target: context.target,
      currentState: state,
      details: Object.freeze({ stateBytes: Buffer.from(stateBytes) } satisfies TracerObservationDetails),
    });
  } catch (error) {
    return Object.freeze({
      host: "codex" as const,
      target: context.target,
      issues: Object.freeze([issueFrom(error)]),
      details: Object.freeze({ stateBytes: Buffer.from(stateBytes) } satisfies TracerObservationDetails),
    });
  }
}

function details(observation: HostObservation): TracerObservationDetails {
  return (observation.details ?? {}) as TracerObservationDetails;
}

function refuseObservationIssues(observation: HostObservation): void {
  const issue = observation.issues?.[0];
  if (issue !== undefined) throw new InstallError(issue.code, issue.path);
}

function captureOriginals(target: ProjectTarget): Record<string, OriginalRecord> {
  const originals: Record<string, OriginalRecord> = {};
  for (const relativePath of OWNED_PATHS) {
    const current = readManagedOptional(target, relativePath);
    if (EXCLUSIVE_PATHS.has(relativePath) && current !== undefined) {
      throw new InstallError("unmanaged_name_conflict", relativePath);
    }
    originals[relativePath] = encodeOriginal(current);
  }
  return originals;
}

function sourceAsset(packageRoot: string, relativePath: string): Buffer {
  try {
    return fs.readFileSync(path.join(packageRoot, ...relativePath.split("/")));
  } catch {
    throw new InstallError("missing_package_asset", relativePath);
  }
}

function expectedDigest(
  target: ProjectTarget,
  relativePath: string,
  state: InstallState | undefined,
  stateBytes: Buffer | undefined,
): string | null {
  if (relativePath === STATE_PATH) return stateBytes === undefined ? null : sha256(stateBytes);
  if (state !== undefined) return state.digests[relativePath] ?? null;
  const current = readManagedOptional(target, relativePath);
  return current === undefined ? null : sha256(current);
}

function renderInstall(context: HostInstallContext): DesiredState {
  refuseObservationIssues(context.observation);
  if (context.environment !== "qa") throw new InstallError("unsupported_selection");
  const existing = context.observation.currentState;
  if (context.command === "update" && existing === undefined) {
    throw new InstallError("not_installed", STATE_PATH);
  }
  if (existing !== undefined && existing.environment !== "qa") {
    throw new InstallError("environment_conflict", STATE_PATH);
  }

  const version = readPackageVersion(context.packageRoot);
  const originals = existing?.originals ?? captureOriginals(context.target);
  const originalConfig = decodeOriginal(originals[CONFIG_PATH], CONFIG_PATH) ?? undefined;
  const originalHooks = decodeOriginal(originals[HOOKS_PATH], HOOKS_PATH) ?? undefined;
  const desiredBytes = new Map<string, Buffer>();
  desiredBytes.set(CONFIG_PATH, renderConfig(originalConfig, context.packageRoot));
  desiredBytes.set(HOOKS_PATH, renderHooks(originalHooks));
  desiredBytes.set(
    SKILL_PATH,
    sourceAsset(context.packageRoot, "kcoderag-qa/skills/code-lookup-discipline/SKILL.md"),
  );
  for (const asset of HOOK_ASSETS) {
    desiredBytes.set(
      `${HOOK_PREFIX}/${asset}`,
      sourceAsset(context.packageRoot, `kcoderag-qa/hooks/${asset}`),
    );
  }
  const digests: Record<string, string> = {};
  for (const [relativePath, bytes] of desiredBytes) digests[relativePath] = sha256(bytes);
  const state: InstallState = {
    schemaVersion: 1,
    packageVersion: version,
    host: "codex",
    environment: "qa",
    managedFiles: [...MANAGED_PATHS],
    originals,
    digests,
  };
  desiredBytes.set(STATE_PATH, Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8"));
  const stateBytes = details(context.observation).stateBytes;
  return createDesiredState({
    host: "codex",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: MANAGED_PATHS.map((relativePath) => ({
      relativePath,
      expectedDigest: expectedDigest(context.target, relativePath, existing, stateBytes),
      content: desiredBytes.get(relativePath) ?? null,
    })),
  });
}

function renderUninstall(context: HostUninstallContext): DesiredState {
  refuseObservationIssues(context.observation);
  const state = context.observation.currentState;
  const stateBytes = details(context.observation).stateBytes;
  if (state === undefined || stateBytes === undefined) {
    throw new InstallError("not_installed", STATE_PATH);
  }
  return createDesiredState({
    host: "codex",
    target: context.target,
    managedRoots: MANAGED_ROOTS,
    statePath: STATE_PATH,
    entries: MANAGED_PATHS.map((relativePath) => ({
      relativePath,
      expectedDigest: relativePath === STATE_PATH
        ? sha256(stateBytes)
        : state.digests[relativePath] ?? null,
      content: relativePath === STATE_PATH
        ? null
        : decodeOriginal(state.originals[relativePath], relativePath),
    })),
  });
}

function tracerStatus(context: HostStatusContext) {
  const issue = context.observation.issues?.[0];
  if (issue !== undefined) {
    return createStatusResult({
      status: issue.code === "managed_content_changed" ? "drifted" : "invalid",
      host: "codex",
      issues: [issue],
    });
  }
  const state = context.observation.currentState;
  if (state === undefined) return createStatusResult({ host: "codex" });
  let status: "healthy" | "update_available" = "healthy";
  try {
    if (state.packageVersion !== readPackageVersion(context.packageRoot)) status = "update_available";
  } catch {
    return createStatusResult({
      status: "invalid",
      host: "codex",
      environment: state.environment,
      issues: [{ code: "invalid_package", path: "package.json" }],
    });
  }
  return createStatusResult({
    status,
    host: "codex",
    environment: state.environment,
  });
}

export const codexTracerAdapter: HostAdapter = Object.freeze({
  id: "codex",
  managedRoots: MANAGED_ROOTS,
  detect: detectCodex,
  renderInstall,
  renderUninstall,
  status: tracerStatus,
});

export function installCodexQa(options: InstallOptions): InstallResult {
  const target = resolveProjectTarget(options.target);
  const observation = codexTracerAdapter.detect({ target, packageRoot: options.packageRoot });
  const desired = codexTracerAdapter.renderInstall({
    target,
    packageRoot: options.packageRoot,
    command: "install",
    environment: "qa",
    observation,
    allowLegacyUserRemoval: false,
  });
  const transactionOptions: {
    failAtStage?: number;
    failAtCommit?: number;
    onCommit?: (relativePath: string) => void;
  } = {};
  if (options.failAtStage !== undefined) transactionOptions.failAtStage = options.failAtStage;
  if (options.failAtCommit !== undefined) transactionOptions.failAtCommit = options.failAtCommit;
  if (options.onCommit !== undefined) transactionOptions.onCommit = options.onCommit;
  applyTransaction(desired, transactionOptions);
  return {
    host: "codex",
    environment: "qa",
    target: target.root,
    version: readPackageVersion(options.packageRoot),
    managedFiles: [...MANAGED_PATHS],
  };
}

export async function runCli(
  argv: string[],
  dependencies: LegacyCliDependencies = {},
): Promise<number> {
  const commandDependencies: CommandDependencies = {
    cwd: dependencies.cwd ?? process.cwd(),
    packageRoot: dependencies.packageRoot ?? path.resolve(__dirname, "../.."),
    nodeVersion: dependencies.nodeVersion ?? process.versions.node,
    stdout: dependencies.stdout ?? ((text) => process.stdout.write(`${text}\n`)),
    stderr: dependencies.stderr ?? ((text) => process.stderr.write(`${text}\n`)),
    selectHost: () => "codex",
    confirmTarget: (request) => dependencies.confirm?.(
      `${request.command} KCodeRag Nav in ${request.target}?`,
    ) ?? false,
    confirmLegacyUserRemoval: () => false,
    getAdapter: (host) => {
      if (host !== "codex") throw new InstallError("unsupported_host");
      return codexTracerAdapter;
    },
  };
  return executeCommand(argv, commandDependencies);
}

async function defaultConfirm(prompt: string): Promise<boolean> {
  const interfaceInstance = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await interfaceInstance.question(`${prompt} [y/N] `);
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    interfaceInstance.close();
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return runCli(argv, { confirm: defaultConfirm });
}

exports.InstallError = InstallError;
exports.MANAGED_PATHS = MANAGED_PATHS;
