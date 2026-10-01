-- Exact pg_get_functiondef payload from authentic033 schema; compile/mechanical fixture only.
CREATE FUNCTION gridex_ediel_readiness.source_scope(m public.ediel_messages) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE tokens jsonb; own_projection jsonb; family text; code text; reason text; wire_sender text; legal_actor uuid; legal_id text;
 transport_id text; transport_identifiers jsonb; relation public.tenant_counterparty_relations%rowtype; role text; role_count integer; reasons jsonb; assignment uuid;
BEGIN
 IF m.direction<>'outbound' OR m.environment<>'production' OR m.company_id IS NULL OR nullif(m.raw_payload,'') IS NULL THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 IF m.message_family='AI_LIST' THEN
  IF m.message_code<>'AI' OR split_part(m.raw_payload,';',1)<>'AI' OR rtrim(split_part(split_part(m.raw_payload,E'\n',1),';',10),E'\r')<>'Ver20140401' THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
  family:='AI_LIST';code:='AI';wire_sender:=split_part(m.raw_payload,';',4);
  own_projection:=jsonb_build_object('family','AI_LIST','code','AI','subtype',NULL,'transactionReasonCode',NULL,'senderRoles',jsonb_build_array('supplier'),'direction','outbound');
 ELSE
  tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);
  IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNB')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM')<>1 THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
  SELECT t#>>'{elements,2,0}' INTO family FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH';
  SELECT t#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM';
  SELECT t#>>'{elements,2,0}' INTO wire_sender FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNB';
  IF family='PRODAT' THEN
   SELECT coalesce(jsonb_agg(DISTINCT cav.token#>>'{elements,1,0}'),'[]') INTO reasons FROM jsonb_array_elements(tokens) WITH ORDINALITY cci(token,n)
    JOIN jsonb_array_elements(tokens) WITH ORDINALITY cav(token,n) ON cav.n=cci.n+1 WHERE cci.token->>'tag'='CCI' AND cci.token#>>'{elements,2,0}'='Z13' AND cav.token->>'tag'='CAV';
   IF jsonb_array_length(reasons)<>1 OR nullif(reasons->>0,'') IS NULL THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
   reason:=reasons->>0;
  END IF;
  SELECT projection INTO own_projection FROM (SELECT catalog FROM gridex_ediel_readiness.source_editions ORDER BY recorded_at DESC,source_version LIMIT 1) edition CROSS JOIN LATERAL jsonb_array_elements(edition.catalog) projection
   WHERE projection->>'family'=family AND projection->>'code'=code AND projection->>'transactionReasonCode' IS NOT DISTINCT FROM reason;
  IF own_projection IS NULL OR own_projection->>'direction' NOT IN ('outbound','both') THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 END IF;
 IF family IS DISTINCT FROM m.message_family OR code IS DISTINCT FROM m.message_code THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 -- Count the entire current legal identity set: no stale proof can opt into a
 -- different valid actor of the same tenant or resolve an ambiguous identity.
 IF (SELECT count(DISTINCT (i.actor_id,btrim(i.identifier_value))) FROM public.tenant_actor_identifiers i WHERE i.company_id=m.company_id AND i.environment='production' AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now()))<>1 THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 SELECT i.actor_id,btrim(i.identifier_value) INTO legal_actor,legal_id FROM public.tenant_actor_identifiers i WHERE i.company_id=m.company_id AND i.environment='production' AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now()) LIMIT 1;
 IF legal_actor IS NULL OR nullif(legal_id,'') IS NULL THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 IF family='AI_LIST' THEN
  IF wire_sender IS DISTINCT FROM legal_id THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 ELSE
  IF (SELECT count(*) FROM public.tenant_counterparty_relations t WHERE t.company_id=m.company_id AND t.environment='production' AND t.relation_type='ediel_transport_agent' AND t.is_enabled AND t.valid_from<=now() AND (t.valid_to IS NULL OR t.valid_to>now()))>1 THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
  SELECT * INTO relation FROM public.tenant_counterparty_relations t WHERE t.company_id=m.company_id AND t.environment='production' AND t.relation_type='ediel_transport_agent' AND t.is_enabled AND t.valid_from<=now() AND (t.valid_to IS NULL OR t.valid_to>now());
  transport_id:=legal_id;
  IF FOUND THEN
   IF relation.counterparty_actor_id=legal_actor OR (SELECT count(DISTINCT btrim(i.identifier_value)) FROM public.platform_actor_identifiers i WHERE i.actor_id=relation.counterparty_actor_id AND i.identifier_type='EdielId' AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date))<>1 THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
   SELECT btrim(i.identifier_value) INTO transport_id FROM public.platform_actor_identifiers i WHERE i.actor_id=relation.counterparty_actor_id AND i.identifier_type='EdielId' AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date) LIMIT 1;
   SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) INTO transport_identifiers FROM public.platform_actor_identifiers i WHERE i.actor_id=relation.counterparty_actor_id AND i.identifier_type='EdielId' AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date);
   IF transport_id=legal_id THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
  END IF;
  IF nullif(transport_id,'') IS NULL OR wire_sender IS DISTINCT FROM transport_id THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 END IF;
 SELECT count(DISTINCT a.role_code),min(a.role_code) INTO role_count,role FROM public.tenant_actor_roles a WHERE a.company_id=m.company_id AND a.environment='production' AND a.actor_id=legal_actor AND a.valid_from<=now() AND (a.valid_to IS NULL OR a.valid_to>now())
  AND own_projection->'senderRoles' ? CASE a.role_code WHEN 'electricity_supplier' THEN 'supplier' WHEN 'energy_service_company' THEN 'esco' ELSE a.role_code END;
 IF role_count<>1 THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 IF role IN ('energy_service_company','esco') THEN
  BEGIN assignment:=nullif(m.parsed_payload->>'serviceAssignmentId','')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END;
  IF assignment IS NULL THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 END IF;
 RETURN jsonb_build_object('actorId',legal_actor,'actorRole',role,'family',family,'code',code,'subtype',own_projection->'subtype','assignmentId',assignment,'canonicalProjection',own_projection,'canonicalProjectionHash',encode(digest(convert_to(own_projection::text,'UTF8'),'sha256'),'hex'),'transportRelation',CASE WHEN family='AI_LIST' OR relation.id IS NULL THEN NULL ELSE to_jsonb(relation) END,'transportEdielId',transport_id,'transportIdentifiers',transport_identifiers);
END $$;
