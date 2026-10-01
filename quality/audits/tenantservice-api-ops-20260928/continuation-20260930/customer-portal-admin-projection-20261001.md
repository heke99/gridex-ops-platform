# Canonical portal-account and claim admin projection

Observed UTC: 2026-10-01T10:50:57.683857Z. Worktree base: `6c5cca0edc1e58e90e979a45d3efc093ae91ca33`. This is a separate, uncommitted five-path continuation packet; the parent owns integration and publication. Original T04/T05/T50 and U-series whole outcomes remain OPEN.

## Actual defect and bounded result

The three exported readers in `lib/customer-portal/admin.ts` requested columns absent from the canonical schema. The account reader selected `notes`; both claim readers selected `user_email`, `match_method`, flags, snapshots and other legacy debugging fields as physical columns. Canonical accounts have no `notes`. Canonical claims store such evidence in `metadata`, with only their IDs, tenant/customer/user relation, type/status, token/times and metadata as actual columns.

The unique test invokes the three real exported functions. Its only substituted boundary is the outer, read-only Supabase query adapter. The allowed column set is independently parsed from the actual `CREATE TABLE public.customer_portal_accounts` and `customer_portal_claims` statements in the tracked schema. Invalid SELECT columns return a controlled `42703`. This is an actual exported-reader business regression against canonical DDL, not an executed PostgreSQL/native/Auth/RLS failure.

Before production edits all three positive reader cases failed: account `notes` and both claim `user_email` selectors produced `42703`. After the correction the identical initial three cases passed. The expanded final suite passes **20/20** actual reader/server-component cases. These are 20 final cases, including the original three, not 23 unique cases.

| Receipt | Actual result | Qualification |
|---|---|---|
| Initial real readers | 3 FAIL / 3, controlled `42703` | Published source, actual schema-derived column adapter |
| Same three after correction | 3 PASS / 3 | Actual changed readers, same outer adapter |
| Expanded final suite | 20 PASS / 20 | Actual three exports and actual component SSR, outer read-only DB controlled |
| Scoped TypeScript | PASS, exit 0 | Three source paths and the unique test, 1536 MiB limit |
| Four-path ESLint | PASS, exit 0, no lint diagnostics | Targeted source/test paths |
| `git diff --check` | PASS | No whitespace error |
| Genuine DB/Auth/native/browser/HTTP/provider | 0 executed | No such qualification claimed |

Vitest displayed runner-local starts `12:44:48`, `12:46:47` and `12:48:32`. They are not labelled UTC. A separate actual UTC clock observation is recorded above. Initial scoped TypeScript invocation used a temporary config outside the repository and did not resolve Node ambient types; adding the worktree's explicit `node_modules/@types` to that temporary config made the same source compile. This was config setup, not a product type correction.

## Stored evidence and history rules

`adminProjection.ts` maps the existing internal DTO keys from actual canonical columns. The DTO does not gain a public API surface. Nullable native-user/customer columns and absent match evidence are represented truthfully. Existing accounts retain their saved role, email, activation/verification timestamps, identity snapshot and underlying native/portal aliases; this package performs no writes. `is_active` is displayed as active only when both stored `is_active` and canonical `status='active'` agree. A disabled status with the legacy flag still true no longer appears active. No account role, status or evidence is rewritten.

There is no canonical account notes column or established portal-note writer. The retained internal `notes` property is therefore `null`, without borrowing customer notes or arbitrary metadata.

Claim evidence is recognized only when `metadata.schemaVersion` is the number `1` and `metadata.source` is exactly `native_account_completion_reconstructed_v1`. This is coordinated with the separately owned, still unpublished account-completion SQL. The stored keys are `user_email`, `match_method`, `personal_number_last4`, the four snake-case matching booleans, saved site/point IDs, `failure_reason`, `input_snapshot` and `match_snapshot`. Typed string/boolean fields are checked individually. Boolean strings/numbers are not coerced. A four-digit last-four value is required. Snapshot projections retain the declared typed audit fields; arbitrary additional metadata is not spread into the DTO.

Missing, unversioned, different-source, future-version, null, array or malformed evidence remains unknown. Approved/rejected status does not imply any matching flag. Current Auth/account/customer data is not used to replace saved historical facts. No reviewer is inferred from the claimant, and `claimed_at` or the current clock is not substituted for absent historical review facts. The new writer stores `reviewed_at` in metadata but no reviewer; the existing admin DTO/UI has no review-actor field, and this packet invents none. Historical rejected/manual claims written through the older incompatible writer remain a separate source remediation, not repaired by this reader.

The actual `CustomerPortalAccessCard` renders `null` matching flags as `Okänt`, a saved boolean `false` as `Nej`, and a saved `true` as `Ja`. It uses `Okänd användare` only when neither saved email nor native user ID exists. The bounded count now says `Visade verifieringsförsök` rather than claiming a total. Existing account role/evidence rendering, claim status and saved failure rendering are retained.

## Actual caller and query compatibility

`app/admin/customers/[id]/page.part-4.tsx` is unchanged. Its actual root uses `requireAdminPageAccess` with `customers.read`/masterdata-read, canonical platform context, selected-tenant resource checks and a non-null resolved customer company. Portal-access data and the mounted card are specifically gated by `isPlatformAdmin && activeTab === 'portal-access'`. Both by-customer readers receive the resolved exact customer/company and `limit:20`. The component is compiled and rendered with the actual projected rows in the unique suite; no guard or Auth substitute is claimed as a real authority receipt.

Repository call-site search found no live caller of `listRecentCustomerPortalClaims` beyond its export and tests. Its corrected exported behavior is verified locally; no newly mounted global page is claimed or added.

All existing reader signatures/options remain. Exact customer/company `.eq` predicates, optional-company semantics, descending `created_at`, caller limits and default limits **50/20/50** remain. Recent `status='all'` still omits status filtering; an explicit status is preserved. Query errors throw unchanged instead of becoming a normal empty result. A successful empty result remains `[]`. No account/claim/event write, Auth enrollment, alias rebinding, SQL migration, grant, permission or shared workflow is introduced.

## Reproduction

From this worktree:

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node --max-old-space-size=1536 node_modules/vitest/vitest.mjs run __tests__/customer-portal-admin-projection-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js lib/customer-portal/admin.ts lib/customer-portal/adminProjection.ts components/admin/customers/CustomerPortalAccessCard.tsx __tests__/customer-portal-admin-projection-20261001.test.ts
git diff --check
```

Scoped tsc used an external config extending this worktree's `tsconfig.json`, explicit worktree `node_modules/@types`, `incremental:false`, `noEmit:true`, and exactly `next-env.d.ts`, the three source paths and this test. It was run with Node22 `--max-old-space-size=1536`; no broad app/native gate was substituted by that receipt.

The workflow followed the project TDD, systematic debugging, spec-to-code, review and verification instructions. Installed Next server/client documentation was read; the existing card remains a server component and uses no new framework/auth API. Parent-owned native/security/integration work stays separate. No new agent threads or credential/network/provider exercise occurred.

## Review-ready bytes and untouched source witnesses

These are observed bytes, not an integration freeze or a publication receipt. The report does not hash itself.

| Path | Bytes | SHA-256 |
|---|---:|---|
| `lib/customer-portal/admin.ts` | 2385 | `b638fedbedadf7f39b537fe69d1fca07d194f169afbe73340e4a6e026754fafd` |
| `lib/customer-portal/adminProjection.ts` | 4816 | `42c254f7c03072febe757a5b88deecb4170b7b9069cc98479f91b1e92a21f5fa` |
| `components/admin/customers/CustomerPortalAccessCard.tsx` | 6711 | `100cff454a3af4f03499f65fd4146cfe10d23b576031e4826b3edf650cea545e` |
| `__tests__/customer-portal-admin-projection-20261001.test.ts` | 14511 | `f5bf1bb9a125693793dba1eae68a3d5c1dbe18a59908cd2376445078627df049` |
| Unchanged `supabase/schema.sql` | 6058507 | `ac510feadf9cd4b7cc5009e92f92b54c5ea5209732c426a83558859b8cdfd39a` |
| Unchanged `app/admin/customers/[id]/page.part-4.tsx` | 68227 | `95ad737a0e12d5e193d43bf21419c9f5f443fb2af7609e0a2454b9e0d354cc6c` |

The original whole account lifecycle, historical partial-write repair, rejected/manual writer compatibility, all-page OPS acceptance and current Auth/native browser proof remain separate OPEN outcomes. This packet removes one internally implementable canonical admin-reader/display defect; it does not close whole T04/T05/T50 or any whole U requirement.

## Independent bounded review

The separate site-continuation reviewer verified all five initial review-ready SHA/size/Git-blob rows before and after the review, plus unchanged schema/page witnesses. The reviewer personally ran the approved default Vitest suite: **20/20 PASS**, exit 0, 617 ms. Runner-local start was `12:55:29 Europe/Berlin (UTC+02)`, corresponding to `10:55:29Z`; the independent hash postcheck observed `2026-10-01T10:56:38.777483Z`.

The reviewer read the real platform-only mounted caller, tenant/customer/20-row predicates, unchanged error behavior, canonical column declarations, typed version/source metadata mapping and unknown/disabled display. The independently read current account-completion SQL metadata block aligns with this projection, without inventing reviewer/history facts. No new bounded source blocker was found. The reviewer performed no SQL/Auth/native/provider/browser/network exercise or edits. Initial three REDs remain the author's historical receipt; the independent acceptance is the current 20 cases, not 23 or a native result.

This report-only appendix supersedes the initial report SHA-256 `b185899fdb00e13017581d9032b9e3d7dfcbdda1aa627241a90f62adecc5a673`. The four code/test hashes above remain unchanged. This is still a review-ready packet; only the parent may declare integration freeze or publish.
