# Open blockers

Last updated: 2026-08-08T13:58:00Z

## Active remediation blockers

1. `GRIDEX-REM-002` clean empty-database replay is not green yet.
2. On last verified HEAD `8e678aaee387ffb15bc68072e48dc141e8947090`, the first failure is missing `public.communication_logs.customer_number` in `20260609183000_batch_8_admin_operations_website_email_webhooks.sql:67`.
3. The checksum-bound 7D communication-log reconstruction is implemented at the correct interleaved source boundary but requires real PR #90 CI before this failure can be closed.
4. The next replay failure, if any, is intentionally unknown until that CI artifact is read.

## Resolved blockers

- The prior `pricing_component_rules` replay prerequisite is confirmed fixed by CI; replay advances beyond `20260609100000`.
- The production NanoID advisory remains resolved at `nanoid 3.3.17`; same-HEAD `verify` and `security:audit-production` pass on `8e678a...`.

## Remaining campaign work

After `GRIDEX-REM-002` is VERIFIED on one final HEAD, continue directly with database/code consistency, tenancy/RLS/RBAC, flows, concurrency/idempotency, database and application performance, cache/rate limits, security, API/OpenAPI, large-file remediation and the final full rescan.
