# AI Agent 交付流程

1. 阅读中文 `docs/design/` 及相应 `docs/ai/`，确认当前为设计中还是已批准。
2. 如需求改变架构，使用 architecture-review 更新设计/ADR 并等待用户审查。
3. 只在批准的契约范围内做最小实现；避免无证据抽象和历史兼容。
4. 设计接口、错误与并发场景的测试，再改动实现。
5. 使用 docs-sync 同步 AI、中文设计、中英社区文档。
6. 检查 `node tools/docs/check-docs.mjs`，PR 有产品代码变更时执行 `node tools/docs/check-sync.mjs <base> <head>`，然后运行仓库中**实际存在**的测试命令。
7. PR 明确说明设计差异、测试真实结果、遗留风险和需要审查的决策。

优先实施：权限/项目 → 可靠群聊 → 任务与候选确认 → AI 抽取 → 跟进策略 → 报告 → 知识检索 → 其他集成。
