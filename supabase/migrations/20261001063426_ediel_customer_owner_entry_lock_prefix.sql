-- Recreated NEW unpublished lock prefix. Old function OID/ACL/body retained.
BEGIN;
DO $prefix$DECLARE sig text;before_oid oid;before_acl aclitem[];before_owner oid;before_config text[];before_security bool;before_volatility "char";definition text;BEGIN
 FOR sig IN SELECT unnest(ARRAY[
 'gridex_received_sources.append_object_assessment(uuid,text,uuid,text,uuid,text)',
 'gridex_customer_life_events.qualified_patches_v1(uuid,uuid,timestamptz,timestamptz,timestamptz)',
 'public.ediel_customer_life_event_patches_v1(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz)',
 'public.ediel_customer_life_event_export_at_v1(uuid,uuid,uuid,timestamptz)',
 'public.ediel_customer_life_event_export_projection_v1(uuid,uuid,uuid)',
 'public.ediel_customer_life_event_committed_source_v1(uuid,uuid,uuid)',
 'public.ediel_customer_life_event_boundaries_v1(uuid,uuid,uuid,timestamptz,timestamptz)',
 'public.gridex_ai_record_outbound_original_v1(uuid,uuid,uuid,uuid,text,text,text,text,text)',
 'public.gridex_ai_outbound_origin_status_v1(uuid,uuid,uuid)']) LOOP
  SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile,pg_get_functiondef(oid) INTO before_oid,before_acl,before_owner,before_config,before_security,before_volatility,definition FROM pg_proc WHERE oid=to_regprocedure(sig);
  IF before_oid IS NULL OR position('BEGIN' IN definition)=0 THEN RAISE EXCEPTION 'customer_owner_prefix_actual_owner_missing:%',sig;END IF;
  definition:=regexp_replace(definition,'BEGIN','BEGIN'||chr(10)||' PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();');EXECUTE definition;
  IF (SELECT oid<>before_oid OR proacl IS DISTINCT FROM before_acl OR proowner<>before_owner OR proconfig IS DISTINCT FROM before_config OR prosecdef<>before_security OR provolatile<>before_volatility FROM pg_proc WHERE oid=to_regprocedure(sig)) THEN RAISE EXCEPTION 'customer_owner_prefix_identity_changed:%',sig;END IF;
 END LOOP;
END$prefix$;
COMMIT;
