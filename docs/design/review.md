# 当前整体审查结论

审查基线为仓库主干的可运行实验性产品。技术选型继续采用 Fastify + Next.js + PostgreSQL + 独立 Worker 的模块化单体；不引入微服务、多自治 Agent 或旧系统兼容层。

## 已落实的关键约束

- 正式事实由 PostgreSQL 和服务端授权命令管理，AI 只生成候选与来源证据。
- 项目创建必须明确租户，JWT 使用服务端可撤销会话；普通项目成员可以由 Owner 移除。
- 项目数据关系增加复合外键防止跨项目关联。
- 非工作时间检查不能消耗一次提醒冷却，按合法工作窗口重新调度。
- 对未知 Outbox 类型显式失败，避免静默确认；现有重试/死信机制保留。
- 基础社区许可证、贡献指引、行为准则、安全报告和 PR/Issue 模板纳入仓库。

## 尚未完成的产品与生产门槛

核心 API / Web 的完整领域拆分、企业 SSO、组织管理、Owner 转移、全设备会话撤销、跨实例实时推送与附件、AI 长时记忆、策略分级引擎、本地模型、多提供商、真正历史周期报表、完整 SaaS 和生产级自部署、备份恢复与故障注入测试仍属于未交付工作。

**合并准入：** 实施改动以 PR CI、测试回归和变更审查结果判定；未验证项目不得视为生产通过。历史审查记录保留在 Git 历史和此前 PR 中，不重复维护多个过时的审查文件。

## 跨平台部署专项审查（ADR-016）

已增加编译后 Node 服务、打包 SQL、同源代理、生产 Compose、Windows/ Linux 服务示例、环境配置校验与跨平台构建检查；Worker 增加当前周期报告的错过时段补偿与排空。原先 `NEXT_PUBLIC_API_URL` 和仅 Watch 模式的生产依赖已清理。

**未关闭的发布风险**：实机 Windows Service 启停和权限、数据库 PITR/恢复演练、HTTPS 反向代理与 Cookie 的实际 E2E、安全渗透测试、生产运行告警、安装器/ARM64/Kubernetes 等按需扩展。CI 通过仅表示对应自动化验证通过，不能替代生产验收。

### PR /review 补充：最小权限

Web 仅承担界面与固定上游 HTTP 代理，生产 Compose 不再向 Web 注入数据库连接口令、Session 签名密钥和 OpenAI API 密钥。API、Worker、迁移按职责获取所需凭据。PostgreSQL 不开放宿主机端口，容器备份需通过数据库容器执行。持续验证 Cookie、Origin 和跨平台构建。


## 本次整体 /review（2026-10-13）

审查基线：已合并的 PR #17 及随后的一致性修复。此前 PR 中逐步发现和修正的问题留在 Git 历史；当前文件只维护仍有效的约束与未关闭的事项。

### 已检查并修正的文档与部署问题

- 生产 Compose 显式向 Worker 注入 `AI_DAILY_REQUEST_LIMIT`，使部署配置与模型调用额度一致；该额度不是 token 费用预算。
- 本机单独启动 Web 时默认监听 127.0.0.1；容器显式使用 `start:web:container` 监听容器网卡，生产 Compose 仍只发布宿主机回环端口。
- 清理过期支持链接、WinSW LocalSystem 描述和群聊“全量轮询”说明，区分当前状态快照与尚未实现的带证据历史周期汇报。
- 将根目录 Markdown、社区双语主题和 Markdown 锚点纳入文档校验；运维脚本及运行配置变更纳入 PR 文档同步门禁。
- 原生备份保留唯一正式入口 `npm run backup`（私有归档、原子落盘、留存清理）；恢复仅走受确认约束的恢复命令。存量历史记录不作为当前 API 契约。

### 已有设计的合理性

保留 Fastify + Next.js + PostgreSQL + Worker 模块化单体；消息以项目级序号增量轮询，AI 输出只产生候选且需 Owner 审批，正式业务记录和 Outbox 保持数据库事务边界。不引入微服务、多 Agent、自定义队列或旧命令兼容层。

### 未关闭的发布门槛

Windows 11 WinSW LocalService ACL、Linux 关机重启恢复、数据库隔离恢复演练与 PITR、离机加密备份、HTTPS/Cookie E2E、生产告警、提示注入/越权测试以及端到端多人交付均仍需实机验证。CI 通过仅证明对应自动化检查，不构成生产安全验收。

### 合并与文档判定规则

以 PR 的准确 Head SHA 检查 `verify`、`documentation`、Docker、native、security 等可用 Job；人工对比本次 Diff、测试断言、部署命令及中英文公开内容。未跑过的环境或手工步骤不得写为已通过。

## ADR-019 模型传输专项 /review

变更范围：仅替换模型传输接口与部署配置、同步 AI 契约和双语指南；不触碰人工审批或域事实源。审查重点为 URL 限制、防止 Key 进入 Web、两种协议响应解析、截断拒答和上游异常安全失败、AI 调用额度和消息重放。真实 DeepSeek/本地模型调用、Token 费用、生产敏感数据传输和 Windows 原生服务恢复仍属未验证项目，不能据模拟测试视为验收通过。

### ADR-019 审查线程修复

- 项目设置旧 OPENAI_API_KEY 检查与 Worker 新 LLM_API_KEY 不一致 → 共用配置校验。
- HTTP fetch 自动重定向风险 → 明确 `redirect:'error'` 并以模拟请求验证。
- 只记录模型名称无法明确供应商 → 记录主机/协议/配置指纹，同时隐藏 Key 与 URL path。
- 隐私文档的 OpenAI 限定描述 → 改为实际配置的第三方模型接收方。
- 上述修改须以最新 Head SHA 通过全部 CI 后方可解决线程与合并。

## 原生一键停止 /review（ADR-020）

设计保留 API/Worker/Web 独立进程，由原有前台管理器注册安全的本地控制通道并在第二个终端执行 `npm run stop`。不引入全机 PID 枚举、杀死其他应用进程、PM2 或 Docker 和系统服务跨模式控制。审查要求覆盖运行状态独占、令牌认证、停止成功确认、陈旧状态、Windows Worker 关闭、无 Node 依赖时可执行 CLI；Windows/Linux 实机异常退出和防病毒锁仍须验证。

## ADR-021 /review 验收结论（待运行）

审查关注端到端连续协作中的真实缺口：模型配置与测试、鉴权加密、密钥/URL 泄露、输入长度有界及多租户隔离、普通回复唯一性及错误透明度、规则提醒和 AI 开关分离、发送按钮宽度。验证优先覆盖 API owner/member/tenant、多次事件、模型测试限频与结构化输出、跨平台构建和 Docker SQL migration。未获得真实供应商凭证的端到端调用、AI Agent 工具环以及 Token 精确压缩不视为已通过，不能伪称生产验收。

## ADR-022 /review 待核验检查点

- 一次性时区日期迁移：已有任务仍存在，跨时区期限不提前/延后，无 `dueAt` 旧接口。
- AI 进度建议关联的任务 ID 必须属于同一项目；成员可读、Owner 可审核，重复审核冲突；进度提议绝不能绕过正式状态。
- 消息分析 JSON Schema 确保 `items/progress` 均存在，模型误给未知任务 ID 应忽略；新任务标题规范化判重不能假装实现语义检索。
- 规则提前跟进、临期/阻塞优先、冷却及工作时段保证；确定性 MODEL_SCHEMA 错误隔离，不再八次重复计费。
- Win11 浏览器滚动、输入法和邀请按钮验证；DeepSeek 真正使用自定义推理与长上下文需真实 API 测试。
- 核对最新 Head 的 Product verification、Documentation governance、Docker deployment smoke、Cross-platform native builds、Security scanning，未通过不合并。

### ADR-022 Worker 实际链路集成
CI 新增 `tools/test/task-linkage-smoke.mjs`：PostgreSQL 创建正式任务与聊天消息，真实启动 Worker 连接本地非敏感 HTTP 模拟模型，断言同项目任务 ID 进入模型上下文、进度证据落库、没有新建重复候选、正式任务状态未被更改，并对模型只调用一次。此测试不包含真实 DeepSeek 服务体验或生产 Token 费用验证。

## ADR-022 最终整体 /review 检查范围

代码和测试覆盖消息意图与正式任务进度关联、规范化标题判重、同项目外键、Owner 进度证据审批、未审证据不能更改正式任务、日期迁移/时区边界、阶段催办及阻塞优先、工作时间与冷却保护、DeepSeek 提供商预算/推理参数、Schema 失败隔离以及 Windows 11 布局问题。保护规则要求完整 CI 和未解决线程清零才能合并。真实 DeepSeek Key 和 Windows 11 交互仍由目标环境验收，不能因模拟 CI 成功而声称通过。

## ADR-029 · 组织事务化专项 /review 核对项

本轮已针对组织管理路由复核：读取结构不再存在无用的第四条 SQL；创建、分类、人员、资源等管理写入必须在事务内二次验证 admin；组织业务事实与 organization_audit_entries 同事务；撤权后不得凭进入路由时的旧管理员身份写入；审计错误必须导致回滚。新增 integration 检验业务中断、审计 UUID 约束失败和成员越权。此处是检查项目定义，不等于 CI/实机检查已通过，实际结果以 PR head SHA 关联的工作流为准。

## ADR-030 · 正式 PM 登记簿的 /review 检查点

审查独立领域表的同项目 FK、合法状态转移、project_members/tenant_members 在事务内的 role 撤权同步、owner/manager/member 对执行/提交/验收/基线审批权限、提交人和审核人职责分离、幂等键重放返回及 payload hash 冲突、事件与审计与正式写入原子回滚、数据库迁移重跑、防跨项目依赖和有向图环、未知事件失败/合法 domain.changed 无 AI 副作用、HTTP 访问隔离、报告/旧任务回归、Docker/native/安全/文档质量。运行结果以最新 PR Head CI 实测证据为准，实际 Windows/真实模型/生产安全尚未覆盖。

## ADR-031 · /review UI 检查点

核对新页签仅按当前 Project 加载登记簿；角色不越权；UI 不把“AI 声称完成”直接显示为“已验收”；只有本人能提交受指派交付物，独立 owner/manager 审核者能验收/退回，关键变更仅 owner 可审且不可自批；所有 POST 带 UUID 幂等键，版本变更带 expectedVersion；错误可见、响应式侧栏按钮可达、用户切项目不会串数据。校验 Next.js 类型检查/构建、部署与文档同步；没有实机浏览器的视觉核验不得写为已通过。

## ADR-032 · /review AI 授权和模型调用审计检查点

检查：项目 AI 关闭后不得发出新请求/消耗调用额度；版本只在真实开关变更时递增；每次真正模型调用产生独立审计记录，失败/重试不覆盖先前行；不能存聊天原文、密钥、原始上游错误及可能包含私人文本的未加密输入 SHA；Zod/HTTP 异常只保存受限失败代码；owner-only GET 不能被普通成员或其他项目用户读取；Worker 在被撤权后安全放弃排队事件。SQLite/模拟 Provider 不足以替代 PostgreSQL、真实供应商、生产 egress 及关闭模型瞬间的网络请求竞态测试。完整五项 CI 与人工审查要基于最新提交。

## ADR-033 · Worker 重构专项 /review

核对原 Worker 的 processEvents/processReminders/processReports 移入独立核心 Runner 后无业务 SQL 变更；保留 Outbox claim_token/错误重试/撤权后放弃、项目消息 nonce、提醒工作时间与冷却、周月报幂等和快照一致性；启动、15s Tick、健康心跳、IPC/Windows 优雅关闭不改变；新增纯函数回归覆盖逾期、当天和阻塞文案。不得声称 API 已完成整体薄路由重构或生产多 Worker 扩缩容验收。合并门禁为最终 PR SHA 五项 CI，未解决 Review 线程清零。

## ADR-035 · PM 模型质量评测 /review 门禁

黄金测试和生产模型必须共用 Prompt Builder/Schema；离线评分器应针对 Schema 失效、错误事项类别、外项目任务 ID、虚构负责人/截止日和诱导 AI 越权创建任务主动失败；Issue/Decision/Change/Acceptance/Commitment/重复干预未覆盖不得作为“正确空回复”算进成功率；CI 只验证数据与评分器而非厂商模型本身。真实模型需要显式的环境许可和真实 API，按 Prompt/模型版本保存不可暴露 Key/原始输出的报告。不改动原生配置、项目外部模型授权边界或数据库迁移；最新 PR Head 五项工作流通过、无未解决 Review 线程才合并。

## ADR-036 · Issue 正式关闭/复发与历史 /review

检查：已发生问题与未来风险不混为一谈；仅 owner/manager 可以 resolve/reopen；新解决或重新打开必须满足当前项目+组织成员身份、行锁、合法当前状态、乐观版本和非空处理说明；项目生命周期内不可因后续 reopen 覆盖先前处理说明。历史不可跨项目查看；分页带明确 nextBeforeVersion；相同 key 重放不增加历史，同 key 不同 payload 409；业务写入、历史、Audit、DomainEvent、Outbox、Receipt 同事务，异常全回滚。Win11 实机、长生命周期数据删除政策和全量 RAID 仍是外部验收范围。以 PR 最终 Head 五项 CI 和 /review 结果决定合并。

## ADR-037 · P1/P2 依赖与权限竞态 /review

审查任务关闭与依赖新增是否按同一项目 advisory lock 串行、锁顺序是否统一，前置状态 todo/doing/blocked/cancelled 均不能满足 done，已完成任务不可加未完成前置，跨项目 UUID 不可引用。旧 Task 创建/状态/负责人调整是否在事务内重新验证当前项目与组织成员（FOR SHARE of pm,tm），并发撤权的真实 PostgreSQL 锁测试必须失败于错误操作而非在已撤权状态下提交。既有 followup 冷却、task optimistic version、审计及 Worker 不可回退。测试覆盖未经满足的依赖拒绝、独立任务完结、完成前置后的成功、目标已完成时新建依赖的拒绝以及角色撤销的竞态。实际结果仅由最终 PR Head 的 CI 证明。

## ADR-038 · Evidence/Claim 证据链 /review 核对点

审查是否对源消息使用 `(project_id,id)` 复合外键并在服务端锁定、只接受真实 user 消息、不让上游文本赋予工具权限；Unicode code-point 范围必须在原文内，引用文本不可由客户端自报或篡改；必须有 tenant/project 当前访问授权，member 仅能引用自己发言，只有原作者可确认自己的主张，manager/owner 才可驳回其他人的错误解释。证据与主张、CommandReceipt、DomainEvent、Outbox 和 Audit 在同一事务，重放不会复制数据；文案明确来源确认不是 Task done 或交付物 accepted。API JSON 校验、引文泄漏风险、分页跨项目 404、浏览器异步页签切换、Docker/native/security/docs CI 均需检查。数据库超级用户仍可删历史，不能把应用审计当作法律不可篡改证明。

## ADR-039 · 旧 Task 命令统一 /review

检查旧直接 Task create/update 已不存在绕过 CommandReceipt 的第二写入路由；API 强制 UUID idempotencyKey，客户端编辑不同意图须重新生成，同意图网络重试保持键；相同 key/同 payload 返回同一个 Task/版本、不同 payload 409，消息/AI 无权伪造带身份的动作。DB 正式状态、followup、Audit（含 before/after）、DomainEvent、Outbox、Receipt 全原子提交；项目/组织成员撤权与负责人有效性仍在事务内复核；完成前置任务/悲观锁/乐观版本均沿用。检查 Web UI、Smoke/Worker/报告、命令断言、原生+Docker 及双语文档全部 latest-head CI。提案审批产生 Task 等剩余直接 SQL 按真实状态保持待办，不可虚称全域完成。

## ADR-040 · 提案和进度审核 /review

服务端再查当前组织和项目身份，对 owner/manager 使用 `proposal.approve`，不接受由模型自行审批；写路径必须要求 UUID 幂等键，并在 receipt 幂等守卫内对 pending 状态执行单次决策。验证 risk 和 task 两分支生成唯一真实事项，Task 同事务刷新 FollowUp，accepted blocker 保持上一次成功发送的冷却；已审核候选换新 key 仍 409，同 key 原样重试返回回执且不新建二次事件，改 payload 同 key 409。业务状态、澄清 thread、Audit/DomainEvent/Outbox/CommandReceipt 同事务。测试成员越权 403、同项目隔离、Risk 分支、原有 Worker/消息/任务/报表回归。更新 UI 后仍要验证错误恢复重试保留键而新意图生成新键。五项最新 PR Head CI、代码审查线程清零后才合并。来源人的“完成声明”不自动将任务标记为 done。

## ADR-041 · Owner 写入与撤权竞态 /review

审查 server.ts 中项目负责人控制的 POST/PATCH/DELETE，必须在业务事务**内部**调用 lockProjectAccess 并按动作授权，不能凭事务前 member() 或 UI 按钮授权。覆盖成员邀请/角色变更/移除、设置更新、Outbox 死信 retry、周/月报告生成和发布；目标成员角色与未完成任务检查继续使用锁。项目/租户成员撤权与授权事务应通过数据库行锁互斥。报告已发布内容不得被新生成覆盖；审计同事务。完整验收以最新提交五项 CI 与代码审查为准。

## ADR-042 · 模型出口 SSRF/DNS 重绑定 /review

严格检查三条调用路径 `discoverProviderModels`、`probeModelText/callStructuredLLM`、`ConfiguredLLMProvider` 以及管理员结构化探针不再调用默认未经限制的全局 fetch。URL 仅来自已授权系统模型配置，不接受聊天文本中的 URL；不能凭白名单域名信任其 DNS：任何 A/AAAA 记录为 loopback/私网/保留网段就 fail closed，实际 HTTP(S) lookup 固定已经验证的 IP、TLS SNI/证书仍认原始 hostname，不自动 follow redirect，不经环境代理，响应限制并隐藏上游正文/密钥。明确本地端点保留功能，但其 DNS 也只可指向预期私网地址。单元测试必须包含真实本地 HTTP 请求、敏感头、重定向拒绝、超大响应、恶意 DNS 和空结果；实际网络 egress 与目标厂商实测作为 P4 生产发布外部验收。五项最新 Head CI 全绿与审查无未解决线程后合并。

## ADR-043 · 版本化 Report Command /review

查验报告人工 GET/POST/发布 POST 仅在 `report-routes.ts` 注册，项目/组织身份同时校验；写入使用 `executePmCommand` 的 `report.manage`（仅 owner），UUID idempotencyKey，发布还需 expectedRevision。重复同 key/同 payload 200 且相同报告版本；同 key 改 payload 409；两次新 key 生成草稿必须逐次刷新 revision，已发布报告不得被重写；发布旧 revision 或不同 key 重复发布 409。正式报告状态、发布操作者/时间、审计、领域事件、Outbox 与 Receipt 事务同成败；Worker 定时报告语义不能改变，旧报告迁移不应虚构 publishedAt。校验普通成员越权、跨项目访问、任务统计正确性、浏览器重试、PostgreSQL 迁移、Windows/Linux/Docker 五项最新 Head CI。没有历史统计与来源图时不能称报告为可审计的真实历史绩效。

## ADR-044 · 项目人员管理/设置命令 /review

审核旧 bootstrap 不重复注册成员增删、角色编辑、设置修改；无 key 写入 400，重复同 key/payload 返回原 Receipt，payload 不同 409，新 key 重复邀请或同角色不产生虚假领域事件。写前和事务内重验当前 tenant+project owner，目标受邀人需有组织资格且行锁稳定；成员从 manager/member/observer 移除允许，但 owner 不可移除，带未完成任务的人员必须先移交。设置必须传 expectedRevision，旧版本 409、当前版本写入 revision+1 与原 `ai_authorization_version` 触发器互不覆盖；只有实际可用默认模型才允许开启 AI。服务端 Audit、DomainEvent、Outbox、CommandReceipt 与实际状态在同一事务。审查 Web 重试键/设置版本和人员移除确认，原 Smoke 权限、报告、Worker、会话及管理员配置测试；仅在最新 Head 五项 GitHub CI 全部成功且无未解决 review threads 时合并。运维死信重试、项目创建和组织管理等旧写入仍是明确待办。

## ADR-045 · 死信恢复 /review

检查旧 `server.ts` 不再重复注册 Outbox 三条运维路由；读取仍只允许当前组织和项目的 owner，POST 必须经过事务内的 `operations.manage` 权限锁并要求 UUID `idempotencyKey`。仅允许 dead_at 非空、processed_at 为空且属于当前项目的事件重置尝试/lease/error/backoff；其它事件均 409，不能跨项目恢复。相同键和 payload 200 回放持久 Receipt，不再执行 UPDATE 或产生第二领域事件；新键再次恢复 409；恢复操作自身生成一条 Audit、DomainEvent 和 `domain.changed` Outbox 事件，全部同事务提交。回归验证普通成员 403、无键 400、重试幂等、原 Outbox 退避/领取/认领 token、Worker、报告、Win/Linux/Docker 与 docs-sync。只在最新 PR Head 五项 CI 通过且 Review 无未解决线程后合并。真实环境 Worker 抢占/网络分区与生产恢复签署仍是未完成 P4 范围。

**ADR-045 增量回归：** `018_outbox_manual_retry_revision.sql` 不重写存量版本和消费者租约；首次恢复版本 1，同键重放仍是 1，将事件模拟重新隔离后新的有权命令返回版本 2；领域事件 aggregateVersion 必须按 1、2 顺序递增。没有真实状态变更的命令不能增加 revision 或事件。

## ADR-046 · 风险命令与历史的 /review

检查风险不等同 Issue：accepted AI Risk 初始 open/v1，无人类概率/计划/责任人且模型不能直接改变状态。风险评估需要 active tenant/project 非 observer owner、likelihood/impact 1–5、非空 responsePlan 与人类说明；动作仅 owner/manager 的 pm.plan 且需 UUID idempotencyKey 与 expectedVersion。open→mitigating 必须已有有效人类评估，mitigating→resolved 和 resolved→open 必须带说明，不能 open→resolved 跳状态；已关闭风险不得直接覆写评估。每次真实操作增加 version 和不可修改、跨项目复合 FK 的 risk_register_changes 历史，Audit/DomainEvent/Outbox/Receipt 同事务；原 key 请求回放不产生第二个历史，新 key 旧版本 409。普通成员操作 403、历史查询项目隔离，manager/member/observer 降权/移除遇未解决风险负责人必须先交接。报表 open+mitigating 都是未解决风险。验证新 019 迁移、API Smoke、TS/前端、Windows/Linux/Docker 以及静态扫描，最新 PR Head 五项 CI 与零未解决审查线程后方可合并。完整定量风险建模、迁移演练和生产安全仍未验收。

## ADR-047 · 项目负责人交接 /review

检查数据库迁移 020 未改写旧 SQL：每项目仅有一个 owner 角色（数据库唯一部分索引），独立 ownership_revision 初始 1、每次真正交接 +1，不误用 settings_revision/ai_authorization_version。只能当前 tenant/project 有效 owner 发起，target 必须是当前组织及项目成员且不是自己；原子地将原 owner 降为 manager、新 owner 升为 owner，并更新 project.owner_id。跨角色、新旧 owner 的成员行锁、项目行 FOR UPDATE 与版本检查必须序列化，其他读者不能看到双 owner。强制 UUID idempotencyKey，原 owner 降权后只允许仍有项目 read 授权的人重放自己的原 Receipt；新 key 必须再核验完整 members.manage，禁止借重放授权执行新操作。同 key 不同 payload 409，旧 ownership revision 409；事务中 Audit、DomainEvent/Outbox、Receipt 与正式数据同时成功或回滚。真实 PostgreSQL 回归覆盖首次移交、双向移交、旧 owner 降权、双 owner 23505、事件版本、系统管理账号不越权。合并须最新 HEAD 的五项 CI 全 success 和无未解决审查线程。

## ADR-048 · 租户级项目创建命令 /review

数据库只新增 migration 021，不改既有 001–020 checksum；表 tenant_command_receipts 以 tenant/actor/kind/UUID key 约束，payload_hash 与项目生成结果同事务持久。核验当前组织管理员 tenant_members 的行锁及首次执行/回放权限，注册人跨组织或普通成员都不得创建；创建前 receipt 唯一约束负责并发序列化。成功后的 projects.tenant_id、owner_id、唯一 owner 角色一致，默认 AI 关闭，时区检验不变；同事务写项目级 CommandReceipt、Audit、DomainEvent、Outbox 并与根 receipt 的 key/hash/结果一致。原命令同键重试返回同一个项目，不再创建额外行/Outbox；同键变更名称或时区 409；无键 400；原项目被删除或原用户失去项目成员权限，不得通过旧根回执泄露历史项目资料。前端 UUID 在同一创建意图网络重试时稳定，已成功后清除；新表单意图使用新键。测试在真实 Postgres 同时发起四个相同请求并核对项目、owner、两类 receipt、领域事件、出站事件及 audit 唯一。合并以最新提交五项 CI 全部 success、审查线程全 resolved 为前提；Tenant 级其它写入和实机 V1→V2 迁移不在此次验收范围内。

## ADR-049 · 变更实施与证据审查 /review

检查 022 仅新增迁移，不改写发布过的 SQL；旧 pending、approved、rejected 状态和审批人/时间保持不变。新表约束 project_id/change_id 复合外键与 project_id/message_id 复合外键、每次真实 change_version 唯一、append-only 人工 history；approved→implementing 的 start 要求有效租户与项目中非 observer 负责人及非空说明，只有 implementing 可 reassign（新负责人不能与旧相同），重指派须重置证据时间并继续保持 implementing；只有 implementing 可 complete，须由非执行人的 owner/manager 独立复核且证据来自本项目负责人于本次实施开始后发表的 kind=user 消息。AI 消息、其他项目消息、实施前旧消息、撤权后的负责人均不得获批准。所有命令有 UUID key、expectedVersion，原键回放不新增历史/审计/Outbox，错 payload/旧版本 409；写状态、actor/time、history、DomainEvent、Outbox 与 Receipt 同事务。移除或降为 observer 前先移交实施中职责。API smoke 覆盖旧状态禁止跳转、无效负责人、owner/manager 区分、自证拒绝、旧证据过期、错误作者、真实消息、重放、重新指派与历史版本/事件 3–6，后续消息去重测试仍按 nonce 精确验证。最后以 PR 最新 Head 产品、文档、安全、Win/Linux 原生构建和 Docker 冒烟五项 CI success + 零未解决 review 线程才可合并。历史计划基线实施、成本收益验收、长期多 Worker/真实 LLM 仍未验收。

**ADR-049 Smoke 限流回归：** 完整 API Smoke 超过默认每用户 180 次/分钟限制时，测试 HTTP 客户端仅在真实服务器返回带有速率限制头与 Retry-After 的 429 后按提示有限重试；不修改生产限流参数，不对其它 429 状态无条件重试。因流量规模引发的 429 不能用于跳过正式权限、状态与证据断言。

## ADR-050 · 独立恢复库 /review

核对 Docker smoke 先完成授权、Cookie、Worker 心跳与 Outbox，再停止 web/api/worker 写入者；source chatpm DB 必须只备份不 drop、不覆盖；仅 CI=true、显式开关开启、postgres running 且其它业务服务均已停才允许演练。使用原生 backup.mjs --docker 输出 0700 临时目录和 0600 custom-format archive，pg_restore --list 实查 TABLE DATA；恢复数据库名称为随机 chatpm_restore_drill_*，必须 createdb -T template0 成功才进入删除逻辑，pg_restore --exit-on-error --no-owner --no-privileges 导入真实 schema+数据。SQL 在 source/target 两端按相同规则输出所有 public 表计数和每行 canonical JSON 的排序 MD5；要求表集合、行数、hash 完整一致，且 schema_migrations、users 非空。内容不写 CI 日志；无论通过/失败都删除自己创建的隔离库与临时备份，恢复工具原本的生产停止服务保护继续存在。纯单元测试覆盖缺表、内容改变不改变行数、无业务样本和重复表。最新 Head 所有五项 workflow success + 无 unresolved review threads 后方可合并；不能用有限 CI 证明 TB 级性能、PITR、Win11 原生与生产恢复时限。

## ADR-051 · Tenant Governance Command /review

核验原组织级 tenant-governance 事务 advisory lock 与 tenant_members FOR UPDATE 当前 admin 身份验证未被简化；所有 8 个组织治理 POST/PATCH 写请求均必须解析 UUID idempotencyKey，调用 OrganizationCommand，在同事务 INSERT tenant_command_receipts (tenant/actor/kind/key 唯一、payload SHA256) → 真正业务变更 → organization_audit_entries → Receipt.result。重复 key+payload 即使并发只能返回原结果，不新增业务或审计；同 key 不同 payload 必须 409、缺 key 400、普通租户成员 403、角色撤销后不能回放原管理员回执。正确复用项目创建时已增加的 021 表，不改迁移 checksum；组织级写入不能伪造 project domain event/outbox。Web 同一业务意图失败重试键稳定、操作成功后清键。真实 Postgres Organization Integration 包含权限撤销、事务失败回滚和 payload hash；完整 API Smoke 包含 4 个同键并发 Portfolio 创建、身份拒绝、已有角色/部门/分类/投入业务回归与复用原键重试，检查唯一 receipt 和组织审计。合并必须在 PR 最新 Head 五项 CI 全 success、无未解决审查线程后执行；完整项目组合价值管理与 Tenant Outbox/乐观并发仍需另行验收。

## ADR-052 · 部门多项目资源容量约束 /review

资源 allocation.recorded 不仅校验单条 1–100%，还应按 tenant_id+user_id 汇总所有项目计划投入，在拟登记起止闭区间逐个分配开始日取 peak，`peak+percentage>100` 409；当天结束的旧分配仍计入，当天之后的无重叠安排不会阻止新分配。对不同项目同一人的资源分配既不能各按 100% 独立登记，也不能对不相交日期错误相加。资源领域 SQL 从 API 写路由抽取到可复用的 core 服务，并通过 organizationCommand 的租户 advisory transaction lock 串行化两个不同 key 的并发插入。检查项目与成员关联、租户身份、管理员即时撤权、idempotencyKey 原键重放、同键 payload 冲突、在容量不足时无 Audit/Receipt/业务行脏写。回归验证跨项目 60+40、超出 1%、端点接壤、完全不交叉、另一个人员、并行竞争；原有 Windows/Linux/Docker、API、Worker、模型安全、文档均不得回退。项目组合/项目集归属不影响按人容量总和，部门汇总不得冒充工时数据。合并需最新 Head 五项 CI success，且无 unresolved review threads。

## ADR-053 · 项目组合/项目集/部门分类的版本冲突 /review

核验组织结构列表返回 classification_revision；归属写入强制 UUID idempotencyKey 与 expectedRevision。只能当前 tenant admin 操作本组织项目（组织互斥 advisory + 当前管理员行锁）；项目 FOR UPDATE 后检验版本匹配，再校验待归属不是完全相同的状态，否则明确 409，不能写虚假 OrganizationAudit。实际变更 revision+1，仍必须满足只设置 Program 或直接 Portfolio 的业务约束与同 tenant 复合 FK。两个并发管理员不同 key、相同 expectedRevision 时仅一人成功；成功 UUID/key/payload 重放 200 且不再改版本，已成功的 key 改 payload 409，新 key 携带旧版本 409；跨租户项目 404，丢失组织管理员身份 403。界面显示当前归属版本，过期保存需要让用户刷新并重新选择，不静默覆盖。新 023 SQL 不改写既有 001–022 checksum，API/PostgreSQL smoke 检查版本 1/2/3/4、旧版本、独立修改、重复请求与无审计脏数据。合并须最新 SHA Product/Docs/Security/Native/Docker 五项 CI 全绿且无 unresolved threads。

## ADR-054 · 组织治理无操作/降权回放 /review

检查 organizationCommand 默认仍持 tenant-governance advisory 互斥锁与当前 admin 角色行锁；只有 tenant.member_role_changed 选择 replayAccess='member'，旧 admin 降为 member 后可凭相同 actor/tenant/kind/key/hash 取得其已完成命令回执，不能使用新 key 发起任何组织角色更改。不同 payload 同 key 409，已撤销 tenant 成员权不能读取回执。重复成员邀请、同角色修改、部门角色相同重新指派的新命令均 409 且没有新审计/receipt；同一 key 原操作可以重放。至少一位 tenant admin 不变量未削弱。Web 保留同意图 UUID 重试。真实 Postgres smoke 覆盖普通成员拒绝、同角色无操作、双管理员自降权后的精确回放、部门角色无操作、回执与审计计数及现有资源容量/项目创建回归；最新 SHA 的五项 CI 全通过、无未解决 review thread 后合并。

## ADR-055 · 项目设置无操作/版本守卫 /review

在事务内验证当前组织及项目 owner、UUID command key 与期望设置版本后，对 ai_enabled/work_start/work_end/cooldown_hours 做全字段比较；值均相同时新 key 返回 409，项目 settings_revision、AI 授权 version、任务 FollowUp、项目 domain_events/audit/outbox 和新成功 Receipt 均保持不变。已完成真实更改的相同 key+hash 重放依旧 200，改 payload 同 key 409，新 key 旧 expectedRevision 409；正常真实变化照常+1、重新计算 FollowUp 并留下单次事件。Web 在没有未保存变更时禁用「保存设置」，成功后以刚提交的值更新基线，切换项目时重置基线。回归包含原 PostgreSQL API Smoke、Owner/tenant 权限、AI 版本触发器、并发冲突、Windows/Linux/Docker、文档与安全扫描；最新 PR Head 五项 CI success 且无未解决 review 线程才能合并。

## 2026-10-15 · 治理、安全与后台可靠性专项复核（增量）

审查基线为 main ef64ec19aa34。已知变更审批死锁由缺少独立授权审批人引起：owner 与 manager 都可以在 `pm.approve` 下审核基线变更，但 `created_by === reviewer` 必须被拒绝；至少需要两位具有不同职责的真实成员。单人项目无法完成必须独立复核的重大变更属于刻意的职责分离约束，应在 UI 中说明不能自批。

Next.js 同源代理下，API 看到的 IP 是公共代理地址。登录/注册在 body 可用的 preHandler 阶段按 HMAC 规范化账号分桶，缺失或超长账号使用来源 IP 回退。该机制避免正常用户共同消耗 8 次尝试限额；但高频随机账号攻击仍需要可信入口网关的全局和来源限流，不能信任未经校验的转发头。

Worker 的 AI、提醒和周期报告改为三个独立 single-flight lane；并发队列仍受共同数据库池限制，尚不属于生产级负载隔离。模型响应发布前需在业务事务内持有项目授权行锁并核验 AI 授权版本，包含正常回复、候选进展和澄清结果；撤权无法收回已经发送的第三方请求。

交付物负责人不得是 observer；成员移除/降为 observer 前必须清理未完成交付物和仍有效的项目资源投入。资源分配使用取消时间/执行人保留历史；组织管理员通过幂等命令取消，容量计算只统计未取消记录。此处没有实现交付物重新指派/资源调优，更完整的转岗向导、PMP 项目集收益、历史周/月报、完整领域路由分离、真实模型和 Win11 验收仍需独立工作项，不得把本次增量称为全部交付。

## ADR-057 · 生产环境默认关闭自由注册（2026-10-15）

旧版 `POST /auth/register` 对任何匿名请求创建新 User 和 Tenant/Admin，在公网部署时会导致未授权组织创建与资源滥用。当前生产配置引入明确的 `REGISTRATION_MODE=open|bootstrap|closed`：未显式配置时 `NODE_ENV=production` 默认 `bootstrap`，开发态默认 `open`。Docker Compose 固定传递 `REGISTRATION_MODE`，缺省 bootstrap；生产 operator 可以明确选择 `closed` 或短时 `open`。

bootstrap 只允许创建全库首位用户；创建检查在同一个数据库事务内获取固定 advisory lock 并重新查询 users，避免两个同时匿名请求都创建租户管理员。closed 禁用注册，open 是部署操作员显式授权的自由注册；全部三种模式下其余登录、会话与项目权限不变化。只读 `GET /auth/registration-policy` 只暴露 allowed 布尔值，前端关闭无效注册入口，真正权限校验仍在 POST 的事务中进行。Docker CI 为验证多用户显式 opt-in open，不是生产安全默认值。

**未完成：** 尚缺安全邀请/接受和管理员审核、全局速率防护、可信代理/源地址追踪、公众域名安全评测。生产临时开放自由注册应仅在有严格入口控制时进行，切换之后必须重新重启 API/容器才生效。不能把 bootstrap-only 当作完整企业身份治理或 SaaS 注册策略。

## ADR-058 · 防止公网首账号抢注（2026-10-15）

此前 ADR-057 的 bootstrap 模式仅检查全库用户为空，不能证明抢先申请者是服务器操作员。本次要求额外提供由服务器安装工具生成的 256-bit `BOOTSTRAP_TOKEN`（严格 64 位十六进制），有效的首账号注册要在同一事务中先锁定固定 PostgreSQL advisory key、验证全库用户仍为空，再使用固定长度的 SHA-256 摘要和 `timingSafeEqual` 校验操作员令牌，之后才创建首位 User 和 Tenant Admin。缺失、格式错误或错误的令牌均返回统一 403，不泄露已存在用户细节。 `REGISTRATION_MODE=open` 仍需显式开启，且不能代替管理员邀请流程。

Docker `deploy:docker` 与 Windows/Linux 原生 `setup:local` 在私有 `.env` 中生成独立随机令牌，Docker Compose 仅将令牌交给 API/非 Web 服务器容器；Next.js 客户端只有是否需要输入密钥的布尔信号。不能把令牌提交版本库、粘贴到聊天或者通过公开 URL 传递。全新部署在仅绑定 127.0.0.1 时设置首位可信操作员并检查登入后，方可配置 TLS 与公网反向代理。成功注册后建议设置 `REGISTRATION_MODE=closed` 并重启 API 服务；保留的私有令牌无权再次创建用户。

回归：单元测试验证无令牌、错误令牌、格式和摘要比较；真实 PostgreSQL 初始库进行并发首用户竞争，两笔事务中最多一笔成功；Docker 端到端分别验证显式 `open` 多用户测试模式与默认 `bootstrap` 中错误令牌拒绝、正确令牌一次性使用、之后不可再次注册；原生安装测试验证令牌稳定生成。该修复不等于正式邀请/接受、SSO、生产网络边界或全局滥用防护已完成。

## ADR-059 · 组织成员受控邀请与一次性加入（2026-10-15）

生产在 bootstrap 完成后关闭匿名注册，管理员必须使用受控邀请让新成员进入系统。本轮新增 `026_tenant_invitations.sql`：邀请码使用 CSPRNG 生成 32 字节随机值（64 位十六进制），仅持久保存 SHA-256 摘要，限定受邀邮箱、目标 Tenant、发起组织管理员、固定 7 日有效期和接受/撤销的互斥状态。管理员创建/撤销经过既有 `organizationCommand` 的现时授权、租户 advisory lock、持久幂等回执与组织审计；再次签发同邮箱邀请码会撤销此前所有尚未接受邀请。

不能把邀请码明文保存在 `tenant_command_receipts.result` 或审计 metadata：响应首次签发时返回一次性 code，相同 idempotencyKey 重放只能得到邀请记录，不能恢复 code，丢失需撤销/重发。管理员组织页面可以复制单次显示的 code 并查看状态、撤销；不发送自动邮件、不把 code 放 URL 或日志。

匿名 `POST /auth/invitations/claim` 使用一次性 token、严格匹配受邀邮箱、强密码/昵称，为此前未注册的人创建用户并且只加入目标组织为 `member`（绝不授予组织 admin 或项目聊天权限）。已有 ChatPM 用户先登录，通过 `POST /auth/invitations/claim-existing` 领取匹配其账户邮箱的邀请。接收动作在相同 PostgreSQL 事务中锁定 Tenant 管理 advisory lock 和邀请码行，创建 tenant_members、记录 accepted_by/time 及审计；过期、撤销、已使用、重复领取与错误邮箱均拒绝。还未加入项目的受邀成员需项目负责人独立授权。

限制：目前无邮件发送服务、企业 SSO、邀请码重发自动通知或时间窗清理作业；发码只能由管理员私下安全传达。没有完整生产入职/离职 SCIM 工作流和滥用管理。本改进须通过真实 PostgreSQL 并发、跨邮箱/租户访问、Docker 闭合注册入职回归和五组 CI，不能直接宣称达到生产全面身份治理。

## ADR-062 · 模型出站本机例外与 DNS/HTTP 头边界复核（2026-10-16）

继续收紧 Issue #39 既有的 DNS 全解析结果校验与单次 Socket 已验证地址 pinning。显式 `localhost` 仅接受 loopback；`host.docker.internal` 不能简单视为「只要是任何私有 IP 就信任」，因为遭 DNS 污染时可能解析到 `169.254.169.254` 云元数据、IPv4-mapped 元数据、CGNAT、基准/保留地址或公网目标。现在 Docker 主机网关例外只接受 RFC1918 10/8、172.16/12、192.168/16 或 IPv6 ULA fc00::/7 的完整 DNS 结果集；mixed A/AAAA 只要任意结果不合规则整次拒绝，不回退挑选安全地址。明确拒绝 IPv6 site-local fec0::/10、NAT64 本地转换前缀 64:ff9b:1::/48 和已废弃公网 relay 192.88.99/24。该例外仍需运维网络层保证内网解析、路由与防火墙安全。

生产 HTTP(S) 模型传输只允许业务实际需要的 `Authorization`、`Content-Type` 和 `Accept` 请求头。禁止调用方覆盖 `Host`、`Proxy-Authorization`、`Content-Length`、`Transfer-Encoding`、`Connection` 和其他 hop-by-hop/代理/转发头；拒绝时不得建立 Socket。出站仍拒绝重定向、复用连接、环境 HTTP 代理和超出响应上限；模型 Key 不进入错误日志或客户端环境。单元测试在本地模拟 A/AAAA 混合结果、映射 IPv6、Docker gateway 公私地址和违法 HTTP 头，并确认非法请求不触发上游实际连接。

**审查限制：** 即使通过 CI，此处只验证纯 Node 传输语义，不代表实机 QNAP/Windows/Linux 网络路由、IPv6 DNS64、自定义 NAT64、服务网格透明代理或企业 HTTPS 出站策略已验收。对无授权本地模型服务、实际私网出站绕行和供应商真实端点仍需在部署目标做隔离测试；Issue #39 保持开放。

## ADR-065 · Outbox 失效租约的 AI 写入隔离 /review（2026-10-16）

**问题：** 现有 Outbox `claim_token` 只用于 `finishEvent/failEvent` 的条件更新。Worker A 领取事件后发起长耗时模型调用；租约 5 分钟过期、Worker B 重新领取同一事件，此时 A 的 AI 回复、候选/进展、澄清、`ai_analysis_runs` 依旧可能成功写入，因为这些写操作此前只检查项目 AI 授权而不核验事件所有权。幂等 Message nonce 只防止重复文案，并不能替代失效 lease 的权限收回。

**方案：** Core `assertEventClaim(db,event)` 在同一正式副作用事务中使用 `SELECT ... FOR UPDATE` 锁定当前 Outbox 行，要求 id、project_id、claim_token 全部相符、`claimed_at > NOW()-INTERVAL '5 minutes'` 且事件未处理/未死信。无效即 `OUTBOX_LEASE_LOST`，整个事务回滚，旧 Worker 不再覆盖 AI 分析状态、写重试/死信，也不提交迟到模型结果。覆盖 AI 回复、任务进展候选、新建议、澄清三种写入分支及分析运行状态写入。即使租约已过期但尚未重新领取，也不能发表迟到结果；新 Worker 在它重新领取后独立处理。

**并发顺序：** Outbox 行 FOR UPDATE 在副作用事务内持有至 COMMIT；其他消费者的 `FOR UPDATE SKIP LOCKED` 无法在旧业务事务提交前抢占令牌。AI 授权版本检查仍在同一事务，不能靠模型调用前的检查代替。事件执行改为每次 `claimEvents(1)`、消费完成再领取下一条（最多单 tick 12 条），避免先批量领取 12 条后因第一条 LLM 延迟导致后续尚未开始的事件租约过期。

**回归：** 真实 PostgreSQL 覆盖租约过期但无人认领、租约被重新分配、旧 token 禁止 AI 提交、当前 token 可提交、事件已完成禁止再写及事务行锁 `NOWAIT` 并发争抢；静态架构测试锁定每个写入路径的 `assertEventClaim` 调用和逐条领取方式。租约失效不代表已向第三方模型发送的数据可以撤回；模型耗时可超过租约时仍会浪费调用且需新 Worker 重试，后续多实例 heartbeat lease renewal / abort 并发控制与端到端故障注入还需要继续。此 PR 不能宣称多实例 Worker 的所有可靠性验收已经完成。

## ADR-066 · Task 官方命令归属与无操作事务拒绝 /review（2026-10-16）

此前 `apps/api/src/task-routes.ts` 在 HTTP 层直接持有完整 `INSERT/UPDATE tasks`、依赖检查、任务人选、FollowUp 和 `executePmCommand` 领域变更。现在将创建及修改统一迁移到 `packages/core/src/delivery/task-commands.ts`，HTTP 层只解析 ID、校验 Zod DTO、验证当前登录身份并委托 Core；不改变既有 DomainEvent/Outbox/CommandReceipt 的种类和响应形态，不另造平行事务运行时。核心继续使用 `executePmCommand` 在相同事务内重新核验当前 Tenant+Project 授权，任务依赖图锁、版本冲突、状态/计划权限、负责人有效性、FollowUp、审计、领域事件、Outbox 同步。

**真实变化不变量：** 如果新请求使用正确 `version` 和新的幂等键，但 `status/title/assignee_id/due_date` 所有正式字段均与当前状态相同，返回 409 `任务没有实际变化`，事务回滚且不创建成功 Receipt、任务版本、历史事件、审计、DomainEvent、Outbox 或催办刷新。版本冲突先拒绝，再比较无操作；相同已成功 `idempotencyKey + payload` 可继续回放原结果，而原 key 不同 payload 必须 409。只有实际变化能递增版本并生成正式历史证据，AI 未审候选仍不直接更新正式 Task。

回归补充：真实 PostgreSQL Core 集成覆盖创建、完整无操作拒绝/数量不变、有效任务更新、相同键回放/同键异参冲突、旧版本拒绝、事件计数；旧 API Smoke 中增加 no-op 后历史来源数量保持不变断言。静态架构测试防止 Fastify Task 路由恢复直接 `UPDATE/INSERT tasks`。范围仅 Task CRUD 的正式写入，不等于 PM 所有 WorkItem、验收、风险和 Portfolio 全域命令完全收敛；Issue #48/#49 继续开放。

## ADR-067 · Risk 正式登记簿 Core 读写隔离 /review（2026-10-16）

原有 `apps/api/src/risk-routes.ts` 同时执行 PM 风险评估/缓解/关闭的 SQL、Risk 变更历史写入和「先授权、后另外一条连接读取」的风险列表/历史查询，违背 Module/Core 读写所有权与撤权一致性约束。本次将 Risk 命令完整迁入 `packages/core/src/risk/risk-commands.ts`，复用 `executePmCommand` 的真实当前 Tenant+Project 成员授权、提交命令 Receipt/DomainEvent/Audit/Outbox 同事务及乐观版本；保留评估风险 1–5 概率/影响、非 observer 负责人、有效应对计划才能开始缓解、open→mitigating→resolved→open 合法流转、人工 `note` 审计历史。不得让 AI 未审候选自动关闭风险，也不能把实际 Issue 与潜在 Risk 混为一类。

Risk 列表/历史读取迁入 `packages/core/src/risk/risk-queries.ts`，用同一个 PostgreSQL REPEATABLE READ 事务和 `lockProjectAccess` 的当前组织+项目成员 SHARE 行锁校验，再在一致快照中读取本项目风险/历史。跨项目伪造 riskId、撤权后继续读取、组织成员但非项目成员一律拒绝；普通 Observer 可只读，不能评估/转移。API 只负责 UUID/输入 Schema/身份解析及调用 Core，不再持领域 SQL。

真实 PostgreSQL 验证：组织/项目隔离、Observer 阅读和写入拒绝、合法风险评估及幂等回放/变 payload 冲突、未评估不能缓解、生命周期约束、历史分页、项目成员撤权后的风险读取拒绝；保留既有 compiled API Risk Smoke。新增测试夹具于结束时处理自身 Outbox，避免污染后续全局事件 Consumer。静态架构守卫禁止 Risk HTTP route 重新持有直接 SQL 或命令执行器。

这是 Issue #48/#49 正式 Risk 边界的增量，仍不代表完整 RAID/WorkItem/Portfolio/跨项目依赖、AI Playbook、多实例 Worker 或 Win11/QNAP 生产验证已经完成。


## ADR-068 · 审核 Core 所有权 /review（2026-10-17）

核对人工确认任务进展、候选 Task 和 Risk 均通过 Approval Core 单一命令入口，Fastify 只验证 DTO，不保留业务 SQL 或第二份 `executePmCommand`。核验本次变更没有另造审计表或事件模型，候选只允许由有权限的当前项目人审核；重复 key 回放恰好一个回执，异 payload / 二次新 key 409，正式任务和风险恰好各创建一次；任务进展审核不能直接声称任务完成。静态守卫、PostgreSQL Core 回归、现有编译 API Smoke、Windows/Linux/Docker/文档/安全 CI 均应在最后提交的 SHA 上检查。剩余域路由 SQL、性能和生产实机验证尚未因此关闭。

## 2026-10-17 · V2 整体 /review（Issue #39–#51 与基础交付）

**审查范围与状态：** main `ea2bf32572c378adcf57f25337b38f0ec8a9a235` 及本次 Task Archive 切片。技术核心仍是 Fastify/Next.js/PostgreSQL/Worker 模块化单体、授权命令、事务 Outbox 与人工审批。不会因“所有工作”要求而将尚缺证据的生产验收或未实现功能伪装为完成。

| 工作面 | 已有基础 / 当前审查结论 | 仍需完成及实际阻塞 |
| --- | --- | --- |
| P0 模型出站与人员入职 (#39) | DNS 全量结果/pinning、禁止跳转、注册 bootstrap token、组织邀请码已合并 | 部署侧出站防火墙、TLS/代理/公网攻防与防滥用实测 |
| P1 正式领域 (#48) | Goal/Deliverable/Issue/Decision/Change、Task/Risk 命令和进度审核；本次补 Task Archive/Restore | 完整 WorkItem、基线实施、跨实体命令边界及真实存量 ETL 对账 |
| P2 API/Worker (#49/#4) | Worker 分 lane、Outbox fencing、Task/Risk/Approval 部分 Core 收敛 | server/governance/pm 剩余 SQL、租约续期与并发故障注入、告警 |
| AI PM (#50/#5) | 授权版本、模型调用账本、Evidence/Claim 初级实现、合成黄金集 | 组织级 capability、可执行 Playbook、真实 Provider token/cost/语义评测 |
| 部门/项目集/组合 (#43) | 独立模型、容量守卫、单源 Portfolio/Program pulse | 战略收益、实际资源工时、跨项目依赖历史、优先级 |
| 实时协作 (#40) | 轮询和消息 nonce/seq | SSE 游标/断线恢复/代理流式传输与移动设备 E2E |
| 任务归档 (#42) | 本次新增 Task 原位归档/恢复、历史、权限、工作台与 CI | 全量历史和规模负载、真实浏览器移动端仍未验收；永久删除另需数据保留策略 |
| 发布与运行 (#51/#41/#20/#19/#18/#6) | Docker CI、native builds、容器隔离恢复、备份模板 | Win11/Linux/QNAP 实机、IPv6/HTTPS、签名安装包、离机加密备份与 PITR、完整 V1→V2 ETL、签署 |
| 依赖升级 (#34) | 锁定版本和现有 CI | 分 PR 主版本迁移与生态兼容性矩阵，不能一次未经校验升级 |

**合并门槛。** 本轮 Task Archive 只在最新 Head 五组 CI 和审查记录成功后合并；重大未完成 Issues 保持开放。所有生产实机、真实模型、历史迁移数据和外部签名密钥有关验收，在缺少环境/证据时必须明确标注 *未验收*。不将 CI green 写成生产安全认证。

## ADR-070 · V2 整体 /review 增量：Outbox 租约与陈旧 Worker 拒绝（2026-10-17）

在主分支 `d7f56a20e6dd5bce42853a0d208a7e3b52014b13` 和仍开放的 #4/#49/#51 审查中，确认之前的五分钟 lease 只在领取和 `assertEventClaim` 事务发布时生效；长模型调用不续租，`finishEvent/failEvent` 又缺少有效租约时间边界。决定单一常量统一所有租约状态修改，并仅针对慢模型调用引入在途 heartbeat。最重要的安全契约不是“网络调用恰好一次”，而是 **旧 Worker 不得确认、失败重排或发表正式结果**。外部模型请求已经执行时，不能保证及时撤销收费。

逐项审查：不改变历史迁移或 Outbox 结构；不使用未验证的代理/Redis；每次续租带有 event/project/token 和已生效租约条件；过期、终态、dead letter 状态拒绝；`FOR UPDATE` 发布和事务内审计原子性保持；heartbeat 异常仅表示无法续约，不能提升数据写入授权；Worker 停机等在途定时器释放，避免独立后台续约。用真实 PostgreSQL 的 expired/reclaim/retry/replay/锁并发以及现有 Docker、native、API Smoke 作为门禁。

**整体状态仍未完结。** #4 还需真实多进程故障注入和主动告警；#39/QNAP IPv6 公网安全、#40 SSE/移动端、#43 PMP 收益/跨项目依赖、#48/#49 全域 Core 收敛、#50 AI Playbook/实测、#51 生产迁移/DR、#18/#19/#20 本地安装/PITR/签名打包均仍有明确缺口。只有本 PR 最新 Head 的 Product/Docs/Native/Docker/Security CI 和未解决 Review Threads 门禁通过，才允许合并本增量。

## ADR-071 · Outbox 运维端点 /review（2026-10-17）

原运维诊断采用 HTTP 两步授权与读取，撤权后可能在其他连接继续返回项目死信记录；原 dead-letter retry 还在 Fastify 维护领域 SQL。已改为 Core 唯一读取与恢复入口：单事务 REPEATABLE READ + 即时 Tenant/Project 成员行锁和 operations.manage 权限，复用现有 Outbox SQL；重试由 executePmCommand 保证原子审计/事件/回执与版本。未新增第二套运维事实表或兼容 API。

验收要求：架构守卫不允许 operations-routes.ts 再引入领域 SQL；PostgreSQL 核验非 Owner、跨租户、撤权、同键重放、真实二次恢复版本；编译版 API Smoke 与最新提交完整 CI 通过后合并。

整体 V2 仍有开放事项：#4 的主动告警和真实故障注入、#39 公网/模型出站实机攻防、#40 SSE/移动端、#43 跨项目收益与依赖、#48/#49 其余正式业务和路由模块所有权、#50 AI Playbook 与真实供应商评测、#51 存量数据 ETL/灾备验收以及 #18/#19/#20 本地安装、PITR 和签名发布。不得因该切片合并宣布全部完成或生产就绪。

## ADR-072 · Reporting 领域单一所有权审查（2026-10-17）

对 main 6b9158b892bd10cc0e6d7a4059a3ec178887f935 复核发现：Report 列表在 Fastify 先鉴权再借独立数据库连接读取，存在撤权竞态；生成和发布业务 SQL 仍滞留 HTTP 层。此次改用 Reporting Core 的单事务授权查询与 executePmCommand 正式命令入口，保持 API 与历史 SQL migration 不变，也不引入第二套报表存储。静态边界、真实 PostgreSQL 需要检查权限、跨租户/跨项目、同键回放、发布版本及正文不可变、组织成员撤权；最新提交五组 CI 与未解决 Review threads 是合并门槛。

整体 V2 仍有明确未完成工作：#39 公网模型出站与注册运行验证；#40 SSE 与移动端恢复；#43 组合收益、跨项目依赖和资源容量；#48/#49 其余领域与业务路由；#50 Evidence/Playbook 与真实模型评测；#51 存量数据迁移、PITR 和设备验收；#18/#19/#20 原生签名、加密离机备份；#4 主动告警和多进程故障注入。不能将局部 PR 成功当作生产安全或全部交付完成。
 
## ADR-073 · /review：消息推送必须可恢复、可撤权、不可跨项目（2026-10-17）

审查 Issue #40 与当前消息 API/Web，确认新 SSE 不能借已有服务端轮询而宣称完整实时方案：需以唯一 PostgreSQL 消息 seq 为游标，避免数据库事务尚未提交时漏序；所有历史/增量读必须在同事务重新锁定当前 Tenant+Project 身份；流初次和每一批都要核验 Session，支持 Last-Event-ID、有界补拉、慢客户端背压与断线清理；同源代理不得缓冲/强制 30 秒中断；Web 需保持弱网络补拉及后台暂停。此次选择中小团队可验证的 2.5 秒服务器轮询 SSE，不提前建 Redis/Kafka/多实例广播层；压力数据不足时不虚构吞吐。

CI 须验证 PostgreSQL 游标 200 条边界、25 条更早记录、跨项目与撤权；编译版 Fastify SSE 第一次订阅、非法游标、Last-Event-ID 续传及登出终止；浏览器 SSE 使用和 Next 流式代理静态检查、生产 Web 构建。生产反向代理、移动端安全区、多人共享 NAT 与大规模长连实测仍未完成。全局 V2 状态：#39 模型公网安全，#43 项目集/组合收益，#48/#49 全域正式命令，#50 AI Playbook/真实模型评测，#51 迁移/灾备/实机，以及 #4 外部主动报警和 #18/#19/#20 原生/备份/签名验收保持开放。不得将此次 PR 视为全部交付。

## ADR-075 · 最新主干增量 /review 与全局未关闭风险（2026-10-17）

基线：#101 已合并的主干 `885a05f`。此次代码审查覆盖项目导航和正式 PM 读链路，发现 `pm-routes.ts` 仍有三个 HTTP 先查组织/项目成员、再用另一数据库连接读取历史/依赖的窗口，以及项目列表 SQL 与 Core 所有权分散。变更统一到 Core，沿用 `withProjectRead` 和单事务数据库授权；两个历史接口保留 50+1 页游标、明确 PostgreSQL int 范围。静态检查禁止 GET 路由恢复直接业务 SQL，PostgreSQL 测试必须覆盖可见实体、异项目目标、观察者、两层撤权、翻页与非法游标。是否真正通过以本 PR 最新 Head GitHub Actions 为准，未执行的运行环境测试不能填写通过。

**整体架构选择仍成立：** Fastify/Next.js/PostgreSQL/独立 Worker 的模块化单体保持低部署复杂度；正式 Task/Risk/PM 事实只可由后端授权命令修改；AI 候选/证据不自动改变验收状态；Outbox 与事件持久化于同一数据库，不引入多套队列或无需求的微服务。不为了“拓展性”增加无实例支持的 Repository 框架或历史接口兼容层。

**目前剩余风险按交付门槛区分：** P0：#39 公网出站策略、DNS/SSRF 与邀请注册的实网验证；P1：#48 的 PM 命令 SQL/Owner 单源、#49 的剩余 HTTP 模块和真实多 Worker 崩溃恢复、#4 主动告警；P2：#50/#5 AI 多轮证据追问和真实模型评测、#43 PMP 项目集/组合收益与资源容量、#40 真机移动端/SSE 网关压力；发布：#51 V2 数据转换/异机灾备和 #18/#19/#20/#41 的 Windows/Linux/QNAP、加密离机、PITR、签名产物与公网 HTTPS 验收；#34 主版本依赖升级需独立变更。Issue #42 任务归档 Core 能力已存在，但剩余设备/权限验收未完成，不以“代码存在”代替结项。

**合并条件：** 固定本 PR 的最终 Head SHA；Product verification（TypeScript、真实 PostgreSQL、架构、编译 API Smoke、Web build）、Documentation governance、native Windows/Linux、Docker deployment/restore drill、Security scanning 五组工作流全部 success，无未解决阻断线程，确认 main 未漂移，再允许 Squash Merge。无真实设备与模型凭据的验收一律保持开放，不声称整体 V2 / 生产就绪。

## ADR-076 · PM 全写入路由的模块所有权 /review（2026-10-17）

本次审查将 `pm-routes.ts` 的八类变更全量与 `governance/pm-register-commands.ts` 逐项比对，核心要求：SQL 表名必须来自固定 Schema/字段规格，HTTP 不参与 CommandReceipt/DomainEvent/Outbox；所有写入继续使用唯一 `executePmCommand` 当前身份锁、幂等与审计事务。交付物改派后旧提交失效、提交人与审核人分离，Issue 不能无理由解决/重开，Change 审批不可自批且实施需要有效负责人真实项目消息证据，依赖防环路及已完成任务前置约束不能因重构消失。无 V1/V2 双命令、无旧路由兼容层、无新表。

回归门禁：真实 PostgreSQL Core 集成 + 原编译版 API Smoke 保留业务和越权语义；静态测试确保 Fastify 不再拥有 `executePmCommand` 或直接 PM SQL；新 PR 最终 Head 的 Product/Docs/Windows+Linux/Docker/Security 五项全 success、Review threads 无阻断和 main 未漂移后才能 Squash Merge。此处是 #48/#49 的 PM 命令归属完成切片，**不是**全系统完工：Project Owner 双来源、组织部分查询、主动运维告警、多 Worker 故障、PMP 跨项目收益/容量、AI Playbook/真实评测、生产 HTTPS/Win11/QNAP/PITR/签名包/迁移均仍有独立门槛。

## ADR-077 · /review 项目治理完整路由检查（2026-10-17）

基线为主干 PR #103 合并提交 `c280798`。审查发现 `project-governance-routes.ts` 六个入口中五类写操作仍包含项目成员、Owner 和设置的业务 SQL，且成员列表使用 HTTP 单独授权再二次查询。通过将 SQL 所有权移交 `identity/project-governance.ts`，复用同一 `withProjectRead` 权限快照与 `executePmCommand` 事务边界，使 API 仅负责参数转换；没有改写任何已发布 migration、URL、返回结构或数据模型。

/review 必须核对：每个 GET/POST/PATCH/DELETE 只委托一次 Core；观察者/跨项目/撤权不可读取成员名单或变更成员；角色从 member 降级及移除必须使用相同的五项未清责任判定；有效任务、交付物、风险、变更与资源的状态约束不能因共用查询丢失；旧 Owner 的幂等重放须与新 Owner 权限严格分离；设置的 AI 禁用与时段无效输入不能留下假的审计/事件。真实 PostgreSQL 直接调用、HTTP Smoke、Schema migration 双跑、Static boundary、TypeScript、Web 和五组最终 SHA CI 均为合并门禁。

**剩余待做（不以本 PR 关闭）：** #48 的 Owner 冗余存储/全域正式聚合统一、#49 组织治理及其它路由/Worker 故障注入、#39 真实模型出站安全、#4 主动告警、#50 模型 Evidence/Playbook、#43 跨项目收益容量、#51 实机迁移和备份，以及 #18/#19/#20/#41 的原生/公网/签名发行验证。不能因单一 Core 重构声称全部完工或生产就绪。

**新增缺陷与验证：** 本轮横向检查 `resource-allocation.ts`，确认原来的项目资格只判断成员存在，遗漏观察者角色，可能在降级后再次安排执行资源。已收紧为非 observer，并复用既有 Tenant advisory + Target ProjectMember FOR SHARE，避免与角色 FOR UPDATE 并发逃逸。PostgreSQL 集成应在角色降级后实际尝试新的组织资源分配并断言拒绝，静态守卫必须长期保留此谓词。未得到最新 Head CI 成功以前不视作通过。

## ADR-078 · Owner Authority 全域 /review（2026-10-17）

**范围与不变量。** 旧双重 Owner 身份已在 Project 创建/导航/详情、Identity 移交命令、DB 迁移、真实测试夹具、编译 HTTP Smoke 搜查；选择 `project_members.role='owner'` 单源、`ownership_revision` 独立版本，否决镜像列和双向触发器。正式迁移必须先确认每个旧 project 的 owner_id 与 owner role 匹配；不一致则 SQL 事务中止、不可吞错、不可静默重设。延期检查允许事务内移交临时无 Owner，但禁止提交后 0 Owner；旧部分唯一索引阻止同项目第二 Owner。项目删除可级联；跨项目、跨租户和 revoked tenant 仍以服务器当前授权为准。客户端的 owner_id 只是唯一角色的派生查询字段，不是兼容数据库字段。

**CI 与审计。** 旧 Raw fixture 的项目创建必须和唯一 Owner INSERT 同一 SQL 语句，否则 commit-time DB trigger 故意拒绝；如果测试手动插入重复 Owner 使用 ON CONFLICT DO NOTHING，不创建替代身份。真实 PostgreSQL 测试、强制单源架构守卫、迁移双跑、Owner 版本/重放、原有 API Smoke、Native/Docker、文档与安全扫描作为最新 Head 合并门禁；无阻断审查线程才可 Merge。真实旧数据/生产停写/异地快照、PITR 和原生 OS 设备检查不由 CI 代替。

**整体未完成：** #48 尚有其它历史 Task/正式领域对齐、#49 尚有 API/Worker 故障注入、#39 第三方真实 DNS/出站网络验收、#50 模型 Evidence/Playbook、#43 PMP 组合收益/跨项目容量、#51 V2 一次性数据迁移和真正跨平台发布验收；#4 主动告警、#18/#19/#20/#41 的系统服务、恢复、安装包、QNAP 及公网 HTTPS 同样独立开放。

## ADR-079 · Tenant Governance 模块整体 /review（2026-10-17）

最新主干基线为 #105 的 Owner 单源合并提交 `b42f6ad`。审查发现组织治理 Fastify 路由仍有八个事务回调和正式 SQL、成员/资源 GET 先鉴权再跨连接读取，权限检查与 Core 的当前授权不处于同一快照。已将全部写入统一到 `governance/tenant-commands.ts` 的 `organizationCommand`，将两类敏感 GET 委托 `tenant-queries.ts` 的 `withTenantAdminRead`，消除 HTTP 业务 SQL 和 TOCTOU 窗口。原消息/项目/成员/部门/组合/项目集的实体边界、角色变更约束、资金/资源审核语义与完整 REST DTO 均不引入新兼容层。

审查测试焦点：非管理员和跨租户不能读姓名、邮箱和资源数据；创建部门/Program/Portfolio 的租户 FK 强制隔离；有效组织成员可以按管理员策略加入，不得凭邮件绕过邀请码策略；组织管理员降级后原命令同键重放只读，新命令拒绝；最后一名管理员不能被降级；资源分配在共享 Tenant advisory lock 下阻止超额、observer、跨项目/跨租户、取消后不可重复取消。成功命令仅写一次组织回执和审计，失败命令事务回滚；版本化 Project Owner 单源规则继承 ADR-078。编译版 API Smoke 和五组最新 Head CI、未解决审查线程、主干漂移验证均作为合并门禁。

**仍需保留的生产风险：** #48 旧领域和正式 PM 生命周期完整整合、#49 多 Worker 故障注入及剩余 API 服务 SQL、#43 PMP 收益/资源历史、#39 公网 DNS/SSRF 真实流量安全、#50 AI 证据/干预与真实模型评测、#51 存量库 ETL/离机快照/Win11-Linux-QNAP/HTTPS/PITR/签名发布。尚无这些实测证据时不可标项目整体完成。

## ADR-080 · Worker 健康误报与主动监控 /review（2026-10-17）

从合并后的 `main` `db5021d` 完整检查 Worker/Outbox/Doctor。发现 Worker 三条 independent lane 都调用 `recordWorkerHeartbeat(succeeded)`，聚合写 `worker_health('default')`；因此事件/AI/Outbox 失败后，提醒频繁成功会覆盖最近成功时间，造成健康误报。已修改 Worker 使用唯一 `WorkerLane` 类型，心跳在 PostgreSQL 中按 lane 独立；`029_worker_lane_health.sql` 显式删除旧共享遥测，禁止旧行。Doctor 仍在同一受控本地运维入口读取，按 lane 阈值与最后失败时间分别产出错误码。既有 Linux 计划任务保留，Windows 增加单独 LocalService 诊断任务安装脚本（绝不嵌密钥）。

/review 验证：某通道失败、其它通道健康时需 unhealthy；失败后独立成功恢复需 healthy；陈旧/缺失 lane 必须 fail closed；重复迁移 checksum、Worker 架构 guard、真实 PostgreSQL 记录、Unit Ops、构建、Docker 及 Windows/Linux 检查最新 SHA 均成功、零未解决审查线程才合并。后台 AI 模型实际提供商、多 Worker 崩溃竞态、外部告警通道和生产任务调度实机运行尚无完成证据，#4/#49/#51 不得关闭。

## ADR-081 · 账户注册、登录、组织导航边界 /review（2026-10-17）

以已合并主干 #107 的提交 `086efe0` 为新基线，复核 `server.ts` 后发现账户自注册事务、密码验证、注册资格、当前账号资料与租户导航仍由 HTTP 持有业务 SQL。现将五个入口下沉 `identity/account-services.ts` 复用唯一 RegistrationPolicy、Security 密码逻辑和 PostgreSQL；API 只保留 Zod/认证 Cookie/Origin/限流，不新设兼容 API、缓存在先 RBAC、用户角色镜像或第二事务管理器。认证失败返回先前 401 与相同中文信息；注册仍以唯一 bootstrap 锁及数据库 email UNIQUE 防竞态，用户/组织/管理员原子写入。

**验收门禁。** 真实数据库 Core 测试核验正确与错误密码、密码 hash 不进入公开返回、重复邮箱事务回滚、跨组织不可见、用户总管理员状态当前值、组织资格撤销后导航消失；历史 bootstrap 并发 race 测试、前端同源 Cookie/Origin、编译 API Smoke 与全部五组 CI 保留。静态架构守卫禁止新业务查询回流 HTTP。未得到最新 Head Product、Docs、Native、Docker、Security 全绿、主干未漂移和审查线程 0 之前不合并。

**尚未解决：** #49 其它领域 API/Worker 故障、#39 QNAP/IPv6 公网网络及注册风控、#50 AI 能力审批与真实模型、#51 Win11/Linux 实机及迁移恢复。模块收敛不代表所有需求已实现或可直接投入生产。

## ADR-082 · 模型 Docker 网关信任边界 /review（2026-10-17）

从合并后主干 `183735f` 审核 P0 #39 的 ModelEndpointPolicy、ModelEgress、HTTP Catalog、StructuredLLM、API 管理员模型配置和生产 Compose。已有：禁止嵌密钥 URL/非本地明文 HTTP、解析全量 A/AAAA 并拒绝任何公网模型混合私网返回、HTTP socket 使用校验过的固定地址、禁止重定向/代理、保护上游凭据与响应限制。缺陷在于：`host.docker.internal` 把整个 RFC1918/ULA 私网当作可信出口，第一跳 DNS 被改为另一个私网 IP 时仍会发送请求和模型 Bearer Key。不能仅靠“DNS 查询只执行一次”证明服务身份。

采用 `MODEL_DOCKER_GATEWAY_IPS` **精确 IP 字面名单**作为唯一部署信任锚；漏配即在 DNS 前拒绝，错配/包含不可信地址及 A/AAAA 中混入其他内网地址直接拒绝，Node socket 仍 PIN 已验证结果。不保留旧“整个内网均可信”的兼容后门。API/Worker 共享原 `model-egress.ts` 与配置变量，Compose 加真实 host-gateway 别名，Web 仍不持有模型配置。回归测试覆盖合法与恶意网关、IPv4/IPv6、地址家族一致性、重定向/敏感头/大体积响应及结构化调用；架构静态守卫防止绕过。文档说明网关变动需人工重新核验，真实 QNAP/Win11/Linux/公网出站实测不由 CI 绿灯取代。PR 必须五组最新 HEAD 检查与未解决 Review 线程零个，主干无漂移才能合并。

其它开放安全问题：公开部署邀请和账号滥用的针对性攻防、真实模型出口封锁策略、宿主机内部 DNS 污染与代理、全链路 HTTPS、密钥/日志、部署级 TLS/防火墙验证。不声称 #39 或 #51 全部完成。

## ADR-083 · 邀请邮箱敏感读取 /review（2026-10-17）

以 #109 已合并后 `main` `db624a2` 为基线，复查所有邀请管理员路由及现有 ADR-079 的组织成员敏感读取。发现 GET /tenants/:tenantId/invitations 在 HTTP 先 `requireTenant(admin)` 后跨连接 `pool.query`，若管理员在此期间撤权，将暴露当前不再授权的邀请邮箱；POST 签发/撤销也有不必要的旧角色预检查（真实写授权已由 `organizationCommand` 同事务重做）。本 PR 提取原共享查询为 `identity/tenant-admin-read.ts` 单源授权助手，三类组织敏感 GET 与邀请元数据均在同一 REPEATABLE READ DB 快照及 `FOR SHARE` 当前管理员行锁内执行；HTTP 只有 Session/UUID/DTO。签发/撤销保留原命令 receipt、审计、邀请 digest 与单次接受，取消重复 HTTP 预检查，未创建新兼容路径。

测试覆盖管理/普通/跨租户读取、密文摘要不泄露、管理员撤权行锁竞态导致拒绝、撤权后无读/写权限，已有邀请单次接受/重复领取/过期/撤销与 Fastify API Smoke/原生/Docker 也必须通过。静态架构守卫保护唯一权限 helper 与路由薄边界；CI/审查清零后方可合并。该 PR 不声称 #39 公网注册风控、#41 QNAP/IPv6 真实网络、#51 生产安装/备份恢复验收完整完成。

## ADR-084 · 总管理员模型配置/凭据读取一致性 /review（2026-10-17）

从 #110 合并后主干 `797f966` 全面检查管理员模型管理 Fastify、Core 模型目录、Project 模型解析、注册与组织管理员事务授权。发现 GET /admin/ai/providers、GET /admin/ai/models、POST /admin/ai/providers/:id/discover 先 `requireSystemAdmin` 再 `pool.query`；POST /admin/ai/models/:id/test 在计费冷却的管理员授权事务外已先读取、解密模型 API Key。此权限检查与读取的跨连接 TOCTOU 窗口不符合先前 ADR-079/083 单源事务权限设计。

方案统一沿用已有 `systemAdminTransaction`，给三个受保护查询函数显式传入 DbClient，移除模型 HTTP 多余 `requireSystemAdmin`。目录探测与模型 quick/full 测试只在**完成**管理员授权数据库事务后发出远程调用，不持有锁过外部等待；模型调用仍受安全 HTTP/DNS 解析及额度策略约束。所有模型写操作保留原同事务审计和权限锁，未增加 DB 表或向前端开放模型配置。实测包括非管理员拒绝、当前授权读与降权互斥、管理员降权后的列表/密钥读取拒绝、密钥不出现在 DTO、模型配置读取与 30 秒冷却原子、静态架构守卫、原正式模型/Web/API/Worker/Win/Linux/Docker/Security 回归。合并时以最新 Head 五组 CI 全绿、审查线程零和 main 未漂移为门禁。

**保留风险：** 已授权模型测试在数据库事务关闭后开始真实网络请求，调用期间发生撤权不能撤销已经在传输中的 HTTP 请求；正式生产需要独立的可信出口网络隔离、密钥轮换/吊销、账单上限、真实模型/代理流量测试与值班机制。#39/#49/#50/#51 的未完成事项不因本切片合并而关闭。

**CI /review 修复：** 第一轮静态架构守卫仍断言旧 7 次管理员业务事务，新增的三个敏感读使其过时；已升级为检查 10 个受控事务入口及模型测试的冷却写入。编译 API 冒烟进一步发现非管理员传入不完整模型 POST 参数时错误码由原 403 退化成 400，根因是 Zod 校验抢在 Core 当前授权之前；现把模型写请求体与探针 mode 的 Zod 校验放入授权事务内（并保持外部模型网络调用在事务结束后），恢复拒绝优先的安全约束，并由原 Smoke 固化。

## ADR-085 · 模型管理命令/API 边界全域 /review（2026-10-17）

接续 #111 合并主干 `1424ce0`，逐条复查管理员模型 GET/POST/PUT/DELETE/导入/探针。之前统一了敏感读取 Core 权限事务，但供应商/模型七个变更路由与模型测试冷却仍散落业务 SQL、审计写入与 Zod schema：重复 `systemAdminTransaction` 回调增加权限检查、审计来源分叉及新接口遗漏风险。本 PR 将七个模型 CRUD/导入和探针冷却共八项归入 `identity/platform-model-commands.ts`，原 `project-model.ts` 唯一存储与加密规则保持，平台管理路由只处理 Session、UUID、HTTP DTO/响应与经过批准的目录/模型网络探针。原系统审计 kind、metadata、删除保护、批量导入 skip 及模型 30 秒计费冷却均保留，不新增数据库列/历史兼容层。

**权限/事务重点：** 所有模型管理操作必须从当前总管理员行锁进入，未经授权的畸形 body 也直接 403，合法管理员参数错误才 400；密钥不入公有响应/审计。目录发现凭据同事务查询、出站安全客户端固定 DNS/SSRF，模型测试冷却事务完成后才发起可能 60 秒的远程请求。真实 PostgreSQL 覆盖全生命周期、审计计数/不含 Key、批量导入、删除带关联阻断、角色撤销拒绝、冷却 429 以及原 HTTP smoke。静态架构守卫禁止将 schema/SQL 和模型写路径重新塞回 API，原模型目录、原生 Win/Linux、Docker、Docs、安全扫描在最新 Head 全绿并零未解决线程才合并。

**尚存** #39 真实模型网络、安全出站、密钥泄漏及公网注册滥用、#49 剩余 API/Worker 模块与故障恢复、#50 模型授权和 Playbook 评测、#51 Windows/QNAP/Linux/PITR 正式现场验收；此改造不能代替任何现场生产就绪结论。

## ADR-086 · Outbox 租约与运维错误归因 /review（2026-10-18）

在已合并 `main` `5ec8b26` 上复核 `outbox.ts`、AI Worker、Doctor、PostgreSQL lease/fencing 和现有 CI。确认租约续期已有完整正式实现（300 秒租约/60 秒 heartbeat、claim token、发布事务 `FOR UPDATE` 栅栏、单次 claim 避免后续 AI 被预领过期）；该项不应重复设计/虚构不存在。真正诊断缺口是 Doctor 将 **所有超过十分钟 next_attempt_at 的未处理记录**算作排队逾期，不区分已领取且正在安全续期的模型长事务。它也没有针对长时间停止续期的 claim 与大量已失败待重试的独立告警项。

采用单一 `OUTBOX_HEALTH_SQL` 对未处理数据进行只读 PostgreSQL 聚合：未领取且超时才 `OUTBOX_OVERDUE`；未续期逾十分钟 `OUTBOX_STALLED_CLAIM`；正可执行且此前失败达十件 `OUTBOX_RETRY_READY_PRESSURE`；死信原样告警，缺少指标 `OUTBOX_TELEMETRY_INVALID`。阈值放在唯一 `OUTBOX_QUEUE_THRESHOLDS`，避免在 SQL、测试和部署脚本内各定义一次不同的诊断规则；正式 Outbox lease TTL 不变，故障恢复仍由 Worker 负责。真实 PostgreSQL 测试直接执行相同 SQL：心跳生效的旧事件不误报，日预算推迟/已处理不误报，真实未领取逾期、超时租约、十条 429 待重试、死信分别分流，清理后恢复。原完整 Outbox 故障与授权集成、Ops 单元、架构守卫、Docker、Native 和安全扫描都纳入最新 Head 验收。

**未宣称：** 未来的线下压测 SLA、失败率时间窗、跨实例混沌故障注入、模型真实限流与故障时密钥处理、任务调度器长期停止运行告警和外部邮箱/IM/PagerDuty 送达。#4/#49/#51 的这些生产验收仍开放。

## ADR-087 · 实时 SSE 半开流与连接名额 /review（2026-10-18）

在 #113 已合并主干 `a077a5a` 上复核 `apps/api/src/message-stream-routes.ts`、Next 同源流式代理、Web EventSource 重连及编译 API Smoke。现有连接最大 3 条/用户、会话每次推送重验、项目内容分页、游标/Last-Event-ID 和 close 时清理机制都合理；发现 `raw.write(chunk)===false` 时原 Promise 仅监听 `drain` 或 `close`，如果客户端不读却迟迟无 TCP FIN、服务器也不再发 drain，Promise 永远不完成，`pump` busy 且用户连接名额无法自动回收。移动网络和共享 NAT 环境下将放大连接饥饿，不能以浏览器端重连代替服务器清理。

修复把慢写等待抽到唯一 `writeSseFrame`，10 秒有界 deadline，清理 drain/close 监听器与 timeout。客户端 close 或截止均令路由释放 `activeStreams`、关闭流与定时器并销毁 socket；成功 drain 继续按原数据库序号发送和更新 cursor。Ping 拒绝写入亦有 catch 防止漏掉未处理 rejection。新增 fake stream 的即时、异步 drain、远端 close、半开超时、监听器清理回归，静态架构检查固定泄漏防护，原 API Smoke 的真实 Last-Event-ID、跨项目拒绝、注销关闭和 Docker/Web/Native 五组 CI 须最新 Head 通过、未解决审查线程为 0、主干无漂移才合并。无需新服务、数据库迁移或历史兼容端点。

**剩余：** 流背压截止不提供消息已读回执，不证明每个移动网络断线客户端丢包为零；移动真实设备、浏览器长时间后台、反向代理超时与压测资源预算以及跨实例全局 SSE 配额、录像/实机 CI 仍为 #40/#51 未完成验收。


## /review · 自主企业微信 IM 独立接入切片（2026-10-25）

本批审查 `packages/im`、Core IM 身份/数据库与投递、Fastify 受保护路由、Worker 多实例连接、Web 基础配置与 SDK 依赖。经实际 PR #120 CI，TypeScript、Windows/Linux、PostgreSQL 集成测试、生产安全审计、CodeQL、Docker 构建及文档门禁均作为合并准入项；最终结果以**实际合并的 HEAD SHA** 为准。

已发现并修复：SDK 默认日志打印群消息原文；未认证连接的早期回调；AES-GCM 在 `final()` 前调用 `getAuthTag()`；测试基于 Zod v3 错误字符串而不适配安全更新后的 Zod v4；多 Worker 同时连接相同 Bot；非 IM Leader Worker 争抢 Outbox 的风险。

**关键未关闭门槛：** 真实企业微信机器人配置、测试企业内人员/项目群绑定、群消息入库到风险提议/人工审批/催办/周报完整闭环；Harness 插件化模型与专业 PM 工具替换；绑定和审计的真实浏览器与多 Worker 故障注入；人工处理未知投递、凭据轮换、跨群资料范围授权与会话存档合规。这些缺口由 #121 管理，不得将当前 experimental IM 当成生产级发布。固定 PostgreSQL 同一部署 Leader 会话锁仅适用于 session affinity，不能被当成分区网络下 exactly-once 发送证明。
