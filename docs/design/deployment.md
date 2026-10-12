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
