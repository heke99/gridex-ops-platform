DO $migration$
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
      WHERE oid=to_regprocedure('public.gridex_commit_e66_registration_rejection_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)'))
      IS DISTINCT FROM '2dd4df44a9c874823263e7e180ccc76d55fa86d20cb3705968685787d9808614'
    OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
      WHERE oid=to_regprocedure('public.gridex_finish_e66_registration_rejection_v1(uuid,text,uuid,uuid,uuid,uuid)'))
      IS DISTINCT FROM 'babadcf9c25f8e85763619ecc112473ee74c5e6ad1c90073d54e96ff3754de8f'
  THEN RAISE EXCEPTION 'e66_offset_rejection_predecessor_changed' USING ERRCODE='55000'; END IF;
END
$migration$;
-- A physically invalid E66 header is a negative intake decision, not a meter value.
ALTER TABLE gridex_e66_intake.registration_rejections
  ADD COLUMN rejection_reason text NOT NULL DEFAULT 'UTILTS_E66_REGISTRATION_DATE_INVALID',
  ADD COLUMN related_request_id uuid,
  ADD COLUMN request_original_id uuid,
  ADD COLUMN request_original_sha256 text,
  ADD COLUMN request_range tstzrange,
  ADD COLUMN unresolved_item_id uuid,
  ADD CONSTRAINT e66_rejection_reason_supported CHECK (
    rejection_reason IN ('UTILTS_E66_REGISTRATION_DATE_INVALID','UTILTS_TIMEZONE_INVALID')
  ),
  ADD CONSTRAINT e66_rejected_request_shape CHECK (
    (related_request_id IS NULL AND request_original_id IS NULL AND request_original_sha256 IS NULL AND request_range IS NULL)
    OR (rejection_reason='UTILTS_TIMEZONE_INVALID' AND related_request_id IS NOT NULL AND request_original_id IS NOT NULL
      AND request_original_sha256 ~ '^[0-9a-f]{64}$' AND request_range IS NOT NULL AND NOT isempty(request_range))
  );

CREATE FUNCTION gridex_e66_intake.require_offset_conflict_v1(p_company uuid,p_source uuid,p_raw text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $header$
DECLARE
  header jsonb;
  count_all integer;
  count_valid integer;
  count_distinct integer;
BEGIN
  header:=gridex_received_sources.require_utilts_header_v1(p_company,p_source);
  WITH declarations AS (
    SELECT token#>'{elements,1}' AS parts
    FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(p_raw)) token
    WHERE token->>'tag'='DTM' AND token#>>'{elements,1,0}'='735'
  ), offsets AS (
    SELECT CASE
      WHEN jsonb_array_length(parts)=3 AND parts->>2='406'
        AND parts->>1 ~ '^[+-](0[0-9]|1[0-3])[0-5][0-9]$|^[+-]1400$'
      THEN (CASE left(parts->>1,1) WHEN '-' THEN -1 ELSE 1 END)
        * (substring(parts->>1 from 2 for 2)::integer*60+right(parts->>1,2)::integer)
    END AS minutes FROM declarations
  )
  SELECT count(*),count(minutes),count(DISTINCT minutes) INTO count_all,count_valid,count_distinct FROM offsets;
  IF header->>'sourcePayloadHash' IS DISTINCT FROM encode(sha256(convert_to(p_raw,'UTF8')),'hex')
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(header->'applicationErrors') issue
      WHERE (issue->>'ercCode',issue->>'fieldCode')=('42','206'))
    OR count_all<>count_valid OR count_distinct<2
  THEN RAISE EXCEPTION 'e66_offset_conflict_original_required' USING ERRCODE='55000'; END IF;
END
$header$;
REVOKE ALL ON FUNCTION gridex_e66_intake.require_offset_conflict_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Correlation deliberately uses the physical ACW, the accepted outgoing copy
-- and its period. No incoming timestamp or fallback request can prove scope.
CREATE FUNCTION gridex_e66_intake.offset_rejection_request_v1(p_company uuid,p_environment text,p_source uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog SET TimeZone='UTC' AS $scope$
DECLARE
  received public.ediel_messages;
  outgoing public.ediel_messages;
  request public.grid_owner_data_requests;
  incoming_wire jsonb;
  outgoing_wire jsonb;
  tokens jsonb;
  origin_refs text[];
  request_ids uuid[];
  original_ids uuid[];
  requested_range tstzrange;
  external_point text;
BEGIN
  SELECT m.* INTO STRICT received FROM public.ediel_messages m
  WHERE (m.company_id,m.environment,m.id)=(p_company,p_environment,p_source) FOR SHARE;
  tokens:=gridex_utilts_binding.wire_tokens_v1(received.raw_payload);
  incoming_wire:=gridex_ack_authority.wire_v1(received.raw_payload);
  IF incoming_wire->>'environment' IS DISTINCT FROM p_environment
    OR incoming_wire->>'family' IS DISTINCT FROM 'UTILTS' OR incoming_wire->>'code' IS DISTINCT FROM 'E66'
    OR jsonb_array_length(incoming_wire->'ide') IS DISTINCT FROM 1
    OR coalesce(incoming_wire->>'legalSender','')='' OR coalesce(incoming_wire->>'legalReceiver','')=''
  THEN RETURN NULL; END IF;
  SELECT array_agg(token#>>'{elements,1,1}') INTO origin_refs
  FROM jsonb_array_elements(tokens) token
  WHERE token->>'tag'='RFF' AND token#>>'{elements,1,0}'='ACW'
    AND (token->>'index')::integer < (SELECT min((t->>'index')::integer) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE');
  IF cardinality(origin_refs) IS DISTINCT FROM 1 OR coalesce(length(origin_refs[1]),0) NOT BETWEEN 1 AND 70 THEN RETURN NULL; END IF;
  request_ids:=public.gridex_match_e66_to_sent_e73_reference_v1(p_company,p_environment,p_actor,origin_refs[1]);
  IF cardinality(request_ids) IS DISTINCT FROM 1 THEN RETURN NULL; END IF;
  SELECT q.* INTO request FROM public.grid_owner_data_requests q
  WHERE (q.company_id,q.id)=(p_company,request_ids[1]) AND q.status IN ('sent','received')
    AND q.customer_id=received.customer_id AND q.site_id=received.site_id
    AND q.metering_point_id=received.metering_point_id AND q.grid_owner_id=received.grid_owner_id FOR SHARE;
  IF request.id IS NULL THEN RETURN NULL; END IF;
  SELECT mp.normalized_metering_point_id INTO external_point FROM public.metering_points mp
  WHERE (mp.company_id,mp.id,mp.customer_id)=(p_company,request.metering_point_id,request.customer_id);
  IF external_point IS NULL OR gridex_utilts_binding.supported_point_v1(tokens,incoming_wire#>>'{ide,0}') IS DISTINCT FROM external_point
  THEN RETURN NULL; END IF;
  requested_range:=gridex_utilts_binding.e73_sent_request_range_v1(p_company,request.id,p_environment);
  original_ids:=gridex_utilts_binding.e73_request_candidate_ids_v1(p_company,request.id,p_environment);
  IF requested_range IS NULL OR cardinality(original_ids) IS DISTINCT FROM 1 THEN RETURN NULL; END IF;
  SELECT m.* INTO STRICT outgoing FROM public.ediel_messages m
  WHERE (m.company_id,m.environment,m.id)=(p_company,p_environment,original_ids[1]) FOR SHARE;
  outgoing_wire:=gridex_ack_authority.wire_v1(outgoing.raw_payload);
  IF outgoing_wire->>'legalSender' IS DISTINCT FROM incoming_wire->>'legalReceiver'
    OR outgoing_wire->>'legalReceiver' IS DISTINCT FROM incoming_wire->>'legalSender'
    OR received.message_received_at IS NULL OR received.message_received_at<outgoing.message_sent_at
    OR outgoing.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(outgoing.raw_payload,'UTF8')),'hex')
  THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('requestId',request.id,'originalId',outgoing.id,'originalHash',outgoing.immutable_payload_hash,
    'requestRange',requested_range::text);
END
$scope$;
REVOKE ALL ON FUNCTION gridex_e66_intake.offset_rejection_request_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.gridex_commit_e66_registration_rejection_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_transactions jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $commit$
DECLARE w gridex_e66_intake.work; saved gridex_e66_intake.registration_rejections; tx jsonb; result jsonb; digest text; raw text; reason text; request_basis jsonb;
BEGIN
  w:=gridex_e66_intake.require_registration_rejection_claim_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
  IF jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transactions)<>1
  THEN RAISE EXCEPTION 'e66_registration_rejection_input_required' USING ERRCODE='22023'; END IF;
  tx:=p_transactions->0;
  reason:=CASE WHEN tx->'issueCodes' ? 'UTILTS_TIMEZONE_INVALID' THEN 'UTILTS_TIMEZONE_INVALID'
    WHEN tx->'issueCodes' ? 'UTILTS_E66_REGISTRATION_DATE_INVALID' THEN 'UTILTS_E66_REGISTRATION_DATE_INVALID' END;
  IF nullif(tx->>'transactionId','') IS NULL OR tx->>'disposition' IS DISTINCT FROM 'guide_rejected'
    OR tx->>'responseType' IS DISTINCT FROM 'negative_aperak'
    OR reason IS NULL
    OR tx#>'{consumptionContract,observations}' IS DISTINCT FROM '[]'::jsonb
    OR tx#>>'{consumptionContract,metering,capability}' IS DISTINCT FROM 'skip'
    OR tx#>>'{consumptionContract,billing,capability}' IS DISTINCT FROM 'skip'
  THEN RAISE EXCEPTION 'e66_registration_rejection_input_required' USING ERRCODE='22023'; END IF;
  digest:=encode(sha256(convert_to(p_transactions::text,'UTF8')),'hex');
  SELECT * INTO saved FROM gridex_e66_intake.registration_rejections WHERE source_id=p_source;
  IF saved.source_id IS NOT NULL THEN
    IF (saved.company_id,saved.environment,saved.mailbox_id,saved.reception_id,saved.payload_sha256,saved.command_sha256,saved.transaction_id)
      IS DISTINCT FROM (w.company_id,w.environment,w.mailbox_id,w.reception_id,w.payload_sha256,digest,tx->>'transactionId')
      OR saved.rejection_reason IS DISTINCT FROM reason OR saved.completed_at IS NOT NULL
    THEN RAISE EXCEPTION 'e66_registration_rejection_replay_changed' USING ERRCODE='55000'; END IF;
  ELSIF gridex_e66_intake.request_upgrade_state_v1(p_source) IS DISTINCT FROM 'qualify_normally' THEN
    RAISE EXCEPTION 'e66_registration_rejection_conflicting_authority' USING ERRCODE='55000';
  END IF;
  SELECT raw_payload INTO STRICT raw FROM public.ediel_messages WHERE id=w.source_id;
  IF reason='UTILTS_TIMEZONE_INVALID' THEN
    PERFORM gridex_e66_intake.require_offset_conflict_v1(w.company_id,w.source_id,raw);
    IF saved.source_id IS NULL THEN
      request_basis:=gridex_e66_intake.offset_rejection_request_v1(w.company_id,w.environment,w.source_id,p_actor);
    END IF;
  END IF;
  result:=gridex_e66_intake.persist_owned_utilts_v1(p_company,p_environment,p_source,'E66',raw,p_transactions,p_actor);
  IF NOT EXISTS(SELECT FROM public.ediel_ack_transaction_results a
    WHERE (a.company_id,a.environment,a.source_message_id,a.source_transaction_id)=(w.company_id,w.environment,w.source_id,tx->>'transactionId')
      AND a.disposition='guide_rejected' AND a.planned_response_type='negative_aperak' AND a.persisted_series_id IS NULL
      AND (a.final_response_type IS NULL OR a.final_response_type='negative_aperak'))
  THEN RAISE EXCEPTION 'e66_registration_rejection_proof_required' USING ERRCODE='55000'; END IF;
  INSERT INTO gridex_e66_intake.registration_rejections
   (source_id,reception_id,company_id,environment,mailbox_id,payload_sha256,command_sha256,transaction_id,
    rejection_reason,related_request_id,request_original_id,request_original_sha256,request_range)
  VALUES(w.source_id,w.reception_id,w.company_id,w.environment,w.mailbox_id,w.payload_sha256,digest,tx->>'transactionId',
    reason,(request_basis->>'requestId')::uuid,(request_basis->>'originalId')::uuid,
    request_basis->>'originalHash',(request_basis->>'requestRange')::tstzrange)
  ON CONFLICT(source_id) DO NOTHING;
  RETURN result;
END
$commit$;

CREATE OR REPLACE FUNCTION public.gridex_finish_e66_registration_rejection_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $finish$
DECLARE w gridex_e66_intake.work; saved gridex_e66_intake.registration_rejections; ack public.ediel_messages; current_basis jsonb; unresolved_id uuid;
BEGIN
  w:=gridex_e66_intake.require_registration_rejection_claim_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
  SELECT * INTO saved FROM gridex_e66_intake.registration_rejections
  WHERE (source_id,reception_id,company_id,environment,mailbox_id,payload_sha256)
    =(w.source_id,w.reception_id,w.company_id,w.environment,w.mailbox_id,w.payload_sha256)
    AND completed_at IS NULL FOR UPDATE;
  IF saved.source_id IS NULL THEN RAISE EXCEPTION 'e66_registration_rejection_proof_required' USING ERRCODE='55000'; END IF;
  SELECT m.* INTO ack FROM public.ediel_ack_transaction_results a JOIN public.ediel_messages m
    ON (m.company_id,m.environment,m.id)=(a.company_id,a.environment,a.response_message_id)
  WHERE (a.company_id,a.environment,a.source_message_id,a.source_transaction_id)
      =(saved.company_id,saved.environment,saved.source_id,saved.transaction_id)
    AND a.disposition='guide_rejected' AND a.planned_response_type='negative_aperak' AND a.final_response_type='negative_aperak'
    AND a.finalized_at IS NOT NULL AND a.persisted_series_id IS NULL
    AND (m.direction,m.message_standard,m.message_family,m.related_message_id)=('outbound','edifact','APERAK',saved.source_id)
    AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
    AND EXISTS (SELECT FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(m.raw_payload,999999)) t
      WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='313')
  FOR SHARE OF a,m;
  IF ack.id IS NULL THEN RAISE EXCEPTION 'e66_registration_rejection_ack_required' USING ERRCODE='55000'; END IF;
  IF saved.rejection_reason='UTILTS_TIMEZONE_INVALID' AND saved.related_request_id IS NOT NULL THEN
    current_basis:=gridex_e66_intake.offset_rejection_request_v1(w.company_id,w.environment,w.source_id,p_actor);
    IF current_basis IS NOT DISTINCT FROM jsonb_build_object('requestId',saved.related_request_id,
      'originalId',saved.request_original_id,'originalHash',saved.request_original_sha256,'requestRange',saved.request_range::text)
    THEN
      INSERT INTO public.ediel_unresolved_items(company_id,source_message_id,issue_type,severity,extracted_identifiers,suggested_matches,status)
      VALUES(w.company_id,w.source_id,'billing_gate_blocked','warning',
        jsonb_build_object('requestId',saved.related_request_id,'reasonCodes',jsonb_build_array(saved.rejection_reason)),
        '[]'::jsonb,'open') RETURNING id INTO unresolved_id;
    END IF;
  END IF;
  UPDATE gridex_e66_intake.registration_rejections SET response_message_id=ack.id,
    response_sha256=ack.immutable_payload_hash,completed_at=clock_timestamp(),unresolved_item_id=unresolved_id
    WHERE source_id=saved.source_id;
  INSERT INTO public.ediel_message_events(company_id,ediel_message_id,event_type,event_status,message,payload,created_by)
  VALUES(w.company_id,w.source_id,'validated','warning',CASE saved.rejection_reason
    WHEN 'UTILTS_TIMEZONE_INVALID' THEN 'E66 innehåller motstridiga UTC-offsetvärden.'
    ELSE 'E66 registrerades efter originalets mottagningstid.' END,
    jsonb_build_object('reason',saved.rejection_reason,'responseMessageId',ack.id),p_actor);
  UPDATE gridex_e66_intake.work SET phase='registration_rejected',lease_actor=NULL,lease_token=NULL,lease_until=NULL
  WHERE source_id=w.source_id;
  RETURN ack.id;
END
$finish$;

CREATE INDEX e66_offset_rejection_request_idx ON gridex_e66_intake.registration_rejections(company_id,related_request_id)
  WHERE rejection_reason='UTILTS_TIMEZONE_INVALID' AND unresolved_item_id IS NOT NULL;

CREATE FUNCTION gridex_e66_intake.billing_offset_rejection_sources_v1(u public.billing_underlays)
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $sources$
DECLARE
  first_day date;
  bill_period tstzrange;
BEGIN
  IF u.status IS DISTINCT FROM 'pending' OR u.readiness_status IS DISTINCT FROM 'blocked'
    OR (u.underlay_year BETWEEN 2000 AND 2100 AND u.underlay_month BETWEEN 1 AND 12) IS NOT TRUE
    OR NOT (coalesce(u.missing_values_count,0)>0 OR coalesce(u.billing_block_reason,'') LIKE 'missing_meter_values%')
    OR u.company_id IS NULL OR u.customer_id IS NULL OR u.metering_point_id IS NULL
    OR coalesce(u.customer_site_id,u.site_id) IS NULL
  THEN RETURN; END IF;

  -- An old missing-values row in the same calendar month is insufficient
  -- when there are repeated scopes, retained versions, or different requests.
  IF u.source_request_id IS NULL AND (
    u.source_system IS DISTINCT FROM 'normalized_metering_values'
    OR u.payload->>'timezone' IS DISTINCT FROM 'Europe/Stockholm'
    OR u.supply_period_id IS NULL
    OR EXISTS (SELECT FROM public.billing_underlays sibling
      WHERE (sibling.company_id,sibling.customer_id,sibling.metering_point_id,sibling.underlay_year,sibling.underlay_month)
        =(u.company_id,u.customer_id,u.metering_point_id,u.underlay_year,u.underlay_month)
        AND coalesce(sibling.customer_site_id,sibling.site_id)=coalesce(u.customer_site_id,u.site_id)
        AND sibling.id<>u.id AND sibling.status='pending' AND sibling.readiness_status='blocked')
  ) THEN RETURN; END IF;

  first_day:=make_date(u.underlay_year,u.underlay_month,1);
  bill_period:=tstzrange(first_day::timestamp AT TIME ZONE 'Europe/Stockholm',
    (first_day+interval '1 month') AT TIME ZONE 'Europe/Stockholm','[)');
  RETURN QUERY
  SELECT r.source_id
  FROM public.grid_owner_data_requests q
  JOIN gridex_e66_intake.registration_rejections r ON (r.company_id,r.related_request_id)=(q.company_id,q.id)
    AND r.rejection_reason='UTILTS_TIMEZONE_INVALID' AND r.unresolved_item_id IS NOT NULL
  JOIN public.ediel_unresolved_items issue ON (issue.company_id,issue.source_message_id,issue.id)=(r.company_id,r.source_id,r.unresolved_item_id)
    AND issue.status='open' AND issue.issue_type='billing_gate_blocked'
  JOIN public.ediel_messages received ON (received.company_id,received.environment,received.id)=(r.company_id,r.environment,r.source_id)
    AND received.direction='inbound' AND received.message_family='UTILTS' AND received.message_code='E66'
    AND received.immutable_payload_hash=r.payload_sha256 AND received.test_flag=0
    AND (received.customer_id,received.site_id,received.metering_point_id)=(q.customer_id,q.site_id,q.metering_point_id)
  JOIN public.ediel_messages original ON (original.company_id,original.environment,original.id)=(r.company_id,r.environment,r.request_original_id)
    AND original.immutable_payload_hash=r.request_original_sha256
    AND original.grid_owner_data_request_id=q.id AND original.status IN ('sent','acknowledged')
  JOIN public.ediel_messages response ON (response.company_id,response.environment,response.id)=(r.company_id,r.environment,r.response_message_id)
    AND response.immutable_payload_hash=r.response_sha256 AND response.related_message_id=r.source_id
    AND response.direction='outbound' AND response.message_family='APERAK'
  WHERE (q.company_id,q.customer_id,q.site_id,q.metering_point_id)=(u.company_id,u.customer_id,coalesce(u.customer_site_id,u.site_id),u.metering_point_id)
    AND q.status='sent' AND q.request_scope IN ('meter_values','billing_underlay')
    AND (u.source_request_id IS NULL OR q.id=u.source_request_id)
    AND r.environment='production' AND r.completed_at IS NOT NULL AND r.request_range @> bill_period
  LIMIT 2;
END
$sources$;
REVOKE ALL ON FUNCTION gridex_e66_intake.billing_offset_rejection_sources_v1(public.billing_underlays) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.gridex_read_billing_ediel_blocker_sources_v1(
  p_actor_user_id uuid, p_company_id uuid, p_underlay_ids uuid[]
)
RETURNS TABLE (underlay_id uuid, source_message_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog
AS $function$
  SELECT u.id, CASE WHEN public.canonical_actor_is_platform_admin(p_actor_user_id)
    AND cardinality(matched.sources)=1 THEN matched.sources[1] END
  FROM public.billing_underlays u
  CROSS JOIN LATERAL (
    SELECT array_agg(matches.id) AS sources
    FROM (
      SELECT DISTINCT found.id FROM (
      SELECT source.id
      FROM public.billing_underlay_items item
      JOIN public.normalized_metering_values value ON value.id=item.source_normalized_metering_value_id
        AND value.company_id=u.company_id AND value.customer_id=u.customer_id
        AND value.metering_point_id=u.metering_point_id AND value.supply_period_id=u.supply_period_id
        AND value.revision_status='current' AND value.billing_gate_status IN ('blocked','conflict')
        AND value.billing_gate_reasons @> '[{"code":"source_basis_unqualified"}]'::jsonb
        AND item.period_start>=value.period_start AND item.period_end<=value.period_end
      JOIN public.ediel_messages source ON source.id=value.source_message_id AND source.company_id=u.company_id
        AND source.customer_id=u.customer_id AND source.metering_point_id=u.metering_point_id
        AND source.direction='inbound' AND source.message_family='UTILTS' AND source.message_code='E66'
        AND source.environment='production' AND source.test_flag=0
        AND source.raw_payload IS NOT NULL
        AND source.immutable_payload_hash=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
      WHERE item.company_id=u.company_id AND item.customer_id=u.customer_id
        AND item.metering_point_id=u.metering_point_id AND item.billing_underlay_id=u.id
        AND item.source_table='normalized_metering_values'
        AND EXISTS (
          SELECT FROM public.ediel_unresolved_items issue WHERE issue.source_message_id=source.id
            AND issue.company_id=u.company_id AND issue.status='open' AND issue.issue_type='billing_gate_blocked'
            AND issue.extracted_identifiers @> jsonb_build_object(
              'normalizedValueId',value.id,'meteringPointId',value.metering_point_id,
              'supplyPeriodIds',jsonb_build_array(value.supply_period_id),
              'reasonCodes',jsonb_build_array('source_basis_unqualified')
            )
        )
      UNION ALL
      SELECT fresh.id FROM gridex_e66_intake.billing_offset_rejection_sources_v1(u) fresh(id)
      ) found
      LIMIT 2
    ) matches
  ) matched
  WHERE current_setting('role',true)='service_role'
    AND (public.canonical_actor_is_platform_admin(p_actor_user_id)
      OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.read'))
    AND coalesce(cardinality(p_underlay_ids),0) BETWEEN 1 AND 100
    AND u.company_id=p_company_id AND u.id=ANY(p_underlay_ids)
    AND u.status='pending' AND u.readiness_status='blocked'
    AND cardinality(matched.sources)>0;
$function$;
CREATE OR REPLACE FUNCTION public.gridex_list_portal_billing_review_months_v1(
  p_company_id uuid,p_customer_ids uuid[],p_last_year integer,p_last_month integer
)
RETURNS TABLE(year integer,month integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog
AS $function$
  SELECT DISTINCT u.underlay_year,u.underlay_month
  FROM public.billing_underlays u
  JOIN public.customers c ON c.id=u.customer_id AND c.company_id=u.company_id
  WHERE current_setting('role',true)='service_role'
    AND p_last_year BETWEEN 2000 AND 2100
    AND p_last_month BETWEEN 1 AND 12
    AND coalesce(cardinality(p_customer_ids),0) BETWEEN 1 AND 100
    AND u.company_id=p_company_id AND u.customer_id=ANY(p_customer_ids)
    AND (u.underlay_year,u.underlay_month) <= (p_last_year,p_last_month)
    AND u.underlay_month BETWEEN 1 AND 12
    AND u.status='pending' AND u.readiness_status='blocked'
    AND (u.billing_block_reason ~ '(^|;)[[:space:]]*source_basis_unqualified([[:space:]]*[;:]|[[:space:]]*$)'
      OR EXISTS(SELECT FROM gridex_e66_intake.billing_offset_rejection_sources_v1(u)))
    AND NOT EXISTS (
      SELECT FROM public.customer_invoices i WHERE i.company_id=u.company_id AND i.customer_id=u.customer_id
        AND i.status IN ('issued','sent','paid','overdue','cancelled','credited')
        AND (i.billing_underlay_id=u.id OR EXISTS (
          SELECT FROM public.invoice_export_items e WHERE e.company_id=u.company_id AND e.customer_id=u.customer_id
            AND e.billing_underlay_id=u.id AND e.id IN (i.invoice_export_item_id,i.canonical_export_item_id)
        ))
    )
  ORDER BY u.underlay_year DESC,u.underlay_month DESC
  LIMIT 3;
$function$;
