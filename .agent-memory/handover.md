# Handover

Last updated: 2026-07-27T17:20:00+02:00

## Verified locally

Typecheck, lint, API/OpenAPI/docs, migration history, 40 contract tests and 18
fixed-area tests pass. Focused identity/supply/billing tests pass 49/54; five
legacy readiness fixtures omit the exact identities now required.

## Implemented but not database-verified

`20260727010000_contract_flow_integrity_completion.sql` and earlier pending
forward migrations. The final migration changes role/contract/onboarding/
activation/underlay definitions, creates same-customer triggers and reserves
invoice runs/items/mirrors atomically.

## Active blockers

No Git metadata, Supabase/PostgreSQL/Docker runtime, authorized remote database,
provider credentials or provider sandbox.

## Migration state

304 local migration files, 209 version groups. History/checksums pass. Applied
remote state is unknown.

## Exact next action

Apply pending migrations in an authorized staging project, ending with
`20260727010000_contract_flow_integrity_completion.sql`. Run the read-only SQL
in `docs/contract-flow-integrity-2026-07-27.md`; then transaction-test two
tenants through contract creation/listing, conflicting identity, confirmed
supply, missing/complete meter values, canonical export, provider event and
portal invoice visibility.

## Risks

Deploy runtime and migration together. Do not mark the database or provider
gates verified from static checks. Do not relax exact readiness or use a
delivery-point identifier as a customer identity.
