# ChatPM · AI 项目经理

> 群聊驱动的项目管理：AI 协助提取候选任务、跟进进度并起草报告，正式项目状态仍由人确认。

**状态：v0.1 MVP（本地试验版），不是生产就绪产品。** 已审查的设计和 [实施差距](docs/design/implementation-status.md) 请从 [文档中心](docs/README.md) 阅读。

## v0.1 能做什么
- 注册、创建项目、邀请已注册成员、项目群聊及消息持久化。
- 项目负责人显式启用外部 AI 后，异步提取候选任务和风险；默认**不向外部模型发送项目聊天**。
- 负责人确认/拒绝候选；任务状态具备并发版本校验，AI 无权直接修改正式任务。
- 设置工作时间和提醒频率后，后台 Worker 跟进有负责人及截止日期的任务。
- 周/月报依据当前项目快照生成草稿，由负责人审核发布。

## 本地启动
需要 Node.js 22+、Docker：

```bash
cp .env.example .env
# 修改 SESSION_SECRET 为至少 32 位随机字符串
docker compose -f infra/compose.yml up -d
npm install
npm run db:migrate
```

分别打开三个终端：
```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

打开 http://localhost:3000；API 健康检查：http://localhost:3001/health 。

要启用模型，先设置服务端 `OPENAI_API_KEY`，再由项目负责人在设置页确认启用；此后相应项目的聊天内容会发往配置的外部模型，需符合组织数据处理要求。未配置时仍可手动维护任务和生成报告。

## 验证
```bash
npm run typecheck
npm test
npm run build:web
npm run check:docs
```

## 文档
[中文架构方案](docs/design/README.md) · [实施状态和差距](docs/design/implementation-status.md) · [AGENTS.md](AGENTS.md) · [docs-sync](.agents/skills/docs-sync/SKILL.md) · [社区中文](docs/community/zh/overview.md) · [English](docs/community/en/overview.md)。

尚未实现文件知识库、WebSocket 推送、风险升级、SSO、多模型等高级功能；也未完成生产安全与可靠性验收。项目尚未选定开源许可证，请勿假定可自由再分发或商用。

## English
ChatPM is a chat-centered, evidence-oriented AI project management tool. The experimental MVP provides project chat, opt-in candidate extraction, human approvals, reminders and report drafts. See the [English development guide](docs/community/en/development.md). Not production-ready.
