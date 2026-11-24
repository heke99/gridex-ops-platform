-- Keep the market writer's existing row lock. Share its exact transport
-- qualification with the read-only portal path.
DO $verify_transport_owner$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = 'gridex_ediel_transport.accepted_source_basis_v1(public.ediel_messages)'::regprocedure
      AND p.prosecdef
      AND encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') = 'e9d3df182a52ef5228ba54d96197770cb67e4e3bb91bc5cbee19103ea57adbed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'supply_end_transport_preimage_changed';
  END IF;
END
$verify_transport_owner$;

CREATE FUNCTION gridex_ediel_transport.accepted_source_projection_current_v1(p_message public.ediel_messages)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
SET TimeZone = 'UTC'
AS $$
DECLARE m public.ediel_messages%rowtype;candidates jsonb;candidate jsonb;binding jsonb;provider jsonb;plan jsonb;recipient text;original_hash text;
 p_company_id uuid:=p_message.company_id;p_environment text:=p_message.environment;p_message_id uuid:=p_message.id;
BEGIN
 IF p_company_id IS NULL OR p_message_id IS NULL OR (p_environment IN('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_accepted_projection_scope_required';END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id AND environment=p_environment AND id=p_message_id AND direction='outbound';
 IF m.raw_payload IS DISTINCT FROM p_message.raw_payload OR m.immutable_payload_hash IS DISTINCT FROM p_message.immutable_payload_hash THEN RAISE EXCEPTION 'ediel_accepted_projection_original_changed';END IF;
 -- Both journals are private, append-only observations. A latest/default
 -- attempt, route, guide or market permission is never selected here.
 SELECT coalesce(jsonb_agg(v),'[]') INTO candidates FROM (
  SELECT jsonb_build_object('lane','generic_journal','attemptId',a.id,'binding',a.binding,'providerReceipt',a.provider_result,'observedAt',a.observed_at,'entered',a.entered_at IS NOT NULL,'originalHash',a.binding->>'originalHash') v
   FROM gridex_ediel_transport.attempts a WHERE a.company_id=p_company_id AND a.environment=p_environment AND a.message_id=p_message_id AND a.classification='accepted'
  UNION ALL
  SELECT jsonb_build_object('lane','sealed_z08','attemptId',a.id,'binding',a.binding,'providerReceipt',e.facts->'provider','observedAt',e.observed_at,
    'entered',EXISTS(SELECT FROM gridex_outbound_dispatch.events entry WHERE entry.attempt_id=a.id AND entry.company_id=p_company_id AND entry.environment=p_environment AND entry.message_id=p_message_id AND entry.kind='provider_call_entered'),
    'originalHash',o.payload_hash,'sealedHash',encode(sha256(convert_to(o.raw_payload,'UTF8')),'hex'))
   FROM gridex_outbound_dispatch.attempts a JOIN gridex_outbound_dispatch.originals o ON o.message_id=a.message_id AND o.company_id=a.company_id AND o.environment=a.environment
   JOIN gridex_outbound_dispatch.events e ON e.attempt_id=a.id AND e.company_id=a.company_id AND e.environment=a.environment AND e.message_id=a.message_id AND e.kind='provider_result' AND e.facts->>'classification'='accepted'
   WHERE a.company_id=p_company_id AND a.environment=p_environment AND a.message_id=p_message_id
  LIMIT 2
 ) receipts;
 IF jsonb_array_length(candidates)=0 THEN RETURN NULL;END IF;
 IF jsonb_array_length(candidates)<>1 THEN RAISE EXCEPTION 'ediel_accepted_projection_ambiguous';END IF;
 candidate:=candidates->0;binding:=candidate->'binding';provider:=candidate->'providerReceipt';plan:=binding->'businessExpectationPlan';recipient:=nullif(binding->>'to','');
 original_hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 IF m.raw_payload IS NULL OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM original_hash OR candidate->>'originalHash' IS DISTINCT FROM original_hash OR binding->>'originalHash' IS DISTINCT FROM original_hash OR (candidate->>'lane'='sealed_z08' AND candidate->>'sealedHash' IS DISTINCT FROM original_hash) THEN RAISE EXCEPTION 'ediel_accepted_projection_original_changed';END IF;
 IF candidate->>'entered' IS DISTINCT FROM 'true' OR nullif(candidate->>'observedAt','') IS NULL OR NOT isfinite((candidate->>'observedAt')::timestamptz) OR recipient IS NULL
  OR jsonb_typeof(provider) IS DISTINCT FROM 'object' OR jsonb_typeof(provider->'accepted') IS DISTINCT FROM 'array' OR jsonb_typeof(provider->'rejected') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'ediel_accepted_projection_receipt_invalid';END IF;
 IF jsonb_array_length(provider->'accepted')<1 OR jsonb_array_length(provider->'rejected')<>0 OR EXISTS(SELECT FROM jsonb_array_elements(provider->'accepted') v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string' OR lower(v#>>'{}') IS DISTINCT FROM lower(recipient)) OR (provider->>'messageId' IS NOT NULL AND jsonb_typeof(provider->'messageId') IS DISTINCT FROM 'string') OR (provider->>'response' IS NOT NULL AND jsonb_typeof(provider->'response') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'ediel_accepted_projection_expected_recipient_required';END IF;
 IF plan IS NOT NULL AND plan<>'null'::jsonb AND (jsonb_typeof(plan) IS DISTINCT FROM 'object' OR plan->>'version' IS DISTINCT FROM '1' OR plan->>'sourceCode' IS DISTINCT FROM m.message_code OR plan->>'expectedFamily' IS DISTINCT FROM 'PRODAT' OR plan->>'anchor' IS DISTINCT FROM 'actual_accepted_smtp_observed_at') THEN RAISE EXCEPTION 'ediel_accepted_projection_frozen_plan_invalid';END IF;
 RETURN jsonb_build_object('status','accepted_projection','companyId',p_company_id,'environment',p_environment,'messageId',p_message_id,'attemptId',candidate->>'attemptId','lane',candidate->>'lane','originalHash',original_hash,'observedAt',candidate->>'observedAt','providerReceipt',jsonb_build_object('accepted',provider->'accepted','rejected',provider->'rejected','messageId',provider->'messageId','response',provider->'response'),'frozenRecipient',recipient,'businessExpectationPlan',plan,'authorizesProviderEntry',false,'deliveryProven',false);
END $$;

REVOKE ALL ON FUNCTION gridex_ediel_transport.accepted_source_projection_current_v1(public.ediel_messages)
  FROM PUBLIC, anon, authenticated, service_role;

DO $preserve_transport_owner$
DECLARE
  transport_owner name;
BEGIN
  SELECT pg_get_userbyid(p.proowner) INTO STRICT transport_owner
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'gridex_ediel_transport.accepted_source_basis_v1(public.ediel_messages)'::regprocedure;
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION gridex_ediel_transport.accepted_source_projection_current_v1(public.ediel_messages) TO %I',
    current_user);
  EXECUTE format(
    'ALTER FUNCTION gridex_ediel_transport.accepted_source_projection_current_v1(public.ediel_messages) OWNER TO %I',
    transport_owner);
END
$preserve_transport_owner$;

CREATE OR REPLACE FUNCTION gridex_ediel_transport.accepted_source_basis_v1(p_message public.ediel_messages)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
SET TimeZone = 'UTC'
AS $$
DECLARE m public.ediel_messages%rowtype;
 p_company_id uuid:=p_message.company_id;p_environment text:=p_message.environment;p_message_id uuid:=p_message.id;
BEGIN
 IF p_company_id IS NULL OR p_message_id IS NULL OR (p_environment IN('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_accepted_projection_scope_required';END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id AND environment=p_environment AND id=p_message_id AND direction='outbound' FOR SHARE;
 RETURN gridex_ediel_transport.accepted_source_projection_current_v1(p_message);
END $$;

-- The portal calls this only after binding the registered API principal to
-- this customer. Read one committed snapshot of the existing market history.
CREATE FUNCTION public.gridex_portal_verified_supply_ends_v1(
  p_company_id uuid, p_customer_id uuid, p_period_ids uuid[]
)
RETURNS TABLE(period_id uuid, market_state_version bigint, effective_end_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
SET TimeZone = 'UTC'
SET row_security = off
AS $portal_supply_ends$
  WITH scope AS MATERIALIZED (
    SELECT p.*
    FROM public.customer_supply_periods p
    WHERE p.company_id = p_company_id
      AND p.customer_id = p_customer_id
      AND p.id = ANY(p_period_ids)
      AND cardinality(p_period_ids) BETWEEN 1 AND 1000
      AND p.status = 'ended'
      AND p.actual_start_date IS NOT NULL
      AND p.actual_end_date IS NULL
      AND p.source = 'ediel_qualified_source'
      AND p.source_process = 'supplier_switch_confirmation'
      AND isfinite(p.market_start_at) AND isfinite(p.market_end_at)
      AND p.market_start_at < p.market_end_at
      AND p.market_end_at <= statement_timestamp()
      AND NOT EXISTS (
        SELECT FROM gridex_ediel_retention.customer_tombstones t
        WHERE t.company_id = p_company_id AND t.customer_id = p_customer_id
      )
  ), source_scope AS MATERIALIZED (
    SELECT p.id, p.market_state_version, p.market_end_at, origin,
      origin.id AS original_id, initial.id AS initial_id, ending.id AS ending_id
    FROM scope p
    JOIN gridex_received_sources.normal_switch_confirmations n
      ON (n.company_id, n.period_id, n.source_message_id) = (p.company_id, p.id, p.source_message_id)
    JOIN gridex_received_sources.normal_supply_activations activation
      ON (activation.company_id, activation.period_id, activation.source_message_id)
         = (p.company_id, p.id, n.source_message_id)
    JOIN public.supplier_switch_requests sw
      ON (sw.company_id, sw.id, sw.customer_id, sw.metering_point_id)
         = (p.company_id, n.switch_id, p.customer_id, p.metering_point_id)
    JOIN public.customer_contracts contract
      ON (contract.company_id, contract.id, contract.customer_id, contract.metering_point_id)
         = (p.company_id, n.contract_id, p.customer_id, p.metering_point_id)
    JOIN public.ediel_messages origin
      ON (origin.company_id, origin.id) = (p.company_id, n.original_message_id)
    JOIN public.ediel_messages initial
      ON (initial.company_id, initial.id, initial.environment)
         = (p.company_id, p.source_message_id, origin.environment)
    JOIN public.ediel_messages ending
      ON (ending.company_id, ending.id, ending.environment)
         = (p.company_id, p.source_end_message_id, origin.environment)
    JOIN gridex_received_sources.supply_source_transitions initial_receipt
      ON (initial_receipt.company_id, initial_receipt.source_message_id, initial_receipt.source_code)
         = (p.company_id, initial.id, 'Z04')
    JOIN gridex_received_sources.supply_source_transitions end_receipt
      ON (end_receipt.company_id, end_receipt.source_message_id, end_receipt.source_code)
         = (p.company_id, ending.id, 'Z05')
    JOIN gridex_ediel_inbound_context.receipts legal
      ON (legal.company_id, legal.source_message_id, legal.environment, legal.direction)
         = (p.company_id, initial.id, initial.environment, initial.direction)
    WHERE p.market_start_at = n.market_start_at
      AND p.customer_id::text = n.confirmed_period->>'customer_id'
      AND p.metering_point_id::text = n.confirmed_period->>'metering_point_id'
      AND p.source_switch_request_id = sw.id
      AND sw.inbound_z04_message_id = initial.id AND sw.outbound_z03_message_id = origin.id
      AND sw.lifecycle_blocked IS FALSE
      AND sw.status IN (n.confirmed_switch->>'status', 'completed')
      AND (contract.status IN ('signed', 'active')
        OR (contract.status = 'terminated' AND contract.termination_reason = 'supply_end'
          AND contract.ended_at IS NOT NULL AND p.end_date IS NOT NULL
          AND p.end_date IN ((contract.ended_at AT TIME ZONE 'UTC')::date,
                             (contract.ended_at AT TIME ZONE 'Europe/Stockholm')::date)))
      AND gridex_received_sources.production_contract_hash_v1(contract) = n.protected_contract_hash
      AND (origin.direction, origin.message_family, origin.message_code) = ('outbound', 'PRODAT', 'Z03')
      AND origin.status IN ('sent', 'acknowledged') AND origin.message_sent_at IS NOT NULL
      AND origin.immutable_rendered_at IS NOT NULL AND origin.raw_payload IS NOT NULL
      AND origin.immutable_payload_hash = n.original_payload_hash
      AND (initial.direction, initial.message_family, initial.message_code) = ('inbound', 'PRODAT', 'Z04')
      AND (ending.direction, ending.message_family, ending.message_code) = ('inbound', 'PRODAT', 'Z05')
      AND initial_receipt.payload_hash = encode(sha256(convert_to(initial.raw_payload, 'UTF8')), 'hex')
      AND end_receipt.payload_hash = encode(sha256(convert_to(ending.raw_payload, 'UTF8')), 'hex')
      AND legal.status = 'ready' AND legal.source_received_at IS NOT DISTINCT FROM initial.message_received_at
      AND legal.payload_sha256 = initial_receipt.payload_hash
      AND legal.context->>'legalActorId' = n.legal_context->>'legalActorId'
      AND legal.context->>'actorRole' = 'electricity_supplier'
      -- The clock changes status and updated_at only, preserving this receipt.
      AND (
        SELECT count(*) = 1 AND bool_and(
          (saved->>'status') IN ('ending', 'ended') AND
          (saved - ARRAY['updated_at', 'status']) = (to_jsonb(p) - ARRAY['updated_at', 'status'])
        ) IS TRUE
        FROM jsonb_array_elements(end_receipt.resulting_states) saved
        WHERE saved->>'id' = p.id::text
      )
      -- This source owner covers only normal permission Z04 and Z05.
      AND initial_receipt.source_objects @> jsonb_build_array(n.source_object)
      AND NOT EXISTS (
        SELECT FROM jsonb_array_elements(initial_receipt.source_objects) o
        WHERE (o->>'reason' IN ('Z22', 'Z23')) IS NOT TRUE
      )
      AND jsonb_array_length(end_receipt.source_objects) > 0
      AND NOT EXISTS (
        SELECT FROM jsonb_array_elements(end_receipt.source_objects) o
        WHERE (o->>'reason' = 'Z22') IS NOT TRUE
           OR gridex_supply_rescission.has_end_selector_v1(ending, o)
      )
      AND NOT EXISTS (
        SELECT FROM gridex_bilateral_prodat.supply_effect_receipts r
        WHERE r.company_id = p.company_id AND r.source_message_id IN (initial.id, ending.id)
      )
      AND NOT EXISTS (
        SELECT FROM gridex_bilateral_prodat.closure_end_receipts r
        WHERE r.company_id = p.company_id AND r.source_message_id = ending.id
      )
      AND NOT EXISTS (
        SELECT FROM gridex_supply_rescission.end_receipts r
        WHERE r.company_id = p.company_id AND r.source_message_id = ending.id
      )
      AND (
        SELECT count(*) = 2 AND count(DISTINCT a.source_message_id) = 2 AND bool_and(
          a.source_payload_hash = CASE a.source_message_id
            WHEN initial.id THEN initial_receipt.payload_hash ELSE end_receipt.payload_hash
          END
          AND a.facts_text::jsonb->>'syntaxDecision' = 'accepted'
          AND a.facts_text::jsonb->>'applicationDecision' = 'accepted'
          AND a.facts_text::jsonb->>'functionalDecision' = 'accepted'
        ) IS TRUE
        FROM gridex_received_sources.validation_assessments a
        WHERE a.company_id = p.company_id
          AND a.environment = origin.environment
          AND a.source_message_id IN (initial.id, ending.id)
          AND NOT EXISTS (
            SELECT FROM gridex_received_sources.validation_assessments next_assessment
            WHERE next_assessment.previous_assessment_id = a.id
          )
      )
  ), source_ids AS MATERIALIZED (
    SELECT DISTINCT message_id
    FROM source_scope s
    CROSS JOIN LATERAL unnest(ARRAY[s.original_id, s.initial_id, s.ending_id]) message_id
  ), tombstoned_sources AS MATERIALIZED (
    SELECT DISTINCT t.message_id
    FROM source_ids s
    JOIN gridex_ediel_retention.blob_tombstones t ON t.message_id = s.message_id
    WHERE t.company_id = p_company_id
  ), available_scope AS MATERIALIZED (
    SELECT s.*
    FROM source_scope s
    WHERE NOT EXISTS (
      SELECT FROM tombstoned_sources t
      WHERE t.message_id IN (s.original_id, s.initial_id, s.ending_id)
    )
  )
  SELECT s.id, s.market_state_version, s.market_end_at
  FROM available_scope s
  WHERE gridex_ediel_transport.accepted_source_projection_current_v1(s.origin)->>'lane' = 'generic_journal'
$portal_supply_ends$;

REVOKE ALL ON FUNCTION public.gridex_portal_verified_supply_ends_v1(uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gridex_portal_verified_supply_ends_v1(uuid, uuid, uuid[])
  TO service_role;
