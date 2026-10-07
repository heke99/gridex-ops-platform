-- A genuine generic E/death original has its own current-source owner. Qualify
-- that owner before the competing life-event/certification reader returns NULL;
-- the existing generic send consumer still supplies the business authority.
DO $forward$
DECLARE
 target regprocedure := 'gridex_customer_life_events.require_current_v1(uuid,uuid,uuid,text)'::regprocedure;
 original_definition text;
 anchor text := E' IF m.environment=''test'' AND m.execution_context_snapshot->>''sourceQualifiedPositiveFixtureWitnessId''';
 bridge text := $body$
 IF EXISTS(SELECT FROM gridex_requested_changes.origins generic_origin
   LEFT JOIN gridex_requested_changes.events generic_event ON generic_event.id=generic_origin.event_id
   WHERE (generic_origin.message_id=m.id OR generic_origin.intent_id=m.intent_id)
   AND (generic_event.variant='E' OR generic_origin.basis->>'variant'='E')) THEN
  IF phase IS NULL OR phase NOT IN('prepare','send') THEN
   RAISE EXCEPTION 'requested_change_execution_phase_required';
  END IF;
  IF (SELECT count(*) FROM gridex_requested_changes.origins generic_origin
    JOIN gridex_requested_changes.events generic_event ON generic_event.id=generic_origin.event_id
    WHERE generic_origin.company_id=c AND generic_origin.message_id=m.id AND generic_origin.intent_id=m.intent_id
    AND generic_event.company_id=c AND generic_event.id::text=m.source_operation_id::text
    AND generic_event.variant='E' AND generic_event.event_kind='death') IS DISTINCT FROM 1 THEN
   RAISE EXCEPTION 'requested_change_original_generic_binding_required';
  END IF;
  PERFORM gridex_requested_changes.require_message_v1(m,actor,
    CASE phase WHEN 'send' THEN 'communication.send' ELSE 'communication.write' END);
  IF m.immutable_rendered_at IS NULL
   OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
   OR (SELECT generic_origin.payload_hash FROM gridex_requested_changes.origins generic_origin
     WHERE generic_origin.company_id=c AND generic_origin.message_id=m.id AND generic_origin.intent_id=m.intent_id)
     IS DISTINCT FROM m.immutable_payload_hash THEN
   RAISE EXCEPTION 'requested_change_original_generic_payload_required';
  END IF;
  PERFORM gridex_ediel_transport.require_message_intent_v1(m);
  RETURN NULL;
 END IF;
 IF m.environment='test' AND m.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId'$body$;
 metadata_before jsonb;
 legacy_before jsonb;
 public_before jsonb;
BEGIN
 SELECT pg_get_functiondef(target),to_jsonb(p)-'prosrc' INTO original_definition,metadata_before FROM pg_proc p WHERE p.oid=target;
 SELECT to_jsonb(p) INTO legacy_before FROM pg_proc p WHERE p.oid='gridex_customer_life_events.require_before_certification_v1(uuid,uuid,uuid,text)'::regprocedure;
 SELECT to_jsonb(p) INTO public_before FROM pg_proc p WHERE p.oid=to_regprocedure('public.ediel_customer_life_event_message_basis_v1(uuid,uuid,uuid)');
 IF (length(original_definition)-length(replace(original_definition,anchor,'')))/length(anchor) IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'requested_change_generic_bridge_single_legacy_anchor_required';
 END IF;
 EXECUTE replace(original_definition,anchor,bridge);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata_before
 OR (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid='gridex_customer_life_events.require_before_certification_v1(uuid,uuid,uuid,text)'::regprocedure) IS DISTINCT FROM legacy_before
 OR (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid=to_regprocedure('public.ediel_customer_life_event_message_basis_v1(uuid,uuid,uuid)')) IS DISTINCT FROM public_before THEN
  RAISE EXCEPTION 'requested_change_generic_bridge_metadata_preservation_required';
 END IF;
END $forward$;
