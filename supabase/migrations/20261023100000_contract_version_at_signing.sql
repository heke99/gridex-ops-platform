-- FINDINGS F95 (confirmed in the reality world 2026-10-23): a grid owner's
-- PRODAT Z04 confirming our Z03 was held with
-- normal_z04_owned_signed_contract_scope_required, because the owned-contract
-- condition requires a contract_version and no SQL path ever set one. Only the
-- TypeScript create/update path (lib/customer-contracts/db.ts) writes
-- contract_version. Every SQL signing finalizer now sets it in the same update
-- that signs, to exactly what that update writes to signed_version
-- (coalesce(terms_version,'v1')) when no contract_version is present, so the
-- gates that require signed_version = contract_version (bilateral PRODAT
-- preparation, regulated supply, BRP declaration, outbound capability) agree;
-- a contract_version that is already present is kept. Contracts signed earlier
-- stay as signed (no backfill).
-- Rewritten (the signing UPDATE only; bodies located by an exact needle that
-- occurs exactly once, after F45 20261020200000 and F51 20261022130000):
--  * gridex_finalize_website_contract_signature (both overloads)
--  * gridex_finalize_customer_contract_signature_v1(text,text,text)
--  * gridex_finalize_signature_before_record_retention_v1(text,text,text)
--  * gridex_finalize_admin_imported_signed_agreement_v1() (admin import trigger)
-- OID and pg_proc metadata are preserved.
BEGIN;
DO $rewrite$DECLARE f record;s text;needle text;replacement text;
 compact_needle CONSTANT text:=$n$signed_version=coalesce(terms_version,contract_version,'v1'),terms_signed_version=coalesce(terms_version,'v1'),$n$;
 compact_replacement CONSTANT text:=$r$contract_version=coalesce(nullif(contract_version,''),terms_version,'v1'),signed_version=coalesce(terms_version,contract_version,'v1'),terms_signed_version=coalesce(terms_version,'v1'),$r$;
 spaced_needle CONSTANT text:=$n$      signed_version = coalesce(terms_version, contract_version, 'v1'),
      terms_signed_version = coalesce(terms_version, 'v1'),$n$;
 spaced_replacement CONSTANT text:=$r$      contract_version = coalesce(nullif(contract_version, ''), terms_version, 'v1'),
      signed_version = coalesce(terms_version, contract_version, 'v1'),
      terms_signed_version = coalesce(terms_version, 'v1'),$r$;
BEGIN
 FOREACH s IN ARRAY ARRAY['public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamp with time zone,jsonb,jsonb,text,text,text)',
  'public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamp with time zone,jsonb,jsonb,jsonb,text,text,text)',
  'public.gridex_finalize_customer_contract_signature_v1(text,text,text)',
  'public.gridex_finalize_signature_before_record_retention_v1(text,text,text)',
  'public.gridex_finalize_admin_imported_signed_agreement_v1()'] LOOP
  IF s='public.gridex_finalize_admin_imported_signed_agreement_v1()' THEN needle:=spaced_needle;replacement:=spaced_replacement;
  ELSE needle:=compact_needle;replacement:=compact_replacement;END IF;
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=s::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1
   OR position('contract_version=coalesce(' IN f.prosrc)>0 OR position('contract_version = coalesce(' IN f.prosrc)>0
   OR (length(f.definition)-length(replace(f.definition,f.prosrc,'')))/length(f.prosrc)<>1 THEN
   RAISE EXCEPTION 'contract_version_at_signing_predecessor_required:%',s;END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'contract_version_at_signing_metadata_changed:%',s;END IF;
 END LOOP;
END$rewrite$;
COMMIT;
