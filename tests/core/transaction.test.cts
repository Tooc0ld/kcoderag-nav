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

    for (const invalid of [
      "/absolute.txt",
      "C:/absolute.txt",
      "owned/../escape.txt",
      "owned\\escape.txt",
      "owned",
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
