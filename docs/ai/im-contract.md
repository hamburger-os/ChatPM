# 自主 IM 工程契约（ADR-088）

依赖方向：企业微信官方 SDK → packages/im（仅接收并归一化事件）→ 待建设的受控持久 Inbox → Core 正式命令；Core 不依赖 IM SDK、Harness 或 IM 用户昵称。

已经实现：文本事件通过 botId + platform msgId + sender.userid + group chatid/direct userID 归一化；不静默接收未实现的媒体；authenticated 前拒绝主动发消息；客户端停止后旧事件不能进入 sink；SDK 可能重投递，每次都会再次触发 accept。

下一阶段硬门禁：accept 必须在同一数据库事务里核验注册机器人、已绑定项目群与租户和项目成员资格，写入唯一持久事件 Receipt，调用 Conversation Core，再提交。重试不生成第二条正式消息。唯一事实是 PostgreSQL，不使用内存 Map 保证幂等。

模型不能传入 actorId 冒充审批人，不能通过只读群消息提升项目角色。出站投递必须从持久授权意图恢复，SDK accepted 不等于送达/已读；发送结果未知时人工或可信外部回执核对后再决定重试。

packages/core/test/im-wecom.test.ts 是假 SDK 的离线行为测试，不能声称已经完成企业微信实机 E2E。具体上线阻断与验收顺序见 docs/design/im-integrations.md。
