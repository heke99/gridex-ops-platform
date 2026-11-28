-- The same-meter TEST price series keeps its own reservation and document custody.
DO $migration$
BEGIN
CREATE TABLE gridex_billing_source.price_series_invoice_issues (
  company_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES gridex_billing_source.price_series_invoice_drafts(invoice_id),
  review_hash text NOT NULL CHECK (review_hash ~ '^[0-9a-f]{64}$'),
  calculation_sha256 text NOT NULL CHECK (calculation_sha256 ~ '^[0-9a-f]{64}$'),
  series_key text NOT NULL,
  invoice_number text NOT NULL CHECK (btrim(invoice_number)<>''),
  actor_user_id uuid NOT NULL,
  effective_at timestamptz NOT NULL,
  due_date date NOT NULL,
  payment_configuration_evidence jsonb NOT NULL CHECK (
    jsonb_typeof(payment_configuration_evidence)='array' AND jsonb_array_length(payment_configuration_evidence)>=2
  ),
  body bytea NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256=encode(sha256(body),'hex')),
  PRIMARY KEY(company_id,reservation_id),
  UNIQUE(company_id,invoice_id),
  UNIQUE(company_id,invoice_number),
  FOREIGN KEY (company_id,reservation_id)
    REFERENCES gridex_billing_source.price_series_invoice_approvals(company_id,reservation_id)
);

CREATE TABLE gridex_billing_source.price_series_invoice_neutral_files (
  company_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  file_id uuid NOT NULL DEFAULT gen_random_uuid(),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,invoice_id),
  UNIQUE(company_id,file_id),
  FOREIGN KEY (company_id,invoice_id)
    REFERENCES gridex_billing_source.price_series_invoice_issues(company_id,invoice_id)
);
ALTER TABLE gridex_billing_source.price_series_invoice_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_billing_source.price_series_invoice_neutral_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_billing_source.price_series_invoice_issues,
  gridex_billing_source.price_series_invoice_neutral_files FROM PUBLIC,anon,authenticated,service_role;

EXECUTE $ddl$
  CREATE FUNCTION gridex_billing_source.price_series_issue_result_v1(
    issued gridex_billing_source.price_series_invoice_issues, replayed boolean
  ) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO pg_catalog
  AS $body$
    SELECT jsonb_build_object('invoiceId',issued.invoice_id,'reviewHash',issued.review_hash,'outcome','issued',
      'invoiceNumber',issued.invoice_number,'dueDate',issued.due_date,'actorUserId',issued.actor_user_id,
      'effectiveAt',issued.effective_at,'existing',replayed)
  $body$
$ddl$;
EXECUTE $ddl$
  CREATE FUNCTION gridex_billing_source.price_series_payment_terms_v1(p_company uuid,p_reservation uuid)
  RETURNS jsonb LANGUAGE sql STABLE SET search_path TO pg_catalog
  AS $body$
    SELECT CASE WHEN count(*)>=2 AND count(terms.days)=count(*) AND min(terms.days)=max(terms.days)
      THEN jsonb_build_object('days',min(terms.days),'configurations',jsonb_agg(jsonb_build_object(
        'underlayId',member.billing_underlay_id,'sha256',underlay.billing_configuration_snapshot_sha256) ORDER BY member.ordinal)) END
    FROM gridex_billing_source.price_series_reservations reservation
    JOIN gridex_billing_source.price_series_reservation_members member
      ON (member.company_id,member.reservation_id)=(reservation.company_id,reservation.id)
    LEFT JOIN public.billing_underlays underlay ON underlay.company_id=member.company_id AND underlay.id=member.billing_underlay_id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN underlay.billing_configuration_snapshot->>'schema'='billing_configuration_v1'
        AND underlay.billing_configuration_snapshot->>'company_id'=reservation.company_id::text
        AND underlay.billing_configuration_snapshot->>'customer_id'=reservation.customer_id::text
        AND underlay.billing_configuration_snapshot->>'contract_id'=reservation.contract_id::text
        AND underlay.billing_configuration_snapshot#>>'{provider,provider}'='file_export'
        AND underlay.billing_configuration_snapshot#>>'{provider,environment}'='test'
        AND underlay.billing_configuration_snapshot#>>'{payment_terms,defaulted}'='false'
        AND underlay.billing_configuration_snapshot_sha256 ~ '^[0-9a-f]{64}$'
        AND underlay.billing_configuration_snapshotted_at IS NOT NULL
        AND (underlay.billing_configuration_snapshot#>>'{payment_terms,dueDays}') ~ '^[0-9]{1,9}$'
      THEN (underlay.billing_configuration_snapshot#>>'{payment_terms,dueDays}')::integer END AS days
    ) terms
    WHERE (reservation.company_id,reservation.id)=(p_company,p_reservation)
  $body$
$ddl$;
EXECUTE $ddl$
  CREATE FUNCTION gridex_billing_source.price_series_issue_periods_v1(
    reservation gridex_billing_source.price_series_reservations
  ) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO pg_catalog
  AS $body$
    SELECT jsonb_agg(jsonb_build_object(
      'facilityReference',site.facility_reference,
      'sourceReference',gridex_invoice_groups.public_source_reference(member.company_id,member.billing_underlay_id),
      'periodStartAt',frozen.value->>'from',
      'periodEndExclusiveAt',frozen.value->>'until',
      'periodStartDate',((frozen.value->>'from')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date,
      'periodEndExclusiveDate',((frozen.value->>'until')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date,
      'lastIncludedDate',(((frozen.value->>'until')::timestamptz-interval '1 microsecond') AT TIME ZONE 'Europe/Stockholm')::date,
      'priceArea',underlay.price_area,'quantityKwh',frozen.value->>'quantityKwh',
      'amountExVat',frozen.value->>'amountExVat','vatAmount',frozen.value->>'lockedVatAmount',
      'amountIncVat',frozen.value->>'lockedAmountIncVat','pricing',lines.pricing) ORDER BY member.ordinal)
    FROM gridex_billing_source.price_series_reservation_members member
    JOIN public.billing_underlays underlay ON (underlay.company_id,underlay.id)=(member.company_id,member.billing_underlay_id)
    JOIN public.customer_sites site ON (site.company_id,site.customer_id,site.id)=(reservation.company_id,reservation.customer_id,reservation.site_id)
    CROSS JOIN LATERAL (SELECT reservation.basis->'members'->(member.ordinal-1) AS value) frozen
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('description',line.description,'quantity',line.quantity::text,
        'unit',line.unit,'unitPriceExVat',line.unit_price_ex_vat::text,'exVat',line.amount_ex_vat::text,
        'vat',line.vat_amount::text,'total',line.amount_inc_vat::text) ORDER BY line.sort_order,line.id) AS pricing,
        sum(line.amount_ex_vat) AS net,sum(line.vat_amount) AS vat,sum(line.amount_inc_vat) AS gross
      FROM public.pricing_preview_lines line
      WHERE (line.company_id,line.pricing_run_id,line.billing_underlay_id)=(member.company_id,member.pricing_run_id,member.billing_underlay_id)
      HAVING bool_and(btrim(line.description)<>'')
    ) lines
    WHERE (member.company_id,member.reservation_id)=(reservation.company_id,reservation.id)
      AND (frozen.value->>'underlayId',frozen.value->>'pricingRunId')=(member.billing_underlay_id::text,member.pricing_run_id::text)
      AND (lines.net,lines.vat,lines.gross)=((frozen.value->>'amountExVat')::numeric,
        (frozen.value->>'lockedVatAmount')::numeric,(frozen.value->>'lockedAmountIncVat')::numeric)
      AND btrim(site.facility_reference)<>'' AND underlay.price_area IN ('SE1','SE2','SE3','SE4')
  $body$
$ddl$;
EXECUTE $ddl$
  CREATE FUNCTION gridex_billing_source.finish_test_price_series_invoice_v1(
    p_company uuid,p_invoice uuid,p_actor uuid,p_review text,p_outcome text
  ) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog SET "TimeZone" TO 'UTC'
  AS $body$
  DECLARE
    draft gridex_billing_source.price_series_invoice_drafts%rowtype;
    reservation gridex_billing_source.price_series_reservations%rowtype;
    issued gridex_billing_source.price_series_invoice_issues%rowtype;
    invoice public.customer_invoices%rowtype;
    members jsonb;
    member_ids uuid[];
    periods jsonb;
    token jsonb;
    terms jsonb;
    due date;
    series text;
    issue_number text;
    issue_time timestamptz:=transaction_timestamp();
    frozen bytea;
    projected integer;
  BEGIN
    PERFORM gridex_billing_source.require_test_price_series_actor_v1(p_company,p_actor);
    SELECT * INTO STRICT draft FROM gridex_billing_source.price_series_invoice_drafts
      WHERE (company_id,invoice_id)=(p_company,p_invoice);
    IF draft.review_hash IS DISTINCT FROM p_review THEN
      RAISE EXCEPTION 'invoice_group_review_changed' USING ERRCODE='40001';
    END IF;
    SELECT * INTO issued FROM gridex_billing_source.price_series_invoice_issues
      WHERE (company_id,reservation_id)=(p_company,draft.reservation_id);
    IF FOUND THEN
      IF p_outcome='cancelled' THEN RAISE EXCEPTION 'invoice_group_issued_credit_required' USING ERRCODE='55000'; END IF;
      IF (issued.invoice_id,issued.review_hash) IS DISTINCT FROM (p_invoice,p_review) THEN
        RAISE EXCEPTION 'invoice_group_review_changed' USING ERRCODE='40001';
      END IF;
      RETURN gridex_billing_source.price_series_issue_result_v1(issued,true);
    END IF;
    IF p_outcome IS DISTINCT FROM 'issued' THEN
      RAISE EXCEPTION 'invoice_group_issue_input_invalid' USING ERRCODE='22023';
    END IF;

    SELECT * INTO STRICT reservation FROM gridex_billing_source.price_series_reservations
      WHERE (company_id,id)=(p_company,draft.reservation_id);
    PERFORM gridex_invoice_groups.lock_period(p_company,reservation.billing_month);
    -- An earlier identical call may have committed while this call entered the period.
    SELECT * INTO issued FROM gridex_billing_source.price_series_invoice_issues
      WHERE (company_id,reservation_id)=(p_company,draft.reservation_id);
    IF FOUND THEN
      IF (issued.invoice_id,issued.review_hash) IS DISTINCT FROM (p_invoice,p_review) THEN
        RAISE EXCEPTION 'invoice_group_review_changed' USING ERRCODE='40001';
      END IF;
      RETURN gridex_billing_source.price_series_issue_result_v1(issued,true);
    END IF;
    IF EXISTS (SELECT FROM public.billing_period_locks l WHERE l.company_id=p_company
          AND l.billing_year=split_part(reservation.billing_month,'-',1)::integer
          AND l.billing_month=split_part(reservation.billing_month,'-',2)::integer AND l.status IN ('locked','exported','closed'))
      OR EXISTS (SELECT FROM public.price_period_locks l WHERE l.company_id=p_company AND l.billing_month=reservation.billing_month
          AND l.lock_scope IN ('billing_period','invoice_export') AND l.status='locked') THEN
      RAISE EXCEPTION 'invoice_group_issue_period_locked' USING ERRCODE='55000';
    END IF;
    IF NOT EXISTS(SELECT FROM gridex_billing_source.price_series_invoice_approvals a
      WHERE (a.company_id,a.reservation_id,a.review_hash)=(p_company,reservation.id,p_review)) THEN
      RAISE EXCEPTION 'invoice_group_issue_approval_required' USING ERRCODE='23514';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('underlayId',m.billing_underlay_id,'pricingRunId',m.pricing_run_id) ORDER BY m.ordinal),
      array_agg(m.billing_underlay_id ORDER BY m.ordinal)
    INTO members,member_ids FROM gridex_billing_source.price_series_reservation_members m
    WHERE (m.company_id,m.reservation_id)=(p_company,reservation.id);
    BEGIN
      token:=gridex_billing_source.reserve_price_series_v1(p_company,reservation.customer_id,reservation.contract_id,
        reservation.site_id,reservation.metering_point_id,reservation.billing_month,members);
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      RAISE EXCEPTION 'price_timeline_invoice_review_required' USING ERRCODE='23514';
    END;
    IF (token->>'id',token->>'basisSha256') IS DISTINCT FROM (reservation.id::text,reservation.basis_sha256) THEN
      RAISE EXCEPTION 'invoice_group_review_changed' USING ERRCODE='40001';
    END IF;
    IF EXISTS(SELECT FROM public.customer_contracts c WHERE (c.company_id,c.id)=(p_company,reservation.contract_id)
      AND (c.export_blocked IS TRUE OR c.consolidated_invoice IS TRUE)) THEN
      RAISE EXCEPTION 'invoice_price_series_separate_billing_required' USING ERRCODE='23514';
    END IF;
    PERFORM gridex_billing_source.assert_invoice_sources_uncorrected_v1(p_company,member_ids);
    PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,NULL,p_invoice);
    PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,member) FROM unnest(member_ids) member;
    PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company,member) FROM unnest(member_ids) member;

    SELECT * INTO invoice FROM public.customer_invoices i
      WHERE (i.company_id,i.id,i.customer_id)=(p_company,p_invoice,reservation.customer_id) FOR UPDATE;
    IF invoice.id IS NULL OR invoice.status IS DISTINCT FROM 'draft' OR invoice.invoice_number IS NOT NULL
      OR invoice.source_system IS DISTINCT FROM 'invoice_price_series_test_v1' OR invoice.currency IS DISTINCT FROM 'SEK'
      OR btrim(coalesce(invoice.invoice_reference,''))=''
      OR (invoice.amount_ex_vat,invoice.vat_amount,invoice.amount_inc_vat,invoice.total_kwh) IS DISTINCT FROM (
        (reservation.basis->>'amountExVat')::numeric,(invoice.calculation_snapshot->>'vatAmount')::numeric,
        (invoice.calculation_snapshot->>'amountIncVat')::numeric,(reservation.basis->>'quantityKwh')::numeric)
      OR (invoice.calculation_snapshot->'basis',invoice.calculation_snapshot->>'basisSha256')
           IS DISTINCT FROM (reservation.basis,reservation.basis_sha256)
      OR invoice.calculation_snapshot_sha256 IS DISTINCT FROM encode(sha256(convert_to(invoice.calculation_snapshot::text,'UTF8')),'hex')
      OR draft.review_hash IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_array(
        p_company,reservation.id,p_invoice,invoice.calculation_snapshot_sha256)::text,'UTF8')),'hex') THEN
      RAISE EXCEPTION 'invoice_group_review_changed' USING ERRCODE='40001';
    END IF;
    terms:=gridex_billing_source.price_series_payment_terms_v1(p_company,reservation.id);
    IF terms IS NULL THEN RAISE EXCEPTION 'invoice_group_issuer_terms_missing' USING ERRCODE='23514'; END IF;
    periods:=gridex_billing_source.price_series_issue_periods_v1(reservation);
    IF jsonb_array_length(periods) IS DISTINCT FROM cardinality(member_ids) THEN
      RAISE EXCEPTION 'invoice_group_issue_document_source_missing' USING ERRCODE='23514';
    END IF;
    series:=gridex_invoice_groups.qualified_internal_series(p_company,'test');
    IF series IS NULL THEN RAISE EXCEPTION 'invoice_group_issue_issuer_required' USING ERRCODE='23514'; END IF;
    PERFORM 1 FROM public.company_number_sequences s WHERE (s.company_id,s.sequence_key)=(p_company,series)
      AND s.metadata#>>'{invoice_issuer,company_id}'=p_company::text
      AND s.metadata#>>'{invoice_issuer,environment}'='test' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_issue_issuer_required' USING ERRCODE='23514'; END IF;
    due:=(issue_time AT TIME ZONE 'Europe/Stockholm')::date+(terms->>'days')::integer;
    issue_number:=public.gridex_next_document_number(p_company,series,NULL);
    IF NOT pg_try_advisory_xact_lock(hashtextextended(p_company::text||':issued-invoice-number:'||issue_number,0)) THEN
      RAISE EXCEPTION 'invoice_group_number_busy' USING ERRCODE='55P03';
    END IF;
    IF EXISTS(SELECT FROM public.customer_invoices i WHERE (i.company_id,i.invoice_number)=(p_company,issue_number)) THEN
      RAISE EXCEPTION 'invoice_group_number_collision' USING ERRCODE='23505';
    END IF;
    frozen:=convert_to(jsonb_build_object('format','gridex_customer_price_series_invoice_test_v1','environment','test',
      'invoiceReference',invoice.invoice_reference,'invoiceNumber',issue_number,
      'issuedDate',(issue_time AT TIME ZONE 'Europe/Stockholm')::date,'dueDate',due,
      'currency',invoice.currency,'quantityKwh',invoice.total_kwh::text,'amountExVat',invoice.amount_ex_vat::text,
      'vatAmount',invoice.vat_amount::text,'amountIncVat',invoice.amount_inc_vat::text,'periods',periods)::text,'UTF8');
    INSERT INTO gridex_billing_source.price_series_invoice_issues(
      company_id,reservation_id,invoice_id,review_hash,calculation_sha256,series_key,invoice_number,
      actor_user_id,effective_at,due_date,payment_configuration_evidence,body,body_sha256
    ) VALUES(p_company,reservation.id,p_invoice,p_review,invoice.calculation_snapshot_sha256,series,issue_number,
      p_actor,issue_time,due,terms->'configurations',frozen,encode(sha256(frozen),'hex')) RETURNING * INTO issued;
    UPDATE public.customer_invoices SET status='issued',invoice_number=issue_number,issued_at=issue_time,
      due_date=due,updated_by=p_actor,updated_at=issue_time WHERE (company_id,id)=(p_company,p_invoice);
    UPDATE public.billing_underlays u SET invoice_readiness_status='invoiced',invoice_readiness_issues='[]'::jsonb,
      invoice_export_locked_at=coalesce(u.invoice_export_locked_at,issue_time),updated_at=issue_time
      WHERE u.company_id=p_company AND u.id=ANY(member_ids) AND u.customer_id=reservation.customer_id;
    SELECT count(*) INTO projected FROM public.billing_underlays u
    WHERE u.company_id=p_company AND u.id=ANY(member_ids) AND u.customer_id=reservation.customer_id
      AND u.invoice_readiness_status='invoiced' AND u.invoice_readiness_issues='[]'::jsonb
      AND u.invoice_export_locked_at IS NOT NULL AND u.updated_at=issue_time;
    IF projected<>cardinality(member_ids) THEN
      RAISE EXCEPTION 'invoice_group_issue_source_projection_missing' USING ERRCODE='23514';
    END IF;
    RETURN gridex_billing_source.price_series_issue_result_v1(issued,false);
  END
  $body$
$ddl$;
EXECUTE $ddl$
  CREATE FUNCTION gridex_billing_source.verified_price_series_issue_v1(p_company uuid,p_invoice uuid,p_review text)
  RETURNS gridex_billing_source.price_series_invoice_issues LANGUAGE plpgsql SET search_path TO pg_catalog
  AS $body$
  DECLARE
    issued gridex_billing_source.price_series_invoice_issues%rowtype;
    source_id uuid;
    checked integer:=0;
    body jsonb;
  BEGIN
    SELECT o.* INTO issued FROM gridex_billing_source.price_series_invoice_issues o
    JOIN gridex_billing_source.price_series_invoice_drafts d
      ON (d.company_id,d.reservation_id,d.invoice_id,d.review_hash)=(o.company_id,o.reservation_id,o.invoice_id,o.review_hash)
    JOIN public.customer_invoices i ON (i.company_id,i.id)=(d.company_id,d.invoice_id)
    WHERE (o.company_id,o.invoice_id)=(p_company,p_invoice)
      AND (p_review IS NULL OR o.review_hash=p_review)
      AND (i.invoice_number,i.calculation_snapshot_sha256)=(o.invoice_number,o.calculation_sha256)
      AND i.source_system='invoice_price_series_test_v1' AND i.status='issued';
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_file_not_issued' USING ERRCODE='23514'; END IF;
    PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,NULL,p_invoice);
    FOR source_id IN SELECT m.billing_underlay_id FROM gridex_billing_source.price_series_reservation_members m
      WHERE (m.company_id,m.reservation_id)=(issued.company_id,issued.reservation_id) ORDER BY m.ordinal LOOP
      PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,source_id);
      checked:=checked+1;
    END LOOP;
    body:=convert_from(issued.body,'UTF8')::jsonb;
    IF issued.body_sha256 IS DISTINCT FROM encode(sha256(issued.body),'hex')
      OR body->>'format' IS DISTINCT FROM 'gridex_customer_price_series_invoice_test_v1'
      OR body->>'environment' IS DISTINCT FROM 'test' OR body->>'invoiceNumber' IS DISTINCT FROM issued.invoice_number
      OR checked<2 OR jsonb_array_length(body->'periods') IS DISTINCT FROM checked THEN
      RAISE EXCEPTION 'invoice_group_file_source_invalid' USING ERRCODE='23514';
    END IF;
    RETURN issued;
  END
  $body$
$ddl$;
EXECUTE $ddl$
  CREATE FUNCTION gridex_billing_source.create_price_series_neutral_file_v1(p_company uuid,p_invoice uuid,p_actor uuid,p_review text)
  RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog
  AS $body$
  DECLARE
    file gridex_billing_source.price_series_invoice_neutral_files%rowtype;
    issued gridex_billing_source.price_series_invoice_issues%rowtype;
    existing_file boolean;
    members uuid[];
  BEGIN
    PERFORM gridex_billing_source.require_test_price_series_actor_v1(p_company,p_actor);
    PERFORM 1 FROM gridex_billing_source.price_series_invoice_drafts
      WHERE (company_id,invoice_id)=(p_company,p_invoice) FOR UPDATE;
    issued:=gridex_billing_source.verified_price_series_issue_v1(p_company,p_invoice,p_review);
    SELECT * INTO file FROM gridex_billing_source.price_series_invoice_neutral_files
      WHERE (company_id,invoice_id)=(p_company,p_invoice);
    existing_file:=FOUND;
    IF NOT existing_file THEN
      SELECT array_agg(m.billing_underlay_id ORDER BY m.ordinal) INTO members
      FROM gridex_billing_source.price_series_reservation_members m
      WHERE (m.company_id,m.reservation_id)=(issued.company_id,issued.reservation_id);
      PERFORM gridex_billing_source.assert_invoice_sources_uncorrected_v1(p_company,members);
      PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company,member) FROM unnest(members) member;
      INSERT INTO gridex_billing_source.price_series_invoice_neutral_files(company_id,invoice_id,body_sha256,created_by)
      VALUES(p_company,p_invoice,issued.body_sha256,p_actor) RETURNING * INTO file;
      INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,metadata)
      VALUES(p_company,p_actor,'invoice_group_neutral_file',file.file_id::text,
        'invoice_group_neutral_file_created',jsonb_build_object('invoiceId',p_invoice,'sha256',file.body_sha256));
    END IF;
    IF file.body_sha256 IS DISTINCT FROM issued.body_sha256 THEN
      RAISE EXCEPTION 'invoice_group_file_receipt_invalid' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('fileId',file.file_id,'invoiceId',file.invoice_id,'sha256',file.body_sha256,'existing',existing_file);
  END
  $body$
$ddl$;
EXECUTE $ddl$
  CREATE FUNCTION gridex_billing_source.read_price_series_neutral_file_v1(p_company uuid,p_file uuid)
  RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog
  AS $body$
  DECLARE
    file gridex_billing_source.price_series_invoice_neutral_files%rowtype;
    issued gridex_billing_source.price_series_invoice_issues%rowtype;
  BEGIN
    SELECT * INTO file FROM gridex_billing_source.price_series_invoice_neutral_files
      WHERE (company_id,file_id)=(p_company,p_file);
    IF NOT FOUND THEN RETURN NULL; END IF;
    issued:=gridex_billing_source.verified_price_series_issue_v1(p_company,file.invoice_id,NULL);
    IF file.body_sha256 IS DISTINCT FROM issued.body_sha256 THEN
      RAISE EXCEPTION 'invoice_group_file_receipt_invalid' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('fileId',file.file_id,'invoiceId',file.invoice_id,'sha256',file.body_sha256,
      'bodyBase64',replace(encode(issued.body,'base64'),E'\n',''));
  END
  $body$
$ddl$;
EXECUTE $ddl$
  CREATE FUNCTION gridex_billing_source.read_price_series_customer_document_v1(p_company uuid,p_customers uuid[],p_invoice uuid)
  RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog
  AS $body$
  DECLARE
    invoice_customer uuid;
    issued gridex_billing_source.price_series_invoice_issues%rowtype;
  BEGIN
    SELECT i.customer_id INTO invoice_customer FROM public.customer_invoices i
    JOIN gridex_billing_source.price_series_invoice_issues o ON (o.company_id,o.invoice_id)=(i.company_id,i.id)
    WHERE (i.company_id,i.id)=(p_company,p_invoice) AND i.customer_id=ANY(p_customers) AND i.status='issued';
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM public.ediel_require_portal_retention_access_v1(p_company,invoice_customer);
    BEGIN
      issued:=gridex_billing_source.verified_price_series_issue_v1(p_company,p_invoice,NULL);
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM='finance_copy_retention_tombstoned' THEN RETURN jsonb_build_object('kind','retired'); END IF;
      RAISE;
    END;
    RETURN jsonb_build_object('kind','ready','bodyBase64',encode(issued.body,'base64'),'sha256',issued.body_sha256);
  END
  $body$
$ddl$;

REVOKE ALL ON FUNCTION
  gridex_billing_source.price_series_issue_result_v1(gridex_billing_source.price_series_invoice_issues,boolean),
  gridex_billing_source.price_series_payment_terms_v1(uuid,uuid),
  gridex_billing_source.price_series_issue_periods_v1(gridex_billing_source.price_series_reservations),
  gridex_billing_source.finish_test_price_series_invoice_v1(uuid,uuid,uuid,text,text),
  gridex_billing_source.verified_price_series_issue_v1(uuid,uuid,text),
  gridex_billing_source.create_price_series_neutral_file_v1(uuid,uuid,uuid,text),
  gridex_billing_source.read_price_series_neutral_file_v1(uuid,uuid),
  gridex_billing_source.read_price_series_customer_document_v1(uuid,uuid[],uuid)
FROM PUBLIC,anon,authenticated,service_role;

DECLARE
  owner record;
  body_before record;
  candidate text;
BEGIN
  FOR owner IN SELECT * FROM (VALUES
    ('finish','public.gridex_finish_consolidated_invoice_v1(uuid,uuid,uuid,text,text,text)',
      '0cc41d5e737876e59a74eed2d58d6a736d1a77e29c7ba65e205c74b539d26011'),
    ('file','public.gridex_create_consolidated_invoice_neutral_file_v1(uuid,uuid,uuid,text)',
      '75f40e7b78762883645541c68155e45bb4546142a5ca0beec7fe459fa92ce157'),
    ('read_file','public.gridex_read_consolidated_invoice_neutral_file_v1(uuid,uuid,uuid)',
      'dcd4d5ff6c64b7e6b3419fe843ee952959077b824c7475de829b88775ae526a0'),
    ('read_customer','public.gridex_read_consolidated_invoice_customer_document_v1(uuid,uuid[],uuid)',
      '916af5e8bb443235928e30042087769a7d5c9dc34b4da9044ac494405468ca73'),
    ('approve','gridex_billing_source.approve_test_price_series_invoice_v1(uuid,uuid,uuid,text)',
      'c2fd43d544e31ee30f2e8e8d60d40dcabf72414f8a03f5407b4655e8dac45c63'),
    ('list','gridex_billing_source.list_test_price_series_reviews_v1(uuid,text,uuid,uuid)',
      '2ade7989a7633b74c1b418fbc94ccd0975826311a07494ad55eb9034be303eb2'),
    ('protect','gridex_billing_source.protect_test_price_series_draft_v1()',
      '09ce56ccf38f21bf63913758fa5741c88a1cd85ae9f19829dcb9c2269cc7c61e'),
    ('project_underlay','gridex_billing_source.guard_price_timeline_invoice_hold_v1()',
      '44771dbc86e32afad70ecb2756ea4f9bd9093d8e3583eb555b941420dd28f629')
  ) functions(kind,signature,digest) LOOP
    SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
      INTO STRICT body_before FROM pg_proc p WHERE p.oid=owner.signature::regprocedure;
    IF encode(sha256(convert_to(body_before.prosrc,'UTF8')),'hex') IS DISTINCT FROM owner.digest THEN
      RAISE EXCEPTION 'price_series_issue_function_preimage_changed: %',owner.signature;
    END IF;
    candidate:=body_before.prosrc;
    CASE owner.kind
    WHEN 'finish' THEN
      candidate:=replace(candidate,$old$  SELECT * INTO draft FROM gridex_invoice_groups.drafts g$old$,$new$  IF EXISTS(SELECT FROM gridex_billing_source.price_series_invoice_drafts series
    WHERE (series.company_id,series.invoice_id)=(p_company_id,p_invoice_id)) THEN
    RETURN gridex_billing_source.finish_test_price_series_invoice_v1(p_company_id,p_invoice_id,p_actor_user_id,p_review_hash,p_outcome);
  END IF;
  SELECT * INTO draft FROM gridex_invoice_groups.drafts g$new$);
    WHEN 'file' THEN
      candidate:=replace(candidate,$old$  PERFORM 1 FROM gridex_invoice_groups.drafts$old$,$new$  IF EXISTS(SELECT FROM gridex_billing_source.price_series_invoice_drafts series
    WHERE (series.company_id,series.invoice_id)=(p_company_id,p_invoice_id)) THEN
    RETURN gridex_billing_source.create_price_series_neutral_file_v1(p_company_id,p_invoice_id,p_actor_user_id,p_review_hash);
  END IF;
  PERFORM 1 FROM gridex_invoice_groups.drafts$new$);
    WHEN 'read_file' THEN
      candidate:=replace(candidate,$old$  IF NOT FOUND THEN RETURN NULL; END IF;$old$,
        $new$  IF NOT FOUND THEN RETURN gridex_billing_source.read_price_series_neutral_file_v1(p_company_id,p_file_id); END IF;$new$);
    WHEN 'read_customer' THEN
      candidate:=replace(candidate,$old$ IF NOT FOUND THEN RETURN NULL; END IF;$old$,
        $new$ IF NOT FOUND THEN RETURN gridex_billing_source.read_price_series_customer_document_v1(p_company_id,p_customer_ids,p_invoice_id); END IF;$new$);
    WHEN 'approve' THEN
      candidate:=replace(candidate,$old$invoice.status<>'draft' OR invoice.invoice_number IS NOT NULL$old$,
        $new$NOT (
    (invoice.status='draft' AND invoice.invoice_number IS NULL) OR
    (invoice.status='issued' AND EXISTS(SELECT FROM gridex_billing_source.price_series_invoice_issues o
      WHERE (o.company_id,o.reservation_id,o.invoice_id,o.review_hash,o.invoice_number,o.calculation_sha256)
        =(p_company,reservation.id,p_invoice,p_review_hash,invoice.invoice_number,invoice.calculation_snapshot_sha256)))
  )$new$);
    WHEN 'list' THEN
      candidate:=replace(candidate,$old$'invoiceId',i.id,'invoiceNumber',NULL,'reviewHash',d.review_hash,'canIssue',false,'reviewType','test_price_series',
      'status',CASE WHEN a.reservation_id IS NULL THEN 'pending_review' ELSE 'approved' END,$old$,$new$'invoiceId',i.id,'invoiceNumber',issued.invoice_number,'reviewHash',d.review_hash,'canIssue',
        (issued.invoice_id IS NULL AND a.reservation_id IS NOT NULL AND co.is_active AND co.status='active'
         AND co.invoice_export_enabled
         AND gridex_invoice_groups.qualified_internal_series(d.company_id,'test') IS NOT NULL
         AND gridex_billing_source.price_series_payment_terms_v1(d.company_id,d.reservation_id) IS NOT NULL),
      'reviewType','test_price_series',
      'status',CASE WHEN issued.invoice_id IS NOT NULL THEN 'issued' WHEN a.reservation_id IS NULL THEN 'pending_review' ELSE 'approved' END,$new$);
      candidate:=replace(candidate,$old$    WHERE d.company_id=p_company AND r.billing_month=p_month$old$,$new$    LEFT JOIN gridex_billing_source.price_series_invoice_issues issued
      ON (issued.company_id,issued.reservation_id,issued.invoice_id)=(d.company_id,d.reservation_id,d.invoice_id)
    WHERE d.company_id=p_company AND r.billing_month=p_month$new$);
    WHEN 'project_underlay' THEN
      candidate:=replace(candidate,$old$  IF TG_TABLE_NAME='billing_underlays' THEN
   NEW.invoice_readiness_status:='blocked';$old$,$new$  IF TG_TABLE_NAME='billing_underlays' THEN
   IF TG_OP='UPDATE' AND OLD.invoice_readiness_status IS DISTINCT FROM 'invoiced'
    AND NEW.invoice_readiness_status='invoiced' AND NEW.invoice_readiness_issues='[]'::jsonb
    AND (to_jsonb(NEW)-ARRAY['invoice_readiness_status','invoice_readiness_issues','invoice_export_locked_at','updated_at'])=
        (to_jsonb(OLD)-ARRAY['invoice_readiness_status','invoice_readiness_issues','invoice_export_locked_at','updated_at'])
    AND EXISTS(
      SELECT FROM gridex_billing_source.price_series_reservation_members m
      JOIN gridex_billing_source.price_series_reservations r
        ON (r.company_id,r.id)=(m.company_id,m.reservation_id)
      JOIN gridex_billing_source.price_series_invoice_issues o
        ON (o.company_id,o.reservation_id)=(r.company_id,r.id)
      JOIN gridex_billing_source.price_series_invoice_drafts d
        ON (d.company_id,d.reservation_id,d.invoice_id,d.review_hash)=(o.company_id,o.reservation_id,o.invoice_id,o.review_hash)
      JOIN public.customer_invoices i ON (i.company_id,i.id)=(d.company_id,d.invoice_id)
      WHERE (m.company_id,m.billing_underlay_id,r.customer_id)=(NEW.company_id,NEW.id,NEW.customer_id)
        AND i.customer_id=r.customer_id AND i.source_system='invoice_price_series_test_v1' AND i.status='issued'
        AND (i.invoice_number,i.calculation_snapshot_sha256,i.issued_at)=(o.invoice_number,o.calculation_sha256,o.effective_at)
        AND NEW.updated_at=o.effective_at
        AND NEW.invoice_export_locked_at IS NOT DISTINCT FROM coalesce(OLD.invoice_export_locked_at,o.effective_at)
    ) THEN RETURN NEW; END IF;
   NEW.invoice_readiness_status:='blocked';$new$);
    WHEN 'protect' THEN
      candidate:=$new$
BEGIN
  IF EXISTS(SELECT FROM gridex_billing_source.price_series_invoice_drafts d
    WHERE d.company_id=OLD.company_id AND d.invoice_id=OLD.id) THEN
    IF TG_OP='UPDATE' AND OLD.status='draft' AND NEW.status='issued' AND OLD.invoice_number IS NULL
      AND (to_jsonb(NEW)-ARRAY['status','invoice_number','issued_at','due_date','updated_by','updated_at'])=
          (to_jsonb(OLD)-ARRAY['status','invoice_number','issued_at','due_date','updated_by','updated_at'])
      AND EXISTS(SELECT FROM gridex_billing_source.price_series_invoice_issues o
       WHERE (o.company_id,o.invoice_id,o.invoice_number,o.effective_at,o.due_date,o.actor_user_id,o.calculation_sha256)
        =(NEW.company_id,NEW.id,NEW.invoice_number,NEW.issued_at,NEW.due_date,NEW.updated_by,NEW.calculation_snapshot_sha256)
        AND NEW.updated_at=o.effective_at) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'invoice_price_series_draft_requires_series_workflow' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$new$;
    END CASE;
    IF candidate=body_before.prosrc THEN
      RAISE EXCEPTION 'price_series_issue_anchor_missing: %',owner.signature;
    END IF;
    EXECUTE replace(body_before.definition,body_before.prosrc,candidate);
    IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=body_before.oid)
        IS DISTINCT FROM body_before.metadata THEN
      RAISE EXCEPTION 'price_series_issue_function_metadata_changed: %',owner.signature;
    END IF;
  END LOOP;
END;
END
$migration$;
