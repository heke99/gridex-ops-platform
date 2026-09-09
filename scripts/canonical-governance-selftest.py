#!/usr/bin/env python3
"""Bounded full 6D source characterization; final journal authorization remains OPEN."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'migrations/20260519_batch_6d_superadmin_tenant_governance.sql'
OPERATIONS = 'migrations/20260519_operations_core_saas_sync.sql'
SHA = 'b54cc17584c7274862fe85711e324fff030ffca770d360c0fb721979f549cb47'
EARLY = 'bootstrap/20260519_companies_governance_foundation.sql'
EARLY_SHA = '7e245a6f95321c4fcf3fd0194b2c50a8ea99f9af4cfa05c917741e496ed6a41d'
DATABASE = 'gridex_governance_fixture'
ADMIN = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'
TARGET = f'postgresql://postgres:postgres@127.0.0.1:55440/{DATABASE}'
TARGETS = ('customers','customer_contacts','customer_addresses','customer_sites','metering_points',
 'customer_authorization_documents','customer_contracts','customer_contract_events',
 'supplier_switch_requests','supplier_switch_events','grid_owner_data_requests',
 'customer_operation_tasks','outbound_requests','ediel_messages','metering_values','billing_underlays','partner_exports')


def read(path):
    return (ROOT / path).read_text()


def selection():
    order = json.loads(read('scripts/gridex-aud-003-foundation-order.json'))['foundation']
    additions = json.loads(read('scripts/gridex-aud-003-legacy-foundation.additions.json'))
    assert order[30:33] == [SOURCE, OPERATIONS, 'bootstrap/20260527_company_memberships_role_key_foundation.sql'], 'complete 6D must stay at31 and operations must be32'
    assert order[29] == 'migrations/20260519_saas_ui_tenant_admin.sql'
    assert len(order) == 77 and order.count(SOURCE) == additions['foundation'].count(SOURCE) == 1
    assert order.count(OPERATIONS) == additions['foundation'].count(OPERATIONS) == 1
    assert not any('6d2_' in p for p in order + additions['foundation'])
    assert order[9] == EARLY and order.count(EARLY) == 1
    meta = additions['derivedBootstrap'][EARLY]
    assert meta['source'] == SOURCE and meta.get('preserveSourceReplay') is True
    assert meta['artifactSha256'] == EARLY_SHA == hashlib.sha256((ROOT / 'supabase' / EARLY).read_bytes()).hexdigest()
    manifest = json.loads(read('scripts/migration-history-manifest.json'))
    assert manifest['files'][Path(SOURCE).name] == SHA == hashlib.sha256((ROOT / 'supabase' / SOURCE).read_bytes()).hexdigest()
    account = subprocess.run(['python3','scripts/gridex-replay-input-accounting.py'],cwd=ROOT,text=True,capture_output=True)
    data = json.loads(account.stdout)
    assert account.returncode == 1 and not data['errors']
    assert data['totalMigrations'] == 592 and data['counts'] == {'FULL_FILE_SELECTED':517,'SUBSTITUTED':26,'UNCLASSIFIED':45,'EXPLICITLY_EXCLUDED':4}, data['counts']
    grouped = subprocess.run(['python3','scripts/gridex-replay-review-groups.py','--group','auth_membership_tenant'],cwd=ROOT,text=True,capture_output=True)
    group = json.loads(grouped.stdout)
    assert grouped.returncode == 1 and not group['errors'] and len(group['inputs']) == 338
    counts = {key:sum(item['classification'] == key for item in group['inputs']) for key in data['counts']}
    assert counts == {'FULL_FILE_SELECTED':274,'SUBSTITUTED':23,'UNCLASSIFIED':37,'EXPLICITLY_EXCLUDED':4}, counts
    return order[:30]


ASSERT = """create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
select test_assert(current_setting('server_version_num')::int / 10000=17,'PostgreSQL 17');
"""
C1 = '21000000-0000-0000-0000-000000000001'
C2 = '21000000-0000-0000-0000-000000000002'
U1 = '11000000-0000-0000-0000-000000000001'
U2 = '11000000-0000-0000-0000-000000000002'
ROWS = ('companies','company_memberships','company_invitations','user_profiles','customers',
        'ediel_messages','billing_underlays','roles','permissions','role_permissions')
CHECKS = {
 ('companies','companies_status_check'): ('status',('active','onboarding','paused','suspended','archived','pending_deletion','deleted_test_only')),
 ('company_memberships','company_memberships_role_check'): ('membership_role',('owner','admin','company_admin','operations','support','member','viewer')),
 ('company_memberships','company_memberships_status_check'): ('status',('active','invited','pending','suspended','disabled','removed','removed_from_company','invitation_revoked','locked_security','revoked')),
 ('company_invitations','company_invitations_membership_role_check'): ('membership_role',('owner','admin','company_admin','operations','support','member','viewer')),
 ('company_invitations','company_invitations_status_check'): ('status',('pending','accepted','revoked','expired','invitation_revoked')),
 ('user_profiles','user_profiles_user_status_check'): ('user_status',('active','disabled','removed_from_company','invitation_revoked','locked_security')),
}
INDEXES = {
 'companies_governance_status_idx': ('companies','(status, updated_at DESC)'),
 'tenant_governance_events_company_created_idx': ('tenant_governance_events','(company_id, created_at DESC)'),
 'tenant_governance_events_target_user_created_idx': ('tenant_governance_events','(target_user_id, created_at DESC)'),
}


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def check(condition, label):
    return f'select test_assert({condition},{quote(label)});\n'


def bootstrap():
    return read('scripts/sql/gridex-supabase-compatible-bootstrap.sql') + '\nset search_path = "$user", public, extensions;\n' + ASSERT


def source():
    return f'-- GOVERNANCE_SOURCE_BEGIN {SOURCE}\n' + read('supabase/' + SOURCE)


def prefix():
    return bootstrap() + '\n'.join(f'-- GOVERNANCE_PREFIX_FILE_BEGIN {p}\n' + read('supabase/' + p) for p in selection())


def seed():
    return f"""-- Synthetic rows only, after the actual complete first30 files.
insert into auth.users(id) values ('{U1}'),('{U2}');
insert into companies(id,name,org_number,status,metadata,paused_by) values
 ('{C1}','Governance One','9111111111','active','{{"sentinel":"one"}}','{U1}'),
 ('{C2}','Governance Two','9222222222','onboarding','{{"sentinel":"two"}}','{U2}');
insert into user_profiles(id,email,full_name,user_status) values
 ('{U1}','gov-one@example.invalid','Synthetic One','active'),('{U2}','gov-two@example.invalid','Synthetic Two','disabled');
insert into company_memberships(company_id,user_id,membership_role,status,role_id) values
 ('{C1}','{U1}','owner','active',(select id from roles where key='company_admin')),
 ('{C1}','{U2}','member','suspended',(select id from roles where key='company_admin')),
 ('{C2}','{U2}','admin','active',(select id from roles where key='company_admin'));
insert into company_invitations(company_id,email,membership_role,status,metadata) values
 ('{C1}','pending@example.invalid','member','pending','{{"sentinel":"invite"}}'),
 ('{C1}','accepted@example.invalid','viewer','accepted','{{}}');
insert into customers(company_id,full_name) values ('{C1}','Synthetic A'),('{C1}','Synthetic B'),('{C2}','Synthetic C');
insert into ediel_messages(company_id,direction,message_family) values ('{C1}','outbound','UTILTS');
insert into billing_underlays(company_id,customer_id,readiness_status) select '{C1}',id,s from customers cross join unnest(array[null,'not_checked','blocked','ready','export_ready','exported']::text[]) s where full_name='Synthetic A';
"""


def snapshot(name, tables=ROWS):
    chunks = [f'create table gov_{name}_rows(relation text, id text, value jsonb);']
    for table in tables:
        chunks.append(f"insert into gov_{name}_rows select '{table}',id::text,to_jsonb(t) from {table} t;")
    chunks.append(f"create table gov_{name}_fks as select oid,conrelid,confrelid,conkey,confkey,confdeltype,confupdtype,convalidated,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace and contype='f';")
    chunks.append(f"create table gov_{name}_indexes as select c.oid,pg_get_indexdef(c.oid) definition from pg_class c join pg_index i on i.indexrelid=c.oid where c.relnamespace='public'::regnamespace;")
    return '\n'.join(chunks)


def preserved(name, tables=ROWS, exact=False):
    chunks = []
    for table in tables:
        predicate = 'to_jsonb(t)=b.value' if exact else 'to_jsonb(t) @> b.value'
        chunks.append(check(f"not exists(select 1 from gov_{name}_rows b where relation='{table}' and not exists(select 1 from {table} t where t.id::text=b.id and {predicate})) and (select count(*) from {table})=(select count(*) from gov_{name}_rows where relation='{table}')", f'{name}: {table} IDs, references and unrelated row values retained'))
    chunks.append(check(f"not exists(select * from gov_{name}_fks except select oid,conrelid,confrelid,conkey,confkey,confdeltype,confupdtype,convalidated,pg_get_constraintdef(oid) from pg_constraint)",f'{name}: every existing actor/parent FK identity and action retained'))
    chunks.append(check(f"not exists(select * from gov_{name}_indexes except select c.oid,pg_get_indexdef(c.oid) from pg_class c join pg_index i on i.indexrelid=c.oid)",f'{name}: every existing index OID and definition retained'))
    return '\n'.join(chunks)


def catalogs():
    chunks = []
    for table in TARGETS:
        chunks.append(check(f"(select count(*)=1 from pg_trigger t where tgrelid='public.{table}'::regclass and tgname='{table}_tenant_operational_guard_trg' and not tgisinternal and tgtype=23 and tgenabled='O' and tgfoid='public.gridex_assert_company_operational_for_write()'::regprocedure and tgattr::text=(select attnum::text from pg_attribute where attrelid=t.tgrelid and attname='company_id') and tgqual is null and tgnargs=0)",f'exact BEFORE ROW INSERT/UPDATE OF company_id guard: {table}'))
    for (table,name),(column,values) in CHECKS.items():
        expression = 'CHECK ((' + column + ' = ANY (ARRAY[' + ', '.join(quote(v) + '::text' for v in values) + '])))'
        chunks.append(check(f"(select convalidated and not condeferrable and pg_get_constraintdef(oid)={quote(expression)} from pg_constraint where conrelid='{table}'::regclass and conname='{name}')",f'exact source check {name}'))
    columns = {
      'companies': {'text':['status_reason'],'timestamptz':['paused_at','suspended_at','archived_at','deletion_requested_at','reactivated_at'],'uuid':['paused_by','suspended_by','archived_by','deletion_requested_by','reactivated_by']},
      'company_memberships': {'text':['status_reason'],'timestamptz':['disabled_at','removed_at'],'uuid':['disabled_by','removed_by']},
      'user_profiles': {'text':['disabled_reason'],'timestamptz':['disabled_at','reactivated_at'],'uuid':['disabled_by','reactivated_by']},
    }
    for table, types in columns.items():
        for typ,names in types.items():
            for name in names:
                chunks.append(check(f"(select atttypid='{typ}'::regtype and not attnotnull and atthasdef=false from pg_attribute where attrelid='{table}'::regclass and attname='{name}' and not attisdropped)",f'nullable no-default {table}.{name} {typ}'))
                if typ == 'uuid':
                    if table == 'companies' and name == 'paused_by':
                        chunks.append(check("not exists(select 1 from pg_constraint where conrelid='companies'::regclass and contype='f' and conkey=array[(select attnum from pg_attribute where attrelid='companies'::regclass and attname='paused_by')])",'existing paused_by has NO inline auth FK; convergence remains OPEN'))
                    else:
                        chunks.append(fk_check(table,name,'auth.users'))
    chunks.append(check("(select atttypid='text'::regtype and attnotnull and pg_get_expr(d.adbin,d.adrelid)='''active''::text' from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='user_profiles'::regclass and a.attname='user_status')",'actual prefix user_status remains NOT NULL default active'))
    journal = [('id','uuid',True,'gen_random_uuid()'),('company_id','uuid',False,None),('target_user_id','uuid',False,None),('actor_user_id','uuid',False,None),('action','text',True,None),('reason','text',False,None),('metadata','jsonb',True,"'{}'::jsonb"),('created_at','timestamptz',True,'now()')]
    chunks.append(check("(select count(*)=8 from pg_attribute where attrelid='tenant_governance_events'::regclass and attnum>0 and not attisdropped)",'exact eight-column journal'))
    for pos,(name,typ,required,default) in enumerate(journal,1):
        default_sql = 'pg_get_expr(d.adbin,d.adrelid) is null' if default is None else 'pg_get_expr(d.adbin,d.adrelid)=' + quote(default)
        chunks.append(check(f"(select a.attnum={pos} and atttypid='{typ}'::regtype and attnotnull={str(required).lower()} and {default_sql} from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='tenant_governance_events'::regclass and a.attname='{name}')",f'exact journal {name} type/order/nullability/default'))
    chunks.append(check("(select count(*)=1 and bool_and(convalidated and not condeferrable and pg_get_constraintdef(oid)='PRIMARY KEY (id)') from pg_constraint where conrelid='tenant_governance_events'::regclass and contype='p')",'journal PK identity shape'))
    chunks.append(check("(select indisprimary and indisunique and indisvalid and indisready and indpred is null and indexprs is null and pg_get_indexdef(indexrelid)='CREATE UNIQUE INDEX tenant_governance_events_pkey ON public.tenant_governance_events USING btree (id)' from pg_index where indexrelid='tenant_governance_events_pkey'::regclass)",'exact valid journal primary-key backing index'))
    for col,parent in [('company_id','companies'),('target_user_id','auth.users'),('actor_user_id','auth.users')]:
        chunks.append(fk_check('tenant_governance_events',col,parent))
    chunks.append(check("(select count(*)=3 from pg_constraint where conrelid='tenant_governance_events'::regclass and contype='f')",'exact three journal FKs'))
    for name,(table,definition) in INDEXES.items():
        chunks.append(check(f"(select pg_get_indexdef(indexrelid)={quote(f'CREATE INDEX {name} ON public.{table} USING btree {definition}')} and indisvalid and indisready and not indisunique and indpred is null and indexprs is null from pg_index where indexrelid='{name}'::regclass)",f'exact source index {name}'))
    chunks.append(check("(select prosecdef and proconfig=array['search_path=public'] from pg_proc where oid='gridex_assert_company_operational_for_write()'::regprocedure)",'source trigger security/search path; later hardening remains OPEN'))
    chunks.append(check("(select not relrowsecurity and not relforcerowsecurity from pg_class where oid='tenant_governance_events'::regclass) and not exists(select 1 from pg_policy where polrelid='tenant_governance_events'::regclass)",'6D creates journal WITHOUT RLS/policies; final ACL/permissive+restrictive policy/runtime contract OPEN'))
    chunks.append("select relacl,relrowsecurity,relforcerowsecurity from pg_class where oid='tenant_governance_events'::regclass; -- observed prefix ACL only; managed table defaults intentionally not manufactured\n")
    chunks.append(check("obj_description('tenant_governance_events'::regclass,'pg_class')='Superadmin tenant/user governance event journal for pause, suspend, archive, deletion checks and user disable/remove actions.'",'exact journal comment'))
    names = ['company_id','name','org_number','status','status_reason','updated_at','active_user_count','customer_count','ediel_message_count','blocked_billing_underlay_count','pending_invitation_count']
    chunks.append(check("(select array_agg(attname::text order by attnum)=array[" + ','.join(quote(n) for n in names) + "] from pg_attribute where attrelid='platform_tenant_governance_overview'::regclass and attnum>0 and not attisdropped)",'exact governance overview columns and order'))
    chunks.append(check("(select array_agg(atttypid::regtype::text order by attnum)=array['uuid','text','text','text','text','timestamp with time zone','integer','integer','integer','integer','integer'] from pg_attribute where attrelid='platform_tenant_governance_overview'::regclass and attnum>0 and not attisdropped)",'exact governance overview types'))
    chunks.append(check("(select not(coalesce(reloptions,array[]::text[]) @> array['security_invoker=true']) from pg_class where oid='platform_tenant_governance_overview'::regclass)",'6D overview has source owner semantics; final invoker hardening remains OPEN'))
    chunks.append(check(f"not exists(select v.company_id,v.name,v.org_number,v.status,v.status_reason,v.updated_at from platform_tenant_governance_overview v where company_id in ('{C1}','{C2}') except select id,name,org_number,status,status_reason,updated_at from companies where id in ('{C1}','{C2}'))",'overview retains company identity and lifecycle attributes'))
    for company,counts in [(C1,'1,2,1,3,1'),(C2,'1,1,0,0,0')]:
        chunks.append(check(f"(select row(active_user_count,customer_count,ediel_message_count,blocked_billing_underlay_count,pending_invitation_count)=row({counts}) from platform_tenant_governance_overview where company_id='{company}')",f'tenant-specific aggregates including NULL readiness: {company}'))
    return '\n'.join(chunks)


def fk_check(table,column,parent):
    return check(f"(select count(*)=1 from pg_constraint where conrelid='{table}'::regclass and contype='f' and confrelid='{parent}'::regclass and conkey=array[(select attnum from pg_attribute where attrelid='{table}'::regclass and attname='{column}')] and confkey=array[(select attnum from pg_attribute where attrelid='{parent}'::regclass and attname='id')] and confdeltype='n' and confupdtype='a' and convalidated and not condeferrable)",f'exact validated SET NULL/NO ACTION FK {table}.{column}')


def behavior():
    return f"""-- Sanctioned synthetic owner writes test trigger coverage, not effective runtime RLS.
do $$ declare s text; caught boolean; msg text; begin
 foreach s in array array['active','onboarding'] loop
  update companies set status=s where id='{C1}';
  insert into customers(company_id,full_name) values ('{C1}','Allowed synthetic');
  delete from customers where full_name='Allowed synthetic';
 end loop;
 foreach s in array array['paused','suspended','archived','pending_deletion','deleted_test_only'] loop
  update companies set status=s where id='{C1}';
  caught:=false;
  begin
   insert into customers(company_id,full_name) values ('{C1}','Blocked synthetic');
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; caught:=msg='Tenant {C1} is '||s||', write is blocked for operational data'; end;
  perform test_assert(caught,'exact blocked INSERT status '||s);
  caught:=false;
  begin
   update customers set company_id=company_id where full_name='Synthetic A';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; caught:=msg='Tenant {C1} is '||s||', write is blocked for operational data'; end;
  perform test_assert(caught,'exact blocked UPDATE OF company_id status '||s);
  update customers set full_name=full_name where full_name='Synthetic A';
 end loop;
 update companies set status='active' where id='{C1}';
end $$;
-- NULL company_id passes the trigger; a missing parent remains an FK error.
insert into customers(company_id,full_name) values (null,'Null synthetic');
delete from customers where full_name='Null synthetic';
do $$ declare caught boolean:=false; begin
 begin insert into customers(company_id,full_name) values ('21000000-0000-0000-0000-000000000099','Missing synthetic');
 exception when foreign_key_violation then caught:=true; end;
 perform test_assert(caught,'operational trigger is not a replacement for parent FK');
end $$;
"""


def main_sql():
    journal = f"""update company_memberships set disabled_by='{U1}',removed_by='{U2}',status_reason='synthetic actor references',disabled_at='2001-01-01Z',removed_at='2001-01-02Z' where company_id='{C1}';
update user_profiles set disabled_by='{U1}',reactivated_by='{U2}',disabled_reason='synthetic actor references' where id='{U2}';
update companies set suspended_by='{U1}',archived_by='{U2}',deletion_requested_by='{U1}',reactivated_by='{U2}' where id='{C1}';
""" + """insert into tenant_governance_events(company_id,target_user_id,actor_user_id,action,reason,metadata) values
 ('%s','%s','%s','synthetic-check','sentinel','{"sentinel":true}');
create table gov_identity as select 'tenant_governance_events'::regclass::oid journal,'platform_tenant_governance_overview'::regclass::oid overview,'gridex_assert_company_operational_for_write()'::regprocedure::oid helper;
""" % (C1,U1,U2)
    return '\n'.join([prefix(),seed(),snapshot('before'),source(),catalogs(),preserved('before'),
       journal,snapshot('first',ROWS+('tenant_governance_events',)),source(),catalogs(),
       preserved('first',ROWS+('tenant_governance_events',),exact=True),
       check("(select journal='tenant_governance_events'::regclass and overview='platform_tenant_governance_overview'::regclass and helper='gridex_assert_company_operational_for_write()'::regprocedure from gov_identity)",'journal/view/function OIDs survive repeat; recreated checks/triggers exempt'),behavior()])

# These are deliberately incompatible disposable states, restored from a clean
# real-prefix template for each case. No cleanup/normalization follows failure.
DIRTY = (
 ('company_status','companies','companies_status_check','status','not_a_company_status',f"id='{C1}'"),
 ('member_role','company_memberships','company_memberships_role_check','membership_role','platform_admin',f"company_id='{C1}' and user_id='{U1}'"),
 ('member_status','company_memberships','company_memberships_status_check','status','not_a_member_status',f"company_id='{C1}' and user_id='{U1}'"),
 ('invitation_role','company_invitations','company_invitations_membership_role_check','membership_role','super_admin',"email='pending@example.invalid'"),
 ('invitation_status','company_invitations','company_invitations_status_check','status','not_an_invitation_status',"email='pending@example.invalid'"),
 ('profile_status','user_profiles','user_profiles_user_status_check','user_status','suspended',f"id='{U2}'"),
)


def boundary_snapshot():
    return """create table gov_boundary as select oid,conrelid,conname,pg_get_constraintdef(oid) definition from pg_constraint where (conrelid='companies'::regclass and conname='companies_status_check') or (conrelid='company_memberships'::regclass and conname='company_memberships_role_check');
"""


def boundary_checks(company_committed=True):
    op = '<>' if company_committed else '='
    return check(f"(select c.oid {op} b.oid from gov_boundary b join pg_constraint c using(conrelid,conname) where b.conname='companies_status_check')",'companies statement committed' if company_committed else 'failing companies DO rolls back its constraint drop') + check("not exists(select * from gov_boundary where conname='company_memberships_role_check' except select oid,conrelid,conname,pg_get_constraintdef(oid) from pg_constraint)",'shared member/invitation/profile DO retains original member check on failure') + check("to_regclass('tenant_governance_events') is null",'ON_ERROR_STOP did not reach journal statement')


def dirty_sql(case):
    label,table,constraint,column,value,where = case
    setup = f"""-- DIRTY ACTUAL PREFIX: {label}; retained incompatible value, no cleanup.
alter table {table} drop constraint if exists {constraint};
alter table {table} add constraint {constraint} check (true);
update {table} set {column}={quote(value)} where {where};
""" + snapshot('dirty') + boundary_snapshot()
    verify = preserved('dirty',exact=True) + boundary_checks(label != 'company_status')
    verify += check(f"(select {column}={quote(value)} from {table} where {where})",'dirty row remains unchanged after precise check violation')
    verify += check(f"exists(select 1 from pg_constraint where conrelid='{table}'::regclass and conname='{constraint}' and pg_get_constraintdef(oid)='CHECK (true)')",'failing DO restores original permissive synthetic check identity/definition')
    return setup, verify


def reduced_sql(case):
    setup = bootstrap() + '\n-- REDUCED SHAPE/GUARD CHARACTERIZATION ONLY; not complete-prefix evidence.\n'
    setup += 'create table companies(id uuid primary key,status text,updated_at timestamptz);\n'
    verify = ''
    if case == 'missing_relation':
        verify = check("to_regclass('customers') is null and to_regclass('platform_tenant_governance_overview') is null and not exists(select 1 from pg_trigger where tgname like '%_tenant_operational_guard_trg')",'REDUCED missing relations skip all17 guards and overview')
    elif case == 'missing_company_column':
        setup += 'create table customers(id uuid primary key);\n'
        verify = check("not exists(select 1 from pg_trigger where tgrelid='customers'::regclass and tgname='customers_tenant_operational_guard_trg') and to_regclass('platform_tenant_governance_overview') is null",'REDUCED existing customer relation without company_id skips guard; incomplete overview skipped')
    elif case == 'existing_journal':
        setup += "create table tenant_governance_events(id text,company_id uuid,target_user_id uuid,created_at timestamptz); insert into tenant_governance_events(id) values ('synthetic-existing');\n"
        verify = check("(select count(*)=4 from pg_attribute where attrelid='tenant_governance_events'::regclass and attnum>0 and not attisdropped) and not exists(select 1 from pg_constraint where conrelid='tenant_governance_events'::regclass) and (select id='synthetic-existing' from tenant_governance_events)",'REDUCED existing incompatible journal remains four columns, text ID, no PK/FKs: mismatch NOT reconciled')
    elif case == 'existing_columns':
        setup += "create table user_profiles(id uuid primary key,user_status text,disabled_by text); insert into user_profiles values ('" + U1 + "',null,'synthetic-not-uuid');\n"
        verify = check("(select user_status is null and disabled_by='synthetic-not-uuid' from user_profiles) and (select not attnotnull and not atthasdef from pg_attribute where attrelid='user_profiles'::regclass and attname='user_status') and (select atttypid='text'::regtype from pg_attribute where attrelid='user_profiles'::regclass and attname='disabled_by')",'REDUCED existing NULL user_status and text disabled_by mismatch remains; ADD IF NOT EXISTS is not shape validation')
        verify += check("not exists(select 1 from pg_constraint where conrelid='user_profiles'::regclass and contype='f' and conkey=array[(select attnum from pg_attribute where attrelid='user_profiles'::regclass and attname='disabled_by')])",'REDUCED existing disabled_by gains no actor FK')
    elif case == 'same_name_index':
        setup += "create index companies_governance_status_idx on companies(id); create table gov_wrong_index as select 'companies_governance_status_idx'::regclass::oid id;\n"
        verify = check("(select id='companies_governance_status_idx'::regclass from gov_wrong_index) and pg_get_indexdef('companies_governance_status_idx'::regclass)='CREATE INDEX companies_governance_status_idx ON public.companies USING btree (id)'",'REDUCED wrong same-name index OID/definition retained: mismatch NOT reconciled')
    else:
        raise AssertionError(case)
    return setup + source() + verify


REDUCED = ('missing_relation','missing_company_column','existing_journal','existing_columns','same_name_index')


def environment():
    return {key:value for key,value in os.environ.items() if not key.startswith('PG')}


def run_sql(sql, url=TARGET, expected=None):
    # Match clean-replay.sh: original unwrapped files with -X/ON_ERROR_STOP/-f.
    # VERBOSITY supplies SQLSTATE for exact expected failures, never an arbitrary error.
    with tempfile.NamedTemporaryFile(mode='w',suffix='.sql') as file:
        file.write("\\set VERBOSITY verbose\nset statement_timeout='20s';\n" + sql)
        file.flush()
        result = subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1',url,'-f',file.name],text=True,capture_output=True,env=environment(),timeout=90)
    if expected is None:
        assert result.returncode == 0, result.stderr
    else:
        state,message = expected
        assert result.returncode == 3 and f'ERROR:  {state}:' in result.stderr and message in result.stderr, (expected,result.returncode,result.stderr)
    return result


def reset(template=None):
    suffix = ' template gridex_governance_clean' if template else ''
    run_sql(f'drop database if exists {DATABASE} with (force);\ncreate database {DATABASE}{suffix};',ADMIN)


def late_failure():
    setup = """-- ACTUAL PREFIX with one deliberately renamed required view column.
alter table billing_underlays rename column readiness_status to synthetic_readiness;
""" + snapshot('late')
    verify = preserved('late',exact=False)
    verify += check("to_regclass('tenant_governance_events') is not null and to_regclass('platform_tenant_governance_overview') is null",'late view error leaves earlier journal committed, overview absent')
    for table in TARGETS:
        verify += check(f"exists(select 1 from pg_trigger where tgrelid='{table}'::regclass and tgname='{table}_tenant_operational_guard_trg')",f'late failure leaves committed operational guard {table}')
    return setup,verify


def contention():
    reset(template=True)
    run_sql(snapshot('locked') + boundary_snapshot())
    # Real concurrent holder, finite server-side wait and client-side deadline.
    command = ['psql','-X','-v','ON_ERROR_STOP=1',TARGET,'-f','-']
    holder = subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,env=environment())
    holder.stdin.write("set application_name='governance_synthetic_locker'; begin; set local idle_in_transaction_session_timeout='15s'; lock table company_memberships in share mode;\n")
    holder.stdin.flush()
    try:
        deadline = time.monotonic()+5
        while True:
            observed = run_sql("select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='governance_synthetic_locker' and l.relation='company_memberships'::regclass and l.mode='ShareLock' and l.granted);")
            if '\n t\n' in observed.stdout:
                break
            assert time.monotonic()<deadline and holder.poll() is None, 'synthetic holder did not acquire real lock'
            time.sleep(.05)
        run_sql("set lock_timeout='400ms';\n" + source(),expected=('55P03','canceling statement due to lock timeout'))
        run_sql(preserved('locked',exact=True)+boundary_checks())
    finally:
        if holder.poll() is None:
            holder.communicate('rollback;\n',timeout=15)
        else:
            holder.communicate(timeout=15)
    run_sql(check("not exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='governance_synthetic_locker' and l.relation='company_memberships'::regclass and l.granted)",'synthetic lock released'))
    print('PASS: real finite lock timeout; companies DO committed, member DO rolled back; IDs/references retained')


def execute():
    selection()
    reset()
    run_sql(main_sql())
    print('PASS: actual first30 then complete6D;17 exact guards, catalogs, aggregates, source repeat and operational behavior')
    run_sql('drop database if exists gridex_governance_clean with (force);\ncreate database gridex_governance_clean;',ADMIN)
    clean_url = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_governance_clean'
    run_sql(prefix()+seed(),clean_url)
    for case in DIRTY:
        reset(template=True)
        setup,verify = dirty_sql(case)
        run_sql(setup)
        run_sql(source(),expected=('23514',f'check constraint "{case[2]}" of relation "{case[1]}" is violated by some row'))
        run_sql(verify)
        print(f'PASS: dirty {case[0]}, exact23514, unwrapped statement boundary and retained dirty rows')
    reset(template=True)
    setup,verify = late_failure()
    run_sql(setup)
    run_sql(source(),expected=('42703','column bu.readiness_status does not exist'))
    run_sql(verify)
    print('PASS: late required-view-column failure leaves earlier journal/guards committed')
    contention()
    for case in REDUCED:
        reset()
        run_sql(reduced_sql(case))
        print(f'PASS: REDUCED {case}; not complete-prefix evidence')
    reset()
    run_sql(bootstrap()+"create table companies(id uuid primary key,status text,updated_at timestamptz); create table tenant_governance_events(id uuid,company_id uuid,created_at timestamptz);")
    run_sql(source(),expected=('42703','column "target_user_id" does not exist'))
    run_sql(check("to_regclass('companies_governance_status_idx') is not null and to_regclass('tenant_governance_events_company_created_idx') is not null and to_regclass('tenant_governance_events_target_user_created_idx') is null",'REDUCED incompatible existing journal fails at second index after first index commits'))
    print('PASS: REDUCED missing journal index column exact42703 and committed prior index')
    print('OPEN: final journal ACL/RLS/permissive+restrictive policies and runtime authorization; 6D2 and full parity/lifecycle are not certified')


def emit():
    print('-- NOT EXECUTED: main SQL and separately reset characterization sections; do not concatenate expected-failure sections into one success run.')
    print(main_sql())
    print('-- EACH FOLLOWING DIRTY CASE starts from a clean actual-prefix+seed clone; source is unwrapped ON_ERROR_STOP, not BEGIN/COMMIT.')
    for case in DIRTY:
        setup,verify = dirty_sql(case)
        print(f'-- CASE {case[0]} EXPECT23514 constraint={case[2]}\n{setup}\n{source()}\n-- NEW CONNECTION AFTER EXPECTED FAILURE\n{verify}')
    setup,verify = late_failure()
    print('-- CASE late_view EXPECT42703 bu.readiness_status\n'+setup+source()+'\n-- NEW CONNECTION AFTER EXPECTED FAILURE\n'+verify)
    print('-- CASE contention: actual-prefix clone; concurrent SHARE lock on company_memberships; finite400ms lock_timeout EXPECT55P03; companies unit committed/member unit rolled back. Python orchestrates genuine holder/release.')
    for case in REDUCED:
        print('-- RESET DISPOSABLE DATABASE\n'+reduced_sql(case))
    print('-- RESET REDUCED missing journal index column EXPECT42703 target_user_id\n'+bootstrap()+"create table companies(id uuid primary key,status text,updated_at timestamptz); create table tenant_governance_events(id uuid,company_id uuid,created_at timestamptz);\n"+source())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--selection-only',action='store_true',help='Verify real source/hash/order/accounting without psql')
    mode.add_argument('--emit',action='store_true',help='Emit SQL without execution; expected failures use distinct clean databases')
    args = parser.parse_args()
    if args.selection_only:
        selection()
        print('PASS: complete checksum-pinned 6D selected at entry31; early provenance preserved; SQL NOT EXECUTED')
    elif args.emit:
        emit()
    else:
        execute()
