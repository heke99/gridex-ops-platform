-- Preserve both sides when ownership changes or was previously unknown.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_correction_process.capture_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 old_row jsonb; new_row jsonb; old_fact jsonb; new_fact jsonb;
 old_company text; new_company text; selected_company uuid; fact_id bigint;
 fields text[]:=ARRAY[
  'id','company_id','customer_id','customer_contract_id','contract_id','site_id','customer_site_id',
  'metering_point_id','meter_point_id','normalized_metering_point_id','facility_id',
  'normalized_facility_id','site_facility_id','ediel_metering_point_id','ediel_reference',
  'grid_owner_id','grid_owner_ediel_id','switch_request_id','supplier_switch_request_id',
  'customer_case_id','customer_operation_job_id','operation_id','outbound_request_id',
  'cancellation_ediel_message_id','source_message_id','source_switch_request_id',
  'outbound_z03_message_id','inbound_z04_message_id','rff_li_reference',
  'event_type','event_status','event_code','case_type','job_type','task_type',
  'request_type','process_type','source_process','source','status','start_status',
  'cancellation_status','withdrawal_scenario','withdrawal_possible','switch_can_be_stopped',
  'cancellation_required','billing_blocked','billing_manual_review','lifecycle_blocked',
  'start_date','end_date','actual_start_date','actual_end_date','starts_at','ends_at',
  'ended_at','signed_at','termination_notice_date','withdrawal_requested_at',
  'requested_start_date','confirmed_start_date','completed_at','failed_at',
  'submitted_at','resolved_at','closed_at','move_in_date','move_out_date',
  'happened_at','occurred_at','created_at','updated_at','source_type','operation_id',
  'idempotency_key','actual_start_at','delivery_start_at','withdrawal_deadline_at'
 ];
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR NOT EXISTS
  (SELECT FROM gridex_correction_process.epochs e WHERE e.table_name=TG_TABLE_NAME) THEN
  RAISE EXCEPTION 'correction_process_unregistered_producer' USING ERRCODE='23514';
 END IF;
 IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
 IF coalesce(octet_length(old_row::text),0)+coalesce(octet_length(new_row::text),0)>6291456 THEN
  RAISE EXCEPTION 'correction_process_transition_too_large' USING ERRCODE='22001';
 END IF;
 SELECT jsonb_object_agg(key,value) INTO old_fact FROM jsonb_each(old_row) WHERE key=ANY(fields);
 SELECT jsonb_object_agg(key,value) INTO new_fact FROM jsonb_each(new_row) WHERE key=ANY(fields);
 IF coalesce(octet_length(old_fact::text),0)>65536 OR coalesce(octet_length(new_fact::text),0)>65536 THEN
  RAISE EXCEPTION 'correction_process_fact_too_large' USING ERRCODE='22001';
 END IF;
 old_company:=old_row->>'company_id'; new_company:=new_row->>'company_id';
 selected_company:=coalesce(old_company,new_company)::uuid;
 INSERT INTO gridex_correction_process.facts(table_name,row_id,operation,company_id,old_fact,new_fact,facts_hash)
 VALUES (TG_TABLE_NAME,(coalesce(old_row,new_row)->>'id')::uuid,TG_OP,selected_company,old_fact,new_fact,
  encode(sha256(convert_to(jsonb_build_object('table',TG_TABLE_NAME,'rowId',coalesce(old_row,new_row)->>'id',
   'operation',TG_OP,'old',old_fact,'new',new_fact)::text,'UTF8')),'hex')) RETURNING id INTO fact_id;
 IF selected_company IS NULL OR (TG_OP='UPDATE' AND old_company IS DISTINCT FROM new_company) THEN
  INSERT INTO gridex_correction_process.gaps(fact_id,reason,old_scope,new_scope)
  VALUES(fact_id,CASE WHEN old_company IS NULL OR new_company IS NULL THEN 'unbound_company' ELSE 'company_changed' END,
   old_fact,new_fact);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
COMMIT;
