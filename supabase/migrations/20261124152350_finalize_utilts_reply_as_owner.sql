-- One owner for ordinary and mixed UTILTS transaction-result finalization.
CREATE FUNCTION public.gridex_finalize_utilts_transaction_ack_v1(
  p_company_id uuid,
  p_environment text,
  p_source_message_id uuid,
  p_transaction_id text,
  p_response_type text,
  p_response_message_id uuid,
  p_actor_user_id uuid DEFAULT NULL,
  p_mailbox_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  result public.ediel_ack_transaction_results;
  recovery jsonb;
  finalization_time timestamptz;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'utilts_transaction_ack_finalizer_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR p_source_message_id IS NULL OR p_response_message_id IS NULL
    OR nullif(p_transaction_id,'') IS NULL OR (p_environment IN ('test','production')) IS NOT TRUE
    OR (p_response_type IN ('positive_aperak','negative_aperak','utilts_err')) IS NOT TRUE
  THEN RAISE EXCEPTION 'utilts_transaction_ack_finalizer_invalid_scope' USING ERRCODE='22023'; END IF;

  -- Take the same graph before obtaining the target ledger row as normalization does.
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  IF EXISTS (
    SELECT FROM gridex_e66_intake.work w
    WHERE (w.source_id,w.company_id,w.environment)=(p_source_message_id,p_company_id,p_environment)
      AND w.phase='mixed_qualified'
  ) THEN
    IF p_actor_user_id IS NULL OR p_mailbox_id IS NULL OR p_response_type<>'positive_aperak' THEN
      RAISE EXCEPTION 'mixed_finalizer_scope_required' USING ERRCODE='42501';
    END IF;
    recovery:=gridex_e66_intake.read_mixed_positive_recovery_v1(
      p_company_id,p_environment,p_mailbox_id,p_source_message_id,p_actor_user_id,p_transaction_id);
    IF (recovery->>'status' IN ('recovered_draft','already_finalized')) IS NOT TRUE
      OR recovery->>'ackId' IS DISTINCT FROM p_response_message_id::text
    THEN RAISE EXCEPTION 'mixed_finalization_not_ready: %',coalesce(recovery->>'reason','native_draft_mismatch')
      USING ERRCODE='55000'; END IF;
  END IF;

  finalization_time:=clock_timestamp();
  UPDATE public.ediel_ack_transaction_results a SET
    final_response_type=p_response_type,
    response_message_id=p_response_message_id,
    finalized_at=finalization_time,
    updated_at=finalization_time
  WHERE (a.company_id,a.environment,a.source_message_id,a.source_transaction_id)
    =(p_company_id,p_environment,p_source_message_id,p_transaction_id)
    AND a.finalized_at IS NULL
  RETURNING a.* INTO result;
  IF FOUND THEN RETURN jsonb_build_object('status','finalized','responseMessageId',result.response_message_id); END IF;

  SELECT a.* INTO result FROM public.ediel_ack_transaction_results a
  WHERE (a.company_id,a.environment,a.source_message_id,a.source_transaction_id)
    =(p_company_id,p_environment,p_source_message_id,p_transaction_id);
  IF result.finalized_at IS NOT NULL
    AND (result.final_response_type,result.response_message_id)=(p_response_type,p_response_message_id)
  THEN RETURN jsonb_build_object('status','already_finalized','responseMessageId',result.response_message_id); END IF;
  RETURN jsonb_build_object('status','conflict');
END
$$;
REVOKE ALL ON FUNCTION public.gridex_finalize_utilts_transaction_ack_v1(uuid,text,uuid,text,text,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_finalize_utilts_transaction_ack_v1(uuid,text,uuid,text,text,uuid,uuid,uuid)
  TO service_role;

