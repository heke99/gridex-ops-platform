"""Exact 362 positive source-authored nonunique index decisions and native witness.
Unique/backing, changed and removed indexes are outside this module.
"""
import hashlib,json
from pathlib import Path
import canonical_policy_actor_qualification as actors
import canonical_intake_jsonb_qualification as transport
ROOT=Path(__file__).resolve().parents[1]
REGISTER='quality/audits/PR310_ADDED_CONSTRAINT_INDEX_INDEXES_2026-09-15.json'
REVIEW='quality/audits/PR310_ADDED_CONSTRAINT_INDEX_INDEXES_2026-09-15.md'
PINS={'quality/audits/PR310_ADDED_CONSTRAINT_INDEX_INDEXES_2026-09-15.json': '29d84d82a626c74da870f708c02f52ea8be507580d4974b0daa0beed12adfb6a', 'quality/audits/PR310_ADDED_CONSTRAINT_INDEX_INDEXES_2026-09-15.md': 'bbb8acd89cffe213e41ad5b78601944f44f983e99616eb8ded0f6ba14aa2e4e9', 'supabase/migrations/20260521_actor_testing_engine_automation.sql': '09375322da56354534ab97ed5a1742eebcc7a7f06e45cc8a39c5d6b4ae04e50e', 'supabase/migrations/20260531111600_system_readiness_foundation.sql': 'e6ef68b18ede5729da067ce59a86cfca0db083d9d54a35ae0ed3a6c0968b96f2', 'supabase/migrations/20260520_batch_1_2_saas_ediel_control_center.sql': '7a198e941bbd735c0f56191d5ecf41cc85de03bbd89cea4f0b3369981127cdc8', 'supabase/migrations/20260519_batch_6c_metering_billing_readiness.sql': 'c44153ba502ab32f543f649d9001bfcc9685d90be054747520c2b11d67bfcb24', 'supabase/migrations/20260519_customer_intake_contracts_tenant_hardening.sql': 'a448184e58e8777c41f8bdefb32e45a1365bd37fd9a8e316065da657e57e19f4', 'supabase/migrations/20260519_final_saas_hardening.sql': '2037dbc535d18d7575820d7f40d2a8ef4848b67060161e6851a01eb15990105e', 'supabase/migrations/20260519_operations_core_saas_sync.sql': 'e5863b15ec8c25794912b50c36eda6a370f3fb288800339a0bcfb16f2a3bb619', 'supabase/migrations/20260519_saas_ui_tenant_admin.sql': '861130aecf1b3c5d400cbf414c8d99e14d21adbd635c9f8ddb0c357c1964009e', 'supabase/migrations/20260520_batch_6e_rbac_tenant_stats_whitelabel.sql': '47c24a0340da00d3ab765d87efdfcf17622a12102af3bf29c2327db5f4500c64', 'supabase/migrations/20260519_auth_callback_email_reset_sync.sql': '59efbf233d314558f8cc7ffbb2b15788cadaaf7ba476e0f80fa1e820299419a9', 'supabase/migrations/20260520_company_delete_backfill_and_admin_layout.sql': '72aef3d5609bd6a508299bccf1eed849b58a4f925844b097d44bb8bdca667d1f', 'supabase/migrations/20260519_auth_email_templates_invite_reset_sync.sql': 'afd045b61276b1c40993bac59c7b94646a8c9e721d80c8f32dfdb3c471a0c137', 'supabase/migrations/20260519_company_invite_temp_password_sync.sql': '09ed878125a71c77c792e004fd1a38c4fa56a0b23e0bc3eafeb62be271c85dc9', 'supabase/migrations/20260812211405_gridex_missing_fk_indexes_v1.sql': '1e5abc5db8164988866383a38bcabf02c4dc34b89914c3f32c8333c7ddcb93bf', 'supabase/migrations/20260528_auth_provisioning_runtime_guard.sql': '0c2455cbc31553f4be1f1a3fa2800f516295c972bcead8fbbd77c448d3f98026', 'supabase/migrations/20260526_batch_3c_3d_fullmakt_data_requests.sql': '20b9beb1536e870b922b455ee1afa53c36797aa6d211e06c75070a3c5eab3b92', 'supabase/migrations/20260609162000_batch_7_website_integration_foundation.sql': '1809f5c8926ec6bda991eb861cc3ba7a24738e8655b47e94f4ab086d5f2afb0b', 'supabase/migrations/20260521_batch3_pricing_billing_audit_roles_completion.sql': '109ddeee3b532c70fc65ac5f920d4eae250a10037afd304ed5d14144cc30e27f', 'supabase/migrations/20260525_debug_fix_batch_1b_schema_code_alignment.sql': 'c846be376c5f878965ea6a831d23611da959d4721cd0ebfb853fa46b10bccf68', 'supabase/migrations/20260521_batch_1_2_live_readiness_and_automation_hardening.sql': '9f741fb9afc07661713e8448cb394f9ec950e25eaf56ee4422b0983886f81c34', 'supabase/migrations/20260526_debug_step1_2c_full_schema_code_alignment.sql': '5a4a2326232ab847d23fed32af2be13a046ee3e3a2dae41dead6f5b4eba16472', 'supabase/migrations/20260615_multitenant_integrity_and_claim_locks.sql': '046c7ec8c885eca46d8dde306bc1b289aa7bccea3f9d4ebdd5f8580c07ca9a37', 'supabase/migrations/20260520_batch_5_cases_audit_email_ux.sql': '0e26b35eef3fa863f149bf4c46be4018ff484d3d55c5434a64323fafde201775', 'supabase/migrations/20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql': 'afd5c2693cbb1a9f9bd40055cd993189e0118d4871bbb2bfcfb18e4124c2fcb2', 'supabase/migrations/20260513_ediel_agt_saas_runtime_safe.sql': '152e4e573bde3b50eda8c7e5bfdca6fe4a54115e4ed1d7bcfc8e1b946ed1c15b', 'supabase/migrations/20260519_ediel_tenant_profile_runtime_sync.sql': 'b5c475b7419c824b4d1c8ec713131d48c41c2be6f5607890bda42f238548426e', 'supabase/migrations/20260520_final_z01_outbound_and_platform_guard.sql': '987fd23b93dac930007da4c47cbd20d11120ab2bd9afa10b9865d545938b71b6', 'supabase/migrations/20260521_actor_testing_go_live_module.sql': '94e7fc8168c5d17925c61a4985a889db1dd8a823ce3477ded9fdbdab6cdc7c08', 'supabase/migrations/20260906081839_canonical_company_invitation_runtime_reconstruction.sql': 'd30a89a4fa793cddf3cf4560e1bb40bb2831505e911bd630c1409117e7f877f8', 'supabase/migrations/20260909120100_canonical_invitation_status_index_reconstruction.sql': '1ab9a6bf09953d87a898235e4425b85739286e2c3bcb15987a0d75770c6c3705', 'supabase/migrations/20260520_batch_6e_fix_rbac_backfill_security.sql': '3e8858b6df6600d5d6fa3e35b7e99bc9f8a07814be64c6e402f172d7ed3d44fc', 'supabase/migrations/20260525_debug_step2_code_schema_alignment.sql': 'e7be5cf935817846dcbe65e64c3b3d558d5e442c9bf7f7af5863f2180f108f04', 'supabase/migrations/20260526_batch_3a_3b_customer_intake_blockers_documents.sql': 'fad2a3336c1bab86cd67d05d5f965643589864c259b500eb67bbafbcaa78cba8', 'supabase/migrations/20260801143000_canonical_multitenant_platform_hardening.sql': '4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0', 'supabase/migrations/20260520_batch_5_final_quality_handbook_alignment.sql': 'fdb2ccba4ada805200e71d5b867456cdf6740f22184a50a5ffb442586578180c', 'supabase/migrations/20260521_batch_2c_end_to_end_operations.sql': 'ed0784a0fa59b447c48e90d4d7220c71e778a4cba5e70254dfad9eea6693d5dd', 'supabase/migrations/20260521_batch_customer_intake_batch2_hardening.sql': 'ab4bcf98d9baba596e3badde07ea8c035224512979104f6716d1fe39bbbb2594', 'supabase/migrations/20260521_batch_customer_intake_debug_hardening.sql': '562c2447554c43a3aef96bbbcd88a9f36ad1cc884ba97268ca96bc455ec54e80', 'supabase/migrations/20260521_batch_customer_intake_batch2_completion.sql': '9cf593a45de464b273eb0642645d21d4b831fbc6e2458cb41711dcfdb90fff6a', 'supabase/migrations/20260522_batch4_multisite_duplicate_billing_hardening.sql': 'b8e38ec7d99cd12e4bcd9310bd3ed1b2c589ea04f7140768435b0b3de9d62355', 'supabase/migrations/20260522_batch4c_billing_export_audit_quality_ai.sql': '44206392cb41e8a2e97c617b633ddd86cb855b2fb4b6e152e99bd1c3601d2a34', 'supabase/migrations/20260521_batch_2b_full_automation_and_live_ops.sql': '20f6846c8857d04381e8956e55d683253eaa0805a88963294c12d9d942f19c4f', 'supabase/migrations/20260528_debug_post_repair_schema_guardrails.sql': '41e63220e564c6efee26011e65055b95d5f5ca9e60a7c36811ec00e8f69579e6', 'supabase/migrations/20260526_debug_step1_2f_customer_import_foundation.sql': 'b2e764f4533f0539af021669831e9077582b1a90a257cbb8564777f42971465a', 'supabase/migrations/20260520_batch_3_4_final_completion.sql': '04712f0b9ce88030b7d06be5e3119419df944c957f4fb02f6cc77f1428ecf782', 'supabase/migrations/20260813070046_gridex_review_hardening_v2.sql': '3e174ee285c0f32dfd223ccdc5c826abc3bd3fe26a362d31c2435ba5f403cfd3', 'supabase/migrations/20260522_batch4e_switch_pdf_audit_rbac_completion.sql': 'e28a7956e18e6704de79b3be29245974faaef5a33aebcec4fa741c7daa06c98d', 'supabase/migrations/20260519_customer_move_out_lifecycle.sql': 'cd2a6b782bf1a5571c0d77dc948440b55e076df01b8986c58e97d07c9ab239b8', 'supabase/migrations/20260519_batch_6d2_runtime_governance_completion.sql': 'b7d9d48b9cd3093b5546b04225f9c6151b0f674d2ae73441d8086f51922de9ab', 'supabase/migrations/20260528_batch_7a1_inbound_hardening.sql': '4653d576effa13161ef8bdd713cb928ba9f57e8f2a16084d0f5dff2bc3d83959', 'supabase/migrations/20260528_batch_1_customer_flow_masterdata_preflight.sql': '08d183bdbb1506958893aada9400982ea58cd2e4c0acec0a886ad83194533135', 'supabase/migrations/20260519_operations_customers_ux.sql': 'caafdfde64eaf88d952a23465ef8aed307ce49e40ed54c6cf84b613e873f5b2a', 'supabase/migrations/20260522_batch4d_merge_poa_lifecycle_hardening.sql': '2e346a108ec1ce7583d50b6a46d92302cfe24ab65f5c43dd6cfabf9acaae78fe', 'supabase/migrations/20260602143000_ediel_environment_business_action_locks.sql': '696914ad8397dc97c9ee903570ca187b6a11e765ebe7b7f15bc79c0780a27a5a', 'supabase/migrations/20260601070000_ediel_production_readiness_hardening.sql': '7a73e59f559ebb5291d3e7df74545e6918011ec9764e5c512df19fbaa5bdbc12', 'supabase/migrations/20260528_batch_7a_route_inbound_mail_platform_ui.sql': 'a5ca82d1c68f44c8542820e5d209fd5d31356a16e7eb1ccc827843a61e0ba690', 'supabase/migrations/20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql': '7f71410f8b9f498286226dae76a2bc8ab1073cb43e07442ed8b5e0eb5de869be', 'supabase/migrations/20260528_batch_2_completion_rulebook_actions_regression.sql': '7374dcf5f7ac5b2081a0ba752a103e60fc292f2d55f49c9f45e1db23872436f9', 'supabase/migrations/20260525_db4b_customer_registry_ediel_test_cleanup.sql': 'fcd67f80346b1e767e7f136c5983d5c73d1bdcbbe3e1e82637c6111bb2a6502e', 'supabase/migrations/20260522_customer_flow_access_repair.sql': '7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2', 'supabase/migrations/20260909120000_canonical_role_permission_uniqueness_reconstruction.sql': 'b86f056fb868a3642eb6663068bc1cb4b86d03d430e6a1f339687868ec2773a6', 'supabase/migrations/20260519_batch_6d_superadmin_tenant_governance.sql': 'b54cc17584c7274862fe85711e324fff030ffca770d360c0fb721979f549cb47', 'supabase/migrations/20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql': '98522e209332c44c804d7acccf831f25fb13b75b048fbe3613c8d69fcb373a9b', 'supabase/migrations/20260528_final_user_access_schema_safe_repair.sql': '4968391d74a8ff813ce1f56a8b8d9ade682692d183988917e736d0f3c5857bd2', 'supabase/migrations/20260525_debug_batch_2_rbac_tenant_alignment.sql': 'cba0a78a519d84b44585133046c56117bf05674c1834467eb8b78fbc1d79cb7d', 'supabase/migrations/20260821103000_customer_identity_consistency_and_webhook_readiness.sql': 'a6e6a9af85b3957fe4fee7cd9c041a6f254f3a266e8f61e7dc6ed548882e6085'}
ROW_KEYS={'nspname','relname','indexname','definition','indisunique','indisprimary'}
CLASSES={'NONUNIQUE_ACCESS_PATH':283,'FOREIGN_KEY_ACCESS_PATH':79}
KEY='addedNonuniqueIndexWitness'

def sha(value):
    raw=value if type(value) is bytes else json.dumps(value,sort_keys=True,separators=(',',':')).encode()
    return hashlib.sha256(raw).hexdigest()

def retain(root=ROOT):
    rows=[]
    for path,digest in PINS.items():
        p=Path(root)/path
        if p.resolve()!=p or not p.is_file() or sha(p.read_bytes())!=digest:
            raise ValueError('NONUNIQUE_INDEX_SOURCE_REQUIRED')
        rows.append((path,p.read_bytes()))
    return tuple(rows)

def contract(retained):
    from collections import Counter
    if (type(retained) is not tuple or len(retained)!=len(PINS)
        or tuple(path for path,raw in retained)!=tuple(PINS)
        or any(type(raw) is not bytes or sha(raw)!=PINS[path] for path,raw in retained)):
        raise ValueError('NONUNIQUE_INDEX_SOURCE_REQUIRED')
    document=json.loads(dict(retained)[REGISTER]);allrows=document['records']
    if len(allrows)!=451:raise ValueError('NONUNIQUE_INDEX_REGISTER_REQUIRED')
    rows=[r for r in allrows if r['semantics']['classification'] in CLASSES]
    if len(rows)!=362 or Counter(r['semantics']['classification'] for r in rows)!=CLASSES:
        raise ValueError('NONUNIQUE_INDEX_EXACT_SCOPE_REQUIRED')
    if len({tuple(r['identity']) for r in rows})!=362:raise ValueError('NONUNIQUE_INDEX_EXACT_SCOPE_REQUIRED')
    for record in rows:
        row=record['row'];sem=record['semantics']
        if (set(row)!=ROW_KEYS or record['identity']!=[row[k] for k in ('nspname','relname','indexname')]
            or row['nspname']!='public' or row['indisunique'] is not False or row['indisprimary'] is not False
            or sha(row)!=record['sha256'] or sem['definitionDisposition']!='PRESERVE_SOURCE_DEFINED_INDEX'
            or sem['definitionReconstructed'] is not True or not record['sources']):
            raise ValueError('NONUNIQUE_INDEX_POSITIVE_SOURCE_REQUIRED')
        for source in record['sources']:
            if PINS[source['path']]!=source['sourceSha256']:raise ValueError('NONUNIQUE_INDEX_SOURCE_REQUIRED')
            lines=dict(retained)[source['path']].decode().splitlines()
            if lines[source['line']-1]!=source['lineText']:raise ValueError('NONUNIQUE_INDEX_SOURCE_LINE_REQUIRED')
    return tuple(rows)

def approved():
    return tuple(dict(section='indexes',change='added',identity=r['identity'],sha256=r['sha256'],
        decision='PRESERVE_EXACT_SOURCE_NONUNIQUE_ACCESS_PATH_NO_UNIQUENESS_OR_PERFORMANCE_CLAIM',
        decisionSourceSha256=PINS[REVIEW],witness=KEY) for r in contract(retain()))

def render(retained):
    rows=contract(retained)
    values=','.join("('%s','%s')"%(r['identity'][1],r['identity'][2]) for r in rows)
    return """SELECT coalesce(jsonb_agg(jsonb_build_object('row',jsonb_build_object(
 'nspname',n.nspname,'relname',t.relname,'indexname',c.relname,'definition',pg_get_indexdef(i.indexrelid),
 'indisunique',i.indisunique,'indisprimary',i.indisprimary),
 'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) ORDER BY t.relname,c.relname),'[]'::jsonb)
 FROM (VALUES """+values+""") expected(table_name,index_name)
 JOIN pg_namespace n ON n.nspname='public'
 JOIN pg_class t ON t.relnamespace=n.oid AND t.relname=expected.table_name
 JOIN pg_index i ON i.indrelid=t.oid
 JOIN pg_class c ON c.oid=i.indexrelid AND c.relnamespace=n.oid AND c.relname=expected.index_name;"""

def verify_rows(actual,retained):
    expected={tuple(r['identity']):r['row'] for r in contract(retained)}
    if type(actual) is not list or len(actual)!=362:raise ValueError('NONUNIQUE_INDEX_NATIVE_ROWS_REQUIRED')
    found={}
    for item in actual:
        if type(item) is not dict or set(item)!={'row','valid','ready','live'} or any(item[k] is not True for k in ('valid','ready','live')):
            raise ValueError('NONUNIQUE_INDEX_NATIVE_STATE_REQUIRED')
        row=item['row']
        if type(row) is not dict or set(row)!=ROW_KEYS:raise ValueError('NONUNIQUE_INDEX_NATIVE_ROWS_REQUIRED')
        identity=tuple(row[k] for k in ('nspname','relname','indexname'))
        if identity in found or row!=expected.get(identity) or sha(row)!=sha(expected.get(identity)):
            raise ValueError('NONUNIQUE_INDEX_NATIVE_ROWS_REQUIRED')
        found[identity]=row
    if set(found)!=set(expected):raise ValueError('NONUNIQUE_INDEX_NATIVE_ROWS_REQUIRED')

def expected_receipt():
    return dict(scope='EXACT_SOURCE_NONUNIQUE_INDEX_NATIVE_CATALOG_ONLY',verified=True,nativeTarget=True,
        indexCount=362,directCount=283,foreignKeyIndexCount=79,registerSha256=PINS[REGISTER],
        sourcePinsSha256=sha(PINS),exactDefinitionsVerified=True,validReadyLiveVerified=True,
        catalogAndRowsPreserved=True,ledgerUnchanged=True,sourceBytesPreserved=True,
        schemaAccepted=False,performanceVerified=False,uniqueIndexesAccepted=False)

def validate_execution_receipt(receipt,*,native):
    expected=expected_receipt()
    if native is not True or type(native) is not bool or type(receipt) is not dict or receipt!=expected or sha(receipt)!=sha(expected):
        raise ValueError('NONUNIQUE_INDEX_NATIVE_RECEIPT_REQUIRED')
    contract(retain())
    return receipt

def execute_parent(target,retained,progress):
    contract(retained);database,native=actors._admit(target)
    if not native or KEY in progress:raise ValueError('NONUNIQUE_INDEX_NATIVE_ONCE_REQUIRED')
    actors._complete(progress,True)
    report=dict(verified=False,schemaAccepted=False);progress[KEY]=report
    before=actors._snapshot(target,database,True);prior=transport.parent_ledger(target,database)
    try:
        verify_rows(json.loads(transport.query(target,render(retained),'nonunique_index_catalog')),retained)
    finally:
        if (actors._admit(target)!=(database,True) or actors._snapshot(target,database,True)!=before
            or transport.parent_ledger(target,database)!=prior or retain()!=retained):
            raise ValueError('NONUNIQUE_INDEX_NATIVE_PRESERVATION_REQUIRED')
    report.update(expected_receipt())
    return validate_execution_receipt(report,native=True)

def validate_context(diff):
    actors._complete(diff,True)
    validate_execution_receipt(diff.get(KEY),native=True)
    expected={tuple(r['identity']):{'identity':r['identity'],'sha256':r['sha256']} for r in contract(retain())}
    actual=diff['sections']['indexes']['added']
    selected=[r for r in actual if tuple(r['identity']) in expected]
    if len(selected)!=362 or len({tuple(r['identity']) for r in selected})!=362 or any(r!=expected[tuple(r['identity'])] for r in selected):
        raise ValueError('NONUNIQUE_INDEX_EXACT_CONTEXT_REQUIRED')
