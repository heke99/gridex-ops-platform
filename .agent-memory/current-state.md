# Current state

Last updated: 2026-08-09T10:05:00Z

- Branch: `main`
- Primary remediation PR: `#90` — merged
- Follow-up consistency PR: `#92` — merged
- Current verified application SHA before this documentation-only finalization: `55ad4053c64ec78ae5fe111eecef572edbd352dd`
- Release path: `NO_ACTIONS_RELEASE_VALIDATION`

## Completed release state

The full integrity/performance/security remediation campaign is merged to `main`. GitHub Actions was intentionally not used as a release gate after explicit repository-owner instruction because hosted jobs are blocked before step 1 by account billing/spending-limit state; those red checks are not code/test evidence and must never be reported as passing.

Production Vercel deployment `dpl_DdPGCM3epEPccQPGToBEaE15865c` built exact SHA `55ad4053c64ec78ae5fe111eecef572edbd352dd` successfully: dependency install, Next.js production compilation, TypeScript, page-data collection and 13/13 static-page generation all completed, and the deployment became `READY` on `app.gridex.se`. No error/fatal runtime logs were observed for the deployment during the post-release check.

The connected Supabase migration ledger contains the three release migrations with their exact repository versions:

- `20260808214500` — `grid_owner_direct_actor_join_performance`
- `20260809110000` — `ops_health_status_qualification`
- `20260809114500` — `ediel_certificate_status_consistency`

Post-apply database verification confirmed:

- `gridex_verified_grid_owners_v` returns 183 rows for 183 distinct grid owners with zero duplicate rows; the direct-first guard is installed. Prior actor-resolution measurement was ~1.09 s / 186 joined rows; the direct-first actor stage is ~26 ms and the full count query was ~36.7 ms.
- `gridex_ops_health_checks_v3()` executes without SQLSTATE `42702`; all five ambiguous status references are qualified.
- `gridex_ops_health_checks_v2()` now treats `renewal_available` recipient certificates consistently with the strict outbound certificate resolver.

No historical timestamp migration was edited during the campaign.

## Deterministic replay evidence caveat

The last real destructive empty-database replay before the hosted-runner outage reached `20260728170000_live_schema_code_canonical_sync.sql` and failed first on missing `customer_invoice_lines.vat_rate`. The complete source-defined invoice-line runtime family (`line_type`, `unit`, `vat_rate`, `sort_order`) was subsequently restored through checksum-pinned replay foundations. A post-fix full empty-database replay was not available and must not be claimed as a PASS.

## Remaining non-code / canonical-data gaps

These are not unresolved application defects and must not be filled by guessing:

- GitHub `main` is reported unprotected; the installed connector has no branch-protection/ruleset write operation.
- Supabase Leaked Password Protection is disabled; the installed connector has no hosted Auth/Management configuration write operation.
- 60 active grid areas depend on 35 platform grid owners with no deterministic OPS-grid-owner counterpart; exact actor/Ediel/owner-code candidate matching found zero candidates for all 35.
- 2 active Ediel route profiles lack receiver Ediel ID and have no internal fallback value in the profile, communication route or linked grid-owner data.
- Ediel recipient-certificate readiness still reports operational onboarding gaps. The official `/api/cron/ediel/actor-readiness` self-healing path is secret-protected and may perform external certificate lookup; the connector cannot access or bypass that secret. Ambiguous or absent certificate mappings must not be invented.

Code remediation is complete for the audited and post-release code defects. Remaining items above require repository/account configuration or authoritative external/canonical masterdata.
