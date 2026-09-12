# Point 85: scheduled-job evidence review, 2026-09-12

All **21 entries in `vercel.json`** were traced through their route and worker orchestration. Two additional defects were reproduced by executing actual TypeScript modules against synthetic in-memory dependencies. **No native database, provider, deployed cron, concurrency, or load test was executed. This is not point-85 completion.**

Baseline: the published inventory `quality/audits/PLAN_77_85_SURFACE_INVENTORY_2026-09-12.json` and the source reviewed for the parent audit at `41786027`. Parent changes and hosted results are independent evidence; this report does not certify their later revisions. The parent already owns monthly-company failure isolation and the stale cron-regression facade reference, recorded in `api-jobs-audit.md`; neither was reimplemented here.

Skill routing follows the parent audit: source acquisition, code review, bug finding, false-positive checking, variant analysis, tenant/security review, performance/observability, and verification boundaries apply. This subtask supplies bounded evidence to that workflow. No UI, deployment, hooks, dependency installation, scanners, or provider operations were appropriate for this read-only assignment. No application, migration, workflow, or memory files were changed by this task.

## Evidence legend and coverage boundary

**S** = supported by inspected source; **R** = newly reproduced with the actual module and fake dependencies; **T** = relevant existing test source identified, not newly executed here; **U** = runtime/native or deeper leaf behavior remains unverified. A source lock, retry, or idempotency key is not proof of its behavior under concurrency or a provider outage. “No budget” means no end-to-end deadline/resume budget found in the reviewed route/worker, not a claim about deployment limits. “No cursor” means no continuation in that path; a draining queue can progress without a pagination cursor.

All route files are `app` + the path below, without its query string, + `/route.ts`. Routes use configured secret authentication, including constant-time comparison; a scheduling header alone is not authority. Company-less service workers intentionally process eligible tenants or shared platform data. Authorization of the scheduler is distinct from authorization and attribution of each job. Production is explicit on the two mailbox schedules; the general Ediel outbox path does not itself specify an environment.

Every route and its principal orchestration path was read. This does **not** mean every transitive provider adapter, ingestion parser, report query, side worker, or SQL function body was completely audited. Limits below describe source-selected rows, not a measured PostgREST ceiling. The SQL authority notes identify the claim/lock definitions actually checked; remaining leaf and schema gates are explicit.

## Scheduling, lock, scope, concurrency, pagination, tenant fairness

Schedules are the literal expressions in `vercel.json`; no deployment-time or timezone execution was observed.

| # | Scheduled path; schedule | Actual worker path under `lib/` | Lock, scope, concurrency | Pagination, batch/cap, tenant fairness |
|---|---|---|---|---|
| 1 | `/api/internal/inbound-mail/cron?environment=production`; `0-55/5 * * * *` | `inbound-mail/edielMailboxPoller.part-1.ts`, `.part-2.ts`, `.part-3.ts` via facade | S: shared configured mailboxes; mailbox CAS/stale 30m; mailbox concurrency default 3; queued processing claim RPC with schema fallback | S: due mailbox batch default 10, 25 messages/mailbox; queued jobs 50, Ediel message processing concurrency 4, customer jobs default 20. No durable scheduler cursor or proven fairness across mailboxes/companies. U: complete ingestion/dedup leaf behavior |
| 2 | `/api/ediel/outbox/process`; `1-56/5 * * * *` | `ediel/outbox/processEdielOutbox.ts`, `claimOutboxItems.ts`, `sendOutboxItem.ts` | S: atomic SKIP LOCKED claim, worker/current-send-attempt ownership, canonical send lock; sequential sends; global eligible queue, per-item tenant policy | S: bounded claim up to 100, priority then creation order; drains queue, no per-tenant fairness. Batch claimed before sequential transport; lease versus final-item latency U |
| 3 | `/api/internal/email/outbox/process`; `2-57/5 * * * *` | `email/emailOutbox.ts` | S: per-row queued→processing CAS and random token; sequential; tenant decision before claim and before send | S: due FIFO candidates, default 25/max 100; global candidate window, no per-tenant fairness/cursor |
| 4 | `/api/internal/manual-email/outbox/process`; `3-58/5 * * * *` | `email/manualEmailOutbox.ts` | S: queued→sending CAS and worker identity; sequential, per-row tenant decisions. **R: failure branch can mutate without ownership** | S: default 25/max 100; fetch up to limit×10/max 1000, round-robin by company within that candidate window only; no fairness guarantee outside window |
| 5 | `/api/internal/manual-inbound/cron?environment=production`; `4-59/5 * * * *` | `inbound-mail/manualMailboxPoller.ts` | S: active/verified mailboxes, CAS stale 30m; sequential mailbox processing | S: mailbox selection has no pagination/batch limit; default 25 messages/mailbox, configurable; interval default 5m; no mailbox/company fairness cursor |
| 6 | `/api/cron/pricing/spot-prices`; `15 * * * *` | `pricing/spot/spotImportScheduler.ts`, `spotPriceImporter.ts`, `spotImportJobs.ts` | S: shared market data, company override prohibited; provider/area/day claim with advisory transaction lock and row lock; sequential | S: yesterday/today and eligible tomorrow × four areas; bounded date plan, no tenant dimension or continuation |
| 7 | `/api/cron/pricing/spot-settlement`; `35 3 * * *` | Same import worker plus `pricing/spot/settlementLocker.ts` | S: shared month/day imports; same daily claims; settlement completeness checked before lock RPC | S: month days × four areas, sequential; bounded calendar work but no time budget/cursor |
| 8 | `/api/cron/ediel/actor-readiness?mode=full`; `25 2 * * *` | `ediel/certificates/scheduledRefreshRecovery.ts`, `ediel/operations/actorAutoReadiness.ts` | S: global actor/certificate readiness; stale-running recovery and live-lease check; sequential recovery candidates. U: atomicity inside refresh/provider leaves | S: recovery candidate overfetch then dedup, up to 50 actor/grid-owner pairs; full mode also backfills, syncs certificates, refreshes route profiles (cap 1000), applies readiness; no durable overall cursor |
| 9 | `/api/internal/webhooks/dispatch`; `0-55/5 * * * *` | `events/domainEvents.ts`, `integrations/webhooks.ts`, `webhookVaultSecrets.ts` | S: fanout CAS; dispatch CAS with random batch worker; company/tenant decisions; sequential HTTP sends, Vault cleanup in finally | S: fanout then dispatch default 25/max 100, oldest/due order; no tenant fairness; candidate queues drain on successful completion |
| 10 | `/api/internal/customer-operations/cron`; `1-56/5 * * * *` | `customer-operations/automation.part-3.ts` and route's address/reconciliation/watchdog/lookup/PoA/activation workers | S: principal job claim SKIP LOCKED, UUID token, heartbeat timestamp, stale 15m; concurrency default 3; tenant lifecycle checked in latest claim SQL | S: principal claim up to 100, priority/run-after/creation order. Route stages bounded separately: address ≤5, reconciliations ≤100, jobs default 20/max100, watchdog ≤100, lookup/resume ≤25, PoA100, activation≤50. No per-tenant fairness; side-worker leaves U |
| 11 | `/api/internal/system/health`; `35 2 * * *` | `ops/health.ts` | S: read-only global health RPC; no mutating queue lock necessary | S: one aggregate call with v5→v4→v3 schema-only fallback. U: database query cost/complete aggregation scope |
| 12 | `/api/internal/platform/grid-areas/import/cron`; `2-52/10 * * * *` | `energy/svkGeometryImport.ts` | S: shared geometry import; route resumes existing run or creates run; **no route-level atomic claim observed**; native stage/promote concurrency U | S: 250-row pages ordered by OBJECTID; run/version next offset persisted; first reconcile recent failed runs, then resume oldest running run; 30-day freshness skip |
| 13 | `/api/cron/billing/monthly`; `20 */6 * * *` | `billing/monthlyAutomation.ts`, `automation/locks.ts` | S: per-company/month lock 6h, token release; sequential companies; operational company/configuration/actor checks | S: ordered company pages of 200. Parent finding P85-TENANT-001: pre-inner-catch failures can abort later companies; parent remediation tracked separately |
| 14 | `/api/cron/billing/invoice-export-retry`; `8-53/15 * * * *` | `billing/invoiceApprovedDispatch.ts`, `billing/providerEventProcessor.ts` | S: per-approved-invoice 2h automation lock; explicit prior approval; sequential sends. Provider event RPC claims token and SKIP LOCKED | S: due export retries default50/max200; provider fresh events200 plus review50; event ordering by received/id, no tenant fairness or overall continuation budget |
| 15 | `/api/cron/analytics/daily`; `45 3 * * *` | `analytics/cron.ts`, `monthlyMetricsBuilder.ts`, `dataQuality.ts`, `alerts.ts` | S: sequential companies, parallel metric queries inside company, no job lock; tenant-filtered worker queries | **R:** first1000 companies only, no order/cursor. Customer/owner/scan sublimits also require scale gates; no company fairness guarantee |
| 16 | `/api/cron/analytics/monthly`; `50 4 1 * *` | `analytics/cron.ts`, `monthlyMetricsBuilder.ts` | S: same company driver, company/month upsert, no job lock | **R:** same first1000/no continuation; customer5000/owner1000 sublimits; no company fairness guarantee |
| 17 | `/api/cron/forecast/run`; `5 4 * * 1` | `analytics/cron.ts`, `forecasting/forecastRuns.ts` | S: sequential companies and points; creates forecast run record; no exclusive claim observed | **R:** same first1000 companies. S: point limit10000, no point cursor; persisted items/run status are not a resumption protocol |
| 18 | `/api/cron/data-quality/scan`; `25 3 * * *` | `analytics/cron.ts`, `analytics/dataQuality.ts` | S: sequential companies and bounded scans; tenant-filtered queries; no job lock | **R:** same first1000 companies. S: point/customer limits5000, invalid values1000, some event/request/deviation scans500; no continuation |
| 19 | `/api/cron/reconciliation/daily`; `10 5 * * *` | `ops/reconciliation.ts`, `automation/locks.ts` and route's canonical reconciliation RPC | S: 1h automation lock keyed company or `all`; seven application checks in parallel, company RPC concurrency4 | S: company enumeration ordered id but unpaged; individual RPC results include errors; no overall cursor. U: overlap of `all` and company-specific lock scopes |
| 20 | `/api/cron/reconciliation/end-to-end`; `30 5 * * *` | Route → `gridex_run_end_to_end_reconciliation`, `automation/locks.ts` | S: 1h lock keyed company or `all`; canonical RPC, nullable company is deliberate | S: no route-level batch/cursor; SQL resolves/upserts findings. U: database cost, complete check bodies and overlapping lock scopes |
| 21 | `/api/internal/tenant-provisioning/cron`; `7-57/10 * * * *` | `tenant/provisioningWorker.ts` | S: SKIP LOCKED claim, UUID lease token, active/onboarding plus operation-policy gate; completion token/status checked | S: default20/max100, `Promise.all` concurrency equals claimed batch; available/created order; no per-tenant fairness. Default lease300s, bounded30–3600s; no periodic heartbeat observed |

## Retry, backoff, progress, budget, idempotency, recovery, observability

| # | Retry/cap/backoff and stale recovery | Progress, idempotency, observability and budget |
|---|---|---|
| 1 | S: due intervals, stale mailbox unlock, queued-job claim/retry state. U: complete retry exhaustion behavior of all ingestion leaves | S: mailbox/run counters, errors and timestamps; some log writes intentionally tolerate failure; pipeline stage results. No end-to-end deadline/resume budget; canonical ingestion dedup/concurrent recovery U |
| 2 | S: stale sending after10m→delivery_uncertain, not automatic replay; failed send is terminal for this claim path (only prepared/queued claimed) | S: canonical already-sent guard, current attempt/worker fencing, provider-accepted persistence failure→uncertain, source projections and errors; no total deadline/heartbeat. Provider duplicate behavior U |
| 3 | S: stale processing15m→uncertain; attempts default5, quadratic5m×attempt² capped60m, then dead-letter | S: provider idempotency key; normal status writes filter processing/token but do not assert affected-row count; some blocked/uncertain helpers have weaker fencing. No total budget; native interleaving tests needed |
| 4 | S: stale sending15m→uncertain, linked-request recovery; max5, 5m exponential capped12h; recipient/reserved-sender/frozen failures permanent | S: provider key; sent and provider-accepted uncertain writes check worker/status and returned row; linked projection failures do not resend. **R:** ordinary catch lacks ownership. Summary counters/errors; no total budget |
| 5 | S: failed ingestion remains unseen for next poll; success marks Seen; interval retry, no worker attempt ceiling; finally releases IMAP lock/logout | S: mailbox timestamps/errors; completion update filters mailbox id only, so stale-owner race needs a native/mock interleaving test. No total budget or durable message cursor; ingestion uniqueness U |
| 6 | S: max5 import attempts,15m exponential capped6h, provider Retry-After support, unpublished data retry1h, stale-running reclaim15m | S: canonical provider/area/day job, correlation id, interval coverage and upserts; immutable locked days guarded. No total budget; finalization fencing/provider timeout behavior U |
| 7 | S: uses same daily retry policy; only complete coverage eligible for monthly settlement locking | S: month run/completeness summary and lock RPC; rerun convergence depends on canonical SQL and data constraints. No total budget; native incomplete-month/overlap proof required |
| 8 | S: stale-running30m marked failed; duplicate actor/grid-owner recovery candidates deduped; per-candidate failure isolation; live lease skipped | S: returned recovery successes/errors and route summary. T: scheduled-certificate-refresh-recovery tests mocked outcomes. No overall cursor/time budget; inner provider timeout/concurrent lease gate U |
| 9 | S: fanout quadratic30s×attempt² capped1h, row max default12→dead-letter; stale fanout15m requeued. Dispatch retries5m/30m/2h/6h, row max; stale dispatch15m→uncertain | S: delivery id, HMAC/body hash, CAS normal finalization checks ownership; provider-accepted uncertainty handling; per-subscription HTTP timeout; no total budget. Fanout and some uncertain helper fencing variants U; signatures are not universal provider dedup |
| 10 | S: stale/exhausted jobs terminalized by latest claim SQL; per-job retries/terminal errors and token-checked updates | S: job status, initial heartbeat, operation events/terminal context/idempotency. No demonstrated periodic heartbeat or whole-route deadline; earlier route-stage error can skip later stages. T: static cron regression currently has parent-owned stale facade issue |
| 11 | S: compatibility fallback only for missing schema; no stateful retry queue needed | S: blocking health→HTTP503, warning/ok→200; missing supported schema blocks. Runtime aggregate and alert delivery U; no mutation/progress budget needed |
| 12 | S: failed reconciliation prioritized without discarding already promoted data; stale source version failed and clean restart; resumable running import | S: staged page offset, run/version counters, completion/promotion/reconciliation; fetch timeout25s and circuit control. Per-page work bounded; overlapping invocations and stage/promote idempotency native U |
| 13 | S: rerun/company-month lock and canonical period guard, prepare-only, no auto-export | S: period/run/audit evidence; no total deadline/heartbeat. Parent owns failure-isolation regression/fix; no new completion claim here |
| 14 | S: export max6,15m exponential capped24h; provider-error classification separates terminal/review/retry. Provider events reclaim processing after15m, attempts increment, no comparable SQL max-attempt/backoff gate observed | S: stable invoice provider key, item/attempt/event histories and explicit approval; provider event token claim; no overall budget. Provider acceptance followed by persistence/purchase failure and repeatedly unmatched review events require fault/convergence tests |
| 15 | S: next scheduled scan is implicit retry; no per-company failure isolation in driver | S: company/month metric upsert, issue/alert updates, route counters; no durable run cursor/deadline. Duplicate scan upserts are source controls, complete recalculation/alert idempotency U |
| 16 | S: next invocation repeats month build; driver stops on thrown company failure | S: company/month upsert; no durable overall progress/cursor/deadline. Child upsert errors and raw-row sum completeness need tests |
| 17 | S: no automatic run-resumption or terminalization catch around full point loop observed | S: new run and item records, final completion update; no durable point continuation/deadline. Duplicate runs may be intended snapshots, not classified as a defect without contract evidence |
| 18 | S: next schedule repeats scans, driver stops on thrown company failure | S: issues upsert and company summary; no durable overall progress/deadline; limited scans can be partial, not full integrity proof |
| 19 | S: finally releases matching lock token; expired locks can be reacquired; no heartbeat | S: application checks plus per-company canonical result/error summaries; no overall deadline/cursor. A top-level successful response can contain per-company errors; monitoring interpretation U |
| 20 | S: same token release/TTL expiration model | S: persistent reconciliation findings and route error/trace response; no route budget/cursor/heartbeat. Native repeated-run convergence and lock duration U |
| 21 | S: stale lease→retry or dead-letter at row max; retry30s exponential capped1h; completion token/status checked; dead-letter history preserved by wrapper | S: job status/idempotency key, invite/provider state, readiness snapshot, per-job outcome summary. External invite convergence and completion RPC failure during Promise.all U; no global deadline/heartbeat |

## Newly reproduced findings

### P85-LEASE-002 — High: unclaimed manual-email worker can overwrite another lease

Affected complete path: `app/api/internal/manual-email/outbox/process/route.ts` → `lib/email/manualEmailOutbox.ts::processManualEmailOutbox`.

The per-row `try` starts before `getTenantOperationDecision` and before the queued→sending claim. Its ordinary `catch` updates the row by only `company_id` and `id`, increments attempts, sets queued/failed, and clears `locked_at`/`locked_by`. It does not prove this worker ever claimed the row or still owns it. In contrast, successful and provider-accepted-uncertain finalization already check sending status, worker and returned row.

Actual-module reproduction: select a queued A/email snapshot; before this worker claims it, simulate another worker claiming the persisted row (`status=sending`, `locked_by=OTHER-WORKER`); make this worker's policy lookup throw a transient error. The real function returns `claimed=0`, calls no provider, but its catch requeues the persisted row, clears OTHER-WORKER's lease and increments attempts. The fake DB applies the function's actual filters, not a rewritten copy of its logic. This proves an ownership violation and corrupted retry state; a duplicate provider delivery was **not** observed. Other live-worker or operator states can be overwritten for the same reason, but those variants were not separately executed.

Targeted fix: keep pre-claim failures observational; track acquired ownership; every failure transition must filter expected status and owned worker/token and verify affected row. Never alter a row based only on its stale candidate snapshot. Add actual-worker tests for pre-claim exception, CAS loser, stale owner versus new worker, terminal/sent row race, and provider acceptance followed by local persistence failure. Preserve provider idempotency and uncertainty handling.

### P85-PAGE-003 — Medium: four scheduled analytics drivers omit eligible companies after 1000

Affected complete driver paths: the daily/monthly analytics, forecast and data-quality routes listed as 15–18, all calling `lib/analytics/cron.ts::listAnalyticsCompanyIds`.

The helper issues exactly one eligible-company query with `.limit(1000)`, no ordering and no continuation. All four routes process only that array. On a fixture of 1001 active companies, two invocations of the actual helper both returned the same first1000; company1001 was never returned and there were exactly two queries. A database is not obliged to preserve this unordered subset, but no mechanism ensures eventual coverage. The hard upper bound and absent continuation are definite; the actual deployed eligible-company count and current omission are unknown.

Impact: eligible tenants can indefinitely miss scheduled metrics, alerts, forecasts and data-quality work as scale grows. Targeted fix: stable keyset pagination with explicit company scope, plus a bounded/resumable run driver if total work exceeds an execution budget. Test ≥1001 companies, page boundaries, company failures, and interruption/resume. Pagination must not weaken lifecycle eligibility or tenant-scoped worker queries. The separate per-company row limits need their own contract and completeness tests rather than being silently called complete.

## Other open source risks, false positives and prerequisites

- Parent-owned P85-TENANT-001 and P85-TEST-001 remain referenced, not duplicated. The cron regression's missing strings reside in `customer-operations/automation.part-3.ts`; facade text absence is not missing production telemetry.
- Candidate-window round robin in manual email is a real fairness control, but not global fairness when one tenant fills the oldest1000 candidates. FIFO/priority queues elsewhere similarly lack a demonstrated starvation bound. This is a workload/test gap, not an observed customer incident.
- Weak failure/uncertainty/finish fencing variants exist in tenant email, webhook fanout and mailbox completion. Each needs a complete independent interleaving reproduction before remediation; do not mechanically apply a worker-token field to tables that do not have that ownership model.
- Leasing and atomic claim are distinct from an execution deadline. Ediel batches claimed before sequential sends, provisioning's concurrency equal to its batch, 1h reconciliation locks and imports can outlive stale thresholds under slow dependencies. No native timing proof or deployment-duration assumption was made.
- Geodata's durable offset is positive recovery evidence; lack of a route claim alone does not prove duplicate/corrupt promotion because staging and promotion SQL may provide convergence. Verify that authority before a lock change.
- The spot claim is atomic per provider/area/day, not tenant; these are intentionally shared prices. Paired date claims and immutable settlement controls are not cross-company bugs. Finalization versus stale correlation-id ownership still needs a targeted race test.
- Invoice retries preserve explicit approval and provider keys. Provider-side idempotency, purchase-after-create partial failures and local persistence outcomes must be tested against a synthetic adapter/native fixtures; no real invoice/provider operation was attempted.
- Analytics raw-row sum limits, customer/owner/point caps, forecast interruption state, global company-list pagination in other scanners and provider-event review starvation are remaining completeness/recovery risks. They were not promoted to additional reproduced defects in this bounded pass.
- An all-company reconciliation key and a company-specific key are different locks. Whether their overlap is harmless depends on canonical SQL idempotency/locking; native two-session proof is required.

## SQL authority inspected and native gates

The relevant latest claim definitions were resolved through migration search, rather than treating an old audit or facade as current behavior:

- `20260618200000_ops_production_hardening_resolver_queues.sql`: Ediel claim/stale-send uncertainty; later search-path changes do not replace its queue algorithm.
- `20260819070622_pr164_review_remediation_v2.sql`: customer-operation claim, terminal exhaustion, lifecycle gate and token/heartbeat state.
- `20260724120000_canonical_market_resolution_quote_billing_flow.sql`: `gridex_claim_spot_price_import_job`, transaction advisory lock plus row lock, provider/area/day identity,15m stale default and retry wait.
- `20260810193450_canonical_access_provisioning_runtime_v1.sql` provisioning foundation and `20260810224500_canonical_review_remediation_v1.sql` completion wrapper: claim/status/token/retry/dead-letter controls; the latter preserves failure history.
- `lib/automation/locks.ts` and `20260712100000_gridex_end_to_end_integrity_hardening.sql`: expired-lock cleanup, unique lock key, bounded TTL and token-specific release; no heartbeat protocol. Native lock waits/timeout behavior remains a gate.
- `20260712100000_gridex_end_to_end_integrity_hardening.sql::gridex_claim_invoice_provider_events` was checked for SKIP LOCKED, status filtering, stale15m processing reclaim and attempt increment. Full projection/provider behavior, all reconciliation check bodies and geometry staging/promotion require further native/source evidence before closure.

Necessary isolated PG17 tests: two concurrent claimers, claim losers, stale-reclaim versus old worker completion, token rejection, attempt exhaustion/backoff eligibility, tenant lifecycle transition before claim and before side effect, two-tenant attribution negatives, deterministic queue ordering/fairness fixtures, and rollback/replay/uniqueness of canonical records. Provider acceptance followed by persistence failure must use a fake provider; uncertain delivery must not be automatically replayed. None requires customer reads or a production write.

## Executed verification and reproducibility

Dependency-free Node24 `stripTypeScriptTypes` + `vm` executed the actual `manualEmailOutbox.ts` and `analytics/cron.ts` functions with mocked imports, auth-policy and DB query builders. Both findings reproduced. No dependency installation, Vitest, live DB, HTTP provider, native SQL or scheduled deployment call was performed. These are deterministic control-flow reproductions, not database isolation-level tests.

The following self-contained command preserves the exact essential harness and assertions; execute from repository root. It demonstrates the defects on the audited source. After remediation it should fail its defect-expecting assertions and be replaced by positive regression assertions in the ordinary test suite.

```sh
node --input-type=module <<'NODE'
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
function load(path, names, deps) {
  const source = stripTypeScriptTypes(readFileSync(path, 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm, '')
    .replace(/^export /gm, '');
  const context = vm.createContext({ console, Date, Error, ...deps });
  vm.runInContext(source + '\nglobalThis.probe={' + names.join(',') + '}', context);
  return context.probe;
}
const persisted = { id:'mail-A', company_id:'A', status:'queued',
  external_delivery:true, attempts:0, request_id:null,
  queued_at:'2026-01-01', locked_at:null, locked_by:null };
const snapshot = { ...persisted }, updates = [];
let sends = 0;
const db = { from() {
  let patch = null; const filters = [];
  const q = {
    update(value) { patch=value; return q; }, select() { return q; },
    eq(key,value) { filters.push([key,value]); return q; },
    lt() { return q; }, lte() { return q; }, order() { return q; },
    limit() { return q; },
    then(resolve,reject) {
      let data=[];
      if (patch) {
        if (filters.every(([key,value]) => persisted[key] === value)) {
          Object.assign(persisted,patch); updates.push({patch,filters});
          data=[{...persisted}];
        }
      } else data=[snapshot];
      return Promise.resolve({data,error:null}).then(resolve,reject);
    },
  }; return q;
} };
const manual = load('lib/email/manualEmailOutbox.ts',
  ['processManualEmailOutbox'], {
    randomUUID, supabaseService:db, assertPlatformSchemaReady:async()=>{},
    getEmailProvider:()=>({sendEmail:async()=>{sends++;throw Error('unexpected send');}}),
    getTenantOperationDecision:async()=>{
      persisted.status='sending'; persisted.locked_by='OTHER-WORKER';
      persisted.locked_at=new Date().toISOString();
      throw Error('transient policy RPC outage');
    }, isEdielReservedSender:async()=>false,
  });
const result=await manual.processManualEmailOutbox({companyId:'A',limit:1});
assert.equal(result.claimed,0); assert.equal(sends,0);
assert.equal(persisted.status,'queued'); assert.equal(persisted.locked_by,null);
assert.equal(updates.length,1); assert.equal(updates[0].filters.length,2);
const companies=Array.from({length:1001},(_,i)=>({id:'company-'+(i+1)}));
let requests=0;
const analytics=load('lib/analytics/cron.ts',['listAnalyticsCompanyIds'],{
  supabaseService:{from(){requests++; const q={
    select(){return q;}, in(){return q;},
    limit(n){return Promise.resolve({data:companies.slice(0,n),error:null});},
  }; return q;}},
});
const first=await analytics.listAnalyticsCompanyIds();
const second=await analytics.listAnalyticsCompanyIds();
assert.equal(first.length,1000); assert.equal(second.length,1000);
assert(!first.includes('company-1001')); assert(!second.includes('company-1001'));
assert.equal(requests,2);
console.log('REPRODUCED: unclaimed manual-email failure clears another lease; analytics omits company1001 twice.');
NODE
```

The fake DB intentionally models the rows/filters necessary to demonstrate these branches. It does not emulate PostgreSQL transactions, RLS, provider idempotency or arbitrary Supabase operations.

Relevant existing safe test targets for the normal dependency-equipped quality lane:

```sh
npx vitest run __tests__/vercel-cron-routes.test.ts __tests__/auth-outage-cron-production-safety.test.ts __tests__/scheduled-certificate-refresh-recovery.test.ts __tests__/ediel-send-lock-canonical-boolean.test.ts __tests__/ediel-post-send-source-projection.test.ts __tests__/spot-interval-coverage.test.ts __tests__/spot-settlement-separation.test.ts
```

Coverage limits: route-existence/auth text checks do not invoke 21 complete schedules; the production schedule test checks the two explicit mailbox environments; mocked certificate recovery does not establish two-session exclusion; send/projection tests do not prove real SMTP/HTTP effects; interval/settlement tests are not live settlement replay. Existing historical quality success is useful baseline evidence, not a newly executed jobs85 gate. Parent owns the cron static-regression path correction and monthly-isolation tests.

Next necessary work: first add/fix the manual-email ownership regression; separately implement/test deterministic complete company enumeration with an explicit bounded-driver contract. Then execute the native lease/tenant/replay gates and scale/failure/budget cases for each worker family, retaining per-route results. No blanket closure follows from this matrix.

Report verification: the embedded harness was extracted from this Markdown and executed successfully (exit0), reproducing both defects; `git diff --check` passed. This SDD path is ignored by Git, so the parent must explicitly include it if publishing the evidence. Concurrent parent edits were preserved.
