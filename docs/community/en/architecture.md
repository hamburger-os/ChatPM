# Community Architecture Overview

The proposed architecture uses a **TypeScript monorepo, modular monolith, and a separate worker process**. Next.js provides the UI, Fastify the v0.1 API, PostgreSQL stores authoritative records, and a PostgreSQL Outbox and polling worker handle asynchronous analysis and reminders. Model and notification providers are replaceable adapters.

## Core modules
- Project and access control: membership, tenants, project scopes.
- Chat: durable messages, references, reconnect and catch-up.
- Work, risks, and decisions: formal domain state and approvals.
- AI orchestration: evidence-backed proposed changes.
- Automation and reporting: durable, deduplicated reminders and auditable reports.
- Knowledge: versioned, permission-scoped attachments and indexes.

**Important:** The model cannot directly mutate official task state. Domain commands and server-side authorization control changes. A transactional outbox connects persisted state updates to asynchronous events.

[Full design (Chinese)](../../design/system-architecture.md) · [中文](../zh/architecture.md)
