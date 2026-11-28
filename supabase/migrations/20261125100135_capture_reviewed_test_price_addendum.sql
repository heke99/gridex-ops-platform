-- Private TEST custody and a first-write hold for a manually reviewed, unapplied commercial addendum.
DO $migration$
DECLARE
  target constant regprocedure :=
    'gridex_billing_source.require_contract_price_timeline_v1(uuid,uuid,uuid,timestamptz,timestamptz,jsonb)'::regprocedure;
  other_owner record;
  other_body text;
  other_definition text;
  other_metadata jsonb;
  replacement text;
  before_body text;
  definition text;
  before_metadata jsonb;
  old_anchor constant text := $old$  SELECT coalesce(jsonb_agg(s.id ORDER BY s.valid_from,s.id),'[]'::jsonb) INTO v_observed$old$;
  new_anchor constant text := $new$  PERFORM gridex_billing_source.require_no_unapplied_test_price_addendum_v1(p_company,p_contract,v_start,v_end);
  SELECT coalesce(jsonb_agg(s.id ORDER BY s.valid_from,s.id),'[]'::jsonb) INTO v_observed$new$;
BEGIN
  SELECT p.prosrc,pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
  INTO STRICT before_body,definition,before_metadata FROM pg_proc p WHERE p.oid=target;
  IF encode(sha256(convert_to(before_body,'UTF8')),'hex') IS DISTINCT FROM
      '9d71e852021bbb742a3e060d88a06afed9bcfdd1c058f186e3e55c29c98b1ecf'
    OR (length(before_body)-length(replace(before_body,old_anchor,'')))/length(old_anchor)<>1 THEN
    RAISE EXCEPTION 'price_addendum_timeline_preimage_changed';
  END IF;

  CREATE TABLE gridex_billing_source.test_price_addendum_documents (
    company_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    submission_key uuid NOT NULL,
    original_price_id uuid NOT NULL,
    original_signature_sha256 text NOT NULL CHECK (original_signature_sha256 ~ '^[0-9a-f]{64}$'),
    original_price_sha256 text NOT NULL CHECK (original_price_sha256 ~ '^[0-9a-f]{64}$'),
    document bytea NOT NULL CHECK (octet_length(document) BETWEEN 8 AND 2097152
      AND substring(document FROM 1 FOR 5)=convert_to('%PDF-','UTF8')),
    document_sha256 text NOT NULL CHECK (document_sha256=encode(sha256(document),'hex')),
    submitted_by uuid NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(company_id,contract_id,id),
    UNIQUE(company_id,contract_id,submission_key),
    FOREIGN KEY(company_id,contract_id) REFERENCES public.customer_contracts(company_id,id)
  );
  CREATE TABLE gridex_billing_source.test_price_addendum_reviews (
    company_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    document_id uuid NOT NULL,
    effective_on date NOT NULL,
    effective_at timestamptz NOT NULL CHECK (effective_at=effective_on::timestamp AT TIME ZONE 'Europe/Stockholm'),
    receipt jsonb NOT NULL CHECK (receipt->>'kind'='staff_manually_verified_signed_addendum_v1'),
    receipt_sha256 text NOT NULL CHECK (receipt_sha256=encode(sha256(convert_to(receipt::text,'UTF8')),'hex')),
    PRIMARY KEY(company_id,contract_id,document_id),
    UNIQUE(company_id,contract_id,effective_on),
    FOREIGN KEY(company_id,contract_id,document_id)
      REFERENCES gridex_billing_source.test_price_addendum_documents(company_id,contract_id,id)
  );
  ALTER TABLE gridex_billing_source.test_price_addendum_documents ENABLE ROW LEVEL SECURITY;
  ALTER TABLE gridex_billing_source.test_price_addendum_reviews ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE gridex_billing_source.test_price_addendum_documents,
    gridex_billing_source.test_price_addendum_reviews FROM PUBLIC,anon,authenticated,service_role;

  EXECUTE $ddl$
    CREATE FUNCTION gridex_billing_source.require_test_price_addendum_actor_v1(p_company uuid,p_actor uuid)
    RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog AS $body$
    BEGIN
      IF auth.role() IS DISTINCT FROM 'service_role'
        OR public.gridex_actor_has_company_permission(p_actor,p_company,'contracts.write') IS NOT TRUE
        OR public.gridex_actor_has_company_permission(p_actor,p_company,'documents.write') IS NOT TRUE THEN
        RAISE EXCEPTION 'price_addendum_staff_scope_required' USING ERRCODE='42501';
      END IF;
      PERFORM FROM public.companies WHERE id=p_company AND is_active AND status='active'
        AND billing_provider_environment='test' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'price_addendum_test_scope_required' USING ERRCODE='23514'; END IF;
    END
    $body$
  $ddl$;
  EXECUTE $ddl$
    CREATE FUNCTION public.gridex_archive_test_contract_price_addendum_v1(
      p_company_id uuid,p_actor_user_id uuid,p_customer_id uuid,p_contract_id uuid,
      p_submission_key uuid,p_document_base64 text
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $body$
    DECLARE
      original record;
      bytes bytea;
      digest text;
      stored gridex_billing_source.test_price_addendum_documents%ROWTYPE;
      replayed boolean;
    BEGIN
      PERFORM gridex_billing_source.require_test_price_addendum_actor_v1(p_company_id,p_actor_user_id);
      IF p_submission_key IS NULL OR p_document_base64 IS NULL OR length(p_document_base64)>2796204 THEN
        RAISE EXCEPTION 'price_addendum_document_invalid' USING ERRCODE='22023';
      END IF;
      bytes:=decode(p_document_base64,'base64');
      IF octet_length(bytes) NOT BETWEEN 8 AND 2097152 OR substring(bytes FROM 1 FOR 5)<>convert_to('%PDF-','UTF8')
        OR replace(encode(bytes,'base64'),E'\n','')<>p_document_base64 THEN
        RAISE EXCEPTION 'price_addendum_document_invalid' USING ERRCODE='22023';
      END IF;
      digest:=encode(sha256(bytes),'hex');
      SELECT c.signature_snapshot_sha256,s.id,s.snapshot_hash INTO original
      FROM public.customer_contracts c
      JOIN public.contract_price_snapshots s
        ON (s.company_id,s.customer_id,s.contract_id,s.id)=(c.company_id,c.customer_id,c.id,c.contract_price_snapshot_id)
      WHERE (c.company_id,c.customer_id,c.id)=(p_company_id,p_customer_id,p_contract_id)
        AND c.status IN ('signed','active') AND gridex_billing_source.has_canonical_signed_series_price_v1(
          c.company_id,c.customer_id,c.id,s.id,s.valid_from::timestamp AT TIME ZONE 'Europe/Stockholm',
          (s.valid_from+1)::timestamp AT TIME ZONE 'Europe/Stockholm')
      FOR UPDATE OF c NOWAIT;
      IF NOT FOUND THEN RAISE EXCEPTION 'price_addendum_original_signature_required' USING ERRCODE='23514'; END IF;

      SELECT * INTO stored FROM gridex_billing_source.test_price_addendum_documents
        WHERE (company_id,contract_id,submission_key)=(p_company_id,p_contract_id,p_submission_key);
      replayed:=FOUND;
      IF replayed AND (stored.customer_id,stored.document_sha256,stored.original_signature_sha256,stored.original_price_id,stored.original_price_sha256)
        IS DISTINCT FROM (p_customer_id,digest,original.signature_snapshot_sha256,original.id,original.snapshot_hash) THEN
        RAISE EXCEPTION 'price_addendum_submission_conflict' USING ERRCODE='23505';
      END IF;
      IF NOT replayed THEN
        INSERT INTO gridex_billing_source.test_price_addendum_documents(
          company_id,customer_id,contract_id,submission_key,original_price_id,original_signature_sha256,
          original_price_sha256,document,document_sha256,submitted_by
        ) VALUES(p_company_id,p_customer_id,p_contract_id,p_submission_key,original.id,original.signature_snapshot_sha256,
          original.snapshot_hash,bytes,digest,p_actor_user_id) RETURNING * INTO stored;
      END IF;
      RETURN jsonb_build_object('kind','pending','documentId',stored.id,'documentSha256',stored.document_sha256,
        'byteLength',octet_length(stored.document),'existing',replayed);
    END
    $body$
  $ddl$;
  EXECUTE $ddl$
    CREATE FUNCTION public.gridex_read_test_contract_price_addendum_review_source_v1(
      p_company_id uuid,p_actor_user_id uuid,p_customer_id uuid,p_contract_id uuid,p_document_id uuid
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $body$
    DECLARE
      source gridex_billing_source.test_price_addendum_documents%ROWTYPE;
    BEGIN
      PERFORM gridex_billing_source.require_test_price_addendum_actor_v1(p_company_id,p_actor_user_id);
      SELECT d.* INTO source FROM gridex_billing_source.test_price_addendum_documents d
        JOIN public.customer_contracts c ON (c.company_id,c.customer_id,c.id)=(d.company_id,d.customer_id,d.contract_id)
        WHERE (d.company_id,d.customer_id,d.contract_id,d.id)=(p_company_id,p_customer_id,p_contract_id,p_document_id)
          AND c.status IN ('signed','active') AND c.signature_snapshot_sha256=d.original_signature_sha256
          AND c.contract_price_snapshot_id=d.original_price_id;
      IF NOT FOUND OR source.document_sha256 IS DISTINCT FROM encode(sha256(source.document),'hex') THEN RETURN NULL; END IF;
      RETURN jsonb_build_object('kind','review_source','documentId',source.id,'documentSha256',source.document_sha256,
        'byteLength',octet_length(source.document),'bodyBase64',replace(encode(source.document,'base64'),E'\n',''));
    END
    $body$
  $ddl$;
  EXECUTE $ddl$
    CREATE FUNCTION public.gridex_review_test_contract_price_addendum_v1(
      p_company_id uuid,p_actor_user_id uuid,p_customer_id uuid,p_contract_id uuid,p_document_id uuid,
      p_verified_sha256 text,p_verification jsonb
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog SET "TimeZone" TO 'UTC' AS $body$
    DECLARE
      source gridex_billing_source.test_price_addendum_documents%ROWTYPE;
      prior gridex_billing_source.test_price_addendum_reviews%ROWTYPE;
      signed_on date;
      effective_on date;
      effective_at timestamptz;
      accepted jsonb;
      captured_at timestamptz:=clock_timestamp();
      replayed boolean;
    BEGIN
      PERFORM gridex_billing_source.require_test_price_addendum_actor_v1(p_company_id,p_actor_user_id);
      IF jsonb_typeof(p_verification) IS DISTINCT FROM 'object'
        OR p_verification->>'kind' IS DISTINCT FROM 'staff_manually_verified_signed_addendum_v1'
        OR NOT (p_verification ?& ARRAY['kind','signedOn','effectiveOn','supplierSignerEvidence','customerSignerEvidence','priceOrePerKwh'])
        OR p_verification-ARRAY['kind','signedOn','effectiveOn','supplierSignerEvidence','customerSignerEvidence','priceOrePerKwh']<>'{}'::jsonb
        OR coalesce(p_verification->>'signedOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        OR coalesce(p_verification->>'effectiveOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        OR jsonb_typeof(p_verification->'supplierSignerEvidence') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_verification->'customerSignerEvidence') IS DISTINCT FROM 'string'
        OR length(btrim(p_verification->>'supplierSignerEvidence')) NOT BETWEEN 1 AND 256
        OR length(btrim(p_verification->>'customerSignerEvidence')) NOT BETWEEN 1 AND 256
        OR jsonb_typeof(p_verification->'priceOrePerKwh') IS DISTINCT FROM 'string'
        OR coalesce(p_verification->>'priceOrePerKwh','') !~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,8})?$' THEN
        RAISE EXCEPTION 'price_addendum_manual_evidence_invalid' USING ERRCODE='22023';
      END IF;
      signed_on:=(p_verification->>'signedOn')::date;
      effective_on:=(p_verification->>'effectiveOn')::date;
      effective_at:=effective_on::timestamp AT TIME ZONE 'Europe/Stockholm';
      SELECT * INTO source FROM gridex_billing_source.test_price_addendum_documents
        WHERE (company_id,customer_id,contract_id,id)=(p_company_id,p_customer_id,p_contract_id,p_document_id);
      IF NOT FOUND OR source.document_sha256 IS DISTINCT FROM p_verified_sha256
        OR source.document_sha256 IS DISTINCT FROM encode(sha256(source.document),'hex') THEN
        RAISE EXCEPTION 'price_addendum_document_evidence_changed' USING ERRCODE='23514';
      END IF;
      PERFORM FROM public.customer_contracts c
      JOIN public.contract_price_snapshots s
        ON (s.company_id,s.customer_id,s.contract_id,s.id)=(c.company_id,c.customer_id,c.id,c.contract_price_snapshot_id)
      WHERE (c.company_id,c.customer_id,c.id)=(p_company_id,p_customer_id,p_contract_id)
        AND c.status IN ('signed','active') AND c.signature_snapshot_sha256=source.original_signature_sha256
        AND s.id=source.original_price_id AND s.snapshot_hash=source.original_price_sha256
        AND signed_on<=(captured_at AT TIME ZONE 'Europe/Stockholm')::date
        AND signed_on>=(c.signed_at AT TIME ZONE 'Europe/Stockholm')::date
        AND signed_on<=effective_on AND effective_on>s.valid_from
        AND (s.valid_to IS NULL OR effective_on<=s.valid_to)
        AND gridex_billing_source.has_canonical_signed_series_price_v1(
          c.company_id,c.customer_id,c.id,s.id,s.valid_from::timestamp AT TIME ZONE 'Europe/Stockholm',
          (s.valid_from+1)::timestamp AT TIME ZONE 'Europe/Stockholm')
      FOR UPDATE OF c NOWAIT;
      IF NOT FOUND THEN RAISE EXCEPTION 'price_addendum_original_signature_or_effective_scope_changed' USING ERRCODE='23514'; END IF;

      SELECT r.* INTO prior FROM gridex_billing_source.test_price_addendum_reviews r
        WHERE (r.company_id,r.contract_id,r.document_id)=(p_company_id,p_contract_id,p_document_id);
      replayed:=FOUND;
      IF replayed AND prior.receipt->'verification' IS DISTINCT FROM p_verification THEN
        RAISE EXCEPTION 'price_addendum_review_conflict' USING ERRCODE='23505';
      END IF;
      IF NOT replayed THEN
        accepted:=jsonb_build_object('kind','staff_manually_verified_signed_addendum_v1',
          'verification',p_verification,'actorUserId',p_actor_user_id,'reviewedAt',captured_at,
          'companyId',p_company_id,'customerId',p_customer_id,'contractId',p_contract_id,
          'documentId',source.id,'documentSha256',source.document_sha256,'byteLength',octet_length(source.document),
          'originalSignatureSha256',source.original_signature_sha256,'originalPriceId',source.original_price_id,
          'originalPriceSha256',source.original_price_sha256,'effectiveAt',effective_at);
        INSERT INTO gridex_billing_source.test_price_addendum_reviews(
          company_id,contract_id,document_id,effective_on,effective_at,receipt,receipt_sha256
        ) VALUES(p_company_id,p_contract_id,p_document_id,effective_on,effective_at,accepted,
          encode(sha256(convert_to(accepted::text,'UTF8')),'hex')) RETURNING * INTO prior;
      END IF;
      RETURN jsonb_build_object('kind','reviewed_unapplied','documentId',source.id,
        'reviewSha256',prior.receipt_sha256,'effectiveAt',prior.effective_at,'existing',replayed);
    END
    $body$
  $ddl$;

  EXECUTE $ddl$
    CREATE FUNCTION gridex_billing_source.has_unapplied_test_price_addendum_v1(
      p_company uuid,p_contract uuid,p_end timestamptz
    ) RETURNS boolean LANGUAGE sql STABLE SET search_path TO pg_catalog AS $body$
      SELECT EXISTS(SELECT FROM gridex_billing_source.test_price_addendum_reviews r
        WHERE (r.company_id,r.contract_id)=(p_company,p_contract) AND r.effective_at<p_end)
      OR EXISTS(SELECT FROM public.contract_price_snapshots s WHERE (s.company_id,s.contract_id)=(p_company,p_contract)
        AND s.source='staff_manually_verified_signed_addendum_v1'
        AND (s.valid_from IS NULL OR (s.valid_from::timestamp AT TIME ZONE 'Europe/Stockholm')<p_end))
    $body$
  $ddl$;
  EXECUTE $ddl$
    CREATE FUNCTION gridex_billing_source.require_no_unapplied_test_price_addendum_v1(
      p_company uuid,p_contract uuid,p_start timestamptz,p_end timestamptz
    ) RETURNS void LANGUAGE plpgsql STABLE SET search_path TO pg_catalog AS $body$
    BEGIN
      IF p_end>p_start AND gridex_billing_source.has_unapplied_test_price_addendum_v1(p_company,p_contract,p_end) THEN
        RAISE EXCEPTION 'billing_price_timeline_changed' USING ERRCODE='PT409',
          DETAIL=jsonb_build_object('companyId',p_company,'contractId',p_contract,
            'reason','signed_price_addendum_unapplied')::text;
      END IF;
    END $body$
  $ddl$;
  EXECUTE $ddl$
    CREATE FUNCTION public.gridex_read_effective_contract_price_timeline_v1(
      p_company_id uuid,p_customer_id uuid,p_contract_id uuid,p_start timestamptz,p_end timestamptz
    ) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $body$
    BEGIN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'price_addendum_timeline_scope_required' USING ERRCODE='42501';
      END IF;
      IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start THEN
        RAISE EXCEPTION 'billing_price_timeline_invalid' USING ERRCODE='22023';
      END IF;
      PERFORM FROM public.customer_contracts c
        WHERE (c.company_id,c.customer_id,c.id)=(p_company_id,p_customer_id,p_contract_id);
      IF NOT FOUND THEN RETURN jsonb_build_object('kind','held','reason','price_addendum_contract_scope_required'); END IF;
      IF gridex_billing_source.has_unapplied_test_price_addendum_v1(p_company_id,p_contract_id,p_end) THEN
        RETURN jsonb_build_object('kind','held','reason','signed_price_addendum_unapplied');
      END IF;
      RETURN jsonb_build_object('kind','legacy');
    END
    $body$
  $ddl$;

  REVOKE ALL ON FUNCTION gridex_billing_source.require_test_price_addendum_actor_v1(uuid,uuid),
    gridex_billing_source.has_unapplied_test_price_addendum_v1(uuid,uuid,timestamptz),
    gridex_billing_source.require_no_unapplied_test_price_addendum_v1(uuid,uuid,timestamptz,timestamptz)
      FROM PUBLIC,anon,authenticated,service_role;
  REVOKE ALL ON FUNCTION public.gridex_archive_test_contract_price_addendum_v1(uuid,uuid,uuid,uuid,uuid,text),
    public.gridex_read_test_contract_price_addendum_review_source_v1(uuid,uuid,uuid,uuid,uuid),
    public.gridex_review_test_contract_price_addendum_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb),
    public.gridex_read_effective_contract_price_timeline_v1(uuid,uuid,uuid,timestamptz,timestamptz)
      FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_archive_test_contract_price_addendum_v1(uuid,uuid,uuid,uuid,uuid,text),
    public.gridex_read_test_contract_price_addendum_review_source_v1(uuid,uuid,uuid,uuid,uuid),
    public.gridex_review_test_contract_price_addendum_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb),
    public.gridex_read_effective_contract_price_timeline_v1(uuid,uuid,uuid,timestamptz,timestamptz)
      TO service_role;

  EXECUTE replace(definition,before_body,replace(before_body,old_anchor,new_anchor));
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM before_metadata THEN
    RAISE EXCEPTION 'price_addendum_timeline_metadata_changed';
  END IF;
  FOR other_owner IN SELECT * FROM (VALUES
      ('store','public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)',
        '4f61db6d61aeb4184453ebf412f8a03008a3ce6c3a5f4609d84ede888fb6c56c'),
      ('first_invoice','gridex_billing_source.require_current_invoice_price_timeline_v1(uuid,uuid)',
        'ce923c10855c0e5fb184f7d9a54decc580e03acfb4ba0b1689b27cad23c8a0e6')
    ) functions(kind,signature,digest) LOOP
    SELECT p.prosrc,pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
    INTO STRICT other_body,other_definition,other_metadata FROM pg_proc p WHERE p.oid=other_owner.signature::regprocedure;
    IF encode(sha256(convert_to(other_body,'UTF8')),'hex') IS DISTINCT FROM other_owner.digest THEN
      RAISE EXCEPTION 'price_addendum_first_write_preimage_changed: %',other_owner.signature;
    END IF;
    IF other_owner.kind='store' THEN
      replacement:=replace(other_body,$old$ IF p_underlay#>'{payload,contract_price_timeline}' IS NULL THEN
  SELECT * INTO ct FROM public.customer_contracts WHERE id=(p_underlay->>'contract_id')::uuid AND company_id=p_company_id FOR SHARE;
 ELSE$old$,$new$ IF p_underlay#>'{payload,contract_price_timeline}' IS NULL THEN
  SELECT * INTO ct FROM public.customer_contracts WHERE id=(p_underlay->>'contract_id')::uuid AND company_id=p_company_id FOR SHARE;
  PERFORM gridex_billing_source.require_no_unapplied_test_price_addendum_v1(p_company_id,ct.id,start_at,end_at);
 ELSE$new$);
    ELSE
      replacement:=replace(other_body,$old$      AND u.payload#>'{contract_price_timeline}' IS NOT NULL;$old$,
        $new$      AND (u.payload#>'{contract_price_timeline}' IS NOT NULL OR (
        b.source_basis ?& ARRAY['contractId','start','end'] AND (
          gridex_billing_source.has_unapplied_test_price_addendum_v1(p_company,
            (b.source_basis->>'contractId')::uuid,(b.source_basis->>'end')::timestamptz)
          OR EXISTS(
            SELECT FROM public.companies co JOIN public.customer_contracts c ON c.company_id=co.id
            JOIN public.contract_price_snapshots s
              ON (s.company_id,s.contract_id,s.id)=(c.company_id,c.id,c.contract_price_snapshot_id)
            WHERE co.id=p_company AND co.billing_provider_environment='test'
              AND c.id=(b.source_basis->>'contractId')::uuid AND s.source='signature_prepare'
          )
        )
      ));$new$);
      replacement:=replace(replacement,$old$      PERFORM gridex_billing_source.require_contract_price_timeline_v1(
        p_company,basis_contract,basis_price,basis_start,basis_end,price_timeline);$old$,
        $new$      IF price_timeline IS NULL THEN
        PERFORM gridex_billing_source.require_no_unapplied_test_price_addendum_v1(
          p_company,basis_contract,basis_start,basis_end);
      ELSE
        PERFORM gridex_billing_source.require_contract_price_timeline_v1(
          p_company,basis_contract,basis_price,basis_start,basis_end,price_timeline);
      END IF;$new$);
    END IF;
    IF replacement=other_body THEN
      RAISE EXCEPTION 'price_addendum_first_write_anchor_missing: %',other_owner.signature;
    END IF;
    EXECUTE replace(other_definition,other_body,replacement);
    IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=other_owner.signature::regprocedure)
        IS DISTINCT FROM other_metadata THEN
      RAISE EXCEPTION 'price_addendum_first_write_metadata_changed: %',other_owner.signature;
    END IF;
  END LOOP;
END
$migration$;
