# 组织与系统 AI 管理 / Organization and AI Administration

[中文](#中文) · [English](#english)

## 中文

### 组织与项目层级
组织管理员可以在工作台的「组织管理」中建立部门、项目集、项目组合，给项目指定主部门及项目集或直属组合。部门管理人员与资源，不与项目集或组合等同。一个人员可加入多个项目，项目聊天仍按项目成员授权。组织管理支持输入已注册邮箱将用户添加至组织；当前**没有邮件邀请或接受流程**。

### 权限
项目 owner 可以授权 manager、member、observer；manager 管理计划并审核候选，普通 member 仅修改自己任务状态，observer 仅查看。项目成员必须先由组织管理员加入该组织。系统管理员不能仅凭该身份查看其他组织的聊天。

### AI 模型
模型配置由系统管理员在最左侧「系统管理 → AI 服务中心」操作，普通项目成员无需填写密钥。初次部署时，先配置 `MODEL_ENCRYPTION_KEY`，创建账号后在本机受控命令行执行：
```sh
npm run admin:grant -- --email=admin@example.com --confirm
```
以管理员账号登录，在「系统 AI」添加模型名称、模型 ID、API 地址、协议与 Key，启用并设为默认。项目 owner 仅开启/关闭项目 AI 分析。更换 `MODEL_ENCRYPTION_KEY` 会使已有模型凭据无法解密，必须计划重新配置。请勿在公网 HTTP 上运行真实数据。

### 当前限制
这是实验性功能：尚无 SSO、邮件邀请、跨项目基线/投资分析、真实任意模型兼容认证或生产级安全验收。

---

## English

### Organization and project structure
Organization administrators can create departments, programs and portfolios from "Organization". Projects may be assigned a lead department and a program or directly a portfolio. Departments manage people and resources and are not substitutes for programs or portfolios. A person can work in multiple projects; project chat access still requires explicit project membership. Adding users by an existing registered email is supported; **email invitations and acceptance are not yet implemented**.

### Authorization
Project owners can assign manager, member, or observer roles. Managers maintain project plans and review proposals; members update only their own task status; observers have read-only access. The organization administrator must add a user to the organization before a project owner can add them to a project. A platform system administrator is not granted cross-organization chat access merely by that platform role.

### AI models
Only the platform system administrator can edit models in the "System AI" panel; ordinary project members do not enter API keys. Configure `MODEL_ENCRYPTION_KEY`, register an account, then run this operator command locally:
```sh
npm run admin:grant -- --email=admin@example.com --confirm
```
Log in as the promoted account. Open System Management → AI Service Center, create a provider connection (endpoint, protocol and encrypted API key), then register its models and select an enabled default. Project owners may enable or disable AI for their project. Rotating `MODEL_ENCRYPTION_KEY` makes previously encrypted model credentials unreadable and requires a planned reconfiguration. Do not run sensitive deployments over public HTTP.

### Limitations
Experimental: SSO, invitation emails, cross-project benefits analytics, universal model compatibility certification and production security acceptance remain outstanding.
