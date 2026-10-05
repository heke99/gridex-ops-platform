-- The unchecked transition creates canonical_command_results with a compact
-- request payload. The authorized wrapper then expands it to the full canonical
-- request. Update request_payload and request_hash together so the request-hash
-- guard remains valid and later idempotent replays compare the full request.

create or replace function public.canonical_transition_ediel_production(
  p_company_id uuid,
  p_target_state text,
  p_expected_state_version bigint,
  p_configuration_snapshot_id uuid,
  p_readiness_check_id uuid,
  p_dry_run_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_permission text := case when p_target_state = 'paused' then 'ediel.production.pause' else 'ediel.production.activate' end;
  v_request jsonb := jsonb_build_object(
    'target_state', p_target_state, 'expected_state_version', p_expected_state_version,
    'configuration_snapshot_id', p_configuration_snapshot_id,
    'readiness_check_id', p_readiness_check_id, 'dry_run_id', p_dry_run_id,
    'reason', p_reason
  );
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_readiness jsonb;
  v_result jsonb;
begin
  if not public.canonical_actor_is_authorized(p_company_id, p_actor_user_id, v_permission, false) then
    raise exception 'actor_not_authorized_for_ediel_production_transition';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_company_id::text || ':ediel.production.transition:' || p_idempotency_key, 0)
  );
  v_hash := public.canonical_json_sha256(v_request);

  select * into v_existing
  from public.canonical_command_results
  where company_id = p_company_id
    and command_type = 'ediel.production.transition'
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;

  if p_target_state in ('prepared', 'live') then
    v_readiness := public.canonical_company_readiness(
      p_company_id,
      p_configuration_snapshot_id,
      p_readiness_check_id,
      p_dry_run_id,
      p_target_state
    );
    if coalesce((v_readiness->>'ready')::boolean, false) is not true then
      raise exception 'canonical_readiness_blocked:%', v_readiness->'blockers';
    end if;
  end if;

  v_result := public.canonical_transition_ediel_production_v1_unchecked(
    p_company_id,
    p_target_state,
    p_expected_state_version,
    p_configuration_snapshot_id,
    p_readiness_check_id,
    p_dry_run_id,
    p_reason,
    p_actor_user_id,
    p_idempotency_key
  );

  update public.canonical_command_results
  set request_payload = v_request,
      request_hash = v_hash
  where company_id = p_company_id
    and command_type = 'ediel.production.transition'
    and idempotency_key = p_idempotency_key;

  return v_result;
end;
$$;
