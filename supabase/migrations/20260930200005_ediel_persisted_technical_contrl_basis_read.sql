-- Created by actual Supabase CLI2.118.0. Actual persisted ACK and actual related
-- source are read in the same protected command; caller pointers are no basis.
CREATE FUNCTION gridex_ediel_technical_ack.read_persisted_contrl_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;e jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_ack_message_id AND company_id=p_company_id AND environment=p_environment AND direction='outbound' AND message_family='CONTRL' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 e:=gridex_ediel_technical_ack.require_contrl_v1(m);
 RETURN jsonb_build_object('version',1,'ackMessage',to_jsonb(m),'technicalSyntaxAckEvidence',e);
END $$;
CREATE FUNCTION public.ediel_read_persisted_technical_contrl_basis_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 RETURN gridex_ediel_technical_ack.read_persisted_contrl_v1(p_company_id,p_environment,p_ack_message_id);END $$;
REVOKE ALL ON FUNCTION gridex_ediel_technical_ack.read_persisted_contrl_v1(uuid,text,uuid),public.ediel_read_persisted_technical_contrl_basis_v1(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gridex_ediel_technical_ack.read_persisted_contrl_v1(uuid,text,uuid),public.ediel_read_persisted_technical_contrl_basis_v1(uuid,text,uuid) TO service_role;
