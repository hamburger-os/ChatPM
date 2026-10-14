# V2 命令、领域事件与事务契约

**状态：目标契约。** 除已有消息 nonce/任务 version/Outbox 外，新 CommandReceipt 与 DomainEvent 尚未在所有业务写入路径实现；本文件不得用作已实现 API 声明。

## 命令边界

每个正式写入以 CommandEnvelope 接入应用服务：commandId(UUID)、kind、tenantId、projectId（系统/组织命令可替换为明确 scope）、actor、idempotencyKey、expectedVersion、correlationId、causationId、issuedAt 和严格校验后的 payload。tenantId 由会话及关联实体确定，不可信任任意客户端值。AI 身份只表达已批准的后台能力，不能冒充人员。

| Command | 所有者 | 典型审查 |
|---|---|---|
| conversation.post | Conversation | 项目成员与 nonce、seq |
| work.create / work.update / work.transition | Delivery | 创建/改期/负责人/验收的授权与版本 |
| risk.register / issue.raise | RAID | 证据、owner、严重性 |
| decision.record / change.request / change.approve | Governance | 权限、基线影响、审批 |
| proposal.approve / proposal.reject | AI Governance | 当前目标版本、证据、正式 Command |
| ai.authorization.update | AI Governance | 项目负责人及组织策略双重约束 |
| organization.member.update / allocation.record | Organization | 租户隔离、撤权、资源重叠 |
| intervention.acknowledge | Automation | 幂等与冷却时间 |

命令幂等范围为 scope + kind + idempotencyKey；相同 key 若 payload hash 不同，拒绝 KEY_REUSED，不应意外返回旧结果。事务内查/写 receipt，唯一约束在并发情况下决定赢家。原子写入顺序：鉴权重检 → 检查不变量/版本 → 修改聚合 → 审计 → DomainEvent → Outbox → CommandReceipt → COMMIT。任一环节失败全部回滚。读取未提交命令不可见。边界错误显式区分 NOT_FOUND、FORBIDDEN、VERSION_CONFLICT、INVALID_TRANSITION、POLICY_REVOKED、KEY_REUSED。

## 领域事件

命名采用已发生的事实，如 work.created.v1、work.status_changed.v1、risk.registered.v1、proposal.approved.v1、ai.authorization_changed.v1。事件具有 eventId、schemaVersion、scope、aggregateType/Id/Version、occurredAt、correlationId/causationId、可验证 payload。Event 是事实，Outbox 是投递任务，不能混作一个 mutable 对象。消费者使用 eventId 幂等；claim/lease/fencing token 不得让过期消费者覆盖新租约。

## 审计和隐私

记录行为主体、权限决策、前/后版本、原因、源 Evidence 引用及目标；组织结构和资源修改与组织审计**同一事务**。不重复保存完整敏感聊天、原始模型密钥或上下游敏感响应。审计失败时业务写入必须回滚，而不是先写成功再补审计。

## 实施与测试

本契约是分阶段重构目标。第一批落地聚焦组织路由的事务化业务写入/审计；随后统一 Domain Command Runtime、事件表、AI Run/Invocation，再将 HTTP 与 Worker 逐模块迁移，最终用静态边界规则禁止 API/Worker 持有跨域 SQL。CI 验证命令重放、并发版本、授权撤销、审计回滚和 Outbox 崩溃恢复；没有运行的验证不能打勾。
