-- 20261001000148 made full-object facts part of the primary PRODAT validation
-- append (append_prodat_validation_v3 -> gridex_record_prodat_object_validation_v1,
-- whose direct EXECUTE it revoked). The facet recorder still required the
-- frozen source rule-pack receipt (gridex_ediel_source_rules.require_v1). For
-- inbound sources that receipt is captured only from an assessment committed in
-- an earlier transaction (capture_before_outbound_owner_v1), i.e. after this
-- very append. Every inbound PRODAT carrying object facts therefore failed
-- with ediel_historical_rule_pack_basis_unavailable and the primary receipt
-- stayed unconfirmed: a cycle with no valid order.
--
-- The facet recorder is reachable only from the primary append and only
-- records validation facts under that assessment. The frozen rule-pack basis
-- remains mandatory where it authorizes something: capture validates the
-- assessment's own rulePackEvidence, and every business consumer
-- (normal_switch_confirm_mixed_v1 and the other owners) still calls
-- gridex_ediel_source_rules.require_v1 before any effect. Only the premature
-- requirement inside the recorder is removed; the inbound legal-context
-- requirement, all fact checks, signature, security and ACL are unchanged.
BEGIN;
DO $rewrite$DECLARE f record;
 needle CONSTANT text:='PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);PERFORM gridex_ediel_source_rules.require_v1(p_company_id,m.id);';
 replacement CONSTANT text:='PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);';
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_record_prodat_object_validation_v1(uuid,text,uuid,text,uuid,text)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1
  OR EXISTS(SELECT FROM pg_proc p WHERE p.prosrc LIKE '%gridex_record_prodat_object_validation_v1(%' AND p.oid NOT IN(f.oid,'gridex_received_sources.append_prodat_validation_v3(uuid,text,uuid,text,text,text,text)'::regprocedure))
  OR has_function_privilege('service_role',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE')
 THEN RAISE EXCEPTION 'prodat_primary_object_facet_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'prodat_primary_object_facet_metadata_changed';END IF;
END$rewrite$;
COMMIT;
