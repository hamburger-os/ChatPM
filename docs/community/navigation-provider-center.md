# 全局导航与 AI 供应商中心 / Navigation and AI Providers

[中文](#中文) · [English](#english)

## 中文

### 功能导航
ChatPM 的最左栏用于切换**项目协作、组织管理、系统管理和个人设置**。项目协作显示项目列表、聊天室以及可收起的项目工作面板；右侧只包含所选项目的任务、AI 候选、报告及设置。组织管理使用独立主工作区来维护人员、部门、项目集/组合及资源。系统管理仅对系统管理员显示；普通成员不会因项目角色获得系统配置权。

### 谁是系统管理员？如何登录？
管理员**没有第二套登录密码**。注册账号后，由持有服务器访问权的部署人员执行：
```sh
npm run admin:grant -- --email=admin@example.com --confirm
```
随后用同一邮箱与密码登录或刷新页面，即可在最左栏看到「系统管理」。组织管理员或项目 owner 不自动成为系统管理员。命令执行前必须完成数据库迁移；系统管理员权限不得通过公众 API 自助获取。

### 在界面添加供应商
系统管理员进入「系统管理 → AI 服务中心」：
1. 点击「添加连接」，填写名称、**API 请求基础地址**（不是平台官网）、协议和 API Key，然后保存。保存后自动尝试读取标准 GET /models 目录。
2. 在「模型管理」中搜索、勾选并批量添加模型；若服务商没有标准目录，可以手工注册 model ID。新增模型默认禁用。
3. 对模型运行匿名 JSON 兼容测试，再启用模型并选择平台默认模型。
4. 项目负责人只需在项目设置中开关 AI。

当前 HTTP 适配器支持 **Responses API** 和 **Chat Completions**。Anthropic Messages、对任意供应商的通用模型目录发现及其他未验证的接口不在当前兼容范围；不要照搬 CC Switch 中的 Claude Code 特有模型映射。模型能力、上下文和推理参数需以供应商真实测试为准。

### 密钥保护
供应商 API Key 从管理页面提交，服务端使用 AES-256-GCM 加密存入数据库。查询接口只返回是否配置密钥，不返回明文或密文；修改连接时可留空保持原 Key。`MODEL_ENCRYPTION_KEY` 是服务器根加密密钥，仍需放在安全的环境变量或机密管理服务中，**不能由浏览器读取或编辑**。`.env` 不再用 `LLM_API_KEY` 等字段设置具体供应商。部署升级前必须备份数据库和旧环境密钥，否则可能无法恢复已有密文。

### 限制
这是实验性产品。生产环境使用前仍应验证 HTTPS、模型端点的 DNS/SSRF 防护、密钥轮换、实际供应商兼容性、Windows 11 浏览器测试和正式运维审计。

---

## English

### Global navigation
The left rail switches between **Projects, Organization, System Management, and Account**. Projects retain a project list, conversation, and collapsible contextual side panel for tasks, AI proposals, reports and project settings only. Organization and System Management use a full-width workspace. System Management is visible only to system administrators; project ownership does not confer platform privileges.

### Administrator login
System administrators **use the same sign-in form as everyone else**. After registering an account, a trusted server operator must run:
```sh
npm run admin:grant -- --email=admin@example.com --confirm
```
Log in or reload and open System Management on the left rail. Database migrations must already be applied. Organization administrators and project owners do not automatically become system administrators. There is no public self-promotion API.

### Adding an AI provider
In System Management → AI Service Center:
1. Add a connection with a display name, **API request base URL** (not the provider website), protocol and API key. Saving it attempts standard GET /models discovery.
2. Search, select and batch-import catalog models, or manually provide the model ID if the provider has no compatible directory. Imported models start disabled.
3. Run the anonymous JSON compatibility test, then enable a model and make it the platform default.
4. Project owners may enable or disable AI for their own projects.

Only **Responses API** and **Chat Completions** adapters are implemented. Native Anthropic Messages, universal model catalog discovery and Claude Code-specific role mappings are not supported. Actual model capabilities must be verified against the provider.

### Secret handling
The platform encrypts provider API keys using AES-256-GCM and exposes only a `hasKey` status to the UI. Empty password fields on edit retain the saved value. `MODEL_ENCRYPTION_KEY` remains a **server-only root encryption secret**, managed by a secure deployment environment or secrets manager. Individual `LLM_API_KEY`-style credentials do not belong in `.env`. Back up both the database and existing root encryption secret before an upgrade.

### Limitations
Experimental software. Production deployments still require HTTPS, DNS/SSRF and egress protections, key rotation procedures, real vendor interoperability, Windows 11 browser acceptance, and operations/security reviews.

## ADR-025 补充 / Provider create and mobile workspace update

### 中文

管理员在已有连接页面点「＋ 添加供应商」将进入清空且可辨识的新建模式：原连接不再高亮，焦点进入连接名称输入框，可取消返回编辑原连接。保存成功后才选中新记录。手机窄屏在「消息」与「工作台」间切换，工作台包含任务、AI 待确认、报告、项目设置；桌面仍保持多栏。左上 ChatPM 标识统一使用应用图标。后端数据仍需权限审查。多用户使用时应关注 API 配额；目前消息仍使用轮询，并非实时推送。

### English

When an administrator clicks “Add Provider” while editing an existing connection, the UI enters a visibly distinct blank creation mode, removes the existing selection highlight and focuses the name input. Cancel returns to the previously selected connection, and only a successful save selects the new provider. On narrow phones, switch between Conversation and Workspace (tasks, AI proposals, reports and project settings); desktop retains its multi-column layout. The ChatPM navigation mark uses the application icon. Server-side authorization remains mandatory. Messaging still uses polling rather than real-time push.


## ADR-026 模型目录发现 / Model catalog discovery

### 中文
标准 OpenAI 风格的 GET /models 可自动获取模型 ID 与可选名称。目录发现只意味着端点能列出模型，不保证请求协议、推理能力、JSON 输出或 Token 上限兼容。服务端使用加密保存的 Key 发起请求，支持手工 ID 兜底、每次至多 50 条幂等批量注册；管理员可在模型高级设置中调整预算和推理参数。新模型默认禁用，测试可在启用前进行。目录请求超时和响应上限保护服务稳定性；部署人员仍需用网络出站策略隔离内网地址，不能仅依赖 URL 与 DNS 预检。

### English
Compatible OpenAI-style GET /models endpoints provide discoverable model IDs and optional display names. A successful catalog lookup does not prove model inference, structured JSON output, reasoning options or token budgets. The server uses the encrypted provider credential; administrators can manually enter IDs and idempotently import up to 50 models per request. New models start disabled; run the anonymous compatibility test before enabling. Advanced settings expose request budgets and explicit reasoning mappings. Bounded catalog requests and responses reduce abuse, but production egress network rules remain necessary to protect internal services.


## ADR-027 代理地址与模型测试 / Proxy paths and model diagnostics

### 中文

对于暴露 OpenAI 兼容接口的 Antigravity Tools，API 基础地址通常应为 `http://127.0.0.1:8045/v1` 而不是仅端口地址；ChatPM 会在该前缀后自行附加 `/models`、`/chat/completions` 或 `/responses`。其他厂商以其官方实际路径为准，不会按名称自动重写。

“分级测试”将依次执行不附加 JSON 格式要求的匿名文本调用和结构化 JSON 兼容性调用；它可能触发两次计费。类似 CC Switch 的基础连通成功不等于 ChatPM 可以抽取任务、风险所需的结构化 JSON。界面分开显示文本/结构化结果和脱敏诊断代码。如果是 `MODEL_RESPONSE_FORMAT_MISMATCH`，检查所选 Responses 或 Chat Completions；如果是 `MODEL_REASONING_ONLY_OUTPUT`，检查模型思考与输出预算。私有凭据、上游原始响应体不得出现在报错里。

### English

For Antigravity Tools' OpenAI-compatible API, the typical base prefix is `http://127.0.0.1:8045/v1`. ChatPM appends `/models`, `/chat/completions` or `/responses` itself; other providers may have different valid paths, and ChatPM does not silently rewrite them.

The two-stage test first makes an anonymous plain-text request without structured-output settings, then tests strict JSON output. It may incur two model calls. A connectivity check passing in CC Switch does not establish that a model can produce the structured JSON required for ChatPM's task and risk extraction. The interface distinguishes both test stages and reports stable, sanitized error codes. Never share private keys or raw upstream payloads in support requests.


## ADR-028 即时刷新与快速测试 / Immediate catalog refresh and fast checks

### 中文

管理员可以在上次目录获取结束后立即点击“刷新模型列表”，不再固定等待 10 秒。接口仍只允许系统管理员使用，远端服务若限流仍会提示；刷新失败时保留现有模型列表和勾选内容，不会自动频繁重试。新连接保存后仍会尝试首次目录发现。

“快速测试”只发起一次真实结构化 JSON 推理，更适合日常验证；“完整诊断”包含普通文本及结构化 JSON 两次测试，适合故障排查。两种模式都可能计费且共享每模型 30 秒防误触限制。快速测试不会声称已经单独验证文本输出。成功只表示该次匿名结构化请求可用，并不自动启用模型或保证所有项目负载都成功。

### English

Administrators can refresh the model catalog immediately after the previous request completes; there is no fixed 10-second waiting period. Admin authorization and upstream rate limits still apply. When refreshing fails, the last catalog and current selections remain available; there is no automatic rapid retry.

“Quick Test” runs one billable structured JSON inference request for routine checks. “Full Diagnostics” runs a basic text request followed by the structured JSON request for compatibility troubleshooting, possibly incurring two charges. Both modes share the per-model 30-second safeguard against accidental repeated billing. A quick test does not claim that plain text was separately tested. Success does not automatically enable the model or guarantee all production workloads.
