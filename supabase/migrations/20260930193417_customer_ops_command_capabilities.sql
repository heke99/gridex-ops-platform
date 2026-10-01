-- Read current OPS command authority for the selected customer. UI state is
-- advisory; all write commands retain their existing locked reauthorization.
begin;

-- service_role has no broad access to auth.users/auth.sessions. This private
-- helper returns only a live-session predicate and acquires no authority locks.
create function private.gridex_customer_ops_session_live_v1(p_user_id uuid,p_session_id uuid)
returns boolean language sql volatile security definer set search_path=pg_catalog as $function$
  select exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=p_user_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and s.id=p_session_id and s.user_id=p_user_id
      and (s.not_after is null or s.not_after>clock_timestamp()));
$function$;
revoke all on function private.gridex_customer_ops_session_live_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.gridex_customer_ops_session_live_v1(uuid,uuid) to service_role;

create function public.gridex_customer_ops_command_capabilities_v1(
  p_company_id uuid,p_customer_id uuid,p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $function$
declare
  v_eligible boolean:=false;
  v_masterdata boolean:=false;
  v_customers boolean:=false;
  v_sites boolean:=false;
  v_lifecycle_open boolean:=false;
begin
  if current_user<>'service_role' then
    raise exception 'customer_ops_capabilities_service_required' using errcode='42501'; end if;
  -- An unrelated platform actor never skips the current membership predicate.
  -- The canonical permission engine is the same one used by the write commands.
  select c.status not in ('moved','terminated') and c.lifecycle_closed_at is null
    into v_lifecycle_open
    from public.customers c
    join public.companies t on t.id=c.company_id and t.is_active and t.status='active'
    where c.id=p_customer_id and c.company_id=p_company_id
      and c.status<>'archived' and c.archived_at is null
      and exists(select 1 from public.user_profiles u where u.id=p_user_id and u.user_status='active')
      and exists(select 1 from public.company_memberships m
        where m.company_id=p_company_id and m.user_id=p_user_id and m.is_active and m.status='active');
  v_eligible:=found and private.gridex_customer_ops_session_live_v1(p_user_id,p_session_id);
  if v_eligible then
    v_masterdata:=coalesce(public.gridex_actor_has_company_permission(p_user_id,p_company_id,'masterdata.write'),false);
    v_customers:=coalesce(public.gridex_actor_has_company_permission(p_user_id,p_company_id,'customers.write'),false);
    v_sites:=v_customers or coalesce(public.gridex_actor_has_company_permission(p_user_id,p_company_id,'sites.write'),false);
    -- Permission reads must not carry a session across its wall-clock expiry.
    if not private.gridex_customer_ops_session_live_v1(p_user_id,p_session_id) then
      v_masterdata:=false; v_customers:=false; v_sites:=false;
    end if;
  end if;
  return jsonb_build_object('companyId',p_company_id,'customerId',p_customer_id,
    'actorUserId',p_user_id,'sessionId',p_session_id,
    'canEditContact',v_masterdata,'canEditAddresses',v_masterdata,'canEditBilling',v_masterdata,
    'canEditLegalProfile',v_customers,'canCloseLifecycle',v_customers and coalesce(v_lifecycle_open,false),
    'canEditSites',v_sites);
end;
$function$;
revoke all on function public.gridex_customer_ops_command_capabilities_v1(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.gridex_customer_ops_command_capabilities_v1(uuid,uuid,uuid,uuid)
  to service_role;

commit;
