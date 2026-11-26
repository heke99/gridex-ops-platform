DO $pin$
BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
   WHERE oid='gridex_billing_source.assert_invoice_sources_uncorrected_v1(uuid,uuid[])'::regprocedure)
    IS DISTINCT FROM '71a9591595733d81ecce58fd7047fd678bd237b37401de92d4e41652420da5e9'
 THEN RAISE EXCEPTION 'mixed_e66_invoice_correction_owner_preimage_changed'; END IF;
END
$pin$;
-- The raw Stockholm projection has no priced-underlay binding or items.
-- Attach a distinct append-only correction receipt to the original raw member.
CREATE TABLE gridex_e66_intake.mixed_billing_correction_holds (
  underlay_id uuid NOT NULL REFERENCES public.billing_underlays(id),
  company_id uuid NOT NULL,
  previous_normalized_value_id uuid NOT NULL REFERENCES public.normalized_metering_values(id),
  new_normalized_value_id uuid NOT NULL REFERENCES public.normalized_metering_values(id),
  prior_source_id uuid NOT NULL,
  new_source_id uuid NOT NULL,
  underlay_fingerprint text NOT NULL CHECK (underlay_fingerprint ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (underlay_id,new_normalized_value_id)
);
ALTER TABLE gridex_e66_intake.mixed_billing_correction_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_e66_intake.mixed_billing_correction_holds FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER mixed_billing_correction_hold_immutable
 BEFORE UPDATE OR DELETE ON gridex_e66_intake.mixed_billing_correction_holds
 FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER mixed_billing_correction_hold_no_truncate
 BEFORE TRUNCATE ON gridex_e66_intake.mixed_billing_correction_holds
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

CREATE INDEX mixed_e73_child_effects_idx ON gridex_e66_intake.mixed_e73_request_basis
 USING gin ((evidence->'childEffects') jsonb_path_ops);

CREATE FUNCTION gridex_e66_intake.capture_mixed_billing_correction_v1()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $hold$
DECLARE
  affected record;
BEGIN
  IF NEW.previous_value_id IS NULL OR NEW.source_message_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT FROM public.ediel_messages m
    WHERE (m.id,m.company_id,m.direction,m.environment,m.message_family,m.message_code)
      =(NEW.source_message_id,NEW.company_id,'inbound','test','UTILTS','E66'))
  THEN RETURN NEW; END IF;

  FOR affected IN
    SELECT DISTINCT u.id,previous.id AS prior_normalized,b.source_id,receipt.row_fingerprint
    FROM public.normalized_metering_values previous
    JOIN gridex_e66_intake.mixed_e73_request_basis b ON b.company_id=previous.company_id AND b.environment='test'
      AND b.evidence->'childEffects' @> jsonb_build_array(jsonb_build_object('normalizedId',previous.id))
    JOIN gridex_e66_intake.billing_calendar_receipts receipt
      ON (receipt.company_id,receipt.source_id,receipt.environment)=(b.company_id,b.source_id,b.environment)
    JOIN public.billing_underlays u ON (u.company_id,u.id,u.source_request_id)=(receipt.company_id,receipt.underlay_id,b.request_id)
    WHERE previous.company_id=NEW.company_id AND (previous.id=NEW.previous_value_id OR previous.source_metering_value_id=NEW.previous_value_id)
      AND previous.id<>NEW.id
      AND (previous.customer_id,previous.metering_point_id,previous.period_start,previous.period_end)
        IS NOT DISTINCT FROM (NEW.customer_id,NEW.metering_point_id,NEW.period_start,NEW.period_end)
      AND u.payload#>>'{e73BillingScope,basisVersion}'='mixed-e73-ide-finance-v1'
      AND u.payload->>'edielMessageId'=b.source_id::text
      AND u.payload#>'{e73BillingScope,ideBasisHashes}' @> jsonb_build_array(jsonb_build_array(b.transaction_id,b.evidence_sha256))
      AND receipt.row_fingerprint=gridex_e66_intake.billing_calendar_member_hash_v1(u)
      AND EXISTS (SELECT FROM jsonb_array_elements(b.evidence->'childEffects') item
        WHERE item->>'normalizedId'=previous.id::text
          AND u.payload#>'{billingCalendar,contributors}' @> jsonb_build_array(jsonb_build_array(b.transaction_id,(item->>'ordinal')::integer)))
    ORDER BY u.id,previous.id
  LOOP
    -- Serialize on the same row used by the existing approval/archive gate.
    -- A concurrent approval already holding the row wins this attempt.
    PERFORM 1 FROM public.billing_underlays u
      WHERE (u.id,u.company_id)=(affected.id,NEW.company_id) FOR UPDATE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'mixed_e66_billing_correction_underlay_missing' USING ERRCODE='55000'; END IF;
    INSERT INTO gridex_e66_intake.mixed_billing_correction_holds(
      company_id,underlay_id,previous_normalized_value_id,new_normalized_value_id,prior_source_id,
      new_source_id,underlay_fingerprint)
    VALUES (NEW.company_id,affected.id,affected.prior_normalized,NEW.id,affected.source_id,
      NEW.source_message_id,affected.row_fingerprint)
    ON CONFLICT(underlay_id,new_normalized_value_id) DO NOTHING;
  END LOOP;
  RETURN NEW;
END
$hold$;
REVOKE ALL ON FUNCTION gridex_e66_intake.capture_mixed_billing_correction_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER mixed_billing_capture_correction
 AFTER INSERT ON public.normalized_metering_values
 FOR EACH ROW EXECUTE FUNCTION gridex_e66_intake.capture_mixed_billing_correction_v1();
CREATE OR REPLACE FUNCTION gridex_billing_source.assert_invoice_sources_uncorrected_v1(
  p_company uuid, p_underlays uuid[]
) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog
AS $correction_gate$
DECLARE
  v_locked integer;
BEGIN
  IF p_company IS NULL OR coalesce(cardinality(p_underlays),0)=0
     OR array_position(p_underlays,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invoice_correction_scope_unavailable' USING ERRCODE='23514';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'invoice_correction_read_committed_required' USING ERRCODE='25001';
  END IF;

  -- Bind a previously unbound legacy underlay as well. FK key-share cannot
  -- overlap these strong locks, even if a correction was still uncommitted.
  BEGIN
    PERFORM u.id
      FROM public.billing_underlays u
      WHERE u.company_id=p_company AND u.id=ANY(p_underlays)
      ORDER BY u.id FOR UPDATE OF u NOWAIT;
    GET DIAGNOSTICS v_locked=ROW_COUNT;
    IF v_locked<>(SELECT count(DISTINCT id) FROM unnest(p_underlays) AS ids(id)) THEN
      RAISE EXCEPTION 'invoice_correction_scope_unavailable' USING ERRCODE='23514';
    END IF;

    PERFORM b.underlay_id
      FROM gridex_billing_source.underlay_bindings b
      WHERE b.company_id=p_company AND b.underlay_id=ANY(p_underlays)
      ORDER BY b.underlay_id FOR UPDATE OF b NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'invoice_correction_source_busy' USING ERRCODE='55P03';
  END;

  -- Separate VOLATILE command under READ COMMITTED, after taking both locks.
  IF EXISTS (
    SELECT FROM gridex_billing_source.correction_journal j
    WHERE j.company_id=p_company AND j.underlay_id=ANY(p_underlays)
  ) OR EXISTS (
    SELECT FROM gridex_e66_intake.mixed_billing_correction_holds j
    WHERE j.company_id=p_company AND j.underlay_id=ANY(p_underlays)
  ) THEN
    RAISE EXCEPTION 'billing_source_correction_required' USING ERRCODE='23514';
  END IF;
END
$correction_gate$;

REVOKE ALL ON FUNCTION gridex_billing_source.assert_invoice_sources_uncorrected_v1(uuid,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

DO $pin$ BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='gridex_e66_intake.mixed_billing_admission_v1(uuid,uuid,uuid)'::regprocedure) IS DISTINCT FROM '5dcfb73586aa22ec4de0c669a6597710d0c47e4c439e2266600b0bf2b68c01b9'
 THEN RAISE EXCEPTION 'mixed_e66_billing_replacement_preimage_changed'; END IF;
END $pin$;
CREATE TABLE gridex_e66_intake.mixed_billing_replacements (
  predecessor_id uuid PRIMARY KEY REFERENCES public.billing_underlays(id),
  replacement_id uuid NOT NULL UNIQUE REFERENCES public.billing_underlays(id),
  company_id uuid NOT NULL,
  source_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL,
  old_fingerprint text NOT NULL CHECK (old_fingerprint ~ '^[a-f0-9]{64}$'),
  new_fingerprint text NOT NULL CHECK (new_fingerprint ~ '^[a-f0-9]{64}$')
);
ALTER TABLE gridex_e66_intake.mixed_billing_replacements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_e66_intake.mixed_billing_replacements FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER mixed_billing_replacements_immutable
 BEFORE UPDATE OR DELETE ON gridex_e66_intake.mixed_billing_replacements
 FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER mixed_billing_replacements_no_truncate
 BEFORE TRUNCATE ON gridex_e66_intake.mixed_billing_replacements
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

CREATE FUNCTION gridex_e66_intake.mixed_billing_admission_v2(
  p_company uuid,p_source uuid,p_actor uuid,p_previous uuid
) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $admit$
DECLARE
  request_row public.grid_owner_data_requests;
  child record;
  current_basis jsonb;
  reference_basis jsonb;
  exact_contract jsonb;
  finance_contract jsonb;
  basis_hashes jsonb:='[]'::jsonb;
  finance_contracts jsonb:='[]'::jsonb;
  expected_range tstzrange;
  actual_range tstzmultirange;
  contributed_seconds numeric;
BEGIN
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'metering.write') IS NOT TRUE
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'billing_underlay.write') IS NOT TRUE
  THEN RETURN NULL; END IF;
  PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);
  FOR child IN
    SELECT t.transaction_id,b.evidence,b.evidence_sha256,b.request_id
    FROM gridex_e66_intake.work w
    JOIN gridex_e66_intake.mixed_qualification_receipts q ON q.source_id=w.source_id AND q.actor_id=p_actor
    JOIN gridex_e66_intake.mixed_accepted_transactions t ON t.source_id=w.source_id
    LEFT JOIN gridex_e66_intake.mixed_e73_request_basis b
      ON (b.source_id,b.transaction_id,b.company_id,b.environment,b.actor_id)
        =(t.source_id,t.transaction_id,w.company_id,w.environment,p_actor)
    WHERE (w.source_id,w.company_id,w.environment,w.phase)=(p_source,p_company,'test','mixed_qualified')
    ORDER BY t.transaction_id
  LOOP
    IF child.evidence IS NULL OR child.evidence->>'requestScope' IS DISTINCT FROM 'billing_underlay' THEN RETURN NULL; END IF;
    current_basis:=gridex_e66_intake.read_mixed_e73_evidence_v1(p_company,'test',p_source,p_actor,child.transaction_id);
    IF current_basis IS DISTINCT FROM child.evidence
      OR encode(sha256(convert_to(current_basis::text,'UTF8')),'hex') IS DISTINCT FROM child.evidence_sha256
    THEN RETURN NULL; END IF;
    IF reference_basis IS NULL THEN
      reference_basis:=current_basis;
      expected_range:=tstzrange((current_basis->>'requestedFrom')::timestamptz,
        (current_basis->>'requestedUntil')::timestamptz,'[)');
    ELSIF (current_basis->>'requestId',current_basis->>'sentSourceId',current_basis->>'sentHash',
           current_basis->>'requestedFrom',current_basis->>'requestedUntil')
          IS DISTINCT FROM
          (reference_basis->>'requestId',reference_basis->>'sentSourceId',reference_basis->>'sentHash',
           reference_basis->>'requestedFrom',reference_basis->>'requestedUntil')
    THEN RETURN NULL; END IF;
    exact_contract:=gridex_utilts_binding.stored_contract_v1(p_company,p_source,child.transaction_id);
    IF exact_contract#>>'{billing,capability}' IS DISTINCT FROM 'skip'
      OR exact_contract#>>'{billing,sourceRequestId}' IS NOT NULL
      OR encode(sha256(convert_to(exact_contract::text,'UTF8')),'hex') IS DISTINCT FROM current_basis->>'contractHash'
    THEN RETURN NULL; END IF;
    SELECT exact_contract||jsonb_build_object('billingContributionOrdinals',jsonb_agg((o->>'ordinal')::integer ORDER BY (o->>'ordinal')::integer))
    INTO finance_contract
    FROM jsonb_array_elements(exact_contract->'observations') o
    WHERE (o->>'periodStart')::timestamptz >= lower(expected_range)
      AND (o->>'periodEnd')::timestamptz <= upper(expected_range)
    HAVING count(*)>0;
    IF finance_contract IS NULL THEN RETURN NULL; END IF;
    finance_contracts:=finance_contracts||jsonb_build_array(finance_contract);
    basis_hashes:=basis_hashes||jsonb_build_array(jsonb_build_array(child.transaction_id,child.evidence_sha256));
  END LOOP;
  IF reference_basis IS NULL THEN RETURN NULL; END IF;
  SELECT range_agg(tstzrange(starts_at,ends_at,'[)')),sum(extract(epoch FROM ends_at-starts_at))
  INTO actual_range,contributed_seconds
  FROM (
    SELECT (o->>'periodStart')::timestamptz AS starts_at,(o->>'periodEnd')::timestamptz AS ends_at
    FROM jsonb_array_elements(finance_contracts) c
    CROSS JOIN LATERAL jsonb_array_elements(c->'billingContributionOrdinals') i
    CROSS JOIN LATERAL (SELECT c->'observations'->(i::text::integer) AS o) entry
  ) intervals;
  IF actual_range IS DISTINCT FROM tstzmultirange(expected_range)
    OR contributed_seconds IS DISTINCT FROM extract(epoch FROM upper(expected_range)-lower(expected_range))
  THEN RETURN NULL; END IF;

  SELECT q.* INTO request_row FROM public.grid_owner_data_requests q
  WHERE (q.company_id,q.id,q.request_scope)=(p_company,(reference_basis->>'requestId')::uuid,'billing_underlay')
    AND q.status IN ('sent','received') AND q.customer_id IS NOT NULL AND q.site_id IS NOT NULL
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- A previous underlay for the request keeps corrected sources out of finance.
  -- The original may replay through the native immutable calendar receipts.
  IF EXISTS (
    WITH RECURSIVE predecessors(id) AS (
      SELECT p_previous WHERE p_previous IS NOT NULL
      UNION
      SELECT r.predecessor_id FROM gridex_e66_intake.mixed_billing_replacements r
      JOIN predecessors c ON c.id=r.replacement_id WHERE r.company_id=p_company
    )
    SELECT FROM public.billing_underlays b
    WHERE (b.company_id,b.source_request_id)=(p_company,request_row.id)
      AND NOT EXISTS (SELECT FROM predecessors x WHERE x.id=b.id)
      AND (b.payload->>'edielMessageId') IS DISTINCT FROM p_source::text)
  THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('contracts',finance_contracts,'basisHashes',basis_hashes,
    'sentSourceId',reference_basis->>'sentSourceId','sentHash',reference_basis->>'sentHash',
    'requestedFrom',lower(expected_range),'requestedUntil',upper(expected_range),
    'context',jsonb_build_object(
      'requestScope','billing_underlay','capability','write','sourceRequestId',request_row.id,
      'customerId',request_row.customer_id,'siteId',request_row.site_id,'customerSiteId',request_row.site_id,
      'meteringPointId',request_row.metering_point_id,'gridOwnerId',request_row.grid_owner_id,
      'periodStart',lower(expected_range),'periodEnd',upper(expected_range),'currency','SEK','status','received','sourceSystem','ediel_utilts'));
END
$admit$;
REVOKE ALL ON FUNCTION gridex_e66_intake.mixed_billing_admission_v2(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Reuse the current calendar writer's storage algorithm for explicit legacy replacement.
-- Its publicly used ordinary owner remains unchanged. The cloned path cannot create a multisource projection.
DO $legacy_replacement$
DECLARE
  ordinary regprocedure:='gridex_e66_intake.consume_owned_utilts_billing_v1(uuid,uuid,uuid,jsonb)';
  f record;
  generated text;
  definition text;
  original_header constant text:='FUNCTION gridex_e66_intake.consume_owned_utilts_billing_v1(p_company_id uuid, p_source_message_id uuid, p_actor_id uuid, p_expected_contracts jsonb)';
  replacement_header constant text:='FUNCTION gridex_e66_intake.consume_owned_utilts_billing_v2(p_company_id uuid, p_source_message_id uuid, p_actor_id uuid, p_expected_contracts jsonb, p_previous uuid)';
  original_admission constant text:=$old$  mixed_admission:=gridex_e66_intake.mixed_billing_admission_v1(p_company_id,p_source_message_id,p_actor_id);
  IF mixed_admission IS NULL THEN
    v_multi:=gridex_e66_intake.prepare_mixed_billing_v2(p_company_id,p_source_message_id,p_actor_id);
    IF v_multi IS NULL THEN RETURN NULL; END IF;
  END IF;
 END IF;$old$;
  replacement_admission constant text:=$new$  IF p_previous IS NULL THEN RETURN NULL; END IF;
  mixed_admission:=gridex_e66_intake.mixed_billing_admission_v2(p_company_id,p_source_message_id,p_actor_id,p_previous);
  IF mixed_admission IS NULL THEN RETURN NULL; END IF;
 ELSE
  RETURN NULL;
 END IF;$new$;
BEGIN
  SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT f FROM pg_proc p WHERE p.oid=ordinary;
  IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') <> 'ae7db9101badc708e2a23776636b5f2583fcd9c7a043459f4b24965d69fb663a'
    OR strpos(f.definition,original_header)=0 OR strpos(f.prosrc,original_admission)=0
    OR to_regprocedure('gridex_e66_intake.consume_owned_utilts_billing_v2(uuid,uuid,uuid,jsonb,uuid)') IS NOT NULL
  THEN RAISE EXCEPTION 'mixed_e66_legacy_replacement_writer_preimage_changed'; END IF;
  generated:=replace(f.prosrc,original_admission,replacement_admission);
  IF strpos(generated,'prepare_mixed_billing_v2(')<>0 OR strpos(generated,'v_multi:=')<>0
  THEN RAISE EXCEPTION 'mixed_e66_legacy_replacement_multisource_path'; END IF;
  definition:=replace(replace(f.definition,original_header,replacement_header),f.prosrc,generated);
  EXECUTE definition;
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.prosrc
    OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata
  THEN RAISE EXCEPTION 'mixed_e66_ordinary_writer_changed'; END IF;
END
$legacy_replacement$;
REVOKE ALL ON FUNCTION gridex_e66_intake.consume_owned_utilts_billing_v2(uuid,uuid,uuid,jsonb,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_prepare_mixed_e66_finance_replacement_v1(
  p_company uuid,p_mailbox uuid,p_actor uuid,p_source uuid,p_predecessor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $replace$
DECLARE
  prior public.billing_underlays;
  fresh public.billing_underlays;
  relation gridex_e66_intake.mixed_billing_replacements;
  source_receipt gridex_e66_intake.billing_calendar_receipts;
  scoped jsonb;
  original_contracts jsonb;
  old_hash text;
  new_hash text;
  allowed boolean;
BEGIN
  PERFORM gridex_e66_intake.require_dispatch_scope(p_company,'test',p_mailbox,p_actor);
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  IF public.gridex_actor_has_company_permission(p_actor,p_company,'billing_underlay.write') IS NOT TRUE THEN
    RAISE EXCEPTION 'mixed_billing_replacement_forbidden' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM gridex_e66_intake.work w
   JOIN gridex_e66_intake.mixed_qualification_receipts q ON q.source_id=w.source_id AND q.actor_id=p_actor
   WHERE (w.company_id,w.mailbox_id,w.environment,w.source_id,w.phase)=(p_company,p_mailbox,'test',p_source,'mixed_qualified')
   FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','held','reason','correction_source_unavailable'); END IF;
  SELECT b.* INTO prior FROM public.billing_underlays b WHERE (b.company_id,b.id)=(p_company,p_predecessor) FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','held','reason','predecessor_unavailable'); END IF;
  SELECT c.* INTO source_receipt FROM gridex_e66_intake.billing_calendar_receipts c
    WHERE (c.company_id,c.underlay_id,c.environment)=(p_company,p_predecessor,'test');
  old_hash:=gridex_e66_intake.bound_underlay_fingerprint_v1(p_company,source_receipt.source_id,p_predecessor);
  IF old_hash IS NULL OR prior.payload#>>'{e73BillingScope,basisVersion}' IS DISTINCT FROM 'mixed-e73-ide-finance-v1'
    OR source_receipt.source_id=p_source
    OR (SELECT count(*) FROM gridex_e66_intake.billing_calendar_receipts c
      WHERE (c.company_id,c.source_id,c.environment)=(p_company,source_receipt.source_id,'test'))<>1
  THEN RETURN jsonb_build_object('kind','held','reason','predecessor_not_exact_single_month'); END IF;

  SELECT * INTO relation FROM gridex_e66_intake.mixed_billing_replacements e WHERE e.predecessor_id=p_predecessor;
  IF FOUND THEN
    IF (relation.company_id,relation.source_id,relation.actor_id,relation.old_fingerprint) IS DISTINCT FROM (p_company,p_source,p_actor,old_hash)
      OR relation.new_fingerprint IS DISTINCT FROM gridex_e66_intake.bound_underlay_fingerprint_v1(p_company,p_source,relation.replacement_id)
    THEN RETURN jsonb_build_object('kind','held','reason','replacement_conflict'); END IF;
    IF EXISTS (SELECT FROM gridex_e66_intake.mixed_billing_correction_holds h
      WHERE (h.company_id,h.underlay_id)=(p_company,relation.replacement_id)) THEN
      RETURN jsonb_build_object('kind','held','reason','replacement_requires_new_correction_review');
    END IF;
    RETURN jsonb_build_object('kind','prepared','replacementId',relation.replacement_id,'replayed',true,'approvalRequired',true);
  END IF;

  IF (prior.status,prior.readiness_status) IS DISTINCT FROM ('received','not_checked')
    OR EXISTS (SELECT FROM public.customer_invoices i WHERE (i.company_id,i.billing_underlay_id)=(p_company,p_predecessor))
    OR EXISTS (SELECT FROM public.invoice_export_items i WHERE (i.company_id,i.billing_underlay_id)=(p_company,p_predecessor))
    OR EXISTS (SELECT FROM gridex_invoice_groups.sources i WHERE (i.company_id,i.billing_underlay_id)=(p_company,p_predecessor))
    OR EXISTS (SELECT FROM public.partner_exports i WHERE (i.company_id,i.billing_underlay_id)=(p_company,p_predecessor))
    OR EXISTS (SELECT FROM public.billing_export_run_items i WHERE (i.company_id,i.billing_underlay_id)=(p_company,p_predecessor))
    OR EXISTS (SELECT FROM gridex_billing_source.underlay_bindings i WHERE (i.company_id,i.underlay_id)=(p_company,p_predecessor))
  THEN RETURN jsonb_build_object('kind','held','reason','financial_history_requires_review'); END IF;

  scoped:=gridex_e66_intake.mixed_billing_admission_v2(p_company,p_source,p_actor,p_predecessor);
  IF scoped IS NULL OR (scoped#>>'{context,sourceRequestId}',scoped->>'sentSourceId',scoped->>'sentHash')
    IS DISTINCT FROM (prior.source_request_id::text,prior.payload#>>'{e73BillingScope,sentSourceId}',prior.payload#>>'{e73BillingScope,sentHash}')
  THEN RETURN jsonb_build_object('kind','held','reason','current_e73_basis_unavailable'); END IF;

  WITH old_contributors AS (
    SELECT (item->>'normalizedId')::uuid AS id
    FROM gridex_e66_intake.mixed_e73_request_basis b CROSS JOIN LATERAL jsonb_array_elements(b.evidence->'childEffects') item
    WHERE b.source_id=source_receipt.source_id AND b.request_id=prior.source_request_id AND b.company_id=p_company
      AND prior.payload#>'{e73BillingScope,ideBasisHashes}' @> jsonb_build_array(jsonb_build_array(b.transaction_id,b.evidence_sha256))
      AND prior.payload#>'{billingCalendar,contributors}' @> jsonb_build_array(jsonb_build_array(b.transaction_id,(item->>'ordinal')::integer))
  ), new_contributors AS (
    SELECT (item->>'normalizedId')::uuid AS id
    FROM jsonb_array_elements(scoped->'contracts') c CROSS JOIN LATERAL jsonb_array_elements(c->'billingContributionOrdinals') ordinal
    JOIN gridex_e66_intake.mixed_e73_request_basis b ON b.source_id=p_source AND b.transaction_id=c->>'transactionId'
    CROSS JOIN LATERAL jsonb_array_elements(b.evidence->'childEffects') item
    WHERE b.company_id=p_company AND b.request_id=prior.source_request_id AND item->>'ordinal'=ordinal::text
  ), pairs AS (
    SELECT o.id AS old_id,n.id AS new_id,h.new_normalized_value_id AS sealed
    FROM old_contributors a JOIN public.normalized_metering_values o ON (o.company_id,o.id)=(p_company,a.id)
    JOIN public.normalized_metering_values n ON (n.company_id,n.metering_point_id,n.period_start,n.period_end)
      =(o.company_id,o.metering_point_id,o.period_start,o.period_end) AND n.revision_status='current'
    JOIN new_contributors b ON b.id=n.id
    LEFT JOIN gridex_e66_intake.mixed_billing_correction_holds h
      ON (h.company_id,h.underlay_id,h.previous_normalized_value_id,h.new_normalized_value_id,h.new_source_id)
        =(p_company,p_predecessor,o.id,n.id,p_source)
      AND h.underlay_fingerprint=source_receipt.row_fingerprint
  )
  SELECT count(*)=prior.source_meter_value_count AND count(*)=(SELECT count(*) FROM new_contributors)
    AND count(*)=(SELECT count(*) FROM old_contributors) AND bool_and(old_id=new_id OR sealed=new_id)
    AND bool_or(old_id<>new_id)
  INTO allowed FROM pairs;
  IF allowed IS NOT TRUE THEN RETURN jsonb_build_object('kind','held','reason','exact_correction_lineage_required'); END IF;

  SELECT jsonb_agg(gridex_utilts_binding.stored_contract_v1(p_company,p_source,t.transaction_id) ORDER BY t.transaction_id)
    INTO original_contracts FROM gridex_e66_intake.mixed_accepted_transactions t WHERE t.source_id=p_source;
  fresh:=gridex_e66_intake.consume_owned_utilts_billing_v2(p_company,p_source,p_actor,original_contracts,p_predecessor);
  new_hash:=gridex_e66_intake.bound_underlay_fingerprint_v1(p_company,p_source,fresh.id);
  IF new_hash IS NULL OR (fresh.underlay_year,fresh.underlay_month) IS DISTINCT FROM (prior.underlay_year,prior.underlay_month) THEN
    RAISE EXCEPTION 'mixed_billing_replacement_not_sealed' USING ERRCODE='55000';
  END IF;
  INSERT INTO gridex_e66_intake.mixed_billing_replacements
    (predecessor_id,replacement_id,company_id,source_id,actor_id,old_fingerprint,new_fingerprint)
  VALUES (p_predecessor,fresh.id,p_company,p_source,p_actor,old_hash,new_hash);
  RETURN jsonb_build_object('kind','prepared','replacementId',fresh.id,'replayed',false,'approvalRequired',true);
END
$replace$;
REVOKE ALL ON FUNCTION public.gridex_prepare_mixed_e66_finance_replacement_v1(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_prepare_mixed_e66_finance_replacement_v1(uuid,uuid,uuid,uuid,uuid) TO service_role;
