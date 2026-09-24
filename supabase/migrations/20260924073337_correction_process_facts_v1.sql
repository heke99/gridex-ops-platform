-- Prospective process observations only. No historical completeness or C authority.
BEGIN;
CREATE SCHEMA gridex_correction_process;
REVOKE ALL ON SCHEMA gridex_correction_process FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE gridex_correction_process.epochs (
 table_name text PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 installed_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 complete boolean NOT NULL DEFAULT false CHECK (NOT complete)
);
INSERT INTO gridex_correction_process.epochs(table_name) VALUES
 ('customer_contract_events'),('customer_contracts'),('customer_sites'),('metering_points'),
 ('customer_supply_periods'),('supplier_switch_requests'),('supplier_switch_events'),
 ('customer_cases'),('customer_case_events'),('customer_operation_jobs'),
 ('customer_operation_tasks'),('customer_operation_events');

CREATE TABLE gridex_correction_process.facts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 table_name text NOT NULL REFERENCES gridex_correction_process.epochs(table_name),
 row_id uuid NOT NULL, operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
 company_id uuid, old_fact jsonb, new_fact jsonb,
 facts_hash text NOT NULL, captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 CHECK (old_fact IS NOT NULL OR new_fact IS NOT NULL),
 CHECK (old_fact IS NULL OR octet_length(old_fact::text)<=65536),
 CHECK (new_fact IS NULL OR octet_length(new_fact::text)<=65536)
);
CREATE INDEX ON gridex_correction_process.facts(company_id,table_name,id);
CREATE INDEX ON gridex_correction_process.facts(table_name,row_id,id);
CREATE TABLE gridex_correction_process.gaps (
 fact_id bigint PRIMARY KEY REFERENCES gridex_correction_process.facts(id),
 reason text NOT NULL CHECK(reason IN ('unbound_company','company_changed')),
 old_scope jsonb, new_scope jsonb,
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION gridex_correction_process.immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'correction_process_append_only' USING ERRCODE='55000';
END $$;

-- Keep only process and linkage fields, never addresses, contact data or free
-- text. An oversized transition fails the business mutation atomically.
CREATE FUNCTION gridex_correction_process.capture_v1() RETURNS trigger
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
 IF selected_company IS NULL OR (old_company IS NOT NULL AND new_company IS NOT NULL AND old_company<>new_company) THEN
  INSERT INTO gridex_correction_process.gaps(fact_id,reason,old_scope,new_scope)
  VALUES(fact_id,CASE WHEN selected_company IS NULL THEN 'unbound_company' ELSE 'company_changed' END,
   old_fact,new_fact);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

DO $$ DECLARE producer text; BEGIN
 FOR producer IN SELECT table_name FROM gridex_correction_process.epochs ORDER BY table_name LOOP
  EXECUTE format('CREATE TRIGGER e035_process_after_write AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION gridex_correction_process.capture_v1()',producer);
  EXECUTE format('CREATE TRIGGER e035_process_before_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION gridex_correction_process.capture_v1()',producer);
  EXECUTE format('CREATE TRIGGER e035_process_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_correction_process.immutable_v1()',producer);
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER e035_process_after_write',producer);
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER e035_process_before_delete',producer);
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER e035_process_no_truncate',producer);
 END LOOP;
END $$;

DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['epochs','facts','gaps'] LOOP
  EXECUTE format('ALTER TABLE gridex_correction_process.%I ENABLE ROW LEVEL SECURITY',relation_name);
  EXECUTE format('ALTER TABLE gridex_correction_process.%I FORCE ROW LEVEL SECURITY',relation_name);
  EXECUTE format('REVOKE ALL ON gridex_correction_process.%I FROM PUBLIC,anon,authenticated,service_role',relation_name);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_correction_process.%I FOR EACH ROW EXECUTE FUNCTION gridex_correction_process.immutable_v1()',relation_name);
  EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON gridex_correction_process.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_correction_process.immutable_v1()',relation_name);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION gridex_correction_process.capture_v1(),gridex_correction_process.immutable_v1()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
