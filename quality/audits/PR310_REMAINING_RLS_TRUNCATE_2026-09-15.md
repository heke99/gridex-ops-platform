# PR310 remaining new RLS-table TRUNCATE dispositions — 2026-09-15

Status: confirmed bounded ACL defect; staged correction and offline tests only. Actual PostgreSQL qualification and genuine CLI-created filename remain pending. No fifth source is promoted.

The retained `pr310-schema-335f987f.zip` diff has 62 added public relations and 1,512 added relation-grant rows. Of the 62, 31 are ordinary tables and 31 are views. Exactly 57 added rows grant authenticated TRUNCATE: 29 tables and 28 views. Two new tables (`auth_provisioning_events`, `document_parse_jobs`) have no added authenticated TRUNCATE. The seven already qualified/promoted new-tenant revocations cover seven of the 29 tables; the 22 below remain. The six operational and three inbound repairs concern preexisting relations and do not overlap this set. This exhausts added authenticated TRUNCATE on new base tables in this artifact; it does not accept other privileges, views, existing reference grants or later unobserved native state.

Every listed relation hash was independently reconstructed with relkind=r, relrowsecurity=true, relforcerowsecurity=false, empty reloptions and null view_definition/partition_key. Every listed ACL hash was reconstructed with public schema, authenticated grantee, TRUNCATE and is_grantable=false. Both equal the exact artifact rows. All 22 lack a reference relation; these are source-contract defects in the reconstruction, not claims that a reference ACL existed on absent tables.

PostgreSQL excludes whole-table operations such as TRUNCATE from row security. Thus authenticated TRUNCATE supplies a destructive whole-table capability regardless of the explicit tenant/platform/service row rules below. A generic role's SQL authority is not proof of a browser/PostgREST exploit. No direct SQL credential or RPC exposure is asserted. [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

## Source authority

| Tables | Exact source authority and preserved intent |
| --- | --- |
| customer_case_events | `20260520_batch_5_cases_audit_email_ux.sql:187–207` says server actions enforce tenant access; enables RLS and creates service-role-only ALL policy. |
| customer_lifecycle_events | `20260519_customer_move_out_lifecycle.sql:54–73` enables RLS, service-role-only policy, and explicitly describes retained soft-lifecycle history rather than hard deletion. |
| customer_sync_events | `20260519_batch_6d2_runtime_governance_completion.sql:208–284` explicitly names the journal at239; tenant read/insert/update, platform-admin delete. August14 adds restrictive company lifecycle guards. |
| data_quality_findings, tenant_email_domains, tenant_email_sender_profiles, status_transition_rules, page_performance_budgets | `20260531111600_system_readiness_foundation.sql:535–565` explicitly lists all five, enables RLS and gives service-role-only ALL policies. The first three have company scope; the global rule/budget tables still do not confer ordinary-member destructive authority. |
| ediel_agt_readiness, ediel_test_run_locks, ediel_unlinked_test_messages | `20260602152000_ediel_operations_completion_hardening.sql:365–406` explicitly describes service/server operations and authenticated tenant reads, names all three, enables RLS and service policies. |
| ediel_test_customers, ediel_test_facilities, ediel_test_metering_points | `20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql:319–332` declares platform-owned/server-role access. Later `20260611203000_launch_rls_suggestion_policy_completion.sql:22–43,107–157` explicitly allows company reads where company_id exists (otherwise platform-only) and platform-controlled writes. This later intended read allowance is preserved. |
| ediel_test_expected_acks, ediel_test_expected_values, ediel_test_field_values, gridex_archived_customer_registry_rows, platform_session_revocations | June11 source above: platform_only_tables at49–92 explicitly names all five; platform-only authenticated ALL policy at185–203. No generic-member destructive authority is intended. |
| tenant_governance_events | `20260519_batch_6d2_runtime_governance_completion.sql:316–321`: platform/own-company read, platform-admin-only write. August14 company guards narrow further. |
| white_label_platforms, white_label_platform_memberships | `20260521_actor_testing_go_live_module.sql:282–321`: RLS enabled; membership-aware reads, platform-admin-only ALL writes. |

`20260814162500_tenant_rls_lifecycle_hardening.sql:129–173` preserves business policies while adding restrictive authenticated SELECT/INSERT/UPDATE/DELETE guards to every public UUID-company base/partitioned table. Those guards do not cover TRUNCATE. No later source examined authorizes ordinary authenticated users to truncate these protected tables. Existing broadened SELECT policies and unresolved actor findings are separate; this correction does not alter them.

## Exact evidence

| Table | Relation row SHA256 | Added authenticated TRUNCATE row SHA256 |
| --- | --- | --- |
| `customer_case_events` | `b85866663607546887111ad3c69bb45f73911985192601b0078a5b6eac2eee9c` | `87856c54de7859fcad7659dba2e5668b5f95df710cb5957e4da527966ebcf4ce` |
| `customer_lifecycle_events` | `cef4217a0044fbcfbf2df3f5bf007e92329709ae14650a7c1d931b0863957cdc` | `4a1fc2c7afb29217f028324e1390d88cb7ec338a22067587fba2fba43a2bb30e` |
| `customer_sync_events` | `fe43d25942c75c4eb65179c531dad1b61d904f66357ced4702f0b641844b18fb` | `e128ed120e0da94a02da254c96433d034516b9564812b0cac926891e4c8a2847` |
| `data_quality_findings` | `53b4b09eed2a86c9bc765d4651acd8fe51cc7ec274eeecfd4b81a9b121200ee7` | `35e5375bed4203bbba4b8d6537d1447f76cc771ebd5ea1275a99951ffbb555f8` |
| `ediel_agt_readiness` | `f070d75e56c480cc26aeee297b6ab545744a391838de1745308387a296c829e3` | `fa4f48ffdd040511492df1ca7d5b58fdabdd370bf6b5b001bad2e758305983d0` |
| `ediel_test_customers` | `04beb00872154df136cadf612f530d561bd7ffc92949998e55a40afdf4df03c7` | `1f51d45cf1ae0fcd3b058d9793854df1222a3809868d1a81675f8e5a71905380` |
| `ediel_test_expected_acks` | `07da52dbd094ff6b55b0b6432f6da716fcefd8a6fbbd7d73064b06b125e164d4` | `33b655656614ba29afacb0cb94309e459f76ddeb9f0e5595972a21c670b2b8dd` |
| `ediel_test_expected_values` | `b6a008de900ab3ea6d9cace327360017d76832ba4c4f5b8208a26297621942a8` | `e3b8bc4d8229b97f8cf48859cb61ddb1c9a5d082d2cf66d0088e7a5eeeb63300` |
| `ediel_test_facilities` | `193befe907368d71867ede3441b99d6ce0dbc37c654c1d2b78d71b14c9652fd7` | `190b4bb2d8177a23eafb573e208ecbb0389211ab37f2797abbeb9150ba666d16` |
| `ediel_test_field_values` | `305e7fab656ad33517173a5d24ea5da89ab0598c1396e912d5ad250cfd82be06` | `3ce707f377c03bfa60fd7ce826e31012a50d55ba5f2ff576508b8131355751f8` |
| `ediel_test_metering_points` | `682473668c6c4bd9541240eda5fa6d3150007130681f7d74d8ce43c89d16bde3` | `924dc1a0c48c384b04d919287af88b35b5fcfe10b18a7d9572d52ae9561b752f` |
| `ediel_test_run_locks` | `69c3dc2492db0cbe96156ef3bbd14d8ac1b0cc2a30384b4ccf0756fe4e047827` | `41fdae5351e95cfc72b68022dc928fa128a2c458c8d5fbf3b4ff59a859ac5b40` |
| `ediel_unlinked_test_messages` | `da86688098ba4afe9a513146fe481cae87bcbbb9de328123a32a838845a60a5a` | `037bd9d1689f42636dd477b6f60e58620c8c0f8fda2c7ac50c7d0b466e9af029` |
| `gridex_archived_customer_registry_rows` | `0c26d4e350a7d10815ce529a71f5919bef0f45cf38514863cffe68250c8fd3c1` | `5c1171d604c6857fb7843d594d3463621110d5eeff21364655d43c5e631d7dd2` |
| `page_performance_budgets` | `5469c08c1800c8c805e390730672dff31a10dcfcea824b108fa359f978ffea84` | `abbbaf8289e155d1fe1273e27c1a9a32e113ec5c6cd16cec3c2639db7ec3d9bd` |
| `platform_session_revocations` | `5f3fd254e580d2c7f1ee152e228c7a8ed09740c138cbadfe25271c79cc02ae58` | `9dda8087e7fb1d94eb986f31f84b762497d83c5e7698f7b142f5a8f0d3264bd3` |
| `status_transition_rules` | `7440c5e4b39d29ab15b3effbac36e6da0ece15b918dcd977ca5f2c9772ce49f7` | `2322cd9a61bac0280eb24985efc4a786168bbe25c3f2f02c24db1d024da562e9` |
| `tenant_email_domains` | `3330c746751e1833c14fabe3ee3b8d093b02f329f16303f686554041d952d9ac` | `3e458190e6fa640678761405d660168bdbc78161759ac274789af2a247083965` |
| `tenant_email_sender_profiles` | `850aa403de5e893bcdfb40e761f21c9d735a3e59dcc5fd3fa238d649241160be` | `b11cb34781b1d478bb7c43b34bd0a69314de69d49dcc7de1c1ce80118da447ec` |
| `tenant_governance_events` | `1484e3f09d906df0439764d1ead9d5896e05b0e7471d0da007fdf473357c6942` | `5c03eba1d07d19dda6d4b4d03a175cf5c366c0e3b7aae8faba5604f37197d1ec` |
| `white_label_platform_memberships` | `ff688657f129e56fc610f75590158122239f7f62962dd866d89a4a668bb6a089` | `94d89cc6f928e4d35e54550f28aa330d1ebd97411d302d53d841530927a923b9` |
| `white_label_platforms` | `9d73954fd481208f534ab9fbcbf67f8dc86145580ec1eff50c158a1a077b6067` | `7e7a9a6bc29e97a4d4fabc143a5192653ccad05d056c33977ed88ca727e601b8` |

## Finite candidate and qualification

`scripts/sql/forward-candidates/restrict-remaining-rls-table-truncate.sql`, SHA256 `cf85df9d7339e5368ceac7567b720dfa26cc2bf51fe2cd0f19b79b3af7eaab2b`, revokes only authenticated TRUNCATE on exactly the sorted 22 names. It checks ordinary/RLS/non-forced shape before and after taking an ONLY ACCESS EXCLUSIVE lock, runs atomically with finite lock/statement timeouts, rejects authenticated membership in the table owner role before/after locking, and checks effective authority afterward. PUBLIC, inherited or owner authority causes failure/rollback rather than revocation of another principal. It changes no policy, other privilege, row, source migration or official ledger.

The new fixed localhost PG17 fixture uses the existing nonce-marked role/database ownership cleanup helper. It refuses arbitrary target/options, preexisting databases and a preexisting service_role→authenticated membership (including INHERIT FALSE) before setup. The inherited-authority control therefore restores a proven-absent role edge. Each synthetic table has two rows, authenticated deny-all RLS, service-role access, retained authenticated column SELECT and anon SELECT sentinels; another table and another schema prove scope preservation. Original authenticated TRUNCATE empties both rows despite SELECT seeing none, then rolls back. The correction must produce 42501, retain every other ACL/catalog/row value, preserve real service SELECT/INSERT/UPDATE/DELETE/TRUNCATE under rollback, reject wrong shape, authenticated ownership and missing last table, reject PUBLIC and inherited residual TRUNCATE, and repeat without change. The fixture represents no real Auth implementation or application graph. It exports only finite receipts and hashes, never SQL errors or row contents.

The dedicated workflow checks offline controls and owner tests, then actually executes this fixture before installing pinned Supabase CLI2.101.0 and obtaining a genuinely created empty migration filename. It copies exact candidate bytes into that CLI-created file and uploads the unchanged SQL plus linked SQL-proof/creation receipts. SQL failure or a missing/false receipt blocks filename creation; promotion remains a separate step after the successful artifact is verified.

Validation in this review: four new tests first failed because the fixture did not exist, then all four passed. Independent review found the inherited-role control needed an absence guard; a fifth test reproduced that gap and passes after the guard. All five new tests and four shared ownership boundary tests pass. Selection-only verifies candidate/source pins and all 44 catalog/ACL row hashes without database tools. No local PostgreSQL execution is claimed.

## Source SHA256 pins

| Immutable source | SHA256 |
| --- | --- |
| `supabase/migrations/20260519_customer_move_out_lifecycle.sql` | `cd2a6b782bf1a5571c0d77dc948440b55e076df01b8986c58e97d07c9ab239b8` |
| `supabase/migrations/20260519_batch_6d2_runtime_governance_completion.sql` | `b7d9d48b9cd3093b5546b04225f9c6151b0f674d2ae73441d8086f51922de9ab` |
| `supabase/migrations/20260520_batch_5_cases_audit_email_ux.sql` | `0e26b35eef3fa863f149bf4c46be4018ff484d3d55c5434a64323fafde201775` |
| `supabase/migrations/20260521_actor_testing_go_live_module.sql` | `94e7fc8168c5d17925c61a4985a889db1dd8a823ce3477ded9fdbdab6cdc7c08` |
| `supabase/migrations/20260531111600_system_readiness_foundation.sql` | `e6ef68b18ede5729da067ce59a86cfca0db083d9d54a35ae0ed3a6c0968b96f2` |
| `supabase/migrations/20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql` | `7f71410f8b9f498286226dae76a2bc8ab1073cb43e07442ed8b5e0eb5de869be` |
| `supabase/migrations/20260602152000_ediel_operations_completion_hardening.sql` | `9d9964b6226c9722fad0a185042a1455682f14d5011ee6415ebbfcc2b2cba01f` |
| `supabase/migrations/20260611203000_launch_rls_suggestion_policy_completion.sql` | `8a5fdae1e607b355c16b3e8d6042647609242b571e6f8a8ec0882498ad73a52b` |
| `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | `e2eee5be4e4c795380782248683bfd32b682a66b2e2882a1fd241c9acc7498b2` |

Artifact ZIP SHA256: `4009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb`. Reference schema SHA256 remains `b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30`.

Fresh evidence rechecked: `pr310-schema-9f1ba7ae.zip`, SHA256 `0ee862d06ee0e4f33208aa33ceefe8ce5afa8c5e8ca1c9cd186f006c7364f2af`, artifact10399581944/run34975955635/job104403606680, includes all144 foundations,514 historical timestamps and4 promoted forwards. All44 relation/ACL hashes above remain identical. This confirms the22 grants survive the firstfour repairs; portable success is not native or schema acceptance.

Independent ownership review correction: owners can revoke their own ordinary TRUNCATE while retaining regrant authority. The candidate therefore checks `NOT pg_has_role(authenticated,relowner,MEMBER)` both before and after each lock, conservatively rejecting owner-role membership even when privileges are not currently inherited. The SQL fixture now tests an authenticated-owned table and verifies unchanged owned state on rejection. [PostgreSQL17 privileges](https://www.postgresql.org/docs/17/ddl-priv.html), [role privilege inquiry](https://www.postgresql.org/docs/17/functions-info.html).
