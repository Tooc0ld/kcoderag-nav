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

function laneTuples(source: string): readonly string[] {
  return [...source.matchAll(
    /- lane:\s*([^\s]+)\s*\r?\n\s*os:\s*([^\s]+)\s*\r?\n\s*runner:\s*([^\s]+)\s*\r?\n\s*node:\s*["']([^"']+)["']/gu,
  )].map((match) => [match[1], match[2], match[3], match[4]].join("|"));
}

test("release workflow runs only for matching semantic version tags with minimal authority", () => {
  const source = workflow();
  assert.match(source, /on:\s*\n\s*push:\s*\n\s*tags:\s*\n\s*- ["']v\*\.\*\.\*["']/u);
  assert.doesNotMatch(source, /pull_request:|workflow_dispatch:|schedule:|branches:|workflow_run:/u);
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/u);
  assert.doesNotMatch(source, /contents:\s*write|packages:\s*write|actions:\s*write|id-token:\s*write/u);
  assert.doesNotMatch(source, /continue-on-error/iu);
});

test("publish depends on the four-platform required matrix and one Windows packaged gate", () => {
  const source = workflow();
  const requiredStart = position(source, "  required-contracts:");
  const packagedStart = position(source, "  packaged-contracts:");
  const publishStart = position(source, "  publish:");
  assert.ok(requiredStart < packagedStart && packagedStart < publishStart);
  const requiredJob = source.slice(requiredStart, packagedStart);
  const packagedJob = source.slice(packagedStart, publishStart);
  const publishJob = source.slice(publishStart);

  assert.deepEqual(laneTuples(requiredJob), [
    "ubuntu-node-22|ubuntu|ubuntu-latest|22",
    "ubuntu-node-24|ubuntu|ubuntu-latest|24",
    "windows-node-22|windows|windows-latest|22",
    "windows-node-24|windows|windows-latest|24",
  ]);
  assert.match(requiredJob, /name:\s*Required release contracts \/ \$\{\{ matrix\.lane \}\}/u);
  assert.match(requiredJob, /runs-on:\s*\$\{\{ matrix\.runner \}\}/u);
  assert.match(requiredJob, /node-version:\s*\$\{\{ matrix\.node \}\}/u);
  assert.match(requiredJob, /fail-fast:\s*false/u);
  assert.equal(requiredJob.match(/\n\s*- lane:/gu)?.length, 4);
  assert.doesNotMatch(requiredJob, /exclude:|continue-on-error/iu);
  assert.match(packagedJob, /name:\s*Required packaged smoke \/ windows-node-22/u);
  assert.match(packagedJob, /runs-on:\s*windows-latest/u);
  assert.match(packagedJob, /node-version:\s*["']22["']/u);
  assert.doesNotMatch(packagedJob, /strategy:|matrix\./u);
  assert.match(publishJob, /needs:\s*\[required-contracts, packaged-contracts\]/u);
  assert.doesNotMatch(requiredJob, /npm\s+publish|NPM_TOKEN|NODE_AUTH_TOKEN/u);
  assert.equal(publishJob.match(/npm publish/gu)?.length, 1);
});

test("release has two required gates and publish, all bound to the tag subject SHA", () => {
  const source = workflow();
  const jobsSource = source.slice(source.indexOf("\njobs:"));
  assert.deepEqual(
    [...jobsSource.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gmu)].map((match) => match[1]),
    ["required-contracts", "packaged-contracts", "publish"],
  );
  assert.equal(source.match(/uses:\s*actions\/checkout@[0-9a-f]{40}/gu)?.length, 3);
  assert.equal(source.match(/ref:\s*\$\{\{ github\.sha \}\}/gu)?.length ?? 0, 3);
  assert.equal(source.match(/persist-credentials:\s*false/gu)?.length ?? 0, 3);
});

test("ordinary and packaged gates execute once before publish finalizes the package", () => {
  const source = workflow();
  assert.match(source, /actions\/checkout@[0-9a-f]{40}/u);
  assert.match(source, /actions\/setup-node@[0-9a-f]{40}/u);
  assert.doesNotMatch(source, /uses:\s*[^\n]+@(main|master|v[0-9]+)(?:\s|$)/iu);

  const publishStart = position(source, "  publish:");
  const packagedStart = position(source, "  packaged-contracts:");
  const requiredJob = source.slice(position(source, "  required-contracts:"), packagedStart);
  const packagedJob = source.slice(packagedStart, publishStart);
  const publishJob = source.slice(publishStart);
  const requiredGates = [
    "npm ci --ignore-scripts",
    "Verify tag matches package version",
    "npm run build",
    "npm run deps:audit",
    "npm run test:launcher",
    "npm run test:ci",
    "npm run generate:check",
    "npm run docs:check",
    "npm run audit:retirement",
  ];
  let previous = -1;
  for (const command of requiredGates) {
    const current = position(requiredJob, command);
    assert.ok(current > previous, `${command} must follow the prior gate`);
    previous = current;
  }

  const packagedGates = [
    "npm ci --ignore-scripts",
    "Verify tag matches package version",
    "npm run build",
    "npm run smoke:required",
    "npm run pack:audit",
  ];
  previous = -1;
  for (const command of packagedGates) {
    const current = position(packagedJob, command);
    assert.ok(current > previous, `${command} must follow the prior packaged gate`);
    previous = current;
  }
  assert.doesNotMatch(requiredJob, /npm run (?:smoke:required|pack:audit)/u);
  assert.equal(packagedJob.match(/npm run smoke:required/gu)?.length, 1);

  const publishSteps = [
    "npm ci --ignore-scripts",
    "Verify tag matches package version",
    "npm run build",
    "npm run deps:audit",
    "npm run pack:audit",
    "npm publish --access public --ignore-scripts",
  ];
  previous = -1;
  for (const command of publishSteps) {
    const current = position(publishJob, command);
    assert.ok(current > previous, `${command} must follow the prior publish step`);
    previous = current;
  }

  assert.doesNotMatch(
    publishJob,
    /npm test|npm run (?:test:launcher|generate:check|docs:check|audit:retirement|smoke:required)/u,
  );
  assert.equal(source.match(/npm publish/gu)?.length, 1);
  assert.equal(source.match(/npm run docs:check/gu)?.length, 1);
  assert.equal(source.match(/npm run audit:retirement/gu)?.length, 1);
  assert.equal(source.match(/npm run smoke:required/gu)?.length, 1);
  assert.doesNotMatch(requiredJob, /run:\s*npm test\s*(?:\r?\n|$)/u);
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
  const publishStepStart = source.indexOf("      - name: Publish verified immutable package");
  assert.notEqual(publishStepStart, -1);
  const beforePublishStep = source.slice(0, publishStepStart);
  const publishStep = source.slice(publishStepStart);
  assert.doesNotMatch(beforePublishStep, /NPM_TOKEN|NODE_AUTH_TOKEN/u);
  assert.match(publishStep, /NODE_AUTH_TOKEN/u);
  assert.match(publishStep, /npm publish/u);
  assert.equal(publishStep.match(/secrets\.NPM_TOKEN/gu)?.length, 1);
  assert.doesNotMatch(source, /echo[^\n]*(?:TOKEN|secret)|printenv|env\s*$|set\s+-x|cat\s+.*npmrc/imu);
});

test("ordinary CI remains release-free and cannot inherit publication authority", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  assert.doesNotMatch(source, /npm\s+publish|NPM_TOKEN|NODE_AUTH_TOKEN|release\.yml|workflow_call/iu);
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/u);
});
