-- Return the immutable database capture clock of the actual Z08 provider result.
-- It is an observation time, not proof of SMTP acceptance time or delivery.
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_observed_clock_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; observed timestamptz;
BEGIN
 result:=gridex_outbound_dispatch.mutate_before_observed_clock_v1(p_input);
 IF p_input->>'action'='result' AND result->>'scoped'='true' THEN
  SELECT e.observed_at INTO STRICT observed FROM gridex_outbound_dispatch.events e
   WHERE e.id=(result->>'eventId')::uuid AND e.attempt_id=(p_input->>'attemptId')::uuid
   AND e.message_id=(p_input->>'messageId')::uuid AND e.company_id=(p_input->>'companyId')::uuid
   AND e.environment=p_input->>'environment' AND e.kind='provider_result' FOR SHARE;
  IF observed IS NULL OR NOT isfinite(observed) THEN RAISE EXCEPTION 'outbound_dispatch_actual_observation_clock_required';END IF;
  result:=result||jsonb_build_object('observedAt',observed,'observationClock','database_provider_result_capture');
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_outbound_dispatch.mutate_before_observed_clock_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.gridex_outbound_dispatch_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'outbound_dispatch_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_outbound_dispatch.mutate_v1(p_input);
END $$;
REVOKE ALL ON FUNCTION public.gridex_outbound_dispatch_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_outbound_dispatch_v1(jsonb) TO service_role;
