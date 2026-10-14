# 项目管理方法配置与受控 Playbook

**状态：目标设计。** 将 PMBOK、Scrum、Kanban 与实践知识转化为受约束、可度量的行为，不把任何标准照搬成固定软件流程。

## MethodProfile

各项目显式选择 lightweight、predictive、adaptive 或 hybrid，并根据规模、合规程度、交付类型裁剪。ProjectGoal 与 SuccessCriterion 为通用核心；Sprint/Sprint Goal 仅在采用迭代方法时出现。Scrum 的 Product Owner、Scrum Master 与 Developers 不自动映射为系统 RBAC 的 owner/manager/member；项目权限和实践职责是独立的维度。

## 版本化 Playbook

每个 Playbook 定义 id、semanticVersion、适用 MethodProfile、触发事件、输入上下文、所需证据、条件与不变量、允许输出、审批级别、问答冷却与评测 fixture。Playbook 不能直接写数据库或任意调用工具；将需求表达为 Finding / Proposal / InterventionIntent，再由服务端权限策略决定。

首批 Playbook：承诺识别、任务进展关联、阻塞升级、风险评估、需求变更识别、决策留痕、验收核对、周计划/周报、里程碑预警。无明确 owner 的任务只追问，不指派；已经过去的风险变为 Issue 而不是继续无限提醒 Risk；讨论中说“完成”只能形成 completion_claim，正式验收需审批及标准；单次最多发一个必要追问，避免刷屏。

## 验收契约

每个 Playbook 必须有正例、反例和恶意输入案例。功能开关、项目授权版本与 Playbook 版本固定在运行记录上。升级版本必须先通过回归评估，且可以停止新分析而不更改已确认项目事实。正式业务证据链为 source → evidence → claim/finding → proposal → human decision → domain command → audit → later verification。
