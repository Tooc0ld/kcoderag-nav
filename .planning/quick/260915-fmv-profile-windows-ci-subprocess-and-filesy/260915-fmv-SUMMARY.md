---
status: complete
quick_id: 260915-fmv
date: 2026-09-15
---

# Windows npm bootstrap overhead

## Evidence and interpretation

- Prior hosted CI 34079069796: the downloaded-candidate Codex smoke test took 113997.7 ms on Windows Node 22 and 16314.9 ms on Linux Node 22. This is an integration workload, not a V8 CPU benchmark.
- Local Windows Node 24.14.0 five-sample startup probe: empty Node 39-45 ms; `cmd /d /s /c npm --version` 196-318 ms; direct `node npm-cli.js --version` 98-220 ms.
- Successful serial Codex smoke pairs (fresh independent fixture/cache each run): old shim 26198 / 27060 ms; direct npm 23163 / 24121 ms. Mean 26629 -> 23642 ms (11.2% shorter). All four results PASS with no missing evidence.
- Parent profiler measured 25 npm calls (includes package creation) totaling 25990 / 26828 ms before and 22963 / 23974 ms after. Top-level instrumented filesystem work totaled hundreds, not tens of thousands, of milliseconds. npm time INCLUDES its own filesystem, JS and child startup costs; this does not rule out internal filesystem overhead and does not establish Defender as a cause.
- Invalid preliminary diagnostic runs are excluded: a preload wrapper initially dropped `realpathSync.native`, causing lock evidence to fail; the wrapper now preserves original function properties. One early run also timed out. Only later complete PASS runs are used for the comparison.

## Change

Windows packaged smoke launches the real npm CLI with the current Node executable when a valid npm CLI is available. It checks the invoking npm CLI and adjacent Node installation; unavailable/unsupported layouts retain the original shim. Linux execution is unchanged. Each lifecycle operation still uses npm exec, the same exact-package integrity checks, isolated environment/cache and original timeout/error handling.

No tests removed, job count changes, shared mutable checkout/cache, production hook behavior changes, antivirus exclusions, global settings, release tag or publication.

## Reproduction

After `npm run build`, run:

```powershell
node --require ./.planning/quick/260915-fmv-profile-windows-ci-subprocess-and-filesy/profile.cjs .planning/quick/260915-fmv-profile-windows-ci-subprocess-and-filesy/smoke-profile.cjs --shim
node --require ./.planning/quick/260915-fmv-profile-windows-ci-subprocess-and-filesy/profile.cjs .planning/quick/260915-fmv-profile-windows-ci-subprocess-and-filesy/smoke-profile.cjs
```

`--all` selects all five hosts serially. The preload emits fixed operation categories/counts/timings only, not arguments, subprocess bodies, environment or configuration. Temporary fixtures and compile/package artifacts are cleaned by their owners. Instrumentation is task-local and not published.

## Verification

- Build and three npm-runner tests PASS: resolver fallbacks/Linux bypass, real npm, literal Windows arguments including spaces/metacharacters, cwd/environment and nonzero exit preservation.
- Full `npm run ci:local`: 542/542 PASS (324578.7 ms), including real five-host packaged test (73871.1 ms); separate package contract 19/19 PASS (6384.8 ms). Generation changed/written paths empty.
- Docs (6 files), retirement audit, acceptance topology and diff checks PASS.
- Implementation commit: `a31f40f411973a67d38beda45a7dab8dabb3ecb8`, pushed to master.
- Hosted [CI 34925291415](https://github.com/Tooc0ld/kcoderag-nav/actions/runs/34925291415): PASS, 333 s (5m33s), compared with previous 347 s. Windows Node 22 shard test steps 244/129 s (previous 260/152 s), Node 24 208/145 s (previous 210/156 s); Linux Node 22/24 72/75 s.
- The downloaded-candidate Codex test on Windows Node 22 took 103730.4 ms (previous 113997.7 ms); Linux Node 22 took 15613.3 ms (previous 16314.9 ms). Windows remains much slower on this npm-heavy workload despite the verified incremental improvement.
- Hosted [acceptance 34925291361](https://github.com/Tooc0ld/kcoderag-nav/actions/runs/34925291361): PASS, 373 s (6m13s), compared with previous 481 s. Producer 71 s, first group job/test 274/236 s, second group 272/228 s, final gate 18 s. Both group jobs started at 03:32:28 UTC.
- Important attribution limit: first group improved from 327 to 236 s, while second worsened from 179 to 228 s. Hosted workload/runner variability remains material; the 22.5% overall acceptance wall-time reduction is an observed run comparison, not a controlled estimate of the patch's causal benefit. Controlled local improvement is about 11%.
- Downloaded final aggregate: exactly five hosts, all PACKAGED PASS; candidate `a31f40f411973a67d38beda45a7dab8dabb3ecb8`, package SHA-256 `3ffc353ff3c3e4bccf567e2e063f4745481ff7c536488720e36544484072632e`, workflow attempt `34925291361-1`.
- Native LIVE remains deferred and was skipped, not claimed as passing. Package version remains 0.3.6; no publication.
