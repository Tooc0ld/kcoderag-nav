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
  safeEnvironment,
} from "../smoke/host-smoke.cjs";

export const DRIVER_HOSTS = Object.freeze(["codex", "claude", "cursor", "opencode", "zcode"] as const);

const MAX_NATIVE_OUTPUT_BYTES = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const SAFE_PATH_BYTES = 16 * 1024 * 1024;
const PID_FILE = "native-processes.json";
const ZCODE_FROZEN_VERSION = "3.10.1";
const EXACT_VERSION_RE = /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/u;
const SECRET_SHAPED_RE = /(?:https?:\/\/|bearer\s|authorization\s*[:=]|token\s*[:=]|credential\s*[:=]|secret\s*[:=])/iu;
const NATIVE_CANARY_NAME = "kcoderag-native-canary.txt";
const NATIVE_CANARY_TEXT = "KCODERAG_NATIVE_ACCEPTANCE_CANARY";
const MCP_SEQUENCE_PROMPT = [
  "This is a mandatory four-step native MCP acceptance sequence; complete every numbered step and do not stop after an intermediate result.",
  "Use only the installed kcoderag MCP tools and do not wait for a toast or reminder before continuing.",
  "Step 1: call list_indexes exactly once.",
  `Step 2: call search_code for the exact query ${NATIVE_CANARY_TEXT}, using a usable index from step 1 when the tool requires one.`,
  "Step 3: record the truthful usability outcome from step 2, without claiming a defect, by calling submit_feedback exactly once with schema_version feedback-observation-v1, category usability_report, severity low, and repro_hint native acceptance observed structured search result.",
  `Step 4: call search_code again for the exact query ${NATIVE_CANARY_TEXT}, using the same index as step 2 when applicable.`,
  "Do not inspect project files, run a shell, or answer until all four tool calls have completed.",
  "Never quote source, connection data, tool arguments, or tool results.",
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
  readonly nativeErrorKind?: NativeErrorKind;
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

type NativeErrorKind =
  | "none"
  | "mcp"
  | "init"
  | "connect"
  | "timeout"
  | "auth"
  | "permission"
  | "protocol"
  | "tool_unavailable"
  | "path"
  | "other";

interface StructuredEvidence {
  readonly nativeErrorKind: NativeErrorKind;
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
      ? ["cursor-agent", "agent", "cursor"]
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

function hostVersion(
  input: NativeDriverInput,
  executable: string,
  environment: NodeJS.ProcessEnv,
  dependencies: NativeDriverDependencies,
): Promise<string | undefined> {
  const fromEnvironment = process.env[hostVersionEnvironmentName(input.host)];
  if (input.host === "zcode") {
    const desktopVersion = fromEnvironment === undefined ? undefined : versionFromOutput(fromEnvironment);
    if (desktopVersion !== ZCODE_FROZEN_VERSION || path.extname(executable).toLowerCase() !== ".cjs") {
      return Promise.resolve(undefined);
    }
    return dependencies.runCommand(process.execPath, [executable, "--version"], {
      cwd: input.project,
      env: environment,
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
    env: environment,
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
  fs.mkdirSync(input.project, { recursive: true });
  fs.mkdirSync(input.cache, { recursive: true });
  fs.mkdirSync(input.npmCache, { recursive: true });
  projectLiveCredential(input.host, input.cache);
  const environment = isolatedEnvironment(input);
  const exists = dependencies.pathExists ?? safeRegularFile;
  const executable = discoverHostExecutable(input.host, process.env, dependencies.resolveCommand, exists);
  if (executable === undefined) {
    return Object.freeze({ admitted: false, stage: "environment", reasonCode: "host_unavailable" });
  }
  if (input.host === "zcode" && !workspaceTrustApproved()) {
    return Object.freeze({ admitted: false, stage: "admission", reasonCode: "workspace_trust_missing" });
  }
  const cursorName = path.basename(executable).toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/u, "");
  if ((input.host === "cursor" && cursorName !== "cursor-agent" && cursorName !== "agent")
    || (input.host === "zcode" && path.extname(executable).toLowerCase() !== ".cjs")) {
    return Object.freeze({ admitted: false, stage: "environment", reasonCode: "host_cli_missing" });
  }
  if (input.host === "cursor") {
    const help = await dependencies.runCommand(executable, ["--help"], {
      cwd: input.project,
      env: environment,
      timeoutMs: 15_000,
      pidRoot: input.cache,
    });
    if (help.code !== 0 || !/--output-format/u.test(help.stdout) || !/(?:\bmcp\b|cursor)/iu.test(help.stdout)) {
      return Object.freeze({ admitted: false, stage: "environment", reasonCode: "host_cli_missing" });
    }
  }
  const version = await hostVersion(input, executable, environment, dependencies);
  if (version === undefined || (input.host === "zcode" && version !== ZCODE_FROZEN_VERSION)) {
    return Object.freeze({ admitted: false, stage: "admission", reasonCode: "host_version_unsupported" });
  }
  const admission = await dependencies.runCommand(...authenticationSpec(input, executable), {
      cwd: input.project,
      env: environment,
      timeoutMs: 60_000,
      pidRoot: input.cache,
  });
  if (admission.code !== 0) {
    if (admission.authMissing === true || /(?:auth|login)/iu.test(admission.stdout)) {
      return Object.freeze({ admitted: false, stage: "admission", reasonCode: "host_auth_missing" });
    }
    return Object.freeze({ admitted: false, stage: "admission", reasonCode: "protected_environment_denied" });
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

function lifecycleEnvironment(input: NativeDriverInput): NodeJS.ProcessEnv {
  const environment = safeEnvironment(input.cache, false, input.npmCache);
  environment.npm_config_cache = input.npmCache;
  environment.KCODERAG_NAV_UPDATE_CHECK = "0";
  return environment;
}

function authenticationSpec(input: NativeDriverInput, executable: string): [string, readonly string[]] {
  const prompt = "Reply only with ready. Do not call tools.";
  if (input.host === "codex") return [executable, [
    "exec", "--ephemeral", "--sandbox", "read-only", "-c", 'approval_policy="never"',
    "--skip-git-repo-check", "--json", "--cd", input.project, prompt,
  ]];
  if (input.host === "claude") return [executable, [
    "-p", prompt, "--no-session-persistence", "--output-format", "stream-json", "--verbose",
  ]];
  if (input.host === "opencode") return [executable, ["run", "--format", "json", "--dir", input.project, "--auto", prompt]];
  if (input.host === "cursor") return [executable, ["--print", "--output-format", "stream-json", prompt]];
  return [process.execPath, [
    executable, "--prompt", prompt, "--cwd", input.project, "--json", "--max-turns", "1", "--allowed-tools", "",
  ]];
}

type LifecycleCommand = "install" | "status" | "update" | "uninstall";

interface LifecycleResult {
  readonly value?: Record<string, unknown>;
  readonly reasonCode?: FailureReasonCode;
}

function lifecycleRefusalReason(command: LifecycleCommand): FailureReasonCode {
  if (command === "install") return "install_refused";
  if (command === "status") return "status_refused";
  if (command === "update") return "update_refused";
  return "uninstall_refused";
}

function parseCliResult(result: NativeCommandResult, command: LifecycleCommand): LifecycleResult {
  if (Buffer.byteLength(result.stdout, "utf8") > MAX_NATIVE_OUTPUT_BYTES || SECRET_SHAPED_RE.test(result.stdout)) {
    return Object.freeze({ reasonCode: "lifecycle_output_rejected" });
  }
  let value: unknown;
  try {
    value = JSON.parse(result.stdout.trim());
  } catch {
    if (result.nativeErrorKind === "timeout") return Object.freeze({ reasonCode: "lifecycle_timeout" });
    if (result.nativeErrorKind === "path") return Object.freeze({ reasonCode: "lifecycle_package_path_invalid" });
    return Object.freeze({ reasonCode: result.code === 0 ? "lifecycle_output_invalid" : "lifecycle_transport_failed" });
  }
  if (!isRecord(value)) return Object.freeze({ reasonCode: "lifecycle_output_invalid" });
  if (result.code !== 0 || value.ok !== true) return Object.freeze({ reasonCode: lifecycleRefusalReason(command) });
  return Object.freeze({ value });
}

async function lifecycle(
  input: NativeDriverInput,
  command: LifecycleCommand,
  dependencies: NativeDriverDependencies,
): Promise<LifecycleResult> {
  const npmCli = npmCliPath();
  if (npmCli === undefined) return Object.freeze({ reasonCode: "npm_cli_missing" });
  const args = [npmCli, "exec", "--yes", "--ignore-scripts", `--package=${input.package}`, "--", "kcoderag-nav",
    command, "--host", input.host, "--target", input.project, "--json"];
  if (command === "install") args.push("--capability", "kcoderag-navigation");
  if (command === "uninstall") args.push("--all");
  if (command !== "status") args.push("--yes");
  return parseCliResult(await dependencies.runCommand(process.execPath, args, {
    cwd: input.project,
    env: lifecycleEnvironment(input),
    timeoutMs: COMMAND_TIMEOUT_MS,
    pidRoot: input.cache,
  }), command);
}

function nativeSpecs(input: NativeDriverInput, executable: string): readonly NativeSpec[] {
  if (input.host === "codex") {
    const shared = [
      "exec", "--enable", "hooks", "--ephemeral", "--dangerously-bypass-hook-trust",
      "--sandbox", "read-only", "-c", 'approval_policy="never"',
      "--skip-git-repo-check", "--json", "--cd", input.project,
    ];
    return Object.freeze([
      Object.freeze({ executable, args: Object.freeze([
        ...shared,
        `Run one matched read-only search for ${NATIVE_CANARY_TEXT} in ${NATIVE_CANARY_NAME}, then reply only with done.`,
      ]) }),
      Object.freeze({ executable, args: Object.freeze([...shared, MCP_SEQUENCE_PROMPT]) }),
    ]);
  }
  if (input.host === "claude") {
    const hookPrompt = [
      `Use Glob once to locate ${NATIVE_CANARY_NAME}.`,
      `Use Grep once to find ${NATIVE_CANARY_TEXT} in that file.`,
      "Use Bash once only for the fixed read-only command: node --version.",
      "Then reply only with done.",
    ].join(" ");
    const shared = [
      "--mcp-config", path.join(input.project, ".mcp.json"), "--strict-mcp-config",
      "--include-hook-events", "--no-session-persistence", "--output-format", "stream-json", "--verbose",
    ];
    return Object.freeze([
      Object.freeze({ executable, args: Object.freeze([
        "-p", hookPrompt, "--allowedTools", "Grep,Glob,Bash", ...shared,
      ]) }),
      Object.freeze({ executable, args: Object.freeze([
        "-p", MCP_SEQUENCE_PROMPT,
        "--allowedTools", [
          "mcp__kcoderag-qa__list_indexes", "mcp__kcoderag-qa__search_code", "mcp__kcoderag-qa__submit_feedback",
          "mcp__kcoderag_qa__list_indexes", "mcp__kcoderag_qa__search_code", "mcp__kcoderag_qa__submit_feedback",
        ].join(","),
        ...shared,
      ]) }),
    ]);
  }
  if (input.host === "opencode") {
    return Object.freeze([Object.freeze({ executable, args: Object.freeze([
      "run", "--format", "json", "--dir", input.project, "--auto", MCP_SEQUENCE_PROMPT,
    ]) })]);
  }
  if (input.host === "cursor") {
    return Object.freeze([Object.freeze({ executable, args: Object.freeze([
      "--print", "--output-format", "stream-json", MCP_SEQUENCE_PROMPT,
    ]) })]);
  }
  if (path.extname(executable).toLowerCase() !== ".cjs") return Object.freeze([]);
  return Object.freeze([Object.freeze({ executable: process.execPath, args: Object.freeze([
    executable, "--prompt", MCP_SEQUENCE_PROMPT, "--cwd", input.project, "--json", "--max-turns", "8",
    "--allowed-tools", "list_indexes,search_code,submit_feedback",
  ]) })]);
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

type NativeMcpToolName = "list_indexes" | "search_code" | "submit_feedback";

function logicalToolName(value: Record<string, unknown>): NativeMcpToolName | undefined {
  for (const key of ["tool_name", "toolName", "tool", "name"] as const) {
    const item = value[key];
    if (typeof item !== "string") continue;
    const match = /(?:^|__|_)(list_indexes|search_code|submit_feedback)$/u.exec(item);
    const candidate = match?.[1];
    if (candidate === "list_indexes" || candidate === "search_code" || candidate === "submit_feedback") return candidate;
  }
  return undefined;
}

function reliableSuccess(value: Record<string, unknown>): boolean {
  if (value.success === false || value.isError === true || value.is_error === true || value.status === "failed" || value.error !== undefined) return false;
  if (value.success === true || value.isError === false || value.is_error === false || value.status === "completed" || value.status === "success") return true;
  if (isRecord(value.result) && value.result.error === undefined
    && (value.result.isError === false || value.result.success === true)) return true;
  if (isRecord(value.state) && value.state.error === undefined &&
      (value.state.status === "completed" || value.state.status === "success" || value.state.status === "succeeded")) return true;
  return false;
}

function structuredResultEvidence(value: Record<string, unknown>): boolean {
  if (isRecord(value.structuredContent) || isRecord(value.structured_content)) return true;
  if (isRecord(value.result) &&
      (isRecord(value.result.structuredContent) || isRecord(value.result.structured_content))) return true;
  if (!isRecord(value.state) || typeof value.state.output !== "string" ||
      Buffer.byteLength(value.state.output, "utf8") > MAX_NATIVE_OUTPUT_BYTES) return false;
  try {
    const parsed: unknown = JSON.parse(value.state.output);
    return isRecord(parsed) && (isRecord(parsed.structuredContent) || isRecord(parsed.structured_content));
  } catch {
    return false;
  }
}

export function classifyNativeError(value: Record<string, unknown>): NativeErrorKind {
  const material = [value.code, value.kind, value.type, value.status, value.error, value.message]
    .filter((item): item is string => typeof item === "string" && item.length <= 4_096)
    .join(" ");
  if (/(?:auth|login|unauthorized)/iu.test(material)) return "auth";
  if (/(?:timeout|timed_out)/iu.test(material)) return "timeout";
  if (/(?:\benoent\b|no such file or directory)/iu.test(material)) return "path";
  if (/(?:connect|network|econn|enotfound|transport channel closed|http\s+50[234])/iu.test(material)) return "connect";
  if (/(?:permission|forbidden|approval|denied)/iu.test(material)) return "permission";
  if (/(?:handshake|protocol|negotiat)/iu.test(material)) return "protocol";
  if (/(?:tool[ _-]?(?:unavailable|disabled|missing|not[ _-]?found)|unknown[ _-]?tool)/iu.test(material)) {
    return "tool_unavailable";
  }
  if (/\bmcp\b/iu.test(material)) return "mcp";
  if (/(?:init|startup)/iu.test(material)) return "init";
  return "other";
}

function nativeErrorPriority(kind: NativeErrorKind): number {
  if (kind === "none") return 0;
  if (kind === "other") return 1;
  if (kind === "mcp") return 2;
  if (kind === "init") return 3;
  return 4;
}

function preferredNativeError(left: NativeErrorKind, right: NativeErrorKind): NativeErrorKind {
  return nativeErrorPriority(right) > nativeErrorPriority(left) ? right : left;
}

export function parseNativeEvidence(output: string): StructuredEvidence {
  let nativeErrorKind: StructuredEvidence["nativeErrorKind"] = "none";
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
  const claudeToolRequests = new Set<"Grep" | "Glob" | "Bash">();
  const claudeMcpRequests = new Map<string, NativeMcpToolName>();
  const claudePreToolStarts = new Set<string>();
  const claudePreToolResponses = new Set<string>();
  let ordinal = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!isRecord(value)) return;
    ordinal += 1;
    const eventName = [value.hook_event, value.hookEvent, value.hook_event_name, value.hookEventName, value.event, value.type]
      .find((item): item is string => typeof item === "string") ?? "";
    if (nativeErrorKind === "none" && (/error/iu.test(eventName) || value.error !== undefined)) {
      nativeErrorKind = classifyNativeError(value);
    }
    const directToolName = logicalToolName(value);
    if (value.type === "tool_use" && directToolName !== undefined && typeof value.id === "string" && value.id.length <= 4_096) {
      claudeMcpRequests.set(value.id, directToolName);
    }
    let toolName = directToolName;
    let toolSucceeded = directToolName !== undefined && reliableSuccess(value);
    let toolStructuredResult = structuredResultEvidence(value);
    if (isRecord(value.tool_use_result) && isRecord(value.message) && Array.isArray(value.message.content)) {
      const resultBlock = value.message.content.find((item): item is Record<string, unknown> =>
        isRecord(item) && item.type === "tool_result" && typeof item.tool_use_id === "string");
      const requested = resultBlock === undefined ? undefined : claudeMcpRequests.get(resultBlock.tool_use_id as string);
      if (requested !== undefined && resultBlock !== undefined && resultBlock.is_error !== true && resultBlock.isError !== true &&
          value.tool_use_result.error === undefined && value.tool_use_result.isError !== true &&
          value.tool_use_result.is_error !== true) {
        toolName = requested;
        toolSucceeded = true;
        toolStructuredResult = structuredResultEvidence(value.tool_use_result);
      }
    }
    const texts = textFields(value);
    const hasKCodeRagContext = texts.some((item) => /KCodeRag/u.test(item));
    const hasFeedbackContext = texts.some((item) => /submit_feedback/u.test(item));
    if (value.type === "tool_use" && (value.name === "Grep" || value.name === "Glob" || value.name === "Bash")) {
      claudeToolRequests.add(value.name);
    }
    const hookId = typeof value.hook_id === "string" && value.hook_id.length <= 4_096 ? value.hook_id : undefined;
    if (hookId !== undefined && value.subtype === "hook_started" && /PreToolUse/iu.test(eventName)) {
      claudePreToolStarts.add(hookId);
    }
    if (hookId !== undefined && value.subtype === "hook_response" && /PreToolUse/iu.test(eventName) &&
        value.exit_code === 0 && claudePreToolStarts.has(hookId)) {
      claudePreToolResponses.add(hookId);
    }
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
    if (toolName !== undefined && toolSucceeded) {
      if (toolName === "list_indexes") listIndexes = true;
      if (toolName === "search_code") {
        searchCodeCount += 1;
        lastSearchOrdinal = ordinal;
        structuredResult ||= toolStructuredResult;
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
  const claudeHooksComplete = claudeToolRequests.size > 0 &&
    claudePreToolResponses.size >= claudeToolRequests.size;
  grepHook ||= claudeHooksComplete && claudeToolRequests.has("Grep");
  globHook ||= claudeHooksComplete && claudeToolRequests.has("Glob");
  bashHook ||= claudeHooksComplete && claudeToolRequests.has("Bash");
  return Object.freeze({
    nativeErrorKind,
    sessionStart, hookOutput, grepHook, globHook, bashHook, listIndexes, searchCodeCount, structuredResult,
    feedbackReminder, submitFeedback,
    feedbackSuppressed: submitFeedback && lastSearchOrdinal > lastSubmitOrdinal && !reminderAfterSubmit,
    cursorReload, cursorRule, cursorSkill, cursorAfterMcp, pluginLoaded, pluginCallback, workspaceSkill,
    zcodePre, zcodePost,
  });
}

function mergeNativeEvidence(left: StructuredEvidence, right: StructuredEvidence): StructuredEvidence {
  return Object.freeze({
    nativeErrorKind: preferredNativeError(left.nativeErrorKind, right.nativeErrorKind),
    sessionStart: left.sessionStart || right.sessionStart,
    hookOutput: left.hookOutput || right.hookOutput,
    grepHook: left.grepHook || right.grepHook,
    globHook: left.globHook || right.globHook,
    bashHook: left.bashHook || right.bashHook,
    listIndexes: left.listIndexes || right.listIndexes,
    searchCodeCount: left.searchCodeCount + right.searchCodeCount,
    structuredResult: left.structuredResult || right.structuredResult,
    feedbackReminder: left.feedbackReminder || right.feedbackReminder,
    submitFeedback: left.submitFeedback || right.submitFeedback,
    feedbackSuppressed: left.feedbackSuppressed || right.feedbackSuppressed,
    cursorReload: left.cursorReload || right.cursorReload,
    cursorRule: left.cursorRule || right.cursorRule,
    cursorSkill: left.cursorSkill || right.cursorSkill,
    cursorAfterMcp: left.cursorAfterMcp || right.cursorAfterMcp,
    pluginLoaded: left.pluginLoaded || right.pluginLoaded,
    pluginCallback: left.pluginCallback || right.pluginCallback,
    workspaceSkill: left.workspaceSkill || right.workspaceSkill,
    zcodePre: left.zcodePre || right.zcodePre,
    zcodePost: left.zcodePost || right.zcodePost,
  });
}

function nativeCacheRoots(input: NativeDriverInput): readonly string[] {
  return Object.freeze([
    path.join(input.cache, "local-app-data", "kcoderag-nav"),
    path.join(input.cache, "xdg-cache", "kcoderag-nav"),
    path.join(input.cache, "kcoderag-nav"),
  ]);
}

function readClosedMarkerRecords(input: NativeDriverInput, directory: "mcp-calls" | "nudges"): readonly Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const cacheRoot of nativeCacheRoots(input)) {
    const markerRoot = path.join(cacheRoot, directory);
    try {
      for (const name of fs.readdirSync(markerRoot).slice(0, 256)) {
        if (directory === "mcp-calls" ? !/^[a-f0-9]{64}\.json$/u.test(name) : !/^[a-f0-9]{64}\.claim$/u.test(name)) continue;
        const markerPath = path.join(markerRoot, name);
        const metadata = fs.lstatSync(markerPath);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > 512) continue;
        const value: unknown = JSON.parse(fs.readFileSync(markerPath, "utf8"));
        const supportedSchema = directory === "mcp-calls"
          ? value !== null && isRecord(value) &&
            (value.schemaVersion === 1 || value.schemaVersion === 2 || value.schemaVersion === 3)
          : value !== null && isRecord(value) && value.schemaVersion === 1;
        if (supportedSchema && isRecord(value) && value.host === input.host) records.push(value);
      }
    } catch { /* Missing or malformed marker stores provide no evidence. */ }
  }
  return Object.freeze(records);
}

function withNativeMarkers(input: NativeDriverInput, evidence: StructuredEvidence): StructuredEvidence {
  const nudgeRecords = readClosedMarkerRecords(input, "nudges");
  const mcpRecords = readClosedMarkerRecords(input, "mcp-calls");
  const kinds = nudgeRecords
    .map((record) => record.reminderKind)
    .filter((kind): kind is string => typeof kind === "string");
  const navigation = kinds.includes("navigation");
  const feedbackReminder = kinds.includes("feedback-reminded");
  const feedbackSubmitted = kinds.includes("feedback-submitted");
  const mcpCallback = mcpRecords.length > 0;
  const markerTools = mcpRecords
    .filter((record) => record.schemaVersion === 2 || record.schemaVersion === 3)
    .map((record) => record.toolName)
    .filter((toolName): toolName is string => ["list_indexes", "search_code", "submit_feedback"].includes(toolName as string));
  return Object.freeze({
    ...evidence,
    sessionStart: evidence.sessionStart || navigation,
    hookOutput: evidence.hookOutput || navigation,
    feedbackReminder: evidence.feedbackReminder || feedbackReminder,
    feedbackSuppressed: evidence.feedbackSuppressed || (feedbackSubmitted && feedbackReminder),
    cursorAfterMcp: evidence.cursorAfterMcp || (input.host === "cursor" && mcpCallback),
    pluginLoaded: evidence.pluginLoaded || (input.host === "opencode" && mcpCallback),
    pluginCallback: evidence.pluginCallback || (input.host === "opencode" && mcpCallback),
    zcodePost: evidence.zcodePost || (input.host === "zcode" && mcpCallback),
    listIndexes: evidence.listIndexes || markerTools.includes("list_indexes"),
    searchCodeCount: Math.max(evidence.searchCodeCount, markerTools.filter((toolName) => toolName === "search_code").length),
    structuredResult: evidence.structuredResult || mcpRecords.some((record) =>
      record.schemaVersion === 3 && record.toolName === "search_code" && record.structuredResultValid === true),
    submitFeedback: evidence.submitFeedback || feedbackSubmitted || markerTools.includes("submit_feedback"),
  });
}

function markerRecorded(input: NativeDriverInput): boolean {
  return readClosedMarkerRecords(input, "mcp-calls").length > 0;
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

function hostObservations(
  host: HostId,
  native: StructuredEvidence,
  nativeRan: boolean,
  mcpRegistered: boolean,
): Readonly<Record<string, boolean>> {
  if (host === "codex") return Object.freeze({
    directMcpRegistrationObserved: mcpRegistered,
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

async function nativeMcpRegistered(
  input: NativeDriverInput,
  executable: string,
  native: StructuredEvidence,
  dependencies: NativeDriverDependencies,
): Promise<boolean> {
  if (markerRecorded(input) || native.listIndexes || native.searchCodeCount > 0 || native.submitFeedback) return true;
  if (input.host !== "codex") return false;
  const result = await dependencies.runCommand(executable, ["mcp", "list", "--json"], {
    cwd: input.project,
    env: isolatedEnvironment(input),
    timeoutMs: 30_000,
    pidRoot: input.cache,
  });
  if (result.code !== 0 || Buffer.byteLength(result.stdout, "utf8") > MAX_NATIVE_OUTPUT_BYTES) return false;
  try {
    const value: unknown = JSON.parse(result.stdout);
    return Array.isArray(value) && value.some((item) => isRecord(item) &&
      (item.name === "kcoderag-qa" || item.id === "kcoderag-qa") && item.enabled === true);
  } catch {
    return false;
  }
}

function failureFromObservations(observations: AcceptanceObservations, native: StructuredEvidence): {
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
  const nativeMcpReason: Readonly<Partial<Record<StructuredEvidence["nativeErrorKind"], FailureReasonCode>>> = {
    auth: "mcp_auth_failed",
    permission: "mcp_permission_denied",
    timeout: "mcp_timeout",
    connect: "mcp_connection_failed",
    protocol: "mcp_protocol_failed",
    tool_unavailable: "mcp_tool_unavailable",
    init: "mcp_initialization_failed",
    mcp: "mcp_native_failed",
  };
  for (const [key, stage, reasonCode] of ordered) {
    if (common[key]) continue;
    const classified = stage === "mcp" ? nativeMcpReason[native.nativeErrorKind] : undefined;
    return { stage, reasonCode: classified ?? reasonCode };
  }
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
  let native = parseNativeEvidence("");
  let mcpRegistered = false;
  let installed = false;
  let executable: string | undefined;
  let lifecycleFailure: FailureReasonCode | undefined;
  const finalize = async (nativeRan: boolean): Promise<Readonly<Record<string, unknown>>> => {
    if (installed) {
      try {
        const removed = await lifecycle(input as NativeDriverInput, "uninstall", dependencies);
        common.uninstallRestored = removed.value?.ok === true;
        if (!common.uninstallRestored) lifecycleFailure ??= removed.reasonCode ?? "uninstall_failed";
      } catch {
        common.uninstallRestored = false;
        lifecycleFailure ??= "uninstall_failed";
      }
      installed = false;
    }
    return outcome((input as NativeDriverInput).host, common, native, nativeRan, mcpRegistered, false, lifecycleFailure);
  };
  try {
    fs.mkdirSync(input.project, { recursive: true });
    fs.mkdirSync(input.cache, { recursive: true });
    fs.mkdirSync(input.npmCache, { recursive: true });
    const canaryPath = path.join(input.project, NATIVE_CANARY_NAME);
    if (fs.existsSync(canaryPath)) return failureOutcome("evidence_integrity", "lane_workspace_conflict", input.host);
    try {
      fs.writeFileSync(canaryPath, `${NATIVE_CANARY_TEXT}\n`, { flag: "wx", mode: 0o600 });
    } catch {
      return failureOutcome("evidence_integrity", "lane_workspace_unavailable", input.host);
    }
    if (!safeRegularFile(input.package)) return failureOutcome("package", "package_acquisition_failed", input.host);
    executable = discoverHostExecutable(input.host, process.env, dependencies.resolveCommand, dependencies.pathExists ?? safeRegularFile);
    if (executable === undefined) return failureOutcome("native_event", "native_event_failed", input.host);
    const install = await lifecycle(input, "install", dependencies);
    installed = install.value?.ok === true;
    common.packageInstalled = installed;
    if (!installed) {
      lifecycleFailure = install.reasonCode ?? "install_failed";
      return await finalize(false);
    }
    const status = await lifecycle(input, "status", dependencies);
    common.statusHealthy = status.value?.ok === true && status.value.status === "healthy";
    if (!common.statusHealthy) lifecycleFailure ??= status.reasonCode ?? "status_unhealthy";
    const firstUpdate = await lifecycle(input, "update", dependencies);
    const secondUpdate = await lifecycle(input, "update", dependencies);
    common.updateIdempotent = firstUpdate.value?.ok === true && secondUpdate.value?.ok === true;
    if (!common.updateIdempotent) lifecycleFailure ??= firstUpdate.reasonCode ?? secondUpdate.reasonCode ?? "update_failed";

    projectLiveCredential(input.host, input.cache);
    if (input.host === "codex" && !projectCodexLiveConfig(input.project, input.cache)) {
      return await finalize(false);
    }
    const specs = nativeSpecs(input, executable);
    let nativeRan = specs.length > 0;
    for (const spec of specs) {
      const result = await dependencies.runCommand(spec.executable, spec.args, {
        cwd: input.project,
        env: isolatedEnvironment(input),
        timeoutMs: COMMAND_TIMEOUT_MS,
        pidRoot: input.cache,
      });
      nativeRan &&= result.code === 0;
      const parsed = parseNativeEvidence(result.stdout);
      native = mergeNativeEvidence(native, result.nativeErrorKind === undefined
        ? parsed
        : Object.freeze({
            ...parsed,
            nativeErrorKind: preferredNativeError(parsed.nativeErrorKind, result.nativeErrorKind),
          }));
    }
    native = withNativeMarkers(input, native);
    common.nativeHostProcess = nativeRan;
    common.sessionBaselineObserved = input.host === "cursor"
      ? native.cursorRule && native.cursorSkill
      : input.host === "opencode"
        ? native.pluginLoaded
        : native.sessionStart;
    mcpRegistered = await nativeMcpRegistered(input, executable, native, dependencies);
    common.mcpRegistered = mcpRegistered;
    common.listIndexesSucceeded = native.listIndexes;
    common.searchCodeSucceeded = native.searchCodeCount > 0;
    common.structuredResultValid = native.structuredResult;
    common.feedbackReminderObserved = native.feedbackReminder;
    common.submitFeedbackSucceeded = native.submitFeedback;
    common.feedbackSuppressed = native.feedbackSuppressed && native.searchCodeCount >= 2;
    common.malformedFailOpen = await malformedFailOpen(input, dependencies);
    common.successMarkerRecorded = markerRecorded(input);
    return await finalize(nativeRan);
  } catch {
    return await finalize(false);
  } finally {
    if (installed) {
      try {
        const removed = await lifecycle(input, "uninstall", dependencies);
        common.uninstallRestored = removed.value?.ok === true;
        if (!common.uninstallRestored) lifecycleFailure ??= removed.reasonCode ?? "uninstall_failed";
      } catch {
        common.uninstallRestored = false;
        lifecycleFailure ??= "uninstall_failed";
      }
    }
  }
}

function outcome(
  host: HostId,
  common: Record<CommonObservationKey, boolean>,
  native: StructuredEvidence,
  nativeRan: boolean,
  mcpRegistered: boolean,
  processTreeCleaned: boolean,
  lifecycleFailure?: FailureReasonCode,
): Readonly<Record<string, unknown>> {
  common.processTreeCleaned = processTreeCleaned;
  const observations: AcceptanceObservations = Object.freeze({
    common: Object.freeze(Object.fromEntries(COMMON_OBSERVATION_KEYS.map((key) => [key, common[key] === true]))) as AcceptanceObservations["common"],
    host: Object.freeze(Object.fromEntries(HOST_OBSERVATION_KEYS[host].map((key) => [key,
      hostObservations(host, native, nativeRan, mcpRegistered)[key] === true]))),
  });
  const failure = lifecycleFailure === undefined
    ? failureFromObservations(observations, native)
    : { stage: "install" as const, reasonCode: lifecycleFailure };
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

interface OwnedProcess {
  readonly pid: number;
  readonly startedAt: number;
}

function validOwnedProcess(value: unknown): value is OwnedProcess {
  return isRecord(value) && Object.keys(value).sort().join("\0") === "pid\0startedAt" &&
    Number.isSafeInteger(value.pid) && (value.pid as number) > 0 &&
    typeof value.startedAt === "number" && Number.isSafeInteger(value.startedAt) && value.startedAt > 0;
}

function ownedProcesses(cacheRoot: string): readonly OwnedProcess[] {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(pidFile(cacheRoot), "utf8"));
    if (!Array.isArray(value) || value.length > 256 || !value.every(validOwnedProcess)) return Object.freeze([]);
    return Object.freeze(value);
  } catch {
    return Object.freeze([]);
  }
}

function writeOwnedProcesses(cacheRoot: string, records: readonly OwnedProcess[]): void {
  fs.mkdirSync(cacheRoot, { recursive: true });
  const temporary = `${pidFile(cacheRoot)}.${process.pid}.tmp`;
  try { fs.rmSync(temporary, { force: true }); } catch { /* stale same-process temporary */ }
  fs.writeFileSync(temporary, `${JSON.stringify(records)}\n`, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, pidFile(cacheRoot));
}

function appendOwnedProcess(cacheRoot: string, record: OwnedProcess): void {
  const current = ownedProcesses(cacheRoot).filter((item) => item.pid !== record.pid);
  writeOwnedProcesses(cacheRoot, [...current, record]);
}

function removeOwnedProcess(cacheRoot: string, record: OwnedProcess): void {
  const current = ownedProcesses(cacheRoot);
  const remaining = current.filter((item) => item.pid !== record.pid || item.startedAt !== record.startedAt);
  if (remaining.length === current.length) return;
  if (remaining.length === 0) {
    fs.rmSync(pidFile(cacheRoot), { force: true });
    return;
  }
  writeOwnedProcesses(cacheRoot, remaining);
}

function terminateProcessTree(pid: number): void {
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

function processStartTime(pid: number): number | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const script = `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue;if($null-ne$p){[Console]::Out.Write(([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds())}`;
    const result = childProcess.spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      maxBuffer: 8_192,
    });
    if (result.status !== 0 || typeof result.stdout !== "string" || !/^[0-9]{10,16}$/u.test(result.stdout.trim())) return undefined;
    const value = Number(result.stdout.trim());
    return Number.isSafeInteger(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function terminateStillOwned(record: OwnedProcess): void {
  const observed = processStartTime(record.pid);
  if (observed !== undefined && Math.abs(observed - record.startedAt) <= 10_000) terminateProcessTree(record.pid);
}

export async function cleanupNativeHost(rawInput: Readonly<Record<string, string>>): Promise<Readonly<{ cleaned: true }>> {
  const input = safeInput(rawInput);
  if (input === undefined) throw new Error("arguments_invalid");
  for (const record of ownedProcesses(input.cache)) terminateStillOwned(record);
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
    let stderrBytes = 0;
    let authMissing = false;
    let nativeErrorKind: NativeErrorKind = "none";
    let forcedFailure = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let owned: OwnedProcess | undefined;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (pidRoot !== undefined && owned !== undefined) {
        try { removeOwnedProcess(pidRoot, owned); } catch { forcedFailure = true; }
      }
      resolve(Object.freeze({
        code: forcedFailure ? 1 : code,
        stdout: forcedFailure ? "" : stdout,
        ...(authMissing ? { authMissing: true } : {}),
        ...(nativeErrorKind === "none" ? {} : { nativeErrorKind }),
      }));
    };
    const startedAt = Date.now();
    const child = childProcess.spawn(selectedExecutable, selectedArgs, {
      cwd,
      env,
      windowsHide: true,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (pidRoot !== undefined && child.pid !== undefined) {
      owned = Object.freeze({ pid: child.pid, startedAt });
      try { appendOwnedProcess(pidRoot, owned); } catch { forcedFailure = true; }
    }
    const stdoutPipe = child.stdout;
    if (stdoutPipe === null) return finish(1);
    stdoutPipe.setEncoding("utf8");
    stdoutPipe.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes <= MAX_NATIVE_OUTPUT_BYTES) stdout += chunk;
      else {
        forcedFailure = true;
        terminateProcessTree(child.pid ?? -1);
      }
    });
    const stderrPipe = child.stderr;
    if (stderrPipe !== null) {
      stderrPipe.setEncoding("utf8");
      stderrPipe.on("data", (chunk: string) => {
        stderrBytes += Buffer.byteLength(chunk, "utf8");
        if (stderrBytes > MAX_NATIVE_OUTPUT_BYTES) {
          forcedFailure = true;
          terminateProcessTree(child.pid ?? -1);
          return;
        }
        if (/(?:auth|login)/iu.test(chunk)) authMissing = true;
        nativeErrorKind = preferredNativeError(nativeErrorKind, classifyNativeError({ message: chunk }));
      });
    }
    if (input !== undefined) child.stdin?.end(input);
    child.on("error", () => {
      nativeErrorKind = preferredNativeError(nativeErrorKind, "connect");
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
    timer = setTimeout(() => {
      forcedFailure = true;
      nativeErrorKind = preferredNativeError(nativeErrorKind, "timeout");
      terminateProcessTree(child.pid ?? -1);
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
exports.classifyNativeError = classifyNativeError;
exports.discoverHostExecutable = discoverHostExecutable;
exports.defaultRunCommand = defaultRunCommand;
exports.processStartTime = processStartTime;
exports.probeNativeHost = probeNativeHost;
exports.runNativeHost = runNativeHost;
exports.cleanupNativeHost = cleanupNativeHost;
exports.main = main;

if (require.main === module) {
  void main().then((code) => { process.exitCode = code; });
}
