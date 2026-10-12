# ChatPM 文档中心

这里严格保留 **design、ai、community、knowledge 四个文档目录**，分别维护当前有效的产品设计、工程约束、社区说明和项目管理知识。历史版本差异归属 [Changelog](../CHANGELOG.md)、GitHub Releases 与 Git 提交记录；不在设计正文中反复叙述旧版本。

| 文档层 | 内容 |
|---|---|
| [中文产品与架构设计](design/README.md) | 产品边界、系统架构、数据与权限、异步处理、AI 规则、验收 |
| [AI 工程契约](ai/README.md) | 开发约束、模块契约、验证流程 |
| [社区中英双语指南](community/README.md) | 安装、贡献、架构与使用 |
| [通用项目管理知识](knowledge/README.md) | PMBOK、风险和治理参考 |

维护者的 GitHub 合并门禁与审核配置归入社区指南：[中文](community/maintainers.md#中文) / [English](community/maintainers.md#english)。

**当前状态：** 可运行的实验性应用，尚未具备生产级敏感数据处理能力。[实施状态与限制](design/implementation-status.md) 是当前范围的单一事实入口。

工程变更需同步当前设计和契约，并执行 [文档检查](../.agents/skills/docs-sync/SKILL.md)。贡献者从 [CONTRIBUTING](../CONTRIBUTING.md) 开始。
