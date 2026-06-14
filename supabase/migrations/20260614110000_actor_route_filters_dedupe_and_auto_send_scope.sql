-- Batch: Actor route filters, safe XML upsert support and auto-send scope guard
-- Purpose: avoid false route duplicates, keep GAS/other message families out of electricity auto-send, and expose safe duplicate diagnostics.

create index if not exists platform_actor_routes_identity_lookup_idx
  on public.platform_actor_routes(
    actor_id,
    message_family,
    environment,
    communication_type,
    communication_address,
    party_id,
    interchange_party_id,
    subaddress,
    application_reference
  );

create or replace view public.platform_actor_route_duplicates_v
with (security_invoker = true)
as
select
  actor_id,
  message_family,
  coalesce(application_reference, '') as application_reference,
  environment,
  coalesce(subaddress, '') as subaddress,
  communication_type,
  lower(coalesce(communication_address, '')) as communication_address,
  coalesce(party_id, '') as party_id,
  coalesce(interchange_party_id, '') as interchange_party_id,
  coalesce(valid_from::text, '') as valid_from,
  coalesce(valid_to::text, '') as valid_to,
  count(*) as route_count,
  (array_agg(id order by
    case when status = 'active' and is_verified = true and auto_send_allowed = true then 0
         when status = 'active' and is_verified = true then 1
         when status = 'active' then 2
         else 3 end,
    updated_at desc nulls last,
    created_at asc
  ))[1] as canonical_route_id,
  array_remove(array_agg(id order by created_at asc), (array_agg(id order by
    case when status = 'active' and is_verified = true and auto_send_allowed = true then 0
         when status = 'active' and is_verified = true then 1
         when status = 'active' then 2
         else 3 end,
    updated_at desc nulls last,
    created_at asc
  ))[1]) as duplicate_route_ids,
  bool_and(coalesce(auto_send_allowed, false) = false) as safe_to_block_duplicates
from public.platform_actor_routes
where status <> 'blocked'
group by
  actor_id,
  message_family,
  coalesce(application_reference, ''),
  environment,
  coalesce(subaddress, ''),
  communication_type,
  lower(coalesce(communication_address, '')),
  coalesce(party_id, ''),
  coalesce(interchange_party_id, ''),
  coalesce(valid_from::text, ''),
  coalesce(valid_to::text, '')
having count(*) > 1;

comment on view public.platform_actor_route_duplicates_v is
  'Detects true route duplicates using subaddress and application_reference. Routes with GAS/SCH/TRA/PLAN are not treated as duplicates unless the full route identity matches.';

create or replace function public.gridex_apply_actor_auto_send_readiness(p_existing_run_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_enabled int := 0;
  v_disabled int := 0;
begin
  if p_existing_run_id is null then
    insert into public.platform_actor_readiness_runs(run_type, status, metadata)
    values ('auto_send_apply', 'running', jsonb_build_object('source', 'gridex_apply_actor_auto_send_readiness', 'scope', 'electricity_prodat_utilts_no_gas'))
    returning id into v_run_id;
  else
    v_run_id := p_existing_run_id;
  end if;

  update public.platform_actor_routes r
  set auto_send_allowed = true,
      metadata = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'auto_send_enabled_at', now(),
        'auto_send_enabled_by', 'system',
        'auto_send_enabled_reason', 'all_readiness_checks_passed',
        'readiness_run_id', v_run_id,
        'certificate_fingerprint', v.certificate_fingerprint_sha256,
        'auto_send_scope', 'electricity_prodat_utilts_no_gas'
      ),
      updated_at = now()
  from public.platform_actor_send_readiness_v v
  where v.route_id = r.id
    and v.readiness_status = 'ready_for_auto_send'
    and upper(coalesce(v.message_family, '')) in ('PRODAT','UTILTS')
    and upper(coalesce(v.subaddress, '')) <> 'GAS'
    and coalesce(r.auto_send_allowed, false) = false;

  get diagnostics v_enabled = row_count;

  update public.platform_actor_routes r
  set auto_send_allowed = false,
      metadata = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'auto_send_disabled_at', now(),
        'auto_send_disabled_by', 'system',
        'auto_send_disabled_reason', case
          when upper(coalesce(v.message_family, '')) not in ('PRODAT','UTILTS') then 'message_family_out_of_electricity_auto_send_scope'
          when upper(coalesce(v.subaddress, '')) = 'GAS' then 'gas_route_out_of_electricity_auto_send_scope'
          else 'readiness_not_green'
        end,
        'readiness_run_id', v_run_id,
        'blocking_reasons', v.blocking_reasons,
        'warnings', v.warnings
      ),
      updated_at = now()
  from public.platform_actor_send_readiness_v v
  where v.route_id = r.id
    and coalesce(r.auto_send_allowed, false) = true
    and (
      v.readiness_status <> 'ready_for_auto_send'
      or upper(coalesce(v.message_family, '')) not in ('PRODAT','UTILTS')
      or upper(coalesce(v.subaddress, '')) = 'GAS'
    );

  get diagnostics v_disabled = row_count;

  insert into public.platform_actor_readiness_checks(run_id, actor_id, route_id, certificate_id, check_type, status, blocking_reasons, warnings, metadata, checked_at, next_check_at)
  select v_run_id, v.actor_id, v.route_id, v.certificate_id, 'auto_send',
         case when v.readiness_status = 'ready_for_auto_send'
                and upper(coalesce(v.message_family, '')) in ('PRODAT','UTILTS')
                and upper(coalesce(v.subaddress, '')) <> 'GAS' then 'passed'
              when cardinality(v.blocking_reasons) > 0 then 'blocking'
              when cardinality(v.warnings) > 0 then 'warning'
              else 'unknown' end,
         case
           when upper(coalesce(v.message_family, '')) not in ('PRODAT','UTILTS') then array_append(v.blocking_reasons, 'message_family_out_of_electricity_auto_send_scope')
           when upper(coalesce(v.subaddress, '')) = 'GAS' then array_append(v.blocking_reasons, 'gas_route_out_of_electricity_auto_send_scope')
           else v.blocking_reasons
         end,
         v.warnings,
         jsonb_build_object('readiness_status', v.readiness_status, 'message_family', v.message_family, 'environment', v.environment, 'subaddress', v.subaddress, 'auto_send_scope', 'electricity_prodat_utilts_no_gas'),
         now(), v.next_check_at
  from public.platform_actor_send_readiness_v v;

  if p_existing_run_id is null then
    update public.platform_actor_readiness_runs
    set status = 'completed', finished_at = now(), auto_enabled_count = v_enabled, auto_disabled_count = v_disabled,
        metadata = metadata || jsonb_build_object('auto_enabled_count', v_enabled, 'auto_disabled_count', v_disabled, 'auto_send_scope', 'electricity_prodat_utilts_no_gas')
    where id = v_run_id;
  else
    update public.platform_actor_readiness_runs
    set auto_enabled_count = auto_enabled_count + v_enabled,
        auto_disabled_count = auto_disabled_count + v_disabled,
        metadata = metadata || jsonb_build_object('auto_enabled_count', v_enabled, 'auto_disabled_count', v_disabled, 'auto_send_scope', 'electricity_prodat_utilts_no_gas')
    where id = v_run_id;
  end if;

  return jsonb_build_object('ok', true, 'run_id', v_run_id, 'auto_enabled_count', v_enabled, 'auto_disabled_count', v_disabled, 'auto_send_scope', 'electricity_prodat_utilts_no_gas');
exception when others then
  if v_run_id is not null then
    update public.platform_actor_readiness_runs
    set status = 'failed', finished_at = now(), failed_count = 1, metadata = metadata || jsonb_build_object('error', sqlerrm)
    where id = v_run_id;
  end if;
  raise;
end;
$$;
