-- Preserve the selected core01 role helper after complete historical Batch 6E replay.
-- This definition is intentionally byte-for-byte equal to the function statement
-- in 01_db1_schema_repair_core_helpers_and_canonical_tables.sql. CREATE OR REPLACE
-- preserves the existing function identity, owner and ACL.

create or replace function public.gridex_user_has_role_key(p_role_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  has_role_id boolean := false;
  has_role_text boolean := false;
  has_role_key boolean := false;
  has_status boolean := false;
  has_is_active boolean := false;
  sql text;
  result boolean := false;
begin
  if p_role_key is null or auth.uid() is null then
    return false;
  end if;
  if to_regclass('public.user_roles') is null then
    return false;
  end if;

  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='role_id') into has_role_id;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='role') into has_role_text;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='role_key') into has_role_key;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='status') into has_status;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='is_active') into has_is_active;

  sql := 'select exists (select 1 from public.user_roles ur ';
  if has_role_id and to_regclass('public.roles') is not null then
    sql := sql || 'left join public.roles r on r.id = ur.role_id ';
  end if;
  sql := sql || 'where ur.user_id = $1 and (';

  if has_role_text then
    sql := sql || 'lower(coalesce(ur.role, '''')) = lower($2)';
  else
    sql := sql || 'false';
  end if;
  if has_role_key then
    sql := sql || ' or lower(coalesce(ur.role_key, '''')) = lower($2)';
  end if;
  if has_role_id and to_regclass('public.roles') is not null then
    sql := sql || ' or lower(coalesce(r.key, r.name, '''')) = lower($2)';
  end if;
  sql := sql || ')';

  if has_status then
    sql := sql || ' and coalesce(ur.status, ''active'') = ''active''';
  end if;
  if has_is_active then
    sql := sql || ' and coalesce(ur.is_active, true) = true';
  end if;

  sql := sql || ')';
  execute sql into result using auth.uid(), p_role_key;
  return coalesce(result, false);
exception when others then
  return false;
end;
$$;

-- The selected 20260611190000 linter hardening subsequently changes this helper's
-- execution mode and search path without changing its body. Reapply those final
-- selected options after restoring the core body; CREATE OR REPLACE retains ACLs.
alter function public.gridex_user_has_role_key(text) security invoker;
alter function public.gridex_user_has_role_key(text)
  set search_path = public, auth, extensions;
revoke all on function public.gridex_user_has_role_key(text) from public, anon;
grant execute on function public.gridex_user_has_role_key(text) to authenticated, service_role;
