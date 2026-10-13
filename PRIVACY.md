# Privacy and data boundaries / 隐私与数据边界

**Status: experimental prototype, not a production privacy/compliance certification.**

## 数据存储 / Storage

ChatPM stores accounts, team/project memberships, project chat messages, tasks, proposed changes, AI metadata, risk records, reports, sessions, and audit records in its configured PostgreSQL instance. The operator controls that database, logs, backups, and its hosting environment.

## External AI / 外部模型

Cloud AI calls are off by default. A server operator must configure `LLM_API_KEY` and a trusted `LLM_BASE_URL` (plus model and API style), and the project owner must explicitly enable AI for the project. If enabled, selected project chat text may be sent to the configured external model endpoint to generate suggestions and clarifications. The endpoint can be OpenAI, DeepSeek or another operator-selected service. Treat external model requests as third-party data transfer, not guaranteed local processing. Provider retention, processing geography and contractual terms depend on the provider/account settings and are not controlled by this repository.

## Access and limitations / 权限与限制

Project membership and session checks are implemented. However, production-grade data export/deletion workflows, configurable retention, account recovery, comprehensive privacy impact assessments and backup deletion are **not implemented or verified**. Do not upload confidential customer information to unreviewed demo environments. Never publish real credentials, chat contents or logs in Issues.

If you host ChatPM, you are responsible for providing notices, access controls, retention periods, deletion requests, backups, and compliance appropriate to your users.

See [SECURITY.md](SECURITY.md) for private vulnerability reporting and [implementation status](docs/design/implementation-status.md) for production blockers.
