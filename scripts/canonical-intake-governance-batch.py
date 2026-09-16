"""Whole historical R/D/I source effects, without selection authority."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('intake_loader',ROOT/'scripts/canonical-auth-provisioning-replay.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
replay=loader.controller();operations=replay.load_operations();alignment=operations.alignment
legacy=operations.legacy;BoundaryError=operations.BoundaryError;Source=operations.Source;check=operations.check
SPECS=(
 ('R','20260513_ediel_agt_saas_runtime_safe.sql',163,'152e4e573bde3b50eda8c7e5bfdca6fe4a54115e4ed1d7bcfc8e1b946ed1c15b'),
 ('D','20260520_company_delete_backfill_and_admin_layout.sql',97,'72aef3d5609bd6a508299bccf1eed849b58a4f925844b097d44bb8bdca667d1f'),
 ('I','20260521_batch_customer_intake_debug_hardening.sql',72,'562c2447554c43a3aef96bbbcd88a9f36ad1cc884ba97268ca96bc455ec54e80'),
)
TARGETS=('ediel_actor_settings','ediel_route_profiles','communication_routes','ediel_messages',
 'ediel_message_events','ediel_test_runs','ediel_test_run_messages','ediel_tgt_dynamic_test_data','outbound_requests')
STATUSES={
 'companies':('active','onboarding','paused','suspended','archived','pending_deletion','deleted_test_only'),
 'company_memberships':('active','pending','invited','disabled','suspended','revoked','removed','removed_from_company','invitation_revoked','locked_security','deleted_test_only'),
 'company_invitations':('pending','accepted','revoked','expired','invitation_revoked','deleted_test_only'),
 'auth_email_events':('sent','queued','pending','delivered','verified','accepted','failed','created','skipped','blocked','expired','revoked','opened','clicked','bounced','error','unknown','deleted_test_only'),
}
INTAKE_DEFAULTS={'intake_status':'draft','intake_missing_fields':[],'intake_quality_score':None}


def reviewed_paths():return tuple(ROOT/'supabase/migrations'/name for _,name,_,_ in SPECS)


def validate_sources(paths,staging=None):
    check(type(paths) is tuple and paths==reviewed_paths(),'INTAKE_SOURCE_ORDER_REQUIRED')
    if staging is not None:check(type(staging) is legacy.StagedSources,'INTAKE_STAGE_REQUIRED')
    manifest=json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files'];result=[]
    for path,(key,name,lines,digest) in zip(paths,SPECS):
        physical=path if staging is None else staging.hold/path.name
        check(type(path) is type(ROOT) and not path.is_symlink() and path.resolve()==path
              and physical.is_file() and not physical.is_symlink() and physical.resolve()==physical
              and physical.stat().st_uid==os.getuid(),'INTAKE_PHYSICAL_SOURCE_REQUIRED')
        data=alignment.repair.read_source(path,staging);legacy.verify_bytes(data,digest,lines)
        check(manifest.get(name)==digest,'INTAKE_MANIFEST_REQUIRED');result.append(Source(key,path,data,digest))
    return tuple(result)


def expected_rows(before,shape):
    rows=copy.deepcopy(before);companies={row['id'] for table,row in rows if table=='public.companies'}
    present=lambda table:'relation/public.'+table in shape
    # Validated CHECKs precede normalization and orphan deletion in the source.
    for table,row in rows:
        short=table.removeprefix('public.')
        if short in STATUSES:check(row.get('status') is None or row['status'] in STATUSES[short],'INTAKE_STATUS_CHECK_REJECTS')
    after=[]
    for table,row in rows:
        short=table.removeprefix('public.')
        if short in TARGETS:row.setdefault('company_id',None)
        if short=='companies':
            if row.get('status') is None:row['status']='active'
            row.setdefault('status_reason',None)
            check('updated_at' in row,'INTAKE_EXISTING_COMPANY_TIMESTAMP_REQUIRED')
        if short in ('company_memberships','company_invitations'):
            if row.get('status') is None:row['status']='active' if short=='company_memberships' else 'pending'
            if present('companies') and row.get('company_id') is not None and row['company_id'] not in companies:continue
        if present('companies') and short in ('tenant_governance_events','audit_logs') and row.get('company_id') is not None and row['company_id'] not in companies:
            row['company_id']=None
            if short=='tenant_governance_events':
                metadata=row.get('metadata');flag={'company_deleted_or_missing':True}
                # jsonb || merges objects; scalar/array operands are arrays.
                if metadata is None:check(shape.get('column/public.tenant_governance_events/metadata',{}).get('notnull') is True,'INTAKE_JSON_NULL_KIND_REQUIRED')
                row['metadata']=({**metadata,**flag} if isinstance(metadata,dict)
                                 else (metadata if isinstance(metadata,list) else [metadata])+[flag])
        if short=='customers':
            for key,value in INTAKE_DEFAULTS.items():row.setdefault(key,copy.deepcopy(value))
        after.append([table,row])
    return after


def oracle_sql(sources,before):
    r,d,i=sources;shape,rows=before;present=lambda table:'relation/public.'+table in shape
    columns=lambda table:{key.rsplit('/',1)[-1] for key in shape if key.startswith('column/public.'+table+'/')}
    check(tuple(re.findall(r"'([a-z_]+)'",r.lines(14,22)))==TARGETS,'INTAKE_TARGETS_REQUIRED')
    sql=''
    for table in TARGETS:
        if present(table):sql+='ALTER TABLE public.'+table+' ADD COLUMN IF NOT EXISTS company_id uuid;\nCREATE INDEX IF NOT EXISTS '+table+'_company_id_idx ON public.'+table+'(company_id);\n'
    # Resolve each information_schema guard independently; declarations remain pinned.
    indexes=re.findall(r'CREATE INDEX IF NOT EXISTS ([a-z_]+)\s+ON public\.([a-z_]+) \(([^;]+)\);',r.data.decode())
    check(len(indexes)==7,'INTAKE_RUNTIME_INDEXES_REQUIRED')
    for name,table,expression in indexes:
        required=set(re.findall(r'\b[a-z_]+\b',expression))-{'desc'}
        required={name for name in required if name.upper()!='DESC'}
        if present(table) and required <= (columns(table)|({'company_id'} if table in TARGETS else set())):
            sql+='CREATE INDEX IF NOT EXISTS '+name+' ON public.'+table+'('+expression+');\n'
    for table,comment in re.findall(r"COMMENT ON COLUMN public\.([a-z_]+)\.company_id IS '([^']+)';",r.data.decode()):
        if present(table) and ('company_id' in columns(table) or table in TARGETS):sql+='COMMENT ON COLUMN public.'+table+'.company_id IS '+alignment.literal(comment)+';\n'
    for table,start,end,index_start,index_end in (('companies',11,13,20,21),('company_memberships',29,31,37,38),('company_invitations',42,44,50,51),('auth_email_events',59,61,63,64)):
        if present(table):sql+=d.lines(start,end)+d.lines(index_start,index_end)
    sql+=i.lines(4,4)
    if present('customers'):
        sql+=i.lines(9,11)
        for name,start,end in (('customers_intake_status_check',19,29),('customers_intake_quality_score_check',38,40)):
            if 'constraint/public.customers/'+name not in shape:sql+=i.lines(start,end)
        sql+=i.lines(43,50)
    for table,start,end in (('customer_sites',54,55),('metering_points',59,60),('customer_info_requests',64,65),('customer_cases',69,70)):
        if present(table):sql+=i.lines(start,end)
    return sql


def new_index_keys(sources,before,rows=()):
    names=re.findall(r'create (?:unique )?index if not exists ([a-z_]+)',oracle_sql(sources,(before,rows)),re.I)
    return tuple('alignment_index/public.'+name for name in names if 'index/public.'+name not in before and 'alignment_index/public.'+name not in before)


def assertions(before,expected,rows,sources):
    literal=alignment.json_sql;equal=alignment.catalog.final_equal_sql('r.base','actual.value','r.final','r.new_indexes')
    return '''CREATE TEMP TABLE alignment_reference(base jsonb,final jsonb,before_rows jsonb,after_rows jsonb,new_indexes jsonb) ON COMMIT DROP;
INSERT INTO alignment_reference VALUES ('''+','.join((literal(before[0]),literal(expected),literal(before[1]),literal(rows),literal(new_index_keys(sources,before[0],before[1]))))+''');
CREATE TEMP TABLE intake_final(value) ON COMMIT DROP AS '''+operations.catalog_sql()+'''
DO $$ BEGIN IF NOT (SELECT '''+equal+''' FROM intake_final actual CROSS JOIN alignment_reference r) THEN
 RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='INTAKE_CATALOG_MISMATCH'; END IF; END $$;
'''+alignment.assert_rows('after_rows')+"\nSELECT 'INTAKE_COMPLETE';\n"
