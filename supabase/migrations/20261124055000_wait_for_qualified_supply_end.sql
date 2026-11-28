-- Defer final-invoice and contract effects until the qualified delivery end.
DO $source_end$
DECLARE definition text;
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='public.gridex_supply_end_followup_v1()'::regprocedure) IS DISTINCT FROM '31c142164fe3c6b79e566a090b9992e21a57950bc8f45cb325e3dfd629a22860' THEN
    RAISE EXCEPTION 'source_end_followup_preimage_changed';
  END IF;
  SELECT pg_get_functiondef('public.gridex_supply_end_followup_v1()'::regprocedure) INTO STRICT definition;
  definition:=replace(definition,$old$  v_binding_end date;$old$,$new$  v_binding_end date;
  v_scheduled_transition boolean := OLD.status='ending'
    AND NEW.source_end_message_id IS NOT DISTINCT FROM OLD.source_end_message_id
    AND NEW.market_state_version IS NOT DISTINCT FROM OLD.market_state_version;
  v_completed_end_source uuid;$new$);
  definition:=replace(definition,$old$   OR NEW.status NOT IN ('ending','ended')
   OR (OLD.end_date IS NOT DISTINCT FROM NEW.end_date AND OLD.actual_end_date IS NOT DISTINCT FROM NEW.actual_end_date AND OLD.status IN ('ending','ended')) THEN
    RETURN NEW;
  END IF;$old$,$new$   OR NEW.status IS DISTINCT FROM 'ended'
   OR (NEW.market_end_at IS NOT NULL AND (NOT isfinite(NEW.market_end_at) OR NEW.market_end_at>now()))
   OR (NOT v_scheduled_transition AND OLD.end_date IS NOT DISTINCT FROM NEW.end_date
     AND OLD.actual_end_date IS NOT DISTINCT FROM NEW.actual_end_date AND OLD.status IN ('ending','ended')) THEN
    RETURN NEW;
  END IF;

  -- Timers change the status at the source's exact time. Read back the
  -- committed scheduled state before opening a first financial task.
  IF v_scheduled_transition THEN
    IF NEW.source_end_message_id IS NULL OR NEW.market_end_at IS NULL
       OR NEW.market_end_at IS DISTINCT FROM OLD.market_end_at
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.actual_end_date IS DISTINCT FROM OLD.actual_end_date THEN
      RETURN NEW;
    END IF;
    SELECT tr.source_message_id INTO v_completed_end_source
    FROM gridex_received_sources.supply_source_transitions tr
    JOIN public.ediel_messages source ON source.id=tr.source_message_id AND source.company_id=tr.company_id
    WHERE tr.company_id=NEW.company_id AND tr.source_message_id=NEW.source_end_message_id
      AND source.direction='inbound' AND source.message_family='PRODAT' AND source.message_code='Z05'
      AND tr.payload_hash=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
      AND EXISTS (
        SELECT FROM jsonb_array_elements(tr.resulting_states) saved
        WHERE saved->>'id'=NEW.id::text AND saved->>'company_id'=NEW.company_id::text
          AND saved->>'customer_id'=NEW.customer_id::text AND saved->>'metering_point_id'=NEW.metering_point_id::text
          AND coalesce(saved->>'customer_contract_id',saved->>'contract_id') IS NOT DISTINCT FROM v_contract_id::text
          AND saved->>'status'='ending'
          AND saved->>'source_end_message_id'=NEW.source_end_message_id::text
          AND saved->>'market_state_version'=NEW.market_state_version::text
          AND CASE WHEN pg_input_is_valid(saved->>'market_end_at','timestamptz')
            THEN (saved->>'market_end_at')::timestamptz=NEW.market_end_at ELSE false END
          AND coalesce(saved->>'actual_end_date',saved->>'end_date')=v_end::text
      );
    IF v_completed_end_source IS NULL THEN RETURN NEW; END IF;
  END IF;$new$);
  definition:=replace(definition,$old$'source_message_id', NEW.source_message_id$old$,$new$'source_message_id', coalesce(v_completed_end_source,NEW.source_message_id)$new$);
  definition:=replace(definition,
    $old$jsonb_build_object('supply_end_date', v_end, 'end_reason', 'supply_end', 'end_key', v_key, 'supply_period_id', NEW.id)$old$,
    $new$jsonb_build_object('supply_end_date', v_end, 'end_reason', 'supply_end', 'end_key', v_key, 'supply_period_id', NEW.id)
      || CASE WHEN v_completed_end_source IS NOT NULL THEN jsonb_build_object(
        'source_end_message_id',v_completed_end_source,'market_state_version',NEW.market_state_version,'market_end_at',NEW.market_end_at)
      ELSE '{}'::jsonb END$new$);
  EXECUTE definition;
END
$source_end$;

DO $source_end_projector$
DECLARE definition text;
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='public.ediel_project_supply_end_followup_v1(uuid,uuid,uuid)'::regprocedure) IS DISTINCT FROM '730901ce6c85d070532a4e0c5feb4cb6d21e3cc07cf37d1f1d58f1c72a962e4f' THEN
    RAISE EXCEPTION 'source_end_projector_preimage_changed';
  END IF;
  SELECT pg_get_functiondef('public.ediel_project_supply_end_followup_v1(uuid,uuid,uuid)'::regprocedure) INTO STRICT definition;
  EXECUTE replace(definition,$old$ -- Site/switch come only from the same immutable normal confirmation, when$old$,$new$ -- The committed own receipt remains the durable due schedule, even if
 -- the receiver or the first deadline sweep loses its response.
 IF current_period.market_end_at IS NULL OR NOT isfinite(current_period.market_end_at) THEN
  RAISE EXCEPTION 'supply_followup_exact_end_time_required' USING ERRCODE='23514';
 END IF;
 IF current_period.status<>'ended' OR current_period.market_end_at>now() THEN
  RETURN jsonb_build_object('status','not_applicable','reason','scheduled_end','dueAt',current_period.market_end_at,
    'effectReceiptId',r.id,'sourceMessageId',m.id);
 END IF;
 -- Site/switch come only from the same immutable normal confirmation, when$new$);
END
$source_end_projector$;
ALTER FUNCTION public.ediel_project_supply_end_followup_v1(uuid,uuid,uuid) SET lock_timeout TO '2s';

CREATE TABLE gridex_received_sources.supply_end_followup_scan_positions(
  scope_key text PRIMARY KEY,
  last_end_at timestamptz,
  last_receipt uuid,
  CHECK ((last_end_at IS NULL)=(last_receipt IS NULL))
);
ALTER TABLE gridex_received_sources.supply_end_followup_scan_positions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_received_sources.supply_end_followup_scan_positions FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_list_due_supply_end_followups_v1(
  p_company_id uuid,p_actor_user_id uuid
) RETURNS TABLE(company_id uuid,effect_receipt_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog SET "TimeZone" TO 'UTC'
AS $body$
DECLARE
  scan_key text:=coalesce(p_company_id::text,'all')||':'||p_actor_user_id::text;
  position gridex_received_sources.supply_end_followup_scan_positions%rowtype;
  selected_company uuid;
  selected_receipt uuid;
  selected_end_at timestamptz;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN
    RAISE EXCEPTION 'supply_followup_service_required' USING ERRCODE='42501';
  END IF;
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT FROM public.user_profiles actor WHERE actor.id=p_actor_user_id AND actor.user_status='active'
  ) OR NOT EXISTS (
    SELECT FROM public.company_memberships membership
    WHERE membership.user_id=p_actor_user_id AND membership.status='active' AND membership.is_active
      AND membership.accepted_at IS NOT NULL AND (p_company_id IS NULL OR membership.company_id=p_company_id)
      AND public.gridex_actor_has_company_permission(p_actor_user_id,membership.company_id,'metering.write') IS TRUE
  ) THEN RETURN; END IF;

  INSERT INTO gridex_received_sources.supply_end_followup_scan_positions(scope_key) VALUES(scan_key) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT position FROM gridex_received_sources.supply_end_followup_scan_positions WHERE scope_key=scan_key FOR UPDATE;
  FOR pass IN 1..2 LOOP
    -- Exclude projected history by indexed receipt key before parsing or hashing
    -- any evidence. Membership permission is evaluated once per eligible company.
    WITH eligible AS MATERIALIZED (
      SELECT DISTINCT membership.company_id
      FROM public.company_memberships membership
      WHERE membership.user_id=p_actor_user_id AND membership.status='active' AND membership.is_active
        AND membership.accepted_at IS NOT NULL AND (p_company_id IS NULL OR membership.company_id=p_company_id)
        AND public.gridex_actor_has_company_permission(p_actor_user_id,membership.company_id,'metering.write') IS TRUE
    ), pending AS MATERIALIZED (
      SELECT p.company_id,p.id AS period_id,r.id AS receipt_id,p.market_end_at
      FROM eligible
      JOIN public.customer_supply_periods p ON p.company_id=eligible.company_id
      JOIN gridex_received_sources.supply_object_effect_receipts r
        ON r.company_id=p.company_id AND r.source_message_id=p.source_end_message_id
      WHERE p.status='ended' AND isfinite(p.market_end_at) AND p.market_end_at<=now()
        AND (position.last_end_at IS NULL OR (p.market_end_at,r.id)>(position.last_end_at,position.last_receipt))
        AND NOT EXISTS (
          SELECT FROM gridex_received_sources.supply_end_followups projected WHERE projected.effect_receipt_id=r.id
        )
    )
    SELECT pending.company_id,r.id,pending.market_end_at INTO selected_company,selected_receipt,selected_end_at
      FROM pending
      JOIN public.customer_supply_periods p ON p.company_id=pending.company_id AND p.id=pending.period_id
      JOIN gridex_received_sources.supply_object_effect_receipts r ON r.id=pending.receipt_id
      JOIN public.ediel_messages m ON m.id=r.source_message_id AND m.company_id=p.company_id AND m.environment=r.environment
      CROSS JOIN LATERAL (SELECT r.effect_text::jsonb AS contents) receipt
      CROSS JOIN LATERAL (SELECT receipt.contents#>'{resultingStates,0}' AS value) saved
      WHERE m.direction='inbound' AND m.message_family='PRODAT' AND m.message_code='Z05'
        AND r.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
        AND r.effect_hash=encode(sha256(convert_to(r.effect_text,'UTF8')),'hex')
        AND receipt.contents#>>'{plan,kind}'='end' AND receipt.contents#>>'{plan,periodId}'=p.id::text
        AND saved.value->>'id'=p.id::text AND saved.value->>'company_id'=p.company_id::text
        AND saved.value->>'customer_id'=p.customer_id::text AND saved.value->>'metering_point_id'=p.metering_point_id::text
        AND saved.value->>'source_end_message_id'=p.source_end_message_id::text
        AND saved.value->>'market_state_version'=p.market_state_version::text
        AND CASE WHEN pg_input_is_valid(saved.value->>'market_end_at','timestamptz')
          THEN (saved.value->>'market_end_at')::timestamptz=pending.market_end_at ELSE false END
        AND coalesce(saved.value->>'contract_id',saved.value->>'customer_contract_id')
          IS NOT DISTINCT FROM coalesce(p.contract_id,p.customer_contract_id)::text
      ORDER BY pending.market_end_at,r.id LIMIT 1;

    EXIT WHEN selected_receipt IS NOT NULL OR position.last_end_at IS NULL;
    -- Resume after the last claimed receipt even when it failed. On the next rotation
    -- unprojected items remain eligible, including a receipt lost after listing.
    position.last_end_at:=NULL;
    position.last_receipt:=NULL;
  END LOOP;

  UPDATE gridex_received_sources.supply_end_followup_scan_positions
  SET last_end_at=selected_end_at,last_receipt=selected_receipt
  WHERE scope_key=scan_key;
  IF selected_receipt IS NOT NULL THEN
    RETURN QUERY SELECT selected_company,selected_receipt;
  END IF;
END
$body$;
REVOKE ALL ON FUNCTION public.gridex_list_due_supply_end_followups_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_list_due_supply_end_followups_v1(uuid,uuid) TO service_role;
