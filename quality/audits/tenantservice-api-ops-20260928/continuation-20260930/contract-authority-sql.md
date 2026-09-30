# F7 contract authority: SQL continuation, 2026-09-30

Status: **bounded PostgreSQL-core regression VERIFIED; full native/restore/runtime qualification BLOCKED locally and prepared for CI**. No whole T/U requirement is accepted. This is additional evidence after `contract-permission-authority.md`; the original frozen UI inventory is unchanged.

The Supabase, systematic-debugging, TDD, variant-analysis/false-positive check and verification workflow apply. The migration was created with installed Supabase CLI2.118.0 `supabase migration new contract_authoritative_platform_and_target_scope`; historical migrations are untouched. No hosted data, production configuration, key rotation, real communication or provider dispatch was used.

## Confirmed boundary and limits

Latest baseline `gridex_contract_actor_has_permission(uuid,text)` in `20260727010000_contract_flow_integrity_completion.sql` treated active `user_roles.role='platform_admin'` as global without checking `company_id`, `roles.scope` or role activity. In a reconstructed legacy assignment, the **actual** `canonical_actor_is_platform_admin` returned false while this helper returned true. Actual `gridex_remove_internal_contract_offer_v2` → `gridex_archive_contract_product` → operation readiness → audit normalization archived company B's draft offer/product and persisted one B audit row. This was executed in PostgreSQL-core before implementing the migration. The current user-role insertion triggers were deliberately absent from that focused legacy fixture: **no claim that the modern insertion flow permits this corrupt tenant-bound assignment**.

A separate representable authority issue does not need that legacy role text: an ordinary actor has A's `contracts.archive` role grant and active viewer membership in B. The any-company `gridex_has_permission` union supplied A's grant to the two-argument contract guard. Actual B archive succeeded, B offer/product changed and B audit persisted; A's offer stayed unchanged. The existing RPC is service-only; **authenticated or anonymous direct exploitation of its ACL is not claimed**. A server/service caller using only the old SQL guard could reach the wrong target authority. The application helper fix remains a separate earlier test boundary.

Current `canonical_actor_is_platform_admin` (`20260802203000_canonical_runtime_consistency_hardening.sql`) itself omits `roles.scope` and role activity. Current `gridex_get_user_permissions_in_company` (`20260924003724_company_direct_permission_scope_repair.sql`) has a NULL-company platform-name role branch lacking `roles.scope`. Reusing either without qualification would reintroduce malformed global assignments. Shared `gridex_has_permission`/permission resolver behavior is intentionally unchanged: its any-active-company union is documented shared-masterdata behavior.

## Forward correction

`supabase/migrations/20260930221813_contract_authoritative_platform_and_target_scope.sql` defines:

| Function | Boundary |
| --- | --- |
| `private.gridex_contract_actor_is_active_v1(uuid)` | Service JWT role or actor equals `auth.uid`; real Auth user not deleted/banned; active canonical profile. |
| `private.gridex_contract_actor_is_global_v1(uuid)` | Active actor plus active legacy `admin_users` global authority, or active NULL-company user-role assignment joined to an active role with `scope='platform'` and canonical global **role-definition** key/name. Tenant input role text does not elevate. |
| Existing `public.gridex_contract_actor_has_permission(uuid,text)` | Strict global shortcut plus historical any-company permission compatibility; no longer a tenant operation guard. |
| Existing `public.gridex_contract_actor_can_operate_company(uuid,uuid)` | Bound active actor, active/unpaused target company, genuine global authority or active exact-company membership. |
| New `public.gridex_contract_actor_has_company_permission(uuid,uuid,text)` | Exact target plus genuine global authority or active positive role/direct grants for that company. NULL-company legacy direct allow survives only with target membership. Deny rows contribute no allow; a separate positive allow remains effective. No malformed NULL-company role fallback. |
| New `public.gridex_assert_contract_company_permission(uuid,uuid,text)` | Explicit 42501 before existing operations' locking/readiness/writes. |

New helpers/guards are revoked from PUBLIC/anon/authenticated; public actor helpers grant execute only to `service_role`. Private helpers have no frontend grant. There is no defaulted overload or public compatibility alias for the new target guard.

The migration patches **21 exact current public function definitions /26 existing assertion callsites** in place. It preserves function signatures/OIDs, owners, SECURITY DEFINER configuration and ACLs, checks exact per-function match counts, aborts on missing/ambiguous functions or remaining old assertion callers, and reloads PostgREST schema. Permission strings and business bodies stay unchanged. In particular, latest July31 channel publication still requires `contracts.publish` and `pricing.publish`; this repair does not silently reinstate an overwritten July28 channel policy.

| Current caller | Assertions |
| --- | ---: |
| `gridex_archive_contract_product` | 1 |
| `gridex_assert_contract_channel_permission` | 1 |
| `gridex_cleanup_unused_contract_drafts` | 1 |
| `gridex_close_contract_product` | 1 |
| `gridex_copy_contract_offer_v1` | 1 |
| `gridex_create_internal_customer_contract_v1` | 1 |
| `gridex_delete_unused_contract` | 1 |
| `gridex_delete_unused_contract_v2` | 1 |
| `gridex_pause_contract_channels` | 1 |
| `gridex_prepare_customer_contract_signature_request_v1` | 1 |
| `gridex_preview_delete_unused_contract_v2` | 1 |
| `gridex_publish_contract_channel` | 2 |
| `gridex_publish_internal_contract_version` | 2 |
| `gridex_remove_internal_contract_offer` | 2 |
| `gridex_remove_internal_contract_offer_v2` | 1 |
| `gridex_restore_archived_contract` | 1 |
| `gridex_set_contract_channel_permission` | 1 |
| `gridex_unpublish_contract_channel` | 1 |
| `gridex_upsert_internal_contract_offer` | 3 |
| `gridex_upsert_internal_contract_offer_v2` | 1 |
| `gridex_finalize_admin_imported_signed_agreement_v1` | 1 (`new.created_by`,`new.company_id`) |

All 20 argument-bearing callers use their explicit `p_actor_user_id,p_company_id`; the single trigger uses the document's actor and company. The legacy two-argument assertion remains compatible but has no remaining public caller body after this patch. Delegating v3/facade paths retain their existing calls into these guarded commands.

## Executed proof

Node22 is `/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node`; PGlite0.3.14 is available through `NODE_PATH=/tmp/ediel-service-check/node_modules`.

`scripts/contract-authority-continuation.postgres.test.cjs` extracts the latest actual function definitions from canonical14-digit migration sources before this forward migration; it reads actual table DDL from `supabase/schema.sql`. It installs actual readiness/archive/audit-trigger SQL. Focused Auth/companies prerequisites implement request claim settings and active fields; this is **not** full Supabase/Auth/RLS schema replay.

| Command / case | Executed result |
| --- | --- |
| `GRIDEX_CONTRACT_AUTHORITY_BASELINE=1 NODE_PATH=… node --test scripts/contract-authority-continuation.postgres.test.cjs` | **Expected RED:3 failed,0 passed,5 candidate-only skipped** at initial8-case run. Baseline legacy-label and A-grant/B-membership traces both record actual B archived offer/product and1 audit. Third RED confirms inactive/wrong-scope global role still elevates. Later ninth candidate-only test is not an additional baseline proof. |
| `NODE_PATH=… node --test scripts/contract-authority-continuation.postgres.test.cjs` | Initial **GREEN8/8**. Added missing-JWT/uid check reproduced **RED8PASS/1FAIL**, SQL NULL instead of false; correction coalesces actor equality and the assertion result to false. Final **GREEN9/9**,0 failures/0 skips. |
| Legacy tenant platform label | Canonical flag false; corrected helper false; actual archive42501; identical compared graph. |
| A archive grant/B viewer membership | Actual B archive42501 and graph unchanged; real B direct allow then actual B archive succeeds, A offer unchanged, correct B/actor audit1, repeat changed=false. |
| Genuine global assignment and legacy `admin_users` | Actual archive remains allowed; role scope/activity and admin-user activity revoke authority. |
| B `contracts.publish` + only A `pricing.publish` | Actual internal publication RPC42501 at B pricing assertion; compared graph unchanged. After B pricing allow, helpers true and actual existing archived-state business refusal returns `contract_version_not_publishable` with no additional graph change. **No full publication success claim.** |
| Ordinary role/direct grants | Role activity and UR status/activity enforced; malformed NULL-company company-scope role's permission grant does not fall through. Legacy NULL direct allow works with membership; positive allow survives separate deny row; revoked membership/inactive direct grant deny. |
| Actor/target | Forged actor under authenticated request claims, banned/deleted Auth actor, inactive profile and inactive target deny before actual archive; compared graph unchanged. |
| Helper frontend ACL | PostgreSQL `SET ROLE anon/authenticated` both deny new helper42501. |
| Missing JWT role/uid | Actor equality is explicitly false when `auth.uid()` is NULL; new assertion also coalesces NULL to false. Actual archive denial and unchanged graph tested. |
| Scripts TypeScript | Actual `tsc -p tsconfig.scripts.json --pretty false --incremental false` PASS. |
| Native TS ESLint / CJS syntax | Actual scoped ESLint0 errors/warnings; `node --check` core test PASS. `.cjs` is intentionally excluded by repository ESLint configuration, so no CJS lint qualification is asserted. |

The compared core graph is all installed rows of offers/products/channels/assignments/product versions/publication versions/publications/public offers/audit. The actual archive has no mocked SQL mutation/result. For catalog patch coverage, the other19 latest real caller definitions are installed unchanged with `check_function_bodies=off` because their full prerequisite row types are not in this focused database. The migration's whole21-function patch/count/OID/ACL checks execute, but **compilation/execution of those19 unexercised bodies is not certified by this test**. Full native replay uses normal body checking and is required.

## Prepared native proof / explicit blocker

New `scripts/contract-authority-continuation-native.config.ts` and `.test.ts` require CI=true, `GRIDEX_NATIVE_STATUS`, RUNNER_TEMP, API `http://127.0.0.1:54321` and PostgreSQL `127.0.0.1:54322`. Real GoTrue creates synthetic confirmed users with process-private generated passwords; no email is sent. Two test-environment companies, ordinary A-writer/B-viewer and reverse B-writer/A-viewer, genuine global role and malformed company-scope global-name role are isolated. Actual canonical draft creation uses the existing native fixture's v5 pricing component shape. No production Ediel route, legal publication, provider ping or external send is seeded.

The native fixture exercises real service RPC denial/graph preservation, actual authenticated/anon ACL denial with forged actor, modern tenant-bound-platform insert guard, missing B pricing permission, NULL direct allow positive union, revoked memberships/grants and inactive Auth/profile/role state, then real B archive/audit/idempotent repeat and preserved global A archive. Snapshot columns enumerate offers/products/assignments/versions/channels/publications/publicationVersions/publicOffers/audit/contractPriceSnapshots for the two companies; this is not an all-database change detector.

Actual local command `node node_modules/vitest/vitest.mjs run --config scripts/contract-authority-continuation-native.config.ts --reporter=dot` **fails closed before tests**, `contract_authority_disposable_ci_required`. `command -v psql` / `command -v docker` find neither. Native executed cases=0. This is an environmental blocker, never a PASS or skipped success. Root must wire the unique config into existing clean replay, run authentic upgrade/restore and regenerate schema/types from that database, inspect native marker on the exact published candidate and resolve failures before SQL/native acceptance. Native receipt marker is `CONTRACT_AUTHORITY_NATIVE_PASS` only after all assertions execute.

Outstanding requirement boundaries remain complete contract publication/readiness, browser controls and U17 download effects, native full-history/ACL/trigger compilation, external integration/adoption and exact-head CI. This package narrows a proven server/service contract authority defect; it does not establish whole OPS semantic action denominator or75-requirement completion.
