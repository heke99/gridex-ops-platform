-- Actual CLI-created forward correction. Original protected version is opaque;
-- registered guide applicability derives from the ORIGINAL named guide fields.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_ediel_ack_guide.require_registered_basis_v1(m public.ediel_messages,p_kind text,p_basis jsonb,p_projection jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;v text;n integer;physical jsonb;
BEGIN
 IF p_kind='technical' THEN RETURN;END IF;
 IF p_kind='common' THEN r:=p_basis#>'{familyEdition,rulePack}';v:=p_basis#>>'{familyEdition,version}';ELSE r:=p_basis#>'{snapshot,rulePack}';v:=p_basis->>'version';
  IF p_basis#>>'{snapshot,version}' IS DISTINCT FROM v THEN RAISE EXCEPTION 'ediel_registered_original_guide_unavailable';END IF;
 END IF;
 physical:=gridex_ack_authority.wire_v1(m.raw_payload);
 IF r IS NULL OR physical IS NULL OR r->>'family' IS DISTINCT FROM physical->>'family' OR nullif(v,'') IS NULL THEN RAISE EXCEPTION 'ediel_registered_original_guide_unavailable';END IF;
 SELECT count(*) INTO n FROM jsonb_array_elements(p_projection->'registeredGuideScopes')s WHERE s->>'family'=r->>'family' AND s->>'guideVersion'=r->>'guide_version' AND s->>'guideRevision'=r->>'guide_revision';
 IF n<>1 THEN RAISE EXCEPTION 'ediel_registered_original_guide_unavailable';END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_guide.require_registered_basis_v1(public.ediel_messages,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
