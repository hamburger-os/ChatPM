# 实施状态与交付缺口

**产品状态：** 实验性原型，可本地运行；生产级安全、隐私、稳定性及完整功能尚未验收。此处为实现覆盖的单一事实入口，不维护历史版本日志。

| 领域 | 当前能力（以当前代码为准） | 仍需完成/验证 |
|---|---|---|
| 身份和租户 | 邮箱账号、可撤销会话、一次性组织邀请领取、部门/组合/项目集、项目角色及负责人移交、总管理员独立授权 | 邮件发送、SSO/SCIM、生产身份滥用防护与会话清理 |
| 消息 | 持久化、项目有序游标、nonce 幂等、轮询；Web 同意图网络重试复用 nonce | 全量历史分页、实时推送、附件、撤回和真实移动设备验收 |
| AI | 统一平台 Provider/Model、项目 AI 授权版本、调用账本、候选/进展提取和人工审批、出站 DNS/SSRF 防护；配置与调用共享 URL 校验 | 真实供应商/本地模型端到端、历史上下文、细粒度数据外发授权、Playbook、成本与生产网络隔离 |
| 工作、风险与治理 | 任务及变更历史、目标、里程碑、交付物独立验收、依赖、Issue/Decision/ChangeRequest 基础流转、风险评估/处理 | 完整计划基线、PMP 组合收益、跨项目依赖、全套 RAID/干预闭环 |
| 自动化 | 独立 Worker lanes、Outbox 租约、幂等及死信、规则提醒、报告调度 | 假日策略、故障注入、主动运维报警、规模压测 |
| 汇报 | 周/月报告草稿与审核发布、历史任务变化事件、当前项目状态快照 | 完整跨领域历史、周期对比、证据追溯、可编辑草稿 |
| 运维部署 | Docker/Windows/Linux 启动入口、跨平台构建 CI、备份工具及隔离库恢复 CI | 真实 Windows/Linux 安装重启、生产 HTTPS/隐私安全、异机恢复和性能验收 |

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

已在本次分支增加新增迁移 012_pm_domain.sql（不更改存量迁移）及受保护项目 API：目标、里程碑、交付物、问题、决策、变更申请、任务依赖；交付物可由当前被指派人员提交、由 owner/manager 独立验收/退回；原有变更审批仅 owner 且不可自批（已由后续独立交叉审批改进覆盖）；同项目任务依赖阻止自环、环路。新 PM API 使用事务内的项目/租户成员双重鉴权、幂等回执、审计、领域事件、Outbox；Worker 识别并确认记录型 domain.changed，不允许 AI 自动提交。项目原有 Task/Risk/Proposal 接口**暂未统一迁移**，完整 WorkItem 命令标准化、风险处理工作流、跨项目资源冲突、验收 Web 专门界面、模型干预仍未实现。实际测试/CI 结果以对应 PR Head 为准，不能把此条当作验证通过证明。

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

## ADR-052 · 跨项目资源容量守卫

跨项目资源投入目前在 resource-allocation.ts 领域服务计算当前组织内同一人员在拟登记日期闭区间所有项目的每日累计峰值。实现不展开日序列：只检查申请开始日以及区间内已有投入的开始日；计划分配为固定正百分比，最大值只可能出现在这些变化边界。新资源必须经当前组织管理员 organizationCommand 事务、tenant-level advisory 锁、项目和人员组织成员资格 FOR SHARE 验证后，才允许插入；现有峰值+新比例超过 100% 返回 409，事务回滚，不产生虚假资源、组织审计或新回执。普通成员、跨租户/跨项目对象不能写资源，同一命令重试复用原 receipt。项目组、项目集、项目组合分类不隔离同一人的容量。Web 明确提示日期包含两端以及累计比例规则，PostgreSQL Smoke 包含 30+70 合法、溢出1%冲突、10月31日边界、次日100%不相交、2个60%不同 key 并发仅1成功、另一人员独立100%和准确 Audit 行数。当前只管通过此资源创建路径的计划登记，数据库既有超过100%的历史记录不会改写；未来编辑、批量导入与其它写入口需要继承同一约束；真实部门资源计划、实际工时与生产恢复尚未验收。

## ADR-053 · 部门 / 项目集 / 项目组合归属版本管理

新增 023_project_classification_revision.sql（增量迁移，旧迁移 checksum 不变），Project 的部门/Program/直接 Portfolio 分类拥有独立 classification_revision，初值 1，不与 AI 开关、Project Owner、提醒设置版本混用。组织结构 GET 返回分类版本，PATCH 必须携带当前 expectedRevision、UUID idempotencyKey，仅能由当前租户管理员执行；已有组织命令事务锁内 Project FOR UPDATE 检查旧版本，真正变更时三个分类列与版本同时更新，过期版本或新的无变化命令返回 409，不能悄悄覆盖其他组织管理员或制造虚假审计；原命令正确重放仍返回原结果。UI 显示选中项目的分类版本，过期冲突后可刷新当前部门、项目集与组合归属再重新确认。API/PostgreSQL smoke 验证首改 1→2，原键重放、换 payload 409、无 key/版本 400、跨组织/普通管理员越权、无变化拒绝、切直接组合与回项目集、两次独立过期命令并发一成功一冲突、精确审计行数。组织操作仍只有既有租户审计与持久 receipt，不冒充已有项目级 Outbox 或自动 AI 决策。多项目跨团队容量及生产实机数据库迁移仍分别验收。

## ADR-054 · 组织重复变更与自降权重试语义

重复邀请租户成员、同角色设置、同身份部门人员指派，不再产生虚假更改审计或新 Receipt（不同 key 新命令返回 409）；相同 key 的成功变更重放仍返回原结果。另一管理员存在时 tenant admin 可自行降为 member，事务成功后可以凭原命令继续读取**自己的同一次成功回执**，但不能凭新 key 再修改组织角色。只有组织角色路由允许当前 tenant member 对已完成 Receipt 的重放，organizationCommand 的其它路径仍要求当前 admin；保持 last-admin 约束、租户互斥与当前权限锁。没有新 migration，不代表所有组织级 DomainEvent/Outbox 已完成或达到真实生产签署。

**ADR-054 浏览器权限刷新：** 组织管理员主动把自己降为成员时，前端显示明确二次确认；真实命令成功后重新加载工作台并重新获取组织成员身份，不再使用已撤销的 admin 权限继续调用组织人员列表而误报失败。其他成员的正常角色变更仍按原流程重新读取组织结构。

## ADR-055 · 项目设置真实变更与浏览器基线

项目设置以数据库最新 settings_revision 与 AI/提醒字段锁定比较；同值新命令 409，不新建 DomainEvent/Outbox/Audit/Receipt，也不修改计划、提醒或独立 ai_authorization_version。原 UUID 成功命令的网络重试仍回放原回执。Web 只有表单不同于最近一次成功保存值才允许提交，保存成功更新本地版本与快照，避免无意增加乐观版本。这是 P1/P2 数据审计和并发一致性增量，不替代 AI 模型供应商授权、组织治理 DomainEvent、实体完整生命周期或生产备份恢复验收。

## 2026-10-15 · 审查改进增量

两人变更审批支持 owner/manager 交叉复核但严格禁止申请人自批；登录限流按账号 HMAC 隔离共享 Next.js 代理；独立 Worker 调度 AI、催办和报告；AI 产物提交时使用授权版本行锁；交付物负责人正式交接和观察者禁任命；资源取消保留历史并从容量占用中移除。成员移除/降权检查未验收交付物和有效资源计划。此处表示接口及自动化测试补充，不表示真实生产环境的完整安全、外部模型、报告历史变化、项目集/组合收益管理或 Win11 验收已经完成。

## ADR-056 · 可审计任务变更与周月实际变化

新增迁移 `025_task_history.sql`，数据库 AFTER INSERT/UPDATE 触发器统一记录 Task 新建、状态、标题、截止日期与负责人真实发生的变化，不受旧 Task HTTP、AI 候选采纳或受控应用命令入口差异影响。UPDATE 不改变被观察字段时不追加伪事件；历史行禁止 UPDATE，业务事务失败不会留下脱离正式状态的历史。只记录迁移生效后的事件，**不补造**旧任务、既有报告或未知时期的历史。

`reports.ts` 在一个 SQL 快照中同时读取当前状态与任务历史，用生成时冻结的时刻、项目 IANA 时区、PostgreSQL 本地自然周/自然月边界求本期创建任务数、进入完成/重新打开/阻塞状态的去重任务数、期限设定/调整次数，以及全部任务变更事件总数。保留快照列，最多列出近期 100 条事件明细但总数完整；各变化列引用同一项目的 task_id 和历史事件 UUID。报告草稿人工刷新、发布冻结与 Worker 单次周期草稿语义不变。

`GET /projects/:id/tasks/:taskId/history` 使用两字段游标返回最多 50 条正式历史，`GET .../history/:eventId` 返回可核对的单条事件；服务端对当前组织+项目成员及 Task 关系联合验证，跨项目与撤权均拒绝。Web 在任务下查看历史，报告纯文本中的受限 UUID 标识转换为可点击的本项目来源 API 链接，保持 React 文本转义，不执行用户聊天或模型提供的 HTML。

这是一项可靠的 Task 历史变化能力，**不是**完整的项目实际进度/变更基线重放、跨项目组合绩效、风险/Issue/Decision 历史关联或可再现的迁移前数据。独立的周期统计边界、多人 E2E 和生产时区/备份恢复需要继续实测。

## ADR-060 · 主责部门与多个协作部门的明确关系

不把部门、项目集、项目组合混为相同的父子文件夹。每个 Project 可以有一个主责部门 `projects.department_id`（nullable，项目管理责任归属），以及零到多个参与部门 `project_departments`（以现有 Tenant 复合外键限制跨组织错误）。本轮在组织 Structure GET 显示 `participating_department_ids`，所有组织管理员可维护；普通组织成员仅能看到自己已有项目权限的项目归属，项目协作关系**不会授予**聊天室读取、任务调整或批准权限。

将参与部门集合与主责部门、项目集、直接组合归属视作**同一分类命令**，使用已有 `classification_revision` 乐观锁、持久 idempotency receipt、组织管理员实时授权与审计，在同一事务中更新项目主字段和参与部门集合。拒绝主责部门重复列为参与方、重复参与项、其他 Tenant 中不存在的部门；只修改参与部门也必须增加版本，完全同值新命令返回 409，成功重试回放旧结果。组织界面添加多选、各部门主责/参与项目计数和刷新版本逻辑。

这只是部门协作归属的完整可维护数据闭环，未实现正式项目集收益目标、战略组合优先级、部门实际工时、跨部门资源冲突解决或部门成员自动项目入职。项目组合/项目集管理继续是独立的治理层；不可把本次分类完善宣传成完整 PMP Portfolio/Program 管理功能。

## ADR-061 · 项目集/组合只读正式事实汇总

新增 `GET /tenants/:tenantId/governance-pulse?on=YYYY-MM-DD`，仅当前组织管理员可读取。服务端在同一个 PostgreSQL `REPEATABLE READ` 事务中锁定当前组织管理员授权，并读取项目、项目集、项目组合和有效资源计划；普通成员和其他 Tenant 不能通过该接口读取敏感跨项目人员信息。组织工作台新增「跨项目概览」面板。

一个项目要么通过所属 Program 间接归入 Portfolio，要么直接归入 Portfolio；两者不得同时存在。服务端只计算一次项目的 `effective_portfolio_id=COALESCE(program.portfolio_id,project.portfolio_id)`，避免项目集项目与直接归属出现双重汇总。项目集和组合可以为空；未归属的项目单列，不强制用部门代替项目集/组合。任务完成数只统计正式状态 done，cancelled 单独计数，未解决风险只统计 status 非 resolved；任何相同状态的任务/风险不会因资源投入记录数量而被放大。独立资源汇总按人员对选定日期当天有效且未取消的计划百分比求和，80% 是注意阈值，100% 以上是超配告警，绝不称为实际工时利用率或收益实现。

所选 `on` 日期**只用于到期任务判定和当日资源投入计划筛选**，任务及风险状态仍是生成时刻的当前快照，不能当作过去任意一天的历史进度。完成进度分母 = 任务总数 - cancelled。项目集收益目标、组合战略优先级、跨项目依赖/风险传导、历史周期对比与资源预测仍属于 Issue #43 未完成的治理能力。

## ADR-063 · 组织结构查询服务及撤权一致性（2026-10-16）

将原 `GET /tenants/:tenantId/structure` 路由中的多个业务 SQL、两阶段租户授权查询迁移到 `packages/core/src/governance/structure-query.ts`。API 仅校验请求中的租户 UUID、获取登录主体并调用查询服务，不再在该 GET 路由里直接查询部门、项目集、组合和项目成员业务表。查询服务开启一个 PostgreSQL REPEATABLE READ 事务，在读任何结构信息之前用 `SELECT tenant_members ... FOR SHARE` 检查并锁定当前组织成员；组织成员已撤权则整个接口拒绝。组织管理员可以读取本租户全部项目结构；非管理员只读取其有明确 `project_members` 关系的项目并在读取时 `FOR SHARE OF pm`，其他项目的归属信息不能从当前租户结构列表泄漏。部门、项目集和组合基础目录依然对合法组织成员可见。

同一事务保证结构读取和项目分类关系版本来自统一快照，当前组织/项目授权行锁保证撤权与响应读取不会相互错位。这里针对的是**组织结构读模型**，没有扩大系统管理员或项目成员的跨项目数据权限。新增真实 PostgreSQL 集成覆盖组织管理员、普通成员、跨租户、项目撤权和组织撤权，以及静态边界测试阻止路由回退为直接领域 SQL。

仍需继续 Issue #49：其他领域路由的读/写分离、全域 Command/DomainEvent/Outbox 一致性、多实例 Worker fencing、生产性能及崩溃恢复测试均未在本 PR 完成。

## ADR-064 · 项目归属正式命令的 Core 所有权（2026-10-16）

将 `PATCH /tenants/:tenantId/projects/:projectId/classification` 中的 SQL/业务状态变化整体迁入 `packages/core/src/governance/classification-command.ts`。HTTP 路由只进行 UUID、Zod 请求数据验证与登录身份授权，调用同一个 `changeProjectClassification`，不再直接持有 `projects` 与 `project_departments` 的写 SQL。Core 继续使用唯一 `organizationCommand`：获取 Tenant Advisory 事务锁、当前 Admin 授权、actor+tenant+kind+key 的稳定幂等回执、实际变更审计。分类版本、主责部门、参与部门列表、项目集/直接项目组合归属由同一事务原子更新；历史版本、新 key 同值、幂等键冲突、跨 Tenant 无效部门与普通成员越权都安全失败。Core 自身还承担项目集/直接组合二选一、主责部门不得重复作为参与部门、参与部门重复或超数量的业务规则，不能只依赖 UI 输入约束。

新增真实 PostgreSQL 集成直接调用 Core 命令，验证回放/不同 payload、版本冲突、跨租户 FK 回滚、角色越权、仅真实修改产生审计；此前 API Smoke 的完整项目分类和并发版本回归继续运行。静态架构测试确保该 HTTP 命令不会退回到路由层直接写业务表。

这是 Issue #49 的一个完整归属命令迁移增量，不代表 `server.ts`、其余组织路由、Task/Risk/PM 全领域命令、Worker 多实例 fencing、死信和生产性能验收已经完成。

## ADR-065 · 整体审查后的首个实现切片

本轮增加 Conversation Core 事务内消息权限及单一写入入口、消息最小审计/Outbox 原子性、AI 审批复用 Delivery/Risk Core 记录创建、PM 登记簿统一授权快照、组织前端共享 HTTP 请求入口，并补充静态架构断言与 PostgreSQL 消息重试和撤权集成检查。验收必须以本 PR 最终 Head 的 CI 为准，而不是先前 main 的结果。Owner 两处表示、跨聚合 DomainEvent、管理员模型事务授权、AI Schema 单源及其余路由、真实模型/Windows/SSE/生产安全与数据保留仍未全面交付；P1–P4 的整体 Issues 不应据此关闭。

## ADR-066 · 管理员模型写入事务授权

系统供应商/模型的创建、编辑、删除、批量导入和模型测试配额写入，现统一在事务中重新锁定并检查当前系统管理员标志；此前路由入口鉴权仍可用于尽早拒绝，但不再是提交业务数据的唯一保证。新 PostgreSQL 并发测试和架构检查被接入 Product verification。真实模型外部请求期间的网络撤权、自动成本控制、真实供应商实测、身份生命周期和生产渗透测试仍未验收。结果以此 PR 最新 Head 工作流为准。


## ADR-068 · AI 候选和进度人工审核统一归属 Core（2026-10-17）

`/projects/:id/progress/:progressId/decision` 和 `/projects/:id/proposals/:proposalId/decision` 不再由 Fastify 路由负责业务 SQL、事务和审批状态变更，改为 DTO 验证后委托 `packages/core/src/approval/decision-commands.ts` 的 `decideProgress` / `decideProposal`。两个命令继续共用现有 `executePmCommand`，在单事务内重新验证当前 Tenant+Project 角色、写入原业务变更和持久 Receipt/DomainEvent/Audit/Outbox；同键同 payload 重放、同键异 payload 拒绝及候选单次决策语义不变。被接受的 Task/Risk 仍使用 Delivery/Risk Core 的唯一创建函数；AI 仅产生待确认记录，不能绕开人工审核写正式计划。已增加 API 无 SQL 静态守卫和真实 PostgreSQL Core 集成测试，覆盖 Observer/非项目成员拒绝、重放、冲突、单次正式插入和审计事件数。

此改动不声称完成全部 P1/P2：项目成员管理、PM 登记簿剩余路由等领域 SQL 尚待迁出，AI 源证据体系、生产实机/安全/迁移验收仍为独立开放事项。CI 结论必须以本 PR 最终 Head 为准。

## ADR-069 · 任务归档/恢复完整命令切片（2026-10-17）

新增 `027_task_archive.sql`，在正式 Task 增加原位归档标记并扩展不可变 `project_task_history`，`packages/core/src/delivery/task-commands.ts` 提供 `setTaskArchived`，POST `/projects/:id/tasks/:taskId/archive` 与 `/restore` 只做入参校验、现时角色与版本由已有命令运行时控制。项目 Owner/Manager 有权归档完成/取消且无待审核进度的任务，Owner/Manager 可恢复；成员/观察者只读历史。归档期间禁止修改任务或接受进度，停止催办和后续针对该任务的 AI 进度抽取；项目任务 UI 增加归档列表与恢复。正式 Task 列表 GET 从 `server.ts` 移入 Core `delivery/task-queries.ts`，使用同一个 REPEATABLE READ 事务的当前成员行锁核验与读取，避免旧请求在撤权后继续跨连接拿到归档任务。周月报当前工作量和项目集组合快照剔除归档任务，但来源、领域事件、历史证据以及先前报告仍保留；不实现硬删除。

同 PR 增加 PostgreSQL 集成测试与架构守卫，纳入 Product verification。实际完成及质量验证须以 PR 最终 SHA 的 CI 为准；不宣称正式生产实机、长期数据保留策略、完整 PMP 或 AI 性能验收。
