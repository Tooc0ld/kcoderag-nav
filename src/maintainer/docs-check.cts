const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

type DocsPolicy = "user-docs" | "project-instructions" | "planning" | "sibling-guide";

interface Diagnostic {
  readonly code: string;
  readonly path: string;
  readonly line: number;
}

interface CheckOptions {
  readonly repoRoot?: string;
  readonly siblingGuidePath?: string;
}

interface CheckResult {
  readonly checkedFiles: number;
  readonly diagnostics: readonly Diagnostic[];
}

const POLICIES = new Set<DocsPolicy>([
  "user-docs",
  "project-instructions",
  "planning",
  "sibling-guide",
]);
const DOCUMENT_EXTENSIONS = new Set([".md", ".mdc", ".markdown", ".tmpl"]);
const ACTIVE_HEADING = /(?:install|setup|quick\s*start|usage|update|uninstall|接入|安装|使用|更新|卸载)/i;
const HISTORY_HEADING = /(?:history|historical|migration\s+history|changelog|planning|历史|规划|回溯)/i;
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}/i,
];
const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const AUTHORITATIVE_GUIDE = path.resolve(PACKAGE_ROOT, "../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md");

class DocsCheckError extends Error {
  readonly code: string;
  readonly safePath?: string;

  constructor(code: string, safePath?: string) {
    super(code);
    this.name = "DocsCheckError";
    this.code = code;
    if (safePath !== undefined) this.safePath = sanitizePath(safePath);
  }
}

function sanitizePath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (path.isAbsolute(value) || normalized.startsWith("../") || normalized.includes("/../")) {
    return path.basename(value) || ".";
  }
  return normalized || ".";
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => path.resolve(value).replace(/\\/g, "/");
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function assertNoSymlink(absolutePath: string, boundary: string): void {
  const relative = path.relative(boundary, absolutePath);
  const parts = relative === "" ? [] : relative.split(path.sep);
  let current = boundary;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new DocsCheckError("symlink_not_allowed", relative);
    }
  }
}

function collectRepoFiles(rawPaths: readonly string[], repoRoot: string): readonly string[] {
  if (rawPaths.length === 0) throw new DocsCheckError("empty_scope");
  const root = fs.realpathSync(repoRoot);
  const files = new Set<string>();

  const visit = (absolutePath: string): void => {
    assertNoSymlink(absolutePath, root);
    if (!fs.existsSync(absolutePath)) {
      throw new DocsCheckError("path_not_found", path.relative(root, absolutePath));
    }
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new DocsCheckError("symlink_not_allowed");
    if (stat.isFile()) {
      files.add(absolutePath);
      return;
    }
    if (!stat.isDirectory()) throw new DocsCheckError("special_file_not_allowed");
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(absolutePath, entry.name);
      if (entry.isSymbolicLink()) throw new DocsCheckError("symlink_not_allowed", path.relative(root, child));
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.add(child);
      }
    }
  };

  for (const rawPath of rawPaths) {
    if (path.isAbsolute(rawPath) || /^[A-Za-z]:[\\/]/.test(rawPath)) {
      throw new DocsCheckError("absolute_path_not_allowed", rawPath);
    }
    const absolutePath = path.resolve(root, rawPath);
    const relative = path.relative(root, absolutePath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new DocsCheckError("path_escape", rawPath);
    }
    visit(absolutePath);
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function collectSiblingGuide(rawPaths: readonly string[], expectedPath: string): readonly string[] {
  if (rawPaths.length === 0) throw new DocsCheckError("empty_scope");
  if (rawPaths.length !== 1) throw new DocsCheckError("invalid_sibling_scope");
  const candidate = path.resolve(rawPaths[0] ?? "");
  if (!samePath(candidate, expectedPath)) throw new DocsCheckError("invalid_sibling_scope", candidate);
  if (!fs.existsSync(candidate) || !fs.lstatSync(candidate).isFile()) {
    throw new DocsCheckError("path_not_found", path.basename(candidate));
  }
  const parsed = path.parse(candidate);
  assertNoSymlink(candidate, parsed.root);
  return [candidate];
}

function stripHtmlComments(lines: readonly string[]): readonly { text: string; hidden: boolean }[] {
  let inComment = false;
  return lines.map((line) => {
    let text = line;
    let hidden = inComment;
    while (text.length > 0) {
      if (inComment) {
        const end = text.indexOf("-->");
        hidden = true;
        if (end < 0) return { text: "", hidden };
        text = text.slice(end + 3);
        inComment = false;
      } else {
        const start = text.indexOf("<!--");
        if (start < 0) break;
        const end = text.indexOf("-->", start + 4);
        if (end < 0) {
          text = text.slice(0, start);
          inComment = true;
          break;
        }
        text = `${text.slice(0, start)}${text.slice(end + 3)}`;
      }
    }
    return { text, hidden: hidden && text.length === 0 };
  });
}

function addDiagnostic(
  diagnostics: Diagnostic[],
  code: string,
  displayPath: string,
  line: number,
): void {
  if (!diagnostics.some((item) => item.code === code && item.path === displayPath && item.line === line)) {
    diagnostics.push({ code, path: displayPath, line });
  }
}

function localLinkTarget(rawTarget: string): string | undefined {
  const trimmed = rawTarget.trim().replace(/^<|>$/g, "");
  if (trimmed === "" || trimmed.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return undefined;
  }
  const withoutTitle = trimmed.match(/^(\S+)/)?.[1] ?? trimmed;
  const target = withoutTitle.split("#", 1)[0]?.split("?", 1)[0] ?? "";
  if (target === "") return undefined;
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function inspectFile(
  absolutePath: string,
  displayPath: string,
  policy: DocsPolicy,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const rawLines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);
  const lines = stripHtmlComments(rawLines);
  let inFence = false;
  let activeSection = false;
  let historySection = false;

  if (policy !== "sibling-guide" && path.basename(absolutePath) === "MCP_QA_EXPERIENCE_GUIDE.md") {
    addDiagnostic(diagnostics, "local_guide_copy", displayPath, 1);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index]?.text ?? "";
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/)?.[1];
    if (heading !== undefined) {
      historySection = HISTORY_HEADING.test(heading);
      activeSection = !historySection && ACTIVE_HEADING.test(heading);
    }

    const fence = /^\s*(```+|~~~+)/.test(line);
    const inspectAsCommand = inFence || (activeSection && !historySection);
    if (fence) inFence = !inFence;
    if (line === "") continue;

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(line)) addDiagnostic(diagnostics, "secret_like_value", displayPath, lineNumber);
    }

    const linkPattern = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of line.matchAll(linkPattern)) {
      const target = localLinkTarget(match[1] ?? "");
      if (target === undefined) continue;
      const resolved = path.resolve(path.dirname(absolutePath), target);
      if (!fs.existsSync(resolved)) {
        addDiagnostic(diagnostics, "broken_markdown_link", displayPath, lineNumber);
      }
    }

    if (!inspectAsCommand) continue;
    if (/\bpython(?:3)?\b[^\n]*(?:\.py\b|manage_|install|update|uninstall)/i.test(line)) {
      addDiagnostic(diagnostics, "forbidden_python_command", displayPath, lineNumber);
    }
    if (/\bgit\s+clone\b/i.test(line)) {
      addDiagnostic(diagnostics, "forbidden_clone_command", displayPath, lineNumber);
    }
    if (/\b(?:codex|claude)\b[^\n]*\bplugin\b[^\n]*\b(?:marketplace|add|install)\b/i.test(line)) {
      addDiagnostic(diagnostics, "forbidden_marketplace_command", displayPath, lineNumber);
    }
    if (/\bnpx\s+kcoderag-nav\b(?!@latest)/i.test(line)) {
      addDiagnostic(diagnostics, "invalid_npx_command", displayPath, lineNumber);
    }
    for (const host of line.matchAll(/--host(?:=|\s+)([^\s`"']+)/gi)) {
      if (!new Set(["codex", "claude", "cursor"]).has((host[1] ?? "").toLowerCase())) {
        addDiagnostic(diagnostics, "invalid_host_flag", displayPath, lineNumber);
      }
    }
    if (/\bNode(?:\.js)?\s*(?:1\d|20|21)(?:\b|\.)/i.test(line)) {
      addDiagnostic(diagnostics, "invalid_node_requirement", displayPath, lineNumber);
    }
    if (/\bCursor\b[^\n]*(?:PreToolUse|\bhook\b)/i.test(line) &&
        !/(?:\bnot\b|does\s+not|doesn't|without|不是|不使用|没有|并非)[^\n]*(?:PreToolUse|\bhook\b)|(?:Rule)[^\n]*(?:\bnot\b|不是|而非)[^\n]*(?:PreToolUse|\bhook\b)/i.test(line)) {
      addDiagnostic(diagnostics, "cursor_hook_claim", displayPath, lineNumber);
    }
  }
  return diagnostics;
}

function checkDocs(
  rawPaths: readonly string[],
  policy: DocsPolicy,
  options: CheckOptions = {},
): CheckResult {
  if (!POLICIES.has(policy)) throw new DocsCheckError("unknown_policy");
  const repoRoot = path.resolve(options.repoRoot ?? PACKAGE_ROOT);
  const siblingGuidePath = path.resolve(options.siblingGuidePath ?? AUTHORITATIVE_GUIDE);
  const files = policy === "sibling-guide"
    ? collectSiblingGuide(rawPaths, siblingGuidePath)
    : collectRepoFiles(rawPaths, repoRoot);
  const diagnostics = files.flatMap((absolutePath) => {
    const displayPath = policy === "sibling-guide"
      ? path.basename(absolutePath)
      : path.relative(repoRoot, absolutePath).replace(/\\/g, "/");
    return inspectFile(absolutePath, displayPath, policy);
  }).sort((left, right) =>
    left.path.localeCompare(right.path) || left.line - right.line || left.code.localeCompare(right.code),
  );
  return { checkedFiles: files.length, diagnostics };
}

function parseArguments(argv: readonly string[]): { readonly policy: DocsPolicy; readonly paths: string[] } {
  let policy: DocsPolicy | undefined;
  const paths: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--policy") {
      const value = argv[index + 1];
      if (value === undefined || !POLICIES.has(value as DocsPolicy)) throw new DocsCheckError("unknown_policy");
      if (policy !== undefined) throw new DocsCheckError("duplicate_policy");
      policy = value as DocsPolicy;
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new DocsCheckError("unknown_flag");
    } else {
      paths.push(argument);
    }
  }
  if (policy === undefined) throw new DocsCheckError("missing_policy");
  if (paths.length === 0) throw new DocsCheckError("empty_scope");
  return { policy, paths };
}

function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const input = parseArguments(argv);
    const result = checkDocs(input.paths, input.policy);
    if (result.diagnostics.length > 0) {
      process.stderr.write(`${JSON.stringify({ ok: false, diagnostics: result.diagnostics })}\n`);
      return 1;
    }
    process.stdout.write(`${JSON.stringify({ ok: true, checkedFiles: result.checkedFiles })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof DocsCheckError ? error.code : "docs_check_failed";
    const safePath = error instanceof DocsCheckError ? error.safePath : undefined;
    process.stderr.write(`${JSON.stringify({ ok: false, code, ...(safePath === undefined ? {} : { path: safePath }) })}\n`);
    return 2;
  }
}

exports.DocsCheckError = DocsCheckError;
exports.checkDocs = checkDocs;
exports.main = main;

if (require.main === module) process.exitCode = main();
