-- TR11: independent read of actual provider-entered MIME archive bindings.
-- Reading this copy grants no resend, delivery status or business authority.
BEGIN;
CREATE FUNCTION public.gridex_ediel_transport_copy_v1(p_company_id uuid,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ediel_messages%rowtype; copies jsonb; entered_count integer;
BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR p_message_id IS NULL THEN RAISE EXCEPTION 'ediel_transport_copy_scope_required'; END IF;
 IF NOT EXISTS(SELECT FROM public.company_memberships x WHERE x.company_id=p_company_id AND x.user_id=p_actor_user_id AND x.status='active' AND x.is_active AND x.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles x WHERE x.id=p_actor_user_id AND x.user_status='active')
 OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.read'),false) THEN RAISE EXCEPTION 'ediel_transport_copy_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE company_id=p_company_id AND id=p_message_id FOR SHARE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'outbound' THEN RAISE EXCEPTION 'ediel_transport_copy_message_unavailable' USING ERRCODE='42501'; END IF;
 WITH entered AS (
  SELECT a.id,a.company_id,a.message_id,a.environment,a.binding,a.entered_at,a.observed_at,a.classification,'generic_journal'::text lane
  FROM gridex_ediel_transport.attempts a WHERE a.company_id=m.company_id AND a.message_id=m.id AND a.environment=m.environment AND a.entered_at IS NOT NULL
  UNION ALL
  SELECT a.id,a.company_id,a.message_id,a.environment,a.binding,e.observed_at,r.observed_at,r.facts->>'classification','sealed_z08'
  FROM gridex_outbound_dispatch.attempts a
  JOIN gridex_outbound_dispatch.events e ON e.attempt_id=a.id AND e.message_id=a.message_id AND e.company_id=a.company_id AND e.environment=a.environment AND e.kind='provider_call_entered'
  LEFT JOIN gridex_outbound_dispatch.events r ON r.attempt_id=a.id AND r.message_id=a.message_id AND r.company_id=a.company_id AND r.environment=a.environment AND r.kind='provider_result'
  WHERE a.company_id=m.company_id AND a.message_id=m.id AND a.environment=m.environment
 ), qualified AS (
  SELECT e.*,p.id snapshot_id FROM entered e JOIN public.ediel_message_payloads p
   ON p.company_id=e.company_id AND p.ediel_message_id=e.message_id AND p.encrypted_payload_ref=e.binding->>'mimeArchiveRef'
   AND p.payload_kind IN ('raw_mime','smime_enveloped') AND p.metadata->>'archive_verified'='true'
   AND p.metadata->>'archived_mime_sha256'=e.binding->>'mimeSha256'
   AND p.metadata->>'archived_mime_bytes'=e.binding->>'mimeLength'
   AND p.metadata->>'archived_rfc_message_id'=e.binding->>'rfcMessageId'
  WHERE e.binding->>'mimeSha256'~'^[a-f0-9]{64}$' AND e.binding->>'mimeLength'~'^[1-9][0-9]*$'
   AND nullif(e.binding->>'rfcMessageId','') IS NOT NULL AND nullif(e.binding->>'mimeArchiveRef','') IS NOT NULL
   AND (SELECT count(*) FROM public.ediel_message_payloads other WHERE other.company_id=e.company_id AND other.ediel_message_id=e.message_id AND other.encrypted_payload_ref=e.binding->>'mimeArchiveRef' AND other.payload_kind IN ('raw_mime','smime_enveloped') AND other.metadata->>'archive_verified'='true' AND other.metadata->>'archived_mime_sha256'=e.binding->>'mimeSha256' AND other.metadata->>'archived_mime_bytes'=e.binding->>'mimeLength' AND other.metadata->>'archived_rfc_message_id'=e.binding->>'rfcMessageId')=1
  ORDER BY e.entered_at,e.id LIMIT 50
 )
 SELECT (SELECT count(*) FROM entered),coalesce(jsonb_agg(jsonb_build_object('attemptId',q.id,'lane',q.lane,'companyId',q.company_id,'messageId',q.message_id,'environment',q.environment,'mimeArchiveRef',q.binding->>'mimeArchiveRef','mimeSha256',q.binding->>'mimeSha256','mimeLength',(q.binding->>'mimeLength')::bigint,'rfcMessageId',q.binding->>'rfcMessageId','mimePayloadSnapshotId',q.snapshot_id,'enteredAt',q.entered_at,'observedAt',q.observed_at,'smtpClassification',q.classification,'archiveReadbackRequired',true) ORDER BY q.entered_at,q.id),'[]'::jsonb) INTO entered_count,copies FROM qualified q;
 RETURN jsonb_build_object('status',CASE WHEN jsonb_array_length(copies)>0 THEN 'available' WHEN entered_count>0 THEN 'held' ELSE 'unavailable' END,'companyId',m.company_id,'messageId',m.id,'environment',m.environment,'copies',copies,'blocker',CASE WHEN entered_count>0 AND jsonb_array_length(copies)=0 THEN 'entered_mime_archive_binding_not_qualified' END,'authorizesResend',false,'deliveryProven',false);
END $$;
REVOKE ALL ON FUNCTION public.gridex_ediel_transport_copy_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_transport_copy_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
