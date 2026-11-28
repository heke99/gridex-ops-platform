-- A newly registered correction must bind complete normalized readings to the original exact period.
-- Period and source checks run before either kind of correction registers its origin.
DO $change$
BEGIN
  EXECUTE $helper$
CREATE OR REPLACE FUNCTION gridex_invoice_file_archive.correction_period_v1(
  p_start date, p_end date, p_payload jsonb
) RETURNS tstzrange
LANGUAGE plpgsql STABLE SET search_path = pg_catalog
AS $period$
DECLARE
  start_text text := p_payload->>'billing_period_start_instant';
  end_text text := p_payload->>'billing_period_end_instant';
  exact_timestamp constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$';
  starts_at timestamptz;
  ends_at timestamptz;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) THEN
    RETURN NULL;
  END IF;
  IF p_payload ? 'billing_period_start_instant' OR p_payload ? 'billing_period_end_instant' THEN
    IF jsonb_typeof(p_payload->'billing_period_start_instant') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_payload->'billing_period_end_instant') IS DISTINCT FROM 'string'
      OR start_text !~ exact_timestamp OR end_text !~ exact_timestamp
      OR NOT pg_input_is_valid(start_text, 'timestamptz')
      OR NOT pg_input_is_valid(end_text, 'timestamptz')
      OR (p_payload ? 'billing_period_timezone'
          AND p_payload->>'billing_period_timezone' IS DISTINCT FROM 'Europe/Stockholm')
      OR (p_payload ? 'billing_period_end_exclusive'
          AND p_payload->'billing_period_end_exclusive' IS DISTINCT FROM 'true'::jsonb) THEN
      RETURN NULL;
    END IF;
    starts_at := start_text::timestamptz;
    ends_at := end_text::timestamptz;
    IF (starts_at AT TIME ZONE 'Europe/Stockholm')::date IS DISTINCT FROM p_start
      OR (ends_at AT TIME ZONE 'Europe/Stockholm')::date > p_end THEN
      RETURN NULL;
    END IF;
  ELSE
    starts_at := p_start::timestamp AT TIME ZONE 'Europe/Stockholm';
    ends_at := p_end::timestamp AT TIME ZONE 'Europe/Stockholm';
  END IF;
  IF ends_at <= starts_at THEN RETURN NULL; END IF;
  RETURN tstzrange(starts_at, ends_at, '[)');
END
$period$;
$helper$;
  REVOKE ALL ON FUNCTION gridex_invoice_file_archive.correction_period_v1(date,date,jsonb) FROM PUBLIC,anon,authenticated,service_role;

  <<gridex_register_invoice_correction_v1>>
  DECLARE
    target regprocedure := 'public.gridex_register_invoice_correction_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure;
    original_body text;
    definition text;
    old_hash constant text := '45131d6c3932b87977e27ba4bde503fa6cb8f094d771938850b78fca8b7aaa05';
    new_hash constant text := 'fb2cb9bb6df4738759b902573293a92bb6fae9eaab428a69e2806d64ed008423';
  BEGIN
    SELECT prosrc,pg_get_functiondef(oid) INTO STRICT original_body,definition
    FROM pg_proc WHERE oid=target;
    IF encode(sha256(convert_to(original_body,'UTF8')),'hex') IS DISTINCT FROM new_hash THEN
      IF encode(sha256(convert_to(original_body,'UTF8')),'hex') IS DISTINCT FROM old_hash THEN
        RAISE EXCEPTION 'invoice_correction_period_preimage_changed:%',target USING ERRCODE='55000';
      END IF;
      definition := replace(definition,$prior_0$coalesce(u.customer_contract_id,u.contract_id) AS contract_id,u.billing_period_start,u.billing_period_end$prior_0$,$next_0$coalesce(u.customer_contract_id,u.contract_id) AS contract_id,u.billing_period_start,u.billing_period_end,u.payload AS period_payload$next_0$);
      definition := replace(definition,$prior_1$      AND m.id=li.source_normalized_metering_value_id$prior_1$,$next_1$      AND m.id=li.source_normalized_metering_value_id
    CROSS JOIN LATERAL (SELECT gridex_invoice_file_archive.correction_period_v1(
      u.billing_period_start,u.billing_period_end,u.payload) AS bounds) corrected_period$next_1$);
      definition := replace(definition,$prior_2$      AND li.period_end>li.period_start AND li.period_start>=m.period_start AND li.period_end<=m.period_end
      AND li.period_start>=(u.billing_period_start::timestamp AT TIME ZONE 'Europe/Stockholm')
      AND li.period_end<=(u.billing_period_end::timestamp AT TIME ZONE 'Europe/Stockholm')$prior_2$,$next_2$      AND corrected_period.bounds=gridex_invoice_file_archive.correction_period_v1(
        original.billing_period_start,original.billing_period_end,original.period_payload)
      AND li.period_end>li.period_start
      AND li.period_start=m.period_start AND li.period_end=m.period_end
      AND li.period_start>=lower(corrected_period.bounds) AND li.period_end<=upper(corrected_period.bounds)$next_2$);
      EXECUTE definition;
      IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=target)
        IS DISTINCT FROM new_hash THEN
        RAISE EXCEPTION 'invoice_correction_period_postimage_changed:%',target USING ERRCODE='55000';
      END IF;
    END IF;
  END gridex_register_invoice_correction_v1;

  <<gridex_register_grouped_invoice_correction_v1>>
  DECLARE
    target regprocedure := 'public.gridex_register_grouped_invoice_correction_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure;
    original_body text;
    definition text;
    old_hash constant text := 'b849e4a8e6e391deb61c0849f36fdcb372d1a9c34eb408aae1f298a6f239825b';
    new_hash constant text := 'ddbadcff3d1d38c2c659b10cec9800f8f06f1c252638f786e8d3267d2cda32c5';
  BEGIN
    SELECT prosrc,pg_get_functiondef(oid) INTO STRICT original_body,definition
    FROM pg_proc WHERE oid=target;
    IF encode(sha256(convert_to(original_body,'UTF8')),'hex') IS DISTINCT FROM new_hash THEN
      IF encode(sha256(convert_to(original_body,'UTF8')),'hex') IS DISTINCT FROM old_hash THEN
        RAISE EXCEPTION 'invoice_correction_period_preimage_changed:%',target USING ERRCODE='55000';
      END IF;
      definition := replace(definition,$prior_0$      AND m.id=li.source_normalized_metering_value_id$prior_0$,$next_0$      AND m.id=li.source_normalized_metering_value_id
    JOIN public.billing_underlays original_underlay ON original_underlay.company_id=u.company_id
      AND original_underlay.id=source_row.billing_underlay_id
      AND original_underlay.billing_period_start=(source_row.snapshot->>'periodStart')::date
      AND original_underlay.billing_period_end=(source_row.snapshot->>'periodEnd')::date
    CROSS JOIN LATERAL (SELECT gridex_invoice_file_archive.correction_period_v1(
      u.billing_period_start,u.billing_period_end,u.payload) AS bounds) corrected_period$next_0$);
      definition := replace(definition,$prior_1$      AND li.period_end>li.period_start
      AND li.period_start>=m.period_start AND li.period_end<=m.period_end
      AND li.period_start>=(u.billing_period_start::timestamp AT TIME ZONE 'Europe/Stockholm')
      AND li.period_end<=(u.billing_period_end::timestamp AT TIME ZONE 'Europe/Stockholm')$prior_1$,$next_1$      AND corrected_period.bounds=gridex_invoice_file_archive.correction_period_v1(
        original_underlay.billing_period_start,original_underlay.billing_period_end,original_underlay.payload)
      AND li.period_end>li.period_start
      AND li.period_start=m.period_start AND li.period_end=m.period_end
      AND li.period_start>=lower(corrected_period.bounds) AND li.period_end<=upper(corrected_period.bounds)$next_1$);
      definition := replace(definition,$prior_2$FOR SHARE OF u,li,m;$prior_2$,$next_2$FOR SHARE OF u,li,m,original_underlay;$next_2$);
      EXECUTE definition;
      IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=target)
        IS DISTINCT FROM new_hash THEN
        RAISE EXCEPTION 'invoice_correction_period_postimage_changed:%',target USING ERRCODE='55000';
      END IF;
    END IF;
  END gridex_register_grouped_invoice_correction_v1;
END
$change$;
