# Residual tenant queues and aggregate request budget — 2026-09-30

Status: **IMPLEMENTED_LOCAL_PROOF; native/final-candidate qualification pending**. Root owns candidate registration, checksums, integration and publication into #422. This package preserves the separately frozen provider-application/customer-queue13 paths. No original requirement receives whole-scope VERIFIED or BLOCKED from these bounded proofs.

## Original requirement mapping

| ID | Original requirement | Local result | Remaining outcome |
| --- | --- | --- | --- |
| T40 | Belastning från en tenant ger inte obegränsad påverkan på andra. | Actual provider, tenant-email and approved-invoice global queue starvation repaired; persisted tenant turns/caps; current-row private retry lease CAS; global tenant/window request ceiling covers multiple clients and differing resource paths. | Full native history/concurrency/schema receipts; deployed noisy/quiet measurements, byte/DB-call/latency budgets, user/relevant-IP and costly-read/export budgets, remaining queues and actual WAF infrastructure remain unqualified. |
| T39 | Partnerfel ger korrekt kö/status utan att stoppa all support. | Existing approved retry executor continues a quiet tenant after another tenant's preflight or lease-completion failure. Token-bound private completion records safe preflight categories. Email failure-state persistence failure cannot stop the following batch row or turn a confirmed delivery into an automatic resend. | Actual independent API/OPS/portal support journey and provider behavior remain separate qualifications. The email delivery/provider-specific outcome paths need their actual transport receipts. |
| T41 | Återkallad API-nyckel stoppar nya otillåtna anrop. | The existing limiter's new aggregate write rechecks current client/company state and database-clock expiry; revoked/expired clients and inactive company cannot consume either counter. | This is a limiter proof, not acceptance of every HTTP authentication route or the full API-key revocation requirement. |
| T25 | Idempotensreplay kringgår inte återkallad rättighet. | Existing invoice sender/approval model is preserved, with no expanded grant. | Prior business approval is persisted; this queue does not reauthorize the approver's live Auth/session/grant. Pending sensitive-effect revocation assessment remains open. |

The full75 original inventory remains in `webhook-fairness.md`, and the preceding provider/order/customer fairness packet is described in `partner-order-tenant-load.md`. Earlier packet statements that these three global queues/shared tenant quota remain open are superseded only for the specific implementation and local proofs here, not for their native/deployed acceptance.

## Actual RED evidence

- The actual historical provider claim function, executed in PostgreSQL core, returned **20 noisy /0 quiet** for250 older noisy events and1 later quiet event, limit20. The quiet-tenant assertion failed.
- The actual historical client/route limiter allowed **18/18** requests spread across3 active same-tenant clients, each configured10. The aggregate<=10 assertion failed; another tenant stayed independent.
- Actual exported email/retry workers produced **3 RED /0 GREEN** in the initial bounded runtime diagnostic: email's global inventory omitted quiet work, approved retry inventory omitted quiet work, and first-tenant preflight rejection aborted the next tenant. Transport seams rejected all external dispatch; no fabricated provider success was used.
- Independent billing review found a fresh private lease could be overwritten by a claim chosen from an earlier snapshot. Executing the **exact production lease UPSERT fragment** against that newer unfinished lease gave **1/1 RED**, returning one lease and replacing its token. The current-row predicate gives GREEN. This is a real write-boundary CAS receipt with preselected stale input, **not a two-session scheduling receipt**. An exploratory recursive BEFORE INSERT injection hit PostgreSQL21000 and was discarded as an invalid concurrency reproduction.

## Fair atomic claims

CLI-created forward `20260930225911_partner_email_invoice_retry_fair_claims.sql` adds private service-only RLS tenant turns partitioned by the three queue names. Each claim selects least recently served tenants, takes first rows before extras, caps each tenant at5 and keeps the existing overall limits. Claims and turns commit together; SKIP LOCKED skips held work. User values are EXECUTE parameters; all selected SQL fragments are fixed server constants from a closed queue whitelist.

Provider RPC retains its existing public signature and requested company/status/age semantics, stale15-minute processing recovery, attempt increment, current token and safe reason clearing. Email claim preserves due/dead-letter eligibility and atomically marks at most the requested number of stale processing rows uncertain; it never resends those rows. Existing attempt/max-attempt handling and the single-item sendNow path remain in the executor.

Approved retry eligibility requires current failed_retryable/due state plus persisted approved status and nonempty approver before LIMIT. A private two-hour unfinished lease matches the existing7200-second provider automation lock horizon. Current-row UPSERT permits only finished or strictly older leases. An unfinished lease exactly at cutoff stays protected. Returned claims and persisted tenant turns both join only successfully returned lease IDs; losing the CAS cannot fabricate the caller's token or advance a tenant's turn. Completion requires exact company/item/token and records a bounded safe outcome/reason. It changes no invoice/export financial row.

`invoiceApprovedDispatch.ts` changes only the helper import and retry-loop delegation. Its actual sender body, current company operational/freeze checks, item and invoice approvals, readiness revalidation, immutable request qualification/reuse, stable GUID capture, financial fences and shared provider lock remain unchanged. Approval is the existing **persisted prior business decision**, not a fresh approver session. Master section7's pending-sensitive-effect revocation assessment is not certified by fairness. No provider invoice is created by these queue proofs.

The adapters require valid tenant/token/status/approval claim receipts, clamp finite batch inputs, fail closed without legacy fallback when the RPC is missing, and isolate per-row preflight/completion failures. A failed completion leaves the private lease for normal stale recovery. Email uncertain-state write failure after confirmed delivery retains processing for uncertain recovery; it does not fall through into failed/requeued state. Current-status/token binding also protects tenant-blocked marking.

## Global aggregate API budget

CLI-created forward `20260930225914_integration_api_aggregate_tenant_budget.sql` preserves the existing limiter signature and return shape, client/route business allowance and service-only function ACL. It adds **one global tenant/window counter**, independent of literal routes and client count. A platform-owned private finite policy overrides the default; otherwise the ceiling is the largest currently active configured client ceiling, never their sum, capped at the pre-existing provisioning maximum5000. There is no end-user policy write grant or production SLA claim.

Current client/company and configured policy rows are locked. Ordered active-client share locks stabilize the default ceiling and revocation state. Initially absent policy insertion locks the company, serializing it with requests. A policy's company/window scope is immutable. Existing policy update/deletion is excluded by its share lock. Both client/route and tenant counters update in one transaction, saturate before integer overflow, and authorize only if both budgets permit. Returned metadata identifies the stricter remaining allowance. New-bucket expiry cleanup deletes at most100 old rows from each ephemeral counter family.

Database-clock expiry is checked again after counter lock waits. A late client-bucket failure or expiry during actual SQL pg_sleep rolls both counter writes back. The default ceiling is narrowed again if previously active clients expire during the wait. The existing authentication route/cost limit still applies; this aggregate counter counts requests, not a certified weighted tenant-cost/user/IP budget. A limiter42501 after expiry fails closed; the precise public error envelope requires separate HTTP qualification.

## Executed local checks

- PostgreSQL17.5/PGlite0.3.14 actual full-forward core: **16/16 PASS** (queue8, aggregate regression2, budget invariants6). All three queues250+1, limit20 -> **5 noisy /1 quiet**; persisted limit-one turns rotate. Low roles/late actual turn faults leave rows, leases and turns unchanged. Provider age/status/token and email future/dead-letter/bounded uncertain cleanup remain intact. Approved filtering precedes limit and financial rows stay byte-equivalent; wrong-token/company release has no effect.
- Production lease CAS additionally tested exact cutoff rejection and strictly older reclamation: **1/1 focused PASS**. Independent billing source review approves current-row predicate, returned-ID filtering and matching tenant-turn join; it makes no native execution claim.
- Aggregate actual core3 clients /20 different resource paths -> **10 allowed /10 denied**, other tenant's count1. Explicit private ceiling4 narrows aggregate traffic, original route ceiling2 remains enforced. Revoked/expired/paused/low-role zero-counter effects, late actual counter trigger rollback, real SQL clock expiry and100-row bounded cleanup pass.
- Actual exported worker adapter suite: **7/7 PASS**; quiet-tenant continuation after preflight and both response/promise completion failures, missing-schema fail closed, unapproved receipt denial, zero external transport.
- Existing provider-request retry/purchase conflict and updated billing-chain regression: **26/26 PASS**. The source trace now follows the actual queue helper and SQL eligibility/approval gate while retaining readiness-before-provider assertions.
- Scoped ESLint: **PASS**. Narrow new-native TypeScript check (1GiB): **PASS**. Root owns the broad application typecheck; this packet does not copy that result or run a competing broad check.
- Owned `git diff --check`: **PASS**.

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/residual-tenant-budget-20260930.postgres.test.cjs scripts/residual-tenant-budget-20260930-invariants.postgres.test.cjs scripts/residual-tenant-queues-20260930.postgres.test.cjs
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config scripts/residual-outbox-retry-20260930.config.ts
```

The core fixture executes actual SQL with focused typed prerequisite tables. Its single-process timings are not deployed latency, throughput, infrastructure isolation, whole-schema or real-transaction concurrency receipts.

## Prepared native receipt and integration

`scripts/residual-tenant-queues-20260930-native.config.ts` requires CI and a genuine disposable Supabase status file with `API_URL=http://127.0.0.1:54321`; psql targets the corresponding local54322 only. **14 authored tests, NOT_EXECUTED locally**: each queue fair/rotation, low-role+late rollback and two real transactions; production lease CAS and exact cutoff; multi-client/path aggregate isolation; two real transactions sharing ceiling1; current revocation/ACL+late counter rollback; real PostgreSQL clock-wait expiry.

Run after candidate migration replay/schema generation. Webhook proof runs first. Run this residual suite before other fixtures leave eligible email/provider/approved retry rows; its global preconditions never clear or rewrite another fixture's data. Existing customer-queue fixture likewise needs its initial quiet queue. Queue claims never dispatch an email or invoice. Native ordinary invoice graph is unconfirmed and lacks an issued mirror because this proof claims work only; the actual sender must still reject unqualified readiness if invoked. No financial approval or provider semantics is inferred from synthetic metadata.

Cleanup deletes only own unsent/unconfirmed synthetic queue rows and ephemeral leases/turns/counters/policies. Company/legal/locked pricing/customer/contract history and synthetic API-client rows remain until stack teardown. No legal unpublishing, guard disabling, sent-invoice rewrite, third-party traffic or real key/account manipulation is allowed. Native cleanup/schema/trigger assumptions are pending the authentic run.

```sh
CI=true GRIDEX_NATIVE_STATUS="$candidate_status_path" node node_modules/vitest/vitest.mjs run --config scripts/residual-tenant-queues-20260930-native.config.ts
```

Exact head/tree, registered migration/hash parity, clean/upgrade/restore, native full-history concurrency and HTTP/OPS/portal outcomes must be attached by root after execution. Missing Docker/psql locally is an explicit native execution boundary, not a blanket external blocker for remaining implementation.

## Exclusive frozen manifest

1. `lib/email/emailOutbox.ts`
2. `lib/billing/approvedInvoiceRetryQueue.ts`
3. `lib/billing/invoiceApprovedDispatch.ts`
4. `__tests__/billing-chain-customer-card-regression.test.ts`
5. `supabase/migrations/20260930225911_partner_email_invoice_retry_fair_claims.sql`
6. `supabase/migrations/20260930225914_integration_api_aggregate_tenant_budget.sql`
7. `scripts/residual-outbox-retry-20260930.config.ts`
8. `scripts/residual-outbox-retry-20260930.test.ts`
9. `scripts/residual-tenant-budget-20260930-core.cjs`
10. `scripts/residual-tenant-budget-20260930.postgres.test.cjs`
11. `scripts/residual-tenant-budget-20260930-invariants.postgres.test.cjs`
12. `scripts/residual-tenant-queues-20260930-core.cjs`
13. `scripts/residual-tenant-queues-20260930.postgres.test.cjs`
14. `scripts/residual-tenant-queues-20260930-native.config.ts`
15. `scripts/residual-tenant-queues-20260930-native.test.ts`
16. This report.

No baseline migration, manifest/checksum, workflow, generated snapshot/type, public contract, frozen13 source or Git ref is edited by this packet. Whole masterplan acceptance still depends on every original T01–T55/U01–U20 disposition; these local queue/budget proofs cannot replace it.
