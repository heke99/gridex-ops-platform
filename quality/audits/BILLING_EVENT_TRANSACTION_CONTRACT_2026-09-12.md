# BILL03 provider-event transaction implementation contract

Date: 2026-09-12. Read-only design, not an implemented or native-verified fix. Initial audit baseline `41786027`; repository HEAD at final contract read `604b2e17f93901b81faa93e8c0dd5654e8854c7a`. Shared work continued during review. Historical migrations are source evidence, not proof that a target database has their resulting catalog. No production access, database reads, source changes, migrations, dependency installation, or agents were used for this contract.

## Decision and exact boundary

Implement one forward migration and a small runtime replacement: claim as today, then apply each persisted event in one PostgreSQL transaction. Lock the claimed event, fence its token, lock its exact invoice export item, decide the transition using the locked current state, update the invoice and portal, insert durable domain events and their outbox entries, and finish the event together. Keep provider HTTP requests and webhook delivery outside this transaction.

This closes BILL03's demonstrated distinct-event race and its processed-before-domain-event failure window. It does not establish atomic webhook receipt ingestion, exactly-once external HTTP delivery, or safety of unrelated direct invoice writers. The existing actual-module reproduction is `billing-audit-proof.cjs`; its paid-then-stale-overdue case is a red control. It exercises real TypeScript with mocked database operations, not PostgreSQL locking or triggers.

## Existing execution path and identities

1. `lib/billing/providerWebhooks.ts` validates bounded JSON, resolves exactly one export item by provider/GUID, resolves its tenant/environment connection, and verifies timestamped HMAC. It separately persists the receipt and provider event using ignore-duplicate upserts, then invokes the processor for newly inserted provider events. GUID lookup currently rejects ambiguous matches globally; its `(provider, provider_invoice_guid)` index is not itself unique. Do not resolve a company from a webhook-supplied company identifier.
2. `gridex_claim_invoice_provider_events` is defined in `20260712100000_gridex_end_to_end_integrity_hardening.sql`; no later replacement body was found. It uses event-row `FOR UPDATE SKIP LOCKED`, assigns one UUID token for a batch, increments attempts, and can reclaim processing rows older than 15 minutes. Optional company scope, age cutoff, and status filters remain significant. A processing row with null start time is not automatically reclaimed.
3. `lib/billing/providerEventProcessor.ts` currently reads each matching item without a lock, checks the rank in JavaScript, writes item, upserts portal, marks event processed using token/status predicates, then separately emits private and optional public domain events. The event token fences only the final event write; it does not fence preceding financial projections.
4. `lib/events/domainEvents.ts` writes `domain_events`, then a `webhook_fanout_v1` outbox job, then best-effort fanout. The durable destination is `destination_type='webhook'`, `destination_key='webhook_fanout_v1'`, attempts 0, max_attempts 12, payload `{event_type,aggregate_type,aggregate_id}`. Its worker creates deliveries and handles retry. Use these tables, not the separate `canonical_domain_events`/`canonical_event_outbox` bridge.
5. Portal writes invoke real triggers: canonical customer/contract graph checks, public-reference generation, portfolio evidence checks, underlay invoice projection, and for Partner API customers a resource domain event plus direct `webhook_deliveries` insertion. All effects belong to the applying transaction.

| Identity | Current source contract / requirement |
| --- | --- |
| Provider event | PK `id`; unique `(company_id,provider,environment,idempotency_hash)` from July 28 sync, replacing the July 12 partial index. Null keys remain possible historically. New receipt ingestion supplies its stable key. |
| Exact event target | Match item `id`, `company_id`, `provider`, `environment`, and `provider_invoice_guid` together. Event-to-item composite tenant FK is additional protection, not a substitute for all five comparisons. |
| Portal | Unique partial index `(company_id,invoice_export_item_id) WHERE invoice_export_item_id IS NOT NULL`; company/item composite FK. SQL upsert must use an inference predicate matching this partial index. |
| Portal provider reference | Latest named UNIQUE constraint `(company_id,partner_invoice_reference)` from August 5. A collision on a different item is an error/review condition; never reassign its owner. |
| Public portal reference | `(company_id,invoice_reference)` unique; generated reference is stable when the row/company identity is unchanged. |
| Domain event | Global partial unique `idempotency_key`; therefore all new provider keys must include company and provider-event ID. Verify tenant and aggregate when reusing a conflict. |
| Outbox | Unique destination per domain event, with expression and non-null destination-key variants in historical sources; use the actual non-null-key index definition for conflict inference and verify tenant. |
| Other invoice identities | Provider request/idempotency/provider_invoice_id unique keys do not prove GUID uniqueness. Preserve them and sent/locked-pricing guards. No GUID uniqueness redesign is needed to fix BILL03. |

The receipt-only domain key `billing-provider-webhook:${provider}:${environment}:${externalEventId}` currently omits company and is used with a global domain-event key lookup. This is outside the proposed event-apply transaction; do not silently claim it is repaired by this work.

## Proposed SQL API and stable replay receipt

```
public.gridex_apply_invoice_provider_event_v1(
  p_company_id uuid,
  p_event_id uuid,
  p_processing_token uuid
) returns jsonb
```

All three inputs are mandatory. Derive target, provider, environment, state, amounts, and payload from the persisted event and locked canonical item; accept no caller-supplied state, invoice totals, tenant overrides, or portal graph. Use a fixed trusted search path with schema-qualified relations/helpers. Revoke PUBLIC, anon, and authenticated execution; grant service_role only. A runtime role check, if included, must reject null claims (`auth.role() IS DISTINCT FROM 'service_role'`), with tests setting the same service claim used by PostgREST. Do not use SECURITY DEFINER `current_user` as caller identity.

Add two nullable columns to `invoice_provider_events`: `completed_processing_token uuid` and `processing_result jsonb`. Do not backfill invented successful receipts. Add a pair-consistency/object-shape check for new receipts. A receipt is created only for a transaction committed by this function and contains:

```
{
  "version": 1,
  "eventId": "uuid",
  "outcome": "processed | needs_review",
  "reason": "stable reason or null",
  "invoiceExportItemId": "uuid or null",
  "providerState": "normalized state or null",
  "portalInvoiceId": "uuid or null",
  "domainEventIds": ["uuid"],
  "completedAt": "one transaction timestamp"
}
```

The receipt excludes the claim token and raw provider payload. Return the stored JSON exactly on same-token replay after completion; do not return a changing replay flag/timestamp. Persisting the completed token allows successful response loss to be recovered without replaying mutations. For legacy processed rows with no receipt, return a stable explicit `skipped/legacy_event_already_processed` result; do not synthesize downstream events automatically. Wrong company must not reveal the event; missing row or lost/wrong token returns a stable `skipped/provider_event_claim_lost` result with no writes. Invalid null arguments fail `22023` before any read.

Within the transaction:

1. Select the event by company/id `FOR UPDATE`. For completed status with matching completed token and receipt, return the receipt. Otherwise require status `processing` and exact non-null current token before any invoice/portal/domain write. A new claim takes precedence over an older completion receipt. A token does not expire merely because 15 minutes elapse; replacement by the claim routine invalidates it. Holding the event row lock prevents reclamation during apply.
2. Validate required persisted event identity; missing identity completes this claim as `needs_review/provider_event_identity_incomplete`, event-only. Lock the exact matching invoice item `FOR UPDATE`; missing match completes `needs_review/no_matching_export_item`. Lock order is event, item, portal, then trigger effects. Apply one event per RPC, not a transaction spanning the whole claimed batch.
3. Validate amount/currency, normalize state, and compare with the locked current provider state. Unknown incoming state is `needs_review/unknown_provider_state`. Lower rank is `processed/stale_provider_state_ignored`, with no item, portal, domain event, or outbox write. Equal rank from a distinct event remains accepted under current rules. Treat an unrecognized nonempty stored current state as explicit review, not an accidental undefined-rank comparison.
4. Update the item from the locked row and return its new row. Preserve immutable invoice financials, pricing/underlay/customer identity, request payload, and GUID. Update provider status, status_payload's four last-event fields, reconciliation status/timestamps, and optional invoice number/OCR/finance state according to existing aliases. Use one captured timestamp consistently. No recomputation of pricing or VAT belongs here.
5. For states with a portal projection, require the same canonical customer and customer-contract evidence currently required by `upsertPortalInvoice`. Upsert only the same company/item graph; explicitly reject an existing mirror belonging to another customer or contract rather than reparenting it. Carry the three export aliases, provider reference, number, canonical period/quantity/totals, source, raw payload and status. Preserve unrelated metadata, settlement/calculation snapshots, public reference, due date and issue date. Preserve paid_at when the state does not supply a new paid value. Require the upsert to return exactly one row; triggers must remain enabled.
6. Insert the private domain event and optional public event plus each durable fanout job. Conflicting idempotency rows can only be reused after checking their company, event type, aggregate and intended payload; a conflicting foreign identity fails closed. Do not treat an arbitrary 23505 as success. Require every intended inserted/reused outbox row to exist with the matching event/company/destination; a trigger suppressing an insertion must not silently succeed.
7. Set event status/outcome, processed_at, failure_reason, completion token/receipt; clear current token/start time. Return the receipt. The enclosing RPC transaction commits all of this together. Any unexpected constraint, trigger, domain-event or outbox failure rolls back every business write and completion receipt. Do not catch SQL exceptions around only part of the effects and then mark success.

The existing claim routine can retain its body: its SETOF return accommodates added columns and the old receipt is ignored while a new status/token is processing. On retryable needs_review/failed claims, the new successful completion replaces the receipt/token. Test this explicitly. Do not widen its recovery age window or automatically resurrect dead_letter/legacy-processed rows as part of this fix.

## State, cancellation, credit and numeric semantics

| State | Rank | Portal status | Export status change | Additional public event |
| --- | ---: | --- | --- | --- |
| unknown | -1 | none; review | none | none |
| registered | 0 | sent | none | none |
| unpaid | 1 | sent | none | none |
| partially_paid | 2 | sent | none | none |
| overdue | 3 | overdue | none | none |
| reminder_sent | 4 | overdue | none | none |
| collection | 5 | overdue | none | none |
| paid | 10 | paid | none | invoice.paid |
| disputed | 11 | unchanged; no portal upsert | disputed | invoice.disputed |
| cancelled | 12 | cancelled | cancelled only when current export status is not sent | none |
| credited | 13 | credited | credited | none |

Preserve the current precedence for this concurrency fix. In particular, paid may advance to disputed/cancelled/credited, credited cannot regress, cancellation of a sent item leaves its export status sent, and disputed leaves portal/underlay state unchanged. No refund, chargeback, payment reversal, balance adjustment, credit-note creation, or negative-price mutation is implemented by this state machine. Unrecognized refund event types with no recognized payload status go to review. The resolver currently allows a recognized payload status even when the event type itself is unrecognized; preserve this explicitly or review a separate policy change.

Resolver precedence: normalized event type first; otherwise `invoice_status ?? invoiceStatus ?? status`, first as a mapped string then as a number. Normalize trim/lowercase and replace each non `[a-z0-9_.]` character with underscore. Aliases include invoice.created→registered, invoice.payment→paid, invoice.reminder→reminder_sent, invoice.credit→credited, invoice-prefixed and bare canonical states. Capway bit checks run in this order: 1 paid, 4 overdue, 8 reminder, 16 collection, 64 credited, 2 unpaid; otherwise registered. This is precedence, not highest-ranked bit selection.

The existing JS number parser accepts finite numbers or nonempty strings after replacing the first comma with a dot; bitwise operations then apply ToInt32. A SQL port needs a table-driven parity test, including 0, combinations (65 is paid), signed/overflow/fractional values and numeric strings. Do not accidentally use SQL boolean JSON coercion, truncate aliases differently, or cast malformed inputs before classifying them. If the author intentionally restricts malformed/out-of-range values to review, document that as a separate fail-closed behavior change and test it; it is not existing parity.

Amount aliases are first successfully parsed `amount_inc_vat`, then `amountIncVat`, then `total_amount`; current tolerance is absolute difference greater than 0.01, and optional currency comparison is case-insensitive against canonical currency (historically SEK fallback). Absent amount/currency does not fail today. Preserve the invoice total; a payment amount is not permission to rewrite its total. Paid timestamp uses payload paid_at/paidAt or first-application time; replay of the same event must preserve it. Invalid timestamps must fail/review before partial effects. Finance normalizer maps purchasedwithoutrecourse/2, purchasedwithrecourse/3, recoursed/4, pledged/5, service/1, ownledger/0, otherwise normalizes the text. Existing processor only passes nonempty text finance values.

Private key: `invoice-provider-state:${companyId}:${eventId}`; type `invoice.provider.${state}`, source billing_provider_webhook, aggregate invoice_export_item/itemId, subject canonical customer, payload provider/environment/GUID/state/export status. Public key: `invoice-public-state:${companyId}:${eventId}:${publicEventType}`, same source/aggregate/subject, payload GUID/invoice number/state. The old public payload uses the pre-update number whereas its portal uses the updated number; use the returned updated item consistently and record this narrow traceability correction in review.

Two other narrow decisions must be explicit in implementation review: the existing portal insert omits currency (default SEK), and period_start can fall back to metadata.billing_month. Do not silently claim strict canonical financial completeness while preserving those fallbacks. BILL03 can preserve those semantics without repricing; stricter evidence/currency changes belong in a separately identified change with tests.

## Actual schema sources and fixture prerequisites

Use pinned repository bytes and an explicit finite fixture manifest. Do not apply only the oldest table DDL, shadow the real trigger bodies, or assume generated TypeScript types prove the latest schema. Historical migrations frequently contain unrelated data repairs; extract reviewed prerequisite definitions into an explicitly scoped fixture, but execute the new forward migration as one complete unchanged file.

| Source under `supabase/migrations/` | Required surface for this work |
| --- | --- |
| `02_db1_operations_ediel_billing_dedupe_and_storage.sql` | Original customer_invoices DDL/defaults, relevant parents. |
| `20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql` | Provider connections, export runs/items, provider events, initial indexes/checks. |
| `20260531111600_system_readiness_foundation.sql`; repeated foundation `20260609162000_batch_7_website_integration_foundation.sql` | domain_events, event_outbox, webhook tables, defaults and unique indexes. Resolve both actual definitions rather than inventing a simplified outbox. |
| `20260702130000_gridex_invoice_export_attempts_retry.sql` | Expanded export status check including rejected/configuration_error/failed_retryable/needs_review. |
| `20260702150000_gridex_sent_invoice_protection.sql` | Complete sent/credited financial/GUID update and delete guard. |
| `20260712100000_gridex_end_to_end_integrity_hardening.sql` | Claim columns/function/grants, event statuses, composite tenant FKs, reconciliation fields, provider request/idempotency identities. |
| `20260727010000_contract_flow_integrity_completion.sql` | Item period/quantity/currency and customer contract columns; portal aliases; canonical composite FKs, partial portal unique index, complete chain guard function/registrations. |
| `20260727164000_canonical_invoice_export_runtime_completion.sql` | Existing graph-creation atomic wrapper is a transaction pattern, not the provider-event API or the webhook fanout destination contract. |
| `20260728170000_live_schema_code_canonical_sync.sql` | Latest provider-event/receipt idempotency indexes and nullable historical environment rules; portal status enum. |
| `20260801143000_canonical_multitenant_platform_hardening.sql` | Parent company/id keys; company-required NOT VALID checks and domain/outbox tenant composite FKs. NOT VALID still checks new writes. |
| `20260805085617_api_contract_billing_tenant_hardening.sql` | Portal company/provider-reference uniqueness and canonical tenant constraints. |
| `20260718162000_portfolio_publication_billing_alignment.sql`; `20260803150723_portfolio_mix_share_billing_completion.sql` | Portfolio columns and guard registration, then latest guard body including fixed-share evidence. Status writes trigger it. |
| `20260810110149_customer_invoice_public_reference.sql`; `20260816101505_partner_api_v1_multicompany_foundation.sql` | Stable public invoice reference and latest related reference prerequisites. |
| `20260816170000_partner_api_v1_canonical_surface_events.sql` | Complete private invoice-resource trigger and emitting helper; company/customer references, subscription filter, direct delivery uniqueness and payload schema. |
| `20260818121500_master_production_remediation_p0.sql` | Outbox suppression trigger only suppresses internal customer-onboarding-orchestrator; prove webhook_fanout_v1 survives. |
| `20260820113132_invoice_export_locked_pricing_guard.sql` | Exact-company locked-pricing-run insertion/update guard. |
| `20260826213000_invoice_review_projection_sync.sql` | Latest portal→underlay projection function and trigger. Paid/sent/overdue become invoiced; credited/cancelled project accordingly; failed→needs_review; unmatched company/customer/underlay raises 23514. |

Finite relations needed: invoice_provider_events, invoice_export_items/runs, customer_invoices, billing_underlays, domain_events, event_outbox, webhook_subscriptions/deliveries, and the actual referenced company/customer/customer_contract/metering-point/pricing-run/auth parents. Include portfolio columns exercised by the real evidence guard; no need to execute settlement calculations. Use a normal invoice and a portfolio invoice with complete synthetic locked evidence. Preserve all insert/update triggers whose event columns this API touches. Catalog enumeration must fail on unexpected effectful triggers/rules/functions rather than silently dropping them. Keep other fixtures/canary rows unchanged.

The migration itself must fail for missing/incompatible prerequisites; do not create replacement billing tables or silently skip the function install. Preflight should assert required types, target unique-index inference shapes, tenant FKs, and effectful trigger registrations/function definitions used in the fixture. Source/canonical fixture parity and a real target schema gate remain distinct requirements. No target catalog has been queried here.

## Reusable owned PostgreSQL 17 harness

* `scripts/canonical-auth-provisioning-legacy-batch.py`: `OwnedPostgres`, `validate_database`, `clean_environment`, `safe_receipt`, `cleanup_workflow_owned`. Creates its own postgres:17 container, network none, private bind/logs, tmpfs data, owner label, no external-target constructor; verifies private logging and cleans up only its exact owned container. Allowed database names are the fixed `gridex_auth_legacy_{reference,template,prefix,seeded,dirty,native,atomic,lock,helper,replay}` set. Reuse those names under a distinct billing container; do not relax validation for arbitrary URLs/names.
* `scripts/canonical-user-rbac-fixed-target-selftest.py`: its `Proof.run/query/snapshot` offers private stdin/in-memory result handling and finite safe receipts. Its full constructor/owned graph requires historical actual57 auth state, so it is not a directly usable billing fixture. Reuse the private execution pattern through a bounded adapter, not bypassed owner validation.
* `scripts/canonical-user-rbac-fixed-target-continuation-selftest.py`: `private_reader` shows such an adapter, but its continuation-specific owner regex and upstream state assumptions must not be copied unchanged. New job owner can be `gridex-auth-legacy-billing-events-${run_id}-${run_attempt}`, validated exactly plus existing owner label/network identity.
* `scripts/sql/gridex-supabase-compatible-bootstrap.sql`: platform roles/auth helpers/extensions/default function ACLs; this is platform surface only. Include its permission behavior, especially default anon/authenticated function EXECUTE grants, when proving the new revokes. It does not supply the billing catalog.
* `.github/workflows/ops-hardening.yml`: existing owned PostgreSQL lanes provide unique run/attempt owner and always-cleanup patterns. Add a separately named bounded billing-event job, preserving the actual77 intake/recovery chain. Do not use the older localhost:55440 service helpers as an owned-handle substitute.
* `scripts/canonical-billing-completion-replay-selftest.mjs`: explicitly scoped historical predecessor/PGlite test, useful for source-accounting style only. It is not a PostgreSQL17 concurrent provider-event fixture.

Run two independent psql sessions against the same owned database for races. Synchronize with explicit barriers/observable lock acquisition; use bounded lock/statement/process timeouts and verify waiter state, not timing-only sleeps. Snapshot canonical rows, portal/underlay, domain/outbox/delivery contents, and catalog before/after. Use test-only fault triggers installed exclusively in the owned fixture to force failures; execute the real new function unchanged. Preserve finite PASS/SQLSTATE output and private raw results. Record artifact SHA and native server major. No fixture has been run in this read-only design task.

## Required native and runtime gates

| Scenario | Required result |
| --- | --- |
| Paid vs overdue, both claim distinct events | Deterministic paid-first lock barrier: overdue waits, rereads paid, completes stale/no-op. Reverse order also ends paid. No portal or underlay regression. |
| Same event/token simultaneously | One transaction mutates; second returns byte-equivalent stored receipt; one private/public event and fanout per key; one portal identity. |
| Wrong token, wrong company, null args | No side effects/identity disclosure; stable lost-claim result or specified argument rejection. |
| Worker A reclaimed by B | A can no longer update any projection; B completes. If A already holds apply lock, reclaimer skips/waits and cannot replace the token mid-transaction. |
| Response lost after commit | Same-token apply returns stored receipt, same paid timestamp/domain IDs, unchanged rows/counts. |
| Failure after item/portal/domain/outbox write | Inject at each phase; item, portal, trigger-updated underlay, domain/outbox/direct deliveries and completion all roll back. Original separately committed claim remains processing. |
| Retry after rollback/crash | Existing stale-claim or failed/review retry obtains new token; exactly one completed set of effects. Old token remains fenced. |
| Needs-review then new claim | Same completion replays stably; new claim makes old receipt inapplicable; newly resolved evidence can complete under the new token. |
| Legacy processed/no receipt | Explicit skipped legacy result; no backfilled/duplicated effects. |
| Unknown/mismatched/missing identity | Defined review receipt only. Amount/currency mismatch or wrong environment/GUID cannot mutate canonical rows. |
| All states and aliases | Table-driven old/new resolver parity; every rank pair, equal-rank distinct events, paid/disputed/cancelled/credited precedence, bit combinations, optional amounts, timestamp behavior. |
| Conflicting portal/reference/domain identity | No reassignment, cross-tenant reuse or partial financial update. Constraint/explicit review semantics asserted. |
| Normal and Partner API customers | Ordinary event/outbox counts exact. Partner customer additionally invokes real invoice resource event/direct delivery trigger; those effects also roll back on later failure. No network send occurs. |
| Portfolio invoice and pricing protection | Complete existing evidence survives. Missing evidence, altered immutable values or unlocked/cross-tenant run fail with no partial effects. Public reference and invoice calculations remain unchanged. |
| Outbox/ACL/prerequisite gates | Real fanout destination persists despite retirement trigger; anon/authenticated/PUBLIC cannot execute; missing claims reject if role-checked; missing required index/table/trigger prevents install. |
| Neighbor isolation | Unrelated invoice in same tenant, same provider event ID in other tenant/environment, plus separate canary database remain unchanged. |

Runtime gate: change `processSingleEvent` to call the new RPC and translate its typed result; remove its direct item/portal writes, success markEvent and emitDomainEvent calls. Keep resolver exports only if other callers need them; they cannot remain a second authoritative transition decision. Adapt the dependency-free actual-module harness to prove these entrypoints call the RPC with only persisted company/event/current token and do not perform the retired writes. Existing Vitest billing gate/readiness tests do not replace this native transaction proof; no dedicated current provider-event concurrency Vitest test was found in the bounded filename search.

On an RPC transport error with unknown commit outcome, first retry the same apply token to recover its receipt. Never immediately mark failed and blindly reapply. For a known SQL rollback, the existing guarded failure status update may remain (company/id/current token/status processing); it cannot overwrite committed completion. If outcome remains ambiguous, leave recovery to the existing claim mechanism and report uncertainty. Do not swallow a lost claim and report the event processed. Optional low-latency webhook fanout can run after commit using returned event IDs; any fanout failure must not change the completed billing result because the durable outbox already exists.

## Concurrent dispatch is a separate required lifecycle boundary

`invoiceApprovedDispatch.ts` writes provider GUID/item status sent, then separately writes portal status sent without a portal-status predicate. A webhook can match the newly persisted GUID in that interval and commit paid before the dispatch portal write sets it back to sent. The catch path similarly attempts an item failure update, does not inspect its error, and then writes portal draft/failed; a sent-item protection failure does not protect that later portal write. These interleavings are source-traced here, not dynamically reproduced.

Therefore a provider-event-only RPC proves serialization among provider events, not all invoice writers. A follow-up bounded dispatch-finalization coordination change must acquire the same item lock and preserve an already advanced provider projection (including dispatch failure projection), or otherwise prove equivalent conditional mutation. Do not hold database locks across provider HTTP. Do not add a portal trigger that takes the item lock in reverse order: portal→item conflicts with apply's item→portal order. Add paid-between-dispatch-item-and-portal plus dispatch-error-after-paid native/runtime cases before claiming whole-lifecycle no-regression. Approval metadata-only writes do not require inclusion in this event state transaction.

## Evidence and completion limit

Complete runtime files inspected across the billing audit/this contract: providerWebhooks.ts, providerEventProcessor.ts, invoiceApprovedDispatch.ts, capway/statusMapper.ts, events/domainEvents.ts. Relevant complete SQL claim, sent/locked-pricing guards, contract-chain guard, latest portfolio guard, public-reference helper, latest underlay projection, Partner API invoice trigger/emitter and outbox-retirement trigger bodies were read, with their registrations and defining table/index/constraint portions. Large mixed migrations were read by relevant complete object/block, not claimed as full-file audits. Bootstrap was read in full. OwnedPostgres and private reader implementation portions were inspected; their entire surrounding historical replay programs were not claimed as billing proof.

No native PostgreSQL, Vitest, provider HTTP or production validation was performed for this document. Dependencies are unavailable locally after the parent-reported ENOSPC install failure; no retry was attempted. The deliverable is a reviewable implementation/fixture contract. The existing red reproduction establishes the original TypeScript race; only execution of the unchanged new migration with real PostgreSQL17 locks, constraints and retained triggers can establish the proposed fix.
