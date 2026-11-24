-- Apply the E66 month owner and record its migration in the same transaction.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_e66_month_owner$
BEGIN
DO $migration$
DECLARE f record; output text;
 declaration constant text := $before$e_state text;e_message text;e_detail text;e_hint text; observation_keys text[]:='{}'; observation_values jsonb[]:='{}';$before$;
 replacement_declaration constant text := $after$e_state text;e_message text;e_detail text;e_hint text; observation_keys text[]:='{}'; observation_values jsonb[]:='{}'; ordinal_keys text[]:='{}'; ordinal_values jsonb[]:='{}';$after$;
 old_lookup constant text := $before$    SELECT value,(value->>'ordinal')::integer INTO STRICT o,ordinal FROM jsonb_array_elements(c->'observations') WHERE (value->>'sourceOrdinal')::integer=source_ordinal;$before$;
 new_lookup constant text := $after$    IF locked AND cardinality(p_values)>=32 AND s.message_code='E66' AND source_ordinal>=0 THEN
     at:=array_position(ordinal_keys,memo_key);hit:=ordinal_values[at];
     IF hit IS NULL THEN
      BEGIN
       WITH entries AS (
        SELECT (value->>'sourceOrdinal')::integer AS source_ordinal,value AS entry
        FROM jsonb_array_elements(c->'observations') AS parts(value)
        WHERE value->>'sourceOrdinal' IS NOT NULL
       ), indexed AS (
        SELECT e.source_ordinal,(array_agg(entry))[1] AS entry
        FROM entries e GROUP BY e.source_ordinal HAVING count(*)=1
       )
       SELECT coalesce(jsonb_object_agg(i.source_ordinal,i.entry),'{}'::jsonb) INTO hit FROM indexed i;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN hit:='{}'::jsonb;
      END;
      ordinal_keys:=array_append(ordinal_keys,memo_key);ordinal_values:=array_append(ordinal_values,hit);
     END IF;
     o:=hit->source_ordinal::text;
     IF o IS NOT NULL THEN ordinal:=(o->>'ordinal')::integer; END IF;
    END IF;
    IF o IS NULL THEN
     SELECT value,(value->>'ordinal')::integer INTO STRICT o,ordinal FROM jsonb_array_elements(c->'observations') WHERE (value->>'sourceOrdinal')::integer=source_ordinal;
    END IF;$after$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
 INTO STRICT f FROM pg_proc p
 WHERE p.oid=to_regprocedure('gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean)');
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'c86e82a8f23d1da7931f0cac784e978e0b5d73f31796fdfa390db3b67e83eff8'
  OR (length(f.prosrc)-length(replace(f.prosrc,declaration,'')))/length(declaration)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,old_lookup,'')))/length(old_lookup)<>1
 THEN RAISE EXCEPTION 'billing_underlay_ordinal_predecessor_changed'; END IF;
 output:=replace(replace(f.prosrc,declaration,replacement_declaration),old_lookup,new_lookup);
 EXECUTE replace(f.definition,f.prosrc,output);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata
  OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM output
 THEN RAISE EXCEPTION 'billing_underlay_ordinal_metadata_changed'; END IF;
END
$migration$;
END
$gridex_e66_month_owner$;
RESET statement_timeout;
RESET lock_timeout;
