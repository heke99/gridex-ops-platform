# Remediation handover

Status: **POST-#99 RESIDUAL REMEDIATION IN PROGRESS**

Branch: `cursor/codebase-health-and-stability-7f6c`
Base main tip reviewed: `2f02fb10068f8a525e89fff033f06e1f5e5f38ee` (#99)

## What #99 already closed on main

- Legacy `/api/v1/customer-portal/sync` controlled `ApiInputError` classifier
- Reserved local `module` → `legalModule` renames
- Public-contract strict fixture updates

## Residuals closed on this branch

1. Same-class parse-outside-try variants on `/api/v1/customer/sync` and
   `/api/v1/customer/portal-bundle` POST now route controlled input errors
   through `handleCustomerPortalRouteError`.
2. O-008 PUBLIC privilege residual forward migration
   `20260809151500_gridex_ops_o008_public_privilege_hardening.sql`
   (exact donor blob/checksum from unmerged `#98`).

## Overlap note

Open PRs `#96` and `#98` contain overlapping residual work from earlier tips.
Prefer this tip-based branch for merge after review; close or supersede the
stale residual PRs once this lands to avoid duplicate migrations.

## Still external / not safe code guesses

- GitHub `main` protection / Actions billing unblock
- Supabase Leaked Password Protection
- Authoritative grid-owner / Ediel receiver / certificate onboarding data

## Next action

Open/merge the `7f6c` PR, then apply `20260809151500` on the authorized
non-production/production ledger path.
