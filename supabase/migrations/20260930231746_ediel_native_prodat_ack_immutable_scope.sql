-- Actual CLI forward. PRODAT ACK finality uses actual physical source/own ERC
-- scopes. UTILTS keeps its existing sole planned/final transaction authority.
BEGIN;
CREATE TABLE gridex_ediel_ack_guide.outbound_prodat_scopes(
 company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 source_payload_sha256 text NOT NULL CHECK(source_payload_sha256~'^[a-f0-9]{64}$'),scope_kind text NOT NULL CHECK(scope_kind IN('message','object')),scope_reference text NOT NULL,
 physical_source_reference jsonb NOT NULL,outcome text NOT NULL CHECK(outcome IN('positive','negative')),
 ack_message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,ack_payload_sha256 text NOT NULL CHECK(ack_payload_sha256~'^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(source_message_id,scope_kind,scope_reference));
CREATE INDEX outbound_prodat_scope_ack ON gridex_ediel_ack_guide.outbound_prodat_scopes(ack_message_id);
ALTER TABLE gridex_ediel_ack_guide.outbound_prodat_scopes ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_ediel_ack_guide.outbound_prodat_scopes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_ack_guide.outbound_prodat_scopes FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_ediel_ack_guide.outbound_prodat_scopes FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_ack_guide.outbound_prodat_scopes FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
-- This is a raw scope projection, not national validation or a rule engine.
-- The actual national owner validates fresh rows before this function is used.
CREATE FUNCTION gridex_ediel_ack_guide.prodat_outcomes_v1(raw text,source_raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE a jsonb:=gridex_ack_authority.wire_v1(raw);s jsonb:=gridex_ack_authority.wire_v1(source_raw);tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(raw);original jsonb:=gridex_utilts_binding.wire_tokens_v1(source_raw);t jsonb;g jsonb;source_objects jsonb;matches jsonb;result jsonb:='[]';group_end integer;own_li text;own_object text;erc_index integer:=0;outcome text;
BEGIN
 IF a IS NULL OR s IS NULL OR a->>'family'<>'APERAK' OR a#>>'{type,2}'<>'96A' OR a#>>'{type,4}'<>'E2SE6A' OR s->>'family'<>'PRODAT' OR NOT coalesce(gridex_ack_authority.source_match_v1(a,s),false) THEN RAISE EXCEPTION 'ediel_prodat_ack_physical_scope_required';END IF;
 IF a->>'function'='27' THEN
  IF jsonb_array_length(coalesce(a->'erc','[]'))=0 OR EXISTS(SELECT FROM jsonb_array_elements_text(a->'erc')e WHERE e='100') THEN RAISE EXCEPTION 'ediel_prodat_ack_physical_scope_required';END IF;
  RETURN jsonb_build_array(jsonb_build_object('scope','message','reference',coalesce(s->>'document',''),'physicalReference',jsonb_build_object('documentId',s->>'document'),'outcome','negative'));
 END IF;
 IF a->>'function' IS DISTINCT FROM '34' THEN RAISE EXCEPTION 'ediel_prodat_ack_physical_scope_required';END IF;
 SELECT coalesce(jsonb_agg(object),'[]') INTO source_objects FROM (
  SELECT jsonb_build_object('lineIndex',(lin->>'index')::int,'id',lin#>>'{elements,3,0}','li',(SELECT min(r#>>'{elements,1,1}') FROM jsonb_array_elements(original)r WHERE r->>'tag'='RFF' AND r#>>'{elements,1,0}'='LI' AND (r->>'index')::int>(lin->>'index')::int AND (r->>'index')::int<coalesce((SELECT min((n->>'index')::int) FROM jsonb_array_elements(original)n WHERE n->>'tag' IN('LIN','UNT') AND (n->>'index')::int>(lin->>'index')::int),2147483647))) object FROM jsonb_array_elements(original)lin WHERE lin->>'tag'='LIN')objects;
 IF EXISTS(SELECT FROM jsonb_array_elements(original)lin WHERE lin->>'tag'='LIN' AND (SELECT count(*) FROM jsonb_array_elements(original)r WHERE r->>'tag'='RFF' AND r#>>'{elements,1,0}'='LI' AND(r->>'index')::int>(lin->>'index')::int AND(r->>'index')::int<coalesce((SELECT min((n->>'index')::int) FROM jsonb_array_elements(original)n WHERE n->>'tag' IN('LIN','UNT') AND(n->>'index')::int>(lin->>'index')::int),2147483647))>1) THEN RAISE EXCEPTION 'ediel_prodat_ack_physical_scope_required';END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='ERC' ORDER BY(x->>'index')::int LOOP
  SELECT min((x->>'index')::int) INTO group_end FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::int>(t->>'index')::int AND x->>'tag' IN('ERC','UNT','UNZ');
  IF EXISTS(SELECT FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}' IN('LI','Z07') AND(x->>'index')::int>(t->>'index')::int AND(x->>'index')::int<group_end GROUP BY x#>>'{elements,1,0}' HAVING count(*)>1) THEN RAISE EXCEPTION 'ediel_prodat_ack_physical_scope_required';END IF;
  SELECT min(x#>>'{elements,1,1}') INTO own_li FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI' AND(x->>'index')::int>(t->>'index')::int AND(x->>'index')::int<group_end;
  SELECT min(x#>>'{elements,1,1}') INTO own_object FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='Z07' AND(x->>'index')::int>(t->>'index')::int AND(x->>'index')::int<group_end;
  SELECT jsonb_agg(x) INTO matches FROM jsonb_array_elements(source_objects)x WHERE CASE WHEN own_li IS NOT NULL THEN x->>'li'=own_li ELSE x->>'id'=own_object END AND(own_object IS NULL OR x->>'id'=own_object);
  IF jsonb_array_length(coalesce(matches,'[]'))<>1 THEN RAISE EXCEPTION 'ediel_prodat_ack_physical_scope_required';END IF;
  -- Outcome is the existing native wire owner's own ERC ordinal projection.
  -- No national error code or field label is selected or inferred here.
  IF a->'erc'->>erc_index IS DISTINCT FROM t#>>'{elements,1,0}' THEN RAISE EXCEPTION 'ediel_prodat_ack_physical_scope_required';END IF;
  outcome:=CASE WHEN a->'erc'->>erc_index='100' THEN 'positive' ELSE 'negative' END;erc_index:=erc_index+1;
  g:=jsonb_build_object('scope','object','reference',matches#>>'{0,lineIndex}','physicalReference',matches->0,'outcome',outcome);result:=result||jsonb_build_array(g);
 END LOOP;
 IF jsonb_array_length(result)=0 OR EXISTS(SELECT FROM jsonb_array_elements(result)x GROUP BY x->>'scope',x->>'reference' HAVING count(DISTINCT x->>'outcome')<>1) THEN RAISE EXCEPTION 'ediel_prodat_ack_contradictory_own_outcome';END IF;
 SELECT jsonb_agg(x ORDER BY x->>'reference') INTO result FROM(SELECT DISTINCT x FROM jsonb_array_elements(result)x)unique_scopes;RETURN result;
END $$;
CREATE FUNCTION gridex_ediel_ack_guide.prodat_scope_overlap_v1(a jsonb,b jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT a->>'scope'='message' OR b->>'scope'='message' OR(a->>'scope'=b->>'scope' AND a->>'reference'=b->>'reference')$$;
CREATE FUNCTION gridex_ediel_ack_guide.require_prodat_scope_v1(m public.ediel_messages) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;source public.ediel_messages%rowtype;own_scopes jsonb;scope jsonb;prior_scope jsonb;prior public.ediel_messages%rowtype;row_scope gridex_ediel_ack_guide.outbound_prodat_scopes%rowtype;source_hash text;ack_hash text;protected boolean;
BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'APERAK' THEN RETURN;END IF;a:=gridex_ack_authority.wire_v1(m.raw_payload);
 IF a IS NULL OR a#>>'{type,2}' IS DISTINCT FROM '96A' OR a#>>'{type,4}' IS DISTINCT FROM 'E2SE6A' THEN RETURN;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND direction='inbound' AND environment=m.environment AND(company_id=m.company_id OR(company_id IS NULL AND m.execution_context_snapshot->>'prodatCommonHeaderNegativeWitnessId' IS NOT NULL)) FOR UPDATE;
 IF source.id IS NULL OR m.company_id IS NULL THEN RAISE EXCEPTION 'ediel_prodat_ack_source_scope_required';END IF;
 source_hash:=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex');ack_hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');own_scopes:=gridex_ediel_ack_guide.prodat_outcomes_v1(m.raw_payload,source.raw_payload);
 IF EXISTS(SELECT FROM gridex_ediel_ack_guide.outbound_prodat_scopes r WHERE r.ack_message_id=m.id AND(r.source_message_id IS DISTINCT FROM source.id OR r.company_id IS DISTINCT FROM m.company_id OR r.environment IS DISTINCT FROM m.environment OR r.source_payload_sha256 IS DISTINCT FROM source_hash OR r.ack_payload_sha256 IS DISTINCT FROM ack_hash)) THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_original_changed';END IF;
 -- The source row lock serializes every whole-message/own-object reservation.
 -- Old protected ACK originals are read as actual raw scopes; mutable status,
 -- ack_outcome and caller parsed hints never establish a historical decision.
 FOR prior IN SELECT p.* FROM public.ediel_messages p WHERE p.id IS DISTINCT FROM m.id AND (
  (p.direction='outbound' AND p.message_family='APERAK' AND p.related_message_id=source.id AND p.company_id=m.company_id AND p.environment=m.environment)
  OR EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions c JOIN gridex_ediel_outbound_owner.witnesses w ON w.id=c.witness_id WHERE c.source_message_id=p.id AND w.related_message_id=source.id AND w.family='APERAK')
  OR EXISTS(SELECT FROM gridex_ediel_common_header.negative_consumptions c JOIN gridex_ediel_common_header.negative_witnesses w ON w.id=c.witness_id WHERE c.ack_message_id=p.id AND w.source_message_id=source.id)) FOR SHARE LOOP
  IF prior.company_id IS DISTINCT FROM m.company_id OR prior.environment IS DISTINCT FROM m.environment OR prior.direction IS DISTINCT FROM 'outbound' OR prior.message_family IS DISTINCT FROM 'APERAK' OR prior.related_message_id IS DISTINCT FROM source.id THEN RAISE EXCEPTION 'ediel_historical_prodat_ack_scope_basis_unavailable';END IF;
  IF gridex_ack_authority.wire_v1(prior.raw_payload)#>>'{type,2}' IS DISTINCT FROM '96A' THEN RAISE EXCEPTION 'ediel_historical_prodat_ack_scope_basis_unavailable';END IF;
  protected:=EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions c JOIN gridex_ediel_outbound_owner.witnesses w ON w.id=c.witness_id WHERE c.source_message_id=prior.id AND c.company_id=m.company_id AND c.environment=m.environment AND c.payload_sha256=encode(sha256(convert_to(prior.raw_payload,'UTF8')),'hex') AND w.company_id=c.company_id AND w.environment=c.environment AND w.payload_sha256=c.payload_sha256 AND w.related_message_id=source.id AND w.family='APERAK')
   OR EXISTS(SELECT FROM gridex_ediel_common_header.negative_consumptions c JOIN gridex_ediel_common_header.negative_witnesses w ON w.id=c.witness_id WHERE c.ack_message_id=prior.id AND c.company_id=m.company_id AND c.environment=m.environment AND c.payload_sha256=encode(sha256(convert_to(prior.raw_payload,'UTF8')),'hex') AND w.company_id=c.company_id AND w.environment=c.environment AND w.payload_sha256=c.payload_sha256 AND w.source_message_id=source.id);
  IF NOT protected THEN RAISE EXCEPTION 'ediel_historical_prodat_ack_scope_basis_unavailable';END IF;
  FOR prior_scope IN SELECT x FROM jsonb_array_elements(gridex_ediel_ack_guide.prodat_outcomes_v1(prior.raw_payload,source.raw_payload))x LOOP
   FOR scope IN SELECT x FROM jsonb_array_elements(own_scopes)x LOOP
    IF gridex_ediel_ack_guide.prodat_scope_overlap_v1(scope,prior_scope) THEN IF scope->>'outcome' IS DISTINCT FROM prior_scope->>'outcome' THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_conflicting_outcome';ELSE RAISE EXCEPTION 'ediel_prodat_ack_scope_already_fixed';END IF;END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 FOR scope IN SELECT x FROM jsonb_array_elements(own_scopes)x LOOP
  FOR row_scope IN SELECT * FROM gridex_ediel_ack_guide.outbound_prodat_scopes r WHERE r.source_message_id=source.id FOR SHARE LOOP
   IF row_scope.company_id IS DISTINCT FROM m.company_id OR row_scope.environment IS DISTINCT FROM m.environment OR row_scope.source_payload_sha256 IS DISTINCT FROM source_hash THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_original_changed';END IF;
   IF gridex_ediel_ack_guide.prodat_scope_overlap_v1(scope,jsonb_build_object('scope',row_scope.scope_kind,'reference',row_scope.scope_reference)) THEN
    IF row_scope.outcome IS DISTINCT FROM scope->>'outcome' THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_conflicting_outcome';END IF;
    IF row_scope.ack_message_id IS DISTINCT FROM m.id OR row_scope.ack_payload_sha256 IS DISTINCT FROM ack_hash OR row_scope.physical_source_reference IS DISTINCT FROM scope->'physicalReference' THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_already_fixed';END IF;
   END IF;
  END LOOP;
  IF m.id IS NULL THEN CONTINUE;END IF;
  INSERT INTO gridex_ediel_ack_guide.outbound_prodat_scopes(company_id,environment,source_message_id,source_payload_sha256,scope_kind,scope_reference,physical_source_reference,outcome,ack_message_id,ack_payload_sha256)
   VALUES(m.company_id,m.environment,source.id,source_hash,scope->>'scope',scope->>'reference',scope->'physicalReference',scope->>'outcome',m.id,ack_hash) ON CONFLICT DO NOTHING;
 END LOOP;
END $$;
CREATE FUNCTION gridex_ediel_ack_guide.lock_prodat_scope_before_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE a jsonb;BEGIN
 IF NEW.direction='outbound' AND NEW.message_family='APERAK' THEN a:=gridex_ack_authority.wire_v1(NEW.raw_payload);IF a#>>'{type,2}'='96A' AND a#>>'{type,4}'='E2SE6A' THEN
  PERFORM s.id FROM public.ediel_messages s WHERE s.id=NEW.related_message_id AND s.direction='inbound' AND s.environment=NEW.environment AND(s.company_id=NEW.company_id OR(s.company_id IS NULL AND EXISTS(SELECT FROM gridex_ediel_common_header.negative_witnesses w WHERE w.id=(NEW.execution_context_snapshot->>'prodatCommonHeaderNegativeWitnessId')::uuid AND w.source_message_id=s.id AND w.company_id=NEW.company_id AND w.environment=NEW.environment AND w.payload_sha256=encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex')))) FOR UPDATE;
 END IF;END IF;RETURN NEW;END $$;
CREATE FUNCTION gridex_ediel_ack_guide.reserve_prodat_scope_after_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN PERFORM gridex_ediel_ack_guide.require_prodat_scope_v1(NEW);RETURN NEW;END$$;
CREATE TRIGGER ediel_00_lock_prodat_ack_scope BEFORE INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_ack_guide.lock_prodat_scope_before_insert();
-- Runs AFTER the genuine actual owner consume trigger. Any scope rejection
-- rolls back message, one-use consumption and reservation together.
CREATE TRIGGER ediel_z_reserve_prodat_ack_scope AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_ack_guide.reserve_prodat_scope_after_insert();
ALTER FUNCTION gridex_ediel_ack_guide.require_v1(public.ediel_messages) RENAME TO require_before_prodat_scope_v1;
CREATE FUNCTION gridex_ediel_ack_guide.require_v1(m public.ediel_messages) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_ack_guide.require_before_prodat_scope_v1(m);PERFORM gridex_ediel_ack_guide.require_prodat_scope_v1(m);
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_guide.prodat_outcomes_v1(text,text),gridex_ediel_ack_guide.prodat_scope_overlap_v1(jsonb,jsonb),gridex_ediel_ack_guide.require_prodat_scope_v1(public.ediel_messages),gridex_ediel_ack_guide.lock_prodat_scope_before_insert(),gridex_ediel_ack_guide.reserve_prodat_scope_after_insert(),gridex_ediel_ack_guide.require_before_prodat_scope_v1(public.ediel_messages),gridex_ediel_ack_guide.require_v1(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
