#!/usr/bin/env node
/** Real-host native pre-write delivery capture with metadata-only receipts. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

import type { HostId } from "../core/contracts.cjs";

type StableSessionField = "session_id" | "thread_id" | "conversation_id";
type HostDeliveryVerdict = "PASS" | "FAIL" | "UNSUPPORTED";

export interface HostDeliveryObservations {
  readonly nativeInstall: boolean;
  readonly cppCreated: boolean;
  readonly cppModified: boolean;
  readonly luaWritten: boolean;
  readonly structuredTargets: boolean;
  readonly stableSessionRepeated: boolean;
  readonly sentinelVisible: boolean;
  readonly sentinelOnce: boolean;
  readonly validWriteCompleted: boolean;
  readonly emptyWriteCompleted: boolean;
  readonly malformedWriteCompleted: boolean;
  readonly nonzeroWriteCompleted: boolean;
  readonly timeoutWriteCompleted: boolean;
}

export interface HostDeliveryReceipt {
  readonly schemaVersion: 1;
  readonly host: HostId;
  readonly version: string;
  readonly stableSessionField: StableSessionField | null;
  readonly observations: HostDeliveryObservations;
  readonly fixtureDigest: string;
  readonly provenanceDigest: string;
  readonly capturedAt: string;
  readonly verdict: HostDeliveryVerdict;
  readonly reason: HostDeliveryReason;
}

type HostDeliveryReason =
  | "verified"
  | "version_mismatch"
  | "native_install_failed"
  | "native_session_failed"
  | "observation_incomplete"
  | "native_context_unproved"
  | "headless_host_unsupported";

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly timedOut: boolean;
}

interface CaptureOptions {
  readonly host: HostId;
  readonly expectedVersion: string;
  readonly projectPath: string;
  readonly receiptPath: string;
  readonly requirePass: boolean;
}

interface ParsedArguments {
  readonly mode: "capture" | "verify";
  readonly receiptPath: string;
  readonly requirePass: boolean;
  readonly host?: HostId;
  readonly expectedVersion?: string;
  readonly projectPath?: string;
}

interface StreamObservations {
  readonly stableSessionField: StableSessionField | null;
  readonly targetCounts: ReadonlyMap<string, number>;
  readonly sentinelContexts: number;
  readonly sentinelAssistantTexts: number;
  readonly completionVisible: boolean;
}

export const OBSERVATION_KEYS: readonly (keyof HostDeliveryObservations)[] = Object.freeze([
  "nativeInstall",
  "cppCreated",
  "cppModified",
  "luaWritten",
  "structuredTargets",
  "stableSessionRepeated",
  "sentinelVisible",
  "sentinelOnce",
  "validWriteCompleted",
  "emptyWriteCompleted",
  "malformedWriteCompleted",
  "nonzeroWriteCompleted",
  "timeoutWriteCompleted",
]);

const HOSTS: readonly HostId[] = Object.freeze(["codex", "claude", "cursor", "opencode"] as const);
const STABLE_SESSION_FIELDS: readonly StableSessionField[] = Object.freeze([
  "session_id", "thread_id", "conversation_id",
]);
const RECEIPT_KEYS = Object.freeze([
  "capturedAt",
  "fixtureDigest",
  "host",
  "observations",
  "provenanceDigest",
  "reason",
  "schemaVersion",
  "stableSessionField",
  "verdict",
  "version",
]);
const EXACT_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAX_RECEIPT_BYTES = 16 * 1024;
const MAX_COMMAND_BYTES = 8 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;
const CLAUDE_SESSION_TIMEOUT_MS = 180_000;
const KSCC_EXPECTED_VERSION = "1.2.1";
const SENTINEL = "KCODERAG_FIXTURE_CONTEXT_7F6D981B9D3C4A22";
const COMPLETION_SENTINEL = "KCODERAG_FIXTURE_WRITES_COMPLETE_4C7E2A10";
const MAIN_CPP = "fixture-main.cpp";
const LUA_FILE = "fixture-later.lua";
const MALFORMED_CPP = "fixture-malformed.cpp";
const NONZERO_CPP = "fixture-nonzero.cpp";
const TIMEOUT_CPP = "fixture-timeout.cpp";
const PROBE_RELATIVE_PATH = ".claude/kcoderag-nav/fixture-host-delivery.cjs";

const PROBE_SOURCE = String.raw`"use strict";
const fs = require("node:fs");
const path = require("node:path");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath = event && event.tool_input && typeof event.tool_input.file_path === "string"
      ? event.tool_input.file_path
      : "";
    const name = path.basename(filePath).toLowerCase();
    if (name === "fixture-main.cpp") {
      try {
        const marker = path.resolve(process.cwd(), ".claude", "kcoderag-nav", "fixture-host-delivery.once");
        const descriptor = fs.openSync(marker, "wx", 0o600);
        fs.closeSync(descriptor);
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext: "KCODERAG_FIXTURE_CONTEXT_7F6D981B9D3C4A22",
          },
        }));
      } catch (error) {
        if (!error || error.code !== "EEXIST") throw error;
      }
      return;
    }
    if (name === "fixture-malformed.cpp") {
      process.stdout.write("{");
      return;
    }
    if (name === "fixture-nonzero.cpp") {
      process.exitCode = 1;
      return;
    }
    if (name === "fixture-timeout.cpp") {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    }
  } catch {
    process.exitCode = 0;
  }
});
`;

const CLAUDE_PROMPT = [
  "Run this closed native-hook fixture exactly as written.",
  "Use only the Write and Edit tools. Do not use Bash, Read, search, or subprocess tools.",
  `1. Write ${MAIN_CPP} with exactly: int FixtureValue() { return 1; }`,
  "After that Write, if model context supplies a line beginning KCODERAG_FIXTURE_CONTEXT_, repeat the entire exact line in your next assistant text. The full value is not present in this prompt; do not guess it.",
  `2. Edit ${MAIN_CPP}, changing return 1 to return 2.`,
  `3. Write ${LUA_FILE} with exactly: return 2`,
  `4. Write ${MALFORMED_CPP} with exactly: int MalformedCase = 1;`,
  `5. Write ${NONZERO_CPP} with exactly: int NonzeroCase = 1;`,
  `6. Write ${TIMEOUT_CPP} with exactly: int TimeoutCase = 1;`,
  "A hook warning, malformed hook response, nonzero hook exit, or hook timeout is expected fixture behavior; continue to the next write.",
  `After all six actions complete, write exactly ${COMPLETION_SENTINEL} in assistant text.`,
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function safeReason(value: unknown): value is HostDeliveryReason {
  return [
    "verified",
    "version_mismatch",
    "native_install_failed",
    "native_session_failed",
    "observation_incomplete",
    "native_context_unproved",
    "headless_host_unsupported",
  ].includes(value as HostDeliveryReason);
}

function parseObservations(value: unknown): HostDeliveryObservations {
  if (!isRecord(value) || !exactKeys(value, [...OBSERVATION_KEYS].sort()) ||
      OBSERVATION_KEYS.some((key) => typeof value[key] !== "boolean")) {
    throw new Error("invalid_receipt");
  }
  return Object.freeze(Object.fromEntries(
    OBSERVATION_KEYS.map((key) => [key, value[key] === true]),
  ) as unknown as HostDeliveryObservations);
}

export function parseHostDeliveryReceipt(value: unknown): HostDeliveryReceipt {
  if (!isRecord(value) || !exactKeys(value, RECEIPT_KEYS) || value.schemaVersion !== 1 ||
      !HOSTS.includes(value.host as HostId) || typeof value.version !== "string" ||
      !EXACT_VERSION.test(value.version) ||
      (value.stableSessionField !== null &&
        !STABLE_SESSION_FIELDS.includes(value.stableSessionField as StableSessionField)) ||
      typeof value.fixtureDigest !== "string" || !DIGEST.test(value.fixtureDigest) ||
      typeof value.provenanceDigest !== "string" || !DIGEST.test(value.provenanceDigest) ||
      !isCanonicalTimestamp(value.capturedAt) ||
      !["PASS", "FAIL", "UNSUPPORTED"].includes(value.verdict as HostDeliveryVerdict) ||
      !safeReason(value.reason)) {
    throw new Error("invalid_receipt");
  }
  const observations = parseObservations(value.observations);
  if (value.verdict === "PASS" && (
    value.reason !== "verified" || value.stableSessionField === null ||
    OBSERVATION_KEYS.some((key) => !observations[key])
  )) {
    throw new Error("invalid_receipt");
  }
  if (value.verdict !== "PASS" && value.reason === "verified") throw new Error("invalid_receipt");
  return Object.freeze({
    schemaVersion: 1,
    host: value.host as HostId,
    version: value.version,
    stableSessionField: value.stableSessionField as StableSessionField | null,
    observations,
    fixtureDigest: value.fixtureDigest,
    provenanceDigest: value.provenanceDigest,
    capturedAt: value.capturedAt,
    verdict: value.verdict as HostDeliveryVerdict,
    reason: value.reason,
  });
}

export function receiptDigest(value: unknown): string {
  return sha256(canonicalJson(parseHostDeliveryReceipt(value)));
}

export function verifyReceiptFile(receiptPath: string, requirePass = false): HostDeliveryReceipt {
  try {
    const metadata = fs.lstatSync(receiptPath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_RECEIPT_BYTES) {
      throw new Error("invalid_receipt");
    }
    const receipt = parseHostDeliveryReceipt(JSON.parse(fs.readFileSync(receiptPath, "utf8")));
    if (requirePass && receipt.verdict !== "PASS") throw new Error("receipt_not_pass");
    return receipt;
  } catch (error) {
    if (error instanceof Error && (error.message === "invalid_receipt" || error.message === "receipt_not_pass")) {
      throw error;
    }
    throw new Error("invalid_receipt");
  }
}

function runProcess(
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
    readonly commandShim?: boolean;
  },
): CommandResult {
  const useCommandShim = options.commandShim === true && process.platform === "win32";
  const selectedExecutable = useCommandShim ? (process.env.ComSpec ?? "cmd.exe") : executable;
  const selectedArgs = useCommandShim ? ["/d", "/s", "/c", executable, ...args] : [...args];
  const result = childProcess.spawnSync(selectedExecutable, selectedArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_BYTES,
    windowsHide: true,
    shell: false,
  });
  const stdout = typeof result.stdout === "string" && Buffer.byteLength(result.stdout, "utf8") <= MAX_COMMAND_BYTES
    ? result.stdout
    : "";
  return Object.freeze({
    code: result.status ?? 1,
    stdout,
    timedOut: (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ||
      result.signal === "SIGTERM",
  });
}

function isolatedInstallEnvironment(runtimeRoot: string): NodeJS.ProcessEnv {
  const profileRoot = path.join(runtimeRoot, "profile");
  const claudeRoot = path.join(profileRoot, ".claude");
  const npmCache = path.join(runtimeRoot, "npm-cache");
  fs.mkdirSync(claudeRoot, { recursive: true });
  fs.mkdirSync(npmCache, { recursive: true });
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(?:npm_config_.*|node_auth_token|npm_token|node_options)$/iu.test(key)));
  return {
    ...environment,
    CLAUDE_CONFIG_DIR: claudeRoot,
    KCODERAG_NAV_UPDATE_CHECK: "0",
    NO_COLOR: "1",
    npm_config_audit: "false",
    npm_config_cache: npmCache,
    npm_config_fund: "false",
    npm_config_loglevel: "silent",
    ...(process.platform === "win32" ? { USERPROFILE: profileRoot } : { HOME: profileRoot }),
  };
}

function realClaudeEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KCODERAG_NAV_UPDATE_CHECK: "0",
    NO_COLOR: "1",
  };
}

function parsePackFilename(stdout: string, packRoot: string): string {
  try {
    const value: unknown = JSON.parse(stdout);
    if (!Array.isArray(value) || !isRecord(value[0]) || typeof value[0].filename !== "string" ||
        path.basename(value[0].filename) !== value[0].filename || !value[0].filename.endsWith(".tgz")) {
      throw new Error("pack_failed");
    }
    const result = path.resolve(packRoot, value[0].filename);
    const metadata = fs.lstatSync(result);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("pack_failed");
    return result;
  } catch {
    throw new Error("pack_failed");
  }
}

function packRepository(repositoryRoot: string, runtimeRoot: string): string {
  const packRoot = path.join(runtimeRoot, "pack");
  fs.mkdirSync(packRoot, { recursive: true });
  const result = runProcess("npm", [
    "pack", repositoryRoot, "--json", "--ignore-scripts", "--pack-destination", packRoot,
  ], { cwd: repositoryRoot, timeoutMs: COMMAND_TIMEOUT_MS, commandShim: true });
  if (result.code !== 0 || result.timedOut) throw new Error("pack_failed");
  return parsePackFilename(result.stdout, packRoot);
}

function installPackedCli(
  tarballPath: string,
  projectPath: string,
  runtimeRoot: string,
  repositoryRoot: string,
): true {
  const result = runProcess("npx", [
    "--yes",
    "--ignore-scripts",
    `--package=${tarballPath}`,
    "--",
    "kcoderag-nav",
    "install",
    "--host",
    "claude",
    "--target",
    projectPath,
    "--yes",
    "--json",
  ], {
    cwd: repositoryRoot,
    env: isolatedInstallEnvironment(runtimeRoot),
    timeoutMs: COMMAND_TIMEOUT_MS,
    commandShim: true,
  });
  const installed = result.code === 0 && !result.timedOut &&
    fs.existsSync(path.join(projectPath, ".claude", "kcoderag-nav", "install-state.json"));
  if (!installed) {
    try {
      const payload: unknown = JSON.parse(result.stdout);
      const code = isRecord(payload) && typeof payload.code === "string" && /^[a-z0-9_]{1,80}$/u.test(payload.code)
        ? payload.code
        : "native_install_failed";
      throw new Error(code);
    } catch (error) {
      if (error instanceof Error && /^[a-z0-9_]{1,80}$/u.test(error.message)) throw error;
      throw new Error("native_install_failed");
    }
  }
  return true;
}

function fixtureHookEntry(): Record<string, unknown> {
  return {
    matcher: "^(Write|Edit)$",
    hooks: [{
      type: "command",
      command: `node \"${PROBE_RELATIVE_PATH}\"`,
      commandWindows: `node \"${PROBE_RELATIVE_PATH.replaceAll("/", "\\\\")}\"`,
      timeout: 1,
      statusMessage: "Checking native delivery fixture",
      additionalContextLimit: 256,
    }],
  };
}

function installFixtureProbe(projectPath: string): void {
  const probePath = path.join(projectPath, ...PROBE_RELATIVE_PATH.split("/"));
  const settingsPath = path.join(projectPath, ".claude", "settings.json");
  const settings: unknown = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  if (!isRecord(settings)) throw new Error("fixture_install_failed");
  if (settings.hooks === undefined) settings.hooks = {};
  if (!isRecord(settings.hooks)) throw new Error("fixture_install_failed");
  const preToolUse = settings.hooks.PreToolUse;
  if (!Array.isArray(preToolUse)) throw new Error("fixture_install_failed");
  fs.mkdirSync(path.dirname(probePath), { recursive: true });
  fs.writeFileSync(probePath, PROBE_SOURCE, { encoding: "utf8", mode: 0o600, flag: "wx" });
  settings.hooks.PreToolUse = [fixtureHookEntry(), ...preToolUse];
  fs.writeFileSync(settingsPath, canonicalJson(settings), { flag: "w" });
}

function strictClaudeVersion(cwd: string): string | undefined {
  const result = runProcess("claude", ["--version"], {
    cwd,
    timeoutMs: 5_000,
    commandShim: true,
  });
  if (result.code !== 0 || result.timedOut || Buffer.byteLength(result.stdout, "utf8") > 1024) return undefined;
  return /^(\d+\.\d+\.\d+) \(Claude Code\)\s*$/u.exec(result.stdout)?.[1];
}

function windowsPathCommand(command: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  const pathValue = process.env.Path ?? process.env.PATH;
  if (typeof pathValue !== "string") return undefined;
  for (const directory of pathValue.split(path.delimiter)) {
    if (directory.length === 0) continue;
    for (const extension of [".ps1", ".exe"] as const) {
      const candidate = path.resolve(directory, `${command}${extension}`);
      try {
        const metadata = fs.lstatSync(candidate);
        if (!metadata.isSymbolicLink() && metadata.isFile()) return candidate;
      } catch {
        // Continue through the fixed extension/path search.
      }
    }
  }
  return undefined;
}

function runKscc(args: readonly string[], cwd: string, timeoutMs: number): CommandResult {
  if (process.platform === "win32") {
    const scriptPath = windowsPathCommand("kscc");
    if (scriptPath === undefined || path.extname(scriptPath).toLowerCase() !== ".ps1") {
      return Object.freeze({ code: 1, stdout: "", timedOut: false });
    }
    return runProcess("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...args,
    ], { cwd, env: realClaudeEnvironment(), timeoutMs });
  }
  return runProcess("kscc", args, {
    cwd,
    env: realClaudeEnvironment(),
    timeoutMs,
  });
}

function strictKsccVersion(cwd: string): string | undefined {
  const result = runKscc(["--version"], cwd, 5_000);
  if (result.code !== 0 || result.timedOut || Buffer.byteLength(result.stdout, "utf8") > 1024) return undefined;
  return /^(\d+\.\d+\.\d+)\s*$/u.exec(result.stdout)?.[1];
}

function expectedTarget(input: unknown): string | undefined {
  if (!isRecord(input) || typeof input.file_path !== "string" || input.file_path.length > 32 * 1024) return undefined;
  return path.basename(input.file_path).toLowerCase();
}

function observeClaudeStream(stdout: string): StreamObservations {
  const stableValues = new Map<StableSessionField, Map<string, number>>();
  for (const field of STABLE_SESSION_FIELDS) stableValues.set(field, new Map());
  const targetCounts = new Map<string, number>();
  let sentinelContexts = 0;
  let sentinelAssistantTexts = 0;
  let completionVisible = false;

  const visit = (value: unknown, assistantContext: boolean): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, assistantContext);
      return;
    }
    if (!isRecord(value)) return;
    const nextAssistantContext = assistantContext || value.type === "assistant";
    for (const field of STABLE_SESSION_FIELDS) {
      const candidate = value[field];
      if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 4096) {
        const counts = stableValues.get(field) as Map<string, number>;
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      }
    }
    const toolName = typeof value.name === "string"
      ? value.name
      : typeof value.tool_name === "string"
        ? value.tool_name
        : undefined;
    if (toolName === "Write" || toolName === "Edit") {
      const target = expectedTarget(value.input) ?? expectedTarget(value.tool_input);
      if (target !== undefined) targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
    }
    for (const [key, child] of Object.entries(value)) {
      if ((key === "additionalContext" || key === "additional_context") && child === SENTINEL) {
        sentinelContexts += 1;
      }
      if (nextAssistantContext && key === "text" && typeof child === "string") {
        if (child.includes(SENTINEL)) sentinelAssistantTexts += 1;
        if (child.includes(COMPLETION_SENTINEL)) completionVisible = true;
      }
      visit(child, nextAssistantContext);
    }
  };

  for (const line of stdout.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    try { visit(JSON.parse(line), false); } catch { /* Only structured stream evidence counts. */ }
  }
  const stableSessionField = STABLE_SESSION_FIELDS.find((field) =>
    [...(stableValues.get(field)?.values() ?? [])].some((count) => count >= 2)) ?? null;
  return Object.freeze({
    stableSessionField,
    targetCounts,
    sentinelContexts,
    sentinelAssistantTexts,
    completionVisible,
  });
}

function fileEquals(projectPath: string, relativePath: string, expected: string): boolean {
  try {
    return fs.readFileSync(path.join(projectPath, relativePath), "utf8").trim() === expected;
  } catch {
    return false;
  }
}

function runClaudeSession(projectPath: string): {
  readonly result: CommandResult;
  readonly stream: StreamObservations;
} {
  const result = runKscc([
    "-p",
    "--output-format", "stream-json",
    "--include-hook-events",
    "--permission-mode", "acceptEdits",
    "--allowed-tools", "Write,Edit",
    "--no-session-persistence",
    "--verbose",
    CLAUDE_PROMPT,
  ], projectPath, CLAUDE_SESSION_TIMEOUT_MS);
  return Object.freeze({ result, stream: observeClaudeStream(result.stdout) });
}

function completeObservationRecord(value: Partial<HostDeliveryObservations>): HostDeliveryObservations {
  return Object.freeze(Object.fromEntries(
    OBSERVATION_KEYS.map((key) => [key, value[key] === true]),
  ) as unknown as HostDeliveryObservations);
}

function captureTimestamp(receiptPath: string, stableReceipt: Omit<HostDeliveryReceipt, "capturedAt">): string {
  try {
    const current = verifyReceiptFile(receiptPath);
    const comparable = { ...current } as Record<string, unknown>;
    delete comparable.capturedAt;
    if (canonicalJson(comparable).equals(canonicalJson(stableReceipt))) return current.capturedAt;
  } catch {
    // A missing or stale receipt receives a fresh timestamp.
  }
  return new Date().toISOString();
}

function writeReceipt(receiptPath: string, receipt: HostDeliveryReceipt): void {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const temporaryPath = `${receiptPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, canonicalJson(receipt), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, receiptPath);
  } catch {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* Stable write error below. */ }
    throw new Error("receipt_write_failed");
  }
}

function safeProjectPath(repositoryRoot: string, requestedPath: string): string {
  const projectPath = path.resolve(repositoryRoot, requestedPath);
  const relative = path.relative(repositoryRoot, projectPath);
  if (relative.length === 0 || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("invalid_project_path");
  }
  return projectPath;
}

function removeTemporaryTree(treePath: string): boolean {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(treePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return !fs.existsSync(treePath);
    } catch {
      if (attempt < 19) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      }
    }
  }
  return false;
}

function captureUnsupported(options: CaptureOptions): HostDeliveryReceipt {
  const observations = completeObservationRecord({});
  const stable = {
    schemaVersion: 1 as const,
    host: options.host,
    version: options.expectedVersion,
    stableSessionField: null,
    observations,
    fixtureDigest: sha256(`${options.host}\0${PROBE_SOURCE}\0${CLAUDE_PROMPT}`),
    provenanceDigest: sha256(`${options.host}\0${options.expectedVersion}\0unsupported`),
    verdict: "UNSUPPORTED" as const,
    reason: "headless_host_unsupported" as const,
  };
  return parseHostDeliveryReceipt({
    ...stable,
    capturedAt: captureTimestamp(options.receiptPath, stable),
  });
}

async function captureClaude(options: CaptureOptions): Promise<HostDeliveryReceipt> {
  const repositoryRoot = path.resolve(__dirname, "../..");
  const projectPath = safeProjectPath(repositoryRoot, options.projectPath);
  if (fs.existsSync(projectPath)) throw new Error("project_exists");
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-host-delivery-"));
  let projectCreated = false;
  let captureError: Error | undefined;
  let receipt: HostDeliveryReceipt | undefined;
  try {
    const observedVersion = strictClaudeVersion(repositoryRoot);
    if (observedVersion === undefined || observedVersion !== options.expectedVersion) {
      throw new Error("version_mismatch");
    }
    const wrapperVersion = strictKsccVersion(repositoryRoot);
    if (wrapperVersion !== KSCC_EXPECTED_VERSION) throw new Error("launcher_version_mismatch");
    const tarballPath = packRepository(repositoryRoot, runtimeRoot);
    const provenanceDigest = sha256(fs.readFileSync(tarballPath));
    fs.mkdirSync(projectPath, { recursive: true });
    projectCreated = true;
    const installed = installPackedCli(tarballPath, projectPath, runtimeRoot, repositoryRoot);
    installFixtureProbe(projectPath);
    const session = runClaudeSession(projectPath);
    if (session.result.code !== 0 || session.result.timedOut) throw new Error("native_session_failed");

    const mainFinal = fileEquals(projectPath, MAIN_CPP, "int FixtureValue() { return 2; }");
    const luaFinal = fileEquals(projectPath, LUA_FILE, "return 2");
    const malformedFinal = fileEquals(projectPath, MALFORMED_CPP, "int MalformedCase = 1;");
    const nonzeroFinal = fileEquals(projectPath, NONZERO_CPP, "int NonzeroCase = 1;");
    const timeoutFinal = fileEquals(projectPath, TIMEOUT_CPP, "int TimeoutCase = 1;");
    const sentinelClaimed = fs.existsSync(path.join(
      projectPath,
      ".claude",
      "kcoderag-nav",
      "fixture-host-delivery.once",
    ));
    const targetCounts = session.stream.targetCounts;
    const targetsObserved = (targetCounts.get(MAIN_CPP) ?? 0) >= 2 &&
      [LUA_FILE, MALFORMED_CPP, NONZERO_CPP, TIMEOUT_CPP]
        .every((name) => (targetCounts.get(name) ?? 0) >= 1);
    const observations = completeObservationRecord({
      nativeInstall: installed,
      cppCreated: mainFinal,
      cppModified: mainFinal && (targetCounts.get(MAIN_CPP) ?? 0) >= 2,
      luaWritten: luaFinal,
      structuredTargets: targetsObserved,
      stableSessionRepeated: session.stream.stableSessionField !== null,
      sentinelVisible: session.stream.sentinelAssistantTexts === 1,
      sentinelOnce: sentinelClaimed && session.stream.sentinelAssistantTexts === 1,
      validWriteCompleted: mainFinal,
      emptyWriteCompleted: luaFinal,
      malformedWriteCompleted: malformedFinal,
      nonzeroWriteCompleted: nonzeroFinal,
      timeoutWriteCompleted: timeoutFinal,
    });
    const passed = OBSERVATION_KEYS.every((key) => observations[key]) && session.stream.completionVisible;
    const stable = {
      schemaVersion: 1 as const,
      host: "claude" as const,
      version: observedVersion,
      stableSessionField: session.stream.stableSessionField,
      observations,
      fixtureDigest: sha256(
        `${PROBE_SOURCE}\0${CLAUDE_PROMPT}\0claude-2.1.241-v1\0kscc-${wrapperVersion}`,
      ),
      provenanceDigest,
      verdict: passed ? "PASS" as const : "FAIL" as const,
      reason: passed ? "verified" as const : "observation_incomplete" as const,
    };
    receipt = parseHostDeliveryReceipt({
      ...stable,
      capturedAt: captureTimestamp(options.receiptPath, stable),
    });
    if (!passed) captureError = new Error("observation_incomplete");
  } catch (error) {
    captureError = error instanceof Error ? error : new Error("capture_failed");
  } finally {
    let cleanupFailed = false;
    if (projectCreated) {
      cleanupFailed = !removeTemporaryTree(projectPath);
    }
    cleanupFailed = !removeTemporaryTree(runtimeRoot) || cleanupFailed;
    if (cleanupFailed) captureError = new Error("cleanup_failed");
  }
  if (receipt !== undefined) writeReceipt(options.receiptPath, receipt);
  if (captureError !== undefined) throw captureError;
  if (receipt === undefined) throw new Error("capture_failed");
  return receipt;
}

async function capture(options: CaptureOptions): Promise<HostDeliveryReceipt> {
  if (options.host !== "claude") {
    const receipt = captureUnsupported(options);
    writeReceipt(options.receiptPath, receipt);
    return receipt;
  }
  return captureClaude(options);
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  let mode: "capture" | "verify" | undefined;
  let host: HostId | undefined;
  let expectedVersion: string | undefined;
  let projectPath: string | undefined;
  let receiptPath: string | undefined;
  let requirePass = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--capture" || argument === "--verify") {
      if (mode !== undefined) throw new Error("invalid_arguments");
      mode = argument === "--capture" ? "capture" : "verify";
    } else if (argument === "--require-pass") {
      requirePass = true;
    } else if (argument === "--host" && value !== undefined) {
      if (host !== undefined || !HOSTS.includes(value as HostId)) throw new Error("invalid_arguments");
      host = value as HostId;
      index += 1;
    } else if (argument === "--expected-version" && value !== undefined) {
      if (expectedVersion !== undefined || !EXACT_VERSION.test(value)) throw new Error("invalid_arguments");
      expectedVersion = value;
      index += 1;
    } else if (argument === "--project" && value !== undefined) {
      if (projectPath !== undefined) throw new Error("invalid_arguments");
      projectPath = value;
      index += 1;
    } else if (argument === "--receipt" && value !== undefined) {
      if (receiptPath !== undefined) throw new Error("invalid_arguments");
      receiptPath = path.resolve(value);
      index += 1;
    } else {
      throw new Error("invalid_arguments");
    }
  }
  if (mode === undefined || receiptPath === undefined) throw new Error("invalid_arguments");
  if (mode === "verify") {
    if (host !== undefined || expectedVersion !== undefined || projectPath !== undefined) {
      throw new Error("invalid_arguments");
    }
    return { mode, receiptPath, requirePass };
  }
  if (host === undefined || expectedVersion === undefined || projectPath === undefined) {
    throw new Error("invalid_arguments");
  }
  return { mode, receiptPath, requirePass, host, expectedVersion, projectPath };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseArguments(argv);
    const receipt = args.mode === "verify"
      ? verifyReceiptFile(args.receiptPath, args.requirePass)
      : await capture({
          host: args.host as HostId,
          expectedVersion: args.expectedVersion as string,
          projectPath: args.projectPath as string,
          receiptPath: args.receiptPath,
          requirePass: args.requirePass,
        });
    if (args.requirePass && receipt.verdict !== "PASS") return 1;
    return 0;
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]{1,80}$/u.test(error.message)
      ? error.message
      : "host_delivery_failed";
    process.stderr.write(`${code}\n`);
    return 1;
  }
}

exports.OBSERVATION_KEYS = OBSERVATION_KEYS;
exports.parseHostDeliveryReceipt = parseHostDeliveryReceipt;
exports.receiptDigest = receiptDigest;
exports.verifyReceiptFile = verifyReceiptFile;
exports.main = main;

if (require.main === module) {
  main().then(
    (code) => { process.exitCode = code; },
    () => { process.exitCode = 1; },
  );
}
