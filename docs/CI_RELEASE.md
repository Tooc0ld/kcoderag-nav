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
2. 原有 Windows/Linux × Node 22/24 测试矩阵继续执行；Windows 保留两个测试分片。完整 suite 已包含 launcher 与 pack 测试，不在每个 job 结尾再次执行它们。
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
