-- The operator requalifies one previously eligible observation after a recorded
-- move-out. The existing gate remains the only owner that writes source proof.
DO $migration$
BEGIN
  EXECUTE $ddl$
    CREATE FUNCTION public.gridex_requalify_planned_move_out_metering_value_v1(
      p_company_id uuid,
      p_actor_user_id uuid,
      p_environment text,
      p_normalized_value_id uuid
    ) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    SET "TimeZone" = 'UTC'
    AS $body$
    DECLARE
      v_meter_value_id uuid;
      v_source_message_id uuid;
      v_supply_period_id uuid;
      value public.normalized_metering_values%rowtype;
      period public.customer_supply_periods%rowtype;
      contract public.customer_contracts%rowtype;
      source_basis jsonb;
      close_evidence jsonb;
      retained_evidence jsonb;
    BEGIN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'planned_move_out_requalification_forbidden' USING ERRCODE='42501';
      END IF;
      IF p_environment IS NULL OR p_environment NOT IN ('test','production') OR p_normalized_value_id IS NULL THEN
        RAISE EXCEPTION 'planned_move_out_requalification_scope_required' USING ERRCODE='22023';
      END IF;

      -- Keep both rights current across the write, in the existing UTILTS
      -- execution actor's permission-graph order.
      PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
      PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_user_id);
      IF public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE
        OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.write') IS NOT TRUE
      THEN
        RAISE EXCEPTION 'planned_move_out_requalification_forbidden' USING ERRCODE='42501';
      END IF;

      -- Match the gate's market -> source -> meter -> normalized -> period order.
      PERFORM gridex_bilateral_prodat.lock_supply_v1();
      PERFORM gridex_regulated_supply.lock_graph_v1();
      SELECT normalized.source_metering_value_id,normalized.source_message_id,normalized.supply_period_id
        INTO v_meter_value_id,v_source_message_id,v_supply_period_id
      FROM public.normalized_metering_values normalized
      WHERE (normalized.company_id,normalized.id)=(p_company_id,p_normalized_value_id);
      IF v_meter_value_id IS NULL OR v_source_message_id IS NULL OR v_supply_period_id IS NULL THEN
        RAISE EXCEPTION 'planned_move_out_requalification_value_scope_mismatch' USING ERRCODE='23514';
      END IF;
      PERFORM gridex_billing_source.lock_values_v1(p_company_id,ARRAY[p_normalized_value_id],v_supply_period_id);

      SELECT normalized.* INTO value
      FROM public.normalized_metering_values normalized
      JOIN public.metering_values raw ON (raw.company_id,raw.id)=(normalized.company_id,normalized.source_metering_value_id)
      JOIN public.ediel_messages source ON (source.company_id,source.id)=(normalized.company_id,normalized.source_message_id)
      WHERE (normalized.company_id,normalized.id,normalized.source_metering_value_id,normalized.source_message_id,normalized.supply_period_id)
        =(p_company_id,p_normalized_value_id,v_meter_value_id,v_source_message_id,v_supply_period_id)
        AND normalized.direction='consumption' AND normalized.quantity_kwh>=0 AND normalized.revision_status='current'
        AND (normalized.billing_status,normalized.billing_gate_status,raw.billing_status,raw.billing_gate_status)
           =('billable','eligible','billable','eligible')
        AND (raw.customer_id,raw.metering_point_id)=(normalized.customer_id,normalized.metering_point_id)
        AND (source.environment,source.direction,source.message_family,source.message_code)=(p_environment,'inbound','UTILTS','E66');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'planned_move_out_requalification_value_scope_mismatch' USING ERRCODE='23514';
      END IF;

      SELECT * INTO period FROM public.customer_supply_periods
      WHERE (company_id,id,customer_id,metering_point_id)
        =(value.company_id,value.supply_period_id,value.customer_id,value.metering_point_id);
      SELECT * INTO contract FROM public.customer_contracts
      WHERE (company_id,id,customer_id,metering_point_id)
        =(period.company_id,period.contract_id,value.customer_id,value.metering_point_id) FOR SHARE;
      IF gridex_received_sources.planned_move_out_supply_window_v1(period,contract,value.period_start,value.period_end) IS NOT TRUE THEN
        RAISE EXCEPTION 'planned_move_out_requalification_close_scope_mismatch' USING ERRCODE='23514';
      END IF;

      close_evidence:=gridex_billing_source.planned_move_out_close_receipt_v1(period,contract);
      IF close_evidence->>'eventId' IS NULL OR close_evidence->>'recordedAt' IS NULL THEN
        RAISE EXCEPTION 'planned_move_out_requalification_close_scope_mismatch' USING ERRCODE='23514';
      END IF;

      source_basis:=gridex_billing_source.basis_v1(p_company_id,p_normalized_value_id);
      retained_evidence:=gridex_billing_source.read_planned_move_out_receipt_v1(value,source_basis);
      IF retained_evidence IS NOT DISTINCT FROM close_evidence THEN
        RETURN jsonb_build_object('normalizedValueId',value.id,'receipt',retained_evidence,'replayed',true);
      END IF;

      PERFORM public.gridex_set_metering_billing_gate(p_company_id,v_meter_value_id,p_normalized_value_id,
        jsonb_build_object(
          'source_message_id',value.source_message_id,'customer_id',value.customer_id,'supply_period_id',value.supply_period_id,
          'billing_status',value.billing_status,'billing_gate_status',value.billing_gate_status,
          'billing_gate_reasons',coalesce(value.billing_gate_reasons,'[]'::jsonb),
          'billing_gate_snapshot',coalesce(value.billing_gate_snapshot,'{}'::jsonb)
        ));
      SELECT * INTO STRICT value FROM public.normalized_metering_values
      WHERE (company_id,id)=(p_company_id,p_normalized_value_id);
      retained_evidence:=gridex_billing_source.read_planned_move_out_receipt_v1(value,source_basis);
      IF retained_evidence IS DISTINCT FROM close_evidence THEN
        RAISE EXCEPTION 'planned_move_out_requalification_receipt_required' USING ERRCODE='23514';
      END IF;
      INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,new_values,metadata)
      VALUES(
        p_company_id,p_actor_user_id,'normalized_metering_value',value.id::text,'planned_move_out_metering_requalified',
        jsonb_build_object('closeEventId',close_evidence->>'eventId','supplyPeriodId',value.supply_period_id),
        jsonb_build_object('environment',p_environment)
      );
      RETURN jsonb_build_object('normalizedValueId',value.id,'receipt',retained_evidence,'replayed',false);
    END
    $body$;
  $ddl$;

  REVOKE ALL ON FUNCTION public.gridex_requalify_planned_move_out_metering_value_v1(uuid,uuid,text,uuid)
    FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.gridex_requalify_planned_move_out_metering_value_v1(uuid,uuid,text,uuid)
    TO service_role;
END
$migration$;
