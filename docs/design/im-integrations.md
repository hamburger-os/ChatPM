# 自主 IM 接入与企业微信首发（ADR-088/089/090）

## 架构决定

ChatPM 自主维护 IM 接入、身份与消息契约，dsh-im 仅供参考，不作为运行或构建依赖。企业微信使用官方 @wecom/aibot-node-sdk，未来独立添加渠道，不拆微服务。官方 SDK 拥有认证、重连与 WebSocket 协议；ChatPM Core/PostgreSQL 持有唯一正式业务事实及 IM 状态；Harness 只可执行有边界的 AI 工具，不授予业务授权。

## 当前实现（待真实企业微信环境验证）

- `packages/im`：纯文本入站归一化、Bot ID 校验、仅认证后消费、群/私聊路由、主动 Markdown 发送；SDK 日志静默避免写出聊天正文或凭据。非 @ 群消息、历史、文件和卡片标记不支持。
- `030_im_inbox.sql`：组织机器人账户、AES-256-GCM 加密凭据、一次性绑定挑战、Verified User/Project Room 绑定和 Inbox 唯一键。机器人注册仅租户管理员可做；用户自己发起私聊 `/bind <token>`，群绑定仅项目 Owner 发起、同一 Owner 用已绑定企微账号在群发 `@机器人 /link <token>` 才生效。口令以 SHA-256 保存，10 分钟失效、一次性消费，不写入审计。
- `acceptWecomMessage`：把渠道认证后的事件再按有效 Bot、项目群和成员进行事务授权。观察者、已撤权成员、未知群、未绑定 ID 无写权限。已授权事件通过原 Conversation 消息序号、Outbox 与审计一次性事务入库，唯一 Inbox 防重复。绑定指令不作为项目消息。
- `031_im_delivery.sql`：项目正式 AI 消息创建时，对已绑定项目群写入外部投递意图；只有持有数据库会话领导锁的 Worker 领取投递，其他 Worker 不争抢消息；按 pending/sending/accepted/failed/unknown/cancelled 区分结果；离线时重试未发送意图，发送结果未知或 Worker 崩溃不自动重发。
- Fastify API 提供带登录会话的机器人注册/列表/禁用、自助身份绑定、项目 Owner 群绑定/撤销入口。Worker 定期协调已注册机器人连接和投递；同一 PostgreSQL 以会话级 Advisory Lock 选举唯一 IM Connector Leader，多 Worker 不应重复建立同一个机器人 WebSocket。需直连 PostgreSQL，事务池代理不满足该锁的会话亲和要求。
- `IM_ENCRYPTION_KEY` 从统一服务配置读取；API 和 Worker 必须使用相同密钥。现有模型配置仍由 ChatPM 管理，向 Harness 迁移尚未完成。

## API 流程（当前无完整可视化管理界面）

1. 组织管理员设置 IM_ENCRYPTION_KEY 后，通过 POST /tenants/:tenantId/im/bots 使用 {botId,secret,idempotencyKey} 注册机器人。列表 GET /tenants/:tenantId/im/bots 不返回密钥；停用 POST /tenants/:tenantId/im/bots/:accountId/disable 使用 idempotencyKey。
2. 成员使用 POST /im/bots/:accountId/bind-me 获取一次性 `/bind` 口令，直接在企微机器人**私聊**发送；同一账号对应一个当前有效的 ChatPM 用户。
3. 项目 Owner 使用 POST /projects/:projectId/im/bots/:accountId/link 获取 `/link` 口令，使用**自己已绑定的企业微信身份**在目标群 @机器人并发出命令。撤销使用 DELETE /projects/:projectId/im/bots/:accountId/link。
4. 群成员消息只有收到、身份匹配、拥有当前项目/组织成员权限时才写入；Worker 对聊天进行既有 AI 分析，AI 系统消息进入外部投递队列。

## 安全与局限

- 未验证群成员完整列表，项目 Owner 必须保证该群参与者有权看到项目内容；不能把群绑定视为企业微信内部群权限与 ChatPM RBAC 自动一致。绑定撤销后新消息不再入库；在途外部投递仍有网络竞态。
- 平台事件投递范围和重投递能力取决于企业微信。适配器只能保证**已成功收到并入库**事件的去重，不能声称群内所有未 @ 消息被采集或平台停机期间零丢失。
- SDK accepted 不是已读/送达，网络超时属于 unknown，不自动重发。消息过大/媒体验证失败不会悄悄降级为完整群数据。
- 机器人凭据轮换、手动外部投递结果核对/重试、**完整绑定状态与操作管理 UI**（现有 /im 仅基础表单）、多 Worker 领导切换故障注入与真实运维、系统管理员跨租户治理、会话存档合规、告警及企业微信实机端到端仍需完成。
- DeepSeek Harness 仍是开发者预览；本改动未替换原 AI 编排。不能将此代码直接认定生产安全发布。

## 验证

离线假 SDK 测试 + PostgreSQL 集成测试（机器人角色、组织/项目、挑战口令、重复消息、撤权、Outbox 投递状态）。真实企业微信、模型供应商与跨平台安装仍属外部验收。后续清单见 GitHub Issue #121。
