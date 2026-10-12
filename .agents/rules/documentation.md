# 文档治理规则

- 四层：[AI 工程文档](../../docs/ai/README.md)、[中文设计](../../docs/design/README.md)、[通用知识](../../docs/knowledge/README.md)、[中英社区文档](../../docs/community/README.md)。
- 产品负责人**只需审中文设计层**，该层须说明目标、模块边界、数据流、取舍、失败/安全路径、验收，不展开行级实现。
- 先改中文设计和 ADR，再改 `docs/ai/`，最后更新 `docs/community/<topic>.md` 同一文件中的中文与 English 两个章节。
- 改动产品代码/运行配置时，执行 `.agents/skills/docs-sync/SKILL.md` 并在同 PR 至少更新一个对应设计文件和一个 AI 文档。
- 新增模块同时更新 `docs/README.md` 及各层 README 索引；社区主题文档直接存于 `docs/community/`，不再创建语言子目录；知识资料不覆盖本项目已选设计。
- CI 检查只保证文档链接和每个社区主题的双语章节存在，不保证语义一致；审查者需检查两个章节的事实一致性。
