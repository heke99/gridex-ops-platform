# Remaining site/switching and reference-client gaps — 2026-09-30 continuation

Scope: original `masteruppdrag.md`, unchanged `requirements.csv`, actual site
producer/worker/readiness, lifecycle-notification enqueue/render/outbox and
existing disposable API proof infrastructure. Root requested a read-only audit,
then explicitly authorized a bounded resource-graph/idempotency repair and new
independent reference runtime proof after the concrete paths were reported.
No original requirement is renamed or accepted wholesale by this report.

Skill routing: reuse the session's repository knowledge, systematic debugging,
code review, Supabase tenant/ACL review and verification-before-completion.
Spec-to-code compliance was inspected; its separate full fan-out workflow is
not claimed executed by this bounded worker. Independent portal/requirements
workers checked the original-ID interpretation and existing evidence. No
deployment, provider activation, new architecture, broad performance change,
UI redesign or new hosted workflow is in this package.

## Original requirement interpretation

| Original slice | Actual meaning and bounded site relevance | Outstanding work |
|---|---|---|
| T04 | Resolver/normal sync must preserve restricted portal roles; it is not a supplier-switch criterion | Resolver read-only regression exists; normal sync/live ACL/current candidate evidence belongs to portal owner |
| T05 | Blocked portal account must not reactivate through lookup/retry | Existing actual portal-revocation SQL marker passed in candidate4b; full sync/account-recovery trace and real issuer remain separate |
| T12 | Phone-only mutation preserves other fields | Prior actual contact receipt exists; new reference runtime proof will target current candidate with authoritative customer/primary-contact snapshots |
| T01/T02/T06/T09/T10/T25/T50 | Current actor, tenant, customer and resource authority, including direct/legacy/replay paths | Site RPC/writer fences have prepared native negatives; lifecycle graph repair below; no blanket legacy-service-writer acceptance |
| T20/T21/T22/T23/T24/U06 | Atomic effects, revision and idempotent retry | Site command commits site+intent+snapshot+result+audit; pending native includes late failure and replay. Lifecycle gaps below are separate |
| T38/T39/U04/U18 | Late/duplicate events and truthful pending/error outcomes | Site stale-response/prepared-unsent code exists; actual positive Z02 continuation, notification retry and full native receipts still required |
| T40 | Bounded tenant influence | Requirements worker owns new fair customer claim; native pending. Email/provider queues are not accepted by that claim proof |
| T48/P6 | Actual OpenAPI/guide/reference client/runtime parity | Latest local .3 document/guide HTTP proof4/4 passes; authenticated client journey and exact-head OPS remain distinct |

## Existing implementation versus pending evidence

1. `gridex_save_customer_site_v1` in candidate migration
   `20260930192831_customer_site_registry_atomic_command.sql` atomically saves
   the authoritative site, revision, audit, command result, durable
   `request_customer_data` intent and request snapshot. The active unique index
   protects queued/running/waiting_response jobs, while terminal history permits
   explicit fresh intent. Old terminal-key suppression was disproven; no index
   change is needed for that hypothesis.
2. `automation.part-2.ts::processCustomerDataRequest` and actual event emitter
   now consistently report prepared-but-unsent Z01 as `needs_review`, with exact
   `z01_prepared_pending_send_guard`, rather than claiming a dispatched wait.
   Existing6/6 unit proof uses the real consumer/emitter with controlled outer
   boundaries. No new provider approval is implied.
3. `automation.part-3.ts::processJob` rejects stale site snapshots. Initial
   site native9 cases cover terminal intent retention, real RPC→claim→worker
   persisted missing-contract blocker, stale active reuse/explicit restart,
   wrong-resource/current-session denial and real readiness blockers. Their
   final-candidate native suite is **NOT_EXECUTED here**. Candidate4b clean
   reached earlier SQL portal/contact markers, then failed first webhook-native
   cleanup before these site cases; no later suite PASS may be inferred.
4. `processInboundResponse` requires canonical atomic Z02 result, exact
   message/customer/site and verified point identity before enqueueing the
   switch continuation. `startSupplierSwitch` rechecks exact agreement/PDF/legal
   acceptance, site-bound POA/scope, tenant/customer graph, schedule, lifecycle
   and route. No positive whole continuation is qualified by missing-resource
   negatives. An isolated positive fixture needs those real local dependencies,
   with the provider entry held. This is principally missing fixture/evidence,
   not evidence that broad automatic switching should be newly implemented.
5. Current claim/worker uses lock tokens, stale-lock recovery, bounded attempts,
   retry scheduling and truthful terminal statuses. The requirements worker's
   new fair claim and exhausted-attempt finalization are independently owned.
   Actual technical-error→reclaim→completion and postcommit retry native cases
   remain required; source comments or source-string regression are insufficient.

## Concrete lifecycle resource and idempotency defects, now locally repaired

Owned source: `lib/customer-notifications/notificationOrchestrator.ts`.
Owned regression: `__tests__/customer-lifecycle-resource-graph-20260930.test.ts`.
The real orchestrator was executed with controlled database and downstream
email boundaries; no sender/provider success was qualified.

Actual first RED **10/10 failed**: the orchestrator read explicit site/point/
contract using company+id without customer ownership, accepted another site of
the same customer, selected the latest period/contract across that customer's
sites and allowed payload metadata to replace canonical resource attribution.
Replay accepted an existing permanent job without rechecking the resource graph.
The controlled downstream call received another site's start date and period.

The bounded repair binds company+customer+site+point+contract before enqueue,
replay and rendering; checks canonical/legacy site aliases; scopes period to
the actual point/contract; and writes canonical metadata after source payload.
Missing/mismatched resources return explicit `notification_resource_scope_mismatch`
before enqueue or the email boundary. Graph dependency errors fail closed.

A second actual RED **2 failed/11 passed** showed a valid different graph or
changed payload under the same permanent source/template key silently reused
the old job. Both existing-row and23505 conflict recovery now compare exact
customer/site/point and canonical JSON intent payload. Same logical payload with
reordered object keys replays the original row, including completed history;
different input returns `notification_idempotency_conflict` without mutation.
Final targeted **13/13 GREEN**. Real concurrent/native graph and provider
outbox effects remain unexecuted until disposable OPS qualification.

## Remaining internal transactional/authority gap and narrow proposal

At the initial read-only audit,
`lib/customers/customerOperationEvents.ts::emitCustomerOperationEvent` awaited
`emitDomainEvent`, then separately calls `enqueueCustomerLifecycleNotification`
and catches every enqueue failure as a warning. It is explicitly best-effort
telemetry, but mapped switch events also carry a required customer notification.
`automation.part-3.ts::processSupplierSwitch` calls it after preparing a switch
and then returns completed; `lib/ediel/flows/inboundBusinessStateMachineLegacy.ts`
also enqueues accepted/rejected lifecycle notification after separate business
writes. A crash/error in this gap can leave business effect without durable
notification intent. Searches for lifecycle-notification reconciliation in
lib/scripts/migrations found no owner that reconstructs the missed intention.
This is an **internal source-confirmed implementation gap**, not an external
provider blocker; persisted fault reproduction is still needed before repair.

Important exception: `activate_customer_supply_v1` in
`20260725120000_billing_readiness_and_supply_activation_v1.sql` already commits
its domain event, permanent welcome-notification job and webhook intent in the
same transaction. Do not replace or duplicate that accepted local intent.

Narrow proposal: keep operational timeline telemetry best-effort; commit mapped
required notification intent at the canonical business transition owner with
the existing permanent unique key and exact scope/payload conflict contract.
Use a forward service-only SQL operation/trigger only for the actual missing
transition owners, then execute the durable intent via the existing worker.
Preserve activation's existing intent. Persist a late enqueue fault before
acceptance and prove rollback or deterministic durable reconciliation; prove
same-key concurrent replay, different-payload conflict, current graph and
zero provider dispatch. Merely removing `.catch()` after commit does not make
this transactional and is not proposed as a fix. Root subsequently allocated
the emitter and unique forward atomic-intent migration to this worker. That
separately prepared package has controlled existing-emitter RED3 failed/1
passed→GREEN4/4 and exact PostgreSQL-core6/6 rollback/replay/graph/ACL checks.
Upstream supplier preparation remains a separate transaction. No whole business
atomicity, complete reconciliation, legacy inbound repair or native execution
is accepted by that package. Root still owns historical checksums, shared
generated artifacts and workflow wiring.

Current authority policy also needs explicit documentation/proof: lifecycle
jobs represent an already approved transition and need not automatically
inherit an expired interactive session, but still must distinguish that
approved follow-up from a not-yet-authorized sensitive action. Current
notification rendering rebinds current resources/email; current email dispatch
uses `getTenantOperationDecision(company,'email.send')`. There is no demonstrated
policy/test for changing relationship/recipient/consent after intent but before
send. Do not claim an unauthorized send exploit solely from an absent session
check or cancel already committed effects by inventing a stricter policy.

## Independent actual reference-client runtime proof

Root authorized new unique native config/test, fixture and request spec:
`scripts/customer-reference-runtime-20260930.native.{config,test}.ts` and
`e2e/browser/customer-reference-runtime-local.spec.mjs`. They will use existing
`seedReadActors` infrastructure with independent customers/clients and a
temporary RS256 issuer key, stored mode0600 only under RUNNER_TEMP, then call the
exported real reference client against actual local Next and real Supabase.
The reference module's syntheticServer is never started.

Target sequence: authenticated GET notifications→POST read→same-key replay→GET,
phone-only profile save/replay preserving email, same-tenant wrong customer and
foreign tenant rejection, live account/client expiry/revocation, native current
OPS-session replay rejection, and native after-read snapshots/counts.
Root additionally authorized a local forwarding proxy that receives and
verifies the actual completed Next write response, confirms native commit,
then destroys downstream transport before forwarding the response. A direct
same-key retry must leave one effect. This is genuine postcommit response loss,
not process-crash or real-provider evidence. No production hook is changed.

Status at this report checkpoint: reference proof **PREPARED, NOT_EXECUTED**.
Exact isolated seed/trust→new Next process→HTTP→native verification commands,
bounded schema scope and terminal revocation behavior are in
`customer-reference-runtime.md`. Playwright list registers three request cases;
no authenticated HTTP/native case has executed locally. The real irreversible
portal account guard remains enabled; revoked account/client state is never
restored. No shared workflow,
contract, generated artifact, historical migration, production/provider action,
commit or push has been performed by this worker.
