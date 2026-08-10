# Handover — post-#105 health residuals

Updated: 2026-08-10

Branch: `cursor/codebase-health-and-stability-ee51` (base `main@09edc18f`, #105).

## Done in this pass

- Fixed C28 false index name in
  `scripts/gridex-canonical-architecture-57-point-regression.cjs`
  (`deployed_by` → `recorded_by`).
- Wired `gridex:canonical-architecture-57-regression` and
  `gridex:o008-public-privilege-hardening-regression` into
  `.github/workflows/ops-hardening.yml` so the 57-control claim cannot skip CI.
- Landed tip-based O-008 PUBLIC privilege hardening as
  `20260810230000_gridex_ops_o008_public_privilege_hardening.sql` with checksum
  in `migration-history-manifest.additions.json` and types tip pin (types hash
  unchanged; grant-only migration).
- Static regressions green locally. Staging SQL apply not run.

## Do not redo

- Do not reuse unmerged residual timestamp `20260809151500` from `#102`.
- Do not revoke authenticated SELECT on `actor_readiness_status` — required by
  `gridex_verified_grid_owners_v`.
- Do not reopen BL-006 / portal parse residuals already on main via `#95`/`#101`.

## Next

1. Push `ee51` and open PR (supersede open `#102`).
2. Apply `20260810230000` on `gridex-ops-dev` and re-check
   `has_table_privilege` for anon/authenticated on readiness views.
3. Keep external Auth leaked-password and production SHA evidence outside this
   residual PR.
