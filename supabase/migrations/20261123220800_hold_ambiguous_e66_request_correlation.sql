CREATE FUNCTION public.gridex_hold_e66_request_correlation_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid,p_source uuid,p_lease uuid,p_review jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $hold$
DECLARE
  w gridex_e66_intake.work;
  evidence jsonb;
BEGIN
  -- The shared claim guard proves the current worker, exact first reception and raw E66.
  w:=gridex_e66_intake.require_registration_rejection_claim_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
  IF jsonb_typeof(p_review) IS DISTINCT FROM 'object'
    OR p_review - ARRAY['reason','pointReference','requestReference','periodFrom','periodUntil'] <> '{}'::jsonb
    OR (p_review->>'reason' IN ('missing_reference','ambiguous_reference','unknown_reference','point_mismatch',
      'inactive_request','disjoint_period','unverified_period')) IS NOT TRUE
    OR length(p_review->>'requestReference')>70 OR length(p_review->>'pointReference')>70
    OR (p_review->>'periodFrom' IS NULL)<>(p_review->>'periodUntil' IS NULL)
    OR (p_review->>'periodFrom')::timestamptz>=(p_review->>'periodUntil')::timestamptz
  THEN RAISE EXCEPTION 'e66_request_correlation_review_invalid' USING ERRCODE='22023'; END IF;
  IF gridex_e66_intake.request_upgrade_state_v1(p_source) IS DISTINCT FROM 'qualify_normally'
    OR EXISTS(SELECT FROM gridex_e66_intake.registration_rejections r WHERE r.source_id=p_source)
  THEN RAISE EXCEPTION 'e66_request_correlation_already_owned' USING ERRCODE='55000'; END IF;

  evidence:=jsonb_build_object('code','e66_request_correlation_review','reason',p_review->>'reason',
    'pointReference',p_review->>'pointReference','requestReference',p_review->>'requestReference',
    'periodFrom',p_review->>'periodFrom','periodUntil',p_review->>'periodUntil');
  UPDATE public.ediel_messages SET grid_owner_data_request_id=NULL
    WHERE (id,company_id,environment)=(w.source_id,w.company_id,w.environment) AND grid_owner_data_request_id IS NOT NULL;
  INSERT INTO public.ediel_message_events(company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
  VALUES(w.company_id,w.source_id,w.source_id,'validated','warning','Kontrollera vilket E73 som E66-svaret gäller.',
    evidence,evidence,p_actor);
  UPDATE gridex_e66_intake.work SET phase='request_review',lease_actor=NULL,lease_token=NULL,lease_until=NULL
    WHERE source_id=w.source_id;
  RETURN w.source_id;
END
$hold$;
REVOKE ALL ON FUNCTION public.gridex_hold_e66_request_correlation_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_hold_e66_request_correlation_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)
  TO service_role;

CREATE FUNCTION public.gridex_read_e66_request_correlation_reviews_v1(
  p_company_id uuid,p_request_id uuid,p_environment text,p_actor_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $read$
DECLARE result jsonb;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR (
    public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.read') IS NOT TRUE
    AND public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.read') IS NOT TRUE)
  THEN RAISE EXCEPTION 'e66_request_correlation_review_forbidden' USING ERRCODE='42501'; END IF;
  IF (p_environment IS NOT NULL AND p_environment NOT IN ('test','production')) OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'e66_request_correlation_review_invalid_scope' USING ERRCODE='22023';
  END IF;
  WITH candidates AS (
    SELECT m.id,m.external_reference,m.message_received_at,m.environment,e.payload
    FROM public.grid_owner_data_requests request
    JOIN public.ediel_messages m ON m.company_id=request.company_id AND (p_environment IS NULL OR m.environment=p_environment)
    JOIN gridex_e66_intake.work w ON w.company_id=m.company_id AND w.environment=m.environment AND w.source_id=m.id
    JOIN public.ediel_message_events e ON e.company_id=m.company_id AND e.ediel_message_id=m.id
    WHERE (request.company_id,request.id)=(p_company_id,p_request_id)
      AND request.request_scope IN ('meter_values','billing_underlay')
      AND m.direction='inbound' AND m.message_family='UTILTS' AND m.message_code='E66'
      AND w.phase='request_review' AND m.grid_owner_data_request_id IS NULL
      AND e.payload->>'code'='e66_request_correlation_review'
      AND ((request.metering_point_id IS NOT NULL AND m.metering_point_id=request.metering_point_id)
        OR (request.external_reference IS NOT NULL AND e.payload->>'requestReference'=request.external_reference))
    ORDER BY m.message_received_at DESC NULLS LAST,m.id
    LIMIT 20
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',c.id,'responseReference',c.external_reference,
    'receivedAt',c.message_received_at,'reason',c.payload->>'reason','requestReference',c.payload->>'requestReference',
    'pointReference',c.payload->>'pointReference','environment',c.environment,
    'periodFrom',c.payload->>'periodFrom','periodUntil',c.payload->>'periodUntil') ORDER BY c.message_received_at DESC NULLS LAST,c.id),'[]'::jsonb)
    INTO result FROM candidates c;
  RETURN result;
END
$read$;
REVOKE ALL ON FUNCTION public.gridex_read_e66_request_correlation_reviews_v1(uuid,uuid,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_e66_request_correlation_reviews_v1(uuid,uuid,text,uuid)
  TO service_role;

CREATE FUNCTION public.gridex_match_e66_to_sent_e73_reference_v1(
  p_company_id uuid,p_environment text,p_actor_user_id uuid,p_reference text
) RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $match$
DECLARE candidates uuid[];
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'e66_e73_reference_forbidden' USING ERRCODE='42501'; END IF;
  IF (p_environment IN ('test','production')) IS NOT TRUE OR nullif(btrim(p_reference),'') IS NULL OR length(p_reference)>70
  THEN RAISE EXCEPTION 'e66_e73_reference_invalid_scope' USING ERRCODE='22023'; END IF;

  WITH hints AS MATERIALIZED (
    SELECT request.id AS request_id,m.id AS source_id,m.raw_payload
    FROM public.grid_owner_data_requests request
    JOIN public.ediel_messages m ON (m.company_id,m.grid_owner_data_request_id,m.metering_point_id)
      =(request.company_id,request.id,request.metering_point_id)
    LEFT JOIN public.outbound_requests o ON (o.company_id,o.id,o.source_id)=(m.company_id,m.outbound_request_id,request.id)
      AND o.source_type='grid_owner_data_request'
    WHERE request.company_id=p_company_id AND m.environment=p_environment
      AND request.request_scope IN ('meter_values','billing_underlay')
      AND m.direction='outbound' AND m.message_standard='edifact' AND m.message_family='UTILTS' AND m.message_code='E73'
      AND m.status IN ('sent','acknowledged') AND m.message_sent_at IS NOT NULL
      AND p_reference IN (request.external_reference,m.external_reference,m.transaction_reference,o.external_reference)
    LIMIT 3
  )
  SELECT CASE WHEN (SELECT count(*) FROM hints)=3 THEN
    (SELECT array_agg(DISTINCT request_id) FROM hints)
    ELSE coalesce(array_agg(DISTINCT candidate.request_id),'{}'::uuid[]) END INTO candidates
  FROM hints candidate
  WHERE candidate.source_id=ANY(gridex_utilts_binding.e73_request_candidate_ids_v1(p_company_id,candidate.request_id,p_environment))
    AND EXISTS(
      SELECT FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(candidate.raw_payload)) t
      WHERE (t->>'tag' IN ('BGM','IDE') AND t#>>'{elements,2,0}'=p_reference)
        OR (t->>'tag'='RFF' AND t#>>'{elements,1,0}'='TN' AND t#>>'{elements,1,1}'=p_reference)
    );
  RETURN candidates;
END
$match$;
REVOKE ALL ON FUNCTION public.gridex_match_e66_to_sent_e73_reference_v1(uuid,text,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_match_e66_to_sent_e73_reference_v1(uuid,text,uuid,text)
  TO service_role;
