# Current state

Updated: 2026-08-13

## Source truth

- Repository: `heke99/gridex-ops-platform`.
- Default branch tip: `main@f596dc55` (second `332` field-511 package: JSON +
  VERIFICATION overwrite on top of `64806855` import migration).
- Active health branch: `cursor/codebase-health-and-stability-c107`.
- Superseded tip vehicle: `cursor/codebase-health-and-stability-2ef0` / `#120`
  (based on pre-`f596dc55` tip).

## Tip review after `f596dc55`

Confirmed residuals addressed on `c107`:

1. HIGH — auth flash allowlists + proxy `getSafeNextPath` (from open `#119`/`#120`)
2. HIGH — mixed UTILTS disposition APERAK detail retention
3. HIGH — null IDE+24 `transaction-<n>` persist/ACK identity alignment
4. HIGH — generated types lag for field-511 columns + `resolve_ediel_timeseries_product_511`
5. MEDIUM — L653Q leading-tab description cleaned via forward `20260813221500`
6. MEDIUM — `VERIFICATION.md` production gate restored; field-511 evidence moved to
   `quality/ediel-field-511-25-a-3-verification.md`
7. LOW — orphaned root checksum snippet removed; JSON package coherence locked

## Verification executed on `c107`

- vitest auth-outage + UTILTS disposition/persistence: 35/35 PASS
- `gridex:post-332-field-511-health-residuals-regression`: PASS
- `gridex-ops-health-regression`: PASS
- `gridex:post-108-health-residuals-regression`: PASS
- `ediel:utilts-reason-regression`: PASS
- `db:migrations:check` / generated types: PASS (tip `20260813221500`)
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)

## Ediel / field-511 note

- Authoritative 25-A-3 field-511 import is on main via `20260813210500`
  (91 tuples / 88 current; retired L336Q/S195/S196 fail-closed).
- Official operation/request R/D/O/X matrices and TGT/AGT evidence remain
  external/source-blocked.
