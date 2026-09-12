#!/usr/bin/env python3
"""Verify the fixed auth/membership group runner and consolidated memory."""
from contextlib import redirect_stdout
import hashlib
import io
import importlib.util
import json
import os
import re
from collections import Counter
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / 'scripts/canonical-auth-membership-group.py'
RBAC_FIXTURE = ROOT / 'scripts/canonical-rbac-tenant-selftest.py'
RBAC_PREFIX_FIXTURE = ROOT / 'scripts/canonical-rbac-prefix-selftest.py'
COMMANDS = [
    ['python3', 'scripts/canonical-auth-email-selftest.py'],
    ['python3', 'scripts/canonical-poa-request-selftest.py', '--selection-only'],
    ['python3', 'scripts/canonical-poa-request-selftest.py'],
    ['python3', 'scripts/canonical-auth-invitation-chain-selftest.py', '--selection-only'],
    ['python3', 'scripts/canonical-auth-invitation-chain-selftest.py'],
    ['python3', 'scripts/canonical-membership-actor-fk-selftest.py'],
    ['python3', 'scripts/canonical-rbac-tenant-selftest.py'],
    ['python3', 'scripts/canonical-rbac-prefix-selection-selftest.py'],
    ['python3', 'scripts/canonical-rbac-prefix-selftest.py'],
    ['python3', 'scripts/canonical-saas-tenant-selftest.py'],
    ['python3', 'scripts/canonical-governance-selftest.py'],
    ['python3', 'scripts/canonical-operations-sync-selftest.py'],
    ['python3', 'scripts/invitation_token_prerequisite_selftest.py'],
    ['python3', 'scripts/canonical-import-admission-selftest.py'],
    ['python3', 'scripts/canonical-full-governance-source-selftest.py'],
    ['python3', 'scripts/canonical-auth-provisioning-diagnostics-selftest.py'],
    ['python3', 'scripts/canonical-auth-provisioning-legacy-selftest.py'],
    ['python3', 'scripts/canonical-user-rbac-repair-selftest.py'],
    ['python3', 'scripts/canonical-user-rbac-dedupe-selftest.py'],
]
HASHES = {
    'current-state.md': '404a2ee5d21f476e108c0efa17a3f45f9b2501db9f27fe3659378373dac08bf8',
    'current-task.md': 'c84e34eb0e8dfdc0a5e4d038d1c27a895e87c943c4c0ead78268e87a08afed7c',
    'handover.md': '3ac3c52211232f2647503faef5bc9ef78d19bd2bcd8e47be54927ecd5367c477',
    'open-blockers.md': 'e3250c981fc6a118b83072d8ae1e67c73b42dd3230a043adcadd38eab4d4cc55',
    'work-plan.md': 'cf5cc2137e7c6340abff3e434c8ba8d3313602c1cd038bdc4356dc55b1fa433a',
    'checkpoint.json': 'c486b10af659577c73b8ab42edd7591590be200126ef445022b84c8e69fcc19c',
}


def run(*args, cwd=ROOT, env=None):
    return subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True, check=False)


def nullable_token_fixture_regression(module):
    """Capture reduced-lane construction; these calls do not execute SQL."""
    task7 = module.load_script('canonical-import-admission-selftest.py')
    cases = task7.dirty_cases()
    observations = iter([cases[name][1] for name in ('wrong_default', 'version_type', 'wrong_check',
                        'wrong_index', 'foreign_collision', 'legacy_batch')] +
                        [{('legacy_batch_id_requires_mapping', '', 1)}])
    names = ('reset_database', 'psql_sql', 'source', 'catalog_fingerprint', 'task7_observation')
    original = {name: getattr(module, name) for name in names}
    calls = []
    try:
        module.reset_database = lambda **kwargs: calls.append(('reset', kwargs))
        module.psql_sql = lambda sql, **kwargs: calls.append(('sql', sql))
        module.source = lambda alias, **kwargs: calls.append(('source', alias))
        module.catalog_fingerprint = lambda: 'unchanged-static-sentinel'
        module.task7_observation = lambda _: next(observations)
        with redirect_stdout(io.StringIO()):
            module.reduced_compatibility_lanes()
    finally:
        for name, value in original.items():
            setattr(module, name, value)
    setup_index = next(i for i, call in enumerate(calls) if call[0] == 'sql' and 'legacy_null_invitation' in call[1])
    setup = calls[setup_index][1]
    assert 'alter table company_invitations alter column token drop not null;' in setup, 'nullable-token reduced fixture must explicitly relax its cloned column'
    assert setup.index('a.attnotnull') < setup.index('drop not null') < setup.index('set token=null')
    assert calls[setup_index - 1] == ('reset', {'template': module.PRE6D2_TEMPLATE})
    assert 'stage_f_nullable_token_rows' in setup
    assert calls[setup_index + 1] == ('source', 'F')
    preserved = calls[setup_index + 2][1]
    assert 'f_nullable_token: company_invitations exact IDs/rows/count retained' in preserved
    assert 'all prior table/view/index OIDs, owners, ACLs/options retained' in preserved
    assert "a.atttypid='uuid'::regtype and not a.attnotnull" in preserved
    assert "pg_get_expr(d.adbin,d.adrelid)='gen_random_uuid()'" in preserved
    future = calls[setup_index + 3][1]
    assert 'future-token@example.invalid' in future and 'i.token is null' in future
    assert 'token is not null' in future


def whole_correction_constructors():
    """Database-free regression of the four integrated SQL construction contracts."""
    spec = importlib.util.spec_from_file_location('task9', ROOT / 'scripts/canonical-full-governance-source-selftest.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    oracle = module.oracle
    nullable_token_fixture_regression(module)
    # Construct the actual fingerprint without a database; all catalog branches
    # and present-relation row queries must survive explicit text normalization.
    fingerprint_calls = []
    original_scalar = module.psql_scalar
    try:
        module.psql_scalar = lambda sql, **kwargs: (fingerprint_calls.append(sql) or 'fixture-value')
        module.catalog_fingerprint()
    finally:
        module.psql_scalar = original_scalar
    fingerprint = fingerprint_calls[0]
    for field in ('c.relkind', 'attidentity', 'attgenerated', 'polcmd', 'provolatile', 'tgenabled', 'tgattr'):
        assert '||' + field + '::text' in fingerprint, f'fingerprint must normalize {field} before concatenation'
    assert re.findall(r"select '([cakipft]):'", fingerprint) == list('cakipft')
    assert "md5(string_agg(v,'|' order by v))" in fingerprint
    row_queries = [sql for sql in fingerprint_calls[1:] if 'string_agg(to_jsonb(t)::text' in sql]
    assert len(row_queries) == 24
    assert all("'|' order by to_jsonb(t)::text" in sql for sql in row_queries)
    # 6E replaces customer policies, but its target list excludes both imports.
    downstream = module.downstream_checks_sql(True)
    for table in ('customer_import_batches', 'customer_import_rows'):
        for action, command, using, with_check in (
            ('select', 'r', "'gridex_can_read_company(company_id)'", 'null'),
            ('insert', 'a', 'null', "'gridex_can_write_company(company_id)'"),
            ('update', 'w', "'gridex_can_read_company(company_id)'", "'gridex_can_write_company(company_id)'"),
            ('delete', 'd', "'gridex_user_is_platform_admin()'", 'null')):
            assert f"('{table}','{action}','{command}',{using},{with_check})" in downstream, 'downstream imports must retain actual6D2 policies'
    assert "('customers','update','w','gridex_can_write_company(company_id)','gridex_can_write_company(company_id)')" in downstream
    assert 'p.polroles<>array[0]::oid[]' in downstream and 'not p.polpermissive' in downstream
    assert 'p.polcmd<>e.command' in downstream and 'p.oid is null' in downstream
    assert 'pg_get_expr(p.polqual,p.polrelid) is distinct from e.using_expression' in downstream
    assert 'pg_get_expr(p.polwithcheck,p.polrelid) is distinct from e.check_expression' in downstream
    assert 'downstream_import_policies_before' in downstream
    first_6e = (ROOT / 'supabase/migrations/20260520_batch_6e_rbac_tenant_stats_whitelabel.sql').read_text()
    target_list = re.search(r'target_tables text\[\] := array\[(.*?)\];', first_6e, re.S).group(1)
    assert "'customers'" in target_list
    assert "'customer_import_batches'" not in target_list and "'customer_import_rows'" not in target_list
    # en_US.utf8 orders customers before customer_sites, unlike Python/C.
    # The oracle must use the same explicit order as its literal expected array.
    debug = oracle.debug_view_sql()
    assert 'array_agg(table_name order by table_name collate "C")' in debug, 'debug names must use Python-compatible C collation'
    expected_debug_names = ("billing_export_run_items", "billing_export_runs", "companies", "company_memberships",
                            "customer_contracts", "customer_import_batches", "customer_import_rows",
                            "customer_portal_accounts", "customer_portal_claims", "customer_sites", "customers",
                            "ediel_inbound_cases", "ediel_messages", "metering_points", "user_roles")
    assert "=array[" + ",".join("'" + name + "'" for name in expected_debug_names) + "]::text[]" in debug
    assert "v.exists_in_db<>(to_regclass('public.'||v.table_name) is not null)" in debug
    assert "v.rls_enabled<>coalesce((select relrowsecurity from pg_class" in debug
    assert "v.check_status<>case when not v.exists_in_db then 'missing_table' when not v.rls_enabled and v.table_name<>'billing_export_runs' then 'review_rls' else 'ok' end" in debug
    # Actual first33 roles uses is_system_role; F deliberately takes its
    # no-is_system branch and updates only name/description.
    seed = oracle.six_pair_seed_sql()
    snapshot = oracle.f_seed_snapshot_sql()
    boundaries = oracle.f_seed_boundary_sql(False) + oracle.f_seed_boundary_sql(True) + oracle.f_seed_repeat_sql()
    assert 'insert into public.roles(id,key,name,description)\n' in seed, 'synthetic role must use actual prefix columns'
    assert 'select id,to_jsonb(r) value from public.roles r' in snapshot
    assert 'select id,to_jsonb(r) from roles r' in boundaries
    assert "to_jsonb(r)-array['name','description']::text[]" in boundaries
    assert "to_jsonb(b)-array['name','description']::text[]" in boundaries
    assert "attname='is_system'" in snapshot and "attname='is_system_role'" in snapshot
    assert 'name,description,is_system' not in seed + snapshot + boundaries
    assert 'and is_system from roles' not in boundaries
    assert "name='Bolagsansvarig' and description='Administrerar användare och dagliga flöden inom sitt eget elhandelsbolag.'" in boundaries
    # Capture the actual source invocation: PostgreSQL may display 120s as 2min.
    source_calls = []
    original_run = module.subprocess.run
    try:
        module.subprocess.run = lambda command, **kwargs: (source_calls.append(command) or subprocess.CompletedProcess(command, 0, '', ''))
        with redirect_stdout(io.StringIO()):
            for lock, statement in (('10s', '120s'), ('1s', '10s')):
                module.psql_file(module.contract.prefix()[0], lock_timeout=lock, statement_timeout=statement)
        assert len(source_calls) == 2
        for command, (lock, statement) in zip(source_calls, (('10s', '120s'), ('1s', '10s'))):
            checks = command[command.index('-c') + 3]
            assert command[command.index('-c') + 1] == f"set lock_timeout='{lock}'; set statement_timeout='{statement}';"
            assert "current_setting('lock_timeout')::interval" in checks, 'timeout equality must compare durations, not display text'
            assert f"current_setting('lock_timeout')::interval='{lock}'::interval" in checks
            assert f"current_setting('statement_timeout')::interval='{statement}'::interval" in checks
            assert checks.count("::interval>interval '0 seconds'") == 2
            assert command[-2:] == ['-f', str(ROOT / 'supabase' / module.contract.prefix()[0])]
    finally:
        module.subprocess.run = original_run
    # The same predicate constructs a hosted SQL truth table, never a Python
    # imitation of PostgreSQL interval parsing. This table is NOT EXECUTED locally.
    unit_regression = oracle.timeout_unit_regression_sql()
    for row in ("('2min','120s',true)", "('120000ms','120s',true)",
                "('1000ms','1s',true)", "('10000ms','10s',true)",
                "('1min','120s',false)", "('1ms','1s',false)",
                "('0','120s',false)", "('120s','0',false)", "('0','0',false)"):
        assert row in unit_regression, row
    assert 'actual::interval=expected::interval' in unit_regression
    assert "expected::interval>interval '0 seconds'" in unit_regression
    assert 'is distinct from accepted' in unit_regression
    # Restoring proacl IS NULL or dropping explicit client/owner/PUBLIC tuples must fail.
    acl_sql = oracle.f_function_postflight_sql() + oracle.governance_function_postflight_sql() + module.downstream_checks_sql(True)
    assert 'proacl is null' not in acl_sql.lower(), 'managed functions have explicit inherited ACLs'
    expected_acl = [['PUBLIC', 'EXECUTE', False, 'postgres'], ['anon', 'EXECUTE', False, 'postgres'],
                    ['authenticated', 'EXECUTE', False, 'postgres'], ['postgres', 'EXECUTE', False, 'postgres'],
                    ['service_role', 'EXECUTE', False, 'postgres']]
    assert json.dumps(expected_acl) in acl_sql
    assert acl_sql.count(json.dumps(expected_acl)) == 23  # F5, 6D2 eleven, downstream seven.
    assert "aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))" in acl_sql
    assert 'a.is_grantable' in acl_sql and 'a.grantor' in acl_sql
    assert 'b.oid<>p.oid or b.acl is distinct from' in acl_sql
    calls = []
    module.psql_sql = lambda sql, **k: calls.append(('sql', sql))
    module.psql_file = lambda path, **k: calls.append(('file', path, k))
    for alias in ('F', '6D2'):
        calls.clear()
        module.source(alias)
        assert len(calls) == 2 and calls[0][0] == 'sql' and calls[1][0] == 'file'
        assert 'insert into task9_function_acls_before' in calls[0][1]
        assert 'pg_get_function_identity_arguments(p.oid)' in calls[0][1]
        calls.clear()
        module.source(alias, expected='23514')
        assert len(calls) == 1 and calls[0][0] == 'file', 'native failure snapshots must stay untouched'
    calls.clear()
    with redirect_stdout(io.StringIO()):
        module.downstream(True)
    first_file = next(i for i, call in enumerate(calls) if call[0] == 'file')
    assert any('create table downstream_import_policies_before' in call[1] for call in calls[:first_file])
    assert [call[1] for call in calls if call[0] == 'file'] == list(module.contract.DOWNSTREAM)
    assert calls[-1][0] == 'sql' and 'downstream_import_policies_before' in calls[-1][1]
    # First F gets one precise delta; every repeat uses full row equality.
    first = oracle.stage_preserved_sql('f_first', ('roles', 'permissions', 'role_permissions'))
    repeat = oracle.stage_preserved_sql('f_repeat')
    assert "to_jsonb(t)-array['last_versioned_at','version_note']::text[]" in first
    assert "b.value ?| array['last_versioned_at','version_note']::text[]" in first
    assert "to_jsonb(t)->'last_versioned_at' is distinct from 'null'::jsonb" in first
    assert "to_jsonb(t)->'version_note' is distinct from 'null'::jsonb" in first
    assert "('last_versioned_at','timestamptz'::regtype),('version_note','text'::regtype)" in first
    assert 'a.attnotnull or d.oid is not null' in first
    assert "t.id::text=b.id and to_jsonb(t)=b.value" in repeat and 'first-F' not in repeat
    main_text = (ROOT / 'scripts/canonical-full-governance-source-selftest.py').read_text()
    assert 'select tableoid as source_table_oid,id,to_jsonb(t)' in main_text
    assert 'select source_table_oid,id,value from reduced_i_before' in main_text
    assert '(select count(*) from customer_import_batches)+(select count(*) from customer_import_rows)' in main_text
    # Capture constructed lane statements without a database; SQL remains NOT EXECUTED.
    calls.clear()
    module.reset_database = lambda *a, **k: None
    module.psql_sql = lambda sql, **k: calls.append(('sql', sql))
    module.source = lambda alias, **k: calls.append(('source', alias, k))
    with redirect_stdout(io.StringIO()):
        module.native_failure_lanes()
    failure = calls.index(('source', '6D2', {'expected': '23514'}))
    assert 'native_6d2_before_rows' in calls[failure - 1][1]
    assert 'native_6d2_before_catalog' in calls[failure - 1][1]
    after = calls[failure + 1][1]
    assert 'count(*)=4 and bool_and(is_active)' in after
    assert 'native_6d2_before_rows' in after and 'native_6d2_before_catalog' in after
    assert after.count('except') >= 4, 'rollback requires two-way row AND catalog equality'


def rbac_prefix_seed_uniqueness():
    """The synthetic grant seed must not duplicate pairs now supplied by full F."""
    spec = importlib.util.spec_from_file_location('rbac_prefix', RBAC_PREFIX_FIXTURE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    seed = module.reduced_seed()
    pairs = re.findall(
        r"\(select id from roles where key='([^']+)'\),"
        r"\(select id from permissions where key='([^']+)'\)", seed)
    assert len(pairs) == 6 and len(set(pairs)) == 6, pairs
    final_source = (ROOT / 'supabase/migrations/20260519_final_saas_hardening.sql').read_text()
    keys = re.search(r"permission_keys text\[\] := array\[(.*?)\];", final_source).group(1)
    final_pairs = {(role, permission) for role in ('company_admin', 'super_admin')
                   for permission in re.findall(r"'([^']+)'", keys)}
    assert final_pairs.isdisjoint(pairs), sorted(final_pairs.intersection(pairs))
    assert ('company_admin', 'permissions.manage') in pairs
    sql = module.main_sql()
    assert 'create temporary table prefix_hard_cleanup_grants as' in sql
    assert 'create temporary table role_permissions_expected_after_cleanup as' in sql
    assert "full F contributes the one authentic prefix grant removed by hard6E" in sql
    assert 'baseline plus six fixture grants minus two synthetic and one authentic cleanup row' in sql


def rbac_prefix_user_role_statuses():
    """Every prefix-local role status must satisfy the selected 6D2 vocabulary."""
    spec = importlib.util.spec_from_file_location('rbac_prefix_status', RBAC_PREFIX_FIXTURE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    seed = module.reduced_seed()
    source = (ROOT / 'supabase/migrations/20260519_batch_6d2_runtime_governance_completion.sql').read_text()
    constraint = re.search(
        r"add constraint user_roles_status_check\s+check \(status in \((.*?)\)\)",
        source, re.S).group(1)
    allowed = set(re.findall(r"'([^']+)'", constraint))
    rows = {}
    for line in seed.splitlines():
        if line.lstrip().startswith("('70000000-"):
            values = re.findall(r"'([^']+)'", line)
            rows[values[0]] = values[-1]
    assert len(rows) == 4, rows
    assert set(rows.values()) <= allowed, (rows, allowed)
    assert rows['70000000-0000-0000-0000-000000000002'] == 'disabled'
    assert "add column if not exists is_active boolean not null default true" in source
    base_spec = importlib.util.spec_from_file_location('rbac_reduced_status', RBAC_FIXTURE.with_name('canonical-rbac-tenant-selftest.py'))
    base = importlib.util.module_from_spec(base_spec)
    base_spec.loader.exec_module(base)
    assert "'70000000-0000-0000-0000-000000000002'" in base.seed()
    assert "(select id from roles where key='company_admin'),'inactive')" in base.seed()
    main_sql = module.main_sql()
    assert "not gridex_user_has_role_key('company_admin'),'inactive role status is rejected" in main_sql
    final = (ROOT / 'supabase/migrations/20260908120000_preserve_gridex_user_has_role_key.sql').read_text()
    assert "coalesce(ur.status, ''active'') = ''active''" in final
    assert "coalesce(ur.is_active, true) = true" in final


def rbac_prefix_governance_trigger_contract():
    """The expanded prefix must retain 6D2's finite trigger catalog exactly."""
    spec = importlib.util.spec_from_file_location('rbac_prefix_triggers', RBAC_PREFIX_FIXTURE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    contract_spec = importlib.util.spec_from_file_location(
        'full_governance_contract', ROOT / 'scripts/canonical_full_governance_contract.py')
    contract = importlib.util.module_from_spec(contract_spec)
    contract_spec.loader.exec_module(contract)
    sql = module.main_sql()
    assert len(contract.TRIGGER_TARGETS) == 28
    target_table = 'rbac_expected_governance_trigger_targets'
    create = f'create temporary table {target_table}(table_name text primary key);'
    assert sql.count(create) == 1, 'typed primary-key target table requires standalone CREATE TABLE'
    inserts = re.findall(rf'insert into {target_table}\(table_name\) values ([^;]+);', sql)
    assert len(inserts) == 1, 'target table requires one explicit INSERT after creation'
    targets = re.findall(r"\('([^']+)'\)", inserts[0])
    assert tuple(targets) == tuple(contract.TRIGGER_TARGETS) and len(set(targets)) == 28, targets
    assert inserts[0] == ','.join(f"('{target}')" for target in targets)
    assert sql.index(create) < sql.index(f'insert into {target_table}(table_name)')
    assert '(select count(*)=28 from rbac_governance_triggers)' in sql
    assert "t.tgtype<>23 or t.tgenabled<>'O'" in sql
    assert "t.tgfoid<>'public.gridex_assert_company_operational_for_write()'::regprocedure" in sql
    assert "array(select unnest(t.tgattr))<>array[(select attnum" in sql
    assert 'select * from rbac_governance_triggers except' in sql
    assert 'union all (select oid,tgrelid,tgname,tgfoid,tgtype,tgattr,tgenabled from pg_trigger' in sql
    assert "tgrelid in ('public.user_roles'::regclass,'public.user_profiles'::regclass)" in sql
    assert '(tgtype&16)=16' in sql
    assert 'all17 governance trigger identities/events/bindings retained' not in sql


def rbac_prefix_journal_contract():
    """6D2's two journal policy sets survive the later 6E/helper boundary exactly."""
    spec = importlib.util.spec_from_file_location('rbac_prefix_journals', RBAC_PREFIX_FIXTURE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sql = module.main_sql()
    assert 'operations source journal retains its no-FK/no-RLS/no-policy boundary' not in sql
    assert 'bounded 6D then 6E journal policy boundary' not in sql
    source = (ROOT / 'supabase/migrations/20260519_batch_6d2_runtime_governance_completion.sql').read_text()
    targets = re.search(r'target_tables text\[\] := array\[(.*?)\];', source, re.S).group(1)
    assert "'customer_sync_events'" in targets
    generic = {
        'select': 'for select using (public.gridex_can_read_company(company_id))',
        'insert': 'for insert with check (public.gridex_can_write_company(company_id))',
        'update': 'for update using (public.gridex_can_read_company(company_id)) with check (public.gridex_can_write_company(company_id))',
        'delete': 'for delete using (public.gridex_user_is_platform_admin())',
    }
    for action, clause in generic.items():
        assert f"'create policy %I on public.%I {clause}'" in source
        assert f'create policy customer_sync_events_tenant_{action} on public.rbac_expected_sync {clause};' in sql
    for action, clause in {
        'select': 'for select using (public.gridex_user_is_platform_admin() or company_id in (select * from public.gridex_user_company_ids()))',
        'write': 'for all using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())',
    }.items():
        assert f'create policy tenant_governance_events_{action} on public.tenant_governance_events {clause}' in source
        assert f'create policy tenant_governance_events_{action} on public.rbac_expected_governance {clause};' in sql
    for path in (*module.SOURCES, module.FINAL):
        downstream = (ROOT / 'supabase' / path).read_text()
        assert 'customer_sync_events' not in downstream and 'tenant_governance_events' not in downstream
    for marker in [
        'create temporary table rbac_journal_policies_before as',
        'select oid,polrelid,polname,polcmd,polroles,polpermissive,',
        'pg_get_expr(polqual,polrelid) using_expression',
        'pg_get_expr(polwithcheck,polrelid) check_expression',
        'select * from rbac_journal_policies_before except',
        'except select * from rbac_journal_policies_before',
        'count(*)=2 and bool_and(relrowsecurity and not relforcerowsecurity',
        'relowner=(select oid from pg_roles where rolname=current_user)',
        'relacl is null and reloptions is null',
        "conrelid='customer_sync_events'::regclass and contype='f'",
        '(select count(*)=6 from expected)',
        '(select * from actual except select * from expected)',
        '(select * from expected except select * from actual)',
        '6D2 journal RLS/owner/default ACL/options retained; final runtime access remains OPEN',
    ]:
        assert marker in sql, marker
    baseline = sql.index('create temporary table rbac_journal_policies_before as')
    assert baseline < sql.index('-- RBAC_SOURCE_FILE_BEGIN ')
    assert sql.index('create table public.rbac_expected_sync') > sql.index('-- RBAC_FINAL_HELPER_BEGIN ')
    assert 'operations journal PK/check identities retained through full6E' in sql
    assert 'operations journal/index identities and bounded ACL/options retained through full6E' in sql


def main():
    whole_correction_constructors()
    rbac_prefix_seed_uniqueness()
    rbac_prefix_user_role_statuses()
    rbac_prefix_governance_trigger_contract()
    rbac_prefix_journal_contract()
    emitted = run('python3', str(RBAC_FIXTURE), '--emit')
    assert emitted.returncode == 0, emitted.stderr
    for source in [
        '20260520_batch_6e_rbac_tenant_stats_whitelabel.sql',
        '20260520_batch_6e_fix_rbac_backfill_security.sql',
        '20260520_batch_6e_hard_platform_roles_only.sql',
    ]:
        body = (ROOT / 'supabase/migrations' / source).read_text()
        assert emitted.stdout.count(body) == 2, source
    assert "select test_assert(current_setting('server_version_num')::int / 10000=17" in emitted.stdout
    assert 'FIXTURE_POLICY_TARGETS_PRESENT=8' in emitted.stdout
    assert 'FIXTURE_POLICY_TARGETS_ABSENT=21' in emitted.stdout
    user_status = "alter table public.user_profiles add column if not exists user_status text not null default 'active';"
    profile_seed = 'insert into user_profiles(id,email,full_name,user_status,active_company_id) values'
    assert emitted.stdout.count(user_status) == 1
    assert emitted.stdout.index(user_status) < emitted.stdout.index(profile_seed)

    prefix = run('python3', str(RBAC_PREFIX_FIXTURE), '--emit')
    assert prefix.returncode == 0, prefix.stderr
    assert prefix.stdout.count('-- RBAC_MANAGED_BOOTSTRAP_BEGIN') == 1
    assert prefix.stdout.count('-- RBAC_PREFIX_FILE_BEGIN ') == 38
    assert prefix.stdout.count('-- RBAC_SOURCE_FILE_BEGIN ') == 6
    assert prefix.stdout.count('-- RBAC_FINAL_HELPER_BEGIN ') == 1
    assert prefix.stdout.rindex('-- RBAC_FINAL_HELPER_BEGIN ') > prefix.stdout.rindex('-- RBAC_SOURCE_FILE_BEGIN ')
    assert 'RBAC_POLICY_TARGETS_PRESENT=25' in prefix.stdout
    assert 'security invoker' in prefix.stdout

    governance = run('python3', str(ROOT / 'scripts/canonical-governance-selftest.py'), '--emit')
    assert governance.returncode == 0, governance.stderr
    order = json.loads((ROOT / 'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
    paths = [line.removeprefix('-- GOVERNANCE_PREFIX_FILE_BEGIN ') for line in governance.stdout.splitlines() if line.startswith('-- GOVERNANCE_PREFIX_FILE_BEGIN ')]
    assert paths == order[:30] and len(paths) == 30
    for path in paths:
        assert (ROOT / 'supabase' / path).read_text() in governance.stdout, path
    full6d = (ROOT / 'supabase/migrations/20260519_batch_6d_superadmin_tenant_governance.sql').read_text()
    assert full6d in governance.stdout and 'NOT EXECUTED' in governance.stdout
    assert 'final ACL/permissive+restrictive policy/runtime contract OPEN' in governance.stdout
    operations = run('python3', str(ROOT / 'scripts/canonical-operations-sync-selftest.py'), '--emit')
    assert operations.returncode == 0, operations.stderr
    operations_paths = [line.removeprefix('-- OPERATIONS_PREFIX_FILE_BEGIN ') for line in operations.stdout.splitlines() if line.startswith('-- OPERATIONS_PREFIX_FILE_BEGIN ')]
    assert operations_paths == order[:31] and len(operations_paths) == 31
    operations_source = (ROOT / 'supabase/migrations/20260519_operations_core_saas_sync.sql').read_text()
    assert operations.stdout.count(operations_source) >= 2
    assert 'NOT EXECUTED' in operations.stdout
    assert 'journal has no source-created FK/RLS/policy' in operations.stdout
    token = run('python3', str(ROOT / 'scripts/invitation_token_prerequisite_selftest.py'), '--emit')
    assert token.returncode == 0, token.stderr
    token_paths = [line.removeprefix('-- TOKEN_PREFIX_FILE_BEGIN ') for line in token.stdout.splitlines() if line.startswith('-- TOKEN_PREFIX_FILE_BEGIN ')]
    assert token_paths == order[:32] and len(token_paths) == 32
    assert 'SQL NOT EXECUTED' in token.stdout
    assert 'SEPARATE COMPLETE LATER RUNTIME COMPATIBILITY; NOT INTERVENING FULL REPLAY' in token.stdout
    admission = run('python3', str(ROOT / 'scripts/canonical-import-admission-selftest.py'), '--emit')
    assert admission.returncode == 0, admission.stderr
    admission_paths = [line.removeprefix('-- IMPORT_ADMISSION_PREFIX_FILE_BEGIN ') for line in admission.stdout.splitlines() if line.startswith('-- IMPORT_ADMISSION_PREFIX_FILE_BEGIN ')]
    assert admission_paths == order[:33] and len(admission_paths) == 33
    assert 'SQL NOT EXECUTED' in admission.stdout
    assert 'NOT FULL I/F/D REPLAY' in admission.stdout
    checker = run('python3', str(ROOT / 'scripts/canonical-import-admission-selftest.py'), '--emit-checker')
    assert checker.returncode == 0, checker.stderr
    assert 'begin isolation level repeatable read read only;' in checker.stdout
    assert 'IMPORT_ADMISSION_PREFIX_FILE_BEGIN' not in checker.stdout
    assert 'all28 source-targeted governance trigger identities/events/function and company_id bindings retained through full6E' in prefix.stdout
    assert "'D','suspended'" not in prefix.stdout and "'D','locked_security'" in prefix.stdout

    whole_selection = run('python3', str(ROOT / 'scripts/canonical-full-governance-source-selftest.py'), '--selection-only')
    assert whole_selection.returncode == 0, whole_selection.stderr
    whole_manifest = json.loads(whole_selection.stdout)
    assert whole_manifest['sql'] == 'NOT EXECUTED'
    assert whole_manifest['prefixCount'] == 33 and whole_manifest['foundationCount'] == 118
    assert whole_manifest['prefixPathSha256'] == 'ca5bba8be8cadae60b5e753addca0a6f4d7d835cf4f96bd3f3d91fb9734a8370'
    assert [item['alias'] for item in whole_manifest['wholeSources']] == ['I', 'F', 'D', '6D2']
    assert whole_manifest['canonicalSelectionReviewed'] is True and whole_manifest['finalGates'] == 'OPEN'
    whole_emit = run('python3', str(ROOT / 'scripts/canonical-full-governance-source-selftest.py'), '--emit')
    assert whole_emit.returncode == 0, whole_emit.stderr
    assert whole_emit.stdout.startswith('-- SQL NOT EXECUTED.')
    assert whole_emit.stdout.count('-- WHOLE_SOURCE_FILE_BEGIN ') == 42
    assert whole_emit.stdout.count('-- WHOLE_SOURCE_FILE_BEGIN bootstrap ') == 1
    for path in order[:33] + whole_manifest['downstream']:
        assert whole_emit.stdout.count('-- WHOLE_SOURCE_FILE_BEGIN ' + path + ' ') == 1, path
    for item in whole_manifest['wholeSources']:
        body = (ROOT / 'supabase' / item['path']).read_text()
        assert whole_emit.stdout.count(body) == 1, item['path']
    for marker in ['exact first33 -> I -> F(three-pair boundary) -> D -> 6D2 -> role-key/all6E',
                   'EXPLICIT_SYNTHETIC_SUPER_ADMIN_SEED', 'FULL_GOVERNANCE_ADMISSION',
                   'exact19 customer_import_batches positional type/nullability/default matrix', '6D2 exact28 operational INSERT/UPDATE-company triggers',
                   'final ACL/RLS/retention/runtime/parity gates were not executed']:
        assert marker in whole_emit.stdout, marker
    whole_main = (ROOT / 'scripts/canonical-full-governance-source-selftest.py').read_text()
    whole_sql = (ROOT / 'scripts/canonical_full_governance_sql.py').read_text()
    assert "journal_oid := to_regclass('public.platform_session_revocations')" in whole_emit.stdout
    admission_text = whole_emit.stdout.split('-- WHOLE_6D2_ADMISSION_BEGIN', 1)[1].split('-- WHOLE_EXPLICIT_SEED_AND_BEHAVIOR_BEGIN', 1)[0]
    assert "'public.platform_session_revocations'::regclass" not in admission_text
    assert "'public.platform_session_revocations_user_idx'::regclass" not in admission_text
    assert "select exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname=split_part(signature,'(',1) and prokind='f') into same_name_exists;" in admission_text
    assert "and prokind='f')\n       and to_regprocedure" not in admission_text
    assert "exact_function_oid := to_regprocedure('public.'||signature);" in admission_text
    assert "proargmodes=array['t'::\"char\"" in admission_text
    assert "to_regclass('public.user_roles') is not null" in admission_text
    assert "user_parent_ok := to_regclass('auth.users') is not null" in admission_text
    assert "if user_parent_ok then" in admission_text and "if role_parent_ok then" in admission_text
    assert "select 1 from pg_index where indexrelid=journal_index_oid and indrelid=journal_oid" in admission_text
    assert "clean consumer fixture has zero row/batch owner mismatches" in whole_emit.stdout
    assert "actual duplicate row numbers remain source-accepted" in whole_emit.stdout
    assert "exact seven NULL/0/100 values" in whole_emit.stdout
    assert "unsupported batch status exact native rejection" in whole_emit.stdout
    assert 'create temporary table lifecycle_before' not in whole_sql and 'create table lifecycle_before' in whole_sql
    assert 'linked_existing_customer\',\'unsupported' in whole_main
    assert 'lock_timeout="1s", timeout="10s"' in whole_main
    assert 'timeout=180' in whole_main and 'timeout=240' in whole_main and 'select.select' in whole_main
    assert 'exact19 customer_import_batches positional type/nullability/default matrix' in whole_emit.stdout
    assert 'exact import FK customer_import_rows.reviewed_by parent/action/raw validation' in whole_emit.stdout
    assert 'all116 generic policy names/commands/roles/permissiveness/expressions' in whole_emit.stdout
    assert 'all eight bespoke 6D2 policy identities/commands/roles/permissiveness' in whole_emit.stdout
    assert 'array(select unnest(t.tgattr))' in whole_emit.stdout
    assert 'D debug view exact15 names and honest missing_table/review_rls/ok results' in whole_emit.stdout
    assert '6D2 journal exact columns/types/nullability/defaults' in whole_emit.stdout
    assert 'F exact latest-contract filter body/signature/invoker/stable' in whole_sql
    assert 'F latest-contract closed bucket exact' in whole_emit.stdout
    assert 'overview exact counts/status buckets/greatest timestamp' in whole_emit.stdout
    assert 'for mode, category in (("null", "would_change_ownership"), ("wrong", "conflicting_ownership"), ("orphan", "orphan_ownership_parent"))' in whole_main
    assert 'source("F", expected="42P13")' in whole_main
    assert 'source("D", expected="42P16")' in whole_main
    assert 'POST6D2_TEMPLATE' in whole_main and 'RPC caught undefined-column branch returns empty' in whole_main
    assert 'first I preserves existing import history table OIDs and values' in whole_main
    assert 'F rename preserves table/index/FK OIDs' in whole_main
    assert 'command = ["psql", "-X", "-qAt"' in whole_main
    assert '.stdout.strip() == "t"' not in whole_main and 'if exists == "t"' not in whole_main
    for relation in ['customer_contacts', 'customer_addresses', 'customer_contract_events',
                     'supplier_switch_requests', 'supplier_switch_events', 'billing_underlays']:
        assert f'"{relation}"' in whole_main
    assert "reviewed_by=case when company_id='{C1}'" in whole_sql
    assert 'C1 = "21000000-' in whole_sql and 'U2 = "11000000-' in whole_sql
    assert 'all actors have owning-company membership' in whole_emit.stdout
    assert 'drop constraint user_roles_status_check' not in whole_main
    assert "('payload_version','text'::regtype,false,null::text)" in whole_sql
    assert 'select * from public.gridex_user_company_ids()' in whole_emit.stdout
    assert 'all eight bespoke policy expressions equal PostgreSQL-deparsed immutable source literals' in whole_emit.stdout
    assert "array['is_active','disabled_at','disabled_by','status_reason']::text[]" in whole_sql
    assert 'session_revoked_at' in whole_sql and 'user_profiles source-added nullable columns' in whole_sql
    assert "'tenant_governance_events_select'" in whole_sql
    assert 'task7.main_seed() + task7.table_sql("I"' in whole_main
    assert 'select min(id) from company_invitations' not in whole_main
    assert 'order by id limit 1' in whole_main
    for marker in ['page_size zero clamps to one exact row', 'negative page_size clamps to one exact row',
                   'page_num zero clamps to first-page exact rows', 'negative page_num clamps to first-page exact rows',
                   'explicitly exclude archived and deleted_test_only companies']:
        assert marker in whole_emit.stdout, marker

    dry = run('python3', str(RUNNER), '--dry-run')
    assert dry.returncode == 0, dry.stderr
    assert dry.stdout.splitlines() == [' '.join(command) for command in COMMANDS], dry.stdout
    rejected = run('python3', str(RUNNER), '--command', 'echo unsafe')
    assert rejected.returncode != 0, 'arbitrary command option accepted'

    with tempfile.TemporaryDirectory() as directory:
        fixture = Path(directory)
        (fixture / 'scripts').mkdir()
        shutil.copy2(RUNNER, fixture / 'scripts' / RUNNER.name)
        for child_name in dict.fromkeys(command[1] for command in COMMANDS):
            child = fixture / child_name
            child.write_text("#!/usr/bin/env python3\nimport json,os,sys\n"
                             "assert not any(k.startswith('PG') for k in os.environ)\n"
                             "with open(os.environ['GROUP_LOG'], 'a') as log:\n"
                             "    log.write(json.dumps([sys.argv[0], *sys.argv[1:]]) + '\\n')\n"
                             "if json.loads(os.environ.get('FAIL_COMMAND', 'null')) == "
                             "[sys.argv[0], *sys.argv[1:]]:\n"
                             "    raise SystemExit(23)\n")
        log = fixture / 'commands.jsonl'
        environment = dict(os.environ, PGHOSTADDR='production.invalid', PGSERVICE='production', GROUP_LOG=str(log))
        passed = run('python3', str(fixture / 'scripts' / RUNNER.name), cwd=fixture, env=environment)
        assert passed.returncode == 0, (passed.returncode, passed.stderr)
        observed = [json.loads(line) for line in log.read_text().splitlines()]
        expected = [[command[1], *command[2:]] for command in COMMANDS]
        assert len(observed) == len(COMMANDS) == 19, observed
        assert observed == expected, observed
        assert passed.stdout.splitlines() == [' '.join(command) for command in COMMANDS], passed.stdout

        partitions={}
        for partition, selected in (('original16',expected[:16]),('legacy17',expected[16:17]),('repair18',expected[17:18]),('all17',expected[:17]),('all18',expected[:18]),('dedupe19',expected[18:19]),('all19',expected)):
            log.write_text('')
            result=run('python3',str(fixture / 'scripts' / RUNNER.name),'--partition',partition,cwd=fixture,env=environment)
            assert result.returncode==0
            executed=[json.loads(line) for line in log.read_text().splitlines()]
            assert executed==selected
            partitions[partition]=executed

        union=[tuple(command) for name in ('original16','legacy17','repair18','dedupe19') for command in partitions[name]]
        assert Counter(union)==Counter(map(tuple,expected)) and all(count==1 for count in Counter(union).values())
        assert partitions['all17']==expected[:17] and partitions['all18']==expected[:18] and partitions['all19']==expected
        workflow=(ROOT/'.github/workflows/ops-hardening.yml').read_text()
        for name in ('original16','legacy17','repair18','dedupe19'):
            assert workflow.count('scripts/canonical-auth-membership-group.py --partition '+name)==1
        log.write_text('')
        environment['FAIL_COMMAND'] = json.dumps(expected[2])
        failed = run('python3', str(fixture / 'scripts' / RUNNER.name), cwd=fixture, env=environment)
        assert failed.returncode == 23, (failed.returncode, failed.stderr)
        observed = [json.loads(line) for line in log.read_text().splitlines()]
        assert observed == expected[:3], observed
        assert failed.stdout.splitlines() == [' '.join(command) for command in COMMANDS[:3]], failed.stdout

    archive = ROOT / '.agent-memory/archive/pre-batch-20260907'
    for name, expected in HASHES.items():
        actual = hashlib.sha256((archive / name).read_bytes()).hexdigest()
        assert actual == expected, (name, actual)

    accounting = run('python3', 'scripts/gridex-replay-input-accounting.py')
    account = json.loads(accounting.stdout)
    assert account['status'] != 'INVALID_INPUT_CONTRACT' and not account['errors'], account
    assert accounting.returncode == int(account['counts']['UNCLASSIFIED'] > 0), (
        accounting.returncode, account['counts'])
    grouped = run('python3', 'scripts/gridex-replay-review-groups.py', '--group', 'auth_membership_tenant')
    group = json.loads(grouped.stdout)
    assert group['status'] != 'INVALID_INPUT_CONTRACT' and not group['errors'], group
    assert grouped.returncode == int(group['global']['unresolvedCounts']['total'] > 0), (
        grouped.returncode, group['global']['unresolvedCounts'])
    state = (ROOT / '.agent-memory/current-state.md').read_text()
    state_flat = ' '.join(state.split())
    counts = account['counts']
    group_counts = Counter(item['classification'] for item in group['inputs'])
    accounting_summary = (f"Working-tree accounting is {account['totalMigrations']} inputs: "
        f"{counts['FULL_FILE_SELECTED']} `FULL_FILE_SELECTED`, {counts['SUBSTITUTED']} `SUBSTITUTED`, "
        f"{counts['UNCLASSIFIED']} `UNCLASSIFIED`, and {counts['EXPLICITLY_EXCLUDED']} `EXPLICITLY_EXCLUDED`.")
    group_summary = (f"The focused group contains {len(group['inputs'])} inputs: "
        f"{group_counts['FULL_FILE_SELECTED']} selected, {group_counts['SUBSTITUTED']} substituted, "
        f"{group_counts['UNCLASSIFIED']} unclassified, and {group_counts['EXPLICITLY_EXCLUDED']} excluded.")
    for marker in [accounting_summary, group_summary,
                   'No production mutation has been performed in this replay-verification batch.',
                   'Push reviewed, coherent batches stepwise as requested.']:
        assert ' '.join(marker.split()) in state_flat, marker
    for name in ['current-task.md', 'handover.md', 'open-blockers.md', 'work-plan.md']:
        pointer = (ROOT / '.agent-memory' / name).read_text()
        assert 'current-state.md' in pointer and f'archive/pre-batch-20260907/{name}' in pointer
    checkpoint = json.loads((ROOT / '.agent-memory/checkpoint.json').read_text())
    state_status = re.search(r'^Status: ([A-Z_]+)$', state, re.MULTILINE)
    assert state_status, 'current-state status is missing'
    assert checkpoint['status'] == state_status.group(1)
    assert checkpoint['current_state'] == '.agent-memory/current-state.md'
    print('PASS: fixed runner, failure stop, environment isolation, archive hashes and status pointers')


if __name__ == '__main__':
    main()
