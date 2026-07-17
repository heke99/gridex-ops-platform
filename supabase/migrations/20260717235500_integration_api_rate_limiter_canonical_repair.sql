-- Gridex OPS: canonical repair for the integration API rate limiter.
--
-- 20260712100000 created integration_api_rate_limit_buckets with the legacy
-- columns company_id/bucket_start. 20260713150000 later used CREATE TABLE IF
-- NOT EXISTS for a different route-aware shape. PostgreSQL therefore kept the
-- legacy table while the newer RPC referenced route/window_started_at. PL/pgSQL
-- resolves those table columns at runtime, so every authenticated request could
-- fail inside the limiter and be surfaced incorrectly as HTTP 429.
--
-- Rate-limit buckets are ephemeral counters, not business history. Rebuilding
-- this table is therefore safer than carrying two incompatible schemas forward.

begin;

create extension if not exists pgcrypto with schema extensions;

-- Remove both historical function variants before replacing the ephemeral table.
drop function if exists public.integration_api_rate_limit_check(uuid, text, integer, integer);
drop function if exists public.gridex_consume_api_rate_limit(uuid, uuid, integer);

drop table if exists public.integration_api_rate_limit_buckets;

create table public.integration_api_rate_limit_buckets (
  api_client_id uuid not null references public.integration_api_clients(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  route text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (api_client_id, route, window_started_at)
);

create index integration_api_rate_limit_buckets_cleanup_idx
  on public.integration_api_rate_limit_buckets(window_started_at);

create index integration_api_rate_limit_buckets_company_idx
  on public.integration_api_rate_limit_buckets(company_id, window_started_at desc);

alter table public.integration_api_rate_limit_buckets enable row level security;
revoke all on table public.integration_api_rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_api_rate_limit_buckets to service_role;

create or replace function public.integration_api_rate_limit_check(
  p_api_client_id uuid,
  p_route text,
  p_limit integer,
  p_window_seconds integer default 60
)
returns table (
  allowed boolean,
  request_count integer,
  limit_value integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_seconds integer := greatest(1, least(coalesce(p_window_seconds, 60), 3600));
  v_limit integer := coalesce(p_limit, 0);
  v_route text := nullif(btrim(coalesce(p_route, '')), '');
  v_window_start timestamptz;
  v_company_id uuid;
  v_count integer;
begin
  if p_api_client_id is null or v_route is null then
    raise exception 'api_client_id and route are required' using errcode = '22023';
  end if;

  if v_limit <= 0 then
    raise exception 'rate limit must be greater than zero' using errcode = '22023';
  end if;

  select c.company_id
  into v_company_id
  from public.integration_api_clients c
  where c.id = p_api_client_id
    and c.status = 'active';

  if v_company_id is null then
    raise exception 'active API client not found' using errcode = '42501';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds
  );

  insert into public.integration_api_rate_limit_buckets (
    api_client_id,
    company_id,
    route,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_api_client_id,
    v_company_id,
    left(v_route, 300),
    v_window_start,
    1,
    clock_timestamp()
  )
  on conflict (api_client_id, route, window_started_at)
  do update set
    request_count = public.integration_api_rate_limit_buckets.request_count + 1,
    company_id = excluded.company_id,
    updated_at = clock_timestamp()
  returning integration_api_rate_limit_buckets.request_count into v_count;

  -- Cleanup once per newly opened bucket rather than on every request.
  if v_count = 1 then
    delete from public.integration_api_rate_limit_buckets
    where window_started_at < clock_timestamp() - interval '2 hours';
  end if;

  return query select
    v_count <= v_limit,
    v_count,
    v_limit,
    v_window_start + make_interval(secs => v_window_seconds);
end;
$$;

revoke all on function public.integration_api_rate_limit_check(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.integration_api_rate_limit_check(uuid, text, integer, integer)
  to service_role;

-- Keep the previous RPC name as a compatibility wrapper for any old worker.
create or replace function public.gridex_consume_api_rate_limit(
  p_api_client_id uuid,
  p_company_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actual_company_id uuid;
  v_result record;
begin
  select company_id
  into v_actual_company_id
  from public.integration_api_clients
  where id = p_api_client_id
    and status = 'active';

  if v_actual_company_id is null or v_actual_company_id is distinct from p_company_id then
    raise exception 'api_client_tenant_mismatch' using errcode = '42501';
  end if;

  select *
  into v_result
  from public.integration_api_rate_limit_check(
    p_api_client_id,
    '*legacy*',
    p_limit,
    60
  );

  return jsonb_build_object(
    'allowed', v_result.allowed,
    'request_count', v_result.request_count,
    'limit', v_result.limit_value,
    'reset_at', v_result.reset_at
  );
end;
$$;

revoke all on function public.gridex_consume_api_rate_limit(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.gridex_consume_api_rate_limit(uuid, uuid, integer)
  to service_role;

-- Historical false-positive cooldown markers are informational only, but clear
-- active values so the admin UI no longer suggests that the repaired clients
-- are still blocked.
update public.integration_api_clients
set rate_limited_until = null,
    updated_at = now()
where rate_limited_until is not null
  and rate_limited_until > now();

-- Deployment assertion: fail the migration if the effective table shape drifts.
do $$
declare
  v_missing text[];
begin
  select array_agg(required.column_name order by required.column_name)
  into v_missing
  from (
    values
      ('api_client_id'),
      ('company_id'),
      ('route'),
      ('window_started_at'),
      ('request_count'),
      ('updated_at')
  ) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'integration_api_rate_limit_buckets'
      and c.column_name = required.column_name
  );

  if coalesce(cardinality(v_missing), 0) > 0 then
    raise exception 'canonical rate-limit bucket columns missing: %', v_missing;
  end if;

  if to_regprocedure('public.integration_api_rate_limit_check(uuid,text,integer,integer)') is null then
    raise exception 'canonical integration_api_rate_limit_check RPC is missing';
  end if;
end;
$$;

comment on table public.integration_api_rate_limit_buckets is
  'Ephemeral per-client, per-route fixed-window counters. Canonical shape repaired by 20260717235500.';
comment on function public.integration_api_rate_limit_check(uuid, text, integer, integer) is
  'Atomically consumes one request from a tenant-scoped API-client route bucket and returns limit/reset metadata.';

commit;
