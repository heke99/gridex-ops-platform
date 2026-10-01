-- Created by actual Supabase CLI2.118.0. Read the original row and its protected
-- immutable rule basis under the same source lock; never capture on an ACK read.
BEGIN;
CREATE FUNCTION gridex_ediel_source_rules.read_source_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source public.ediel_messages%rowtype; evidence jsonb;
BEGIN
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id AND direction='inbound' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ack_actual_original_unavailable'; END IF;
 evidence:=gridex_ediel_source_rules.require_v1(p_company_id,source.id);
 RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(source),'sourceRulePackEvidence',evidence);
END $$;
CREATE FUNCTION gridex_ediel_source_rules.read_outbound_ack_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ack public.ediel_messages%rowtype; source public.ediel_messages%rowtype; evidence jsonb;
BEGIN
 SELECT * INTO ack FROM public.ediel_messages WHERE id=p_ack_message_id AND company_id=p_company_id AND environment=p_environment
  AND direction='outbound' AND message_family IN('CONTRL','APERAK','UTILTS_ERR') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ack_actual_original_unavailable'; END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=ack.related_message_id AND company_id=ack.company_id AND environment=ack.environment AND direction='inbound' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ack_actual_original_unavailable'; END IF;
 evidence:=gridex_ediel_source_rules.require_v1(p_company_id,source.id);
 RETURN jsonb_build_object('version',1,'ackMessage',to_jsonb(ack),'sourceMessage',to_jsonb(source),'sourceRulePackEvidence',evidence);
END $$;
CREATE FUNCTION public.ediel_read_source_rule_pack_basis_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_ediel_source_rules.read_source_v1(p_company_id,p_message_id);
END $$;
CREATE FUNCTION public.ediel_read_outbound_ack_source_rule_pack_basis_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_ediel_source_rules.read_outbound_ack_v1(p_company_id,p_environment,p_ack_message_id);
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_source_rules.read_source_v1(uuid,uuid),gridex_ediel_source_rules.read_outbound_ack_v1(uuid,text,uuid),public.ediel_read_source_rule_pack_basis_v1(uuid,uuid),public.ediel_read_outbound_ack_source_rule_pack_basis_v1(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_source_rules.read_source_v1(uuid,uuid),gridex_ediel_source_rules.read_outbound_ack_v1(uuid,text,uuid),public.ediel_read_source_rule_pack_basis_v1(uuid,uuid),public.ediel_read_outbound_ack_source_rule_pack_basis_v1(uuid,text,uuid) TO service_role;
COMMIT;
