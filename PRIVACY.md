# Privacy and data boundaries / 隐私与数据边界

**Status: experimental prototype, not a production privacy/compliance certification.**

## 数据存储 / Storage

ChatPM stores accounts, team/project memberships, project chat messages, tasks, proposed changes, AI metadata, risk records, reports, sessions, and audit records in its configured PostgreSQL instance. The operator controls that database, logs, backups, and its hosting environment.

## External AI / 外部模型

Cloud AI calls are off by default. An operator can supply server-managed `LLM_*` credentials, or a project owner may select built-in HTTPS OpenAI/DeepSeek and save a project-specific encrypted API key. An authorized project owner must separately enable AI analysis for that project. If enabled, selected **recent project chat messages, the currently analyzed message, and authoritative task/risk state** may be sent to the configured external model endpoint for suggestions, clarifications or read-only `@AI` answers. A model connection test sends a fixed non-project JSON probe. This is third-party data transfer, not a guarantee of local processing. Providers' retention, geography, costs and contracts depend on their account settings, not this repository.

Project model keys are stored with authenticated encryption derived from the deployment's `SESSION_SECRET`. They are never returned to browsers, but the server and its backups remain sensitive. Rotating that secret invalidates encrypted keys until the project owner re-enters them; full KMS-backed key rotation, privacy impact assessments and provider certifications have not been implemented.

## Access and limitations / 权限与限制

Project membership and session checks are implemented. However, production-grade data export/deletion workflows, configurable retention, account recovery, comprehensive privacy impact assessments and backup deletion are **not implemented or verified**. Do not upload confidential customer information to unreviewed demo environments. Never publish real credentials, chat contents or logs in Issues.

If you host ChatPM, you are responsible for providing notices, access controls, retention periods, deletion requests, backups, and compliance appropriate to your users.

See [SECURITY.md](SECURITY.md) for private vulnerability reporting and [implementation status](docs/design/implementation-status.md) for production blockers.
