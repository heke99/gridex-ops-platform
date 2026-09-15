# PR310 remaining grant and index decisions — 2026-09-15

Status: source/application disposition complete within the scope below; one verified grant-contract defect requires a separately qualified forward repair. This is not schema equality, native actor acceptance, or measured performance acceptance. Historical sources and reference are preserved.

## Scope and evidence

This completes the remaining 48 existing-relation authenticated ACL additions in `PR310_SCHEMA_GRANT_DISPOSITIONS_2026-09-15.md` and the functional questions for all 51 removed / 5 changed indexes in `PR310_SCHEMA_INDEX_DISPOSITIONS_2026-09-15.md`. The latter retains the full 56-row definition/source/hash mapping; that mapping is incorporated here rather than reproduced with different identities.

Evidence is artifact 10394485748, commit 335f987f, `pr310-schema-335f987f.zip`, SHA256 `4009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb`. Reference/replay documents: `e404dd6b8493da3332e15fde7622ef22098157d7933d98c0bc0d3992e3818106` / `4b5d003fea640f0f2f52a3e410fc07a01988e92f5bc6cfc8b3055ec9c2709755`. This is the 144+514 result, before separately promoted forward repairs. `supabase/schema.sql` SHA256 is `b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30`.

Skill routing: bounded differential review, Supabase/PostgreSQL semantics, false-positive checking, application caller tracing and verification before completion. Existing source acquisition and independent agent review apply. UI changes, runtime implementation, broad scanners and optimization implementation are absent from this audit task; no unrelated baseline run is claimed.

## The exact six relations

All six have eight added, non-grantable authenticated privileges: DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE. None has a relation-definition, trigger, removed-ACL or changed-ACL delta. Reference grants only service_role ALL on each. Native-compatible default ALL is explicit in `scripts/sql/gridex-supabase-compatible-bootstrap.sql:97` and the pinned native contract `scripts/canonical_native_bootstrap_contract.py:38`; the final source migrations do not revoke authenticated on these six.

| Relation | Actual kind and reference | Decision |
| --- | --- | --- |
| `gridex_automation_control_center_v` | Ordinary joined view, security_invoker=true; schema.sql:59588, ACL:115746–115749 | Preserve definition and invoker boundary; exclude from the service-only repair. |
| `gridex_batch_2b_live_control_tower_v` | Ordinary joined view, security_invoker=true; schema.sql:59649, ACL:115759–115762 | Same bounded preservation. |
| `gridex_batch_2c_control_tower_summary_v` | Ordinary joined view, security_invoker=true; schema.sql:59819, ACL:115779–115782 | Same bounded preservation. |
| `inbound_ediel_match_attempts` | Ordinary base table, RLS enabled; schema.sql:63841,100285–100303, ACL:116277–116280 | Confirmed source-contract defect: revoke all authenticated table privileges. |
| `inbound_ediel_parse_results` | Ordinary base table, RLS enabled; schema.sql:63860,100307–100321, ACL:116283–116286 | Same exact repair. |
| `inbound_email_attachments` | Ordinary base table, RLS enabled; schema.sql:63884,100325–100336, ACL:116289–116292 | Same exact repair. |

### Three inbound tables: confirmed defect and narrowly required repair

`supabase/migrations/20260904120000_canonical_tenant_invariant_convergence.sql:25–47` explicitly classifies each of these three as system/service-role only and states that no client role holds any privilege. Lines 10–15 rely on that absence to claim no behavioral change, but there is no authenticated REVOKE. All eight retained native privileges contradict that authored contract. This is stronger evidence than the mere absence of an application caller or an old dump grant.

Original `20260528_batch_7a_route_inbound_mail_platform_ui.sql:309–351` enables RLS and defines platform-admin SELECT/ALL policies; its comment expressly excludes company admins from technical mailbox/parser tables. Its table definitions at 182–238 have nullable `company_id` references to companies with ON DELETE SET NULL. All three also reference inbound_email_messages with ON DELETE CASCADE, and match attempts reference parse results with ON DELETE CASCADE. NULL company attribution is an authored state, not automatically a malformed row. Reference constraints are unchanged in this artifact.

Each replay table adds eight compacted permissive gridex_mp policies plus four restrictive tenant-lifecycle guards; the old platform policies remain. `20260612143000_performance_policy_consolidation_and_index_cleanup.sql:138–260` expands/combines existing permissive role/action policies. `20260814162500_tenant_rls_lifecycle_hardening.sql:129–173` installs restrictive guards over UUID company_id tables: read_company for SELECT and write_company for DML. These row checks do not turn SQL ACLs into application page/action permissions, do not make nullable attribution a tenant grant, and do not constrain TRUNCATE. PostgreSQL explicitly excludes whole-table operations such as TRUNCATE from RLS: [PG17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

The application matches the service-only contract. `app/admin/inbound-mail/page.tsx:118,139–146` and `[id]/page.tsx:43–51` requirePlatformAdminAccess before supabaseService reads; `lib/admin/guards.ts:200–208` redirects non-platform contexts. `lib/inbound-mail/inboundMatcher.ts:28`, `edielMailboxPoller.part-2.ts:102,689,732,800`, `edielInboundProcessor.ts:77` and `inboundStatusUpdater.ts:290` use the service client for processing. SQL role authenticated is shared by application users; it does not mean platform administrator. Removing authenticated ACLs does not remove these service-client paths.

Repair decision: a new finite forward candidate should REVOKE ALL PRIVILEGES ON TABLE from authenticated on exactly these three ordinary tables. Preserve service_role, other principals, policies, constraints and all data; fail atomically for a missing/wrong-kind target. No PUBLIC/anon revocation is inferred here. The reference and artifact show no new PUBLIC/anon grant on these six, but effective inherited-role reachability still needs native role qualification. The candidate must separately prove exact ACL removal, service/other-object preservation, failed-operation rollback, idempotence and owned database cleanup before promotion. The other agent's seven-table TRUNCATE-only repair does not overlap.

### Three views: preserve the authored invoker design, no service-only repair

Final definitions are `20260822224708_canonical_ediel_production_projection_convergence.sql:168–243`. Each joins companies to ediel_production_state; correlated counts cover operational tenant tables. The automation view additionally calls gridex_company_go_live_readiness; the batch2c view reads gridex_batch_2c_drift_queue_v. September 4 source lines 62–64 expressly sets security_invoker=true. The relation rows match the reference, so these definitions/options have not changed.

These are views, not tables that can be emptied with TRUNCATE. The joined FROM clauses prevent automatic INSERT/UPDATE/DELETE rewriting; no source/reference INSTEAD OF trigger is present. SELECT still requires underlying privileges and applicable RLS, plus EXECUTE on functions called by the view; security_invoker does not itself certify those functions or any nested definer view. See [PG17 CREATE VIEW](https://www.postgresql.org/docs/17/sql-createview.html). No assertion that all tenants can SELECT these views successfully is made.

`app/admin/operations/automation/page.tsx:33–38` requires page key operations.automation, gets an operational company scope, and only queries when a company is present. `lib/operations/batch2bAutomation.ts:266–281` and `batch2cAutomation.ts:338–355` use supabaseService and an explicit company filter. No application call to automation_control_center_v was found in app/lib/components. These server paths do not establish that the database authenticated role should have DML or DDL rights, but neither establishes an explicit service-only source contract for these views.

Disposition: preserve the current invoker definitions and do not speculate a view ACL repair into the source-qualified inbound candidate. In particular, do not label all seven non-SELECT grants harmless: TRIGGER is an actual SQL capability, including creating INSTEAD OF triggers if an executable trigger function is available. That is a broader database capability than the UI read flow, and requires an explicit least-privilege design/actor decision before claiming effective-role acceptance. [PG17 CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html). The present source review establishes neither a demonstrated cross-tenant read nor a supported need for trigger creation. This bounded preserve/no-patch decision is not approval of arbitrary authenticated trigger attachment.

## All index questions: functional decisions versus costs

| Scope from prior exact mapping | Count | Concrete disposition |
| --- | --- | --- |
| Exact renamed added alternatives | 25 | Preserve survivors; definitions, uniqueness and primary flags match aside from names. |
| Exact unchanged alternative | 1 | Preserve retained index; no duplicate restoration. |
| Wider unfiltered B-tree with the same leading keys | 22 | Preserve current access paths. Search keys remain supported; storage, write cost and planner choice are not identical or measured. |
| Full contract_id index replaced by non-NULL partial | 1 | Preserve partial index for non-NULL FK/equality lookups. NULL queries remain semantically valid; no equivalent NULL access path or cost is claimed. |
| Missing standalone actor_setting_id / contract_id index | 2 | No index repair based on this evidence. Missing access paths are real, but no lost constraint/uniqueness semantics or measured performance regression follows. |
| Changed nonunique customer indexes | 4 | Preserve source-selected definitions with the qualifications below. |
| Changed active-role unique predicate | 1 | Preserve logically equivalent predicate; same uniqueness domain. |

All seven removed UNIQUE(company_id,id) indexes retain exact unique equivalents. No application named-index dependency was found for the reviewed missing/changed names; PostgreSQL query filtering/sorting does not require the old nonunique index name. No functional defect was established in these 56 index deltas. This does not dispose of independent constraint deltas.

`idx_fk_customer_documents_e3ef31b05dd6` (full contract_id, hash `75aea092e776e053a176dbd8f1a6a21fd8f9faf0b2736084ed0b2c4c6878d133`) is covered only for non-NULL keys by `customer_documents_contract_idx` (hash `2d82330db51fd033de04cec4e6f1d9fe9b1db1fa82156827d825e1a6cd68ae4c`, `20260526_batch_3a_3b_customer_intake_blockers_documents.sql:68`). SQL NULL searches still return their correct result using another plan. No full-index restoration is justified solely to cover NULLs without a relevant workload.

`idx_fk_ediel_route_profiles_a0070f5027fa` (actor_setting_id, hash `b3e8af83e9fe974d7e8c305b9f0ddbad9c6fc0782f45a675c3d9e7d9c15bccec`) has no proved actor_setting_id-leading replacement. `lib/ediel/customerInfoEnvironmentResolver.ts:123–128,174–180` selects routes by company/enabled state and then inspects actor_setting_id. The missing FK at this artifact was separately repaired by the first pinned forward source; enforcing that FK does not require a child-side index for correctness. An unindexed parent change may cost more; no timing, row-count distribution or parent-delete bottleneck was measured.

`idx_fk_powers_of_attorney_52ee8c8f7b14` (contract_id, hash `2a4b1f67816f8eaa81b2fb42256e1d1275398e30fab23e410767ff82004563c6`) is not equivalent to replay `(company_id,contract_id)` (`idx_fk_powers_of_attorney_a4d711528926a49c`, hash `f6aa03c855121f7853a2a94f843a9a80aedbec0e96b081965addb31610eabe28`). Current `lib/website/customerApplicationLegal.ts:953–964` and `lib/customer-portal/tenantSync.ts:684–693` scope POA lookups to company/customer and optionally contract (or NULL). Preserve the source-selected company-prefixed index; do not claim standalone contract lookups have the same plan. The underlying old-vs-composite FK difference is an independent constraint disposition, not repaired by adding a nonunique index.

The five changed definitions remain pinned in the prior audit. customer_number changes partial to full with identical keys, broadening coverage without changing uniqueness. The two lower(email) names exchange full/partial definitions; both alternatives remain available. intake_status changes `(company_id,intake_status,updated_at DESC) WHERE intake_status IS NOT NULL` to `(company_id,intake_status,created_at DESC)`: these are different ordering access paths, but both nonunique, and the current customer list orders created_at (`lib/customers/getCustomers.ts:353–366`). An updated_at query can still sort; no SLA regression was demonstrated. `user_roles_company_user_role_active_uidx` changes only `coalesce(is_active,true)` versus `coalesce(is_active,true)=true`; coalesce is non-NULL, so both accept exactly true/NULL input and reject false. This preserves the unique predicate with the other status/non-NULL terms unchanged.

The exact/left-prefix/partial distinctions follow [PG17 multicolumn indexes](https://www.postgresql.org/docs/17/indexes-multicolumn.html) and [PG17 partial indexes](https://www.postgresql.org/docs/17/indexes-partial.html). No speculative optimization migration, benchmark claim, or blanket schema-equality exception follows from these dispositions.

## Reproducible ACL evidence

The 48 rows below were individually reconstructed as compact, key-sorted JSON with fields nspname=public, relname, grantee=authenticated, privilege_type and is_grantable=false; each SHA256 equals its added artifact row. The six relation rows have no delta. The source pin table below makes this review reproducible without new access to a database.

| Relation | Privilege | SHA256 |
| --- | --- | --- |
| `gridex_automation_control_center_v` | DELETE | `0bfaf53f2e75e3f6caafb0fab2a6c0ded3722b170db6a56d7480b2663cd1db16` |
| `gridex_automation_control_center_v` | INSERT | `4a94aa9495cda83d386ca2e600f6311cae326f69a765ae3d7704dc8415c25f3a` |
| `gridex_automation_control_center_v` | MAINTAIN | `73ae6ea03b866c2a00233f75c0a00839d92ae31114d0a69418e140a2bc6cccc9` |
| `gridex_automation_control_center_v` | REFERENCES | `1871bf4934117060c51728199075659b438cb7adceb21ddcc1b49296c0946e11` |
| `gridex_automation_control_center_v` | SELECT | `3fd7554e2f35eb3ba820afd99fde43b9e392cacb68306798251251b84c5dfd27` |
| `gridex_automation_control_center_v` | TRIGGER | `08122ce062a640290767a3ca94654dc1350f41b0b0edaa7bb4e8789825217058` |
| `gridex_automation_control_center_v` | TRUNCATE | `970825b870671cae5388b3ffdf7ae77e8e0e06cbaad9cb605f3c4e673dfddf83` |
| `gridex_automation_control_center_v` | UPDATE | `7f61aa2c6463674a9e05561b3db3960e27d41e9e1b91fb13c3331e01b1841098` |
| `gridex_batch_2b_live_control_tower_v` | DELETE | `a6ea6887b18129ce318f3527db9dcd3d1cff78657f138a4b24788f978ed1f146` |
| `gridex_batch_2b_live_control_tower_v` | INSERT | `6877652383cde4d5763f9804c2dc72e041284fff694bb71a2cd2397e1981a05a` |
| `gridex_batch_2b_live_control_tower_v` | MAINTAIN | `557e98d423261ee0e52094626bf2b9a2db326365fd7acf361566c08d0f1eb23a` |
| `gridex_batch_2b_live_control_tower_v` | REFERENCES | `a7fe94c5d2c3fe1454633ff7cd1c8ec2ead43d14323dbfa7ed8c0a1b2cde4c91` |
| `gridex_batch_2b_live_control_tower_v` | SELECT | `1685084afc13e8443aafb1c0d978a65c6314684ced7d249c66920d813fab8924` |
| `gridex_batch_2b_live_control_tower_v` | TRIGGER | `1be2e8cd5814b1a1079c04dc1b770a3c449bc7166791bb2039f0b9c9d969f45c` |
| `gridex_batch_2b_live_control_tower_v` | TRUNCATE | `1c837da734d4779bd571d1005b7b5d6035858681fe051051ccf482490b904b7f` |
| `gridex_batch_2b_live_control_tower_v` | UPDATE | `8df60613b6416327990d8d3a60fd74602fb7010d58aff2e5b4fbe116e40876ca` |
| `gridex_batch_2c_control_tower_summary_v` | DELETE | `71af7d2deaccdeab364d7e877bacbb6bf2515add6c580c17a731adfb68d79466` |
| `gridex_batch_2c_control_tower_summary_v` | INSERT | `30a2880426aa7236b6442daabac40f2791d581c4582acf63ce63cbfd76357618` |
| `gridex_batch_2c_control_tower_summary_v` | MAINTAIN | `7d28deb629dd86a0a803bd572088556dada6609baff35606145a6110fa22ac49` |
| `gridex_batch_2c_control_tower_summary_v` | REFERENCES | `dcf6bb1b7160adc3659ede28ebf43805e3ee818c15f138c0d0fbe1102be3f416` |
| `gridex_batch_2c_control_tower_summary_v` | SELECT | `11e19c92ccce05b35dd74a4c3a26408bc760efe6c1e80bb3a0dbb0e3aca0d0fd` |
| `gridex_batch_2c_control_tower_summary_v` | TRIGGER | `8985706ee627254dc73ac9a0c6e8e9181011762d6d1d40f80fbc57d4cc343a8c` |
| `gridex_batch_2c_control_tower_summary_v` | TRUNCATE | `50c3e138d97bfa5db5ebfcbc28fe3ddfc3494eedfc9130428bc1e748a15e8c1a` |
| `gridex_batch_2c_control_tower_summary_v` | UPDATE | `079266771416531070e855b3d9cd5665290a344b44af898448ac43cffe7c43cf` |
| `inbound_ediel_match_attempts` | DELETE | `15d7cbfc9edd4038aeef0c23683cf98f92fff694934fe5613eee806e6f604481` |
| `inbound_ediel_match_attempts` | INSERT | `daf164c1f2d834fc5a942a4debd8e352ac05e6473648eecedaaa462a8b5e5d8b` |
| `inbound_ediel_match_attempts` | MAINTAIN | `b252a5a06f579af5ad662d1343774f0c1a85925135e728ea59bd44925f711733` |
| `inbound_ediel_match_attempts` | REFERENCES | `981b2c4f708a49e1a482b13a6bec0eae711d9916134ecd7498303e8085f2f05a` |
| `inbound_ediel_match_attempts` | SELECT | `2d96158c38b4fa507f724e9b542ead97cd8c8aade55ae83b93b88a31435bfeeb` |
| `inbound_ediel_match_attempts` | TRIGGER | `2a89a31b809df516bd23e8f328c252d50d0022d0a868117d852463a44d9e4ec6` |
| `inbound_ediel_match_attempts` | TRUNCATE | `9eddd4b98ec7409a45c8bb08b3f05e2a156bd66fadd6dfb7b627f156fb93b971` |
| `inbound_ediel_match_attempts` | UPDATE | `d266d79ca5fdbeb67d6d57f622bf3944413ad87ee9ff67f3fa2463b9b506a1cc` |
| `inbound_ediel_parse_results` | DELETE | `fe7f0e8b4fc4a81dc70a9b4b06f6be31f9210f610acdad10f719c8af96278617` |
| `inbound_ediel_parse_results` | INSERT | `632fb931ad61def83df37bd0998617503bca7ddbc56d07a1f357f4ea1cf84c24` |
| `inbound_ediel_parse_results` | MAINTAIN | `63e1d491cdaae6d924a3cb862dac1788074e8e6906b50d5ee8e9de5db48b1931` |
| `inbound_ediel_parse_results` | REFERENCES | `1aa9be8767ce1f8d32ccd40e7a58affbe5093c2da55e2a97a3cec63985b7e348` |
| `inbound_ediel_parse_results` | SELECT | `38d07145e817e2f57451c0c4ec145e176bcbcfee9fe439eaf0b5495e108fbad5` |
| `inbound_ediel_parse_results` | TRIGGER | `05ef3f60ecf5f54876c5687c5b2e6a7ad8b3e16b06277f777b6d097c20d6696a` |
| `inbound_ediel_parse_results` | TRUNCATE | `2c8ff7e3f72041e45e3fa492065cafc7892e5ed542136aee443cfd9bbc78739f` |
| `inbound_ediel_parse_results` | UPDATE | `e42e75e688f26794b870f811b981f57055d863e5520012db40151bda90d1e914` |
| `inbound_email_attachments` | DELETE | `f8b2ef8e98d3697ae1ce5c4e34e412a24abba6f650b22f7c2292b0aed57e8e48` |
| `inbound_email_attachments` | INSERT | `127963c255f15df6ee11986fc02df5a3777fd54568ce80454b4a6d297da25840` |
| `inbound_email_attachments` | MAINTAIN | `59aeb5ac581cebd13ed896f64a44a9e32ac9c362ffe9bff87ae32f0bd2c12098` |
| `inbound_email_attachments` | REFERENCES | `144365a8d3140ade24857ba409ba12e31b4c54a72bf935735138b100006afe35` |
| `inbound_email_attachments` | SELECT | `52427d65bfe14a79cf6985675b5ff306089cb8d866d566d89820c430223838cf` |
| `inbound_email_attachments` | TRIGGER | `a067a35c8c3612cb186b8963d5204a00b416ef2340a5f7ad8211d752a4836511` |
| `inbound_email_attachments` | TRUNCATE | `a3def6e5adcf9f6cc1f05aec4f29884aecdb1a8c697e172ef2f8925725b9d316` |
| `inbound_email_attachments` | UPDATE | `146d8fa7dbfc08d9f7fe64f49df0da45c96064c91f5672524cc798659347a019` |

## Source file pins

| File under supabase/migrations | SHA256 |
| --- | --- |
| `20260904120000_canonical_tenant_invariant_convergence.sql` | `3e40f894ec109a45e4dd7842edd819509caadac1e8d5e89a45d244224d0c77e1` |
| `20260528_batch_7a_route_inbound_mail_platform_ui.sql` | `a5ca82d1c68f44c8542820e5d209fd5d31356a16e7eb1ccc827843a61e0ba690` |
| `20260822224708_canonical_ediel_production_projection_convergence.sql` | `a9330b1bacc86aaad5ec6993b3517e5dd7152158f7b3f588dfff9a4bd8645e75` |
| `20260612143000_performance_policy_consolidation_and_index_cleanup.sql` | `ff3b3c65b97e36cb6c0bad1f25e4ff332debf3993c845c9856cf4fadea748b60` |
| `20260814162500_tenant_rls_lifecycle_hardening.sql` | `e2eee5be4e4c795380782248683bfd32b682a66b2e2882a1fd241c9acc7498b2` |

## Separately staged qualification (not executed PostgreSQL evidence)

Following the confirmed inbound finding, a separate staged candidate is now `scripts/sql/forward-candidates/restrict-inbound-service-table-privileges.sql`, SHA256 `0ee026c41d180768b23e20826d522387cc1c65e9c689304472f62cda39b19033`. It revokes only authenticated table ACLs on the three source-qualified RLS base tables. Missing/wrong-kind/non-RLS targets fail atomically; residual PUBLIC/inherited effective privileges also fail without revoking those principals. Direct authenticated column ACLs are rejected before REVOKE: PostgreSQL table REVOKE would also revoke matching column grants, exceeding this reviewed delta ([PG17 REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html)).

The fixed `canonical-inbound-service-privileges-selftest.py` uses the existing nonce/owner-verified database cleanup helper on loopback 55440/gridex_auth_test. Synthetic deny-all row policies demonstrate original authenticated TRUNCATE bypass, then expected 42501 for all five DML/TRUNCATE operations after repair. SQL must verify all eight authenticated privileges absent, all service privileges present, real service DML/rollback, exact ACL removal and every other catalog/row value preserved, failure atomicity, repeat and cleanup. Anon and a separate schema/table have sentinel grants to prove preservation. This fixture does not reproduce the real application graph or Auth helper semantics.

Four new offline admission/preservation tests passed after an initial four-test red run; the four inherited ownership/admission tests also passed. `.github/workflows/gridex-inbound-service-privilege-qualification.yml` runs actual PostgreSQL 17 before creating a genuine pinned-CLI filename and emits receipts only after SQL success/cleanup. Native PG17 execution and promotion are pending. No historical migration, runtime admission, manifest, reference or publication was changed by this work.

Independent read-only review by `/root/review_fixture` found no necessary changes. The reviewer independently passed all four new offline tests plus four ownership tests, matched all 48 ACL hashes, five source pins and the candidate hash, and checked the source/app contract, fixture preservation/failure controls and workflow success gating. PostgreSQL 17 behavior remains pending CI.
