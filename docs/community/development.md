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

打开 http://localhost:3000，注册、创建项目、与成员聊天。系统默认不向外部模型发送内容；要启用 AI 需在服务端设置 `LLM_API_KEY` 并由项目负责人在设置页面明确开启。催办需任务负责人/期限及完整工作时间和冷却策略。

原生首次安装可执行 `npm run setup:local`：不存在 `.env` 时创建含随机会话密钥的配置；如数据库仍使用模板凭证，命令将停止并提示配置。完成数据库配置后重新执行。底层 `npm run setup:native`（安装依赖、构建、校验产物、执行迁移），然后 `npm start` 可在**单个前台终端**运行三进程；在另一终端执行 `npm run stop` 可以等待整组停止，也可在原终端按 `Ctrl+C`。长期运行应交给下述 Windows/Linux 系统服务管理器。浏览器请求统一使用同源 `/api`，服务端通过 `API_INTERNAL_URL` 连接 API（默认 127.0.0.1:3001）。

检查命令：`npm run typecheck`、`npm test`、`npm run build:web`、`npm run check:docs`。更新代码需执行 [docs-sync](../../.agents/skills/docs-sync/SKILL.md)。

未完成的功能和安全验收见 [实施状态](../design/implementation-status.md)。[English](#english)。

### 模型 API 配置（Windows 11 / Linux / Docker）

在根目录 `.env` 配置 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_STYLE`。默认 OpenAI Responses：`https://api.openai.com/v1`、`responses`、`gpt-4.1-mini`。若接入 DeepSeek，将三项改为 `https://api.deepseek.com`、`responses`、`deepseek-flash`，密钥填入 DeepSeek Key。

对于具备 JSON Object 模式的 Chat Completions 兼容服务，可设 `LLM_API_STYLE=chat-completions`；模型结果仍需本地 Zod 校验，不保证每个声称兼容的模型实际可用。本机 Ollama 可尝试 `LLM_BASE_URL=http://127.0.0.1:11434/v1`，`LLM_MODEL` 填已拉取模型名，`LLM_API_STYLE=chat-completions`，`LLM_API_KEY=local-test`（仅本地测试占位）。Docker 内 localhost 并非 Windows 宿主机；可通过受保护的 `host.docker.internal` 访问宿主，但应确认本地模型服务监听及防火墙，不能将未鉴权模型公网暴露。

模型密钥为空时不发送外部请求；即使配置密钥，也要项目负责人在 ChatPM 内明确启用 AI。不要提交含 Key 的 `.env`。修改后原生重启 `npm start`，Docker 重新运行 `npm run deploy:docker`。真实 DeepSeek/Ollama API 功能与费用未完成联调。

### 项目 AI 模型管理与连续对话

项目负责人进入右侧「AI 模型」页，选择「服务器配置」（沿用部署管理员配置的 `LLM_*`）或固定 OpenAI/DeepSeek 供应商，输入模型名称及独立 Key 后点击「保存模型配置」；再点击「测试连接」，只会发送无项目资料的固定测试请求（最多每 30 秒一次，可能计费）。密钥只以数据库加密形式保存，页面不会回显。DeepSeek Responses 模型示例 `deepseek-flash`，实际模型名称和接口是否支持由供应商决定。内置提供商 URL 不允许自定义；自托管模型请由可信部署管理员配置服务器 `.env` 并使用「服务器配置」。模型 Key 密文依赖 SESSION_SECRET，旋转它之后须在 UI 重新录入项目模型 Key，不能只恢复数据库。

「输入预算」为字符预算，并不是模型的上下文 Token 窗口；系统带入最近的有界群聊和已确认项目事实，超出部分进行确定性裁剪。推理强度只有服务商真正支持才发送，目前 OpenAI 官方 Responses 端点支持对应参数，其余服务商保持 API 默认。模型及密钥配置保存后**不必重启** API/Worker；修改部署管理员的 `.env` 仍需重启。所有模型建议仍需负责人批准。发送 `@AI 请总结待办` 可要求 AI 基于只读项目状态答复；成员直接回复最近唯一的候选澄清问题通常无需复制 UUID，多个澄清线程则须明确引用编号。右侧「AI 模型」提供「AI 处理记录」区分分析中、无新建议、生成候选、澄清、回复和失败。自动任务提醒独立于 AI：正式任务有负责人、期限，且启用工作日工作时段/最短间隔才提醒。

### 任务进展、日期与提前催办（ADR-022）

正式任务的期限现在只输入 **YYYY-MM-DD 日期**，不再需要选择小时与分钟。升级迁移会将现有任务时间按其项目设置的时区转换为日历日期，旧的 `dueAt` API 被替换为 `dueDate`；请务必备份数据库后再执行 `npm run setup:local` 或生产 Docker 更新。历史任务和审核记录不能删除。

在聊天室讨论已有任务时，Worker 现在尝试将内容关联到同项目活动任务 ID：阶段进展、阻塞、完成声明只生成证据建议，在右侧「任务」标签页核对后才归入进度，不会自动将任务设置为完成；独立新工作仍由「AI 待确认」审批。系统优先过滤明显重复的规范化标题，不能保证所有语义重叠都正确匹配。要人工更正请在 AI 待确认忽略错误新任务并在任务页更新正式状态。任务有负责人、期限与合法提醒工作窗口时，将在任务登记后进入跟进队列，不再等到最后一天才首次检查；阻塞与临近截止会更频繁，按项目时区和冷却发送站内提醒。

DeepSeek 配置允许根据任务增加模型输入字符预算和输出 Token 限额；默认分别为 32768 字符与 8192 Token，最大可配置 250000 字符与 131072 Token。这不是 DeepSeek 的 1M/384K 理论上限或真实 Token 压缩。建议根据模型费用和输出长度测试后调整。`MODEL_SCHEMA` 确定性错误不再无意义重复请求八次，隔离事件需修复根因后再由 Owner 重放。正式连续 Agent、依赖关键路径计算和实际 DeepSeek 大上下文压测仍未完成。

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

## English

### Model API configuration (Windows / Linux / Docker)

Set `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_STYLE` in the root `.env`. Defaults: OpenAI Responses (`https://api.openai.com/v1`, `responses`, `gpt-4.1-mini`). For DeepSeek Responses use `https://api.deepseek.com`, `responses`, `deepseek-flash`, and a DeepSeek API key. Set `chat-completions` for servers supporting Chat Completions JSON Object mode; all outputs are still checked with Zod. Real compatibility is not guaranteed.

Local Ollama experiments may use `http://127.0.0.1:11434/v1`, `chat-completions`, an installed model name and a placeholder `LLM_API_KEY=local-test`. In containers, localhost is the container itself; `host.docker.internal` may be used only for a protected, reachable host API. Never expose an unauthenticated local model to the public internet. Blank keys disable outbound requests. A project owner must also opt in explicitly. Never commit `.env`. Restart native `npm start` or rerun `npm run deploy:docker` after config changes. Real DeepSeek/Ollama behavior, privacy and cost still need live validation.


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

Open http://localhost:3000, register and create a project. External AI is disabled by default. To opt in, set `LLM_API_KEY` on the server and enable AI explicitly in project settings. Reminders require a task owner, due date, working hours and cooldown policy.

Native installation after configuring PostgreSQL and `.env`: run `npm run setup:local` (generates a missing secret and rejects the sample PostgreSQL password before invoking `setup:native`) to install, build, verify and migrate; `npm start` runs all three compiled processes in a single foreground terminal. Run `npm run stop` in another terminal to request graceful shutdown of that managed process group. For persistent production hosting, use the native system service manager below. The browser always uses same-origin `/api`, which is forwarded to `API_INTERNAL_URL` by Next.js.

Checks: `npm run typecheck`, `npm test`, `npm run build:web`, `npm run check:docs`. Changes must follow [docs-sync](../../.agents/skills/docs-sync/SKILL.md).

See [implementation gaps (Chinese)](../design/implementation-status.md) for unimplemented features and security limitations. [中文](#中文).

### Project model settings and contextual AI collaboration

A project owner can open the "AI 模型" tab, choose server-managed `LLM_*` credentials or built-in fixed-HTTPS OpenAI/DeepSeek endpoints, enter a model name and private API key, and save it. "测试连接" uses only a non-project JSON probe and is limited to once per project per 30 seconds; provider charges may apply. Keys are stored encrypted in PostgreSQL and never returned to the browser. Built-in provider URLs cannot be replaced by untrusted users; administrators may configure custom/private endpoints in the server's `.env`. The encryption key derives from SESSION_SECRET; rotating that secret requires re-entering project keys. Database-level confidentiality also depends on server/backup access controls.

Input budget is measured in characters, **not** the model context window in tokens. Only bounded recent project chat plus authoritative task/risk facts are included, and older discussion is trimmed without overwriting official facts. Reasoning effort is sent only when supported by the configured official OpenAI Responses endpoint; other models use provider defaults. Database-backed settings apply without restart; editing server `.env` requires restart. Send `@AI ...` for a read-only project answer. Plain natural-language answers to a unique recently asked clarification may be linked automatically; ambiguous multi-candidate cases still require the explicit candidate reference. Review progress/errors on the model tab. Rule-based due-task reminders work independently of the external LLM when owner, due date, reminder window and cooldown are configured.

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
