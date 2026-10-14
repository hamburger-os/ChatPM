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

## 可配置模型传输契约（ADR-019）

- 部署级模型配置由服务器管理员控制：`LLM_API_KEY`（空值禁用调用）、`LLM_BASE_URL`（只接受无凭据/query/fragment 的绝对 URL；外部须 HTTPS，回环或 `host.docker.internal` 可 HTTP）、`LLM_MODEL`、`LLM_API_STYLE=responses|chat-completions`。
- `packages/core/src/llm-transport.ts` 是无数据库副作用的模型 HTTP 适配；`ai-provider.ts` 在每次业务调用时先校验配置、原子预留项目日额度，再解析并通过 Zod 校验，来源/Prompt/模型版本随候选落库。无额外回退模型、错误不产生正式领域记录。
- Docker 仅 API、Worker、迁移任务读取服务端 LLM 变量，Web 独立配置无 Key；原生从项目根目录环境读取。变更模型后重启 Worker。

**开启 AI 的统一校验**：`PATCH /projects/:id/settings` 对 `aiEnabled=true` 调用与 Worker 一致的 `readLLMSettings`；`model_name` 保存模型/端点主机/协议/端点指纹复合身份（密钥和 URL path 不落库）。所有模型请求必须 `redirect:'error'`。

## 原生前台一键停止（ADR-020）

`npm start` 和 `npm run dev` 使用 `run.mjs` 同目录实例独占的回环控制服务；`npm run stop` 是一个不依赖 npm 已安装模块的 Node.js 内置工具，读取私有 `.chatpm-run.json` 中的端口/随机令牌，向当前受控管理器申请停止，等 Web、API、Worker 子进程退出才返回成功。Windows Worker 沿用现有 IPC 关闭。PID 仅用来确认状态是否陈旧，禁止按 PID 自动杀进程。Docker Compose / WinSW / systemd 使用各自停止命令，启动之前的旧版进程无法通过新控制协议停止。

## ADR-021 · AI 项目配置、上下文与运行记录

- 项目负责人通过 `GET/PUT /projects/:id/model` 管理固定供应商 `server|openai|deepseek`，项目成员无访问密钥配置的权限。内置 OpenAI/DeepSeek Base URL 固定于服务端，禁止由浏览器提交任意 URL。服务端模式继续读取部署管理员的 `LLM_*`；数据库保存项目 Key 的 AES-GCM 密文，并从服务器 SESSION_SECRET 派生密钥，不会给客户端返回密钥和密文。更换 SESSION_SECRET 会使已有项目 Key 失效，需重新保存。
- `POST /projects/:id/model/test` 只用无项目资料的固定 JSON 探测，项目 Owner 授权和 PostgreSQL 每项目 30 秒限频；响应仅返回通过状态、延时和匿名模型身份，不返回上游原文。真实联网联调和供应商计费风险仍由部署者承担。
- `GET /projects/:id/ai/runs` 只有 Owner 可查，仅包含源消息、结果/阶段、模型身份、已脱敏错误码和时间戳；不会回显聊天全文或 Key。Worker 对每条开启了 AI 的消息记录处理结果，失败仍保留 Outbox 重试语义。
- `@AI` 触发只读问答，输出不能调用正式变更；普通消息走有界分层上下文的候选提取，近期唯一澄清追问可自然答复，多候选或不明确的回复仍需显式 `【候选:UUID】`。所有候选继续人工审批；提问也按项目 UTC 日请求限额计数。
- 上下文首先读取同项目正式任务/风险和最后 12 条讨论，明确区分可信事实和非可信聊天并按配置预算裁剪，不保存虚构摘要，不支持跨项目历史与通用 Agent 工具。

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

- `POST /admin/ai/providers/:id/discover`：只允许系统管理员读取已持久化供应商，服务端使用解密的 Key 向其 Base URL 下的 `/models` 发起受限 GET；返回最多 500 条规范化的 ID、name、ownedBy、latencyMs、truncated。目录发现错误不泄漏上游响应体或 Key，10 秒内同连接限频。
- `POST /admin/ai/models/import`：只允许系统管理员，以 `{providerId,models:[{id,name?}]}` 输入 1–50 个模型，数据库事务插入，唯一约束保证同连接 ID 幂等。返回 created/skipped，新增项禁用，不能自动成为平台默认。
- `POST /admin/ai/models/:id/test`：允许尚未启用的连接/模型进行匿名 JSON 探测，不改变实际业务调用的启用条件。实际业务继续只使用已启用的默认模型和已启用的供应商，不能隐式切换目标。
- SSRF：目录 discovery 使用 DNS/IP 私网预检，禁止跟随重定向，流式响应限制 512 KB；管理员目标网络访问仍受生产出站防火墙控制，不能将解析预检当成连接级目标固定。
- Web：保存供应商后尝试目录发现，失败保留保存结果；浏览器不见 Key，不提交外部发现 URL；已注册 ID 不可重复勾选；高级设置与选择操作分别管理草稿；测试通过状态仅按本次会话展示，不宣称持久化验证。
