# 模块契约与实现边界（供编码 Agent）

## 领域所有权

| 领域 | 当前正式对象 | 后续扩展概念 |
|---|---|---|
| Identity / Tenancy | User、Tenant、TenantMember、Session | 企业身份提供商、组织级策略 |
| Projects | Project、ProjectMember、Settings | Milestone、项目模板 |
| Messaging | Message | Room、Attachment、引用与编辑版本 |
| Work | Task、Task version | Dependency、Commitment、状态历史 |
| Risk / Approval | Risk、ProposedChange | Decision、Approval 工作流 |
| AI | ClarificationThread/Response、来源证据、项目请求配额 | AnalysisRun、长期记忆和质量评价 |
| Automation | FollowUpPlan、OutboxEvent | 复杂干预、外部投递记录 |
| Reporting | Report | 历史基线、周期快照、可编辑草稿 |
| Integrations | OpenAIProvider | 本地模型、更多 Provider、通知与对象存储 |
| Audit | AuditEntry | 完整组织级审计查询 |

目标设计不能伪装成当前已经存在的数据库表或 API。

## 目前可执行入口

- `apps/api/src/server.ts`：Fastify HTTP、身份与租户、项目、成员、消息、任务、候选、风险、报告。后续按领域拆路由/应用服务。
- `apps/worker/src/worker.ts`：消费消息事件、AI 单消息候选提取和显式澄清、站内提醒、报告定时创建。
- `apps/web/app/page.tsx`：Next.js 单页客户端；消息短轮询；完整历史分页和实时推送尚未实现。
- `packages/core/src/`：PostgreSQL 事务、会话、消息序号、模型、澄清、跟进策略、Outbox、报告和迁移。

## 核心命令与权限

- `PostMessage`：每次必须验证项目成员与团队成员资格；事务内统一插入 Message 和 Outbox；项目级锁保证 seq 提交顺序、nonce 保证幂等。
- `AnalyzeMessage`：仅在项目 Owner 启用模型时触发；模型输出需 Schema + Zod 校验，只存带来源的候选，不直接写正式 Task/Risk。
- `ClarifyProposal`：成员消息含明确 `【候选:UUID】` 才关联现有线程；重复回复幂等，仅更新待确认线索。
- `ApproveProposal`：只有 Owner 可以确认/拒绝；创建正式记录并审计，候选不可被重复确认。
- `UpdateTask`：版本乐观锁；Owner 可以调整计划，指派成员仅能修改自己的任务状态。
- `RunFollowUp`：检查最新状态、工作时段与冷却；静默不能视为已发送；事件重复不导致重复提醒。
- `GenerateReport`：SQL 单次快照，完整聚合但有界明细；人工只覆盖草稿，已发布内容不可变；定时报告每项目/类型/周期至多创建一次。
- `ReplayOutbox`：项目 Owner 授权、事务审计；事件是至少一次交付，旧 claim token 不允许回写新租约状态。

## 身份、租户和关系不变量

- `GET /tenants` 只返回当前用户团队；创建项目 `POST /projects` 必须显式 `tenantId` 且用户是对应租户管理员。
- 项目访问必须同时验证 `project_members` 与 `tenant_members`。
- `DELETE /projects/:id/members/:memberId` 只有 Owner 可以移除普通成员；撤销后项目访问立刻失效。
- `POST /auth/logout` 撤销带 JTI 的服务端 Session；Cookie 清除不等于独立的鉴权保障。
- 消息、候选、风险、任务、澄清和 Outbox 的关联依赖组合外键保护同一项目作用域。
- 数据库迁移有事务锁与校验和，已发布的迁移文件不可直接编辑。

## AI 与扩展原则

`LLMProvider` 是模型抽象；目前只有 `OpenAIProvider`，不得声称支持本地或多供应商。观察、正式业务变更、通知与外部工具必须经过确定性服务端权限边界。其他目标适配器和领域概念按实际用例渐进实施，不创建没有实现者的空抽象。

## 验收要求

所有业务变更需带有对应设计说明和自动化回归。重点覆盖跨租户、跨项目数据、会话撤销、失效成员、任务乐观锁、模型超额、消息乱序、未知事件、租约过期、重复发送、工作窗口、草稿不可覆盖和多 Worker 并发。真实外部模型质量、隐私、生产部署和备份恢复仍需独立验收。
