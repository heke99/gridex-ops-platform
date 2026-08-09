# GRIDEX-OPS-O-008 — actor readiness conflict-count visibility

## Finding

- ID: `GRIDEX-OPS-O-008` (also tracked as findings inventory `O-008`)
- Severity: High
- Confidence: Confirmed
- Status: `CODE_REMEDIATED`

## Root cause

`actor_readiness_status` is `security_invoker = true` and previously counted open
blocking conflicts by selecting `actor_registry_conflicts` directly. After
GRIDEX-OPS-BL-002, conflict-row SELECT is limited to platform admins and
`service_role`. Ordinary and company-admin JWTs therefore under-counted conflicts
to zero and could observe false readiness through dependent views such as
`gridex_verified_grid_owners_v` (used by company-scoped admin pages via
`listGridOwners`).

## Why revoke-only was not sufficient

Outbound readiness already uses `supabaseService`, but company-scoped admin pages
still read `gridex_verified_grid_owners_v` with the authenticated session so
company RLS on `grid_owners` remains enforced. Revoking authenticated SELECT on
`actor_readiness_status` would break that path. The correct fix restores accurate
conflict aggregates without reopening conflict-row details.

## Implemented boundary

Forward migration
`20260809131500_gridex_ops_o008_actor_readiness_conflict_count_visibility.sql`:

1. adds `gridex_actor_open_blocking_conflict_counts()` (`SECURITY DEFINER`,
   `search_path` pinned) returning only `(actor_id, open_blocking_conflicts)`;
2. patches the `conflicts` CTE in `actor_readiness_status` to use that helper;
3. keeps `security_invoker` on the readiness view;
4. revokes authenticated/anon SELECT on service-role dashboard views
   (`actor_readiness_by_role_v`, role-specific readiness views) while preserving
   `service_role` SELECT;
5. leaves conflict-row RLS and historical migrations unchanged.

## Verification

- Static: `npm run gridex:ops-o008-actor-readiness-conflict-count-visibility-regression`
- SQL rollback matrix:
  `scripts/gridex-ops-o008-actor-readiness-conflict-count-visibility-regression.sql`
- Migration integrity: `npm run db:migrations:integrity`

Staging SQL remains required before `VERIFIED_CLOSED`.
