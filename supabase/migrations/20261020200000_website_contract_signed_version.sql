-- FINDINGS F45 (owner decision 2026-10-20): a website signature never set
-- signed_version, so every Ediel source that binds a new agreement held with
-- current_signed_new_customer_agreement / contract_intake_actual_signed_contract_tuple_required.
-- Token signing and the admin import already set signed_version and
-- terms_signed_version at signing; the website finalization now does the same,
-- in the same update that signs. Contracts signed earlier stay as signed: their
-- signed fields are immutable by design and are not rewritten here.
-- Bodies are rewritten with metadata/OID preserved.
BEGIN;
DO $rewrite$DECLARE f record;s text;
 needle CONSTANT text:=$n$status='signed',signed_at=p_accepted_at,is_distance_agreement=true,$n$;
 replacement CONSTANT text:=$r$status='signed',signed_at=p_accepted_at,is_distance_agreement=true,signed_version=coalesce(terms_version,contract_version,'v1'),terms_signed_version=coalesce(terms_version,'v1'),$r$;
BEGIN
 FOREACH s IN ARRAY ARRAY['public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamp with time zone,jsonb,jsonb,text,text,text)',
  'public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamp with time zone,jsonb,jsonb,jsonb,text,text,text)'] LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=s::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 OR position('signed_version' IN f.prosrc)>0 THEN RAISE EXCEPTION 'website_signed_version_predecessor_required:%',s;END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'website_signed_version_metadata_changed:%',s;END IF;
 END LOOP;
END$rewrite$;
COMMIT;
