# Open blockers

Last updated: 2026-08-08T13:40:00Z

## Active remediation blockers

1. `GRIDEX-REM-002` clean empty-database replay is not green yet.
2. The current first failure is the missing pre-ledger
   `public.pricing_component_rules` prerequisite at
   `20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql:17`.
3. The narrow derived bootstrap fix is implemented but requires real PR #90 CI
   before the failure can be considered closed.
4. The next replay failure, if any, is intentionally unknown until the new CI
   artifact is read.

## Resolved blocker on the last verified HEAD

The production NanoID advisory is resolved: `nanoid` now resolves to `3.3.17`,
and PR #90 `verify` including `security:audit-production` passes on
`c627f81024e9c166aab5b9189192f54e160c0190`.

## Remaining campaign work

After `GRIDEX-REM-002` is VERIFIED on one final HEAD, continue directly with
database/code consistency, tenancy/RLS/RBAC, flows, concurrency/idempotency,
database and application performance, cache/rate limits, security, API/OpenAPI,
large-file remediation and the final full rescan.
