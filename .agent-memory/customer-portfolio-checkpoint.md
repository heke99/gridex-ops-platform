# Customer portfolio side track: checkpoint

Status: Phase 1–2 VERIFIED (#474, squash `b1c79ae`). Performance pass VERIFIED and merged
(#477, squash `a7e4082`), applied to production as ledger version `20261003152539`.
Last updated 2026-10-03.

Separate from the Ediel checkpoint (`checkpoint.json`), `current-task.md` and `handover.md`.
Do not edit those files from this track.

## Scope (user request, 2026-10-03, Swedish)
- **"Kundportfölj" per tenant:**
  - active, new and churned customers per month, plus net change and churn;
  - powers of attorney;
  - metering-value requests, split into historical and ongoing;
  - consumption forecast for the current month, 3, 6 and 12 months.
- **White-label overview** (e.g. Elklart): all tenants on the platform with per-tenant drill-down; strictly read-only.
- **Only a platform superadmin** may attach a company to a white-label.
- **Atomic RPCs, consistent tables, one definition everywhere.**
- **Not this track:** Ediel masterplan v2, which another agent owns. Never touch `lib/ediel*` or Ediel migrations here.

## Canonical definitions (single source: `customer_supply_periods`, status `cancelled` ignored)
- **Active at D:** `start_date <= D and (end_date is null or end_date > D)`.
- **New in M:** the customer's first ever `start_date` is in M.
- **Churned in M:** the customer's last `end_date` is in M and they have no open period.
- **"Aktiva kunder"** on the dashboard and platform usage means supplied customers (`gridex_customer_portfolio_active_counts`).
- **Status-based counts** that must stay are labelled "Kundposter med aktiv status": the customer list filter and the `companyStatistics` usage-pricing basis.
- **kWh** is `coalesce(value_kwh, quantity_kwh, quantity)`. Writers use all three columns.
- **Forecast run:** the latest `consumption` run covering the month, the same rule as `lib/analytics/db.ts`.

## Code map
- **Migrations:**
  - `20261003130000_customer_portfolio_analytics_whitelabel.sql`
  - `20261003131000_customer_portfolio_phase2.sql`
  - `20261003150000_portfolio_analytics_rollups_performance.sql` (performance pass, production ledger `20261003152539`)
- **Libraries:**
  - `lib/analytics/customerPortfolio.ts` (data plus CSV)
  - `components/admin/analytics/CustomerPortfolioViews.tsx`
- **Pages:**
  - `app/admin/analytics/portfolio/` (page and export)
  - `app/admin/whitelabel/portfolio/` (page and export)
  - `app/admin/platform/white-labels/actions.ts` (superadmin assign)
- **Builder and crons:**
  - `lib/analytics/monthlyMetricsBuilder.ts` now calls `gridex_rebuild_company_analytics_month` only.
  - The daily cron rebuilds the current and previous month.
  - The monthly cron rebuilds the 12-month consumption rollup, then closes the month.
- **Tests:**
  - `__tests__/customer-portfolio.test.ts`
  - SQL behaviour tests: `scripts/sql/customer-portfolio/00_stub.sql`, then `10_behaviour.sql`, `20_phase2.sql`, `40_rollups.sql`
  - Performance seed: `30_perf_seed.sql`

## Production (`piidsfebjqjmnepdpnas`, the user's production project)
- **Applied via Supabase MCP `apply_migration`:** 130000 recorded as ledger version `20261003140217`, 131000 as `20261003140335`.
- **The MCP apply path stalls on any statement containing DROP, DELETE or TRUNCATE**, including `on delete` FK clauses and `on commit drop`. Nothing is applied when it stalls. Migrations on this track are written without those keywords, and a vitest guard enforces it.
- **CI clean replay lacks the white-label tables and `companies.white_label_platform_id`.** Use plpgsql helpers and guard trigger creation on the column.

## Performance pass (2026-10-03)
- **Baseline vs after**, measured with 5 000 customers and 8.76M hourly values, warm cache:

  | Call | Before | After |
  |---|---|---|
  | Bidding zones | 8 000 ms | 115 ms |
  | Uncached forecast | 8 920 ms | 136 ms |
  | Forecast vs actual | 2 510 ms | 4.5 ms |
  | 12-month summary | 1 270 ms | 233 ms |
  | Cohorts | 680 ms | 13 ms |
  | Nightly snapshot | 9 630 ms | 200 ms |

- **Analytics month:** previously ~4 HTTP queries per customer (N+1) with client-side sums truncated by the PostgREST row cap; now one transaction of 1.2 s with exact totals (684 000 kWh equals raw).
- **Production verification (2026-10-03, read-only plus one rebuild):**
  - the table is classified `system`;
  - `authenticated` has no SELECT on the table and no EXECUTE on the rebuild function;
  - `gridex_rebuild_company_analytics_month` returned customers=4 and zones=4, and used the latest forecast run;
  - the security advisors show no new findings for these objects;
  - the rollup has 0 rows because production has no metering values in the last 13 months yet.
- **Next action:** none on this track. Monitor the first nightly cron run.
