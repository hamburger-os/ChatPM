# 自主 IM 工程契约（ADR-088/089/090）

依赖与权限：官方 SDK → packages/im（传输）→ Core 的 `acceptWecomMessage`（事务可信绑定+Inbox）→ 原有 Conversation Core 消息/Outbox/审计。模型 Prompt、外部昵称和消息正文都不构成操作者身份。Worker 只做运行时连接和数据库驱动的发送。

已落地：
- `im_accounts` 的租户管理员注册与独立 AES-GCM 机器人凭据（`IM_ENCRYPTION_KEY` 唯一读取自 serverConfig，客户端不读取密钥）。
- `im_binding_challenges` 的哈希单次口令：用户需在 Bot 私聊证实外部身份，Owner 需用相同已绑定企微身份在项目群确认；角色/成员资格在事务中重验。
- `im_user_bindings` 和 `im_room_bindings` 只允许活跃绑定；明确组织、项目和 Bot 作用域。
- `im_inbox` 依据 Bot+平台 messageId 唯一去重；同事务保存正式 user 消息、审计和现有 AI Outbox；只有 `message.write` 成员能发表项目内容，敏感绑定指令不入项目消息。
- `im_deliveries` 仅由正式 AI 消息写入触发；Worker SDK ack = accepted，不是 read。发送异常 = unknown（未连接且明确未尝试则 pending）；超时/异常或崩溃后的未知结果不能盲重发。

强制约束：所有业务写入必须经过有权限的 Core 命令；跨租户、观察者、未绑定群、撤权用户严格拒绝；平台消息 ID 不可自行转换为 ChatPM session。SDK 不得记录明文正文/凭据。

当前缺口：企业微信真实连接与群端到端、媒体、持续群监听、外部群成员完整映射与告知、凭据轮换、手动 Unknown 处置、插件化 Harness AI 工具、后台 UI、完整安全与可靠性实测。测试文件 `im-wecom.test.ts` 与 `im-bindings.integration.ts` 分别为离线与 PostgreSQL 回归，不构成实机证明。


连接唯一性：`WecomSupervisor` 必须占有同一数据库的 PostgreSQL **session-level advisory lock** 才能启动平台 SDK；进程退出或 DB session 丢失时停止连接。此设计要求 direct PostgreSQL/session affinity，不允许事务池复用误认为已有独占锁。生产仍须演练数据库断线、故障切换和多进程高并发。当前 /im 管理界面为基本操作表单，非完整安全验收。
