# ChatPM V2 目标架构（批准作为渐进实施目标，不代表已经交付）

## 核心判断

当前生产代码是可运行的实验性模块化单体，不是完整的 PM 运行时。V2 继续使用 Fastify + Next.js + PostgreSQL + 独立 Worker；不采用微服务、自由自治多 Agent、全事件溯源、隐式跨项目共享，也不保留未发布原型的旧业务 API 兼容层。目标是把群聊中的可验证信息转变为**经过授权的项目管理行动**，不是让模型越权修改计划。

## 真实治理层级

Tenant 是数据隔离与成员权限边界。Department 是人事及资源维度；Portfolio 是战略价值、优先级和投资维度；Program 管理有关联收益与依赖的项目群；Project 是交付与聊天权限边界。部门和项目集/组合是正交维度，不能互相代替。用户可以属于多个部门和项目，但项目内容仍由 ProjectMembership 单独授权。

## 领域与所有权

| 所有者 | 正式状态 | 只读依赖 |
|---|---|---|
| Identity / Organization | Tenant、User、Department、Program、Portfolio、Membership、Allocation | 项目归属摘要 |
| Project Governance | Project、Goal、SuccessCriterion、ProjectMethodProfile | 组织成员 |
| Conversation | Message、MessageRevision、Room、SourceReference | 项目授权 |
| Delivery | WorkItem、Deliverable、Milestone、Dependency、AcceptanceCriterion、Commitment | 可信来源 |
| RAID / Governance | Risk、Issue、Decision、ChangeRequest、Assumption | 项目计划及证据 |
| Evidence | Evidence、EvidenceSource、Claim、Conflict | 消息/文档引用 |
| AI PM | ProjectAIAuthorization、AnalysisRun、ModelInvocation、Finding、Proposal、Intervention | 被授权的上下文 |
| Automation / Reports | FollowUp、DeliveryAttempt、PeriodSnapshot、Report | 已确认的领域数据 |
| Platform | CommandReceipt、DomainEvent、Outbox、AuditEntry | 领域事务上下文 |

这些实体分期实现。严禁将本表作为目前已存在数据库表的清单；以 implementation-status.md 为实际完成状态。

## 统一数据与信任流

1. 人员在获授权项目中发送消息；Conversation 在事务中写入消息、审计和可靠事件。
2. AI 只能在生效的项目授权与数据外发规则内读取有界上下文。聊天、文档、检索结果属于不可信输入，不能给工具授权。
3. 证据持有源消息/片段位置/版本/hash/观察时刻；主张区分“人明确承诺”“AI 推断”“完成声明”“已验收事实”，并记录冲突与时间有效性。
4. 编排器关联已有正式事项，识别风险、已经发生的问题、变更、决策与阻塞；模型返回 Finding，不能直接执行 Domain Command。
5. InterventionPolicy 决定观察、澄清、提议、提醒或升级；需审批的 Proposal 保存预期的目标版本及证据。
6. 经授权的人确认后执行受控 Command；命令原子写入正式状态、领域事件、审计、Outbox 和幂等结果。
7. 后续消息和定期检查评估干预是否有效；报告以历史快照和可访问的引用为依据，不能把“本期状态”伪装为“本期变化”。

## 工作管理语义

Task 是执行工作；Deliverable 是可检查的成果；Milestone 是重要时间节点；Issue 是已发生的影响事件，Risk 是未来不确定事件；Decision 是授权过的选择；ChangeRequest 修改基线，不能等同于聊天建议。工作状态区分进行中、阻塞、提交验收、验收通过和取消；“开发完成”不等于“业务验收”。日期型期限为项目当地日历 DATE，实际事件与提醒时间用 UTC TIMESTAMPTZ。

## 运行时约束

API、Worker 仅负责身份、验证与输入转换，业务写入归属模块的 Command Handler。所有授权必须在服务端重检；并发更新使用版本条件或行锁。Outbox 按至少一次交付设计，Consumer 在事务中实现幂等。对后台运行中的 AI 撤权，**下一次出站模型调用和下一次对外干预**必须重新验证当前授权；运行记录同时冻结启动时版本便于审计。禁用 AI 不得删除已确认领域事实。

## 不选择与复审

不为了“更先进”增加向量库、微服务、Kafka、通用流程引擎或多 Agent。只有证据检索准确度、事件吞吐、独立部署需求或人员协作规模有可复现瓶颈时才重新评估。保留 PostgreSQL 事务保护、现有复合外键、消息提交顺序和事务 Outbox；拆模块不可降低安全性。

## 验收

权限矩阵与撤权并发；同项目引用与跨项目数据库拒绝；重放、并发版本冲突、Worker 崩溃恢复；AI 隔离/授权版本/提示注入；完成声明不自动验收；报告来源可追溯；按 Windows/Linux/Docker 分别实机验收。合并不能替代端到端运营验收。
