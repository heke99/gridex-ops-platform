-- Price-series invoices carry their exact periods in reserved member rows.
-- The inspection adapter may report those frozen facts without retirement authority.
DO $migration$
DECLARE
  owner constant regprocedure := 'public.ediel_finance_copy_retention_basis_v1(uuid,uuid,text,text)'::regprocedure;
  migration_role constant name := current_user;
  retention_owner constant name := 'gridex_ediel_retention_owner';
  previous_public_acl aclitem[];
  temporary_create boolean;
  original record;
  patched text;
  anchor constant text := 'RETURN gridex_ediel_retention.finance_basis_v1(p_company_id,p_retention_class,p_target_id);';
BEGIN
  SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT original FROM pg_proc p WHERE p.oid=owner;
  IF original.metadata->>'proowner' IS DISTINCT FROM (SELECT oid::text FROM pg_roles WHERE rolname=retention_owner AND NOT rolcanlogin)
    OR NOT pg_has_role(migration_role,retention_owner,'SET')
    OR NOT has_schema_privilege(retention_owner,'gridex_billing_source','USAGE') THEN
    RAISE EXCEPTION 'price_series_retention_read_roles_changed' USING ERRCODE='42501';
  END IF;
  IF encode(sha256(convert_to(original.prosrc,'UTF8')),'hex') IS DISTINCT FROM
    'f18961afa6ffdb1bc42462ee33caa04e9f820e33d8f793b87172f6b940042b1f'
    OR (length(original.prosrc)-length(replace(original.prosrc,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION 'price_series_retention_read_owner_preimage_changed';
  END IF;

  EXECUTE $ddl$
    CREATE FUNCTION gridex_billing_source.price_series_invoice_inspection_basis_v1(c uuid,actor uuid,target uuid,body_columns text[])
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog SET "TimeZone" TO 'UTC'
    AS $body$
    DECLARE
      invoice_row jsonb;
      issued gridex_billing_source.price_series_invoice_issues%ROWTYPE;
      reservation gridex_billing_source.price_series_reservations%ROWTYPE;
      calculation_body jsonb;
      member_facts jsonb;
      protected_scope jsonb;
      first_start timestamptz;
      final_end timestamptz;
    BEGIN
      IF actor IS NULL OR auth.uid() IS DISTINCT FROM actor THEN
        RAISE EXCEPTION 'price_series_retention_read_actor_required' USING ERRCODE='42501';
      END IF;
      IF body_columns IS DISTINCT FROM ARRAY['raw_payload','metadata','calculation_snapshot','portfolio_settlement_snapshot'] THEN
        RAISE EXCEPTION 'price_series_retention_read_class_changed' USING ERRCODE='23514';
      END IF;
      issued:=gridex_billing_source.verified_price_series_issue_v1(c,target,NULL);
      SELECT to_jsonb(i) INTO STRICT invoice_row FROM public.customer_invoices i
      WHERE (i.company_id,i.id)=(c,target);
      SELECT * INTO STRICT reservation FROM gridex_billing_source.price_series_reservations r
      WHERE (r.company_id,r.id,r.customer_id)=(c,issued.reservation_id,(invoice_row->>'customer_id')::uuid);

      IF reservation.basis->>'kind' IS DISTINCT FROM 'same_site_fixed_price_series_v1'
        OR reservation.basis_sha256 IS DISTINCT FROM encode(sha256(convert_to(reservation.basis::text,'UTF8')),'hex')
        OR invoice_row#>'{calculation_snapshot,basis}' IS DISTINCT FROM reservation.basis
        OR invoice_row#>>'{calculation_snapshot,basisSha256}' IS DISTINCT FROM reservation.basis_sha256
        OR issued.calculation_sha256 IS DISTINCT FROM encode(sha256(convert_to((invoice_row->'calculation_snapshot')::text,'UTF8')),'hex')
        OR NOT EXISTS(SELECT FROM gridex_billing_source.price_series_invoice_approvals a
          WHERE (a.company_id,a.reservation_id,a.review_hash)=(c,reservation.id,issued.review_hash))
        OR jsonb_typeof(reservation.basis->'members') IS DISTINCT FROM 'array'
        OR jsonb_array_length(reservation.basis->'members') NOT BETWEEN 2 AND 32 THEN
        RAISE EXCEPTION 'price_series_retention_issue_evidence_changed' USING ERRCODE='23514';
      END IF;

      WITH matched AS (
        SELECT m.ordinal,m.billing_underlay_id,m.pricing_run_id,u.supply_period_id,
          b.source_basis_hash,encode(seal.evidence_digest,'hex') AS pricing_evidence_hash,
          p.billing_period_start AS start_at,p.billing_period_end AS end_at
        FROM jsonb_array_elements(reservation.basis->'members') WITH ORDINALITY AS frozen(member,ordinal)
        JOIN gridex_billing_source.price_series_reservation_members m
          ON (m.company_id,m.reservation_id,m.ordinal)=(c,reservation.id,frozen.ordinal)
          AND (m.billing_underlay_id::text,m.pricing_run_id::text)=(frozen.member->>'underlayId',frozen.member->>'pricingRunId')
        JOIN public.billing_underlays u ON (u.company_id,u.id,u.customer_id,u.metering_point_id)
          =(c,m.billing_underlay_id,reservation.customer_id,reservation.metering_point_id)
        JOIN gridex_billing_source.underlay_bindings b ON (b.company_id,b.underlay_id)=(c,u.id)
        JOIN public.pricing_runs p ON (p.company_id,p.billing_underlay_id,p.id)=(c,u.id,m.pricing_run_id)
        JOIN gridex_locked_pricing_evidence.run_seals seal ON (seal.company_id,seal.underlay_id,seal.run_id)=(c,u.id,p.id)
        WHERE coalesce(u.customer_contract_id,u.contract_id)=reservation.contract_id
          AND coalesce(u.customer_site_id,u.site_id)=reservation.site_id
          AND u.supply_period_id::text=reservation.basis->>'supplyPeriodId'
          AND u.contract_price_snapshot_id::text=frozen.member->>'priceSnapshotId'
          AND b.source_basis_hash=frozen.member->>'sourceBasisSha256'
          AND b.source_basis_hash=encode(sha256(convert_to(b.source_basis::text,'UTF8')),'hex')
          AND encode(seal.evidence_digest,'hex')=frozen.member->>'pricingEvidenceSha256'
          AND p.status='locked' AND p.locked_at IS NOT NULL
          AND p.billing_period_start=(frozen.member->>'from')::timestamptz
          AND p.billing_period_end=(frozen.member->>'until')::timestamptz
          AND isfinite(p.billing_period_start) AND isfinite(p.billing_period_end)
          AND p.billing_period_start<p.billing_period_end
      ), ordered AS (
        SELECT matched.*,lag(end_at) OVER (ORDER BY ordinal) AS previous_end FROM matched
      )
      SELECT jsonb_agg(jsonb_build_object('underlayId',billing_underlay_id,'pricingRunId',pricing_run_id,
        'supplyPeriodId',supply_period_id,'sourceHash',source_basis_hash,'pricingEvidenceHash',pricing_evidence_hash,
        'periodStart',start_at,'periodEnd',end_at) ORDER BY ordinal),min(start_at),max(end_at)
      INTO member_facts,first_start,final_end FROM ordered
      WHERE previous_end IS NULL AND ordinal=1 OR previous_end=start_at;

      IF jsonb_array_length(member_facts) IS DISTINCT FROM jsonb_array_length(reservation.basis->'members')
        OR (SELECT count(*) FROM gridex_billing_source.price_series_reservation_members m
          WHERE (m.company_id,m.reservation_id)=(c,reservation.id))<>jsonb_array_length(member_facts) THEN
        RAISE EXCEPTION 'price_series_retention_member_evidence_changed' USING ERRCODE='23514';
      END IF;

      SELECT jsonb_object_agg(col,invoice_row->col) INTO calculation_body FROM unnest(body_columns) col;
      IF octet_length(calculation_body::text) NOT BETWEEN 1 AND 20971520
        OR calculation_body@>'{"retentionUnavailable":true}' THEN
        RAISE EXCEPTION 'finance_retention_actual_body_required';
      END IF;

      protected_scope:=jsonb_build_object('companyId',c,'customerId',reservation.customer_id,'invoiceId',target,
        'reviewHash',issued.review_hash,'calculationHash',issued.calculation_sha256,
        'documentHash',issued.body_sha256,'sourceMembers',member_facts);
      RETURN jsonb_build_object('retentionClass','invoice_calculation_body','targetId',target,
        'sourceTable','public.customer_invoices','bodyColumns',body_columns,'periodStart',first_start,'periodEnd',final_end,
        'originalProducerHash',issued.calculation_sha256,'sourceBound',true,
        'sourceHash',encode(sha256(convert_to(calculation_body::text,'UTF8')),'hex'),
        'targetHash',encode(sha256(convert_to(invoice_row::text,'UTF8')),'hex'),
        'scopeHash',encode(sha256(convert_to(protected_scope::text,'UTF8')),'hex'),
        'byteLength',octet_length(calculation_body::text),'includedCustomers',jsonb_build_array(reservation.customer_id),
        'sourceMembers',member_facts,'allIncludedScopesClosed',false,'complete',false,'authority','none');
    END
    $body$
  $ddl$;
  REVOKE ALL ON FUNCTION gridex_billing_source.price_series_invoice_inspection_basis_v1(uuid,uuid,uuid,text[])
    FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION gridex_billing_source.price_series_invoice_inspection_basis_v1(uuid,uuid,uuid,text[])
    TO gridex_ediel_retention_owner;

  patched:=replace(original.prosrc,anchor,$new$
    IF p_retention_class='invoice_calculation_body'
      AND p_target_id~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      AND EXISTS(SELECT FROM public.customer_invoices i
        WHERE i.company_id=p_company_id AND i.id::text=p_target_id AND i.source_system='invoice_price_series_test_v1') THEN
      RETURN gridex_billing_source.price_series_invoice_inspection_basis_v1(p_company_id,p_actor_user_id,p_target_id::uuid,
        (SELECT spec.body_columns FROM gridex_ediel_retention.finance_class_catalog spec
          WHERE spec.retention_class=p_retention_class AND spec.source_schema='public' AND spec.source_table='customer_invoices'));
    END IF;
    RETURN gridex_ediel_retention.finance_basis_v1(p_company_id,p_retention_class,p_target_id);$new$);
  SELECT nspacl INTO previous_public_acl FROM pg_namespace WHERE nspname='public';
  temporary_create:=NOT has_schema_privilege(retention_owner,'public','CREATE');
  IF temporary_create THEN
    GRANT CREATE ON SCHEMA public TO gridex_ediel_retention_owner;
  END IF;
  SET LOCAL ROLE gridex_ediel_retention_owner;
  EXECUTE replace(original.definition,original.prosrc,patched);
  EXECUTE format('SET LOCAL ROLE %I',migration_role);
  IF temporary_create THEN
    REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner;
  END IF;
  IF (SELECT nspacl FROM pg_namespace WHERE nspname='public') IS DISTINCT FROM previous_public_acl
    OR has_schema_privilege(retention_owner,'public','CREATE') IS DISTINCT FROM (NOT temporary_create)
    OR NOT has_function_privilege(retention_owner,'gridex_billing_source.price_series_invoice_inspection_basis_v1(uuid,uuid,uuid,text[])','EXECUTE')
    OR EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) api_role
      WHERE has_function_privilege(api_role,'gridex_billing_source.price_series_invoice_inspection_basis_v1(uuid,uuid,uuid,text[])','EXECUTE')) THEN
    RAISE EXCEPTION 'price_series_retention_read_owner_acl_changed';
  END IF;
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=original.oid) IS DISTINCT FROM original.metadata THEN
    RAISE EXCEPTION 'price_series_retention_read_owner_metadata_changed';
  END IF;
END
$migration$;
