-- Prospective, source-bound retention class: archived requested-change bytes.
-- No lawful period, issuer, grant, historical completeness or general PII purge
-- is inferred. Other original/journal/contract classes retain their own owners.
BEGIN;
DO $$BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner') THEN CREATE ROLE gridex_ediel_retention_owner NOLOGIN NOINHERIT BYPASSRLS;END IF;END$$;
CREATE SCHEMA gridex_ediel_retention AUTHORIZATION gridex_ediel_retention_owner;
REVOKE ALL ON SCHEMA gridex_ediel_retention FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.permissions(key,name,category,description,is_active)
 SELECT key,name,'ediel','Company-scoped source-bound retention workflow; no default role assignment.',true FROM(VALUES
 ('ediel.retention.submit','Submit own retention evidence'),('ediel.retention.review','Review own retention evidence'),('ediel.retention.purge','Enforce approved own artifact byte retention')) p(key,name)
 WHERE NOT EXISTS(SELECT FROM public.permissions existing WHERE existing.key=p.key);
CREATE TABLE gridex_ediel_retention.issuers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 legal_reference text NOT NULL CHECK(length(legal_reference)>0),legal_evidence bytea NOT NULL CHECK(octet_length(legal_evidence)>0),legal_hash text NOT NULL CHECK(legal_hash=encode(sha256(legal_evidence),'hex')),
 signing_key bytea NOT NULL CHECK(octet_length(signing_key)>=32),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(isfinite(valid_from) AND isfinite(valid_to) AND valid_to>valid_from));
CREATE TABLE gridex_ediel_retention.issuer_revocations(issuer_id uuid PRIMARY KEY REFERENCES gridex_ediel_retention.issuers(id),reference text NOT NULL CHECK(length(reference)>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ediel_retention.decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),artifact_id uuid NOT NULL REFERENCES gridex_requested_changes.artifacts(id),
 source_hash text NOT NULL,claims_hash text NOT NULL,document_bytes bytea NOT NULL CHECK(octet_length(document_bytes) BETWEEN 1 AND 1048576),document_hash text NOT NULL CHECK(document_hash=encode(sha256(document_bytes),'hex')),
 issuer_receipt jsonb,submitted_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,artifact_id,document_hash));
CREATE TABLE gridex_ediel_retention.reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),decision_id uuid NOT NULL REFERENCES gridex_ediel_retention.decisions(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 outcome text NOT NULL CHECK(outcome IN('approved','held','rejected')),reason text NOT NULL CHECK(length(reason)>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ediel_retention.revocations(decision_id uuid PRIMARY KEY REFERENCES gridex_ediel_retention.decisions(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),reason text NOT NULL CHECK(length(reason)>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ediel_retention.purges(
 artifact_id uuid PRIMARY KEY REFERENCES gridex_requested_changes.artifacts(id),company_id uuid NOT NULL,decision_id uuid NOT NULL REFERENCES gridex_ediel_retention.decisions(id),review_id uuid NOT NULL REFERENCES gridex_ediel_retention.reviews(id),
 source_hash text NOT NULL,claims_hash text NOT NULL,byte_length bigint NOT NULL CHECK(byte_length>0),actor_user_id uuid NOT NULL REFERENCES auth.users(id),event_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE t text;BEGIN FOR t IN SELECT unnest(ARRAY['issuers','issuer_revocations','decisions','reviews','revocations','purges']) LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_retention.%I OWNER TO gridex_ediel_retention_owner',t);
 EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_ediel_retention.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_ediel_retention.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_ediel_retention.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t||'_immutable',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_ediel_retention.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t||'_no_truncate',t);
 END LOOP;END$$;
CREATE FUNCTION gridex_ediel_retention.permission_v1(c uuid,actor uuid,wanted text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT gridex_requested_changes.scoped_permission_v1(c,actor,wanted) IS TRUE
 AND NOT EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key
 WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)
 AND NOT EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted)
 AND public.gridex_actor_has_company_permission(actor,c,wanted) IS TRUE
$$;
CREATE FUNCTION gridex_ediel_retention.actor_v1(c uuid,actor uuid,permission text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 -- Hold the actual authorization registry, including insertion of new deny
 -- overrides, throughout this operation; a preceding server/UI check is not it.
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 PERFORM id FROM auth.users WHERE id=actor FOR SHARE;PERFORM id FROM public.companies WHERE id=c FOR SHARE;PERFORM id FROM public.user_profiles WHERE id=actor FOR SHARE;
 PERFORM user_id FROM public.company_memberships WHERE company_id=c AND user_id=actor FOR SHARE;
 IF auth.uid() IS DISTINCT FROM actor OR permission NOT IN('ediel.retention.submit','ediel.retention.review','ediel.retention.purge')
 OR NOT EXISTS(SELECT FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR gridex_ediel_retention.permission_v1(c,actor,permission) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_retention_current_actor_forbidden' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION gridex_ediel_retention.revocation_lock_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF TG_TABLE_NAME='issuer_revocations' THEN PERFORM id FROM gridex_ediel_retention.issuers WHERE id=NEW.issuer_id FOR UPDATE;
 ELSE PERFORM id FROM gridex_ediel_retention.decisions WHERE id=NEW.decision_id FOR UPDATE;END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_retention_revocation_target_required';END IF;RETURN NEW;END$$;
CREATE TRIGGER retention_issuer_revocation_lock BEFORE INSERT ON gridex_ediel_retention.issuer_revocations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.revocation_lock_v1();
CREATE TRIGGER retention_decision_revocation_lock BEFORE INSERT ON gridex_ediel_retention.revocations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.revocation_lock_v1();
CREATE FUNCTION gridex_ediel_retention.receipt_v1(d gridex_ediel_retention.decisions) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k gridex_ediel_retention.issuers%rowtype;p jsonb;bytes bytea;issued timestamptz;expires timestamptz;deadline timestamptz;
BEGIN
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO k FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 IF k.id IS NULL OR now()<k.valid_from OR now()>=k.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=k.id) OR EXISTS(SELECT FROM gridex_ediel_retention.revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 bytes:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,k.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 p:=convert_from(bytes,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;deadline:=(p->>'retainUntil')::timestamptz;
 IF p->>'format' IS DISTINCT FROM 'ediel_retention_policy_v1' OR p->>'retentionClass' IS DISTINCT FROM 'requested_change_source_artifact_bytes'
 OR p->>'companyId' IS DISTINCT FROM d.company_id::text OR p->>'artifactId' IS DISTINCT FROM d.artifact_id::text OR p->>'sourceHash' IS DISTINCT FROM d.source_hash OR p->>'claimsHash' IS DISTINCT FROM d.claims_hash
 OR p->>'documentHash' IS DISTINCT FROM d.document_hash OR p->>'issuerLegalReference' IS DISTINCT FROM k.legal_reference OR nullif(p->>'legalBasisReference','') IS NULL
 OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR issued>now() OR expires<=now() OR issued<k.valid_from OR expires>k.valid_to THEN RETURN NULL;END IF;
 RETURN p;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;
END$$;
CREATE FUNCTION public.ediel_submit_artifact_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_document_base64 text,p_issuer_receipt jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_requested_changes.artifacts%rowtype;bytes bytea;hash text;d gridex_ediel_retention.decisions%rowtype;
BEGIN PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.submit');
 SELECT * INTO STRICT a FROM gridex_requested_changes.artifacts WHERE id=p_artifact_id AND company_id=p_company_id FOR SHARE;
 IF a.source_bytes IS NULL OR encode(sha256(a.source_bytes),'hex') IS DISTINCT FROM a.source_hash THEN RAISE EXCEPTION 'ediel_retention_actual_archived_bytes_required';END IF;
 IF length(p_document_base64)>1398104 THEN RAISE EXCEPTION 'ediel_retention_document_limit';END IF;bytes:=decode(p_document_base64,'base64');hash:=encode(sha256(bytes),'hex');
 IF octet_length(bytes) NOT BETWEEN 1 AND 1048576 THEN RAISE EXCEPTION 'ediel_retention_document_required';END IF;
 INSERT INTO gridex_ediel_retention.decisions(company_id,artifact_id,source_hash,claims_hash,document_bytes,document_hash,issuer_receipt,submitted_by)
 VALUES(p_company_id,a.id,a.source_hash,a.claims_hash,bytes,hash,p_issuer_receipt,p_actor_user_id) ON CONFLICT(company_id,artifact_id,document_hash) DO NOTHING;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.decisions WHERE company_id=p_company_id AND artifact_id=a.id AND document_hash=hash FOR SHARE;
 IF d.issuer_receipt IS DISTINCT FROM p_issuer_receipt THEN RAISE EXCEPTION 'ediel_retention_original_receipt_conflict';END IF;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'ediel_retention_decision',d.id,'ediel.retention.submitted',jsonb_build_object('artifactId',a.id,'sourceHash',a.source_hash,'documentHash',hash));
 RETURN jsonb_build_object('status','submitted','decisionId',d.id,'documentHash',hash,'sourceHash',a.source_hash,'issuerQualified',gridex_ediel_retention.receipt_v1(d) IS NOT NULL);
END$$;
CREATE FUNCTION public.ediel_review_artifact_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid,p_outcome text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.decisions%rowtype;r uuid;outcome text;claims jsonb;
BEGIN PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.review');
 SELECT * INTO STRICT d FROM gridex_ediel_retention.decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 IF p_outcome NOT IN('approve','hold','reject') OR nullif(p_reason,'') IS NULL OR length(p_reason)>4000 THEN RAISE EXCEPTION 'ediel_retention_review_shape_required';END IF;
 IF p_outcome='approve' AND d.submitted_by=p_actor_user_id THEN RAISE EXCEPTION 'ediel_retention_separate_reviewer_required';END IF;
 claims:=gridex_ediel_retention.receipt_v1(d);outcome:=CASE WHEN p_outcome='reject' THEN 'rejected' WHEN p_outcome='approve' AND claims IS NOT NULL THEN 'approved' ELSE 'held' END;
 INSERT INTO gridex_ediel_retention.reviews(decision_id,actor_user_id,outcome,reason) VALUES(d.id,p_actor_user_id,outcome,p_reason) RETURNING id INTO r;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'ediel_retention_decision',d.id,'ediel.retention.reviewed',jsonb_build_object('reviewId',r,'outcome',outcome));
 RETURN jsonb_build_object('status',outcome,'decisionId',d.id,'reviewId',r);
END$$;
CREATE FUNCTION public.ediel_revoke_artifact_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.review');
 PERFORM id FROM gridex_ediel_retention.decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;IF NOT FOUND OR nullif(p_reason,'') IS NULL THEN RAISE EXCEPTION 'ediel_retention_revoke_scope_required';END IF;
 INSERT INTO gridex_ediel_retention.revocations(decision_id,actor_user_id,reason) VALUES(p_decision_id,p_actor_user_id,p_reason) ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'ediel_retention_decision',p_decision_id,'ediel.retention.revoked',jsonb_build_object('reason',p_reason));
END$$;
ALTER TABLE gridex_requested_changes.artifacts ADD COLUMN source_byte_length bigint;
ALTER TABLE gridex_requested_changes.artifacts ADD COLUMN purged_at timestamptz;
ALTER TABLE gridex_requested_changes.artifacts ALTER COLUMN source_bytes DROP NOT NULL;
CREATE FUNCTION gridex_ediel_retention.artifact_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF TG_OP<>'UPDATE' OR old.source_bytes IS NULL OR new.source_bytes IS NOT NULL OR new.purged_at IS NULL
 OR (to_jsonb(new)-ARRAY['source_bytes','purged_at']) IS DISTINCT FROM (to_jsonb(old)-ARRAY['source_bytes','purged_at'])
 OR NOT EXISTS(SELECT FROM gridex_ediel_retention.purges p WHERE p.artifact_id=old.id AND p.company_id=old.company_id AND p.source_hash=old.source_hash AND p.claims_hash=old.claims_hash AND p.byte_length=octet_length(old.source_bytes) AND p.created_at=new.purged_at)
 THEN RAISE EXCEPTION 'ediel_artifact_immutable_without_qualified_purge';END IF;RETURN new;
END$$;
DROP TRIGGER artifacts_immutable ON gridex_requested_changes.artifacts;
-- DDL holds ACCESS EXCLUSIVE until COMMIT; capture existing byte lengths before
-- installing the ordinary immutable guard. No historical source is rewritten.
UPDATE gridex_requested_changes.artifacts SET source_byte_length=octet_length(source_bytes);
CREATE TRIGGER artifacts_immutable BEFORE UPDATE OR DELETE ON gridex_requested_changes.artifacts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.artifact_guard_v1();
CREATE FUNCTION public.ediel_purge_artifact_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.decisions%rowtype;r gridex_ediel_retention.reviews%rowtype;a gridex_requested_changes.artifacts%rowtype;p gridex_ediel_retention.purges%rowtype;claims jsonb;o gridex_requested_changes.review_origins%rowtype;at timestamptz:=clock_timestamp();
BEGIN PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 SELECT * INTO STRICT d FROM gridex_ediel_retention.decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO STRICT a FROM gridex_requested_changes.artifacts WHERE id=d.artifact_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO p FROM gridex_ediel_retention.purges WHERE artifact_id=a.id;
 IF FOUND THEN IF p.decision_id IS DISTINCT FROM d.id THEN RAISE EXCEPTION 'ediel_retention_purge_decision_conflict';END IF;RETURN jsonb_build_object('status','purged','artifactId',a.id,'sourceHash',p.source_hash,'byteLength',p.byte_length,'purgedAt',p.created_at,'replay',true);END IF;
 SELECT * INTO r FROM gridex_ediel_retention.reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 PERFORM id FROM auth.users WHERE id=r.actor_user_id FOR SHARE;PERFORM id FROM public.user_profiles WHERE id=r.actor_user_id FOR SHARE;
 PERFORM user_id FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=r.actor_user_id AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=r.actor_user_id AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_retention_reviewer_authority']);END IF;
 claims:=gridex_ediel_retention.receipt_v1(d);
 IF r.outcome IS DISTINCT FROM 'approved' OR claims IS NULL OR (claims->>'retainUntil')::timestamptz>now() THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_approved_legal_retention_deadline']);END IF;
 IF a.source_hash IS DISTINCT FROM d.source_hash OR a.claims_hash IS DISTINCT FROM d.claims_hash OR a.source_bytes IS NULL OR encode(sha256(a.source_bytes),'hex') IS DISTINCT FROM d.source_hash THEN RAISE EXCEPTION 'ediel_retention_target_original_changed';END IF;
 SELECT * INTO o FROM gridex_requested_changes.review_origins WHERE artifact_id=a.id AND company_id=p_company_id FOR SHARE;
 IF o.event_id IS NOT NULL THEN
  PERFORM id FROM gridex_requested_changes.events WHERE id=o.event_id AND company_id=p_company_id FOR UPDATE;
  INSERT INTO gridex_requested_changes.revocations(event_id,source_reference,source_sha256,actor_user_id) VALUES(o.event_id,claims->>'legalBasisReference',d.document_hash,p_actor_user_id) ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO gridex_ediel_retention.purges(artifact_id,company_id,decision_id,review_id,source_hash,claims_hash,byte_length,actor_user_id,event_id,created_at) VALUES(a.id,a.company_id,d.id,r.id,a.source_hash,a.claims_hash,octet_length(a.source_bytes),p_actor_user_id,o.event_id,at);
 UPDATE gridex_requested_changes.artifacts SET source_bytes=NULL,purged_at=at WHERE id=a.id AND company_id=p_company_id;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'ediel_source_artifact',a.id,'ediel.retention.bytes_purged',jsonb_build_object('decisionId',d.id,'reviewId',r.id,'sourceHash',a.source_hash,'claimsHash',a.claims_hash,'byteLength',octet_length(a.source_bytes),'purgedAt',at,'operationalEventRevoked',o.event_id));
 RETURN jsonb_build_object('status','purged','artifactId',a.id,'sourceHash',a.source_hash,'byteLength',octet_length(a.source_bytes),'purgedAt',at,'replay',false);
END$$;
-- Existing newly archived artifacts need their length fixed at the custody
-- boundary; this changes no existing immutable source identity or authority.
CREATE FUNCTION gridex_ediel_retention.artifact_insert_length_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF new.source_bytes IS NULL OR new.purged_at IS NOT NULL THEN RAISE EXCEPTION 'ediel_retention_new_source_bytes_required';END IF;
 new.source_byte_length:=octet_length(new.source_bytes);RETURN new;
END$$;
CREATE TRIGGER artifact_insert_length BEFORE INSERT ON gridex_requested_changes.artifacts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.artifact_insert_length_v1();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_retention FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA auth,gridex_requested_changes,gridex_received_sources TO gridex_ediel_retention_owner;
GRANT EXECUTE ON FUNCTION auth.uid(),gridex_requested_changes.receipt_hmac_sha256_v1(bytea,bytea),gridex_requested_changes.scoped_permission_v1(uuid,uuid,text),public.gridex_actor_has_company_permission(uuid,uuid,text) TO gridex_ediel_retention_owner;
GRANT SELECT,UPDATE ON auth.users TO gridex_ediel_retention_owner;
GRANT SELECT,UPDATE ON public.companies,public.user_profiles,public.company_memberships,public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides TO gridex_ediel_retention_owner;
GRANT SELECT,UPDATE ON gridex_requested_changes.artifacts,gridex_requested_changes.events TO gridex_ediel_retention_owner;
GRANT SELECT,UPDATE ON gridex_requested_changes.review_origins TO gridex_ediel_retention_owner;
GRANT SELECT,INSERT ON gridex_requested_changes.revocations TO gridex_ediel_retention_owner;
GRANT INSERT ON public.audit_logs TO gridex_ediel_retention_owner;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' OR n.nspname='public' AND p.proname IN('ediel_submit_artifact_retention_v1','ediel_review_artifact_retention_v1','ediel_revoke_artifact_retention_v1','ediel_purge_artifact_retention_v1') LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO gridex_ediel_retention_owner',f.identity);END LOOP;END$$;
REVOKE ALL ON FUNCTION public.ediel_submit_artifact_retention_v1(uuid,uuid,uuid,text,jsonb),public.ediel_review_artifact_retention_v1(uuid,uuid,uuid,text,text),public.ediel_revoke_artifact_retention_v1(uuid,uuid,uuid,text),public.ediel_purge_artifact_retention_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_submit_artifact_retention_v1(uuid,uuid,uuid,text,jsonb),public.ediel_review_artifact_retention_v1(uuid,uuid,uuid,text,text),public.ediel_revoke_artifact_retention_v1(uuid,uuid,uuid,text),public.ediel_purge_artifact_retention_v1(uuid,uuid,uuid) TO authenticated;
COMMIT;
