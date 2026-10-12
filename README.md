# ChatPM · AI 项目经理

> 以项目群聊为协作入口，以可信项目状态为事实来源，由 AI 主动跟进任务、风险和决策。

**项目状态：设计阶段（Design-first）**。当前仓库只包含已审查架构基线、治理和文档工具；尚无可安装或可运行的 ChatPM 产品。请不要把概念设计当作已实现的功能。

## 核心体验
1. 成员在项目聊天室内沟通与分享资料。
2. AI 从消息中识别任务、依赖、阻塞和待决策事项，保留证据。
3. 经过规则和权限校验后，将提取结果转为待确认或正式项目状态。
4. AI 在适当时间跟进未完成事项，减少重复打扰，并汇总周报/月报。
5. 用户可查看来源、确认、修正和追溯 AI 的每项关键判断。

## 从哪里开始
- [文档总览与四层索引](docs/README.md)
- [供产品负责人审查的中文方案](docs/design/README.md)
- [开发 Agent 的架构约束](docs/ai/README.md)
- [项目管理通用知识](docs/knowledge/README.md)
- [社区参与指南（中英双语）](docs/community/README.md)
- [架构决定记录](docs/design/decision-log.md)

## 如何使用
当前处于**设计评审阶段**，暂无启动命令、账号注册或演示环境。建议先审阅产品边界、架构、AI 行为、主动跟进、数据安全和验收标准；确认后再按路线图实施 MVP。

开发贡献者请先阅读 [AGENTS.md](AGENTS.md)，以及 [中文贡献指南](docs/community/zh/contributing.md) / [English contributing guide](docs/community/en/contributing.md)。代码变化必须同步更新设计文档和 AI 文档，并通过文档检查。

## 架构概况
预计采用 TypeScript Monorepo、Next.js、NestJS、PostgreSQL、Redis/BullMQ 和可替换模型适配器。选择**模块化单体 + 独立 Worker 进程**；结构化业务状态是真实项目记录，向量检索只提供参考证据。该技术栈是设计选择，不表示依赖已安装。

## English
**ChatPM is a design-first AI project manager centered on team chat.** It extracts evidence-backed project information, seeks confirmation when needed, follows up on commitments, and prepares reports. There is no runnable application yet. Start with the [English overview](docs/community/en/overview.md), [architecture](docs/community/en/architecture.md), and [contributing guide](docs/community/en/contributing.md).

## 项目说明
- 设计文档为主要审查界面，关键架构改变先修改 `docs/design/`。
- 项目当前未指定开源许可证；在明确许可证前，请勿假设拥有再分发或商用授权。
- 项目管理标准知识仅作概括与参考，不复制受版权保护的标准原文。
