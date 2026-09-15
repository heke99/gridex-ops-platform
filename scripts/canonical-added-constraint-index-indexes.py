#!/usr/bin/env python3
"""Offline source-derived candidate reconstruction, admitted by full catalog hash.

Candidates are formatting alternatives, never equivalence claims. Only an exact
full-row digest match establishes the emitted catalog value. Source and caller
dispositions are separate; PostgreSQL execution and performance are not inferred.
"""
import hashlib
import importlib.util
import itertools
import json
from pathlib import Path
import re
import sys
import zipfile
import canonical_native_historical_prefix as lexer

ROOT=Path(__file__).resolve().parents[1]
ARCHIVE=ROOT.parent/'pr310-schema-9f1ba7ae.zip'
ARCHIVE_SHA='0ee862d06ee0e4f33208aa33ceefe8ce5afa8c5e8ca1c9cd186f006c7364f2af'
SOURCE_PINS={'supabase/migrations/20260513_ediel_agt_saas_runtime_safe.sql': '152e4e573bde3b50eda8c7e5bfdca6fe4a54115e4ed1d7bcfc8e1b946ed1c15b', 'supabase/migrations/20260519_auth_callback_email_reset_sync.sql': '59efbf233d314558f8cc7ffbb2b15788cadaaf7ba476e0f80fa1e820299419a9', 'supabase/migrations/20260519_auth_email_templates_invite_reset_sync.sql': 'afd045b61276b1c40993bac59c7b94646a8c9e721d80c8f32dfdb3c471a0c137', 'supabase/migrations/20260519_batch_6c_metering_billing_readiness.sql': 'c44153ba502ab32f543f649d9001bfcc9685d90be054747520c2b11d67bfcb24', 'supabase/migrations/20260519_batch_6d2_runtime_governance_completion.sql': 'b7d9d48b9cd3093b5546b04225f9c6151b0f674d2ae73441d8086f51922de9ab', 'supabase/migrations/20260519_batch_6d_superadmin_tenant_governance.sql': 'b54cc17584c7274862fe85711e324fff030ffca770d360c0fb721979f549cb47', 'supabase/migrations/20260519_company_invite_temp_password_sync.sql': '09ed878125a71c77c792e004fd1a38c4fa56a0b23e0bc3eafeb62be271c85dc9', 'supabase/migrations/20260519_customer_intake_contracts_tenant_hardening.sql': 'a448184e58e8777c41f8bdefb32e45a1365bd37fd9a8e316065da657e57e19f4', 'supabase/migrations/20260519_customer_move_out_lifecycle.sql': 'cd2a6b782bf1a5571c0d77dc948440b55e076df01b8986c58e97d07c9ab239b8', 'supabase/migrations/20260519_ediel_tenant_profile_runtime_sync.sql': 'b5c475b7419c824b4d1c8ec713131d48c41c2be6f5607890bda42f238548426e', 'supabase/migrations/20260519_final_saas_hardening.sql': '2037dbc535d18d7575820d7f40d2a8ef4848b67060161e6851a01eb15990105e', 'supabase/migrations/20260519_operations_core_saas_sync.sql': 'e5863b15ec8c25794912b50c36eda6a370f3fb288800339a0bcfb16f2a3bb619', 'supabase/migrations/20260519_operations_customers_ux.sql': 'caafdfde64eaf88d952a23465ef8aed307ce49e40ed54c6cf84b613e873f5b2a', 'supabase/migrations/20260519_saas_ui_tenant_admin.sql': '861130aecf1b3c5d400cbf414c8d99e14d21adbd635c9f8ddb0c357c1964009e', 'supabase/migrations/20260520_batch_1_2_saas_ediel_control_center.sql': '7a198e941bbd735c0f56191d5ecf41cc85de03bbd89cea4f0b3369981127cdc8', 'supabase/migrations/20260520_batch_3_4_final_completion.sql': '04712f0b9ce88030b7d06be5e3119419df944c957f4fb02f6cc77f1428ecf782', 'supabase/migrations/20260520_batch_5_cases_audit_email_ux.sql': '0e26b35eef3fa863f149bf4c46be4018ff484d3d55c5434a64323fafde201775', 'supabase/migrations/20260520_batch_5_final_quality_handbook_alignment.sql': 'fdb2ccba4ada805200e71d5b867456cdf6740f22184a50a5ffb442586578180c', 'supabase/migrations/20260520_batch_6e_fix_rbac_backfill_security.sql': '3e8858b6df6600d5d6fa3e35b7e99bc9f8a07814be64c6e402f172d7ed3d44fc', 'supabase/migrations/20260520_batch_6e_rbac_tenant_stats_whitelabel.sql': '47c24a0340da00d3ab765d87efdfcf17622a12102af3bf29c2327db5f4500c64', 'supabase/migrations/20260520_company_delete_backfill_and_admin_layout.sql': '72aef3d5609bd6a508299bccf1eed849b58a4f925844b097d44bb8bdca667d1f', 'supabase/migrations/20260520_final_z01_outbound_and_platform_guard.sql': '987fd23b93dac930007da4c47cbd20d11120ab2bd9afa10b9865d545938b71b6', 'supabase/migrations/20260521_actor_testing_engine_automation.sql': '09375322da56354534ab97ed5a1742eebcc7a7f06e45cc8a39c5d6b4ae04e50e', 'supabase/migrations/20260521_actor_testing_go_live_module.sql': '94e7fc8168c5d17925c61a4985a889db1dd8a823ce3477ded9fdbdab6cdc7c08', 'supabase/migrations/20260521_batch3_pricing_billing_audit_roles_completion.sql': '109ddeee3b532c70fc65ac5f920d4eae250a10037afd304ed5d14144cc30e27f', 'supabase/migrations/20260521_batch_1_2_live_readiness_and_automation_hardening.sql': '9f741fb9afc07661713e8448cb394f9ec950e25eaf56ee4422b0983886f81c34', 'supabase/migrations/20260521_batch_2b_full_automation_and_live_ops.sql': '20f6846c8857d04381e8956e55d683253eaa0805a88963294c12d9d942f19c4f', 'supabase/migrations/20260521_batch_2c_end_to_end_operations.sql': 'ed0784a0fa59b447c48e90d4d7220c71e778a4cba5e70254dfad9eea6693d5dd', 'supabase/migrations/20260521_batch_customer_intake_batch2_completion.sql': '9cf593a45de464b273eb0642645d21d4b831fbc6e2458cb41711dcfdb90fff6a', 'supabase/migrations/20260521_batch_customer_intake_batch2_hardening.sql': 'ab4bcf98d9baba596e3badde07ea8c035224512979104f6716d1fe39bbbb2594', 'supabase/migrations/20260521_batch_customer_intake_debug_hardening.sql': '562c2447554c43a3aef96bbbcd88a9f36ad1cc884ba97268ca96bc455ec54e80', 'supabase/migrations/20260522_batch4_multisite_duplicate_billing_hardening.sql': 'b8e38ec7d99cd12e4bcd9310bd3ed1b2c589ea04f7140768435b0b3de9d62355', 'supabase/migrations/20260522_batch4c_billing_export_audit_quality_ai.sql': '44206392cb41e8a2e97c617b633ddd86cb855b2fb4b6e152e99bd1c3601d2a34', 'supabase/migrations/20260522_batch4d_merge_poa_lifecycle_hardening.sql': '2e346a108ec1ce7583d50b6a46d92302cfe24ab65f5c43dd6cfabf9acaae78fe', 'supabase/migrations/20260522_batch4e_switch_pdf_audit_rbac_completion.sql': 'e28a7956e18e6704de79b3be29245974faaef5a33aebcec4fa741c7daa06c98d', 'supabase/migrations/20260522_customer_flow_access_repair.sql': '7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2', 'supabase/migrations/20260525_db4b_customer_registry_ediel_test_cleanup.sql': 'fcd67f80346b1e767e7f136c5983d5c73d1bdcbbe3e1e82637c6111bb2a6502e', 'supabase/migrations/20260525_debug_batch_2_rbac_tenant_alignment.sql': 'cba0a78a519d84b44585133046c56117bf05674c1834467eb8b78fbc1d79cb7d', 'supabase/migrations/20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql': '98522e209332c44c804d7acccf831f25fb13b75b048fbe3613c8d69fcb373a9b', 'supabase/migrations/20260525_debug_fix_batch_1b_schema_code_alignment.sql': 'c846be376c5f878965ea6a831d23611da959d4721cd0ebfb853fa46b10bccf68', 'supabase/migrations/20260525_debug_step2_code_schema_alignment.sql': 'e7be5cf935817846dcbe65e64c3b3d558d5e442c9bf7f7af5863f2180f108f04', 'supabase/migrations/20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql': 'afd5c2693cbb1a9f9bd40055cd993189e0118d4871bbb2bfcfb18e4124c2fcb2', 'supabase/migrations/20260526_batch_3a_3b_customer_intake_blockers_documents.sql': 'fad2a3336c1bab86cd67d05d5f965643589864c259b500eb67bbafbcaa78cba8', 'supabase/migrations/20260526_batch_3c_3d_fullmakt_data_requests.sql': '20b9beb1536e870b922b455ee1afa53c36797aa6d211e06c75070a3c5eab3b92', 'supabase/migrations/20260526_debug_step1_2c_full_schema_code_alignment.sql': '5a4a2326232ab847d23fed32af2be13a046ee3e3a2dae41dead6f5b4eba16472', 'supabase/migrations/20260526_debug_step1_2f_customer_import_foundation.sql': 'b2e764f4533f0539af021669831e9077582b1a90a257cbb8564777f42971465a', 'supabase/migrations/20260528_auth_provisioning_runtime_guard.sql': '0c2455cbc31553f4be1f1a3fa2800f516295c972bcead8fbbd77c448d3f98026', 'supabase/migrations/20260528_batch_1_customer_flow_masterdata_preflight.sql': '08d183bdbb1506958893aada9400982ea58cd2e4c0acec0a886ad83194533135', 'supabase/migrations/20260528_batch_2_completion_rulebook_actions_regression.sql': '7374dcf5f7ac5b2081a0ba752a103e60fc292f2d55f49c9f45e1db23872436f9', 'supabase/migrations/20260528_batch_7a1_inbound_hardening.sql': '4653d576effa13161ef8bdd713cb928ba9f57e8f2a16084d0f5dff2bc3d83959', 'supabase/migrations/20260528_batch_7a_route_inbound_mail_platform_ui.sql': 'a5ca82d1c68f44c8542820e5d209fd5d31356a16e7eb1ccc827843a61e0ba690', 'supabase/migrations/20260528_debug_post_repair_schema_guardrails.sql': '41e63220e564c6efee26011e65055b95d5f5ca9e60a7c36811ec00e8f69579e6', 'supabase/migrations/20260528_final_user_access_schema_safe_repair.sql': '4968391d74a8ff813ce1f56a8b8d9ade682692d183988917e736d0f3c5857bd2', 'supabase/migrations/20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql': '7f71410f8b9f498286226dae76a2bc8ab1073cb43e07442ed8b5e0eb5de869be', 'supabase/migrations/20260531111600_system_readiness_foundation.sql': 'e6ef68b18ede5729da067ce59a86cfca0db083d9d54a35ae0ed3a6c0968b96f2', 'supabase/migrations/20260601070000_ediel_production_readiness_hardening.sql': '7a73e59f559ebb5291d3e7df74545e6918011ec9764e5c512df19fbaa5bdbc12', 'supabase/migrations/20260602143000_ediel_environment_business_action_locks.sql': '696914ad8397dc97c9ee903570ca187b6a11e765ebe7b7f15bc79c0780a27a5a', 'supabase/migrations/20260609162000_batch_7_website_integration_foundation.sql': '1809f5c8926ec6bda991eb861cc3ba7a24738e8655b47e94f4ab086d5f2afb0b', 'supabase/migrations/20260615_multitenant_integrity_and_claim_locks.sql': '046c7ec8c885eca46d8dde306bc1b289aa7bccea3f9d4ebdd5f8580c07ca9a37', 'supabase/migrations/20260801143000_canonical_multitenant_platform_hardening.sql': '4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0', 'supabase/migrations/20260812211405_gridex_missing_fk_indexes_v1.sql': '1e5abc5db8164988866383a38bcabf02c4dc34b89914c3f32c8333c7ddcb93bf', 'supabase/migrations/20260813070046_gridex_review_hardening_v2.sql': '3e174ee285c0f32dfd223ccdc5c826abc3bd3fe26a362d31c2435ba5f403cfd3', 'supabase/migrations/20260821103000_customer_identity_consistency_and_webhook_readiness.sql': 'a6e6a9af85b3957fe4fee7cd9c041a6f254f3a266e8f61e7dc6ed548882e6085', 'supabase/migrations/20260906081839_canonical_company_invitation_runtime_reconstruction.sql': 'd30a89a4fa793cddf3cf4560e1bb40bb2831505e911bd630c1409117e7f877f8', 'supabase/migrations/20260909120000_canonical_role_permission_uniqueness_reconstruction.sql': 'b86f056fb868a3642eb6663068bc1cb4b86d03d430e6a1f339687868ec2773a6', 'supabase/migrations/20260909120100_canonical_invitation_status_index_reconstruction.sql': '1ab9a6bf09953d87a898235e4425b85739286e2c3bcb15987a0d75770c6c3705'}
REFERENCE_SHA='b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30'
CONSTRAINT_REGISTER='quality/audits/PR310_ADDED_CONSTRAINT_INDEX_CONSTRAINTS_2026-09-15.json'
CONSTRAINT_REGISTER_SHA='7f15c8c45668e38a0ed1fc8e390107bf4382ffdc1b4d9cac5f4c3141c2005899'

def sha(value):
    if type(value) is not bytes:value=json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
    return hashlib.sha256(value).hexdigest()

def statement_at(source,start):
    for end in re.finditer(';',source[start:]):
        value=source[start:start+end.end()]
        try:tokens=lexer.sql_tokens(value)
        except lexer.PrefixError:continue
        if tokens and tokens[-1][0]==';':return value
    return None

def index_row(table,name,definition,primary=False):
    return dict(nspname='public',relname=table,indexname=name,definition=definition,
                indisunique=definition.startswith('CREATE UNIQUE INDEX'),indisprimary=primary)

def spacing(text):
    text=re.sub(r'\s+',' ',text).strip()
    text=re.sub(r'\s*,\s*',', ',text)
    text=re.sub(r'\(\s+','(',text);text=re.sub(r'\s+\)',')',text)
    text=re.sub(r'\b(desc|asc|nulls|null|first|last|coalesce|lower|upper|and|or|not|is|true|false|where)\b',
                lambda m:m[0].upper() if m[0].lower() not in ('lower','upper','true','false') else m[0].lower(),text,flags=re.I)
    return text

def typed_constants(value):
    tokens=lexer.sql_tokens(value)
    positions=[b for index,(token,a,b) in enumerate(tokens) if token.startswith("'")
               and (index+1==len(tokens) or tokens[index+1][0]!='::')]
    for end in reversed(positions):value=value[:end]+'::text'+value[end:]
    return value

def definitions(statement):
    match=re.match(r'create\s+(unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)\s+on\s+(?:only\s+)?(?:public\.)?([a-z_0-9]+)\s*(?:using\s+(\w+)\s*)?\(',statement,re.I)
    if not match:return
    start=match.end();depth=1;finish=None
    try:tokens=lexer.sql_tokens(statement[start:])
    except lexer.PrefixError:return
    for token,a,b in tokens:
        if token=='(':depth+=1
        if token==')':depth-=1
        if depth==0:finish=start+a;break
    if finish is None:return
    keys=spacing(statement[start:finish])
    suffix=spacing(statement[finish+1:].strip().removesuffix(';'))
    prefix='CREATE '+('UNIQUE ' if match[1] else '')+'INDEX '+match[2]+' ON public.'+match[3]+' USING '+(match[4] or 'btree').lower()+' ('
    yield prefix+keys+')'+(' '+suffix if suffix else '')
    if suffix.lower().startswith('where '):
        predicate=suffix[6:]
        yield prefix+keys+') WHERE ('+predicate+')'
    # PostgreSQL explicitly types unknown string constants and parenthesizes
    # Boolean expressions when pg_get_indexdef pretty=false is used.
    typed_keys=typed_constants(keys)
    if not suffix:
        yield prefix+typed_keys+')'
        # The only selected concatenation key is a left-associated three-part
        # display name. pg_get_indexdef emits explicit binary-op parentheses.
        parts=typed_keys.split(' || ')
        if len(parts)==3 and parts[0].startswith('lower(') and parts[-1].endswith(') gin_trgm_ops'):
            yield prefix+'lower((('+parts[0][6:]+' || '+parts[1]+') || '+parts[2][:-14]+')) gin_trgm_ops)'
    elif suffix.startswith('WHERE '):
        predicate=typed_constants(suffix[6:])
        predicate=re.sub(r'\b(\w+)\s+in\s*\(([^)]+)\)',r'\1 = ANY (ARRAY[\2])',predicate,flags=re.I)
        terms=predicate.split(' AND ')
        rendered=' AND '.join('('+t+')' for t in terms)
        yield prefix+typed_keys+') WHERE ('+(rendered if len(terms)>1 else predicate)+')'

def reference_indexes(reference):
    for match in re.finditer(r'^CREATE (?:UNIQUE )?INDEX ([a-z_0-9]+) ON public\.([a-z_0-9]+) [^\n]+;',reference,re.M):
        yield match[2],match[1],match[0].removesuffix(';')

def constraint_rows():
    reference_path=ROOT/'supabase/schema.sql'
    if sha(reference_path.read_bytes())!=REFERENCE_SHA:raise ValueError('EXACT_REFERENCE_REQUIRED')
    reference=reference_path.read_text()
    records=[]
    for match in re.finditer(r'ALTER TABLE ONLY public\.(\w+)\s+ADD CONSTRAINT (\w+) ([^;]+);',reference):
        kind='f' if match[3].startswith('FOREIGN KEY') else 'p' if match[3].startswith('PRIMARY KEY') else 'u' if match[3].startswith('UNIQUE') else 'c'
        records.append(dict(row=dict(nspname='public',relname=match[1],conname=match[2],contype=kind,
                                     definition=match[3],convalidated=not match[3].endswith(' NOT VALID')),
                            sources=[dict(path='supabase/schema.sql',line=reference[:match.start()].count('\n')+1)]))
    path=ROOT/CONSTRAINT_REGISTER
    if CONSTRAINT_REGISTER_SHA is not None and sha(path.read_bytes())!=CONSTRAINT_REGISTER_SHA:
        raise ValueError('EXACT_CONSTRAINT_REGISTER_REQUIRED')
    records.extend(r for r in json.loads(path.read_text())['records'] if r['row'])
    return records

def reconstruct():
    if sha(ARCHIVE.read_bytes())!=ARCHIVE_SHA:raise ValueError('EXACT_ARTIFACT_REQUIRED')
    with zipfile.ZipFile(ARCHIVE) as archive:
        diff=json.loads(archive.read('full-schema-reference-diff.json'))
    records=diff['sections']['indexes']['added']
    assert len(records)==451
    checker_path=ROOT/'scripts/canonical-added-constraint-index-constraints.py'
    if sha(checker_path.read_bytes())!='ef492d512a94d41833d6492a59261d4c027a688ec37775ce3946e8f9983a4fe7':
        raise ValueError('EXACT_CONSTRAINT_CHECKER_REQUIRED')
    checker_spec=importlib.util.spec_from_file_location('added_constraint_source_checker',checker_path)
    checker=importlib.util.module_from_spec(checker_spec);checker_spec.loader.exec_module(checker)
    checker.validate(json.loads((ROOT/CONSTRAINT_REGISTER).read_text()),diff,ROOT)
    if SOURCE_PINS:
        files={}
        for path,digest in SOURCE_PINS.items():
            source=ROOT/path
            if source.is_symlink() or sha(source.read_bytes())!=digest:raise ValueError('EXACT_INDEX_SOURCE_REQUIRED')
            files[path]=source.read_text()
    else:files={str(p.relative_to(ROOT)):p.read_text() for p in (ROOT/'supabase/migrations').glob('*.sql')}
    candidates={tuple(r['identity']):[] for r in records}
    for path,source in files.items():
        for match in re.finditer(r'create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)\s+on\s+(?:only\s+)?(?:public\.)?([a-z_0-9]+)',source,re.I):
            identity=('public',match[2],match[1])
            if identity not in candidates:continue
            statement=statement_at(source,match.start())
            wrapper=re.search(r'execute\s+(\$[a-z_0-9]*\$)\s*$',source[:match.start()],re.I)
            if wrapper:
                end=source.find(wrapper[1],match.start())
                if end!=-1:statement=source[match.start():end].rstrip().removesuffix(';')+';'
            if not statement:continue
            for definition in definitions(statement):
                candidates[identity].append((index_row(match[2],match[1],definition),path,source[:match.start()].count('\n')+1,statement))
        for execute in re.finditer(r"execute\s+'((?:''|[^'])*)'",source,re.I):
            statement=execute[1].replace("''", "'")+';'
            for definition in definitions(statement):
                match=re.match(r'CREATE (?:UNIQUE )?INDEX (\w+) ON public\.(\w+)',definition)
                identity=('public',match[2],match[1])
                if identity in candidates:
                    candidates[identity].append((index_row(match[2],match[1],definition),path,source[:execute.start()].count('\n')+1,statement))
    # Deterministic dynamic key shapes and implicit primary-key indexes. Matching
    # alone is a catalog recovery; exact generating source must be assigned later.
    for record in records:
        _,table,name=record['identity']
        possibilities=[]
        if name.endswith('_company_id_idx'):possibilities.append((False,False,'company_id'))
        if name.endswith('_company_id_id_uidx'):possibilities.append((True,False,'company_id, id'))
        if name.endswith('_pkey'):possibilities.extend([(True,True,'id'),(True,True,'company_id')])
        for unique,primary,keys in possibilities:
            definition=f"CREATE {'UNIQUE ' if unique else ''}INDEX {name} ON public.{table} USING btree ({keys})"
            candidates[tuple(record['identity'])].append((index_row(table,name,definition,primary),None,None,None))
            if primary:continue
            # Finite table-list generators, with the table present in the same
            # DO block as the exact naming/column template.
            for path,source in files.items():
                if "'"+table+"'" not in source:continue
                for block in re.finditer(r'\bdo\s+\$\$(.*?)\$\$;',source,re.I|re.S):
                    text=block[1]
                    if "'"+table+"'" not in text:continue
                    if name==table+'_company_id_idx':
                        template=re.search(r"'create index if not exists %I on public\.%I\s*\(company_id\)'",text,re.I)
                        if not template or "'_company_id_idx'" not in text:continue
                    elif name=='idx_'+table+'_company_id_id_uidx':
                        template=re.search(r"'create unique index if not exists %I on public\.%I\s*\(company_id, id\)'",text,re.I)
                        if not template or "'idx_' || t || '_company_id_id_uidx'" not in text:continue
                    elif name==('mt_'+table+'_company_id_id_uidx')[:63]:
                        template=re.search(r"'create unique index if not exists %I on public\.%I\s*\(company_id, id\)'",text,re.I)
                        if not template or "'mt_' || r.table_name || '_company_id_id_uidx'" not in text:continue
                    else:continue
                    candidates[tuple(record['identity'])].append((index_row(table,name,definition,primary),path,
                        source[:block.start(1)+template.start()].count('\n')+1,
                        'Finite table '+table+' in DO block at line '+str(source[:block.start()].count('\n')+1)+'; '+template[0]))
    for constraint in constraint_rows():
        row=constraint['row'];table=row['relname'];name=row['conname']
        keys=re.match(r'(FOREIGN KEY|PRIMARY KEY|UNIQUE) \(([^)]+)\)',row['definition'])
        if not keys:continue
        if keys[1]=='FOREIGN KEY':
            names=[('idx_fk_'+table[:30]+'_'+hashlib.md5(name.encode()).hexdigest()[:12],
                    'supabase/migrations/20260812211405_gridex_missing_fk_indexes_v1.sql',44),
                   ('idx_fk_'+table[:30]+'_'+hashlib.md5(('public.'+table+'.'+name).encode()).hexdigest()[:16],
                    'supabase/migrations/20260813070046_gridex_review_hardening_v2.sql',146)]
            for index,path,line in names:
                identity=('public',table,index)
                if identity not in candidates:continue
                definition=f'CREATE INDEX {index} ON public.{table} USING btree ({keys[2]})'
                candidates[identity].append((index_row(table,index,definition),path,line,
                  'FK '+name+'; '+row['definition']))
        else:
            identity=('public',table,name)
            if identity not in candidates:continue
            definition=f'CREATE UNIQUE INDEX {name} ON public.{table} USING btree ({keys[2]})'
            references=constraint['sources'] or [{}]
            for source in references:
                candidates[identity].append((index_row(table,name,definition,keys[1]=='PRIMARY KEY'),
                      source.get('path'),source.get('line'),row['definition']))
    out=[]
    for record in records:
        matching=[x for x in candidates[tuple(record['identity'])] if sha(x[0])==record['sha256']]
        out.append(dict(**record,row=matching[0][0] if matching else None,
                        sourceCandidates=[dict(source=x[1],line=x[2],statement=x[3]) for x in matching],
                        candidateCount=len(candidates[tuple(record['identity'])]),schemaAccepted=False))
    return dict(scope='SOURCE_CANDIDATE_HASH_RECOVERY_NOT_SCHEMA_ACCEPTANCE',schemaAccepted=False,
                records=out,matched=sum(x['row'] is not None for x in out),count=len(out))

BUSINESS_RULES={
 'billing_partner_customers_company_provider_customer_uidx':('One provider mapping per tenant customer; the tenant and provider are part of the identity.', [('lib/admin/websiteIntegrationOps.ts',594)]),
 'company_invitations_accept_token_hash_uidx':('Non-NULL hashed accept tokens identify one invitation. The direct lookup uses that exact hash.', [('lib/auth/companyInvitationFlow.ts',292)]),
 'company_invitations_token_key':('Unhashed legacy invitation tokens remain globally unique, supplying the source prerequisite for canonical invitation creation. Preserve the token identity independently of later hashed acceptance tokens.', [('lib/auth/companyInvitationFlow.ts',267)]),
 'ediel_aperak_error_details_upsert_v1b_uidx':('Exact six-column ON CONFLICT inference target used by the APERAK detail writer; generated coalesce columns canonicalize nullable components.', [('lib/ediel/testing/aperakErrorRuleRegistry.ts',1473),('lib/ediel/testing/aperakErrorRuleRegistry.ts',1488)]),
 'ediel_message_validation_issues_upsert_v1b_uidx':('Exact five-column ON CONFLICT inference target used by the validation issue writer; generated coalesce columns canonicalize nullable components.', [('lib/ediel/testing/aperakErrorRuleRegistry.ts',1328),('lib/ediel/testing/aperakErrorRuleRegistry.ts',1342)]),
 'ux_ediel_batch7a_inbound_interchange':('Deduplicate inbound envelopes by tenant, sender, receiver and non-NULL interchange reference; retain the receiver component. This is the retained interchange guard, distinct from the intentionally removed old transaction-only guard.', [('supabase/migrations/20260604113000_fix_ediel_inbound_transaction_dedupe.sql',19)]),
 'ux_ediel_batch7a_outbound_message':('Deduplicate outbound messages for one tenant request, family, normalized code/version and receiver. NULL code/version compare as empty strings; inbound rows and NULL request IDs do not participate.', []),
 'ediel_outbound_queue_company_idempotency_uidx':('A non-NULL queue idempotency key belongs to one tenant operation. NULL keys remain outside the partial unique index. No active literal application table caller was found; this preserves the explicit queue schema contract.', []),
 'ediel_test_run_locks_one_active_agt_uidx':('At most one unreleased lock per tenant, actor, message family and environment. Expiration does not remove an index entry; acquisition must treat an expired unreleased lock consistently.', [('lib/ediel/testing/testRunTransportMetadata.ts',207),('lib/ediel/testing/testRunTransportMetadata.ts',227),('app/admin/ediel/test-center/actions.ts',300)]),
 'ediel_tgt_test_data_suite_role_case_uidx':('Global test-definition identity is suite, role and test case; the application upsert names precisely these columns.', [('lib/ediel/testing/tgtTestDataStore.ts',1101)]),
 'event_outbox_unique_destination_idx':('One fan-out job per domain event, destination type and normalized destination key. The caller first reads the same tuple and handles a 23505 race; NULL and empty destination keys intentionally collide.', [('lib/events/domainEvents.ts',126),('lib/events/domainEvents.ts',142)]),
 'idx_inbound_email_company_interchange_uidx':('After tenant resolution, interchange dedupe includes environment, tenant and sender; incomplete tenant/sender/reference tuples are excluded.', [('lib/inbound-mail/edielMailboxPoller.part-1.ts',1008)]),
 'idx_inbound_email_company_transaction_external_uidx':('After tenant resolution, transaction dedupe includes environment, tenant, sender and external reference; each required reference must be present.', [('lib/inbound-mail/edielMailboxPoller.part-1.ts',1031)]),
 'idx_inbound_email_mailbox_message_id_uidx':('Before tenant resolution, immutable mail identity is mailbox plus Internet Message-ID, with NULL message IDs excluded.', [('lib/inbound-mail/edielMailboxPoller.part-1.ts',975)]),
 'idx_inbound_email_mailbox_raw_hash_uidx':('Before tenant resolution, raw content dedupe is mailbox plus non-NULL message hash; it does not merge business references across tenants.', [('lib/inbound-mail/edielMailboxPoller.part-1.ts',989)]),
 'ux_inbound_processing_jobs_one_open_per_email':('An envelope has at most one queued/retry/processing job. Completed jobs remain outside this partial index; the worker uses those same three live statuses.', [('lib/inbound-mail/edielMailboxPoller.part-2.ts',491)]),
 'metering_values_current_dedupe_uidx':('One current metering revision per tenant canonical key. Atomic ingestion reads the current key, marks the old revision non-current, then writes the replacement; historical revisions remain permitted.', [('lib/metering/normalizeMeteringValues.ts',184),('supabase/migrations/20260901165500_link_ediel_sources_during_atomic_metering_ingest_recovery.sql',43),('supabase/migrations/20260901165500_link_ediel_sources_during_atomic_metering_ingest_recovery.sql',71)]),
 'ux_outbound_batch7a_source_message_period':('At most one queued/prepared/sent/acknowledged request for the same tenant, normalized source type, source ID, request type, message code and period. Missing dates intentionally canonicalize to the source-authored 1900-01-01 sentinel; other states do not participate.', []),
 'partner_exports_company_idempotency_uidx':('A non-NULL export idempotency key is unique within its non-NULL tenant; legacy NULL identities are excluded.', [('lib/cis/db-data.ts',685)]),
 'permissions_key_unique_idx':('Non-NULL permission keys identify one global permission. Preserve the prerequisite used by RBAC key lookup/backfill; NULL legacy keys remain outside the index.', []),
 'roles_key_unique_idx':('Non-NULL role keys identify one global role. Preserve the prerequisite used by RBAC key lookup/backfill; NULL legacy keys remain outside the index.', []),
 'tenant_email_sender_profiles_default_idx':('One verified default sender per tenant, while pending/unverified and non-default profiles remain permitted. The branding lookup requires exactly status=verified and is_default=true.', [('lib/tenant/emailBranding.ts',37)]),
 'user_roles_active_unique_role_id_idx':('One active role-ID assignment per user and normalized tenant, with NULL tenant represented by the explicit all-zero UUID. Inactive assignments are retained outside the guard.', []),
 'user_roles_active_unique_role_text_idx':('One active case-insensitive textual role per user and normalized tenant. NULL tenant uses the explicit all-zero UUID; NULL roles and inactive assignments are outside the guard.', []),
 'webhook_subscriptions_company_client_endpoint_uidx':('One non-revoked subscription per tenant, API client and endpoint. Revoked subscriptions remain historical; provisioning looks up and updates the same non-revoked tuple before inserting.', [('lib/integrations/tenantWebsiteProvisioning.ts',203)]),
}

def evidence(path,line):
    source=ROOT/path;raw=source.read_bytes();lines=raw.decode().splitlines()
    return dict(path=path,line=line,sourceSha256=sha(raw),lineText=lines[line-1])

def dispositions():
    result=reconstruct()
    if result['matched']!=451:raise ValueError('COMPLETE_INDEX_RECONSTRUCTION_REQUIRED')
    with zipfile.ZipFile(ARCHIVE) as archive:diff=json.loads(archive.read('full-schema-reference-diff.json'))
    changed={tuple(x['identity']) for category in ('removed','changed') for x in diff['sections']['constraints'][category]}
    constraints=constraint_rows()
    by_name={(x['row']['relname'],x['row']['conname']):x for x in constraints}
    primary={x['row']['relname']:x for x in constraints if x['row'].get('contype')=='p'
             and ('public',x['row']['relname'],x['row']['conname']) not in changed}
    for record in result['records']:
        row=record['row'];table=row['relname'];name=row['indexname']
        source_candidates=record.pop('sourceCandidates');record.pop('candidateCount')
        sources=[]
        for source in source_candidates:
            if not source['source']:continue
            item=evidence(source['source'],source['line']);item['matchedDeclaration']=source['statement']
            if item not in sources:sources.append(item)
        if not sources:raise ValueError('INDEX_GENERATING_SOURCE_REQUIRED')
        record['sources']=sources
        sem=dict(definitionReconstructed=True,definitionDisposition='PRESERVE_SOURCE_DEFINED_INDEX',
                 nativeBehaviorVerified=False,schemaAccepted=False,
                 unexportedProperties=['indisvalid','indisready','indnullsnotdistinct','index storage/statistics'],
                 callerExecutionVerified=False)
        if not row['indisunique']:
            sem.update(classification='FOREIGN_KEY_ACCESS_PATH' if name.startswith('idx_fk_') else 'NONUNIQUE_ACCESS_PATH',
                effect='The full definition, key order, method and predicate match the pinned generating source. indisunique=false and indisprimary=false add no uniqueness rule; preserve the source-authored access path. No measured performance improvement or equal execution plan is inferred.',
                sourceExpressionVerified=True)
        elif name.endswith('_company_id_id_uidx'):
            proof=primary.get(table)
            if not proof or proof['row']['definition']!='PRIMARY KEY (id)':
                raise ValueError('REDUNDANT_ID_UNIQUENESS_PROOF_REQUIRED')
            sem.update(classification='TENANT_COMPOSITE_REFERENCE_KEY',
                effect='Existing validated PRIMARY KEY(id) already forbids equal IDs. Adding UNIQUE(company_id,id) rejects no additional tuple under that premise and supplies the ordered tenant-qualified reference key. It is not a tenant authorization rule.',
                primaryKeyProof=dict(row=proof['row'],sha256=sha(proof['row']),
                                     referenceUnchangedOrAdded=True,sources=proof['sources']))
        elif (table,name) in by_name and by_name[(table,name)]['row'].get('contype') in ('p','u'):
            proof=by_name[(table,name)]
            sem.update(classification='PRIMARY_KEY_BACKING' if row['indisprimary'] else 'UNIQUE_CONSTRAINT_BACKING',
                effect='This exact ordered unique index is the backing access structure for '+proof['row']['definition']+'. Its row-identity/domain disposition follows that separately reviewed constraint; the index adds no independent policy.',
                constraintProof=dict(row=proof['row'],sha256=sha(proof['row'])))
        else:
            if name not in BUSINESS_RULES:raise ValueError('BUSINESS_UNIQUENESS_DISPOSITION_REQUIRED:'+name)
            effect,callers=BUSINESS_RULES[name]
            sem.update(classification='BUSINESS_UNIQUENESS_RULE',effect=effect,
                       callerEvidence=[evidence(path,line) for path,line in callers],
                       nullSemantics='Ordinary NULL-distinct keys; predicate membership and explicit COALESCE sentinels are exactly those in the reconstructed source definition. No NULLS NOT DISTINCT claim is inferred from the comparator.')
            if name=='ediel_test_run_locks_one_active_agt_uidx':
                sem.update(definitionDisposition='PRESERVE_UNIQUE_GUARD_CALLER_FIXED',findingId='AI-001',
                    callerCorrection='Acquisition now checks every unreleased lock, maps a 23505 acquisition race to busy, and points to the explicit Släpp lås operator action. Preserve the unique guard; this is a caller repair, not a schema rewrite.',
                    callerRegressionTest='scripts/test-agt-run-lock-contract.cjs',
                    callerRegressionTestSha256=sha((ROOT/'scripts/test-agt-run-lock-contract.cjs').read_bytes()))
        record['semantics']=sem
    result.update(scope='SOURCE_QUALIFIED_ADDED_INDEX_DISPOSITIONS_NOT_ACCEPTANCE_ALLOWLIST',
        artifactSha256=ARCHIVE_SHA,artifactMemberSha256=sha(zipfile.ZipFile(ARCHIVE).read('full-schema-reference-diff.json')),
        constraintRegister=CONSTRAINT_REGISTER,constraintRegisterSha256=CONSTRAINT_REGISTER_SHA,
        referenceSource='supabase/schema.sql',referenceSourceSha256=REFERENCE_SHA,
        nativeSqlExecuted=False,definitionReconstructionCount=451,
        counts=dict(nonunique=362,primary=31,otherUnique=58),
        qualification='Native source execution and index validity/readiness remain required; source-defined equality is not business/actor/schema acceptance.')
    return result

if __name__=='__main__':
    if sys.argv[1:]:raise SystemExit('No options accepted')
    print(json.dumps(dispositions(),sort_keys=True,indent=2))
