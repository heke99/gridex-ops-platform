-- Created with Supabase CLI 2.118.0. ACK-06/07/08, TEN-13: prospective
-- immutable physical sources, exact correlation and atomic scoped outcomes.
-- No historical backfill, synthetic receive context or rewritten ACK truth.
BEGIN;
CREATE SCHEMA gridex_ack_authority;
REVOKE ALL ON SCHEMA gridex_ack_authority FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ack_authority.seal_received_ack_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.execution_context_snapshot ? 'receivedAckContext' THEN
   IF NEW.execution_context_snapshot->'receivedAckContext' IS DISTINCT FROM OLD.execution_context_snapshot->'receivedAckContext'
    OR NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR NEW.immutable_payload_hash IS DISTINCT FROM OLD.immutable_payload_hash
    OR ROW(NEW.id,NEW.company_id,NEW.environment,NEW.direction,NEW.message_family,NEW.message_standard,NEW.message_code,NEW.message_received_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.environment,OLD.direction,OLD.message_family,OLD.message_standard,OLD.message_code,OLD.message_received_at)
   THEN RAISE EXCEPTION 'immutable_received_ack_source_cannot_change' USING ERRCODE='23514'; END IF;
  ELSIF NEW.execution_context_snapshot ? 'receivedAckContext' THEN RAISE EXCEPTION 'received_ack_context_cannot_be_backfilled' USING ERRCODE='23514'; END IF;
 ELSIF TG_OP='INSERT' THEN
  IF jsonb_typeof(NEW.execution_context_snapshot) IN ('object','array') THEN NEW.execution_context_snapshot:=NEW.execution_context_snapshot-'receivedAckContext'; END IF;
  IF NEW.direction='inbound' AND NEW.message_family IN ('CONTRL','APERAK','UTILTS_ERR') AND NEW.message_standard='edifact'
   AND NEW.id IS NOT NULL AND NEW.company_id IS NOT NULL AND NEW.environment IN ('test','production')
   AND NEW.message_code IS NOT NULL AND NEW.message_received_at IS NOT NULL AND NEW.raw_payload IS NOT NULL THEN
   NEW.immutable_payload_hash:=encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex');
   NEW.execution_context_snapshot:=(CASE WHEN jsonb_typeof(NEW.execution_context_snapshot)='object' THEN NEW.execution_context_snapshot ELSE '{}'::jsonb END)
     || jsonb_build_object('receivedAckContext',jsonb_build_object('version',1,'contextOrigin','database_insert','sourceMessageId',NEW.id,
       'companyId',NEW.company_id,'environment',NEW.environment,'messageCode',NEW.message_code,'payloadHash',NEW.immutable_payload_hash,
       'sourceReceivedAt',NEW.message_received_at,'capturedAt',clock_timestamp()));
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gridex_seal_received_ack_source BEFORE INSERT OR UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ack_authority.seal_received_ack_v1();
CREATE FUNCTION gridex_ack_authority.capture_received_ack_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.direction='inbound' AND NEW.message_family IN ('CONTRL','APERAK','UTILTS_ERR') AND NEW.message_standard='edifact'
  AND NEW.execution_context_snapshot ? 'receivedAckContext' THEN
  INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,origin,message_code,source_received_at,captured_at,raw_payload,payload_hash,received_context)
   VALUES(NEW.id,NEW.company_id,NEW.environment,'database_insert',NEW.message_code,NEW.message_received_at,clock_timestamp(),NEW.raw_payload,
     NEW.immutable_payload_hash,NEW.execution_context_snapshot->'receivedAckContext');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gridex_capture_received_ack_source AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ack_authority.capture_received_ack_v1();
CREATE TABLE gridex_ack_authority.source_correlations(
 ack_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN ('test','production')),
 ack_payload_hash text NOT NULL,source_payload_hash text NOT NULL,
 canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id) ON DELETE RESTRICT,
 ack_family text NOT NULL CHECK(ack_family IN ('CONTRL','APERAK','UTILTS_ERR')),
 ack_outcome text NOT NULL CHECK(ack_outcome IN ('positive','negative')),
 ack_scope text NOT NULL CHECK(ack_scope IN ('interchange','message','transaction','object')),
 acknowledged_references jsonb NOT NULL CHECK(jsonb_typeof(acknowledged_references)='array'),
 scope_outcomes jsonb NOT NULL CHECK(jsonb_typeof(scope_outcomes)='array'),
 correlated_at timestamptz NOT NULL DEFAULT clock_timestamp(),actor_user_id uuid NOT NULL
);
CREATE INDEX ack_correlation_source_scope ON gridex_ack_authority.source_correlations(company_id,environment,source_message_id,ack_family,ack_scope);
ALTER TABLE gridex_ack_authority.source_correlations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ack_authority.source_correlations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ack_authority.source_correlations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_ack_authority.source_correlations FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ack_authority.source_correlations FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

-- Shared inherited lossless lexical decoder, no second grammar. This projects
-- physical identity only; the live canonical assessment owns guide admission.
CREATE FUNCTION gridex_ack_authority.wire_v1(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(p_raw);t jsonb;e jsonb;out jsonb:=jsonb_build_object('refs','{}'::jsonb);first_detail integer;family text;legal_sender text;legal_receiver text;erc text;
BEGIN
 IF tokens IS NULL OR EXISTS(SELECT FROM unnest(ARRAY['UNB','UNH','UNT','UNZ']) tag WHERE (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'=tag)<>1) THEN RETURN NULL; END IF;
 SELECT min((x->>'index')::integer) INTO first_detail FROM jsonb_array_elements(tokens) x WHERE x->>'tag' IN ('IDE','LIN');
 FOR t IN SELECT x FROM jsonb_array_elements(tokens) x ORDER BY (x->>'index')::integer LOOP
  e:=t->'elements';
  IF t->>'tag'='UNB' THEN out:=out||jsonb_build_object('sender',e->2,'receiver',e->3,'interchange',e#>>'{5,0}','app',e#>>'{7,0}','environment',CASE e#>>'{11,0}' WHEN '1' THEN 'test' ELSE 'production' END);
  ELSIF t->>'tag'='UNH' THEN family:=e#>>'{2,0}';out:=out||jsonb_build_object('family',family,'type',e->2,'unhRef',e#>>'{1,0}','unhIndex',t->'index');
  ELSIF t->>'tag'='UNT' THEN out:=out||jsonb_build_object('untRef',e#>>'{2,0}','untCount',e#>>'{1,0}','untIndex',t->'index');
  ELSIF t->>'tag'='BGM' THEN IF out ? 'code' THEN RETURN NULL; END IF;out:=out||jsonb_build_object('code',e#>>'{1,0}','document',e#>>'{2,0}','function',e#>>'{3,0}');
  ELSIF t->>'tag'='DOC' THEN IF out ? 'docRef' THEN RETURN NULL; END IF;out:=out||jsonb_build_object('docCode',e#>>'{1,0}','docRef',e#>>'{2,0}');
  ELSIF t->>'tag'='UCI' THEN IF out ? 'uciRef' THEN RETURN NULL; END IF;out:=out||jsonb_build_object('uciRef',e#>>'{1,0}','uciSender',e->2,'uciReceiver',e->3,'uciAction',e#>>'{4,0}');
  ELSIF t->>'tag'='UCM' THEN out:=jsonb_set(out,'{ucm}',coalesce(out->'ucm','[]')||jsonb_build_array(e#>>'{1,0}'));
  ELSIF t->>'tag'='IDE' THEN IF e#>>'{1,0}'<>'24' THEN RETURN NULL; END IF;out:=jsonb_set(out,'{ide}',coalesce(out->'ide','[]')||jsonb_build_array(e#>>'{2,0}'));
  ELSIF t->>'tag'='RFF' THEN out:=jsonb_set(out,ARRAY['refs',e#>>'{1,0}'],coalesce(out#>ARRAY['refs',e#>>'{1,0}'],'[]')||jsonb_build_array(e#>>'{1,1}'));
   IF e#>>'{1,0}' IN ('LI','ACW') AND erc IS NOT NULL THEN out:=jsonb_set(out,'{scopeResults}',coalesce(out->'scopeResults','[]')||jsonb_build_array(jsonb_build_object('qualifier',e#>>'{1,0}','reference',e#>>'{1,1}','outcome',CASE erc WHEN '100' THEN 'positive' ELSE 'negative' END))); END IF;
  ELSIF t->>'tag'='NAD' AND (first_detail IS NULL OR (t->>'index')::integer<first_detail) THEN
   legal_sender:=CASE family WHEN 'PRODAT' THEN 'FR' WHEN 'APERAK' THEN CASE out#>>'{type,2}' WHEN '96A' THEN 'FR' ELSE 'MS' END ELSE 'MS' END;
   legal_receiver:=CASE family WHEN 'PRODAT' THEN 'DO' WHEN 'APERAK' THEN CASE out#>>'{type,2}' WHEN '96A' THEN 'DO' ELSE 'MR' END ELSE 'MR' END;
   IF e#>>'{1,0}'=legal_sender THEN IF out ? 'legalSender' THEN RETURN NULL; END IF;out:=out||jsonb_build_object('legalSender',e#>>'{2,0}');
   ELSIF e#>>'{1,0}'=legal_receiver THEN IF out ? 'legalReceiver' THEN RETURN NULL; END IF;out:=out||jsonb_build_object('legalReceiver',e#>>'{2,0}'); END IF;
  ELSIF t->>'tag'='ERC' THEN erc:=e#>>'{1,0}';out:=jsonb_set(out,'{erc}',coalesce(out->'erc','[]')||jsonb_build_array(e#>>'{1,0}'));
  ELSIF t->>'tag'='STS' AND e#>>'{1,0}'='E01' AND e#>>'{2,0}'='41' THEN out:=out||jsonb_build_object('errStatus',true);
  END IF;
 END LOOP;
 IF out->>'unhRef' IS DISTINCT FROM out->>'untRef' OR out->>'untCount' !~ '^[0-9]+$'
  OR (out->>'untCount')::integer<>(out->>'untIndex')::integer-(out->>'unhIndex')::integer+1
  OR nullif(out->>'app','') IS NULL OR nullif(out#>>'{sender,0}','') IS NULL OR nullif(out#>>'{receiver,0}','') IS NULL THEN RETURN NULL; END IF;
 RETURN out;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
CREATE FUNCTION gridex_ack_authority.source_match_v1(a jsonb,s jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF a IS NULL OR s IS NULL OR a->'sender' IS DISTINCT FROM s->'receiver' OR a->'receiver' IS DISTINCT FROM s->'sender'
  OR a->>'environment' IS DISTINCT FROM s->>'environment' OR a->>'app' IS DISTINCT FROM s->>'app' THEN RETURN false; END IF;
 IF a->>'family'='CONTRL' THEN
  RETURN s->>'family'<>'CONTRL' AND a->>'uciRef'=s->>'interchange' AND a->'uciSender'=s->'sender' AND a->'uciReceiver'=s->'receiver'
   AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(a->'ucm','[]')) x WHERE x<>s->>'unhRef');
 END IF;
 IF nullif(a->>'legalSender','') IS NULL OR nullif(a->>'legalReceiver','') IS NULL
  OR a->>'legalSender' IS DISTINCT FROM s->>'legalReceiver' OR a->>'legalReceiver' IS DISTINCT FROM s->>'legalSender' THEN RETURN false; END IF;
 IF a->>'family'='APERAK' AND a#>>'{type,2}'='96A' AND a#>>'{type,4}'='E2SE6A' THEN
  RETURN s->>'family'='PRODAT' AND jsonb_array_length(coalesce(a#>'{refs,ACW}','[]'))=1 AND a#>>'{refs,ACW,0}'=s->>'document'
   AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(a#>'{refs,LI}','[]')) x WHERE NOT coalesce(s#>'{refs,LI}','[]') ? x);
 ELSIF (a->>'family'='APERAK' AND a#>>'{type,2}'='04A' AND a#>>'{type,4}'='E5SE5A') OR (a->>'family'='UTILTS' AND a->>'code'='ERR') THEN
  IF (s->>'family'='UTILTS' AND s->>'code'<>'ERR') IS NOT TRUE THEN RETURN false; END IF;
  IF a->>'family'='APERAK' THEN
   RETURN a->>'docCode'=s->>'code' AND a->>'docRef'=s->>'document'
    AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(a#>'{refs,ACW}','[]')) x WHERE NOT coalesce(s->'ide','[]') ? x);
  ELSE RETURN coalesce(a#>ARRAY['refs',s->>'code'],'[]') ? (s->>'document')
    AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(a#>'{refs,TN}','[]')) x WHERE NOT coalesce(s->'ide','[]') ? x); END IF;
 END IF;
 RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE gridex_ack_authority.scope_outcomes(
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 ack_family text NOT NULL,ack_scope text NOT NULL,source_reference text NOT NULL,
 ack_message_id uuid NOT NULL REFERENCES gridex_ack_authority.source_correlations(ack_message_id) ON DELETE RESTRICT,
 outcome text NOT NULL CHECK(outcome IN ('positive','negative')),
 PRIMARY KEY(source_message_id,ack_family,ack_scope,source_reference)
);
ALTER TABLE gridex_ack_authority.scope_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ack_authority.scope_outcomes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ack_authority.scope_outcomes FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_ack_authority.scope_outcomes FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ack_authority.scope_outcomes FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

CREATE FUNCTION gridex_ack_authority.apply_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE ack public.ediel_messages%rowtype;source public.ediel_messages%rowtype;captured gridex_received_sources.sources%rowtype;
 canonical gridex_received_sources.validation_assessments%rowtype;prior gridex_ack_authority.source_correlations%rowtype;
 a jsonb;s jsonb;family text;outcome text;scope text;refs jsonb;results jsonb;result jsonb;expected jsonb;ids uuid[];all_positive boolean;all_answered boolean;whole_negative boolean;source_accepted boolean;
 contrl text;aperak text;utilts_err text;final_ack boolean;failure text;existing_status text;
BEGIN
 IF p_company_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test','production') OR p_ack_message_id IS NULL
  OR p_source_message_id IS NULL OR p_actor_user_id IS NULL OR p_ack_message_id=p_source_message_id THEN RAISE EXCEPTION 'ack_execution_scope_required' USING ERRCODE='22023'; END IF;
 -- Prevent concurrent insertion/send/seal from changing the global candidate
 -- universe during qualification. This is intentionally conservative; a future
 -- equivalent namespace index may reduce locking without relaxing uniqueness.
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active' FOR SHARE;
 IF NOT FOUND OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false) THEN RAISE EXCEPTION 'ack_execution_actor_unqualified' USING ERRCODE='42501'; END IF;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id
  AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ack_execution_actor_unqualified' USING ERRCODE='42501'; END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id AND environment=p_environment AND direction='outbound' FOR UPDATE;
 SELECT * INTO ack FROM public.ediel_messages WHERE id=p_ack_message_id AND company_id=p_company_id AND environment=p_environment AND direction='inbound' FOR UPDATE;
 IF ack.id IS NULL OR source.id IS NULL OR source.message_sent_at IS NULL OR source.immutable_rendered_at IS NULL
  OR source.requires_contrl IS NULL OR source.requires_aperak IS NULL OR source.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ack_sealed_sent_original_required' USING ERRCODE='23514'; END IF;
 SELECT * INTO captured FROM gridex_received_sources.sources WHERE source_message_id=ack.id AND company_id=p_company_id AND environment=p_environment FOR SHARE;
 IF captured.source_message_id IS NULL OR captured.raw_payload IS DISTINCT FROM ack.raw_payload OR captured.payload_hash IS DISTINCT FROM ack.immutable_payload_hash
  OR captured.payload_hash IS DISTINCT FROM encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex') OR captured.received_context IS NULL
  OR captured.source_received_at IS NULL OR source.message_sent_at>captured.source_received_at THEN RAISE EXCEPTION 'ack_authentic_received_source_required' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM gridex_ack_authority.source_correlations WHERE ack_message_id=ack.id;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=ack.id AND v.company_id=p_company_id AND v.environment=p_environment
  AND v.source_payload_hash=captured.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted'
  AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted'
  AND ((prior.ack_message_id IS NOT NULL AND v.id=prior.canonical_assessment_id) OR (prior.ack_message_id IS NULL AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id))) FOR SHARE;
 IF canonical.id IS NULL THEN RAISE EXCEPTION 'ack_current_canonical_acceptance_required' USING ERRCODE='23514'; END IF;
 a:=gridex_ack_authority.wire_v1(ack.raw_payload);s:=gridex_ack_authority.wire_v1(source.raw_payload);
 IF a IS NULL OR s IS NULL OR a->>'environment' IS DISTINCT FROM p_environment OR s->>'environment' IS DISTINCT FROM p_environment
  OR NOT coalesce(gridex_ack_authority.source_match_v1(a,s),false) THEN RAISE EXCEPTION 'ack_physical_original_scope_mismatch' USING ERRCODE='23514'; END IF;
 SELECT array_agg(m.id ORDER BY m.id) INTO ids FROM public.ediel_messages m WHERE m.direction='outbound' AND m.message_sent_at IS NOT NULL AND m.immutable_rendered_at IS NOT NULL
  AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND gridex_ack_authority.source_match_v1(a,gridex_ack_authority.wire_v1(m.raw_payload));
 IF cardinality(ids) IS DISTINCT FROM 1 OR ids[1] IS DISTINCT FROM source.id THEN RAISE EXCEPTION 'ack_physical_original_ambiguous' USING ERRCODE='23514'; END IF;
 IF a->>'family'='CONTRL' THEN
  family:='CONTRL';scope:='interchange';refs:=jsonb_build_array(a->>'uciRef');outcome:=CASE a->>'uciAction' WHEN '1' THEN 'positive' WHEN '4' THEN 'negative' END;
 ELSIF a->>'family'='UTILTS' AND a->>'code'='ERR' AND a->'errStatus'='true'::jsonb THEN
  family:='UTILTS_ERR';scope:='transaction';refs:=a#>'{refs,TN}';outcome:='negative';
 ELSIF a->>'family'='APERAK' AND a#>>'{type,2}'='04A' AND a#>>'{type,4}'='E5SE5A' THEN
  family:='APERAK';refs:=coalesce(a#>'{refs,ACW}','[]');scope:=CASE WHEN jsonb_array_length(refs)>0 THEN 'transaction' ELSE 'message' END;
  outcome:=CASE a->>'code' WHEN '312' THEN 'positive' WHEN '313' THEN 'negative' END;
  IF outcome='positive' AND scope<>'transaction' THEN RAISE EXCEPTION 'ack_positive_own_transaction_required'; END IF;
 ELSIF a->>'family'='APERAK' AND a#>>'{type,2}'='96A' AND a#>>'{type,4}'='E2SE6A' THEN
  family:='APERAK';refs:=coalesce(a#>'{refs,LI}','[]');scope:=CASE WHEN jsonb_array_length(refs)>0 AND a->>'function'='34' THEN 'object' ELSE 'message' END;
  IF a->>'function'='27' AND NOT coalesce(a->'erc','[]') ? '100' THEN outcome:='negative';
  ELSIF a->>'function'='34' AND jsonb_array_length(coalesce(a->'erc','[]'))>0 THEN outcome:=CASE WHEN EXISTS(SELECT FROM jsonb_array_elements_text(a->'erc') x WHERE x<>'100') THEN 'negative' ELSE 'positive' END; END IF;
  IF outcome='negative' AND a->>'function'='34' AND scope<>'object' THEN RAISE EXCEPTION 'ack_processed_negative_scope_unavailable'; END IF;
 ELSE RAISE EXCEPTION 'ack_canonical_family_unavailable'; END IF;
 IF family IS DISTINCT FROM ack.message_family OR outcome IS NULL OR (scope IN ('transaction','object') AND jsonb_array_length(coalesce(refs,'[]'))=0) THEN RAISE EXCEPTION 'ack_canonical_outcome_unavailable'; END IF;
 IF scope='object' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('reference',x->>'reference','outcome',x->>'outcome')),'[]') INTO results
   FROM jsonb_array_elements(coalesce(a->'scopeResults','[]')) x WHERE x->>'qualifier'='LI';
  IF EXISTS(SELECT FROM jsonb_array_elements_text(refs) ref WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(results) x WHERE x->>'reference'=ref)) THEN RAISE EXCEPTION 'ack_object_outcome_scope_unavailable'; END IF;
 ELSE SELECT coalesce(jsonb_agg(jsonb_build_object('reference',ref,'outcome',outcome)),'[]') INTO results
  FROM jsonb_array_elements_text(CASE WHEN scope='message' THEN jsonb_build_array(s->>'document') ELSE refs END) ref; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(results) x JOIN jsonb_array_elements(results) y ON x->>'reference'=y->>'reference' AND x->>'outcome'<>y->>'outcome') THEN RAISE EXCEPTION 'ack_scope_outcome_conflict'; END IF;
 SELECT * INTO prior FROM gridex_ack_authority.source_correlations WHERE ack_message_id=ack.id;
 IF prior.ack_message_id IS NOT NULL THEN
  IF ROW(prior.source_message_id,prior.company_id,prior.environment,prior.ack_payload_hash,prior.source_payload_hash,prior.ack_family,prior.ack_outcome,prior.ack_scope,prior.scope_outcomes)
   IS DISTINCT FROM ROW(source.id,p_company_id,p_environment,captured.payload_hash,source.immutable_payload_hash,family,outcome,scope,results) THEN RAISE EXCEPTION 'ack_immutable_correlation_conflict'; END IF;
 ELSE
  PERFORM gridex_ediel_inbound_context.require_ack_v1(ack,source);
  IF EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes old JOIN jsonb_array_elements(results) x ON
     (old.ack_scope='message' OR scope='message' OR old.source_reference=x->>'reference') AND old.outcome<>x->>'outcome'
     WHERE old.source_message_id=source.id AND old.ack_family=family) THEN RAISE EXCEPTION 'ack_immutable_scope_outcome_conflict'; END IF;
  existing_status:=CASE family WHEN 'CONTRL' THEN source.contrl_status WHEN 'APERAK' THEN source.aperak_status ELSE source.utilts_err_status END;
  IF existing_status IN ('received','failed') AND NOT EXISTS(SELECT FROM gridex_ack_authority.source_correlations old WHERE old.source_message_id=source.id AND old.ack_family=family) THEN RAISE EXCEPTION 'ack_legacy_outcome_requires_original_evidence'; END IF;
  INSERT INTO gridex_ack_authority.source_correlations(ack_message_id,source_message_id,company_id,environment,ack_payload_hash,source_payload_hash,canonical_assessment_id,ack_family,ack_outcome,ack_scope,acknowledged_references,scope_outcomes,actor_user_id)
   VALUES(ack.id,source.id,p_company_id,p_environment,captured.payload_hash,source.immutable_payload_hash,canonical.id,family,outcome,scope,coalesce(refs,'[]'),results,p_actor_user_id);
  FOR result IN SELECT DISTINCT x FROM jsonb_array_elements(results) x LOOP
   INSERT INTO gridex_ack_authority.scope_outcomes(source_message_id,ack_family,ack_scope,source_reference,ack_message_id,outcome)
    VALUES(source.id,family,scope,result->>'reference',ack.id,result->>'outcome') ON CONFLICT DO NOTHING;
   IF NOT EXISTS(SELECT FROM public.ediel_ack_chains c WHERE c.company_id=p_company_id AND c.source_message_id=source.id AND c.ack_family=family AND c.ack_scope=scope AND c.transaction_reference IS NOT DISTINCT FROM CASE WHEN scope IN ('transaction','object') THEN result->>'reference' ELSE NULL END AND c.outcome=result->>'outcome') THEN
    INSERT INTO public.ediel_ack_chains(company_id,source_message_id,ack_message_id,ack_family,ack_scope,transaction_reference,outcome)
     VALUES(p_company_id,source.id,ack.id,family,scope,CASE WHEN scope IN ('transaction','object') THEN result->>'reference' ELSE NULL END,result->>'outcome');
   END IF;
  END LOOP;
 END IF;
 expected:=CASE WHEN s->>'family'='UTILTS' THEN coalesce(s->'ide','[]') ELSE coalesce(s#>'{refs,LI}','[]') END;
 whole_negative:=EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=source.id AND x.ack_family=family AND x.ack_scope IN ('message','interchange') AND x.outcome='negative');
 all_positive:=EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=source.id AND x.ack_family=family AND x.ack_scope IN ('message','interchange') AND x.outcome='positive')
  OR (jsonb_array_length(expected)>0 AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(expected) ref WHERE NOT EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=source.id AND x.ack_family=family AND x.source_reference=ref AND x.outcome='positive')));
 all_answered:=whole_negative OR EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=source.id AND x.ack_family=family AND x.ack_scope IN ('message','interchange'))
  OR (jsonb_array_length(expected)>0 AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(expected) ref WHERE NOT EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=source.id AND x.ack_family=family AND x.source_reference=ref)));
 contrl:=source.contrl_status;aperak:=source.aperak_status;utilts_err:=source.utilts_err_status;
 IF family='CONTRL' THEN contrl:=CASE WHEN whole_negative THEN 'failed' WHEN all_answered THEN 'received' ELSE contrl END;
 ELSIF family='APERAK' THEN aperak:=CASE WHEN whole_negative THEN 'failed' WHEN all_answered THEN 'received' ELSE aperak END;
 ELSE utilts_err:=CASE WHEN whole_negative THEN 'failed' ELSE 'received' END; END IF;
 final_ack:=all_answered AND (NOT source.requires_contrl OR coalesce(contrl IN ('received','sent','not_required'),false)) AND (NOT source.requires_aperak OR coalesce(aperak IN ('received','sent','not_required'),false))
  AND coalesce(utilts_err<>'pending',true);
 source_accepted:=final_ack AND (family<>'APERAK' OR all_positive) AND NOT EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=source.id AND x.outcome='negative');
 failure:=CASE WHEN whole_negative THEN family||' negative whole-source acknowledgement' ELSE source.failure_reason END;
 UPDATE public.ediel_messages SET contrl_status=contrl,aperak_status=aperak,utilts_err_status=utilts_err,
  status=CASE WHEN whole_negative THEN 'failed' WHEN source_accepted THEN 'acknowledged' ELSE status END,
  failure_reason=failure,failed_at=CASE WHEN whole_negative THEN coalesce(failed_at,now()) ELSE failed_at END,
  acknowledged_at=CASE WHEN source_accepted THEN coalesce(acknowledged_at,now()) ELSE acknowledged_at END,
  ack_due_at=CASE WHEN whole_negative OR final_ack THEN NULL ELSE ack_due_at END,updated_by=p_actor_user_id,updated_at=now()
  WHERE id=source.id AND company_id=p_company_id RETURNING * INTO source;
 UPDATE public.ediel_messages SET related_message_id=source.id,updated_by=p_actor_user_id,updated_at=now() WHERE id=ack.id AND company_id=p_company_id;
 RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(source),'outcome',outcome,'scope',scope,'scopeOutcomes',results,'finalAckReached',final_ack,'wholeSourceRejected',whole_negative,'sourceAccepted',source_accepted,'failureReason',failure,'idempotent',prior.ack_message_id IS NOT NULL);
END $$;
CREATE FUNCTION public.gridex_apply_inbound_ack_source_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'ack_source_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_ack_authority.apply_v1(p_company_id,p_environment,p_ack_message_id,p_source_message_id,p_actor_user_id);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ack_authority FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gridex_ack_authority TO service_role;
GRANT EXECUTE ON FUNCTION gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_apply_inbound_ack_source_v1(uuid,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_apply_inbound_ack_source_v1(uuid,text,uuid,uuid,uuid) TO service_role;
COMMIT;
