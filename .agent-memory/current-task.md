# Current task

Last updated: 2026-07-25T15:40:00+02:00
Branch: UNVERIFIED (uploaded archive excludes `.git`)
Last verified commit: null
Working tree status: patch tracking is byte-diffed against the uploaded ZIP

## Active phase

PHASE-22 — migration and production verification.

## Active work item

WP-022 — apply and validate the forward migration in an authorized Supabase
environment.

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

## Verification performed

`npm run typecheck`, `npm test -- --testTimeout=15000` (346/346),
`npm run api:docs`, `npm run db:migrations:check`, `npm run lint` (0 errors)
and `npm run build` all pass locally.

## Exact next action

Apply `20260725120000_billing_readiness_and_supply_activation_v1.sql` in a
staging Supabase project, then run transactional replay, rollback and
two-tenant isolation tests against `activate_customer_supply_v1`.

## Blockers

No local Supabase CLI, Docker/database runtime or authorized remote database is
available. Git branch/commit provenance is also unavailable.

## Do not repeat

Do not redo the repository inventory or P0/P1 static implementation. Resume
from database apply verification and production deployment parity.
