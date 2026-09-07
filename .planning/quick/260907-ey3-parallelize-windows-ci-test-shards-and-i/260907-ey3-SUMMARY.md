---
status: complete
quick_id: 260907-ey3
date: 2026-09-07
implementation_commits: [2325bf4, 1b7c394]
---

# Windows CI parallelization

## Changes

- Ordinary CI and release now retain Linux Node 22/24 complete lanes and split each Windows Node 22/24 lane into native Node file shards 1/2 and 2/2. Each job has its own checkout and executes tests serially. No test is selected by changed source paths.
- Real candidate-lease packaged smoke runs two independent child processes. Groups partition the requested host set without omissions or duplication. Each process receives bytes from the same active candidate lease and acquires its own SHA-named invocation package, npm cache, project roots and loopback MCP receipts.
- Hosted acceptance uses two separate Windows Node 22 runners, consuming the same producer artifact, with serial host execution within each group. A final Ubuntu job validates both group receipts against the expected candidate, package digest, member count and workflow attempt, then publishes the original five-host aggregate artifact name.
- Parent collection waits for child exit, rejects nonzero/missing/duplicate/oversized/invalid responses, checks host order and artifact identity, and emits the existing complete aggregate. Dependency-injected smoke and single-host runs retain serial semantics.
- The new shard runner is explicitly excluded from publication. Runtime dependencies, package version, native LIVE admission and release publication authority are unchanged.

## Verification

- Build and 21 focused tests: PASS.
- Full `npm run ci:local`: 537/537 tests, 264072.5468 ms; real five-host packaged case 67778.7194 ms.
- Package contract: 19/19, 5406.0832 ms.
- Generated products: no changed/written paths. Docs (6 files), retirement audit, acceptance topology and diff hygiene: PASS.
- Real worker tests prove both private caches and receipt files exist and invocation copies retain the same package digest. Negative tests cover missing/duplicate/wrong-host/wrong-artifact/incomplete results and child nonzero exit, absent/duplicate messages and timeout.
- Native shard fixture proves exhaustive/disjoint selection and nonzero failure propagation.

## Hosted evidence

- First iteration CI: https://github.com/Tooc0ld/kcoderag-nav/actions/runs/34078113784 — PASS, 329 s wall. Windows 22 shard steps 186/191 s; Windows 24 shard steps 238/214 s. Windows 22 test counts 270 + 266 = 536; no test loss. Linux 22 reports 532 discovered / 531 passed / 1 skipped (the platform-specific test set differs from Windows).
- First iteration acceptance: https://github.com/Tooc0ld/kcoderag-nav/actions/runs/34078113783 — PASS, 572 s wall, 459 s packaged step. Same-runner process parallelism did not meaningfully improve hosted wall time, so the final implementation moves acceptance groups to independent runners.
- Second iteration: build, 29 focused tests, 19 package tests and real two-group CLI + five-host merge proof PASS. The functional proof is reproducible with `node .planning/quick/260907-ey3-parallelize-windows-ci-test-shards-and-i/verify-packaged-groups.cjs`.
- Final CI: https://github.com/Tooc0ld/kcoderag-nav/actions/runs/34079069796 — PASS, 347 s wall (5m47s). Windows 22 shard test steps 260/152 s; Windows 24 shard test steps 210/156 s; Linux 22/24 test steps 76/73 s.
- Final acceptance: https://github.com/Tooc0ld/kcoderag-nav/actions/runs/34079069882 — PASS, 481 s wall (8m01s). One producer 72 s, first group job 367 s (test 327 s), second group job 223 s (test 179 s), aggregate gate 21 s. Both groups started at 03:17:26Z on separate runners.
- Downloaded final `packaged-windows-node22` artifact: exactly Codex/Claude/Cursor/OpenCode/ZCode, all PACKAGED PASS, candidate `1b7c3949bab19f1ed894337125dd18f3d9ad29ed`, package SHA-256 `3ce1622f7d3ee97f28cf597f33c01baea046f11a2e7f5e65f004443198a60db3`, attempt `34079069882-1`.
- Against the earlier stable baseline: CI 579 -> 347 s (40.1% shorter); acceptance 581 -> 481 s (17.2% shorter). These are observed runs, not guaranteed timings. Acceptance did not reach the initial 5–6 minute target; the three-host group remains its critical path.
- Earlier stable comparison: CI 33775964362 (9.65 min, Windows tests 480/482 s); acceptance 33775964593 (9.68 min, packaged step 446 s).
- Immediate predecessor 0.3.6: CI 33852798685, Windows tests 558/535 s; acceptance 33852798693, packaged step 507 s. Its total time is not a clean benchmark: npm installation took 301 s in scope, 306/461 s in Windows contracts, 366 s in producer and 291 s in packaged consumer.

## Scope

No release tag, npm publish, protected LIVE dispatch, user configuration changes or deferred phase completion. Unrelated untracked quick 260904-mh0 preserved.
