/** Opt-in local diagnostic: report only fixed operation categories and numeric timings. */
const fs = require('node:fs');
const cp = require('node:child_process');
const start = performance.now();
const totals = {};
let depth = 0;
function wrap(owner, name, classify) {
  const original = owner[name];
  owner[name] = function (...args) {
    if (depth) return Reflect.apply(original, this, args);
    const key = classify ? classify(args) : name;
    const began = performance.now();
    depth++;
    let result;
    try { result = Reflect.apply(original, this, args); return result; }
    finally {
      depth--;
      const row = totals[key] ??= { count: 0, ms: 0 };
      row.count++;
      row.ms += performance.now() - began;
      if ((key === 'npm' || key === 'subprocess') && performance.now() - began > 1000) {
        process.stderr.write('SLOW ' + JSON.stringify({ category: key, ms: Math.round(performance.now() - began),
          code: typeof result?.status === 'number' ? result.status : null,
          timeout: result?.error?.code === 'ETIMEDOUT' }) + '\n');
      }
    }
  };
  Object.assign(owner[name], original);
}
for (const name of ['spawnSync', 'execFileSync', 'execSync']) wrap(cp, name, (args) => {
  const values = [args[0], ...(Array.isArray(args[1]) ? args[1] : [])].map(String);
  return values.some(value => /(?:^|[\\/])(?:npm(?:\.cmd)?|npm-cli\.js)$/.test(value)) ? 'npm' : 'subprocess';
});
for (const name of ['readFileSync', 'writeFileSync', 'statSync', 'lstatSync', 'realpathSync',
  'readdirSync', 'mkdirSync', 'rmSync', 'renameSync', 'copyFileSync', 'cpSync']) wrap(fs, name);
process.on('exit', () => {
  process.stderr.write('PERF ' + JSON.stringify({ wallMs: Math.round(performance.now() - start),
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key,
      { count: value.count, ms: Math.round(value.ms) }])) }) + '\n');
});
