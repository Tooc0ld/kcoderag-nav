const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const crypto = require("node:crypto") as typeof import("node:crypto");
const childProcess = require("node:child_process") as typeof import("node:child_process");

type JsonMap = Record<string, any>;

interface StatusEntry {
  readonly code: string;
  readonly path: string;
}

interface AuditOptions {
  readonly siblingRepo: string;
  readonly navRepo: string;
}

interface CliOptions extends AuditOptions {
  readonly writeStdout?: (text: string) => void;
  readonly writeStderr?: (text: string) => void;
}

interface Baseline {
  readonly schemaVersion: 1;
  readonly siblingRepo: string;
  readonly guide: string;
  readonly head: string;
  readonly status: readonly StatusEntry[];
  readonly guideClean: true;
}

interface Receipt {
  readonly schemaVersion: 1;
  readonly siblingRepo: string;
  readonly guide: string;
  readonly baselineDigest: string;
  readonly baselineHead: string;
  readonly commitParent: string;
  readonly beforeUnrelatedStatusDigest: string;
  readonly afterUnrelatedStatusDigest: string;
  readonly kcoderag_head: string;
  readonly kcoderag_nav_head: string;
  readonly commitFiles: readonly string[];
  readonly secret_scan: true;
}

const GUIDE = "MCP_QA_EXPERIENCE_GUIDE.md";
const HASH_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}/i,
];
const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_OPTIONS: AuditOptions = Object.freeze({
  siblingRepo: path.resolve(PACKAGE_ROOT, "../KCodeRag"),
  navRepo: PACKAGE_ROOT,
});

class SiblingGuideAuditError extends Error {
  readonly code: string;
  readonly safePath?: string;

  constructor(code: string, safePath?: string) {
    super(code);
    this.name = "SiblingGuideAuditError";
    this.code = code;
    if (safePath !== undefined) this.safePath = path.basename(safePath) || ".";
  }
}

function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failUnless(condition: unknown, code: string, safePath?: string): asserts condition {
  if (!condition) throw new SiblingGuideAuditError(code, safePath);
}

function normalizeRepoPath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/");
}

function git(repo: string, args: readonly string[]): string {
  try {
    return childProcess.execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }).trimEnd();
  } catch {
    throw new SiblingGuideAuditError("git_metadata_failed");
  }
}

function readHead(repo: string): string {
  const head = git(repo, ["rev-parse", "HEAD"]).trim();
  failUnless(HASH_PATTERN.test(head), "invalid_hash");
  return head;
}

function readStatus(repo: string): readonly StatusEntry[] {
  const output = git(repo, ["status", "--short", "--untracked-files=all"]);
  if (output === "") return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    failUnless(line.length >= 4, "invalid_git_status");
    return { code: line.slice(0, 2), path: line.slice(3).replace(/\\/g, "/") };
  }).sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
}

function isGuideStatus(entry: StatusEntry): boolean {
  return entry.path === GUIDE || entry.path.startsWith(`${GUIDE} -> `) || entry.path.endsWith(` -> ${GUIDE}`);
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function unrelatedStatus(status: readonly StatusEntry[]): readonly StatusEntry[] {
  return status.filter((entry) => !isGuideStatus(entry));
}

function assertStatusEntries(value: unknown): asserts value is readonly StatusEntry[] {
  failUnless(Array.isArray(value), "invalid_baseline");
  let previous = "";
  for (const entry of value) {
    failUnless(
      isRecord(entry) &&
        Object.keys(entry).sort().join("\0") === "code\0path" &&
        typeof entry.code === "string" && entry.code.length === 2 &&
        typeof entry.path === "string" && entry.path.length > 0 && !entry.path.includes("\0"),
      "invalid_baseline",
    );
    const key = `${entry.path}\0${entry.code}`;
    failUnless(previous === "" || previous.localeCompare(key) <= 0, "invalid_baseline");
    previous = key;
  }
}

function assertNoSecretLikeValue(value: unknown): void {
  if (typeof value === "string") {
    failUnless(!SECRET_PATTERNS.some((pattern) => pattern.test(value)), "secret_like_value");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretLikeValue(item);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) assertNoSecretLikeValue(item);
  }
}

function validateBaseline(value: unknown): Baseline {
  failUnless(isRecord(value), "invalid_baseline");
  assertNoSecretLikeValue(value);
  failUnless(
    Object.keys(value).sort().join("\0") ===
      ["guide", "guideClean", "head", "schemaVersion", "siblingRepo", "status"].sort().join("\0") &&
      value.schemaVersion === 1 && value.guide === GUIDE && value.guideClean === true &&
      typeof value.siblingRepo === "string" && path.isAbsolute(value.siblingRepo) &&
      typeof value.head === "string" && HASH_PATTERN.test(value.head),
    "invalid_baseline",
  );
  assertStatusEntries(value.status);
  failUnless(!(value.status as readonly StatusEntry[]).some(isGuideStatus), "guide_not_clean");
  return value as Baseline;
}

function captureBaseline(options: AuditOptions = DEFAULT_OPTIONS): Baseline {
  failUnless(
    fs.existsSync(options.siblingRepo) &&
      fs.lstatSync(options.siblingRepo).isDirectory() &&
      !fs.lstatSync(options.siblingRepo).isSymbolicLink(),
    "invalid_sibling_repo",
  );
  const siblingRepo = normalizeRepoPath(options.siblingRepo);
  const guidePath = path.join(options.siblingRepo, GUIDE);
  failUnless(fs.existsSync(guidePath) && fs.lstatSync(guidePath).isFile(), "guide_not_found", GUIDE);
  failUnless(!fs.lstatSync(guidePath).isSymbolicLink(), "symlink_not_allowed", GUIDE);
  const status = readStatus(options.siblingRepo);
  failUnless(!status.some(isGuideStatus), "guide_not_clean", GUIDE);
  return {
    schemaVersion: 1,
    siblingRepo,
    guide: GUIDE,
    head: readHead(options.siblingRepo),
    status,
    guideClean: true,
  };
}

function baselineEvidenceDigest(input: {
  readonly siblingRepo: string;
  readonly guide: string;
  readonly head: string;
  readonly unrelatedStatusDigest: string;
}): string {
  return digest({
    schemaVersion: 1,
    siblingRepo: input.siblingRepo,
    guide: input.guide,
    head: input.head,
    unrelatedStatusDigest: input.unrelatedStatusDigest,
    guideClean: true,
  });
}

function readCommitFiles(repo: string): readonly string[] {
  const output = git(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
  return output === "" ? [] : output.split(/\r?\n/).filter(Boolean).map((item) => item.replace(/\\/g, "/")).sort();
}

function assertGuideCommitHasNoSecret(repo: string): void {
  const content = git(repo, ["show", `HEAD:${GUIDE}`]);
  failUnless(!SECRET_PATTERNS.some((pattern) => pattern.test(content)), "secret_like_value");
}

function recordSiblingReceipt(
  baselineValue: unknown,
  options: AuditOptions = DEFAULT_OPTIONS,
): Receipt {
  const baseline = validateBaseline(baselineValue);
  failUnless(normalizeRepoPath(options.siblingRepo) === baseline.siblingRepo, "baseline_repo_mismatch");
  const currentStatus = readStatus(options.siblingRepo);
  failUnless(!currentStatus.some(isGuideStatus), "guide_not_clean", GUIDE);
  const beforeDigest = digest(unrelatedStatus(baseline.status));
  const afterDigest = digest(unrelatedStatus(currentStatus));
  failUnless(beforeDigest === afterDigest, "unrelated_status_changed");
  const commitFiles = readCommitFiles(options.siblingRepo);
  failUnless(commitFiles.length === 1 && commitFiles[0] === GUIDE, "invalid_commit_files");
  assertGuideCommitHasNoSecret(options.siblingRepo);
  const currentHead = readHead(options.siblingRepo);
  const commitParent = git(options.siblingRepo, ["rev-parse", "HEAD^"]).trim();
  failUnless(HASH_PATTERN.test(commitParent), "invalid_hash");
  failUnless(currentHead !== baseline.head && commitParent === baseline.head, "baseline_head_mismatch");
  const receipt: Receipt = {
    schemaVersion: 1,
    siblingRepo: baseline.siblingRepo,
    guide: GUIDE,
    baselineDigest: baselineEvidenceDigest({
      siblingRepo: baseline.siblingRepo,
      guide: baseline.guide,
      head: baseline.head,
      unrelatedStatusDigest: beforeDigest,
    }),
    baselineHead: baseline.head,
    commitParent,
    beforeUnrelatedStatusDigest: beforeDigest,
    afterUnrelatedStatusDigest: afterDigest,
    kcoderag_head: currentHead,
    kcoderag_nav_head: readHead(options.navRepo),
    commitFiles,
    secret_scan: true,
  };
  return verifySiblingReceipt(receipt);
}

function verifySiblingReceipt(value: unknown): Receipt {
  failUnless(isRecord(value), "invalid_receipt");
  assertNoSecretLikeValue(value);
  const expectedKeys = [
    "afterUnrelatedStatusDigest",
    "baselineDigest",
    "baselineHead",
    "beforeUnrelatedStatusDigest",
    "commitFiles",
    "commitParent",
    "guide",
    "kcoderag_head",
    "kcoderag_nav_head",
    "schemaVersion",
    "secret_scan",
    "siblingRepo",
  ].sort().join("\0");
  failUnless(Object.keys(value).sort().join("\0") === expectedKeys, "invalid_receipt");
  failUnless(
    value.schemaVersion === 1 && value.guide === GUIDE && value.secret_scan === true &&
      typeof value.siblingRepo === "string" && path.isAbsolute(value.siblingRepo),
    "invalid_receipt",
  );
  for (const key of ["baselineHead", "commitParent", "kcoderag_head", "kcoderag_nav_head"] as const) {
    failUnless(typeof value[key] === "string" && HASH_PATTERN.test(value[key]), "invalid_hash");
  }
  for (const key of ["baselineDigest", "beforeUnrelatedStatusDigest", "afterUnrelatedStatusDigest"] as const) {
    failUnless(typeof value[key] === "string" && DIGEST_PATTERN.test(value[key]), "invalid_digest");
  }
  failUnless(
    value.beforeUnrelatedStatusDigest === value.afterUnrelatedStatusDigest,
    "unrelated_status_changed",
  );
  failUnless(value.commitParent === value.baselineHead, "baseline_head_mismatch");
  failUnless(
    value.baselineDigest === baselineEvidenceDigest({
      siblingRepo: value.siblingRepo,
      guide: value.guide,
      head: value.baselineHead,
      unrelatedStatusDigest: value.beforeUnrelatedStatusDigest,
    }),
    "baseline_digest_mismatch",
  );
  failUnless(
    Array.isArray(value.commitFiles) && value.commitFiles.length === 1 && value.commitFiles[0] === GUIDE,
    "invalid_commit_files",
  );
  return value as Receipt;
}

function summaryHash(summaryText: string, key: "kcoderag_nav_head" | "kcoderag_head"): string {
  const pattern = new RegExp(`^${key}:\\s*["']?([0-9a-f]{40})["']?\\s*$`, "gm");
  const matches = [...summaryText.matchAll(pattern)];
  failUnless(matches.length === 1 && typeof matches[0]?.[1] === "string", "summary_hash_missing");
  return matches[0][1];
}

function verifySiblingSummary(summaryText: string, receiptValue: unknown): void {
  const receipt = verifySiblingReceipt(receiptValue);
  assertNoSecretLikeValue(summaryText);
  failUnless(
    summaryHash(summaryText, "kcoderag_nav_head") === receipt.kcoderag_nav_head &&
      summaryHash(summaryText, "kcoderag_head") === receipt.kcoderag_head,
    "summary_hash_mismatch",
  );
}

function evidencePath(rawPath: string, navRepo: string, mustExist: boolean): string {
  const root = fs.realpathSync(navRepo);
  const candidate = path.resolve(root, rawPath);
  const relative = path.relative(root, candidate);
  failUnless(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "path_escape", rawPath);
  const parts = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    failUnless(!fs.lstatSync(current).isSymbolicLink(), "symlink_not_allowed", rawPath);
  }
  if (mustExist) failUnless(fs.existsSync(candidate) && fs.lstatSync(candidate).isFile(), "evidence_not_found", rawPath);
  else failUnless(fs.existsSync(path.dirname(candidate)) && fs.lstatSync(path.dirname(candidate)).isDirectory(), "evidence_parent_not_found", rawPath);
  return candidate;
}

function readJson(filePath: string): unknown {
  const stat = fs.statSync(filePath);
  failUnless(stat.size <= 1024 * 1024, "evidence_too_large", filePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    throw new SiblingGuideAuditError("invalid_json", filePath);
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best-effort temporary cleanup */ }
  }
}

type CliInvocation =
  | { readonly mode: "capture"; readonly output: string }
  | { readonly mode: "record"; readonly output: string; readonly baseline: string }
  | { readonly mode: "verify-receipt"; readonly receipt: string }
  | { readonly mode: "verify-summary"; readonly summary: string; readonly receipt: string };

function parseArguments(argv: readonly string[]): CliInvocation {
  const values = new Map<string, string>();
  const allowed = new Set(["--capture-baseline", "--record-receipt", "--baseline", "--verify-receipt", "--verify-summary", "--receipt"]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    failUnless(flag !== undefined && allowed.has(flag), "unknown_flag");
    failUnless(value !== undefined && !value.startsWith("--"), "missing_argument");
    failUnless(!values.has(flag), "duplicate_flag");
    values.set(flag, value);
  }
  if (values.size === 1 && values.has("--capture-baseline")) {
    return { mode: "capture", output: values.get("--capture-baseline") ?? "" };
  }
  if (values.size === 2 && values.has("--record-receipt") && values.has("--baseline")) {
    return {
      mode: "record",
      output: values.get("--record-receipt") ?? "",
      baseline: values.get("--baseline") ?? "",
    };
  }
  if (values.size === 1 && values.has("--verify-receipt")) {
    return { mode: "verify-receipt", receipt: values.get("--verify-receipt") ?? "" };
  }
  if (values.size === 2 && values.has("--verify-summary") && values.has("--receipt")) {
    return {
      mode: "verify-summary",
      summary: values.get("--verify-summary") ?? "",
      receipt: values.get("--receipt") ?? "",
    };
  }
  throw new SiblingGuideAuditError("invalid_mode");
}

function runCli(argv: readonly string[], options: CliOptions = DEFAULT_OPTIONS): number {
  const stdout = options.writeStdout ?? ((text: string) => process.stdout.write(text));
  const stderr = options.writeStderr ?? ((text: string) => process.stderr.write(text));
  try {
    const invocation = parseArguments(argv);
    if (invocation.mode === "capture") {
      const output = evidencePath(invocation.output, options.navRepo, false);
      writeJsonAtomic(output, captureBaseline(options));
      stdout(`${JSON.stringify({ ok: true, mode: "capture", path: path.basename(output) })}\n`);
    } else if (invocation.mode === "record") {
      const baselinePath = evidencePath(invocation.baseline, options.navRepo, true);
      const output = evidencePath(invocation.output, options.navRepo, false);
      writeJsonAtomic(output, recordSiblingReceipt(readJson(baselinePath), options));
      stdout(`${JSON.stringify({ ok: true, mode: "record", path: path.basename(output) })}\n`);
    } else if (invocation.mode === "verify-receipt") {
      const receiptPath = evidencePath(invocation.receipt, options.navRepo, true);
      verifySiblingReceipt(readJson(receiptPath));
      stdout(`${JSON.stringify({ ok: true, mode: "verify-receipt", path: path.basename(receiptPath) })}\n`);
    } else {
      const summaryPath = evidencePath(invocation.summary, options.navRepo, true);
      const receiptPath = evidencePath(invocation.receipt, options.navRepo, true);
      verifySiblingSummary(fs.readFileSync(summaryPath, "utf8"), readJson(receiptPath));
      stdout(`${JSON.stringify({ ok: true, mode: "verify-summary", path: path.basename(summaryPath) })}\n`);
    }
    return 0;
  } catch (error) {
    const code = error instanceof SiblingGuideAuditError ? error.code : "sibling_guide_audit_failed";
    const safePath = error instanceof SiblingGuideAuditError ? error.safePath : undefined;
    stderr(`${JSON.stringify({ ok: false, code, ...(safePath === undefined ? {} : { path: safePath }) })}\n`);
    return 1;
  }
}

exports.SiblingGuideAuditError = SiblingGuideAuditError;
exports.captureBaseline = captureBaseline;
exports.recordSiblingReceipt = recordSiblingReceipt;
exports.verifySiblingReceipt = verifySiblingReceipt;
exports.verifySiblingSummary = verifySiblingSummary;
exports.runCli = runCli;

if (require.main === module) process.exitCode = runCli(process.argv.slice(2), DEFAULT_OPTIONS);
