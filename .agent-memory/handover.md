# Remediation handover

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Release mode: `NO_ACTIONS_RELEASE_VALIDATION`

The repository owner explicitly directed the campaign on 2026-08-09 to proceed without GitHub Actions because hosted jobs are blocked before step 1 by account billing/spending-limit state. The red checks are not code/test evidence and are not a merge gate for this release. Never report them as passing.

## Alternative release evidence completed

- PR/base diff reviewed: no historical timestamp migration is modified; database changes are new forward migrations and derived replay/bootstrap artifacts.
- The customer-application pipeline is split from ~9,808 lines into <=2500-line production modules; prior typecheck/targeted regressions were green before the hosted-runner outage.
- Last real clean replay reached `20260728170000_live_schema_code_canonical_sync.sql` and failed first on missing `customer_invoice_lines.vat_rate`; the complete source-defined runtime family (`line_type`, `unit`, `vat_rate`, `sort_order`) is now checksum/provenance registered in replay order. A post-fix full replay is unavailable and must not be claimed as passed.
- Fresh read-only Supabase validation found exactly one current canonical target join for `20260808214500_grid_owner_direct_actor_join_performance.sql`, no existing direct-first guard and a replacement that materializes the guard. Prior benchmark: ~1.09 s / 186 rows -> ~26 ms / exactly 183 rows.
- Fresh read-only Supabase validation found exactly five current ambiguous `status` signatures targeted by `20260809110000_ops_health_status_qualification.sql`.
- Customer-document storage isolation validates company/customer/site ownership plus RBAC and moves its SECURITY DEFINER helper outside the PostgREST-exposed public schema.
- `nanoid` lockfile resolution is 3.3.17 instead of vulnerable 3.3.16.
- Central logging redaction covers PII/credentials and now normalizes snake_case, camelCase and separator-style sensitive metadata keys.
- Migration checksums/provenance metadata include the new forward fixes.

## Known external configuration gaps

1. GitHub Actions hosted runners are account/billing blocked.
2. `main` is reported unprotected; current connector has no branch-protection/ruleset write action.
3. Supabase Leaked Password Protection is disabled; current connector has no hosted Auth/Management write action.
4. No isolated Supabase preview database exists for a destructive final replay.

These gaps are recorded separately from PR #90 code defects. The owner accepted the missing post-fix full replay evidence for this no-Actions merge path.

## Immediate sequence

1. Refetch PR #90 and ensure it is still mergeable and based on current `main`.
2. Update PR body to document the no-Actions release decision and evidence gap.
3. Mark PR ready for review.
4. Merge PR #90 to `main` using the repository-supported merge operation.
5. Verify PR merged state and exact new `main` SHA/tree.
6. Inspect Vercel production deployment triggered by `main`; if a concrete build/runtime error appears, fix it immediately in a follow-up rather than declaring completion.
7. Remove the temporary `verify/pr90-no-actions-20260809` branch if possible.

Final reporting must explicitly distinguish fixed code defects from the external GitHub/Supabase configuration gaps and must not claim a final clean replay PASS that did not run.
