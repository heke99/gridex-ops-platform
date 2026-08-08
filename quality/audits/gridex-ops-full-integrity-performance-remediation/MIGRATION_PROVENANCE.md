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

Historical applied SQL remains immutable. Replay uses checksum-pinned narrow reconstruction artifacts, explicit source substitution and chronological interleaving where required. No replay reconciliation writes to live Supabase.

### Confirmed replay progression

- `c627f810...`: missing `pricing_component_rules` at `20260609100000`.
- `8e678aae...`: pricing fixed; next missing `communication_logs.customer_number` at `20260609183000`.
- `5212e454...`: communication trace fixed; next missing `external_contract_intakes` at `20260611150000`.
- `1ac3e0d2...`: external intake fixed; next missing `customer_contracts.price_area_used` at `20260611170000`.
- `e331041b...`: contract energy fields fixed; next missing `company_memberships.role_key` at `20260612123000`.
- `532573df...`: `role_key` fixed; replay immediately exposed the rest of the same RBAC prerequisite family: `company_memberships.membership_role` missing in `20260612123000_performance_batches_1_to_3_db_acceleration.sql:146`.

On `532573df73003d272230d7222553e493c03fda5d`, `verify`, migration/provenance checks, targeted regressions and `security:audit-production` all PASS; only clean replay fails.

### Current RBAC reconciliation

The tracked performance helper reads `company_memberships.status`, `is_active`, `role_key`, `membership_role` and `role`, and its supporting indexes depend on the same runtime shape. The checksum-pinned pre-ledger source `20260527_fix_company_user_invite_runtime_columns.sql` defines that company-membership runtime family and the role/status checks. Live `gridex-ops-dev` confirms the canonical membership columns, the same role/status value sets and the supporting indexes. Live `user_roles` does not contain `role_key`, so no noncanonical user_roles field is introduced.

The existing `supabase/bootstrap/20260527_company_memberships_role_key_foundation.sql` is therefore broadened to reconstruct the complete source-defined membership runtime column family, source role/status constraints and supporting company/user/status indexes. Empty replay has no membership rows, so the source data backfill is intentionally omitted.

Artifact SHA-256: `46c5e05a35063f84547dcf6554bc378d9c90d62171cd38843383542c6fe602c5`.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI must prove replay advances.

### Security dependency gate

Resolved. Production NanoID resolves to `3.3.17`; `security:audit-production` remains enabled and green.

### Definition of VERIFIED

REM-002 remains open until full clean replay, schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Only then may final campaign rescan and merge-readiness work proceed.
