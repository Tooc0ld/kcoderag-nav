import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const smoke = require("../../dist/smoke/host-smoke.cjs") as {
  resolveSmokeNpmCli(options?: {
    platform?: NodeJS.Platform; execPath?: string; npmExecPath?: string;
    isFile?: (candidate: string) => boolean;
  }): string | undefined;
  runNpmProcess(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): {
    code: number; stdout: string; stderr: string;
  };
};

test("Windows npm resolver prefers the invoking npm CLI and falls back safely", () => {
  const execPath = path.resolve("fixture", "node.exe");
  const custom = path.resolve("custom npm", "npm-cli.js");
  const adjacent = path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const options = { platform: "win32" as const, execPath, npmExecPath: custom };
  assert.equal(smoke.resolveSmokeNpmCli({ ...options, isFile: () => true }), custom);
  assert.equal(smoke.resolveSmokeNpmCli({ ...options, isFile: (candidate) => candidate === adjacent }), adjacent);
  assert.equal(smoke.resolveSmokeNpmCli({ ...options, isFile: () => false }), undefined);
  assert.equal(smoke.resolveSmokeNpmCli({ ...options, isFile: () => { throw new Error("absent"); } }), undefined);
  for (const invalid of ["npm-cli.js", path.resolve("pnpm.cjs"), ""]) {
    assert.equal(smoke.resolveSmokeNpmCli({ ...options, npmExecPath: invalid, isFile: () => true }), adjacent);
  }
  assert.equal(smoke.resolveSmokeNpmCli({ ...options, platform: "linux", isFile: () => {
    throw new Error("Linux must not probe Windows npm paths");
  } }), undefined);
});

test("real npm process remains executable with isolated environment", () => {
  const result = smoke.runNpmProcess(["--version"], process.cwd(), process.env);
  assert.equal(result.code, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/u);
});

test("Windows direct npm runner preserves literal arguments, cwd, environment and failure", {
  skip: process.platform !== "win32",
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kcoderag npm & runner-"));
  const previous = process.env.npm_execpath;
  try {
    const cli = path.join(root, "npm-cli.js");
    fs.writeFileSync(cli, "process.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),value:process.env.RUNNER_PROBE}));process.stderr.write('fixture');process.exitCode=7;\n");
    process.env.npm_execpath = cli;
    const args = ["exec", "a & b", "%PATH%", "quoted\"value", "--", "install"];
    const result = smoke.runNpmProcess(args, root, { ...process.env, RUNNER_PROBE: "isolated" });
    assert.equal(result.code, 7);
    assert.equal(result.stderr, "fixture");
    assert.deepEqual(JSON.parse(result.stdout), { args, cwd: root, value: "isolated" });
  } finally {
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
