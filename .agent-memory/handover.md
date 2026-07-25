# Handover

Last updated: 2026-07-25T15:40:00+02:00

## Verified

All enumerated P0/P1 code, local API contracts, tests, lint and production
build. See `verification-matrix.md`.

## Implemented but not database-verified

Migration `20260725120000_billing_readiness_and_supply_activation_v1.sql`,
especially transactional rollback/replay/isolation behavior.

## Active blockers

No Git metadata; no Supabase CLI/database; production deploy not performed.

## Migration state

299 local migration files. History/checksums pass. Applied remote state unknown.

## Exact next command

In an authorized staging repository:

`supabase db reset` (disposable local staging only), then run a dedicated SQL
transaction/replay/two-tenant test for `activate_customer_supply_v1`.

## Risks

Do not deploy the runtime call before the migration. Do not mark the database
gate verified from static tests alone. Keep `can_dispatch` customer-specific;
never infer it from area resolution.
