# PR310 schema index dispositions — 2026-09-15

Status: PARTIAL. Read-only source/application review; no migrations, reference refresh, runtime edits, native SQL, performance measurements or schema acceptance.

## Scope, provenance and skill routing

Reviewed all51 removed and5 changed indexes from fresh335f987f artifact10394485748 (`pr310-schema-335f987f.zip`). ZIP SHA256 `4009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb`. Reference/replay projection hashes remain `e404dd6b8493da3332e15fde7622ef22098157d7933d98c0bc0d3992e3818106` / `4b5d003fea640f0f2f52a3e410fc07a01988e92f5bc6cfc8b3055ec9c2709755` after144+514 execution. This evidence is separate from native lifecycle acceptance.

Applied differential-review, Supabase, false-positive checking and verification-before-completion principles. This task is a bounded source/application review of existing index differences. No UI/security scan, optimization implementation, benchmark claim, or repository-wide audit is in scope.

## Findings

No lost uniqueness is established within these56 reviewed index deltas. All7 removed UNIQUE(company_id,id) indexes have exact added equivalents with identical unique/non-primary flags and B-tree definitions, apart from their names. The sole changed unique index has an equivalent boolean predicate. Of51 removals: EXACT=25, EXACT_RETAINED=1, LEFT_PREFIX=22, OPEN_ACCESS_PATH=2, PARTIAL_NON_NULL=1. LEFT_PREFIX means a wider unfiltered B-tree retains the removed leading key sequence, not identical planner costs or storage.

Two nonunique access paths remain OPEN: `ediel_route_profiles(actor_setting_id)` and `powers_of_attorney(contract_id)`. Their absence is catalog evidence, not proof of a measured runtime regression. No blanket recreation or schema equality assertion is warranted.

## Source mechanisms

- FK12: `20260812211405_gridex_missing_fk_indexes_v1.sql:11–55` only creates indexes for FK keys without a qualifying leading-key index, using the first12 MD5 characters of the constraint name. Its early predicate allows partial indexes; this is not sufficient proof of general coverage.
- FK16: `20260813070046_gridex_review_hardening_v2.sql:111–157` additionally requires no predicate/no expressions, naming the index with the first16 MD5 characters of `public.<table>.<constraint>`. Both deterministic suffixes were independently matched to reference FK names below.
- `20260612143000_performance_policy_consolidation_and_index_cleanup.sql:385–486` groups actual structural duplicates by key/expression/predicate/collation/opclass/options and preserves constraint-backed indexes. This explains source-dependent survivor names for exact duplicates; the artifact alone does not prove which DROP executed.
- `20260809180628_gridex_ops_external_api_performance_foundation.sql:172–196` explicitly attempts removal of all7 old company/id names and preserves indexes if dependent objects prevent removal. Replay retains the hash-proved `idx_<table>_company_id_id_uidx` alternatives installed by `20260615_multitenant_integrity_and_claim_locks.sql:37–60`.
- Missing dynamic idx_fk names often mean their creation was suppressed by earlier covering indexes or absent source FKs. They do not, by themselves, prove a dropped access path.

## All removed indexes

Each row has a hash-verified reference definition; key text omits the common `USING btree`. E=exact added alternative; ER=unchanged exact reference alternative; P=unfiltered left-prefix coverage; PN=non-null partial coverage only; OPEN=no equivalent leading-key access path established.

| Removed index / schema.sql line | Keys | Disposition / surviving index |
| --- | --- | --- |
| `billing_underlays_company_id_id_uidx` / 72331 | UNIQUE `(company_id, id)` | E → `idx_billing_underlays_company_id_id_uidx` |
| `idx_fk_communication_routes_c480f168f3a2d2ce` / 76495 | `(company_id)` | E → `communication_routes_company_id_idx` |
| `idx_fk_company_invitations_f8224bba7b9905b6` / 76567 | `(company_id)` | E → `company_invitations_company_delete_idx` |
| `contract_price_snapshots_company_id_id_uidx` / 72751 | UNIQUE `(company_id, id)` | E → `idx_contract_price_snapshots_company_id_id_uidx` |
| `idx_fk_customer_addresses_2273b0fd6c9de3b7` / 76759 | `(company_id)` | E → `customer_addresses_company_id_idx` |
| `idx_fk_customer_addresses_8e2eee06b13f` / 76765 | `(customer_id)` | P → `customer_addresses_customer_company_idx` |
| `idx_fk_customer_authorization_documen_d344d341da50d408` / 76843 | `(company_id)` | E → `customer_authorization_documents_company_id_idx` |
| `idx_fk_customer_authorization_documen_e1f9ff94f907` / 76849 | `(customer_id)` | P → `customer_authorization_documents_customer_company_uploaded_idx` |
| `idx_fk_customer_contacts_1ac096eddd3c` / 76891 | `(customer_id)` | P → `customer_contacts_customer_company_idx` |
| `idx_fk_customer_contacts_927b5ec6a2d5` / 76897 | `(company_id)` | E → `customer_contacts_company_id_idx` |
| `idx_fk_customer_contract_events_c58810ea8e80` / 76921 | `(company_id)` | E → `customer_contract_events_company_id_idx` |
| `customer_contracts_company_id_id_uidx` / 73033 | UNIQUE `(company_id, id)` | E → `idx_customer_contracts_company_id_id_uidx` |
| `idx_fk_customer_contracts_2ff34cd0c61b` / 76939 | `(company_id, site_id)` | E → `idx_customer_contracts_company_site` |
| `idx_fk_customer_contracts_53f7340bd979` / 76951 | `(company_id, metering_point_id)` | E → `idx_customer_contracts_company_metering_point` |
| `idx_fk_customer_contracts_e9f3ff07eed1` / 76981 | `(customer_id)` | P → `customer_contracts_customer_company_idx` |
| `idx_fk_customer_documents_e3ef31b05dd6` / 76999 | `(contract_id)` | PN → `customer_documents_contract_idx` |
| `idx_fk_customer_internal_notes_7539678d755e` / 77053 | `(customer_id)` | P → `customer_internal_notes_customer_company_created_idx` |
| `idx_fk_customer_match_review_cases_327b398772ef` / 77185 | `(company_id)` | P → `mt_customer_match_review_cases_company_id_id_uidx` |
| `idx_fk_customer_onboarding_applicatio_8eda8d8d0284` / 77233 | `(company_id)` | P → `mt_customer_onboarding_applications_company_id_id_uidx` |
| `idx_fk_customer_onboarding_legal_snap_c8fbf8b07583` / 77257 | `(company_id)` | P → `mt_customer_onboarding_legal_snapshots_company_id_id_uidx` |
| `idx_fk_customer_portal_accounts_2762e063db9c3554` / 77347 | `(company_id)` | P → `idx_customer_portal_accounts_company_customer` |
| `idx_fk_customer_portal_claims_12ac8f79e4c7` / 77365 | `(company_id)` | P → `idx_customer_portal_claims_company_customer` |
| `idx_fk_customer_portal_events_8e4d7eb53c00` / 77389 | `(company_id)` | P → `idx_customer_portal_events_company_customer_created` |
| `customer_sites_company_customer_created_perf_idx` / 73939 | `(company_id, customer_id, created_at DESC)` | ER → `customer_sites_company_customer_created_idx` |
| `customer_sites_company_id_id_uidx` / 73969 | UNIQUE `(company_id, id)` | E → `idx_customer_sites_company_id_id_uidx` |
| `idx_customer_sites_company_customer` / 75805 | `(company_id, customer_id)` | E → `customer_sites_company_customer_idx` |
| `idx_fk_customer_sites_b6a0f5f2ef9f` / 77473 | `(customer_id)` | P → `customer_sites_customer_company_idx` |
| `customers_company_id_id_uidx` / 74089 | UNIQUE `(company_id, id)` | E → `idx_customers_company_id_id_uidx` |
| `idx_customers_company_status` / 75865 | `(company_id, status)` | E → `customers_company_status_idx` |
| `ediel_actor_settings_company_environment_active_idx` / 74227 | `(company_id, environment, is_active, updated_at DESC)` | E → `ediel_actor_settings_company_env_active_idx` |
| `idx_fk_ediel_inbound_cases_c5b967b457ab` / 77815 | `(company_id)` | P → `idx_ediel_inbound_cases_company_status_created` |
| `idx_fk_ediel_mailboxes_8bfd03acd32f` / 77833 | `(company_id)` | P → `idx_ediel_mailboxes_company_active` |
| `ediel_messages_company_id_id_uidx` / 74647 | UNIQUE `(company_id, id)` | E → `idx_ediel_messages_company_id_id_uidx` |
| `idx_fk_ediel_route_profiles_a0070f5027fa` / 78067 | `(actor_setting_id)` | OPEN |
| `idx_fk_ediel_route_profiles_e6fd37257b0dc943` / 78085 | `(company_id)` | E → `ediel_route_profiles_company_id_idx` |
| `idx_fk_ediel_test_artifacts_ea1a932d1ad5` / 78247 | `(test_run_id)` | P → `ediel_test_artifacts_run_idx` |
| `idx_fk_ediel_test_run_messages_fc5e6112445d` / 78277 | `(company_id)` | E → `ediel_test_run_messages_company_id_idx` |
| `ediel_test_runs_company_suite_case_status_idx` / 75049 | `(company_id, test_suite, role_code, test_case_code, status, created_at DESC)` | E → `ediel_test_runs_company_case_idx` |
| `idx_fk_electricity_suppliers_b42e7893b5c6` / 78355 | `(company_id)` | P → `electricity_suppliers_company_org_idx` |
| `idx_fk_inbound_processing_jobs_bfc543e1d238` / 78487 | `(inbound_email_message_id)` | E → `idx_fk_inbound_processing_jobs_ad4a712841cf1a93` |
| `idx_fk_metering_points_5eef380678f1` / 78715 | `(site_id)` | P → `metering_points_site_company_created_idx` |
| `metering_points_company_id_id_uidx` / 80587 | UNIQUE `(company_id, id)` | E → `idx_metering_points_company_id_id_uidx` |
| `idx_fk_partner_exports_b6acc04fdc7a` / 78781 | `(company_id)` | E → `partner_exports_company_id_idx` |
| `idx_fk_power_of_attorney_scopes_3776412a3611` / 78979 | `(company_id)` | P → `power_of_attorney_scopes_company_poa_idx` |
| `idx_fk_powers_of_attorney_50a4d1dbf8f2` / 78991 | `(customer_id)` | P → `powers_of_attorney_customer_company_created_idx` |
| `idx_fk_powers_of_attorney_52ee8c8f7b14` / 78997 | `(contract_id)` | OPEN |
| `idx_fk_role_permissions_20e81c089f52` / 79195 | `(role_id)` | P → `role_permissions_role_id_permission_id_key` |
| `idx_fk_supplier_switch_events_7968f62c2d6d` / 79213 | `(switch_request_id)` | P → `supplier_switch_events_request_company_created_idx` |
| `idx_fk_supplier_switch_events_f00c2ad07fbf` / 79219 | `(company_id)` | E → `supplier_switch_events_company_id_idx` |
| `idx_fk_supplier_switch_requests_dc4616ff73c5` / 79249 | `(customer_id)` | P → `supplier_switch_requests_customer_company_created_idx` |
| `gridex_perf_user_roles_user_status_active_idx` / 75547 | `(user_id, status, is_active)` | E → `user_roles_user_active_idx` |

## Exact replacement definitions and sources

Definitions below were independently reconstructed and matched to the added artifact row hashes. ER is unchanged in the diff, so its original definition is retained; its hash is computed from the reference row, not claimed as a separate added receipt. Paths below are under `supabase/migrations/` unless labeled schema.sql.

- `idx_billing_underlays_company_id_id_uidx`: `CREATE UNIQUE INDEX idx_billing_underlays_company_id_id_uidx ON public.billing_underlays USING btree (company_id, id)`; SHA256 `d67f7ff78b9fa10263a43e0cd295e5dc71418c8222b318f7c3109f0af6f12a41`. Source: `20260615_multitenant_integrity_and_claim_locks.sql:37–60`.
- `communication_routes_company_id_idx`: `CREATE INDEX communication_routes_company_id_idx ON public.communication_routes USING btree (company_id)`; SHA256 `d7f03ad815b5f7cbac3381f6b0690a6553c356de56ee84f8de46f2154cec178e`. Source: `20260519_final_saas_hardening.sql:84–115`, `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql:220–267`.
- `company_invitations_company_delete_idx`: `CREATE INDEX company_invitations_company_delete_idx ON public.company_invitations USING btree (company_id)`; SHA256 `d24abe6756c44a5601ec7baaa748ccef31fd8027fe6e71d42460e57e5124ac9d`. Source: `20260520_company_delete_backfill_and_admin_layout.sql:50`.
- `idx_contract_price_snapshots_company_id_id_uidx`: `CREATE UNIQUE INDEX idx_contract_price_snapshots_company_id_id_uidx ON public.contract_price_snapshots USING btree (company_id, id)`; SHA256 `3fdbef52fe75cbe8f2a54fe9003d5e579d221d209a5827b111ac5f8b95e9be5e`. Source: `20260615_multitenant_integrity_and_claim_locks.sql:37–60`.
- `customer_addresses_company_id_idx`: `CREATE INDEX customer_addresses_company_id_idx ON public.customer_addresses USING btree (company_id)`; SHA256 `04ed859de2bde5e9fcd0c02c256adc38c01309b1aafac04ed22d64d60fcad21a`. Source: `20260519_customer_intake_contracts_tenant_hardening.sql:11–33`, `20260519_final_saas_hardening.sql:84–115`, `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql:220–267`.
- `customer_addresses_customer_company_idx`: `CREATE INDEX customer_addresses_customer_company_idx ON public.customer_addresses USING btree (customer_id, company_id, created_at DESC)`; SHA256 `a62a47da1914b9ed51c4c1632dc4b499847f390c206e853d9ac10a516ca5baa5`. Source: `20260525_debug_step2_code_schema_alignment.sql:80`.
- `customer_authorization_documents_company_id_idx`: `CREATE INDEX customer_authorization_documents_company_id_idx ON public.customer_authorization_documents USING btree (company_id)`; SHA256 `221f528a8f2ecc635b20c37deb776ea274f14a9700ea3a4ea55792eb35cb4d06`. Source: `20260519_customer_intake_contracts_tenant_hardening.sql:11–33`, `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql:220–267`.
- `customer_authorization_documents_customer_company_uploaded_idx`: `CREATE INDEX customer_authorization_documents_customer_company_uploaded_idx ON public.customer_authorization_documents USING btree (customer_id, company_id, uploaded_at DESC)`; SHA256 `dc22ac4785ff178ed451d9dd625f3483d8946ffc5314e8ad265a3da8bc481a5d`. Source: `20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql:236`.
- `customer_contacts_customer_company_idx`: `CREATE INDEX customer_contacts_customer_company_idx ON public.customer_contacts USING btree (customer_id, company_id, created_at DESC)`; SHA256 `9b9860dd563a2558bf3df02d042b591db20eb84a6625c1b021caf62ece00ee90`. Source: `20260525_debug_step2_code_schema_alignment.sql:77`.
- `customer_contacts_company_id_idx`: `CREATE INDEX customer_contacts_company_id_idx ON public.customer_contacts USING btree (company_id)`; SHA256 `5d2549fb20a3861fcfb70efefaf273f49ef8ec45ef1c0374e0eb50b00b8e1f29`. Source: `20260519_customer_intake_contracts_tenant_hardening.sql:11–33`, `20260519_final_saas_hardening.sql:84–115`, `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql:220–267`.
- `customer_contract_events_company_id_idx`: `CREATE INDEX customer_contract_events_company_id_idx ON public.customer_contract_events USING btree (company_id)`; SHA256 `1de5d8f1d9cb9a3807c13a620ccd569ceea6ecf2f9fccdbf533e83b1729cfc97`. Source: `20260519_customer_intake_contracts_tenant_hardening.sql:11–33`, `20260519_final_saas_hardening.sql:84–115`, `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql:220–267`.
- `idx_customer_contracts_company_id_id_uidx`: `CREATE UNIQUE INDEX idx_customer_contracts_company_id_id_uidx ON public.customer_contracts USING btree (company_id, id)`; SHA256 `ceea5e549bcdd597c154ec0403a7f96eaa083694fb571db98a023731972a1101`. Source: `20260615_multitenant_integrity_and_claim_locks.sql:37–60`.
- `idx_customer_contracts_company_site`: `CREATE INDEX idx_customer_contracts_company_site ON public.customer_contracts USING btree (company_id, site_id)`; SHA256 `01ad5f9fa5eda654788fa7e58ee235d20cc4591eef90c850137bc86e5a348f82`. Source: `20260526_debug_step1_2c_full_schema_code_alignment.sql:83`.
- `idx_customer_contracts_company_metering_point`: `CREATE INDEX idx_customer_contracts_company_metering_point ON public.customer_contracts USING btree (company_id, metering_point_id)`; SHA256 `a43136c08e3291588820338f8d8c242219ea04eba7da6f65ee0f70ba2a665e25`. Source: `20260526_debug_step1_2c_full_schema_code_alignment.sql:85`.
- `customer_contracts_customer_company_idx`: `CREATE INDEX customer_contracts_customer_company_idx ON public.customer_contracts USING btree (customer_id, company_id, created_at DESC)`; SHA256 `ba1fa6dbb05f29154cdf812cce47328774e8bdaaee36d47739decce26f702b7c`. Source: `20260525_debug_step2_code_schema_alignment.sql:74`.
- `customer_documents_contract_idx`: `CREATE INDEX customer_documents_contract_idx ON public.customer_documents USING btree (contract_id) WHERE (contract_id IS NOT NULL)`; SHA256 `2d82330db51fd033de04cec4e6f1d9fe9b1db1fa82156827d825e1a6cd68ae4c`. Source: `20260526_batch_3a_3b_customer_intake_blockers_documents.sql:68`.
- `customer_internal_notes_customer_company_created_idx`: `CREATE INDEX customer_internal_notes_customer_company_created_idx ON public.customer_internal_notes USING btree (customer_id, company_id, created_at DESC)`; SHA256 `b3d814b0aa42507d881753856f5fdfe75622c9c6d9d86746c7897f4813193669`. Source: `20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql:233`.
- `mt_customer_match_review_cases_company_id_id_uidx`: `CREATE UNIQUE INDEX mt_customer_match_review_cases_company_id_id_uidx ON public.customer_match_review_cases USING btree (company_id, id)`; SHA256 `f9668210da9405f5dcc943a9206d4471a744e464705a2c1ad51d10dce69da9ab`. Source: `20260801143000_canonical_multitenant_platform_hardening.sql:172–204`.
- `mt_customer_onboarding_applications_company_id_id_uidx`: `CREATE UNIQUE INDEX mt_customer_onboarding_applications_company_id_id_uidx ON public.customer_onboarding_applications USING btree (company_id, id)`; SHA256 `f57bf010b399f2bbf3b7e77d85dda27e9d16c9becfba9edbce1b328b94227513`. Source: `20260801143000_canonical_multitenant_platform_hardening.sql:172–204`.
- `mt_customer_onboarding_legal_snapshots_company_id_id_uidx`: `CREATE UNIQUE INDEX mt_customer_onboarding_legal_snapshots_company_id_id_uidx ON public.customer_onboarding_legal_snapshots USING btree (company_id, id)`; SHA256 `81b68cb0b145004f2215d8f8e964ff6b07bd6c1dc4902715b194ad846e16426c`. Source: `20260801143000_canonical_multitenant_platform_hardening.sql:172–204`.
- `idx_customer_portal_accounts_company_customer`: `CREATE INDEX idx_customer_portal_accounts_company_customer ON public.customer_portal_accounts USING btree (company_id, customer_id)`; SHA256 `e08533579d7254c3a08300e7db42649d83859e38358503878e48c84853a2b384`. Source: `20260526_debug_step1_2c_full_schema_code_alignment.sql:113`.
- `idx_customer_portal_claims_company_customer`: `CREATE INDEX idx_customer_portal_claims_company_customer ON public.customer_portal_claims USING btree (company_id, customer_id)`; SHA256 `9fd30a98a9be82e87b10c92ee19953b96d268beb70a975dcce8ddb8f7bd34b17`. Source: `20260526_debug_step1_2c_full_schema_code_alignment.sql:118`.
- `idx_customer_portal_events_company_customer_created`: `CREATE INDEX idx_customer_portal_events_company_customer_created ON public.customer_portal_events USING btree (company_id, customer_id, created_at DESC)`; SHA256 `f729bedbbd8a10f2ec27a007d387a239ce36b6ec00034751786c85b9c7fbd7e9`. Source: `20260526_debug_step1_2c_full_schema_code_alignment.sql:123`.
- `customer_sites_company_customer_created_idx`: `CREATE INDEX customer_sites_company_customer_created_idx ON public.customer_sites USING btree (company_id, customer_id, created_at DESC)`; SHA256 `1f6a15713dc557f5469819aee2df1a6a873f2d9fda4f2ebeb3c65a0fbafff10a`. Source: `20260713150000_api_performance_tenant_hardening.sql:172`.
- `idx_customer_sites_company_id_id_uidx`: `CREATE UNIQUE INDEX idx_customer_sites_company_id_id_uidx ON public.customer_sites USING btree (company_id, id)`; SHA256 `330731393649be7f9f74ee30e01eded7480851950e7db1c3838a78bc0c3faa97`. Source: `20260615_multitenant_integrity_and_claim_locks.sql:37–60`.
- `customer_sites_company_customer_idx`: `CREATE INDEX customer_sites_company_customer_idx ON public.customer_sites USING btree (company_id, customer_id)`; SHA256 `c4f2b96bc4e3c57abe4602753613c32212d1a6524ab159781d4256c4b43c29a7`. Source: `20260522_batch4_multisite_duplicate_billing_hardening.sql:117`.
- `customer_sites_customer_company_idx`: `CREATE INDEX customer_sites_customer_company_idx ON public.customer_sites USING btree (customer_id, company_id, created_at DESC)`; SHA256 `18c60b96002d3a5c708c2412bf1823422cb7d4c286a9894b6fdd454db80083c2`. Source: `20260525_debug_step2_code_schema_alignment.sql:71`.
- `idx_customers_company_id_id_uidx`: `CREATE UNIQUE INDEX idx_customers_company_id_id_uidx ON public.customers USING btree (company_id, id)`; SHA256 `d39d36b3bdeb80abaefb6e0ff6be154dce3b90bb3a4e27f54fdf5a23f19298dd`. Source: `20260615_multitenant_integrity_and_claim_locks.sql:37–60`.
- `customers_company_status_idx`: `CREATE INDEX customers_company_status_idx ON public.customers USING btree (company_id, status)`; SHA256 `abdff6f970c52cb36b637560e3b6ba196a16d84407f4dd1e562e104562b94ee7`. Source: `20260519_customer_intake_contracts_tenant_hardening.sql:207`.
- `ediel_actor_settings_company_env_active_idx`: `CREATE INDEX ediel_actor_settings_company_env_active_idx ON public.ediel_actor_settings USING btree (company_id, environment, is_active, updated_at DESC)`; SHA256 `c87b2f06f3e47c1f6bebb4b8e69c34bf1706e4f498ae22916368f4e1b706f0ba`. Source: `20260519_ediel_tenant_profile_runtime_sync.sql:62`.
- `idx_ediel_inbound_cases_company_status_created`: `CREATE INDEX idx_ediel_inbound_cases_company_status_created ON public.ediel_inbound_cases USING btree (company_id, status, created_at DESC)`; SHA256 `9de29cf1c86b5356bf6ce29d9f4ffce1f5c3e7070ee20c5622c01ddca1fef6b3`. Source: `20260526_debug_step1_2c_full_schema_code_alignment.sql:106`.
- `idx_ediel_mailboxes_company_active`: `CREATE INDEX idx_ediel_mailboxes_company_active ON public.ediel_mailboxes USING btree (company_id, is_active, environment)`; SHA256 `0dac88968f297ddd3784c9d11451f86b2fd0cb4330afe50807c2f7339e47d54e`. Source: `20260528_batch_7a_route_inbound_mail_platform_ui.sql:148`.
- `idx_ediel_messages_company_id_id_uidx`: `CREATE UNIQUE INDEX idx_ediel_messages_company_id_id_uidx ON public.ediel_messages USING btree (company_id, id)`; SHA256 `6d6570f10efd9d01f955714cc40f5a7d85397a194ad10e43890c7d97d255253d`. Source: `20260615_multitenant_integrity_and_claim_locks.sql:37–60`.
- `ediel_route_profiles_company_id_idx`: `CREATE INDEX ediel_route_profiles_company_id_idx ON public.ediel_route_profiles USING btree (company_id)`; SHA256 `7834af430fccd0ab14d2b34676ffbbdc4fc5e8b08e1c55b1b219914ce157577c`. Source: `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql:220–267`.
- `ediel_test_artifacts_run_idx`: `CREATE INDEX ediel_test_artifacts_run_idx ON public.ediel_test_artifacts USING btree (test_run_id, artifact_type)`; SHA256 `ca4cdfaf9c6c0de2cb4de2e7e56cd20e0723d191b7766fe43c6f152d127b32ff`. Source: `20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql:316`.
- `ediel_test_run_messages_company_id_idx`: `CREATE INDEX ediel_test_run_messages_company_id_idx ON public.ediel_test_run_messages USING btree (company_id)`; SHA256 `89c38ef54fdbc346ba5452a0081b8e2589b3069b3b673d342fddcd69f3b09a7b`. Source: `20260513_ediel_agt_saas_runtime_safe.sql:13–39`, `20260519_ediel_tenant_profile_runtime_sync.sql:9–26`.
- `ediel_test_runs_company_case_idx`: `CREATE INDEX ediel_test_runs_company_case_idx ON public.ediel_test_runs USING btree (company_id, test_suite, role_code, test_case_code, status, created_at DESC)`; SHA256 `f0cbeb9dc7359a40bdab29ced262d92271d3a3ab30b49e6fe16e6531babcc32c`. Source: `20260521_actor_testing_engine_automation.sql:17`.
- `electricity_suppliers_company_org_idx`: `CREATE INDEX electricity_suppliers_company_org_idx ON public.electricity_suppliers USING btree (company_id, org_number)`; SHA256 `3097f6eb62777a7bf2bb83943b4903c4879a400f32d6be1e2f09b9a14de048ec`. Source: `20260528_batch_1_customer_flow_masterdata_preflight.sql:96`.
- `idx_fk_inbound_processing_jobs_ad4a712841cf1a93`: `CREATE INDEX idx_fk_inbound_processing_jobs_ad4a712841cf1a93 ON public.inbound_processing_jobs USING btree (inbound_email_message_id)`; SHA256 `84e556fd0cb8859b66903337e74c5ea589975e82defa8ff25193eafa7fc29c7e`. Source: `20260813070046_gridex_review_hardening_v2.sql:111–157`.
- `metering_points_site_company_created_idx`: `CREATE INDEX metering_points_site_company_created_idx ON public.metering_points USING btree (site_id, company_id, created_at DESC)`; SHA256 `c8fa50548d7f1abec370496767c97ccd66a4121efb1f7efc460699987c122a2d`. Source: `20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql:230`.
- `idx_metering_points_company_id_id_uidx`: `CREATE UNIQUE INDEX idx_metering_points_company_id_id_uidx ON public.metering_points USING btree (company_id, id)`; SHA256 `64fef14dce5dd39c46b55631a02097f66cbda745dcd9a3609e8a0aa6453c9afc`. Source: `20260615_multitenant_integrity_and_claim_locks.sql:37–60`.
- `partner_exports_company_id_idx`: `CREATE INDEX partner_exports_company_id_idx ON public.partner_exports USING btree (company_id)`; SHA256 `917267c39742c03cddba6fa65b8e72530085f0c3cff844a9ca860b664ef83451`. Source: `20260519_batch_6c_metering_billing_readiness.sql:11–21`, `20260519_customer_intake_contracts_tenant_hardening.sql:11–33`, `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql:220–267`.
- `power_of_attorney_scopes_company_poa_idx`: `CREATE INDEX power_of_attorney_scopes_company_poa_idx ON public.power_of_attorney_scopes USING btree (company_id, power_of_attorney_id)`; SHA256 `5bdbecfba35694b3bdf719ec81e3f3d0c44d1a12bf55d92eab0323c0bc823f27`. Source: `20260522_batch4d_merge_poa_lifecycle_hardening.sql:92`, `20260522_batch4_multisite_duplicate_billing_hardening.sql:140`.
- `powers_of_attorney_customer_company_created_idx`: `CREATE INDEX powers_of_attorney_customer_company_created_idx ON public.powers_of_attorney USING btree (customer_id, company_id, created_at DESC)`; SHA256 `73fa70a28a57b7b8543debc42ca2c54eb0815b0fdf0f5ecdde57eeb3c2206e75`. Source: `20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql:239`.
- `role_permissions_role_id_permission_id_key`: `CREATE UNIQUE INDEX role_permissions_role_id_permission_id_key ON public.role_permissions USING btree (role_id, permission_id)`; SHA256 `884407c14159d9339bd778a74559ccba43777b1690882e864ff80328b835a77f`. Source: `20260909120000_canonical_role_permission_uniqueness_reconstruction.sql:53`.
- `supplier_switch_events_request_company_created_idx`: `CREATE INDEX supplier_switch_events_request_company_created_idx ON public.supplier_switch_events USING btree (switch_request_id, company_id, created_at DESC)`; SHA256 `53c7ff60be75e53cddc0b94d9f871447d58643aa41a97dd5337da42f78498ea2`. Source: `20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql:267`.
- `supplier_switch_events_company_id_idx`: `CREATE INDEX supplier_switch_events_company_id_idx ON public.supplier_switch_events USING btree (company_id)`; SHA256 `a185a7a223993b306a21645136bf0cf60cab9d257a9bd3a6f5372bd27de8ec44`. Source: `20260519_customer_intake_contracts_tenant_hardening.sql:11–33`, `20260519_final_saas_hardening.sql:84–115`, `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql:220–267`.
- `supplier_switch_requests_customer_company_created_idx`: `CREATE INDEX supplier_switch_requests_customer_company_created_idx ON public.supplier_switch_requests USING btree (customer_id, company_id, created_at DESC)`; SHA256 `58bc82182f0fd66877502b74e4f4a47c9122a6a30da6d0806dd201bd7efcc283`. Source: `20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql:264`.
- `user_roles_user_active_idx`: `CREATE INDEX user_roles_user_active_idx ON public.user_roles USING btree (user_id, status, is_active)`; SHA256 `a0bfa51c2fc9b7b0343a1026cba850e4005282ede4b49e1b670341f6c543e1c2`. Source: `20260528_final_user_access_schema_safe_repair.sql:44`, `20260525_debug_batch_2_rbac_tenant_alignment.sql:97`.

## Removed definition hashes and creation provenance

- `billing_underlays_company_id_id_uidx`: SHA256 `0e8b473caad9e07ea62a60853b643a38a5f371f4176543b3eb86b4575548d2cf`. 20260712100000_gridex_end_to_end_integrity_hardening.sql:849.
- `idx_fk_communication_routes_c480f168f3a2d2ce`: SHA256 `cdcbb653dc499f71f926fd60abc17cdf29f43335c23e52bda93768a6a4ece2a3`. FK16 communication_routes_company_id_fkey @schema:84369.
- `idx_fk_company_invitations_f8224bba7b9905b6`: SHA256 `6e0c99c8ee0474d6e6d9531270447029b318854fec2b91e1360fb64daed53b19`. FK16 company_invitations_company_id_fkey @schema:84488.
- `contract_price_snapshots_company_id_id_uidx`: SHA256 `57ba039d5a448b3772c9c356684871f21acf081210107c0b985c4eecf9c27be6`. 20260805085617_api_contract_billing_tenant_hardening.sql:164.
- `idx_fk_customer_addresses_2273b0fd6c9de3b7`: SHA256 `615f5aee49399047b64813bb7d30f1ec60427b615082db1f359e46b7a5d78c05`. FK16 customer_addresses_company_id_fkey @schema:84929.
- `idx_fk_customer_addresses_8e2eee06b13f`: SHA256 `a575868e2a15b1c428405ce02e3c61f70d7eb8ff61a3b8e446590078baf5fed8`. FK12 customer_addresses_customer_id_fkey @schema:84943.
- `idx_fk_customer_authorization_documen_d344d341da50d408`: SHA256 `4dbecb3087baf87f167efe03ac422a3008c3db05296144aca5c2eac17b0cbcf3`. FK16 customer_authorization_documents_company_id_fkey @schema:85076.
- `idx_fk_customer_authorization_documen_e1f9ff94f907`: SHA256 `1efe81866119313f7235c771e815783f634fca54622e879730164050c89087b9`. FK12 customer_authorization_documents_customer_id_fkey @schema:85090.
- `idx_fk_customer_contacts_1ac096eddd3c`: SHA256 `f9f7863c10aca3e8885e6d9e1b37de1f435dcbe4577963176666a8dcc842c532`. FK12 customer_contacts_customer_id_fkey @schema:85195.
- `idx_fk_customer_contacts_927b5ec6a2d5`: SHA256 `ff00f256cb260f54c1e2d5ea2df8ae294d87e630905eb478ba9539cbeffa5610`. FK12 customer_contacts_company_id_fkey @schema:85181.
- `idx_fk_customer_contract_events_c58810ea8e80`: SHA256 `f438d80fb8429b24d4ddde172566e8b87eb507ec80b02e848967b497141bee27`. FK12 customer_contract_events_company_id_fkey @schema:85237.
- `customer_contracts_company_id_id_uidx`: SHA256 `e9c2ab887789d303981be2433832d210eeccb0b16c413c37defab89f6ab58495`. 20260712100000_gridex_end_to_end_integrity_hardening.sql:392; 20260727010000_contract_flow_integrity_completion.sql:242; 20260805085617_api_contract_billing_tenant_hardening.sql:162.
- `idx_fk_customer_contracts_2ff34cd0c61b`: SHA256 `9de7087c531bcd7fdf4a73f570e610d2f7d3854cf77ffdb74d81cfc82e55dc46`. FK12 customer_contracts_company_site_alias_fkey @schema:85342.
- `idx_fk_customer_contracts_53f7340bd979`: SHA256 `8d981da90166c19276d51933f2ed8e60ff3bf086af2072aee69a048f7319ab79`. FK12 customer_contracts_company_meter_fkey @schema:85335.
- `idx_fk_customer_contracts_e9f3ff07eed1`: SHA256 `8c7fc976c6b99c41aa57f720902a40023da64975a2b5072c9fc0eb9191f1cfce`. FK12 customer_contracts_customer_id_fkey @schema:85356.
- `idx_fk_customer_documents_e3ef31b05dd6`: SHA256 `75aea092e776e053a176dbd8f1a6a21fd8f9faf0b2736084ed0b2c4c6878d133`. FK12 customer_documents_contract_id_fkey @schema:85447.
- `idx_fk_customer_internal_notes_7539678d755e`: SHA256 `fe313266c0fc189cdfc5ddde81d294d1394d2d2f4ec1f055ddae5cd762374138`. FK12 customer_internal_notes_customer_id_fkey @schema:85594.
- `idx_fk_customer_match_review_cases_327b398772ef`: SHA256 `007bf7b0dfa36c4ee6d66e9224ba9044012dc18aa619c79fa7dba3bbd34ad96d`. FK12 customer_match_review_cases_company_id_fkey @schema:85804.
- `idx_fk_customer_onboarding_applicatio_8eda8d8d0284`: SHA256 `637cdcc9b78158ab58a4632299b833a227d5f5b5f47817c2a6bd8e39d4146cc9`. FK12 customer_onboarding_applications_company_id_fkey @schema:85867.
- `idx_fk_customer_onboarding_legal_snap_c8fbf8b07583`: SHA256 `490b85925f91122c6082cd10ff73b2c7a70434fe8a8a6adcab198229f1925a56`. FK12 customer_onboarding_legal_snapshots_company_id_fkey @schema:85923.
- `idx_fk_customer_portal_accounts_2762e063db9c3554`: SHA256 `fde2dba633758a900e1348d32a9bb775a78e2a6148bc4142ce4ed74ecb85ed7d`. FK16 customer_portal_accounts_company_id_fkey @schema:86126.
- `idx_fk_customer_portal_claims_12ac8f79e4c7`: SHA256 `09d5374ff5df0b46b67af4f78121feeced557dc921d7915494e06ca5c7c24e7e`. FK12 customer_portal_claims_company_id_fkey @schema:86168.
- `idx_fk_customer_portal_events_8e4d7eb53c00`: SHA256 `7eda2a969222a1b1deeb22765f3dae9b7d4842194b15f1aded218b7e39ac27fb`. FK12 customer_portal_events_company_id_fkey @schema:86224.
- `customer_sites_company_customer_created_perf_idx`: SHA256 `64dc848f4d3e9b795549d95fbbec2b65b9a43cf1bd4258db184486218c839dad`. 20260612100000_performance_batch_1a_1b_2_tenant_admin_speed.sql:23.
- `customer_sites_company_id_id_uidx`: SHA256 `7f939114ad917667549fc2feb4e83f983cb4287e358e5f617ec9bf70195c3377`. 20260712100000_gridex_end_to_end_integrity_hardening.sql:390.
- `idx_customer_sites_company_customer`: SHA256 `bb1d69ec1f60acd32cef289a1b6437b4e964301728fc3808081b3ccc59f7739b`. 20260522_db1_schema_repair_backfill_foundation.sql:2095; 02_db1_operations_ediel_billing_dedupe_and_storage.sql:942.
- `idx_fk_customer_sites_b6a0f5f2ef9f`: SHA256 `4f85ac6622fc0e2221670c0c383a02dde710f1714fad9dea15d976bb23c7c355`. FK12 customer_sites_customer_id_fkey @schema:86441.
- `customers_company_id_id_uidx`: SHA256 `6e83dd490a49fd8afd31d1d98221ec13768b66f830054d37efe18556ad10889d`. 20260712100000_gridex_end_to_end_integrity_hardening.sql:389.
- `idx_customers_company_status`: SHA256 `076b31164c8bdba5f0b913eef8646b18adadb8af8555ccecda20033eef62106f`. 20260531160000_analytics_forecasting_module.sql:427.
- `ediel_actor_settings_company_environment_active_idx`: SHA256 `9616f06e116fc015cb80c8ee47de9bb350ba5a11d1a970950f63ca13e6a6839e`. 20260601070000_ediel_production_readiness_hardening.sql:164; 20260520_batch_1_2_saas_ediel_control_center.sql:45; 20260601173000_ediel_final_hardening_schema_patch.sql:40.
- `idx_fk_ediel_inbound_cases_c5b967b457ab`: SHA256 `5c4d4aee1c6144e9201266b04610837b3c6f375dd7a93632214d61aa1ad5ee43`. FK12 ediel_inbound_cases_company_id_fkey @schema:87085.
- `idx_fk_ediel_mailboxes_8bfd03acd32f`: SHA256 `6b5b36be0d79fcbcf0e1a2dee2dbafaa563f0e20cd09b5822a44acb86b1a73bc`. FK12 ediel_mailboxes_company_id_fkey @schema:87127.
- `ediel_messages_company_id_id_uidx`: SHA256 `85feb972749f5c7000e9fd12942d7d467f1b6a067d0fb480fed6b3c00c7f0c57`. 20260802013000_ediel_test_evidence_v2.sql:106.
- `idx_fk_ediel_route_profiles_a0070f5027fa`: SHA256 `b3e8af83e9fe974d7e8c305b9f0ddbad9c6fc0782f45a675c3d9e7d9c15bccec`. FK12 ediel_route_profiles_actor_setting_id_fkey @schema:87533.
- `idx_fk_ediel_route_profiles_e6fd37257b0dc943`: SHA256 `f064078acb87b82e426d6e11903568bd53b67c87dd80d564ed4cc2c4a9921202`. FK16 ediel_route_profiles_company_id_fkey @schema:87547.
- `idx_fk_ediel_test_artifacts_ea1a932d1ad5`: SHA256 `72f15bba48f315b096d9061e552949d8b0c5ec6a8e51f33c222e48c6dd7432a6`. FK12 ediel_test_artifacts_test_run_id_fkey @schema:87820.
- `idx_fk_ediel_test_run_messages_fc5e6112445d`: SHA256 `5b27baf0b8e4792757feb920b89e1b88a5f43bd73537ffff34f3c9af01037694`. FK12 ediel_test_run_messages_company_id_fkey @schema:87834.
- `ediel_test_runs_company_suite_case_status_idx`: SHA256 `f327a48b1039fe625ff20654f37f9a4ac0055ca90bc365d4f9f471c5ae392cd2`. 20260521_actor_testing_go_live_module.sql:188.
- `idx_fk_electricity_suppliers_b42e7893b5c6`: SHA256 `c71444eb12cb8000e72b9c436e3e18c2ed17f666c7f69f5c0af6b327e6c3fb78`. FK12 electricity_suppliers_company_id_fkey @schema:88002.
- `idx_fk_inbound_processing_jobs_bfc543e1d238`: SHA256 `bf759dd17a20b89ac7a63f77dea37ffd84b891efda2e3b6cb4c261e462dd0184`. FK12 inbound_processing_jobs_inbound_email_message_id_fkey @schema:88387.
- `idx_fk_metering_points_5eef380678f1`: SHA256 `436bf2aa167ee2f281fb9405bd6d4d2a6fc3b2e9f3058395d517d9b86911ac91`. FK12 metering_points_site_id_fkey @schema:88989.
- `metering_points_company_id_id_uidx`: SHA256 `10bbb57cd9ca944bb9defccd9fadb3b6e965aa6a618f32af919f52665f7e1e65`. 20260712100000_gridex_end_to_end_integrity_hardening.sql:391.
- `idx_fk_partner_exports_b6acc04fdc7a`: SHA256 `917a0ab577ae65168497cfb12a63078086095bf4006140b604c51c9da38f79fd`. FK12 partner_exports_company_id_fkey @schema:89192.
- `idx_fk_power_of_attorney_scopes_3776412a3611`: SHA256 `c0c028b274643c64da61e216157e9b1b22791afb4aff30b5f491d943ef04850a`. FK12 power_of_attorney_scopes_company_id_fkey @schema:89626.
- `idx_fk_powers_of_attorney_50a4d1dbf8f2`: SHA256 `83ba7d838f810fe2598149e6af6df78436e74d5319d688f6363311c221ea2d69`. FK12 powers_of_attorney_customer_id_fkey @schema:89682.
- `idx_fk_powers_of_attorney_52ee8c8f7b14`: SHA256 `2a4b1f67816f8eaa81b2fb42256e1d1275398e30fab23e410767ff82004563c6`. FK12 powers_of_attorney_contract_id_fkey @schema:89668.
- `idx_fk_role_permissions_20e81c089f52`: SHA256 `25031591ab44a687fd87e0d9f3c86ab83c6fdddec5b8e19862d66f6f0f5201a1`. FK12 role_permissions_role_id_fkey @schema:90032.
- `idx_fk_supplier_switch_events_7968f62c2d6d`: SHA256 `5271e75dfb89c28a1677fa5ba44f51761c8980fe460787809195f311fabc419d`. FK12 supplier_switch_events_switch_request_id_fkey @schema:90067.
- `idx_fk_supplier_switch_events_f00c2ad07fbf`: SHA256 `cee311f33bfe5cf6bce9e066edf6db77b7ff7f0adfb15e2c3f4a83ea19003e51`. FK12 supplier_switch_events_company_id_fkey @schema:90060.
- `idx_fk_supplier_switch_requests_dc4616ff73c5`: SHA256 `d529910508cbb61c488f9d103f52ddd1517d0baf43b01aa39616d09fdc8f5f17`. FK12 supplier_switch_requests_customer_id_fkey @schema:90123.
- `gridex_perf_user_roles_user_status_active_idx`: SHA256 `2116d649b013eb8a959855a1cb0d7a529d2442feb66f4ab7b3e878f091fbbe44`. 20260612123000_performance_batches_1_to_3_db_acceleration.sql:161.

## Five changed definitions

### customers_company_customer_number_idx

Reference (`schema.sql:74053`; SHA256 `9507d483b12b7b123f31a9c2d75b07828034c5f3181835865ab49c3c205ace0d`):

```sql
CREATE INDEX customers_company_customer_number_idx ON public.customers USING btree (company_id, customer_number) WHERE (customer_number IS NOT NULL);
```

Replay (SHA256 `80986ba2b708d604cbe6b5714a94b75492ed69f1e27e37e06c8cd95cebb2eb3a`):

```sql
CREATE INDEX customers_company_customer_number_idx ON public.customers USING btree (company_id, customer_number);
```

### customers_company_email_idx

Reference (`schema.sql:74071`; SHA256 `fe4e32834b83defe0535aa8a35c3bfe34c51464d86d8834f72a6cd764795d3e2`):

```sql
CREATE INDEX customers_company_email_idx ON public.customers USING btree (company_id, lower(email)) WHERE (email IS NOT NULL);
```

Replay (SHA256 `7edb8f261d8bafb50f7abba57968a061c1f453afa360648b78d4729ce8bdfce1`):

```sql
CREATE INDEX customers_company_email_idx ON public.customers USING btree (company_id, lower(email));
```

### customers_company_email_lower_idx

Reference (`schema.sql:74077`; SHA256 `5bab9fae4c5aa0c19d72b5cafb651c87931d969509574cf990628573c85aa5e9`):

```sql
CREATE INDEX customers_company_email_lower_idx ON public.customers USING btree (company_id, lower(email));
```

Replay (SHA256 `0a290d46c4577885922a088aa1eaf9b09fff3308e068ce3aedc5b726d808daa3`):

```sql
CREATE INDEX customers_company_email_lower_idx ON public.customers USING btree (company_id, lower(email)) WHERE (email IS NOT NULL);
```

### customers_company_intake_status_idx

Reference (`schema.sql:74095`; SHA256 `11354499eda7a699b91424b1c8d2a6aca98978388bd1105f9c41ad364b221ab7`):

```sql
CREATE INDEX customers_company_intake_status_idx ON public.customers USING btree (company_id, intake_status, updated_at DESC) WHERE (intake_status IS NOT NULL);
```

Replay (SHA256 `292a1e5d54c63680ae79894733dec08aa76646b1aed15858b923103dd0fe8ac1`):

```sql
CREATE INDEX customers_company_intake_status_idx ON public.customers USING btree (company_id, intake_status, created_at DESC);
```

### user_roles_company_user_role_active_uidx

Reference (`schema.sql:81637`; SHA256 `54c3122642e0e9a69a46483b294132ad649277492af9a31f5975cbba70860e1a`):

```sql
CREATE UNIQUE INDEX user_roles_company_user_role_active_uidx ON public.user_roles USING btree (company_id, user_id, role_id) WHERE ((company_id IS NOT NULL) AND (user_id IS NOT NULL) AND (role_id IS NOT NULL) AND (COALESCE(status, 'active'::text) = 'active'::text) AND COALESCE(is_active, true));
```

Replay (SHA256 `1857f76944b1e8070a426c4c1f8afe70a8f71e133581e6cf9d420c8238546888`):

```sql
CREATE UNIQUE INDEX user_roles_company_user_role_active_uidx ON public.user_roles USING btree (company_id, user_id, role_id) WHERE ((company_id IS NOT NULL) AND (user_id IS NOT NULL) AND (role_id IS NOT NULL) AND (COALESCE(status, 'active'::text) = 'active'::text) AND (COALESCE(is_active, true) = true));
```

## Changed-definition dispositions and application checks

- `customers_company_customer_number_idx`: May19 `20260519_operations_core_saas_sync.sql:58–59` creates the unfiltered nonunique index. June17 `20260617170000_customer_portal_external_auth_account_repair.sql:16` requests a non-null partial index only IF NOT EXISTS. The earlier unfiltered index covers those lookups and additional null rows. No uniqueness or required access path is lost.
- `customers_company_email_idx`: `20260519_customer_intake_contracts_tenant_hardening.sql:208` creates the unfiltered lower(email) index; June17 repair line17 requests the partial form only IF NOT EXISTS. No uniqueness loss. `customers_company_email_lower_idx` has the reverse name-specific difference: May21 debug:45–46 creates the partial form, while `20260608170000_batch_1_9_operations_integration_foundation.sql:203` requests an unfiltered index under IF NOT EXISTS. Across both names the exact filtered/unfiltered expression access paths remain available.
- `customers_company_intake_status_idx`: `20260521_batch_customer_intake_debug_hardening.sql:43–44` creates `(company_id,intake_status,created_at DESC)` unfiltered. Later `20260610123000_customer_application_review_flow.sql:72–73` and `20260610171000_customer_application_status_hardening.sql:79–81` request the updated_at/non-null form with IF NOT EXISTS. This is a real ordering/predicate difference, not uniqueness loss. Current customer-list query orders created_at (`lib/customers/getCustomers.ts:353–366`), but that is not proof for every intake-specific workload. Updated_at-leading sort equivalence and performance remain unproved; require actual query/EXPLAIN evidence before remediation.
- `user_roles_company_user_role_active_uidx`: `20260528_final_user_access_schema_safe_repair.sql:51–57` creates `coalesce(is_active,true)=true`; `20260802203000_canonical_runtime_consistency_hardening.sql:68–71` requests bare `coalesce(is_active,true)` only IF NOT EXISTS. COALESCE with true is non-null boolean: both predicates return identical results for true, false and null inputs. All remaining predicate terms, unique flags and keys are identical. No change in admitted rows or uniqueness is established.

## Open access-path qualifications

1. `ediel_route_profiles(actor_setting_id)`: the removed full index matches the single FK name suffix. The single FK is separately identified as a skipped existing-column REFERENCES effect; its forward candidate remains independently staged. No surviving or added actor_setting_id-leading index was found. The reviewed environment resolver selects actor_setting_id but filters company_id/is_enabled (`lib/ediel/customerInfoEnvironmentResolver.ts:123–128`), so this index loss does not by itself break that query. Assess the restored FK parent-delete/update lookup path after actual candidate integration; recreate only if justified by required indexing policy/query evidence.
2. `powers_of_attorney(contract_id)`: the removed single-FK index is absent alongside `powers_of_attorney_contract_id_fkey`. Added `idx_fk_powers_of_attorney_a4d711528926a49c` is exactly `(company_id,contract_id)`, SHA256 `f6aa03c855121f7853a2a94f843a9a80aedbec0e96b081965addb31610eabe28`, not contract-leading. Other three added dynamic indexes are `(company_id,metering_point_id)`, `(company_id,customer_site_id)`, `(company_id,site_id)` by hash reconstruction. The source composite guard is `20260801143000_canonical_multitenant_platform_hardening.sql:284,348–363`; reference single FK is `schema.sql:89669`. `20260528_debug_post_repair_schema_guardrails.sql:242` supplies contract_id without a reference before `20260613090000_batch_m_ops_master_legal_readiness.sql:182` requests it via ADD COLUMN IF NOT EXISTS. Runtime POA lookup supplies company/customer and optional contract (`lib/website/customerApplicationLegal.ts:953–964`, `lib/customer-portal/tenantSync.ts:684–693`), with retained company-prefixed indexes. No measured slowdown or supported-write defect is established. Single-FK action parity is separate from this nonunique-index disposition and remains unresolved here.
3. `customer_documents_contract_idx` is partial `contract_id IS NOT NULL`; it covers ordinary non-null contract lookup keys but is not equivalent to a full index for IS NULL workloads. Earlier FK12 logic can mistake partial coverage for complete coverage. The source FK repair and query plans must be qualified separately. No uniqueness loss exists in either index.

## Verification and limits

- Read all51 removed definitions from pinned schema.sql and matched all51 complete index-row SHA256 values.
- Reconstructed all5 changed replay definitions and matched all10 reference/replay hashes.
- Matched48 added replacement row hashes and identified1 unchanged exact replacement;2 open access paths remain. Wider-prefix/partial coverage does not claim equal execution plans, bloat, costs, or latency. PostgreSQL17 documents the leading-column behavior of [multicolumn indexes](https://www.postgresql.org/docs/17/indexes-multicolumn.html) and predicate requirements for [partial indexes](https://www.postgresql.org/docs/17/indexes-partial.html).
- Canonical row fields: `nspname,relname,indexname,definition,indisunique,indisprimary`. Hash bytes use `json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()`, matching canonical-full-schema-reference.py. Hash reconstruction establishes exact emitted definitions, not unexported index validity/readiness/storage statistics.
- No database queries, EXPLAIN, data mutations, new indexes, source/reference edits, or production access. Only this audit file was authored. Performance and remaining FK-action questions are explicitly open.

Keep all existing acceptance gates and reference artifacts unchanged. Use narrowly scoped forward changes only after a concrete missing behavior or access-path requirement is independently qualified.

## Reviewed SQL source hashes

Reference `supabase/schema.sql`: SHA256 `b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30`. Whole-file hashes below pin the source excerpts cited in this audit; they do not imply each source executed in native CI.

- `02_db1_operations_ediel_billing_dedupe_and_storage.sql`: `0413f4dca84aca387297954b900a163aa63d0f84552570c372c12e8f8abdd693`.
- `20260513_ediel_agt_saas_runtime_safe.sql`: `152e4e573bde3b50eda8c7e5bfdca6fe4a54115e4ed1d7bcfc8e1b946ed1c15b`.
- `20260519_batch_6c_metering_billing_readiness.sql`: `c44153ba502ab32f543f649d9001bfcc9685d90be054747520c2b11d67bfcb24`.
- `20260519_customer_intake_contracts_tenant_hardening.sql`: `a448184e58e8777c41f8bdefb32e45a1365bd37fd9a8e316065da657e57e19f4`.
- `20260519_ediel_tenant_profile_runtime_sync.sql`: `b5c475b7419c824b4d1c8ec713131d48c41c2be6f5607890bda42f238548426e`.
- `20260519_final_saas_hardening.sql`: `2037dbc535d18d7575820d7f40d2a8ef4848b67060161e6851a01eb15990105e`.
- `20260519_operations_core_saas_sync.sql`: `e5863b15ec8c25794912b50c36eda6a370f3fb288800339a0bcfb16f2a3bb619`.
- `20260520_batch_1_2_saas_ediel_control_center.sql`: `7a198e941bbd735c0f56191d5ecf41cc85de03bbd89cea4f0b3369981127cdc8`.
- `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql`: `47c24a0340da00d3ab765d87efdfcf17622a12102af3bf29c2327db5f4500c64`.
- `20260520_company_delete_backfill_and_admin_layout.sql`: `72aef3d5609bd6a508299bccf1eed849b58a4f925844b097d44bb8bdca667d1f`.
- `20260521_actor_testing_engine_automation.sql`: `09375322da56354534ab97ed5a1742eebcc7a7f06e45cc8a39c5d6b4ae04e50e`.
- `20260521_actor_testing_go_live_module.sql`: `94e7fc8168c5d17925c61a4985a889db1dd8a823ce3477ded9fdbdab6cdc7c08`.
- `20260521_batch_customer_intake_debug_hardening.sql`: `562c2447554c43a3aef96bbbcd88a9f36ad1cc884ba97268ca96bc455ec54e80`.
- `20260522_batch4_multisite_duplicate_billing_hardening.sql`: `b8e38ec7d99cd12e4bcd9310bd3ed1b2c589ea04f7140768435b0b3de9d62355`.
- `20260522_batch4d_merge_poa_lifecycle_hardening.sql`: `2e346a108ec1ce7583d50b6a46d92302cfe24ab65f5c43dd6cfabf9acaae78fe`.
- `20260522_db1_schema_repair_backfill_foundation.sql`: `aff5a3e4fb3aae6ebe682081cbce4876c5731be1c124650b19d8151abf6efc73`.
- `20260525_debug_batch_2_rbac_tenant_alignment.sql`: `cba0a78a519d84b44585133046c56117bf05674c1834467eb8b78fbc1d79cb7d`.
- `20260525_debug_step2_code_schema_alignment.sql`: `e7be5cf935817846dcbe65e64c3b3d558d5e442c9bf7f7af5863f2180f108f04`.
- `20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql`: `afd5c2693cbb1a9f9bd40055cd993189e0118d4871bbb2bfcfb18e4124c2fcb2`.
- `20260526_batch_3a_3b_customer_intake_blockers_documents.sql`: `fad2a3336c1bab86cd67d05d5f965643589864c259b500eb67bbafbcaa78cba8`.
- `20260526_debug_step1_2c_full_schema_code_alignment.sql`: `5a4a2326232ab847d23fed32af2be13a046ee3e3a2dae41dead6f5b4eba16472`.
- `20260528_batch_1_customer_flow_masterdata_preflight.sql`: `08d183bdbb1506958893aada9400982ea58cd2e4c0acec0a886ad83194533135`.
- `20260528_batch_7a_route_inbound_mail_platform_ui.sql`: `a5ca82d1c68f44c8542820e5d209fd5d31356a16e7eb1ccc827843a61e0ba690`.
- `20260528_debug_post_repair_schema_guardrails.sql`: `41e63220e564c6efee26011e65055b95d5f5ca9e60a7c36811ec00e8f69579e6`.
- `20260528_final_user_access_schema_safe_repair.sql`: `4968391d74a8ff813ce1f56a8b8d9ade682692d183988917e736d0f3c5857bd2`.
- `20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql`: `7f71410f8b9f498286226dae76a2bc8ab1073cb43e07442ed8b5e0eb5de869be`.
- `20260531160000_analytics_forecasting_module.sql`: `30e46181444b9fac718d1445356cb26b61c84886fc7a0d644428627e04b035ef`.
- `20260601070000_ediel_production_readiness_hardening.sql`: `7a73e59f559ebb5291d3e7df74545e6918011ec9764e5c512df19fbaa5bdbc12`.
- `20260601173000_ediel_final_hardening_schema_patch.sql`: `cf505ba9f42ff3a423c71b1ab466ce86eb664ec5213f885f11d22a180d4b60c6`.
- `20260608170000_batch_1_9_operations_integration_foundation.sql`: `0646067c2511a6f3c3f7b9019e7f7b14694c458babcd48478fb92cff0e460b41`.
- `20260610123000_customer_application_review_flow.sql`: `55bdc0a98d9a601437738f58cc1380b2828bf817d979e586e038331e0a622caf`.
- `20260610171000_customer_application_status_hardening.sql`: `92c3c134200a9efa9279cf93e76522f55109e7801a6da331c29c057492ddd69f`.
- `20260612100000_performance_batch_1a_1b_2_tenant_admin_speed.sql`: `99ced7de130adeeb57e93bc32ecd692492ecc0916ecdc841d10c2a020196337e`.
- `20260612123000_performance_batches_1_to_3_db_acceleration.sql`: `1711c1f0fb6a50a453db3c66c554c0a0bcd2d4c0b63f96996254707e05ea93a1`.
- `20260612143000_performance_policy_consolidation_and_index_cleanup.sql`: `ff3b3c65b97e36cb6c0bad1f25e4ff332debf3993c845c9856cf4fadea748b60`.
- `20260613090000_batch_m_ops_master_legal_readiness.sql`: `599b707e9f979727fcf39843d88ee376c15409731a780befb01d2ed436ec842d`.
- `20260615_multitenant_integrity_and_claim_locks.sql`: `046c7ec8c885eca46d8dde306bc1b289aa7bccea3f9d4ebdd5f8580c07ca9a37`.
- `20260617170000_customer_portal_external_auth_account_repair.sql`: `0b955fe06c096a1fec5a7a5177cfc33f411b2ec1b27f7fba52f796e14fadb829`.
- `20260712100000_gridex_end_to_end_integrity_hardening.sql`: `02e8e31077ad75ec3e1e753dcea72da819fc5f89484c430f2007e4fbf55e42be`.
- `20260713150000_api_performance_tenant_hardening.sql`: `fcbe6483e7983843f5dc19e913e4f22af86c9b72991d21961e0f97058d6a3009`.
- `20260727010000_contract_flow_integrity_completion.sql`: `392d9e90c4fcec6752644fb75721ed7a113c3dcd2cb68d3185e3bfd44a065c4f`.
- `20260801143000_canonical_multitenant_platform_hardening.sql`: `4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0`.
- `20260802013000_ediel_test_evidence_v2.sql`: `96f058911d2499fdf2f540e7b2db541cbbc0ffd5ba798858b349779497ecf46d`.
- `20260802203000_canonical_runtime_consistency_hardening.sql`: `96a4402e5b642453a7358f55f9a5c93b2559a707df66b958a770318d10412930`.
- `20260805085617_api_contract_billing_tenant_hardening.sql`: `b17abd19803511156eb21902e9d57b4ca8219fef303c9238e33a03a69ff140b7`.
- `20260809180628_gridex_ops_external_api_performance_foundation.sql`: `a9de604f3b34c183299198c741c28710a668f0074b9970eb46b82c947163f51b`.
- `20260812211405_gridex_missing_fk_indexes_v1.sql`: `1e5abc5db8164988866383a38bcabf02c4dc34b89914c3f32c8333c7ddcb93bf`.
- `20260813070046_gridex_review_hardening_v2.sql`: `3e174ee285c0f32dfd223ccdc5c826abc3bd3fe26a362d31c2435ba5f403cfd3`.
- `20260909120000_canonical_role_permission_uniqueness_reconstruction.sql`: `b86f056fb868a3642eb6663068bc1cb4b86d03d430e6a1f339687868ec2773a6`.
