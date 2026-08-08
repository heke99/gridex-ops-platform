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

Historical applied SQL remains immutable. Replay uses checksum-pinned narrow reconstruction artifacts, explicit source substitution and chronological interleaving where required. No clean-replay reconciliation writes to live Supabase.

### Confirmed replay progression

- `c627f810...`: missing `pricing_component_rules` at `20260609100000`.
- `8e678aae...`: pricing prerequisite fixed; next missing `communication_logs.customer_number` at `20260609183000`.
- `5212e454...`: communication-log prerequisite fixed; next missing `external_contract_intakes` at `20260611150000`.
- `1ac3e0d2...`: external intake fixed; next missing `customer_contracts.price_area_used` at `20260611170000`.
- `e331041b...`: customer-contract energy fields fixed; next failure at `20260612123000_performance_batches_1_to_3_db_acceleration.sql:146`: `column cm.role_key does not exist`.

On `e331041b1a724d659592cd04e7262495a1eb5bed`, `verify`, migration/provenance checks, targeted regressions and `security:audit-production` all PASS; only clean replay fails.

### Current RBAC root cause

Tracked performance hardening defines `gridex_can_write_company(uuid)` using `company_memberships.role_key`, with fallbacks to `membership_role` and `role`. The clean-replay foundation lacks `role_key`.

Checksum-pinned pre-ledger source `20260527_fix_company_user_invite_runtime_columns.sql` adds `company_memberships.role_key`. Live `gridex-ops-dev` confirms this column exists canonical. Live `user_roles` does **not** have `role_key`; therefore earlier caught notices about `ur.role_key` are not repaired by inventing a noncanonical live column.

### Current reconciliation

Add `supabase/bootstrap/20260527_company_memberships_role_key_foundation.sql` containing only `company_memberships.role_key text`. Empty replay has no membership data requiring the source backfill.

Artifact SHA-256: `69775f5d6f64fbb6d1ef0deb7d159a3ff5a6930d27b3e73f641cafc7ebafb5ae`.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI must prove replay advances.

### Security dependency gate

Resolved. Production NanoID resolves to `3.3.17`; `security:audit-production` remains enabled and green.

### Definition of VERIFIED

REM-002 remains open until full clean replay, schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Only then may final campaign rescan and merge-readiness work proceed.
