-- Created by Supabase CLI migration new ediel_versioned_certificate_trust_authority_v1.
-- Prospective external trust ownership only. No CA/CRL, owner membership,
-- legal decision, historical receipt or activation is seeded by this migration.
BEGIN;
CREATE ROLE gridex_ediel_certificate_authority_owner NOLOGIN;
CREATE SCHEMA gridex_certificate_trust;
REVOKE ALL ON SCHEMA gridex_certificate_trust FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gridex_certificate_trust TO service_role,gridex_ediel_certificate_authority_owner;
CREATE TABLE gridex_certificate_trust.authority_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN ('test','production')), receiver_ediel_id text NOT NULL CHECK(nullif(btrim(receiver_ediel_id),'') IS NOT NULL),
 register_version text NOT NULL CHECK(nullif(btrim(register_version),'') IS NOT NULL),
 original_reference text NOT NULL CHECK(nullif(btrim(original_reference),'') IS NOT NULL), original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 legal_authority_reference text NOT NULL CHECK(nullif(btrim(legal_authority_reference),'') IS NOT NULL),
 process_authority_reference text NOT NULL CHECK(nullif(btrim(process_authority_reference),'') IS NOT NULL),
 owner_register_reference text NOT NULL CHECK(nullif(btrim(owner_register_reference),'') IS NOT NULL),
 valid_from timestamptz NOT NULL, valid_to timestamptz NOT NULL CHECK(valid_to>valid_from),
 recipient_fingerprints jsonb NOT NULL CHECK(jsonb_typeof(recipient_fingerprints)='array' AND jsonb_array_length(recipient_fingerprints) BETWEEN 1 AND 16),
 anchors jsonb NOT NULL CHECK(jsonb_typeof(anchors)='array' AND jsonb_array_length(anchors) BETWEEN 1 AND 16),
 intermediates jsonb NOT NULL CHECK(jsonb_typeof(intermediates)='array' AND jsonb_array_length(intermediates)<=16),
 crls jsonb NOT NULL CHECK(jsonb_typeof(crls)='array' AND jsonb_array_length(crls) BETWEEN 1 AND 16),
 published_at timestamptz NOT NULL DEFAULT now(), publisher_role text NOT NULL,
 UNIQUE(company_id,environment,receiver_ediel_id,register_version)
);
ALTER TABLE gridex_certificate_trust.authority_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_certificate_trust.authority_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_certificate_trust.authority_versions FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_certificate_authority_owner;
CREATE FUNCTION gridex_certificate_trust.immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ediel_certificate_trust_authority_immutable'; END $$;
CREATE TRIGGER certificate_trust_authority_immutable BEFORE UPDATE OR DELETE ON gridex_certificate_trust.authority_versions FOR EACH ROW EXECUTE FUNCTION gridex_certificate_trust.immutable_v1();
REVOKE ALL ON FUNCTION gridex_certificate_trust.immutable_v1() FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_certificate_authority_owner;

CREATE FUNCTION gridex_certificate_trust.publish_v1(p_scope jsonb,p_original_register bytea,p_materials jsonb,p_publisher text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid; hash text; actor uuid:=(p_scope->>'actorUserId')::uuid; prior gridex_certificate_trust.authority_versions%rowtype;
BEGIN
 IF p_publisher IS DISTINCT FROM 'gridex_ediel_certificate_authority_owner' OR p_original_register IS NULL OR octet_length(p_original_register)=0 OR octet_length(p_original_register)>16777216
  OR octet_length(p_materials::text)>50331648 THEN RAISE EXCEPTION 'ediel_certificate_trust_qualified_external_owner_required'; END IF;
 IF p_materials IS NULL OR jsonb_typeof(p_materials->'anchors') IS DISTINCT FROM 'array' OR jsonb_typeof(p_materials->'intermediates') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_materials->'crls') IS DISTINCT FROM 'array' OR jsonb_typeof(p_materials->'recipientFingerprints') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'ediel_certificate_trust_public_originals_invalid'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_materials->'recipientFingerprints') material WHERE jsonb_typeof(material)<>'string' OR material#>>'{}' !~ '^[a-f0-9]{64}$')
 OR EXISTS(SELECT FROM jsonb_array_elements(p_materials->'anchors'||p_materials->'intermediates'||p_materials->'crls') material
  WHERE jsonb_typeof(material)<>'string' OR length(material#>>'{}') NOT BETWEEN 1 AND 1048576) THEN RAISE EXCEPTION 'ediel_certificate_trust_public_originals_invalid'; END IF;
 IF actor IS NULL OR NOT EXISTS(SELECT FROM public.company_memberships x WHERE x.company_id=(p_scope->>'companyId')::uuid AND x.user_id=actor AND x.status='active' AND x.is_active AND x.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles x WHERE x.id=actor AND x.user_status='active')
 OR NOT coalesce(public.gridex_actor_has_company_permission(actor,(p_scope->>'companyId')::uuid,'communication.write'),false) THEN RAISE EXCEPTION 'ediel_certificate_trust_config_actor_not_authorized' USING ERRCODE='42501'; END IF;
 hash:=encode(sha256(p_original_register),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended((p_scope->>'companyId')||'|'||(p_scope->>'environment')||'|'||(p_scope->>'receiverEdielId')||'|'||(p_scope->>'registerVersion'),0));
 SELECT * INTO prior FROM gridex_certificate_trust.authority_versions WHERE company_id=(p_scope->>'companyId')::uuid AND environment=p_scope->>'environment'
  AND receiver_ediel_id=p_scope->>'receiverEdielId' AND register_version=p_scope->>'registerVersion';
 IF FOUND THEN
  IF prior.original_sha256<>hash OR prior.recipient_fingerprints IS DISTINCT FROM p_materials->'recipientFingerprints' OR prior.anchors IS DISTINCT FROM p_materials->'anchors' OR prior.intermediates IS DISTINCT FROM p_materials->'intermediates' OR prior.crls IS DISTINCT FROM p_materials->'crls'
   OR prior.original_reference IS DISTINCT FROM p_scope->>'originalReference' OR prior.legal_authority_reference IS DISTINCT FROM p_scope->>'legalAuthorityReference'
   OR prior.process_authority_reference IS DISTINCT FROM p_scope->>'processAuthorityReference' OR prior.owner_register_reference IS DISTINCT FROM p_scope->>'ownerRegisterReference'
   OR prior.valid_from IS DISTINCT FROM (p_scope->>'validFrom')::timestamptz OR prior.valid_to IS DISTINCT FROM (p_scope->>'validTo')::timestamptz THEN RAISE EXCEPTION 'ediel_certificate_trust_version_conflict'; END IF;
  RETURN prior.id;
 END IF;
 INSERT INTO gridex_certificate_trust.authority_versions(company_id,environment,receiver_ediel_id,register_version,original_reference,original_sha256,
  legal_authority_reference,process_authority_reference,owner_register_reference,valid_from,valid_to,recipient_fingerprints,anchors,intermediates,crls,publisher_role)
 VALUES((p_scope->>'companyId')::uuid,p_scope->>'environment',p_scope->>'receiverEdielId',p_scope->>'registerVersion',p_scope->>'originalReference',hash,
  p_scope->>'legalAuthorityReference',p_scope->>'processAuthorityReference',p_scope->>'ownerRegisterReference',(p_scope->>'validFrom')::timestamptz,(p_scope->>'validTo')::timestamptz,
  p_materials->'recipientFingerprints',p_materials->'anchors',p_materials->'intermediates',p_materials->'crls',p_publisher) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_certificate_trust.publish_v1(jsonb,bytea,jsonb,text) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_certificate_authority_owner;
GRANT EXECUTE ON FUNCTION gridex_certificate_trust.publish_v1(jsonb,bytea,jsonb,text) TO gridex_ediel_certificate_authority_owner;
CREATE FUNCTION public.gridex_ediel_certificate_trust_publish_v1(p_scope jsonb,p_original_register bytea,p_materials jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'gridex_ediel_certificate_authority_owner' THEN RAISE EXCEPTION 'ediel_certificate_trust_qualified_external_owner_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_certificate_trust.publish_v1(p_scope,p_original_register,p_materials,current_user);
END $$;
REVOKE ALL ON FUNCTION public.gridex_ediel_certificate_trust_publish_v1(jsonb,bytea,jsonb) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_certificate_authority_owner;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_certificate_trust_publish_v1(jsonb,bytea,jsonb) TO gridex_ediel_certificate_authority_owner;

CREATE FUNCTION gridex_certificate_trust.read_v1(p_company_id uuid,p_environment text,p_receiver_ediel_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_certificate_trust.authority_versions%rowtype; count_versions integer;
BEGIN
 IF p_company_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test','production') OR nullif(btrim(p_receiver_ediel_id),'') IS NULL THEN RAISE EXCEPTION 'ediel_certificate_trust_scope_required'; END IF;
 SELECT count(*) INTO count_versions FROM gridex_certificate_trust.authority_versions WHERE company_id=p_company_id AND environment=p_environment
  AND receiver_ediel_id=p_receiver_ediel_id AND valid_from<=now() AND valid_to>now();
 IF count_versions=0 THEN RETURN NULL; END IF;
 IF count_versions<>1 THEN RAISE EXCEPTION 'ediel_certificate_trust_authority_versions_overlap'; END IF;
 SELECT * INTO STRICT a FROM gridex_certificate_trust.authority_versions WHERE company_id=p_company_id AND environment=p_environment AND receiver_ediel_id=p_receiver_ediel_id AND valid_from<=now() AND valid_to>now();
 RETURN jsonb_build_object('registrationId',a.id,'companyId',a.company_id,'environment',a.environment,'receiverEdielId',a.receiver_ediel_id,
  'registerVersion',a.register_version,'originalReference',a.original_reference,'originalSha256',a.original_sha256,
  'authorizationReference',a.legal_authority_reference||'|'||a.process_authority_reference||'|'||a.owner_register_reference,
  'validFrom',a.valid_from,'validTo',a.valid_to,'recipientFingerprints',a.recipient_fingerprints,'anchors',a.anchors,'intermediates',a.intermediates,'crls',a.crls);
END $$;
REVOKE ALL ON FUNCTION gridex_certificate_trust.read_v1(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_certificate_authority_owner;
GRANT EXECUTE ON FUNCTION gridex_certificate_trust.read_v1(uuid,text,text) TO service_role;
CREATE FUNCTION public.gridex_ediel_certificate_trust_read_v1(p_company_id uuid,p_environment text,p_receiver_ediel_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'ediel_certificate_trust_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_certificate_trust.read_v1(p_company_id,p_environment,p_receiver_ediel_id);
END $$;
REVOKE ALL ON FUNCTION public.gridex_ediel_certificate_trust_read_v1(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_certificate_authority_owner;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_certificate_trust_read_v1(uuid,text,text) TO service_role;
COMMIT;
