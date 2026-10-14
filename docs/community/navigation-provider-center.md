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
1. 点击「添加供应商」，填写连接名称、**API 请求基础地址**（不是平台官网）、支持的接口协议和 API Key，启用并保存。
2. 打开此供应商的「模型列表」，注册显示名称和服务商实际请求 model ID，可在同一供应商下增加多个模型。
3. 指定已启用的默认模型，并使用「测试连接」验证是否能正确输出 JSON。
4. 项目负责人只需在项目设置中开关 AI。

当前 HTTP 适配器支持 **Responses API** 和 **Chat Completions**。Anthropic Messages、自动获取任意厂商模型列表及其他未验证的接口不在当前兼容范围；不要照搬 CC Switch 中的 Claude Code 特有模型映射。模型能力、上下文和推理参数需以供应商真实测试为准。

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
1. Add a provider connection with a display name, **API request base URL** (not the provider website), protocol, API key, and enabled state.
2. Register one or more models under that connection. Each model has a display name and actual request model ID.
3. Choose an enabled default model and run a restricted JSON connection test.
4. Project owners may enable or disable AI for their own projects.

Only **Responses API** and **Chat Completions** adapters are implemented. Native Anthropic Messages, universal remote model discovery and Claude Code-specific role mappings are not supported. Actual model capabilities must be verified against the provider.

### Secret handling
The platform encrypts provider API keys using AES-256-GCM and exposes only a `hasKey` status to the UI. Empty password fields on edit retain the saved value. `MODEL_ENCRYPTION_KEY` remains a **server-only root encryption secret**, managed by a secure deployment environment or secrets manager. Individual `LLM_API_KEY`-style credentials do not belong in `.env`. Back up both the database and existing root encryption secret before an upgrade.

### Limitations
Experimental software. Production deployments still require HTTPS, DNS/SSRF and egress protections, key rotation procedures, real vendor interoperability, Windows 11 browser acceptance, and operations/security reviews.

## ADR-025 补充 / Provider create and mobile workspace update

### 中文

管理员在已有连接页面点「＋ 添加供应商」将进入清空且可辨识的新建模式：原连接不再高亮，焦点进入连接名称输入框，可取消返回编辑原连接。保存成功后才选中新记录。手机窄屏在「消息」与「工作台」间切换，工作台包含任务、AI 待确认、报告、项目设置；桌面仍保持多栏。左上 ChatPM 标识统一使用应用图标。后端数据仍需权限审查。多用户使用时应关注 API 配额；目前消息仍使用轮询，并非实时推送。

### English

When an administrator clicks “Add Provider” while editing an existing connection, the UI enters a visibly distinct blank creation mode, removes the existing selection highlight and focuses the name input. Cancel returns to the previously selected connection, and only a successful save selects the new provider. On narrow phones, switch between Conversation and Workspace (tasks, AI proposals, reports and project settings); desktop retains its multi-column layout. The ChatPM navigation mark uses the application icon. Server-side authorization remains mandatory. Messaging still uses polling rather than real-time push.
