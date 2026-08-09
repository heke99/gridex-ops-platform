-- GRIDEX-OPS-BL-006 — isolate platform-global contact and lookup-cache reads.
-- Residual same-pattern variants after GRIDEX-OPS-BL-002.
--
-- Live reconciliation on 2026-08-09 found policy-compacted gridex_mp_* SELECT
-- policies for anon/authenticated/authenticator still containing auth.uid() IS NOT NULL.
-- This forward migration therefore removes every externally reachable SELECT policy
-- on the three platform-global tables, regardless of generated policy name, then
-- recreates the canonical platform-admin/service-role model already proven by BL-002.
-- Historical migrations remain immutable.

begin;

set local search_path = public, pg_catalog;

do $$
declare
  v_table text;
begin
  if to_regprocedure('public.gridex_user_is_platform_admin()') is null then
    raise exception 'gridex_user_is_platform_admin_missing';
  end if;

  foreach v_table in array array[
    'platform_actor_contacts',
    'platform_address_lookup_cache',
    'platform_energy_lookup_cache'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'required_table_missing:%', v_table;
    end if;
  end loop;
end;
$$;

alter table public.platform_actor_contacts enable row level security;
alter table public.platform_address_lookup_cache enable row level security;
alter table public.platform_energy_lookup_cache enable row level security;

revoke select on table
  public.platform_actor_contacts,
  public.platform_address_lookup_cache,
  public.platform_energy_lookup_cache
from public, anon;

grant select on table
  public.platform_actor_contacts,
  public.platform_address_lookup_cache,
  public.platform_energy_lookup_cache
to authenticated, service_role;

do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'platform_actor_contacts',
    'platform_address_lookup_cache',
    'platform_energy_lookup_cache'
  ] loop
    for v_policy in
      select p.polname
      from pg_policy p
      where p.polrelid = to_regclass('public.' || v_table)
        and p.polcmd = 'r'
        and (
          p.polname in (
            v_table || '_auth_read',
            v_table || '_read',
            v_table || '_platform_admin_read',
            v_table || '_service_role_read'
          )
          or exists (
            select 1
            from unnest(p.polroles) as role_oid(oid)
            left join pg_roles r on r.oid = role_oid.oid
            where role_oid.oid = 0
               or r.rolname in ('anon', 'authenticated', 'authenticator')
          )
        )
    loop
      execute format('drop policy if exists %I on public.%I', v_policy.polname, v_table);
    end loop;
  end loop;
end;
$$;

create policy platform_actor_contacts_platform_admin_read
  on public.platform_actor_contacts
  for select
  to authenticated
  using ((select public.gridex_user_is_platform_admin()));
create policy platform_actor_contacts_service_role_read
  on public.platform_actor_contacts
  for select
  to service_role
  using (true);

create policy platform_address_lookup_cache_platform_admin_read
  on public.platform_address_lookup_cache
  for select
  to authenticated
  using ((select public.gridex_user_is_platform_admin()));
create policy platform_address_lookup_cache_service_role_read
  on public.platform_address_lookup_cache
  for select
  to service_role
  using (true);

create policy platform_energy_lookup_cache_platform_admin_read
  on public.platform_energy_lookup_cache
  for select
  to authenticated
  using ((select public.gridex_user_is_platform_admin()));
create policy platform_energy_lookup_cache_service_role_read
  on public.platform_energy_lookup_cache
  for select
  to service_role
  using (true);

comment on policy platform_actor_contacts_platform_admin_read on public.platform_actor_contacts
  is 'GRIDEX-OPS-BL-006: platform-global actor contacts are visible only to active platform admins.';
comment on policy platform_actor_contacts_service_role_read on public.platform_actor_contacts
  is 'GRIDEX-OPS-BL-006: service-role access for admin contact management and export.';
comment on policy platform_address_lookup_cache_platform_admin_read on public.platform_address_lookup_cache
  is 'GRIDEX-OPS-BL-006: address lookup cache is visible only to active platform admins.';
comment on policy platform_address_lookup_cache_service_role_read on public.platform_address_lookup_cache
  is 'GRIDEX-OPS-BL-006: service-role access for energy-resolver cache reads.';
comment on policy platform_energy_lookup_cache_platform_admin_read on public.platform_energy_lookup_cache
  is 'GRIDEX-OPS-BL-006: energy lookup cache is visible only to active platform admins.';
comment on policy platform_energy_lookup_cache_service_role_read on public.platform_energy_lookup_cache
  is 'GRIDEX-OPS-BL-006: service-role access for energy-resolver cache reads.';

do $$
declare
  v_table text;
  v_bad integer;
begin
  foreach v_table in array array[
    'platform_actor_contacts',
    'platform_address_lookup_cache',
    'platform_energy_lookup_cache'
  ] loop
    select count(*)::integer
      into v_bad
    from pg_policy p
    where p.polrelid = to_regclass('public.' || v_table)
      and p.polcmd = 'r'
      and exists (
        select 1
        from unnest(p.polroles) as role_oid(oid)
        left join pg_roles r on r.oid = role_oid.oid
        where role_oid.oid = 0
           or r.rolname in ('anon', 'authenticated', 'authenticator')
      )
      and (
        pg_get_expr(p.polqual, p.polrelid, true) ilike '%auth.uid()%IS NOT NULL%'
        or p.polname <> v_table || '_platform_admin_read'
      );

    if v_bad <> 0 then
      raise exception 'bl006_external_read_policy_residual:%:%', v_table, v_bad;
    end if;
  end loop;
end;
$$;

commit;
