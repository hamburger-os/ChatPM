# ChatPM 文档中心

本仓库实行**设计先行**，当前所有产品功能均是待实现设计。根 [README](../README.md) 提供项目概述。

## 四层文档及权威顺序

| 层 | 面向谁 | 内容 |
|---|---|---|
| [01 · AI 开发文档](ai/README.md) | AI 编码 Agent | 架构约束、模块契约、实施规则 |
| [02 · 中文设计文档](design/README.md) | 产品负责人 | **首要审查入口**：架构、方案、取舍、验收 |
| [03 · 通用知识](knowledge/README.md) | 项目团队 | PMP / PMBOK、风险管理、AI 治理 |
| [04 · 社区文档](community/README.md) | 社区贡献者 | 中文/英文项目概览、架构及开发指引 |

## 模块审查索引

| 模块 | 审查文档 |
|---|---|
| 产品边界 | [产品定位和 MVP 范围](design/product-scope.md) |
| 基础架构 | [系统架构](design/system-architecture.md) |
| 项目事实与状态 | [领域模型](design/domain-model.md) |
| 消息与可靠交付 | [消息和事件](design/messaging.md) |
| AI 能力 | [AI 编排](design/ai-orchestration.md) |
| 主动催办 | [跟进与调度](design/followup-scheduling.md) |
| 文档和报告 | [知识与汇报](design/knowledge-reporting.md) |
| 权限和稳定性 | [安全与运维](design/security-operations.md) |
| 外部生态 | [集成与扩展](design/integrations.md) |
| 实施计划 | [里程碑与验收](design/roadmap-acceptance.md) |
| 架构取舍 | [架构决策记录（ADR）](design/decision-log.md) |

## 同步原则
`docs/design/` 是经负责人审查的权威架构设计；`docs/ai/` 是对应的工程实施契约，`docs/community/` 是供社区理解的双语说明，`docs/knowledge/` 为参考知识。发生冲突应提出设计审查，不得自行选择实现。更改代码时运行 [docs-sync Skill](../.agents/skills/docs-sync/SKILL.md)。
