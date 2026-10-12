# Development Guide

**Status: experimental v0.1 MVP for local use, not production-ready.**

Requires Node.js 22+ and Docker. From the repository root:

```bash
cp .env.example .env
# Replace SESSION_SECRET with a random string at least 32 characters long
docker compose -f infra/compose.yml up -d
npm install
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
