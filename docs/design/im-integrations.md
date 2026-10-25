# 自主 IM 接入与企业微信首发

## 核心决策

ChatPM 维护自己的 IM 接入层；dsh-im 是独立开源参考，不是运行依赖。每个平台实现独立 ChannelAdapter，优先使用官方 SDK。当前首发企业微信智能机器人长连接；不拆微服务或另建通用 IM 服务。

消息语义与通道代码分别归属 packages/im；项目、用户、任务、风险、报告、审批和审计始终归属原 Core/PostgreSQL。Harness 若在后续接入，负责 AI 执行，不作为企业成员鉴权或项目事实来源。

## 本 PR 实际代码范围

- ChannelAdapter、InboundText、OutboundText、ChannelCapabilities 的唯一契约；消息稳定键为 (channel, accountId, externalMessageId)。
- WecomAdapter 直接使用 @wecom/aibot-node-sdk 的官方 WebSocket 客户端；负责机器人登录状态、text 事件归一化、group/direct 路由、发送 Markdown。SDK 负责协议心跳和重连；send 的 accepted 不是已读。
- 严格校验机器人 ID、外部消息 ID、发送人和会话类型；没有真实持久绑定以前，外部发送人 ID 绝不能推断成 ChatPM User。
- 本次只提供文本传输适配器与离线测试，**未创建运行配置和生产启动接线**。因此企业微信群机器人尚未形成业务闭环。

## 真实交付前必须补齐的设计

1. 后端持久 ChannelAccount 配置、加密凭据、重连/轮换，管理员唯一写入口；不把 Key 暴露在 Harness Prompt 中。
2. 经验证的 ExternalIdentityBinding（组织/用户）与 ProjectRoomBinding（机器人/群/项目）；每次接收和后续命令均事务重验权限、撤销及时生效。
3. 事务 Inbox：外部事件唯一键、来源消息、去重、业务转交结果、错误分类与失败恢复；用户消息只能经 Conversation Core 写入，自动化不可冒充人工。
4. 持久出站 Outbox：以项目/目标/操作绑定授权，重审目标，发送 accepted/unknown/failed 分离，结果未知不盲目重试，项目工作时间与冷却规则适用。
5. 隔离的 PM Agent 运行工具、真实成员审批证据、防提示注入与跨项目访问；模型出站遵守项目显式授权。
6. 生产管理 UI（机器人创建、绑定、撤销、能力状态）与企业微信真实账号群聊 E2E；生产测试不得在实验环境使用敏感业务数据。

## 能力声明

当前企业微信官方 Bot SDK 有群内 @ 交互和主动消息接口，但 ChatPM 尚未实测接线。groupHistory、passiveGroupMessages、attachments、interactiveCards 为 false。平台有群聊 ≠ 产品已经交付群聊。无稳定官方群聊机器人的渠道可明确标记“不支持群聊”；未实现的平台标记“尚未接入”。不可静默补造不存在的消息。

## 为什么不选择其他方案

不依赖 dsh-im 内部动态服务接口，不复制其 WeCom bridge；不将平台 SDK 的回复回调当成项目授权；不建立第二个可写业务事实源；不把模型会话当作持久任务表；不为多渠道预先建立无人使用的复杂框架。新增第二渠道前复审当前契约在媒体、线程和群授权上的表达能力。
