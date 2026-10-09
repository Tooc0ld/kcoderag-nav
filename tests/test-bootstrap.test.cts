const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");

const bootstrap = require("./test-bootstrap.cjs") as typeof import("./test-bootstrap.cjs");

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

function fakeTiming() {
  let elapsed = 0;
  const delays: number[] = [];
  return {
    now: () => elapsed,
    sleep: (milliseconds: number) => {
      delays.push(milliseconds);
      elapsed += milliseconds;
    },
    advance: (milliseconds: number) => { elapsed += milliseconds; },
    delays,
  };
}

test("Windows recursive cleanup retries early EBUSY and returns only after success", () => {
  const timing = fakeTiming();
  const busy = Object.assign(new Error("fixture is busy"), { code: "EBUSY", syscall: "rmdir" });
  let attempts = 0;
  const original = (() => {
    attempts += 1;
    if (attempts < 3) throw busy;
  }) as typeof fs.rmSync;
  const remove = bootstrap.withWindowsCleanupRetries(original, "win32", timing);
  remove("fixture", { recursive: true, force: true, maxRetries: 2, retryDelay: 10 });
  assert.equal(attempts, 3);
  assert.deepEqual(timing.delays, [10, 20]);
});

test("Windows cleanup rethrows the final EBUSY after its explicit finite retry budget", () => {
  const timing = fakeTiming();
  const failures = Array.from({ length: 3 }, () =>
    Object.assign(new Error("still busy"), { code: "EBUSY" }));
  let attempts = 0;
  const remove = bootstrap.withWindowsCleanupRetries((() => {
    throw failures[attempts++];
  }) as typeof fs.rmSync, "win32", timing);
  assert.throws(
    () => remove("fixture", { recursive: true, maxRetries: 2, retryDelay: 10 }),
    (error: unknown) => error === failures[2],
  );
  assert.equal(attempts, 3);
  assert.deepEqual(timing.delays, [10, 20]);
});

test("early EBUSY followed by native retry eligibility cannot spend the backoff budget twice", () => {
  const timing = fakeTiming();
  const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
  const calls: Array<NonNullable<Parameters<typeof fs.rmSync>[1]>> = [];
  const remove = bootstrap.withWindowsCleanupRetries(((_target, options) => {
    calls.push(options!);
    if (calls.length === 1) throw busy; // First rmdir bypasses Node 22 retries.
    if (calls.length === 2) {
      // Model a later native path that would consume its full configured backoff.
      const retries = options?.maxRetries ?? 0;
      timing.advance((options?.retryDelay ?? 100) * retries * (retries + 1) / 2);
      throw busy;
    }
  }) as typeof fs.rmSync, "win32", timing);
  remove("fixture", { recursive: true, maxRetries: 2, retryDelay: 10 });
  assert.deepEqual(calls, [
    { recursive: true, maxRetries: 2, retryDelay: 10 },
    { recursive: true, maxRetries: 0, retryDelay: 10 },
    { recursive: true, maxRetries: 0, retryDelay: 10 },
  ]);
  assert.deepEqual(timing.delays, [10, 20]);
  assert.equal(timing.now(), 30);
});

test("native retry time consumes the cleanup budget instead of starting another full wait", () => {
  const timing = fakeTiming();
  const busy = Object.assign(new Error("native retries exhausted"), { code: "EBUSY" });
  let attempts = 0;
  const remove = bootstrap.withWindowsCleanupRetries((() => {
    attempts += 1;
    timing.advance(30);
    throw busy;
  }) as typeof fs.rmSync, "win32", timing);
  assert.throws(
    () => remove("fixture", { recursive: true, maxRetries: 2, retryDelay: 10 }),
    (error: unknown) => error === busy,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(timing.delays, []);
});

test("cleanup immediately preserves non-EBUSY errors and explicit disabled retries", () => {
  for (const code of ["EACCES", "EINVAL", "EPERM"]) {
    const timing = fakeTiming();
    const failure = Object.assign(new Error(code), { code });
    let attempts = 0;
    const remove = bootstrap.withWindowsCleanupRetries((() => {
      attempts += 1;
      throw failure;
    }) as typeof fs.rmSync, "win32", timing);
    assert.throws(() => remove("fixture", { recursive: true }), (error: unknown) => error === failure);
    assert.equal(attempts, 1);
    assert.deepEqual(timing.delays, []);
  }
  for (const options of [
    { recursive: true, maxRetries: 0 },
    { force: true },
  ]) {
    const timing = fakeTiming();
    const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
    let attempts = 0;
    const remove = bootstrap.withWindowsCleanupRetries((() => {
      attempts += 1;
      throw busy;
    }) as typeof fs.rmSync, "win32", timing);
    assert.throws(() => remove("fixture", options), (error: unknown) => error === busy);
    assert.equal(attempts, 1);
    assert.deepEqual(timing.delays, []);
  }
});

test("explicit zero retry delay remains bounded by attempt count without waiting", () => {
  const timing = fakeTiming();
  const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
  let attempts = 0;
  const remove = bootstrap.withWindowsCleanupRetries((() => {
    attempts += 1;
    throw busy;
  }) as typeof fs.rmSync, "win32", timing);
  assert.throws(
    () => remove("fixture", { recursive: true, maxRetries: 2, retryDelay: 0 }),
    (error: unknown) => error === busy,
  );
  assert.equal(attempts, 3);
  assert.deepEqual(timing.delays, []);
});

test("non-Windows test cleanup preserves the original implementation", () => {
  const original = (() => undefined) as typeof fs.rmSync;
  assert.equal(bootstrap.withWindowsCleanupRetries(original, "linux"), original);
});
