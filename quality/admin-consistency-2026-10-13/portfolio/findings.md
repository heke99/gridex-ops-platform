# Customer portfolio read-only audit, 2026-10-13

This report records the pre-remediation state. The later user-authorized source
repairs and verification are recorded in `remediation.md` in this directory.

Observed source head: `51f5fa5e80c42350d697bfed42520672749d4467`.
This is the separate admin/customer portfolio track, not Ediel masterplan work.
No production source, migrations, database rows, or shared memory were changed.

## Routing and scope

Applied local `code-review`, `find-bugs`, `systematic-debugging`, `supabase`,
`supabase-postgres-best-practices`; applied `fp-check` as direct behavior/false-positive
verification of the specific findings and `variant-analysis` to white-label pages
and exports using the same helper. These findings are correctness bugs, not
security vulnerabilities. The security-only fp-check impact gate does not upgrade
their classification to vulnerabilities. No subagents were spawned by this agent.

No implementation, refactoring, branch delivery, hook installation, credential
handling, secret scan, supply-chain change, or performance optimization was
performed. Those workflows have no trigger in this bounded read-only component
audit. The parent audit owns broader platform/security inventory and live SQL.

## Incident root cause — confirmed live

`/admin/analytics/portfolio` fails because its expiring-power-of-attorney RPC
assumes a DATE column while production has TIMESTAMPTZ. Parent executed all seven
page RPCs read-only for all three live companies: six passed, and only
`gridex_customer_portfolio_expiring_poa` failed with SQLSTATE `42846`,
`cannot cast type interval to integer`, at its RETURN QUERY. This failure occurs
even with no power-of-attorney rows. The exception propagates through
`getCustomerPortfolioInsights` and rejects the whole portfolio page.

Parent verified exact live columns: `powers_of_attorney.valid_from` and
`valid_to` are `timestamp with time zone`; `scope` is `text`. The repository
schema snapshot and SQL stub instead define `valid_from`/`valid_to` as DATE.

## Empty-data interpretation

The parent audit observed zero live customers, sites, metering points, supply
periods and customer monthly metrics. The 72 forecast snapshot rows were zero
forecasts for zero points and are a valid cron result. This evidence explains
empty portfolio totals independently of the confirmed expiring-PoA RPC failure.
Neither these zero snapshots nor absent source data is classified as a bug.

The live RPC definitions supplied by the parent are retained in
`live-rpc-definitions.json`; the functions discussed below are deployed, with
signatures agreeing with `supabase/database.types.ts`. Live customer-row impact
of the numerical bugs cannot be asserted while source data is empty.

## Confirmed findings

### PORTFOLIO-00: P1 — expiring-PoA RPC crashes the entire portfolio page

Evidence: `20261003131000_customer_portfolio_phase2.sql:644` declares the returned
`valid_to` as DATE, while `:657` returns raw `x.valid_to` and calculates
`(x.valid_to - current_date)::integer`. PostgreSQL subtracting a DATE from
TIMESTAMPTZ produces INTERVAL, which cannot be cast to INTEGER. The deployed
function definition is identical. Parent live catalog confirms TIMESTAMPTZ;
parent isolated live execution confirms SQLSTATE 42846 for all three companies.
Planning/type resolution fails even if the table is empty, so missing PoA data
cannot mitigate this.

Page impact: `customerPortfolio.ts:220` requests that RPC; `:222` throws any
insight error; `app/admin/analytics/portfolio/page.tsx:24-27` waits for both panels
without recovery. White-label per-company detail also awaits the same helper
(`app/admin/whitelabel/portfolio/page.tsx:32-35`), so that path shares the crash.
The CSV routes call only summary/forecast, so this expiry defect does not affect
CSV or the white-label all-company overview.

Root cause: SQL assumes repository/stub DATE types rather than the existing live
TIMESTAMPTZ types. `ADD COLUMN IF NOT EXISTS ... valid_to date` in earlier
compatibility migrations does not normalize an already existing timestamp column.
Generated TypeScript represents both DATE and TIMESTAMPTZ as `string`, hiding
this divergence from typechecking. Existing SQL tests define DATE and therefore
cannot catch the live arithmetic/type failure.

Minimal fix: a forward migration replacing this RPC while retaining grants,
tenant assertion and signature. Normalize live timestamps to the analytics UTC
calendar date, e.g. `(x.valid_to AT TIME ZONE 'UTC')::date`, and use the normalized
date for the returned DATE, integer day subtraction, date-window filtering and
ordering. Fixing only the integer subtraction leaves raw TIMESTAMPTZ in a DATE
return column and can expose a second datatype mismatch. No scope cast is needed
for the verified live TEXT column. Keep the source preserved in this read-only
audit; no migration was applied.

Regression: execute the actual RPC with production-shaped TIMESTAMPTZ PoA
columns, including an empty table (must not throw), one valid expiry within
30 days, null expiry, outside-window expiry, UTC midnight boundaries and
foreign-company denial. Then render tenant portfolio and white-label drill-down
with the other six RPCs valid; verify their whole-page success and CSV behavior.

### PORTFOLIO-01: P2 — selected platform-admin company is discarded

Evidence: `app/admin/analytics/portfolio/page.tsx:13-15` and
`app/admin/analytics/portfolio/export/route.ts:10-15` authorize using the canonical
guard and then independently resolve company scope. The guard's company comes
from `canonical_authenticated_tenant_context` (`lib/admin/guards.ts:139-179`).
`getOperationalCompanyScope` honors the company cookie only for membership
companies, returns null for a platform admin with no memberships, and otherwise
chooses an owner/first membership (`lib/tenant/scope.ts:150-193`).

Reproduction: verbatim helper functions extracted to `/tmp/gridex-portfolio-scope-repro.ts`,
with a synthetic platform admin selecting B. With an owned membership in A, the
scope returns A; with no memberships it returns null. Thus a valid selected B
can show A's portfolio/export or `Bolag saknas`. This is wrong-company attribution
for an already privileged administrator; unauthorized cross-tenant disclosure
is not claimed. Parent should consolidate with any shared scope finding.

Minimal fix: use the canonical guard's authorized `companyId` consistently in
page and export. Preserve missing-company handling when canonical scope is null.
Regression: platform admin selecting B with only membership A; selecting B with
no memberships; tenant selecting an authorized membership; invalid selection.

### PORTFOLIO-02: P2 — cohort customer count is multiplied by four

Evidence: `20261003150000_portfolio_analytics_rollups_performance.sql:439-447` counts
rows after joining members with rates grouped by cohort and each of four horizons.
Every nonempty cohort has four rates rows, including future/null rates. Therefore
`count(*) = 4 × number of cohort members`. The prior phase-2 function counted
distinct customers, but the performance replacement lost this invariant. Live
definition contains the same join and count; UI displays it verbatim
(`CustomerPortfolioViews.tsx:215-216`, `customerPortfolio.ts:233-240`).

Proof: first synthetic SELECT in `synthetic-read-only-proofs.sql` mirrors the final
aggregation: one member joins four rate rows and reports four customers. Rates
themselves are not shown to be multiplied; the customer-count column is wrong.
No source data currently exists to assert a wrong displayed production count.

Minimal fix: a forward migration changing to `count(distinct mb.customer_id)`, or
aggregate cohort membership separately before joining rates. Do not rewrite the
already applied migration. Regression: execute the actual RPC with one member,
two members, multiple supply periods for one customer, and future null horizons;
assert customer count equals unique customer membership in every cohort.

### PORTFOLIO-03: P2 — historical white-label overview and detail/export use different forecast months

Evidence: white-label overview passes selected month through
`customerPortfolio.ts:140-142`; its deployed SQL uses that month for forecasts
(`20261003131000_customer_portfolio_phase2.sql:281,301`). Drill-down invokes
`getCustomerPortfolio` (`app/admin/whitelabel/portfolio/page.tsx:29-35`), whose
forecast RPC omits `p_as_of` (`customerPortfolio.ts:118`) and therefore defaults to
the database's current date. Both tenant/white-label exports use the same helper.
Selected-month outcome rows and filename can consequently accompany a different
forecast calendar. Zones and cohorts likewise use today's default date.

Executed reproduction: `calendar-repro.ts` copies the actual helper functions
verbatim with a mock transport simulating the deployed current-date default.
Selecting September 2026 returns September outcome and October forecast rows.
`calendar-repro-result.json` records all seven RPC arguments. This does not prove
an authenticated HTTP request or a live numerical difference.

Minimal fix: establish one explicit forecast anchor across overview, detail and
export. Passing `p_as_of: to` matches the selected-month overview; update the
current-month label when a historical anchor is selected. If forecasts must
always mean today's portfolio, consistently anchor overview to today and label
it. Add an explicit cohort anchor only if cohorts must follow the selected month.
Regression: historical and current month selection, matching forecast dates and
totals across white-label overview/detail/CSV, and tenant page/CSV consistency.

The tenant panel explicitly labels its first horizon `Innevarande månad`, so
ignoring the historical selector for tenant forecast alone could be intentional.
The confirmed defect is the disagreement between white-label overview and its
drill-down/export, regardless of which anchor the product chooses.

### PORTFOLIO-04: P2 — metering-request totals include unrelated request scopes

Evidence: deployed monthly summary `req` uses unfiltered `count(*)` for total and
failures, while historical/ongoing counts restrict to `meter_values` and
`billing_underlay` (`20261003150000_portfolio_analytics_rollups_performance.sql:349-358`).
`lib/cis/types.ts:1-8` also permits masterdata, supplier-switch, access, partner-export
and ACK scopes; `lib/cis/db-data.ts:276` stores the selected scope. The portfolio
UI labels the unrestricted total `Mätvärdesbegäran` (`CustomerPortfolioViews.tsx:96-99,114-117`),
and the CSV uses the same values. This conflicts with the checkpoint's explicitly
requested metering-value requests split into historical and ongoing.

Proof: second synthetic SELECT models one historical meter-values request plus
one failed customer-masterdata request. Displayed metering total is two,
historical+ongoing is one, and the reported metering failure belongs to masterdata.
Production occurrence is not established by live rows.

Minimal fix: apply the same metering scope predicate to total and failures in a
forward migration, preserving historical/ongoing partition logic. If an all-data
request total is intentionally desired, expose and label a separate metric.
Regression: mix all typed request scopes and failed states; ensure portfolio
metering total equals historical+ongoing and excludes unrelated failures.

### PORTFOLIO-05: P2 — customers starting after day one are absent from today's forward forecast

Evidence: per-point forecast normalizes `p_as_of` to `v_start` at month start and
requires `sp.start_date <= v_start`
(`20261003150000_portfolio_analytics_rollups_performance.sql:144,163-171`). The
aggregate forecast also passes month-start downstream
(`20261003131000_customer_portfolio_phase2.sql:161,170`), and daily snapshots use this
same algorithm. Active counts and bidding-zone customer counts use the actual
requested date, with strict end-date exclusivity (phase2:431-432,619). The original
forecast contract says it forecasts customers supplied at `p_as_of`
(`20261003130000_customer_portfolio_analytics_whitelabel.sql:205`).

Proof: third synthetic SELECT compares those deployed predicates. A customer
starting October 5 is active on October 13 but fails forecast eligibility because
October 5 is later than October 1. The point stays absent for the whole forward
horizon until November, even if it has usable prior history. Source data is empty
today, so no current wrong production kWh is asserted.

Minimal fix: distinguish the horizon's first month from the eligibility date, and
preserve the requested `p_as_of` through aggregate/per-point calls. Define the
snapshot's eligibility date explicitly and retain historical snapshot immutability.
Regression: start on month first/day five; end exactly on as-of; past/future
starts; compare forecast point membership to the canonical active-at-date RPC.

## False positives, limits and verification

- Zero source data/zero snapshots: valid empty data state; not a defect.
- Missing RPCs/signature drift: rejected by live definitions and generated types.
- Missing churn/expiring-POA fields: fields exist; rejected as a missing-column
  claim. Parent live checks instead confirmed the expiry column-type mismatch.
- Missing company predicate on bidding-zone metering-point lookup: do not claim
  disclosure solely from the join by UUID. The schema snapshot contains the
  composite supply-period/company/metering-point FK, and the period query is
  tenant filtered. Parent scanned all 1,298 live public FKs with no violations.
- Forecast model versus stored consumption-run model: they are separate
  intentional pipelines, not automatically a defect because values differ.
- Current validity of PoA versus historical month end: no confirmed finding in
  this report; lifecycle-history semantics require more domain evidence.

Reviewed completely: tenant and white-label portfolio pages/exports,
`CustomerPortfolioViews.tsx`, `customerPortfolio.ts`, all three portfolio migrations,
`customer-portfolio.test.ts`, `monthlyMetricsBuilder.ts`, daily/monthly analytics
cron routes, SQL stubs/behavior files. Reviewed relevant sections of guard/scope,
generated database types, schema snapshot, request writer/types and PoA helpers.
No unrelated Ediel implementation review or edits were performed.

Checklist: RPC argument SQL injection is parameterized; React escapes displayed
text; authenticated page guards and per-RPC tenant checks are present; exports
validate white-label membership and requested company; pages/exports are read-only
so CSRF/write races are absent. No crypto or credentials are handled here. Month
parsing normalizes malformed values; summary ranges and cohort periods are bounded.
No exploitable XSS, SQL injection, credential leak or auth bypass is confirmed.
Source-dependent aggregate correctness is covered by findings above; performance
and full authenticated browser rendering were not measured.

Executed `npm test -- __tests__/customer-portfolio.test.ts`: blocked, exit 127,
`vitest: not found`; workspace has no node_modules. Existing tests principally
string-match migration contracts and do not execute cohort SQL or verify the
page RPC calendar arguments. SQL behavior scripts print cohort results but do
not assert the count after the rollup migration.

Executed `node --experimental-strip-types /tmp/gridex-portfolio-calendar-repro.ts`:
pass, calendar mismatch and omitted date arguments asserted. Repeated the same
script from the evidence directory: pass, result retained. Executed scope
reproduction: pass, wrong selected-company/null scenarios asserted. Synthetic
SQL statements are read-only proofs; execution receipts are owned by parent.
Parent executed all seven real page RPCs read-only over all three live companies:
summary/forecast/accuracy returned 12 rows each, churn/cohorts/zones returned zero,
and expiry alone failed 42846. These actual RPC checks isolate the primary outage.

Recommended remediation packets: (0) production-shaped expiring-PoA forward
migration and full-page regression; (1) shared canonical company selection;
(2) forward cohort-count migration plus SQL behavior assertions; (3) explicit
forecast/date contract across overview/detail/exports; (4) scoped request counts;
(5) actual-date forecast eligibility with snapshot regression tests. All require
separate authorization to implement; this audit performed no remediation.
