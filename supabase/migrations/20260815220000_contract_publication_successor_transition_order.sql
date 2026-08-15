-- Ensure the predecessor leaves the published state before its repaired
-- successor is finalized. The unique publication invariant remains enforced
-- throughout; any later failure rolls the whole function transaction back.

do $migration$
declare
  v_oid oid;
  v_definition text;
  v_marker text := $marker$  perform public.gridex_finalize_contract_publication_v1(
    v_new_publication_version_id,
    v_actor,
    false
  );$marker$;
  v_replacement text := $replacement$  -- Release the one-published-version slot before finalizing the successor.
  -- This remains atomic because a function error rolls the caller transaction back.
  perform set_config('gridex.version_transition', 'on', true);
  update public.contract_publication_versions
  set status = 'ended',
      valid_to = least(coalesce(valid_to, now()), now())
  where id = v_old.id;

  perform public.gridex_finalize_contract_publication_v1(
    v_new_publication_version_id,
    v_actor,
    false
  );$replacement$;
begin
  select p.oid
  into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'gridex_republish_active_public_contract_v1'
    and pg_get_function_identity_arguments(p.oid)
      = 'p_publication_version_id uuid, p_actor_user_id uuid, p_explicit_invoice_fee_sek numeric';

  if v_oid is null then
    raise exception 'gridex_republish_active_public_contract_v1_missing';
  end if;

  v_definition := pg_get_functiondef(v_oid);
  if position(v_marker in v_definition) = 0 then
    raise exception 'gridex_republish_active_public_contract_v1_transition_marker_missing';
  end if;

  execute replace(v_definition, v_marker, v_replacement);
end
$migration$;

revoke all on function public.gridex_republish_active_public_contract_v1(uuid, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.gridex_republish_active_public_contract_v1(uuid, uuid, numeric)
  to service_role;

revoke all on function public.gridex_republish_active_public_contract_v2(uuid, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.gridex_republish_active_public_contract_v2(uuid, uuid, numeric)
  to service_role;
