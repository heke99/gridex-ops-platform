# Billing saved recipient/revision continuation — 2026-10-01

Status: bounded action correction locally verified; actual native/browser continuation prepared, not executed in this workspace. The original T01–T55/U01–U20 meanings remain unchanged. This package cannot certify whole T44 or a real partner receipt.

## Exact owned packet

1. `app/admin/customers/[id]/billing-profile-actions.ts` — the only production edit, authorized after actual-function RED.
2. `__tests__/billing-recipient-revision-continuation-20260930.test.ts`.
3. `scripts/billing-recipient-revision-continuation-20260930-native.config.ts`.
4. `scripts/billing-recipient-revision-continuation-20260930-native.test.ts`.
5. `e2e/browser/billing-recipient-revision-runtime-local.spec.mjs`.
6. This report.

No previous billing/import/redelivery source, migration, SQL fixture, generated contract/type, checksum, workflow, shared UI, memory or Git ref is changed. Root owns integration, broad gates and publication. All fixture writes are random synthetic rows in a disposable local replay; immutable history is not deleted for cleanup.

## Reproduced production defect and correction

Both actual exported customer-default and contract-override actions returned no confirmed saved receipt when `revalidatePath` failed after the canonical RPC had already completed. Initial actual-function suite: **2 RED, 4 PASS** (stale conflict and current-company mismatch controls already passed). The correction isolates postcommit refresh, preserves the RPC's revision/change/replay/completion fields, and gives a reload notice on ordinary cache failure. `unstable_rethrow` retains framework control flow. Existing typed command errors, expected revisions, current guard/company equality, current server-derived Auth session and SQL authorization are unchanged.

Consumer qualification then found the real `CustomerEditForm` renders `notice`, not the actions' existing `message`. Requiring the actual notice reproduced **2 RED, 6 PASS** before adding the notice to the qualified receipt. Final new suite is **8/8 PASS**, including both cache failures, both framework redirects, both stale revisions and both selected-company mismatches. With the existing billing UI parity and locked snapshot suites, **32/32 PASS across three files**. No database response or refresh is invented by the action tests: the canonical RPC is the mocked boundary, while command parsing/result qualification and the exported actions run unchanged.

## Existing actual implementation and proof inventory

The whole `customer-billing-command-native.sql`, `customer-billing-concurrency-native.test.ts`, effective resolver, profile command/lock, full readiness, preparation, both senders, payload builder and current customer card were read. Existing native SQL already covers canonical defaults, legacy explicit copies, null vs absent inheritance, country/contact separation, stale/replay/payload/foreign/read-only denial, immutable v1/v2 locks, audit/event/outbox, current session/grants and captured failed/sent provider payload/GUID immutability. Existing genuine connection tests already cover both profile-first and invoice-lock-first schedules, two simultaneous profile writers with one revision winner, same-key replay, current grant withdrawal while replay waits, and final session clock after a late audit wait. They are not duplicated here or promoted to native PASS without root's final-candidate run.

The missing bridge was the real TypeScript readiness request through local PostgREST into the actual lock function, followed by actual preparation/approval/export from that saved revision, plus a real rendered form journey. The additional tests specifically prepare that bridge.

## Prepared actual native bridge

Two cases select the approved sender and canonical generic retry sender. Each reuses the authentic historical seed prefix of frozen `invoice-redelivery-decision-20260930-native.sql`, stopping before its first decision. It adds one billable inherited contract and one explicitly overridden contract, exact customer/site/meter/supply/pricing bindings, complete synthetic October metering coverage and locked real pricing rows. Full original invoice/item/underlay/pricing/line/document-reference rows are captured.

The real default command saves revision 2. A separate PostgreSQL connection holds the actual customer row; the real `evaluateBillingMonthInvoiceReadiness` begins through local Data API. A read-only observer requires the actual `gridex_lock_billing_configuration_v2` request to wait on that exact blocker PID. The blocker calls the canonical profile command to revision 3 and commits. The stale readiness request must reject `billing_profile_revision_conflict`, with **zero locked draft snapshots**. An early preflight result fails the proof instead of being counted as a wait. Application names are random and checked below 63 bytes.

A fresh real readiness request locks revision 3 with exact snapshot hash: inherited email follows the saved customer default, explicit agency email stays explicit, recipient/country/channel/revisions and field sources are matched. Later live default revision 4 and explicit override revision 1 must not alter these locks. Actual `prepareInvoiceDraftsForReview` consumes the locked pricing and creates the canonical invoice graph/address snapshot. Actual `approveAndSendReadyInvoicesForMonth` creates the genuine review hash and approval metadata. In the approved case its two sends succeed at the synthetic external boundary. In the canonical case only the external transport times out; the real generic sender resumes the genuinely approved captured requests, with identical payload and key across attempts. No approval metadata is manufactured by this fixture.

The real provider configuration resolver reads an exact synthetic API-key connection and an explicit synthetic env reference; it is **not mocked**. Only `CapwayApticClient` transport is replaced, its constructor checks test environment, loopback endpoint and synthetic key, and purchase throws if invoked. Production readiness, current tenant/outbound policy, automation locks, calculation/address snapshots, approval, request CAS, GUID persistence, invoice graph/status, audit and outbox functions run unchanged. UI-only `next/navigation` and `server-only` loader shims do not replace domain authority. Expected native receipts require unchanged original whole graph, current saved UI projection, exact saved invoice address/revisions and only synthetic requests. A synthetic `sent` result is not a real provider acknowledgement.

## Prepared real Chromium journey and independent database postcheck

The same unique native config supports `browser-seed` and `browser-postcheck` phases. Seed uses real local GoTrue creation/login and canonical tenant context to qualify current writer, read-only and foreign writer permissions; no password is stored in the fixture. The fixture file must stay under `RUNNER_TEMP` with mode 0600. Browser targets only the disposable default loopback app and blocks external browser requests.

One serial, nonretrying Chromium journey uses the actual billing tab/card/forms and generated Next server-action request. It checks pending fieldset/input/button locking while that request is held; current saved default revision 2 survives reload and only inherited contract email changes; a separately logged-in stale writer keeps its draft and old revision, sees conflict and cannot silently overwrite; explicit agency override persists; a later customer default revision 3 preserves that override; explicit clear produces missing email and override revision 1; inheritance removes the email key and produces revision 2 from the current default. It captures a saved screenshot. The same actual completed server-action request is replayed under current reader and foreign writer sessions; no form is available and the response must deny. This is prepared real browser behavior, not inferred from static markup.

The independent native postcheck requires exact current revision/default values, explicit override revision 1, inherited override revision 2 with the email key genuinely absent, exactly two new default commands and three override commands, five writer-attributed audit records and five corresponding outbox entries. Contact values/revision, original owner Auth/profile/portal-account rows, the complete issued graph and foreign customer/issued graph must remain byte-for-byte equal. Browser phases do not invoke any provider client.

Independent OPS source review confirmed the cache receipt/notice/framework flow and bounded native overlap/source/history assertions. It identified a possible false browser denial: a foreign page redirect or unknown action/routing failure could satisfy an arbitrary HTTP error. The proof now captures the original request pathname/query, replays to that exact card path, requires an actual `text/x-component` response and the actor-specific `Forbidden` error or `tenant_context_changed` result, and explicitly excludes unknown-action/module/build failures. Independent postcheck still requires zero extra commands or foreign effects. No runtime qualification is inferred from this source review.

Final independent read-only review of that precise replay correction: **PASS**; reviewer confirmed the actor-specific response checks apply at every HTTP status and the independent exact-count/foreign postcheck remains separate. Pending, conflict and saved screenshots target the real form/card instead of an arbitrary viewport. Actual images are produced only when the browser journey runs.

## Validation receipt and exact continuation commands

- New actual action tests plus existing UI/snapshot suites: **32/32 PASS**.
- Focused TypeScript check of the new action test/native config/native test: **PASS**.
- Scoped ESLint of all five code paths: **PASS, zero findings**.
- Browser JavaScript syntax and Playwright discovery: **PASS, one Chromium test discovered**. Discovery is not browser execution.
- Native config without the status/local-CI prerequisites: **rejected before collection**, expected exit 1 with `billing_recipient_disposable_replay_required`.
- `git diff --check`: **PASS**.
- Two native bridge cases, real Chromium journey and native browser postcheck: **NOT EXECUTED HERE**; no disposable native Docker/PostgreSQL stack is available. Root owns workflow wiring and actual complete-schema receipts.

After the complete disposable migration replay and exported local public/service env:

```sh
CI=true GRIDEX_NATIVE_STATUS="$RUNNER_TEMP/e035-native-status.json" node node_modules/vitest/vitest.mjs run --config scripts/billing-recipient-revision-continuation-20260930-native.config.ts
CI=true GRIDEX_NATIVE_STATUS="$RUNNER_TEMP/e035-native-status.json" GRIDEX_BILLING_RECIPIENT_PHASE=browser-seed node node_modules/vitest/vitest.mjs run --config scripts/billing-recipient-revision-continuation-20260930-native.config.ts
CI=true GRIDEX_BILLING_RECIPIENT_LOCAL_E2E=1 node node_modules/@playwright/test/cli.js test e2e/browser/billing-recipient-revision-runtime-local.spec.mjs --project=chromium
CI=true GRIDEX_NATIVE_STATUS="$RUNNER_TEMP/e035-native-status.json" GRIDEX_BILLING_RECIPIENT_PHASE=browser-postcheck node node_modules/vitest/vitest.mjs run --config scripts/billing-recipient-revision-continuation-20260930-native.config.ts
```

Browser seed/run/postcheck also require `GRIDEX_BILLING_RECIPIENT_FIXTURE_PATH="$RUNNER_TEMP/billing-recipient-revision-fixture.json"`, one generated synthetic `GRIDEX_BILLING_RECIPIENT_PASSWORD`, and `RUNNER_TEMP`. No existing issuer/provider credential is needed; the native transport key is a fixed noncredential synthetic string. Existing billing SQL/concurrency and other financial/provider gates remain separate required commands.

## Original requirement boundaries

| ID | Bounded evidence/continuation | Exact remaining boundary |
| --- | --- | --- |
| T14 | Canonical default and explicit override semantics; local parity tests; prepared actual card/native save path | Final native/browser receipt and remaining affected API/portal writers |
| T15 | Prepared actual readiness/PostgREST lock -> preparation -> real approval -> both sender payloads/address snapshots at saved revision 3 | Native execution; actual partner receipt/channel/PDF remains separate external qualification |
| T16 | Original full invoice/item/underlay/pricing/lines/document-reference equality before/after all profile edits and browser writes | Native execution and physical remote document bytes; a fixture metadata string is not a real PDF |
| T18 | Prepared observable actual readiness RPC vs canonical profile write rejects stale lock without mixed snapshot | Native execution; existing opposite ordering remains a separate genuine connection test |
| T19 | Existing two-writer/one-winner, replay and current authority cases reused; new browser stale write must add no command | Existing full-schema concurrency and browser postcheck execution |
| T44 | Confirmed action receipt survives refresh failure; prepared current card from saved DB and real invoice detail loader from immutable address/revision | **Actual invoice page currently omits billing recipient/address/revision; customer list has no billing revision display.** These frozen sources are untouched and were reported to root for separate grounded continuation. Whole T44 remains incomplete. |
| U04 | Qualified actual action receipt, safe conflict/error, framework rethrow and actual consumer reload notice | Prepared browser/native outcome execution; no whole control denominator claim |
| U18 | Prepared actual pending/conflict/draft/read-only/denial journey | Actual browser execution; empty and other OPS/portal surfaces remain separately scoped |
| U20 | One prepared full billing-card journey with saved screenshot and independent DB postcheck | Actual execution/artifact review and remaining affected UI journeys; static render/discovery do not certify this ID |

Financial provider receipt, physical provider PDF bytes and external delivery remain precise unavailable integrations. Local saved-recipient decisions, genuine overlap and rendered form behavior remain implementable continuation and are not blanket-blocked by those integrations.
