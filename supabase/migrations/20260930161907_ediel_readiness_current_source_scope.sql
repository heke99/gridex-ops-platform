-- Supabase CLI 2.118.0 forward migration. No production evidence/activation.
-- Canonical role/reason values below are generated from the existing source
-- authority; no manually maintained alternative semantics are introduced.
BEGIN;
CREATE TABLE gridex_ediel_readiness.source_editions (
 source_version text PRIMARY KEY CHECK(source_version ~ '^[0-9a-f]{64}$'),
 input_manifest jsonb NOT NULL CHECK(jsonb_typeof(input_manifest)='object'),
 catalog jsonb NOT NULL CHECK(jsonb_typeof(catalog)='array'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE gridex_ediel_readiness.source_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_readiness.source_editions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_readiness.source_editions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER source_edition_no_mutation BEFORE UPDATE OR DELETE ON gridex_ediel_readiness.source_editions FOR EACH ROW EXECUTE FUNCTION gridex_ediel_readiness.reject_mutation();
CREATE TRIGGER source_edition_no_truncate BEFORE TRUNCATE ON gridex_ediel_readiness.source_editions FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_readiness.reject_mutation();
-- BEGIN CANONICAL SOURCE PROJECTION
INSERT INTO gridex_ediel_readiness.source_editions(source_version,input_manifest,catalog)
SELECT value->>'sourceVersion',value->'inputManifest',value->'catalog' FROM (SELECT '{"sourceVersion":"374eea94612851fdbdc7b243eda21f1152dcef5a764bf500c0f57dce33ee9544","inputManifest":{"lib/ediel/ack/canonicalAckEngine.ts":"12c4f5202a6bb9c5c072eda4c8a393688cab0a66ff598d11f1760bb89e15dbf6","lib/ediel/rulebook/businessSemantics.ts":"89037706cdf2433f0c3f5e08dcb079bbc564b2da5b2c8dd5b3e9d87dc4ab235d","lib/ediel/rulebook/canonicalEdielFacade.ts":"74ee7890f5e1f21a668aec457e684c242f861768a47089e8f575f7df749b670e","lib/ediel/rulebook/deadlinePolicy.ts":"5fe8333f61a4460a979fc62f15f9b15ffafb2faa3702b09392a5042eb08b2f34","lib/ediel/rulebook/guideRegistry.ts":"a01398186bd0379856762ff2c783f6c450e7c18d46c479f84db7b5e655e24385","lib/ediel/rulebook/mapEdielError.ts":"8374ce5f34d3657273b1e6a650e1734997df4bfe57633a7bfc0a77612cd95cea","lib/ediel/rulebook/prodatApplicationReference.ts":"fe20ad0bac7fb89ce5ebc85fd058c2d5644d18ad7d1b08bfe595d09a5aa9f785","lib/ediel/rulebook/prodatRulebook.ts":"bc8a47b4e2b8860026ae179e65163986039b1838c802dea7aada7f346ce4336b","lib/ediel/rulebook/prodatSubtypeRegistry.ts":"f3fb3418ee73333a097c3203384bd6d41b680adfb5ecf6e4752316c3e08568de","lib/ediel/rulebook/utiltsApplicationReference.ts":"2a2a841900d51dfe5b121705357c8506a62365b8ec11614352a3fdf2a8711dbd","lib/ediel/rulebook/utiltsFieldMatrix.ts":"96673bf16652616e0715b3bfb36bda06caa5462c26783eacefa8f04ca4928655","lib/ediel/rulebook/utiltsMarketEngine.ts":"efece4736d43999c47aa5ad68cb226fe1b22578abe247e821a68a5b78b763f41","lib/ediel/rulebook/utiltsMarketSemantics.ts":"9262f1ea53ceeae77da7d1fb1093999f86890ae6d63b19a3d92712b417be2f10","lib/ediel/rulebook/utiltsRulebook.ts":"827b458de5859b2d08b96cfc0a4e8c89baf93874f2689a97afd3c8ee2d0f935b"},"catalog":[{"family":"PRODAT","code":"Z01","subtype":"L","transactionReasonCode":"Z22","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z01","subtype":"LK","transactionReasonCode":"Z23","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z02","subtype":"L","transactionReasonCode":"Z22","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z02","subtype":"LK","transactionReasonCode":"Z23","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z03","subtype":"C","transactionReasonCode":"Z24","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z03","subtype":"H","transactionReasonCode":"Z25","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z03","subtype":"L","transactionReasonCode":"Z22","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z03","subtype":"LK","transactionReasonCode":"Z23","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z04","subtype":"A","transactionReasonCode":"Z26","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z04","subtype":"C","transactionReasonCode":"Z24","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z04","subtype":"D","transactionReasonCode":"Z70","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z04","subtype":"H","transactionReasonCode":"Z25","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z04","subtype":"L","transactionReasonCode":"Z22","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z04","subtype":"LK","transactionReasonCode":"Z23","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z05","subtype":"C","transactionReasonCode":"Z24","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z05","subtype":"H","transactionReasonCode":"Z25","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z05","subtype":"L","transactionReasonCode":"Z22","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z05","subtype":"LK","transactionReasonCode":"Z23","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z06","subtype":"E","transactionReasonCode":"E34","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z06","subtype":"F","transactionReasonCode":"E64","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z06","subtype":"G","transactionReasonCode":"E32","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z08","subtype":"H","transactionReasonCode":"Z25","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z08","subtype":"LK","transactionReasonCode":"Z23","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z09","subtype":"B","transactionReasonCode":"Z27","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z09","subtype":"D","transactionReasonCode":"Z70","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z09","subtype":"E","transactionReasonCode":"E34","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z09","subtype":"F","transactionReasonCode":"E64","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z09","subtype":"G","transactionReasonCode":"E32","senderRoles":["supplier"],"direction":"outbound"},{"family":"PRODAT","code":"Z10","subtype":"M","transactionReasonCode":"E58","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z13","subtype":"V","transactionReasonCode":"S17","senderRoles":["esco"],"direction":"outbound"},{"family":"PRODAT","code":"Z13","subtype":"VH","transactionReasonCode":"S18","senderRoles":["esco"],"direction":"outbound"},{"family":"PRODAT","code":"Z14","subtype":"N","transactionReasonCode":"Z96","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z14","subtype":"V","transactionReasonCode":"S17","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z14","subtype":"VH","transactionReasonCode":"S18","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z15","subtype":"C","transactionReasonCode":"Z24","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z15","subtype":"V","transactionReasonCode":"S17","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z15","subtype":"VH","transactionReasonCode":"S18","senderRoles":["grid_owner"],"direction":"inbound"},{"family":"PRODAT","code":"Z18","subtype":"V","transactionReasonCode":"S17","senderRoles":["esco"],"direction":"outbound"},{"family":"UTILTS","code":"E30","subtype":null,"transactionReasonCode":null,"senderRoles":["metering_collector"],"direction":"both"},{"family":"UTILTS","code":"E31","subtype":null,"transactionReasonCode":null,"senderRoles":["grid_owner"],"direction":"inbound"},{"family":"UTILTS","code":"E66","subtype":null,"transactionReasonCode":null,"senderRoles":["grid_owner"],"direction":"inbound"},{"family":"UTILTS","code":"E72","subtype":null,"transactionReasonCode":null,"senderRoles":["grid_owner"],"direction":"both"},{"family":"UTILTS","code":"E73","subtype":null,"transactionReasonCode":null,"senderRoles":["supplier","balance_responsible","energy_service_company","producer","customer"],"direction":"outbound"},{"family":"UTILTS","code":"E74","subtype":null,"transactionReasonCode":null,"senderRoles":["supplier","balance_responsible","imbalance_settlement_responsible"],"direction":"both"},{"family":"UTILTS","code":"S01","subtype":null,"transactionReasonCode":null,"senderRoles":["imbalance_settlement_responsible"],"direction":"both"},{"family":"UTILTS","code":"S02","subtype":null,"transactionReasonCode":null,"senderRoles":["grid_owner"],"direction":"inbound"},{"family":"UTILTS","code":"S03","subtype":null,"transactionReasonCode":null,"senderRoles":["grid_owner"],"direction":"inbound"},{"family":"UTILTS","code":"S04","subtype":null,"transactionReasonCode":null,"senderRoles":["imbalance_settlement_responsible"],"direction":"both"},{"family":"UTILTS","code":"S05","subtype":null,"transactionReasonCode":null,"senderRoles":["balance_responsible"],"direction":"inbound"},{"family":"UTILTS","code":"S06","subtype":null,"transactionReasonCode":null,"senderRoles":["supplier","grid_owner","balance_responsible"],"direction":"both"},{"family":"UTILTS","code":"S07","subtype":null,"transactionReasonCode":null,"senderRoles":["supplier"],"direction":"both"}]}'::jsonb value) edition;
-- END CANONICAL SOURCE PROJECTION

-- Derive scope from the actual saved wire, current canonical projection and
-- current unique legal identity. Evidence and caller arguments cannot select it.
CREATE FUNCTION gridex_ediel_readiness.source_scope(m public.ediel_messages) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
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
REVOKE ALL ON FUNCTION gridex_ediel_readiness.source_scope(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_ediel_readiness.capture(
 p_company_id uuid,p_message_id uuid,p_legal_actor_id uuid,p_actor_role text,p_family text,p_code text,p_subtype text,
 p_assignment_id uuid,p_release_sha text,p_rulepack_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype; r public.ediel_route_profiles%rowtype; scope jsonb; deps jsonb; profile_rows jsonb; role_rows jsonb;
 identifier_rows jsonb; capability_rows jsonb; permission_rows jsonb:='[]'; assignment_rows jsonb:='[]'; certificate_rows jsonb;
 schema_parts jsonb; schema_hash text; schema_ready boolean; release_row public.platform_release_receipts%rowtype; source_tokens jsonb; family text; code text; wire_subtype text; derived jsonb; selected_profile public.ediel_message_profiles%rowtype; selected_pack public.ediel_rule_packs%rowtype;
BEGIN
 IF p_company_id IS NULL OR p_message_id IS NULL OR p_legal_actor_id IS NULL OR nullif(p_actor_role,'') IS NULL
  OR p_family IS NULL OR p_family NOT IN ('PRODAT','UTILTS','AI_LIST') OR nullif(p_code,'') IS NULL OR p_code='ERR'
  OR p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$' OR p_rulepack_hash IS NULL OR p_rulepack_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 SELECT * INTO release_row FROM public.platform_release_receipts WHERE environment='production' AND status='verified'
  AND verified_at IS NOT NULL AND nullif(ci_run_id,'') IS NOT NULL AND nullif(deployment_id,'') IS NOT NULL
  ORDER BY verified_at DESC,recorded_at DESC,id LIMIT 1 FOR SHARE;
 IF NOT FOUND OR release_row.release_sha IS DISTINCT FROM p_release_sha THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id AND environment='production' FOR SHARE;
 IF NOT FOUND OR m.direction<>'outbound' OR m.message_family IS DISTINCT FROM p_family OR m.message_code IS DISTINCT FROM p_code
  OR (p_family<>'AI_LIST' AND m.rule_pack_checksum IS DISTINCT FROM p_rulepack_hash) OR m.raw_payload IS NULL THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 derived:=gridex_ediel_readiness.source_scope(m);
 IF derived->>'actorId' IS DISTINCT FROM p_legal_actor_id::text OR derived->>'actorRole' IS DISTINCT FROM p_actor_role
  OR derived->>'family' IS DISTINCT FROM p_family OR derived->>'code' IS DISTINCT FROM p_code OR derived->>'subtype' IS DISTINCT FROM p_subtype
  OR derived->>'assignmentId' IS DISTINCT FROM p_assignment_id::text THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 wire_subtype:=derived#>>'{canonicalProjection,transactionReasonCode}';
 IF p_family<>'AI_LIST' THEN
  SELECT * INTO selected_profile FROM public.ediel_message_profiles mp WHERE mp.id=m.rule_profile_version_id AND mp.rule_pack_id=m.canonical_rule_pack_id AND mp.message_code=p_code
   AND mp.transaction_subtype=coalesce(p_subtype,'') AND mp.is_enabled AND mp.direction IN ('outbound','both') FOR SHARE;
  IF NOT FOUND OR (p_family='PRODAT' AND selected_profile.profile->>'reasonForTransaction' IS DISTINCT FROM wire_subtype) THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
  SELECT * INTO selected_pack FROM public.ediel_rule_packs rp WHERE rp.id=selected_profile.rule_pack_id AND rp.family=p_family AND rp.market='electricity' AND rp.status='active'
   AND rp.source_hash=p_rulepack_hash AND rp.valid_from<=current_date AND (rp.valid_to IS NULL OR rp.valid_to>=current_date) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'companyId',a.company_id,'environment',a.environment,'market',a.market,'enabled',a.is_enabled,'validFrom',a.valid_from,'validTo',a.valid_to) ORDER BY a.id),'[]') INTO profile_rows FROM public.tenant_ediel_profiles a
  WHERE a.company_id=p_company_id AND a.environment='production' AND a.market='electricity' AND a.is_enabled AND a.valid_from<=now() AND (a.valid_to IS NULL OR a.valid_to>now());
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') INTO identifier_rows FROM public.tenant_actor_identifiers a
  WHERE a.company_id=p_company_id AND a.environment='production' AND a.actor_id=p_legal_actor_id AND a.identifier_type='EdielId' AND a.valid_from<=now() AND (a.valid_to IS NULL OR a.valid_to>now());
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') INTO role_rows FROM public.tenant_actor_roles a
  WHERE a.company_id=p_company_id AND a.environment='production' AND a.actor_id=p_legal_actor_id AND a.role_code=p_actor_role AND a.valid_from<=now() AND (a.valid_to IS NULL OR a.valid_to>now());
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') INTO capability_rows FROM public.tenant_message_capabilities a
  WHERE a.company_id=p_company_id AND a.environment='production' AND a.message_family=p_family AND a.message_code=p_code AND a.transaction_subtype IN ('*',coalesce(p_subtype,''))
   AND a.direction IN ('outbound','both') AND a.is_enabled AND a.valid_from<=now() AND (a.valid_to IS NULL OR a.valid_to>now());
 IF p_family='AI_LIST' AND NOT EXISTS(SELECT FROM jsonb_array_elements(identifier_rows) x WHERE x->>'identifier_value'=split_part(m.raw_payload,';',4)) THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 IF jsonb_array_length(profile_rows)=0 OR jsonb_array_length(identifier_rows)=0 OR jsonb_array_length(role_rows)=0 OR jsonb_array_length(capability_rows)=0 THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 SELECT * INTO r FROM public.ediel_route_profiles WHERE company_id=p_company_id AND id=m.route_profile_id AND environment='production' FOR SHARE;
 IF NOT FOUND OR NOT coalesce(r.is_enabled,false) OR r.is_active=false OR r.communication_route_id IS DISTINCT FROM m.communication_route_id THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 IF EXISTS(SELECT FROM public.ediel_certificates c WHERE c.company_id=p_company_id AND c.id IN (r.certificate_id,r.receiver_certificate_id)
   AND ((c.certificate_valid_from IS NOT NULL AND c.certificate_valid_from>now()) OR (c.certificate_valid_to IS NOT NULL AND c.certificate_valid_to<=now()))) THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'fingerprint',c.certificate_fingerprint,'validFrom',c.certificate_valid_from,'validTo',c.certificate_valid_to,'status',c.status,'encryptionStatus',c.encryption_status) ORDER BY c.id),'[]') INTO certificate_rows
  FROM public.ediel_certificates c WHERE c.company_id=p_company_id AND c.id IN (r.certificate_id,r.receiver_certificate_id);
 IF p_actor_role IN ('energy_service_company','esco','service_provider') THEN
  IF p_assignment_id IS NULL OR public.ediel_service_assignment_assessment_v1(p_company_id,p_assignment_id)->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
  SELECT jsonb_build_array(to_jsonb(a)) INTO assignment_rows FROM public.ediel_service_assignments a
   WHERE a.id=p_assignment_id AND a.company_id=p_company_id AND a.environment='production' AND a.provider_actor_id=p_legal_actor_id AND a.customer_id=m.customer_id;
  IF assignment_rows IS NULL THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('permission',to_jsonb(p),'link',to_jsonb(l),'grants',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.ediel_data_access_grants g WHERE g.company_id=p_company_id AND g.permission_link_id=l.id),'[]')) ORDER BY l.id),'[]') INTO permission_rows
   FROM public.ediel_assignment_permission_links l JOIN public.metering_permissions p ON p.id=l.permission_id AND p.company_id=l.company_id WHERE l.company_id=p_company_id AND l.assignment_id=p_assignment_id;
 ELSE
  IF p_assignment_id IS NOT NULL THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 END IF;
 -- Live schema identity for this capability's own dependency relations/functions.
 -- Unrelated UI/schema additions do not invalidate a different dependency graph.
 SELECT coalesce(is_ready,false) INTO schema_ready FROM public.platform_runtime_readiness WHERE id=true;
 IF NOT coalesce(schema_ready,false) THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 SELECT jsonb_build_object('columns',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY n.nspname,c.relname,a.attnum)
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=ANY(ARRAY['ediel_messages','ediel_route_profiles','ediel_certificates','tenant_ediel_profiles','tenant_actor_identifiers','tenant_actor_roles','tenant_message_capabilities',CASE WHEN p_actor_role IN ('energy_service_company','esco','service_provider') THEN 'ediel_service_assignments' END,CASE WHEN p_actor_role IN ('energy_service_company','esco','service_provider') THEN 'metering_permissions' END,CASE WHEN p_actor_role IN ('energy_service_company','esco','service_provider') THEN 'ediel_data_access_grants' END]) AND a.attnum>0 AND NOT a.attisdropped),
  'functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.prosecdef,p.proconfig,pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_readiness' AND p.proname IN ('capture','source_scope'))) INTO schema_parts;
 schema_hash:=encode(digest(convert_to(schema_parts::text,'UTF8'),'sha256'),'hex');
 scope:=jsonb_build_object('companyId',p_company_id,'actorId',p_legal_actor_id,'actorRole',p_actor_role,'market','electricity','environment','production','family',p_family,'code',p_code,'subtype',p_subtype,'assignmentId',p_assignment_id);
 deps:=jsonb_build_object('releaseSha',p_release_sha,'releaseReceipt',jsonb_build_object('id',release_row.id,'ciRunId',release_row.ci_run_id,'deploymentId',release_row.deployment_id,'schemaMigrationVersion',release_row.schema_migration_version,'databaseSchemaFingerprint',to_jsonb(release_row)->'database_schema_fingerprint','generatedTypesHash',to_jsonb(release_row)->'generated_types_hash','migrationManifestHash',to_jsonb(release_row)->'migration_manifest_hash'),'schemaFingerprint',schema_hash,'rulepackHash',p_rulepack_hash,'wireTransactionReason',wire_subtype,'technicalFormatVersion',CASE WHEN p_family='AI_LIST' THEN 'Ver20140401' ELSE NULL END,'rulepackId',m.canonical_rule_pack_id,'ruleProfileVersionId',m.rule_profile_version_id,
   'canonicalProjection',derived->'canonicalProjection','canonicalProjectionHash',derived->'canonicalProjectionHash','transportRelation',derived->'transportRelation','transportEdielId',derived->'transportEdielId','transportIdentifiers',derived->'transportIdentifiers',
   'normativeProjection',CASE WHEN p_family='AI_LIST' THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('packId',selected_pack.id,'sourceHash',selected_pack.source_hash,'status',selected_pack.status,'guideVersion',selected_pack.guide_version,'guideRevision',selected_pack.guide_revision,'validFrom',selected_pack.valid_from,'validTo',selected_pack.valid_to,'profileId',selected_profile.id,'profileKey',selected_profile.profile_key,'subtype',selected_profile.transaction_subtype,'profile',selected_profile.profile)) END,
  'tenantRuleProfileVersion',coalesce((SELECT jsonb_build_object('id',rv.id,'version',rv.version,'status',rv.status,'checksum',rv.checksum,'sourceRevision',rv.source_revision)
    FROM public.ediel_rule_profile_versions rv WHERE rv.company_id=p_company_id AND rv.id=m.rule_profile_version_id), '{}'::jsonb),
  'profile',profile_rows,'legalIdentifiers' ,identifier_rows,'actorRole',role_rows,'capability',capability_rows,
  'route',jsonb_build_object('id',r.id,'communicationRouteId',r.communication_route_id,'routeVersion',to_jsonb(r)->'route_version','senderEdielId',r.sender_ediel_id,'receiverEdielId',r.receiver_ediel_id,'senderSubaddress',coalesce(r.sender_sub_address,r.sender_subaddress),'receiverSubaddress',coalesce(r.receiver_sub_address,r.receiver_subaddress),'mailboxId',r.mailbox_id,'transportProfileId',r.transport_profile_id,'certificateId',r.certificate_id,'receiverCertificateId',r.receiver_certificate_id,'enabled',r.is_enabled,'active',r.is_active),
  'certificates',certificate_rows,'assignments',assignment_rows,'permissions',permission_rows);
 RETURN jsonb_build_object('authorityVersion',1,'scope',scope,'dependencies',deps,'dependencyHash',encode(digest(convert_to(jsonb_build_object('scope',scope,'dependencies',deps)::text,'UTF8'),'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_readiness.capture(uuid,uuid,uuid,text,text,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.ediel_require_scoped_capability_for_message_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,gridex_ediel_readiness AS $$
DECLARE m public.ediel_messages%rowtype; proof gridex_ediel_readiness.evidence%rowtype; release_sha text; current_evidence jsonb; derived jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND OR m.direction<>'outbound' THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 IF m.environment<>'production' OR m.message_family IN ('CONTRL','APERAK','UTILTS_ERR') OR (m.message_family='UTILTS' AND m.message_code='ERR') THEN RETURN; END IF;
 IF m.message_family NOT IN ('PRODAT','UTILTS','AI_LIST') THEN RETURN; END IF;
 derived:=gridex_ediel_readiness.source_scope(m);
 SELECT r.release_sha INTO release_sha FROM public.platform_release_receipts r WHERE r.environment='production' AND r.status='verified' AND r.verified_at IS NOT NULL ORDER BY r.verified_at DESC,r.recorded_at DESC,r.id LIMIT 1 FOR SHARE;
 FOR proof IN SELECT e.* FROM gridex_ediel_readiness.evidence e WHERE e.company_id=p_company_id AND e.scope->>'actorId'=derived->>'actorId'
  AND e.scope->>'actorRole'=derived->>'actorRole' AND e.scope->>'family'=derived->>'family' AND e.scope->>'code'=derived->>'code'
  AND e.scope->>'subtype' IS NOT DISTINCT FROM derived->>'subtype' AND e.scope->>'assignmentId' IS NOT DISTINCT FROM derived->>'assignmentId'
  AND e.expires_at>clock_timestamp() ORDER BY e.verified_at DESC,e.id LOOP
  BEGIN
   current_evidence:=public.ediel_scoped_capability_readiness_v1(p_company_id,m.id,(derived->>'actorId')::uuid,derived->>'actorRole',derived->>'family',derived->>'code',derived->>'subtype',(derived->>'assignmentId')::uuid,release_sha,CASE WHEN m.message_family='AI_LIST' THEN proof.dependencies->>'rulepackHash' ELSE m.rule_pack_checksum END);
   IF current_evidence->'ready'='true'::jsonb THEN RETURN; END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN CONTINUE;
  END;
 END LOOP;
 RAISE EXCEPTION 'ediel_scoped_capability_evidence_required';
END $$;
REVOKE ALL ON FUNCTION public.ediel_require_scoped_capability_for_message_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_scoped_capability_for_message_v1(uuid,uuid) TO service_role;
COMMIT;
