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

On `4216cb69e6b6eaf7374c84cb0bc87c38b07edd62`, `verify`, migration/provenance checks, targeted regressions, typecheck and `security:audit-production` all PASS.

CI now proves that complete checksum-pinned `20260611100000_energy_resolver_grid_area_operations.sql`, complete Batch M `20260613090000_batch_m_ops_master_legal_readiness.sql`, and the interleaved canonical metering identifier prerequisite all execute successfully. Replay passes Batch M, the O6 family and `20260615203000_platform_go_live_route_resolver_message_center.sql`.

The current first failure is `20260615214500_public_contract_offer_api_readiness_fix.sql:87`: `column o.publication_status does not exist`.

### Current lineage correction — tenant contract/API/mail source

Canonical `20260612193000_platform_tenant_contracts_api_mail.sql` is explicitly additive/idempotent and creates the missing `public_contract_offers.publication_status` plus related public-offer publication fields. The complete source had been excluded because `bootstrap/20260612_integration_api_client_lifecycle_foundation.sql` references it as a narrow derived prerequisite.

Resolution: set `preserveSourceReplay: true` for that existing derived artifact. The early API-client lifecycle prerequisite remains in foundation order, while the complete immutable `20260612193000_platform_tenant_contracts_api_mail.sql` returns to normal chronological replay. This uses the original checksum-pinned source instead of duplicating publication schema in another bootstrap artifact.

No historical migration source is edited and no live Supabase write is introduced.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI must prove full 20260612193000 source replay and advancement beyond `20260615214500`.

### Definition of VERIFIED

REM-002 remains open until full clean replay, final schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Once these defined gates are green, the campaign performs one bounded release verification/rescan and does not continue historical migration discovery absent an actual failing gate.
