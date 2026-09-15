# PR310 removed-policy dispositions — 2026-09-15

Status: **all 59 source dispositions complete; runtime and whole-schema acceptance remain pending.** Every record has `schemaAcceptance: false`. The companion JSON is a review register, not an acceptance allowlist or replacement for the exact full-schema gate. No historical source, reference, database, runtime file, or shared memory was changed for this audit.

This supersedes the unresolved *removed-policy* classifications in `PR310_SCHEMA_POLICY_DISPOSITIONS_2026-09-15.md` at the artifact boundary below. It does not expand that report into an acceptance of every added or changed policy.

## Artifact and verification boundary

Archive `pr310-schema-9f1ba7ae.zip`, SHA256 `0ee862d06ee0e4f33208aa33ceefe8ce5afa8c5e8ca1c9cd186f006c7364f2af`; member `full-schema-reference-diff.json`, SHA256 `aaee3685f99130f0d451ba6fe4829134873882ecf0053a38505a4b1005bf9772`. Artifact 10399581944, run 34975955635, job 104403606680. This boundary executed 144 foundation, 514 timestamp and 4 forward inputs in the owned portable replay. It reports `schemaAccepted: false`. Later forward/runtime work needs an exact rebind and its own receipts.

Immutable reference `supabase/schema.sql`, SHA256 `b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30`. Policy-section reference hash `68c77068684a9bb1d97bbc00642b0b2742637d3be97cebbc92dd4b830df28049`; replay hash `81730fbfb3d76f2fa8965b745f2dfdc4d90c7a8bda7460adf64face5fed11e4a`.

Offline verification performed for this report:

- All 59 removed identities and hashes equal the artifact exactly; all 59 complete reference policy rows independently rehash to those observations.
- All 59 authenticated replacement identities/hashes are bound to artifact additions. **57 complete rows** independently match: 20 SELECT, 18 INSERT, 18 UPDATE and one DELETE. The remaining two are company-invitation INSERT/UPDATE: artifact hashes only, with no expression-equivalence claim.
- All 24 removed direct anonymous ACL rows (eight on each of three tables) independently rehash to the artifact.
- Every source pin is computed from the actual file bytes. Complete reconstruction rows, source statements, declaration lines and hashes are embedded in the JSON; the two scratch reconstruction inputs are not required to reproduce verification.

No local native database or business DML fixture was executed in this task. The separate 52-changed-policy/2496-case qualifier does not cover these removed-policy replacements merely because they use the same helpers.

Skill routing: repository code-review, differential source-contract review, false-positive checking and verification-before-completion apply; Supabase review distinguishes effective grants from RLS and definer authority. Broad UI/performance/dependency scans, schema implementation, hook installation, deployment and whole-application audit work are outside this bounded register task. The parent owns shared memory and runtime changes.

## Decisions

| Removed-policy partition | Count | Decision |
| --- | ---: | --- |
| Legacy tenant SELECT | 18 | Preserve the exact authenticated read predicate under the retained lifecycle guard; all-role equivalence is separate. |
| Legacy tenant INSERT/UPDATE, excluding invitations and send locks | 32 | Preserve source-authored tenant writes subject to actual restrictive-guard, actor and ACL qualification. |
| company_invitations INSERT/UPDATE | 2 | Preserve removal under the explicit canonical-only direct-DML ACL boundary; replacement expressions remain hash-only. |
| ediel_send_locks INSERT/UPDATE | 2 | Existing direct-write defect; forward capability remediation required before acceptance. |
| user_roles self SELECT | 1 | Preserve explicitly authored tenant read widening; keep canonical-only role management. |
| customer_info_request_events PUBLIC ALL | 1 | Preserve tenant SELECT/INSERT/UPDATE; authenticated DELETE remains service-predicate-only. This one removed identity maps to four authenticated replacements. |
| Restrictive anonymous ALL guards | 3 | Preserve intentional cleanup if effective anonymous access is closed. |
| **Total** | **59** | **No record grants schema acceptance.** |

For terminology below, A is the retained platform-admin helper, R is `gridex_can_read_company(company_id)`, W is `gridex_can_write_company(company_id)`, and S is the service-claim predicate. G is the final restrictive authenticated SELECT expression: allowed session AND (platform authority OR company in readable membership IDs). These labels describe retained helpers, not a substituted implementation.

### Eighteen reads and 32 ordinary tenant writes

The DB1 foundation `03_db1_backfill_functions_rls_reports_and_finish.sql:670–735` explicitly authors PUBLIC tenant policies; the named table-list source is repeated in `20260522_db1_schema_repair_backfill_foundation.sql:2798–2848`. Metering permission policies explicitly target authenticated in `20260530110000_gridcore_ediel_multitenant_foundation.sql:633–681`. Ediel send-lock tenant policies originate in `20260602093200_ediel_operations_rls_completion.sql:7–66`.

The compiler `20260612143000_performance_policy_consolidation_and_index_cleanup.sql:93–287` expands PUBLIC into a finite role inventory, OR-combines applicable permissive predicates independently per command and drops old names. Generated names encode table/command/role, not expression content. This report proves replacement expressions through complete row hashes, not generated names.

For each of the 18 ordinary read replacements, removed P is `A OR (company_id IS NOT NULL AND R)`. G implies P for the qualified authenticated role, so `G AND P = G AND TRUE = G`. The TRUE substitution source is `20260826093000_platform_dashboard_and_rls_read_performance.sql:205–339`. Its substring-selection heuristic alone is not the equivalence proof.

The 32 ordinary INSERT/UPDATE removals retain explicit tenant-write intent. Complete replacement unions are in JSON and include repeated A/W/R/S terms from source composition. Under retained restrictive INSERT/UPDATE guards, INSERT check and both UPDATE old/new checks must reduce to W for the relevant authenticated actor. Check old-row USING and new-row WITH CHECK independently, including cross-company moves; a same-row conjunction alone can hide a wrongly widened component. This is policy authorization reasoning, not approval of every audit/trigger/business mutation on these tables.

The required read actors include member, operations and company-admin; reads intentionally include paused companies. Writes require the retained owner/admin/company_admin/operations or platform branch and an active/onboarding company. Ordinary NULL-company, wrong-company, inactive-member and disallowed-session cases deny. W also denies platform writes to paused/hidden or NULL-company rows. The exact helper and additional-policy composition remain runtime conditions, rather than assumptions about a UI-selected tenant.

### Deliberate widenings and canonical invitation writes

`user_roles` changes from reference self-only read to lifecycle-scoped tenant read. `20260521_batch_2b_full_automation_and_live_ops.sql:7–83` explicitly includes tenant reads for this table. The later self-read policy (`20260611190000_launch_linter_hardening_security_definer_rls.sql:43–51`) is permissive and cannot restrict another permissive tenant branch. Preserve tenant reads, including same-company non-self rows, while retaining the actor-bound platform checks and direct authenticated role-management DML revocation. Reading a platform role row does not confer that role.

`customer_info_request_events_service_role_all` actually targets PUBLIC and tests S. The exact reference row is embedded; its name is not treated as a TO-service_role declaration. May21 batch2b and `20260526_debug_batch_2_tenant_rbac_server_actions.sql:19–73` explicitly author tenant SELECT/INSERT/UPDATE. Accept their source intent rather than treating the narrower retained reference as the sole authorization contract. The four authenticated replacements are TRUE SELECT, tenant/service INSERT and UPDATE unions, and exact S DELETE. Ordinary authenticated and authenticated-platform actors therefore remain denied DELETE; service behavior requires its actual role/bypass and ACL qualification. Raw tenant table reads cover same-company event types/payloads beyond the narrower service-backed UI DTO, which must be represented in actor acceptance.

`company_invitations` is different: `20260814162500_tenant_rls_lifecycle_hardening.sql:201–207` expressly revokes direct authenticated INSERT/UPDATE/DELETE, including platform JWTs, so lifecycle/audit/versioning/side effects go through canonical commands. The two replacement hashes are retained without asserting their full expressions. Their inertness requires effective denial including column, PUBLIC, inherited and owner authority, plus retained authorized definer/service RPC behavior and SELECT. Do not restore direct grants or old names to make this policy comparison look equal.

### Three anonymous guard removals are intentional

Tables: `auth_email_events`, `company_customer_number_sequences`, `inbound_processing_jobs`.

The source chain is explicit: June11 linter hardening revokes ALL from PUBLIC/anon on public tables (`20260611190000_launch_linter_hardening_security_definer_rls.sql:290–298`); August14 lifecycle hardening creates restrictive `tenant_lifecycle_anon_deny_guard` policies on UUID-company tables (`20260814162500_tenant_rls_lifecycle_hardening.sql:129–180`); September2 F-14 second sweep drops policies whose named roles have no effective table SELECT/INSERT/UPDATE/DELETE privileges (`20260902094000_platform_table_classification_and_invariant_gate.sql:173–203`). The sweep includes restrictive anon policies. Neither the permissive-only compiler nor the earlier dead-role-name cleanup is the cause.

All eight direct anon ACL removals per table are hash verified: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN. This establishes the direct catalog delta, not absence of every inherited or column privilege. Preserve source-authored removal under an actual closed anonymous role/ACL boundary, including relevant non-bypass roles inheriting anon; keep designed server/RPC public surfaces. F-14 checks named roles' effective table grants but does not itself discharge all descendant-role and column-ACL cases. Future grants require renewed qualification; no new anonymous product access is authorized here.

### Send-lock writes: preexisting defect, separate forward repair

High-confidence source-level authorization defect: direct authenticated INSERT/UPDATE can manipulate `ediel_send_locks` as an ordinary operations member of a writable tenant, despite the later canonical command boundary. The reference already contains the broad tenant policy and direct ALL grant; exact replay unions carry the defect forward. This is **not a new replay regression**.

June1 readiness hardening explicitly authors platform-only writes (`20260601070000_ediel_production_readiness_hardening.sql:187–212`), but June2 generic tenant policy completion really does broaden them (`20260602093200_ediel_operations_rls_completion.sql:7–66`). The later canonical production transition owns lock projection updates (`20260802011000_canonical_ediel_production_state.sql:222–238`); the service-only authorized wrapper and final implementation check actor permission, idempotency and readiness (`20260802170000_canonical_security_convergence.sql:403–468`; `20260902094600_fix_canonical_transition_request_hash_rewrite.sql:6–80`). Application `app/admin/companies/[id]/ediel-actions.ts:354–369` requires platform access and expressly refuses direct unlock. No later intentional ordinary direct lock-table writer was found in the reviewed source/app path.

The September3 convergence trigger only maps locked to status and does not authorize the actor (`20260903160000_ediel_send_lock_state_convergence.sql:64–88`). The release trigger can requeue matching blocked, unsent outbox rows when canonical state is live (`20260903161000_ediel_send_lock_release_requeues_outbox.sql:3–47`). This is a bounded state-changing consequence, **not proof of message delivery or a production exploit**. Local native DML reproduction remains required.

Disposition: keep the consolidated read and policy identities, and qualify the separate one-table forward removal of authenticated non-SELECT capabilities. INSERT/UPDATE-only removal would not establish complete protection while other mutating privileges such as TRUNCATE remain. Preserve service writes, all existing rows and policies, and authorized definer RPC behavior. In particular, `canonical_restore_pre_engine_live_ediel_approval` updates the projection under its platform-actor check. Its initial authenticated grant (`20260815114530_restore_pre_engine_live_ediel_approval.sql:4–12,34–36,197–199,219–220`) is later revoked by `20260815210353_restrict_recent_security_definer_rpcs.sql:1–8`; final execution is service-only. Preserve that final ACL and the UUID aggregate hotfix body from `20260815114814_restore_pre_engine_live_ediel_approval_uuid_aggregate_hotfix.sql`. The immutable reference grants only service_role, and 9f has no restore-function grant delta. The parent owns the candidate and fixture; this report does not claim that repair has executed.

## Exact removed-policy register

All identities have schema `public`. R/I/U/D/* below are policy commands. Each replacement key refers to a complete record in JSON; the four info-event replacements are linked from its one removed record. The dispositions are deliberately separate from `schemaAcceptance`, which is false for every row.

| Table / removed policy | Command | Removed row SHA256 | Decision |
| --- | --- | --- | --- |
| audit_logs / gridex_db1_audit_logs_insert | a | `36efd16219991af3f053e98fa2dd7de874ab68cb26922359a3a2d911323e0398` | Preserve tenant-write intent; qualify runtime |
| audit_logs / gridex_db1_audit_logs_select | r | `5bcfd449b0839ee50b59ea22a8e5d681fbee8bb969da984e1671ee8e8f50528e` | Preserve read predicate |
| audit_logs / gridex_db1_audit_logs_update | w | `f4fb8dd837a0872888729a29e2721175dea87ac68603a8f7b77dfd9388318b3c` | Preserve tenant-write intent; qualify runtime |
| auth_email_events / tenant_lifecycle_anon_deny_guard | * | `ea105274560d91cd5e5fc6916ebf7be595cbce1ba84609a38811e8c97d3c8f77` | Intentional cleanup; verify closed anon ACL |
| communication_routes / gridex_db1_communication_routes_insert | a | `a07320650cd1b2564dbcfc95de7ecd744cbe42d180ed6a89ec52edc51a52bdd6` | Preserve tenant-write intent; qualify runtime |
| communication_routes / gridex_db1_communication_routes_select | r | `68267560b2e65794581300176adaa4063128302c57fe5aa01f7056a7dd784153` | Preserve read predicate |
| communication_routes / gridex_db1_communication_routes_update | w | `2de5511131e354bec55b9e6ceef483d77d88260a60235410450ebc456f7b5573` | Preserve tenant-write intent; qualify runtime |
| company_customer_number_sequences / tenant_lifecycle_anon_deny_guard | * | `8e57f1fa14531db174cefadbf80b394fd1f74fd11661f280e92fa58e54ee0a75` | Intentional cleanup; verify closed anon ACL |
| company_invitations / gridex_db1_company_invitations_insert | a | `4ae008556e49ab953eb98d1781f72fd42205c33b4ca63ab5b8fa0ab07eb9c254` | Canonical-only ACL denial; expression hash only |
| company_invitations / gridex_db1_company_invitations_select | r | `bb4c611c079bcc74c54da4ee1acef22899f3454ed7a9748e3eab7f8b482626ce` | Preserve read predicate |
| company_invitations / gridex_db1_company_invitations_update | w | `f6280a3ef4992d59a12cc748a3607a77c19cd8157c3f3e1779b2b0989414381f` | Canonical-only ACL denial; expression hash only |
| customer_addresses / gridex_db1_customer_addresses_insert | a | `2cab5768f3f9786292d9c38788238ff6358b104247b2a07995c6afaa5c31c7e7` | Preserve tenant-write intent; qualify runtime |
| customer_addresses / gridex_db1_customer_addresses_select | r | `ab04748b6017ade1d771a24a7fd7b2f1620d3af8183c3afa3e1c4c719ead621d` | Preserve read predicate |
| customer_addresses / gridex_db1_customer_addresses_update | w | `1154dc7e68a2d9f35591768ee9ac57ab6e221a8923767f204a6a3c56d6ee0617` | Preserve tenant-write intent; qualify runtime |
| customer_authorization_documents / gridex_db1_customer_authorization_documents_insert | a | `ac609e1c3e1bfafa61ef6db8617d4c9739ab281013f8f51ff69e2ddbd8d7fe8e` | Preserve tenant-write intent; qualify runtime |
| customer_authorization_documents / gridex_db1_customer_authorization_documents_select | r | `18f3209809722287d1607058cb8e973562e8d0cb681fe6532294ae3da73c3646` | Preserve read predicate |
| customer_authorization_documents / gridex_db1_customer_authorization_documents_update | w | `654c3fefec9070cd8a98ee9c24ea64f11b64b6beb922a3a115824f17de95a5eb` | Preserve tenant-write intent; qualify runtime |
| customer_contacts / gridex_db1_customer_contacts_insert | a | `8f72e02fa4167289314972ee6230310d341c59923559a35f59b082b8fe7d7724` | Preserve tenant-write intent; qualify runtime |
| customer_contacts / gridex_db1_customer_contacts_select | r | `0ed005e25898f98d7b3cb3cb9d03c635dc8aafc5c6e36c1f0f304a00f0e18a7f` | Preserve read predicate |
| customer_contacts / gridex_db1_customer_contacts_update | w | `86148ca6cee1f1bd74f7bc962cde74fbd975c8056d30fab47a66a8369d7682ce` | Preserve tenant-write intent; qualify runtime |
| customer_contract_events / gridex_db1_customer_contract_events_insert | a | `b14d2606375fcd19b8b5f67f0fa8459a70a2c99212c30b4f6f26c6dd74e9b6f3` | Preserve tenant-write intent; qualify runtime |
| customer_contract_events / gridex_db1_customer_contract_events_select | r | `c6e391f4d8027a29bd948b2c28eece57f0b0520a71c7801744027888ee8e3fbc` | Preserve read predicate |
| customer_contract_events / gridex_db1_customer_contract_events_update | w | `0870407dcc4b044e4ec4996d9173671fac25a25a72102e92b3ab8067786483d1` | Preserve tenant-write intent; qualify runtime |
| customer_documents / gridex_db1_customer_documents_insert | a | `64801acd7614df4db81d5694247cc53fa70ec41416301de51e0872ec65a90941` | Preserve tenant-write intent; qualify runtime |
| customer_documents / gridex_db1_customer_documents_select | r | `ae26f1476b68242451fc170efeef4a210b6aafe87e0b64a62916a51643464aef` | Preserve read predicate |
| customer_documents / gridex_db1_customer_documents_update | w | `883c6730920db64dbf877720364069f064635b3175e67177866d2574cd37ca8f` | Preserve tenant-write intent; qualify runtime |
| customer_info_request_events / customer_info_request_events_service_role_all | * | `9ee6578a45e420f73d3a0477f452b331d8ac558ab9a6ac1dd6aa4b65fd4536ad` | Tenant R/I/U; S-only D |
| customer_internal_notes / gridex_db1_customer_internal_notes_insert | a | `aec699ad194f37fafaf27d42bf77db28bb25e08e3d192d29496b63817dc943b0` | Preserve tenant-write intent; qualify runtime |
| customer_internal_notes / gridex_db1_customer_internal_notes_select | r | `a6575ba7af16a60011743762bae463796801ee78a10a284d550f10df8281cf44` | Preserve read predicate |
| customer_internal_notes / gridex_db1_customer_internal_notes_update | w | `52094d934d301ac9cbcfbb2bd0a3d2b3d7db80fb62d1d32074f7c1ede0d04a91` | Preserve tenant-write intent; qualify runtime |
| customer_operation_tasks / gridex_db1_customer_operation_tasks_insert | a | `cd525e6d59072129d3a5391e8c1e4db325b6f4fc3d55aaeee0a46d5f5ca30155` | Preserve tenant-write intent; qualify runtime |
| customer_operation_tasks / gridex_db1_customer_operation_tasks_select | r | `bfed613b2fe3594874df16d6fa7b55502937c2214f3b3c5dc075a9c9f115b3dd` | Preserve read predicate |
| customer_operation_tasks / gridex_db1_customer_operation_tasks_update | w | `a382060b39fb676083d478e38d29d21dc1be4e7414f30fadacc63450e8ba34cf` | Preserve tenant-write intent; qualify runtime |
| ediel_actor_settings / gridex_db1_ediel_actor_settings_insert | a | `d18eccdcd71b8f5ba0486eecfd79d64e5204948aeaa3ee699d020d2264f85266` | Preserve tenant-write intent; qualify runtime |
| ediel_actor_settings / gridex_db1_ediel_actor_settings_select | r | `82afd4049a21bb170ce871dc8ded0a8a13267ac14e0baf3f803119b0b76ccd83` | Preserve read predicate |
| ediel_actor_settings / gridex_db1_ediel_actor_settings_update | w | `ea7b33d864b3fa7a6a8ac2310aaac114a883ba83ec82489e42ff9a580e240623` | Preserve tenant-write intent; qualify runtime |
| ediel_route_profiles / gridex_db1_ediel_route_profiles_insert | a | `60bd15b1959cfe1fb07fe46936b7af9c97ed8dc0722dfac163b0ec745faddd65` | Preserve tenant-write intent; qualify runtime |
| ediel_route_profiles / gridex_db1_ediel_route_profiles_select | r | `a88d12b13d746164f864b0d4e0d192cac8c21bb531d7ffc7d45f7aac19825db0` | Preserve read predicate |
| ediel_route_profiles / gridex_db1_ediel_route_profiles_update | w | `b0d6dedfb87653760678f6c29c40047fcf70b3b8207a98a39054828ebdaed94c` | Preserve tenant-write intent; qualify runtime |
| ediel_send_locks / ediel_send_locks_tenant_insert | a | `eb69367b09a74f4139db6708887dd1cb036cfec8e837090bb33ed7325d297555` | Existing lock-write defect; forward repair |
| ediel_send_locks / ediel_send_locks_tenant_select | r | `0648f8a28808b829dd9f1644e2194b6040944ca126f5a9ec7c80a6372bf01719` | Preserve read predicate |
| ediel_send_locks / ediel_send_locks_tenant_update | w | `5ff2ef0d3b125d846d6287358bbe5426db2b1abd8cced6887ac8e011808564cd` | Existing lock-write defect; forward repair |
| grid_owner_data_requests / gridex_db1_grid_owner_data_requests_insert | a | `7e5328b27343810ddcb8b052b3feae1b432a037a9ced20a47cf9a8f589225c40` | Preserve tenant-write intent; qualify runtime |
| grid_owner_data_requests / gridex_db1_grid_owner_data_requests_select | r | `4e933b28e6c2bbbabaa851e4335be91e0391067b43ecb37fdee3537b6741f487` | Preserve read predicate |
| grid_owner_data_requests / gridex_db1_grid_owner_data_requests_update | w | `8bf41b598544cf93eebca1614961988692de569b24c137efe286323ca51f94ae` | Preserve tenant-write intent; qualify runtime |
| inbound_processing_jobs / tenant_lifecycle_anon_deny_guard | * | `38a252528a95dc93a3630f9bedf037747ccf7de64b2418a52307375c1f1983b4` | Intentional cleanup; verify closed anon ACL |
| metering_permissions / gridcore_ediel_saas_insert_metering_permissions | a | `fcae4d05312bb7d77d785f84ac1d80594d34daa3a9a675b34cfc82394951a75b` | Preserve tenant-write intent; qualify runtime |
| metering_permissions / gridcore_ediel_saas_select_metering_permissions | r | `c6f7fe6dda85b9a6c3b9afce8791ac1a10c6c37a16ab9eaa2c466cfaf1f5fc17` | Preserve read predicate |
| metering_permissions / gridcore_ediel_saas_update_metering_permissions | w | `cfb9e52deec49b44e002aa80751676b74a2e80287dde672bdd02f0098cc23418` | Preserve tenant-write intent; qualify runtime |
| outbound_dispatch_events / gridex_db1_outbound_dispatch_events_insert | a | `ba3b1de771b6a4636995f70e268afeec93708e7c47dfbbeeb32a2a4a876005fa` | Preserve tenant-write intent; qualify runtime |
| outbound_dispatch_events / gridex_db1_outbound_dispatch_events_select | r | `0b402901cd04fdf78c21507e3f1593391c4ecdab0cfef3edc272cc7b2fa44d35` | Preserve read predicate |
| outbound_dispatch_events / gridex_db1_outbound_dispatch_events_update | w | `a50723dcee1ae345a0d73cd57fd6901ea7eff8be55faab8fb203f4c9d31f5bc0` | Preserve tenant-write intent; qualify runtime |
| outbound_requests / gridex_db1_outbound_requests_insert | a | `abf34ed849c50360526fbfd8112947597769f3badf37faabb8322a0c0d3481aa` | Preserve tenant-write intent; qualify runtime |
| outbound_requests / gridex_db1_outbound_requests_select | r | `6e6b37b3acce55559c527b47634dba39d39606731c13ef617517e6322e2b6326` | Preserve read predicate |
| outbound_requests / gridex_db1_outbound_requests_update | w | `6fe0d98b929ea322c167422c06c287cf777e1edba589d68881203c34dbd45422` | Preserve tenant-write intent; qualify runtime |
| partner_exports / gridex_db1_partner_exports_insert | a | `0ee1cfdb541805fd4236764c9a052afeac7f4d16e5e68c10df654d7509b237cb` | Preserve tenant-write intent; qualify runtime |
| partner_exports / gridex_db1_partner_exports_select | r | `9599a06d813d5cf7ddbbe858f4d7cb55012562c5093f9f740089e470bca73d6d` | Preserve read predicate |
| partner_exports / gridex_db1_partner_exports_update | w | `e8ace7d32733b5d3158fcff564737a4e47b515188c308f4711b13f2805ba4b6b` | Preserve tenant-write intent; qualify runtime |
| user_roles / gridex_linter_user_roles_self_read | r | `96dd319acce41e8b3a1fd65b86706378cb4b76d6a6f9163078ccc033046dd14a` | Preserve explicit tenant read widening |

## Exact authenticated replacements

Each row is an artifact addition, not an inferred policy. `full` means all canonical fields independently hash to the artifact; `hash only` does not assert the expression. The JSON includes the full 57 reconstructed rows, preserving order, whitespace and parentheses in expressions.

| Table / replacement policy | Command | Row SHA256 | Evidence |
| --- | --- | --- | --- |
| audit_logs / gridex_mp_e185c4f1c4faa621e763 | w | `782df18a820280215f262727364e75c7b9e57a5564accfdf66eba794b0f8677b` | full |
| audit_logs / gridex_mp_e8534998783068d30ad5 | a | `8bb3c8a1f2583ed1b4ba85ff95e67b0ee0eec75ca223da4469cab3245a5370cc` | full |
| audit_logs / gridex_perf_authenticated_select_v1 | r | `cd121127afcb18d5f7c7a94e8bf40a134825589418127fc4271a98f57baa273b` | full |
| communication_routes / gridex_mp_2bbf4b53469fd6178461 | a | `95bd00e515d5a61bf2475080b16122f6d6d67d5f541174ede3ddbae524740d3d` | full |
| communication_routes / gridex_mp_8ce55d030c258cc5474f | w | `2b8d63bd0f2fc6c8ee614d2d382c2fc39fdd102ae149e87fe20b8b868982e15d` | full |
| communication_routes / gridex_perf_authenticated_select_v1 | r | `e240d58e3c8e83351133ccfb78d735eb4f8662eb147f49aa4ecc9a9943846189` | full |
| company_invitations / gridex_mp_2a597f77b183f20e38eb | w | `18f905571729f74e9435c5244f27aab5c97a4ebdceab7e5e8b0e65d119ff7df2` | hash only |
| company_invitations / gridex_mp_95994347788240807258 | a | `4aa7bdaaf4d1f9c11b662a03ceef90e1482062f499f077b8e7c0b6d842671813` | hash only |
| company_invitations / gridex_perf_authenticated_select_v1 | r | `3d21dfd40beb5983a5c3a8756775f3c876fc1ea853b11f96ad29fb4acc754ec2` | full |
| customer_addresses / gridex_mp_1f934487828f7347c978 | w | `809d2a6a69dfeeb51c6beb9b58d57a85a2d09ab4b647824d52d011dff306d5ca` | full |
| customer_addresses / gridex_mp_da053eddfc63c1160c87 | a | `b89b061c99f1e115a5b0163c39a1b246702736b101ce2aa38e9d2a9fbfc3daff` | full |
| customer_addresses / gridex_perf_authenticated_select_v1 | r | `c6c17d2e089753f1986a8000eac20c96b6fbe6197f811a2c3a32ba98a4858d8e` | full |
| customer_authorization_documents / gridex_mp_1d593b44e4e0b65447f0 | a | `a09b10de76afdad3b984ac21da36f5b6c095b161e573eb691f6bbaebd23b0ab7` | full |
| customer_authorization_documents / gridex_mp_e7abd844eea07efcc87c | w | `8e0e834766171238bef8268cb3af3d405ea414869aabc46b704190fd9a953de8` | full |
| customer_authorization_documents / gridex_perf_authenticated_select_v1 | r | `f0d045836b782fb0b25cdd114c62be077bf75a0de36b51cd12619f6b7dee0b89` | full |
| customer_contacts / gridex_mp_270875e31c4d1babd33d | w | `da01460a8d687743db1607f3a2cf55c28626ecd803aa5ca61465281960393cf4` | full |
| customer_contacts / gridex_mp_49cbb82bb9ef2f4b7bc6 | a | `e0ea038654b835ff0b0114948ff9778a9152d96b2e1c5c32f83f7aa38c210a6f` | full |
| customer_contacts / gridex_perf_authenticated_select_v1 | r | `dc27337d5bfa0065b1eb6cdc68413368a68349f661d6423ee3cc578703d7c110` | full |
| customer_contract_events / gridex_mp_5b6b24da4796a6585646 | a | `7e402400fb9442476d59c8fce0e48a2616e1e1d382ac7171a7ed548e172343df` | full |
| customer_contract_events / gridex_mp_bbd32d16dab17f7c0ba6 | w | `2d7245653835bb12af223f1d69f5207b6cf05f51b5994383753dca090f2d51fb` | full |
| customer_contract_events / gridex_perf_authenticated_select_v1 | r | `1fd38163e856bd8a889fb44bb33f5eaa8f4c7dd0db3562b79f446d548501a4c5` | full |
| customer_documents / gridex_mp_0073cf03fb4f4ce5e3f0 | a | `49d10215a5e2865f89afa2c9a8db38eaa8bdadac91d18d82c31dd08b097e5ea4` | full |
| customer_documents / gridex_mp_a0f2cbd6aa7f33827796 | w | `51aba851e1a198c4e760c85e413c883b6cff20755cc7f03c30af937a385548fa` | full |
| customer_documents / gridex_perf_authenticated_select_v1 | r | `483ffd87b5c62a880942e4d443634a08f3d5a139f9f90d773f702b1a1dc51788` | full |
| customer_info_request_events / gridex_mp_5aede207f5fa533f44df | w | `5ae42e880bfba9e0c6537e429cef7915f64ae59c7657ae9c58608610de540d38` | full |
| customer_info_request_events / gridex_mp_73114b6f8226a07cb343 | a | `3d5224c8fd56638e58196bba0e4b3385a71f843451b1f2928978220c7c520d08` | full |
| customer_info_request_events / gridex_mp_f625bcbc0cffb824de0e | d | `fbac14f4bad4b43b0ff1b7eebf29741584e481b644de48482f0606ed0af0acc6` | full |
| customer_info_request_events / gridex_perf_authenticated_select_v1 | r | `053e63723c2b5dc44ca6eddf575fa7c1bedcbc6db2810e3425b0c3654185abce` | full |
| customer_internal_notes / gridex_mp_bafc57c78c71919f52da | w | `81fb4d757626f8d2073b9c66d5a2654c6507b21abbb313efe225595bbfa2e02f` | full |
| customer_internal_notes / gridex_mp_be5f6971559d176aaad8 | a | `aa2ff99f5a6f099a711339841585c2d1b08ff98b43b49fc4eb35a3f300fb632c` | full |
| customer_internal_notes / gridex_perf_authenticated_select_v1 | r | `9a430555386b1f6f04e06abe5640ef9cb5ae6f5c685dfa1fd7447acb4eb8257a` | full |
| customer_operation_tasks / gridex_mp_ba822806184f6afc0d7b | w | `270832f2a22c36dd306afef540e63ec56133e10de049228f662ca35059b97b76` | full |
| customer_operation_tasks / gridex_mp_de72ba51a19d049d3ff1 | a | `50b9d32249501c470de22ae98557729ff0635884f8b352107fc5a1cc4b124bf4` | full |
| customer_operation_tasks / gridex_perf_authenticated_select_v1 | r | `5d6ac822cfc111bef78ec63bca222dc5f04359da5d2ec69e53f079bb6d9cacb7` | full |
| ediel_actor_settings / gridex_mp_c4ab4a1fbf80131385eb | w | `df57f8323bffdeb1c5e76937910a144251666e808d62e25f3afaf9deba991147` | full |
| ediel_actor_settings / gridex_mp_cab292ed7c776394f0dd | a | `004b1f731639e149f2456a53f7753b64798b88016b14f6fb2f25ca1ce4527286` | full |
| ediel_actor_settings / gridex_perf_authenticated_select_v1 | r | `ab4f22c9ca1a61326f6f58693c7a7fd30a60536efcaa26230df629a55dca5148` | full |
| ediel_route_profiles / gridex_mp_8fd20e477ab2a47d421b | w | `009788d252ecaa118d552e7f96629feecde808643a175d64dd147698155579ac` | full |
| ediel_route_profiles / gridex_mp_ba54c24776262517c51f | a | `428433f0848ee5dc028b938d6390ed2e25d34e33a8881baa75a1de31ba1b2cd2` | full |
| ediel_route_profiles / gridex_perf_authenticated_select_v1 | r | `1155745f7bf3090b6b1e5853e84606b3a890121be4147b4daea0db3437cb4124` | full |
| ediel_send_locks / gridex_mp_4fc7c88588b93b1e8b6f | a | `ab884aab91bd11ae84ca1b86f96c9b02a7d7396dc9756043d3a528587aced529` | full |
| ediel_send_locks / gridex_mp_d31ac6d667cda6f43cf7 | w | `7d0dbea7e2bf08fd09e865691864f44f988a760a910ddddcaa4633e45f9ec9f2` | full |
| ediel_send_locks / gridex_perf_authenticated_select_v1 | r | `3828b4087163470d43f1e4feca9d1650e3235040315bb0cd222fb01682a72480` | full |
| grid_owner_data_requests / gridex_mp_3c68c5fbae9693de53a1 | w | `a4bc9915fc66827588d6c27fe7817bd3aadcd3921fa5800e928edd66cf7b0051` | full |
| grid_owner_data_requests / gridex_mp_f0872e9b54bb3b580ffc | a | `e4d7cf6f957c509b9067ed541b4f29ec5ef737548a1ae22496930a1709d6500c` | full |
| grid_owner_data_requests / gridex_perf_authenticated_select_v1 | r | `b5768a28760e1dfddc3977c5364552d67ca3115c6b48a65c043749b3fddde8b3` | full |
| metering_permissions / gridex_mp_2ec74ad3e1b0cd7abfb6 | a | `4195d3deb407dca15814a9b150dca1aa68d930c2dbac09f7698aee3306af91b1` | full |
| metering_permissions / gridex_mp_59ebea0afaa910af537c | w | `a8dcf5a2054e9f61400610a8666c1017b4e1304cfe4e9bbc3aea9bad0c280be2` | full |
| metering_permissions / gridex_perf_authenticated_select_v1 | r | `589e5976fd82ed8c74a8214cf348bc2daa6ae1066d7710b81124143c9e1142e9` | full |
| outbound_dispatch_events / gridex_mp_4c07aa807632113d80dc | a | `6e05eaee0a82238795b699a6a0ce2a76a8497a1ff978a7548f181a6f66015385` | full |
| outbound_dispatch_events / gridex_mp_d66a86f24dcc7e750e7d | w | `25b4eb146b7f2885a87baf1ed51c8b5ab6af0dcb7f7c0592b6ae5511b24e48af` | full |
| outbound_dispatch_events / gridex_perf_authenticated_select_v1 | r | `2a31db33464daee1d24a3e70bc930921dcb08add4efbd3daff075e3a5c72d6c8` | full |
| outbound_requests / gridex_mp_1ce7db6da88a5f81cfc3 | w | `6bcd63fb4682b39b164e95f84dd68c515ac8a4643b76b16cd2b2757ceb8545b5` | full |
| outbound_requests / gridex_mp_f7d75aa9ec401b6055ba | a | `e936c5e0272ac1b01ddb5a6d38c14ef37a0fdc26ec81d6ae53c0e338ad35ea60` | full |
| outbound_requests / gridex_perf_authenticated_select_v1 | r | `162caa6b18d8c319b3f4b1d78fac131304c39b18c9ecff93d300e47fe86d2d6e` | full |
| partner_exports / gridex_mp_6b8fbc2194343d1a9420 | w | `b2dda3f48450795a575eb722701267bf4dbe9941de82725bcf2f1f915241ab31` | full |
| partner_exports / gridex_mp_a8b3832738662a80c300 | a | `8aa46e2d48247ebb855bd9fd30f20e865ffc7e3fac3540fe48706f2c563346bf` | full |
| partner_exports / gridex_perf_authenticated_select_v1 | r | `2a98528e6558f18e5da8c4ce3856dc9812a527b0ee4c484d92f232362113b9cd` | full |
| user_roles / gridex_perf_authenticated_select_v1 | r | `5a98141eb2e23a874dde422b1e1aac2a58e0525cecaf42248741a960bb78b64d` | full |

## Source pins and reproducibility

Line ranges and purposes are in the JSON source catalog; source paths below are relative to the repository. The pinned reference supplies each exact removed statement and declaration line.

| Source key / path | SHA256 |
| --- | --- |
| anon_cleanup: `supabase/migrations/20260902094000_platform_table_classification_and_invariant_gate.sql` | `29ea84caceca14260c6a909534c89a26a015568d9bf56741cd796a5cd1896470` |
| compiler: `supabase/migrations/20260612143000_performance_policy_consolidation_and_index_cleanup.sql` | `ff3b3c65b97e36cb6c0bad1f25e4ff332debf3993c845c9856cf4fadea748b60` |
| db1_original: `supabase/migrations/03_db1_backfill_functions_rls_reports_and_finish.sql` | `877e395df0050a36ec71298d279c72fb0e6cb13d8b90082277450012e196f169` |
| db1_repair: `supabase/migrations/20260522_db1_schema_repair_backfill_foundation.sql` | `aff5a3e4fb3aae6ebe682081cbce4876c5731be1c124650b19d8151abf6efc73` |
| introspection: `scripts/sql/gridex-db-parity-introspect.sql` | `99b5c602223153dac69cf3266babfcffce80c889dc5375ad625c18e24fb255b0` |
| lifecycle: `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | `e2eee5be4e4c795380782248683bfd32b682a66b2e2882a1fd241c9acc7498b2` |
| linter_self_and_anon: `supabase/migrations/20260611190000_launch_linter_hardening_security_definer_rls.sql` | `b696379a5e1d26bde5fae150d7c51e9d40df029a9dfd605810ad9051b1fb74d1` |
| lock_app: `app/admin/companies/[id]/ediel-actions.ts` | `1fe3bf820eb6b49d87570f49a3f95357e63712fc1db2d4edfc6c0e84bc6ddd09` |
| lock_canonical_authorization: `supabase/migrations/20260802170000_canonical_security_convergence.sql` | `e34618a9cb0c780f3fd75034ab113e48d99a27d8983e5d0fcbfc4a53ee27370a` |
| lock_canonical_projection: `supabase/migrations/20260802011000_canonical_ediel_production_state.sql` | `7f50878b2c23889c967bceab5aa85ed0361af7aad9b3a3784b688e6cbd2bb502` |
| lock_convergence: `supabase/migrations/20260903160000_ediel_send_lock_state_convergence.sql` | `1f368f4a36e9ac93d09289c4538d142f7489746793aff110d9f593eaa0c7bafd` |
| lock_final_transition: `supabase/migrations/20260902094600_fix_canonical_transition_request_hash_rewrite.sql` | `4b167c6509b8f3a9076adbe98f24ae5e74981de05501828648045b3d6db3c0ca` |
| lock_platform_original: `supabase/migrations/20260601070000_ediel_production_readiness_hardening.sql` | `7a73e59f559ebb5291d3e7df74545e6918011ec9764e5c512df19fbaa5bdbc12` |
| lock_requeue: `supabase/migrations/20260903161000_ediel_send_lock_release_requeues_outbox.sql` | `ed0affa427b7356064a474a4e390dc70cf8297fa39c0b5e7c4e1edc1255c48c1` |
| lock_restore_final_acl: `supabase/migrations/20260815210353_restrict_recent_security_definer_rpcs.sql` | `5e2a5542b30bb560911645015382cf87029004f3adba03575f270f9377b93d69` |
| lock_restore_hotfix: `supabase/migrations/20260815114814_restore_pre_engine_live_ediel_approval_uuid_aggregate_hotfix.sql` | `4bb48b081c68fa11e5ca0fb8106aa2448ad62b50f266ff2be241fddd7882c650` |
| lock_restore_rpc: `supabase/migrations/20260815114530_restore_pre_engine_live_ediel_approval.sql` | `6850a14fc8154dc538192a525031409e04c7f0da740a4414a9add9f1b268ed29` |
| lock_tenant_legacy: `supabase/migrations/20260602093200_ediel_operations_rls_completion.sql` | `e921919e6effc234a247d17164afa695815271898146c306626c9e0ecf166e75` |
| metering_tenant: `supabase/migrations/20260530110000_gridcore_ediel_multitenant_foundation.sql` | `2915c459e7285c8f8813483d7958f5ff5ca3fdbefd263f0062e772f8c9dcb839` |
| platform_helper: `supabase/migrations/20260802190000_canonical_emergency_access_lockdown.sql` | `9f5071e87c0689feb84f8701cbbeef72f65fb1c227862fb1ba628da47bb40d43` |
| session_helper: `supabase/migrations/20260730130000_historical_sync_forward_repair.sql` | `3e204b00fa33badbfdc7a11c0304df3bc5385b16e0854e40af2df1c06b32b50b` |
| tenant_batch2b: `supabase/migrations/20260521_batch_2b_full_automation_and_live_ops.sql` | `20f6846c8857d04381e8956e55d683253eaa0805a88963294c12d9d942f19c4f` |
| tenant_debug2: `supabase/migrations/20260526_debug_batch_2_tenant_rbac_server_actions.sql` | `f99af4186539ade7455e7241275339352a23c8572bda7cfd05aba987bac8c727` |
| true_reads: `supabase/migrations/20260826093000_platform_dashboard_and_rls_read_performance.sql` | `f9084068f4eead62330b1b394b6b4cab5f47ff68b411bdb144009314c2b85a2c` |

Canonical row serialization is `json.dumps(row, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()`, hashed with SHA256. Policy fields are `nspname`, `relname`, `polname`, `command`, `permissive`, `using_expression`, `check_expression`, `roles`, matching the pinned introspection SQL. Role arrays are ordered. Generated write names use the first 20 hex digits of MD5(`public.TABLE:COMMAND:authenticated`); the SHA256 row check independently binds their content.

Run the following from the repository root with the retained ZIP in the parent directory to reproduce this report's data-integrity checks. It performs no database work:

```python
import hashlib, json, zipfile
from pathlib import Path
p = Path('quality/audits/PR310_REMOVED_POLICY_DISPOSITIONS_2026-09-15.json')
r = json.loads(p.read_text())
h = lambda b: hashlib.sha256(b).hexdigest()
rh = lambda v: h(json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode())
a = r['artifact']
z = Path('..') / a['name']
assert h(z.read_bytes()) == a['sha256']
b = zipfile.ZipFile(z).read(a['member'])
assert h(b) == a['memberSha256']
s = json.loads(b)['sections']
assert {(tuple(x['identity']), x['sha256']) for x in r['records']} == {
    (tuple(x['identity']), x['sha256']) for x in s['policies']['removed']}
adds = {tuple(x['identity']): x['sha256'] for x in s['policies']['added']}
assert len(r['records']) == 59 and len(r['replacementPolicies']) == 59
assert sum(x['rowHashVerified'] for x in r['replacementPolicies']) == 57
for x in r['records']:
    assert rh(x['referenceRow']) == x['sha256'] and x['schemaAcceptance'] is False
    for g in x.get('removedDirectAnonGrants', []):
        assert rh(g['row']) == g['sha256']
for x in r['replacementPolicies']:
    assert adds[tuple(x['identity'])] == x['sha256'] and x['schemaAcceptance'] is False
    if x['row'] is not None:
        assert rh(x['row']) == x['sha256']
for x in [r['referenceSource'], *r['sourceEvidence'].values()]:
    assert h(Path(x['path']).read_bytes()) == x['sha256']
assert r['schemaAccepted'] is False
print('PASS: 59 removed rows; 57 full / 2 hash-only replacements; source pins')
```

The remaining acceptance work is concrete: execute the JSON's bounded actor/role/ACL conditions against retained helpers and real role attributes; qualify the separate send-lock forward repair and preserved RPCs; bind all source/forward/native receipts; then complete the unchanged full-schema, caller and generated-type gates. This report supplies source decisions and exact catalog evidence without pre-approving those gates.
