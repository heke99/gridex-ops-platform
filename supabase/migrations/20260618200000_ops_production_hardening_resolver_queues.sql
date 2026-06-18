-- OPS production hardening: safe readiness, resolver coordinate support and queue recovery.
-- Forward-only, idempotent, tenant-safe. No destructive data operations.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) Customer-operation locks: stale internal work can be reclaimed safely.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.customer_operation_jobs') is not null then
    alter table public.customer_operation_jobs add column if not exists lock_token uuid;
    create index if not exists customer_operation_jobs_stale_lock_idx
      on public.customer_operation_jobs(status, locked_at)
      where status = 'running';
  end if;
end $$;

create or replace function public.gridex_claim_customer_operation_jobs(
  p_worker_id text,
  p_limit integer default 20
)
returns setof public.customer_operation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.customer_operation_jobs
    where (
      status = 'queued'
      and run_after <= now()
    ) or (
      status = 'running'
      and locked_at < now() - interval '15 minutes'
    )
    order by priority asc, run_after asc, created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.customer_operation_jobs jobs
  set status = 'running',
      attempts = case when jobs.status = 'queued' then jobs.attempts + 1 else jobs.attempts end,
      locked_at = now(),
      locked_by = nullif(trim(p_worker_id), ''),
      lock_token = gen_random_uuid(),
      last_error = case
        when jobs.status = 'running' then coalesce(jobs.last_error, 'stale_customer_operation_lock_reclaimed')
        else jobs.last_error
      end,
      updated_at = now()
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

revoke all on function public.gridex_claim_customer_operation_jobs(text, integer) from public;
revoke all on function public.gridex_claim_customer_operation_jobs(text, integer) from anon;
revoke all on function public.gridex_claim_customer_operation_jobs(text, integer) from authenticated;
grant execute on function public.gridex_claim_customer_operation_jobs(text, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 2) Email locks: never automatically resend an email after an uncertain send.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.tenant_email_outbox') is not null then
    alter table public.tenant_email_outbox add column if not exists locked_at timestamptz;
    alter table public.tenant_email_outbox add column if not exists locked_by text;
    alter table public.tenant_email_outbox add column if not exists lock_token uuid;
    alter table public.tenant_email_outbox drop constraint if exists tenant_email_outbox_status_check;
    alter table public.tenant_email_outbox
      add constraint tenant_email_outbox_status_check
      check (status in ('queued', 'processing', 'delivery_uncertain', 'sent', 'failed', 'cancelled'));
    create index if not exists tenant_email_outbox_processing_lock_idx
      on public.tenant_email_outbox(status, locked_at)
      where status = 'processing';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3) Inbound Ediel is idempotent and can reclaim a stale parser lock.
-- -----------------------------------------------------------------------------
create or replace function public.claim_inbound_processing_jobs(
  p_environment text default null,
  p_limit integer default 50,
  p_worker_id text default 'inbound-mail-engine',
  p_stale_after interval default interval '10 minutes'
)
returns setof public.inbound_processing_jobs
language plpgsql
as $$
begin
  return query
  with candidates as (
    select j.id
    from public.inbound_processing_jobs j
    left join public.inbound_email_messages m on m.id = j.inbound_email_message_id
    where (
      j.status in ('queued', 'retry', 'received')
      or (j.status = 'processing' and j.locked_at < now() - p_stale_after)
    )
      and (j.locked_at is null or j.locked_at < now() - p_stale_after)
      and (p_environment is null or coalesce(m.environment, 'test') = p_environment)
    order by j.created_at asc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  ), updated as (
    update public.inbound_processing_jobs j
       set status = 'processing',
           step = 'processor_claimed',
           locked_at = now(),
           locked_by = p_worker_id,
           started_at = now(),
           finished_at = null,
           attempts_count = coalesce(j.attempts_count, 0) + 1,
           error_message = case when j.status = 'processing' then coalesce(j.error_message, 'stale_inbound_lock_reclaimed') else null end,
           updated_at = now()
     where j.id in (select id from candidates)
     returning j.*
  )
  select * from updated;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) Outbound Ediel: stale sending is delivery-uncertain, never auto-resend.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.ediel_outbox') is not null then
    alter table public.ediel_outbox drop constraint if exists ediel_outbox_status_check;
    alter table public.ediel_outbox
      add constraint ediel_outbox_status_check
      check (status in ('draft', 'prepared', 'queued', 'sending', 'delivery_uncertain', 'sent', 'failed', 'superseded', 'blocked'));
    create index if not exists ediel_outbox_sending_lock_idx
      on public.ediel_outbox(status, locked_at)
      where status = 'sending';
  end if;
end $$;

create or replace function public.claim_ediel_outbox_items(
  p_environment text default null,
  p_company_id uuid default null,
  p_limit integer default 25,
  p_worker_id text default 'ediel-outbox-engine',
  p_stale_after interval default interval '10 minutes'
)
returns setof public.ediel_outbox
language plpgsql
as $$
begin
  update public.ediel_outbox
     set status = 'delivery_uncertain',
         last_error = coalesce(last_error, 'stale_sending_lock_requires_transport_reconciliation'),
         locked_at = null,
         locked_by = null,
         updated_at = now()
   where status = 'sending'
     and locked_at < now() - p_stale_after
     and (p_environment is null or environment = p_environment)
     and (p_company_id is null or company_id = p_company_id);

  return query
  with candidates as (
    select id
    from public.ediel_outbox
    where status in ('prepared', 'queued')
      and (locked_at is null or locked_at < now() - p_stale_after)
      and (p_environment is null or environment = p_environment)
      and (p_company_id is null or company_id = p_company_id)
    order by priority asc, created_at asc
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  ), updated as (
    update public.ediel_outbox o
       set status = 'sending',
           locked_at = now(),
           locked_by = p_worker_id,
           attempts = coalesce(o.attempts, 0) + 1,
           send_attempt_count = coalesce(o.send_attempt_count, 0) + 1,
           current_send_attempt_id = gen_random_uuid(),
           updated_at = now()
     where o.id in (select id from candidates)
     returning o.*
  )
  select * from updated;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) WGS84 geocoding support. SVK geometry is stored in EPSG:3006.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_lonlat_to_grid_area(
  p_longitude numeric,
  p_latitude numeric
)
returns table (
  grid_area_code text,
  grid_area_name text,
  grid_owner_id uuid,
  grid_owner_name text,
  price_area text,
  confidence numeric,
  source text
)
language sql
stable
as $$
  with projected as (
    select extensions.ST_Transform(
      extensions.ST_SetSRID(
        extensions.ST_MakePoint(
          p_longitude::double precision,
          p_latitude::double precision
        ),
        4326
      ),
      3006
    ) as geom
  )
  select resolved.*
  from projected
  cross join lateral public.gridex_point_to_grid_area(
    extensions.ST_X(projected.geom)::numeric,
    extensions.ST_Y(projected.geom)::numeric
  ) as resolved;
$$;

revoke all on function public.gridex_lonlat_to_grid_area(numeric, numeric) from public;
revoke all on function public.gridex_lonlat_to_grid_area(numeric, numeric) from anon;
revoke all on function public.gridex_lonlat_to_grid_area(numeric, numeric) from authenticated;
grant execute on function public.gridex_lonlat_to_grid_area(numeric, numeric) to service_role;

-- -----------------------------------------------------------------------------
-- 6) Queryable operations health for platform monitoring and deployment checks.
-- -----------------------------------------------------------------------------
create or replace view public.gridex_ops_hardening_health_v as
select
  'customer_operation_stale'::text as check_key,
  count(*)::bigint as issue_count,
  case when count(*) = 0 then 'ok' else 'warning' end as status
from public.customer_operation_jobs
where status = 'running' and locked_at < now() - interval '15 minutes'
union all
select
  'tenant_email_delivery_uncertain',
  count(*)::bigint,
  case when count(*) = 0 then 'ok' else 'warning' end
from public.tenant_email_outbox
where status = 'delivery_uncertain'
union all
select
  'ediel_delivery_uncertain',
  count(*)::bigint,
  case when count(*) = 0 then 'ok' else 'blocking' end
from public.ediel_outbox
where status = 'delivery_uncertain'
union all
select
  'webhook_stale_processing',
  count(*)::bigint,
  case when count(*) = 0 then 'ok' else 'warning' end
from public.webhook_deliveries
where status = 'processing' and locked_at < now() - interval '15 minutes';
