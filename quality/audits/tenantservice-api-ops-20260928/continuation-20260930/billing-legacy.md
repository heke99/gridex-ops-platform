# Billing and legacy writer continuation — 2026-09-30

Scope: the current shared candidate in draft #422. This package does not publish,
merge, write a hosted database, send customer communication or activate a provider.
Root owns integration, generated artifacts, checksums and exact-head acceptance.

Skills applied: systematic-debugging to trace each suspected path; test-driven-development
for executable reproductions before fixes; Supabase for tenant-bound compare-and-set and
CLI-created forward SQL; verification-before-completion for exact local results. The
using-superpowers subagent exception applies. No React UI, skill installation or external
provider provisioning is part of this bounded package. The false-positive workflow
distinguishes financial correctness from an unproven attacker/duplicate-invoice claim.

## Execution inventory and preserved boundaries

| Entry/path | Authority and data owner | Actual operation/effect | Evidence boundary |
|---|---|---|---|
| `saveCustomerBillingProfileAction` / `saveCustomerContractBillingOverrideAction` | Existing `masterdata.write` action guard, selected tenant check, current support session; SQL rechecks session/membership/permission and revision | Canonical billing command updates only customer default or explicit contract override with result/audit/outbox | Existing pure/action and native fixtures; new SQL still needs disposable replay |
| API profile-update invoice e-mail | Verified API context and `customer_billing.write`; canonical API wrapper resolves current owner mandate before original route-claim replay | Same billing command with durable route result and revision; contact/login fields excluded | Existing adapter fixtures; real issuer/deployed-site qualification remains external |
| Tenant sync / legacy imports | Profile synchronization reports `updated:false, skipped:true`; explicit new billing destination remains distinct from contact address; old updates meet billing write guard | New insert initializes explicit legacy billing fields; existing profile update must use canonical command | Existing separation tests and guarded native script; no new legacy bypass added |
| Readiness / pricing preparation / review | Tenant-scoped customer/contract/site/supply/meter reads; shared resolver followed by revision-aware configuration lock | Only fully ready underlays acquire a billing configuration snapshot; invoice review reads the qualified locked DTO | `effective-billing-profile`, `billing-configuration-snapshot` tests; native concurrency pending exact candidate |
| Approved dispatch and retry | Existing guarded OPS/internal API callers, tenant governance/outbound freeze, explicit approval, readiness recheck | Both paths now contend on one per-item automation lock and reuse a durably captured provider request | New executable adapter/provider-boundary regressions; actual SQL lock/trigger/provider proof is separate |
| Generic canonical export and retry | Existing internal/background caller and tenant-scoped run/item context | Same durable capture, stable provider key, original dates, accepted provider identity and frozen financial request | Same new regressions; provider network is mocked only at the client boundary |
| Sent invoice redelivery | Existing sendable statuses exclude sent/credited; legacy manual retry/queue actions throw; database sent guard protects original request | No silent resend; correction/credit flow is required | Negative tests for both senders; no new verified-address redelivery command exists |

## Confirmed defects, reproduction and fixes

**BILLING-RETRY-01 — high financial correctness impact.** Both active provider
senders rebuilt the complete request on each attempt using the current time,
issuer, customer legal name/phone and provider service settings. Approved dispatch
stored the request only after outbound create/purchase; generic export could leave
an uncertain first attempt without its request. Reproduction: start an invoice,
return a synthetic uncertain network result, change time/customer/provider fields,
and call the same real sender again. The second request changed under the same
provider key. An injected capture-storage error also did not prevent the initial
network call. Initial red run: 7 failures, 3 passes in 10 behavioural tests.

Fix: `captureInvoiceProviderRequest` qualifies tenant/run/customer/pricing/underlay,
provider/environment/financing, exact financial amounts and stable reference/key;
it captures the complete request with a tenant-bound empty-payload compare-and-set
before network I/O. A competing capture returns the committed request. JSONB
object ordering is normalized for consistent request serialization; values and
array order are retained. A retry preserves the original dates/identity/channel
and uses those dates in the invoice mirror. Missing/ambiguous historical requests
fail closed and remain unchanged. This is not an inferred duplicate-creation
vulnerability: the existing client reconciles creation by external reference.

**BILLING-RETRY-02 — high financial state/recovery impact.** Approved dispatch
lost a confirmed provider invoice GUID if the subsequent purchase failed; its next
attempt re-entered create. The generic exporter already retained that identity.
Fix: approved dispatch stores provider acceptance before purchase, then resumes
the same identity on retry. A retry no longer overwrites a known provider identity.

**BILLING-RETRY-03 — concurrency correctness.** Approved dispatch held an
`approved-invoice` item lock while the generic exporter held an `invoice-export`
run lock. A paused first provider call and concurrent alternate sender produced
two create calls. Executable red: one failing case with two calls. Both paths now
share `invoice-provider:<company>:<item>` at the item boundary. Fresh green
execution observes one provider create while the alternate caller is denied the
held item lock. Actual two-session SQL lock qualification remains necessary.

**BILLING-REQUEST-04 — database defense for captured financial intent.** The
existing sent guard froze request data only after sent/credited. The CLI-created
forward `20260930212832_invoice_provider_request_immutability.sql` adds a private,
invoker trigger that preserves nonempty request payload, provider keys/binding,
customer/contract/pricing/underlay ownership, financial amounts/period and known
provider invoice GUID/ID while an item is still pending or failed. Status/error
projections may continue. No backfill, historical migration edit, public RPC or
new grant is introduced. Native acceptance is prepared, not claimed.

**BILLING-PURCHASE-05 — false successful outcome.** The generic sender treated
any HTTP 409 as sent when a previous attempt had saved a provider invoice GUID.
That proves create acceptance, not purchase completion. The real exported sender
with the real HTTP classifier and a synthetic purchase 409 reproduced `sent` /
`provider_conflict_resolved_as_sent`, without a second create. Removing that
special case preserves the existing `needs_review` / `provider_conflict`
classification, original request and accepted identity. Its invoice mirror is
not marked sent, and the month is not locked as complete. This requires no
claim about the provider's idempotency or reconciliation contract.

## False-positive and remaining evidence register

- Invoice review's contract SELECT omits canonical billing override fields, but
  `createDraft` obtains its destination from the qualified immutable underlay DTO.
  There is no demonstrated live-profile fallback in that path; no change made.
- Existing initializer/country/channel correction is already present. Its prior
  implementation is preserved rather than redone.
- Readiness still selects/uses `underlay.contract_id`, while locking/review also
  know `customer_contract_id`. Current canonical producers supply the legacy
  reference. A historical canonical-only/mismatched alias requires a native
  reachability check before remediation; the snapshot lock already rejects a
  mismatched contract instead of mixing destinations. No successful delivery
  through such a row is claimed.
- Provider purchase has no proven idempotency or recovery contract in this
  environment. A purchase timeout could represent an accepted purchase; live
  provider acknowledgement/reconciliation must be qualified before claiming
  exactly-once purchase. This package promises no global exactly-once outcome.
- New-address invoice redelivery requires a separately verified destination,
  traced decision and the actual provider delivery contract. No such command
  exists in the inspected implementation; this is a local missing capability,
  distinct from external delivery verification. It remains explicitly unavailable,
  and neither retry worker changes an issued destination to emulate redelivery.
- Issuer/phone/provider/deployed-tenant evidence remains external. No real
  customer or provider data was used.

## Original requirement coverage

| Original ID | Bounded outcome in this package | Remaining qualification |
|---|---|---|
| T01/T02/T07/T09/T50 | Stored requests are checked against current tenant/run/customer/pricing/underlay; new DB guard cannot broaden actor rights; legacy billing writes still meet existing command guard | Actual RLS/RPC/native tenant proof on integrated candidate |
| T14 | Existing default/explicit override inheritance preserved; no copied equality becomes inheritance | Existing original native fixture on final candidate |
| T15 | Shared readiness resolver/lock remains authoritative; full saved provider request now persists before send and replays unchanged | Actual provider destination/channel acknowledgement and SQL proof |
| T16 | No history rewrite/backfill; captured failed/sent request and known identity protected; existing support HTTP journey compares full synthetic issued invoice/document rows and old locked underlay before/after billing edit | New native marker, existing journey execution and final schema parity; synthetic document row is not proof of real provider PDF bytes |
| T17 | Both sender paths deny silent sent redelivery; legacy manual retry remains disabled | Local separate new verified-address redelivery command is absent; real delivery acknowledgement is a further external boundary |
| T18/T19/T20/T21 | Existing customer/contract revision transaction untouched; exact saved financial request qualification added | Existing two-session profile/lock tests plus new DB guard replay |
| T22/T23/T38 | Durable request/key before network; uncertain retry reuses complete original request; accepted GUID survives purchase failure; alternate sender shares one item lock; purchase conflict remains review rather than false success | Real provider reconciliation/purchase semantics and crash/recovery qualification |
| T44/U03/U04/U05 | Mirror issued/due dates come from original request; status/result paths continue using actual outcome | Real OPS/browser save/refresh proof remains root-owned |
| T49/T55 | Forward-only trigger and new rolled-back native fixture; no old invoice payload update | Empty replay, upgrade/restore and authentic artifacts on exact candidate |

No row in this bounded register alone accepts the full original requirement.

## Exact verification

- Initial new test run: 7 failed / 3 passed; failures were wrong observed
  persistence timing, unstable retry content, lost confirmed identity and network
  use despite capture failure.
- Separate concurrency red run: 1 failed / 16 passed, observed two create calls.
- Separate saved amount red run: 2 failed / 17 passed, observed mutated amount
  reaching both providers; qualification now rejects it without replacing history.
- Separate purchase conflict red run: 1 failed / 0 passed, observed a purchase
  HTTP 409 marked sent solely because a create GUID already existed.
- Fresh focused command with Node 22.23.3: `vitest run
  __tests__/invoice-purchase-conflict-outcome.test.ts
  __tests__/invoice-provider-request-retry.test.ts
  __tests__/effective-billing-profile.test.ts
  __tests__/billing-configuration-snapshot.test.ts
  __tests__/billing-chain-customer-card-regression.test.ts` — **54/54 in 5 files**.
- Owned-file ESLint — **0 errors**. Service-role tenant ratchet — **2375 <= 2402**.
- App typecheck with prescribed 4096 MiB heap — **PASS** after final monetary
  qualification; test typecheck also **PASS** after that qualification at the
  earlier frozen package boundary. Root reruns the integrated app/tests gate
  after the subsequently reproduced purchase classification correction.
  An earlier attempt accidentally used the default heap and OOMed; it was rerun
  with the prescribed heap rather than treated as a code failure.
- Migration integrity currently reports only the three new forward migrations
  absent from the root-owned checksum manifest. The new billing file SHA256 at
  this checkpoint is `bf5001e49890d3b63ba0fb9803d466dc74ef10af840086ae72b3d312bc7e8499`.
- `git diff --check` on owned modified paths — **PASS**.
- Appended native marker:
  `BILLING_NATIVE_PROVIDER_CAPTURE_CAS_FAILED_AND_SENT_IMMUTABILITY_PASS`.
  It checks first-capture/competing empty CAS, nine failed-state mutation
  denials with identical rows, captured-request deletion denial and sent reset
  denial. **Prepared, not executed locally**: this workspace has no disposable
  PostgreSQL/Docker. Root's existing native workflow runs the same script.

## Independent read-only OPS identity review

Reviewed the responsible-user action, six identity boundary cases, the form
component/page, seven UI binding cases, scoped guard and canonical access helper.
Fresh Node 22 execution: **13/13 in 2 files**. Tenant permission changes no longer
write shared Auth e-mail/metadata or `user_profiles`; current company guard and
the authoritative tenant access command remain required. Errors return safe
correlation messages. Read-only identity fields and returned form outcomes match
the action's new role-only purpose. Membership query filters are source reviewed;
the test's mocked query does not prove real SQL authorization.

One root-owned UI correction was reported: governance `email` prefers the
potentially stale profile projection while `authEmail` holds the observed Auth
identity; the read-only login field must submit the latter to meet the action's
e-mail expectation. Root owns its correction/fixture and integration proof.

Next: root independently reviews the frozen package, incorporates its checksum,
runs the actual new native marker plus exact-head clean replay/upgrade/restore,
materializes authentic schema/types, and reconciles provider-dependent boundaries
with the unchanged original T/U meanings.
