-- Created by Supabase CLI 2.118.0. OPS-01 / CALL-16 prospective support.
-- No production capability is enabled and no passed evidence is seeded.
-- Readiness is scoped to tenant/legal actor/role/market/environment/capability,
-- with immutable dependency evidence. Receiving and prescribed ACKs are separate.
BEGIN;
CREATE SCHEMA gridex_ediel_readiness;
REVOKE ALL ON SCHEMA gridex_ediel_readiness FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_readiness.evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 scope jsonb NOT NULL CHECK(jsonb_typeof(scope)='object'), dependency_hash text NOT NULL CHECK(dependency_hash ~ '^[0-9a-f]{64}$'),
 dependencies jsonb NOT NULL CHECK(jsonb_typeof(dependencies)='object'), certification_records jsonb NOT NULL CHECK(jsonb_typeof(certification_records)='array'),
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 CHECK(expires_at>verified_at), UNIQUE(company_id,scope,dependency_hash,expires_at)
);
CREATE INDEX ediel_scoped_readiness_evidence_lookup ON gridex_ediel_readiness.evidence(company_id,dependency_hash,expires_at DESC);
ALTER TABLE gridex_ediel_readiness.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_readiness.evidence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_readiness.evidence FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ediel_readiness.reject_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ediel_scoped_evidence_immutable'; END $$;
REVOKE ALL ON FUNCTION gridex_ediel_readiness.reject_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER scoped_evidence_no_mutation BEFORE UPDATE OR DELETE ON gridex_ediel_readiness.evidence FOR EACH ROW EXECUTE FUNCTION gridex_ediel_readiness.reject_mutation();
CREATE TRIGGER scoped_evidence_no_truncate BEFORE TRUNCATE ON gridex_ediel_readiness.evidence FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_readiness.reject_mutation();

-- The dependency graph uses exact selected role/capability rows. It does not
-- hash all actors, all routes, all permissions or all message families globally.
CREATE FUNCTION gridex_ediel_readiness.capture(
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
  'profile',profile_rows,'legalIdentifiers',identifier_rows,'actorRole',role_rows,'capability',capability_rows,
  'route',jsonb_build_object('id',r.id,'communicationRouteId',r.communication_route_id,'routeVersion',to_jsonb(r)->'route_version','senderEdielId',r.sender_ediel_id,'receiverEdielId',r.receiver_ediel_id,'senderSubaddress',coalesce(r.sender_sub_address,r.sender_subaddress),'receiverSubaddress',coalesce(r.receiver_sub_address,r.receiver_subaddress),'mailboxId',r.mailbox_id,'transportProfileId',r.transport_profile_id,'certificateId',r.certificate_id,'receiverCertificateId',r.receiver_certificate_id,'enabled',r.is_enabled,'active',r.is_active),
  'certificates',certificate_rows,'assignments',assignment_rows,'permissions',permission_rows);
 RETURN jsonb_build_object('authorityVersion',1,'scope',scope,'dependencies',deps,'dependencyHash',encode(digest(convert_to(jsonb_build_object('scope',scope,'dependencies',deps)::text,'UTF8'),'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_readiness.capture(uuid,uuid,uuid,text,text,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ediel_scoped_capability_readiness_v1(
 p_company_id uuid,p_message_id uuid,p_legal_actor_id uuid,p_actor_role text,p_family text,p_code text,p_subtype text,p_assignment_id uuid,p_release_sha text,p_rulepack_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,gridex_ediel_readiness AS $$
DECLARE current_evidence jsonb; proof gridex_ediel_readiness.evidence%rowtype;
BEGIN
 current_evidence:=gridex_ediel_readiness.capture(p_company_id,p_message_id,p_legal_actor_id,p_actor_role,p_family,p_code,p_subtype,p_assignment_id,p_release_sha,p_rulepack_hash);
 SELECT * INTO proof FROM gridex_ediel_readiness.evidence WHERE company_id=p_company_id AND scope=current_evidence->'scope' AND dependency_hash=current_evidence->>'dependencyHash' AND expires_at>clock_timestamp() ORDER BY verified_at DESC,id LIMIT 1;
 -- Evidence revocation/expiry is re-read, not cached in the immutable proof.
 IF FOUND AND NOT EXISTS(SELECT FROM jsonb_array_elements(proof.certification_records) old LEFT JOIN public.ediel_certification_evidence live ON live.id=(old->>'id')::uuid AND live.company_id=p_company_id
    WHERE live.id IS NULL OR to_jsonb(live) IS DISTINCT FROM old OR live.status<>'passed' OR (live.valid_until IS NOT NULL AND live.valid_until<=clock_timestamp())) THEN
  RETURN current_evidence||jsonb_build_object('ready',true,'evidenceId',proof.id,'expiresAt',proof.expires_at);
 END IF;
 RETURN current_evidence||jsonb_build_object('ready',false,'evidenceId',NULL,'expiresAt',NULL);
END $$;
REVOKE ALL ON FUNCTION public.ediel_scoped_capability_readiness_v1(uuid,uuid,uuid,text,text,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_scoped_capability_readiness_v1(uuid,uuid,uuid,text,text,text,text,uuid,text,text) TO service_role;

CREATE FUNCTION public.ediel_record_scoped_capability_evidence_v1(
 p_company_id uuid,p_message_id uuid,p_legal_actor_id uuid,p_actor_role text,p_family text,p_code text,p_subtype text,p_assignment_id uuid,p_release_sha text,p_rulepack_hash text,
 p_expected_dependency_hash text,p_certification_evidence_ids uuid[],p_expires_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,gridex_ediel_readiness AS $$
DECLARE current_evidence jsonb; records jsonb; required text[]:=ARRAY['TGT','AGT','SHADOW_PRODUCTION','LIVE_TENANT_INTEGRITY','RESTORE_REPLAY']; proof_id uuid;
BEGIN
 current_evidence:=gridex_ediel_readiness.capture(p_company_id,p_message_id,p_legal_actor_id,p_actor_role,p_family,p_code,p_subtype,p_assignment_id,p_release_sha,p_rulepack_hash);
 IF p_expected_dependency_hash IS DISTINCT FROM current_evidence->>'dependencyHash' OR p_expires_at IS NULL OR p_expires_at<=clock_timestamp() OR cardinality(p_certification_evidence_ids) IS NULL THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 IF EXISTS(SELECT FROM public.ediel_messages WHERE company_id=p_company_id AND environment='production' AND direction='outbound' AND message_family=p_family AND message_code=p_code AND status='sent') THEN required:=required||'LIMITED_PILOT'::text; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') INTO records FROM public.ediel_certification_evidence e
  WHERE e.id=ANY(p_certification_evidence_ids) AND e.company_id=p_company_id AND e.environment='production' AND e.status='passed'
   AND e.external_reference IS NOT NULL AND e.evidence_document_reference IS NOT NULL AND e.approved_by IS NOT NULL AND e.approved_at IS NOT NULL
   AND e.tested_at IS NOT NULL AND e.tested_at<=clock_timestamp() AND (e.valid_until IS NULL OR e.valid_until>=p_expires_at)
   AND e.metadata->'edielScopedReadiness'->'scope'=current_evidence->'scope'
   AND e.metadata->'edielScopedReadiness'->>'dependencyHash'=p_expected_dependency_hash
   AND jsonb_typeof(e.metadata#>'{edielScopedReadiness,tests}')='array'
   AND jsonb_array_length(e.metadata#>'{edielScopedReadiness,tests}')>0
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(e.metadata#>'{edielScopedReadiness,tests}') t WHERE jsonb_typeof(t)<>'object'
     OR nullif(t->>'testId','') IS NULL OR nullif(t->>'sourceRevision','') IS NULL OR nullif(t->>'evidenceReference','') IS NULL
     OR t->>'candidateSha' IS DISTINCT FROM p_release_sha OR t->>'result' IS DISTINCT FROM 'passed' OR coalesce(t->>'payloadSha256','') !~ '^[0-9a-f]{64}$');
 IF jsonb_array_length(records)<>cardinality(p_certification_evidence_ids) OR EXISTS(SELECT FROM unnest(required) k WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(records) e WHERE e->>'evidence_type'=k)) THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 INSERT INTO gridex_ediel_readiness.evidence(company_id,scope,dependency_hash,dependencies,certification_records,expires_at)
 VALUES(p_company_id,current_evidence->'scope',p_expected_dependency_hash,current_evidence->'dependencies',records,p_expires_at)
 ON CONFLICT(company_id,scope,dependency_hash,expires_at) DO NOTHING RETURNING id INTO proof_id;
 IF proof_id IS NULL THEN SELECT id INTO proof_id FROM gridex_ediel_readiness.evidence WHERE company_id=p_company_id AND scope=current_evidence->'scope' AND dependency_hash=p_expected_dependency_hash AND expires_at=p_expires_at; END IF;
 RETURN proof_id;
END $$;
REVOKE ALL ON FUNCTION public.ediel_record_scoped_capability_evidence_v1(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,uuid[],timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_record_scoped_capability_evidence_v1(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,uuid[],timestamptz) TO service_role;
-- Final provider-entry RPC can invoke this same authority without accepting a
-- client release/ready flag. It reuses existing immutable proofs and reconstructs
-- current source/role/capability dependencies against the real release receipt.
CREATE FUNCTION public.ediel_require_scoped_capability_for_message_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,gridex_ediel_readiness AS $$
DECLARE m public.ediel_messages%rowtype; proof gridex_ediel_readiness.evidence%rowtype; release_sha text; current_evidence jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND OR m.direction<>'outbound' THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 IF m.environment<>'production' OR m.message_family IN ('CONTRL','APERAK','UTILTS_ERR') OR (m.message_family='UTILTS' AND m.message_code='ERR') THEN RETURN; END IF;
 -- NBS and other platform tracks retain their own separately owned authority.
 IF m.message_family NOT IN ('PRODAT','UTILTS','AI_LIST') THEN RETURN; END IF;
 SELECT r.release_sha INTO release_sha FROM public.platform_release_receipts r WHERE r.environment='production' AND r.status='verified'
  AND r.verified_at IS NOT NULL ORDER BY r.verified_at DESC,r.recorded_at DESC,r.id LIMIT 1 FOR SHARE;
 FOR proof IN SELECT e.* FROM gridex_ediel_readiness.evidence e WHERE e.company_id=p_company_id AND e.scope->>'family'=m.message_family
  AND e.scope->>'code'=m.message_code AND e.expires_at>clock_timestamp() ORDER BY e.verified_at DESC,e.id LOOP
  BEGIN
   current_evidence:=public.ediel_scoped_capability_readiness_v1(p_company_id,m.id,(proof.scope->>'actorId')::uuid,proof.scope->>'actorRole',m.message_family,m.message_code,
    proof.scope->>'subtype',(proof.scope->>'assignmentId')::uuid,release_sha,CASE WHEN m.message_family='AI_LIST' THEN proof.dependencies->>'rulepackHash' ELSE m.rule_pack_checksum END);
   IF current_evidence->'ready'='true'::jsonb THEN RETURN; END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN CONTINUE;
  END;
 END LOOP;
 RAISE EXCEPTION 'ediel_scoped_capability_evidence_required';
END $$;
REVOKE ALL ON FUNCTION public.ediel_require_scoped_capability_for_message_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_scoped_capability_for_message_v1(uuid,uuid) TO service_role;

-- Forward replacement of the aggregate dashboard snapshot side effect.
create or replace function public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns public.ediel_configuration_snapshots
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_payload jsonb;
  v_hash text;
  v_next_version bigint;
  v_snapshot public.ediel_configuration_snapshots%rowtype;
  v_existing public.ediel_configuration_snapshots%rowtype;
begin
  if p_company_id is null then raise exception 'company_id_required'; end if;
  select * into v_company from public.companies where id = p_company_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  v_payload := jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id,
      'actor_role', coalesce(v_company.actor_role, nullif(to_jsonb(v_company)->>'market_role', '')),
      'test_ediel_id', v_company.test_ediel_id,
      'production_ediel_id', v_company.production_ediel_id,
      'brp_ediel_id', v_company.brp_ediel_id,
      'test_application_reference', v_company.test_application_reference,
      'production_application_reference', v_company.production_application_reference,
      'test_sender_sub_address', v_company.test_sender_sub_address,
      'production_sender_sub_address', v_company.production_sender_sub_address,
      'test_mailbox', v_company.test_mailbox,
      'production_mailbox', v_company.production_mailbox,
      'primary_test_route_id', v_company.ediel_primary_test_route_profile_id,
      'primary_production_route_id', v_company.ediel_primary_production_route_profile_id
    ),
    'actor_profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'environment', a.environment,
        'actor_role', coalesce(a.actor_role, a.role),
        'ediel_id', coalesce(a.actor_ediel_id, a.ediel_id),
        'sender_subaddress', coalesce(a.sender_sub_address, a.sender_subaddress),
        'receiver_subaddress', coalesce(a.receiver_sub_address, a.receiver_subaddress),
        'application_reference', coalesce(a.application_reference, a.default_application_reference),
        'mailbox', a.mailbox,
        'brp_ediel_id', a.brp_ediel_id,
        'is_active', a.is_active
      ) order by a.environment, a.id)
      from public.ediel_actor_settings a
      where a.company_id = p_company_id
    ), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'environment', r.environment,
        'route_type', r.route_type,
        'sender_ediel_id', r.sender_ediel_id,
        'sender_subaddress', coalesce(r.sender_sub_address, r.sender_subaddress),
        'receiver_ediel_id', r.receiver_ediel_id,
        'receiver_subaddress', coalesce(r.receiver_sub_address, r.receiver_subaddress),
        'mailbox_id', r.mailbox_id,
        'transport_profile_id', r.transport_profile_id,
        'certificate_id', r.certificate_id,
        'receiver_certificate_id', r.receiver_certificate_id,
        'is_active', r.is_active,
        'is_enabled', r.is_enabled
      ) order by r.environment, r.id)
      from public.ediel_route_profiles r
      where r.company_id = p_company_id
    ), '[]'::jsonb),
    'mailboxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'environment', m.environment,
        'mailbox_name', m.mailbox_name,
        'email_address', m.email_address,
        'imap_host', m.imap_host,
        'imap_port', m.imap_port,
        'provider', m.provider,
        'mailbox_type', m.mailbox_type,
        'is_active', m.is_active,
        'is_shared_platform_mailbox', m.is_shared_platform_mailbox,
        'secret_reference_present', m.secret_reference is not null
      ) order by m.environment, m.id)
      from public.ediel_mailboxes m
      where m.company_id = p_company_id
    ), '[]'::jsonb),
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'fingerprint', c.certificate_fingerprint,
        'valid_from', c.certificate_valid_from,
        'valid_to', c.certificate_valid_to,
        'encryption_status', c.encryption_status,
        'status', c.status
      ) order by c.id)
      from public.ediel_certificates c
      where c.company_id = p_company_id
    ), '[]'::jsonb),
    'active_test_configurations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'environment', tc.environment,
        'test_suite', tc.test_suite,
        'actor_role', tc.actor_role,
        'message_family', tc.message_family,
        'setup_package', tc.setup_package,
        'status', tc.status
      ) order by tc.environment, tc.test_suite, tc.actor_role, tc.message_family, tc.setup_package)
      from public.ediel_active_test_configurations tc
      where tc.company_id = p_company_id and tc.status = 'active'
    ), '[]'::jsonb),
    'active_rule_versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id,
        'rule_key', rv.rule_key,
        'version_code', rv.version_code,
        'schema_version', rv.schema_version,
        'environment', rv.environment,
        'message_family', rv.message_family,
        'message_code', rv.message_code,
        'business_process', rv.business_process,
        'source_version', rv.source_version,
        'status', rv.status,
        'is_active', rv.is_active
      ) order by rv.rule_key, rv.version_code, rv.id)
      from public.ediel_rule_versions rv
      where coalesce(rv.is_active, false) = true
        and coalesce(rv.status, 'active') = 'active'
    ), '[]'::jsonb),
    'active_rule_packs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rp.id,
        'market', rp.market,
        'family', rp.family,
        'guide_version', rp.guide_version,
        'guide_revision', rp.guide_revision,
        'unh_association_code', rp.unh_association_code,
        'valid_from', rp.valid_from,
        'valid_to', rp.valid_to,
        'status', rp.status,
        'source_hash', rp.source_hash,
        'field_matrix_version', rp.field_matrix_version,
        'code_list_versions', rp.code_list_versions
      ) order by rp.market, rp.family, rp.guide_version, rp.guide_revision, rp.id)
      from public.ediel_rule_packs rp
      where rp.status = 'active'
    ), '[]'::jsonb),
    'enabled_message_profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mp.id,
        'rule_pack_id', mp.rule_pack_id,
        'message_code', mp.message_code,
        'transaction_subtype', mp.transaction_subtype,
        'direction', mp.direction,
        'business_process', mp.business_process,
        'phase', mp.phase,
        'profile_key', mp.profile_key,
        'profile', mp.profile,
        'is_enabled', mp.is_enabled
      ) order by mp.rule_pack_id, mp.message_code, mp.transaction_subtype, mp.direction, mp.profile_key, mp.id)
      from public.ediel_message_profiles mp
      where mp.is_enabled = true
    ), '[]'::jsonb),
    'active_tenant_rule_profile_versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rpv.id,
        'rule_profile_id', rpv.rule_profile_id,
        'profile_key', rpv.profile_key,
        'version', rpv.version,
        'status', rpv.status,
        'checksum', rpv.checksum,
        'source_revision', rpv.source_revision,
        'rules', rpv.rules
      ) order by rpv.profile_key, rpv.version, rpv.id)
      from public.ediel_rule_profile_versions rpv
      where rpv.company_id = p_company_id and rpv.status = 'active'
    ), '[]'::jsonb),
    'engine_version', 'canonical-evidence-v3'
  );

  v_hash := encode(digest(convert_to(v_payload::text, 'utf8'), 'sha256'), 'hex');
  select * into v_existing
  from public.ediel_configuration_snapshots
  where company_id = p_company_id and configuration_hash = v_hash;
  if found then return v_existing; end if;

  select coalesce(max(snapshot_version), 0) + 1 into v_next_version
  from public.ediel_configuration_snapshots
  where company_id = p_company_id;

  insert into public.ediel_configuration_snapshots(
    company_id, snapshot_version, actor_role, test_ediel_id, production_ediel_id,
    test_brp_ediel_id, production_brp_ediel_id,
    test_application_reference, production_application_reference,
    primary_test_route_id, primary_production_route_id, payload, configuration_hash,
    reason, created_by
  ) values (
    p_company_id,
    v_next_version,
    coalesce(v_company.actor_role, nullif(to_jsonb(v_company)->>'market_role', '')),
    v_company.test_ediel_id,
    v_company.production_ediel_id,
    v_company.brp_ediel_id,
    v_company.brp_ediel_id,
    v_company.test_application_reference,
    v_company.production_application_reference,
    v_company.ediel_primary_test_route_profile_id,
    v_company.ediel_primary_production_route_profile_id,
    v_payload,
    v_hash,
    coalesce(nullif(btrim(p_reason), ''), 'configuration_changed'),
    p_actor_user_id
  ) returning * into v_snapshot;

  -- Exactly one durable readiness revalidation job per immutable snapshot.
  insert into public.company_provisioning_jobs(
    company_id,
    job_key,
    status,
    idempotency_key,
    available_at,
    last_error_details
  ) values (
    p_company_id,
    'ediel_readiness_revalidate',
    'pending',
    v_snapshot.id::text,
    now(),
    '{}'::jsonb
  )
  on conflict (company_id, job_key, idempotency_key) do nothing;

  update public.ediel_test_runs
  set is_stale = true,
      stale_reason = 'configuration_changed',
      stale_at = now()
  where company_id = p_company_id
    and completed_at is not null
    and configuration_snapshot_id is distinct from v_snapshot.id;

  update public.actor_test_results
  set is_stale = true,
      stale_reason = 'configuration_changed',
      updated_at = now()
  where company_id = p_company_id
    and configuration_snapshot_id is distinct from v_snapshot.id;

  update public.ediel_production_readiness_checks
  set is_stale = true,
      stale_reason = 'configuration_changed'
  where company_id = p_company_id
    and configuration_snapshot_id is distinct from v_snapshot.id;

  update public.ediel_go_live_events
  set is_stale = true,
      stale_reason = 'configuration_changed'
  where company_id = p_company_id
    and event_type = 'production_dry_run'
    and configuration_snapshot_id is distinct from v_snapshot.id;

  -- This aggregate snapshot is retained for operations/dashboard continuity.
  -- A dependency change invalidates only matching immutable capability proofs
  -- on their next read; it must not pause an unrelated legal role/capability.
  -- Explicit operator production state and send locks are preserved.
  update public.ediel_production_state
  set configuration_snapshot_id = v_snapshot.id,
      updated_at = now()
  where company_id = p_company_id;

  return v_snapshot;
end;
$$;

COMMIT;
