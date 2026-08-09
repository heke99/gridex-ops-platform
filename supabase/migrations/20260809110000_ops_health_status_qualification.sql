-- Runtime remediation: prevent PL/pgSQL output variable `status` from colliding
-- with unqualified table columns in gridex_ops_health_checks().
--
-- Production evidence on 2026-08-09 reproduced SQLSTATE 42702 at
-- tenant_email_outbox.status. Qualify every table status reference in the same
-- function so health checks do not fail one relation at a time.

begin;

create or replace function public.gridex_ops_health_checks()
returns table (
  check_key text,
  status text,
  issue_count bigint,
  details jsonb
)
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  expected text[] := array[
    'customer_operation_jobs',
    'customer_operation_request_snapshots',
    'customer_application_workflows',
    'customer_sites',
    'customer_site_resolution',
    'customer_site_address_conflicts',
    'platform_grid_areas',
    'platform_grid_owners',
    'grid_owners',
    'gridex_verified_grid_owners_v',
    'tenant_email_outbox',
    'webhook_deliveries',
    'ediel_outbox'
  ];
  item text;
  missing_count bigint := 0;
  count_value bigint;
begin
  foreach item in array expected loop
    if to_regclass('public.' || item) is null then
      missing_count := missing_count + 1;
      return query select
        'schema:' || item,
        'blocking'::text,
        1::bigint,
        jsonb_build_object('missing_relation', item);
    end if;
  end loop;

  if missing_count > 0 then
    return;
  end if;

  select count(*) into count_value
  from (
    select job.company_id, job.job_type, job.idempotency_key
    from public.customer_operation_jobs job
    where job.status in ('queued', 'running', 'waiting_response')
      and job.idempotency_key is not null
    group by job.company_id, job.job_type, job.idempotency_key
    having count(*) > 1
  ) active_duplicates;
  return query select 'queue:customer_operation_active_idempotency_duplicate',
    case when count_value = 0 then 'ok' else 'blocking' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.customer_operation_jobs job
  where job.status = 'running'
    and job.locked_at < now() - interval '15 minutes';
  return query select 'queue:customer_operation_stale',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.tenant_email_outbox email_outbox
  where email_outbox.status = 'delivery_uncertain';
  return query select 'queue:email_delivery_uncertain',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.webhook_deliveries webhook
  where webhook.status = 'processing'
    and webhook.locked_at < now() - interval '15 minutes';
  return query select 'queue:webhook_stale_processing',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.ediel_outbox ediel
  where ediel.status = 'delivery_uncertain';
  return query select 'queue:ediel_delivery_uncertain',
    case when count_value = 0 then 'ok' else 'blocking' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.platform_grid_areas a
  left join public.platform_grid_owners pgo on pgo.id = a.grid_owner_id
  where a.is_active
    and (a.grid_owner_id is null or pgo.ops_grid_owner_id is null);
  return query select 'masterdata:grid_area_ops_owner_mapping_missing',
    case when count_value = 0 then 'ok' else 'blocking' end,
    count_value,
    '{}'::jsonb;

  if exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'gridex_verified_grid_owners_v'
      and c.column_name = 'can_use_for_prodat'
  ) then
    execute 'select count(*) from public.gridex_verified_grid_owners_v where coalesce(can_use_for_prodat, false) = false'
      into count_value;
    return query select 'masterdata:grid_owner_prodat_readiness_missing',
      case when count_value = 0 then 'ok' else 'warning' end,
      count_value,
      jsonb_build_object('source', 'gridex_verified_grid_owners_v');
  else
    return query select 'schema:gridex_verified_grid_owners_v.can_use_for_prodat',
      'blocking'::text,
      1::bigint,
      jsonb_build_object('missing_column', 'can_use_for_prodat');
  end if;

  select count(*) into count_value
  from (
    select conflict.company_id, conflict.customer_site_id, conflict.dedupe_key
    from public.customer_site_address_conflicts conflict
    where conflict.status = 'open' and conflict.dedupe_key is not null
    group by conflict.company_id, conflict.customer_site_id, conflict.dedupe_key
    having count(*) > 1
  ) duplicates;
  return query select 'address_conflict:duplicate_open',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.customer_sites site
  where site.status = 'active'
    and site.resolution_status in ('needs_review', 'failed')
    and coalesce(trim(site.street), '') <> '';
  return query select 'customer_site:unresolved_grid_context',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    '{}'::jsonb;
end;
$$;

revoke all on function public.gridex_ops_health_checks() from public;
revoke all on function public.gridex_ops_health_checks() from anon;
revoke all on function public.gridex_ops_health_checks() from authenticated;
grant execute on function public.gridex_ops_health_checks() to service_role;

commit;
