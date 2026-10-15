# 实施状态与交付缺口

**产品状态：** 实验性原型，可本地运行；生产级安全、隐私、稳定性及完整功能尚未验收。此处为实现覆盖的单一事实入口，不维护历史版本日志。

| 领域 | 当前能力 | 仍需实现或验证 |
|---|---|---|
| 身份和租户 | 邮箱注册、显式租户选定、可撤销 JWT 会话、项目成员加入及移除 | 邮件邀请与接受、Owner 转移、SSO、会话清理（已新增部门、组合、项目集与组织级角色操作） |
| 消息 | 持久化、项目内提交有序游标、nonce 幂等、轮询 | 完整历史分页、SSE/实时推送、文件、编辑撤回 |
| AI | 需负责人主动启用外部模型；系统管理员统一配置 Responses/Chat Completions 模型，项目独立授权启用；候选任务/风险、显式引用澄清、人工审批、项目 UTC 日调用计数（Docker 可配置限额，不等于费用预算） | 真实 DeepSeek/本地模型联调、管理员模型配置真实供应商能力评估、长时记忆、无引用语义关联、真实模型质量/隐私/成本评估 |
| 工作和风险 | 任务状态与版本并发控制、成员更新、风险候选审核 | 里程碑、依赖、正式风险升级和关闭流程 |
| 自动化 | 工作时间、工作日、冷却、持久计划、Outbox 退避/死信/人工重放 | 假日日历、主动运维报警、长任务租约心跳与规模化压测 |
| 汇报 | 当前项目快照的周/月草稿、人工发布、发布后不可覆写 | 历史周期差异、可编辑草稿、证据引用和统计基线 |
| 运维和部署 | PostgreSQL 开发环境、生产构建入口、同源 API 代理、完整 Compose 示例、原生系统服务配置、跨平台编译 CI、备份/恢复命令 | Windows/Linux 安装实测、服务故障恢复、真实备份/恢复演练、生产 HTTPS/安全验收、SaaS 运营、数据删除导出 |

## 正式发布门槛

权限撤销与项目隔离回归、真实模型及提示注入评测、备份恢复、生产配置检查、可观测告警、端到端部署、数据保留和删除政策必须有可复现验证。CI 通过只证明覆盖的测试通过。

## 已确定的方向

通用项目团队；一套核心支持未来官方 SaaS 和自部署；AI 的执行权限由后端分级策略约束；云端与本地模型同等重视；首发优先完整的聊天—确认—跟进—汇报闭环；使用 Apache-2.0 授权。进度以 [路线图](roadmap-acceptance.md) 和 Issues 跟踪。

## 项目列表配置契约

`GET /projects` 必须包含工作时间 `work_start`、`work_end` 和提醒冷却 `cooldown_hours`（未设置时显式返回 `null`），供 Web 端初始化项目设置。缺失字段会使客户端提交不完整的提醒策略并被服务端拒绝。API smoke test 覆盖创建后和保存设置后的列表字段。

## 本地协作测试反馈与 ADR-021
这次交付范围：发送框响应式修复、独立提醒设置与帮助文本、Owner 可配置/测试固定供应商模型、模型输出与输入预算基础参数、近期项目上下文组装、明确和唯一短时自然澄清关联、AI 分析/错误状态与可主动召唤的只读回复。仍不具备完整 Pi Agent 的工具系统、长期语义记忆/模型摘要压缩、可证明的成本预测或真实供应商全模型认证。

## ADR-022 实机问题修复阶段
新增任务关联与人工可审核进度建议、基于项目日历的到期日期、提前提醒策略、模型能力预算、Schema 错误分流、响应式滚动和成员表单。真正的基于依赖网络的跨任务关键路径分析、可独立调度的多步 Agent、百万 Token 上下文压缩与真实 DeepSeek 端到端调用仍需要专项工程及实测，不得等同于此阶段功能。

## ADR-023 组织治理阶段
已实现独立部门、项目集、项目组合及资源投入记录；全局 AI 配置由系统管理员控制，普通项目不可见凭据；新增 manager/observer 项目角色和前端独立登录检查。仍无邮件邀请/接受、复杂资源冲突计划、企业 SSO、多供应商端到端兼容性认证与生产环境渗透验收。

## ADR-024 导航与供应商中心
新增最左侧项目/组织/系统/账户导航，原项目右侧保留项目上下文操作；系统管理员页面拆分供应商连接与模型（同连接多模型），不再通过 `.env` 配置供应商凭据。009 迁移搬迁既有 Key 密文，根加密密钥仍由服务器运行环境保管。原生 Anthropic Messages、通用模型列表发现、模型能力自动识别和生产 DNS/SSRF 防护仍未交付。

## ADR-025 · 管理交互与多人试运行改进
系统 AI 供应商新建采用显式空白模式和表单聚焦；桌面导航、登录页改用自有 ChatPM 标志，窄屏消息/任务工作台切换；后台标签页减少请求，工作台 15 秒刷新并暂停隐藏页面；API 对签名会话按登录主体配额分桶（登录注册继续基于服务所见源 IP 严格限流）。生产级 SSE、端到端移动设备测试、QNAP IPv6/HTTPS/证书与容器内网络联通实测、SSRF/DNS 出站隔离、公众注册策略及规模压测**仍未完成**。

## ADR-029 · 本次合并切片

已落地：V2 模块/命令/AI 授权/Playbook 目标设计与 ADR；组织管理的全部现有写入路径使用事务命令，在事务内复核管理员身份，与组织审计同成败；新增数据库集成回归。尚未落地：全域 CommandReceipt/DomainEvent、正式 Goal/Deliverable/Issue/Decision/Change、WorkItem 验收流程、独立 Worker runner、ModelInvocation 账本、可执行版本 Playbook、正式 V2 数据转换与全量 E2E。上述目标详见 [分期路线图](v2-delivery-plan.md)，不应按设计文档数量计为完成。

## ADR-030 · 正式项目管理登记簿与命令切片

已在本次分支增加新增迁移 012_pm_domain.sql（不更改存量迁移）及受保护项目 API：目标、里程碑、交付物、问题、决策、变更申请、任务依赖；交付物可由当前被指派人员提交、由 owner/manager 独立验收/退回；变更审批仅 owner，且不可自批；同项目任务依赖阻止自环、环路。新 PM API 使用事务内的项目/租户成员双重鉴权、幂等回执、审计、领域事件、Outbox；Worker 识别并确认记录型 domain.changed，不允许 AI 自动提交。项目原有 Task/Risk/Proposal 接口**暂未统一迁移**，完整 WorkItem 命令标准化、风险处理工作流、跨项目资源冲突、验收 Web 专门界面、模型干预仍未实现。实际测试/CI 结果以对应 PR Head 为准，不能把此条当作验证通过证明。

## ADR-031 · 项目治理工作台界面

已增加项目工作台「项目治理」页签，复用服务端正式登记簿 API，角色分级显示创建、交付物提交/独立验收、关键变更审批和任务依赖登记。当前是项目侧栏入口，不是独立大型组合看板；每次实际写入依赖服务端授权与幂等命令。复杂问题/风险响应流、基线联动、跨项目资源优化、AI Playbook 主动控制仍未完成。仅当 PR CI/实机验收对应检查通过才能宣称相应验证完成。

## ADR-032 · 版本化 AI 启用与逐次模型调用流水

新增迁移 013_ai_authorization_ledger.sql：以 `projects.ai_enabled` 为唯一有效启用状态，由数据库触发器只在状态变化时增加 ai_authorization_version；每次实际模型请求前重新校验启用状态和授权版本。独立 ai_model_invocations 记录每次尝试的脱敏模型身份、Prompt 版本、授权版本、HMAC 输入指纹、状态、延时及脱敏错误；没有供应商报告的 token 用量是 null，不能等同精确费用。只有项目 Owner 可通过 API 查看授权版本与流水。**剩余：** 版本化细粒度能力许可、组织级出站敏感数据策略、全量 PM Playbook/干预、模型 usage/成本、网络级强制撤权及生产出站防火墙均未实现。自动化核验必须以本 PR 最终 Head 的 CI 为准。

## ADR-033 · Worker 运行入口与领域 Runner 分离

已将 Outbox/AI 消息事件、规则提醒与周期报告的处理函数分离为 `packages/core/src/conversation/ai-event-runner.ts`、`packages/core/src/automation/reminder-runner.ts`、`packages/core/src/reporting/period-runner.ts`；`apps/worker/src/worker.ts` 只保留调度、心跳和停止生命周期。迁移没有新数据库表，也没有新消息队列。独立更正提醒文案：逾期天数、今天截止、阻塞优先级。**尚未完成**：旧 API 的薄路由命令化、单元级职责彻底隔离、全域 CommandReceipt 化、细粒度异步事件版控、外部系统实测。

## ADR-034 · Worker 架构边界静态守卫

将 Worker 心跳写入抽离至 Operations 模块，进程入口不再含直接 SQL；新增一条 CI 测试检查 Worker bootstrap 不包含 `SELECT/UPDATE/INSERT/DELETE` 业务 SQL、不允许直接调用 `pool.query`/事务/审计函数、保留完整三个 Runner 调度。该测试能防止该入口重新长成巨石文件，但**不代表** API/server.ts 和 governance-routes.ts 已无跨领域 SQL。完整 P2 的静态边界校验、应用命令移交和多 Worker 故障注入仍待完成。

## ADR-035 · 版本化 PM 黄金评测基础

现有 AI `PROMPT_VERSION`/`ACTIVITY_SCHEMA` 与 Live Evaluation CLI 共享生产构建器，增加 16 个合成用例（10 个 Schema 支持情景 + 6 个明确标记不支持的正式 PM 行为）、纯评测器以及 `npm run test:ai-evals` CI。此测试只校验合成数据覆盖、版本、评分器拒绝越权/虚构日期/虚构负责人和 Schema 错误，**不是模型准确率实测**。部署管理员若决定自行承担真实推理请求费用，可在独立环境中传入可信 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_STYLE` 和 `PM_EVAL_LIVE=1`，执行 `npm run eval:pm:live`，生成仅包含匿名化案例 ID 和分数的输出。不经真实厂商推理与人工判读不能声明“模型质量通过”。

## ADR-036 · Issue 解决/重新打开与审计历史

新增 014_issue_transitions.sql，为已存在的正式 Issue 增加按同项目复合外键引用的状态变化历史表，不重写历史迁移，也不因项目成员退出而删除历史用户身份。owner/manager 可以在同项目按版本提出 resolve/reopen 并填写非空处理说明；业务状态、历史行、审计、领域事件、Outbox 和 CommandReceipt 在同一事务内提交。项目授权成员可分页查看历史，Web 项目治理页签提供管理与查看入口。当前**尚未实现**自动 Risk→Issue、变更基线联动、Playbook 主动处置和全量 RAID 流程，不能以这一切片标记 P1 整体完成。

## ADR-037 · 完成任务的前置依赖检查与事务内权限重检

已将旧 Task create/update 的项目权限检查移到正式数据库事务，复用 `lockProjectAccess` 联合检查项目及组织有效成员身份，使用 `FOR SHARE OF pm,tm` 与并发角色撤销互斥。负责人分配要求当前项目与组织成员资格。正式 PM Command 也复用同一鉴权 helper。任务状态尝试转为 done 时同依赖图修改共享项目级事务锁，若存在未完成前置任务则 409 回滚；已完成任务不能被新增未完成前置依赖。任务真实复发后可以重新打开，仍待正式下游影响评估。旧 Task 写入尚未迁移到统一 CommandReceipt/DomainEvent，完整 P1/P2 不算完成。

## ADR-038 · 同项目消息证据与来源作者待核实主张

已在本次分支实现 015_evidence_claims.sql、新增 `project_evidence_spans` 与 `project_claims` 表（按项目复合外键）、`evidence/claim-commands.ts` 原子创建/审核应用命令、只读分页 API，以及项目治理内的来源摘录/待核实主张 UI。引文由服务器根据同项目原始 user 消息和 Unicode code-point 偏移直接截取；owner/manager 可以记录项目内来源发言，普通成员仅能引用自己发言。只有原发言人可以执行 `source_acknowledged`，项目 owner/manager 可以驳回；无论来源确认与否都**绝不自动改变 Task/Deliverable/Decision/ChangeRequest 正式状态**。API Smoke 对 code-point emoji、幂等重放、不同 payload 409、非法范围、越权、项目隔离和审计/事件原子数进行检查。本切片尚不实现自动 LLM Claim 抽取、语义冲突消解、面向任务的事实版本图或生产数据保留策略；不能视作 P1/P3 全部验收完成。实际测试通过与否以 PR 最新 SHA 的五项 CI 为准。

## ADR-039 · 直接 Task 写入正式命令统一

已将旧直写 Task create/update 路由抽离到 `apps/api/src/task-routes.ts`，要求客户端 UUID idempotencyKey（更新还需乐观 version），并用 `executePmCommand` 统一权限、任务表、提醒计划、详细 before/after 审计、DomainEvent、Outbox 与回执的同事务提交；重复同输入不重复创建/增加版本，同 key 不同输入返回 409。公共 `delivery/task-assignee.ts` 检查当前项目和组织成员，其他仍使用的候选审批通道复用该成员校验。项目 Web 发送稳定意图键。**仍未完成**：提案审批等遗留正式任务/风险写入路径还没有迁入全域 CommandReceipt；全部业务 API 薄路由与模型发现/确认链路尚不齐全。对应验证必须看本 PR 最新 SHA 全五项 CI。

## ADR-040 · AI 候选与进度审批正式命令闭环

原先两个直接审批写入路由已从 `server.ts` 迁往 `apps/api/src/approval-routes.ts`：`POST /projects/:id/proposals/:proposalId/decision` 和 `POST /projects/:id/progress/:progressId/decision` 均要求 UUID `idempotencyKey`。只有有效项目/租户身份及 owner/manager 的 `proposal.approve` 权限可操作。接受候选 Task/Risk 才创建一条正式事项，关闭澄清 thread；同一事务写入人类决策 Audit、DomainEvent、Outbox、CommandReceipt；进度审核不直接变更 Task.done，采纳 blocker 继续尊重已发送提醒的冷却。项目 UI 和 HTTP smoke 已调整为同意图键重试并检查越权、重复和事件数。此为 PR 实现范围，是否可发布仍以最终提交的 CI/Review 为准。报告发布、成员移除、项目设置及其他遗留正式写入尚未全部迁移；不得标称所有领域写入已统一。
 
## ADR-041 · 负责人写入权限撤销保护

本切片将旧 API 中的 7 类 owner-only 正式操作改为业务事务内调用 lockProjectAccess，覆盖项目成员加入/降级/移除、项目设置、Outbox 死信重试、周/月报生成和发布，当前 tenant/project 身份与精确 ProjectAction 同时检查并行锁授权记录。目标成员入项目时检查其当前组织成员身份并持共享锁。新增真实 PostgreSQL 集成回归检查 owner-only 权限矩阵、项目身份降级后拒绝操作，以及组织成员撤销不得绕过已在途授权事务。该补丁保留现有请求契约，**不代表**这些旧操作已全部使用 CommandReceipt/DomainEvent；完整 P1/P2/P4 仍有未达成条件。最终状态以 PR 五项最新 SHA CI 和 /review 为准。

## ADR-042 · 固定 DNS 的模型出站安全切片

系统配置模型端点的目录查询、连接探针、AI 聊天/候选抽取与 opt-in 黄金评测现在共用 `model-egress.ts` 的默认网络发送器；在建立 socket 之前解析 DNS A/AAAA 整体地址集合并拒绝任意公网域名指向的私网/保留地址、重定向、非本地 HTTP。Node HTTP(S) 的真实 socket 仅使用事先校验过的地址，且每次请求禁用代理/长连接池，维持原域名 TLS 认证。显式 localhost/127.0.0.1/::1/host.docker.internal 仍可调用本地模型。测试包含模拟 DNS 混合/空地址、恶意目标以及真实 loopback POST/重定向/响应过大。**边界：** 单元集成的本机 HTTP 和 GitHub CI 不等于生产网络环境的 egress、防火墙、代理、TLS 与 SSRF/DNS 真实故障注入演练；P4 Issue #51 继续开放。状态以本 PR 最终 CI 和 /review 为准。

## ADR-043 · 人工报告的命令回执、版本与发布审计

新迁移 `016_report_revisions.sql` 为原 Report 增加 `revision`、`published_at` 和 `published_by`，不改写既有 SQL/校验和、不伪造历史报告的原发布时间。报告读取和手工写路由迁出 `server.ts` 到 `report-routes.ts`；人工生成和发布均要求幂等键，只有当前项目及组织中的 owner 有权发出命令。草稿刷新使 revision 单次增加，发布要求 expectedRevision 并在同一事务写状态、审核人及时间、DomainEvent/Outbox/Audit/Receipt；相同 key 重试不产生重复历史，新 key 重复发布 409。已发布内容冻结，之后的生成请求返回原发布版本。Worker 定时周期报告仍保持首次单次生成。**范围限制：** 当前报告仍是项目实时数据快照，并不提供完整周/月内每次事件的历史统计和逐条来源引用；P1/P4 不能据此全部完成。以 PR 最新 Head CI 及 /review 判定实际交付。

## ADR-044 · 项目成员与设置正式命令

新增 `017_project_settings_revision.sql` 单独版本化项目设置（不与 AI 开关授权版本混用）；项目人员邀请、调角色、移除与 AI/工作时间设置已从 API bootstrap 迁移到 `project-governance-routes.ts`，强制 UUID `idempotencyKey`；当前 tenant/project owner 的 `members.manage`/`settings.manage` 权限、组织受邀人资格、目标行锁及未完成任务移交约束在写事务内验证。项目设置使用 `expectedRevision` 乐观更新，不能静默覆盖其他管理员调整；业务数据、Audit/DomainEvent/Outbox/Receipt 同事务。新增 UI 成员移除操作（manager/member/observer，owner 不可移除）。AI 的模型、API Key 仍仅平台总管理员维护。本次仅迁移四条旧写入，项目创建、租户治理和死信重试等其他接口仍有正式命令未统一；开发态 CI 不等于完整 V2/P4 生产验收。

## ADR-045 · Outbox 人工死信恢复命令

项目 owner 查询 Outbox 摘要/死信和人工重试现由 `apps/api/src/operations-routes.ts` 管理；`POST /projects/:id/outbox/:eventId/retry` 强制 UUID `idempotencyKey` 并调用 `executePmCommand`，只可恢复本项目尚未完成且 `dead_at` 非空的死信。目标行锁、当前 tenant/project owner 授权、恢复尝试次数/claim 状态、审计、DomainEvent、Outbox 和 CommandReceipt 同事务；成功的同键重试返回原回执，不会再次修改 Worker 状态，新键二次恢复返回 409。API Smoke 覆盖权限拒绝、无键拒绝、重放、重复恢复和事件数。恢复只意味着重新入队，不保证 Worker 随后处理成功；项目创建、Tenant 治理与真实多副本故障注入仍需后续验收。

## ADR-046 · 风险登记簿与人工应对状态

新增 `019_risk_register_lifecycle.sql`（不改历史迁移）为 Risk 增加 1–5 发生可能性/影响评估、当前负责人的历史性用户引用、应对计划、version 和不可变 `risk_register_changes` 记录；正式风险从 open 经 mitigating 才能到 resolved，resolved 重新打开需说明。AI 生成的 risk 候选只有经人工接受才进入未评估 open，模型不能自行关闭风险。项目 owner/manager 对评估与流转提交 UUID idempotencyKey + expectedVersion，当前 tenant/project 权限锁、风险行锁、成员责任验证、Audit/DomainEvent/Outbox/Receipt 与历史行同事务。Web 项目任务页增加风险评估、状态操作与历史查看，非管理员仅浏览。人员被降为 observer 或移出项目前要先移交未解决风险。周/月报把 mitigating 与 open 都列入未解决风险。真实 Postgres/API smoke 验证越权、未评估不能应对、重试/冲突、状态闭环、事件/历史版本与报告统计。仍不等于完整 RAID、量化预算/资源容量或真实模型质量、迁移恢复和生产验收。

## ADR-047 · 原子项目负责人交接与唯一 owner

新增 migration 020，为 Project 增加 ownership_revision，数据库对每项目 project_members 中 owner 设部分唯一索引，防止双负责人。当前 owner 可选择仍是有效组织及项目成员的接任人，服务端原子修改旧 owner→manager、接任人→owner 和 projects.owner_id，并提交 Audit/DomainEvent/Outbox/CommandReceipt；请求须含 UUID idempotencyKey、expectedRevision 与 targetUserId。重复的原移交命令在旧 owner 降为 manager 后，若他仍有项目只读权限，可以安全重放原回执；新命令仍需当前 owner 完整权限。Web 需用户确认并刷新角色视图，不能从 AI 聊天自动转让。PostgreSQL smoke 验证双向转交、旧版本冲突、原命令重放、新命令越权、唯一 owner 约束和事件版本 [2,3]。完整企业用户离职策略、Tenant Owner 转让、实机迁移/回滚仍需单独验收。

## ADR-048 · 项目创建正式事务命令

项目列表与新建路由从 api/server.ts 分离到 project-routes.ts；创建前使用 021_tenant_command_receipts.sql 的租户级 receipt 占位，锁住当前 tenant admin 身份，避免尚无项目 ID 时错误复用 project-scoped 命令。成功命令在同一事务内生成 Project、唯一 owner 项目成员、项目级 CommandReceipt、Audit、DomainEvent 和 Outbox，并将真实项目 ID 与结果写回 tenant receipt。相同 tenant/actor/kind/key/payload 的并发请求与网络重试一律返回同一个 ID，不重复业务事件；同键不同 payload 409、无 key 400、普通租户成员 403。原创建者失去对该项目的当前成员访问权不得继续读回执。Web 同一次创建意图重用原 UUID，意图变更使用新键。真实 Postgres API smoke 包含 4 路同时创建同一个项目、旧请求重放、不同内容冲突和 owner、receipt、domain event、outbox、audit 精确条数校验。尚有 Tenant/Department/Portfolio/Program 等组织领域的旧写入需要后续命令迁移；生产升级演练没有由 CI 代替。

## ADR-049 · 变更批准后的实施、责任移交与独立复核

新增 migration 022_change_implementation.sql，批准的 ChangeRequest 可由有权项目经理/owner 在指定当前组织项目成员后开始实施（approved→implementing），实施中可通过 reassign 变更执行责任人、重置证据有效时间并形成新版本；实际完成经另一名有权 owner/manager 使用实施者在本项目于本次开始实施之后发表的原始 user 消息作为证据复核（implementing→implemented）。新项目复合 FK 的 project_change_implementation_history 记录状态、版本、人类说明、实施/复核 actor 与证据 UUID；每个真实实施/移交/核验与 Audit/DomainEvent/Outbox/CommandReceipt 同事务，要求 UUID idempotencyKey 和 expectedVersion。实施中责任人被移出项目或降为观察者前必须先重新指派。Web PM 登记簿提供启动、移交、实施证据选择、复核与分页历史。真正的项目范围、里程碑、成本基线仍**不会**因这个状态自动变更；继续属于 #48 的完整计划变更实施工作。真实模型评测、生产升级演练亦不在此次验收范围。

## ADR-050 · PostgreSQL Docker 隔离恢复验证

Docker 部署 Smoke 原先仅验证 pg_dump custom-format 文件头和 pg_restore --list；本轮替换为真实隔离库恢复测试。CI 先验证 Docker Web/API Origin/Cookie、Worker heartbeat/Outbox，然后停止 web/api/worker，只保留测试数据库；脚本只能在 CI=true 与 CHATPM_CI_RESTORE_DRILL=1 同时成立时执行。使用现有 Docker backup.mjs 生成私有归档，随机创建 chatpm_restore_drill_* 临时数据库，以 pg_restore --exit-on-error 还原全部 schema 与数据，逐张 public 表比对行数、排序内容摘要以及 schema_migrations 与真实用户数据，必须完全一致。演练结束清理隔离 DB 和临时文件，不对原 chatpm 库进行恢复/drop。纯单元测试覆盖缺表、行丢失、内容篡改、空源、重复指纹和未授权启动；Docker Workflow 验证真实恢复。**局限：** 这是 Docker CI 少量样本；离机加密备份、PITR、真实存量 V1→V2 ETL 与 Win11/Linux 原生、企业数据库规模恢复仍未验收，Issue #51 保持开放。

## ADR-051 · 组织治理写操作的持久幂等回执

已将组织管理 8 个写 API（部门/组合/项目集创建、项目归属、组织成员加入与角色、部门人员、资源投入）统一要求 UUID idempotencyKey，并更新组织前端同一操作网络重试沿用该 key；原先 tenant 互斥锁与当前管理员行级授权不变。OrganizationCommand 使用现有 021_tenant_command_receipts.sql 租户命令表，以当前 tenant/actor/action/key/payload_sha256 保证操作与 OrganizationAudit/Receipt 同一事务；相同 key+payload 返回原结果，不重复组织业务记录/审计；同 key 不同 payload 409，无 key 400，非 admin 403。真实 PostgreSQL Organization Integration 和 API Smoke 覆盖回执、业务失败回滚、审计失败回滚、撤权和 4 路并发 portfolio 创建、资源投入重放、组织成员邀请重放。没有引入虚构的 projectId 或 Tenant Outbox；组织层 DomainEvent/Outbox、项目分类乐观锁与资源累计投入限制仍是后续治理工作，不能宣称全部 V2 完成。
