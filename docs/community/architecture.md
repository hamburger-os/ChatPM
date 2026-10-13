# 社区架构 / Architecture

[中文](#中文) · [English](#english)

## 中文

设计采用 **TypeScript Monorepo、模块化单体和独立 Worker 进程**。Web 使用 Next.js， API 使用 Fastify，PostgreSQL 保存业务事实，PostgreSQL Outbox + Worker 轮询完成异步分析与提醒。AI 通过可配置 Responses / Chat Completions 双协议传输访问外部模型；真实 DeepSeek/本地模型联调、模型设置 UI 和通知渠道仍未交付。

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

## ADR-021 · 用户可配置的受限项目模型 / Project-scoped controlled models

中文：项目 Owner 可以在 UI 对固定的 OpenAI/DeepSeek HTTPS 提供商设置模型名称和加密密钥，也可以选择服务器预配置模型；配置采用项目隔离和审计，不允许客户端任意模型 URL。内建 Agent 仅具备候选提取、近期上下文和 `@AI` 只读回答；无权限自行提交正式任务，也未嵌入 Pi Coding Agent 的文件/Shell 能力。

English: Project owners can configure model IDs and encrypted keys for fixed HTTPS OpenAI/DeepSeek endpoints or use the server-managed provider. Configurations are project-scoped and audited; arbitrary client-provided URLs are not allowed. The restricted PM assistant supports candidate extraction, bounded recent context and read-only `@AI` replies, not autonomous task commits, Pi coding-agent shell/file tools or long-term memory. Records and model connectivity checks are exposed only to owners.

## ADR-022 · 进度证据与日期、风险驱动检查

中文：任务期限是项目当地 `DATE`；已有任务进度在聊天分析后生成带来源的待审证据，Owner 可以确认/忽略，不会由 AI 更新正式任务完成状态。已分配任务从建立后即进入阶段检查计划，阻塞事项提高提醒频率；默认按时区工作窗口和冷却策略发送站内消息。界面日期只到天，任务栏展示待审核进展。

English: Task deadlines are local calendar dates. AI links progress/blocker/completion claims to existing same-project tasks as pending sourced evidence; an owner must review and no AI action automatically marks formal work done. Assigned tasks enter a proactive check-in schedule and blocked items receive higher priority, while existing working-hour and cooldown policies remain in force.
