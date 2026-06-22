-- Bulk operational route materialization + null-route repair.
-- Safe/idempotent: no sends, no production approval, company-scoped, dry-run by default.

create extension if not exists pgcrypto;

drop function if exists public.gridex_materialize_company_operational_routes(uuid, text, text, boolean);

create or replace function public.gridex_materialize_company_operational_routes(
  p_company_id uuid,
  p_environment text default null,
  p_message_family text default null,
  p_dry_run boolean default true
)
returns table (
  result_status text,
  reason_code text,
  company_id uuid,
  grid_owner_id uuid,
  grid_owner_name text,
  grid_owner_ediel_id text,
  platform_actor_route_id uuid,
  message_family text,
  message_code text,
  environment text,
  communication_route_id uuid,
  ediel_route_profile_id uuid,
  company_market_party_route_id uuid,
  repaired_outbound_count integer,
  repaired_customer_info_count integer,
  details jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_platform record;
  v_sender record;
  v_route_scope text;
  v_message_code text;
  v_env text;
  v_env_type public.ediel_environment_type;
  v_target_system text;
  v_comm_route_id uuid;
  v_route_profile_id uuid;
  v_company_party_route_id uuid;
  v_receiver_ediel_id text;
  v_receiver_subaddress text;
  v_sender_ediel_id text;
  v_sender_subaddress text;
  v_application_reference text;
  v_existing_id uuid;
  v_post record;
  v_repaired_outbound_count integer;
  v_repaired_customer_info_count integer;
  v_now timestamptz;
begin
  if p_company_id is null then
    raise exception 'p_company_id is required';
  end if;

  for r in
    select *
    from public.gridex_company_route_readiness_v gr
    where gr.company_id = p_company_id
      and coalesce(gr.operational_route_ready, false) = false
      and coalesce(gr.platform_route_ready, false) = true
      and gr.blocker_code = 'platform_route_exists_but_not_materialized'
      and gr.sender_settings_id is not null
      and gr.platform_actor_route_id is not null
      and gr.grid_owner_id is not null
      and nullif(gr.grid_owner_ediel_id, '') is not null
      and gr.environment in ('test', 'production')
      and (p_environment is null or gr.environment = p_environment)
      and (p_message_family is null or gr.message_family = upper(p_message_family))
    order by gr.environment, gr.grid_owner_name, gr.message_family, gr.message_code nulls first
  loop
    v_comm_route_id := null;
    v_route_profile_id := null;
    v_company_party_route_id := null;
    v_repaired_outbound_count := 0;
    v_repaired_customer_info_count := 0;
    v_now := now();
    v_env := r.environment;
    v_message_code := nullif(r.message_code, '');
    if upper(coalesce(r.message_family, '')) = 'PRODAT' and v_message_code is null then
      v_message_code := 'Z01';
    end if;
    if upper(coalesce(r.message_family, '')) = 'UTILTS' and v_message_code = '' then
      v_message_code := null;
    end if;

    v_route_scope := case
      when upper(coalesce(r.message_family, '')) = 'PRODAT' then 'customer_masterdata'
      when upper(coalesce(r.message_family, '')) = 'UTILTS' then 'meter_values'
      else 'customer_masterdata'
    end;

    if v_env = 'production' then
      v_env_type := 'production'::public.ediel_environment_type;
      v_target_system := 'production_ediel';
    elsif v_env = 'test' then
      -- company route readiness uses "test" as its lane; communication_routes
      -- stores typed Ediel environments. AGT is the safe default for tenant tests.
      v_env_type := 'agt_test'::public.ediel_environment_type;
      v_target_system := 'ediel';
    else
      result_status := 'skipped';
      reason_code := 'environment_not_resolved';
      company_id := r.company_id;
      grid_owner_id := r.grid_owner_id;
      grid_owner_name := r.grid_owner_name;
      grid_owner_ediel_id := r.grid_owner_ediel_id;
      platform_actor_route_id := r.platform_actor_route_id;
      message_family := r.message_family;
      message_code := v_message_code;
      environment := r.environment;
      communication_route_id := null;
      ediel_route_profile_id := null;
      company_market_party_route_id := null;
      repaired_outbound_count := 0;
      repaired_customer_info_count := 0;
      details := jsonb_build_object('next_required_action', 'Välj test eller production innan materialisering.');
      return next;
      continue;
    end if;

    select * into v_platform
    from public.platform_actor_routes par
    where par.id = r.platform_actor_route_id
      and par.environment = v_env
      and par.status = 'active'
      and par.is_verified = true
    limit 1;

    if not found or nullif(coalesce(v_platform.communication_address, ''), '') is null then
      result_status := 'skipped';
      reason_code := 'platform_route_missing_or_not_verified';
      company_id := r.company_id;
      grid_owner_id := r.grid_owner_id;
      grid_owner_name := r.grid_owner_name;
      grid_owner_ediel_id := r.grid_owner_ediel_id;
      platform_actor_route_id := r.platform_actor_route_id;
      message_family := r.message_family;
      message_code := v_message_code;
      environment := r.environment;
      communication_route_id := null;
      ediel_route_profile_id := null;
      company_market_party_route_id := null;
      repaired_outbound_count := 0;
      repaired_customer_info_count := 0;
      details := jsonb_build_object('next_required_action', 'Verifiera global route och kommunikationsadress.');
      return next;
      continue;
    end if;

    select * into v_sender
    from public.ediel_actor_settings eas
    where eas.id = r.sender_settings_id
      and eas.company_id = r.company_id
      and eas.environment = v_env
      and eas.is_active = true
    limit 1;

    if not found then
      result_status := 'skipped';
      reason_code := 'sender_settings_missing';
      company_id := r.company_id;
      grid_owner_id := r.grid_owner_id;
      grid_owner_name := r.grid_owner_name;
      grid_owner_ediel_id := r.grid_owner_ediel_id;
      platform_actor_route_id := r.platform_actor_route_id;
      message_family := r.message_family;
      message_code := v_message_code;
      environment := r.environment;
      communication_route_id := null;
      ediel_route_profile_id := null;
      company_market_party_route_id := null;
      repaired_outbound_count := 0;
      repaired_customer_info_count := 0;
      details := jsonb_build_object('next_required_action', 'Lägg in aktiv Ediel-aktör för bolag och miljö.');
      return next;
      continue;
    end if;

    v_receiver_ediel_id := coalesce(nullif(v_platform.party_id, ''), nullif(v_platform.interchange_party_id, ''), nullif(r.grid_owner_ediel_id, ''));
    v_receiver_subaddress := nullif(v_platform.subaddress, '');
    v_sender_ediel_id := coalesce(nullif(v_sender.ediel_id, ''), nullif(v_sender.actor_ediel_id, ''));
    v_sender_subaddress := case
      when upper(coalesce(r.message_family, '')) = 'PRODAT'
        then coalesce(nullif(v_sender.sender_subaddress_prodat, ''), nullif(v_sender.sender_subaddress, ''))
      else coalesce(nullif(v_sender.sender_subaddress, ''))
    end;
    v_application_reference := coalesce(
      nullif(v_platform.application_reference, ''),
      nullif(v_sender.application_reference, ''),
      nullif(v_sender.default_application_reference, ''),
      case when upper(coalesce(r.message_family, '')) = 'PRODAT' then '23-DDQ-PRODAT' else upper(coalesce(r.message_family, 'PRODAT')) end
    );

    if v_sender_ediel_id is null or v_receiver_ediel_id is null then
      result_status := 'skipped';
      reason_code := 'ediel_identity_missing';
      company_id := r.company_id;
      grid_owner_id := r.grid_owner_id;
      grid_owner_name := r.grid_owner_name;
      grid_owner_ediel_id := r.grid_owner_ediel_id;
      platform_actor_route_id := r.platform_actor_route_id;
      message_family := r.message_family;
      message_code := v_message_code;
      environment := r.environment;
      communication_route_id := null;
      ediel_route_profile_id := null;
      company_market_party_route_id := null;
      repaired_outbound_count := 0;
      repaired_customer_info_count := 0;
      details := jsonb_build_object('sender_ediel_id_present', v_sender_ediel_id is not null, 'receiver_ediel_id_present', v_receiver_ediel_id is not null);
      return next;
      continue;
    end if;

    if p_dry_run then
      result_status := 'dry_run';
      reason_code := null;
      company_id := r.company_id;
      grid_owner_id := r.grid_owner_id;
      grid_owner_name := r.grid_owner_name;
      grid_owner_ediel_id := r.grid_owner_ediel_id;
      platform_actor_route_id := r.platform_actor_route_id;
      message_family := r.message_family;
      message_code := v_message_code;
      environment := r.environment;
      communication_route_id := null;
      ediel_route_profile_id := null;
      company_market_party_route_id := null;
      repaired_outbound_count := 0;
      repaired_customer_info_count := 0;
      details := jsonb_build_object(
        'communication_route', jsonb_build_object('route_type', 'ediel_partner', 'route_scope', v_route_scope, 'target_system', v_target_system, 'target_email', v_platform.communication_address, 'environment_type', v_env_type::text),
        'route_profile', jsonb_build_object('sender_ediel_id', v_sender_ediel_id, 'receiver_ediel_id', v_receiver_ediel_id, 'message_family', r.message_family, 'message_code', v_message_code),
        'company_market_party_route', jsonb_build_object('market_party_id', v_platform.actor_id, 'platform_actor_route_id', r.platform_actor_route_id)
      );
      return next;
      continue;
    end if;

    select cr.id into v_existing_id
    from public.communication_routes cr
    where cr.company_id = r.company_id
      and cr.grid_owner_id = r.grid_owner_id
      and cr.route_scope = v_route_scope
      and cr.auth_config->>'platform_actor_route_id' = r.platform_actor_route_id::text
    order by cr.updated_at desc nulls last, cr.created_at desc nulls last
    limit 1;

    if v_existing_id is null then
      insert into public.communication_routes (
        company_id, route_name, is_active, route_scope, route_type, route_group,
        grid_owner_id, target_system, endpoint, target_email, auth_config,
        supported_payload_version, supported_message_families, supported_message_codes,
        environment_type, market_party_role, counterparty_ediel_id, notes, created_at, updated_at
      ) values (
        r.company_id,
        coalesce(r.grid_owner_name, 'Nätägare') || ' ' || coalesce(r.message_family, 'PRODAT') || ' ' || v_env,
        true,
        v_route_scope,
        'ediel_partner',
        'grid_owner',
        r.grid_owner_id,
        v_target_system,
        v_platform.communication_address,
        v_platform.communication_address,
        jsonb_build_object(
          'platform_actor_route_id', r.platform_actor_route_id,
          'platform_market_actor_id', v_platform.actor_id,
          'materialized_from', 'bulk_operational_route_materialization_repair',
          'message_family', r.message_family,
          'message_code', v_message_code,
          'environment', v_env,
          'receiver_subaddress_status', v_platform.metadata->>'subaddress_status',
          'blank_subaddress_requires_review', coalesce((v_platform.metadata->>'blank_subaddress_requires_review')::boolean, false)
        ),
        r.message_family,
        jsonb_build_array(r.message_family),
        case when v_message_code is null then '[]'::jsonb else jsonb_build_array(v_message_code) end,
        v_env_type,
        'grid_owner',
        v_receiver_ediel_id,
        'Materialiserad från verifierad aktörsregister-route via bulk repair.',
        v_now,
        v_now
      ) returning id into v_comm_route_id;
    else
      update public.communication_routes
      set
        route_name = coalesce(r.grid_owner_name, 'Nätägare') || ' ' || coalesce(r.message_family, 'PRODAT') || ' ' || v_env,
        is_active = true,
        route_type = 'ediel_partner',
        route_scope = v_route_scope,
        route_group = 'grid_owner',
        target_system = v_target_system,
        endpoint = v_platform.communication_address,
        target_email = v_platform.communication_address,
        auth_config = coalesce(auth_config, '{}'::jsonb) || jsonb_build_object(
          'platform_actor_route_id', r.platform_actor_route_id,
          'platform_market_actor_id', v_platform.actor_id,
          'materialized_from', 'bulk_operational_route_materialization_repair',
          'message_family', r.message_family,
          'message_code', v_message_code,
          'environment', v_env
        ),
        supported_payload_version = r.message_family,
        supported_message_families = jsonb_build_array(r.message_family),
        supported_message_codes = case when v_message_code is null then '[]'::jsonb else jsonb_build_array(v_message_code) end,
        environment_type = v_env_type,
        market_party_role = 'grid_owner',
        counterparty_ediel_id = v_receiver_ediel_id,
        updated_at = v_now
      where id = v_existing_id
      returning id into v_comm_route_id;
    end if;

    select erp.id into v_existing_id
    from public.ediel_route_profiles erp
    where erp.company_id = r.company_id
      and erp.communication_route_id = v_comm_route_id
      and erp.environment = v_env
      and coalesce(erp.metadata->>'platform_actor_route_id', '') = r.platform_actor_route_id::text
    order by erp.updated_at desc nulls last, erp.created_at desc nulls last
    limit 1;

    if v_existing_id is null then
      insert into public.ediel_route_profiles (
        company_id, communication_route_id, environment, environment_type, route_name,
        route_type, payload_format, message_standard, ack_mode, default_test_flag,
        default_timezone, sender_ediel_id, own_ediel_id, sender_sub_address,
        sender_subaddress, own_subaddress, receiver_ediel_id, counterparty_ediel_id,
        receiver_sub_address, receiver_subaddress, counterparty_subaddress,
        receiver_name, application_reference, message_family, message_code,
        default_message_version, mailbox, encryption_mode, transport_type,
        ack_policy, is_active, is_enabled, metadata, created_at, updated_at
      ) values (
        r.company_id,
        v_comm_route_id,
        v_env,
        v_env_type,
        coalesce(r.grid_owner_name, 'Nätägare') || ' ' || coalesce(r.message_family, 'PRODAT'),
        'email',
        'edifact',
        'edifact',
        'contrl_aperak',
        case when v_env = 'production' then 0 else 1 end,
        1,
        v_sender_ediel_id,
        v_sender_ediel_id,
        v_sender_subaddress,
        v_sender_subaddress,
        v_sender_subaddress,
        v_receiver_ediel_id,
        v_receiver_ediel_id,
        v_receiver_subaddress,
        v_receiver_subaddress,
        v_receiver_subaddress,
        r.grid_owner_name,
        v_application_reference,
        r.message_family,
        v_message_code,
        case when upper(coalesce(r.message_family, '')) = 'PRODAT' then '26A' else null end,
        null,
        case when upper(coalesce(r.message_family, '')) = 'PRODAT' then 'smime' else 'none' end,
        'smtp',
        'contrl_aperak',
        true,
        true,
        jsonb_build_object(
          'platform_actor_route_id', r.platform_actor_route_id,
          'platform_market_actor_id', v_platform.actor_id,
          'sender_settings_id', r.sender_settings_id,
          'production_send_lock_status', r.production_send_lock_status,
          'materialized_from', 'bulk_operational_route_materialization_repair'
        ),
        v_now,
        v_now
      ) returning id into v_route_profile_id;
    else
      update public.ediel_route_profiles
      set
        environment_type = v_env_type,
        route_name = coalesce(r.grid_owner_name, 'Nätägare') || ' ' || coalesce(r.message_family, 'PRODAT'),
        is_active = true,
        is_enabled = true,
        sender_ediel_id = v_sender_ediel_id,
        own_ediel_id = v_sender_ediel_id,
        sender_sub_address = v_sender_subaddress,
        sender_subaddress = v_sender_subaddress,
        own_subaddress = v_sender_subaddress,
        receiver_ediel_id = v_receiver_ediel_id,
        counterparty_ediel_id = v_receiver_ediel_id,
        receiver_sub_address = v_receiver_subaddress,
        receiver_subaddress = v_receiver_subaddress,
        counterparty_subaddress = v_receiver_subaddress,
        receiver_name = r.grid_owner_name,
        application_reference = v_application_reference,
        message_family = r.message_family,
        message_code = v_message_code,
        transport_type = 'smtp',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'platform_actor_route_id', r.platform_actor_route_id,
          'platform_market_actor_id', v_platform.actor_id,
          'sender_settings_id', r.sender_settings_id,
          'production_send_lock_status', r.production_send_lock_status,
          'materialized_from', 'bulk_operational_route_materialization_repair'
        ),
        updated_at = v_now
      where id = v_existing_id
      returning id into v_route_profile_id;
    end if;

    select cmpr.id into v_existing_id
    from public.company_market_party_routes cmpr
    where cmpr.company_id = r.company_id
      and cmpr.market_party_id = v_platform.actor_id
      and cmpr.message_family = r.message_family
      and coalesce(cmpr.environment, cmpr.metadata->>'environment') = v_env
      and coalesce(nullif(cmpr.message_code, ''), nullif(cmpr.metadata->>'message_code', ''), '') = coalesce(v_message_code, '')
      and coalesce(cmpr.platform_actor_route_id::text, cmpr.metadata->>'platform_actor_route_id') = r.platform_actor_route_id::text
      and cmpr.active = true
    order by cmpr.updated_at desc nulls last, cmpr.created_at desc nulls last
    limit 1;

    if v_existing_id is null then
      insert into public.company_market_party_routes (
        company_id, market_party_id, message_family, message_code, environment,
        platform_actor_route_id, communication_route_id, route_profile_id, active,
        metadata, created_by, updated_at
      ) values (
        r.company_id,
        v_platform.actor_id,
        r.message_family,
        v_message_code,
        v_env,
        r.platform_actor_route_id,
        v_comm_route_id,
        v_route_profile_id,
        true,
        jsonb_build_object(
          'platform_actor_route_id', r.platform_actor_route_id,
          'materialized_from', 'bulk_operational_route_materialization_repair',
          'environment', v_env,
          'message_code', v_message_code,
          'communication_route_id', v_comm_route_id,
          'ediel_route_profile_id', v_route_profile_id,
          'sender_settings_id', r.sender_settings_id,
          'receiver_ediel_id', v_receiver_ediel_id,
          'receiver_subaddress', v_receiver_subaddress,
          'target_email', v_platform.communication_address,
          'production_send_lock_status', r.production_send_lock_status
        ),
        null,
        v_now
      ) returning id into v_company_party_route_id;
    else
      update public.company_market_party_routes
      set
        message_code = v_message_code,
        environment = v_env,
        platform_actor_route_id = r.platform_actor_route_id,
        communication_route_id = v_comm_route_id,
        route_profile_id = v_route_profile_id,
        active = true,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'platform_actor_route_id', r.platform_actor_route_id,
          'materialized_from', 'bulk_operational_route_materialization_repair',
          'environment', v_env,
          'message_code', v_message_code,
          'communication_route_id', v_comm_route_id,
          'ediel_route_profile_id', v_route_profile_id,
          'sender_settings_id', r.sender_settings_id,
          'receiver_ediel_id', v_receiver_ediel_id,
          'receiver_subaddress', v_receiver_subaddress,
          'target_email', v_platform.communication_address,
          'production_send_lock_status', r.production_send_lock_status
        ),
        updated_at = v_now
      where id = v_existing_id
      returning id into v_company_party_route_id;
    end if;

    select * into v_post
    from public.gridex_company_route_readiness_v gr
    where gr.company_id = r.company_id
      and gr.grid_owner_id = r.grid_owner_id
      and gr.platform_actor_route_id = r.platform_actor_route_id
      and gr.message_family = r.message_family
      and coalesce(gr.message_code, '') = coalesce(v_message_code, '')
      and gr.environment = v_env
    limit 1;

    if not found or coalesce(v_post.operational_route_ready, false) is not true or v_post.communication_route_id is null or v_post.ediel_route_profile_id is null or v_post.company_market_party_route_id is null then
      insert into public.audit_logs (company_id, entity_type, entity_id, action, metadata, created_at)
      values (
        r.company_id,
        'platform_actor_routes',
        r.platform_actor_route_id::text,
        'route_readiness.bulk_materialize_postcheck_failed',
        jsonb_build_object(
          'companyId', r.company_id,
          'gridOwnerId', r.grid_owner_id,
          'platformActorRouteId', r.platform_actor_route_id,
          'messageFamily', r.message_family,
          'messageCode', v_message_code,
          'environment', v_env,
          'communicationRouteId', v_comm_route_id,
          'edielRouteProfileId', v_route_profile_id,
          'companyMarketPartyRouteId', v_company_party_route_id,
          'postcheck', to_jsonb(v_post)
        ),
        v_now
      );

      result_status := 'blocked';
      reason_code := 'route_materialization_postcheck_failed';
      company_id := r.company_id;
      grid_owner_id := r.grid_owner_id;
      grid_owner_name := r.grid_owner_name;
      grid_owner_ediel_id := r.grid_owner_ediel_id;
      platform_actor_route_id := r.platform_actor_route_id;
      message_family := r.message_family;
      message_code := v_message_code;
      environment := r.environment;
      communication_route_id := v_comm_route_id;
      ediel_route_profile_id := v_route_profile_id;
      company_market_party_route_id := v_company_party_route_id;
      repaired_outbound_count := 0;
      repaired_customer_info_count := 0;
      details := jsonb_build_object('postcheck', to_jsonb(v_post));
      return next;
      continue;
    end if;

    update public.outbound_requests obr
    set
      communication_route_id = v_comm_route_id,
      ediel_route_profile_id = v_route_profile_id,
      channel_type = 'ediel_partner',
      route_decision_payload = coalesce(obr.route_decision_payload, '{}'::jsonb) || jsonb_build_object(
        'decision_status', case when v_env = 'production' and v_post.production_send_lock_status = 'locked' then 'blocked' else 'ready' end,
        'communication_route_id', v_comm_route_id,
        'ediel_route_profile_id', v_route_profile_id,
        'message_family', r.message_family,
        'message_code', v_message_code,
        'environment', v_env,
        'repair_source', 'bulk_operational_route_materialization_repair'
      ),
      payload = coalesce(obr.payload, '{}'::jsonb) || jsonb_build_object(
        'communication_route_id', v_comm_route_id,
        'ediel_route_profile_id', v_route_profile_id,
        'route_materialization_repaired', true,
        'route_materialization_repaired_at', v_now,
        'environment', v_env,
        'operation_id', coalesce(obr.operation_id::text, obr.payload->>'operation_id')
      ),
      failure_reason = case
        when v_env = 'production' and v_post.production_send_lock_status = 'locked'
          then 'Första produktionssändning måste godkännas innan meddelandet skickas.'
        else obr.failure_reason
      end,
      updated_at = v_now
    where obr.company_id = r.company_id
      and obr.grid_owner_id = r.grid_owner_id
      and obr.request_type in ('customer_masterdata', 'customer_masterdata_request')
      and obr.communication_route_id is null
      and obr.status in ('failed', 'queued', 'prepared')
    ;
    get diagnostics v_repaired_outbound_count = row_count;

    update public.customer_info_requests cir
    set
      status = 'blocked',
      blocker_code = case
        when v_env = 'production' and v_post.production_send_lock_status = 'locked' then 'production_send_locked'
        else 'z01_prepared'
      end,
      blocker_reason = case
        when v_env = 'production' and v_post.production_send_lock_status = 'locked'
          then 'Första produktionssändning måste godkännas innan meddelandet skickas.'
        else 'PRODAT Z01 är förberedd efter route-materialisering.'
      end,
      route_resolution_status = 'operational_route_ready',
      route_resolution_reason = 'Operativ route materialiserades och tidigare null-route-flöde reparerades.',
      next_required_action = case
        when v_env = 'production' and v_post.production_send_lock_status = 'locked'
          then 'Första produktionssändning måste godkännas innan meddelandet skickas.'
        else 'Granska och fortsätt dispatchflödet.'
      end,
      grid_owner_data_request_id = coalesce(
        cir.grid_owner_data_request_id,
        (
          select godr.id
          from public.grid_owner_data_requests godr
          where godr.company_id = cir.company_id
            and godr.customer_id = cir.customer_id
            and godr.grid_owner_id = cir.grid_owner_id
            and godr.request_scope = 'customer_masterdata'
          order by godr.updated_at desc nulls last, godr.created_at desc nulls last
          limit 1
        )
      ),
      outbound_request_id = coalesce(
        cir.outbound_request_id,
        (
          select obr.id
          from public.outbound_requests obr
          where obr.company_id = cir.company_id
            and obr.customer_id = cir.customer_id
            and coalesce(obr.site_id::text, '') = coalesce(cir.site_id::text, '')
            and obr.grid_owner_id = cir.grid_owner_id
            and obr.request_type in ('customer_masterdata', 'customer_masterdata_request')
          order by obr.updated_at desc nulls last, obr.created_at desc nulls last
          limit 1
        )
      ),
      updated_at = v_now
    where cir.company_id = r.company_id
      and cir.grid_owner_id = r.grid_owner_id
      and cir.status in ('blocked', 'route_missing', 'missing_authorization', 'manual_review_required', 'z01_prepared')
      and coalesce(cir.blocker_code, '') in ('operational_route_missing', 'platform_route_exists_but_not_materialized', 'environment_not_resolved')
    ;
    get diagnostics v_repaired_customer_info_count = row_count;

    insert into public.audit_logs (company_id, entity_type, entity_id, action, metadata, created_at)
    values (
      r.company_id,
      'platform_actor_routes',
      r.platform_actor_route_id::text,
      'route_readiness.bulk_materialized_and_repaired',
      jsonb_build_object(
        'companyId', r.company_id,
        'gridOwnerId', r.grid_owner_id,
        'platformActorRouteId', r.platform_actor_route_id,
        'messageFamily', r.message_family,
        'messageCode', v_message_code,
        'environment', v_env,
        'communicationRouteId', v_comm_route_id,
        'edielRouteProfileId', v_route_profile_id,
        'companyMarketPartyRouteId', v_company_party_route_id,
        'repairedOutboundCount', v_repaired_outbound_count,
        'repairedCustomerInfoCount', v_repaired_customer_info_count,
        'productionSendLockStatus', v_post.production_send_lock_status
      ),
      v_now
    );

    result_status := 'materialized';
    reason_code := null;
    company_id := r.company_id;
    grid_owner_id := r.grid_owner_id;
    grid_owner_name := r.grid_owner_name;
    grid_owner_ediel_id := r.grid_owner_ediel_id;
    platform_actor_route_id := r.platform_actor_route_id;
    message_family := r.message_family;
    message_code := v_message_code;
    environment := r.environment;
    communication_route_id := v_comm_route_id;
    ediel_route_profile_id := v_route_profile_id;
    company_market_party_route_id := v_company_party_route_id;
    repaired_outbound_count := v_repaired_outbound_count;
    repaired_customer_info_count := v_repaired_customer_info_count;
    details := jsonb_build_object('production_send_lock_status', v_post.production_send_lock_status, 'send_ready', v_post.send_ready);
    return next;
  end loop;
end;
$$;

grant execute on function public.gridex_materialize_company_operational_routes(uuid, text, text, boolean) to service_role;
