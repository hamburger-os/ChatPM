# ChatPM 产品与系统设计

本层只描述当前有效的规则、已作出的架构选择和可验收的目标。不以历史版本罗列实现轨迹。

## 文档索引

1. [产品定位与核心闭环](product-scope.md)
2. [系统架构和技术选型](system-architecture.md)
3. [领域模型与可信项目状态](domain-model.md)
4. [消息、游标与可靠事件](messaging.md)
5. [AI 编排、证据与授权](ai-orchestration.md)
6. [提醒、工作时间与跟进策略](followup-scheduling.md)
7. [知识和项目报告](knowledge-reporting.md)
8. [安全、隐私与运维](security-operations.md)
9. [扩展与第三方集成](integrations.md)
   - [自主 IM 接入与企业微信首发](im-integrations.md)
10. [交付与验收路线图](roadmap-acceptance.md)
11. [架构决策记录](decision-log.md)
12. [实施状态与剩余差距](implementation-status.md)
13. [组织与项目治理、系统 AI 管理](organization-governance.md)
14. [分层导航与供应商连接中心](navigation-provider-center.md)
15. [V2 目标架构与边界](v2-architecture.md)
16. [命令、事件与事务契约](command-event-contracts.md)
17. [AI 授权与可追溯运行时](ai-governance-v2.md)
18. [项目管理方法与 Playbook](project-methods-playbooks.md)
19. [V2 分期迁移与验收](v2-delivery-plan.md)


[仓库审查与验收结论](review.md) 聚合当前未关闭的风险。历史审查记录可从 GitHub PR 与提交记录查阅，不在当前设计索引重复列出。

**原则：** AI 的观察和推断不是正式项目事实；高影响动作需后端策略许可和审计。设计不得把尚未完成的 SaaS、本地模型、知识库或企业功能写成已交付。

