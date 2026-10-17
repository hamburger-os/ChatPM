# 部署架构和跨平台运行契约

## 决策与取舍

保留 Fastify API、Next.js Web、PostgreSQL 和独立 Worker 的模块化单体；运行形态与业务代码分离。Windows/Linux 原生进程与 Docker 容器都使用相同的 Node.js 编译代码与 SQL 迁移，避免数据库/领域层平台分叉；不引入多数据库、微服务和 Kubernetes 兼容层。

## 构建与运行

- `npm run build:server`：TypeScript NodeNext 输出 `dist/`，编译时将 SQL 迁移复制到相同相对路径。
- `npm run build:web`：Next.js 生产构建；`npm run build` 组合两者。
- `npm run db:migrate:prod`：运行编译后的迁移并校验历史 SQL checksum。
- `npm run start:api` / `start:worker` / `start:web`：不依赖开发 Watch 进程。
- Web 运行时通过同源 `/api/[...path]` 路由代理转发后端。浏览器不含编译时环境域名，也不直接公开 API 地址。代理仅转发必要的请求头与 Cookie，API 保留 Origin 校验。
- `API_HOST` 默认为回环地址；Compose 内显式改为 `0.0.0.0`，只发布 Web 的本机回环端口。正式对公网开放时需 HTTPS 反向代理。
- PostgreSQL 可以是 Windows/Linux 原生安装或容器实例。生产配置启动校验，不接受示例 SESSION_SECRET。

## 服务生命周期

Windows PowerShell 前台启动脚本与 WinSW 服务包装示例；Linux systemd 服务；Docker Compose 统一编排。三种模式共同遵守先运行迁移、再启动服务的顺序，停止 Worker 时排空正在运行的 tick。Worker 对本周和本月已经错过 09:00 的当前周期报告进行补偿，但**不会伪造无法还原的历史周期状态**。

## 失败与风险

- 系统数据库连接中断时 HTTP 健康检查返回失败；生产仍需独立 Worker 心跳和可观测告警。
- 部署更新必须先备份、停写/停服务、执行迁移，再启动并验证；现有迁移不保证任意版本自动回滚。
- 数据库镜像、Node 版本、Windows 服务包装器、PostgreSQL 原生安装需要安全升级管理。
- 当前只有跨平台编译 CI；Windows 服务实机故障恢复、恢复演练、生产级隐私、安全与性能仍需验收。

## 文档归属与安装操作说明

本设计文件用于记录跨平台部署的架构约束；详细安装步骤统一放在既有社区层，不另外新建 `installation` 层：

- [Windows 11 / Linux 本机原生安装及 Docker 使用（中文）](../community/development.md#中文)
- [Native Windows / Linux / Docker installation (English)](../community/development.md#english)
- [仓库根目录 README 本机快速启动](../../README.md)

部署在目标平台时执行 `npm ci && npm run build && npm run check:distribution`，正式数据库迁移使用 `npm run db:migrate:prod`。PostgreSQL 客户端工具须在 PATH，且生产必须使用单独生成的随机会话密钥。

### 数据库备份与恢复约束

原生备份与恢复统一通过 `tools/ops/postgres-env.mjs` 解析 PostgreSQL 客户端环境：优先使用 `DATABASE_URL`，否则使用 `PGHOST`、`PGUSER`、`PGDATABASE`；将连接信息转换为 `PG*` 环境变量，不向 `pg_dump` / `pg_restore` 子进程透传 `DATABASE_URL`，也不在命令行展开凭证。原生环境使用 `npm run backup -- --dir=./backups --keep=14` 创建私有、原子落盘的归档；在**停止 API/Worker/Web 且确认隔离目标库后**执行 `npm run restore -- ./backups/<实际归档文件>.dump --confirm-replace --confirm-services-stopped`，随后运行数据库迁移。旧的直接写目标文件备份入口已移除。恢复操作会覆盖已有数据库对象，不允许对仍在提供业务服务的生产库直接恢复。备份必须限制访问、加密并定期在隔离环境做恢复演练。

Compose 默认不暴露 PostgreSQL 宿主机端口，使用 `docker compose --env-file .env -f infra/compose.prod.yml exec -T postgres pg_dump -U chatpm -d chatpm -Fc > backups/chatpm.dump` 等容器内客户端备份方式，操作前保证目标目录存在。

上述仅提供操作路径，不等同于自动备份计划、数据完整性验收、PITR、生产灾备认证；生产级逆向代理、权限、安全、监控与恢复演练仍是未完成的发布门槛。


## 简化部署的运行入口与验收

- `npm run dev`：原生开发的单终端入口，统一启动并监看三个开发进程；不负责数据库创建。
- `npm start`：本机已有正式构建产物时，单终端前台运行三个生产进程；适合试运行，不提供脱离终端的开机自启。进程收到停止信号时向子进程转发，任一进程退出则整组停止，防止静默退化。
- `npm run deploy:docker`：前提是 Docker Compose 可用。首次根据模板生成 `.env`，对缺失或模板默认的 SESSION_SECRET、POSTGRES_PASSWORD 生成独立高熵随机值；保留已有用户设置，拒绝静默改写已设置的秘密；后台构建并启动服务。自动启动依赖宿主机 Docker 引擎在系统启动后运行。
- Windows/Linux 原生 PostgreSQL 仍是明确的先决条件，正式长期运行使用既有 WinSW/systemd 三服务模板，不用前台进程管理器替换服务管理器。安装、升级、初始化数据库应与每次开机启动区分，不在应用服务的 ExecStart 中执行 `npm ci` 或自动数据库恢复。
- 验收要求：Windows/Linux 使用同一 Node 入口；没有依赖安装时有可操作的失败提示；占位秘密能替换，既有配置原样保留；重复部署不生成新密钥；子进程崩溃不留下失管服务；独立验证 Docker 宿主机自启及服务恢复。仅运行单元测试不代表目标系统的开机自启实测。

## 运维可靠性与服务治理（ADR-018）

- Worker 在 PostgreSQL 中记录最近存活、最后成功及最后失败时刻。独立诊断命令 `npm run doctor` 检查数据库和部署 API，并将心跳超时及过期未处理事件作为失败信号；此诊断不要求浏览器权限，也不提供公网运维接口。
- `npm run backup` 是唯一受支持的原生备份入口，默认创建新的 PostgreSQL custom-format 文件并按保留份数清理**本工具创建且匹配命名规则**的旧文件。必须在受限目录执行，成功后才允许清理历史文件。Docker 模式在宿主机使用 `--docker`，由 Compose 内 `pg_dump` 输出到宿主机备份目录。重复执行不可覆盖已有备份文件。
- Linux 定时器使用专用 `chatpm` 账户，按需授权备份文件路径；Windows Task Scheduler 使用指定低权限主体，不内嵌数据库密码。备份文件需加密、离机保存并在隔离库实测恢复。
- 版本升级避免不停机自动迁移；先停止服务和可验证备份，再迁移。复杂/破坏性数据迁移需另行发布计划；非兼容迁移不保证通过代码回滚恢复旧版。
- 全流程测试边界：CI 可以验证迁移/基本健康与备份失败语义，但设备关机恢复、Windows Service 权限、远端告警与恢复时间目标必须在目标平台人工验收并保留记录。


## 原生升级守护与可携式发行边界

- `npm run setup:local` 可在本机创建缺失的带随机会话密钥的配置，遇到默认数据库密码时拒绝继续；操作系统级 PostgreSQL 的创建与密码管理仍由安装者执行。
- `npm run upgrade:native -- --confirm-services-stopped` 在用户明确确认已停止 Web/API/Worker、且 API 回环健康端点不再可达时先运行私有备份，备份成功才执行安装、编译、校验、SQL 迁移。不能可靠推断 Worker 已停止，必须由部署管理员确认；失败后保持服务停止并人工处置。
- 跨平台 CI 上传实验性可携式构建产物（Node 编译包 + Next 构建 + SQL + 运维脚本），不包含数据库或密钥。不自动声明为签名 MSI、DEB、RPM 或 production-ready。安装向导不应静默申请系统级提升权限。


## /review 四项故障修正（PR #17）

- 生产 Compose 入口固定项目名并显式读取仓库根 `.env`；`--env-file .env` 应用于 Docker 原生运维命令，而不是依赖 `-f infra/...` 的工作目录推断。
- 首次初始化新秘密之前先检查受管的 `chatpm_postgres_data` 卷；数据库卷已存在但密码或会话密钥遗失时，拒绝自动轮换，提示恢复原凭证，防止新数据库密码与旧卷不一致。
- 单终端运行器显式解析根配置再传入 Web，避免 Next.js 子应用根目录无法读取服务内部 URL；Windows 终止 Worker 使用 IPC 请求 graceful shutdown，而非依赖无法保证的 SIGTERM 事件。超时后仍可强制停止，因此不得声称绝对零中断。

## 原生一键停止契约（ADR-020）

- **需求**：Windows 11 用户无需在任务管理器里搜索 PID、手动停止 `node.exe`。开发与原生前台运行的 `npm run dev` / `npm start` 应由同一入口注册控制通道，可在另一个终端执行 `npm run stop`。
- **机制**：前台入口在项目根目录写入一个不提交的私有运行状态文件，含随机一次性控制令牌和本机回环端口。停止命令读取它并向 `127.0.0.1` 的管理进程发送授权请求；管理进程沿用现有三进程关闭策略（Worker Windows IPC 排空），待所有子进程结束后返回停止完成。保留 `Ctrl+C`。
- **作用域**：仅停止由本仓库当前版本 `run.mjs` 管理的原生前台进程；不扫描或终止所有 `node.exe`，不杀未注册的手工 `dev:api` / `dev:web`、旧版本进程，不影响 PostgreSQL、Docker 容器、Windows 服务和 Linux systemd 服务。
- **可靠性/安全**：管理文件原子独占创建，拒绝同目录双实例；随机令牌不通过命令行参数传播；本地回环监听、拒绝错误令牌；僵尸状态仅在确认记录进程已消失后清理，不以 PID 执行 kill（避免 PID 复用误杀）；运行状态加入 gitignore；超时和控制通道不可达时报错而不是盲目强杀。正常停止返回零退出码。进程意外崩溃后可能需要人工检查状态文件；未知运行中的旧版本不能安全自动接管。
- **部署差异**：Docker 停止继续用 `docker compose ... down`，系统服务使用 WinSW / systemd 原生管理命令。安装中 `npm ci` 的网络错误不属于应用运行管理器，`npm run stop` 也不能解除 Windows 杀毒软件的文件锁。
- **验证**：Windows/Linux Node 单元模拟控制通道、恶意令牌、重复注册、文件残留、停止后清理与只管理本项目；CI 产品测试与完整 Docker 检查不得退化。

## QNAP NAS / 内网 / IPv6 远程部署边界（ADR-025）

- Compose 仍默认只在宿主机 127.0.0.1 发布 Web，数据库及 API 不映射公网端口。若 QNAP 反向代理运行在其他容器网络或容器宿主机不同网络命名空间，不得直接假设 127.0.0.1 可用；部署运营人员应为反向代理与 Web 建立可验证的内部可达路径，维持数据库/API 隔离。
- WEB_ORIGIN 使用对终端用户实际访问的 HTTPS 域名（含非默认端口）；Cookies、Origin 验证、反代路径按该单一外部 Origin 联调。同一站点使用不同 HTTP 内网地址和 HTTPS 公网地址时应统一入口或制定域名内部解析，避免跨源写请求拒绝。
- IPv6 需要 DNS AAAA/DDNS、防火墙、证书和运营商实际连通性；不能从容器构建通过推断公网可达。QNAP、路由器、手机蜂窝网络及证书更新必须在实机验收，建议私有团队优先使用 VPN。
- 容器中的 127.0.0.1 是容器本身，不能据此连接 Windows 主机的 127.0.0.1:8045 模型代理；网络路径和本地模型地址需针对运行环境显式验证。模型网络访问的生产级 DNS 重绑定与 SSRF 出站阻断仍是上线安全门槛。

## ADR-050 · Docker 隔离库的备份恢复演练

CI 先完成 Web Proxy/Origin/Cookie、Worker heartbeat 和 Outbox 检查，然后停止 Web/API/Worker，只保留测试 PostgreSQL。用原有 backup.mjs --docker 生成受限宿主机备份；在原数据库与随机创建的独立恢复数据库中，对所有 public 普通表计算行数和数据内容摘要并逐项相等比较。pg_restore 使用 exit-on-error，演练数据库只在成功创建后由 finally 清理，源库和 Docker PostgreSQL 数据卷保持不变。CI 此后仍将销毁测试卷、重新执行一键 Docker 部署验证。这证明测试数据可恢复，不证明真实业务 TB 级恢复速度、离机密钥管理、任何时间点恢复或者 Win11/Linux 实体机器维护流程；生产升级仍需单独的停写/备份/恢复验收。

## ADR-080 · Worker 分通道私有健康诊断

`npm run doctor` 不再读取单个混合 `worker_health.default`；会分别检查 `events`、`reminders`、`reports` 的最后成功/失败/心跳，返回结构化 `workerLanes` 和 `WORKER_<LANE>_...` 错误码，任一缺失或不健康则非零退出。必须先按原正式升级步骤**停止各服务、备份、执行 `029_worker_lane_health.sql`、再重启 Worker**，否则新旧 Worker 的遥测写入不兼容；不建立双轨兼容。初次启动若尚未执行首轮 tick，Doctor 将 fail closed。

Linux 已有 `infra/linux/chatpm-doctor.service` + `chatpm-doctor.timer` 每 5 分钟执行；Windows 在正式安装服务并保护 .env ACL 后由管理员运行 `infra/windows/install-doctor-task.ps1` 注册 `ChatPM-Doctor`，使用 LocalService（只读配置、无需管理员进程长期驻留）每五分钟一次。通过 `systemctl list-timers` / `journalctl -u chatpm-doctor.service` 或 Windows Task Scheduler 查看实际退出码和最近运行时间，并由部署者的外部监控将非零退出、计划任务长期未运行升级给值班人员。未接外部监控时只是周期诊断，不是短信/邮件/IM **主动通知**；需要实测告警渠道、抖动去重、服务停机、模型超时、DB 重启、跨实例竞争与通知送达才能通过生产 #4/#51。

