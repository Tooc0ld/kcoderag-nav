---
quick_id: 260820-p1v
status: complete
---

# 项目级插件迁移完成

- 初始检查确认 `D:\AIProgram\kcoderag-nav` 未安装项目级插件。
- 已在 `D:\AIProgram\kcoderag-nav` 项目级安装 QA 与 Dev：两个 MCP、两个 advisory hook、共享导航 skill 和安装状态均存在。
- `D:\AIProgram\KCodeRag` 初始即没有 KCodeRag 插件 hook、skill 或安装状态，因此未执行删除；其 QA/Dev MCP 配置保持不变。
- 未读取到日志或文档中的 Bearer 值，也未把项目级安装产物加入本次 Git 提交。

## Verification

- `python scripts/generate_plugins.py --check`：通过。
- `python -m unittest discover -s tests -v`：15/15 通过。
- `python kcoderag-qa/hooks/test_grep_nudge.py`：53/53 通过。
- `python kcoderag-dev/hooks/test_grep_nudge.py`：53/53 通过。
- 结构断言：`kcoderag-nav` 为双插件状态；`KCodeRag` 为仅双 MCP 状态。
