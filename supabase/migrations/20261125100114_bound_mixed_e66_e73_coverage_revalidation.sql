-- Validate each locked E73 effect with the established canonical fingerprint fields.
-- Keep the same source, child, ordinal, revision and content checks without serializing unrelated evidence.
CREATE FUNCTION gridex_e66_intake.mixed_e73_value_fingerprint_v1(m public.metering_values)
RETURNS bytea LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $fingerprint$
 SELECT CASE WHEN m IS NOT DISTINCT FROM NULL THEN NULL ELSE sha256(convert_to(
    jsonb_build_object(
      'id',m.id, 'company_id',m.company_id,
      'customer_id',m.customer_id, 'site_id',m.site_id,
      'customer_site_id',m.customer_site_id, 'metering_point_id',m.metering_point_id,
      'grid_owner_id',m.grid_owner_id, 'source_request_id',m.source_request_id,
      'source_ediel_message_id',m.source_ediel_message_id, 'source_transaction_id',m.source_transaction_id,
      'source_transaction_reference',m.source_transaction_reference, 'source_line_reference',m.source_line_reference,
      'source_system',m.source_system, 'price_area',m.price_area,
      'resolution',m.resolution, 'value_kwh',m.value_kwh,
      'quality_code',m.quality_code, 'reading_type',m.reading_type,
      'period_start',m.period_start, 'period_end',m.period_end,
      'read_at',m.read_at, 'register_code',m.register_code,
      'product_code',m.product_code, 'direction',m.direction,
      'unit',m.unit, 'canonical_dedupe_key',m.canonical_dedupe_key,
      'previous_value_id',m.previous_value_id, 'revision_number',m.revision_number
    )::text,'UTF8')) END
$fingerprint$;
REVOKE ALL ON FUNCTION gridex_e66_intake.mixed_e73_value_fingerprint_v1(public.metering_values) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_e66_intake.mixed_e73_normalized_fingerprint_v1(n public.normalized_metering_values)
RETURNS bytea LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $fingerprint$
 SELECT CASE WHEN n IS NOT DISTINCT FROM NULL THEN NULL ELSE sha256(convert_to(
    jsonb_build_object(
      'id',n.id, 'company_id',n.company_id,
      'customer_id',n.customer_id, 'site_id',n.site_id,
      'customer_site_id',n.customer_site_id, 'metering_point_id',n.metering_point_id,
      'source_metering_value_id',n.source_metering_value_id, 'source_message_id',n.source_message_id,
      'source_transaction_reference',n.source_transaction_reference, 'source_line_reference',n.source_line_reference,
      'source_type',n.source_type, 'facility_id',n.facility_id,
      'price_area',n.price_area, 'grid_area',n.grid_area,
      'resolution',n.resolution, 'quantity_kwh',n.quantity_kwh,
      'quality_status',n.quality_status, 'period_start',n.period_start,
      'period_end',n.period_end, 'register_code',n.register_code,
      'product_code',n.product_code, 'direction',n.direction,
      'unit',n.unit, 'canonical_dedupe_key',n.canonical_dedupe_key,
      'previous_value_id',n.previous_value_id, 'revision_number',n.revision_number
    )::text,'UTF8')) END
$fingerprint$;
REVOKE ALL ON FUNCTION gridex_e66_intake.mixed_e73_normalized_fingerprint_v1(public.normalized_metering_values) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_e66_intake.current_mixed_e73_application_v1(
  p_company uuid,p_environment text,p_source uuid,p_transaction text,p_ordinal integer,p_metering_id uuid,
  p_contract_digest bytea,p_source_line text
) RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $current$
 SELECT n.id
 FROM gridex_utilts_binding.metering_application_receipts r
 JOIN public.metering_values m ON (m.company_id,m.id)=(r.company_id,r.value_id)
 JOIN public.normalized_metering_values n
   ON (n.company_id,n.id,n.source_metering_value_id)=(r.company_id,r.normalized_id,r.value_id)
 JOIN public.metering_value_sources l
   ON (l.id,l.company_id,l.metering_value_id,l.normalized_metering_value_id,
       l.source_ediel_message_id,l.source_transaction_reference)
   =(r.source_link_id,r.company_id,r.value_id,r.normalized_id,r.source_message_id,r.transaction_id)
 WHERE (r.company_id,r.environment,r.source_message_id,r.transaction_id,r.observation_ordinal,r.value_id)
   =(p_company,p_environment,p_source,p_transaction,p_ordinal,p_metering_id)
 AND l.source_line_reference IS NOT DISTINCT FROM p_source_line
 AND r.contract_hash=p_contract_digest
 AND r.value_hash=gridex_e66_intake.mixed_e73_value_fingerprint_v1(m)
 AND r.normalized_hash=gridex_e66_intake.mixed_e73_normalized_fingerprint_v1(n)
 AND m.is_current AND m.revision_status='current' AND n.revision_status='current'
$current$;
REVOKE ALL ON FUNCTION gridex_e66_intake.current_mixed_e73_application_v1(uuid,text,uuid,text,integer,uuid,bytea,text)
  FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE
  target regprocedure:='gridex_e66_intake.read_mixed_e73_evidence_v1(uuid,text,uuid,uuid,text)';
  original record;
  changed text;
  previous constant text:=$previous$  WITH effects AS MATERIALIZED (
    SELECT e || jsonb_build_object('meteringHash',encode(r.value_hash,'hex'),
      'normalizedHash',encode(r.normalized_hash,'hex'),'sourceLinkId',r.source_link_id,
      'normalizedOriginSourceId',nv.source_message_id,'linkedSourceId',l.source_ediel_message_id) AS effect,
      tstzrange(v.period_start,v.period_end,'[)') AS period
  FROM jsonb_array_elements(child_effects) WITH ORDINALITY AS sealed(e, ordinality)
  JOIN gridex_utilts_binding.metering_application_receipts r
    ON (r.source_message_id,r.company_id,r.environment,r.transaction_id,r.observation_ordinal,r.value_id::text,r.normalized_id::text)
      =(p_source,p_company,p_environment,p_transaction,(e->>'ordinal')::integer,e->>'meteringId',e->>'normalizedId')
  JOIN public.metering_values v ON (v.company_id,v.id)=(r.company_id,r.value_id)
  JOIN public.metering_value_sources l
    ON (l.company_id,l.id,l.source_ediel_message_id,l.source_transaction_reference,l.metering_value_id,l.normalized_metering_value_id)
      =(r.company_id,r.source_link_id,p_source,p_transaction,r.value_id,r.normalized_id)
    AND l.source_type='ediel_utilts'
  JOIN public.normalized_metering_values nv
    ON (nv.company_id,nv.id,nv.source_metering_value_id)=(r.company_id,r.normalized_id,r.value_id)
  WHERE ordinality=(e->>'ordinal')::integer+1
    AND gridex_e66_metering_stage.current_mixed_application_v1(
      p_company,p_environment,p_source,p_transaction,r.observation_ordinal,r.value_id,child_contract
    )=r.normalized_id
$previous$;
  replacement constant text:=$replacement$  IF child_contract->>'transactionId' IS DISTINCT FROM p_transaction
    OR child_contract->>'environment' IS DISTINCT FROM p_environment THEN RETURN NULL; END IF;
  contract_digest:=decode(child_contract_hash,'hex');

  WITH effects AS MATERIALIZED (
    SELECT e || jsonb_build_object('meteringHash',encode(r.value_hash,'hex'),
      'normalizedHash',encode(r.normalized_hash,'hex'),'sourceLinkId',r.source_link_id,
      'normalizedOriginSourceId',nv.source_message_id,'linkedSourceId',l.source_ediel_message_id) AS effect,
      tstzrange(v.period_start,v.period_end,'[)') AS period
  FROM jsonb_array_elements(child_effects) WITH ORDINALITY AS sealed(e, ordinality)
  JOIN gridex_utilts_binding.metering_application_receipts r
    ON (r.source_message_id,r.company_id,r.environment,r.transaction_id,r.observation_ordinal,r.value_id::text,r.normalized_id::text)
      =(p_source,p_company,p_environment,p_transaction,(e->>'ordinal')::integer,e->>'meteringId',e->>'normalizedId')
  JOIN public.metering_values v ON (v.company_id,v.id)=(r.company_id,r.value_id)
  JOIN public.metering_value_sources l
    ON (l.company_id,l.id,l.source_ediel_message_id,l.source_transaction_reference,l.metering_value_id,l.normalized_metering_value_id)
      =(r.company_id,r.source_link_id,p_source,p_transaction,r.value_id,r.normalized_id)
    AND l.source_type='ediel_utilts'
  JOIN public.normalized_metering_values nv
    ON (nv.company_id,nv.id,nv.source_metering_value_id)=(r.company_id,r.normalized_id,r.value_id)
  WHERE ordinality=(e->>'ordinal')::integer+1
    AND gridex_e66_intake.current_mixed_e73_application_v1(
      p_company,p_environment,p_source,p_transaction,r.observation_ordinal,r.value_id,contract_digest,
      child_contract->'observations'->r.observation_ordinal->>'sourceLineReference'
    )=r.normalized_id
$replacement$;
BEGIN
  SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT original FROM pg_proc p WHERE p.oid=target;
  IF encode(sha256(convert_to(original.prosrc,'UTF8')),'hex') <> 'f5f9a2faa44c8d476e8417df29d766e5a2813614d7b9303bba69ec8e6ed6cedd'
    OR strpos(original.prosrc,previous)=0
  THEN RAISE EXCEPTION 'mixed_e66_coverage_preimage_changed %',target; END IF;
  changed:=replace(original.prosrc,previous,replacement);
  changed:=replace(changed,E'  child_contract_hash text;\n',E'  child_contract_hash text;\n  contract_digest bytea;\n');
  EXECUTE replace(original.definition,original.prosrc,changed);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM original.metadata
  THEN RAISE EXCEPTION 'mixed_e66_coverage_metadata_changed %',target; END IF;
END
$patch$;
DO $patch$
DECLARE
  target regprocedure:='gridex_e66_intake.seal_mixed_billing_multisource_coverage_v1(uuid,uuid,uuid)';
  original record;
  changed text;
  previous constant text:=$previous$    SELECT jsonb_agg(jsonb_build_object(
      'sourceId',child.source_id,'sourceSha256',child.payload_sha256,'transactionId',child.transaction_id,
      'seriesId',child.series_id,'basisSha256',child.evidence_sha256,'contractSha256',current_basis->>'contractHash',
      'ordinal',(observation->>'ordinal')::int,'periodStart',(observation->>'periodStart')::timestamptz,
      'periodEnd',(observation->>'periodEnd')::timestamptz,'meteringId',effect->>'meteringId',
      'meteringHash',effect->>'meteringHash','normalizedId',effect->>'normalizedId',
      'normalizedHash',effect->>'normalizedHash','sourceLinkId',effect->>'sourceLinkId')
      ORDER BY (observation->>'ordinal')::int),
      sum((observation->>'quantity')::numeric),count(*)
    INTO child_members,child_total,child_count
    FROM jsonb_array_elements(original_contract->'observations') observation
    JOIN LATERAL jsonb_array_elements(current_basis->'childEffects') effect
      ON effect->>'ordinal'=observation->>'ordinal' AND effect->>'linkedSourceId'=child.source_id::text
    WHERE (observation->>'periodStart')::timestamptz>=lower(expected_range)
      AND (observation->>'periodEnd')::timestamptz<=upper(expected_range)
      AND (observation->>'periodStart')::timestamptz<(observation->>'periodEnd')::timestamptz
      AND (observation->>'quantity') IS NOT NULL;
$previous$;
  replacement constant text:=$replacement$    WITH observations AS MATERIALIZED (
      SELECT ordinal, "periodStart" AS period_start, "periodEnd" AS period_end, quantity
      FROM jsonb_to_recordset(original_contract->'observations')
      AS o(ordinal text,"periodStart" timestamptz,"periodEnd" timestamptz,quantity numeric)
      WHERE "periodStart">=lower(expected_range) AND "periodEnd"<=upper(expected_range)
        AND "periodStart"<"periodEnd" AND quantity IS NOT NULL
    ), effects AS MATERIALIZED (
      SELECT ordinal,"meteringId","meteringHash","normalizedId","normalizedHash","sourceLinkId"
      FROM jsonb_to_recordset(current_basis->'childEffects')
      AS e(ordinal text,"linkedSourceId" text,"meteringId" text,"meteringHash" text,
           "normalizedId" text,"normalizedHash" text,"sourceLinkId" text)
      WHERE "linkedSourceId"=child.source_id::text
    )
    SELECT jsonb_agg(jsonb_build_object(
      'sourceId',child.source_id,'sourceSha256',child.payload_sha256,'transactionId',child.transaction_id,
      'seriesId',child.series_id,'basisSha256',child.evidence_sha256,'contractSha256',current_basis->>'contractHash',
      'ordinal',o.ordinal::integer,'periodStart',o.period_start,'periodEnd',o.period_end,
      'meteringId',e."meteringId",'meteringHash',e."meteringHash",'normalizedId',e."normalizedId",
      'normalizedHash',e."normalizedHash",'sourceLinkId',e."sourceLinkId")
      ORDER BY o.ordinal::integer),sum(o.quantity),count(*)
    INTO child_members,child_total,child_count
    FROM observations o JOIN effects e USING(ordinal);
$replacement$;
BEGIN
  SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT original FROM pg_proc p WHERE p.oid=target;
  IF encode(sha256(convert_to(original.prosrc,'UTF8')),'hex') <> 'd291d0ed4d80bc1a0775bd13fe349b15f7f84e4d674f1931ae516efd4e249281'
    OR strpos(original.prosrc,previous)=0
  THEN RAISE EXCEPTION 'mixed_e66_coverage_preimage_changed %',target; END IF;
  changed:=replace(original.prosrc,previous,replacement);
  EXECUTE replace(original.definition,original.prosrc,changed);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM original.metadata
  THEN RAISE EXCEPTION 'mixed_e66_coverage_metadata_changed %',target; END IF;
END
$patch$;
