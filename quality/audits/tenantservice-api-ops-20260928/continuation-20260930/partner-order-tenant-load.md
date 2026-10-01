# Partner ordering and tenant load continuation — 2026-09-30

Status: **IMPLEMENTED_LOCAL_PROOF; native and final-candidate qualification pending**. This package closes confirmed local implementation gaps. It does not accept any whole original requirement, transfer earlier CI evidence to these new forwards, or claim a native/production performance result. Root owns registration, checksums, integration and publication into #422.

## Original requirement mapping

| Original ID | Exact requirement | This package | Remaining outcome |
| --- | --- | --- | --- |
| T38 | Sen eller duplicerad partnerhändelse återställer inte gammal data. | Invoice provider state decision, export projection, canonical invoice projection, event completion and durable intent become one locked transaction; completed duplicates have zero effects. Explicit canonical terminal status protects against a drifted export status. | Actual native simultaneous transactions and final-head replay pending. Other partner/profile writers, same-ranked distinct events and provider-specific causal/version ordering remain unqualified. |
| T39 | Partnerfel ger korrekt kö/status utan att stoppa all support. | Review reasons and safe persisted failure categories are scoped to the claimed event. A failed first event does not stop the next tenant's event. Missing canonical financial evidence produces review without fabricating an invoice. | Native schema/trigger behavior and actual independent API/OPS/portal support journey pending. External partner adapter behavior/credentials are separate dependent boundaries. |
| T40 | Belastning från en tenant ger inte obegränsad påverkan på andra. | Confirmed global customer-operation starvation is repaired with durable tenant turns, per-tenant caps, atomic SKIP LOCKED claims and bounded exhausted cleanup. Existing persisted client/route quota isolation is measured locally. | Other global queues and shared tenant/user/relevant-IP budgets are still implementable local gaps. Actual deployed noisy/quiet workload, database-call/byte/latency budgets and WAF configuration remain unqualified. |

The complete original75 inventory and initial status mapping remain in `webhook-fairness.md`. These three paths cannot replace the original API/tenantservice/OPS masterplan or the unknown whole-OPS business-action denominator.

## Confirmed RED observations

1. The former provider processor read `invoice_export_items.provider_status`, applied its rank decision, then issued separate item and portal writes without a rank CAS or shared transaction. A controlled actual-source boundary diagnostic let overdue read unpaid, held its item write, completed a second paid worker, then released overdue. Both projections regressed to overdue. The original diagnostic had **2 expected failures / 1 pass**: concurrent regression and plain Supabase failure becoming `unknown_error`; serial paid-before-overdue already passed. That exploratory diagnostic was replaced by bounded command-boundary tests and actual-SQL core proofs below, rather than retaining a fabricated database/provider implementation as GREEN evidence.
2. The current canonical claim before this forward (`20260819070622_pr164_review_remediation_v2.sql`) selected global priority/run-after/created order. Actual PostgreSQL-core execution with250 older noisy jobs and1 later quiet job, limit20, returned20 noisy and0 quiet. The new bounded-isolation assertion failed before the change. Bulk retry terminalization also affected an unbounded eligible backlog before normal claims.
3. Independent root review found an additional genuine canonical-drift defect in the first atomic candidate: issued canonical invoice `paid`, export `provider_status='unpaid'`, delayed overdue. A new actual-SQL regression produced **1/1 RED**, expected paid / actual overdue. After the locked canonical-terminal guard it is **GREEN**, with item, invoice, customer profile, domain events and outbox unchanged except processing completion of the stale provider event.

## Provider application

CLI-created forward: `20260930215935_invoice_provider_event_atomic_application.sql`. `lib/billing/providerEventProcessor.ts` calls one service-only invoker RPC with the exact claimed company/event/token/type/payload and the existing TypeScript mapper's state, finance, finite amount and currency classifications. Existing event/status mappings and numeric precedence are preserved, including invalid-first fallback. There is no second provider numeric parser or invented provider event semantics.

The database locks the current tenant-bound event, validates its claim token and exact stored snapshot, then locks the matched item using company/provider/environment/GUID and compares its current rank. It locks the existing canonical invoice and validates its customer and contract identity. Missing canonical invoice evidence yields `provider_invoice_canonical_snapshot_missing`/`needs_review`; it creates no financial invoice. Explicit canonical paid/cancelled/credited states also guard older lower-ranked state as `stale_canonical_invoice_state_ignored`. Generic portal `sent` is deliberately not interpreted as a provider rank.

Permitted lifecycle updates preserve issued amounts, customer/contract graph, provider request, GUID, original create/purchase `raw_payload`, calculation snapshot and hash. The same existing internal/public state event semantics are inserted into `domain_events` and `event_outbox` in that transaction, and only then is the provider event completed. A late outbox trigger error rolls item, portal, provider event and durable intent back together. Fan-out, actual transport and provider dispatch are separate workers and are not invoked by this proof.

For plain Supabase error objects the processor persists `provider_event_database_<SQLSTATE>` when a valid SQLSTATE exists, otherwise `provider_event_persistence_failed`. Missing RPC fails closed without reaching legacy item/portal writers. If failure-state persistence itself fails, its log contains only the safe category plus event ID; the next event still runs. Such an event remains processing until the existing stale-claim recovery, rather than claiming a failed-state write succeeded.

Completed exact-event duplicates return `provider_event_already_processed` and have zero effects. Different events with the same rank lack a proven provider causal/version contract; this package does not certify ordering of every same-ranked metadata correction or every other partner resource writer.

## Customer operation queue and measured quota

CLI-created forward: `20260930215937_customer_operation_tenant_fair_atomic_claim.sql`. It replaces the existing worker RPC name, keeping worker input normalization and1–100 batch clamping. A private service-only RLS turn table tracks last claims. Least recently served tenants are chosen first; priority/run-after/creation order remains within each tenant; first rows precede extras; cap5 per tenant and100 overall; row claims and durable turns commit together. SKIP LOCKED permits disjoint concurrent rows. A new company/due index supports the per-tenant selection.

Active/onboarding eligibility, lifecycle blocking, attempt/max-attempt rules, stale lock handling, retry diagnostics, heartbeat/token/worker fields and service-only ACL are preserved. Exhausted cleanup now locks and terminalizes at most the requested bounded batch, retaining the old status/error/stale/completion semantics and advancing remaining exhausted rows on subsequent invocations. The active idempotency index, command authority and later post-claim execution policy are unchanged.

Actual PostgreSQL-core result:250 noisy +1 quiet, limit20 -> **5 noisy +1 quiet**. Limit1 first serves the older noisy tenant and the next call serves the quiet tenant using persisted turns.35 exhausted noisy rows plus1 quiet row, limit1 -> **1 terminalized +1 quiet claimed**. Paused and lifecycle-blocked jobs remain unclaimed. The full historical schema, grants, queue executor and real concurrency remain native qualifications.

The exact current `integration_api_rate_limit_check` function was executed in a typed core fixture:100 noisy requests under limit5 -> **5 allowed /95 denied**; another tenant's first request count1; another client in the same tenant also count1. Persisted counters100/1/1 match those independent client/route buckets. Latest bounded local sample p50 **0.578ms**, p95 **0.929ms**; fair claim sample36.358ms. These are in-memory single-process observations, not production latency, a comparative improvement, a concurrency capacity result, or tenant-wide protection. The same-tenant other-client bucket remaining independent also demonstrates why shared tenant/user/IP budgets are not closed by this client-only limiter.

## Executed local checks

- Node22 Vitest adapter/mapper/error suite: **7/7 PASS**. It mocks only the persistence boundary and does not claim database transaction semantics.
- PGlite0.3.14/PostgreSQL17.5 executes the complete new provider SQL against focused typed prerequisites: **7/7 PASS**; current status/duplicate, missing canonical mirror, canonical-paid drift, low-role ACL, company/token/snapshot binding, late actual outbox trigger rollback, amount review/quiet-tenant independence.
- PGlite executes the complete new customer fair SQL and actual current client quota function: **5/5 PASS**; noisy/quiet batch, durable limit-one rotation and intra-tenant priority, bounded exhausted cleanup, tenant/lifecycle/retry eligibility, persisted quota isolation.
- Scoped ESLint: **PASS** for provider source and all owned TS tests/config/helper.
- `tsc --noEmit -p tsconfig.scripts.json`: **PASS**.
- Application `tsc --noEmit` with4096MB heap: **PASS**.
- `git diff --check`: **PASS**.

Local actual-SQL command (runtime dependency external to repository):

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/provider-order-continuation-20260930.postgres.test.cjs scripts/tenant-load-continuation-20260930.postgres.test.cjs
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config scripts/provider-order-continuation-20260930.config.ts
```

## Prepared native receipt and wiring boundary

`scripts/partner-queue-continuation-20260930-native.config.ts` requires CI plus a genuine local disposable Supabase status file with `API_URL=http://127.0.0.1:54321`; psql targets only that isolated local port. There are **10 authored, NOT_EXECUTED tests**:

- Customer queue4: original global-starvation query/new capped claim; stored limit-one turns; low roles and late private turn failure rollback; two actual PostgreSQL transactions claiming distinct rows with SKIP LOCKED.
- Provider6: two actual transactions with paid held and delayed overdue waiting on the item lock; tenant/token/snapshot/low-role zero effects; explicit canonical-paid drift preservation; late real outbox fault rollback; first-tenant review versus independent quiet-tenant completion; missing canonical mirror review without fabrication.

The fixture constructs actual ordinary non-portfolio customer→draft contract→underlay→locked pricing→sent export item→issued canonical invoice relationships, preserving all existing triggers/guards. It makes no claim about a portfolio invoice fixture. Immutable company/legal and issued financial graphs remain until disposable stack teardown. Cleanup deletes only own provider events, customer jobs and private turns; it does not delete companies, disable guards, unpublish legal history or rewrite an invoice to make cleanup succeed.

Wire webhook qualification first, then customer queue qualification before any other fixture leaves eligible customer jobs. The customer fixture asserts an initially quiet eligible queue and never resets another fixture's rows. Root must run the following command after candidate migrations and native schema generation, with the real saved status path:

```sh
CI=true GRIDEX_NATIVE_STATUS="$candidate_status_path" node node_modules/vitest/vitest.mjs run --config scripts/partner-queue-continuation-20260930-native.config.ts
```

There is no local Docker/psql native execution or native PASS claim. Genuine exact candidate head/tree, migration replay, generated artifact parity, native ACL/trigger/concurrency and final HTTP/browser receipts must be attached by the integrator after execution.

## Remaining implementable work and exact external boundaries

Existing global oldest-first selection remains in email outbox, invoice provider event claiming and approved invoice retry inventory. The frozen approved-retry path also needs separate evaluation of per-item preflight failure isolation. Those are local implementable T39/T40 gaps; lack of partner credentials does not block their isolated queue proofs. Provider matched-item absence remains reviewable and the old retry path does not supply a newly matched item; a separate authentic reconciliation/re-match capability is not supplied here.

Shared tenant/client/user/relevant-IP budgets, costly read/export budgets and genuine noisy/quiet measurements required by master16.6/17 remain open. Per-client quota evidence, bounded queue claims and local p50/p95 cannot replace deployed DB-call/byte/latency budgets or certify all tenant load paths. WAF can be qualified only where actual infrastructure supports it.

Actual partner communications/causal ordering contracts, real provider dispatch, hosted ingress/WAF and independently established issuer/caller/mandate/scanner authority are exact dependent external boundaries. Remaining local API/OPS/portal behavior, native commands, fairness and role/resource proofs must continue independently. No whole original requirement is converted to BLOCKED because one external dependency is absent.
