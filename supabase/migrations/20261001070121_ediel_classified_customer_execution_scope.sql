-- Recreated NEW unpublished bridge-scoped first effect and personal projection.
-- Actual10758 archive/read phases. Immutable committed replay remains first.
BEGIN;
DO $execution_scope$DECLARE sig text;before_oid oid;before_acl aclitem[];before_owner oid;before_config text[];before_security bool;before_volatility "char";definition text;needle text;addition text;BEGIN
 FOR sig IN SELECT unnest(ARRAY[
 'public.ediel_apply_customer_life_event_source_v1(uuid,uuid,uuid)',
 'public.ediel_customer_life_event_patches_v1(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz)',
 'public.ediel_customer_life_event_export_at_v1(uuid,uuid,uuid,timestamptz)',
 'public.ediel_customer_life_event_export_projection_v1(uuid,uuid,uuid)',
 'public.ediel_customer_life_event_boundaries_v1(uuid,uuid,uuid,timestamptz,timestamptz)']) LOOP
  SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile,pg_get_functiondef(oid) INTO before_oid,before_acl,before_owner,before_config,before_security,before_volatility,definition FROM pg_proc WHERE oid=to_regprocedure(sig);
  IF before_oid IS NULL THEN RAISE EXCEPTION 'classified_customer_execution_owner_missing:%',sig;END IF;
  IF sig LIKE 'public.ediel_apply_%' THEN
   needle:=' basis:=gridex_customer_life_events.inbound_basis_v1(p_company_id,m.id,p_actor_user_id);';
   IF position('RETURN partition.result' IN definition)=0 OR position('customer_life_event_committed_replay_conflict' IN definition)=0 OR position('SELECT * INTO prior FROM gridex_customer_life_events.transitions' IN definition)=0 THEN RAISE EXCEPTION 'classified_customer_execution_receipt_first_required';END IF;
   addition:=$x$ IF EXISTS(SELECT FROM gridex_bilateral_customer_sources.life_event_classification_origins origin WHERE origin.company_id=p_company_id AND origin.source_message_id=m.id)
  AND gridex_requested_changes.actor_v1(p_company_id,p_actor_user_id,'archive','method_contract') IS NOT TRUE THEN
  RAISE EXCEPTION 'classified_customer_first_effect_actor_forbidden' USING ERRCODE='42501';END IF;
$x$;
  ELSE
   needle:=' PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,';
   addition:=$x$ IF EXISTS(SELECT FROM gridex_customer_life_events.customer_versions scoped_customer_event JOIN gridex_bilateral_customer_sources.life_event_classification_origins origin ON origin.source_message_id=scoped_customer_event.source_message_id AND origin.company_id=scoped_customer_event.company_id WHERE scoped_customer_event.company_id=p_company_id AND scoped_customer_event.customer_id=p_customer_id)
  AND gridex_requested_changes.actor_v1(p_company_id,p_actor_user_id,'read','method_contract') IS NOT TRUE THEN
  RAISE EXCEPTION 'classified_customer_personal_history_actor_forbidden' USING ERRCODE='42501';END IF;
$x$;
  END IF;
  IF position(needle IN definition)=0 OR position('lock_current_graph_v2' IN definition)=0 THEN RAISE EXCEPTION 'classified_customer_execution_actual_marker_missing:%',sig;END IF;
  definition:=replace(definition,needle,addition||needle);EXECUTE definition;
  IF (SELECT oid<>before_oid OR proacl IS DISTINCT FROM before_acl OR proowner<>before_owner OR proconfig IS DISTINCT FROM before_config OR prosecdef<>before_security OR provolatile<>before_volatility FROM pg_proc WHERE oid=to_regprocedure(sig)) THEN RAISE EXCEPTION 'classified_customer_execution_identity_changed:%',sig;END IF;
 END LOOP;
END$execution_scope$;
COMMIT;
