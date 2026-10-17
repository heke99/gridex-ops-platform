# Independent lifecycle review — 2026-10-13

Read-only review of the data-quality lifecycle migration and application producers/wrappers before live rollout. No provider calls, database mutations or changes to the reviewed production sources were made by this delegate. Runnable proofs execute actual source or migration SQL with synthetic adapters and an isolated PGlite database.

## Confirmed blockers reported to root (subsequently fixed)

1. **Incomplete forecast evidence can clear an issue.** `lib/forecasting/meteringPointForecast.ts:64` returns zero for schema-cache/missing-column/table errors. With an annual estimate, the new healthy path at line 121 resolves `forecast_basis_missing` after all three historical reads failed. Both schema-cache and missing-column errors reproduced a successful 120 kWh result and one resolution call. `forecast-incomplete-read-red-proof.json` records the result; `forecast-incomplete-read-proof.mjs` runs the actual TypeScript source with mocked imports. Remove the exception-to-zero branch and test these exact error classes; failures must retain the finding and propagate.
2. **Canonical negative values are wrongly declared repaired.** `supabase/migrations/20261013094514_data_quality_lifecycle_consistency.sql:186` checks only `quantity_kwh`. The canonical ingest in `20260901165500_link_ediel_sources_during_atomic_metering_ingest_recovery.sql:82` writes `value_kwh` to the raw source. A source row with `value_kwh=-5` and `quantity_kwh=NULL` therefore resolves its existing managed `invalid_metering_value` at lifecycle line 201 with `condition_cleared`. Use the same authoritative amount semantics as the existing analytics rollup (`coalesce(value_kwh,quantity_kwh,quantity)`) and a production-shaped test that retains the failed condition.
3. **Historical forecasts keep current alerts open after repair.** Lifecycle lines 193–194 read every historical forecast item for a point/month. `lib/forecasting/forecastRuns.ts:19` and line 76 insert new runs/items for recalculation. The SQL proof creates an older completed 20% deviation and a newer completed healthy 0% result for the same point/month; the deviation remains open. Select the authoritative completed run/window before evaluating this rule, preserving the existing finding when a replacement run is incomplete or failed. Test append-only new runs rather than updating the historical item in place.

`data-quality-current-source-proof.mjs` executes the production migration and production-shaped issue/alert DDL for findings 2–3. `data-quality-current-source-red-proof.json` records both failures. These findings were sent to the root and lifecycle owner before rollout. Root owns their remediation and verification.

## Follow-up verification after lifecycle handoff

All three reported rule/producer blockers are fixed in the reviewed source. Both isolated runnable proofs were rerun after the lifecycle owner handed off stable changes:

- `forecast-incomplete-read-green-proof.json`: schema-cache and missing-column errors stop after the first failed historical read, propagate the error, and make zero finding/resolution writes.
- `data-quality-current-source-green-proof.json`: a canonical negative `value_kwh` retains its existing open finding; after first scanning an older failed forecast, appending a newer completed healthy run resolves that finding while retaining its history. The proof fixture includes production forecast-run status/type/completion and item ownership fields.

The updated scan uses canonical `value_kwh` with `quantity_kwh` fallback, and the shared `gridex_current_point_forecasts_v1` helper chooses the newest completed same-company consumption result for each point/month. Null numerical evidence cannot clear an existing negative-value or forecast-deviation finding. The new forecast/missing-meter helpers are security invoker, retain source RLS, and revoke public/anonymous execution. No remaining blocker was found in those changes. Root still owns native/provider verification and the staged legacy-key cutover described below.

The two runnable proof files use ES-module imports (`.mjs`) and Node 22. Both reran with exit 0 after conversion; scoped ESLint and `git diff --check` also exited 0, without global rule exceptions.

## Forecast-run follow-up review

The final `forecastRuns.ts` patch throws actual-consumption read errors before inserting a false-zero item or completing the run. Completion-write errors propagate before a healthy monthly rollup is built; item-write failures retain the existing stop behavior. Company/point/period filters on reads and company/run filters on completion are preserved.

`forecast-run-independent-verification-results.json` records all four focused regression tests passing. Both historical forecast evidence and current actual evidence now prefer canonical `value_kwh` over legacy `quantity_kwh`, including canonical zero. `forecast-canonical-precedence-proof.mjs` executes both actual modules with synthetic imports: identical prior-year/current canonical 120 kWh with stale legacy 1 kWh produce forecast 120, actual 120, and zero deviation. Its green JSON is saved separately. The historical producer changed concurrently before that combined-source proof ran; no red reproduction is claimed for this follow-up. Scoped ESLint for the new ES-module proof passed. No remaining blocker was found in this minimal patch.

## Mature-builder 100622 follow-up review

No blocker was found in the requested period-source, per-owner and grant checks:

- Both company and owner missing-meter counts read `gridex_missing_metering_points_v1(p_company_id,v_month)`. The helper checks the selected UTC month, company on both point/value sources and shared active-source status. Stale, duplicate or another month's issue rows do not affect this physical count.
- Owner counts group by actual `grid_owner_id` and join that group to the corresponding owner. Missing points without an assigned owner remain in the company total and are not fabricated under an owner. The mature owner relation still filters its company.
- The replacement validates the exact old body shape before editing and validates the repaired shape on reapplication. It executes the `pg_get_functiondef` definition through `CREATE OR REPLACE`, preserving the existing signature, security mode, search path, ownership and grants. The mature builders remain service-only; the new source gate is security invoker and uses source RLS for direct reads.

`mature-builder-independent-verification-results.json` records all five behavioral tests passing against the actual mature migrations and source helpers: empty snapshots, composite ownership/deletion, real post-intake statistics, selected-period/per-owner counts despite stale findings, and safe reapplication/service-only grants. Root owns native/provider confirmation before live application.

## Verified safeguards

- All public write RPCs call the service-role/company guard and have authenticated/anonymous execution revoked. Every update/scan is restricted by company. The private aggregate primitive has execution revoked for application roles, including service_role, and is reached only through trusted wrappers/authorized source-deletion triggers.
- Source ownership is checked before managed creation. Explicit resolution filters both company and row ID. Producer resolution filters managed source, company, entity, rule and evaluated month. Manual/unknown history is preserved by managed reconciliation.
- The set-based scanner has no row cap or caught SQL errors. Its detection, resolution, insertion and aggregate refresh execute in one RPC transaction. A source/schema/write failure aborts those transitions; the existing behavioral tests cover write rollback and more than 5,000 points.
- Point scans evaluate point-scoped forecast evidence and cannot resolve another point or a different period. The catalog is the common registry for source type, active-source eligibility, period semantics and aggregation; the test checks the TypeScript mirror against actual SQL.
- Application wrappers in `lib/analytics/dataQuality.ts` and `lib/analytics/alerts.ts` propagate RPC failures. The forecast source gate validates a boolean result and fails on schema/read errors. Tenant read scope uses the company for which the canonical guard resolved permissions.

## Deployment constraint already identified by root

Lifecycle lines 23–24 drop the legacy five-column unique constraints. Old application servers still call direct `upsert(...onConflict: fiveColumnKey)`, so applying those drops before the application cutover makes their writes fail. Root's stated prepare → application deployment → constraint cutover is required. Prepare must leave those keys available to old writers; new lifecycle recurrence/history behavior should only be exercised after cutover. This is a concrete compatibility requirement, separate from the three rule/producer defects above.

This review does not claim authenticated browser verification, provider migration replay or compatibility with the old application after constraint removal. Root owns those checks and the actual rollout.
