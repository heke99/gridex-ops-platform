-- Local candidate for the Batch 2B origin in the existing atomic writer.
DO $migration$
DECLARE
  old_function record;
  signature constant text := 'public.gridex_create_customer_info_request_v1(uuid,jsonb,uuid)';
BEGIN
  SELECT p.oid, pg_catalog.to_jsonb(p)-'prosrc' AS metadata,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256
  INTO old_function
  FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(signature) AND p.prosecdef;
  IF NOT FOUND OR old_function.body_sha256 IS DISTINCT FROM '90229195c50a9904ed6ac746fc76315a96051e32bb12590427ab21923b694027'
    OR pg_catalog.has_function_privilege('anon',old_function.oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',old_function.oid,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role',old_function.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'customer_info_request_batch2b_predecessor_changed';
  END IF;
  EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.gridex_create_customer_info_request_v1(p_company_id uuid, p_request jsonb, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_catalog', 'pg_temp'
    AS $$
declare
  v_customer_id uuid := nullif(p_request->>'customer_id', '')::uuid;
  v_site_id uuid := nullif(p_request->>'site_id', '')::uuid;
  v_metering_point_id uuid := nullif(p_request->>'metering_point_id', '')::uuid;
  v_automation_key text := nullif(btrim(p_request->>'automation_key'), '');
  v_categories jsonb := coalesce(p_request->'requested_data_categories', '[]'::jsonb);
  v_row public.customer_info_requests%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'customer_info_request_service_role_required';
  end if;
  if p_company_id is null or v_customer_id is null
     or nullif(p_request->>'request_type', '') is null
     or nullif(p_request->>'target_party_type', '') is null
     or jsonb_typeof(v_categories) <> 'array' or jsonb_array_length(v_categories) = 0 then
    raise exception using errcode = '22023', message = 'customer_info_request_payload_invalid';
  end if;
  if p_request->>'automation_origin' = 'batch_2b_operations' then
    if auth.role() is distinct from 'service_role' then
      raise exception using errcode='42501', message='customer_info_request_service_role_required';
    end if;

    perform 1 from public.companies c
    where c.id = p_company_id and c.is_active is distinct from false and c.is_paused is not true
      and coalesce(c.status,'active') not in
        ('paused','suspended','inactive','closed','archived','pending_deletion','deleted','deleted_test_only')
    for share;
    if not found or
      public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'customers.write') is distinct from true then
      raise exception using errcode='42501', message='customer_info_request_batch2b_actor_or_company_forbidden';
    end if;
  end if;
  if not exists (select 1 from public.customers where id = v_customer_id and company_id = p_company_id) then
    raise exception using errcode = 'P0002', message = 'customer_not_found_for_company';
  end if;
  if v_site_id is not null and not exists (
    select 1 from public.customer_sites where id = v_site_id and company_id = p_company_id and customer_id = v_customer_id
  ) then
    raise exception using errcode = 'P0002', message = 'site_not_found_for_customer';
  end if;
  if v_metering_point_id is not null and not exists (
    select 1 from public.metering_points where id = v_metering_point_id and company_id = p_company_id and customer_id = v_customer_id
  ) then
    raise exception using errcode = 'P0002', message = 'metering_point_not_found_for_customer';
  end if;

  if v_automation_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':cir:' || v_automation_key, 0));
    select * into v_row from public.customer_info_requests
     where company_id = p_company_id and automation_key = v_automation_key;
    if found then
      return jsonb_build_object('created', false, 'request', to_jsonb(v_row));
    end if;
  end if;

  insert into public.customer_info_requests (
    company_id, customer_id, site_id, metering_point_id, grid_owner_id, operation_id,
    request_type, target_party_type, target_party_name, current_supplier_name,
    status, requested_data_categories, verified_payload, notes,
    automation_origin, automation_key, created_by, updated_by
  ) values (
    p_company_id, v_customer_id, v_site_id, v_metering_point_id,
    nullif(p_request->>'grid_owner_id', '')::uuid, nullif(p_request->>'operation_id', '')::uuid,
    p_request->>'request_type', p_request->>'target_party_type', nullif(p_request->>'target_party_name', ''),
    nullif(p_request->>'current_supplier_name', ''),
    'draft', v_categories, coalesce(p_request->'verified_payload', '{}'::jsonb), nullif(p_request->>'notes', ''),
    nullif(p_request->>'automation_origin', ''), v_automation_key, p_actor_user_id, p_actor_user_id
  ) returning * into v_row;

  insert into public.customer_info_request_events (
    company_id, customer_info_request_id, customer_id, event_type, message, payload, created_by
  ) values (
    p_company_id, v_row.id, v_customer_id, 'created', 'Uppgiftsbegäran skapades.',
    jsonb_build_object(
      'requested_data_categories', v_categories,
      'siteId', v_site_id, 'meteringPointId', v_metering_point_id,
      'gridOwnerId', v_row.grid_owner_id, 'operationId', v_row.operation_id,
      'automationOrigin', v_row.automation_origin),
    p_actor_user_id);

  return jsonb_build_object('created', true, 'request', to_jsonb(v_row));
end;
$$;
$ddl$;
  IF (SELECT pg_catalog.to_jsonb(p)-'prosrc' FROM pg_catalog.pg_proc p WHERE p.oid=old_function.oid)
    IS DISTINCT FROM old_function.metadata THEN
    RAISE EXCEPTION 'customer_info_request_batch2b_function_metadata_changed';
  END IF;
END
$migration$;
