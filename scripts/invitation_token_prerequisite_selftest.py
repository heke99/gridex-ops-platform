#!/usr/bin/env python3
"""Invitation token admission only. SQL is deferred unless explicitly executed."""
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
SOURCE = 'migrations/20260909123000_canonical_invitation_token_prerequisite.sql'
RUNTIME = 'migrations/20260906081839_canonical_company_invitation_runtime_reconstruction.sql'
BOUNDARY = 'bootstrap/20260527_company_memberships_role_key_foundation.sql'
WHOLE = [
    'migrations/20260519_customer_intake_contracts_tenant_hardening.sql',
    'migrations/20260519_final_saas_hardening.sql',
    'migrations/20260526_debug_step1_2f_customer_import_foundation.sql',
    'migrations/20260519_batch_6d2_runtime_governance_completion.sql',
]
DATABASE = 'gridex_invitation_token_fixture'
CLEAN = 'gridex_invitation_token_clean'
ADMIN = 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'
TARGET = f'postgresql://postgres:postgres@127.0.0.1:55440/{DATABASE}'
C1, C2 = ('21000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000002')
U1, U2 = ('11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002')
T1 = '81000000-0000-0000-0000-000000000001'
T2 = '81000000-0000-0000-0000-000000000002'


def read(path):
    return (ROOT / path).read_text()


def selection():
    order = json.loads(read('scripts/gridex-aud-003-foundation-order.json'))['foundation']
    additions = json.loads(read('scripts/gridex-aud-003-legacy-foundation.additions.json'))
    assert order[31:38] == ['migrations/20260519_operations_core_saas_sync.sql', SOURCE, *WHOLE, BOUNDARY], 'missing token and complete-source sequence before role foundation'
    assert len(order) == 97 and order.count(SOURCE) == additions['foundation'].count(SOURCE) == 1
    assert all(order.count(path) == additions['foundation'].count(path) == 1 for path in WHOLE)
    manifest = json.loads(read('scripts/migration-history-manifest.json'))
    assert manifest['files'][Path(SOURCE).name] == hashlib.sha256((ROOT / 'supabase' / SOURCE).read_bytes()).hexdigest()
    sql = read('supabase/' + SOURCE)
    locked_admission = sql.split('lock table public.company_invitations in access exclusive mode;', 1)[1].split('select attnum into id_number', 1)[0]
    assert "if to_regclass('public.company_invitations') is distinct from invitation_oid or not exists (" in locked_admission, 'relation admission must be authoritative under lock'
    for clause in ("oid=invitation_oid and relkind='r'", "relnamespace='public'::regnamespace and not relispartition", "or exists(select 1 from pg_inherits where inhrelid=invitation_oid or inhparent=invitation_oid)", "raise exception 'Invitation token prerequisite: relation' using errcode='23514'"):
        assert clause in locked_admission, 'complete relation shape must be revalidated under lock'
    return order[:32]


def source():
    return '-- TOKEN_SOURCE_BEGIN ' + SOURCE + '\n' + read('supabase/' + SOURCE)


def prefix():
    spec = importlib.util.spec_from_file_location('token_governance', ROOT / 'scripts/canonical-governance-selftest.py')
    gov = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gov)
    return gov.bootstrap() + '\n'.join('-- TOKEN_PREFIX_FILE_BEGIN ' + p + '\n' + read('supabase/' + p) for p in selection())


def seed():
    return f"""insert into auth.users(id) values ('{U1}'),('{U2}');
insert into companies(id,name,org_number) values ('{C1}','Token One','9111111111'),('{C2}','Token Two','9222222222');
insert into company_invitations(id,company_id,email,membership_role,status,invited_by,invitation_token,metadata) values
 ('71000000-0000-0000-0000-000000000001','{C1}','token-one@example.invalid','member','pending','{U1}','synthetic-legacy-one','{{"sentinel":1}}'),
 ('71000000-0000-0000-0000-000000000002','{C2}','token-two@example.invalid','viewer','accepted','{U2}','synthetic-legacy-two','{{"sentinel":2}}');
"""


def check(condition, label):
    return "select test_assert(" + condition + ", '" + label + "');\n"


def ready(expected):
    return check("(select attnotnull from pg_attribute where attrelid='public.company_invitations'::regclass and attname='token') is " + str(expected).lower(), 'catalog mandatory token readiness distinction')


def shape(nullable, default):
    return check("(select a.atttypid='uuid'::regtype and a.attnotnull=" + str(not nullable).lower() + " and coalesce(pg_get_expr(d.adbin,d.adrelid),'ABSENT')='" + default + "' from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.company_invitations'::regclass and a.attname='token')", 'exact token type nullability and admitted default') + ready(not nullable)


# These projections compare actual rows and catalog identities, not inferred counts.
def snapshot(exclude_token=False):
    attr_filter = " and a.attname <> 'token'" if exclude_token else ''
    row = "to_jsonb(t)-'token'" if exclude_token else 'to_jsonb(t)'
    return f"""select jsonb_build_object(
 'rows',(select jsonb_agg({row} order by id) from public.company_invitations t),
 'relation',(select jsonb_build_array(oid,relowner,relacl,relrowsecurity,relforcerowsecurity,relkind) from pg_class where oid='public.company_invitations'::regclass),
 'attributes',(select jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,d.oid,d.adbin::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.company_invitations'::regclass and a.attnum>0 and not a.attisdropped{attr_filter}),
 'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c where c.conrelid='public.company_invitations'::regclass or c.confrelid='public.company_invitations'::regclass),
 'indexes',(select jsonb_agg(to_jsonb(i) order by i.indexrelid) from pg_index i where i.indrelid='public.company_invitations'::regclass),
 'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p where p.polrelid='public.company_invitations'::regclass),
 'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t where t.tgrelid='public.company_invitations'::regclass));
"""


CASES = {
 'missing_relation': ('alter table company_invitations rename to original_invitations;', 'relation'),
 'wrong_relation': ('alter table company_invitations rename to original_invitations; create view company_invitations as select * from original_invitations;', 'relation'),
 'wrong_identity': ('alter table company_invitations rename column id to prior_id; alter table company_invitations add column id text;', 'identity'),
 'generated_type': ('alter table company_invitations add column token uuid generated always as (id) stored;', 'type'),
 'domain_type': ('create domain token_uuid as uuid; alter table company_invitations add column token token_uuid;', 'type'),
 'wrong_type': ('alter table company_invitations add column token text;', 'type'),
 'wrong_default': ("alter table company_invitations add column token uuid default '81000000-0000-0000-0000-000000000099';", 'default'),
 'custom_function': ('create function public.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$; alter table company_invitations add column token uuid default public.gen_random_uuid();', 'default'),
 'duplicate': (f"alter table company_invitations add column token uuid; update company_invitations set token='{T1}';", 'duplicates'),
 'name_table': ('create table public.company_invitations_token_key(id int);', 'index'),
 'wrong_owner': ('create unique index company_invitations_token_key on companies(id);', 'index'),
 'wrong_index': ('alter table company_invitations add column token uuid; create index company_invitations_token_key on company_invitations(token);', 'index'),
 'wrong_key': ('alter table company_invitations add column token uuid; create unique index company_invitations_token_key on company_invitations(id);', 'index'),
 'descending': ('alter table company_invitations add column token uuid; create unique index company_invitations_token_key on company_invitations(token desc);', 'index'),
 'nulls_first': ('alter table company_invitations add column token uuid; create unique index company_invitations_token_key on company_invitations(token nulls first);', 'index'),
 'nulls_not_distinct': ('alter table company_invitations add column token uuid; create unique index company_invitations_token_key on company_invitations(token) nulls not distinct;', 'index'),
 'include': ('alter table company_invitations add column token uuid; create unique index company_invitations_token_key on company_invitations(token) include(id);', 'index'),
 'partial': ('alter table company_invitations add column token uuid; create unique index company_invitations_token_key on company_invitations(token) where token is not null;', 'index'),
 'expression': ('alter table company_invitations add column token uuid; create unique index company_invitations_token_key on company_invitations((token::text));', 'index'),
 'deferred': ('alter table company_invitations add column token uuid; alter table company_invitations add constraint company_invitations_token_key unique(token) deferrable;', 'index'),
}


def environment():
    return {k: v for k, v in os.environ.items() if not k.startswith('PG')}


def run_sql(sql, url=TARGET, expected=None):
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql') as f:
        f.write("\\set VERBOSITY verbose\nset statement_timeout='30s';\n" + sql)
        f.flush()
        result = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', url, '-f', f.name], capture_output=True, text=True, env=environment(), timeout=90)
    if expected:
        state, message = expected
        assert result.returncode == 3 and f'ERROR:  {state}: {message}' in result.stderr, 'unexpected failure category: ' + message
        assert all(secret not in result.stderr for secret in (T1, T2, '81000000-0000-0000-0000-000000000099','synthetic-legacy-one','synthetic-legacy-two')), 'credential leaked in diagnostic'
    else:
        assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def reset():
    run_sql(f'drop database if exists {DATABASE} with (force); create database {DATABASE} template {CLEAN};', ADMIN)


def preserved(before, exclude_token=False):
    assert before == run_sql(snapshot(exclude_token)), 'rows or existing catalog identities changed'


def observe_lock(name, granted):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if run_sql("select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='" + name + "' and l.relation='public.company_invitations'::regclass and l.granted=" + str(granted).lower() + ");") == 't':
            return
        time.sleep(.05)
    raise AssertionError('real lock was not observed: ' + name)


def session(sql):
    p = subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1',TARGET,'-f','-'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=environment())
    p.stdin.write(sql + '\n')
    p.stdin.flush()
    return p


def release(p, command='rollback;'):
    out, err = p.communicate(command + '\n' if p.poll() is None else None, timeout=15)
    assert p.returncode == 0, err
    return out


def contention():
    reset()
    baseline = run_sql(snapshot())
    holder = session("set application_name='token_holder'; begin; set local idle_in_transaction_session_timeout='20s'; lock table company_invitations in share mode;")
    try:
        observe_lock('token_holder', True)
        started = time.monotonic()
        run_sql(source(), expected=('55P03','canceling statement due to lock timeout'))
        assert 4 <= time.monotonic() - started < 15, 'source must use finite actual 5s lock timeout'
    finally:
        release(holder)
    preserved(baseline)
    # A real writer is queued while the complete prerequisite holds its own lock.
    migration = session("set application_name='token_migrator';\n" + source().rsplit('commit;', 1)[0])
    writer = None
    try:
        observe_lock('token_migrator', True)
        writer = session("set application_name='token_writer'; set lock_timeout='10s';\n" + seed())
        observe_lock('token_writer', False)
        assert writer.poll() is None, 'writer passed admission lock before commit'
        release(migration, 'commit;')
        release(writer, '')
    finally:
        if migration.poll() is None:
            release(migration)
        if writer is not None and writer.poll() is None:
            release(writer)
    run_sql(shape(False, 'gen_random_uuid()') + check('(select count(*)=2 and bool_and(token is not null) from company_invitations)', 'concurrent writer receives future defaults only after empty admission commits'))
    # Reverse ordering: a writer that already holds its row-exclusive lock wins;
    # after its commit the prerequisite must see populated rows and mint nothing.
    reset()
    writer = session("set application_name='token_writer'; begin; set local idle_in_transaction_session_timeout='20s';\n" + seed())
    migration = None
    try:
        observe_lock('token_writer', True)
        migration = session("set application_name='token_migrator';\n" + source())
        observe_lock('token_migrator', False)
        release(writer, 'commit;')
        release(migration, '')
    finally:
        if writer.poll() is None:
            release(writer)
        if migration is not None and migration.poll() is None:
            release(migration)
    run_sql(shape(True, 'ABSENT') + check('(select count(*)=2 and bool_and(token is null) from company_invitations)', 'earlier writer commit forces populated compatibility without historical minting'))
    run_sql(check("not exists(select 1 from pg_stat_activity where application_name in ('token_holder','token_migrator','token_writer'))", 'all synthetic lock sessions released'))


def execute():
    selection()
    run_sql(f'drop database if exists {CLEAN} with (force); create database {CLEAN};', ADMIN)
    run_sql(prefix(), f'postgresql://postgres:postgres@127.0.0.1:55440/{CLEAN}')
    reset()
    before = run_sql(snapshot(True))
    run_sql(source() + shape(False,'gen_random_uuid()'))
    preserved(before, True)
    after = run_sql(snapshot())
    run_sql(source())
    preserved(after)
    for lane, setup, nullable, default in (
        ('existing_absent','',True,'ABSENT'),
        ('nullable_null','alter table company_invitations add column token uuid;',True,'ABSENT'),
        ('nullable_mixed',f"alter table company_invitations add column token uuid; update company_invitations set token='{T1}' where company_id='{C1}';",True,'ABSENT'),
        ('nonnull_no_default',f"alter table company_invitations add column token uuid; update company_invitations set token=case when company_id='{C1}' then '{T1}'::uuid else '{T2}'::uuid end; alter table company_invitations alter column token set not null;",False,'ABSENT'),
        ('nullable_all_nonnull',f"alter table company_invitations add column token uuid; update company_invitations set token=case when company_id='{C1}' then '{T1}'::uuid else '{T2}'::uuid end;",True,'ABSENT'),
        ('nonnull_default','alter table company_invitations add column token uuid not null default gen_random_uuid();',False,'gen_random_uuid()'),
        ('nullable_default','alter table company_invitations add column token uuid default gen_random_uuid(); update company_invitations set token=null;',True,'gen_random_uuid()'),
        ('exact_index','alter table company_invitations add column token uuid; create unique index company_invitations_token_key on company_invitations(token);',True,'ABSENT'),
    ):
        reset()
        run_sql(seed() + setup)
        before = run_sql(snapshot(lane == 'existing_absent'))
        run_sql(source() + shape(nullable, default))
        preserved(before, lane == 'existing_absent')
        after = run_sql(snapshot())
        run_sql(source())
        preserved(after)
        print('PASS: admission/preservation/repeat ' + lane)
        if nullable:
            # Complete later runtime only: explicitly not intervening replay or F.
            before_rows = run_sql("select jsonb_agg(jsonb_build_array(id,token) order by id) from company_invitations;")
            run_sql(read('supabase/' + RUNTIME) + shape(True, default))
            assert before_rows == run_sql("select jsonb_agg(jsonb_build_array(id,token) order by id) from company_invitations;"), 'later runtime changed historical tokens'
            runtime_after = run_sql(snapshot())
            run_sql(read('supabase/' + RUNTIME))
            preserved(runtime_after)
            print('PASS: separate complete later-runtime compatibility lane; final mandatory gate FAIL: ' + lane)
    for case, (setup, category) in CASES.items():
        reset()
        # Nulls-not-distinct requires an empty relation to create the dirty index.
        run_sql(('' if case == 'nulls_not_distinct' else seed()) + setup)
        catalog = snapshot().replace('public.company_invitations', 'public.original_invitations') if case == 'missing_relation' else snapshot()
        before = run_sql(catalog)
        run_sql(source(), expected=('23514','Invitation token prerequisite: ' + category))
        assert before == run_sql(catalog), 'dirty admission changed rows or catalogs: ' + case
        print('PASS: exact dirty failure/rollback ' + case)
    reset()
    before = run_sql(snapshot())
    run_sql(source().rsplit('commit;',1)[0] + "do $$begin raise exception 'forced token rollback' using errcode='P0001'; end$$;", expected=('P0001','forced token rollback'))
    preserved(before)
    contention()
    print('PASS: real finite lock contention and writer serialization; source first32/token33')
    print('OPEN: full replay, mandatory historical token reconciliation, acceptance/delivery/revocation runtime and parity')


def emit():
    print('-- SQL NOT EXECUTED. Reset lanes separately; Python orchestrates actual locks.')
    print(prefix())
    print(source())
    print(shape(False, 'gen_random_uuid()'))
    print('-- RESET: populated compatibility lane')
    print(seed() + source() + shape(True,'ABSENT'))
    print('-- SEPARATE COMPLETE LATER RUNTIME COMPATIBILITY; NOT INTERVENING FULL REPLAY')
    print(read('supabase/' + RUNTIME) + ready(False))
    for case, (setup, category) in CASES.items():
        print('-- RESET DIRTY ' + case + ': EXPECT 23514 Invitation token prerequisite: ' + category)
        print(setup + source())
    print('-- REAL CONCURRENCY: Python contention() uses observed pg_locks and deterministic release; no fake exception')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--selection-only', action='store_true')
    mode.add_argument('--emit', action='store_true')
    args = parser.parse_args()
    if args.selection_only:
        selection()
        print('PASS: token prerequisite entry33, actual first32 retained; SQL NOT EXECUTED')
    elif args.emit:
        emit()
    else:
        execute()
