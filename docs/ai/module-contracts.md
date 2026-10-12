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

## 当前可执行模块（v0.1）
- `apps/api/src/server.ts`：Fastify HTTP 接入、身份、项目权限、消息、任务、候选、报告；后续继续拆成领域路由/服务。
- `apps/worker/src/worker.ts`：扫描 Outbox、仅在项目开启 AI 时分析、持久化候选、工作时段催办及生成报告草稿。
- `packages/core/src/messages.ts`：项目内串行化消息插入，确保提交序与增量游标一致；`packages/core/src/db.ts`：PostgreSQL 事务；`security.ts`：会话与密码；`followup.ts`：计划更新；`policy.ts`：时间策略；`reports.ts`：报告生成。
- `apps/web/app/`：Next.js 客户端，当前消息 5 秒刷新。
- 已采用 PostgreSQL Outbox 处理幂等、退避及隔离，暂无独立 InboxReceipt、Redis/BullMQ、附件/知识库或多个模型供应商。设计中的其他模块尚未全部落地。

## AI 主动追问（v0.1）
对明确缺少负责人或日期的候选事项，Worker 最多在一次反馈中提出两个简短的澄清问题；同一项目在 10 分钟内不重复发布同类自动提取提示。候选本身仍持久化并等待人工确认，不因限频丢弃。当前为轻量群聊交互，不是多轮自主决策引擎。

## 已实现的并发契约（2026-10-12）
- `insertMessage(db, input)` 只允许在调用方事务中执行；API/Worker 不得直接跳过项目消息锁。项目内消息序号与提交顺序一致，不同项目独立并发。
- 任务重排不得突破 `last_sent_at + cooldown_hours`；重复 nonce 的提醒不记录第二份发送审计。
- `generateReport` 以单条 SQL 快照获取全量聚合指标，仅截断明细；重复生成只刷新 `draft`，不得覆盖 `published`。
- 冒烟测试需覆盖并发消息、冷却恢复、超过 200 任务的统计以及发布不可变性。

## v0.2 新增模块契约
- `packages/core/src/outbox.ts`：`claimEvents` / `finishEvent` / `failEvent` / `deadEvents`；五分钟租约、最多八次处理、延迟重试、临界崩溃隔离和脱敏错误；消费者仍需业务幂等。
- `packages/core/src/ai-provider.ts`：`LLMProvider` 抽取候选、明确关联回复；内部受控模型调用、Zod、按项目原子每日请求配额。
- `packages/core/src/clarification.ts`：严格 `【候选:UUID】` 引用，回复只写持久澄清与来源，不修改正式 Task。仅 owner 的 `ApproveProposedChange` 可以将候选及澄清结果写正式状态。
- `packages/core/src/migrate.ts`：以事务 + advisory lock + checksum 按文件序号应用变更；禁止修改已应用的 SQL。
- 负责人 Outbox GET / 重试命令作用域由 API RBAC 强制，重放写 Audit，不能通过 Prompt 或模型工具跳过。

## v0.2 新增模块及入口
- `core/outbox.ts`：领取、完成、失败、死信查询，带租约、退避和安全错误码；owner 通过后端 RBAC 进行隔离事件重放，事务审计。
- `core/ai-provider.ts`：LLMProvider、结构化候选与回复提取、项目每日调用预算（UTC），不允许模型直接写正式任务。
- `core/clarification.ts`：解析 `【候选:UUID】`，只保存候选的多轮证据回复；owner 审批后才转成正式任务，线程关闭。
- `core/migrate.ts`：校验和、事务、数据库锁及顺序版本迁移。

- Outbox 诊断命令 `outboxSummary(projectId)` 返回待处理、隔离、模型错误计数和最老等待时间，API 只向有权限的 owner 暴露。每次领取使用 UUID `claim_token`，旧 Worker 不能在租约过期后覆盖新 Worker 的完成状态。
## 定时报告不变量（合并后 /review）
`generateScheduledReport(db,projectId,kind)` 在已有数据库事务内执行，持有项目/类型/周期 advisory lock，若本期报告存在则不再执行。它与人工 `generateReport` 分离：定时计划不得覆盖已生成草稿，人工可重算草稿，已发布内容保持不可变。Worker 按项目 ID 键集分页，每分钟扫描一次；并发副本由数据库锁保证本周期至多创建一次。CI 的 `reports.integration.ts` 覆盖这组并发不变量。
