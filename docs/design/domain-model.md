# 领域模型与可信项目状态


## 关键概念（含未实施的目标对象）
| 领域 | 主要对象 | 说明 |
|---|---|---|
| 组织与项目 | Tenant、User、Project、ProjectMember | 项目独立权限，组织可设置策略 |
| 对话 | Room、Message、Attachment | 消息原文/版本和来源引用 |
| 工作管理 | Task、TaskDependency、Milestone | 负责人、期限、状态、依赖及版本 |
| 风险与决策 | Risk、Decision、Approval | 风险登记、升级与确认 |
| AI 分析 | Evidence、AnalysisRun、ProposedChange | 抽取依据、推断与待确认建议 |
| 自动化 | FollowUpPolicy、FollowUpPlan、DeliveryAttempt | 可靠提醒计划与执行轨迹 |
| 知识与报告 | DocumentVersion、ReportSnapshot | 文档版本、统计截点和报告 |
| 基础设施记录 | OutboxEvent、InboxReceipt、AuditEntry | 可靠事件和可追溯变更 |

## 业务事实建立机制
**原始消息/文档 → 证据 Evidence → 候选 ProposedChange → 验证/确认 → 领域命令 → 正式 Task/Risk/Decision。**

- 成员说“差不多完成”并不等于完成，AI 先追问验收标准。
- AI 识别的负责人、期限和风险等级可能是推断；必须与明确承诺区分。
- “自动登记候选”可默认启用；“创建承诺或改变里程碑”由项目策略决定是否人工批准。
- 每个变更可追溯到原始上下文、确认人、版本和执行日志，来源不可访问时不能泄露原文。

## 建议状态
任务：草拟（可选）→ 待开始 → 进行中 / 阻塞 → 完成 / 取消；审批建议为独立生命周期（待确认、接受、拒绝、过期、冲突），**不混入正式任务状态**。

## 数据一致性
正式状态用唯一业务 ID 和 version 控制并发；相关关系有外键/唯一性约束；租户及项目作用域为每次读写的必要条件。删除/修改历史遵循数据保留政策和审计规则。

## 策略方向
系统将按项目策略分级决定 AI 动作；尚未实施的自动转换规则必须先通过服务端授权与领域命令验证，AI 不能代替成员作出正式承诺。

## ADR-022 进度证据与日历日期
`Task.due_date` 为所属项目时区的日历日；只有时间发生的真实证据才继续用 `TIMESTAMPTZ`。 `TaskProgressUpdate` 是只读来源消息关联到正式任务的待审证据（progress / blocker / completion_claim），Owner 的接受动作只使证据可信，不自动把任务判为完成；通过事务和审计记录决定。复杂依赖/里程碑/进度百分比仍需未来清晰建模。
