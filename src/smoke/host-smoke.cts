/** Honest three-state host smoke runner with package acquisition and loopback receipts. */

const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const childProcess = require("node:child_process") as typeof import("node:child_process");

import type { HostId } from "../core/contracts.cjs";
import {
  readReceipts,
  startStubMcpServer,
  SYNTHETIC_TOOL,
  type StubReceipt,
} from "./stub-mcp-server.cjs";

export type SmokeMode = "required-contract" | "optional-live";
export type SmokeStatus = "PASS" | "FAIL" | "NOT_RUN";

export interface SmokeEvidence {
  readonly packageAcquired: boolean;
  readonly install: boolean;
  readonly status: boolean;
  readonly toolRegistration: boolean;
  readonly navigation: boolean;
  readonly mcpInitialize: boolean;
  readonly mcpList: boolean;
  readonly mcpCall: boolean;
  readonly update: boolean;
  readonly uninstall: boolean;
  readonly stubReceipt: boolean;
}

export interface HostSmokeResult {
  readonly schemaVersion: 1;
  readonly host: HostId;
  readonly mode: SmokeMode;
  readonly status: SmokeStatus;
  readonly reason: string;
  readonly evidence: SmokeEvidence;
}

export interface SmokeRunResult {
  readonly schemaVersion: 1;
  readonly mode: SmokeMode;
  readonly status: SmokeStatus;
  readonly hosts: readonly HostSmokeResult[];
}

export interface RunHostSmokeOptions {
  readonly mode: SmokeMode;
  readonly packageSpec?: string;
  readonly temporaryRoot?: string;
  readonly repositoryRoot?: string;
  readonly hosts?: readonly HostId[];
}

interface RunHostSmokeDependencies {
  readonly acquirePackage?: (
    packageSpec: string,
    temporaryRoot: string,
    stubUrl: string,
    repositoryRoot: string,
  ) => Promise<string>;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface McpConnection {
  readonly serverName: string;
  readonly url: string;
}

const HOSTS: readonly HostId[] = Object.freeze(["codex", "claude", "cursor"] as const);
export const EVIDENCE_KEYS: readonly (keyof SmokeEvidence)[] = Object.freeze([
  "packageAcquired",
  "install",
  "status",
  "toolRegistration",
  "navigation",
  "mcpInitialize",
  "mcpList",
  "mcpCall",
  "update",
  "uninstall",
  "stubReceipt",
]);
const PUBLIC_EXACT_SPEC = /^kcoderag-nav@\d+\.\d+\.\d+$/u;
const SYNTHETIC_AUTHORIZATION = "Bearer synthetic-contract-only";
const COMMAND_TIMEOUT_MS = 120_000;
const LIVE_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blankEvidence(): SmokeEvidence {
  return Object.freeze(Object.fromEntries(EVIDENCE_KEYS.map((key) => [key, false])) as unknown as SmokeEvidence);
}

export function completeEvidence(overrides: Partial<SmokeEvidence> = {}): SmokeEvidence {
  return Object.freeze({
    ...Object.fromEntries(EVIDENCE_KEYS.map((key) => [key, true])),
    ...overrides,
  } as unknown as SmokeEvidence);
}

function normalizeEvidence(value: Partial<SmokeEvidence> | undefined): SmokeEvidence {
  const evidence = { ...blankEvidence() } as Record<keyof SmokeEvidence, boolean>;
  if (value !== undefined) {
    for (const key of EVIDENCE_KEYS) evidence[key] = value[key] === true;
  }
  return Object.freeze(evidence) as SmokeEvidence;
}

export function evaluateHostEvidence(input: {
  readonly host: HostId;
  readonly mode: SmokeMode;
  readonly evidence?: Partial<SmokeEvidence>;
  readonly unavailableReason?: string;
  readonly failureReason?: string;
}): HostSmokeResult {
  const evidence = normalizeEvidence(input.evidence);
  if (input.unavailableReason !== undefined) {
    return Object.freeze({
      schemaVersion: 1,
      host: input.host,
      mode: input.mode,
      status: "NOT_RUN",
      reason: input.unavailableReason,
      evidence,
    });
  }
  const complete = EVIDENCE_KEYS.every((key) => evidence[key]);
  return Object.freeze({
    schemaVersion: 1,
    host: input.host,
    mode: input.mode,
    status: complete ? "PASS" : "FAIL",
    reason: complete ? "verified" : (input.failureReason ?? "evidence_incomplete"),
    evidence,
  });
}

export function smokeExitCode(result: { readonly mode: SmokeMode; readonly status: SmokeStatus }): number {
  if (result.status === "PASS") return 0;
  if (result.status === "NOT_RUN" && result.mode === "optional-live") return 0;
  return 1;
}

function safeEnvironment(root: string): NodeJS.ProcessEnv {
  const hostHome = path.join(root, "host-home");
  fs.mkdirSync(hostHome, { recursive: true });
  return {
    ...process.env,
    ...(process.platform === "win32" ? { USERPROFILE: hostHome } : { HOME: hostHome }),
    CODEX_HOME: hostHome,
    CLAUDE_CONFIG_DIR: hostHome,
    KCODERAG_NAV_UPDATE_CHECK: "0",
    NO_COLOR: "1",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_loglevel: "silent",
  };
}

function runProcess(
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly input?: string;
    readonly timeout?: number;
    readonly commandShim?: boolean;
  },
): CommandResult {
  const useCommandShim = options.commandShim === true && process.platform === "win32";
  const selectedExecutable = useCommandShim ? (process.env.ComSpec ?? "cmd.exe") : executable;
  const selectedArgs = useCommandShim ? ["/d", "/s", "/c", executable, ...args] : [...args];
  const completed = childProcess.spawnSync(selectedExecutable, selectedArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout ?? COMMAND_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    code: completed.status ?? 1,
    stdout: typeof completed.stdout === "string" ? completed.stdout : "",
    stderr: typeof completed.stderr === "string" ? completed.stderr : "",
  };
}

function runNpm(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): CommandResult {
  return runProcess("npm", args, { cwd, env, commandShim: true });
}

function parsePackFilename(stdout: string, destination: string): string {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (
      Array.isArray(parsed) &&
      isRecord(parsed[0]) &&
      typeof parsed[0].filename === "string" &&
      parsed[0].filename.endsWith(".tgz")
    ) {
      const result = path.resolve(destination, parsed[0].filename);
      if (fs.statSync(result).isFile()) return result;
    }
  } catch {
    // Safe stable error below.
  }
  throw new Error("package_acquisition_failed");
}

function packDirectory(directory: string, destination: string, env: NodeJS.ProcessEnv): string {
  fs.mkdirSync(destination, { recursive: true });
  const packed = runNpm(
    ["pack", directory, "--json", "--ignore-scripts", "--pack-destination", destination],
    destination,
    env,
  );
  if (packed.code !== 0) throw new Error("package_acquisition_failed");
  return parsePackFilename(packed.stdout, destination);
}

function normalizePackageSpec(packageSpec: string, repositoryRoot: string): string {
  if (PUBLIC_EXACT_SPEC.test(packageSpec)) return packageSpec;
  const resolved = path.resolve(repositoryRoot, packageSpec);
  if (!resolved.toLowerCase().endsWith(".tgz")) throw new Error("invalid_package_spec");
  try {
    if (!fs.statSync(resolved).isFile()) throw new Error("invalid_package_spec");
  } catch {
    throw new Error("invalid_package_spec");
  }
  return resolved;
}

function writeSyntheticMcpSources(packageRoot: string, stubUrl: string): void {
  for (const environment of ["qa", "dev"] as const) {
    const name = `kcoderag-${environment}`;
    const entry = {
      type: "http",
      url: stubUrl,
      headers: { Authorization: SYNTHETIC_AUTHORIZATION },
    };
    fs.writeFileSync(
      path.join(packageRoot, name, ".mcp.json"),
      `${JSON.stringify({ mcpServers: { [name]: entry } }, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(packageRoot, name, ".codex.mcp.json"),
      `${JSON.stringify({ [name]: {
        url: stubUrl,
        http_headers: { Authorization: SYNTHETIC_AUTHORIZATION },
      } }, null, 2)}\n`,
      "utf8",
    );
  }
}

async function acquirePackage(
  packageSpec: string,
  temporaryRoot: string,
  stubUrl: string,
  repositoryRoot: string,
): Promise<string> {
  const env = safeEnvironment(path.join(temporaryRoot, "acquisition-runtime"));
  const sourceSpec = packageSpec.length === 0
    ? packDirectory(repositoryRoot, path.join(temporaryRoot, "source-pack"), env)
    : normalizePackageSpec(packageSpec, repositoryRoot);
  const installRoot = path.join(temporaryRoot, "acquired");
  fs.mkdirSync(installRoot, { recursive: true });
  const installed = runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--prefix",
    installRoot,
    sourceSpec,
  ], temporaryRoot, env);
  if (installed.code !== 0) throw new Error("package_acquisition_failed");
  const packageRoot = path.join(installRoot, "node_modules", "kcoderag-nav");
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    if (!isRecord(manifest) || manifest.name !== "kcoderag-nav") throw new Error("invalid_package");
  } catch {
    throw new Error("package_acquisition_failed");
  }
  writeSyntheticMcpSources(packageRoot, stubUrl);
  return packDirectory(packageRoot, path.join(temporaryRoot, "synthetic-pack"), env);
}

function parseCliPayload(result: CommandResult, command: string): Record<string, any> | undefined {
  if (result.code !== 0) return undefined;
  try {
    const payload: unknown = JSON.parse(result.stdout.trim());
    return isRecord(payload) && payload.ok === true && payload.command === command ? payload : undefined;
  } catch {
    return undefined;
  }
}

function runPackageCli(
  packageSpec: string,
  projectRoot: string,
  runtimeRoot: string,
  command: "install" | "status" | "update" | "uninstall",
  host: HostId,
): Record<string, any> | undefined {
  const args = [
    "exec",
    "--yes",
    "--ignore-scripts",
    `--package=${packageSpec}`,
    "--",
    "kcoderag-nav",
    command,
    "--host",
    host,
    "--environment",
    "qa",
    "--target",
    projectRoot,
    "--json",
  ];
  if (command !== "status") args.push("--yes");
  return parseCliPayload(runNpm(args, projectRoot, safeEnvironment(runtimeRoot)), command);
}

function expectedServerName(host: HostId): string {
  return host === "cursor" ? "kcoderag" : "kcoderag-qa";
}

function readConnection(host: HostId, projectRoot: string): McpConnection | undefined {
  try {
    if (host === "codex") {
      const source = fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8");
      const block = /\[mcp_servers\."?([^"\]\s]+)"?\][\s\S]*?^url\s*=\s*("(?:\\.|[^"])*")/mu.exec(source);
      if (block?.[1] === undefined || block[2] === undefined) return undefined;
      const url: unknown = JSON.parse(block[2]);
      return typeof url === "string" ? { serverName: block[1], url } : undefined;
    }
    const relativePath = host === "claude" ? ".mcp.json" : ".cursor/mcp.json";
    const document: unknown = JSON.parse(fs.readFileSync(path.join(projectRoot, ...relativePath.split("/")), "utf8"));
    if (!isRecord(document) || !isRecord(document.mcpServers)) return undefined;
    const name = expectedServerName(host);
    const entry = document.mcpServers[name];
    return isRecord(entry) && typeof entry.url === "string"
      ? { serverName: name, url: entry.url }
      : undefined;
  } catch {
    return undefined;
  }
}

function navigationEvidence(host: HostId, projectRoot: string, runtimeRoot: string): boolean {
  if (host === "cursor") {
    try {
      const rule = fs.readFileSync(path.join(projectRoot, ".cursor", "rules", "kcoderag-navigation.mdc"), "utf8");
      const skill = fs.readFileSync(path.join(projectRoot, ".cursor", "skills", "kcoderag-nav", "SKILL.md"), "utf8");
      return /alwaysApply:\s*true/u.test(rule) && rule.includes("search_code") && skill.includes("KCodeRag");
    } catch {
      return false;
    }
  }
  const launcherRoot = host === "codex" ? ".codex" : ".claude";
  const launcher = path.join(
    projectRoot,
    launcherRoot,
    "kcoderag-nav",
    "qa",
    "hooks",
    process.platform === "win32" ? "run_hook.cmd" : "run_hook.sh",
  );
  const payload = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "rg -n SyntheticSymbol src" },
  });
  const result = process.platform === "win32"
    ? runProcess("call", [launcher], {
        cwd: projectRoot,
        env: safeEnvironment(runtimeRoot),
        input: payload,
        commandShim: true,
        timeout: 10_000,
      })
    : runProcess("sh", [launcher], {
        cwd: projectRoot,
        env: safeEnvironment(runtimeRoot),
        input: payload,
        timeout: 10_000,
      });
  if (result.code !== 0) return false;
  try {
    const output: unknown = JSON.parse(result.stdout);
    return isRecord(output) && isRecord(output.hookSpecificOutput) &&
      output.hookSpecificOutput.hookEventName === "PreToolUse";
  } catch {
    return false;
  }
}

async function rpc(url: string, payload: Record<string, unknown>): Promise<Record<string, any> | undefined> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    if (text.length === 0) return {};
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function driveMcp(
  host: HostId,
  url: string,
  receiptPath: string,
): Promise<Pick<SmokeEvidence, "mcpInitialize" | "mcpList" | "mcpCall" | "stubReceipt">> {
  const before = readReceipts(receiptPath).length;
  const initialized = await rpc(url, {
    jsonrpc: "2.0",
    id: `${host}-initialize`,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "contract-smoke", version: "1" } },
  });
  const listed = await rpc(url, {
    jsonrpc: "2.0",
    id: `${host}-list`,
    method: "tools/list",
    params: {},
  });
  const called = await rpc(url, {
    jsonrpc: "2.0",
    id: `${host}-call`,
    method: "tools/call",
    params: { name: SYNTHETIC_TOOL, arguments: { query: "SyntheticSymbol" } },
  });
  const newReceipts = readReceipts(receiptPath).slice(before);
  const hasReceipt = (method: string, toolName: string = ""): boolean =>
    newReceipts.some((receipt) => receipt.method === method && receipt.toolName === toolName);
  const tools = isRecord(listed?.result) && Array.isArray(listed.result.tools) ? listed.result.tools : [];
  return {
    mcpInitialize: isRecord(initialized?.result) && initialized.result.serverInfo?.name === "synthetic-loopback" && hasReceipt("initialize"),
    mcpList: tools.some((tool: unknown) => isRecord(tool) && tool.name === SYNTHETIC_TOOL) && hasReceipt("tools/list"),
    mcpCall: isRecord(called?.result) && called.result.isError === false && hasReceipt("tools/call", SYNTHETIC_TOOL),
    stubReceipt: hasReceipt("initialize") && hasReceipt("tools/list") && hasReceipt("tools/call", SYNTHETIC_TOOL),
  };
}

function statePath(host: HostId, projectRoot: string): string {
  const hostRoot = host === "cursor" ? ".cursor" : host === "claude" ? ".claude" : ".codex";
  return path.join(projectRoot, hostRoot, "kcoderag-nav", "install-state.json");
}

async function runRequiredHost(
  host: HostId,
  packageSpec: string,
  projectsRoot: string,
  stubUrl: string,
  receiptPath: string,
): Promise<HostSmokeResult> {
  const projectRoot = path.join(projectsRoot, host);
  const runtimeRoot = path.join(projectsRoot, `${host}-runtime`);
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "synthetic.cpp"), "int SyntheticSymbol() { return 7; }\n", "utf8");
  const evidence = { ...blankEvidence(), packageAcquired: true } as Record<keyof SmokeEvidence, boolean>;
  let installed = false;
  try {
    evidence.install = runPackageCli(packageSpec, projectRoot, runtimeRoot, "install", host) !== undefined;
    installed = evidence.install;
    if (!installed) return evaluateHostEvidence({ host, mode: "required-contract", evidence, failureReason: "install_failed" });
    const status = runPackageCli(packageSpec, projectRoot, runtimeRoot, "status", host);
    evidence.status = status?.status === "healthy";
    const connection = readConnection(host, projectRoot);
    evidence.toolRegistration = connection?.serverName === expectedServerName(host) && connection.url === stubUrl;
    evidence.navigation = navigationEvidence(host, projectRoot, runtimeRoot);
    if (connection?.url === stubUrl) Object.assign(evidence, await driveMcp(host, connection.url, receiptPath));
    evidence.update = runPackageCli(packageSpec, projectRoot, runtimeRoot, "update", host) !== undefined;
    evidence.uninstall = runPackageCli(packageSpec, projectRoot, runtimeRoot, "uninstall", host) !== undefined &&
      !fs.existsSync(statePath(host, projectRoot));
    installed = !evidence.uninstall;
    return evaluateHostEvidence({ host, mode: "required-contract", evidence });
  } catch {
    return evaluateHostEvidence({ host, mode: "required-contract", evidence, failureReason: "contract_execution_failed" });
  } finally {
    if (installed) runPackageCli(packageSpec, projectRoot, runtimeRoot, "uninstall", host);
  }
}

function commandAvailable(command: string, cwd: string): boolean {
  const result = process.platform === "win32"
    ? runProcess("where", [command], { cwd, commandShim: true, timeout: 5_000 })
    : runProcess("sh", ["-c", `command -v ${command}`], { cwd, timeout: 5_000 });
  return result.code === 0;
}

function structuredLiveEvidence(output: string): { readonly hook: boolean; readonly tool: boolean } {
  let hook = false;
  let tool = false;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isRecord(value)) return;
    const eventName = value.hook_event_name ?? value.hookEventName;
    if (eventName === "PreToolUse") hook = true;
    if (value.tool_name === SYNTHETIC_TOOL || value.name === SYNTHETIC_TOOL) tool = true;
    for (const child of Object.values(value)) visit(child);
  };
  for (const line of output.split(/\r?\n/u)) {
    try {
      visit(JSON.parse(line));
    } catch {
      // Natural-language claims are intentionally ignored.
    }
  }
  return { hook, tool };
}

function runLiveCommand(host: HostId, projectRoot: string, runtimeRoot: string): CommandResult {
  const prompt = "Use structural code search for SyntheticSymbol, then call search_code exactly once.";
  if (host === "codex") {
    return runProcess("codex", [
      "exec", "--ephemeral", "--ignore-user-config", "--dangerously-bypass-hook-trust",
      "--json", "--sandbox", "read-only", "--cd", projectRoot, prompt,
    ], { cwd: projectRoot, env: safeEnvironment(runtimeRoot), timeout: LIVE_TIMEOUT_MS, commandShim: true });
  }
  return runProcess("claude", [
    "-p", prompt, "--mcp-config", path.join(projectRoot, ".mcp.json"), "--strict-mcp-config",
    "--output-format", "stream-json", "--verbose",
  ], { cwd: projectRoot, env: safeEnvironment(runtimeRoot), timeout: LIVE_TIMEOUT_MS, commandShim: true });
}

async function runOptionalHost(
  host: HostId,
  packageSpec: string,
  projectsRoot: string,
  stubUrl: string,
  receiptPath: string,
): Promise<HostSmokeResult> {
  if (host === "cursor") {
    return evaluateHostEvidence({
      host,
      mode: "optional-live",
      evidence: { packageAcquired: true },
      unavailableReason: "headless_host_unsupported",
    });
  }
  const command = host === "codex" ? "codex" : "claude";
  if (!commandAvailable(command, projectsRoot)) {
    return evaluateHostEvidence({
      host,
      mode: "optional-live",
      evidence: { packageAcquired: true },
      unavailableReason: "host_cli_missing",
    });
  }
  const projectRoot = path.join(projectsRoot, host);
  const runtimeRoot = path.join(projectsRoot, `${host}-runtime`);
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "synthetic.cpp"), "int SyntheticSymbol() { return 7; }\n", "utf8");
  const evidence = { ...blankEvidence(), packageAcquired: true } as Record<keyof SmokeEvidence, boolean>;
  let installed = false;
  try {
    evidence.install = runPackageCli(packageSpec, projectRoot, runtimeRoot, "install", host) !== undefined;
    installed = evidence.install;
    if (!installed) return evaluateHostEvidence({ host, mode: "optional-live", evidence, failureReason: "install_failed" });
    const status = runPackageCli(packageSpec, projectRoot, runtimeRoot, "status", host);
    evidence.status = status?.status === "healthy";
    const connection = readConnection(host, projectRoot);
    evidence.toolRegistration = connection?.serverName === expectedServerName(host) && connection.url === stubUrl;
    const before = readReceipts(receiptPath).length;
    const live = runLiveCommand(host, projectRoot, runtimeRoot);
    const structured = structuredLiveEvidence(live.stdout);
    const receipts = readReceipts(receiptPath).slice(before);
    const has = (method: string, toolName: string = ""): boolean =>
      receipts.some((receipt: StubReceipt) => receipt.method === method && receipt.toolName === toolName);
    evidence.navigation = structured.hook;
    evidence.mcpInitialize = has("initialize");
    evidence.mcpList = has("tools/list");
    evidence.mcpCall = structured.tool && has("tools/call", SYNTHETIC_TOOL);
    evidence.stubReceipt = evidence.mcpInitialize && evidence.mcpList && has("tools/call", SYNTHETIC_TOOL);
    evidence.update = runPackageCli(packageSpec, projectRoot, runtimeRoot, "update", host) !== undefined;
    evidence.uninstall = runPackageCli(packageSpec, projectRoot, runtimeRoot, "uninstall", host) !== undefined &&
      !fs.existsSync(statePath(host, projectRoot));
    installed = !evidence.uninstall;
    if (live.code !== 0) {
      const diagnostic = `${live.stdout}\n${live.stderr}`.toLowerCase();
      const authMissing = ["authentication", "not logged in", "unauthorized", "login"].some((marker) => diagnostic.includes(marker));
      return evaluateHostEvidence({
        host,
        mode: "optional-live",
        evidence,
        ...(authMissing ? { unavailableReason: "auth_missing" } : { failureReason: "host_execution_failed" }),
      });
    }
    return evaluateHostEvidence({ host, mode: "optional-live", evidence });
  } catch {
    return evaluateHostEvidence({ host, mode: "optional-live", evidence, failureReason: "live_execution_failed" });
  } finally {
    if (installed) runPackageCli(packageSpec, projectRoot, runtimeRoot, "uninstall", host);
  }
}

function aggregate(mode: SmokeMode, hosts: readonly HostSmokeResult[]): SmokeRunResult {
  const status: SmokeStatus = hosts.some((result) => result.status === "FAIL")
    ? "FAIL"
    : hosts.some((result) => result.status === "NOT_RUN")
      ? "NOT_RUN"
      : "PASS";
  return Object.freeze({ schemaVersion: 1, mode, status, hosts: Object.freeze([...hosts]) });
}

export async function runHostSmoke(
  options: RunHostSmokeOptions,
  dependencies: RunHostSmokeDependencies = {},
): Promise<SmokeRunResult> {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? path.resolve(__dirname, "../.."));
  const temporaryRoot = path.resolve(options.temporaryRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-host-smoke-")));
  const hosts = options.hosts ?? HOSTS;
  if (hosts.length === 0 || hosts.some((host) => !HOSTS.includes(host))) {
    throw new Error("unsupported_host");
  }
  const receiptPath = path.join(temporaryRoot, "receipts.jsonl");
  const server = await startStubMcpServer(receiptPath);
  let acquiredPackage: string;
  try {
    try {
      acquiredPackage = await (dependencies.acquirePackage ?? acquirePackage)(
        options.packageSpec ?? "",
        temporaryRoot,
        server.url,
        repositoryRoot,
      );
    } catch {
      return aggregate(options.mode, hosts.map((host) => evaluateHostEvidence({
        host,
        mode: options.mode,
        unavailableReason: "package_unavailable",
      })));
    }
    const projectsRoot = path.join(temporaryRoot, "projects");
    fs.mkdirSync(projectsRoot, { recursive: true });
    const results: HostSmokeResult[] = [];
    for (const host of hosts) {
      results.push(options.mode === "required-contract"
        ? await runRequiredHost(host, acquiredPackage, projectsRoot, server.url, receiptPath)
        : await runOptionalHost(host, acquiredPackage, projectsRoot, server.url, receiptPath));
    }
    return aggregate(options.mode, results);
  } finally {
    await server.close();
  }
}

interface ParsedArguments {
  readonly mode: SmokeMode;
  readonly packageSpec?: string;
  readonly hosts?: readonly HostId[];
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  let mode: SmokeMode | undefined;
  let packageSpec: string | undefined;
  const hosts: HostId[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--mode" && value !== undefined) {
      index += 1;
      mode = value === "required" ? "required-contract" : value === "live" ? "optional-live" : value as SmokeMode;
      if (mode !== "required-contract" && mode !== "optional-live") throw new Error("invalid_arguments");
    } else if (argument === "--package-spec" && value !== undefined) {
      index += 1;
      if (packageSpec !== undefined) throw new Error("invalid_arguments");
      packageSpec = value;
    } else if (argument === "--host" && value !== undefined) {
      index += 1;
      if (!HOSTS.includes(value as HostId)) throw new Error("unsupported_host");
      hosts.push(value as HostId);
    } else {
      throw new Error("invalid_arguments");
    }
  }
  if (mode === undefined) throw new Error("invalid_arguments");
  const result: { mode: SmokeMode; packageSpec?: string; hosts?: readonly HostId[] } = { mode };
  if (packageSpec !== undefined) result.packageSpec = packageSpec;
  if (hosts.length > 0) result.hosts = Object.freeze([...new Set(hosts)]);
  return result;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let temporaryRoot: string | undefined;
  try {
    const args = parseArguments(argv);
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-host-smoke-"));
    const options: RunHostSmokeOptions = {
      mode: args.mode,
      temporaryRoot,
      repositoryRoot: path.resolve(__dirname, "../.."),
      ...(args.packageSpec === undefined ? {} : { packageSpec: args.packageSpec }),
      ...(args.hosts === undefined ? {} : { hosts: args.hosts }),
    };
    const result = await runHostSmoke(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return smokeExitCode(result);
  } catch {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: "FAIL", reason: "smoke_runner_failed" })}\n`);
    return 1;
  } finally {
    if (temporaryRoot !== undefined) {
      try {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
      } catch {
        // Temporary cleanup cannot alter the smoke verdict or disclose its path.
      }
    }
  }
}

exports.EVIDENCE_KEYS = EVIDENCE_KEYS;
exports.completeEvidence = completeEvidence;
exports.evaluateHostEvidence = evaluateHostEvidence;
exports.smokeExitCode = smokeExitCode;
exports.runHostSmoke = runHostSmoke;
exports.main = main;

if (require.main === module) {
  main().then(
    (code) => { process.exitCode = code; },
    () => { process.exitCode = 1; },
  );
}
