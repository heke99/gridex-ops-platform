# Gridex OPS full integrity/performance remediation — release status

Date: 2026-08-09
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Release verdict

**NOT RELEASE-VERIFIED / DO NOT MERGE YET.**

The remediation code is substantially implemented, but release acceptance still requires exact-final-HEAD hosted CI plus deterministic empty-database replay. GitHub Actions currently terminates required jobs before step 1 because of the account billing/spending-limit condition. `main` is also reported unprotected and the installed GitHub connector has no branch-protection/ruleset write action. Supabase Leaked Password Protection is currently disabled and the installed Supabase connector has no hosted Auth configuration write action.

No historical migration source was edited in this continuation and no live/default Supabase DDL/DML was performed.

## Audit finding disposition

| Finding | Current disposition | Evidence / remediation |
|---|---|---|
| AUD-001 customer-document storage isolation | CODE_REMEDIATED_PENDING_FINAL_CI | Forward-only storage isolation migrations `20260806151106_*` and `20260806152004_*`; final role-matrix/replay acceptance pending. |
| AUD-002 quote timestamp/hash canonicalization | ALREADY_MAIN_VERIFIED | Current production/main PR #85 normalizes canonical timestamptz representation (`+00:00`/`Z`) before quote hashing/comparison. |
| AUD-003 migration provenance / deterministic replay | CODE_REMEDIATED_PENDING_FINAL_REPLAY | Provenance-preserving bootstrap/replay work is implemented; last real replay reached `20260728170000_live_schema_code_canonical_sync.sql` and exposed missing `customer_invoice_lines.vat_rate`; the full source-defined invoice-line runtime family is now restored and registered, but has not yet been rerun because hosted Actions does not start. |
| AUD-004 protected `main` / merge control | EXTERNAL_BLOCKED | GitHub reports `main` unprotected. Current connector exposes no branch-protection/ruleset write operation. |
| AUD-005 OTP lifetime | CURRENT_STATE_VERIFIED | `supabase/config.toml` uses `otp_expiry = 3600`; current Security Advisor no longer reports the prior 24-hour OTP issue. |
| AUD-006 EDIEL certificate fingerprint | CURRENT_STATE_VERIFIED | Runtime derives SHA-256 before cache upsert; read-only live check found 288 rows and zero null fingerprints. |
| AUD-007 release CI breadth | CODE_REMEDIATED_PENDING_EXECUTION | `ops-hardening.yml` now includes verify, quality release gates (lint, script/test types, full tests, OpenAPI compatibility/release, build) and clean replay. Hosted jobs currently terminate before step 1. SAST/full-history secret scan/browser E2E remain separate release-control gaps unless supplied by repository/account tooling. |
| AUD-008 grid-owner performance | CODE_REMEDIATED_PENDING_FINAL_CI | Forward migration `20260808214500_grid_owner_direct_actor_join_performance.sql`. Read-only benchmark reduced actor-resolution join from ~1.09 s / 186 joined rows to ~26 ms / exactly 183 rows by using the direct actor link before fallback matching. |
| AUD-009 sensitive application logging | CODE_REMEDIATED_PENDING_FINAL_CI | Central log redaction plus tests cover credentials, personal identifiers, IPs, raw payload/body/document/content and SQL/query text. Provider-side retention remains an environment control. |
| AUD-010 auth amplification | CURRENT_CODE_MITIGATED | Central admin authorization context uses request-scoped React `cache()` around the authenticated context; external APIs retain separate rate limiting. No cross-user cache introduced. |
| AUD-011 environment parity | PARTIALLY_VERIFIED | Vercel production is `READY` on main SHA `5923b5c17fe96c0453048bdc102203efb65f7d7a`. Connected database is not used as a destructive production-parity replay environment, so full production DB parity is not claimed. |
| AUD-012 stale agent memory | REMEDIATED | Current-state/open-blockers plus current-task/checkpoint/handover are refreshed as part of this campaign. |
| AUD-013 oversized customer-application orchestration | CODE_REMEDIATED / PRIOR_CI_VERIFIED | ~9,808-line orchestration was split into <=2500-line production modules; ordinary typecheck/targeted regressions were green before the account-level Actions outage. |
| AUD-014 stale advisor interpretation | PROCESS_REMEDIATED | Advisor items are checked against `to_regclass`, current schema and runtime evidence before remediation. Example: stale `subscription_platform_contract_fees` is absent and was not patched. |
| AUD-015 global authenticated reference reads | CURRENT_STATE_CLASSIFIED | Reviewed permissive reads are global EDIEL/reference/RBAC metadata; sampled tenant/user-bearing fields were empty and writes remain privileged. No unnecessary tenant RLS rewrite introduced. |

## Additional runtime/config findings discovered during remediation

### OPS health SQLSTATE 42702 — code remediated, pending release execution

Vercel 24-hour production observability showed one active runtime error group: `/api/internal/system/health`, SQLSTATE `42702`, last observed 2026-08-09 02:35:06 UTC. Read-only Supabase execution reproduced the collision in `gridex_ops_health_checks()`: PL/pgSQL output column `status` conflicts with unqualified table `status` references.

Forward-only migration `20260809110000_ops_health_status_qualification.sql` patches exactly five ambiguous status references via the installed canonical function definition, fails closed on shape drift and is checksum-registered. `scripts/gridex-ops-health-regression.cjs` locks the remediation and the v3 runtime call. No live DDL was applied.

### Supabase Leaked Password Protection — external configuration blocker

Current Supabase Security Advisor reports Leaked Password Protection disabled. The installed connector has no Auth/Management configuration write operation, so this cannot be closed from the current tool surface. Generic SECURITY DEFINER advisor messages were not blindly remediated; for example `anonymize_user_account(uuid)` was inspected and enforces `auth.uid() = target_user_id` and owner guardrails.

## Deterministic replay state

Last real clean replay: HEAD `4cd7539d9da6d01e0fb493edef60a41bd2a0c9e9`.

It reached `20260728170000_live_schema_code_canonical_sync.sql` and failed first because `customer_invoice_lines.vat_rate` was absent. Current branch restores the complete checksum-pinned Batch 1B runtime family:

- `line_type`
- `unit`
- `vat_rate`
- `sort_order`

through `supabase/bootstrap/20260525_customer_invoice_lines_runtime_foundation.sql`, with deterministic foundation/provenance registration.

Release acceptance requires a new exact-final-HEAD replay proving all of the following in one run:

- deterministic empty-database replay completes;
- Supabase migration ledger verification passes;
- historical smoke gates pass;
- exact schema fingerprint passes;
- all preserved source migrations execute at their intended chronological positions;
- `verify` and `quality-release-gates` pass on that same final HEAD.

## External blockers that must not be bypassed

1. GitHub Actions account billing/spending limit: all required jobs currently end with `steps=null`, so no code/test step executes.
2. `main` branch protection/ruleset is not configured and cannot be written through the installed GitHub connector.
3. Supabase Leaked Password Protection is disabled and cannot be changed through the installed Supabase connector.
4. There is no existing isolated Supabase preview branch. Creating one is billable and therefore is not done without explicit cost confirmation.

The PR must remain draft/unmerged until the repository-defined release requirements and exact-final-HEAD replay evidence are genuinely satisfied.