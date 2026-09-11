"""Pinned complete customer/Ediel operations sources and independent effects.

Construction only. No selection, production target, or runtime adoption.
"""
from dataclasses import dataclass
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('operations_loader',ROOT/'scripts/canonical-auth-provisioning-replay.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
replay=loader.controller();legacy=replay.load_batch();alignment=replay.load_alignment()
BoundaryError=legacy.BoundaryError
SPECS=(
 ('L','20260519_customer_move_out_lifecycle.sql',73,'cd2a6b782bf1a5571c0d77dc948440b55e076df01b8986c58e97d07c9ab239b8'),
 ('E','20260519_ediel_tenant_profile_runtime_sync.sql',90,'b5c475b7419c824b4d1c8ec713131d48c41c2be6f5607890bda42f238548426e'),
 ('U','20260519_operations_customers_ux.sql',81,'caafdfde64eaf88d952a23465ef8aed307ce49e40ed54c6cf84b613e873f5b2a'),
)
TARGETS=('ediel_actor_settings','ediel_route_profiles','communication_routes','ediel_messages',
 'ediel_message_events','ediel_test_runs','ediel_test_run_messages','outbound_requests',
 'grid_owner_data_requests','meter_reading_series','meter_reading_values','billing_metering_exports')
WRITES=('public.ediel_actor_settings','public.communication_routes','public.ediel_route_profiles')


def check(value,label='OPERATIONS_CONTRACT_REQUIRED'):
    if not value:raise BoundaryError(label)


@dataclass(frozen=True,repr=False)
class Source:
    key:str
    path:Path
    data:bytes
    sha256:str

    def lines(self,start,end):
        rows=self.data.decode().splitlines(True)
        check(type(start) is int and type(end) is int and 1<=start<=end<=len(rows))
        return ''.join(rows[start-1:end])


def reviewed_paths():return tuple(ROOT/'supabase/migrations'/name for _,name,_,_ in SPECS)


def validate_sources(paths,staging=None):
    check(type(paths) is tuple and paths==reviewed_paths(),'OPERATIONS_SOURCE_ORDER_REQUIRED')
    if staging is not None:check(type(staging) is legacy.StagedSources,'OPERATIONS_STAGE_REQUIRED')
    manifest=json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
    result=[]
    for path,(key,name,lines,digest) in zip(paths,SPECS):
        check(type(path) is type(ROOT) and not path.is_symlink() and path.resolve()==path,
              'OPERATIONS_PHYSICAL_SOURCE_REQUIRED')
        physical=path if staging is None else staging.hold/path.name
        check(physical.is_file() and not physical.is_symlink() and physical.stat().st_uid==os.getuid(),
              'OPERATIONS_PHYSICAL_SOURCE_REQUIRED')
        data=alignment.repair.read_source(path,staging)
        legacy.verify_bytes(data,digest,lines)
        check(manifest.get(name)==digest,'OPERATIONS_MANIFEST_REQUIRED')
        result.append(Source(key,path,data,digest))
    return tuple(result)


def exists(shape,table):return 'relation/public.'+table in shape


def ddl(sources,shape):
    """Direct declarations; Python resolves guards independently from DO bodies."""
    check(tuple(s.key for s in sources)==('L','E','U'))
    l,e,u=sources;sql=[l.lines(6,6)]
    for table,start,end in (('customers',11,16),('customer_sites',20,23),('metering_points',27,29)):
        if exists(shape,table):sql.append(l.lines(start,end))
    sql.append(l.lines(33,54))
    policy='policy/public.customer_lifecycle_events/customer_lifecycle_events_service_role_all'
    if policy not in shape:sql.append(l.lines(64,68))
    sql.append(l.lines(72,73))
    parsed=tuple(re.findall(r"'([a-z_]+)'",e.lines(10,21)))
    check(parsed==TARGETS,'OPERATIONS_TARGETS_REQUIRED')
    for table in TARGETS:
        if exists(shape,table):
            sql.append('ALTER TABLE public.'+table+' ADD COLUMN IF NOT EXISTS company_id uuid;')
            sql.append('CREATE INDEX IF NOT EXISTS '+table+'_company_id_idx ON public.'+table+' (company_id);')
    for table,start,end,comment in (('ediel_actor_settings',62,63,80),('communication_routes',67,68,84),('ediel_route_profiles',72,73,88)):
        if exists(shape,table):sql.extend((e.lines(start,end),e.lines(comment,comment)))
    if exists(shape,'supplier_switch_events'):
        sql.append(u.lines(8,18))
        # The original source searches conname globally, not by target table.
        names=shape['operations_constraint_names']
        for name,parent,start,end in (('supplier_switch_events_archived_by_fkey','auth.users',32,34),
                                     ('supplier_switch_events_company_id_fkey','public.companies',47,49)):
            if 'relation/'+parent in shape and name not in names:sql.append(u.lines(start,end))
    indexes=re.findall(r"execute '(create index[^']+)';",u.data.decode())
    check(len(indexes)==8,'OPERATIONS_INDEX_DECLARATIONS_REQUIRED')
    for statement in indexes:
        table=re.search(r' on public\.([a-z_]+) ',statement).group(1)
        if exists(shape,table):sql.append(statement+';')
    return '\n'.join(sql)


def expected_rows(before):
    rows=copy.deepcopy(before)
    companies=[row for table,row in rows if table=='public.companies']
    extra={
      'public.customers':('moved_out_at','lifecycle_closed_at','lifecycle_closed_by','lifecycle_status_reason'),
      'public.customer_sites':('move_out_date','closed_at','closed_reason'),
      'public.metering_points':('closed_at','closed_reason'),
      'public.supplier_switch_events':('archived_at','archived_by','archive_reason','company_id'),
    }
    for table,row in rows:
        for key in extra.get(table,()):row.setdefault(key,None)
        if table.startswith('public.') and table[7:] in TARGETS:row.setdefault('company_id',None)
        if table in WRITES and len(companies)==1 and row.get('company_id') is None:
            check(companies[0].get('status') in (None,'active','onboarding'),'OPERATIONS_TENANT_GUARD_REJECTS')
            row['company_id']=companies[0]['id']
    return rows


def catalog_sql():
    base=alignment.catalog.sql(alignment.repair).strip().removesuffix(';')
    return '''WITH operations_base(value) AS ('''+base+''')
SELECT value || jsonb_build_object(
 'operations_constraint_names',(SELECT coalesce(jsonb_agg(conname ORDER BY conname),'[]') FROM pg_constraint),
 'operations_comments',(SELECT coalesce(jsonb_object_agg(key,description),'{}') FROM (
  SELECT pg_describe_object(d.classoid,d.objoid,d.objsubid) AS key,d.description
  FROM pg_description d JOIN pg_class c ON d.classoid='pg_class'::regclass AND c.oid=d.objoid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage')
 ) comments)) FROM operations_base;'''


def new_index_keys(sources,before):
    sql=ddl(sources,before)
    names=re.findall(r'create index if not exists ([a-z_]+)',sql,re.I)
    return tuple('alignment_index/public.'+name for name in names
        if 'index/public.'+name not in before and 'alignment_index/public.'+name not in before)


def assertions(before,expected,rows,sources):
    literal=alignment.json_sql
    equal=alignment.catalog.final_equal_sql('r.base','actual.value','r.final','r.new_indexes')
    return '''CREATE TEMP TABLE alignment_reference(base jsonb,final jsonb,before_rows jsonb,after_rows jsonb,new_indexes jsonb) ON COMMIT DROP;
INSERT INTO alignment_reference VALUES ('''+','.join((literal(before[0]),literal(expected),literal(before[1]),literal(rows),literal(new_index_keys(sources,before[0]))))+''');
CREATE TEMP TABLE operations_final(value) ON COMMIT DROP AS '''+catalog_sql()+'''
DO $$ BEGIN IF NOT (SELECT '''+equal+''' FROM operations_final actual CROSS JOIN alignment_reference r) THEN
 RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='OPERATIONS_CATALOG_MISMATCH'; END IF; END $$;
'''+alignment.assert_rows('after_rows')+"\nSELECT 'OPERATIONS_COMPLETE';\n"
