-- CLI-created 105431, sequenced after the private duplicate reception owner.
-- Same canonical positive resolver and denies; current wall clock after waits.
-- Status reading grants no prepare/send capability or new permission assignment.
BEGIN;
DO $clock$ DECLARE definition text; predecessor jsonb; successor jsonb; BEGIN
 SELECT to_jsonb(p)-ARRAY['prosrc','provolatile'] INTO predecessor FROM pg_proc p
 WHERE oid='public.gridex_actor_has_company_permission(uuid,uuid,text)'::regprocedure;
 definition:=pg_get_functiondef('public.gridex_actor_has_company_permission(uuid,uuid,text)'::regprocedure);
 IF position('public.gridex_get_user_permissions_in_company' IN definition)=0
   OR position('public.user_permission_overrides' IN definition)=0 THEN
  RAISE EXCEPTION 'ediel_current_permission_canonical_predecessor_required';END IF;
 definition:=replace(replace(definition,' STABLE',' VOLATILE'),'now()','clock_timestamp()');
 IF position('p_actor_user_id is not null' IN definition)=0 THEN RAISE EXCEPTION 'ediel_current_permission_actor_anchor_required';END IF;
 definition:=replace(definition,'p_actor_user_id is not null', 'p_actor_user_id is not null AND EXISTS(SELECT FROM public.permissions catalog WHERE catalog.key=p_permission AND catalog.is_active)');
 EXECUTE definition;
 SELECT to_jsonb(p)-ARRAY['prosrc','provolatile'] INTO successor FROM pg_proc p
 WHERE oid='public.gridex_actor_has_company_permission(uuid,uuid,text)'::regprocedure;
 IF predecessor IS DISTINCT FROM successor OR (SELECT provolatile FROM pg_proc WHERE oid='public.gridex_actor_has_company_permission(uuid,uuid,text)'::regprocedure)<>'v'
 THEN RAISE EXCEPTION 'ediel_current_permission_metadata_changed';END IF;
END $clock$;

CREATE FUNCTION public.ediel_read_business_ack_status_v1(
 p_source_message_id uuid,p_actor_user_id uuid,p_company_id uuid DEFAULT NULL,
 p_ack_family text DEFAULT NULL,p_environment text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;company uuid;basis jsonb;entry jsonb;
 family text;items jsonb:='[]';held uuid[]:='{}';correlation record;snapshot jsonb;receipt jsonb;
 latest_capture timestamptz;latest_ack uuid;ambiguous_summary boolean:=false;BEGIN
 PERFORM gridex_prodat_object_batch.require_service_v1();
 IF p_source_message_id IS NULL OR p_actor_user_id IS NULL
  OR (p_ack_family IS NOT NULL AND p_ack_family NOT IN('CONTRL','APERAK','UTILTS_ERR'))
  THEN RAISE EXCEPTION 'ediel_business_ack_status_scope_required' USING ERRCODE='22023';END IF;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id AND direction IN('inbound','outbound') FOR SHARE;
 IF source.id IS NULL OR(p_environment IS NOT NULL AND source.environment IS DISTINCT FROM p_environment)
  THEN RAISE EXCEPTION 'ediel_business_ack_status_source_required';END IF;
 -- A null public company is resolved only by the actual native source owner.
 IF source.direction='inbound' THEN
  basis:=gridex_ack_authority.read_outbound_originals_v1(source.id,coalesce(p_ack_family,'APERAK'));
 END IF;
 company:=coalesce(source.company_id,(basis->>'companyId')::uuid);
 IF company IS NULL OR(p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM company)
  THEN RAISE EXCEPTION 'ediel_business_ack_status_tenant_required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor_user_id AND user_status='active')
  OR NOT EXISTS(SELECT FROM public.companies WHERE id=company AND is_active AND status='active')
  OR public.gridex_actor_has_company_permission(p_actor_user_id,company,'communication.read') IS NOT TRUE
  THEN RAISE EXCEPTION 'ediel_business_ack_status_reader_required' USING ERRCODE='42501';END IF;
 IF source.direction='inbound' THEN
 FOREACH family IN ARRAY CASE WHEN p_ack_family IS NULL THEN ARRAY['CONTRL','APERAK','UTILTS_ERR'] ELSE ARRAY[p_ack_family] END LOOP
  basis:=gridex_ack_authority.read_outbound_originals_v1(source.id,family);
  IF basis->>'sourceMessageId' IS DISTINCT FROM source.id::text OR basis->>'environment' IS DISTINCT FROM source.environment
   OR (basis->>'companyId' IS NOT NULL AND basis->>'companyId' IS DISTINCT FROM company::text)
   THEN RAISE EXCEPTION 'ediel_business_ack_status_native_scope_mismatch';END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(basis->'originals') LOOP
   IF gridex_ediel_duplicate_responses.is_duplicate_ack_v1((entry#>>'{message,id}')::uuid) THEN CONTINUE;END IF;
   -- A native consumption/witness may qualify an original whose mutable
   -- public relation is absent. Project the private binding; never repair it.
   IF entry->>'status'='qualified' THEN items:=items||jsonb_build_array((entry->'message')||jsonb_build_object('related_message_id',source.id));
   ELSE held:=array_append(held,(entry#>>'{message,id}')::uuid);END IF;
  END LOOP;
 END LOOP;
 ELSE
  -- Incoming ACK status is disclosed only through its immutable correlation
  -- and the existing exact-receipt owner. Mutable aggregate caches are unused.
  FOR correlation IN SELECT c.*,r.captured_at FROM gridex_ack_authority.source_correlations c
   LEFT JOIN gridex_ack_authority.applied_receipts r USING(ack_message_id)
   WHERE c.source_message_id=source.id AND c.company_id=company AND c.environment=source.environment
   ORDER BY r.captured_at ASC NULLS FIRST,c.ack_message_id LOOP
   basis:=gridex_ack_authority.read_committed_v1(company,source.environment,correlation.ack_message_id,p_actor_user_id);
   IF basis->>'kind' IS DISTINCT FROM 'exact_receipt' THEN held:=array_append(held,correlation.ack_message_id);CONTINUE;END IF;
   IF basis->>'sourceMessageId' IS DISTINCT FROM source.id::text OR basis->>'companyId' IS DISTINCT FROM company::text
    OR basis->>'environment' IS DISTINCT FROM source.environment OR basis->>'ackFamily' IS DISTINCT FROM correlation.ack_family
    THEN RAISE EXCEPTION 'ediel_business_ack_status_native_scope_mismatch';END IF;
   SELECT to_jsonb(m)||jsonb_build_object('related_message_id',source.id,'ack_outcome',correlation.ack_outcome)
    INTO entry FROM public.ediel_messages m WHERE m.id=correlation.ack_message_id;
   IF p_ack_family IS NULL OR correlation.ack_family=p_ack_family THEN items:=items||jsonb_build_array(entry);END IF;
   IF correlation.captured_at IS NULL THEN held:=array_append(held,correlation.ack_message_id);CONTINUE;END IF;
   IF latest_capture IS NOT DISTINCT FROM correlation.captured_at THEN
    IF snapshot IS DISTINCT FROM basis#>'{result,sourceMessage}' THEN ambiguous_summary:=true;END IF;
   ELSE ambiguous_summary:=false;END IF;
   snapshot:=basis#>'{result,sourceMessage}';receipt:=((basis->'result')-'sourceMessage')||
    jsonb_build_object('ackMessageId',correlation.ack_message_id,'capturedAt',correlation.captured_at);
   latest_capture:=correlation.captured_at;latest_ack:=correlation.ack_message_id;
  END LOOP;
  IF ambiguous_summary THEN held:=array_append(held,latest_ack);snapshot:=NULL;receipt:=NULL;END IF;
 END IF;
 -- Inner original qualification can wait. Recheck before disclosing its result.
 IF public.gridex_actor_has_company_permission(p_actor_user_id,company,'communication.read') IS NOT TRUE
  THEN RAISE EXCEPTION 'ediel_business_ack_status_reader_required' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('version',1,'companyId',company,'sourceMessageId',source.id,
  'environment',source.environment,'sourceDirection',source.direction,'sourceSnapshot',snapshot,'sourceReceipt',receipt,
  'ackFamily',p_ack_family,'messages',items,'heldOriginalIds',held);
END $$;
REVOKE ALL ON FUNCTION public.ediel_read_business_ack_status_v1(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_read_business_ack_status_v1(uuid,uuid,uuid,text,text) TO service_role;
COMMIT;
