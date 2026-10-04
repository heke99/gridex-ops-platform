-- 20261001023248 (bilateral PRODAT original owner) replaced
-- public.ediel_bind_switch_original_v1 with an H/non-H split whose non-H
-- branch calls gridex_bilateral_prodat.bind_switch_before_bilateral_v1, a
-- verbatim copy of the pre-method base body. That silently dropped the two
-- wrappers composed before it:
--   20260930234708 requested-method binding
--     (public.ediel_bind_switch_original_before_brp_source_v1 ->
--      gridex_received_sources.bind_switch_contract_request_v1)
--   20261001011248 BRP source binding
--     (gridex_received_sources.bind_switch_brp_source_v1)
-- A normal Z03 original was therefore bound without its contract-request
-- binding, and every later send failed closed in
-- require_switch_contract_request_current_v1 with
-- switch_historical_requested_method_basis_unavailable.
--
-- Restore the composition: the non-H branch delegates to the method wrapper
-- (which itself calls the unchanged base body) and then binds the BRP source,
-- exactly as the 011248 wrapper did. The public split, the H branch,
-- signatures, security, configuration and ACLs are unchanged.
BEGIN;
DO $restore$DECLARE f regprocedure:='gridex_bilateral_prodat.bind_switch_before_bilateral_v1(uuid,uuid,uuid,uuid)'::regprocedure;
 base regprocedure:='public.ediel_bind_switch_original_before_method_v1(uuid,uuid,uuid,uuid)'::regprocedure;
 method regprocedure:='public.ediel_bind_switch_original_before_brp_source_v1(uuid,uuid,uuid,uuid)'::regprocedure;
 before jsonb;
BEGIN
 -- Predecessor: the bilateral non-H target is still the duplicated base body,
 -- the method wrapper still calls the base and binds the contract request,
 -- and the public split still routes non-H originals to the target.
 IF (SELECT prosrc FROM pg_proc WHERE oid=f) IS DISTINCT FROM (SELECT prosrc FROM pg_proc WHERE oid=base)
  OR (SELECT prosrc FROM pg_proc WHERE oid=method) NOT LIKE '%public.ediel_bind_switch_original_before_method_v1(p_company_id,p_switch_id,p_message_id,p_actor_user_id)%'
  OR (SELECT prosrc FROM pg_proc WHERE oid=method) NOT LIKE '%gridex_received_sources.bind_switch_contract_request_v1(%'
  OR (SELECT prosrc FROM pg_proc WHERE oid='public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid)'::regprocedure) NOT LIKE '%RETURN gridex_bilateral_prodat.bind_switch_before_bilateral_v1(p_company_id,p_switch_id,p_message_id,p_actor_user_id);%'
 THEN RAISE EXCEPTION 'switch_original_bind_chain_predecessor_required';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO before FROM pg_proc p WHERE oid=f;
 CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.bind_switch_before_bilateral_v1(p_company_id uuid,p_switch_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
  result:=public.ediel_bind_switch_original_before_brp_source_v1(p_company_id,p_switch_id,p_message_id,p_actor_user_id);
  IF result->>'status'='bound' AND result->>'idempotent' IS DISTINCT FROM 'true' THEN PERFORM gridex_received_sources.bind_switch_brp_source_v1(p_company_id,p_message_id,p_actor_user_id);END IF;RETURN result;
 END$$;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f) IS DISTINCT FROM before THEN RAISE EXCEPTION 'switch_original_bind_chain_metadata_changed';END IF;
END$restore$;
COMMIT;
