/** Serial Codex profile; --all checks five hosts, --shim reproduces the old Windows runner. */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '../../..');
if (process.argv.includes('--shim') && process.platform === 'win32') {
  const cp = require('node:child_process');
  const original = cp.spawnSync;
  cp.spawnSync = function (exe, args, options) {
    if (path.basename(args?.[0] ?? '') === 'npm-cli.js' && options?.env?.npm_config_userconfig) {
      return original(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args.slice(1)], options);
    }
    return original(exe, args, options);
  };
}
const readiness = require(path.join(root, 'dist/maintainer/release-readiness.cjs'));
const smoke = require(path.join(root, 'dist/smoke/host-smoke.cjs'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kcoderag-perf-'));
const lease = readiness.createCandidatePackageArtifact({ root, consumers: ['host-smoke'] });
(async () => {
  try {
    const start = performance.now();
    const result = await smoke.runHostSmoke({ mode: 'required-contract', artifactLease: lease,
      parallel: false, temporaryRoot: temporary,
      hosts: process.argv.includes('--all') ? ['codex', 'claude', 'cursor', 'opencode', 'zcode'] : ['codex'] });
    console.log(JSON.stringify({ elapsedMs: Math.round(performance.now() - start),
      verdict: result.status, hosts: result.hosts.map(host => ({ host: host.host, status: host.status,
        stage: host.stage, reasonCode: host.reasonCode,
        missing: Object.keys(host.evidence).filter(key => !host.evidence[key]) })) }));
    if (result.status !== 'PASS') process.exitCode = 1;
  } finally {
    lease.dispose();
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(() => { console.error('profile_failed'); process.exitCode = 1; });
