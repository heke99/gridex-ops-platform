# T53 support-case pagination continuation — 2026-10-01

## Exact requirement and disposition

Original T53: **“Supportärenden kan pagineras fram även bland många andra ärenden.”** The master separately requires inspecting whether support filtering happens after an already limited result. Its P5/P8 requirement and all original IDs/text/status records are preserved. This package is a bounded functional continuation; **whole T53 remains OPEN/PARTIAL**. No final native, mounted Next HTTP, browser, Auth, current-authority, RLS, privilege, provider or production qualification is inferred.

Root owns integration/publication. This worker owns only the two authorized production paths below and the uniquely named proof/config/report. Frozen scanner25, T36 Next-denial6, Ediel fairness11, customer-read DTO/public contracts, original requirements, migration history, generated artifacts and workflows are outside this edit scope. No forward migration is required for this read/render correction.

## Source truth and confirmed functional defect

| Surface | Actual reachable source | Bounded outcome |
|---|---|---|
| OPS list | `app/admin/customer-cases/page.tsx` → `listTenantSupportCases` → `listCustomerCases` | Existing support predicate and query/status filters are applied before the database range. Created-at then UUID tie ordering is stable. The controlled actual export reaches all179 support rows among351 newer ordinary rows. Actual page/guard/browser and database filter semantics remain separately pending. |
| Customer API | `app/api/v1/customer/cases/route.ts` → `readCustomerSupportPage` → `gridex_support_case_read_v1` | Existing canonical keyset read and actual opaque cursor encoder reach all179 records, without duplicates or skipped equal-timestamp rows, through controlled outer RPC data. No SQL function/authority execution is claimed by that stub. |
| Portal case list | `app/portal/arenden/page.tsx` | **Confirmed RED:** the actual exported async Page renders100 saved publication cards on its first canonical25-row business page. Each cursor page independently refetches the same first100 publications; support-page rows are only used to remove/append cards, so cardinality and ordering follow a different list. |
| Portal summary | `app/portal/status/page.tsx` → unchanged `listPortalCases` | **Separate internal debt:** the overview still obtains at most100 publications before deriving open counts. This package does not silently accept that ceiling or classify it as external. |

The reproduction contains530 synthetic functional records:351 newer ordinary cases and179 support cases, including137 published summaries and42 customer-origin cases without a summary. Support membership uses both existing supported indicators, and three-row timestamp ties force the UUID order to matter. All data belongs to one fixed functional company/customer. No foreign-owner, blocked-role, credential, Auth, security denial, network or provider scenarios are exercised.

Initial authoritative run after correcting an irrelevant outer-fetch retry timeout: **4 controls PASS / 1 functional RED**. The portal failure is the actual `100 <= 25` assertion, not an import/module/source-pattern failure. The earlier5-second timeout came from the real Supabase client's retry of the controlled503 response; the fixture now returns the actual nonretrying missing-table-style404 with `PGRST205`, while the actual API maps schema unavailability to503. That fixture correction does not change production behavior.

## Narrow resulting behavior

`PortalCasesPage` uses the actual guarded canonical25-row support page as its sole list denominator. The selected conversation keeps its separate guarded reference read. The new server-only `readPortalCasePublicationsPage` decorates only the exact server-returned page references, plus the selected conversation reference when off-page.

The helper resolves those references through company/customer-scoped support threads, checks the canonical opaque reference against the stored UUID, and selects current immutable publications by the same company/customer/case tuple with `revoked_at IS NULL`. The existing thread composite FK binds that tuple to the canonical case. Queries are bounded to the selected references (25, or26 with an off-page conversation; maximum101 for its internal caller contract). An unpublished customer-origin case needs no summary. Missing/malformed canonical thread data or an unavailable database is an explicit error, rather than a normal empty result. The helper confers no new access authority: its references originate in the existing guarded server read, and the existing page context/session/customer selection and write-account checks remain.

Cards are rendered once in canonical server order, with their current published summary where one exists and the existing customer-origin row otherwise. Next/latest links and selected customer remain. An independently opened off-page conversation has its exact current summary without adding that conversation to the25-row list.

## Verification receipts and exact limits

Activated routing: spec-to-code compliance for original T53 mapping; acquire-codebase knowledge, systematic debugging/FP refutation and TDD for the actual Page failure; Supabase source/query guidance for the existing tenant-bound read builder; installed Next page/data-fetching documentation and React guidance for server rendering; verification-before-completion and peer review. Full security/credential/provider/privilege exercises and whole-project scans are outside this specifically assigned functional scope. Shared memory remains root-owned; this report is the worker checkpoint.

Runtime command:

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config scripts/support-case-pagination-20261001.config.ts
```

The actual Supabase JS client builds requests; its fetch transport is fully intercepted, with no network. The actual OPS list export, API GET, opaque cursor implementation, canonical read adapter, publication helper and async portal Page run. Only outer functional context/current session, unused form actions, API response wrapper and database replies are controlled. JSX returned by the actual Page is traversed; it is not a mounted Next/browser rendering receipt.

Current controlled runtime cases:

1. OPS support-before-range, exact179 support rows among351 newer ordinary rows; stable created-at/UUID order.
2. OPS search plus status combined with support selection, complete continuation, no-match empty and explicit database unavailability.
3. API actual GET/opaque keyset, all179 unique references including timestamp ties and exact terminal empty page.
4. API explicit schema/list unavailability503 rather than false empty200.
5. Actual portal Page25-row pages and exact complete179-card continuation with no repeated publication cards.
6. Mixed published/unpublished canonical order; next/latest/customer links; exact selected current-publication tuple and query bounds.
7. Independently selected off-page conversation retains its exact summary, while the list remains its canonical page.
8. Customer-origin cases with zero publications render; private-only nonvisible input yields exact empty state with no publication fetch.
9. Publication database unavailability rejects, rather than hiding as a normal empty/unpublished page.
10. API limits1 and100, newer insert excluded from existing continuation and visible on refresh, older insert reachable in continuation, no duplicate baseline records. These are controlled successive reads, **not native concurrent transactions**.

Initial5-case GREEN was5/5; expanded9-case GREEN was9/9. Final fresh controlled run: **10/10 PASS**, Node22/Vitest4.1.9, exit0 (2026-10-01 03:10 UTC; Vitest printed05:10 runner-local). Final scoped1536MiB TypeScript check covers the actual page/helper and proof/config plus their imported dependency graph; exit0. Four-file ESLint: exit0/0 errors. Owned-path whitespace check: exit0.

Independent `site_continuation` read-only source review found no remaining bounded blocker: canonical page denominator/order, exact thread/composite case/current publication selection, selected off-page summary, explicit errors and customer-preserving links. The reviewer executed no Auth/security/database/browser tests and did not qualify the10 runtime cases; those are this worker’s actual receipt. The final typed empty-map annotation and added limit/insert case introduce no message DTO assumption.

Clock metadata correction only: root independently observed the inherited runner timezone `Europe/Berlin` (+02:00) using UTC wall-clock output. The original report incorrectly labelled Vitest05:10 as UTC; its correct qualification is03:10 UTC/05:10 runner-local. This correction is not a rerun and changes no test/source/SQL bytes or counts. The original report SHA256 `a75f940fca9dfebb49e146504fb568e7c9d5880c588c3f8f13479e6ffef9265d` is retained as superseded clock metadata.

Freeze manifest is generated only after these receipts and the report are fixed; its exact path/hash is delivered to root separately. The report contains no self-referential final hash.

## Remaining internally executable work and genuine boundaries

- Run the exact candidate's actual PostgreSQL read/filter/ordering behavior, existing-current-owner route, mounted Next/portal/OPS browser and complete page continuation. Prepared source/proof is not a native or browser PASS. Existing historical201-case native/OPS receipts in the original requirement register keep their original head/scope; this report does not replay or broaden them.
- Prove actual PostgREST combinations of the two OR filters, concurrent database inserts/deletes, and any relevant saved-source publication change while paginating. Controlled outer matching establishes caller behavior only.
- Repair/verify the separate portal status overview's fixed100-derived open count, and inventory remaining support consumers without conflating summaries/counts with this list.
- A total business count is not introduced by this package. The existing API page envelope reports exact returned/has-more/next-cursor; complete controlled continuation establishes179 distinct business cases for the fixture, not a database count endpoint or whole-dataset native qualification.
- T34 per-message saved staff attribution is a separate sibling package. Its additive DTO/display must be integrated separately by the page owner after root coordination; no reader identity is substituted for a historical unknown author.

No external provider is necessary to fix or verify functional support pagination. Pending local/native/browser/other-consumer work is an internal gap, not an external blocker. Real authentication/tenant/current authority and provider boundaries keep their separate original requirements and evidence status.
