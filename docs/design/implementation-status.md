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
