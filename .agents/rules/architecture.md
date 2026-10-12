# 架构与可扩展性规则

1. `docs/design/` 是产品负责人审查的架构方案；`docs/ai/` 给出可实施的模块契约。
2. 模块边界：Identity/Tenancy、Project、Conversation、Work、Risk/Decision、AI Orchestration、Automation、Knowledge、Reporting、Integrations、Audit。
3. API 和 Worker 是**部署进程**，不是微服务；共享同一代码仓库、领域模型与数据库事务。
4. 各模块拥有其聚合写入权；外部只通过显式命令/查询，不读写别的模块内部表。
5. AI 的 `ProposedChange` ≠ 领域事实；受控命令执行后才是正式记录。
6. 使用事务 Outbox、至少一次投递、消费者幂等、失败重试与死信恢复；业务跟进计划持久化数据库。
7. LLM、聊天渠道、通知、文档解析、对象存储采用简明的适配器契约；不提前实现未验证的提供商。
8. 没有明确扩展瓶颈证据时不采用微服务、全量事件溯源、通用工作流平台或多个互相自治的 Agent。
9. 当前没有遗留代码，不设计历史兼容与迁移桥。
