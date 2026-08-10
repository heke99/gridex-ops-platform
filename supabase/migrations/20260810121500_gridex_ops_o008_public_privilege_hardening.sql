-- GRIDEX-OPS-O-008 residual — revoke PUBLIC grants on readiness surfaces.
-- Post-#104 variant: also close the incomplete platform_schema_state revoke
-- from 20260810110229 that omitted PUBLIC.
--
-- 20260809131500 narrowed anon/authenticated privileges, but inherited PUBLIC
-- table/view grants can still make SELECT visible to anon/authenticated through
-- PostgreSQL's PUBLIC pseudo-role. Fail closed after an explicit PUBLIC revoke.
--
-- Forward timestamp 20260810121500: tip after #104 retention classification
-- (20260810110829). Do not reuse unmerged draft timestamp 20260809151500.

begin;

set local search_path = public, pg_catalog;

do $$
begin
  if to_regclass('public.actor_readiness_status') is null then
    raise exception 'actor_readiness_status_missing';
  end if;
  if to_regclass('public.platform_schema_state') is null then
    raise exception 'platform_schema_state_missing';
  end if;
end;
$$;

revoke all privileges on public.actor_readiness_status from public, anon;
grant select on public.actor_readiness_status to authenticated, service_role;

revoke all privileges on
  public.actor_readiness_by_role_v,
  public.grid_owner_supplier_switch_readiness_v,
  public.electricity_supplier_readiness_v,
  public.system_supplier_readiness_v,
  public.non_electricity_actor_readiness_v
from public, anon, authenticated;

grant select on
  public.actor_readiness_by_role_v,
  public.grid_owner_supplier_switch_readiness_v,
  public.electricity_supplier_readiness_v,
  public.system_supplier_readiness_v,
  public.non_electricity_actor_readiness_v
to service_role;

-- Hygiene migration revoked anon/authenticated only. Complete the intent by
-- removing PUBLIC grants so Data API roles cannot inherit SELECT/DML.
revoke all on table public.platform_schema_state from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_schema_state to service_role;

do $$
declare
  v_view text;
begin
  if has_table_privilege('anon', 'public.actor_readiness_status', 'SELECT') then
    raise exception 'anon_still_has_actor_readiness_status_select';
  end if;

  if not has_table_privilege('authenticated', 'public.actor_readiness_status', 'SELECT') then
    raise exception 'authenticated_missing_actor_readiness_status_select';
  end if;

  foreach v_view in array array[
    'actor_readiness_by_role_v',
    'grid_owner_supplier_switch_readiness_v',
    'electricity_supplier_readiness_v',
    'system_supplier_readiness_v',
    'non_electricity_actor_readiness_v'
  ] loop
    if has_table_privilege('anon', format('public.%I', v_view), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', v_view), 'SELECT') then
      raise exception 'readiness_dashboard_still_externally_selectable:%', v_view;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.platform_schema_state', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_schema_state', 'SELECT')
     or has_table_privilege('anon', 'public.platform_schema_state', 'INSERT')
     or has_table_privilege('authenticated', 'public.platform_schema_state', 'INSERT')
     or has_table_privilege('anon', 'public.platform_schema_state', 'UPDATE')
     or has_table_privilege('authenticated', 'public.platform_schema_state', 'UPDATE')
     or has_table_privilege('anon', 'public.platform_schema_state', 'DELETE')
     or has_table_privilege('authenticated', 'public.platform_schema_state', 'DELETE') then
    raise exception 'platform_schema_state_still_externally_selectable';
  end if;
end;
$$;

commit;
