# Current task

Last updated: 2026-07-26T18:00:00+02:00
Branch: UNVERIFIED (uploaded archive excludes `.git`)
Last verified commit: null
Working tree status: patch tracking is byte-diffed against the uploaded ZIP

## Active phase

PHASE-25 — contract and tenant lifecycle completion.

## Active work item

WP-025 — apply and transaction-test the lifecycle migration in an authorized
Supabase environment.

## Completed release scope

- granular resolver capabilities/blockers;
- canonical current-market, quote and quote-validation requests;
- explicit public application DTO and public-ID policy;
- switch creation/dispatch split;
- real invoice-readiness inputs and immutable configuration snapshots;
- invoice-only portal resources;
- exact hourly/quarter-hour source selection;
- authenticated reconciliation cron and cron-tree test;
- atomic supply activation RPC and transactional outboxes;
- truthful active/internal/planned event documentation;
- OpenAPI/docs/runtime version `2026-07-25.1`.
- terminal contract closure with dependent-channel cleanup and audit/outbox;
- readiness-gated tenant activation and precondition-gated tenant closure;
- tenant-status enforcement for integration API clients;
- removal of competing direct company-status mutations.

## Verification performed

`npm run typecheck`, `npm test -- --testTimeout=15000` (354/354),
`npm run api:docs`, `npm run db:migrations:check`, `npm run lint` (0 errors)
and `npm run build` all pass locally. The dedicated contract/tenant lifecycle
regression also passes.

## Exact next action

Apply both pending forward migrations in a staging Supabase project, then run
transactional close/reactivation/replay and two-tenant isolation tests. Start
with `20260726010000_contract_tenant_lifecycle_completion.sql`.

## Blockers

No local Supabase CLI, Docker/database runtime or authorized remote database is
available. Git branch/commit provenance is also unavailable.

## Do not repeat

Do not redo the repository inventory or P0/P1 static implementation. Resume
from database apply verification and production deployment parity.
