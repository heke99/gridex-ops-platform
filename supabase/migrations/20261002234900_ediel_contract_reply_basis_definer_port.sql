-- 20261002233000 let the canonical contract trigger
-- (public.gridex_validate_ediel_message_contract, SECURITY INVOKER, BEFORE
-- INSERT OR UPDATE on ediel_messages) re-run the protected reply authorities
-- for rule-pack-less technical CONTRL and common-header APERAK replies:
-- gridex_ediel_technical_ack.require_contrl_v1 and
-- gridex_ediel_common_header.witness_v1. Both are executable by their owner
-- only. Creation runs through owner-defined functions and passed, but every
-- later UPDATE of such a reply by service_role (status/sent projection after
-- SMTP acceptance) failed with "permission denied for function
-- require_contrl_v1" and surfaced as an uncertain delivery.
--
-- Fix: one narrow SECURITY DEFINER port that performs exactly those two checks
-- for the given row and returns nothing. It is executable by the roles that
-- write ediel_messages (authenticated, service_role), never by anon/PUBLIC.
-- The trigger calls the port; its decisions are unchanged.
BEGIN;
CREATE FUNCTION public.gridex_require_outbound_reply_basis_v1(m public.ediel_messages) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF m.message_family='CONTRL' THEN PERFORM gridex_ediel_technical_ack.require_contrl_v1(m);
 ELSIF m.message_family='APERAK' AND m.execution_context_snapshot ? 'prodatCommonHeaderNegativeWitnessId' THEN PERFORM gridex_ediel_common_header.witness_v1(m);
 ELSE RAISE EXCEPTION 'canonical_ediel_rule_pack_required' USING ERRCODE='23502';
 END IF;
END$$;
REVOKE ALL ON FUNCTION public.gridex_require_outbound_reply_basis_v1(public.ediel_messages) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gridex_require_outbound_reply_basis_v1(public.ediel_messages) TO authenticated,service_role;

DO $port$DECLARE f record;
 needle CONSTANT text:=$n$        if new.message_family='CONTRL' then
          perform gridex_ediel_technical_ack.require_contrl_v1(new);
        elsif new.message_family='APERAK' and new.execution_context_snapshot ? 'prodatCommonHeaderNegativeWitnessId' then
          perform gridex_ediel_common_header.witness_v1(new);
        else
          raise exception 'canonical_ediel_rule_pack_required' using errcode='23502';
        end if;$n$;
 replacement CONSTANT text:=$n$        perform public.gridex_require_outbound_reply_basis_v1(new);$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='public.gridex_validate_ediel_message_contract()'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'contract_reply_basis_port_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'contract_reply_basis_port_metadata_changed';END IF;
END$port$;
COMMIT;
