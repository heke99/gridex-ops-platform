---
name: full-e2e-verification
description: Use when a project, release, pull request, or production system must be verified end to end across real user journeys, APIs, data, permissions, external integrations, and deployed behavior before it can be declared ready.
---

# Full E2E Verification

## Purpose

Prove business outcomes, not just green unit tests. Treat `PROJECT_E2E.yaml` as the project-specific test contract and `references/protocol.md` as the execution protocol.

## Required behavior

1. Read repository operating instructions and current project state first.
2. Read `PROJECT_E2E.yaml`; fail closed if a required P0 scenario is undefined or cannot be executed safely.
3. Discover the actual implementation before testing: routes, APIs, auth/RBAC, database schema/migrations/types, jobs, events/outbox, email/webhooks, external integrations, CI and deployment.
4. Build an execution matrix for every configured scenario and record `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`.
5. Verify each critical journey across every applicable boundary:
   `browser -> auth -> API/server -> domain logic -> database -> async/integration side effects -> read-back/UI`.
6. A `200` response is not proof. Assert the intended persisted state, ownership/tenant scope, emitted events, provider acceptance/delivery state where observable, and final user-visible result.
7. Test negative paths: unauthenticated, unauthorized, cross-tenant, duplicate/replay, missing data, expired state, provider failure, retry/recovery, and partial failure where relevant.
8. On failure, stop only that scenario at the broken boundary, preserve evidence, continue independent scenarios, diagnose root cause, fix only when authorized, then rerun targeted and neighboring regressions.
9. Never mutate or delete real production customer data. Production tests must use isolated test identities and the configured safe-data policy.
10. Never expose secrets, tokens, credentials, certificates, cookies, private payloads, or personal data in evidence.
11. Do not claim completion until all required P0 scenarios have terminal results and the release verdict is produced.

## Release verdict

- **GREEN**: all required P0 and required release gates pass; no unresolved critical/security/tenant-isolation blocker.
- **YELLOW**: core P0 behavior passes, but explicitly documented non-critical gaps remain.
- **RED**: any P0 failure, tenant/security failure, migration/type drift, critical integration failure, data-corruption risk, or required CI/build failure.
- **BLOCKED** is not GREEN.

## Evidence

For each scenario record environment, commit/deployment identity, actor, browser checkpoint, request/status evidence, database assertions, external side-effect assertions, logs/request IDs, cleanup result, and any defect/fix reference.

Read `references/protocol.md` before execution.
