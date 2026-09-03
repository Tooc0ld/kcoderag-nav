---
phase: 05-hook-precision
plan: "05"
subsystem: testing
tags: [github-actions, acceptance-evidence, protected-runner, immutable-candidate, windows-node]

requires:
  - phase: 05-hook-precision
    provides: closed receipt schema, packaged five-host coordinator, and exact tgz closure from Plan 05-04
provides:
  - Read-only exact-run acceptance evidence validation with PACKAGED/LIVE separation
  - One-producer four-hosted-lane acceptance workflow plus protected Windows LIVE contract
  - Immutable candidate record binding product commit, tree, workflow blob, package digest, and package contract
affects: [05-06, protected-live-acceptance, candidate-evidence, github-actions]

actuals:
  tokens: 27940
  tasks: 3
  commits: 19

tech-stack:
  added: []
  patterns:
    - Acceptance evidence is read-only, closed-schema, metadata-only, and exact-run bound
    - Hosted lanes consume one producer tgz while protected LIVE consumes the same immutable artifact without rebuilding
    - Candidate product SHA is sealed before and remains distinct from its later record/evidence commits
    - Windows npm gates invoke npm-cli.js through the current Node executable without a command shell

key-files:
  created:
    - src/maintainer/acceptance-evidence.cts
    - src/maintainer/acceptance-workflow.cts
    - src/maintainer/acceptance-candidate.cts
    - tests/maintainer/acceptance-evidence.test.cts
    - tests/maintainer/acceptance-workflow.test.cts
    - tests/maintainer/acceptance-candidate.test.cts
    - .planning/phases/05-hook-precision/05-CANDIDATE.json
  modified:
    - .github/workflows/acceptance.yml
    - tests/maintainer/ci-contract.test.cts
    - src/maintainer/pack-audit.cts
    - package.json

key-decisions:
  - "PACKAGED and LIVE share one closed receipt shape, but PACKAGED can never promote native-host observations or manufacture LIVE PASS."
  - "The acceptance workflow has one hosted producer, four Windows/Linux Node 22/24 PACKAGED consumers, and one protected Windows Node 22 LIVE consumer of the same artifact."
  - "The executable candidate is product commit 36942caa844749c434bd1e7a7ddc9c134bb38169; candidate-record commit 277b0bc51b7c3f0013a2781abd0f09188365ef81 is only a documentation descendant."
  - "Legacy Phase 04.2 readiness push provenance remains exact, while Phase 05 acceptance dispatch is admitted only when the candidate SHA, dedicated ref, workflow commit, and workflow blob are all explicitly bound."
  - "The persistent Windows lane requires a fixed protected environment, exact candidate/ref guards, concurrency serialization, and no rebuild, publish, tag, latest, or fork authority."

patterns-established:
  - "Exact candidate chain: product commit -> atomic candidate record -> separately authorized remote run -> read-only evidence consumption."
  - "Repository-only acceptance maintainers are compiled for CI but explicitly excluded from the public package inventory."

requirements-completed: [TEST-07, TEST-08, TEST-09, TEST-11]

coverage:
  - id: D1
    description: "Read-only evidence consumer validates exact candidate/package/workflow identity and rejects secret-shaped or falsely promoted LIVE evidence."
    requirement: TEST-07
    verification:
      - kind: integration
        ref: "tests/maintainer/acceptance-evidence.test.cts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Acceptance workflow statically closes one producer and the four hosted Windows/Linux Node 22/24 PACKAGED lanes."
    requirement: TEST-08
    verification:
      - kind: integration
        ref: "npm run check:acceptance-workflow"
        status: pass
    human_judgment: false
  - id: D3
    description: "Protected Windows LIVE contract binds the exact candidate and producer artifact while preserving the three-parallel-then-two-serial coordinator order."
    requirement: TEST-09
    verification:
      - kind: unit
        ref: "tests/maintainer/acceptance-workflow.test.cts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Immutable local candidate seals the committed product tree, actual tgz, workflow blob, and package contract before any remote authorization."
    requirement: TEST-11
    verification:
      - kind: e2e
        ref: "node dist/maintainer/acceptance-candidate.cjs seal --root . --output .planning/phases/05-hook-precision/05-CANDIDATE.json"
        status: pass
    human_judgment: false

duration: 39min
completed: 2026-09-02
status: complete
---

# Phase 05 Plan 05: Immutable Acceptance Candidate Summary

**一个经过 497 项单元/集成测试、生成检查、81-member pack audit 与五宿主 PACKAGED smoke 的产品提交，已封存为 exact candidate，并由受保护的同包 LIVE workflow 等待后续显式授权。**

## Performance

- **Duration:** 39 min
- **Started:** 2026-09-02T03:24:20+08:00
- **Completed:** 2026-09-02T04:03:04+08:00
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- 增加只读 acceptance evidence consumer：只接受 exact run/candidate/package/workflow 元数据，并严格区分 PACKAGED 与 LIVE 观察。
- 将 acceptance workflow 收敛为一个 hosted producer、四个 Windows/Linux Node 22/24 PACKAGED consumer，以及一个受保护、串行化、禁止重建的 Windows Node 22 LIVE lane。
- 生成 `.planning/phases/05-hook-precision/05-CANDIDATE.json`，将实际产品提交、tree、workflow blob、0.3.1 tgz 与 package contract 闭合为一个候选身份。
- 修复 run `33553957966` 暴露的过期 Phase 04.2 provenance 谓词：保留旧 readiness push 合约，同时让 Phase 05 workflow_dispatch 只在 candidate/ref/workflow 身份全部精确绑定时进入 artifact 认证。
- 修复 run `33556051099` 暴露的下载 lease 版本漂移：从已认证 tgz 的唯一 `package/package.json` 派生并验证 0.3.1 身份，而不是继续伪造 legacy 0.3.0 元数据。
- 使用 GitHub 官方 workflow/environment/concurrency 权限语义核对 workflow，并通过本地 action pin 检查；未 push、dispatch、approve、publish、改 tag 或声称 LIVE PASS。

## Candidate Identity

- **Product candidate SHA:** `36942caa844749c434bd1e7a7ddc9c134bb38169`
- **Candidate tree SHA:** `61347734dfb4eb262034e53dd2c00ae8bc993067`
- **Workflow blob SHA:** `92cf30de4bbe763f042022772511fa1fc141933f`
- **Package SHA-256:** `6170a6fc0acd1bbe82ad2fe921f37d3fb5d92ccd96fb00a38dcf08ca83cb0ecc`
- **Package member digest:** `59bb03d0cfafe022d8a21376b41ae0baba6ec549324ad6a0e2946b8681e63af2`
- **Candidate-record commit:** `277b0bc51b7c3f0013a2781abd0f09188365ef81`

`36942caa...` 是后续 LIVE 必须 checkout/消费的产品 ref；`277b0bc5...` 仅更新候选 JSON，不得替代产品 ref。

## Task Commits

1. **Task 1 RED: acceptance evidence tests** - `f6ceb91` (test)
2. **Task 1 GREEN: exact evidence consumer** - `ef45651` (feat)
3. **Task 2 RED: acceptance workflow contract tests** - `31bb097` (test)
4. **Task 2 GREEN: protected exact acceptance workflow** - `5efe93c` (feat)
5. **Task 3 RED: candidate seal tests** - `bdce27a` (test)
6. **Task 3 GREEN: immutable candidate sealer** - `eee26dc` (feat)
7. **Task 3 fix: repository-only package boundary** - `652fc21` (fix)
8. **Task 3 fix: Windows npm gate runner** - `bb92400` (fix; original product candidate, later superseded)
9. **Task 3 record: immutable candidate metadata** - `1e946b6` (docs; original candidate descendant, later superseded)
10. **Deviation RED: reproduce legitimate Phase 05 dispatch refusal** - `21b5c1b` (test)
11. **Deviation GREEN: profile exact readiness/acceptance provenance** - `d85aa41` (fix)
12. **Deviation RED: require routed dispatch provenance** - `c2eedb2` (test)
13. **Deviation GREEN: bind candidate ref and workflow identities** - `02e773f` (fix; superseded product candidate)
14. **Deviation record: repaired immutable candidate metadata** - `07f45c6` (docs; superseded candidate descendant)
15. **Deviation RED: reproduce downloaded 0.3.1 metadata drift** - `bd1c1a9` (test)
16. **Deviation GREEN: derive authenticated package identity** - `1566bf2` (fix)
17. **Deviation RED: require producer artifact-name binding** - `a703345` (test)
18. **Deviation GREEN: bind presentation name to package identity** - `36942ca` (fix; final product candidate)
19. **Deviation record: manifest-bound candidate metadata** - `277b0bc` (docs; candidate descendant)

## Files Created/Modified

- `src/maintainer/acceptance-evidence.cts` - exact-run receipt acquisition, closed validation, aggregation, atomic output, and secret scan.
- `src/maintainer/acceptance-workflow.cts` - workflow topology validator plus PACKAGED/LIVE coordinators.
- `.github/workflows/acceptance.yml` - one producer, four hosted PACKAGED lanes, and protected exact-candidate Windows LIVE lane.
- `src/maintainer/acceptance-candidate.cts` - clean-tree gates, exact Git/package identity calculation, atomic candidate writer, and remote equality predicate.
- `src/maintainer/readiness-workflow.cts` - preserves the Phase 04.2 push predicate and adds closed Phase 05 acceptance push/dispatch provenance profiles.
- `.planning/phases/05-hook-precision/05-CANDIDATE.json` - immutable candidate identity prepared before remote evidence collection.
- `src/maintainer/pack-audit.cts` - keeps all three acceptance maintainers outside the public npm member inventory.
- `package.json` - adds explicit acceptance and plan verification entry points.

## Decisions Made

- LIVE lane receives the producer artifact and exact committed SHA; it has no local `npm pack`, build, publish, tag, latest, or force-push route.
- A preinstalled native driver, when used later, must be path- and SHA-bound; absence remains honest `NOT_RUN`/aggregate `INCOMPLETE`, never inferred PASS.
- Candidate sealing packages the exact committed tracked tree plus freshly verified `dist`, so unrelated dirty planning/guide work cannot enter the tgz.
- Windows gate execution resolves the bundled npm CLI through `process.execPath`, avoiding both `npm.cmd` `EINVAL` and an unnecessary shell boundary.
- Phase 05 dispatch supplies an explicit candidate ref and committed workflow blob; the protected LIVE guard additionally requires that ref to equal `github.ref` before any native-host work.
- Downloaded lanes trust neither a hard-coded release version nor a presentation basename: exact package name/version come from the authenticated tar manifest, and the producer artifact name must agree with that identity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Closed the public package boundary for new acceptance maintainers**

- **Found during:** Task 3 full verification
- **Issue:** The three new compiled repository maintainers were neither public package members nor declared non-published outputs, causing pack audit and dependent smoke tests to fail closed.
- **Fix:** Added all three paths to the exact `NON_PUBLISHED_COMPILED_OUTPUTS` list.
- **Files modified:** `src/maintainer/pack-audit.cts`
- **Verification:** Pack-audit/readiness/host-smoke focused suite passed, followed by the full 493-test candidate gate.
- **Committed in:** `652fc21`

**2. [Rule 1 - Bug] Made the production candidate gate runner work on Windows**

- **Found during:** Task 3 production CLI seal
- **Issue:** Node on Windows returned `EINVAL` when `spawnSync` invoked `npm.cmd` directly, so the real sealer failed at its build gate even though injected tests passed.
- **Fix:** Invoke the regular bundled `npm-cli.js` through the current Node executable without a command shell, and add a real default-runner regression test.
- **Files modified:** `src/maintainer/acceptance-candidate.cts`, `tests/maintainer/acceptance-candidate.test.cts`
- **Verification:** The default gate regression passed, then the production seal ran every gate and wrote the exact candidate successfully.
- **Committed in:** `bb92400`

**3. [Rule 1 - Bug] Replaced obsolete readiness-only provenance with closed workflow profiles**

- **Found during:** Authorized Phase 05 Wave 6 run `33553957966`
- **Issue:** The package producer used the Phase 04.2 readiness predicate, which required a `push` to `readiness/04.2-candidate` and equated the workflow commit with `GITHUB_SHA`. A legitimate exact Phase 05 `workflow_dispatch` therefore stopped with `workflow_provenance_invalid` before packaging.
- **Fix:** Kept the legacy readiness path unchanged; added a separate acceptance profile that binds the candidate SHA, dedicated `phase05-live-candidate-*` ref, workflow commit, and exact workflow blob, and routed those sealed inputs from the acceptance workflow.
- **Files modified:** `src/maintainer/readiness-workflow.cts`, `src/maintainer/acceptance-workflow.cts`, `.github/workflows/acceptance.yml`, `tests/maintainer/readiness-workflow.test.cts`, `tests/maintainer/acceptance-workflow.test.cts`
- **Verification:** RED reproduced the exact dispatch refusal; GREEN passed the 496-test suite, zero-drift generation, 81-member pack audit, five-host PACKAGED smoke, workflow validator, and 5 candidate tests during the production seal.
- **Committed in:** `21b5c1b`, `d85aa41`, `c2eedb2`, `02e773f`

**4. [Rule 1 - Bug] Derived downloaded lease metadata from the authenticated package manifest**

- **Found during:** Authorized Phase 05 Wave 6 run `33556051099`
- **Issue:** All four PACKAGED lanes downloaded the correct 0.3.1 tgz (`6170a6fc...`, 81 members), but `openDownloadedLease()` hard-coded artifact version 0.3.0. Host smoke therefore rejected the installed 0.3.1 manifest as `package_acquisition_failed` and returned non-PASS without an exception body.
- **Fix:** Parse the already authenticated tar once, require one bounded UTF-8 `package/package.json`, validate exact `kcoderag-nav` name and strict semver, use that version in the lease, and bind the producer artifact name to the derived identity. The legacy Phase 04.2 lane parser retains its exact 0.3.0 contract.
- **Files modified:** `src/maintainer/readiness-workflow.cts`, `tests/maintainer/readiness-workflow.test.cts`
- **Verification:** RED reproduced `0.3.0 !== 0.3.1` through a real downloaded tgz and PACKAGED smoke; a second RED proved name mismatch was accepted. GREEN passed the 497-test suite, zero-drift generation, 81-member pack audit, five-host PACKAGED smoke, workflow validator, and 5 candidate tests during the production seal.
- **Committed in:** `bd1c1a9`, `1566bf2`, `a703345`, `36942ca`

---

**Total deviations:** 4 auto-fixed (1 missing critical functionality, 3 bugs)
**Impact on plan:** All fixes were required to make the already-planned package, Windows candidate, and exact dispatch gates truthful; no remote authority or product feature scope was added.

## Issues Encountered

- 首次完整测试的 19 个失败实际来自同一个 package inventory 边界遗漏；补齐三条 repository-only 输出后，全部连锁失败消失。
- 首次真实 seal 暴露 Windows `npm.cmd` 的 `EINVAL`；改为无 shell 的 Node→npm-cli 执行后，生产入口与回归测试同时通过。
- 首次授权 dispatch 暴露 readiness/acceptance provenance 合约未分流；失败发生在 pack 之前，修复后重新封印了新的产品候选，旧候选不再用于后续 LIVE。
- 第二次授权运行成功生产并下载同一 tgz 后，暴露下载 lease 仍硬编码 0.3.0；修复将版本信任移入已认证 tar manifest，并再次废弃旧候选。

## User Setup Required

Plan 05-06 仍需明确的人类/平台授权，当前计划没有执行这些动作：

- 在 GitHub 配置受保护环境 `kcoderag-live` 与带 `self-hosted`, `Windows`, `X64`, `kcoderag-live` 标签的 Node 22 runner。
- 将 `candidateSha` 非强制推送到专用 ref，验证远端 ref 精确等于 `36942caa844749c434bd1e7a7ddc9c134bb38169`，并以同一 ref 和 workflow blob `92cf30de4bbe763f042022772511fa1fc141933f` 显式 dispatch 后批准受保护环境。
- 在 runner 上准备五个真实宿主、冻结版本、ZCode workspace trust、QA MCP 凭据，以及 SHA 绑定的 native driver。

## Next Phase Readiness

- Plan 05-06 可以只读消费一个已授权、已完成且 exact-ref 匹配的 `PHASE05_LIVE_RUN_ID`。
- 本地候选、workflow 与 evidence consumer 已就绪；阻塞项仅是 Plan 05-06 明确列出的远端 ref、protected environment、runner admission、宿主/凭据与人工授权。
- 当前仅有本地/hosted-contract 与 PACKAGED PASS 证据，没有生成或暗示任何五宿主 LIVE PASS。

## Self-Check: PASSED

- Summary、candidate、三个 maintainer 与 acceptance workflow 均存在。
- 十九个任务/修复/候选记录提交均可由 Git 解析。
- `05-CANDIDATE.json.candidateSha` 精确等于产品提交 `36942caa844749c434bd1e7a7ddc9c134bb38169`，且与记录提交 `277b0bc51b7c3f0013a2781abd0f09188365ef81` 保持区分。

---
*Phase: 05-hook-precision*
*Completed: 2026-09-02*
