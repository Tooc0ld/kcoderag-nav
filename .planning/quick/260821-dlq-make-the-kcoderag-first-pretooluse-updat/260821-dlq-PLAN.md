---
phase: quick
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - plugin-src/hooks/update_check.py
  - tests/test_update_check.py
  - plugin-src/README.md.tmpl
  - README.md
  - MCP_QA_EXPERIENCE_GUIDE.md
  - kcoderag-qa/
  - kcoderag-dev/
autonomous: true
requirements:
  - UPDATE-ASYNC-01
  - UPDATE-ASYNC-02
  - UPDATE-DOCS-01
---

<objective>
把 QA/Dev 的首次相关 PreToolUse 更新检查改为非阻塞异步刷新：前台只读本地缓存，缓存过期时抢占锁并启动隐藏后台 worker，当前工具调用不等待网络；下一次相关 PreToolUse 使用刷新后的缓存提示更新。
</objective>

<context>
@AGENTS.md
@.planning/STATE.md
@plugin-src/hooks/update_check.py
@plugin-src/hooks/grep_nudge.py
@tests/test_update_check.py
@scripts/generate_plugins.py
@plugin-src/README.md.tmpl
@README.md
@MCP_QA_EXPERIENCE_GUIDE.md
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: RED→GREEN 将网络刷新移出 PreToolUse 关键路径</name>
  <files>tests/test_update_check.py, plugin-src/hooks/update_check.py</files>
  <action>先增加失败回归，证明 stale/missing cache 的 maybe_update_notice 不调用网络、只调度一次后台进程并立即使用 validated stale cache；再实现跨 Windows/POSIX 的隐藏 detached worker、原子刷新锁所有权、spawn 失败释放锁和完全 fail-open。后台 worker 保留固定 URL、1.5 秒 timeout、8 KiB/schema 校验与原子缓存写入。</action>
  <verify>python -m unittest tests.test_update_check -v</verify>
  <done>前台路径无 urlopen；并发 stale session 最多启动一个 worker；worker 成功写缓存并释放自己的锁，失败不产生 hook 协议噪音。</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 生成 QA/Dev 自包含产物并同步更新体验文档</name>
  <files>plugin-src/README.md.tmpl, README.md, MCP_QA_EXPERIENCE_GUIDE.md, kcoderag-qa/, kcoderag-dev/, kcoderag-update.json</files>
  <action>更新文档合同，明确首次调用仅触发后台刷新、新版本通知最早在下一次相关调用出现；运行规范生成器更新两个独立包及内容版本，禁止手改生成产物。</action>
  <verify>python scripts/generate_plugins.py --check &amp;&amp; python -m unittest tests.test_generation tests.test_update_check -v</verify>
  <done>QA/Dev 包均携带一致异步 checker，README 与 MCP_QA_EXPERIENCE_GUIDE.md 对实际延迟通知语义一致。</done>
</task>

<task type="auto">
  <name>Task 3: 完整离线回归与交付记录</name>
  <files>.planning/quick/260821-dlq-make-the-kcoderag-first-pretooluse-updat/260821-dlq-SUMMARY.md, .planning/STATE.md</files>
  <action>运行全量 unittest、QA/Dev hook 自测、generation check、SessionStart 禁止合同和 diff/credential-safe 检查；写 SUMMARY，更新 STATE，并原子提交代码和 quick 文档。不自动 push。</action>
  <verify>python -m unittest discover -s tests -v &amp;&amp; python kcoderag-qa/hooks/test_grep_nudge.py &amp;&amp; python kcoderag-dev/hooks/test_grep_nudge.py &amp;&amp; python scripts/generate_plugins.py --check &amp;&amp; git diff --check</verify>
  <done>所有本地门禁通过，提交可审计且未触碰 GSD 全局 hook。</done>
</task>

</tasks>
