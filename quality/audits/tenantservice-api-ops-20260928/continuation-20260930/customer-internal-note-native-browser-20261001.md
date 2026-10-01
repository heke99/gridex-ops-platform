# U12/U09: prepared genuine customer-note browser and stored-effect proof

Date: 2026-10-01. Root authorized this separate four-path preparation. Native executions **0**; genuine browser executions **0**. The preceding Notes7 server/client packet and later actual page capability packet are separate source evidence. This report does not certify a mounted interaction, actual stored note, real Auth authorization or full original requirement.

## Reuse and ordering

Reuse the existing FRESH synthetic U12 fixture from `scripts/invoice-redelivery-unsaved-navigation-20261001-native.test.ts`, with its existing real GoTrue writer/reader and original dispatched invoice graph. Its canonical writer already has masterdata.write and reader has masterdata.read/customers.read without masterdata.write. This packet creates no Auth user, role, permission, financial fixture, SQL table or trigger and changes none of those existing seed bytes. Native phases only read the local database and write their own mode-0600 snapshot outside the repository. Required tables/query errors fail; no missing schema is manufactured or replaced by empty evidence.

Required workflow order is: existing U12 browser-seed → **new note baseline** → frozen history traversal journey → existing U12 save journey → existing U12 native postcheck → **new note browser journey** → **new note native postcheck** → existing secret/fixture cleanup. The fresh seed and baseline require decision0 and note0; the old journey later owns exactly one redelivery decision/domain event. Existing fixtures or a previously saved note are refused, never reset. Root owns workflow wiring.

Private environment: existing `GRIDEX_NATIVE_STATUS`, `GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH`, `GRIDEX_REDELIVERY_NAVIGATION_PASSWORD`, `RUNNER_TEMP`; add `GRIDEX_NOTE_UNSAVED_SNAPSHOT_PATH` beneath private RUNNER_TEMP, `GRIDEX_NOTE_UNSAVED_PHASE=baseline|post-browser` and browser `GRIDEX_NOTE_UNSAVED_LOCAL_E2E=1`. Snapshot and reused fixture must be separate private regular files. Snapshot creation uses `wx`; its baseline cannot be silently overwritten. No fixture/password/Auth token/snapshot/private logs should be uploaded as CI artifacts.

```sh
GRIDEX_NOTE_UNSAVED_PHASE=baseline node node_modules/vitest/vitest.mjs run --config scripts/customer-internal-note-unsaved-20261001-native.config.ts
# Run history, existing U12 browser save and existing U12 native postcheck here.
GRIDEX_NOTE_UNSAVED_LOCAL_E2E=1 node node_modules/@playwright/test/cli.js test e2e/browser/customer-internal-note-unsaved-20261001.spec.mjs --workers=1
GRIDEX_NOTE_UNSAVED_PHASE=post-browser node node_modules/vitest/vitest.mjs run --config scripts/customer-internal-note-unsaved-20261001-native.config.ts
```

Use the existing Node22/local-CI environment, genuine status keys and current Next local server. The config refuses other API URLs and non-CI execution; SQL is pinned to disposable 127.0.0.1:54322. Browser refuses external base URL and aborts non-local hosts; trace/video are off so credentials do not enter those artifacts. Screenshots are narrowly synthetic note-form states (`customer-internal-note-*.png`). Local Playwright configuration runs Next dev; no production RSC error-body qualification is implied. The proof does not rely on raw Forbidden/error details.

## Intended exact qualifications

The two actual-browser cases use the real login, selected-company cookie, customer page/NotesSection/client wrapper and compiled Next form action. Writer: cancelled navigation preserves body with zero action POSTs, explicit discard resets, accepted discard navigates and returns empty; ordinary whitespace validation returns the safe unconfirmed warning and keeps draft/navigation dirty; a held real action POST exposes disabled pending controls, actual requestSubmit during pending produces no additional POST, cancelled navigation retains body; qualified receipt clears the draft and live navigation guard before any reload, then a fresh GET shows exactly one stored history entry with the actual writer attribution. Exactly two writer action POSTs are intended: one invalid body and one valid save. Reader: actual mounted fieldset/editor/save are disabled, no fresh dirty state/dialog or action POST. The reader assertion was first qualified as a separate actual source functional 2-RED/4-control finding and corrected through the actual current page guard; no fake writer fixture or browser PASS substitutes for it.

Native baseline records canonical PostgreSQL-text SHA-256 **before JSON.parse**, preserving numeric/bigint/JSON precision and stable ordering. It hashes all rows of 20 explicit financial/customer/company/account tables, all current profiles, every original Auth user except the two owned login actors, and a narrow exact owned-actor identity/profile projection. Legitimate browser login session/last-sign-in bookkeeping is not asserted immutable. The foreign company is checked across every current physical public table with company_id; table inventory changes are observable. All original notes outside the one owned actor/customer creation predicate, and all original audit/usage rows by their captured IDs, remain exact. The prior redelivery command creates its separate domain event, not audit_logs or usage rows. Global added-ID sets must equal exactly the one expected new audit and usage ID; no unspecified new rows or broad tenant exclusion are allowed.

Postcheck verifies unchanged reused fixture bytes, all those digests, exactly one note with company/customer/body/created_by/updated_by, exactly one matching required canonical audit with the stored note in new_values, and exactly one matching usage event. Current stored note ID/company/customer/actor are matched, not inferred from promise resolution or text similarity. The prior separate decision stays exactly1 and owned domain-event count stays baseline+1; no new note domain event, provider/invoice/document rewrite or retry is permitted by this proof. Native phases do not sign in or mutate Auth.

The actual creator's insert, canonical audit and after-read are separate operations. Audit/after-read failure may leave a note committed and manual retry may duplicate it; this preparation does not invent atomicity or idempotency and does not exercise a late audit fault in the real stack. The local unit packet covers the explicit unknown-outcome draft warning. Physical PDFs/storage bytes/external provider delivery, deployed Next/Auth cookies, all browser history behavior and original-financial whole-masterplan acceptance remain separate.

## Executed preparation gates and frozen manifest

Scoped native/config TypeScript exits0. Scoped native/config/browser ESLint with zero permitted warnings exits0. Browser syntax passes. Playwright discovery lists **two** cases; it does not launch a browser, sign in, contact a database or qualify their assertions. No native config/test was invoked locally. Independent prepared-source review is requested. A prepared-only self-review superseded manifest `b830deb6055703262815158e64cbc1e1cd554e92024ddda4d6b717d9ffc15291`: exact current redelivery source has no audit_logs/usage insert, so postcheck now requires global added audit/usage ID sets to equal exactly one expected row each. No native/browser run existed under the superseded preparation.

| Path | SHA-256 |
| --- | --- |
| `scripts/customer-internal-note-unsaved-20261001-native.config.ts` | `ac720c77ea4903c6282441cb957e2dae0abebf9ebaab9fb1c606a5bd4e484018` |
| `scripts/customer-internal-note-unsaved-20261001-native.test.ts` | `400a3e8ca95af591522a183de88faf3f9c0cc8ccca8994dfee2ab7bce241e3e4` |
| `e2e/browser/customer-internal-note-unsaved-20261001.spec.mjs` | `969a3242c3ec6a2cbbce4918e23abe66401e142d1a9c1d7d16692bb2b071d705` |

This report is the fourth path; final exact SHA/blob/bytes are in `/tmp/gridex-customer-internal-note-native-browser-frozen-20261001.json`. The required SQL tables, actual current customer page loaders, Next dev/GoTrue session behavior, live pending/reset/focus mechanics and fresh row/after-read/audit graph are intended real CI boundaries, currently **NOT_EXECUTED**. No static action denominator or runtime-qualified original requirement is inferred from this preparation.
