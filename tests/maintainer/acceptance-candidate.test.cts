const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const childProcess = require("node:child_process") as typeof import("node:child_process");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type GateName = "build" | "test" | "generated" | "pack" | "smoke" | "workflow" | "candidate-tests";

interface AcceptanceCandidate {
  readonly schemaVersion: 1;
  readonly candidateSha: string;
  readonly candidateTreeSha: string;
  readonly packageVersion: string;
  readonly packageSha256: string;
  readonly packageMemberDigest: string;
  readonly workflowBlobSha: string;
  readonly packageContractDigest: string;
  readonly preparedAt: string;
}

interface CandidateModule {
  readonly CANDIDATE_GATE_NAMES: readonly GateName[];
  prepareAcceptanceCandidate(
    options: { readonly root: string; readonly preparedAt: string },
    dependencies: {
      readonly runGit?: (root: string, args: readonly string[]) => string;
      readonly runGate: (root: string, gate: GateName) => boolean;
      readonly packCandidate: (root: string, candidateSha: string) => Readonly<{
        bytes: Buffer;
        sha256: string;
        memberCount: number;
      }>;
    },
  ): AcceptanceCandidate;
  parseAcceptanceCandidate(value: unknown): AcceptanceCandidate;
  writeAcceptanceCandidate(outputPath: string, candidate: AcceptanceCandidate): void;
  verifyRemoteCandidate(candidate: AcceptanceCandidate, remoteSha: string): boolean;
}

const candidateModule = require("../../dist/maintainer/acceptance-candidate.cjs") as CandidateModule;

function git(root: string, args: readonly string[]): string {
  return childProcess.execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-candidate-test-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "runtime.cts"), "export const value = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, ".github", "workflows", "acceptance.yml"), "name: acceptance\n", "utf8");
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    name: "fixture",
    version: "1.2.3",
    files: ["dist/runtime.cjs"],
  }, null, 2)}\n`, "utf8");
  git(root, ["init", "--quiet", "--initial-branch=master"]);
  git(root, ["config", "user.email", "tests@example.invalid"]);
  git(root, ["config", "user.name", "KCodeRag Tests"]);
  git(root, ["add", "--", ".github/workflows/acceptance.yml", "package.json", "src/runtime.cts"]);
  git(root, ["commit", "--quiet", "-m", "candidate"]);
  return root;
}

function sha256(bytes: string | Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function dependencies(bytes = Buffer.from("candidate-tgz", "utf8")) {
  return {
    runGate: (_root: string, _gate: GateName) => true,
    packCandidate: (_root: string, _candidateSha: string) => ({
      bytes,
      sha256: sha256(bytes),
      memberCount: 81,
    }),
  };
}

function expectCode(call: () => unknown, code: string): void {
  assert.throws(call, (error: unknown) =>
    error instanceof Error && "code" in error && (error as Error & { code: string }).code === code);
}

test("prepares one exact product commit, tree, workflow and actual package identity", () => {
  const root = fixture();
  try {
    const preparedAt = "2026-09-02T00:00:00.000Z";
    const value = candidateModule.prepareAcceptanceCandidate({ root, preparedAt }, dependencies());
    const candidateSha = git(root, ["rev-parse", "HEAD"]);
    const packageBytes = Buffer.from("candidate-tgz", "utf8");
    const packageSha256 = sha256(packageBytes);
    assert.deepEqual(value, {
      schemaVersion: 1,
      candidateSha,
      candidateTreeSha: git(root, ["rev-parse", "HEAD^{tree}"]),
      packageVersion: "1.2.3",
      packageSha256,
      packageMemberDigest: sha256(`${packageSha256}:81`),
      workflowBlobSha: git(root, ["rev-parse", "HEAD:.github/workflows/acceptance.yml"]),
      packageContractDigest: sha256(JSON.stringify(["dist/runtime.cjs"])),
      preparedAt,
    });
    assert.deepEqual(candidateModule.parseAcceptanceCandidate(value), value);
    assert.equal(candidateModule.verifyRemoteCandidate(value, candidateSha), true);
    assert.equal(candidateModule.verifyRemoteCandidate(value, "f".repeat(40)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed for dirty product paths, a failed gate and package tampering", () => {
  const root = fixture();
  try {
    fs.appendFileSync(path.join(root, "src", "runtime.cts"), "// dirty\n", "utf8");
    expectCode(() => candidateModule.prepareAcceptanceCandidate({
      root,
      preparedAt: "2026-09-02T00:00:00.000Z",
    }, dependencies()), "product_tree_dirty");
    fs.writeFileSync(path.join(root, "src", "runtime.cts"), "export const value = 1;\n", "utf8");

    expectCode(() => candidateModule.prepareAcceptanceCandidate({
      root,
      preparedAt: "2026-09-02T00:00:00.000Z",
    }, {
      ...dependencies(),
      runGate: (_candidateRoot, gate) => gate !== "generated",
    }), "generation_drift");

    expectCode(() => candidateModule.prepareAcceptanceCandidate({
      root,
      preparedAt: "2026-09-02T00:00:00.000Z",
    }, {
      ...dependencies(),
      packCandidate: () => ({ bytes: Buffer.from("actual"), sha256: sha256("claimed"), memberCount: 81 }),
    }), "package_hash_mismatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects secret-shaped, unknown and hash-mismatched candidate records", () => {
  const root = fixture();
  try {
    const candidate = candidateModule.prepareAcceptanceCandidate({
      root,
      preparedAt: "2026-09-02T00:00:00.000Z",
    }, dependencies());
    for (const changed of [
      { ...candidate, token: "private" },
      { ...candidate, packageSha256: "x".repeat(64) },
      { ...candidate, packageVersion: "latest" },
      { ...candidate, preparedAt: "not-a-time" },
    ]) expectCode(() => candidateModule.parseAcceptanceCandidate(changed), "candidate_invalid");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("writes the candidate record atomically without a temporary-file residue", () => {
  const root = fixture();
  try {
    const candidate = candidateModule.prepareAcceptanceCandidate({
      root,
      preparedAt: "2026-09-02T00:00:00.000Z",
    }, dependencies());
    const output = path.join(root, "candidate.json");
    candidateModule.writeAcceptanceCandidate(output, candidate);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), candidate);
    assert.equal(fs.readdirSync(root).some((name) => name.includes(".tmp-")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
