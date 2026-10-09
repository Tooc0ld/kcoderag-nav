const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const root = path.resolve(__dirname, "../..");
const workflow = (name: string): string => fs.readFileSync(path.join(root, ".github/workflows", `${name}.yml`), "utf8");
const section = (source: string, name: string, next?: string): string => {
  const start = source.indexOf(`  ${name}:`);
  const end = next === undefined ? source.length : source.indexOf(`  ${next}:`, start + 1);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
};

test("release accepts only version tags and shares the complete verification gate", () => {
  const source = workflow("release");
  assert.match(source, /on:\s*\n\s*push:\s*\n\s*tags:\s*\n\s*- "v\*\.\*\.\*"/u);
  assert.doesNotMatch(source, /pull_request:|workflow_dispatch:|schedule:|branches:|workflow_run:/u);
  assert.match(source, /permissions:\s*\n\s+contents: read/u);
  assert.match(section(source, "verify", "publish"), /uses: \.\/\.github\/workflows\/verify.yml\s*\n\s+with:\s*\n\s+release: true/u);
  assert.match(section(source, "publish", "registry-readiness"), /needs: verify/u);
  assert.match(source, /cancel-in-progress: false/u);
  assert.doesNotMatch(source, /continue-on-error|always\(\)[\s\S]*?npm publish|contents: write|id-token: write/u);
  const verification = workflow("verify");
  assert.match(verification, /needs: \[package, required-contracts, packaged-contracts\]/u);
  assert.match(verification, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(verification, /if: \$\{\{ inputs.release \}\}/u);
  assert.ok(verification.indexOf("Check immutable release version") < verification.indexOf("npm run build"));
});

test("publication consumes the verified producer artifact without repacking or repeating smoke", () => {
  const source = workflow("release");
  const publish = section(source, "publish", "registry-readiness");
  const registry = section(source, "registry-readiness");
  for (const consumer of [publish, registry]) {
    assert.match(consumer, /artifact-ids: \$\{\{ needs.verify.outputs.artifact-id \}\}/u);
    assert.match(consumer, /MANIFEST_SHA: \$\{\{ needs.verify.outputs.manifest-sha256 \}\}/u);
    assert.match(consumer, /CANDIDATE_SHA: \$\{\{ github.sha \}\}/u);
    assert.doesNotMatch(consumer, /run:\s*npm pack|npm run (?:pack:audit|smoke:required|test:ci|test:pack)/u);
  }
  assert.match(publish, /exact-package.cjs verify "\$PACKAGE_ROOT" "\$CANDIDATE_SHA" "\$MANIFEST_SHA"/u);
  assert.match(publish, /GITHUB_REF_NAME/u);
  assert.equal(source.match(/npm publish /gu)?.length, 1);
  assert.match(publish, /npm publish "\$PACKAGE_ROOT\/package\/candidate.tgz" --access public --ignore-scripts/u);
  assert.ok(publish.indexOf("exact-package.cjs verify") < publish.indexOf("npm publish "));
  assert.match(registry, /needs: \[verify, publish\]/u);
  assert.match(registry, /registry-readiness.cjs "\$PACKAGE_ROOT" "\$CANDIDATE_SHA" "\$MANIFEST_SHA" "\$RECEIPT"/u);
  assert.match(registry, /timeout-minutes: 15/u);
  assert.match(registry, /if: \$\{\{ always\(\) \}\}/u);
  assert.doesNotMatch(registry, /npm publish|NPM_TOKEN|NODE_AUTH_TOKEN|smoke:live|10\.11\./u);
});

test("publication token is limited to the one publish step while exact SHA checkouts stay immutable", () => {
  const source = workflow("release");
  const step = source.indexOf("      - name: Publish verified immutable package once");
  assert.ok(step > 0);
  assert.doesNotMatch(source.slice(0, step), /NPM_TOKEN|NODE_AUTH_TOKEN/u);
  assert.equal(source.match(/secrets.NPM_TOKEN/gu)?.length, 1);
  assert.match(source, /NODE_AUTH_TOKEN: \$\{\{ secrets.NPM_TOKEN \}\}/u);
  assert.equal(source.match(/ref: \$\{\{ github.sha \}\}/gu)?.length, 2);
  assert.equal(source.match(/persist-credentials: false/gu)?.length, 2);
  assert.doesNotMatch(source, /echo[^\n]*(?:TOKEN|secret)|printenv|set\s+-x|cat\s+.*npmrc/iu);
  assert.doesNotMatch(workflow("ci") + workflow("verify"), /npm\s+publish|NPM_TOKEN|NODE_AUTH_TOKEN|secrets:\s*inherit/u);
});
