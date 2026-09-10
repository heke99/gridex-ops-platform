#!/usr/bin/env python3
"""Execute the fixed whole I/F/D/6D2 proof on disposable PostgreSQL 17."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import canonical_full_governance_contract as contract
import canonical_full_governance_sql as oracle


DATABASE = "gridex_full_governance_fixture"
PRE6D2_TEMPLATE = "gridex_full_governance_pre6d2"
PREFIX_TEMPLATE = "gridex_full_governance_first33"
POST6D2_TEMPLATE = "gridex_full_governance_post6d2"
ADMIN = "postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test"
TARGET = f"postgresql://postgres:postgres@127.0.0.1:55440/{DATABASE}"
LOCK_TIMEOUT = "10s"
STATEMENT_TIMEOUT = "120s"


def load_script(name: str):
    path = ROOT / "scripts" / name
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def environment() -> dict[str, str]:
    # Never inherit a service, host, port, user, password, options, or target URL.
    return {key: value for key, value in os.environ.items() if not key.startswith("PG")}


def psql_sql(sql: str, *, url: str = TARGET, expected: str | None = None) -> subprocess.CompletedProcess[str]:
    command = ["psql", "-X", "-q", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=verbose", url, "-f", "-"]
    result = subprocess.run(command, input=sql, text=True, capture_output=True, env=environment(), cwd=ROOT, timeout=180)
    if expected is None:
        assert result.returncode == 0, result.stderr
    else:
        assert result.returncode != 0 and re.search(rf"ERROR:\s+{re.escape(expected)}:", result.stderr), result.stderr
    return result


def psql_scalar(sql: str, *, url: str = TARGET) -> str:
    command = ["psql", "-X", "-qAt", "--set=ON_ERROR_STOP=1", url, "-f", "-"]
    result = subprocess.run(command, input=sql, text=True, capture_output=True, env=environment(), cwd=ROOT, timeout=180)
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert len(lines) == 1, (sql, lines)
    return lines[0]


def psql_file(
    relative: str,
    *,
    expected: str | None = None,
    lock_timeout: str = LOCK_TIMEOUT,
    statement_timeout: str = STATEMENT_TIMEOUT,
) -> subprocess.CompletedProcess[str]:
    path = ROOT / "supabase" / relative
    command = [
        "psql", "-X", "-q", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=verbose",
        TARGET,
        "-c", f"set lock_timeout={oracle.q(lock_timeout)}; set statement_timeout={oracle.q(statement_timeout)};",
        "-c", oracle.source_timeout_assertion_sql(lock_timeout, statement_timeout),
        "-f", str(path),
    ]
    result = subprocess.run(command, text=True, capture_output=True, env=environment(), cwd=ROOT, timeout=240)
    if expected is None:
        assert result.returncode == 0, f"{relative}: {result.stderr}"
        print(f"PASS SOURCE {relative} sha256={contract.sha256(path)} COMMITTED_UNWRAPPED")
    else:
        assert result.returncode != 0 and re.search(rf"ERROR:\s+{re.escape(expected)}:", result.stderr), result.stderr
        print(f"PASS NATIVE FAILURE {relative} SQLSTATE={expected} AUTOCOMMIT_BOUNDARY_INSPECTED")
    return result


def reset_database(name: str = DATABASE, template: str | None = None) -> None:
    suffix = f" template {template}" if template else ""
    psql_sql(f"drop database if exists {name} with (force); create database {name}{suffix};", url=ADMIN)


def clone_database(source: str, target: str) -> None:
    psql_sql(f"drop database if exists {target} with (force); create database {target} template {source};", url=ADMIN)


def bootstrap_and_prefix() -> None:
    governance = load_script("canonical-governance-selftest.py")
    psql_sql(governance.bootstrap() + oracle.timeout_unit_regression_sql())
    for relative in contract.prefix():
        psql_file(relative)
    print(f"PASS PREFIX exact-first33 path-sha256={contract.PREFIX_PATH_DIGEST}")


def source(
    alias: str,
    *,
    expected: str | None = None,
    lock_timeout: str = LOCK_TIMEOUT,
    timeout: str = STATEMENT_TIMEOUT,
) -> subprocess.CompletedProcess[str]:
    if alias in ("F", "6D2") and expected is None:
        psql_sql(oracle.function_acl_snapshot_sql())
    return psql_file(
        "migrations/" + contract.WHOLE_SOURCES[alias][0],
        expected=expected,
        lock_timeout=lock_timeout,
        statement_timeout=timeout,
    )


def downstream(expect_super_admin: bool) -> None:
    psql_sql(oracle.function_acl_snapshot_sql())
    psql_sql("create table downstream_import_before as select 'b' kind,id,to_jsonb(t) value from customer_import_batches t union all select 'r',id,to_jsonb(t) from customer_import_rows t; create table downstream_helper_oids_before as select oid,proname,pg_get_function_identity_arguments(oid) identity_args from pg_proc where pronamespace='public'::regnamespace and proname in ('gridex_user_is_platform_admin','gridex_user_company_ids','gridex_can_read_company','gridex_user_can_manage_company','gridex_can_write_company');")
    for relative in contract.DOWNSTREAM:
        psql_file(relative)
    psql_sql(downstream_checks_sql(expect_super_admin))
    print("PASS DOWNSTREAM retained role-key and all three complete 6E originals")


def downstream_checks_sql(expect_super_admin: bool) -> str:
    first_6e = "supabase/migrations/20260520_batch_6e_rbac_tenant_stats_whitelabel.sql"
    hard_6e = "supabase/migrations/20260520_batch_6e_hard_platform_roles_only.sql"
    specs = (
        (first_6e, "gridex_user_has_role_key"), (hard_6e, "gridex_user_is_platform_admin"),
        (first_6e, "gridex_company_is_writable"), (first_6e, "gridex_user_company_ids"),
        (first_6e, "gridex_can_read_company"), (first_6e, "gridex_user_can_manage_company"),
        (first_6e, "gridex_can_write_company"),
    )
    function_checks = []
    for relative, name in specs:
        body = (ROOT / relative).read_text()
        match = re.search(rf"create or replace function public\.{name}\([^;]*?\)\n.*?\bas \$\$(.*?)\$\$;", body, re.I | re.S)
        assert match, (relative, name)
        function_checks.append(oracle.check(f"exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='{name}' and prosrc={oracle.q(match.group(1))} and prosecdef and provolatile='s' and proowner=(select oid from pg_roles where rolname=current_user))", f"downstream exact winning helper body/security {name}"))
        argument = "text" if name == "gridex_user_has_role_key" else "" if name in ("gridex_user_is_platform_admin", "gridex_user_company_ids") else "uuid"
        function_checks.append(oracle.function_acl_oracle_sql(f"public.{name}({argument})"))
    super_check = oracle.check("(select count(*)=3 from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='super_admin' and p.key in ('tenants.read','tenants.write','tenants.invite'))", "hard6E retains all three super-admin tenant grants") if expect_super_admin else oracle.check("not exists(select 1 from roles where key='super_admin')", "empty lane remains explicitly without synthetic super-admin")
    return "".join(function_checks) + """
select test_assert(exists(select 1 from pg_attribute where attrelid='company_memberships'::regclass and attname='role_key' and atttypid='text'::regtype and not attisdropped),'retained membership role_key bootstrap effect');
select test_assert(to_regclass('public.gridex_rbac_tenant_audit_summary') is not null,'complete 6E RBAC audit view effect');
select test_assert(to_regclass('public.company_billing_volume_overview') is not null,'complete 6E billing overview effect');
select test_assert(to_regprocedure('public.gridex_user_has_role_key(text)') is not null,'complete 6E role helper effect');
select test_assert((select count(*)=19 from pg_attribute where attrelid='customer_import_batches'::regclass and attnum>0 and not attisdropped) and (select count(*)=19 from pg_attribute where attrelid='customer_import_rows'::regclass and attnum>0 and not attisdropped),'downstream retains exact19/19 import shapes');
select test_assert(not exists((select * from downstream_import_before except (select 'b',id,to_jsonb(t) from customer_import_batches t union all select 'r',id,to_jsonb(t) from customer_import_rows t)) union all ((select 'b',id,to_jsonb(t) from customer_import_batches t union all select 'r',id,to_jsonb(t) from customer_import_rows t) except select * from downstream_import_before)),'downstream preserves every import history row exactly');
select test_assert(not exists(select * from downstream_helper_oids_before except select oid,proname,pg_get_function_identity_arguments(oid) from pg_proc),'downstream CREATE OR REPLACE preserves prior helper OIDs');
select test_assert((select count(*)=2 from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='company_admin' and p.key in ('tenants.read','tenants.write','tenants.invite')) and not exists(select 1 from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='company_admin' and p.key='tenants.write'),'hard6E exact platform-role-only cleanup wins over F company-admin seed');
select test_assert((select pg_get_expr(polqual,polrelid)='gridex_can_write_company(company_id)' and pg_get_expr(polwithcheck,polrelid)='gridex_can_write_company(company_id)' from pg_policy where polrelid='customer_import_rows'::regclass and polname='customer_import_rows_tenant_update'),'downstream 6E winning tenant-update policy body exact');
-- Later selected helper/ACL/RLS/runtime composition is deliberately not inferred here.
""" + super_check


def admission_result(sql: str, marker: str) -> dict[str, object]:
    result = psql_sql(sql)
    matches = re.findall(marker + r" (\{.*\})", result.stderr)
    assert len(matches) == 1, (marker, result.stderr)
    return json.loads(matches[0])


def assert_task7_admission() -> None:
    task7 = load_script("canonical-import-admission-selftest.py")
    result = admission_result(task7.checker_sql(), "IMPORT_ADMISSION")
    assert not task7.blockers(result), task7.blockers(result)
    print("PASS ADMISSION retained Task7 checker has zero blocking categories")


def assert_6d2_admission(expected: set[tuple[str, str, int]] | None = None) -> dict[str, object]:
    result = admission_result(oracle.admission_sql(), "FULL_GOVERNANCE_ADMISSION")
    observed = {(item["category"], item["detail"], int(item["count"])) for item in result["items"]}
    expected = expected or set()
    assert observed == expected, (observed, expected)
    assert int(result["blockerCount"]) == len(expected)
    return result


def full_empty_lane() -> None:
    reset_database()
    bootstrap_and_prefix()
    clone_database(DATABASE, PREFIX_TEMPLATE)
    source("I")
    psql_sql(oracle.f_seed_snapshot_sql())
    source("F")
    psql_sql(oracle.f_seed_boundary_sql(False) + oracle.f_function_postflight_sql())
    source("D")
    assert_task7_admission()
    assert_6d2_admission()
    source("6D2")
    psql_sql(oracle.complete_postflight_sql())
    downstream(False)
    print("PASS LANE full-empty exact first33 -> I/F/D/6D2 -> role-key/all6E; F boundary is three-pair reduced seed")


def seeded_whole_lane() -> None:
    reset_database()
    bootstrap_and_prefix()
    admission = load_script("canonical-import-admission-selftest.py")
    psql_sql(admission.main_seed() + oracle.preservation_snapshot_sql() + oracle.stage_snapshot_sql("i_first", False))
    source("I")
    psql_sql(oracle.stage_preserved_sql("i_first"))
    psql_sql(oracle.six_pair_seed_sql())
    psql_sql(oracle.stage_snapshot_sql("f_first", True))
    source("F")
    psql_sql(oracle.stage_preserved_sql("f_first", ("roles", "permissions", "role_permissions")))
    psql_sql(oracle.f_seed_boundary_sql(True, snapshot=True) + oracle.f_function_postflight_sql())
    psql_sql(oracle.stage_snapshot_sql("f_seed_repeat", True))
    source("F")
    psql_sql(oracle.stage_preserved_sql("f_seed_repeat") + oracle.f_seed_repeat_sql() + oracle.f_function_postflight_sql())
    psql_sql(oracle.stage_snapshot_sql("d_first", True))
    source("D")
    psql_sql(oracle.stage_preserved_sql("d_first"))
    psql_sql(oracle.consumer_behavior_sql() + oracle.lifecycle_seed_sql() + oracle.control_filter_fixture_sql() + oracle.filter_behavior_sql())
    assert_task7_admission()
    assert_6d2_admission()
    clone_database(DATABASE, PRE6D2_TEMPLATE)
    psql_sql(oracle.stage_snapshot_sql("g_first", True))
    source("6D2")
    psql_sql(oracle.stage_preserved_sql("g_first", ("user_roles", "user_profiles")) + oracle.user_roles_delta_sql("g_first") + oracle.user_profiles_delta_sql("g_first") + oracle.lifecycle_checks_sql() + oracle.complete_postflight_sql() + oracle.control_behavior_sql() + oracle.preservation_checks_sql())
    clone_database(DATABASE, POST6D2_TEMPLATE)
    psql_sql(oracle.validate_synthetic_fks_sql())

    # Repeat all four originals at their pre-6E boundary. 6D2 restores the final
    # winner after I/F/D replay; source files remain unwrapped/autocommitted.
    psql_sql(oracle.stage_snapshot_sql("i_repeat", True)); source("I"); psql_sql(oracle.stage_preserved_sql("i_repeat"))
    psql_sql(oracle.stage_snapshot_sql("f_repeat", True)); source("F"); psql_sql(oracle.stage_preserved_sql("f_repeat") + oracle.f_function_postflight_sql())
    psql_sql(oracle.stage_snapshot_sql("d_repeat", True)); source("D"); psql_sql(oracle.stage_preserved_sql("d_repeat"))
    assert_task7_admission()
    assert_6d2_admission()
    psql_sql(oracle.stage_snapshot_sql("g_repeat", True))
    source("6D2")
    psql_sql(oracle.stage_preserved_sql("g_repeat") + oracle.lifecycle_checks_sql(repeat=True) + oracle.complete_postflight_sql(raw_not_valid=False))
    downstream(True)
    psql_sql(oracle.preservation_checks_sql())
    print("PASS LANE explicit six-pair whole prefix, two tenants, consumers, preservation, all-source repeat and downstream composition")


def catalog_fingerprint() -> str:
    sql = """select md5(string_agg(v,'|' order by v)) from (
select 'c:'||c.oid||':'||c.relkind||':'||c.relname||':'||c.relowner||':'||coalesce(c.relacl::text,'')||':'||coalesce(c.reloptions::text,'') v from pg_class c where c.relnamespace in ('public'::regnamespace,'auth'::regnamespace)
union all select 'a:'||attrelid||':'||attnum||':'||attname||':'||atttypid||':'||atttypmod||':'||attnotnull||':'||attidentity||':'||attgenerated||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace,'auth'::regnamespace)) and attnum>0 and not attisdropped
union all select 'k:'||oid||':'||conname||':'||conrelid||':'||confrelid||':'||convalidated||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace in ('public'::regnamespace,'auth'::regnamespace)
union all select 'i:'||indexrelid||':'||indrelid||':'||indisvalid||':'||indisready||':'||indislive||':'||pg_get_indexdef(indexrelid) from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace,'auth'::regnamespace))
union all select 'p:'||oid||':'||polrelid||':'||polname||':'||polcmd||':'||polpermissive||':'||polroles::text||':'||coalesce(pg_get_expr(polqual,polrelid),'')||':'||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy
union all select 'f:'||oid||':'||proname||':'||pg_get_function_identity_arguments(oid)||':'||prorettype||':'||proretset||':'||prosecdef||':'||provolatile||':'||proowner||':'||coalesce(proconfig::text,'')||':'||coalesce(proacl::text,'')||':'||md5(prosrc) from pg_proc where pronamespace in ('public'::regnamespace,'auth'::regnamespace)
union all select 't:'||oid||':'||tgrelid||':'||tgname||':'||tgfoid||':'||tgtype||':'||tgattr||':'||tgenabled from pg_trigger where not tgisinternal
) x;"""
    parts = [psql_scalar(sql)]
    for relation in (
        "auth.users", "companies", "customers", "customer_contacts", "customer_addresses",
        "customer_sites", "metering_points", "customer_contracts", "customer_contract_events",
        "powers_of_attorney", "supplier_switch_requests", "supplier_switch_events",
        "billing_underlays", "contract_offers", "contract_offer_versions",
        "company_memberships", "company_invitations", "roles", "permissions",
        "role_permissions", "user_profiles", "user_roles", "customer_import_batches",
        "customer_import_rows",
    ):
        relation_oid = psql_scalar(f"select coalesce(to_regclass({oracle.q(relation)})::text,'');")
        parts.append(f"{relation}:{relation_oid}")
        if relation_oid:
            parts.append(psql_scalar(f"select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from {relation} t;"))
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()


DIRTY_CASES = {
    "missing_auth_user_parent": (
        "drop table auth.users cascade;",
        {("6d2_user_parent_shape", "auth.users.id", 1)},
    ),
    "wrong_auth_user_parent_key": (
        "drop table auth.users cascade; create table auth.users(id text primary key);",
        {("6d2_user_parent_shape", "auth.users.id", 1)},
    ),
    "missing_roles_parent": (
        "drop table roles cascade;",
        {("6d2_role_reference_shape", "roles.id/key", 1)},
    ),
    "missing_user_roles_relation": (
        "drop table user_roles cascade;",
        {("6d2_role_reference_shape", "user_roles.user_id/role_id", 1)},
    ),
    "missing_user_profiles_relation": (
        "drop table user_profiles cascade;",
        {("6d2_profile_shape", "user_profiles.user_status", 1)},
    ),
    "invalid_role_status": (
        "update user_roles set status='unsupported' where id='91000000-0000-0000-0000-000000000011'; select test_assert((select status='unsupported' from user_roles where id='91000000-0000-0000-0000-000000000011'),'role dirty setup reached intended row');",
        {("6d2_role_status", "user_roles.status", 1)},
    ),
    "invalid_profile_status": (
        "alter table user_profiles drop constraint user_profiles_user_status_check; update user_profiles set user_status='unsupported' where id='10000000-0000-0000-0000-000000000011';",
        {("6d2_profile_status", "user_profiles.user_status", 1)},
    ),
    "missing_role_id": (
        "alter table user_roles drop column role_id cascade;",
        {("6d2_role_reference_shape", "user_roles.user_id/role_id", 1)},
    ),
    "missing_role_key": (
        "alter table roles drop column key cascade;",
        {("6d2_role_reference_shape", "roles.id/key", 1)},
    ),
    "missing_membership_role": (
        "alter table company_memberships drop column membership_role cascade;",
        {("6d2_membership_shape", "company_memberships.membership_role", 1)},
    ),
    "missing_policy_target": (
        "drop table audit_logs cascade;",
        {("6d2_policy_target", "audit_logs", 1)},
    ),
    "missing_company_id": (
        "alter table audit_logs drop column company_id cascade;",
        {("6d2_company_column", "audit_logs", 1)},
    ),
    "setof_helper_replaced_by_scalar": (
        "drop function gridex_user_company_ids() cascade; create function gridex_user_company_ids() returns uuid language sql as $$select null::uuid$$;",
        {("6d2_helper_shape", "gridex_user_company_ids()", 1)},
    ),
    "helper_wrong_argument_name": (
        "drop function gridex_can_read_company(uuid) cascade; create function gridex_can_read_company(wrong_name uuid) returns boolean language sql as $$select true$$;",
        {("6d2_helper_shape", "gridex_can_read_company(uuid)", 1)},
    ),
    "rpc_wrong_return_shape": (
        "create function gridex_companies_missing_ediel_profile() returns boolean language sql as $$select true$$;",
        {("6d2_rpc_shape", "gridex_companies_missing_ediel_profile()", 1)},
    ),
    "rpc_missing_column": (
        "alter table ediel_actor_settings drop column is_active cascade;",
        {("6d2_rpc_view_column", "ediel_actor_settings:is_active:boolean", 1)},
    ),
    "journal_wrong_shape": (
        "create table platform_session_revocations(id uuid primary key);",
        {
            ("6d2_journal_shape", "platform_session_revocations columns", 1),
            ("6d2_journal_reference", "platform_session_revocations FKs", 1),
            ("6d2_journal_default", "platform_session_revocations defaults", 1),
        },
    ),
    "journal_wrong_index": (
        "create table platform_session_revocations(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,revoked_by uuid references auth.users(id) on delete set null,reason text,revoked_at timestamptz not null default now(),metadata jsonb not null default '{}'); create index platform_session_revocations_user_idx on platform_session_revocations(user_id);",
        {("6d2_journal_index", "platform_session_revocations_user_idx", 1)},
    ),
    "journal_index_name_is_table": (
        "create table platform_session_revocations(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,revoked_by uuid references auth.users(id) on delete set null,reason text,revoked_at timestamptz not null default now(),metadata jsonb not null default '{}'); create table platform_session_revocations_user_idx(id uuid);",
        {("6d2_journal_index", "platform_session_revocations_user_idx", 1)},
    ),
    "wrong_completion_index": (
        "create index customer_operation_tasks_assigned_company_status_idx on customer_operation_tasks(company_id,status);",
        {("6d2_completion_index", "customer_operation_tasks_assigned_company_status_idx", 1)},
    ),
    "wrong_existing_view": (
        "create view metering_billing_audit_overview as select null::text company_id;",
        {("6d2_view_shape", "metering_billing_audit_overview", 1)},
    ),
    "unexpected_update_trigger": (
        "create function dirty_role_trigger() returns trigger language plpgsql as $$begin return new; end$$; create trigger dirty_role_update before update on user_roles for each row execute function dirty_role_trigger();",
        {("6d2_unexpected_mutating_trigger", "user_roles UPDATE", 1)},
    ),
}


def dirty_admission_lanes() -> None:
    for name, (mutation, expected) in DIRTY_CASES.items():
        reset_database(template=PRE6D2_TEMPLATE)
        psql_sql(mutation)
        before = catalog_fingerprint()
        assert_6d2_admission(expected)
        after = catalog_fingerprint()
        assert before == after, f"admission mutated catalog: {name}"
        print(f"PASS DIRTY 6D2 {name} exact diagnostics and unchanged catalog")


def task7_observation(task7) -> set[tuple[str, str, int]]:
    result = admission_result(task7.checker_sql(), "IMPORT_ADMISSION")
    return task7.blockers(result)


def relationship_setup(task7, edge: tuple[str, str, str], mode: str) -> str:
    child, foreign_key, parent = edge
    parent_id = task7.CU1
    orphan_id = "99000000-0000-0000-0000-000000000099"
    extras = {
        "customer_sites": {"customer_id": "uuid", "facility_id": "text"},
        "metering_points": {"site_id": "uuid", "meter_point_id": "text"},
        "customer_contracts": {"customer_id": "uuid", "contract_offer_id": "uuid", "created_at": "timestamptz", "status": "text"},
        "supplier_switch_requests": {"customer_id": "uuid"},
    }
    chunks: list[str] = []
    for table in (parent, child):
        if table == "customers" or any(f"create table {table}(" in item for item in chunks):
            continue
        columns = {"company_id": "uuid"}
        columns.update(extras.get(table, {}))
        if table == child:
            columns[foreign_key] = "uuid"
        definition = ",".join(f"{name} {kind}" for name, kind in columns.items())
        chunks.append(f"create table {table}(id uuid primary key,{definition});")
        if table == parent:
            chunks.append(f"insert into {parent}(id,company_id) values ('{parent_id}','{task7.C1}');")
    company = "null" if mode == "null" else oracle.q(task7.C2 if mode == "wrong" else task7.C1)
    foreign = oracle.q(orphan_id if mode == "orphan" else parent_id)
    chunks.append(f"insert into {child}(id,company_id,{foreign_key}) values ('99000000-0000-0000-0000-000000000001',{company},{foreign});")
    return "\n".join(chunks)


def reduced_relationship_lanes() -> None:
    task7 = load_script("canonical-import-admission-selftest.py")
    edges = sorted(set(edge for group in task7.JOINS.values() for edge in group))
    for edge in edges:
        child, foreign_key, _parent = edge
        units = {unit for unit, group in task7.JOINS.items() if edge in group}
        for mode, category in (("null", "would_change_ownership"), ("wrong", "conflicting_ownership"), ("orphan", "orphan_ownership_parent")):
            reset_database()
            psql_sql(task7.reduced_setup() + relationship_setup(task7, edge, mode))
            before = catalog_fingerprint()
            expected = {(category, f"{unit}:{child}.{foreign_key}", 1) for unit in units}
            assert task7_observation(task7) == expected, (edge, mode, task7_observation(task7), expected)
            assert catalog_fingerprint() == before
            print(f"PASS REDUCED RELATIONSHIP {mode} {child}.{foreign_key} exact source-unit blockers and unchanged snapshot")


def reduced_compatibility_lanes() -> None:
    task7 = load_script("canonical-import-admission-selftest.py")
    cases = task7.dirty_cases()
    for name in ("wrong_default", "version_type", "wrong_check", "wrong_index", "foreign_collision", "legacy_batch"):
        mutation, expected = cases[name]
        reset_database()
        psql_sql(task7.reduced_setup() + mutation)
        before = catalog_fingerprint()
        assert task7_observation(task7) == expected, (name, task7_observation(task7), expected)
        assert catalog_fingerprint() == before
        print(f"PASS REDUCED SHAPE {name} exact rejection and unchanged snapshot")

    # Existing first-I imports are retained because CREATE IF NOT EXISTS skips them.
    reset_database(template=PREFIX_TEMPLATE)
    psql_sql(task7.main_seed() + task7.table_sql("I", task7.BATCH) + task7.table_sql("I", task7.ROW) + f"select test_assert(exists(select 1 from companies c join auth.users u on u.id='{task7.U1}' join company_memberships m on m.company_id=c.id and m.user_id=u.id where c.id='{task7.C1}'),'first-I history parent company/actor/membership fixture ready'); insert into customer_import_batches(id,company_id,source_type,file_name,created_by) values ('{task7.B1}','{task7.C1}','manual','history','{task7.U1}'); insert into customer_import_rows(id,import_batch_id,company_id,row_number) values ('99000000-0000-0000-0000-000000000010','{task7.B1}','{task7.C1}',7); create table reduced_i_before as select tableoid as source_table_oid,id,to_jsonb(t) value from customer_import_batches t union all select tableoid,id,to_jsonb(t) from customer_import_rows t;")
    source("I")
    psql_sql(oracle.check("not exists((select source_table_oid,id,value from reduced_i_before) except (select tableoid,id,to_jsonb(t) from customer_import_batches t union all select tableoid,id,to_jsonb(t) from customer_import_rows t))", "first I preserves existing import history table OIDs and values") + oracle.check("(select count(*)=2 from reduced_i_before) and (select count(*) from customer_import_batches)+(select count(*) from customer_import_rows)=(select count(*) from reduced_i_before)", "first I retained both history rows"))

    # F maps the sole legacy batch_id name and preserves row/index/FK identities.
    reset_database(template=PRE6D2_TEMPLATE)
    psql_sql("alter table customer_import_rows rename column import_batch_id to batch_id; create table reduced_batch_before as select c.oid table_oid,i.indexrelid index_oid,k.oid fk_oid from pg_class c join pg_index i on i.indrelid=c.oid and i.indexrelid='customer_import_rows_batch_idx'::regclass join pg_constraint k on k.conrelid=c.oid and k.contype='f' and k.conkey=array[(select attnum from pg_attribute where attrelid=c.oid and attname='batch_id')]::smallint[] where c.oid='customer_import_rows'::regclass; create table reduced_batch_rows_before as select id,batch_id from customer_import_rows;")
    source("F")
    psql_sql(oracle.check("exists(select 1 from pg_attribute where attrelid='customer_import_rows'::regclass and attname='import_batch_id' and not attisdropped) and not exists(select 1 from pg_attribute where attrelid='customer_import_rows'::regclass and attname='batch_id' and not attisdropped)", "F batch_id-only compatibility rename exact") + oracle.check("not exists(select id,batch_id from reduced_batch_rows_before except select id,import_batch_id from customer_import_rows)", "F batch_id-only row values preserved") + oracle.check("not exists(select * from reduced_batch_before except select c.oid,i.indexrelid,k.oid from pg_class c join pg_index i on i.indrelid=c.oid and i.indexrelid='customer_import_rows_batch_idx'::regclass join pg_constraint k on k.conrelid=c.oid and k.contype='f' and k.conkey=array[(select attnum from pg_attribute where attrelid=c.oid and attname='import_batch_id')]::smallint[] where c.oid='customer_import_rows'::regclass)", "F rename preserves table/index/FK OIDs"))

    reset_database(template=PRE6D2_TEMPLATE)
    psql_sql("alter table customer_import_rows add column batch_id uuid;")
    before = catalog_fingerprint()
    expected = {("legacy_batch_id_requires_mapping", "", 1)}
    assert task7_observation(task7) == expected
    assert catalog_fingerprint() == before
    print("PASS REDUCED SHAPE both batch names rejected unchanged")

    reset_database(template=PRE6D2_TEMPLATE)
    psql_sql("update company_invitations set token=null where id=(select id from company_invitations order by id limit 1); create table legacy_null_invitation as select id from company_invitations where token is null order by id limit 1;")
    source("F")
    psql_sql("insert into company_invitations(company_id,email,role,created_by) select company_id,'future-token@example.invalid','member',created_by from company_invitations limit 1;" + oracle.check("(select count(*)=1 from legacy_null_invitation l join company_invitations i using(id) where i.token is null)", "F preserves nullable legacy NULL invitation token") + oracle.check("(select token is not null from company_invitations where email='future-token@example.invalid')", "F/prerequisite future invitation receives token default"))

    # RPC reduced guards: one route relation, no route relations, and caught missing column.
    reset_database(template=POST6D2_TEMPLATE)
    psql_sql("drop table ediel_route_profiles cascade;" + oracle.check("(select array_agg(id order by id)=array['22000000-0000-0000-0000-000000000004'::uuid,'22000000-0000-0000-0000-000000000007'::uuid] from gridex_companies_missing_route_setup() where id::text like '22000000-%')", "RPC one-route-table branch exact"))
    reset_database(template=POST6D2_TEMPLATE)
    psql_sql("drop table ediel_route_profiles,communication_routes cascade;" + oracle.check("(select array_agg(id order by id)=array['22000000-0000-0000-0000-000000000003'::uuid,'22000000-0000-0000-0000-000000000004'::uuid,'22000000-0000-0000-0000-000000000005'::uuid,'22000000-0000-0000-0000-000000000007'::uuid] from gridex_companies_missing_route_setup() where id::text like '22000000-%')", "RPC no-route-table branch returns every nonexcluded fixture company"))
    reset_database(template=POST6D2_TEMPLATE)
    psql_sql("alter table ediel_actor_settings drop column is_active cascade;" + oracle.check("(select count(*)=0 from gridex_companies_missing_ediel_profile())", "RPC caught undefined-column branch returns empty"))


def native_failure_lanes() -> None:
    admission = load_script("canonical-import-admission-selftest.py")

    # F's final filter replacement fails after earlier helpers/seeds/policies commit.
    reset_database(template=PREFIX_TEMPLATE)
    psql_sql(admission.main_seed())
    source("I")
    psql_sql(oracle.six_pair_seed_sql() + "create function admin_customer_ids_by_latest_contract(text,text,text,integer,integer,uuid) returns boolean language sql as $$select true$$; create table native_f_filter_before as select oid,prorettype,prosrc from pg_proc where oid='admin_customer_ids_by_latest_contract(text,text,text,integer,integer,uuid)'::regprocedure;")
    source("F", expected="42P13")
    psql_sql(oracle.check("to_regprocedure('gridex_user_can_manage_company(uuid)') is not null", "F late filter failure retains preceding helper unit") + oracle.check("(select count(*)=6 from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key in ('company_admin','super_admin') and p.key like 'tenants.%')", "F late filter failure retains preceding six seed pairs") + oracle.check("not exists(select * from native_f_filter_before except select oid,prorettype,prosrc from pg_proc where oid='admin_customer_ids_by_latest_contract(text,text,text,integer,integer,uuid)'::regprocedure)", "F failed final replacement preserves incompatible prior function OID/body"))

    # D's final view replacement fails after its table/check/FK/index/policy units.
    reset_database(template=PREFIX_TEMPLATE)
    psql_sql(admission.main_seed())
    source("I")
    psql_sql(oracle.six_pair_seed_sql()); source("F")
    psql_sql("create view gridex_debug_step1_2_schema_alignment_v as select null::uuid table_name,false exists_in_db,false rls_enabled,null::text check_status; create table native_d_view_before as select c.oid,a.atttypid from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attname='table_name' where c.oid='gridex_debug_step1_2_schema_alignment_v'::regclass;")
    source("D", expected="42P16")
    psql_sql(oracle.check("to_regclass('customer_import_rows_company_status_created_idx') is not null", "D late view failure retains preceding index unit") + oracle.check("exists(select 1 from pg_constraint where conname='customer_import_rows_parser_confidence_check')", "D late view failure retains preceding check unit") + oracle.check("not exists(select * from native_d_view_before except select c.oid,a.atttypid from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attname='table_name' where c.oid='gridex_debug_step1_2_schema_alignment_v'::regclass)", "D failed final replacement preserves prior view OID/type"))

    # I ownership DO: the first FK DO commits; the later unguarded join fails.
    reset_database(template=PRE6D2_TEMPLATE)
    psql_sql("drop table customer_import_rows,customer_import_batches cascade; alter table customer_contacts drop constraint if exists customer_contacts_company_id_fkey; alter table customer_contacts drop column customer_id cascade;")
    source("I", expected="42703")
    psql_sql(oracle.check("exists(select 1 from pg_constraint where conrelid='customer_contacts'::regclass and conname='customer_contacts_company_id_fkey')", "I preceding FK DO committed before ownership 42703") + oracle.check("to_regclass('customer_import_batches') is null", "I stopped before import CREATE"))

    # F unique-token statement fails natively; same-name-index admission remains separate.
    reset_database(template=PRE6D2_TEMPLATE)
    psql_sql("drop index company_invitations_token_key; update company_invitations set token='90000000-0000-0000-0000-000000000099';")
    source("F", expected="23505")
    psql_sql(oracle.check("not exists(select 1 from pg_class where oid=to_regclass('company_invitations_token_key'))", "F failed unique index unit rolled back") + oracle.check("(select count(distinct token)=1 from company_invitations)", "F duplicate token dirty rows retained"))

    # D drops the old check in one statement, then the replacement ADD fails.
    reset_database(template=PRE6D2_TEMPLATE)
    psql_sql("alter table customer_import_rows drop constraint customer_import_rows_status_check; insert into customer_import_rows(import_batch_id,company_id,row_number,status) values ('a1000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',500,'unsupported'); alter table customer_import_rows add constraint customer_import_rows_status_check check(status in ('pending','ready_to_create','requires_review','duplicate_warning','missing_fields','created','rejected','failed','skipped','linked_existing_customer','unsupported'));")
    source("D", expected="23514")
    psql_sql(oracle.check("not exists(select 1 from pg_constraint where conrelid='customer_import_rows'::regclass and conname='customer_import_rows_status_check')", "D old check DROP committed; failing ADD rolled back") + oracle.check("exists(select 1 from customer_import_rows where status='unsupported')", "D dirty row retained after native failure"))

    # 6D2 first DO is atomic: invalid status blocks the check replacement and UPDATE.
    reset_database(template=PRE6D2_TEMPLATE)
    psql_sql("update user_roles set status='unsupported',is_active=true where id='91000000-0000-0000-0000-000000000011'; select test_assert((select status='unsupported' and is_active from user_roles where id='91000000-0000-0000-0000-000000000011'),'6D2 native dirty setup reached intended row');" + oracle.native_6d2_snapshot_sql())
    source("6D2", expected="23514")
    psql_sql(oracle.native_6d2_rollback_sql())

    # Late 6D2 final DO: prior helpers/policies/triggers survive its 42703 rollback.
    reset_database(template=PRE6D2_TEMPLATE)
    psql_sql("alter table metering_values drop column value_status cascade;")
    source("6D2", expected="42703")
    psql_sql(oracle.check("to_regprocedure('gridex_is_current_session_allowed()') is not null", "6D2 late failure retains earlier helpers") + oracle.check("(select count(*)=28 from pg_trigger where tgname like '%_tenant_operational_guard_trg' and not tgisinternal)", "6D2 late failure retains exact28 trigger effects") + oracle.check("to_regclass('metering_billing_audit_overview') is null", "6D2 failing final overview unit rolled back"))
    print("PASS NATIVE I/F/D/6D2 early/late autocommit characterization; clean clones used for every retry")


def contention_and_stale_lanes() -> None:
    reset_database(template=PRE6D2_TEMPLATE)
    command = ["psql", "-X", "-qAt", "--set=ON_ERROR_STOP=1", TARGET, "-f", "-"]
    with tempfile.TemporaryFile(mode="w+") as errors:
        holder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, text=True, env=environment(), cwd=ROOT)
        try:
            assert holder.stdin and holder.stdout
            holder.stdin.write("begin; lock table customer_import_rows in access exclusive mode; select 'LOCK_READY';\n")
            holder.stdin.flush()
            ready, _, _ = select.select([holder.stdout], [], [], 15)
            assert ready and holder.stdout.readline().strip() == "LOCK_READY", "lock holder readiness timeout"
            source("D", expected="55P03", lock_timeout="1s", timeout="10s")
            holder.stdin.write("rollback;\n")
            holder.stdin.close()
            holder.wait(timeout=10)
        finally:
            if holder.poll() is None:
                holder.kill()
                holder.wait(timeout=5)
    psql_sql("select 1 from customer_import_rows limit 1;")
    print("PASS CONTENTION real conflicting lock produced 55P03, holder released, committed prefix remained readable")

    reset_database(template=PRE6D2_TEMPLATE)
    assert_task7_admission()
    psql_sql("drop index customer_import_rows_batch_idx; create index customer_import_rows_batch_idx on customer_import_rows(company_id);")
    task7 = load_script("canonical-import-admission-selftest.py")
    result = admission_result(task7.checker_sql(), "IMPORT_ADMISSION")
    assert task7.blockers(result) == {("index_shape", "customer_import_rows_batch_idx", 1)}
    print("PASS STALE OBSERVATION writer changed prerequisite after checker; fresh admission rejected exact changed index")


def emit() -> None:
    manifest = contract.validate()
    print("-- SQL NOT EXECUTED. Fixed loopback PostgreSQL17 plan only; no URL or command input accepted.")
    print("-- WHOLE_SOURCE_MANIFEST " + json.dumps(manifest, sort_keys=True))
    print("-- LANE full-empty: exact first33 -> I -> F(three-pair boundary) -> D -> 6D2 -> role-key/all6E")
    print("-- LANE explicit-six-pair-preservation: exact first33 -> seeded rows -> I -> explicit super_admin -> F/F-repeat -> D -> 6D2 -> I/F/D/6D2-repeat -> role-key/all6E")
    print("-- LANE dirty/native/contention: clean pre6D2 clones; admission remains distinct from deliberate native-failure bypass")
    bootstrap = ROOT / "scripts/sql/gridex-supabase-compatible-bootstrap.sql"
    print(f"-- WHOLE_SOURCE_FILE_BEGIN bootstrap {contract.sha256(bootstrap)}")
    print(bootstrap.read_text())
    for relative in contract.prefix():
        path = ROOT / "supabase" / relative
        print(f"-- WHOLE_SOURCE_FILE_BEGIN {relative} {contract.sha256(path)}")
        print(path.read_text())
    for alias, (name, _lines, digest) in contract.WHOLE_SOURCES.items():
        print(f"-- WHOLE_SOURCE_FILE_BEGIN migrations/{name} {digest} alias={alias}")
        print((ROOT / "supabase/migrations" / name).read_text())
    for relative in contract.DOWNSTREAM:
        path = ROOT / "supabase" / relative
        print(f"-- WHOLE_SOURCE_FILE_BEGIN {relative} {contract.sha256(path)}")
        print(path.read_text())
    print("-- WHOLE_6D2_ADMISSION_BEGIN; SQL NOT EXECUTED")
    print(oracle.admission_sql())
    print("-- WHOLE_EXPLICIT_SEED_AND_BEHAVIOR_BEGIN; SQL NOT EXECUTED")
    print(oracle.six_pair_seed_sql() + oracle.consumer_behavior_sql() + oracle.lifecycle_seed_sql() + oracle.control_filter_fixture_sql() + oracle.filter_behavior_sql() + oracle.control_behavior_sql())
    print("-- WHOLE_REDUCED_LANES all-ten-joins:null/wrong/orphan; first-I-history; batch-id-only/both; wrong-shape; nullable-token; optional-F; RPC guarded branches; SQL NOT EXECUTED")
    print("-- WHOLE_DIRTY_CASES " + json.dumps({name: sorted(expected) for name, (_sql, expected) in DIRTY_CASES.items()}, sort_keys=True))
    print("-- WHOLE_NATIVE_FAILURES I:42703,F-unique:23505,F-late-filter:42P13,D-check:23514,D-late-view:42P16,6D2-first:23514,6D2-late:42703,contention:55P03; SQL NOT EXECUTED")
    print("-- WHOLE_POSTFLIGHT_BEGIN; SQL NOT EXECUTED")
    print(oracle.timeout_unit_regression_sql())
    print(oracle.function_acl_snapshot_sql())
    print(oracle.stage_preserved_sql("f_first", ("roles", "permissions", "role_permissions")))
    print(oracle.stage_preserved_sql("f_seed_repeat"))
    print(oracle.f_function_postflight_sql())
    print(oracle.native_6d2_snapshot_sql() + oracle.native_6d2_rollback_sql())
    print(oracle.complete_postflight_sql() + oracle.open_gates_sql())
    print("-- WHOLE_DOWNSTREAM_POSTFLIGHT_BEGIN; SQL NOT EXECUTED")
    print(downstream_checks_sql(True))


def execute() -> None:
    contract.validate()
    full_empty_lane()
    seeded_whole_lane()
    dirty_admission_lanes()
    reduced_relationship_lanes()
    reduced_compatibility_lanes()
    native_failure_lanes()
    contention_and_stale_lanes()
    print("OPEN: complete later selected chain ACL/RLS/access, retention, durable delivery, generated artifacts, runtime binding and parity were NOT EXECUTED")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--selection-only", action="store_true")
    modes.add_argument("--emit", action="store_true")
    args = parser.parse_args()
    if args.selection_only:
        print(json.dumps(contract.validate(), sort_keys=True))
    elif args.emit:
        emit()
    else:
        execute()


if __name__ == "__main__":
    main()
