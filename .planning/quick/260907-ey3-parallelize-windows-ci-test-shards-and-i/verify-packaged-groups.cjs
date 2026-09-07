/** Local functional proof of the two real packaged CLI groups and final receipt merger. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const readiness = require(path.join(root, 'dist/maintainer/release-readiness.cjs'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kcoderag-group-proof-'));
const lease = readiness.createCandidatePackageArtifact({ root, consumers: ['host-smoke'] });
const artifact = lease.artifact;
const common = ['--candidate-sha', 'b'.repeat(40), '--package-sha256', artifact.sha256,
  '--member-count', String(artifact.memberCount), '--workflow-run-id', 'local-proof-1'];
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'dist/maintainer/acceptance-workflow.cjs'), ...args], {
      cwd: root, env: { ...process.env, RUNNER_TEMP: temporary }, stdio: 'ignore', windowsHide: true,
    });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error('group_cli_failed')));
  });
}
async function main() {
  try {
    await readiness.withCandidatePackageBytes(lease, 'host-smoke', async (bytes) => {
      const results = await Promise.allSettled(['first', 'second'].map(async (group) => {
        const artifactRoot = path.join(temporary, group);
        fs.mkdirSync(artifactRoot);
        fs.writeFileSync(path.join(artifactRoot, 'candidate.tgz'), bytes);
        await run(['packaged', '--lane', 'windows-node22', '--group', group, ...common,
          '--artifact-root', artifactRoot, '--artifact-name', `kcoderag-nav-${artifact.version}.tgz`,
          '--output', path.join(temporary, `packaged-windows-node22-${group}.json`)]);
      }));
      assert.ok(results.every((result) => result.status === 'fulfilled'));
    });
    const output = path.join(temporary, 'complete.json');
    await run(['packaged-merge', ...common, '--receipt-root', temporary, '--output', output]);
    const merged = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(merged.verdict, 'PASS');
    assert.deepEqual(merged.receipts.map((receipt) => receipt.host), ['codex', 'claude', 'cursor', 'opencode', 'zcode']);
    console.log(JSON.stringify({ ok: true, groups: 2, hosts: 5, verdict: merged.verdict }));
  } finally {
    lease.dispose();
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(() => { console.error('packaged_group_proof_failed'); process.exitCode = 1; });
