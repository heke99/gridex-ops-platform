-- The real activation body was moved from public to the private source owner
-- in 201111. Its relations and %ROWTYPE references are already qualified;
-- this forward repair changes only the execution search path, retaining the
-- real body, OID, signature, owner, grants and established activation receipts.
DO $$
DECLARE f pg_proc%rowtype; relation_name text;
BEGIN
 SELECT * INTO STRICT f FROM pg_proc
 WHERE oid=to_regprocedure('gridex_received_sources.activate_supply_before_source_guard_v1(uuid,uuid,uuid,date,uuid,text)');
 IF NOT f.prosecdef THEN RAISE EXCEPTION 'private_supply_activation_definer_required';END IF;
 FOREACH relation_name IN ARRAY ARRAY['supplier_switch_requests','customer_supply_periods','customer_contracts','customer_application_workflows','customer_application_workflow_events','website_customer_applications','domain_events','customer_operation_jobs','companies','webhook_deliveries','webhook_subscriptions'] LOOP
  IF strpos(f.prosrc,'public.'||relation_name)=0
   OR f.prosrc ~ ('(?i)\m(from|join|update|into)\s+'||relation_name||'\M') THEN
   RAISE EXCEPTION 'private_supply_activation_relation_qualification_changed:%',relation_name;
  END IF;
 END LOOP;
END$$;
ALTER FUNCTION gridex_received_sources.activate_supply_before_source_guard_v1(uuid,uuid,uuid,date,uuid,text)
 SET search_path=pg_catalog;
