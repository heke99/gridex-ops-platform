-- Actual CLI forward: a prospective positive P plan agrees with the same
-- canonical owner's functional disposition; no rule or historical result changes.
BEGIN;
DO $owner$ DECLARE definition text;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_received_sources.validate_prodat_responses_v1(text,jsonb,jsonb)'::regprocedure);
 needle:='facts->>''applicationDecision'' IS DISTINCT FROM ''accepted'' OR register_object->>''disposition'' IS DISTINCT FROM ''accepted''';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'prodat_response_functional_parity_derivation_mismatch';END IF;
 EXECUTE replace(definition,needle,'facts->>''applicationDecision'' IS DISTINCT FROM ''accepted'' OR facts->>''functionalDecision'' IS DISTINCT FROM ''accepted'' OR register_object->>''disposition'' IS DISTINCT FROM ''accepted''');
END $owner$;
COMMIT;
