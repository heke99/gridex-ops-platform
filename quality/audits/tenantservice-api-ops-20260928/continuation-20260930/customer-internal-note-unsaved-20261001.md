# U12: actual customer internal-note draft and stored receipt

Date: 2026-10-01. Root released the publication barrier and reserved these seven files as a separate continuation packet. The eighth publication whitelist excludes the note page/action/component paths. This is bounded application source and functional-adapter evidence, not whole U12/U15, native durability or browser acceptance.

## Actual caller and genuine baselines

`app/admin/customers/[id]/page.part-4.tsx:1327` renders the exported `NotesSection` from `page.part-2.tsx`. The old plain form directly dispatched the existing void action. The older `components/admin/customers/CustomerInternalNotesCard.tsx` has no production caller; its unused surface was explicitly excluded before implementation.

The actual exported section and actual shared `AdminUnsavedChanges` provider/hook reproduced **2 meaningful RED / 1 untouched control PASS** at **06:12:26 Europe/Berlin (+02:00) = 04:12:26 UTC**. Typing did not register a draft: cancelled captured navigation was not prevented, and accepted discard did not reset the actual note form. Each failure asserted an effect boundary with zero server calls. This was not observed browser traversal or proven data loss.

The actual existing public void facade, creator, current guard, customer tenant guard and audit logger subsequently reproduced **6 meaningful RED / 9 existing controls PASS** at **06:44:48 (+02:00) = 04:44:48 UTC**. Two current-company mismatch cases inserted through an inconsistent controlled operational context, including canonical-false/platform-named-role control. Four malformed returned-row tuples proceeded to audit instead of denying qualification. The note insert may already have persisted in the latter cases; no rollback was fabricated. No absent new export, missing module or setup failure was counted as a RED.

The original creator and section are exact HEAD sources with SHA-256 `3c0dfe4bcf1ee7b033a9e74bc133b87434c88907a157be5e502533d52547e6db` and `76c7c3256d8482196da1f60a707e7b3c8bbfc80328a03c33d4342662a153c68a`. The initial three-case section proof SHA was `130858bda8c1fcd7e11605a0e502529d6964a4e156689a5ddabc48a8bf072e01`. Those historical receipts are not relabeled as the final extended suites.

## Guarded creator and narrow confirmed result

Only the existing note creator region/import changed in `actions.part-1.ts`. A private creator reuses the actual `masterdata.write` guard, real customer tenant context, existing note insert and required audit logger. Ordinary authority must belong to the same canonical current company as the real customer; `guard.isPlatformAdmin === true` preserves the authoritative global path. Legitimate non-owner operators remain allowed. No OWNER/ADMIN-only membership rule or role-name elevation was introduced.

The insert response must have a valid note identifier and the exact customer/company/created-by tuple before it can proceed to audit. The old outward `createCustomerInternalNoteAction` remains void, with its existing cache-error behavior. The separate facade `createCustomerInternalNoteReceiptAction` uses the same creator once, then independently reads only `id, customer_id, company_id, created_by` with all four exact predicates. Missing, errored or mismatched fresh rows cannot return a confirmed result. The returned object contains exactly `noteId`, `customerId`, `companyId`, `actorUserId`; no private note body, Auth data or audit metadata is returned.

A normal cache error after this confirmed read preserves the qualified result and records only a strict technical code. Actual installed Next redirect/not-found control flow remains rethrown. Other customer actions, the real tenant helper, shared guards, private history/attribution and T33/T34 publication projectors remain untouched.

## Real section and shared dirty control

The actual `NotesSection` now renders the new isolated `CustomerInternalNoteForm`, keyed by customer ID, with the separate real receipt action. It preserves the original textarea/header and entire existing history. The wrapper registers with the actual shared dirty hook and has explicit discard/reset. Manual FormData capture precedes pending disable and dispatch; the in-flight guard prevents a second submission. Pending controls and an untouched empty form do not dispatch.

Only a valid exact-customer receipt resets the text and releases the dirty guard. Void, missing identity, different-customer results and thrown errors retain the draft and present a constant unconfirmed message. The message expressly says the note may already exist in history before retry. No raw error is displayed. Explicit discard removes both the draft and obsolete warning; typing a new note hides a prior success and registers the guard again. No shared history interception, private Next API or history compensation was added.

## Actual local receipts and declared adapters

The original server 15 cases became GREEN; 16 additional acceptance cases then exercised the newly implemented actual facade, exact fresh read, only-four-field result, after-read failures/mismatches, required-audit fault, genuine global path, supplied-field independence and cache/Next outcomes. These new cases are not retroactively counted as original baseline RED. Server total: **31/31 PASS**.

The section/shared-provider proof became **11/11 PASS** with pending/double-click, qualified reset, errored/unqualified draft retention and discard/new-draft controls. One interim adapter assertion invoked navigation before running the next simulated render/effect turn; that harness timing assertion was corrected and excluded from defect counts. The React-hook/browser-event adapters execute the actual source but are not mounted React DOM.

Final related receipt: **64/64 PASS in five files** at **06:56:39 process-local Europe/Berlin (+02:00) = 04:56:39 UTC**, duration 4.98s. The two new suites contribute 42 unique cases; the existing site/legal/lifecycle suites contribute 22 controls. Scoped TypeScript (4 GiB), scoped ESLint with zero allowed warnings and whitespace checks pass. The current canonical Auth RPC/scope and SQL results are memory adapters; the server creator/current guard/tenant guard/audit logger and installed Next control-flow code execute genuinely. This is not live Auth or native SQL enforcement.

```sh
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/customer-internal-note-receipt-20261001.test.ts __tests__/customer-internal-note-unsaved-20261001.test.ts __tests__/ops-customer-site-action.test.ts __tests__/ops-customer-legal-profile-action.test.ts __tests__/ops-customer-lifecycle-action.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit --project /tmp/gridex-customer-internal-note-receipt-20261001.tsconfig.json
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/eslint/bin/eslint.js 'app/admin/customers/[id]/actions.part-1.ts' 'app/admin/customers/[id]/actions.ts' 'app/admin/customers/[id]/page.part-2.tsx' components/admin/customers/CustomerInternalNoteForm.tsx __tests__/customer-internal-note-receipt-20261001.test.ts __tests__/customer-internal-note-unsaved-20261001.test.ts --max-warnings 0
```

The temporary TypeScript project extends the root configuration, disables plugins/incremental, includes these six source/test paths and excludes node_modules. It is not a broad published-head build receipt.

## Persisted-note risk and remaining qualification

Note and required audit remain separate operations. An audit fault may leave a stored note; an after-read fault may leave both note and audit. The honest unconfirmed UI retains the draft and warns before retry. There is no atomic note/audit transaction or idempotent retry guarantee, and no automatic retry. These risks are explicitly retained rather than turned into false success or rollback claims.

Actual mounted note interactions, live actor/session/database durability, native audit behavior and real browser save/pending/discard/error are **0 executed** for this packet. The separately frozen `central-unsaved-history-20261001.md` prepares three genuine Back/Forward cases on the existing fresh U12 fixture; they are still unexecuted. That preparation qualifies shared traversal behavior only when run and does not stand in for the new note journey. Whole U12/U15, read-only capability across other forms, original semantic action count/runtime denominator and the masterplan remain OPEN.

## Frozen source/test manifest

| Path | SHA-256 |
| --- | --- |
| `app/admin/customers/[id]/actions.part-1.ts` | `699a8f9563f45ae48b1f83659a64955130fdee7f36e4e89b2d8fd10a93742c49` |
| `app/admin/customers/[id]/actions.ts` | `38812ad0babf7790dfa98ef9b9431d06c1f51a5c1421bd81e4d6e39d3b5db4f9` |
| `app/admin/customers/[id]/page.part-2.tsx` | `e9ec95294a775dc77b9ceb15c3603ad45b661788f5d99f38b72f303a1936f07a` |
| `components/admin/customers/CustomerInternalNoteForm.tsx` | `a8c5aae82194b5c773584b0100f8bee820b6896b88bb4d82d430538abf980bc7` |
| `__tests__/customer-internal-note-receipt-20261001.test.ts` | `f581bba5a72fc20859a6d638e43997249166af04a3f9e80fef3002fdcb28d7e2` |
| `__tests__/customer-internal-note-unsaved-20261001.test.ts` | `fc0f86b493ea12abe102b2b79c6cd1b5fcc34054ef1e26f82568cd2e9b306855` |

This report is the seventh file; its SHA is sent with the ephemeral exact-byte manifest. Independent peer qualification is pending at this freeze. No eighth-whitelist, generated schema, SQL migration, API publication, hosted write, provider call, physical document or original financial graph change is included.
