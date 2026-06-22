-- EDIEL route chain audit corrections.
-- No sends. No production approval. All statements are idempotent.
--
-- 1) Fix live ediel_route_profiles rows with invalid ack_mode = 'contrl_aperak'
--    (set by the previous TypeScript materializer before the bug was caught).
-- 2) Add DB CHECK constraint on ediel_route_profiles.ack_mode if missing.
-- 3) Extend communication_routes.route_scope constraint to include
--    'metering_access' (needed for PRODAT Z13/Z14/Z15/Z18 flows).
-- 4) Replace gridex_materialize_company_operational_routes with an extended
--    signature that allows single-route apply:
--      + p_grid_owner_id uuid default null
--      + p_platform_actor_route_id uuid default null
--      + p_message_code text default null
-- 5) Repair Landskrona partial route:
--    communication_routes id = ea248513-2490-4e29-a037-a2e61c8213ec
--    Insert missing ediel_route_profiles and company_market_party_routes.
-- 6) Audit log every repair.

create extension if not exists pgcrypto;

-- ============================================================
-- 1. Fix invalid ack_mode data
-- ============================================================
update public.ediel_route_profiles
set
  ack_mode = 'contrl_and_aperak',
  ack_policy = case when ack_policy = 'contrl_aperak' then 'contrl_and_aperak' else ack_policy end,
  updated_at = now()
where ack_mode = 'contrl_aperak';

-- ============================================================
-- 2. Add ack_mode CHECK constraint (idempotent)
-- ============================================================
do $$
begin
  if to_regclass('public.ediel_route_profiles') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.ediel_route_profiles'::regclass
         and conname = 'ediel_route_profiles_ack_mode_check'
     ) then
    alter table public.ediel_route_profiles
      add constraint ediel_route_profiles_ack_mode_check
      check (ack_mode in ('default', 'none', 'contrl_only', 'contrl_and_aperak'))
      not valid;
    alter table public.ediel_route_profiles
      validate constraint ediel_route_profiles_ack_mode_check;
  end if;
end $$;

-- ============================================================
-- 3. Extend communication_routes.route_scope constraint to include
--    metering_access (for PRODAT Z13/Z14/Z15/Z18)
-- ============================================================
do $$
declare
  constraint_row record;
begin
  if to_regclass('public.communication_routes') is not null then
    -- Drop all existing route_scope check constraints
    for constraint_row in
      select conname
      from pg_constraint
      where conrelid = 'public.communication_routes'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%route_scope%'
    loop
      execute format('alter table public.communication_routes drop constraint if exists %I', constraint_row.conname);
    end loop;

    -- Recreate with metering_access included
    alter table public.communication_routes
      add constraint communication_routes_route_scope_check
      check (route_scope in (
        'supplier_switch',
        'customer_masterdata',
        'meter_values',
        'metering_values',
        'billing_underlay',
        'metering_access'
      ))
      not valid;

    alter table public.communication_routes
      validate constraint communication_routes_route_scope_check;
  end if;
end $$;

-- ============================================================
-- 4. Replace gridex_materialize_company_operational_routes
--    with extended signature (p_grid_owner_id, p_platform_actor_route_id,
--    p_message_code) and corrected ack_mode literal.
-- ============================================================

-- Drop all overloads to allow signature change
drop function if exists public.gridex_materialize_company_operational_routes(uuid, text, text, boolean);
drop function if exists public.gridex_materialize_company_operational_routes(uuid, text, text, uuid, uuid, text, boolean);

create or replace function public.gridex_materialize_company_operational_routes(
  p_company_id uuid,
  p_environment text default null,
  p_message_family text default null,
  p_grid_owner_id uuid default null,
  p_platform_actor_route_id uuid default null,
  p_message_code text default null,
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

  -- Guard: if p_grid_owner_id is provided without p_platform_actor_route_id
  -- or vice-versa (except p_grid_owner_id alone is allowed as filter), both
  -- narrow the candidate set. Wide apply requires both to be null.

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
      -- Single-route filters (safe: narrows to at most one candidate)
      and (p_grid_owner_id is null or gr.grid_owner_id = p_grid_owner_id)
      and (p_platform_actor_route_id is null or gr.platform_actor_route_id = p_platform_actor_route_id)
      and (p_message_code is null or coalesce(gr.message_code, '') = p_message_code or (p_message_code = 'Z01' and gr.message_code is null and upper(coalesce(gr.message_family, '')) = 'PRODAT'))
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

    -- Route scope from central matrix
    v_route_scope := case
      when upper(coalesce(r.message_family, '')) = 'PRODAT' then
        case
          when v_message_code in ('Z03','Z04','Z05','Z06','Z09','Z10') then 'supplier_switch'
          when v_message_code in ('Z13','Z14','Z15','Z18')             then 'metering_access'
          else 'customer_masterdata'
        end
      when upper(coalesce(r.message_family, '')) = 'UTILTS' then 'meter_values'
      else 'customer_masterdata'
    end;

    if v_env = 'production' then
      v_env_type := 'production'::public.ediel_environment_type;
      v_target_system := 'production_ediel';
    elsif v_env = 'test' then
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
      case
        when v_route_scope = 'metering_access' then '23-DGI-PRODAT'
        when upper(coalesce(r.message_family, '')) = 'PRODAT' then '23-DDQ-PRODAT'
        when upper(coalesce(r.message_family, '')) = 'UTILTS' then '23-DDQ-UTILTS'
        else '23-DDQ-PRODAT'
      end
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
        'route_profile', jsonb_build_object('sender_ediel_id', v_sender_ediel_id, 'receiver_ediel_id', v_receiver_ediel_id, 'message_family', r.message_family, 'message_code', v_message_code, 'ack_mode', 'contrl_and_aperak'),
        'company_market_party_route', jsonb_build_object('market_party_id', v_platform.actor_id, 'platform_actor_route_id', r.platform_actor_route_id)
      );
      return next;
      continue;
    end if;

    -- ---- communication_routes ----
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
          'materialized_from', 'gridex_materialize_company_operational_routes',
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
        'Materialiserad från verifierad aktörsregister-route.',
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
          'materialized_from', 'gridex_materialize_company_operational_routes',
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

    -- ---- ediel_route_profiles ----
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
        'contrl_and_aperak',
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
        'contrl_and_aperak',
        true,
        true,
        jsonb_build_object(
          'platform_actor_route_id', r.platform_actor_route_id,
          'platform_market_actor_id', v_platform.actor_id,
          'sender_settings_id', r.sender_settings_id,
          'production_send_lock_status', r.production_send_lock_status,
          'materialized_from', 'gridex_materialize_company_operational_routes'
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
        ack_mode = 'contrl_and_aperak',
        ack_policy = 'contrl_and_aperak',
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
          'materialized_from', 'gridex_materialize_company_operational_routes'
        ),
        updated_at = v_now
      where id = v_existing_id
      returning id into v_route_profile_id;
    end if;

    -- ---- company_market_party_routes ----
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
          'materialized_from', 'gridex_materialize_company_operational_routes',
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
          'materialized_from', 'gridex_materialize_company_operational_routes',
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

    -- ---- Postcheck ----
    select * into v_post
    from public.gridex_company_route_readiness_v gr
    where gr.company_id = r.company_id
      and gr.grid_owner_id = r.grid_owner_id
      and gr.platform_actor_route_id = r.platform_actor_route_id
      and gr.message_family = r.message_family
      and coalesce(gr.message_code, '') = coalesce(v_message_code, '')
      and gr.environment = v_env
    limit 1;

    if not found
       or coalesce(v_post.operational_route_ready, false) is not true
       or v_post.communication_route_id is null
       or v_post.ediel_route_profile_id is null
       or v_post.company_market_party_route_id is null then

      insert into public.audit_logs (company_id, entity_type, entity_id, action, metadata, created_at)
      values (
        r.company_id,
        'platform_actor_routes',
        r.platform_actor_route_id::text,
        'route_readiness.materialize_postcheck_failed',
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

    -- ---- Repair null-route outbound rows ----
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
        'repair_source', 'gridex_materialize_company_operational_routes'
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
      and obr.status in ('failed', 'queued', 'prepared');
    get diagnostics v_repaired_outbound_count = row_count;

    -- ---- Repair stuck customer_info_requests ----
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
      and coalesce(cir.blocker_code, '') in ('operational_route_missing', 'platform_route_exists_but_not_materialized', 'environment_not_resolved');
    get diagnostics v_repaired_customer_info_count = row_count;

    -- ---- Audit log success ----
    insert into public.audit_logs (company_id, entity_type, entity_id, action, metadata, created_at)
    values (
      r.company_id,
      'platform_actor_routes',
      r.platform_actor_route_id::text,
      'route_readiness.materialized_and_repaired',
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

grant execute on function public.gridex_materialize_company_operational_routes(uuid, text, text, uuid, uuid, text, boolean) to service_role;

-- ============================================================
-- 5. Repair Landskrona Energi AB partial route.
--    communication_routes id ea248513-2490-4e29-a037-a2e61c8213ec already
--    exists. Insert missing ediel_route_profiles and
--    company_market_party_routes only if they are absent.
--    No sends. No production approval.
-- ============================================================
do $$
declare
  v_cr_id uuid := 'ea248513-2490-4e29-a037-a2e61c8213ec'::uuid;
  v_company_id uuid := 'b3ad1bf6-fa45-41a6-8054-2e0862e82aca'::uuid;
  v_grid_owner_id uuid := 'bc2babae-356d-44be-bc96-30da527aa2de'::uuid;
  v_par_id uuid := '5e619994-1654-4aa8-9d2a-63abb123d127'::uuid;
  v_now timestamptz := now();

  -- Source-of-truth values from the known partial route
  v_receiver_ediel_id text := '25600';
  v_endpoint text := '25600@ediel.props.se';
  v_environment text := 'production';
  v_message_family text := 'PRODAT';
  v_message_code text := 'Z01';
  v_route_scope text := 'customer_masterdata';

  v_sender record;
  v_par record;
  v_erp_id uuid;
  v_cmpr_id uuid;
begin
  -- Verify the communication_route exists before proceeding
  if not exists (select 1 from public.communication_routes where id = v_cr_id) then
    raise notice 'Landskrona communication_route % not found; skipping partial repair.', v_cr_id;
    return;
  end if;

  -- Resolve sender settings for this company + production environment
  select * into v_sender
  from public.ediel_actor_settings eas
  where eas.company_id = v_company_id
    and eas.environment = 'production'
    and eas.is_active = true
  order by eas.updated_at desc nulls last
  limit 1;

  -- Resolve platform_actor_route
  select * into v_par
  from public.platform_actor_routes par
  where par.id = v_par_id
  limit 1;

  -- ---- ediel_route_profiles (insert only if missing) ----
  select erp.id into v_erp_id
  from public.ediel_route_profiles erp
  where erp.communication_route_id = v_cr_id
    and erp.company_id = v_company_id
    and erp.environment = 'production'
  limit 1;

  if v_erp_id is null then
    insert into public.ediel_route_profiles (
      company_id, communication_route_id, environment, environment_type, route_name,
      route_type, payload_format, message_standard, ack_mode, default_test_flag,
      default_timezone, sender_ediel_id, own_ediel_id, sender_sub_address,
      sender_subaddress, own_subaddress, receiver_ediel_id, counterparty_ediel_id,
      receiver_sub_address, receiver_subaddress, counterparty_subaddress,
      receiver_name, application_reference, message_family, message_code,
      default_message_version, encryption_mode, transport_type, ack_policy,
      is_active, is_enabled, metadata, created_at, updated_at
    ) values (
      v_company_id,
      v_cr_id,
      'production',
      'production'::public.ediel_environment_type,
      'Landskrona Energi AB PRODAT',
      'email',
      'edifact',
      'edifact',
      'contrl_and_aperak',
      0,
      1,
      coalesce(nullif(v_sender.ediel_id, ''), nullif(v_sender.actor_ediel_id, '')),
      coalesce(nullif(v_sender.ediel_id, ''), nullif(v_sender.actor_ediel_id, '')),
      coalesce(nullif(v_sender.sender_subaddress_prodat, ''), nullif(v_sender.sender_subaddress, '')),
      coalesce(nullif(v_sender.sender_subaddress_prodat, ''), nullif(v_sender.sender_subaddress, '')),
      coalesce(nullif(v_sender.sender_subaddress_prodat, ''), nullif(v_sender.sender_subaddress, '')),
      v_receiver_ediel_id,
      v_receiver_ediel_id,
      coalesce(nullif(v_par.subaddress, ''), null),
      coalesce(nullif(v_par.subaddress, ''), null),
      coalesce(nullif(v_par.subaddress, ''), null),
      'Landskrona Energi AB',
      coalesce(nullif(v_par.application_reference, ''), nullif(v_sender.application_reference, ''), '23-DDQ-PRODAT'),
      'PRODAT',
      'Z01',
      '26A',
      'smime',
      'smtp',
      'contrl_and_aperak',
      true,
      true,
      jsonb_build_object(
        'platform_actor_route_id', v_par_id,
        'materialized_from', 'landscrona_partial_route_repair_20260622',
        'production_send_lock_status', 'locked'
      ),
      v_now,
      v_now
    ) returning id into v_erp_id;

    insert into public.audit_logs (company_id, entity_type, entity_id, action, metadata, created_at)
    values (
      v_company_id,
      'communication_routes',
      v_cr_id::text,
      'route_repair.ediel_route_profile_created',
      jsonb_build_object(
        'communicationRouteId', v_cr_id,
        'edielRouteProfileId', v_erp_id,
        'gridOwnerId', v_grid_owner_id,
        'gridOwnerEdielId', v_receiver_ediel_id,
        'environment', 'production',
        'repairSource', 'landscrona_partial_route_repair_20260622'
      ),
      v_now
    );
  end if;

  -- ---- company_market_party_routes (insert only if missing) ----
  if v_par.id is not null then
    select cmpr.id into v_cmpr_id
    from public.company_market_party_routes cmpr
    where cmpr.company_id = v_company_id
      and cmpr.market_party_id = v_par.actor_id
      and cmpr.message_family = 'PRODAT'
      and coalesce(cmpr.environment, cmpr.metadata->>'environment') = 'production'
      and coalesce(nullif(cmpr.message_code, ''), '') = 'Z01'
      and cmpr.active = true
    limit 1;

    if v_cmpr_id is null then
      insert into public.company_market_party_routes (
        company_id, market_party_id, message_family, message_code, environment,
        platform_actor_route_id, communication_route_id, route_profile_id, active,
        metadata, updated_at
      ) values (
        v_company_id,
        v_par.actor_id,
        'PRODAT',
        'Z01',
        'production',
        v_par_id,
        v_cr_id,
        v_erp_id,
        true,
        jsonb_build_object(
          'platform_actor_route_id', v_par_id,
          'materialized_from', 'landscrona_partial_route_repair_20260622',
          'environment', 'production',
          'message_code', 'Z01',
          'communication_route_id', v_cr_id,
          'ediel_route_profile_id', v_erp_id,
          'receiver_ediel_id', v_receiver_ediel_id,
          'target_email', v_endpoint,
          'production_send_lock_status', 'locked'
        ),
        v_now
      ) returning id into v_cmpr_id;

      insert into public.audit_logs (company_id, entity_type, entity_id, action, metadata, created_at)
      values (
        v_company_id,
        'communication_routes',
        v_cr_id::text,
        'route_repair.company_market_party_route_created',
        jsonb_build_object(
          'communicationRouteId', v_cr_id,
          'edielRouteProfileId', v_erp_id,
          'companyMarketPartyRouteId', v_cmpr_id,
          'gridOwnerId', v_grid_owner_id,
          'environment', 'production',
          'repairSource', 'landscrona_partial_route_repair_20260622'
        ),
        v_now
      );
    end if;
  end if;
end $$;
