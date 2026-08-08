# Migration provenance

Date: 2026-08-08
Branch: `remediation/gridex-ops-full-integrity-performance`
Base: `5923b5c17fe96c0453048bdc102203efb65f7d7a`

## GRIDEX-REM-001

Status: IMPLEMENTED; campaign verification pending final same-HEAD closeout.

The branch restores the two already-applied AUD-001 migration files under the exact versions present in the connected dev ledger, without mutating live migration history.

## GRIDEX-REM-002 — canonical clean replay

Severity: P1
Status: IMPLEMENTED / CI FAILED / NOT VERIFIED

Historical applied SQL remains immutable. Replay uses checksum-pinned derived reconstruction artifacts and chronological interleaving where required. No replay fix writes to live Supabase.

### CI-confirmed progression

Replay has moved beyond missing prerequisites for pricing component rules, communication-log trace fields, external contract intakes, customer-contract energy-resolution fields, company-membership RBAC runtime shape, customer blockers and customer-info-request reachability.

At `a2189aa684f1bc65149d15e283723b2f75875858`, `verify`, migration/provenance checks, targeted regressions, typecheck and `security:audit-production` all PASS. Clean replay fails before tracked history finishes, inside `bootstrap/20260520_onboarding_billing_auxiliary_foundation.sql`, because DB1 already created `billing_export_run_items` with the older `export_run_id` shape. `CREATE TABLE IF NOT EXISTS` therefore no-ops and the source index later sees no `billing_export_run_id`.

### Current reconciliation — additive DB1/source billing convergence

The checksum-pinned source `20260520_batch_3_4_onboarding_pricing_billing_engine.sql` expects `billing_export_run_id`, `readiness_status` and `payload_snapshot`. DB1 already supplies an older compatible table with `export_run_id`, `payload` and other columns. Live `gridex-ops-dev` confirms the final canonical table retains both historical identities (`billing_export_run_id` and later/compatibility `export_run_id`) plus the source-defined readiness/payload fields.

The derived `20260520_onboarding_billing_auxiliary_foundation.sql` is corrected to reconcile the source shape additively: create tables if absent, otherwise `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, apply source defaults/not-null requirements on the empty replay, add the source FK/indexes/RLS, and preserve DB1 compatibility columns. No export rows or business data are seeded.

Corrected artifact SHA-256: `2b35100fb19b805d5aaabd7404c43574fddc3cb3950b7a200f074cd7cd2476fc`.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI must prove the corrected foundation and subsequent tracked replay advance.

### Security dependency gate

Resolved. Production NanoID resolves to `3.3.17`; `security:audit-production` remains enabled and green.

### Definition of VERIFIED

REM-002 remains open until full clean replay, final schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Then the campaign must complete final database/code consistency and full remediation rescan before merge.
