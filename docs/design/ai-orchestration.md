# AI 项目经理编排设计

## 当前受控实现（已交付基础）

ChatPM 是由项目权限约束的单一 PM 编排器，**不是**可运行 Shell 的编程 Agent，也不是多自治 Agent 平台。已有消息分析、候选任务与风险、与同项目已存在任务的进度/阻塞/完成声明关联、短时澄清、@AI 只读问答、规则提醒、报告草稿和人工审批。正式 Task/Risk 不会因模型推断自动被改变。

项目 Owner 明确开启本项目 AI；平台总管理员统一设置 `ai_provider_connections` 和 `ai_model_configs`，一个供应商连接可以注册多个模型，只有启用且设为默认的模型用于业务。项目成员不见凭据，不需要填写 DeepSeek 或某厂商专用参数。当前传输支持 Responses 和 Chat Completions（并非所有厂商原生协议）；供应商目录发现只覆盖兼容 GET /models 的连接。实际模型兼容性仍需逐厂商测试。

## 当前可信数据流

1. 项目成员发送持久化消息。项目和租户成员身份在服务端校验；消息具有唯一序号、nonce 幂等与事务 Outbox。
2. Worker 依据项目 AI 开关处理消息、从同项目构建有限预算的正式任务/风险/近期聊天上下文，并按管理员已启用的默认模型发请求。
3. 来自聊天的文本不可信；Structured LLM Output 必须通过协议检查与本地 Zod 校验。AI 候选携带消息来源和模型/Prompt 身份，现有任务进度关联须检查目标同项目。
4. 候选 Task/Risk/Progress 与正式业务事实分别持久化；项目 owner 与 manager 根据当前 `proposal.approve` 权限审批，任务正式状态变更另有独立权限和版本约束。
5. 追问和站内提醒使用明确任务、项目工作时间和冷却；周期报表当前为状态快照，不宣称已具备历史变化证明。

## 当前边界和失败策略

- 供应商凭据用独立的 MODEL_ENCRYPTION_KEY 加密，浏览器和审计不回传密钥。模型目标受地址协议/重定向和目录 DNS 预检约束；生产网络 egress 仍应强制隔离。
- 项目使用的 `ai_enabled` 是粗粒度开关；尚未实现完整能力列表、版本化 ProjectAIAuthorization 或对运行中授权撤销的完整策略快照。
- 每项目每日配额目前为请求次数，不是精确 token/费用预算；ai_analysis_runs 主要记录每消息最终阶段，并非完整 ModelInvocation 历史。
- 没有可用默认模型、模型出错、格式错误或权限不足时不能自动改变正式事实；模型失败不能伪装为成功。
- 对过去/当前状态可能相互矛盾的消息，没有持久 ClaimConflict 引擎；没有全生命周期 ChangeRequest/Decision/Issue 及正式验收流程。

## V2 目标（未交付）

依据 [V2 架构](v2-architecture.md)、[AI 治理](ai-governance-v2.md) 与 [Playbook](project-methods-playbooks.md)，演进为：

Observed Event → Typed ProjectContext → EvidenceSource / Claim → Finding → InterventionPolicy → Clarification 或 Proposal → 已授权人员确认 → Domain Command → Audit/Event/Outbox → 后续结果验证。

ModelInvocation 记录每次实际模型调用和版本；ProjectAIAuthorization 保留能力、出站策略与审批版本；Playbook 明确 PM 方法、触发和反例。正式完成必须独立于“开发已完成”的口头声明，由标准与授权人员验收。跨项目 Project/Program/Portfolio 诊断不得直接扩大数据读取权限。

## 验收门槛

模拟模型只能验证协议和确定性业务保护，不能证明真实模型质量。必须逐步补充：跨租户隔离、任务关联黄金集、Risk vs Issue、日期歧义、重复催问、后台故障恢复、Prompt Injection、模型出站网络限制、Win11/Linux/Docker 部署实机、费用与隐私评估。进度以 [实施状态](implementation-status.md) 和真实 CI 证据为准。
