# Point85: finite ownership variants

2026-09-12. Follow-up to the existing 21-job matrix; this is not a new baseline or a fairness/scale audit. Task7's manual-email and analytics fixes were excluded. Reviewed exactly tenant email, webhook fanout, mailbox completion (manual and Ediel), and spot job finalization, including relevant claim/recovery definitions and actual consumers.

**Twelve deterministic cases passed using actual TypeScript modules and synthetic dependencies. Three interleavings have no stale-lifetime prerequisite: tenant-email pre-claim blocking overwrites a winner; fanout claim reuses a stale candidate before retry is due and loses attempt accounting; supported forced Ediel takeover is cleared by the older poll.** Other cases confirm missing ownership/affected-row checks under an explicit stale-recovery model. Their deployed reachability remains conditional on worker lifetime and recovery/operator behavior. No real provider acceptance, email, HTTP request, IMAP operation, customer read, native SQL or deployed job was executed.

Only this SDD report was added by the task. Its embedded harness was assembled in a temporary file outside the repository. Application, SQL, workflow, memory and index changes belong to other workstreams and were preserved.

## Finite case results

| Case | Executed actual path and interleaving | Result and classification |
|---|---|---|
| TE1 | Two actual `processTenantEmailOutbox` calls both select a queued candidate. First waits in policy lookup; second claims and fake-provider accepts, persists sent; first lookup then denies | First claimed=0, second sent=1; first changes sent→blocked_tenant_state and clears locks. **Confirmed current worker race, no time advance** |
| TE2 | Actual worker claims processing; during fake-provider acceptance, actual stale sweep runs after simulated16m; normal sent CAS then affects zero rows | Canonical row remains uncertain, but result.sent=1 and communication-log sent projection executes. **Confirmed affected-row contract defect; stale runtime reachability conditional** |
| TE3 | Worker has fake-provider acceptance. Before sent persistence returns an injected DB error, actual stale sweep→operator requeue→new claim runs | Old uncertain fallback clears the new claim token and changes it to uncertain. **Confirmed unfenced fallback contract; requires recovery interleaving/lifetime** |
| TE4 | Old claimed row fails after actual stale sweep, operator requeue and new claim | Normal failure CAS affects zero rows and preserves newer processing/token. **Refutes ordinary failure overwrite; affected-row result still unchecked** |
| FO1 | Actual fanout claims; while enqueue is delayed, simulated16m passes; second actual worker sweeps/reclaims/completes; old enqueue then throws | Old id-only catch overwrites newer sent→failed. **Confirmed finalizer contract under stale model; native/lifetime reachability pending** |
| FO2 | First actual worker has queued snapshot; before its claim, second actual worker claims/fails and sets future available_at | First claim still accepts failed despite future available_at; two failed enqueues leave attempts=1. **Confirmed current claim/backoff/accounting race, no time advance** |
| MB1 | Actual manual poll claims; simulated31m later another actual claim replaces it; first poll finishes | First clears second owner; third normal claim succeeds. **Confirmed finish contract under stale model; deployed31m survival unverified** |
| MB2 | Actual Ediel poll with actual claim/finish helpers; same simulated31m reclaim | First clears second owner; third claim succeeds. **Confirmed finish contract under stale model** |
| MB3 | Actual Ediel poll; second actual claim uses supported forceLock=true immediately; first finishes | Third normal claim succeeds although replacement worker still owns its processing interval. **Confirmed supported force-takeover race, no time advance** |
| SP1 | Actual day-area importer claims; during summary read simulated16m passes and actual claim wrapper obtains a new correlation in source-backed SQL model; old importer takes locked-day completion path | Old finalizer sets new claim completed while retaining its new correlation id. **Confirmed unbound finalizer contract; SQL model/deployment lifetime limitations explicit** |
| SP2 | Actual spot claim wrapper renews completed job with force; old fail helper runs with previous attempt count | New correlation's row becomes retry_wait using stale error/attempt-based backoff. **Confirmed fail-helper contract; this call sequence is a helper probe, not a full live worker race** |
| SP3 | Actual provider adapter receives synthetic429/Retry-After960 then success with injected no-wait sleep | Requests16-minute wait despite10s default request timeout. **Refutes “per-request timeout bounds entire job below lease”; does not prove a deployed process survives16m** |

Candidate selection in TE1/TE2/TE3/FO1/FO2 runs through the actual selection logic with status/due predicates. DB reads return snapshots; competing writes update separate persisted fixture state. No case starts the cron with a row excluded by its own initial status predicate and calls that a reachable cron path. Direct helper probes are specifically identified as such.

## Confirmed immediate interleavings and minimal fixes

### JOV-01 — High: tenant-email policy loser can overwrite a completed send

Complete path: `app/api/internal/email/outbox/process/route.ts` → `lib/email/emailOutbox.ts::processTenantEmailOutbox` → `claimRow` → `markOutboxBlockedByTenantState`. The latter writes by only id/company. Claim policy is awaited before queued→processing CAS, so a selected queued snapshot can be stale by the time denial is handled. Another worker may have already completed delivery. TE1 executes both workers, fake provider and real status transitions; first worker never claims, yet overwrites the winner's sent state.

The same blocked helper is also called by `sendTenantEmailOutboxRow` after claim; its expected-state contract must distinguish pre-claim queued candidates from claimed processing rows. Do not remove the second tenant policy check.

Minimal fix: pre-claim blocked write must CAS the candidate's expected queued state and relevant claim/version state; a lost candidate is skipped. Post-claim blocked write must require processing plus the exact owned token. Both return whether they changed a row; a zero-row update must not be recorded as a new blocked transition. Preserve already-sent, cancelled, uncertain and other-worker processing state. Keep tenant id predicates and policy gating. No provider duplicate was demonstrated; confirmed impact is corrupted canonical delivery/lock state and recovery evidence.

Current additional consumers are `sendTenantEmailNow`, called after enqueue by `lib/tenant/emailBranding.ts` and `app/admin/companies/[id]/email-actions.ts`. `app/admin/system-health/actions.ts` calls operator-approved `requeueUncertainTenantEmail`. These consumers matter when testing finalizer changes; no new authorization claim about them is made here.

### JOV-02 — Medium: fanout claim ignores changed retry eligibility and attempt version

Complete worker: `lib/events/domainEvents.ts::processDomainEventWebhookFanout`. Consumers: `/api/internal/webhooks/dispatch` and the synchronous fast path in `emitDomainEvent`/existing-event replay. Worker selection requires queued/failed with available_at due, but claim checks only id and status IN(queued,failed). It also computes attempts from the selected snapshot rather than an atomically updated/current claimed version.

FO2 starts with a valid queued candidate. A second worker claims/fails before first claim, setting a future retry time and attempts1. First still claims immediately, attempts a second fanout and persists attempts1 again. No stale lock, native scheduling assumption or clock advance is needed. This bypasses retry delay and loses retry accounting; it is not evidence that unique delivery rows duplicate.

Minimal fix: claim must validate the selected retry/attempt version and current due eligibility atomically, then return the owned row/version. Either CAS expected status+attempts+availability/version on the UPDATE and require available_at<=claim time, or use a narrow transaction/claim RPC. Compute subsequent attempt accounting from that claimed version. Failed CAS is skipped. A unique per-claim identity is also needed for the finalization issue below; constant `locked_by='webhook_dispatch'` cannot distinguish workers. Do not remove fast-path retry durability.

### JOV-03 — Medium: older Ediel poll releases a forced replacement's lock

Complete path: `app/admin/inbound-mail/actions.ts::runInboundMailEngineAction` passes `forcePoll:true`; `edielMailboxPoller.part-3.ts` resolves `force=input.force??input.forcePoll??false`, eligibility permits a locked mailbox under force, and `pollEdielMailbox` gets `forceLock:force`. The secret-authenticated inbound cron also exposes force only with its debug header. `edielMailboxPoller.part-1.ts::markMailboxPollStarted` deliberately omits the stale/null predicate when forced. This supported operator behavior can replace an active claimant immediately.

Both success and failure `markMailboxPollFinished` update by mailbox id alone. MB3 runs actual poll, claim and finish functions with no elapsed time: second forced claimant replaces first; first completion clears second lock; third normal claimant succeeds. Force authorization is not bypassed—the defect is old finalization after an authorized replacement.

Minimal fix: every poll obtains a unique claim identity and passes it to finish; finish requires matching identity and checks affected row before reporting canonical completion. Existing timestamp-derived/default worker labels are not a guaranteed unique per-claim token; use a UUID claim value, optionally retaining a separate readable worker label. Reusing a constant worker name in an equality predicate is insufficient. Retain authorized force takeover if intended, but old owners must be unable to release replacements. Whether force should permit overlapping IMAP work is a separate product choice, not silently changed here.

## Confirmed contract omissions with conditional stale reachability

### Tenant-email finalization and uncertainty

`markOutboxSent` and `markOutboxFailed` already filter id/company/status processing/lock_token. TE4 demonstrates that normal failure does not overwrite another worker. **Refuted:** “all tenant email failure writes are unfenced.”

They do not request or verify an affected row. TE2 demonstrates a false successful result and sent communication projection after zero-row canonical sent update. `markOutboxDeliveryUncertain` has only id/company predicates and ignores returned error, so TE3 demonstrates it can overwrite a recovered/reclaimed row. A successful provider response must never be sent into ordinary automatic-retry handling merely because finalization lost ownership.

Minimal fix: normal finalization requires a returned owned row before success counters or communication projections. Lost ownership is an explicit outcome. If provider accepted, record/report uncertain evidence without overwriting a newer owner or changing a terminal winner; uncertainty update must CAS owned processing token, verify result and surface persistence errors. Preserve the original provider result for review and do not automatically requeue. Test token loss, zero affected rows and errors independently. Operator requeue is an actual supported path, but simulated16m stale lifetime was not validated against deployment.

`sendTenantEmailNow` also invokes the same finalizers. It has an older fallback sending a nonqueued eligible status row without a new claim. Current normal consumers enqueue first; this pass does not classify a separately reachable failed-row resend path or broaden remediation beyond ownership outcomes. Preserve the explicit guard against automatically sending delivery_uncertain.

### Webhook fanout stale finalization

FO1 uses actual15m stale recovery, actual second claim/completion and first catch. Both complete and fail updates are id-only; the worker label is constant. Minimal fix: unique claim token/identity, status and token CAS for both finalizers, affected-row check, and owned attempt accounting. Do not claim success/failure for a lost claim.

False positive checked: `lib/integrations/webhooks.ts::enqueueWebhookDeliveriesForEvent` uses company-scoped active subscriptions and `upsert(...,{onConflict:'idempotency_key',ignoreDuplicates:true})`; key is subscription+domain event. `20260531111600_system_readiness_foundation.sql` declares the delivery idempotency unique constraint. The stale fanout race does not itself prove duplicate outbound HTTP delivery. Native unique-index behavior remains to execute. The canonical outbox bridge (`20260810190410_gridex_canonical_architecture_p0.sql`) intentionally mirrors into active domain_events/event_outbox; retirement trigger `20260818121500_master_production_remediation_p0.sql` suppresses only the retired internal onboarding destination, not webhook fanout. Thus this is an active worker, not a stale retired facade.

### Manual and nonforced Ediel mailbox stale completion

`manualMailboxPoller.ts` was read completely; actual engine selects active/verified mailbox, claims stale/null lock and processes IMAP sequentially. `finishMailbox` clears by id only and swallows write failures. MB1 demonstrates another worker is unlocked after simulated31m. Ediel MB2 demonstrates the analogous ordinary stale path. The actual per-message ingest/storage branches were not needed to trigger lock loss: empty synthetic IMAP iterations suffice. No real IMAP lock or duplicate ingestion effect was tested.

Minimal manual fix matches Ediel: unique per-claim identity, matching-owner finalization and explicit lost-claim/error outcome; don't silently treat failed persistence as successful canonical completion. Existing manual timestamp worker labels need collision-safe identity. Message dedup/Seen behavior should remain unchanged; this report does not allege message duplication merely from concurrent polling.

### Spot finalization

Exact files: `lib/pricing/spot/spotImportJobs.ts` complete wrapper/finalizers; `spotPriceImporter.ts::importSpotPricesForDayArea` complete branch/catch and day/month drivers; `elprisetJustNuClient.ts` complete adapter; SQL `20260724120000_canonical_market_resolution_quote_billing_flow.sql::gridex_claim_spot_price_import_job` complete definition.

SQL atomically claims one provider/area/day using transaction advisory lock and row lock, rejects fresh running attempts (default15m), and refreshes correlation_id on each successful renewal. It does not hold the transaction lock for the duration of HTTP/TypeScript work. Both complete/fail wrappers update only id. The importer receives correlationId but only passes it to telemetry, not finalizers. SP1 executes the actual importer locked-day completion branch after a source-backed modeled renewal; SP2 executes actual fail helper against a fresh correlation. This is a real missing ownership contract, but **not native SQL execution or proof of a deployed stale worker**.

Lifetime false-positive check:

- Scheduled paths are pricing spot-prices and spot-settlement. Additional runtime routes `/api/internal/spot/import-month` and `/api/platform/energy/import/spot-prices` call month import; `lib/pricing/engine.ts` calls `ensureSpotPricesForBillingMonth` from billing preparation. `ensureSpotPriceCoverage` exists but only its definition/static regression was found, so it is not claimed as an extra active runtime path.
- No maxDuration/lifetime override was found in inspected pricing routes, relevant layouts, next config or vercel.json. **Absence is not evidence of an unlimited hosted function.** No long-lived CLI spot worker was identified. Billing callers still do not establish survival beyond the lease.
- Provider requests default10s, configurable capped30s, at most5 attempts/default3. However Retry-After is honored without a corresponding whole-job cap. SP3 demonstrates synthetic429 with960 seconds passes to sleep. This only refutes using request timeout as a proof of whole-job duration; an enforced platform deadline could terminate the process before stale finalization.
- No deployment duration/termination receipt was read. The necessary >15m survival/reclaim/resumption remains unverified. This variant should be reported as confirmed conditional finalizer omission, not an observed production race or incident.

Minimal fix: pass the claimed correlationId into every complete/fail path; require id+status running+correlation_id and a returned row. Lost ownership must not mutate new attempt's status, error, retry time or emit false completion. Retain canonical market-data uniqueness and immutable locked-day guards. If the desired guarantee also covers interval/summary writes after lease loss, those need an atomic ownership check at the persistence boundary; merely fencing the job row does not certify all market writes. That wider write-gate design is outside this bounded finalizer fix. No new SQL migration is assumed necessary solely to use the existing correlation column, but native contract validation is required.

## SQL and source controls checked

- `20260618200000_ops_production_hardening_resolver_queues.sql`: tenant email processing lock/token columns and stale uncertainty contract. `20260618213000_ops_completion_workflows_health.sql`: stable provider idempotency key/unique index. `20260802015000_canonical_backfill_constraints.sql`: current tenant-email blocked state permitted; TE1 is not feeding an impossible enum state.
- `20260531111600_system_readiness_foundation.sql`: event_outbox statuses, attempts, locks, unique destination and webhook delivery idempotency. Later canonical bridge/retirement sources checked as above.
- `20260528_batch_7a_route_inbound_mail_platform_ui.sql` and mailbox foundations: Ediel lock columns; manual mailbox foundation `20260626130000_gridex_manual_communication_mailboxes.sql` and current worker lock fields. Supplemental schema trigger scan does not show a lease-ownership trigger protecting these updates.
- `20260802012000_ediel_configuration_snapshots.sql` mailbox trigger captures configuration snapshots; it does not compare old/new worker claims. It therefore is not a stale-finalizer guard. Native trigger side effects/cost were not tested.
- Spot job source only occurs in the defining market-resolution migration and the later table-classification migration; no newer claim body/finalization trigger was found. Unique provider/area/day identity prevents duplicate job rows, not stale updates to that same job id.

Source catalogs and migration bodies are evidence of intended constraints, not a fresh deployed catalog receipt. Native/service-role/PostgREST behavior remains a separate gate.

## Verification and next bounded work

Executed `node /tmp/job-ownership-variants-probe.mjs`: **12 cases PASS**, including controls. All provider/IMAP/DB dependencies are synthetic. The harness uses the complete actual TypeScript module bodies, strips types/imports and injects only I/O dependencies; no production module was edited. Its fake query builder applies the actual filters, snapshots read rows, and runs competing actual worker/claim/recovery functions. Spot RPC behavior is explicitly a finite model of inspected SQL, not a copy presented as native execution. Synthetic clocks advance instantly; no long sleep occurs.

Before remediation acceptance: add positive regression expectations for zero-row/lost-claim outcomes; confirm current queued/owned success paths; exercise provider-accepted persistence failure without automatic replay; run isolated native two-session claim/finalization races and uniqueness checks. For stale-only findings, obtain a safe deployment/runtime lifetime contract or retain conditional status. Existing dedup and tenant-policy gates must remain in place. No blanket point85 closure follows.

The exact executable source follows. On this audited source it asserts defect behavior; after fixes, replace those assertions with desired invariants. Run from repository root with Node24; no project dependencies or secrets required.

```sh
node --input-type=module <<'NODE'
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
let now=Date.parse('2026-09-12T12:00:00Z');
class Clock extends Date { constructor(...a){super(...(a.length?a:[now]));} static now(){return now;} }
const iso=()=>new Clock().toISOString();
function load(path,names,deps={}){
 const code=stripTypeScriptTypes(readFileSync(path,'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm,'').replace(/^export /gm,'');
 const c=vm.createContext({Date:Clock,Error,Buffer,console,process:{env:{}},randomUUID,createHash,...deps});
 vm.runInContext(code+'\nglobalThis.actual={'+names.join(',')+'}',c);return c.actual;
}
function fakeDb(tables){
 const db={tables,writes:[],hook:null,from(table){
  const op={table,kind:'select',patch:null,pred:[],single:false,limit:Infinity};let promise;
  const q={select(){return q;},update(p){op.kind='update';op.patch=p;return q;},
   insert(p){op.kind='insert';op.patch=p;return q;},eq(k,v){op.pred.push(r=>r[k]===v);return q;},
   in(k,vs){op.pred.push(r=>vs.includes(r[k]));return q;},is(k,v){op.pred.push(r=>(r[k]??null)===v);return q;},
   lt(k,v){op.pred.push(r=>r[k]!=null&&r[k]<v);return q;},lte(k,v){op.pred.push(r=>r[k]!=null&&r[k]<=v);return q;},
   not(k,_op,v){op.pred.push(r=>(r[k]??null)!==v);return q;},
   or(raw){const parts=raw.split(',');op.pred.push(r=>parts.some(part=>{
    const [k,operator,...rest]=part.split('.');const value=rest.join('.');
    if(operator==='is')return (r[k]??null)===null&&value==='null';
    if(operator==='lt')return r[k]!=null&&r[k]<value;
    if(operator==='lte')return r[k]!=null&&r[k]<=value;
    throw Error('unsupported predicate '+part);
   }));return q;},order(){return q;},limit(n){op.limit=n;return q;},
   maybeSingle(){op.single=true;return q;},single(){op.single=true;return q;},
   then(resolve,reject){promise??=(async()=>{
    const intercepted=await db.hook?.(op);if(intercepted)return intercepted;
    const rows=tables[table]??(tables[table]=[]);let hits=rows.filter(r=>op.pred.every(p=>p(r))).slice(0,op.limit);
    if(op.kind==='insert'){hits=(Array.isArray(op.patch)?op.patch:[op.patch]).map(r=>({...r}));rows.push(...hits);}
    if(op.kind==='update'){for(const r of hits)Object.assign(r,op.patch);db.writes.push({table,patch:op.patch,count:hits.length});}
    const data=hits.map(r=>({...r}));return {data:op.single?(data[0]??null):data,error:null};
   })();return promise.then(resolve,reject);},
  };return q;
 }};return db;
}
const emailSeed=()=>({id:'email',company_id:'A',status:'queued',attempts:0,max_attempts:5,
 email_type:'notice',from_email:'fake@example.invalid',to_email:'fake@example.invalid',subject:'fake',html_body:'fake',
 next_attempt_at:iso(),dead_letter_at:null,locked_at:null,locked_by:null,lock_token:null});
const emailNames=['processTenantEmailOutbox','claimRow','moveStaleProcessingToUncertain','requeueUncertainTenantEmail','markOutboxFailed'];
const allowed={allowed:true,reason_code:'ok',company_status:'active'};
function emailModule(db,decision,provider,extras={}){return load('lib/email/emailOutbox.ts',emailNames,{
 supabaseService:db,getTenantOperationDecision:decision,getEmailProvider:()=>({sendEmail:provider}),
 markCommunicationSent:async()=>null,markCommunicationFailed:async()=>{},emitCommunicationSentDomainEvents:async()=>{},...extras});}
{
 const row=emailSeed(),db=fakeDb({tenant_email_outbox:[row]});let policyCalls=0,accepts=0,second;
 const mod=emailModule(db,async()=>{if(++policyCalls===1){second=await mod.processTenantEmailOutbox();return {allowed:false,reason_code:'paused',company_status:'paused'};}return allowed;},async()=>{accepts++;return {providerMessageId:'fake-accepted'};});
 const first=await mod.processTenantEmailOutbox();
 assert.equal(second.sent,1);assert.equal(first.claimed,0);assert.equal(accepts,1);
 assert.equal(row.status,'blocked_tenant_state');assert.equal(row.provider_message_id,'fake-accepted');
 console.log('TE1: unclaimed blocked-policy branch overwrites completed concurrent send.');
}
{
 const row={...emailSeed(),communication_log_id:'log'},db=fakeDb({tenant_email_outbox:[row]});let projections=0;
 const mod=emailModule(db,async()=>allowed,async()=>{now+=16*60_000;await mod.moveStaleProcessingToUncertain({});return {providerMessageId:'fake-accepted'};},
  {markCommunicationSent:async()=>{projections++;return null;}});
 const result=await mod.processTenantEmailOutbox();
 assert.equal(row.status,'delivery_uncertain');assert.equal(result.sent,1);assert.equal(projections,1);
 assert(db.writes.some(w=>w.patch.status==='sent'&&w.count===0));
 console.log('TE2: lost sent CAS reports sent=1 and projects log although canonical row remains uncertain.');
}
{
 const row=emailSeed(),db=fakeDb({tenant_email_outbox:[row]});let intercept=true,newToken;
 const mod=emailModule(db,async()=>allowed,async()=>({providerMessageId:'fake-accepted'}));
 db.hook=async op=>{if(intercept&&op.kind==='update'&&op.patch.status==='sent'){
  intercept=false;now+=16*60_000;await mod.moveStaleProcessingToUncertain({});
  assert.equal((await mod.requeueUncertainTenantEmail({outboxId:row.id,companyId:'A',actorUserId:'operator'})).ok,true);
  const second=await mod.claimRow({...row});newToken=second.lock_token;
  return {data:null,error:{message:'synthetic persistence outage'}};
 }};
 const result=await mod.processTenantEmailOutbox();
 assert(newToken);assert.equal(row.lock_token,null);assert.equal(row.status,'delivery_uncertain');
 assert(result.errors.some(e=>e.error.includes('delivery_uncertain_after_provider_send')));
 console.log('TE3: provider-accepted uncertain fallback clears a newly reclaimed worker token.');
}
{
 const row=emailSeed(),db=fakeDb({tenant_email_outbox:[row]});const mod=emailModule(db,async()=>allowed,async()=>{throw Error('unused');});
 const first=await mod.claimRow({...row});now+=16*60_000;await mod.moveStaleProcessingToUncertain({});
 await mod.requeueUncertainTenantEmail({outboxId:row.id,companyId:'A',actorUserId:'operator'});
 const second=await mod.claimRow({...row});await mod.markOutboxFailed(first,'late failure');
 assert.equal(row.lock_token,second.lock_token);assert.equal(row.status,'processing');
 console.log('TE4 control: normal failure CAS preserves newer worker; it does not verify affected-row count.');
}
{
 const row={id:'fanout',company_id:'A',domain_event_id:'event',destination_type:'webhook',destination_key:'webhook_fanout_v1',status:'queued',attempts:0,max_attempts:12,available_at:iso()};
 const db=fakeDb({event_outbox:[row],domain_events:[{id:'event',company_id:'A'}]});let fanouts=0,winner;
 const mod=load('lib/events/domainEvents.ts',['processDomainEventWebhookFanout'],{supabaseService:db,
 enqueueWebhookDeliveriesForEvent:async()=>{if(++fanouts===1){now+=16*60_000;winner=await mod.processDomainEventWebhookFanout();throw Error('late original fanout failure');}return 1;}});
 const old=await mod.processDomainEventWebhookFanout();assert.equal(winner.completed,1);assert.equal(old.failed,1);
 assert.equal(row.status,'failed');assert(row.sent_at);assert.equal(row.locked_by,null);
 console.log('FO1: late failed fanout overwrites newer completed fanout after actual stale recovery.');
}
{
 const row={id:'fanout-fast',company_id:'A',domain_event_id:'event-fast',destination_type:'webhook',destination_key:'webhook_fanout_v1',status:'queued',attempts:0,max_attempts:12,available_at:iso()};
 const db=fakeDb({event_outbox:[row],domain_events:[{id:'event-fast',company_id:'A'}]});let intercept=true,second,fanouts=0;
 const mod=load('lib/events/domainEvents.ts',['processDomainEventWebhookFanout'],{supabaseService:db,
 enqueueWebhookDeliveriesForEvent:async()=>{fanouts++;throw Error('synthetic fanout failure');}});
 db.hook=async op=>{if(intercept&&op.table==='event_outbox'&&op.kind==='update'&&op.patch.status==='processing'){
  intercept=false;second=await mod.processDomainEventWebhookFanout();assert(row.available_at>iso());
 }};
 const first=await mod.processDomainEventWebhookFanout();
 assert.equal(second.failed,1);assert.equal(first.failed,1);assert.equal(fanouts,2);assert.equal(row.attempts,1);
 console.log('FO2: queued snapshot claims newly failed/not-yet-due row, losing retry attempt with no time advance.');
}
{
 const mailbox={id:'manual',is_active:true,is_verified:true,imap_host:'fake',imap_username:'fake',from_email:'fake@example.invalid',locked_at:null,locked_by:null,last_polled_at:null};
 const db=fakeDb({manual_communication_mailboxes:[mailbox]});let secondClaim;
 class Imap {async connect(){now+=31*60_000;secondClaim=await mod.claimMailbox(mailbox.id,'manual-worker-2');}
  async getMailboxLock(){return {release(){}};}async *fetch(){}async logout(){}}
 const mod=load('lib/inbound-mail/manualMailboxPoller.ts',['runManualInboundMailEngine','claimMailbox'],{
  supabaseService:db,ImapFlow:Imap,assertPlatformSchemaReady:async()=>{},resolveManualMailboxSecret:()=> 'synthetic',ingestManualInboundEmail:async()=>{throw Error('unused');}});
 await mod.runManualInboundMailEngine();assert.equal(secondClaim,true);assert.equal(mailbox.locked_by,null);
 assert.equal(await mod.claimMailbox(mailbox.id,'manual-worker-3'),true);
 console.log('MB1: actual manual poll completion unlocks second owner; third claim succeeds.');
}
for(const force of [false,true]){
 const mailbox={id:'ediel',mailbox_name:'fake',environment:'production',locked_at:null,locked_by:null};
 const db=fakeDb({ediel_mailboxes:[mailbox]});const part1=load('lib/inbound-mail/edielMailboxPoller.part-1.ts',['markMailboxPollStarted','markMailboxPollFinished'],{supabaseService:db});let secondClaim;
 class Imap {async connect(){if(!force)now+=31*60_000;secondClaim=await part1.markMailboxPollStarted(mailbox.id,'ediel-worker-2',force);}
  async getMailboxLock(){return {release(){}};}async *fetch(){}async logout(){}}
 const mod=load('lib/inbound-mail/edielMailboxPoller.part-2.ts',['pollEdielMailbox'],{
  ...part1,supabaseService:db,ImapFlow:Imap,resolveEffectiveMailboxForPolling:()=>({imap_host:'fake',username:'fake',metadata:{}}),
  resolveMailboxPasswordFromSecretReference:()=> 'synthetic',metadataBool:()=>true,normalizeImapMailboxFolder:()=> 'INBOX'});
 await mod.pollEdielMailbox({mailbox,workerId:'ediel-worker-1'});assert.equal(secondClaim,true);assert.equal(mailbox.locked_by,null);
 assert.equal(await part1.markMailboxPollStarted(mailbox.id,'ediel-worker-3'),true);
 console.log(force?'MB3: approved forced Ediel takeover is cleared by old poll without time advance.':'MB2: actual Ediel poll completion unlocks second owner; third claim succeeds.');
}
{
 const row={id:'spot',status:'queued',attempt_count:0,correlation_id:'seed'},db=fakeDb({spot_price_import_jobs:[row],spot_price_daily_summaries:[{source:'elprisetjustnu',price_area:'SE1',price_date:'2026-09-12',status:'locked',source_checksum:'verified'}]});
 // Finite model of the inspected SQL claim guards; NOT native PostgreSQL execution.
 db.rpc=async(name,args)=>{assert.equal(name,'gridex_claim_spot_price_import_job');
  const refused=(row.status==='completed'&&!args.p_force)||(row.status==='running'&&Date.parse(row.started_at)>now-15*60_000)||(row.status==='retry_wait'&&row.next_attempt_at>iso());
  if(!refused)Object.assign(row,{status:'running',attempt_count:row.attempt_count+1,started_at:iso(),correlation_id:randomUUID(),next_attempt_at:null});
  return {data:[{...row,claimed:!refused}],error:null};};
 const jobs=load('lib/pricing/spot/spotImportJobs.ts',['claimSpotImportJob','completeSpotImportJob','failSpotImportJob'],{supabaseService:db});
 const input={provider:'elprisetjustnu',priceArea:'SE1',calendarDate:'2026-09-12',force:true};let second;
 db.hook=async op=>{if(op.table==='spot_price_daily_summaries'&&op.kind==='select'){db.hook=null;now+=16*60_000;second=await jobs.claimSpotImportJob(input);}};
 const importer=load('lib/pricing/spot/spotPriceImporter.ts',['importSpotPricesForDayArea'],{supabaseService:db,...jobs});
 const result=await importer.importSpotPricesForDayArea(input);assert.equal(second.claimed,true);
 assert.equal(row.correlation_id,second.correlationId);assert.equal(row.status,'completed');assert.equal(result.status,'completed');
 // A stale failure can likewise alter the fresh claimant's status/backoff using old attemptCount.
 const third=await jobs.claimSpotImportJob(input);
 await jobs.failSpotImportJob({jobId:row.id,errorCode:'old',message:'old failure',retryable:true,attemptCount:1});
 assert.equal(row.correlation_id,third.correlationId);assert.equal(row.status,'retry_wait');
 console.log('SP1/SP2: actual importer stale completion and actual helper late failure mutate renewed correlation.');
}
{
 const client=load('lib/pricing/spot/elprisetJustNuClient.ts',['fetchElprisetJustNuDay'],{
  isPriceArea:x=>x==='SE1',AbortController,setTimeout,clearTimeout});let requests=0,delay;
 const data=await client.fetchElprisetJustNuDay({date:'2026-09-12',priceArea:'SE1',
  fetchImpl:async()=> ++requests===1 ? new Response('',{status:429,headers:{'retry-after':'960'}}) : new Response('[]',{headers:{'content-type':'application/json'}}),
  sleep:async ms=>{delay=ms;}});
 assert.equal(delay,960000);assert.equal(data.length,0);
 console.log('SP3 control: actual provider adapter accepts 16-minute Retry-After; no sleep/network used.');
}
console.log('PASS 12 finite cases; fake providers/IMAP/DB only, zero external effects.');

NODE
```

Report receipt: embedded harness extracted and rerun successfully (12 cases, exit0); `git diff --check` passed. SDD file is Git-ignored and requires explicit inclusion for publication.
