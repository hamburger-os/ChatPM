# Development Guide

**The repository currently contains design documents and documentation checks only; no product code exists.** Planned technologies are not installed dependencies.

## What works during design
- Read [the docs index](../../README.md) and [root AGENTS.md](../../../AGENTS.md).
- With Node.js installed, run `node tools/docs/check-docs.mjs` from the repository root to check structure and local links.
- On PRs that change product code, run `node tools/docs/check-sync.mjs origin/main HEAD` for minimum documentation synchronization checks.

## Planned app layout (not created)
`apps/web` (Next.js), `apps/api` (NestJS), `apps/worker` (background jobs); reusable domain contracts and adapters will live under `packages`. Review the corresponding Chinese design before implementation.

## Contributions
Start with a clear use case and acceptance criteria. Update the AI docs, Chinese design, and relevant bilingual community pages alongside implementation. Do not claim non-existent development scripts or test results.

[中文](../zh/development.md)
