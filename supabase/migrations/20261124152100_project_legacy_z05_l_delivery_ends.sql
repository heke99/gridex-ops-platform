-- Extend the existing contract portal read, using a committed normal Z22 effect on a legacy start.
DO $migration$
DECLARE
  owner_oid constant regprocedure := 'public.gridex_list_portal_contract_delivery_ends_v1(uuid,uuid[],uuid[])'::regprocedure;
  owner_row record;
  new_body text;
  old_suffix constant text := $legacy$    )
    SELECT p.contract_id,p.id,p.end_date,ended.effective_end_at,p.status
    FROM scoped_periods p
    JOIN verified_ends ended ON (ended.customer_id,ended.period_id,ended.market_state_version,ended.effective_end_at)
      =(p.customer_id,p.id,p.market_state_version,p.market_end_at)
    ORDER BY p.contract_id,ended.effective_end_at,p.id
$legacy$;
  new_suffix constant text := $legacy$    ), legacy_ends AS MATERIALIZED (
      -- A normal Z22 end committed by the object owner on a legacy start.
      -- Keep the established normal-switch and consumption readers unchanged.
      SELECT c.id AS contract_id,p.id AS period_id,p.end_date AS last_delivery_date,
             p.market_end_at,p.status AS supply_status,
             count(*) OVER (PARTITION BY p.id) AS matches
      FROM public.customer_contracts c
      JOIN public.customer_supply_periods p ON p.company_id=c.company_id AND p.customer_id=c.customer_id
        AND p.metering_point_id=c.metering_point_id
        AND coalesce(p.customer_contract_id,p.contract_id)=c.id
        AND (p.contract_id IS NULL OR p.contract_id=c.id)
      JOIN public.metering_points point ON (point.company_id,point.customer_id,point.id)
        =(p.company_id,p.customer_id,p.metering_point_id)
      JOIN public.ediel_messages ending ON (ending.company_id,ending.id)=(p.company_id,p.source_end_message_id)
        AND (ending.direction,ending.message_family,ending.message_code)=('inbound','PRODAT','Z05')
      JOIN public.ediel_messages initial ON (initial.company_id,initial.environment,initial.id)
        =(p.company_id,ending.environment,p.source_message_id)
        AND (initial.direction,initial.message_family,initial.message_code)=('inbound','PRODAT','Z04')
      JOIN gridex_received_sources.supply_object_partitions partitioned
        ON (partitioned.company_id,partitioned.environment,partitioned.source_message_id)
          =(ending.company_id,ending.environment,ending.id)
      JOIN gridex_received_sources.supply_object_effect_receipts receipt
        ON (receipt.company_id,receipt.environment,receipt.source_message_id,receipt.canonical_assessment_id,receipt.payload_hash)
          =(partitioned.company_id,partitioned.environment,partitioned.source_message_id,
            partitioned.canonical_assessment_id,partitioned.payload_hash)
      JOIN gridex_received_sources.supply_source_transitions transition
        ON (transition.company_id,transition.source_message_id,transition.source_code,transition.payload_hash)
          =(ending.company_id,ending.id,'Z05',partitioned.payload_hash)
      JOIN gridex_received_sources.validation_assessments assessed
        ON (assessed.company_id,assessed.environment,assessed.source_message_id,assessed.id,assessed.source_payload_hash)
          =(ending.company_id,ending.environment,ending.id,partitioned.canonical_assessment_id,partitioned.payload_hash)
      CROSS JOIN LATERAL (SELECT receipt.effect_text::jsonb AS facts) effect
      CROSS JOIN LATERAL jsonb_array_elements(effect.facts->'resultingStates') saved
      WHERE (current_setting('role',true)='service_role' OR session_user='service_role')
        AND c.company_id=p_company_id AND c.customer_id=ANY(p_customer_ids) AND c.id=ANY(p_contract_ids)
        AND cardinality(p_customer_ids) BETWEEN 1 AND 100
        AND cardinality(p_contract_ids) BETWEEN 1 AND 100
        AND p.source='ediel_qualified_source' AND p.actual_start_date IS NOT NULL AND p.actual_end_date IS NULL
        AND isfinite(p.end_date) AND isfinite(p.market_start_at) AND isfinite(p.market_end_at)
        AND p.market_start_at<p.market_end_at AND p.market_state_version IS NOT NULL
        AND (p.status='ending' OR (p.status='ended' AND p.market_end_at<=statement_timestamp()))
        AND (c.status IN ('signed','active') OR (c.status='terminated' AND c.termination_reason='supply_end'
          AND p.end_date IN ((c.ended_at AT TIME ZONE 'UTC')::date,(c.ended_at AT TIME ZONE 'Europe/Stockholm')::date)))
        AND NOT EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations known
          WHERE known.company_id=p.company_id AND known.period_id=p.id)
        AND NOT EXISTS(SELECT FROM gridex_ediel_retention.customer_tombstones gone
          WHERE gone.company_id=p.company_id AND gone.customer_id=p.customer_id)
        AND NOT EXISTS(SELECT FROM gridex_ediel_retention.blob_tombstones gone
          WHERE gone.company_id=p.company_id AND gone.message_id IN (ending.id,initial.id))
        AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments newer
          WHERE newer.previous_assessment_id=assessed.id)
        AND assessed.facts_text::jsonb->>'syntaxDecision'='accepted'
        AND assessed.facts_text::jsonb->>'functionalDecision'='accepted'
        AND partitioned.payload_hash=encode(sha256(convert_to(ending.raw_payload,'UTF8')),'hex')
        AND partitioned.partition_hash=encode(sha256(convert_to(partitioned.partition_text,'UTF8')),'hex')
        AND receipt.effect_hash=encode(sha256(convert_to(receipt.effect_text,'UTF8')),'hex')
        AND effect.facts->>'version'='1' AND effect.facts->>'owner'='inbound-supply-object-v1'
        AND effect.facts->>'companyId'=p.company_id::text AND effect.facts->>'environment'=ending.environment
        AND effect.facts->>'sourceMessageId'=ending.id::text AND effect.facts->>'sourcePayloadHash'=partitioned.payload_hash
        AND effect.facts->>'canonicalAssessmentId'=assessed.id::text AND effect.facts->'object'=receipt.object_scope
        AND effect.facts#>>'{legalContext,actorRole}'='electricity_supplier'
        AND effect.facts#>>'{legalContext,code}'='Z05' AND effect.facts#>>'{legalContext,family}'='PRODAT'
        AND effect.facts#>>'{plan,kind}'='end' AND effect.facts#>>'{plan,periodId}'=p.id::text
        AND effect.facts#>>'{wire,reason}'='Z22' AND effect.facts#>>'{wire,point}'=point.ediel_metering_point_id
        AND effect.facts#>>'{wire,point}'=receipt.object_scope->>'objectId'
        AND effect.facts#>>'{wire,identityAgency}'=receipt.object_scope->>'identityAgency'
        AND effect.facts#>>'{wire,gridArea}'=point.grid_area_code
        AND gridex_received_sources.permission_time_v1(effect.facts#>>'{wire,end}')=p.market_end_at
        AND gridex_received_sources.permission_date_v1(effect.facts#>>'{wire,end}')=p.end_date
        AND jsonb_array_length(effect.facts->'resultingStates')=1
        AND saved->>'id'=p.id::text AND saved->>'status' IN ('ending','ended')
        AND saved-ARRAY['updated_at','status']=to_jsonb(p)-ARRAY['updated_at','status']
        AND transition.resulting_states@>jsonb_build_array(saved)
        AND transition.source_objects@>jsonb_build_array(effect.facts->'wire')
        AND EXISTS(SELECT FROM jsonb_array_elements(partitioned.partition_text::jsonb) part
          WHERE part->'object'=receipt.object_scope AND part->>'disposition'='applied'
            AND part->>'effectReceiptId'=receipt.id::text AND part->>'effectFactsHash'=receipt.effect_hash)
        AND NOT EXISTS(SELECT FROM gridex_bilateral_prodat.supply_effect_receipts other
          WHERE other.company_id=p.company_id AND other.source_message_id=ending.id)
        AND NOT EXISTS(SELECT FROM gridex_bilateral_prodat.closure_end_receipts other
          WHERE other.company_id=p.company_id AND other.source_message_id=ending.id)
        AND NOT EXISTS(SELECT FROM gridex_supply_rescission.end_receipts other
          WHERE other.company_id=p.company_id AND other.source_message_id=ending.id)
    )
    SELECT p.contract_id,p.id AS period_id,p.end_date AS last_delivery_date,ended.effective_end_at AS market_end_at,p.status AS supply_status
    FROM scoped_periods p
    JOIN verified_ends ended ON (ended.customer_id,ended.period_id,ended.market_state_version,ended.effective_end_at)
      =(p.customer_id,p.id,p.market_state_version,p.market_end_at)
    UNION ALL
    SELECT l.contract_id,l.period_id,l.last_delivery_date,l.market_end_at,l.supply_status
    FROM legacy_ends l WHERE l.matches=1
    ORDER BY contract_id,market_end_at,period_id
$legacy$;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  SELECT p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
    INTO STRICT owner_row FROM pg_proc p WHERE p.oid=owner_oid;
  IF encode(sha256(convert_to(owner_row.prosrc,'UTF8')),'hex') IS DISTINCT FROM
    '18b109b32ed3a96b093249fb3dbf4e1dd7e1100c1ee15dfd60615eb9e2fe9539'
    OR (length(owner_row.prosrc)-length(replace(owner_row.prosrc,old_suffix,'')))/length(old_suffix)<>1
  THEN RAISE EXCEPTION 'portal_legacy_delivery_end_predecessor_changed'; END IF;
  new_body:=replace(owner_row.prosrc,old_suffix,new_suffix);
  IF encode(sha256(convert_to(new_body,'UTF8')),'hex') IS DISTINCT FROM
    '7b24ad2d25d3e09afb5ec2caf4b4470cd874a4e621d2c19eb2a69900991732d5'
  THEN RAISE EXCEPTION 'portal_legacy_delivery_end_postimage_changed'; END IF;
  EXECUTE replace(owner_row.definition,owner_row.prosrc,new_body);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=owner_oid) IS DISTINCT FROM owner_row.metadata
    OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=owner_oid) IS DISTINCT FROM new_body
  THEN RAISE EXCEPTION 'portal_legacy_delivery_end_metadata_changed'; END IF;
END
$migration$;
