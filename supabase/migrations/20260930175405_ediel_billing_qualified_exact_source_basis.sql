BEGIN;
CREATE SCHEMA gridex_billing_source;
REVOKE ALL ON SCHEMA gridex_billing_source FROM PUBLIC,anon,authenticated,service_role;

-- U p97: quality belongs to the preceding own SG11/QTY; absence means
-- exact/approved. No QTY qualifier or sibling's quality is a quality decision.
CREATE FUNCTION gridex_billing_source.observation_v1(tokens jsonb,tx text,ordinal integer,decimal_mark text DEFAULT '.') RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE start_at integer;stop_at integer;first_seq integer;sequence_at integer;quantity jsonb;next_qty integer;q text;count_q integer;product text;app text;code text;register text;
 unit text;amount numeric;period text;resolution text;format text;offset_raw text;offset_mins integer;energy_index integer;duration interval;local_start timestamp;local_end timestamp;quantity_kwh numeric;period_start timestamp;period_end timestamp;
BEGIN
 SELECT (t->>'index')::integer INTO STRICT start_at FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE' AND t#>>'{elements,2,0}'=tx;
 SELECT min((t->>'index')::integer) INTO stop_at FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>start_at AND t->>'tag' IN ('IDE','UNT');
 SELECT min((t->>'index')::integer) INTO first_seq FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at AND t->>'tag'='SEQ';
 SELECT t INTO quantity FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='QTY' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at ORDER BY (t->>'index')::integer OFFSET ordinal LIMIT 1;
 IF quantity IS NULL OR first_seq IS NULL THEN RETURN NULL; END IF;
 SELECT coalesce(min((t->>'index')::integer),stop_at) INTO next_qty FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>(quantity->>'index')::integer AND (t->>'index')::integer<stop_at AND t->>'tag' IN ('QTY','SEQ');
 SELECT count(*),min(t#>>'{elements,2,0}') INTO count_q,q FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='8' AND (t->>'index')::integer>(quantity->>'index')::integer AND (t->>'index')::integer<next_qty;
 IF count_q>1 OR (count_q=1 AND (q IS NULL OR q NOT IN ('21','46','56','113','125'))) THEN RETURN NULL; END IF;
 SELECT t#>>'{elements,3,0}' INTO product FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<first_seq;
 SELECT max((t->>'index')::integer) INTO sequence_at FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='SEQ' AND (t->>'index')::integer< (quantity->>'index')::integer AND (t->>'index')::integer>=first_seq;
 SELECT t#>>'{elements,1,1}' INTO register FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='AES' AND (t->>'index')::integer>sequence_at AND (t->>'index')::integer<(quantity->>'index')::integer;
 SELECT t#>>'{elements,3,0}' INTO unit FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='MEA' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<first_seq;
 amount:=gridex_utilts_binding.canonical_decimal_v2(quantity#>>'{elements,1,1}',decimal_mark)::numeric;
 quantity_kwh:=amount*CASE unit WHEN 'KWH' THEN 1 WHEN 'MWH' THEN 1000 WHEN 'GWH' THEN 1000000 END;
 SELECT t#>>'{elements,1,1}' INTO period FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='324' AND t#>>'{elements,1,2}'='719' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<first_seq;
 SELECT t#>>'{elements,1,1}',t#>>'{elements,1,2}' INTO resolution,format FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='354' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<first_seq;
 SELECT t#>>'{elements,1,1}' INTO STRICT offset_raw FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='735' AND t#>>'{elements,1,2}'='406' AND (t->>'index')::integer<start_at;
 IF period !~ '^[0-9]{24}$' OR offset_raw !~ '^[+-][0-9]{4}$' OR resolution !~ '^[0-9]+$' THEN RETURN NULL; END IF;
 IF substring(offset_raw,2,2)::integer>23 OR substring(offset_raw,4,2)::integer>59 THEN RETURN NULL; END IF;
 period_start:=to_timestamp(left(period,12),'YYYYMMDDHH24MI')::timestamp;period_end:=to_timestamp(right(period,12),'YYYYMMDDHH24MI')::timestamp;
 IF to_char(period_start,'YYYYMMDDHH24MI') IS DISTINCT FROM left(period,12) OR to_char(period_end,'YYYYMMDDHH24MI') IS DISTINCT FROM right(period,12) OR period_end<=period_start THEN RETURN NULL; END IF;
 offset_mins:=(substring(offset_raw,2,2)::integer*60+substring(offset_raw,4,2)::integer)*CASE left(offset_raw,1) WHEN '-' THEN -1 ELSE 1 END;
 duration:=CASE format WHEN '806' THEN make_interval(mins=>resolution::integer) WHEN '805' THEN make_interval(hours=>resolution::integer) WHEN '802' THEN make_interval(months=>resolution::integer) WHEN '801' THEN make_interval(years=>resolution::integer) END;
 IF duration IS NULL OR duration<=interval '0' THEN RETURN NULL; END IF;
 SELECT count(*) INTO energy_index FROM jsonb_array_elements(tokens) prior_qty WHERE prior_qty->>'tag'='QTY' AND prior_qty#>>'{elements,1,0}'='136'
  AND (prior_qty->>'index')::integer>start_at AND (prior_qty->>'index')::integer<(quantity->>'index')::integer
  AND (SELECT ref#>>'{elements,1,1}' FROM jsonb_array_elements(tokens) ref WHERE ref->>'tag'='RFF' AND ref#>>'{elements,1,0}'='AES'
    AND (ref->>'index')::integer>(SELECT max((seq->>'index')::integer) FROM jsonb_array_elements(tokens) seq WHERE seq->>'tag'='SEQ' AND (seq->>'index')::integer<(prior_qty->>'index')::integer AND (seq->>'index')::integer>=first_seq)
    AND (ref->>'index')::integer<(prior_qty->>'index')::integer) IS NOT DISTINCT FROM register;
 local_start:=period_start+duration*energy_index;
 local_end:=local_start+duration;
 IF local_end>period_end THEN RETURN NULL; END IF;
 SELECT t#>>'{elements,7,0}' INTO STRICT app FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNB';
 SELECT t#>>'{elements,1,0}' INTO STRICT code FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM';
 RETURN jsonb_build_object('quantityType',quantity#>>'{elements,1,0}','quantityKwh',gridex_utilts_binding.canonical_decimal_v2(quantity_kwh::text),'quality',q,'qualityEstablished',true,'productCode',nullif(product,''),'registerCode',nullif(register,''),'applicationReference',app,'messageCode',code,
  'periodStart',(local_start-make_interval(mins=>offset_mins)) AT TIME ZONE 'UTC','periodEnd',(local_end-make_interval(mins=>offset_mins)) AT TIME ZONE 'UTC');
EXCEPTION WHEN no_data_found OR too_many_rows OR invalid_parameter_value OR datetime_field_overflow THEN RETURN NULL;
END $$;

-- Discovery never grants authority. Lock every discovered physical source first,
-- then meter values, normalized values and supply period. Re-read the discovery
-- under those locks; a concurrent reassignment/revision is retried, never followed
-- by acquiring a new source lock after the consumer rows.
CREATE FUNCTION gridex_billing_source.lock_values_v1(p_company uuid,p_values uuid[],p_period uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE discovery jsonb;actual jsonb;period_before jsonb;period_after jsonb;sources uuid[];meters uuid[];
BEGIN
 SELECT jsonb_agg(jsonb_build_object('id',n.id,'source',n.source_message_id,'meter',n.source_metering_value_id) ORDER BY n.id),array_agg(DISTINCT n.source_message_id),array_agg(DISTINCT n.source_metering_value_id)
 INTO discovery,sources,meters FROM public.normalized_metering_values n WHERE n.company_id=p_company AND n.id=ANY(p_values);
 IF jsonb_array_length(coalesce(discovery,'[]'))<>cardinality(p_values) THEN RAISE EXCEPTION 'billing_source_value_missing' USING ERRCODE='P0002'; END IF;
 IF p_period IS NOT NULL THEN
  SELECT to_jsonb(p) INTO period_before FROM public.customer_supply_periods p WHERE p.company_id=p_company AND p.id=p_period;
  sources:=sources||ARRAY(SELECT t.source_message_id FROM gridex_received_sources.supply_source_transitions t WHERE t.company_id=p_company AND
   (t.source_message_id=(period_before->>'source_message_id')::uuid OR EXISTS(SELECT FROM jsonb_array_elements(t.resulting_states) own WHERE own->>'id'=p_period::text AND (own->>'market_state_version')::bigint=(period_before->>'market_state_version')::bigint)));
 END IF;
 PERFORM s.id FROM public.ediel_messages s WHERE s.company_id=p_company AND s.id=ANY(sources) ORDER BY s.id FOR UPDATE;
 PERFORM m.id FROM public.metering_values m WHERE m.company_id=p_company AND m.id=ANY(meters) ORDER BY m.id FOR SHARE;
 PERFORM n.id FROM public.normalized_metering_values n WHERE n.company_id=p_company AND n.id=ANY(p_values) ORDER BY n.id FOR UPDATE;
 SELECT jsonb_agg(jsonb_build_object('id',n.id,'source',n.source_message_id,'meter',n.source_metering_value_id) ORDER BY n.id) INTO actual FROM public.normalized_metering_values n WHERE n.company_id=p_company AND n.id=ANY(p_values);
 IF actual IS DISTINCT FROM discovery THEN RAISE EXCEPTION 'billing_source_discovery_changed' USING ERRCODE='40001'; END IF;
 IF p_period IS NOT NULL THEN
  SELECT to_jsonb(p) INTO period_after FROM public.customer_supply_periods p WHERE p.company_id=p_company AND p.id=p_period FOR SHARE;
  IF period_after IS DISTINCT FROM period_before THEN RAISE EXCEPTION 'billing_supply_discovery_changed' USING ERRCODE='40001'; END IF;
 END IF;
END $$;

CREATE FUNCTION gridex_billing_source.basis_v1(p_company uuid,p_value uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,extensions AS $$
DECLARE n public.normalized_metering_values%rowtype;m public.metering_values%rowtype;s public.ediel_messages%rowtype;
 c jsonb;o jsonb;physical jsonb;basis jsonb;rule_basis jsonb;ordinal integer;source_ordinal integer;qualified boolean:=false;why text:='billing_source_binding_unavailable';
BEGIN
 PERFORM gridex_billing_source.lock_values_v1(p_company,ARRAY[p_value]);
 SELECT * INTO n FROM public.normalized_metering_values WHERE company_id=p_company AND id=p_value;
 IF n.id IS NULL THEN RAISE EXCEPTION 'billing_source_value_missing' USING ERRCODE='P0002'; END IF;
 basis:=jsonb_build_object('version',1,'qualified',false,'reason',why,'normalizedValueId',n.id,'sourceMessageId',n.source_message_id,
 'quantityKwh',gridex_utilts_binding.canonical_decimal_v2(n.quantity_kwh::text),'quantityType',null,'quality',null,'qualityEstablished',false,'productCode',n.product_code,'contractHash',null,'sourcePayloadHash',null,'observationOrdinal',null);
 SELECT * INTO m FROM public.metering_values WHERE id=n.source_metering_value_id AND company_id=p_company FOR SHARE;
 SELECT * INTO s FROM public.ediel_messages WHERE id=n.source_message_id AND company_id=p_company FOR SHARE;
 IF m.id IS NULL OR s.id IS NULL OR s.direction IS DISTINCT FROM 'inbound' OR s.message_family IS DISTINCT FROM 'UTILTS' OR NOT coalesce(s.message_code IN ('E30','E66'),false)
  OR n.source_transaction_reference IS NULL OR n.revision_status IS DISTINCT FROM 'current' OR m.is_current IS DISTINCT FROM true OR m.revision_status IS DISTINCT FROM 'current'
  OR n.quantity_kwh IS DISTINCT FROM m.value_kwh OR n.period_start IS DISTINCT FROM m.period_start OR n.period_end IS DISTINCT FROM m.period_end
  OR n.unit IS DISTINCT FROM 'kWh' OR n.direction IS DISTINCT FROM m.direction OR n.quality_status IS DISTINCT FROM m.quality_code
  OR n.source_message_id IS DISTINCT FROM m.source_ediel_message_id OR n.source_transaction_reference IS DISTINCT FROM m.source_transaction_reference
  OR n.metering_point_id IS DISTINCT FROM m.metering_point_id OR n.customer_id IS DISTINCT FROM m.customer_id
  OR n.raw_payload IS DISTINCT FROM m.raw_payload THEN RETURN basis; END IF;
 c:=gridex_utilts_binding.stored_contract_v1(p_company,s.id,n.source_transaction_reference);
 BEGIN rule_basis:=gridex_ediel_source_rules.require_v1(p_company,s.id);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM IN ('ediel_historical_rule_pack_basis_unavailable','ediel_source_rule_pack_basis_required') THEN RETURN basis||jsonb_build_object('reason',SQLERRM); END IF;
  RAISE;
 END;
 IF n.raw_payload->'consumptionContract' IS DISTINCT FROM c OR n.raw_payload->>'edielMessageId' IS DISTINCT FROM s.id::text
  OR c#>>'{metering,capability}' IS DISTINCT FROM 'write' OR c#>>'{metering,meteringPointId}' IS DISTINCT FROM n.metering_point_id::text
  OR c#>>'{metering,customerId}' IS DISTINCT FROM n.customer_id::text THEN RETURN basis; END IF;
 source_ordinal:=(n.raw_payload->>'sourceOrdinal')::integer;
 SELECT value,(value->>'ordinal')::integer INTO STRICT o,ordinal FROM jsonb_array_elements(c->'observations') WHERE (value->>'sourceOrdinal')::integer=source_ordinal;
 physical:=gridex_billing_source.observation_v1(gridex_utilts_binding.wire_tokens_v1(s.raw_payload),n.source_transaction_reference,source_ordinal,CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END);
 IF physical IS NULL THEN RETURN basis; END IF;
 -- This is a new billing projection, not a rewrite of the immutable consumer
 -- contract or its historical ACK. The authentic raw/hash/own ordinal and
 -- original rule basis independently establish previously lossy diagnostics.
 basis:=basis||jsonb_build_object('projectionVersion','ediel-billing-source-v1','quantityType',physical->'quantityType','quality',physical->'quality','qualityEstablished',true,'productCode',physical->'productCode','registerCode',physical->'registerCode','sourceRulePackBasis',rule_basis,
  'retainedProjection',jsonb_build_object('quality',n.quality_status,'productCode',n.product_code,'registerCode',n.register_code),
  'contractHash',encode(digest(convert_to(c::text,'UTF8'),'sha256'),'hex'),'sourcePayloadHash',encode(digest(convert_to(s.raw_payload,'UTF8'),'sha256'),'hex'),'observationOrdinal',ordinal);
 IF o->>'unit' IS DISTINCT FROM 'kWh' OR (o->>'quantity')::numeric IS DISTINCT FROM n.quantity_kwh
  OR (o->>'periodStart')::timestamptz IS DISTINCT FROM n.period_start OR (o->>'periodEnd')::timestamptz IS DISTINCT FROM n.period_end
  OR o->>'direction' IS DISTINCT FROM n.direction OR o->>'quality' IS DISTINCT FROM n.quality_status
  OR o->>'productCode' IS DISTINCT FROM n.product_code OR o->>'registerCode' IS DISTINCT FROM n.register_code
  OR (physical->>'quantityKwh')::numeric IS DISTINCT FROM n.quantity_kwh OR (physical->>'periodStart')::timestamptz IS DISTINCT FROM n.period_start OR (physical->>'periodEnd')::timestamptz IS DISTINCT FROM n.period_end
  OR physical->>'messageCode' IS DISTINCT FROM s.message_code OR physical->>'quantityType' IS DISTINCT FROM '136'
  OR NOT coalesce(physical->>'applicationReference' IN ('23-DDQ-E66-S','23-DDQ-E66-T'),false) THEN why:='billing_source_semantics_mismatch';
 ELSIF s.message_code='E66' AND physical->>'productCode' IS DISTINCT FROM '8716867000030' THEN why:='billing_product_not_individual_active_energy';
 ELSE qualified:=true;why:=NULL; END IF;
 RETURN basis||jsonb_build_object('qualified',qualified,'reason',why);
EXCEPTION WHEN SQLSTATE 'P0U01' OR no_data_found OR too_many_rows OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN basis;
END $$;

CREATE FUNCTION public.gridex_read_billing_source_values_v1(p_company_id uuid,p_value_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n public.normalized_metering_values%rowtype;s public.ediel_messages%rowtype;b jsonb;result jsonb:='[]';
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_value_ids IS NULL OR cardinality(p_value_ids)>1000 OR array_position(p_value_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'billing_source_scope_required' USING ERRCODE='22023'; END IF;
 PERFORM gridex_billing_source.lock_values_v1(p_company_id,p_value_ids);
 FOR n IN SELECT * FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=ANY(p_value_ids) ORDER BY id LOOP
  b:=gridex_billing_source.basis_v1(p_company_id,n.id);
  SELECT * INTO s FROM public.ediel_messages WHERE id=n.source_message_id AND company_id=p_company_id;
  result:=result||jsonb_build_array(to_jsonb(n)||jsonb_build_object('quantity_kwh',b->'quantityKwh','product_code',CASE WHEN b->'qualified'='true'::jsonb THEN b->'productCode' ELSE to_jsonb(n.product_code) END,'register_code',CASE WHEN b->'qualified'='true'::jsonb THEN b->'registerCode' ELSE to_jsonb(n.register_code) END,'quality_status',CASE WHEN b->'qualified'='true'::jsonb THEN b->'quality' ELSE to_jsonb(n.quality_status) END,
   'billing_source_basis',b,'billing_source_message',CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'company_id',s.company_id,'message_family',s.message_family,'message_code',s.message_code,'status',s.status) END));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.gridex_read_billing_source_values_v1(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_billing_source_values_v1(uuid,uuid[]) TO service_role;

ALTER FUNCTION public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb) RENAME TO gridex_set_metering_billing_gate_before_source_v2;
ALTER FUNCTION public.gridex_set_metering_billing_gate_before_source_v2(uuid,uuid,uuid,jsonb) SET SCHEMA gridex_billing_source;
CREATE FUNCTION public.gridex_set_metering_billing_gate(p_company_id uuid,p_metering_value_id uuid,p_normalized_value_id uuid,p_gate jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;legal_basis jsonb;n public.normalized_metering_values%rowtype;sp public.customer_supply_periods%rowtype;ct public.customer_contracts%rowtype;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_metering_value_id IS NULL OR p_normalized_value_id IS NULL OR p_gate IS NULL THEN RAISE EXCEPTION 'billing_gate_scope_required' USING ERRCODE='22023'; END IF;
 PERFORM gridex_billing_source.lock_values_v1(p_company_id,ARRAY[p_normalized_value_id],nullif(p_gate->>'supply_period_id','')::uuid);
 SELECT * INTO n FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=p_normalized_value_id AND source_metering_value_id=p_metering_value_id;
 IF n.id IS NULL THEN RAISE EXCEPTION 'billing_gate_value_scope_mismatch'; END IF;
 IF p_gate->>'billing_status'='billable' OR p_gate->>'billing_gate_status'='eligible' THEN
  b:=gridex_billing_source.basis_v1(p_company_id,n.id);
  IF b->'qualified' IS DISTINCT FROM 'true'::jsonb OR b->'qualityEstablished' IS DISTINCT FROM 'true'::jsonb OR b->'quality' IS DISTINCT FROM 'null'::jsonb
   OR p_gate->>'source_message_id' IS DISTINCT FROM n.source_message_id::text THEN RAISE EXCEPTION 'billing_gate_qualified_final_source_required' USING ERRCODE='23514'; END IF;
  SELECT * INTO sp FROM public.customer_supply_periods WHERE id=(p_gate->>'supply_period_id')::uuid AND company_id=p_company_id FOR SHARE;
  SELECT * INTO ct FROM public.customer_contracts WHERE id=sp.contract_id AND company_id=p_company_id FOR SHARE;
  IF sp.id IS NULL OR ct.id IS NULL OR NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner'),false) OR NOT coalesce(ct.status IN ('signed','active'),false)
   OR sp.customer_id IS DISTINCT FROM n.customer_id OR sp.metering_point_id IS DISTINCT FROM n.metering_point_id OR ct.customer_id IS DISTINCT FROM n.customer_id OR ct.metering_point_id IS DISTINCT FROM n.metering_point_id
   OR sp.start_date IS NULL OR (sp.start_date::timestamp AT TIME ZONE 'Europe/Stockholm')>n.period_start
   OR (sp.end_date IS NOT NULL AND ((sp.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm')<n.period_end)
   OR nullif(coalesce(to_jsonb(ct)->>'starts_at',to_jsonb(ct)->>'start_date'),'') IS NULL
   OR (left(coalesce(to_jsonb(ct)->>'starts_at',to_jsonb(ct)->>'start_date'),10)::date::timestamp AT TIME ZONE 'Europe/Stockholm')>n.period_start
   OR (nullif(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),'') IS NOT NULL AND ((left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm')<n.period_end)
   THEN RAISE EXCEPTION 'billing_gate_supply_contract_scope_mismatch' USING ERRCODE='23514'; END IF;
  legal_basis:=gridex_received_sources.billing_supply_basis_v1(p_company_id,sp.id,n.period_start,n.period_end);
  IF legal_basis IS NULL OR legal_basis->'qualified' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'billing_gate_qualified_supply_source_required' USING ERRCODE='23514'; END IF;
  p_gate:=p_gate||jsonb_build_object('billing_gate_snapshot',coalesce(p_gate->'billing_gate_snapshot','{}')||jsonb_build_object('source_basis',b,'supply_source_basis',legal_basis));
 END IF;
 RETURN gridex_billing_source.gridex_set_metering_billing_gate_before_source_v2(p_company_id,p_metering_value_id,p_normalized_value_id,p_gate);
END $$;
REVOKE ALL ON FUNCTION public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb) TO service_role;

CREATE TABLE gridex_billing_source.underlay_bindings(
 underlay_id uuid PRIMARY KEY REFERENCES public.billing_underlays(id),company_id uuid NOT NULL,
 source_basis jsonb NOT NULL,source_basis_hash text NOT NULL,exact_total_kwh numeric NOT NULL,finalized_at timestamptz NOT NULL DEFAULT clock_timestamp(),actor_user_id uuid
);
CREATE TABLE gridex_billing_source.correction_journal(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,underlay_id uuid NOT NULL REFERENCES gridex_billing_source.underlay_bindings(underlay_id),
 previous_normalized_value_id uuid NOT NULL REFERENCES public.normalized_metering_values(id),new_normalized_value_id uuid NOT NULL REFERENCES public.normalized_metering_values(id),
 old_source_basis_hash text NOT NULL,new_source_message_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(underlay_id,new_normalized_value_id)
);
ALTER TABLE gridex_billing_source.underlay_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_billing_source.underlay_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_billing_source.correction_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_billing_source.correction_journal FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA gridex_billing_source FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_billing_source.underlay_bindings FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_billing_source.underlay_bindings FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_billing_source.correction_journal FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_billing_source.correction_journal FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_billing_source.capture_correction_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO gridex_billing_source.correction_journal(company_id,underlay_id,previous_normalized_value_id,new_normalized_value_id,old_source_basis_hash,new_source_message_id)
 SELECT new.company_id,b.underlay_id,previous.id,new.id,b.source_basis_hash,new.source_message_id FROM public.normalized_metering_values previous
 JOIN public.billing_underlay_items i ON i.source_normalized_metering_value_id=previous.id AND i.company_id=new.company_id
 JOIN gridex_billing_source.underlay_bindings b ON b.underlay_id=i.billing_underlay_id AND b.company_id=new.company_id
 WHERE previous.company_id=new.company_id AND (previous.id=new.previous_value_id OR previous.source_metering_value_id=new.previous_value_id) ON CONFLICT DO NOTHING;
 RETURN new;
END $$;
CREATE TRIGGER billing_source_correction_journal AFTER INSERT ON public.normalized_metering_values FOR EACH ROW EXECUTE FUNCTION gridex_billing_source.capture_correction_v1();

CREATE FUNCTION gridex_billing_source.protect_underlay_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT FROM gridex_billing_source.underlay_bindings WHERE underlay_id=old.id) AND (tg_op='DELETE' OR
  ROW(new.company_id,new.customer_id,new.metering_point_id,new.supply_period_id,new.contract_id,new.pricing_snapshot_id,new.contract_price_snapshot_id,new.total_kwh,new.billing_period_start,new.billing_period_end,new.payload,new.pricing_snapshot,new.energy_direction,new.settlement_type)
  IS DISTINCT FROM ROW(old.company_id,old.customer_id,old.metering_point_id,old.supply_period_id,old.contract_id,old.pricing_snapshot_id,old.contract_price_snapshot_id,old.total_kwh,old.billing_period_start,old.billing_period_end,old.payload,old.pricing_snapshot,old.energy_direction,old.settlement_type)) THEN RAISE EXCEPTION 'billing_source_finalized_underlay_immutable' USING ERRCODE='55000'; END IF;
 RETURN CASE WHEN tg_op='DELETE' THEN old ELSE new END;
END $$;
CREATE TRIGGER billing_source_finalized_immutable BEFORE UPDATE OR DELETE ON public.billing_underlays FOR EACH ROW EXECUTE FUNCTION gridex_billing_source.protect_underlay_v1();
CREATE FUNCTION gridex_billing_source.protect_items_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT FROM gridex_billing_source.underlay_bindings WHERE underlay_id=CASE WHEN tg_op='INSERT' THEN new.billing_underlay_id ELSE old.billing_underlay_id END)
  OR (tg_op='UPDATE' AND EXISTS(SELECT FROM gridex_billing_source.underlay_bindings WHERE underlay_id=new.billing_underlay_id)) THEN RAISE EXCEPTION 'billing_source_finalized_items_immutable' USING ERRCODE='55000'; END IF;
 RETURN CASE WHEN tg_op='DELETE' THEN old ELSE new END;
END $$;
CREATE TRIGGER billing_source_finalized_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.billing_underlay_items FOR EACH ROW EXECUTE FUNCTION gridex_billing_source.protect_items_v1();

ALTER FUNCTION public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid) RENAME TO gridex_store_billing_underlay_before_source_v2;
ALTER FUNCTION public.gridex_store_billing_underlay_before_source_v2(uuid,jsonb,jsonb,uuid) SET SCHEMA gridex_billing_source;
CREATE FUNCTION public.gridex_store_billing_underlay(p_company_id uuid,p_underlay jsonb,p_items jsonb,p_actor_user_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE item jsonb;basis jsonb;legal_basis jsonb;rows_basis jsonb:='[]';source_basis jsonb;basis_hash text;total numeric:=0;u public.billing_underlays%rowtype;
 n public.normalized_metering_values%rowtype;sp public.customer_supply_periods%rowtype;ct public.customer_contracts%rowtype;price public.contract_price_snapshots%rowtype;pv public.price_plan_versions%rowtype;
 prior gridex_billing_source.underlay_bindings%rowtype;stored_id uuid;start_at timestamptz;end_at timestamptz;ready boolean;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_underlay IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'billing_underlay_scope_required' USING ERRCODE='22023'; END IF;
 start_at:=(p_underlay->>'billing_period_start')::timestamptz;end_at:=(p_underlay->>'billing_period_end')::timestamptz;
 IF start_at IS NULL OR end_at IS NULL OR end_at<=start_at THEN RAISE EXCEPTION 'billing_underlay_exact_period_required' USING ERRCODE='22023'; END IF;
 ready:=p_underlay->>'status'='validated' OR p_underlay->>'readiness_status'='ready';
 PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||':billing-underlay-batch',0));
 SELECT * INTO u FROM public.billing_underlays WHERE company_id=p_company_id AND customer_id=(p_underlay->>'customer_id')::uuid AND metering_point_id=(p_underlay->>'metering_point_id')::uuid
  AND underlay_year=(p_underlay->>'underlay_year')::integer AND underlay_month=(p_underlay->>'underlay_month')::integer
  AND billing_period_start=(start_at AT TIME ZONE 'Europe/Stockholm')::date AND billing_period_end=(end_at AT TIME ZONE 'Europe/Stockholm')::date AND energy_direction=p_underlay->>'energy_direction';
 SELECT * INTO prior FROM gridex_billing_source.underlay_bindings WHERE underlay_id=u.id;
 IF NOT ready THEN
  PERFORM 1 FROM public.billing_underlays WHERE id=u.id FOR UPDATE;
  IF prior.underlay_id IS NOT NULL THEN RAISE EXCEPTION 'billing_source_finalized_underlay_requires_correction' USING ERRCODE='55000'; END IF;
  RETURN gridex_billing_source.gridex_store_billing_underlay_before_source_v2(p_company_id,p_underlay,p_items,p_actor_user_id);
 END IF;
 IF jsonb_array_length(p_items)=0 OR (SELECT count(DISTINCT value->>'source_normalized_metering_value_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'billing_underlay_unique_sources_required'; END IF;
 PERFORM gridex_billing_source.lock_values_v1(p_company_id,ARRAY(SELECT (value->>'source_normalized_metering_value_id')::uuid FROM jsonb_array_elements(p_items)),(p_underlay->>'supply_period_id')::uuid);
 SELECT * INTO sp FROM public.customer_supply_periods WHERE id=(p_underlay->>'supply_period_id')::uuid AND company_id=p_company_id FOR SHARE;
 SELECT * INTO ct FROM public.customer_contracts WHERE id=(p_underlay->>'contract_id')::uuid AND company_id=p_company_id FOR SHARE;
 SELECT * INTO price FROM public.contract_price_snapshots WHERE id=(p_underlay->>'contract_price_snapshot_id')::uuid AND company_id=p_company_id FOR SHARE;
 SELECT * INTO pv FROM public.price_plan_versions WHERE id=price.price_plan_version_id AND company_id=p_company_id FOR SHARE;
 IF sp.id IS NULL OR ct.id IS NULL OR price.id IS NULL OR pv.id IS NULL OR pv.locked_at IS NULL OR NOT coalesce(pv.content_sha256 ~ '^[a-f0-9]{64}$',false) OR NOT coalesce(pv.status IN ('active','approved','published'),false)
  OR sp.contract_id IS DISTINCT FROM ct.id OR sp.customer_id IS DISTINCT FROM ct.customer_id OR sp.metering_point_id IS DISTINCT FROM ct.metering_point_id
  OR NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner'),false) OR NOT coalesce(ct.status IN ('signed','active'),false) OR price.contract_id IS DISTINCT FROM ct.id
  OR sp.customer_id::text IS DISTINCT FROM p_underlay->>'customer_id' OR sp.metering_point_id::text IS DISTINCT FROM p_underlay->>'metering_point_id'
  OR price.id::text IS DISTINCT FROM p_underlay->>'pricing_snapshot_id' OR price.price_plan_version_id::text IS DISTINCT FROM p_underlay->>'price_plan_version_id'
  OR price.snapshot_json IS DISTINCT FROM p_underlay->'pricing_snapshot' OR price.valid_from IS NULL OR (price.valid_from::timestamp AT TIME ZONE 'Europe/Stockholm')>start_at
  OR (price.valid_to IS NOT NULL AND ((price.valid_to+1)::timestamp AT TIME ZONE 'Europe/Stockholm')<end_at)
  OR sp.start_date IS NULL OR (sp.start_date::timestamp AT TIME ZONE 'Europe/Stockholm')>start_at OR (sp.end_date IS NOT NULL AND ((sp.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm')<end_at)
  OR nullif(coalesce(to_jsonb(ct)->>'starts_at',to_jsonb(ct)->>'start_date'),'') IS NULL
  OR (left(coalesce(to_jsonb(ct)->>'starts_at',to_jsonb(ct)->>'start_date'),10)::date::timestamp AT TIME ZONE 'Europe/Stockholm')>start_at
  OR (nullif(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),'') IS NOT NULL AND ((left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm')<end_at)
 THEN RAISE EXCEPTION 'billing_underlay_supply_contract_price_basis_required' USING ERRCODE='23514'; END IF;
 legal_basis:=gridex_received_sources.billing_supply_basis_v1(p_company_id,sp.id,start_at,end_at);
 IF legal_basis IS NULL OR legal_basis->'qualified' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'billing_underlay_qualified_supply_source_required' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'source_normalized_metering_value_id' LOOP
  SELECT * INTO n FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=(item->>'source_normalized_metering_value_id')::uuid FOR SHARE;
  basis:=gridex_billing_source.basis_v1(p_company_id,n.id);
  IF basis->'qualified' IS DISTINCT FROM 'true'::jsonb OR basis->'quality' IS DISTINCT FROM 'null'::jsonb OR basis->'qualityEstablished' IS DISTINCT FROM 'true'::jsonb
   OR n.billing_gate_status IS DISTINCT FROM 'eligible' OR n.billing_status IS DISTINCT FROM 'billable' OR n.supply_period_id IS DISTINCT FROM sp.id
   OR n.customer_id IS DISTINCT FROM sp.customer_id OR n.metering_point_id IS DISTINCT FROM sp.metering_point_id OR n.period_start<start_at OR n.period_end>end_at
   OR (item->>'quantity_kwh')::numeric IS DISTINCT FROM abs(n.quantity_kwh) OR (item->>'quantity')::numeric IS DISTINCT FROM abs(n.quantity_kwh)
   OR item->>'unit' IS DISTINCT FROM 'kWh' OR item->>'product_code' IS DISTINCT FROM basis->>'productCode' OR item->>'register_code' IS DISTINCT FROM basis->>'registerCode'
   OR p_underlay->>'energy_direction' IS DISTINCT FROM (CASE WHEN n.direction='production' THEN 'production' WHEN n.quantity_kwh<0 THEN 'consumption_correction' ELSE 'consumption' END)
   OR (item->>'period_start')::timestamptz IS DISTINCT FROM n.period_start OR (item->>'period_end')::timestamptz IS DISTINCT FROM n.period_end
  THEN RAISE EXCEPTION 'billing_underlay_qualified_source_mismatch' USING ERRCODE='23514'; END IF;
  total:=total+abs(n.quantity_kwh);rows_basis:=rows_basis||jsonb_build_array(basis||jsonb_build_object('revisionNumber',n.revision_number,'supplyPeriodId',sp.id));
 END LOOP;
 IF total IS DISTINCT FROM (p_underlay->>'total_kwh')::numeric THEN RAISE EXCEPTION 'billing_underlay_exact_total_mismatch'; END IF;
 source_basis:=jsonb_build_object('values',rows_basis,'supply',legal_basis,'contractId',ct.id,'contractStatus',ct.status,'price',to_jsonb(price),'priceVersionHash',pv.content_sha256,'energyDirection',p_underlay->>'energy_direction','start',start_at,'end',end_at);
 basis_hash:=encode(digest(convert_to(source_basis::text,'UTF8'),'sha256'),'hex');
 PERFORM 1 FROM public.billing_underlays WHERE id=u.id FOR UPDATE;
 IF prior.underlay_id IS NOT NULL THEN
  IF prior.source_basis_hash IS DISTINCT FROM basis_hash OR prior.exact_total_kwh IS DISTINCT FROM total THEN RAISE EXCEPTION 'billing_source_finalized_underlay_requires_correction' USING ERRCODE='55000'; END IF;
  RETURN prior.underlay_id;
 END IF;
 stored_id:=gridex_billing_source.gridex_store_billing_underlay_before_source_v2(p_company_id,p_underlay,p_items,p_actor_user_id);
 INSERT INTO gridex_billing_source.underlay_bindings(underlay_id,company_id,source_basis,source_basis_hash,exact_total_kwh,actor_user_id) VALUES(stored_id,p_company_id,source_basis,basis_hash,total,p_actor_user_id);
 RETURN stored_id;
END $$;
REVOKE ALL ON FUNCTION public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid) TO service_role;

CREATE FUNCTION public.gridex_read_billing_underlay_source_basis_v1(p_company_id uuid,p_underlay_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb:='[]';u public.billing_underlays%rowtype;b gridex_billing_source.underlay_bindings%rowtype;qualified boolean;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_underlay_ids IS NULL OR cardinality(p_underlay_ids)>1000 OR array_position(p_underlay_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'billing_underlay_read_scope_required'; END IF;
 FOR u IN SELECT * FROM public.billing_underlays WHERE company_id=p_company_id AND id=ANY(p_underlay_ids) ORDER BY id LOOP
  SELECT * INTO b FROM gridex_billing_source.underlay_bindings WHERE underlay_id=u.id AND company_id=p_company_id;
  qualified:=true;
  BEGIN PERFORM gridex_billing_source.require_underlay_v1(p_company_id,u.id);
  EXCEPTION WHEN check_violation THEN qualified:=false; END;
  result:=result||jsonb_build_array(jsonb_build_object('id',u.id,'qualified',qualified,'totalKwh',gridex_utilts_binding.canonical_decimal_v2(u.total_kwh::text),'sourceBasisHash',b.source_basis_hash,'correctionRequired',EXISTS(SELECT FROM gridex_billing_source.correction_journal j WHERE j.underlay_id=u.id)));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[]) TO service_role;
CREATE FUNCTION gridex_billing_source.require_underlay_v1(p_company uuid,p_underlay uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE u public.billing_underlays%rowtype;b gridex_billing_source.underlay_bindings%rowtype;legal_basis jsonb;
BEGIN
 SELECT * INTO u FROM public.billing_underlays WHERE id=p_underlay AND company_id=p_company;
 SELECT * INTO b FROM gridex_billing_source.underlay_bindings WHERE underlay_id=p_underlay AND company_id=p_company;
 IF u.id IS NULL OR b.underlay_id IS NULL OR b.exact_total_kwh IS DISTINCT FROM u.total_kwh OR b.source_basis_hash IS DISTINCT FROM encode(sha256(convert_to(b.source_basis::text,'UTF8')),'hex')
  OR EXISTS(SELECT FROM gridex_billing_source.correction_journal WHERE underlay_id=u.id) THEN RAISE EXCEPTION 'billing_finalized_source_basis_required' USING ERRCODE='23514'; END IF;
 legal_basis:=gridex_received_sources.billing_supply_basis_v1(p_company,u.supply_period_id,(b.source_basis->>'start')::timestamptz,(b.source_basis->>'end')::timestamptz);
 IF legal_basis IS DISTINCT FROM b.source_basis->'supply' THEN RAISE EXCEPTION 'billing_finalized_supply_basis_changed' USING ERRCODE='23514'; END IF;
END $$;
ALTER FUNCTION public.gridex_create_billing_export_run(jsonb,jsonb) RENAME TO gridex_create_billing_export_run_before_source_v2;
ALTER FUNCTION public.gridex_create_billing_export_run_before_source_v2(jsonb,jsonb) SET SCHEMA gridex_billing_source;
CREATE FUNCTION public.gridex_create_billing_export_run(p_run jsonb,p_items jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;company uuid;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 company:=(p_run->>'company_id')::uuid;
 IF company IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'billing_export_source_scope_required'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF item->>'status'='ready' THEN PERFORM gridex_billing_source.require_underlay_v1(company,(item->>'billing_underlay_id')::uuid); END IF;
 END LOOP;
 RETURN gridex_billing_source.gridex_create_billing_export_run_before_source_v2(p_run,p_items);
END $$;
REVOKE ALL ON FUNCTION public.gridex_create_billing_export_run(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_create_billing_export_run(jsonb,jsonb) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_billing_source FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
