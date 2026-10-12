# Development Guide

Node.js 24 LTS is recommended; Docker is optional and only provides the development PostgreSQL instance. From the repository root:

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

Production: run `npm run build`, `npm run db:migrate:prod`, and start the compiled `start:api`, `start:worker`, and `start:web` scripts. The browser always uses same-origin `/api`, which is forwarded to `API_INTERNAL_URL` by Next.js.

Checks: `npm run typecheck`, `npm test`, `npm run build:web`, `npm run check:docs`. Changes must follow [docs-sync](../../../.agents/skills/docs-sync/SKILL.md).

See [implementation gaps (Chinese)](../../design/implementation-status.md) for unimplemented features and security limitations. [中文](../zh/development.md).

## Reliability notes
The per-project message cursor follows transaction commit order to prevent missing chat messages. Replanning a task preserves the cooldown of its last reminder. Weekly/monthly counts cover all project tasks while detail lists are bounded; drafts can be regenerated, but published reports remain immutable. Verify these behaviors with `node tools/test/smoke.mjs` against a migrated PostgreSQL instance.

## clarification and recovery
For opted-in AI, tasks with missing details get a `【候选:UUID】` reference. Team members may reply with the exact reference and an explicit assignee or timezone-aware deadline. Suggestions remain pending until the project owner approves them. Owners may inspect and retry quarantined background events in Settings. AI_DAILY_REQUEST_LIMIT limits each project's daily model calls (default 50); external AI remains disabled by default. Database regression: `node --import tsx packages/core/test/outbox.integration.ts`.

## Scheduled reporting
The Worker creates a scheduled weekly/monthly report only once per project and reporting period. Polling does not overwrite drafts; owners can manually regenerate an unpublished draft, while published reports remain unchanged. Database regression: `node --import tsx packages/core/test/reports.integration.ts`.

## Tenant and project API

Call `GET /tenants` to list the user's teams and roles. `POST /projects` requires explicit `tenantId`, `name`, and `timezone`; the authenticated user must be an administrator of that team. There is no implicit default tenant selection. A project owner may remove a regular member, but the API returns 409 while that member owns unfinished tasks; reassign or cancel those tasks first to avoid orphaned reminders. Logout revokes the server-side session.

## Required GitHub checks

PRs must pass the `verify` (product and database validation) and `documentation` (documentation governance) jobs. Maintainers must select those exact GitHub Actions checks in the repository ruleset; see [branch protection guide](../../maintainers/status-checks.md). The project listing API includes work hours and cooldown settings, returning explicit `null` values when not configured; API regression tests cover these fields.

## Native Windows 11 (no Docker)

Install Node.js 24 and PostgreSQL 17 (including `pg_dump` and `pg_restore`). Create a dedicated database and user. From PowerShell: `Copy-Item .env.example .env`, configure database credentials and a secure SESSION_SECRET, then `npm ci; npm run build; npm run db:migrate:prod`. Start three PowerShell windows with `./infra/windows/start.ps1 api`, `./infra/windows/start.ps1 worker`, and `./infra/windows/start.ps1 web`.

For Windows services, obtain and verify WinSW independently, then run `./infra/windows/install-services.ps1 -WinSWPath <path>` as administrator. It registers services only; choose least-privilege accounts, protect files and verify start/stop/restart before production use.

## Native Linux (no Docker)

Install Node.js 24, PostgreSQL 17 and client utilities. Install the source at `/opt/chatpm`, create a dedicated `chatpm` user, and run `npm ci && npm run build && npm run check:distribution`. Supply `NODE_ENV=production`, DATABASE_URL, SESSION_SECRET, WEB_ORIGIN and API_HOST=127.0.0.1 in a restricted `/etc/chatpm/chatpm.env`. Run `npm run db:migrate:prod`. Install the templates from `infra/linux/` to systemd, adjust the actual Node path and start `chatpm-api`, `chatpm-worker`, `chatpm-web`. Put Caddy or another HTTPS proxy in front of Web; do not expose the API/database publicly.

## Complete Docker Compose

Set POSTGRES_PASSWORD, SESSION_SECRET and WEB_ORIGIN in root `.env`. Run `docker compose -f infra/compose.prod.yml up -d --build`. Only `127.0.0.1:3000` is published; add a secure external HTTPS proxy to expose it. `infra/compose.yml` remains the database-only development Compose.

## Database operations and release status

`node tools/ops/postgres.mjs backup ./backups/chatpm.dump` creates a PostgreSQL custom-format backup. After stopping ChatPM and selecting an isolated target, `node tools/ops/postgres.mjs restore ./backups/chatpm.dump --confirm-replace` **overwrites database objects**. Automated backups, real recovery exercises, TLS, Windows service resilience, operational alerts, and production security certification have not been completed; do not use sensitive production data.
