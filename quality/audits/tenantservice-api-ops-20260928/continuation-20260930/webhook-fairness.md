# Webhook fairness continuation and original requirement inventory — 2026-09-30

Status: **IMPLEMENTED_LOCAL_PROOF; actual PostgreSQL/final-head qualification pending**. Root owns integration/publication. This report records the initial current matrix and narrowly scoped new evidence. It does not accept whole T37/T40, any other whole T/U requirement, or a P0–P8 phase.

## Original scope and current truth

`masteruppdrag.md` contains the complete independent 1,353-line original assignment, including all 75 required IDs. `requirements.csv` initially records **31 PARTIAL, 44 NOT_VERIFIED, zero VERIFIED and zero BLOCKED**. Its prior exact-head contact/event/publication receipts remain bounded to their tested paths. Later recovered commands/support/billing/UI require their own genuine candidate replay, HTTP, browser and artifact parity. The matrix is not edited by this owner.

The OPS discovery inventory has 147 pages, 3,439 lexical controls, 121 API route files and 101 action files. The later UI record has 286 reachable local UI modules, 1,091 syntactic bindings, 29 traced scoped handler families and 13 families with partial unit evidence. Its own record states **zero fully verified families, zero final-candidate browser executions and unknown unique business-action total**. These counts cannot certify global U01/U02/U03/U20.

Skill routing: specification-to-code tracing against the preserved assignment; systematic-debugging/TDD for confirmed global queue starvation; Supabase security/imperative CLI migration creation and PostgreSQL SKIP LOCKED documentation; direct independent source review and verification-before-completion. No production database, external communication, main merge, key rotation or generated schema editing.

## Confirmed defect and implementation

The old `claimDueDeliveries` selected the oldest global due deliveries before applying its 100-row maximum. A single tenant with an older backlog fills each batch while another tenant's ready deliveries never reach their normal decision. The adapter regression reproduced this: quiet tenant remained `queued` instead of reaching `blocked_tenant_state`; the missing-schema test also resolved via the legacy global queue when it must fail closed. Both tests failed before the change and pass after it.

New CLI-created forward: `20260930211850_webhook_tenant_fair_atomic_claim.sql`. A private service-only RLS table persists each tenant's last claim turn. The invoker RPC checks service role and bounded input, orders least recently claimed tenant turns, locks due rows with SKIP LOCKED, takes each tenant's first row before extras, caps five per tenant and 100 total, and commits delivery claims plus tenant turns together. Return order retains the same interleaving. Future retries and exhausted attempts are ineligible. Normal tenant state and send decisions still execute after the claim; a claim implies no send authorization. Missing RPC schema fails closed without a legacy fallback.

Six prepared actual PostgreSQL tests cover the old150-versus3 starvation query and new cap/interleaving, persistent limit-one rotation, future/exhausted eligibility, anon/authenticated ACL plus no effects, invalid input and late turn-write rollback, and two real worker sessions with disjoint locked claims. **These tests are authored, not executed locally.** Run before other fixtures leave due webhook rows; the fixture asserts an initially quiet disposable queue and never resets another owner's rows. It cleans only its unique synthetic tenants/resources.

Actual OPS **36783103604**, clean job **110117956898**, reported candidate head `4b`: native migration application plus schema/type generation passed, but the webhook native suite **failed all 6 tests** at fixture cleanup. Deleting each synthetic company cascaded into automatically published immutable `legal_text_versions`; the genuine protection correctly rejected that deletion. Earlier per-case log markers do not override the failed test outcomes. The corrected cleanup deletes only owned subscriptions/deliveries, tagged synthetic webhook domain/outbox rows and private turns. It retains the synthetic companies and their immutable legal history until disposable-stack teardown, without weakening or disabling any guard. The corrected suite remains **PENDING actual rerun**.

## Transport proof and limits

`publicWebhookTransport.ts` already validates every returned DNS address, pins a validated address into HTTPS lookup, enforces HTTPS, bounds response bytes and leaves 3xx un-followed. No production transport rewrite was justified. Four new tests execute the real production policy with an actual isolated local TLS listener. DNS and final socket routing are synthetic test-only seams: validated public pin is recorded before the transport is routed to loopback with a generated temporary trusted test certificate. No public IP is contacted; no production guard or TLS verification is disabled.

Private DNS and mixed public/private answers produce **zero socket attempts and zero listener requests**. Public pin is validated once and receives the exact request body/header over TLS. A307 with private Location is returned unsuccessful with one listener request and no follow. This does not prove every other URL consumer, external DNS/service configuration, partner endpoint behavior, or deployed end-to-end delivery.

## Executed checks

- Node22 targeted suite: `vitest run __tests__/webhook-fair-claim-continuation.test.ts __tests__/webhook-transport-continuation.test.ts __tests__/public-webhook-transport.test.ts`: **33/33 PASS**, three files.
- Adapter RED before implementation: **2/2 failed for the expected starvation and schema fallback behavior**.
- Scoped ESLint of webhook source plus four new test/config files: **PASS**.
- `tsc --noEmit -p tsconfig.scripts.json`: **PASS**.
- Owned diff whitespace check: **PASS**.
- Shared `tsc --noEmit -p tsconfig.tests.json` initially failed only unowned `company-settings-ui-actions.test.ts:71` missing required children; owner/root notified. No successful shared test typecheck is inferred.
- Local Docker/psql absent: actual native SQL, migration replay/advisors, generated type/schema parity and exact-head CI remain **NOT_EXECUTED**.

Supabase changelog retrieval returned unsupported text/markdown; PostgreSQL current SELECT/SKIP LOCKED and Node HTTPS primary docs were consulted. No current Supabase feature/version assumption was made beyond installed CLI `migration new --help`.

## All original requirement gaps at initial inventory

The status below is copied from the unchanged original matrix; the gap column is actionable continuation scope, not an independently certified final verdict for each entire execution path. External boundaries block only the dependent component. Native/HTTP/browser work that can run with synthetic isolated resources must continue independently.

| ID | Initial recorded status | Remaining path or evidence |
| --- | --- | --- |
| T01 | PARTIAL | Final-head native/API/browser denials across customer, invoice, case and attachment; every actor mode. |
| T02 | PARTIAL | Two customers in one tenant across all protected resources; real issuer enrollment remains external. |
| T03 | PARTIAL | Cross-company role context, selected-resource command grants and forged-action/native denial. |
| T04 | PARTIAL | Retain read-only resolver evidence; qualify all normal synchronization and legacy writers. |
| T05 | PARTIAL | Retain disabled-account revival guard; qualify retry, current SQL and concurrent revocation. |
| T06 | PARTIAL | Delegated scope plus wrong-customer negative proof for all routes; real issuer enrollment external. |
| T07 | PARTIAL | Forged actor/company/verified fields in HTTP, forms and direct SQL with zero effects. |
| T08 | PARTIAL | Real two-tab selected-tenant switch versus stale form submission and DB after-read. |
| T09 | NOT_VERIFIED | New writer/RPC fences require native ACL/effect snapshots on final candidate. |
| T10 | PARTIAL | Current-token revoked account/session/membership plus expiry during final write/read lock waits. |
| T11 | PARTIAL | Final-head OPS/API parity across remaining contact/profile writers; old primary proof is bounded. |
| T12 | PARTIAL | Final-head phone-only primary/secondary and legacy-writer preservation of omitted fields. |
| T13 | NOT_VERIFIED | Correct issuer-owned login-change and step-up workflow not established; trust/recovery authority external. |
| T14 | NOT_VERIFIED | Default change plus inherited and explicit contract overrides through native/API/browser. |
| T15 | NOT_VERIFIED | Common resolver through readiness, preparation, locked snapshot and export; one exact revision. |
| T16 | NOT_VERIFIED | Native immutable issued invoice/document hashes before and after every allowed profile change. |
| T17 | NOT_VERIFIED | Separate verified redelivery decision and immutable original invoice; initial draft approval is not redelivery proof. |
| T18 | NOT_VERIFIED | Two real transactions competing between profile edit and invoice configuration lock. |
| T19 | PARTIAL | Remaining profile/address/site/billing commands must prove stale-revision conflict, no lost writes. |
| T20 | PARTIAL | Every atomic field contract and late invalid field, no partial business/audit/outbox effect. |
| T21 | PARTIAL | Late-fault rollback across each command and every legacy writer. |
| T22 | PARTIAL | Actual lost HTTP response after committed write, replay one logical completion for each command. |
| T23 | PARTIAL | Changed payload under identical key including concurrent HTTP writers and noncontact commands. |
| T24 | NOT_VERIFIED | Two real concurrent case creates under same key, one thread/case/message/completion. |
| T25 | PARTIAL | All command replays after revocation and concurrent expiry; prior contact proof is bounded. |
| T26 | NOT_VERIFIED | Actual API-created case, OPS response, portal read with tenant/customer native afterchecks. |
| T27 | NOT_VERIFIED | Continue the same case through staff phone interaction and return to customer-visible channel. |
| T28 | NOT_VERIFIED | Staff help without portal account plus independently authoritative caller/risk/mandate policy; external decision boundary. |
| T29 | NOT_VERIFIED | Unidentified caller/intake cannot read or edit customer data; unverified phone entry is internal. |
| T30 | NOT_VERIFIED | Email/phone change cannot bind old-account ownership; enrollment/recovery trust authority external. |
| T31 | PARTIAL | Operation/body/resource-bound sensitive proof and one-time/replay semantics; real issuer policy external. |
| T32 | NOT_VERIFIED | Separate billing mandate rather than inferring it from portal/customer relationship. |
| T33 | PARTIAL | Internal notes across API, UI, webhook, notification and message transport; prior publication proof is bounded. |
| T34 | NOT_VERIFIED | Actual staff actor and phone channel in same-case history and customer-safe projection. |
| T35 | NOT_VERIFIED | Attachment references/storage object ownership against same-tenant other customer and foreign tenant. |
| T36 | NOT_VERIFIED | Private quarantine enforcement native/browser; scanner verdict/release delivery remains external and disabled. |
| T37 | NOT_VERIFIED | This package proves private/mixed DNS zero sockets, validated pin, exact TLS bytes and no redirect follow; other URL consumers remain open. |
| T38 | NOT_VERIFIED | Partner ordering, duplicate events and concurrent stale writes across profile/invoice effects. |
| T39 | NOT_VERIFIED | Persisted scoped partner failure/retry state while independent support remains usable. |
| T40 | NOT_VERIFIED | This package repairs webhook queue starvation; native fair turns/caps pending. Other queues, request quotas and measured tenant load remain open. |
| T41 | NOT_VERIFIED | Native HTTP key revocation/expiry across all protected routes; no real key rotation. |
| T42 | NOT_VERIFIED | Browser XSS/CSRF plus strict field/mass-assignment negative tests and zero protected effects. |
| T43 | NOT_VERIFIED | Anonymous limited intake with indistinguishable existence/nonexistence responses and no history. |
| T44 | PARTIAL | Final-head revision consistency after save/reload across customer card, lists and invoice preview. |
| T45 | NOT_VERIFIED | Current browser mobile, keyboard, zoom, validation/conflict and preserved drafts. |
| T46 | NOT_VERIFIED | Direct technical deep links denied on server in tenant/nonplatform roles. |
| T47 | NOT_VERIFIED | Current support session/mandate expiry on continued reads/writes/replay and existing JWT. |
| T48 | NOT_VERIFIED | Frozen final runtime/OpenAPI/reference client plus actually served bytes; no older release evidence transfer. |
| T49 | PARTIAL | Authentic final empty replay artifacts and actual pinned older-schema upgrade with data/invariants. |
| T50 | NOT_VERIFIED | Enumerated legacy action/import/RPC writers must pass command/fence and denial proof. |
| T51 | NOT_VERIFIED | Log/response/privacy trace and formal credential scan where available; GitGuardian BLOCKED_AUTH remains distinct. |
| T52 | NOT_VERIFIED | Real role elevation/recovery/key issuance ownership, current permissions and negative tests. |
| T53 | PARTIAL | API/OPS stable case paging with concurrent insertion and combined search/filter/sort. |
| T54 | PARTIAL | Two real issuer-bound identities with colliding subject/email, active DB ownership and browser/API. |
| T55 | NOT_VERIFIED | Actual isolated backup restore plus incident rehearsal; plan-only is not database evidence. |
| U01 | PARTIAL | 147 static pages classified; complete role/import/domain/runtime classification remains open. |
| U02 | PARTIAL | 3439 lexical candidates are not business actions; 1091 syntactic bindings, 29 scoped families, actual action denominator unknown. |
| U03 | NOT_VERIFIED | All pages/actions need correct resource, server operation and persisted result; customer-card scope alone cannot close. |
| U04 | NOT_VERIFIED | Verified completion rather than toast across every scoped action and failure branch. |
| U05 | PARTIAL | Save/cancel/reload across all forms and current persisted defaults. |
| U06 | PARTIAL | Double click/retry at browser and native boundary for all distinct business effects. |
| U07 | PARTIAL | Combined search/filter/sort/paging and concurrent inserts across remaining lists. |
| U08 | NOT_VERIFIED | Deep links/back/forward/reload preserve actor/tenant/resource and safe draft context. |
| U09 | PARTIAL | Current UI role capability and independently enforced server/DB access on all pages. |
| U10 | NOT_VERIFIED | Every menu/dialog keyboard/focus cycle and accessible error interaction. |
| U11 | NOT_VERIFIED | Validation/conflict retain draft and revision/key; actual browser proof. |
| U12 | NOT_VERIFIED | Navigation, tenant change, logout and browser history safely handle unsaved draft. |
| U13 | NOT_VERIFIED | Mobile and 200% zoom central controls across remaining OPS surfaces. |
| U14 | NOT_VERIFIED | Common components/domains used by every equivalent form; no duplicate business rules. |
| U15 | NOT_VERIFIED | Actual duplicate UI task/workflow inventory and explicit consolidation decisions. |
| U16 | NOT_VERIFIED | 69 literal navigation targets exist; dynamic URLs/handlers/placeholders still need actual path evidence. |
| U17 | NOT_VERIFIED | Actual upload/download/export resource and file byte/permission checks across surfaces. |
| U18 | PARTIAL | Loading/empty/error/read-only/blocking states on all pertinent OPS and portal paths. |
| U19 | NOT_VERIFIED | Technical/platform controls plus direct server routes segregated from tenant workspace. |
| U20 | PARTIAL | 29 scoped families currently have no final-candidate native/browser acceptance; whole OPS denominator remains unknown. |

## Next independent packages

1. Root qualifies the frozen candidate and this fair claim in real disposable replay before generating authentic artifacts.
2. Finish common billing resolver/snapshot/lock/export native proof and explicit redelivery boundary; preserve issued artifacts.
3. Finish same-case API/OPS/phone/portal journey, quarantine ownership, replay/concurrency and actual attribution; verified caller policy and real scanner remain separate configuration boundaries.
4. Continue global OPS action tracing and role/resource/browser proof. The 29 customer-oriented families cannot replace the147-page assignment.
5. Qualify login/recovery/step-up/issuer collisions, late partner event order, all other tenant queues, current-key revocation, logs, performance baselines and actual older-schema backup/restore/incident rehearsal.

No broad requirement is converted to BLOCKED merely because one real external issuer, partner, scanner or deployed website is missing. Record the exact blocked dependency and complete remaining implementable checks.
