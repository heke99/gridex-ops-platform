# Saved portal account role and evidence preservation

This is the next controlled business packet after the read-only `customer-account-sync-continuation-20261001.md` inventory. The original T04/T05/T50 and all 75 acceptance rows remain OPEN. It is outside root's frozen eighth ALT source index and requires root integration/publication. No SQL, grant, Auth configuration, provider, credentials, live account or network exercise is added.

## Confirmed business failures and narrow correction

The initial six-case test invokes the actual exported legacy sync `POST` and `claimPortalCustomerAction`. Four cases failed and two positive controls passed: saved `billing` and `viewer` were both reported as `owner` by the legacy strong-match response; repeating the actual self-claim replaced each restricted saved role plus activation/verification evidence through the existing unconditional UPSERT. New-link owner creation and an ordinary existing-owner sync were positive controls. These are functional role/projection and evidence-preservation failures, not an executed Auth or database privilege exploit.

The correction reads the exact current company/customer/subject/account tuple through `tenantDb`. A legacy strong match returns its saved role only when an actual active saved account exists. Without that relationship it still records the matched identity, but reports `access_granted:false` and omits the optional role. Existing native self-claim relationships are read and preserved without any account UPDATE/UPSERT, new verification or repeated approval event. Only an actual new INSERT receives the old default-owner verification fields. A genuine INSERT `23505` is read back through the same exact current binding: active matching restricted evidence is preserved; missing or inactive/disabled rows are controlled conflicts, never assumed success.

A separate twelve-case run exposed one genuine completed-replay defect: after a saved owner changed to viewer, the old completed response still returned the owner label. The replay correction reads current identity/customer/account/role before returning an access-granted result. A mismatch is a controlled `portal_account_ambiguous` conflict. The completed receipt remains unchanged and is not marked failed. A same-role completed viewer control retains exact business data, unchanged persisted identity/account/completion rows and a fresh request correlation value.

Before freezing, a legitimate website-created shape exposed one further preservation RED: `portal_user_id` matched the subject while `user_id` was NULL and role viewer. The candidate's native-only read ignored it and created a second owner. The real website `ensureCustomerPortalUserLink` explicitly creates this portal-only shape. This fourteen-case run produced 13 PASS / 1 FAIL. Root authorized the exact correction: search both aliases within the same company/customer, while requiring the saved native `user_id` binding for native self-claim. The active portal-only relation now produces controlled `portal_account_ambiguous`/409, with exact zero account/claim/event/cache effects. No new native binding or owner is inferred. The final actual suite passes all fourteen cases.

The initial six, expanded twelve, positive thirteen and alias fourteen runs overlap. They are not added together as unique tests. The final suite contains fourteen distinct cases.

## Distinct final case ledger

| Final behavior | Distinct cases |
| --- | ---: |
| Legacy sync returns saved billing/viewer and preserves account bytes | 2 |
| Existing native self-claim preserves saved billing/viewer and verification bytes | 2 |
| Existing-owner sync control, no account write | 1 |
| Genuine new native link retains owner-creation semantics | 1 |
| Legacy matched identity without saved account has no account access/role | 1 |
| Repeated owner self-claim has no replacement verification/approval event | 1 |
| Portal-only saved viewer subject is held, no second owner or side effects | 1 |
| Current INSERT 23505 readback preserves competing viewer | 1 |
| INSERT 23505 with disabled/missing relation is held, no claims/events/cache | 2 |
| Completed owner receipt cannot label a current viewer owner | 1 |
| Same saved viewer replay keeps business data and current request correlation | 1 |
| **Total distinct final cases** | **14** |

## Actual execution boundaries

Only the outer Supabase persistence adapters and positive outer `getUser` adapter run in memory. The actual integration authorization helper, strict header/body validation, schema-readiness helper, tenantDb, matching, idempotency helper, response projection, self-claim export and Next redirect execute. Framework `revalidatePath` has the existing unit-context hook. Synthetic fixed IDs/contact facts and a memory-only positive client token cannot enroll an account or perform external calls. No `auth.sessions` insertion, JWT attack, native PostgreSQL/RLS/ACL/grant exercise, scanner, transport or real IdP policy is qualified.

The unchanged revocation trigger still owns disabled/inactive database invariants. This packet does not reclassify those established invariants. Existing caller-side disabled checks and controlled identity-collision handling remain. The older test fixtures are aligned only with an actual positive saved owner tuple and saved granted role; every old denial, zero-write and logging-canary assertion remains. The technical diagnostic replay now asserts the fourth exact saved-role query rather than treating its added authoritative read as a regression.

The source2 logging correction remains present: `technicalErrorDiagnostic` emits only `database_code`; raw `portal_sync_error`, message/details/hint serialization is not restored. No public contract change is required: the legacy sync role is already optional and permits the saved account roles.

## Verification ledger

| Receipt | Actual result / scope |
| --- | --- |
| Initial actual six-case suite before correction | Four functional RED, two positive controls PASS; both actual entrypoints, controlled outer memory only. |
| Expanded actual twelve-case suite | Eleven PASS / one completed-role-replay RED, then 12/12 GREEN after the current-role replay check. |
| Thirteenth positive replay control | Initial whole-envelope equality assertion failed solely because correct request correlation is fresh. Corrected to business-data equality, same API version and a fresh request ID; this is a test expectation correction, not a product RED. |
| Thirteen-case current candidate | 13/13 PASS at Vitest runner-local `07:04:57` Europe/Berlin UTC+02, equivalent to `05:04:57Z` by explicit conversion; not an independently captured absolute start. |
| Six related existing files | 60/60 PASS at the same runner-local display; includes header parity, read-only resolver, current revocation, legacy write/contact boundaries and all diagnostic canaries. |
| Scoped TypeScript and ESLint | Exit 0 after the helper used tenantDb and the two approved positive fixtures were updated. Seven source/test/config inputs; no broad app/type acceptance. |
| Service-role tenant ratchet | PASS: 2359 current sites versus 2402 baseline, no baseline update. Whole working-tree count, not exclusively attributed to this patch. |
| New portal-only alias control | Actual 13 PASS / 1 functional RED from fourteen cases at runner-local `07:07:19`, then final 14/14 GREEN at `07:10:19` UTC+02 (`05:10:19Z` by conversion). No real Auth or database exercise. |
| Final regression/type/lint gates | Repeated six existing suites 60/60 PASS at runner-local `07:11:18` UTC+02 (`05:11:18Z` by conversion), scoped TypeScript and ESLint exit 0 after the alias correction. |
| Independent current-byte peer | Billing owner independently read the three production paths and own proof/config and ran final actual 14/14 at runner-local `07:10:32` plus 60/60 related at `07:11:02` UTC+02. No bounded source blocker; no native/Auth/SQL/network exercise. |
| Native / real Auth / browser / network | 0 executed in this packet. |

Commands:

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config scripts/customer-account-role-preservation-20261001.config.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config=/tmp/gridex-source-observer-unit.config.mts __tests__/customer-portal-sync-revocation.test.ts __tests__/customer-portal-sync-header-parity.test.ts __tests__/customer-portal-resolver-read-only.test.ts __tests__/customer-sync-legacy-write-boundary.test.ts __tests__/customer-sync-contact-boundary.test.ts __tests__/portal-sync-technical-diagnostic-20261001.test.ts
NODE_OPTIONS=--max-old-space-size=1536 /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/typescript/bin/tsc --project /tmp/gridex-customer-account-role-preservation-20261001.tsconfig.json
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js app/api/v1/customer-portal/sync/route.ts lib/customer-portal/claim.ts lib/customer-portal/accountLinkPreservation.ts scripts/customer-account-role-preservation-20261001.config.ts scripts/customer-account-role-preservation-20261001.test.ts __tests__/customer-portal-sync-revocation.test.ts __tests__/portal-sync-technical-diagnostic-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node scripts/check-service-role-tenant-ratchet.cjs
```

## Remaining actual transaction boundaries

Legacy sync claims idempotency, reads current revocation/account/customer facts, separately UPSERTs the identity, separately logs and separately completes the response receipt. The saved account remains read-only, but that sequence is not one transaction. Active identity permanent subject/customer binding and later changes between the current account read and completion remain separate internally implementable reconciliation work. This packet does not assert a DB lock, session guarantee or whole atomic enrollment.

Native self-claim performs current outer user/matching reads, then a separate account INSERT/readback. New-link claim evidence and the portal event are still subsequent separate writes. A later claim/event failure can occur after the new account committed; retry preservation avoids replacing its evidence but does not reconstruct an unfinished approval/event chain. A current competing database change between reads is not qualified by these deterministic memory tests. Website account/identity/provisioning transactions, merge/delete account disposition and the other original resolver/import callers are unchanged and still require their own current runtime receipts.

Approved deployed issuer/enrollment/recovery policy is a precise external boundary for real new-account authority. It does not block these local functional role/evidence corrections, later local transactional work or full-history upgrade/restore tests. This packet accepts none of T04/T05/T50 in full.

Skill routing reuses spec-to-code and differential source review, systematic debugging, test-driven development and verification-before-completion for this confirmed functional correction. Independent current-byte code review and actual controlled reruns passed before freeze. Broad security scanners/privilege probes, UI redesign, SQL/performance/provider work and new worktree/publication workflows have no trigger in this root-assigned memory-business scope. Root alone owns the shared memory, generated captures, manifest registration, index and publication; the prior frozen release37, T53/scanner/T40 packages and the read-only account report remain unchanged.

Final freeze metadata and exact eight-file hashes are in `/tmp/gridex-customer-account-role-preservation-frozen-20261001.json`. The previous release37 manifest and the previous dated read-only account report were rechecked byte-exact before this freeze. This manifest qualifies only this local controlled packet; root still owns broad source gates, actual generated schema/native/HTTP qualification and publication.
