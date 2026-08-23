const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const readline = require("node:readline/promises") as typeof import("node:readline/promises");

type JsonMap = Record<string, any>;

interface InstallOptions {
  target: string;
  packageRoot: string;
  failAtStage?: number;
  failAtCommit?: number;
  onCommit?: (relativePath: string) => void;
}

interface InstallResult {
  host: "codex";
  environment: "qa";
  target: string;
  version: string;
  managedFiles: string[];
}

interface CliDependencies {
  cwd?: string;
  packageRoot?: string;
  nodeVersion?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  confirm?: (prompt: string) => boolean | Promise<boolean>;
}

interface ParsedArgs {
  command: "install";
  host: "codex";
  environment: "qa";
  target?: string;
  yes: boolean;
  json: boolean;
}

interface OriginalRecord {
  kind: "absent" | "base64";
  data?: string;
}

interface InstallState {
  schemaVersion: 1;
  packageVersion: string;
  host: "codex";
  environment: "qa";
  managedFiles: string[];
  originals: Record<string, OriginalRecord>;
  digests: Record<string, string>;
}

const STATE_PATH = ".codex/kcoderag-nav/install-state.json";
const CONFIG_PATH = ".codex/config.toml";
const HOOKS_PATH = ".codex/hooks.json";
const SKILL_PATH = ".agents/skills/kcoderag-nav/SKILL.md";
const HOOK_PREFIX = ".codex/kcoderag-nav/qa/hooks";
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
const EXCLUSIVE_PATHS = new Set(
  MANAGED_PATHS.filter((relativePath) => ![CONFIG_PATH, HOOKS_PATH, STATE_PATH].includes(relativePath)),
);
const CONFIG_BEGIN = "# BEGIN KCODERAG-NAV qa";
const CONFIG_END = "# END KCODERAG-NAV qa";

class InstallError extends Error {
  readonly code: string;
  readonly safePath?: string;

  constructor(code: string, safePath?: string) {
    super(code);
    this.name = "InstallError";
    this.code = code;
    if (safePath !== undefined) this.safePath = safePath;
  }
}

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readOptional(filePath: string): Buffer | undefined {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function assertSafeTarget(rawTarget: string): string {
  const resolved = path.resolve(rawTarget);
  let metadata: import("node:fs").Stats;
  try {
    metadata = fs.lstatSync(resolved);
  } catch {
    throw new InstallError("invalid_target", resolved);
  }
  if (!metadata.isDirectory()) throw new InstallError("invalid_target", resolved);
  if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape", resolved);
  const canonical = fs.realpathSync(resolved);
  if (canonical === path.parse(canonical).root) throw new InstallError("unsafe_target", canonical);
  return canonical;
}

function assertManagedPath(target: string, relativePath: string): string {
  if (
    !(relativePath.startsWith(".codex/") || relativePath.startsWith(".agents/")) ||
    relativePath.includes("\\")
  ) {
    throw new InstallError("outside_managed_roots", relativePath);
  }
  const candidate = path.resolve(target, ...relativePath.split("/"));
  const relation = path.relative(target, candidate);
  if (relation === "" || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new InstallError("path_escape", relativePath);
  }
  let current = target;
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new InstallError("symlink_escape", relativePath);
      }
    } catch (error) {
      if (error instanceof InstallError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return candidate;
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

function packageVersion(packageRoot: string): string {
  const packagePath = path.join(packageRoot, "package.json");
  const document = parseJsonBytes(fs.readFileSync(packagePath), "invalid_package", "package.json");
  if (document.name !== "kcoderag-nav" || typeof document.version !== "string") {
    throw new InstallError("invalid_package", "package.json");
  }
  return document.version;
}

function readMcpEntry(packageRoot: string): { name: string; url: string; headers: Record<string, string> } {
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
    !headerValue ||
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

function decodeOriginal(record: unknown, relativePath: string): Buffer | undefined {
  if (!isRecord(record) || (record.kind !== "absent" && record.kind !== "base64")) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  if (record.kind === "absent") {
    if (record.data !== undefined) throw new InstallError("invalid_state", STATE_PATH);
    return undefined;
  }
  if (typeof record.data !== "string") throw new InstallError("invalid_state", STATE_PATH);
  try {
    return Buffer.from(record.data, "base64");
  } catch {
    throw new InstallError("invalid_state", relativePath);
  }
}

function validateState(value: JsonMap): InstallState {
  const ownedPaths = MANAGED_PATHS.filter((relativePath) => relativePath !== STATE_PATH);
  if (
    value.schemaVersion !== 1 ||
    value.host !== "codex" ||
    (value.environment !== "qa" && value.environment !== "dev") ||
    typeof value.packageVersion !== "string" ||
    !Array.isArray(value.managedFiles) ||
    value.managedFiles.join("\0") !== MANAGED_PATHS.join("\0") ||
    !isRecord(value.originals) ||
    !isRecord(value.digests) ||
    Object.keys(value.originals).sort().join("\0") !== [...ownedPaths].sort().join("\0") ||
    Object.keys(value.digests).sort().join("\0") !== [...ownedPaths].sort().join("\0")
  ) {
    throw new InstallError("invalid_state", STATE_PATH);
  }
  for (const relativePath of ownedPaths) {
    decodeOriginal(value.originals[relativePath], relativePath);
    if (typeof value.digests[relativePath] !== "string") {
      throw new InstallError("invalid_state", STATE_PATH);
    }
  }
  return value as InstallState;
}

function loadState(target: string): InstallState | undefined {
  const statePath = assertManagedPath(target, STATE_PATH);
  const bytes = readOptional(statePath);
  if (bytes === undefined) return undefined;
  const state = validateState(parseJsonBytes(bytes, "invalid_state", STATE_PATH));
  if (state.environment !== "qa") throw new InstallError("environment_conflict", STATE_PATH);
  for (const [relativePath, digest] of Object.entries(state.digests)) {
    const current = readOptional(assertManagedPath(target, relativePath));
    if (current === undefined || sha256(current) !== digest) {
      throw new InstallError("managed_content_changed", relativePath);
    }
  }
  return state;
}

function captureOriginals(target: string): Record<string, OriginalRecord> {
  const originals: Record<string, OriginalRecord> = {};
  for (const relativePath of MANAGED_PATHS) {
    if (relativePath === STATE_PATH) continue;
    const current = readOptional(assertManagedPath(target, relativePath));
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

function desiredInstall(
  target: string,
  packageRoot: string,
  version: string,
  existingState: InstallState | undefined,
): Map<string, Buffer> {
  const originals = existingState?.originals ?? captureOriginals(target);
  const originalConfig = decodeOriginal(originals[CONFIG_PATH], CONFIG_PATH);
  const originalHooks = decodeOriginal(originals[HOOKS_PATH], HOOKS_PATH);
  const desired = new Map<string, Buffer>();
  desired.set(CONFIG_PATH, renderConfig(originalConfig, packageRoot));
  desired.set(HOOKS_PATH, renderHooks(originalHooks));
  desired.set(
    SKILL_PATH,
    sourceAsset(packageRoot, "kcoderag-qa/skills/code-lookup-discipline/SKILL.md"),
  );
  for (const asset of HOOK_ASSETS) {
    desired.set(`${HOOK_PREFIX}/${asset}`, sourceAsset(packageRoot, `kcoderag-qa/hooks/${asset}`));
  }
  const digests: Record<string, string> = {};
  for (const [relativePath, bytes] of desired) digests[relativePath] = sha256(bytes);
  const state: InstallState = {
    schemaVersion: 1,
    packageVersion: version,
    host: "codex",
    environment: "qa",
    managedFiles: [...MANAGED_PATHS],
    originals,
    digests,
  };
  desired.set(STATE_PATH, Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8"));
  return desired;
}

function snapshotDirectories(root: string): Set<string> {
  const result = new Set<string>([root]);
  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolute = path.join(directory, entry.name);
      result.add(absolute);
      visit(absolute);
    }
  }
  visit(root);
  return result;
}

function pruneNewDirectories(target: string, before: Set<string>): boolean {
  let restored = true;
  const current = [...snapshotDirectories(target)]
    .filter((directory) => !before.has(directory))
    .sort((left, right) => right.length - left.length);
  for (const directory of current) {
    try {
      if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
      else restored = false;
    } catch {
      restored = false;
    }
  }
  return restored;
}

function writeTemporary(destination: string, bytes: Buffer): string {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = path.join(path.dirname(destination), `.kcoderag-stage-${crypto.randomUUID()}`);
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return temporary;
}

function restorePath(destination: string, original: Buffer | undefined): void {
  if (original === undefined) {
    fs.rmSync(destination, { force: true });
    return;
  }
  const temporary = writeTemporary(destination, original);
  try {
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function applyTransaction(
  target: string,
  desired: Map<string, Buffer>,
  options: Pick<InstallOptions, "failAtStage" | "failAtCommit" | "onCommit">,
): void {
  const destinations = new Map(
    [...desired.keys()].map((relativePath) => [relativePath, assertManagedPath(target, relativePath)]),
  );
  const originals = new Map(
    [...destinations].map(([relativePath, destination]) => [relativePath, readOptional(destination)]),
  );
  const directoriesBefore = snapshotDirectories(target);
  const staged = new Map<string, string>();
  try {
    let stageIndex = 0;
    for (const [relativePath, bytes] of desired) {
      if (options.failAtStage === stageIndex) throw new Error("injected staging failure");
      staged.set(relativePath, writeTemporary(destinations.get(relativePath) as string, bytes));
      stageIndex += 1;
    }
    for (const [index, relativePath] of MANAGED_PATHS.entries()) {
      if (options.failAtCommit === index) throw new Error("injected transaction failure");
      fs.renameSync(staged.get(relativePath) as string, destinations.get(relativePath) as string);
      staged.delete(relativePath);
      options.onCommit?.(relativePath);
    }
    return;
  } catch {
    // Cleanup and full rollback happen below.
  }

  let rollbackFailed = false;
  for (const temporary of staged.values()) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      rollbackFailed = true;
    }
  }
  for (const relativePath of MANAGED_PATHS) {
    try {
      restorePath(destinations.get(relativePath) as string, originals.get(relativePath));
    } catch {
      rollbackFailed = true;
    }
  }
  if (!pruneNewDirectories(target, directoriesBefore)) rollbackFailed = true;
  throw new InstallError(rollbackFailed ? "rollback_failed" : "transaction_failed");
}

function installCodexQa(options: InstallOptions): InstallResult {
  const target = assertSafeTarget(options.target);
  for (const relativePath of MANAGED_PATHS) assertManagedPath(target, relativePath);
  const version = packageVersion(options.packageRoot);
  const state = loadState(target);
  const desired = desiredInstall(target, options.packageRoot, version, state);
  applyTransaction(target, desired, options);
  return {
    host: "codex",
    environment: "qa",
    target,
    version,
    managedFiles: [...MANAGED_PATHS],
  };
}

function requireFlagValue(argv: string[], index: number): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new InstallError("invalid_arguments");
  return value;
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv[0] !== "install") throw new InstallError("invalid_arguments");
  let host: string | undefined;
  let environment = "qa";
  let target: string | undefined;
  let yes = false;
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--yes") yes = true;
    else if (argument === "--json") json = true;
    else if (argument === "--host") host = requireFlagValue(argv, index++);
    else if (argument === "--environment") environment = requireFlagValue(argv, index++);
    else if (argument === "--target") target = requireFlagValue(argv, index++);
    else throw new InstallError("invalid_arguments");
  }
  if (host !== "codex" || environment !== "qa") throw new InstallError("unsupported_selection");
  const result: ParsedArgs = { command: "install", host, environment, yes, json };
  if (target !== undefined) result.target = target;
  return result;
}

function nodeMajor(version: string): number | undefined {
  const match = /^(?:v)?(\d+)(?:\.|$)/.exec(version);
  return match ? Number.parseInt(match[1] as string, 10) : undefined;
}

function safeError(error: unknown): { code: string; path?: string } {
  if (error instanceof InstallError) {
    return error.safePath === undefined ? { code: error.code } : { code: error.code, path: error.safePath };
  }
  return { code: "install_failed" };
}

async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  const stderr = dependencies.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));
  let json = argv.includes("--json");
  try {
    const args = parseArgs(argv);
    json = args.json;
    const major = nodeMajor(dependencies.nodeVersion ?? process.versions.node);
    if (major === undefined || major < 22) throw new InstallError("unsupported_node");
    const target = assertSafeTarget(path.resolve(dependencies.cwd ?? process.cwd(), args.target ?? "."));
    if (!args.yes) {
      if (args.json) throw new InstallError("confirmation_required", target);
      const confirmed = await (dependencies.confirm?.(`Install KCodeRag Nav into ${target}?`) ?? false);
      if (!confirmed) throw new InstallError("cancelled", target);
    }
    const result = installCodexQa({
      target,
      packageRoot: dependencies.packageRoot ?? path.resolve(__dirname, "../.."),
    });
    if (args.json) stdout(JSON.stringify({ ok: true, command: args.command, ...result }));
    else stdout(`installed: codex/qa at ${result.target}`);
    return 0;
  } catch (error) {
    const safe = safeError(error);
    const payload = JSON.stringify({ ok: false, ...safe });
    if (json) stdout(payload);
    else stderr(payload);
    return safe.code === "cancelled" || safe.code === "invalid_arguments" ? 2 : 1;
  }
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

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return runCli(argv, {
    cwd: process.cwd(),
    packageRoot: path.resolve(__dirname, "../.."),
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    confirm: defaultConfirm,
  });
}

exports.InstallError = InstallError;
exports.MANAGED_PATHS = MANAGED_PATHS;
exports.installCodexQa = installCodexQa;
exports.runCli = runCli;
exports.main = main;
