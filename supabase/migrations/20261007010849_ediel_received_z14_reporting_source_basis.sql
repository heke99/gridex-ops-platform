-- AT-Z14V-ESCO: receiver-local reporting knowledge from the actual sent request.
-- READ only. Historical assignment/review scope is not current send authority.
BEGIN;
CREATE FUNCTION gridex_received_sources.received_z14_reporting_source_basis_v1(p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $reader$
DECLARE
 m public.ediel_messages%rowtype;s gridex_received_sources.sources%rowtype;
 z public.ediel_messages%rowtype;o gridex_service_permission.origins%rowtype;
 e public.ediel_service_evidence%rowtype;a gridex_ediel_services.artifacts%rowtype;
 v gridex_ediel_services.reviews%rowtype;latest gridex_ediel_services.reviews%rowtype;
 wire jsonb;tokens jsonb;env jsonb;original_wire jsonb;original_tokens jsonb;original_env jsonb;
 own jsonb;original_own jsonb;customer_party jsonb;original_customer jsonb;
 scope jsonb;birth_context jsonb;legal_context jsonb;accepted jsonb;known jsonb;
 result jsonb:='[]';held jsonb:='[]';missing text[];evidence_kind text;
 original_ids uuid[];origin_count integer;line_index integer:=0;known_service boolean:=false;
 basis_version bigint;recorded timestamptz;clock_at timestamptz:=clock_timestamp();
 source_end timestamptz;term jsonb;purpose jsonb;source_evidence uuid;qualified_evidence boolean;
 end_review timestamptz;end_archive timestamptz;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'received_reporting_service_required' USING ERRCODE='42501';END IF;
 IF p_source_message_id IS NULL OR p_actor_user_id IS NULL THEN RAISE EXCEPTION 'received_reporting_actor_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id;
 IF m.id IS NULL THEN RETURN NULL;END IF;
 -- Reuse the existing READ graph lock before actor/current-revocation reads.
 -- It conveys no send/assessment authority and never changes domain rows.
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
 IF NOT EXISTS(SELECT FROM public.companies c WHERE c.id=m.company_id AND c.status='active')
 OR NOT EXISTS(SELECT FROM auth.users u WHERE u.id=p_actor_user_id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_at))
 OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
 OR NOT (coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'ediel.read'),false) OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'communication.read'),false))
 THEN RAISE EXCEPTION 'received_reporting_read_actor_forbidden' USING ERRCODE='42501';END IF;
 IF m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z14' THEN RETURN NULL;END IF;
 SELECT * INTO s FROM gridex_received_sources.sources WHERE source_message_id=m.id AND company_id=m.company_id;
 birth_context:=s.received_context;
 known:=jsonb_build_object('companyId',m.company_id,'sourceMessageId',m.id,'environment',m.environment,'sourcePayloadHash',s.payload_hash,'sourceReceivedAt',s.source_received_at,'sourceReceivedContext',birth_context,
  'sourceContextHash',encode(sha256(convert_to(birth_context::text,'UTF8')),'hex'),'actorUserId',p_actor_user_id,'evaluationUtcMs',floor(extract(epoch FROM clock_at)*1000)::bigint);
 IF s.source_message_id IS NULL OR s.origin IS DISTINCT FROM 'database_insert' OR s.environment IS DISTINCT FROM m.environment OR s.message_code IS DISTINCT FROM 'Z14'
 OR s.raw_payload IS NULL OR s.raw_payload IS DISTINCT FROM m.raw_payload OR s.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
 OR s.source_received_at IS NULL OR NOT isfinite(s.source_received_at) OR s.source_received_at>clock_at OR s.captured_at IS NULL OR NOT isfinite(s.captured_at) OR s.captured_at<s.source_received_at OR s.captured_at>clock_at
 OR birth_context IS NULL OR birth_context IS DISTINCT FROM m.execution_context_snapshot->'receivedProdatContext'
 OR birth_context->'version' IS DISTINCT FROM '1'::jsonb OR birth_context->>'contextOrigin' IS DISTINCT FROM 'database_insert'
 OR birth_context->>'sourceMessageId' IS DISTINCT FROM m.id::text OR birth_context->>'companyId' IS DISTINCT FROM m.company_id::text
 OR birth_context->>'messageCode' IS DISTINCT FROM 'Z14' OR birth_context->>'environment' IS DISTINCT FROM m.environment OR birth_context->>'payloadHash' IS DISTINCT FROM s.payload_hash
 OR (birth_context->>'sourceReceivedAt')::timestamptz IS DISTINCT FROM s.source_received_at OR (birth_context->>'capturedAt') IS NULL OR NOT isfinite((birth_context->>'capturedAt')::timestamptz)
 OR (birth_context->>'capturedAt')::timestamptz<s.source_received_at OR (birth_context->>'capturedAt')::timestamptz>s.captured_at
 OR m.message_received_at IS DISTINCT FROM s.source_received_at
 THEN RETURN known||jsonb_build_object('status','held','objects','[]'::jsonb,'heldObjects','[]'::jsonb,'missing',ARRAY['immutable_received_reporting_scope_required']);END IF;
 wire:=gridex_received_sources.permission_partition_wire_v1(m.raw_payload);tokens:=gridex_received_sources.closure_wire_tokens_v2(m.raw_payload);env:=gridex_ediel_technical_ack.envelope(m.raw_payload);
 IF wire IS NULL OR tokens IS NULL OR env IS NULL OR wire->>'code' IS DISTINCT FROM 'Z14' OR env->>'environment' IS DISTINCT FROM m.environment
 THEN RETURN known||jsonb_build_object('status','held','objects','[]'::jsonb,'heldObjects','[]'::jsonb,'missing',ARRAY['complete_received_reporting_wire_required']);END IF;
 FOR own IN SELECT value FROM jsonb_array_elements(wire->'objects') LOOP
  -- Negative objects have no positive reporting fields. Their existing owner
  -- remains authoritative; they never acquire private/bounded requiredness.
  IF own->>'reason'='Z96' THEN line_index:=line_index+1;CONTINUE;END IF;
  customer_party:=NULL;
  SELECT jsonb_agg(t->'elements'->2)->0 INTO customer_party FROM jsonb_array_elements(tokens)t
   WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD' AND (t->>'index')::int>(own->>'firstLineIndex')::int
   AND (t->>'index')::int<coalesce((SELECT min((n->>'index')::int) FROM jsonb_array_elements(tokens)n WHERE n->>'tag'='LIN' AND (n->>'index')::int>(own->>'firstLineIndex')::int),2147483647)
   HAVING count(*)=1;
  scope:=jsonb_build_object('lineIndex',line_index,'objectId',own->'point','identityAgency',own->'identityAgency','lineItemReference',own->'li','customer',jsonb_build_object('id',customer_party->>0,'qualifier',customer_party->>1,'agency',customer_party->>2),'reason',own->'reason');
  missing:=ARRAY[]::text[];
  IF own->>'projectionHeld'='true' OR nullif(own->>'point','') IS NULL OR (own->>'identityAgency' IN('9','89')) IS NOT TRUE OR nullif(own->>'li','') IS NULL
   OR (own->>'reason' IN('S17','S18')) IS NOT TRUE OR own->>'status' IS DISTINCT FROM 'A74' OR jsonb_array_length(customer_party) IS DISTINCT FROM 3 OR (customer_party->>1 IN('SE1','SE2')) IS NOT TRUE OR customer_party->>2 IS DISTINCT FROM '260'
  THEN held:=held||jsonb_build_array(jsonb_build_object('scope',scope,'missing',ARRAY['complete_own_received_reporting_identity_required']));line_index:=line_index+1;CONTINUE;END IF;
  -- The immutable origin's message/intent LI selects a possible service source;
  -- mutable permission status or live assignment version is never a selector.
  SELECT array_agg(zm.id ORDER BY zm.id) INTO original_ids FROM gridex_service_permission.origins so JOIN public.ediel_messages zm ON zm.id=so.message_id
   WHERE so.company_id=m.company_id AND so.message_code='Z13' AND zm.transaction_reference=own->>'li';
  IF coalesce(cardinality(original_ids),0)=0 THEN line_index:=line_index+1;CONTINUE;END IF;
  known_service:=true;
  -- Service-only legal facts are read only after an independent immutable
  -- service-origin candidate exists. Unrelated local U needs no such authority.
  legal_context:=gridex_ediel_ack_replay.require_current_source_role_v2(m.company_id,m.environment,m.id);
  IF legal_context->>'actorRole' IS DISTINCT FROM 'energy_service_company' OR wire->>'receiver' IS DISTINCT FROM legal_context->>'legalEdielId'
  THEN RETURN known||jsonb_build_object('status','held','objects','[]'::jsonb,'heldObjects','[]'::jsonb,'missing',ARRAY['current_received_reporting_legal_role_required']);END IF;
  IF cardinality(original_ids)<>1 THEN missing:=array_append(missing,'unique_immutable_service_original_required');
  ELSE
   SELECT * INTO z FROM public.ediel_messages WHERE id=original_ids[1];
   SELECT count(*) INTO origin_count FROM gridex_service_permission.origins WHERE message_id=z.id AND company_id=m.company_id;
   IF origin_count<>1 THEN missing:=array_append(missing,'unique_immutable_service_origin_required');
   ELSE
    SELECT * INTO o FROM gridex_service_permission.origins WHERE message_id=z.id AND company_id=m.company_id;
    IF z.company_id IS DISTINCT FROM m.company_id OR z.environment IS DISTINCT FROM m.environment OR z.direction IS DISTINCT FROM 'outbound' OR z.message_standard IS DISTINCT FROM 'edifact' OR z.message_family IS DISTINCT FROM 'PRODAT' OR z.message_code IS DISTINCT FROM 'Z13'
     OR (z.status IN('sent','acknowledged')) IS NOT TRUE OR z.message_sent_at IS NULL OR NOT isfinite(z.message_sent_at) OR z.message_sent_at>s.source_received_at OR z.message_sent_at<z.immutable_rendered_at OR z.immutable_rendered_at IS NULL OR NOT isfinite(z.immutable_rendered_at) OR z.raw_payload IS NULL
     OR z.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(z.raw_payload,'UTF8')),'hex') OR o.intent_id IS DISTINCT FROM z.intent_id
     OR o.basis->>'code' IS DISTINCT FROM 'Z13' OR o.basis->>'status' IS DISTINCT FROM 'authorized' OR o.basis->>'companyId' IS DISTINCT FROM m.company_id::text OR o.basis->>'environment' IS DISTINCT FROM m.environment
     OR o.basis->>'assignmentId' IS DISTINCT FROM o.assignment_id::text OR o.basis->>'permissionId' IS DISTINCT FROM o.permission_id::text OR o.basis->>'customerId' IS DISTINCT FROM z.customer_id::text
     OR o.created_at IS NULL OR NOT isfinite(o.created_at) OR o.created_at>z.immutable_rendered_at
    THEN missing:=array_append(missing,'sealed_sent_immutable_service_original_required');
    ELSE
     accepted:=gridex_ediel_transport.accepted_source_basis_v1(z);
     IF accepted IS NULL OR accepted->>'status' IS DISTINCT FROM 'accepted_projection' OR accepted->>'messageId' IS DISTINCT FROM z.id::text OR accepted->>'companyId' IS DISTINCT FROM m.company_id::text OR accepted->>'environment' IS DISTINCT FROM m.environment OR accepted->>'originalHash' IS DISTINCT FROM z.immutable_payload_hash
      OR nullif(accepted->>'observedAt','') IS NULL OR NOT isfinite((accepted->>'observedAt')::timestamptz) OR (accepted->>'observedAt')::timestamptz<z.immutable_rendered_at OR (accepted->>'observedAt')::timestamptz>s.source_received_at
     THEN missing:=array_append(missing,'actual_unique_accepted_original_before_receive_required');END IF;
     original_wire:=gridex_received_sources.permission_partition_wire_v1(z.raw_payload);original_tokens:=gridex_received_sources.closure_wire_tokens_v2(z.raw_payload);original_env:=gridex_ediel_technical_ack.envelope(z.raw_payload);
     original_own:=NULL;original_customer:=NULL;
     SELECT jsonb_agg(x)->0 INTO original_own FROM jsonb_array_elements(original_wire->'objects')x WHERE x->>'li'=own->>'li' HAVING count(*)=1;
     IF original_own IS NOT NULL THEN
      SELECT jsonb_agg(t->'elements'->2)->0 INTO original_customer FROM jsonb_array_elements(original_tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD' AND (t->>'index')::int>(original_own->>'firstLineIndex')::int
       AND (t->>'index')::int<coalesce((SELECT min((n->>'index')::int) FROM jsonb_array_elements(original_tokens)n WHERE n->>'tag'='LIN' AND (n->>'index')::int>(original_own->>'firstLineIndex')::int),2147483647) HAVING count(*)=1;
     END IF;
     IF original_wire IS NULL OR original_env IS NULL OR original_own IS NULL OR original_own->>'projectionHeld'='true' OR original_wire->>'code' IS DISTINCT FROM 'Z13'
      OR wire->>'sender' IS DISTINCT FROM original_wire->>'receiver' OR wire->>'receiver' IS DISTINCT FROM original_wire->>'sender'
      OR original_wire->>'sender' IS DISTINCT FROM o.basis->>'legalSenderId' OR original_wire->>'receiver' IS DISTINCT FROM o.basis->>'legalReceiverId'
      OR env->'sender' IS DISTINCT FROM original_env->'receiver' OR env->'receiver' IS DISTINCT FROM original_env->'sender' OR env->>'applicationReference' IS DISTINCT FROM original_env->>'applicationReference' OR env->>'environment' IS DISTINCT FROM original_env->>'environment'
      OR original_customer IS DISTINCT FROM customer_party OR nullif(customer_party->>0,'') IS NULL
      OR original_customer IS DISTINCT FROM (CASE WHEN nullif(o.basis#>>'{customer,org_number}','') IS NOT NULL THEN jsonb_build_array(o.basis#>>'{customer,org_number}','SE1','260') WHEN nullif(o.basis#>>'{customer,personal_number}','') IS NOT NULL THEN jsonb_build_array(o.basis#>>'{customer,personal_number}','SE2','260') ELSE NULL END)
      OR original_own->>'reason' IS DISTINCT FROM own->>'reason' OR original_own->>'reason' IS DISTINCT FROM (CASE o.basis->>'mode' WHEN 'V' THEN 'S17' WHEN 'VH' THEN 'S18' ELSE NULL END)
      OR original_own->>'purpose' IS DISTINCT FROM o.basis->>'purposeCode'
     THEN missing:=array_append(missing,'exact_independent_original_reporting_identity_required');END IF;
     IF (o.basis->>'scopeBasisVersion') ~ '^[1-9][0-9]{0,17}$' THEN basis_version:=(o.basis->>'scopeBasisVersion')::bigint;ELSE basis_version:=NULL;END IF;
     SELECT sv.scope,sv.recorded_at INTO scope,recorded FROM gridex_service_administration.scope_versions sv WHERE sv.company_id=m.company_id AND sv.assignment_id=o.assignment_id AND sv.scope_basis_version=basis_version;
     IF scope IS NULL OR recorded IS NULL OR NOT isfinite(recorded) OR recorded>o.created_at OR scope->>'companyId' IS DISTINCT FROM m.company_id::text OR scope->>'customerId' IS DISTINCT FROM o.basis->>'customerId'
      OR scope->>'environment' IS DISTINCT FROM m.environment OR scope->>'providerActorId' IS DISTINCT FROM o.basis->>'providerActorId' OR scope->>'dsoActorId' IS DISTINCT FROM o.basis->>'dsoActorId' OR scope->>'mode' IS DISTINCT FROM o.basis->>'mode'
      OR scope->>'providerActorId' IS DISTINCT FROM legal_context->>'legalActorId'
     THEN missing:=array_append(missing,'exact_historical_assignment_scope_required');END IF;
     IF (o.basis->>'evidenceId') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN source_evidence:=(o.basis->>'evidenceId')::uuid;ELSE source_evidence:=NULL;END IF;
     end_review:=NULL;end_archive:=NULL;
     FOREACH evidence_kind IN ARRAY ARRAY['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'] LOOP
      qualified_evidence:=false;
      FOR e IN SELECT ev.* FROM public.ediel_service_evidence ev WHERE ev.company_id=m.company_id AND ev.assignment_id=o.assignment_id AND ev.kind=evidence_kind AND (evidence_kind<>'end_user_contract' OR ev.id=source_evidence) LOOP
       IF e.status IS DISTINCT FROM 'verified' THEN CONTINUE;END IF;
       SELECT * INTO latest FROM gridex_ediel_services.reviews rv WHERE rv.company_id=m.company_id AND rv.evidence_id=e.id ORDER BY rv.review_sequence DESC LIMIT 1;
       IF latest.id IS NULL OR latest.decision IS DISTINCT FROM 'approved' OR latest.reviewed_at>clock_at
        OR e.approved_by IS DISTINCT FROM latest.reviewer_user_id OR e.approved_at IS DISTINCT FROM latest.reviewed_at OR e.approved_assignment_version IS DISTINCT FROM latest.scope_basis_version
        OR latest.evidence_basis IS DISTINCT FROM gridex_ediel_services.evidence_basis_v1(e)
        OR gridex_ediel_services.actor_current_v1(m.company_id,latest.reviewer_user_id,true) IS NOT TRUE
        OR NOT EXISTS(SELECT FROM auth.users u WHERE u.id=latest.reviewer_user_id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_at)) THEN CONTINUE;END IF;
       FOR v IN SELECT rv.* FROM gridex_ediel_services.reviews rv WHERE rv.company_id=m.company_id AND rv.evidence_id=e.id AND rv.scope_basis_version=basis_version AND rv.decision='approved' AND rv.reviewed_at<=o.created_at ORDER BY rv.review_sequence DESC LOOP
        SELECT * INTO a FROM gridex_ediel_services.artifacts ar WHERE ar.id=v.artifact_id AND ar.company_id=m.company_id;
        IF a.id IS NULL OR a.environment IS DISTINCT FROM m.environment OR a.assignment_id IS DISTINCT FROM o.assignment_id OR a.scope_basis_version IS DISTINCT FROM basis_version OR a.scope IS DISTINCT FROM scope
         OR a.scope_hash IS DISTINCT FROM encode(sha256(convert_to(a.scope::text,'UTF8')),'hex') OR a.evidence_kind IS DISTINCT FROM evidence_kind
         OR a.source_hash IS DISTINCT FROM encode(sha256(a.source_bytes),'hex') OR a.source_hash IS DISTINCT FROM e.source_sha256 OR a.source_reference IS DISTINCT FROM e.source_reference OR a.source_version IS DISTINCT FROM e.source_version
         OR a.evidence_terms IS DISTINCT FROM gridex_ediel_services.evidence_terms_v1(e) OR v.evidence_basis IS DISTINCT FROM gridex_ediel_services.evidence_basis_v1(e)
         OR a.archived_at IS NULL OR NOT isfinite(a.archived_at) OR a.archived_at>v.reviewed_at OR v.reviewed_at IS NULL OR NOT isfinite(v.reviewed_at)
         OR NOT EXISTS(SELECT FROM auth.users u WHERE u.id=v.reviewer_user_id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_at))
         OR gridex_ediel_services.actor_current_v1(m.company_id,v.reviewer_user_id,true) IS NOT TRUE
         OR v.reviewer_user_id=a.submitted_by OR NOT EXISTS(SELECT FROM gridex_service_administration.commands stage WHERE stage.command_id=v.stage_command_id AND stage.company_id=m.company_id AND stage.input->>'action'='stage_evidence' AND stage.result->>'evidenceId'=e.id::text AND stage.actor_user_id<>v.reviewer_user_id AND stage.created_at<=v.reviewed_at)
         OR gridex_ediel_services.receipt_current_v1(a) IS NOT TRUE THEN CONTINUE;END IF;
        IF evidence_kind='end_user_contract' AND (e.source_sha256 IS DISTINCT FROM o.basis->>'evidenceSha256' OR e.source_version IS DISTINCT FROM o.basis->>'evidenceVersion'
         OR e.permission_customer_classification IS DISTINCT FROM o.basis->>'customerClassification' OR e.permission_reporting_term_kind IS DISTINCT FROM o.basis->>'reportingTerm' OR e.permission_purpose_code IS DISTINCT FROM o.basis->>'purposeCode') THEN CONTINUE;END IF;
        qualified_evidence:=true;IF evidence_kind='end_user_contract' THEN end_review:=v.reviewed_at;end_archive:=a.archived_at;END IF;EXIT;
       END LOOP;
       IF qualified_evidence THEN EXIT;END IF;
      END LOOP;
      IF NOT qualified_evidence THEN missing:=array_append(missing,'historical_review:'||evidence_kind);END IF;
     END LOOP;
     IF (o.basis->>'customerClassification' IN('private','nonprivate')) IS NOT TRUE OR (o.basis->>'reportingTerm' IN('bounded','indefinite')) IS NOT TRUE
      OR (o.basis->>'customerClassification'='private' AND nullif(o.basis->>'purposeCode','') IS NULL)
      OR (o.basis->>'purposeCode' IS NOT NULL AND (o.basis->>'purposeCode' IN('B71','B72','B73','B74','B75','B76')) IS NOT TRUE)
     THEN missing:=array_append(missing,'explicit_historical_classification_and_reporting_terms_required');END IF;
     IF o.basis->>'reportingTerm'='bounded' THEN
      source_end:=gridex_received_sources.permission_time_v1(original_own->>'reportEnd');
      IF source_end IS NULL OR source_end IS DISTINCT FROM (scope->>'dataEnd')::timestamptz OR source_end IS DISTINCT FROM (o.basis#>>'{objects,0,reportEnd}')::timestamptz THEN missing:=array_append(missing,'independent_bounded_reporting_end_required');END IF;
      term:=jsonb_build_object('kind','bounded','endMinute',original_own->>'reportEnd');
     ELSE
      IF original_own->>'reportEnd' IS NOT NULL OR scope->>'dataEnd' IS NOT NULL OR o.basis#>>'{objects,0,reportEnd}' IS NOT NULL THEN missing:=array_append(missing,'explicit_indefinite_reporting_term_required');END IF;
      term:=jsonb_build_object('kind','indefinite');
     END IF;
     purpose:=CASE WHEN o.basis->>'purposeCode' IS NULL THEN jsonb_build_object('kind','absent') ELSE jsonb_build_object('kind','present','code',o.basis->>'purposeCode') END;
    END IF;
   END IF;
  END IF;
  -- Rebuild the response selector: historical scope was used above only to
  -- qualify source provenance, never to copy installation/values into a reply.
  scope:=jsonb_build_object('lineIndex',line_index,'objectId',own->'point','identityAgency',own->'identityAgency','lineItemReference',own->'li','customer',jsonb_build_object('id',customer_party->>0,'qualifier',customer_party->>1,'agency',customer_party->>2),'reason',own->'reason');
  IF cardinality(missing)>0 THEN held:=held||jsonb_build_array(jsonb_build_object('scope',scope,'missing',missing));
  ELSE result:=result||jsonb_build_array(jsonb_build_object('scope',scope,'classification',o.basis->>'customerClassification','term',term,'purpose',purpose,'original',jsonb_build_object('messageId',z.id,'payloadHash',z.immutable_payload_hash,'originIntentId',o.intent_id,'assignmentId',o.assignment_id,'permissionId',o.permission_id,'scopeBasisVersion',basis_version,'acceptedAttemptId',accepted->>'attemptId','acceptedObservedAt',accepted->>'observedAt','originCreatedAt',o.created_at,'sealedAt',z.immutable_rendered_at,'evidenceId',source_evidence,'evidenceSha256',o.basis->>'evidenceSha256','evidenceVersion',o.basis->>'evidenceVersion','evidenceReviewedAt',end_review,'evidenceArchivedAt',end_archive)));END IF;
  line_index:=line_index+1;
 END LOOP;
 IF NOT known_service AND jsonb_array_length(held)=0 THEN RETURN NULL;END IF;
 RETURN known||jsonb_build_object('status',CASE WHEN jsonb_array_length(result)>0 THEN 'qualified' ELSE 'held' END,'objects',result,'heldObjects',held);
END $reader$;
REVOKE ALL ON FUNCTION gridex_received_sources.received_z14_reporting_source_basis_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.gridex_ediel_received_z14_reporting_source_basis_v1(p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT gridex_received_sources.received_z14_reporting_source_basis_v1(p_source_message_id,p_actor_user_id)
$$;
REVOKE ALL ON FUNCTION public.gridex_ediel_received_z14_reporting_source_basis_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_received_z14_reporting_source_basis_v1(uuid,uuid) TO service_role;
COMMIT;
