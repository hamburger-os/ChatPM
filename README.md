# ChatPM — 开源 AI 项目经理

<p align="center">
  <img src="assets/brand/banner.svg" alt="ChatPM — Turn conversations into accountable progress" width="100%" />
</p>


[![Product verification](https://github.com/hamburger-os/ChatPM/actions/workflows/app-quality.yml/badge.svg)](https://github.com/hamburger-os/ChatPM/actions/workflows/app-quality.yml)
[![Documentation](https://github.com/hamburger-os/ChatPM/actions/workflows/docs-quality.yml/badge.svg)](https://github.com/hamburger-os/ChatPM/actions/workflows/docs-quality.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> 让项目聊天室里的承诺不再被遗忘。AI 提取有证据的候选事项、协助确认责任人与期限、跟进正式任务并生成待审核的项目报告。

**状态：实验性可运行原型；尚未完成生产级安全、性能与隐私验收。** [Apache-2.0](LICENSE) · [中文文档](docs/README.md) · [English](docs/community/overview.md#english)

## 为什么选择 ChatPM？

讨论发生在聊天室，但项目状态不应该只依赖记忆。ChatPM 将聊天中的事实与**待确认候选**分开，记录来源，由项目负责人确认后进入正式任务，再按明确规则催办和汇报。它不会把模型生成的内容直接当作已批准的计划。

> [!IMPORTANT]
> ChatPM 当前仍是**实验性可运行原型**，并非已验收的生产级服务。README 以下仅介绍已实现的能力。

## 已实现的能力

- 注册与登录、团队及项目、成员协作、消息持久化与增量拉取。
- 项目负责人显式启用外部 AI 后异步提取候选任务和风险；默认不向模型发送聊天内容。
- AI 建议保留消息依据；负责人审批正式任务、风险和澄清后的负责人/期限；任务版本冲突有保护。
- 后台按工作时间跟进已有负责人及期限的任务，并通过持久 Outbox 管理失败重试和隔离。
- 周/月项目当前状态报告草稿，负责人审核发布。**当前不是历史周期变化分析。**

**尚未实现：** 本地模型与多提供商接入、文档知识库、自动语义关联、完整风险升级、实时推送、完整企业身份管理和正式 SaaS 运营。以上属于 [路线图](docs/design/roadmap-acceptance.md)，不是现有功能。

## 在本机直接部署（无需 Docker）

**Windows 11 和 Linux 都可以原生部署。** ChatPM 由 Web、API、Worker 三个 Node.js 进程和一个 PostgreSQL 数据库组成。下面是**本机安装 PostgreSQL + 运行正式构建产物**的步骤；不需要 Docker、WSL 或容器引擎。

### 1. 准备 Node.js 和 PostgreSQL

- 安装 **Node.js 24 LTS**、**PostgreSQL 17**（包括 `psql` 客户端）和 Git。
- 下载源码：`git clone https://github.com/hamburger-os/ChatPM.git`，然后进入 `ChatPM` 目录。
- 打开 PostgreSQL 的 `psql`：Windows 可使用随 PostgreSQL 安装的 SQL Shell (psql)，Linux 可执行 `sudo -u postgres psql`。创建专用角色和数据库：

```sql
CREATE ROLE chatpm LOGIN PASSWORD '请替换为自己生成的数据库强密码';
CREATE DATABASE chatpm OWNER chatpm;
```

此处密码只是标记，不可直接用于真实部署。数据库已存在时不要重复创建；若 PostgreSQL 不在本机，请改用目标数据库的主机、端口和账号。

### 2. 配置运行环境

在仓库根目录复制环境变量模板：

| Windows 11 · PowerShell | Linux · Bash |
|---|---|
| `Copy-Item .env.example .env` | `cp .env.example .env` |

生成随机会话密钥（两种系统均可）：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

打开根目录的 `.env`，至少修改以下配置：

```dotenv
NODE_ENV=development
DATABASE_URL=postgres://chatpm:<数据库密码的URL编码值>@127.0.0.1:5432/chatpm
SESSION_SECRET=<粘贴上面生成的随机密钥>
WEB_ORIGIN=http://localhost:3000
API_HOST=127.0.0.1
API_PORT=3001
API_INTERNAL_URL=http://127.0.0.1:3001
```

数据库密码包含 `@`、`#`、`:` 等特殊字符时，须将密码部分按 URL 编码。上面的尖括号内容必须替换为实际值；本机 HTTP 仅用于可信的本地访问，不是公网生产配置。第三方 AI 默认关闭，可暂时不填 `OPENAI_API_KEY`。

### 3. 安装、构建并初始化

在仓库根目录运行（Windows PowerShell / Linux Bash 命令相同）：

```bash
npm ci
npm run build
npm run check:distribution
npm run db:migrate:prod
```

### 4. 启动服务

**打开三个终端**，均切换到 ChatPM 根目录：

| 终端 | 执行命令 | 用途 |
|---|---|---|
| 1 | `npm run start:api` | API（本机 3001 端口） |
| 2 | `npm run start:worker` | AI 处理、任务跟进和报告调度 |
| 3 | `npm run start:web` | Web（本机 3000 端口） |

访问 **http://localhost:3000** 注册账号、创建项目。可打开 **http://127.0.0.1:3001/health** 检查 API 数据库连接。关闭终端会停止相应服务；需要后台常驻时使用下方文档中的 Windows Service / Linux systemd 示例。

更详细的原生安装、服务托管、备份与恢复方法：[中文指南](docs/community/development.md#中文) · [English guide](docs/community/development.md#english) · [部署设计](docs/design/deployment.md)。

## Docker（可选）

Docker 不是必需组件。如果更喜欢容器方式，可在根目录 `.env` 中另外设置 `POSTGRES_PASSWORD`，确认 `SESSION_SECRET` 是随机密钥，再执行：

```bash
docker compose -f infra/compose.prod.yml up -d --build
```

该 Compose 提供完整的 Web、API、Worker 和 PostgreSQL，默认只在 `127.0.0.1:3000` 提供访问。**请勿直接把本地测试配置开放到公网。**

如果只是开发代码，可使用 `npm run dev:api`、`npm run dev:worker`、`npm run dev:web`；开发用 `infra/compose.yml` 仅启动 PostgreSQL。

## 本地演示路线

1. 注册账号并创建团队/项目，邀请已注册的成员。
2. 在项目聊天室中讨论可交付事项；未配置模型时可以手动创建任务。
3. 可选择配置服务端 API Key 并由项目负责人显式开启外部 AI，将讨论转为有依据的**候选任务/风险**。
4. 由负责人审批候选、确认任务负责人和期限，配置工作时间与提醒冷却。
5. 在「报告」中生成并审核当前项目状态的周/月报草稿。

此演示需要真实的本地运行环境；尚无公开在线 Demo；仓库提供完整 Compose 的本机构建方案，但尚未发布经过生产验收的正式镜像。

## 验证

```bash
npm run typecheck
npm test
npm run db:migrate
node --import tsx packages/core/test/outbox.integration.ts
node --import tsx packages/core/test/ai.integration.ts
node --import tsx packages/core/test/reports.integration.ts
node tools/test/smoke.mjs
npm run build
npm run check:distribution
npm run check:docs
```

集成测试需要可用的 PostgreSQL；CI 会自动执行。

## 安全与隐私

默认不开启第三方模型传输；成员身份、项目权限与候选审批由服务端控制。请阅读 [安全政策](SECURITY.md)、[隐私与数据边界](PRIVACY.md) 和 [当前限制](docs/design/implementation-status.md)。敏感业务数据请勿直接用于未经生产验收的实例。

## 参与开源

- [参与贡献](CONTRIBUTING.md) · [社区行为准则](CODE_OF_CONDUCT.md) · [漏洞报告](SECURITY.md) · [支持渠道](SUPPORT.md)
- [治理与维护](GOVERNANCE.md) · [架构和设计](docs/design/README.md) · [当前能力与限制](docs/design/implementation-status.md)
- [维护与状态检查设置](docs/community/maintainers.md#中文) · [Issues](https://github.com/hamburger-os/ChatPM/issues) · [Discussions（启用后）](https://github.com/hamburger-os/ChatPM/discussions)

**English:** ChatPM is an experimental, chat-centered AI project management tool. It keeps evidence-linked proposals separate from approved project facts. Cloud and self-hosted deployment with cloud/local model options are product goals; they are not all shipped today. See the [English guide](docs/community/development.md#english).
