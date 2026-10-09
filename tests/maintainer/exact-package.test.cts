const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const zlib = require("node:zlib") as typeof import("node:zlib");
interface Manifest {
  readonly schemaVersion: 1; readonly name: "kcoderag-nav"; readonly version: string;
  readonly candidateSha: string; readonly sha256: string; readonly integrity: string;
  readonly memberCount: number; readonly memberDigest: string;
}
const exact = require("../../dist/maintainer/exact-package.cjs") as {
  assertCandidateCheckout(root: string, candidateSha: string): void;
  digest(bytes: Buffer | string): string;
  describePackage(bytes: Buffer, candidateSha: string): Manifest;
  verifyPackage(root: string, candidateSha: string, manifestSha: string): { manifest: Manifest; tarballPath: string };
  producePackage(root: string, output: string, candidateSha: string): unknown;
  smokePackage(root: string, candidateSha: string, manifestSha: string, receipt: string): Promise<boolean>;
};
const subject = "a".repeat(40);
function tar(entries: readonly (readonly [string, string])[]): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, content] of entries) {
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(`package/${name}`);
    const octal = (offset: number, length: number, value: number): void => {
      header.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1, "ascii");
    };
    octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0);
    octal(124, 12, body.length); octal(136, 12, 0);
    header.fill(32, 148, 156); header[156] = 48;
    header.write("ustar\0", 257, 6); header.write("00", 263, 2);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0"), 148, 6);
    header[154] = 0; header[155] = 32;
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return zlib.gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
const entries = [["package.json", '{"name":"kcoderag-nav","version":"1.2.3"}'], ["Z.txt", "Z"], ["a.txt", "a"]] as const;
function fixture(run: (root: string, manifest: Manifest, manifestSha: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-exact-package-test-"));
  try {
    const bytes = tar(entries);
    const manifest = exact.describePackage(bytes, subject);
    fs.mkdirSync(path.join(root, "package"));
    fs.writeFileSync(path.join(root, "package/candidate.tgz"), bytes);
    const manifestBytes = `${JSON.stringify(manifest)}\n`;
    fs.writeFileSync(path.join(root, "manifest.json"), manifestBytes);
    run(root, manifest, exact.digest(manifestBytes));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function code(call: () => unknown, expected: string): void {
  assert.throws(call, (error: unknown) => error instanceof Error && "code" in error && error.code === expected);
}

test("exact package digest is byte-bound while member digest is independent of archive order and locale", () => {
  const first = exact.describePackage(tar(entries), subject);
  const reversed = exact.describePackage(tar([...entries].reverse()), subject);
  assert.equal(first.memberCount, 3);
  assert.equal(first.memberDigest, reversed.memberDigest);
  assert.notEqual(first.sha256, reversed.sha256);
  assert.match(first.integrity, /^sha512-[A-Za-z0-9+/]+=*$/u);
  const members = [...entries].sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([name, body]) => [name, "file", Buffer.byteLength(body), exact.digest(body)]);
  assert.equal(first.memberDigest, exact.digest(JSON.stringify(members)));
  code(() => exact.describePackage(tar(entries), "master"), "candidate_invalid");
  code(() => exact.describePackage(tar([["package.json", '{"name":"other","version":"1.2.3"}']]), subject), "package_identity_invalid");
});

test("consumer accepts only the complete immutable producer manifest and exact subject", () => {
  fixture((root, manifest, hash) => {
    assert.deepEqual(exact.verifyPackage(root, subject, hash).manifest, manifest);
    code(() => exact.verifyPackage(root, "b".repeat(40), hash), "package_manifest_mismatch");
    code(() => exact.verifyPackage(root, subject, "f".repeat(64)), "manifest_hash_mismatch");
    fs.writeFileSync(path.join(root, "package/candidate.tgz"), tar([...entries, ["extra.txt", "tamper"]]));
    code(() => exact.verifyPackage(root, subject, hash), "package_manifest_mismatch");
  });
});

test("consumer rejects extra artifact inventory, changed member metadata and unknown manifest keys", () => {
  fixture((root, manifest, hash) => {
    fs.writeFileSync(path.join(root, "unexpected.txt"), "x");
    code(() => exact.verifyPackage(root, subject, hash), "artifact_inventory_invalid");
    fs.unlinkSync(path.join(root, "unexpected.txt"));
    for (const changed of [{ ...manifest, memberCount: 99 }, { ...manifest, accepted: true }]) {
      const bytes = JSON.stringify(changed);
      fs.writeFileSync(path.join(root, "manifest.json"), bytes);
      code(() => exact.verifyPackage(root, subject, exact.digest(bytes)), "package_manifest_mismatch");
    }
  });
});

test("consumer rejects symlink artifact files rather than following them", { skip: process.platform === "win32" }, () => {
  fixture((root, _manifest, hash) => {
    const original = path.join(root, "package/candidate.tgz");
    const moved = `${root}-target.tgz`;
    fs.renameSync(original, moved);
    fs.symlinkSync(moved, original);
    try {
      code(() => exact.verifyPackage(root, subject, hash), "artifact_file_invalid");
    } finally { fs.unlinkSync(moved); }
  });
});

test("producer rejects a different candidate before packing or creating output", () => {
  const root = path.resolve(__dirname, "../..");
  const output = path.join(os.tmpdir(), `kcoderag-should-not-produce-${process.pid}`);
  code(() => exact.producePackage(root, output, "0".repeat(40)), "candidate_mismatch");
  assert.equal(fs.existsSync(output), false);
});


test("candidate binding rejects dirty source, generated files and untracked inputs while allowing ignored compilation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-candidate-source-"));
  const git = (args: readonly string[]): string => childProcess.execFileSync("git", [...args],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    git(["init"]);
    fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n");
    fs.writeFileSync(path.join(root, "source.cts"), "original source\n");
    fs.writeFileSync(path.join(root, "generated.json"), "{}\n");
    git(["add", "."]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Fixture"]);
    const head = git(["rev-parse", "HEAD"]);
    fs.mkdirSync(path.join(root, "dist"));
    fs.writeFileSync(path.join(root, "dist/compiled.cjs"), "compiled output");
    assert.doesNotThrow(() => exact.assertCandidateCheckout(root, head));
    for (const [file, original] of [["source.cts", "original source\n"], ["generated.json", "{}\n"]] as const) {
      fs.writeFileSync(path.join(root, file), "dirty");
      code(() => exact.assertCandidateCheckout(root, head), "candidate_checkout_dirty");
      fs.writeFileSync(path.join(root, file), original);
    }
    fs.writeFileSync(path.join(root, "untracked-input.txt"), "new input");
    code(() => exact.assertCandidateCheckout(root, head), "candidate_checkout_dirty");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test("smoke consumption preserves the caller archive after success, rejection and thrown failure", async (context) => {
  const smoke = require("../../dist/smoke/host-smoke.cjs") as {
    runHostSmoke(options: { artifactLease: unknown }): Promise<unknown>;
  };
  const readiness = require("../../dist/maintainer/release-readiness.cjs") as {
    withCandidatePackageBytes(lease: unknown, consumer: "host-smoke", consume: (bytes: Buffer) => void): void;
  };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-smoke-ownership-"));
  const originalRunnerTemp = process.env.RUNNER_TEMP;
  const artifactRoot = path.join(temporary, "producer");
  const runnerTemp = path.join(temporary, "runner");
  const receipt = path.join(temporary, "receipt.json");
  const bytes = tar(entries);
  const manifest = exact.describePackage(bytes, subject);
  const manifestBytes = `${JSON.stringify(manifest)}\n`;
  let outcome: "pass" | "reject" | "throw" | "copy_tamper" = "pass";
  let consumed = 0;
  const copyFile = fs.copyFileSync;
  context.mock.method(fs, "copyFileSync", (source: import("node:fs").PathLike, destination: import("node:fs").PathLike, mode?: number) => {
    copyFile(source, destination, mode);
    if (outcome === "copy_tamper") fs.writeFileSync(destination, tar([...entries, ["tampered.txt", "changed after verification"]]));
  });
  context.mock.method(smoke, "runHostSmoke", async (options: { artifactLease: unknown }) => {
    readiness.withCandidatePackageBytes(options.artifactLease, "host-smoke", (copy) => {
      assert.deepEqual(copy, bytes);
      consumed += 1;
    });
    if (outcome === "throw") throw new Error("fixture_smoke_failure");
    return {
      status: outcome === "pass" ? "PASS" : "FAIL",
      hosts: ["codex", "claude", "cursor", "opencode", "zcode"].map((host) => ({ host, status: "PASS", evidenceLevel: "PACKAGED" })),
      provenance: { lifecycleTarballSha256: manifest.sha256, artifactMemberCount: manifest.memberCount },
    };
  });
  try {
    fs.mkdirSync(path.join(artifactRoot, "package"), { recursive: true });
    fs.mkdirSync(runnerTemp);
    fs.writeFileSync(path.join(runnerTemp, "caller-sentinel"), "keep");
    fs.writeFileSync(path.join(artifactRoot, "package/candidate.tgz"), bytes);
    fs.writeFileSync(path.join(artifactRoot, "manifest.json"), manifestBytes);
    process.env.RUNNER_TEMP = runnerTemp;
    for (outcome of ["pass", "reject", "throw", "copy_tamper"] as const) {
      if (outcome === "throw") {
        await assert.rejects(exact.smokePackage(artifactRoot, subject, exact.digest(manifestBytes), receipt), /fixture_smoke_failure/u);
      } else if (outcome === "copy_tamper") {
        await assert.rejects(exact.smokePackage(artifactRoot, subject, exact.digest(manifestBytes), receipt), /downloaded_artifact_identity_invalid/u);
      } else {
        assert.equal(await exact.smokePackage(artifactRoot, subject, exact.digest(manifestBytes), receipt), outcome === "pass");
      }
      assert.deepEqual(fs.readFileSync(path.join(artifactRoot, "package/candidate.tgz")), bytes);
      assert.equal(fs.readFileSync(path.join(artifactRoot, "manifest.json"), "utf8"), manifestBytes);
      assert.deepEqual(exact.verifyPackage(artifactRoot, subject, exact.digest(manifestBytes)).manifest, manifest);
      assert.deepEqual(fs.readdirSync(runnerTemp), ["caller-sentinel"]);
    }
    assert.equal(consumed, 3);
  } finally {
    if (originalRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = originalRunnerTemp;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
