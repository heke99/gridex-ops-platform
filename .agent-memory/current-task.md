# Current task

Last updated: 2026-08-09T14:58:00Z
Branch: `cursor/codebase-health-and-stability-026e`
Base: `main` @ `725b024a` (includes PR #97 BL-001)

Status: `IN_PROGRESS_POST_97_HEALTH_RESIDUALS`

## Active work item

Post-#97 codebase health residual remediation on the automation branch.

### Atomic subtask (current)

Close confirmed residuals that remained open after #95/#97:

1. **GRIDEX-OPS-V3-BUG-001** — legacy customer-portal sync forced every catch to 500; wrap controlled `ApiInputError` through `handleCustomerPortalRouteError` and close same-class parse-outside-try variants on `/api/v1/customer/sync` and `/api/v1/customer/portal-bundle` POST.
2. **GRIDEX-OPS-O-008 PUBLIC residual** — forward migration `20260809151500` revokes PUBLIC grants on readiness views (timestamp `20260809143000` already used by BL-001).
3. **GRIDEX-OPS-V3-BUG-007** — rename reserved local `module` binding in `tenantSync.ts`.

### Intentionally not changed

- External/config gaps (GitHub protection, leaked-password Auth setting, grid-owner masterdata, Ediel receiver IDs, certificate onboarding).
- Catalog tables with intentional broad authenticated SELECT.
- Authenticated SELECT on `actor_readiness_status` retained for company flows.
- person_number / network-owner import residuals already present on main.

### Exact next action

Await review/merge of PR #98, then apply forward migration `20260809151500` on target environments.
