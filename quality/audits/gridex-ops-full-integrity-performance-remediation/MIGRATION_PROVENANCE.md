# Migration provenance

Date: 2026-08-08
Branch: `remediation/gridex-ops-full-integrity-performance`
Base: `5923b5c17fe96c0453048bdc102203efb65f7d7a`

## GRIDEX-REM-001

Status: IMPLEMENTED; remote verification pending.

The branch restores the two already-applied AUD-001 migration files under the exact versions present in the connected dev ledger, without mutating live migration history.

## GRIDEX-REM-002 — canonical clean replay

Severity: P1
Status: IMPLEMENTED / CI FAILED / NOT VERIFIED

Historical applied SQL remains immutable. Replay uses checksum-pinned derived reconstruction artifacts and chronological interleaving where required. No replay fix writes to live Supabase.

### Confirmed progression

Replay has moved beyond the previously missing pricing, communication-log, external-intake, contract-energy, membership-RBAC and customer-blocker prerequisites.

At `02e0dca29584fd6854e117f03043382b9a709f77`, `verify`, migration/provenance checks, targeted regressions and `security:audit-production` all PASS. Clean replay next fails at `20260612123000_performance_batches_1_to_3_db_acceleration.sql:593` because `public.customer_info_requests` does not exist.

### Current source-family reconciliation

`customer_info_requests` belongs to checksum-pinned pre-ledger source `20260520_batch_3_4_onboarding_pricing_billing_engine.sql`. That source is already substituted by narrow `metering_permissions` and `pricing_component_rules` artifacts, so its other schema objects are absent from replay too.

Rather than repair one omitted relation at a time, add `supabase/bootstrap/20260520_onboarding_billing_auxiliary_foundation.sql` covering the remaining schema-only source family: `customer_info_requests`, `customer_info_request_events`, `authorization_scopes`, `metering_permission_sites`, `billing_export_runs`, `billing_export_run_items`, the source-defined POA/contract-offer metadata extensions, indexes and service-role RLS. No customer requests, scopes, export rows or product data are seeded.

Artifact SHA-256: `976a9d56a38732973c60429a31e56ffe40f00a1ec6f6a68791a8a2dd5e95ed8e`.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI must prove replay advances.

### Security dependency gate

Resolved. Production NanoID resolves to `3.3.17`; `security:audit-production` remains enabled and green.

### Definition of VERIFIED

REM-002 remains open until full clean replay, final schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Then the campaign must complete its final rescan and all remaining findings before merge.
