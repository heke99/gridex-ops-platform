-- Created by actual Supabase CLI 2.118.0. Prospective service-envelope parity
-- for a newly prepared/stored ACK original. This uses the existing one native
-- EDIFACT lexer; national guide/source scope stays with its existing owner.
-- Historical fixed originals and accepted/entered transport replay are not
-- reparsed through this new birth guard.
BEGIN;
CREATE FUNCTION gridex_ediel_ack_guide.require_fresh_ack_envelope_v1(p_raw text,p_declared_family text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(p_raw);unb jsonb;unh jsonb;unt jsonb;unz jsonb;n integer;is_ack boolean;
BEGIN
 is_ack:=coalesce(p_declared_family IN('CONTRL','APERAK','UTILTS_ERR'),false);
 IF tokens IS NULL THEN
  IF is_ack THEN RAISE EXCEPTION 'ediel_fresh_ack_envelope_invalid';END IF;
  -- An unreadable non-declared payload remains subject to the existing owner
  -- admission; do not introduce an alternate prefix/body parser here.
  RETURN;
 END IF;
 is_ack:=is_ack OR EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}' IN('CONTRL','APERAK'))
  OR(EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='UTILTS')
   AND EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='ERR'));
 IF NOT is_ack THEN RETURN;END IF;
 n:=jsonb_array_length(tokens);
 IF n<4 OR EXISTS(SELECT FROM unnest(ARRAY['UNB','UNH','UNT','UNZ'])tag WHERE(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'=tag)<>1)
  OR tokens->0->>'tag' IS DISTINCT FROM 'UNB' OR tokens->1->>'tag' IS DISTINCT FROM 'UNH'
  OR tokens->(n-2)->>'tag' IS DISTINCT FROM 'UNT' OR tokens->(n-1)->>'tag' IS DISTINCT FROM 'UNZ' THEN
  RAISE EXCEPTION 'ediel_fresh_ack_envelope_invalid';
 END IF;
 unb:=tokens->0;unh:=tokens->1;unt:=tokens->(n-2);unz:=tokens->(n-1);
 -- Each service count/reference is one decoded simple element. No trim,
 -- truncation or re-splitting of a released data/component separator occurs.
 IF jsonb_array_length(coalesce(unb#>'{elements,5}','[]'))<>1 OR nullif(unb#>>'{elements,5,0}','') IS NULL
  OR jsonb_array_length(coalesce(unz#>'{elements,2}','[]'))<>1 OR nullif(unz#>>'{elements,2,0}','') IS NULL
  OR unb#>>'{elements,5,0}' IS DISTINCT FROM unz#>>'{elements,2,0}'
  OR jsonb_array_length(coalesce(unh#>'{elements,1}','[]'))<>1 OR nullif(unh#>>'{elements,1,0}','') IS NULL
  OR jsonb_array_length(coalesce(unt#>'{elements,2}','[]'))<>1 OR nullif(unt#>>'{elements,2,0}','') IS NULL
  OR unh#>>'{elements,1,0}' IS DISTINCT FROM unt#>>'{elements,2,0}'
  OR jsonb_array_length(coalesce(unz#>'{elements,1}','[]'))<>1 OR coalesce(unz#>>'{elements,1,0}','')!~'^[0-9]+$'
  OR jsonb_array_length(coalesce(unt#>'{elements,1}','[]'))<>1 OR coalesce(unt#>>'{elements,1,0}','')!~'^[0-9]+$' THEN
  RAISE EXCEPTION 'ediel_fresh_ack_envelope_invalid';
 END IF;
 IF(unz#>>'{elements,1,0}')::numeric<>1 OR(unt#>>'{elements,1,0}')::numeric<>n-2 THEN
  RAISE EXCEPTION 'ediel_fresh_ack_envelope_invalid';
 END IF;
END $$;

ALTER FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) RENAME TO prepare_before_fresh_ack_envelope_v1;
CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_ack_guide.require_fresh_ack_envelope_v1(p_input->>'rawPayload');
 RETURN gridex_ediel_outbound_owner.prepare_before_fresh_ack_envelope_v1(p_input);
END $$;

CREATE FUNCTION gridex_ediel_ack_guide.require_fresh_ack_envelope_before_storage_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF NEW.direction='outbound' AND NEW.raw_payload IS NOT NULL THEN
  IF TG_OP='INSERT' THEN PERFORM gridex_ediel_ack_guide.require_fresh_ack_envelope_v1(NEW.raw_payload,NEW.message_family);
  ELSIF OLD.raw_payload IS NULL THEN PERFORM gridex_ediel_ack_guide.require_fresh_ack_envelope_v1(NEW.raw_payload,NEW.message_family);END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ediel_01_require_fresh_ack_envelope BEFORE INSERT OR UPDATE OF raw_payload ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_ediel_ack_guide.require_fresh_ack_envelope_before_storage_v1();
REVOKE ALL ON FUNCTION gridex_ediel_ack_guide.require_fresh_ack_envelope_v1(text,text),gridex_ediel_ack_guide.require_fresh_ack_envelope_before_storage_v1(),
 gridex_ediel_outbound_owner.prepare_before_fresh_ack_envelope_v1(jsonb),gridex_ediel_outbound_owner.prepare_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) TO service_role;
COMMIT;
