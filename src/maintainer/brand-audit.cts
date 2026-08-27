/** Pure closed-family matching and strict text decoding for readiness audits. */

const crypto = require("node:crypto") as typeof import("node:crypto");

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
  failUnless(!input.includes("\\") && !input.includes("\0") && !input.startsWith("/") && !/^[a-z]:/iu.test(input),
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
    left.offset - right.offset || left.familyId.localeCompare(right.familyId, "en")));
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

export function scanBrandText(input: unknown, options: ScanBrandTextOptions): BrandAuditResult {
  failUnless(isPlainObject(options), "invalid_audit_options");
  failUnless(typeof options.scope === "string" && VALID_SCOPES.has(options.scope), "invalid_audit_scope");
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
  return Object.freeze({
    ok: findings.length === 0,
    findingCount: findings.length,
    findings,
  });
}
