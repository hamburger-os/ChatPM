# Installation and operations

The same compiled Node.js applications run on Windows, Linux and inside Compose containers. PostgreSQL 17 is required. ChatPM is an experimental application and has **not** passed production security or disaster-recovery certification.

- [中文：Windows / Linux / Docker 部署](../community/zh/development.md)
- [English: Windows / Linux / Docker setup](../community/en/development.md)

## Common requirements

- Node.js 24 LTS recommended, supported engine range is specified in `package.json`.
- PostgreSQL 17; server and client utilities for backup/restore.
- Build on the target OS/CPU architecture: `npm ci && npm run build && npm run check:distribution`.
- Set a cryptographically random `SESSION_SECRET`, DATABASE_URL (or PG* connection settings), WEB_ORIGIN.
- The Next.js frontend proxies same-origin `/api/*` to `API_INTERNAL_URL` (default `http://127.0.0.1:3001`); do not expose the API port publicly.

## Backup and restoration

```bash
node tools/ops/postgres.mjs backup ./backups/chatpm-YYYYMMDD.dump
# Stop API, Worker and Web and restore into a correctly provisioned database:
node tools/ops/postgres.mjs restore ./backups/chatpm-YYYYMMDD.dump --confirm-replace
npm run db:migrate:prod
```

Restore **destroys or replaces existing database objects**. Test regularly in a disposable instance and protect backup files with restricted permissions and encryption. These commands do not create a managed backup schedule. PostgreSQL client tools must be on PATH.

## Production gates still outstanding

External reverse-proxy hardening, penetration testing, operational metrics/alerts, load tests, verified Windows service restart behavior, disaster-recovery exercises and data retention policies remain required before sensitive production use.

### Docker Compose database backups

Production Compose does **not** publish PostgreSQL to the host. Use the database container's client, redirecting binary output on the host:

```bash
mkdir -p backups
docker compose -f infra/compose.prod.yml exec -T postgres pg_dump -U chatpm -d chatpm -Fc > backups/chatpm.dump
# After stopping app/worker/web, restore only into a disposable or explicitly targeted database:
docker compose -f infra/compose.prod.yml exec -T postgres pg_restore -U chatpm -d chatpm --clean --if-exists --no-owner --no-privileges < backups/chatpm.dump
```

These commands are examples and do not supply scheduling, encryption, verification or automated disaster recovery. Do not run destructive restore commands against active production data.
