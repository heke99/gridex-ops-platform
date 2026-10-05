-- Prospective AI exports consume the SAME protected structural snapshot and
-- row/cell equality owner. An accepted review alone does not prove an applied
-- Z06/Z10 effect. Existing immutable originals keep their first replay outcome.
BEGIN;
ALTER FUNCTION gridex_ai_processing.require_original_row_sources_v1(jsonb,timestamptz,public.ediel_message_intents,text,text)
 RENAME TO require_original_row_sources_before_applied_structure_v1;
CREATE FUNCTION gridex_ai_processing.require_original_row_sources_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,raw text,claims text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE refs jsonb;ref jsonb;basis jsonb;state jsonb;base jsonb;address jsonb;source_id text;records text[];cols text[];normalized text;row integer;matched boolean;
BEGIN
 -- Full physical CSV/source/supply/epoch equality remains the existing owner.
 refs:=gridex_ai_processing.require_original_row_sources_before_applied_structure_v1(body,cutoff,i,raw,claims);
 normalized:=replace(raw,E'\r\n',E'\n');IF left(normalized,1)=chr(65279) THEN normalized:=substring(normalized FROM 2);END IF;
 IF right(normalized,1)=E'\n' THEN normalized:=left(normalized,length(normalized)-1);END IF;records:=string_to_array(normalized,E'\n');
 FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
  matched:=false;
  FOR row IN 2..cardinality(records) LOOP
   cols:=string_to_array(records[row],';');
   state:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'sourceMessageId',i,cols[2],cols[3]);
   base:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'baselineSourceMessageId',i,cols[2],cols[3]);
   address:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'addressSourceMessageId',i,cols[2],cols[3]);
   IF state IS NULL OR base IS NULL OR address IS NULL
    OR state#>>'{business,supplyPeriodId}' IS DISTINCT FROM ref->>'supplyPeriodId'
    OR base#>>'{business,supplyPeriodId}' IS DISTINCT FROM ref->>'supplyPeriodId'
    OR address#>>'{business,supplyPeriodId}' IS DISTINCT FROM ref->>'supplyPeriodId' THEN CONTINUE;END IF;
   matched:=true;
   FOR source_id,basis IN SELECT DISTINCT x.id,x.basis FROM (VALUES(ref->>'sourceMessageId',state),(ref->>'baselineSourceMessageId',base),(ref->>'addressSourceMessageId',address)) x(id,basis) LOOP
    -- Z04 is qualified by the sole current normal-supply owner in the full
    -- row binder. Other structural states require their own immutable effect.
    IF basis#>>'{business,wire,messageCode}'='Z04' THEN CONTINUE;END IF;
    IF nullif(basis#>>'{business,meteringPointId}','') IS NULL OR gridex_received_sources.structural_effect_matches_v1(
     i.company_id,i.environment,source_id::uuid,(basis->>'assessmentId')::uuid,i.customer_id,i.customer_site_id,
     (basis#>>'{business,meteringPointId}')::uuid,(ref->>'supplyPeriodId')::uuid,cols[2],cols[3],cutoff) IS NOT TRUE
     THEN RAISE EXCEPTION 'ai_list_applied_structural_source_unconfirmed';END IF;
   END LOOP;
  END LOOP;
  IF NOT matched THEN RAISE EXCEPTION 'ai_list_applied_history_own_scope_unconfirmed';END IF;
 END LOOP;
 RETURN refs;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_original_row_sources_v1(jsonb,timestamptz,public.ediel_message_intents,text,text),
 gridex_ai_processing.require_original_row_sources_before_applied_structure_v1(jsonb,timestamptz,public.ediel_message_intents,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
