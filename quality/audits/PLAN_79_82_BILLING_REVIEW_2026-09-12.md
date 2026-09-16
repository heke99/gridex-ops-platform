# Bounded billing audit, masterplan 79–82

Date: 2026-09-12. Source baseline: 41786027. Scope: read-only business-path audit; no application or migration edits, database connections, production reads, provider calls, or deployment. The companion `billing-audit-proof.mjs` runs actual TypeScript modules with isolated in-memory boundary stubs; it is evidence code, not a production fix or native SQL integration test.

Outcome: **three current confirmed code defects**, one narrower fail-closed candidate, and explicit remaining dynamic gates. This does not close points 79–82 or establish production readiness.

## Routing and evidence limits

Read AGENTS.md, memory README/current-state/checkpoint, decisions and known failures; inspected installed skill inventory and relevant review/verification guidance. Applied code-path inventory, code-review/find-bugs, false-positive refutation and verification-before-completion methods. Parent owns broader baseline skills, independent review and durable project-memory updates; this bounded child was explicitly forbidden to spawn agents. No implementation/TDD/refactor/deploy/UI/performance or live database workflow was activated. No fresh scanner/SARIF/supply-chain or whole-repository completeness claim is made. Historical memory is only a search seed.

Historical seed inspected: `quality/audits/BILLING_COMPLETION_REPLAY_EFFECTS_2026-09-06.md` (migration source effects, not billing behavior acceptance); billing references in `TENANT_ISOLATION_CONSISTENCY_AUDIT_2026-09-02.md`, `GRIDEX-PROD-PARITY-2026-09-04.md` and `MASTER_PRODUCTION_REMEDIATION_STATE.md`; ADR007–009. Full current SQL replay and production parity remain explicitly unproved.

## Current findings

### BILL-01 — High: pricing success removes non-pricing underlay blockers

**Affected path:** internal pricing preview/reprice → `lib/pricing/engine.ts:calculatePricingPreviewForUnderlay` → `gridex_persist_pricing_run` → draft preparation → explicit approval/dispatch.

**Root cause and evidence:**

- `lib/billing/underlayEngine.ts:validateIntervalCoverage` distinguishes gaps from overlaps. An overlapping pair produces warnings while `missing_values_count` can remain zero. The underlay and items are stored blocked/needs_review with positive aggregate kWh.
- `lib/pricing/engine.ts:calculatePricingPreviewForUnderlay` validates existence of customer/meter/area/active contract/positive kWh/pricing snapshot, but does not reject `status=pending`, `readiness_status=blocked`, saved readiness issues or underlay item status. Fixed/monthly pricing does not reload and revalidate the meter rows.
- Latest defining body found for `gridex_persist_pricing_run`, `20260716010000_contract_billing_end_to_end_completion.sql:1004–1098`, unconditionally changes a success underlay to `status=validated, readiness_status=ready`, clears `readiness_issues`, and sets `invoice_readiness_status=ready_for_invoice`. Later search-path changes do not restore the missing business gate.
- The internal preview/reprice routes require authorized pricing access and company scope, but neither adds an underlay-completeness check. Monthly pricing selects all underlays, including blocked rows.
- `invoiceReviewPrepare.ts:prepareInvoiceDraftsForReview` chooses only the now-overwritten status/readiness flags. `ensureLockedPricing` locks the success. `invoiceApprovedDispatch.ts:assertItemStillReady` accepts those flags and only checks `missing_values_count > 0`, identities, area, hash presence, kWh and totals. An overlap with no missing gap passes these checks.
- The complete month readiness function does contain a stronger metering check. It is **not called** by the current create route, admin prepare/approve actions, canonical draft helper or approved dispatch. A guard existing in that other function is not protection for this path.
- Inspected canonical graph core/wrapper, compatibility graph RPC, exact-ref guard, locked-run trigger and latest billing tenant guard: these validate references/tenant/locked pricing, not interval overlap or original readiness blockers.

**Local executable proof:** actual engine receives a pending/blocked overlap underlay, `missing_values_count=0`, 20 kWh, active exact contract/snapshot and fixed SEK1/kWh. It returns success and sends `p_result.status=success` to the actual RPC call site, no errors. SQL readiness overwrite is statically traced, not executed locally.

**Business impact:** ordinary authorized repricing can make overlapping or otherwise invalid meter evidence reviewable and sendable, with aggregate overbilling. This is not an unauthenticated exploit claim.

**Targeted fix:** pricing must never erase underlay-validation blockers. Require freshly validated canonical underlay evidence before a success can become billable, preserve domain-specific blocker state, and enforce it inside persistence/lock/reservation and immediately before send. Add overlap-with-zero-gaps and stale-readiness tests across the real SQL transaction and draft/dispatch path.

### BILL-02 — High: interval pricing silently accepts the first result page

**Affected path:** `lib/pricing/intervalPricing.ts:resolveIntervalSpotPricing` → `lib/pricing/engine.ts` → persisted interval evidence → canonical invoice preparation/dispatch.

**Root cause and evidence:**

- Both `billing_underlay_items` and `spot_price_intervals` reads are unpaginated. Checked local `supabase/config.toml:18`: `max_rows = 1000`. A complete 30-day quarter-hour month requires 2,880 intervals (DST months vary).
- The function proves `evidence.length === items.length` only against the returned page; it has no authoritative expected row count, full-period coverage check or expected kWh reconciliation.
- It returns an average over that page. The engine applies that average to the **whole underlay** `total_kwh`, so omitted later intervals change the bill rather than merely omitting evidence.
- `loadLockedUnderlayPricingWithCore` also reads `pricing_interval_evidence` without pagination, so even a later calculation-only fix would leave large invoice calculation snapshots truncated.
- Existing `billing_export_readiness_v` counts full items versus evidence, and the legacy queue path consults it. This is real protection on the legacy route. The current approved invoice flow bypasses that view: canonical graph wrapper/core, `gridex_create_billing_export_run`, draft preparation and approved dispatch do not assert its interval count condition. The locked-pricing trigger checks status/tenant only.

**Local executable proof:** 2,880 synthetic quarter rows, 1 kWh each, first 1,000 at SEK1 and remaining 1,880 at SEK2. An API-cap boundary stub returns the first 1,000 rows for each query, as the declared local cap permits. Actual resolver produces 1,000 evidence rows, no errors, average1. Actual base calculator bills SEK2,880 ex VAT; complete evidence requires SEK4,760. No SQL or provider request ran.

**Reachability limitation:** this proof isolates the pagination defect with valid instant period bounds. The latest underlay writer stores civil dates; the engine passes these dates directly into interval comparisons, which may separately block initial Stockholm intervals by treating date strings as UTC. A representative generated-underlay-to-provider native test is still needed; do not equate the isolated proof with an observed production invoice. A separate blocking defect does not justify silently accepting partial evidence when valid instant bounds reach this function.

**Targeted fix:** page both inputs with stable tie ordering, verify full expected interval coverage and kWh, page stored interval evidence, and enforce evidence completeness on the actual canonical reserve/send route. Exercise 2,880+ rows, DST and multiple source policies. Use authoritative period instants consistently.

### BILL-03 — High: distinct events for one invoice can regress a paid invoice

**Affected path:** signed provider webhook → event upsert → `processPendingInvoiceProviderEvents` → event claim RPC → separate export item update and portal upsert.

**Root cause and evidence:**

- `providerWebhooks.ts` can call the processor concurrently for distinct incoming events. Cron is an additional caller.
- `gridex_claim_invoice_provider_events` (`20260712100000_gridex_end_to_end_integrity_hardening.sql:1029–1079`) uses `FOR UPDATE SKIP LOCKED` on **event rows**, then commits each claim. This correctly excludes duplicate workers from a single currently claimed event, but does not serialize different events for the same invoice.
- `providerEventProcessor.ts:processSingleEvent` loads the item, compares `STATE_RANK` in JS, then updates it with company/id/GUID predicates only. No expected provider state/version or invoice lock is part of the write.
- Both a paid event and an overdue event can read unpaid. Paid writes first; overdue passes its stale in-memory check and overwrites paid. Both portal upserts and processed marks succeed.
- The sent-invoice protection trigger prevents re-send/financial edits/GUID replacement, but explicitly permits this provider-status and portal-status update; none of the inspected later definitions add monotonic provider-state protection.

**Local executable proof:** actual public processor entry point invoked twice with separately claimed same-invoice paid/overdue events. The boundary stub barriers force both reads before either write and make overdue update after paid has been marked processed. Both report one processed event, final export `provider_status=overdue`, final portal `status=overdue`.

**Business impact:** a paid invoice can reappear overdue and emit a later overdue state/event; retry and delivery timing affects the durable business outcome.

**Targeted fix:** atomically serialize per invoice and apply event, export state, portal state and domain outbox in one transaction with claim ownership fencing. Test all ordering combinations, two workers, expired-claim recovery, payment reversal semantics, and duplicate exact events.

**Related unexecuted failure window:** the current processor marks an event processed before emitting its domain events. A subsequent emit failure cannot mark it failed because markEvent requires `status=processing`; the failed mark is swallowed and the processed event is not retryable. This needs a fault-injection regression before separate final classification; moving state/event work into the same transaction addresses the window.

## Narrow candidate / not promoted to full end-to-end finding

**BILL-C01: source-message metadata absence is accepted by the pure billing gate.** Actual `evaluateBillingGate` returns eligible for a populated `source_message_id` with `sourceMessage=null` and otherwise valid data. The checks only reject contradictory populated tenant/family/status fields. Underlay generation intentionally omits sourceMessage when re-evaluating and trusts the stored eligible snapshot. The matcher loads source with tenant scope and can obtain null. However, transactional UTILTS ingestion and message/normalized-row FK rules can constrain how such a persisted state arises. This audit did not finish every ingestion/reprocessing/deletion branch. Confirmed function behavior, **not a confirmed missing-source production path**. Add a missing/incomplete/mismatched-source identity negative test and trace ingestion before remediation.

## Refuted / existing protections

- `lib/billing/pricingEngine.ts` no longer calculates bills; it is an admin-rule module. Production calculations use Pricing Core. Claims based on the retired legacy function are obsolete.
- Webhook body/header tenant claims are ignored. Provider/GUID resolution requires exactly one persisted export item globally, an explicit test/production environment, and exactly one active tenant/provider/environment connection. HMAC covers timestamp plus exact raw body and checks a five-minute replay window and body-size cap. Ambiguous GUIDs fail closed.
- Event inserts use tenant/provider/environment/idempotency conflict targets with `ignoreDuplicates`. Exact duplicate event rows and portal invoice rows have persistence identities; do not claim every webhook duplicates an invoice merely because processing uses multiple calls.
- Provider create now reconciles by stable pricing-run `externalReferenceCode` before PUT and after uncertain errors. A claim that provider creation blindly retries solely on an unsupported Idempotency-Key header is outdated. Provider sandbox durability/visibility delays and factoring POST replay remain untested.
- Current sent invoice and locked pricing triggers are material protections. Their absence must not be alleged. They do not protect BILL-01 or BILL-03's different state mutations.
- Canonical graph wrapper reserves canonical and legacy rows in one transaction, uses a company-bound idempotency key and rejects changed logical payload hashes. Its wrapper/core was read before concluding about missing coverage enforcement.
- Latest tenant composite FKs/relationship guards protect many wrong-company references. This audit does not assert a demonstrated cross-tenant data read/write.
- Snapshot components drive billing; missing spot/portfolio bases cause calculator errors, weight totals must be 100%, explicit VAT-exempt lines retain zero VAT, and component metadata includes reference/type/unit/amount/selection/lifecycle. These protections do not establish complete component or VAT policy correctness for all contracts.

## Tenant / identity matrix

| Boundary | Inspected protection | Remaining gate |
|---|---|---|
| Underlay load/write | company filters, batch transaction, customer/meter ownership checks, exact normalized source guard | native two-tenant CRUD and simultaneous regeneration/locking |
| Contract/snapshot | company + contract relation, v6 selection fields, immutable snapshots | all validity boundaries, canonical version hash/area consistency |
| Pricing | company/underlay-scoped rows, per-underlay RPC serialization, one active run, locked-run protection | complete rows and blockers; native SQL negative matrix |
| Provider lookup | provider/GUID unique match; tenant+environment connection and HMAC | provider GUID duplicate constraint/runtime parity; invalid signature replay |
| Provider processing | full tenant/provider/environment/GUID item match, event claim token, portal conflict key | invoice-wide serialization and transactional outbox |
| Invoice graph | tenant-scoped canonical+legacy atomic reservation; payload hash; exact customer/contract; locked run trigger | interval completeness and stale pricing/approval content checks |
| Approved dispatch | operational company, outbound freeze, per-item lock, explicit approvals, totals/kWh, stable provider reference | frozen payload identity and provider crash/timeout/factoring recovery |

## Files read and coverage boundaries

Complete primary files read:

- `lib/billing/pricingEngine.ts` (180 lines)
- `lib/billing/underlayEngine.ts` (1,029)
- `lib/billing/billingGate.ts` (423)
- `lib/billing/providerWebhooks.ts` (219)
- `lib/billing/providerEventProcessor.ts` (399)
- `lib/billing/invoiceApprovedDispatch.ts` (453)

Complete canonical/helper files read:

- `lib/pricing/engine.ts`, `underlayPricingAdapter.ts`, `priceSourceResolver.ts`, `basePriceCalculator.ts`, `priceComponentCalculator.ts`, `pricePreviewBuilder.ts`, `intervalPricing.ts`.
- `lib/billing/invoiceReviewPrepare.ts`, `invoiceReadiness.ts`, `invoiceGraphCoverage.ts`, `meterValueBillingMatcher.ts`, `monthlyAutomation.ts`.
- `lib/time/stockholm.ts`, `lib/events/domainEvents.ts`, `lib/integrations/billing/capway/client.ts`, `payloadBuilder.ts`, `statusMapper.ts`.
- Internal pricing preview/reprice and invoice create/send routes; admin billing actions and export-center actions.

Complete small migration files read: `20260901152500_canonicalize_billing_underlay_stockholm_period_semantics.sql`, `20260727164000_canonical_invoice_export_runtime_completion.sql`, `20260702150000_gridex_sent_invoice_protection.sql`, `20260820113132_invoice_export_locked_pricing_guard.sql`.

Targeted full function bodies/DDL sections (not whole-file claims): `20260716010000_contract_billing_end_to_end_completion.sql` pricing persistence/lock, exact-ref guard, charge/interval tables, metering-gate setter, batch and compatibility export writer; `20260712100000_gridex_end_to_end_integrity_hardening.sql` provider claims and tenant relation constraints; `20260727010000_contract_flow_integrity_completion.sql` graph core; `20260716090000_production_settlement_export_completion.sql` energy inheritance/readiness view and legacy queue check; `20260702120000_gridex_billing_pricing_immutability_constraints.sql` snapshot and pricing immutability/active-run protection; `20260805085617_api_contract_billing_tenant_hardening.sql` identity FKs and invoice VAT/amount constraints; `20260905141608_canonical_tenant_relationship_guards.sql` underlay ownership guard.

Partial/structural-only helper review: `billingReadiness.ts` (the tool output was truncated; do not claim whole-file coverage), `lib/metering/validation.ts` invocation boundary only, production/correction settlement helpers and unit conversion loaded by the executable harness but not fully reviewed; market source policy, provider auth/config, schema readiness, RBAC, locks, external fanout and full UTILTS ingestion not exhaustively read in this bounded child. Parent owns API/jobs and broader tenant review. No complete-billing-system acceptance follows from this inventory.

Existing tests inspected: `billing-canonical-gate.test.ts` (two cases, no present-ID/absent-source case), `interval-pricing-resolution.test.ts` (only resolution helper, no paginated async calculation), pricing base/component/preview tests (positive/negative calculations, missing bases, VAT, amount rounding and metadata; combined output truncated so not claimed as complete test-file read). Existing unknown-calculation-type test deliberately expects a warning; fail-closed policy for malformed mandatory components still needs explicit contract review.

## Executed verification

From repository root:

```sh
node --no-warnings --experimental-vm-modules quality/audits/proofs/billing-audit-proof.mjs
```

Actual observed output:

```text
PROOF gate: known source_message_id with null sourceMessage => eligible, reasons=0
PROOF interval pagination: actual 2880 intervals, evidence 1000, no errors, calculated 2880 SEK vs complete 4760 SEK
PROOF blocked-underlay: pending/blocked overlap issue with positive quantity => success RPC payload, errors=0
PROOF concurrent invoice events: paid commits then stale overdue commits; both processed, final item/portal overdue
```

Exit 0 on Node v24.19.0. Uses built-in `stripTypeScriptTypes` plus VM modules; exact implementation bodies are loaded from disk. Boundary stubs replace Supabase/schema/market-policy/provider-event emission and forbid unexpected spot import. Does not compile/reimplement pricing or event methods. Does not run schema SQL, external calls, Next authentication or provider requests. Expected failures are asserted as observed defects; a passing proof means the defects reproduced, not that requirements pass.

Root attempted npm dependency installation and reported ENOSPC, then removed partial node_modules. This child did not repeat install or run Vitest against missing dependencies. Repository declares Node >=22 <23; the ad hoc Node24 proof is not the repository-supported CI acceptance lane.

## Required follow-up gates and remediation batches

1. BILL-01 small reviewed fix + actual SQL transaction tests: blocked overlap remains blocked through price/lock/reserve/send; valid fixed/monthly controls, missing gaps, invalid revision/area/contract evidence.
2. BILL-02 pagination/completeness fix + month-sized source tests and SQL canonical-send denial. Include first/last Stockholm instants, spring/fall DST, 1,000/1,001/2,880+ limits and complete saved audit evidence.
3. BILL-03 atomic invoice event state machine + two-worker native tests and outbox failure injection, including stale claim fencing and exact duplicate delivery.
4. Re-run relevant existing Vitest suites in supported hosted quality lane: billing canonical gate/readiness, pricing components/base/preview/units/settlement semantics, interval pricing resolution, contract pricing snapshot/versioning and provider/Capway suites. The new cases above are missing from the inspected existing suites.
5. Full database tenant/RLS negative matrix, immutable source/constraint replay, all billing methods/fees/tax policy/proration/version-boundary scenarios, complete underlay versus source reconciliation and provider sandbox create/reconcile/factoring/timeout/crash/replay tests remain open. Do not advance deployment or masterplan completion based on this static audit and boundary-stub evidence alone.
