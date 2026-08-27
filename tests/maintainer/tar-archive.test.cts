const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const zlib = require("node:zlib") as typeof import("node:zlib");

interface TarArchiveLimits {
  readonly maxArchiveBytes: number;
  readonly maxInflatedBytes: number;
  readonly maxMemberBytes: number;
  readonly maxEntries: number;
  readonly maxPathBytes: number;
}

interface TarArchiveEntry {
  readonly path: string;
  readonly type: "file" | "directory";
  readonly body: Buffer;
}

interface TarArchiveModule {
  TarArchiveError: new (code: string) => Error & { readonly code: string };
  readTarArchive(input: Buffer, limits?: Partial<TarArchiveLimits>): readonly TarArchiveEntry[];
}

const tarArchive = require("../../dist/maintainer/tar-archive.cjs") as TarArchiveModule;

interface FixtureEntry {
  readonly name: string;
  readonly type?: number;
  readonly body?: Buffer;
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, "0");
  target.write(encoded, offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}

function header(entry: FixtureEntry): Buffer {
  const body = entry.body ?? Buffer.alloc(0);
  const output = Buffer.alloc(512);
  output.write(entry.name, 0, 100, "utf8");
  writeOctal(output, 100, 8, 0o644);
  writeOctal(output, 108, 8, 0);
  writeOctal(output, 116, 8, 0);
  writeOctal(output, 124, 12, body.length);
  writeOctal(output, 136, 12, 0);
  output.fill(0x20, 148, 156);
  output[156] = entry.type ?? 0x30;
  output.write("ustar\0", 257, 6, "ascii");
  output.write("00", 263, 2, "ascii");
  const checksum = output.reduce((sum, byte) => sum + byte, 0);
  output.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  output[154] = 0;
  output[155] = 0x20;
  return output;
}

function archive(entries: readonly FixtureEntry[], terminate = true): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const body = entry.body ?? Buffer.alloc(0);
    chunks.push(header(entry), body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  if (terminate) chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

function expectCode(call: () => unknown, code: string): void {
  assert.throws(call, (error: unknown) =>
    error instanceof Error && "code" in error && (error as Error & { code: string }).code === code);
}

test("reads bounded regular files and directories under the package root without extraction", () => {
  const input = archive([
    { name: "package/docs/", type: 0x35 },
    { name: "package/docs/readme.md", body: Buffer.from("neutral\n") },
    { name: "package/empty.txt", body: Buffer.alloc(0) },
  ]);
  const result = tarArchive.readTarArchive(input);
  assert.deepEqual(result.map((entry) => ({ path: entry.path, type: entry.type, body: entry.body.toString() })), [
    { path: "docs", type: "directory", body: "" },
    { path: "docs/readme.md", type: "file", body: "neutral\n" },
    { path: "empty.txt", type: "file", body: "" },
  ]);
  assert.ok(Object.isFrozen(result));
  assert.ok(result.every(Object.isFrozen));
});

test("rejects traversal, absolute, duplicate, link, special, and extension entries", () => {
  for (const [input, code] of [
    [archive([{ name: "package/../escape.txt" }]), "tar_unsafe_path"],
    [archive([{ name: "/absolute.txt" }]), "tar_invalid_root"],
    [archive([{ name: "package/a.txt" }, { name: "package/a.txt" }]), "tar_duplicate_path"],
    [archive([{ name: "package/link", type: 0x32 }]), "tar_unsupported_entry"],
    [archive([{ name: "package/device", type: 0x33 }]), "tar_unsupported_entry"],
    [archive([{ name: "package/pipe", type: 0x36 }]), "tar_unsupported_entry"],
    [archive([{ name: "package/metadata", type: 0x78 }]), "tar_unsupported_entry"],
    [archive([{ name: "package/long-name", type: 0x4c }]), "tar_unsupported_entry"],
  ] as const) {
    expectCode(() => tarArchive.readTarArchive(input), code);
  }
});

test("rejects checksum, truncation, padding, trailer, and resource ambiguity", () => {
  const badChecksum = archive([{ name: "package/a.txt", body: Buffer.from("a") }]);
  const rawChecksum = zlib.gunzipSync(badChecksum);
  rawChecksum[148] = rawChecksum[148] === 0x30 ? 0x31 : 0x30;
  expectCode(() => tarArchive.readTarArchive(zlib.gzipSync(rawChecksum)), "tar_checksum_invalid");

  expectCode(
    () => tarArchive.readTarArchive(archive([{ name: "package/a.txt" }], false)),
    "tar_truncated",
  );

  const badPaddingRaw = zlib.gunzipSync(archive([{ name: "package/a.txt", body: Buffer.from("a") }]));
  badPaddingRaw[513] = 1;
  expectCode(() => tarArchive.readTarArchive(zlib.gzipSync(badPaddingRaw)), "tar_padding_invalid");

  const badTrailerRaw = zlib.gunzipSync(archive([{ name: "package/a.txt" }]));
  badTrailerRaw[badTrailerRaw.length - 1] = 1;
  expectCode(() => tarArchive.readTarArchive(zlib.gzipSync(badTrailerRaw)), "tar_trailer_invalid");

  const oneFile = archive([{ name: "package/long.txt", body: Buffer.from("12345") }]);
  expectCode(() => tarArchive.readTarArchive(oneFile, { maxMemberBytes: 4 }), "tar_member_too_large");
  expectCode(() => tarArchive.readTarArchive(oneFile, { maxArchiveBytes: 4 }), "tar_archive_too_large");
  expectCode(() => tarArchive.readTarArchive(oneFile, { maxInflatedBytes: 512 }), "tar_inflated_too_large");
  expectCode(() => tarArchive.readTarArchive(oneFile, { maxPathBytes: 4 }), "tar_path_too_large");
  expectCode(
    () => tarArchive.readTarArchive(archive([{ name: "package/a" }, { name: "package/b" }]), { maxEntries: 1 }),
    "tar_too_many_entries",
  );
});

test("rejects malformed gzip and ambiguous limit objects with stable codes", () => {
  expectCode(() => tarArchive.readTarArchive(Buffer.from("not-gzip")), "tar_invalid_gzip");
  expectCode(() => tarArchive.readTarArchive(Buffer.alloc(0)), "tar_invalid_gzip");
  expectCode(() => tarArchive.readTarArchive(archive([]), { maxEntries: 0 }), "invalid_tar_limits");
  expectCode(
    () => tarArchive.readTarArchive(archive([]), { extra: 1 } as unknown as Partial<TarArchiveLimits>),
    "invalid_tar_limits",
  );
});
