# Billing revision views continuation — 2026-10-01

Status: bounded production view correction verified locally. The genuine local database/browser continuation is prepared but **not executed in this workspace**. This is a separate packet from the frozen six-file saved-recipient command/browser packet; none of those six bytes are changed. Original requirement meanings and denominators remain unchanged.

## Exact nine-file packet

1. `app/admin/billing/invoices/[id]/page.tsx` — root explicitly released this previously frozen path for the narrow historical-recipient/revision view and current read authority correction.
2. `app/admin/customers/page.part-2.tsx` — current revision display and selected tenant/company agreement before service reads.
3. `lib/customers/getCustomers.ts` — selects the existing revision column and preserves strict unavailable/zero semantics.
4. `__tests__/billing-revision-views-continuation-20261001.test.ts`.
5. `__tests__/customer-billing-revision-list-loader-20261001.test.ts`.
6. `scripts/billing-revision-views-continuation-20261001-native.config.ts`.
7. `scripts/billing-revision-views-continuation-20261001-native.test.ts`.
8. `e2e/browser/billing-revision-views-runtime-local.spec.mjs`.
9. This report.

No migration, generated contract/type, shared UI component, workflow, checksum, memory or Git ref is changed. Root owns integration, broad gates and publication. The native continuation creates only synthetic rows in a disposable local complete-schema replay and calls no provider.

## Actual defects and bounded correction

The actual invoice detail page omitted the immutable invoice recipient, invoice address and the profile/contract override revisions. The customer list's actual data loader omitted the existing `billing_profile_revision`, and its page had no revision display. Requiring these actual exported page/loader outcomes reproduced **23 RED and 2 PASS** before production changes. Existing platform selected-company invoice and global customer-list reads were the passing controls.

The invoice page now displays only `customer_invoices.invoice_address_snapshot`: original recipient, email, channel, postal address, country, reference, profile revision and contract override revision. Current customer/contract revisions or current contact details never fill historical gaps. Valid integer zero is retained; null, missing, fractional, negative, string and unsafe numeric values display missing evidence. An older projected invoice with missing revision reports missing evidence, while an invoice awaiting projection reports that specific state. This reads existing history and performs no backfill or rewrite.

The invoice page also requires fresh Auth equal to its permission guard actor and rejects a nonplatform selected company differing from the guard company before the canonical invoice detail loader. Explicit platform selected-company access remains intact. The customer list rejects disagreement among the nonplatform guard company, tenant read scope and operational company before customer/service reads. Existing platform global reads remain intact.

The real customer loader selects `billing_profile_revision` in both search and paged branches with the existing exact company predicate. It normalizes unavailable/invalid revision to null without inventing revision zero. The existing customer identifier cell displays the actual current saved revision without an extra table column.

Six additional pending/invalid/zero invoice cases were added after the original RED. Final new suites are **31/31 PASS**: 22 actual exported page cases and nine actual loader cases. Including existing redelivery UI and billing UI parity tests gives **46/46 PASS across four files**. The loader mock projects only the exact selected fields, so omission of the revision genuinely fails; page tests execute the exported pages rather than a copied view helper. Outer Auth/tenant/database boundaries remain mocked in these local unit receipts.

## Prepared actual native preparation and later current revision

This continuation reuses the completed synthetic billing recipient browser fixture. Its required preceding order is the prior packet's `browser-seed`, real Chromium billing-card journey, and successful `browser-postcheck`. The new native phase first verifies the original issued invoice/item/underlay/pricing/line/document-reference graph still equals that earlier baseline and that the saved customer default is revision 3. It invokes the **actual** `prepareInvoiceDraftsForReview` readiness/lock/preparation pipeline for the two existing billable contracts; no approval/export/provider is called and no provider client is mocked in this packet.

The inherited contract's saved address uses `ui-default-later@example.invalid`, profile revision 3 and override revision 2. The explicit agency contract uses `ui-agency@example.invalid`, profile revision 3 and override revision 1. Both original saved recipients are `UI Later Saved Recipient`, with country NO. The real invoice detail loader confirms these exact values, draft status and null provider GUID; the real customer list loader initially confirms current revision 3.

The native phase captures both full prepared financial graphs, then invokes the actual canonical default command with current revision 3 to save a later current recipient/email/country and revision **4**. Both prepared graphs and the original issued graph must remain equal to their baselines. Contact email, phone and contact revision must remain unchanged. The actual customer list loader now confirms revision 4. A mode-0600 fixture under `RUNNER_TEMP` records these genuine results for browser navigation. `server-only` is the only loader shim; readiness, pricing consumption, canonical command, authorization, snapshots and actual Data API reads run unchanged.

## Prepared real Chromium read journey and independent postcheck

One serial, nonretrying Chromium case logs in separately as the genuine current writer and current read-only actor from the prior fixture. It opens the actual customer list and requires revision **4** in the exact customer row, then the actual billing card and current default revision 4/email. The reader must have no edit form. It opens both real prepared invoice detail pages and requires the original recipient/email, saved profile revision **3**, override revisions **1 and 2**, country NO and no false missing-evidence warning. Reload must preserve the saved invoice email. This deliberate live-4 versus invoice-3 comparison prevents an accidental current-profile substitution from passing. Screenshots capture the actual list row and saved invoice section for each actor.

External browser requests are blocked; the requested browser gate fails closed unless CI, exact loopback API, fixture/password and default local app are supplied. Browser discovery/static markup is not promoted to a real browser receipt.

The independent post-browser native phase compares every prepared invoice/item/underlay/pricing/line/document-reference row, the original issued graph and the entire current customer row with the pre-browser baselines. The actual list loader must still return revision 4. The view journey must make no write and no provider call. This is a graph/reference proof; it does not claim downloaded physical PDF bytes.

Independent OPS read-only review found no concrete source/native/browser proof defect in this bounded packet and independently executed the new actual page/loader suites: **31/31 PASS**. The reviewer did not execute native/browser or infer runtime qualification.

## Validation receipt and exact continuation commands

- Actual new page/loader suites: **31/31 PASS**; with two existing relevant suites: **46/46 PASS**.
- Scoped ESLint of the eight code paths: **PASS, zero findings**.
- Focused TypeScript check of the two new tests and native config/test: **PASS**.
- Browser syntax and discovery: **PASS, one Chromium test discovered**.
- Native config missing the required local status: **rejects before collection**, expected exit 1, `billing_revision_views_disposable_replay_required`.
- `git diff --check`: **PASS**.
- Native preparation/later save, real Chromium navigation and native postcheck: **NOT EXECUTED HERE**; no disposable native Docker/PostgreSQL stack is available. Root must execute them against the final candidate.

After the previous billing recipient packet's successful browser postcheck, complete disposable migration replay, local public/service env and running local application:

```sh
CI=true GRIDEX_NATIVE_STATUS="$RUNNER_TEMP/e035-native-status.json" node node_modules/vitest/vitest.mjs run --config scripts/billing-revision-views-continuation-20261001-native.config.ts
CI=true GRIDEX_BILLING_REVISION_VIEWS_LOCAL_E2E=1 node node_modules/@playwright/test/cli.js test e2e/browser/billing-revision-views-runtime-local.spec.mjs --project=chromium
CI=true GRIDEX_NATIVE_STATUS="$RUNNER_TEMP/e035-native-status.json" GRIDEX_BILLING_REVISION_VIEWS_POSTCHECK=1 node node_modules/vitest/vitest.mjs run --config scripts/billing-revision-views-continuation-20261001-native.config.ts
```

All three commands require `RUNNER_TEMP`, the prior `GRIDEX_BILLING_RECIPIENT_FIXTURE_PATH`, `GRIDEX_BILLING_REVISION_VIEWS_FIXTURE_PATH="$RUNNER_TEMP/billing-revision-views-fixture.json"`, the same generated synthetic `GRIDEX_BILLING_RECIPIENT_PASSWORD`, and exact local public/service configuration. Run the prior billing recipient postcheck **before** this new phase; this new phase intentionally advances revision 3 to 4. Do not rerun the old revision-3 postcheck after that advancement and misclassify its expected mismatch as a source failure. No existing provider/issuer secret is needed.

## Original requirement boundaries

| ID | Bounded receipt/continuation | Exact remaining qualification |
| --- | --- | --- |
| T44 | Actual list current revision and invoice immutable recipient/address/profile/override revisions; fresh guarded tenant reads; prepared real save → list/card/invoice read after navigation | Final native/browser receipts and other original saved-data surfaces. This packet does not certify whole T44. |
| T14/T15 | Prepared actual default/inheritance/explicit override through real readiness/lock/preparation; no current substitution after later canonical default save | Final complete-schema native execution; prior packet's approval/both sender proof remains separate. |
| T16 | Prepared complete original issued and newly prepared financial/document-reference graph equality across later profile edit and browser reads | Native execution and physical remote PDF bytes. No history migration is added. |
| U04/U18 | Actual safe authority denial/missing/pending states; prepared writer/read-only actual views after saved-data reload | Actual browser execution and remaining OPS/portal controls; no whole denominator claim. |
| U20 | One prepared genuine list/card/invoice read journey with scoped screenshots and independent DB postcheck | Actual execution/artifact review and all remaining original UI journeys. |

External provider receipt/delivery and physical provider document bytes remain precise separate boundaries. These implementable local current-versus-historical view checks remain pending execution and are not blanket-blocked by those integrations.
