# 模块契约（供 AI）

| 模块 | 数据所有权 | 公开能力 |
|---|---|---|
| Identity/Tenancy | Tenant、User、Membership、Role | 身份、租户及项目权限 |
| Projects | Project、ProjectSettings、Milestone | 项目设置、项目时区、阶段 |
| Conversations | Room、Message、AttachmentRef | 消息持久化、引用、读取 |
| Work | Task、TaskDependency、TaskHistory | 任务命令、状态机、并发校验 |
| Risk/Decision | Risk、Decision、Approval | 风险确认、决策审批 |
| AI Orchestration | AnalysisRun、Evidence、ProposedChange | 读取上下文、产生候选、申请确认 |
| Automation | FollowUpPolicy、FollowUpPlan、DeliveryAttempt | 持久调度、通知、退避和取消 |
| Knowledge | Document、DocumentVersion、IndexRecord | 解析、版本化、授权检索 |
| Reporting | Report、ReportSnapshot | 按截止时点生成报告草稿 |
| Integrations | ProviderConnection、ChannelMapping | 大模型、IM、通知、对象存储适配 |
| Audit/Events | AuditEntry、OutboxEvent、InboxReceipt | 事件可靠交付、幂等、追溯 |

## 受控流程
- `PostMessage`：后端授权；数据库事务写 Message + Outbox；成功入库后响应，广播异步完成。
- `AnalyzeMessages`：按权限获取消息/相关任务；模型给出受 Schema 限制的 ProposedChange 和 Evidence；**不能直接更新 Task**。
- `ApproveProposedChange`：确认人、项目作用域、版本及策略校验通过后，以领域命令写正式状态与 Audit/Outbox。
- `RunFollowUp`：以计划幂等键执行；再次读取最新任务版本与静默规则，发送或重排，记录结果。
- `GenerateReport`：按项目时区计算报告时间段，使用结构化快照 + 引用材料生成草稿，发布受权限控制。

## 稳定扩展接口
`LLMProvider`、`ChannelAdapter`、`Notifier`、`DocumentParser`、`ObjectStore`。第一版各接口可只接一个提供商；不得让模型 SDK 泄漏进领域层。

跨模块写入用命令/服务边界，不直接更改其他模块表；DTO 与领域对象分离。
