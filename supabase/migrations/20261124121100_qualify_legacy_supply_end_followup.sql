-- Final work follows the exact Z05 source after its effective cutoff.
CREATE TABLE gridex_received_sources.legacy_supply_end_cases(
  company_id uuid NOT NULL,
  source_message_id uuid NOT NULL,
  supply_period_id uuid NOT NULL,
  case_id uuid NOT NULL UNIQUE,
  PRIMARY KEY(company_id,source_message_id,supply_period_id)
);
ALTER TABLE gridex_received_sources.legacy_supply_end_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_received_sources.legacy_supply_end_cases FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.legacy_end_authority_v1(p_company_id uuid,p_source_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $authority$
BEGIN
  RETURN gridex_bilateral_prodat.recorded_supply_current_v1(p_company_id,p_source_id) IS TRUE;
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM IN ('bilateral_prodat_outbound_recorded_original_required',
    'bilateral_prodat_outbound_recorded_profile_required','ediel_original_bytes_retention_tombstoned') THEN
    RETURN false;
  END IF;
  RAISE;
END
$authority$;
REVOKE ALL ON FUNCTION gridex_received_sources.legacy_end_authority_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $timer$
DECLARE definition text;
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
      WHERE oid='gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)'::regprocedure)
      IS DISTINCT FROM 'f8ff8ac541f553acba9a1cd819570bbda213d2d34e8483367dbd18dee5d1fa3e' THEN
    RAISE EXCEPTION 'legacy_end_deadline_preimage_changed';
  END IF;
  SELECT pg_get_functiondef('gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)'::regprocedure) INTO STRICT definition;
  definition:=replace(definition,$old$ AND p.status='ending' AND p.market_end_at<=now() AND tr.payload_hash=$old$,$new$ AND p.status='ending' AND p.market_end_at<=now()
  AND CASE WHEN NOT EXISTS(
    SELECT FROM gridex_received_sources.supply_object_partitions own
    WHERE own.company_id=p.company_id AND own.source_message_id=m.id
  ) THEN gridex_received_sources.legacy_end_authority_v1(p.company_id,m.id) ELSE true END
  AND tr.payload_hash=$new$);
  EXECUTE definition;
END
$timer$;

CREATE FUNCTION public.gridex_project_legacy_supply_end_followup_v1(
  p_company_id uuid,p_source_message_id uuid,p_supply_period_id uuid,p_actor_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC'
AS $legacy_case$
DECLARE
  source public.ediel_messages%rowtype;
  transition gridex_received_sources.supply_source_transitions%rowtype;
  period public.customer_supply_periods%rowtype;
  saved jsonb;
  previous jsonb;
  wire jsonb;
  identity jsonb;
  case_ids uuid[];
  case_id uuid;
  recorded_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_source_message_id IS NULL OR p_supply_period_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'legacy_end_followup_scope_required' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
    OR NOT EXISTS(SELECT FROM public.company_memberships cm
      WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active'
        AND cm.is_active AND cm.accepted_at IS NOT NULL)
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE THEN
    RAISE EXCEPTION 'legacy_end_followup_actor_unqualified' USING ERRCODE='42501';
  END IF;
  PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
  identity:=jsonb_build_object('sourceMessageId',p_source_message_id,'supplyPeriodId',p_supply_period_id);
  SELECT * INTO source FROM public.ediel_messages m WHERE m.id=p_source_message_id AND m.company_id=p_company_id FOR UPDATE;
  SELECT * INTO transition FROM gridex_received_sources.supply_source_transitions t
    WHERE t.source_message_id=source.id AND t.company_id=source.company_id;
  IF source.id IS NULL OR source.environment IS NULL OR source.direction IS DISTINCT FROM 'inbound'
    OR source.message_family IS DISTINCT FROM 'PRODAT' OR source.message_code IS DISTINCT FROM 'Z05'
    OR transition.source_code IS DISTINCT FROM 'Z05'
    OR transition.payload_hash IS NULL
    OR transition.payload_hash IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
    OR EXISTS(SELECT FROM gridex_received_sources.supply_object_partitions own
      WHERE own.company_id=p_company_id AND own.source_message_id=source.id)
    OR EXISTS(SELECT FROM gridex_received_sources.supply_object_effect_receipts own
      WHERE own.company_id=p_company_id AND own.source_message_id=source.id)
    OR EXISTS(SELECT FROM gridex_ediel_retention.blob_tombstones gone
      WHERE gone.company_id=p_company_id AND gone.message_id=source.id) THEN
    RETURN identity||'{"status":"not_applicable","reason":"legacy_end_source_unavailable"}';
  END IF;
  SELECT * INTO period FROM public.customer_supply_periods p
    WHERE p.id=p_supply_period_id AND p.company_id=p_company_id AND p.source_end_message_id=source.id FOR UPDATE;
  IF period.id IS NULL OR period.status NOT IN ('ending','ended') OR NOT coalesce(isfinite(period.market_end_at),false) THEN
    RETURN identity||'{"status":"not_applicable","reason":"legacy_end_no_longer_current"}';
  END IF;
  SELECT value INTO STRICT saved FROM jsonb_array_elements(transition.resulting_states)
    WHERE value->>'id'=period.id::text;
  SELECT value INTO STRICT previous FROM jsonb_array_elements(transition.previous_states)
    WHERE value->>'id'=period.id::text;
  wire:=gridex_received_sources.normal_switch_wire_v1(source.raw_payload);
  IF wire->>'code' IS DISTINCT FROM 'Z05' OR wire->'objects' IS DISTINCT FROM transition.source_objects
    OR (saved->>'status' IN ('ending','ended')) IS NOT TRUE
    OR (previous->>'status' IN ('active','confirmed_by_grid_owner','ending')) IS NOT TRUE
    OR previous->>'company_id' IS DISTINCT FROM p_company_id::text
    OR previous->>'customer_id' IS DISTINCT FROM period.customer_id::text
    OR previous->>'metering_point_id' IS DISTINCT FROM period.metering_point_id::text
    OR previous->>'source_message_id' IS DISTINCT FROM saved->>'source_message_id'
    OR previous->>'market_state_version' IS DISTINCT FROM (period.market_state_version-1)::text
    OR coalesce(previous->>'customer_contract_id',previous->>'contract_id')
      IS DISTINCT FROM coalesce(period.customer_contract_id,period.contract_id)::text
    OR (to_jsonb(period)-ARRAY['status','updated_at']) IS DISTINCT FROM (saved-ARRAY['status','updated_at'])
    OR (SELECT count(*) FROM public.metering_points mp
        CROSS JOIN LATERAL jsonb_array_elements(wire->'objects') own
        WHERE mp.id=period.metering_point_id AND mp.company_id=p_company_id
          AND mp.customer_id=period.customer_id AND mp.ediel_metering_point_id=own->>'point'
          AND mp.grid_area_code=own->>'gridArea' AND own->>'reason' IN ('Z22','Z23','Z25')
          AND gridex_received_sources.permission_time_v1(own->>'end')=period.market_end_at
          AND gridex_received_sources.permission_date_v1(own->>'end')=period.end_date)<>1 THEN
    RAISE EXCEPTION 'legacy_end_followup_effect_conflict';
  END IF;
  IF period.status<>'ended' OR period.market_end_at>now() THEN
    RETURN identity||jsonb_build_object('status','scheduled','dueAt',period.market_end_at);
  END IF;
  IF gridex_received_sources.legacy_end_authority_v1(p_company_id,source.id) IS NOT TRUE THEN
    RETURN identity||'{"status":"not_applicable","reason":"legacy_end_authority_unavailable"}';
  END IF;
  SELECT mapping.case_id INTO recorded_id FROM gridex_received_sources.legacy_supply_end_cases mapping
    WHERE mapping.company_id=p_company_id AND mapping.source_message_id=source.id AND mapping.supply_period_id=period.id;
  SELECT array_agg(c.id ORDER BY c.id) INTO case_ids FROM public.customer_cases c
    WHERE c.company_id=p_company_id AND c.customer_id=period.customer_id AND c.metering_point_id=period.metering_point_id
      AND c.reason_category='final_metering_and_billing' AND c.source IN ('ediel_inbound_state_machine','ediel_supply_end_legacy')
      AND c.metadata->>'source_ediel_message_id'=source.id::text
      AND (c.metadata->>'supply_period_id' IS NULL OR c.metadata->>'supply_period_id'=period.id::text);
  IF coalesce(cardinality(case_ids),0)>1 OR (recorded_id IS NOT NULL AND recorded_id IS DISTINCT FROM case_ids[1]) THEN
    RAISE EXCEPTION 'legacy_end_followup_case_conflict';
  END IF;
  case_id:=case_ids[1];
  IF case_id IS NULL THEN
    INSERT INTO public.customer_cases(company_id,customer_id,site_id,metering_point_id,customer_contract_id,case_type,status,
      priority,title,description,reason_category,next_action,source,metadata,created_by,updated_by,
      source_ediel_message_id,source_business_process)
    SELECT p_company_id,period.customer_id,mp.site_id,period.metering_point_id,
      coalesce(period.customer_contract_id,period.contract_id),'other','open','normal',
      'Leveransen har upphört – slutför mätvärden och fakturering',
      'Ett kvalificerat leveransslut har trätt i kraft.',
      'final_metering_and_billing','Kontrollera slutmätvärden och faktureringsberedskap.','ediel_supply_end_legacy',
      jsonb_build_object('review_intent','final_metering_and_billing','source_ediel_message_id',source.id,
        'supply_period_id',period.id,'market_end_at',period.market_end_at),
      p_actor_user_id,p_actor_user_id,source.id,'supply_termination'
    FROM public.metering_points mp WHERE mp.company_id=p_company_id AND mp.id=period.metering_point_id
    RETURNING id INTO STRICT case_id;
  END IF;
  INSERT INTO gridex_received_sources.legacy_supply_end_cases(company_id,source_message_id,supply_period_id,case_id)
    VALUES(p_company_id,source.id,period.id,case_id) ON CONFLICT DO NOTHING;
  RETURN identity||jsonb_build_object('status',CASE WHEN case_ids[1] IS NULL THEN 'created' ELSE 'existing' END,'caseId',case_id);
END
$legacy_case$;
REVOKE ALL ON FUNCTION public.gridex_project_legacy_supply_end_followup_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_project_legacy_supply_end_followup_v1(uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.gridex_list_due_legacy_supply_end_followups_v1(p_company_id uuid,p_actor_user_id uuid)
RETURNS TABLE(company_id uuid,source_message_id uuid,supply_period_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC'
AS $legacy_due$
DECLARE
  scan_key text:='legacy:'||coalesce(p_company_id::text,'all')||':'||p_actor_user_id::text;
  cursor_row gridex_received_sources.supply_end_followup_scan_positions%rowtype;
  selected record;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS(
    SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active'
  ) OR NOT EXISTS(
    SELECT FROM public.company_memberships cm
    WHERE cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL
      AND (p_company_id IS NULL OR cm.company_id=p_company_id)
      AND public.gridex_actor_has_company_permission(p_actor_user_id,cm.company_id,'metering.write') IS TRUE
  ) THEN RETURN; END IF;
  INSERT INTO gridex_received_sources.supply_end_followup_scan_positions(scope_key) VALUES(scan_key) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT cursor_row FROM gridex_received_sources.supply_end_followup_scan_positions
    WHERE scope_key=scan_key FOR UPDATE;
  FOR pass IN 1..2 LOOP
    WITH eligible AS MATERIALIZED (
      SELECT DISTINCT cm.company_id
      FROM public.company_memberships cm
      WHERE cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL
        AND (p_company_id IS NULL OR cm.company_id=p_company_id)
        AND public.gridex_actor_has_company_permission(p_actor_user_id,cm.company_id,'metering.write') IS TRUE
    )
    SELECT p.company_id,p.source_end_message_id,p.id,p.market_end_at INTO selected
    FROM eligible
    JOIN public.customer_supply_periods p ON p.company_id=eligible.company_id
    JOIN gridex_received_sources.supply_source_transitions transition
      ON transition.company_id=p.company_id AND transition.source_message_id=p.source_end_message_id
    WHERE p.status='ended' AND isfinite(p.market_end_at) AND p.market_end_at<=now()
      AND transition.source_code='Z05'
      AND (cursor_row.last_end_at IS NULL OR (p.market_end_at,p.id)>(cursor_row.last_end_at,cursor_row.last_receipt))
      AND NOT EXISTS(SELECT FROM gridex_received_sources.legacy_supply_end_cases projected
        WHERE projected.company_id=p.company_id AND projected.source_message_id=p.source_end_message_id
          AND projected.supply_period_id=p.id)
      AND NOT EXISTS(SELECT FROM gridex_received_sources.supply_object_partitions own
        WHERE own.company_id=p.company_id AND own.source_message_id=p.source_end_message_id)
      AND NOT EXISTS(SELECT FROM gridex_received_sources.supply_object_effect_receipts own
        WHERE own.company_id=p.company_id AND own.source_message_id=p.source_end_message_id)
      AND NOT EXISTS(SELECT FROM gridex_ediel_retention.blob_tombstones gone
        WHERE gone.company_id=p.company_id AND gone.message_id=p.source_end_message_id)
    ORDER BY p.market_end_at,p.id LIMIT 1;
    EXIT WHEN selected.id IS NOT NULL OR cursor_row.last_end_at IS NULL;
    cursor_row.last_end_at:=NULL;
    cursor_row.last_receipt:=NULL;
  END LOOP;
  UPDATE gridex_received_sources.supply_end_followup_scan_positions
    SET last_end_at=selected.market_end_at,last_receipt=selected.id WHERE scope_key=scan_key;
  IF selected.id IS NOT NULL THEN
    RETURN QUERY SELECT selected.company_id,selected.source_end_message_id,selected.id;
  END IF;
END
$legacy_due$;
REVOKE ALL ON FUNCTION public.gridex_list_due_legacy_supply_end_followups_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_list_due_legacy_supply_end_followups_v1(uuid,uuid) TO service_role;

-- The immutable retraction transition supplies a lookup for prior source
-- versions even if a later end and second retraction update the same period.
CREATE TABLE gridex_received_sources.supply_end_retraction_lookup(
  company_id uuid NOT NULL,
  supply_period_id uuid NOT NULL,
  end_source_id uuid NOT NULL,
  end_version text NOT NULL,
  cancellation_id uuid NOT NULL,
  PRIMARY KEY(company_id,supply_period_id,end_source_id,end_version,cancellation_id)
);
ALTER TABLE gridex_received_sources.supply_end_retraction_lookup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_received_sources.supply_end_retraction_lookup FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.index_supply_end_retraction_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $cancellation_lookup$
BEGIN
  IF NEW.source_objects @> '[{"reason":"Z24"}]'::jsonb THEN
    INSERT INTO gridex_received_sources.supply_end_retraction_lookup(
      company_id,supply_period_id,end_source_id,end_version,cancellation_id
    )
    SELECT NEW.company_id,(previous->>'id')::uuid,(previous->>'source_end_message_id')::uuid,
      previous->>'market_state_version',NEW.source_message_id
    FROM jsonb_array_elements(NEW.previous_states) previous
    JOIN LATERAL jsonb_array_elements(NEW.resulting_states) after ON after->>'id'=previous->>'id'
    WHERE previous->>'company_id'=NEW.company_id::text AND previous->>'status'='ended'
      AND pg_input_is_valid(previous->>'id','uuid') AND pg_input_is_valid(previous->>'source_end_message_id','uuid')
      AND pg_input_is_valid(previous->>'market_state_version','bigint')
      AND after#>>'{metadata,endCancellationSource}'=NEW.source_message_id::text
      AND after->>'source_end_message_id' IS NULL
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END
$cancellation_lookup$;
REVOKE ALL ON FUNCTION gridex_received_sources.index_supply_end_retraction_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER gridex_index_supply_end_retraction_after_insert
AFTER INSERT ON gridex_received_sources.supply_source_transitions
FOR EACH ROW WHEN (NEW.source_code='Z05') EXECUTE FUNCTION gridex_received_sources.index_supply_end_retraction_v1();

CREATE FUNCTION gridex_received_sources.supply_end_retracted_v1(
  p_company_id uuid,p_customer_id uuid,p_point_id uuid,p_source_id uuid,p_period_id uuid,p_version text,p_cutoff text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC'
AS $retracted$
  SELECT EXISTS(
    SELECT FROM public.customer_supply_periods period
    JOIN public.ediel_messages origin
      ON origin.id=p_source_id AND origin.company_id=period.company_id
    JOIN gridex_received_sources.supply_source_transitions ended
      ON ended.source_message_id=origin.id AND ended.company_id=period.company_id
      AND ended.source_code='Z05' AND ended.payload_hash=encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex')
    JOIN LATERAL (
      SELECT entry.cancellation_id FROM gridex_received_sources.supply_end_retraction_lookup entry
      WHERE entry.company_id=period.company_id AND entry.supply_period_id=period.id
        AND entry.end_source_id=origin.id AND (p_version IS NULL OR entry.end_version=p_version)
      UNION
      SELECT CASE WHEN pg_input_is_valid(period.metadata->>'endCancellationSource','uuid')
        THEN (period.metadata->>'endCancellationSource')::uuid END
    ) candidates ON true
    JOIN public.ediel_messages cancellation ON cancellation.id=candidates.cancellation_id
      AND cancellation.company_id=period.company_id AND cancellation.environment=origin.environment
    JOIN gridex_received_sources.supply_source_transitions restored
      ON restored.source_message_id=cancellation.id AND restored.company_id=period.company_id
      AND restored.source_code='Z05' AND restored.payload_hash=encode(sha256(convert_to(cancellation.raw_payload,'UTF8')),'hex')
    CROSS JOIN LATERAL jsonb_array_elements(ended.resulting_states) saved
    WHERE period.company_id=p_company_id AND period.id=p_period_id
      AND period.customer_id=p_customer_id AND period.metering_point_id=p_point_id
      AND origin.direction='inbound' AND origin.message_family='PRODAT' AND origin.message_code='Z05'
      AND cancellation.direction='inbound' AND cancellation.message_family='PRODAT' AND cancellation.message_code='Z05'
      AND NOT EXISTS(SELECT FROM gridex_ediel_retention.blob_tombstones gone
        WHERE gone.company_id=p_company_id AND gone.message_id IN (origin.id,cancellation.id))
      AND saved->>'id'=p_period_id::text AND saved->>'company_id'=p_company_id::text
      AND saved->>'customer_id'=p_customer_id::text AND saved->>'metering_point_id'=p_point_id::text
      AND saved->>'source_end_message_id'=origin.id::text
      AND saved->>'market_state_version'=coalesce(p_version,saved->>'market_state_version')
      AND (saved->>'status' IN ('ending','ended')) IS TRUE
      AND CASE WHEN pg_input_is_valid(saved->>'market_end_at','timestamptz')
        THEN (saved->>'market_end_at')::timestamptz<=now()
          AND (p_cutoff IS NULL OR CASE WHEN pg_input_is_valid(p_cutoff,'timestamptz')
            THEN (saved->>'market_end_at')::timestamptz=p_cutoff::timestamptz ELSE false END) ELSE false END
      AND EXISTS(SELECT FROM jsonb_array_elements(restored.source_objects) wire
        WHERE wire->>'reason'='Z24' AND gridex_received_sources.permission_time_v1(wire->>'end')=(saved->>'market_end_at')::timestamptz)
      AND EXISTS(SELECT FROM jsonb_array_elements(restored.previous_states) previous
        WHERE previous->>'id'=p_period_id::text AND previous->>'status'='ended'
          AND (previous-ARRAY['updated_at','status'])=(saved-ARRAY['updated_at','status']))
      AND EXISTS(SELECT FROM jsonb_array_elements(restored.resulting_states) after
        WHERE after->>'id'=p_period_id::text AND after->>'company_id'=p_company_id::text
          AND after->>'customer_id'=p_customer_id::text AND after->>'metering_point_id'=p_point_id::text
          AND after#>>'{metadata,endCancellationSource}'=cancellation.id::text
          AND after->>'source_end_message_id' IS NULL AND after->>'market_end_at' IS NULL
          AND after->>'status' IN ('active','confirmed_by_grid_owner','ending')
          AND (after->>'market_state_version')::bigint=(saved->>'market_state_version')::bigint+1)
  );
$retracted$;
REVOKE ALL ON FUNCTION gridex_received_sources.supply_end_retracted_v1(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_read_supply_end_task_review_v1(p_company_id uuid,p_task_ids uuid[])
RETURNS TABLE(task_id uuid,company_id uuid,customer_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC'
AS $tasks$
BEGIN
  IF p_company_id IS NULL OR p_task_ids IS NULL OR cardinality(p_task_ids)>200 THEN
    RAISE EXCEPTION 'supply_end_task_review_scope_required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  SELECT task.id,task.company_id,task.customer_id
  FROM public.customer_operation_tasks task
  WHERE task.company_id=p_company_id AND task.id=ANY(p_task_ids) AND task.customer_id IS NOT NULL
    AND task.task_type='final_invoice_pending'
    AND task.status IN ('open','in_progress','blocked','new','pending','action_required','pending_review')
    AND task.metadata->>'end_key'='source-end:'||(task.metadata->>'supply_period_id')||':'||(task.metadata->>'supply_end_date')
    AND CASE WHEN pg_input_is_valid(task.metadata->>'source_end_message_id','uuid')
        AND pg_input_is_valid(task.metadata->>'supply_period_id','uuid')
        AND task.metadata->>'market_state_version' IS NOT NULL AND task.metadata->>'market_end_at' IS NOT NULL
      THEN gridex_received_sources.supply_end_retracted_v1(task.company_id,task.customer_id,task.metering_point_id,
        (task.metadata->>'source_end_message_id')::uuid,(task.metadata->>'supply_period_id')::uuid,
        task.metadata->>'market_state_version',task.metadata->>'market_end_at')
      ELSE false END;
END
$tasks$;
REVOKE ALL ON FUNCTION public.gridex_read_supply_end_task_review_v1(uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_supply_end_task_review_v1(uuid,uuid[]) TO service_role;

CREATE FUNCTION public.gridex_read_supply_end_followup_disposition_v1(p_company_id uuid,p_case_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC'
AS $cases$
  SELECT jsonb_build_object('caseId',c.id,'sourceMessageId',binding.source_message_id,'status','review_required')
  FROM public.customer_cases c
  JOIN LATERAL (
    SELECT legacy.source_message_id,legacy.supply_period_id
    FROM gridex_received_sources.legacy_supply_end_cases legacy
    WHERE legacy.company_id=c.company_id AND legacy.case_id=c.id
    UNION
    SELECT own.source_message_id,own.supply_period_id
    FROM gridex_received_sources.supply_end_followups own
    WHERE own.company_id=c.company_id AND own.case_id=c.id
    UNION
    SELECT transition.source_message_id,(min(saved->>'id'))::uuid
    FROM gridex_received_sources.supply_source_transitions transition
    CROSS JOIN LATERAL jsonb_array_elements(transition.resulting_states) saved
    WHERE c.source='ediel_inbound_state_machine' AND transition.company_id=c.company_id
      AND transition.source_message_id::text=c.metadata->>'source_ediel_message_id'
      AND saved->>'customer_id'=c.customer_id::text AND saved->>'metering_point_id'=c.metering_point_id::text
      AND saved->>'source_end_message_id'=transition.source_message_id::text
      AND pg_input_is_valid(saved->>'id','uuid')
    GROUP BY transition.source_message_id HAVING count(*)=1
  ) binding ON true
  WHERE c.id=p_case_id AND c.company_id=p_company_id
    AND c.reason_category='final_metering_and_billing'
    AND c.metadata->>'source_ediel_message_id'=binding.source_message_id::text
    AND gridex_received_sources.supply_end_retracted_v1(c.company_id,c.customer_id,c.metering_point_id,
      binding.source_message_id,binding.supply_period_id,NULL,NULL);
$cases$;
REVOKE ALL ON FUNCTION public.gridex_read_supply_end_followup_disposition_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_supply_end_followup_disposition_v1(uuid,uuid) TO service_role;

-- An immediate qualified Z05 end already writes a task in the source
-- transaction. Retain the same dedupe key and attach the source identity for
-- readback. The transition verification runs on reads, after this commit.
DO $task_source$
DECLARE definition text;
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
      WHERE oid='public.gridex_supply_end_followup_v1()'::regprocedure)
      IS DISTINCT FROM '93eeabfd20034cc6c61350b632c897047f2abb8856c111a70dc781d08afb09fc' THEN
    RAISE EXCEPTION 'legacy_end_task_preimage_changed';
  END IF;
  SELECT pg_get_functiondef('public.gridex_supply_end_followup_v1()'::regprocedure) INTO STRICT definition;
  definition:=replace(definition,$old$    IF v_completed_end_source IS NULL THEN RETURN NEW; END IF;
  END IF;$old$,$new$    IF v_completed_end_source IS NULL THEN RETURN NEW; END IF;
  ELSIF NEW.market_end_at IS NOT NULL AND NEW.market_state_version IS NOT NULL THEN
    SELECT source.id INTO v_completed_end_source FROM public.ediel_messages source
    WHERE source.id=NEW.source_end_message_id AND source.company_id=NEW.company_id
      AND source.direction='inbound' AND source.message_family='PRODAT' AND source.message_code='Z05';
  END IF;$new$);
  EXECUTE definition;
END
$task_source$;
