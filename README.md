# ChatPM — 开源 AI 项目经理

> 让项目聊天室里的承诺不再被遗忘。AI 提取有证据的候选事项、协助确认责任人与期限、跟进正式任务并生成待审核的项目报告。

**状态：实验性可运行原型；尚未完成生产级安全、性能与隐私验收。** [Apache-2.0](LICENSE) · [中文文档](docs/README.md) · [English](docs/community/en/overview.md)

## 已实现的能力

- 注册与登录、团队及项目、成员协作、消息持久化与增量拉取。
- 项目负责人显式启用外部 AI 后异步提取候选任务和风险；默认不向模型发送聊天内容。
- AI 建议保留消息依据；负责人审批正式任务、风险和澄清后的负责人/期限；任务版本冲突有保护。
- 后台按工作时间跟进已有负责人及期限的任务，并通过持久 Outbox 管理失败重试和隔离。
- 周/月项目当前状态报告草稿，负责人审核发布。**当前不是历史周期变化分析。**

**尚未实现：** 本地模型与多提供商接入、文档知识库、自动语义关联、完整风险升级、实时推送、完整企业身份管理和正式 SaaS 运营。以上属于 [路线图](docs/design/roadmap-acceptance.md)，不是现有功能。

## 本地开发

需要 Node.js 22+ 和 Docker。复制环境配置，并设置高强度随机 `SESSION_SECRET`。

```bash
cp .env.example .env
docker compose -f infra/compose.yml up -d
npm ci
npm run db:migrate
npm run dev:api
```

另开两个终端分别运行 `npm run dev:worker` 和 `npm run dev:web`；访问 http://localhost:3000。健康检查：http://localhost:3001/health 。

默认不开启模型；如需向外部模型发送项目聊天，需先配置服务端 `OPENAI_API_KEY`，再由项目负责人显式启用。请先确认组织的数据处理要求。未启用时仍可手动创建任务、发送聊天和生成报告。

## 验证

```bash
npm run typecheck
npm test
npm run db:migrate
node --import tsx packages/core/test/outbox.integration.ts
node --import tsx packages/core/test/ai.integration.ts
node --import tsx packages/core/test/reports.integration.ts
node tools/test/smoke.mjs
npm run build:web
npm run check:docs
```

集成测试需要可用的 PostgreSQL；CI 会自动执行。

## 参与开源

- [参与贡献](CONTRIBUTING.md) · [社区行为准则](CODE_OF_CONDUCT.md) · [漏洞报告](SECURITY.md) · [支持渠道](SUPPORT.md)
- [治理与维护](GOVERNANCE.md) · [架构和设计](docs/design/README.md) · [当前能力与限制](docs/design/implementation-status.md)
- [Issues](https://github.com/hamburger-os/ChatPM/issues) · [Discussions（启用后）](https://github.com/hamburger-os/ChatPM/discussions)

**English:** ChatPM is an experimental, chat-centered AI project management tool. It keeps evidence-linked proposals separate from approved project facts. Cloud and self-hosted deployment with cloud/local model options are product goals; they are not all shipped today. See the [English guide](docs/community/en/development.md).
