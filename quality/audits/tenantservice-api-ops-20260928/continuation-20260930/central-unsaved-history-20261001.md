# U12/U15: central dirty-form and history traversal boundary

Date: 2026-10-01. This two-file packet is a **prepared browser qualification** plus a current source/design disposition. It makes no history, router, form, server-action, Auth, database or provider production change. Local browser/native execution: **0**. Three Playwright cases are authored and discovered; discovery is not runtime acceptance or observed RED.

## Current shared boundary and actual consumers

The actual `components/admin/AdminUnsavedChanges.tsx` provider owns in-memory actor/tenant-keyed drafts, dirty registrations, native before-unload handling, captured native/Next anchor clicks and other-form submit confirmation. `app/admin/layout.tsx:48` keys the provider by current actor/view/company. Sensitive fields are not stored in localStorage. Protected editor submissions opt out of unrelated-navigation confirmation. Explicit discard clears draft memory and invokes each registered discarder. These are source facts; they do not establish every mounted form or historical navigation result.

| Current central family / actual caller | Dirty/draft source disposition | Remaining runtime boundary |
| --- | --- | --- |
| `CustomerEditForm` -> contact/address (`CustomerContactsAddressesCard`), legal profile/lifecycle (`CustomerProfileCard`), billing default/override (`CustomerBillingProfileCard`), site (`CustomerSiteForm`) | Shared dirty hook and actor/tenant draft memory; save clears only a typed confirmed response, errors/conflicts keep the draft. Controlled selector restoration is supplied by the relevant callers. | Every mounted field/remount/current revision and Back/Forward path still needs its own genuine receipt; static reuse is not whole-family runtime acceptance. |
| `CompanySettingsForm` -> settings/responsible access, billing integration controls and pricing-source wrapper | Shared dirty hook, explicit discard, pending/double-click guard, controlled manual dispatch preserving failed uncontrolled drafts; positive qualified action state clears dirty. | Mounted/reset/remount and traversal behavior remains separate from source/action/unit receipts. |
| `SupportActionForm` -> OPS case create/status/message/upload (and separate portal use) | Shared dirty hook, pending lock, preserved failed request key/draft, explicit local cancel and typed successful reset. It supplies no shared discard callback or draft-memory restoration. | Current mounted navigation/discard/revalidation/portal scope must be qualified separately; portal use is not additional proven OPS pages. |
| `RedeliveryDecisionForm` -> actual invoice redelivery page | Controlled account/reason register dirty regardless of subsequent canRecord loss. Pending/error retain draft; server-qualified saved decision clears dirty/completion locks. | Existing seven-file U12 preparation has two genuine browser cases authored/zero executed; this packet adds traversal-only evidence, not delivery/provider acceptance. |
| Actual customer notes tab -> `page.part-4.tsx:1327` -> exported `NotesSection` in `page.part-2.tsx:456` | Plain current form/body textarea never registers a dirty draft. The old `CustomerInternalNotesCard` has no production callsite, so repairing that unused component alone would not repair the current OPS surface. | Separately authorized actual exported provider/NotesSection functional proof currently 2 meaningful RED / 1 untouched control PASS, with hook/event adapters only; client-wrapper source change awaits the current publication capture. No genuine DOM/browser lost-data result is inferred. |
| Support publication (`customer-cases` public_body), platform-only profile test/archive/delete reason/confirmation forms, Ediel inbound approve/reject note forms | Current plain draft inputs are additional source candidates outside the registered families. Destructive-action confirmations are distinct from unsaved-navigation protection. | No lost-draft or authorization exploit is claimed; these candidate callchains require actual bounded reproduction and owner coordination. |

This table is a bounded central-source disposition, not the full 302 semantic business-action denominator or acceptance of all original U01–U20. The frozen full-page/source registries keep their explicit OPEN/NULL/runtime0 semantics.

## History traversal source gap and implementation boundary

The actual provider registers no history traversal handler. Installed Next **16.3.8** `node_modules/next/dist/client/components/app-router.js:281–305` handles `popstate` by restoring the history entry/tree and patches `history.pushState`/`replaceState` with Next's internal state. The installed AppRouterInstance exposes back/forward/push/replace/refresh, with no public beforePopState cancellation hook. These statements are inspection of the exact installed code, not claims about another framework version.

A missing prompt is an uncovered navigation requirement; it does not establish that cached form values were lost. Next may preserve route state, so a real mounted route traversal must determine the actual behavior first. This packet introduces no history sentinel, synthetic compensating `go(1)`, patched Next-private tree, event-order hack or blanket promise that a popstate callback can cancel traversal. A future shared implementation must preserve genuine Back/Forward entry semantics, current dirty registrations and exact explicit discard, and be reviewed after actual observed evidence.

## Prepared genuine Next browser journey

New `e2e/browser/invoice-redelivery-history-traversal-20261001.spec.mjs` reuses the **existing fresh independent U12 fixture** and real local GoTrue login, invoice page and actual Next Link to the decision page. It requires CI true, the exact localhost Supabase endpoint, no external browser target, a private fixture under RUNNER_TEMP and a private password environment variable and fixture decisionCount=0. All non-loopback requests are aborted. There is no new Auth/security attack, artificial user/role setup, action replay, provider request, native script or financial mutation. Traces/videos are disabled for this private fixture journey. The browser script does not print credentials or request payloads.

The authored cases require:

1. Untouched Back/Forward across real invoice/decision entries without a manufactured dialog; both fields empty; zero Next-Action POSTs.
2. Dirty Back traversal with a genuine confirmation that can be dismissed; original decision entry and account/reason retained; zero action POSTs.
3. Explicitly accepted Back discard, then genuine Forward to an empty account/reason draft; zero action POSTs.

The dirty cases wait for an actual confirm dialog. If it is absent, the test fails as uncovered traversal qualification; it does not declare lost data or manufacture a dialog. Only after genuine execution may their outcomes be recorded as RED/PASS. This packet neither executes those cases nor solves that source gap.

Run this history spec **after the existing U12 browser-seed phase and before the old saved-decision journey**, with retries=0. Then run the existing two-case U12 spec and unchanged native browser-postcheck. The old postcheck still expects exactly one persisted separate decision/audit from its original saved-decision journey and preserves original financial/customer/Auth/foreign evidence. These new history cases dispatch no actions; they add no expected decision. Do not run them against the already completed/locked decision fixture or count the independent flows twice. Root owns workflow ordering.

Reuse existing private environment `GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH`, `GRIDEX_REDELIVERY_NAVIGATION_PASSWORD`, `RUNNER_TEMP`, CI and the current local Next/Supabase environment, then enable only the unique history flag:

```sh
GRIDEX_REDELIVERY_HISTORY_LOCAL_E2E=1 /tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/@playwright/test/cli.js test e2e/browser/invoice-redelivery-history-traversal-20261001.spec.mjs --config playwright.config.mjs --project=chromium --retries=0
```

## Actual local receipt and exact freeze

Node 22 syntax check: exit 0. Scoped ESLint: exit 0, no diagnostics. Actual Playwright `--list`: **three discovered cases**, no browser execution. Existing fixture/native/browser source bytes are unchanged. Local native, browser, real Auth/network/database/provider execution for this two-file packet: **0**. Screenshots are prepared narrow-form paths `e2e-artifacts/invoice-redelivery-history-cancelled.png` and `...-confirmed-discard.png`; none has been produced here.

Browser source SHA-256: `b05bad5ca647061c12c4359146e727f5ac77328f56b8d9ee5f24a12b04daf8ef`. This report is the second file; exact hashes/bytes are in the separate manifest. Pending independent review is not recorded as PASS. All original master requirements remain with their explicit per-requirement verified/open/blocked dispositions; this preparation does not close whole U12/U15 or the masterplan.
