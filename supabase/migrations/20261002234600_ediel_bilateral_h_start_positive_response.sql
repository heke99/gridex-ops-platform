-- A received Z04 confirming a bilateral H start is committed by the bilateral
-- owner (gridex_bilateral_prodat.confirm_h_start_v1), which records its own
-- effect receipt in gridex_bilateral_prodat.supply_effect_receipts. The
-- positive-reply reader (gridex_received_sources.committed_supply_effects_v1)
-- only knew the national object partition, so the ERC100 APERAK the guide
-- prescribes for a committed own effect was never authorized
-- (prodat_structural_response_own_effect_unavailable).
--
-- When no national partition exists, the reader now accepts the bilateral H
-- receipt: same company, environment and exact payload, committed in an
-- earlier transaction. It yields one effect per accepted own application object
-- of the current canonical assessment. Every downstream check is unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.committed_h_start_effects_v1(c uuid, source_id uuid, requested integer[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
DECLARE m public.ediel_messages%rowtype;b gridex_bilateral_prodat.supply_effect_receipts%rowtype;application jsonb;effects jsonb:='[]';o jsonb;scope jsonb;first_line integer;raw_hash text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z04' THEN RETURN NULL;END IF;
 SELECT * INTO b FROM gridex_bilateral_prodat.supply_effect_receipts r WHERE r.source_message_id=m.id
  AND r.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296);
 IF b.source_message_id IS NULL THEN RETURN NULL;END IF;
 raw_hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 IF b.company_id IS DISTINCT FROM c OR b.environment IS DISTINCT FROM m.environment OR b.payload_hash IS DISTINCT FROM raw_hash
  OR b.transition_hash IS NULL OR b.transition_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'supply_final_response_source_changed';END IF;
 application:=gridex_received_sources.require_prodat_application_objects_v1(c,m.id);
 IF application->>'headerDecision' IS DISTINCT FROM 'accepted' OR application->>'sourcePayloadHash' IS DISTINCT FROM raw_hash THEN RETURN NULL;END IF;
 FOR o IN SELECT e FROM jsonb_array_elements(application->'objects')e ORDER BY(e#>>'{registers,0,segmentIndex}')::integer LOOP
  IF o->>'applicationDecision' IS DISTINCT FROM 'accepted' THEN CONTINUE;END IF;
  scope:=o-'applicationDecision'-'reasonCodes';first_line:=(scope#>>'{registers,0,segmentIndex}')::integer;
  IF requested IS NOT NULL AND NOT(first_line=ANY(requested)) THEN CONTINUE;END IF;
  effects:=effects||jsonb_build_array(jsonb_build_object('receiptId',m.id,'canonicalAssessmentId',application->>'assessmentId','sourcePayloadHash',b.payload_hash,
   'objectScope',scope,'appliedAt',b.recorded_at,'effectKind','supply','effectFactsHash',b.transition_hash));
 END LOOP;
 IF requested IS NOT NULL AND cardinality(requested)<>jsonb_array_length(effects) THEN RAISE EXCEPTION 'supply_final_response_own_effect_uncommitted';END IF;
 RETURN effects;
END $function$;
REVOKE ALL ON FUNCTION gridex_bilateral_prodat.committed_h_start_effects_v1(uuid,uuid,integer[]) FROM PUBLIC, anon, authenticated;

DO $reader$DECLARE f record;
 needle CONSTANT text:=$n$IF p.source_message_id IS NULL THEN RETURN NULL;END IF;$n$;
 replacement CONSTANT text:=$n$IF p.source_message_id IS NULL THEN RETURN gridex_bilateral_prodat.committed_h_start_effects_v1(c,source_id,requested);END IF;$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_received_sources.committed_supply_effects_v1(uuid,uuid,integer[])'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'bilateral_h_positive_reader_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'bilateral_h_positive_reader_metadata_changed';END IF;
END$reader$;
COMMIT;
