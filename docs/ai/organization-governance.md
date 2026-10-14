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

## ADR-025 Web 管理员交互约束

供应商编辑和新建必须有可见的互斥状态。点击添加清除旧供应商选中高亮、清空敏感表单、聚焦新连接名称，取消则可恢复原选中连接；成功保存以返回的 ID 确认对象。禁止新建/编辑模式混用旧连接 Key 提示。移动工作视图必须沿用 API 权限、不把管理员凭据传给普通项目成员。Logo 统一调用 `/icon.svg`，不用平台特殊字符替代。

## ADR-025 轮询与限流工程契约
- `WorkspaceDetails` 工作台数据最低间隔 15 秒轮询（初始化和前台恢复例外），隐藏页不发定时查询，同一循环防止并发重入。消息保留有序游标轮询，隐藏页暂停，前台恢复刷新。不能将短轮询伪装成 SSE。
- `apps/api/src/server.ts` 的通用限流按**验签成功**的 JWT sub 分桶，对缺失或无效 Cookie 回退 IP；登录与注册始终按服务所见 IP 严格限制。数据库 `readSession` 与项目成员校验仍是鉴权依据，签名 JWT 仅用于配额键，不是授权捷径。对前置代理来源 IP 的信任须另做严格配置，不能盲目启用全局 trustProxy。
- Compose 仍只发布 Web 回环端口；本地模型 URL 在 Docker 内依容器网络解析。实际 QNAP IPv6、TLS、模型 DNS/SSRF 出站控制和移动端交互属于硬件及生产专项验收。
