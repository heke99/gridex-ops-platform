-- Additive correction after the published 54122/63426/70121 owner packet.
-- Faithful installed native ports, strict original receipt clocks and current
-- post-wait authority. Published migrations, original signed claims, OIDs/ACLs
-- and immutable accepted first-effect replay stay unchanged.
BEGIN;
DO $ports$DECLARE original text;replacement text;definition text;BEGIN
 FOR original,replacement IN SELECT * FROM(VALUES
  ('gridex_requested_changes.scoped_permission_v1(uuid,uuid,text)','gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1'),
  ('gridex_requested_changes.actor_v1(uuid,uuid,text,text)','gridex_bilateral_customer_sources.classified_actor_wallclock_v1'),
  ('gridex_bilateral_customer_sources.source_claims_v1(uuid,uuid,uuid,uuid,uuid)','gridex_bilateral_customer_sources.classified_source_claims_wallclock_v1'),
  ('gridex_bilateral_customer_sources.receipt_current_v1(gridex_bilateral_customer_sources.artifacts)','gridex_bilateral_customer_sources.classified_receipt_wallclock_v1'),
  ('gridex_bilateral_customer_sources.current_v1(gridex_bilateral_customer_sources.artifacts)','gridex_bilateral_customer_sources.classified_independent_wallclock_v1')
 )ports(original,replacement) LOOP
  SELECT pg_get_functiondef(to_regprocedure(original)) INTO definition;
  IF definition IS NULL THEN RAISE EXCEPTION 'classified_customer_wallclock_actual_port_required:%',original;END IF;
  definition:=replace(definition,split_part(original,'(',1),replacement);
  definition:=replace(replace(definition,'now()','clock_timestamp()'),'current_date','(clock_timestamp()::date)');
  definition:=replace(definition,'gridex_requested_changes.scoped_permission_v1(','gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(');
  definition:=replace(definition,'gridex_requested_changes.actor_v1(','gridex_bilateral_customer_sources.classified_actor_wallclock_v1(');
  definition:=replace(definition,'gridex_bilateral_customer_sources.source_claims_v1(','gridex_bilateral_customer_sources.classified_source_claims_wallclock_v1(');
  definition:=replace(definition,'gridex_bilateral_customer_sources.receipt_current_v1(','gridex_bilateral_customer_sources.classified_receipt_wallclock_v1(');
  IF replacement LIKE '%classified_receipt_wallclock_v1' THEN
   IF position('issued:=(p->>''issuedAt'')::timestamptz;expires:=(p->>''expiresAt'')::timestamptz;' IN definition)=0 THEN RAISE EXCEPTION 'classified_customer_actual_receipt_clock_marker_required';END IF;
   definition:=replace(definition,'issued:=(p->>''issuedAt'')::timestamptz;expires:=(p->>''expiresAt'')::timestamptz;',
    'issued:=(p->>''issuedAt'')::timestamptz;expires:=(p->>''expiresAt'')::timestamptz; IF issued IS NULL OR expires IS NULL OR NOT isfinite(issued) OR NOT isfinite(expires) OR expires<=issued OR issued>a.created_at THEN RETURN NULL;END IF;');
  END IF;
  IF replacement LIKE '%classified_independent_wallclock_v1' THEN
   definition:=replace(definition,'RETURN receipt;',$independent$
 IF gridex_bilateral_customer_sources.classified_actor_wallclock_v1(a.company_id,r.reviewer_user_id,'review','method_contract') IS NOT TRUE THEN RETURN NULL;END IF;
 RETURN gridex_bilateral_customer_sources.classified_receipt_wallclock_v1(a);
$independent$);
  END IF;
  EXECUTE definition;
 END LOOP;
END$ports$;

-- Rebind only source-authority callees in the full installed bodies. The old
-- STABLE owner proof continues to call the existing private VOLATILE owner.
DO $bind$DECLARE signature text;definition text;phase text;post_wait text;before_oid oid;before_acl aclitem[];before_owner oid;before_config text[];before_security bool;before_vol "char";BEGIN
 FOR signature IN SELECT unnest(ARRAY[
  'public.ediel_archive_bilateral_customer_source_v1(uuid,uuid,jsonb)',
  'public.ediel_read_bilateral_customer_source_v1(uuid,uuid,uuid,boolean)',
  'public.ediel_review_bilateral_customer_source_v1(uuid,uuid,uuid,jsonb)',
  'gridex_bilateral_customer_sources.classification_current_v1(uuid,uuid,timestamptz)',
  'gridex_bilateral_customer_sources.publish_life_event_classification_v1(uuid,uuid)',
  'public.ediel_apply_customer_life_event_source_v1(uuid,uuid,uuid)',
  'public.ediel_customer_life_event_patches_v1(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz)',
  'public.ediel_customer_life_event_export_at_v1(uuid,uuid,uuid,timestamptz)',
  'public.ediel_customer_life_event_export_projection_v1(uuid,uuid,uuid)',
  'public.ediel_customer_life_event_boundaries_v1(uuid,uuid,uuid,timestamptz,timestamptz)']) LOOP
  SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile,pg_get_functiondef(oid) INTO before_oid,before_acl,before_owner,before_config,before_security,before_vol,definition FROM pg_proc WHERE oid=to_regprocedure(signature);
  IF before_oid IS NULL THEN RAISE EXCEPTION 'classified_customer_wallclock_bound_owner_required:%',signature;END IF;
  definition:=replace(definition,'gridex_requested_changes.actor_v1(','gridex_bilateral_customer_sources.classified_actor_wallclock_v1(');
  definition:=replace(definition,'gridex_bilateral_customer_sources.receipt_current_v1(','gridex_bilateral_customer_sources.classified_receipt_wallclock_v1(');
  definition:=replace(definition,'gridex_bilateral_customer_sources.current_v1(','gridex_bilateral_customer_sources.classified_independent_wallclock_v1(');
  definition:=replace(definition,'gridex_bilateral_customer_sources.source_claims_v1(','gridex_bilateral_customer_sources.classified_source_claims_wallclock_v1(');
  IF signature LIKE 'public.ediel_read_bilateral%' THEN
   definition:=regexp_replace(definition,'BEGIN',$read_prefix$BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM id FROM public.ediel_messages WHERE company_id=p_company_id AND id=(SELECT source_message_id FROM gridex_bilateral_customer_sources.artifacts WHERE id=p_artifact_id AND company_id=p_company_id) FOR SHARE;
$read_prefix$);
  ELSIF signature LIKE '%classification_current_v1%' THEN
   IF position('RETURN receipt;' IN definition)=0 THEN RAISE EXCEPTION 'classified_customer_wallclock_final_receipt_marker_required';END IF;
   definition:=replace(definition,'RETURN receipt;',$current$
 IF gridex_bilateral_customer_sources.classified_actor_wallclock_v1(c,r.reviewer_user_id,'review','method_contract') IS NOT TRUE THEN RETURN NULL;END IF;
 receipt:=gridex_bilateral_customer_sources.classified_receipt_wallclock_v1(a);
 RETURN receipt;
$current$);
  ELSIF signature LIKE '%publish_life_event_classification_v1%' THEN
   IF position('stamp:=clock_timestamp();' IN definition)=0 THEN RAISE EXCEPTION 'classified_customer_wallclock_publish_marker_required';END IF;
   definition:=replace(definition,'stamp:=clock_timestamp();',$publish$
 receipt:=gridex_bilateral_customer_sources.classified_independent_wallclock_v1(a);
 IF receipt IS NULL THEN RAISE EXCEPTION 'classified_customer_post_wait_source_authority_required';END IF;
 stamp:=clock_timestamp();
$publish$);
  END IF;
  IF signature LIKE 'public.ediel_%bilateral_customer_source_v1%' THEN
   phase:=CASE WHEN signature LIKE 'public.ediel_read_%' THEN 'read' WHEN signature LIKE 'public.ediel_review_%' THEN 'review' ELSE 'archive' END;
   post_wait:=format(' IF gridex_bilateral_customer_sources.classified_actor_wallclock_v1(p_company_id,p_actor_user_id,%L,''method_contract'') IS NOT TRUE THEN RAISE EXCEPTION ''bilateral_customer_post_wait_actor_forbidden'' USING ERRCODE=''42501'';END IF; ',phase);
   definition:=replace(definition,'RETURN jsonb_build_object(',post_wait||'RETURN jsonb_build_object(');
   definition:=replace(definition,'RETURN result;',post_wait||'RETURN result;');
  END IF;
  EXECUTE definition;
  IF(SELECT oid<>before_oid OR proacl IS DISTINCT FROM before_acl OR proowner<>before_owner OR proconfig IS DISTINCT FROM before_config OR prosecdef<>before_security OR provolatile<>before_vol FROM pg_proc WHERE oid=to_regprocedure(signature)) THEN RAISE EXCEPTION 'classified_customer_wallclock_owner_identity_changed:%',signature;END IF;
 END LOOP;
END$bind$;
REVOKE ALL ON FUNCTION gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(uuid,uuid,text),gridex_bilateral_customer_sources.classified_actor_wallclock_v1(uuid,uuid,text,text),gridex_bilateral_customer_sources.classified_source_claims_wallclock_v1(uuid,uuid,uuid,uuid,uuid),gridex_bilateral_customer_sources.classified_receipt_wallclock_v1(gridex_bilateral_customer_sources.artifacts),gridex_bilateral_customer_sources.classified_independent_wallclock_v1(gridex_bilateral_customer_sources.artifacts) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
