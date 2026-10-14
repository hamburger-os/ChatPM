# ADR-023 工程契约：组织治理及平台模型

## 服务端和数据所有权
- `departments`、`department_members`、`portfolios`、`programs`、`resource_allocations` 属于 Organization/Governance 模块。租户 id 不允许由客户端作为越权选择器；每次读写必须检验租户成员资格。
- `project_members` 项目角色是 owner、manager、member、observer。命令授权集中在 `packages/core/src/permissions.ts`，不能只依赖 Web 隐藏按钮。
- `users.is_system_admin` 仅可通过本机运营命令提升。全局 AI 模型 API 用 `requireSystemAdmin`，不使用租户 admin 或项目 owner 冒充系统管理员。
- `ai_provider_connections` 保存连接/密文凭据，`ai_model_configs` 保存实际模型/预算与默认配置；Worker 仅解析启用的默认模型及其启用连接。项目仍显式开启 AI，未配置默认模型时开启失败；模型只能生成候选。
- API `/tenants/:tenantId/structure` 返回组织结构；人员、部门、组合、项目集和资源投入各有隔离作用域。
- 自定义模型地址只允许管理员控制，密钥在 `MODEL_ENCRYPTION_KEY` 下 AES-GCM 加密；不可回传。切换默认配置不授予跨项目消息访问权。

## 鉴权与并发
- 初始 GET /me 失败仅当 401 才回到未登录；其他错误进入可重试故障状态，项目列表独立加载。
- 单一组织仍至少保留一个 admin；修改成员和任务角色时保持数据库事务和状态保护，撤权立即在 API 生效。
- 数据库约束确保部门、项目集和组合引用属于同一 tenant。
- 管理员创建或切换默认模型时使用事务串行化锁，只有一条启用的默认配置；项目模型测试不得包含业务数据。
- 测试至少覆盖 observer、member、manager、owner、system admin 的允许/拒绝操作，多租户资源交叉关联拒绝，以及 Cookie 会话刷新。

## 实施范围与未完成
已实现基础组织结构、单项目集/组合归属、人员角色、资源投入记录、系统模型 API 与管理界面。尚未实现 SSO、邀请邮件、可视化资源超配预测、完整跨项目组合收益分析、凭据 KMS 与 DNS 出站防护。不得宣传为生产级治理平台。
