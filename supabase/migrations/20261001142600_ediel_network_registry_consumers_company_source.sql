-- 20260930174145 created gridex_ai_processing.network_registry_basis_v1 as a
-- closed boundary: it is held "until the real registry contract is supplied".
-- The real contract now exists: gridex_network_registry_sources, with its
-- authenticated archive, separate review and versioned company-scoped
-- network_for_company_v1. gridex_ai_processing.header_company_basis_v1 already
-- uses it. Three consumers still called the closed stub, so every BRP source,
-- every new-agreement requested method (each new-agreement Z03) and its
-- context were permanently held with ai_bi_network_registry_version_unqualified.
-- Each call is rewired to the same company-scoped registry owner, with the
-- company already in scope and the same receiver/environment. Result shape
-- {status, blocker | basis} is unchanged. The stub itself stays closed for
-- any other caller. Bodies are rewritten with metadata/OID preserved.
BEGIN;
DO $rewrite$DECLARE f record;
 targets CONSTANT text[][]:=ARRAY[
  ARRAY['gridex_brp_sources.require_source_v1(uuid,uuid,uuid,text,text,uuid,uuid,uuid,timestamp with time zone,uuid)',
   'gridex_ai_processing.network_registry_basis_v1(d.legal_receiver_id,env)','gridex_network_registry_sources.network_for_company_v1(c,d.legal_receiver_id,env)'],
  ARRAY['gridex_metering_method_changes.contract_request_basis_v1(uuid,uuid,uuid,text,text)',
   'gridex_ai_processing.network_registry_basis_v1(d.legal_receiver_id,d.environment)','gridex_network_registry_sources.network_for_company_v1(c,d.legal_receiver_id,d.environment)'],
  ARRAY['gridex_metering_method_changes.context_before_contract_request_v1(uuid,uuid,uuid,text)',
   'gridex_ai_processing.network_registry_basis_v1(e.legal_receiver_id,e.environment)','gridex_network_registry_sources.network_for_company_v1(c,e.legal_receiver_id,e.environment)']];
BEGIN
 FOR i IN 1..array_length(targets,1) LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=targets[i][1]::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,targets[i][2],'')))/length(targets[i][2])<>1 THEN RAISE EXCEPTION 'network_registry_consumer_predecessor_required:%',targets[i][1];END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,targets[i][2],targets[i][3]));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'network_registry_consumer_metadata_changed:%',targets[i][1];END IF;
 END LOOP;
 IF EXISTS(SELECT FROM pg_proc WHERE prosrc LIKE '%gridex_ai_processing.network_registry_basis_v1(%' AND oid<>'gridex_ai_processing.network_registry_basis_v1(text,text)'::regprocedure) THEN RAISE EXCEPTION 'network_registry_stub_consumer_remaining';END IF;
END$rewrite$;
COMMIT;
