const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const zlib = require("node:zlib") as typeof import("node:zlib");

type CandidateConsumer = "pack-audit" | "tar-scan" | "host-smoke" | "workflow-upload";

interface CandidatePackageArtifact {
  readonly name: "kcoderag-nav";
  readonly version: string;
  readonly sha256: string;
  readonly memberCount: number;
  readonly dryRunCount: 1;
  readonly actualPackCount: 1;
}

interface CandidatePackageArtifactLease {
  readonly artifact: CandidatePackageArtifact;
  dispose(): void;
}

interface ReleaseReadinessModule {
  ReleaseReadinessError: new (code: string) => Error & { readonly code: string };
  CandidatePackageArtifactError: new (code: string) => Error & { readonly code: string };
  createCandidatePackageArtifact(
    options: {
      readonly root: string;
      readonly consumers?: readonly CandidateConsumer[];
    },
    dependencies?: {
      readonly runNpm?: (root: string, args: readonly string[]) => Buffer;
    },
  ): CandidatePackageArtifactLease;
  withCandidatePackageBytes<T>(
    lease: CandidatePackageArtifactLease,
    consumer: CandidateConsumer,
    callback: (bytes: Buffer, artifact: CandidatePackageArtifact) => T,
  ): T;
  runReleaseReadiness(options: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
}

const readiness = require("../../dist/maintainer/release-readiness.cjs") as ReleaseReadinessModule;

interface FixtureEntry {
  readonly name: string;
  readonly body: Buffer;
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void {
  target.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}

function tarHeader(entry: FixtureEntry): Buffer {
  const output = Buffer.alloc(512);
  output.write(entry.name, 0, 100, "utf8");
  writeOctal(output, 100, 8, 0o644);
  writeOctal(output, 108, 8, 0);
  writeOctal(output, 116, 8, 0);
  writeOctal(output, 124, 12, entry.body.length);
  writeOctal(output, 136, 12, 0);
  output.fill(0x20, 148, 156);
  output[156] = 0x30;
  output.write("ustar\0", 257, 6, "ascii");
  output.write("00", 263, 2, "ascii");
  const checksum = output.reduce((sum, byte) => sum + byte, 0);
  output.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  output[154] = 0;
  output[155] = 0x20;
  return output;
}

function archive(entries: readonly FixtureEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(tarHeader(entry), entry.body);
    const padding = (512 - (entry.body.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

function packageRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-candidate-source-"));
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    name: "kcoderag-nav",
    version: "0.3.0",
  })}\n`, "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "neutral candidate\n", "utf8");
  return root;
}

function manifest(files: readonly string[]): Buffer {
  return Buffer.from(JSON.stringify([{
    name: "kcoderag-nav",
    version: "0.3.0",
    filename: "kcoderag-nav-0.3.0.tgz",
    files: files.map((relativePath) => ({ path: relativePath })),
  }]), "utf8");
}

function runner(bytes: Buffer, dryFiles: readonly string[] = ["README.md", "package.json"]): {
  readonly runNpm: (root: string, args: readonly string[]) => Buffer;
  readonly counts: { dry: number; actual: number };
} {
  const counts = { dry: 0, actual: 0 };
  return {
    counts,
    runNpm: (_root, args) => {
      if (args.includes("--dry-run")) {
        counts.dry += 1;
        return manifest(dryFiles);
      }
      counts.actual += 1;
      const destinationIndex = args.indexOf("--pack-destination");
      const destination = args[destinationIndex + 1];
      assert.equal(typeof destination, "string");
      fs.writeFileSync(path.join(destination as string, "kcoderag-nav-0.3.0.tgz"), bytes);
      return manifest(dryFiles);
    },
  };
}

function expectCode(call: () => unknown, code: string): void {
  assert.throws(call, (error: unknown) =>
    error instanceof Error && "code" in error && (error as Error & { code: string }).code === code);
}

test("dry-run count and actual pack count share one immutable injected artifact", () => {
  const root = packageRoot();
  const bytes = archive([
    { name: "package/README.md", body: Buffer.from("neutral candidate\n") },
    { name: "package/package.json", body: Buffer.from('{"name":"kcoderag-nav","version":"0.3.0"}\n') },
  ]);
  const npm = runner(bytes);
  try {
    const lease = readiness.createCandidatePackageArtifact({
      root,
      consumers: ["pack-audit", "tar-scan", "host-smoke"],
    }, npm);
    assert.deepEqual(lease.artifact, {
      name: "kcoderag-nav",
      version: "0.3.0",
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      memberCount: 2,
      dryRunCount: 1,
      actualPackCount: 1,
    });
    assert.deepEqual(npm.counts, { dry: 1, actual: 1 });

    const serialized = JSON.stringify(lease);
    assert.deepEqual(JSON.parse(serialized), lease.artifact);
    assert.doesNotMatch(serialized, /path|bytes|handle|candidate-source|\.tgz/iu);
    assert.deepEqual(Object.keys(structuredClone(lease)), []);

    const observed: Buffer[] = [];
    for (const consumer of ["pack-audit", "tar-scan", "host-smoke"] as const) {
      readiness.withCandidatePackageBytes(lease, consumer, (snapshot, artifact) => {
        observed.push(snapshot);
        assert.equal(artifact, lease.artifact);
        assert.equal(crypto.createHash("sha256").update(snapshot).digest("hex"), artifact.sha256);
      });
    }
    assert.equal(observed[0], observed[1]);
    assert.equal(observed[1], observed[2]);
    expectCode(
      () => readiness.withCandidatePackageBytes(lease, "workflow-upload", () => undefined),
      "artifact_disposed",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dry-run count rejects zero duplicate and malformed predicted paths before actual pack", () => {
  const invalid = [
    [],
    ["README.md", "README.md"],
    ["../escape.md"],
  ] as const;
  for (const files of invalid) {
    const root = packageRoot();
    const npm = runner(archive([{ name: "package/README.md", body: Buffer.from("neutral\n") }]), files);
    try {
      expectCode(
        () => readiness.createCandidatePackageArtifact({ root, consumers: ["pack-audit"] }, npm),
        "pack_manifest_invalid",
      );
      assert.deepEqual(npm.counts, { dry: 1, actual: 0 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("injected artifact mutation fails closed and prevents the next consumer", () => {
  const root = packageRoot();
  const bytes = archive([{ name: "package/README.md", body: Buffer.from("neutral\n") }]);
  const npm = runner(bytes, ["README.md"]);
  try {
    const lease = readiness.createCandidatePackageArtifact({
      root,
      consumers: ["pack-audit", "tar-scan"],
    }, npm);
    expectCode(
      () => readiness.withCandidatePackageBytes(lease, "pack-audit", (snapshot) => {
        snapshot[0] = (snapshot[0] ?? 0) ^ 1;
      }),
      "artifact_integrity_failed",
    );
    expectCode(
      () => readiness.withCandidatePackageBytes(lease, "tar-scan", () => undefined),
      "artifact_disposed",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const CANONICAL_SKILL_PATHS = Object.freeze([
  "plugin-src/capabilities/code-style-nudge/skill/SKILL.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/cpp-lifetime-control-flow.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/protocol-serialization-data.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/lua-contracts.md",
  "plugin-src/capabilities/code-style-nudge/skill/references/change-hygiene-self-review.md",
] as const);

const LOCAL_CHECK_NAMES = Object.freeze([
  "dependency-audit", "build", "full-tests", "generated-qa", "generated-cursor",
  "docs-check", "local-guide", "retirement-audit", "git-brand-audit", "pack-audit",
  "tar-brand-audit", "required-smoke",
] as const);

function git(root: string, args: readonly string[]): string {
  return childProcess.execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeFixture(root: string, relativePath: string, contents: string): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents, "utf8");
}

function readinessFixture(): {
  readonly root: string;
  readonly reviewedSubject: string;
  readonly candidateSubject: string;
  readonly receiptPath: string;
  readonly artifact: CandidatePackageArtifact;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-readiness-core-"));
  git(root, ["init", "--quiet", "--initial-branch=master"]);
  git(root, ["config", "user.email", "tests@example.invalid"]);
  git(root, ["config", "user.name", "KCodeRag Tests"]);
  for (const [index, relativePath] of CANONICAL_SKILL_PATHS.entries()) {
    writeFixture(root, relativePath, `canonical-${index}\n`);
  }
  writeFixture(root, "docs/MCP_QA_EXPERIENCE_GUIDE.md", "local authority\n");
  writeFixture(root, "dist/bin/kcoderag-nav.cjs", "#!/usr/bin/env node\n");
  writeFixture(root, "kcoderag-cursor/.cursor-plugin/plugin.json", '{"name":"kcoderag-nav","version":"0.3.0"}\n');
  writeFixture(root, "kcoderag-qa/.claude-plugin/plugin.json", '{"name":"kcoderag-qa","version":"0.3.0"}\n');
  writeFixture(root, "kcoderag-qa/.codex-plugin/plugin.json", '{"name":"kcoderag-qa","version":"0.3.0"}\n');
  writeFixture(root, "package.json", JSON.stringify({
    name: "kcoderag-nav",
    version: "0.3.0",
    files: ["dist/bin/kcoderag-nav.cjs", "docs/MCP_QA_EXPERIENCE_GUIDE.md"],
  }, null, 2) + "\n");
  writeFixture(root, "package-lock.json", JSON.stringify({
    name: "kcoderag-nav", version: "0.3.0", lockfileVersion: 3,
    packages: { "": { name: "kcoderag-nav", version: "0.3.0" } },
  }, null, 2) + "\n");
  git(root, ["add", "--", "."]);
  git(root, ["commit", "--quiet", "-m", "reviewed"]);
  const reviewedSubject = git(root, ["rev-parse", "HEAD"]);
  const blobDigests = Object.fromEntries(CANONICAL_SKILL_PATHS.map((relativePath) => [
    relativePath,
    crypto.createHash("sha256").update(fs.readFileSync(path.join(root, ...relativePath.split("/")))).digest("hex"),
  ]));
  writeFixture(root, "docs/review-note.md", "documentation child\n");
  git(root, ["add", "--", "docs/review-note.md"]);
  git(root, ["commit", "--quiet", "-m", "candidate"]);
  const candidateSubject = git(root, ["rev-parse", "HEAD"]);
  const receiptPath = path.join(root, "semantic-review.json");
  fs.writeFileSync(receiptPath, JSON.stringify({
    schemaVersion: 1,
    verdict: "PASS",
    reviewedSubject,
    reviewedTree: git(root, ["rev-parse", `${reviewedSubject}^{tree}`]),
    entryPath: CANONICAL_SKILL_PATHS[0],
    referencePaths: [...CANONICAL_SKILL_PATHS.slice(1)],
    blobDigests,
    ruleCounts: { R: 19, S: 8 },
    behaviorCaseCount: 15,
  }, null, 2) + "\n");
  return {
    root,
    reviewedSubject,
    candidateSubject,
    receiptPath,
    artifact: Object.freeze({
      name: "kcoderag-nav",
      version: "0.3.0",
      sha256: "a".repeat(64),
      memberCount: 7,
      dryRunCount: 1,
      actualPackCount: 1,
    }),
  };
}

function readinessOptions(fixture: ReturnType<typeof readinessFixture>): Readonly<Record<string, unknown>> {
  return {
    root: fixture.root,
    candidateSubject: fixture.candidateSubject,
    semanticReviewReceipt: fixture.receiptPath,
    artifact: fixture.artifact,
    checks: LOCAL_CHECK_NAMES.map((name) => ({ name, conclusion: "PASS" })),
  };
}

test("exact 0.3.0 local readiness remains BLOCKED until four platform lanes exist", () => {
  const fixture = readinessFixture();
  try {
    const before = {
      head: git(fixture.root, ["rev-parse", "HEAD"]),
      status: git(fixture.root, ["status", "--porcelain=v1"]),
      refs: git(fixture.root, ["show-ref", "--head"]),
    };
    const result = readiness.runReleaseReadiness(readinessOptions(fixture));
    assert.equal(result.result, "BLOCKED");
    assert.equal(result.candidateSubject, fixture.candidateSubject);
    assert.equal(result.packageVersion, "0.3.0");
    assert.equal(result.platformLanes, "NOT_RUN");
    assert.deepEqual(result.externalActions, {
      tag: "NOT_RUN_BY_SCOPE",
      publish: "NOT_RUN_BY_SCOPE",
      registry_refetch: "NOT_RUN_BY_SCOPE",
    });
    assert.deepEqual({
      head: git(fixture.root, ["rev-parse", "HEAD"]),
      status: git(fixture.root, ["status", "--porcelain=v1"]),
      refs: git(fixture.root, ["show-ref", "--head"]),
    }, before);
    assert.doesNotMatch(JSON.stringify(result), /semantic-review\.json|example\.invalid|Bearer/iu);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("semantic PASS is revalidated from both Git subjects and rejects stale, reordered, extra, or missing blobs", () => {
  for (const scenario of ["stale", "reordered", "extra", "missing"] as const) {
    const fixture = readinessFixture();
    try {
      const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8")) as Record<string, any>;
      if (scenario === "stale") {
        writeFixture(fixture.root, CANONICAL_SKILL_PATHS[0], "changed after review\n");
        git(fixture.root, ["add", "--", CANONICAL_SKILL_PATHS[0]]);
        git(fixture.root, ["commit", "--quiet", "-m", "stale"]);
        (readinessOptions(fixture) as Record<string, unknown>).candidateSubject = git(fixture.root, ["rev-parse", "HEAD"]);
      } else if (scenario === "reordered") {
        receipt.referencePaths.reverse();
      } else if (scenario === "extra") {
        receipt.referencePaths.push("plugin-src/capabilities/code-style-nudge/skill/references/extra.md");
      } else {
        receipt.referencePaths.pop();
      }
      if (scenario !== "stale") fs.writeFileSync(fixture.receiptPath, JSON.stringify(receipt));
      assert.throws(
        () => readiness.runReleaseReadiness(readinessOptions(fixture)),
        (error: unknown) => (error as { code?: unknown }).code === "semantic_review_stale",
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
