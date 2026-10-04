-- Created by Supabase CLI 2.118.0. OPS-01/SC-064 rule changes invalidate affected own scopes.
-- Existing published142502 is preserved; no rule meaning is selected here.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_ediel_readiness.capture(
 p_company_id uuid,p_message_id uuid,p_legal_actor_id uuid,p_actor_role text,p_family text,p_code text,p_subtype text,
 p_assignment_id uuid,p_release_sha text,p_rulepack_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype; r public.ediel_route_profiles%rowtype; scope jsonb; deps jsonb; profile_rows jsonb; role_rows jsonb;
 identifier_rows jsonb; capability_rows jsonb; permission_rows jsonb:='[]'; assignment_rows jsonb:='[]'; certificate_rows jsonb;
 schema_parts jsonb; schema_hash text; schema_ready boolean; release_row public.platform_release_receipts%rowtype; source_tokens jsonb; family text; code text; wire_subtype text;
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
 IF p_family='AI_LIST' THEN
  -- Full CSV/role/detail authority is the shared AI source parser before sealing.
  -- The final RPC binds its saved format/party scope; it never parses as EDIFACT.
  IF p_code<>'AI' OR p_actor_role<>'electricity_supplier' OR p_subtype IS NOT NULL
    OR split_part(m.raw_payload,';',1)<>'AI'
    OR rtrim(split_part(split_part(m.raw_payload,E'\n',1),';',10),E'\r')<>'Ver20140401' THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
  family:='AI_LIST';code:='AI';
 ELSE
 source_tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);
 SELECT t#>>'{elements,2,0}' INTO family FROM jsonb_array_elements(source_tokens) t WHERE t->>'tag'='UNH';
 SELECT t#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(source_tokens) t WHERE t->>'tag'='BGM';
 IF p_family='PRODAT' THEN
  SELECT cav.token#>>'{elements,1,0}' INTO wire_subtype FROM jsonb_array_elements(source_tokens) WITH ORDINALITY cci(token,n)
   JOIN jsonb_array_elements(source_tokens) WITH ORDINALITY cav(token,n) ON cav.n=cci.n+1
   WHERE cci.token->>'tag'='CCI' AND cci.token#>>'{elements,2,0}'='Z13' AND cav.token->>'tag'='CAV' ORDER BY cci.n LIMIT 1;
  -- The physical reason token is retained; canonical aliasing belongs to the
  -- sole policy gateway. Evidence includes it and cannot choose another wire.
 END IF;
 END IF;
 IF family IS DISTINCT FROM p_family OR code IS DISTINCT FROM p_code THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') INTO profile_rows FROM public.tenant_ediel_profiles a
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
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_readiness' AND p.proname='capture')) INTO schema_parts;
 schema_hash:=encode(digest(convert_to(schema_parts::text,'UTF8'),'sha256'),'hex');
 scope:=jsonb_build_object('companyId',p_company_id,'actorId',p_legal_actor_id,'actorRole',p_actor_role,'market','electricity','environment','production','family',p_family,'code',p_code,'subtype',p_subtype,'assignmentId',p_assignment_id);
 deps:=jsonb_build_object('releaseSha',p_release_sha,'releaseReceipt',jsonb_build_object('id',release_row.id,'ciRunId',release_row.ci_run_id,'deploymentId',release_row.deployment_id,'schemaMigrationVersion',release_row.schema_migration_version,'databaseSchemaFingerprint',to_jsonb(release_row)->'database_schema_fingerprint','generatedTypesHash',to_jsonb(release_row)->'generated_types_hash','migrationManifestHash',to_jsonb(release_row)->'migration_manifest_hash'),'schemaFingerprint',schema_hash,'rulepackHash',p_rulepack_hash,'wireTransactionReason',wire_subtype,'technicalFormatVersion',CASE WHEN p_family='AI_LIST' THEN 'Ver20140401' ELSE NULL END,'rulepackId',m.canonical_rule_pack_id,'ruleProfileVersionId',m.rule_profile_version_id,
   'normativeProjection',coalesce((SELECT jsonb_agg(jsonb_build_object('packId',rp.id,'sourceHash',rp.source_hash,'status',rp.status,'profileId',mp.id,'profileKey',mp.profile_key,'subtype',mp.transaction_subtype,'profile',mp.profile) ORDER BY rp.id,mp.id)
    FROM public.ediel_rule_packs rp JOIN public.ediel_message_profiles mp ON mp.rule_pack_id=rp.id
    WHERE rp.family=p_family AND rp.market='electricity' AND rp.status='active' AND mp.is_enabled AND mp.message_code=p_code AND mp.direction IN ('outbound','both') AND mp.transaction_subtype IN ('','*',coalesce(p_subtype,''))), '[]'),
  'tenantRuleProfileVersion',coalesce((SELECT jsonb_build_object('id',rv.id,'version',rv.version,'status',rv.status,'checksum',rv.checksum,'sourceRevision',rv.source_revision)
    FROM public.ediel_rule_profile_versions rv WHERE rv.company_id=p_company_id AND rv.id=m.rule_profile_version_id), '{}'::jsonb),
  'profile',profile_rows,'legalIdentifiers' ,identifier_rows,'actorRole',role_rows,'capability',capability_rows,
  'route',jsonb_build_object('id',r.id,'communicationRouteId',r.communication_route_id,'routeVersion',to_jsonb(r)->'route_version','senderEdielId',r.sender_ediel_id,'receiverEdielId',r.receiver_ediel_id,'senderSubaddress',coalesce(r.sender_sub_address,r.sender_subaddress),'receiverSubaddress',coalesce(r.receiver_sub_address,r.receiver_subaddress),'mailboxId',r.mailbox_id,'transportProfileId',r.transport_profile_id,'certificateId',r.certificate_id,'receiverCertificateId',r.receiver_certificate_id,'enabled',r.is_enabled,'active',r.is_active),
  'certificates',certificate_rows,'assignments',assignment_rows,'permissions',permission_rows);
 RETURN jsonb_build_object('authorityVersion',1,'scope',scope,'dependencies',deps,'dependencyHash',encode(digest(convert_to(jsonb_build_object('scope',scope,'dependencies',deps)::text,'UTF8'),'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_readiness.capture(uuid,uuid,uuid,text,text,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
