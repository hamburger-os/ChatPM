# 系统架构与技术选型

## 架构选择
采用**TypeScript Monorepo + 模块化单体**：Web 前端、API 进程、异步 Worker 进程，共享清晰的领域模块和契约。初期使用一个 PostgreSQL 业务数据库，不拆微服务。API 与 Worker 可以独立扩缩容，但属于同一个产品系统。

`Web (Next.js) → API (Fastify) → 领域模块 → PostgreSQL`

`数据库 Outbox → 事件发布器 → PostgreSQL 轮询 Worker → 领域命令 / 外部渠道`

`Worker → AI 编排器 → Model Adapter（可替换模型）`

## 技术组件
| 组件 | 方案 | 选择理由 |
|---|---|---|
| Web | Next.js + React + CSS | 聊天与任务界面统一开发 |
| API | Fastify + TypeScript strict | 模块治理、验证、注入及测试结构 |
| 数据 | PostgreSQL + pg，不额外引入 ORM | 事务、约束、版本化业务记录；按模块拆分 SQL 所有权 |
| 异步调度 | PostgreSQL Outbox 与轮询 Worker | 初期避免双持久化，按规模再引入独立队列 |
| 附件（规划） | S3 兼容对象存储 | 原始附件独立于业务表；当前未交付 |
| 知识检索（规划） | PostgreSQL 全文检索优先，pgvector 按效果引入 | 当前未交付，不把向量相似度当事实 |
| AI | 单一编排器 + Provider 接口 | 避免锁定模型及多 Agent 复杂性 |
| 部署 | 同一编译核心 + Docker Compose / Windows / Linux | 不锁定部署工具；使用统一配置、迁移和 HTTP 契约 |

## 领域边界
Identity/Tenancy、Projects、Conversations、Work、Risk/Decision、AI Orchestration、Automation、Knowledge、Reporting、Integrations、Audit。每个模块拥有数据写入权，跨模块通过明确服务契约调用。所有入口依赖同一鉴权与审计体系。

## 取舍和扩展
- **不用微服务**：初期一致性与运维比独立部署更重要；通过领域边界为将来拆分做准备，而非现在就承担分布式成本。
- **不全量事件溯源**：当前需求以当前业务状态 + 历史/审计为主，避免事件重放和版本演化复杂性。
- **不把队列作为事实源**：跟进计划保存在 PostgreSQL；当前使用 PostgreSQL 轮询，确有性能需求后再考虑独立队列。
- 未来瓶颈明显时，先独立扩 Worker，再考虑独立服务或专用检索引擎，需追加 ADR。

## 非目标
本设计没有任何旧系统接口和前后兼容包袱；一切从统一领域契约开始。

## 运行时边界与部署目标

目前 API、Web、Worker 分进程运行，PostgreSQL 是唯一正式项目事实来源；Worker 直接轮询事务型 Outbox 和跟进计划，不依赖 Redis/BullMQ。聊天使用 HTTP 轮询。所有外部 AI 请求需要项目负责人开启。

目标为共用产品核心的官方 SaaS 与自部署，云端与本地模型通过适配器接入。只有在实测需求充分时才增加其他分布式组件，避免建立无使用依据的兼容层。

详见 [部署架构和跨平台运行契约](deployment.md)，完整生产安全验收仍未完成。
