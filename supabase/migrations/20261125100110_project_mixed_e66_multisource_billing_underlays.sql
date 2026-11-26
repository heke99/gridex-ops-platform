CREATE TABLE gridex_e66_intake.mixed_e73_billing_projections (
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment='test'),
  request_id uuid NOT NULL,
  coverage_sha256 text NOT NULL CHECK (coverage_sha256 ~ '^[0-9a-f]{64}$'),
  calendar_anchor_source_id uuid NOT NULL REFERENCES public.ediel_messages(id),
  primary_underlay_id uuid NOT NULL UNIQUE REFERENCES public.billing_underlays(id),
  PRIMARY KEY (company_id,environment,request_id),
  FOREIGN KEY (company_id,environment,request_id)
    REFERENCES gridex_e66_intake.mixed_e73_billing_coverage(company_id,environment,request_id)
);
ALTER TABLE gridex_e66_intake.mixed_e73_billing_projections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_e66_intake.mixed_e73_billing_projections FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER mixed_e73_billing_projection_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON gridex_e66_intake.mixed_e73_billing_projections
FOR EACH STATEMENT EXECUTE FUNCTION gridex_e66_intake.guard_mixed_billing_coverage_immutable_v1();

-- The calendar owner starts these rows in a pricing hold. Only a future
-- multi-source pricing authority can deliberately introduce a release path.
CREATE FUNCTION gridex_e66_intake.guard_mixed_billing_projection_readiness_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  owned boolean;
BEGIN
  SELECT EXISTS(
    SELECT FROM gridex_e66_intake.billing_calendar_receipts calendar
    JOIN gridex_e66_intake.mixed_e73_billing_projections projection
      ON (projection.company_id,projection.environment,projection.calendar_anchor_source_id)
        =(calendar.company_id,calendar.environment,calendar.source_id)
    WHERE (calendar.underlay_id,calendar.company_id)=(OLD.id,OLD.company_id)
  ) INTO owned;
  IF TG_OP='DELETE' THEN
    IF owned THEN RAISE EXCEPTION 'mixed_e66_projection_member_immutable' USING ERRCODE='P0U01'; END IF;
    RETURN OLD;
  END IF;
  IF owned AND (NEW.status,NEW.readiness_status,NEW.billing_block_reason,NEW.pricing_snapshot_id,
       NEW.contract_price_snapshot_id,NEW.pricing_snapshot,NEW.contract_id)
      IS DISTINCT FROM (OLD.status,OLD.readiness_status,OLD.billing_block_reason,OLD.pricing_snapshot_id,
       OLD.contract_price_snapshot_id,OLD.pricing_snapshot,OLD.contract_id)
  THEN RAISE EXCEPTION 'mixed_e66_multisource_pricing_unqualified' USING ERRCODE='P0U01'; END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.guard_mixed_billing_projection_readiness_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER mixed_e66_billing_projection_readiness_guard
BEFORE UPDATE OF status,readiness_status,billing_block_reason,pricing_snapshot_id,
  contract_price_snapshot_id,pricing_snapshot,contract_id ON public.billing_underlays
FOR EACH ROW EXECUTE FUNCTION gridex_e66_intake.guard_mixed_billing_projection_readiness_v1();
CREATE TRIGGER mixed_e66_billing_projection_delete_guard
BEFORE DELETE ON public.billing_underlays
FOR EACH ROW EXECUTE FUNCTION gridex_e66_intake.guard_mixed_billing_projection_readiness_v1();


-- Only the existing UTILTS billing owner calls this helper. It supplies
-- input to the same Stockholm projection loop, never writes the underlay.
CREATE FUNCTION gridex_e66_intake.prepare_mixed_billing_v2(
  p_company uuid,p_seed_source uuid,p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE
  prior gridex_e66_intake.mixed_e73_billing_projections;
  sealed gridex_e66_intake.mixed_e73_billing_coverage;
  requested public.grid_owner_data_requests;
  digest text;
  child record;
  original jsonb;
  contracts jsonb:='[]'::jsonb;
BEGIN
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'metering.write') IS NOT TRUE
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'billing_underlay.write') IS NOT TRUE
    OR NOT EXISTS(SELECT FROM gridex_e66_intake.mixed_qualification_receipts q
      WHERE (q.source_id,q.actor_id)=(p_seed_source,p_actor))
  THEN RETURN NULL; END IF;
  PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);

  SELECT projection.* INTO prior
  FROM gridex_e66_intake.mixed_e73_billing_projections projection
  JOIN gridex_e66_intake.mixed_e73_billing_coverage coverage
    ON (coverage.company_id,coverage.environment,coverage.request_id,coverage.evidence_sha256)
      =(projection.company_id,projection.environment,projection.request_id,projection.coverage_sha256)
  WHERE (projection.company_id,projection.environment)=(p_company,'test')
    AND coverage.evidence->'members' @> jsonb_build_array(jsonb_build_object('sourceId',p_seed_source))
    AND EXISTS(SELECT FROM gridex_e66_intake.mixed_e73_request_basis b
       WHERE (b.company_id,b.environment,b.request_id,b.source_id,b.actor_id)
         =(p_company,'test',projection.request_id,p_seed_source,p_actor));
  IF FOUND THEN
    IF gridex_e66_intake.bound_underlay_fingerprint_v1(
      p_company,prior.calendar_anchor_source_id,prior.primary_underlay_id) IS NULL
    THEN RAISE EXCEPTION 'mixed_e66_projection_receipt_changed' USING ERRCODE='P0U01'; END IF;
    RETURN jsonb_build_object('replayUnderlayId',prior.primary_underlay_id);
  END IF;

  -- Requalify the immutable first receipt against the currently observed
  -- source effects. A correction cannot reuse a now-stale first receipt.
  digest:=gridex_e66_intake.seal_mixed_billing_multisource_coverage_v1(p_company,p_seed_source,p_actor);
  IF digest IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO sealed FROM gridex_e66_intake.mixed_e73_billing_coverage coverage
  WHERE (coverage.company_id,coverage.environment,coverage.evidence_sha256)=(p_company,'test',digest)
    AND coverage.evidence->'members' @> jsonb_build_array(jsonb_build_object('sourceId',p_seed_source));
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO requested FROM public.grid_owner_data_requests q
  WHERE (q.company_id,q.id,q.request_scope)=(p_company,sealed.request_id,'billing_underlay')
    AND q.status IN ('sent','received') FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  FOR child IN
    SELECT (member->>'sourceId')::uuid AS physical_source_id,member->>'transactionId' AS ide,
      min(member->>'contractSha256') AS contract_sha256,
      jsonb_agg((member->>'ordinal')::integer ORDER BY (member->>'ordinal')::integer) AS ordinals
    FROM jsonb_array_elements(sealed.evidence->'members') member
    GROUP BY (member->>'sourceId')::uuid,member->>'transactionId'
    HAVING count(DISTINCT member->>'contractSha256')=1
    ORDER BY physical_source_id,ide
  LOOP
    original:=gridex_utilts_binding.stored_contract_v1(p_company,child.physical_source_id,child.ide);
    IF encode(sha256(convert_to(original::text,'UTF8')),'hex') IS DISTINCT FROM child.contract_sha256
    THEN RAISE EXCEPTION 'mixed_e66_projection_contract_changed' USING ERRCODE='P0U01'; END IF;
    contracts:=contracts||jsonb_build_array(original||jsonb_build_object(
      'physicalSourceId',child.physical_source_id,'billingContributionOrdinals',child.ordinals));
  END LOOP;
  IF (SELECT sum(jsonb_array_length(contract->'billingContributionOrdinals'))
      FROM jsonb_array_elements(contracts) contract) IS DISTINCT FROM (sealed.evidence->>'contributionCount')::bigint
  THEN RAISE EXCEPTION 'mixed_e66_projection_membership_changed' USING ERRCODE='P0U01'; END IF;

  RETURN jsonb_build_object('contracts',contracts,'coverageSha256',digest,
    'calendarAnchorSourceId',sealed.evidence#>>'{members,0,sourceId}',
    'sentSourceId',sealed.evidence->>'sentSourceId','sentHash',sealed.evidence->>'sentSha256',
    'requestedFrom',sealed.evidence->>'requestedFrom','requestedUntil',sealed.evidence->>'requestedUntil',
    'totalKwh',sealed.evidence->'totalKwh',
    'context',jsonb_build_object('requestScope','billing_underlay','capability','write','sourceRequestId',requested.id,
      'customerId',requested.customer_id,'siteId',requested.site_id,'customerSiteId',requested.site_id,
      'meteringPointId',requested.metering_point_id,'gridOwnerId',requested.grid_owner_id,
      'periodStart',sealed.evidence->>'requestedFrom','periodEnd',sealed.evidence->>'requestedUntil',
      'currency','SEK','status','received','sourceSystem','ediel_utilts'));
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.prepare_mixed_billing_v2(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Adapt only the versioned mixed inputs in the existing calendar writer.
-- The same native INSERT, attribution lock, and per-month receipt remain.
DO $$
DECLARE
  owner regprocedure:='gridex_e66_intake.consume_owned_utilts_billing_v1(uuid,uuid,uuid,jsonb)';
  definition text;
  body text;
  changed text;
BEGIN
  SELECT pg_get_functiondef(owner),p.prosrc INTO STRICT definition,body FROM pg_proc p WHERE p.oid=owner;
  IF md5(body)<>'7fa51ac76c986218cc5b5d948746c9c1'
  THEN RAISE EXCEPTION 'mixed_e66_projection_writer_owner_changed'; END IF;

  changed:=replace(body,' mixed_admission jsonb;',$new$ mixed_admission jsonb; v_multi jsonb; v_calendar_anchor uuid:=p_source_message_id;$new$);
  changed:=replace(changed,'  IF mixed_admission IS NULL THEN RETURN NULL; END IF;',$new$  IF mixed_admission IS NULL THEN
    v_multi:=gridex_e66_intake.prepare_mixed_billing_v2(p_company_id,p_source_message_id,p_actor_id);
    IF v_multi IS NULL THEN RETURN NULL; END IF;
  END IF;$new$);
  changed:=replace(changed,$old$  IF mixed_admission IS NOT NULL THEN
   v_contracts$old$,$new$  IF mixed_admission IS NOT NULL OR v_multi IS NOT NULL THEN
   v_contracts$new$);
  changed:=replace(changed,'IF v_context IS NULL AND mixed_admission IS NULL THEN','IF v_context IS NULL AND mixed_admission IS NULL AND v_multi IS NULL THEN');

  changed:=replace(changed,$old$ v_finance_contracts:=v_contracts;
 IF mixed_admission IS NOT NULL THEN$old$,$new$ IF v_multi ? 'replayUnderlayId' THEN
  SELECT b.* INTO STRICT v_result FROM public.billing_underlays b
  WHERE (b.company_id,b.id)=(p_company_id,(v_multi->>'replayUnderlayId')::uuid) FOR SHARE;
  RETURN v_result;
 END IF;
 v_finance_contracts:=v_contracts;
 IF v_multi IS NOT NULL THEN
  v_context:=v_multi->'context';
  v_finance_contracts:=v_multi->'contracts';
  v_sent_range:=tstzrange((v_multi->>'requestedFrom')::timestamptz,(v_multi->>'requestedUntil')::timestamptz,'[)');
  v_calendar_anchor:=(v_multi->>'calendarAnchorSourceId')::uuid;
 ELSIF mixed_admission IS NOT NULL THEN$new$);

  changed:=replace(changed,$old$SELECT c.value->>'transactionId' AS transaction_id, i.value::text::integer AS ordinal,$old$,
    $new$SELECT c.value->>'physicalSourceId' AS physical_source_id,c.value->>'transactionId' AS transaction_id,
    i.value::text::integer AS ordinal,$new$);
  changed:=replace(changed,'SELECT transaction_id,ordinal,(observation',
    'SELECT physical_source_id,transaction_id,ordinal,(observation');
  changed:=replace(changed,$old$jsonb_agg(jsonb_build_array(transaction_id,ordinal) ORDER BY transaction_id,ordinal)$old$,
    $new$jsonb_agg(CASE WHEN v_multi IS NULL THEN jsonb_build_array(transaction_id,ordinal)
      ELSE jsonb_build_array(physical_source_id,transaction_id,ordinal) END ORDER BY physical_source_id,transaction_id,ordinal)$new$);
  changed:=replace(changed,'jsonb_agg(jsonb_build_array(starts_at,ends_at) ORDER BY transaction_id,ordinal)',
    'jsonb_agg(jsonb_build_array(starts_at,ends_at) ORDER BY physical_source_id,transaction_id,ordinal)');
  changed:=replace(changed,'IF mixed_admission IS NOT NULL OR v_scoped_count<>v_contribution_count',
    'IF mixed_admission IS NOT NULL OR v_multi IS NOT NULL OR v_scoped_count<>v_contribution_count');
  changed:=replace(changed,$old$   IF mixed_admission IS NOT NULL THEN
    v_scope:=$old$,$new$   IF v_multi IS NOT NULL THEN
    IF v_scoped_total IS DISTINCT FROM (v_multi->>'totalKwh')::numeric THEN
     RAISE EXCEPTION 'mixed_e66_projection_total_changed' USING ERRCODE='P0U01';
    END IF;
    v_scope:=v_scope||jsonb_build_object('basisVersion','mixed-e73-ide-finance-v2','environment','test',
      'sentSourceId',v_multi->'sentSourceId','sentHash',v_multi->'sentHash','coverageSha256',v_multi->'coverageSha256');
   ELSIF mixed_admission IS NOT NULL THEN
    v_scope:=$new$);

  changed:=replace(changed,'IF mixed_admission IS NULL AND v_source.message_code=',
    'IF mixed_admission IS NULL AND v_multi IS NULL AND v_source.message_code=');
  changed:=replace(changed,$old$b.payload#>>'{e73BillingScope,basisVersion}'='mixed-e73-ide-finance-v1')$old$,
    $new$b.payload#>>'{e73BillingScope,basisVersion}' IN ('mixed-e73-ide-finance-v1','mixed-e73-ide-finance-v2'))$new$);
  changed:=replace(changed,$old$  v_contract_sha256:=encode(sha256(convert_to(v_contracts::text,'UTF8')),'hex');$old$,
    $new$  v_contract_sha256:=coalesce(v_multi->>'coverageSha256',encode(sha256(convert_to(v_contracts::text,'UTF8')),'hex'));$new$);
  changed:=replace(changed,$old$    'version','stockholm-observation-month-v1','timeZone','Europe/Stockholm',$old$,
    $new$    'version',CASE WHEN v_multi IS NULL THEN 'stockholm-observation-month-v1'
      ELSE 'stockholm-multisource-observation-month-v1' END,'timeZone','Europe/Stockholm',$new$);
  changed:=replace(changed,$old$    readiness_issues,created_by,updated_by,received_at,source_meter_value_count)$old$,
    $new$    readiness_issues,created_by,updated_by,received_at,source_meter_value_count,billing_block_reason)$new$);
  changed:=replace(changed,$old$    jsonb_build_object('edielMessageId',p_source_message_id,'tenant',jsonb_build_object('company_id',p_company_id,'issues','[]'::jsonb),
      'billingCalendar',v_calendar)
     || CASE WHEN v_primary.id IS NULL THEN jsonb_build_object('consumptionContracts',v_contracts) ELSE '{}'::jsonb END$old$,
    $new$    jsonb_build_object('tenant',jsonb_build_object('company_id',p_company_id,'issues','[]'::jsonb),'billingCalendar',v_calendar)
     || CASE WHEN v_multi IS NULL THEN jsonb_build_object('edielMessageId',p_source_message_id) ELSE '{}'::jsonb END
     || CASE WHEN v_multi IS NULL AND v_primary.id IS NULL THEN jsonb_build_object('consumptionContracts',v_contracts) ELSE '{}'::jsonb END$new$);
  changed:=replace(changed,$old$    'not_checked','[]'::jsonb,p_actor_id,p_actor_id,now(),v_month.contribution_count)$old$,
    $new$    CASE WHEN v_multi IS NULL THEN 'not_checked' ELSE 'blocked' END,
    '[]'::jsonb,p_actor_id,p_actor_id,now(),v_month.contribution_count,
    CASE WHEN v_multi IS NOT NULL THEN 'mixed_e66_multisource_pricing_unqualified' END)$new$);
  changed:=replace(changed,$old$   VALUES(p_company_id,p_source_message_id,v_source.environment,v_month.year,v_month.month,v_result.id,$old$,
    $new$   VALUES(p_company_id,v_calendar_anchor,v_source.environment,v_month.year,v_month.month,v_result.id,$new$);
  changed:=replace(changed,$old$  RETURN v_primary;
 END IF;$old$,$new$  IF v_multi IS NOT NULL THEN
   INSERT INTO gridex_e66_intake.mixed_e73_billing_projections(company_id,environment,request_id,
     coverage_sha256,calendar_anchor_source_id,primary_underlay_id)
   VALUES(p_company_id,'test',(v_context->>'sourceRequestId')::uuid,
     v_multi->>'coverageSha256',v_calendar_anchor,v_primary.id);
  END IF;
  RETURN v_primary;
 END IF;$new$);
  EXECUTE replace(definition,body,changed);
END
$$;
