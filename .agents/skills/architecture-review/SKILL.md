---
name: architecture-review
description: 引入 ChatPM 新领域模块、基础设施、AI 能力、数据流或外部集成之前审查必要性、取舍、安全、性能与扩展边界，并维护架构决策记录。
---

# Architecture Review

1. 阅读 `docs/design/system-architecture.md`、`docs/design/domain-model.md` 和 `docs/design/decision-log.md`。
2. 描述场景、规模假设、失败模式，以及简单方案与复杂备选方案。
3. 检查模块所有权、事务边界、并发、可信数据源、AI 权限、审计、错误恢复、费用、可观测、数据保留、替换接口。
4. 给出“为什么选择 / 为什么不选择”与复审条件；不得仅凭流行趋势引入微服务或多 Agent。
5. 更新对应中文设计和 ADR；重大变更获得产品负责人审批后开发。
6. 使用 docs-sync 同步 AI 契约和社区文档。

产出应使产品负责人不读源码也能判断设计是否合理。
