# V2 AI 治理与可追溯项目经理运行时

**状态：目标设计，未全面实现。**

## 授权而非提示词赋权

项目级授权需版本化：ProjectAIAuthorization(projectId, version, enabled, capabilities, outboundDataPolicy, modelPolicyId, interventionPolicyId, playbookSetVersion, approvedBy, effectiveAt, revokedAt)。系统总管理员独享供应商连接、模型凭据和默认模型设置；项目负责人只能控制本项目的 AI 是否启用以及被组织允许的能力，普通成员直接使用。系统管理员不因平台身份而获得组织对话读取权。

capabilities 至少分为：readConversation、readProjectFacts、detectProgress、detectCommitments、detectRisks、detectIssues、detectDecisions、detectChanges、createProposals、askClarifications、sendRoutineReminders、draftReports、escalate。默认全关闭，按需最小开放。数据出站基于 tenant/project、敏感等级和所选模型目标策略，任何配置不得绕过网络隔离或管理员凭据权限。

## 追踪记录

AnalysisRun 是一次业务级项目分析，记录 source/triggerEvent、authorizationVersion、playbookVersion、orchestratorVersion、contextSnapshotHash、状态与结果统计。ModelInvocation 是一次实际模型请求，记录 provider/model/configVersion、promptVersion、request/response hash、输入输出 token（如供应商提供）、延迟、脱敏错误与验证结果。一次 Run 可以没有或有多次调用；每次重试应有独立记录。不要把消息全文和上游原始错误复制进运行审计表。

## 干预策略

L0 仅观察；L1 保存证据；L2 追问或生成待批准的建议；L3 在同一项目已确认承诺、有效权限、工作窗口和冷却内进行规则提醒；L4 负责人/期限/范围/风险级别等关键变化须人工批准；L5 对外不可逆动作要求显式批准。LLM 永远不直接执行 L4/L5。关机、撤权、模型超额或不合规输出必须安全失败；AI 无响应时依旧允许人工项目管理。

## 质量评估

Golden fixtures 应包含：承诺 vs 计划、Risk vs Issue、完成声明 vs 已验收、重复任务、缺失 owner/date、日期时区、跨项目数据、提示注入、超时与费用上限。发布门槛需要模型精确率/召回率、误干预、漏报阻塞、无授权变更、重复提醒等真实统计。目标阈值需通过试运行校准，不写成已经达到的结果。

## ADR-032 · 已实现的第一阶段 AI 授权版本与调用账本设计

将已有 `projects.ai_enabled` 保留为**唯一生效启用状态**，增加 `ai_authorization_version` 与 PostgreSQL trigger：仅 AI 开关发生真实变化时递增版本。不得创建与项目开关相矛盾的第二布尔事实源。API 负责保留操作者审计，触发器覆盖其他合法的数据库更新路径。每次出站前校验开关并记录当前版本；启用/禁用跨越请求期间的竞态不能以 Prompt 控制消除，当前设计为出站前重复检测并在版本变化时拒绝本次调用，严格网络级撤权仍需专门 egress 审计。

`ai_model_invocations` 记录每次实际尝试的模型身份（脱敏）、Prompt 版本、授权版本、隐私保护的输入指纹、耗时与通过/失败状态。每次重试保留独立行；输入/响应正文、供应商 Key、URL path 和原始上游错误不得落库。上游没有标准化提供真实 token usage 时输入/输出 token 为空，不能估算冒充精确计费。现有 `ai_analysis_runs` 继续表达消息最终分析状态，两者不是同一对象。

当前阶段不宣称已有细粒度 capabilities、组织敏感数据出站策略、KMS、全量 Playbook 或 AI 成本计费；后续依黄金集与运行安全评测扩展。
