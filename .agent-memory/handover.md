# Handover

Last updated: 2026-07-26T18:00:00+02:00

## Verified

All enumerated P0/P1 code, local API contracts, tests, lint and production
build. See `verification-matrix.md`.

## Implemented but not database-verified

Migrations `20260725120000_billing_readiness_and_supply_activation_v1.sql` and
`20260726010000_contract_tenant_lifecycle_completion.sql`, especially
transactional rollback/replay/isolation behavior.

## Active blockers

No Git metadata; no Supabase CLI/database; production deploy not performed.

## Migration state

300 local migration files. History/checksums pass. Applied remote state unknown.

## Exact next command

In an authorized staging repository:

`supabase db reset` (disposable local staging only), then run a dedicated SQL
transaction/replay/two-tenant tests for `activate_customer_supply_v1`,
`gridex_close_contract_product` and `gridex_transition_tenant_lifecycle`.

## Risks

Do not deploy the runtime call before the migration. Do not mark the database
gate verified from static tests alone. Keep `can_dispatch` customer-specific;
never infer it from area resolution. A closed contract or tenant must never be
reopened by a generic status mutation.
