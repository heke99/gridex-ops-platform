-- CLI-created forward: inspect the transition system column at its table,
-- and require the admitted own function whenever its prospective facet exists.
-- Existing final ACK bindings and immutable customer response receipts are not
-- rewritten or reselected by this birth-only capture fence.
BEGIN;
DO $patch$
DECLARE body text; old text; replacement text;
BEGIN
 SELECT pg_get_functiondef('gridex_received_sources.capture_customer_primary_response_v1()'::regprocedure) INTO body;
 old:=$old$OR tr.xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)$old$;
 replacement:=$new$OR EXISTS(SELECT FROM gridex_customer_life_events.transitions committed_transition
      WHERE committed_transition.source_message_id=m.id AND committed_transition.company_id=NEW.company_id
       AND committed_transition.xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296))
   OR (EXISTS(SELECT FROM gridex_received_sources.prodat_source_function_facets f
      WHERE f.assessment_id=NEW.canonical_assessment_id)
    AND gridex_received_sources.prodat_source_function_object_accepted_v1(
      NEW.company_id,m.id,NEW.canonical_assessment_id,own->'object') IS NOT TRUE)$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'prodat_customer_primary_commit_fence_contract_changed'; END IF;
 EXECUTE replace(body,old,replacement);
END $patch$;
COMMIT;
