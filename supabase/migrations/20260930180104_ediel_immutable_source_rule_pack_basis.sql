-- Created by actual Supabase CLI2.118.0. Prospective immutable named authority.
-- Old sent originals are deliberately not backfilled from mutable metadata.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_ediel_inbound_context.derive(m public.ediel_messages,p_observed_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE tokens jsonb; family text; code text; reason text; reasons jsonb; own_projection jsonb; edition text; role_key text;
 legal_id text; wire_transport text; application text; test_indicator text; legal_qualifier text; legal_count integer;
 c uuid; candidates uuid[]; actor uuid; role text; roles integer; transport_actor uuid; transport_id text;
 profile public.tenant_ediel_profiles%rowtype; relation public.tenant_counterparty_relations%rowtype;
 source public.ediel_messages%rowtype; basis gridex_ediel_inbound_context.receipts%rowtype; facts jsonb;
BEGIN
 IF m.company_id IS NULL OR m.environment NOT IN('test','production') OR m.direction NOT IN('inbound','outbound') THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH')<>1 THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 SELECT x#>>'{elements,2,0}' INTO family FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH';
 SELECT x#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='BGM';
 SELECT x#>>'{elements,7,0}',coalesce(x#>>'{elements,11,0}',''),x#>>ARRAY['elements',CASE WHEN m.direction='inbound' THEN '3' ELSE '2' END,'0'] INTO application,test_indicator,wire_transport FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB';
 IF test_indicator NOT IN('','1') OR m.environment IS DISTINCT FROM (CASE WHEN test_indicator='1' THEN 'test' ELSE 'production' END) OR nullif(wire_transport,'') IS NULL THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 -- An outgoing prescribed ACK inherits the original local recipient's genuine
 -- basis; ordinary E66 receiver roles are never applied to reverse ACK traffic.
 IF m.direction='outbound' AND (family IN('APERAK','CONTRL') OR family='UTILTS' AND code='ERR') THEN
  SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND company_id=m.company_id AND environment=m.environment AND direction='inbound' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_historical_identity_basis_unavailable'; END IF;
  SELECT * INTO basis FROM gridex_ediel_inbound_context.receipts WHERE source_message_id=source.id;
  IF NOT FOUND OR basis.status<>'ready' OR basis.direction<>'inbound' OR basis.payload_sha256 IS DISTINCT FROM encode(digest(convert_to(source.raw_payload,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'ediel_historical_identity_basis_unavailable'; END IF;
  IF wire_transport IS DISTINCT FROM basis.context->>'transportEdielId' OR application IS DISTINCT FROM basis.context->>'applicationReference' THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
  IF family<>'CONTRL' THEN
   legal_qualifier:=CASE WHEN basis.context->>'family'='PRODAT' THEN 'FR' ELSE 'MS' END;
   SELECT count(DISTINCT x#>>'{elements,2,0}'),min(x#>>'{elements,2,0}') INTO legal_count,legal_id FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=legal_qualifier;
   IF legal_count<>1 OR legal_id IS DISTINCT FROM basis.context->>'legalEdielId' THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
  END IF;
  RETURN basis.context||jsonb_build_object('basisKind','prescribed_outbound_ack','originalSourceMessageId',source.id,'originalSourceHash',basis.payload_sha256,'direction','outbound','wireFamily',family,'wireCode',code);
 END IF;
 IF family NOT IN('PRODAT','UTILTS') OR family IS DISTINCT FROM m.message_family OR code IS DISTINCT FROM m.message_code THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 IF family='PRODAT' THEN
  SELECT coalesce(jsonb_agg(DISTINCT cav.token#>>'{elements,1,0}'),'[]') INTO reasons FROM jsonb_array_elements(tokens) WITH ORDINALITY cci(token,n)
   JOIN jsonb_array_elements(tokens) WITH ORDINALITY cav(token,n) ON cav.n=cci.n+1 WHERE cci.token->>'tag'='CCI' AND cci.token#>>'{elements,2,0}'='Z13' AND cav.token->>'tag'='CAV';
  IF jsonb_array_length(reasons)<>1 THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;reason:=reasons->>0;
 END IF;
 SELECT e.source_version,p INTO edition,own_projection FROM (SELECT * FROM gridex_ediel_readiness.source_editions ORDER BY recorded_at DESC,source_version LIMIT 1) e CROSS JOIN LATERAL jsonb_array_elements(e.catalog) p
  WHERE p->>'family'=family AND p->>'code'=code AND p->>'transactionReasonCode' IS NOT DISTINCT FROM reason;
 IF own_projection IS NULL OR own_projection->>'direction' NOT IN(m.direction,'both') OR NOT(coalesce(own_projection->'applicationReferences','[]') ? application) THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 role_key:=CASE WHEN m.direction='inbound' THEN 'receiverRoles' ELSE 'senderRoles' END;
 legal_qualifier:=CASE WHEN family='PRODAT' THEN CASE WHEN m.direction='inbound' THEN 'DO' ELSE 'FR' END ELSE CASE WHEN m.direction='inbound' THEN 'MR' ELSE 'MS' END END;
 SELECT count(DISTINCT x#>>'{elements,2,0}'),min(x#>>'{elements,2,0}') INTO legal_count,legal_id FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=legal_qualifier;
 IF legal_count<>1 OR nullif(legal_id,'') IS NULL THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 -- The candidate universe is global and evaluated at the observed DB instant,
 -- not at an editable/backdated message/header timestamp.
 SELECT array_agg(DISTINCT i.company_id) INTO candidates FROM public.tenant_actor_identifiers i WHERE i.environment=m.environment AND i.identifier_type='EdielId' AND i.identifier_value=legal_id AND i.valid_from<=p_observed_at AND (i.valid_to IS NULL OR p_observed_at<i.valid_to);
 -- Inbound attribution requires global uniqueness. An authorized outbound
 -- company may share a legal ESCO with another tenant; its OWN profile is still
 -- unique and journal membership is checked by the actual command owner.
 -- Durable global physical reference namespaces prevent source collisions.
 IF m.direction='inbound' THEN
  IF cardinality(candidates) IS DISTINCT FROM 1 OR candidates[1] IS DISTINCT FROM m.company_id THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 ELSE
  IF NOT coalesce(m.company_id=ANY(candidates),false) THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 END IF;c:=m.company_id;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=m.environment ORDER BY i.id FOR SHARE;
 IF (SELECT count(DISTINCT(i.actor_id,i.identifier_value)) FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=m.environment AND i.identifier_type='EdielId' AND i.valid_from<=p_observed_at AND (i.valid_to IS NULL OR p_observed_at<i.valid_to))<>1 THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 SELECT i.actor_id INTO actor FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=m.environment AND i.identifier_type='EdielId' AND i.identifier_value=legal_id AND i.valid_from<=p_observed_at AND (i.valid_to IS NULL OR p_observed_at<i.valid_to) LIMIT 1;
 PERFORM p.id FROM public.tenant_ediel_profiles p WHERE p.company_id=c AND p.environment=m.environment ORDER BY p.id FOR SHARE;
 IF (SELECT count(*) FROM public.tenant_ediel_profiles p WHERE p.company_id=c AND p.environment=m.environment AND p.market='electricity' AND p.is_enabled AND p.valid_from<=p_observed_at AND (p.valid_to IS NULL OR p_observed_at<p.valid_to))<>1 THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 SELECT * INTO profile FROM public.tenant_ediel_profiles p WHERE p.company_id=c AND p.environment=m.environment AND p.market='electricity' AND p.is_enabled AND p.valid_from<=p_observed_at AND (p.valid_to IS NULL OR p_observed_at<p.valid_to);
 PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.environment=m.environment AND r.actor_id=actor ORDER BY r.id FOR SHARE;
 SELECT count(DISTINCT r.role_code),min(r.role_code) INTO roles,role FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.environment=m.environment AND r.actor_id=actor AND r.valid_from<=p_observed_at AND (r.valid_to IS NULL OR p_observed_at<r.valid_to)
  AND (own_projection->role_key ? r.role_code OR own_projection->role_key ? CASE r.role_code WHEN 'electricity_supplier' THEN 'supplier' WHEN 'energy_service_company' THEN 'esco' ELSE r.role_code END);
 IF roles<>1 THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 PERFORM r.id FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=m.environment AND r.relation_type='ediel_transport_agent' ORDER BY r.id FOR SHARE;
 IF (SELECT count(*) FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=m.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=p_observed_at AND (r.valid_to IS NULL OR p_observed_at<r.valid_to))>1 THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 SELECT * INTO relation FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=m.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=p_observed_at AND (r.valid_to IS NULL OR p_observed_at<r.valid_to);
 transport_id:=legal_id;transport_actor:=actor;
 IF FOUND THEN
  transport_actor:=relation.counterparty_actor_id;
  PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.actor_id=transport_actor ORDER BY i.id FOR SHARE;
  IF transport_actor=actor OR (SELECT count(DISTINCT i.identifier_value) FROM public.platform_actor_identifiers i WHERE i.actor_id=transport_actor AND i.identifier_type='EdielId' AND (i.valid_from IS NULL OR i.valid_from<=p_observed_at::date) AND (i.valid_to IS NULL OR p_observed_at::date<=i.valid_to))<>1 THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
  SELECT i.identifier_value INTO transport_id FROM public.platform_actor_identifiers i WHERE i.actor_id=transport_actor AND i.identifier_type='EdielId' AND (i.valid_from IS NULL OR i.valid_from<=p_observed_at::date) AND (i.valid_to IS NULL OR p_observed_at::date<=i.valid_to) LIMIT 1;
 END IF;
 IF transport_id IS DISTINCT FROM wire_transport THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required'; END IF;
 facts:=jsonb_build_object('profile',to_jsonb(profile),'identifiers',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=m.environment AND i.actor_id=actor AND i.identifier_type='EdielId' AND i.valid_from<=p_observed_at AND (i.valid_to IS NULL OR p_observed_at<i.valid_to)),
  'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.environment=m.environment AND r.actor_id=actor AND r.role_code=role AND r.valid_from<=p_observed_at AND (r.valid_to IS NULL OR p_observed_at<r.valid_to)),
  'transportRelation',CASE WHEN relation.id IS NULL THEN NULL ELSE to_jsonb(relation) END,'transportIdentifiers',CASE WHEN relation.id IS NULL THEN NULL ELSE (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.platform_actor_identifiers i WHERE i.actor_id=transport_actor AND i.identifier_type='EdielId' AND (i.valid_from IS NULL OR i.valid_from<=p_observed_at::date) AND (i.valid_to IS NULL OR p_observed_at::date<=i.valid_to)) END);
 RETURN jsonb_build_object('basisKind','observed_source_persistence','companyId',c,'environment',m.environment,'direction',m.direction,'family',family,'code',code,'subtype',own_projection->'subtype','legalActorId',actor,'legalEdielId',legal_id,'actorRole',role,'transportActorId',transport_actor,'transportEdielId',transport_id,'applicationReference',application,'sourceEdition',edition,'canonicalProjection',own_projection,'observedAt',p_observed_at,'sourceReceivedAt',m.message_received_at,'facts',facts);
END $$;


CREATE SCHEMA gridex_ediel_source_rules;
REVOKE ALL ON SCHEMA gridex_ediel_source_rules FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_source_rules.receipts(
 source_message_id uuid PRIMARY KEY,company_id uuid NOT NULL,environment text NOT NULL,direction text NOT NULL,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 canonical_assessment_id uuid,original_source_message_id uuid,evidence jsonb NOT NULL
);
ALTER TABLE gridex_ediel_source_rules.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_source_rules.receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_ediel_source_rules.receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ediel_source_rules.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ediel_original_rule_pack_basis_immutable'; END $$;
CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE ON gridex_ediel_source_rules.receipts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_source_rules.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_source_rules.receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_source_rules.immutable();

CREATE FUNCTION gridex_ediel_source_rules.require_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.ediel_messages%rowtype; basis gridex_ediel_source_rules.receipts%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required'; END IF;
 SELECT * INTO basis FROM gridex_ediel_source_rules.receipts WHERE source_message_id=m.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_historical_rule_pack_basis_unavailable'; END IF;
 IF basis.company_id IS DISTINCT FROM m.company_id OR basis.environment IS DISTINCT FROM m.environment OR basis.direction IS DISTINCT FROM m.direction
  OR basis.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required'; END IF;
 -- Today's message/profile/pack metadata cannot alter the original decision.
 RETURN basis.evidence;
END $$;
CREATE FUNCTION gridex_ediel_source_rules.capture_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.ediel_messages%rowtype; original public.ediel_messages%rowtype;
 profile public.ediel_message_profiles%rowtype; pack public.ediel_rule_packs%rowtype;
 basis gridex_ediel_source_rules.receipts%rowtype; assessment gridex_received_sources.validation_assessments%rowtype;
 context jsonb; facts jsonb; expected jsonb; evidence jsonb; snapshot jsonb; sources jsonb; observed timestamptz:=clock_timestamp();
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
 SELECT * INTO profile FROM public.ediel_message_profiles WHERE id=m.rule_profile_version_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required'; END IF;
 SELECT * INTO pack FROM public.ediel_rule_packs WHERE id=profile.rule_pack_id FOR SHARE;
 IF NOT FOUND OR pack.id IS DISTINCT FROM m.canonical_rule_pack_id OR pack.family IS DISTINCT FROM m.message_family OR pack.market IS DISTINCT FROM 'electricity'
  OR NOT profile.is_enabled OR profile.message_code IS DISTINCT FROM m.message_code OR profile.direction NOT IN(m.direction,'both')
  OR coalesce(profile.transaction_subtype,'') IS DISTINCT FROM coalesce(context->>'subtype','')
  OR pack.source_hash IS DISTINCT FROM m.rule_pack_checksum OR pack.status NOT IN('active','transition')
  OR pack.valid_from>observed::date OR (pack.valid_to IS NOT NULL AND pack.valid_to<observed::date)
  OR nullif(m.rule_profile_key,'') IS NULL OR nullif(m.rule_profile_version,'') IS NULL
  OR jsonb_typeof(m.rule_pack_snapshot) IS DISTINCT FROM 'object'
  OR m.rule_pack_snapshot->>'profileKey' IS DISTINCT FROM m.rule_profile_key
  OR m.rule_pack_snapshot->>'profileVersionId' IS DISTINCT FROM profile.id::text
  OR m.rule_pack_snapshot->>'version' IS DISTINCT FROM m.rule_profile_version
  OR m.rule_pack_snapshot->>'checksum' IS DISTINCT FROM pack.source_hash THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required'; END IF;
 expected:=jsonb_build_object('profileKey',profile.profile_key,'messageProfileId',profile.id,'rulePackId',pack.id,'sourceHash',pack.source_hash);
 IF m.direction='inbound' THEN
  -- This source must have a committed, immutable canonical owner assessment.
  -- Editable message snapshot columns alone never grant original authority.
  SELECT a.* INTO assessment FROM gridex_received_sources.validation_assessments a
   WHERE a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment
    AND a.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
    AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id)
    AND a.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296)
   FOR SHARE;
  IF NOT FOUND OR assessment.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1'
   OR assessment.facts_hash IS DISTINCT FROM encode(sha256(convert_to(assessment.facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required'; END IF;
  facts:=assessment.facts_text::jsonb;
  IF facts->>'owner' IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR facts->'rulePackEvidence' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required'; END IF;
 END IF;
 -- Freeze the exact NAMED rows. No latest pack or independent ACK profile is
 -- selected and no caller binding or historical public snapshot is authority.
 PERFORM s.id FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=pack.id ORDER BY s.id FOR SHARE;
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') INTO sources FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=pack.id;
 snapshot:=jsonb_build_object('profileKey',profile.profile_key,'profileVersionId',profile.id,'version',m.rule_profile_version,'checksum',pack.source_hash,
  'originalMessageSnapshot',m.rule_pack_snapshot,'rulePack',to_jsonb(pack),'messageProfile',to_jsonb(profile),'guideSources',sources,'identitySourceEdition',context->'sourceEdition');
 evidence:=expected||jsonb_build_object('version',m.rule_profile_version,'snapshot',snapshot);
 INSERT INTO gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,canonical_assessment_id,evidence)
  VALUES(m.id,m.company_id,m.environment,m.direction,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),assessment.id,evidence);
 RETURN evidence;
END $$;
CREATE FUNCTION public.ediel_capture_source_rule_pack_basis_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_ediel_source_rules.capture_v1(p_company_id,p_message_id);
END $$;
CREATE FUNCTION public.ediel_require_source_rule_pack_basis_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_ediel_source_rules.require_v1(p_company_id,p_message_id);
END $$;
CREATE FUNCTION public.ediel_probe_source_rule_pack_capture_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_ediel_source_rules.probe_v1(p_company_id,p_message_id);
END $$;
CREATE FUNCTION gridex_ediel_source_rules.probe_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype; evidence jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required'; END IF;
 IF EXISTS(SELECT FROM gridex_ediel_source_rules.receipts WHERE source_message_id=m.id) THEN
  evidence:=gridex_ediel_source_rules.require_v1(p_company_id,p_message_id);
 ELSIF m.message_sent_at IS NOT NULL OR NOT EXISTS(SELECT FROM gridex_ediel_inbound_context.receipts WHERE source_message_id=m.id) THEN
  -- This only lets native owners inspect an established immutable replay. It
  -- grants no new send/business/ACK capability and never creates a receipt.
  RETURN jsonb_build_object('status','historical');
 ELSE
  evidence:=gridex_ediel_source_rules.capture_v1(p_company_id,p_message_id);
 END IF;
 RETURN jsonb_build_object('status','captured','evidence',evidence);
END $$;

-- Retain the already-reviewed complete physical/global source qualifier; extend
-- it only with the protected original rule basis, without read-time capture.
ALTER FUNCTION public.gridex_read_inbound_ack_source_v1(uuid,text,uuid) SET SCHEMA gridex_ediel_source_rules;
ALTER FUNCTION gridex_ediel_source_rules.gridex_read_inbound_ack_source_v1(uuid,text,uuid) RENAME TO read_ack_source_before_basis_v1;
CREATE FUNCTION public.gridex_read_inbound_ack_source_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb; evidence jsonb;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 result:=gridex_ediel_source_rules.read_ack_source_before_basis_v1(p_company_id,p_environment,p_ack_message_id);
 IF result IS NULL THEN RETURN NULL; END IF;
 evidence:=gridex_ediel_source_rules.require_v1(p_company_id,(result#>>'{sourceMessage,id}')::uuid);
 RETURN result||jsonb_build_object('sourceRulePackEvidence',evidence);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_source_rules FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gridex_ediel_source_rules TO service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_source_rules.capture_v1(uuid,uuid),gridex_ediel_source_rules.require_v1(uuid,uuid),gridex_ediel_source_rules.probe_v1(uuid,uuid),gridex_ediel_source_rules.read_ack_source_before_basis_v1(uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_capture_source_rule_pack_basis_v1(uuid,uuid),public.ediel_require_source_rule_pack_basis_v1(uuid,uuid),public.ediel_probe_source_rule_pack_capture_v1(uuid,uuid),public.gridex_read_inbound_ack_source_v1(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_capture_source_rule_pack_basis_v1(uuid,uuid),public.ediel_require_source_rule_pack_basis_v1(uuid,uuid),public.ediel_probe_source_rule_pack_capture_v1(uuid,uuid),public.gridex_read_inbound_ack_source_v1(uuid,text,uuid) TO service_role;
COMMIT;
