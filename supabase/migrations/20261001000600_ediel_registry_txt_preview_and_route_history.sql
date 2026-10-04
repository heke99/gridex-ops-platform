-- Authentic TXT is a distinct source kind; missing roles/qualifiers are not
-- manufactured. Existing canonical apply/owner/ACL remains the sole writer.
BEGIN;
ALTER TABLE gridex_registry_import.batches DROP CONSTRAINT batches_source_kind_check;
ALTER TABLE gridex_registry_import.batches ADD CONSTRAINT batches_source_kind_check CHECK(source_kind IN('companies_xml','companies_txt','csv'));
DO $$DECLARE body text;BEGIN
 body:=pg_get_functiondef('public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure);
 IF position('(''companies_xml'',''csv'')' in body)=0 THEN RAISE EXCEPTION 'ediel_registry_txt_forward_predecessor_required';END IF;
 body:=replace(body,'(''companies_xml'',''csv'')','(''companies_xml'',''companies_txt'',''csv'')');
 IF position('org_number=coalesce(org_number,nullif(item->>''orgNumber'','''')),source_reference' in body)=0 THEN RAISE EXCEPTION 'ediel_registry_country_forward_predecessor_required';END IF;
 body:=replace(body,'org_number=coalesce(org_number,nullif(item->>''orgNumber'','''')),source_reference','org_number=coalesce(org_number,nullif(item->>''orgNumber'','''')),country_code=coalesce(nullif(item->>''countryCode'',''''),country_code),source_reference');
 EXECUTE body;
END$$;
CREATE TABLE gridex_registry_import.route_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),route_id uuid NOT NULL,actor_id uuid NOT NULL,revision bigint NOT NULL,
 snapshot jsonb NOT NULL,snapshot_hash text NOT NULL CHECK(snapshot_hash=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(route_id,revision));
ALTER TABLE gridex_registry_import.route_versions ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_registry_import.route_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_registry_import.route_versions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER registry_route_versions_immutable BEFORE UPDATE OR DELETE ON gridex_registry_import.route_versions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER registry_route_versions_no_truncate BEFORE TRUNCATE ON gridex_registry_import.route_versions FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_registry_import.capture_route_version_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE version bigint;snapshot jsonb;
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(new)-ARRAY['updated_at','metadata']) IS NOT DISTINCT FROM (to_jsonb(old)-ARRAY['updated_at','metadata']) THEN RETURN new;END IF;
 IF TG_OP='UPDATE' AND (new.id IS DISTINCT FROM old.id OR new.actor_id IS DISTINCT FROM old.actor_id) THEN RAISE EXCEPTION 'ediel_registry_route_identity_immutable';END IF;
 snapshot:=to_jsonb(old);SELECT coalesce(max(revision),0)+1 INTO version FROM gridex_registry_import.route_versions WHERE route_id=old.id;
 INSERT INTO gridex_registry_import.route_versions(route_id,actor_id,revision,snapshot,snapshot_hash) VALUES(old.id,old.actor_id,version,snapshot,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
 IF TG_OP='DELETE' THEN RETURN old;END IF;RETURN new;
END$$;
CREATE TRIGGER registry_route_version BEFORE UPDATE OR DELETE ON public.platform_actor_routes FOR EACH ROW EXECUTE FUNCTION gridex_registry_import.capture_route_version_v1();
CREATE FUNCTION public.ediel_read_registry_preview_snapshot_v1(p_actor_user_id uuid,p_ediel_ids text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actors jsonb;
BEGIN
 IF coalesce(cardinality(p_ediel_ids),0)>4096 OR public.canonical_actor_is_platform_admin(p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_platform_actor_required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ediel_registry_atomic_apply_v1',0));
 PERFORM id FROM public.user_profiles WHERE id=p_actor_user_id FOR SHARE;PERFORM user_id FROM public.admin_users WHERE user_id=p_actor_user_id FOR SHARE;
 IF public.canonical_actor_is_platform_admin(p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_platform_actor_revoked' USING ERRCODE='42501';END IF;
 LOCK TABLE public.platform_market_actors,public.platform_actor_identifiers,public.platform_actor_roles,public.platform_actor_routes IN SHARE MODE;
 SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',a.id,'edielId',i.identifier_value,'name',a.name,'legalName',a.legal_name,'market',a.metadata->>'market','countryCode',a.country_code,'orgNumber',a.org_number,
 'svkId',(SELECT identifier_value FROM public.platform_actor_identifiers x WHERE x.actor_id=a.id AND x.identifier_type='SvKId' ORDER BY id LIMIT 1),
 'eic',(SELECT identifier_value FROM public.platform_actor_identifiers x WHERE x.actor_id=a.id AND x.identifier_type='EIC' ORDER BY id LIMIT 1),
 'roles',(SELECT coalesce(jsonb_agg(actor_role ORDER BY actor_role),'[]') FROM public.platform_actor_roles x WHERE x.actor_id=a.id AND x.is_active),
 'routes',(SELECT coalesce(jsonb_agg(jsonb_build_object('messageFamily',r.message_family,'environment',r.environment,'applicationReference',r.application_reference,'subaddress',r.subaddress,'communicationType',r.communication_type,'communicationAddress',r.communication_address,'partyId',r.party_id,'interchangePartyId',r.interchange_party_id,'partyIdQualifier',r.party_id_qualifier,'partyIdResponsible',r.party_id_responsible,'interchangeIdQualifier',r.interchange_id_qualifier,'ediCharset',r.edi_charset,'ediSyntax',r.edi_syntax) ORDER BY r.id),'[]') FROM public.platform_actor_routes r WHERE r.actor_id=a.id)) ORDER BY a.id,i.identifier_value),'[]') INTO actors
 FROM public.platform_market_actors a JOIN public.platform_actor_identifiers i ON i.actor_id=a.id AND lower(i.identifier_type) IN('edielid','ediel_id') WHERE i.identifier_value=ANY(p_ediel_ids);
 RETURN jsonb_build_object('actors',actors,'snapshotHash',encode(sha256(convert_to(actors::text,'UTF8')),'hex'));
END$$;
REVOKE ALL ON FUNCTION gridex_registry_import.capture_route_version_v1() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_read_registry_preview_snapshot_v1(uuid,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_read_registry_preview_snapshot_v1(uuid,text[]) TO service_role;
COMMIT;
