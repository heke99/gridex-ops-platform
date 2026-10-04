-- CLI-created prospective TR09 owner. No publisher membership, incident,
-- approval, certificate, CRL, TLS receipt or production activation is seeded.
BEGIN;
CREATE ROLE gridex_ediel_transport_exception_owner NOLOGIN;
CREATE SCHEMA gridex_transport_exception;
REVOKE ALL ON SCHEMA gridex_transport_exception FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gridex_transport_exception TO service_role,gridex_ediel_transport_exception_owner;
CREATE TABLE gridex_transport_exception.approvals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 message_id uuid NOT NULL REFERENCES public.ediel_messages(id),environment text NOT NULL CHECK(environment IN('test','production')),
 source_original bytea NOT NULL CHECK(octet_length(source_original) BETWEEN 1 AND 1048576),
 approval_original bytea NOT NULL CHECK(octet_length(approval_original) BETWEEN 1 AND 1048576),
 source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),approval_digest text NOT NULL CHECK(approval_digest~'^[a-f0-9]{64}$'),
 source_facts jsonb NOT NULL,approval_facts jsonb NOT NULL,approved_by uuid NOT NULL REFERENCES auth.users(id),
 kind text NOT NULL CHECK(kind IN('temporary_encryption_failure','recipient_certificate_unavailable','crl_refresh_failure')),
 valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from),
 maximum_attempts integer NOT NULL CHECK(maximum_attempts BETWEEN 1 AND 3),published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,message_id,source_digest,approval_digest));
CREATE TABLE gridex_transport_exception.revocations(
 approval_id uuid PRIMARY KEY REFERENCES gridex_transport_exception.approvals(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),original bytea NOT NULL CHECK(octet_length(original) BETWEEN 1 AND 1048576),
 original_digest text NOT NULL CHECK(original_digest~'^[a-f0-9]{64}$'),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_transport_exception.operations(
 attempt_id uuid PRIMARY KEY,approval_id uuid NOT NULL REFERENCES gridex_transport_exception.approvals(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),message_id uuid NOT NULL REFERENCES public.ediel_messages(id),
 environment text NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),binding jsonb NOT NULL,
 prepared_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_transport_exception.events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL REFERENCES gridex_transport_exception.operations(attempt_id),
 company_id uuid NOT NULL,message_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('prepared','entered','observed','released')),
 facts jsonb NOT NULL,captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(attempt_id,kind));
CREATE TABLE gridex_transport_exception.alarms(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL UNIQUE REFERENCES gridex_transport_exception.operations(attempt_id),
 company_id uuid NOT NULL,message_id uuid NOT NULL,responsible_user_id uuid NOT NULL REFERENCES auth.users(id),
 facts jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION gridex_transport_exception.immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'transport_exception_journal_immutable';END$$;
DO $tables$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['approvals','revocations','operations','events','alarms'] LOOP
  EXECUTE format('ALTER TABLE gridex_transport_exception.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE gridex_transport_exception.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON gridex_transport_exception.%I FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_transport_exception_owner',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_transport_exception.%I FOR EACH ROW EXECUTE FUNCTION gridex_transport_exception.immutable_v1()',t);
 END LOOP;
END $tables$;
CREATE FUNCTION gridex_transport_exception.hash_v1(v text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT coalesce(v~'^[a-f0-9]{64}$',false)$$;
CREATE FUNCTION gridex_transport_exception.actor_v1(c uuid,a uuid,p text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 LOCK TABLE auth.users,public.user_profiles,public.company_memberships,public.user_permissions,public.role_permissions,public.user_roles,public.roles,public.permissions IN SHARE MODE;
 LOCK TABLE public.companies IN SHARE MODE;
 IF a IS NULL OR c IS NULL OR NOT EXISTS(SELECT FROM auth.users WHERE id=a)
  OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=a AND user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships WHERE user_id=a AND company_id=c AND status='active' AND is_active AND accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(a,c,p) IS NOT TRUE THEN RAISE EXCEPTION 'transport_exception_current_actor_required' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION gridex_transport_exception.scope_v1(m public.ediel_messages,s jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ediel_route_profiles%rowtype;tls jsonb:=s->'tls';counterparty jsonb:=s->'counterparty';
BEGIN
 LOCK TABLE public.tenant_actor_identifiers,public.tenant_actor_roles,public.platform_actor_identifiers,public.platform_actor_roles,public.communication_routes,public.ediel_route_profiles,gridex_certificate_trust.authority_versions IN SHARE MODE;
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR s->>'schema' IS DISTINCT FROM 'gridex_transport_exception_incident_v1'
  OR s->>'normativeSha256' IS DISTINCT FROM '5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951'
  OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT'
  OR m.raw_payload IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR s->>'companyId' IS DISTINCT FROM m.company_id::text OR s->>'messageId' IS DISTINCT FROM m.id::text
  OR s->>'environment' IS DISTINCT FROM m.environment OR s->>'originalHash' IS DISTINCT FROM m.immutable_payload_hash
  OR s->>'routeId' IS DISTINCT FROM m.communication_route_id::text OR s->>'senderEdielId' IS DISTINCT FROM m.sender_ediel_id
  OR s->>'receiverEdielId' IS DISTINCT FROM m.receiver_ediel_id OR s->>'receiverEmail' IS DISTINCT FROM m.receiver_email
  THEN RAISE EXCEPTION 'transport_exception_current_immutable_scope_required';END IF;
 PERFORM gridex_ediel_outbound_owner.require_v1(m.company_id,m.id);
 SELECT * INTO r FROM public.ediel_route_profiles WHERE id=m.route_profile_id AND company_id=m.company_id
  AND communication_route_id=m.communication_route_id AND environment=m.environment FOR SHARE;
 PERFORM id FROM public.communication_routes WHERE id=m.communication_route_id AND company_id=m.company_id AND is_active FOR SHARE;
 IF NOT FOUND OR r.id IS NULL OR r.is_enabled IS NOT TRUE OR r.is_active IS NOT TRUE OR r.tls_required IS NOT TRUE
  OR r.sender_ediel_id IS DISTINCT FROM m.sender_ediel_id OR r.receiver_ediel_id IS DISTINCT FROM m.receiver_ediel_id
  OR coalesce(nullif(r.smtp_to,''),nullif(r.receiver_email,'')) IS DISTINCT FROM m.receiver_email
  OR (r.valid_from IS NOT NULL AND r.valid_from>clock_timestamp()) OR (r.valid_to IS NOT NULL AND r.valid_to<=clock_timestamp())
  THEN RAISE EXCEPTION 'transport_exception_current_owned_tls_route_required';END IF;
 IF (SELECT count(*) FROM public.tenant_actor_identifiers x WHERE x.company_id=m.company_id AND x.environment=m.environment
  AND x.identifier_type='EdielId' AND x.identifier_value=m.sender_ediel_id AND x.valid_from<=clock_timestamp() AND (x.valid_to IS NULL OR x.valid_to>clock_timestamp()))<>1
  OR NOT EXISTS(SELECT FROM public.tenant_actor_roles x WHERE x.company_id=m.company_id AND x.environment=m.environment AND x.role_code='electricity_supplier'
   AND x.valid_from<=clock_timestamp() AND (x.valid_to IS NULL OR x.valid_to>clock_timestamp())
   AND EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.company_id=x.company_id AND i.environment=x.environment AND i.actor_id=x.actor_id
    AND i.identifier_type='EdielId' AND i.identifier_value=m.sender_ediel_id AND i.valid_from<=clock_timestamp() AND (i.valid_to IS NULL OR i.valid_to>clock_timestamp())))
  OR NOT EXISTS(SELECT FROM public.platform_actor_identifiers x JOIN public.platform_actor_roles a ON a.actor_id=x.actor_id
   WHERE x.identifier_type='EdielId' AND x.identifier_value=m.receiver_ediel_id AND x.is_verified
    AND (x.valid_from IS NULL OR x.valid_from<=clock_timestamp()) AND (x.valid_to IS NULL OR x.valid_to>clock_timestamp())
    AND a.actor_role='grid_owner' AND a.is_active)
  THEN RAISE EXCEPTION 'transport_exception_current_legal_namespace_required';END IF;
 IF jsonb_typeof(tls) IS DISTINCT FROM 'object' OR tls->>'required' IS DISTINCT FROM 'true'
  OR tls->>'allRelayHopsVerified' IS DISTINCT FROM 'true' OR tls->>'certificateVerified' IS DISTINCT FROM 'true'
  OR coalesce(tls->>'minimumVersion','') NOT IN('TLS1.2','TLS1.3')
  OR gridex_transport_exception.hash_v1(tls->>'originalSha256') IS NOT TRUE
  OR nullif(tls->>'originalReference','') IS NULL OR (tls->>'validFrom')::timestamptz IS NULL OR (tls->>'validTo')::timestamptz IS NULL
  OR (tls->>'validFrom')::timestamptz>clock_timestamp() OR (tls->>'validTo')::timestamptz<=clock_timestamp()
  OR jsonb_typeof(counterparty) IS DISTINCT FROM 'object' OR counterparty->>'receiverEdielId' IS DISTINCT FROM m.receiver_ediel_id
  OR counterparty->>'temporaryReserveConfirmed' IS DISTINCT FROM 'true'
  OR gridex_transport_exception.hash_v1(counterparty->>'originalSha256') IS NOT TRUE OR nullif(counterparty->>'originalReference','') IS NULL
  OR (counterparty->>'validFrom')::timestamptz IS NULL OR (counterparty->>'validTo')::timestamptz IS NULL
  OR (counterparty->>'validFrom')::timestamptz>clock_timestamp() OR (counterparty->>'validTo')::timestamptz<=clock_timestamp()
  THEN RAISE EXCEPTION 'transport_exception_current_end_to_end_tls_and_counterparty_originals_required';END IF;
END$$;
CREATE FUNCTION gridex_transport_exception.case_v1(m public.ediel_messages,s jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k text:=s->>'case';a gridex_certificate_trust.authority_versions%rowtype;prior jsonb:='[]';cdps jsonb;crls jsonb;
BEGIN
 IF k='temporary_encryption_failure' THEN
  IF s#>>'{incident,temporaryOnly}' IS DISTINCT FROM 'true' OR coalesce(s#>>'{incident,failureCode}','') NOT IN('encryption_runtime_unavailable','cms_encryption_failed')
   OR gridex_transport_exception.hash_v1(s#>>'{incident,originalSha256}') IS NOT TRUE THEN RAISE EXCEPTION 'transport_exception_actual_temporary_encryption_failure_required';END IF;
 ELSIF k='recipient_certificate_unavailable' THEN
  IF s#>>'{incident,directorySearchCompleted}' IS DISTINCT FROM 'true' OR s#>>'{incident,resultCount}' IS DISTINCT FROM '0'
   OR gridex_transport_exception.hash_v1(s#>>'{incident,originalSha256}') IS NOT TRUE
   OR EXISTS(SELECT FROM gridex_certificate_trust.authority_versions WHERE company_id=m.company_id AND environment=m.environment
    AND receiver_ediel_id=m.receiver_ediel_id AND valid_from<=clock_timestamp() AND valid_to>clock_timestamp())
   THEN RAISE EXCEPTION 'transport_exception_completed_no_certificate_search_required';END IF;
 ELSIF k='crl_refresh_failure' THEN
  cdps:=s#>'{incident,cdpResults}';crls:=s#>'{incident,priorCrlSha256}';
  IF s#>>'{incident,allCertificateCdpsAttempted}' IS DISTINCT FROM 'true' OR s#>>'{incident,nearestPreviousCachedCrl}' IS DISTINCT FROM 'true'
   OR jsonb_typeof(cdps) IS DISTINCT FROM 'array' OR jsonb_typeof(crls) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'transport_exception_all_cdp_failure_and_nearest_previous_crl_required';END IF;
  IF jsonb_array_length(cdps) NOT BETWEEN 1 AND 16 OR jsonb_array_length(crls) NOT BETWEEN 1 AND 16
   OR EXISTS(SELECT FROM jsonb_array_elements(cdps) c WHERE c->>'result' IS DISTINCT FROM 'failed' OR nullif(c->>'cdp','') IS NULL OR gridex_transport_exception.hash_v1(c->>'originalSha256') IS NOT TRUE)
   OR (SELECT count(DISTINCT c->>'cdp') FROM jsonb_array_elements(cdps) c)<>jsonb_array_length(cdps)
   THEN RAISE EXCEPTION 'transport_exception_actual_all_cdp_failure_required';END IF;
  SELECT * INTO a FROM gridex_certificate_trust.authority_versions WHERE id=(s#>>'{incident,certificateAuthorityId}')::uuid
   AND company_id=m.company_id AND environment=m.environment AND receiver_ediel_id=m.receiver_ediel_id
   AND valid_from<=clock_timestamp() AND valid_to>clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transport_exception_actual_previous_crl_owner_required';END IF;
  SELECT jsonb_agg(encode(sha256(convert_to(c#>>'{}','UTF8')),'hex') ORDER BY n) INTO prior FROM jsonb_array_elements(a.crls) WITH ORDINALITY x(c,n);
  IF prior IS DISTINCT FROM crls THEN RAISE EXCEPTION 'transport_exception_previous_crl_original_changed';END IF;
 ELSE RAISE EXCEPTION 'transport_exception_exact_source_case_required';END IF;
 RETURN prior;
END$$;
CREATE FUNCTION gridex_transport_exception.publish_v1(c uuid,mid uuid,actor uuid,source bytea,approval bytea,publisher text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb;a jsonb;m public.ediel_messages%rowtype;reviewer uuid;vf timestamptz;vt timestamptz;result uuid;sd text;ad text;
BEGIN
 IF publisher IS DISTINCT FROM 'gridex_ediel_transport_exception_owner' OR source IS NULL OR approval IS NULL
  OR octet_length(source) NOT BETWEEN 1 AND 1048576 OR octet_length(approval) NOT BETWEEN 1 AND 1048576 THEN RAISE EXCEPTION 'transport_exception_qualified_source_owner_required' USING ERRCODE='42501';END IF;
 s:=convert_from(source,'UTF8')::jsonb;a:=convert_from(approval,'UTF8')::jsonb;sd:=encode(sha256(source),'hex');ad:=encode(sha256(approval),'hex');
 PERFORM gridex_transport_exception.actor_v1(c,actor,'communication.write');
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR SHARE;
 PERFORM gridex_transport_exception.scope_v1(m,s);PERFORM gridex_transport_exception.case_v1(m,s);
 reviewer:=(a->>'approvedBy')::uuid;PERFORM gridex_transport_exception.actor_v1(c,reviewer,'communication.write');
 vf:=(a->>'validFrom')::timestamptz;vt:=(a->>'validTo')::timestamptz;
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR a->>'schema' IS DISTINCT FROM 'gridex_transport_exception_approval_v1'
  OR a->>'sourceDigest' IS DISTINCT FROM sd OR a->>'companyId' IS DISTINCT FROM c::text OR a->>'messageId' IS DISTINCT FROM mid::text
  OR a->>'case' IS DISTINCT FROM s->>'case' OR a->>'approved' IS DISTINCT FROM 'true' OR nullif(a->>'approvalReference','') IS NULL
  OR vf IS NULL OR vt IS NULL OR vf>clock_timestamp() OR vt<=clock_timestamp() OR vt>vf+interval '24 hours'
  OR vt>(s#>>'{tls,validTo}')::timestamptz OR vt>(s#>>'{counterparty,validTo}')::timestamptz
  OR (s#>>'{incident,observedAt}')::timestamptz IS NULL OR (s#>>'{incident,observedAt}')::timestamptz>clock_timestamp()
  OR (s#>>'{incident,observedAt}')::timestamptz<clock_timestamp()-interval '24 hours'
  OR coalesce(a->>'maximumAttempts','') !~ '^[1-3]$' THEN RAISE EXCEPTION 'transport_exception_exact_current_bounded_approval_required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c::text||'|'||mid::text||'|transport_exception',0));
 INSERT INTO gridex_transport_exception.approvals(company_id,message_id,environment,source_original,approval_original,source_digest,approval_digest,source_facts,approval_facts,approved_by,kind,valid_from,valid_to,maximum_attempts)
 VALUES(c,mid,m.environment,source,approval,sd,ad,s,a,reviewer,s->>'case',vf,vt,(a->>'maximumAttempts')::integer)
 ON CONFLICT(company_id,message_id,source_digest,approval_digest) DO NOTHING RETURNING id INTO result;
 IF result IS NULL THEN SELECT id INTO STRICT result FROM gridex_transport_exception.approvals WHERE company_id=c AND message_id=mid AND source_digest=sd AND approval_digest=ad;END IF;
 RETURN result;
END$$;
CREATE FUNCTION public.ediel_publish_transport_exception_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid,p_source_original bytea,p_approval_original bytea) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN IF current_user<>'gridex_ediel_transport_exception_owner' THEN RAISE EXCEPTION 'transport_exception_qualified_source_owner_required' USING ERRCODE='42501';END IF;
 RETURN gridex_transport_exception.publish_v1(p_company_id,p_message_id,p_actor_user_id,p_source_original,p_approval_original,current_user);END$$;
CREATE FUNCTION gridex_transport_exception.read_v1(c uuid,mid uuid,actor uuid,eid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_transport_exception.approvals%rowtype;m public.ediel_messages%rowtype;prior jsonb;
BEGIN
 PERFORM gridex_transport_exception.actor_v1(c,actor,'communication.send');
 LOCK TABLE gridex_transport_exception.revocations IN SHARE MODE;
 SELECT * INTO a FROM gridex_transport_exception.approvals WHERE id=eid AND company_id=c AND message_id=mid FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','held','missing',ARRAY['transport_exception_approved_source_absent']);END IF;
 IF a.valid_from>clock_timestamp() OR a.valid_to<=clock_timestamp() OR EXISTS(SELECT FROM gridex_transport_exception.revocations WHERE approval_id=a.id)
  THEN RETURN jsonb_build_object('status','held','missing',ARRAY['transport_exception_source_revoked_or_expired']);END IF;
 PERFORM gridex_transport_exception.actor_v1(c,a.approved_by,'communication.write');
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=mid AND company_id=c AND environment=a.environment FOR SHARE;
 IF a.source_digest IS DISTINCT FROM encode(sha256(a.source_original),'hex') OR a.approval_digest IS DISTINCT FROM encode(sha256(a.approval_original),'hex')
  OR a.source_facts IS DISTINCT FROM convert_from(a.source_original,'UTF8')::jsonb OR a.approval_facts IS DISTINCT FROM convert_from(a.approval_original,'UTF8')::jsonb
  THEN RAISE EXCEPTION 'transport_exception_original_integrity_required';END IF;
 PERFORM gridex_transport_exception.scope_v1(m,a.source_facts);prior:=gridex_transport_exception.case_v1(m,a.source_facts);
 RETURN jsonb_build_object('status','authorized','version',1,'approvalId',a.id,'companyId',c,'environment',a.environment,'messageId',mid,'actorUserId',actor,
  'originalHash',m.immutable_payload_hash,'routeId',m.communication_route_id,'senderEdielId',m.sender_ediel_id,'receiverEdielId',m.receiver_ediel_id,'receiverEmail',m.receiver_email,
  'case',a.kind,'sourceDigest',a.source_digest,'approvalDigest',a.approval_digest,'tlsEvidenceDigest',a.source_facts#>>'{tls,originalSha256}',
  'validFrom',a.valid_from,'validTo',a.valid_to,'priorCrlSha256',prior,
  'certificateAuthorityId',CASE WHEN a.kind='crl_refresh_failure' THEN a.source_facts#>>'{incident,certificateAuthorityId}' ELSE NULL END,
  'cdpLocations',CASE WHEN a.kind='crl_refresh_failure' THEN (SELECT jsonb_agg(x->>'cdp' ORDER BY x->>'cdp') FROM jsonb_array_elements(a.source_facts#>'{incident,cdpResults}') x) ELSE '[]'::jsonb END);
END$$;
CREATE FUNCTION public.ediel_read_transport_exception_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid,p_exception_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$SELECT gridex_transport_exception.read_v1(p_company_id,p_message_id,p_actor_user_id,p_exception_id)$$;
CREATE FUNCTION gridex_transport_exception.revoke_v1(eid uuid,actor uuid,original bytea,publisher text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_transport_exception.approvals%rowtype;f jsonb;
BEGIN IF publisher IS DISTINCT FROM 'gridex_ediel_transport_exception_owner' OR original IS NULL OR octet_length(original) NOT BETWEEN 1 AND 1048576 THEN RAISE EXCEPTION 'transport_exception_qualified_source_owner_required' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT a FROM gridex_transport_exception.approvals WHERE id=eid FOR SHARE;PERFORM gridex_transport_exception.actor_v1(a.company_id,actor,'communication.write');
 f:=convert_from(original,'UTF8')::jsonb;
 IF f->>'schema' IS DISTINCT FROM 'gridex_transport_exception_revocation_v1' OR f->>'approvalId' IS DISTINCT FROM eid::text OR f->>'companyId' IS DISTINCT FROM a.company_id::text OR nullif(f->>'reasonReference','') IS NULL THEN RAISE EXCEPTION 'transport_exception_actual_revocation_original_required';END IF;
 INSERT INTO gridex_transport_exception.revocations VALUES(eid,actor,original,encode(sha256(original),'hex'),clock_timestamp()) ON CONFLICT(approval_id) DO NOTHING;
END$$;
CREATE FUNCTION public.ediel_revoke_transport_exception_v1(p_exception_id uuid,p_actor_user_id uuid,p_original bytea) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN IF current_user<>'gridex_ediel_transport_exception_owner' THEN RAISE EXCEPTION 'transport_exception_qualified_source_owner_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_transport_exception.revoke_v1(p_exception_id,p_actor_user_id,p_original,current_user);END$$;
CREATE FUNCTION gridex_transport_exception.stage_v1(i jsonb,r jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text:=i->>'action';c uuid:=(i->>'companyId')::uuid;mid uuid:=(i->>'messageId')::uuid;actor uuid:=(i->>'actorUserId')::uuid;
 attempt uuid:=(i->>'attemptId')::uuid;b jsonb:=i#>'{binding,transportException}';a jsonb;o gridex_transport_exception.operations%rowtype;m public.ediel_messages%rowtype;limit_attempts integer;event_kind text;
BEGIN
 IF action='prepare' AND r->>'proceed'='true' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR SHARE;
  IF b IS NULL OR b='null'::jsonb THEN
   IF m.direction='outbound' AND m.message_standard='edifact' AND m.message_family='PRODAT' AND m.environment='production'
    AND i#>>'{binding,mimeMode}' IS DISTINCT FROM 'ediel-smime-enveloped' THEN RAISE EXCEPTION 'transport_exception_actual_approved_plaintext_source_required';END IF;
   RETURN;
  END IF;
  a:=gridex_transport_exception.read_v1(c,mid,actor,(b->>'approvalId')::uuid);
  IF a->>'status' IS DISTINCT FROM 'authorized' OR b IS DISTINCT FROM (a-ARRAY['status','version','companyId','environment','messageId','actorUserId','routeId','senderEdielId','receiverEdielId','receiverEmail','validFrom','validTo'])
   OR ((a->>'case'='crl_refresh_failure') IS DISTINCT FROM (i#>>'{binding,mimeMode}'='ediel-smime-enveloped'))
   THEN RAISE EXCEPTION 'transport_exception_fresh_exact_attempt_binding_required';END IF;
  SELECT * INTO o FROM gridex_transport_exception.operations WHERE attempt_id=attempt FOR SHARE;
  IF FOUND THEN
   IF o.company_id IS DISTINCT FROM c OR o.message_id IS DISTINCT FROM mid OR o.actor_user_id IS DISTINCT FROM actor OR o.environment IS DISTINCT FROM m.environment OR o.binding IS DISTINCT FROM b
    THEN RAISE EXCEPTION 'transport_exception_attempt_scope_changed';END IF;RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended((a->>'approvalId')||'|transport_exception_budget',0));
  SELECT maximum_attempts INTO STRICT limit_attempts FROM gridex_transport_exception.approvals WHERE id=(a->>'approvalId')::uuid FOR SHARE;
  IF (SELECT count(*) FROM gridex_transport_exception.operations WHERE approval_id=(a->>'approvalId')::uuid)>=limit_attempts THEN RAISE EXCEPTION 'transport_exception_bounded_attempt_budget_exhausted';END IF;
  INSERT INTO gridex_transport_exception.operations VALUES(attempt,(a->>'approvalId')::uuid,c,mid,m.environment,actor,b,clock_timestamp());
  INSERT INTO gridex_transport_exception.events(attempt_id,company_id,message_id,kind,facts) VALUES(attempt,c,mid,'prepared',r);
  INSERT INTO gridex_transport_exception.alarms(attempt_id,company_id,message_id,responsible_user_id,facts)
   SELECT attempt,c,mid,approved_by,jsonb_build_object('case',a->>'case','sourceDigest',a->>'sourceDigest','approvalDigest',a->>'approvalDigest','tlsEvidenceDigest',a->>'tlsEvidenceDigest','mandatoryTls',true,'validTo',a->>'validTo','administratorAlarm',true)
   FROM gridex_transport_exception.approvals WHERE id=(a->>'approvalId')::uuid;
 ELSIF action IN('enter','observe','result','release') THEN
  SELECT * INTO o FROM gridex_transport_exception.operations WHERE attempt_id=attempt FOR SHARE;IF NOT FOUND THEN RETURN;END IF;
  IF o.company_id IS DISTINCT FROM c OR o.message_id IS DISTINCT FROM mid OR o.actor_user_id IS DISTINCT FROM actor OR o.environment IS DISTINCT FROM i->>'environment' THEN RAISE EXCEPTION 'transport_exception_attempt_scope_changed';END IF;
  IF action='enter' AND r->>'proceed'='true' THEN
   a:=gridex_transport_exception.read_v1(c,mid,actor,o.approval_id);
   IF a->>'status' IS DISTINCT FROM 'authorized' OR o.binding IS DISTINCT FROM (a-ARRAY['status','version','companyId','environment','messageId','actorUserId','routeId','senderEdielId','receiverEdielId','receiverEmail','validFrom','validTo']) THEN RAISE EXCEPTION 'transport_exception_fresh_entry_authority_required';END IF;event_kind:='entered';
  ELSIF action IN('observe','result') AND EXISTS(SELECT FROM gridex_transport_exception.events WHERE attempt_id=attempt AND kind='entered') THEN event_kind:='observed';
  ELSIF action='release' THEN event_kind:='released';ELSE RETURN;END IF;
  INSERT INTO gridex_transport_exception.events(attempt_id,company_id,message_id,kind,facts) VALUES(attempt,c,mid,event_kind,r) ON CONFLICT(attempt_id,kind) DO NOTHING;
 END IF;
END$$;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_temporary_exception_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r jsonb;BEGIN r:=gridex_ediel_transport.mutate_before_temporary_exception_v1(i);PERFORM gridex_transport_exception.stage_v1(i,r);RETURN r;END$$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_temporary_exception_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r jsonb;BEGIN r:=gridex_outbound_dispatch.mutate_before_temporary_exception_v1(i);IF r->>'scoped'='true' THEN PERFORM gridex_transport_exception.stage_v1(i,r);END IF;RETURN r;END$$;
CREATE FUNCTION public.ediel_transport_exception_alarms_v1(p_company_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE alarms jsonb;BEGIN PERFORM gridex_transport_exception.actor_v1(p_company_id,p_actor_user_id,'communication.write');
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'attemptId',attempt_id,'messageId',message_id,'responsibleUserId',responsible_user_id,'facts',facts,'createdAt',created_at) ORDER BY created_at),'[]') INTO alarms
 FROM(SELECT * FROM gridex_transport_exception.alarms WHERE company_id=p_company_id ORDER BY created_at DESC LIMIT 100) a;RETURN alarms;END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_transport_exception FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_transport_exception_owner;
GRANT EXECUTE ON FUNCTION gridex_transport_exception.publish_v1(uuid,uuid,uuid,bytea,bytea,text),gridex_transport_exception.revoke_v1(uuid,uuid,bytea,text) TO gridex_ediel_transport_exception_owner;
GRANT EXECUTE ON FUNCTION gridex_transport_exception.read_v1(uuid,uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_publish_transport_exception_v1(uuid,uuid,uuid,bytea,bytea),public.ediel_revoke_transport_exception_v1(uuid,uuid,bytea),public.ediel_read_transport_exception_v1(uuid,uuid,uuid,uuid),public.ediel_transport_exception_alarms_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_transport_exception_owner;
GRANT EXECUTE ON FUNCTION public.ediel_publish_transport_exception_v1(uuid,uuid,uuid,bytea,bytea),public.ediel_revoke_transport_exception_v1(uuid,uuid,bytea) TO gridex_ediel_transport_exception_owner;
GRANT EXECUTE ON FUNCTION public.ediel_read_transport_exception_v1(uuid,uuid,uuid,uuid),public.ediel_transport_exception_alarms_v1(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_before_temporary_exception_v1(jsonb),gridex_outbound_dispatch.mutate_before_temporary_exception_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) TO service_role;
COMMIT;
