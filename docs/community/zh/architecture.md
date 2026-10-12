# 社区架构简介

设计采用 **TypeScript Monorepo、模块化单体和独立 Worker 进程**。Web 使用 Next.js， API 使用 Fastify，PostgreSQL 保存业务事实，PostgreSQL Outbox + Worker 轮询完成异步分析与提醒。模型和通知渠道通过适配器连接，未来可替换。

## 主要模块
- 项目与权限：成员、租户、项目作用域。
- 实时群聊：消息持久化、引用、重连补拉。
- 任务、风险与决策：正式业务状态及审批。
- AI 编排：从上下文提出有证据的候选变更。
- 提醒和报告：后台执行、去重、可核查汇报。
- 知识资料：带版本和权限的附件/索引。

**注意**：模型不能直接改正式任务；提交由领域命令和服务端权限控制。数据更新与事件通过事务 Outbox 衔接。

[详细中文方案](../../design/system-architecture.md) · [English](../en/architecture.md)
