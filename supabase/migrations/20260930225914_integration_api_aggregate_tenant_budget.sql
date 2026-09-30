begin;
-- Platform-owned explicit ceiling, with no end-user configuration grant. The
-- default is the largest existing active client's configured request ceiling,
-- never the sum of clients. 5000 is the existing provisioning upper bound.
create table private.integration_api_tenant_budget_policies(
  company_id uuid not null references public.companies(id) on delete cascade,
  window_seconds integer not null check(window_seconds between 1 and 3600),
  request_limit integer not null check(request_limit between 1 and 5000),
  primary key(company_id,window_seconds)
);
create table private.integration_api_tenant_budget_buckets(
  company_id uuid not null references public.companies(id) on delete cascade,
  window_seconds integer not null check(window_seconds between 1 and 3600),
  window_started_at timestamptz not null,
  request_count bigint not null check(request_count between 0 and 2147483647),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(company_id,window_seconds,window_started_at)
);
create index integration_api_tenant_budget_cleanup_idx on private.integration_api_tenant_budget_buckets(window_started_at);
alter table private.integration_api_tenant_budget_policies enable row level security;
alter table private.integration_api_tenant_budget_buckets enable row level security;
revoke all on private.integration_api_tenant_budget_policies,private.integration_api_tenant_budget_buckets from public,anon,authenticated;
grant select on private.integration_api_tenant_budget_policies to service_role;
grant select,insert,update,delete on private.integration_api_tenant_budget_buckets to service_role;
create function private.gridex_tenant_budget_policy_lock_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op='INSERT' then
    -- Serialize an initially absent policy with the request's company lock.
    perform 1 from public.companies where id=new.company_id for update;
  elsif new.company_id is distinct from old.company_id or new.window_seconds is distinct from old.window_seconds then
    raise exception 'tenant_budget_policy_scope_immutable' using errcode='55000';
  end if;
  return new;
end;
$$;
revoke all on function private.gridex_tenant_budget_policy_lock_v1() from public,anon,authenticated;
create trigger integration_api_tenant_budget_policy_lock before insert or update on private.integration_api_tenant_budget_policies
  for each row execute function private.gridex_tenant_budget_policy_lock_v1();

create or replace function public.integration_api_rate_limit_check(
  p_api_client_id uuid,p_route text,p_limit integer,p_window_seconds integer default 60
) returns table(allowed boolean,request_count integer,limit_value integer,reset_at timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_window integer:=greatest(1,least(coalesce(p_window_seconds,60),3600));
  v_limit integer:=least(coalesce(p_limit,0),5000);v_route text:=nullif(btrim(coalesce(p_route,'')),'');
  v_client public.integration_api_clients%rowtype;v_company public.companies%rowtype;
  v_configured integer;v_tenant_limit integer;v_final_default integer;
  v_row record;v_start timestamptz;v_count integer;v_tenant_count bigint;v_now timestamptz;
begin
  if p_api_client_id is null or v_route is null or v_limit<=0 then
    raise exception 'invalid_api_rate_limit_arguments' using errcode='22023'; end if;
  select * into v_client from public.integration_api_clients c where c.id=p_api_client_id
    and c.status='active' and c.deleted_at is null and c.revoked_at is null
    and (c.expires_at is null or c.expires_at>clock_timestamp()) for share;
  if not found then raise exception 'active_api_client_unavailable' using errcode='42501'; end if;
  select * into v_company from public.companies c where c.id=v_client.company_id and c.status='active' and c.is_active for share;
  if not found then raise exception 'active_api_company_unavailable' using errcode='42501'; end if;
  select p.request_limit into v_configured from private.integration_api_tenant_budget_policies p
    where p.company_id=v_client.company_id and p.window_seconds=v_window for share;
  -- Stable current configured client ceilings and revocation state; never use
  -- a caller-supplied tenant identity or a client-count multiplier.
  for v_row in select c.id,c.rate_limit_per_minute from public.integration_api_clients c
    where c.company_id=v_client.company_id and c.status='active' and c.deleted_at is null and c.revoked_at is null
      and (c.expires_at is null or c.expires_at>clock_timestamp()) order by c.id for share
  loop
    v_tenant_limit:=greatest(coalesce(v_tenant_limit,0),coalesce(v_row.rate_limit_per_minute,0));
  end loop;
  v_tenant_limit:=least(coalesce(v_configured,v_tenant_limit,0),5000);
  if v_tenant_limit<=0 then raise exception 'tenant_api_budget_unavailable' using errcode='42501'; end if;
  v_now:=clock_timestamp();
  v_start:=to_timestamp(floor(extract(epoch from v_now)/v_window)*v_window);
  insert into private.integration_api_tenant_budget_buckets(company_id,window_seconds,window_started_at,request_count,updated_at)
    values(v_client.company_id,v_window,v_start,1,v_now)
    on conflict(company_id,window_seconds,window_started_at) do update set
      request_count=least(integration_api_tenant_budget_buckets.request_count+1,2147483647),updated_at=clock_timestamp()
    returning integration_api_tenant_budget_buckets.request_count into v_tenant_count;
  insert into public.integration_api_rate_limit_buckets(api_client_id,company_id,route,window_started_at,request_count,updated_at)
    values(p_api_client_id,v_client.company_id,left(v_route,300),v_start,1,clock_timestamp())
    on conflict(api_client_id,route,window_started_at) do update set
      request_count=least(integration_api_rate_limit_buckets.request_count::bigint+1,2147483647)::integer,
      company_id=excluded.company_id,updated_at=clock_timestamp()
    returning integration_api_rate_limit_buckets.request_count into v_count;
  if v_count=1 then
    with expired as(select b.ctid from public.integration_api_rate_limit_buckets b
      where b.window_started_at<clock_timestamp()-interval '2 hours' order by b.window_started_at limit 100 for update skip locked)
    delete from public.integration_api_rate_limit_buckets b using expired where b.ctid=expired.ctid;
  end if;
  if v_tenant_count=1 then
    with expired as(select b.ctid from private.integration_api_tenant_budget_buckets b
      where b.window_started_at<clock_timestamp()-interval '2 hours' order by b.window_started_at limit 100 for update skip locked)
    delete from private.integration_api_tenant_budget_buckets b using expired where b.ctid=expired.ctid;
  end if;
  -- The atomic bucket can wait on another request. Wall-clock expiry must not
  -- turn that wait into authority or a larger default budget.
  if v_client.expires_at is not null and v_client.expires_at<=clock_timestamp() then
    raise exception 'active_api_client_unavailable' using errcode='42501'; end if;
  if v_configured is null then
    select max(c.rate_limit_per_minute) into v_final_default from public.integration_api_clients c
      where c.company_id=v_client.company_id and c.status='active' and c.deleted_at is null and c.revoked_at is null
        and (c.expires_at is null or c.expires_at>clock_timestamp());
    v_tenant_limit:=least(v_tenant_limit,coalesce(v_final_default,0));
  end if;
  return query select v_count<=v_limit and v_tenant_count<=v_tenant_limit,
    case when v_tenant_limit-v_tenant_count<v_limit-v_count then v_tenant_count::integer else v_count end,
    case when v_tenant_limit-v_tenant_count<v_limit-v_count then v_tenant_limit else v_limit end,
    v_start+make_interval(secs=>v_window);
end;
$$;
revoke all on function public.integration_api_rate_limit_check(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.integration_api_rate_limit_check(uuid,text,integer,integer) to service_role;
comment on function public.integration_api_rate_limit_check(uuid,text,integer,integer) is
  'Consumes existing client/route allowance and a global tenant/window request budget. Explicit private ceiling else largest current active configured client ceiling, bounded5000. No user/IP budget or production performance claim.';
commit;
