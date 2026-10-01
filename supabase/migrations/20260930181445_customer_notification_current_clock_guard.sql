-- Forward correction of expiry after a delegation/resource/claim lock wait.
-- The qualified notification migration and engine body remain byte-exact.
-- CLI unavailable locally; the filename was captured from actual UTC.
begin;
set local lock_timeout='10s';

alter function public.gridex_mark_customer_notifications_read_v1(jsonb) set schema private;
alter function private.gridex_mark_customer_notifications_read_v1(jsonb) rename to gridex_apply_customer_notifications_read_v1;
revoke all on function private.gridex_apply_customer_notifications_read_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.gridex_apply_customer_notifications_read_v1(jsonb) to service_role;

create function public.gridex_mark_customer_notifications_read_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare v_result jsonb;
begin
  if current_user<>'service_role' then
    raise exception 'notification_service_required' using errcode='42501';
  end if;
  -- The unchanged engine validates input, acquires current authority locks,
  -- resolves indexed references and preserves exact compact hashes/results.
  v_result:=private.gridex_apply_customer_notifications_read_v1(p_command);
  -- All engine locks remain held here. A final wall-clock check covers owner,
  -- identity, existing-claim, notification and unique-index conflict waits.
  -- Failure also rolls back fresh read timestamps, claim completion and audit
  -- inside this same command transaction; no expired replay can be returned.
  perform 1 from public.integration_api_clients c
    where c.id=(p_command->>'clientId')::uuid and c.company_id=(p_command->>'companyId')::uuid
      and c.status='active' and c.revoked_at is null and c.deleted_at is null
      and (c.expires_at is null or c.expires_at>clock_timestamp())
      and c.scopes && array['customer_notifications.write','customer_portal.write','*']::text[];
  if not found then
    raise exception 'notification_delegation_forbidden' using errcode='42501';
  end if;
  return v_result;
end;
$function$;
revoke all on function public.gridex_mark_customer_notifications_read_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_mark_customer_notifications_read_v1(jsonb) to service_role;
commit;
