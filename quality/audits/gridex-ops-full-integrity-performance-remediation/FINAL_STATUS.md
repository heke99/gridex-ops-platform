# Gridex OPS full integrity/performance remediation — release status

Date: 2026-08-09
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Release verdict

**READY FOR NO-ACTIONS MERGE VALIDATION.**

On 2026-08-09 the repository owner explicitly directed this campaign to proceed without GitHub Actions because hosted jobs are blocked at account level before step 1. The Actions failures are therefore not used as release evidence and are not interpreted as code failures.

The release decision is based on bounded alternative evidence: prior real green verify evidence before the account outage, the last real deterministic replay and its first concrete SQL failure, checksum-pinned remediation of that failure, current PR/base diff inspection, immutable historical migration preservation, fresh read-only Supabase signature validation for the two latest database hotfixes, source review of the storage/RLS remediation, migration checksum registration, and current production/runtime evidence.

No claim is made that a final empty-database replay passed after the invoice-line prerequisite was added. That exact replay remains unavailable without a runner. This residual verification gap is explicitly accepted for this merge by the repository owner's instruction to proceed without GitHub Actions.

No historical migration source was edited in this continuation and no live/default Supabase DDL/DML was performed.

## Audit finding disposition

| Finding | Disposition for merge | Evidence / remediation |
|---|---|---|
| AUD-001 customer-document storage isolation | CODE_REMEDIATED | Forward-only storage isolation migrations validate company/customer/site ownership, company-scoped RBAC and fail closed. Helper moved out of PostgREST-exposed schema. |
| AUD-002 quote timestamp/hash canonicalization | VERIFIED ON MAIN | PR #85 normalizes canonical timestamptz representation (`+00:00`/`Z`) before quote hashing/comparison. |
| AUD-003 migration provenance / deterministic replay | CODE_REMEDIATED / FINAL REPLAY GAP ACCEPTED | Last real replay reached `20260728170000_live_schema_code_canonical_sync.sql` and exposed missing `customer_invoice_lines.vat_rate`; the complete source-defined invoice-line runtime family is now restored and checksum/provenance registered. |
| AUD-004 protected `main` / merge control | EXTERNAL CONFIGURATION GAP | GitHub reports `main` unprotected. Current connector exposes no branch-protection/ruleset write operation. |
| AUD-005 OTP lifetime | CURRENT_STATE_VERIFIED | `supabase/config.toml` uses `otp_expiry = 3600`; current advisor no longer reports the prior 24-hour OTP issue. |
| AUD-006 EDIEL certificate fingerprint | CURRENT_STATE_VERIFIED | Runtime derives SHA-256 before cache upsert; read-only check found 288 rows and zero null fingerprints. |
| AUD-007 release CI breadth | CODE_REMEDIATED | Workflow now includes lint, script/test typechecks, full tests, OpenAPI compatibility/release verification, production build and clean replay for when hosted CI becomes available. |
| AUD-008 grid-owner performance | READ_ONLY VERIFIED / CODE_REMEDIATED | Direct-first actor resolution benchmark reduced the actor join from ~1.09 s / 186 rows to ~26 ms / exactly 183 rows. Fresh read-only validation found exactly one canonical join signature and confirmed the patch materializes the direct-first guard. |
| AUD-009 sensitive application logging | CODE_REMEDIATED | Central API/action logging redacts PII, credentials and sensitive payload metadata. Key normalization now covers snake_case, camelCase and separator variants with regression coverage. |
| AUD-010 auth amplification | CURRENT_CODE_MITIGATED | Central admin authorization context uses request-scoped React `cache()`; external APIs retain separate rate limiting. |
| AUD-011 environment parity | PARTIALLY_VERIFIED | Current production deployment is known and runtime evidence was reviewed; destructive production DB replay is intentionally not used. |
| AUD-012 stale agent memory | REMEDIATED | Memory/status files refreshed for the no-Actions release path. |
| AUD-013 oversized customer-application orchestration | REMEDIATED / PRIOR CI VERIFIED | ~9,808-line orchestration split into <=2500-line production modules; prior typecheck/targeted regression evidence was green. |
| AUD-014 stale advisor interpretation | PROCESS_REMEDIATED | Advisor findings are checked against actual schema/runtime before changes; stale absent objects are not patched. |
| AUD-015 global authenticated reference reads | CURRENT_STATE_CLASSIFIED | Reviewed permissive reads are global EDIEL/reference/RBAC metadata; writes remain privileged. |

## Additional runtime remediation

### OPS health SQLSTATE 42702

Vercel 24-hour observability found one active production error group before this remediation: `/api/internal/system/health`, SQLSTATE `42702`. Read-only Supabase execution reproduced the PL/pgSQL output-variable/table-column collision in `gridex_ops_health_checks()`.

Forward migration `20260809110000_ops_health_status_qualification.sql` patches exactly five ambiguous status references via the installed canonical function definition and fails closed on shape drift. Fresh read-only validation on 2026-08-09 found exactly five expected ambiguous signatures and none already qualified. The migration is checksum-registered and `scripts/gridex-ops-health-regression.cjs` locks the source/runtime contract.

### Grid-owner actor resolution

Forward migration `20260808214500_grid_owner_direct_actor_join_performance.sql` makes `platform_market_actor_id` authoritative and uses EDIEL/org/name fallback only when the direct link is absent. Fresh read-only validation found exactly one canonical target join, no existing direct-first guard, and confirmed the replacement materializes the guard. Its registered SHA-256 is `c5b1eb1c23f6423845ac3b93053d997c9244112dd7d2376183b0e550ed9bfd43`.

## Deterministic replay state

Last real clean replay: HEAD `4cd7539d9da6d01e0fb493edef60a41bd2a0c9e9`.

It reached `20260728170000_live_schema_code_canonical_sync.sql` and failed first because `customer_invoice_lines.vat_rate` was absent. The current branch restores the complete checksum-pinned Batch 1B runtime family through `supabase/bootstrap/20260525_customer_invoice_lines_runtime_foundation.sql`:

- `line_type`
- `unit`
- `vat_rate`
- `sort_order`

Artifact SHA-256: `5a40429f7370068f4ce588cb84e63f748920c922d4a9945d0c2266a4369341ef`. It is registered in both provenance metadata and deterministic foundation order.

## Known external configuration gaps

These are not code defects in PR #90 and cannot be changed through the installed connector surface:

1. GitHub Actions hosted runner billing/spending limit prevents jobs from starting.
2. GitHub `main` is currently unprotected; no branch-protection/ruleset write action is exposed.
3. Supabase Leaked Password Protection is disabled; no hosted Auth/Management configuration write action is exposed.
4. No existing isolated Supabase preview database is available for a destructive final replay.

PR #90 may proceed under the repository owner's explicit no-Actions release instruction, with the final empty-database replay gap recorded rather than falsely reported as passed.
