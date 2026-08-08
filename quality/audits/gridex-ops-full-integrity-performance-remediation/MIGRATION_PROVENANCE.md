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

On `3cf290d86b07960eb6058d788a911621e99599a5`, `verify`, migration/provenance checks, targeted regressions, typecheck and `security:audit-production` all PASS.

CI now proves all of these source-preserving boundaries execute as intended:

- the early `platform_usage_events` prerequisite executes before `20260612160000`, while complete `20260612193000_ops_j_to_n_governance_audit_cleanup_docs_v2.sql` still executes later;
- complete checksum-pinned `20260611100000_energy_resolver_grid_area_operations.sql` executes chronologically, eliminating the former `platform_grid_owners` blocker;
- complete checksum-pinned `20260613090000_batch_m_ops_master_legal_readiness.sql` is no longer skipped by the early powers-of-attorney prerequisite.

The current clean-replay failure is now inside Batch M itself at line 378: `column mp.ediel_metering_point_id does not exist` while creating the readiness view.

### Current chronological prerequisite — canonical metering identifier

The exact missing column is canonically added by forward-only/idempotent `20260708210000_website_application_canonical_dispatch_alignment.sql` using:

`alter table if exists public.metering_points add column if not exists ediel_metering_point_id text`.

Batch M reads that canonical identifier before the later historical migration that creates it. The remediation therefore adds only that source-defined column in `bootstrap/20260613_metering_points_ediel_id_prerequisite.sql`, interleaved after `20260612203000` and before `20260613090000`.

The derived metadata pins artifact SHA-256 `9edd81f9eacbec7abb118167fa2991fd66d7ecf96b57234e6b6c8b1fd9674a29` to source `20260708210000_website_application_canonical_dispatch_alignment.sql` and sets `preserveSourceReplay: true`. The complete immutable July migration therefore still executes at its natural timestamp. No source migration is edited and no live database is mutated.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI must prove replay advances through Batch M.

### Definition of VERIFIED

REM-002 remains open until full clean replay, final schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Once these defined gates are green, the campaign performs one bounded release verification/rescan and does not continue historical migration discovery absent an actual failing gate.
