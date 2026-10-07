-- Preserve physical original identifiers required by the existing outgoing
-- source projection and complete arrays used by native object qualification.
-- No authority, historical receipt, parser budget or admission guard changes.
BEGIN;
DO $repair$
DECLARE
 target regprocedure := 'gridex_customer_life_events.wire_partition_v1(text)'::regprocedure;
 definition text;
 before_metadata jsonb;
 after_metadata jsonb;
 old_fragments text[] := ARRAY[
  $old$IF t->>'tag'='UNH' THEN w:=w||jsonb_build_object('family',t#>>'{elements,2,0}','unh',t#>>'{elements,1,0}');END IF;$old$,
  $old$IF t->>'tag'='BGM' THEN w:=w||jsonb_build_object('code',t#>>'{elements,1,0}');END IF;$old$,
  $old$jsonb_build_object('lineIndexes',first_fragment->'lineIndexes'||obj->'lineIndexes','body',first_fragment->'body'||obj->'body')$old$
 ];
 new_fragments text[] := ARRAY[
  $new$IF t->>'tag'='UNB' THEN w:=w||jsonb_build_object('interchange',t#>>'{elements,5,0}');END IF;
  IF t->>'tag'='UNH' THEN w:=w||jsonb_build_object('family',t#>>'{elements,2,0}','unh',t#>>'{elements,1,0}','messageReference',t#>>'{elements,1,0}');END IF;$new$,
  $new$IF t->>'tag'='BGM' THEN w:=w||jsonb_build_object('code',t#>>'{elements,1,0}','bgmId',t#>>'{elements,2,0}');END IF;$new$,
  $new$jsonb_build_object('lineIndexes',(first_fragment->'lineIndexes')||(obj->'lineIndexes'),'body',(first_fragment->'body')||(obj->'body'))$new$
 ];
 i integer;
BEGIN
 SELECT to_jsonb(p)-'prosrc' INTO before_metadata FROM pg_proc p WHERE oid=target;
 definition := pg_get_functiondef(target);
 FOR i IN 1..cardinality(old_fragments) LOOP
  IF (length(definition)-length(replace(definition,old_fragments[i],'')))
     IS DISTINCT FROM length(old_fragments[i]) THEN
   RAISE EXCEPTION 'customer_wire_partition_predecessor_mismatch:%',i;
  END IF;
  definition := replace(definition,old_fragments[i],new_fragments[i]);
 END LOOP;
 -- pg_get_functiondef retains the actual signature and execution attributes;
 -- CREATE OR REPLACE preserves OID, owner and ACL. Fail if any metadata drifts.
 EXECUTE definition;
 SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_proc p WHERE oid=target;
 IF before_metadata IS DISTINCT FROM after_metadata THEN
  RAISE EXCEPTION 'customer_wire_partition_metadata_changed';
 END IF;
END $repair$;
COMMIT;
