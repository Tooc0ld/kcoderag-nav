const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");

const bootstrap = require("./test-bootstrap.cjs") as {
  withWindowsCleanupRetries(
    rmSync: typeof fs.rmSync,
    platform: NodeJS.Platform,
  ): typeof fs.rmSync;
};

test("Windows test cleanup adds bounded retries only when recursive defaults omit them", () => {
  const calls: Array<Parameters<typeof fs.rmSync>> = [];
  const original = ((...args: Parameters<typeof fs.rmSync>) => {
    calls.push(args);
  }) as typeof fs.rmSync;
  const windowsRmSync = bootstrap.withWindowsCleanupRetries(original, "win32");

  windowsRmSync("recursive", { recursive: true, force: true });
  windowsRmSync("explicit", { recursive: true, force: true, maxRetries: 2, retryDelay: 10 });
  windowsRmSync("single", { force: true });

  assert.deepEqual(calls, [
    ["recursive", { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }],
    ["explicit", { recursive: true, force: true, maxRetries: 2, retryDelay: 10 }],
    ["single", { force: true }],
  ]);
});

test("non-Windows test cleanup preserves the original implementation", () => {
  const original = (() => undefined) as typeof fs.rmSync;
  assert.equal(bootstrap.withWindowsCleanupRetries(original, "linux"), original);
});
