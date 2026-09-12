# Point 85: finite native and residual scale contract — 2026-09-12

This is preparation for the next isolated native test implementation, **not an executed PostgreSQL fixture or point-85 closure**. No SQL, Docker, production, provider, application, migration or workflow mutation was performed. Eight focused actual-module synthetic scale cases executed successfully; the exact harness is below. Existing 21-route and 12-variant audits remain the baseline and are not rerun here.

Skill routing inherits the parent review: source acquisition, source-to-sink review, false-positive checking, SQL/tenant integrity, performance and verification boundaries apply. This is a bounded follow-up, not another baseline or deployed performance assessment. The existing analytics company keyset fix is acknowledged and excluded from further remediation.

## Evidence and admission

- Prior evidence: `quality/audits/PLAN_85_JOB_MATRIX_2026-09-12.md`, `quality/audits/JOB_OWNERSHIP_VARIANTS_2026-09-12.md`, `quality/audits/JOB_FAILURE_FENCING_AND_ANALYTICS_PAGINATION_2026-09-12.md`, `quality/audits/proofs/jobs-ownership-regression.mjs`, `__tests__/helpers/jobs-ownership-cases.ts`, `__tests__/jobs-ownership-and-pagination.test.ts`. Their synthetic passes do not establish PostgreSQL locking, grants, triggers or affected-row behavior.
- Source hashes below describe the working files read for this report, not a future implementation revision or deployed catalog. Rehash before fixture admission; any changed worker/SQL requires reviewing its affected contract, not blindly keeping old expected failures.
- Use a **new dedicated instance** of `OwnedPostgres` from `scripts/canonical-auth-provisioning-legacy-batch.py`, PostgreSQL17, owned random name/label, `--network none`, tmpfs database, private0600 inputs/logs, Unix-socket docker-exec only. Use its already allowlisted `gridex_auth_legacy_native` and `gridex_auth_legacy_atomic` databases. Do not attach to another running fixture or accept DATABASE_URL/host/production credentials. Do not expand its allowlist or invoke `.prefix()` (which replays unrelated first43 history).
- `scripts/sql/gridex-supabase-compatible-bootstrap.sql` supplies synthetic platform roles/schemas/extensions. Its default function EXECUTE grants mean actual revocations MUST be installed/tested. It deliberately does not create all table ACLs. Service role has BYPASSRLS: company correctness in service jobs is an application/SQL predicate contract, not an assumed RLS guarantee.
- Build source slices from pinned definitions, column/constraint changes, ACLs and triggers. Do not execute entire historical files containing unrelated backfills, sends, lifecycle rewrites or broad repair DML. `supabase/schema.sql` is a supplemental catalog inventory, **not sole authority to override later migration bodies**. Every sliced object needs its parent hash, original byte span and slice hash; catalog receipts must list columns/defaults/checks/FKs/index predicates/triggers/function signature/security/search_path/ACL.
- **Fixture implementation remains an admission gate.** This report supplies exact finite calls/interleavings and the minimum source closure by family. It does not pretend that a complete executable source-slice assembler already exists. Missing dependency/table/column/trigger/ACL must fail setup, never be patched with a mock `allowed=true` function, disabled trigger, dropped FK, superuser worker or hand-written replacement claim algorithm.

## Actual entry points and SQL boundaries

There is no SQL claim/finalizer RPC for the manual/tenant email, domain-event fanout or mailbox wrappers inspected here. Test their actual TypeScript modules with a native query adapter (real PostgreSQL mutations and returned rows), or a separately isolated actual PostgREST fixture. Do not add a test-only RPC and call its success a test of these workers. A native adapter must preserve each awaited builder as its own autocommit statement; wrapping a complete worker in one transaction would invent isolation it does not have. Preserve `maybeSingle` zero rows as `data:null,error:null`, update-returning columns, returned database errors, unique violations and actual predicates. Record the emitted SQL/bind types privately and reject unsupported builder operations.

| Family | Actual source/functions | Existing native boundary and ownership |
|---|---|---|
| Manual email | `lib/email/manualEmailOutbox.ts`: `processManualEmailOutbox`, `recoverStaleManualSendingRows`, `requeueUncertainManualEmail` | Candidate queued/external_delivery/due; claim company+id+queued+external_delivery. Current success/failure/uncertain paths fence sending+locked_by and select returned id; Task7 fixed preclaim catch behavior. Stale sweep15m goes uncertain; explicit operator requeue company+id+uncertain. Linked request/site/customer projections are separate writes. |
| Tenant email | `lib/email/emailOutbox.ts`: `claimRow`, `markOutboxSent`, `markOutboxFailed`, `markOutboxBlockedByTenantState`, `markOutboxDeliveryUncertain`, `moveStaleProcessingToUncertain`, `processTenantEmailOutbox`, `requeueUncertainTenantEmail` | Claim company+id+queued and random lock_token after tenant decision. Normal sent/failed mutations include processing+token; current blocked/uncertain variants and zero-row projections remain prior findings. Due/dead-letter predicates occur in candidate selection; do not assume they are all repeated at claim. |
| Fanout | `lib/events/domainEvents.ts`: `processDomainEventWebhookFanout`, `fanoutRetryAt` | event_outbox due queued/failed selection; current claim id+queued/failed only, constant locked_by; final updates id-only. Native tests must characterize recorded ownership/due/version failures until fixed. |
| Webhook HTTP queue | `lib/integrations/webhooks.ts`: `enqueueWebhookDeliveriesForEvent`, `claimDueDeliveries`, `finalizeClaimedDelivery`, `markDeliveryUncertain`, `recoverStaleDeliveries`, `dispatchDueWebhookDeliveries` | Claim rechecks due and status, random batch locked_by; normal finalize checks processing+worker and returned id. Uncertainty helper checks id/company and processing/failed, not worker; retain acceptance uncertainty. Enqueue upserts stable subscription:event key with ignoreDuplicates. |
| Mailboxes | `lib/inbound-mail/manualMailboxPoller.ts`: `claimMailbox`, `finishMailbox`, `runManualInboundMailEngine`; `edielMailboxPoller.part-1.ts`: `markMailboxPollStarted`, `markMailboxPollFinished`; `.part-2.ts`: `pollEdielMailbox` | TS id+lock-null/stale30m CAS; Ediel forceLock deliberately bypasses freshness. Current finishes id-only. Global/shared mailbox scope is valid; it is not a tenant job table merely because other queues are. |
| Spot | `lib/pricing/spot/spotImportJobs.ts`: `claimSpotImportJob`, `completeSpotImportJob`, `failSpotImportJob`; `spotPriceImporter.ts` | Real RPC below claims provider/area/day and renews correlation_id. TS finalizers currently id-only. Correlation finalizer tests must use claimed UUID, not invent a new SQL completion function. |
| Customer operations | `lib/customer-operations/automation.part-1.ts`: `updateJob(job:{id,lock_token},patch)`, `enqueue`, `retryAt`; `.part-3.ts`: worker orchestration | Real claim RPC below; TS `updateJob` adds token when present and raises lock-lost on zero returned id. Test genuine claimed jobs with nonnull token. Legacy tokenless branch is not equivalent authority. |
| Provisioning | `lib/tenant/provisioningWorker.ts`: claim/complete worker | Real claim and finalizer RPC below. Completion wrapper preserves previous dead-letter timestamp and calls revoked private predecessor. Auth invite provider calls must be synthetic; no auth service is contacted. |
| Automation | `lib/automation/locks.ts`: acquire/release/withAutomationLock | Real acquire/release RPC below. A false acquisition becomes AlreadyRunningError409. Release checks SQL error but does not report false as success ownership. No heartbeat; distinct all/company lock keys do not promise mutual exclusion with one another. |

Exact SQL signatures and authoritative bodies:

1. `gridex_acquire_automation_lock(text,uuid,uuid,integer,jsonb) RETURNS boolean`; `gridex_release_automation_lock(text,uuid) RETURNS boolean`: `20260712100000_gridex_end_to_end_integrity_hardening.sql`. SECURITY DEFINER/search_path public; revoke public/anon/authenticated, grant service_role. Empty key/null token or TTL outside30..86400 raises22023. Expired rows are removed before insert; conflict gives false; release matches key+token.
2. `gridex_claim_customer_operation_jobs(text,integer) RETURNS SETOF customer_operation_jobs`: latest `20260819070622_pr164_review_remediation_v2.sql`; ACL from `20260818121500_master_production_remediation_p0.sql` lines453–454. SECURITY DEFINER/search_path public,pg_catalog,pg_temp; public/anon/authenticated revoked, service granted. Due queued or stale/null-lock running; active/onboarding companies; lifecycle_blocked_by_tenant=false; attempts<max; priority/run_after/created ordering; SKIP LOCKED; clamp1..100; token/heartbeat renewed. Exhausted eligible due/stale jobs terminalize first. Blank worker is normalized null, not rejected—do not invent a worker validation expectation.
3. `canonical_claim_company_provisioning_jobs(text,integer,integer) RETURNS TABLE(id uuid,company_id uuid,job_key text,idempotency_key text,attempt_count integer,max_attempts integer,lease_token uuid)`: `20260810193450_canonical_access_provisioning_runtime_v1.sql`. SECURITY DEFINER/search_path public,pg_temp; service-only invocation. Empty worker raisesP0001. Lease argument clamped30..3600 governs stale sweep; due pending/retry, attempts<max, active/onboarding and real tenant.provisioning.execute policy; SKIP LOCKED, clamp1..100; increments attempt and replaces lease.
4. `canonical_complete_company_provisioning_job(uuid,uuid,boolean,text,text,jsonb) RETURNS jsonb`: current wrapper in `20260810224500_canonical_review_remediation_v1.sql` lines512–558, invoking same-signature `canonical_complete_company_provisioning_job_v1_pre_history_guard` (body originally in `20260810193450...`). Both SECURITY DEFINER/public,pg_temp. Public wrapper service-only; predecessor revoked from public/anon/authenticated/**service_role**. Missing job or wrong status/token raisesP0001; success completed; error retry/dead_letter; delay min3600,30*2^(attempt_count-1); lease cleared; historical dead_letter_at preserved.
5. `gridex_claim_spot_price_import_job(text,text,date,uuid,interval,boolean) RETURNS TABLE(id uuid,claimed boolean,status text,attempt_count integer,correlation_id uuid)`: `20260724120000_canonical_market_resolution_quote_billing_flow.sql` lines234–312. SECURITY DEFINER/public,pg_temp, service-only. Advisory transaction lock of normalized provider:area:day + row FOR UPDATE; valid SE1..4 else22023; completed skips unless force; fresh running refuses even force; future retry refuses; renewal increments attempt and UUID. p_company_id is attribution, not part of identity; actual scheduled callers use shared scope. Do not assert same day/area has a separate row per tenant.
6. `canonical_tenant_operation_decision(uuid,text) RETURNS TABLE(allowed boolean,reason_code text,company_status text,capability_status text,production_status text,state_version bigint)`: latest `20260902094500_decouple_contract_sales_from_ediel_send_state.sql`. Install actual policy; service-only ACL is explicit in `20260810193450_canonical_access_provisioning_runtime_v1.sql:187–190` (also original `20260802010000_canonical_tenant_operation_policy_lifecycle.sql:266–267`). The fixture's email/webhook policy branch needs companies, company_capabilities and integration_api_clients; optional ediel_production_state must be explicitly represented as present/absent. Provisioning execute has no capability requirement. Do not replace policy with a static allow.

## Minimum table and trigger closure

Common: source-derived companies plus all retained NOT NULL/default/check/FK dependencies; synthetic auth.users when referenced; customers/customer_sites/metering_points where referenced; real company_capabilities and integration_api_clients for policy. Use synthetic A/B active, C paused, D onboarding; seed only deterministic fixture identities. Nullable relationships may be NULL when runtime accepts them. Keep every FK definition even if its row reference is NULL. For FK cycles create actual tables first, add actual constraints after, then seed in transaction. No `session_replication_role=replica`.

| Family | Minimum roots and authoritative additions | Trigger branches required / deliberately separate |
|---|---|---|
| Manual email | manual_email_outbox foundation `20260626120000...pipeline`; uncertainty `20260703120000...`; external_delivery and recipient equality check `20260712100000...`; latest blocked status `20260802203000...`; referenced grid_owner_information_requests table and its FK closure | Install `gridex_assert_verified_site_owner_for_manual_outbox()` latest `20260825093400_facility_geographic_owner_outbox_guard.sql`, trigger attachment `20260824140830...send_guard`; `gridex_capture_manual_email_template_audit()` latest `20260824132814...convergence`, attachment `20260821144000...audit`. For pure queue cases request_id=NULL is source-supported and both return early; external_delivery=true still requires actual_recipient_email=to_email. Linked-request cases need same-company customer/site/owner/resolution rows and real request transition triggers, not a fake request stub. |
| Tenant email | tenant_email_outbox foundation `20260520_batch_5_cases_audit_email_ux.sql`; engine `20260531213000_resend_tenant_email_engine.sql`; lock/status `20260618200000...resolver_queues`; provider key/uniqueness `20260618213000...health`; blocked state `20260802015000...constraints` | No ownership trigger found in reviewed catalog. communication_log_id=NULL isolates queue tests; separate positive projection case needs communication logs/domain-event closure. Unique(company_id,provider_idempotency_key) WHERE provider_idempotency_key IS NOT NULL preserves cross-company independent identities; NULL keys are not forced unique. |
| Fanout/webhook | domain_events,event_outbox,webhook_subscriptions,webhook_deliveries foundation `20260531111600_system_readiness_foundation.sql` and current lock/uncertain/blocked column/status migrations; stable delivery idempotency index | Include `gridex_suppress_retired_onboarding_outbox_v1` and `aa_event_outbox_retired_onboarding_destination_v1` from `20260818121500...`. Webhook destination exercises nonretired branch. Canonical_event_outbox bridge is a separate entry path, not needed to test normal domain-event enqueue; do not certify it from reduced fixture. Never use a real URL/secret/Vault value. |
| Mailboxes | ediel_mailboxes `20260528_batch_7a_route_inbound_mail_platform_ui.sql`; manual_communication_mailboxes `20260626130000_gridex_manual_communication_mailboxes.sql`; retain FK/status/config columns and ACLs | Ediel `ediel_configuration_change_snapshot_trigger` from `20260802012000_ediel_configuration_snapshots.sql` remains enabled. Shared mailbox company_id=NULL returns before company snapshot work; a tenant mailbox case must load actual snapshot helper/table dependency closure. Do not disable snapshot to make the ownership test green. Manual finish success/error branches both included. |
| Spot | spot_price_import_jobs exact CREATE/constraints/indexes from `20260724120000...`, companies FK | Job-only claim/finalizer cases do not require market intervals/summaries. Importer locked-day branch additionally needs actual summary schema and triggers; it is not permission to certify market-data persistence from job-row fencing. |
| Customer operations | customer_operation_jobs `20260618110000...`; token/heartbeat/lifecycle/status columns from subsequent authoritative ALTERs; customers,customer_sites,metering_points,auth.users; customer_info_requests and ediel_messages required by trigger `%ROWTYPE` even for early return | Install all seven runtime trigger functions: run_after guard (`20260625100000...`, later search_path `20260709160000...`); terminal continuation (`20260804121000...`); dependency-wait latest `20260824150500...`; inbound correlation latest `20260821165300...`; required payload latest `20260903070000...`; freshness and exact apply latest `20260903213000...`; ACL freshness adjustment `20260904120000...`. Benign non-inbound, non-continuation job_type isolates claim/token behavior. Continuation cases require actual website_customer_applications/customer_application_workflows/site projection closure; inbound Z02 core apply is outside this job ownership contract. `%ROWTYPE` dependencies cannot be omitted just because branch returns early. |
| Provisioning | company_provisioning_jobs `20260802014000...` + runtime `20260810193450...`; company_invitations with actual company/idempotency unique index; common policy tables | Install `canonical_sync_provisioning_jobs_for_lifecycle` and companies status trigger from runtime source. Install current AFTER INSERT invitation `canonical_enqueue_invitation_delivery_job` from `20260810224500...`; invoke via INSERT despite direct execute revoked. Keep the private completion predecessor+wrapper; do not apply rename twice. Invitation auth-provisioning trigger chain is a separate closure gate; reuse the already reviewed canonical auth fixture definitions if compatible, not all history/prefix replay. |
| Automation | automation_locks exact definition/index/RLS/ACL from `20260712100000...`; companies FK | No test-specific claim trigger. Expired deletion is global to this lock table; fixtures in separate databases avoid unrelated cases consuming one another's leases. |

Table grants need catalog comparison, not a universal authenticated-denied assumption. Supplemental `supabase/schema.sql` lists service ALL on all these queues; authenticated table privileges exist on several, and anon privileges exist on manual mailbox/outbox tables. RLS/policies determine ordinary-user row access. This native **service worker** lane should assert service mutation access and actual RPC execute restrictions. Full ordinary-user SELECT/CRUD tenant-RLS acceptance belongs to the separately planned point83 lane and cannot be inferred here. Do not invent deny ACLs to make a native test pass.

Source closure admission must enumerate the latest ALTER/constraint statements for each root, recursive FK targets, trigger attachment statements and every `%ROWTYPE` dependency. The table above is the bounded required set and its branch exclusions, not a claim that the recursive extraction is implemented or executed. Any extension into linked-request, tenant-mailbox snapshot or inbound Z02 branches requires the named real closure before that case is admitted.

## Two-session protocol (executable contract for the fixture author)

Use `OwnedPostgres.command(database,transaction=False)` for long-lived psql sessions. Start subprocess with stdin/stdout pipes and register it in `owned.processes`; raw responses stay private. Each starts:

```sql
\set ON_ERROR_STOP on
SET application_name='job85_case_A'; -- B uses ..._B
SET lock_timeout='2s';
SET statement_timeout='10s';
SET idle_in_transaction_session_timeout='15s';
BEGIN;
SET LOCAL ROLE service_role;
-- exact production claim statement from the table below
\echo JOB85_A_CLAIMED
```

Controller uses selectors with a **5-second** deadline to read the explicit marker, then leaves A's stdin open. No sleeps, provider calls or guessed scheduling. For SKIP LOCKED, B calls the same RPC in another transaction and must return within2s with disjoint ids; A still holds its claim row locks. For a deliberate same-key blocking test, expect55P03 from B, rollback B, commit A, then repeat B and assert the contract's false/refusal result. Alternatively inspect B wait in pg_stat_activity as owner before releasing A; never treat an elapsed delay alone as barrier proof. Parent watchdog20s per case; all active processes terminated before owned cleanup. Run rollback variants with A ROLLBACK, then B must successfully claim unchanged attempt count. Use a fresh transaction for age comparisons: `now()` is transaction-start time.

For actual TS autocommit workers use a deterministic adapter barrier immediately after candidate SELECT returns its snapshot and before the next UPDATE. Let competing actual worker B claim/fail/complete; then resume A. This reproduces real selectable queued states and interleavings. Never feed an initially excluded processing row directly to a queue worker. For stale-only variants the owner fixture backdates locked_at/started_at in a separate committed statement; this proves a state invariant, **not survival past a hosted deadline**.

The native fixture must load the actual module and replace I/O only. Fake provider accepts/rejects/returns429 deterministically; IMAP supplies an empty or synthetic message stream. Assert zero external sockets/calls. A PostgreSQL adapter is not PostgREST max_rows evidence; the scale harness below models that boundary separately.

### Exact RPC commands

Fixture A=`00000000-0000-4000-8000-000000000001`, B=`...0002`; tokens supplied below are synthetic literals. Each SQL command runs under service_role unless explicitly testing ACL. Row captures use `\gset` with unique prefixes or JSON serialization in the adapter; assertions inspect native persisted state, not only returned booleans.

```sql
SELECT public.gridex_acquire_automation_lock(
 'job85:company:A','00000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001',30,'{"case":"L1"}');
SELECT public.gridex_release_automation_lock(
 'job85:company:A','10000000-0000-4000-8000-000000000002'); -- false; owner remains
SELECT * FROM public.gridex_claim_customer_operation_jobs('job85-A',1);
SELECT * FROM public.canonical_claim_company_provisioning_jobs('job85-A',1,300);
SELECT public.canonical_complete_company_provisioning_job(
 :'claimed_id'::uuid,:'claimed_lease_token'::uuid,true,NULL,NULL,'{}');
SELECT * FROM public.gridex_claim_spot_price_import_job(
 'elprisetjustnu','SE1','2026-09-12',NULL,interval '15 minutes',false);
```

No finalizer SQL is invented for TS workers. Run `updateJob`, actual email/fanout/mailbox/spot finalizers through their actual native builder adapter and assert `RETURNING` cardinality and final table row. Preserve their current error-vs-null behavior so regression failures are meaningful.

## Finite native cases and expected acceptance

Each row is a finite case family; run listed positive/negative variants independently with fresh fixture state. This is a specification, **zero native cases executed here**. “Current red” references existing synthetic/source evidence, not a new native result.

| ID | Setup / exact action / assertion |
|---|---|
| ACL1 | For six public RPC signatures (automation acquire/release, customer claim, provisioning claim/complete, spot claim), check `has_function_privilege` then execute under anon/authenticated:42501 and unchanged rows. Execute under service succeeds. |
| ACL2 | Direct service call to provisioning private predecessor must42501; public wrapper with valid claim succeeds. Trigger invitation enqueue still fires when directly invoked trigger function is revoked. Owner and SECURITY DEFINER search_path equal pinned sources. |
| L1 | A acquires same key/token once; same-key B acquisition waits on uncommitted row then55P03 or after commit false. Different company/key B succeeds. Wrong-token release false/no mutation; exact-token release true; repeated release false. |
| L2 | A acquisition rolled back -> row absent and B true. Seed expired key with old token -> B succeeds and replaces ownership; old release false. Boundaries TTL29,86401/empty key/nulltoken22023;30,86400 valid. |
| M1 | Actual manual processors A/B snapshot same eligible queued row; one native claim affected1, other0; fake sends exactly1; persisted sent + provider key + request_idNULL; return counters reflect winner only. |
| M2 | Preclaim policy/DB failure after B takes candidate must not write B's row or linked request. Current Task7 synthetic regression expectation should stay green natively. Repeat owned retryable failure and owned terminal failure; verify retryAt attempts1,2,10 gives5,10,720minutes and attempts/due/cleared lock from actual helper and zero foreign-company writes. |
| M3 | Fake provider accepts; sent persistence fails; retain delivery_uncertain and stable provider idempotency identity, no automatic second send. Sweep only stale sending; operator requeue wrongcompany0/rightcompany1/duplicate0. Renew claim then old finalizer must not clear new owner or project false linked completion. |
| M4 | Same-company linked request positive: actual template audit updates only matching request and actual site/customer projection succeeds; wrongcompany referenced request either rejected by actual constraint/guard or unchanged—record exact source-supported result, not assumed FK semantics. Verified owner guard23514 negative and valid geographic/operational owner positive require full linked closure. |
| E1 | Actual tenant claim A/B same queued snapshot: one token winner; companyB id swap matches0. Current queued success positive and failed retry/dead-letter positive with retryDelayMinutes attempts1,2,4 giving5,20,60minutes. Stable company/key enqueue duplicate does not create new send intent; identical key in another company retains independent row. |
| E2 | Prior TE1: A queued snapshot waits policy, B claims and persists sent, A denied policy. Acceptance: A must not change sent/provider identity or claim completion. Current helper is red source/synthetic; do not expect green until fixed. |
| E3 | Provider-accepted persistence error, stale sweep/requeue/new claim, then old uncertain finalizer. Acceptance: new token/status unchanged, old result reports lost ownership/uncertainty, no automatic retry and no false communication sent projection. Current conditional variants/zero-row reporting are red source/synthetic. |
| E4 | Failed finalizer with old token updates0 and preserves new token; accepted outcome must distinguish lost claim from successful failure persistence. Future-due/dead-letter candidates excluded. Snapshot then competing retry changes due/attempt: native characterize current claim omission; do not assert exclusions absent from actual claim SQL. |
| F1 | Enqueue same domain event twice and fanout replay produce one event destination/delivery per stable subscription:event identity; second company/event produces separate correct rows. Include duplicate unique23505 or ignoreDuplicates behavior exactly as actual enqueue uses. No HTTP send occurs in fanout test. |
| F2 | Prior FO2: A queued snapshot, B claim+failure sets future available_at/attempt1, resume A. Acceptance: no early reclaim, no lost attempt. Current native expectation is characterization red; fix must compare current due and attempt/ownership version. Backoff attempts1,2,12 ->30,120,3600seconds via actual fanoutRetryAt, not provisioning's exponential formula. |
| F3 | A claim, backdate stale lock, actual sweep/B claim+complete, A catch/finalize. Acceptance: no overwrite of B sent/attempt/lock. This is a conditional lease-state contract, not deployed lifetime proof. |
| W1 | Actual webhook claim repeats due/status predicates: A snapshot,B fails into future retry,A claim0; fresh different queued row remains claimable. Normal finalizer validworker1/wrongworker0->locklost; no false sent count. |
| W2 | Fake HTTP acceptance then native completion-write failure: uncertain retained, no automatic HTTP replay. If ownership transfers before uncertainty helper resumes, old helper must not clear current owner; current helper omission must remain visible. Response payload logging/truncation and attempt schedule preserved by actual module. |
| W3 | Tenant policy denies after claim: only owned row becomes blocked; no HTTP call; cross-company same event payload does not select another company's subscriptions. Global queue service authorization does not replace this per-row decision. |
| B1 | Manual and Ediel normal claim: fresh ownerA -> Bfalse, NULL/stale lock -> Btrue. Arollback permits B claim. Actual CAS response cardinality and lock timestamp persisted; default30m boundary uses separate committed fixture clocks. |
| B2 | Ediel actual forceLock takeover immediately replaces owner; late Afinish must not clear B, third normal claim false. Current MB3 source/synthetic red without elapsed-time assumption. Preserve explicit force behavior. |
| B3 | Manual/Ediel stale takeover -> late success AND error completion must preserve new owner and not misattribute last_successful_poll_at/last_error. Current id-only finishes red; lease survival remains unknown. |
| B4 | Shared Ediel mailbox actual snapshot trigger early-return control; tenant mailbox actual snapshot helper positive side effect and isolation assertion only after that real closure is loaded. Synthetic IMAP means parsing/transport delivery is excluded. |
| S1 | Actual spot RPC two-session same normalized provider/area/day serializes, returns one row/id and one winning fresh claim; different day/area independent. Owner rollback removes first insert; next attempt_count1. Invalid area22023. |
| S2 | completed/no-forcefalse; completed/forcetrue renew UUID+attempt; fresh running/forcefalse AND true bothfalse; future retryfalse; due retrytrue; backdated runningtrue with new correlation. NULL company shared is normal. Do not assert tenant-scoped uniqueness. |
| S3 | After S2 renew, actual complete/fail with old correlation must not mutate current row; current wrappers cannot enforce it and are red contract evidence. Valid owner positive; wrong status/token no reported success. Backoff retryable attempts1..4 vs terminal5, min60seconds and actual override behavior; do not impose an invented Retry-After maximum. |
| C1 | Two-session real customer claim: eligible queued A/B companies with distinct priorities; batch1 returns disjoint ids under SKIP LOCKED. No duplicate token/id; attempts increment exactly1; heartbeat/locks set; limit0 clamps1 and limit101 clamps100 (101 eligible rows). Rollback restores preclaim status/attempts. |
| C2 | Future queued, fresh running, paused company, lifecycleblocked, exhausted rows are not returned. Due exhausted active terminalizes failed; stale exhausted running terminalizes and clears locks. Onboarding eligibility retained. Old token updateJob must throw lock_lost with no mutation; genuine currenttoken updateJob succeeds. |
| C3 | Actual retryAt attempts1,2,8 ->15,30,900seconds. Finish retry then claim before due0, owner backdates due then claim1. Active idempotency duplicate samecompany/jobtype/key conflicts while samekey companyB succeeds. Terminal reuse behavior follows actual partial active index, not permanent dedup. |
| C4 | run_after=NULL guard fills now. Continuation dependency result resolves grid-owner blocker into queued+1h and decrements consumed attempt; site/workflow/application projections samecompany. Terminal continuation failed/delivery_uncertain projects actual failure. Needs full continuation closure; generic claim-only fixture cannot certify these branches. |
| P1 | Two-session real provisioning claim batch1 returns disjoint jobs; attempts/token set once, rollback restores; paused excluded/onboarding included; future due excluded; worker emptyP0001; limit0/101 clamps1/100. Real operation policy executes. |
| P2 | Real completion currenttoken succeeds; old/null/wrongtoken or nonprocessingP0001 and no statechange. Success repeat rejects; failure setsretry at actual delay; max attempt dead_letter. Prior dead_letter_at survives reset/retry then success through current wrapper. Verify no direct private function grant. |
| P3 | Backdate processing beyond actual lease -> sweep retry or deadletter basedattempt; only retryeligible claimable; new token invalidates old completion. Test lease arguments30/300/3600 separately: argument sets sweep cutoff globally, not per-row durable expires_at. Null locked_at behavior characterized exactly, not assumed stale if SQL only `<`. |
| P4 | Company lifecycle pause blocks pending/retry, remembers previousstate; active restores; processing treatment matches source (not blanketcancel). Invitation insert pending with key enqueues once; repeated intent idempotent; different company same key independent. Rollback invitation leaves no job. Sent invitation replay must not call synthetic provider again. |
| R1 | Each TS family: inject native constraint/error at finalizer after fake provider accepted; distinguish rejected mutation from0rows; run actual recovery once then replay once; uncertain is never autoqueued unless real operator path invoked. Assert all durable rows and projections, not just summary counts. |

SQLSTATE checks must allow the **actual** source-defined exception class (e.g. provisioning raises genericP0001); record message code separately without asserting an invented code. For status guard trigger rewrites, compare final persisted row, not merely UPDATE rowcount. Native matched-row evidence does not prove downstream provider idempotency.

## Residual scale: finite findings and minimum changes

The actual repository API configuration is `supabase/config.toml` `[api] max_rows=1000`, comments explicitly say table/view/RPC result payload limit. This is a local configured bound; deployed PostgREST configuration and tenant volumes were not read. A query `.limit(5000)` or `.limit(10000)` does not prove that an API configured for1000 returns that many rows. Plain PG17 SQL has no such API cap, so do not use the native claim lane to close response-pagination acceptance.

| Residual item | Current source/contract and evidence | Minimum next fix / acceptance |
|---|---|---|
| Analytics company enumeration | `listAnalyticsCompanyIds` now ordered id keyset pages200; existing Task7 proof covers >1000. Old omission fixed. | No further duplicate remediation. Preserve active/onboarding statuses and stable ID order. No snapshot/durable overall cursor claim. |
| Reconciliation company enumeration | `app/api/cron/reconciliation/daily/route.ts` selects company ids once, neq deleted_test_only, orderid, no pagination. SC8 actual route processes1000 of modeled1001. It catches returned per-company RPC error and still processes later companies: first-company abort is refuted for this ordinary error path. | Page by unique id below cap, preserve current status predicate, bounded concurrency4 and nested failure reporting. Test1001/zero/finalshortpage; one RPC error still reaches lastcompany; enumeration error propagates visibly. This is source-confirmed missing continuation under configured cap, not live omission. |
| Sum completeness | actual `sumRows` in monthlyMetricsBuilder reads column and reduces whole returned response, no pagination; SC1 gets1000 from1001 unit rows. Used for company/customer/zone/owner forecast_kwh and actual_kwh, diff_kwh/diff_percent. Company overview uses **“Prognos denna månad” / “Summerad prognosvolym”** (`app/admin/analytics/page.tsx:100`); platform company card consumes forecast/actual. This is a total, not a top-N leaderboard. | Exact tenant+period aggregate or stable complete paging with actual row identity; preserve quantities/filters and error handling. Verify1001 matching A rows plus B rows, empty/allNULL, period boundaries, and sums/ratios through persisted metrics and displayed consumer values. Do not silently cap. |
| Distinct completeness | actual `distinctCountRows` uses returned Set; SC2 yields1000 for1001 distinct customer_ids. Feeds `bidding_zone_monthly_metrics.customers_count` and `grid_owner_monthly_metrics.customers_count`. `getReportRows` exposes these full metrics rows via CSV; report definitions label “Prognos per SE-område” and “Prognos per nätägare”, no top-N distinct qualifier. The model uses unique customer ids; duplicate-heavy datasets need countDISTINCT semantics, not rowcount. | Exact distinct aggregate or complete paged Set; preserve existing falsey/NULL treatment intentionally. Test duplicate across page boundary + distinct1001 + othercompany; do not alter exact countRows, which SC3 confirms returns1001 via head/count exact. |
| Customer/owner metric coverage | private builders select customers.limit5000 and gridowners.limit1000 without order/cursor. Persist monthly rows only for returned identities; omitted identities have no continuation. This is a bounded source selection, not complete coverage. Current report CSV fetch limits are a separate consumer boundary; expanding builder cannot silently certify export completeness. | Stable ID paging for builders; check every write error. Test5001 customers/1001owners with APIcap1000, late-page error and replay uniqueness. No cap-ranking contract found in builder; absence of production volume remains explicit. |
| Forecast point/actual coverage | `generateForecastRunItems` selects active points.limit10000 without continuation, sums a single per-point actualRows response, inserts returned points then marks run completed. Missing point continuation and capped actual sums are source-supported; no new full forecast runtime probe was run. It creates a fresh run each invocation, not a resume cursor. | Complete bounded point paging and exact actual sum; persist progress for chosen run if deadline/resume is required. Do not certify completed when a page/read/item/finalstatus write failed. Test10001points/cap1000 and onepoint1001actuals, late-page failure, resume/replay item identity using real forecast constraints. |
| First-company failure | SC4–7 actual daily/monthly analytics, forecast and DQ POST modules list A/B then Aworker throws: Bnever runs. All four for-loops lack localcatch. This is a deterministic source/runtime defect relative to point85 failure isolation; not speculation from a limit. | Isolate per-company errors with explicit counts/outcomes while retaining failure visibility; confirm Bprocessed after Afails. Do not swallow failures or report universal success. Billing monthly is already separately owned; no duplicate fix here. |
| DQ sample caps | dataQuality scan limits points/customers5000, invalid rows1000 and failed/slow/deviation windows500; returns issues added, not explicit total rows audited. Repeated unordered windows provide no durable continuation. | Treat as bounded scans until product contract says exhaustive per run or rotating coverage. If acceptance requires coverage, add stable continuation and scanned/remaining/partial evidence. Do not label all500-row limits defects merely because finite. Full dataset/latency not measured. |
| Driver deadline/resume | Four analytics/forecast/DQ routes have no persisted company cursor, end-to-end deadline or resume record. An exception loses in-memory progress; forecast can retain running partial run. Source cap removal increases possible work and cannot alone prove schedule completion. | A finite acceptance contract must choose per-run budget and stable run/company/item cursor, checkpoint only after durable unit completion, and explicit failed-company replay. Deadline injection before nextunit -> no new work, persist resume; replay resumes without duplicate completedunit or crosscompany carryover. Numeric deployment budget is unresolved; do not choose one from assumed Vercel lifetime. |

Minimum confirmed remediation scope for the parent: reconciliation company pagination; full sum/distinct calculation; builder customer/owner and forecast point continuation (with actual write/error semantics); per-company failure isolation in four drivers. Deadline/resume needs an explicit finite job-run contract, not a guessed deployed duration. DQ coverage/fairness remains bounded/intentional-or-unresolved until an exhaustive/rotating acceptance requirement is selected. None requires reopening fixed analytics company pagination. No production incident/volume claim is made.

## Executed focused scale probe — exact eight cases

Command: from repository root, `node /tmp/job-scale-contract-probe.mjs`; Node24 built-in stripTypeScriptTypes/vm only, no project dependencies. SC1 sum, SC2 distinct, SC3 exact-count control, SC4–7 four actual drivers, SC8 actual reconciliation including first-RPC-error continuation control. All passed (exit0). The fake query response deliberately models the configured1000 cap and one eligible tenant population; it does not prove native filtering, deployed PostgREST behavior or actual volume. For native A/B tenant correctness use the cases above.

The exact executable source follows; save its code block as `/tmp/job-scale-contract-probe.mjs` and rerun the same command. It asserts **current defects**, so after remediation invert affected assertions to full coverage/continued companies.

```js
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
function load(path,names,deps={}) { const js=stripTypeScriptTypes(readFileSync(path,'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm,'').replace(/^export /gm,''); const c=vm.createContext({console,Date,Error,Buffer,process:{env:{}},...deps});vm.runInContext(js+'\nglobalThis.actual={'+names.join(',')+'}',c);return c.actual; }
const all=Array.from({length:1001},(_,i)=>({id:String(i+1).padStart(4,'0'),company_id:'A',quantity:1,customer_id:String(i+1)}));
const db={from(){let exact=false;const q={select(_c,o){exact=Boolean(o?.head&&o?.count==='exact');return q},eq(){return q},neq(){return q},order(){return q},then(ok){return Promise.resolve({data:exact?null:all.slice(0,1000),count:exact?all.length:null,error:null}).then(ok)}};return q}};
const metrics=load('lib/analytics/monthlyMetricsBuilder.ts',['sumRows','distinctCountRows','countRows'],{supabaseService:db,asNumber:Number});
assert.equal(await metrics.sumRows('synthetic','quantity','A'),1000);
assert.equal(await metrics.distinctCountRows('synthetic','customer_id','A'),1000);
assert.equal(await metrics.countRows('synthetic','A'),1001);
console.log('SC1-3 PASS: actual sums/distinct truncate capped response; exact head count does not.');
for(const [path,worker] of [['analytics/daily','buildCompanyMonthlyMetrics'],['analytics/monthly','buildCompanyMonthlyMetrics'],['forecast/run','runCompanyForecast'],['data-quality/scan','scanCompanyDataQuality']]) {
 const called=[]; const deps={NextResponse:{json:x=>x},isAnalyticsCronAuthorized:()=>true,listAnalyticsCompanyIds:async()=>['A','B'],monthStart:()=> '2026-09-01',addMonths:()=> '2026-08-01'};
 deps[worker]=async input=>{called.push(typeof input==='string'?input:input.companyId);throw Error('synthetic first-company failure')};
 const route=load('app/api/cron/'+path+'/route.ts',['POST'],deps);
 await assert.rejects(route.POST({nextUrl:{searchParams:{get:()=>null}}}),/synthetic first-company failure/);assert.deepEqual(called,['A']);console.log('SC driver PASS: '+path+' aborts before B.');
}
const calls=[];
const concurrency=load('lib/performance/mapWithConcurrency.ts',['mapWithConcurrency']);
const recon=load('app/api/cron/reconciliation/daily/route.ts',['GET'],{...concurrency,NextResponse:{json:x=>x},authorizeScheduledRequest:()=>true,assertPlatformSchemaReady:async()=>{},withAutomationLock:async x=>x.run(),runProductionConsistencyChecks:async()=>({}),supabaseService:{...db,rpc:async(_n,{p_company_id})=>{calls.push(p_company_id);return {data:null,error:p_company_id==='0001'?{code:'synthetic'}:null}}}});
const result=await recon.GET({nextUrl:{searchParams:{get:()=>null}}});assert.equal(calls.length,1000);assert(!calls.includes('1001'));assert(calls.includes('1000'));assert.equal(result.result.canonicalArchitecture.failed_count,1);
console.log('SC8 PASS: actual reconciliation omits capped company1001; returned per-company error does not abort later companies.');
console.log('PASS 8 finite assertions/families; synthetic response cap, not PostgREST or native PG.');
```

## Source hash manifest

SHA256 of full parent files. The future source-slice runner must additionally pin extracted byte spans/slice hashes; no generated SQL fixture was executed here.

```text
a7494eaceb1954628556e91cc36d707cad07d2d78d95b16f830722cc3fff23fc  scripts/canonical-auth-provisioning-legacy-batch.py
209b0c391bcfa957ec8b30cfc338622b4bda776e6976d3624fdd2d04779b8914  scripts/sql/gridex-supabase-compatible-bootstrap.sql
b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30  supabase/schema.sql
b70b0dc8885304790bb5f0b019c7a5b83e4f48f23d7cf1bc2e4b859e913e0919  supabase/config.toml
3a8481df51ec0c220dd455f2849893e418cc13fe06756575fed8bd6add6e4a5d  lib/email/manualEmailOutbox.ts
1f690dc6f9aab632982dcd5842ef0df2e6b668b940af23e58f408cb561eb1cc5  lib/email/emailOutbox.ts
66106fd7d941f3ccd41978fc419b7aad6f38eec218c31d65be3b4a2afc9b7ca8  lib/events/domainEvents.ts
a321640063ea18763bbe4f9338fac8d34620aa7730cef3a9d48e5926952a1e75  lib/integrations/webhooks.ts
cf0fc3db5270e5921965bf1c9e95964083d2bc129e153cb390a4f40ba4023be7  lib/inbound-mail/manualMailboxPoller.ts
d1dd1957f6ff85a123377293fc2fcd23f6329c997d977a2f33cba88f27b0cad7  lib/inbound-mail/edielMailboxPoller.part-1.ts
049b7ca94d9db2e11d2075ec2d84e9759b9a3f619420ff3588555b652a26e2bc  lib/inbound-mail/edielMailboxPoller.part-2.ts
b51f62e1550df5b515a4f58029e81552722a870627b2172438c5760a7d6ec548  lib/pricing/spot/spotImportJobs.ts
ef39a43935465834cee6e1889bab38b63641e43f5849a04e3bf6a90ff04033c7  lib/pricing/spot/spotPriceImporter.ts
bb1bdf650b081981604329be842dddef860df8513f3db8ad021b3505a3df6da1  lib/pricing/spot/elprisetJustNuClient.ts
066d49d31a039750da695255dcf2a247191a425405d2dafa0b0b208661a17ea0  lib/customer-operations/automation.part-1.ts
4c112ac3b33897a06200846460266de48c38cb0a3e6a11bdee7ed8524d9c328a  lib/customer-operations/automation.part-3.ts
ac0eb5a39a9b6b25468f52a5db9503efc7cacc45afbc0a73aed40eb01eb24708  lib/tenant/provisioningWorker.ts
48e2f957953d936ad95a59b961d960bf854354d8128cd310a742b675ee5482d4  lib/automation/locks.ts
954d015bfaffe27c2b493fb0475663219d4251e1edaa495ffe0db8428558bfb8  lib/analytics/cron.ts
ede7fe28b5988947ea8de8acc2fb3bbafbb3ab73bc81e028dc287e12a199c0e6  lib/analytics/monthlyMetricsBuilder.ts
79a968cd72d3e93b0805fbc324947e43872bb98c66a86ba451c8a96ac450ec2b  lib/analytics/dataQuality.ts
59cdadfcfd838043de6c3619e009b9bc370e57c39697032fa80d7453fdff1b42  lib/analytics/db.ts
07f67b39ef5f8acb0d7ee6505f0ecf1d5ce214a357765bacebfeed1ff539ebe4  lib/forecasting/forecastRuns.ts
ac5e37ed070d26dd52c8eed7dcd438e012af6e58a3dc26e81ee25ce7b7130fb8  app/admin/analytics/page.tsx
61f210422ccaceee18a6520af70e8735f74fef39680e1b5ba52b53546bb26034  app/admin/analytics/reports/page.tsx
7bd2a167509c1da00bfb3041e932c38493900522e8ebb16d460068cc613534f3  app/admin/analytics/export/route.ts
a398ff9e48c06d006330a58e02e288510a90bcc97fc8dd1bf4089330b3c8ce00  app/api/cron/reconciliation/daily/route.ts
6baff71c692af8a86a901ac0f66d03e971d350a950acd6b55b7006786e0f0a9f  app/api/cron/analytics/daily/route.ts
bb13c243e88435e1624a588dfa22447adeee7a121d802d8425e59ad86324054b  app/api/cron/analytics/monthly/route.ts
66ad46f2d4a5cdafa77a7aaed6b115f871d69c432286bab444171b28158f1186  app/api/cron/forecast/run/route.ts
2173edffe3ff8459647dcc76b73b69a8d8276882a0a46956a5cf03113a406b03  app/api/cron/data-quality/scan/route.ts
704942247042b3338688e84ec07f8b94101ac2e881d802015aaabee2754b58db  lib/performance/mapWithConcurrency.ts
02e8e31077ad75ec3e1e753dcea72da819fc5f89484c430f2007e4fbf55e42be  supabase/migrations/20260712100000_gridex_end_to_end_integrity_hardening.sql
d9b63125c2275041a7e19ae943a493fac4033e1a63611139ea7d7acb5f645d87  supabase/migrations/20260819070622_pr164_review_remediation_v2.sql
16e91ef52b4f24cfc4cf45576f48fef8ce488a5f517535eea391739e924feae5  supabase/migrations/20260818121500_master_production_remediation_p0.sql
390b0223a8fbafb633795f1ad0116d6cf8ebbddea056226be84711e7d878a4b8  supabase/migrations/20260810193450_canonical_access_provisioning_runtime_v1.sql
12fb80b8c13f7e105e4c5b63a6145e863872874fd4a2caaea9f669df5a80010d  supabase/migrations/20260810224500_canonical_review_remediation_v1.sql
bc2a4685be28c810dfb55abfee93575ae6e71e4167bad717bd3b6eb5e5cb97b6  supabase/migrations/20260724120000_canonical_market_resolution_quote_billing_flow.sql
88831015a6f70723b647bc9e6b5091a3c56c40f16ce48ee824456577b10c8c9a  supabase/migrations/20260902094500_decouple_contract_sales_from_ediel_send_state.sql
335fa9593acbb32951250e1aa88b7c6914b1faadfd1d48fbfc6931fcbebc4aaf  supabase/migrations/20260626120000_gridex_manual_grid_owner_communication_pipeline.sql
406f50f00bb9a03ce7b0aa5f4c1b7da2391920668424938e06c162596370c1a4  supabase/migrations/20260703120000_gridex_manual_email_outbox_delivery_uncertain.sql
96a4402e5b642453a7358f55f9a5c93b2559a707df66b958a770318d10412930  supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql
fd6e9b289ad728a0f8a5193df5bb11d6ad8158069ee0e1464d1a6ab2744015c4  supabase/migrations/20260825093400_facility_geographic_owner_outbox_guard.sql
9b968ad24e76a63b00610fe28f3add269e0f5de20ae681ed7ed71861cebc7023  supabase/migrations/20260824140830_website_poa_materialization_and_grid_owner_send_guard.sql
01869d0c91dc2d494d69b9184a39356360d3bf2c4eccc4e2c7de9064bec06a59  supabase/migrations/20260824132814_customer_application_runtime_contract_convergence.sql
a6f37c4e5a567d99d96442f5d4c3959a6fac266c51d2517167697ef1a73acab0  supabase/migrations/20260821144000_grid_owner_request_responsibility_and_template_audit.sql
0e26b35eef3fa863f149bf4c46be4018ff484d3d55c5434a64323fafde201775  supabase/migrations/20260520_batch_5_cases_audit_email_ux.sql
19e32d600488f06c24854c49ee5df6cc7534596638eb54769c1a327f6a11b9f0  supabase/migrations/20260531213000_resend_tenant_email_engine.sql
cbb9e4afe6ff1989d3efa5c2f1109286ba37c950c681ba90fbbcefb3e1c0f137  supabase/migrations/20260618200000_ops_production_hardening_resolver_queues.sql
8ade9bc75f77022dab3a8dd9ba84decd6ff0241ad8aa3dbc269ed381b9254017  supabase/migrations/20260618213000_ops_completion_workflows_health.sql
03be13ac213573978894b2261452c098ee0f082245e2387e60a0068ffffd9049  supabase/migrations/20260802015000_canonical_backfill_constraints.sql
e6ef68b18ede5729da067ce59a86cfca0db083d9d54a35ae0ed3a6c0968b96f2  supabase/migrations/20260531111600_system_readiness_foundation.sql
a5ca82d1c68f44c8542820e5d209fd5d31356a16e7eb1ccc827843a61e0ba690  supabase/migrations/20260528_batch_7a_route_inbound_mail_platform_ui.sql
035fcae108d4af8a5d31e9fa07f731f800a45a7551509b4ed6e79b435bcef701  supabase/migrations/20260626130000_gridex_manual_communication_mailboxes.sql
fcbace3668721747a2761ae120f2488589bb54c1ebcf25e932dbcd8ee611cf62  supabase/migrations/20260802012000_ediel_configuration_snapshots.sql
b79fd859d7659e81905e69c67f9de4476508cb6a7fcd49b00361cbebb872db86  supabase/migrations/20260618110000_customer_operation_automation_jobs.sql
93e016cc711a77815a663f036e7b60c006fc1a4f9f029467e10740b6e643035c  supabase/migrations/20260625100000_gridex_customer_operations_runtime_hotfix.sql
4a2f3730c57980b7bd4613362e1c767aef171d827cc1224a7cea11ac14ffa20f  supabase/migrations/20260709160000_advisor_function_search_path.sql
88bf5a6b7e0dc4d89b1621f1e3d551a6cd407135950f48ff05a37022df653b2f  supabase/migrations/20260804121000_multitenant_website_application_flow_completion.sql
e0ba4c948a5a7dbff8a12a8a5224b16fdc821cca8a6a717c2fc94dadbfa4c9ab  supabase/migrations/20260824150500_customer_application_dependency_wait_state_projection.sql
3fd8ba9493783bcd1ffd5e446a0911fdf9ec306a8054dde99eecbb6701d4d012  supabase/migrations/20260821165300_prodat_identity_and_z02_li_compliance.sql
cf8d81ac33d8687a817fba537791e25d89ccaf3f7ee342988ddb1dc0a9141d0b  supabase/migrations/20260903070000_harden_inbound_z02_required_payload_gate.sql
9ceaa0506831a7c2a10380eb4569ab38e26fc6919e9faf136d91e469d32f2300  supabase/migrations/20260903213000_z02_snapshot_market_context_guard.sql
3e40f894ec109a45e4dd7842edd819509caadac1e8d5e89a45d244224d0c77e1  supabase/migrations/20260904120000_canonical_tenant_invariant_convergence.sql
4fd103508d86a85ee41c168af90a25fdbbd546d17efea7ebcec91935c3c790fc  supabase/migrations/20260802014000_canonical_provisioning_access.sql
4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0  supabase/migrations/20260801143000_canonical_multitenant_platform_hardening.sql
```

Verification boundary: 8 synthetic scale cases executed; 0 native cases, 0 providers, 0 deployed/runtime-volume checks. Report-only change; native fixture build/execution and source-closure admission remain the next necessary gates.
