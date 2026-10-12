# ChatPM · Agent 开发守则

本文件是仓库根目录的通用编码 Agent 入口（[AGENTS.md 约定](https://agents.md/)），不是产品功能文档。

## 开始工作前
1. 阅读 [文档中心](docs/README.md) 与 [中文设计目录](docs/design/README.md)，以批准后的设计为依据。
2. 阅读 [AI 上下文](docs/ai/README.md)、[架构边界](.agents/rules/architecture.md)、[安全质量](.agents/rules/security-quality.md) 与 [文档规则](.agents/rules/documentation.md)。
3. **变更任何产品代码、Schema 或配置时**运行 [docs-sync Skill](.agents/skills/docs-sync/SKILL.md)；涉及重大设计调整时先运行 [architecture-review](.agents/skills/architecture-review/SKILL.md)。
4. 当前为可运行的实验性应用（Fastify API、Next.js Web、PostgreSQL、Worker），**尚未完成生产验收**；启动与测试状态只按真实结果报告。

## 不可突破的约束
- 采用**模块化单体 + 可独立部署的 Worker 进程**；业务模块独立拥有数据写入权，跨模块通过公开命令/查询。
- PostgreSQL 为正式项目事实来源；LLM 只能生成带证据的候选变更，不能直接改正式任务、风险和决策。
- 领域状态变更采用数据库事务 + Outbox；消费者幂等，消息至少一次投递，不把 Redis 当唯一事实源。
- Tenant / Project 权限在后端校验；授权、人工审批、审计不能只放在 Prompt 中。
- 显式记录候选提取的来源、模型/规则版本、审批者、执行结果；不清楚的内容必须追问。
- 时间持久化 UTC，按项目时区决定提醒、周报和静默窗口。
- 不引入旧系统兼容层、微服务拆分、通用多 Agent 平台或未验证的复杂抽象。

## 实施规则
- 修改架构之前先改 `docs/design/` 并在 [ADR](docs/design/decision-log.md) 留痕；未经审查不得把“设计中”改成“已批准”。
- 代码变更和 `docs/ai/` + 对应 `docs/design/` 文档变更在**同一个 PR**；公共行为变更需同步中英文社区文档。
- 必须在完成前运行 `node tools/docs/check-docs.mjs`；产品代码变更的 PR 还需运行 `node tools/docs/check-sync.mjs <base> <head>`。
- TypeScript strict、单向模块依赖、并发与幂等测试、权限及越权测试是实施阶段验收门槛；仅汇报**实际执行**过的检查。
