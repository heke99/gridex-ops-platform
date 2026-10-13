-- Scaffolded EMPTY by official Supabase CLI 2.81.3; forward-only component.
-- Late negative ACK diagnostics remain intact. No activation or restoration.
BEGIN;

CREATE FUNCTION gridex_ack_authority.apply_switch_transition_v1(
 p_company uuid, p_environment text, p_actor uuid, p_ack uuid, p_ack_hash text,
 p_source uuid, p_source_hash text, p_switch uuid, p_negative_status text, p_expected_request text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE
 receipt jsonb; expected jsonb; original public.ediel_messages%rowtype;
 binding gridex_received_sources.switch_originals%rowtype;
 current_request public.supplier_switch_requests%rowtype;
 confirmation gridex_received_sources.normal_switch_confirmations%rowtype;
 wire jsonb; own jsonb; witness_count bigint; witness jsonb; changed boolean:=false;
 disposition text:='not_applicable'; effect jsonb;
 transit_columns CONSTANT text[]:=ARRAY['status','submitted_at','updated_at','updated_by'];
 dispatch_columns CONSTANT text[]:=ARRAY['status','submitted_at','updated_at','updated_by',
  'contract_id','customer_contract_id','readiness_snapshot','readiness_checked_at'];
 readiness_columns CONSTANT text[]:=ARRAY['ready','contract_id','lifecycle_stage','checked_at'];
 confirmed_columns CONSTANT text[]:=ARRAY['status','completed_at','external_reference','updated_at','updated_by'];
BEGIN
 IF p_company IS NULL OR p_actor IS NULL OR p_ack IS NULL OR p_source IS NULL OR p_switch IS NULL
  OR (p_environment IN('test','production')) IS NOT TRUE OR (p_negative_status IN('failed','rejected')) IS NOT TRUE
  OR (p_ack_hash~'^[a-f0-9]{64}$') IS NOT TRUE OR (p_source_hash~'^[a-f0-9]{64}$') IS NOT TRUE
  OR p_expected_request IS NULL OR octet_length(p_expected_request)>262144 THEN
  RAISE EXCEPTION 'ack_switch_transition_scope_required' USING ERRCODE='22023';
 END IF;
 expected:=p_expected_request::jsonb;
 IF jsonb_typeof(expected) IS DISTINCT FROM 'object' OR expected->>'id' IS DISTINCT FROM p_switch::text
  OR expected->>'company_id' IS DISTINCT FROM p_company::text THEN
  RAISE EXCEPTION 'ack_switch_transition_scope_required' USING ERRCODE='22023';
 END IF;
 -- Common graph prefix FIRST. Stabilizes current company/membership/RBAC
 -- before row locks; actual reader then takes sealed source -> ACK FOR SHARE.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 PERFORM gridex_ack_authority.require_physical_actor_v1(p_company,p_actor,true);
 receipt:=gridex_ack_authority.read_committed_by_source_v2(p_company,p_environment,p_ack,p_actor,p_ack_hash);
 -- Untrusted pins and public metadata never choose a recipient. An immutable
 -- original binding is required, including its own object/pre/postimages.
 IF receipt->>'kind'='exact_receipt' AND receipt->>'sourceMessageId'=p_source::text
  AND receipt->>'companyId'=p_company::text AND receipt->>'environment'=p_environment
  AND receipt->>'ackMessageId'=p_ack::text AND receipt->>'ackPayloadHash'=p_ack_hash
  AND receipt#>'{result,version}'='1'::jsonb AND receipt#>>'{result,outcome}'='negative'
  AND receipt#>'{result,wholeSourceRejected}'='true'::jsonb AND receipt#>'{result,sourceAccepted}'='false'::jsonb THEN
  SELECT * INTO original FROM public.ediel_messages WHERE id=p_source;
  SELECT * INTO binding FROM gridex_received_sources.switch_originals WHERE message_id=p_source AND company_id=p_company;
  wire:=gridex_received_sources.switch_origin_wire_v1(original.raw_payload);own:=wire#>'{objects,0}';
  IF original.id IS NOT NULL AND original.company_id=p_company AND original.environment=p_environment
   AND original.direction='outbound' AND original.message_standard='edifact' AND original.message_family='PRODAT' AND original.message_code='Z03'
   AND original.immutable_payload_hash=p_source_hash AND p_source_hash=encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex')
   AND original.immutable_rendered_at IS NOT NULL AND original.message_sent_at IS NOT NULL
   AND binding.message_id=original.id AND binding.switch_id=p_switch AND binding.intent_id=original.intent_id
   AND binding.outbound_request_id=original.outbound_request_id AND binding.payload_hash=p_source_hash
   AND original.switch_request_id=p_switch AND original.source_operation_id=p_switch::text
   AND wire IS NOT NULL AND binding.original_object=own AND own->>'reason' IN('Z22','Z23')
   AND binding.contract_hash~'^[a-f0-9]{64}$'
   AND binding.previous_switch->>'id'=p_switch::text AND binding.previous_switch->>'company_id'=p_company::text
   AND binding.previous_switch->'outbound_z03_message_id'='null'::jsonb
   AND (binding.previous_switch-ARRAY['status','outbound_z03_message_id','rff_li_reference','updated_at','updated_by'])
    =(binding.resulting_switch-ARRAY['status','outbound_z03_message_id','rff_li_reference','updated_at','updated_by'])
   AND binding.resulting_switch->>'id'=p_switch::text AND binding.resulting_switch->>'company_id'=p_company::text
   AND binding.resulting_switch->>'status'='prepared' AND binding.resulting_switch->>'outbound_z03_message_id'=p_source::text
   AND binding.resulting_switch->>'rff_li_reference'=own->>'li'
   AND binding.resulting_switch->>'customer_id'=original.customer_id::text
   AND binding.resulting_switch->>'metering_point_id'=original.metering_point_id::text
   AND coalesce(binding.resulting_switch->>'site_id',binding.resulting_switch->>'customer_site_id')=original.site_id::text
   AND coalesce(binding.resulting_switch->>'contract_id',binding.resulting_switch->>'customer_contract_id')=binding.contract_id::text THEN
   -- Original/source locks are already held. Never reverse switch -> original,
   -- and never acquire mutable Z04/supply/contract locks under the ACK original.
   SELECT * INTO current_request FROM public.supplier_switch_requests WHERE id=p_switch AND company_id=p_company FOR UPDATE;
   IF current_request.id IS NOT NULL THEN
    IF current_request.status IN('failed','rejected','cancelled','cancelled_before_start') THEN disposition:='already_terminal';
    ELSIF current_request.lifecycle_blocked IS FALSE AND current_request.paused_at IS NULL AND current_request.paused_by IS NULL
     AND current_request.pause_reason IS NULL AND current_request.lifecycle_block_source IS NULL AND current_request.lifecycle_block_id IS NULL
     AND current_request.outbound_z03_message_id=p_source THEN
     -- Immutable historical witness only. Read again AFTER the locked current
     -- recipient: discovery before blocking cannot overwrite a new confirmation.
     SELECT count(*),jsonb_agg(to_jsonb(n))->0 INTO witness_count,witness
     FROM gridex_received_sources.normal_switch_confirmations n
     JOIN gridex_received_sources.sources cap ON cap.source_message_id=n.source_message_id AND cap.company_id=n.company_id
      AND cap.environment=p_environment AND cap.origin='database_insert' AND cap.message_code='Z04'
      AND cap.source_received_at IS NOT NULL AND cap.received_context IS NOT NULL
      AND cap.payload_hash=encode(sha256(convert_to(cap.raw_payload,'UTF8')),'hex')
     JOIN public.ediel_messages z ON z.id=cap.source_message_id AND z.company_id=cap.company_id AND z.environment=cap.environment
      AND z.direction='inbound' AND z.message_standard='edifact' AND z.message_family='PRODAT' AND z.message_code='Z04'
      AND z.raw_payload=cap.raw_payload AND z.immutable_payload_hash=cap.payload_hash
     JOIN gridex_received_sources.supply_source_transitions t ON t.source_message_id=n.source_message_id AND t.company_id=n.company_id
      AND t.source_code='Z04' AND t.payload_hash=cap.payload_hash AND n.switch_id=ANY(t.qualified_switch_ids)
      AND t.source_objects @> jsonb_build_array(n.source_object) AND t.resulting_states @> jsonb_build_array(n.confirmed_period)
     WHERE n.company_id=p_company AND n.switch_id=p_switch AND n.original_message_id=p_source AND n.original_payload_hash=p_source_hash
      AND n.contract_id=binding.contract_id AND n.protected_contract_hash=binding.contract_hash
      AND n.source_object->>'li'=own->>'li' AND n.source_object->>'point'=own->>'point'
      AND n.source_object->>'identityAgency'=own->>'identityAgency' AND n.source_object->>'customerIdentity'=own->>'customerIdentity'
      AND n.source_object->>'start'=own->>'start' AND n.source_object->>'reason'=own->>'reason'
      AND n.confirmed_period->>'id'=n.period_id::text AND n.confirmed_period->>'company_id'=p_company::text
      AND n.confirmed_period->>'source_message_id'=n.source_message_id::text AND n.confirmed_period->>'source_switch_request_id'=p_switch::text
      AND n.confirmed_period->>'source_process'='supplier_switch_confirmation' AND n.confirmed_period->>'status'='confirmed_by_grid_owner'
      AND n.confirmed_period->'market_start_at'=to_jsonb(n.market_start_at)
      AND coalesce(n.confirmed_period->>'contract_id',n.confirmed_period->>'customer_contract_id')=n.contract_id::text
      AND n.confirmed_switch->>'id'=p_switch::text AND n.confirmed_switch->>'company_id'=p_company::text
      AND n.confirmed_switch->>'outbound_z03_message_id'=p_source::text AND n.confirmed_switch->>'inbound_z04_message_id'=n.source_message_id::text
      AND n.confirmed_switch->>'status'='accepted'
      AND n.confirmed_switch->>'customer_id'=n.confirmed_period->>'customer_id'
      AND n.confirmed_switch->>'metering_point_id'=n.confirmed_period->>'metering_point_id'
      AND coalesce(n.confirmed_switch->>'contract_id',n.confirmed_switch->>'customer_contract_id')=n.contract_id::text;
     IF witness_count=1 AND (SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations n
      WHERE n.company_id=p_company AND (n.switch_id=p_switch OR n.original_message_id=p_source))=1 THEN
      SELECT * INTO confirmation FROM jsonb_populate_record(NULL::gridex_received_sources.normal_switch_confirmations,witness);
      IF current_request.status IN('accepted','completed')
       AND (to_jsonb(current_request)-confirmed_columns)=(confirmation.confirmed_switch-confirmed_columns)
       AND (current_request.status='accepted' OR EXISTS(SELECT FROM gridex_received_sources.normal_supply_activations a
        WHERE a.company_id=p_company AND a.period_id=confirmation.period_id AND a.source_message_id=confirmation.source_message_id
         AND a.previous_period=confirmation.confirmed_period AND a.result->>'supplier_switch_request_id'=p_switch::text
         AND a.result->>'supply_period_id'=confirmation.period_id::text AND a.result->>'contract_id'=binding.contract_id::text)) THEN
       disposition:='preserved_confirmation';
      END IF;
     ELSIF witness_count=0 AND NOT EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations n
       WHERE n.company_id=p_company AND (n.switch_id=p_switch OR n.original_message_id=p_source))
      AND current_request.status IN('prepared','queued','submitted','sent','waiting','waiting_response','waiting_for_z04','awaiting_confirmation')
      AND current_request.inbound_z04_message_id IS NULL AND current_request.confirmed_start_date IS NULL
      AND current_request.completed_at IS NULL AND current_request.failed_at IS NULL AND current_request.failure_reason IS NULL
      AND (
       (current_request.status NOT IN('queued','submitted','sent')
        AND (to_jsonb(current_request)-transit_columns)=(binding.resulting_switch-transit_columns))
       OR (
        -- The existing dispatch trigger normalizes BOTH aliases and overlays
        -- these four readiness keys. Accept only that exact structural delta;
        -- aliases still derive from the private immutable original contract.
        -- Mutable readiness diagnostics can inhibit, never supply authority.
        current_request.contract_id=binding.contract_id AND current_request.customer_contract_id=binding.contract_id
        AND current_request.readiness_checked_at IS NOT NULL
        AND jsonb_typeof(current_request.readiness_snapshot)='object'
        AND current_request.readiness_snapshot->'ready'='true'::jsonb
        AND current_request.readiness_snapshot->>'contract_id'=binding.contract_id::text
        AND jsonb_typeof(current_request.readiness_snapshot->'lifecycle_stage')='string'
        AND nullif(current_request.readiness_snapshot->>'lifecycle_stage','') IS NOT NULL
        AND jsonb_typeof(current_request.readiness_snapshot->'checked_at')='string'
        AND current_request.readiness_snapshot->>'checked_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
        AND (current_request.readiness_snapshot-readiness_columns)=
         ((CASE WHEN jsonb_typeof(binding.resulting_switch->'readiness_snapshot')='object'
           THEN binding.resulting_switch->'readiness_snapshot' ELSE '{}'::jsonb END)-readiness_columns)
        AND (to_jsonb(current_request)-dispatch_columns)=(binding.resulting_switch-dispatch_columns)
       )
      ) THEN
      IF to_jsonb(current_request) IS DISTINCT FROM expected THEN disposition:='stale_preimage';
      ELSE
       effect:=public.gridex_transition_supplier_switch_v1(p_company,p_switch,
        jsonb_build_object('status',p_negative_status,'failure_reason',receipt#>>'{result,failureReason}','failed_at',now(),'updated_by',p_actor),
        jsonb_build_object('event_type','ack_'||p_negative_status,'event_status','error','message',receipt#>>'{result,failureReason}',
         'created_by',p_actor,'payload',jsonb_build_object('ackMessageId',p_ack,'ackPayloadHash',p_ack_hash,
          'sourceMessageId',p_source,'sourcePayloadHash',p_source_hash)));
       SELECT * INTO current_request FROM public.supplier_switch_requests WHERE id=p_switch AND company_id=p_company;
       IF effect#>'{request}' IS DISTINCT FROM to_jsonb(current_request) OR current_request.status IS DISTINCT FROM p_negative_status THEN
        RAISE EXCEPTION 'ack_switch_transition_effect_conflict';
       END IF;
       disposition:='mutated_failure';changed:=true;
      END IF;
     END IF;
    END IF;
   END IF;
  END IF;
 END IF;
 -- Only expose a current own-company, exact pinned recipient. No missing proof
 -- manufactures authority; reading this row does not enable a negative effect.
 IF current_request.id IS NULL THEN
  SELECT * INTO current_request FROM public.supplier_switch_requests WHERE id=p_switch AND company_id=p_company;
 END IF;
 RETURN jsonb_build_object('version',1,'companyId',p_company,'environment',p_environment,'actorUserId',p_actor,
  'ackMessageId',p_ack,'ackPayloadHash',p_ack_hash,'sourceMessageId',p_source,'sourcePayloadHash',p_source_hash,
  'switchRequestId',p_switch,'negativeStatus',p_negative_status,
  'expectedRequestHash',encode(sha256(convert_to(p_expected_request,'UTF8')),'hex'),
  'disposition',disposition,'changed',changed,'request',CASE WHEN current_request.id IS NULL THEN NULL ELSE to_jsonb(current_request) END);
END
$function$;

CREATE FUNCTION public.gridex_apply_inbound_ack_switch_transition_v1(
 p_company_id uuid, p_environment text, p_actor_user_id uuid, p_ack_message_id uuid, p_ack_payload_hash text,
 p_source_message_id uuid, p_source_payload_hash text, p_switch_request_id uuid, p_negative_status text, p_expected_request text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
 SELECT gridex_ack_authority.apply_switch_transition_v1(p_company_id,p_environment,p_actor_user_id,p_ack_message_id,
  p_ack_payload_hash,p_source_message_id,p_source_payload_hash,p_switch_request_id,p_negative_status,p_expected_request)
$function$;

REVOKE ALL ON FUNCTION gridex_ack_authority.apply_switch_transition_v1(uuid,text,uuid,uuid,text,uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_apply_inbound_ack_switch_transition_v1(uuid,text,uuid,uuid,text,uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_apply_inbound_ack_switch_transition_v1(uuid,text,uuid,uuid,text,uuid,text,uuid,text,text) TO service_role;
COMMIT;
