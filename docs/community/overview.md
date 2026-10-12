# ChatPM 项目概述 / Overview

[中文](#中文) · [English](#english)

## 中文

ChatPM 目标是一个以群聊为核心的 AI 项目管理平台。成员日常讨论任务，AI 根据授权项目上下文提取待确认事项、识别风险、跟进未完成工作，并起草可以回溯来源的项目汇报。

### 主要原则
- 以**结构化项目状态**而非 AI 推断作为正式任务进度依据。
- AI 在低风险范围内主动跟进，高影响决策由授权人确认。
- 用聊天室降低维护成本，不替代人的责任和项目治理。
- 先做好可靠的消息、任务闭环与权限，再扩展外部 IM 和更多模型。

### 导航
[中文设计](../design/README.md) · [技术架构](architecture.md) · [开发指引](development.md) · [贡献指南](contributing.md) · [English](#english)

已具备本地开发启动步骤，见 [开发指南](development.md)。文件知识库、实时推送及企业集成仍未完成。

---

## English

ChatPM aims to be a chat-centered AI project management platform. Team members discuss work naturally, while a scoped AI assistant extracts items for confirmation, surfaces risks, follows up on open work, and drafts project reports with traceable sources.

### Principles
- **Structured project records**, not model inferences, are the authoritative source of task progress.
- The AI may proactively follow up on low-risk work, while authorized humans approve high-impact decisions.
- Chat reduces administrative effort but never replaces human accountability.
- Build reliable messaging, task closure, and access controls before adding external chat integrations or more models.

### Navigation
[Chinese design](../design/README.md) · [Architecture](architecture.md) · [Development](development.md) · [Contributing](contributing.md) · [中文](#中文)

Local development instructions are available in the [development guide](development.md). Files, push-based chat and enterprise integrations remain unimplemented.
