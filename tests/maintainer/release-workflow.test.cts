const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "release.yml");

function workflow(): string {
  return fs.readFileSync(workflowPath, "utf8");
}

function position(source: string, token: string): number {
  const found = source.indexOf(token);
  assert.notEqual(found, -1, `missing workflow token: ${token}`);
  return found;
}

test("release workflow runs only for matching semantic version tags with minimal authority", () => {
  const source = workflow();
  assert.match(source, /on:\s*\n\s*push:\s*\n\s*tags:\s*\n\s*- ["']v\*\.\*\.\*["']/u);
  assert.doesNotMatch(source, /pull_request:|workflow_dispatch:|schedule:|branches:|workflow_run:/u);
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/u);
  assert.doesNotMatch(source, /contents:\s*write|packages:\s*write|actions:\s*write|id-token:\s*write/u);
  assert.doesNotMatch(source, /continue-on-error|fail-fast:\s*false/iu);
});

test("release steps are immutable and execute every gate before one publish", () => {
  const source = workflow();
  assert.match(source, /actions\/checkout@[0-9a-f]{40}/u);
  assert.match(source, /actions\/setup-node@[0-9a-f]{40}/u);
  assert.doesNotMatch(source, /uses:\s*[^\n]+@(main|master|v[0-9]+)(?:\s|$)/iu);

  const ordered = [
    "npm ci --ignore-scripts",
    "npm run build",
    "npm run deps:audit",
    "npm test",
    "npm run generate:check",
    "npm run smoke:required",
    "npm run pack:audit",
    "npm publish --access public --ignore-scripts",
  ];
  let previous = -1;
  for (const command of ordered) {
    const current = position(source, command);
    assert.ok(current > previous, `${command} must follow the prior gate`);
    previous = current;
  }
  assert.equal(source.match(/npm publish/gu)?.length, 1);
});

test("tag is checked against package version before any build or publication", () => {
  const source = workflow();
  const check = position(source, "Verify tag matches package version");
  assert.ok(check < position(source, "npm run build"));
  assert.match(source, /GITHUB_REF_NAME/u);
  assert.match(source, /package\.json/u);
  assert.match(source, /expectedTag/u);
  assert.match(source, /process\.exit\(1\)/u);
});

test("npm credential is scoped to publish and is never printed", () => {
  const source = workflow();
  assert.match(source, /NODE_AUTH_TOKEN:\s*\$\{\{ secrets\.NPM_TOKEN \}\}/u);
  const publishStep = source.slice(source.lastIndexOf("- name:"));
  assert.match(publishStep, /NODE_AUTH_TOKEN/u);
  assert.match(publishStep, /npm publish/u);
  assert.doesNotMatch(source, /echo[^\n]*(?:TOKEN|secret)|printenv|env\s*$|set\s+-x|cat\s+.*npmrc/imu);
});

test("ordinary CI remains release-free and cannot inherit publication authority", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  assert.doesNotMatch(source, /npm\s+publish|NPM_TOKEN|NODE_AUTH_TOKEN|release\.yml|workflow_call/iu);
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/u);
});
