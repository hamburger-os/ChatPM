# 开发与部署 / Development and Deployment

[中文](#中文) · [English](#english)

## 中文

开发建议 Node.js 24 LTS；开发环境可用 Docker 仅启动 PostgreSQL，正式部署另有完整 Compose 或 Windows/Linux 原生安装方案。在仓库根目录：

```bash
cp .env.example .env
# 请将 SESSION_SECRET 更换为至少 32 字符的随机字符串
docker compose -f infra/compose.yml up -d
npm ci
npm run db:migrate
```

开发时只需一个终端（内部仍启动三个独立进程），需要停止时可在另一个终端执行 `npm run stop`：

```bash
npm run dev
```

打开 http://localhost:3000，注册、创建项目、与成员聊天。系统默认不向外部模型发送内容；要启用 AI，需由系统管理员在「系统管理 → AI 服务中心」设置供应商与默认模型，再由项目负责人在项目设置页面明确开启。催办需任务负责人/期限及完整工作时间和冷却策略。

原生首次安装可执行 `npm run setup:local`：不存在 `.env` 时创建含随机会话密钥的配置；如数据库仍使用模板凭证，命令将停止并提示配置。完成数据库配置后重新执行。底层 `npm run setup:native`（安装依赖、构建、校验产物、执行迁移），然后 `npm start` 可在**单个前台终端**运行三进程；在另一终端执行 `npm run stop` 可以等待整组停止，也可在原终端按 `Ctrl+C`。长期运行应交给下述 Windows/Linux 系统服务管理器。浏览器请求统一使用同源 `/api`，服务端通过 `API_INTERNAL_URL` 连接 API（默认 127.0.0.1:3001）。

检查命令：`npm run typecheck`、`npm test`、`npm run build:web`、`npm run check:docs`。更新代码需执行 [docs-sync](../../.agents/skills/docs-sync/SKILL.md)。

未完成的功能和安全验收见 [实施状态](../design/implementation-status.md)。[English](#english)。

### 系统管理员配置供应商与模型（Windows 11 / Linux / Docker）

`.env` 仅保留部署所需的数据库、会话及 `MODEL_ENCRYPTION_KEY` 等**根配置**，不再填写单个供应商的 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_STYLE`。

首次启动数据库迁移完成后，注册账号，由可信服务器操作员执行：

```bash
npm run admin:grant -- --email=admin@example.com --confirm
```

系统管理员使用同一登录页进入最左侧「系统管理 → AI 服务中心」，添加供应商连接（API 请求基础地址、协议、API Key），再在该连接下创建一个或多个模型并设置默认。普通项目成员无需配置密钥；项目负责人仅显式开启项目 AI。支持 Responses API 与 Chat Completions；当前不支持原生 Anthropic Messages。模型/供应商真实接口需通过测试连接验证，可能产生费用。

API Key 经过服务端 AES-256-GCM 加密保存到数据库，读接口只显示是否存在密钥。服务器根密钥 `MODEL_ENCRYPTION_KEY` 仍需由安全环境保存，不能在网页修改。Docker 容器内部 `localhost` 不等于 Windows 宿主机；可信的 `host.docker.internal` 本地代理需在封闭网络中验证。密钥/供应商连接更新不需要重启服务，修改服务器根密钥则需要计划维护。具体步骤及安全界限见 [供应商管理指南](navigation-provider-center.md#中文)。

「输入预算」以字符计算而不是 Token。ChatPM 会在项目授权范围内组装有限上下文和已批准任务事实，AI 候选仍需负责人核准。向项目聊天室发送 `@AI` 可以调用只读问答，规则式任务提醒与外部 AI 模型相互独立。

### 任务进展、日期与提前催办（ADR-022）

正式任务的期限现在只输入 **YYYY-MM-DD 日期**，不再需要选择小时与分钟。升级迁移会将现有任务时间按其项目设置的时区转换为日历日期，旧的 `dueAt` API 被替换为 `dueDate`；请务必备份数据库后再执行 `npm run setup:local` 或生产 Docker 更新。历史任务和审核记录不能删除。

在聊天室讨论已有任务时，Worker 现在尝试将内容关联到同项目活动任务 ID：阶段进展、阻塞、完成声明只生成证据建议，在右侧「任务」标签页核对后才归入进度，不会自动将任务设置为完成；独立新工作仍由「AI 待确认」审批。系统优先过滤明显重复的规范化标题，不能保证所有语义重叠都正确匹配。要人工更正请在 AI 待确认忽略错误新任务并在任务页更新正式状态。任务有负责人、期限与合法提醒工作窗口时，将在任务登记后进入跟进队列，不再等到最后一天才首次检查；阻塞与临近截止会更频繁，按项目时区和冷却发送站内提醒。

系统管理员可调整模型输入字符预算和输出 Token 限额；默认分别为 32768 字符与 8192 Token，最大可配置 250000 字符与 131072 Token。它们是应用预算，不等于特定供应商宣称的模型窗口或真实 Token 压缩。建议根据模型费用和输出长度测试后调整。`MODEL_SCHEMA` 确定性错误不再无意义重复请求八次，隔离事件需修复根因后再由 Owner 重放。正式连续 Agent、依赖关键路径计算和实际 DeepSeek 大上下文压测仍未完成。

### 可靠性说明
消息增量游标按项目提交顺序保证不漏读；重新调整任务不会绕过已发送提醒的冷却间隔。周/月报统计覆盖全项目，明细有条数上限；同周期草稿可以重新生成，已发布报告不可覆盖。这些行为可通过 `node tools/test/smoke.mjs` 在已迁移的 PostgreSQL 实例上回归。

### 澄清与失败恢复
AI 开启后，缺字段的候选任务在群聊中包含「【候选:UUID】」。成员回复携带该引用并提供明确负责人或带时区期限，AI 只保存待审核线索；项目负责人仍需确认候选。项目负责人在「设置」中能查看和重试隔离事件。AI_DAILY_REQUEST_LIMIT 服务端环境变量按项目 UTC 日期限制每日调用数，默认 50；Docker Compose 将该变量传给 Worker，AI 仍默认关闭。数据库回归：`node --import tsx packages/core/test/outbox.integration.ts`。

### 自动报告补充
Worker 只在项目时区符合计划时创建本期周/月报一次；不会每次轮询覆盖草稿。负责人可重新生成未发布报告，已发布报告保持不变。数据库回归：`node --import tsx packages/core/test/reports.integration.ts`。

### 团队与项目 API

注册后可调用 `GET /tenants` 获取用户所属团队及角色。创建项目必须在 `POST /projects` 请求体中提供 `tenantId`、`name` 和 `timezone`，且当前用户须是所选团队的管理员；不再隐式选择某个团队。项目负责人可以移除普通成员，但成员仍负责未完成任务时会返回 409，必须先转移或取消这些任务，以免遗留无法处理的催办。退出登录会撤销服务器端会话。

### GitHub 合并检查

贡献 PR 需通过 `verify`（应用与数据库验证）和 `documentation`（文档治理）。维护者在 GitHub Rulesets 中设置必需状态检查；详细操作见 [合并门禁说明](maintainers.md)。项目列表接口返回工作时间与冷却配置字段，未设置时为 `null`；修改项目设置应覆盖 API 回归测试。

### 不使用 Docker 的 Windows 11 安装

1. 安装 Node.js 24、PostgreSQL 17 和 Git；创建数据库及专用用户并授予必要权限，确保 `pg_dump` / `pg_restore` 可执行。
2. 在 PowerShell 根目录执行 `Copy-Item .env.example .env`，设置数据库连接、随机 SESSION_SECRET 和部署对外 WEB_ORIGIN。
3. 执行 `npm run setup:local`（会检查模板密码和环境），确认构建和迁移无错误。
4. 执行 `npm start` 直接在一个 PowerShell 终端运行三个进程；在另一个 PowerShell 执行 `npm run stop` 一键停止。浏览器打开 http://localhost:3000。仅适合前台试运行。
5. 开机自启应先将仓库安装到用户个人目录之外（如 `C:\\ChatPM`），使用系统级 Node.js，取得并验证官方 WinSW，以管理员身份执行 `./infra/windows/install-services.ps1 -WinSWPath <WinSW路径> -StartNow`。三个服务注册为 Automatic，并立即启动；可用 `Get-Service chatpm-*` 检查、`Restart-Service chatpm-api,chatpm-worker,chatpm-web` 重启。脚本显式安装为内置低权限 LocalService，授权运行目录读取、Next 缓存及日志写入，限制 `.env` 文件继承权限；管理员仍需审查所有显式 ACL 项与安装目录可写主体，确保普通账户不能替换程序文件，并演练重启及恢复。

### 不使用 Docker 的 Linux 安装

1. 安装 Node.js 24、PostgreSQL 17（本机或远端）及客户端工具，并创建数据库、数据库角色和独立系统用户 `chatpm`。
2. 将源码放在 `/opt/chatpm`，在仓库根目录从 `.env.example` 复制 `.env`；设置 `NODE_ENV=production`、`DATABASE_URL`、随机 `SESSION_SECRET`、`WEB_ORIGIN`、`API_HOST=127.0.0.1`，并确保 `.env` 只允许 `chatpm` 用户读取（建议 `chmod 600`）。开发模板的示例数据库密码不得用于正式环境。
3. 在 `/opt/chatpm` 使用拥有必要文件与数据库权限的账户执行 `npm run setup:local`。该命令依次安装依赖、构建、检查、迁移；systemd 也读取同一份 `/opt/chatpm/.env`，避免手动维护第二份配置。
4. 复制 `infra/linux/*.service` 至 `/etc/systemd/system/`，按实际 Node 路径调整 `ExecStart`，执行 `sudo systemctl daemon-reload && sudo systemctl enable --now chatpm-api chatpm-worker chatpm-web`。使用 `systemctl status chatpm-api chatpm-worker chatpm-web` 查看状态。
5. 通过 `infra/proxy/Caddyfile` 配置公网域名和 HTTPS；不要直接向互联网暴露 API/数据库端口。部署路径和 `.next` 缓存权限应符合 systemd 文件保护策略。

### 一键 Docker Compose 自部署

Docker/Compose 与 Node 已安装后，在仓库根目录执行：

```bash
npm run deploy:docker
```

首次自动创建 `.env` 并生成缺失/模板中的随机 SESSION_SECRET 与 POSTGRES_PASSWORD；不覆盖已有非占位符秘密，重复执行幂等。该命令不安装 Docker，不自动创建公网 TLS，也不覆盖已存在数据库。已有配置可继续直接执行 `docker compose --env-file .env -f infra/compose.prod.yml up -d --build`。Worker 使用 `AI_DAILY_REQUEST_LIMIT`（默认 50）；它限制调用次数而非 token 费用。查看运行状态：`docker compose --env-file .env -f infra/compose.prod.yml ps`；停服务：`docker compose --env-file .env -f infra/compose.prod.yml down`（不要添加 `-v`）。

默认仅监听本机 `127.0.0.1:3000`。已配置 `restart: unless-stopped`，但主机重启自动恢复仍需要 Docker 引擎随系统启动（Windows Docker Desktop 通常在用户登录后启动）。公网访问应由 HTTPS 反向代理接入；数据库持久化为命名卷。开发用 `infra/compose.yml` 仍只有 PostgreSQL。

### 跨平台可携式构建包（实验性）

`Cross-platform native builds` 在 CI 为 Windows/Linux 上传实验性 Artifact，包含正式 `dist` 与 Next 构建结果及运维工具，不包括数据库内容或密钥。解压后需安装 Node.js/npm 和 PostgreSQL，在目标机 `npm ci --omit=dev`、配置 `.env`、运行 `npm run db:migrate:prod` 后再启动。此产物尚不是签名 MSI/DEB/RPM，生产发布仍需签名、SBOM、源代码及依赖许可证复核、升级/卸载验收。

### 运维诊断、自动备份与升级

- `npm run doctor` 检查 API、PostgreSQL、Worker 心跳与 Outbox 延迟/隔离数，返回 0 表示当前检查通过，否则返回非零状态；正式监控应由外部系统读取该结果并报警。Docker 中使用 `docker compose --env-file .env -f infra/compose.prod.yml exec -T api node tools/ops/doctor.mjs`。部署完数据库迁移并启动 Worker 后，等待首个完整 tick 再检查。
- 原生备份：`npm run backup -- --dir=./backups --keep=14`；Docker 备份：`npm run backup:docker -- --dir=./backups --keep=14`。使用 `pg_dump` custom format、独立临时文件、完成后原子更名、失败清理临时文件。仅删除本工具命名的历史备份，默认保留最近 14 份。Linux 备份目录须只有服务用户可访问（权限 0700）；不要把此目录直接暴露给 Web。
- Linux：先以管理员创建 `sudo install -d -o chatpm -g chatpm -m 700 /var/lib/chatpm/backups`，复制 `infra/linux/chatpm-backup.service`、`chatpm-backup.timer`、`chatpm-doctor.service`、`chatpm-doctor.timer` 到 `/etc/systemd/system/`；之后执行 `sudo systemctl daemon-reload && sudo systemctl enable --now chatpm-backup.timer chatpm-doctor.timer`。检查 `systemctl list-timers` 和 `journalctl -u chatpm-backup.service -u chatpm-doctor.service`，将失败交给现有告警平台。
- Windows：完成 `install-services.ps1` 的 LocalService 权限配置后，以管理员执行 `./infra/windows/install-backup-task.ps1` 注册使用 LocalService 的每日 02:30 备份任务（可选 `-BackupDirectory`）。通过任务计划程序执行一次并检查产物；绝不能将密码写入任务参数。
- 原生升级：停掉全部 Web/API/Worker 后执行 `npm run upgrade:native -- --confirm-services-stopped`（可附 `--dir=/私有备份目录`）。工具拒绝 API 仍然在线的情况，并要求先成功备份，然后才执行新构建及数据库迁移。升级成功后需由管理员启动服务并复核。升级前另外确认最新备份完成且可读取，并持有安全的离机副本；安排维护窗口，停止 Web/API/Worker，安装/构建新版本，执行 `npm run db:migrate:prod`，启动各服务，运行 `doctor` 并确认核心登录、消息及 Worker。数据库 schema 没有通用向下迁移机制，不能因旧版代码能回退就假设数据库可以回滚。

以上是可部署的工具和定时任务模板，而非已经完成目标机器的开机故障恢复、加密离机复制、PITR、定期隔离恢复和集中告警验收。

### 备份、恢复和正式上线限制

`npm run backup -- --dir=./backups --keep=14` 使用 PostgreSQL 客户端和原子私有备份。恢复到隔离实例前停止全部服务，执行 `npm run restore -- ./backups/<实际归档文件>.dump --confirm-replace --confirm-services-stopped`，这会删除或覆盖归档包含的目标库对象。**恢复脚本不会自动执行迁移**。恢复成功后，必须在重新启动服务前另行运行：

```bash
npm run db:migrate:prod
```

仍须建立加密备份、离机保存与定期隔离恢复演练。

以上是部署入口及示例，并非 Windows Service、Linux 服务、HTTPS、性能、隐私与生产灾备的已通过实机验收；敏感项目上线仍需完成这些验收。参见 [部署架构](../design/deployment.md)。

#### Compose 数据库备份特别说明

生产 Compose 不向宿主机暴露 5432 端口，因此不能直接使用示例 `.env` 里的本地 `DATABASE_URL` 备份 Compose 数据库。可在宿主机执行：

```bash
mkdir -p backups
docker compose --env-file .env -f infra/compose.prod.yml exec -T postgres pg_dump -U chatpm -d chatpm -Fc > backups/chatpm.dump
```

恢复时先停止 Web/API/Worker，在隔离的目标环境内使用 `docker compose --env-file .env -f infra/compose.prod.yml exec -T postgres pg_restore -U chatpm -d chatpm --clean --if-exists --no-owner --no-privileges < backups/chatpm.dump`，**不要在正在服务的生产数据库直接恢复**。

---

### QNAP NAS、局域网域名与 IPv6 试运行（须实机验收）

1. QNAP Container Station 所在宿主机需要提供 Docker Compose、持久数据库卷与足够资源；检查 NAS CPU 架构和镜像支持，先在局域网验证构建及数据库恢复。首次在仓库根目录按现有 `npm run deploy:docker` 初始化，不能覆盖已建立的数据卷或既有密钥。
2. 在根目录 `.env` 把 `WEB_ORIGIN` 设为用户实际访问的唯一 HTTPS 域名，例如 `https://pm.example.com`。修改后重建 API/Worker 容器并重新登录，勿把 127.0.0.1、HTTP 内网地址与 HTTPS 域名混用为两个登录入口；写请求按 Origin 严格检查。
3. 默认 `infra/compose.prod.yml` **只发布宿主机 127.0.0.1:3000**，这是安全默认设置。QNAP 宿主机反向代理若能访问该回环端口，可将子域名的 HTTPS 443 代理到 Web；若代理运行在另一容器，则用受控共享 Docker 网络连接 Web，**不能**把容器自身的 127.0.0.1 当作 QNAP 宿主机。不要公布 API 3001、数据库 5432 或内网管理端口。
4. 域名 A/AAAA/DDNS、IPv6 入站防火墙、TLS 证书续期与路由器连接均依实际网络条件配置。使用不同网络的电脑、手机 Wi-Fi、手机蜂窝网分别实测，含登录续期、发送消息、任务写入、AI Key 保密、服务重启及数据库备份恢复。私人团队优先通过受控 VPN 远程访问；未完成安全验收前不建议开放注册和公网业务数据。
5. 容器内模型连接填写 `http://127.0.0.1:8045` 表示**同一容器**的 8045，并非你的 Windows 电脑或 NAS 宿主机；需要可达、受信的模型代理地址及防止未授权内网出站的配置。当前 URL 校验不代表完成 DNS/SSRF 安全隔离。

## English

### System-admin provider configuration (Windows / Linux / Docker)

The root `.env` retains database credentials, session signing material and the server-only `MODEL_ENCRYPTION_KEY`. It does **not** contain per-provider `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` or `LLM_API_STYLE` entries. After migration and account registration, a trusted server operator runs `npm run admin:grant -- --email=admin@example.com --confirm`. The same account then signs in normally and opens **System Management → AI Service Center** on the global left rail. Add a provider connection (API base URL, supported protocol, API key), register models under it, select a default and test the connection. Project owners explicitly enable AI per project. Only Responses and Chat Completions transport adapters are implemented; vendor behavior must be verified.

Provider keys are encrypted in PostgreSQL and never returned by read endpoints. The server-side `MODEL_ENCRYPTION_KEY` cannot be edited or retrieved in the browser. In a Docker container, localhost is not the Windows host; trust and network boundaries apply to `host.docker.internal`. Changing provider models or API keys requires no restart; rotating the root encryption key needs an explicit recovery plan. See [provider setup](navigation-provider-center.md#english).

Node.js 24 LTS is recommended; Docker can provide a database-only development instance or a complete production-style Compose stack. Native Windows/Linux deployment is also supported. From the repository root:

```bash
cp .env.example .env
# Replace SESSION_SECRET with a random string at least 32 characters long
docker compose -f infra/compose.yml up -d
npm ci
npm run db:migrate
```

Start all three development processes in **one terminal**; stop them from a second terminal with `npm run stop` (or press Ctrl+C in the first):

```bash
npm run dev
```

Open http://localhost:3000, register and create a project. External AI is disabled by default. To opt in, ask the system administrator to configure a default provider/model in the UI, then explicitly enable AI in project settings. Reminders require a task owner, due date, working hours and cooldown policy.

Native installation after configuring PostgreSQL and `.env`: run `npm run setup:local` (generates a missing secret and rejects the sample PostgreSQL password before invoking `setup:native`) to install, build, verify and migrate; `npm start` runs all three compiled processes in a single foreground terminal. Run `npm run stop` in another terminal to request graceful shutdown of that managed process group. For persistent production hosting, use the native system service manager below. The browser always uses same-origin `/api`, which is forwarded to `API_INTERNAL_URL` by Next.js.

Checks: `npm run typecheck`, `npm test`, `npm run build:web`, `npm run check:docs`. Changes must follow [docs-sync](../../.agents/skills/docs-sync/SKILL.md).

See [implementation gaps (Chinese)](../design/implementation-status.md) for unimplemented features and security limitations. [中文](#中文).

### Model operations and project AI collaboration

Models are maintained in **System Management**, not the project's right-side panel. A provider connection owns the encrypted API key and endpoint; multiple models can share it. Testing uses a non-project JSON probe, limited to one test per model every 30 seconds. Model parameters are sent only when explicitly supported by the selected adapter, never guessed from a branded hostname. Input budget is a character count, not the context window in tokens. Official project facts and recent conversation are assembled within a bounded scope; AI cannot approve its own proposed work. `@AI` requests a read-only answer; task reminders do not depend on an external LLM.

### Task progress, date-only deadlines and proactive check-ins (ADR-022)

Formal task deadlines are now **YYYY-MM-DD calendar dates**, without hours/minutes. Upgrade migration 006 converts existing due timestamps into the project's local calendar date before removing the old task column; back up your database before running native setup or a production Docker upgrade. The API accepts `dueDate` instead of the retired `dueAt` field. Existing work/audit history is not discarded.

Worker analysis now attempts to link project chat updates to existing authorized active task IDs; progress, blockers and completion claims are stored as pending evidence for owner review under Tasks, and never automatically mark the task as done. Independently new task/risk proposals still require owner acceptance. Deterministic duplicate-title checks reduce obvious repeats but do not promise semantic equivalence. An assigned task with a deadline and valid reminder policy enters a check-in plan shortly after creation; longer tasks get periodic check-ins and blocked or near-due tasks receive more frequent in-app reminders, subject to configured local working hours and cooldown.

DeepSeek-related limits can be increased for quality-sensitive tasks: default 32768 input characters / 8192 output tokens, configurable up to 250000 characters / 131072 tokens. These are application budgets, not the provider's advertised 1M context / 384K output capabilities or an actual token-based compaction implementation. Schema-incompatible outputs are quarantined without retrying eight identical model calls. Full agent autonomy, dependency-network risk propagation and live large-context provider validation remain future work.

### Reliability notes
The per-project message cursor follows transaction commit order to prevent missing chat messages. Replanning a task preserves the cooldown of its last reminder. Weekly/monthly counts cover all project tasks while detail lists are bounded; drafts can be regenerated, but published reports remain immutable. Verify these behaviors with `node tools/test/smoke.mjs` against a migrated PostgreSQL instance.

### clarification and recovery
For opted-in AI, tasks with missing details get a `【候选:UUID】` reference. Team members may reply with the exact reference and an explicit assignee or timezone-aware deadline. Suggestions remain pending until the project owner approves them. Owners may inspect and retry quarantined background events in Settings. AI_DAILY_REQUEST_LIMIT limits each project's model calls per UTC day (default 50) and is passed to the Worker by Docker Compose; external AI remains disabled by default. Database regression: `node --import tsx packages/core/test/outbox.integration.ts`.

### Scheduled reporting
The Worker creates a scheduled weekly/monthly report only once per project and reporting period. Polling does not overwrite drafts; owners can manually regenerate an unpublished draft, while published reports remain unchanged. Database regression: `node --import tsx packages/core/test/reports.integration.ts`.

### Tenant and project API

Call `GET /tenants` to list the user's teams and roles. `POST /projects` requires explicit `tenantId`, `name`, and `timezone`; the authenticated user must be an administrator of that team. There is no implicit default tenant selection. A project owner may remove a regular member, but the API returns 409 while that member owns unfinished tasks; reassign or cancel those tasks first to avoid orphaned reminders. Logout revokes the server-side session.

### Required GitHub checks

PRs must pass the `verify` (product and database validation) and `documentation` (documentation governance) jobs. Maintainers must select those exact GitHub Actions checks in the repository ruleset; see [branch protection guide](maintainers.md). The project listing API includes work hours and cooldown settings, returning explicit `null` values when not configured; API regression tests cover these fields.

### Native Windows 11 (no Docker)

Install Node.js 24 and PostgreSQL 17 (including `pg_dump` and `pg_restore`). Create a dedicated database and user. From PowerShell: `Copy-Item .env.example .env`, configure database credentials and a secure SESSION_SECRET, then `npm run setup:local`. Use `npm start` for a one-terminal foreground run.

For Windows services, install ChatPM outside your interactive user profile (for example `C:\\ChatPM`) and use a system-wide Node.js installation. Obtain and verify WinSW independently, then run `./infra/windows/install-services.ps1 -WinSWPath <path> -StartNow` as administrator. It registers automatic-start services and starts them immediately; check with `Get-Service chatpm-*`. The installer explicitly selects built-in low-privilege LocalService instead of WinSW's LocalSystem default. It grants read access to the application tree, write access to log/Next cache paths, and restricts inheritance on `.env`. Administrators must audit remaining explicit ACL entries and prevent untrusted write access to executable files, then test restart/recovery.

### Native Linux (no Docker)

Install Node.js 24 and PostgreSQL 17/client tools; create a database, database role, and dedicated `chatpm` system user. Install source at `/opt/chatpm`, copy `.env.example` to `.env`, and configure `NODE_ENV=production`, DATABASE_URL, strong SESSION_SECRET, WEB_ORIGIN, and `API_HOST=127.0.0.1`. Restrict `.env` to the service account (for example, mode 0600), and never use the template database password in production. Run `npm run setup:local` from `/opt/chatpm` with access to that environment. Both setup and systemd use the same `/opt/chatpm/.env`; no separate `/etc/chatpm` copy is required. Copy `infra/linux/*.service` to `/etc/systemd/system/`, adjust the actual Node path, and run `sudo systemctl daemon-reload && sudo systemctl enable --now chatpm-api chatpm-worker chatpm-web`. Verify with `systemctl status chatpm-api chatpm-worker chatpm-web`. Put Caddy or another HTTPS proxy in front of Web; do not publicly expose API/database ports.

### Complete Docker Compose

With Docker/Compose and Node installed, run `npm run deploy:docker`. It initializes missing/placeholder SESSION_SECRET and POSTGRES_PASSWORD in `.env`, then builds and starts the stack in the background without replacing configured secrets or databases. Repeat runs preserve secrets. The Worker receives `AI_DAILY_REQUEST_LIMIT` (default 50); this is a request count, not a token-cost budget. To check use `docker compose --env-file .env -f infra/compose.prod.yml ps`, and to stop use `docker compose --env-file .env -f infra/compose.prod.yml down` (never add `-v` unless deleting data is intended). `restart: unless-stopped` works after a host reboot only if Docker itself starts; Docker Desktop commonly starts after user sign-in. Only `127.0.0.1:3000` is published; add a secure external HTTPS proxy to expose it. `infra/compose.yml` remains the database-only development Compose.

### Experimental portable distributions

The cross-platform native-build CI uploads Windows and Linux Artifacts containing compiled Node code, the built Next.js app, migration SQL, templates and operations scripts, excluding local databases and secrets. Extract the target-platform Artifact, install Node/npm and PostgreSQL separately, run `npm ci --omit=dev`, configure a secure `.env`, run `npm run db:migrate:prod`, and start ChatPM. These are not signed MSI/DEB/RPM installers and do not certify update/uninstall, SBOM, dependency licensing or production recovery.

### Diagnostics, scheduled backups, and controlled upgrades

- `npm run doctor` tests local API reachability, PostgreSQL, Worker heartbeat/success, and overdue/dead Outbox events. Exit code is nonzero on failure, suitable for an external monitoring collector; the command itself does not send alerts. Inside Docker run `docker compose --env-file .env -f infra/compose.prod.yml exec -T api node tools/ops/doctor.mjs`. Let Worker complete a tick after migration/startup.
- Use `npm run backup -- --dir=./backups --keep=14` for native PostgreSQL or `npm run backup:docker -- --dir=./backups --keep=14` for Compose. Archives use custom-format `pg_dump`, unique temporary files, no overwrite, and an atomic rename on success. Retention deletes only archives created by this tool, defaulting to the newest 14; private backup storage is mandatory.
- Linux: `sudo install -d -o chatpm -g chatpm -m 700 /var/lib/chatpm/backups`, install both `chatpm-backup.{service,timer}` and `chatpm-doctor.{service,timer}` from `infra/linux` into `/etc/systemd/system`, then `sudo systemctl daemon-reload && sudo systemctl enable --now chatpm-backup.timer chatpm-doctor.timer`. Inspect timers and `journalctl` and connect failures to an alerting service.
- Windows: after secure service installation, elevated PowerShell `./infra/windows/install-backup-task.ps1` registers the low-privilege LocalService daily 02:30 job. Test it manually and inspect backups; database secrets must remain in protected `.env`, never task command lines.
- Native upgrades: stop all three processes and run `npm run upgrade:native -- --confirm-services-stopped` (optionally `--dir=/private/backups`). The command refuses an API that is still serving, completes a new database archive before applying migrations, and leaves restarting to the administrator. Verify a fresh backup and encrypted off-host copy, schedule downtime, stop all three services, build the new version and migrate once, restart, run `doctor` and functional smoke tests. SQL migrations are not generally reversible; rollback of binaries is not equivalent to restoring database state.

Templates and CI do not prove real machine boot-recovery, end-to-end restore, encryption, PITR, Windows filesystem ACL audit or centralized alert delivery. Do not process sensitive production data until these checks are complete.

### Database operations and release status

`npm run backup -- --dir=./backups --keep=14` creates a private, atomic PostgreSQL custom-format archive. After stopping ChatPM and selecting an isolated target, run `npm run restore -- ./backups/<actual-archive>.dump --confirm-replace --confirm-services-stopped`, then `npm run db:migrate:prod`. Restore **drops or overwrites objects included in the archive**. Automated backups, real recovery exercises, TLS, Windows service resilience, operational alerts, and production security certification have not been completed; do not use sensitive production data.

#### Compose database backups

Production Compose does not publish port 5432. Back up through the PostgreSQL container instead of the host example DATABASE_URL:

```bash
mkdir -p backups
docker compose --env-file .env -f infra/compose.prod.yml exec -T postgres pg_dump -U chatpm -d chatpm -Fc > backups/chatpm.dump
```

After stopping Web/API/Worker and selecting a disposable restore target, use `docker compose --env-file .env -f infra/compose.prod.yml exec -T postgres pg_restore -U chatpm -d chatpm --clean --if-exists --no-owner --no-privileges < backups/chatpm.dump`. Do not restore into a live production database.

### 原生前台停止的边界 / Native stop scope

中文：`npm run stop` 只停止当前仓库使用 `npm start`/`npm run dev` 注册的前台进程组，不会结束所有 `node.exe`、PostgreSQL、Docker 容器或 Windows/Linux 系统服务；如果没有启动实例则安全返回，若发现通道失联且 PID 存在则提示人工检查。更早版本启动的进程不能由新命令接管。`npm ci` 网络下载问题、被安全软件锁定的文件仍需另外排查。

English: `npm run stop` only stops the foreground API/Worker/Web group registered by this checkout's `npm start` or `npm run dev`. It never mass-kills `node.exe` and does not affect PostgreSQL, Docker containers or system services. A missing runner is a no-op; an unreachable live runner fails closed. It cannot adopt processes started with older scripts and does not fix `npm ci` network errors or antivirus file locks.

### QNAP NAS, LAN hostname, and IPv6 trial (hardware validation required)

1. Container Station requires Docker Compose, persistent PostgreSQL volumes and adequate hardware resources. Verify NAS CPU architecture and the target image; validate database backup and restoration on the real host. Use the existing `npm run deploy:docker` bootstrap and never silently replace live volumes or secrets.
2. Set `WEB_ORIGIN` in the root `.env` to one actual externally visible HTTPS origin, e.g. `https://pm.example.com`. Recreate affected service containers after changing the environment, then sign in again. Do not mix HTTP LAN IP access with HTTPS public access as two independent origins; mutating requests validate their Origin.
3. Production Compose publishes **only host loopback 127.0.0.1:3000**. Point the QNAP host reverse proxy from the HTTPS vhost to this host-local Web endpoint if reachable. Containerized reverse proxies require a verified internal Docker network; their own 127.0.0.1 is not the host. Never publish API 3001, database 5432 or NAS management endpoints.
4. Configure DNS A/AAAA/DDNS, IPv6 inbound firewalls, TLS certificate renewals and router paths to suit actual networking. Test LAN, Wi-Fi, mobile data, cookie persistence, mutations, AI key secrecy, service restarts and a recovery rehearsal. Prefer a trusted VPN for private deployments; do not enable public registration or sensitive production traffic without a security review.
5. From an application container `http://127.0.0.1:8045` addresses **that container**, not a Windows laptop or the NAS host. Verify a trusted reachable LLM proxy route. Existing URL validation is not a full DNS-rebinding/SSRF egress control.

## 2026-10-15 治理和可靠性增量使用说明（实验性）

变更审批采取两人职责分离：项目负责人和项目经理可对**其他人**提交的变更申请执行批准或拒绝；提交人自己不能审批。没有第二位合资格成员时，请先增加项目经理或移交审批职责，而不是尝试自批。项目负责人仍独享项目人员管理、AI 启用开关、报告发布和系统管理员以外的项目设置职责。

组织管理员可以在「组织管理 → 资源投入」对错误或已经失效的资源分配点击「取消投入」，历史记录保留，已取消的投入不计入后续容量。成员承担未验收的交付物或仍有效的资源分配时，项目负责人不能直接把该成员降为观察者或移出项目，可在项目治理交付物中经版本校验和审计后重新指派负责人，再完成剩余工作，并请组织管理员取消或重新安排资源。观察者不可被指派新的正式交付物。

消息分析、规则催办和周期报告分别执行；关闭 AI 后，新产生的旧版本模型结果不再发布。但关闭开关不能撤回已经发送给第三方的文本。登录/注册按规范化账号而非同源代理 IP 限制尝试次数；公网仍需配置可信网关的来源级防滥用。完成安装后应实际验证多人并发登录、成员交接、审批与撤权，当前产品不保证生产验收。

## 2026-10-15 Governance and reliability update (experimental)

Change approval enforces separation of duties: project owners and managers may approve or reject changes submitted by **another** person; an author cannot approve their own request. A second eligible reviewer is required. Member management, AI enablement, report publication and project settings remain restricted to the project owner.

Organization admins can cancel a resource allocation from the Organization → Resources view. The original allocation and audit remain available, and cancelled plans no longer consume capacity. Project members with unfinished deliverables or active resource allocations cannot be removed or downgraded to observer until the owner or manager reassigns the deliverable using its versioned handoff command, and the organization admin cancels or reconciles the allocation. Observers cannot own new formal deliverables.

AI analysis, reminders and reporting run in independent worker lanes. A revoked AI grant blocks publication of stale results, but cannot retract data already sent to an external model. Login and registration are account-scoped behind the shared Next.js proxy; public deployments still require trusted edge abuse controls. Real multi-user browser, Windows/Linux deployment and security acceptance tests remain necessary.

## 2026-10-15 周报/月报真实变化与任务证据（实验性）

项目「汇报」页面现在区分生成时的**任务总体快照**与本周/本月的**真实任务变更**。后者统计项目时区内任务新增、完成、重新打开、阻塞以及期限调整，并列出最近 100 条来源记录；本期全部变更数量不会因为明细上限而截断。每一条任务来源可以打开只读的历史事件 API，成员也能在「正式任务」下点击「查看任务历史」浏览分页记录。

历史从新的数据库变更追踪迁移生效后开始，不会凭空生成此前发生过的任务状态变化。AI 候选提议不视作正式任务完成，已发布报告不能再修改。本次能力不包含历史基线、项目集汇总、完整风险/变更周期分析或生产安全验收。

## 2026-10-15 Traceable task changes in weekly/monthly reports (experimental)

Reports now distinguish the **current task snapshot** from **actual task changes within the project's local week or month**. The change section counts created, completed, reopened and blocked tasks, as well as due-date adjustments. Up to 100 recent history events are shown with read-only evidence links, while full event counts are retained. Members can also browse a task's paginated history from its task card.

Events are recorded only after the new database migration takes effect; earlier events are never fabricated. AI suggestions are not treated as accepted work, and published reports remain immutable. Project baseline reconstruction, cross-project portfolio summaries, historical risk/issue changes and production deployment certification are not included.

## 2026-10-15 生产注册开关（安全默认）

生产默认 `REGISTRATION_MODE=bootstrap`：一个全新数据库只能通过网页注册**首位**用户并创建组织；后续自注册自动关闭。配置 `REGISTRATION_MODE=closed` 完全关闭新用户注册，明确设置为 `open` 才允许更多匿名用户注册并独立创建组织。Docker Compose 与 Windows/Linux 原生生产模式遵循这一策略；变更环境变量后需重启对应服务，不能在聊天室要求 AI 更改此设置。

当前版本还没有邮件邀请/接受流程。生产环境下不要将 `open` 长期开启，必须配合可信的入站安全措施和组织运营策略。浏览器会自动隐藏被禁用的注册按钮，服务端事务中的安全检查才是最终依据。

## 2026-10-15 Production enrollment policy (secure default)

Production defaults to `REGISTRATION_MODE=bootstrap`: only the first account may be registered into a new database, after which public self-signup is disabled. Set `closed` to disable all public registration or explicitly set `open` to allow anonymous accounts and new organizations. Docker and native production deployments use the same policy; restart the application after changing its environment.

Email invitations and acceptance workflows are not available yet. Do not keep unrestricted `open` registration enabled on a public deployment without trusted edge controls and an operational approval process. The browser hides the signup option when unavailable, while the transaction-scoped server check remains authoritative.

## 2026-10-15 首账户防抢注安全补强 / Protected initial enrollment

部署脚本在服务器的私有 `.env` 文件生成 `BOOTSTRAP_TOKEN`（64 位十六进制随机值），它与 `SESSION_SECRET`、`MODEL_ENCRYPTION_KEY`、数据库密码互相独立。首次通过 Web 注册管理员时，**部署操作员本人**从服务器 `.env` 读取密钥，在初始化表单填写。绝不在聊天、问题报告、Git 仓库、公开页面或共享截图中发送该密钥。错误密钥、缺少密钥、或已有首账户时注册都会拒绝。部署时应先保持默认 loopback 监听，完成可信初始化再开放 HTTPS 公网；完成后推荐将 `REGISTRATION_MODE=closed` 并重启 API。普通新成员仍需正式的管理员邀请功能（待完成）；不要为了日常入职长期开放 `REGISTRATION_MODE=open`。

The installer creates a private 64-hex-character `BOOTSTRAP_TOKEN` in the server's `.env`. Only the trusted operator may use it to create the initial account, while the application is still bound to localhost. Do not paste it into chats or commit it. Once the first account exists, that token cannot register another user; switch to `REGISTRATION_MODE=closed` after setup. The invitation-based enrollment workflow is still pending and must not be replaced by long-lived public `open` registration.

## 2026-10-15 组织受控邀请（实验性）

组织管理员可以在「组织管理 → 组织人员」填写邮箱签发有效期 7 天的邀请码。邀请码只在签发成功时显示一次，请通过独立、可信的通信渠道发给受邀本人；如遗失请撤销旧邀请并重新签发，不要打开全站匿名注册。新用户在登录页选择「收到组织邀请码？注册并加入」，填写同一受邀邮箱、邀请码和密码。已有用户登录后在「个人设置 → 使用邀请加入组织」粘贴邀请码即可。接受后是组织的普通成员，项目负责人仍需单独将该成员加入具体项目。管理员可以查看邀请码的待接受、已过期、已撤销和已接受状态。当前没有自动邮件或企业 SSO，邀请码不是项目权限凭据。

## 2026-10-15 One-time organization invitations (experimental)

Tenant admins can issue a seven-day, email-bound invitation under Organization → People. The secret is displayed once only and must be shared privately. New users select invitation enrollment on the sign-in screen; existing users sign in and accept it under Account Settings. The invited account joins **only that tenant** as a regular member. Project access requires a separate project grant. Revoked, expired, mismatched or consumed codes are rejected. There is no automated invitation email, SCIM, or enterprise SSO in this increment.

## 2026-10-15 多部门项目协作归属（实验性）

组织管理员现在可以在「组织管理 → 部门与项目结构」为项目指定一个主责部门，并从其他部门多选参与部门。页面显示各部门主责及参与项目数量。项目集与组合仍独立选择，组织归属版本用于防止管理员并发覆盖。参与部门只代表协作关系，不会自动把部门成员加入项目聊天室或给其任务管理权限；项目负责人仍需授权项目成员。更高阶的项目集收益治理、项目组合优先级、部门级资源调剂仍待实施。

## 2026-10-15 Cross-department project participation (experimental)

A project may have one owning department and several participating departments. Tenant admins edit them together with program/portfolio classification under one optimistic revision, while department membership alone never gives project read/write permissions. Program benefit realization, portfolio strategic prioritization and full shared-resource optimization are not included.

## 2026-10-16 项目集与项目组合正式事实概览（实验性）

组织管理员在「组织管理 → 跨项目概览」查看全部项目任务完成/取消/阻塞、逾期、未解决风险，以及项目集与项目组合的去重汇总。选择日期可检查该日到期与资源计划。项目集和项目组合的区别保留：项目集协调共同交付，项目组合代表战略投资；没有加入项目集/组合的项目独立显示。按人员汇总当天跨项目计划投入，达到 80% 显示接近容量，超过 100% 标记超配。**这是计划而不是实际工时。** 不提供历史任意日期的真实任务状态回放，也不自动决策资源调配、确定组合优先级或计算收益。

## 2026-10-16 Program and portfolio factual pulse (experimental)

Tenant administrators have a cross-project overview of current task/risk states and planned allocation for a chosen calendar date. Each project belongs to at most one effective portfolio, either through a program or directly; program descendants are not double-counted. The selected date applies only to overdue checks and active resource commitments, **not historical task-state replay**. Portfolio strategic scoring, program benefits realization, actual timesheets and cross-project critical-path forecasting remain future work.

## 2026-10-16 模型出站私网例外安全收紧（实验性）

默认模型外部 HTTPS 地址必须解析为安全公网 IP；内网模型仅允许显式 `localhost`、`127.0.0.1`、`::1`、`host.docker.internal` 端点。Docker 宿主别名现在只允许解析到 RFC1918 或 IPv6 ULA 网关地址，不再信任链路本地/云元数据、CGNAT 或公网 IP。模型连接不允许自定义 Host、代理认证或传输编码请求头，并继续禁止上游重定向。网络网关、Docker DNS、IPv6、透明代理和 QNAP 路由仍需要在部署机器进行检查，不能以 CI 全绿代替真实出站策略验收。

## 2026-10-16 Model egress local alias tightening (experimental)

A remote model endpoint requires HTTPS and safe resolved public IPs. `localhost` must resolve to loopback; `host.docker.internal` now accepts only RFC1918 or IPv6 ULA gateway addresses, rejecting link-local metadata, CGNAT, public addresses and mixed unsafe DNS answers. The transport rejects caller-supplied Host, proxy and HTTP-framing headers before creating a socket. Real Docker/QNAP/IPv6 routing and egress policy still require deployment-specific tests; CI alone is not a production network security certification.
