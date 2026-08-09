# Current task

Last updated: 2026-08-09T10:05:00Z
Branch: `main`
Primary PR: `#90` merged
Follow-up PR: `#92` merged

Status: `REMEDIATION_COMPLETE_WITH_EXTERNAL_DATA_CONFIG_GAPS`.

The audited code remediation and post-release code follow-up are merged and deployed. GitHub Actions was intentionally bypassed as a release gate by explicit repository-owner instruction because hosted jobs are account/billing blocked before step 1.

Verified production application SHA before this documentation-only finalization: `55ad4053c64ec78ae5fe111eecef572edbd352dd`. Vercel production deployment `dpl_DdPGCM3epEPccQPGToBEaE15865c` is READY and passed production compilation, TypeScript, page-data and static-generation stages.

Exact Supabase ledger versions applied and verified: `20260808214500`, `20260809110000`, `20260809114500`. Health SQLSTATE `42702` is resolved; Grid Owner direct-first performance fix is live; Ediel `renewal_available` certificate status handling is consistent between route guard, strict resolver and health logic.

No further code remediation is required by this campaign based on currently verified evidence. Remaining work is external configuration or authoritative masterdata/onboarding:

- enable GitHub `main` protection/ruleset using an account surface that supports it;
- enable Supabase Leaked Password Protection using hosted Auth settings;
- supply authoritative mappings for 35 platform grid owners affecting 60 active areas;
- supply receiver Ediel IDs for 2 routes that have no internal source;
- complete recipient-certificate onboarding through the official secret-protected actor-readiness/external lookup path.

Do not guess any of those identifiers or certificate mappings. Do not claim the unavailable post-invoice-fix empty-database replay passed.
