# Development Guide

**Status: experimental v0.2 MVP for local use, not production-ready.**

Requires Node.js 22+ and Docker. From the repository root:

```bash
cp .env.example .env
# Replace SESSION_SECRET with a random string at least 32 characters long
docker compose -f infra/compose.yml up -d
npm ci
npm run db:migrate
```

Start three terminals:

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

Open http://localhost:3000, register and create a project. External AI is disabled by default. To opt in, set `OPENAI_API_KEY` on the server and enable AI explicitly in project settings. Reminders require a task owner, due date, working hours and cooldown policy.

Checks: `npm run typecheck`, `npm test`, `npm run build:web`, `npm run check:docs`. Changes must follow [docs-sync](../../../.agents/skills/docs-sync/SKILL.md).

See [implementation gaps (Chinese)](../../design/implementation-status.md) for unimplemented features and security limitations. [中文](../zh/development.md).

## Reliability notes
The per-project message cursor follows transaction commit order to prevent missing chat messages. Replanning a task preserves the cooldown of its last reminder. Weekly/monthly counts cover all project tasks while detail lists are bounded; drafts can be regenerated, but published reports remain immutable. Verify these behaviors with `node tools/test/smoke.mjs` against a migrated PostgreSQL instance.

## v0.2 clarification and recovery
For opted-in AI, tasks with missing details get a `【候选:UUID】` reference. Team members may reply with the exact reference and an explicit assignee or timezone-aware deadline. Suggestions remain pending until the project owner approves them. Owners may inspect and retry quarantined background events in Settings. AI_DAILY_REQUEST_LIMIT limits each project's daily model calls (default 50); external AI remains disabled by default. Database regression: `node --import tsx packages/core/test/outbox.integration.ts`.
