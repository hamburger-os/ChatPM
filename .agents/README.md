# Agent 配置与能力

- `/AGENTS.md` 是标准入口；本目录是 ChatPM 的补充约定。
- `rules/` 是项目自定义规则目录，**非跨工具自动发现标准**，根 `AGENTS.md` 已显式引用。
- `skills/<name>/SKILL.md` 遵循 [Agent Skills 规范](https://agentskills.io/specification)：YAML frontmatter（name/description）+ Markdown 指令。
- Skills： [docs-sync](skills/docs-sync/SKILL.md)、[architecture-review](skills/architecture-review/SKILL.md)。
- 不复制相互冲突的厂商规则；特定工具若需入口文件，应引用根 `AGENTS.md`。
