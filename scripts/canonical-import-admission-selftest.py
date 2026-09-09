#!/usr/bin/env python3
"""Read-only import admission and isolated PG17 fixtures; not source application."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
DATABASE = 'gridex_import_admission_fixture'
ADMIN = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'
TARGET = f'postgresql://postgres:postgres@127.0.0.1:55440/{DATABASE}'
SOURCES = {
 'I': ('20260519_customer_intake_contracts_tenant_hardening.sql', 'a448184e58e8777c41f8bdefb32e45a1365bd37fd9a8e316065da657e57e19f4'),
 'F': ('20260519_final_saas_hardening.sql', '2037dbc535d18d7575820d7f40d2a8ef4848b67060161e6851a01eb15990105e'),
 'D': ('20260526_debug_step1_2f_customer_import_foundation.sql', 'b2e764f4533f0539af021669831e9077582b1a90a257cbb8564777f42971465a'),
}
BATCH = 'customer_import_batches'
ROW = 'customer_import_rows'
VERSION = 'contract_offer_versions'
# Each source statement is independently accounted, including their shared joins.
JOINS = {
 'I54-136': [('customer_contacts','customer_id','customers'), ('customer_addresses','customer_id','customers'),
  ('customer_sites','customer_id','customers'), ('metering_points','site_id','customer_sites'),
  ('customer_contracts','customer_id','customers'), ('customer_contract_events','customer_contract_id','customer_contracts'),
  ('powers_of_attorney','customer_id','customers'), ('supplier_switch_requests','customer_id','customers'),
  ('supplier_switch_events','switch_request_id','supplier_switch_requests')],
 'F121-203': [('customer_sites','customer_id','customers'), ('customer_contacts','customer_id','customers'),
  ('customer_addresses','customer_id','customers'), ('metering_points','site_id','customer_sites'),
  ('customer_contracts','customer_id','customers'), ('supplier_switch_requests','customer_id','customers'),
  ('supplier_switch_events','switch_request_id','supplier_switch_requests'), ('billing_underlays','customer_id','customers'),
  ('customer_contract_events','customer_contract_id','customer_contracts')],
}
PERMISSIONS = {
 'tenants.read': ('Läsa bolag', 'Kan se elhandelsbolag på plattformen.'),
 'tenants.write': ('Skapa och ändra bolag', 'Kan skapa och uppdatera elhandelsbolag.'),
 'tenants.invite': ('Bjuda in till bolag', 'Kan bjuda in användare till ett elhandelsbolag.'),
}
ROLE_NAME = 'Bolagsansvarig'
ROLE_DESCRIPTION = 'Administrerar användare och dagliga flöden inom sitt eget elhandelsbolag.'


def read(path):
    return (ROOT / path).read_text()


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def source(alias):
    return read('supabase/migrations/' + SOURCES[alias][0])


def q(value):
    return "'" + value.replace("'", "''") + "'"


def selection():
    module('canonical-operations-sync-selftest').selection()
    order = json.loads(read('scripts/gridex-aud-003-foundation-order.json'))['foundation']
    assert order[32] == 'migrations/20260909123000_canonical_invitation_token_prerequisite.sql'
    for name, digest in SOURCES.values():
        assert hashlib.sha256((ROOT / 'supabase/migrations' / name).read_bytes()).hexdigest() == digest
        assert 'migrations/' + name not in order
    assert not any('6d2_' in path for path in order)
    return order[:33]


def table_sql(alias, table):
    """Pinned, narrowly extracted CREATE for REDUCED synthetic setup only."""
    match = re.search(r'create table if not exists public\.' + table + r' \(\n.*?\n\);', source(alias), re.S)
    assert match, (alias, table)
    return match.group(0)


def columns(alias, table):
    result = {}
    for line in table_sql(alias, table).splitlines()[1:-1]:
        match = re.match(r'  (\w+) (uuid|text|integer|jsonb|timestamptz)\b(.*)', line)
        if not match:
            assert line.strip().startswith(('constraint ', 'unique ')), line
            continue
        name, typ, rest = match.groups()
        default = re.search(r" default (gen_random_uuid\(\)|now\(\)|'[^']*'(?:::jsonb)?|\d+)", rest)
        value = default.group(1) if default else None
        if value and typ == 'text':
            value += '::text'
        result[name] = [typ, 'not null' in rest or 'primary key' in rest, value]
    return result


def shapes():
    result = {alias: {t: columns(alias,t) for t in (BATCH, ROW)} for alias in SOURCES}
    for alias in ('I','F'):
        result[alias+'D'] = {t: {**result['D'][t], **result[alias][t]} for t in (BATCH, ROW)}
    return result


def exists(table):
    return f'to_regclass({q("public." + table)}) is not null'


def has(table, fields):
    schema, name = table.split('.') if '.' in table else ('public', table)
    tests = [f"exists(select 1 from pg_attribute where attrelid=to_regclass({q(schema+'.'+name)}) and attname={q(col)} and atttypid={q(typ)}::regtype and not attisdropped and attgenerated='' and attidentity='')" for col,typ in fields.items()]
    return '(' + ' and '.join(tests) + ')'


def receipt(category, count='1', level='blocking', detail=''):
    return f"items := items || jsonb_build_array(jsonb_build_object('category',{q(category)},'count',({count}),'level',{q(level)},'detail',{q(detail)}));\n"


def gate(category, condition, detail='', level='blocking'):
    return f'if ({condition}) then\n' + receipt(category, detail=detail, level=level) + 'end if;\n'


def count_gate(category, query, detail='', level='blocking', guard='true', include_zero=False):
    """Only aggregate counts leave the server; errors expose SQLSTATE, never DETAIL."""
    emit = receipt(category, 'n', level, detail)
    if not include_zero:
        emit = 'if n > 0 then\n' + emit + 'end if;\n'
    return f"if {guard} then begin execute {q(query)} into n;\n{emit}exception when others then\n" + receipt('inspection_error',detail=category) + "end; end if;\n"


def identity(table, required=True):
    full = table if '.' in table else 'public.'+table
    present = f'to_regclass({q(full)}) is not null'
    valid = f"exists(select 1 from pg_class c where c.oid=to_regclass({q(full)}) and c.relkind='r' and not c.relispartition and not exists(select 1 from pg_inherits h where h.inhrelid=c.oid or h.inhparent=c.oid))"
    pk = f"exists(select 1 from pg_constraint k join pg_index i on i.indexrelid=k.conindid where k.conrelid=to_regclass({q(full)}) and k.contype='p' and k.convalidated and not k.condeferrable and k.conkey=array[(select attnum from pg_attribute where attrelid=k.conrelid and attname='id')]::smallint[] and i.indisunique and i.indisvalid and i.indisready and i.indislive and i.indimmediate)"
    body = gate('relation', 'not '+valid, table) + gate('identity', 'not '+has(full,{'id':'uuid'})+' or not '+pk, table)
    return (gate('relation', 'not '+present, table) if required else '') + f'if {present} then\n{body}end if;\n'


def arbiter(table, fields):
    nums = ','.join(f"(select attnum from pg_attribute where attrelid=to_regclass('public.{table}') and attname='{col}')" for col in fields)
    return f"exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam where i.indrelid=to_regclass('public.{table}') and i.indisunique and i.indimmediate and i.indisvalid and i.indisready and i.indislive and i.indpred is null and i.indexprs is null and i.indnkeyatts={len(fields)} and i.indnatts={len(fields)} and (select array_agg(k order by ord) from unnest(i.indkey) with ordinality u(k,ord))=array[{nums}]::smallint[] and a.amname='btree')"


def index_sql():
    indexes = {
      'customer_import_batches_company_created_idx': (BATCH, ['company_id, created_at DESC']),
      'customer_import_batches_company_status_created_idx': (BATCH,['company_id, status, created_at DESC']),
      'customer_import_rows_batch_idx': (ROW,['import_batch_id, row_number','import_batch_id','batch_id, row_number','batch_id']),
      'customer_import_rows_company_status_idx': (ROW,['company_id, status']),
      'customer_import_rows_company_idx': (ROW,['company_id']),
      'customer_import_rows_company_status_created_idx': (ROW,['company_id, status, created_at DESC']),
      'customer_import_rows_company_batch_idx': (ROW,['company_id, import_batch_id, row_number']),
      'customer_import_rows_customer_idx': (ROW,['company_id, customer_id']),
      'contract_offer_versions_company_offer_idx': (VERSION,['company_id, contract_offer_id, created_at DESC']),
      'contract_offers_company_status_idx': ('contract_offers',['company_id, status, is_active']),
      'customers_company_status_idx': ('customers',['company_id, status']),
      'customers_company_email_idx': ('customers',['company_id, lower(email)']),
      'customers_company_org_idx': ('customers',['company_id, org_number']),
      'customers_company_personal_idx': ('customers',['company_id, personal_number']),
      'customer_sites_company_facility_idx': ('customer_sites',['company_id, facility_id']),
      'metering_points_company_meter_point_idx': ('metering_points',['company_id, meter_point_id']),
      'customer_contracts_company_customer_idx': ('customer_contracts',['company_id, customer_id, created_at DESC']),
      'customer_contracts_company_offer_idx': ('customer_contracts',['company_id, contract_offer_id']),
    }
    chunks=[]
    owner_targets={t for group in JOINS.values() for child,_,parent in group for t in (child,parent)} | {'contract_offers','audit_logs','access_logs','outbound_requests','communication_routes','grid_owner_data_requests','customer_operation_tasks','customer_documents','power_of_attorneys','powers_of_attorney','metering_values','meter_readings','partner_exports','customer_authorization_documents'}
    for table in sorted(owner_targets):
        indexes[table+'_company_id_idx']=(table,['company_id'])
    for name,(table,keys) in indexes.items():
        defs=','.join(q(f'CREATE INDEX {name} ON public.{table} USING btree ({key})') for key in keys)
        compatible=f"exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.{name}') and i.indrelid=to_regclass('public.{table}') and i.indisvalid and i.indisready and i.indislive and not i.indisunique and i.indpred is null and i.indexprs is null and pg_get_indexdef(i.indexrelid) in ({defs}))"
        if any('lower(email)' in key for key in keys):
            compatible=compatible.replace('and i.indexprs is null ', '')
        chunks.append(gate('index_shape',exists(name)+' and not '+compatible,name))
    return '\n'.join(chunks)


def shape_sql():
    expected=q(json.dumps(shapes()))+'::jsonb'
    # Exact known column metadata; arbitrary extra columns are inventoried, never dropped.
    # Legacy batch_id is rejected below pending a separate mapping contract.
    return f"""
if {exists(BATCH)} <> {exists(ROW)} then
 {receipt('incomplete_import_shape')}
elsif not {exists(BATCH)} then
 {receipt('empty_reconstruction',level='compatibility')}
else
 matching := array[]::text[];
 for variant in select key,value from jsonb_each({expected}) loop
   ok := true;
   for tbl in select key,value from jsonb_each(variant.value) loop
     for col in select key,value from jsonb_each(tbl.value) loop
       select a.atttypid=(col.value->>0)::regtype and a.attnotnull=(col.value->>1)::boolean
         and a.attgenerated='' and a.attidentity=''
         and pg_get_expr(d.adbin,d.adrelid) is not distinct from col.value->>2
       into found_ok from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
       where a.attrelid=to_regclass('public.'||tbl.key) and a.attname=col.key and not a.attisdropped;
       ok := ok and coalesce(found_ok,false);
     end loop;
     -- Known columns from the union must not appear outside this variant.
     if exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.'||tbl.key)
       and a.attnum>0 and not a.attisdropped and a.attname in
         (select key from jsonb_each({expected}->'D'->tbl.key))
       and not tbl.value ? a.attname) then ok:=false; end if;
   end loop;
   if ok then matching:=array_append(matching,variant.key); end if;
 end loop;
 if cardinality(matching)=0 then {receipt('import_column_shape')}
 else items:=items || jsonb_build_array(jsonb_build_object('category','supported_shape','count',1,'level','compatibility','detail',array_to_string(matching,','))); end if;
 if exists(select 1 from pg_attribute where attrelid=to_regclass('public.{ROW}') and attname='batch_id' and not attisdropped) then
  {receipt('legacy_batch_id_requires_mapping')}
 end if;
end if;
"""


def foreign_keys():
    chunks=[]
    edges=[(BATCH,'company_id','public.companies'),(BATCH,'created_by','auth.users'),
      (ROW,'import_batch_id','public.'+BATCH),(ROW,'company_id','public.companies'),
      (ROW,'customer_id','public.customers'),(ROW,'reviewed_by','auth.users'),
      (ROW,'possible_existing_customer_id','public.customers'),(VERSION,'company_id','public.companies'),
      (VERSION,'created_by','auth.users'),(VERSION,'contract_offer_id','public.contract_offers')]
    for table,col,parent in edges:
        name=table+'_'+col+'_fkey'
        match=f"k.contype='f' and k.confrelid=to_regclass('{parent}') and k.conkey=array[(select attnum from pg_attribute where attrelid=k.conrelid and attname='{col}')]::smallint[] and k.confkey=array[(select attnum from pg_attribute where attrelid=k.confrelid and attname='id')]::smallint[]"
        chunks.append(gate('foreign_constraint_collision',f"exists(select 1 from pg_constraint k where k.conname='{name}' and (k.conrelid is distinct from to_regclass('public.{table}') or not ({match})))",name))
        chunks.append(gate('unvalidated_reference',f"exists(select 1 from pg_constraint k where k.conrelid=to_regclass('public.{table}') and ({match}) and not k.convalidated)",name,level='final_gate'))
        chunks.append(gate('missing_reference_enforcement',has(table,{col:'uuid'})+f" and not exists(select 1 from pg_constraint k where k.conrelid=to_regclass('public.{table}') and ({match}))",table+'.'+col,level='final_gate'))
        chunks.append(count_gate('orphan_reference',f'select count(*) from public.{table} c left join {parent} p on p.id=c.{col} where c.{col} is not null and p.id is null',table+'.'+col,guard=has(table,{col:'uuid'})+' and '+has(parent,{'id':'uuid'})))
    return '\n'.join(chunks)


def ownership_sql():
    chunks=[]
    for unit,edges in JOINS.items():
        for child,fk,parent in edges:
            detail=unit+':'+child+'.'+fk
            guard=has(child,{'id':'uuid',fk:'uuid','company_id':'uuid'})+' and '+has(parent,{'id':'uuid','company_id':'uuid'})
            chunks.append(gate('join_columns',exists(child)+' and (not '+exists(parent)+' or not ('+guard+'))',detail))
            join=f'from public.{child} c join public.{parent} p on p.id=c.{fk}'
            chunks.append(count_gate('would_change_ownership','select count(*) '+join+' where c.company_id is null and p.company_id is not null',detail,guard=guard,include_zero=True))
            chunks.append(count_gate('conflicting_ownership','select count(*) '+join+' where c.company_id is not null and p.company_id is not null and c.company_id<>p.company_id',detail,guard=guard))
            chunks.append(count_gate('null_parent_ownership','select count(*) '+join+' where p.company_id is null',detail,level='final_gate',guard=guard))
            chunks.append(count_gate('orphan_ownership_parent',f'select count(*) from public.{child} c left join public.{parent} p on p.id=c.{fk} where c.{fk} is not null and p.id is null',detail,guard=guard))
            chunks.append(count_gate('null_ownership_parent',f'select count(*) from public.{child} where {fk} is null',detail,level='final_gate',guard=guard))
    # Import and historical version agreement is checked independently of FK names/actions.
    for table,col,parent in [(ROW,'import_batch_id',BATCH),(ROW,'customer_id','customers'),(ROW,'possible_existing_customer_id','customers'),(VERSION,'contract_offer_id','contract_offers')]:
        guard=has(table,{col:'uuid','company_id':'uuid'})+' and '+has(parent,{'id':'uuid','company_id':'uuid'})
        chunks.append(count_gate('import_owner_mismatch',f'select count(*) from public.{table} c join public.{parent} p on p.id=c.{col} where c.company_id is not null and p.company_id is not null and c.company_id<>p.company_id',table+'.'+col,guard=guard))
        chunks.append(count_gate('parent_owner_incomplete',f'select count(*) from public.{table} c join public.{parent} p on p.id=c.{col} where p.company_id is null',table+'.'+col,guard=guard))
    for table,fields in [(BATCH,{'company_id':'uuid'}),(ROW,{'company_id':'uuid','import_batch_id':'uuid','row_number':'integer'}),(VERSION,{'contract_offer_id':'uuid','version_number':'integer','snapshot':'jsonb'})]:
        chunks.append(count_gate('mandatory_values',f'select count(*) from public.{table} where '+' or '.join(col+' is null' for col in fields),table,guard=has(table,fields)))
    chunks.append(count_gate('version_owner_incomplete',f'select count(*) from public.{VERSION} where company_id is null',VERSION,guard=has(VERSION,{'company_id':'uuid'}),level='final_gate'))
    chunks.append(count_gate('stronger_version_contract',f'select count(*) from (select contract_offer_id,version_number from public.{VERSION} group by contract_offer_id,version_number having count(*)>1 or version_number<=0) x',VERSION,guard=has(VERSION,{'contract_offer_id':'uuid','version_number':'integer'}),level='final_gate'))
    chunks.append(count_gate('stronger_row_number_contract',f'select count(*) from (select import_batch_id,row_number from public.{ROW} group by import_batch_id,row_number having count(*)>1) x',ROW,guard=has(ROW,{'import_batch_id':'uuid','row_number':'integer'}),level='final_gate'))
    return '\n'.join(chunks)


def checks_sql():
    chunks=[]
    statuses={BATCH:[['previewed','imported','partially_imported','failed'],['previewed','completed','failed'],['previewed','imported','partially_imported','completed','failed']],
      ROW:[['pending','created','skipped','failed'],['created','skipped','failed','duplicate_warning'],['pending','ready_to_create','requires_review','duplicate_warning','missing_fields','created','rejected','failed','skipped','linked_existing_customer']]}
    for table,variants in statuses.items():
        defs=["CHECK ((status = ANY (ARRAY["+', '.join(q(v)+'::text' for v in values)+"])))" for values in variants]
        guard=has(table,{'status':'text'})
        chunks.append(count_gate('status_values',f'select count(*) from public.{table} where status is null or status not in ('+','.join(q(s) for s in variants[-1])+')',table,guard=guard))
        chunks.append(gate('check_shape',f"exists(select 1 from pg_constraint k where k.conrelid=to_regclass('public.{table}') and (k.conname='{table}_status_check' or k.contype='c' and k.conkey @> array[(select attnum from pg_attribute where attrelid=k.conrelid and attname='status')]::smallint[]) and (k.contype<>'c' or not k.convalidated or pg_get_constraintdef(k.oid) not in ({','.join(q(d) for d in defs)})))",table+'.status'))
    confidence='CHECK (((parser_confidence IS NULL) OR ((parser_confidence >= 0) AND (parser_confidence <= 100))))'
    chunks.append(gate('check_shape',f"exists(select 1 from pg_constraint k where k.conrelid=to_regclass('public.{ROW}') and (k.conname='{ROW}_parser_confidence_check' or k.contype='c' and k.conkey @> array[(select attnum from pg_attribute where attrelid=k.conrelid and attname='parser_confidence')]::smallint[]) and (k.contype<>'c' or not k.convalidated or pg_get_constraintdef(k.oid)<>{q(confidence)}))",ROW+'.parser_confidence'))
    chunks.append(count_gate('confidence_values',f'select count(*) from public.{ROW} where parser_confidence<0 or parser_confidence>100',ROW,guard=has(ROW,{'parser_confidence':'integer'})))
    for col in ('rows_total','rows_created','rows_failed'):
        chunks.append(gate('check_shape',f"exists(select 1 from pg_constraint k where k.conrelid=to_regclass('public.{BATCH}') and k.conname='{BATCH}_{col}_check' and (k.contype<>'c' or not k.convalidated or pg_get_constraintdef(k.oid)<>{q('CHECK (('+col+' >= 0))')}))",BATCH+'.'+col))
        chunks.append(gate('source_check_missing',f"matching && array['I','ID']::text[] and not exists(select 1 from pg_constraint k where k.conrelid=to_regclass('public.{BATCH}') and k.conname='{BATCH}_{col}_check')",BATCH+'.'+col,level='final_gate'))
    for table in (BATCH,ROW,VERSION):
        known=[table+'_status_check',table+'_parser_confidence_check']+[table+'_'+c+'_check' for c in ('rows_total','rows_created','rows_failed')]
        chunks.append(gate('unknown_constraint',f"exists(select 1 from pg_constraint k where k.conrelid=to_regclass('public.{table}') and k.contype not in ('p','f') and k.conname not in ({','.join(q(n) for n in known)}))",table))
    return '\n'.join(chunks)


def seed_sql():
    chunks=[]
    for table in ('roles','permissions'):
        fields={'id':'uuid','key':'text','name':'text','description':'text'}
        # F supplies is_system only in its conditional roles INSERT branch;
        # the permissions INSERT always names exactly key/name/description.
        inserted=('key','name','description','is_system') if table=='roles' else ('key','name','description')
        guard=has(table,fields)
        chunks.append(gate('seed_columns','not '+guard,table))
        chunks.append(gate('seed_arbiter','not '+arbiter(table,['key']),table+'.key'))
        chunks.append(gate('seed_defaults',f"not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.{table}') and a.attname='id' and pg_get_expr(d.adbin,d.adrelid)='gen_random_uuid()') or exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.{table}') and a.attnum>0 and not a.attisdropped and a.attnotnull and not a.atthasdef and a.attname not in ({','.join(q(c) for c in inserted)}))",table))
        chunks.append(count_gate('seed_keys',f'select count(*) from (select key from public.{table} group by key having key is null or count(*)>1) x',table,guard=guard))
        # ON CONFLICT(key) does not resolve unrelated uniqueness or FK failures
        # during F's name/description UPSERT. Only UUID identity and the exact
        # immediate key arbiter are reviewed; preserve and reject other objects.
        parent_id=f"array[(select attnum from pg_attribute where attrelid=to_regclass('public.{table}') and attname='id')]::smallint[]"
        parent_key=f"array[(select attnum from pg_attribute where attrelid=to_regclass('public.{table}') and attname='key')]::smallint[]"
        chunks.append(gate('seed_unknown_constraint',f"exists(select 1 from pg_constraint k where k.conrelid=to_regclass('public.{table}') and (k.contype not in ('p','u') or k.contype='u' and (k.condeferrable or k.conkey<>{parent_key}))) or exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam where i.indrelid=to_regclass('public.{table}') and i.indisunique and not (i.indimmediate and i.indisvalid and i.indisready and i.indislive and i.indpred is null and i.indexprs is null and i.indnkeyatts=i.indnatts and a.amname='btree' and (select array_agg(k order by ord) from unnest(i.indkey) with ordinality u(k,ord)) in ({parent_id},{parent_key})))",table))
    chunks.append(gate('seed_columns',"exists(select 1 from pg_attribute where attrelid=to_regclass('public.roles') and attname='is_system' and not attisdropped) and not "+has('roles',{'is_system':'boolean'}),'roles.is_system'))
    pair=has('role_permissions',{'role_id':'uuid','permission_id':'uuid'})
    chunks.append(gate('seed_pair','not '+pair+" or (select count(*) from pg_attribute where attrelid=to_regclass('public.role_permissions') and attname in ('role_id','permission_id') and attnotnull)<>2 or not "+arbiter('role_permissions',['role_id','permission_id']),'mandatory immediate unique role/permission pair'))
    # F's untargeted ON CONFLICT DO NOTHING consults every unique arbiter.
    # An extra UNIQUE(role_id), for example, can silently suppress intended pairs.
    # Admit only the existing UUID identity and the exact immediate pair; retain
    # all other objects unchanged and reject their unreviewed insertion effects.
    grant_pair="array[(select attnum from pg_attribute where attrelid=to_regclass('public.role_permissions') and attname='role_id'),(select attnum from pg_attribute where attrelid=to_regclass('public.role_permissions') and attname='permission_id')]::smallint[]"
    grant_id="array[(select attnum from pg_attribute where attrelid=to_regclass('public.role_permissions') and attname='id')]::smallint[]"
    grant_fk=" or ".join(f"(k.conkey=array[(select attnum from pg_attribute where attrelid=k.conrelid and attname='{col}')]::smallint[] and k.confrelid=to_regclass('public.{parent}') and k.confkey=array[(select attnum from pg_attribute where attrelid=k.confrelid and attname='id')]::smallint[])" for col,parent in [('role_id','roles'),('permission_id','permissions')])
    chunks.append(gate('seed_unknown_constraint',f"exists(select 1 from pg_constraint k where k.conrelid=to_regclass('public.role_permissions') and not (k.contype='p' or k.contype='u' and not k.condeferrable and k.conkey={grant_pair} or k.contype='f' and k.convalidated and not k.condeferrable and ({grant_fk}))) or exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam where i.indrelid=to_regclass('public.role_permissions') and i.indisunique and not (i.indimmediate and i.indisvalid and i.indisready and i.indislive and i.indpred is null and i.indexprs is null and i.indnkeyatts=i.indnatts and a.amname='btree' and (select array_agg(k order by ord) from unnest(i.indkey) with ordinality u(k,ord)) in ({grant_id},{grant_pair})))",'role_permissions'))
    chunks.append(count_gate('seed_pair','select count(*) from public.role_permissions rp left join public.roles r on r.id=rp.role_id left join public.permissions p on p.id=rp.permission_id where r.id is null or p.id is null','null/orphan pair',guard=pair+' and '+has('roles',{'id':'uuid'})+' and '+has('permissions',{'id':'uuid'})))
    chunks.append(count_gate('seed_pair','select count(*) from (select role_id,permission_id from public.role_permissions group by role_id,permission_id having count(*)>1) x','duplicate pair',guard=pair))
    chunks.append(gate('seed_defaults',"exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.role_permissions') and a.attnum>0 and not a.attisdropped and a.attnotnull and not a.atthasdef and a.attname not in ('role_id','permission_id'))",'role_permissions'))
    for col,parent in [('role_id','roles'),('permission_id','permissions')]:
        chunks.append(gate('seed_reference',f"not exists(select 1 from pg_constraint k where k.conrelid=to_regclass('public.role_permissions') and k.contype='f' and k.confrelid=to_regclass('public.{parent}') and k.conkey=array[(select attnum from pg_attribute where attrelid=k.conrelid and attname='{col}')]::smallint[] and k.confkey=array[(select attnum from pg_attribute where attrelid=k.confrelid and attname='id')]::smallint[] and k.convalidated and not k.condeferrable)",'role_permissions.'+col))
    chunks.append(count_gate('seed_metadata_updates',f"select count(*) from public.roles where key='company_admin' and (name is distinct from {q(ROLE_NAME)} or description is distinct from {q(ROLE_DESCRIPTION)})",'company_admin name/description',guard=has('roles',{'key':'text','name':'text','description':'text'}),level='final_gate',include_zero=True))
    chunks.append(count_gate('seed_metadata_updates',"select count(*) from public.roles where key='company_admin' and is_system is distinct from true",'company_admin is_system',guard=has('roles',{'key':'text','is_system':'boolean'}),level='final_gate',include_zero=True))
    for key,(name,description) in PERMISSIONS.items():
        chunks.append(count_gate('seed_metadata_updates',f"select count(*) from public.permissions where key={q(key)} and (name is distinct from {q(name)} or description is distinct from {q(description)})",key,guard=has('permissions',{'key':'text','name':'text','description':'text'}),level='final_gate',include_zero=True))
    chunks.append(count_gate('seed_missing_pairs',"select count(*) from (values ('company_admin'),('super_admin')) role_keys(key) cross join (values ('tenants.read'),('tenants.write'),('tenants.invite')) permission_keys(key) where (role_keys.key='company_admin' or exists(select 1 from public.roles where key='super_admin')) and not exists(select 1 from public.role_permissions rp join public.roles r on r.id=rp.role_id join public.permissions p on p.id=rp.permission_id where r.key=role_keys.key and p.key=permission_keys.key)",'F299-377 prospective pairs, no insertion',guard=pair+' and '+has('roles',{'id':'uuid','key':'text'})+' and '+has('permissions',{'id':'uuid','key':'text'}),level='final_gate',include_zero=True))
    chunks.append(count_gate('seed_reduced_missing_super_admin',"select count(*) from (select 1 where not exists(select 1 from public.roles where key='super_admin')) x",'F299-377 does not create super_admin',guard=has('roles',{'key':'text'}),level='final_gate'))
    effects={'unit':'F299-377','company_admin':{'name':ROLE_NAME,'description':ROLE_DESCRIPTION,'is_system':'true if column exists'},'permissions':PERMISSIONS,'role_pairs':[[r,p] for r in ('company_admin','super_admin') for p in PERMISSIONS], 'apply':False}
    chunks.append(receipt('proposed_seed_effects',level='final_gate',detail=json.dumps(effects,ensure_ascii=False)))
    return '\n'.join(chunks)


def prerequisite_sql():
    chunks=[]
    required={'companies':{'id':'uuid','status':'text'},'company_memberships':{'id':'uuid','company_id':'uuid','user_id':'uuid','status':'text'},'company_invitations':{'id':'uuid','company_id':'uuid','status':'text','email':'text','token':'uuid'},'customers':{'id':'uuid','company_id':'uuid','status':'text','email':'text','org_number':'text','personal_number':'text','customer_number':'text','full_name':'text','company_name':'text','phone':'text'},
      'contract_offers':{'id':'uuid','company_id':'uuid','status':'text','is_active':'boolean'},
      'customer_contracts':{'id':'uuid','company_id':'uuid','customer_id':'uuid','contract_offer_id':'uuid','created_at':'timestamptz','status':'text'},
      'customer_sites':{'id':'uuid','company_id':'uuid','customer_id':'uuid','facility_id':'text'},
      'metering_points':{'id':'uuid','company_id':'uuid','site_id':'uuid','meter_point_id':'text'}}
    for table,fields in required.items():
        chunks.append(gate('ddl_columns',exists(table)+' and not '+has(table,fields),table))
    version=columns('F',VERSION)
    for col,(typ,required,default) in version.items():
        chunks.append(gate('version_shape','not '+has(VERSION,{col:typ}),VERSION+'.'+col))
        chunks.append(gate('version_shape',f"not exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.{VERSION}') and a.attname='{col}' and a.attnotnull={str(required).lower()} and pg_get_expr(d.adbin,d.adrelid) is not distinct from {q(default) if default else 'null'})",VERSION+'.'+col))
    # I7-51 validates company FKs even where F's ADD-column branch is skipped.
    loop=['customers','customer_contacts','customer_addresses','customer_sites','metering_points','customer_contracts','customer_contract_events','contract_offers','powers_of_attorney','customer_authorization_documents','supplier_switch_requests','supplier_switch_events','grid_owner_data_requests','metering_values','billing_underlays','partner_exports','outbound_requests','audit_logs','access_logs','communication_routes','customer_operation_tasks','customer_documents','power_of_attorneys','meter_readings']
    for table in loop:
        chunks.append(gate('ddl_columns',exists(table)+' and not '+has(table,{'company_id':'uuid'}),table+'.company_id'))
        chunks.append(count_gate('orphan_company',f'select count(*) from public.{table} c left join public.companies p on p.id=c.company_id where c.company_id is not null and p.id is null',table,guard=has(table,{'company_id':'uuid'})+' and '+has('companies',{'id':'uuid'})))
        chunks.append(gate('ownership_reference_shape',f"exists(select 1 from pg_constraint k where k.conrelid=to_regclass('public.{table}') and k.conname='{table}_company_id_fkey' and (k.contype<>'f' or k.confrelid is distinct from to_regclass('public.companies') or k.conkey is distinct from array[(select attnum from pg_attribute where attrelid=k.conrelid and attname='company_id')]::smallint[] or k.confkey is distinct from array[(select attnum from pg_attribute where attrelid=k.confrelid and attname='id')]::smallint[]))",table))
    return '\n'.join(chunks)


def catalog_sql():
    # No expressions/row values leave the DB. Definition fingerprints preserve
    # evidence about extras without exposing embedded literals in custom objects.
    return """
select jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_object('oid',oid,'name',relname,'kind',relkind,'owner',relowner,'rls',relrowsecurity,'forced',relforcerowsecurity) order by oid) from pg_class where relnamespace='public'::regnamespace),
 'columns',(select jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,md5(coalesce(d.adbin::text,''))) order by a.attrelid,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where c.relnamespace='public'::regnamespace and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_array(oid,conname,conrelid,confrelid,contype,conkey,confkey,confdeltype,confupdtype,convalidated,condeferrable,md5(coalesce(conbin::text,''))) order by oid) from pg_constraint where connamespace='public'::regnamespace),
 'indexes',(select jsonb_agg(jsonb_build_array(i.indexrelid,i.indrelid,i.indisvalid,i.indisready,i.indislive,i.indisunique,i.indimmediate,md5(pg_get_indexdef(i.indexrelid))) order by i.indexrelid) from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace),
 'policies',(select jsonb_agg(jsonb_build_array(p.oid,p.polname,p.polrelid,p.polcmd,p.polroles,p.polpermissive,md5(coalesce(p.polqual::text,'')||coalesce(p.polwithcheck::text,''))) order by p.oid) from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace='public'::regnamespace),
 'triggers',(select jsonb_agg(jsonb_build_array(t.oid,t.tgname,t.tgrelid,t.tgfoid,t.tgtype,t.tgenabled,t.tgattr,md5(pg_get_triggerdef(t.oid))) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace),
 'six_d_guard',(select jsonb_agg(jsonb_build_array(t.oid,t.tgname,t.tgrelid,t.tgtype,t.tgenabled,t.tgattr) order by t.oid) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where p.proname='gridex_assert_company_operational_for_write')) into inventory;
"""


def checker_sql():
    body=[identity(t) for t in ('companies','customers','contract_offers','auth.users','roles','permissions','role_permissions',VERSION)]
    body += [identity(t,False) for t in sorted({BATCH,ROW,'company_memberships','company_invitations'} | {t for edges in JOINS.values() for child,_,parent in edges for t in (child,parent)} - {'customers','contract_offers'})]
    body += [shape_sql(),prerequisite_sql(),index_sql(),checks_sql(),foreign_keys(),ownership_sql(),seed_sql(),identity_compatibility_sql(),catalog_sql()]
    for table,cols in [(BATCH,['company_id']),(ROW,['company_id','import_batch_id','row_number']),(VERSION,['company_id'])]:
        body.append(gate('nullable_ownership_shape',f"exists(select 1 from pg_attribute where attrelid=to_regclass('public.{table}') and attname in ({','.join(q(c) for c in cols)}) and not attnotnull and not attisdropped)",table,level='final_gate'))
    observed=sorted({'companies','customers','contract_offers','roles','permissions','role_permissions','user_roles',BATCH,ROW,VERSION} | {t for edges in JOINS.values() for child,_,parent in edges for t in (child,parent)} | {'audit_logs','access_logs','outbound_requests','communication_routes','grid_owner_data_requests','customer_operation_tasks','customer_documents','power_of_attorneys','powers_of_attorney','metering_values','meter_readings','partner_exports','customer_authorization_documents'})
    locks=[]
    for table in ['auth.users']+['public.'+t for t in observed]:
        locks.append(f"""observed_oid:=to_regclass({q(table)});
if exists(select 1 from pg_class where oid=observed_oid and relkind='r') then
 begin
  execute {q('lock table '+table+' in access share mode')};
  if to_regclass({q(table)}) is distinct from observed_oid then
   {receipt('relation_changed',detail=table)}
  end if;
 exception when others then {receipt('inspection_error',detail='lock:'+table)} end;
end if;
""")
    return """-- IMPORT_ADMISSION_CHECKER_BEGIN: bounded observation, not a writer freeze.
begin isolation level repeatable read read only;
set local search_path=pg_catalog,public,extensions;
set local row_security=off;
set local statement_timeout='20s';
set local lock_timeout='2s';
do $admission$
declare items jsonb:='[]'; inventory jsonb; n bigint; variant record; tbl record; col record;
 ok boolean; found_ok boolean; matching text[]; blocked boolean; observed_oid oid;
begin
 if current_setting('transaction_read_only')<>'on' or current_setting('transaction_isolation')<>'repeatable read' then
  raise exception 'Import admission: snapshot contract';
 end if;
"""+'\n'.join(locks+body)+"""
 select exists(select 1 from jsonb_array_elements(items) x where x->>'level'='blocking' and (x->>'count')::bigint>0) into blocked;
 raise notice 'IMPORT_ADMISSION %',jsonb_build_object('preserve_values_eligible',not blocked,'final_ready',false,
  'scope','consistent read-only observation; later writers and source application require revalidation',
  'unresolved',array['retention','version ownership/key contract','effective access','source application transaction boundary','Task8 full I/F/D/6D2 effects'],
  'items',items,'catalog',inventory);
end $admission$;
rollback;
-- IMPORT_ADMISSION_CHECKER_END
"""


def environment():
    return {k:v for k,v in os.environ.items() if not k.startswith('PG')}


def run_sql(sql, target=TARGET):
    with tempfile.NamedTemporaryFile(mode='w',suffix='.sql') as f:
        f.write(sql); f.flush()
        result=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1',target,'-f',f.name],text=True,capture_output=True,env=environment(),timeout=120)
    # Do not echo SQL errors, CONTEXT, DETAIL or row values.
    assert result.returncode==0, 'isolated SQL failed; sanitized return code '+str(result.returncode)
    return result


def reset():
    run_sql(f'drop database if exists {DATABASE} with (force); create database {DATABASE};',ADMIN)


def observe():
    result=run_sql(checker_sql())
    matches=re.findall(r'IMPORT_ADMISSION (\{.*\})',result.stderr)
    assert len(matches)==1,'missing single safe receipt'
    return json.loads(matches[0])


def blockers(result):
    totals={}
    for i in result['items']:
        if i['level']=='blocking' and i['count']>0:
            key=(i['category'],i['detail'])
            totals[key]=totals.get(key,0)+i['count']
    return {(category,detail,count) for (category,detail),count in totals.items()}


def snapshot():
    # Synthetic-only: in-memory comparison of all public rows and full catalogs.
    # Never print this result or include it in an assertion failure.
    tables=run_sql("select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by oid;").stdout.splitlines()
    terms=[f"select {q(t)} as relation,to_jsonb(r) as value from public.\"{t.replace(chr(34),chr(34)*2)}\" r" for t in tables]
    rows=run_sql('select coalesce(jsonb_agg(x order by relation,value::text),\'[]\') from ('+' union all '.join(terms)+') x;').stdout
    catalog=run_sql("select jsonb_build_object('class',(select jsonb_agg(to_jsonb(c) order by oid) from pg_class c where relnamespace='public'::regnamespace),'attribute',(select jsonb_agg(to_jsonb(a) order by attrelid,attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace),'constraint',(select jsonb_agg(to_jsonb(c) order by oid) from pg_constraint c where connamespace='public'::regnamespace),'index',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i),'policy',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p),'trigger',(select jsonb_agg(to_jsonb(t) order by oid) from pg_trigger t),'proc',(select jsonb_agg(to_jsonb(p) order by oid) from pg_proc p where pronamespace='public'::regnamespace),'default',(select jsonb_agg(to_jsonb(d) order by oid) from pg_attrdef d));").stdout
    return rows,catalog


def preserved_observation(expected):
    before=snapshot()
    result=observe()
    assert blockers(result)==expected, 'unexpected blocking category/count: '+str(sorted(blockers(result)))
    assert result['preserve_values_eligible']==(not expected) and result['final_ready'] is False
    assert before==snapshot(),'read-only checker changed synthetic rows or catalog'
    assert result==observe(),'repeat receipt differs without intervening writes'
    assert before==snapshot(),'repeat checker changed synthetic rows or catalog'
    return result


def identity_compatibility_sql():
    """Read-only counts for the four already-reviewed compatibility rules."""
    guard=has('roles',{'id':'uuid','key':'text','name':'text'})+' and '+has('permissions',{'id':'uuid','key':'text'})+' and '+has('role_permissions',{'role_id':'uuid','permission_id':'uuid','role_key':'text','permission_key':'text'})
    base='from public.role_permissions g join public.roles r on r.id=g.role_id join public.permissions p on p.id=g.permission_id '
    chunks=[gate('seed_columns','not '+has('role_permissions',{'role_key':'text','permission_key':'text'}),'role_permissions compatibility')]
    chunks.append(count_gate('seed_identity_mapping',"select count(*) "+base+"where lower(coalesce(r.key,''))='' or lower(coalesce(p.key,''))='' or (select count(*) from public.roles candidate where lower(coalesce(candidate.key,''))=lower(coalesce(r.key,'')))<>1 or (select count(*) from public.permissions candidate where lower(coalesce(candidate.key,''))=lower(coalesce(p.key,'')))<>1",'referenced folded parent key',guard=guard))
    chunks.append(count_gate('seed_identity_mapping',"select count(*) "+base+"where (g.role_key is not null and (lower(coalesce(g.role_key,''))<>lower(coalesce(r.key,'')) or exists(select 1 from public.roles candidate where candidate.id<>r.id and (lower(coalesce(candidate.key,''))=lower(coalesce(g.role_key,'')) or lower(coalesce(candidate.key,candidate.name,''))=lower(coalesce(g.role_key,'')))))) or (g.permission_key is not null and lower(coalesce(g.permission_key,''))<>lower(coalesce(p.key,'')))",'grant compatibility key',guard=guard))
    assignment=guard+' and '+has('user_roles',{'role_id':'uuid','role':'text'})
    chunks.append(gate('seed_columns',exists('user_roles')+' and not '+has('user_roles',{'role_id':'uuid','role':'text'}),'user_roles compatibility'))
    chunks.append(count_gate('seed_identity_mapping',"select count(*) from public.user_roles u left join public.roles r on r.id=u.role_id or lower(coalesce(r.key,''))=lower(coalesce(u.role,'')) join public.role_permissions g on g.role_id=r.id or lower(coalesce(g.role_key,''))=lower(coalesce(u.role,r.key,'')) where r.id is null or g.role_id<>r.id",'legacy assignment grant resolution',guard=assignment))
    chunks.append(count_gate('seed_identity_mapping',"select count(*) from public.user_roles u join public.roles r on r.id=u.role_id or lower(coalesce(r.key,''))=lower(coalesce(u.role,'')) where u.role_id is not null and u.role_id<>r.id",'assignment role resolution',guard=assignment))
    # Actual prefix fallback is coalesce(key,name): F's company_admin name
    # UPDATE leaves its nonnull key identity unchanged. A NULL-key/name-only
    # candidate before F's INSERT is already blocked by seed_keys and the
    # referenced folded-parent rule above; do not invent another alias rule.
    for table,keys in [('roles',['company_admin','super_admin']),('permissions',list(PERMISSIONS))]:
        vals=','.join(q(k) for k in keys)
        chunks.append(count_gate('seed_identity_mapping',f"select count(*) from public.{table} p where lower(coalesce(p.key,'')) in ({vals}) and (p.key<>lower(p.key) or (select count(*) from public.{table} c where lower(coalesce(c.key,''))=lower(p.key))<>1)",'source key folded ambiguity: '+table,guard=has(table,{'key':'text'})))
    return '\n'.join(chunks)


C1,C2=('21000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000002')
U1,U2=('11000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000002')
CU1,CU2=('31000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000002')
O1,O2=('41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002')
B1,B2=('51000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002')
R1,R2=('61000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002')
P1='71000000-0000-0000-0000-000000000001'
V1='81000000-0000-0000-0000-000000000001'


def prefix():
    return module('canonical-governance-selftest').bootstrap()+'\n'.join('-- IMPORT_ADMISSION_PREFIX_FILE_BEGIN '+p+'\n'+read('supabase/'+p) for p in selection())


def main_seed():
    return module('canonical-operations-sync-selftest').seed()+f"""
insert into contract_offers(id,company_id,name) values ('{O1}','{C1}','Synthetic offer one'),('{O2}','{C2}','Synthetic offer two');
insert into contract_offer_versions(id,company_id,contract_offer_id,created_by,snapshot) values
 ('{V1}','{C1}','{O1}','{U1}','{{"preserve":"history"}}'),
 ('81000000-0000-0000-0000-000000000002','{C2}','{O2}','{U2}','{{"preserve":"other history"}}');
"""


def reduced_setup(variant='ID'):
    sql=module('canonical-governance-selftest').bootstrap()+f"""
-- REDUCED SOURCE-DERIVED IMPORT SHAPES ONLY; NOT FULL I/F/D REPLAY.
create table companies(id uuid primary key default gen_random_uuid(),status text);
create table customers(id uuid primary key default gen_random_uuid(),company_id uuid references companies(id),status text,email text,org_number text,personal_number text,customer_number text,full_name text,company_name text,phone text);
create table contract_offers(id uuid primary key default gen_random_uuid(),company_id uuid references companies(id),status text,is_active boolean);
create table roles(id uuid primary key default gen_random_uuid(),key text unique,name text not null,description text,is_system boolean default false);
create table permissions(id uuid primary key default gen_random_uuid(),key text unique,name text not null,description text);
create table role_permissions(id uuid primary key default gen_random_uuid(),role_id uuid not null references roles(id) on delete restrict,permission_id uuid not null references permissions(id) on delete cascade,role_key text,permission_key text,unique(role_id,permission_id));
create table user_roles(id uuid primary key default gen_random_uuid(),role_id uuid,role text);
insert into auth.users(id) values ('{U1}'),('{U2}');
insert into companies(id) values ('{C1}'),('{C2}');
insert into customers(id,company_id) values ('{CU1}','{C1}'),('{CU2}','{C2}');
insert into contract_offers(id,company_id) values ('{O1}','{C1}'),('{O2}','{C2}');
insert into roles(id,key,name) values ('{R1}','company_admin','Preserve role metadata'),('{R2}','super_admin','Preserve super metadata');
insert into permissions(id,key,name) values ('{P1}','tenants.read','Preserve permission metadata');
insert into role_permissions(role_id,permission_id) values ('{R1}','{P1}');
"""+table_sql('F',VERSION)+f"""
create index contract_offer_versions_company_offer_idx on contract_offer_versions(company_id,contract_offer_id,created_at desc);
insert into contract_offer_versions(id,company_id,contract_offer_id,created_by,snapshot) values ('{V1}','{C1}','{O1}','{U1}','{{"sentinel":1}}');
"""
    if variant=='empty':
        return sql
    first=variant[0]
    sql+='\n'+table_sql(first,BATCH)+'\n'+table_sql(first,ROW)+'\n'
    if variant in ('ID','FD','D'):
        # Exact D alignment/check/FK/index units; deliberately no RLS/view effects.
        sql+='\n'.join(source('D').splitlines()[50:169])+'\n'
    sql+=f"insert into {BATCH}(id,company_id,created_by) values ('{B1}','{C1}','{U1}'),('{B2}','{C2}','{U2}');\n"
    sql+=f"insert into {ROW}(company_id,import_batch_id,row_number,customer_id) values ('{C1}','{B1}',1,'{CU1}'),('{C2}','{B2}',1,'{CU2}');\n"
    return sql


# Hand-specified diagnostic sets: the test never derives its expectation from
# checker predicates. Setup mutations are confined to reset disposable fixtures.
CASES={
 'incomplete': (f'drop table {ROW};', {('incomplete_import_shape','',1)}),
 'wrong_default': (f"alter table {BATCH} alter column source_type set default 'custom';", {('import_column_shape','',1)}),
 'wrong_id': (f'alter table {ROW} drop constraint {ROW}_pkey;', {('identity',ROW,1)}),
 'wrong_index': (f'drop index {ROW}_batch_idx; create index {ROW}_batch_idx on {ROW}(company_id);', {('index_shape',ROW+'_batch_idx',1)}),
 'null_number': (f'alter table {ROW} alter column row_number drop not null; update {ROW} set row_number=null where company_id=\'{C1}\';', {('import_column_shape','',1),('mandatory_values',ROW,1)}),
 'null_owner': (f'alter table {ROW} alter column company_id drop not null; update {ROW} set company_id=null where company_id=\'{C1}\';', {('import_column_shape','',1),('mandatory_values',ROW,1)}),
 'cross_customer': (f"update {ROW} set customer_id='{CU2}' where company_id='{C1}';", {('import_owner_mismatch',ROW+'.customer_id',1)}),
 'cross_batch': (f"update {ROW} set import_batch_id='{B2}' where company_id='{C1}';", {('import_owner_mismatch',ROW+'.import_batch_id',1)}),
 'cross_candidate': (f"update {ROW} set possible_existing_customer_id='{CU2}' where company_id='{C1}';", {('import_owner_mismatch',ROW+'.possible_existing_customer_id',1)}),
 'orphan_candidate': (f"update {ROW} set possible_existing_customer_id='91000000-0000-0000-0000-000000000099' where company_id='{C1}';", {('orphan_reference',ROW+'.possible_existing_customer_id',1)}),
 'orphan_offer': (f"update {VERSION} set contract_offer_id='91000000-0000-0000-0000-000000000099';", {('orphan_reference',VERSION+'.contract_offer_id',1)}),
 'version_conflict': (f"update {VERSION} set company_id='{C2}';", {('import_owner_mismatch',VERSION+'.contract_offer_id',1)}),
 'status_value': (f"alter table {ROW} drop constraint {ROW}_status_check; update {ROW} set status='unsupported' where company_id='{C1}';", {('status_values',ROW,1)}),
 'confidence_value': (f'alter table {ROW} drop constraint {ROW}_parser_confidence_check; update {ROW} set parser_confidence=101 where company_id=\'{C1}\';', {('confidence_values',ROW,1)}),
 'wrong_check': (f"alter table {ROW} drop constraint {ROW}_status_check; alter table {ROW} add constraint {ROW}_status_check check(status<>'x');", {('check_shape',ROW+'.status',1)}),
 'seed_arbiter': ('alter table permissions drop constraint permissions_key_key;', {('seed_arbiter','permissions.key',1)}),
 'seed_default': ('alter table permissions alter column id drop default;', {('seed_defaults','permissions',1)}),
 'seed_mapping': ("update role_permissions set role_key='super_admin';", {('seed_identity_mapping','grant compatibility key',1)}),
 'seed_folded': ("insert into permissions(key,name) values ('TENANTS.READ','Synthetic ambiguity');", {('seed_identity_mapping','referenced folded parent key',1),('seed_identity_mapping','source key folded ambiguity: permissions',2)}),
 'version_type': (f'alter table {VERSION} alter column snapshot drop default; alter table {VERSION} alter column snapshot type text using snapshot::text;', {('version_shape',VERSION+'.snapshot',2)}),
}


def dirty_cases():
    cases=dict(CASES)
    cases.update({
      'relation': ("create view customer_contacts as select null::uuid id,null::uuid company_id,null::uuid customer_id where false;",{('relation','customer_contacts',1),('identity','customer_contacts',1)}),
      'join_columns': ('create table customer_contacts(id uuid primary key,company_id uuid);',{('join_columns','I54-136:customer_contacts.customer_id',1),('join_columns','F121-203:customer_contacts.customer_id',1)}),
      'ddl_columns': ('create table metering_points(id uuid primary key,company_id uuid,site_id uuid);',{('ddl_columns','metering_points',1),('join_columns','I54-136:metering_points.site_id',1),('join_columns','F121-203:metering_points.site_id',1)}),
      'orphan_company': (f"alter table customers drop constraint customers_company_id_fkey; update customers set company_id='91000000-0000-0000-0000-000000000099' where id='{CU1}';",{('orphan_company','customers',1),('import_owner_mismatch',ROW+'.customer_id',1)}),
      'orphan_join': ("create table customer_contacts(id uuid primary key,company_id uuid,customer_id uuid); insert into customer_contacts values ('91000000-0000-0000-0000-000000000001',null,'91000000-0000-0000-0000-000000000099');",{('orphan_ownership_parent','I54-136:customer_contacts.customer_id',1),('orphan_ownership_parent','F121-203:customer_contacts.customer_id',1)}),
      'conflicting_join': (f"create table customer_contacts(id uuid primary key,company_id uuid,customer_id uuid); insert into customer_contacts values ('91000000-0000-0000-0000-000000000001','{C2}','{CU1}');",{('conflicting_ownership','I54-136:customer_contacts.customer_id',1),('conflicting_ownership','F121-203:customer_contacts.customer_id',1)}),
      'parent_owner': (f"update customers set company_id=null where id='{CU1}';",{('parent_owner_incomplete',ROW+'.customer_id',1)}),
      'foreign_collision': (f'create table unrelated(id uuid primary key,company_id uuid,constraint {ROW}_possible_existing_customer_id_fkey foreign key(company_id) references companies(id));',{('foreign_constraint_collision',ROW+'_possible_existing_customer_id_fkey',1)}),
      'unknown_constraint': (f'alter table {ROW} add constraint extra_history_check check(row_number>=0);',{('unknown_constraint',ROW,1)}),
      'seed_pair': ('alter table role_permissions drop constraint role_permissions_role_id_permission_id_key;',{('seed_pair','mandatory immediate unique role/permission pair',1)}),
      'seed_reference': ('alter table role_permissions drop constraint role_permissions_permission_id_fkey;',{('seed_reference','role_permissions.permission_id',1)}),
      'seed_unknown_constraint': ("alter table roles add constraint custom_role_name check(name<>'unknown');",{('seed_unknown_constraint','roles',1)}),
      'seed_roles_unique_metadata_index': ('create unique index seed_roles_name_key on roles(name);',{('seed_unknown_constraint','roles',1)}),
      'seed_permissions_unique_metadata_index': ('create unique index seed_permissions_name_key on permissions(name);',{('seed_unknown_constraint','permissions',1)}),
      'seed_roles_metadata_fk': ('create table seed_metadata_names(name text primary key); insert into seed_metadata_names select distinct name from roles; alter table roles add constraint seed_roles_name_fkey foreign key(name) references seed_metadata_names(name);',{('seed_unknown_constraint','roles',1)}),
      'seed_permissions_metadata_fk': ("create table seed_metadata_descriptions(description text primary key); insert into seed_metadata_descriptions values ('Preserve permission description'); update permissions set description='Preserve permission description'; alter table permissions add constraint seed_permissions_description_fkey foreign key(description) references seed_metadata_descriptions(description);",{('seed_unknown_constraint','permissions',1)}),
      'seed_grant_unique_constraint': ('alter table role_permissions add constraint one_grant_per_role unique(role_id);',{('seed_unknown_constraint','role_permissions',1)}),
      'seed_grant_unique_index': ('create unique index one_grant_per_permission on role_permissions(permission_id);',{('seed_unknown_constraint','role_permissions',1)}),
      'seed_grant_check_constraint': ('alter table role_permissions add constraint extra_grant_check check(role_id is not null);',{('seed_unknown_constraint','role_permissions',1)}),
      'seed_permission_unsupplied_required': ('alter table permissions add column is_system boolean; update permissions set is_system=false; alter table permissions alter column is_system set not null;',{('seed_defaults','permissions',1)}),
      'seed_name_candidate': (f"update roles set key=null,name='company_admin' where id='{R1}'; insert into user_roles(role) values ('company_admin');",{('seed_keys','roles',1),('seed_identity_mapping','referenced folded parent key',1)}),
      'ownership_reference': ('create table customer_contacts(id uuid primary key,company_id uuid,customer_id uuid,constraint customer_contacts_company_id_fkey check(company_id is not null));',{('ownership_reference_shape','customer_contacts',1)}),
      'seed_keys': ("insert into permissions(key,name) values(null,'Synthetic unknown key');",{('seed_keys','permissions',1)}),
      'seed_columns': ('alter table roles add column is_system_old boolean; alter table roles drop column is_system; alter table roles add column is_system text;', {('seed_columns','roles.is_system',1)}),
      'legacy_batch': (f'alter table {ROW} add column batch_id uuid;', {('legacy_batch_id_requires_mapping','',1)}),
      'orphan_batch': (f"alter table {ROW} drop constraint {ROW}_import_batch_id_fkey; update {ROW} set import_batch_id='91000000-0000-0000-0000-000000000099' where company_id='{C1}';",{('orphan_reference',ROW+'.import_batch_id',1)}),
      'orphan_actor': (f"alter table {BATCH} drop constraint {BATCH}_created_by_fkey; update {BATCH} set created_by='91000000-0000-0000-0000-000000000099' where company_id='{C1}';",{('orphan_reference',BATCH+'.created_by',1)}),
      'null_version_snapshot': (f'alter table {VERSION} alter column snapshot drop not null; update {VERSION} set snapshot=null;',{('version_shape',VERSION+'.snapshot',1),('mandatory_values',VERSION,1)}),
    })
    # Both source units, all ten distinct joins. I-only/F-only edges are explicit.
    edges=sorted(set(e for group in JOINS.values() for e in group))
    for child,fk,parent in edges:
        setup=''
        if parent!='customers':
            setup+=f'create table {parent}(id uuid primary key,company_id uuid); insert into {parent} values (\'{CU1}\',\'{C1}\');\n'
        setup+=f'create table {child}(id uuid primary key,company_id uuid,{fk} uuid); insert into {child} values (\'91000000-0000-0000-0000-000000000001\',null,\'{CU1}\');\n'
        # Additional DDL columns required by the named guarded tables.
        extras={'customer_sites':{'facility_id':'text','customer_id':'uuid'},'metering_points':{'meter_point_id':'text','site_id':'uuid'},'customer_contracts':{'customer_id':'uuid','contract_offer_id':'uuid','created_at':'timestamptz','status':'text'}}
        for table in (parent,child):
            if table in extras:
                for col,typ in extras[table].items():
                    setup+=f'alter table {table} add column if not exists {col} {typ};\n'
        expected={( 'would_change_ownership',unit+':'+child+'.'+fk,1) for unit,group in JOINS.items() if (child,fk,parent) in group}
        cases['would_change_'+child]=(setup,expected)
    return cases


def final_gate_cases():
    return {
      'nullable_history': (f'update {VERSION} set company_id=null,version_number=0;', {'version_owner_incomplete','stronger_version_contract'}),
      'duplicate_numbers': (f"insert into {ROW}(company_id,import_batch_id,row_number) values ('{C1}','{B1}',1);", {'stronger_row_number_contract'}),
      'missing_super_admin': ("delete from roles where key='super_admin';", {'seed_reduced_missing_super_admin'}),
      'retained_extra_policy': (f"create policy extra_synthetic_policy on {ROW} for select using(true);", {'missing_reference_enforcement'}),
    }


def read_only_enforcement():
    before=snapshot()
    result=run_sql("""begin read only;
do $$ declare caught boolean:=false; begin
 begin insert into public.companies(id) values ('91000000-0000-0000-0000-000000000099');
 exception when read_only_sql_transaction then caught:=true; end;
 if not caught then raise exception 'read-only enforcement failed'; end if;
end $$; rollback;
""")
    assert before==snapshot(),'read-only enforcement changed rows/catalog'


def coherent_snapshot():
    reset(); run_sql(reduced_setup())
    command=['psql','-X','-qAt','-v','ON_ERROR_STOP=1',TARGET,'-f','-']
    # Establish the observation snapshot, then commit a competing synthetic
    # writer. No advisory lock or ongoing write freeze is asserted.
    with tempfile.TemporaryFile(mode='w+') as errors:
        observer=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=errors,text=True,env=environment())
        try:
            observer.stdin.write("begin isolation level repeatable read read only; set local idle_in_transaction_session_timeout='15s'; select count(*)>=0 from public.customers;\n\\echo SNAPSHOT_READY\n")
            observer.stdin.flush()
            assert observer.stdout.readline().strip()=='t','snapshot read failed'
            assert observer.stdout.readline().strip()=='SNAPSHOT_READY','snapshot readiness failed'
            run_sql(f"update {ROW} set customer_id='{CU2}' where company_id='{C1}';")
            body=checker_sql().split('begin isolation level repeatable read read only;',1)[1]
            observer.communicate(body,timeout=30)
            assert observer.returncode==0,'snapshot observer failed'
            errors.seek(0)
            matches=re.findall(r'IMPORT_ADMISSION (\{.*\})',errors.read())
            assert len(matches)==1 and not blockers(json.loads(matches[0])),'snapshot included a later committed writer'
        finally:
            if observer.poll() is None:
                observer.kill(); observer.wait(timeout=5)
    result=observe()
    assert blockers(result)=={('import_owner_mismatch',ROW+'.customer_id',1)},'new observation missed committed writer'
    print('PASS: coherent snapshot excludes later writer; next observation sees it; no ongoing freeze')


def execute():
    selection()
    reset(); run_sql(prefix()+main_seed())
    preserved_observation(set())
    print('PASS: actual first33 selected files; empty import reconstruction, early versions, two-tenant rows/catalog/repeat preserved')
    for variant in ('empty','I','F','D','ID','FD'):
        reset(); run_sql(reduced_setup(variant)); preserved_observation(set())
        print('PASS: REDUCED '+variant+' source-derived shape; not full I/F/D effects')
    for name,(setup,expected) in dirty_cases().items():
        reset(); run_sql(reduced_setup()+setup); preserved_observation(expected)
        print('PASS: REDUCED '+name+' exact categories/counts and row/catalog preservation')
    for name,(setup,expected) in final_gate_cases().items():
        reset(); run_sql(reduced_setup()+setup); result=preserved_observation(set())
        assert expected <= {i['category'] for i in result['items'] if i['level']=='final_gate'},'missing explicit final gate'
        print('PASS: REDUCED '+name+' compatible preservation; final contract remains unresolved')
    read_only_enforcement()
    coherent_snapshot()
    print('OPEN: hosted source selection/application boundary, retention, ownership enforcement, seed effects, full I/F/D/6D2 execution and final runtime acceptance')


def emit():
    print('-- SQL NOT EXECUTED. Reset sections separately; no source selection/application claim.')
    print(prefix()+main_seed()+checker_sql())
    for variant in ('empty','I','F','D','ID','FD'):
        print('-- RESET DISPOSABLE DATABASE: REDUCED '+variant+'; NOT FULL I/F/D REPLAY\n'+reduced_setup(variant)+checker_sql())
    for name,(setup,expected) in dirty_cases().items():
        print('-- RESET DISPOSABLE DATABASE: REDUCED '+name+' EXPECT '+json.dumps(sorted(expected))+'\n'+reduced_setup()+setup+checker_sql())
    for name,(setup,expected) in final_gate_cases().items():
        print('-- RESET DISPOSABLE DATABASE: REDUCED '+name+' FINAL_GATES '+json.dumps(sorted(expected))+'\n'+reduced_setup()+setup+checker_sql())
    print('-- Python separately verifies SQLSTATE25006 read-only enforcement and real two-connection coherent snapshot/next-observation behavior.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    modes=parser.add_mutually_exclusive_group()
    modes.add_argument('--selection-only',action='store_true')
    modes.add_argument('--emit',action='store_true')
    modes.add_argument('--emit-checker',action='store_true')
    args=parser.parse_args()
    if args.selection_only:
        selection(); print('PASS: import sources unselected; first33/foundation78/RBAC34/accounting unchanged; SQL NOT EXECUTED')
    elif args.emit:
        emit()
    elif args.emit_checker:
        print(checker_sql())
    else:
        execute()
