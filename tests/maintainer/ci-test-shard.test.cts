import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
const { balancedTestShards, ciTestArguments, discoverTestFiles, shardManifest, main } =
  require("../../dist/maintainer/ci-test-shard.cjs") as {
    balancedTestShards(files: readonly string[], weights?: Readonly<Record<string, number>>): readonly [readonly string[], readonly string[]];
    ciTestArguments(shard: string, files?: readonly string[]): readonly string[];
    discoverTestFiles(root?: string): readonly string[];
    shardManifest(shard: string, files: readonly string[]): Record<string, unknown>;
    main(argv: readonly string[]): number;
  };
const SAMPLE = ["dist-tests/a.test.cjs", "dist-tests/b.test.cjs", "dist-tests/c.test.cjs"];

test("CI shards retain the ordinary suite filter and reject missing or unknown shards", () => {
  const scripts = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")).scripts;
  const args = ciTestArguments("1/2", SAMPLE);
  const skip = args.find((arg) => arg.startsWith("--test-skip-pattern="));
  assert.ok(scripts["test:ci"].includes(`--test-skip-pattern="${skip?.split("=")[1]}"`));
  assert.ok(args.includes("--test-concurrency=1"));
  assert.equal(args.some((arg) => arg.startsWith("--test-shard=")), false);
  assert.deepEqual(ciTestArguments("1/1", SAMPLE).slice(-3), SAMPLE);
  for (const shard of ["", "0/2", "3/2", "1/3", "2/1"]) assert.throws(() => ciTestArguments(shard, SAMPLE));
  assert.equal(main([]), 1);
});

test("weighted scheduling is deterministic, balances long files, and includes new files", () => {
  const files = ["dist-tests/long-a.test.cjs", "dist-tests/long-b.test.cjs",
    "dist-tests/medium.test.cjs", "dist-tests/new/unknown.test.cjs"];
  const weights = { [files[0]!]: 60000, [files[1]!]: 35000, [files[2]!]: 25000 };
  const shards = balancedTestShards(files, weights);
  assert.deepEqual(shards, [[files[0], files[3]], [files[1], files[2]]]);
  assert.deepEqual(balancedTestShards([...files].reverse(), weights), shards);
  assert.equal(new Set(shards.flat()).size, files.length);
  assert.deepEqual([...shards.flat()].sort(), [...files].sort());
  assert.throws(() => balancedTestShards([]));
  assert.throws(() => balancedTestShards([files[0]!, files[0]!]));
  assert.throws(() => balancedTestShards(["dist-tests/../outside.test.cjs"]));
  assert.throws(() => balancedTestShards(files, { [files[0]!]: 0 }));
  assert.throws(() => ciTestArguments("2/2", [files[0]!]));
});

test("actual compiled inventory is exhaustive across both shards with no special file allowlist", () => {
  const files = discoverTestFiles(path.resolve(__dirname, "../.."));
  const shards = balancedTestShards(files);
  assert.equal(new Set(shards.flat()).size, files.length);
  assert.deepEqual([...shards.flat()].sort(), [...files].sort());
  assert.ok(files.includes("dist-tests/hooks/launcher.test.cjs"));
  assert.ok(files.includes("dist-tests/maintainer/pack-audit.test.cjs"));
  assert.ok(files.includes("dist-tests/maintainer/ci-test-shard.test.cjs"));
  const first = shardManifest("1/2", files);
  const second = shardManifest("2/2", files);
  assert.equal(first.inventoryCount, files.length);
  assert.equal(first.inventorySha256, second.inventorySha256);
  assert.notEqual(first.selectedSha256, second.selectedSha256);
  assert.equal((first.selectedCount as number) + (second.selectedCount as number), files.length);
});

test("CLI discovery runs new nested files exactly once and propagates failures with an inventory receipt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-shards-"));
  try {
    fs.mkdirSync(path.join(root, "dist-tests/new"), { recursive: true });
    fs.writeFileSync(path.join(root, "dist-tests/test-bootstrap.cjs"), "");
    fs.writeFileSync(path.join(root, "dist-tests/new/not-a-test.cjs"), "throw new Error('must not run');");
    for (let index = 0; index < 6; index += 1) {
      fs.writeFileSync(path.join(root, "dist-tests/new", index + ".test.cjs"),
        "require('node:test').test('shard-case-" + index + "', () => { "
        + (index === 5 ? "throw new Error('expected');" : "") + " });\n");
    }
    const selected: string[][] = [];
    const statuses: (number | null)[] = [];
    const manifests: Record<string, any>[] = [];
    const runner = path.resolve(__dirname, "../../dist/maintainer/ci-test-shard.cjs");
    for (const shard of ["1/2", "2/2"]) {
      const run = spawnSync(process.execPath, [runner, shard], {
        cwd: root, encoding: "utf8", windowsHide: true,
        env: { ...process.env, NODE_TEST_CONTEXT: undefined, FORCE_COLOR: "0" },
      });
      statuses.push(run.status);
      const receipt = JSON.parse(run.stdout.split(/\r?\n/u)[0] ?? "{}") as Record<string, any>;
      manifests.push(receipt);
      selected.push(receipt.files as string[]);
      for (const file of receipt.files as string[]) {
        const index = path.basename(file, ".test.cjs");
        assert.ok(run.stdout.includes("shard-case-" + index), "selected test actually executed");
      }
    }
    assert.equal(selected[0]?.filter((name) => selected[1]?.includes(name)).length, 0);
    assert.deepEqual(selected.flat().sort(), [...discoverTestFiles(root)].sort());
    assert.deepEqual(statuses.sort(), [0, 1]);
    assert.equal(manifests[0]?.inventoryCount, 6);
    assert.equal(manifests[0]?.inventorySha256, manifests[1]?.inventorySha256);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
