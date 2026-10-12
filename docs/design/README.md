# 02 · ChatPM 中文设计方案

**给产品负责人审查。** 本层刻意控制在架构与方案粒度，不要求直接阅读源码。当前整体状态：**架构基线已审查 / v0.2 实验性 MVP 已部分实施 / 尚未生产验收**。

## 推荐审查顺序
1. [产品定位与 MVP 边界](product-scope.md)
2. [系统架构与技术选型](system-architecture.md)
3. [领域数据模型与可信项目状态](domain-model.md)
4. [聊天室、消息与可靠事件](messaging.md)
5. [AI 项目经理编排与权限](ai-orchestration.md)
6. [主动跟进、提醒与升级](followup-scheduling.md)
7. [项目资料、知识检索与汇报](knowledge-reporting.md)
8. [安全、隐私、可观测与运维](security-operations.md)
9. [集成与扩展边界](integrations.md)
10. [开发阶段与验收标准](roadmap-acceptance.md)
11. [架构决策记录（ADR）](decision-log.md)
12. [全量架构审查报告](review-2026-10-12.md)
13. [MVP 实施状态](implementation-status.md)
14. [MVP 代码 /review 记录](review-mvp-2026-10-12.md)
15. [第二轮可靠性与扩展性审查](review-reliability-2026-10-12.md)
16. [v0.2 全量 /review](review-v02-2026-10-12.md)

## 如何审查
重点判断：AI 是否能推动工作同时避免乱改项目事实；任务是否有明确负责人和确认流程；延期提醒是否有效但不会刷屏；业务失败后能否恢复；架构能否平滑扩展。

本层架构基线已审查，MVP 仍按阶段实施与验收；具体默认值见 ADR，保留未决业务问题。变更重要决策时同步 ADR；产品负责人确认后才进入实施。技术实现细节在 `docs/ai/`，通用 PMP 知识在 `docs/knowledge/`，社区指引在 `docs/community/`。
