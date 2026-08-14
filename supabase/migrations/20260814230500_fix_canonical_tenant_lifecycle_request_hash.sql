-- Production verification repair: canonical tenant lifecycle request hash.
--
-- canonical_transition_tenant_lifecycle_v1_unchecked persists the initial command
-- result before the security-convergence wrapper enriches request_payload with
-- expected_state_version. The request-hash trigger correctly rejects changing
-- request_payload while retaining the old hash. Bind the enriched payload and
-- its canonical hash atomically so pause/suspend/archive transitions remain
-- tamper-evident and idempotent instead of failing with
-- canonical_request_hash_mismatch.

begin;

create or replace function public.canonical_transition_tenant_lifecycle_v3_pre_offboarding(
  p_company_id uuid,
  p_target_status text,
  p_expected_state_version bigint,
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
  v_request jsonb := jsonb_build_object(
    'target_status', p_target_status,
    'expected_state_version', p_expected_state_version,
    'reason', p_reason
  );
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_result jsonb;
begin
  if not public.canonical_actor_is_authorized(
    p_company_id,
    p_actor_user_id,
    'tenant.lifecycle.transition',
    true
  ) then
    raise exception 'actor_not_authorized_for_tenant_lifecycle';
  end if;

  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'idempotency_key_required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_company_id::text || ':tenant.lifecycle.transition:' || p_idempotency_key,
      0
    )
  );

  v_hash := public.canonical_json_sha256(v_request);

  select *
  into v_existing
  from public.canonical_command_results
  where company_id = p_company_id
    and command_type = 'tenant.lifecycle.transition'
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id then
      raise exception 'idempotency_actor_mismatch';
    end if;
    if v_existing.request_hash <> v_hash then
      raise exception 'idempotency_key_payload_mismatch';
    end if;
    return v_existing.result_payload;
  end if;

  v_result := public.canonical_transition_tenant_lifecycle_v1_unchecked(
    p_company_id,
    p_target_status,
    p_expected_state_version,
    p_reason,
    p_actor_user_id,
    p_idempotency_key
  );

  -- request_payload and request_hash must move together. The canonical hash
  -- trigger validates this pair and will continue to reject tampering.
  update public.canonical_command_results
  set request_payload = v_request,
      request_hash = v_hash
  where company_id = p_company_id
    and command_type = 'tenant.lifecycle.transition'
    and idempotency_key = p_idempotency_key;

  return v_result;
end;
$$;

comment on function public.canonical_transition_tenant_lifecycle_v3_pre_offboarding(
  uuid, text, bigint, text, uuid, text
) is 'Canonical tenant lifecycle wrapper with actor authorization and request-bound idempotency; binds enriched request payload and hash atomically.';

commit;
