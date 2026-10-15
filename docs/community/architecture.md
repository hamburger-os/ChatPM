# 社区架构 / Architecture

[中文](#中文) · [English](#english)

## 中文

设计采用 **TypeScript Monorepo、模块化单体和独立 Worker 进程**。Web 使用 Next.js， API 使用 Fastify，PostgreSQL 保存业务事实，PostgreSQL Outbox + Worker 轮询完成异步分析与提醒。AI 通过可配置 Responses / Chat Completions 双协议传输访问外部模型；模型设置和连接测试页面已交付；真实 DeepSeek/本地模型完整联调和通知渠道仍未交付。

### 主要模块
- 项目与权限：成员、租户、项目作用域。
- 群聊（当前：消息持久化、增量轮询与断线补拉；实时推送、引用消息 UI 尚未交付）。
- 任务与风险（当前：目标、里程碑、交付物独立验收、问题、决策/变更登记、任务依赖与候选审批；完整基线联动与专项 PM 界面仍待实现）。
- AI 编排：从上下文提出有证据的候选变更。
- 提醒和报告：后台执行、去重、可核查汇报。
- 知识资料（规划：带版本与权限的附件及索引，当前尚未交付）。

**注意**：模型不能直接改正式任务；提交由领域命令和服务端权限控制。数据更新与事件通过事务 Outbox 衔接。

[详细中文方案](../design/system-architecture.md) · [English](#english)

---

### AI 授权版本与调用审计

项目负责人启用或关闭 AI 后，系统增加授权版本；每次新模型调用前再次检查当前授权，关闭时不再主动发出新的模型请求。每次模型调用尝试保留脱敏运行记录，区分成功、失败和具体模型/Prompt 版本；不会将聊天全文、密钥或供应商原始错误存入调用日志。Token 用量未从提供商获得时会显示为未知，不代表零消耗；该功能不是全面的权限/成本治理或生产安全认证。

## English

The proposed architecture uses a **TypeScript monorepo, modular monolith, and a separate worker process**. Next.js provides the UI, Fastify the API, PostgreSQL stores authoritative records, and a PostgreSQL Outbox and polling worker handle asynchronous analysis and reminders. AI supports configurable Responses / Chat Completions HTTP transports. The centralized model settings UI is available; live DeepSeek/local-model verification and external notification adapters are not shipped. Reminders are built into ChatPM.

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

### Versioned AI authorization and invocation audit

Project owners can turn AI on or off, which updates an authorization revision. New model calls recheck the current authorization; disabled projects should not initiate another model request. Individual attempts retain redacted model/prompt identities and success/failure diagnostics without copying chat contents, API keys, or raw provider responses. Missing token usage is shown as unknown, not zero. This is a first-stage audit mechanism, not a complete enterprise policy engine, exact cost ledger, or production security certification.

### Worker 模块化与提醒文案 / Worker modularity and reminders

中文：Worker 进程负责运行调度和健康心跳；消息事件、规则提醒和周月报分别由核心业务 Runner 管理。逾期提醒会明确表达逾期天数，截止日显示“今天截止”；这属于内部结构与沟通准确性改进，不意味着已经引入独立队列、分布式 Worker 或自动项目决策。

English: The Worker process owns scheduling and health checks, while message events, rule-based reminders, and scheduled reports run in separate core modules. Overdue reminders state the elapsed days and due-today reminders clearly say the deadline is today. This refactor does not introduce distributed job orchestration or autonomous project decisions.

### 架构边界检查 / Architecture boundary guard

中文：后台进程入口只负责启动、定时调度和健康状态；项目消息、跟进与报告由对应核心模块处理。CI 会防止 Worker 入口重新引入业务 SQL。现有 API 仍逐步模块化，不能认为已经拥有完整模块化单体的强制边界。

English: The background-process entrypoint now owns only startup, scheduling and lifecycle. Domain runners handle project events, follow-up and reports, while a CI boundary test rejects direct SQL in the Worker bootstrap. Legacy API routes are still being migrated; this does not assert that every module boundary is fully enforced.

### AI 黄金用例与模型实测 / AI golden evaluation

中文：ChatPM 使用合成项目协作示例检验 AI 对任务、进度、阻塞、风险、模糊日期和提示注入的理解，并明确列出当前尚未支持的管理能力。GitHub 自动化只检查测试数据和评分程序；真正模型质量需管理员主动使用模型密钥进行评测并保存结果。没有真实评测结果时，不会展示虚构的准确率。

English: Synthetic project conversations form a versioned golden set for task/progress/blocker/risk extraction, ambiguous dates and prompt-injection safety. Unsupported PM features remain explicit coverage gaps. CI checks the corpus and scorer only; live model quality requires a deliberate administrator-triggered run with real model access. No accuracy number is claimed without actual results.

### 任务依赖的完成保护 / Task dependency completion guard

中文：在项目治理中登记的任务依赖是完成前置约束。若前置任务尚未完成，下游任务不能被标记为完成；为已完成任务新增未完成的前置任务也会被拒绝。服务器在写入事务内重新检查项目与组织成员权限，防止成员被撤权后继续修改计划。此前已完成工作因实际质量问题重新打开时，仍需要项目经理处理下游影响；这不是自动项目变更或验收替代。

English: Registered task dependencies are finish-before-completion constraints. A dependent task cannot be marked done while any predecessor is incomplete, and a completed task cannot gain a new incomplete predecessor. The server rechecks both project and organization membership inside write transactions. Reopening genuinely defective earlier work remains possible and requires human assessment of downstream impact; this is not automatic baseline change management.

### 任务写入幂等与正式事件 / Idempotent task commands

中文：新增和修改正式任务现使用受服务端权限约束的幂等命令；每次操作生成一个客户端 UUID 命令键，同一操作网络重试不会重复新增任务或增加版本。任务修改保留乐观版本冲突判断，正式任务、审计、领域事件和提醒计划在同一数据库事务。AI 候选仍需人审核，部分旧候选审批的正式写入通道尚未迁移到统一命令运行时。

English: Direct task creation and edits now use server-authorized idempotent commands. Each action has a client UUID key; retrying the same request will not duplicate work or increment the version. Optimistic version checks remain, while task changes, audit, domain events and follow-up scheduling share a database transaction. AI proposals still require human approval, and some older proposal-approval write paths have not yet migrated into the shared command runtime.

### 项目负责人权限的并发保护 / Revocation-safe owner operations

中文：成员增删和角色调整、项目设置、死信重试、报告生成与发布都在数据库写入事务内重新检查**当前**项目及组织成员资格。角色在操作开始后被撤销也不能导致未获授权的业务提交；其他项目的权限或系统管理员身份不能越权访问本项目。此项修复权限竞态，尚不等于这些操作已经全部具有命令级重试回执。

English: Project membership edits, settings, dead-letter retries and report generation/publication recheck current project and organization membership inside the write transaction, with row locks against concurrent revocation. Being a system administrator does not bypass project authorization. This corrects the role-revocation race, but does not imply every legacy operation now has a command receipt.

### AI 模型请求的网络隔离 / Model outbound network safety

中文：系统总管理员配置的模型供应商可以是公网 HTTPS 服务，也可以是明确的本机或 Docker 宿主机地址。为了避免模型密钥或项目聊天被送往意外的内网服务，目录查询、连接测试和 AI 推理统一检查 DNS 的所有返回地址，并在连接时使用已经验证的 IP，不跟随重定向；私有与保留网络默认拒绝，只有指定的本地模型主机例外。此安全改进不代表生产网络防火墙、厂商兼容性或渗透测试已经通过。

English: System-administrator model connections may target public HTTPS providers or explicitly selected local/Docker-host models. Catalog discovery, connectivity checks and model inference now validate all DNS answers and pin the validated IP for the actual connection, refusing redirects and private/reserved networks by default except the designated local hostnames. This is defense in depth, not a claim that production egress firewalls, provider compatibility or penetration tests have been accepted.

### 周报月报的版本及审核 / Versioned reports and approval

中文：项目负责人生成周报/月报时可以根据最新登记的任务和风险刷新**尚未发布**的草稿，草稿每次刷新增加版本。审核发布必须针对负责人所看到的当前版本，发布后保存审核人、时间并冻结正文；同一次点击因网络原因重试不会重复发布。已经发布的同周期报告再次请求只返回发布版本。报告展示的是生成当时的项目状态，不代表已计算整个周期内的历史进度变化。

English: Project owners may regenerate an unpublished weekly or monthly draft using the latest registered tasks and risks; each refresh increments its revision. Publication requires the revision the owner reviewed, records its actor and time, and freezes the content. Retrying the same action is idempotent; requesting a published period returns its existing version. These reports reflect a point-in-time project snapshot, not a full historical account of all changes during the period.

### 死信事件人工恢复 / Manual dead-letter recovery

中文：项目负责人可以查看本项目 Outbox 待处理与死信数量，并对尚未处理的死信事件执行人工重新入队。操作使用单次请求 UUID 回执，网络超时后重试原请求不会第二次恢复，且普通成员无法操作其他项目的死信。重新入队不代表已经处理成功，后续执行仍遵守 Worker 的重试/冷却与 AI 人工批准约束。

English: Project owners can inspect their project's Outbox backlog and dead letters, and manually requeue an unprocessed dead-letter event. A durable UUID command receipt makes a network retry replay the same outcome without resetting the event again; ordinary members cannot perform this action or inspect other projects' dead-letter details. Requeueing is not proof of successful downstream processing and does not bypass Worker retry policies or human AI-approval requirements.
