-- Supabase CLI 2.119.0 additive read-only retained result port. No birth guard,
-- immutable migration or business writer changes. Completed private receipts
-- remain evidence after authorized byte purge; raw absence grants no new effect.
BEGIN;
CREATE FUNCTION gridex_prodat_object_batch.completed_v1(c uuid,case_id uuid,source_id uuid,actor uuid,decisions jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row_case public.ediel_inbound_cases%rowtype;m public.ediel_messages%rowtype;s gridex_received_sources.sources%rowtype;r gridex_prodat_object_batch.review_receipts%rowtype;
 basis gridex_ediel_inbound_context.receipts%rowtype;plan jsonb;ctx jsonb;observed timestamptz:=clock_timestamp();n int;resolved_role text;proof jsonb;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF c IS NULL OR actor IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE user_id=actor AND company_id=c AND status='active' AND is_active AND accepted_at IS NOT NULL)
  OR NOT (public.gridex_actor_has_company_permission(actor,c,'communication.read') IS TRUE OR public.gridex_actor_has_company_permission(actor,c,'communication.write') IS TRUE)
  OR NOT (public.gridex_actor_has_company_permission(actor,c,'customers.read') IS TRUE OR public.gridex_actor_has_company_permission(actor,c,'customers.write') IS TRUE) THEN RAISE EXCEPTION 'prodat_object_batch_current_read_actor_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c AND direction='inbound' AND message_standard='edifact' AND message_family='PRODAT' FOR SHARE;
 SELECT * INTO s FROM gridex_received_sources.sources WHERE source_message_id=m.id AND company_id=c AND environment=m.environment FOR SHARE;
 SELECT * INTO row_case FROM public.ediel_inbound_cases WHERE id=case_id AND company_id=c AND ediel_message_id=source_id FOR SHARE;
 IF row_case.id IS NULL OR row_case.status<>'applied' THEN RETURN NULL;END IF;
 SELECT * INTO r FROM gridex_prodat_object_batch.review_receipts q WHERE q.company_id=c AND q.case_id=row_case.id;
 SELECT * INTO basis FROM gridex_ediel_inbound_context.receipts WHERE source_message_id=m.id AND company_id=c AND environment=m.environment;
 plan:=row_case.review_decision->'objectApplication';
 IF m.id IS NULL OR s.source_message_id IS NULL OR s.origin IS DISTINCT FROM 'database_insert' OR s.source_received_at IS DISTINCT FROM m.message_received_at OR s.received_context IS DISTINCT FROM m.execution_context_snapshot->'receivedProdatContext'
  OR s.payload_hash IS DISTINCT FROM r.source_hash OR r.source_message_id IS DISTINCT FROM m.id OR r.environment IS DISTINCT FROM m.environment OR r.actor_user_id IS DISTINCT FROM actor OR row_case.reviewed_by IS DISTINCT FROM actor OR row_case.reviewed_at IS DISTINCT FROM r.recorded_at
  OR plan->>'originalActorId' IS DISTINCT FROM actor::text OR plan->>'fingerprint' IS DISTINCT FROM r.fingerprint OR plan->>'commandHash' IS DISTINCT FROM r.command_hash OR gridex_prodat_object_batch.hash_v1(plan->'commands') IS DISTINCT FROM r.command_hash
  OR plan->>'sourceHash' IS DISTINCT FROM r.source_hash OR plan->'decisions' IS DISTINCT FROM decisions OR jsonb_typeof(plan->'commands') IS DISTINCT FROM 'array' OR jsonb_array_length(plan->'commands') NOT BETWEEN 2 AND 16
  OR jsonb_array_length(plan->'commands') IS DISTINCT FROM jsonb_array_length(plan->'receipts') OR r.assessment_id IS NULL
  OR basis.source_message_id IS NULL OR basis.status IS DISTINCT FROM 'ready' OR basis.direction IS DISTINCT FROM 'inbound' OR basis.payload_sha256 IS DISTINCT FROM r.source_hash OR basis.source_received_at IS DISTINCT FROM m.message_received_at THEN RAISE EXCEPTION 'prodat_object_batch_completed_receipt_required';END IF;
 -- A NULL body is accepted only when the native immutable tombstone seals the
 -- same public/private original and actual purge time. No byte reconstruction.
 IF m.raw_payload IS NULL THEN
  IF s.raw_payload IS NOT NULL OR s.retention_purged_at IS NULL OR NOT EXISTS(SELECT FROM gridex_ediel_retention.blob_tombstones t WHERE t.retention_class='received_ediel_message_content' AND t.target_id=m.id AND t.company_id=c AND t.source_hash=r.source_hash AND t.created_at=s.retention_purged_at) THEN RAISE EXCEPTION 'prodat_object_batch_native_byte_tombstone_required';END IF;
 ELSIF s.raw_payload IS DISTINCT FROM m.raw_payload OR encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') IS DISTINCT FROM r.source_hash THEN RAISE EXCEPTION 'prodat_object_batch_completed_original_changed';END IF;
 ctx:=basis.context;
 IF ctx->>'basisKind' IS DISTINCT FROM 'observed_source_persistence' OR ctx->>'companyId' IS DISTINCT FROM c::text OR ctx->>'environment' IS DISTINCT FROM m.environment OR ctx->>'family' IS DISTINCT FROM 'PRODAT' OR ctx->>'code' IS DISTINCT FROM m.message_code OR ctx->>'actorRole' IS DISTINCT FROM 'electricity_supplier'
  OR NOT coalesce(ctx#>'{canonicalProjection,applicationReferences}' ? (ctx->>'applicationReference'),false)
  OR NOT EXISTS(SELECT FROM public.tenant_ediel_profiles p WHERE p.id::text=ctx#>>'{facts,profile,id}' AND p.company_id=c AND p.environment=m.environment AND p.market='electricity' AND p.is_enabled AND p.valid_from<=observed AND (p.valid_to IS NULL OR observed<p.valid_to))
  OR (SELECT count(*) FROM public.tenant_ediel_profiles p WHERE p.company_id=c AND p.environment=m.environment AND p.market='electricity' AND p.is_enabled AND p.valid_from<=observed AND(p.valid_to IS NULL OR observed<p.valid_to))<>1 THEN RAISE EXCEPTION 'prodat_object_batch_current_captured_role_required';END IF;
 SELECT count(DISTINCT role_code),min(role_code) INTO n,resolved_role FROM public.tenant_actor_roles WHERE company_id=c AND environment=m.environment AND actor_id::text=ctx->>'legalActorId' AND valid_from<=observed AND(valid_to IS NULL OR observed<valid_to) AND(ctx#>'{canonicalProjection,receiverRoles}' ? role_code OR ctx#>'{canonicalProjection,receiverRoles}' ? CASE role_code WHEN 'electricity_supplier' THEN 'supplier' ELSE role_code END);
 IF n<>1 OR resolved_role IS DISTINCT FROM ctx->>'actorRole' THEN RAISE EXCEPTION 'prodat_object_batch_current_captured_role_required';END IF;
 PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(ctx);
 proof:=jsonb_build_object('sourcePayloadHash',r.source_hash);
 PERFORM gridex_prodat_object_batch.require_review_v1(row_case,plan,jsonb_build_object('sourceMessage',jsonb_build_object('environment',m.environment),'sourcePayloadHash',r.source_hash),actor);
 PERFORM gridex_prodat_object_batch.require_receipts_v1(row_case,plan,proof);
 IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments a WHERE a.id=r.assessment_id AND a.company_id=c AND a.environment=m.environment AND a.source_message_id=m.id AND a.source_payload_hash=r.source_hash) THEN RAISE EXCEPTION 'prodat_object_batch_completed_assessment_required';END IF;
 RETURN to_jsonb(row_case);
END $$;
CREATE FUNCTION public.ediel_read_completed_prodat_object_batch_v1(p_company_id uuid,p_case_id uuid,p_source_message_id uuid,p_actor_user_id uuid,p_decisions jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_prodat_object_batch.require_service_v1();RETURN gridex_prodat_object_batch.completed_v1(p_company_id,p_case_id,p_source_message_id,p_actor_user_id,p_decisions);END$$;
REVOKE ALL ON FUNCTION gridex_prodat_object_batch.completed_v1(uuid,uuid,uuid,uuid,jsonb),public.ediel_read_completed_prodat_object_batch_v1(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_read_completed_prodat_object_batch_v1(uuid,uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;
