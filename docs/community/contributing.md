# 社区贡献 / Contributing

[中文](#中文) · [English](#english)

## 中文

欢迎协助改进设计、提出问题、补充测试场景和后续实现。

### 流程
1. 阅读 [产品范围](../design/product-scope.md)、[架构决策](../design/decision-log.md) 和 [AGENTS.md](../../AGENTS.md)。
2. 在 Issue/讨论中说明场景、痛点、拟修改模块、影响与验收方式；重要架构变化先更新中文设计并获得审查。
3. 使用功能分支发起 Pull Request；不要直接绕过 main 的保护规则。
4. 同一 PR 同步 `docs/design/` 和 `docs/ai/`；对外行为变化应在同一个 `docs/community/<topic>.md` 中同步更新中文与 English 章节。
5. 运行文档检查并说明真实结果；审查者重点核对风险、权限、领域边界与中英文语义。

### 提交要求
PR 描述至少包含：目的、设计依据、测试结果、文档映射、风险与待审事项。项目采用 [Apache-2.0](../../LICENSE)；贡献者必须有权授权其提交内容，勿提交密钥或私密客户数据。

[English](#english)

---

## English

Contributions to design, issue scenarios, test cases, and later implementation are welcome.

### Workflow
1. Read [product scope](../design/product-scope.md), [architecture decisions](../design/decision-log.md), and [AGENTS.md](../../AGENTS.md).
2. In an issue/discussion, describe the use case, affected modules, expected impact, and acceptance criteria. Update the Chinese design and seek review before significant architectural work.
3. Open a pull request from a feature branch; do not bypass protected main-branch rules.
4. Update `docs/design/` and `docs/ai/` in the same PR. For public behavior changes, update both Chinese and English sections in the same `docs/community/<topic>.md` file.
5. Run documentation checks and report actual results. Reviewers should validate domain boundaries, security, traceability, and translation consistency.

### PR description
Include motivation, design reference, tests, documentation mapping, risks, and outstanding decisions. ChatPM uses [Apache-2.0](../../LICENSE). Contributors must have rights to submit their work. Never include secrets or private customer data.

[中文](#中文)
