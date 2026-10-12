# 开发指引

**当前仓库只有设计文档和文档校验工具；业务代码尚未创建。** 请勿将规划中的技术栈当作已经安装。

## 设计阶段的可用操作
- 浏览 [docs/README.md](../../README.md) 和 [根 AGENTS.md](../../../AGENTS.md)。
- 安装本机 Node.js 后，从仓库根目录运行 `node tools/docs/check-docs.mjs` 校验目录和链接。
- 对有产品代码改动的 PR，运行 `node tools/docs/check-sync.mjs origin/main HEAD` 验证最低文档同步要求。

## 未来应用结构（尚未创建）
`apps/web`（Next.js）、`apps/api`（NestJS）、`apps/worker`（异步任务）；`packages` 下共享领域契约与适配器。技术落地前先审阅对应中文设计。

## 贡献原则
优先补齐场景和验收；提交新代码同时更新 AI 文档、中文设计和必要的社区中英文说明。测试命令应以未来真实仓库脚本为准，不得伪称已经可运行。

[English](../en/development.md)
