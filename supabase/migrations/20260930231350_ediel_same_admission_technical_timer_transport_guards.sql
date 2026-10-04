-- Created by the actual Supabase CLI. Fresh provider attempts consume the
-- source-generated technical plan from their same immutable admission binding.
-- Prior accepted/entered receipts return before any new plan requirement.
BEGIN;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_technical_expectation_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;a gridex_ediel_transport.attempts%rowtype;
BEGIN
 result:=gridex_ediel_transport.mutate_before_technical_expectation_v1(p_input);
 IF p_input->>'action' NOT IN('prepare','enter') OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid
  AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR UPDATE;
 SELECT * INTO STRICT a FROM gridex_ediel_transport.attempts WHERE id=(p_input->>'attemptId')::uuid
  AND message_id=m.id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
 PERFORM gridex_ediel_transport.require_technical_expectation_binding_v1(m,a.binding);
 PERFORM public.require_metering_method_expectation_binding_v1(m,a.binding);
 IF m.message_standard='edifact' AND m.message_family='PRODAT' AND m.message_code='Z09' THEN
  PERFORM public.ediel_require_metering_method_change_source_current_v1(m.company_id,m.id,(p_input->>'actorUserId')::uuid);
 END IF;
 RETURN result;
END $$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_technical_expectation_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;a gridex_outbound_dispatch.attempts%rowtype;
BEGIN
 result:=gridex_outbound_dispatch.mutate_before_technical_expectation_v1(p_input);
 IF p_input->>'action' NOT IN('prepare','enter') OR result->>'scoped' IS DISTINCT FROM 'true'
  OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid
  AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR UPDATE;
 SELECT * INTO STRICT a FROM gridex_outbound_dispatch.attempts WHERE id=(p_input->>'attemptId')::uuid
  AND message_id=m.id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
 PERFORM gridex_ediel_transport.require_technical_expectation_binding_v1(m,a.binding);
 PERFORM public.require_metering_method_expectation_binding_v1(m,a.binding);
 IF m.message_standard='edifact' AND m.message_family='PRODAT' AND m.message_code='Z09' THEN
  PERFORM public.ediel_require_metering_method_change_source_current_v1(m.company_id,m.id,(p_input->>'actorUserId')::uuid);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_before_technical_expectation_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),
 gridex_outbound_dispatch.mutate_before_technical_expectation_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) TO service_role;
COMMIT;
