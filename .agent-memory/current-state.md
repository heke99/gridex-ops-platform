# Current state

Updated: 2026-08-13

## Source truth

- Repository: `heke99/gridex-ops-platform`.
- Default branch: `main` at `64806855` (commit `332` authoritative field-511
  Tidsserieprodukter import).
- Active health branch: `cursor/codebase-health-and-stability-2ef0`.

## Tip review after #332

Confirmed residuals addressed on `2ef0`:

1. HIGH — open `#119` auth/SVK + UTILTS ACK/persist identity residuals were
   absent from the post-332 tip. Cherry-picked onto `2ef0`.
2. HIGH — generated-types tip lagged `20260813210500` field-511 schema/RPC.
   Columns + `resolve_ediel_timeseries_product_511` synced; manifest advanced.
3. MEDIUM — L653Q description carried a workbook leading tab. Forward migration
   `20260813221500` trims it without rewriting the applied import.

## Verification executed on `2ef0`

- `vitest` auth-outage + UTILTS disposition/persistence: 35/35 PASS
- `gridex:post-332-field-511-health-residuals-regression`: PASS
- `gridex-ops-health-regression`: PASS
- `gridex:post-108-health-residuals-regression`: PASS
- `check-migration-versions`: PASS
- `check-supabase-generated-types`: PASS
- `ediel:utilts-reason-regression`: PASS
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)

## Intentionally open

- Official operation/request R/D/O/X matrices and TGT/AGT evidence remain
  external/source-blocked.
- Hosted CI / live migration apply of field-511 import+trim not yet observed.
- Observation `readingAt` persist completeness remains deferred.
