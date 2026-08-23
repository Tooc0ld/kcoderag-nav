const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

interface ContractsModule {
  InstallError: new (code: string, safePath?: string) => Error & {
    readonly code: string;
    readonly safePath?: string;
  };
}

interface ProjectTargetModule {
  resolveProjectTarget(rawTarget: string, cwd?: string): {
    readonly root: string;
  };
  validateManagedPath(
    target: { readonly root: string },
    relativePath: string,
    managedRoots: readonly string[],
  ): {
    readonly relativePath: string;
    readonly absolutePath: string;
  };
}

interface StateModule {
  assertMutationRuntime(version: string): void;
  runtimeStatusIssue(version: string): { readonly code: string; readonly path: string } | undefined;
  createStatusResult(input?: {
    status?: string;
    host?: string;
    environment?: string;
    issues?: readonly { code: string; path?: string }[];
  }): {
    schemaVersion: number;
    status: string;
    issues: readonly { code: string; path: string }[];
  };
  createDesiredState(input: {
    host: "codex" | "claude" | "cursor";
    target: { readonly root: string };
    managedRoots: readonly string[];
    statePath: string;
    entries: readonly {
      relativePath: string;
      expectedDigest: string | null;
      content: Buffer | null;
    }[];
  }): {
    readonly schemaVersion: number;
    readonly entries: readonly {
      readonly path: { readonly relativePath: string; readonly absolutePath: string };
      readonly expectedDigest: string | null;
      readonly content: Buffer | null;
    }[];
  };
}

const contracts = require("../../dist/core/contracts.cjs") as ContractsModule;
const projectTarget = require("../../dist/core/project-target.cjs") as ProjectTargetModule;
const state = require("../../dist/core/state.cjs") as StateModule;

interface TransactionModule {
  applyTransaction(
    desired: ReturnType<StateModule["createDesiredState"]>,
    options?: {
      failAtStage?: number;
      failAtCommit?: number;
      failAtRollback?: number;
      onCommit?: (relativePath: string) => void;
    },
  ): {
    readonly schemaVersion: number;
    readonly host: string;
    readonly changedPaths: readonly string[];
  };
}

const transaction = require("../../dist/core/transaction.cjs") as TransactionModule;

function temporaryDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as Error & { code: unknown }).code)
    : undefined;
}

test("InstallError exposes only a stable code and sanitized relative path", () => {
  const safe = new contracts.InstallError("managed_content_changed", "managed/file.txt");
  assert.equal(safe.message, "managed_content_changed");
  assert.equal(safe.code, "managed_content_changed");
  assert.equal(safe.safePath, "managed/file.txt");
  assert.deepEqual(Object.keys(safe).sort(), ["code", "name", "safePath"]);

  const absolute = new contracts.InstallError("invalid_target", path.resolve("secret.txt"));
  assert.equal(absolute.safePath, ".");
  const traversal = new contracts.InstallError("path_escape", "managed/../secret.txt");
  assert.equal(traversal.safePath, ".");
});

test("project target is exactly cwd or --target and never walks to a repository root", () => {
  const base = temporaryDirectory("kcoderag-core-target-");
  try {
    fs.mkdirSync(path.join(base, ".git"));
    const nested = path.join(base, "source", "feature");
    fs.mkdirSync(nested, { recursive: true });

    assert.equal(projectTarget.resolveProjectTarget(".", nested).root, fs.realpathSync(nested));
    assert.equal(projectTarget.resolveProjectTarget(nested, base).root, fs.realpathSync(nested));
    assert.throws(
      () => projectTarget.resolveProjectTarget(path.parse(base).root),
      (error: unknown) => errorCode(error) === "unsafe_target",
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("managed paths reject absolute, traversal, symlink, special-file, and root escapes", (context) => {
  const base = temporaryDirectory("kcoderag-core-path-");
  try {
    const target = projectTarget.resolveProjectTarget(base);
    const valid = projectTarget.validateManagedPath(target, "owned/nested/file.txt", ["owned"]);
    assert.equal(valid.relativePath, "owned/nested/file.txt");
    assert.equal(valid.absolutePath, path.join(fs.realpathSync(base), "owned", "nested", "file.txt"));
    const exactFile = projectTarget.validateManagedPath(target, ".mcp.json", [".mcp.json"]);
    assert.equal(exactFile.absolutePath, path.join(fs.realpathSync(base), ".mcp.json"));

    for (const invalid of [
      "/absolute.txt",
      "C:/absolute.txt",
      "owned/../escape.txt",
      "owned\\escape.txt",
      "other/file.txt",
    ]) {
      assert.throws(
        () => projectTarget.validateManagedPath(target, invalid, ["owned"]),
        (error: unknown) => ["outside_managed_roots", "path_escape"].includes(errorCode(error) ?? ""),
        invalid,
      );
    }

    fs.mkdirSync(path.join(base, "owned"));
    fs.writeFileSync(path.join(base, "owned", "parent.bin"), "not a directory");
    assert.throws(
      () => projectTarget.validateManagedPath(target, "owned/parent.bin/child.txt", ["owned"]),
      (error: unknown) => errorCode(error) === "special_file",
    );

    const outside = temporaryDirectory("kcoderag-core-outside-");
    try {
      try {
        fs.symlinkSync(outside, path.join(base, "owned", "linked"), "junction");
      } catch (error) {
        context.skip(`symlink unavailable: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`);
        return;
      }
      assert.throws(
        () => projectTarget.validateManagedPath(target, "owned/linked/file.txt", ["owned"]),
        (error: unknown) => errorCode(error) === "symlink_escape",
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Node 22 is a write gate but an explicit read-only status issue", () => {
  assert.doesNotThrow(() => state.assertMutationRuntime("22.0.0"));
  assert.equal(state.runtimeStatusIssue("24.14.0"), undefined);
  assert.throws(
    () => state.assertMutationRuntime("21.9.0"),
    (error: unknown) => errorCode(error) === "unsupported_node",
  );
  assert.deepEqual(state.runtimeStatusIssue("not-a-version"), {
    code: "unsupported_node",
    path: ".",
  });

  assert.deepEqual(
    state.createStatusResult({
      status: "invalid",
      host: "codex",
      issues: [{ code: "unsupported_node" }],
    }),
    {
      schemaVersion: 1,
      status: "invalid",
      host: "codex",
      issues: [{ code: "unsupported_node", path: "." }],
    },
  );
});

test("desired state validates and snapshots one host without writing", () => {
  const base = temporaryDirectory("kcoderag-core-desired-");
  try {
    const target = projectTarget.resolveProjectTarget(base);
    const before = fs.readdirSync(base);
    const desired = state.createDesiredState({
      host: "codex",
      target,
      managedRoots: ["owned"],
      statePath: "owned/install-state.json",
      entries: [
        { relativePath: "owned/payload.bin", expectedDigest: null, content: Buffer.from("payload") },
        { relativePath: "owned/install-state.json", expectedDigest: null, content: Buffer.from("state") },
      ],
    });

    assert.equal(desired.schemaVersion, 1);
    assert.deepEqual(desired.entries.map((entry) => entry.path.relativePath), [
      "owned/payload.bin",
      "owned/install-state.json",
    ]);
    assert.deepEqual(fs.readdirSync(base), before);

    assert.throws(
      () => state.createDesiredState({
        host: "codex",
        target,
        managedRoots: ["owned"],
        statePath: "owned/install-state.json",
        entries: [
          { relativePath: "owned/duplicate", expectedDigest: null, content: null },
          { relativePath: "owned/duplicate", expectedDigest: null, content: null },
        ],
      }),
      (error: unknown) => errorCode(error) === "invalid_desired_state",
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

function sha256(bytes: Buffer): string {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function write(root: string, relativePath: string, bytes: Buffer | string): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
}

function snapshotTree(root: string): readonly string[] {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const records: string[] = [];
  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        records.push(`d:${relative}`);
        visit(absolute);
      } else if (entry.isSymbolicLink()) {
        records.push(`l:${relative}`);
      } else {
        records.push(`f:${relative}:${crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")}`);
      }
    }
  }
  visit(root);
  return records;
}

function transactionFixture(base: string) {
  const targetRoot = path.join(base, "target");
  fs.mkdirSync(targetRoot);
  const currentConfig = Buffer.from("current-config");
  const currentRemove = Buffer.from("remove-me");
  write(targetRoot, "owned/config.txt", currentConfig);
  write(targetRoot, "owned/remove.txt", currentRemove);
  write(targetRoot, "other-host/keep.bin", Buffer.from([0, 1, 2, 3]));
  const target = projectTarget.resolveProjectTarget(targetRoot);
  const desired = state.createDesiredState({
    host: "codex",
    target,
    managedRoots: ["owned"],
    statePath: "owned/install-state.json",
    entries: [
      {
        relativePath: "owned/config.txt",
        expectedDigest: sha256(currentConfig),
        content: Buffer.from("next-config"),
      },
      {
        relativePath: "owned/remove.txt",
        expectedDigest: sha256(currentRemove),
        content: null,
      },
      {
        relativePath: "owned/sub/payload.bin",
        expectedDigest: null,
        content: Buffer.from("new-payload"),
      },
      {
        relativePath: "owned/install-state.json",
        expectedDigest: null,
        content: Buffer.from("next-state"),
      },
    ],
  });
  return { targetRoot, target, desired };
}

test("transaction refuses unvalidated input and digest drift before any write", () => {
  const base = temporaryDirectory("kcoderag-core-preflight-");
  try {
    const fixture = transactionFixture(base);
    const before = snapshotTree(fixture.targetRoot);
    assert.throws(
      () => transaction.applyTransaction({} as ReturnType<StateModule["createDesiredState"]>),
      (error: unknown) => errorCode(error) === "invalid_desired_state",
    );
    write(fixture.targetRoot, "owned/config.txt", "drifted");
    const drifted = snapshotTree(fixture.targetRoot);
    assert.throws(
      () => transaction.applyTransaction(fixture.desired),
      (error: unknown) => errorCode(error) === "managed_content_changed",
    );
    assert.deepEqual(snapshotTree(fixture.targetRoot), drifted);
    assert.notDeepEqual(drifted, before);
    assert.equal(
      fs.readdirSync(fixture.targetRoot).some((name) => name.startsWith(".kcoderag-")),
      false,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("transaction stages all entries, atomically replaces them, and commits state last", () => {
  const base = temporaryDirectory("kcoderag-core-success-");
  try {
    const fixture = transactionFixture(base);
    const order: string[] = [];
    const result = transaction.applyTransaction(fixture.desired, {
      onCommit: (relativePath) => order.push(relativePath),
    });

    assert.equal(result.schemaVersion, 1);
    assert.equal(result.host, "codex");
    assert.equal(order.at(-1), "owned/install-state.json");
    assert.deepEqual([...result.changedPaths].sort(), [...order].sort());
    assert.equal(fs.readFileSync(path.join(fixture.targetRoot, "owned/config.txt"), "utf8"), "next-config");
    assert.equal(fs.existsSync(path.join(fixture.targetRoot, "owned/remove.txt")), false);
    assert.equal(fs.readFileSync(path.join(fixture.targetRoot, "owned/sub/payload.bin"), "utf8"), "new-payload");
    assert.equal(fs.readFileSync(path.join(fixture.targetRoot, "owned/install-state.json"), "utf8"), "next-state");
    assert.deepEqual(fs.readFileSync(path.join(fixture.targetRoot, "other-host/keep.bin")), Buffer.from([0, 1, 2, 3]));
    assert.equal(
      snapshotTree(fixture.targetRoot).some((record) => record.includes(".kcoderag-")),
      false,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("every staged and committed failure restores the complete one-host tree", () => {
  const probeBase = temporaryDirectory("kcoderag-core-probe-");
  let entryCount = 0;
  try {
    const probe = transactionFixture(probeBase);
    entryCount = probe.desired.entries.length;
  } finally {
    fs.rmSync(probeBase, { recursive: true, force: true });
  }

  for (const kind of ["stage", "commit"] as const) {
    for (let failureIndex = 0; failureIndex < entryCount; failureIndex += 1) {
      const base = temporaryDirectory(`kcoderag-core-${kind}-`);
      try {
        const fixture = transactionFixture(base);
        const before = snapshotTree(fixture.targetRoot);
        const options = kind === "stage"
          ? { failAtStage: failureIndex }
          : { failAtCommit: failureIndex };
        assert.throws(
          () => transaction.applyTransaction(fixture.desired, options),
          (error: unknown) => errorCode(error) === "transaction_failed",
        );
        assert.deepEqual(snapshotTree(fixture.targetRoot), before, `${kind}:${failureIndex}`);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }
  }
});

test("rollback failure retains a private recovery directory without payload diagnostics", () => {
  const base = temporaryDirectory("kcoderag-core-recovery-");
  try {
    const fixture = transactionFixture(base);
    let caught: unknown;
    try {
      transaction.applyTransaction(fixture.desired, { failAtCommit: 2, failAtRollback: 0 });
    } catch (error) {
      caught = error;
    }
    assert.equal(errorCode(caught), "rollback_failed");
    assert.ok(caught instanceof Error && "safePath" in caught);
    const safePath = String((caught as Error & { safePath: string }).safePath);
    assert.match(safePath, /^\.kcoderag-nav-recovery-[0-9a-f-]+$/);
    const recovery = path.join(fixture.targetRoot, safePath);
    assert.equal(fs.statSync(recovery).isDirectory(), true);
    const manifestText = fs.readFileSync(path.join(recovery, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestText) as {
      schemaVersion: number;
      host: string;
      entries: readonly { relativePath: string; backup?: string }[];
    };
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.host, "codex");
    assert.deepEqual(
      manifest.entries.map((entry) => entry.relativePath).sort(),
      fixture.desired.entries.map((entry) => entry.path.relativePath).sort(),
    );
    assert.equal(manifestText.includes("current-config"), false);
    for (const entry of manifest.entries) {
      if (entry.backup !== undefined) assert.equal(fs.statSync(path.join(recovery, entry.backup)).isFile(), true);
    }
    assert.deepEqual(fs.readFileSync(path.join(fixture.targetRoot, "other-host/keep.bin")), Buffer.from([0, 1, 2, 3]));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
