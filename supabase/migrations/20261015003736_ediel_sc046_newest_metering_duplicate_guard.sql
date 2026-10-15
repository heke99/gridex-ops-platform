-- SC046 prerequisite: populate the existing legacy transaction ID from the
-- same logical reference already used by atomic metering and its source links.
-- Preserve the legacy unique index, historical rows and every other function.
DO $migration$
DECLARE
 target oid := 'public.gridex_ingest_metering_value_atomic(jsonb)'::regprocedure;
 before_metadata jsonb; after_metadata jsonb; before_helpers jsonb; after_helpers jsonb;
 before_index jsonb; after_index jsonb; old_body text; new_body text;
 old_definition text; new_definition text; installed_body text;
 column_before text := '    source_transaction_reference,source_line_reference,price_area,resolution,canonical_dedupe_key,is_current,previous_value_id,';
 column_after text := '    source_transaction_id,source_transaction_reference,source_line_reference,price_area,resolution,canonical_dedupe_key,is_current,previous_value_id,';
 value_before text := $values$    v_raw,v_source_message_id,v_source_tx,
    v_source_line,$values$;
 value_after text := $values$    v_raw,v_source_message_id,v_source_tx,v_source_tx,
    v_source_line,$values$;
 index_definition text := $index$CREATE UNIQUE INDEX ux_metering_values_company_ediel_duplicate_guard ON public.metering_values USING btree (company_id, metering_point_id, COALESCE(product_code, ''::text), COALESCE(register_code, ''::text), COALESCE(meter_number, ''::text), period_start, period_end, COALESCE(reading_type, ''::text), COALESCE(source_transaction_id, ''::text)) WHERE ((company_id IS NOT NULL) AND (metering_point_id IS NOT NULL) AND (period_start IS NOT NULL) AND (period_end IS NOT NULL))$index$;
BEGIN
 -- Stable metadata/index witnesses while this isolated forward changes only
 -- the target body. No row is updated, inserted, removed or rekeyed here.
 LOCK TABLE public.metering_values IN SHARE MODE;
 SELECT to_jsonb(p)-'prosrc', p.prosrc, pg_get_functiondef(p.oid)
 INTO before_metadata, old_body, old_definition FROM pg_proc p WHERE p.oid=target;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM 'a5806ee9dce67d299e1e06cb4eb47f19a90710c9a9760f35aa071fb7c70b5f9f'
  OR old_body='' OR (length(old_definition)-length(replace(old_definition,old_body,'')))/length(old_body)<>1
  OR (length(old_body)-length(replace(old_body,column_before,'')))/length(column_before)<>1
  OR (length(old_body)-length(replace(old_body,value_before,'')))/length(value_before)<>1 THEN
  RAISE EXCEPTION 'sc046_duplicate_guard_predecessor_conflict' USING ERRCODE='P0U01';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=target
  AND l.lanname='plpgsql' AND p.prokind='f' AND p.prosecdef AND NOT p.proretset
  AND pg_get_userbyid(p.proowner)='postgres' AND p.pronargs=1 AND p.pronargdefaults=0
  AND p.proargtypes='3802'::oidvector AND p.proargnames=ARRAY['p_payload']::text[]
  AND p.proallargtypes IS NULL AND p.proargmodes IS NULL AND p.prorettype='public.metering_values'::regtype
  AND p.proconfig=ARRAY['search_path=public']::text[]
  AND p.proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[]) THEN
  RAISE EXCEPTION 'sc046_duplicate_guard_metadata_conflict' USING ERRCODE='P0U01';
 END IF;
 SELECT jsonb_build_object('pg_index',to_jsonb(i),'pg_class',to_jsonb(c),'definition',pg_get_indexdef(i.indexrelid))
 INTO before_index FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
 WHERE i.indexrelid=to_regclass('public.ux_metering_values_company_ediel_duplicate_guard')
  AND i.indrelid='public.metering_values'::regclass AND i.indisunique AND i.indisvalid AND i.indisready;
 IF before_index IS NULL OR before_index->>'definition' IS DISTINCT FROM index_definition THEN
  RAISE EXCEPTION 'sc046_duplicate_guard_index_conflict' USING ERRCODE='P0U01';
 END IF;
 IF encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb)'::regprocedure),'UTF8')),'hex')
   IS DISTINCT FROM 'd0bafd57804b2fb416927807856590fba46d92fa7d322e1a9a2afb582d7af1ca'
  OR encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='gridex_utilts_binding.check_metering_result_v1(public.metering_values,jsonb,text)'::regprocedure),'UTF8')),'hex')
   IS DISTINCT FROM 'e0dae3670484c486c544e67cb848f19335112c8034b820a6371e7ec0ae73e10a' THEN
  RAISE EXCEPTION 'sc046_duplicate_guard_helper_conflict' USING ERRCODE='P0U01';
 END IF;
 SELECT jsonb_object_agg(p.oid::text,to_jsonb(p)) INTO before_helpers
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.oid<>target AND (n.nspname='public' OR starts_with(n.nspname,'gridex_'));
 new_body:=replace(replace(old_body,column_before,column_after),value_before,value_after);
 IF encode(sha256(convert_to(new_body,'UTF8')),'hex') IS DISTINCT FROM '7c3afe5c7fec6a5def5b0b64d4459bf6af21369a8e55e647c50308e772815af7'
  OR replace(replace(new_body,column_after,column_before),value_after,value_before) IS DISTINCT FROM old_body THEN
  RAISE EXCEPTION 'sc046_duplicate_guard_source_inverse_conflict' USING ERRCODE='P0U01';
 END IF;
 new_definition:=replace(old_definition,old_body,new_body);
 EXECUTE new_definition;
 SELECT to_jsonb(p)-'prosrc', p.prosrc INTO after_metadata, installed_body FROM pg_proc p WHERE p.oid=target;
 SELECT jsonb_object_agg(p.oid::text,to_jsonb(p)) INTO after_helpers
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.oid<>target AND (n.nspname='public' OR starts_with(n.nspname,'gridex_'));
 SELECT jsonb_build_object('pg_index',to_jsonb(i),'pg_class',to_jsonb(c),'definition',pg_get_indexdef(i.indexrelid))
 INTO after_index FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
 WHERE i.indexrelid=to_regclass('public.ux_metering_values_company_ediel_duplicate_guard');
 IF after_metadata IS DISTINCT FROM before_metadata OR after_helpers IS DISTINCT FROM before_helpers
  OR after_index IS DISTINCT FROM before_index OR installed_body IS DISTINCT FROM new_body
  OR encode(sha256(convert_to(installed_body,'UTF8')),'hex') IS DISTINCT FROM '7c3afe5c7fec6a5def5b0b64d4459bf6af21369a8e55e647c50308e772815af7'
  OR replace(new_definition,new_body,old_body) IS DISTINCT FROM old_definition THEN
  RAISE EXCEPTION 'sc046_duplicate_guard_postcondition_conflict' USING ERRCODE='P0U01';
 END IF;
END
$migration$;
