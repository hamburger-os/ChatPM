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

核心 API / Web 的完整领域拆分、企业 SSO、组织管理、Owner 转移、全设备会话撤销、实时消息与附件、AI 长时记忆、策略分级引擎、本地模型、多提供商、真正历史周期报表、完整 SaaS 和生产级自部署、备份恢复与故障注入测试仍属于未交付工作。

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
