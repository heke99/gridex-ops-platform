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

On `bc3479574904ae886916aed28209bf68dfc76264`, `verify`, migration/provenance checks, targeted regressions, typecheck and `security:audit-production` all PASS.

The previously implemented `preserveSourceReplay` corrections are now CI-proven through two important boundaries:

- the early `platform_usage_events` prerequisite executes before `20260612160000`, while complete `20260612193000_ops_j_to_n_governance_audit_cleanup_docs_v2.sql` still executes later;
- complete checksum-pinned `20260611100000_energy_resolver_grid_area_operations.sql` now executes at its chronological position, eliminating the former `platform_grid_owners` failure and allowing replay to advance through the actor-readiness migration family.

Clean replay now advances to `20260615203000_platform_go_live_route_resolver_message_center.sql:248` and fails because `public.legal_text_versions` is absent.

### Current lineage correction — preserve complete Batch M legal source

`legal_text_versions`, `customer_legal_acceptances` and related legal/customer/tenant readiness views are defined by checksum-pinned `20260613090000_batch_m_ops_master_legal_readiness.sql`. The source describes itself as safe/idempotent and uses idempotent table/column/index/policy patterns for the relevant schema.

The complete source was excluded from timestamped replay because the existing early derived artifact:

- `bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql`

references Batch M as its source. That artifact intentionally restores only `powers_of_attorney.customer_site_id` before later tracked grid-owner pipeline migrations need it. Its SQL uses `add column if not exists` plus an empty-replay-safe backfill, so it can remain an early prerequisite without replacing the complete source.

Resolution: override the existing derived-artifact metadata with `preserveSourceReplay: true`. The narrow prerequisite still executes in foundation order, while the complete immutable `20260613090000_batch_m_ops_master_legal_readiness.sql` remains in normal chronological replay. This restores canonical legal/readiness schema from its original checksum-pinned source instead of duplicating those objects in a new bootstrap artifact.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI must prove Batch M executes successfully and replay advances beyond `20260615203000`.

### Definition of VERIFIED

REM-002 remains open until full clean replay, final schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Once these defined gates are green, the campaign performs one bounded release verification/rescan and does not continue historical migration discovery absent an actual failing gate.
