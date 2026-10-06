-- The retained requested-change transport consumer predates the genuine
-- life-event original ledger. Qualify that ledger with its existing owner;
-- never substitute certification authority for a reviewed business original.
DO $forward$
DECLARE
 target regprocedure := 'public.ediel_require_requested_change_source_current_before_scope_fence_v1(uuid,uuid)'::regprocedure;
 original_definition text;
 anchor text := E' IF NOT FOUND THEN\n  IF m.environment';
 bridge text := E' IF NOT FOUND THEN\n' || $body$
  IF EXISTS(SELECT FROM gridex_customer_life_events.originals life_original
    WHERE life_original.company_id=p_company_id AND life_original.message_id=m.id) THEN
   SELECT gridex_customer_life_events.require_current_v1(p_company_id,m.id,life_origin.actor_user_id,'prepare') INTO q
    FROM gridex_customer_life_events.originals life_original
    JOIN gridex_customer_life_events.origins life_origin ON life_origin.event_id=life_original.event_id AND life_origin.company_id=life_original.company_id
    WHERE life_original.company_id=p_company_id AND life_original.message_id=m.id;
   IF q#>>'{basis,status}' IS DISTINCT FROM 'authorized' THEN
    RAISE EXCEPTION 'customer_life_event_current_original_scope_changed';
   END IF;
   RETURN;
  END IF;
  IF m.environment$body$;
 metadata_before jsonb;
 wrapper_before jsonb;
BEGIN
 SELECT pg_get_functiondef(target),to_jsonb(p)-'prosrc' INTO original_definition,metadata_before FROM pg_proc p WHERE p.oid=target;
 SELECT to_jsonb(p) INTO wrapper_before FROM pg_proc p WHERE p.oid='public.ediel_require_requested_change_source_current_v1(uuid,uuid)'::regprocedure;
 IF (length(original_definition)-length(replace(original_definition,anchor,'')))/length(anchor) IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'requested_change_current_bridge_single_legacy_anchor_required';
 END IF;
 EXECUTE replace(original_definition,anchor,bridge);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata_before
 OR (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid='public.ediel_require_requested_change_source_current_v1(uuid,uuid)'::regprocedure) IS DISTINCT FROM wrapper_before THEN
  RAISE EXCEPTION 'requested_change_current_bridge_metadata_preservation_required';
 END IF;
END $forward$;
