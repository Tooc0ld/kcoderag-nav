#!/usr/bin/env node
/** Run a complete deterministic file shard, serially, in an isolated CI checkout. */
import { spawnSync } from "node:child_process";

export function ciTestArguments(shard: string): readonly string[] {
  if (!["1/1", "1/2", "2/2"].includes(shard)) throw new Error("test_shard_invalid");
  return [
    "--require", "./dist-tests/test-bootstrap.cjs",
    "--test", "--test-concurrency=1", `--test-shard=${shard}`,
    "--test-skip-pattern=^readiness artifact drives all five packaged hosts from the same injected SHA and member count$",
    "dist-tests/**/*.test.cjs",
  ];
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    if (argv.length !== 1) throw new Error("test_shard_invalid");
    const result = spawnSync(process.execPath, ciTestArguments(argv[0] ?? ""), {
      stdio: "inherit", windowsHide: true,
    });
    return result.status ?? 1;
  } catch {
    process.stderr.write("test_shard_invalid\n");
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
