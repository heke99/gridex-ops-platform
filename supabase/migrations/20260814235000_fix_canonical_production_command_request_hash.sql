-- Variant of #147 lifecycle request-hash repair for remaining security-convergence
-- wrappers that enrich request_payload after the unchecked insert. Updating
-- payload alone leaves the old request_hash and the guard raises
-- canonical_request_hash_mismatch. Bind payload + hash atomically.

begin;

create or replace function public.canonical_transition_ediel_production(
  p_company_id uuid, p_target_state text, p_expected_state_version bigint,
  p_configuration_snapshot_id uuid, p_readiness_check_id uuid, p_dry_run_id uuid,
  p_reason text, p_actor_user_id uuid, p_idempotency_key text
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
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':ediel.production.transition:' || p_idempotency_key, 0));
  v_hash := public.canonical_json_sha256(v_request);
  select * into v_existing from public.canonical_command_results
  where company_id = p_company_id and command_type = 'ediel.production.transition'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;
  if p_target_state in ('prepared', 'live') then
    v_readiness := public.canonical_company_readiness(
      p_company_id, p_configuration_snapshot_id, p_readiness_check_id,
      p_dry_run_id, p_target_state
    );
    if coalesce((v_readiness->>'ready')::boolean, false) is not true then
      raise exception 'canonical_readiness_blocked:%', v_readiness->'blockers';
    end if;
  end if;
  v_result := public.canonical_transition_ediel_production_v1_unchecked(
    p_company_id, p_target_state, p_expected_state_version,
    p_configuration_snapshot_id, p_readiness_check_id, p_dry_run_id,
    p_reason, p_actor_user_id, p_idempotency_key
  );
  update public.canonical_command_results
  set request_payload = v_request,
      request_hash = v_hash
  where company_id = p_company_id and command_type = 'ediel.production.transition'
    and idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.canonical_approve_first_live_send(
  p_company_id uuid, p_readiness_check_id uuid, p_actor_user_id uuid, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request jsonb := jsonb_build_object('readiness_check_id', p_readiness_check_id);
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_result jsonb;
begin
  if not public.canonical_actor_is_authorized(p_company_id, p_actor_user_id, 'ediel.send', false) then
    raise exception 'actor_not_authorized_for_first_live_send';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':ediel.production.first_live_send.approve', 0));
  v_hash := public.canonical_json_sha256(v_request);
  select * into v_existing from public.canonical_command_results
  where company_id = p_company_id and command_type = 'ediel.production.first_live_send.approve'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;
  if exists (
    select 1 from public.ediel_production_state
    where company_id = p_company_id and first_live_send_approved_at is not null
  ) then raise exception 'first_live_send_already_approved'; end if;
  v_result := public.canonical_approve_first_live_send_v1_unchecked(
    p_company_id, p_readiness_check_id, p_actor_user_id, p_idempotency_key
  );
  update public.canonical_command_results
  set request_payload = v_request,
      request_hash = v_hash
  where company_id = p_company_id and command_type = 'ediel.production.first_live_send.approve'
    and idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.canonical_change_tenant_user_access(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid := nullif(p_command->>'company_id', '')::uuid;
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id', '')::uuid;
  v_idempotency_key text := p_command->>'idempotency_key';
  v_request jsonb := p_command - 'actor_user_id';
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_result jsonb;
begin
  if not public.canonical_actor_is_authorized(v_company_id, v_actor_user_id, 'tenant.user.manage', false) then
    raise exception 'actor_not_authorized_for_tenant_user_management';
  end if;
  if nullif(btrim(v_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':tenant.user_access.change:' || v_idempotency_key, 0));
  v_hash := public.canonical_json_sha256(v_request);
  select * into v_existing from public.canonical_command_results
  where company_id = v_company_id and command_type = 'tenant.user_access.change'
    and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from v_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;
  v_result := public.canonical_change_tenant_user_access_v1_unchecked(p_command);
  update public.canonical_command_results
  set request_payload = v_request,
      request_hash = v_hash
  where company_id = v_company_id and command_type = 'tenant.user_access.change'
    and idempotency_key = v_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.canonical_provision_company(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id', '')::uuid;
  v_idempotency_key text := p_command->>'idempotency_key';
  v_hash text;
  v_existing public.canonical_provisioning_requests%rowtype;
  v_command jsonb := p_command;
  v_result jsonb;
  v_company_id uuid;
begin
  if not public.canonical_actor_is_platform_admin(v_actor_user_id) then
    raise exception 'actor_not_authorized_for_tenant_provisioning';
  end if;
  if nullif(btrim(v_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('tenant.provision:' || v_idempotency_key, 0));
  v_hash := public.canonical_json_sha256(p_command - 'actor_user_id');
  select * into v_existing from public.canonical_provisioning_requests
  where idempotency_key = v_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    if v_existing.result_payload is null then raise exception 'tenant_provisioning_request_in_progress'; end if;
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
  set request_payload = p_command - 'actor_user_id', request_hash = v_hash
  where idempotency_key = v_idempotency_key;
  update public.canonical_command_results
  set request_payload = p_command - 'actor_user_id',
      request_hash = v_hash
  where company_id = v_company_id and command_type = 'tenant.provision'
    and idempotency_key = v_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.canonical_save_ediel_actor_profile(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid := nullif(p_command->>'company_id', '')::uuid;
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id', '')::uuid;
  v_idempotency_key text := p_command->>'idempotency_key';
  v_company public.companies%rowtype;
  v_actor_role text;
  v_environment text;
  v_profile public.ediel_actor_settings%rowtype;
  v_profile_count bigint;
  v_requested_profile_id uuid;
  v_defaults jsonb;
  v_command jsonb;
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_latest_snapshot public.ediel_configuration_snapshots%rowtype;
  v_result jsonb;
begin
  if not public.canonical_actor_is_authorized(v_company_id, v_actor_user_id, 'ediel.profile.write', false) then
    raise exception 'actor_not_authorized_for_ediel_profile';
  end if;
  if nullif(btrim(v_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':ediel.actor_profile.save:' || v_idempotency_key, 0));
  select * into v_company from public.companies where id = v_company_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  v_actor_role := lower(nullif(btrim(p_command->>'actor_role'), ''));
  if v_actor_role is null or v_actor_role not in (
    'supplier', 'electricity_supplier', 'grid_owner', 'energy_service_company',
    'balance_responsible_party', 'brp', 'system_supplier',
    'metering_point_operator', 'metering_data_responsible'
  ) then
    raise exception 'unsupported_actor_role:%', coalesce(v_actor_role, 'null');
  end if;

  v_defaults := jsonb_build_object(
    'company_id', v_company_id, 'company_name', v_company.name,
    'organization_number', v_company.org_number,
    'actor_role', v_actor_role,
    'ediel_id', v_company.ediel_id,
    'test_ediel_id', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.test_ediel_id end,
    'production_ediel_id', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.production_ediel_id end,
    'test_sender_sub_address', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.test_sender_sub_address end,
    'production_sender_sub_address', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.production_sender_sub_address end,
    'test_mailbox', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.test_mailbox end,
    'production_mailbox', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.production_mailbox end,
    'test_application_reference', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.test_application_reference end,
    'production_application_reference', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.production_application_reference end,
    'test_counterparty_ediel_id', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.test_counterparty_ediel_id end,
    'production_counterparty_ediel_id', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.production_counterparty_ediel_id end,
    'brp_name', v_company.brp_name, 'brp_ediel_id', v_company.brp_ediel_id,
    'brp_status', v_company.brp_status, 'esett_status', v_company.esett_status,
    'technical_contact_name', v_company.technical_contact_name,
    'technical_contact_email', v_company.technical_contact_email,
    'support_email', v_company.support_email,
    'billing_contact_email', v_company.billing_contact_email
  );

  foreach v_environment in array array['test', 'production'] loop
    select count(*) into v_profile_count from public.ediel_actor_settings
    where company_id = v_company_id and environment = v_environment and is_active = true
      and lower(coalesce(role, actor_role)) = v_actor_role;
    if v_profile_count > 1 then
      raise exception 'active_ediel_profile_identity_ambiguous:%', v_environment;
    end if;
    select a.* into v_profile
    from public.canonical_ediel_profile_identities i
    join public.ediel_actor_settings a on a.id = i.profile_id
    where i.company_id = v_company_id and i.environment = v_environment
      and i.actor_role = v_actor_role
      and a.company_id = i.company_id and a.environment = i.environment
      and lower(coalesce(a.role, a.actor_role)) = i.actor_role
      and a.is_active = true;
    if not found and v_profile_count = 1 then
      select * into v_profile from public.ediel_actor_settings
      where company_id = v_company_id and environment = v_environment and is_active = true
        and lower(coalesce(role, actor_role)) = v_actor_role;
      insert into public.canonical_ediel_profile_identities(company_id, environment, actor_role, profile_id, bound_by)
      values(v_company_id, v_environment, v_actor_role, v_profile.id, v_actor_user_id)
      on conflict (company_id, environment, actor_role) do update
      set profile_id = excluded.profile_id, bound_at = now(), bound_by = excluded.bound_by;
    end if;
    if p_command ? (v_environment || '_profile_id') then
      v_requested_profile_id := nullif(p_command->>(v_environment || '_profile_id'), '')::uuid;
      if v_profile.id is distinct from v_requested_profile_id then
        raise exception 'canonical_profile_identity_mismatch:%', v_environment;
      end if;
    end if;
    if v_profile.id is not null then
      v_defaults := v_defaults || jsonb_build_object(
        v_environment || '_profile_id', v_profile.id,
        v_environment || '_ediel_id', coalesce(v_profile.actor_ediel_id, v_profile.ediel_id),
        v_environment || '_sender_sub_address', coalesce(v_profile.sender_sub_address, v_profile.sender_subaddress),
        v_environment || '_application_reference', coalesce(v_profile.application_reference, v_profile.default_application_reference),
        v_environment || '_mailbox', v_profile.mailbox,
        'actor_role', coalesce(v_defaults->>'actor_role', v_profile.actor_role, v_profile.role),
        'brp_name', coalesce(v_defaults->>'brp_name', v_profile.brp_name),
        'brp_ediel_id', coalesce(v_defaults->>'brp_ediel_id', v_profile.brp_ediel_id),
        'brp_status', coalesce(v_defaults->>'brp_status', v_profile.brp_status),
        'esett_status', coalesce(v_defaults->>'esett_status', v_profile.esett_status),
        'smtp_from_email', v_profile.smtp_from_email
      );
    end if;
    v_profile := null;
    v_requested_profile_id := null;
  end loop;

  v_command := v_defaults || p_command;
  v_hash := public.canonical_json_sha256(v_command - 'actor_user_id');
  select * into v_existing from public.canonical_command_results
  where company_id = v_company_id and command_type = 'ediel.actor_profile.save'
    and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from v_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;

  v_result := public.canonical_save_ediel_actor_profile_v1_unchecked(v_command);
  update public.canonical_command_results
  set request_payload = v_command - 'actor_user_id',
      request_hash = v_hash
  where company_id = v_company_id and command_type = 'ediel.actor_profile.save'
    and idempotency_key = v_idempotency_key;

  foreach v_environment in array array['test', 'production'] loop
    update public.ediel_actor_settings a
    set actor_name = case when v_command ? (v_environment || '_actor_name')
          then nullif(v_command->>(v_environment || '_actor_name'), '') else a.actor_name end,
        legal_name = case when v_command ? (v_environment || '_actor_name')
          then nullif(v_command->>(v_environment || '_actor_name'), '') else a.legal_name end,
        sender_name = case when v_command ? (v_environment || '_sender_name')
          then nullif(v_command->>(v_environment || '_sender_name'), '') else a.sender_name end,
        organization_number = case when v_command ? (v_environment || '_organization_number')
          then nullif(v_command->>(v_environment || '_organization_number'), '') else a.organization_number end,
        sender_subaddress_prodat = case when v_command ? (v_environment || '_sender_subaddress_prodat')
          then nullif(v_command->>(v_environment || '_sender_subaddress_prodat'), '') else a.sender_subaddress_prodat end,
        sender_subaddress_utilts = case when v_command ? (v_environment || '_sender_subaddress_utilts')
          then nullif(v_command->>(v_environment || '_sender_subaddress_utilts'), '') else a.sender_subaddress_utilts end,
        receiver_subaddress = case when v_command ? (v_environment || '_receiver_subaddress')
          then nullif(v_command->>(v_environment || '_receiver_subaddress'), '') else a.receiver_subaddress end,
        smtp_reply_to_email = case when v_command ? (v_environment || '_smtp_reply_to_email')
          then nullif(v_command->>(v_environment || '_smtp_reply_to_email'), '') else a.smtp_reply_to_email end,
        default_transport_channel = case when v_command ? (v_environment || '_default_transport_channel')
          then nullif(v_command->>(v_environment || '_default_transport_channel'), '') else a.default_transport_channel end,
        default_timezone = case when v_command ? (v_environment || '_default_timezone')
          then (v_command->>(v_environment || '_default_timezone'))::integer else a.default_timezone end,
        default_charset = case when v_command ? (v_environment || '_default_charset')
          then nullif(upper(v_command->>(v_environment || '_default_charset')), '') else a.default_charset end,
        default_test_flag = case when v_command ? (v_environment || '_default_test_flag')
          then (v_command->>(v_environment || '_default_test_flag'))::integer else a.default_test_flag end,
        production_status = case when v_command ? (v_environment || '_production_status')
          then nullif(v_command->>(v_environment || '_production_status'), '') else a.production_status end,
        test_status = case when v_command ? (v_environment || '_test_status')
          then nullif(v_command->>(v_environment || '_test_status'), '') else a.test_status end,
        notes = case when v_command ? (v_environment || '_notes')
          then nullif(v_command->>(v_environment || '_notes'), '') else a.notes end,
        valid_from = case when v_command ? (v_environment || '_valid_from')
          then nullif(v_command->>(v_environment || '_valid_from'), '')::date else a.valid_from end,
        valid_to = case when v_command ? (v_environment || '_valid_to')
          then nullif(v_command->>(v_environment || '_valid_to'), '')::date else a.valid_to end,
        is_active = case when v_command ? (v_environment || '_is_active')
          then coalesce((v_command->>(v_environment || '_is_active'))::boolean, false) else a.is_active end,
        updated_by = v_actor_user_id,
        updated_at = now()
    from public.canonical_ediel_profile_identities i
    where i.company_id = v_company_id and i.environment = v_environment
      and i.actor_role = v_actor_role
      and i.profile_id = a.id and a.company_id = i.company_id and a.environment = i.environment;

    select count(*) into v_profile_count from public.ediel_actor_settings
    where company_id = v_company_id and environment = v_environment and is_active = true
      and lower(coalesce(role, actor_role)) = v_actor_role;
    if v_profile_count > 1 then raise exception 'active_ediel_profile_identity_ambiguous:%', v_environment; end if;
    if v_profile_count = 1 then
      select * into v_profile from public.ediel_actor_settings
      where company_id = v_company_id and environment = v_environment and is_active = true
        and lower(coalesce(role, actor_role)) = v_actor_role;
      insert into public.canonical_ediel_profile_identities(company_id, environment, actor_role, profile_id, bound_by)
      values(v_company_id, v_environment, v_actor_role, v_profile.id, v_actor_user_id)
      on conflict (company_id, environment, actor_role) do update
      set profile_id = excluded.profile_id, bound_at = now(), bound_by = excluded.bound_by;
    else
      delete from public.canonical_ediel_profile_identities
      where company_id = v_company_id and environment = v_environment
        and actor_role = v_actor_role;
    end if;
    v_profile := null;
  end loop;
  if v_command ? 'production_primary_route_id' or v_command ? 'test_primary_route_id' then
    update public.companies
    set ediel_primary_production_route_profile_id = case
          when v_command ? 'production_primary_route_id'
            then nullif(v_command->>'production_primary_route_id', '')::uuid
          else ediel_primary_production_route_profile_id end,
        ediel_primary_test_route_profile_id = case
          when v_command ? 'test_primary_route_id'
            then nullif(v_command->>'test_primary_route_id', '')::uuid
          else ediel_primary_test_route_profile_id end,
        updated_at = now()
    where id = v_company_id;
    perform public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
      v_company_id, v_actor_user_id, 'canonical_primary_route_changed'
    );
  end if;
  select * into v_latest_snapshot from public.ediel_configuration_snapshots
  where company_id = v_company_id order by snapshot_version desc limit 1;
  if found then
    v_result := v_result || jsonb_build_object(
      'configuration_snapshot_id', v_latest_snapshot.id,
      'configuration_hash', v_latest_snapshot.configuration_hash
    );
    update public.canonical_command_results set result_payload = v_result
    where company_id = v_company_id and command_type = 'ediel.actor_profile.save'
      and idempotency_key = v_idempotency_key;
  end if;
  return v_result;
end;
$$;

revoke all on function public.canonical_transition_ediel_production(uuid, text, bigint, uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.canonical_transition_ediel_production(uuid, text, bigint, uuid, uuid, uuid, text, uuid, text)
  to service_role;

revoke all on function public.canonical_approve_first_live_send(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.canonical_approve_first_live_send(uuid, uuid, uuid, text)
  to service_role;

revoke all on function public.canonical_change_tenant_user_access(jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_change_tenant_user_access(jsonb)
  to service_role;

revoke all on function public.canonical_provision_company(jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_provision_company(jsonb)
  to service_role;

revoke all on function public.canonical_save_ediel_actor_profile(jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_save_ediel_actor_profile(jsonb)
  to service_role;

commit;
