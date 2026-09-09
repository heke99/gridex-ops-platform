#!/usr/bin/env python3
"""Verify the actual selected RBAC foundation prefix on fixed PostgreSQL 17."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
ADMIN = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'
DATABASE = 'gridex_rbac_prefix_fixture'
TARGET = f'postgresql://postgres:postgres@127.0.0.1:55440/{DATABASE}'
BOUNDARY = 'bootstrap/20260527_company_memberships_role_key_foundation.sql'
SOURCES = (
    'migrations/20260520_batch_6e_rbac_tenant_stats_whitelabel.sql',
    'migrations/20260520_batch_6e_fix_rbac_backfill_security.sql',
    'migrations/20260520_batch_6e_hard_platform_roles_only.sql',
)
FINAL = 'migrations/20260908120000_preserve_gridex_user_has_role_key.sql'
POLICY_TARGETS = (
    'audit_logs', 'customers', 'customer_contacts', 'customer_addresses',
    'customer_sites', 'metering_points', 'customer_authorization_documents',
    'customer_documents', 'powers_of_attorney', 'customer_contracts',
    'customer_contract_events', 'contract_offers', 'supplier_switch_requests',
    'supplier_switch_events', 'grid_owner_data_requests',
    'customer_operation_tasks', 'outbound_requests', 'ediel_messages',
    'ediel_message_events', 'ediel_actor_settings', 'ediel_route_profiles',
    'communication_routes', 'metering_values', 'billing_underlays',
    'partner_exports',
)
ABSENT_TARGETS = ('power_of_attorneys', 'meter_readings', 'files', 'attachments')


def read(relative):
    return (ROOT / relative).read_text()


def reduced_seed():
    """Reuse only the reviewed synthetic rows; schema comes from the real prefix."""
    path = ROOT / 'scripts/canonical-rbac-tenant-selftest.py'
    spec = importlib.util.spec_from_file_location('canonical_rbac_tenant_fixture', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sql = module.seed()
    invalid_company = "('20000000-0000-0000-0000-000000000002','Synthetic Two','2222222222','');"
    valid_company = "('20000000-0000-0000-0000-000000000002','Synthetic Two','2222222222','onboarding');"
    marker = 'create temporary table memberships_before as select * from company_memberships;'
    extra = """insert into user_roles(id,user_id,company_id,role_id,status,is_active) values
 ('70000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','active',false);
"""
    assert marker in sql and invalid_company in sql
    return sql.replace(invalid_company, valid_company).replace(marker, extra + marker)


def catalog_prerequisites():
    present = ','.join("'%s'" % name for name in POLICY_TARGETS)
    absent = ','.join("'%s'" % name for name in ABSENT_TARGETS)
    billing = ','.join("'%s'" % name for name in (
        'customers', 'customer_sites', 'metering_points', 'ediel_messages',
        'metering_values', 'customer_authorization_documents',
        'billing_underlays', 'partner_exports'))
    return f"""create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
select test_assert(current_setting('server_version_num')::int / 10000=17,'PostgreSQL 17');
select test_assert((select count(*)=25 from unnest(array[{present}]) name where to_regclass('public.' || name) is not null),'all 25 actual prefix policy targets exist');
select test_assert((select bool_and(exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=name and c.column_name='company_id')) from unnest(array[{present}]) name),'all 25 actual prefix policy targets have company_id');
select test_assert((select count(*)=8 from unnest(array[{billing}]) name where to_regclass('public.' || name) is not null),'all eight billing view domain tables exist');
select test_assert((select bool_and(to_regclass('public.' || name) is null) from unnest(array[{absent}]) name),'four source policy targets are genuinely absent at the selected boundary');
select test_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_profiles' and column_name='active_company_id'),'profile attribution prerequisite exists');
select test_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_memberships' and column_name='membership_role'),'membership role prerequisite exists');
select test_assert((select count(*)=14 from information_schema.columns where table_schema='public' and table_name='companies' and column_name in ('billing_contact_email','support_email','address_line_1','address_line_2','postal_code','city','country_code','ediel_id','actor_role','sender_sub_address','ediel_mailbox','operating_environment','branding','billing_settings')),'all company metadata columns exist');
select test_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='ediel_actor_settings' and column_name='company_id'),'Ediel actor company prerequisite exists');
select test_assert((select a.atttypid='timestamptz'::regtype and a.attgenerated='s' and not a.attnotnull and lower(pg_get_expr(d.adbin,d.adrelid))='least(email_confirmed_at, phone_confirmed_at)' from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='auth.users'::regclass and a.attname='confirmed_at'),'managed auth confirmed_at matches generated Supabase catalog semantics');
select test_assert((select count(*)=2 and bool_and(atttypid='timestamptz'::regtype and not attnotnull and attgenerated='') from pg_attribute where attrelid='auth.users'::regclass and attname in ('email_confirmed_at','phone_confirmed_at')),'managed auth confirmed_at operands are ordinary nullable timestamptz columns');
"""


def prefix_baseline():
    return """create temporary table rbac_prefix_baseline as
select
  (select count(*) from companies) as company_count,
  (select count(*) from companies where status in ('paused','suspended','archived','pending_deletion')) as company_blocked_count,
  (select count(*) from company_memberships) as membership_count,
  (select count(*) from company_memberships where status is distinct from 'active') as membership_blocked_count;
-- These are the only company fields intentionally normalized by the restored
-- originals; preserve every other field of the authentic prefix companies.
create temporary table prefix_companies_before as
select id, to_jsonb(c) - array['status','country_code','operating_environment'] as unrelated_fields
from companies c;
"""


def first_checks():
    present = ','.join("'%s'" % name for name in POLICY_TARGETS)
    absent = ','.join("'%s'" % name for name in ABSENT_TARGETS)
    indexes = ','.join("'%s_company_id_idx'" % name for name in POLICY_TARGETS)
    return f"""-- RBAC_POLICY_TARGETS_PRESENT=25
-- RBAC_POLICY_TARGETS_ABSENT=4: power_of_attorneys,meter_readings,files,attachments
select test_assert((select count(*)=100 from pg_policies where schemaname='public' and tablename in ({present}) and policyname ~ '_tenant_(select|insert|update|delete)$'),'four dynamic policies exist on each of 25 actual targets');
select test_assert((select bool_and(c.relrowsecurity) from pg_class c where c.oid = any(array[{present}]::regclass[])),'RLS enabled on all 25 actual targets');
select test_assert((select count(*)=25 from pg_indexes where schemaname='public' and indexname in ({indexes})),'company indexes exist on all 25 actual targets');
select test_assert((select bool_and(to_regclass('public.' || name) is null) from unnest(array[{absent}]) name),'absent policy targets remain absent');
select test_assert(to_regclass('public.company_billing_volume_overview') is not null,'billing view exists');
select test_assert((select reloptions @> array['security_invoker=true'] from pg_class where oid='company_billing_volume_overview'::regclass),'billing view uses source-defined invoker rights');
select test_assert((select string_agg(column_name || ':' || data_type,',' order by ordinal_position)='company_id:uuid,company_name:text,org_number:text,status:text,active_user_count:integer,customer_count:integer,site_count:integer,metering_point_count:integer,ediel_message_count:integer,metering_value_count:integer,authorization_count:integer,billing_underlay_count:integer,partner_export_count:integer,generated_at:timestamp with time zone' from information_schema.columns where table_schema='public' and table_name='company_billing_volume_overview'),'billing view full 14-column shape');
select test_assert((select row(active_user_count,customer_count,site_count,metering_point_count,ediel_message_count,metering_value_count,authorization_count,billing_underlay_count,partner_export_count)=row(2,1,1,1,1,1,1,1,1) from company_billing_volume_overview where company_id='20000000-0000-0000-0000-000000000001'),'company one exact billing effects');
select test_assert((select row(active_user_count,customer_count,site_count,metering_point_count,ediel_message_count,metering_value_count,authorization_count,billing_underlay_count,partner_export_count)=row(2,2,0,0,0,0,0,0,0) from company_billing_volume_overview where company_id='20000000-0000-0000-0000-000000000002'),'company two exact billing effects');
select test_assert((select status='onboarding' and country_code='SE' and operating_environment='test' from companies where id='20000000-0000-0000-0000-000000000002'),'constraint-valid company metadata normalized');
select test_assert((select count(*) from company_memberships)=(select b.membership_count + 7 from rbac_prefix_baseline b),'exactly two memberships backfilled beyond the real prefix baseline');
select test_assert((select count(*)=2 from company_memberships where metadata->>'backfill'='batch_6e_fix_user_profiles_active_company'),'both profile attribution branches execute');
select test_assert((select active_company_id='20000000-0000-0000-0000-000000000002' from user_profiles where id='10000000-0000-0000-0000-000000000003'),'active membership fills null profile company');
select test_assert((select active_company_id is null from user_profiles where id='10000000-0000-0000-0000-000000000006'),'suspended membership does not fill profile company');
select test_assert((select count(*)=1 from user_profiles up join user_profiles_before before on before.id=up.id where up.active_company_id is distinct from before.active_company_id),'only intended profile attribution changes');
select test_assert(not exists(select to_jsonb(up)-'active_company_id' from user_profiles up except select to_jsonb(before)-'active_company_id' from user_profiles_before before),'unrelated profile fields preserved');
select test_assert(not exists(select * from memberships_before except select * from company_memberships),'existing memberships preserved');
select test_assert(not exists(select * from user_roles_before except select * from user_roles),'existing user roles preserved');
select test_assert(not exists((select * from roles_before except select * from roles) union all (select * from roles except select * from roles_before)),'role reference data preserved exactly');
select test_assert(not exists((select * from permissions_before except select * from permissions) union all (select * from permissions except select * from permissions_before)),'permission reference data preserved exactly');
select test_assert((select count(*)=6 from user_roles),'only two missing company-admin roles added');
select test_assert((select count(*)=4 from role_permissions),'hard boundary removes only two platform-wide grants');
select test_assert((select count(*)=1 from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='company_admin' and p.key='customers.read'),'unrelated company permission preserved');
select test_assert((select string_agg(column_name || ':' || data_type,',' order by ordinal_position)='area:text,total_rows:bigint,blocked_rows:bigint' from information_schema.columns where table_schema='public' and table_name='gridex_rbac_tenant_audit_summary'),'RBAC audit view full shape');
select test_assert((select total_rows=b.company_count + 2 and blocked_rows=b.company_blocked_count from gridex_rbac_tenant_audit_summary cross join rbac_prefix_baseline b where area='companies'),'RBAC company audit effects derive from the real prefix baseline');
select test_assert((select total_rows=b.membership_count + 7 and blocked_rows=b.membership_blocked_count + 3 from gridex_rbac_tenant_audit_summary cross join rbac_prefix_baseline b where area='company_memberships'),'RBAC membership audit effects derive from the real prefix baseline');
select test_assert(not exists(select 1 from prefix_companies_before before left join companies c using (id) where c.id is null or before.unrelated_fields is distinct from to_jsonb(c) - array['status','country_code','operating_environment']),'authentic prefix company rows and unrelated fields are preserved');
select test_assert((select not (coalesce(reloptions,array[]::text[]) @> array['security_invoker=true']) from pg_class where oid='gridex_rbac_tenant_audit_summary'::regclass),'fix source leaves audit view for later invoker hardening');
create temporary table memberships_after_first as select * from company_memberships;
create temporary table user_roles_after_first as select * from user_roles;
create temporary table role_permissions_after_first as select * from role_permissions;
"""


def final_checks():
    return """select test_assert(not exists((select * from memberships_after_first except select * from company_memberships) union all (select * from company_memberships except select * from memberships_after_first)),'second replay preserves membership effects');
select test_assert(not exists((select * from user_roles_after_first except select * from user_roles) union all (select * from user_roles except select * from user_roles_after_first)),'second replay preserves user-role effects');
select test_assert(not exists((select * from role_permissions_after_first except select * from role_permissions) union all (select * from role_permissions except select * from role_permissions_after_first)),'second replay preserves permission effects');
select test_assert((select not prosecdef and provolatile='s' and proconfig @> array['search_path=public, auth, extensions'] from pg_proc where oid='gridex_user_has_role_key(text)'::regprocedure),'final helper preserves selected invoker and search-path hardening');
select test_assert(not has_function_privilege('anon','public.gridex_user_has_role_key(text)','execute') and has_function_privilege('authenticated','public.gridex_user_has_role_key(text)','execute') and has_function_privilege('service_role','public.gridex_user_has_role_key(text)','execute'),'final helper preserves selected execution grants');
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000005';
select test_assert(not gridex_user_has_role_key('company_admin'),'inactive role status is rejected after helper restoration');
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000002';
select test_assert(not gridex_user_has_role_key('company_admin'),'inactive role flag is rejected after helper restoration');
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000007';
select test_assert(gridex_user_has_role_key('platform_admin'),'active platform role remains accepted after helper restoration');
select test_assert(gridex_user_is_platform_admin(),'hard role-only platform helper remains effective');
"""


def main_sql():
    order = json.loads(read('scripts/gridex-aud-003-foundation-order.json'))['foundation']
    boundary = order.index(BOUNDARY)
    prefix = order[:boundary + 1]
    chunks = ['-- RBAC_MANAGED_BOOTSTRAP_BEGIN\n' + read('scripts/sql/gridex-supabase-compatible-bootstrap.sql')
              + '\n-- Apply the bootstrap database default to this already-open test session.\n'
                'set search_path = "$user", public, extensions;']
    chunks.extend(f'-- RBAC_PREFIX_FILE_BEGIN {relative}\n{read("supabase/" + relative)}' for relative in prefix)
    chunks.extend((catalog_prerequisites(), prefix_baseline(), reduced_seed()))
    for cycle in range(2):
        for relative in SOURCES:
            chunks.append(f'-- RBAC_SOURCE_FILE_BEGIN {relative}\n{read("supabase/" + relative)}')
            if cycle == 0 and relative == SOURCES[0]:
                chunks.append("update companies set status='onboarding',country_code='',operating_environment='test' where id='20000000-0000-0000-0000-000000000002';")
        if cycle == 0:
            chunks.append(first_checks())
    chunks.append(f'-- RBAC_FINAL_HELPER_BEGIN {FINAL}\n{read("supabase/" + FINAL)}')
    chunks.append(final_checks())
    return '\n'.join(chunks)


def clean_environment():
    return {key: value for key, value in os.environ.items() if not key.startswith('PG')}


def psql(url, sql):
    result = subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', url], input=sql,
                            text=True, capture_output=True, env=clean_environment())
    assert result.returncode == 0, result.stderr


def execute():
    psql(ADMIN, f'drop database if exists {DATABASE} with (force);\ncreate database {DATABASE};\n')
    psql(TARGET, main_sql())
    print('PASS: actual selected RBAC prefix, repeated sources and preserved final helper')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emit', action='store_true', help='Print composed SQL without database calls')
    args = parser.parse_args()
    print(main_sql()) if args.emit else execute()
