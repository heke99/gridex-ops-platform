# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Current CI HEAD: `4216cb69e6b6eaf7374c84cb0bc87c38b07edd62`

Verified on current HEAD: verify/provenance/typecheck/targeted regressions/security PASS. Clean replay FAIL. REM-002 not VERIFIED.

The 20260613 metering identifier prerequisite is CI-proven: complete Batch M and later O6 migrations now pass. Replay reaches `20260615214500_public_contract_offer_api_readiness_fix.sql:87`, which fails because `public_contract_offers.publication_status` is absent.

Canonical additive/idempotent `20260612193000_platform_tenant_contracts_api_mail.sql` creates the missing publication fields, but complete source replay was suppressed because the existing narrow `bootstrap/20260612_integration_api_client_lifecycle_foundation.sql` points at it. Current implementation sets `preserveSourceReplay=true`, retaining the early API-client prerequisite while restoring complete 20260612193000 source replay. No live Supabase mutation or historical source edit occurs.

Independent final DoD blocker: `lib/website/customerApplications.ts` is ~9,800 handwritten lines and must be behavior-preservingly split to <=2,500 per file.

Next: inspect exact-HEAD replay and continue only from a real first SQL error. On full replay/fingerprint success, close REM-002, finish large-file gate, run one bounded release verification, update final reports/memory and merge PR #90 when same-HEAD gates are green.
