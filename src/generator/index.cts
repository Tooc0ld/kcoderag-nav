#!/usr/bin/env node
/** Deterministic, product-scoped renderer for the QA and Cursor distributions. */

const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

import { renderProjectHookCommands } from "../core/project-root.cjs";

export type Product = "qa" | "cursor";
export type ProductSelection = Product | "all";
export type CapabilityId = "kcoderag-navigation" | "code-style-nudge";
export type CanonicalAssetGroup =
  | "runtime"
  | "registration"
  | "metadata"
  | "guidance"
  | "docs"
  | "all";
export type AssetGroup =
  | "runtime-cjs"
  | "runtime-launcher"
  | "runtime-registration"
  | "runtime-code"
  | "runtime"
  | "registration"
  | "metadata-config"
  | "metadata-guidance"
  | "metadata"
  | "guidance"
  | "docs"
  | "version"
  | "all";

export interface GeneratorIo {
  beforeCommit?(relativePath: string, index: number): void;
}

export interface GeneratorOptions {
  readonly package: ProductSelection;
  readonly group: AssetGroup;
  readonly capabilities?: readonly CapabilityId[];
  readonly sourceRoot?: string;
  readonly outputRoot?: string;
  readonly io?: GeneratorIo;
}

export interface GenerationResult {
  readonly ok: boolean;
  readonly package: ProductSelection;
  readonly group: AssetGroup;
  readonly version: string;
  readonly capabilities: readonly CapabilityId[];
  readonly selectedPaths: readonly string[];
  readonly changedPaths: readonly string[];
  readonly writtenPaths: readonly string[];
  readonly diagnostics: readonly string[];
}

export interface AssetSourceRoute {
  readonly product: Product;
  readonly output: string;
  readonly canonicalSource: string;
  readonly renderSource: string;
  readonly kind: "compiled-copy" | "normalized-copy" | "template" | "hook-registration";
}

type EnvironmentId = "qa";

interface EnvironmentMetadata {
  readonly id: EnvironmentId;
  readonly plugin_name: string;
  readonly server_name: string;
  readonly mcp_source: string;
  readonly permission_namespace: string;
  readonly agent_tool_prefix: string;
  readonly display_name: string;
  readonly short_description: string;
  readonly long_description: string;
  readonly manifest_description: string;
  readonly claude_description: string;
  readonly marketplace_description: string;
  readonly brand_color: string;
}

interface LoadedInputs {
  readonly sourceRoot: string;
  readonly version: string;
  readonly environments: Readonly<Record<EnvironmentId, EnvironmentMetadata>>;
}

interface OriginalFile {
  readonly bytes?: Buffer;
  readonly mode?: number;
  readonly atimeMs?: number;
  readonly mtimeMs?: number;
}

export class GenerationError extends Error {
  readonly code: string;
  readonly safePath?: string;

  constructor(code: string, safePath?: string) {
    super(safePath === undefined ? code : `${code}: ${safePath}`);
    this.name = "GenerationError";
    this.code = code;
    if (safePath !== undefined) this.safePath = safePath;
  }
}

const PRODUCTS = Object.freeze(["qa", "cursor"] as const);
const BUILT_IN_CAPABILITY_IDS = Object.freeze([
  "kcoderag-navigation",
  "code-style-nudge",
] as const);
const PRODUCT_DIRECTORIES: Readonly<Record<Product, string>> = Object.freeze({
  qa: "kcoderag-qa",
  cursor: "kcoderag-cursor",
});
const RETIRED_DEV_DIRECTORY = "kcoderag-dev";
const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const TOKEN_RE = /\{\{([a-z_]+)\}\}/gu;
const ANY_TOKEN_RE = /\{\{[^{}]*\}\}/u;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnion(...groups: readonly (readonly string[])[]): readonly string[] {
  return Object.freeze([...new Set(groups.flat())].sort(compareCodeUnits));
}

const QA_RUNTIME_LAUNCHER = Object.freeze([
  "hooks/run_hook.cmd",
  "hooks/run_hook.sh",
  "hooks/run_marker.cmd",
  "hooks/run_marker.sh",
]);
const QA_RUNTIME_REGISTRATION = Object.freeze(["hooks/hooks.json", "opencode/kcoderag-nav.js"]);
const QA_METADATA_CONFIG = Object.freeze([
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".codex.mcp.json",
  ".mcp.json",
]);
const QA_METADATA_GUIDANCE = Object.freeze([
  "agents/kcode-explorer.md",
  "skills/kcoderag/SKILL.md",
  "skills/kcoderag/agents/openai.yaml",
  "skills/kcoderag-manage/SKILL.md",
  "skills/kcoderag-manage/agents/openai.yaml",
  "skills/kcoderag-feedback/SKILL.md",
  "skills/kcoderag-feedback/agents/openai.yaml",
]);
const QA_DOCS = Object.freeze(["README.md"]);
const QA_VERSION = Object.freeze([
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
]);

const CURSOR_METADATA_CONFIG = Object.freeze([".cursor-plugin/plugin.json", "mcp.json"]);
const CURSOR_METADATA_GUIDANCE = Object.freeze([
  "rules/kcoderag-navigation.mdc",
  "skills/kcoderag/SKILL.md",
  "skills/kcoderag-manage/SKILL.md",
  "skills/kcoderag-feedback/SKILL.md",
]);
const CURSOR_DOCS = Object.freeze(["README.md"]);
const CURSOR_VERSION = Object.freeze([".cursor-plugin/plugin.json"]);
const EMPTY_GROUP = Object.freeze([] as string[]);
const CODE_STYLE_SKILL_PATHS = Object.freeze([
  "skills/kcoderag-code-style/SKILL.md",
  "skills/kcoderag-code-style/references/change-hygiene-self-review.md",
  "skills/kcoderag-code-style/references/cpp-lifetime-control-flow.md",
  "skills/kcoderag-code-style/references/lua-contracts.md",
  "skills/kcoderag-code-style/references/protocol-serialization-data.md",
]);
const CODE_STYLE_QA_SKILL_PATHS = Object.freeze([
  ...CODE_STYLE_SKILL_PATHS,
  "skills/kcoderag-code-style/agents/openai.yaml",
]);

interface CanonicalGroupsInput {
  readonly runtime?: readonly string[];
  readonly registration?: readonly string[];
  readonly metadata?: readonly string[];
  readonly guidance?: readonly string[];
  readonly docs?: readonly string[];
}

function canonicalGroups(input: CanonicalGroupsInput): Readonly<Record<CanonicalAssetGroup, readonly string[]>> {
  const runtime = sortedUnion(input.runtime ?? EMPTY_GROUP);
  const registration = sortedUnion(input.registration ?? EMPTY_GROUP);
  const metadata = sortedUnion(input.metadata ?? EMPTY_GROUP);
  const guidance = sortedUnion(input.guidance ?? EMPTY_GROUP);
  const docs = sortedUnion(input.docs ?? EMPTY_GROUP);
  return Object.freeze({
    runtime,
    registration,
    metadata,
    guidance,
    docs,
    all: sortedUnion(runtime, registration, metadata, guidance, docs),
  });
}

const NAVIGATION_QA_GROUPS = canonicalGroups({
  runtime: [
    "hooks/feedback-nudge.cjs",
    "hooks/grep-nudge.cjs",
    "hooks/mcp-call-marker.cjs",
    "hooks/once-marker.cjs",
    "hooks/pre-tool-dispatcher.cjs",
    "hooks/update-check.cjs",
    "hooks/update-notice.cjs",
    "hooks/update-worker.cjs",
  ],
  registration: QA_RUNTIME_LAUNCHER.concat(QA_RUNTIME_REGISTRATION),
  metadata: QA_METADATA_CONFIG,
  guidance: QA_METADATA_GUIDANCE,
  docs: QA_DOCS,
});
const NAVIGATION_CURSOR_GROUPS = canonicalGroups({
  metadata: CURSOR_METADATA_CONFIG,
  guidance: CURSOR_METADATA_GUIDANCE,
  docs: CURSOR_DOCS,
});
const CODE_STYLE_QA_GROUPS = canonicalGroups({
  runtime: [
    "hooks/code-style-nudge.cjs",
    "hooks/once-marker.cjs",
    "hooks/pre-tool-dispatcher.cjs",
    "hooks/session-cleanup.cjs",
  ],
  registration: ["hooks/hooks.json", "hooks/run_hook.cmd", "hooks/run_hook.sh"],
  guidance: CODE_STYLE_QA_SKILL_PATHS,
});
const CODE_STYLE_CURSOR_GROUPS = canonicalGroups({ guidance: CODE_STYLE_SKILL_PATHS });

export const CAPABILITY_PROJECTION_PATHS: Readonly<
  Record<CapabilityId, Readonly<Record<Product, Readonly<Record<CanonicalAssetGroup, readonly string[]>>>>>
> = Object.freeze({
  "kcoderag-navigation": Object.freeze({ qa: NAVIGATION_QA_GROUPS, cursor: NAVIGATION_CURSOR_GROUPS }),
  "code-style-nudge": Object.freeze({ qa: CODE_STYLE_QA_GROUPS, cursor: CODE_STYLE_CURSOR_GROUPS }),
});

function selectedCapabilityIds(values: readonly string[] | undefined): readonly CapabilityId[] {
  if (values === undefined) return BUILT_IN_CAPABILITY_IDS;
  if (!Array.isArray(values) || values.length === 0) throw new GenerationError("empty_capability_selection");
  const selected = new Set<CapabilityId>();
  for (const value of values) {
    if (!(BUILT_IN_CAPABILITY_IDS as readonly string[]).includes(value)) {
      throw new GenerationError("unknown_capability");
    }
    selected.add(value as CapabilityId);
  }
  return Object.freeze(BUILT_IN_CAPABILITY_IDS.filter((id) => selected.has(id)));
}

function canonicalPathsFor(
  product: Product,
  group: CanonicalAssetGroup,
  capabilities: readonly CapabilityId[],
): readonly string[] {
  return sortedUnion(...capabilities.map((id) => CAPABILITY_PROJECTION_PATHS[id][product][group]));
}

function pathsFor(
  product: Product,
  group: AssetGroup,
  capabilities: readonly CapabilityId[],
): readonly string[] {
  if (group === "runtime" || group === "registration" || group === "metadata" || group === "guidance"
    || group === "docs" || group === "all") {
    return canonicalPathsFor(product, group, capabilities);
  }
  if (group === "runtime-cjs") return canonicalPathsFor(product, "runtime", capabilities);
  if (group === "runtime-launcher") {
    return canonicalPathsFor(product, "registration", capabilities).filter((item) => /\.(?:cmd|sh)$/u.test(item));
  }
  if (group === "runtime-registration") {
    return canonicalPathsFor(product, "registration", capabilities).filter((item) => !/\.(?:cmd|sh)$/u.test(item));
  }
  if (group === "runtime-code") {
    return sortedUnion(
      canonicalPathsFor(product, "runtime", capabilities),
      pathsFor(product, "runtime-launcher", capabilities),
    );
  }
  if (group === "metadata-config") return canonicalPathsFor(product, "metadata", capabilities);
  if (group === "metadata-guidance") return canonicalPathsFor(product, "guidance", capabilities);
  if (group === "version") {
    if (!capabilities.includes("kcoderag-navigation")) return EMPTY_GROUP;
    return product === "qa" ? QA_VERSION : CURSOR_VERSION;
  }
  throw new GenerationError("unknown_group");
}

function productGroups(product: Product): Readonly<Record<AssetGroup, readonly string[]>> {
  const capabilities = BUILT_IN_CAPABILITY_IDS;
  return Object.freeze({
    "runtime-cjs": pathsFor(product, "runtime-cjs", capabilities),
    "runtime-launcher": pathsFor(product, "runtime-launcher", capabilities),
    "runtime-registration": pathsFor(product, "runtime-registration", capabilities),
    "runtime-code": pathsFor(product, "runtime-code", capabilities),
    runtime: pathsFor(product, "runtime", capabilities),
    registration: pathsFor(product, "registration", capabilities),
    "metadata-config": pathsFor(product, "metadata-config", capabilities),
    "metadata-guidance": pathsFor(product, "metadata-guidance", capabilities),
    metadata: pathsFor(product, "metadata", capabilities),
    guidance: pathsFor(product, "guidance", capabilities),
    docs: pathsFor(product, "docs", capabilities),
    version: pathsFor(product, "version", capabilities),
    all: pathsFor(product, "all", capabilities),
  });
}

export const ASSET_GROUP_PATHS: Readonly<Record<Product, Readonly<Record<AssetGroup, readonly string[]>>>> =
  Object.freeze({ qa: productGroups("qa"), cursor: productGroups("cursor") });

export const PHASE_05_ASSET_ROUTES: readonly AssetSourceRoute[] = Object.freeze([
  Object.freeze({ product: "cursor", output: "rules/kcoderag-navigation.mdc", canonicalSource: "plugin-src/cursor/rules/kcoderag-navigation.mdc", renderSource: "plugin-src/cursor/rules/kcoderag-navigation.mdc", kind: "normalized-copy" }),
  Object.freeze({ product: "cursor", output: "skills/kcoderag/SKILL.md", canonicalSource: "plugin-src/skills/kcoderag/SKILL.md", renderSource: "plugin-src/skills/kcoderag/SKILL.md", kind: "normalized-copy" }),
  Object.freeze({ product: "cursor", output: "skills/kcoderag-manage/SKILL.md", canonicalSource: "plugin-src/skills/kcoderag-manage/SKILL.md", renderSource: "plugin-src/skills/kcoderag-manage/SKILL.md", kind: "normalized-copy" }),
  Object.freeze({ product: "cursor", output: "skills/kcoderag-feedback/SKILL.md", canonicalSource: "plugin-src/skills/kcoderag-feedback/SKILL.md", renderSource: "plugin-src/skills/kcoderag-feedback/SKILL.md", kind: "normalized-copy" }),
  Object.freeze({ product: "qa", output: "hooks/code-style-nudge.cjs", canonicalSource: "src/hooks/code-style-nudge.cts", renderSource: "dist/hooks/code-style-nudge.cjs", kind: "compiled-copy" }),
  Object.freeze({ product: "qa", output: "hooks/feedback-nudge.cjs", canonicalSource: "src/hooks/feedback-nudge.cts", renderSource: "dist/hooks/feedback-nudge.cjs", kind: "compiled-copy" }),
  Object.freeze({ product: "qa", output: "hooks/grep-nudge.cjs", canonicalSource: "src/hooks/grep-nudge.cts", renderSource: "dist/hooks/grep-nudge.cjs", kind: "compiled-copy" }),
  Object.freeze({ product: "qa", output: "hooks/hooks.json", canonicalSource: "plugin-src/hooks/hooks.json", renderSource: "plugin-src/hooks/hooks.json", kind: "hook-registration" }),
  Object.freeze({ product: "qa", output: "hooks/mcp-call-marker.cjs", canonicalSource: "src/hooks/mcp-call-marker.cts", renderSource: "dist/hooks/mcp-call-marker.cjs", kind: "compiled-copy" }),
  Object.freeze({ product: "qa", output: "hooks/once-marker.cjs", canonicalSource: "src/hooks/once-marker.cts", renderSource: "dist/hooks/once-marker.cjs", kind: "compiled-copy" }),
  Object.freeze({ product: "qa", output: "hooks/pre-tool-dispatcher.cjs", canonicalSource: "src/hooks/pre-tool-dispatcher.cts", renderSource: "dist/hooks/pre-tool-dispatcher.cjs", kind: "compiled-copy" }),
  Object.freeze({ product: "qa", output: "hooks/session-cleanup.cjs", canonicalSource: "src/hooks/session-cleanup.cts", renderSource: "dist/hooks/session-cleanup.cjs", kind: "compiled-copy" }),
  Object.freeze({ product: "qa", output: "hooks/update-check.cjs", canonicalSource: "src/hooks/update-check.cts", renderSource: "dist/hooks/update-check.cjs", kind: "compiled-copy" }),
  Object.freeze({ product: "qa", output: "opencode/kcoderag-nav.js", canonicalSource: "plugin-src/opencode/kcoderag-nav.js", renderSource: "plugin-src/opencode/kcoderag-nav.js", kind: "normalized-copy" }),
  Object.freeze({ product: "qa", output: "skills/kcoderag/SKILL.md", canonicalSource: "plugin-src/skills/kcoderag/SKILL.md", renderSource: "plugin-src/skills/kcoderag/SKILL.md", kind: "normalized-copy" }),
  Object.freeze({ product: "qa", output: "skills/kcoderag/agents/openai.yaml", canonicalSource: "plugin-src/skills/kcoderag/agents/openai.yaml", renderSource: "plugin-src/skills/kcoderag/agents/openai.yaml", kind: "normalized-copy" }),
  Object.freeze({ product: "qa", output: "skills/kcoderag-manage/SKILL.md", canonicalSource: "plugin-src/skills/kcoderag-manage/SKILL.md", renderSource: "plugin-src/skills/kcoderag-manage/SKILL.md", kind: "normalized-copy" }),
  Object.freeze({ product: "qa", output: "skills/kcoderag-manage/agents/openai.yaml", canonicalSource: "plugin-src/skills/kcoderag-manage/agents/openai.yaml", renderSource: "plugin-src/skills/kcoderag-manage/agents/openai.yaml", kind: "normalized-copy" }),
  Object.freeze({ product: "qa", output: "skills/kcoderag-feedback/SKILL.md", canonicalSource: "plugin-src/skills/kcoderag-feedback/SKILL.md", renderSource: "plugin-src/skills/kcoderag-feedback/SKILL.md", kind: "normalized-copy" }),
  Object.freeze({ product: "qa", output: "skills/kcoderag-feedback/agents/openai.yaml", canonicalSource: "plugin-src/skills/kcoderag-feedback/agents/openai.yaml", renderSource: "plugin-src/skills/kcoderag-feedback/agents/openai.yaml", kind: "normalized-copy" }),
]);

const PHASE_05_ROUTE_BY_OUTPUT: ReadonlyMap<string, AssetSourceRoute> = new Map(
  PHASE_05_ASSET_ROUTES.map((route) => [`${route.product}/${route.output}`, route]),
);

function phase05AssetRoute(product: Product, output: string): AssetSourceRoute | undefined {
  return PHASE_05_ROUTE_BY_OUTPUT.get(`${product}/${output}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProduct(value: unknown): value is Product {
  return typeof value === "string" && (PRODUCTS as readonly string[]).includes(value);
}

function isAssetGroup(value: unknown): value is AssetGroup {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ASSET_GROUP_PATHS.qa, value);
}

function validateRelativePath(relativePath: string): string {
  if (
    relativePath.length === 0
    || relativePath.includes("\\")
    || relativePath.includes("\0")
    || path.posix.isAbsolute(relativePath)
    || relativePath.split("/").some((part) => part === "" || part === "." || part === "..")
    || path.posix.normalize(relativePath) !== relativePath
  ) {
    throw new GenerationError("path_escape", ".");
  }
  return relativePath;
}

function insideRoot(root: string, absolutePath: string): boolean {
  const relative = path.relative(root, absolutePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sourceFile(root: string, relativePath: string): string {
  const safePath = validateRelativePath(relativePath);
  const candidate = path.resolve(root, ...safePath.split("/"));
  if (!insideRoot(root, candidate)) throw new GenerationError("path_escape", ".");
  try {
    const real = fs.realpathSync(candidate);
    if (!insideRoot(root, real)) throw new GenerationError("path_escape", ".");
    const metadata = fs.statSync(real);
    if (!metadata.isFile()) throw new GenerationError("invalid_source", safePath);
    return real;
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    throw new GenerationError("missing_input", safePath);
  }
}

function readBytes(root: string, relativePath: string): Buffer {
  try {
    return fs.readFileSync(sourceFile(root, relativePath));
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    throw new GenerationError("unreadable_input", validateRelativePath(relativePath));
  }
}

function readText(root: string, relativePath: string): string {
  const bytes = readBytes(root, relativePath);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new GenerationError("invalid_text", validateRelativePath(relativePath));
  }
  return text;
}

function parseJsonBytes(bytes: Buffer, safePath: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new GenerationError("invalid_json", safePath);
  }
}

function readJson(root: string, relativePath: string): unknown {
  return parseJsonBytes(readBytes(root, relativePath), validateRelativePath(relativePath));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareCodeUnits)
      .map((key) => [key, sortJson(value[key])]),
  );
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(sortJson(value), null, 2)}\n`, "utf8");
}

function normalizedText(root: string, relativePath: string): Buffer {
  const text = readText(root, relativePath).replace(/\r\n?/gu, "\n").replace(/\n*$/u, "");
  return Buffer.from(`${text}\n`, "utf8");
}

function renderTemplate(
  root: string,
  relativePath: string,
  allowedTokens: readonly string[],
  replacements: Readonly<Record<string, string>>,
): Buffer {
  let text = readText(root, relativePath).replace(/\r\n?/gu, "\n");
  const allowed = new Set(allowedTokens);
  const seen = [...text.matchAll(TOKEN_RE)].map((match) => match[1] ?? "");
  if (seen.some((token) => !allowed.has(token) || replacements[token] === undefined)) {
    throw new GenerationError("unknown_template_token", relativePath);
  }
  for (const token of seen) text = text.replaceAll(`{{${token}}}`, replacements[token] ?? "");
  if (ANY_TOKEN_RE.test(text)) throw new GenerationError("unknown_template_token", relativePath);
  return Buffer.from(`${text.replace(/\n*$/u, "")}\n`, "utf8");
}

function loadVersion(sourceRoot: string): string {
  const document = readJson(sourceRoot, "package.json");
  if (!isRecord(document) || document.name !== "kcoderag-nav" || typeof document.version !== "string") {
    throw new GenerationError("invalid_package", "package.json");
  }
  if (!VERSION_RE.test(document.version)) throw new GenerationError("invalid_version", "package.json");
  return document.version;
}

const ENVIRONMENT_FIELDS = Object.freeze([
  "agent_tool_prefix",
  "brand_color",
  "claude_description",
  "display_name",
  "id",
  "long_description",
  "manifest_description",
  "marketplace_description",
  "mcp_source",
  "permission_namespace",
  "plugin_name",
  "server_name",
  "short_description",
] as const);

function loadEnvironments(sourceRoot: string): Readonly<Record<EnvironmentId, EnvironmentMetadata>> {
  const document = readJson(sourceRoot, "plugin-src/environments.json");
  if (
    !isRecord(document)
    || Object.keys(document).join("") !== "environments"
    || !Array.isArray(document.environments)
    || document.environments.length !== 1
  ) {
    throw new GenerationError("invalid_metadata", "plugin-src/environments.json");
  }
  const result = {} as Record<EnvironmentId, EnvironmentMetadata>;
  for (const raw of document.environments) {
    if (!isRecord(raw) || Object.keys(raw).sort().join("\0") !== [...ENVIRONMENT_FIELDS].sort().join("\0")) {
      throw new GenerationError("invalid_metadata", "plugin-src/environments.json");
    }
    if (ENVIRONMENT_FIELDS.some((field) => typeof raw[field] !== "string" || raw[field].length === 0)) {
      throw new GenerationError("invalid_metadata", "plugin-src/environments.json");
    }
    const metadata = raw as unknown as EnvironmentMetadata;
    const expectedId = "qa";
    const expectedName = `kcoderag-${expectedId}`;
    const expectedPrefix = `mcp__plugin_${expectedName}_${expectedName}__`;
    if (
      metadata.id !== expectedId
      || metadata.plugin_name !== expectedName
      || metadata.server_name !== expectedName
      || metadata.agent_tool_prefix !== expectedPrefix
      || metadata.permission_namespace !== `${expectedPrefix}*`
    ) {
      throw new GenerationError("environment_mismatch", "plugin-src/environments.json");
    }
    validateRelativePath(metadata.mcp_source);
    result[expectedId] = metadata;
  }
  return Object.freeze(result);
}

function loadInputs(sourceRoot: string): LoadedInputs {
  const resolved = fs.realpathSync(path.resolve(sourceRoot));
  const version = loadVersion(resolved);
  return Object.freeze({ sourceRoot: resolved, version, environments: loadEnvironments(resolved) });
}

function loadRoutingPolicy(sourceRoot: string): string {
  const document = readJson(sourceRoot, "plugin-src/routing.json");
  if (
    !isRecord(document)
    || Object.keys(document).sort(compareCodeUnits).join("\0") !== "environment\0rule\0version"
    || document.version !== 3
    || document.environment !== "qa"
    || !isRecord(document.rule)
    || Object.keys(document.rule).sort(compareCodeUnits).join("\0") !== "intent\0routes"
    || document.rule.intent !== "default"
    || !Array.isArray(document.rule.routes)
    || document.rule.routes.join("") !== "qa"
  ) {
    throw new GenerationError("invalid_routing", "plugin-src/routing.json");
  }
  return [
    "## QA routing",
    "",
    "Use the installed KCodeRag QA service for graph lookup. If QA is unreachable, report",
    "that state; local search remains an explicit fallback when the index is unavailable",
    "or stale.",
  ].join("\n");
}

interface ConnectionDetails {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

function isHeaderMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function connectionDetails(inputs: LoadedInputs, environment: EnvironmentMetadata): ConnectionDetails {
  const bytes = readBytes(inputs.sourceRoot, environment.mcp_source);
  const document = parseJsonBytes(bytes, environment.mcp_source);
  if (!isRecord(document) || !isRecord(document.mcpServers)) {
    throw new GenerationError("environment_mismatch", environment.mcp_source);
  }
  const keys = Object.keys(document.mcpServers);
  const entry = document.mcpServers[environment.server_name];
  if (keys.length !== 1 || keys[0] !== environment.server_name || !isRecord(entry) || typeof entry.url !== "string") {
    throw new GenerationError("environment_mismatch", environment.mcp_source);
  }
  const headers = entry.headers;
  const httpHeaders = entry.http_headers;
  if (
    (headers !== undefined && !isHeaderMap(headers))
    || (httpHeaders !== undefined && !isHeaderMap(httpHeaders))
    || (headers === undefined && httpHeaders === undefined)
    || (headers !== undefined && httpHeaders !== undefined && !canonicalJson(headers).equals(canonicalJson(httpHeaders)))
  ) {
    throw new GenerationError("environment_mismatch", environment.mcp_source);
  }
  const rawHeaders = httpHeaders ?? headers;
  return Object.freeze({ url: entry.url, headers: Object.freeze({ ...rawHeaders }) });
}

function codexManifest(environment: EnvironmentMetadata, version: string): unknown {
  return {
    name: environment.plugin_name,
    version,
    description: environment.manifest_description,
    author: { name: "KCodeRag" },
    keywords: ["code-navigation", "knowledge-graph", "mcp"],
    skills: "./skills/",
    mcpServers: "./.codex.mcp.json",
    interface: {
      displayName: environment.display_name,
      shortDescription: environment.short_description,
      longDescription: environment.long_description,
      developerName: "KCodeRag",
      category: "Developer Tools",
      capabilities: ["Read"],
      defaultPrompt: ["Find a symbol and explain its callers and callees"],
      brandColor: environment.brand_color,
    },
  };
}

function claudeManifest(environment: EnvironmentMetadata, version: string): unknown {
  return {
    name: environment.plugin_name,
    description: environment.claude_description,
    version,
    author: { name: "KCodeRag" },
  };
}

function cursorDefaults(inputs: LoadedInputs): { readonly url: string; readonly bearer: string } {
  const details = connectionDetails(inputs, inputs.environments.qa);
  const authorization = Object.entries(details.headers).find(([name]) => name.toLowerCase() === "authorization")?.[1];
  const match = typeof authorization === "string" ? /^Bearer\s+(.+)$/u.exec(authorization) : null;
  if (match?.[1] === undefined || match[1].length === 0) {
    throw new GenerationError("environment_mismatch", inputs.environments.qa.mcp_source);
  }
  return Object.freeze({ url: details.url, bearer: match[1] });
}

function cursorManifest(inputs: LoadedInputs): unknown {
  const defaults = cursorDefaults(inputs);
  return {
    name: "kcoderag-nav",
    version: inputs.version,
    description: "Graph-first structural code navigation with the KCodeRag QA service.",
    author: { name: "KCodeRag" },
    keywords: ["code-navigation", "knowledge-graph", "mcp"],
    skills: "./skills/",
    rules: "./rules/",
    mcpServers: "./mcp.json",
    variables: {
      type: "object",
      properties: {
        KCODERAG_MCP_URL: {
          type: "string",
          title: "KCodeRag MCP URL",
          description: "Internal KCodeRag QA MCP endpoint.",
          default: defaults.url,
        },
        KCODERAG_BEARER_TOKEN: {
          type: "string",
          title: "KCodeRag bearer token",
          description: "Internal KCodeRag QA bearer credential.",
          default: defaults.bearer,
        },
      },
      required: ["KCODERAG_MCP_URL", "KCODERAG_BEARER_TOKEN"],
    },
  };
}

function cursorMcp(): unknown {
  return {
    mcpServers: {
      kcoderag: {
        type: "http",
        url: "${KCODERAG_MCP_URL}",
        headers: { Authorization: "Bearer ${KCODERAG_BEARER_TOKEN}" },
      },
    },
  };
}

function qaReplacements(inputs: LoadedInputs, environment: EnvironmentMetadata): Readonly<Record<string, string>> {
  return Object.freeze({
    environment: environment.id,
    environment_upper: environment.id.toUpperCase(),
    plugin_name: environment.plugin_name,
    display_name: environment.display_name,
    tool_prefix: environment.agent_tool_prefix,
    routing_policy: loadRoutingPolicy(inputs.sourceRoot),
    plugin_version: inputs.version,
  });
}

function renderQaAsset(
  inputs: LoadedInputs,
  environment: EnvironmentMetadata,
  relativePath: string,
  capabilities: readonly CapabilityId[],
): Buffer {
  const phase05Route = phase05AssetRoute("qa", relativePath);
  if (phase05Route?.kind === "compiled-copy") {
    return readBytes(inputs.sourceRoot, phase05Route.renderSource);
  }
  if (phase05Route?.kind === "normalized-copy") {
    return normalizedText(inputs.sourceRoot, phase05Route.renderSource);
  }
  if (relativePath === "hooks/update-notice.cjs") return readBytes(inputs.sourceRoot, "dist/hooks/update-notice.cjs");
  if (relativePath === "hooks/update-worker.cjs") return readBytes(inputs.sourceRoot, "dist/hooks/update-worker.cjs");
  if (relativePath === "hooks/run_hook.cmd") return normalizedText(inputs.sourceRoot, "plugin-src/hooks/run_hook.cmd");
  if (relativePath === "hooks/run_hook.sh") return normalizedText(inputs.sourceRoot, "plugin-src/hooks/run_hook.sh");
  if (relativePath === "hooks/run_marker.cmd") return normalizedText(inputs.sourceRoot, "plugin-src/hooks/run_marker.cmd");
  if (relativePath === "hooks/run_marker.sh") return normalizedText(inputs.sourceRoot, "plugin-src/hooks/run_marker.sh");
  if (phase05Route?.kind === "hook-registration") {
    const commands = renderProjectHookCommands("claude");
    const markerCommands = renderProjectHookCommands("claude", "mcp-call-marker");
    const registration = readJson(inputs.sourceRoot, "plugin-src/hooks/hooks.json");
    const renderCommand = (value: unknown): unknown => {
      if (value === "{{project_hook_command_posix}}") return commands.command;
      if (value === "{{project_hook_command_windows}}") return commands.commandWindows;
      if (value === "{{project_marker_command_posix}}") return markerCommands.command;
      if (value === "{{project_marker_command_windows}}") return markerCommands.commandWindows;
      if (Array.isArray(value)) return value.map(renderCommand);
      if (typeof value === "object" && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, renderCommand(nested)]));
      }
      return value;
    };
    const rendered = renderCommand(registration);
    if (!isRecord(rendered) || !isRecord(rendered.hooks)) {
      throw new GenerationError("invalid_metadata", "plugin-src/hooks/hooks.json");
    }
    const hooks = { ...rendered.hooks };
    if (!capabilities.includes("kcoderag-navigation")) delete hooks.PostToolUse;
    return canonicalJson({ ...rendered, hooks });
  }
  if (relativePath === ".mcp.json") return readBytes(inputs.sourceRoot, environment.mcp_source);
  if (relativePath === ".codex.mcp.json") {
    const connection = connectionDetails(inputs, environment);
    return canonicalJson({
      [environment.server_name]: { url: connection.url, http_headers: connection.headers },
    });
  }
  if (relativePath === ".codex-plugin/plugin.json") return canonicalJson(codexManifest(environment, inputs.version));
  if (relativePath === ".claude-plugin/plugin.json") return canonicalJson(claudeManifest(environment, inputs.version));
  const replacements = qaReplacements(inputs, environment);
  if (relativePath === "agents/kcode-explorer.md") {
    return renderTemplate(
      inputs.sourceRoot,
      "plugin-src/agents/kcode-explorer.md.tmpl",
      ["display_name", "tool_prefix", "routing_policy"],
      replacements,
    );
  }
  if (phase05Route?.kind === "template") {
    return renderTemplate(
      inputs.sourceRoot,
      "plugin-src/skills/kcoderag/SKILL.md",
      ["display_name", "routing_policy"],
      replacements,
    );
  }
  if (phase05Route?.kind === "normalized-copy") {
    return normalizedText(inputs.sourceRoot, phase05Route.renderSource);
  }
  if (relativePath === "skills/kcoderag-code-style/SKILL.md") {
    return readBytes(inputs.sourceRoot, "plugin-src/capabilities/code-style-nudge/skill/SKILL.md");
  }
  if (relativePath === "skills/kcoderag-code-style/agents/openai.yaml") {
    return readBytes(inputs.sourceRoot, "plugin-src/capabilities/code-style-nudge/skill/agents/openai.yaml");
  }
  if (relativePath.startsWith("skills/kcoderag-code-style/references/")) {
    const reference = relativePath.slice("skills/kcoderag-code-style/".length);
    return readBytes(inputs.sourceRoot, `plugin-src/capabilities/code-style-nudge/skill/${reference}`);
  }
  if (relativePath === "README.md") {
    return renderTemplate(
      inputs.sourceRoot,
      "plugin-src/README.md.tmpl",
      ["environment", "environment_upper", "plugin_name", "display_name", "routing_policy", "plugin_version"],
      replacements,
    );
  }
  throw new GenerationError("invalid_asset_map", relativePath);
}

function renderCursorAsset(inputs: LoadedInputs, relativePath: string): Buffer {
  if (relativePath === ".cursor-plugin/plugin.json") return canonicalJson(cursorManifest(inputs));
  if (relativePath === "mcp.json") return canonicalJson(cursorMcp());
  const phase05Route = phase05AssetRoute("cursor", relativePath);
  if (phase05Route?.kind === "normalized-copy") {
    return normalizedText(inputs.sourceRoot, phase05Route.renderSource);
  }
  if (phase05Route?.kind === "template") {
    return renderTemplate(
      inputs.sourceRoot,
      "plugin-src/skills/kcoderag/SKILL.md",
      ["display_name", "routing_policy"],
      {
        display_name: "KCodeRag QA",
        routing_policy: [
          "## QA routing",
          "",
          "This Cursor integration exposes only the KCodeRag QA service.",
          "Use local search when QA is unavailable or stale.",
        ].join("\n"),
      },
    );
  }
  if (relativePath === "skills/kcoderag-code-style/SKILL.md") {
    return readBytes(inputs.sourceRoot, "plugin-src/capabilities/code-style-nudge/skill/SKILL.md");
  }
  if (relativePath.startsWith("skills/kcoderag-code-style/references/")) {
    const reference = relativePath.slice("skills/kcoderag-code-style/".length);
    return readBytes(inputs.sourceRoot, `plugin-src/capabilities/code-style-nudge/skill/${reference}`);
  }
  if (relativePath === "README.md") {
    return renderTemplate(
      inputs.sourceRoot,
      "plugin-src/cursor/README.md.tmpl",
      ["plugin_version"],
      { plugin_version: inputs.version },
    );
  }
  throw new GenerationError("invalid_asset_map", relativePath);
}

function selectedProducts(
  product: ProductSelection,
  group: AssetGroup,
  capabilities: readonly CapabilityId[],
): readonly Product[] {
  if (product !== "all") {
    if (pathsFor(product, group, capabilities).length === 0) throw new GenerationError("incompatible_group");
    return Object.freeze([product]);
  }
  const applicable = PRODUCTS.filter((candidate) => pathsFor(candidate, group, capabilities).length > 0);
  if (applicable.length === 0) throw new GenerationError("incompatible_group");
  return Object.freeze(applicable);
}

function validateOptions(options: GeneratorOptions): {
  readonly product: ProductSelection;
  readonly group: AssetGroup;
  readonly capabilities: readonly CapabilityId[];
} {
  const product = options.package as unknown;
  const group = options.group as unknown;
  if (product === "dev") throw new GenerationError("retired_product", RETIRED_DEV_DIRECTORY);
  if (product !== "all" && !isProduct(product)) throw new GenerationError("unknown_package");
  if (!isAssetGroup(group)) throw new GenerationError("unknown_group");
  const capabilities = selectedCapabilityIds(options.capabilities);
  selectedProducts(product, group, capabilities);
  return { product, group, capabilities };
}

function renderSelected(options: GeneratorOptions): {
  readonly root: string;
  readonly version: string;
  readonly outputs: ReadonlyMap<string, Buffer>;
  readonly product: ProductSelection;
  readonly group: AssetGroup;
  readonly capabilities: readonly CapabilityId[];
} {
  const selection = validateOptions(options);
  const defaultRoot = path.resolve(__dirname, "..", "..");
  const sourceRoot = options.sourceRoot ?? defaultRoot;
  const outputRootInput = options.outputRoot ?? sourceRoot;
  let outputRoot: string;
  try {
    outputRoot = fs.realpathSync(path.resolve(outputRootInput));
  } catch {
    throw new GenerationError("invalid_output_root", ".");
  }
  const inputs = loadInputs(sourceRoot);
  const rendered = new Map<string, Buffer>();
  for (const product of selectedProducts(selection.product, selection.group, selection.capabilities)) {
    const packageDirectory = PRODUCT_DIRECTORIES[product];
    for (const assetPath of pathsFor(product, selection.group, selection.capabilities)) {
      const outputPath = validateRelativePath(`${packageDirectory}/${assetPath}`);
      const bytes = product === "cursor"
        ? renderCursorAsset(inputs, assetPath)
        : renderQaAsset(inputs, inputs.environments.qa, assetPath, selection.capabilities);
      rendered.set(outputPath, bytes);
    }
  }
  return {
    root: outputRoot,
    version: inputs.version,
    outputs: new Map([...rendered].sort(([left], [right]) => compareCodeUnits(left, right))),
    product: selection.product,
    group: selection.group,
    capabilities: selection.capabilities,
  };
}

function outputFile(root: string, relativePath: string): string {
  const safePath = validateRelativePath(relativePath);
  const absolute = path.resolve(root, ...safePath.split("/"));
  if (!insideRoot(root, absolute)) throw new GenerationError("path_escape", ".");
  let current = root;
  for (const part of safePath.split("/").slice(0, -1)) {
    current = path.join(current, part);
    try {
      const metadata = fs.lstatSync(current);
      if (metadata.isSymbolicLink()) throw new GenerationError("path_escape", safePath);
      if (!metadata.isDirectory()) throw new GenerationError("invalid_output", safePath);
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new GenerationError("unreadable_output", safePath);
      break;
    }
  }
  try {
    const metadata = fs.lstatSync(absolute);
    if (metadata.isSymbolicLink()) throw new GenerationError("path_escape", safePath);
    if (!metadata.isFile()) throw new GenerationError("invalid_output", safePath);
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new GenerationError("unreadable_output", safePath);
  }
  return absolute;
}

function inspectChanges(root: string, outputs: ReadonlyMap<string, Buffer>): {
  readonly changedPaths: readonly string[];
  readonly diagnostics: readonly string[];
} {
  const changed: string[] = [];
  const diagnostics: string[] = [];
  for (const [relativePath, expected] of outputs) {
    const absolute = outputFile(root, relativePath);
    try {
      const current = fs.readFileSync(absolute);
      if (!current.equals(expected)) {
        changed.push(relativePath);
        diagnostics.push(`drift: ${relativePath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        changed.push(relativePath);
        diagnostics.push(`missing: ${relativePath}`);
      } else {
        throw new GenerationError("unreadable_output", relativePath);
      }
    }
  }
  return Object.freeze({ changedPaths: Object.freeze(changed), diagnostics: Object.freeze(diagnostics) });
}

function inspectRetiredDevOutput(root: string): {
  readonly changedPaths: readonly string[];
  readonly diagnostics: readonly string[];
} {
  const absolute = path.resolve(root, RETIRED_DEV_DIRECTORY);
  if (!insideRoot(root, absolute)) throw new GenerationError("path_escape", ".");
  try {
    fs.lstatSync(absolute);
    return Object.freeze({
      changedPaths: Object.freeze([RETIRED_DEV_DIRECTORY]),
      diagnostics: Object.freeze([`retired_product: ${RETIRED_DEV_DIRECTORY}`]),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return Object.freeze({ changedPaths: Object.freeze([]), diagnostics: Object.freeze([]) });
    }
    throw new GenerationError("unreadable_output", RETIRED_DEV_DIRECTORY);
  }
}

function walkOutputFiles(root: string, relativeDirectory: string): readonly string[] {
  const absoluteDirectory = path.resolve(root, ...relativeDirectory.split("/"));
  if (!insideRoot(root, absoluteDirectory)) throw new GenerationError("path_escape", ".");
  try {
    const metadata = fs.lstatSync(absoluteDirectory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return Object.freeze([relativeDirectory]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]);
    throw new GenerationError("unreadable_output", relativeDirectory);
  }

  const visit = (directory: string, prefix: string): string[] => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      throw new GenerationError("unreadable_output", prefix);
    }
    return entries.flatMap((entry) => {
      const relativePath = `${prefix}/${entry.name}`;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        return visit(path.join(directory, entry.name), relativePath);
      }
      return [relativePath];
    });
  };
  return Object.freeze(visit(absoluteDirectory, relativeDirectory).sort(compareCodeUnits));
}

function inspectOrphanOutputs(
  root: string,
  rendered: ReturnType<typeof renderSelected>,
): { readonly changedPaths: readonly string[]; readonly diagnostics: readonly string[] } {
  if (rendered.group !== "all") {
    return Object.freeze({ changedPaths: Object.freeze([]), diagnostics: Object.freeze([]) });
  }
  const expected = new Set(rendered.outputs.keys());
  const changedPaths = PRODUCTS
    .filter((product) => [...expected].some((entry) => entry.startsWith(`${PRODUCT_DIRECTORIES[product]}/`)))
    .flatMap((product) => walkOutputFiles(root, PRODUCT_DIRECTORIES[product]))
    .filter((relativePath) => !expected.has(relativePath))
    .sort(compareCodeUnits);
  return Object.freeze({
    changedPaths: Object.freeze(changedPaths),
    diagnostics: Object.freeze(changedPaths.map((relativePath) => `orphan: ${relativePath}`)),
  });
}

function ensureParents(root: string, relativePath: string, createdDirectories: string[]): void {
  let current = root;
  for (const part of relativePath.split("/").slice(0, -1)) {
    current = path.join(current, part);
    try {
      const metadata = fs.lstatSync(current);
      if (metadata.isSymbolicLink()) throw new GenerationError("path_escape", relativePath);
      if (!metadata.isDirectory()) throw new GenerationError("invalid_output", relativePath);
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new GenerationError("unreadable_output", relativePath);
      }
      fs.mkdirSync(current, { mode: 0o700 });
      createdDirectories.push(current);
    }
  }
}

function stageFile(destination: string, bytes: Buffer): string {
  const temporary = path.join(path.dirname(destination), `.kcoderag-generate-${crypto.randomUUID()}`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    return temporary;
  } catch {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* cleanup remains best effort */ }
    }
    try { fs.rmSync(temporary, { force: true }); } catch { /* no destination has changed yet */ }
    throw new GenerationError("transaction_failed");
  }
}

function originalFile(destination: string): OriginalFile {
  try {
    const metadata = fs.statSync(destination);
    return Object.freeze({
      bytes: fs.readFileSync(destination),
      mode: metadata.mode,
      atimeMs: metadata.atimeMs,
      mtimeMs: metadata.mtimeMs,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze({});
    throw new GenerationError("unreadable_output");
  }
}

function restoreFile(destination: string, original: OriginalFile): void {
  if (original.bytes === undefined) {
    fs.rmSync(destination, { force: true });
    return;
  }
  const temporary = stageFile(destination, original.bytes);
  fs.renameSync(temporary, destination);
  if (original.mode !== undefined) fs.chmodSync(destination, original.mode);
  if (original.atimeMs !== undefined && original.mtimeMs !== undefined) {
    fs.utimesSync(destination, original.atimeMs / 1_000, original.mtimeMs / 1_000);
  }
}

function pruneDirectories(createdDirectories: readonly string[]): void {
  for (const directory of [...createdDirectories].reverse()) {
    try { fs.rmdirSync(directory); } catch { /* keep nonempty/user-created directories */ }
  }
}

function commitChanges(
  root: string,
  outputs: ReadonlyMap<string, Buffer>,
  changedPaths: readonly string[],
  io: GeneratorIo | undefined,
): readonly string[] {
  const createdDirectories: string[] = [];
  const staged = new Map<string, string>();
  const originals = new Map<string, OriginalFile>();
  const committed: string[] = [];
  try {
    for (const relativePath of changedPaths) {
      const destination = outputFile(root, relativePath);
      ensureParents(root, relativePath, createdDirectories);
      originals.set(relativePath, originalFile(destination));
      const bytes = outputs.get(relativePath);
      if (bytes === undefined) throw new GenerationError("invalid_asset_map", relativePath);
      staged.set(relativePath, stageFile(destination, bytes));
    }
    for (const [index, relativePath] of changedPaths.entries()) {
      io?.beforeCommit?.(relativePath, index);
      const temporary = staged.get(relativePath);
      if (temporary === undefined) throw new Error("missing_staged_file");
      fs.renameSync(temporary, outputFile(root, relativePath));
      staged.delete(relativePath);
      committed.push(relativePath);
    }
    return Object.freeze([...committed]);
  } catch (error) {
    let rollbackFailed = false;
    for (const relativePath of [...committed].reverse()) {
      try {
        restoreFile(outputFile(root, relativePath), originals.get(relativePath) ?? {});
      } catch {
        rollbackFailed = true;
      }
    }
    for (const temporary of staged.values()) {
      try { fs.rmSync(temporary, { force: true }); } catch { rollbackFailed = true; }
    }
    pruneDirectories(createdDirectories);
    if (rollbackFailed) throw new GenerationError("rollback_failed");
    if (error instanceof GenerationError) throw error;
    throw new GenerationError("transaction_failed");
  } finally {
    for (const temporary of staged.values()) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* destination result already decided */ }
    }
  }
}

function result(
  rendered: ReturnType<typeof renderSelected>,
  changedPaths: readonly string[],
  writtenPaths: readonly string[],
  diagnostics: readonly string[],
  ok: boolean,
): GenerationResult {
  return Object.freeze({
    ok,
    package: rendered.product,
    group: rendered.group,
    version: rendered.version,
    capabilities: Object.freeze([...rendered.capabilities]),
    selectedPaths: Object.freeze([...rendered.outputs.keys()]),
    changedPaths: Object.freeze([...changedPaths]),
    writtenPaths: Object.freeze([...writtenPaths]),
    diagnostics: Object.freeze([...diagnostics]),
  });
}

export function checkGenerated(options: GeneratorOptions): GenerationResult {
  const rendered = renderSelected(options);
  const compared = inspectChanges(rendered.root, rendered.outputs);
  const orphans = inspectOrphanOutputs(rendered.root, rendered);
  const retired = rendered.product === "all" && rendered.group === "all"
    ? inspectRetiredDevOutput(rendered.root)
    : { changedPaths: Object.freeze([] as string[]), diagnostics: Object.freeze([] as string[]) };
  const changedPaths = sortedUnion(compared.changedPaths, orphans.changedPaths, retired.changedPaths);
  const diagnostics = sortedUnion(compared.diagnostics, orphans.diagnostics, retired.diagnostics);
  return result(rendered, changedPaths, [], diagnostics, changedPaths.length === 0);
}

export function generatePackage(options: GeneratorOptions): GenerationResult {
  const rendered = renderSelected(options);
  const compared = inspectChanges(rendered.root, rendered.outputs);
  const writtenPaths = commitChanges(rendered.root, rendered.outputs, compared.changedPaths, options.io);
  return result(rendered, compared.changedPaths, writtenPaths, [], true);
}

interface ParsedArguments {
  readonly package: string;
  readonly product: ProductSelection;
  readonly group: string;
  readonly sourceRoot?: string;
  readonly outputRoot?: string;
  readonly capabilities?: readonly string[];
  readonly check: boolean;
}

export interface GeneratorCliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const values = new Map<string, string>();
  const capabilities: string[] = [];
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) throw new GenerationError("unknown_option");
    if (argument === "--check") {
      if (check) throw new GenerationError("duplicate_option");
      check = true;
      continue;
    }
    if (argument === "--capability") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new GenerationError("missing_option_value");
      capabilities.push(value);
      index += 1;
      continue;
    }
    if (!(["--package", "--product", "--group", "--source-root", "--output-root"] as const).includes(
      argument as "--package" | "--product" | "--group" | "--source-root" | "--output-root",
    )) {
      throw new GenerationError("unknown_option");
    }
    if (values.has(argument)) throw new GenerationError("duplicate_option");
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new GenerationError("missing_option_value");
    values.set(argument, value);
    index += 1;
  }
  const selectedPackage = values.get("--package");
  const selectedProduct = values.get("--product") ?? "all";
  const group = values.get("--group");
  if (selectedPackage === undefined) throw new GenerationError("missing_package");
  if (selectedProduct !== "all" && !isProduct(selectedProduct)) {
    throw new GenerationError("unknown_product");
  }
  if (selectedProduct !== "all" && selectedPackage !== "all" && selectedPackage !== selectedProduct) {
    throw new GenerationError("product_scope_conflict");
  }
  if (group === undefined) throw new GenerationError("missing_group");
  const sourceRoot = values.get("--source-root");
  const outputRoot = values.get("--output-root");
  return {
    package: selectedPackage,
    product: selectedProduct,
    group,
    ...(sourceRoot === undefined ? {} : { sourceRoot }),
    ...(outputRoot === undefined ? {} : { outputRoot }),
    ...(capabilities.length === 0 ? {} : { capabilities: Object.freeze([...capabilities]) }),
    check,
  };
}

function defaultCliIo(): GeneratorCliIo {
  return Object.freeze({
    stdout(text: string) { process.stdout.write(text); },
    stderr(text: string) { process.stderr.write(text); },
  });
}

export function runCli(argv: readonly string[] = process.argv.slice(2), io: GeneratorCliIo = defaultCliIo()): number {
  try {
    const parsed = parseArguments(argv);
    const options: GeneratorOptions = {
      package: (parsed.product === "all" ? parsed.package : parsed.product) as ProductSelection,
      group: parsed.group as AssetGroup,
      ...(parsed.sourceRoot === undefined ? {} : { sourceRoot: parsed.sourceRoot }),
      ...(parsed.outputRoot === undefined ? {} : { outputRoot: parsed.outputRoot }),
      ...(parsed.capabilities === undefined
        ? {}
        : { capabilities: parsed.capabilities as readonly CapabilityId[] }),
    };
    const generated = parsed.check ? checkGenerated(options) : generatePackage(options);
    io.stdout(`${JSON.stringify(generated)}\n`);
    return generated.ok ? 0 : 1;
  } catch (error) {
    const safe = error instanceof GenerationError
      ? { ok: false, code: error.code, ...(error.safePath === undefined ? {} : { path: error.safePath }) }
      : { ok: false, code: "generation_failed" };
    io.stderr(`${JSON.stringify(safe)}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = runCli();
