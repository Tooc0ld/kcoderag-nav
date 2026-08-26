const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const mutationLock = require("../../dist/core/mutation-lock.cjs") as {
  acquireMutationLock(input: {
    readonly host: "codex" | "claude" | "cursor" | "opencode";
    readonly targetRoot: string;
    readonly lockRoot: string;
  }): { readonly release: () => void };
  inspectMutationLock(input: {
    readonly host: "codex" | "claude" | "cursor" | "opencode";
    readonly targetRoot: string;
    readonly lockRoot: string;
  }): Readonly<{ status: "clear" | "active" | "stale"; safePath: string }>;
};

test("host-target mutation lock has one winner and releases without project writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-lock-red-"));
  const target = path.join(root, "project");
  const lockRoot = path.join(root, "cache");
  fs.mkdirSync(target);
  try {
    const first = mutationLock.acquireMutationLock({ host: "claude", targetRoot: target, lockRoot });
    assert.deepEqual(fs.readdirSync(target), []);
    assert.equal(mutationLock.inspectMutationLock({ host: "claude", targetRoot: target, lockRoot }).status, "active");
    assert.throws(
      () => mutationLock.acquireMutationLock({ host: "claude", targetRoot: target, lockRoot }),
      (error: any) => error?.code === "target_busy" && error?.safePath === ".",
    );
    first.release();
    assert.equal(mutationLock.inspectMutationLock({ host: "claude", targetRoot: target, lockRoot }).status, "clear");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
