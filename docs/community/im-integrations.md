# ChatPM 自主 IM / Native IM Channels

[中文](#中文) · [English](#english)

## 中文

ChatPM 内置自主 IM 接入，不依赖 dsh-im；首个渠道使用企业微信智能机器人官方 WebSocket SDK。当前已加入机器人管理 API 和基础 `/im` 设置界面、一次性口令验证身份和群绑定、持久 Inbox 与外部消息投递状态、Worker 单领导者连接生命周期及自动化测试。**仍处于实验性阶段，没有真实企业微信群端到端验证，不能用于敏感生产项目。**

为启用测试，先在 API/Worker 共享环境设置随机 `IM_ENCRYPTION_KEY`（至少 32 字符），完成数据库迁移。组织管理员注册企业微信 Bot 后，成员可向 `POST /im/bots/:accountId/bind-me` 请求十分钟有效的私聊 `/bind` 口令；项目负责人向 `POST /projects/:projectId/im/bots/:accountId/link` 获取 `/link` 口令，并使用自己已绑定的企业微信账号在目标群 @机器人。完成后，真正送达且已授权的文本进入项目消息，ChatPM 已生成的 AI 消息通过 Worker 投递到绑定群。

群内 @机器人与完整群消息存档不是一回事。未 @ 群消息、历史回填、文件与卡片工作流都尚未交付；其他平台也尚未接入。外部发送成功仅为 SDK 接受，不代表已读；未知发送结果不自动重发。测试前应核实群成员有权查看项目资料，绑定/停用请使用受保护的 API。已有基础可视化操作页面 `/im`，但仍缺少完整绑定状态与凭据轮换、实机验证和更严格的隐私治理。

[详细设计](../design/im-integrations.md) · [工程契约](../ai/im-contract.md) · [跟踪问题](https://github.com/hamburger-os/ChatPM/issues/121)。

## English

ChatPM owns its IM integration and does not depend on dsh-im. Its first adapter uses the official WeCom intelligent-bot WebSocket SDK. Experimental code now includes authenticated administration APIs, a basic `/im` settings page, one-time user and project-room pairing, a durable Inbox and delivery-state table, a single-leader Worker lifecycle, and automated tests. **No real WeCom end-to-end validation has been performed, and sensitive production deployment is not supported.**

For isolated testing, configure a distinct random `IM_ENCRYPTION_KEY` (at least 32 characters) for both API and Worker and run migrations. A tenant administrator registers the Bot. Each member obtains a ten-minute `/bind` challenge from `POST /im/bots/:accountId/bind-me` and sends it to the Bot in a direct conversation. The project owner obtains `/link` from `POST /projects/:projectId/im/bots/:accountId/link` and sends it while mentioning the Bot in the target group from the same verified WeCom account. Authenticated, actually received text can then enter project messages; committed internal AI replies can be queued for group delivery.

Bot mentions do not grant access to all regular group messages. Passive capture, history import, files, cards, further IM channels, full pairing-status administration, secret rotation and real-device testing remain unavailable. API acceptance is not end-user delivery. Verify group-member data access before testing, and do not use sensitive production workloads.

[Architecture](../design/im-integrations.md) · [Engineering contract](../ai/im-contract.md) · [Remaining work](https://github.com/hamburger-os/ChatPM/issues/121).
