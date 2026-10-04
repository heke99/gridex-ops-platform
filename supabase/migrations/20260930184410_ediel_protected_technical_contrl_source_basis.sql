-- Created by Supabase CLI2.118.0. Technical syntax ACK authority is separate
-- from legal business attribution/role and from named business rule packs.
BEGIN;
CREATE SCHEMA gridex_ediel_technical_ack;
REVOKE ALL ON SCHEMA gridex_ediel_technical_ack FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_technical_ack.sources(
 source_message_id uuid PRIMARY KEY,source_company_id uuid,company_id uuid,environment text NOT NULL,
 payload_sha256 text NOT NULL,observed_at timestamptz NOT NULL,source_received_at timestamptz,
 status text NOT NULL CHECK(status IN('ready','held')),reason text,evidence jsonb NOT NULL
);
CREATE TABLE gridex_ediel_technical_ack.replies(
 source_message_id uuid PRIMARY KEY,company_id uuid NOT NULL,environment text NOT NULL,
 payload_sha256 text NOT NULL,canonical_assessment_id uuid NOT NULL,evidence jsonb NOT NULL
);
CREATE TABLE gridex_ediel_technical_ack.syntax_facets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_message_id uuid NOT NULL UNIQUE,company_id uuid NOT NULL,
 environment text NOT NULL,payload_sha256 text NOT NULL,facts_text text NOT NULL,facts_hash text NOT NULL
);
CREATE FUNCTION gridex_ediel_technical_ack.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'ediel_technical_ack_basis_immutable';END $$;
DO $$DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['sources','replies','syntax_facets'] LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_technical_ack.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE gridex_ediel_technical_ack.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON TABLE gridex_ediel_technical_ack.%I FROM PUBLIC,anon,authenticated,service_role',tab);
 EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_ediel_technical_ack.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_technical_ack.immutable()',tab);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_technical_ack.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_technical_ack.immutable()',tab);
END LOOP;END $$;
CREATE FUNCTION gridex_ediel_technical_ack.envelope(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(p_raw);u jsonb;families jsonb;ref text;indicator text;
BEGIN
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB')<>1 THEN RETURN NULL;END IF;
 SELECT x->'elements' INTO u FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB';
 ref:=u#>>'{5,0}';indicator:=coalesce(u#>>'{11,0}','');
 IF nullif(ref,'') IS NULL OR length(ref)>512 OR ref~'[[:cntrl:]]' OR nullif(u#>>'{2,0}','') IS NULL OR nullif(u#>>'{3,0}','') IS NULL
  OR indicator NOT IN('','1') THEN RETURN NULL;END IF;
 SELECT coalesce(jsonb_agg(x#>>'{elements,2,0}'),'[]') INTO families FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH';
 IF families ? 'CONTRL' THEN RETURN NULL;END IF; -- no syntax ACK loop
 RETURN jsonb_build_object('sender',u->2,'receiver',u->3,'interchangeReference',ref,'uciReference',left(ref,14),
  'applicationReference',coalesce(u#>>'{7,0}',''),'environment',CASE WHEN indicator='1' THEN 'test' ELSE 'production' END,'testIndicator',indicator);
END $$;
CREATE FUNCTION gridex_ediel_technical_ack.capture_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE observed timestamptz:=clock_timestamp();env jsonb;status text:='ready';reason text;cs uuid[];c uuid;aid uuid;facts jsonb;endpoint text;
BEGIN
 IF NEW.direction IS DISTINCT FROM 'inbound' OR nullif(NEW.raw_payload,'') IS NULL OR left(NEW.raw_payload,3) NOT IN('UNA','UNB') OR EXISTS(SELECT FROM gridex_ediel_technical_ack.sources WHERE source_message_id=NEW.id) THEN RETURN NEW;END IF;
 env:=gridex_ediel_technical_ack.envelope(NEW.raw_payload);endpoint:=env#>>'{receiver,0}';
 BEGIN
  IF env IS NULL OR env->>'environment' IS DISTINCT FROM NEW.environment THEN RAISE EXCEPTION 'ediel_technical_endpoint_unqualified';END IF;
  -- A unique actual assigned local TECHNICAL endpoint. Identifiers describe
  -- endpoint ownership here; they never substitute a business NAD actor/role.
  SELECT array_agg(DISTINCT x.company_id) INTO cs FROM (
   SELECT i.company_id FROM public.tenant_actor_identifiers i WHERE i.environment=NEW.environment AND i.identifier_type='EdielId' AND i.identifier_value=endpoint
    AND i.valid_from<=observed AND (i.valid_to IS NULL OR observed<i.valid_to)
    AND NOT EXISTS(SELECT FROM public.tenant_counterparty_relations r WHERE r.company_id=i.company_id AND r.environment=i.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=observed AND (r.valid_to IS NULL OR observed<r.valid_to))
   UNION ALL SELECT r.company_id FROM public.tenant_counterparty_relations r JOIN public.platform_actor_identifiers i ON i.actor_id=r.counterparty_actor_id
    WHERE r.environment=NEW.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=observed AND (r.valid_to IS NULL OR observed<r.valid_to)
     AND i.identifier_type='EdielId' AND i.identifier_value=endpoint AND (i.valid_from IS NULL OR i.valid_from<=observed::date) AND (i.valid_to IS NULL OR observed::date<=i.valid_to)
  )x;
  IF cardinality(cs) IS DISTINCT FROM 1 OR (NEW.company_id IS NOT NULL AND NEW.company_id IS DISTINCT FROM cs[1]) THEN RAISE EXCEPTION 'ediel_technical_endpoint_unqualified';END IF;c:=cs[1];
  PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=NEW.environment ORDER BY i.id FOR SHARE;
  PERFORM r.id FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=NEW.environment ORDER BY r.id FOR SHARE;
  IF (SELECT count(*) FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=NEW.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=observed AND (r.valid_to IS NULL OR observed<r.valid_to))>1 THEN RAISE EXCEPTION 'ediel_technical_endpoint_unqualified';END IF;
  SELECT min(x.actor_id::text)::uuid INTO aid FROM (
   SELECT i.actor_id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=NEW.environment AND i.identifier_type='EdielId' AND i.identifier_value=endpoint AND i.valid_from<=observed AND (i.valid_to IS NULL OR observed<i.valid_to)
    AND NOT EXISTS(SELECT FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=NEW.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=observed AND (r.valid_to IS NULL OR observed<r.valid_to))
   UNION ALL SELECT r.counterparty_actor_id FROM public.tenant_counterparty_relations r JOIN public.platform_actor_identifiers i ON i.actor_id=r.counterparty_actor_id WHERE r.company_id=c AND r.environment=NEW.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=observed AND (r.valid_to IS NULL OR observed<r.valid_to) AND i.identifier_type='EdielId' AND i.identifier_value=endpoint AND (i.valid_from IS NULL OR i.valid_from<=observed::date) AND (i.valid_to IS NULL OR observed::date<=i.valid_to)
  )x HAVING count(DISTINCT x.actor_id)=1;
  IF aid IS NULL THEN RAISE EXCEPTION 'ediel_technical_endpoint_unqualified';END IF;
  facts:=jsonb_build_object('tenantIdentifiers',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=NEW.environment),'transportRelations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=NEW.environment AND r.relation_type='ediel_transport_agent'),'platformIdentifiers',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.platform_actor_identifiers i WHERE i.actor_id=aid AND i.identifier_type='EdielId'));
 EXCEPTION WHEN OTHERS THEN status:='held';reason:='ediel_technical_endpoint_unqualified';END;
 INSERT INTO gridex_ediel_technical_ack.sources VALUES(NEW.id,NEW.company_id,c,NEW.environment,encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'),observed,NEW.message_received_at,status,reason,
  jsonb_build_object('kind','technical_syntax_ack','version',1,'companyId',c,'environment',NEW.environment,'sourceMessageId',NEW.id,'sourceHash',encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'),'observedAt',observed,'originalUNB',env,'transportActorId',aid,'transportEdielId',endpoint,'endpointFacts',facts));
 RETURN NEW;
END $$;
CREATE TRIGGER ediel_capture_technical_source AFTER INSERT OR UPDATE OF raw_payload ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_technical_ack.capture_source();
CREATE FUNCTION gridex_ediel_technical_ack.require_source_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;b gridex_ediel_technical_ack.sources%rowtype;r gridex_ediel_technical_ack.replies%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND direction='inbound' FOR SHARE;
 SELECT * INTO b FROM gridex_ediel_technical_ack.sources WHERE source_message_id=m.id;
 SELECT * INTO r FROM gridex_ediel_technical_ack.replies WHERE source_message_id=m.id;
 IF m.id IS NULL OR b.source_message_id IS NULL OR r.source_message_id IS NULL THEN RAISE EXCEPTION 'ediel_historical_technical_ack_basis_unavailable';END IF;
 IF b.status<>'ready' OR b.company_id IS DISTINCT FROM p_company_id OR (m.company_id IS NOT NULL AND m.company_id IS DISTINCT FROM b.company_id) OR b.environment IS DISTINCT FROM m.environment
  OR b.source_received_at IS DISTINCT FROM m.message_received_at OR b.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR r.payload_sha256 IS DISTINCT FROM b.payload_sha256 THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 RETURN r.evidence;
END $$;
CREATE FUNCTION gridex_ediel_technical_ack.record_syntax_v1(p_company_id uuid,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;b gridex_ediel_technical_ack.sources%rowtype;f jsonb;prior gridex_ediel_technical_ack.syntax_facets%rowtype;facet_id uuid;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND direction='inbound' FOR UPDATE;
 SELECT * INTO b FROM gridex_ediel_technical_ack.sources WHERE source_message_id=m.id;
 IF m.id IS NULL OR b.source_message_id IS NULL THEN RAISE EXCEPTION 'ediel_historical_technical_ack_basis_unavailable';END IF;
 IF b.status<>'ready' OR b.company_id IS DISTINCT FROM p_company_id OR (m.company_id IS NOT NULL AND m.company_id IS DISTINCT FROM p_company_id)
  OR b.environment IS DISTINCT FROM m.environment OR b.payload_sha256 IS DISTINCT FROM p_source_payload_hash
  OR p_source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR p_facts_text IS NULL OR octet_length(p_facts_text)>65536 THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 f:=p_facts_text::jsonb;
 IF jsonb_typeof(f)<>'object' OR f-ARRAY['version','owner','syntaxDecision','reasonCodes']<>'{}'::jsonb OR f->'version' IS DISTINCT FROM '1'::jsonb
  OR f->>'owner' IS DISTINCT FROM 'canonical-runtime-syntax-v1' OR (f->>'syntaxDecision' IS NULL OR f->>'syntaxDecision' NOT IN('accepted','rejected'))
  OR jsonb_typeof(f->'reasonCodes') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'reasonCodes')>128
  OR EXISTS(SELECT FROM jsonb_array_elements(f->'reasonCodes')r WHERE jsonb_typeof(r)<>'string' OR r#>>'{}'!~'^[A-Za-z0-9_.:-]{1,128}$') THEN RAISE EXCEPTION 'ediel_technical_syntax_owner_required';END IF;
 SELECT * INTO prior FROM gridex_ediel_technical_ack.syntax_facets WHERE source_message_id=m.id;
 IF FOUND THEN
  IF prior.company_id IS DISTINCT FROM p_company_id OR prior.environment IS DISTINCT FROM m.environment OR prior.payload_sha256 IS DISTINCT FROM p_source_payload_hash OR prior.facts_text IS DISTINCT FROM p_facts_text THEN RAISE EXCEPTION 'ediel_technical_syntax_outcome_immutable';END IF;
  facet_id:=prior.id;
 ELSE
  INSERT INTO gridex_ediel_technical_ack.syntax_facets(source_message_id,company_id,environment,payload_sha256,facts_text,facts_hash)
   VALUES(m.id,p_company_id,m.environment,p_source_payload_hash,p_facts_text,encode(sha256(convert_to(p_facts_text,'UTF8')),'hex')) RETURNING syntax_facets.id INTO facet_id;
 END IF;
 RETURN jsonb_build_object('syntaxAssessmentId',facet_id,'scope','canonical_syntax_only','authorizesBusinessEffect',false);
END $$;
CREATE FUNCTION public.ediel_record_technical_syntax_facet_v1(p_company_id uuid,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;RETURN gridex_ediel_technical_ack.record_syntax_v1(p_company_id,p_source_message_id,p_source_payload_hash,p_facts_text);END $$;

CREATE FUNCTION gridex_ediel_technical_ack.capture_reply_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;b gridex_ediel_technical_ack.sources%rowtype;v gridex_received_sources.validation_assessments%rowtype;facet gridex_ediel_technical_ack.syntax_facets%rowtype;facts jsonb;evidence jsonb;assessment uuid;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND (company_id=p_company_id OR company_id IS NULL) AND direction='inbound' FOR UPDATE;
 IF EXISTS(SELECT FROM gridex_ediel_technical_ack.replies WHERE source_message_id=m.id) THEN RETURN gridex_ediel_technical_ack.require_source_v1(p_company_id,m.id);END IF;
 SELECT * INTO b FROM gridex_ediel_technical_ack.sources WHERE source_message_id=m.id;
 IF m.id IS NULL OR b.source_message_id IS NULL THEN RAISE EXCEPTION 'ediel_historical_technical_ack_basis_unavailable';END IF;
 IF b.status<>'ready' OR b.company_id IS DISTINCT FROM p_company_id OR b.environment IS DISTINCT FROM m.environment OR b.source_received_at IS DISTINCT FROM m.message_received_at
  OR b.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 SELECT a.* INTO facet FROM gridex_ediel_technical_ack.syntax_facets a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment AND a.payload_sha256=b.payload_sha256
  AND a.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) FOR SHARE;
 IF facet.id IS NOT NULL THEN
  IF facet.facts_hash IS DISTINCT FROM encode(sha256(convert_to(facet.facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
  facts:=facet.facts_text::jsonb;assessment:=facet.id;
 ELSE
  SELECT a.* INTO v FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment AND a.source_payload_hash=b.payload_sha256
   AND a.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296)
   AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id) FOR SHARE;
  IF v.id IS NULL OR v.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR v.facts_hash IS DISTINCT FROM encode(sha256(convert_to(v.facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
  facts:=v.facts_text::jsonb;assessment:=v.id;
 END IF;
 IF (facts->>'syntaxDecision' IS NULL OR facts->>'syntaxDecision' NOT IN('accepted','rejected')) THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 evidence:=b.evidence||jsonb_build_object('syntaxAssessmentId',assessment,'syntaxDecision',facts->>'syntaxDecision');
 INSERT INTO gridex_ediel_technical_ack.replies VALUES(m.id,p_company_id,m.environment,b.payload_sha256,assessment,evidence);
 RETURN evidence;
END $$;
CREATE FUNCTION gridex_ediel_technical_ack.require_current_endpoint_v1(evidence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid:=(evidence->>'companyId')::uuid;env text:=evidence->>'environment';aid uuid:=(evidence->>'transportActorId')::uuid;endpoint text:=evidence->>'transportEdielId';observed timestamptz:=clock_timestamp();n integer;companies uuid[];
BEGIN
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=env ORDER BY i.id FOR SHARE;
 PERFORM r.id FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=env ORDER BY r.id FOR SHARE;
 PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.actor_id=aid ORDER BY i.id FOR SHARE;
 SELECT array_agg(DISTINCT x.company_id) INTO companies FROM (
  SELECT i.company_id FROM public.tenant_actor_identifiers i WHERE i.environment=env AND i.identifier_type='EdielId' AND i.identifier_value=endpoint
   AND i.valid_from<=observed AND (i.valid_to IS NULL OR observed<i.valid_to)
   AND NOT EXISTS(SELECT FROM public.tenant_counterparty_relations r WHERE r.company_id=i.company_id AND r.environment=env AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=observed AND (r.valid_to IS NULL OR observed<r.valid_to))
  UNION ALL SELECT r.company_id FROM public.tenant_counterparty_relations r JOIN public.platform_actor_identifiers i ON i.actor_id=r.counterparty_actor_id
   WHERE r.environment=env AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=observed AND (r.valid_to IS NULL OR observed<r.valid_to)
    AND i.identifier_type='EdielId' AND i.identifier_value=endpoint AND (i.valid_from IS NULL OR i.valid_from<=observed::date) AND (i.valid_to IS NULL OR observed::date<=i.valid_to)
 )x;
 IF cardinality(companies) IS DISTINCT FROM 1 OR companies[1] IS DISTINCT FROM c THEN RAISE EXCEPTION 'ediel_technical_endpoint_unqualified';END IF;
 SELECT count(*) INTO n FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=env AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=observed AND (r.valid_to IS NULL OR observed<r.valid_to);
 IF n=0 THEN
  IF NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=env AND i.actor_id=aid AND i.identifier_type='EdielId' AND i.identifier_value=endpoint AND i.valid_from<=observed AND (i.valid_to IS NULL OR observed<i.valid_to)) THEN RAISE EXCEPTION 'ediel_technical_endpoint_unqualified';END IF;
 ELSIF n=1 THEN
  IF NOT EXISTS(SELECT FROM public.tenant_counterparty_relations r JOIN public.platform_actor_identifiers i ON i.actor_id=r.counterparty_actor_id WHERE r.company_id=c AND r.environment=env AND r.counterparty_actor_id=aid AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=observed AND (r.valid_to IS NULL OR observed<r.valid_to) AND i.identifier_type='EdielId' AND i.identifier_value=endpoint AND (i.valid_from IS NULL OR i.valid_from<=observed::date) AND (i.valid_to IS NULL OR observed::date<=i.valid_to)) THEN RAISE EXCEPTION 'ediel_technical_endpoint_unqualified';END IF;
 ELSE RAISE EXCEPTION 'ediel_technical_endpoint_unqualified';END IF;
END $$;

CREATE FUNCTION gridex_ediel_technical_ack.require_contrl_v1(m public.ediel_messages) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;evidence jsonb;u jsonb;uci jsonb;tokens jsonb;expected text;header jsonb;trailer jsonb;interchange_trailer jsonb;message_count integer;
BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'CONTRL' OR m.related_message_id IS NULL THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND direction='inbound' FOR SHARE;
 evidence:=gridex_ediel_technical_ack.require_source_v1(m.company_id,source.id);
 PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(evidence);
 IF m.environment IS DISTINCT FROM evidence->>'environment' THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNB')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UCI')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH' AND x#>>'{elements,2,0}'='CONTRL' AND x#>>'{elements,2,1}'='2' AND x#>>'{elements,2,2}'='2' AND x#>>'{elements,2,3}'='UN')<>1 THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNT')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNZ')<>1 THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 SELECT x->'elements' INTO header FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH';
 SELECT x->'elements' INTO trailer FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNT';
 SELECT x->'elements' INTO interchange_trailer FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNZ';
 SELECT count(*) INTO message_count FROM jsonb_array_elements(tokens)x WHERE x->>'tag' NOT IN('UNA','UNB','UNZ');
 SELECT x->'elements' INTO u FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNB';
 SELECT x->'elements' INTO uci FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UCI';
 IF nullif(header#>>'{1,0}','') IS NULL OR trailer#>>'{2,0}' IS DISTINCT FROM header#>>'{1,0}' OR trailer#>>'{1,0}' IS DISTINCT FROM message_count::text
  OR interchange_trailer#>>'{1,0}' IS DISTINCT FROM '1' OR interchange_trailer#>>'{2,0}' IS DISTINCT FROM u#>>'{5,0}' THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 expected:=CASE WHEN evidence->>'syntaxDecision'='accepted' THEN '1' ELSE '4' END;
 IF u->2 IS DISTINCT FROM evidence#>'{originalUNB,receiver}' OR u->3 IS DISTINCT FROM evidence#>'{originalUNB,sender}'
  OR coalesce(u#>>'{7,0}','') IS DISTINCT FROM evidence#>>'{originalUNB,applicationReference}' OR coalesce(u#>>'{11,0}','') IS DISTINCT FROM evidence#>>'{originalUNB,testIndicator}'
  OR uci#>>'{1,0}' IS DISTINCT FROM evidence#>>'{originalUNB,uciReference}' OR uci->2 IS DISTINCT FROM evidence#>'{originalUNB,sender}' OR uci->3 IS DISTINCT FROM evidence#>'{originalUNB,receiver}' OR uci#>>'{4,0}' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 -- Source-prescribed first14 projection must still identify one original wire
 -- globally, including preserved rows predating this prospective ledger.
 IF (SELECT count(*) FROM public.ediel_messages old CROSS JOIN LATERAL(SELECT gridex_ediel_technical_ack.envelope(old.raw_payload)e)p
  WHERE old.direction='inbound' AND p.e IS NOT NULL AND p.e->>'environment'=m.environment AND p.e->'sender'=evidence#>'{originalUNB,sender}' AND p.e->'receiver'=evidence#>'{originalUNB,receiver}' AND p.e->>'applicationReference'=evidence#>>'{originalUNB,applicationReference}' AND p.e->>'uciReference'=evidence#>>'{originalUNB,uciReference}')<>1 THEN RAISE EXCEPTION 'ediel_technical_ack_original_ambiguous';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(tokens)cm WHERE cm->>'tag'='UCM' AND NOT EXISTS(SELECT FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(source.raw_payload))h WHERE h->>'tag'='UNH' AND h#>>'{elements,1,0}'=cm#>>'{elements,1,0}')) THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 RETURN evidence;
END $$;
CREATE FUNCTION gridex_ediel_technical_ack.read_endpoint_v1(p_source_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;b gridex_ediel_technical_ack.sources%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND direction='inbound' FOR SHARE;
 SELECT * INTO b FROM gridex_ediel_technical_ack.sources WHERE source_message_id=m.id;
 IF m.id IS NULL OR b.source_message_id IS NULL OR b.status<>'ready' OR (m.company_id IS NOT NULL AND m.company_id IS DISTINCT FROM b.company_id)
  OR m.environment IS DISTINCT FROM b.environment OR b.source_received_at IS DISTINCT FROM m.message_received_at OR b.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('kind','technical_endpoint_only','companyId',b.company_id,'environment',b.environment,'sourceMessageId',m.id,'sourceHash',b.payload_sha256,'transportEdielId',b.evidence->'transportEdielId','originalUNB',b.evidence->'originalUNB','authorizesBusinessEffect',false);
END $$;
CREATE FUNCTION public.ediel_read_technical_source_endpoint_v1(p_source_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;RETURN gridex_ediel_technical_ack.read_endpoint_v1(p_source_message_id);END $$;

CREATE FUNCTION public.ediel_capture_technical_syntax_ack_basis_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;RETURN gridex_ediel_technical_ack.capture_reply_v1(p_company_id,p_message_id);END $$;
CREATE FUNCTION public.ediel_require_technical_syntax_ack_basis_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;RETURN gridex_ediel_technical_ack.require_source_v1(p_company_id,p_message_id);END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_technical_ack FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gridex_ediel_technical_ack TO service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_technical_ack.capture_reply_v1(uuid,uuid),gridex_ediel_technical_ack.require_source_v1(uuid,uuid),gridex_ediel_technical_ack.record_syntax_v1(uuid,uuid,text,text),gridex_ediel_technical_ack.read_endpoint_v1(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_capture_technical_syntax_ack_basis_v1(uuid,uuid),public.ediel_require_technical_syntax_ack_basis_v1(uuid,uuid),public.ediel_record_technical_syntax_facet_v1(uuid,uuid,text,text),public.ediel_read_technical_source_endpoint_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_capture_technical_syntax_ack_basis_v1(uuid,uuid),public.ediel_require_technical_syntax_ack_basis_v1(uuid,uuid),public.ediel_record_technical_syntax_facet_v1(uuid,uuid,text,text),public.ediel_read_technical_source_endpoint_v1(uuid) TO service_role;

create or replace function public.gridex_capture_ediel_rule_pack_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile_rule_pack_id uuid;
begin
  -- A protected technical CONTRL does not borrow a nonexistent businesspack.
  -- The actual original syntax owner and qualified endpoint/wire scope suffice.
  if new.direction='outbound' and new.message_family='CONTRL' then
    perform gridex_ediel_technical_ack.require_contrl_v1(new);
    return new;
  end if;
  if new.direction='outbound' and new.message_family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR') then
    if new.company_id is null then
      raise exception 'outbound_ediel_company_id_required' using errcode='23502';
    end if;

    if nullif(new.rule_profile_key,'') is null or new.rule_profile_version_id is null
       or nullif(new.rule_profile_version,'') is null or nullif(new.rule_pack_checksum,'') is null
       or coalesce(new.rule_pack_snapshot,'{}'::jsonb)='{}'::jsonb then
      raise exception 'outbound_ediel_rule_pack_snapshot_required' using errcode='23514';
    end if;

    select mp.rule_pack_id into v_profile_rule_pack_id
    from public.ediel_message_profiles mp
    where mp.id = new.rule_profile_version_id
      and mp.is_enabled = true;

    if v_profile_rule_pack_id is null then
      raise exception 'canonical_ediel_message_profile_required:%', new.rule_profile_version_id using errcode='23503';
    end if;

    if new.canonical_rule_pack_id is null or new.canonical_rule_pack_id <> v_profile_rule_pack_id then
      raise exception 'canonical_ediel_rule_pack_profile_mismatch:%:%', coalesce(new.canonical_rule_pack_id::text,'null'), v_profile_rule_pack_id::text using errcode='23514';
    end if;

    insert into public.ediel_rule_pack_snapshots(
      company_id,ediel_message_id,profile_key,rule_profile_version_id,profile_version,checksum,snapshot
    ) values (
      new.company_id,new.id,new.rule_profile_key,new.rule_profile_version_id,new.rule_profile_version,new.rule_pack_checksum,new.rule_pack_snapshot
    ) on conflict(ediel_message_id) do update set
      company_id=excluded.company_id,
      profile_key=excluded.profile_key,
      rule_profile_version_id=excluded.rule_profile_version_id,
      profile_version=excluded.profile_version,
      checksum=excluded.checksum,
      snapshot=excluded.snapshot;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION gridex_ediel_wire_namespace.keys(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb; unb jsonb; unh jsonb; token jsonb; sender text; legal_sender text; application text; interchange text; family text; output jsonb:='[]'; value text; kind text; key jsonb;
BEGIN
 tokens:=gridex_utilts_binding.wire_tokens_v1(p_raw);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH')<>1 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 SELECT x INTO unb FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB';
 SELECT x INTO unh FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH';
 sender:=nullif(unb#>>'{elements,2,0}',''); application:=nullif(unb#>>'{elements,7,0}',''); interchange:=nullif(unb#>>'{elements,5,0}',''); family:=unh#>>'{elements,2,0}';
 IF sender IS NULL OR (application IS NULL AND family<>'CONTRL') OR interchange IS NULL OR char_length(interchange)>14 OR family NOT IN('PRODAT','UTILTS','APERAK','CONTRL') THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 SELECT min(x#>>'{elements,2,0}') INTO legal_sender FROM jsonb_array_elements(tokens) x
  WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=CASE WHEN family='PRODAT' THEN 'FR' ELSE 'MS' END;
 IF (SELECT count(DISTINCT x#>>'{elements,2,0}') FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=CASE WHEN family='PRODAT' THEN 'FR' ELSE 'MS' END)>1 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 legal_sender:=coalesce(nullif(legal_sender,''),sender);application:=coalesce(application,'');
 -- UNB is unique for the technical sender across applications/subaddresses.
 output:=jsonb_build_array(jsonb_build_object('sender',sender,'application','','kind','UNB','value',interchange));
 FOR token IN SELECT x FROM jsonb_array_elements(tokens) x WHERE x->>'tag' IN('UNH','BGM','IDE','RFF') LOOP
  kind:=NULL;value:=NULL;
  CASE token->>'tag'
   WHEN 'UNH' THEN kind:='UNH';value:=token#>>'{elements,1,0}';
   WHEN 'BGM' THEN kind:='BGM';value:=token#>>'{elements,2,0}';
   WHEN 'IDE' THEN kind:='IDE';value:=token#>>'{elements,2,0}';
   WHEN 'RFF' THEN
    IF token#>>'{elements,1,0}'='DM' THEN kind:='DM';value:=coalesce(nullif(token#>>'{elements,1,1}',''),token#>>'{elements,2,0}'); END IF;
   ELSE NULL;
  END CASE;
  IF kind IS NOT NULL THEN
   IF nullif(value,'') IS NULL OR char_length(value)>35 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
   key:=jsonb_build_object('sender',CASE WHEN kind='UNH' THEN sender ELSE legal_sender END,'application',CASE WHEN kind='UNH' THEN interchange ELSE application END,'kind',kind,'value',value);
   IF output @> jsonb_build_array(key) THEN RAISE EXCEPTION 'ediel_wire_reference_duplicate_in_source'; END IF;
   output:=output||jsonb_build_array(key);
  END IF;
 END LOOP;
 RETURN output;
END $$;


CREATE OR REPLACE FUNCTION gridex_ediel_source_rules.capture_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.ediel_messages%rowtype; original public.ediel_messages%rowtype;
 profile public.ediel_message_profiles%rowtype; pack public.ediel_rule_packs%rowtype;
 basis gridex_ediel_source_rules.receipts%rowtype; assessment gridex_received_sources.validation_assessments%rowtype;
 context jsonb; facts jsonb; expected jsonb; evidence jsonb; snapshot jsonb; sources jsonb; observed timestamptz:=clock_timestamp();version text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR nullif(m.raw_payload,'') IS NULL OR m.environment NOT IN('test','production') OR m.direction NOT IN('inbound','outbound') THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required'; END IF;
 SELECT * INTO basis FROM gridex_ediel_source_rules.receipts WHERE source_message_id=m.id;
 IF FOUND THEN RETURN gridex_ediel_source_rules.require_v1(p_company_id,p_message_id); END IF;
 -- This is only a first-effect/prepare capture of a genuinely prospective
 -- source. The original identity receipt already froze its persistence clock.
 IF m.message_sent_at IS NOT NULL THEN RAISE EXCEPTION 'ediel_historical_rule_pack_basis_unavailable'; END IF;
 context:=gridex_ediel_inbound_context.require_v1(p_company_id,p_message_id);
 IF context->>'basisKind'='prescribed_outbound_ack' THEN
  SELECT * INTO original FROM public.ediel_messages WHERE id=(context->>'originalSourceMessageId')::uuid AND company_id=p_company_id AND environment=m.environment AND direction='inbound' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_historical_rule_pack_basis_unavailable'; END IF;
  evidence:=gridex_ediel_source_rules.require_v1(p_company_id,original.id);
  IF m.canonical_rule_pack_id::text IS DISTINCT FROM evidence->>'rulePackId' OR m.rule_profile_version_id::text IS DISTINCT FROM evidence->>'messageProfileId'
   OR m.rule_profile_version IS DISTINCT FROM evidence->>'version' OR m.rule_pack_checksum IS DISTINCT FROM evidence->>'sourceHash' THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required'; END IF;
  INSERT INTO gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,original_source_message_id,evidence)
   VALUES(m.id,m.company_id,m.environment,m.direction,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),original.id,evidence);
  RETURN evidence;
 END IF;
 IF m.message_family NOT IN('PRODAT','UTILTS') OR context->>'family' IS DISTINCT FROM m.message_family OR context->>'code' IS DISTINCT FROM m.message_code THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required'; END IF;
 IF m.direction='inbound' THEN
  SELECT a.* INTO assessment FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment
   AND a.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id)
   AND a.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) FOR SHARE;
  IF NOT FOUND OR assessment.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR assessment.facts_hash IS DISTINCT FROM encode(sha256(convert_to(assessment.facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;
  facts:=assessment.facts_text::jsonb;expected:=facts->'rulePackEvidence';
  IF facts->>'owner' IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR jsonb_typeof(expected) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;
  SELECT * INTO profile FROM public.ediel_message_profiles WHERE id::text=expected->>'messageProfileId' AND profile_key=expected->>'profileKey' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;
  SELECT * INTO pack FROM public.ediel_rule_packs WHERE id=profile.rule_pack_id AND id::text=expected->>'rulePackId' AND source_hash=expected->>'sourceHash' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;
  -- The owner's exact accepted original version and named-row snapshot are
  -- part of its immutable facet. Today's matching IDs/hash cannot recreate
  -- a version/profile whose mutable named fields changed before first effect.
  version:=expected->>'version';
  IF nullif(version,'') IS NULL OR jsonb_typeof(expected->'snapshot') IS DISTINCT FROM 'object'
   OR expected#>'{snapshot,rulePack}' IS DISTINCT FROM to_jsonb(pack)
   OR expected#>'{snapshot,messageProfile}' IS DISTINCT FROM to_jsonb(profile) THEN RAISE EXCEPTION 'ediel_historical_rule_pack_basis_unavailable';END IF;
  PERFORM s.id FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=pack.id ORDER BY s.id FOR SHARE;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') INTO sources FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=pack.id;
  IF expected#>'{snapshot,guideSources}' IS DISTINCT FROM sources THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;
 ELSE
  SELECT * INTO profile FROM public.ediel_message_profiles WHERE id=m.rule_profile_version_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;
  SELECT * INTO pack FROM public.ediel_rule_packs WHERE id=profile.rule_pack_id FOR SHARE;
  IF NOT FOUND OR pack.id IS DISTINCT FROM m.canonical_rule_pack_id OR pack.source_hash IS DISTINCT FROM m.rule_pack_checksum
   OR nullif(m.rule_profile_key,'') IS NULL OR nullif(m.rule_profile_version,'') IS NULL OR jsonb_typeof(m.rule_pack_snapshot) IS DISTINCT FROM 'object'
   OR m.rule_pack_snapshot->>'profileKey' IS DISTINCT FROM m.rule_profile_key OR m.rule_pack_snapshot->>'profileVersionId' IS DISTINCT FROM profile.id::text
   OR m.rule_pack_snapshot->>'version' IS DISTINCT FROM m.rule_profile_version OR m.rule_pack_snapshot->>'checksum' IS DISTINCT FROM pack.source_hash THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;
  version:=m.rule_profile_version;
 END IF;
 IF pack.family IS DISTINCT FROM m.message_family OR pack.market IS DISTINCT FROM 'electricity' OR NOT profile.is_enabled OR profile.message_code IS DISTINCT FROM m.message_code OR profile.direction NOT IN(m.direction,'both')
  OR coalesce(profile.transaction_subtype,'') IS DISTINCT FROM coalesce(context->>'subtype','') OR pack.status NOT IN('active','transition')
  OR pack.valid_from>observed::date OR (pack.valid_to IS NOT NULL AND pack.valid_to<observed::date) OR nullif(version,'') IS NULL THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;
 expected:=jsonb_build_object('profileKey',profile.profile_key,'messageProfileId',profile.id,'rulePackId',pack.id,'sourceHash',pack.source_hash);
 -- Freeze the exact NAMED rows. No latest pack or independent ACK profile is
 -- selected and no caller binding or historical public snapshot is authority.
 PERFORM s.id FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=pack.id ORDER BY s.id FOR SHARE;
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') INTO sources FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=pack.id;
 snapshot:=jsonb_build_object('profileKey',profile.profile_key,'profileVersionId',profile.id,'version',version,'checksum',pack.source_hash,
  'originalMessageSnapshot',m.rule_pack_snapshot,'rulePack',to_jsonb(pack),'messageProfile',to_jsonb(profile),'guideSources',sources,'identitySourceEdition',context->'sourceEdition');
 evidence:=expected||jsonb_build_object('version',version,'snapshot',snapshot);
 INSERT INTO gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,canonical_assessment_id,evidence)
  VALUES(m.id,m.company_id,m.environment,m.direction,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),assessment.id,evidence);
 RETURN evidence;
END $$;

-- Existing replay cursor handles exact established prior observations FIRST.
-- New native prepare/enter writes are rolled back unless protected authority is
-- present and identical to the actual journal binding, before provider I/O.
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_original_basis_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;evidence jsonb;attempt gridex_ediel_transport.attempts%rowtype;r gridex_ediel_transport.reservations%rowtype;actor uuid:=(p_input->>'actorUserId')::uuid;
BEGIN
 IF p_input->>'action'='enter' THEN
  SELECT * INTO m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR UPDATE;
  SELECT * INTO r FROM gridex_ediel_transport.reservations WHERE message_id=m.id FOR UPDATE;
  IF r.state IN('entered','observed') THEN
   SELECT * INTO attempt FROM gridex_ediel_transport.attempts WHERE id=r.attempt_id AND id=(p_input->>'attemptId')::uuid AND message_id=m.id AND company_id=m.company_id AND environment=m.environment AND actor_user_id=actor FOR SHARE;
   IF attempt.id IS NULL OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR attempt.binding->>'originalHash' IS DISTINCT FROM m.immutable_payload_hash
    OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
    OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(actor,m.company_id,'communication.send'),false) THEN RAISE EXCEPTION 'ediel_transport_replay_scope_invalid';END IF;
   RETURN jsonb_build_object('proceed',false,'state',r.state);
  END IF;
 END IF;
 result:=gridex_ediel_transport.mutate_before_original_basis_v1(p_input);
 IF p_input->>'action' NOT IN('prepare','enter') OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR UPDATE;
 IF m.message_family NOT IN('PRODAT','UTILTS','APERAK','UTILTS_ERR','CONTRL') THEN RETURN result;END IF;
 IF m.message_family='CONTRL' THEN
  evidence:=gridex_ediel_technical_ack.require_contrl_v1(m);
  IF p_input->>'action'='prepare' AND p_input#>'{binding,technicalSyntaxAckEvidence}' IS DISTINCT FROM evidence THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 ELSE
  evidence:=gridex_ediel_source_rules.capture_v1(m.company_id,m.id);
  IF p_input->>'action'='prepare' AND p_input#>'{binding,sourceRulePackEvidence}' IS DISTINCT FROM evidence THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;
 END IF;
 SELECT * INTO STRICT attempt FROM gridex_ediel_transport.attempts WHERE id=(p_input->>'attemptId')::uuid AND message_id=m.id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
 IF m.message_family='CONTRL' AND attempt.binding->'technicalSyntaxAckEvidence' IS DISTINCT FROM evidence OR m.message_family<>'CONTRL' AND attempt.binding->'sourceRulePackEvidence' IS DISTINCT FROM evidence THEN RAISE EXCEPTION 'ediel_transport_original_basis_binding_required';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_before_original_basis_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb) TO service_role;
COMMIT;
