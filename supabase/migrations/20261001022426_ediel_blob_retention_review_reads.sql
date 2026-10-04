-- Authenticated class-bound review reads for the actual immutable legal bytes.
-- No source/MIME bytes, issuer, period, grant or approved decision is seeded.
BEGIN;
CREATE FUNCTION public.ediel_read_blob_retention_decision_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid,p_include_document boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.blob_decisions%rowtype;t gridex_ediel_retention.blob_tombstones%rowtype;permission text;reviews jsonb;current_review uuid;basis jsonb;physical boolean:=false;
BEGIN
 -- actor_v1 takes the authorization registry locks. Never trust a browser's
 -- selected class, actor, reviewer outcome or prior HTTP authorization check.
 IF gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'ediel.retention.review') IS TRUE THEN permission:='ediel.retention.review';
 ELSIF NOT p_include_document AND gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'ediel.retention.submit') IS TRUE THEN permission:='ediel.retention.submit';
 ELSIF NOT p_include_document AND gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'ediel.retention.purge') IS TRUE THEN permission:='ediel.retention.purge';
 ELSE RAISE EXCEPTION 'retention_current_read_grant_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,permission);
 SELECT * INTO STRICT d FROM gridex_ediel_retention.blob_decisions WHERE company_id=p_company_id AND id=p_decision_id FOR SHARE;
 IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_grant_required' USING ERRCODE='42501';END IF;
 IF encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash THEN RAISE EXCEPTION 'retention_actual_document_hash_required';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('reviewId',r.id,'actorUserId',r.actor_user_id,'outcome',r.outcome,'reason',r.reason,'createdAt',r.created_at) ORDER BY r.created_at,r.id),'[]') INTO reviews FROM gridex_ediel_retention.blob_reviews r WHERE r.decision_id=d.id;
 SELECT * INTO t FROM gridex_ediel_retention.blob_tombstones WHERE company_id=p_company_id AND decision_id=d.id AND retention_class=d.retention_class AND target_id=d.target_id FOR SHARE;
 current_review:=gridex_ediel_retention.blob_current_v1(d);
 IF t.target_id IS NULL AND current_review IS NOT NULL THEN
  BEGIN
   basis:=gridex_ediel_retention.blob_basis_v1(p_company_id,d.retention_class,d.target_id);
   IF basis->>'targetHash' IS DISTINCT FROM d.target_hash OR basis->>'sourceHash' IS DISTINCT FROM d.source_hash THEN current_review:=NULL;END IF;
  EXCEPTION WHEN no_data_found OR raise_exception THEN current_review:=NULL;END;
 ELSIF t.target_id IS NOT NULL THEN current_review:=NULL;END IF;
 IF t.target_id IS NOT NULL THEN
  IF d.retention_class='transport_raw_mime_bytes' THEN
   physical:=EXISTS(SELECT FROM gridex_ediel_retention.blob_events WHERE retention_class=d.retention_class AND target_id=d.target_id AND kind='physical_bytes_removed');
  ELSE
   physical:=EXISTS(SELECT FROM gridex_received_sources.sources s JOIN public.ediel_messages m ON m.company_id=s.company_id AND m.id=s.source_message_id WHERE s.company_id=p_company_id AND s.source_message_id=d.message_id AND s.raw_payload IS NULL AND s.retention_purged_at IS NOT NULL AND m.raw_payload IS NULL AND m.parsed_payload='{}'::jsonb AND m.validation_report='{}'::jsonb AND m.metadata='{}'::jsonb)
    AND NOT EXISTS(SELECT FROM public.ediel_message_payloads p WHERE p.company_id=p_company_id AND p.ediel_message_id=d.message_id AND (p.raw_payload IS NOT NULL OR p.encrypted_payload IS NOT NULL));
  END IF;
 END IF;
 RETURN jsonb_build_object('companyId',d.company_id,'decisionId',d.id,'retentionClass',d.retention_class,'targetId',d.target_id,'messageId',d.message_id,'sourceHash',d.source_hash,'targetHash',d.target_hash,'documentHash',d.document_hash,'documentByteLength',octet_length(d.document_bytes),'submittedBy',d.submitted_by,'createdAt',d.created_at,
 'issuerQualified',gridex_ediel_retention.blob_receipt_v1(d) IS NOT NULL,'currentQualified',current_review IS NOT NULL,'revoked',EXISTS(SELECT FROM gridex_ediel_retention.blob_revocations WHERE decision_id=d.id),'reviews',reviews,
 'purge',CASE WHEN t.target_id IS NULL THEN NULL ELSE jsonb_build_object('createdAt',t.created_at,'byteLength',t.byte_length,'physicalBytesRemoved',physical) END,
 'documentBase64',CASE WHEN p_include_document THEN replace(encode(d.document_bytes,'base64'),E'\n','') ELSE NULL END);
END$$;
-- Revocation requires the actual immutable decision's class in the same
-- native transaction. A preceding metadata read is not the write authority.
ALTER FUNCTION public.ediel_revoke_blob_retention_v1(uuid,uuid,uuid,text) RENAME TO ediel_revoke_blob_retention_before_class_guard_v1;
REVOKE ALL ON FUNCTION public.ediel_revoke_blob_retention_before_class_guard_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_revoke_blob_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.blob_decisions%rowtype;
BEGIN
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.review');
 SELECT * INTO STRICT d FROM gridex_ediel_retention.blob_decisions WHERE company_id=p_company_id AND id=p_decision_id FOR UPDATE;
 IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_grant_required' USING ERRCODE='42501';END IF;
 PERFORM public.ediel_revoke_blob_retention_before_class_guard_v1(p_company_id,p_actor_user_id,p_decision_id,p_reason);
END$$;
ALTER FUNCTION public.ediel_read_blob_retention_decision_v1(uuid,uuid,uuid,boolean) OWNER TO gridex_ediel_retention_owner;
ALTER FUNCTION public.ediel_revoke_blob_retention_v1(uuid,uuid,uuid,text) OWNER TO gridex_ediel_retention_owner;
REVOKE ALL ON FUNCTION public.ediel_read_blob_retention_decision_v1(uuid,uuid,uuid,boolean),public.ediel_revoke_blob_retention_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_read_blob_retention_decision_v1(uuid,uuid,uuid,boolean),public.ediel_revoke_blob_retention_v1(uuid,uuid,uuid,text) TO authenticated;
COMMIT;
