# 维护者指引：GitHub 分支保护与必需检查

本指南针对 `hamburger-os/ChatPM` 仓库 `main` 分支的 GitHub Ruleset。它是**仓库管理配置指引**，并非通过提交代码即可自动启用的设置。

## 必需的检查任务

所有 Pull Request 都应运行以下两个稳定的 GitHub Actions Job，不根据修改文件类型跳过：

- `verify` — Product verification：类型检查、单元测试、PostgreSQL 迁移、集成验证、Web 构建。
- `documentation` — Documentation governance：文档链接、结构和中英文同步检查。

在 GitHub 仓库中进入 **Settings → Rules → Rulesets → main → Require status checks to pass → Add checks**，搜索并选中由 GitHub Actions 提供的 `verify` 和 `documentation`，然后保存。界面可能带有 Workflow 名称前缀；应选择对应的 **Job**，不要选择 `Unit tests` 等单个 Step。

建议启用 **Require branches to be up to date before merging**、**Block force pushes**，保持线性历史并使用 Squash Merge。仅勾选要求状态检查而没有真正添加检查任务，无法发挥 CI 门禁作用。

维护者不能审核批准自己创建的 PR。如果存在第二位独立维护者，可提高必需批准人数；项目仅有一位维护者时，不应设置无法满足的审核规则。

## 为什么必需 Workflow 不加路径过滤？

如果必需的 Workflow 添加路径过滤，纯文档 PR 可能跳过应用检查并使对应必需状态长期处于等待中。两个必需的 Workflow 应始终在所有 PR 上运行，不应在必需 Job 上添加路径过滤。

其他检查如 `security.yml` 中的 CodeQL 与生产依赖审计也应关注；只有验证其在当前仓库中稳定运行后，再评估是否提升为必需检查。

## 合并前核对

1. 确认目标 PR 对应的准确 Head SHA 上，两个必需检查均通过。
2. 审查 Diff 中是否包含密钥、危险权限、Schema 变更或回归风险。
3. 确认文档、测试与实际实现一致。
4. 通过 Squash Merge 合并后，再检查 `main` 分支的 CI 结果。

**GitHub Rulesets 是仓库平台设置，而不是 Git 版本库中的文件；仅合并 PR 不会更改这些设置。**

[English](../en/maintainers.md)
