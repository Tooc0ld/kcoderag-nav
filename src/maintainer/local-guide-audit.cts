#!/usr/bin/env node
/** Repository-local experience-guide integrity and current-topic audit. */
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const { TextDecoder } = require("node:util") as typeof import("node:util");

interface AuditOptions {
  readonly root?: string;
}

interface RequiredTopic {
  readonly code: string;
  readonly pattern: RegExp;
}

interface LocalGuideAuditResult {
  readonly pathToken: "docs/MCP_QA_EXPERIENCE_GUIDE.md";
  readonly sha256: string;
  readonly topicCount: number;
}

const GUIDE_TOKEN = "docs/MCP_QA_EXPERIENCE_GUIDE.md" as const;
const GUIDE_NAME = "MCP_QA_EXPERIENCE_GUIDE.md";
const MAX_GUIDE_BYTES = 256 * 1024;
const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const SECRET_PATTERNS = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/iu,
  /\b(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}/iu,
]);
const REQUIRED_TOPICS = Object.freeze<readonly RequiredTopic[]>([
  {
    code: "missing_topic_runtime_install",
    pattern: /(?=[\s\S]*Node(?:\.js)?\s*22)(?=[\s\S]*npx\s+kcoderag-nav@latest\s+install)/iu,
  },
  {
    code: "missing_topic_capabilities",
    pattern: /(?=[\s\S]*kcoderag-navigation)(?=[\s\S]*code-style-nudge)/u,
  },
  {
    code: "missing_topic_five_hosts",
    pattern: /(?=[\s\S]*Codex)(?=[\s\S]*Claude\s+Code)(?=[\s\S]*Cursor)(?=[\s\S]*OpenCode)(?=[\s\S]*ZCode)/u,
  },
  {
    code: "missing_topic_lifecycle",
    pattern: /(?=[\s\S]*\binstall\b)(?=[\s\S]*\bstatus\b)(?=[\s\S]*\bdoctor\b)(?=[\s\S]*\bupdate\b)(?=[\s\S]*\buninstall\b)/iu,
  },
  {
    code: "missing_topic_verify_restart",
    pattern: /(?=[\s\S]*\bstatus\b)(?=[\s\S]*\bdoctor\b)(?=[\s\S]*(?:restart|reopen|重新打开)[^\n]{0,100}(?:host|session|宿主|会话))/iu,
  },
  {
    code: "missing_topic_daily_use",
    pattern: /(?=[\s\S]*search_code)(?=[\s\S]*context)(?=[\s\S]*get_call_chain)(?=[\s\S]*list_indexes)/u,
  },
  {
    code: "missing_topic_code_style_support",
    pattern: /(?=[\s\S]*Claude(?:\s+Code)?[^\n]{0,100}2\.1\.241)(?=[\s\S]*(?:five hosts?|all five hosts?|五个宿主|五宿主)[^\n]{0,180}(?:manual|手动)[^\n]{0,100}(?:code-style-nudge|代码规范|style))(?=[\s\S]*(?:native|自动)[^\n]{0,180}(?:only|仅)[^\n]{0,100}Claude)/iu,
  },
]);

class LocalGuideAuditError extends Error {
  readonly code: string;
  readonly safePath?: string;

  constructor(code: string, safePath?: string) {
    super(code);
    this.name = "LocalGuideAuditError";
    this.code = code;
    if (safePath !== undefined) this.safePath = safePath === "." ? "." : GUIDE_TOKEN;
  }
}

function failUnless(condition: unknown, code: string, safePath?: string): asserts condition {
  if (!condition) throw new LocalGuideAuditError(code, safePath);
}

function assertRoot(rawRoot: string): string {
  const candidate = path.resolve(rawRoot);
  failUnless(fs.existsSync(candidate), "root_not_found", ".");
  const stat = fs.lstatSync(candidate);
  failUnless(!stat.isSymbolicLink(), "symlink_not_allowed", ".");
  failUnless(stat.isDirectory(), "invalid_root", ".");
  return fs.realpathSync(candidate);
}

function assertUnambiguousGuide(root: string): string {
  const oldRootGuide = path.join(root, GUIDE_NAME);
  failUnless(!fs.existsSync(oldRootGuide), "ambiguous_guide", GUIDE_TOKEN);

  const docsDirectory = path.join(root, "docs");
  failUnless(fs.existsSync(docsDirectory), "guide_not_found", GUIDE_TOKEN);
  const docsStat = fs.lstatSync(docsDirectory);
  failUnless(!docsStat.isSymbolicLink(), "symlink_not_allowed", GUIDE_TOKEN);
  failUnless(docsStat.isDirectory(), "special_file_not_allowed", GUIDE_TOKEN);
  const candidates = fs.readdirSync(docsDirectory).filter((name) => name.toLowerCase() === GUIDE_NAME.toLowerCase());
  failUnless(candidates.length === 1 && candidates[0] === GUIDE_NAME, "ambiguous_guide", GUIDE_TOKEN);
  return path.join(docsDirectory, GUIDE_NAME);
}

function readGuideBytes(root: string): Buffer {
  const guidePath = assertUnambiguousGuide(root);
  failUnless(fs.existsSync(guidePath), "guide_not_found", GUIDE_TOKEN);
  const before = fs.lstatSync(guidePath);
  failUnless(!before.isSymbolicLink(), "symlink_not_allowed", GUIDE_TOKEN);
  failUnless(before.isFile(), "special_file_not_allowed", GUIDE_TOKEN);
  failUnless(before.size > 0, "guide_empty", GUIDE_TOKEN);
  failUnless(before.size <= MAX_GUIDE_BYTES, "guide_too_large", GUIDE_TOKEN);

  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(guidePath, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    failUnless(opened.isFile(), "special_file_not_allowed", GUIDE_TOKEN);
    failUnless(opened.size > 0, "guide_empty", GUIDE_TOKEN);
    failUnless(opened.size <= MAX_GUIDE_BYTES, "guide_too_large", GUIDE_TOKEN);
    failUnless(opened.dev === before.dev && opened.ino === before.ino, "guide_changed_during_read", GUIDE_TOKEN);
    const bytes = fs.readFileSync(descriptor);
    failUnless(bytes.byteLength === opened.size, "guide_changed_during_read", GUIDE_TOKEN);
    return bytes;
  } catch (error) {
    if (error instanceof LocalGuideAuditError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw new LocalGuideAuditError("symlink_not_allowed", GUIDE_TOKEN);
    throw new LocalGuideAuditError("guide_read_failed", GUIDE_TOKEN);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function decodeGuide(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LocalGuideAuditError("guide_invalid_utf8", GUIDE_TOKEN);
  }
}

function auditLocalGuide(options: AuditOptions = {}): LocalGuideAuditResult {
  const root = assertRoot(options.root ?? PACKAGE_ROOT);
  const bytes = readGuideBytes(root);
  const source = decodeGuide(bytes);
  failUnless(!SECRET_PATTERNS.some((pattern) => pattern.test(source)), "secret_like_value", GUIDE_TOKEN);
  for (const topic of REQUIRED_TOPICS) {
    failUnless(topic.pattern.test(source), topic.code, GUIDE_TOKEN);
  }
  return Object.freeze({
    pathToken: GUIDE_TOKEN,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    topicCount: REQUIRED_TOPICS.length,
  });
}

function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length !== 0) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "unexpected_argument" })}\n`);
    return 2;
  }
  try {
    const result = auditLocalGuide({ root: process.cwd() });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof LocalGuideAuditError ? error.code : "local_guide_audit_failed";
    const safePath = error instanceof LocalGuideAuditError ? error.safePath : undefined;
    process.stderr.write(`${JSON.stringify({ ok: false, code, ...(safePath === undefined ? {} : { path: safePath }) })}\n`);
    return 1;
  }
}

exports.LocalGuideAuditError = LocalGuideAuditError;
exports.auditLocalGuide = auditLocalGuide;
exports.main = main;

if (require.main === module) process.exitCode = main();
