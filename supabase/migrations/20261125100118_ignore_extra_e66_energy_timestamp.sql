-- Svk OBS2: an extra SG11 timestamp beside an E66 energy quantity carries
-- no reading time for that quantity. Keep the historical detector for hold replay.
CREATE FUNCTION gridex_e66_intake.sg11_forbidden_timestamp_v2(p_raw text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog' AS $diagnose$
DECLARE
  tokens jsonb := gridex_utilts_binding.wire_tokens_v1(p_raw);
  token jsonb;
  tag text;
  qualifier text;
  e66 boolean := false;
  ide text;
  seq integer := 0;
  quantity text;
BEGIN
  IF jsonb_typeof(tokens) IS DISTINCT FROM 'array'
    OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1 THEN
    RETURN NULL;
  END IF;
  FOR token IN SELECT value FROM jsonb_array_elements(tokens) LOOP
    tag := token->>'tag';
    qualifier := token#>>'{elements,1,0}';
    CASE tag
      WHEN 'UNH' THEN
        IF token#>>'{elements,2,0}' IS DISTINCT FROM 'UTILTS' THEN RETURN NULL; END IF;
      WHEN 'BGM' THEN e66 := qualifier='E66';
      WHEN 'IDE' THEN
        ide := CASE WHEN qualifier='24' THEN nullif(token#>>'{elements,2,0}','') END;
        seq := 0;
        quantity := NULL;
      WHEN 'SEQ' THEN seq := seq+1; quantity := NULL;
      WHEN 'QTY' THEN quantity := nullif(qualifier,'');
      WHEN 'PRI' THEN quantity := NULL;
      WHEN 'MOA' THEN quantity := NULL;
      WHEN 'UNT' THEN EXIT;
      WHEN 'DTM' THEN
        IF e66 AND ide IS NOT NULL AND seq>0 AND qualifier='597' AND quantity NOT IN ('136','220','42') THEN
          RETURN jsonb_build_object('reason','UTILTS_E66_SG11_TIMESTAMP_QUANTITY_NOT_ALLOWED',
            'transactionId',ide,'observationIndex',seq-1,'wireTokenIndex',token->'index',
            'quantityQualifier',quantity);
        END IF;
      ELSE NULL;
    END CASE;
  END LOOP;
  RETURN NULL;
END
$diagnose$;
REVOKE ALL ON FUNCTION gridex_e66_intake.sg11_forbidden_timestamp_v2(text) FROM PUBLIC,anon,authenticated,service_role;

DO $authorization$
DECLARE
  step record;
  target regprocedure;
  saved record;
BEGIN
  FOR step IN SELECT * FROM (VALUES
    ('gridex_e66_intake.hold_sg11_format_v1(uuid,text,uuid,uuid,uuid,uuid)','73b3f0f7fd0b778bbfe089185125a59a7338f01613391284d45e653f4747641f',
     $previous$diagnostic:=gridex_e66_intake.sg11_forbidden_timestamp_v1(source.raw_payload);$previous$,$replacement$diagnostic:=CASE WHEN saved.source_id IS NULL
    THEN gridex_e66_intake.sg11_forbidden_timestamp_v2(source.raw_payload)
    ELSE gridex_e66_intake.sg11_forbidden_timestamp_v1(source.raw_payload) END;$replacement$),
    ('gridex_e66_intake.hold_compatible_sg11_format_v1(public.ediel_messages,uuid)','76374bc2ccc8ae1209070c0e86bd58681bca3b950c022d6bb59b673f3b047ee7',
     $previous$  diagnostic:=gridex_e66_intake.sg11_forbidden_timestamp_v1(original.raw_payload);
  IF diagnostic IS NULL THEN
    RAISE EXCEPTION 'e66_sg11_format_review_no_occurrence' USING ERRCODE='55000';
  END IF;
  SELECT * INTO saved FROM gridex_e66_intake.sg11_compatibility_holds WHERE source_id=original.id;
  IF FOUND THEN$previous$,$replacement$  SELECT * INTO saved FROM gridex_e66_intake.sg11_compatibility_holds WHERE source_id=original.id;
  diagnostic:=CASE WHEN saved.source_id IS NULL
    THEN gridex_e66_intake.sg11_forbidden_timestamp_v2(original.raw_payload)
    ELSE gridex_e66_intake.sg11_forbidden_timestamp_v1(original.raw_payload) END;
  IF diagnostic IS NULL THEN
    RAISE EXCEPTION 'e66_sg11_format_review_no_occurrence' USING ERRCODE='55000';
  END IF;
  IF saved.source_id IS NOT NULL THEN$replacement$),
    ('gridex_e66_intake.require_supported_mixed_source_v1(uuid,text,uuid,uuid,uuid)','b7d2da9af8904c7091efbc2cf8db14f35852a7e837d17089dfc71ec744cb0131',
     $previous$gridex_e66_intake.sg11_forbidden_timestamp_v1(m.raw_payload)$previous$,$replacement$gridex_e66_intake.sg11_forbidden_timestamp_v2(m.raw_payload)$replacement$)
  ) AS owners(signature,preimage,old_text,new_text)
  LOOP
    target:=to_regprocedure(step.signature);
    SELECT p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
      INTO STRICT saved FROM pg_proc p WHERE p.oid=target;
    IF encode(sha256(convert_to(saved.prosrc,'UTF8')),'hex')<>step.preimage
      OR strpos(saved.prosrc,step.old_text)=0
    THEN RAISE EXCEPTION 'e66_sg11_energy_exception_preimage_changed %',step.signature; END IF;
    EXECUTE replace(saved.definition,saved.prosrc,replace(saved.prosrc,step.old_text,step.new_text));
    IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM saved.metadata
    THEN RAISE EXCEPTION 'e66_sg11_energy_exception_metadata_changed %',step.signature; END IF;
  END LOOP;
END
$authorization$;
