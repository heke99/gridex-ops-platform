-- Read the already established outcome without reauthorizing a provider entry.
-- Current actor/tenant permission and unchanged original bytes remain required.
CREATE FUNCTION public.gridex_ediel_accepted_transport_projection_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype; candidates jsonb; candidate jsonb; binding jsonb; provider jsonb; plan jsonb; recipient text; original_hash text;
BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR p_message_id IS NULL OR (p_environment IN ('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_accepted_projection_scope_required';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_accepted_projection_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id AND environment=p_environment AND id=p_message_id AND direction='outbound' FOR SHARE;
 -- Both journals are private, append-only observations. A latest/default
 -- attempt, route, guide or market permission is never selected here.
 SELECT coalesce(jsonb_agg(v),'[]') INTO candidates FROM (
  SELECT jsonb_build_object('lane','generic_journal','attemptId',a.id,'binding',a.binding,'providerReceipt',a.provider_result,'observedAt',a.observed_at,'entered',a.entered_at IS NOT NULL,'originalHash',a.binding->>'originalHash') v
   FROM gridex_ediel_transport.attempts a WHERE a.company_id=p_company_id AND a.environment=p_environment AND a.message_id=p_message_id AND a.classification='accepted'
  UNION ALL
  SELECT jsonb_build_object('lane','sealed_z08','attemptId',a.id,'binding',a.binding,'providerReceipt',e.facts->'provider','observedAt',e.observed_at,
    'entered',EXISTS(SELECT FROM gridex_outbound_dispatch.events entry WHERE entry.attempt_id=a.id AND entry.company_id=p_company_id AND entry.environment=p_environment AND entry.message_id=p_message_id AND entry.kind='provider_call_entered'),
    'originalHash',o.payload_hash,'sealedHash',encode(sha256(convert_to(o.raw_payload,'UTF8')),'hex'))
   FROM gridex_outbound_dispatch.attempts a JOIN gridex_outbound_dispatch.originals o ON o.message_id=a.message_id AND o.company_id=a.company_id AND o.environment=a.environment
   JOIN gridex_outbound_dispatch.events e ON e.attempt_id=a.id AND e.company_id=a.company_id AND e.environment=a.environment AND e.message_id=a.message_id AND e.kind='provider_result' AND e.facts->>'classification'='accepted'
   WHERE a.company_id=p_company_id AND a.environment=p_environment AND a.message_id=p_message_id
  LIMIT 2
 ) receipts;
 IF jsonb_array_length(candidates)=0 THEN RETURN NULL;END IF;
 IF jsonb_array_length(candidates)<>1 THEN RAISE EXCEPTION 'ediel_accepted_projection_ambiguous';END IF;
 candidate:=candidates->0;binding:=candidate->'binding';provider:=candidate->'providerReceipt';plan:=binding->'businessExpectationPlan';recipient:=nullif(binding->>'to','');
 original_hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 IF m.raw_payload IS NULL OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM original_hash OR candidate->>'originalHash' IS DISTINCT FROM original_hash OR binding->>'originalHash' IS DISTINCT FROM original_hash OR (candidate->>'lane'='sealed_z08' AND candidate->>'sealedHash' IS DISTINCT FROM original_hash) THEN RAISE EXCEPTION 'ediel_accepted_projection_original_changed';END IF;
 IF candidate->>'entered' IS DISTINCT FROM 'true' OR nullif(candidate->>'observedAt','') IS NULL OR NOT isfinite((candidate->>'observedAt')::timestamptz) OR recipient IS NULL
  OR jsonb_typeof(provider) IS DISTINCT FROM 'object' OR jsonb_typeof(provider->'accepted') IS DISTINCT FROM 'array' OR jsonb_typeof(provider->'rejected') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'ediel_accepted_projection_receipt_invalid';END IF;
 IF jsonb_array_length(provider->'accepted')<1 OR jsonb_array_length(provider->'rejected')<>0 OR EXISTS(SELECT FROM jsonb_array_elements(provider->'accepted') v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string' OR lower(v#>>'{}') IS DISTINCT FROM lower(recipient)) OR (provider->>'messageId' IS NOT NULL AND jsonb_typeof(provider->'messageId') IS DISTINCT FROM 'string') OR (provider->>'response' IS NOT NULL AND jsonb_typeof(provider->'response') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'ediel_accepted_projection_expected_recipient_required';END IF;
 IF plan IS NOT NULL AND plan<>'null'::jsonb AND (jsonb_typeof(plan) IS DISTINCT FROM 'object' OR plan->>'version' IS DISTINCT FROM '1' OR plan->>'sourceCode' IS DISTINCT FROM m.message_code OR plan->>'expectedFamily' IS DISTINCT FROM 'PRODAT' OR plan->>'anchor' IS DISTINCT FROM 'actual_accepted_smtp_observed_at') THEN RAISE EXCEPTION 'ediel_accepted_projection_frozen_plan_invalid';END IF;
 RETURN jsonb_build_object('status','accepted_projection','companyId',p_company_id,'environment',p_environment,'messageId',p_message_id,'attemptId',candidate->>'attemptId','lane',candidate->>'lane','originalHash',original_hash,'observedAt',candidate->>'observedAt','providerReceipt',jsonb_build_object('accepted',provider->'accepted','rejected',provider->'rejected','messageId',provider->'messageId','response',provider->'response'),'frozenRecipient',recipient,'businessExpectationPlan',plan,'authorizesProviderEntry',false,'deliveryProven',false);
END $$;
REVOKE ALL ON FUNCTION public.gridex_ediel_accepted_transport_projection_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_accepted_transport_projection_v1(uuid,text,uuid,uuid) TO service_role;
