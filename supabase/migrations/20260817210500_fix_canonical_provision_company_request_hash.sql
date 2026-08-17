-- Production certification repair: canonical tenant provisioning request hash.
--
-- canonical_provision_company_v1_unchecked persists request_payload using the
-- internally enriched command (actor_user_id + generated company_id). The v3
-- wrapper then normalizes request_payload to the caller-visible request but
-- previously left canonical_command_results.request_hash bound to the old
-- payload. canonical_command_request_hash_guard correctly rejected that update
-- with canonical_request_hash_mismatch.
--
-- Bind normalized request_payload and request_hash atomically, preserving the
-- tamper-evident idempotency guard. This mirrors the lifecycle hash repair from
-- 20260814205829.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';

alter table public.companies
  add column if not exists industry text not null
  default 'electricity_supplier';

create or replace function public.canonical_provision_company_v3_pre_invitation_intent(
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id', '')::uuid;
  v_idempotency_key text := p_command->>'idempotency_key';
  v_request jsonb := p_command - 'actor_user_id';
  v_hash text;
  v_existing public.canonical_provisioning_requests%rowtype;
  v_command jsonb := p_command;
  v_result jsonb;
  v_company_id uuid;
begin
  if not public.canonical_actor_is_platform_admin(v_actor_user_id) then
    raise exception 'actor_not_authorized_for_tenant_provisioning';
  end if;

  if nullif(btrim(v_idempotency_key), '') is null then
    raise exception 'idempotency_key_required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('tenant.provision:' || v_idempotency_key, 0)
  );

  v_hash := public.canonical_json_sha256(v_request);

  select *
  into v_existing
  from public.canonical_provisioning_requests
  where idempotency_key = v_idempotency_key;

  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception 'idempotency_key_payload_mismatch';
    end if;
    if v_existing.result_payload is null then
      raise exception 'tenant_provisioning_request_in_progress';
    end if;
    return v_existing.result_payload;
  end if;

  if nullif(v_command->>'company_id', '') is null then
    v_command := v_command || jsonb_build_object('company_id', gen_random_uuid());
  end if;

  v_result := public.canonical_provision_company_v1_unchecked(v_command);
  v_company_id := (v_result->>'company_id')::uuid;

  update public.companies
  set customer_number_prefix = nullif(upper(v_command->>'customer_number_prefix'), ''),
      updated_at = now()
  where id = v_company_id;

  update public.canonical_provisioning_requests
  set request_payload = v_request,
      request_hash = v_hash
  where idempotency_key = v_idempotency_key;

  update public.canonical_command_results
  set request_payload = v_request,
      request_hash = v_hash
  where company_id = v_company_id
    and command_type = 'tenant.provision'
    and idempotency_key = v_idempotency_key;

  return v_result;
end;
$function$;

comment on function public.canonical_provision_company_v3_pre_invitation_intent(jsonb)
is 'Canonical tenant provisioning wrapper with platform authorization and request-bound idempotency; binds normalized request payload and hash atomically.';

revoke all on function public.canonical_provision_company_v3_pre_invitation_intent(jsonb)
  from public, anon, authenticated, service_role;

commit;
