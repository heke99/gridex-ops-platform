-- Additive prerequisite for the independently published40159 market owner and
--40446 TXT/country forward. Their unchanged bytes do not compose:40446 expects
-- the older org update anchor. Only the market-scoped EL update is expressed in
-- that anchor; GAS still retains its own immutable source and never overwrites EL.
-- On a branch already using40446, this bounded catalog predicate is a no-op.
BEGIN;
DO $bridge$
DECLARE original text; expanded text; before record; after record;
 old_anchor text := $anchor$org_number=CASE WHEN market='EL' THEN coalesce(org_number,nullif(item->>'orgNumber','')) ELSE org_number END,country_code=CASE WHEN market='EL' THEN item->>'countryCode' ELSE country_code END,source_reference$anchor$;
 new_anchor text := $anchor$org_number=coalesce(org_number,nullif(item->>'orgNumber','')),source_reference$anchor$;
BEGIN
 SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile INTO STRICT before FROM pg_proc WHERE oid='public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure;
 original:=pg_get_functiondef(before.oid);
 IF position('capture_actor_market_v1' IN original)=0 OR position('capture_route_market_v1' IN original)=0
  OR position('ediel_registry_declared_transport_source_required' IN original)=0 OR position('raw_certificate_pem' IN original)=0 THEN
  RAISE EXCEPTION 'ediel_registry_market_txt_composed_owner_required';
 END IF;
 IF position(old_anchor IN original)>0 THEN
  expanded:=replace(original,old_anchor,new_anchor);
  IF position('updated_at=now() WHERE id=aid;' IN expanded)=0 THEN RAISE EXCEPTION 'ediel_registry_market_txt_own_update_anchor_required';END IF;
  expanded:=replace(expanded,'updated_at=now() WHERE id=aid;','updated_at=now() WHERE id=aid AND market=''EL'';');
  EXECUTE expanded;
 ELSIF position('companies_txt' IN original)>0 AND position('country_code=coalesce(nullif(item->>''countryCode'',''''),country_code)' IN original)>0
  AND position('WHERE id=aid AND market=''EL''' IN original)>0 THEN
  NULL; -- already applied compatible TXT/country owner, preserving installed OID
 ELSE
  RAISE EXCEPTION 'ediel_registry_market_txt_unknown_owner_boundary';
 END IF;
 SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile INTO STRICT after FROM pg_proc WHERE oid='public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure;
 IF to_jsonb(before) IS DISTINCT FROM to_jsonb(after) THEN RAISE EXCEPTION 'ediel_registry_market_txt_owner_metadata_changed';END IF;
END $bridge$;
COMMIT;
