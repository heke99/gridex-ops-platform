# Migration provenance

Date: 2026-08-08
Branch: `remediation/gridex-ops-full-integrity-performance`
Base: `5923b5c17fe96c0453048bdc102203efb65f7d7a`

## GRIDEX-REM-001

Status: IMPLEMENTED; campaign verification pending final same-HEAD closeout.

The branch restores the two already-applied AUD-001 migration files under the exact versions present in the connected dev ledger, without mutating live migration history.

## GRIDEX-REM-002 — canonical clean replay

Severity: P1
Status: IMPLEMENTED / CI PENDING / NOT VERIFIED

Historical applied SQL remains immutable. Replay uses checksum-pinned derived artifacts, explicit noncanonical exclusions, chronological interleaving and CLI-owned ledger reconstruction. No replay fix writes to live Supabase.

### CI-confirmed progression

Prior exact-HEAD CI proves that complete checksum-pinned `20260611100000_energy_resolver_grid_area_operations.sql`, complete Batch M `20260613090000_batch_m_ops_master_legal_readiness.sql`, the canonical metering identifier prerequisite, and complete additive/idempotent `20260612193000_platform_tenant_contracts_api_mail.sql` all reach their required chronological boundaries. `verify`, migration/provenance checks, targeted regressions, typecheck and `security:audit-production` have remained green on the verified replay iterations.

On `0527a632d323b908d10719cd7d07f84488e50e51`, clean replay advanced through Batch M, O6, `20260615203000_platform_go_live_route_resolver_message_center.sql` and `20260615214500_public_contract_offer_api_readiness_fix.sql`. The next first failure was `20260615230000_tenant_legal_defaults_live_test_intake_tracking.sql:302`: `column c.primary_contact_email does not exist`.

The same canonical tenant event-mail readiness view also reads `companies.support_email`, so both fields are verified prerequisites of the same failing statement.

### Current lineage correction — company contact fields

`companies.primary_contact_email` is source-defined by pre-ledger `20260519_final_saas_hardening.sql`. `companies.support_email` is source-defined by idempotent pre-ledger `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql`.

The remediation restores only those two source-defined fields through checksum-pinned, schema-only bootstrap artifacts:

- `bootstrap/20260519_companies_primary_contact_email_foundation.sql` — SHA-256 `fbdc09f9d0c463b8568ae70b96f518c2dcbc87f41d54df60099b76d9706d435a`
- `bootstrap/20260520_companies_support_email_foundation.sql` — SHA-256 `0d9b0853accf38682c0a9399b1a6085800f77f8c53ad742f2d852663c79151df`

Both artifacts are registered in `scripts/gridex-aud-003-legacy-foundation.additions.json` with their exact source files and do not seed company rows. No historical migration source is edited and no live Supabase write is introduced.

### Large-file release gate

The independent `lib/website/customerApplications.ts` blocker was split into bounded internal domain modules. Dedicated workflow verification on parent `ed3d746cfdc4489920bc56e3686d92affedcc8d3` passed full repository `npm run typecheck`, and every generated customer-application production module is <=2500 lines. Temporary split/export workflow files and codemod tooling were removed from the committed tree. The permanent typecheck command uses a 4096 MB Node heap budget, matching the existing production build budget rather than weakening compiler checks.

### Definition of VERIFIED

REM-002 remains open until full clean replay, final schema fingerprint, migration/provenance regression, production security audit and `verify` all pass on the same final HEAD. Once these defined gates are green, the campaign performs one bounded release verification/rescan and does not continue historical migration discovery absent an actual failing release gate.
