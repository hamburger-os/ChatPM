# Security Policy / 安全政策

ChatPM 涉及团队聊天、项目权限、模型请求和敏感工作资料。当前仍属实验性软件，不保证适合处理生产环境中的敏感信息。

## 报告漏洞

请优先通过 GitHub Private Vulnerability Reporting 提交私密报告（若仓库已启用该功能）：
https://github.com/hamburger-os/ChatPM/security/advisories/new

若入口不可用，请先通过仓库所有者的 GitHub 个人资料联系维护者取得私密沟通渠道，**不要在公开 Issue / Discussion 中发送漏洞利用细节、真实密钥、令牌或用户数据**。维护者应尽快确认并协调修复与披露。

报告内容建议包含：受影响代码或提交、前置条件、最小复现、潜在影响与修复建议。请仅在获授权的测试系统中验证，避免访问或更改他人数据。

## 维护范围

优先维护主分支与当前发布版本；尚未建立长期安全维护版本或固定响应 SLA。维护者会在确认问题、修复、验证和协调披露后发布必要的安全公告。

## 重要边界

默认不向第三方模型发送业务聊天；正式任务变更仍需服务端权限判定。生产使用前需自行完成 HTTPS、密钥保护、日志审查、备份恢复和模型数据治理评估。

**English:** Please disclose suspected vulnerabilities privately via GitHub security advisories when enabled. Do not publish exploit details or sensitive data in public issues. There is currently no long-term support promise or response-time SLA.
