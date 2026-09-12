#!/usr/bin/env python3
"""Fixed localhost PG17 SaaS prefix, reference preservation and repair characterization."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
import role_permission_identity_selftest as identity
ROOT = Path(__file__).resolve().parents[1]
ADMIN = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'
SOURCE = 'migrations/20260519_saas_ui_tenant_admin.sql'
REPAIR = 'migrations/20260909120000_canonical_role_permission_uniqueness_reconstruction.sql'
INDEX_REPAIR = 'migrations/20260909120100_canonical_invitation_status_index_reconstruction.sql'
CLEANUP = 'migrations/20260520_batch_6e_hard_platform_roles_only.sql'
ASSERT = """create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
select test_assert(current_setting('server_version_num')::int / 10000=17,'PostgreSQL 17');
"""
TENANTS = ('companies', 'company_memberships', 'company_invitations')
ALLOWLIST = ('users.read','users.write','tenants.read','tenants.invite','customers.read','customers.write',
 'contracts.read','contracts.write','documents.read','documents.write','communication.read','communication.send',
 'cases.read','cases.write','switching.read','switching.write','metering.read','metering.write',
 'metering_points.read','metering_points.write','sites.read','sites.write','masterdata.read','masterdata.write',
 'billing_underlay.read','billing_underlay.export','partner_exports.read','partner_exports.write',
 'poa.read','poa.write','pricing.read','pricing.write','reports.read','audit.read')


def read(path):
    return (ROOT / path).read_text()


def source():
    return '-- SAAS_SOURCE_BEGIN\n' + read('supabase/' + SOURCE)


def bootstrap():
    return ('-- SAAS_MANAGED_BOOTSTRAP_BEGIN\n' + read('scripts/sql/gridex-supabase-compatible-bootstrap.sql')
            + '\nset search_path = "$user", public, extensions;\n' + ASSERT)


def equal(left, right, label):
    return f"select test_assert(not exists(({left} except all {right}) union all ({right} except all {left})),'{label}');\n"


def unique_check():
    return """select test_assert(exists(select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
join pg_class ic on ic.oid=i.indexrelid join pg_am am on am.oid=ic.relam
where c.conrelid='role_permissions'::regclass and c.conname='role_permissions_role_id_permission_id_key'
and c.contype='u' and c.convalidated and not c.condeferrable and not c.condeferred
and pg_get_constraintdef(c.oid)='UNIQUE (role_id, permission_id)'
and i.indisunique and i.indisvalid and i.indisready and i.indimmediate and not i.indnullsnotdistinct
and i.indnatts=2 and i.indnkeyatts=2 and i.indpred is null and i.indexprs is null and am.amname='btree'),
'exact immediate NULLS DISTINCT pair uniqueness and valid btree backing index');
"""


def catalogs():
    chunks = [unique_check()]
    indexes = {
        'companies_status_created_idx': ('companies', '(status, created_at DESC)'),
        'companies_org_number_idx': ('companies', '(org_number) WHERE (org_number IS NOT NULL)'),
        'company_memberships_user_status_idx': ('company_memberships', '(user_id, status)'),
        'company_memberships_company_status_idx': ('company_memberships', '(company_id, status)'),
        # Forward reconstruction resolves the authentic auth-template namesake collision.
        'company_invitations_company_status_idx': ('company_invitations', '(company_id, status, created_at DESC)'),
        'company_invitations_email_status_idx': ('company_invitations', '(lower(email), status)'),
        'user_profiles_active_company_idx': ('user_profiles', '(active_company_id)'),
    }
    for table in ('user_profiles','user_roles','user_permissions','audit_logs'):
        indexes[table + '_company_id_idx'] = (table, '(company_id)')
        chunks.append(f"select test_assert(exists(select 1 from pg_attribute where attrelid='{table}'::regclass and attname='company_id' and atttypid='uuid'::regtype and not attnotnull),'nullable UUID ownership {table}');")
    for name, (table, definition) in indexes.items():
        expected = f'CREATE INDEX {name} ON public.{table} USING btree {definition}'
        chunks.append(f"select test_assert((select indexdef='{expected}' from pg_indexes where schemaname='public' and indexname='{name}'),'source index definition {name}');")
    comments = ('SaaS tenant/company accounts for Gridex Energy Operations.',
                'Tenant-safe mapping between auth users and companies.',
                'Invitation journal for company admins and tenant users.')
    for table, comment in zip(TENANTS, comments):
        chunks.append(f"""select test_assert((select relrowsecurity and not relforcerowsecurity from pg_class where oid='{table}'::regclass),'source enables but does not force RLS {table}');
select test_assert((select cmd='ALL' and roles=array['public']::name[] and permissive='PERMISSIVE' and qual='(auth.role() = ''service_role''::text)' and with_check=qual from pg_policies where schemaname='public' and tablename='{table}' and policyname='{table}_service_role_all'),'exact source service policy {table}');
select test_assert(obj_description('{table}'::regclass,'pg_class')='{comment}','source table comment {table}');""")
    chunks.append("""select test_assert((select count(*)=2 and bool_and(confdeltype='n') from pg_constraint where conrelid='user_profiles'::regclass and confrelid='companies'::regclass and contype='f'),'profile active-company and ownership FKs SET NULL');
select test_assert(col_description('companies'::regclass,(select attnum from pg_attribute where attrelid='companies'::regclass and attname='status'))='Operational status for the tenant account: active, onboarding, suspended, archived.','source status comment');
select test_assert(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='industry'),'skipped CREATE does not add industry');
select test_assert(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_invitations' and column_name='token'),'skipped CREATE does not add UUID token');
select test_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_invitations' and column_name='invitation_token' and data_type='text'),'authentic text invitation token preserved');
select test_assert(exists(select 1 from pg_constraint where conrelid='company_memberships'::regclass and contype='f' and confrelid='companies'::regclass and confdeltype='r'),'membership company FK remains RESTRICT');
select test_assert(not exists(select 1 from pg_constraint where conrelid='company_memberships'::regclass and contype='f' and confrelid='auth.users'::regclass),'skipped CREATE adds no membership auth FK');
select test_assert((select count(*)=2 and bool_and(attnotnull) from pg_attribute where attrelid='role_permissions'::regclass and attname in ('role_id','permission_id')),'mandatory grant UUID references reconstructed');
select test_assert((select count(*)=2 and bool_and(confdeltype='r') from pg_constraint where conrelid='role_permissions'::regclass and contype='f'),'RESTRICT grant FKs preserved; live CASCADE parity remains open');
select test_assert(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='roles' and column_name='is_system'),'actual prefix uses is_system_role, not is_system');
select test_assert((select not is_system_role and scope='company' from roles where key='company_admin'),'authentic company role defaults preserved');
""")
    return '\n'.join(chunks)


def canonical_sql():
    order = json.loads(read('scripts/gridex-aud-003-foundation-order.json'))['foundation']
    stop = order.index(SOURCE)
    assert order[stop - 3:stop] == [REPAIR, INDEX_REPAIR, identity.MIGRATION]
    chunks = [bootstrap()]
    for path in order[:stop]:
        if path == identity.MIGRATION:
            chunks.append("create temporary table identity_prefix_fks as select oid,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='role_permissions'::regclass and contype='f';")
        chunks.append(f'-- SAAS_PREFIX_FILE_BEGIN {path}\n' + read('supabase/' + path))
    chunks += [identity.required(), equal('select * from identity_prefix_fks', "select oid,pg_get_constraintdef(oid) from pg_constraint where conrelid='role_permissions'::regclass and contype='f'", 'canonical identity repair preserves original FK actions and OIDs')]
    chunks.append("""-- CANONICAL ACTUAL SELECTED PREFIX: no synthetic prerequisite schema.
create temporary table constraints_before as select oid,conrelid,conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace;
create temporary table columns_before as select attrelid,attnum,attname,atttypid,attnotnull,attgenerated from pg_attribute where attrelid in ('companies'::regclass,'company_memberships'::regclass,'company_invitations'::regclass,'user_roles'::regclass,'user_permissions'::regclass,'audit_logs'::regclass) and attnum>0 and not attisdropped;
create temporary table policies_before as select * from pg_policies where schemaname='public';
select test_assert((select count(*)=0 from roles) and (select count(*)=0 from permissions) and (select count(*)=0 from role_permissions),'pristine actual reference baseline');
""")
    chunks += [source(), catalogs(), index_check()]
    chunks.append("""select test_assert(not exists(select * from constraints_before except all select oid,conrelid,conname,pg_get_constraintdef(oid) from pg_constraint),'all authentic constraints survive unchanged');
select test_assert(not exists(select oid,conrelid,conname,pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace and conrelid<>'user_profiles'::regclass except all select * from constraints_before where conrelid<>'user_profiles'::regclass),'SaaS adds no constraints to authentic existing ownership or tenant tables');
select test_assert(not exists(select * from policies_before where policyname not in ('companies_service_role_all','company_memberships_service_role_all','company_invitations_service_role_all') except all select * from pg_policies),'unrelated policies survive');
select test_assert((select count(*)=1 from roles) and (select count(*)=3 from permissions) and (select count(*)=2 from role_permissions),'pristine first source exact counts');
select test_assert((select array_agg(p.key order by p.key)=array['tenants.invite','tenants.read'] from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='company_admin'),'exact pristine grants exclude tenants.write');
create temporary table grants_first as select * from role_permissions;
create temporary table roles_first as select * from roles;
create temporary table permissions_first as select * from permissions;
""")
    chunks.append(equal('select * from columns_before', "select attrelid,attnum,attname,atttypid,attnotnull,attgenerated from pg_attribute where attrelid in ('companies'::regclass,'company_memberships'::regclass,'company_invitations'::regclass,'user_roles'::regclass,'user_permissions'::regclass,'audit_logs'::regclass) and attnum>0 and not attisdropped", 'all skipped CREATE and existing ownership column shapes preserved'))
    chunks += [source(), catalogs(), equal('select * from grants_first', 'select * from role_permissions', 'canonical second SaaS exact grant multiset stable'), equal('select * from roles_first', 'select * from roles', 'canonical second SaaS role rows stable'), equal('select * from permissions_first', 'select * from permissions', 'canonical second SaaS permission rows stable')]
    chunks.append("""-- Existing-key sentinels preserve identities and every unrelated attribute.
update roles set name='sentinel',description='sentinel',scope='sentinel_scope',is_active=false,created_at='2001-01-01Z',updated_at='2001-01-02Z' where key='company_admin';
update permissions set name='sentinel',description='sentinel',category='sentinel_category',is_active=false,created_at='2001-01-01Z';
insert into roles(key,name) values ('admin','Legacy admin'),('super_admin','Super admin');
insert into permissions(key,name) values ('customers.read','Customer read'),('unrelated.keep','Keep');
insert into role_permissions(role_id,permission_id,effect) select r.id,p.id,'deny' from roles r cross join permissions p where r.key='admin' and p.key='unrelated.keep';
create temporary table sentinel_roles as select to_jsonb(r)-array['name','description'] fields from roles r;
create temporary table sentinel_permissions as select to_jsonb(p)-array['name','description'] fields from permissions p;
create temporary table grants_seeded as select * from role_permissions;
""")
    allowed = ','.join("'%s'" % k for k in ALLOWLIST)
    chunks.append(f"""create temporary table expected_pairs as select role_id,permission_id from grants_seeded union
select r.id,p.id from roles r cross join permissions p where (r.key='company_admin' and p.key in ({allowed})) or (r.key in ('admin','super_admin') and p.key in ('tenants.read','tenants.write','tenants.invite'));
""")
    chunks += [source(), equal('select * from sentinel_roles', "select to_jsonb(r)-array['name','description'] from roles r", 'sentinel role IDs and unrelated fields preserved'), equal('select * from sentinel_permissions', "select to_jsonb(p)-array['name','description'] from permissions p", 'sentinel permission IDs and unrelated fields preserved'), equal('select * from expected_pairs', 'select role_id,permission_id from role_permissions', 'allowlist intersection and legacy role grants exact')]
    chunks.append("""select test_assert(not exists(select * from grants_seeded except all select * from role_permissions),'all existing grant records preserved unchanged');
select test_assert((select name='Company admin' and description='Bolagsansvarig som administrerar användare och dagliga flöden inom sitt bolag.' from roles where key='company_admin'),'role intended upsert fields restored');
select test_assert((select count(*)=10 from role_permissions),'two baseline plus unrelated sentinel plus seven intended new grants');
""")
    for key, name, description in [('tenants.read','Läsa företag','Kan se bolagskonton och tenant-kopplingar.'),('tenants.write','Skapa eller ändra företag','Kan skapa och uppdatera bolagskonton i plattformen.'),('tenants.invite','Bjuda in till företag','Kan bjuda in användare till ett bolag och sätta bolagsroll.')]:
        chunks.append(f"select test_assert((select name='{name}' and description='{description}' from permissions where key='{key}'),'exact Swedish upsert {key}');")
    chunks.append('create temporary table before_cleanup as select * from role_permissions;')
    chunks += [source(), equal('select * from before_cleanup', 'select * from role_permissions', 'seeded source repeat exact stable multiset')]
    chunks.append('-- SAAS_REAL_HARD_PLATFORM_CLEANUP\n' + read('supabase/' + CLEANUP))
    chunks += [equal("select b.* from before_cleanup b join roles r on r.id=b.role_id join permissions p on p.id=b.permission_id where not (r.key not in ('super_admin','superadmin','platform_admin') and p.key in ('tenants.write','permissions.manage','roles.manage'))", 'select * from role_permissions', 'real cleanup removes only forbidden legacy admin grant'), "select test_assert((select count(*)=9 from role_permissions),'final grants after one exact cleanup removal');"]
    return '\n'.join(chunks)


def branch_sql(case):
    chunks = [bootstrap(), f'-- REDUCED BRANCH ONLY: {case}; not canonical-prefix evidence.']
    if case == 'legacy_index_collision':
        chunks.append("create table company_invitations(id uuid primary key default gen_random_uuid(),company_id uuid,email text,status text,created_at timestamptz); create index company_invitations_company_status_idx on company_invitations(company_id,status);")
        chunks.append(source())
        chunks.append("select test_assert(pg_get_indexdef('company_invitations_company_status_idx'::regclass)='CREATE INDEX company_invitations_company_status_idx ON public.company_invitations USING btree (company_id, status)','REDUCED source namesake collision preserves known legacy two-column index');")
        return '\n'.join(chunks)
    if case != 'missing_guarded':
        if case != 'permissions_only':
            system = ',is_system boolean default false' if case == 'is_system_present' else ''
            chunks.append(f"create table roles(id uuid primary key default gen_random_uuid(),key text unique,name text,description text,marker text default 'keep'{system}); insert into roles(key,name,description) values ('company_admin','sentinel','sentinel');")
        if case != 'roles_only':
            chunks.append("create table permissions(id uuid primary key default gen_random_uuid(),key text unique,name text,description text);")
        if case not in ('roles_only','permissions_only','missing_role_permissions'):
            chunks.append('create table role_permissions(id uuid primary key default gen_random_uuid(),role_id uuid references roles(id),permission_id uuid references permissions(id));')
            if case != 'legacy_missing_unique':
                chunks.append(read('supabase/' + REPAIR))
        if case in ('is_system_present','is_system_absent'):
            for table in ('user_profiles','user_roles','user_permissions','audit_logs'):
                chunks.append(f'create table {table}(id uuid primary key default gen_random_uuid());')
    chunks.append(source())
    if case in ('missing_guarded','roles_only','permissions_only','missing_role_permissions'):
        absent = {'missing_guarded': ('user_profiles','user_roles','user_permissions','audit_logs','roles','permissions','role_permissions'), 'roles_only': ('permissions','role_permissions'), 'permissions_only': ('roles','role_permissions'), 'missing_role_permissions': ('role_permissions',)}[case]
        for table in absent:
            chunks.append(f"select test_assert(to_regclass('public.{table}') is null,'guard leaves missing {table} absent');")
    else:
        chunks.append('create temporary table branch_first as select * from role_permissions;')
        chunks.append(source())
        if case == 'legacy_missing_unique':
            chunks.append("select test_assert((select count(*)=4 from role_permissions) and (select count(distinct (role_id,permission_id))=2 from role_permissions),'REDUCED legacy missing prerequisite repeats exactly two duplicate pairs');")
        else:
            chunks.append(equal('select * from branch_first','select * from role_permissions','reduced repaired repeat stable'))
            chunks.append("select test_assert((select marker='keep' and name='Company admin' from roles where key='company_admin'),'reduced existing role sentinel preserved');")
            if case == 'is_system_present':
                chunks.append("select test_assert((select is_system from roles where key='company_admin'),'is_system upsert branch true');")
            else:
                chunks.append("select test_assert(not exists(select 1 from information_schema.columns where table_name='roles' and column_name='is_system'),'is_system absent branch stays absent');")
            for table in ('user_profiles','user_roles','user_permissions','audit_logs'):
                chunks.append(f"select test_assert(exists(select 1 from pg_constraint where conrelid='{table}'::regclass and contype='f' and confrelid='companies'::regclass and confdeltype='n'),'new ownership FK SET NULL {table}');")
                chunks.append(f"select test_assert(to_regclass('public.{table}_company_id_idx') is not null,'new ownership index {table}');")
    return '\n'.join(chunks)


BRANCHES = ('is_system_present','is_system_absent','missing_guarded','roles_only','permissions_only','missing_role_permissions','legacy_missing_unique','legacy_index_collision')
REPAIRS = ('missing','matching','dirty','conflicting','conflicting_index')


def repair_setup(case):
    sql = ASSERT + """create table role_permissions(id uuid primary key default gen_random_uuid(),role_id uuid,permission_id uuid,marker text);
insert into role_permissions(role_id,permission_id,marker) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','keep'),(null,null,'null one'),(null,null,'null two');
"""
    if case == 'matching':
        sql += 'alter table role_permissions add constraint role_permissions_role_id_permission_id_key unique(role_id,permission_id);\n'
    elif case == 'dirty':
        sql += "insert into role_permissions(role_id,permission_id,marker) select role_id,permission_id,'duplicate keep' from role_permissions where role_id is not null;\n"
    elif case == 'conflicting':
        sql += 'alter table role_permissions add constraint role_permissions_role_id_permission_id_key unique(permission_id,role_id);\n'
    elif case == 'conflicting_index':
        sql += 'create index role_permissions_role_id_permission_id_key on role_permissions(role_id);\n'
    return sql + """create table saved_rows as select * from role_permissions;
create table saved_constraints as select oid,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='role_permissions'::regclass;
create table saved_indexes as select indexrelid,pg_get_indexdef(indexrelid) definition from pg_index where indrelid='role_permissions'::regclass;
"""


INDEX_CASES = ('missing','matching','legacy','conflicting','replacement_failure')


def index_setup(case):
    created = '' if case == 'replacement_failure' else ',created_at timestamptz'
    sql = ASSERT + f"""create table company_invitations(id uuid primary key default gen_random_uuid(),company_id uuid,status text{created});
insert into company_invitations(company_id,status) values ('10000000-0000-0000-0000-000000000001','pending'),(null,'accepted');
create index unrelated_invitation_status_idx on company_invitations(status);
"""
    if case in ('legacy','replacement_failure'):
        sql += 'create index company_invitations_company_status_idx on company_invitations(company_id,status);\n'
    elif case == 'matching':
        sql += 'create index company_invitations_company_status_idx on company_invitations(company_id,status,created_at DESC);\n'
    elif case == 'conflicting':
        sql += 'create index company_invitations_company_status_idx on company_invitations(status,company_id);\n'
    return sql + """create table saved_invitation_rows as select * from company_invitations;
create table saved_invitation_indexes as select indexrelid,pg_get_indexdef(indexrelid) definition from pg_index where indrelid='company_invitations'::regclass;
"""


def index_check():
    return """select test_assert(exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
where i.indexrelid='company_invitations_company_status_idx'::regclass and i.indrelid='company_invitations'::regclass
and am.amname='btree' and not i.indisunique and not i.indisprimary and i.indisvalid and i.indisready
and i.indnkeyatts=3 and i.indnatts=3 and i.indoption::text='0 0 3' and i.indexprs is null and i.indpred is null
and pg_get_indexdef(i.indexrelid)='CREATE INDEX company_invitations_company_status_idx ON public.company_invitations USING btree (company_id, status, created_at DESC)'),
'exact live/source invitation index including DESC default null ordering');
"""


def psql(database, sql, error=None):
    target = ADMIN if database is None else f'postgresql://postgres:postgres@127.0.0.1:55440/{database}'
    result = subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',target], input=sql,
        text=True,capture_output=True,env={k:v for k,v in os.environ.items() if not k.startswith('PG')})
    if error:
        assert result.returncode != 0 and error in result.stderr, result.stderr
    else:
        assert result.returncode == 0, result.stderr


def reset(database):
    assert database.startswith('gridex_saas_') and database.replace('_','').isalnum()
    psql(None, f'drop database if exists {database} with (force);\ncreate database {database};')


def execute():
    database = 'gridex_saas_prefix_fixture'
    reset(database)
    psql(database, canonical_sql())
    print('PASS: SaaS actual selected prefix, catalog effects, stable repeats and real platform cleanup', flush=True)
    for case in BRANCHES:
        database = 'gridex_saas_branch_' + case
        reset(database)
        psql(database, branch_sql(case))
        print('PASS: REDUCED SaaS branch ' + case, flush=True)
    for case in REPAIRS:
        database = 'gridex_saas_repair_' + case
        reset(database)
        psql(database, repair_setup(case))
        failure = case in ('dirty','conflicting','conflicting_index')
        psql(database, read('supabase/' + REPAIR), '23505' if case == 'dirty' else '23514' if failure else None)
        psql(database, equal('select * from saved_rows','select * from role_permissions','repair preserves every data row'))
        if failure:
            psql(database, equal('select * from saved_constraints',"select oid,pg_get_constraintdef(oid) from pg_constraint where conrelid='role_permissions'::regclass",'failed repair rolls back constraint catalog') + equal('select * from saved_indexes',"select indexrelid,pg_get_indexdef(indexrelid) from pg_index where indrelid='role_permissions'::regclass",'failed repair rolls back index catalog'))
        else:
            psql(database, unique_check() + 'create table constraint_after as select oid,conindid from pg_constraint where conrelid=\'role_permissions\'::regclass;')
            psql(database, read('supabase/' + REPAIR))
            psql(database, unique_check() + equal('select * from saved_rows','select * from role_permissions','repeat repair preserves every row') + equal('select * from constraint_after',"select oid,conindid from pg_constraint where conrelid='role_permissions'::regclass",'repeat repair retains constraint and backing index identities'))
            if case == 'matching':
                psql(database, equal('select * from saved_indexes',"select indexrelid,pg_get_indexdef(indexrelid) from pg_index where indrelid='role_permissions'::regclass",'matching repair preserves original indexes'))
        print('PASS: isolated uniqueness reconstruction ' + case, flush=True)
    for case in INDEX_CASES:
        database = 'gridex_saas_index_' + case
        reset(database)
        psql(database, index_setup(case))
        failure = case in ('conflicting','replacement_failure')
        psql(database, read('supabase/' + INDEX_REPAIR), '23514' if case == 'conflicting' else '42703' if failure else None)
        psql(database, equal('select * from saved_invitation_rows','select * from company_invitations','index reconstruction preserves every invitation row'))
        current = "select indexrelid,pg_get_indexdef(indexrelid) from pg_index where indrelid='company_invitations'::regclass"
        if failure:
            psql(database, equal('select * from saved_invitation_indexes',current,'failed index reconstruction rolls back every index including replaced legacy'))
        else:
            psql(database, index_check() + equal("select * from saved_invitation_indexes where definition not like 'CREATE INDEX company_invitations_company_status_idx %'",current + " and indexrelid<>'company_invitations_company_status_idx'::regclass",'unrelated indexes preserve identity and definition'))
            if case == 'matching':
                psql(database, equal('select * from saved_invitation_indexes',current,'matching index retains original identity'))
            psql(database, 'create table index_after as ' + current + ';')
            psql(database, read('supabase/' + INDEX_REPAIR))
            psql(database, index_check() + equal('select * from index_after',current,'repeated index reconstruction preserves identities') + equal('select * from saved_invitation_rows','select * from company_invitations','repeat index repair preserves rows'))
        print('PASS: isolated invitation index reconstruction ' + case, flush=True)
    identity.execute(sys.modules[__name__])



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emit',action='store_true',help='Emit all labeled SQL scenarios without database access')
    args = parser.parse_args()
    if args.emit:
        print(canonical_sql())
        for case in BRANCHES:
            print(branch_sql(case))
        for case in REPAIRS:
            print('-- REDUCED RECONSTRUCTION CASE: ' + case)
            print(repair_setup(case))
            print(read('supabase/' + REPAIR))
        for case in INDEX_CASES:
            print('-- REDUCED INDEX RECONSTRUCTION CASE: ' + case)
            print(index_setup(case))
            print(read('supabase/' + INDEX_REPAIR))
        print(identity.emit(sys.modules[__name__]))
    else:
        execute()
