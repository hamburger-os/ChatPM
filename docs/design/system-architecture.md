# 系统架构与技术选型

## 架构选择
采用**TypeScript Monorepo + 模块化单体**：Web 前端、API 进程、异步 Worker 进程，共享清晰的领域模块和契约。初期使用一个 PostgreSQL 业务数据库，不拆微服务。API 与 Worker 可以独立扩缩容，但属于同一个产品系统。

`Web (Next.js) → API (Fastify) → 领域模块 → PostgreSQL`

`数据库 Outbox → 事件发布器 → PostgreSQL 轮询 Worker → 领域命令 / 外部渠道`

`Worker → AI 编排器 → Model Adapter（可替换模型）`

## 技术组件
| 组件 | 方案 | 选择理由 |
|---|---|---|
| Web | Next.js + React + CSS | 聊天与任务界面统一开发 |
| API | Fastify + TypeScript strict | 模块治理、验证、注入及测试结构 |
| 数据 | PostgreSQL + pg，不额外引入 ORM | 事务、约束、版本化业务记录；按模块拆分 SQL 所有权 |
| 异步调度 | PostgreSQL Outbox 与轮询 Worker | 初期避免双持久化，按规模再引入独立队列 |
| 附件（规划） | S3 兼容对象存储 | 原始附件独立于业务表；当前未交付 |
| 知识检索（规划） | PostgreSQL 全文检索优先，pgvector 按效果引入 | 当前未交付，不把向量相似度当事实 |
| AI | 单一编排器 + Provider 接口 | 避免锁定模型及多 Agent 复杂性 |
| 部署 | 同一编译核心 + Docker Compose / Windows / Linux | 不锁定部署工具；使用统一配置、迁移和 HTTP 契约 |

## 领域边界
Identity/Tenancy、Projects、Conversations、Work、Risk/Decision、AI Orchestration、Automation、Knowledge、Reporting、Integrations、Audit。每个模块拥有数据写入权，跨模块通过明确服务契约调用。所有入口依赖同一鉴权与审计体系。

## 取舍和扩展
- **不用微服务**：初期一致性与运维比独立部署更重要；通过领域边界为将来拆分做准备，而非现在就承担分布式成本。
- **不全量事件溯源**：当前需求以当前业务状态 + 历史/审计为主，避免事件重放和版本演化复杂性。
- **不把队列作为事实源**：跟进计划保存在 PostgreSQL；当前使用 PostgreSQL 轮询，确有性能需求后再考虑独立队列。
- 未来瓶颈明显时，先独立扩 Worker，再考虑独立服务或专用检索引擎，需追加 ADR。

## 非目标
本设计没有任何旧系统接口和前后兼容包袱；一切从统一领域契约开始。

## 运行时边界与部署目标

目前 API、Web、Worker 分进程运行，PostgreSQL 是唯一正式项目事实来源；Worker 直接轮询事务型 Outbox 和跟进计划，不依赖 Redis/BullMQ。聊天使用 HTTP 轮询。所有外部 AI 请求需要项目负责人开启。

目标为共用产品核心的官方 SaaS 与自部署，云端与本地模型通过适配器接入。只有在实测需求充分时才增加其他分布式组件，避免建立无使用依据的兼容层。

详见 [部署架构和跨平台运行契约](deployment.md)，完整生产安全验收仍未完成。

## ADR-033 · Worker 运行任务模块边界

Worker 是独立部署的调度进程，而非所有领域业务的所有者。将事件/AI 候选处理、规则提醒、周期报告分为 `Conversation.AIEventRunner`、`Automation.ReminderRunner` 与 `Reporting.PeriodRunner`，在 `packages/core/src/` 内共享数据库事务与项目时区策略；Worker 仅调度，不重复实现相关 SQL。消息事件/AI 候选逻辑保持原有 SQL 与模型行为，但代码移入 `packages/core/src/conversation/ai-event-runner.ts`。进程入口只调度、心跳和优雅关闭。

该抽取不改变 Outbox 至少一次投递、提醒静默窗口/冷却时间、消息 nonce 幂等或历史报告的“当前项目周期状态快照”限制，也不引入 Redis、微服务或复杂工作流引擎。API/Worker 同源对领域命令的完全收敛仍为目标，非本批已完成。

## ADR-042 · 统一 ModelEgress 出口

模型配置源自系统管理员，然而“管理员配置”不等于允许服务自动读取内部网络服务。ModelEgress 在目录发现、连接探针和正式推理三个调用面统一施行地址安全策略：解析公网 DNS 的 A/AAAA 全集，任何地址为私网/保留地址则 fail closed；将验证通过的 IP 固定到 Node HTTP(S) socket 的 lookup；禁用重定向和连接复用，保留目标域名证书验证并限制请求超时/响应大小。只有明确配置的本地端点允许 HTTP/私网 DNS，避免破坏本机 Ollama 和容器 host.docker.internal 用法。第三方响应只用于数据处理，不信任其指令或可执行 URL。网络层出站控制、代理环境、实际厂商 TLS 与大规模请求均在正式部署前另行验收。

## ADR-044 · ProjectGovernance 命令边界

旧项目人员和设置写入从 `server.ts` 抽离到项目治理路由，遵守既有模块化单体：认证主体→当前组织与项目 owner 行锁→权限/目标人员与任务不变量→业务 SQL→Audit/DomainEvent/Outbox/CommandReceipt 的单 PostgreSQL 事务。人员移除管理者或观察者与普通成员一样受未完成任务和 owner 不可移除约束；设置单独增加 `settings_revision` 实现 UI 乐观锁（原 AI 授权开关版本 `ai_authorization_version` 仍由旧触发器维护，二者不混用）。所有客户端命令重试需保留相同 UUID，变更意图生成新 UUID。暂不为它引入独立权限服务器、微服务或兼容无 key 写法。

## ADR-046 · Risk Register Command 的边界

Risk 是未来不确定性（不同于已发生 Issue）。项目内 AI 提议风险由真实人员批准后建立仅 open 的记录；对风险 `PATCH /projects/:id/risks/:riskId/assessment` 更新概率、影响、责任人及应对计划，`POST /projects/:id/risks/:riskId/transition` 执行 open→mitigating→resolved 或 resolved→open，每次在项目权限锁和 Risk FOR UPDATE 锁下比较 expectedVersion。每次状态或评估更新同时插入不可更改的 risk_register_changes、CommandReceipt、Audit、DomainEvent 和 Outbox；历史查询按版本分页且需本项目有效成员身份。跨项目 Risk/历史组合 FK 拒绝，不用可变项目成员 FK 锁定历史责任人。报表未解决风险包含 open+mitigating。不存在旧无键兼容写路由，也不允许聊天模型代签批准。
