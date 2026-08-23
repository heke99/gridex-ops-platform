-- Forward-fix for the customer process summary introduced by
-- 20260821134500_customer_process_site_summary.sql.
--
-- customers.intake_status is constrained to the canonical intake vocabulary.
-- The legacy summary projection wrote `in_progress` / `partially_blocked`, which
-- caused customer/site onboarding to abort with customers_intake_status_check.

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
  where company_id=p_company_id
    and customer_id=p_customer_id
    and coalesce(is_active,true)=true;

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
        when v_blocked>0 then 'blocked'
        when v_pending>0 then 'pending_information'
        when v_active=v_total then 'active_supply'
        else 'pending_information'
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

revoke all on function public.gridex_refresh_customer_process_summary(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_refresh_customer_process_summary(uuid,uuid,text)
  to service_role;
