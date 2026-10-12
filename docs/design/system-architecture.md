# 系统架构与技术选型

**状态：设计基线已审查（尚未实施）。**

## 架构选择
采用**TypeScript Monorepo + 模块化单体**：Web 前端、API 进程、异步 Worker 进程，共享清晰的领域模块和契约。初期使用一个 PostgreSQL 业务数据库，不拆微服务。API 与 Worker 可以独立扩缩容，但属于同一个产品系统。

`Web (Next.js) → API (NestJS) → 领域模块 → PostgreSQL`

`数据库 Outbox → 事件发布器 → PostgreSQL 轮询 Worker → 领域命令 / 外部渠道`

`Worker → AI 编排器 → Model Adapter（可替换模型）`

## 技术组件
| 组件 | 方案 | 选择理由 |
|---|---|---|
| Web | Next.js + React + Tailwind | 聊天与任务界面统一开发 |
| API | Fastify + TypeScript strict（v0.1） | 模块治理、验证、注入及测试结构 |
| 数据 | PostgreSQL + Prisma（拟定） | 事务、约束、版本化业务记录 |
| 异步调度 | PostgreSQL Outbox 与轮询 Worker | 初期避免双持久化，按规模再引入独立队列 |
| 文档 | S3 兼容对象存储 | 原始附件独立于业务表 |
| 检索 | PostgreSQL 全文检索优先，pgvector 按效果引入 | 不把向量相似度当事实 |
| AI | 单一编排器 + Provider 接口 | 避免锁定模型及多 Agent 复杂性 |
| 部署 | Docker Compose 开发，后续按规模迁移 | 控制初期运维成本 |

## 领域边界
Identity/Tenancy、Projects、Conversations、Work、Risk/Decision、AI Orchestration、Automation、Knowledge、Reporting、Integrations、Audit。每个模块拥有数据写入权，跨模块通过明确服务契约调用。所有入口依赖同一鉴权与审计体系。

## 取舍和扩展
- **不用微服务**：初期一致性与运维比独立部署更重要；通过领域边界为将来拆分做准备，而非现在就承担分布式成本。
- **不全量事件溯源**：当前需求以当前业务状态 + 历史/审计为主，避免事件重放和版本演化复杂性。
- **不把队列作为事实源**：跟进计划保存在 PostgreSQL；BullMQ 只负责任务分发。
- 未来瓶颈明显时，先独立扩 Worker，再考虑独立服务或专用检索引擎，需追加 ADR。

## 非目标
本设计没有任何旧系统接口和前后兼容包袱；一切从统一领域契约开始。

## v0.1 实施变更
API 首版选 Fastify，替代计划中的 NestJS；后台 Worker 直接从 PostgreSQL Outbox 与 FollowUpPlan 领取事件及提醒，不引入 Redis/BullMQ。理由是减少依赖和双写故障，保留 API/Worker 分进程与领域契约。前端为 Next.js，聊天室暂时短轮询，待性能需要时再升级实时连接；详见 ADR-011 至 ADR-013。
