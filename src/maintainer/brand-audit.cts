/** Pure closed-family matching and strict text decoding for readiness audits. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const tarArchive = require("./tar-archive.cjs") as typeof import("./tar-archive.cjs");

export type BrandFamilyId = "F001" | "F002" | "F003";
export type BrandAuditScope = "git_path" | "git_content" | "tar_path" | "tar_content";

export interface BrandAuditLimits {
  readonly maxArchiveBytes: number;
  readonly maxBlobBytes: number;
  readonly maxMemberBytes: number;
  readonly maxEntries: number;
  readonly maxPathBytes: number;
}

interface BrandAuditFindingBase {
  readonly code: "brand_family_detected";
  readonly scope: BrandAuditScope;
  readonly familyId: BrandFamilyId;
  readonly pathToken: string;
  readonly placeholder: string;
}

export interface BrandAuditPathFinding extends BrandAuditFindingBase {
  readonly category: "path";
  readonly componentIndex: number;
  readonly componentCount: number;
}

export interface BrandAuditContentFinding extends BrandAuditFindingBase {
  readonly category: "content";
  readonly line: number;
  readonly column: number;
}

export type BrandAuditFinding = BrandAuditPathFinding | BrandAuditContentFinding;

export interface BrandAuditResult {
  readonly ok: boolean;
  readonly findingCount: number;
  readonly findings: readonly BrandAuditFinding[];
}

interface PrivateBrandFinding {
  readonly exactPath: string;
  readonly finding: BrandAuditFinding;
}

interface ScanBrandTextOptions {
  readonly scope: BrandAuditScope;
  readonly exactPath: string;
  readonly limits?: Partial<BrandAuditLimits>;
  readonly onPrivateFinding?: (finding: PrivateBrandFinding) => void;
}

export interface GitTreeScanOptions {
  readonly root: string;
  readonly subject: string;
  readonly include?: readonly string[];
  readonly limits?: Partial<BrandAuditLimits>;
}

export interface GitTreeScanResult {
  readonly schemaVersion: 1;
  readonly scope: "git";
  readonly subject: string;
  readonly tree: string;
  readonly scannedCount: number;
  readonly findingCount: number;
  readonly findings: readonly BrandAuditFinding[];
}

export interface TarballScanOptions {
  readonly bytes: Buffer;
  readonly expectedSha256: string;
  readonly limits?: Partial<BrandAuditLimits>;
  readonly onPrivateFinding?: (finding: PrivateBrandFinding) => void;
}

export interface TarballScanResult {
  readonly schemaVersion: 1;
  readonly scope: "tar";
  readonly artifactSha256: string;
  readonly memberCount: number;
  readonly scannedCount: number;
  readonly findingCount: number;
  readonly findings: readonly BrandAuditFinding[];
}

interface GitTreeEntry {
  readonly mode: "100644" | "100755";
  readonly oid: string;
  readonly path: string;
}

type GitCommandRunner = (
  root: string,
  args: readonly string[],
  input: Buffer | undefined,
  maxBuffer: number,
) => Buffer;

interface GitScanDependencies {
  readonly runGit?: GitCommandRunner;
}

interface EncodedBrandFamily {
  readonly id: BrandFamilyId;
  readonly aliases: readonly (readonly number[])[];
}

interface CompiledBrandFamily {
  readonly id: BrandFamilyId;
  readonly aliases: readonly string[];
}

interface FoldedText {
  readonly value: string;
  readonly offsets: readonly number[];
}

interface MatchLocation {
  readonly familyId: BrandFamilyId;
  readonly offset: number;
}

export class BrandAuditError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "BrandAuditError";
    this.code = code;
  }
}

export const DEFAULT_BRAND_AUDIT_LIMITS: BrandAuditLimits = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxBlobBytes: 8 * 1024 * 1024,
  maxMemberBytes: 8 * 1024 * 1024,
  maxEntries: 4096,
  maxPathBytes: 4096,
});

const LIMIT_KEYS = Object.freeze([
  "maxArchiveBytes",
  "maxBlobBytes",
  "maxMemberBytes",
  "maxEntries",
  "maxPathBytes",
] as const);

const ENCODED_FAMILIES: readonly EncodedBrandFamily[] = Object.freeze([
  Object.freeze({
    id: "F001",
    aliases: Object.freeze([
      Object.freeze([0x6a, 0x78, 0x33]),
      Object.freeze([0x52_51, 0x7f_51, 0x33]),
      Object.freeze([0x52_51, 0x7f_51, 0x4e_09]),
      Object.freeze([0x6a, 0x69, 0x61, 0x6e, 0x77, 0x61, 0x6e, 0x67, 0x33]),
      Object.freeze([0x6a, 0x69, 0x00_e0, 0x6e, 0x77, 0x01_ce, 0x6e, 0x67, 0x33]),
      Object.freeze([0x6a, 0x78, 0x6f, 0x6e, 0x6c, 0x69, 0x6e, 0x65, 0x33]),
      Object.freeze([0x52_51, 0x4f_a0, 0x60_c5, 0x7f_18, 0x7f_51, 0x7e_dc, 0x72_48, 0x53_c1]),
    ]),
  }),
  Object.freeze({
    id: "F002",
    aliases: Object.freeze([
      Object.freeze([0x6b, 0x69, 0x6e, 0x67, 0x73, 0x6f, 0x66, 0x74]),
      Object.freeze([0x91_d1, 0x5c_71]),
      Object.freeze([0x91_d1, 0x5c_71, 0x8f_6f, 0x4e_f6]),
    ]),
  }),
  Object.freeze({
    id: "F003",
    aliases: Object.freeze([
      Object.freeze([0x73, 0x65, 0x61, 0x73, 0x75, 0x6e]),
      Object.freeze([0x89_7f, 0x5c_71, 0x5c_45]),
    ]),
  }),
]);

const SEPARATOR_RE = /[\p{White_Space}\p{Pd}_]/gu;
const UNSUPPORTED_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const VALID_SCOPES = new Set<BrandAuditScope>(["git_path", "git_content", "tar_path", "tar_content"]);
const PATH_SCOPES = new Set<BrandAuditScope>(["git_path", "tar_path"]);
const SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });
const GIT_OID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const MAX_PUBLIC_FINDINGS = 4096;

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new BrandAuditError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function resolveLimits(value: Partial<BrandAuditLimits> | undefined): BrandAuditLimits {
  if (value === undefined) return DEFAULT_BRAND_AUDIT_LIMITS;
  failUnless(isPlainObject(value), "invalid_audit_limits");
  failUnless(Object.keys(value).every((key) => LIMIT_KEYS.includes(key as (typeof LIMIT_KEYS)[number])),
    "invalid_audit_limits");
  const output: Record<(typeof LIMIT_KEYS)[number], number> = { ...DEFAULT_BRAND_AUDIT_LIMITS };
  for (const key of LIMIT_KEYS) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    failUnless(Number.isSafeInteger(candidate) && candidate > 0 && candidate <= DEFAULT_BRAND_AUDIT_LIMITS[key],
      "invalid_audit_limits");
    output[key] = candidate;
  }
  return Object.freeze(output);
}

function foldWithOffsets(input: string): FoldedText {
  failUnless(!hasUnpairedSurrogate(input), "malformed_text_encoding");
  let value = "";
  const offsets: number[] = [];
  for (const segment of SEGMENTER.segment(input)) {
    const foldedSegment = segment.segment.normalize("NFKC").toLowerCase().replace(SEPARATOR_RE, "");
    value += foldedSegment;
    for (let index = 0; index < foldedSegment.length; index += 1) offsets.push(segment.index);
  }
  return Object.freeze({ value, offsets: Object.freeze(offsets) });
}

export function foldBrandCandidate(input: unknown): string {
  failUnless(typeof input === "string", "invalid_audit_input");
  return foldWithOffsets(input).value;
}

const COMPILED_FAMILIES: readonly CompiledBrandFamily[] = Object.freeze(ENCODED_FAMILIES.map((family) => Object.freeze({
  id: family.id,
  aliases: Object.freeze(family.aliases.map((alias) => foldBrandCandidate(String.fromCodePoint(...alias)))),
})));

function startsWithBytes(input: Buffer, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => input[index] === byte);
}

function decodeBuffer(input: Buffer): string {
  let encoding: "utf-8" | "utf-16le" | "utf-16be" = "utf-8";
  let offset = 0;
  if (startsWithBytes(input, [0xef, 0xbb, 0xbf])) {
    encoding = "utf-8";
    offset = 3;
  } else if (startsWithBytes(input, [0xff, 0xfe])) {
    encoding = "utf-16le";
    offset = 2;
  } else if (startsWithBytes(input, [0xfe, 0xff])) {
    encoding = "utf-16be";
    offset = 2;
  }
  const body = input.subarray(offset);
  if (offset > 0 && (
    startsWithBytes(body, [0xef, 0xbb, 0xbf])
    || startsWithBytes(body, [0xff, 0xfe])
    || startsWithBytes(body, [0xfe, 0xff])
  )) throw new BrandAuditError("ambiguous_text_encoding");
  if (encoding !== "utf-8" && body.length % 2 !== 0) throw new BrandAuditError("malformed_text_encoding");
  try {
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    throw new BrandAuditError("malformed_text_encoding");
  }
}

function assertInspectableText(value: string): string {
  if (hasUnpairedSurrogate(value)) throw new BrandAuditError("malformed_text_encoding");
  if (value.includes("\ufeff")) throw new BrandAuditError("ambiguous_text_encoding");
  if (UNSUPPORTED_CONTROL_RE.test(value)) throw new BrandAuditError("binary_audit_input");
  return value;
}

export function decodeInspectableText(
  input: unknown,
  limitOverrides?: Partial<BrandAuditLimits>,
): string {
  const limits = resolveLimits(limitOverrides);
  failUnless(typeof input === "string" || Buffer.isBuffer(input), "invalid_audit_input");
  const byteLength = typeof input === "string" ? Buffer.byteLength(input, "utf8") : input.length;
  failUnless(byteLength <= limits.maxBlobBytes, "audit_input_too_large");
  return assertInspectableText(typeof input === "string" ? input : decodeBuffer(input));
}

function validateExactPath(input: unknown, limits: BrandAuditLimits): string {
  failUnless(typeof input === "string" && input.length > 0, "invalid_audit_path");
  failUnless(Buffer.byteLength(input, "utf8") <= limits.maxPathBytes, "audit_path_too_large");
  failUnless(!input.includes("\\") && !/[\0\r\n\t]/u.test(input)
    && !input.startsWith("/") && !/^[a-z]:/iu.test(input),
    "invalid_audit_path");
  const components = input.split("/");
  failUnless(components.every((component) => component.length > 0 && component !== "." && component !== ".."),
    "invalid_audit_path");
  return input;
}

function findMatches(input: string): readonly MatchLocation[] {
  const folded = foldWithOffsets(input);
  const matches = new Map<string, MatchLocation>();
  for (const family of COMPILED_FAMILIES) {
    for (const alias of family.aliases) {
      let start = 0;
      while (start <= folded.value.length - alias.length) {
        const found = folded.value.indexOf(alias, start);
        if (found < 0) break;
        const offset = folded.offsets[found] ?? 0;
        const key = `${family.id}:${offset}`;
        if (!matches.has(key)) matches.set(key, Object.freeze({ familyId: family.id, offset }));
        start = found + Math.max(1, alias.length);
      }
    }
  }
  return Object.freeze([...matches.values()].sort((left, right) =>
    left.offset - right.offset || (left.familyId < right.familyId ? -1 : left.familyId > right.familyId ? 1 : 0)));
}

function lineColumnAt(input: string, offset: number): { readonly line: number; readonly column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (input[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return Object.freeze({ line, column: Array.from(input.slice(lineStart, offset)).length + 1 });
}

function pathToken(exactPath: string): string {
  return crypto.createHash("sha256").update(exactPath.normalize("NFC"), "utf8").digest("hex");
}

function baseFinding(
  scope: BrandAuditScope,
  familyId: BrandFamilyId,
  token: string,
): BrandAuditFindingBase {
  return {
    code: "brand_family_detected",
    scope,
    familyId,
    pathToken: token,
    placeholder: `<${familyId}>`,
  };
}

function scanPath(scope: BrandAuditScope, exactPath: string, token: string): readonly BrandAuditFinding[] {
  const components = exactPath.split("/");
  const findings: BrandAuditFinding[] = [];
  for (const [componentOffset, component] of components.entries()) {
    for (const match of findMatches(component)) {
      findings.push(Object.freeze({
        ...baseFinding(scope, match.familyId, token),
        category: "path",
        componentIndex: componentOffset + 1,
        componentCount: components.length,
      }));
    }
  }
  return Object.freeze(findings);
}

function scanContent(
  scope: BrandAuditScope,
  input: unknown,
  limits: BrandAuditLimits,
  token: string,
): readonly BrandAuditFinding[] {
  const text = decodeInspectableText(input, limits);
  return Object.freeze(findMatches(text).map((match) => {
    const location = lineColumnAt(text, match.offset);
    return Object.freeze({
      ...baseFinding(scope, match.familyId, token),
      category: "content" as const,
      line: location.line,
      column: location.column,
    });
  }));
}

function deliverPrivateFindings(
  exactPath: string,
  findings: readonly BrandAuditFinding[],
  callback: ((finding: PrivateBrandFinding) => void) | undefined,
): void {
  if (callback === undefined) return;
  try {
    for (const finding of findings) {
      const payload = { finding } as { finding: BrandAuditFinding; exactPath?: string };
      Object.defineProperty(payload, "exactPath", {
        value: exactPath,
        enumerable: false,
        configurable: false,
        writable: false,
      });
      callback(Object.freeze(payload) as PrivateBrandFinding);
    }
  } catch {
    throw new BrandAuditError("private_remediation_failed");
  }
}

export function scanBrandText(input: unknown, options: ScanBrandTextOptions): BrandAuditResult {
  failUnless(isPlainObject(options), "invalid_audit_options");
  failUnless(typeof options.scope === "string" && VALID_SCOPES.has(options.scope), "invalid_audit_scope");
  failUnless(options.onPrivateFinding === undefined || typeof options.onPrivateFinding === "function",
    "invalid_audit_options");
  const limits = resolveLimits(options.limits);
  const exactPath = validateExactPath(options.exactPath, limits);
  const token = pathToken(exactPath);
  let findings: readonly BrandAuditFinding[];
  if (PATH_SCOPES.has(options.scope)) {
    const decodedPath = decodeInspectableText(input, limits);
    failUnless(decodedPath === exactPath, "invalid_audit_path");
    findings = scanPath(options.scope, exactPath, token);
  } else {
    findings = scanContent(options.scope, input, limits, token);
  }
  deliverPrivateFindings(exactPath, findings, options.onPrivateFinding);
  return Object.freeze({
    ok: findings.length === 0,
    findingCount: findings.length,
    findings,
  });
}

function runGitCommand(
  root: string,
  args: readonly string[],
  input: Buffer | undefined,
  maxBuffer: number,
): Buffer {
  const result = childProcess.spawnSync("git", [...args], {
    cwd: root,
    input,
    encoding: "buffer",
    maxBuffer,
    timeout: 15_000,
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error !== undefined || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new BrandAuditError("git_command_failed");
  }
  return result.stdout;
}

function decodeGitLine(value: Buffer, code: string): string {
  try {
    const output = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value);
    failUnless(!output.includes("\ufeff") && !/[\0\r\n\t]/u.test(output), code);
    return output;
  } catch (error) {
    if (error instanceof BrandAuditError) throw error;
    throw new BrandAuditError(code);
  }
}

function parseSingleOid(value: Buffer, code: string): string {
  let end = value.length;
  if (end > 0 && value[end - 1] === 0x0a) end -= 1;
  if (end > 0 && value[end - 1] === 0x0d) end -= 1;
  const text = decodeGitLine(value.subarray(0, end), code);
  failUnless(GIT_OID_RE.test(text), code);
  return text;
}

function validGitSubject(value: unknown): value is string {
  return typeof value === "string" && (value === "HEAD" || GIT_OID_RE.test(value));
}

function parseGitTree(raw: Buffer, limits: BrandAuditLimits): readonly GitTreeEntry[] {
  failUnless(raw.length <= limits.maxArchiveBytes, "git_tree_too_large");
  if (raw.length === 0) return Object.freeze([]);
  failUnless(raw[raw.length - 1] === 0, "invalid_git_tree_record");
  const records = raw.subarray(0, raw.length - 1).toString("latin1").split("\0");
  failUnless(records.length <= limits.maxEntries, "too_many_git_entries");
  const entries: GitTreeEntry[] = [];
  for (const record of records) {
    const bytes = Buffer.from(record, "latin1");
    const tab = bytes.indexOf(0x09);
    failUnless(tab > 0 && tab < bytes.length - 1, "invalid_git_tree_record");
    const header = bytes.subarray(0, tab).toString("ascii");
    const match = /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40}(?:[0-9a-f]{24})?)$/u.exec(header);
    failUnless(match !== null, "invalid_git_tree_record");
    const mode = match[1]!;
    const type = match[2]!;
    failUnless((mode === "100644" || mode === "100755") && type === "blob", "unsupported_git_entry");
    const relativePath = decodeGitLine(bytes.subarray(tab + 1), "invalid_git_path_encoding");
    const validatedPath = validateExactPath(relativePath, limits);
    failUnless(!validatedPath.split("/").includes("node_modules"), "forbidden_git_path");
    entries.push(Object.freeze({ mode, oid: match[3]!, path: validatedPath }));
  }
  return Object.freeze(entries);
}

function includeEntry(relativePath: string, includes: readonly string[]): boolean {
  return includes.length === 0 || includes.some((include) =>
    relativePath === include || relativePath.startsWith(`${include}/`));
}

function parseGitBlobBatch(
  raw: Buffer,
  entries: readonly GitTreeEntry[],
  limits: BrandAuditLimits,
): readonly Buffer[] {
  failUnless(raw.length <= limits.maxArchiveBytes, "git_batch_too_large");
  const blobs: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const newline = raw.indexOf(0x0a, offset);
    failUnless(newline > offset && newline - offset <= 256, "invalid_git_batch_record");
    const header = raw.subarray(offset, newline).toString("ascii");
    const match = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) blob ([0-9]+)$/u.exec(header);
    failUnless(match !== null && match[1] === entry.oid, "invalid_git_batch_record");
    const size = Number(match[2]);
    failUnless(Number.isSafeInteger(size) && size >= 0, "invalid_git_batch_record");
    failUnless(size <= limits.maxBlobBytes, "git_blob_too_large");
    const bodyStart = newline + 1;
    const bodyEnd = bodyStart + size;
    failUnless(bodyEnd < raw.length && raw[bodyEnd] === 0x0a, "truncated_git_blob");
    blobs.push(Buffer.from(raw.subarray(bodyStart, bodyEnd)));
    offset = bodyEnd + 1;
  }
  failUnless(offset === raw.length, "invalid_git_batch_record");
  return Object.freeze(blobs);
}

function addFindings(
  output: BrandAuditFinding[],
  result: BrandAuditResult,
): void {
  output.push(...result.findings);
  failUnless(output.length <= MAX_PUBLIC_FINDINGS, "too_many_audit_findings");
}

/** Scan paths and blob bytes from one immutable Git commit without reading the worktree. */
export function scanGitTree(
  options: GitTreeScanOptions,
  dependencies: GitScanDependencies = {},
): GitTreeScanResult {
  failUnless(isPlainObject(options), "invalid_git_options");
  failUnless(typeof options.root === "string" && options.root.length > 0, "invalid_git_root");
  failUnless(validGitSubject(options.subject), "invalid_git_subject");
  failUnless(options.include === undefined || Array.isArray(options.include), "invalid_git_include");
  failUnless(isPlainObject(dependencies), "invalid_git_dependencies");
  failUnless(dependencies.runGit === undefined || typeof dependencies.runGit === "function", "invalid_git_dependencies");
  const limits = resolveLimits(options.limits);
  const includes = Object.freeze((options.include ?? []).map((value) => validateExactPath(value, limits)));
  failUnless(new Set(includes).size === includes.length, "duplicate_git_include");
  const runGit = dependencies.runGit ?? runGitCommand;
  const subject = parseSingleOid(
    runGit(options.root, ["rev-parse", "--verify", `${options.subject}^{commit}`], undefined, 1024),
    "invalid_git_subject",
  );
  if (GIT_OID_RE.test(options.subject)) failUnless(subject === options.subject, "invalid_git_subject");
  const tree = parseSingleOid(
    runGit(options.root, ["rev-parse", "--verify", `${subject}^{tree}`], undefined, 1024),
    "invalid_git_tree",
  );
  const allEntries = parseGitTree(
    runGit(options.root, ["ls-tree", "-r", "-z", "--full-tree", subject], undefined, limits.maxArchiveBytes),
    limits,
  );
  const entries = Object.freeze(allEntries.filter((entry) => includeEntry(entry.path, includes)));
  const batchInput = entries.length === 0
    ? Buffer.alloc(0)
    : Buffer.from(`${entries.map((entry) => entry.oid).join("\n")}\n`, "ascii");
  const blobs = entries.length === 0
    ? Object.freeze([] as Buffer[])
    : parseGitBlobBatch(
      runGit(options.root, ["cat-file", "--batch"], batchInput, limits.maxArchiveBytes),
      entries,
      limits,
    );
  const findings: BrandAuditFinding[] = [];
  for (const [index, entry] of entries.entries()) {
    addFindings(findings, scanBrandText(entry.path, { scope: "git_path", exactPath: entry.path, limits }));
    addFindings(findings, scanBrandText(blobs[index]!, { scope: "git_content", exactPath: entry.path, limits }));
  }
  return Object.freeze({
    schemaVersion: 1,
    scope: "git",
    subject,
    tree,
    scannedCount: entries.length,
    findingCount: findings.length,
    findings: Object.freeze(findings),
  });
}

/** Verify and scan every validated member of one immutable actual package archive. */
export function scanTarball(options: TarballScanOptions): TarballScanResult {
  failUnless(isPlainObject(options), "invalid_tarball_options");
  failUnless(Buffer.isBuffer(options.bytes), "invalid_tarball_bytes");
  failUnless(typeof options.expectedSha256 === "string" && /^[0-9a-f]{64}$/u.test(options.expectedSha256),
    "invalid_tarball_sha");
  failUnless(options.onPrivateFinding === undefined || typeof options.onPrivateFinding === "function",
    "invalid_tarball_options");
  const limits = resolveLimits(options.limits);
  failUnless(options.bytes.length <= limits.maxArchiveBytes, "tar_archive_too_large");
  const artifactSha256 = crypto.createHash("sha256").update(options.bytes).digest("hex");
  failUnless(
    crypto.timingSafeEqual(Buffer.from(artifactSha256, "ascii"), Buffer.from(options.expectedSha256, "ascii")),
    "tarball_sha_mismatch",
  );
  const entries = tarArchive.readTarArchive(options.bytes, {
    maxArchiveBytes: limits.maxArchiveBytes,
    maxInflatedBytes: limits.maxArchiveBytes,
    maxMemberBytes: limits.maxMemberBytes,
    maxEntries: limits.maxEntries,
    maxPathBytes: limits.maxPathBytes,
  });
  const findings: BrandAuditFinding[] = [];
  for (const entry of entries) {
    addFindings(findings, scanBrandText(entry.path, {
      scope: "tar_path",
      exactPath: entry.path,
      limits,
      ...(options.onPrivateFinding === undefined ? {} : { onPrivateFinding: options.onPrivateFinding }),
    }));
    if (entry.type === "file") {
      addFindings(findings, scanBrandText(entry.body, {
        scope: "tar_content",
        exactPath: entry.path,
        limits,
        ...(options.onPrivateFinding === undefined ? {} : { onPrivateFinding: options.onPrivateFinding }),
      }));
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    scope: "tar",
    artifactSha256,
    memberCount: entries.length,
    scannedCount: entries.length,
    findingCount: findings.length,
    findings: Object.freeze(findings),
  });
}

function parseGitArguments(argv: readonly string[]): { readonly subject: string; readonly include: readonly string[] } {
  failUnless(argv[0] === "git", "invalid_cli_arguments");
  let subject: string | undefined;
  const include: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    failUnless(value !== undefined, "invalid_cli_arguments");
    if (argument === "--subject") {
      failUnless(subject === undefined, "invalid_cli_arguments");
      subject = value;
    } else if (argument === "--include") {
      include.push(value);
    } else {
      throw new BrandAuditError("invalid_cli_arguments");
    }
    index += 1;
  }
  failUnless(subject !== undefined, "invalid_cli_arguments");
  failUnless(validGitSubject(subject), "invalid_git_subject");
  return Object.freeze({ subject, include: Object.freeze(include) });
}

/** Execute the mandatory audit CLI and emit exactly one metadata-only JSON document. */
export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const parsed = parseGitArguments(argv);
    const result = scanGitTree({ root: process.cwd(), subject: parsed.subject, include: parsed.include });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.findingCount === 0 ? 0 : 1;
  } catch (error) {
    const code = error instanceof BrandAuditError ? error.code : "brand_audit_failed";
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, scope: "git", ok: false, code })}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
