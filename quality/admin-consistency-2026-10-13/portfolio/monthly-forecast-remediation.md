# Monthly statistics and forecast evidence repair

Completed the exact root handoff for migration `20261013100622`, its SQL test, and `lib/forecasting/forecastRuns.ts`. No live writes and no changes to applied migrations.

## Monthly statistics

The mature monthly builder retains its original logic, signature, security settings and grants. Its two missing-meter counts now use the authoritative physical-source helper `gridex_missing_metering_points_v1(p_company_id,v_month)` from migration `20261013094514`. The company count includes every missing active point once; the grid-owner CTE groups those same points by owner and joins each group's count to its own owner.

This replaces the earlier proposed persisted-issue filtering with the final shared-source contract: stale, duplicate or absent findings cannot change the number of physically missing metering points. Historical builds use their selected UTC month.

The empty-customer branch now returns the mature result fields: `month`, `forecast_run_id`, `customers`, `bidding_zones`, and `grid_owners`, plus `skipped`. It writes no snapshot or metric rows. Missing-count substitutions run independently of guard installation, validate the expected native patterns, and fail visibly for unfamiliar or partially repaired bodies. Re-running the migration preserves service-only builder grants.

## Forecast runs

Actual-value read errors now throw before item insertion or run completion. Completion-write errors throw before monthly rebuilding. Actual values use `value_kwh ?? quantity_kwh`, preserving canonical zero values. Existing tenant filters and item-write failure behavior remain intact.

## Verification

- TDD: five behavioral failures reproduced before source changes (two monthly SQL, three forecast).
- New/expanded tests execute the actual mature portfolio migrations and shared physical helper with production timestamp-shaped PoA columns. The September fixture includes stale findings, inactive/orphaned sources, an unscanned missing point, another period's values, and foreign-company values. It verifies company count **2** and owner counts **2 / 0**.
- Five relevant suites: **31 tests passed** (monthly integrity, forecast evidence errors, empty-source forecast cron, forecast quality lifecycle, portfolio SQL).
- ESLint on changed TS files and diff checks passed.
- Migration SHA-256: `555543fbffbde43dba3b774ced3163d5aa49fabe4f87e812b654df4cc3d6257a`.
- Forecast source SHA-256: `94a5749140009412d85fecd7c1a5f789f21ff38cd2f358a7dba3a263083e01ff`.

Root owns final generated types, migration checksums, independent final review and live application/cleanup. These source files are handed back for integration.
