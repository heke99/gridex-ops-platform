-- PRIVATE prospective receipt governance. No cleanup policy, issuer decision,
-- deadline or permission grant is fabricated by this schema migration.
BEGIN;
INSERT INTO public.permissions(key,name,category,is_active)
 SELECT 'ediel.retention.manual_billing_receipt','Retain/redact manual billing receipt copies','ediel',true
 WHERE NOT EXISTS(SELECT FROM public.permissions WHERE key='ediel.retention.manual_billing_receipt');
INSERT INTO gridex_ediel_retention.finance_class_catalog VALUES
 ('manual_billing_continuation_body','gridex_received_sources','manual_billing_continuations_v1','id',ARRAY['original_period','original_basis'],'ediel.retention.manual_billing_receipt','manual_billing_continuation','redact_finance_copy_body'),
 ('manual_received_end_successor_body','gridex_received_sources','manual_received_end_successors_v1','id',ARRAY['resulting_period'],'ediel.retention.manual_billing_receipt','manual_received_end_successor','redact_finance_copy_body');
-- The original source receipt and operational graph survive redaction. No cascade.
ALTER TABLE gridex_received_sources.manual_billing_continuations_v1
 ADD FOREIGN KEY(company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(contract_id) REFERENCES public.customer_contracts(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(period_id) REFERENCES public.customer_supply_periods(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(contract_event_id) REFERENCES public.customer_contract_events(id) ON DELETE RESTRICT;
ALTER TABLE gridex_received_sources.manual_received_end_successors_v1
 ADD FOREIGN KEY(company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(contract_id) REFERENCES public.customer_contracts(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(period_id) REFERENCES public.customer_supply_periods(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(source_message_id) REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(effect_receipt_id) REFERENCES gridex_received_sources.supply_object_effect_receipts(id) ON DELETE RESTRICT;
-- The one source-basis CHECK also admits exactly the existing finance owner's
-- redaction marker. A BEFORE INSERT guard still requires fresh original bytes.
DO $constraint$ DECLARE n text;BEGIN
 SELECT conname INTO STRICT n FROM pg_constraint WHERE conrelid='gridex_received_sources.manual_billing_continuations_v1'::regclass
  AND contype='c' AND pg_get_constraintdef(oid) LIKE '%original_basis%';
 EXECUTE format('ALTER TABLE gridex_received_sources.manual_billing_continuations_v1 DROP CONSTRAINT %I',n);
END$constraint$;
ALTER TABLE gridex_received_sources.manual_billing_continuations_v1 ADD CONSTRAINT manual_billing_original_or_redacted_v1 CHECK(
 original_basis->>'qualified'='true' AND original_basis->>'activated'='true'
 OR original_basis=jsonb_build_object('retentionUnavailable',true,'sourceHash',original_basis->>'sourceHash','complete',false,'authority','none')
 AND original_basis->>'sourceHash'~'^[a-f0-9]{64}$');
DROP TRIGGER manual_billing_continuation_immutable_v1 ON gridex_received_sources.manual_billing_continuations_v1;
DROP TRIGGER manual_received_end_successors_immutable_v1 ON gridex_received_sources.manual_received_end_successors_v1;
CREATE FUNCTION gridex_received_sources.manual_billing_governed_copy_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF TG_OP='UPDATE' AND public.ediel_is_qualified_finance_retention_transition_v1(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) IS TRUE THEN RETURN NEW;END IF;
 IF TG_OP='INSERT' THEN
  IF TG_TABLE_NAME='manual_billing_continuations_v1' THEN
   IF NEW.original_basis->>'qualified' IS DISTINCT FROM 'true' OR NEW.original_basis->>'activated' IS DISTINCT FROM 'true'
    OR NEW.original_basis ? 'retentionUnavailable' OR NEW.original_period ? 'retentionUnavailable' THEN RAISE EXCEPTION 'manual_billing_new_original_required';END IF;
   PERFORM gridex_received_sources.require_manual_billing_records_v1(NEW.company_id,NEW.contract_id,NEW.original_basis);
  ELSE
   IF NEW.resulting_period ? 'retentionUnavailable' THEN RAISE EXCEPTION 'manual_billing_new_original_required';END IF;
   PERFORM public.ediel_require_source_bytes_available_v1(NEW.company_id,NEW.source_message_id);
   PERFORM public.ediel_require_contract_records_available_v1(NEW.company_id,NEW.contract_id);
  END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'manual_billing_continuation_immutable';
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.manual_billing_governed_copy_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
DO $triggers$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['manual_billing_continuations_v1','manual_received_end_successors_v1'] LOOP
 EXECUTE format('CREATE TRIGGER manual_billing_governed_copy_guard_v1 BEFORE INSERT OR UPDATE OR DELETE ON gridex_received_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.manual_billing_governed_copy_guard_v1()',t);
 EXECUTE format('CREATE TRIGGER manual_billing_no_truncate_v1 BEFORE TRUNCATE ON gridex_received_sources.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.manual_billing_continuation_immutable_v1()',t);
 EXECUTE format('CREATE TRIGGER finance_target_guard_v1 BEFORE INSERT OR UPDATE OR DELETE ON gridex_received_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.finance_target_guard_v1()',t);
 EXECUTE format('ALTER TABLE gridex_received_sources.%I ENABLE ALWAYS TRIGGER manual_billing_governed_copy_guard_v1',t);
 EXECUTE format('ALTER TABLE gridex_received_sources.%I ENABLE ALWAYS TRIGGER manual_billing_no_truncate_v1',t);
END LOOP;END$triggers$;
GRANT USAGE ON SCHEMA gridex_received_sources TO gridex_ediel_retention_owner;
GRANT SELECT ON gridex_received_sources.manual_billing_continuations_v1,gridex_received_sources.manual_received_end_successors_v1 TO gridex_ediel_retention_owner;
GRANT UPDATE(original_period,original_basis) ON gridex_received_sources.manual_billing_continuations_v1 TO gridex_ediel_retention_owner;
GRANT UPDATE(resulting_period) ON gridex_received_sources.manual_received_end_successors_v1 TO gridex_ediel_retention_owner;
DO $patch$ DECLARE f record;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_ediel_retention.finance_basis_v1(uuid,text,text)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '9de03475901a14ce4f8c4c22d6455bd63062584414fe3d75d9300f33c3bddbac' THEN RAISE EXCEPTION 'manual_billing_retention_exact_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,$body$
DECLARE spec gridex_ediel_retention.finance_class_catalog%rowtype;r jsonb;body jsonb;underlay jsonb;invoice jsonb;item jsonb;settlement jsonb;ref uuid;customer uuid;start_at timestamptz;end_at timestamptz;scope jsonb;included_ids uuid[];closed boolean;source_bound boolean:=false;original_sha text;node record;scope_company uuid;scope_customer uuid;included_ref uuid;finance_graph jsonb;BEGIN
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.finance_class_catalog WHERE retention_class=k;
 IF target!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' AND NOT(spec.source_table='portfolio_settlement_audit_log' AND target~'^[1-9][0-9]{0,18}$') THEN RAISE EXCEPTION 'finance_retention_actual_selector_required';END IF;
 IF EXISTS(SELECT FROM gridex_ediel_retention.finance_tombstones WHERE retention_class=k AND target_id=target AND company_id=c) THEN RAISE EXCEPTION 'finance_copy_retention_tombstoned';END IF;
 EXECUTE format('SELECT to_jsonb(x) FROM %I.%I x WHERE %I::text=$1 AND company_id=$2 FOR SHARE',spec.source_schema,spec.source_table,spec.id_column) INTO r USING target,c;
 IF r IS NULL THEN RAISE EXCEPTION 'finance_retention_actual_source_required';END IF;
 SELECT jsonb_object_agg(col,r->col) INTO body FROM unnest(spec.body_columns)col;
 IF octet_length(body::text) NOT BETWEEN 1 AND 20971520 OR body@>'{"retentionUnavailable":true}' THEN RAISE EXCEPTION 'finance_retention_actual_body_required';END IF;
 -- All period selectors come from real native relationships, never policy JSON.
 IF spec.source_kind='invoice' THEN invoice:=r;
 ELSIF spec.source_kind='invoice_line' THEN SELECT to_jsonb(x) INTO invoice FROM public.customer_invoices x WHERE id=(r->>'invoice_id')::uuid AND company_id=c FOR SHARE;
 ELSIF spec.source_kind='item' THEN item:=r;
 ELSIF spec.source_kind IN('item_child','provider_event') THEN ref:=coalesce(r->>'invoice_export_item_id',r->>'matched_invoice_export_item_id')::uuid;SELECT to_jsonb(x) INTO item FROM public.invoice_export_items x WHERE id=ref AND company_id=c FOR SHARE;
 ELSIF spec.source_kind='settlement' THEN settlement:=r;
 ELSIF spec.source_kind='settlement_child' THEN ref:=coalesce(r->>'settlement_id',r->>'portfolio_monthly_settlement_id')::uuid;SELECT to_jsonb(x) INTO settlement FROM public.portfolio_monthly_settlements x WHERE id=ref AND company_id=c FOR SHARE;END IF;
 IF spec.source_kind IN('underlay','underlay_child') THEN ref:=CASE WHEN spec.source_kind='underlay' THEN (r->>spec.id_column)::uuid ELSE (r->>'billing_underlay_id')::uuid END;
 ELSE ref:=coalesce(invoice->>'billing_underlay_id',item->>'billing_underlay_id',r->>'billing_underlay_id')::uuid;END IF;
 IF ref IS NOT NULL THEN SELECT to_jsonb(x) INTO underlay FROM public.billing_underlays x WHERE id=ref AND company_id=c FOR SHARE;END IF;
 IF underlay IS NOT NULL THEN
  customer:=(underlay->>'customer_id')::uuid;start_at:=(underlay->>'billing_period_start')::timestamptz;end_at:=(underlay->>'billing_period_end')::timestamptz;
  SELECT source_basis_hash INTO original_sha FROM gridex_billing_source.underlay_bindings WHERE underlay_id=ref AND company_id=c AND (source_basis_hash=encode(sha256(convert_to(source_basis::text,'UTF8')),'hex') OR EXISTS(SELECT FROM gridex_ediel_retention.finance_tombstones t WHERE t.retention_class='billing_underlay_source_body' AND t.target_id=ref::text AND t.company_id=c));source_bound:=original_sha IS NOT NULL;
 ELSIF settlement IS NOT NULL THEN start_at:=(settlement->>'delivery_month')::date::timestamptz;end_at:=start_at+interval '1 month';original_sha:=settlement->>'calculation_snapshot_sha256';source_bound:=settlement->>'status'='locked' AND (original_sha=encode(sha256(convert_to((settlement->'calculation_snapshot')::text,'UTF8')),'hex') OR EXISTS(SELECT FROM gridex_ediel_retention.finance_tombstones t WHERE t.retention_class='settlement_calculation_body' AND t.target_id=settlement->>'id' AND t.company_id=c));
 ELSIF spec.source_kind IN('manual_billing_continuation','manual_received_end_successor') THEN
  -- The new private rows are prospective producer receipts. Only their native
  -- immutable identities choose scope; no policy/caller JSON selects a period.
  SELECT to_jsonb(s) INTO underlay FROM public.customer_supply_periods s
   WHERE s.id=(r->>'period_id')::uuid AND s.company_id=c FOR SHARE;
  IF spec.source_kind='manual_billing_continuation' THEN
   customer:=(r->>'customer_id')::uuid;
   start_at:=(r#>>'{original_period,market_start_at}')::timestamptz;
   end_at:=((r->>'end_date')::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm';
   original_sha:=encode(sha256(convert_to((r->'original_basis')::text,'UTF8')),'hex');
   source_bound:=underlay IS NOT NULL AND underlay->>'customer_id'=customer::text
    AND underlay->>'contract_id'=r->>'contract_id'
    AND r#>>'{original_period,id}'=r->>'period_id' AND r#>>'{original_period,company_id}'=c::text
    AND r#>>'{original_basis,companyId}'=c::text AND r#>>'{original_basis,periodId}'=r->>'period_id'
    AND r#>>'{original_basis,qualified}'='true' AND r#>>'{original_basis,activated}'='true';
  ELSE
   SELECT to_jsonb(x) INTO invoice FROM gridex_received_sources.manual_billing_continuations_v1 x
    WHERE x.id=(r->>'manual_receipt_id')::uuid AND x.company_id=c AND x.period_id=(r->>'period_id')::uuid FOR SHARE;
   customer:=(invoice->>'customer_id')::uuid;
   start_at:=(r#>>'{resulting_period,market_start_at}')::timestamptz;
   end_at:=(r#>>'{resulting_period,market_end_at}')::timestamptz;
   original_sha:=r->>'effect_hash';
   source_bound:=invoice IS NOT NULL AND underlay IS NOT NULL
    AND invoice->>'contract_id'=r->>'contract_id' AND underlay->>'contract_id'=r->>'contract_id'
    AND underlay->>'customer_id'=customer::text AND r#>>'{resulting_period,id}'=r->>'period_id'
    AND r#>>'{resulting_period,company_id}'=c::text AND original_sha~'^[a-f0-9]{64}$';
  END IF;
  source_bound:=coalesce(source_bound,false) AND EXISTS(SELECT FROM public.customer_contracts x
   WHERE x.id=(r->>'contract_id')::uuid AND x.company_id=c AND x.customer_id=customer);
 ELSIF spec.source_kind='run' AND r->>'billing_month'~'^\d{4}-\d{2}$' THEN
  start_at:=(r->>'billing_month'||'-01')::date::timestamptz;end_at:=start_at+interval '1 month';
  SELECT count(*)>0 AND bool_and(b.underlay_id IS NOT NULL AND (b.source_basis_hash=encode(sha256(convert_to(b.source_basis::text,'UTF8')),'hex') OR EXISTS(SELECT FROM gridex_ediel_retention.finance_tombstones t WHERE t.company_id=c AND t.retention_class='billing_underlay_source_body' AND t.target_id=b.underlay_id::text))),encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('itemId',i.id,'underlayId',i.billing_underlay_id,'sourceHash',b.source_basis_hash) ORDER BY i.id),'[]')::text,'UTF8')),'hex') INTO source_bound,original_sha FROM public.invoice_export_items i LEFT JOIN gridex_billing_source.underlay_bindings b ON b.underlay_id=i.billing_underlay_id AND b.company_id=c WHERE i.company_id=c AND i.export_run_id=(r->>'id')::uuid;
 END IF;
 IF start_at IS NULL OR end_at IS NULL OR NOT isfinite(start_at) OR NOT isfinite(end_at) OR end_at<=start_at THEN RAISE EXCEPTION 'finance_retention_native_exact_period_required';END IF;
 LOCK TABLE public.customers,public.customer_supply_periods,public.customer_invoices,public.invoice_export_items,public.invoice_export_attempts IN SHARE ROW EXCLUSIVE MODE;
 IF customer IS NULL THEN SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO included_ids FROM public.customers WHERE company_id=c;ELSE included_ids:=ARRAY[customer];END IF;
 -- Decode actual stored native copy references. A known foreign included
 -- customer/contract/message cannot be hidden by the row's customer selector.
 FOR node IN SELECT * FROM gridex_ediel_retention.process_nodes_v1(body) LOOP
  IF node.key IN('companyId','company_id') AND jsonb_typeof(node.value)='string' AND (node.value#>>'{}') IS DISTINCT FROM c::text THEN RAISE EXCEPTION 'finance_retention_foreign_included_scope';END IF;
  IF node.key IN('customerId','customer_id','contractId','contract_id','customer_contract_id','sourceMessageId','source_message_id','messageId','originalMessageId') AND jsonb_typeof(node.value)='string' THEN
   BEGIN included_ref:=(node.value#>>'{}')::uuid;EXCEPTION WHEN invalid_text_representation THEN CONTINUE;END;
   scope_company:=NULL;scope_customer:=NULL;
   IF node.key IN('customerId','customer_id') THEN SELECT company_id,id INTO scope_company,scope_customer FROM public.customers WHERE id=included_ref;
   ELSIF node.key IN('contractId','contract_id','customer_contract_id') THEN SELECT company_id,customer_id INTO scope_company,scope_customer FROM public.customer_contracts WHERE id=included_ref;
   ELSE SELECT company_id,customer_id INTO scope_company,scope_customer FROM public.ediel_messages WHERE id=included_ref;END IF;
   IF scope_company IS NOT NULL AND scope_company IS DISTINCT FROM c THEN RAISE EXCEPTION 'finance_retention_foreign_included_scope';END IF;
  END IF;
 END LOOP;
 -- Free text and provider/aggregate copies are not an exhaustive caller list.
 -- Qualify the conservative real company population and its open finance graph.
 SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO included_ids FROM public.customers WHERE company_id=c;
 IF cardinality(included_ids)>10000 THEN RAISE EXCEPTION 'finance_retention_included_scope_bound';END IF;
 IF EXISTS(SELECT FROM public.customers WHERE id=ANY(included_ids) AND company_id IS DISTINCT FROM c) THEN RAISE EXCEPTION 'finance_retention_foreign_included_scope';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('customerId',x.id,'status',x.status,'supplies',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_supply_periods s WHERE s.company_id=c AND s.customer_id=x.id),'invoices',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'status',i.status) ORDER BY i.id),'[]') FROM public.customer_invoices i WHERE i.company_id=c AND i.customer_id=x.id)) ORDER BY x.id),'[]'),coalesce(bool_and(x.status='archived'),true) INTO scope,closed FROM public.customers x WHERE x.company_id=c AND id=ANY(included_ids);
 closed:=closed AND source_bound AND end_at<=clock_timestamp()
 AND NOT EXISTS(SELECT FROM public.customer_supply_periods s WHERE s.company_id=c AND s.customer_id=ANY(included_ids) AND s.status NOT IN('cancelled','rejected','terminated','ended','closed','inactive') AND (coalesce(s.actual_end_date,s.end_date) IS NULL OR coalesce(s.actual_end_date,s.end_date)>=current_date))
 AND NOT EXISTS(SELECT FROM public.customer_invoices i WHERE i.company_id=c AND i.customer_id=ANY(included_ids) AND i.status NOT IN('paid','cancelled','void','credited'))
 AND NOT EXISTS(SELECT FROM public.invoice_export_items i WHERE i.company_id=c AND i.customer_id=ANY(included_ids) AND (i.status IS NULL OR upper(i.status) NOT IN('SENT','CREDITED','CANCELLED','REJECTED')))
 AND NOT EXISTS(SELECT FROM public.invoice_export_attempts a JOIN public.invoice_export_items i ON i.id=a.invoice_export_item_id WHERE i.company_id=c AND i.customer_id=ANY(included_ids) AND a.finished_at IS NULL);
 SELECT coalesce(jsonb_agg(jsonb_build_object('itemId',i.id,'customerId',i.customer_id,'underlayId',i.billing_underlay_id,'runId',i.export_run_id,'status',i.status,'sourceHash',b.source_basis_hash,'attempts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'finishedAt',a.finished_at) ORDER BY a.id),'[]') FROM public.invoice_export_attempts a WHERE a.company_id=c AND a.invoice_export_item_id=i.id)) ORDER BY i.id),'[]') INTO finance_graph FROM public.invoice_export_items i LEFT JOIN gridex_billing_source.underlay_bindings b ON b.underlay_id=i.billing_underlay_id AND b.company_id=c WHERE i.company_id=c;
 RETURN jsonb_build_object('retentionClass',k,'targetId',target,'sourceTable',spec.source_schema||'.'||spec.source_table,'bodyColumns',spec.body_columns,'sourceHash',encode(sha256(convert_to(body::text,'UTF8')),'hex'),'targetHash',encode(sha256(convert_to(r::text,'UTF8')),'hex'),'scopeHash',encode(sha256(convert_to(jsonb_build_object('companyId',c,'customers',scope,'financialGraph',finance_graph,'periodStart',start_at,'periodEnd',end_at,'sourceBound',source_bound,'originalProducerHash',original_sha)::text,'UTF8')),'hex'),'periodStart',start_at,'periodEnd',end_at,'originalProducerHash',original_sha,'byteLength',octet_length(body::text),'includedCustomers',included_ids,'allIncludedScopesClosed',closed,'sourceBound',source_bound,'complete',false,'authority','none');END$body$);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'manual_billing_retention_metadata_changed';END IF;
END$patch$;
COMMIT;
