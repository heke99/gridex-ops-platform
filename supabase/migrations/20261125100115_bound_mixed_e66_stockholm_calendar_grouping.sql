-- Parse each already-admitted multisource contract's observations once.
-- The existing calendar and storage owner still checks and writes the grouped periods.
DO $calendar_group$
DECLARE
  target regprocedure:='gridex_e66_intake.consume_owned_utilts_billing_v1(uuid,uuid,uuid,jsonb)';
  original record;
  changed text;
  previous constant text:=$previous$   WITH contributions AS (
    SELECT c.value->>'physicalSourceId' AS physical_source_id,c.value->>'transactionId' AS transaction_id,
    i.value::text::integer AS ordinal,
     c.value->'observations'->(i.value::text::integer) AS observation
    FROM jsonb_array_elements(v_finance_contracts) c
    CROSS JOIN LATERAL jsonb_array_elements(c.value->'billingContributionOrdinals') i
   $previous$;
  replacement constant text:=$replacement$   WITH mixed_contracts AS MATERIALIZED (
    SELECT c.ordinality AS contract_position,c.value->>'physicalSourceId' AS physical_source_id,
     c.value->>'transactionId' AS transaction_id,c.value->'billingContributionOrdinals' AS selected,
     c.value->'observations' AS observations
    FROM jsonb_array_elements(CASE WHEN v_multi IS NOT NULL THEN v_finance_contracts ELSE '[]'::jsonb END)
     WITH ORDINALITY AS c(value,ordinality)
   ), selected AS MATERIALIZED (
    SELECT c.contract_position,c.physical_source_id,c.transaction_id,i.value::text::integer AS ordinal,
     CASE WHEN i.value::text::integer<0 THEN jsonb_array_length(c.observations)+i.value::text::integer
       ELSE i.value::text::integer END AS observation_index
    FROM mixed_contracts c
    CROSS JOIN LATERAL jsonb_array_elements(c.selected) i
   ), owned_observations AS MATERIALIZED (
    SELECT c.contract_position,o.ordinality-1 AS observation_index,o.observation
    FROM mixed_contracts c
    CROSS JOIN LATERAL jsonb_array_elements(c.observations) WITH ORDINALITY AS o(observation,ordinality)
   ), contributions AS (
    SELECT c.value->>'physicalSourceId' AS physical_source_id,c.value->>'transactionId' AS transaction_id,
    i.value::text::integer AS ordinal,
     c.value->'observations'->(i.value::text::integer) AS observation
    FROM jsonb_array_elements(v_finance_contracts) c
    CROSS JOIN LATERAL jsonb_array_elements(c.value->'billingContributionOrdinals') i
    WHERE v_multi IS NULL
    UNION ALL
    SELECT i.physical_source_id,i.transaction_id,i.ordinal,o.observation
    FROM selected i
    LEFT JOIN owned_observations o USING(contract_position,observation_index)
   $replacement$;
BEGIN
  SELECT pg_get_functiondef(p.oid) AS definition,p.prosrc,to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT original FROM pg_proc p WHERE p.oid=target;
  IF encode(sha256(convert_to(original.prosrc,'UTF8')),'hex') <> 'ae7db9101badc708e2a23776636b5f2583fcd9c7a043459f4b24965d69fb663a'
    OR strpos(original.prosrc,previous)=0
  THEN RAISE EXCEPTION 'mixed_e66_calendar_grouping_preimage_changed'; END IF;
  changed:=replace(original.prosrc,previous,replacement);
  EXECUTE replace(original.definition,original.prosrc,changed);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM original.metadata
  THEN RAISE EXCEPTION 'mixed_e66_calendar_grouping_metadata_changed'; END IF;
END
$calendar_group$;
