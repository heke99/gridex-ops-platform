# Handover

Last updated: 2026-07-26T23:45:00+02:00

## Verified

All enumerated P0/P1 code, local API contracts, tests, lint and production
build. See `verification-matrix.md`.

## Implemented but not database-verified

Migrations `20260725120000_billing_readiness_and_supply_activation_v1.sql`,
`20260726010000_contract_tenant_lifecycle_completion.sql`,
`20260726090000_contract_create_delete_runtime_alignment.sql` and
`20260726140000_contract_deletion_graph_completion.sql` and
`20260726230000_contract_admin_api_alignment.sql`, especially
transactional rollback/replay/isolation and real FK behavior.

## Active blockers

No Git metadata; no Supabase CLI/database; production deploy not performed.

## Migration state

303 local migration files, 208 version groups. History/checksums pass. Applied
remote state unknown.

## Exact next command

In an authorized staging repository:

Apply migrations, then run `npm run gridex:contract-delete-graph-post-apply`.
After that run dedicated transaction/replay/two-tenant tests for delete,
isolated bulk cleanup, close (including paused channels), preview execute
privileges and `activate_customer_supply_v1`.

## Risks

Do not deploy the runtime call before the migration. Do not mark the database
gate verified from static tests alone. Keep `can_dispatch` customer-specific;
never infer it from area resolution. A closed contract or tenant must never be
reopened by a generic status mutation.
