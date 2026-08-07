-- GRIDEX-OPS-BL-006 — isolate platform-global contact and lookup-cache reads.
-- Residual same-pattern variants after GRIDEX-OPS-BL-002.
-- Additive forward migration. Historical migrations remain unchanged.

begin;

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

-- Anonymous callers have no legitimate read path for contact or lookup-cache data.
revoke select on table
  public.platform_actor_contacts,
  public.platform_address_lookup_cache,
  public.platform_energy_lookup_cache
from anon;

-- Platform admins may use an authenticated server session. Energy-resolver and
-- admin contact/export paths continue to use service_role.
grant select on table
  public.platform_actor_contacts,
  public.platform_address_lookup_cache,
  public.platform_energy_lookup_cache
to authenticated, service_role;

drop policy if exists platform_actor_contacts_auth_read on public.platform_actor_contacts;
drop policy if exists platform_actor_contacts_platform_admin_read on public.platform_actor_contacts;
drop policy if exists platform_actor_contacts_service_role_read on public.platform_actor_contacts;
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
comment on policy platform_actor_contacts_platform_admin_read on public.platform_actor_contacts
  is 'GRIDEX-OPS-BL-006: platform-global actor contacts are visible only to active platform admins.';
comment on policy platform_actor_contacts_service_role_read on public.platform_actor_contacts
  is 'GRIDEX-OPS-BL-006: service-role access for admin contact management and export.';

drop policy if exists platform_address_lookup_cache_read on public.platform_address_lookup_cache;
drop policy if exists platform_address_lookup_cache_platform_admin_read on public.platform_address_lookup_cache;
drop policy if exists platform_address_lookup_cache_service_role_read on public.platform_address_lookup_cache;
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
comment on policy platform_address_lookup_cache_platform_admin_read on public.platform_address_lookup_cache
  is 'GRIDEX-OPS-BL-006: address lookup cache is visible only to active platform admins.';
comment on policy platform_address_lookup_cache_service_role_read on public.platform_address_lookup_cache
  is 'GRIDEX-OPS-BL-006: service-role access for energy-resolver cache reads.';

drop policy if exists platform_energy_lookup_cache_read on public.platform_energy_lookup_cache;
drop policy if exists platform_energy_lookup_cache_platform_admin_read on public.platform_energy_lookup_cache;
drop policy if exists platform_energy_lookup_cache_service_role_read on public.platform_energy_lookup_cache;
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
comment on policy platform_energy_lookup_cache_platform_admin_read on public.platform_energy_lookup_cache
  is 'GRIDEX-OPS-BL-006: energy lookup cache is visible only to active platform admins.';
comment on policy platform_energy_lookup_cache_service_role_read on public.platform_energy_lookup_cache
  is 'GRIDEX-OPS-BL-006: service-role access for energy-resolver cache reads.';

commit;
