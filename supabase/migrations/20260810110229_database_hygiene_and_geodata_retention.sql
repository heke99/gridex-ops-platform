-- Remove exact duplicate access paths found by the live schema audit and add a
-- conservative, service-role-only cleanup path for completed geodata staging.

-- Each index below duplicates a unique index or a constraint-backed index with
-- the same key/predicate. No constraint or external dependency points at these
-- non-unique copies.
drop index if exists public.idx_company_email_settings_company_id;
drop index if exists public.idx_company_monthly_metrics_company_month;
drop index if exists public.customer_portal_accounts_company_portal_user_idx;
drop index if exists public.idx_customer_portal_accounts_user_customer;
drop index if exists public.ediel_test_run_steps_run_idx;
drop index if exists public.idx_ediel_tgt_test_data_case;
drop index if exists public.energy_geodata_features_staging_version_idx;
drop index if exists public.idx_grid_owners_ediel_id;
drop index if exists public.idx_grid_owners_owner_code;
drop index if exists public.integration_api_write_idempotency_lookup_idx;
drop index if exists public.meter_reading_values_series_order_idx;
drop index if exists public.idx_onboarding_choices_session_key;
drop index if exists public.status_transition_rules_entity_idx;

-- This internal readiness table has RLS and no public policies. Remove the
-- underlying table grants too, so access is denied by both privilege and RLS.
revoke all on table public.platform_schema_state from anon, authenticated;
grant select, insert, update, delete on table public.platform_schema_state to service_role;

insert into public.gridex_data_retention_policies (
  data_category,
  retention_days,
  action,
  notes
)
values (
  'energy_geodata_staging',
  14,
  'delete',
  'Delete staged feature payloads only for failed or superseded versions after the audit window. Version audit rows and the verified version are retained.'
)
on conflict (data_category) do update set
  retention_days = excluded.retention_days,
  action = excluded.action,
  notes = excluded.notes,
  updated_at = now();

create or replace function public.cleanup_energy_geodata_staging_v1(
  p_retention_days integer default null,
  p_dry_run boolean default true
)
returns table (
  candidate_versions bigint,
  candidate_features bigint,
  candidate_bytes bigint,
  deleted_features bigint,
  dry_run boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_retention_days integer;
  v_candidate_versions bigint := 0;
  v_candidate_features bigint := 0;
  v_candidate_bytes bigint := 0;
  v_deleted_features bigint := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'energy_geodata_cleanup_service_role_required' using errcode = '42501';
  end if;

  select coalesce(
    p_retention_days,
    (
      select retention_days
      from public.gridex_data_retention_policies
      where data_category = 'energy_geodata_staging'
        and is_enabled
    )
  ) into v_retention_days;

  if v_retention_days is null or v_retention_days < 1 or v_retention_days > 3650 then
    raise exception 'energy_geodata_cleanup_retention_days_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('energy-geodata-staging-cleanup', 0));

  with candidates as (
    select s.*
    from public.energy_geodata_features_staging s
    join public.energy_geodata_versions v on v.id = s.geodata_version_id
    where v.status in ('failed', 'superseded')
      and coalesce(v.completed_at, v.updated_at, v.created_at)
        < now() - (v_retention_days * interval '1 day')
  )
  select
    count(distinct geodata_version_id),
    count(*),
    coalesce(sum(pg_column_size(candidates.*)), 0)
  into
    v_candidate_versions,
    v_candidate_features,
    v_candidate_bytes
  from candidates;

  if not p_dry_run then
    delete from public.energy_geodata_features_staging s
    using public.energy_geodata_versions v
    where v.id = s.geodata_version_id
      and v.status in ('failed', 'superseded')
      and coalesce(v.completed_at, v.updated_at, v.created_at)
        < now() - (v_retention_days * interval '1 day');
    get diagnostics v_deleted_features = row_count;
  end if;

  candidate_versions := v_candidate_versions;
  candidate_features := v_candidate_features;
  candidate_bytes := v_candidate_bytes;
  deleted_features := v_deleted_features;
  dry_run := p_dry_run;
  return next;
end;
$$;

revoke all on function public.cleanup_energy_geodata_staging_v1(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.cleanup_energy_geodata_staging_v1(integer, boolean)
  to service_role;

comment on function public.cleanup_energy_geodata_staging_v1(integer, boolean) is
  'Dry-run-first cleanup of expired failed/superseded geodata staging payloads. Never targets importing or verified versions; service role only.';
