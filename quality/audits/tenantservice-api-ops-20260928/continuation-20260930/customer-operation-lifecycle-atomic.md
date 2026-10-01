# Atomic lifecycle event and unsent intent — 2026-09-30

Status: **LOCAL UNIT/POSTGRESQL-CORE VERIFIED; NATIVE PREPARED, NOT_EXECUTED**.
Root authorized this separate packet after the source-confirmed internal gap
in `site-switching-final-gap-review.md`. No original requirement is accepted
wholesale. Root owns integration, generated database artifacts, historical
checksums, hosted OPS evidence and workflow wiring.

## Exact ownership and behavior

- `lib/customers/customerOperationEvents.ts`: only mapped lifecycle events use
  the new atomic RPC. Required errors propagate and missing receipts fail closed.
  Unmapped timeline/domain telemetry retains its existing best-effort semantics.
- `lib/customer-operations/automation.part-3.ts`: root authorized only the
  supplier-switch prepared event's payload line to remove transient `duplicate`.
  The worker result retains that diagnostic. The actual source flag changes
  false→true when reusing an existing switch; it is not approved event content.
- CLI-created new migration
  `20260930230204_customer_operation_lifecycle_intent_atomic.sql`: service-only
  public invoker wrapper→private invoker owner records timeline, domain event,
  queued webhook fanout intent and required queued lifecycle notification intent
  in one transaction. No transport, template rendering, supply activation,
  pricing or provider code executes in the transaction.
- New controlled actual-emitter/producer tests:
  `customer-operation-lifecycle-atomic-20260930.test.ts` and
  `customer-supplier-switch-intent-replay-20260930.test.ts` under `__tests__`.
- Exact core proof: `scripts/customer-operation-lifecycle-atomic-20260930.postgres.test.cjs`.
- Genuine disposable native config/test:
  `scripts/customer-operation-lifecycle-atomic-20260930.native.{config,test}.ts`.

The private function rebinds and holds current company/customer and supplied/
derived site, point and contract rows before replay. Conflicting canonical and
legacy site aliases fail closed. Parent jobs bind exact company/customer/site,
operation and any already selected point. A site-owned parent may legitimately
select its point later; its previously NULL point is not treated as a wrong
resource. Existing different bound points cannot be substituted. Mapped
aggregate types are limited to the actual inspected customer/customer_site/
metering_point callers and each aggregate ID binds the same resource.

An advisory transaction lock serializes the permanent company/source event;
existing unique indexes remain unchanged. Replay compares exact domain/timeline
event fields and notification resource tuple/JSON intent. JSON object key order
is immaterial. A changed payload/status/graph or other-company global domain
key collision fails without mutation. Completed notification history and
terminal fanout rows retain status/results rather than being requeued. Missing
pieces of an exact earlier event can be inserted on an exact retry; the last
required notification insertion's failure rolls those writes back as well.

The existing permanent notification key remains
`lifecycle_notification:${sourceEventId}:${template}` and its payload remains
`{event_type,source_event_id,contract_id,payload}`. When an older mapped caller
omits the event key, the existing stable source-event fallback is used as the
event/domain/timeline key too, so its coupled receipt can replay. This is not a
new provider delivery key. Unknown/unmapped templates are rejected by SQL.
Ordinary anon/authenticated cannot execute either owner; current_user must be
service_role even for a privileged database owner's direct invocation.

The transient `duplicate` field is absent from required fields in the frozen
paired .3 OpenAPI. `publicPortalEvent` projects only public reference/type/
version/time/source, and supplier-switch webhook projections whitelist lifecycle
fields without this diagnostic. No immutable JSON/route/guide was rewritten.

## Executed RED/GREEN and limits

1. Actual existing emitter with controlled persistence boundaries: RED3 failed/
   1 passed; required enqueue fault was swallowed and a missing atomic receipt
   was accepted. Narrow mapped-RPC branch GREEN4/4. Controlled boundaries prove
   source behavior; actual database rollback is proved separately below.
2. Actual supplier producer plus actual emitter with controlled RPC boundary:
   first false/second true duplicate under the same request key produced actual
   second-call23505. After the single authorized producer-line correction,
   repeated approved event input is identical and one permanent receipt remains;
   first/second worker diagnostics remain false/true. GREEN1/1.
3. Actual complete candidate SQL on PostgreSQL core with actual four effect
   table/index definitions: initial6/6 PASS. Self-review then reproduced6 PASS/
   2 FAIL for conflicting point aliases and unknown unscoped aggregate; guards
   yielded8/8. A real valid site-parent/NULL-point case reproduced8 PASS/1 FAIL,
   then the exact optional-point compatibility guard yielded final **9/9 PASS**.
   Late trigger fault in the final required INSERT leaves all four actual effect
   tables unchanged; clean retry commits once. Terminal replay preserves every
   row; changed payload/status/tenant and current resource mismatch fail. Role,
   malformed template and exact graph checks execute actual candidate functions.
4. Combined new emitter/producer and frozen graph/site controlled suites:
   **24/24 PASS**. Scoped TypeScript and ESLint PASS. The existing extracted
   automation file has its pre-existing unused `duplicate` import warning; no
   import cleanup outside the authorized producer line is included.
5. Native config actually rejects missing CI/status before any seed, with
   `lifecycle_atomic_disposable_ci_required`. Five genuine native scenarios are
   prepared. **0 native scenarios executed locally**: no Docker/psql stack.

PostgreSQL core has simplified resource tables, no complete historical
Supabase/RLS/correction triggers and one connection. It qualifies transaction,
comparison and function logic; actual four-call PostgREST concurrency and
full-history trigger/ACL compatibility require the native suite. A reconstructed
legacy contradictory row in core is not a claim that current insertion guards
can be bypassed in production.

## Native execution owned by root's existing OPS replay

After the new migration has applied to the real disposable stack and local
status/anon/service env keys are available:

```sh
npx vitest run --config scripts/customer-operation-lifecycle-atomic-20260930.native.config.ts
```

The five cases use independent fixtures and actual emitter/local Data API:
event receipt and terminal replay; scoped last-intent trigger fault plus exact
rollback/clean retry; four parallel same-key RPCs→one fresh/three replay and one
event package; legitimate site-owned parent with point chosen later; current
foreign site/point/contract replay denial, changed payload/unscoped aggregate
and actual anon/authenticated direct denial. Real canonical graph triggers stay
enabled. No invalid cross-customer ownership rewrite is used to fabricate a
native fixture. Temporary scoped fault trigger/function are removed in finally.
Only fixture queued intents are cancelled at suite cleanup to avoid unrelated
later workers claiming them; cleanup is not reported as application delivery.
Global fetch denies every origin except127.0.0.1:54321. Assertions require zero
communication/email outbox/webhook delivery/switch request/Ediel message.

## Transaction boundary and explicit remaining internal work

**Upstream supplier business preparation remains a separate transaction.**
`processSupplierSwitch` prepares/reuses the actual switch first, then records
this event package. The existing durable parent worker requeues technical errors
and recovers stale locks; propagation now prevents a successful worker result
when required intent persistence fails. The producer key and stable payload
allow approved preparation to be retried. The controlled producer replay and
native emitter retry do not qualify complete real worker/crash recovery or
make earlier switch preparation roll back with the event transaction.

`lib/ediel/flows/inboundBusinessStateMachineLegacy.ts` still directly calls
`enqueueCustomerLifecycleNotification` after separate business writes around
line604; its route/current-owner reachability and transactional follow-through
remain an explicit internal gap for separate adjudication. No broad legacy
writer equivalence or full positive Z02→supplier-switch→notification continuation
is inferred here. Existing `activate_customer_supply_v1` already commits its
welcome/domain/fanout intent atomically and remains untouched. Current delivery
recipient/consent policy, actual template/provider outbox retry and whole queue
fairness/performance remain separate evidence requirements.

Bounded original slices improved: T01/T02/T06/T09/T10/T20/T21/T22/T23/T24/T25/
T38/T39/T50 and U04/U06/U18. Native/full-business/legacy gaps remain explicit,
not labeled external-provider blockers or accepted by source presence.
