/** Windows test-process safeguards that do not alter product runtime behavior. */

const fs = require("node:fs") as typeof import("node:fs");

export function withWindowsCleanupRetries(
  originalRmSync: typeof fs.rmSync,
  platform: NodeJS.Platform,
): typeof fs.rmSync {
  if (platform !== "win32") return originalRmSync;
  return ((target, options) => {
    if (options?.recursive && options.maxRetries === undefined) {
      return originalRmSync(target, {
        ...options,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
    return originalRmSync(target, options);
  }) as typeof fs.rmSync;
}

if (process.platform === "win32") {
  fs.rmSync = withWindowsCleanupRetries(fs.rmSync, process.platform);
}
