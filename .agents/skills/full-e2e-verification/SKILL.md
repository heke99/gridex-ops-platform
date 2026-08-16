---
name: full-e2e-verification
description: Use when any project, release, pull request, deployed application, or tenant-scoped system must be verified end to end across real browser journeys, APIs, data, permissions, integrations, and deployed behavior, with optional remediation and repeatable reruns.
---

# Full E2E Verification

## Purpose

Prove business outcomes, not just green unit tests. This skill is project-agnostic. Read `PROJECT_E2E.yaml` for project-specific behavior and `references/protocol.md` for the execution protocol.

For real browser boundaries, use `.agents/skills/browser-e2e/SKILL.md` when present.

## Scope selection is mandatory

Resolve scope before testing anything.

### Explicit single target

If the user names one tenant, company, workspace, account, organization, site, environment, or equivalent target:

- switch to strict `single_tenant` / single-target mode;
- resolve exactly one target from the project's canonical data source;
- never silently broaden scope to every tenant;
- never run another tenant's business journey;
- never mutate another tenant as part of a negative test;
- run shared/global release gates once, then run the selected target from its first applicable entrypoint to its terminal business outcome;
- after a fix, rerun the affected checks and the selected target's applicable P0 suite;
- return one target verdict plus any global release-gate verdict.

Zero matches or ambiguous matches are `BLOCKED`, not permission to guess.

### All targets

If the user asks for all tenants/companies/accounts or gives no narrower target and the project contract defaults to all targets:

- discover targets from the canonical source;
- evaluate capabilities/readiness separately for every target;
- complete one target's applicable journey set before moving to the next;
- do not assume identical capabilities across targets;
- use `NOT_APPLICABLE` only when a capability is intentionally disabled by design;
- use `BLOCKED` when the capability is expected but prerequisites/configuration are missing;
- use `FAIL` when an enabled flow executes incorrectly.

Configuration alone never proves PASS.

## Required behavior

1. Read repository operating instructions and current project state.
2. Read `PROJECT_E2E.yaml`; fail closed if a required P0 scenario is undefined or cannot be executed safely.
3. Resolve execution scope exactly.
4. Discover actual implementation: routes, APIs, auth/RBAC, tenancy model, schema/migrations/types, queues/jobs, events/outbox, email/webhooks, external integrations, CI, deployment, and observability.
5. Build an execution matrix with `PASS`, `FAIL`, `BLOCKED`, `NOT_APPLICABLE`, or `NOT_RUN`.
6. Verify every critical journey across all applicable boundaries:
   `browser -> auth -> API/server -> domain logic -> database -> async/external effects -> read-back/UI`.
7. A `200` is never enough. Assert final persisted state, owner/tenant scope, events/jobs, provider state where observable, and the promised read-back/UI outcome.
8. Exercise configured negative paths: validation, unauthorized role, replay/idempotency, missing prerequisites, stale state, controlled provider failure, retry/recovery, and partial failure.
9. When a scenario fails, stop only that scenario at its first broken boundary, preserve evidence, continue independent scenarios in scope, find root cause, remediate when authorized, add regression coverage, and rerun.
10. Shared-core fixes (auth, tenancy, DB helpers, routing, domain services) require the applicable P0 suite to be rerun for the current scope.
11. Never mutate/delete real production customer data. Use isolated tagged fixtures and project cleanup rules.
12. Never expose secrets, credentials, cookies, tokens, private keys/certificates, private payloads, or personal data.
13. Do not claim completion until all required in-scope P0 scenarios have terminal results.

## Remediation contract

When the user authorizes fixes:

1. reproduce the failure;
2. identify the first broken boundary;
3. inspect browser/network/runtime/DB/queue/provider evidence;
4. implement the smallest production-quality root-cause fix;
5. add or strengthen a regression test;
6. rerun targeted verification;
7. rerun affected P0 journeys for the exact selected scope;
8. continue until the scope has a terminal verdict or a genuine external blocker remains.

Do not paper over bad data or bypass readiness/security checks to make E2E pass.

## Verdicts

- **GREEN**: all required in-scope P0 journeys and required release gates pass.
- **YELLOW**: P0 passes but explicitly documented non-critical gaps remain.
- **RED**: any in-scope P0 failure, security/authorization failure, migration/type drift, data-corruption risk, or critical integration/build/CI failure.
- **BLOCKED**: execution cannot proceed safely because a real prerequisite/access/dependency is unavailable.
- `BLOCKED`, `NOT_RUN`, or required `NOT_APPLICABLE` caused by missing expected configuration can never be promoted to GREEN.

## Evidence

For every scenario record scope/tenant, environment, commit/deployment identity, actor, browser checkpoint, request/status evidence, database assertions, async/provider assertions, logs/request IDs, cleanup, and defect/fix references.

Read `references/protocol.md` before execution.
