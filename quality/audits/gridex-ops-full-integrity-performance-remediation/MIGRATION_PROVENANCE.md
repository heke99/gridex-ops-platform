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

On `4cbea122dce56f08da67bd4b4df0798c8ad5349a`, `verify`, migration/provenance checks, targeted regressions, typecheck and `security:audit-production` all PASS. The `preserveSourceReplay` model is also proven: the early `platform_usage_events` prerequisite executes before `20260612160000`, while the complete `20260612193000_ops_j_to_n_governance_audit_cleanup_docs_v2.sql` still executes later.

Clean replay then advances through `20260612203000` and fails at `20260613100000_actor_auto_readiness_certificates.sql:85` because `public.platform_grid_owners` is absent.

### Current lineage correction — preserve the complete Energy Resolver source

`platform_grid_owners` and the related platform grid-area/geodata/cache/import/resolver family are defined by checksum-pinned `20260611100000_energy_resolver_grid_area_operations.sql`. That source was being excluded because two early derived artifacts reference it:

- `bootstrap/20260611_grid_owner_information_request_foundation.sql`
- `bootstrap/20260611_customer_contract_energy_resolution_foundation.sql`

Those early artifacts are still required as prerequisites, but excluding the complete source omits canonical platform masterdata tables, PostGIS geometry, resolver/import functions, RLS/policies and additional website/site/metering fields.

Resolution: override both derived-artifact metadata entries with `preserveSourceReplay: true`. Their narrow prerequisite SQL still executes in foundation order, while the complete immutable `20260611100000_energy_resolver_grid_area_operations.sql` now remains in normal chronological timestamped replay. This restores the missing platform family from its original source instead of duplicating it in another derived artifact.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI must prove the full Energy Resolver source executes successfully and replay advances beyond `20260613100000`.

### Definition of VERIFIED

REM-002 remains open until full clean replay, final schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Then the campaign must complete final database/code consistency and full remediation rescan before merge.
