# 开发指引

**状态：v0.2 实验性 MVP，可本地运行但未完成生产验收。**

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

## 可靠性说明
消息增量游标按项目提交顺序保证不漏读；重新调整任务不会绕过已发送提醒的冷却间隔。周/月报统计覆盖全项目，明细有条数上限；同周期草稿可以重新生成，已发布报告不可覆盖。这些行为可通过 `node tools/test/smoke.mjs` 在已迁移的 PostgreSQL 实例上回归。

## v0.2 澄清与失败恢复
AI 开启后，缺字段的候选任务在群聊中包含「【候选:UUID】」。成员回复携带该引用并提供明确负责人或带时区期限，AI 只保存待审核线索；项目负责人仍需确认候选。项目负责人在「设置」中能查看和重试隔离事件。AI_DAILY_REQUEST_LIMIT 服务端环境变量按项目限制每日调用数，默认 50，AI 仍默认关闭。数据库回归：`node --import tsx packages/core/test/outbox.integration.ts`。
