-- GRIDEX-OPS-BL-002 — isolate platform-global actor registry and EDIEL job reads.
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
    'actor_registry_conflicts',
    'actor_registry_import_items',
    'actor_registry_import_runs',
    'ediel_certificate_refresh_jobs'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'required_table_missing:%', v_table;
    end if;
  end loop;
end;
$$;

alter table public.actor_registry_conflicts enable row level security;
alter table public.actor_registry_import_items enable row level security;
alter table public.actor_registry_import_runs enable row level security;
alter table public.ediel_certificate_refresh_jobs enable row level security;

-- Anonymous callers have no legitimate read path for platform-global operational data.
revoke select on table
  public.actor_registry_conflicts,
  public.actor_registry_import_items,
  public.actor_registry_import_runs,
  public.ediel_certificate_refresh_jobs
from anon;

-- Platform admins continue to use their authenticated server session. Background
-- actor-registry and certificate workers continue to use service_role.
grant select on table
  public.actor_registry_conflicts,
  public.actor_registry_import_items,
  public.actor_registry_import_runs,
  public.ediel_certificate_refresh_jobs
to authenticated, service_role;

drop policy if exists actor_registry_conflicts_read on public.actor_registry_conflicts;
drop policy if exists actor_registry_conflicts_platform_admin_read on public.actor_registry_conflicts;
drop policy if exists actor_registry_conflicts_service_role_read on public.actor_registry_conflicts;
create policy actor_registry_conflicts_platform_admin_read
  on public.actor_registry_conflicts
  for select
  to authenticated
  using ((select public.gridex_user_is_platform_admin()));
create policy actor_registry_conflicts_service_role_read
  on public.actor_registry_conflicts
  for select
  to service_role
  using (true);
comment on policy actor_registry_conflicts_platform_admin_read on public.actor_registry_conflicts
  is 'GRIDEX-OPS-BL-002: platform-global conflict data is visible only to active platform admins.';
comment on policy actor_registry_conflicts_service_role_read on public.actor_registry_conflicts
  is 'GRIDEX-OPS-BL-002: service-role access for actor-registry background processing.';

drop policy if exists actor_registry_import_items_read on public.actor_registry_import_items;
drop policy if exists actor_registry_import_items_platform_admin_read on public.actor_registry_import_items;
drop policy if exists actor_registry_import_items_service_role_read on public.actor_registry_import_items;
create policy actor_registry_import_items_platform_admin_read
  on public.actor_registry_import_items
  for select
  to authenticated
  using ((select public.gridex_user_is_platform_admin()));
create policy actor_registry_import_items_service_role_read
  on public.actor_registry_import_items
  for select
  to service_role
  using (true);
comment on policy actor_registry_import_items_platform_admin_read on public.actor_registry_import_items
  is 'GRIDEX-OPS-BL-002: platform-global import staging is visible only to active platform admins.';
comment on policy actor_registry_import_items_service_role_read on public.actor_registry_import_items
  is 'GRIDEX-OPS-BL-002: service-role access for actor-registry background processing.';

drop policy if exists actor_registry_import_runs_read on public.actor_registry_import_runs;
drop policy if exists actor_registry_import_runs_platform_admin_read on public.actor_registry_import_runs;
drop policy if exists actor_registry_import_runs_service_role_read on public.actor_registry_import_runs;
create policy actor_registry_import_runs_platform_admin_read
  on public.actor_registry_import_runs
  for select
  to authenticated
  using ((select public.gridex_user_is_platform_admin()));
create policy actor_registry_import_runs_service_role_read
  on public.actor_registry_import_runs
  for select
  to service_role
  using (true);
comment on policy actor_registry_import_runs_platform_admin_read on public.actor_registry_import_runs
  is 'GRIDEX-OPS-BL-002: platform-global import history is visible only to active platform admins.';
comment on policy actor_registry_import_runs_service_role_read on public.actor_registry_import_runs
  is 'GRIDEX-OPS-BL-002: service-role access for actor-registry background processing.';

drop policy if exists ediel_certificate_refresh_jobs_read on public.ediel_certificate_refresh_jobs;
drop policy if exists ediel_certificate_refresh_jobs_platform_admin_read on public.ediel_certificate_refresh_jobs;
drop policy if exists ediel_certificate_refresh_jobs_service_role_read on public.ediel_certificate_refresh_jobs;
create policy ediel_certificate_refresh_jobs_platform_admin_read
  on public.ediel_certificate_refresh_jobs
  for select
  to authenticated
  using ((select public.gridex_user_is_platform_admin()));
create policy ediel_certificate_refresh_jobs_service_role_read
  on public.ediel_certificate_refresh_jobs
  for select
  to service_role
  using (true);
comment on policy ediel_certificate_refresh_jobs_platform_admin_read on public.ediel_certificate_refresh_jobs
  is 'GRIDEX-OPS-BL-002: platform-global EDIEL certificate jobs are visible only to active platform admins.';
comment on policy ediel_certificate_refresh_jobs_service_role_read on public.ediel_certificate_refresh_jobs
  is 'GRIDEX-OPS-BL-002: service-role access for certificate refresh workers.';

commit;
