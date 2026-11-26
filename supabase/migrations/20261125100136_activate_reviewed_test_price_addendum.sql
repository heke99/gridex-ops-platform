-- Apply one manually reviewed fixed-energy price addendum in the isolated TEST rail.
DO $migration$
BEGIN
  CREATE TABLE gridex_billing_source.test_price_addendum_applications (
    company_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    document_id uuid NOT NULL,
    review_sha256 text NOT NULL CHECK (review_sha256 ~ '^[0-9a-f]{64}$'),
    successor_snapshot_id uuid NOT NULL UNIQUE,
    price_plan_id uuid NOT NULL,
    price_plan_version_id uuid NOT NULL,
    price_book_id uuid NOT NULL,
    fixed_price_ore_per_kwh numeric NOT NULL,
    effective_on date NOT NULL,
    actor_user_id uuid NOT NULL,
    activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(company_id,contract_id),
    FOREIGN KEY(company_id,contract_id,document_id)
      REFERENCES gridex_billing_source.test_price_addendum_reviews(company_id,contract_id,document_id),
    FOREIGN KEY(successor_snapshot_id) REFERENCES public.contract_price_snapshots(id)
      DEFERRABLE INITIALLY DEFERRED
  );
  ALTER TABLE gridex_billing_source.test_price_addendum_applications ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON gridex_billing_source.test_price_addendum_applications FROM PUBLIC,anon,authenticated,service_role;

  EXECUTE $ddl$
    CREATE FUNCTION gridex_billing_source.check_test_price_addendum_snapshot_insert_v1(
      successor public.contract_price_snapshots
    ) RETURNS boolean LANGUAGE sql STABLE SET search_path TO pg_catalog AS $body$
      SELECT auth.role()='service_role' AND EXISTS(
        SELECT FROM gridex_billing_source.test_price_addendum_applications a
        JOIN gridex_billing_source.test_price_addendum_reviews r
          ON (a.company_id,a.contract_id,a.document_id,a.review_sha256)=(r.company_id,r.contract_id,r.document_id,r.receipt_sha256)
        JOIN public.price_plan_versions version
          ON (version.company_id,version.price_plan_id,version.id)=(a.company_id,a.price_plan_id,a.price_plan_version_id)
        JOIN public.price_books book
          ON (book.company_id,book.price_plan_id,book.price_plan_version_id,book.id)
           =(a.company_id,a.price_plan_id,a.price_plan_version_id,a.price_book_id)
        WHERE version.locked_at IS NOT NULL AND book.locked_at IS NOT NULL
          AND version.status='published' AND book.status='published' AND book.content_sha256=version.content_sha256
          AND successor.base_price_components_snapshot=version.snapshot_json->'base_components'
          AND successor.price_components_snapshot='[]'::jsonb
          AND (a.company_id,a.contract_id,a.customer_id,a.successor_snapshot_id,a.price_plan_id,
          a.price_plan_version_id,a.price_book_id,a.effective_on)
         =(successor.company_id,successor.contract_id,successor.customer_id,successor.id,successor.price_plan_id,
          successor.price_plan_version_id,successor.price_book_id,successor.valid_from)
          AND successor.source='staff_manually_verified_signed_addendum_v1'
          AND successor.pricing_model='fixed'
          AND successor.snapshot_json->>'addendumReviewSha256'=a.review_sha256
          AND successor.snapshot_json->>'price_plan_version_id'=a.price_plan_version_id::text
          AND (successor.snapshot_json->>'fixed_price_ore_per_kwh')::numeric=a.fixed_price_ore_per_kwh
          AND r.effective_on=a.effective_on
          AND (r.receipt#>>'{verification,priceOrePerKwh}')::numeric=a.fixed_price_ore_per_kwh
          AND public.gridex_actor_has_company_permission(a.actor_user_id,a.company_id,'pricing.write') IS TRUE
      )
    $body$
  $ddl$;
  EXECUTE $ddl$
    CREATE FUNCTION public.gridex_activate_test_contract_price_addendum_v1(
      p_company_id uuid,p_actor_user_id uuid,p_customer_id uuid,p_contract_id uuid,p_document_id uuid,p_review_sha256 text
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog SET "TimeZone" TO 'UTC' AS $body$
    DECLARE
      contract public.customer_contracts%ROWTYPE;
      original public.contract_price_snapshots%ROWTYPE;
      successor public.contract_price_snapshots%ROWTYPE;
      source gridex_billing_source.test_price_addendum_documents%ROWTYPE;
      review gridex_billing_source.test_price_addendum_reviews%ROWTYPE;
      applied gridex_billing_source.test_price_addendum_applications%ROWTYPE;
      price_ore numeric;
      area text;
      components jsonb;
      published jsonb;
      new_id uuid;
      replayed boolean;
      frozen jsonb;
    BEGIN
      PERFORM gridex_billing_source.require_test_price_addendum_actor_v1(p_company_id,p_actor_user_id);
      IF public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'pricing.write') IS NOT TRUE THEN
        RAISE EXCEPTION 'price_addendum_pricing_scope_required' USING ERRCODE='42501';
      END IF;
      SELECT c.* INTO contract FROM public.customer_contracts c
        WHERE (c.company_id,c.customer_id,c.id)=(p_company_id,p_customer_id,p_contract_id)
          AND c.status IN ('signed','active') FOR UPDATE NOWAIT;
      IF NOT FOUND THEN RAISE EXCEPTION 'price_addendum_original_signature_required' USING ERRCODE='23514'; END IF;
      SELECT d.* INTO source FROM gridex_billing_source.test_price_addendum_documents d
        WHERE (d.company_id,d.customer_id,d.contract_id,d.id)=(p_company_id,p_customer_id,p_contract_id,p_document_id);
      SELECT r.* INTO review FROM gridex_billing_source.test_price_addendum_reviews r
        WHERE (r.company_id,r.contract_id,r.document_id)=(p_company_id,p_contract_id,p_document_id)
          AND r.receipt_sha256=p_review_sha256;
      IF NOT FOUND OR source.id IS NULL
        OR (source.document_sha256,source.original_signature_sha256,source.original_price_id,source.original_price_sha256)
          IS DISTINCT FROM (review.receipt->>'documentSha256',review.receipt->>'originalSignatureSha256',
            (review.receipt->>'originalPriceId')::uuid,review.receipt->>'originalPriceSha256')
        OR source.document_sha256<>encode(sha256(source.document),'hex')
        OR (contract.signature_snapshot_sha256,contract.contract_price_snapshot_id)
          IS DISTINCT FROM (source.original_signature_sha256,source.original_price_id) THEN
        RAISE EXCEPTION 'price_addendum_review_evidence_changed' USING ERRCODE='23514';
      END IF;
      SELECT * INTO applied FROM gridex_billing_source.test_price_addendum_applications a
        WHERE (a.company_id,a.contract_id)=(p_company_id,p_contract_id);
      replayed:=FOUND;
      IF replayed THEN
        IF (applied.document_id,applied.review_sha256) IS DISTINCT FROM (source.id,review.receipt_sha256) THEN
          RAISE EXCEPTION 'price_addendum_application_conflict' USING ERRCODE='23505';
        END IF;
      ELSE
        SELECT * INTO original FROM public.contract_price_snapshots s WHERE (s.company_id,s.contract_id,s.id)
          =(p_company_id,p_contract_id,source.original_price_id) FOR SHARE;
        IF NOT FOUND OR original.snapshot_hash IS DISTINCT FROM source.original_price_sha256
          OR NOT gridex_billing_source.has_canonical_signed_series_price_v1(p_company_id,p_customer_id,p_contract_id,
            original.id,original.valid_from::timestamp AT TIME ZONE 'Europe/Stockholm',
            (original.valid_from+1)::timestamp AT TIME ZONE 'Europe/Stockholm')
          OR EXISTS(SELECT FROM public.contract_price_snapshots s
            WHERE (s.company_id,s.contract_id)=(p_company_id,p_contract_id) AND s.id<>original.id
              AND (s.valid_to IS NULL OR s.valid_to>=original.valid_from))
          OR EXISTS(SELECT FROM gridex_billing_source.test_price_addendum_reviews r
            WHERE (r.company_id,r.contract_id)=(p_company_id,p_contract_id) AND r.document_id<>source.id) THEN
          RAISE EXCEPTION 'price_addendum_initial_timeline_changed' USING ERRCODE='23514';
        END IF;
        price_ore:=(review.receipt#>>'{verification,priceOrePerKwh}')::numeric;
        area:=original.snapshot_json->>'price_area';
        IF original.pricing_model<>'fixed' OR original.snapshot_json->>'energy_direction' IS DISTINCT FROM 'consumption'
          OR area IS NULL OR area NOT IN ('SE1','SE2','SE3','SE4')
          OR jsonb_typeof(original.base_price_components_snapshot) IS DISTINCT FROM 'array'
          OR jsonb_array_length(original.base_price_components_snapshot)<>1
          OR original.base_price_components_snapshot#>>'{0,source_type}' IS DISTINCT FROM 'fixed'
          OR original.base_price_components_snapshot#>>'{0,weight_percent}' IS DISTINCT FROM '100'
          OR coalesce(original.snapshot_json->>'vat_rate','') NOT IN ('0.25','25')
          OR original.price_components_snapshot<>'[]'::jsonb
          OR EXISTS(SELECT FROM jsonb_each(original.snapshot_json) field
            WHERE field.key IN ('monthly_fee_sek','invoice_fee_sek','start_fee_sek','admin_fee_sek','variable_fee_ore_per_kwh',
              'discount_value','green_fee_value','spot_markup_ore_per_kwh')
              AND field.value NOT IN ('null'::jsonb,'0'::jsonb)) THEN
          RAISE EXCEPTION 'price_addendum_fixed_energy_only_required' USING ERRCODE='23514';
        END IF;
        components:=jsonb_build_array(jsonb_build_object('source_type','fixed',
          'label',coalesce(original.base_price_components_snapshot#>>'{0,label}','Fast pris'),
          'weight_percent',100,'fixed_price_sek_per_kwh',price_ore/100,'price_area',area));
        published:=public.gridex_create_or_version_contract_pricing(p_company_id,'TEST prisbilaga '||source.id::text,
          'fixed','fixed','both',jsonb_build_object('schema','gridex_contract_pricing_v5',
            'pricing_model','fixed','energy_direction','consumption','interval_resolution','fixed',
            'vat_rate',0.25,'price_areas',jsonb_build_array(area),'base_components',components,'price_components','[]'::jsonb),
          review.effective_on,original.valid_to,true,p_actor_user_id);
        new_id:=gen_random_uuid();
        INSERT INTO gridex_billing_source.test_price_addendum_applications(company_id,contract_id,customer_id,document_id,
          review_sha256,successor_snapshot_id,price_plan_id,price_plan_version_id,price_book_id,
          fixed_price_ore_per_kwh,effective_on,actor_user_id)
        VALUES(p_company_id,p_contract_id,p_customer_id,p_document_id,review.receipt_sha256,new_id,
          (published->>'price_plan_id')::uuid,(published->>'price_plan_version_id')::uuid,(published->>'price_book_id')::uuid,
          price_ore,review.effective_on,p_actor_user_id) RETURNING * INTO applied;
        frozen:=(original.snapshot_json-ARRAY['quote_reference','quote_hash','price_option_reference','area_price_reference',
          'selected_component_references','base_components','price_components','price_book_hash'])
          ||jsonb_build_object('snapshot_schema','gridex_contract_pricing_v7_signed_receipt',
            'source','staff_manually_verified_signed_addendum_v1','addendumReviewSha256',review.receipt_sha256,
            'price_plan_id',applied.price_plan_id,'price_plan_version_id',applied.price_plan_version_id,
            'price_book_id',applied.price_book_id,'fixed_price_ore_per_kwh',price_ore,'base_price_components_snapshot',components,
            'price_components_snapshot','[]'::jsonb);
        INSERT INTO public.contract_price_snapshots(id,company_id,contract_id,customer_id,price_plan_id,
          price_plan_version_id,price_book_id,pricing_model,base_price_components_snapshot,price_components_snapshot,
          snapshot_json,valid_from,valid_to,source,contract_number,customer_number,snapshot_quality,snapshot_schema_version)
        VALUES(new_id,p_company_id,p_contract_id,p_customer_id,applied.price_plan_id,applied.price_plan_version_id,
          applied.price_book_id,'fixed',components,'[]'::jsonb,frozen,review.effective_on,original.valid_to,
          'staff_manually_verified_signed_addendum_v1',original.contract_number,original.customer_number,
          'canonical','gridex_contract_pricing_v7_signed_receipt');
      END IF;
      SELECT * INTO successor FROM public.contract_price_snapshots s WHERE (s.company_id,s.contract_id,s.id)
        =(p_company_id,p_contract_id,applied.successor_snapshot_id);
      IF NOT FOUND OR NOT gridex_billing_source.check_test_price_addendum_snapshot_insert_v1(successor)
        OR successor.snapshot_hash<>encode(sha256(convert_to(successor.snapshot_json::text,'UTF8')),'hex') THEN
        RAISE EXCEPTION 'price_addendum_activation_readback_invalid' USING ERRCODE='23514';
      END IF;
      RETURN jsonb_build_object('kind','applied','documentId',source.id,'reviewSha256',review.receipt_sha256,
        'priceSnapshotId',successor.id,'priceSnapshotSha256',successor.snapshot_hash,
        'effectiveAt',review.effective_at,'actorUserId',applied.actor_user_id,
        'activatedAt',applied.activated_at,'existing',replayed);
    END $body$
  $ddl$;

  EXECUTE $ddl$
    CREATE FUNCTION gridex_billing_source.resolve_test_contract_price_timeline_v1(
      p_company uuid,p_customer uuid,p_contract uuid,p_start timestamptz,p_end timestamptz
    ) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO pg_catalog SET "TimeZone" TO 'UTC' AS $body$
    DECLARE
      original public.contract_price_snapshots%ROWTYPE;
      successor public.contract_price_snapshots%ROWTYPE;
      applied gridex_billing_source.test_price_addendum_applications%ROWTYPE;
      review gridex_billing_source.test_price_addendum_reviews%ROWTYPE;
      source gridex_billing_source.test_price_addendum_documents%ROWTYPE;
      contract public.customer_contracts%ROWTYPE;
      segments jsonb:='[]'::jsonb;
      basis jsonb;
      held constant jsonb:='{"kind":"held","reason":"signed_price_addendum_unapplied"}';
    BEGIN
      SELECT * INTO contract FROM public.customer_contracts c
        WHERE (c.company_id,c.customer_id,c.id)=(p_company,p_customer,p_contract);
      IF NOT FOUND THEN RETURN jsonb_build_object('kind','held','reason','price_addendum_contract_scope_required'); END IF;
      IF NOT gridex_billing_source.has_unapplied_test_price_addendum_v1(p_company,p_contract,p_end) THEN
        RETURN jsonb_build_object('kind','legacy');
      END IF;
      SELECT * INTO applied FROM gridex_billing_source.test_price_addendum_applications a
        WHERE (a.company_id,a.contract_id,a.customer_id)=(p_company,p_contract,p_customer);
      IF NOT FOUND THEN RETURN held; END IF;
      SELECT * INTO source FROM gridex_billing_source.test_price_addendum_documents d
        WHERE (d.company_id,d.contract_id,d.customer_id,d.id)=(p_company,p_contract,p_customer,applied.document_id);
      SELECT * INTO review FROM gridex_billing_source.test_price_addendum_reviews r
        WHERE (r.company_id,r.contract_id,r.document_id,r.receipt_sha256)
          =(p_company,p_contract,applied.document_id,applied.review_sha256);
      SELECT * INTO original FROM public.contract_price_snapshots s
        WHERE (s.company_id,s.contract_id,s.customer_id,s.id)=(p_company,p_contract,p_customer,source.original_price_id);
      SELECT * INTO successor FROM public.contract_price_snapshots s
        WHERE (s.company_id,s.contract_id,s.customer_id,s.id)=(p_company,p_contract,p_customer,applied.successor_snapshot_id);
      IF NOT FOUND OR review.document_id IS NULL OR original.id IS NULL OR source.id IS NULL
        OR (contract.signature_snapshot_sha256,contract.contract_price_snapshot_id,original.snapshot_hash)
          IS DISTINCT FROM (source.original_signature_sha256,source.original_price_id,source.original_price_sha256)
        OR NOT gridex_billing_source.has_canonical_signed_series_price_v1(
          p_company,p_customer,p_contract,original.id,original.valid_from::timestamp AT TIME ZONE 'Europe/Stockholm',
          (original.valid_from+1)::timestamp AT TIME ZONE 'Europe/Stockholm')
        OR successor.source IS DISTINCT FROM 'staff_manually_verified_signed_addendum_v1'
        OR successor.snapshot_json->>'addendumReviewSha256' IS DISTINCT FROM applied.review_sha256
        OR (successor.price_plan_id,successor.price_plan_version_id,successor.price_book_id,successor.valid_from,successor.valid_to)
          IS DISTINCT FROM (applied.price_plan_id,applied.price_plan_version_id,applied.price_book_id,review.effective_on,original.valid_to)
        OR successor.snapshot_hash IS DISTINCT FROM encode(sha256(convert_to(successor.snapshot_json::text,'UTF8')),'hex')
        OR source.document_sha256 IS DISTINCT FROM review.receipt->>'documentSha256'
        OR source.document_sha256 IS DISTINCT FROM encode(sha256(source.document),'hex')
        OR NOT EXISTS(SELECT FROM public.price_plan_versions v
          WHERE (v.company_id,v.price_plan_id,v.id)=(applied.company_id,applied.price_plan_id,applied.price_plan_version_id)
            AND v.locked_at IS NOT NULL AND v.status='published'
            AND v.snapshot_json->'base_components'=successor.base_price_components_snapshot)
        OR review.effective_at>=p_end
        OR p_start<(original.valid_from::timestamp AT TIME ZONE 'Europe/Stockholm')
        OR (original.valid_to IS NOT NULL AND p_end>((original.valid_to+1)::timestamp AT TIME ZONE 'Europe/Stockholm'))
        OR EXISTS(SELECT FROM gridex_billing_source.test_price_addendum_reviews r
          WHERE (r.company_id,r.contract_id)=(p_company,p_contract) AND r.document_id<>applied.document_id
            AND r.effective_at<p_end)
        OR EXISTS(SELECT FROM public.contract_price_snapshots s
          WHERE (s.company_id,s.contract_id)=(p_company,p_contract) AND s.id NOT IN (original.id,successor.id)
            AND (s.valid_from IS NULL OR (s.valid_from::timestamp AT TIME ZONE 'Europe/Stockholm')<p_end)
            AND (s.valid_to IS NULL OR ((s.valid_to+1)::timestamp AT TIME ZONE 'Europe/Stockholm')>p_start)) THEN
        RETURN held;
      END IF;

      IF p_start<review.effective_at THEN
        segments:=jsonb_build_array(jsonb_build_object('snapshot',to_jsonb(original),
          'effectiveFrom',p_start,'effectiveUntil',review.effective_at));
      END IF;
      segments:=segments||jsonb_build_array(jsonb_build_object('snapshot',to_jsonb(successor),
        'effectiveFrom',greatest(p_start,review.effective_at),'effectiveUntil',p_end));
      basis:=jsonb_build_object('companyId',p_company,'customerId',p_customer,'contractId',p_contract,
        'from',p_start,'until',p_end,'originalSignatureSha256',source.original_signature_sha256,
        'originalPriceSha256',original.snapshot_hash,'successorPriceSha256',successor.snapshot_hash,
        'reviewSha256',review.receipt_sha256,'effectiveAt',review.effective_at);
      RETURN jsonb_build_object('kind','ready','basisSha256',encode(sha256(convert_to(basis::text,'UTF8')),'hex'),
        'segments',segments);
    END $body$
  $ddl$;

  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.gridex_read_effective_contract_price_timeline_v1(
      p_company_id uuid,p_customer_id uuid,p_contract_id uuid,p_start timestamptz,p_end timestamptz
    ) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $body$
    BEGIN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'price_addendum_timeline_scope_required' USING ERRCODE='42501';
      END IF;
      IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start THEN
        RAISE EXCEPTION 'billing_price_timeline_invalid' USING ERRCODE='22023';
      END IF;
      RETURN gridex_billing_source.resolve_test_contract_price_timeline_v1(p_company_id,p_customer_id,p_contract_id,p_start,p_end);
    END
    $body$
  $ddl$;

  REVOKE ALL ON FUNCTION gridex_billing_source.check_test_price_addendum_snapshot_insert_v1(public.contract_price_snapshots),
    gridex_billing_source.resolve_test_contract_price_timeline_v1(uuid,uuid,uuid,timestamptz,timestamptz)
    FROM PUBLIC,anon,authenticated,service_role;
  REVOKE ALL ON FUNCTION public.gridex_activate_test_contract_price_addendum_v1(uuid,uuid,uuid,uuid,uuid,text)
    FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_activate_test_contract_price_addendum_v1(uuid,uuid,uuid,uuid,uuid,text) TO service_role;

  DECLARE
    owner record;
    old record;
    candidate text;
  BEGIN
    FOR owner IN SELECT * FROM (VALUES
      ('snapshot','public.gridex_fill_contract_price_snapshot_binding_v1()',
        '41821b63b8fa287c53c7aa00bb1ea40f6e5b1331e298ad53bed9328683761970'),
      ('timeline','gridex_billing_source.require_contract_price_timeline_v1(uuid,uuid,uuid,timestamptz,timestamptz,jsonb)',
        'ee627d37b858f2e1748f10d02fbff8e53653015b95cad1fc4af89186614cc7ad'),
      ('series','gridex_billing_source.lock_price_series_members_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb)',
        '26ec79ac3db78f2a76e93236983635c8ef1fd44da3b5e1fe9aa836aed11dad3b')
    ) owners(kind,signature,digest) LOOP
      SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
      INTO STRICT old FROM pg_proc p WHERE p.oid=owner.signature::regprocedure;
      IF encode(sha256(convert_to(old.prosrc,'UTF8')),'hex') IS DISTINCT FROM owner.digest THEN
        RAISE EXCEPTION 'price_addendum_activation_owner_preimage_changed: %',owner.signature;
      END IF;
      IF owner.kind='snapshot' THEN
        candidate:=replace(old.prosrc,$old$  v_snapshot_ppv:=nullif(new.snapshot_json->>'price_plan_version_id','')::uuid;$old$,
          $new$  IF new.source='staff_manually_verified_signed_addendum_v1'
    AND gridex_billing_source.check_test_price_addendum_snapshot_insert_v1(new) IS NOT TRUE THEN
    RAISE EXCEPTION 'price_addendum_snapshot_native_authority_required' USING ERRCODE='23514';
  END IF;
  v_snapshot_ppv:=nullif(new.snapshot_json->>'price_plan_version_id','')::uuid;$new$);
        candidate:=replace(candidate,$old$and v_snapshot_ppv<>v_contract.price_plan_version_id then$old$,
          $new$and v_snapshot_ppv<>v_contract.price_plan_version_id
    AND new.source IS DISTINCT FROM 'staff_manually_verified_signed_addendum_v1' then$new$);
      ELSIF owner.kind='timeline' THEN
        candidate:=replace(old.prosrc,$old$  PERFORM gridex_billing_source.require_no_unapplied_test_price_addendum_v1(p_company,p_contract,v_start,v_end);$old$,
          $new$  IF gridex_billing_source.has_unapplied_test_price_addendum_v1(p_company,p_contract,v_end) THEN
    SELECT gridex_billing_source.resolve_test_contract_price_timeline_v1(p_company,c.customer_id,p_contract,v_start,v_end)
      INTO v_effective FROM public.customer_contracts c WHERE (c.company_id,c.id)=(p_company,p_contract);
    IF v_effective->>'kind' IS DISTINCT FROM 'ready'
      OR v_effective->>'basisSha256' IS DISTINCT FROM p_timeline->>'basisSha256'
      OR (SELECT jsonb_agg(segment.value#>'{snapshot,id}' ORDER BY segment.ordinality)
          FROM jsonb_array_elements(v_effective->'segments') WITH ORDINALITY segment(value,ordinality)) IS DISTINCT FROM v_ids
      OR NOT EXISTS(SELECT FROM jsonb_array_elements(v_effective->'segments') segment
         WHERE segment#>>'{snapshot,id}'=p_selected::text AND
           (segment->>'effectiveFrom')::timestamptz<=p_start AND (segment->>'effectiveUntil')::timestamptz>=p_end) THEN
      RAISE EXCEPTION 'billing_price_timeline_changed' USING ERRCODE='PT409',
        DETAIL=jsonb_build_object('companyId',p_company,'contractId',p_contract)::text;
    END IF;
    RETURN;
  END IF;$new$);
        candidate:=replace(candidate,$old$v_last_date date;$old$,$new$v_last_date date; v_effective jsonb;$new$);
      ELSE
        candidate:=replace(old.prosrc,$old$      AND gridex_billing_source.has_canonical_signed_series_price_v1(
        p_company,p_customer,p_contract,s.id,start_at,end_at)$old$,$new$      AND (gridex_billing_source.has_canonical_signed_series_price_v1(
        p_company,p_customer,p_contract,s.id,start_at,end_at)
        OR (s.source='staff_manually_verified_signed_addendum_v1' AND EXISTS(
          SELECT FROM gridex_billing_source.test_price_addendum_applications a
          JOIN gridex_billing_source.test_price_addendum_reviews r
            ON (r.company_id,r.contract_id,r.document_id,r.receipt_sha256)
             =(a.company_id,a.contract_id,a.document_id,a.review_sha256)
          WHERE (a.company_id,a.contract_id,a.customer_id,a.successor_snapshot_id)=(p_company,p_contract,p_customer,s.id)
            AND r.effective_at<=start_at AND s.snapshot_json->>'addendumReviewSha256'=a.review_sha256)))$new$);
      END IF;
      IF candidate=old.prosrc THEN RAISE EXCEPTION 'price_addendum_activation_anchor_missing: %',owner.signature; END IF;
      EXECUTE replace(old.definition,old.prosrc,candidate);
      IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=old.oid) IS DISTINCT FROM old.metadata THEN
        RAISE EXCEPTION 'price_addendum_activation_metadata_changed: %',owner.signature;
      END IF;
    END LOOP;
  END;
END
$migration$;
