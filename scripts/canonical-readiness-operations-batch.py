"""Immutable M/E/Z source effects; construction only, no runtime selection."""
import copy
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('readiness_loader',ROOT/'scripts/canonical-auth-provisioning-replay.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
replay=loader.controller();operations=replay.load_operations();alignment=operations.alignment
legacy=operations.legacy;BoundaryError=operations.BoundaryError;Source=operations.Source;check=operations.check
SPECS=(
 ('M','20260519_batch_6c_metering_billing_readiness.sql',154,'c44153ba502ab32f543f649d9001bfcc9685d90be054747520c2b11d67bfcb24'),
 ('E','20260520_batch_1_2_saas_ediel_control_center.sql',123,'7a198e941bbd735c0f56191d5ecf41cc85de03bbd89cea4f0b3369981127cdc8'),
 ('Z','20260520_final_z01_outbound_and_platform_guard.sql',54,'987fd23b93dac930007da4c47cbd20d11120ab2bd9afa10b9865d545938b71b6'),
)
TARGETS=('grid_owner_data_requests','metering_values','billing_underlays','partner_exports','outbound_requests','audit_logs')
BACKFILLS=tuple('public.'+name for name in TARGETS[:-1])
METER_DEFAULTS={'source_ediel_message_id':None,'canonical_dedupe_key':None,'is_current':True,'previous_value_id':None,
                'replaced_by_value_id':None,'revision_number':1,'correction_reason':None,'value_status':'current'}
COMPANY_DEFAULTS={'branding':{},'billing_settings':{},'ediel_id':None,'actor_role':None,'sender_sub_address':None,
                  'ediel_mailbox':None,'operating_environment':'test'}


def reviewed_paths():return tuple(ROOT/'supabase/migrations'/name for _,name,_,_ in SPECS)


def validate_sources(paths,staging=None):
    check(type(paths) is tuple and paths==reviewed_paths(),'READINESS_SOURCE_ORDER_REQUIRED')
    if staging is not None:check(type(staging) is legacy.StagedSources,'READINESS_STAGE_REQUIRED')
    manifest=json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files'];result=[]
    for path,(key,name,lines,digest) in zip(paths,SPECS):
        physical=path if staging is None else staging.hold/path.name
        check(type(path) is type(ROOT) and not path.is_symlink() and path.resolve()==path
              and physical.is_file() and not physical.is_symlink() and physical.resolve()==physical
              and physical.stat().st_uid==os.getuid(),'READINESS_PHYSICAL_SOURCE_REQUIRED')
        data=alignment.repair.read_source(path,staging);legacy.verify_bytes(data,digest,lines)
        check(manifest.get(name)==digest,'READINESS_MANIFEST_REQUIRED');result.append(Source(key,path,data,digest))
    return tuple(result)


def company_values(row):
    value=copy.deepcopy(row)
    for key,default in COMPANY_DEFAULTS.items():value.setdefault(key,copy.deepcopy(default))
    if value['branding'] is None:value['branding']={}
    if value['billing_settings'] is None:value['billing_settings']={}
    if value['operating_environment']!='production':value['operating_environment']='test'
    return value


def timestamp_text(value):
    if value in ('infinity','-infinity'):return value
    moment=datetime.fromisoformat(value);check(moment.tzinfo is not None,'READINESS_TIMEZONE_REQUIRED')
    moment=moment.astimezone(timezone.utc)
    return (f'{moment.year:04d}-{moment.month:02d}-{moment.day:02d} {moment.hour:02d}:{moment.minute:02d}:{moment.second:02d}'
            +('.'+f'{moment.microsecond:06d}'.rstrip('0') if moment.microsecond else '')+'+00')


def expected_rows(before):
    rows=copy.deepcopy(before)
    companies={row['id']:row for table,row in rows if table=='public.companies'}
    customers={row['id']:row for table,row in rows if table=='public.customers'}
    for table,row in rows:
        if table.removeprefix('public.') in TARGETS:row.setdefault('company_id',None)
        if table in BACKFILLS and row['company_id'] is None:
            customer=customers.get(row.get('customer_id'));owner=customer.get('company_id') if customer else None
            if owner is not None:
                check(companies.get(owner,{}).get('status') in (None,'active','onboarding'),'READINESS_TENANT_GUARD_REJECTS')
                row['company_id']=owner
        if table=='public.metering_values':
            for key,default in METER_DEFAULTS.items():row.setdefault(key,default)
            if row['canonical_dedupe_key'] is None and all(row.get(key) is not None for key in ('company_id','metering_point_id','read_at')):
                pieces=[row['company_id'],row['metering_point_id'],row.get('reading_type'),timestamp_text(row['read_at']),
                        timestamp_text(row['period_start']) if row.get('period_start') is not None else 'no-period-start',
                        timestamp_text(row['period_end']) if row.get('period_end') is not None else 'no-period-end']
                row['canonical_dedupe_key']='|'.join(value for value in pieces if value is not None)
        if table=='public.billing_underlays':
            row.setdefault('readiness_status','not_checked');row.setdefault('readiness_issues',[])
        if table=='public.partner_exports':row.setdefault('export_batch_key',None)
        if table=='public.companies':row.update(company_values(row))
        if table=='public.ediel_actor_settings':row.setdefault('company_id',None)
    return rows


def quote_ident(name):return '"'+name.replace('"','""')+'"'


def oracle_sql(sources,before):
    m,e,z=sources;shape,rows=before;present=lambda table:'relation/public.'+table in shape
    check(tuple(re.findall(r"'([a-z_]+)'",m.lines(12,17)))==TARGETS,'READINESS_TARGETS_REQUIRED')
    sql=m.lines(4,4)
    for table in TARGETS:
        if present(table):sql+='ALTER TABLE public.'+table+' ADD COLUMN IF NOT EXISTS company_id uuid;\nCREATE INDEX IF NOT EXISTS '+table+'_company_id_idx ON public.'+table+'(company_id);\n'
    if present('metering_values'):sql+=m.lines(79,86)+m.lines(95,106)
    if present('billing_underlays'):sql+=m.lines(114,118)+m.lines(137,151)+';\n'
    if present('partner_exports'):sql+=m.lines(126,128)
    sql+=e.lines(4,4)
    if present('companies'):
        sql+=e.lines(10,16)
        # Independent literal output model normalizes dirty company rows before
        # source-only validated constraint DDL. Never copy the source UPDATE.
        for table,row in rows:
            if table!='public.companies':continue
            value=company_values(row)
            if any(row.get(key)!=value[key] for key in ('branding','billing_settings','operating_environment')):
                sql+='UPDATE public.companies SET branding='+alignment.json_sql(value['branding'])+',billing_settings='+alignment.json_sql(value['billing_settings'])+',operating_environment='+alignment.literal(value['operating_environment'])+' WHERE id='+alignment.literal(row['id'])+'::uuid;\n'
        sql+=e.lines(27,34)
    if present('ediel_actor_settings'):sql+=e.lines(42,46)
    for table,start,end in (('communication_routes',54,55),('ediel_route_profiles',59,60),('ediel_messages',64,67),('audit_logs',71,72)):
        if present(table):sql+=e.lines(start,end)
    if all(present(table) for table in ('companies','ediel_actor_settings','communication_routes','ediel_route_profiles')):sql+=e.lines(87,121)+';\n'
    for table,column,start,end in (('communication_routes','route_scope',20,25),('outbound_requests','request_type',39,44)):
        if not present(table):continue
        prefix='constraint/public.'+table+'/'
        for key,value in sorted(shape.items()):
            if key.startswith(prefix) and value['kind']=='c' and re.search(column.replace('_','.'),value['definition'],re.I|re.S):
                sql+='ALTER TABLE public.'+table+' drop constraint if exists '+quote_ident(key[len(prefix):])+';\n'
        sql+=z.lines(start,end)
    # Original final indexes are unconditional even when guarded tables are absent.
    return sql+z.lines(48,54)


def new_index_keys(sources,before,rows=()):
    names=re.findall(r'create (?:unique )?index if not exists ([a-z_]+)',oracle_sql(sources,(before,rows)),re.I)
    return tuple('alignment_index/public.'+name for name in names
                 if 'index/public.'+name not in before and 'alignment_index/public.'+name not in before)


def assertions(before,expected,rows,sources):
    literal=alignment.json_sql;equal=alignment.catalog.final_equal_sql('r.base','actual.value','r.final','r.new_indexes')
    return '''CREATE TEMP TABLE alignment_reference(base jsonb,final jsonb,before_rows jsonb,after_rows jsonb,new_indexes jsonb) ON COMMIT DROP;
INSERT INTO alignment_reference VALUES ('''+','.join((literal(before[0]),literal(expected),literal(before[1]),literal(rows),literal(new_index_keys(sources,before[0],before[1]))))+''');
CREATE TEMP TABLE readiness_final(value) ON COMMIT DROP AS '''+operations.catalog_sql()+'''
DO $$ BEGIN IF NOT (SELECT '''+equal+''' FROM readiness_final actual CROSS JOIN alignment_reference r) THEN
 RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='READINESS_CATALOG_MISMATCH'; END IF; END $$;
'''+alignment.assert_rows('after_rows')+"\nSELECT 'READINESS_COMPLETE';\n"
