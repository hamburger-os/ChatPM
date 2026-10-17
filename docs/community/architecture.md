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

### 安全、幂等地新建项目 / Safe idempotent project creation

中文：组织管理员可新建项目；项目名称与时区经验证，同一次按钮点击在网络超时后重试会沿用原 UUID，而不是额外新建项目。后台先在租户范围保留命令回执，随后原子保存项目及唯一项目负责人，并记录审计、正式领域事件和 Outbox 通知。非该组织的管理员或仅有普通组织成员权限的人员不能新建该组织项目。项目创建时 AI 默认关闭，模型供应商与密钥仍由系统管理员维护。

English: A tenant administrator can create a project with validated name and time zone. Retrying an interrupted request with its original UUID returns the same project rather than creating a duplicate. A tenant-scoped receipt reserves the intent before a project ID exists; the project, unique owner, audit, formal domain event and outbox are saved atomically. Non-admin tenant members and unrelated users cannot create projects in the tenant. AI starts disabled; global model providers and secrets remain system-administrator-only.

### 数据库恢复演练 / Database restore rehearsal

中文：除了生成备份，Docker 集成测试还会停止 Web、API 和 Worker，在独立、随机命名的 PostgreSQL 测试数据库中实际恢复备份，并逐表检查数据条数和内容指纹是否与源数据库完全一致；不覆盖原数据库。出错即阻止合并。备份只在私有临时目录存放，演练结束删除测试库和归档。该测试不替代企业生产环境的离机加密、PITR、灾难恢复与 Windows/Linux 实机演练。

English: The Docker integration workflow stops application writers and restores a real PostgreSQL backup into a fresh, randomly named, isolated database. It compares all public table row counts and deterministic content fingerprints with the unchanged source. Mismatches fail CI; the private backup and isolated database are cleaned up. This verifies a small CI dataset, not off-site encrypted retention, point-in-time recovery, a production RTO, or real Windows/Linux disaster recovery.

### ADR-065 · 当前事务与领域边界改进 / Transaction and domain boundaries

中文：成员聊天写入现在在同一数据库事务中重新验证并锁住当前组织和项目权限，原子保存消息、Outbox 与最小审计；相同操作重试不会重复发送。AI 候选被人工批准后，正式任务/风险创建复用对应核心领域的唯一 SQL 写入路径。项目治理登记簿使用一致性数据库快照读取；组织工作台复用公共 HTTP 请求工具。此变更不是实时 SSE、完整 AI PM、企业模型认证或生产验收。

English: Chat submission now locks and revalidates current organization and project membership within the same transaction that commits the message, outbox event and minimal audit. Replays do not republish. Human-approved Task/Risk proposals use their respective Core domain insertion paths. Formal PM registers are fetched from a consistent transaction snapshot, and the organization UI reuses the shared HTTP request helper. Live SSE, a complete AI PM, enterprise model certification and production acceptance are not delivered by this change.

### ADR-066 · 平台管理员模型写入锁 / Platform model administration lock

中文：系统管理员修改模型连接、密钥和模型目录时，服务端会在真正写入数据库的事务内再次验证并锁定当前系统管理员资格，避免已被撤权的账号凭旧请求继续保存配置。模型测试的配额登记也受保护；对已经开始的外部模型调用，本措施不提供网络取消保证。组织权限与项目聊天权限仍彼此独立。

English: Model/provider changes and model-test rate-limit reservations now recheck the current platform-administrator grant under a database row lock in the same transaction as the write. A revoked account cannot use a stale request to save configuration. This does not cancel an external inference request that has already started. Platform administration and project conversation access remain separate.


### 人工审核与正式事项

AI 进度建议、候选任务和候选风险都需要具备项目授权的人审核。审核的唯一正式写入入口是 `packages/core/src/approval/decision-commands.ts`，Fastify 路由负责参数和身份入口；采纳后的 Task/Risk 创建仍归各自 Core 服务负责。幂等回执、事件、审计与 Outbox 与审核结果处于同一 PostgreSQL 事务。详见 `docs/design/implementation-status.md` ADR-068；这不等于所有 PM 领域已完成模块化。

### 任务归档与恢复 / Task archive and restore

中文：正式任务可以由项目负责人或项目管理者在「已完成」或「已取消」且没有待审核进度时归档，归档后从当前任务列表中移除但仍可在已归档任务中查看和恢复；历史变更、AI 来源、任务依赖及已发布报告都保留。归档会停止提醒，且不能在恢复前继续编辑任务或确认其进度。普通成员和观察者不能执行归档/恢复。归档是可逆业务状态，不是不可恢复的数据删除。

English: Project owners and managers may archive completed or cancelled tasks after all pending progress reviews are resolved. Archived tasks leave the active list but remain visible in a dedicated archive view and may be restored without changing their prior status. Source proposals, dependencies, immutable task history and published reports are preserved; reminders and new updates are blocked until restoration. Members and observers cannot archive or restore. Archiving is reversible and is not permanent deletion.

### Outbox 长任务续租与旧 Worker 隔离 / Long-running Outbox lease renewal

中文：后台 AI 事件使用 PostgreSQL 中同一条 Outbox 记录作为唯一领取状态。处理时间较长时，Worker 定期续租，但只能延长尚未过期、尚未完成、属于自己令牌的领取。过期或被其他 Worker 接管的旧处理进程不能标记完成、修改重试状态或发布旧 AI 结果。真实写入仍由同事务行锁校验，提醒和报告仍有独立运行通道。当前自动化测试覆盖租约和数据库并发边界，尚不能代替公网模型、真实掉电、多 Worker 峰值压测或主动报警验收。

English: AI events keep their sole delivery claim in PostgreSQL Outbox. During slow processing, a worker renews only its own still-valid, incomplete claim. An expired or replaced worker cannot acknowledge, reschedule, or publish stale AI output. Every formal publication still checks the current token under a transaction row lock; reminders and reports run in independent lanes. Automated database checks cover lease and fencing behavior, not production network faults, external model latency, power loss, scale tests or active alert delivery.

### Outbox 运维查询与恢复 / Outbox diagnostics and recovery

中文：项目 Outbox 错误统计、死信列表和人工恢复仍只允许当前项目负责人使用。系统在同一数据库事务中重新检查并锁住组织、项目成员资格，再读取对应项目的诊断数据；失去权限的请求不能凭早先的角色查询结果继续读取。恢复仍有持久幂等回执和版本，不会改写健康任务。此功能不表示外部主动告警或正式生产恢复已经验收。

English: Project Outbox diagnostics and manual dead-letter recovery remain restricted to the current project owner. The server locks and checks the current organization and project membership in the same database transaction used to read the diagnostics, so stale authorization cannot be reused after revocation. Recovery retains durable idempotency receipts and revisions and cannot reset healthy work. External alerts and production disaster recovery remain unverified.

### 报告读取与发布权限 / Scoped reporting and publication

中文：ChatPM 项目周报与月报继续以 PostgreSQL 的正式项目事实为唯一来源。项目成员可以阅读自己有访问权的报告；只有当前项目负责人可以手动生成和发布。读取、权限检查在同一数据库事务内完成，原项目负责人被组织或项目撤权后不能凭旧会话查询新数据。发布严格检查修订版本；已发布的正文保留，网络超时重试使用原命令回执防止重复正式变更。此次没有改变报告接口，也不表示 PDF 导出、大规模分页或企业生产验收完成。

English: Project weekly and monthly reports continue to use authoritative PostgreSQL project facts. Current project members can read their own project's reports; only the current project owner can manually generate and publish them. Authorization and retrieval share one database transaction, so revoked membership cannot authorize a later read. Publication enforces the report revision, protects published content and uses durable command receipts for idempotent retries. This does not add PDF export, large-scale pagination or production certification.
 
### 实时项目消息与历史翻页 / Live project messages and history

中文：项目聊天现在提供基于已持久化消息序号的 SSE 实时接收。网页断线后会使用 Last-Event-ID 或当前游标从数据库补拉，避免仅靠内存通知而漏消息；在弱网络情况下还有低频 REST 对账。切换项目、退出登录、撤销项目/组织成员资格时不再持续推送消息。页面后台关闭事件流，回到前台重新连接；成员可加载更早聊天记录。Next.js 同源代理会直接转发流，不再缓存整段 SSE 响应。当前后端仍需对每条在线流定期查库，不等于大型多租户推送平台。真实 iOS/Android、共享 NAT、复杂代理超时和公网部署尚未验收。

English: Project chat now supports SSE updates using committed PostgreSQL message sequence IDs. On reconnect, the browser resumes from Last-Event-ID or its current cursor and periodically reconciles with durable REST messages, rather than trusting ephemeral notifications. Project switches, logout and tenant/project membership revocation stop delivery; background tabs close the stream and reconnect when visible. Authorized members can load earlier chat history, and the same-origin Next.js proxy forwards the SSE body without buffering. The server still polls its database per open stream; real mobile browsers, large shared gateways, production reverse proxies and public-network behavior remain to be verified.

### 当前授权的项目只读视图 / Current-authorized project reads

中文：项目详情、进度与候选列表在同一 PostgreSQL 事务中核验当前组织和项目成员身份并读取数据。只有项目负责人可以读取 AI 授权状态、模型调用审计和分析记录，普通成员与观察者不能通过直接请求 API 绕开角色权限。现有接口和返回字段保持不变，撤权后的新查询不能继续使用旧权限结果。这不表示全部 API 已完成模块拆分，也不代替真实生产部署和安全验收。

English: Project details, progress and proposal lists now check current tenant and project membership within the same PostgreSQL transaction that reads the data. Only a project owner can read AI authorization, model invocation audits and analysis runs; members and observers cannot bypass that role by calling the API directly. Existing endpoints and response fields are unchanged, and reads after revocation cannot reuse stale permissions. Other API boundaries and real production security acceptance remain unfinished.

### 项目导航与 PM 历史读取 / Project navigation and PM history reads

中文：项目列表现在只显示当前同时具有组织和项目成员资格的项目，查询由 Project Core 统一维护。项目治理中的问题状态变更历史、变更实施历史、任务依赖和正式登记簿都在同一事务内校验当前成员资格并读取数据，撤权后的新请求不能使用旧鉴权结果。历史仍按每页 50 条和既有版本游标返回，观察者可只读，跨项目记录不展示。原有 API 与业务数据不变；这不代表全部 PM 写入命令或生产环境已经验收。

English: The project navigation lists only projects where the user currently belongs to both the tenant and project; Project Core owns this visibility query. Issue transition history, change implementation history, task dependencies, and formal PM registers recheck current membership within the same database transaction used to retrieve their contents. New requests after revocation cannot rely on an earlier permission check. History retains its existing 50-record pages and version cursors; observers retain read-only access and cross-project records remain inaccessible. Existing APIs and project facts are unchanged; all PM write commands and production deployment still require separate acceptance.

### 正式 PM 命令归属 / Core-owned formal PM commands

中文：正式项目治理中的目标、里程碑、交付物、问题、决策、变更申请与任务依赖，以及交付物改派、提交和独立验收、问题状态变化和重大变更的审批/实施，现由同一个 Core 业务层负责。网页调用的地址和返回结构保持不变；服务器继续即时检查当前人员权限、版本与责任分离，并在同一数据库事务内记录业务更改、审计、事件和幂等回执。AI 只提供候选与证据，不能自行确认成果。企业身份、全部其他模块重构和实际生产环境仍需独立验收。

English: Formal project management creation (goals, milestones, deliverables, issues, decisions, change requests and task dependencies) and the deliverable, issue and change lifecycles are now owned by Core command services. Existing HTTP endpoints and response shapes remain unchanged. Current membership, role grants, version checks and separation of duties still govern every write; business changes, audits, domain events and idempotency receipts commit together. AI findings remain proposals and evidence rather than automatic acceptance. Enterprise identity, the remaining modules and real production acceptance are separate work.

### 项目治理与人员责任 / Project governance and member obligations

中文：成员列表、人员加入、角色升降、移除、负责人移交和项目设置现在都由 Identity Core 统一处理，而不是在 HTTP 路由重复定义业务规则。成员名单和当前权限在同一个数据库事务中核验；项目负责人将成员降级为观察者或移除前，系统会统一检查未完成任务、待验收交付物、有效资源安排、未关闭风险和正在实施的变更。正式变更仍产生同事务审计、领域事件和幂等回执；负责人移交保留版本与责任分离。其它组织治理、生产设备和负责人字段的进一步单源化仍需独立验收。

English: Project membership reads, invitations, role changes, removal, ownership transfer, and project settings now use a single Identity Core service rather than duplicating business SQL in HTTP routes. Membership visibility and current authorization are checked within the same database transaction. Demoting a member to observer or removing them applies the same guard for unfinished tasks, unaccepted deliverables, active resource allocations, unresolved risks, and implementing changes. Changes remain auditable, versioned and idempotent. Other organization governance, production devices and elimination of the remaining stored owner-field duplication are separate acceptance tasks.

中文补充：被降级为观察者后，不仅不能继续承担未完成工作，也不能从组织资源安排入口重新获得新的执行容量；当前组织和项目成员及角色会在数据库事务中再次校验。

English addendum: An observer may not receive a new active resource allocation through the organization capacity planner. Both current tenant/project membership and the non-observer role are rechecked under database locks; historical cancelled allocations remain available for audit.

### 单一项目负责人事实 / One authoritative project owner

中文：项目负责人不再在项目表和成员表中各存一份。唯一身份来自项目成员列表中的 `owner` 角色；`ownership_revision` 只负责并发变更版本。创建项目和负责人移交必须在一笔数据库事务中完成，数据库在提交时验证**恰好一位**负责人。项目详情仍可以显示负责人 ID，但它直接来自唯一成员记录。升级时旧数据若存在负责人不一致，将拒绝迁移而非自动指定新 Owner；正式实例必须先备份并核对。此变更不代表企业实机部署和历史迁移验收已经完成。

English: A project owner is now recorded **only** by the single project member with role `owner`. The independent `ownership_revision` protects concurrent transfers. PostgreSQL checks **exactly one** owner at commit, allowing atomic project creation and transfer without an intermediate committed gap. Project detail responses derive the owner ID from current membership rather than storing a second field. A migration on inconsistent legacy owners fails closed, requiring audited data reconciliation and a backup before retrying; this is not proof of production upgrade acceptance.

### 组织治理统一服务 / Core-owned organization governance

中文：部门、项目集、项目组合、人员管理和跨项目资源安排现在通过统一的 Core 正式命令执行。后台会在同一数据库事务中检查当前组织管理员权限、保持幂等回执与审计，并在成员角色变更时保护最后一名管理员。组织成员名单和资源分配数据只允许当前管理员查询，并在数据库快照中确认权限后读取；不能因页面曾经有权限而在撤权后继续取得数据。资源分配仍须符合项目成员身份和容量约束；这不代表完整 PMP 项目集收益或生产环境验收已完成。

English: Departments, programs, portfolios, tenant members, department assignments and cross-project capacity changes are now performed by Core-owned tenant commands with current administrative authorization, idempotent receipts and audit in the same database transaction. Tenant member and allocation reads share a repeatable-read snapshot with the current administrator row lock. Demotion cannot remove the last administrator, and a previously completed role-change receipt may be replayed only with the original key. Capacity and project membership constraints remain enforced independently. Full PMP benefits governance and production certification remain separate tasks.

### Worker 分通道可观测性 / Independent Worker lane health

中文：事件（含 AI/Outbox）、团队提醒、周期报告各自报告完成、成功和失败。诊断会分别判定三类通道是否失联、过期或最近失败，不能再因为提醒成功而把事件通道的持续失败显示为健康。诊断仍是受保护的运维命令，不将项目消息或密钥上报到公网；本项目提供 Linux 五分钟 timer 和 Windows LocalService 五分钟计划任务入口。操作系统日志/退出码不等于邮件或 IM 通知，生产管理员需额外接入可信监控与告警值班流程。

English: Events (including AI/Outbox), reminders and reports each report independent completion, success and failure telemetry. Doctor checks freshness and recent failures per lane, so a healthy reminder lane cannot hide a failed event lane. The private operational command reports structured fault codes and a non-zero exit status; Linux and Windows can schedule five-minute checks under least privilege. This is not an external pager, email or IM delivery guarantee, nor a substitute for a real multi-worker failure-recovery drill.

### 账户与租户的统一身份服务 / One Core owner for accounts

中文：新用户注册、登录、个人信息和所属组织列表现在都通过 Identity Core 服务执行。初次注册仍依据部署者配置的公开注册或安全 bootstrap 策略；用户、初始组织和管理员成员资格一起写入数据库，失败就整体回滚。登录不会向客户端返回密码哈希；组织成员被移除后，组织导航会立即更新，不允许再用以前的成员资格访问。HTTP 继续负责安全 Cookie、Origin/CSRF 和限速，不存储第二套身份记录。

English: Registration, sign-in, self-profile and tenant navigation are now owned by a single Identity Core service. First-account bootstrap still enforces the configured secure enrollment policy and atomically creates the account, first tenant and admin membership. Password hashes are never returned in login responses. Tenant navigation is based on current membership, so a revoked membership disappears immediately; Fastify retains cookie/session, Origin and rate-limit duties. This does not certify enterprise SSO/MFA or production anti-abuse readiness.

### Docker 宿主机模型地址严格绑定 / Pinned Docker host model gateway

中文：若把本地 AI 模型连接地址配置为 `http://host.docker.internal:<端口>`，必须由部署者在服务器的 `MODEL_DOCKER_GATEWAY_IPS` 中列出**实际验证过**的 Docker 宿主机网关 IP。解析结果的每个 A/AAAA IP 都要在精确名单里，不能仅因为它是局域网 IP 就放行。网关 IP 改变时请求会失败，直到部署者重新检查并更新配置。普通公网 HTTPS 模型无需该配置；此规则不在浏览器中存放模型密钥或网关 IP 权限。不得把 CI 通过视为现场网络攻击验收。

English: When a self-hosted model uses `http://host.docker.internal:<port>`, operators must explicitly pin verified gateway IPs in server-side `MODEL_DOCKER_GATEWAY_IPS`. Every DNS A/AAAA answer must exactly match the allowlist; an arbitrary private LAN address is not trusted. If the Docker gateway changes, requests fail closed until the operator revalidates it. Public HTTPS providers do not need this setting. CI validation alone does not certify live QNAP/Windows/IPv6 network isolation or production egress security.

### 组织邀请权限与邮箱隐私 / Invitation access and privacy

中文：邀请名单包含收件人的邮箱和状态，只有该组织**当前**管理员能查看。服务端会在同一数据库事务内校验并锁定管理员成员关系、读取邀请记录；已被撤权的管理员不能利用请求时间差继续查看名单。成员名单、资源配置及邀请名单使用同一授权事实源，不保存第二套角色缓存。邀请码仅在签发时返回一次，邀请列表不展示可恢复的邀请码或摘要。正式公网部署仍需额外对邀请、滥用和邮箱泄露进行安全审查。

English: Invitation metadata contains sensitive recipient email addresses. The server verifies and locks the **current** tenant administrator membership in the same database transaction as the list query, preventing read-after-revocation through a stale HTTP precheck. Tenant membership and resource administration reuse that same authorization boundary. Lists never expose invitation bearer codes or token digests. Production invitation abuse, public-network and mail-delivery tests remain separate acceptance gates.

### 系统模型管理员单一授权边界 / Platform model administration

中文：只有当前系统总管理员能够查看模型供应商、模型设置、取得模型目录连接凭据或执行测试。这些查询在同一数据库事务内锁定管理员权限，不再依赖 HTTP 之前做过的权限检查。模型测试会在授权事务内取得设置并记录调用冷却，但真正的外部模型网络请求只在事务结束后发起，避免占住数据库连接。供应商列表只展示是否有密钥，不暴露明文 API Key；项目成员不能自行修改系统模型配置。

English: Platform AI provider/model metadata and catalog credentials are read only while a live system-admin grant is checked and locked in one Core transaction. Model test settings and cooldown are committed together, then external model HTTP happens **after** the transaction closes. Lists return public metadata and key-presence flags, never provider secrets. This does not by itself certify live WAN egress, API-key rotation, vendor billing or production deployment.

### 模型供应商与模型管理正式命令 / Core-owned AI model administration

中文：系统总管理员可以维护 AI 供应商与模型、导入供应商列表及发起模型连通性测试。所有正式操作现在由 Identity Core 的同一管理命令服务处理，先校验当前管理员身份、再验证请求和执行数据库事务，并同步记录不可遗漏的系统审计。后端仅存储加密 API Key，页面不会返回密钥；模型测试受 30 秒冷却保护，真正网络请求在事务外执行。普通项目成员只使用管理员配置且获项目授权的模型，不自行设置供应商。

English: Platform provider/model create, edit, delete, import and connection-test preparation are owned by one Core command service. Current system-admin authorization, strict DTO validation, mutations, the existing audit trail and model-test cooldown share a database transaction. Secrets are encrypted and never returned in public management DTOs; external provider HTTP runs after the transaction commits. Full enterprise authentication, vendor billing and production egress certification remain separate validation tasks.

### Outbox 租约感知的故障诊断 / Lease-aware Outbox diagnostics

中文：AI 任务在合法续租且仍处理中时，不会仅因消息早于十分钟就被误报为“排队逾期”。新的运维诊断分别展示**超过十分钟仍未开始执行**的队列、**超时未续期**的 Worker claim、**已到期重试等待队列**和死信，阈值维护在同一个私有 Doctor 模块中。预约到明天执行的 AI 预算延期不会被计为立即积压。诊断仍为只读，不接触消息正文或模型密钥；系统计划任务的非零退出需要管理员连接受信任的值班通知系统。

English: Doctor now separates waiting overdue queue items from **active, renewed** AI/Outbox leases. It reports independently stale claims, retry-ready backlog pressure, ready work and dead letters; intentionally deferred work is not treated as overdue. A diagnostic is read-only and never mutates the Outbox or publishes AI output. Alert delivery, rate/SLA measurement and true outage drills still need production validation.
