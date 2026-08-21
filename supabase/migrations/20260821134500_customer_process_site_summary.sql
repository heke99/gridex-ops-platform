alter table public.customers
  add column if not exists active_sites integer not null default 0,
  add column if not exists pending_sites integer not null default 0,
  add column if not exists blocked_sites integer not null default 0,
  add column if not exists latest_customer_action text,
  add column if not exists process_summary jsonb not null default '{}'::jsonb;

create index if not exists customer_sites_process_summary_idx
on public.customer_sites(company_id, customer_id, onboarding_status, updated_at desc);

create or replace function public.gridex_refresh_customer_process_summary(
  p_company_id uuid,
  p_customer_id uuid,
  p_latest_action text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_active integer;
  v_pending integer;
  v_blocked integer;
  v_total integer;
  v_summary jsonb;
begin
  select
    count(*) filter (where coalesce(onboarding_status,'') in ('active_supply','active')),
    count(*) filter (where coalesce(onboarding_status,'') not in ('active_supply','active','needs_admin_review','blocked')),
    count(*) filter (where coalesce(onboarding_status,'') in ('needs_admin_review','blocked')),
    count(*)
  into v_active,v_pending,v_blocked,v_total
  from public.customer_sites
  where company_id=p_company_id and customer_id=p_customer_id and coalesce(is_active,true)=true;

  v_summary := jsonb_build_object(
    'total_sites', v_total,
    'active_sites', v_active,
    'pending_sites', v_pending,
    'blocked_sites', v_blocked,
    'refreshed_at', now()
  );

  update public.customers
  set active_sites=v_active,
      pending_sites=v_pending,
      blocked_sites=v_blocked,
      latest_customer_action=coalesce(p_latest_action,latest_customer_action),
      process_summary=v_summary,
      intake_status=case
        when v_total=0 then 'needs_admin_review'
        when v_blocked>0 then 'partially_blocked'
        when v_pending>0 then 'in_progress'
        when v_active=v_total then 'active_supply'
        else 'in_progress'
      end,
      next_action=case
        when v_blocked>0 then 'review_blocker'
        when v_pending>0 then 'continue_site_processes'
        else 'none'
      end,
      updated_at=now()
  where id=p_customer_id and company_id=p_company_id;

  return v_summary;
end;
$$;

revoke all on function public.gridex_refresh_customer_process_summary(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gridex_refresh_customer_process_summary(uuid,uuid,text) to service_role;

do $$
declare r record;
begin
  for r in select id,company_id from public.customers where company_id is not null loop
    perform public.gridex_refresh_customer_process_summary(r.company_id,r.id,null);
  end loop;
end $$;