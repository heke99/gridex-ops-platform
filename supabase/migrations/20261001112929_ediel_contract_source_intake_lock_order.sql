-- Follow-up preserves the original intake migration and all source bodies.
-- Contract locks precede selected immutable source-row locks, including native
-- reserve helpers; issuer/revocation reads need SHARE, never global write locks.
BEGIN;
DO $$DECLARE f record;body text;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_contract_source_intake.lock_graph_v1()'::regprocedure;
 IF position('IN SHARE ROW EXCLUSIVE MODE' IN f.prosrc)=0 THEN RAISE EXCEPTION 'contract_intake_graph_lock_predecessor_required';END IF;
 body:=replace(f.prosrc,'LOCK TABLE gridex_contract_source_intake.issuer_keys,gridex_contract_source_intake.representations,gridex_contract_source_intake.artifacts,gridex_contract_source_intake.reviews,gridex_contract_source_intake.qualifications,gridex_contract_source_intake.revocations IN SHARE ROW EXCLUSIVE MODE;',
 'LOCK TABLE gridex_contract_source_intake.issuer_keys,gridex_contract_source_intake.representations,gridex_contract_source_intake.revocations IN SHARE MODE;');
 IF body=f.prosrc THEN RAISE EXCEPTION 'contract_intake_exact_immutable_graph_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'contract_intake_graph_metadata_changed';END IF;
END$$;
CREATE FUNCTION gridex_contract_source_intake.lock_target_contract_v1(c uuid,k text,target uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$BEGIN
 PERFORM gridex_contract_source_intake.lock_graph_v1();
 -- Qualification links are immutable. No source-row lock is taken to discover
 -- its contract; another transaction can only publish a new qualification.
 PERFORM ct.id FROM public.customer_contracts ct JOIN gridex_contract_source_intake.artifacts a ON a.contract_id=ct.id AND a.company_id=ct.company_id
 JOIN gridex_contract_source_intake.qualifications q ON q.artifact_id=a.id AND q.company_id=a.company_id AND q.kind=a.kind
 WHERE q.company_id=c AND q.kind=k AND q.target_id=target ORDER BY ct.id FOR SHARE OF ct;
END$$;
REVOKE ALL ON FUNCTION gridex_contract_source_intake.lock_target_contract_v1(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE f record;body text;needle text;hook text;kind text;BEGIN
 -- Keep the previous rule evaluation and actor/error precedence intact. Only
 -- the original lock acquisition is preceded by the same qualified contract.
 FOR f IN SELECT p.oid,p.proowner,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','gridex_metering_method_changes','gridex_received_sources','gridex_ediel_retention') AND(
 p.oid='gridex_ediel_retention.contract_copy_source_current_v1(uuid,text,text,uuid)'::regprocedure OR p.oid='gridex_received_sources.production_contract_source_for_execution_v1(uuid,uuid,uuid,text)'::regprocedure OR
 position('SELECT * INTO e FROM gridex_metering_method_changes.events WHERE id=event AND company_id=c FOR SHARE;' IN p.prosrc)>0 OR
 position('SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=p_event_id AND company_id=p_company_id FOR UPDATE;' IN p.prosrc)>0 OR
 position('SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=p_event_id AND company_id=p_company_id FOR SHARE;' IN p.prosrc)>0) LOOP
  body:=f.prosrc;
  IF f.oid='gridex_ediel_retention.contract_copy_source_current_v1(uuid,text,text,uuid)'::regprocedure THEN
   needle:='IF gridex_ediel_retention.contract_copy_source_before_intake_v1(c,ns,tab,target)';
   hook:='SELECT kind INTO k FROM gridex_contract_source_intake.kinds WHERE source_schema=ns AND source_table=tab;PERFORM gridex_contract_source_intake.lock_target_contract_v1(c,k,target);';
   IF position(needle IN body)=0 THEN RAISE EXCEPTION 'contract_intake_copy_lock_predecessor_required';END IF;
   body:=replace(body,needle,hook||' '||needle);
  ELSIF f.oid='gridex_received_sources.production_contract_source_for_execution_v1(uuid,uuid,uuid,text)'::regprocedure THEN
   needle:='basis:=gridex_received_sources.production_contract_source_before_intake_v1';
   IF position(needle IN body)=0 THEN RAISE EXCEPTION 'contract_intake_production_lock_predecessor_required';END IF;
   body:=replace(body,needle,'PERFORM gridex_contract_source_intake.lock_target_contract_v1(p_company_id,''production_contract_event'',p_event_id); '||needle);
  END IF;
  needle:='SELECT * INTO e FROM gridex_metering_method_changes.events WHERE id=event AND company_id=c FOR SHARE;';
  IF position(needle IN body)>0 THEN body:=replace(body,needle,'PERFORM gridex_contract_source_intake.lock_target_contract_v1(c,''metering_method_event'',event); '||needle);END IF;
  FOREACH needle IN ARRAY ARRAY['SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=p_event_id AND company_id=p_company_id FOR UPDATE;','SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=p_event_id AND company_id=p_company_id FOR SHARE;'] LOOP
   IF position(needle IN body)>0 THEN body:=replace(body,needle,'PERFORM gridex_contract_source_intake.lock_target_contract_v1(p_company_id,''production_contract_event'',p_event_id); '||needle);END IF;
  END LOOP;
  EXECUTE replace(f.definition,f.prosrc,body);
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'contract_intake_consumer_lock_metadata_changed';END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION gridex_contract_source_intake.lock_target_contract_v1(uuid,text,uuid) TO %I',pg_get_userbyid(f.proowner));
 END LOOP;
END$$;
COMMIT;
