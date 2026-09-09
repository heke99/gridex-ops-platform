"""Reduced identity-repair fixtures; invoked by the fixed SaaS PG17 command.

These are synthetic admission/atomicity tests, not parent-retention approval.
The caller supplies the existing harness read/reset/psql/assertion helpers.
"""
import os
import select
import subprocess

MIGRATION = 'migrations/20260909120200_canonical_role_permission_identity_reconstruction.sql'
OWNER_SOURCE = 'supabase/migrations/20260810185155_gridex_canonical_architecture_p0.sql'
R1 = '10000000-0000-0000-0000-000000000001'
R2 = '10000000-0000-0000-0000-000000000002'
P1 = '20000000-0000-0000-0000-000000000001'
P2 = '20000000-0000-0000-0000-000000000002'
UNKNOWN = '90000000-0000-0000-0000-000000000009'
TABLES = ('roles', 'permissions', 'role_permissions', 'user_roles', 'audit_logs', 'user_permission_overrides')
RELATIONS = ','.join(f"to_regclass('public.{table}')" for table in TABLES)
CATALOG = f"""select 'constraint' kind,to_jsonb(c) value from pg_constraint c where conrelid in ({RELATIONS})
union all select 'index',to_jsonb(i)||jsonb_build_object('definition',pg_get_indexdef(indexrelid)) from pg_index i where indrelid in ({RELATIONS})
union all select 'relation',jsonb_build_object('oid',oid,'name',relname,'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) from pg_class where oid in ({RELATIONS})
union all select 'policy',to_jsonb(p) from pg_policy p where polrelid in ({RELATIONS})
union all select 'trigger',to_jsonb(t) from pg_trigger t where tgrelid in ({RELATIONS})"""
CATALOG = "select * from (" + CATALOG + ") identity_catalog"
ATTRIBUTES = f"select attrelid,attnum,attname,atttypid,attnotnull,attgenerated,attidentity from pg_attribute where attrelid in ({RELATIONS}) and attnum>0 and not attisdropped"

# Each patch is explicit reduced fixture preparation, never migration behavior.
PATCHES = {
    'restrict_nullable': '',
    'restrict_matching': 'alter table role_permissions alter role_id set not null,alter permission_id set not null;',
    'cascade_nullable': '',
    'cascade_matching': 'alter table role_permissions alter role_id set not null,alter permission_id set not null;',
    'mixed_role_nullable': 'alter table role_permissions alter permission_id set not null;',
    'mixed_permission_nullable': 'alter table role_permissions alter role_id set not null;',
    'case_metadata': "update role_permissions set role_key='COMPANY_ADMIN',permission_key='READ';",
    'absent_keys': 'update role_permissions set role_key=null,permission_key=null;',
    'whitespace_keys': "update roles set key=' company_admin ' where id='%s'; update role_permissions set role_key=' company_admin ';" % R1,
    'key_only_assignment': "insert into user_roles(role,status) values ('company_admin','disabled');",
    'null_assignment_role': f"insert into user_roles(role_id,role) values ('{R1}',null); update role_permissions set role_key=null;",
    'empty_assignment_present_key': f"insert into user_roles(role_id,role) values ('{R1}','');",
    'null_role': 'update role_permissions set role_id=null;',
    'null_permission': 'update role_permissions set permission_id=null;',
    'key_only_grant': 'update role_permissions set role_id=null,permission_id=null;',
    'orphan_role': f"set session_replication_role=replica; update role_permissions set role_id='{UNKNOWN}'; set session_replication_role=origin;",
    'orphan_permission': f"set session_replication_role=replica; update role_permissions set permission_id='{UNKNOWN}'; set session_replication_role=origin;",
    'duplicate_pair': 'alter table role_permissions drop constraint role_permissions_role_id_permission_id_key; insert into role_permissions(role_id,permission_id) select role_id,permission_id from role_permissions;',
    'role_key_conflict': "update role_permissions set role_key='owner';",
    'permission_key_conflict': "update role_permissions set permission_key='write';",
    'empty_role_key': "update role_permissions set role_key='';",
    'empty_permission_key': "update role_permissions set permission_key='';",
    'duplicate_role_fold': "insert into roles(key,name) values ('COMPANY_ADMIN','Case duplicate');",
    'duplicate_permission_fold': "insert into permissions(key,name) values ('READ','Case duplicate');",
    'null_parent_role_key': f"update roles set key=null where id='{R1}';",
    'empty_parent_role_key': f"update roles set key='' where id='{R1}';",
    'null_parent_permission_key': f"update permissions set key=null where id='{P1}';",
    'empty_parent_permission_key': f"update permissions set key='' where id='{P1}';",
    'role_name_ambiguity': "insert into roles(key,name) values (null,'company_admin');",
    'whitespace_not_trimmed': "update role_permissions set role_key=' company_admin ';",
    'empty_assignment_absent_key': f"update role_permissions set role_key=null; insert into user_roles(role_id,role) values ('{R2}','');",
    'null_extended_empty': "update role_permissions set role_key=null; insert into user_roles(role) values ('');",
    'null_extended_null': 'update role_permissions set role_key=null; insert into user_roles(role) values (null);',
    'assignment_id_text_conflict': f"insert into user_roles(role_id,role) values ('{R2}','company_admin');",
    'disabled_conflict': f"insert into user_roles(role_id,role,status,is_active) values ('{R2}','company_admin','disabled',false);",
    'deny_conflict': f"update role_permissions set effect='deny'; insert into user_roles(role_id,role) values ('{R2}','company_admin');",
    'assignment_conflict_without_grants': f"insert into roles(key,name) values ('unused','Unused'); insert into user_roles(role_id,role) values ('{R2}','unused');",
    'missing_role_fk': 'alter table role_permissions drop constraint role_permissions_role_id_fkey;',
    'missing_permission_fk': 'alter table role_permissions drop constraint role_permissions_permission_id_fkey;',
    'fk_name_collision': 'alter table role_permissions drop constraint role_permissions_role_id_fkey; alter table role_permissions add constraint role_permissions_role_id_fkey check(role_id is not null);',
    'competing_fk': 'alter table role_permissions add constraint competing_role foreign key(role_id) references roles(id) on delete restrict;',
    'missing_pair_unique': 'alter table role_permissions drop constraint role_permissions_role_id_permission_id_key;',
    'missing_user_roles': 'drop table user_roles;',
    'missing_roles': 'drop table roles cascade;',
    'missing_permissions': 'drop table permissions cascade;',
    'missing_role_permissions': 'drop table role_permissions;',
    'missing_parent_pk': 'alter table role_permissions drop constraint role_permissions_role_id_fkey; alter table roles drop constraint roles_pkey; create unique index roles_id_only on roles(id); alter table role_permissions add constraint role_permissions_role_id_fkey foreign key(role_id) references roles(id) on delete restrict;',
    'wrong_uuid_type': 'alter table role_permissions drop constraint role_permissions_role_id_fkey; alter table role_permissions alter role_id type text using role_id::text;',
    'forced_rollback': """create function fail_identity_ddl() returns event_trigger language plpgsql as $$ begin
if exists(select 1 from pg_attribute where attrelid='role_permissions'::regclass and attname='role_id' and attnotnull)
 and exists(select 1 from pg_attribute where attrelid='role_permissions'::regclass and attname='permission_id' and not attnotnull)
then raise exception 'forced failure after first NOT NULL' using errcode='23514'; end if; end $$;
create event trigger fail_identity_ddl on ddl_command_end when tag in ('ALTER TABLE') execute function fail_identity_ddl();""",
    'lock_timeout': '',
    'owner_copy_clean': '',
    'owner_copy_nullable': 'update role_permissions set permission_id=null;',
}
for name, definition in {
    'wrong_delete': 'references roles(id) on delete set null',
    'wrong_update': 'references roles(id) on delete restrict on update cascade',
    'wrong_match': 'references roles(id) match full on delete restrict',
    'deferred_fk': 'references roles(id) on delete restrict deferrable initially deferred',
    'unvalidated_fk': 'references roles(id) on delete restrict not valid',
    'wrong_parent': 'references other_roles(id) on delete restrict',
    'wrong_schema': 'references other.roles(id) on delete restrict',
    'wrong_parent_column': 'references roles(other_id) on delete restrict',
    'wrong_join_column': 'references roles(id) on delete restrict',
}.items():
    extra = ''
    column = 'role_id'
    if name == 'wrong_parent':
        extra = 'create table other_roles as select * from roles; alter table other_roles add primary key(id);'
    elif name == 'wrong_schema':
        extra = 'create schema other; create table other.roles as select * from roles; alter table other.roles add primary key(id);'
    elif name == 'wrong_parent_column':
        extra = 'alter table roles add other_id uuid unique; update roles set other_id=id;'
    elif name == 'wrong_join_column':
        extra = 'alter table role_permissions add other_role_id uuid; update role_permissions set other_role_id=role_id;'
        column = 'other_role_id'
    PATCHES[name] = extra + f'alter table role_permissions drop constraint role_permissions_role_id_fkey; alter table role_permissions add constraint role_permissions_role_id_fkey foreign key({column}) {definition};'
SUCCESS = {'restrict_nullable','restrict_matching','cascade_nullable','cascade_matching','mixed_role_nullable','mixed_permission_nullable',
           'case_metadata','absent_keys','whitespace_keys','key_only_assignment','null_assignment_role',
           'empty_assignment_present_key','owner_copy_clean'}


def owner_copy(h):
    """Use the authentic single INSERT verbatim, not a reimplementation."""
    text = h.read(OWNER_SOURCE)
    start = text.index('insert into public.role_permissions(')
    end = text.index('\n  );', start) + len('\n  );')
    operation = text[start:end]
    assert 'existing.permission_id is not distinct from rp.permission_id' in operation
    return '-- AUTHENTIC OWNER COPY OPERATION BEGIN\n' + operation


def rows(case):
    union = ' union all '.join(f"select '{table}' relation,to_jsonb(t) value from public.{table} t"
        for table in TABLES if case != 'missing_' + table)
    return 'select * from (' + union + ') identity_rows'


def setup(h, case):
    role_action = 'cascade' if case in ('cascade_nullable','cascade_matching','mixed_role_nullable') else 'restrict'
    permission_action = 'cascade' if case in ('cascade_nullable','cascade_matching','mixed_permission_nullable') else 'restrict'
    sql = h.ASSERT + f"""
-- REDUCED IDENTITY CASE: {case}; not canonical-prefix or retention-policy evidence.
create table roles(id uuid primary key default gen_random_uuid(),key text unique,name text not null);
create table permissions(id uuid primary key default gen_random_uuid(),key text unique,name text not null);
create table role_permissions(id uuid primary key default gen_random_uuid(),role_id uuid references roles(id) on delete {role_action},role_key text,
 permission_id uuid references permissions(id) on delete {permission_action},permission_key text,effect text not null default 'allow',marker text default 'preserve');
alter table role_permissions add constraint role_permissions_role_id_permission_id_key unique(role_id,permission_id);
create index role_permissions_role_id_idx on role_permissions(role_id);
create index role_permissions_permission_id_idx on role_permissions(permission_id);
create table user_roles(id uuid primary key default gen_random_uuid(),role_id uuid,role text,status text default 'active',is_active boolean default true);
create table audit_logs(id uuid primary key default gen_random_uuid(),snapshot jsonb);
create table user_permission_overrides(id uuid primary key default gen_random_uuid(),permission_id uuid);
alter table role_permissions enable row level security;
create policy identity_sentinel on role_permissions using (true);
grant select on role_permissions to public;
insert into roles(id,key,name) values ('{R1}','company_admin','Company admin'),('{R2}','owner','Owner');
insert into permissions(id,key,name) values ('{P1}','read','Read'),('{P2}','write','Write');
insert into role_permissions(role_id,role_key,permission_id,permission_key) values ('{R1}','company_admin','{P1}','read');
insert into audit_logs(snapshot) values ('{{"history":"keep"}}');
""" + PATCHES[case]
    if case.startswith('owner_copy_'):
        sql += '\n' + owner_copy(h)
        expected = 'permission_id is null' if case == 'owner_copy_nullable' else f"permission_id='{P1}'"
        sql += f"\nselect test_assert((select count(*)=2 and bool_and({expected}) from role_permissions),'authentic owner copy preserves inherited reference state');\n"
        sql += owner_copy(h) + "\nselect test_assert((select count(*)=2 from role_permissions),'authentic owner copy repeat stable including NULL deduplication');\n"
    return sql + f'\ncreate table identity_saved_rows as {rows(case)};\ncreate table identity_saved_catalog as {CATALOG};\ncreate table identity_saved_attributes as {ATTRIBUTES};\n'


def required():
    return """select test_assert((select count(*)=2 and bool_and(attnotnull and atttypid='uuid'::regtype) from pg_attribute where attrelid='role_permissions'::regclass and attname in ('role_id','permission_id') and not attisdropped),'both required UUID grant references');
"""


def preservation(h, case, success):
    sql = h.equal('select * from identity_saved_rows', rows(case), 'identity preserves all rows')
    sql += h.equal('select * from identity_saved_catalog', CATALOG, 'identity preserves every FK action/OID index grant RLS trigger')
    expected = 'select * from identity_saved_attributes'
    if success:
        expected = "select attrelid,attnum,attname,atttypid,case when attrelid='role_permissions'::regclass and attname in ('role_id','permission_id') then true else attnotnull end,attgenerated,attidentity from identity_saved_attributes"
        sql += required() + h.unique_check()
    return sql + h.equal(expected, ATTRIBUTES, 'only required nullability changes; failure restores all attributes')


def expect_error(statement, code, label):
    return f"""do $$ begin
begin {statement}
exception when sqlstate '{code}' then return; end;
raise exception 'FAIL: {label}'; end $$;\n"""


def enforcement():
    # The authentic owner copy adds a second role with the same permission.
    # Probe one known unique pair, so a multirow UPDATE cannot mask an FK
    # rejection with a duplicate-pair error. Assert the target is not vacuous.
    target = f"role_id='{R1}' and permission_id='{P1}'"
    sql = f"select test_assert((select count(*)=1 from role_permissions where {target}),'one existing grant for identity enforcement probes');\n"
    for column in ('role_id','permission_id'):
        for value, code in [('null','23502'), (f"'{UNKNOWN}'",'23503')]:
            role = value if column == 'role_id' else f"'{R1}'"
            permission = value if column == 'permission_id' else f"'{P1}'"
            sql += expect_error(f'insert into role_permissions(role_id,permission_id) values ({role},{permission});',code,'mandatory valid ID insert')
            sql += expect_error(f'update role_permissions set {column}={value} where {target};',code,'mandatory valid ID update')
    sql += expect_error(f'insert into role_permissions(role_id,permission_id) select role_id,permission_id from role_permissions where {target};','23505','unique pair survives')
    # Roll back a valid ID-only insert; preserve initial fixture rows for repeat checks.
    sql += f"begin; insert into role_permissions(role_id,permission_id) values ('{R2}','{P2}'); select test_assert(exists(select 1 from role_permissions where role_id='{R2}' and permission_id='{P2}' and role_key is null and permission_key is null),'valid ID-only grant accepted'); rollback;\n"
    return sql


def lock_failure(h, database):
    """Hold a writer lock past the migration's real five-second timeout."""
    target = h.ADMIN.rsplit('/', 1)[0] + '/' + database
    holder = subprocess.Popen(['psql','-X','-q','-v','ON_ERROR_STOP=1',target], stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1,
        env={k:v for k,v in os.environ.items() if not k.startswith('PG')})
    try:
        holder.stdin.write('begin; lock table public.roles in row exclusive mode;\n\\echo IDENTITY_LOCK_HELD\n')
        holder.stdin.flush()
        assert select.select([holder.stdout],[],[],10)[0], 'holder lock readiness timed out'
        assert holder.stdout.readline().strip() == 'IDENTITY_LOCK_HELD', 'holder failed to acquire lock'
        h.psql(database, h.read('supabase/' + MIGRATION), '55P03')
    finally:
        if holder.poll() is None:
            holder.stdin.write('rollback;\n\\q\n')
            holder.stdin.flush()
        try:
            holder.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            holder.kill()
            holder.communicate()
    assert holder.returncode == 0, 'lock holder failed'


def emit(h):
    chunks = []
    for case in PATCHES:
        chunks += [setup(h,case), h.read('supabase/' + MIGRATION), preservation(h,case,case in SUCCESS)]
        if case in SUCCESS:
            chunks += [enforcement(), h.read('supabase/' + MIGRATION), preservation(h,case,True)]
    return '\n'.join(chunks)


def execute(h):
    for case in PATCHES:
        database = 'gridex_saas_identity_' + case
        h.reset(database)
        h.psql(database, setup(h,case))
        if case == 'lock_timeout':
            lock_failure(h,database)
        else:
            expected = None if case in SUCCESS else '42P01' if case in ('missing_user_roles','missing_roles','missing_permissions','missing_role_permissions') else '23514'
            if case == 'forced_rollback':
                expected = 'forced failure after first NOT NULL'
            h.psql(database, h.read('supabase/' + MIGRATION), expected)
        h.psql(database, preservation(h,case,case in SUCCESS))
        if case in SUCCESS:
            h.psql(database, enforcement())
            h.psql(database, h.read('supabase/' + MIGRATION))
            h.psql(database, preservation(h,case,True))
        else:
            if case == 'lock_timeout':
                lock_failure(h,database)
            else:
                h.psql(database, h.read('supabase/' + MIGRATION), expected)
            h.psql(database, preservation(h,case,False))
        print('PASS: reduced identity reconstruction ' + case, flush=True)
