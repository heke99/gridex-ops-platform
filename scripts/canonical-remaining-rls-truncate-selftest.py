#!/usr/bin/env python3
"""Owned PG17 fixture for 22 TRUNCATE revocations, never app/schema acceptance.

Source and artifact pins establish the real RLS-table scope. Synthetic deny-all
policies demonstrate the ACL boundary; real policies, Auth helpers and the full
application graph are not represented. No external database, SQL, artifact or target option is accepted.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('truncate_fixture_owner', ROOT / 'scripts/canonical-composite-customer-fk-selftest.py')
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
TABLES = ('customer_case_events',
 'customer_lifecycle_events',
 'customer_sync_events',
 'data_quality_findings',
 'ediel_agt_readiness',
 'ediel_test_customers',
 'ediel_test_expected_acks',
 'ediel_test_expected_values',
 'ediel_test_facilities',
 'ediel_test_field_values',
 'ediel_test_metering_points',
 'ediel_test_run_locks',
 'ediel_unlinked_test_messages',
 'gridex_archived_customer_registry_rows',
 'page_performance_budgets',
 'platform_session_revocations',
 'status_transition_rules',
 'tenant_email_domains',
 'tenant_email_sender_profiles',
 'tenant_governance_events',
 'white_label_platform_memberships',
 'white_label_platforms')
CANDIDATE = ROOT / 'scripts/sql/forward-candidates/restrict-remaining-rls-table-truncate.sql'
CANDIDATE_SHA = 'cf85df9d7339e5368ceac7567b720dfa26cc2bf51fe2cd0f19b79b3af7eaab2b'
SOURCE_PINS = {'20260519_customer_move_out_lifecycle.sql': 'cd2a6b782bf1a5571c0d77dc948440b55e076df01b8986c58e97d07c9ab239b8',
 '20260519_batch_6d2_runtime_governance_completion.sql': 'b7d9d48b9cd3093b5546b04225f9c6151b0f674d2ae73441d8086f51922de9ab',
 '20260520_batch_5_cases_audit_email_ux.sql': '0e26b35eef3fa863f149bf4c46be4018ff484d3d55c5434a64323fafde201775',
 '20260521_actor_testing_go_live_module.sql': '94e7fc8168c5d17925c61a4985a889db1dd8a823ce3477ded9fdbdab6cdc7c08',
 '20260531111600_system_readiness_foundation.sql': 'e6ef68b18ede5729da067ce59a86cfca0db083d9d54a35ae0ed3a6c0968b96f2',
 '20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql': '7f71410f8b9f498286226dae76a2bc8ab1073cb43e07442ed8b5e0eb5de869be',
 '20260602152000_ediel_operations_completion_hardening.sql': '9d9964b6226c9722fad0a185042a1455682f14d5011ee6415ebbfcc2b2cba01f',
 '20260611203000_launch_rls_suggestion_policy_completion.sql': '8a5fdae1e607b355c16b3e8d6042647609242b571e6f8a8ec0882498ad73a52b',
 '20260814162500_tenant_rls_lifecycle_hardening.sql': 'e2eee5be4e4c795380782248683bfd32b682a66b2e2882a1fd241c9acc7498b2'}
RELATION_HASHES = {'customer_case_events': 'b85866663607546887111ad3c69bb45f73911985192601b0078a5b6eac2eee9c',
 'customer_lifecycle_events': 'cef4217a0044fbcfbf2df3f5bf007e92329709ae14650a7c1d931b0863957cdc',
 'customer_sync_events': 'fe43d25942c75c4eb65179c531dad1b61d904f66357ced4702f0b641844b18fb',
 'data_quality_findings': '53b4b09eed2a86c9bc765d4651acd8fe51cc7ec274eeecfd4b81a9b121200ee7',
 'ediel_agt_readiness': 'f070d75e56c480cc26aeee297b6ab545744a391838de1745308387a296c829e3',
 'ediel_test_customers': '04beb00872154df136cadf612f530d561bd7ffc92949998e55a40afdf4df03c7',
 'ediel_test_expected_acks': '07da52dbd094ff6b55b0b6432f6da716fcefd8a6fbbd7d73064b06b125e164d4',
 'ediel_test_expected_values': 'b6a008de900ab3ea6d9cace327360017d76832ba4c4f5b8208a26297621942a8',
 'ediel_test_facilities': '193befe907368d71867ede3441b99d6ce0dbc37c654c1d2b78d71b14c9652fd7',
 'ediel_test_field_values': '305e7fab656ad33517173a5d24ea5da89ab0598c1396e912d5ad250cfd82be06',
 'ediel_test_metering_points': '682473668c6c4bd9541240eda5fa6d3150007130681f7d74d8ce43c89d16bde3',
 'ediel_test_run_locks': '69c3dc2492db0cbe96156ef3bbd14d8ac1b0cc2a30384b4ccf0756fe4e047827',
 'ediel_unlinked_test_messages': 'da86688098ba4afe9a513146fe481cae87bcbbb9de328123a32a838845a60a5a',
 'gridex_archived_customer_registry_rows': '0c26d4e350a7d10815ce529a71f5919bef0f45cf38514863cffe68250c8fd3c1',
 'page_performance_budgets': '5469c08c1800c8c805e390730672dff31a10dcfcea824b108fa359f978ffea84',
 'platform_session_revocations': '5f3fd254e580d2c7f1ee152e228c7a8ed09740c138cbadfe25271c79cc02ae58',
 'status_transition_rules': '7440c5e4b39d29ab15b3effbac36e6da0ece15b918dcd977ca5f2c9772ce49f7',
 'tenant_email_domains': '3330c746751e1833c14fabe3ee3b8d093b02f329f16303f686554041d952d9ac',
 'tenant_email_sender_profiles': '850aa403de5e893bcdfb40e761f21c9d735a3e59dcc5fd3fa238d649241160be',
 'tenant_governance_events': '1484e3f09d906df0439764d1ead9d5896e05b0e7471d0da007fdf473357c6942',
 'white_label_platform_memberships': 'ff688657f129e56fc610f75590158122239f7f62962dd866d89a4a668bb6a089',
 'white_label_platforms': '9d73954fd481208f534ab9fbcbf67f8dc86145580ec1eff50c158a1a077b6067'}
GRANT_HASHES = {'customer_case_events': '87856c54de7859fcad7659dba2e5668b5f95df710cb5957e4da527966ebcf4ce',
 'customer_lifecycle_events': '4a1fc2c7afb29217f028324e1390d88cb7ec338a22067587fba2fba43a2bb30e',
 'customer_sync_events': 'e128ed120e0da94a02da254c96433d034516b9564812b0cac926891e4c8a2847',
 'data_quality_findings': '35e5375bed4203bbba4b8d6537d1447f76cc771ebd5ea1275a99951ffbb555f8',
 'ediel_agt_readiness': 'fa4f48ffdd040511492df1ca7d5b58fdabdd370bf6b5b001bad2e758305983d0',
 'ediel_test_customers': '1f51d45cf1ae0fcd3b058d9793854df1222a3809868d1a81675f8e5a71905380',
 'ediel_test_expected_acks': '33b655656614ba29afacb0cb94309e459f76ddeb9f0e5595972a21c670b2b8dd',
 'ediel_test_expected_values': 'e3b8bc4d8229b97f8cf48859cb61ddb1c9a5d082d2cf66d0088e7a5eeeb63300',
 'ediel_test_facilities': '190b4bb2d8177a23eafb573e208ecbb0389211ab37f2797abbeb9150ba666d16',
 'ediel_test_field_values': '3ce707f377c03bfa60fd7ce826e31012a50d55ba5f2ff576508b8131355751f8',
 'ediel_test_metering_points': '924dc1a0c48c384b04d919287af88b35b5fcfe10b18a7d9572d52ae9561b752f',
 'ediel_test_run_locks': '41fdae5351e95cfc72b68022dc928fa128a2c458c8d5fbf3b4ff59a859ac5b40',
 'ediel_unlinked_test_messages': '037bd9d1689f42636dd477b6f60e58620c8c0f8fda2c7ac50c7d0b466e9af029',
 'gridex_archived_customer_registry_rows': '5c1171d604c6857fb7843d594d3463621110d5eeff21364655d43c5e631d7dd2',
 'page_performance_budgets': 'abbbaf8289e155d1fe1273e27c1a9a32e113ec5c6cd16cec3c2639db7ec3d9bd',
 'platform_session_revocations': '9dda8087e7fb1d94eb986f31f84b762497d83c5e7698f7b142f5a8f0d3264bd3',
 'status_transition_rules': '2322cd9a61bac0280eb24985efc4a786168bbe25c3f2f02c24db1d024da562e9',
 'tenant_email_domains': '3e458190e6fa640678761405d660168bdbc78161759ac274789af2a247083965',
 'tenant_email_sender_profiles': 'b11cb34781b1d478bb7c43b34bd0a69314de69d49dcc7de1c1ce80118da447ec',
 'tenant_governance_events': '5c03eba1d07d19dda6d4b4d03a175cf5c366c0e3b7aae8faba5604f37197d1ec',
 'white_label_platform_memberships': '94d89cc6f928e4d35e54550f28aa330d1ebd97411d302d53d841530927a923b9',
 'white_label_platforms': '7e7a9a6bc29e97a4d4fabc143a5192653ccad05d056c33977ed88ca727e601b8'}


def read_candidate(path=CANDIDATE):
    path = Path(path).absolute()
    if path.resolve() != path or not path.is_file():
        raise ValueError('EXACT_CANDIDATE_REQUIRED')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != CANDIDATE_SHA:
        raise ValueError('EXACT_CANDIDATE_REQUIRED')
    return data.decode('utf-8')


def selection():
    candidate = read_candidate()
    for name, digest in SOURCE_PINS.items():
        fixture.read_pinned(ROOT / 'supabase/migrations' / name, digest)
    for table in TABLES:
        row = dict(nspname='public', relname=table, relkind='r', relrowsecurity=True,
                   relforcerowsecurity=False, reloptions=[], view_definition=None, partition_key=None)
        grant = dict(nspname='public', relname=table, grantee='authenticated',
                     privilege_type='TRUNCATE', is_grantable=False)
        if fixture.sha(row) != RELATION_HASHES[table] or fixture.sha(grant) != GRANT_HASHES[table]:
            raise ValueError('EXACT_RETAINED_CATALOG_REQUIRED')
    return candidate


def verify_delta(before, after):
    expected = copy.deepcopy(before)
    expected['acl'] = [row for row in expected['acl'] if not (
        row[0] == 'public' and row[1] in TABLES and row[3] == 'authenticated' and row[4] == 'TRUNCATE')]
    if after != expected:
        raise ValueError('EXACT_TRUNCATE_DELTA_REQUIRED')


def state():
    catalog = json.loads(fixture.sql("""select jsonb_build_object(
      'relations',(select jsonb_agg(jsonb_build_array(c.oid,n.nspname,c.relname,c.relkind,c.relowner,
        c.relrowsecurity,c.relforcerowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','control')),
      'columns',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid
        where c.relnamespace in ('public'::regnamespace,'control'::regnamespace) and a.attnum>0),
      'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
      'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c
        where c.connamespace in ('public'::regnamespace,'control'::regnamespace)),
      'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where c.relnamespace in ('public'::regnamespace,'control'::regnamespace)),
      'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
        where p.pronamespace in ('public'::regnamespace,'control'::regnamespace)),
      'schemas',(select jsonb_agg(to_jsonb(n) order by n.oid) from pg_namespace n where n.nspname in ('public','control')),
      'defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d),
      'roles',(select jsonb_agg(to_jsonb(r) order by r.oid) from pg_roles r),
      'memberships',(select jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor) from pg_auth_members m));"""))
    acl = json.loads(fixture.sql("""select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,
      pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      a.privilege_type,a.is_grantable) order by n.nspname,c.relname,a.grantor,a.grantee,a.privilege_type),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where n.nspname in ('public','control') and c.relkind in ('r','v');"""))
    relations = json.loads(fixture.sql("""select jsonb_agg(jsonb_build_array(n.nspname,c.relname) order by n.nspname,c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','control') and c.relkind in ('r','v');"""))
    rows = {}
    for schema, table in relations:
        if not re.fullmatch('[a-z_]+', schema) or not re.fullmatch('[a-z_]+', table):
            raise ValueError('FIXTURE_IDENTIFIER_REQUIRED')
        rows[schema + '.' + table] = json.loads(fixture.sql(
            f"select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from {schema}.{table} t;"))
    return dict(catalog=catalog, acl=acl, rows=rows)


def actor():
    return 'begin; set local role authenticated; '


def verify_reads():
    for table in TABLES:
        if fixture.sql(actor() + f'select count(*)=0 from public.{table}; rollback;') != 't':
            raise ValueError('SYNTHETIC_DENY_ALL_REQUIRED')


def setup():
    fixture.sql('create schema control; grant usage on schema public,control to authenticated,service_role,anon;')
    for schema, table in [('public', t) for t in (*TABLES, 'outside_targets')] + [('control', 'customer_case_events')]:
        fixture.sql(f"""create table {schema}.{table}(id integer primary key,marker text);
          insert into {schema}.{table} values(1,'retained_a'),(2,'retained_b');
          alter table {schema}.{table} enable row level security;
          create policy synthetic_auth_deny on {schema}.{table} to authenticated using(false) with check(false);
          create policy synthetic_service_all on {schema}.{table} to service_role using(true) with check(true);
          grant all on table {schema}.{table} to authenticated,service_role;
          grant select on table {schema}.{table} to anon;
          grant select(marker) on {schema}.{table} to authenticated;
          comment on table {schema}.{table} is 'bounded synthetic fixture';""")


def verify_service():
    for table in TABLES:
        result = fixture.sql(f"""begin; set local role service_role;
          select count(*)=2 from public.{table};
          insert into public.{table} values(3,'service_probe');
          update public.{table} set marker='changed' where id=3;
          delete from public.{table} where id=3;
          truncate only public.{table}; select count(*)=0 from public.{table}; rollback;""")
        if result != 't\nt':
            raise ValueError('SERVICE_OPERATIONS_REQUIRED')


def rejected_shape(candidate, before_sql, after_sql):
    fixture.sql(before_sql)
    before = state()
    fixture.sql(candidate, expected='55000')
    if state() != before:
        raise ValueError('FAILED_CANDIDATE_MUST_BE_ATOMIC')
    fixture.sql(after_sql)


def run():
    if sys.argv[1:] not in ([], ['--selection-only']):
        raise ValueError('NO_EXTERNAL_TARGET_OR_ACCEPTANCE_OPTIONS')
    candidate = selection()
    if sys.argv[1:]:
        print(json.dumps(dict(scope='SELECTION_ONLY_NOT_SQL', candidateSha256=CANDIDATE_SHA, tables=22)))
        return
    if fixture.sql("select current_user='postgres' and current_setting('server_version_num')::int between 170000 and 179999", admin=True) != 't':
        raise ValueError('FIXED_PG17_REQUIRED')
    if fixture.sql(f"select count(*) from pg_database where datname='{fixture.DATABASE}'", admin=True) != '0':
        raise ValueError('PREEXISTING_DATABASE_REFUSED')
    if fixture.sql("select count(*)=2 and bool_and(not rolsuper and not rolbypassrls and not rolcanlogin) "
                   "from pg_roles where rolname in ('authenticated','service_role')", admin=True) != 't':
        raise ValueError('FIXED_NONBYPASS_ROLES_REQUIRED')
    # Even an existing INHERIT FALSE edge belongs to the caller, not this test.
    # Prove absence before later GRANT/finally-REVOKE can be used as a control.
    if fixture.sql("select not exists(select 1 from pg_auth_members "
                   "where roleid='service_role'::regrole and member='authenticated'::regrole)", admin=True) != 't':
        raise ValueError('PREEXISTING_FIXTURE_ROLE_MEMBERSHIP_REFUSED')
    with fixture.owned_database():
        setup()
        before = state()
        verify_reads()
        verify_service()
        for table in TABLES:
            # RED characterization: authenticated SELECT returns no rows, but the
            # historical grant permits deletion of both fixture rows.
            result = fixture.sql(actor() + f"select count(*)=0 from public.{table}; truncate only public.{table}; "
                                 f"reset role; select count(*)=0 from public.{table}; rollback;")
            if result != 't\nt' or state() != before:
                raise ValueError('ORIGINAL_TRUNCATE_BYPASS_AND_ROLLBACK_REQUIRED')
        last = TABLES[-1]
        rejected_shape(candidate, f'alter table public.{last} rename to missing_last;',
                       f'alter table public.missing_last rename to {last};')
        rejected_shape(candidate, f'alter table public.{last} rename to original_last; create view public.{last} as select * from public.original_last;',
                       f'drop view public.{last}; alter table public.original_last rename to {last};')
        rejected_shape(candidate, f'alter table public.{last} disable row level security;',
                       f'alter table public.{last} enable row level security;')
        rejected_shape(candidate, f'alter table public.{last} force row level security;',
                       f'alter table public.{last} no force row level security;')
        rejected_shape(candidate, f'alter table public.{last} owner to authenticated;',
                       f'alter table public.{last} owner to postgres; grant all on public.{last} to authenticated;')
        # This fails after earlier revocations, proving outer rollback rather than
        # just all-table preflight. Preserve PUBLIC and reject residual authority.
        rejected_shape(candidate, f'grant truncate on public.{last} to public;',
                       f'revoke truncate on public.{last} from public;')
        # Role inheritance must fail closed without revoking the supplying role.
        fixture.sql('grant service_role to authenticated;', admin=True)
        try:
            inherited = state()
            fixture.sql(candidate, expected='55000')
            if state() != inherited:
                raise ValueError('INHERITED_AUTHORITY_MUST_ROLL_BACK')
        finally:
            fixture.sql('revoke service_role from authenticated;', admin=True)
        before = state()
        fixture.sql(candidate)
        after = state()
        verify_delta(before, after)
        verify_reads()
        verify_service()
        for table in TABLES:
            fixture.sql(actor() + f'truncate only public.{table}; rollback;', expected='42501')
            if state() != after:
                raise ValueError('DENIED_TRUNCATE_MUST_PRESERVE_STATE')
        fixture.sql(candidate)
        if state() != after:
            raise ValueError('REPEAT_MUST_PRESERVE_STATE')
    print(json.dumps(dict(scope='LIMITED_PG17_REMAINING_RLS_TRUNCATE_FIXTURE', candidateSha256=CANDIDATE_SHA,
        originalTruncateBypassesRls=True, fixedSqlstate='42501', tables=22,
        syntheticDenyAllVerified=True, serviceOperationsVerified=True, exactAclDeltaVerified=True, rowsAndCatalogPreserved=True,
        shapeRejectionsVerified=True, atomicityVerified=True, repeatVerified=True, cleanupVerified=True,
        actualAuthHelpersVerified=False, applicationGraphVerified=False, schemaAccepted=False, productionModified=False)))


if __name__ == '__main__':
    try:
        run()
    except Exception:
        print('FAIL bounded remaining RLS TRUNCATE qualification; no raw SQL or data published', file=sys.stderr)
        raise SystemExit(1) from None
