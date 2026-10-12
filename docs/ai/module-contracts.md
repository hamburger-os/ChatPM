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

## 任务指派与成员撤销的串行化

对 `project_members` 的授权指派检查必须持有 `FOR KEY SHARE`，且在创建或更新任务的同一事务中执行。删除成员时先 `FOR UPDATE` 锁住成员关系，再检查该成员是否承担未完成任务；存在时返回 409 并要求人工重新指派。不能先移除成员再让 Worker 继续催办失效负责人。

- 任务状态更新同事务内再核验操作成员，不能依赖事务外的历史授权；从完成态重新开启并保留既有负责人时，必须验证负责人当前仍属于项目，否则拒绝并要求重新指派。

## Web 与 API 项目设置契约

Web 端从 `GET /projects` 初始化项目列表和设置面板。该接口返回 `work_start`、`work_end`、`cooldown_hours`，与 `GET /projects/:id` 一致；未配置策略时必须是 `null`，而不是省略。回归测试覆盖初始项目及设置保存后读取，避免前端向 `PATCH /projects/:id/settings` 提交缺失字段。

## 部署入口契约

- `packages/core/src/config.ts` 校验 Node 服务运行配置；`db.ts` 从统一配置创建连接池。
- `tsconfig.server.json` 构建 API、Worker、核心领域及 SQL 迁移，生成 `dist/apps/api/src/server.js`、`dist/apps/worker/src/worker.js`、`dist/packages/core/src/migrate.js`。
- `apps/web/app/api/[...path]/route.ts` 代理本源 `/api/*` 到配置的服务端 URL。浏览器不可访问内部地址配置。
- `infra/compose.prod.yml` 只公开 Web 回环端口；`infra/linux` 和 `infra/windows` 是原生部署入口；`tools/ops/postgres.mjs` 执行显式备份恢复。


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
