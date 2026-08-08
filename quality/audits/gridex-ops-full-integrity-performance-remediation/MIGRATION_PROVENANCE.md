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

Historical applied SQL remains immutable. Replay uses checksum-pinned narrow reconstruction artifacts and chronological interleaving where required. No replay reconciliation writes to live Supabase.

### Confirmed progression

The replay has sequentially advanced past missing prerequisites for pricing component rules, communication-log trace fields, external contract intakes, customer-contract energy-resolution fields and the complete company-membership RBAC runtime shape.

On `7d7911d39fbedb05d9adad04e794d10d2a848b0d`, `verify`, migration/provenance checks, targeted regressions and `security:audit-production` all PASS. Clean replay next fails at `20260612123000_performance_batches_1_to_3_db_acceleration.sql:593` because `public.customer_blockers` does not exist.

### Current reconciliation — customer blockers

The checksum-pinned pre-ledger source `20260526_batch_3a_3b_customer_intake_blockers_documents.sql` creates `customer_blockers` as a workflow relation. Live `gridex-ops-dev` matches the source columns/types/defaults. The tracked performance migration later creates bulk blocker functions that unconditionally reference the table.

Add `supabase/bootstrap/20260526_customer_blockers_foundation.sql` restoring only the source table, severity/status checks, three base indexes and service-role RLS policy. No blocker rows, document objects or customer data are seeded.

Artifact SHA-256: `27eda3bf35547d945443fa0402b460ea206106e9fe0fa4a6c635905efa53ed69`.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI must prove replay advances.

### Security dependency gate

Resolved. Production NanoID resolves to `3.3.17`; `security:audit-production` remains enabled and green.

### Definition of VERIFIED

REM-002 remains open until full clean replay, schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Only then may final campaign rescan and merge-readiness work proceed.
