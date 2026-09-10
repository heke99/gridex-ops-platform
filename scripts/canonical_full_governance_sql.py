"""SQL oracles for the fixed whole-source governance execution harness."""

from __future__ import annotations

import json
import re

import canonical_full_governance_contract as contract


C1 = "21000000-0000-0000-0000-000000000001"
C2 = "21000000-0000-0000-0000-000000000002"
U1 = "11000000-0000-0000-0000-000000000001"
U2 = "11000000-0000-0000-0000-000000000002"
SUPER_ROLE = "90000000-0000-0000-0000-000000000001"


def q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def check(condition: str, label: str) -> str:
    return f"select test_assert(({condition}), {q(label)});\n"


def timeout_matches_sql(actual: str, expected: str) -> str:
    """Compare trusted SQL duration expressions, independently of display units."""
    return f"({actual}::interval={expected}::interval and {expected}::interval>interval '0 seconds')"


def source_timeout_assertion_sql(lock_timeout: str, statement_timeout: str) -> str:
    return check(" and ".join(
        timeout_matches_sql(f"current_setting('{name}')", q(value))
        for name, value in (("lock_timeout", lock_timeout), ("statement_timeout", statement_timeout))
    ), "finite source timeouts active")


def timeout_unit_regression_sql() -> str:
    # Executed by hosted bootstrap using the same predicate as each source call.
    # Positive equality must accept equivalent units and reject wrong/zero limits.
    return check(f"""not exists(select 1 from (values
      ('2min','120s',true),('120000ms','120s',true),
      ('1000ms','1s',true),('10000ms','10s',true),
      ('1min','120s',false),('1ms','1s',false),
      ('0','120s',false),('120s','0',false),('0','0',false)
    ) t(actual,expected,accepted)
    where {timeout_matches_sql('actual', 'expected')} is distinct from accepted)""",
    "timeout units: equivalent durations accepted; wrong and disabled limits rejected")


def values(rows: tuple[tuple[str, str], ...]) -> str:
    return ",".join(f"({q(name)},{q(kind)}::regtype)" for name, kind in rows)


def _array(items: tuple[str, ...]) -> str:
    return "array[" + ",".join(q(item) for item in items) + "]::text[]"


def six_pair_seed_sql() -> str:
    return f"""-- EXPLICIT_SYNTHETIC_SUPER_ADMIN_SEED; not a canonical prerequisite.
insert into public.roles(id,key,name,description,is_system)
values ('{SUPER_ROLE}','super_admin','Synthetic super admin','Preserve synthetic metadata',true);
{f_seed_snapshot_sql()}
"""


def f_seed_snapshot_sql() -> str:
    return f"""
create table six_pair_super_before as
select id,key,name,description,is_system from public.roles where id='{SUPER_ROLE}';
create table six_pair_unrelated_grants_before as
select * from public.role_permissions;
create table f_roles_before as select * from public.roles;
create table f_permissions_before as select * from public.permissions;
"""


def f_seed_boundary_sql(expect_super_admin: bool, snapshot: bool = False) -> str:
    expected = 6 if expect_super_admin else 3
    missing = "false" if expect_super_admin else "true"
    suffix = """
select test_assert(not exists((select * from six_pair_super_before except select id,key,name,description,is_system from roles where id='90000000-0000-0000-0000-000000000001') union all (select id,key,name,description,is_system from roles where id='90000000-0000-0000-0000-000000000001' except select * from six_pair_super_before)),'synthetic super_admin ID and metadata preserved');
select test_assert(not exists(select * from six_pair_unrelated_grants_before except all select * from role_permissions),'unrelated grants preserved by F seed');
""" if expect_super_admin else ""
    snapshot_sql = "create table f_seed_pairs_after as select role_id,permission_id from role_permissions;\n" if snapshot else ""
    return f"""
select test_assert((select count(*)={expected} from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key in ('company_admin','super_admin') and p.key in ('tenants.read','tenants.write','tenants.invite')),'F boundary exact {expected} resolved tenant permission pairs');
select test_assert((select count(*)=3 from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='company_admin' and p.key in ('tenants.read','tenants.write','tenants.invite')),'F boundary exact company_admin three-pair seed');
select test_assert((not exists(select 1 from roles where key='super_admin'))={missing},'F boundary empty lane lacks super_admin; synthetic lane declares it explicitly');
select test_assert((select name='Bolagsansvarig' and description='Administrerar användare och dagliga flöden inom sitt eget elhandelsbolag.' and is_system from roles where key='company_admin'),'F source-defined company_admin metadata');
select test_assert((select count(*)=3 from permissions where key in ('tenants.read','tenants.write','tenants.invite')),'F exact permission keys retain stable identities');
select test_assert(not exists(select b.id,b.key from f_roles_before b where b.key in ('company_admin','super_admin') except select id,key from roles),'F company_admin/super_admin IDs remain stable');
select test_assert(not exists(select b.id,b.key from f_permissions_before b where b.key in ('tenants.read','tenants.write','tenants.invite') except select id,key from permissions),'F three permission IDs remain stable');
select test_assert(not exists(select * from f_roles_before where key not in ('company_admin','super_admin') except all select * from roles),'F unrelated role rows/metadata preserved exactly');
select test_assert(not exists(select * from f_permissions_before where key not in ('tenants.read','tenants.write','tenants.invite') except all select * from permissions),'F unrelated permission rows/metadata preserved exactly');
select test_assert(not exists((select id,key from roles) except (select id,key from f_roles_before union all select id,key from roles where key='company_admin')),'F role delta is exactly source company_admin insert/update');
select test_assert(not exists((select id,key from permissions) except (select id,key from f_permissions_before union all select id,key from permissions where key in ('tenants.read','tenants.write','tenants.invite'))),'F permission delta is exactly three source keys');
select test_assert(not exists((select role_id,permission_id from role_permissions) except (select role_id,permission_id from six_pair_unrelated_grants_before union all select r.id,p.id from roles r cross join permissions p where r.key in ('company_admin','super_admin') and p.key in ('tenants.read','tenants.write','tenants.invite'))),'F grant delta contains only the declared three/six pairs');
select test_assert((select name='Läsa bolag' and description='Kan se elhandelsbolag på plattformen.' from permissions where key='tenants.read') and (select name='Skapa och ändra bolag' and description='Kan skapa och uppdatera elhandelsbolag.' from permissions where key='tenants.write') and (select name='Bjuda in till bolag' and description='Kan bjuda in användare till ett elhandelsbolag.' from permissions where key='tenants.invite'),'F exact source-defined permission metadata');
{suffix}{snapshot_sql}"""


def f_seed_repeat_sql() -> str:
    return """
select test_assert(not exists((select * from f_seed_pairs_after except select role_id,permission_id from role_permissions) union all (select role_id,permission_id from role_permissions except select * from f_seed_pairs_after)),'F repeat preserves exact six-pair grant set and all unrelated grants');
""" + f_seed_boundary_sql(True)


def admission_sql() -> str:
    """Read-only 6D2 admission. Every item is an exact named/count blocker."""
    targets = _array(contract.POLICY_TARGETS)
    triggers = _array(contract.TRIGGER_TARGETS)
    signatures = _array(contract.FUNCTION_SIGNATURES)
    return f"""begin isolation level repeatable read read only;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local idle_in_transaction_session_timeout='15s';
set local row_security=off;
do $admission$
declare items jsonb := '[]'::jsonb; n bigint; target text; signature text;
  role_columns_ok boolean; role_parent_ok boolean; user_parent_ok boolean;
  profile_status_ok boolean; journal_oid oid; journal_index_oid oid;
  same_name_exists boolean; exact_function_oid oid; helper_bad boolean;
begin
  user_parent_ok := to_regclass('auth.users') is not null
    and exists(select 1 from pg_class where oid=to_regclass('auth.users') and relkind='r' and not relispartition)
    and exists(select 1 from pg_attribute where attrelid=to_regclass('auth.users') and attname='id' and atttypid='uuid'::regtype and attnotnull and not attisdropped);
  if not user_parent_ok then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_user_parent_shape','detail','auth.users.id','count',1)); end if;
  role_parent_ok := to_regclass('public.roles') is not null
    and exists(select 1 from pg_class where oid=to_regclass('public.roles') and relkind='r' and not relispartition)
    and exists(select 1 from pg_attribute where attrelid=to_regclass('public.roles') and attname='id' and atttypid='uuid'::regtype and attnotnull and not attisdropped)
    and exists(select 1 from pg_attribute where attrelid=to_regclass('public.roles') and attname='key' and atttypid='text'::regtype and not attisdropped);
  if not role_parent_ok then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_role_reference_shape','detail','roles.id/key','count',1)); end if;
  role_columns_ok := to_regclass('public.user_roles') is not null
    and exists(select 1 from pg_attribute where attrelid=to_regclass('public.user_roles') and attname='user_id' and atttypid='uuid'::regtype and attnotnull and not attisdropped)
    and exists(select 1 from pg_attribute where attrelid=to_regclass('public.user_roles') and attname='role_id' and atttypid='uuid'::regtype and not attisdropped)
    and exists(select 1 from pg_attribute where attrelid=to_regclass('public.user_roles') and attname='status' and atttypid='text'::regtype and attnotnull and not attisdropped);
  if not role_columns_ok then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_role_reference_shape','detail','user_roles.user_id/role_id','count',1));
  else
    select count(*) into n from public.user_roles where status is null or status not in ('active','disabled','removed_from_company','invitation_revoked','locked_security');
    if n>0 then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_role_status','detail','user_roles.status','count',n)); end if;
    if user_parent_ok then
      select count(*) into n from public.user_roles ur left join auth.users u on u.id=ur.user_id where u.id is null;
      if n>0 then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_orphan_user','detail','user_roles.user_id','count',n)); end if;
    end if;
    if role_parent_ok then
      select count(*) into n from public.user_roles ur left join public.roles r on r.id=ur.role_id where ur.role_id is null or r.id is null;
      if n>0 then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_orphan_role','detail','user_roles.role_id','count',n)); end if;
    end if;
  end if;
  profile_status_ok := to_regclass('public.user_profiles') is not null and exists(select 1 from pg_attribute where attrelid=to_regclass('public.user_profiles') and attname='user_status' and atttypid='text'::regtype and attnotnull and not attisdropped);
  if not profile_status_ok then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_profile_shape','detail','user_profiles.user_status','count',1));
  else
    select count(*) into n from public.user_profiles where user_status is null or user_status not in ('active','disabled','removed_from_company','invitation_revoked','locked_security');
    if n>0 then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_profile_status','detail','user_profiles.user_status','count',n)); end if;
  end if;
  if to_regclass('public.company_memberships') is null or not exists(select 1 from pg_attribute where attrelid=to_regclass('public.company_memberships') and attname='membership_role' and atttypid='text'::regtype and not attisdropped)
  then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_membership_shape','detail','company_memberships.membership_role','count',1)); end if;
  foreach target in array {targets} loop
    if to_regclass('public.'||target) is null or not exists(select 1 from pg_class where oid=to_regclass('public.'||target) and relkind='r' and not relispartition) then
      items:=items||jsonb_build_array(jsonb_build_object('category','6d2_policy_target','detail',target,'count',1));
    elsif not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||target) and attname='company_id' and atttypid='uuid'::regtype and not attisdropped) then
      items:=items||jsonb_build_array(jsonb_build_object('category','6d2_company_column','detail',target,'count',1));
    end if;
  end loop;
  foreach target in array {triggers} loop
    if to_regclass('public.'||target) is null or not exists(select 1 from pg_class where oid=to_regclass('public.'||target) and relkind='r' and not relispartition) then
      items:=items||jsonb_build_array(jsonb_build_object('category','6d2_trigger_target','detail',target,'count',1));
    end if;
  end loop;

  journal_oid := to_regclass('public.platform_session_revocations');
  journal_index_oid := to_regclass('public.platform_session_revocations_user_idx');
  if journal_oid is not null then
   if not exists(select 1 from pg_class where oid=journal_oid and relkind='r' and not relispartition) or not (select count(*)=6 and string_agg(attname||':'||atttypid::regtype::text||':'||attnotnull::text,',' order by attnum)=
      'id:uuid:true,user_id:uuid:true,revoked_by:uuid:false,reason:text:false,revoked_at:timestamp with time zone:true,metadata:jsonb:true'
    from pg_attribute where attrelid=journal_oid and attnum>0 and not attisdropped)
   then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_journal_shape','detail','platform_session_revocations columns','count',1)); end if;
   if not exists(select 1 from pg_constraint where conrelid=journal_oid and contype='p' and conkey=array[(select attnum from pg_attribute where attrelid=journal_oid and attname='id')]::smallint[] and convalidated and not condeferrable)
   then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_journal_identity','detail','platform_session_revocations PK','count',1)); end if;
   if not (
     exists(select 1 from pg_constraint k where k.conrelid=journal_oid and k.contype='f' and k.conkey=array[(select attnum from pg_attribute where attrelid=journal_oid and attname='user_id')]::smallint[] and k.confrelid='auth.users'::regclass and k.confkey=array[(select attnum from pg_attribute where attrelid='auth.users'::regclass and attname='id')]::smallint[] and k.confdeltype='c' and k.confupdtype='a' and k.convalidated and not k.condeferrable)
     and exists(select 1 from pg_constraint k where k.conrelid=journal_oid and k.contype='f' and k.conkey=array[(select attnum from pg_attribute where attrelid=journal_oid and attname='revoked_by')]::smallint[] and k.confrelid='auth.users'::regclass and k.confkey=array[(select attnum from pg_attribute where attrelid='auth.users'::regclass and attname='id')]::smallint[] and k.confdeltype='n' and k.confupdtype='a' and k.convalidated and not k.condeferrable)
     and (select count(*)=2 from pg_constraint where conrelid=journal_oid and contype='f'))
   then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_journal_reference','detail','platform_session_revocations FKs','count',1)); end if;
   if exists(
    select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=journal_oid and a.attname in ('id','revoked_at','metadata') and
      pg_get_expr(d.adbin,d.adrelid) is distinct from case a.attname when 'id' then 'gen_random_uuid()' when 'revoked_at' then 'now()' else quote_literal('{{}}')||'::jsonb' end)
   then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_journal_default','detail','platform_session_revocations defaults','count',1)); end if;
  end if;
  if journal_index_oid is not null and not exists(
     select 1 from pg_index where indexrelid=journal_index_oid and indrelid=journal_oid
       and indisvalid and indisready and indislive and not indisunique and indpred is null and indexprs is null
       and pg_get_indexdef(indexrelid)='CREATE INDEX platform_session_revocations_user_idx ON public.platform_session_revocations USING btree (user_id, revoked_at DESC)')
  then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_journal_index','detail','platform_session_revocations_user_idx','count',1)); end if;

  foreach signature in array {signatures} loop
    select exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname=split_part(signature,'(',1) and prokind='f') into same_name_exists;
    exact_function_oid := to_regprocedure('public.'||signature);
    if same_name_exists and exact_function_oid is null then
      items:=items||jsonb_build_array(jsonb_build_object('category','6d2_helper_shape','detail',signature,'count',1));
    elsif exact_function_oid is not null then
      select not (prorettype=case when signature='gridex_user_company_ids()' then 'uuid'::regtype else 'boolean'::regtype end
        and proretset=(signature='gridex_user_company_ids()') and prokind='f'
        and coalesce(proargnames,array[]::text[])=case
          when signature='gridex_auth_has_any_role(text[])' then array['p_role_keys']::text[]
          when signature in ('gridex_company_status_is_writable(uuid)','gridex_can_read_company(uuid)','gridex_can_write_company(uuid)','gridex_user_can_manage_company(uuid)') then array['p_company_id']::text[]
          else array[]::text[] end) into helper_bad from pg_proc where oid=exact_function_oid;
      if helper_bad then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_helper_shape','detail',signature,'count',1)); end if;
    end if;
  end loop;
  exact_function_oid := to_regprocedure('public.gridex_assert_company_operational_for_write()');
  if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='gridex_assert_company_operational_for_write')
     and (exact_function_oid is null or exists(select 1 from pg_proc where oid=exact_function_oid and (prorettype<>'trigger'::regtype or proretset or prokind<>'f' or coalesce(proargnames,array[]::text[])<>array[]::text[])))
  then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_helper_shape','detail','gridex_assert_company_operational_for_write()','count',1)); end if;
  foreach signature in array array['gridex_companies_missing_ediel_profile','gridex_companies_missing_route_setup'] loop
    if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname=signature) and not exists(
      select 1 from pg_proc where pronamespace='public'::regnamespace and proname=signature and pronargs=0 and proretset and prorettype='record'::regtype
        and proallargtypes=array['uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid]::oid[]
        and proargmodes=array['t'::"char",'t'::"char",'t'::"char",'t'::"char",'t'::"char"] and proargnames=array['id','name','org_number','status','updated_at']::text[])
    then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_rpc_shape','detail',signature||'()','count',1)); end if;
  end loop;
  if to_regclass('public.metering_billing_audit_overview') is not null and (not exists(select 1 from pg_class where oid=to_regclass('public.metering_billing_audit_overview') and relkind='v') or not exists(
    select 1 from information_schema.columns where table_schema='public' and table_name='metering_billing_audit_overview'
    group by table_schema,table_name having string_agg(column_name||':'||data_type,',' order by ordinal_position)=
    'company_id:uuid,company_name:text,company_status:text,total_metering_values:integer,current_metering_values:integer,replaced_metering_values:integer,total_billing_underlays:integer,ready_underlays:integer,blocked_underlays:integer,total_partner_exports:integer,latest_activity_at:timestamp with time zone')
  ) then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_view_shape','detail','metering_billing_audit_overview','count',1)); end if;
  foreach target in array array['customer_operation_tasks_assigned_company_status_idx:CREATE INDEX customer_operation_tasks_assigned_company_status_idx ON public.customer_operation_tasks USING btree (company_id, assigned_to, status)','partner_exports_company_status_batch_idx:CREATE INDEX partner_exports_company_status_batch_idx ON public.partner_exports USING btree (company_id, status, export_batch_key)','metering_values_company_period_current_idx:CREATE INDEX metering_values_company_period_current_idx ON public.metering_values USING btree (company_id, metering_point_id, period_start, period_end, is_current)'] loop
    if to_regclass('public.'||split_part(target,':',1)) is not null and not exists(select 1 from pg_index where indexrelid=to_regclass('public.'||split_part(target,':',1)) and indisvalid and indisready and indislive and not indisunique and indpred is null and indexprs is null and pg_get_indexdef(indexrelid)=split_part(target,':',2))
    then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_completion_index','detail',split_part(target,':',1),'count',1)); end if;
  end loop;

  if to_regclass('public.user_roles') is not null and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.user_roles') and not tgisinternal and (tgtype&16)=16)
  then select count(*) into n from pg_trigger where tgrelid=to_regclass('public.user_roles') and not tgisinternal and (tgtype&16)=16;
       items:=items||jsonb_build_array(jsonb_build_object('category','6d2_unexpected_mutating_trigger','detail','user_roles UPDATE','count',n)); end if;
  if to_regclass('public.user_profiles') is not null and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.user_profiles') and not tgisinternal and (tgtype&16)=16)
  then select count(*) into n from pg_trigger where tgrelid=to_regclass('public.user_profiles') and not tgisinternal and (tgtype&16)=16;
       items:=items||jsonb_build_array(jsonb_build_object('category','6d2_unexpected_mutating_trigger','detail','user_profiles UPDATE','count',n)); end if;

  foreach target in array array['companies:id:uuid','companies:name:text','companies:org_number:text','companies:status:text','companies:updated_at:timestamptz','ediel_actor_settings:company_id:uuid','ediel_actor_settings:is_active:boolean','communication_routes:company_id:uuid','communication_routes:is_active:boolean','ediel_route_profiles:company_id:uuid','ediel_route_profiles:is_enabled:boolean','metering_values:company_id:uuid','metering_values:is_current:boolean','metering_values:value_status:text','metering_values:created_at:timestamptz','metering_values:metering_point_id:uuid','metering_values:period_start:timestamptz','metering_values:period_end:timestamptz','billing_underlays:company_id:uuid','billing_underlays:readiness_status:text','billing_underlays:status:text','billing_underlays:created_at:timestamptz','partner_exports:company_id:uuid','partner_exports:status:text','partner_exports:export_batch_key:text','partner_exports:created_at:timestamptz','customer_operation_tasks:company_id:uuid','customer_operation_tasks:assigned_to:uuid','customer_operation_tasks:status:text'] loop
    if to_regclass('public.'||split_part(target,':',1)) is null or not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||split_part(target,':',1)) and attname=split_part(target,':',2) and atttypid=split_part(target,':',3)::regtype and not attisdropped)
    then items:=items||jsonb_build_array(jsonb_build_object('category','6d2_rpc_view_column','detail',target,'count',1)); end if;
  end loop;
  raise warning 'FULL_GOVERNANCE_ADMISSION %', jsonb_build_object('blockerCount',jsonb_array_length(items),'items',items,'snapshot','REPEATABLE READ READ ONLY','finalGates','OPEN');
end $admission$;
rollback;
"""


def import_shape_sql() -> str:
    chunks = []
    for table, matrix in (("customer_import_batches", contract.IMPORT_BATCH_MATRIX),
                          ("customer_import_rows", contract.IMPORT_ROW_MATRIX)):
        rows = ",".join(
            f"({position},{q(name)},{q(kind)}::regtype,{str(required).lower()},{'null' if default is None else q(default)})"
            for position, name, kind, required, default in matrix
        )
        chunks.append(check(f"""(select count(*)=19 from pg_attribute where attrelid='public.{table}'::regclass and attnum>0 and not attisdropped)
          and not exists(select 1 from (values {rows}) expected(position,name,kind,required,default_expression)
            left join pg_attribute a on a.attrelid='public.{table}'::regclass and a.attnum=expected.position and a.attname=expected.name and not a.attisdropped
            left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
            where a.attnum is null or a.atttypid<>expected.kind or a.attnotnull<>expected.required
              or pg_get_expr(d.adbin,d.adrelid) is distinct from expected.default_expression)""",
            f"exact19 {table} positional type/nullability/default matrix"))
    return "".join(chunks)


def import_constraint_index_sql(raw_not_valid: bool = True) -> str:
    chunks = []
    for name, definition in contract.IMPORT_INDEXES.items():
        chunks.append(check(
            f"exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.{name}') and i.indisvalid and i.indisready and i.indislive and not i.indisunique and i.indpred is null and i.indexprs is null and pg_get_indexdef(i.indexrelid)={q(definition)})",
            f"exact import index keys/order/flags {name}",
        ))
    foreign_keys = (
        ("customer_import_batches","company_id","companies","c",True),
        ("customer_import_batches","created_by","auth.users","n",True),
        ("customer_import_rows","import_batch_id","customer_import_batches","c",True),
        ("customer_import_rows","company_id","companies","c",True),
        ("customer_import_rows","customer_id","customers","n",not raw_not_valid),
        ("customer_import_rows","reviewed_by","auth.users","n",not raw_not_valid),
    )
    for table, column, parent, delete_action, validated in foreign_keys:
        schema_parent = parent if "." in parent else "public." + parent
        chunks.append(check(f"""exists(select 1 from pg_constraint k where k.conrelid='public.{table}'::regclass and k.contype='f'
          and k.conkey=array[(select attnum from pg_attribute where attrelid=k.conrelid and attname='{column}')]::smallint[]
          and k.confrelid='{schema_parent}'::regclass and k.confkey=array[(select attnum from pg_attribute where attrelid=k.confrelid and attname='id')]::smallint[]
          and k.confdeltype='{delete_action}' and k.confupdtype='a' and k.convalidated={str(validated).lower()} and not k.condeferrable)""",
          f"exact import FK {table}.{column} parent/action/raw validation"))
    chunks.extend((
        check("not exists(select 1 from pg_constraint k where k.conrelid='customer_import_rows'::regclass and k.contype='f' and k.conkey=array[(select attnum from pg_attribute where attrelid=k.conrelid and attname='possible_existing_customer_id')]::smallint[])", "source deliberately leaves possible_existing_customer_id FK OPEN"),
        check("(select count(*)=1 and bool_and(convalidated) and bool_and(pg_get_constraintdef(oid)='CHECK ((status = ANY (ARRAY[''previewed''::text, ''imported''::text, ''partially_imported''::text, ''completed''::text, ''failed''::text])))') from pg_constraint where conrelid='customer_import_batches'::regclass and conname='customer_import_batches_status_check')", "exact D batch status check expression/validation"),
        check("(select count(*)=1 and bool_and(convalidated) and bool_and(pg_get_constraintdef(oid)='CHECK ((status = ANY (ARRAY[''pending''::text, ''ready_to_create''::text, ''requires_review''::text, ''duplicate_warning''::text, ''missing_fields''::text, ''created''::text, ''rejected''::text, ''failed''::text, ''skipped''::text, ''linked_existing_customer''::text])))') from pg_constraint where conrelid='customer_import_rows'::regclass and conname='customer_import_rows_status_check')", "exact D row status check expression/validation"),
        check("(select count(*)=1 and bool_and(convalidated) and bool_and(pg_get_constraintdef(oid)='CHECK (((parser_confidence IS NULL) OR ((parser_confidence >= 0) AND (parser_confidence <= 100))))') from pg_constraint where conrelid='customer_import_rows'::regclass and conname='customer_import_rows_parser_confidence_check')", "exact D confidence check expression/validation"),
        check("not exists(select 1 from (values ('customer_import_batches_rows_total_check','rows_total'),('customer_import_batches_rows_created_check','rows_created'),('customer_import_batches_rows_failed_check','rows_failed')) e(name,column_name) left join pg_constraint k on k.conrelid='customer_import_batches'::regclass and k.conname=e.name where k.oid is null or not k.convalidated or pg_get_constraintdef(k.oid)<>format('CHECK ((%I >= 0))',e.column_name))", "three exact I nonnegative original counter checks retained"),
    ))
    return "".join(chunks)


def source_target_sql() -> str:
    chunks = []
    for table in contract.I_TARGETS:
        chunks.append(check(
            f"exists(select 1 from pg_attribute where attrelid='public.{table}'::regclass and attname='company_id' and atttypid='uuid'::regtype and not attisdropped) and exists(select 1 from pg_index where indexrelid=to_regclass('public.{table}_company_id_idx') and indisvalid and indisready and indislive and not indisunique and indpred is null and indexprs is null and pg_get_indexdef(indexrelid)={q(f'CREATE INDEX {table}_company_id_idx ON public.{table} USING btree (company_id)')})",
            f"I complete branch company column/index {table}",
        ))
    for table in contract.F_PRESENT:
        chunks.append(check(
            f"exists(select 1 from pg_attribute where attrelid='public.{table}'::regclass and attname='company_id' and atttypid='uuid'::regtype and not attisdropped) and pg_get_indexdef(to_regclass('public.{table}_company_id_idx'))={q(f'CREATE INDEX {table}_company_id_idx ON public.{table} USING btree (company_id)')}",
            f"F actual-prefix branch exact company index {table}",
        ))
    return "".join(chunks)


def policy_trigger_sql() -> str:
    targets = _array(contract.POLICY_TARGETS)
    trigger_targets = _array(contract.TRIGGER_TARGETS)
    return check(f"""not exists(select 1 from unnest({targets}) target cross join unnest(array['select','insert','update','delete']) action
      left join pg_policy p on p.polrelid=to_regclass('public.'||target) and p.polname=target||'_tenant_'||action
      where p.oid is null or not p.polpermissive or p.polroles<>array[0]::oid[]
        or p.polcmd<>case action when 'select' then 'r' when 'insert' then 'a' when 'update' then 'w' else 'd' end
        or (action='select' and pg_get_expr(p.polqual,p.polrelid)<>'gridex_can_read_company(company_id)')
        or (action='insert' and pg_get_expr(p.polwithcheck,p.polrelid)<>'gridex_can_write_company(company_id)')
        or (action='update' and (pg_get_expr(p.polqual,p.polrelid)<>'gridex_can_read_company(company_id)' or pg_get_expr(p.polwithcheck,p.polrelid)<>'gridex_can_write_company(company_id)'))
        or (action='delete' and pg_get_expr(p.polqual,p.polrelid)<>'gridex_user_is_platform_admin()'))""",
        "all116 generic policy names/commands/roles/permissiveness/expressions") + check(
        """not exists(select 1 from (values
          ('companies','companies_tenant_select','r'),('companies','companies_super_admin_write','*'),
          ('company_memberships','company_memberships_tenant_select','r'),('company_memberships','company_memberships_tenant_write','*'),
          ('company_invitations','company_invitations_tenant_select','r'),('company_invitations','company_invitations_tenant_write','*'),
          ('tenant_governance_events','tenant_governance_events_select','r'),('tenant_governance_events','tenant_governance_events_write','*')
        ) e(tab,name,cmd) left join pg_policy p on p.polrelid=to_regclass('public.'||e.tab) and p.polname=e.name
        where p.oid is null or not p.polpermissive or p.polroles<>array[0]::oid[] or p.polcmd<>e.cmd)""",
        "all eight bespoke 6D2 policy identities/commands/roles/permissiveness",
    ) + check(f"""not exists(select 1 from unnest({trigger_targets}) target
      left join pg_trigger t on t.tgrelid=to_regclass('public.'||target) and t.tgname=target||'_tenant_operational_guard_trg' and not t.tgisinternal
      where t.oid is null or t.tgtype<>23 or t.tgenabled<>'O' or t.tgfoid<>'public.gridex_assert_company_operational_for_write()'::regprocedure
        or array(select unnest(t.tgattr))<>array[(select attnum from pg_attribute where attrelid=t.tgrelid and attname='company_id')]::smallint[])""",
      "all28 trigger identities/events/function bindings/UPDATE OF company_id")


def bespoke_policy_expression_sql() -> str:
    """Let PostgreSQL deparse source-literal expected policies, then compare."""
    return """begin;
create table public.task9_expected_company(id uuid,company_id uuid,user_id uuid);
create policy exp_companies_select on public.task9_expected_company for select using (public.gridex_user_is_platform_admin() or id in (select * from public.gridex_user_company_ids()));
create policy exp_companies_write on public.task9_expected_company for all using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin());
create policy exp_memberships_select on public.task9_expected_company for select using (public.gridex_user_is_platform_admin() or user_id=auth.uid() or public.gridex_can_read_company(company_id));
create policy exp_manage_write on public.task9_expected_company for all using (public.gridex_user_can_manage_company(company_id)) with check (public.gridex_user_can_manage_company(company_id));
create policy exp_invitations_select on public.task9_expected_company for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
create policy exp_governance_select on public.task9_expected_company for select using (public.gridex_user_is_platform_admin() or company_id in (select * from public.gridex_user_company_ids()));
create policy exp_admin_write on public.task9_expected_company for all using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin());
select test_assert(not exists(select 1 from (values
 ('companies','companies_tenant_select','exp_companies_select'),('companies','companies_super_admin_write','exp_companies_write'),
 ('company_memberships','company_memberships_tenant_select','exp_memberships_select'),('company_memberships','company_memberships_tenant_write','exp_manage_write'),
 ('company_invitations','company_invitations_tenant_select','exp_invitations_select'),('company_invitations','company_invitations_tenant_write','exp_manage_write'),
 ('tenant_governance_events','tenant_governance_events_select','exp_governance_select'),('tenant_governance_events','tenant_governance_events_write','exp_admin_write')
) e(tab,actual_name,expected_name)
join pg_policy actual on actual.polrelid=to_regclass('public.'||e.tab) and actual.polname=e.actual_name
join pg_policy expected on expected.polrelid='public.task9_expected_company'::regclass and expected.polname=e.expected_name
where pg_get_expr(actual.polqual,actual.polrelid) is distinct from pg_get_expr(expected.polqual,expected.polrelid)
   or pg_get_expr(actual.polwithcheck,actual.polrelid) is distinct from pg_get_expr(expected.polwithcheck,expected.polrelid)),'all eight bespoke policy expressions equal PostgreSQL-deparsed immutable source literals');
rollback;
"""


def _function_body(alias: str, name: str) -> str:
    filename = contract.WHOLE_SOURCES[alias][0]
    text = (contract.MIGRATIONS / filename).read_text()
    match = re.search(
        rf"create or replace function public\.{re.escape(name)}\([^;]*?\)\n.*?\bas \$\$(.*?)\$\$;",
        text,
        re.S | re.I,
    )
    assert match, (alias, name)
    return match.group(1)


# The managed bootstrap supplies the three client grants in addition to the
# PostgreSQL PUBLIC/owner defaults. None of I/F/D/6D2/retained 6E changes these
# target function grants; first33 revocations affect other permission helpers.
MANAGED_FUNCTION_ACL = (
    ("PUBLIC", "EXECUTE", False, "postgres"),
    ("anon", "EXECUTE", False, "postgres"),
    ("authenticated", "EXECUTE", False, "postgres"),
    ("postgres", "EXECUTE", False, "postgres"),
    ("service_role", "EXECUTE", False, "postgres"),
)


def normalized_function_acl_sql() -> str:
    # A NULL ACL means PostgreSQL's built-in defaults, not an empty grant set.
    # Sort by names with a fixed collation, independent of role OIDs/ACL order.
    grantee = "case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end"
    return f"""(select coalesce(jsonb_agg(jsonb_build_array({grantee},a.privilege_type,a.is_grantable,pg_get_userbyid(a.grantor)::text)
      order by ({grantee}) collate "C",a.privilege_type,a.is_grantable,pg_get_userbyid(a.grantor)::text collate "C"),'[]'::jsonb)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)"""


def function_acl_snapshot_sql() -> str:
    # Reuse the table identity across sources so stage object preservation stays
    # exact. Retained functions must keep both the OID and the normalized ACL.
    return f"""create table if not exists task9_function_acls_before(oid oid,proname name,identity_args text,acl jsonb);
truncate task9_function_acls_before;
insert into task9_function_acls_before
select p.oid,p.proname,pg_get_function_identity_arguments(p.oid),{normalized_function_acl_sql()}
from pg_proc p where p.pronamespace='public'::regnamespace;
"""


def function_acl_oracle_sql(signature: str) -> str:
    acl = normalized_function_acl_sql()
    return check(f"""exists(select 1 from pg_proc p where p.oid={q(signature)}::regprocedure
      and {acl}={q(json.dumps(MANAGED_FUNCTION_ACL))}::jsonb
      and not exists(select 1 from task9_function_acls_before b
        where b.proname=p.proname and b.identity_args=pg_get_function_identity_arguments(p.oid)
          and (b.oid<>p.oid or b.acl is distinct from {acl})))""",
      f"{signature}: exact managed grantee/EXECUTE/grant-option/grantor ACL; new inherits and replacement retains identity/ACL")


def function_oracle_sql(alias: str, specs: tuple[tuple[str, str, str, bool, str], ...]) -> str:
    chunks = []
    for signature, name, language, stable, search_path in specs:
        body = _function_body(alias, name)
        chunks.append(check(f"""exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
          where p.oid='{signature}'::regprocedure and p.prosrc={q(body)} and l.lanname='{language}'
            and p.prosecdef and p.provolatile='{'s' if stable else 'v'}'
            and p.proconfig=array[{q('search_path=' + search_path)}]::text[] and p.proowner=(select oid from pg_roles where rolname=current_user))""",
            f"{alias} exact helper body/language/security/volatility/search_path/owner {signature}"))
        chunks.append(function_acl_oracle_sql(signature))
    return "".join(chunks)


F_FUNCTIONS = (
    ("public.gridex_auth_has_role(text)", "gridex_auth_has_role", "plpgsql", True, "public, auth"),
    ("public.gridex_user_is_super_admin()", "gridex_user_is_super_admin", "sql", True, "public, auth"),
    ("public.gridex_user_company_ids()", "gridex_user_company_ids", "sql", True, "public, auth"),
    ("public.gridex_user_can_manage_company(uuid)", "gridex_user_can_manage_company", "sql", True, "public, auth"),
)

GOVERNANCE_FUNCTIONS = (
    ("public.gridex_is_current_session_allowed()", "gridex_is_current_session_allowed", "plpgsql", True, "public, auth"),
    ("public.gridex_auth_has_any_role(text[])", "gridex_auth_has_any_role", "sql", True, "public, auth"),
    ("public.gridex_user_is_platform_admin()", "gridex_user_is_platform_admin", "sql", True, "public, auth"),
    ("public.gridex_company_status_is_writable(uuid)", "gridex_company_status_is_writable", "sql", True, "public"),
    ("public.gridex_user_company_ids()", "gridex_user_company_ids", "sql", True, "public, auth"),
    ("public.gridex_can_read_company(uuid)", "gridex_can_read_company", "sql", True, "public, auth"),
    ("public.gridex_can_write_company(uuid)", "gridex_can_write_company", "sql", True, "public, auth"),
    ("public.gridex_user_can_manage_company(uuid)", "gridex_user_can_manage_company", "sql", True, "public, auth"),
    ("public.gridex_assert_company_operational_for_write()", "gridex_assert_company_operational_for_write", "plpgsql", False, "public"),
    ("public.gridex_companies_missing_ediel_profile()", "gridex_companies_missing_ediel_profile", "plpgsql", True, "public"),
    ("public.gridex_companies_missing_route_setup()", "gridex_companies_missing_route_setup", "plpgsql", True, "public"),
)


def f_function_postflight_sql() -> str:
    # The SQL-language customer filter has OUT arguments, so regprocedure uses
    # only its six input arguments.
    body_checks = function_oracle_sql("F", F_FUNCTIONS)
    filter_body = _function_body("F", "admin_customer_ids_by_latest_contract")
    body_checks += check(f"""exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid='public.admin_customer_ids_by_latest_contract(text,text,text,integer,integer,uuid)'::regprocedure
        and p.prosrc={q(filter_body)} and l.lanname='sql' and not p.prosecdef and p.provolatile='s'
        and p.proowner=(select oid from pg_roles where rolname=current_user))""",
      "F exact latest-contract filter body/signature/invoker/stable")
    return body_checks + function_acl_oracle_sql("public.admin_customer_ids_by_latest_contract(text,text,text,integer,integer,uuid)")


def governance_function_postflight_sql() -> str:
    return function_oracle_sql("6D2", GOVERNANCE_FUNCTIONS)


def debug_view_sql() -> str:
    names = (
        "companies", "company_memberships", "user_roles", "customers", "customer_sites",
        "metering_points", "customer_contracts", "customer_import_batches", "customer_import_rows",
        "billing_export_runs", "billing_export_run_items", "ediel_messages", "ediel_inbound_cases",
        "customer_portal_accounts", "customer_portal_claims",
    )
    return check(f"""(select array_agg(table_name order by table_name)={_array(tuple(sorted(names)))} from gridex_debug_step1_2_schema_alignment_v)
      and not exists(select 1 from gridex_debug_step1_2_schema_alignment_v v where v.exists_in_db<>(to_regclass('public.'||v.table_name) is not null)
        or v.rls_enabled<>coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.'||v.table_name)),false)
        or v.check_status<>case when not v.exists_in_db then 'missing_table' when not v.rls_enabled and v.table_name<>'billing_export_runs' then 'review_rls' else 'ok' end)""",
      "D debug view exact15 names and honest missing_table/review_rls/ok results")


def completion_shape_sql() -> str:
    return "".join((
        check("(select count(*)=6 and bool_and(a.attnotnull=e.required) and bool_and(a.atttypid=e.kind) and bool_and(pg_get_expr(d.adbin,d.adrelid) is not distinct from e.default_expression) from (values ('id','uuid'::regtype,true,'gen_random_uuid()'),('user_id','uuid'::regtype,true,null::text),('revoked_by','uuid'::regtype,false,null::text),('reason','text'::regtype,false,null::text),('revoked_at','timestamptz'::regtype,true,'now()'),('metadata','jsonb'::regtype,true,'''{}''::jsonb')) e(name,kind,required,default_expression) join pg_attribute a on a.attrelid='platform_session_revocations'::regclass and a.attname=e.name and not a.attisdropped left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum)", "6D2 journal exact columns/types/nullability/defaults"),
        check("(select relowner=(select oid from pg_roles where rolname=current_user) and relacl is null and reloptions is null from pg_class where oid='platform_session_revocations'::regclass) and obj_description('platform_session_revocations'::regclass) is null and not exists(select 1 from pg_attribute where attrelid='platform_session_revocations'::regclass and attnum>0 and col_description(attrelid,attnum) is not null)", "6D2 journal exact owner/ACL/options/no source comments"),
        check("not exists(select 1 from (values ('assigned_to','uuid'::regtype,false,null::text),('reassigned_at','timestamptz'::regtype,false,null::text),('reassigned_by','uuid'::regtype,false,null::text),('assignment_reason','text'::regtype,false,null::text)) e(name,kind,required,default_expression) left join pg_attribute a on a.attrelid='customer_operation_tasks'::regclass and a.attname=e.name and not a.attisdropped left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attnum is null or a.atttypid<>e.kind or a.attnotnull<>e.required or pg_get_expr(d.adbin,d.adrelid) is distinct from e.default_expression)", "6D2 exact task completion column matrix"),
        check("not exists(select 1 from (values ('payload_version','text'::regtype,false,null::text),('prepared_payload','jsonb'::regtype,true,'''{}''::jsonb'),('prepared_at','timestamptz'::regtype,false,null::text),('export_error_summary','text'::regtype,false,null::text)) e(name,kind,required,default_expression) left join pg_attribute a on a.attrelid='partner_exports'::regclass and a.attname=e.name and not a.attisdropped left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attnum is null or a.atttypid<>e.kind or a.attnotnull<>e.required or pg_get_expr(d.adbin,d.adrelid) is distinct from e.default_expression)", "6D2 exact partner export completion column matrix"),
        check("exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='metering_values'::regclass and a.attname='source_order' and a.atttypid='integer'::regtype and not a.attnotnull and not a.attisdropped and d.oid is null)", "6D2 exact nullable/defaultless metering source_order"),
    ))


def complete_postflight_sql(raw_not_valid: bool = True) -> str:
    policy_targets = _array(contract.POLICY_TARGETS)
    trigger_targets = _array(contract.TRIGGER_TARGETS)
    f_present = _array(contract.F_PRESENT)
    f_absent = _array(contract.F_ABSENT)
    function_sigs = _array(contract.FUNCTION_SIGNATURES)
    chunks = [
        check("current_setting('server_version_num')::int/10000=17", "server major is PostgreSQL17"),
        import_shape_sql(),
        import_constraint_index_sql(raw_not_valid),
        source_target_sql(),
        policy_trigger_sql(),
        bespoke_policy_expression_sql(),
        governance_function_postflight_sql(),
        debug_view_sql(),
        completion_shape_sql(),
        check("(select count(*)=19 from pg_attribute where attrelid='customer_import_batches'::regclass and attnum>0 and not attisdropped) and (select count(*)=19 from pg_attribute where attrelid='customer_import_rows'::regclass and attnum>0 and not attisdropped)", "literal 19/19 import shape"),
        check("(select count(*)=7 from pg_class c join pg_index i on i.indexrelid=c.oid where c.relname=any(array['customer_import_batches_company_created_idx','customer_import_batches_company_status_created_idx','customer_import_rows_batch_idx','customer_import_rows_company_status_idx','customer_import_rows_company_status_created_idx','customer_import_rows_company_batch_idx','customer_import_rows_customer_idx']) and i.indisvalid and i.indisready and i.indislive)", "all seven D indexes valid/ready/live"),
        check("pg_get_indexdef('customer_import_rows_company_idx'::regclass)='CREATE INDEX customer_import_rows_company_idx ON public.customer_import_rows USING btree (company_id)'", "retained F row-company index exact keys"),
        check(f"(select count(*)=19 from pg_class c join pg_attribute a on a.attrelid=c.oid where c.relnamespace='public'::regnamespace and c.relname=any({f_present}) and a.attname='company_id' and a.atttypid='uuid'::regtype and not a.attisdropped)", "F actual-prefix 19/22 branches present"),
        check(f"(select bool_and(to_regclass('public.'||name) is null) from unnest({f_absent}) name)", "F optional access_logs/power_of_attorneys/meter_readings branches skipped"),
        check(f"(select count(*)=116 from pg_policies where schemaname='public' and tablename=any({policy_targets}) and policyname ~ '_tenant_(select|insert|update|delete)$')", "6D2 four generic policies on all29 targets"),
        check(f"(select count(*)=29 and bool_and(relrowsecurity) from pg_class where oid=any(({policy_targets})::regclass[]))", "6D2 RLS enabled on all29 targets"),
        check(f"(select count(*)=28 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname=any({trigger_targets}) and t.tgname=c.relname||'_tenant_operational_guard_trg' and not t.tgisinternal and t.tgtype=23 and t.tgenabled='O')", "6D2 exact28 operational INSERT/UPDATE-company triggers"),
        check("(select count(*)=6 from pg_attribute where attrelid='platform_session_revocations'::regclass and attnum>0 and not attisdropped)", "6D2 exact six-column session journal"),
        check("(select count(*)=2 from pg_constraint where conrelid='platform_session_revocations'::regclass and contype='f' and convalidated)", "session journal user/revoker FKs"),
        check("pg_get_indexdef('platform_session_revocations_user_idx'::regclass)='CREATE INDEX platform_session_revocations_user_idx ON public.platform_session_revocations USING btree (user_id, revoked_at DESC)'", "session journal exact user/revoked index"),
        check(f"(select count(*)=8 from unnest({function_sigs}) s where to_regprocedure('public.'||s) is not null)", "all eight 6D2 helper signatures"),
        check("(select string_agg(column_name||':'||data_type,',' order by ordinal_position)='company_id:uuid,company_name:text,company_status:text,total_metering_values:integer,current_metering_values:integer,replaced_metering_values:integer,total_billing_underlays:integer,ready_underlays:integer,blocked_underlays:integer,total_partner_exports:integer,latest_activity_at:timestamp with time zone' from information_schema.columns where table_schema='public' and table_name='metering_billing_audit_overview')", "6D2 exact11-column overview names/types/order"),
        check("(select count(*)=15 from gridex_debug_step1_2_schema_alignment_v)", "D debug view reports all15 literal relations including honest missing rows"),
        check("(select count(*)=3 from pg_class c where c.oid=any(array['customer_operation_tasks_assigned_company_status_idx','partner_exports_company_status_batch_idx','metering_values_company_period_current_idx']::regclass[]) and c.relkind='i')", "three 6D2 completion indexes"),
        check("(select count(*)=4 from pg_attribute where attrelid='customer_operation_tasks'::regclass and attname in ('assigned_to','reassigned_at','reassigned_by','assignment_reason') and not attisdropped)", "task completion columns"),
        check("(select count(*)=4 from pg_attribute where attrelid='partner_exports'::regclass and attname in ('payload_version','prepared_payload','prepared_at','export_error_summary') and not attisdropped)", "partner export completion columns"),
        check("exists(select 1 from pg_attribute where attrelid='metering_values'::regclass and attname='source_order' and atttypid='integer'::regtype and not attisdropped)", "metering source_order completion column"),
    ]
    return "".join(chunks)


def validate_synthetic_fks_sql() -> str:
    return """begin;
create temporary table validation_before as
 select oid,conname,convalidated from pg_constraint
 where conrelid='customer_import_rows'::regclass and conname in ('customer_import_rows_customer_id_fkey','customer_import_rows_reviewed_by_fkey');
select test_assert((select count(*)=2 and bool_and(not convalidated) from validation_before),'raw D receipt has exactly two synthetic NOT VALID FKs');
alter table customer_import_rows validate constraint customer_import_rows_customer_id_fkey;
alter table customer_import_rows validate constraint customer_import_rows_reviewed_by_fkey;
select test_assert(not exists(select 1 from validation_before b join pg_constraint k using(oid) where not k.convalidated or b.conname<>k.conname),'separate synthetic validation flips only convalidated and retains constraint OIDs');
commit;
"""


def lifecycle_seed_sql() -> str:
    return """
insert into auth.users(id) values
 ('10000000-0000-0000-0000-000000000011'),('10000000-0000-0000-0000-000000000012'),
 ('10000000-0000-0000-0000-000000000013'),('10000000-0000-0000-0000-000000000014'),
 ('10000000-0000-0000-0000-000000000015');
insert into user_profiles(id,email,full_name,user_status) values
 ('10000000-0000-0000-0000-000000000011','life11@example.invalid','Lifecycle active','active'),
 ('10000000-0000-0000-0000-000000000012','life12@example.invalid','Lifecycle disabled','disabled'),
 ('10000000-0000-0000-0000-000000000013','life13@example.invalid','Lifecycle removed','removed_from_company'),
 ('10000000-0000-0000-0000-000000000014','life14@example.invalid','Lifecycle revoked','invitation_revoked'),
 ('10000000-0000-0000-0000-000000000015','life15@example.invalid','Lifecycle locked','locked_security');
insert into user_roles(id,user_id,role_id,role,status,is_active) values
 ('91000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000011',(select id from roles where key='company_admin'),'company_admin','active',false),
 ('91000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000012',(select id from roles where key='company_admin'),'company_admin','disabled',true),
 ('91000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000013',(select id from roles where key='company_admin'),'company_admin','removed_from_company',true),
 ('91000000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000014',(select id from roles where key='company_admin'),'company_admin','invitation_revoked',true),
 ('91000000-0000-0000-0000-000000000015','10000000-0000-0000-0000-000000000015',(select id from roles where key='company_admin'),'company_admin','locked_security',true);
create table lifecycle_before as select id,status,is_active,updated_at from user_roles where id::text like '91000000-0000-0000-0000-00000000001_';
"""


def lifecycle_checks_sql(repeat: bool = False) -> str:
    label = "repeat" if repeat else "first"
    snapshot = "" if repeat else "create table lifecycle_after_first as select id,status,is_active,updated_at from user_roles where id::text like '91000000-0000-0000-0000-00000000001_';\n"
    repeat_check = check("not exists((select * from lifecycle_after_first except select id,status,is_active,updated_at from user_roles where id::text like '91000000-0000-0000-0000-00000000001_') union all (select id,status,is_active,updated_at from user_roles where id::text like '91000000-0000-0000-0000-00000000001_' except select * from lifecycle_after_first))", "6D2 repeat has exact zero lifecycle/timestamp delta") if repeat else check("(select count(*)=0 from lifecycle_before b join user_roles u using(id) where b.updated_at is distinct from u.updated_at)", "6D2 source UPDATE has zero timestamp/audit-trigger delta after admission rejects unexpected UPDATE triggers")
    return check("(select not is_active from user_roles where id='91000000-0000-0000-0000-000000000011')", f"6D2 {label}: active explicit false stays false") + check("(select bool_and(not is_active) from user_roles where id::text like '91000000-0000-0000-0000-00000000001_' and status<>'active')", f"6D2 {label}: four disabled statuses become false") + check("(select count(*)=5 from user_roles where id::text like '91000000-0000-0000-0000-00000000001_')", f"6D2 {label}: lifecycle rows preserved") + repeat_check + snapshot


def _lifecycle_rows_sql() -> str:
    return "select 'user_roles' relation,id,to_jsonb(t) value from user_roles t union all select 'user_profiles',id,to_jsonb(t) from user_profiles t"


def _lifecycle_catalog_sql() -> str:
    # Inspect both relations in the shared DO, including columns/FKs/checks/indexes
    # it could add or replace. Exact OIDs and definitions preserve existing state.
    relations = "('user_roles'::regclass,'user_profiles'::regclass)"
    return f"""select 'relation' kind,c.oid relation_oid,c.oid::text object_identity,
      jsonb_build_array(c.relname,c.reltype,c.relowner,c.relacl,c.reloptions) value
      from pg_class c where c.oid in {relations}
union all select 'column',a.attrelid,a.attnum::text,
      to_jsonb(a)||jsonb_build_object('default_oid',d.oid,'default_expression',pg_get_expr(d.adbin,d.adrelid))
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid in {relations} and a.attnum>0
union all select 'constraint',k.conrelid,k.oid::text,to_jsonb(k)||jsonb_build_object('definition',pg_get_constraintdef(k.oid))
      from pg_constraint k where k.conrelid in {relations}
union all select 'index',i.indrelid,i.indexrelid::text,to_jsonb(i)||jsonb_build_object('definition',pg_get_indexdef(i.indexrelid))
      from pg_index i where i.indrelid in {relations}"""


def _four_disabled_rows_still_active_sql(label: str) -> str:
    return check("""(select count(*)=4 and bool_and(is_active) from user_roles
      where id in ('91000000-0000-0000-0000-000000000012','91000000-0000-0000-0000-000000000013',
                   '91000000-0000-0000-0000-000000000014','91000000-0000-0000-0000-000000000015')
        and status in ('disabled','removed_from_company','invitation_revoked','locked_security'))""", label)


def native_6d2_snapshot_sql() -> str:
    return _four_disabled_rows_still_active_sql("6D2 native setup: four disabled rows would change under UPDATE") + f"""
create table native_6d2_before_rows as {_lifecycle_rows_sql()};
create table native_6d2_before_catalog as {_lifecycle_catalog_sql()};
"""


def native_6d2_rollback_sql() -> str:
    return _four_disabled_rows_still_active_sql("6D2 native rollback: all four distinguishing disabled rows remain true") + check(f"""
      not exists((select * from native_6d2_before_rows except ({_lifecycle_rows_sql()}))
        union all (({_lifecycle_rows_sql()}) except select * from native_6d2_before_rows))
      and (select count(*) from user_roles)=(select count(*) from native_6d2_before_rows where relation='user_roles')
      and (select count(*) from user_profiles)=(select count(*) from native_6d2_before_rows where relation='user_profiles')""",
      "6D2 first DO rollback preserves all role/profile row IDs, values and counts") + check(f"""
      not exists((select * from native_6d2_before_catalog except ({_lifecycle_catalog_sql()}))
        union all (({_lifecycle_catalog_sql()}) except select * from native_6d2_before_catalog))""",
      "6D2 first DO rollback preserves exact lifecycle catalog; added columns/constraints/indexes absent or unchanged")


def preservation_snapshot_sql() -> str:
    tables = (
        "companies", "customers", "customer_sites", "metering_points",
        "contract_offers", "contract_offer_versions", "company_memberships",
        "company_invitations", "roles", "permissions", "role_permissions",
    )
    statements = ["create table whole_rows_before(relation text,id text,value jsonb);\n"]
    for table in tables:
        statements.append(f"insert into whole_rows_before select '{table}',id::text,to_jsonb(t) from public.{table} t;\n")
    statements.extend((
        "create table whole_fk_before as select oid,conrelid,confrelid,conkey,confkey,confdeltype,confupdtype,convalidated,pg_get_constraintdef(oid) definition from pg_constraint where connamespace in ('public'::regnamespace,'auth'::regnamespace) and contype='f';\n",
        "create table whole_identity_before as select c.oid,c.relname,c.relkind from pg_class c where c.relnamespace in ('public'::regnamespace,'auth'::regnamespace) and c.relkind in ('r','p','i');\n",
    ))
    return "".join(statements)


def stage_snapshot_sql(stage: str, include_imports: bool) -> str:
    tables = [
        "auth.users", "companies", "customers", "customer_sites", "metering_points",
        "contract_offers", "contract_offer_versions", "company_memberships",
        "company_invitations", "user_profiles", "user_roles", "roles", "permissions",
        "role_permissions",
    ]
    if include_imports:
        tables.extend(("customer_import_batches", "customer_import_rows"))
    chunks = [f"create table stage_{stage}_rows(relation text,id text,value jsonb);\n"]
    for table in tables:
        chunks.append(f"insert into stage_{stage}_rows select '{table}',id::text,to_jsonb(t) from {table} t;\n")
    chunks.extend((
        f"create table stage_{stage}_objects as select oid,relname,relkind,relowner,relacl,reloptions from pg_class where relnamespace in ('public'::regnamespace,'auth'::regnamespace) and relkind in ('r','p','i','v');\n",
        f"create table stage_{stage}_procs as select oid,proname,proowner,proacl,prosecdef,provolatile,proconfig,prosrc from pg_proc where pronamespace in ('public'::regnamespace,'auth'::regnamespace) and proname not in ('gridex_auth_has_role','gridex_user_is_super_admin','gridex_is_current_session_allowed','gridex_auth_has_any_role','gridex_user_is_platform_admin','gridex_company_status_is_writable','gridex_user_company_ids','gridex_can_read_company','gridex_can_write_company','gridex_user_can_manage_company','gridex_assert_company_operational_for_write','gridex_companies_missing_ediel_profile','gridex_companies_missing_route_setup','admin_customer_ids_by_latest_contract');\n",
        f"create table stage_{stage}_source_proc_oids as select oid,proname,pg_get_function_identity_arguments(oid) identity_args from pg_proc where pronamespace='public'::regnamespace and proname in ('gridex_auth_has_role','gridex_user_is_super_admin','gridex_is_current_session_allowed','gridex_auth_has_any_role','gridex_user_is_platform_admin','gridex_company_status_is_writable','gridex_user_company_ids','gridex_can_read_company','gridex_can_write_company','gridex_user_can_manage_company','gridex_assert_company_operational_for_write','gridex_companies_missing_ediel_profile','gridex_companies_missing_route_setup','admin_customer_ids_by_latest_contract');\n",
        f"create table stage_{stage}_policies as select oid,polrelid,polname,polcmd,polpermissive,polroles,pg_get_expr(polqual,polrelid) qual,pg_get_expr(polwithcheck,polrelid) withcheck from pg_policy where polname !~ '_tenant_(select|insert|update|delete)$' and polname not in ('companies_tenant_select','companies_super_admin_write','company_memberships_tenant_select','company_memberships_tenant_write','company_invitations_tenant_select','company_invitations_tenant_write','tenant_governance_events_select','tenant_governance_events_write');\n",
        f"create table stage_{stage}_constraints as select oid,conname,conrelid,confrelid,contype,conkey,confkey,confdeltype,confupdtype,convalidated,pg_get_constraintdef(oid) definition from pg_constraint where connamespace in ('public'::regnamespace,'auth'::regnamespace) and conname not in ('customer_import_batches_status_check','customer_import_rows_status_check','customer_import_rows_parser_confidence_check','user_roles_status_check','user_profiles_user_status_check');\n",
    ))
    return "".join(chunks)


def stage_preserved_sql(stage: str, allowed_row_relations: tuple[str, ...] = ()) -> str:
    tables = (
        "auth.users", "companies", "customers", "customer_sites", "metering_points",
        "contract_offers", "contract_offer_versions", "company_memberships",
        "company_invitations", "user_profiles", "user_roles", "roles", "permissions",
        "role_permissions", "customer_import_batches", "customer_import_rows",
    )
    row_checks = "".join(
        first_f_offer_delta_sql() if stage == "f_first" and table == "contract_offers" else
        check(f"not exists(select 1 from stage_{stage}_rows b where b.relation='{table}' and not exists(select 1 from {table} t where t.id::text=b.id and to_jsonb(t)=b.value)) and (select count(*) from {table})=(select count(*) from stage_{stage}_rows where relation='{table}')", f"{stage}: {table} exact IDs/rows/count retained")
        for table in tables if table not in allowed_row_relations
    )
    return row_checks + f"""
select test_assert(not exists(select * from stage_{stage}_objects except select oid,relname,relkind,relowner,relacl,reloptions from pg_class),'{stage}: all prior table/view/index OIDs, owners, ACLs/options retained');
select test_assert(not exists(select * from stage_{stage}_procs except select oid,proname,proowner,proacl,prosecdef,provolatile,proconfig,prosrc from pg_proc),'{stage}: all non-source function OIDs/bodies/security/ACL/config retained');
select test_assert(not exists(select * from stage_{stage}_source_proc_oids except select oid,proname,pg_get_function_identity_arguments(oid) from pg_proc),'{stage}: all prior source-function OIDs and input identities retained under CREATE OR REPLACE');
select test_assert(not exists(select * from stage_{stage}_policies except select oid,polrelid,polname,polcmd,polpermissive,polroles,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid) from pg_policy),'{stage}: all policies outside exact source replacement set survive byte-for-byte');
select test_assert(not exists(select * from stage_{stage}_constraints except select oid,conname,conrelid,confrelid,contype,conkey,confkey,confdeltype,confupdtype,convalidated,pg_get_constraintdef(oid) from pg_constraint),'{stage}: all non-replaced constraint OIDs/actions/definitions retained');
"""


def first_f_offer_delta_sql() -> str:
    # This allowance belongs only to first F on the actual first33 fixtures.
    # Removing exactly two new NULL keys must recover the entire original row.
    return check("""(select count(*)=2 from stage_f_first_rows where relation='contract_offers')
      and (select count(*) from contract_offers)=(select count(*) from stage_f_first_rows where relation='contract_offers')
      and not exists(select 1 from stage_f_first_rows b left join contract_offers t on t.id::text=b.id
        where b.relation='contract_offers' and (t.id is null
          or b.value ?| array['last_versioned_at','version_note']::text[]
          or (to_jsonb(t)-array['last_versioned_at','version_note']::text[]) is distinct from b.value
          or to_jsonb(t)->'last_versioned_at' is distinct from 'null'::jsonb
          or to_jsonb(t)->'version_note' is distinct from 'null'::jsonb))""",
      "first-F offers retain exact IDs/count/all preexisting values with only two new NULL keys") + check("""not exists(
        select 1 from (values ('last_versioned_at','timestamptz'::regtype),('version_note','text'::regtype)) e(name,kind)
        left join pg_attribute a on a.attrelid='contract_offers'::regclass and a.attname=e.name and not a.attisdropped
        left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attnum is null or a.atttypid<>e.kind or a.attnotnull or d.oid is not null)""",
      "first-F offer additions have exact nullable/defaultless timestamptz/text types")


def user_roles_delta_sql(stage: str) -> str:
    nullable = ("disabled_at", "disabled_by", "status_reason")
    new_column_checks = " and ".join(
        f"case when b.value ? '{column}' then to_jsonb(u)->'{column}'=b.value->'{column}' else to_jsonb(u)->'{column}'='null'::jsonb end"
        for column in nullable
    )
    return check(f"""(select count(*) from user_roles)=(select count(*) from stage_{stage}_rows where relation='user_roles')
      and not exists(select 1 from stage_{stage}_rows b left join user_roles u on u.id::text=b.id
        where b.relation='user_roles' and (u.id is null
          or (to_jsonb(u)-array['is_active','disabled_at','disabled_by','status_reason']::text[])<>(b.value-array['is_active','disabled_at','disabled_by','status_reason']::text[])
          or not ({new_column_checks})
          or u.is_active<>case when u.status in ('disabled','removed_from_company','invitation_revoked','locked_security') then false else coalesce((b.value->>'is_active')::boolean,true) end))""",
      f"{stage}: exact user_roles source-added nullable columns and is_active allowed delta")


def user_profiles_delta_sql(stage: str) -> str:
    nullable = ("disabled_at", "disabled_by", "disabled_reason", "reactivated_at", "reactivated_by", "session_revoked_at")
    array_sql = "array[" + ",".join(q(column) for column in nullable) + "]::text[]"
    value_checks = " and ".join(
        f"case when b.value ? '{column}' then to_jsonb(u)->'{column}'=b.value->'{column}' else to_jsonb(u)->'{column}'='null'::jsonb end"
        for column in nullable
    )
    return check(f"""(select count(*) from user_profiles)=(select count(*) from stage_{stage}_rows where relation='user_profiles')
      and not exists(select 1 from stage_{stage}_rows b left join user_profiles u on u.id::text=b.id
        where b.relation='user_profiles' and (u.id is null or (to_jsonb(u)-{array_sql})<>(b.value-{array_sql}) or not ({value_checks})))""",
      f"{stage}: exact user_profiles source-added nullable columns and preserved values")


def preservation_checks_sql() -> str:
    # Source-defined metadata updates are omitted from the JSON comparison only
    # for the exact three seed records. Their IDs and new values have dedicated checks.
    tables = (
        "companies", "customers", "customer_sites", "metering_points",
        "contract_offers", "contract_offer_versions", "company_memberships",
        "company_invitations",
    )
    row_checks = "".join(check(
        f"not exists(select 1 from whole_rows_before b where b.relation='{table}' and not exists(select 1 from {table} t where t.id::text=b.id and to_jsonb(t) @> b.value))",
        f"{table} IDs and all pre-source values preserved",
    ) for table in tables)
    return row_checks + """
select test_assert(not exists(
  select 1 from whole_rows_before b
  where not (b.relation='roles' and b.id=(select id::text from roles where key='company_admin'))
    and not (b.relation='permissions' and b.id in (select id::text from permissions where key in ('tenants.read','tenants.write','tenants.invite')))
    and not exists(select 1 from pg_class c where c.relname=b.relation)
),'all snapshotted relations survive');
select test_assert(not exists(select 1 from whole_rows_before b where b.relation in ('companies','customers','customer_sites','metering_points','contract_offers','contract_offer_versions','company_memberships','company_invitations') and not exists(
 select 1 from pg_class c where c.relname=b.relation
)),'two-tenant object identities preserved');
select test_assert(not exists(select * from whole_fk_before except select oid,conrelid,confrelid,conkey,confkey,confdeltype,confupdtype,convalidated,pg_get_constraintdef(oid) from pg_constraint),'all pre-source FK OIDs/actions/definitions preserved');
select test_assert(not exists(select * from whole_identity_before where relkind in ('r','p') except select c.oid,c.relname,c.relkind from pg_class c),'all pre-source table identities preserved');
select test_assert((select count(*)=2 from customers where id in ('31000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000002')),'both tenant customer IDs preserved');
select test_assert(not exists(select 1 from customers c join companies p on p.id=c.company_id where c.id in ('31000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000002') and c.company_id<>p.id),'customer/company ownership remains resolvable');
select test_assert(not exists(select 1 from customer_sites s join customers c on c.id=s.customer_id where s.id in ('41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002') and s.company_id<>c.company_id),'site/customer same-company agreement preserved');
select test_assert(not exists(select 1 from metering_points m join customer_sites s on s.id=m.site_id where m.id in ('51000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002') and m.company_id<>s.company_id),'meter/site same-company agreement preserved');
"""


def consumer_behavior_sql() -> str:
    batch_values = []
    row_values = []
    for tenant in range(2):
        company = f"21000000-0000-0000-0000-00000000000{tenant + 1}"
        user = f"11000000-0000-0000-0000-00000000000{tenant + 1}"
        for status_index, status in enumerate(contract.BATCH_STATUSES, 1):
            index = tenant * 5 + status_index
            batch_values.append(f"('a1000000-0000-0000-0000-0000000000{index:02d}','{company}','kind-{index}','type-{index}','file-{index}', '{status}',{index},{index+10},{index+20},{index+30},{index+40},{index+50},'[]','{{\"object\":{index}}}','{{\"metadata\":{index}}}','{user}')")
        customer = f"31000000-0000-0000-0000-00000000000{tenant + 1}"
        for status_index, status in enumerate(contract.ROW_STATUSES, 1):
            index = tenant * 10 + status_index
            batch_index = tenant * 5 + ((status_index - 1) % 5) + 1
            batch = f"a1000000-0000-0000-0000-0000000000{batch_index:02d}"
            confidence = "null" if status_index == 1 else "0" if status_index == 2 else "100" if status_index == 3 else "50"
            row_values.append(f"('b1000000-0000-0000-0000-0000000000{index:02d}','{batch}','{company}',1,'{status}','{{\"normalized\":{index}}}','{{\"raw\":{index}}}','{customer}','[]','{{\"object\":{index}}}',{confidence},'{customer}','[]')")
    return f"""
insert into customer_import_batches(id,company_id,source_kind,source_type,file_name,status,rows_total,rows_created,rows_failed,total_rows,created_rows,failed_rows,warnings,issues,metadata,created_by) values
 {','.join(batch_values)};
insert into customer_import_rows(id,import_batch_id,company_id,row_number,status,normalized_payload,raw_payload,customer_id,warnings,issues,parser_confidence,possible_existing_customer_id,duplicate_match_payload) values
 {','.join(row_values)};
update customer_import_batches set created_at='2026-03-01Z',updated_at='2026-03-02Z',imported_at='2026-03-03Z' where id::text like 'a1000000-%';
update customer_import_rows set created_at='2026-03-04Z',updated_at='2026-03-05Z',reviewed_at='2026-03-06Z',reviewed_by=case when company_id='{C1}' then '{U1}'::uuid else '{U2}'::uuid end,resolution='fixture-'||status where id::text like 'b1000000-%';
insert into customer_import_batches(id,company_id,source_kind,source_type,file_name,status,created_by)
 values ('a1000000-0000-0000-0000-000000000099','21000000-0000-0000-0000-000000000001','default-kind','default-type','default-file','previewed','11000000-0000-0000-0000-000000000001');
insert into customer_import_rows(id,import_batch_id,company_id,row_number,status,normalized_payload,raw_payload,warnings,duplicate_match_payload)
 values ('b1000000-0000-0000-0000-000000000099','a1000000-0000-0000-0000-000000000099','21000000-0000-0000-0000-000000000001',9,'pending','{{}}','{{}}','[]','[]');
select test_assert((select array_agg(distinct status order by status) from customer_import_batches)=array[{','.join(q(x) for x in sorted(contract.BATCH_STATUSES))}],'all five D batch statuses admitted');
select test_assert((select array_agg(distinct status order by status) from customer_import_rows)=array[{','.join(q(x) for x in sorted(contract.ROW_STATUSES))}],'all ten D row statuses admitted');
select test_assert(not exists(select 1 from customer_import_rows r join customer_import_batches b on b.id=r.import_batch_id where r.company_id<>b.company_id),'clean consumer fixture has zero row/batch owner mismatches');
select test_assert((select count(*)=10 from customer_import_batches b where b.id::text like 'a1000000-%' and b.imported_at is not null and exists(select 1 from auth.users u where u.id=b.created_by) and exists(select 1 from company_memberships m where m.user_id=b.created_by and m.company_id=b.company_id)) and (select count(*)=20 from customer_import_rows r where r.id::text like 'b1000000-%' and exists(select 1 from auth.users u where u.id=r.reviewed_by) and exists(select 1 from company_memberships m where m.user_id=r.reviewed_by and m.company_id=r.company_id) and exists(select 1 from customers c where c.id=r.customer_id and c.company_id=r.company_id) and exists(select 1 from customers candidate where candidate.id=r.possible_existing_customer_id and candidate.company_id=r.company_id)),'all actors have owning-company membership and customer/candidate references resolve within tenant');
select test_assert((select count(*)=10 from customer_import_batches where source_kind<>source_type and created_at<updated_at and updated_at<imported_at),'source-kind/type aliases and three independent batch timestamps retained');
select test_assert((select count(*)=20 from customer_import_rows where created_at<updated_at and updated_at<reviewed_at and resolution='fixture-'||status),'row created/updated/reviewed timestamps and resolution retained independently');
select test_assert((select count(*)=7 from customer_import_rows where parser_confidence is null or parser_confidence in (0,100)),'fixture has exact seven NULL/0/100 values including one explicit default NULL row');
select test_assert((select count(*)=10 from customer_import_batches where rows_total<>total_rows and rows_created<>created_rows and rows_failed<>failed_rows),'both counter triples stored independently');
select test_assert((select count(*)=10 from customer_import_batches where jsonb_typeof(warnings)='array' and jsonb_typeof(issues)='object'),'batch array warnings and object issues remain distinct');
select test_assert((select count(*)=20 from customer_import_rows where jsonb_typeof(warnings)='array' and jsonb_typeof(issues)='object'),'row array warnings and explicit object issues remain distinct');
select test_assert((select jsonb_typeof(issues)='array' from customer_import_batches where id='a1000000-0000-0000-0000-000000000099') and (select jsonb_typeof(issues)='array' from customer_import_rows where id='b1000000-0000-0000-0000-000000000099'),'I array issues defaults survive D alignment');
select test_assert((select count(*)=10 from (select import_batch_id,row_number from customer_import_rows group by import_batch_id,row_number having count(*)=2) d),'actual duplicate row numbers remain source-accepted and explicitly final-gated');
do $$ declare caught boolean:=false; begin begin insert into customer_import_rows(import_batch_id,company_id,row_number,status,parser_confidence) values ('a1000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',99,'pending',-1); exception when check_violation then caught:=true; end; perform test_assert(caught,'parser -1 exact native check rejection'); end $$;
do $$ declare caught boolean:=false; begin begin insert into customer_import_rows(import_batch_id,company_id,row_number,status,parser_confidence) values ('a1000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',100,'pending',101); exception when check_violation then caught:=true; end; perform test_assert(caught,'parser 101 exact native check rejection'); end $$;
do $$ declare caught boolean:=false; begin begin insert into customer_import_rows(import_batch_id,company_id,row_number,status) values ('a1000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',101,'unsupported'); exception when check_violation then caught:=true; end; perform test_assert(caught,'unsupported row status exact native rejection'); end $$;
do $$ declare caught boolean:=false; begin begin insert into customer_import_batches(company_id,source_kind,source_type,file_name,status) values ('21000000-0000-0000-0000-000000000001','bad','bad','bad','unsupported'); exception when check_violation then caught:=true; end; perform test_assert(caught,'unsupported batch status exact native rejection'); end $$;
"""


def control_filter_fixture_sql() -> str:
    return """
-- Explicit synthetic compatibility fixture: NULL flags exercise source COALESCE.
alter table ediel_actor_settings alter column is_active drop not null;
alter table communication_routes alter column is_active drop not null;
alter table ediel_route_profiles alter column is_enabled drop not null;
insert into companies(id,name,org_number,status,updated_at) values
 ('22000000-0000-0000-0000-000000000003','Control active complete','559900000003','active','2026-01-01Z'),
 ('22000000-0000-0000-0000-000000000004','Control inactive routes','559900000004','active','2026-01-02Z'),
 ('22000000-0000-0000-0000-000000000005','Control null routes','559900000005','active','2026-01-03Z'),
 ('22000000-0000-0000-0000-000000000006','Control archived','559900000006','archived','2026-01-04Z'),
 ('22000000-0000-0000-0000-000000000007','Control no routes','559900000007','active','2026-01-05Z'),
 ('22000000-0000-0000-0000-000000000008','Control deleted','559900000008','deleted_test_only','2026-01-06Z');
insert into ediel_actor_settings(id,company_id,actor_name,actor_ediel_id,is_active) values
 ('e2000000-0000-0000-0000-000000000003','22000000-0000-0000-0000-000000000003','active','E3',true),
 ('e2000000-0000-0000-0000-000000000004','22000000-0000-0000-0000-000000000004','inactive','E4',false),
 ('e2000000-0000-0000-0000-000000000005','22000000-0000-0000-0000-000000000005','null','E5',null);
insert into communication_routes(id,company_id,route_name,is_active) values
 ('c2000000-0000-0000-0000-000000000003','22000000-0000-0000-0000-000000000003','active',true),
 ('c2000000-0000-0000-0000-000000000004','22000000-0000-0000-0000-000000000004','inactive',false),
 ('c2000000-0000-0000-0000-000000000005','22000000-0000-0000-0000-000000000005','null',null);
insert into ediel_route_profiles(id,company_id,is_enabled) values
 ('d2000000-0000-0000-0000-000000000003','22000000-0000-0000-0000-000000000003',true),
 ('d2000000-0000-0000-0000-000000000004','22000000-0000-0000-0000-000000000004',false),
 ('d2000000-0000-0000-0000-000000000005','22000000-0000-0000-0000-000000000005',null);
insert into customers(id,company_id,customer_number,full_name,email,phone,status) values
 ('32000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000003','CTRL-1','No Contract','none@example.invalid','0701','active'),
 ('32000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000003','CTRL-2','Pending Person','pending@example.invalid','0702','draft'),
 ('32000000-0000-0000-0000-000000000003','22000000-0000-0000-0000-000000000003','CTRL-3','Signed Person','signed@example.invalid','0703','draft'),
 ('32000000-0000-0000-0000-000000000004','22000000-0000-0000-0000-000000000003','CTRL-4','Active Person','active@example.invalid','0704','draft'),
 ('32000000-0000-0000-0000-000000000005','22000000-0000-0000-0000-000000000003','CTRL-5','Closed Person','closed@example.invalid','0705','draft'),
 ('32000000-0000-0000-0000-000000000006','22000000-0000-0000-0000-000000000003','CTRL-6','Needle Person','needle@example.invalid','0706','draft'),
 ('32000000-0000-0000-0000-000000000007','22000000-0000-0000-0000-000000000004','CTRL-7','Other Tenant','other@example.invalid','0707','draft');
insert into customer_contracts(id,company_id,customer_id,status,created_at) values
 ('cc000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000003','32000000-0000-0000-0000-000000000002','pending_signature','2026-01-01Z'),
 ('cc000000-0000-0000-0000-000000000003','22000000-0000-0000-0000-000000000003','32000000-0000-0000-0000-000000000003','signed','2026-01-02Z'),
 ('cc000000-0000-0000-0000-000000000004','22000000-0000-0000-0000-000000000003','32000000-0000-0000-0000-000000000004','active','2026-01-03Z'),
 ('cc000000-0000-0000-0000-000000000005','22000000-0000-0000-0000-000000000003','32000000-0000-0000-0000-000000000005','terminated','2026-01-04Z'),
 ('cc000000-0000-0000-0000-000000000061','22000000-0000-0000-0000-000000000003','32000000-0000-0000-0000-000000000006','active','2026-01-01Z'),
 ('cc000000-0000-0000-0000-000000000062','22000000-0000-0000-0000-000000000003','32000000-0000-0000-0000-000000000006','cancelled','2026-01-05Z'),
 ('cc000000-0000-0000-0000-000000000007','22000000-0000-0000-0000-000000000004','32000000-0000-0000-0000-000000000007','pending_signature','2026-01-06Z');
insert into metering_values(id,company_id,is_current,value_status,created_at) values
 ('a2000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000007',true,'current','2026-02-01Z'),
 ('a2000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000007',false,'replaced','2026-02-02Z'),
 ('a2000000-0000-0000-0000-000000000003','22000000-0000-0000-0000-000000000007',true,'replaced','2026-02-03Z');
insert into billing_underlays(id,company_id,status,readiness_status,created_at) values
 ('b2000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000007','pending','ready','2026-02-04Z'),
 ('b2000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000007','failed','blocked','2026-02-05Z');
insert into partner_exports(id,company_id,target_system,status,export_batch_key,created_at) values
 ('f2000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000007','partner','queued','batch-1','2026-02-06Z'),
 ('f2000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000007','partner','sent','batch-2','2026-02-07Z');
"""


def filter_behavior_sql() -> str:
    c3 = "'22000000-0000-0000-0000-000000000003'::uuid"
    cases = (
        ("none", ("32000000-0000-0000-0000-000000000001",)),
        ("pending_signature", ("32000000-0000-0000-0000-000000000002",)),
        ("signed", ("32000000-0000-0000-0000-000000000003",)),
        ("active", ("32000000-0000-0000-0000-000000000004",)),
        ("closed", ("32000000-0000-0000-0000-000000000005", "32000000-0000-0000-0000-000000000006")),
    )
    chunks = [check(f"(select count(*)=6 and min(total_count)=6 and max(total_count)=6 from admin_customer_ids_by_latest_contract(null,null,'all',1,25,{c3}))", "F filter company scope/all/total_count exact")]
    for bucket, ids in cases:
        expected = "array[" + ",".join(q(x) + "::uuid" for x in ids) + "]"
        chunks.append(check(f"(select array_agg(customer_id order by customer_id)={expected} from admin_customer_ids_by_latest_contract(null,null,'{bucket}',1,25,{c3}))", f"F latest-contract {bucket} bucket exact"))
    chunks.extend((
        check(f"(select array_agg(customer_id)=array['32000000-0000-0000-0000-000000000006'::uuid] from admin_customer_ids_by_latest_contract('Needle',null,'all',1,25,{c3}))", "F text search exact"),
        check(f"(select array_agg(customer_id)=array['32000000-0000-0000-0000-000000000001'::uuid] from admin_customer_ids_by_latest_contract(null,'active','all',1,25,{c3}))", "F customer-status exact"),
        check(f"(select count(*)=2 and min(total_count)=6 and max(total_count)=6 from admin_customer_ids_by_latest_contract(null,null,'all',1,2,{c3}))", "F pagination page-size and total_count exact"),
        check(f"(select count(*)=2 and min(total_count)=6 and max(total_count)=6 from admin_customer_ids_by_latest_contract(null,null,'all',2,2,{c3}))", "F pagination offset exact"),
        check(f"(select array_agg(customer_id order by customer_id desc)=array['32000000-0000-0000-0000-000000000006'::uuid] and min(total_count)=6 from admin_customer_ids_by_latest_contract(null,null,'all',1,0,{c3}))", "F page_size zero clamps to one exact row"),
        check(f"(select array_agg(customer_id order by customer_id desc)=array['32000000-0000-0000-0000-000000000006'::uuid] and min(total_count)=6 from admin_customer_ids_by_latest_contract(null,null,'all',1,-7,{c3}))", "F negative page_size clamps to one exact row"),
        check(f"(select array_agg(customer_id order by customer_id desc)=array['32000000-0000-0000-0000-000000000006'::uuid,'32000000-0000-0000-0000-000000000005'::uuid] and min(total_count)=6 from admin_customer_ids_by_latest_contract(null,null,'all',0,2,{c3}))", "F page_num zero clamps to first-page exact rows"),
        check(f"(select array_agg(customer_id order by customer_id desc)=array['32000000-0000-0000-0000-000000000006'::uuid,'32000000-0000-0000-0000-000000000005'::uuid] and min(total_count)=6 from admin_customer_ids_by_latest_contract(null,null,'all',-3,2,{c3}))", "F negative page_num clamps to first-page exact rows"),
        check("(select count(*)=1 and min(total_count)=1 from admin_customer_ids_by_latest_contract(null,null,'all',1,25,'22000000-0000-0000-0000-000000000004'))", "F opposite-company scope exact"),
    ))
    return "".join(chunks)


def control_behavior_sql() -> str:
    return """
create temporary table rpc_ediel_first as select * from gridex_companies_missing_ediel_profile();
create temporary table rpc_route_first as select * from gridex_companies_missing_route_setup();
select test_assert((select array_agg(id order by id)=array['22000000-0000-0000-0000-000000000004'::uuid,'22000000-0000-0000-0000-000000000007'::uuid] from rpc_ediel_first where id::text like '22000000-%'),'missing-ediel RPC exact inactive/missing result; active/NULL/excluded absent');
select test_assert((select array_agg(id order by id)=array['22000000-0000-0000-0000-000000000004'::uuid,'22000000-0000-0000-0000-000000000007'::uuid] from rpc_route_first where id::text like '22000000-%'),'missing-route RPC exact inactive/no-route result; active/NULL/excluded absent');
select test_assert(not exists(select 1 from rpc_ediel_first where id in ('22000000-0000-0000-0000-000000000006','22000000-0000-0000-0000-000000000008')) and not exists(select 1 from rpc_route_first where id in ('22000000-0000-0000-0000-000000000006','22000000-0000-0000-0000-000000000008')),'both RPCs explicitly exclude archived and deleted_test_only companies');
select test_assert(not exists((select * from rpc_ediel_first except all select * from gridex_companies_missing_ediel_profile()) union all (select * from gridex_companies_missing_ediel_profile() except all select * from rpc_ediel_first)),'missing-ediel RPC deterministic and actually invoked');
select test_assert(not exists((select * from rpc_route_first except all select * from gridex_companies_missing_route_setup()) union all (select * from gridex_companies_missing_route_setup() except all select * from rpc_route_first)),'missing-route RPC deterministic and actually invoked');
create temporary table audit_overview_first as select * from metering_billing_audit_overview;
select test_assert((select total_metering_values=3 and current_metering_values=2 and replaced_metering_values=2 and total_billing_underlays=2 and ready_underlays=1 and blocked_underlays=1 and total_partner_exports=2 and latest_activity_at='2026-02-07Z'::timestamptz from audit_overview_first where company_id='22000000-0000-0000-0000-000000000007'),'overview exact counts/status buckets/greatest timestamp');
select test_assert((select total_metering_values=0 and total_billing_underlays=0 and total_partner_exports=0 and latest_activity_at='2026-01-01Z'::timestamptz from audit_overview_first where company_id='22000000-0000-0000-0000-000000000003'),'overview empty-aggregate fallback to company timestamp');
select test_assert(not exists((select * from audit_overview_first except all select * from metering_billing_audit_overview) union all (select * from metering_billing_audit_overview except all select * from audit_overview_first)),'11-column overview deterministic and actually queried');
select test_assert((select count(*)=0 from platform_session_revocations),'session journal creates no spontaneous rows');
"""


def open_gates_sql() -> str:
    return """-- OPEN: final ACL/RLS/retention/runtime/parity gates were not executed.
-- OPEN: possible_existing_customer_id FK, stronger version constraints, import alias/JSON convergence.
-- OPEN: durable governance/import audit delivery, real session invalidation, production binding.
"""
