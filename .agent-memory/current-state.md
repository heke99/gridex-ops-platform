# Current state

Last updated: 2026-08-09T14:40:00Z

- Branch: `cursor/codebase-health-and-stability-7aa1`
- Main tip reviewed: `7bdebeab` — `fix(security): close BL-006 and O-008 residuals (#95)`
- Active work: post-#95 health/stability residuals

## #95 land (already on main)

- BL-006 migration `20260809123000` isolates contacts/lookup-cache reads.
- O-008 migration `20260809131500` patches readiness conflict counts via `gridex_internal.actor_open_blocking_conflict_counts()`.
- `/admin/network-owners` import history uses `supabaseService` after platform-admin gate.
- Logging redaction covers `person_number` / `personNumber`.

## Residuals addressed on this branch

- GRIDEX-OPS-V3-BUG-001: controlled portal input errors no longer collapse to 500.
- Same-class variants: canonical `/api/v1/customer/sync` and portal-bundle POST now parse JSON inside try/catch.
- O-008 PUBLIC privilege residual: forward migration `20260809143000` revokes PUBLIC grants on readiness surfaces and fail-closes.

## Still external / not claimed

- Staging SQL matrix for new migration
- Exact-head GitHub Actions (billing-blocked)
- ggshield CLI not installed in this environment
- Authoritative masterdata/config gaps from prior handover remain out of scope
