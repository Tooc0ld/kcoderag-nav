# Nav CI 与发布

Nav 继续支持 Windows/Linux 与 Node.js 22/24。服务端 KCodeRag 的 Linux-only 范围不替代 Nav 的宿主兼容性验证。

## 触发与门禁

- Feature 开发由 pull request 触发 CI；普通分支 push 不再额外运行同一套 CI。
- master push 验证合并后的实际提交。手动 workflow_dispatch 仍可用于诊断。
- 分支保护应要求稳定的 `CI gate`；不要依赖共享工作流内会变化的矩阵显示名称。
- CI 按 PR/分支取消已被新提交取代的运行；发布按 tag 串行，避免取消正在发布的版本。
- 文档改动沿用 documentation 门禁；源码、工作流及无法识别的改动走 full。CI gate 明确检查 scope 与 job 结果，不能把失败或意外 skipped 当作成功。
- `acceptance.yml` 保留显式调用和手动验收入口；普通 push 不再重复执行 packaged 验收。原生 LIVE 的授权及证据约束保留。

## 同一个安装包从验收到发布

CI 与 tag Release 共用 `verify.yml`：

1. Ubuntu producer 在精确提交构建、检查依赖、生成一致性、文档与退役边界，产生并审计一个 tgz。
2. 原有 Windows/Linux × Node 22/24 测试矩阵继续执行；Windows 保留两个按文件耗时平衡的测试分片，Linux 每个 Node 版本仍执行完整文件集合。完整 suite 已包含 launcher 与 pack 测试，不在每个 job 结尾再次执行它们。
3. Windows Node 22 的五宿主 packaged 验收按 artifact ID 下载 producer 的 tgz，重新核对 manifest hash、包 SHA-256、版本和成员摘要，再执行安装生命周期。
4. Verification gate 要求包、测试矩阵和 packaged 验收全部成功。Release 重新核对 tag 与版本、manifest 和原归档后，直接 `npm publish <verified.tgz>`，不重新打包。

PR、合并提交和 release tag 是独立身份；本轮不跨 run 借用旧 PASS。公共 npm 发布权限只出现在 publish step，PR 验证无需 npm 发布 token。

## 减少 smoke 的重复启动

每个宿主仍通过真实 npm exec 验证 install、status、update、uninstall。其他冲突、漂移和能力组合用同一个已安装的候选包 CJS 入口启动独立 Node 进程；每次调用前后核对安装目录与原 tgz 的成员字节。

原有独立宿主目录、进程边界、两 worker 与共享组内 npm cache 保留。`executionMetrics` 记录 npm/Node 调用次数及耗时，只有数值，不记录连接配置或凭据。Packaged 验收证明分发与本地生命周期，不等于五种原生 AI 宿主都已实际加载或信任配置。

## 发布完成的定义

npm 上传成功后仍可能处于 registry processing。独立 registry-readiness job 有界退避检查精确版本、integrity、latest、标准 tarball，以及全新临时 npm cache 下的普通 npm pack。

- `AVAILABLE`：公共 registry 与下载字节核对通过。
- `PUBLISHED_PENDING_REGISTRY`：已经发布，但在等待上限内尚未证明可下载。只重跑只读验证，不能再次发布相同版本。
- `FAILED`：身份、内容摘要、认证或验证条件失败，保留具体分类及回执。

已发布版本不删除、不重复发布、不回退 dist-tag。服务端真实 QA MCP 接入验收独立记录；公共 GitHub runner 不因无法访问团队内网而假造通过。

## 这轮测量的边界

上次 0.3.7 的同提交证据中：PR CI 8分52秒、Acceptance 8分31秒、Release 7分25秒，三者并行窗口12分13秒；npm publish step只有2秒。PR Windows packaged 测试476秒、Release Windows smoke389秒，是优先优化对象。

去重可直接减少 runner 工作量；实际墙钟收益取决于调度和平台。Linux smoke 对比不能当作 Windows 加速结果。新版本需以实际 Actions job 与 executionMetrics 为准，不把取消测试或减少支持平台当作提速。

本轮同一旧产品的 Linux 单次对照为 29.415 秒 → 11.795 秒（约减少 60%，前者含少量 npm script 启动开销）；
每宿主 npm exec 从 22 次减为 4 次，另有 18 次独立 Node 调用。当前新产品的五宿主 smoke 为 11.975 秒并通过。
这些是本机观测；Windows 与 Actions 整条流水线仍以对应运行回执为准。

## Windows 测试分片与依赖审计

0.3.8 的三次完整运行显示 Windows 源码测试分片负载不均。下表是 `test:ci:shard` step 的秒数，不含排队、安装或构建：

| 运行 | Node 22 分片 1 / 2 | Node 24 分片 1 / 2 |
| --- | ---: | ---: |
| [PR 37878565271](https://github.com/Tooc0ld/kcoderag-nav/actions/runs/37878565271) | 282 / 129 | 210 / 115 |
| [master 37879132727](https://github.com/Tooc0ld/kcoderag-nav/actions/runs/37879132727) | 236 / 108 | 228 / 80 |
| [Release 37879137484](https://github.com/Tooc0ld/kcoderag-nav/actions/runs/37879137484) | 240 / 119 | 192 / 116 |

Release Node 22 中，`host-smoke.test` 用例累计约 59 秒，`readiness-workflow.test` 约 36.5 秒，
`release.test` 约 29.7 秒，原来都落入第一个分片；Windows 的单次构建约 6–12 秒。
这些是单次观测，不能当作固定服务时间或承诺加速比例。

`ci-test-shard` 现在从当前 checkout 的 `dist-tests` 递归发现全部 `.test.cjs` 文件，
按已观测的耗时从长到短分配给当前累计权重较低的分片，文件名使用 ordinal 排序打破平局。
未知、新增文件按默认权重自动纳入；权重只用于安排执行顺序，不是测试清单或历史 PASS。
删除的文件不会因历史权重而重现。两个 Windows 分片互斥且并集等于完整发现集合，
Linux 的 `1/1` 仍运行完整集合，现有唯一 packaged 重复用例过滤保持不变。

每个 job 在测试前输出 `ci_test_shard` JSON：完整集合的文件数和 SHA-256、
本分片的文件数、SHA-256、估算权重及所选文件路径。相同提交的两个分片应具有相同的
`inventorySha256`；最终通过仍依赖每个实际测试进程的退出状态和原有矩阵门禁。
空集合、重复或不合法路径、空分片以及发现阶段的文件错误都会失败，不能静默跳过。

依赖审计测试的变体只修改内存对象，不修改安装目录。该测试文件现在只执行一次真实
`npm ls --all --json --long`，每个变体从当前结果独立深拷贝；原有拒绝条件和不可变性断言全部保留，
并额外检查三个嵌套对象的隔离。独立 `deps:audit` 门禁仍然读取实际依赖图。
这里没有跨 job、跨提交或跨运行复用 PASS，也没有删除真实 pack、生命周期或内容篡改验证。
本轮加速结果需要由新一轮 Windows Actions 耗时确认。
