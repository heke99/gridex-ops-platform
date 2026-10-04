BEGIN;
-- Same physical own-IDE rules as quantityPrecision.ts: guide fields 515–517,
-- 521–523; U§3.6.4 / frozen CV-U-FN-DEC functional E51 only after guide.
-- No caller metadata approves an exception or supplies meter precision.
CREATE FUNCTION gridex_utilts_binding.decimal_rules_v1(tokens jsonb,tx text,decimal_mark text DEFAULT '.') RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE own_start integer;own_end integer;first_seq integer;t jsonb;value text;field text;max_dec integer;decimals integer;unit text;code text;product text;resolution text;format text;guide jsonb:='[]';functional jsonb:='[]';qualifier text;
BEGIN
 SELECT (s->>'index')::integer INTO STRICT own_start FROM jsonb_array_elements(tokens) s WHERE s->>'tag'='IDE' AND s#>>'{elements,2,0}'=tx;
 SELECT min((s->>'index')::integer) INTO own_end FROM jsonb_array_elements(tokens) s WHERE (s->>'index')::integer>own_start AND s->>'tag' IN('IDE','UNT');
 SELECT min((s->>'index')::integer) INTO first_seq FROM jsonb_array_elements(tokens) s WHERE (s->>'index')::integer>own_start AND (s->>'index')::integer<own_end AND s->>'tag'='SEQ';
 SELECT s#>>'{elements,1,0}' INTO STRICT code FROM jsonb_array_elements(tokens) s WHERE s->>'tag'='BGM';
 SELECT s#>>'{elements,3,0}' INTO product FROM jsonb_array_elements(tokens) s WHERE s->>'tag'='LIN' AND (s->>'index')::integer>own_start AND (s->>'index')::integer<first_seq;
 SELECT s#>>'{elements,1,1}',s#>>'{elements,1,2}' INTO resolution,format FROM jsonb_array_elements(tokens) s WHERE s->>'tag'='DTM' AND s#>>'{elements,1,0}'='354' AND (s->>'index')::integer>own_start AND (s->>'index')::integer<first_seq;
 SELECT s#>>'{elements,3,0}' INTO unit FROM jsonb_array_elements(tokens) s WHERE s->>'tag'='MEA' AND (s->>'index')::integer>own_start AND (s->>'index')::integer<first_seq;
 IF code='E30' AND unit IS NULL AND ((resolution='15' AND format='806') OR (resolution='1' AND format IN('801','802'))) THEN unit:='KWH'; END IF;
 FOR t IN SELECT s FROM jsonb_array_elements(tokens) s WHERE (s->>'index')::integer>first_seq AND (s->>'index')::integer<own_end AND s->>'tag' IN('QTY','PRI','MOA') LOOP
  value:=t#>>'{elements,1,1}';qualifier:=t#>>'{elements,1,0}';max_dec:=NULL;
  field:=CASE t->>'tag' WHEN 'MOA' THEN CASE qualifier WHEN '9' THEN '522' END WHEN 'PRI' THEN CASE qualifier WHEN 'CAL' THEN '523' END WHEN 'QTY' THEN CASE qualifier WHEN '135' THEN '515' WHEN '136' THEN '516' WHEN '220' THEN '517' WHEN '42' THEN '521' END END;
  IF field IS NULL THEN CONTINUE; END IF;
  IF value='NULL' AND field IN('516','517') THEN CONTINUE; END IF;
  IF decimal_mark NOT IN('.',',') OR value IS NULL OR value='' OR replace(value,decimal_mark,'.') !~ '^-?[0-9]+([.][0-9]+)?$'
   OR length(value)>(CASE field WHEN '523' THEN 15 ELSE 35 END) THEN guide:=guide||jsonb_build_array(field);CONTINUE; END IF;
  decimals:=CASE WHEN strpos(value,decimal_mark)>0 THEN length(value)-strpos(value,decimal_mark) ELSE 0 END;
  IF field IN('522','523') THEN
   max_dec:=CASE field WHEN '522' THEN 2 ELSE 6 END;
   IF decimals>max_dec THEN guide:=guide||jsonb_build_array(field); END IF;
   CONTINUE;
  END IF;
  IF qualifier IN('135','136') AND product='8716867000030' AND unit IS NOT NULL AND unit<>'KWH' THEN functional:=functional||'"E73"'::jsonb;CONTINUE; END IF;
  max_dec:=CASE WHEN unit='P1' THEN 3 WHEN qualifier='220' AND resolution='1' AND format IN('801','802') THEN 0
   WHEN qualifier IN('135','136') AND unit='KWH' THEN CASE WHEN resolution='1' AND format IN('801','802') THEN 0 WHEN (resolution='15' AND format='806') OR (resolution='1' AND format='805') THEN 3 END END;
  IF max_dec IS NOT NULL AND decimals>max_dec THEN functional:=functional||'"E51"'::jsonb; END IF;
 END LOOP;
 RETURN jsonb_build_object('guide',guide,'functional',functional);
EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN NULL;
END $$;
ALTER FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) RENAME TO persist_consumption_before_precision_v1;
ALTER FUNCTION public.persist_consumption_before_precision_v1(uuid,text,uuid,text,text,jsonb) SET SCHEMA gridex_utilts_binding;
CREATE FUNCTION public.gridex_persist_utilts_consumption_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_message_code text,p_raw_payload text,p_transactions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;item jsonb;rules jsonb;hash text;committed boolean;mark text;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id FOR UPDATE;
 IF source.id IS NULL OR source.company_id IS DISTINCT FROM p_company_id OR source.environment IS DISTINCT FROM p_environment OR source.message_code IS DISTINCT FROM p_message_code
  OR source.direction IS DISTINCT FROM 'inbound' OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.raw_payload IS DISTINCT FROM p_raw_payload OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01'; END IF;
 hash:=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex');mark:=CASE WHEN left(source.raw_payload,3)='UNA' THEN substring(source.raw_payload,6,1) ELSE '.' END;
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  SELECT EXISTS(SELECT FROM gridex_utilts_binding.receipts r JOIN public.ediel_ack_transaction_results a ON a.source_message_id=r.source_message_id
   WHERE r.source_message_id=source.id AND r.company_id=p_company_id AND r.environment=p_environment AND r.raw_hash=hash
    AND a.company_id=p_company_id AND a.environment=p_environment AND a.source_transaction_id=item->>'transactionId'
    AND a.disposition IS NOT DISTINCT FROM item->>'disposition' AND a.planned_response_type IS NOT DISTINCT FROM item->>'responseType'
    AND ((a.disposition='accepted' AND a.persistence_status='persisted' AND a.planned_response_type='positive_aperak') OR (a.disposition<>'accepted' AND a.finalized_at IS NOT NULL))) INTO committed;
  -- Authentic committed V1/V2 replay is validated by the retained owner below;
  -- these new rules cannot rewrite a prior final ACK/contract interpretation.
  IF committed THEN CONTINUE; END IF;
  PERFORM gridex_received_sources.require_utilts_transaction_v1(p_company_id,source.id,item->>'transactionId',item->>'disposition',item->>'responseType',item->'issueCodes');
  IF item->>'disposition'<>'accepted' THEN CONTINUE; END IF;
  PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,source.id);
  PERFORM gridex_ediel_source_rules.require_v1(p_company_id,source.id);
  rules:=gridex_utilts_binding.decimal_rules_v1(gridex_utilts_binding.wire_tokens_v1(source.raw_payload),item->>'transactionId',mark);
  IF rules IS NULL OR jsonb_array_length(rules->'guide')<>0 OR jsonb_array_length(rules->'functional')<>0 THEN RAISE EXCEPTION 'utilts_source_decimal_or_unit_rules_failed' USING ERRCODE='P0U01'; END IF;
 END LOOP;
 RETURN gridex_utilts_binding.persist_consumption_before_precision_v1(p_company_id,p_environment,p_source_message_id,p_message_code,p_raw_payload,p_transactions);
END $$;
REVOKE ALL ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) TO service_role;
-- New billing projections require the actual standard source conditions too.
-- No existing metering contract, receipt, binding, final ACK or invoice changes.
ALTER FUNCTION gridex_billing_source.basis_v1(uuid,uuid) RENAME TO basis_before_precision_v1;
CREATE FUNCTION gridex_billing_source.basis_v1(p_company uuid,p_value uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b jsonb;n public.normalized_metering_values%rowtype;s public.ediel_messages%rowtype;rules jsonb;
BEGIN
 b:=gridex_billing_source.basis_before_precision_v1(p_company,p_value);
 IF b->'qualified' IS DISTINCT FROM 'true'::jsonb THEN RETURN b; END IF;
 SELECT * INTO n FROM public.normalized_metering_values WHERE id=p_value AND company_id=p_company;
 SELECT * INTO s FROM public.ediel_messages WHERE id=n.source_message_id AND company_id=p_company;
 rules:=gridex_utilts_binding.decimal_rules_v1(gridex_utilts_binding.wire_tokens_v1(s.raw_payload),n.source_transaction_reference,CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END);
 IF rules IS NULL OR jsonb_array_length(rules->'guide')<>0 OR jsonb_array_length(rules->'functional')<>0 THEN RETURN b||jsonb_build_object('qualified',false,'reason','billing_source_standard_decimal_or_unit_basis_required'); END IF;
 RETURN b;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_utilts_binding FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_billing_source FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
