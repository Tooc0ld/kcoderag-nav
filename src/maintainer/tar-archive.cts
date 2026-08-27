/** Bounded, non-extracting reader for actual npm gzip/tar package bytes. */

const zlib = require("node:zlib") as typeof import("node:zlib");

export interface TarArchiveLimits {
  readonly maxArchiveBytes: number;
  readonly maxInflatedBytes: number;
  readonly maxMemberBytes: number;
  readonly maxEntries: number;
  readonly maxPathBytes: number;
}

export interface TarArchiveEntry {
  readonly path: string;
  readonly type: "file" | "directory";
  readonly body: Buffer;
}

export class TarArchiveError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "TarArchiveError";
    this.code = code;
  }
}

export const DEFAULT_TAR_ARCHIVE_LIMITS: TarArchiveLimits = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxInflatedBytes: 64 * 1024 * 1024,
  maxMemberBytes: 8 * 1024 * 1024,
  maxEntries: 4096,
  maxPathBytes: 4096,
});

const LIMIT_KEYS = Object.freeze([
  "maxArchiveBytes",
  "maxInflatedBytes",
  "maxMemberBytes",
  "maxEntries",
  "maxPathBytes",
] as const);

function failUnless(condition: unknown, code: string): asserts condition {
  if (!condition) throw new TarArchiveError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function resolveLimits(value: Partial<TarArchiveLimits> | undefined): TarArchiveLimits {
  if (value === undefined) return DEFAULT_TAR_ARCHIVE_LIMITS;
  failUnless(isPlainObject(value), "invalid_tar_limits");
  failUnless(Object.keys(value).every((key) => LIMIT_KEYS.includes(key as (typeof LIMIT_KEYS)[number])),
    "invalid_tar_limits");
  const output: Record<(typeof LIMIT_KEYS)[number], number> = { ...DEFAULT_TAR_ARCHIVE_LIMITS };
  for (const key of LIMIT_KEYS) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    failUnless(Number.isSafeInteger(candidate) && candidate > 0 && candidate <= DEFAULT_TAR_ARCHIVE_LIMITS[key],
      "invalid_tar_limits");
    output[key] = candidate;
  }
  return Object.freeze(output);
}

function readField(input: Buffer, code: string): string {
  const end = input.indexOf(0);
  const valueEnd = end < 0 ? input.length : end;
  if (end >= 0) failUnless(input.subarray(end).every((byte) => byte === 0), code);
  try {
    const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.subarray(0, valueEnd));
    failUnless(!value.includes("\ufeff") && !/[\0\r\n\t]/u.test(value), code);
    return value;
  } catch (error) {
    if (error instanceof TarArchiveError) throw error;
    throw new TarArchiveError(code);
  }
}

function parseOctal(input: Buffer, code: string): number {
  const value = input.toString("ascii").replace(/\0.*$/u, "").trim();
  failUnless(/^[0-7]+$/u.test(value), code);
  const parsed = Number.parseInt(value, 8);
  failUnless(Number.isSafeInteger(parsed) && parsed >= 0, code);
  return parsed;
}

function headerChecksum(header: Buffer): number {
  let checksum = 0;
  for (let index = 0; index < header.length; index += 1) {
    checksum += index >= 148 && index < 156 ? 0x20 : header[index]!;
  }
  return checksum;
}

function packagePath(headerPath: string, directory: boolean, limits: TarArchiveLimits): string {
  failUnless(headerPath.startsWith("package/"), "tar_invalid_root");
  let relativePath = headerPath.slice("package/".length);
  if (directory && relativePath.endsWith("/")) relativePath = relativePath.slice(0, -1);
  failUnless(relativePath.length > 0, "tar_invalid_root");
  failUnless(Buffer.byteLength(relativePath, "utf8") <= limits.maxPathBytes, "tar_path_too_large");
  failUnless(
    !relativePath.startsWith("/")
    && !relativePath.includes("\\")
    && !/[\0\r\n\t]/u.test(relativePath)
    && !/^[a-z]:/iu.test(relativePath),
    "tar_unsafe_path",
  );
  const components = relativePath.split("/");
  failUnless(components.every((component) => component.length > 0 && component !== "." && component !== ".."),
    "tar_unsafe_path");
  return relativePath;
}

function inflateArchive(input: Buffer, limits: TarArchiveLimits): Buffer {
  failUnless(input.length > 0, "tar_invalid_gzip");
  failUnless(input.length <= limits.maxArchiveBytes, "tar_archive_too_large");
  try {
    return zlib.gunzipSync(input, { maxOutputLength: limits.maxInflatedBytes });
  } catch (error) {
    const code = error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE"
      ? "tar_inflated_too_large"
      : "tar_invalid_gzip";
    throw new TarArchiveError(code);
  }
}

/** Parse one actual npm tgz in memory; no entry is ever materialized on disk. */
export function readTarArchive(
  input: Buffer,
  limitOverrides?: Partial<TarArchiveLimits>,
): readonly TarArchiveEntry[] {
  failUnless(Buffer.isBuffer(input), "tar_invalid_input");
  const limits = resolveLimits(limitOverrides);
  const tar = inflateArchive(input, limits);
  const entries: TarArchiveEntry[] = [];
  const normalizedPaths = new Set<string>();
  let offset = 0;
  let terminated = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      failUnless(offset + 1024 <= tar.length, "tar_truncated");
      failUnless(tar.subarray(offset + 512, offset + 1024).every((byte) => byte === 0), "tar_trailer_invalid");
      failUnless(tar.subarray(offset + 1024).every((byte) => byte === 0), "tar_trailer_invalid");
      terminated = true;
      break;
    }

    failUnless(header.subarray(257, 263).equals(Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72, 0x00])),
      "tar_header_invalid");
    failUnless(header.subarray(263, 265).equals(Buffer.from([0x30, 0x30])), "tar_header_invalid");
    const expectedChecksum = parseOctal(header.subarray(148, 156), "tar_checksum_invalid");
    failUnless(headerChecksum(header) === expectedChecksum, "tar_checksum_invalid");

    const name = readField(header.subarray(0, 100), "tar_path_encoding_invalid");
    const prefix = readField(header.subarray(345, 500), "tar_path_encoding_invalid");
    const headerPath = prefix.length === 0 ? name : `${prefix}/${name}`;
    const size = parseOctal(header.subarray(124, 136), "tar_size_invalid");
    failUnless(size <= limits.maxMemberBytes, "tar_member_too_large");
    const typeByte = header[156] ?? 0;
    const type = typeByte === 0 || typeByte === 0x30
      ? "file"
      : typeByte === 0x35
        ? "directory"
        : undefined;
    failUnless(type !== undefined, "tar_unsupported_entry");
    if (type === "directory") failUnless(size === 0, "tar_directory_body");

    const relativePath = packagePath(headerPath, type === "directory", limits);
    const normalizedPath = relativePath.normalize("NFC");
    failUnless(!normalizedPaths.has(normalizedPath), "tar_duplicate_path");
    normalizedPaths.add(normalizedPath);
    failUnless(entries.length < limits.maxEntries, "tar_too_many_entries");

    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    const paddedEnd = bodyStart + Math.ceil(size / 512) * 512;
    failUnless(bodyEnd <= tar.length && paddedEnd <= tar.length, "tar_truncated");
    failUnless(tar.subarray(bodyEnd, paddedEnd).every((byte) => byte === 0), "tar_padding_invalid");
    entries.push(Object.freeze({
      path: relativePath,
      type,
      body: Buffer.from(tar.subarray(bodyStart, bodyEnd)),
    }));
    offset = paddedEnd;
  }
  failUnless(terminated, "tar_truncated");
  return Object.freeze(entries);
}
