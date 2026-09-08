#!/usr/bin/env python3
"""Characterize three complete historical RBAC sources on fixed local PG17."""
import argparse
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ADMIN = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'
DATABASE = 'gridex_rbac_group_fixture'
TARGET = f'postgresql://postgres:postgres@127.0.0.1:55440/{DATABASE}'
SOURCE_NAMES = (
    '20260520_batch_6e_rbac_tenant_stats_whitelabel.sql',
    '20260520_batch_6e_fix_rbac_backfill_security.sql',
    '20260520_batch_6e_hard_platform_roles_only.sql',
)
POLICY_TARGETS = (
    'audit_logs', 'customers', 'customer_contacts', 'customer_addresses',
    'customer_sites', 'metering_points', 'customer_authorization_documents',
    'customer_documents', 'power_of_attorneys', 'powers_of_attorney',
    'customer_contracts', 'customer_contract_events', 'contract_offers',
    'supplier_switch_requests', 'supplier_switch_events',
    'grid_owner_data_requests', 'customer_operation_tasks', 'outbound_requests',
    'ediel_messages', 'ediel_message_events', 'ediel_actor_settings',
    'ediel_route_profiles', 'communication_routes', 'metering_values',
    'meter_readings', 'billing_underlays', 'partner_exports', 'files', 'attachments',
)
PRESENT_TARGETS = (
    'customers', 'customer_sites', 'metering_points',
    'customer_authorization_documents', 'ediel_messages', 'metering_values',
    'billing_underlays', 'partner_exports',
)
ABSENT_TARGETS = tuple(name for name in POLICY_TARGETS if name not in PRESENT_TARGETS)


def read(relative):
    return (ROOT / relative).read_text()


def migration(name):
    return read('supabase/migrations/' + name)


def table(body, name):
    start = body.index('create table if not exists public.' + name + ' (')
    return body[start:body.index('\n);', start) + 4]


def statement(body, prefix):
    start = body.index(prefix)
    return body[start:body.index(';', start) + 1]


def function(body, schema, name):
    start = body.index('create or replace function ' + schema + '.' + name + '(')
    return body[start:body.index('\n$$;', start) + 4]


def source_policy_targets(predecessor):
    marker = 'target_tables text[] := array['
    start = predecessor.index(marker)
    end = predecessor.index('];', start)
    lines = (line.strip().strip("',") for line in predecessor[start:end].splitlines()[1:])
    return tuple(line for line in lines if line)


def prerequisites(include_partner_exports=True):
    core = migration('01_db1_schema_repair_core_helpers_and_canonical_tables.sql')
    operations = migration('02_db1_operations_ediel_billing_dedupe_and_storage.sql')
    auth_callback = migration('20260519_auth_callback_email_reset_sync.sql')
    saas = migration('20260519_final_saas_hardening.sql')
    bootstrap = read('scripts/sql/gridex-supabase-compatible-bootstrap.sql')
    sql = '''-- FIXTURE_REDUCED_PARENT_SCHEMA: auth.users is a synthetic managed-auth stand-in.
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
'''
    sql += function(bootstrap, 'auth', 'uid') + '\n'
    for name in ('gridex_normalize_email', 'gridex_normalize_phone',
                 'gridex_normalize_personal_number', 'gridex_normalize_org_number',
                 'gridex_normalize_facility_id', 'gridex_normalize_metering_point_id'):
        sql += function(core, 'public', name) + '\n'
    # Exact table definitions from selected foundation files 01/02 where possible.
    for name in ('companies',):
        sql += table(core, name) + '\n'
    sql += table(saas, 'company_memberships') + '\n'
    for name in ('roles', 'permissions', 'role_permissions', 'user_roles'):
        sql += table(core, name) + '\n'
    sql += table(auth_callback, 'user_profiles') + '\n'
    sql += '-- FIXTURE_REDUCED_USER_PROFILES: later auth-action columns and constraints are outside this RBAC fixture.\n'
    sql += statement(auth_callback, 'alter table public.user_profiles add column if not exists user_status') + '\n'
    sql += 'alter table public.user_profiles add column active_company_id uuid null references public.companies(id) on delete set null;\n'
    for name in ('customers', 'customer_sites', 'metering_points'):
        sql += table(core, name) + '\n'
    for name in ('customer_authorization_documents', 'metering_values',
                 'billing_underlays', 'ediel_messages'):
        sql += table(operations, name) + '\n'
    if include_partner_exports:
        sql += table(operations, 'partner_exports') + '\n'
    return sql


def seed():
    return '''select test_assert(current_setting('server_version_num')::int / 10000=17,'PostgreSQL 17');
insert into auth.users(id) values
 ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000003'),('10000000-0000-0000-0000-000000000004'),
 ('10000000-0000-0000-0000-000000000005'),('10000000-0000-0000-0000-000000000006'),
 ('10000000-0000-0000-0000-000000000007');
insert into companies(id,name,org_number,status) values
 ('20000000-0000-0000-0000-000000000001','Synthetic One','1111111111','active'),
 ('20000000-0000-0000-0000-000000000002','Synthetic Two','2222222222','');
insert into user_profiles(id,email,full_name,user_status,active_company_id) values
 ('10000000-0000-0000-0000-000000000001','a@example.invalid','A','active','20000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000002','b@example.invalid','B','disabled','20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000003','c@example.invalid','C','active',null),
 ('10000000-0000-0000-0000-000000000004','d@example.invalid','D','suspended','20000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000005','e@example.invalid','E','disabled','20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000006','f@example.invalid','F','suspended',null),
 ('10000000-0000-0000-0000-000000000007','platform@example.invalid','Platform','active',null);
insert into company_memberships(id,company_id,user_id,membership_role,status,accepted_at,invited_at,metadata) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner','active','2026-01-01Z','2025-12-01Z','{"fixture":"existing-a-one"}'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','member','suspended','2026-01-02Z','2025-12-02Z','{"fixture":"existing-a-two"}'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','member','active','2026-01-03Z','2025-12-03Z','{"fixture":"existing-c"}'),
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','admin','suspended','2026-01-04Z','2025-12-04Z','{"fixture":"existing-e"}'),
 ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','member','suspended','2026-01-05Z','2025-12-05Z','{"fixture":"existing-f"}');
insert into roles(id,key,name) values
 ('40000000-0000-0000-0000-000000000001','company_admin','Company admin'),
 ('40000000-0000-0000-0000-000000000002','member','Member'),
 ('40000000-0000-0000-0000-000000000003','platform_admin','Platform admin');
insert into permissions(id,key,name) values
 ('50000000-0000-0000-0000-000000000001','tenants.write','Tenant write'),
 ('50000000-0000-0000-0000-000000000002','permissions.manage','Permission manage'),
 ('50000000-0000-0000-0000-000000000003','roles.manage','Role manage'),
 ('50000000-0000-0000-0000-000000000004','customers.read','Customer read');
insert into role_permissions(id,role_id,permission_id) values
 ('60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001'),
 ('60000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000004'),
 ('60000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000003'),
 ('60000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001'),
 ('60000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000002'),
 ('60000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000003');
insert into user_roles(id,user_id,company_id,role_id,status) values
 ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','active'),
 ('70000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','inactive'),
 ('70000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000007',null,'40000000-0000-0000-0000-000000000003','active');
insert into customers(id,company_id,full_name) values
 ('80000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Customer One'),
 ('80000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Customer Two A'),
 ('80000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','Customer Two B');
insert into customer_sites(id,company_id,customer_id) values ('81000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001');
insert into metering_points(id,company_id,customer_id,site_id) values ('82000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001');
insert into customer_authorization_documents(id,company_id,customer_id) values ('83000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001');
insert into metering_values(id,company_id,value_kwh) values ('84000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1);
insert into billing_underlays(id,company_id,total_kwh) values ('85000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1);
insert into partner_exports(id,company_id,target_system) values ('86000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','synthetic');
insert into ediel_messages(id,company_id,direction,message_family) values ('87000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','outbound','UTILTS');
create temporary table memberships_before as select * from company_memberships;
create temporary table user_roles_before as select * from user_roles;
create temporary table user_profiles_before as select * from user_profiles;
create temporary table roles_before as select * from roles;
create temporary table permissions_before as select * from permissions;
'''


def first_application_checks():
    present = ','.join("'%s'" % name for name in PRESENT_TARGETS)
    absent = ','.join("'%s'" % name for name in ABSENT_TARGETS)
    return f'''-- FIXTURE_POLICY_TARGETS_PRESENT=8: {','.join(PRESENT_TARGETS)}
-- FIXTURE_POLICY_TARGETS_ABSENT=21: {','.join(ABSENT_TARGETS)}
select test_assert((select count(*)=32 from pg_policies where schemaname='public' and tablename in ({present}) and policyname ~ '_tenant_(select|insert|update|delete)$'),'all four dynamic policies on each of eight present targets');
select test_assert((select bool_and(c.relrowsecurity) from pg_class c where c.oid = any(array[{present}]::regclass[])),'RLS enabled on all eight present targets');
select test_assert((select count(*)=8 from pg_indexes where schemaname='public' and indexname in ({','.join("'%s_company_id_idx'" % n for n in PRESENT_TARGETS)})),'company indexes on all eight present targets');
select test_assert((select bool_and(to_regclass('public.' || name) is null) from unnest(array[{absent}]) name),'21 dynamic policy branches explicitly absent from reduced fixture');
select test_assert(to_regclass('public.company_billing_volume_overview') is not null,'billing view exists with all eight domain parents');
select test_assert((select reloptions @> array['security_invoker=true'] from pg_class where oid='company_billing_volume_overview'::regclass),'billing view uses invoker rights');
select test_assert((select string_agg(column_name || ':' || data_type,',' order by ordinal_position)='company_id:uuid,company_name:text,org_number:text,status:text,active_user_count:integer,customer_count:integer,site_count:integer,metering_point_count:integer,ediel_message_count:integer,metering_value_count:integer,authorization_count:integer,billing_underlay_count:integer,partner_export_count:integer,generated_at:timestamp with time zone' from information_schema.columns where table_schema='public' and table_name='company_billing_volume_overview'),'billing view full 14-column output shape');
select test_assert((select row(active_user_count,customer_count,site_count,metering_point_count,ediel_message_count,metering_value_count,authorization_count,billing_underlay_count,partner_export_count)=row(2,1,1,1,1,1,1,1,1) from company_billing_volume_overview where company_id='20000000-0000-0000-0000-000000000001'),'company one exact billing counts include historical disabled-profile membership backfill');
select test_assert((select row(active_user_count,customer_count,site_count,metering_point_count,ediel_message_count,metering_value_count,authorization_count,billing_underlay_count,partner_export_count)=row(2,2,0,0,0,0,0,0,0) from company_billing_volume_overview where company_id='20000000-0000-0000-0000-000000000002'),'company two exact billing counts');
select test_assert((select status='active' and country_code='SE' and operating_environment='test' from companies where id='20000000-0000-0000-0000-000000000002'),'successor normalizes blank status/country and invalid environment');
select test_assert((select count(*)=7 from company_memberships),'exactly two missing memberships backfilled');
select test_assert((select membership_role='admin' and status='active' and metadata->>'backfill'='batch_6e_fix_user_profiles_active_company' from company_memberships where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000002'),'disabled profile receives historical active admin membership: review required');
select test_assert((select membership_role='admin' and status='active' and metadata->>'backfill'='batch_6e_fix_user_profiles_active_company' from company_memberships where company_id='20000000-0000-0000-0000-000000000002' and user_id='10000000-0000-0000-0000-000000000004'),'suspended profile receives historical active admin membership: review required');
select test_assert((select active_company_id='20000000-0000-0000-0000-000000000002' from user_profiles where id='10000000-0000-0000-0000-000000000003'),'null active company derived from sole active membership');
select test_assert((select active_company_id is null from user_profiles where id='10000000-0000-0000-0000-000000000006'),'suspended membership does not fill null active company');
select test_assert((select count(*)=1 from user_profiles up join user_profiles_before before on before.id=up.id where up.active_company_id is distinct from before.active_company_id),'exactly one active-company attribution changes');
select test_assert(not exists(select to_jsonb(up)-'active_company_id' from user_profiles up except select to_jsonb(before)-'active_company_id' from user_profiles_before before),'profile identity, status and unrelated fields preserved');
select test_assert((select status='suspended' and membership_role='member' from company_memberships where id='30000000-0000-0000-0000-000000000002'),'second-company suspended membership preserved');
select test_assert((select status='suspended' and membership_role='admin' from company_memberships where id='30000000-0000-0000-0000-000000000004'),'existing disabled-user membership not reactivated');
select test_assert(not exists(select * from memberships_before except select * from company_memberships),'all five existing membership rows preserved exactly');
select test_assert(not exists(select * from user_roles_before except select * from user_roles),'all existing roles and unrelated identities preserved exactly');
select test_assert(not exists((select * from roles_before except select * from roles) union all (select * from roles except select * from roles_before)),'role identities preserved exactly');
select test_assert(not exists((select * from permissions_before except select * from permissions) union all (select * from permissions except select * from permissions_before)),'permission identities preserved exactly');
select test_assert((select count(*)=6 from user_roles),'three historical company_admin roles added');
select test_assert((select count(*)=3 from user_roles where role_id='40000000-0000-0000-0000-000000000001' and company_id is null and user_id in ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004')),'historical owner/admin backfill creates three unscoped roles: review required');
select test_assert((select string_agg(column_name || ':' || data_type,',' order by ordinal_position)='area:text,total_rows:bigint,blocked_rows:bigint' from information_schema.columns where table_schema='public' and table_name='gridex_rbac_tenant_audit_summary'),'RBAC audit view full output shape');
select test_assert((select array_agg(row(area,total_rows,blocked_rows)::text order by area)=array['(companies,2,0)','(company_memberships,7,3)'] from gridex_rbac_tenant_audit_summary),'RBAC audit view exact data effects');
select test_assert((select not (coalesce(reloptions,array[]::text[]) @> array['security_invoker=true']) from pg_class where oid='gridex_rbac_tenant_audit_summary'::regclass),'complete fix source leaves RBAC audit view without invoker option; later hardening required');
select test_assert((select count(*)=4 from role_permissions),'hard boundary deletes only two non-platform platform-wide grants');
select test_assert(not exists(select 1 from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key not in ('super_admin','superadmin','platform_admin') and p.key in ('tenants.write','permissions.manage','roles.manage')),'non-platform platform-wide grants removed');
select test_assert((select count(*)=3 from role_permissions rp join roles r on r.id=rp.role_id where r.key='platform_admin'),'platform grants preserved');
select test_assert((select count(*)=1 from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='company_admin' and p.key='customers.read'),'unrelated company permission preserved');
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
select test_assert(not gridex_user_is_platform_admin(),'company admin role is not platform admin after hard boundary');
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000007';
select test_assert(gridex_user_is_platform_admin(),'platform role remains platform admin');
select test_assert((select prosecdef and provolatile='s' and proconfig @> array['search_path=public, auth'] and prosrc like '%super_admin%' and prosrc like '%superadmin%' and prosrc like '%platform_admin%' and prosrc not like '%tenants.write%' from pg_proc where oid='gridex_user_is_platform_admin()'::regprocedure),'hard boundary catalog definition');
create temporary table memberships_after_first as select * from company_memberships;
create temporary table user_roles_after_first as select * from user_roles;
create temporary table role_permissions_after_first as select * from role_permissions;
'''


def second_application_checks():
    return '''select test_assert(not exists((select * from memberships_after_first except select * from company_memberships) union all (select * from company_memberships except select * from memberships_after_first)),'second application preserves exact membership effects');
select test_assert(not exists((select * from user_roles_after_first except select * from user_roles) union all (select * from user_roles except select * from user_roles_after_first)),'second application preserves exact role attribution');
select test_assert(not exists((select * from role_permissions_after_first except select * from role_permissions) union all (select * from role_permissions except select * from role_permissions_after_first)),'second application preserves hard-boundary permission effects');
select test_assert((select count(*)=32 from pg_policies where schemaname='public' and tablename = any(array['customers','customer_sites','metering_points','customer_authorization_documents','ediel_messages','metering_values','billing_underlays','partner_exports'])),'second application keeps exact dynamic policy count');
'''


def main_sql():
    predecessor, fix, hard = (migration(name) for name in SOURCE_NAMES)
    assert source_policy_targets(predecessor) == POLICY_TARGETS
    sql = prerequisites() + seed() + predecessor
    # Model legacy values after the predecessor separately; its CHECK rejects
    # them in the negative-order scenario exercised by the executable runner.
    sql += "\nalter table companies drop constraint companies_operating_environment_check;\n"
    sql += "update companies set status='',country_code='',operating_environment='legacy' where id='20000000-0000-0000-0000-000000000002';\n"
    sql += fix + hard + first_application_checks()
    sql += predecessor + fix + hard + second_application_checks()
    return sql


def incomplete_sql():
    predecessor = migration(SOURCE_NAMES[0])
    return (prerequisites(False) +
            "select test_assert(current_setting('server_version_num')::int / 10000=17,'PostgreSQL 17');\n" +
            "insert into companies(id,name,status) values ('20000000-0000-0000-0000-000000000001','Incomplete','active');\n" +
            predecessor + predecessor +
            "select test_assert(to_regclass('public.company_billing_volume_overview') is null,'incomplete eight-table prerequisite silently omits billing view after successful source execution');\n")


def invalid_setup_sql():
    core = migration('01_db1_schema_repair_core_helpers_and_canonical_tables.sql')
    sql = 'create extension if not exists pgcrypto;\n'
    sql += function(core, 'public', 'gridex_normalize_org_number') + '\n'
    sql += table(core, 'companies') + '\n'
    sql += "create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;\n"
    sql += "select test_assert(current_setting('server_version_num')::int / 10000=17,'PostgreSQL 17');\n"
    sql += "alter table companies add column operating_environment text;\n"
    sql += "insert into companies(id,name,status,operating_environment) values ('20000000-0000-0000-0000-000000000001','Invalid','active','legacy');\n"
    return sql


def clean_environment():
    return {key: value for key, value in os.environ.items() if not key.startswith('PG')}


def psql(url, sql, succeeds=True, errors=()):
    result = subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', url], input=sql,
                            text=True, capture_output=True, env=clean_environment())
    if succeeds:
        assert result.returncode == 0, result.stderr
    else:
        assert result.returncode != 0, 'negative scenario unexpectedly succeeded'
        for error in errors:
            assert error in result.stderr, result.stderr
    return result


def reset_database():
    psql(ADMIN, f'drop database if exists {DATABASE} with (force);\ncreate database {DATABASE};\n')


def execute():
    reset_database()
    psql(TARGET, incomplete_sql())
    print('PASS: incomplete domain prerequisites silently omit the billing view')

    reset_database()
    psql(TARGET, invalid_setup_sql())
    predecessor = migration(SOURCE_NAMES[0])
    psql(TARGET, 'begin;\n' + predecessor + '\ncommit;\n', False,
         ('companies_operating_environment_check', 'is violated by some row'))
    psql(TARGET, "select test_assert((select operating_environment='legacy' from companies) and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='billing_contact_email') and not exists (select 1 from pg_constraint where conrelid='companies'::regclass and conname='companies_operating_environment_check') and to_regclass('public.companies_ediel_id_idx') is null and to_regclass('public.companies_operating_environment_idx') is null,'failed predecessor transaction rolls back all observed catalog and data effects');")
    print('PASS: invalid predecessor environment CHECK rejects and rolls back its transaction')

    reset_database()
    psql(TARGET, main_sql())
    print('PASS: complete three-source RBAC characterization twice; not authorization or replay approval')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emit', action='store_true', help='Print composed SQL without database calls')
    args = parser.parse_args()
    if args.emit:
        print(main_sql())
    else:
        execute()
