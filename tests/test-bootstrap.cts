/** Windows test-process safeguards that do not alter product runtime behavior. */

const fs = require("node:fs") as typeof import("node:fs");
const { performance } = require("node:perf_hooks") as typeof import("node:perf_hooks");

interface CleanupRetryTiming {
  now?: () => number;
  sleep?: (milliseconds: number) => void;
}

export function withWindowsCleanupRetries(
  originalRmSync: typeof fs.rmSync,
  platform: NodeJS.Platform,
  timing: CleanupRetryTiming = {},
): typeof fs.rmSync {
  if (platform !== "win32") return originalRmSync;
  const now = timing.now ?? (() => performance.now());
  const sleep = timing.sleep ?? ((milliseconds: number) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  });
  return ((target, options) => {
    if (!options?.recursive) return originalRmSync(target, options);
    const retryOptions = options.maxRetries === undefined
      ? { ...options, maxRetries: 5, retryDelay: 100 }
      : options;
    const retries = retryOptions.maxRetries ?? 0;
    const retryDelay = retryOptions.retryDelay ?? 100;
    const deadline = now() + retryDelay * retries * (retries + 1) / 2;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return originalRmSync(target, attempt === 0
          ? retryOptions
          : { ...retryOptions, maxRetries: 0 });
      } catch (error) {
        // Node 22 can bypass its native retry loop when the first rmdir is busy.
        // Only the first call owns native retries; later calls use this bridge,
        // so native and outer backoff cannot each spend the same retry budget.
        // Filesystem operations themselves can still take longer than backoff.
        if ((error as NodeJS.ErrnoException)?.code !== "EBUSY" || attempt >= retries) {
          throw error;
        }
        if (retryDelay > 0) {
          const remaining = deadline - now();
          if (remaining <= 0) throw error;
          sleep(Math.min(retryDelay * (attempt + 1), remaining));
        }
      }
    }
  }) as typeof fs.rmSync;
}

if (process.platform === "win32") {
  fs.rmSync = withWindowsCleanupRetries(fs.rmSync, process.platform);
}
