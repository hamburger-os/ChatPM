# 开发指引

**状态：v0.1 实验性 MVP，可本地运行但未完成生产验收。**

需要 Node.js 22+ 和 Docker。在仓库根目录：

```bash
cp .env.example .env
# 请将 SESSION_SECRET 更换为至少 32 字符的随机字符串
docker compose -f infra/compose.yml up -d
npm install
npm run db:migrate
```

分别在三个终端运行：

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

打开 http://localhost:3000，注册、创建项目、与成员聊天。系统默认不向外部模型发送内容；要启用 AI 需在服务端设置 `OPENAI_API_KEY` 并由项目负责人在设置页面明确开启。催办需任务负责人/期限及完整工作时间和冷却策略。

检查命令：`npm run typecheck`、`npm test`、`npm run build:web`、`npm run check:docs`。更新代码需执行 [docs-sync](../../../.agents/skills/docs-sync/SKILL.md)。

未完成的功能和安全验收见 [实施状态](../../design/implementation-status.md)。[English](../en/development.md)。
