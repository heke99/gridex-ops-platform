# Open blockers

Last updated: 2026-08-08T15:52:00Z

1. `GRIDEX-REM-002` clean replay remains active. On `4216cb69e6b6eaf7374c84cb0bc87c38b07edd62`, verify/provenance/typecheck/regressions/security PASS; replay now reaches `20260615214500` and fails because `public_contract_offers.publication_status` is missing. Current fix restores complete additive/idempotent `20260612193000_platform_tenant_contracts_api_mail.sql` source replay via `preserveSourceReplay=true`.

2. Final large-file release gate is red: handwritten production file `lib/website/customerApplications.ts` is ~9,800 lines; campaign DoD requires every in-scope handwritten production file <=2,500 before merge.

PR #90 remains draft/unmerged until replay/fingerprint, large-file gate, bounded final release rescan and all final same-HEAD required checks are green.
