# Current task

Last updated: 2026-08-08T15:52:00Z
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Active finding
`GRIDEX-REM-002` — deterministic canonical empty-database replay.

Status: `IMPLEMENTED_NOT_VERIFIED`

Current CI HEAD `4216cb69e6b6eaf7374c84cb0bc87c38b07edd62`: verify/provenance/typecheck/regressions/security PASS. Replay now passes Batch M and advances to `20260615214500`.

Exact failure: `20260615214500_public_contract_offer_api_readiness_fix.sql:87`, `column o.publication_status does not exist`.

Verified root cause: `20260612193000_platform_tenant_contracts_api_mail.sql` is additive/idempotent and creates `public_contract_offers.publication_status`, but full source replay is suppressed by the existing integration API-client lifecycle derived artifact.

Current implementation: set `preserveSourceReplay=true` for `bootstrap/20260612_integration_api_client_lifecycle_foundation.sql`; preserve the early prerequisite and replay the complete checksum-pinned 20260612193000 source chronologically.

Known independent merge blocker: `lib/website/customerApplications.ts` is ~9,800 handwritten production lines; final gate requires <=2,500.

Exact next action: inspect exact-HEAD PR #90 CI and continue only from the next actual replay error. On replay success, confirm fingerprint, then finish large-file modularization and the bounded release closeout.
