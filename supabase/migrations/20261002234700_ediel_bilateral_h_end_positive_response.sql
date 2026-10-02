-- 20261002234600 let the positive-reply reader accept a bilateral H start
-- (Z04, gridex_bilateral_prodat.supply_effect_receipts). Received H ends are
-- committed by their own owners with their own receipts:
--   * Z05 H end of a bilateral profile   -> gridex_bilateral_prodat.supply_effect_receipts
--   * Z05 confirming an LK closure        -> gridex_bilateral_prodat.closure_end_receipts
--   * Z05 confirming a national rescission-> gridex_supply_rescission.end_receipts
-- Without them the ERC100 APERAK for a committed own end was never authorized
-- (prodat_structural_response_own_effect_unavailable), and no positive reply or
-- final-metering follow-up was produced.
--
-- The helper now accepts Z04 and Z05 and exactly one committed receipt from
-- those owners: same company, environment and exact payload, committed in an
-- earlier transaction. Every other check is unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.committed_h_start_effects_v1(c uuid, source_id uuid, requested integer[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
DECLARE m public.ediel_messages%rowtype;application jsonb;effects jsonb:='[]';o jsonb;scope jsonb;first_line integer;raw_hash text;
 receipts integer;b_company uuid;b_environment text;b_hash text;b_transition text;b_recorded timestamptz;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR(m.message_code IN('Z04','Z05')) IS NOT TRUE THEN RETURN NULL;END IF;
 WITH committed AS(
  SELECT r.company_id,r.environment,r.payload_hash hash,r.transition_hash,r.recorded_at FROM gridex_bilateral_prodat.supply_effect_receipts r
   WHERE r.source_message_id=m.id AND r.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296)
  UNION ALL
  SELECT r.company_id,r.environment,r.source_payload_hash,r.transition_hash,r.recorded_at FROM gridex_bilateral_prodat.closure_end_receipts r
   WHERE m.message_code='Z05' AND r.source_message_id=m.id AND r.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296)
  UNION ALL
  SELECT r.company_id,r.environment,r.source_payload_hash,r.transition_hash,r.recorded_at FROM gridex_supply_rescission.end_receipts r
   WHERE m.message_code='Z05' AND r.source_message_id=m.id AND r.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296))
 SELECT count(*),min(company_id::text)::uuid,min(environment),min(hash),min(transition_hash),min(recorded_at) INTO receipts,b_company,b_environment,b_hash,b_transition,b_recorded FROM committed;
 IF receipts=0 THEN RETURN NULL;END IF;
 IF receipts<>1 THEN RAISE EXCEPTION 'supply_final_response_source_changed';END IF;
 raw_hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 IF b_company IS DISTINCT FROM c OR b_environment IS DISTINCT FROM m.environment OR b_hash IS DISTINCT FROM raw_hash
  OR b_transition IS NULL OR b_transition!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'supply_final_response_source_changed';END IF;
 application:=gridex_received_sources.require_prodat_application_objects_v1(c,m.id);
 IF application->>'headerDecision' IS DISTINCT FROM 'accepted' OR application->>'sourcePayloadHash' IS DISTINCT FROM raw_hash THEN RETURN NULL;END IF;
 FOR o IN SELECT e FROM jsonb_array_elements(application->'objects')e ORDER BY(e#>>'{registers,0,segmentIndex}')::integer LOOP
  IF o->>'applicationDecision' IS DISTINCT FROM 'accepted' THEN CONTINUE;END IF;
  scope:=o-'applicationDecision'-'reasonCodes';first_line:=(scope#>>'{registers,0,segmentIndex}')::integer;
  IF requested IS NOT NULL AND NOT(first_line=ANY(requested)) THEN CONTINUE;END IF;
  effects:=effects||jsonb_build_array(jsonb_build_object('receiptId',m.id,'canonicalAssessmentId',application->>'assessmentId','sourcePayloadHash',b_hash,
   'objectScope',scope,'appliedAt',b_recorded,'effectKind','supply','effectFactsHash',b_transition));
 END LOOP;
 IF requested IS NOT NULL AND cardinality(requested)<>jsonb_array_length(effects) THEN RAISE EXCEPTION 'supply_final_response_own_effect_uncommitted';END IF;
 RETURN effects;
END $function$;
REVOKE ALL ON FUNCTION gridex_bilateral_prodat.committed_h_start_effects_v1(uuid,uuid,integer[]) FROM PUBLIC, anon, authenticated;
COMMIT;
