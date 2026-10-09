const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const root = path.resolve(__dirname, "../..");
const workflow = (name: string): string => fs.readFileSync(path.join(root, ".github/workflows", `${name}.yml`), "utf8");
function job(source: string, name: string, next?: string): string {
  const start = source.indexOf(`  ${name}:`);
  const end = next === undefined ? source.length : source.indexOf(`  ${next}:`, start + 1);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test("PR owns feature verification while master push verifies merges without path-filter pending checks", () => {
  const source = workflow("ci");
  assert.match(source, /^on:\s*\n\s+push:\s*\n\s+branches: \[master\]\s*\n\s+pull_request:\s*\n\s+workflow_dispatch:/mu);
  assert.doesNotMatch(source, /paths(?:-ignore)?:|tags(?:-ignore)?:|workflow_run:|self-hosted/u);
  assert.match(source, /group: required-ci-\$\{\{ github.workflow \}\}-\$\{\{ github.event.pull_request.number \|\| github.ref \}\}/u);
  assert.match(source, /cancel-in-progress: true/u);
  assert.match(source, /permissions:\s*\n\s+contents: read/u);
  assert.doesNotMatch(source, /npm\s+publish|NPM_TOKEN|NODE_AUTH_TOKEN|id-token:\s*write/u);
});

test("documentation checks remain bounded and the stable aggregate rejects unknown scope or skipped required work", () => {
  const source = workflow("ci");
  const scope = job(source, "change-scope", "verify");
  for (const command of ["npm ci --ignore-scripts", "npm run build", "npm run deps:audit",
    "node dist/maintainer/ci-change-scope.cjs", "npm run docs:check", "npm run guide:check", "npm run pack:audit"]) {
    assert.ok(scope.includes(command), command);
  }
  assert.match(scope, /fetch-depth: 0/u);
  assert.match(scope, /if: \$\{\{ steps.scope.outputs.scope == 'documentation' \}\}/u);
  const verify = job(source, "verify", "ci-gate");
  assert.match(verify, /needs: change-scope/u);
  assert.match(verify, /if: \$\{\{ needs.change-scope.outputs.scope != 'documentation' \}\}/u);
  assert.match(verify, /uses: \.\/\.github\/workflows\/verify.yml/u);
  const gate = job(source, "ci-gate");
  assert.match(gate, /name: CI gate/u);
  assert.match(gate, /needs: \[change-scope, verify\]/u);
  assert.match(gate, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(gate, /test "\$SCOPE_RESULT" = success/u);
  assert.match(gate, /test "\$SCOPE" = full/u);
  assert.match(gate, /test "\$VERIFY_RESULT" = success/u);
  assert.match(gate, /test "\$VERIFY_RESULT" = skipped/u);
});

test("shared source matrix retains complete Linux and Windows Node 22/24 coverage", () => {
  const source = workflow("verify");
  assert.match(source, /^on:\s*\n\s+workflow_call:/mu);
  const required = job(source, "required-contracts", "packaged-contracts");
  const actual = [...required.matchAll(/- lane:\s*(\S+)\s*\n\s*runner:\s*(\S+)\s*\n\s*node: "(\d+)"\s*\n\s*shard: "([12]\/[12])"/gu)]
    .map((match) => match.slice(1).join("|"));
  assert.deepEqual(actual, [
    "ubuntu-node-22|ubuntu-latest|22|1/1", "ubuntu-node-24|ubuntu-latest|24|1/1",
    "windows-node-22-shard-1|windows-latest|22|1/2", "windows-node-22-shard-2|windows-latest|22|2/2",
    "windows-node-24-shard-1|windows-latest|24|1/2", "windows-node-24-shard-2|windows-latest|24|2/2",
  ]);
  assert.match(required, /fail-fast: false/u);
  assert.match(required, /runs-on: \$\{\{ matrix.runner \}\}/u);
  assert.match(required, /node-version: \$\{\{ matrix.node \}\}/u);
  for (const command of ["npm ci --ignore-scripts", "npm run build", "npm run deps:audit", "npm run test:ci:shard -- ${{ matrix.shard }}"]) {
    assert.ok(required.includes(command), command);
  }
  assert.doesNotMatch(required, /test:launcher|test:pack|smoke:required|pack:audit|exclude:/u);
  const producer = job(source, "package", "required-contracts");
  for (const command of ["npm run generate:check", "npm run docs:check", "npm run audit:retirement"]) assert.ok(producer.includes(command));
  assert.doesNotMatch(source, /continue-on-error|allow_failure|\|\|\s*true|NPM_TOKEN|NODE_AUTH_TOKEN/u);
});

test("one audited artifact supplies all five packaged hosts and every required job participates in the final gate", () => {
  const source = workflow("verify");
  const producer = job(source, "package", "required-contracts");
  const packaged = job(source, "packaged-contracts", "verification-gate");
  assert.equal(producer.match(/exact-package.cjs produce/gu)?.length, 1);
  assert.doesNotMatch(producer, /smoke:required|test:ci:packaged|exact-package.cjs smoke/u);
  assert.match(packaged, /needs: package/u);
  assert.match(packaged, /runs-on: windows-latest/u);
  assert.match(packaged, /node-version: "22"/u);
  assert.match(packaged, /artifact-ids: \$\{\{ needs.package.outputs.artifact-id \}\}/u);
  assert.match(packaged, /MANIFEST_SHA: \$\{\{ needs.package.outputs.manifest-sha256 \}\}/u);
  assert.equal(packaged.match(/exact-package.cjs smoke/gu)?.length, 1);
  assert.doesNotMatch(packaged, /npm pack|pack:audit|smoke:required|strategy:|matrix\./u);
  assert.match(packaged, /if: \$\{\{ always\(\) \}\}/u);
  const gate = job(source, "verification-gate");
  assert.match(gate, /needs: \[package, required-contracts, packaged-contracts\]/u);
  assert.match(gate, /if: \$\{\{ always\(\) \}\}/u);
  for (const result of ["PACKAGE_RESULT", "CONTRACT_RESULT", "PACKAGED_RESULT"]) assert.ok(gate.includes(`test "$${result}" = success`));
});

test("acceptance is explicit-only and retains its protected genuine native LIVE lane", () => {
  const source = workflow("acceptance");
  assert.match(source, /workflow_call:|workflow_dispatch:/u);
  assert.doesNotMatch(source, /^\s+(?:push|pull_request(?:_target)?):/mu);
  assert.match(source, /environment:\s*\n\s+name: kcoderag-live/u);
  assert.match(source, /runs-on: \[self-hosted, Windows, X64, kcoderag-live\]/u);
  assert.match(source, /github.event_name == 'workflow_dispatch'/u);
  assert.match(source, /github.event.repository.fork == false/u);
  assert.match(source, /inputs.candidateSha == needs.package.outputs.candidate-sha/u);
  assert.match(source, /npm run acceptance:live/u);
  assert.match(source, /cancel-in-progress: false/u);
  assert.doesNotMatch(source, /continue-on-error|allow_failure|\|\|\s*true|npm publish|MCP_CONFIG|Bearer/u);
});

test("actions and checkout subjects stay immutable and local CI retains pack coverage without repeating it", () => {
  for (const name of ["ci", "verify", "acceptance", "release"]) {
    const source = workflow(name);
    for (const match of source.matchAll(/uses:\s*([^\s#]+)/gu)) {
      if (!match[1]!.startsWith("./")) assert.match(match[1]!, /^[^@\s]+@[a-f0-9]{40}$/u);
    }
    assert.doesNotMatch(source, /\$\{\s+(?:github|needs|steps|runner|matrix|inputs|always)/u);
    const checkouts = source.match(/uses: actions\/checkout@/gu)?.length ?? 0;
    assert.equal(source.match(/persist-credentials: false/gu)?.length ?? 0, checkouts);
    if (name !== "acceptance") assert.equal(source.match(/ref: \$\{\{ github.sha \}\}/gu)?.length ?? 0, checkouts);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["ci:local"], "npm run build && npm run deps:audit && npm test && npm run generate:check");
  assert.match(pkg.scripts.test ?? "", /dist-tests\/\*\*\/\*\.test\.cjs/u);
  assert.match(pkg.scripts.test ?? "", /--test-concurrency=1/u);
  assert.doesNotMatch(pkg.scripts.test ?? "", /test-(?:skip|name)-pattern/u);
  assert.ok(fs.existsSync(path.join(root, "tests/maintainer/pack-audit.test.cts")));
  assert.ok(fs.existsSync(path.join(root, "tests/hooks/launcher.test.cts")));
  assert.doesNotMatch(pkg.scripts["ci:local"] ?? "", /publish|release|smoke:required|readiness:04/u);
  assert.equal(pkg.scripts["check:acceptance-workflow"], "node dist/maintainer/acceptance-workflow.cjs check .github/workflows/acceptance.yml");
});
