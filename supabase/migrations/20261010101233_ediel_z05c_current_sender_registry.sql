-- First Z05/C restoration uses the existing protected sender registry owner.
-- Preserve historical replay, exact original ending/state/correlation checks,
-- caller graph-lock order and all existing effect partitions and privileges.
BEGIN;
DO $sender$DECLARE f record;body text;
 old_declaration CONSTANT text:=$needle$ wire jsonb;original jsonb;$needle$;
 new_declaration CONSTANT text:=$needle$ wire jsonb;sender_basis jsonb;original jsonb;$needle$;
 old_tenant_lock CONSTANT text:=$needle$ PERFORM tp.id FROM public.tenant_ediel_profiles tp WHERE tp.company_id=m.company_id AND tp.environment=m.environment ORDER BY tp.id FOR SHARE;$needle$;
 sender_guard CONSTANT text:=$guard$ -- Only a first Z05/C restoration requires today's actual sender registry.
 -- Historical recorded outcomes returned above retain their original truth.
 IF wire->>'code'='Z05' AND reason='Z24' THEN
  sender_basis:=gridex_network_registry_sources.network_for_company_v1(m.company_id,wire->>'sender',m.environment);
  IF sender_basis->>'status' IS DISTINCT FROM 'authorized'
   OR sender_basis#>>'{basis,companyId}' IS DISTINCT FROM m.company_id::text
   OR sender_basis#>>'{basis,environment}' IS DISTINCT FROM m.environment
   OR sender_basis#>>'{basis,networkEdielId}' IS DISTINCT FROM wire->>'sender'
   THEN RETURN jsonb_build_object('applied',false,'reason','z05c_current_sender_network_registry_required');END IF;
 END IF;
$guard$;
BEGIN
 PERFORM 'gridex_network_registry_sources.network_for_company_v1(uuid,text,text)'::regprocedure;
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition
 INTO STRICT f FROM pg_proc p
 WHERE p.oid='gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'd2fd0bf5d193b6888d5a41c064a24e5b020446b3b5332493963fa1dedee3e5a9'
  OR (length(f.prosrc)-length(replace(f.prosrc,old_declaration,'')))/length(old_declaration)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,old_tenant_lock,'')))/length(old_tenant_lock)<>1
  THEN RAISE EXCEPTION 'z05c_sender_registry_predecessor_required';END IF;
 body:=replace(replace(f.prosrc,old_declaration,new_declaration),old_tenant_lock,sender_guard||old_tenant_lock);
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM 'aab2d2f6dcbfe17e31f92c07a70c9f9346396a2c1435a5976b1d70c8e58cb2b7'
  OR replace(replace(body,sender_guard,''),new_declaration,old_declaration) IS DISTINCT FROM f.prosrc
  THEN RAISE EXCEPTION 'z05c_sender_registry_inverse_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata
  OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM 'aab2d2f6dcbfe17e31f92c07a70c9f9346396a2c1435a5976b1d70c8e58cb2b7'
  THEN RAISE EXCEPTION 'z05c_sender_registry_metadata_or_postimage_changed';END IF;
END$sender$;
COMMIT;
