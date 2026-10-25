# ChatPM 自主 IM / Native IM Channels

[中文](#中文) · [English](#english)

## 中文

ChatPM 正在开发自主 IM 集成，不依赖 dsh-im。首个目标平台是企业微信智能机器人长连接，优先使用官方 SDK。当前仓库仅有**企业微信纯文本传输适配器及离线单测**，尚未提供机器人账号和密钥配置、群项目/成员身份验证、事务 Inbox/Outbox 或部署启动接线；**尚不能在企业微信真实群里完成项目管理闭环**。

群内 @机器人 ≠ 接收全群普通消息。非 @ 消息采集、历史回填、文件、图片和交互卡片目前均未实现；后续讨论会话存档须独立评估许可、告知和合规。其他平台逐个验证，未接入与平台根本不支持群 Bot 的状态分别标注。

[详细设计](../design/im-integrations.md) · [AI 工程契约](../ai/im-contract.md)。请不要向尚未实机验收的服务提供生产密钥或敏感项目数据。

## English

ChatPM is building its own IM integration rather than depending on dsh-im. WeCom intelligent bots are the first target, using the official SDK. This repository currently includes **a text-only adapter and offline tests**, but has no live bot configuration, verified group/project membership, durable Inbox/Outbox or production bootstrap. **End-to-end WeCom project management is not shipped.**

A group bot mention does not provide all regular group messages. Passive group capture, history import, attachments, images and card workflows remain unimplemented. Any archive-based ingestion requires independent licensing and privacy assessment. Other platforms must be implemented and validated individually, and unsupported group bot features are clearly marked.

See the [design](../design/im-integrations.md) and [engineering contract](../ai/im-contract.md). Do not use production credentials or sensitive project content with the unverified prototype.
