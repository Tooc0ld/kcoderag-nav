const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "ci.yml");
const acceptanceWorkflowPath = path.join(repositoryRoot, ".github", "workflows", "acceptance.yml");

function workflow(): string {
  return fs.readFileSync(workflowPath, "utf8");
}

function acceptanceWorkflow(): string {
  return fs.readFileSync(acceptanceWorkflowPath, "utf8");
}

function job(source: string, name: string, next?: string): string {
  const start = source.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `missing job ${name}`);
  const end = next === undefined ? source.length : source.indexOf(`  ${next}:`, start + 1);
  assert.notEqual(end, -1, `missing next job ${next}`);
  return source.slice(start, end);
}

function lanes(source: string): readonly string[] {
  return [...source.matchAll(
    /- lane:\s*([^\s]+)\s*\r?\n\s*os:\s*([^\s]+)\s*\r?\n\s*runner:\s*([^\s]+)\s*\r?\n\s*node:\s*["']([^"']+)["']/gu,
  )].map((match) => [match[1], match[2], match[3], match[4]].join("|"));
}

test("required CI defines exactly the Windows/Linux by Node 22/24 matrix", () => {
  const source = workflow();
  const required = job(source, "required-contracts");
  assert.deepEqual(
    lanes(required),
    [
      "ubuntu-node-22|ubuntu|ubuntu-latest|22",
      "ubuntu-node-24|ubuntu|ubuntu-latest|24",
      "windows-node-22|windows|windows-latest|22",
      "windows-node-24|windows|windows-latest|24",
    ],
  );
  assert.match(required, /name:\s*Required contracts \/ \$\{\{ matrix\.lane \}\}/u);
  assert.match(required, /runs-on:\s*\$\{\{\s*matrix\.runner\s*\}\}/u);
  assert.match(required, /node-version:\s*\$\{\{\s*matrix\.node\s*\}\}/u);
  assert.equal(required.match(/\n\s*- lane:/gu)?.length, 4);
  assert.doesNotMatch(required, /exclude:|continue-on-error|matrix\.python|python-version/iu);
  const jobsSource = source.slice(source.indexOf("\njobs:"));
  assert.deepEqual(
    [...jobsSource.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gmu)].map((match) => match[1]),
    ["change-scope", "required-contracts"],
  );
});

test("every CI and acceptance checkout is pinned to the workflow head without retaining credentials", () => {
  const source = `${workflow()}\n${acceptanceWorkflow()}`;
  assert.equal(source.match(/uses:\s*actions\/checkout@[0-9a-f]{40}/gu)?.length, 3);
  assert.equal(source.match(/ref:\s*\$\{\{ github\.sha \}\}/gu)?.length ?? 0, 3);
  assert.equal(source.match(/persist-credentials:\s*false/gu)?.length ?? 0, 3);
});

test("every required lane installs the lock without scripts and runs all gates", () => {
  const source = workflow();
  const required = job(source, "required-contracts");
  const commands = [
    "npm ci --ignore-scripts",
    "npm run build",
    "npm run deps:audit",
    "npm run test:launcher",
    "npm test",
    "npm run generate:check",
    "npm run docs:check",
    "npm run audit:retirement",
    "npm run test:pack",
    "npm run test:smoke",
  ];
  let previous = -1;
  for (const command of commands) {
    const index = required.indexOf(command);
    assert.ok(index > previous, `${command} must be present in required order`);
    previous = index;
  }
  assert.doesNotMatch(required, /continue-on-error|\|\|\s*true|allow_failure/iu);
  assert.equal(required.match(/run:\s*npm run test:smoke/gu)?.length, 1);
  assert.doesNotMatch(
    required,
    /npm run (?:audit:brand|pack:audit|smoke:required|readiness:04\.2|seal:04\.2)/u,
  );
});

test("documentation-only scope runs one bounded lightweight gate and skips the full matrix", () => {
  const source = workflow();
  const scopeJob = job(source, "change-scope", "required-contracts");
  const required = job(source, "required-contracts");
  assert.match(scopeJob, /outputs:\s*\r?\n\s+scope:\s*\$\{\{ steps\.scope\.outputs\.scope \}\}/u);
  assert.match(scopeJob, /fetch-depth:\s*0/u);
  assert.match(scopeJob, /node-version:\s*["']24["']/u);
  const ordered = [
    "npm ci --ignore-scripts",
    "npm run build",
    "npm run deps:audit",
    "node dist/maintainer/ci-change-scope.cjs",
    "npm run docs:check",
    "npm run guide:check",
    "npm run pack:audit",
  ];
  let previous = -1;
  for (const command of ordered) {
    const index = scopeJob.indexOf(command);
    assert.ok(index > previous, `${command} must be present in lightweight order`);
    previous = index;
  }
  assert.equal(
    scopeJob.match(/if:\s*\$\{\{ steps\.scope\.outputs\.scope == 'documentation' \}\}/gu)?.length,
    3,
  );
  assert.doesNotMatch(scopeJob, /npm test|test:launcher|generate:check|audit:retirement|test:smoke/u);
  assert.match(required, /needs:\s*change-scope/u);
  assert.match(required, /if:\s*\$\{\{ needs\.change-scope\.outputs\.scope == 'full' \}\}/u);
});

test("candidate and manual acceptance use the dedicated Windows runner and isolated R-drive temp", () => {
  const source = acceptanceWorkflow();
  assert.match(
    source,
    /^on:\s*\r?\n\s+push:\s*\r?\n\s+branches:\s*\r?\n\s+- ["']readiness\/\*\*-candidate["']\s*\r?\n\s+workflow_dispatch:/mu,
  );
  assert.match(source, /if:\s*\$\{\{ vars\.KCODERAG_LIVE_SMOKE == 'enabled' \}\}/u);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, X64, kcoderag-live\]/u);
  assert.match(source, /R:\\actions-runner\\kcoderag-nav\\_temp/u);
  assert.match(source, /KCODERAG_ACCEPTANCE_TEMP=\$jobRoot/u);
  assert.match(source, /TEMP=\$jobRoot/u);
  assert.match(source, /TMP=\$jobRoot/u);
  assert.match(source, /if:\s*\$\{\{ always\(\) \}\}[\s\S]*?Remove-Item -LiteralPath \$jobRoot -Recurse -Force/u);
  const required = source.indexOf("npm run smoke:required");
  const live = source.indexOf("npm run smoke:live");
  assert.ok(required >= 0 && live > required);
  assert.match(
    source,
    /id:\s*live_smoke[\s\S]*?run:\s*\|[\s\S]*?npm run smoke:live[\s\S]*?live-smoke\.json[\s\S]*?exit \$exitCode[\s\S]*?continue-on-error:\s*true/u,
  );
  assert.match(source, /\$exitCode = \$LASTEXITCODE/u);
  assert.match(source, /ConvertFrom-Json/u);
  assert.match(source, /foreach \(\$hostName in @\('codex', 'claude', 'cursor', 'opencode', 'zcode'\)\)/u);
  assert.match(source, /\^\(PASS\|FAIL\|NOT_RUN\)\$/u);
  assert.match(source, /\^\[a-z0-9_\]\{1,64\}\$/u);
  assert.doesNotMatch(source.slice(required, live), /continue-on-error/u);
  assert.doesNotMatch(workflow(), /authenticated-live|kcoderag-live|smoke:live/u);
  assert.doesNotMatch(source, /upload-artifact|MCP_CONFIG|Authorization|Bearer|npm\s+publish/iu);
});

test("workflow is test-only on branch pushes and pull requests with minimal authority", () => {
  const source = workflow();
  assert.match(
    source,
    /^on:\s*\r?\n\s+push:\s*\r?\n\s+branches:\s*\r?\n\s+- ["']\*\*["']\s*\r?\n\s+pull_request:/mu,
  );
  assert.match(source, /permissions:\s*\r?\n\s+contents:\s*read/u);
  assert.match(
    source,
    /concurrency:\s*\r?\n\s+group:\s*required-ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.sha \}\}/u,
  );
  assert.doesNotMatch(source, /required-ci-[^\r\n]*github\.ref/u);
  assert.match(source, /cancel-in-progress:\s*true/u);
  assert.doesNotMatch(source, /npm\s+publish|NPM_TOKEN|NODE_AUTH_TOKEN|id-token:\s*write/iu);
  assert.doesNotMatch(source, /tags(?:-ignore)?:\s*|release:|workflow_run:/iu);
  assert.doesNotMatch(source, /paths(?:-ignore)?:/iu);
  assert.doesNotMatch(source, /self-hosted|kcoderag-live|smoke:live/u);
});

test("third-party actions are immutable pins and no CI script can publish", () => {
  const source = `${workflow()}\n${acceptanceWorkflow()}`;
  const uses = [...source.matchAll(/uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)].map((match) => match[1]);
  assert.ok(uses.length >= 2);
  for (const action of uses) assert.match(action ?? "", /^[^@\s]+@[0-9a-f]{40}$/u);

  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts["ci:local"],
    "npm run build && npm run deps:audit && npm test && npm run generate:check && npm run test:pack && npm run test:smoke",
  );
  assert.equal(
    packageJson.scripts["smoke:required"],
    "node dist/smoke/host-smoke.cjs --mode required-contract",
  );
  assert.equal(
    packageJson.scripts["smoke:live"],
    "node dist/smoke/host-smoke.cjs --mode optional-live",
  );
  assert.match(packageJson.scripts.test ?? "", /--test-concurrency=1/u);
  assert.doesNotMatch(
    packageJson.scripts["ci:local"] ?? "",
    /publish|release|audit:brand|pack:audit|smoke:required|readiness:04\.2|seal:04\.2/iu,
  );
});
