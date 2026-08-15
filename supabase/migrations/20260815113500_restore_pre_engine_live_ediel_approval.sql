-- Restore tenants that were auditably live before the current certification-evidence engine.
--
-- This is deliberately generic and fail-closed. It does not mark a tenant approved merely
-- because a superadmin asks for it. The restore is allowed only when the database can prove:
--   * a pre-engine production activation to live;
--   * an approved first-live-send gate;
--   * a successful pre-engine production dry run with no blockers;
--   * the historical readiness snapshot recorded all mandatory actor tests as approved;
--   * the current production supplier identity still matches the historical approved identity;
--   * the historically approved PRODAT route and mailbox are still the active production path;
--   * a current-engine dry run can still build the production envelope and is blocked only by
--     the circular "current certification evidence missing" gate; and
--   * no real production send has happened yet (LIMITED_PILOT remains conditional on first send).
--
-- The evidence rows explicitly say historical_approval_migration. They are not represented as
-- new Ediel portal tests and do not reuse any system-supplier test identity.

create or replace function public.canonical_restore_pre_engine_live_ediel_approval(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_reason text default 'Restore audited pre-engine Ediel production approval into the current evidence engine.'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_engine text := public.canonical_current_ediel_engine_schema_version();
  v_cutover timestamptz := timestamptz '2026-07-13 10:00:00+00';
  v_now timestamptz := clock_timestamp();
  v_company public.companies%rowtype;
  v_activation public.ediel_go_live_events%rowtype;
  v_historical_check public.ediel_production_readiness_checks%rowtype;
  v_historical_dry_run public.ediel_go_live_events%rowtype;
  v_current_replay public.ediel_go_live_events%rowtype;
  v_current_check public.ediel_production_readiness_checks%rowtype;
  v_historical_ediel_id text;
  v_historical_route_id uuid;
  v_historical_mailbox_id uuid;
  v_actor_setting_id uuid;
  v_actor_count integer := 0;
  v_readiness jsonb;
  v_missing_current_checks text[];
  v_from_state text;
  v_restore_event_id uuid;
begin
  if p_company_id is null then
    raise exception 'historical_live_restore_company_required';
  end if;
  if p_actor_user_id is null then
    raise exception 'historical_live_restore_actor_required';
  end if;
  if not public.canonical_actor_is_platform_admin(p_actor_user_id) then
    raise exception 'historical_live_restore_platform_admin_required';
  end if;

  select * into v_company
  from public.companies
  where id = p_company_id
  for update;
  if not found then
    raise exception 'historical_live_restore_company_not_found';
  end if;
  if coalesce(v_company.is_active, true) is false
     or lower(coalesce(v_company.lifecycle_status, v_company.status, 'active')) in ('paused','suspended','archived','pending_deletion','deleted_test_only') then
    raise exception 'historical_live_restore_company_not_active';
  end if;

  select e.* into v_activation
  from public.ediel_go_live_events e
  where e.company_id = p_company_id
    and e.event_type = 'production_activated'
    and e.to_status = 'live'
    and e.created_at < v_cutover
  order by e.created_at desc
  limit 1;
  if not found then
    raise exception 'historical_live_restore_prior_activation_missing';
  end if;

  select r.* into v_historical_check
  from public.ediel_production_readiness_checks r
  where r.id = v_activation.readiness_check_id
    and r.company_id = p_company_id;
  if not found then
    raise exception 'historical_live_restore_activation_readiness_missing';
  end if;
  if jsonb_array_length(coalesce(v_historical_check.blocking_issues, '[]'::jsonb)) <> 0 then
    raise exception 'historical_live_restore_activation_had_blockers';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_historical_check.passed_checks, '[]'::jsonb)) as j(item)
    where j.item->>'code' = 'required_tests_approved'
      and j.item->>'severity' = 'passed'
  ) then
    raise exception 'historical_live_restore_required_tests_not_approved';
  end if;

  v_historical_ediel_id := nullif(btrim(coalesce(
    v_activation.metadata #>> '{readinessSnapshot,summary,edielId}',
    v_historical_check.readiness_snapshot #>> '{summary,edielId}'
  )), '');
  if v_historical_ediel_id is null then
    raise exception 'historical_live_restore_historical_ediel_id_missing';
  end if;

  begin
    v_historical_route_id := nullif(coalesce(
      v_activation.metadata->>'routeProfileId',
      v_activation.metadata #>> '{readinessSnapshot,summary,activeProductionProdatRouteProfileId}',
      v_historical_check.readiness_snapshot #>> '{summary,activeProductionProdatRouteProfileId}'
    ), '')::uuid;
  exception when invalid_text_representation then
    v_historical_route_id := null;
  end;
  begin
    v_historical_mailbox_id := nullif(coalesce(
      v_activation.metadata #>> '{readinessSnapshot,summary,productionMailboxId}',
      v_historical_check.readiness_snapshot #>> '{summary,productionMailboxId}'
    ), '')::uuid;
  exception when invalid_text_representation then
    v_historical_mailbox_id := null;
  end;
  if v_historical_route_id is null or v_historical_mailbox_id is null then
    raise exception 'historical_live_restore_transport_identity_missing';
  end if;

  select e.* into v_historical_dry_run
  from public.ediel_go_live_events e
  where e.company_id = p_company_id
    and e.event_type = 'production_dry_run'
    and e.created_at <= v_activation.created_at
    and coalesce((e.metadata->>'success')::boolean, false) = true
    and jsonb_array_length(coalesce(e.metadata->'blockingIssues', '[]'::jsonb)) = 0
    and e.metadata #>> '{previewMetadata,edielId}' = v_historical_ediel_id
    and e.metadata #>> '{previewMetadata,productionProdatRouteProfileId}' = v_historical_route_id::text
    and e.metadata #>> '{previewMetadata,productionMailboxId}' = v_historical_mailbox_id::text
  order by e.created_at desc
  limit 1;
  if not found then
    raise exception 'historical_live_restore_successful_dry_run_missing';
  end if;

  if not exists (
    select 1
    from public.ediel_go_live_events e
    where e.company_id = p_company_id
      and e.event_type = 'first_live_send_approved'
      and e.created_at <= v_activation.created_at
      and e.metadata->>'edielId' = v_historical_ediel_id
      and e.metadata->>'routeProfileId' = v_historical_route_id::text
      and e.metadata->>'mailboxId' = v_historical_mailbox_id::text
  ) then
    raise exception 'historical_live_restore_first_send_approval_missing';
  end if;

  select count(*), min(a.id)
    into v_actor_count, v_actor_setting_id
  from public.ediel_actor_settings a
  where a.company_id = p_company_id
    and a.environment = 'production'
    and a.is_active = true
    and lower(coalesce(a.actor_role, a.role, '')) in ('supplier','electricity_supplier')
    and coalesce(nullif(btrim(a.actor_ediel_id), ''), nullif(btrim(a.ediel_id), '')) = v_historical_ediel_id;
  if v_actor_count <> 1 or v_actor_setting_id is null then
    raise exception 'historical_live_restore_current_supplier_identity_not_exact';
  end if;
  if nullif(btrim(coalesce(v_company.production_ediel_id, v_company.ediel_id)), '') is distinct from v_historical_ediel_id then
    raise exception 'historical_live_restore_company_ediel_identity_changed';
  end if;

  if not exists (
    select 1
    from public.ediel_route_profiles r
    where r.id = v_historical_route_id
      and r.company_id = p_company_id
      and r.environment = 'production'
      and upper(coalesce(r.message_family, r.application_reference, '')) = 'PRODAT'
      and coalesce(r.is_active, r.is_enabled, true) = true
      and coalesce(nullif(btrim(r.sender_ediel_id), ''), nullif(btrim(r.own_ediel_id), '')) = v_historical_ediel_id
      and r.mailbox_id = v_historical_mailbox_id
      and coalesce(r.tls_required, false) = true
      and lower(coalesce(r.encryption_mode, '')) = 'smime'
  ) then
    raise exception 'historical_live_restore_approved_prodat_path_changed';
  end if;

  if exists (
    select 1
    from public.ediel_messages m
    where m.company_id = p_company_id
      and m.environment = 'production'
      and m.direction = 'outbound'
      and m.status = 'sent'
  ) then
    raise exception 'historical_live_restore_real_production_send_requires_pilot_evidence';
  end if;

  select e.* into v_current_replay
  from public.ediel_go_live_events e
  where e.company_id = p_company_id
    and e.event_type = 'production_dry_run'
    and e.created_at >= v_cutover
    and e.metadata #>> '{previewMetadata,edielId}' = v_historical_ediel_id
    and e.metadata #>> '{previewMetadata,productionProdatRouteProfileId}' = v_historical_route_id::text
    and e.metadata #>> '{previewMetadata,productionMailboxId}' = v_historical_mailbox_id::text
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(e.metadata->'blockingIssues', '[]'::jsonb)) as b(item)
      where b.item->>'code' <> 'external_certification_and_pilot_missing'
    )
  order by e.created_at desc
  limit 1;
  if not found then
    raise exception 'historical_live_restore_current_engine_replay_missing';
  end if;

  select r.* into v_current_check
  from public.ediel_production_readiness_checks r
  where r.id = v_current_replay.readiness_check_id
    and r.company_id = p_company_id;
  if not found then
    raise exception 'historical_live_restore_current_readiness_missing';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_current_check.blocking_issues, '[]'::jsonb)) as b(item)
    where b.item->>'code' <> 'external_certification_and_pilot_missing'
  ) then
    raise exception 'historical_live_restore_current_readiness_has_non_evidence_blockers';
  end if;

  select array_agg(required_code order by required_code)
    into v_missing_current_checks
  from (
    values
      ('company_active'),
      ('production_ediel_id'),
      ('production_actor_exists'),
      ('production_tls_required'),
      ('production_smime_default'),
      ('production_recipient_certificate_resolved_at_send'),
      ('actor_role_configured'),
      ('brp_configured'),
      ('brp_active'),
      ('esett_ready'),
      ('production_prodat_route_exists'),
      ('production_utilts_route_exists'),
      ('production_route_sender_valid'),
      ('production_transport_configured'),
      ('production_mailbox_exists'),
      ('required_tests_approved'),
      ('no_unresolved_items'),
      ('no_failed_messages'),
      ('no_negative_aperaks'),
      ('first_live_send_ready')
  ) as required(required_code)
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(v_current_check.passed_checks, '[]'::jsonb)) as p(item)
    where p.item->>'code' = required.required_code
      and p.item->>'severity' = 'passed'
  );
  if coalesce(array_length(v_missing_current_checks, 1), 0) > 0 then
    raise exception 'historical_live_restore_current_checks_missing:%', array_to_string(v_missing_current_checks, ',');
  end if;

  insert into public.ediel_certification_evidence (
    company_id, environment, evidence_type, status, engine_schema_version,
    external_reference, evidence_document_reference, tested_at, valid_until,
    approved_by, approved_at, metadata, created_at, updated_at
  )
  values
    (p_company_id, 'production', 'TGT', 'passed', v_engine,
      'historical-live-activation:' || v_activation.id::text,
      'ediel_production_readiness_checks/' || v_historical_check.id::text,
      v_historical_check.checked_at, null, p_actor_user_id, v_now,
      jsonb_build_object('source','historical_approval_migration','source_event_id',v_activation.id,'source_readiness_check_id',v_historical_check.id,'historical_ediel_id',v_historical_ediel_id,'assertion','pre-engine readiness recorded all mandatory actor tests approved; no new portal test is claimed'),
      v_now, v_now),
    (p_company_id, 'production', 'AGT', 'passed', v_engine,
      'historical-live-activation:' || v_activation.id::text,
      'ediel_production_readiness_checks/' || v_historical_check.id::text,
      v_historical_check.checked_at, null, p_actor_user_id, v_now,
      jsonb_build_object('source','historical_approval_migration','source_event_id',v_activation.id,'source_readiness_check_id',v_historical_check.id,'historical_ediel_id',v_historical_ediel_id,'assertion','pre-engine readiness recorded all mandatory actor tests approved; no new portal test is claimed'),
      v_now, v_now),
    (p_company_id, 'production', 'SHADOW_PRODUCTION', 'passed', v_engine,
      'historical-production-dry-run:' || v_historical_dry_run.id::text,
      'ediel_go_live_events/' || v_historical_dry_run.id::text,
      v_historical_dry_run.created_at, null, p_actor_user_id, v_now,
      jsonb_build_object('source','historical_approval_migration','source_event_id',v_historical_dry_run.id,'approved_prodat_route_id',v_historical_route_id,'approved_mailbox_id',v_historical_mailbox_id,'historical_ediel_id',v_historical_ediel_id),
      v_now, v_now),
    (p_company_id, 'production', 'LIVE_TENANT_INTEGRITY', 'passed', v_engine,
      'current-readiness:' || v_current_check.id::text,
      'ediel_production_readiness_checks/' || v_current_check.id::text,
      v_current_check.checked_at, null, p_actor_user_id, v_now,
      jsonb_build_object('source','historical_approval_migration','source_readiness_check_id',v_current_check.id,'current_actor_setting_id',v_actor_setting_id,'approved_prodat_route_id',v_historical_route_id,'approved_mailbox_id',v_historical_mailbox_id,'assertion','current readiness passed tenant identity, supplier, route, transport, mailbox, BRP/eSett and operational integrity checks; only current-evidence circular gate remained'),
      v_now, v_now),
    (p_company_id, 'production', 'RESTORE_REPLAY', 'passed', v_engine,
      'current-engine-dry-run:' || v_current_replay.id::text,
      'ediel_go_live_events/' || v_current_replay.id::text,
      v_current_replay.created_at, null, p_actor_user_id, v_now,
      jsonb_build_object('source','historical_approval_migration','source_event_id',v_current_replay.id,'current_engine',v_engine,'approved_prodat_route_id',v_historical_route_id,'approved_mailbox_id',v_historical_mailbox_id,'assertion','current engine rebuilt the production envelope and was blocked only by the circular current-evidence gate'),
      v_now, v_now)
  on conflict (company_id, environment, evidence_type, engine_schema_version)
  do update set
    status = excluded.status,
    external_reference = excluded.external_reference,
    evidence_document_reference = excluded.evidence_document_reference,
    tested_at = excluded.tested_at,
    valid_until = excluded.valid_until,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at;

  v_readiness := public.canonical_ediel_production_evidence_readiness(p_company_id);
  if coalesce((v_readiness->>'ready')::boolean, false) is false then
    raise exception 'historical_live_restore_current_evidence_not_ready:%', v_readiness::text;
  end if;

  select state into v_from_state
  from public.ediel_production_state
  where company_id = p_company_id
  for update;
  v_from_state := coalesce(v_from_state, 'blocked');

  update public.ediel_production_state
  set state = 'live',
      readiness_check_id = v_current_check.id,
      dry_run_id = v_current_replay.id,
      state_version = coalesce(state_version, 0) + 1,
      approved_by = coalesce(approved_by, v_activation.actor_user_id, p_actor_user_id),
      approved_at = coalesce(approved_at, v_activation.created_at, v_now),
      blocked_reason = null,
      paused_by = null,
      paused_at = null,
      pause_reason = null,
      last_idempotency_key = 'historical-live-restore:' || v_engine,
      updated_at = v_now
  where company_id = p_company_id;
  if not found then
    insert into public.ediel_production_state (
      company_id, state, readiness_check_id, dry_run_id, state_version,
      approved_by, approved_at, first_live_send_approved_by, first_live_send_approved_at,
      blocked_reason, last_idempotency_key, created_at, updated_at
    ) values (
      p_company_id, 'live', v_current_check.id, v_current_replay.id, 1,
      coalesce(v_activation.actor_user_id, p_actor_user_id), v_activation.created_at,
      p_actor_user_id, v_activation.created_at,
      null, 'historical-live-restore:' || v_engine, v_now, v_now
    );
  end if;

  update public.companies
  set ediel_production_status = 'live',
      ediel_production_enabled = true,
      ediel_production_enabled_at = coalesce(ediel_production_enabled_at, v_now),
      live_ediel_enabled = true,
      live_approved_at = coalesce(live_approved_at, v_activation.created_at),
      live_blocked_reason = null,
      updated_at = v_now
  where id = p_company_id;

  update public.ediel_send_locks
  set locked = false,
      locked_reason = null,
      unlocked_by = p_actor_user_id,
      unlocked_at = v_now,
      updated_at = v_now
  where company_id = p_company_id
    and environment = 'production'
    and locked = true;

  insert into public.ediel_go_live_events (
    company_id, event_type, from_status, to_status, reason, actor_user_id,
    readiness_check_id, metadata, created_at, is_stale, stale_reason
  ) values (
    p_company_id,
    'historical_live_approval_restored',
    v_from_state,
    'live',
    coalesce(nullif(btrim(p_reason), ''), 'Restore audited pre-engine Ediel production approval into the current evidence engine.'),
    p_actor_user_id,
    v_current_check.id,
    jsonb_build_object(
      'source','historical_approval_migration',
      'engine_schema_version',v_engine,
      'historical_activation_event_id',v_activation.id,
      'historical_dry_run_event_id',v_historical_dry_run.id,
      'current_replay_event_id',v_current_replay.id,
      'historical_ediel_id',v_historical_ediel_id,
      'approved_prodat_route_id',v_historical_route_id,
      'approved_mailbox_id',v_historical_mailbox_id,
      'limited_pilot_required',false
    ),
    v_now,
    false,
    null
  ) returning id into v_restore_event_id;

  return jsonb_build_object(
    'restored', true,
    'company_id', p_company_id,
    'state', 'live',
    'engine_schema_version', v_engine,
    'ediel_id', v_historical_ediel_id,
    'historical_activation_event_id', v_activation.id,
    'historical_dry_run_event_id', v_historical_dry_run.id,
    'current_replay_event_id', v_current_replay.id,
    'current_readiness_check_id', v_current_check.id,
    'restore_event_id', v_restore_event_id,
    'evidence_readiness', v_readiness
  );
end;
$$;

revoke all on function public.canonical_restore_pre_engine_live_ediel_approval(uuid, uuid, text) from public;
grant execute on function public.canonical_restore_pre_engine_live_ediel_approval(uuid, uuid, text) to authenticated, service_role;

comment on function public.canonical_restore_pre_engine_live_ediel_approval(uuid, uuid, text) is
  'Fail-closed compatibility restore for tenants auditably live before the current Ediel certification-evidence engine. Creates explicitly grandfathered evidence only after validating historical approval and current production identity/transport integrity.';
