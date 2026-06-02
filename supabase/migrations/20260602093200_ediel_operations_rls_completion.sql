-- RLS completion for Ediel operations runtime tables.
-- Uses the existing Gridex tenant helper functions.

do $$
declare
  t text;
  select_policy text;
  insert_policy text;
  update_policy text;
begin
  foreach t in array array[
    'ediel_message_payloads',
    'ediel_message_correlations',
    'ediel_outbound_queue',
    'ediel_send_locks',
    'ediel_dedupe_keys',
    'energy_service_permissions',
    'energy_service_permission_events',
    'metering_value_batches',
    'metering_values',
    'metering_value_errors',
    'customer_communications',
    'customer_communication_templates',
    'customer_communication_events',
    'ediel_certificates',
    'ediel_it_system_profiles'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);

      select_policy := t || '_tenant_select';
      insert_policy := t || '_tenant_insert';
      update_policy := t || '_tenant_update';

      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t and policyname = select_policy
      ) then
        execute format(
          'create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id)))',
          select_policy,
          t
        );
      end if;

      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t and policyname = insert_policy
      ) then
        execute format(
          'create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_write_company(company_id)))',
          insert_policy,
          t
        );
      end if;

      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t and policyname = update_policy
      ) then
        execute format(
          'create policy %I on public.%I for update using (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id))) with check (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_write_company(company_id)))',
          update_policy,
          t
        );
      end if;
    end if;
  end loop;
end $$;

create index if not exists ediel_outbound_queue_correlation_gin
  on public.ediel_outbound_queue using gin (correlation_keys);

create index if not exists energy_service_permissions_company_point_idx
  on public.energy_service_permissions(company_id, metering_point_id, permission_state);
