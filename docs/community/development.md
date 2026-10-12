# 开发与部署 / Development and Deployment

[中文](#中文) · [English](#english)

## 中文

开发建议 Node.js 24 LTS；Docker 仅用于可选的 PostgreSQL 开发实例。在仓库根目录：

```bash
cp .env.example .env
# 请将 SESSION_SECRET 更换为至少 32 字符的随机字符串
docker compose -f infra/compose.yml up -d
npm ci
npm run db:migrate
```

分别在三个终端运行：

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

打开 http://localhost:3000，注册、创建项目、与成员聊天。系统默认不向外部模型发送内容；要启用 AI 需在服务端设置 `OPENAI_API_KEY` 并由项目负责人在设置页面明确开启。催办需任务负责人/期限及完整工作时间和冷却策略。

生产构建：`npm run build`，编译后执行 `npm run db:migrate:prod`、`npm run start:api`、`npm run start:worker`、`npm run start:web`。浏览器请求统一使用同源 `/api`，服务端通过 `API_INTERNAL_URL` 连接 API（默认 127.0.0.1:3001）。

检查命令：`npm run typecheck`、`npm test`、`npm run build:web`、`npm run check:docs`。更新代码需执行 [docs-sync](../../.agents/skills/docs-sync/SKILL.md)。

未完成的功能和安全验收见 [实施状态](../design/implementation-status.md)。[English](#english)。

### 可靠性说明
消息增量游标按项目提交顺序保证不漏读；重新调整任务不会绕过已发送提醒的冷却间隔。周/月报统计覆盖全项目，明细有条数上限；同周期草稿可以重新生成，已发布报告不可覆盖。这些行为可通过 `node tools/test/smoke.mjs` 在已迁移的 PostgreSQL 实例上回归。

### 澄清与失败恢复
AI 开启后，缺字段的候选任务在群聊中包含「【候选:UUID】」。成员回复携带该引用并提供明确负责人或带时区期限，AI 只保存待审核线索；项目负责人仍需确认候选。项目负责人在「设置」中能查看和重试隔离事件。AI_DAILY_REQUEST_LIMIT 服务端环境变量按项目限制每日调用数，默认 50，AI 仍默认关闭。数据库回归：`node --import tsx packages/core/test/outbox.integration.ts`。

### 自动报告补充
Worker 只在项目时区符合计划时创建本期周/月报一次；不会每次轮询覆盖草稿。负责人可重新生成未发布报告，已发布报告保持不变。数据库回归：`node --import tsx packages/core/test/reports.integration.ts`。

### 团队与项目 API

注册后可调用 `GET /tenants` 获取用户所属团队及角色。创建项目必须在 `POST /projects` 请求体中提供 `tenantId`、`name` 和 `timezone`，且当前用户须是所选团队的管理员；不再隐式选择某个团队。项目负责人可以移除普通成员，但成员仍负责未完成任务时会返回 409，必须先转移或取消这些任务，以免遗留无法处理的催办。退出登录会撤销服务器端会话。

### GitHub 合并检查

贡献 PR 需通过 `verify`（应用与数据库验证）和 `documentation`（文档治理）。维护者在 GitHub Rulesets 中设置必需状态检查；详细操作见 [合并门禁说明](maintainers.md)。项目列表接口返回工作时间与冷却配置字段，未设置时为 `null`；修改项目设置应覆盖 API 回归测试。

### 不使用 Docker 的 Windows 11 安装

1. 安装 Node.js 24、PostgreSQL 17 和 Git；创建数据库及专用用户并授予必要权限，确保 `pg_dump` / `pg_restore` 可执行。
2. 在 PowerShell 根目录执行 `Copy-Item .env.example .env`，设置数据库连接、随机 SESSION_SECRET 和部署对外 WEB_ORIGIN。
3. 执行 `npm ci; npm run build; npm run db:migrate:prod`，确认无错误。
4. 分别开三个 PowerShell 窗口执行 `./infra/windows/start.ps1 api`、`./infra/windows/start.ps1 worker`、`./infra/windows/start.ps1 web`；浏览器打开 http://localhost:3000。
5. 如需 Windows Service，先自行从 WinSW 官方来源取得并验证可执行文件，再以管理员执行 `./infra/windows/install-services.ps1 -WinSWPath <WinSW路径>`。该脚本只注册服务，投入生产前必须设置最小权限运行账户、目录 ACL、自动启动及停止/重启演练。

### 不使用 Docker 的 Linux 安装

1. 安装 Node.js 24、PostgreSQL 17（本机或远端）、PostgreSQL 客户端工具；创建独立系统用户 `chatpm`。
2. 将源码安装在 `/opt/chatpm`；运行 `npm ci && npm run build && npm run check:distribution`。
3. 设置 `/etc/chatpm/chatpm.env`（仅服务账户可读），至少提供生产 NODE_ENV、DATABASE_URL、随机 SESSION_SECRET、WEB_ORIGIN、API_HOST=127.0.0.1。执行 `npm run db:migrate:prod`。
4. 复制 `infra/linux/*.service` 至 `/etc/systemd/system/`，按实际 Node 路径调整 `ExecStart`，执行 `sudo systemctl daemon-reload && sudo systemctl enable --now chatpm-api chatpm-worker chatpm-web`。
5. 通过 `infra/proxy/Caddyfile` 配置公网域名和 HTTPS；不要直接向互联网暴露 API/数据库端口。部署路径及文件权限应允许 ChatPM 账户读取构建产物且只写必要的 Next 缓存。

### 一键 Docker Compose 自部署

复制 `.env.example` 到 `.env`，配置生产随机 `SESSION_SECRET`、`POSTGRES_PASSWORD` 和 `WEB_ORIGIN`。执行：

```bash
docker compose -f infra/compose.prod.yml up -d --build
docker compose -f infra/compose.prod.yml ps
```

默认仅监听本机 `127.0.0.1:3000`。公网访问应由 HTTPS 反向代理接入；数据库持久化为命名卷。开发用 `infra/compose.yml` 仍只有 PostgreSQL。

### 备份、恢复和正式上线限制

`node tools/ops/postgres.mjs backup ./backups/chatpm.dump` 需要 PostgreSQL 客户端。恢复到隔离实例前停止服务，执行 `node tools/ops/postgres.mjs restore ./backups/chatpm.dump --confirm-replace`，这会覆盖目标库对象。必须另行建立自动备份、加密和恢复演练。

以上是部署入口及示例，并非 Windows Service、Linux 服务、HTTPS、性能、隐私与生产灾备的已通过实机验收；敏感项目上线仍需完成这些验收。参见 [部署架构](../design/deployment.md)。

#### Compose 数据库备份特别说明

生产 Compose 不向宿主机暴露 5432 端口，因此不能直接使用示例 `.env` 里的本地 `DATABASE_URL` 备份 Compose 数据库。可在宿主机执行：

```bash
mkdir -p backups
docker compose -f infra/compose.prod.yml exec -T postgres pg_dump -U chatpm -d chatpm -Fc > backups/chatpm.dump
```

恢复时先停止 Web/API/Worker，在隔离的目标环境内使用 `docker compose -f infra/compose.prod.yml exec -T postgres pg_restore -U chatpm -d chatpm --clean --if-exists --no-owner --no-privileges < backups/chatpm.dump`，**不要在正在服务的生产数据库直接恢复**。

---

## English

Node.js 24 LTS is recommended; Docker is optional and only provides the development PostgreSQL instance. From the repository root:

```bash
cp .env.example .env
# Replace SESSION_SECRET with a random string at least 32 characters long
docker compose -f infra/compose.yml up -d
npm ci
npm run db:migrate
```

Start three terminals:

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

Open http://localhost:3000, register and create a project. External AI is disabled by default. To opt in, set `OPENAI_API_KEY` on the server and enable AI explicitly in project settings. Reminders require a task owner, due date, working hours and cooldown policy.

Production: run `npm run build`, `npm run db:migrate:prod`, and start the compiled `start:api`, `start:worker`, and `start:web` scripts. The browser always uses same-origin `/api`, which is forwarded to `API_INTERNAL_URL` by Next.js.

Checks: `npm run typecheck`, `npm test`, `npm run build:web`, `npm run check:docs`. Changes must follow [docs-sync](../../.agents/skills/docs-sync/SKILL.md).

See [implementation gaps (Chinese)](../design/implementation-status.md) for unimplemented features and security limitations. [中文](#中文).

### Reliability notes
The per-project message cursor follows transaction commit order to prevent missing chat messages. Replanning a task preserves the cooldown of its last reminder. Weekly/monthly counts cover all project tasks while detail lists are bounded; drafts can be regenerated, but published reports remain immutable. Verify these behaviors with `node tools/test/smoke.mjs` against a migrated PostgreSQL instance.

### clarification and recovery
For opted-in AI, tasks with missing details get a `【候选:UUID】` reference. Team members may reply with the exact reference and an explicit assignee or timezone-aware deadline. Suggestions remain pending until the project owner approves them. Owners may inspect and retry quarantined background events in Settings. AI_DAILY_REQUEST_LIMIT limits each project's daily model calls (default 50); external AI remains disabled by default. Database regression: `node --import tsx packages/core/test/outbox.integration.ts`.

### Scheduled reporting
The Worker creates a scheduled weekly/monthly report only once per project and reporting period. Polling does not overwrite drafts; owners can manually regenerate an unpublished draft, while published reports remain unchanged. Database regression: `node --import tsx packages/core/test/reports.integration.ts`.

### Tenant and project API

Call `GET /tenants` to list the user's teams and roles. `POST /projects` requires explicit `tenantId`, `name`, and `timezone`; the authenticated user must be an administrator of that team. There is no implicit default tenant selection. A project owner may remove a regular member, but the API returns 409 while that member owns unfinished tasks; reassign or cancel those tasks first to avoid orphaned reminders. Logout revokes the server-side session.

### Required GitHub checks

PRs must pass the `verify` (product and database validation) and `documentation` (documentation governance) jobs. Maintainers must select those exact GitHub Actions checks in the repository ruleset; see [branch protection guide](maintainers.md). The project listing API includes work hours and cooldown settings, returning explicit `null` values when not configured; API regression tests cover these fields.

### Native Windows 11 (no Docker)

Install Node.js 24 and PostgreSQL 17 (including `pg_dump` and `pg_restore`). Create a dedicated database and user. From PowerShell: `Copy-Item .env.example .env`, configure database credentials and a secure SESSION_SECRET, then `npm ci; npm run build; npm run db:migrate:prod`. Start three PowerShell windows with `./infra/windows/start.ps1 api`, `./infra/windows/start.ps1 worker`, and `./infra/windows/start.ps1 web`.

For Windows services, obtain and verify WinSW independently, then run `./infra/windows/install-services.ps1 -WinSWPath <path>` as administrator. It registers services only; choose least-privilege accounts, protect files and verify start/stop/restart before production use.

### Native Linux (no Docker)

Install Node.js 24, PostgreSQL 17 and client utilities. Install the source at `/opt/chatpm`, create a dedicated `chatpm` user, and run `npm ci && npm run build && npm run check:distribution`. Supply `NODE_ENV=production`, DATABASE_URL, SESSION_SECRET, WEB_ORIGIN and API_HOST=127.0.0.1 in a restricted `/etc/chatpm/chatpm.env`. Run `npm run db:migrate:prod`. Install the templates from `infra/linux/` to systemd, adjust the actual Node path and start `chatpm-api`, `chatpm-worker`, `chatpm-web`. Put Caddy or another HTTPS proxy in front of Web; do not expose the API/database publicly.

### Complete Docker Compose

Set POSTGRES_PASSWORD, SESSION_SECRET and WEB_ORIGIN in root `.env`. Run `docker compose -f infra/compose.prod.yml up -d --build`. Only `127.0.0.1:3000` is published; add a secure external HTTPS proxy to expose it. `infra/compose.yml` remains the database-only development Compose.

### Database operations and release status

`node tools/ops/postgres.mjs backup ./backups/chatpm.dump` creates a PostgreSQL custom-format backup. After stopping ChatPM and selecting an isolated target, `node tools/ops/postgres.mjs restore ./backups/chatpm.dump --confirm-replace` **overwrites database objects**. Automated backups, real recovery exercises, TLS, Windows service resilience, operational alerts, and production security certification have not been completed; do not use sensitive production data.

#### Compose database backups

Production Compose does not publish port 5432. Back up through the PostgreSQL container instead of the host example DATABASE_URL:

```bash
mkdir -p backups
docker compose -f infra/compose.prod.yml exec -T postgres pg_dump -U chatpm -d chatpm -Fc > backups/chatpm.dump
```

After stopping Web/API/Worker and selecting a disposable restore target, use `docker compose -f infra/compose.prod.yml exec -T postgres pg_restore -U chatpm -d chatpm --clean --if-exists --no-owner --no-privileges < backups/chatpm.dump`. Do not restore into a live production database.
