# Current task

Last updated: 2026-07-26T23:45:00+02:00
Branch: UNVERIFIED (uploaded archive excludes `.git`)
Last verified commit: null
Working tree status: patch tracking is byte-diffed against the uploaded ZIP

## Active phase

PHASE-27 — contract/admin/API alignment.

## Active work item

WP-027 — apply and transaction-test the final contract/admin/API alignment
migration in an authorized Supabase environment.

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
- qualified final delete/close SQL, backfill cleanup, quote-aware preview,
  safe legacy deletion, isolated bulk cleanup and terminal list pagination.
- service-only delete preview, final tenant lifecycle qualification, tenant-
  preserving admin navigation/statistics and canonical API auth/error docs.

## Verification performed

`npm run typecheck`, `npm test -- --testTimeout=15000` (354/354),
`npm run api:docs`, `npm run db:migrations:check`, `npm run lint` (0 errors)
and `npm run build` all pass locally. Dedicated contract/tenant lifecycle and
delete-graph regressions pass. The new migration is statically verified but
requires PostgreSQL application.

## Exact next action

Apply pending forward migrations in a staging Supabase project, then run
`npm run gridex:contract-delete-graph-post-apply` followed by transactional
delete/bulk/two-tenant tests. The newest migration is
`20260726230000_contract_admin_api_alignment.sql`.

## Blockers

No local Supabase CLI, Docker/database runtime or authorized remote database is
available. Git branch/commit provenance is also unavailable.

## Do not repeat

Do not redo the repository inventory or P0/P1 static implementation. Resume
from database apply verification and production deployment parity.
