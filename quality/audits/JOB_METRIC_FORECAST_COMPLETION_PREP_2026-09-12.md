# Queued Task17b preparation: metric and forecast coverage / truthful completion

Date: 2026-09-12. Source base: `d731b76dd3dbd027cbbea4ebaf81d92faeeece73`. Read-only prep; no implementation authorization or native acceptance is implied. AGENTS and relevant authentication/security/database/current memory were read. The active API author's files and all earlier evidence were preserved.

**Disposition: ready for a bounded Task17b application author after Task17a is reviewed/rebased; durable deadline/resume and native acceptance remain separately gated.** The complete current customer/owner metrics and forecast receiver chains confirm missing continuation and ignored ordinary I/O errors. Fifteen tiny actual-source probes close the remaining error/receiver uncertainty. No old eight scale cases were repeated, no service/provider/database was contacted, and no production volume, deployed PostgREST cap, or exploit claim is made.

## Finite scope and causal paths

Task17 at `quality/plans/2026-09-12-current-and-plan77-85.md:60-61` assigns sum/distinct completeness and four-driver company failure isolation to 17a; 17b owns the remaining builders and forecast coverage/write semantics. The native/scale contract at `quality/audits/JOB_NATIVE_AND_SCALE_CONTRACT_2026-09-12.md:145-161` explicitly leaves these paths pending.

The monthly cron's real auth and existing company iterator lead through `app/api/cron/analytics/monthly/route.ts:9-16` to `buildCompanyMonthlyMetrics:43-117`, which persists its own summary and then awaits all three child builders. The forecast cron uses `app/api/cron/forecast/run/route.ts:9-20` → `runCompanyForecast:110-124` → checked creation of a new running run (`forecastRuns.ts:8-33`) → point generation → real point calculator → actual/history/profile/issue receivers → item insert → completion update → monthly metrics. Platform analytics actions also call these same helpers (`app/admin/platform/analytics/actions.ts`); changing the receiver's error behavior reaches both drivers. This assessment does not replace those actions' platform guard.

| Finding | Exact receiver / causal result | Disposition |
|---|---|---|
| Customer identity coverage | `monthlyMetricsBuilder.ts:119-155` selects company customers once with `limit(5000)` at124, no order/cursor, and writes only returned identities. | Confirmed source omission, medium data completeness severity; volume exposure conditional. No top-N contract in this builder. |
| Owner identity coverage | Same file186-200 selects `grid_owners.eq(company_id).limit(1000)` with no continuation. A valid shared/null-company owner with an A metering point is omitted even with tiny input. | Confirmed omission, medium. Shared master data is deliberate (`20260902100000...:17-37`); never “fix” by rejecting/tenant-stamping shared owners. |
| Metric child write errors | Customer upsert141-153 and four-zone upsert170-182 discard errors; owner lookup229-235 discards errors, then owner update238 or insert240 also discards errors. | Confirmed medium reliability/integrity defect: ordinary failed writes produce monthly cron `ok:true`. Lookup failure becomes apparent absence and an insert attempt; an existing-row uniqueness error is then also swallowed. |
| Forecast point coverage | `forecastRuns.ts:43-54` takes one company/active-status response, `limit(10000)`, with no order/cursor. Only returned points get items, then completion is attempted. | Confirmed source omission, medium; no large-volume execution here. |
| Current actual coverage and read errors | `forecastRuns.ts:63-73` reads a single company/point/[start,end) response and ignores its error; `actualRows ?? []` reduces it to zero. | Confirmed medium: actual20 becomes actual0, forecast10 remains10, diff becomes−10, item persists and cron reports success. Missing continuation independently affects non-error totals. |
| Historical forecast coverage | `meteringPointForecast.ts:52-67` has the same single-response sum; used by previous-year-month90, previous12months97, previous3months104. | Confirmed source omission, medium; fixing current actual alone leaves forecast basis incomplete. Ordinary historical read errors already throw (61-64), unlike current actual. |
| Annual-estimate default profile error | `consumptionProfiles.ts:7-17` ignores default-profile lookup error and returns uniform weight. Calculator109-119 then persists an annual estimate. | Confirmed medium: valid weight10% would give120 from annual1200; injected default read failure gives approximately100 and a completed successful run. The intentional one-default `limit(1)` is not a coverage defect. |
| Missing-basis issue write error | `meteringPointForecast.ts:40-50,123-124` ignores issue upsert error; forecast item still carries null forecast and missing count. | Confirmed medium: cron reports success/missing1 although the intended issue was not persisted. Missing basis itself is a legitimate quality result, not automatically a failed forecast. |
| Completion write ignored | `forecastRuns.ts:100-104` checks neither error nor changed-row cardinality;106-107 then rebuilds metrics and returns. | Confirmed medium: injected completion error leaves persisted run `running` while real cron returns `ok:true`. A zero-row successful update is a source-visible additional boundary, not separately executed. |
| Failure/run-state ordering | Item insert96 and ordinary history read63 throw, with no run failure transition. Completion update precedes monthly rebuild106; checked company-metric failure throws while run remains completed. | Confirmed state observations. Define whether completed means items only or the entire orchestration before changing order/status. The latter case alone is not proof that an items-only completion contract is violated. |

All sums/counts feeding customer, zone and owner metrics remain company-scoped, with existing dimension and applicable month predicates. Owner update uses the id obtained from the company/owner/month lookup; its id-only form is not independently proven cross-company authority loss. The probe includes a foreign-B metering row, which does not enter A forecast actuals. This is not an exhaustive tenant authorization test.

## Minimal proof and exact results

Run from repository root:

```sh
node .superpowers/sdd/2026-09-12-current-and-plan77-85/task-17b-prep-proof.mjs
```

Final run exit0, **15/15 passed**. The proof loads and executes all eight actual complete TS modules named in its emitted hash manifest, stripping types/import bindings in Node and wiring only terminal synthetic DB/Next response/environment I/O. Real cron authorization receives a dummy secret; actual company iterator, arithmetic, receiver queries and control flow execute. It uses one company/customer/point, one local and one shared owner, history10/current20 and a filtered foreign999 row. It imposes no response cap. Its small query adapter supports only reached predicates and does not model RLS, triggers, physical persistence, transactions, concurrency, ordering stability or PostgREST. The modeled owner23505 response is error propagation evidence, not SQL-native uniqueness execution. Node emitted its experimental type-strip warning; this is a dependency-free characterization probe, not the supported project test gate.

| Cases | Exact observations |
|---|---|
| 1–5 customer-write-error; zone-write-error; owner-insert-error; owner-update-error; owner-lookup-error-becomes-insert | Each real monthly route returns `ok:true, companies:1`; lookup failure additionally reaches insert, whose modeled existing-identity error is swallowed. |
| 6 company-write-error-control | Actual top-level company metric error propagates. |
| 7 shared-owner-coverage | A point belongs to a valid shared owner; the actual owner builder never produces that owner's metric. |
| 8 forecast-positive | Real forecast route succeeds, run completed, forecast10/actual20. |
| 9 forecast-actual-read-error | Succeeds/completed, forecast10/actual0/diff−10. |
| 10 forecast-completion-write-error | Succeeds, persisted run still running. |
| 11 forecast-profile-read-error | Succeeds/completed with approximately100 annual forecast instead of valid120. |
| 12 forecast-missing-basis-write-error | Succeeds/completed, forecast null, missing1, no saved DQ issue. |
| 13 forecast-item-error-control | Error propagates; run remains running. |
| 14 forecast-history-error-control | Error propagates; run remains running. |
| 15 forecast-metrics-error-after-completion | Error propagates; run has already become completed. |

The proof asserts current failures intentionally. Future permanent regression tests must invert the defect assertions and exercise normal/negative controls. No additional full-cap cases were needed to establish the already visible single-response selection paths.

## Concrete queued author brief

1. After 17a, re-read/rebase `lib/analytics/monthlyMetricsBuilder.ts` and reuse its reviewed complete paging/sum mechanism. Own customer/owner identity continuation and child I/O errors, not another implementation of 17a sums/counts or driver isolation. Primary remaining receivers are this file plus `lib/forecasting/forecastRuns.ts`, `lib/forecasting/meteringPointForecast.ts`, and `lib/forecasting/consumptionProfiles.ts`. Coordinate any caller/type changes with 17a.
2. Use deterministic bounded ID pages for customer/point/owner identities, with continuation until exhaustion and error propagation for every page. Preserve company, active-status, dimension and UTC half-open period filters. An existing page size200 pattern is available in `lib/analytics/cron.ts`; do not assume a deployed maximum or infer exhaustion from a request above the supported response limit. Cover valid local/shared owners while excluding foreign-private owners; keep fact aggregation scoped to the target company. Decide explicitly whether owner enumeration includes all shared identities or only shared identities referenced by target-company facts; neither may drop a valid referenced shared owner.
3. Check all customer/zone/owner write responses and the owner existence lookup. An ordinary read error is not absence. Preserve customer(company,customer,month), zone(company,zone,month), and company(company,month) identities. The owner identity is an **expression unique index**, `(company_id, coalesce(grid_owner_id, zero UUID), month)` (`20260531160000...:247-248`); do not blindly use an unsupported `onConflict: company_id,grid_owner_id,month`. Existing uniqueness prevents duplicate owner rows, so the present check/insert race is a possible rejected/lost write, not proven duplicate creation. If concurrency retry is chosen, verify its real unique-conflict path.
4. Make both current and all historical per-point actual sums complete and error-aware. Preserve `quantity_kwh ?? value_kwh`, existing forecast branch precedence, fixed history divisors/confidence scores, profile selection/weights and active-day adjustment. Current `Number(...)` differs from history's finite `asNumber(...)`; normalize only with an explicit reviewed compatibility decision. Do not silently redesign the forecast model.
5. Surface ordinary profile read and missing-basis issue write failures. Preserve intentional successful no-basis/null-forecast handling and the valid global/company profile fallback. Existing missing-table/schema-cache compatibility fallbacks in metrics/history/weight helpers return zero, skip, or uniform weight; explicitly decide their retained compatibility/partial outcome rather than silently treating arbitrary failures as no data or deleting compatibility behavior.
6. Define the durable unit covered by `completed`. Recommended bounded meaning for this orchestrator is that all selected points, required issue/item writes and the required metric rebuild have succeeded; if metrics are a separate projection, return/report that separation explicitly instead. Check final update error **and exactly one target row**, preserve company and intended run state, and do not claim success if completion fails. On a checked intermediate failure, avoid a forever-running success appearance: any failure-state attempt must itself be checked and must not erase the original error or claim durable failure when that write also fails. This does not make the multiple existing awaits atomic; partial rows already written remain possible.
7. Keep public outcomes compatible with 17a's per-company results and explicit failure continuation. Do not convert a partial customer/owner build into successful coverage, or an error into a zero observation. Source-level metrics tests and full actual receiver tests are required; native persistence/identity gates remain required separately below.

Required author acceptance should include stable multi-page5001 customers/1001 owners/10001 points under an explicitly modeled1000-response boundary; a point with1001 current and historical actual rows; boundary/empty pages; late-page read error; child writes/owner lookup/duplicate conflict; current/history/profile/DQ/item/completion error; completion zero rows; positive all-writes success; two-company and exact period isolation; referenced shared owner and foreign-private owner negatives. Preserve zero forecasts, valid null basis/missing counts, and intentional profile/default absence. These are queued acceptance requirements, **not runs performed in this prep**. Use real production functions rather than pasted replacement loops. Verify native replay/cardinality behavior before making persistence claims.

## Refuted, preserved, and explicit limits

- The eight contract probes already close 17a's sum/distinct, reconciliation enumeration, count-head control and four-driver abort cases. They were not rerun. Existing analytics company ID paging and billing monthly failure isolation remain closed.
- `countRows:10-18` uses exact count/head; the four Swedish zones at158 are a finite domain. Neither is a cap defect. `consumptionProfiles:13` intentionally selects one default; overview owner `limit(6)` (`analytics/db.ts:180-181`) is a displayed ranking. DQ sample limits remain bounded scans (`analytics/dataQuality.ts`), not newly asserted exhaustive work.
- Company-metric writes, forecast run creation, item inserts, metering-point reads and ordinary historical/explicit-weight errors already check errors. The claim that all forecast errors are swallowed is refuted.
- Shared owners are deliberate master data. `monthlyMetricsBuilder.ts:206,222` also copies company-wide open missing-metering issue counts into each owner's row without an owner or period predicate. This is a source-confirmed attribution ambiguity requiring a separate definition/disposition; do not silently invent an issue-to-owner mapping during paging/error work.
- Report readers are distinct: customer and forecast CSV reads in `analytics/db.ts:420-439` retain limits, owner label lookups at184/353/463 remain company-equality based, and latest-forecast consumers195ff/281ff choose newest run without a completed-state filter and read one items response. Builder remediation alone cannot certify report completeness, shared-owner labels or hiding partial runs. Preserve existing labels and track these bounded consumer decisions separately.
- Durable deadline/resume is **not ready to implement** from this assessment: each `runCompanyForecast` creates a fresh run; the run/item tables have PKs but no run+point natural unique key (`20260531160000...:351-386`; schema inventory below). There is no persisted point/company cursor or approved finite deployment budget. Existing monthly metrics sum forecast items for the month across runs (`monthlyMetricsBuilder.ts:77,137,166,209`), whereas UI selects a latest run. Select replay/new-run/metric inclusion semantics and a run/unit/storage identity before adding retries/resume; do not add guessed schema or claim replay safety. Removing caps alone does not prove one scheduled invocation finishes.
- `supabase/config.toml:18` is local `max_rows=1000` configuration. Neither this source nor this proof establishes deployed PostgREST behavior, actual data volume, runtime lifetime or a production incident.

## Actual-policy/native admission required before persistence acceptance

Reuse the owned PG17 and real-source adapter contract in `JOB_NATIVE_AND_SCALE_CONTRACT_2026-09-12.md:10-104`; this prep did not create a server or complete its source closure. Pin exact authoritative table/column/index/FK/trigger/ACL definitions for companies/customers/sites/points/metering values/requests/profiles/weights/DQ/monthly metrics/forecast runs/items and every reached policy helper. Preserve per-await autocommit, real result/error and changed-row behavior: wrapping the orchestration in one fixture transaction would invent rollback absent in production.

The original analytics migration provides metric identities185-267, profile/shared definitions269-289, run/item definitions351-386, indexes457-462 and initial real-function RLS466-510. Later `20260814162500...:16-126,131-172` installs actual membership/session/lifecycle functions and restrictive policies. The shared-owner correction `20260902100000...:17-37` matters. Dynamic composite customer/company keys in `20260902095000...:30-122` must be resolved for the actual admitted table set, not inferred only from the old single FK. `supabase/schema.sql` is a supplemental current inventory, not replacement migration provenance: owner expression unique at75427; forecast-item PK70438 and FKs88108-88122; nonunique item indexes79564ff. In particular, a run FK by id is not a run+company composite identity, and the customer composite key is not a permission check.

Native worker tests must use the real service-role privileges/BYPASSRLS semantics and retain explicit company predicates; a superuser worker or a fabricated `allow=true` policy would hide the application boundary. Separate authenticated A/B, inactive membership/session, tenant lifecycle and shared-master-data controls must install the current actual functions, policies, ownership/search paths and grants. No claim of native permission enforcement is available from synthetic terminal I/O. The current-helper/latest-policy provenance and dynamic FK/trigger closure must pass before the fixture is admitted. Plain owned Postgres can establish writes, uniqueness, foreign keys, RLS and interleavings; only a separately authorized actual PostgREST test can establish its response cap. No deployment/native gate is waived by this report.

## Frozen evidence manifest

All following20 source/contract files were SHA-256 hashed and independently byte-compared with `git show d731b76dd3dbd027cbbea4ebaf81d92faeeece73:<path>`; all matched. Production sources were read only. The proof SHA-256 is `4aab8535ce70847fee085a8c5ef03d113d6783f4e093d9fde7719af1ed623f7c`. No permanent tests, SQL, workflow, memory, Git/index or API-author files were edited.

```text
2364e32210fa22372ff61d4cfa23b03befcc5131d2f975642efb9b0d02ecb8d5  AGENTS.md
8896888c79b43d9c78553889268f8eef9303799cc5ad365bdd7d22dde5512989  quality/plans/2026-09-12-current-and-plan77-85.md
ff86fe56575f653e1707e4351599f69b8260f8c44c767f5b2d239c51af905ab7  quality/audits/JOB_NATIVE_AND_SCALE_CONTRACT_2026-09-12.md
ede7fe28b5988947ea8de8acc2fb3bbafbb3ab73bc81e028dc287e12a199c0e6  lib/analytics/monthlyMetricsBuilder.ts
07f67b39ef5f8acb0d7ee6505f0ecf1d5ce214a357765bacebfeed1ff539ebe4  lib/forecasting/forecastRuns.ts
2d2ef2611149b83e1baf549873eac24657f78601524b5c805eaccf99ee990eea  lib/forecasting/meteringPointForecast.ts
594419d90bb9c081c1164dc365a27da507ea3274e0a97ec3dde431ecca3f4e83  lib/forecasting/consumptionProfiles.ts
4a7bb64e1e50b373ba1855a0614f691e32b4942e1468765cef57ff0f8ef04eea  lib/analytics/utils.ts
954d015bfaffe27c2b493fb0475663219d4251e1edaa495ffe0db8428558bfb8  lib/analytics/cron.ts
bb13c243e88435e1624a588dfa22447adeee7a121d802d8425e59ad86324054b  app/api/cron/analytics/monthly/route.ts
66ad46f2d4a5cdafa77a7aaed6b115f871d69c432286bab444171b28158f1186  app/api/cron/forecast/run/route.ts
7a64148fde060861d88c3e0d8c563357a2f1b51f4d8f2951efb40a19cfb98776  app/admin/platform/analytics/actions.ts
59cdadfcfd838043de6c3619e009b9bc370e57c39697032fa80d7453fdff1b42  lib/analytics/db.ts
79a968cd72d3e93b0805fbc324947e43872bb98c66a86ba451c8a96ac450ec2b  lib/analytics/dataQuality.ts
b70b0dc8885304790bb5f0b019c7a5b83e4f48f23d7cf1bc2e4b859e913e0919  supabase/config.toml
30e46181444b9fac718d1445356cb26b61c84886fc7a0d644428627e04b035ef  supabase/migrations/20260531160000_analytics_forecasting_module.sql
9753cd0f10a120a32826286a0eeb08d6f7e2b51704014decf60243e5eaa1a919  supabase/migrations/20260902100000_rpc_surface_and_permission_scope_corrections.sql
e2eee5be4e4c795380782248683bfd32b682a66b2e2882a1fd241c9acc7498b2  supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql
bd3e79d2dab7f3332487b6259e595a258c413c288d073c63c5163555f7cd9c38  supabase/migrations/20260902095000_lock_customer_chain_with_composite_keys.sql
b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30  supabase/schema.sql
```
