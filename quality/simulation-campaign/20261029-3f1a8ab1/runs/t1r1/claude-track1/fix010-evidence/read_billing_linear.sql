-- fix010: linear accumulation; otherwise byte-identical to stack def (md5 below). CREATE OR REPLACE keeps owner/ACL/SECDEF.
CREATE OR REPLACE FUNCTION public.gridex_read_billing_source_values_v1(p_company_id uuid, p_value_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE n public.normalized_metering_values%rowtype;s public.ediel_messages%rowtype;b jsonb;acc jsonb[]:='{}';
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_value_ids IS NULL OR cardinality(p_value_ids)>1000 OR array_position(p_value_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'billing_source_scope_required' USING ERRCODE='22023'; END IF;
 PERFORM gridex_billing_source.lock_values_v1(p_company_id,p_value_ids);
 FOR n IN SELECT * FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=ANY(p_value_ids) ORDER BY id LOOP
  b:=gridex_billing_source.basis_v1(p_company_id,n.id);
  SELECT * INTO s FROM public.ediel_messages WHERE id=n.source_message_id AND company_id=p_company_id;
  acc:=array_append(acc,to_jsonb(n)||jsonb_build_object('quantity_kwh',b->'quantityKwh','product_code',CASE WHEN b->'qualified'='true'::jsonb THEN b->'productCode' ELSE to_jsonb(n.product_code) END,'register_code',CASE WHEN b->'qualified'='true'::jsonb THEN b->'registerCode' ELSE to_jsonb(n.register_code) END,'quality_status',CASE WHEN b->'qualified'='true'::jsonb THEN b->'quality' ELSE to_jsonb(n.quality_status) END,
   'billing_source_basis',b,'billing_source_message',CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'company_id',s.company_id,'message_family',s.message_family,'message_code',s.message_code,'status',s.status) END));
 END LOOP;
 RETURN coalesce(to_jsonb(acc),'[]'::jsonb);
END $function$;
