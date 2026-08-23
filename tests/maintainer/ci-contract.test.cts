const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "ci.yml");

function workflow(): string {
  return fs.readFileSync(workflowPath, "utf8");
}

test("required CI defines exactly the Windows/Linux by Node 22/24 matrix", () => {
  const source = workflow();
  assert.match(source, /os:\s*\[ubuntu-latest, windows-latest\]/u);
  assert.match(source, /node:\s*\["22", "24"\]/u);
  assert.match(source, /runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/u);
  assert.match(source, /node-version:\s*\$\{\{\s*matrix\.node\s*\}\}/u);
  assert.doesNotMatch(source, /setup-python|matrix\.python|python-version/iu);
});

test("every required lane installs the lock without scripts and runs all gates", () => {
  const source = workflow();
  const commands = [
    "npm ci --ignore-scripts",
    "npm run build",
    "npm run deps:audit",
    "npm run test:launcher",
    "npm test",
    "npm run generate:check",
    "npm run pack:audit",
  ];
  let previous = -1;
  for (const command of commands) {
    const index = source.indexOf(command);
    assert.ok(index > previous, `${command} must be present in required order`);
    previous = index;
  }
  assert.doesNotMatch(source, /continue-on-error|\|\|\s*true|allow_failure/iu);
});

test("workflow is test-only on push and pull request with minimal authority", () => {
  const source = workflow();
  assert.match(source, /^on:\s*\r?\n\s+push:\s*\r?\n\s+pull_request:/mu);
  assert.match(source, /permissions:\s*\r?\n\s+contents:\s*read/u);
  assert.match(source, /concurrency:\s*\r?\n\s+group:/u);
  assert.match(source, /cancel-in-progress:\s*true/u);
  assert.doesNotMatch(source, /npm\s+publish|NPM_TOKEN|NODE_AUTH_TOKEN|id-token:\s*write/iu);
  assert.doesNotMatch(source, /tags:\s*|release:|workflow_run:/iu);
});

test("third-party actions are immutable pins and no CI script can publish", () => {
  const source = workflow();
  const uses = [...source.matchAll(/uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)].map((match) => match[1]);
  assert.ok(uses.length >= 2);
  for (const action of uses) assert.match(action ?? "", /^[^@\s]+@[0-9a-f]{40}$/u);

  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts["ci:local"],
    "npm run build && npm run deps:audit && npm test && npm run generate:check && npm run pack:audit",
  );
  assert.match(packageJson.scripts.test ?? "", /--test-concurrency=1/u);
  assert.doesNotMatch(packageJson.scripts["ci:local"] ?? "", /publish|release/iu);
});
