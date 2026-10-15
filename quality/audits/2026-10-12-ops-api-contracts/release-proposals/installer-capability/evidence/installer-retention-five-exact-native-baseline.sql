BEGIN;
SET LOCAL check_function_bodies=true;
CREATE OR REPLACE FUNCTION gridex_correction_process.capture_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  'happened_at','occurred_at','created_at','updated_at','archived_at','source_type','operation_id',
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
END $function$;
ALTER FUNCTION gridex_correction_process.capture_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gridex_correction_process.capture_v1() FROM PUBLIC,postgres,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_correction_process.capture_v1() TO postgres;
CREATE OR REPLACE FUNCTION public.gridex_audit_portfolio_settlement_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.portfolio_settlement_audit_log(
    company_id,portfolio_id,settlement_id,actor_user_id,permission,action,
    old_values,new_values,reason,calculation_snapshot_sha256,approval
  ) values(
    case when tg_op='INSERT' then new.company_id else old.company_id end,
    case when tg_op='INSERT' then new.portfolio_id else old.portfolio_id end,
    case when tg_op='INSERT' then new.id else old.id end,
    case
      when tg_op='INSERT' then new.created_by
      when new.locked_by is distinct from old.locked_by then new.locked_by
      when new.approved_by is distinct from old.approved_by then new.approved_by
      when new.reviewed_by is distinct from old.reviewed_by then new.reviewed_by
      when new.calculated_by is distinct from old.calculated_by then new.calculated_by
      else coalesce(
        nullif(current_setting('gridex.portfolio_actor_user_id',true), '')::uuid,
        new.created_by
      )
    end,
    case
      when tg_op='INSERT' then case when new.source='import' then 'portfolio_settlement.import' else 'portfolio_settlement.create' end
      when new.is_current=false and old.is_current then 'portfolio_settlement.correct'
      when new.status='calculated' and old.status is distinct from new.status then 'portfolio_settlement.calculate'
      when new.status='reviewed' and old.status is distinct from new.status then 'portfolio_settlement.review'
      when new.status='final' and old.status is distinct from new.status then 'portfolio_settlement.approve'
      when new.status='locked' and old.status is distinct from new.status then 'portfolio_settlement.lock'
      else 'portfolio_settlement.correct'
    end,
    case
      when tg_op='INSERT' then 'settlement.created'
      when new.is_current=false and old.is_current then 'settlement.superseded'
      when new.status is distinct from old.status then 'settlement.'||new.status
      else 'settlement.updated'
    end,
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    case when tg_op='DELETE' then null else to_jsonb(new) end,
    coalesce(
      nullif(current_setting('gridex.portfolio_audit_reason',true),''),
      case when tg_op='INSERT' then new.correction_reason else coalesce(new.correction_reason,old.correction_reason) end
    ),
    new.calculation_snapshot_sha256,
    case
      when new.approved_by is not null then jsonb_build_object('approved_by',new.approved_by,'approved_at',new.approved_at)
      else null
    end
  );
  return new;
end $function$;
ALTER FUNCTION public.gridex_audit_portfolio_settlement_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gridex_audit_portfolio_settlement_write() FROM PUBLIC,postgres,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_audit_portfolio_settlement_write() TO postgres;
GRANT EXECUTE ON FUNCTION public.gridex_audit_portfolio_settlement_write() TO service_role;
CREATE OR REPLACE FUNCTION public.gridex_guard_company_hard_delete_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_retained text[];
begin
  if current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  if old.status = 'deleted_test_only' then
    v_retained := public.gridex_company_retained_history_v1(old.id);
    if cardinality(v_retained) = 0 then
      return old;
    end if;
    raise exception using
      errcode = '23001',
      message = 'company_hard_delete_blocked',
      detail = 'Disposable tenant still holds retained history: ' || array_to_string(v_retained, ',');
  end if;
  raise exception using
    errcode = '23001',
    message = 'company_hard_delete_blocked',
    detail = 'Retained audit, journal and billing history would be cascaded away; close the tenant through canonical_transition_tenant_lifecycle.';
end
$function$;
ALTER FUNCTION public.gridex_guard_company_hard_delete_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gridex_guard_company_hard_delete_v1() FROM PUBLIC,postgres,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_guard_company_hard_delete_v1() TO postgres;
CREATE OR REPLACE FUNCTION public.gridex_company_has_customer_data(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select exists(select 1 from public.customers c where c.company_id=p_company_id
   and coalesce(c.source,'')<>'ediel_portal_test'
   and coalesce(c.status,'') not in ('deleted','deleted_test_only','pending_deletion'))
$function$;
ALTER FUNCTION public.gridex_company_has_customer_data(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gridex_company_has_customer_data(uuid) FROM PUBLIC,postgres,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_company_has_customer_data(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.gridex_company_has_customer_data(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.gridex_company_has_customer_data(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.gridex_company_retained_history_v1(p_company_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select array_remove(array[
    case when exists (select 1 from public.customers c where c.company_id = p_company_id
      and c.is_test_data is not true and coalesce(lower(c.source), '') not like '%test%') then 'customers' end,
    case when exists (select 1 from public.customer_contracts x where x.company_id = p_company_id) then 'customer_contracts' end,
    case when exists (select 1 from public.customer_invoices x where x.company_id = p_company_id) then 'customer_invoices' end,
    case when exists (select 1 from public.invoice_documents x where x.company_id = p_company_id) then 'invoice_documents' end,
    case when exists (select 1 from public.billing_underlays x where x.company_id = p_company_id) then 'billing_underlays' end,
    case when exists (select 1 from public.contract_charge_ledger x where x.company_id = p_company_id) then 'contract_charge_ledger' end
  ], null)
$function$;
ALTER FUNCTION public.gridex_company_retained_history_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gridex_company_retained_history_v1(uuid) FROM PUBLIC,postgres,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_company_retained_history_v1(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.gridex_company_retained_history_v1(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.gridex_company_retained_history_v1(uuid) TO service_role;
COMMIT;
