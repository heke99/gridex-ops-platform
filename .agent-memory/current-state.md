# Current state

Updated: 2026-08-15

## PR #149 production closure

- Active branch: `fix/e2e-ediel-approval-20260815`.
- Gridex El production identity remains Ediel ID `21660`; system-test supplier ID `92825` is not treated as a tenant supplier identity.
- Supabase TypeScript contract is pinned to migration `20260815170500_contract_publication_channel_readiness.sql` with SHA-256 `f81787066197c7be1c1021bdf7ee6f7e6e97491ab3bdfd672b40a3029ef9d1e7`.
- AGT/TGT runtime requires an explicit canonical supplier or ESCO role plus message family, setup package, and environment type. Legacy implicit AGT defaults and unscoped runtime selection are removed.
- Supplier/ESCO role isolation and canonical production-approval regressions are locked. Refactored website/onboarding regressions inspect the active split runtime modules.
- API rate-limiter infrastructure failures map to HTTP 503; real quota exhaustion remains HTTP 429.
- Newly introduced privileged restoration/integrity RPCs are restricted to `service_role` after the Supabase security advisor review.
- Temporary CI migration diagnostics were restored to the normal workflow.

## Verification

- Local `verify` workflow command chain: PASS.
- Local `quality-release-gates` command chain: PASS before the final small regression-harness/API status corrections; full final replay is next.
- Full Vitest at that checkpoint: 87 files / 623 tests PASS.
- Targeted tenant/Ediel/contracts/API tests: PASS.
- Production build: PASS.
- Production dependency audit: 0 vulnerabilities.
- Hosted clean migration replay: pending the next pushed security commit.
