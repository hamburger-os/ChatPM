# GitHub branch protection and required checks

This guide applies to the `hamburger-os/ChatPM` repository's `main` ruleset.

## Mandatory job names

All pull requests run two stable GitHub Actions jobs, regardless of which files changed:

- `verify` — Product verification: typecheck, unit tests, PostgreSQL migrations, integration smoke tests, web build.
- `documentation` — Documentation governance: links, structure, bilingual document changes.

**Set the required checks in GitHub UI:** Settings → Rules → Rulesets → `main` → Require status checks to pass → Add checks. Search for **`verify`** and **`documentation`** and choose the checks produced by **GitHub Actions**. Save the ruleset. Exact display labels may include workflow prefixes in the UI; use the jobs under the named workflows, not individual steps such as `Unit tests`.

Leave **Require branches to be up to date before merging** and **Block force pushes** enabled. Keep linear history and use squash merges. Setting the checkbox alone without selecting checks offers no CI enforcement.

Reviewers cannot approve their own PRs. Increase required approving review count from zero when a second independent maintainer exists; do not block a single-maintainer project on an impossible approval policy.

## Why app-quality no longer uses path filters

A required GitHub Actions check must appear on **every** PR. Path-filtered workflows are skipped for docs-only PRs, potentially leaving a required check pending indefinitely. Both mandatory workflows now run for all PRs. Do not add job-level path filters to these mandatory checks.

The optional `security.yml` workflow runs CodeQL and production dependency auditing. Inspect its results, address high-severity findings, and consider making its jobs required **only after they have been validated on this repository**.

## Before merging

1. Wait for both required jobs to succeed on the exact PR head SHA.
2. Check the diff for secrets, unsafe permissions, schema changes, and regressions.
3. Confirm that docs and tests match actual functionality.
4. Squash merge, then verify both workflows on `main`.

Branch Rulesets are GitHub repository settings, **not files in Git**. They cannot be changed by merging a PR.
