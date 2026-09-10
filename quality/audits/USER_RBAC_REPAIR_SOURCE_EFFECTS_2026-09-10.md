# Historical user and RBAC repair source effects — 2026-09-10

Status: **STATIC COMPLETE-SOURCE CHARACTERIZATION; NO SQL ACCEPTANCE OR SELECTION CHANGE.**

## Authority, scope and routing

Task9 consumes verified Task8 at `5389f2b51dac46fd00e858a9cddb27b676f678ca`, tree `b8387fa0fef66019c6d27957f281138e45920390`. OPS34506822456 original16/job102970940188 and legacy17/actual-loop job102970940105 PASS; quality/build102970939833 and Ediel102970940048 PASS. These accepted receipts are reused, not rerun. Foundation93 and its first52 remain immutable in this task. Current accounting remains595=533 FULL_FILE_SELECTED/23 SUBSTITUTED/35 UNCLASSIFIED/4 EXPLICITLY_EXCLUDED; focused341=290/20/27/4;58 total and47 focused unresolved.

The eight filenames below are scope identifiers. They do not authorize a search for a corresponding person, company or provider account. Complete bytes were inspected locally with literal-safe projections, including dynamic SQL. No credentials, personal literals or SQL diagnostics are reproduced. U_boot, U_target, U_old, U_actor and C_target below are symbolic fixture slots, not newly established facts about real identities.

Skill routing: repository memory/AGENTS and executing-plans govern this bounded assigned step; using-superpowers explicitly exempts dispatched workers. Supabase, supabase-postgres-best-practices, code-security and sharp-edges govern identity, RLS, privileges, dynamic SQL and transaction boundaries; verification-before-completion governs static receipts. Existing quality-playbook requirements/evidence principles are reused. acquire-codebase-knowledge's repository-inventory trigger is absent: inventory and Tasks1–8 matrices are expressly not repeated. Broad threat-model, Semgrep/CodeQL/SARIF, supply-chain, performance, UI, refactor, new tests, hooks, deployment and provider workflows are outside this two-document review; no new runtime or dependency code is authored. Secret scanner setup/hook installation is not requested; literal non-disclosure checking here is a document check, not a claim of a repository secret scan. Hosted SQL/TDD and independent spec/quality review activate in the implementation/controller steps. Root alone owns memory and masterplan updates.

## Immutable input pins and actual selection

All paths below are relative to `supabase/migrations/`. Every pin equals its entry in `scripts/migration-history-manifest.json`; there is no overriding conflicting pin in either additions manifest. The actual selector/accounting interface reports **UNCLASSIFIED**, execution=[], derivedArtifacts=[] for each of the eight. None is already completed by a bootstrap excerpt.

| ID | File | Lines | SHA256 | Top-level units |
| --- | --- | ---: | --- | ---: |
| B0 | `20260519_bootstrap_div3rsa_superadmin.sql` |344|`bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0`|3|
| R2 | `20260525_debug_batch_2_rbac_tenant_alignment.sql` |230|`cba0a78a519d84b44585133046c56117bf05674c1834467eb8b78fbc1d79cb7d`|6|
| C2 | `20260525_debug_batch_2c_activate_afshin_nibela.sql` |249|`b92f043727f2e5699a277c7d649dd583b8f04b1bdcd759840a2d0d1e52953659`|2|
| D2 | `20260525_debug_batch_2d_activate_afshin_nibela_v2.sql` |287|`048bf0d47d0ae0e996517b770ac4d4591726a2b8e029a91348c8a031acf37dd7`|4|
| E2 | `20260525_debug_batch_2e_verify_dashboard_user_provisioning.sql` |85|`b1cd650eeb7e923b7fb7c761064e9269fff309d34fe3383d07764149d3abc19f`|2|
| F2 | `20260525_debug_batch_2f_normalize_afshin_nibela.sql` |245|`9fcf47f11a881c01a670f7858af5a297a2a49fb5033fdc256a024c8ae979e35b`|4|
| H2 | `20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql` |96|`98522e209332c44c804d7acccf831f25fb13b75b048fbe3613c8d69fcb373a9b`|7|
| S2 | `20260526_debug_batch_2_tenant_rbac_server_actions.sql` |141|`f99af4186539ade7455e7241275339352a23c8572bda7cfd05aba987bac8c727`|3|

Total:1677 lines and31 complete top-level statement units. Line ranges below use original bytes, including multiline dynamic strings; comments/blank lines are nonexecuting. Child rows describe complete statements/branches inside the named DO/function, not proposed excerpts. Files contain no provider calls or credential generation. B0 creates an extension; no source creates/drops a trigger, issues explicit GRANT/REVOKE, or sends NOTIFY. Existing row/DDL triggers, owner/default ACLs, policy defaults and transaction control remain effects and dependencies.

## B0: complete unit map

| Unit / original lines | Complete effects and conditional branches |
| --- | --- |
| B0.1 /10 | CREATE EXTENSION IF NOT EXISTS pgcrypto. Existing extension is preserved; ownership/schema/version must be independently checked rather than inferred from its name. |
| B0.2 /12–22 | If memberships exists: DROP named role CHECK15–16; ADD CHECK18–20 allowing owner/company_admin/member/viewer. Validates existing rows immediately; admin/operations labels outside this set can fail. This precedes the missing-user guard. |
| B0.3 /24–344 | One DO with children below; it cannot successfully do nothing when U_boot is absent. |
| B0.3a /26–61 | Read auth.users email by fixed UUID38–41; NULL/missing email raises43–45. Require companies47–49, memberships51–53, roles55–57 and user_roles59–61. No actor authorization, company association or account-lifecycle verification. |
| B0.3b /63–95 | Inspect roles.is_system63–69; upsert two role keys with name/description and optional is_system71–88; resolve their IDs90–91 and fail if either missing93–95. ON CONFLICT(key) needs a matching unique arbiter. Existing role metadata is overwritten. |
| B0.3c /97–126 | If permissions exists: upsert23 permissions98–125, overwriting name/description on key conflict. No permission row deletion. |
| B0.3d /128–151 | If role_permissions and permissions exist: link super-admin to **all** permission rows130–133, including custom rows; link company-admin to20 specified keys135–150. ON CONFLICT DO NOTHING does not prove link identity without correct unique keys. These grants can undo first41's permission cleanup. |
| B0.3e /153–189 | Detect user_roles status and is_active independently153–161. Existing U_boot/super-admin rows164–175 have available activity fields enabled by dynamic UPDATE, without company filter. Missing pair176–188 gets a dynamic INSERT with optional activity fields and no company_id. |
| B0.3f /192–205 | Insert missing U_boot/company-admin pair, again unscoped. Existing pair is left unchanged; this differs from super-admin reactivation. All four status/is_active column combinations affect generated SQL. |
| B0.3g /207–256 | Pick earliest-created company matching either fixed slug or normalized organization identifier207–212; equal timestamps are not fully ordered. If absent, insert company with fixed business metadata, U_boot contact and creator214–240; otherwise overwrite name/status and coalesce contact/slug/identifier/industry while extending metadata242–255. The OR predicate can match different companies. |
| B0.3h /258–290 | Upsert membership on(company_id,user_id), setting company-admin role, active status, acceptance time and metadata; conflict branch clears suspended_at. Does not establish a tenant-scoped user_roles grant or revalidate actor rights. |
| B0.3i /292–302 | If profiles exists: ADD active_company_id FK to companies ON DELETE SET NULL293–294 only when column absent; upsert profile296–301, preserving existing email/name with COALESCE but replacing active company. A preexisting column bypasses inline FK creation. |
| B0.3j /304–343 | If audit_logs exists, inspect company_id305–308 and insert a new audit row309–325 or327–341. Actor is U_boot; entity company; alternate branch lacks explicit tenant column. Every repeat can add another audit row. Trigger-generated work is additional, not covered by this explicit insert alone. |

B0's CHECK replacement may survive its later missing-user failure under per-file autocommit. It requires an outer transaction for rollback characterization, or the dedicated unpublished database contract. Zero eligible targets cannot be successful complete-source admission.

## R2: complete unit map

| Unit / original lines | Complete effects and branches |
| --- | --- |
| R2.1 /6–43 | If roles exists, ADD key9, scope with company default10, is_system NOT NULL/default false11. Fill blank keys from normalized nonblank names13–16. Then alias remaps18–21,23–26,28–31,33–36,38–41 for platform-admin/company-admin/customer-service/finance/compliance categories, each only if canonical key absent. Several aliases can concurrently become one key and violate uniqueness; canonical-key absence is not per-row dedupe. |
| R2.2 /47–83 | Unconditionally iterate16 seed tuples52–69. UPDATE every row matching each key71–76: force name, fill NULL description/scope, set is_system=true; if FOUND false, INSERT79–80. Requires roles even when R2.1 skipped. Seeds: super_admin, company_admin, admin, operations_manager, operations_agent, customer_service_manager, customer_service_agent, pricing_manager, pricing_approver, compliance_manager, sales_manager, partner_manager, finance_readonly, executive_readonly, partner_api_user, customer. No assignments or permission links. |
| R2.3 /86–100 | If user_roles and roles exist: joined UPDATE89–95 fills NULL role/status/is_active only for matching role_id. NULL activity becomes active. CREATE INDEX97–98 on(user_id,status,is_active), IF NOT EXISTS by name only. No repair of orphan/null role_id rows. |
| R2.4 /103–153 | Replace platform-admin helper, PL/pgSQL stable DEFINER, search_path public,auth. NULL auth.uid→false113–115. First admin_users branch117–130 accepts active-or-NULL legacy platform labels; second user_roles/roles branch132–147 accepts active-or-NULL rows/labels without company scoping. Each catches missing relation/column; outer WHEN OTHERS150–151 returns false. No Auth/profile/session/company lifecycle gate. |
| R2.5 /156–215 | Replace gridex_get_user_roles(uuid)→text[], PL/pgSQL stable DEFINER/public. NULL input167–169→empty. Aggregate distinct sorted lowercased role labels from active-or-NULL user_roles joined roles171–191, then active-or-NULL admin_users193–211; missing table/column caught per branch. Caller-supplied user ID is not bound to auth.uid or company. Final array213. CREATE OR REPLACE cannot change an existing table-return signature to text[]. |
| R2.6 /218–230 | Create/replace gridex_debug_batch2_rbac_v over all memberships/companies, exposing invited email and resolved roles. Default view behavior is not security_invoker; no TO-role restriction or explicit ACL. Requires membership_role, role, invited_email, status/is_active and text[] helper. |

R2 changes authority even with zero user_roles because its helper and role catalog changes are unconditional. Same-transaction exact existing-role restoration and immediate helper/diagnostic boundary are required; later timestamps alone are not protection at the inserted prefix.

## C2: complete unit map

| Unit / original lines | Complete effects and branches |
| --- | --- |
| C2.1 /4–234 | DO; fixed user/company/email/actor bindings6–9. Every child executes as owner without canonical actor or invitation acceptance RPC. |
| C2.1a /18–39 | Require exact Auth UUID plus case-folded email18–20; require company22–24. Normalize selected company statuses/NULL, update timestamp/metadata26–30. Upsert active profile32–39, replacing email/active company and preserving non-NULL existing name. |
| C2.1b /41–59 | Resolve company-admin role by key/name with only preferred-key ordering41–48; insert if missing50–54. Inspect membership_role column56–59. |
| C2.1c /61–133 | Read actual role column type62–71; test enum labels in priority company_admin73–80,admin81–88,member89–96, otherwise leave initial value. Dynamic UPDATE99–123 matches target company and either UUID or case-folded invited email; rewrites membership identity/roles/actor, enables access, fills acceptance/join times, clears disable/removal/reason and extends metadata. IF NOT FOUND125 guards dynamic INSERT126–132, but EXECUTE does not refresh FOUND: prior type SELECT found a row. A zero-row UPDATE can therefore skip INSERT. |
| C2.1d /134–166 | Without membership_role: equivalent static UPDATE135–155 and conditional INSERT157–164, omitting that column. Static UPDATE does refresh FOUND. |
| C2.1e /168–181 | Update same-user company-admin role rows with company either target or NULL168–176, forcing target company/role/activity. Insert if no match178–180. No removal of additional distinct roles. |
| C2.1f /183–223 | Detect invitation email and invited_email independently183–191. If table/email exist, UPDATE all matching target-company/email invitations193–207: accepted status, target user, roles, accepted_at, clear expiry/revocation, timestamp/metadata. If zero rows and invited_email exists, alternate UPDATE209–222. First successful email branch suppresses the alternate, even when separate alias rows remain. |
| C2.1g /225–233 | If table/email exists and neither update matched, INSERT accepted invitation226–232 with fixed actor/name; no token verification or pending/expiry prerequisite. Missing required invitation defaults/FKs can fail. |
| C2.2 /236–249 | Diagnostic SELECT of target membership/company including email/roles/status/acceptance. Sensitive output must remain private. No transaction control in file. |

The FOUND distinction follows PostgreSQL17's documented EXECUTE status semantics; it is a static branch finding, not a reproduced runtime incident. [PostgreSQL PL/pgSQL statements](https://www.postgresql.org/docs/17/plpgsql-statements.html).

## D2: complete unit map

| Unit / original lines | Complete effects and branches |
| --- | --- |
| D2.1 /4 | BEGIN; do not strip or treat as a nested savepoint. |
| D2.2 /6–239 | DO with bindings8–11 and all children below. |
| D2.2a /28–44 | Require Auth UUID/email28–30. Upsert fixed company32–40, retaining nonblank name and active/onboarding status but converting other states. Globally fill NULL/empty role keys42–44, even for unrelated roles. |
| D2.2b /46–72 | Resolve company-admin or fallback admin role46–53 with incomplete tie ordering. Insert55–58 or fill selected key60–62. Upsert active profile65–72; unlike C2, empty name is replaced too. |
| D2.2c /74–155 | Inspect membership_role74–89 and enum fallback91–115. Dynamic UPDATE117–141 has C2's broad match and resets. GET DIAGNOSTICS143 obtains actual ROW_COUNT; zero invokes INSERT146–152 with row count154. This corrects C2's FOUND mistake. |
| D2.2d /156–191 | Static column-absent UPDATE157–177; capture row count179; zero→INSERT182–188 and count189. |
| D2.2e /193–209 | UPDATE target/NULL-company user-role rows when selected role_id/company-admin text **or role IS NULL**193–201; capture count203; INSERT if zero205–208. A row for a different role_id with NULL text can be overwritten. |
| D2.2f /211–236 | Eight column probes211–218 cover email, invited_email, membership_role, role_key, invited_user_id, accepted_at, updated_at, metadata. Dynamic UPDATE221–234 conditionally includes these setters but **always** writes status and expires_at. membership_role cast uses the membership column's type, not invitation column type. Both aliases present uses OR; email-only works; invited_email-only concatenates false immediately with its predicate230–232, producing invalid SQL. No invitation INSERT fallback. Capture affected count235. |
| D2.2g /238 | NOTICE reports counts but includes a fixed target label in the source format; never expose raw notice. |
| D2.3 /241 | COMMIT occurs before diagnostics and any appended forward assertions. |
| D2.4 /243–287 | UNION ALL Auth, membership and user-role diagnostics with company joins, final check-name ordering. A diagnostic failure cannot undo D2.3. |

## E2: complete unit map

| Unit / original lines | Complete effects and branches |
| --- | --- |
| E2.1 /4–20 | If invitations exists: ADD email7 and invited_email8; UPDATE invited_email from email only when NULL10–13; UPDATE email from invited_email only when NULL15–18. No company filter. Empty strings, conflicting non-NULL aliases and case differences are not reconciled. Both NULL remains NULL. Existing UPDATE triggers may add work even though migration is named verification. |
| E2.2 /22–85 | One CTE/UNION diagnostic: fixed params22–26; Auth matches email27–29; memberships31–42; role assignments44–52; latest invitation54–64 matching COALESCE(invited_email,email), ordered created_at DESC LIMIT1 without tie-break. Four projections66–84 and check-name order85. All relations/columns are required despite conditional DDL. User/role/email/tenant data stay private; zero target matches is a successful empty read. |

## F2: complete unit map

| Unit / original lines | Complete effects and branches |
| --- | --- |
| F2.1 /4 | BEGIN. |
| F2.2 /6–201 | DO with target company/correct-user/old-user/email8–11. |
| F2.2a /17–37 | Require correct Auth UUID/email17–19. If invitations exists, ADD email25/invited_email26 and global bidirectional NULL fill28–36, same effects as E2. |
| F2.2b /39–58 | Upsert fixed company39–44, always overwriting name, retaining active/onboarding status otherwise onboarding. Choose company-admin/fallback admin role46–52 with incomplete tie ordering; insert missing role54–57. |
| F2.2c /60–88 | Resolve membership_role type through memberships::regclass60–65, before later optional-table guard. Type-name heuristic67 branches into enum label check68–75 and ordered fallback label selection76–83; construct quoted/cast role expression85 or uncast literal87. Missing relation/column or unsupported enum needs native characterization; to_regclass later cannot protect the earlier regclass cast. |
| F2.2d /91–113 | If memberships exists, retarget every old-user membership in C_target to U_target92–100, update timestamp/metadata. If invitations exists, retarget invited_user_id similarly104–112. Existing target membership can collide with unique(company,user) before the subsequent upsert. Old identity outside C_target remains. |
| F2.2e /116–165 | Dynamic membership INSERT with company/user/role/role_key/membership_role, active status, invited email/times/metadata; ON CONFLICT(company,user) updates role/activity/acceptance/join and clears removal/disable/reason. **Does not set role_id** in either branch. Quoted UUID/email parameters and catalog-derived type expression are not user inputs but must remain private. |
| F2.2f /168–186 | INSERT target company-admin role with ON CONFLICT DO NOTHING168–170; UPDATE matching target/NULL-company roles172–180, preserving non-NULL role_id through COALESCE; disable all old-user roles in target company183–186. Multiple different roles and inconsistent non-NULL role IDs may remain. |
| F2.2g /189–200 | UPDATE all target-company invitations matching either alias-precedence expression190–199: accepted, correct invited user, fill acceptance, clear expiry, timestamp/metadata. Does not clear revoked_at, validate token/expiry, or call canonical acceptance. |
| F2.3 /203 | COMMIT; subsequent error is not rollback protection. |
| F2.4 /205–245 | UNION ALL Auth, membership, role diagnostics; private target/identity/email/company output and check-name ordering. |

## H2: complete unit map

| Unit / original lines | Complete effects and branches |
| --- | --- |
| H2.1 /5 | BEGIN. |
| H2.2 /8–28 | Rank active-or-NULL user_roles with non-NULL role text by(user_id,COALESCE(company_id,sentinel),lower(role)); newest created_at DESC NULLS LAST then greatest id wins. DELETE all rn>1. No trim; NULL user IDs share a ranking partition; null company and the sentinel UUID collide. Role_id may differ. |
| H2.3 /31–51 | Repeat ranking/deletion on survivors using role_id instead of role text, excluding NULL role_id. First deletion determines which rows second pass sees; this is not two independent keep-max sets or dedupe of only identical full rows. |
| H2.4 /54–62 | Create named unique expression index for active non-NULL role text on(user_id,COALESCE(company_id,sentinel),lower(role)). Default unique-index NULL semantics still allow duplicate NULL user IDs, unlike the window partition. IF NOT EXISTS accepts a wrong preexisting same-name index. |
| H2.5 /65–73 | Corresponding active role_id unique index. Two distinct roles per user/company remain allowed if neither key collides. |
| H2.6 /75 | COMMIT after destructive DML/indexes. |
| H2.7 /78–96 | Fixed-target diagnostic joins Auth/company/role, includes email and count window using raw company_id; its grouping differs from sentinel-normalized deletion/index and it does not prove all-company uniqueness. |

H2 defines no FK cleanup. Orphan rows may participate and DELETE can fire dependent cascades/audit triggers. Distinct PK row IDs, tie timestamps, NULL activity, mixed role text/id, sentinel company and cross-company rows must be tested explicitly. Populated deletion is never an approved cleanup of real data.

## S2: complete unit map

| Unit / original lines | Complete effects and branches |
| --- | --- |
| S2.1 /5–17 | SQL STABLE invoker helper gridex_table_has_company_id(text) checks information_schema.columns for a public table/company_id. No explicit search_path or EXECUTE ACL. Catalog visibility depends on caller. |
| S2.2 /19–74 | For each of17 names22–40: require relation exists and company_id is visible46. Enable RLS47; construct three names49–51; drop exactly those SELECT/INSERT/UPDATE policies53–55; create SELECT57–61 (platform-admin OR read-company), INSERT62–66 (platform-admin OR write-company), UPDATE67–71 (same read USING/write WITH CHECK). No DELETE policy, FORCE RLS, column/type validation or removal of other permissive policies. No TO clause means PUBLIC; default permissive policies OR with existing permissive policies. |
| S2.3 /76–141 | View lists present/company-column targets79–100 with RLS status and absence of the three policy names101–141. It checks names/flag only, not policy predicates, roles, restrictive/permissive state, effective grants or helper security. View has no explicit invoker option/ACL. |

Exact17 target relations: customer_blockers; customer_authorization_documents; customer_documents; customer_contacts; customer_internal_notes; customer_info_requests; customer_info_request_events; authorization_scopes; metering_permissions; power_of_attorney_scopes; customer_lifecycle_events; customer_lifecycle_decisions; customer_cases; grid_owner_data_requests; partner_exports; outbound_dispatch_events; supplier_switch_events. All are under public. Generated policy names are `gridex_debug2_<table>_tenant_select`, `_tenant_insert`, `_tenant_update`. Missing targets legitimately skip DDL; a reduced fixture is not evidence of all actual-prefix targets.

## Prerequisites, later winners and actual consumers

| Object/effect | Source-backed dependency and winner; consequence |
| --- | --- |
| Base identity/tenant tables | `01_db1_schema_repair_core_helpers_and_canonical_tables.sql:339–477` supplies companies, memberships/invitations, roles/user_roles; foundation4/5 supplies profiles/callback; foundation30 `20260519_saas_ui_tenant_admin.sql` and31 governance extend tenant shape; preserve30–33 and RBAC38–41. Same names alone do not establish current constraints. |
| Actor/token/profile boundaries | Reuse exact authorities in `AUTH_PROVISIONING_SOURCE_EFFECTS_2026-09-10.md:238–258`: `20260906081839_canonical_company_invitation_runtime_reconstruction.sql`, `20260907121951_canonical_membership_actor_fk_reconstruction.sql`, selected33 token prerequisite and selected52 Q. Q38–56 reasserts five FKs; new repair must not undo them. No credential or token synthesis is required. |
| First52 platform helper | Actual selected last definition is `20260520_batch_6e_hard_platform_roles_only.sql:5–21` at41. R2 overwrites it with legacy admin_users/NULL-active behavior. Restore exact first52 catalog preimage, not a guessed later runtime body. First41 permission cleanup24–41 is also a separate preserved data invariant. |
| First52 S2 company helpers (T9-R1 resolved) | Selected39 `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql:155–170,190–208` defines `gridex_can_read_company(uuid)` and `gridex_can_write_company(uuid)`; write also calls `gridex_company_is_writable(uuid)`. R2 supplies the platform helper, not these company helpers. Preserve their complete first52 definitions/options/owners/ACLs; never re-run old39/41 effects to supply them. |
| Later platform and tenant helpers | `20260802190000_canonical_emergency_access_lockdown.sql:120–165` replaces platform helper with Auth/profile and unscoped active-role checks. `20260814162500_tenant_rls_lifecycle_hardening.sql:16–114` supplies session/lifecycle-aware company membership/read/write/manage helpers. These remain final-chain obligations, not already present at52. |
| Role lookup function/view return shape | No definition of gridex_get_user_roles or either debug view is present in first52. R2 creates text[] function/view. `20260525_debug_fix_batch_1b_schema_code_alignment.sql:493` is another text[] predecessor; `20260526_debug_step1_2c_full_schema_code_alignment.sql:172–221` wants RETURNS TABLE and a dependent view replacement. Whole historical CREATE OR REPLACE cannot change that return type in place. Its exact future admission must handle function/view dependencies before execution without CASCADE shortcuts; no change to that unresolved source is made here. |
| Role lookup callers | `app/dashboard/page.tsx:53–68`, `lib/tenant/scope.ts:64–84`, `lib/rbac/getUserPermissions.ts:52–80` accept strings or objects and use role classifications for platform routing/permission fallback. `lib/performance/platformDashboardSummary.ts:155` calls platform helper. Do not grant arbitrary-user lookup to clients merely because callers tolerate its result shape. |
| Canonical membership/acceptance | `lib/auth/companyUserAccess.ts:49–110,200–236` checks same-company active membership/role and calls canonical acceptance; `lib/auth/companyInvitationFlow.ts:238–367` creates durable intent and verifies Auth identity/token/expiry before acceptance. `20260802203000_canonical_runtime_consistency_hardening.sql:190–385` defines actor-bound canonical acceptance. C2/D2/F2 do not call it; historical activation does not satisfy it. |
| Provider and durable work | `lib/tenant/provisioningWorker.ts` owns leased delivery; `20260810224500_canonical_review_remediation_v1.sql:563–585` defines pending-invitation INSERT job trigger. `20260802014000_canonical_provisioning_access.sql:368–385` defines company lifecycle acceptance trigger. Reuse accepted trigger maps; inspect actual enabled targets in each future fixture. Sources can trigger these when placed later but they are not assumed at52. |
| Diagnostic security | `20260611190000_launch_linter_hardening_security_definer_rls.sql:119–143` later attempts invoker/revokes over views with caught failures. `20260902092000_view_security_invoker_and_dead_policy_cleanup.sql:24–60` does not remove arbitrary PUBLIC policies. Neither proves final effective security of S2 or R2. |
| Dedupe guards | H2 is the only direct creation source found for its two named active expression indexes. Existing first52 role/triple uniqueness and FK catalog must be compared independently; similar unique names are not equivalent to its sentinel/text/id behavior. No later safe helper restores rows H2 deletes. |

One-time row effects have no automatic later winner. D2 fixes C2's ROW_COUNT logic but does not reverse earlier role/profile/invitation changes. F2's identity retarget and H2's deletion are destructive transformations, not evidence that U_old was erroneous. B0's global grants and R2's alias normalization are not canonical product requirements.

## Decisions and verification boundaries

The executable next contract is `USER_RBAC_REPAIR_ADMISSION_CONTRACT_2026-09-10.md`. It first admits complete R2/E2/S2 plus an immediate new forward boundary; it separately specifies B0/C2/D2/F2 identity characterization and H2 transaction-owning characterization. No source is excluded or relabeled by this mapping.

Static findings: C2 stale FOUND; D2 invited-email-only malformed concatenation; D2/F2/H2 internal COMMIT; B0 missing-user failure after earlier DDL; R2 privilege broadening; H2 lossy two-stage deletion. These are source-backed behaviors, not claims of present production exploitation. Native SQLSTATE/trigger/catalog acceptance remains unexecuted. PostgreSQL documents that --single-transaction does not preserve its intended guarantee when input issues its own BEGIN/COMMIT; never claim outer rollback around those files. [PostgreSQL psql documentation](https://www.postgresql.org/docs/17/app-psql.html).

Checks performed for this document: eight byte hashes/manifest pins and line counts; complete31-unit coverage and nested branch inspection; actual focused selector states; first52 object-definition search; cited caller/winner inspection; document literal review; git diff whitespace. No SQL, CLI creation, schema/types regeneration, hosted proof, production read/write or ledger operation occurred. Native CLI/genesis/full official-ledger replay, complete final-chain effects, runtime/provider/session delivery and production convergence remain open under ADR-006.
