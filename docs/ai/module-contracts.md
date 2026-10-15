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
| Integrations | ConfiguredLLMProvider、Responses/Chat Completions HTTP 适配 | 更多协议实测、UI 模型设置、通知与对象存储 |
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
- `ApproveProposal`：Owner / Manager 可按 proposal.approve 确认/拒绝；创建正式记录并审计，候选不可被重复确认。
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

`LLMProvider` 是业务抽象，由 `ConfiguredLLMProvider` 实现，两个协议适配分别使用 Responses JSON Schema 与 Chat Completions JSON Object；真实本地/多厂商 API 仍待联调。观察、正式业务变更、通知与外部工具必须经过确定性服务端权限边界。其他目标适配器和领域概念按实际用例渐进实施，不创建没有实现者的空抽象。

## 验收要求

所有业务变更需带有对应设计说明和自动化回归。重点覆盖跨租户、跨项目数据、会话撤销、失效成员、任务乐观锁、模型超额、消息乱序、未知事件、租约过期、重复发送、工作窗口、草稿不可覆盖和多 Worker 并发。真实外部模型质量、隐私、生产部署和备份恢复仍需独立验收。

## 任务指派与成员撤销的串行化

对 `project_members` 的授权指派检查必须持有 `FOR KEY SHARE`，且在创建或更新任务的同一事务中执行。删除成员时先 `FOR UPDATE` 锁住成员关系，再检查该成员是否承担未完成任务；存在时返回 409 并要求人工重新指派。不能先移除成员再让 Worker 继续催办失效负责人。

- 任务状态更新同事务内再核验操作成员，不能依赖事务外的历史授权；从完成态重新开启并保留既有负责人时，必须验证负责人当前仍属于项目，否则拒绝并要求重新指派。

## Web 与 API 项目设置契约

Web 端从 `GET /projects` 初始化项目列表和设置面板。该接口返回 `work_start`、`work_end`、`cooldown_hours`，与 `GET /projects/:id` 一致；未配置策略时必须是 `null`，而不是省略。回归测试覆盖初始项目及设置保存后读取，避免前端向 `PATCH /projects/:id/settings` 提交缺失字段。

## 部署入口契约

- `packages/core/src/config.ts` 校验 Node 服务运行配置；`db.ts` 从统一配置创建连接池。
- `tsconfig.server.json` 构建 API、Worker、核心领域及 SQL 迁移，生成 `dist/apps/api/src/server.js`、`dist/apps/worker/src/worker.js`、`dist/packages/core/src/migrate.js`。
- `apps/web/app/api/[...path]/route.ts` 代理本源 `/api/*` 到配置的服务端 URL。浏览器不可访问内部地址配置。
- `infra/compose.prod.yml` 只公开 Web 回环端口；`infra/linux` 和 `infra/windows` 是原生部署入口；`tools/ops/backup.mjs` 是唯一原生/容器备份入口；`tools/ops/restore.mjs` 仅承担带显式停服确认的原生隔离恢复。


## 单命令运维入口

- `npm run dev` 通过 `tools/ops/run.mjs dev` 启动开发态 Web/API/Worker；`npm start` 运行已有的正式构建产物。二者保留独立进程，任何意外终止都反馈到统一终端并停止整组。
- `npm run setup:native` 串行执行依赖安装、正式构建、分发检查、数据库迁移；要求已有 PostgreSQL 与经校验的环境。
- `npm run deploy:docker` 使用 `tools/ops/deploy.mjs` 安全初始化本地 `.env` 并调用生产 Compose，确保它不会因重复部署轮换已有会话秘密或数据库密码。
- 开机自启不属于 CLI 前台入口职责：Linux systemd、Windows WinSW 或 Docker Engine + Compose 重启策略分别提供宿主机进程守护。

## 运维诊断与备份入口（ADR-018）

- `packages/core/sql/004_worker_health.sql`：单行默认 Worker 心跳；`apps/worker/src/worker.ts` 在 tick 结束记录最近存活/成功/失败。心跳不构成业务事件或自动任务完成证据。
- `npm run doctor`：读取数据库/schema、API `/health`、Worker 心跳与 Outbox 状态；非零退出以供监控器告警，不通过公网返回内部细节。Compose 内可在 API 容器执行相同 Node 脚本。
- `npm run backup` / `npm run backup:docker`：`pg_dump` custom-format，写新私有文件成功后保留 N 份；不执行数据库恢复与自动回滚。Linux `chatpm-backup.timer` / `chatpm-doctor.timer` 和 Windows `ChatPM-Backup` Task Scheduler 可触发运维任务。
- Windows WinSW 服务使用内置 LocalService（代替默认 LocalSystem）和最小运行期写权限。未经过安装环境 ACL/服务故障恢复实测前不可认为正式生产就绪。


## 首次本机引导、发行包及升级守卫

- `npm run setup:local` 调用无外部依赖的 `bootstrap-native.mjs` 创建缺失 `.env` 的随机 SESSION_SECRET，拒绝开发样例数据库密码及不安全公共源，然后调用 `setup:native`。绝不静默创建操作系统 PostgreSQL 用户或修改已有数据库密码。
- `npm run upgrade:native -- --confirm-services-stopped` 由操作者声明停止全部服务，要求 API 无法接受本机健康请求，先完成可验证文件备份才运行构建与迁移；此入口不能证明独立 Worker 已停止，仍须运维人员核验。
- GitHub Actions 可上传临时 Windows/Linux portable Artifacts；它们需要 Node/npm 和 PostgreSQL，在目标环境安装运行依赖，不代表已有签名安装包或更新/卸载器。


## /review 运行时补充

- `deploy.mjs` 固定 Compose 项目名并使用 `--env-file`，在替换任何占位秘密前先检查已有名为 `chatpm_postgres_data` 的数据卷；原密码遗失需人工恢复。
- `run.mjs` 将根环境变量交给 API、Worker 和 Next 子应用；Worker 接收 `{type:'chatpm:shutdown'}` IPC 消息，在完成 tick/关闭连接池后断开 IPC 退出。这是受限时间内的进程级排空，不是持久消息事务回滚。

## 平台级模型配置与传输（当前有效）
- 系统管理员维护 ai_provider_connections 与 ai_model_configs；项目负责人不持有、选择或测试独立项目供应商 Key，项目成员只使用管理员启用的默认模型。
- 传输适配仍支持 Responses 与 Chat Completions；服务器按管理员配置的协议、reasoningFormat 和限额调用，不以 DeepSeek/OpenAI 字样推断供应商能力。
- 凭据由 MODEL_ENCRYPTION_KEY 加密，永不回传浏览器；目录发现与匿名 quick/full 模型测试仅 system admin 授权。
- 项目通过 PATCH /projects/:id/settings 控制 aiEnabled；Worker 独立验证项目授权和当前默认模型，输出只能生成 Evidence / Proposal / 只读回复。完整 AI 授权版本化尚属 V2 目标。
- 此处不继续维护已废弃的项目级 LLM_* 模型设置操作流程；历史决策留在 docs/design/decision-log.md。

## 原生前台一键停止（ADR-020）

`npm start` 和 `npm run dev` 使用 `run.mjs` 同目录实例独占的回环控制服务；`npm run stop` 是一个不依赖 npm 已安装模块的 Node.js 内置工具，读取私有 `.chatpm-run.json` 中的端口/随机令牌，向当前受控管理器申请停止，等 Web、API、Worker 子进程退出才返回成功。Windows Worker 沿用现有 IPC 关闭。PID 仅用来确认状态是否陈旧，禁止按 PID 自动杀进程。Docker Compose / WinSW / systemd 使用各自停止命令，启动之前的旧版进程无法通过新控制协议停止。

## 项目上下文和运行记录（当前有效）
- 项目 Owner 显式打开 AI 后，模型仅能读取同项目的有界正式任务/风险和近期聊天，不支持跨项目检索。结构化输出接受 JSON Schema 与 Zod 双层约束；候选/进度审批始终是独立于任务完成状态的操作。
- 分析源消息、模型身份、错误码与阶段可通过有权限的项目接口查看；具体角色以服务器接口授权为准。当前 ai_analysis_runs 尚不是每次实际 ModelInvocation 的独立账本。
- @AI 只读问答不具备正式项目变更工具。自然澄清关联限唯一近期线程，歧义时需显式候选 ID。
- 系统模型由管理员集中维护；不允许再从项目端提交 server|openai|deepseek 品牌配置或独立项目 API Key。

## ADR-022 · 任务进度证据、日历期限及提前检查

- `tasks.due_date DATE` 为项目本地截止日，Web / API 使用 `dueDate: YYYY-MM-DD|null`，实际事件时间与计划检查仍用 UTC `TIMESTAMPTZ`。迁移 006 按当前项目 IANA 时区把旧 `due_at` 转成日期并删除旧列。候选内部仍存带时区时间戳，Owner 确认时映射为项目当地日历日期；不维持旧 `dueAt` JSON 接口。
- `task_progress_updates` 包含 `project_id/task_id/source_message_id` 复合外键、摘要、进度类型、模型与 Prompt 版本及审批状态；受控 Worker 只接受模型引用的**同项目活动任务 ID**，仅保存候选证据，不能自动改正式状态。 `GET /projects/:id/progress` 成员可查、`POST /projects/:id/progress/:progressId/decision` Owner 审批（已处理返回冲突并审计）。
- `analyzeWork` 区分 `items`（独立新任务/风险）与 `progress`（既有任务进度/阻塞/完成声明）；确定性同题重复项过滤只用于精确/规范化重合，不能用模糊相似度强行合并。未来任务依赖、里程碑、风险升级仍需独立领域建模。
- `syncFollowup` 在有效正式任务建立后计划首次检查，Worker 根据项目日期差、阻塞与冷却及工作时间安排下一次，长期任务默认间隔 7 天；临近到期/阻塞可更频繁。不是发送外部通知，不对无负责人/期限任务催办。
- 模型配置迁移 007 将输入字符预算提升至 250000、输出 Token 上限 131072，默认 32768 字符/8192 Token；DeepSeek 官方 Responses 走 provider-specific `reasoning.effort`，Chat Completions 走 `reasoning_effort`；模型/供应商实际最大能力不等于本应用的每次预算。


## ADR-024 · 导航与供应商连接工程契约

- 主 Web 页面维护 `projects | organization | system | account` 一级状态。项目工作面板 `WorkspaceDetails` **仅**负责项目详情；组织和系统配置不得通过项目右侧加载。
- 系统管理员仍由 `users.is_system_admin` 和 `requireSystemAdmin` 服务端校验，统一登录无独立管理员密码入口，术语为「系统管理员」。初始化授权通过本机 `npm run admin:grant`，不得提供公开提权 API。
- `ai_provider_connections` 管理连接地址、协议及密钥；`ai_model_configs` 管理模型、预算和默认选择，`provider_id` 不可为空。模型配置 API 不能修改供应商密钥，供应商 API 从不返回明文或密文。
- 受支持协议：Responses、Chat Completions；支持 OpenAI 风格的标准 GET /models 目录发现（非通用），不支持 Anthropic Messages 原生格式。管理员指定模型显示名称和请求 ID；推理参数使用显式 `reasoning_format`，不能以域名推断。非管理员请求必须 403。
- 009 迁移为既有模型配置搬迁密钥，并删除旧列。Worker 调用默认已启用模型与已启用提供商的组合；没有可用连接则拒绝模型调用。无自动向其他模型的隐式降级。
- 文档、单元、数据库、API、Worker、部署和前端构建必须共同验收；生产级网络 egress、DNS 防重绑定、实际供应商兼容性与本地 Windows 端 E2E 仍属于发布风险。


## ADR-026 · AI 模型目录与批量注册契约

- `POST /admin/ai/providers/:id/discover`：只允许系统管理员读取已持久化供应商，服务端使用解密的 Key 向其 Base URL 下的 `/models` 发起受限 GET；返回最多 500 条规范化的 ID、name、ownedBy、latencyMs、truncated。目录发现错误不泄漏上游响应体或 Key，允许完成后立即再次刷新，由上游自身控制限频。
- `POST /admin/ai/models/import`：只允许系统管理员，以 `{providerId,models:[{id,name?}]}` 输入 1–50 个模型，数据库事务插入，唯一约束保证同连接 ID 幂等。返回 created/skipped，新增项禁用，不能自动成为平台默认。
- `POST /admin/ai/models/:id/test`：允许尚未启用的连接/模型进行匿名 JSON 探测，不改变实际业务调用的启用条件。实际业务继续只使用已启用的默认模型和已启用的供应商，不能隐式切换目标。
- SSRF：目录 discovery 使用 DNS/IP 私网预检，禁止跟随重定向，流式响应限制 512 KB；管理员目标网络访问仍受生产出站防火墙控制，不能将解析预检当成连接级目标固定。
- Web：保存供应商后尝试目录发现，失败保留保存结果；浏览器不见 Key，不提交外部发现 URL；已注册 ID 不可重复勾选；高级设置与选择操作分别管理草稿；测试通过状态仅按本次会话展示，不宣称持久化验证。


## ADR-027 · 模型代理诊断契约

- 管理模型测试 `POST /admin/ai/models/:id/test` 先调用只读传输的 `probeModelText`，仅发送匿名简短问题且不附加 JSON 格式参数；若可生成可见文本，再执行既有 `callStructuredLLM` 的 `{ok:true}` 严格对象校验。
- HTTP 200 测试结果包括 `ok`、`textOk`、`structuredOk`、`latencyMs`、可选 `textLatencyMs`、以及失败时的 `errorCode`。允许 `textOk=true` 且 `structuredOk=false`，此状态不得赋予模型“已测试可用于 AI 抽取”的结论。身份仍只有系统管理员可访问，网络请求仍不带项目数据。
- Responses 提取优先读取 `output[].content[].type=output_text` 文本；仅对代理历史不标准的消息对象接受字符串 `content`，禁止使用 `reasoning` 输出作为最终答案。协议格式不匹配、推理独占输出与真正空响应为不同错误。响应不合规则仍必须失败。
- Base URL 按用户配置精确拼接，不猜测供应商品牌：例如若需要 /v1/models，管理员需保存以 /v1 结尾的前缀。错误提示可以建议该路径，但不会静默改写端点。


## ADR-028 · 目录刷新与快速测试接口契约

- `POST /admin/ai/providers/:id/discover`：管理员专属，完成前 UI 防重入，完成后允许立刻重复刷新；不再落库目录检查时间，DB 迁移 011 删除历史 `ai_provider_checks` 表。目录发现保留 HTTPS/回环地址限制、重定向拒绝、10 秒超时、512 KB 响应上限及上游 429 诊断，禁止自动高速轮询。
- `POST /admin/ai/models/:id/test` 请求体严格校验 `{mode:'quick'|'full'}`，缺省 quick。quick 仅执行结构化抽取探测；full 执行匿名文本与结构化测试各一次，两者均有实际推理费用。响应带 `mode`、`ok`、`textOk:boolean|null`、`structuredOk`、`latencyMs`、可选 `textLatencyMs` 和脱敏 `errorCode`。quick 未单独测试文本时 `textOk=null`，不得报文本测试通过；不能以 quick/完整模式选择影响业务推理适配器。
- 模型测试仍保持管理员授权和每模型 30 秒数据库限频；只有结构化返回符合 `{ok:true}` 才把本会话模型标注为测试通过。成功后未自动启用或设为平台默认。
- Web 目录刷新失败仍呈现旧候选项并保留选择；成功时保留与新目录仍匹配的选择，防止管理员重新选择大量模型。禁止在请求执行时重入。

## V2 目标契约与已实现组织切片

[完整目标命令/事件](../design/command-event-contracts.md) 与 [V2 架构](../design/v2-architecture.md) 定义未来统一边界；目前不是全部具备 CommandReceipt、DomainEvent、ModelInvocation 的实现。组织领域已经使用 organizationCommand 将管理员授权重检、数据库改动和组织审计绑定为单事务。后续逐模块迁移正式写入时不得将未经运行的能力标注为交付。

**权限说明：** 当前正式实现允许 owner 与 manager 审核候选（proposal.approve），成员管理、报告发布及项目 AI 设置仅 owner 有权操作。系统管理员独享模型凭据配置。以 permissions.ts 和实际服务端路由为准。

## ADR-030 当前可执行入口

- `packages/core/sql/012_pm_domain.sql` 新增正式 PM 目标/里程碑/交付物/问题/决策/变更申请/依赖及项目级命令回执与领域事件。
- `packages/core/src/pm-command.ts` 是新增 PM API 专属的 Command Executor；调用者只传入经过校验的 payload，命令在当前事务内校验 project_members 和 tenant_members，保持审计/事件/Outbox/回执同提交。
- `apps/api/src/pm-routes.ts` 的 `GET /projects/:projectId/pm` 读取登记簿，`POST /projects/:projectId/pm/:kind` 创建正式目标/里程碑/交付物/问题/决策/变更申请（kind 白名单）；独立状态接口处理交付物 submit/review、变更审批及任务依赖。新 POST 请求必须传 UUID idempotencyKey，状态变更还必须传 expectedVersion。
- `apps/worker/src/worker.ts` 消费 domain.changed 时校验它确实引用了同项目 domain_events，不发消息、不调用模型、不得改变业务状态；未知类型仍失败重试。
- `tools/test/smoke.mjs` 和权限单元回归覆盖跨项目、重复请求、审批和依赖环。项目管理专门 UI 与统一旧 Task API 命令化是后续内容，不可声称已经交付。

## ADR-031 · 项目治理工作台 UI 契约

`WorkspaceDetails` 增加 `governance` 页签，仅在当前项目范围挂载 `PmRegisterPanel`；子组件 GET /projects/:id/pm 与 GET /projects/:id/pm/dependencies，POST /projects/:id/pm/:kind / deliverables submit/review / changes decide / dependencies。单次用户提交生成 UUID idempotencyKey，状态更新传 expectedVersion。不要跨项目复用旧登记簿状态；项目角色仅用于 UI 按钮可见性，后端仍强制鉴权。新 UI 使用现有同源客户端 request/json 和公共样式，不传 AI Key，不赋予 AI 直接修改正式记录权限。

## ADR-032 · AI 撤权与模型账本契约

新增迁移 `013_ai_authorization_ledger.sql` 维持 projects.ai_enabled 单一事实来源；数据库触发器在切换时增量更新 ai_authorization_version。受控 `ConfiguredLLMProvider.request` 在预留额度后、出站之前重新核验开启状态与版本；关闭或版本变化时必须安全失败，不能调用上游。已实际发出的尝试保存脱敏 ModelInvocation，外部模型请求失败、Zod 格式失败均记录，重试独立记录；不保存消息原文、密钥或上游原始错误；无真实 Usage 时 token 字段为 null。项目 Owner 可读取摘要 API，普通成员/系统管理员无权仅凭平台身份读取跨项目调用记录。完整 capability grant 与 Playbook 执行仍为目标设计。

## ADR-033 · Worker 模块边界当前实施契约

AI 事件、规则提醒与周期报告 Runner 的应用入口分别归 `packages/core/src/conversation/ai-event-runner.ts`、`packages/core/src/automation/reminder-runner.ts`、`packages/core/src/reporting/period-runner.ts` 所有。Worker 进程只触发 `processEvents()`、`processReminders()` 与 `processReports()`，并负责调度、健康心跳和优雅关闭。事务原子性、UTC/项目时区、冷却、报告周期键和消息 nonce 不能改变；不以拆文件声称已有全域应用命令接口。继续用既有集成/Smoke/跨平台构建验收。

## ADR-034 · Bootstrap / Operations Boundary

`apps/worker/src/worker.ts` 仅管理进程生命周期、定时 tick 和业务 Runner 调度。`recordWorkerHeartbeat` 由 `packages/core/src/operations/worker-heartbeat.ts` 实现，保存工作进程健康遥测而非领域事实。CI 的 `tools/test/architecture-boundaries.test.mjs` 保证该入口不含 SQL、仍分别调用 processEvents/processReminders/processReports；不可借本规则宣称整个 API/Worker 已完全领域解耦。

## ADR-035 · 黄金评测契约

`activity schema`、`buildActivityPrompt` 必须与 `ConfiguredLLMProvider.analyzeWork` 实际生产请求同源，不允许评测用的是另一个更容易的 Prompt；可执行 evaluator 的 input 标记 schemaVersion/promptVersion、caseId、coverage 和 expectedKinds，评分绝不执行领域写入。CI 的 `npm run test:ai-evals` 仅校验 Fixtures 与 Scorer/安全反例；真实效果必须通过显式 `PM_EVAL_LIVE=1 npm run eval:pm:live` 生成匿名化汇总。未覆盖的关键领域能力要在评测结果中标识为 unsupported，不得计入 passed。

## ADR-036 · Issue 状态流转契约

新迁移 `014_issue_transitions.sql` 为既有 `project_issues` 添加不可覆写的状态流转历史。正式 API：`POST /projects/:projectId/pm/issues/:itemId/transition` 输入 `{idempotencyKey,expectedVersion,decision:'resolve'|'reopen',note}`；`GET /projects/:projectId/pm/issues/:itemId/history` 查询同项目历史。仅 owner/manager 可在服务端执行状态更改；只读查询仍严格校验项目和组织成员。执行使用 `executePmCommand`，历史表与业务更新和审计/Outbox 同事务。不得以 AI 对话中的“解决了”自动改变 Issue 状态。

## ADR-037 · 任务完成条件与项目授权入口

`packages/core/src/identity/project-access.ts` 实现 `lockProjectAccess(db,projectId,actorId)`，为正式 PM Command 与旧任务写入返回当前 tenant/role（`FOR SHARE OF pm,tm`）；所有正式权限判定在**同一业务事务中**执行。任务负责人被指派前也验证仍是项目及组织有效成员。新增依赖、任务提交为 done 都在同一 `pm-dependencies:${projectId}` 项目级顾问锁内校验顺序与完成条件。不可用已缓存页面中的 manager/member 角色作为可写权限。现有旧 Task 路由未统一到完整 CommandReceipt，不得宣称全域迁移。

## ADR-038 · EvidenceSource / ProjectClaim 当前代码边界

`015_evidence_claims.sql` 建立 `project_evidence_spans` 和 `project_claims`，均由项目复合 FK 约束。正式服务在事务内验证源消息 `kind='user'`、项目 ID、原作者与 code-point 范围（0-based start inclusive/end exclusive），由服务端截取 quote 并保存；来源消息文本视作不可信数据，不授予任何命令能力。允许 owner/manager 录入其他人来源的待核实主张，普通成员仅可为自己的消息创建；只允许原作者确认措辞与分类，经理可驳回。 `source_acknowledged` 不等同于任务 done、交付物 accepted 或 ChangeRequest approved。统一 CommandReceipt/DomainEvent/Outbox/Audit，服务端必须每次写入重新验证项目与组织成员身份；AI 仅可在未来生成另需审核的 pending 主张。

## ADR-039 · Delivery Task API 命令统一

当前正式 Task create/update 路由通过 `apps/api/src/task-routes.ts` 注册，内部调用 `packages/core/src/pm-command.ts` 的 `executePmCommand`，由核心业务服务在同一数据库事务内执行写入、提醒计划、审计/事件/Outbox/幂等回执。所有直接任务写入请求强制 UUID `idempotencyKey`，Task 修改仍要求 `version`。重复同键/同 payload 应返回同一正式 Task 和版本，冲突 payload 必须 409。前端持久化当前待提交意图的 key，避免网络失败重试重复创建。项目成员撤权/任务负责人效力与前置依赖/状态提交约束不变。注意候选审批生成正式任务、Worker 系统维护等其他路径尚未全部迁入 Command Runtime。

## ADR-040 · AI 候选审核正式命令边界

通过 `apps/api/src/approval-routes.ts` 暴露已有 `/projects/:id/proposals/:proposalId/decision` 和 `/projects/:id/progress/:progressId/decision`，所有 POST 必填 `idempotencyKey`。只有当前组织与项目中具有 `proposal.approve` 能力的 owner/manager 能执行；worker/LLM 不可直接审批。命令调用正式 `executePmCommand`：以候选 UUID 作为 aggregateId、一次性状态变更 aggregateVersion=1、项目聚合锁/约束有效。采纳正式 Task/Risk 与其 Proposal Receipt 归同一事务，审计中记录被创建的目标 ID；取消或者驳回不生成正式 Task/Risk。进度采纳不代表任务验收，保留 blocker followup 冷却条件。相同 key 原样重放不新增 DomainEvent/Outbox，不同 key 第二次操作返回 409。

## ADR-041 · 旧 Owner-only 路由的事务授权边界

apps/api/src/server.ts 中成员增删及权限调整、AI/提醒设置、Outbox 重试、人工报告生成/发布复用 identity/project-access.ts 的 lockProjectAccess(db,projectId,actorId)，在修改状态的业务事务内检查**当前** tenant/project 成员身份及对应的 ProjectAction。不得在事务外只读取旧角色并在后续事务提交写入。本次仅统一权限边界，不假装这些接口已经统一拥有幂等 Receipt 或领域事件。

## ADR-042 · 所有模型调用经安全出口

`model-egress.ts` 对系统配置的 Base URL 进行相同的公网 IP/私网拒绝策略，实际 HTTP(S) socket 使用解析后固定地址而非重新 DNS 查询；目录导入 `model-catalog.ts`、`llm-transport.ts` 的 probe/structured、`ConfiguredLLMProvider` 及 live eval 都必须复用默认安全网络发送函数。该路径不接受聊天、候选任务或模型生成文本提供的新 URL；保留显式本地模型例外。响应限制、禁止重定向与脱敏失败码适用于整个入口。依赖注入的 fake fetch 仅用于无真实网络的单元测试；不要用假模拟声称生产 DNS 重绑定已实战验证。

## ADR-043 · 报告正式命令与 AI 事实边界

用户人工周/月报生成 `POST /projects/:id/reports` 要求 `{idempotencyKey,kind}`，发布 `POST /projects/:id/reports/:reportId/publish` 要求 `{idempotencyKey,expectedRevision}`；当前 tenant/project owner 身份由 `executePmCommand` 的 `report.manage` 权限在事务中验证，重试返回已完成命令回执。Report revision 表示草稿实际更新和发布的状态版本，发布使用乐观版本校验。已发布 Report 永不因新生成或 AI 建议被覆盖；内容仍是当前项目数据库统计快照，不能宣称周内每次变化均有来源或 AI 编写的事实已经人工确认。

## ADR-044 · Project Governance 与 AI 项目开关

项目人员 `POST /projects/:id/members`、`PATCH/DELETE /projects/:id/members/:memberId` 与设置 `PATCH /projects/:id/settings` 都要求 UUID `idempotencyKey`，通过 `executePmCommand` 以当前 tenant/project 的 owner 权限执行；其他角色即使是全局模型管理员也不能越权管理项目。设置 PATCH 同时要求 `expectedRevision`，基于 `projects.settings_revision` 严格乐观检查；与 `projects.ai_authorization_version` 的外发授权变更触发器独立运行。AI 不能从聊天自启模型、修改默认供应商或绕过人工审批。人员写入必须检查目标有效 tenant 身份、行锁、角色与未完成任务；命令的 receipt/event/audit 必须与业务更改同事务。

## ADR-045 · 出站异步事件死信人工恢复命令

`apps/api/src/operations-routes.ts` 暴露项目 owner 读取 Outbox 汇总/死信以及 `POST /projects/:id/outbox/:eventId/retry`，后者请求体必含 UUID `idempotencyKey`。API 通过 `executePmCommand` 对当前组织和项目 `operations.manage` 服务端鉴权，在单事务内恢复原事件、写 Audit/DomainEvent/Outbox/CommandReceipt。命令重放只返回原成功结果，不会重置正在运行的 Worker claim；不同幂等键二次恢复 409。被重新入队是 pending，不等于处理成功或 AI 可以批准候选；历史错误正文不可泄漏给其他角色。

**ADR-045 版本化补充：** 响应 `{ok:true,recoveryRevision}` 是同一原 Outbox 事件历次人工恢复的单调序号，不是 Worker 尝试次数；`domain_events.aggregate_version` 必须等于 `outbox_events.manual_retry_revision`。原命令同 key 重放不改变该值；后续真实重新变 dead 后可产生下一版本的独立恢复事件。

## ADR-046 · AI 风险建议与正式风险应对的边界

AI 可以在项目对话中提供有来源的 `risk` 候选；它不能直接创建已经评估/正在应对/已解决的正式 Risk。审核候选后产生 open 风险，likelihood/impact/ownerId/responsePlan 仍需人类项目 owner/manager 评估；他们通过幂等项目命令携带 expectedVersion 正式修改，状态必须 open→mitigating→resolved 或 resolved→open（重新开展评估），每次附人类说明并写不可变历史。完成任务、AI 猜测或聊天表态都不能自动变成风险关闭证据。提醒与报表需要将 mitigating 仍视为未解决风险，避免模型建议造成虚假绿色报告。

## ADR-047 · 项目负责人移交不属于模型自治权限

owner 转移仅能由当前 owner 主动触发 POST /projects/:id/ownership-transfer，须提交 UUID idempotencyKey、当前 ownership_revision 的 expectedRevision，并指定有效租户/项目成员为目标，旧 owner 原子地降为 manager。原 owner 可在仍有项目成员权限时重放原始命令，但不能以新 key 再转移。AI、普通项目成员和纯系统总管理员身份不能代签负责人转让，也不会修改全局供应商、模型密钥或自动批准任务。

## ADR-048 · 租户项目创建与 AI 管理边界

POST /projects 请求体必须有 UUID idempotencyKey、tenantId、name、timezone。只允许当前租户管理员创建，创建后本人为唯一 project owner、ai_enabled=false。若同一租户同一 actor 对同一 key 重发相同请求，必须得到同一个 project.id，不能生成额外 Project、DomainEvent、Outbox 或 AI 初始化操作；同 key 不同规范化 payload 报 409。项目尚不存在前使用 tenant_command_receipts 持久化并发幂等，创建后同事务留下正式 project command_receipts 与 domain_events。普通组织成员、单纯系统模型管理员、AI 对话不能调用后台命令自建项目或配置模型 API Key。

## ADR-049 · AI 不能将变更批准冒充已实施

ChangeRequest 的 approved 只表示人工批准，不能等同实施完成。POST /projects/:projectId/pm/changes/:itemId/implementation 的 start 阶段需 PM 经理、当前有效执行人及文本说明；complete 阶段需不同于执行人的 PM 经理/owner 按 pm.accept 复核，引用同项目真实 human user 消息的 evidenceMessageId，消息作者必须为实施责任人且创建于该实施启动之后。命令带 expectedVersion 和 UUID idempotencyKey，原消息 UUID、人工说明、批准/执行/复核人均有事务审计；AI-generated 消息不成为正式实施证据，完成声明不会自动影响任务与计划基线。

**ADR-049 责任变更补充：** 实施中的 reassign 命令要求有效新 ownerId 与人工说明，仍经 pm.plan 项目权限、UUID 幂等与预期版本保护；原有消息证据在交接后不再满足实施时间条件。成员撤权/降为观察者前须先移交未完成的变更实施职责。complete 仍需实施者当前具组织和项目有效资格，不可用 AI、已撤权人员或旧 owner 的消息自动完成验收。

## ADR-051 · 组织创建与人事操作不可被模型自治

部门、组合、项目集创建、人员变更、项目归属、资源投入的 8 个组织管理写 API 只能由活跃 tenant admin 触发，均要求 UUID idempotencyKey；同次操作网络重试返回已提交回执，不能重复注册人员、改变投入比或创造新的资源行。系统总管理员身份及 AI 项目聊天室不替代组织成员角色，模型不可自行操作。租户级回执不应包含供应商 API Key 或正文。组织治理的独立 DomainEvent/Outbox 和容量计算仍属于后续设计，不可将本次原 OrganizationAudit 当成项目正式验收。

## ADR-052 · AI 建议与正式跨项目资源投入

AI 可讨论资源风险，但不能因聊天建议绕过真实组织管理员批准的 resource allocation。正式投入 POST /tenants/:tenantId/allocations 必须携带 UUID idempotencyKey、有效项目+租户成员、1–100% 比例及合法日期闭区间，并由服务器在租户串行化命令事务中校验同一人所有项目**当天累计规划比例不超过 100%**，超额为 409。部门、项目集、项目组合只改变管理归属，不将个人可支配容量扩增为多个 100%。成功命令的同 key 网络重试只回放原租户 receipt，不重复写入投入与组织审计。

## ADR-053 · 项目归属分类须由组织管理员显式确认

部门、项目集、项目组合归属仅属于租户组织治理，AI 模型不能因聊天自动移动正式 Project。项目分类 PATCH 强制 UUID 命令回执、expectedRevision 乐观锁以及当前组织 admin 身份；独立于 AI 权限版本、人员 owner 移交版本及项目提醒设置。已提交键安全回放，新的旧版本命令 409，不制造错误的部门/项目集/组合汇总。

## ADR-054 · 人员写入必须对应真实变更，AI 不能代签管理员操作

组织成员已存在时重复邀请、同一组织角色重复设置、部门成员重复指派同一角色的新命令应当拒绝为 409（不生成虚假的 OrganizationAudit 与租户 Receipt）；已提交成功的同一 actor/tenant/action/key/hash 请求可以返回旧 Receipt。只有组织角色变更命令允许现为普通组织成员的**原管理员**读取自己已完成的降权 Receipt，任何新的写入仍须由事务内当前 tenant admin 授权。租户最后一名 admin 不可降权。AI 不能因为会话、模型建议或候选审核替代组织管理员修改角色，也不能提升平台系统管理员权限。服务端的权限、回执哈希和行锁是约束根源，浏览器的确认和刷新只是 UX，不是安全授权依据。

## ADR-055 · 项目设置状态变化、模型授权版本与幂等事件

项目设置 PATCH 通过 executePmCommand 在当前 tenant/project owner 写事务内比较 expectedRevision 与 ai_enabled、work_start、work_end、cooldown_hours 当前数据库值；如果所有字段相同，新 UUID 命令返回 409，不产生 project.settings_changed.v1 领域事件、Outbox 通知、Audit 或 CommandReceipt，也不执行 syncFollowup。已完成真正修改的相同 actor/project/kind/key/hash 命令重试应在 mutate 之前返回原回执，不改变后续版本。系统独立的 ai_authorization_version 仅在 ai_enabled 真实变化时由数据库触发器推进，重存同样设置或只更改提醒时间不能冒充一次新的 AI 授权。网页保存按钮只在本地表单不同于最后成功保存快照时启用，但最终写权限、版本与变更判断只能由服务器提供，模型不能改写这些规则或自行启用 AI。

## ADR-056 · Task 历史与报告可信来源

- Task 写入由数据库触发器记录 `project_task_history`，涵盖正规任务创建/更新及已审核 AI 候选生成的正式 Task；AI 生成不经人工确认的提案不计入 Task 交付事实。只记录变化的实际操作，没有更改观察字段的 UPDATE 不增加事件。
- 周报/月报按项目本地 IANA 周/月界限统计，不把当前已完成任务总数当作本期完成数。计数以数据库历史事实为准，事件最多展示最新 100 条；任务与事件 ID 是来源索引，不等同于 AI 语义解释或独立验收通过。
- 对任务历史列表和单条证据的访问需同时通过当前项目与组织成员资格校验。跨项目 eventId/taskId/tenant 组合不得泄漏。历史迁移前的操作不允许补造；旧已发布报告不覆盖。
- Web 把生成报告中严格匹配的 UUID 引用显示为项目内只读 evidence 链接，不渲染不可信 HTML。Worker 保持同周期首次生成一次、可人工刷新草稿、发布之后冻结。生产环境性能、SSO/复杂项目组合与全域过程事实仍需额外验收。

## ADR-057 · 用户自注册信任边界

`REGISTRATION_MODE` 仅可由部署 operator 在服务端配置，AI、普通成员和项目 Owner 均不可修改。生产默认 bootstrap（库中还没有用户时仅允许首位管理员创建自己的 tenant）；closed 禁止匿名注册，open 允许匿名用户另建组织但必须由部署 operator 显式选择。bootstrap 对单个创建事务执行 database advisory lock 和 `users` 存在性检查，避免并发创建多个初始管理员。匿名状态查询只返回 `allowed`，不能代替在注册事务中二次授权。严禁模型/提示内容改变这个策略。

Docker 工作流为验证多账号 HTTP/Origin/Cookie 人为设置 `REGISTRATION_MODE=open`，它不是实际部署默认策略。未来面向公网与企业应实现管理员一次性邀请、接受、审计与时限控制；当前没有该流程，不能宣称可自助安全地批量入职。

## ADR-058 · 首账号部署可信证明

`REGISTRATION_MODE=bootstrap` 只接受服务器操作员预先获得的 256-bit `BOOTSTRAP_TOKEN`。生成和保管权在部署操作员，**绝不能**由 AI、聊天成员、客户浏览器代码、提示词、公开配置接口或项目模型连接暴露。注册事务锁定全库唯一首次创建序列，缺失/错误令牌和已有用户均返回拒绝。UI 可以询问操作员输入，但严禁存储在持久浏览器状态、日志或分享链接。CI 必须验证真实 Docker bootstrap 错误令牌与重放拒绝，并验证并发只创建一名首用户。项目成员后续加入不得重开匿名自注册，应通过未来受控邀请流程。

## ADR-059 · 邀请身份与授权边界

邀请码由组织管理员通过服务端签发，随机密钥本身不能存数据库、组织 command receipt、审计记录、聊天或 AI 上下文，数据库仅持久保存 SHA-256。再次重放签发命令只能回放邀请元数据，不能回放明文凭据。新用户凭邀请创建 User + 对应 Tenant 的 `member` 关联，已有用户必须登录且邮箱与受邀邮箱精确一致才能加入。**加入组织不自动拥有任何项目消息、正式 PM 写入、系统管理员或模型配置权限。** 邀请接受/撤销必须和组织命令使用一致的租户锁顺序并进行同事务更新和组织审计。AI 不能签发、审批、查看邀请码，更不能代用户完成受邀注册。

## ADR-060 · 项目与部门参与关系

`projects.department_id` 仅表示唯一主责部门；`project_departments` 仅表示零到多个参与部门，不应重复主责部门。主责与参与部门的完整集合变化统一使用 `classification_revision` 进行原子乐观锁和租户组织命令幂等处理。任何参与部门必须属于相同 Tenant，且不因建立 `project_departments` 关系获得 `ProjectRole`、聊天、PM 数据或 AI 模型设置访问权限。AI 不得把部门关系作为人员项目成员资格的替代。

## ADR-061 · 跨项目管理统计数据权限与事实口径

项目集/组合汇总必须使用正式项目 Task/Risk/Allocation 数据，不能根据 AI 推测的进度、受邀组织人员和聊天文本增减实际完成项目数。Project 经 Program 归属 Portfolio 时不可在组合内重复累加。完成数只计正式 `done`；取消数独立列示。跨项目人员投入仅表示选定日期有效的非取消资源计划，不能解释为工时、实际容量或财务 ROI。管理总览仅限组织管理员；成员加入组织/部门不隐含访问其他项目或跨项目资源明细的授权。查询历史日期不应展示为真实的历史完成状态，除非未来基于事件日志实现独立可追溯回放。
