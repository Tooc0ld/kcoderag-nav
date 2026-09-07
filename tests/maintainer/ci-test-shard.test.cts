import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
const { ciTestArguments, main } = require("../../dist/maintainer/ci-test-shard.cjs") as {
  ciTestArguments(shard: string): readonly string[];
  main(argv: readonly string[]): number;
};

test("CI shards retain the ordinary suite filter and reject missing or unknown shards", () => {
  const scripts = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")).scripts;
  const args = ciTestArguments("1/2");
  const skip = args.find((arg) => arg.startsWith("--test-skip-pattern="));
  assert.ok(scripts["test:ci"].includes(`--test-skip-pattern="${skip?.split("=")[1]}"`));
  assert.ok(args.includes("--test-concurrency=1"));
  assert.equal(args.at(-1), "dist-tests/**/*.test.cjs");
  for (const shard of ["", "0/2", "3/2", "1/3", "2/1"]) assert.throws(() => ciTestArguments(shard));
  assert.equal(main([]), 1);
});

test("native test shards are disjoint and exhaustive and propagate a failing test", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag-shards-"));
  try {
    const files = Array.from({ length: 6 }, (_, index) => {
      const file = path.join(root, `${index}.test.cjs`);
      fs.writeFileSync(file, `require('node:test').test('shard-case-${index}', () => { ${index === 5 ? "throw new Error('expected');" : ""} });\n`);
      return file;
    });
    const selected: string[][] = [];
    const statuses: (number | null)[] = [];
    for (const shard of ["1/2", "2/2"]) {
      const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", `--test-shard=${shard}`, ...files], {
        encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_TEST_CONTEXT: undefined },
      });
      statuses.push(run.status);
      selected.push([...run.stdout.matchAll(/# Subtest: (shard-case-\d+)/gu)].map((match) => match[1] as string));
    }
    assert.equal(selected[0]?.filter((name) => selected[1]?.includes(name)).length, 0);
    assert.deepEqual(selected.flat().sort(), Array.from({ length: 6 }, (_, index) => `shard-case-${index}`));
    assert.deepEqual(statuses.sort(), [0, 1]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
