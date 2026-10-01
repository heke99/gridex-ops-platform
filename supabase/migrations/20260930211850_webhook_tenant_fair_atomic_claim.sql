-- A durable least-recently-served turn prevents a tenant's old backlog from
-- occupying every batch. The per-tenant cap also bounds a single tenant's
-- timeout cost. This is an internal queue claim, never customer authority.
create table private.webhook_dispatch_tenant_turns (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_claimed_at timestamptz not null
);
alter table private.webhook_dispatch_tenant_turns enable row level security;
revoke all on private.webhook_dispatch_tenant_turns from public, anon, authenticated;
grant select, insert, update on private.webhook_dispatch_tenant_turns to service_role;

create index webhook_deliveries_due_tenant_claim_idx
  on public.webhook_deliveries(company_id, next_attempt_at, id)
  where status in ('queued','failed');

create function public.gridex_claim_webhook_deliveries_fair_v1(p_limit integer, p_claim_token text)
returns setof public.webhook_deliveries
language plpgsql security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if current_user <> 'service_role' then
    raise exception using errcode='42501', message='webhook_claim_service_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_claim_token is null
     or p_claim_token !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception using errcode='22023', message='invalid_webhook_claim';
  end if;

  return query
  with due_tenants as materialized (
    select d.company_id, min(d.next_attempt_at) as oldest_due
    from public.webhook_deliveries d
    where d.status in ('queued','failed') and d.next_attempt_at <= v_now
      and d.attempts < d.max_attempts
    group by d.company_id
  ), tenant_turns as materialized (
    select t.company_id, t.oldest_due, s.last_claimed_at
    from due_tenants t left join private.webhook_dispatch_tenant_turns s using(company_id)
    order by s.last_claimed_at nulls first, t.oldest_due, t.company_id
    limit p_limit
  ), candidates as materialized (
    select d.id, t.company_id, t.last_claimed_at, t.oldest_due, d.next_attempt_at,
      row_number() over(partition by t.company_id order by d.next_attempt_at,d.id) as tenant_rank
    from tenant_turns t cross join lateral (
      select w.id,w.next_attempt_at from public.webhook_deliveries w
      where w.company_id=t.company_id and w.status in ('queued','failed')
        and w.next_attempt_at<=v_now and w.attempts<w.max_attempts
      order by w.next_attempt_at,w.id
      limit least(p_limit,5)
      for update of w skip locked
    ) d
  ), chosen as materialized (
    select c.* from candidates c
    order by c.tenant_rank,c.last_claimed_at nulls first,c.oldest_due,c.company_id,c.id
    limit p_limit
  ), claimed as (
    update public.webhook_deliveries w set status='processing',locked_at=v_now,
      locked_by=p_claim_token,updated_at=v_now
    from chosen c where w.id=c.id and w.status in ('queued','failed')
      and w.next_attempt_at<=v_now and w.attempts<w.max_attempts
    returning w.*
  ), turns as (
    insert into private.webhook_dispatch_tenant_turns(company_id,last_claimed_at)
    select distinct c.company_id,v_now from claimed c
    on conflict(company_id) do update
      set last_claimed_at=greatest(webhook_dispatch_tenant_turns.last_claimed_at,excluded.last_claimed_at)
    returning company_id
  )
  select c.* from claimed c join chosen selected using(id)
  cross join (select count(*) from turns) persisted_turn
  order by selected.tenant_rank,selected.last_claimed_at nulls first,
    selected.oldest_due,selected.company_id,selected.id;
end;
$$;
revoke all on function public.gridex_claim_webhook_deliveries_fair_v1(integer,text) from public, anon, authenticated;
grant execute on function public.gridex_claim_webhook_deliveries_fair_v1(integer,text) to service_role;
comment on function public.gridex_claim_webhook_deliveries_fair_v1(integer,text) is
  'Service-only atomic SKIP LOCKED webhook claim. Least-recently-claimed tenant turns, one row per turn before extras, max 5 per tenant and 100 total. No tenant authorization or delivery decision is implied.';
