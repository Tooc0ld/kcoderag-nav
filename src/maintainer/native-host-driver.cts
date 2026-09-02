#!/usr/bin/env node
/** Candidate-bound Windows native-host acceptance driver with metadata-only output. */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type { HostId } from "../core/contracts.cjs";
import {
  COMMON_OBSERVATION_KEYS,
  HOST_OBSERVATION_KEYS,
  emptyCommonObservations,
  emptyHostObservations,
  type AcceptanceObservations,
  type CommonObservationKey,
  type FailureReasonCode,
  type ReceiptStage,
} from "../smoke/acceptance-receipt.cjs";
import {
  liveEnvironment,
  projectCodexLiveConfig,
  projectLiveCredential,
} from "../smoke/host-smoke.cjs";

export const DRIVER_HOSTS = Object.freeze(["codex", "claude", "cursor", "opencode", "zcode"] as const);

const MAX_NATIVE_OUTPUT_BYTES = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const SAFE_PATH_BYTES = 16 * 1024 * 1024;
const PID_FILE = "native-processes.json";
const ZCODE_FROZEN_VERSION = "3.10.1";
const EXACT_VERSION_RE = /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/u;
const SECRET_SHAPED_RE = /(?:https?:\/\/|bearer\s|authorization\s*[:=]|token\s*[:=]|credential\s*[:=]|secret\s*[:=])/iu;
const NATIVE_PROMPT = [
  "Use only the installed kcoderag MCP tools for this acceptance sequence.",
  "Call list_indexes once, then call search_code for the fixed acceptance canary identifier.",
  "After the native feedback reminder, call submit_feedback once with an acceptance-only rating, then call search_code once more.",
  "Do not inspect project files, run a shell, quote source, connection data, tool arguments, or tool results.",
].join(" ");

type DriverAction = "probe" | "run" | "cleanup";

export interface NativeDriverInput {
  readonly host: HostId;
  readonly project: string;
  readonly cache: string;
  readonly npmCache: string;
  readonly package: string;
}

export interface NativeCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly authMissing?: boolean;
}

export interface NativeDriverDependencies {
  readonly resolveCommand: (name: string) => string | undefined;
  readonly runCommand: (
    executable: string,
    args: readonly string[],
    options: Readonly<Record<string, unknown>>,
  ) => Promise<NativeCommandResult>;
  readonly pathExists?: (filePath: string) => boolean;
}

interface StructuredEvidence {
  readonly sessionStart: boolean;
  readonly hookOutput: boolean;
  readonly grepHook: boolean;
  readonly globHook: boolean;
  readonly bashHook: boolean;
  readonly listIndexes: boolean;
  readonly searchCodeCount: number;
  readonly structuredResult: boolean;
  readonly feedbackReminder: boolean;
  readonly submitFeedback: boolean;
  readonly feedbackSuppressed: boolean;
  readonly cursorReload: boolean;
  readonly cursorRule: boolean;
  readonly cursorSkill: boolean;
  readonly cursorAfterMcp: boolean;
  readonly pluginLoaded: boolean;
  readonly pluginCallback: boolean;
  readonly workspaceSkill: boolean;
  readonly zcodePre: boolean;
  readonly zcodePost: boolean;
}

interface NativeSpec {
  readonly executable: string;
  readonly args: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHost(value: unknown): value is HostId {
  if (typeof value !== "string") return false;
  return DRIVER_HOSTS.includes(value as HostId);
}

function safeRegularFile(filePath: string): boolean {
  try {
    const metadata = fs.lstatSync(filePath);
    return metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0 && metadata.size <= SAFE_PATH_BYTES;
  } catch {
    return false;
  }
}

function defaultResolveCommand(name: string): string | undefined {
  const command = process.platform === "win32" ? "where.exe" : "sh";
  const args = process.platform === "win32" ? [name] : ["-c", `command -v -- ${name}`];
  const result = childProcess.spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return undefined;
  const candidates = result.stdout.split(/\r?\n/u).map((item) => item.trim()).filter((item) => item.length > 0);
  const first = process.platform === "win32"
    ? candidates.find((item) => /\.(?:exe|cmd|bat)$/iu.test(item)) ?? candidates.find((item) => /\.ps1$/iu.test(item))
    : candidates[0];
  return first === undefined ? undefined : path.resolve(first);
}

/** Discover only fixed host executable names plus ZCode's bounded per-user install location. */
export function discoverHostExecutable(
  host: HostId,
  environment: NodeJS.ProcessEnv = process.env,
  resolveCommand: (name: string) => string | undefined = defaultResolveCommand,
  pathExists: (filePath: string) => boolean = safeRegularFile,
): string | undefined {
  const names = host === "claude"
    ? ["kscc"]
    : host === "cursor"
      ? ["cursor-agent", "cursor"]
      : host === "zcode"
        ? ["zcode-agent", "zcode"]
        : [host];
  for (const name of names) {
    const resolved = resolveCommand(name);
    if (resolved !== undefined && pathExists(resolved)) return resolved;
  }
  if (host !== "zcode") return undefined;
  const localAppData = environment.LOCALAPPDATA;
  if (localAppData === undefined || localAppData.length === 0) return undefined;
  const installationRoot = path.join(localAppData, "Programs", "ZCode");
  const runtime = path.join(installationRoot, "resources", "glm", "zcode.cjs");
  if (pathExists(runtime)) return runtime;
  const desktop = path.join(installationRoot, "ZCode.exe");
  return pathExists(desktop) ? desktop : undefined;
}

function versionFromOutput(output: string): string | undefined {
  if (Buffer.byteLength(output, "utf8") > 16 * 1024 || SECRET_SHAPED_RE.test(output)) return undefined;
  return EXACT_VERSION_RE.exec(output)?.[1];
}

function hostVersionEnvironmentName(host: HostId): string {
  return `KCODERAG_${host.toUpperCase()}_VERSION`;
}

function workspaceTrustApproved(): boolean {
  return process.env.KCODERAG_ZCODE_WORKSPACE_TRUST === "approved";
}

function safeInput(input: Readonly<Record<string, string>>): NativeDriverInput | undefined {
  const host = input.host;
  if (!isHost(host)) return undefined;
  const project = input.project;
  const cache = input.cache;
  const npmCache = input.npmCache;
  const packagePath = input.package;
  if (typeof project !== "string" || project.length === 0 || project.length > 32_768
    || typeof cache !== "string" || cache.length === 0 || cache.length > 32_768
    || typeof npmCache !== "string" || npmCache.length === 0 || npmCache.length > 32_768
    || typeof packagePath !== "string" || packagePath.length === 0 || packagePath.length > 32_768) return undefined;
  return Object.freeze({
    host,
    project: path.resolve(project),
    cache: path.resolve(cache),
    npmCache: path.resolve(npmCache),
    package: path.resolve(packagePath),
  });
}

function hostVersion(input: NativeDriverInput, executable: string, dependencies: NativeDriverDependencies): Promise<string | undefined> {
  const fromEnvironment = process.env[hostVersionEnvironmentName(input.host)];
  if (input.host === "zcode") {
    const desktopVersion = fromEnvironment === undefined ? undefined : versionFromOutput(fromEnvironment);
    if (desktopVersion !== ZCODE_FROZEN_VERSION || path.extname(executable).toLowerCase() !== ".cjs") {
      return Promise.resolve(undefined);
    }
    return dependencies.runCommand(process.execPath, [executable, "--version"], {
      cwd: input.project,
      env: process.env,
      timeoutMs: 15_000,
      pidRoot: input.cache,
    }).then((result) => result.code === 0 && versionFromOutput(result.stdout) === "0.16.5"
      ? desktopVersion
      : undefined);
  }
  if (fromEnvironment !== undefined) {
    const normalized = versionFromOutput(fromEnvironment);
    if (normalized !== undefined) return Promise.resolve(normalized);
  }
  return dependencies.runCommand(executable, ["--version"], {
    cwd: input.project,
    env: process.env,
    timeoutMs: 15_000,
    pidRoot: input.cache,
  }).then((result) => result.code === 0 ? versionFromOutput(result.stdout) : undefined);
}

export async function probeNativeHost(
  rawInput: Readonly<Record<string, string>>,
  dependencies: NativeDriverDependencies = defaultDependencies(),
): Promise<Readonly<Record<string, unknown>>> {
  const input = safeInput(rawInput);
  if (input === undefined) return Object.freeze({ admitted: false, stage: "environment", reasonCode: "runner_unavailable" });
  const exists = dependencies.pathExists ?? safeRegularFile;
  const executable = discoverHostExecutable(input.host, process.env, dependencies.resolveCommand, exists);
  if (executable === undefined) {
    return Object.freeze({ admitted: false, stage: "environment", reasonCode: "host_unavailable" });
  }
  if (input.host === "zcode" && !workspaceTrustApproved()) {
    return Object.freeze({ admitted: false, stage: "admission", reasonCode: "workspace_trust_missing" });
  }
  if ((input.host === "cursor" && !path.basename(executable).toLowerCase().includes("cursor-agent"))
    || (input.host === "zcode" && path.extname(executable).toLowerCase() !== ".cjs")) {
    return Object.freeze({ admitted: false, stage: "environment", reasonCode: "host_cli_missing" });
  }
  const version = await hostVersion(input, executable, dependencies);
  if (version === undefined || (input.host === "zcode" && version !== ZCODE_FROZEN_VERSION)) {
    return Object.freeze({ admitted: false, stage: "admission", reasonCode: "host_version_unsupported" });
  }
  if (input.host === "zcode") {
    const admission = await dependencies.runCommand(process.execPath, [
      executable, "--prompt", "Reply only with ready.", "--cwd", input.project,
      "--json", "--max-turns", "1", "--allowed-tools", "",
    ], {
      cwd: input.project,
      env: process.env,
      timeoutMs: 60_000,
      pidRoot: input.cache,
    });
    if (admission.code !== 0 && (admission.authMissing === true || /(?:auth|login)/iu.test(admission.stdout))) {
      return Object.freeze({ admitted: false, stage: "admission", reasonCode: "host_auth_missing" });
    }
  }
  return Object.freeze({ admitted: true });
}

function npmCliPath(): string | undefined {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((candidate): candidate is string => candidate !== undefined && safeRegularFile(candidate));
}

function isolatedEnvironment(input: NativeDriverInput): NodeJS.ProcessEnv {
  const environment = liveEnvironment(input.host, input.cache);
  environment.npm_config_cache = input.npmCache;
  environment.KCODERAG_NAV_UPDATE_CHECK = "0";
  return environment;
}

function parseCliResult(result: NativeCommandResult): Record<string, unknown> | undefined {
  if (result.code !== 0 || Buffer.byteLength(result.stdout, "utf8") > MAX_NATIVE_OUTPUT_BYTES || SECRET_SHAPED_RE.test(result.stdout)) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(result.stdout.trim());
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function lifecycle(
  input: NativeDriverInput,
  command: "install" | "status" | "update" | "uninstall",
  dependencies: NativeDriverDependencies,
): Promise<Record<string, unknown> | undefined> {
  const npmCli = npmCliPath();
  if (npmCli === undefined) return undefined;
  const args = [npmCli, "exec", "--yes", "--ignore-scripts", `--package=${input.package}`, "--", "kcoderag-nav",
    command, "--host", input.host, "--target", input.project, "--json"];
  if (command === "install") args.push("--capability", "kcoderag-navigation");
  if (command === "uninstall") args.push("--all");
  if (command !== "status") args.push("--yes");
  return parseCliResult(await dependencies.runCommand(process.execPath, args, {
    cwd: input.project,
    env: isolatedEnvironment(input),
    timeoutMs: COMMAND_TIMEOUT_MS,
    pidRoot: input.cache,
  }));
}

function nativeSpec(input: NativeDriverInput, executable: string): NativeSpec | undefined {
  if (input.host === "codex") {
    return Object.freeze({ executable, args: Object.freeze([
      "exec", "--enable", "hooks", "--ephemeral", "--dangerously-bypass-hook-trust",
      "--approve-for-me", "--skip-git-repo-check", "--json", "--cd", input.project, NATIVE_PROMPT,
    ]) });
  }
  if (input.host === "claude") {
    return Object.freeze({ executable, args: Object.freeze([
      "-p", NATIVE_PROMPT, "--mcp-config", path.join(input.project, ".mcp.json"), "--strict-mcp-config",
      "--allowedTools", [
        "Grep", "Glob", "Bash",
        "mcp__kcoderag-qa__list_indexes", "mcp__kcoderag-qa__search_code", "mcp__kcoderag-qa__submit_feedback",
        "mcp__kcoderag_qa__list_indexes", "mcp__kcoderag_qa__search_code", "mcp__kcoderag_qa__submit_feedback",
      ].join(","),
      "--include-hook-events", "--no-session-persistence", "--output-format", "stream-json", "--verbose",
    ]) });
  }
  if (input.host === "opencode") {
    return Object.freeze({ executable, args: Object.freeze(["run", "--format", "json", "--dir", input.project, "--auto", NATIVE_PROMPT]) });
  }
  if (input.host === "cursor") {
    const isAgentBinary = path.basename(executable).toLowerCase().includes("cursor-agent");
    return Object.freeze({ executable, args: Object.freeze([
      ...(isAgentBinary ? [] : ["agent"]), "-p", NATIVE_PROMPT, "--output-format", "stream-json", "--workspace", input.project,
    ]) });
  }
  if (path.extname(executable).toLowerCase() !== ".cjs") return undefined;
  return Object.freeze({ executable: process.execPath, args: Object.freeze([
    executable, "--prompt", NATIVE_PROMPT, "--cwd", input.project, "--json", "--max-turns", "8",
    "--allowed-tools", "list_indexes,search_code,submit_feedback",
  ]) });
}

function parseJsonLines(output: string): readonly unknown[] {
  if (Buffer.byteLength(output, "utf8") > MAX_NATIVE_OUTPUT_BYTES) return Object.freeze([]);
  const values: unknown[] = [];
  for (const line of output.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    try { values.push(JSON.parse(line)); } catch { /* Natural-language claims never count. */ }
  }
  return Object.freeze(values);
}

function textFields(value: Record<string, unknown>): readonly string[] {
  return Object.entries(value)
    .filter(([key, item]) => ["additionalContext", "additional_context", "message", "text"].includes(key) && typeof item === "string")
    .map(([, item]) => item as string);
}

function logicalToolName(value: Record<string, unknown>): string | undefined {
  for (const key of ["tool_name", "toolName", "tool", "name"] as const) {
    const item = value[key];
    if (typeof item !== "string") continue;
    const match = /(?:^|__|_)(list_indexes|search_code|submit_feedback)$/u.exec(item);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

function reliableSuccess(value: Record<string, unknown>): boolean {
  if (value.success === false || value.isError === true || value.status === "failed" || value.error !== undefined) return false;
  if (value.success === true || value.isError === false || value.status === "completed" || value.status === "success") return true;
  if (isRecord(value.result) && value.result.error === undefined
    && (value.result.isError === false || value.result.success === true)) return true;
  return false;
}

function structuredEvidence(output: string): StructuredEvidence {
  let sessionStart = false;
  let hookOutput = false;
  let grepHook = false;
  let globHook = false;
  let bashHook = false;
  let listIndexes = false;
  let searchCodeCount = 0;
  let structuredResult = false;
  let feedbackReminder = false;
  let submitFeedback = false;
  let lastSubmitOrdinal = -1;
  let lastSearchOrdinal = -1;
  let reminderAfterSubmit = false;
  let cursorReload = false;
  let cursorRule = false;
  let cursorSkill = false;
  let cursorAfterMcp = false;
  let pluginLoaded = false;
  let pluginCallback = false;
  let workspaceSkill = false;
  let zcodePre = false;
  let zcodePost = false;
  let ordinal = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!isRecord(value)) return;
    ordinal += 1;
    const eventName = [value.hook_event_name, value.hookEventName, value.event, value.type]
      .find((item): item is string => typeof item === "string") ?? "";
    const toolName = logicalToolName(value);
    const texts = textFields(value);
    const hasKCodeRagContext = texts.some((item) => /KCodeRag/u.test(item));
    const hasFeedbackContext = texts.some((item) => /submit_feedback/u.test(item));
    if (/SessionStart/iu.test(eventName) && hasKCodeRagContext) sessionStart = true;
    if (/(?:PreToolUse|PostToolUse|hook)/iu.test(eventName) && hasKCodeRagContext) hookOutput = true;
    if (/PreToolUse/iu.test(eventName) && value.tool_name === "Grep") grepHook = true;
    if (/PreToolUse/iu.test(eventName) && value.tool_name === "Glob") globHook = true;
    if (/PreToolUse/iu.test(eventName) && value.tool_name === "Bash") bashHook = true;
    if (/afterMCPExecution/iu.test(eventName)) cursorAfterMcp = true;
    if (/reload/iu.test(eventName) && value.success === true) cursorReload = true;
    if (/rule/iu.test(eventName) && value.loaded === true) cursorRule = true;
    if (/skill/iu.test(eventName) && value.loaded === true) {
      cursorSkill = true;
      workspaceSkill = true;
    }
    if (/plugin.*load/iu.test(eventName) && value.success === true) pluginLoaded = true;
    if (/tool\.execute\.after/iu.test(eventName)) pluginCallback = true;
    if (/PreToolUse/iu.test(eventName)) zcodePre = true;
    if (/PostToolUse/iu.test(eventName)) zcodePost = true;
    if (toolName !== undefined && reliableSuccess(value)) {
      if (toolName === "list_indexes") listIndexes = true;
      if (toolName === "search_code") {
        searchCodeCount += 1;
        lastSearchOrdinal = ordinal;
        structuredResult ||= isRecord(value.structuredContent) || isRecord(value.structured_content)
          || (isRecord(value.result)
            && (isRecord(value.result.structuredContent) || isRecord(value.result.structured_content)));
      }
      if (toolName === "submit_feedback") {
        submitFeedback = true;
        lastSubmitOrdinal = ordinal;
      }
    }
    if (hasFeedbackContext) {
      feedbackReminder = true;
      if (lastSubmitOrdinal >= 0) reminderAfterSubmit = true;
    }
    for (const child of Object.values(value)) visit(child);
  };
  for (const value of parseJsonLines(output)) visit(value);
  return Object.freeze({
    sessionStart, hookOutput, grepHook, globHook, bashHook, listIndexes, searchCodeCount, structuredResult,
    feedbackReminder, submitFeedback,
    feedbackSuppressed: submitFeedback && lastSearchOrdinal > lastSubmitOrdinal && !reminderAfterSubmit,
    cursorReload, cursorRule, cursorSkill, cursorAfterMcp, pluginLoaded, pluginCallback, workspaceSkill,
    zcodePre, zcodePost,
  });
}

function markerRecorded(input: NativeDriverInput): boolean {
  const roots = [
    path.join(input.cache, "local-app-data", "kcoderag-nav", "mcp-calls"),
    path.join(input.cache, "xdg-cache", "kcoderag-nav", "mcp-calls"),
    path.join(input.cache, "kcoderag-nav", "mcp-calls"),
  ];
  return roots.some((root) => {
    try {
      return fs.readdirSync(root).some((name) => /^[a-f0-9]{64}\.json$/u.test(name) && safeRegularFile(path.join(root, name)));
    } catch {
      return false;
    }
  });
}

async function malformedFailOpen(input: NativeDriverInput, dependencies: NativeDriverDependencies): Promise<boolean> {
  const candidates = input.host === "codex"
    ? [path.join(input.project, ".codex", "kcoderag-nav", "qa", "hooks", "pre-tool-dispatcher.cjs")]
    : input.host === "claude"
      ? [path.join(input.project, ".claude", "kcoderag-nav", "qa", "hooks", "pre-tool-dispatcher.cjs")]
      : input.host === "cursor"
        ? [path.join(input.project, ".cursor", "kcoderag-nav", "hooks", "feedback-nudge.cjs")]
        : input.host === "opencode"
          ? [path.join(input.project, ".opencode", "kcoderag-nav", "hooks", "feedback-nudge.cjs")]
          : [path.join(input.project, ".zcode", "kcoderag-nav", "hooks", "pre-tool-dispatcher.cjs")];
  const script = candidates.find(safeRegularFile);
  if (script === undefined) return false;
  const result = await dependencies.runCommand(process.execPath, [script], {
    cwd: input.project,
    env: isolatedEnvironment(input),
    input: "{malformed",
    timeoutMs: 10_000,
    pidRoot: input.cache,
  });
  return result.code === 0 && result.stdout.length === 0;
}

function hostObservations(host: HostId, native: StructuredEvidence, nativeRan: boolean): Readonly<Record<string, boolean>> {
  if (host === "codex") return Object.freeze({
    directMcpRegistrationObserved: native.listIndexes,
    nativeSessionStartObserved: native.sessionStart,
    nativeHookOutputObserved: native.hookOutput,
  });
  if (host === "claude") return Object.freeze({
    nativeSessionStartObserved: native.sessionStart,
    nativeGrepHookObserved: native.grepHook,
    nativeGlobHookObserved: native.globHook,
    nativeBashHookObserved: native.bashHook,
  });
  if (host === "cursor") return Object.freeze({
    reloadObserved: native.cursorReload,
    realMcpObserved: nativeRan && native.searchCodeCount > 0,
    ruleObserved: native.cursorRule,
    skillObserved: native.cursorSkill,
    afterMcpExecutionObserved: native.cursorAfterMcp,
  });
  if (host === "opencode") return Object.freeze({
    projectLifecycleObserved: nativeRan,
    pluginLoaded: native.pluginLoaded,
    pluginCallbackObserved: native.pluginCallback,
    realToolBehaviorObserved: native.searchCodeCount > 0,
  });
  return Object.freeze({
    frozenVersionMatched: process.env.KCODERAG_ZCODE_VERSION?.startsWith(ZCODE_FROZEN_VERSION) === true,
    workspaceTrustApproved: workspaceTrustApproved(),
    workspaceSkillObserved: native.workspaceSkill,
    nativePreToolObserved: native.zcodePre,
    nativePostToolObserved: native.zcodePost,
  });
}

function failureFromObservations(observations: AcceptanceObservations): {
  readonly stage: ReceiptStage;
  readonly reasonCode: FailureReasonCode;
} | undefined {
  const common = observations.common;
  const ordered: readonly [CommonObservationKey, ReceiptStage, FailureReasonCode][] = [
    ["packageInstalled", "install", "install_failed"],
    ["statusHealthy", "install", "status_unhealthy"],
    ["updateIdempotent", "install", "update_failed"],
    ["nativeHostProcess", "native_event", "native_event_failed"],
    ["sessionBaselineObserved", "native_event", "native_event_missing"],
    ["mcpRegistered", "mcp", "mcp_registration_missing"],
    ["listIndexesSucceeded", "mcp", "list_indexes_unavailable"],
    ["searchCodeSucceeded", "mcp", "mcp_call_failed"],
    ["structuredResultValid", "mcp", "structured_result_invalid"],
    ["feedbackReminderObserved", "feedback", "feedback_reminder_missing"],
    ["submitFeedbackSucceeded", "feedback", "submit_feedback_failed"],
    ["feedbackSuppressed", "feedback", "feedback_suppression_failed"],
    ["malformedFailOpen", "native_event", "native_event_failed"],
    ["successMarkerRecorded", "native_event", "native_event_missing"],
    ["uninstallRestored", "install", "uninstall_failed"],
  ];
  for (const [key, stage, reasonCode] of ordered) if (!common[key]) return { stage, reasonCode };
  if (Object.values(observations.host).some((value) => !value)) {
    return { stage: "native_event", reasonCode: "native_event_missing" };
  }
  return undefined;
}

export async function runNativeHost(
  rawInput: Readonly<Record<string, string>>,
  dependencies: NativeDriverDependencies = defaultDependencies(),
): Promise<Readonly<Record<string, unknown>>> {
  const input = safeInput(rawInput);
  if (input === undefined) return failureOutcome("evidence_integrity", "receipt_invalid", "codex");
  const common = { ...emptyCommonObservations() } as Record<CommonObservationKey, boolean>;
  let native = structuredEvidence("");
  let installed = false;
  let executable: string | undefined;
  const finalize = async (nativeRan: boolean): Promise<Readonly<Record<string, unknown>>> => {
    if (installed) {
      try {
        const removed = await lifecycle(input as NativeDriverInput, "uninstall", dependencies);
        common.uninstallRestored = removed?.ok === true;
      } catch {
        common.uninstallRestored = false;
      }
      installed = false;
    }
    return outcome((input as NativeDriverInput).host, common, native, nativeRan, false);
  };
  try {
    fs.mkdirSync(input.project, { recursive: true });
    fs.mkdirSync(input.cache, { recursive: true });
    fs.mkdirSync(input.npmCache, { recursive: true });
    if (!safeRegularFile(input.package)) return failureOutcome("package", "package_acquisition_failed", input.host);
    executable = discoverHostExecutable(input.host, process.env, dependencies.resolveCommand, dependencies.pathExists ?? safeRegularFile);
    if (executable === undefined) return failureOutcome("native_event", "native_event_failed", input.host);
    const install = await lifecycle(input, "install", dependencies);
    installed = install?.ok === true;
    common.packageInstalled = installed;
    if (!installed) return await finalize(false);
    const status = await lifecycle(input, "status", dependencies);
    common.statusHealthy = status?.ok === true && status.status === "healthy";
    const firstUpdate = await lifecycle(input, "update", dependencies);
    const secondUpdate = await lifecycle(input, "update", dependencies);
    common.updateIdempotent = firstUpdate?.ok === true && secondUpdate?.ok === true;

    projectLiveCredential(input.host, input.cache);
    if (input.host === "codex" && !projectCodexLiveConfig(input.project, input.cache)) {
      return await finalize(false);
    }
    const spec = nativeSpec(input, executable);
    let nativeRan = false;
    if (spec !== undefined) {
      const result = await dependencies.runCommand(spec.executable, spec.args, {
        cwd: input.project,
        env: isolatedEnvironment(input),
        timeoutMs: COMMAND_TIMEOUT_MS,
        pidRoot: input.cache,
      });
      nativeRan = result.code === 0;
      native = structuredEvidence(result.stdout);
    }
    common.nativeHostProcess = nativeRan;
    common.sessionBaselineObserved = input.host === "cursor"
      ? native.cursorRule && native.cursorSkill
      : input.host === "opencode"
        ? native.pluginLoaded
        : native.sessionStart;
    common.mcpRegistered = native.listIndexes || native.searchCodeCount > 0 || native.submitFeedback;
    common.listIndexesSucceeded = native.listIndexes;
    common.searchCodeSucceeded = native.searchCodeCount > 0;
    common.structuredResultValid = native.structuredResult;
    common.feedbackReminderObserved = native.feedbackReminder;
    common.submitFeedbackSucceeded = native.submitFeedback;
    common.feedbackSuppressed = native.feedbackSuppressed;
    common.malformedFailOpen = await malformedFailOpen(input, dependencies);
    common.successMarkerRecorded = markerRecorded(input);
    return await finalize(nativeRan);
  } catch {
    return await finalize(false);
  } finally {
    if (installed) {
      try {
        const removed = await lifecycle(input, "uninstall", dependencies);
        common.uninstallRestored = removed?.ok === true;
      } catch {
        common.uninstallRestored = false;
      }
    }
  }
}

function outcome(
  host: HostId,
  common: Record<CommonObservationKey, boolean>,
  native: StructuredEvidence,
  nativeRan: boolean,
  processTreeCleaned: boolean,
): Readonly<Record<string, unknown>> {
  common.processTreeCleaned = processTreeCleaned;
  const observations: AcceptanceObservations = Object.freeze({
    common: Object.freeze(Object.fromEntries(COMMON_OBSERVATION_KEYS.map((key) => [key, common[key] === true]))) as AcceptanceObservations["common"],
    host: Object.freeze(Object.fromEntries(HOST_OBSERVATION_KEYS[host].map((key) => [key,
      hostObservations(host, native, nativeRan)[key] === true]))),
  });
  const failure = failureFromObservations(observations);
  return Object.freeze({
    status: failure === undefined ? "PASS" : "FAIL",
    stage: failure?.stage ?? "evidence_integrity",
    reasonCode: failure?.reasonCode ?? "none",
    observations,
  });
}

function failureOutcome(stage: ReceiptStage, reasonCode: FailureReasonCode, host: HostId): Readonly<Record<string, unknown>> {
  return Object.freeze({
    status: "FAIL",
    stage,
    reasonCode,
    observations: Object.freeze({ common: emptyCommonObservations(), host: emptyHostObservations(host) }),
  });
}

function pidFile(cacheRoot: string): string {
  return path.join(cacheRoot, PID_FILE);
}

function appendOwnedPid(cacheRoot: string, pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  fs.mkdirSync(cacheRoot, { recursive: true });
  let current: number[] = [];
  try {
    const value: unknown = JSON.parse(fs.readFileSync(pidFile(cacheRoot), "utf8"));
    if (Array.isArray(value)) current = value.filter((item): item is number => Number.isSafeInteger(item) && item > 0);
  } catch { /* first process */ }
  const temporary = `${pidFile(cacheRoot)}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify([...new Set([...current, pid])])}\n`, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, pidFile(cacheRoot));
}

function ownedPids(cacheRoot: string): readonly number[] {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(pidFile(cacheRoot), "utf8"));
    if (!Array.isArray(value) || value.length > 256) return Object.freeze([]);
    return Object.freeze(value.filter((item): item is number => Number.isSafeInteger(item) && item > 0));
  } catch {
    return Object.freeze([]);
  }
}

function terminateOwnedPid(pid: number): void {
  try {
    if (process.platform === "win32") {
      childProcess.spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 10_000,
      });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch { /* absence is already clean */ }
}

export async function cleanupNativeHost(rawInput: Readonly<Record<string, string>>): Promise<Readonly<{ cleaned: true }>> {
  const input = safeInput(rawInput);
  if (input === undefined) throw new Error("arguments_invalid");
  for (const pid of ownedPids(input.cache)) terminateOwnedPid(pid);
  try { fs.rmSync(pidFile(input.cache), { force: true }); } catch { /* lane cleanup follows */ }
  return Object.freeze({ cleaned: true });
}

function defaultRunCommand(
  executable: string,
  args: readonly string[],
  options: Readonly<Record<string, unknown>>,
): Promise<NativeCommandResult> {
  return new Promise((resolve) => {
    const cwd = typeof options.cwd === "string" ? options.cwd : process.cwd();
    const env = isRecord(options.env) ? options.env as NodeJS.ProcessEnv : process.env;
    const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : COMMAND_TIMEOUT_MS;
    const input = typeof options.input === "string" ? options.input : undefined;
    const pidRoot = typeof options.pidRoot === "string" ? options.pidRoot : undefined;
    const extension = path.extname(executable).toLowerCase();
    const selectedExecutable = process.platform === "win32" && (extension === ".cmd" || extension === ".bat")
      ? (process.env.ComSpec ?? "cmd.exe")
      : process.platform === "win32" && extension === ".ps1"
        ? "pwsh.exe"
        : executable;
    const selectedArgs = selectedExecutable === executable
      ? [...args]
      : extension === ".ps1"
        ? ["-NoProfile", "-NonInteractive", "-File", executable, ...args]
        : ["/d", "/s", "/c", executable, ...args];
    let stdout = "";
    let outputBytes = 0;
    let authMissing = false;
    let forcedFailure = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(Object.freeze({
        code: forcedFailure ? 1 : code,
        stdout: forcedFailure ? "" : stdout,
        ...(authMissing ? { authMissing: true } : {}),
      }));
    };
    const child = childProcess.spawn(selectedExecutable, selectedArgs, {
      cwd,
      env,
      windowsHide: true,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (pidRoot !== undefined && child.pid !== undefined) {
      try { appendOwnedPid(pidRoot, child.pid); } catch { forcedFailure = true; }
    }
    const stdoutPipe = child.stdout;
    if (stdoutPipe === null) return finish(1);
    stdoutPipe.setEncoding("utf8");
    stdoutPipe.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes <= MAX_NATIVE_OUTPUT_BYTES) stdout += chunk;
      else {
        forcedFailure = true;
        terminateOwnedPid(child.pid ?? -1);
      }
    });
    const stderrPipe = child.stderr;
    if (stderrPipe !== null) {
      stderrPipe.setEncoding("utf8");
      stderrPipe.on("data", (chunk: string) => {
        if (/(?:auth|login)/iu.test(chunk)) authMissing = true;
      });
    }
    if (input !== undefined) child.stdin?.end(input);
    child.on("error", () => finish(1));
    child.on("close", (code) => finish(code ?? 1));
    timer = setTimeout(() => {
      forcedFailure = true;
      terminateOwnedPid(child.pid ?? -1);
      finish(1);
    }, timeoutMs);
    timer.unref();
  });
}

function defaultDependencies(): NativeDriverDependencies {
  return Object.freeze({
    resolveCommand: defaultResolveCommand,
    runCommand: defaultRunCommand,
    pathExists: safeRegularFile,
  });
}

function parseArguments(argv: readonly string[]): { readonly action: DriverAction; readonly input: NativeDriverInput } {
  const action = argv[0];
  if (action !== "probe" && action !== "run" && action !== "cleanup") throw new Error("arguments_invalid");
  const flags: Record<string, string> = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--") || flags[key.slice(2)] !== undefined) {
      throw new Error("arguments_invalid");
    }
    flags[key.slice(2)] = value;
  }
  const normalized = safeInput({
    host: flags.host ?? "",
    project: flags.project ?? "",
    cache: flags.cache ?? "",
    npmCache: flags["npm-cache"] ?? "",
    package: flags.package ?? "",
  });
  if (normalized === undefined) throw new Error("arguments_invalid");
  return Object.freeze({ action, input: normalized });
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseArguments(argv);
    const input = parsed.input as unknown as Readonly<Record<string, string>>;
    const result = parsed.action === "probe"
      ? await probeNativeHost(input)
      : parsed.action === "run"
        ? await runNativeHost(input)
        : await cleanupNativeHost(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    return 1;
  }
}

exports.DRIVER_HOSTS = DRIVER_HOSTS;
exports.discoverHostExecutable = discoverHostExecutable;
exports.probeNativeHost = probeNativeHost;
exports.runNativeHost = runNativeHost;
exports.cleanupNativeHost = cleanupNativeHost;
exports.main = main;

if (require.main === module) {
  void main().then((code) => { process.exitCode = code; });
}
