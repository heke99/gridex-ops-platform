-- Created by the actual Supabase CLI. Same registered selector, with an
-- atomic witness of its exact named rows; this introduces no rule selection.
CREATE FUNCTION public.resolve_canonical_ediel_rule_pack_with_witness_v1(
 p_market text,p_family text,p_message_code text,p_transaction_subtype text,p_direction text,p_business_date date
) RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected jsonb;pack public.ediel_rule_packs%rowtype;profile public.ediel_message_profiles%rowtype;sources jsonb;
BEGIN
 -- Hold the selection universe and source membership stable through the named
 -- read. Concurrent activation/config writes wait; no business tables lock.
 LOCK TABLE public.ediel_rule_packs,public.ediel_message_profiles,public.ediel_runtime_capabilities,public.ediel_rule_pack_sources IN SHARE MODE;
 SELECT to_jsonb(row) INTO STRICT selected FROM public.resolve_canonical_ediel_rule_pack(p_market,p_family,p_message_code,p_transaction_subtype,p_direction,p_business_date) row;
 SELECT * INTO STRICT pack FROM public.ediel_rule_packs WHERE id=(selected->>'rule_pack_id')::uuid FOR SHARE;
 SELECT * INTO STRICT profile FROM public.ediel_message_profiles WHERE id=(selected->>'message_profile_id')::uuid AND rule_pack_id=pack.id FOR SHARE;
 SELECT coalesce(jsonb_agg(to_jsonb(source) ORDER BY source.id),'[]'::jsonb) INTO sources FROM public.ediel_rule_pack_sources source WHERE rule_pack_id=pack.id;
 RETURN NEXT selected||jsonb_build_object('original_version',pack.guide_version||':r'||pack.guide_revision,
  'original_snapshot',jsonb_build_object('rulePack',to_jsonb(pack),'messageProfile',to_jsonb(profile),'guideSources',sources));
END $$;
REVOKE ALL ON FUNCTION public.resolve_canonical_ediel_rule_pack_with_witness_v1(text,text,text,text,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_canonical_ediel_rule_pack_with_witness_v1(text,text,text,text,text,date) TO service_role;

-- Preserve the established append-only facet protocol, register scope and
-- predecessor chain. New writes carrying a pack require the original witness.
CREATE OR REPLACE FUNCTION gridex_received_sources.append_validation(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE src gridex_received_sources.sources%rowtype; facts jsonb; pack jsonb; v_previous uuid; v_id uuid; v_hash text; registered public.ediel_rule_packs%rowtype;registered_profile public.ediel_message_profiles%rowtype;registered_sources jsonb;original_ack jsonb;actual_message public.ediel_messages%rowtype;facet jsonb; obj jsonb; reg jsonb; key text; object_keys text[]:=ARRAY[]::text[]; line_ids text[]:=ARRAY[]::text[]; segment_ids int[]:=ARRAY[]::int[]; previous_segment int; position int;
BEGIN
  -- Lock per source before selecting a predecessor. Concurrent assessments
  -- append a single linked sequence; no UPDATE of historic decisions occurs.
  SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id
    AND company_id=p_company_id AND environment=p_environment FOR UPDATE;
  IF NOT FOUND OR src.payload_hash IS NULL OR src.received_context IS NULL
    OR p_source_payload_hash IS DISTINCT FROM src.payload_hash OR p_facts_text IS NULL OR octet_length(p_facts_text)>65536 THEN
    RAISE EXCEPTION 'received_validation_source_unavailable' USING ERRCODE='23514';
  END IF;
  facts:=p_facts_text::jsonb;
  IF jsonb_typeof(facts) IS DISTINCT FROM 'object'
    OR facts - ARRAY['version','owner','sourceDisposition','objectDisposition','partyDisposition','coverage','originalTenantMatch','syntaxDecision','applicationDecision','functionalDecision','messageReference','reasonCodes','rulePackEvidence','registerValidation'] <> '{}'::jsonb
    OR facts->'version' IS DISTINCT FROM '1'::jsonb OR facts->>'owner' IS DISTINCT FROM 'canonical-runtime-with-registry-v1'
    OR facts->>'sourceDisposition' IS DISTINCT FROM 'not_established' OR facts->>'objectDisposition' IS DISTINCT FROM 'not_checked'
    OR facts->>'partyDisposition' IS DISTINCT FROM 'not_checked' OR facts->>'coverage' IS DISTINCT FROM 'canonical_runtime_only'
    OR facts->>'originalTenantMatch' IS DISTINCT FROM 'matched'
    OR coalesce(facts->>'syntaxDecision','') NOT IN ('accepted','rejected','not_applicable','manual_review')
    OR coalesce(facts->>'applicationDecision','') NOT IN ('accepted','rejected','not_applicable','manual_review')
    OR coalesce(facts->>'functionalDecision','') NOT IN ('accepted','rejected','not_applicable','manual_review')
    OR jsonb_typeof(facts->'reasonCodes') IS DISTINCT FROM 'array' OR jsonb_array_length(facts->'reasonCodes')>128
    OR coalesce(jsonb_typeof(facts->'messageReference'),'missing') NOT IN ('string','null')
    OR length(coalesce(facts->>'messageReference',''))>128 THEN
    RAISE EXCEPTION 'received_validation_not_source_approval' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(facts->'reasonCodes') AS value WHERE jsonb_typeof(value) IS DISTINCT FROM 'string' OR value#>>'{}' !~ '^[A-Za-z0-9_.:-]{1,128}$') THEN
    RAISE EXCEPTION 'received_validation_reason_unavailable' USING ERRCODE='23514';
  END IF;
  pack:=facts->'rulePackEvidence';
  IF facts->>'applicationDecision'='accepted' AND (pack IS NULL OR pack='null'::jsonb) THEN
    RAISE EXCEPTION 'received_validation_rule_evidence_unavailable' USING ERRCODE='23514';
  END IF;
  IF pack IS DISTINCT FROM 'null'::jsonb THEN
    IF jsonb_typeof(pack) IS DISTINCT FROM 'object' OR NOT pack ?& ARRAY['profileKey','messageProfileId','rulePackId','sourceHash','version','snapshot']
      OR pack - ARRAY['profileKey','messageProfileId','rulePackId','sourceHash','version','snapshot'] <> '{}'::jsonb
      OR jsonb_typeof(pack->'snapshot') IS DISTINCT FROM 'object'
      OR NOT (pack->'snapshot') ?& ARRAY['rulePack','messageProfile','guideSources']
      OR (pack->'snapshot')-ARRAY['rulePack','messageProfile','guideSources'] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'received_validation_rule_evidence_unavailable' USING ERRCODE='23514';
    END IF;
    SELECT * INTO actual_message FROM public.ediel_messages WHERE id=src.source_message_id AND company_id=p_company_id AND environment=p_environment FOR SHARE;
    IF actual_message.message_family IN ('APERAK','CONTRL') THEN
      -- An ACK inherits the protected original's immutable witness. A later
      -- edit of activation rows never replaces its historic guide authority.
      original_ack:=public.gridex_read_inbound_ack_source_v1(p_company_id,p_environment,src.source_message_id);
      original_ack:=original_ack->'sourceRulePackEvidence';
      IF original_ack IS NULL OR pack IS DISTINCT FROM jsonb_build_object('profileKey',original_ack->'profileKey',
        'messageProfileId',original_ack->'messageProfileId','rulePackId',original_ack->'rulePackId','sourceHash',original_ack->'sourceHash',
        'version',original_ack->'version','snapshot',jsonb_build_object('rulePack',original_ack#>'{snapshot,rulePack}',
          'messageProfile',original_ack#>'{snapshot,messageProfile}','guideSources',original_ack#>'{snapshot,guideSources}')) THEN
        RAISE EXCEPTION 'received_validation_rule_evidence_unavailable' USING ERRCODE='23514';
      END IF;
    ELSE
      LOCK TABLE public.ediel_rule_pack_sources IN SHARE MODE;
      SELECT * INTO registered FROM public.ediel_rule_packs WHERE id::text=pack->>'rulePackId' AND source_hash=pack->>'sourceHash' FOR SHARE;
      SELECT * INTO registered_profile FROM public.ediel_message_profiles WHERE id::text=pack->>'messageProfileId'
        AND rule_pack_id=registered.id AND profile_key=pack->>'profileKey' FOR SHARE;
      SELECT coalesce(jsonb_agg(to_jsonb(source) ORDER BY source.id),'[]'::jsonb) INTO registered_sources FROM public.ediel_rule_pack_sources source WHERE rule_pack_id=registered.id;
      IF registered.id IS NULL OR registered_profile.id IS NULL
        OR pack->>'version' IS DISTINCT FROM registered.guide_version||':r'||registered.guide_revision
        OR pack#>'{snapshot,rulePack}' IS DISTINCT FROM to_jsonb(registered)
        OR pack#>'{snapshot,messageProfile}' IS DISTINCT FROM to_jsonb(registered_profile)
        OR pack#>'{snapshot,guideSources}' IS DISTINCT FROM registered_sources THEN
        RAISE EXCEPTION 'received_validation_rule_evidence_unavailable' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  -- Optional live-owner register facet. Historical facet-only callers remain
  -- valid. This never grants full source, tenant, legal-party or business approval.
  IF facts ? 'registerValidation' THEN
    facet:=facts->'registerValidation';
    IF pack IS NULL OR pack='null'::jsonb OR jsonb_typeof(facet) IS DISTINCT FROM 'object'
      OR NOT facet ?& ARRAY['version','owner','coverage','objects']
      OR facet-ARRAY['version','owner','coverage','objects'] <> '{}'::jsonb
      OR facet->'version' IS DISTINCT FROM '1'::jsonb
      OR facet->>'owner' IS DISTINCT FROM 'validateProdatRegisterPolicy'
      OR facet->>'coverage' IS DISTINCT FROM 'canonical_register_only'
      OR jsonb_typeof(facet->'objects') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'received_register_facet_invalid' USING ERRCODE='23514';
    END IF;
    IF jsonb_array_length(facet->'objects')>8192 THEN
      RAISE EXCEPTION 'received_register_facet_budget' USING ERRCODE='23514';
    END IF;
    FOR obj IN SELECT value FROM jsonb_array_elements(facet->'objects') LOOP
      IF jsonb_typeof(obj) IS DISTINCT FROM 'object'
        OR NOT obj ?& ARRAY['messageIndex','messageReference','objectId','identityAgency','disposition','registers','reasons']
        OR obj-ARRAY['messageIndex','messageReference','objectId','identityAgency','disposition','registers','reasons'] <> '{}'::jsonb
        OR jsonb_typeof(obj->'messageIndex') IS DISTINCT FROM 'number'
        OR coalesce(obj->>'messageIndex','') !~ '^(-1|[0-9]{1,4})$'
        OR coalesce(obj->>'disposition','') NOT IN ('accepted','rejected','unavailable')
        OR jsonb_typeof(obj->'registers') IS DISTINCT FROM 'array'
        OR jsonb_typeof(obj->'reasons') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'received_register_object_invalid' USING ERRCODE='23514';
      END IF;
      IF (obj->>'messageIndex')::int>=8192 OR jsonb_array_length(obj->'registers') NOT BETWEEN 1 AND 8192
        OR jsonb_array_length(obj->'reasons')>128 THEN
        RAISE EXCEPTION 'received_register_object_budget' USING ERRCODE='23514';
      END IF;
      FOREACH key IN ARRAY ARRAY['messageReference','objectId','identityAgency'] LOOP
        IF obj->key IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(obj->key) IS DISTINCT FROM 'string'
          OR length(obj->>key) NOT BETWEEN 1 AND 128 OR obj->>key <> btrim(obj->>key) OR obj->>key ~ '[[:cntrl:]]') THEN
          RAISE EXCEPTION 'received_register_identity_invalid' USING ERRCODE='23514';
        END IF;
      END LOOP;
      IF obj->>'disposition'<>'unavailable' AND ((obj->>'messageIndex')::int<>0 OR jsonb_typeof(obj->'messageReference')<>'string'
        OR jsonb_typeof(obj->'objectId')<>'string' OR coalesce(obj->>'identityAgency','') NOT IN ('9','89')) THEN
        RAISE EXCEPTION 'received_register_unvalidated_scope' USING ERRCODE='23514';
      END IF;
      IF (obj->>'disposition'='accepted') IS DISTINCT FROM (jsonb_array_length(obj->'reasons')=0)
        OR EXISTS(SELECT FROM jsonb_array_elements(obj->'reasons') r WHERE jsonb_typeof(r) IS DISTINCT FROM 'string' OR r#>>'{}' !~ '^[A-Za-z0-9_.:-]{1,128}$')
        OR (SELECT count(*)<>count(DISTINCT r) FROM jsonb_array_elements(obj->'reasons') r) THEN
        RAISE EXCEPTION 'received_register_reason_invalid' USING ERRCODE='23514';
      END IF;
      key:=jsonb_build_array(obj->'messageIndex',obj->'objectId',obj->'identityAgency',CASE WHEN obj->'objectId'='null'::jsonb THEN obj#>'{registers,0,lineIndex}' ELSE 'null'::jsonb END)::text;
      IF key=ANY(object_keys) THEN RAISE EXCEPTION 'received_register_duplicate_object' USING ERRCODE='23514'; END IF;
      object_keys:=array_append(object_keys,key);
      previous_segment:=-1; position:=0;
      FOR reg IN SELECT value FROM jsonb_array_elements(obj->'registers') LOOP
        position:=position+1;
        IF jsonb_typeof(reg) IS DISTINCT FROM 'object'
          OR NOT reg ?& ARRAY['lineIndex','lineNumber','registerIndex','registerPosition','segmentIndex']
          OR reg-ARRAY['lineIndex','lineNumber','registerIndex','registerPosition','segmentIndex'] <> '{}'::jsonb THEN
          RAISE EXCEPTION 'received_register_occurrence_invalid' USING ERRCODE='23514';
        END IF;
        FOREACH key IN ARRAY ARRAY['lineIndex','registerPosition','segmentIndex'] LOOP
          IF jsonb_typeof(reg->key) IS DISTINCT FROM 'number' OR coalesce(reg->>key,'') !~ '^[0-9]{1,4}$' THEN
            RAISE EXCEPTION 'received_register_index_invalid' USING ERRCODE='23514';
          END IF;
          IF (reg->>key)::int>=8192 THEN RAISE EXCEPTION 'received_register_index_budget' USING ERRCODE='23514'; END IF;
        END LOOP;
        FOREACH key IN ARRAY ARRAY['lineNumber','registerIndex'] LOOP
          IF reg->key IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(reg->key) IS DISTINCT FROM 'string'
            OR length(reg->>key) NOT BETWEEN 1 AND 128 OR reg->>key<>btrim(reg->>key) OR reg->>key ~ '[[:cntrl:]]') THEN
            RAISE EXCEPTION 'received_register_wire_index_invalid' USING ERRCODE='23514';
          END IF;
        END LOOP;
        IF (reg->>'registerPosition')::int<>position OR (reg->>'segmentIndex')::int<=previous_segment
          OR jsonb_build_array(obj->'messageIndex',reg->'lineIndex')::text=ANY(line_ids) OR (reg->>'segmentIndex')::int=ANY(segment_ids) THEN
          RAISE EXCEPTION 'received_register_occurrence_conflict' USING ERRCODE='23514';
        END IF;
        line_ids:=array_append(line_ids,jsonb_build_array(obj->'messageIndex',reg->'lineIndex')::text);
        segment_ids:=array_append(segment_ids,(reg->>'segmentIndex')::int);
        previous_segment:=(reg->>'segmentIndex')::int;
      END LOOP;
    END LOOP;
  END IF;
  SELECT prior.id INTO v_previous FROM gridex_received_sources.validation_assessments prior WHERE prior.source_message_id=src.source_message_id
    AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=prior.id);
  v_hash:=encode(sha256(convert_to(p_facts_text,'UTF8')),'hex');
  INSERT INTO gridex_received_sources.validation_assessments(source_message_id,company_id,environment,source_payload_hash,previous_assessment_id,facts_text,facts_hash)
    VALUES(src.source_message_id,p_company_id,p_environment,src.payload_hash,v_previous,p_facts_text,v_hash) RETURNING id INTO v_id;
  RETURN jsonb_build_object('version',1,'assessmentId',v_id,'companyId',p_company_id,'environment',p_environment,
    'sourceMessageId',src.source_message_id,'sourcePayloadHash',src.payload_hash,'factsHash',v_hash,'sourceDisposition','not_established');
END $$;
