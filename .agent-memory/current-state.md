# Current state

Updated: 2026-08-13

## Tip health after Field 511 types sync

- Main tip: `f2c6a729` (`fix(db): sync generated types after Field 511 migration`).
- Active health branch: `cursor/codebase-health-and-stability-a029`.
- Types sync on main closed the generated-types lag for
  `ediel_timeseries_products` 511 columns + `resolve_ediel_timeseries_product_511`.
- Remaining tip residuals replayed from open `#121`/`c107` onto `a029`, plus a
  tip-specific nullable `Returns` correction for resolver `description` /
  `valid_to`.

## Residuals closed on `a029`

1. HIGH — auth flash allowlists + next-path hardening still absent from tip
2. HIGH — SVK reconciliation retry-before-reimport lock
3. HIGH — mixed UTILTS disposition APERAK detail retention
4. HIGH — null UTILTS `transaction-<n>` persist/ACK identity
5. MEDIUM — L653Q description leading-tab forward trim (`20260813221500`)
6. MEDIUM — `VERIFICATION.md` production-gate restore + field-511 evidence relocate
7. MEDIUM — resolver Returns nullability (`description` / `valid_to`)
8. LOW — orphaned root migration checksum snippet removed

## Verification executed on `a029`

- vitest auth-outage + UTILTS disposition/persistence: 35/35 PASS
- `gridex:post-332-field-511-health-residuals-regression`: PASS
- ops health + post-108 residuals: PASS
- `ediel:utilts-reason-regression`: PASS
- `db:migrations:integrity`: PASS
- `db:types:check`: PASS
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)

## Source truth

- Repository: `heke99/gridex-ops-platform`.
- Default branch tip: `origin/main@f2c6a729`.
- Prefer tip-based `a029` over older open health vehicles once reviewed.
