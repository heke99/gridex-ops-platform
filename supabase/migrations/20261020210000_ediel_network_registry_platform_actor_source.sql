-- FINDINGS F46 (owner decision 2026-10-20): a tenant's network-owner basis for
-- PRODAT came only from an uploaded, separately reviewed source signed by an
-- external issuer key that no application path can create, so no new
-- agreement could ever be sent. When a tenant has no reviewed source for a
-- network owner, the basis is the network owner that Gridex staff verified in
-- the imported Ediel actor registry: exactly one active, verified actor with
-- an active grid_owner role and one verified, current Ediel ID. A reviewed
-- source, when present, still decides (one leaf, else held).
-- Bodies are rewritten with metadata/OID preserved.
BEGIN;

CREATE FUNCTION gridex_network_registry_sources.platform_registry_network_v1(c uuid,network_id text,env text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;actor uuid;a public.platform_market_actors%rowtype;roles jsonb;snapshot jsonb;
BEGIN
 IF c IS NULL OR NOT EXISTS(SELECT FROM public.companies WHERE id=c) THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_network_registry_version_unqualified');END IF;
 PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.identifier_value=network_id ORDER BY i.id FOR SHARE;
 SELECT count(DISTINCT i.actor_id),min(i.actor_id::text)::uuid INTO n,actor FROM public.platform_actor_identifiers i
  WHERE lower(i.identifier_type) IN('edielid','ediel_id') AND i.identifier_value=network_id AND i.is_verified
  AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date);
 IF n<>1 THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_network_registry_version_unqualified');END IF;
 SELECT * INTO a FROM public.platform_market_actors WHERE id=actor FOR SHARE;
 PERFORM r.id FROM public.platform_actor_roles r WHERE r.actor_id=actor ORDER BY r.id FOR SHARE;
 IF a.id IS NULL OR a.status IS DISTINCT FROM 'active' OR a.match_status IS DISTINCT FROM 'verified' OR a.verified_at IS NULL
  OR NOT EXISTS(SELECT FROM public.platform_actor_roles r WHERE r.actor_id=actor AND r.actor_role='grid_owner' AND r.is_active)
 THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_network_registry_current_source_unqualified');END IF;
 SELECT coalesce(jsonb_agg(r.actor_role ORDER BY r.actor_role),'[]') INTO roles FROM public.platform_actor_roles r WHERE r.actor_id=actor AND r.is_active;
 snapshot:=jsonb_build_object('actorId',a.id,'name',a.name,'networkEdielId',network_id,'roles',roles,'verifiedAt',a.verified_at,'verifiedBy',a.verified_by);
 RETURN jsonb_build_object('status','authorized','basis',jsonb_build_object('companyId',c,'environment',env,'sourceKind','platform_registry_verified_actor',
  'networkActorId',a.id,'networkEdielId',network_id,'registryVersion',a.verified_at::text,'sourceReference','platform_market_actors:'||a.id::text,
  'sourceSha256',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')));
END$$;
REVOKE ALL ON FUNCTION gridex_network_registry_sources.platform_registry_network_v1(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

DO $rewrite$DECLARE f record;
 target CONSTANT text:='gridex_network_registry_sources.network_for_company_v1(uuid,text,text)';
 needle CONSTANT text:=$n$IF n<>1 THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_network_registry_version_unqualified');END IF;$n$;
 replacement CONSTANT text:=$r$IF n=0 THEN RETURN gridex_network_registry_sources.platform_registry_network_v1(c,network_id,env);END IF;IF n<>1 THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_network_registry_version_unqualified');END IF;$r$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=target::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'network_registry_platform_source_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'network_registry_platform_source_metadata_changed';END IF;
END$rewrite$;

COMMIT;
