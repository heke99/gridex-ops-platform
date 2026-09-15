# PR310 bounded policy dispositions — 2026-09-15

Status: PARTIAL. Three authenticated SELECT predicates are broader than the immutable reference at the policy-composition level. Whether those differences violate the intended application authorization remains unresolved. No production vulnerability, cross-tenant access, schema equality, native acceptance, or release readiness is claimed. Preserve reference and historical sources.

## Scope and evidence

Reviewed all 128 changed and 59 removed policy identities in the retained 335f987f comparison; considered added policies only where necessary to interpret replacements. The complete comparison contains 486 added policies, with reference/replay counts 2548/2975. This is not a review of every added policy.

Archive: `pr310-schema-335f987f.zip`, SHA256 `4009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb`; member `full-schema-reference-diff.json`. Reference policy-section hash `68c77068684a9bb1d97bbc00642b0b2742637d3be97cebbc92dd4b830df28049`; replay policy-section hash `81730fbfb3d76f2fa8965b745f2dfdc4d90c7a8bda7460adf64face5fed11e4a`. The artifact reports 144 foundation and 514 timestamp inputs but explicitly does not certify native ledger provenance, generated types, default privileges, ownership, or production equality.

All 187 identities were located uniquely in immutable `supabase/schema.sql`; its SHA256 is `b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30`. The comparator exposes changed field names and row hashes, not replay expressions. Therefore the 128 changed expression pairs have NOT been reconstructed or proved equivalent. The appendix preserves each identity and exact artifact hashes.

Independent reconstruction DID verify all 31 added `gridex_perf_authenticated_select_v1` row hashes. The exact canonical row is `{nspname: public, relname: TABLE, polname: gridex_perf_authenticated_select_v1, command: r, permissive: true, using_expression: true, check_expression: empty-string, roles: [authenticated]}`. Serialization follows `scripts/sql/gridex-db-parity-introspect.sql:78–90`, sorted JSON keys, compact separators, ASCII, then SHA256. This proves these predicates rather than inferring them from policy names.

Skill routing: bounded code-review/source-contract analysis and direct false-positive checks applied. Broad database scans, SQL optimization, UI, dependency, and application-wide audit groups do not apply to this artifact-specific disposition task. No source, database, reference, or memory mutation performed; this report is the sole repository output.

## Confirmed behavioral divergence; authorization decision still open

For the following rows let G denote the unchanged restrictive authenticated lifecycle SELECT guard: allowed session AND (platform administrator OR company_id in the caller's readable company IDs). Each table has an authenticated SELECT grant in the reference and no grant removal for authenticated in this diff. The relation RLS flags and these restrictive guards are unchanged. Thus a permissive TRUE policy changes the effective SELECT predicate to G. This is conditional predicate reasoning, not an executed actor test.

| Table | Immutable reference composition | Observed replay addition | Disposition |
| --- | --- | --- | --- |
| user_roles | Only permissive authenticated SELECT is `gridex_linter_user_roles_self_read`, requiring user_id = auth.uid(); effective predicate is self AND G | Self policy removed; hash-verified permissive TRUE SELECT added | Same-tenant non-self role rows can pass G in replay but cannot pass the reference self policy. Prioritize actor tests and explicit expected-access decision. |
| company_customer_number_sequences | No permissive SELECT policy; restrictive guards alone do not authorize authenticated reads | Hash-verified permissive TRUE SELECT added | Changes from no authenticated row visibility to G. Historical source explicitly authors tenant reads, so do not automatically revert this to the reference. |
| customer_info_request_events | Sole permissive policy is PUBLIC ALL with auth.role() = service_role; an ordinary authenticated JWT does not satisfy it | Named PUBLIC policy removed; hash-verified permissive TRUE authenticated SELECT added | Changes from service-predicate-only to lifecycle-scoped authenticated reads. Historical source also explicitly authors tenant SELECT. No blanket equivalence. |

Reference anchors: user_roles policy line 96011, SELECT grant line 117097, lifecycle guard line 107138; numbering SELECT grant line 114063, lifecycle guard line 105758; info-event PUBLIC policy line 92279, SELECT grant line 114422, lifecycle guard line 106034. Scope of the witness: valid authenticated session in an active/readable company, with a different user's user_roles row in that company. NULL company/platform rows and other-company rows need separate actor cases.

Exact replay TRUE-policy evidence:
| Table | Row SHA256 |
| --- | --- |
| company_customer_number_sequences | `d28c02075d0dfc3e4db612c2cc81b7e67a33f6aa34a417b8ab01e8e21b8629f4` |
| customer_info_request_events | `053e63723c2b5dc44ca6eddf575fa7c1bedcbc6db2810e3425b0c3654185abce` |
| user_roles | `5a98141eb2e23a874dde422b1e1aac2a58e0525cecaf42248741a960bb78b64d` |

These are confirmed differences relative to the reference, not confirmed defects against the application contract. Source intent and current app access are separate evidence:

- `20260521_batch_2b_full_automation_and_live_ops.sql:7–61` includes both user_roles and customer_info_request_events and explicitly creates PUBLIC tenant SELECT when company_id exists; the source is present in the foundation order. It is broader than user-self-only even before consolidation.
- `20260526_debug_batch_2_tenant_rbac_server_actions.sql:19–73` explicitly includes customer_info_request_events and creates tenant SELECT/INSERT/UPDATE; source SHA256 `f99af4186539ade7455e7241275339352a23c8572bda7cfd05aba987bac8c727` is pinned by the existing source manifest/repair selector.
- `20260609162000_batch_7_website_integration_foundation.sql:563–603` explicitly grants the numbering table tenant/platform reads and service operations. Its comment promises those reads. No direct application `.from('company_customer_number_sequences')` call was found in app/lib; SQL numbering functions consume it. Absence of a caller is not a prohibition on Data API access.
- `20260611190000_launch_linter_hardening_security_definer_rls.sql:43–51` separately authors user_roles self-read. Its coexistence with older broader permissive policies matters: a self-read policy does not restrict another permissive tenant-read policy.
- Current app reads inspected use `supabaseService`: `lib/auth/companyUserAccess.ts:65–83` binds company+user for active role verification; `app/admin/users/actions.ts:307–333` requires platform-admin access; `lib/rbac/getAdminUserById.ts:82–115` performs an actor-bound diagnostic RPC before the privileged role read. These paths support preserving explicit actor gates, but do not establish a documented ban on all same-tenant Data API role reads.
- `lib/onboarding/infoRequests.ts:207–235` reads info-event audit fields/payload through service access, filtered by company+customer. The stated UI purpose is showing repair/dry-run results after a platform-admin action. Other inspected info-event writes also use service access; `app/admin/customers/[id]/business-actions.ts` verifies request company ownership before writing a dry-run event. These are narrower mediated paths; they do not by themselves justify raw authenticated reads of every event payload.

## 128 changed policies

Every changed identity is `gridex_mp_*`. Only using_expression/check_expression differ: 44 change both, 44 check only, 40 using only. The role lists, commands and permissiveness are unchanged. There are 52 authenticated write policies (22 INSERT, 22 UPDATE, 8 DELETE) and 76 service_role policies (22 each SELECT/INSERT/UPDATE and 10 DELETE). No changed row is a PUBLIC-target policy and no changed authenticated SELECT row exists. This rules out a role-list widening in this subset, not predicate widening.

The source compiler `20260612143000_performance_policy_consolidation_and_index_cleanup.sql:93–280` snapshots permissive policies, expands PUBLIC to a finite current role inventory, and OR-combines old predicates per table/action/role. Names are MD5(table:action:role), not hashes of predicates; matching names prove nothing about expression equivalence. The compiler leaves restrictive policies intact and removes old permissive names after constructing replacements. Different prior source states can produce the same generated name with a different predicate.

Service-role policies must be examined with actual role attributes, role inheritance and JWT claims. Do not dismiss all 76 changes by assuming BYPASSRLS: that attribute is not part of this public-schema projection, and a role named service_role and auth.role() claims are distinct inputs. Conversely, policies alone cannot constrain a role that actually bypasses RLS. The comparison proves no changed PUBLIC role lists and no newly demonstrated cross-tenant path here. All 128 expression equivalence questions remain open.

## 59 removed policies

| Group | Count | Evidence and disposition |
| --- | --- | --- |
| gridex_db1_TABLE_{insert,select,update} | 48 on 16 tables | `03_db1_backfill_functions_rls_reports_and_finish.sql:670–735` authors PUBLIC tenant read/write policies; T55 compacts old permissive names. Added generated replacements are consistent with this path. Exact replacement unions, especially writes, remain unproved. |
| gridcore_ediel_saas_* on metering_permissions | 3 | T1 authors authenticated tenant read/write; generated replacements and a TRUE read policy exist. Check composition with unchanged restrictive lifecycle guards; no name-only acceptance. |
| ediel_send_locks_tenant_* | 3 | Reference policies target PUBLIC, not merely authenticated. Added generated/authenticated read replacements do not automatically preserve PUBLIC behavior for roles omitted from the finite compiler inventory. Tenant/source behavior remains to qualify. |
| customer_info_request_events_service_role_all | 1 | Despite its name it targets PUBLIC and tests auth.role(). Authenticated-read divergence is established above. |
| gridex_linter_user_roles_self_read | 1 | Self-read replaced by tenant lifecycle read at policy level; source/app contract unresolved above. |
| tenant_lifecycle_anon_deny_guard | 3 | auth_email_events, company_customer_number_sequences, inbound_processing_jobs. Exactly the same three tables lose all eight direct anon privileges each (24 removals). No added PUBLIC grants or changed relation RLS flags are present for them. Therefore removal alone does not establish current anonymous reachability. The exact source path removing these restrictive guards is unresolved; retain this as a defense-in-depth difference. |

The three anonymous guard removals must NOT be attributed to T55: its loop explicitly restricts itself to permissive policies. Nor does T481's dead-policy cleanup apply: it targets only grant-less supabase_privileged_role/dashboard_user/authenticator policy roles, not anon. Full effective privileges include PUBLIC and inherited role rights, which require runtime verification. Future grants could make missing guards significant.

## Selected source lineage

The actual timestamp prepare selector was run read-only and returned the following retained source identities. These are source/compiler selection evidence, not native SQL execution receipts.

| Ordinal | Source basename | SHA256 |
| --- | --- | --- |
| T1 | 20260530110000_gridcore_ediel_multitenant_foundation.sql | 2915c459e7285c8f8813483d7958f5ff5ca3fdbefd263f0062e772f8c9dcb839 |
| T51 | 20260611190000_launch_linter_hardening_security_definer_rls.sql | b696379a5e1d26bde5fae150d7c51e9d40df029a9dfd605810ad9051b1fb74d1 |
| T55 | 20260612143000_performance_policy_consolidation_and_index_cleanup.sql | ff3b3c65b97e36cb6c0bad1f25e4ff332debf3993c845c9856cf4fadea748b60 |
| T336 | 20260812210800_gridex_rls_policy_normalization_v1.sql | 2d9609109928967f571401864893a47bee1598bce8b115b5f26f3fadc236643a |
| T354 | 20260814162500_tenant_rls_lifecycle_hardening.sql | e2eee5be4e4c795380782248683bfd32b682a66b2e2882a1fd241c9acc7498b2 |
| T442 | 20260826093000_platform_dashboard_and_rls_read_performance.sql | f9084068f4eead62330b1b394b6b4cab5f47ff68b411bdb144009314c2b85a2c |
| T481 | 20260902092000_view_security_invoker_and_dead_policy_cleanup.sql | 911df38c226051d3b60726d8027f322bc566d30d72e51632b71797fb88ef0ed2 |

T354 creates restrictive lifecycle guards and removes direct access-management DML grants. T442:205–339 substitutes permissive TRUE reads only in the presence of a restrictive authenticated SELECT guard and qualifying older generated policies. Its intent is to preserve the effective predicate at that source point, not to match an externally retained snapshot built from another starting policy inventory. T336 normalizes named ALL policies and selected generated service policies. T481 explicitly excludes PUBLIC from its dead-role cleanup. None of these source comments is accepted as a proof of full role inheritance or whole-policy-set equivalence.

## Required next evidence

1. Preserve these three widening observations and obtain explicit expected authorization for ordinary member, operations/company-admin, platform-admin and service caller on the three tables. Do not narrow source-selected behavior or rewrite the reference merely to erase the diff.
2. Run fixed disposable native actor cases: own row, another user's same-company row, other company, NULL-company/global row, paused/suspended/removed membership, revoked session, and service role with actual attributes and controlled claims. Compare reference and source-selected composed policies, not isolated predicates alone. Include direct table API permission and function EXECUTE permissions.
3. Recover/reconstruct all 128 replay USING/WITH CHECK expressions and source stages; retain per-row hashes and compare effective permissive OR / restrictive AND composition. The current archive cannot supply those expression operands.
4. Explain the three missing anonymous restrictive guards using actual source execution evidence and test effective anon/PUBLIC/inherited privileges. Preserve all existing denials during any repair.
5. Native complete execution, remaining added-policy review, function helper identity/security checks, privileges, schema/types and same-head CI/E2E remain separate gates.

## Complete reviewed identity register

The following rows enumerate all requested identities. `EXPR_OPEN` means observed expression-only difference whose exact replay operands/equivalence remain unproved. `REMOVED_OPEN` means source replacement lineage was inspected but effective authorization has not been accepted. Full hashes make each observation directly addressable in the retained artifact.

### Changed policies (128)

| Table / policy | Role / command | Fields | Reference SHA256 | Replay SHA256 |
| --- | --- | --- | --- | --- |
| billing_export_run_items / gridex_mp_272d11caff54b50fd87b | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `b94dd1fef39ceb7b69bc1bcb85e51167805a13aacae06187d7c413ac32f688c2` | `f94524493700fdc320ff09faea8864fb8f5ab523edd218b08ebc14e1fd79d144` |
| billing_export_run_items / gridex_mp_36e1514ae5982ac8511e | authenticated / DELETE | EXPR_OPEN: using_expression | `a57cb49888a8774b5536173e4d579e1dad909b5aea1c300864c72b1856b79034` | `bba372703955ac2437adb4978da5ccba788442b9caff2d633878dba1244a037f` |
| billing_export_run_items / gridex_mp_39c7692b64cbd58c10c0 | authenticated / INSERT | EXPR_OPEN: check_expression | `a4d1c60113ad795f832428d61421773ce33718d76ff6141876feb9eab4210924` | `f43e10e3ede328d90466ab983594a5bb3b48a69aaf5382c3ac37ca9b587c19e6` |
| billing_export_run_items / gridex_mp_56ee286f3225e52c6dcb | service_role / INSERT | EXPR_OPEN: check_expression | `315d242f6666ff19b8a812ce1d52bcf05d2ff926c4a6fe1c7c077a0911213b25` | `d65557b93f140b39e4ece22e511a2286a935eba266b824ae89cb4c1fb1a0e6ef` |
| billing_export_run_items / gridex_mp_d31aa9ea6551524ab67d | service_role / SELECT | EXPR_OPEN: using_expression | `bfc67c2696501c2d9f80659a39ba8b0ac32785743e19af8477df994d9cd957ed` | `2cfe50eac57e45ce528f9e92d894010b3251592643c785a4176a82e439233d4e` |
| billing_export_run_items / gridex_mp_d59c429ea016cd6099a4 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `18711f705f53f63a3ce536965247a3279ed0881d717f3f857c1e828277f8632a` | `7b3364350ae245a2922829442aadd57e5bf5f342509fd1e6b3500e205d949671` |
| billing_export_run_items / gridex_mp_ef4db46263dc082e4575 | service_role / DELETE | EXPR_OPEN: using_expression | `a84bb5075704ac7bd9d849b0f99d8ba0ca872fdf407beb957150fab942726311` | `ad0fd2443c220b8093d480685dcca34a3413160fc20313e2202c32aa8ca92efb` |
| billing_export_runs / gridex_mp_3a3658b8f4a9b1be2fa0 | service_role / INSERT | EXPR_OPEN: check_expression | `5fabb01e1feae3e34ed44bb07757c2d964ba2217ab426e5a6dab12b7b0fee85a` | `ca44cf507dcc33a4e8f726715a26c774312c11280b4737995fc68d03a9648a22` |
| billing_export_runs / gridex_mp_594ba1ea269e20578a6f | service_role / SELECT | EXPR_OPEN: using_expression | `6040028865dfba116229b662067f9a2dffc87fd712721e937a9ad3fe6ebf8e8e` | `b236956f4c2b3904427afef4132ad51624920301dbe92b0b7f795dc3160c1759` |
| billing_export_runs / gridex_mp_a92d95caf038f235ad0d | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `6edd13774e8cd101a873c0681a5f712e2af75eea6fd4561f6df3f2ac103507ca` | `bbed31bdac2139323fb1f5ce764896e88244abb5f12bfd575a5ab6116f0ab336` |
| billing_export_runs / gridex_mp_ba9a6e281d0113b32dfa | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `5fafe99b50c8d24d74d31e1091436d1983851ad9ce4cf9d393c46c1061043648` | `fa4aa761bcdd88611c320e1cc050b49c74cc560025dde7cc8d6fc1e0419cf034` |
| billing_export_runs / gridex_mp_bb18366953887925861a | authenticated / INSERT | EXPR_OPEN: check_expression | `e59b3c4b0d7eb2f72a34dcbf7f830a9a81d4269d95da70b41729e3ccaffd4227` | `7a61faa9937501a7083d796b68c4562e66ea0cd3a459adfe1c62c1d7f8a404ef` |
| billing_export_runs / gridex_mp_e8d4475f627686737b07 | service_role / DELETE | EXPR_OPEN: using_expression | `7053bd7b610eab99659410308d4b55c5e41c17a475aa3dce6d71faca5ae87b6b` | `a504f6a3165f68e2bcf2607967eed07e89c0d3e580f46c081e4c0cdd9c99a5a5` |
| billing_import_batches / gridex_mp_04e1b955cda08783426a | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `a5b777a13c7ff1075b430fd91d9ffdca1a168e8fcfe96c8f55869b2839199fb8` | `b78a0255172264eab5fe1f3aa00263dc2a344014b4a2638c568bf9a46a94fd0f` |
| billing_import_batches / gridex_mp_3a28615c2138b63f131d | service_role / DELETE | EXPR_OPEN: using_expression | `bd0b39ba2135de80106d371e177141a8b7e8e4110dbc31a7d675ee6b4618a4c2` | `4aa313c4a4b7f8ee49707a9b6d8aeea2ec6b55de5e1168b669801cf3fcc4259a` |
| billing_import_batches / gridex_mp_4237711f5973ba5b1c44 | service_role / INSERT | EXPR_OPEN: check_expression | `58f54e4b0b59d5f00d90b7702b95e9e2c934f035a4ac30e65879e7f29ebe8cae` | `6940ada624c156cc141d219ba994db77a760a53032f019f063fa98b215e7cc6c` |
| billing_import_batches / gridex_mp_76cf71020b9b79fec21f | service_role / SELECT | EXPR_OPEN: using_expression | `338c4e394f3d939b0e719ba82f04bb76ba411aa7ca4aa71e2ba95873355b8b3a` | `328cca388955cb742b3109276bacb0f027d07fd0af74b99948a3e7e47654b006` |
| billing_import_rows / gridex_mp_3640130084e8e64d571c | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `c2633a1342397b87ff3718c2616a070f101bfa8807389e583a49fa603bb131f8` | `86b8e475fc71476439c7739df3c542323684b462a0f33b65c2bbc19138b3ba52` |
| billing_import_rows / gridex_mp_5edd73aadb82f0031cc2 | service_role / INSERT | EXPR_OPEN: check_expression | `4fd4123c3d1b715791048560bd755bdb2cb650b686058b8669c6d9b6ba5b8054` | `bd9f339446745c4f9118f08e68bb3acc465dc01d4c05a5c39be06756cacb142d` |
| billing_import_rows / gridex_mp_89772773851d36ad22f1 | service_role / SELECT | EXPR_OPEN: using_expression | `a19026acbc364a06983a507fa81276e3682bc576449cd356cbdc059878c9af67` | `f7b7d824e57ccad2a027df216614ac213aabf46f28d4a071e05839378de366ed` |
| billing_import_rows / gridex_mp_d1465ee870d93d91a417 | service_role / DELETE | EXPR_OPEN: using_expression | `8f3d3dc5f2d41a35efc16a203e73b0c1d19dea24f2466eba42caa3672f3bf8cf` | `2420bf3c516afada26e0d8e2adb7a4e7d1245f05593d4d393305fd5276a1bf01` |
| billing_underlays / gridex_mp_6d134064dfeb024cf146 | service_role / SELECT | EXPR_OPEN: using_expression | `2256382049a301e8a4f820842dabe753ed2762d07e808422437d0f1d1b4ac4c2` | `6849f7f7b2d3299ec7e132359268bb073866781d5d71e4acd0ab1fb2404082a6` |
| billing_underlays / gridex_mp_98c416bf579663dbb6c6 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `fa91810e4f39ea6d651c8496a3aa07f6f558ea48941f3194374b172c9c53a16f` | `6a2a213c8085c0fda6a5034d553f0fcb84d165501c59532416594cdadd99c638` |
| billing_underlays / gridex_mp_c3aee7598effd59bb69f | authenticated / INSERT | EXPR_OPEN: check_expression | `d75265fbeced44a9db1d1d7669cf2da0f279b5493e4e80e0a854877e3fbe53b7` | `1319677d0e081bb258a0954bf0340533e9ce1750a77a9da6377643061ad49980` |
| billing_underlays / gridex_mp_d0a23b23406fc12abc0a | service_role / INSERT | EXPR_OPEN: check_expression | `9fe4d9c92113c1406b1a73dcffdba0a07409d6064e9d9e5c7694e0a51ca524a9` | `9f9d6de5da4eb4b160ba487eeb8fa3b1adef632d5886d126c267256867d5a995` |
| billing_underlays / gridex_mp_f1238cf1607fbe8cc164 | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `a002515f9e996074e96f373d0e3d0f81b97b04ef11a5a90e6861f1bb298c65f5` | `75c882582f253238761d854746c251287992a4c685765c82c867074bd41c856f` |
| companies / gridex_mp_3e43a389ca086e999072 | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `1f7706e3e4020eb6eec9aca075c88a5064be32a900dc69f752311baf5ff9fcff` | `8ebaa4fa49108828467d2e16d2ad48c9cceafab0d20acc13bbdd3c9aa250d472` |
| companies / gridex_mp_8375817cf6ee114e2dc0 | service_role / SELECT | EXPR_OPEN: using_expression | `dd8677800357f2284d647025be3cadb4496369e85416104ad4500bd28e1dfd08` | `4995f88d5424e1ea8caa0c107b8716c1b7ee29f2194187ea54dc2107d93d096e` |
| companies / gridex_mp_dfed88a79cae9d173446 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `6714e69f2a599bb803cb516ba71fa8cf703ecd7172f674e9ecf688f924dc1757` | `3a1af68a2c255f9de4481bd00891d39854463c0b2f682e82b44da834949f433a` |
| companies / gridex_mp_f38f5d7eaf376691efed | service_role / INSERT | EXPR_OPEN: check_expression | `7d185ccb723154e8a3e540bffef09946f16401060f32621d70a0a52ea4b0c0bc` | `8bd7dc753f9ecd8c4bd8e146609def5b4b4240c98447817e5214e915f86458db` |
| companies / gridex_mp_fc55b7175c3951acf0a3 | authenticated / INSERT | EXPR_OPEN: check_expression | `dc80d0483497e5ee40cb70e7300301aaed821d95dd6d5ead1c347c8f2f9fcaab` | `4b4fd760d01e71c503b4ae269835b987933fac52e390c8650b6d7002180a6d79` |
| company_memberships / gridex_mp_0f75d8387f9b311a1232 | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `c17e57007d1b04485c0e717433264f21e2282427d492ac10d039796ef91fc047` | `d174d68e202c619ad4dff1a6ec8584685e24594a9af10a9875a6abd973f6e840` |
| company_memberships / gridex_mp_1d47812647d6d50abfa0 | service_role / SELECT | EXPR_OPEN: using_expression | `e5552fd40efc1e14370307e14fba9c6122dd767196720dc9cdfd2a013f15a218` | `525ec1f514d120a3818cd6de5a2f1e02c0cfab3ff146d8ef5fa8169a710d22bc` |
| company_memberships / gridex_mp_58a0211400ea417d71c4 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `def00b404d3a3d8d1a287e6b659efc214db3351e7ac12bf85425268d808d5c03` | `d4040e2bc7a6563add2a77318e98e692bd5fc931e66ad308ef3caff9a78c447c` |
| company_memberships / gridex_mp_5ad5cf7dfbb2e22fd1d8 | authenticated / INSERT | EXPR_OPEN: check_expression | `8f4ebcbfb1e14398fc6d66ce8dde650dc528c1543799663e02b64bad9014aee8` | `7d79572a8a63d52b05167a5a1cc10fc3903f1c24ece381ef05999539e1d3ac96` |
| company_memberships / gridex_mp_aefb0b5008c562e5c14b | service_role / INSERT | EXPR_OPEN: check_expression | `690381d0c19f8222dbb1d480206bb957b9dd3b458c5d39f781f79cc396679aae` | `ec62337215ea2086df7a5c36dbffb65047c4a1e3ce3fabac1af2da5bf2648c62` |
| customer_contracts / gridex_mp_3b2ae6804c3c1f2360ec | authenticated / INSERT | EXPR_OPEN: check_expression | `ceef1d4a59d9cb6d03531c4abcd58cafab66a29cbb6ec3778050f9c1d8cb1f40` | `bd524cc91d426e7bf0d7c0b5532919627b4470e4b0f13477708b39cb602002b9` |
| customer_contracts / gridex_mp_5e29c59c997bd0731aa9 | service_role / SELECT | EXPR_OPEN: using_expression | `be49c93fc683001cbbec00d4ba30e3258bc1102d78cc6c7bc4eb8cd2756992ec` | `49ec7e605de756d2f33a6c1a67304145588869c908002fd27a53496d5304460c` |
| customer_contracts / gridex_mp_b9e866773e1b5946e476 | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `367cd3fad8e51c56fd2b903b58115745d24b89f7237fac95e5deb70d8c46f56a` | `9494a878cb11677afa32867631dec394f489899923fccbd47508d492aaf1ff78` |
| customer_contracts / gridex_mp_c489f3d162d8e49f4d42 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `9c52e25c340a0706728a0d5a2dc1f15c71f4c8cae0213c2a9fcdd48f5b185d1e` | `79841415dee49b2089ec1cd8d2463c635551bfab842a01d02f0b626ce5bb5351` |
| customer_contracts / gridex_mp_cecd70b22218095bb897 | service_role / INSERT | EXPR_OPEN: check_expression | `d5ec54f29217013c87131463b65ee9a7365096ad7ed86114f31ba7d9e48cf535` | `8c0ae12ca63184376cbaef43f3d6e338139db0d0f7abbb670cbc034be43f56f1` |
| customer_info_requests / gridex_mp_036d7e0c25ac778506a7 | authenticated / INSERT | EXPR_OPEN: check_expression | `6f7401607c0dc9d235d8a0c020192d2983277ae3ee4ad9b98314d0b5e80802ca` | `eacd79d9f9d05ac1f0f9cdf24199d9508fa9bfd1bfbfb1fc1f37b7c5ae55d51c` |
| customer_info_requests / gridex_mp_196760a4b2d4ef65b748 | service_role / INSERT | EXPR_OPEN: check_expression | `c3b840faebe62a5ec7af7ed58bc4885bd748f9b64efd218695e967ebfc494fbf` | `79abc5c9843af4194ba0b8afcf78de5827b00ea8c244af0ae7615bf5e5c77a3d` |
| customer_info_requests / gridex_mp_656faa596a4c99bec656 | service_role / DELETE | EXPR_OPEN: using_expression | `92a0138b470b87c9d88cc437d68840eef47918292250a227f27140e11bdacca0` | `1030aecf885d479d86d66bf64800acc55178bc5e2ef78e9a47af5ec797cdb306` |
| customer_info_requests / gridex_mp_aa351e5f51666345295c | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `8949b0c80b09ba3b3a2d9d588c3f39dab263af1cdbc853b817b1fa83c3374622` | `356a4a51789069a43cfaa709ec0a9482b6a5c1b8c92e5e48ea61c5ddc6652931` |
| customer_info_requests / gridex_mp_ac8de61fc061e50f3a3d | service_role / SELECT | EXPR_OPEN: using_expression | `7a3f142d33a3a69836403d9013d617c32eab5633695f36583302265fec0896cb` | `0fa530a4f3961a819897dfd9e39f47f761217533c3ad0d2fdb7736d0e6699fb4` |
| customer_info_requests / gridex_mp_b79a4e89f107c77cbbbe | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `8dd0b87c264d801f34148e399e3958578c2e05bd294d19c4cda1a992d9d2b274` | `11fcae80f8e29319764786c45365fe34186f70aab27252c5977ee3ea4270a3cb` |
| customer_sites / gridex_mp_7af212387d25c3fc5702 | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `2991581f59b604c16d22e3f22caae64d9a54eadb60e7f8bff13a3ee4944602df` | `073e4e5fd7c73ae8ccaa95258a1d91a85fb713ed184cea5daa4e370306ff7516` |
| customer_sites / gridex_mp_94b28a477b4f3605ac8f | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `ad5f1f8e7208901fe26f95a46053326a057097958b3a5e5a151d887a42b34324` | `646cd555069c79f88247d2cd073d78248a8143463ba80b8fd890956875781e6a` |
| customer_sites / gridex_mp_e12eb99a28fee9d2798d | service_role / INSERT | EXPR_OPEN: check_expression | `da90b7237376d46f9909902c48ce6bd8ee003032c0600bc5940cf8ed9e9120c0` | `bb1dd7ef17f6e7533a35975cfa5fe31c7fc81e79931f41bf9a06185f2f0d16ef` |
| customer_sites / gridex_mp_e41450d799fc948805ab | authenticated / INSERT | EXPR_OPEN: check_expression | `f0c8183aecb053e62553f686cd6efdaf5a587cb430b2bb6dac9a030fb08e047c` | `25236d8b56ad3868cf27d4aaa275c43a8bf470007c0af147fdb84ec6cbcf4a19` |
| customer_sites / gridex_mp_f9570695458121c7ccff | service_role / SELECT | EXPR_OPEN: using_expression | `d2e24563306501a6f52288b9787ae51cc435833ec6b64d06382b8246a9d92265` | `d78f45f71c5a2528d3f92ec9dfba98d0fe66ba06c4e015ea9335531b1781bcae` |
| customers / gridex_mp_2f07922a7a98cae76d60 | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `84c1870a90f6846eb8e29087e87cec95e335756655ee02f5eb4a33415da22c9f` | `193706704ca3438706c069e20813848e5731a1b2041e3cdce68265ab60a7542e` |
| customers / gridex_mp_417aff396ae8f545746f | service_role / SELECT | EXPR_OPEN: using_expression | `c718df2c633c54c885827511d53ba6b2c707c7c39d8c49fe69342fb0359f1081` | `9f4cde511d03aaebc3ae8aa8cbf38eea0cbde7308da458b0feaf94c4c5dfbba4` |
| customers / gridex_mp_9f70fde0c862614112d2 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `77f917dee8004276a399528a71348787844bc129f262d828c15270453ab59253` | `145f04e4d7cdf7bdef47fc5ecc41093c322646b11deea7aafaa00c6b57d9b7c7` |
| customers / gridex_mp_a5f744341481a057ba49 | service_role / INSERT | EXPR_OPEN: check_expression | `c51d0b9aa6aa55092d38a43194c774fdb9254ff6a1a63f9f0e5eeaa3bde41eb6` | `27569cf5b1460fc5cf87417b38fd950c429411106ac32655112730fcac0e87b1` |
| customers / gridex_mp_fafefb8b50aeeb8b1d53 | authenticated / INSERT | EXPR_OPEN: check_expression | `f27eccf6b999ec101e0ade38f586c219d519e3b5ddc3f39ccbc7a2f685b863f0` | `b37702767296943e11788cfb156e46f4c0529b89fe39850843c6c5dea1847b44` |
| domain_events / gridex_mp_0bcec9548195f9f05c7f | authenticated / INSERT | EXPR_OPEN: check_expression | `340048e16c83152da3cc047bea9a47c808d8b75f5e29ef452c2a93c36904e993` | `549894dca6cca02266d8fef7068fb8c09c2d163f0f7353acf53ae3d5e74343d1` |
| domain_events / gridex_mp_5b9a1b5d553ceb0e8576 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `0c2769394d474cfe8f7e7732ebb72720fcb21da04387d61b2f0f0abfb0dcf09f` | `5e1cdedc5e410cfa7ab7e5d0a3e914c527ab43f50b1baca2bd220fa36f5c2d9b` |
| domain_events / gridex_mp_b6ea5533a57e54e1457a | authenticated / DELETE | EXPR_OPEN: using_expression | `c5898a210ddb53bde556275327c4d223e9339395092e9afa874b0b5d60bab646` | `b7aeb42e4341901904539ab2d0f50aef716cf9b60b520fd6255b11d6e56e6c35` |
| ediel_message_events / gridex_mp_06ed90e240b7406afdaf | service_role / INSERT | EXPR_OPEN: check_expression | `b4f704c6886aa409c97cbc65f166f80a07c858fb60fbb958b36776c044c1c86c` | `649ec2f21361c76153be9588bd0aa0b48138bd44488a19e174959f844a9c3301` |
| ediel_message_events / gridex_mp_2b5aaae6a5f88afd1b74 | authenticated / INSERT | EXPR_OPEN: check_expression | `e1c9dcd7d0f5b51e9fdb4fe7c2a1dee25a0f466216be15884daeaa37619ddc9a` | `e4ee4aca8d579a3595f9dda3ff039882382a05a8c038c2e4fb7ed31df2b2bc00` |
| ediel_message_events / gridex_mp_71746aea63ee7dc59fd4 | service_role / SELECT | EXPR_OPEN: using_expression | `77d8e6366f914768a6482d39881fe3cc7c27df45d60060cea0722a2af3c43e8b` | `d1c74983603ae4915d513b433bcc0276f1d70cc60cc1f047e2f32f031a3c9872` |
| ediel_message_events / gridex_mp_8f81fc0a90406e7bb3ba | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `156d65a1bba2b1c6870b4efd4c65256a3f5d303eb524e6098e3ea637354c6e18` | `01c176d5d402ff90b00836961e687a7f79dc6f578525d6b60f4c218e7a772e31` |
| ediel_message_events / gridex_mp_fe48f5e50207a46cc0c5 | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `a2f9b240b65b187899d517e06a2c9b8644caf21178c5f8afafff709ad5748658` | `bdfa87133f05c6ed47cea5911c8e1b6a8bb10000fa99f5b7448c4ac87e5d0312` |
| ediel_messages / gridex_mp_25f5ae9b1b728ba7cc8b | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `101b939665663ee2d8a1ae36c19ff69764e624470bbc6eff157fe1f12b7e6f55` | `3f9a41198eabfe5b3f723fd735605b038fa76a194b2fc42979605eea72052897` |
| ediel_messages / gridex_mp_48d4153ddd8be07b99c5 | service_role / SELECT | EXPR_OPEN: using_expression | `dace641ee6359170b3a306debaf1bed25d9700c59fa53cdc01ebc363082e62f0` | `948fa5d3d2f043ee9fa6931330627d78f524a82bdf51a6dae1025c55ea28c794` |
| ediel_messages / gridex_mp_7bd821a0c63bef93248d | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `32da64411eeda13fbe4403a9a4232085daf5e43ce3140580ecc1c0219b822f91` | `3c56fbdf4c5a650a844c4c0819a8d3974ae6fc6953ce05ed72ef4c49e6cb9ba9` |
| ediel_messages / gridex_mp_82736c4aec9a2b5c4b18 | service_role / INSERT | EXPR_OPEN: check_expression | `32e49096a31c16afe174d51518062a2f0e2716a89bd70b085b3b12ec15c9f95b` | `b729f53f24f52a9e294a57dc46b88c52dab42cb108188e6d65b0b3a24a13ef6f` |
| ediel_messages / gridex_mp_a2f857be40f1e68ceb6e | authenticated / INSERT | EXPR_OPEN: check_expression | `54be2c62a23aa67037f564ba0699b478745a68d0150f6b85d0974d4244616360` | `2e1f63cc85684c67607cb9d87b403a750f71f8a9fbe5bd8bf02dd56a4812f99b` |
| integration_api_clients / gridex_mp_181517a66560cb3a31ec | authenticated / INSERT | EXPR_OPEN: check_expression | `05f4ac9dd3718c1760c08d30da32210cecc28e9affd6b0971600da1a49ac6a4c` | `4a30f21bf725a1ce4dae9ca5ed07646cb95db83d4e4bc0786e1bc89a4e3baf56` |
| integration_api_clients / gridex_mp_3377a6c54ce85f752628 | service_role / SELECT | EXPR_OPEN: using_expression | `e46920c3eb74a24ebdb3285de277befcf367a08e17d31f593a736312bc304489` | `8ec71a5b2961a8eff1b2989a48c868eb40fba4d9d0e857cbeacf99443af3b21b` |
| integration_api_clients / gridex_mp_837e503fb4ed5e53b356 | service_role / DELETE | EXPR_OPEN: using_expression | `0d862799cfaceb2641ddd5f4acd8dbc3d1a74b978b88f2083f2d993b071c7bf9` | `d8eff3adfc4e893774aa59f5991e087abf4a588ccc0b52740022fc3b881807ae` |
| integration_api_clients / gridex_mp_8f8d1b59cb3063524f1f | service_role / INSERT | EXPR_OPEN: check_expression | `8b0fbe2c4c7d7df7223b8b54b3a0c5272d178d730a6e6b15e7cbb57fa0aeb9f5` | `0e372241678986ccf65a4f881a5e820ae6cb0139e69d6085eb24fdf36b96503d` |
| integration_api_clients / gridex_mp_b7f0b8763f55f22c4605 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `b247ecb9ff84aca13a2bfd508feba85c6fdb20ae077239a2a22bfc39a6f456cd` | `a31899e094c6b83bc85bd0e3c60e33dda4d9e8d99d310de3981b527f06df27b3` |
| integration_api_clients / gridex_mp_c356aa39390f794620bd | authenticated / DELETE | EXPR_OPEN: using_expression | `038f89fed44d8d5c0ce2b41c1a53e156cfaaf1f2a234713a44d5f6a980b4ed16` | `e220f985a416a6c7982ce2e7531b44864bcef015c527d9780d873e22f3f34505` |
| integration_api_clients / gridex_mp_e4736a07282a1588cca2 | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `8dbbf1339c44a15cb064414d2f37c437c8a4bfff2662cbb47dcd954efb36fc79` | `19aa8989f03a3390e3cd31215af90276e0e49e9792a6b18f97655c5ba946339e` |
| integration_api_requests / gridex_mp_1814de05eac768a9431c | service_role / INSERT | EXPR_OPEN: check_expression | `0aadc01c4d4d52baca23850851288a9029356e65acf1166823b1e69e4cda84e7` | `3922f560d67f2b62d095609d335637349682fdd50071ccd84a8ce7fd7d8af6a9` |
| integration_api_requests / gridex_mp_2180a19ce7c5433c21d2 | authenticated / DELETE | EXPR_OPEN: using_expression | `5b45220ccc87730bdbdb96c55c6a480d4093c0981885f98c9d6d1fae49f2ca70` | `160f8407aac806b0dae1f3a940c09bf41373c90d60052a3948fd77bce5aa3cf2` |
| integration_api_requests / gridex_mp_34a704f1d479be13b06d | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `f3e325b6ce3711157dc8f54966020457b6d6ccf4df33b194d671be90456335bb` | `2d49ac3a4e08793fc3082e7f26398e7e7d4204ec7d0f36fc8a29064c8962ac0a` |
| integration_api_requests / gridex_mp_3d9b8785d4cdf7d9fbc9 | service_role / SELECT | EXPR_OPEN: using_expression | `05392c2e29195aa187aeb9898d2e7363c038eee984d294774b3110118dc6c89d` | `5d278b78148c8b9a935456b290f2088086d553054bd3a1886c2eaae52914fcf9` |
| integration_api_requests / gridex_mp_4d6485d44d84437e0144 | authenticated / INSERT | EXPR_OPEN: check_expression | `3a0c5b4fe934caecf9eca1b53053d3e6b1cf1feb8843d0cdb94c4de6144f94fc` | `eb12ed809de6bd68f85045e4f912a91883eef9872dc2dc6df49f3f7035ba2ad1` |
| integration_api_requests / gridex_mp_5d047929ee49ed9e46f1 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `eaa1ea637eed18c382643f8318f5e87518066eb4a142cd3c10cc7ab833d88181` | `50dc239a5e84426099459a96549b15495b32ba646ddc7c48054500a0d97c88e8` |
| integration_api_requests / gridex_mp_ebbfac3259de38e5e497 | service_role / DELETE | EXPR_OPEN: using_expression | `d742d1dc78f99d37f0baf60b7eb84b41173736fddd55b4a98c02294cf166242b` | `c906c7d67b6973304c96c099f283cba3e37461a4ea829824e391f0fece184a53` |
| metering_points / gridex_mp_2b582b6d624222a37d35 | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `c980fd92c1e2a0f58f2b6b3265c8839609fe65161f69b8a9a6d2fc236640c644` | `4219db244a72e73690725f5b74ba541bc559f79dba21e21fafd5975a70763d40` |
| metering_points / gridex_mp_a453fc79e2169d72710a | authenticated / INSERT | EXPR_OPEN: check_expression | `3b748036d8ff228b04b853ec3de7dbb2e1c4891350b0664454047adeda6cb517` | `1c7191bf4a226702cadde8370cea15c709a55bfcab48543aa42fc029032eaaf4` |
| metering_points / gridex_mp_a98f13fb311cdd9153b7 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `2c7fa000dd9de96c304a3c9dc6e3f10dfb36e298a1d985c6aa63278ee0a0a654` | `ca6385d6a0db79aea394242a7fc714228a520be5ff343fe6ec3eec66868a13cd` |
| metering_points / gridex_mp_b2b2058c0bddb65ed6ae | service_role / INSERT | EXPR_OPEN: check_expression | `438e17da59d49dab0396c41edea2caa378a7d545d9799e57879e76d108241d7d` | `f70262b5d7fe47ff68447d20c77408205d819af23d9fe6cb7f6ea03e4bd75a51` |
| metering_points / gridex_mp_f18c838347054655c5f1 | service_role / SELECT | EXPR_OPEN: using_expression | `d2f94335bc0cf9a40d42f1f5907041beda4b6e232ed31b792336def1524a6967` | `972d74c304589d4601d0f9070cd654a5d36f4eb7252c04a6877b49e0b1f59681` |
| metering_values / gridex_mp_0f867c6e0aa1ab45af28 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `7c4ab4b8ed47fecf6adba36834a32d7ebf0e80d9b41a543b86d2056007ee018c` | `f4d7a3dc6e4f3d52c7fbe01dbf2c6f4a689379f08ac6cf919d19eb6bacd4fa2b` |
| metering_values / gridex_mp_513497b40c59479b4f38 | authenticated / DELETE | EXPR_OPEN: using_expression | `68fa6159c9c36841dad2addd11f6321901c27f2d3e21d7c355b510f824544f69` | `3b8a7c1a0b106f785e8bba83c1512bf24596fac2c0d65faae15bd344e02a0833` |
| metering_values / gridex_mp_7459d8d4221467a1bee7 | authenticated / INSERT | EXPR_OPEN: check_expression | `d1ee36d00b8bd9fa20e4a9f4ee2104060a87a5a384a57863afaedd60cfe8db89` | `7f32b9e2f1ff9bf2514a746df3c249f423e47cc6b2ddf6a01948c2118e989420` |
| metering_values / gridex_mp_b0bb848d09465e4eb6f1 | service_role / DELETE | EXPR_OPEN: using_expression | `2428352f3fbf8f552805be14d56ef2b3aba768aa109fad8fd6ef034b4358170d` | `b81ab97b4494384aaddaa287c9af83fd2c969a1847a91f3303d8571586c71f78` |
| metering_values / gridex_mp_ba82ee77918fc722e2b8 | service_role / INSERT | EXPR_OPEN: check_expression | `499e5a2a3ae77b676bd1e44a3343d8b92574ef4512a36b3e3bef1e30ba9aa16f` | `41e48f46b1b50bcedf1c03a02f02f2a3587eaa1a23e224cc1f034a72bafda2dc` |
| metering_values / gridex_mp_c0ebb4512308e76e83d7 | service_role / SELECT | EXPR_OPEN: using_expression | `8b9556eaae1bb8fe87d5e78002fed482f5584500ca7de8bfd4e0df77c080ee38` | `00ff4cf91b99b3cc3321fd630e7e64c197c1ef4028a42e933320c2dab8dcc6ff` |
| metering_values / gridex_mp_e32113a00f03f01a51d7 | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `b3146ef90888bb6c5e461ef53cded75f54097385d7c28964624f44ecf1e749f8` | `e81d127b510bb53b13139e03bc287398cb796f1da81d008e893f95c685b5a4bc` |
| powers_of_attorney / gridex_mp_24851d20c03e49a78e72 | authenticated / INSERT | EXPR_OPEN: check_expression | `fe948a0583cf5d3089c31c157baf3ae28223d8d0180521cbe9cc644d9750fa2f` | `57bbb50398bbc02ddca7ebb1c35dda6bcff401f3ff688be62298b49734d18ad2` |
| powers_of_attorney / gridex_mp_3bc58abc6ac2e7c2dca2 | service_role / SELECT | EXPR_OPEN: using_expression | `3676ce3c636c9ec3faa8e1122f4946edeb43b6ac0ee7408aecfef5a24854dbfa` | `45048c7f3069c7fee1f53f67ed704f79903d9133d67558832d61578fd0e18b8f` |
| powers_of_attorney / gridex_mp_74b533756704b3f7d971 | service_role / INSERT | EXPR_OPEN: check_expression | `3476d007bcb3f9eb9ea2aca43495676cd569638d25b8f1502652fe84b64ce0f5` | `82453320cb6965f7df1073884eaca1f59a23a1f08882eba27b2babb3684d45f2` |
| powers_of_attorney / gridex_mp_9e0c789e033fff2e438e | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `96363ef555f80c76c878e3c36c71b2380d2e95d43ff723033095bf62eff6e7d9` | `3ff9cf6ddc730b3326400670df44a7c1994c2b8a920f06c99f4820f1670c807c` |
| powers_of_attorney / gridex_mp_f95b28fc8e3f41deb0b5 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `e6204f8e058e9bc2ada580ac8602dbb671db737b2280c5703c3b526fadf57024` | `4dacb10716bc62ef54889518458c24c9e93de78cfaa683b588f2bb9adf31b302` |
| supplier_switch_events / gridex_mp_3c28bd33d90b370fcc3d | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `76feba73e7699a4028e70f676a4c14a51accc95bbcd5af2874cf311d5e549935` | `f580c360f35496fed6414d8fbbc4ea1de12c0cced36cfb7e9a3c0e4554242e93` |
| supplier_switch_events / gridex_mp_62dd0779dead0b1e10f5 | authenticated / DELETE | EXPR_OPEN: using_expression | `4f444c34b68cf0614be9900e91731e77c216f47fafd0dc6e25255dd4e55159d7` | `566f2104bc2ae532c93a9dec17828229ad502cecfed2bd19b0e89523170c40fe` |
| supplier_switch_events / gridex_mp_6c709f05968e329ffa28 | service_role / DELETE | EXPR_OPEN: using_expression | `dd7cf3aa6ea797ba08487bb2110ecd1e372eb0b1b0a1ce20ca0e5f2a1fca886f` | `4d6b503fe641a2637f234a662030c53a88f015b65f9b06c81a588c40b4c6e9f2` |
| supplier_switch_events / gridex_mp_887de2d44e7b19d8912e | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `1eb00bf0b0a36ccfd2af9da2eb88f244a33896f486d6c2b947edb35df15ac1f3` | `ab52cb700c163c1269dcfde79c2c47d0421c857f8eb94024104eae166f03ef9e` |
| supplier_switch_events / gridex_mp_9e14f3615d2d985997bc | service_role / INSERT | EXPR_OPEN: check_expression | `402ca3c744471a7fd4f3b76dc68ae435a8a7ac6eecbf0b1a4afe1eae99d1a4bd` | `ad8c168ff9db3175e9b75ac98312ecf5c892a41b98db7812af876431bb0911d9` |
| supplier_switch_events / gridex_mp_d5aa89e7d3c29d03e72b | authenticated / INSERT | EXPR_OPEN: check_expression | `b7edc1c6b88956ea9bda47c27d432e1a0a7b82ad6e3c5d0c9fe029ca7f0fdd03` | `be279899a2de25f9d31e776f7fb7db86931821da46906b97b9289101543582d8` |
| supplier_switch_events / gridex_mp_f9de01877d954ff67716 | service_role / SELECT | EXPR_OPEN: using_expression | `62078d44ed4290f74e6a21cbd5e6200756f06f95048ad7230d04746244b7b067` | `fdafea2809da735e0dc09931d9eb83734123a11289dc270a23931d4b543a2d4d` |
| supplier_switch_requests / gridex_mp_248261c85c2e88c18d12 | service_role / SELECT | EXPR_OPEN: using_expression | `3e96c071ccf48f2dea547719c8d1713a8c49af68cd25346cb7b0f21241263fba` | `1402e1db5124b022a213cfd031663e97496e6fb046066a8521028eeb7a8f5751` |
| supplier_switch_requests / gridex_mp_779ccf817e9e70313560 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `f7238073a1085a24d3819a57b1800f94a6589b584db412132d868fbf2db840d5` | `4b64c9cb3c03eacd0ad4bc72ef2806d1e28d71fc6f1b9363ad49f37daea2ff72` |
| supplier_switch_requests / gridex_mp_b661dee3e450aa874a7b | service_role / INSERT | EXPR_OPEN: check_expression | `bf73e3c9f8d18df8b2f653c9404235d6257a081a88a1b9491e3018cf64957c2b` | `402adb26b1906570c3a0b901d051515459322b710ff2491de1a14030584abc15` |
| supplier_switch_requests / gridex_mp_c8519ae05e83e7829c74 | authenticated / INSERT | EXPR_OPEN: check_expression | `86571e29818e23a25e5a8b2d5fec1a96d37c093df8d7a2a512543045b7765c3d` | `67ce788fff88250999b7ce4bcdc488a629e989e1d0b1d8469d0a539ac256f874` |
| supplier_switch_requests / gridex_mp_de4b4ef296fb8f2d2260 | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `1f841959bf3b752ca3fadf2ea058c750d9c50e71f1ea18aefbd8466ebbc55e53` | `4759e1575899d554c4d8e94505456248876124e8038dbc1927c008cbf8f5f665` |
| user_permission_overrides / gridex_mp_010d8bdf326d05b94c22 | authenticated / INSERT | EXPR_OPEN: check_expression | `a13b721ebd8274e0e728019cf7c60be0c8e8dc2896b7580370e861275714c91a` | `cf2e1d59daecfe9b20a76c6ea8d8ec4985f95e674db2c136963722d1906fceb3` |
| user_permission_overrides / gridex_mp_275c56e6aea033404306 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `6e7920685b01e36c387b9e2dce5b00b5bd3667bd239d2c333ab34c6423fcbbca` | `c2f75c1d97f86bb4dc8619afabe18c2d3ca72bdd4a10f5e34ea8f121d6812b0c` |
| user_permission_overrides / gridex_mp_8db48f3295d06cfde4c0 | service_role / SELECT | EXPR_OPEN: using_expression | `c02c790bff66ab65dfb8085395616a39edad74de52420be1691714498f78808d` | `8089b4fa16955553f15bcff551df041d8fdc1793e7953f34593dfdc87fe8ba47` |
| user_permission_overrides / gridex_mp_f05dd8c187305dd0f42c | service_role / INSERT | EXPR_OPEN: check_expression | `38a98f1c6022c4a3d06c234473ab2774bcea45b3f13de8a868b0ddc497d7271f` | `06382a0c5a5f67d52789c195fe480dc4922bab65e55d528bf2e2ec9b6586dff6` |
| user_permission_overrides / gridex_mp_f6e2038b8dd520929aaa | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `848afaf9a70264b9f8eef74be7573e2ee97469ea9b2a6de8dd1d03b8befae258` | `07263a95cf23f60b898fa16f7656f4be76c2021432bd24ce19f35a7473f6d989` |
| webhook_deliveries / gridex_mp_a6186c6d84748c343933 | authenticated / INSERT | EXPR_OPEN: check_expression | `fb5a5bfce3fe65972aba953286ab52e03ad92b60c824d907bf4e537f4373d167` | `1f9f88b55493093938df8e12fb83187647928514d1aa57506b9d4adbae2e7ab7` |
| webhook_deliveries / gridex_mp_d908d1f170fafa864d90 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `5c2324f5f497ef9976cb23174d17bc0c852ab37c141d53230280927750f040e1` | `6c8d322b80a0c9c36493cef4027a5be88d4f9b839b9d570057ac60fc784e3811` |
| webhook_deliveries / gridex_mp_f5b79b50996a4f74e82f | authenticated / DELETE | EXPR_OPEN: using_expression | `cd92cfefe1da83b041ee9a77fe5b1695b90b2345176e179d7c957f6577c85acc` | `cb889a98f6b11a4525c256bfcfeb913ea37d0e59c7c1d1a7813cee0cf0a5015d` |
| webhook_subscriptions / gridex_mp_20952a53bdccf403c6ea | service_role / UPDATE | EXPR_OPEN: check_expression, using_expression | `5fec5212df4a80f3498e8e1e90550343c269482b702206afcc784fec8e50bd2d` | `6404a3478dfb005a8a5dbec2068003e1f061e29cdf1246732f527927f101494c` |
| webhook_subscriptions / gridex_mp_61a89f96fc15e228d9e5 | service_role / SELECT | EXPR_OPEN: using_expression | `9691996b748cb88c593d7c12d4e2033aa34298269efc8cf43f027c8d934d013f` | `a6a8f55254d73e3a59e33eeec0fad62527b56ee30a4a89c59f68aa8b199d863d` |
| webhook_subscriptions / gridex_mp_61fa75b827de5883b6de | service_role / DELETE | EXPR_OPEN: using_expression | `6571d0bf765d875a5811c170e5c96e2ec3c5050acf44b7d5d24201690d1d2d7b` | `87639c01cf0931e02e62493fd89219b8f731d421962749e19cca913971cb8318` |
| webhook_subscriptions / gridex_mp_9009f6634179599200f4 | authenticated / INSERT | EXPR_OPEN: check_expression | `23b3fdff6f70ed838653510dfeb14e474a5d2753d38c06803ae8d503793cb528` | `13063ccfe835f06d40dfba6596f704d2bd36d39f61f9712ce55423a8e9d695c2` |
| webhook_subscriptions / gridex_mp_95f845fafda898240c89 | authenticated / UPDATE | EXPR_OPEN: check_expression, using_expression | `6069ae57e3ce769f2cc25451662d21243f6d3dd801f1f972941cba16e35d36ef` | `775b033218870c6ca5520c99d80c73252d36a41692790f3c8acee1148111d8bb` |
| webhook_subscriptions / gridex_mp_afbfa1ccefa6c6bc8e0c | service_role / INSERT | EXPR_OPEN: check_expression | `af3543978e286829fdc1444ab8d49d29a8e5b4a2e95e50614b9d42205524abb6` | `9dd14ee5973d3e2b3a16551f42f85c12f58991d6c74d4cab67babd7cc02da3c4` |
| webhook_subscriptions / gridex_mp_bdd1fa8bf3345f1741d3 | authenticated / DELETE | EXPR_OPEN: using_expression | `3d4a31c2559eca6ce5fd1488b8a60b1157b627dbbcb53ae0ef4ba1e42560b179` | `d1b139751b8fa6103897a49c1b4b627c7a3efdca39f9451f6318429a25daaf47` |

### Removed policies (59)

| Table / policy | Reference role / command | Reference line | Reference SHA256 |
| --- | --- | --- | --- |
| audit_logs / gridex_db1_audit_logs_insert | PUBLIC / INSERT; REMOVED_OPEN | 94661 | `36efd16219991af3f053e98fa2dd7de874ab68cb26922359a3a2d911323e0398` |
| audit_logs / gridex_db1_audit_logs_select | PUBLIC / SELECT; REMOVED_OPEN | 94667 | `5bcfd449b0839ee50b59ea22a8e5d681fbee8bb969da984e1671ee8e8f50528e` |
| audit_logs / gridex_db1_audit_logs_update | PUBLIC / UPDATE; REMOVED_OPEN | 94673 | `f4fb8dd837a0872888729a29e2721175dea87ac68603a8f7b77dfd9388318b3c` |
| auth_email_events / tenant_lifecycle_anon_deny_guard | anon / ALL; REMOVED_OPEN | 101942 | `ea105274560d91cd5e5fc6916ebf7be595cbce1ba84609a38811e8c97d3c8f77` |
| communication_routes / gridex_db1_communication_routes_insert | PUBLIC / INSERT; REMOVED_OPEN | 94733 | `a07320650cd1b2564dbcfc95de7ecd744cbe42d180ed6a89ec52edc51a52bdd6` |
| communication_routes / gridex_db1_communication_routes_select | PUBLIC / SELECT; REMOVED_OPEN | 94739 | `68267560b2e65794581300176adaa4063128302c57fe5aa01f7056a7dd784153` |
| communication_routes / gridex_db1_communication_routes_update | PUBLIC / UPDATE; REMOVED_OPEN | 94745 | `2de5511131e354bec55b9e6ceef483d77d88260a60235410450ebc456f7b5573` |
| company_customer_number_sequences / tenant_lifecycle_anon_deny_guard | anon / ALL; REMOVED_OPEN | 101972 | `8e57f1fa14531db174cefadbf80b394fd1f74fd11661f280e92fa58e54ee0a75` |
| company_invitations / gridex_db1_company_invitations_insert | PUBLIC / INSERT; REMOVED_OPEN | 94751 | `4ae008556e49ab953eb98d1781f72fd42205c33b4ca63ab5b8fa0ab07eb9c254` |
| company_invitations / gridex_db1_company_invitations_select | PUBLIC / SELECT; REMOVED_OPEN | 94757 | `bb4c611c079bcc74c54da4ee1acef22899f3454ed7a9748e3eab7f8b482626ce` |
| company_invitations / gridex_db1_company_invitations_update | PUBLIC / UPDATE; REMOVED_OPEN | 94763 | `f6280a3ef4992d59a12cc748a3607a77c19cd8157c3f3e1779b2b0989414381f` |
| customer_addresses / gridex_db1_customer_addresses_insert | PUBLIC / INSERT; REMOVED_OPEN | 94769 | `2cab5768f3f9786292d9c38788238ff6358b104247b2a07995c6afaa5c31c7e7` |
| customer_addresses / gridex_db1_customer_addresses_select | PUBLIC / SELECT; REMOVED_OPEN | 94775 | `ab04748b6017ade1d771a24a7fd7b2f1620d3af8183c3afa3e1c4c719ead621d` |
| customer_addresses / gridex_db1_customer_addresses_update | PUBLIC / UPDATE; REMOVED_OPEN | 94781 | `1154dc7e68a2d9f35591768ee9ac57ab6e221a8923767f204a6a3c56d6ee0617` |
| customer_authorization_documents / gridex_db1_customer_authorization_documents_insert | PUBLIC / INSERT; REMOVED_OPEN | 94787 | `ac609e1c3e1bfafa61ef6db8617d4c9739ab281013f8f51ff69e2ddbd8d7fe8e` |
| customer_authorization_documents / gridex_db1_customer_authorization_documents_select | PUBLIC / SELECT; REMOVED_OPEN | 94793 | `18f3209809722287d1607058cb8e973562e8d0cb681fe6532294ae3da73c3646` |
| customer_authorization_documents / gridex_db1_customer_authorization_documents_update | PUBLIC / UPDATE; REMOVED_OPEN | 94799 | `654c3fefec9070cd8a98ee9c24ea64f11b64b6beb922a3a115824f17de95a5eb` |
| customer_contacts / gridex_db1_customer_contacts_insert | PUBLIC / INSERT; REMOVED_OPEN | 94805 | `8f72e02fa4167289314972ee6230310d341c59923559a35f59b082b8fe7d7724` |
| customer_contacts / gridex_db1_customer_contacts_select | PUBLIC / SELECT; REMOVED_OPEN | 94811 | `0ed005e25898f98d7b3cb3cb9d03c635dc8aafc5c6e36c1f0f304a00f0e18a7f` |
| customer_contacts / gridex_db1_customer_contacts_update | PUBLIC / UPDATE; REMOVED_OPEN | 94817 | `86148ca6cee1f1bd74f7bc962cde74fbd975c8056d30fab47a66a8369d7682ce` |
| customer_contract_events / gridex_db1_customer_contract_events_insert | PUBLIC / INSERT; REMOVED_OPEN | 94823 | `b14d2606375fcd19b8b5f67f0fa8459a70a2c99212c30b4f6f26c6dd74e9b6f3` |
| customer_contract_events / gridex_db1_customer_contract_events_select | PUBLIC / SELECT; REMOVED_OPEN | 94829 | `c6e391f4d8027a29bd948b2c28eece57f0b0520a71c7801744027888ee8e3fbc` |
| customer_contract_events / gridex_db1_customer_contract_events_update | PUBLIC / UPDATE; REMOVED_OPEN | 94835 | `0870407dcc4b044e4ec4996d9173671fac25a25a72102e92b3ab8067786483d1` |
| customer_documents / gridex_db1_customer_documents_insert | PUBLIC / INSERT; REMOVED_OPEN | 94841 | `64801acd7614df4db81d5694247cc53fa70ec41416301de51e0872ec65a90941` |
| customer_documents / gridex_db1_customer_documents_select | PUBLIC / SELECT; REMOVED_OPEN | 94847 | `ae26f1476b68242451fc170efeef4a210b6aafe87e0b64a62916a51643464aef` |
| customer_documents / gridex_db1_customer_documents_update | PUBLIC / UPDATE; REMOVED_OPEN | 94853 | `883c6730920db64dbf877720364069f064635b3175e67177866d2574cd37ca8f` |
| customer_info_request_events / customer_info_request_events_service_role_all | PUBLIC / ALL; REMOVED_OPEN | 92279 | `9ee6578a45e420f73d3a0477f452b331d8ac558ab9a6ac1dd6aa4b65fd4536ad` |
| customer_internal_notes / gridex_db1_customer_internal_notes_insert | PUBLIC / INSERT; REMOVED_OPEN | 94859 | `aec699ad194f37fafaf27d42bf77db28bb25e08e3d192d29496b63817dc943b0` |
| customer_internal_notes / gridex_db1_customer_internal_notes_select | PUBLIC / SELECT; REMOVED_OPEN | 94865 | `a6575ba7af16a60011743762bae463796801ee78a10a284d550f10df8281cf44` |
| customer_internal_notes / gridex_db1_customer_internal_notes_update | PUBLIC / UPDATE; REMOVED_OPEN | 94871 | `52094d934d301ac9cbcfbb2bd0a3d2b3d7db80fb62d1d32074f7c1ede0d04a91` |
| customer_operation_tasks / gridex_db1_customer_operation_tasks_insert | PUBLIC / INSERT; REMOVED_OPEN | 94931 | `cd525e6d59072129d3a5391e8c1e4db325b6f4fc3d55aaeee0a46d5f5ca30155` |
| customer_operation_tasks / gridex_db1_customer_operation_tasks_select | PUBLIC / SELECT; REMOVED_OPEN | 94937 | `bfed613b2fe3594874df16d6fa7b55502937c2214f3b3c5dc075a9c9f115b3dd` |
| customer_operation_tasks / gridex_db1_customer_operation_tasks_update | PUBLIC / UPDATE; REMOVED_OPEN | 94943 | `a382060b39fb676083d478e38d29d21dc1be4e7414f30fadacc63450e8ba34cf` |
| ediel_actor_settings / gridex_db1_ediel_actor_settings_insert | PUBLIC / INSERT; REMOVED_OPEN | 95039 | `d18eccdcd71b8f5ba0486eecfd79d64e5204948aeaa3ee699d020d2264f85266` |
| ediel_actor_settings / gridex_db1_ediel_actor_settings_select | PUBLIC / SELECT; REMOVED_OPEN | 95045 | `82afd4049a21bb170ce871dc8ded0a8a13267ac14e0baf3f803119b0b76ccd83` |
| ediel_actor_settings / gridex_db1_ediel_actor_settings_update | PUBLIC / UPDATE; REMOVED_OPEN | 95051 | `ea7b33d864b3fa7a6a8ac2310aaac114a883ba83ec82489e42ff9a580e240623` |
| ediel_route_profiles / gridex_db1_ediel_route_profiles_insert | PUBLIC / INSERT; REMOVED_OPEN | 95147 | `60bd15b1959cfe1fb07fe46936b7af9c97ed8dc0722dfac163b0ec745faddd65` |
| ediel_route_profiles / gridex_db1_ediel_route_profiles_select | PUBLIC / SELECT; REMOVED_OPEN | 95153 | `a88d12b13d746164f864b0d4e0d192cac8c21bb531d7ffc7d45f7aac19825db0` |
| ediel_route_profiles / gridex_db1_ediel_route_profiles_update | PUBLIC / UPDATE; REMOVED_OPEN | 95159 | `b0d6dedfb87653760678f6c29c40047fcf70b3b8207a98a39054828ebdaed94c` |
| ediel_send_locks / ediel_send_locks_tenant_insert | PUBLIC / INSERT; REMOVED_OPEN | 93875 | `eb69367b09a74f4139db6708887dd1cb036cfec8e837090bb33ed7325d297555` |
| ediel_send_locks / ediel_send_locks_tenant_select | PUBLIC / SELECT; REMOVED_OPEN | 93881 | `0648f8a28808b829dd9f1644e2194b6040944ca126f5a9ec7c80a6372bf01719` |
| ediel_send_locks / ediel_send_locks_tenant_update | PUBLIC / UPDATE; REMOVED_OPEN | 93887 | `5ff2ef0d3b125d846d6287358bbe5426db2b1abd8cced6887ac8e011808564cd` |
| grid_owner_data_requests / gridex_db1_grid_owner_data_requests_insert | PUBLIC / INSERT; REMOVED_OPEN | 95183 | `7e5328b27343810ddcb8b052b3feae1b432a037a9ced20a47cf9a8f589225c40` |
| grid_owner_data_requests / gridex_db1_grid_owner_data_requests_select | PUBLIC / SELECT; REMOVED_OPEN | 95189 | `4e933b28e6c2bbbabaa851e4335be91e0391067b43ecb37fdee3537b6741f487` |
| grid_owner_data_requests / gridex_db1_grid_owner_data_requests_update | PUBLIC / UPDATE; REMOVED_OPEN | 95195 | `8bf41b598544cf93eebca1614961988692de569b24c137efe286323ca51f94ae` |
| inbound_processing_jobs / tenant_lifecycle_anon_deny_guard | anon / ALL; REMOVED_OPEN | 102104 | `38a252528a95dc93a3630f9bedf037747ccf7de64b2418a52307375c1f1983b4` |
| metering_permissions / gridcore_ediel_saas_insert_metering_permissions | authenticated / INSERT; REMOVED_OPEN | 94391 | `fcae4d05312bb7d77d785f84ac1d80594d34daa3a9a675b34cfc82394951a75b` |
| metering_permissions / gridcore_ediel_saas_select_metering_permissions | authenticated / SELECT; REMOVED_OPEN | 94421 | `c6f7fe6dda85b9a6c3b9afce8791ac1a10c6c37a16ab9eaa2c466cfaf1f5fc17` |
| metering_permissions / gridcore_ediel_saas_update_metering_permissions | authenticated / UPDATE; REMOVED_OPEN | 94451 | `cfb9e52deec49b44e002aa80751676b74a2e80287dde672bdd02f0098cc23418` |
| outbound_dispatch_events / gridex_db1_outbound_dispatch_events_insert | PUBLIC / INSERT; REMOVED_OPEN | 95201 | `ba3b1de771b6a4636995f70e268afeec93708e7c47dfbbeeb32a2a4a876005fa` |
| outbound_dispatch_events / gridex_db1_outbound_dispatch_events_select | PUBLIC / SELECT; REMOVED_OPEN | 95207 | `0b402901cd04fdf78c21507e3f1593391c4ecdab0cfef3edc272cc7b2fa44d35` |
| outbound_dispatch_events / gridex_db1_outbound_dispatch_events_update | PUBLIC / UPDATE; REMOVED_OPEN | 95213 | `a50723dcee1ae345a0d73cd57fd6901ea7eff8be55faab8fb203f4c9d31f5bc0` |
| outbound_requests / gridex_db1_outbound_requests_insert | PUBLIC / INSERT; REMOVED_OPEN | 95219 | `abf34ed849c50360526fbfd8112947597769f3badf37faabb8322a0c0d3481aa` |
| outbound_requests / gridex_db1_outbound_requests_select | PUBLIC / SELECT; REMOVED_OPEN | 95225 | `6e6b37b3acce55559c527b47634dba39d39606731c13ef617517e6322e2b6326` |
| outbound_requests / gridex_db1_outbound_requests_update | PUBLIC / UPDATE; REMOVED_OPEN | 95231 | `6fe0d98b929ea322c167422c06c287cf777e1edba589d68881203c34dbd45422` |
| partner_exports / gridex_db1_partner_exports_insert | PUBLIC / INSERT; REMOVED_OPEN | 95237 | `0ee1cfdb541805fd4236764c9a052afeac7f4d16e5e68c10df654d7509b237cb` |
| partner_exports / gridex_db1_partner_exports_select | PUBLIC / SELECT; REMOVED_OPEN | 95243 | `9599a06d813d5cf7ddbbe858f4d7cb55012562c5093f9f740089e470bca73d6d` |
| partner_exports / gridex_db1_partner_exports_update | PUBLIC / UPDATE; REMOVED_OPEN | 95249 | `e8ace7d32733b5d3158fcff564737a4e47b515188c308f4711b13f2805ba4b6b` |
| user_roles / gridex_linter_user_roles_self_read | authenticated / SELECT; REMOVED_OPEN | 96011 | `96dd319acce41e8b3a1fd65b86706378cb4b76d6a6f9163078ccc033046dd14a` |

### All 31 independently reconstructed TRUE read additions

| Table | Replay row SHA256 |
| --- | --- |
| actor_test_results | `978f65135afe2cec6b5902cc65ad74a72a6a51e1f2877cfbfce419339f71159c` |
| audit_logs | `cd121127afcb18d5f7c7a94e8bf40a134825589418127fc4271a98f57baa273b` |
| billing_disputes | `890f953470e0a28d309a9a72343fc6c11ed30f313c760434074bc52e792b562c` |
| billing_partner_customers | `c8fb90cac574f6411131719e58837de9f7eb7ff0d6f828d508c4d6b4f88e3e5c` |
| communication_routes | `e240d58e3c8e83351133ccfb78d735eb4f8662eb147f49aa4ecc9a9943846189` |
| company_customer_number_sequences | `d28c02075d0dfc3e4db612c2cc81b7e67a33f6aa34a417b8ab01e8e21b8629f4` |
| company_go_live_reviews | `8234cb6f8742c943f811fec08b7207e6da65175c2457472dcf1783972fae817a` |
| company_invitations | `3d21dfd40beb5983a5c3a8756775f3c876fc1ea853b11f96ad29fb4acc754ec2` |
| contract_offer_versions | `a3c11bc850949e59be62a443c422b1c7eeab24dda3f85861bd0152071b4c4aa2` |
| customer_addresses | `c6c17d2e089753f1986a8000eac20c96b6fbe6197f811a2c3a32ba98a4858d8e` |
| customer_authorization_documents | `f0d045836b782fb0b25cdd114c62be077bf75a0de36b51cd12619f6b7dee0b89` |
| customer_contacts | `dc27337d5bfa0065b1eb6cdc68413368a68349f661d6423ee3cc578703d7c110` |
| customer_contract_events | `1fd38163e856bd8a889fb44bb33f5eaa8f4c7dd0db3562b79f446d548501a4c5` |
| customer_documents | `483ffd87b5c62a880942e4d443634a08f3d5a139f9f90d773f702b1a1dc51788` |
| customer_import_batches | `6d3e3051565c1428b104ee6317da361d67b0b2c79c6c906654ed90472a4acc95` |
| customer_import_rows | `d4c45739d66641090db7ecdcca19d2b0e59fc95c02ba31dda5b4a84f8fda8bc2` |
| customer_info_request_events | `053e63723c2b5dc44ca6eddf575fa7c1bedcbc6db2810e3425b0c3654185abce` |
| customer_internal_notes | `9a430555386b1f6f04e06abe5640ef9cb5ae6f5c685dfa1fd7447acb4eb8257a` |
| customer_operation_tasks | `5d6ac822cfc111bef78ec63bca222dc5f04359da5d2ec69e53f079bb6d9cacb7` |
| ediel_actor_settings | `ab4f22c9ca1a61326f6f58693c7a7fd30a60536efcaa26230df629a55dca5148` |
| ediel_route_profiles | `1155745f7bf3090b6b1e5853e84606b3a890121be4147b4daea0db3437cb4124` |
| ediel_send_locks | `3828b4087163470d43f1e4feca9d1650e3235040315bb0cd222fb01682a72480` |
| grid_owner_access_agreements | `91756590c485e9fc208f86e9c15f97e64bd5dd3ab3283ec632980874006a334d` |
| grid_owner_data_requests | `b5768a28760e1dfddc3977c5364552d67ca3115c6b48a65c043749b3fddde8b3` |
| metering_permissions | `589e5976fd82ed8c74a8214cf348bc2daa6ae1066d7710b81124143c9e1142e9` |
| outbound_dispatch_events | `2a31db33464daee1d24a3e70bc930921dcb08add4efbd3daff075e3a5c72d6c8` |
| outbound_requests | `162caa6b18d8c319b3f4b1d78fac131304c39b18c9ecff93d300e47fe86d2d6e` |
| partner_exports | `2a98528e6558f18e5da8c4ce3856dc9812a527b0ee4c484d92f232362113b9cd` |
| production_route_wizard_runs | `6624a7c650593aa450c00cd3ab2117344f40bc326992adc84970f59a5da8363e` |
| user_roles | `5a98141eb2e23a874dde422b1e1aac2a58e0525cecaf42248741a960bb78b64d` |
| website_customer_applications | `d01c85f0567e4e7cc811c3dde7c5c4e7d7e4a949799256485f71414e9349f448` |
