-- Use a separate compact projection for ordinary billing and readiness reads.
-- The full-row RPC and the immutable source records remain available to their
-- existing readers. Qualification, locks, source identifiers and hashes are shared.
CREATE FUNCTION public.gridex_read_billing_source_values_compact_v1(p_company_id uuid, p_value_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE n public.normalized_metering_values%rowtype;s public.ediel_messages%rowtype;b jsonb;result jsonb[]:='{}';bases jsonb;i integer:=0;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_value_ids IS NULL OR cardinality(p_value_ids)>1000 OR array_position(p_value_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'billing_source_scope_required' USING ERRCODE='22023'; END IF;
 PERFORM gridex_billing_source.lock_values_v1(p_company_id,p_value_ids);
 -- G-6 (20261024130000): every basis of this call in one bases_v1 evaluation (same values, same id order).
 bases:=gridex_billing_source.bases_v1(p_company_id,ARRAY(SELECT id FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=ANY(p_value_ids) ORDER BY id),true,false);
 FOR n IN SELECT * FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=ANY(p_value_ids) ORDER BY id LOOP
  b:=gridex_billing_source.basis_entry_v1(bases->i);i:=i+1;
  SELECT * INTO s FROM public.ediel_messages WHERE id=n.source_message_id AND company_id=p_company_id;
  -- This is the local row variable; the authoritative stored copy remains untouched.
  n.raw_payload:=NULL;
  result:=array_append(result,(to_jsonb(n)-'raw_payload')||jsonb_build_object('quantity_kwh',b->'quantityKwh','product_code',CASE WHEN b->'qualified'='true'::jsonb THEN b->'productCode' ELSE to_jsonb(n.product_code) END,'register_code',CASE WHEN b->'qualified'='true'::jsonb THEN b->'registerCode' ELSE to_jsonb(n.register_code) END,'quality_status',CASE WHEN b->'qualified'='true'::jsonb THEN b->'quality' ELSE to_jsonb(n.quality_status) END,
   'billing_source_basis',b,'billing_source_message',CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'company_id',s.company_id,'message_family',s.message_family,'message_code',s.message_code,'status',s.status) END));
 END LOOP;
 -- G-6: rows are accumulated in an array and serialized once (was an O(n^2) jsonb concatenation of ~43 kB rows).
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.gridex_read_billing_source_values_compact_v1(uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_billing_source_values_compact_v1(uuid,uuid[]) TO service_role;
