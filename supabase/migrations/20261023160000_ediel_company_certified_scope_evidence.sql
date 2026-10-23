-- FINDINGS F89/F90/F91 (reality world 2026-10-22/23). Owner decision 2026-10-23
-- ("Automatiska bevis"): the platform itself records the per-scope production proof
-- that ediel_scoped_capability_readiness_v1 accepts, from the company's own approved
-- certification, for every enabled scope, and re-records it after every deploy,
-- route change or rule-edition change. v1 readiness, the v1 record RPC, the SQL
-- transport gate and OPS-01/SC-069/IMP-05 are unchanged.
--
-- Why this is possible without editing v1:
--  * ediel_record_scoped_capability_evidence_v1 is the ONLY place that requires every
--    certification row to name the one scope (metadata.edielScopedReadiness.scope) and
--    tests on the release SHA. That rebinding is the F90 flaw.
--  * ediel_scoped_capability_readiness_v1 only requires an unexpired proof row for the
--    exact (company, scope, dependency hash) whose certification_records snapshot is
--    still byte-identical (to_jsonb) to the live rows, which are still passed and not
--    past valid_until. It never reads the scope metadata of the rows.
--  So a proof whose snapshot is the company's current, unmodified certification rows is
--  accepted by v1 for any number of scopes at once, and is voided exactly as before by a
--  changed/revoked/expired row or a changed dependency hash (release SHA, route, rule
--  pack, certificates, roles, capability rows, schema of the capture graph).
--
-- Recording (all must hold, otherwise nothing is written and a reason is returned):
--  company capability ediel_production enabled+ready; canonical_ediel_production_
--  evidence_readiness ready (tenant-bound, engine-version-bound); tenant operation
--  'ediel.production.send' allowed; the canonical source scope derives the tenant's one
--  allowed sender role for the message; the message's production route profile is
--  enabled, active and production-approved (is_production_ready, mode live/active); no
--  current tenant_message_capabilities row disables the scope; the latest verified
--  production release receipt names the running release SHA; v1 capture succeeds.
-- F91: v1 capture requires an enabled tenant_message_capabilities row, so the recorder
--  writes it for the exact scope, derived from the production-approved route profile,
--  inside the same all-or-nothing block. A row with is_enabled=false is an explicit deny.
-- No release receipt is written here (see the deploy workflow and lib/ediel/companyCertifiedScopes.ts).

CREATE OR REPLACE FUNCTION public.ediel_record_company_certified_scope_evidence_v1(p_company_id uuid, p_message_id uuid, p_release_sha text, p_rulepack_hash text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $$
DECLARE m public.ediel_messages%rowtype; r public.ediel_route_profiles%rowtype; derived jsonb; rulepack text; latest_sha text;
 company_evidence jsonb; decision record; current_evidence jsonb; records jsonb; expires timestamptz; proof gridex_ediel_readiness.evidence%rowtype;
 proof_id uuid; readiness jsonb; outcome text:='recorded'; capability_added boolean:=false; subtype_key text;
 base jsonb:=jsonb_build_object('version',1,'companyId',p_company_id,'messageId',p_message_id);
BEGIN
 IF p_company_id IS NULL OR p_message_id IS NULL OR p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$' THEN
  RETURN base||jsonb_build_object('status','held','reason','scope_request_invalid'); END IF;
 -- One recorder per tenant at a time (capability row and proof insert).
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ediel_company_certified_scope:'||p_company_id::text,0));
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND THEN RETURN base||jsonb_build_object('status','held','reason','message_not_found_for_tenant'); END IF;
 base:=base||jsonb_build_object('family',m.message_family,'code',m.message_code);
 IF m.environment IS DISTINCT FROM 'production' OR m.direction IS DISTINCT FROM 'outbound' OR m.raw_payload IS NULL
  OR (m.message_family IN ('PRODAT','UTILTS','AI_LIST')) IS NOT TRUE OR m.message_code IS NOT DISTINCT FROM 'ERR' THEN
  RETURN base||jsonb_build_object('status','held','reason','message_not_production_business_outbound'); END IF;
 IF NOT EXISTS(SELECT FROM public.company_capabilities c WHERE c.company_id=p_company_id AND c.capability_code='ediel_production' AND c.enabled AND c.readiness_status='ready') THEN
  RETURN base||jsonb_build_object('status','held','reason','company_capability_ediel_production_not_ready'); END IF;
 company_evidence:=public.canonical_ediel_production_evidence_readiness(p_company_id);
 IF (company_evidence->>'ready')::boolean IS NOT TRUE THEN
  RETURN base||jsonb_build_object('status','held','reason','company_certification_not_ready','missing',company_evidence->'missing'); END IF;
 SELECT * INTO decision FROM public.canonical_tenant_operation_decision(p_company_id,'ediel.production.send') LIMIT 1;
 IF decision.allowed IS NOT TRUE THEN
  RETURN base||jsonb_build_object('status','held','reason','tenant_operation_not_allowed','decision',decision.reason_code); END IF;
 -- The canonical source scope: legal actor, the one allowed sender role, subtype, assignment.
 BEGIN derived:=gridex_ediel_readiness.source_scope(m);
 EXCEPTION WHEN raise_exception THEN RETURN base||jsonb_build_object('status','held','reason','scope_role_or_identity_not_allowed'); END;
 subtype_key:=coalesce(derived->>'subtype','');
 base:=base||jsonb_build_object('actorRole',derived->>'actorRole','subtype',derived->'subtype','assignmentId',derived->'assignmentId','routeProfileId',m.route_profile_id);
 SELECT * INTO r FROM public.ediel_route_profiles WHERE id=m.route_profile_id AND company_id=p_company_id AND environment='production';
 IF NOT FOUND OR r.is_enabled IS NOT TRUE OR r.is_active IS NOT DISTINCT FROM false OR r.is_production_ready IS NOT TRUE OR (r.production_mode IN ('live','active')) IS NOT TRUE THEN
  RETURN base||jsonb_build_object('status','held','reason','route_profile_not_production_approved'); END IF;
 IF EXISTS(SELECT FROM public.tenant_message_capabilities c WHERE c.company_id=p_company_id AND c.environment='production' AND c.message_family=m.message_family
   AND c.message_code=m.message_code AND c.transaction_subtype IN ('*',subtype_key) AND c.direction IN ('outbound','both') AND NOT c.is_enabled
   AND c.valid_from<=now() AND (c.valid_to IS NULL OR c.valid_to>now())) THEN
  RETURN base||jsonb_build_object('status','held','reason','scope_explicitly_disabled'); END IF;
 rulepack:=CASE WHEN m.message_family='AI_LIST' THEN p_rulepack_hash ELSE m.rule_pack_checksum END;
 IF rulepack IS NULL OR rulepack !~ '^[0-9a-f]{64}$' OR (p_rulepack_hash IS NOT NULL AND p_rulepack_hash IS DISTINCT FROM rulepack) THEN
  RETURN base||jsonb_build_object('status','held','reason','rulepack_hash_required'); END IF;
 -- The exact receipt selection of capture_before_route_dependencies_v1.
 SELECT x.release_sha INTO latest_sha FROM public.platform_release_receipts x WHERE x.environment='production' AND x.status='verified'
  AND x.verified_at IS NOT NULL AND nullif(x.ci_run_id,'') IS NOT NULL AND nullif(x.deployment_id,'') IS NOT NULL
  ORDER BY x.verified_at DESC,x.recorded_at DESC,x.id LIMIT 1;
 IF latest_sha IS DISTINCT FROM p_release_sha THEN
  RETURN base||jsonb_build_object('status','held','reason','release_receipt_missing_for_running_sha'); END IF;
 -- All writes are one subtransaction: any later failure rolls back the capability row too.
 BEGIN
  IF NOT EXISTS(SELECT FROM public.tenant_message_capabilities c WHERE c.company_id=p_company_id AND c.environment='production' AND c.message_family=m.message_family
    AND c.message_code=m.message_code AND c.transaction_subtype IN ('*',subtype_key) AND c.direction IN ('outbound','both') AND c.is_enabled
    AND c.valid_from<=now() AND (c.valid_to IS NULL OR c.valid_to>now())) THEN
   INSERT INTO public.tenant_message_capabilities(company_id,environment,message_family,message_code,transaction_subtype,direction,is_enabled,valid_from,metadata)
   VALUES(p_company_id,'production',m.message_family,m.message_code,coalesce(nullif(subtype_key,''),'*'),'outbound',true,now(),
    jsonb_build_object('source','ediel_company_certified_scope_v1','derivedFrom','production_approved_route_profile','routeProfileId',r.id,'messageId',m.id));
   capability_added:=true;
  END IF;
  current_evidence:=gridex_ediel_readiness.capture(p_company_id,m.id,(derived->>'actorId')::uuid,derived->>'actorRole',derived->>'family',derived->>'code',
   derived->>'subtype',(derived->>'assignmentId')::uuid,p_release_sha,rulepack);
  -- The company's own current certification: exactly the rows the company gate counts, unmodified.
  PERFORM e.id FROM public.ediel_certification_evidence e WHERE e.company_id=p_company_id AND e.environment='production' ORDER BY e.id FOR SHARE;
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'),least(clock_timestamp()+interval '30 days',min(e.valid_until)) INTO records,expires
   FROM public.ediel_certification_evidence e
   WHERE e.company_id=p_company_id AND e.environment='production' AND e.engine_schema_version=public.canonical_current_ediel_engine_schema_version()
    AND e.status='passed' AND nullif(btrim(e.external_reference),'') IS NOT NULL AND nullif(btrim(e.evidence_document_reference),'') IS NOT NULL
    AND e.tested_at IS NOT NULL AND e.tested_at<=now() AND e.approved_by IS NOT NULL AND e.approved_at IS NOT NULL
    AND (e.valid_until IS NULL OR e.valid_until>now()) AND (e.valid_until IS NULL OR e.valid_until>e.tested_at)
    AND e.evidence_type IN (SELECT jsonb_array_elements_text(company_evidence->'passed'));
  IF jsonb_array_length(records)=0 OR jsonb_array_length(records)<>jsonb_array_length(company_evidence->'passed')
   OR expires IS NULL OR expires<=clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION 'ediel_company_certification_snapshot_unavailable'; END IF;
  -- A current proof (any recorder) for this exact dependency hash with an unchanged snapshot is kept.
  SELECT * INTO proof FROM gridex_ediel_readiness.evidence e WHERE e.company_id=p_company_id AND e.scope=current_evidence->'scope'
   AND e.dependency_hash=current_evidence->>'dependencyHash' AND e.expires_at>clock_timestamp()+interval '1 day'
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(e.certification_records) old LEFT JOIN public.ediel_certification_evidence live ON live.id=(old->>'id')::uuid AND live.company_id=p_company_id
    WHERE live.id IS NULL OR to_jsonb(live) IS DISTINCT FROM old OR live.status<>'passed' OR (live.valid_until IS NOT NULL AND live.valid_until<=clock_timestamp()))
   ORDER BY e.verified_at DESC,e.id LIMIT 1;
  IF FOUND THEN outcome:='current'; proof_id:=proof.id; expires:=proof.expires_at;
  ELSE
   INSERT INTO gridex_ediel_readiness.evidence(company_id,scope,dependency_hash,dependencies,certification_records,expires_at)
   VALUES(p_company_id,current_evidence->'scope',current_evidence->>'dependencyHash',current_evidence->'dependencies',records,expires)
   ON CONFLICT(company_id,scope,dependency_hash,expires_at) DO NOTHING RETURNING id INTO proof_id;
   IF proof_id IS NULL THEN SELECT e.id INTO proof_id FROM gridex_ediel_readiness.evidence e WHERE e.company_id=p_company_id AND e.scope=current_evidence->'scope'
    AND e.dependency_hash=current_evidence->>'dependencyHash' AND e.expires_at=expires; END IF;
  END IF;
  -- The unchanged v1 authority must now accept the scope, or nothing is kept.
  readiness:=public.ediel_scoped_capability_readiness_v1(p_company_id,m.id,(derived->>'actorId')::uuid,derived->>'actorRole',derived->>'family',derived->>'code',
   derived->>'subtype',(derived->>'assignmentId')::uuid,p_release_sha,rulepack);
  IF readiness->'ready' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'ediel_company_certified_scope_not_ready'; END IF;
 EXCEPTION WHEN raise_exception THEN
  RETURN base||jsonb_build_object('status','held','reason','scope_dependencies_not_ready','detail',SQLERRM);
 END;
 RETURN base||jsonb_build_object('status',outcome,'evidenceId',readiness->'evidenceId','expiresAt',readiness->'expiresAt','dependencyHash',current_evidence->'dependencyHash',
  'scope',current_evidence->'scope','capabilityAdded',capability_added,'certificationEvidenceIds',(SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(records) x));
END $$;

-- The post-deploy/cron job: every pending production business scope of every tenant
-- whose ediel_production capability is ready, one representative message per
-- (tenant, family, code, route, rule pack/profile, assignment). Each scope is isolated.
CREATE OR REPLACE FUNCTION public.ediel_record_company_certified_scopes_v1(p_release_sha text, p_ai_rulepack_hash text DEFAULT NULL, p_limit integer DEFAULT 200, p_company_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $$
DECLARE c record; result jsonb; results jsonb:='[]';
BEGIN
 IF p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$' THEN RAISE EXCEPTION 'ediel_release_sha_unavailable' USING ERRCODE='22023'; END IF;
 FOR c IN SELECT s.id,s.company_id,s.message_family FROM (
   SELECT DISTINCT ON (m.company_id,m.message_family,m.message_code,m.route_profile_id,m.communication_route_id,m.canonical_rule_pack_id,m.rule_profile_version_id,m.rule_pack_checksum,m.parsed_payload->>'serviceAssignmentId')
    m.id,m.company_id,m.message_family,m.created_at
   FROM public.ediel_messages m
   WHERE m.environment='production' AND m.direction='outbound' AND m.status IN ('draft','queued') AND m.raw_payload IS NOT NULL
    AND m.message_family IN ('PRODAT','UTILTS','AI_LIST') AND m.message_code IS DISTINCT FROM 'ERR'
    AND (p_company_id IS NULL OR m.company_id=p_company_id)
    AND EXISTS(SELECT FROM public.company_capabilities k WHERE k.company_id=m.company_id AND k.capability_code='ediel_production' AND k.enabled AND k.readiness_status='ready')
    AND NOT EXISTS(SELECT FROM public.ediel_outbox o WHERE o.ediel_message_id=m.id AND o.status IN ('sent','failed','superseded','blocked','blocked_tenant_state','delivery_uncertain'))
   ORDER BY m.company_id,m.message_family,m.message_code,m.route_profile_id,m.communication_route_id,m.canonical_rule_pack_id,m.rule_profile_version_id,m.rule_pack_checksum,m.parsed_payload->>'serviceAssignmentId',m.created_at DESC,m.id
  ) s ORDER BY s.created_at,s.id LIMIT greatest(1,least(coalesce(p_limit,200),500))
 LOOP
  BEGIN
   result:=public.ediel_record_company_certified_scope_evidence_v1(c.company_id,c.id,p_release_sha,CASE WHEN c.message_family='AI_LIST' THEN p_ai_rulepack_hash END);
  EXCEPTION WHEN OTHERS THEN
   result:=jsonb_build_object('version',1,'companyId',c.company_id,'messageId',c.id,'status','held','reason','scope_recording_failed','detail',SQLSTATE);
  END;
  results:=results||jsonb_build_array(result);
 END LOOP;
 RETURN jsonb_build_object('version',1,'releaseSha',p_release_sha,'scopes',jsonb_array_length(results),
  'recorded',(SELECT count(*) FROM jsonb_array_elements(results) x WHERE x->>'status'='recorded'),
  'current',(SELECT count(*) FROM jsonb_array_elements(results) x WHERE x->>'status'='current'),
  'held',(SELECT count(*) FROM jsonb_array_elements(results) x WHERE x->>'status'='held'),
  'results',results);
END $$;

REVOKE ALL ON FUNCTION public.ediel_record_company_certified_scope_evidence_v1(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ediel_record_company_certified_scope_evidence_v1(uuid,uuid,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_record_company_certified_scope_evidence_v1(uuid,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_record_company_certified_scopes_v1(text,text,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ediel_record_company_certified_scopes_v1(text,text,integer,uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_record_company_certified_scopes_v1(text,text,integer,uuid) TO service_role;
