-- Ediel runtime hardening follow-up.
-- Tenant-safe RLS for hardening tables plus route-profile history snapshots.

begin;

create extension if not exists pgcrypto;

alter table if exists public.ediel_counterparties enable row level security;
alter table if exists public.grid_owners enable row level security;
alter table if exists public.customer_data_tasks enable row level security;

do $$
begin
  if to_regprocedure('public.gridex_user_is_platform_admin()') is null
     or to_regprocedure('public.gridex_can_read_company(uuid)') is null
     or to_regprocedure('public.gridex_can_write_company(uuid)') is null then
    return;
  end if;

  if to_regclass('public.ediel_counterparties') is not null then
    drop policy if exists gridex_ediel_counterparties_select_company on public.ediel_counterparties;
    drop policy if exists gridex_ediel_counterparties_write_platform on public.ediel_counterparties;

    create policy gridex_ediel_counterparties_select_company
      on public.ediel_counterparties
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));

    create policy gridex_ediel_counterparties_write_platform
      on public.ediel_counterparties
      for all
      using (public.gridex_user_is_platform_admin())
      with check (public.gridex_user_is_platform_admin());
  end if;

  if to_regclass('public.grid_owners') is not null then
    drop policy if exists gridex_grid_owners_select_company on public.grid_owners;
    drop policy if exists gridex_grid_owners_write_platform on public.grid_owners;

    create policy gridex_grid_owners_select_company
      on public.grid_owners
      for select
      using (
        public.gridex_user_is_platform_admin()
        or company_id is null
        or public.gridex_can_read_company(company_id)
      );

    create policy gridex_grid_owners_write_platform
      on public.grid_owners
      for all
      using (public.gridex_user_is_platform_admin())
      with check (public.gridex_user_is_platform_admin());
  end if;

  if to_regclass('public.customer_data_tasks') is not null then
    drop policy if exists customer_data_tasks_tenant_select on public.customer_data_tasks;
    drop policy if exists customer_data_tasks_tenant_insert on public.customer_data_tasks;
    drop policy if exists customer_data_tasks_tenant_update on public.customer_data_tasks;
    drop policy if exists customer_data_tasks_platform_delete on public.customer_data_tasks;

    create policy customer_data_tasks_tenant_select
      on public.customer_data_tasks
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));

    create policy customer_data_tasks_tenant_insert
      on public.customer_data_tasks
      for insert
      with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id));

    create policy customer_data_tasks_tenant_update
      on public.customer_data_tasks
      for update
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))
      with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id));

    create policy customer_data_tasks_platform_delete
      on public.customer_data_tasks
      for delete
      using (public.gridex_user_is_platform_admin());
  end if;
end $$;

do $$
begin
  if to_regclass('public.customer_data_tasks') is not null then
    if not exists (select 1 from pg_constraint where conname = 'customer_data_tasks_status_check') then
      alter table public.customer_data_tasks
        add constraint customer_data_tasks_status_check
        check (status in ('open','in_progress','completed','cancelled','ignored'));
    end if;

    if not exists (select 1 from pg_constraint where conname = 'customer_data_tasks_priority_check') then
      alter table public.customer_data_tasks
        add constraint customer_data_tasks_priority_check
        check (priority in ('low','normal','high','urgent'));
    end if;

    if not exists (select 1 from pg_constraint where conname = 'customer_data_tasks_type_check') then
      alter table public.customer_data_tasks
        add constraint customer_data_tasks_type_check
        check (task_type in (
          'missing_facility_id',
          'missing_metering_point',
          'missing_grid_owner',
          'grid_owner_review_required',
          'invoice_review_required',
          'contact_customer',
          'contact_grid_owner',
          'request_customer_completion'
        ) or task_type like 'route_%');
    end if;
  end if;
end $$;

create or replace function public.gridex_capture_ediel_route_profile_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route_version integer;
  v_actor uuid;
begin
  if TG_OP = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;
  end if;

  v_route_version := coalesce(new.route_version, 1);
  v_actor := coalesce(new.updated_by, new.created_by);

  insert into public.ediel_route_history (
    route_profile_id,
    company_id,
    route_version,
    snapshot,
    change_reason,
    created_by
  )
  values (
    new.id,
    new.company_id,
    v_route_version,
    to_jsonb(new),
    case when TG_OP = 'INSERT' then 'created' else 'updated' end,
    v_actor
  )
  on conflict (route_profile_id, route_version) do nothing;

  return new;
end;
$$;

drop trigger if exists gridex_ediel_route_profile_history_trg on public.ediel_route_profiles;
create trigger gridex_ediel_route_profile_history_trg
after insert or update on public.ediel_route_profiles
for each row execute function public.gridex_capture_ediel_route_profile_history();

commit;
