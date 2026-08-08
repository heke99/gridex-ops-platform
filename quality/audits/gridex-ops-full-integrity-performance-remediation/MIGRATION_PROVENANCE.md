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

Historical applied SQL remains immutable. Replay uses checksum-pinned derived artifacts, explicit noncanonical exclusions, chronological interleaving and CLI-owned ledger reconstruction. No replay fix writes to live Supabase.

### CI-confirmed progression

At `6304e65110544082559320863c0e717f7cf8256c`, the corrected DB1/20260520 additive billing reconciliation passes. `verify`, migration/provenance checks, targeted regressions, typecheck and `security:audit-production` all PASS. Clean replay advances through `20260612143000_performance_policy_consolidation_and_index_cleanup.sql` and next fails at `20260612160000_ops_points_1_to_8_hardening.sql:18` because `public.platform_usage_events` does not yet exist.

### Current lineage defect — forward prerequisite

`20260612160000` creates a monthly usage view over `platform_usage_events`, but that table is created by the later checksum-pinned migration `20260612193000_ops_j_to_n_governance_audit_cleanup_docs_v2.sql`. Substituting/skipping the whole 1930 migration would be incorrect because it also contains independent governance, retention and cleanup schema.

The replay engine is therefore extended with explicit `preserveSourceReplay` metadata. A derived interleaved prerequisite may execute an exact checksum-bound excerpt before an earlier dependent migration while the full source migration remains in normal timestamped replay.

Artifact: `supabase/bootstrap/20260612_platform_usage_events_prerequisite.sql`
Source: `supabase/migrations/20260612193000_ops_j_to_n_governance_audit_cleanup_docs_v2.sql`
Boundary: after `20260612143000`, before `20260612160000`
Artifact SHA-256: `02decf76fa4ead89ae07fa403aa19ab6a7de6d047df8c6169f49e74c16886f06`
Metadata: `preserveSourceReplay: true`

The artifact creates only the exact source-defined `platform_usage_events` table and seeds no rows. The full 1930 source remains checksum-pinned and will execute later, enabling RLS, indexes and its remaining governance changes.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI must prove both the early prerequisite and later full source replay work.

### Definition of VERIFIED

REM-002 remains open until full clean replay, final schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Then the campaign must complete final consistency/rescan before merge.
