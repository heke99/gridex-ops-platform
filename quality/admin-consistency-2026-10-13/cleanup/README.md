# Cleanup consistency review — 2026-10-13

This file preserves the initial read-only audit. The subsequently authorized,
completed reset and remediation are recorded in `implementation-and-reset.md`
and `final-root-reset-receipt.json` (743 removed rows, 140 empty graph tables,
17 zero scoped rowsets). The bounded portal-source follow-up and green local
proof are in `operational-quality-source-integrity.md`.

Read-only scoped review at repository HEAD `51f5fa5e80c42350d697bfed42520672749d4467`.
No source, database, global memory, migration, or Ediel campaign changes. The SQL
companion contains only read-only SELECTs and returns aggregate evidence, explicit
test flags, and schema metadata; no customer payload values or credentials.

## Skill routing and scope

Applied code-review/find-bugs to the complete deletion and residual read-model
paths, variant-analysis to the demonstrated missing-reference/lifecycle pattern,
fp-check to reject unsupported explanations, Supabase/Postgres guidance to the
ownership review and read-only SQL, and verification-before-completion to claims.
Reviewed AGENTS.md and current memory entries without changing them. The Ediel
masterplan remains a separate campaign. using-superpowers explicitly exempts
dispatched subagents. acquire-codebase-knowledge's documentation-generation trigger
is absent: this is a bounded integrity review, not onboarding/documenting the
whole repository. Security exploitation/static scanner, supply-chain, UI design,
performance measurement, test-writing, worktree, implementation, and delivery
workflows are outside this read-only cleanup scope. No vulnerability claim is made.

## What the prior purge actually promised

`quality/audits/2026-10-10-schema-consistency/purge-test-data.sql:1-5` identifies
12 test customers, eight synthetic staff-API companies, and approximately 2,400
preselected dependent rows. It assumes `ops_purge_20261010.tgt` was prepared
beforehand; preparation and the exact target snapshot are not in the checked-in
file. The only final assertions are customers=0 and companies=3 at lines55-57.
This is a targeted test-data cleanup, not a promise that all operational,
configuration, reference, audit, or cron snapshot tables are empty.

The script sets `session_replication_role=replica` at line8, so normal FK actions
and row triggers do not expand or protect the graph. It then:

1. Removes no-id FK dependents at lines16-31.
2. Deletes only the previously selected id-bearing graph at lines33-38.
3. Sweeps UUID columns named exactly `customer_id` or `company_id` at lines40-51.
4. Checks only root counts and drops its target schema at lines55-61.

The same implementation exists in `RUN-THIS.sql:581-638`. Its restoration to
`origin` at line635 does not retroactively validate any omitted reference. A
passing root count therefore cannot establish absence of polymorphic `entity_id`
orphans, `created_*_id` aliases, applications with no customer yet, or company-wide
derived read models under the three retained companies.

The README's proposed graph-aware permanent test purge and broader deletion tests
(`quality/audits/2026-10-10-schema-consistency/README.md:76-87`) are a plan; the
current application still invokes `gridex_delete_test_customer_v1`.

## Live observations supplied by the root reviewer

The root executed live exact-count and classification queries against
`piidsfebjqjmnepdpnas` during this review. These are root-supplied observations,
not independently executed database statements by this scoped reviewer.

- Customers, sites, metering points, metering values, period gaps, supply periods,
  customer monthly metrics, operation jobs, and tasks are zero.
- `website_customer_applications` has one `external_website`/`partial` row, created
  and updated on 2026-08-23. Customer/site/meter/intake/contract IDs are null; an API
  client is present. It predates the October purge. `external_contract_intakes`=0.
- `data_quality_issues` has 18 rows: missing_metering_values 6,
  active_metering_point_without_active_customer 2, missing_customer_contract 5,
  slow_grid_owner_response 5. All target deleted entities: metering points 8,
  customers 5, grid-owner data requests 5.
- `dashboard_alerts` has 350 OPEN rows: missing_metering_values 156,
  slow_grid_owner_response 162, data_quality 32. All have null entity_id. The newest
  missing-meter and slow-response alerts were produced today at 03:45.
- The remaining application's and API client's explicit test flags and name-based
  test hints are all false. This does not establish test provenance or authorize
  deleting that row.
- All 1,298 live public FK orphan checks across 425 child tables returned zero
  orphans; constraints were validated. The confirmed residue is outside FK coverage.
- All 350 alerts belong to exactly three complete conflict-key groups: 347 excess
  rows over the logical groups. Root verified ordinary NULL-distinct UNIQUE on
  production, matching the code-derived C5 root cause below.
- All six application/intake child tables in companion SELECT1 are empty;
  facility/platform data-quality tables, grid-owner requests/info requests/switch
  requests, normalized meter values/batches/errors and forecast items are also empty.
- Forecast runs 38 and snapshots 72 remain; zero-valued snapshots are valid cron
  artifacts. Company monthly metrics 12 and bidding-zone monthly metrics 48 require
  value inspection by the portfolio reviewer; count alone is not a consistency defect.
  Usage events 7,696 and usage failures 2 are retained usage evidence, not automatic
  cleanup targets. These remaining counts alone do not establish an inconsistent
  customer graph.

## Prioritized findings

### C1 — Medium, confirmed: deleted-source deviations survive and remain actionable

The six displayed missing-meter alerts are persisted issues against deleted
metering points. `data_quality_issues` stores `entity_type`/UUID `entity_id`
(`supabase/schema.sql:51299-51311`) and has only a company FK (`:161827`), not
an FK to the polymorphic source entity. The prior purge's residual sweep only
handles customer_id/company_id; retained companies and entity_id therefore escape
it. The ordinary test-delete RPC also has no issue cleanup:
`20261002211000_atomic_test_customer_delete.sql:107-133`.

The scanner cannot repair this state: `lib/analytics/dataQuality.ts:49-65` returns
without resolving issues when the meter is absent/inactive; `:132-305` upserts
failures for current entities but never resolves disappeared or now-healthy
entities. The existing resolve helper at`:38-47` has no application caller found
by repository-wide symbol search. Dashboard/rollup consumers count open persisted
issues without validating the referenced meter; e.g.
`20260826093000_platform_dashboard_and_rls_read_performance.sql:78-82` and
`20261003150000_portfolio_analytics_rollups_performance.sql:537-538`.

Impact: empty customer/meter data still reports six missing-meter problems; the
same lifecycle defect also affects deleted customers, metering values, Ediel
messages, and grid-owner requests because the scanner emits all five target types.
This is an operational consistency defect, not evidence of cross-tenant access.

Targeted remedy: reconcile open derived issues for known source types using both
entity ID and company ID. Resolve/invalidate missing-source issues with an audit
reason; recompute healthy-source failures from a successful complete scan. Never
resolve an issue because its source query failed or a capped/incomplete scan omitted
the source. Preserve unknown entity types and genuine retained-history exceptions.

### C2 — Medium, confirmed coverage gap: unlinked pre-customer application is outside purge graph

The surviving application has no customer/site/meter/contract/intake reference.
No customer FK traversal can discover it. Its retained company also excludes it
from the deleted-company sweep. The graph IDs remain optional in
`supabase/schema.sql:122843-122846`; pre-customer rows are valid business states.
`lib/admin/websiteIntegrationOps.ts:387-447` intentionally lists canonical rows
alongside external fallback rows, with no customer-required filter. Thus the admin
page's one row is explained by actual residual application data, not by a stale
customer count or an external mirror in the current database.

Impact: a failed/incomplete test signup may survive removal of all created
customers. Root checked explicit app/client test flags and client name hints;
all are false, so test provenance for this specific row remains unverified. An
unlinked row can also be a legitimate incomplete signup; null graph IDs alone do
not authorize deletion. Persistence is confirmed; whether this specific row was
intended to be included in the old purge cannot be established from repository
evidence.

Targeted remedy: inspect explicit test provenance/API-client metadata using
SELECT4 in the companion, then use an explicit tenant-scoped application target
manifest if it is confirmed disposable test data. Include its review/workflow
children, any mirror selected by same-company canonical application identity, and
its request idempotency record. Add a dedicated test-application cleanup path for
failed signups that never created customers. Do not hide all unlinked applications
in the admin list: that would hide legitimate pending work.

### C3 — Medium, confirmed code variant: alert refresh cannot retire zero-count alerts

`lib/analytics/alerts.ts:31-112` reads open issues, counts only present issue types,
and upserts alerts for those types. If all issues for a type are resolved/removed,
there is no iteration for that type and no alert transition. `createDashboardAlert`
at`:13-26` forces status=open, while `resolveDashboardAlert` at`:114-122` has no
application caller found. `scanCompanyDataQuality` calls this refresh at
`dataQuality.ts:307` and adds an aggregate data_quality alert at`:308-315`; it
does not close its prior aggregate when the scan finds zero.

Impact: after C1 is cleaned, old dashboard_alerts can still display a nonzero
historical title as open. Root observed 350 OPEN aggregate alert rows in live data;
the missing closure path itself is directly verified.

Targeted remedy: reconcile the scanner-owned alert types, updating existing open
aggregate alerts to resolved when their authoritative current issue count is zero.
Preserve manually created/provider/other subsystem alerts. Resolve the scanner's
aggregate data_quality alert after a successful complete scan yielding no current
issues. Verify missing-source and repaired-source scenarios as well as failure
paths that must retain existing alerts.

### C4 — Medium, confirmed schema weakness; no current external orphan: mirror aliases lack FK ownership

`external_contract_intakes.created_customer_id`, created_site_id,
created_metering_point_id, created_contract_id, created_case_id and
created_info_request_id are UUID columns (`supabase/schema.sql:51371-51376`) with
no corresponding FK in the current repo's complete FK section at`:163510-163528`.
The original October10 workbook's `Kolumner utan FK` sheet explicitly lists all
six as missing references. `lib/website/customerApplicationPersistence.ts:182-203`
writes graph IDs and an embedded canonical application ID into this mirror.
The prior purge's exact-column sweep and ordinary customer-delete RPC do not
target these alias names. Residual mirrors could therefore escape a future
customer purge or retain links to deleted entities.

Current `external_contract_intakes`=0, so this does not explain today's one
application. Remedy should be a forward migration with reviewed tenant-composite
FKs and explicit deletion/retention semantics, preceded by an orphan/backfill
query, plus a bounded mirror policy for test-data cleanup. Do not blindly change
these to CASCADE for real intake/audit history.

### C5 — Medium, confirmed root cause in code: nullable upsert key multiplies aggregate alerts

`createDashboardAlert` writes omitted entity_type/entity_id as null and uses
`onConflict: company_id,alert_type,entity_type,entity_id,status`
(`lib/analytics/alerts.ts:22-26`). All calls from `refreshDashboardAlerts` omit
both entity fields (`:53-109`); the aggregate data_quality call also omits them
(`dataQuality.ts:308-315`). The database unique constraint is ordinary
`UNIQUE(company_id,alert_type,entity_type,entity_id,status)` at
`supabase/schema.sql:129162`, with default PostgreSQL NULL-distinct semantics.

Identical aggregate keys with null entity fields never conflict with one another,
so repeated upsert calls insert additional rows instead of updating the existing
alert. This is independent of the lifecycle bug C3 and explains why repeated
cron refreshes can amplify the same stale issue group into hundreds of open
alerts. Root observed all 350 live alerts have null entity IDs, with new rows
still produced today. Root's live full-key grouping proves three logical keys for
350 physical rows (347 duplicate excess), and live uniqueness is ordinary
NULL-distinct UNIQUE. Companion SELECT6-7 reproduce these read-only checks. This
confirmation uses existing live rows, so no production INSERT was needed.

Targeted remedy: after reviewing/removing duplicate open aggregates, use a
reviewed `UNIQUE NULLS NOT DISTINCT` key or a canonical non-null aggregate identity
for the existing column-list upsert. A partial expression index alone will not
match the current plain onConflict column list. Keep logical alert lifecycle and
deduplication separate: a corrected unique key still needs C3's zero-count
resolution, and existing duplicates must be reconciled before adding uniqueness.

## Ownership and FK coverage

The following table reflects repository schema; the live catalog query must
confirm the deployed definitions before implementation.

| Table | Owner / meaning | Current repo protection | Cleanup implication |
|---|---|---|---|
| customers | Company/customer operational record | Company FK and hard-delete guard; service-only test-delete RPC | Test flag and protected-history checks remain required |
| customer_sites | Customer-owned site | Customer RESTRICT plus company/customer CASCADE, `schema.sql:161694-161708` | RPC explicitly deletes sites; normal guarded delete is atomic |
| metering_points | Customer/site-owned point | Customer/site RESTRICT and tenant-composite references, `:164445-164508` | RPC deletes points before sites/customers |
| website_customer_applications | Company-owned canonical signup, including pre-customer states | Company CASCADE; graph single-column SET NULL plus tenant-composite RESTRICT; `:166345-166447` | Linked rows can block normal test delete; unlinked rows need explicit application scope |
| external_contract_intakes | Company-owned external or mirrored signup | Company CASCADE; intake NO ACTION; offer SET NULL; created_* aliases unconstrained, `:163514-163528` | Graph/mirror cleanup cannot depend only on FK traversal |
| customer_application_intakes | Company-owned request/idempotency outcome | Company CASCADE; single customer SET NULL plus tenant-composite CASCADE, `:160056-160070` | Normal FK path differs from disabled-trigger purge; inspect replay outcome before reusing keys |
| data_quality_issues | Company-owned derived operational issue | Company RESTRICT only; entity_type/entity_id polymorphic, `:161827` | Explicit typed entity reconciliation required |
| dashboard_alerts | Company-owned derived/manual alert | Company RESTRICT only; optional polymorphic entity_id, `:161820` | Type/producer-specific lifecycle reconciliation required; aggregate null entity is legitimate |
| customer_portfolio_forecast_snapshots | Company-owned periodic portfolio snapshots | Company FK only, `:161575` | Zero-value cron snapshots are legitimate; no customer cascade expected |
| customer_application_workflow_events | Immutable transition audit | App/workflow/company FKs; table comment at`:109065` | Do not treat audit descendants as generic disposable caches |

The October10 workbook labels customer_application_intakes/external_contract_intakes
as reference/masterdata automatically. This is not an approved retention policy:
its README explicitly says name-derived roles must be reviewed before any FK
changes (`README.md:66-67`). The table purposes above come from actual definitions
and writers, not that automatic classification.

## False positives and unresolved checks

- **Rejected:** all tables must be empty after customer purge. Prior expected state
  retained three companies; reference/configuration, retained audit and zero-value
  cron snapshots may remain.
- **Rejected:** one website row proves an external mirror duplication today.
  Current external table is empty; canonical app alone explains it.
- **Rejected:** one app with null customer proves dangling customer FK. No customer
  reference exists; its test provenance and desired disposal need separate proof.
- **Rejected as general claim:** the ordinary RPC always half-deletes linked rows.
  Its deletes run in one database transaction and non-cascading FK failures abort
  the command. Its remaining weakness is missing explicit lifecycle coverage,
  not the old multi-call partial-delete bug.
- **Unverified:** actual original `ops_purge_20261010.tgt` membership and execution
  receipts. The script drops the target schema; checked-in SQL does not reproduce
  preparation. Root may check whether any target/evidence schema remains.
- **Unverified:** deployed RPC parity and original purge execution receipts.
  Root verified all 18 known polymorphic targets missing, 350 alerts in three
  duplicated full-key groups, ordinary production UNIQUE, and all 1,298 validated
  FK orphan checks across 425 child tables.
- **Unverified:** a completed customer_application_intakes.result can be replayed
  with a deleted result. Admin replay returns stored IDs at
  `app/admin/customers/actions.part-3.ts:108-133`; the composite customer CASCADE
  can remove that intake during normal deletion, so no current stale replay
  finding is asserted without deployed constraints and actual residual data.

## Minimal remediation order

1. Capture one consistent read-only exact-count/orphan snapshot and explicit
   test-application provenance. Include relevant polymorphic targets, scanner-owned
   alerts, linked app/workflow records, and derived aggregate tables. Use company
   ownership in every classification; distinguish valid history from stale state.
2. In one reviewed transaction, resolve/invalidate verified stale derived issues
   and their scanner-owned aggregate alerts with audit evidence. Clean only a
   confirmed disposable application and its reviewed dependency manifest. Keep
   retained legal/audit data and reference configuration. Do not reuse the broad
   replication-role-disabled October script.
3. Small PR: issue/alert lifecycle reconciliation, nullable aggregate uniqueness,
   duplicate reconciliation, and display count invariants.
   Verify deleted meters/customers/requests, repaired active entities, incomplete
   scans/query failures, manual/unknown issue types, repeated aggregate upserts
   that must stay at one open logical alert, and concurrent aggregate producers.
4. Small PR: explicit pre-customer test-application cleanup and FK/alias coverage,
   retaining service-only authority, tenant scoping, graph preview and root locks.
5. Add post-cleanup assertions for all owned references and active read models;
   root counts alone are insufficient. Zero-value cron snapshots and retained
   history must be documented as expected residual categories.

## Verification record

Commands run successfully: targeted `rg` searches over app/lib/migrations and
tests; numbered source reads; `git log/show` of prior purge commit`4945fab0`; repo
HEAD/status inspection; openpyxl read of workbook roles/FKs/missing references.
The source/RPC graph and consumer lifecycle paths above were directly inspected.
The source files `dataQuality.ts`, `alerts.ts`, `purge-test-data.sql` and the
test-delete migration were read completely; large generated schema and wider UI
modules were read only in the named, relevant definitions/sections.

No tests or DML were run: this is read-only evidence collection with no fixes.
No security exploitation claim, performance conclusion, or full-database clean
claim is made. Companion SQL has not been independently executed by this scoped
reviewer; live results must remain attached to the root's exact queries.
