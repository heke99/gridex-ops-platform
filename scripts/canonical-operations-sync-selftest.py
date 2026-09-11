#!/usr/bin/env python3
"""Bounded operations-sync source verification; final journal access remains OPEN."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'migrations/20260519_operations_core_saas_sync.sql'
SHA = 'e5863b15ec8c25794912b50c36eda6a370f3fb288800339a0bcfb16f2a3bb619'
FULL6D = 'migrations/20260519_batch_6d_superadmin_tenant_governance.sql'
BOUNDARY = 'bootstrap/20260527_company_memberships_role_key_foundation.sql'
WHOLE = [
    'migrations/20260519_customer_intake_contracts_tenant_hardening.sql',
    'migrations/20260519_final_saas_hardening.sql',
    'migrations/20260526_debug_step1_2f_customer_import_foundation.sql',
    'migrations/20260519_batch_6d2_runtime_governance_completion.sql',
]
DATABASE = 'gridex_operations_sync_fixture'
CLEAN_DATABASE = 'gridex_operations_sync_clean'
ADMIN = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'
TARGET = f'postgresql://postgres:postgres@127.0.0.1:55440/{DATABASE}'
CLEAN_TARGET = f'postgresql://postgres:postgres@127.0.0.1:55440/{CLEAN_DATABASE}'
TARGETS = (
    'customers', 'customer_contacts', 'customer_addresses', 'customer_sites',
    'metering_points', 'customer_contracts', 'customer_contract_events',
    'contract_offers', 'powers_of_attorney', 'customer_authorization_documents',
    'customer_operation_tasks', 'supplier_switch_requests',
    'supplier_switch_events', 'grid_owner_data_requests', 'metering_values',
    'billing_underlays', 'partner_exports', 'outbound_requests', 'audit_logs',
)
SEARCH_INDEXES = {
    'customers_company_customer_number_idx': ('customers', '(company_id, customer_number)'),
    'customers_company_personal_number_idx': ('customers', '(company_id, personal_number)'),
    'customers_company_org_number_idx': ('customers', '(company_id, org_number)'),
    'customer_sites_company_customer_facility_idx': ('customer_sites', '(company_id, customer_id, facility_id)'),
    'metering_points_company_meter_point_idx': ('metering_points', '(company_id, meter_point_id)'),
    'metering_points_company_ediel_reference_idx': ('metering_points', '(company_id, ediel_reference)'),
}
JOURNAL_INDEXES = {
    'customer_sync_events_company_status_idx': '(company_id, match_status, created_at DESC)',
    'customer_sync_events_customer_idx': '(customer_id, created_at DESC)',
    'customer_sync_events_source_idx': '(source_type, source_id, source_reference)',
}
C1 = '21000000-0000-0000-0000-000000000001'
C2 = '21000000-0000-0000-0000-000000000002'
U1 = '11000000-0000-0000-0000-000000000001'
U2 = '11000000-0000-0000-0000-000000000002'
CUSTOMER1 = '31000000-0000-0000-0000-000000000001'
CUSTOMER2 = '31000000-0000-0000-0000-000000000002'
SITE1 = '41000000-0000-0000-0000-000000000001'
SITE2 = '41000000-0000-0000-0000-000000000002'
METER1 = '51000000-0000-0000-0000-000000000001'
METER2 = '51000000-0000-0000-0000-000000000002'


def read(path):
    return (ROOT / path).read_text()


def governance():
    path = ROOT / 'scripts/canonical-governance-selftest.py'
    spec = importlib.util.spec_from_file_location('canonical_governance_fixture', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def selection():
    order = json.loads(read('scripts/gridex-aud-003-foundation-order.json'))['foundation']
    additions = json.loads(read('scripts/gridex-aud-003-legacy-foundation.additions.json'))
    assert order[30:38] == [FULL6D, SOURCE, 'migrations/20260909123000_canonical_invitation_token_prerequisite.sql', *WHOLE, BOUNDARY], order[29:38]
    assert len(order) == 104 and order.count(SOURCE) == additions['foundation'].count(SOURCE) == 1
    assert order[:30][-1] == 'migrations/20260519_saas_ui_tenant_admin.sql'
    assert all(order.count(path) == additions['foundation'].count(path) == 1 for path in WHOLE)
    manifest = json.loads(read('scripts/migration-history-manifest.json'))
    assert manifest['files'][Path(SOURCE).name] == SHA
    assert hashlib.sha256((ROOT / 'supabase' / SOURCE).read_bytes()).hexdigest() == SHA
    account_run = subprocess.run(['python3', 'scripts/gridex-replay-input-accounting.py'], cwd=ROOT, text=True, capture_output=True)
    account = json.loads(account_run.stdout)
    assert account_run.returncode == 1 and not account['errors']
    assert account['totalMigrations'] == 600
    assert account['counts'] == {'FULL_FILE_SELECTED': 546, 'SUBSTITUTED': 23, 'UNCLASSIFIED': 27, 'EXPLICITLY_EXCLUDED': 4}
    by_path = {item['path']: item for item in account['migrations']}
    assert by_path[SOURCE]['classification'] == 'FULL_FILE_SELECTED'
    group_run = subprocess.run(['python3', 'scripts/gridex-replay-review-groups.py', '--group', 'auth_membership_tenant'], cwd=ROOT, text=True, capture_output=True)
    group = json.loads(group_run.stdout)
    assert group_run.returncode == 1 and not group['errors'] and len(group['inputs']) == 346
    counts = {key: sum(item['classification'] == key for item in group['inputs']) for key in account['counts']}
    assert counts == {'FULL_FILE_SELECTED': 303, 'SUBSTITUTED': 20, 'UNCLASSIFIED': 19, 'EXPLICITLY_EXCLUDED': 4}
    assert SOURCE not in {item['path'] for item in group['inputs']}
    return order[:31]


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def check(condition, label):
    return f'select test_assert({condition},{quote(label)});\n'


def source():
    return f'-- OPERATIONS_SOURCE_BEGIN {SOURCE}\n' + read('supabase/' + SOURCE)


def prefix():
    gov = governance()
    chunks = [gov.bootstrap()]
    chunks.extend(f'-- OPERATIONS_PREFIX_FILE_BEGIN {path}\n{read("supabase/" + path)}' for path in selection())
    return '\n'.join(chunks)


def seed():
    gov = governance()
    return gov.seed() + f"""
-- Stable representative customer/site/meter references in both synthetic companies.
insert into customers(id,company_id,customer_number,personal_number,org_number,full_name,email,metadata) values
 ('{CUSTOMER1}','{C1}','CUST-ONE','191001019999',null,'Operations Customer One','one@example.invalid','{{"sentinel":"customer-one"}}'),
 ('{CUSTOMER2}','{C2}','CUST-TWO',null,'5560000000','Operations Customer Two','two@example.invalid','{{"sentinel":"customer-two"}}');
insert into customer_sites(id,company_id,customer_id,site_name,facility_id,metadata) values
 ('{SITE1}','{C1}','{CUSTOMER1}','Operations Site One','735999100000000001','{{"sentinel":"site-one"}}'),
 ('{SITE2}','{C2}','{CUSTOMER2}','Operations Site Two','735999200000000002','{{"sentinel":"site-two"}}');
insert into metering_points(id,company_id,customer_id,site_id,meter_point_id,ediel_reference,metadata) values
 ('{METER1}','{C1}','{CUSTOMER1}','{SITE1}','MP-ONE','EDI-ONE','{{"sentinel":"meter-one"}}'),
 ('{METER2}','{C2}','{CUSTOMER2}','{SITE2}','MP-TWO','EDI-TWO','{{"sentinel":"meter-two"}}');
"""


def snapshot(name, include_journal=False):
    tables = TARGETS + (('customer_sync_events',) if include_journal else ())
    chunks = [f'create table ops_{name}_rows(relation text,id text,value jsonb);']
    for table in tables:
        chunks.append(f"insert into ops_{name}_rows select '{table}',id::text,to_jsonb(t) from {table} t;")
    chunks.append(f"create table ops_{name}_fks as select oid,conrelid,confrelid,conkey,confkey,confdeltype,confupdtype,convalidated,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace and contype='f';")
    chunks.append(f"create table ops_{name}_constraints as select oid,conrelid,conname,contype,conkey,confkey,convalidated,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace;")
    chunks.append(f"create table ops_{name}_indexes as select c.oid,c.relname,pg_get_indexdef(c.oid) definition from pg_class c join pg_index i on i.indexrelid=c.oid where c.relnamespace='public'::regnamespace;")
    chunks.append(f"create table ops_{name}_relations as select oid,relname,relkind from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p');")
    chunks.append(f"create table ops_{name}_company_columns as select c.relname,a.attnum,a.atttypid,a.atttypmod,a.attnotnull,a.atthasdef,pg_get_expr(d.adbin,d.adrelid) default_expression from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attname='company_id' left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where c.relnamespace='public'::regnamespace and c.relname=any(array[{','.join(quote(t) for t in TARGETS)}]);")
    return '\n'.join(chunks)


def preserved(name, include_journal=False, exact=True):
    tables = TARGETS + (('customer_sync_events',) if include_journal else ())
    chunks = []
    for table in tables:
        comparison = 'to_jsonb(t)=b.value' if exact else 'to_jsonb(t) @> b.value'
        chunks.append(check(f"not exists(select 1 from ops_{name}_rows b where relation='{table}' and not exists(select 1 from {table} t where t.id::text=b.id and {comparison})) and (select count(*) from {table})=(select count(*) from ops_{name}_rows where relation='{table}')", f'{name}: {table} row IDs/references/unrelated values retained'))
    chunks.append(check(f"not exists(select * from ops_{name}_fks except select oid,conrelid,confrelid,conkey,confkey,confdeltype,confupdtype,convalidated,pg_get_constraintdef(oid) from pg_constraint)", f'{name}: all prior FK OIDs/actions/definitions retained'))
    chunks.append(check(f"not exists(select * from ops_{name}_constraints except select oid,conrelid,conname,contype,conkey,confkey,convalidated,pg_get_constraintdef(oid) from pg_constraint)", f'{name}: all prior PK/FK/check identities and definitions retained'))
    chunks.append(check(f"not exists(select * from ops_{name}_indexes except select c.oid,c.relname,pg_get_indexdef(c.oid) from pg_class c join pg_index i on i.indexrelid=c.oid)", f'{name}: all prior index OIDs/definitions retained'))
    chunks.append(check(f"not exists(select * from ops_{name}_relations except select oid,relname,relkind from pg_class)", f'{name}: all prior table identities retained'))
    chunks.append(check(f"not exists((select * from ops_{name}_company_columns except select c.relname,a.attnum,a.atttypid,a.atttypmod,a.attnotnull,a.atthasdef,pg_get_expr(d.adbin,d.adrelid) from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attname='company_id' left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where c.relnamespace='public'::regnamespace and c.relname=any(array[{','.join(quote(t) for t in TARGETS)}])) union all (select c.relname,a.attnum,a.atttypid,a.atttypmod,a.attnotnull,a.atthasdef,pg_get_expr(d.adbin,d.adrelid) from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attname='company_id' left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where c.relnamespace='public'::regnamespace and c.relname=any(array[{','.join(quote(t) for t in TARGETS)}]) except select * from ops_{name}_company_columns))", f'{name}: all 19 company column identities/types/nullability/defaults retained'))
    return '\n'.join(chunks)


def index_check(name, table, columns):
    expected = f'CREATE INDEX {name} ON public.{table} USING btree {columns}'
    return check(f"(select pg_get_indexdef(indexrelid)={quote(expected)} and indisvalid and indisready and not indisunique and indpred is null and indexprs is null from pg_index where indexrelid='{name}'::regclass)", f'exact source index {name}; same-name mismatch is failure, not convergence')


def catalogs():
    chunks = [check("(select count(*)=19 and bool_and(a.atttypid='uuid'::regtype) from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attname='company_id' where c.relnamespace='public'::regnamespace and c.relname=any(array[" + ','.join(quote(t) for t in TARGETS) + "]))", 'all19 ownership-loop targets retain actual UUID company columns')]
    for table in TARGETS:
        chunks.append(index_check(table + '_company_id_idx', table, '(company_id)'))
    for name, (table, columns) in SEARCH_INDEXES.items():
        chunks.append(index_check(name, table, columns))
    journal = [
        ('id', 'uuid', True, 'gen_random_uuid()'), ('company_id', 'uuid', False, None),
        ('customer_id', 'uuid', False, None), ('site_id', 'uuid', False, None),
        ('metering_point_id', 'uuid', False, None), ('source_type', 'text', True, None),
        ('source_id', 'uuid', False, None), ('source_reference', 'text', False, None),
        ('match_status', 'text', True, "'pending'::text"),
        ('match_confidence', 'numeric(5,2)', False, None),
        ('matched_by', 'text[]', True, "'{}'::text[]"), ('event_type', 'text', True, None),
        ('title', 'text', True, None), ('description', 'text', False, None),
        ('payload', 'jsonb', True, "'{}'::jsonb"), ('created_at', 'timestamptz', True, 'now()'),
        ('resolved_at', 'timestamptz', False, None), ('resolved_by', 'uuid', False, None),
        ('resolution_note', 'text', False, None),
    ]
    chunks.append(check("(select count(*)=19 from pg_attribute where attrelid='customer_sync_events'::regclass and attnum>0 and not attisdropped)", 'exact19-column sync journal'))
    for pos, (name, typ, required, default) in enumerate(journal, 1):
        default_sql = 'pg_get_expr(d.adbin,d.adrelid) is null' if default is None else 'pg_get_expr(d.adbin,d.adrelid)=' + quote(default)
        chunks.append(check(f"(select a.attnum={pos} and a.atttypid='{typ}'::regtype and a.attnotnull={str(required).lower()} and {default_sql} from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='customer_sync_events'::regclass and a.attname='{name}')", f'exact journal {name} order/type/nullability/default'))
    chunks.append(check("(select atttypmod=327686 from pg_attribute where attrelid='customer_sync_events'::regclass and attname='match_confidence')", 'journal match_confidence exact numeric(5,2) typmod'))
    chunks.append(check("(select count(*)=1 and bool_and(convalidated and not condeferrable and pg_get_constraintdef(oid)='PRIMARY KEY (id)') from pg_constraint where conrelid='customer_sync_events'::regclass and contype='p')", 'journal exact UUID PK'))
    chunks.append(check("(select indisprimary and indisunique and indisvalid and indisready and indpred is null and indexprs is null and pg_get_indexdef(indexrelid)='CREATE UNIQUE INDEX customer_sync_events_pkey ON public.customer_sync_events USING btree (id)' from pg_index where indexrelid='customer_sync_events_pkey'::regclass)", 'journal exact PK backing index'))
    status_def = "CHECK ((match_status = ANY (ARRAY['pending'::text, 'matched'::text, 'unresolved'::text, 'ignored'::text, 'resolved'::text])))"
    chunks.append(check(f"(select count(*)=1 and bool_and(convalidated and not condeferrable and pg_get_constraintdef(oid)={quote(status_def)}) from pg_constraint where conrelid='customer_sync_events'::regclass and conname='customer_sync_events_match_status_check')", 'journal exact match-status check'))
    for name, columns in JOURNAL_INDEXES.items():
        chunks.append(index_check(name, 'customer_sync_events', columns))
    chunks.append(check("not exists(select 1 from pg_constraint where conrelid='customer_sync_events'::regclass and contype='f')", 'journal has no source-created FK/RLS/policy: zero FKs'))
    chunks.append(check("(select not relrowsecurity and not relforcerowsecurity from pg_class where oid='customer_sync_events'::regclass) and not exists(select 1 from pg_policy where polrelid='customer_sync_events'::regclass)", 'journal has no source-created FK/RLS/policy: RLS and policies absent'))
    chunks.append(check("obj_description('customer_sync_events'::regclass,'pg_class')='Operations Core SaaS sync journal for customer/site/metering/billing/Ediel linkage decisions. Keeps unresolved inbound and matching history tenant-safe.'", 'exact journal table comment'))
    chunks.append(check("col_description('customer_sync_events'::regclass,(select attnum from pg_attribute where attrelid='customer_sync_events'::regclass and attname='company_id'))='Tenant owner. Must be populated for SaaS production data before strict RLS is enabled.'", 'exact journal company comment'))
    chunks.append(check("col_description('customer_sync_events'::regclass,(select attnum from pg_attribute where attrelid='customer_sync_events'::regclass and attname='matched_by'))='Match keys used, e.g. customer_number, org_number, facility_id, meter_point_id, ediel_reference.'", 'exact journal matched_by comment'))
    return '\n'.join(chunks)


def required_failures():
    required = ('id', 'source_type', 'match_status', 'matched_by', 'event_type', 'title', 'payload', 'created_at')
    columns = required
    base = {
        'id': "'61000000-0000-0000-0000-000000000099'", 'source_type': "'synthetic'",
        'match_status': "'pending'", 'matched_by': "array['customer_number']::text[]",
        'event_type': "'linked'", 'title': "'Required fields'", 'payload': "'{}'::jsonb",
        'created_at': "'2001-01-01Z'::timestamptz",
    }
    chunks = []
    for column in required:
        values = ["null" if name == column else base[name] for name in columns]
        chunks.append(f"""do $$ declare caught boolean:=false; bad_column text; begin
 begin insert into customer_sync_events({','.join(columns)}) values ({','.join(values)});
 exception when sqlstate '23502' then get stacked diagnostics bad_column=column_name; caught:=bad_column='{column}'; end;
 perform test_assert(caught,'required journal field {column} rejects NULL with exact23502 column');
end $$;""")
    return '\n'.join(chunks)


def behavior():
    values = []
    for idx, status in enumerate(('pending', 'matched', 'unresolved', 'ignored', 'resolved'), 1):
        company, customer, site, meter, actor = (C1, CUSTOMER1, SITE1, METER1, U1) if idx % 2 else (C2, CUSTOMER2, SITE2, METER2, U2)
        resolved = "null,null,null" if status not in ('ignored', 'resolved') else f"'2002-01-0{idx}Z','{actor}','synthetic resolution'"
        values.append(f"('61000000-0000-0000-0000-00000000000{idx}','{company}','{customer}','{site}','{meter}','synthetic','71000000-0000-0000-0000-00000000000{idx}','SRC-{idx}','{status}',{idx * 10}.25,array['customer_number','facility_id'],'linked','Synthetic {status}','representative payload','{{\"sentinel\":{idx}}}','2002-01-0{idx}Z',{resolved})")
    return f"""insert into customer_sync_events(id,company_id,customer_id,site_id,metering_point_id,source_type,source_id,source_reference,match_status,match_confidence,matched_by,event_type,title,description,payload,created_at,resolved_at,resolved_by,resolution_note) values
 {', '.join(values)};
select test_assert((select array_agg(match_status order by id)=array['pending','matched','unresolved','ignored','resolved'] from customer_sync_events where id::text like '61000000-0000-0000-0000-00000000000_'),'all five match statuses retain representative two-company references');
select test_assert((select count(*)=3 from customer_sync_events where company_id='{C1}') and (select count(*)=2 from customer_sync_events where company_id='{C2}'),'journal references remain tenant-labelled without claiming same-company enforcement');
{required_failures()}
do $$ declare caught boolean:=false; bad_constraint text; begin
 begin insert into customer_sync_events(id,source_type,event_type,title) values ('61000000-0000-0000-0000-000000000001','duplicate','duplicate','duplicate');
 exception when sqlstate '23505' then get stacked diagnostics bad_constraint=constraint_name; caught:=bad_constraint='customer_sync_events_pkey'; end;
 perform test_assert(caught,'UUID PK uniqueness exact23505 customer_sync_events_pkey');
end $$;
do $$ declare caught boolean:=false; bad_constraint text; begin
 begin insert into customer_sync_events(source_type,event_type,title,match_status) values ('invalid','invalid','invalid','not-a-status');
 exception when sqlstate '23514' then get stacked diagnostics bad_constraint=constraint_name; caught:=bad_constraint='customer_sync_events_match_status_check'; end;
 perform test_assert(caught,'invalid match status exact23514 named check');
end $$;
-- Source deliberately permits unresolved ownership and confidence values; later constraints remain OPEN.
insert into customer_sync_events(company_id,customer_id,site_id,metering_point_id,source_type,event_type,title,match_confidence)
 values ('{C1}','{CUSTOMER2}','{SITE2}','{METER2}','cross-company-characterization','characterize','No source FK/agreement',999.99);
select test_assert((select count(*)=1 from customer_sync_events where source_type='cross-company-characterization' and match_confidence=999.99),'source has no FK/same-company/confidence-range enforcement');
"""


def main_sql():
    return '\n'.join((prefix(), seed(), snapshot('before'), source(), catalogs(), preserved('before'),
                      behavior(), snapshot('first', include_journal=True), source(), catalogs(),
                      preserved('first', include_journal=True)))


def reduced_sql(case):
    gov = governance()
    setup = gov.bootstrap() + '\n-- REDUCED OPERATIONS BRANCH; not complete-prefix evidence.\n'
    if case == 'absent_targets':
        verify = check("to_regclass('customers') is null and to_regclass('customer_sync_events') is not null", 'REDUCED absent targets skip loop/search branches while journal is created')
    elif case == 'missing_company_column':
        setup += 'create table customers(id uuid primary key,sentinel text);\n'
        verify = check("(select atttypid='uuid'::regtype and not attnotnull and not atthasdef from pg_attribute where attrelid='customers'::regclass and attname='company_id') and pg_get_indexdef('customers_company_id_idx'::regclass)='CREATE INDEX customers_company_id_idx ON public.customers USING btree (company_id)'", 'REDUCED missing company column gets nullable UUID and exact index')
        verify += check("to_regclass('customers_company_customer_number_idx') is null", 'REDUCED missing search column skips guarded customer-number branch')
    elif case == 'wrong_journal_shape':
        setup += """create table customer_sync_events(id text,company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,source_type text,source_id uuid,source_reference text,match_status text,match_confidence text,matched_by text[],event_type text,title text,description text,payload jsonb,created_at timestamptz,resolved_at timestamptz,resolved_by uuid,resolution_note text);
insert into customer_sync_events(id,source_type,event_type,title) values ('stable-wrong-id','synthetic','synthetic','synthetic');
"""
        verify = check("(select atttypid='text'::regtype from pg_attribute where attrelid='customer_sync_events'::regclass and attname='id') and not exists(select 1 from pg_constraint where conrelid='customer_sync_events'::regclass and contype in ('p','c')) and (select id='stable-wrong-id' from customer_sync_events)", 'REDUCED existing wrong journal ID/PK/check shape and row retained; mismatch NOT reconciled')
    elif case == 'wrong_company_shape':
        setup += "create table customers(id uuid primary key,company_id text); insert into customers values ('31000000-0000-0000-0000-000000000099','stable-text-owner');\n"
        verify = check("(select atttypid='text'::regtype from pg_attribute where attrelid='customers'::regclass and attname='company_id') and (select company_id='stable-text-owner' from customers) and pg_get_indexdef('customers_company_id_idx'::regclass)='CREATE INDEX customers_company_id_idx ON public.customers USING btree (company_id)'", 'REDUCED existing wrong company column type/value retained and indexed; mismatch NOT reconciled')
    elif case == 'same_name_index':
        setup += """create table customers(id uuid primary key,company_id uuid,customer_number text,personal_number text,org_number text);
create index customers_company_customer_number_idx on customers(customer_number);
create table ops_wrong_index as select 'customers_company_customer_number_idx'::regclass::oid index_oid;
"""
        verify = check("(select index_oid='customers_company_customer_number_idx'::regclass from ops_wrong_index) and pg_get_indexdef('customers_company_customer_number_idx'::regclass)='CREATE INDEX customers_company_customer_number_idx ON public.customers USING btree (customer_number)'", 'REDUCED retained same-name wrong index is explicitly reported as mismatch, not source convergence')
    else:
        raise AssertionError(case)
    return setup + source() + verify


REDUCED = ('absent_targets', 'missing_company_column', 'wrong_company_shape', 'wrong_journal_shape', 'same_name_index')


def environment():
    return {key: value for key, value in os.environ.items() if not key.startswith('PG')}


def run_sql(sql, url=TARGET, expected=None):
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql') as file:
        file.write("\\set VERBOSITY verbose\nset statement_timeout='20s';\n" + sql)
        file.flush()
        result = subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', url, '-f', file.name], text=True, capture_output=True, env=environment(), timeout=90)
    if expected is None:
        assert result.returncode == 0, result.stderr
    else:
        state, message = expected
        assert result.returncode == 3 and f'ERROR:  {state}:' in result.stderr and message in result.stderr, (expected, result.returncode, result.stderr)
    return result


def reset(template=False):
    suffix = f' template {CLEAN_DATABASE}' if template else ''
    run_sql(f'drop database if exists {DATABASE} with (force);\ncreate database {DATABASE}{suffix};', ADMIN)


def late_failure():
    malformed = """create table customer_sync_events(id uuid primary key default gen_random_uuid(),company_id uuid,match_status text,created_at timestamptz);
create table ops_late_rows as select relation,id,value from ops_before_rows;
"""
    verify = preserved('before')
    verify += check("to_regclass('customers_company_customer_number_idx') is not null and to_regclass('metering_points_company_ediel_reference_idx') is not null", 'late failure leaves both prior DO units committed')
    verify += check("to_regclass('customer_sync_events_company_status_idx') is not null and to_regclass('customer_sync_events_customer_idx') is null and to_regclass('customer_sync_events_source_idx') is null", 'late second journal-index failure retains first committed index and rolls back failed unit')
    return malformed, verify


def contention():
    reset(template=True)
    run_sql(snapshot('locked'))
    command = ['psql', '-X', '-v', 'ON_ERROR_STOP=1', TARGET, '-f', '-']
    holder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, env=environment())
    holder.stdin.write("set application_name='operations_sync_synthetic_locker'; begin; set local idle_in_transaction_session_timeout='15s'; lock table customer_contacts in share mode;\n")
    holder.stdin.flush()
    try:
        deadline = time.monotonic() + 5
        while True:
            observed = run_sql("select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='operations_sync_synthetic_locker' and l.relation='customer_contacts'::regclass and l.mode='ShareLock' and l.granted);")
            if '\n t\n' in observed.stdout:
                break
            assert time.monotonic() < deadline and holder.poll() is None, 'synthetic holder did not acquire real lock'
            time.sleep(.05)
        run_sql("set lock_timeout='400ms';\n" + source(), expected=('55P03', 'canceling statement due to lock timeout'))
        exact_catalog = check("not exists((select * from ops_locked_indexes except select c.oid,c.relname,pg_get_indexdef(c.oid) from pg_class c join pg_index i on i.indexrelid=c.oid) union all (select c.oid,c.relname,pg_get_indexdef(c.oid) from pg_class c join pg_index i on i.indexrelid=c.oid where c.relnamespace='public'::regnamespace except select * from ops_locked_indexes))", 'failed ownership-loop transaction preserves the exact prior index catalog')
        run_sql(preserved('locked', exact=True) + exact_catalog + check("to_regclass('customer_sync_events') is null", 'failed ownership-loop transaction stops before search/journal units'))
    finally:
        if holder.poll() is None:
            holder.communicate('rollback;\n', timeout=15)
        else:
            holder.communicate(timeout=15)
    run_sql(check("not exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='operations_sync_synthetic_locker' and a.datname=current_database())", 'synthetic operations lock released deterministically'))
    print('PASS: real finite lock timeout at ownership-loop unit; unit rolled back and catalogs/references retained')


def execute():
    selection()
    reset()
    run_sql(main_sql())
    print('PASS: actual first31 then all140 operations lines; all19 targets,28 source indexes, exact journal, rows/references and repeat')
    run_sql(f'drop database if exists {CLEAN_DATABASE} with (force);\ncreate database {CLEAN_DATABASE};', ADMIN)
    run_sql(prefix() + seed(), CLEAN_TARGET)
    reset(template=True)
    run_sql(snapshot('before'))
    setup, verify = late_failure()
    run_sql(setup)
    run_sql(source(), expected=('42703', 'column "customer_id" does not exist'))
    run_sql(verify)
    print('PASS: late journal-index exact42703 leaves earlier unwrapped units and first journal index committed')
    contention()
    for case in REDUCED:
        reset()
        run_sql(reduced_sql(case))
        print(f'PASS: REDUCED {case}; not complete-prefix evidence')
    print('OPEN: actor/tenant/FK agreement, final journal ACL/RLS/policies, import retention, customer deletion, measured index coverage, full parity')


def emit():
    print('-- NOT EXECUTED: main SQL plus separately reset failure/lock/reduced sections; never concatenate expected-failure sections.')
    print(main_sql())
    setup, verify = late_failure()
    print('-- RESET ACTUAL-PREFIX CLONE: late journal index EXPECT42703 customer_id; unwrapped ON_ERROR_STOP.\n' + snapshot('before') + setup + source() + '\n-- NEW CONNECTION AFTER EXPECTED FAILURE\n' + verify)
    print('-- RESET ACTUAL-PREFIX CLONE: concurrent SHARE lock on customer_contacts; finite400ms lock_timeout EXPECT55P03 in the actual first DO transaction; Python orchestrates real holder/release.')
    for case in REDUCED:
        print('-- RESET DISPOSABLE DATABASE\n' + reduced_sql(case))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--selection-only', action='store_true', help='Verify source/hash/order/accounting without psql')
    modes.add_argument('--emit', action='store_true', help='Emit SQL without database calls')
    args = parser.parse_args()
    if args.selection_only:
        selection()
        print('PASS: checksum-pinned operations source selected exactly at entry32; token prerequisite follows; SQL NOT EXECUTED')
    elif args.emit:
        emit()
    else:
        execute()
