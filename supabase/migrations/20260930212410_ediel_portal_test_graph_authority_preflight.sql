-- Current actor and selected-company authority for legacy Ediel test graph
-- creation. A successful preflight is a point-in-time read, never a marker or
-- permission to bypass independently authorized customer commands.
begin;
set local lock_timeout='10s';

create function public.gridex_ediel_portal_test_graph_access_v1(
  p_company_id uuid, p_user_id uuid, p_session_id uuid
)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if current_user<>'service_role' then
    raise exception 'ediel_portal_test_graph_service_required' using errcode='42501';
  end if;
  if p_company_id is null or p_user_id is null or p_session_id is null then return false; end if;
  perform 1 from public.companies c where c.id=p_company_id and c.is_active and c.status='active' for share;
  if not found or not private.gridex_profile_session_active_v1(p_user_id,p_session_id) then return false; end if;
  perform 1 from public.company_memberships m where m.company_id=p_company_id and m.user_id=p_user_id
    and m.is_active and m.status='active' for share;
  if not found then return false; end if;
  perform private.gridex_profile_authority_lock_v1(p_user_id,p_company_id);
  return private.gridex_profile_session_active_v1(p_user_id,p_session_id)
    and coalesce(public.gridex_actor_has_company_permission(p_user_id,p_company_id,'masterdata.write'),false)
    and coalesce(public.gridex_actor_has_company_permission(p_user_id,p_company_id,'switching.write'),false)
    and coalesce(public.gridex_actor_has_company_permission(p_user_id,p_company_id,'communication.write'),false);
end;
$function$;
revoke all on function public.gridex_ediel_portal_test_graph_access_v1(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.gridex_ediel_portal_test_graph_access_v1(uuid,uuid,uuid) to service_role;
comment on function public.gridex_ediel_portal_test_graph_access_v1(uuid,uuid,uuid) is
  'Service-only current-session/selected-company preflight for Ediel test graph creation; does not authorize later command writes or market activation.';
commit;
