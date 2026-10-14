# 社区架构 / Architecture

[中文](#中文) · [English](#english)

## 中文

设计采用 **TypeScript Monorepo、模块化单体和独立 Worker 进程**。Web 使用 Next.js， API 使用 Fastify，PostgreSQL 保存业务事实，PostgreSQL Outbox + Worker 轮询完成异步分析与提醒。AI 通过可配置 Responses / Chat Completions 双协议传输访问外部模型；模型设置和连接测试页面已交付；真实 DeepSeek/本地模型完整联调和通知渠道仍未交付。

### 主要模块
- 项目与权限：成员、租户、项目作用域。
- 群聊（当前：消息持久化、增量轮询与断线补拉；实时推送、引用消息 UI 尚未交付）。
- 任务与风险（当前：任务/风险记录及候选审批；完整决策工作流待实现）。
- AI 编排：从上下文提出有证据的候选变更。
- 提醒和报告：后台执行、去重、可核查汇报。
- 知识资料（规划：带版本与权限的附件及索引，当前尚未交付）。

**注意**：模型不能直接改正式任务；提交由领域命令和服务端权限控制。数据更新与事件通过事务 Outbox 衔接。

[详细中文方案](../design/system-architecture.md) · [English](#english)

---

## English

The proposed architecture uses a **TypeScript monorepo, modular monolith, and a separate worker process**. Next.js provides the UI, Fastify the API, PostgreSQL stores authoritative records, and a PostgreSQL Outbox and polling worker handle asynchronous analysis and reminders. AI supports configurable Responses / Chat Completions HTTP transports. Live DeepSeek/local-model verification, a settings UI and notification adapters are not shipped. Reminders are built into ChatPM.

### Core modules
- Project and access control: membership, tenants, project scopes.
- Chat (current: durable messages, incremental polling and catch-up; live push and message-reference UI are not shipped).
- Work and risks (current: task/risk records and proposal approval; full decision workflow is planned).
- AI orchestration: evidence-backed proposed changes.
- Automation and reporting: durable, deduplicated reminders and auditable reports.
- Knowledge (planned: versioned, permission-scoped attachments and indexes; not shipped).

**Important:** The model cannot directly mutate official task state. Domain commands and server-side authorization control changes. A transactional outbox connects persisted state updates to asynchronous events.

[Full design (Chinese)](../design/system-architecture.md) · [中文](#中文)

## 当前模型与正式领域权限 / Current model and governance permissions

中文：系统总管理员集中配置模型连接、密钥和默认模型，项目负责人只能控制项目 AI 是否启用。项目管理登记簿增加价值目标、里程碑、交付物验收、问题、决策、变更请求与任务依赖等正式对象；关键变更审批和验收采用服务端权限、审计及幂等命令。当前产品仍是实验性版本，新的项目管理 API 不等于已经实现完整项目经理自动执行、全部管理界面或生产验收。

English: Platform administrators centrally manage AI connections, credentials, and the default model. Project owners control whether AI is enabled for their project. The formal PM register adds goals, milestones, deliverable acceptance, issues, decisions, change requests, and task dependencies. Server-side authorization, auditable idempotent commands, and explicit human review guard critical changes. These initial APIs do not constitute a complete autonomous PM or production acceptance.

## 历史 ADR-021（已被系统管理员统一模型策略取代） / Historical ADR-021 (superseded)

中文：此前曾允许项目 Owner 配置固定供应商，目前已废止；现行模型与密钥管理权仅属于系统管理员。项目 AI 助手仅具备候选提取、近期上下文和 `@AI` 只读回答，无 Shell/文件控制能力。

English: An earlier project-scoped provider configuration was removed. Only platform administrators may manage AI model credentials and connections now; project owners toggle project AI access. The assistant supports evidence-backed proposals and read-only `@AI` replies, not arbitrary tools or autonomous official task changes.

## ADR-022 · 进度证据与日期、风险驱动检查

中文：任务期限是项目当地 `DATE`；已有任务进度在聊天分析后生成带来源的待审证据，Owner 可以确认/忽略，不会由 AI 更新正式任务完成状态。已分配任务从建立后即进入阶段检查计划，阻塞事项提高提醒频率；默认按时区工作窗口和冷却策略发送站内消息。界面日期只到天，任务栏展示待审核进展。

English: Task deadlines are local calendar dates. AI links progress/blocker/completion claims to existing same-project tasks as pending sourced evidence; an owner must review and no AI action automatically marks formal work done. Assigned tasks enter a proactive check-in schedule and blocked items receive higher priority, while existing working-hour and cooldown policies remain in force.
