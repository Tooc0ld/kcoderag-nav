#!/usr/bin/env node
/** Run every discovered test file exactly once per platform/Node lane. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const SKIP_PATTERN = "^readiness artifact drives all five packaged hosts from the same injected SHA and member count$";
// Scheduling estimates only, never authority to reuse or omit test results.
// Rounded Windows Node 22/24 file timings from Release 37879137484 (0.3.8).
const WINDOWS_TEST_WEIGHTS_MS: Readonly<Record<string, number>> = {
  "dist-tests/smoke/host-smoke.test.cjs": 59160,
  "dist-tests/maintainer/readiness-workflow.test.cjs": 36545,
  "dist-tests/maintainer/release.test.cjs": 29725,
  "dist-tests/maintainer/dependency-audit.test.cjs": 21103,
  "dist-tests/maintainer/pre-commit.test.cjs": 19135,
  "dist-tests/maintainer/cache-cleanup.test.cjs": 18639,
  "dist-tests/maintainer/release-readiness.test.cjs": 16831,
  "dist-tests/smoke/hook-tracer.test.cjs": 15641,
  "dist-tests/hooks/launcher.test.cjs": 14129,
  "dist-tests/cli/commands.test.cjs": 13645,
  "dist-tests/maintainer/readiness-seal.test.cjs": 12047,
  "dist-tests/maintainer/scrub-baseline.test.cjs": 11819,
  "dist-tests/maintainer/pack-audit.test.cjs": 11296,
  "dist-tests/generator/generation.test.cjs": 10160,
  "dist-tests/maintainer/pre-release-evidence.test.cjs": 6637,
  "dist-tests/hosts/claude.test.cjs": 6571,
  "dist-tests/maintainer/retirement-audit.test.cjs": 6112,
  "dist-tests/hosts/cross-host.test.cjs": 3740,
  "dist-tests/generator/cursor-product.test.cjs": 3343,
  "dist-tests/hosts/dashboard-lifecycle.test.cjs": 3290,
  "dist-tests/maintainer/native-host-driver.test.cjs": 2935,
  "dist-tests/maintainer/acceptance-candidate.test.cjs": 2783,
  "dist-tests/hosts/native-lifecycle.test.cjs": 2729,
};
const DEFAULT_WEIGHT_MS = 1000;
const ordinal = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export function discoverTestFiles(root: string = process.cwd()): readonly string[] {
  const files: string[] = [];
  function visit(relative: string): void {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = relative + "/" + entry.name;
      if (entry.isSymbolicLink()) throw new Error("test_inventory_invalid");
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name.endsWith(".test.cjs")) files.push(child);
    }
  }
  visit("dist-tests");
  return checkedFiles(files);
}

function checkedFiles(files: readonly string[]): string[] {
  if (files.length === 0 || new Set(files).size !== files.length
    || files.some((file) => !/^dist-tests\/(?:[^/\\]+\/)*[^/\\]+\.test\.cjs$/u.test(file)
      || file.split("/").some((part) => part === "." || part === ".."))) {
    throw new Error("test_inventory_invalid");
  }
  return [...files].sort(ordinal);
}

function weight(file: string, weights: Readonly<Record<string, number>>): number {
  const value = weights[file] ?? DEFAULT_WEIGHT_MS;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("test_weight_invalid");
  return value;
}

/** Longest files first, then ordinal path; ties go to shard 1. Unknown files still run. */
export function balancedTestShards(
  files: readonly string[],
  weights: Readonly<Record<string, number>> = WINDOWS_TEST_WEIGHTS_MS,
): readonly [readonly string[], readonly string[]] {
  const ordered = checkedFiles(files).sort((left, right) =>
    weight(right, weights) - weight(left, weights) || ordinal(left, right));
  const shards: [string[], string[]] = [[], []];
  const totals: [number, number] = [0, 0];
  for (const file of ordered) {
    const index = totals[0] <= totals[1] ? 0 : 1;
    shards[index].push(file);
    totals[index] += weight(file, weights);
  }
  return [shards[0].sort(ordinal), shards[1].sort(ordinal)];
}

function selectedFiles(shard: string, files: readonly string[]): readonly string[] {
  if (!["1/1", "1/2", "2/2"].includes(shard)) throw new Error("test_shard_invalid");
  const inventory = checkedFiles(files);
  const selected = shard === "1/1" ? inventory : balancedTestShards(inventory)[shard === "1/2" ? 0 : 1];
  if (selected.length === 0) throw new Error("test_shard_empty");
  return selected;
}

export function ciTestArguments(shard: string, files: readonly string[] = discoverTestFiles()): readonly string[] {
  return [
    "--require", "./dist-tests/test-bootstrap.cjs",
    "--test", "--test-concurrency=1",
    "--test-skip-pattern=" + SKIP_PATTERN,
    ...selectedFiles(shard, files),
  ];
}

export function shardManifest(shard: string, files: readonly string[]): Record<string, unknown> {
  const inventory = checkedFiles(files);
  const selected = selectedFiles(shard, inventory);
  const digest = (entries: readonly string[]): string => createHash("sha256").update(entries.join("\n") + "\n").digest("hex");
  return {
    event: "ci_test_shard",
    shard,
    schedulingBaseline: "0.3.8 Release 37879137484; weights only, all tests rerun",
    inventoryCount: inventory.length,
    inventorySha256: digest(inventory),
    selectedCount: selected.length,
    selectedSha256: digest(selected),
    estimatedWeightMs: selected.reduce((sum, file) => sum + weight(file, WINDOWS_TEST_WEIGHTS_MS), 0),
    files: selected,
  };
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    if (argv.length !== 1) throw new Error("test_shard_invalid");
    const shard = argv[0] ?? "";
    const files = discoverTestFiles();
    const args = ciTestArguments(shard, files);
    process.stdout.write(JSON.stringify(shardManifest(shard, files)) + "\n");
    const result = spawnSync(process.execPath, args, { stdio: "inherit", windowsHide: true });
    return result.status ?? 1;
  } catch (error) {
    const code = error instanceof Error && /^test_(?:shard|inventory|weight)_[a-z]+$/u.test(error.message)
      ? error.message : "test_shard_execution_failed";
    process.stderr.write(code + "\n");
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
