-- Website application review saves in one transaction.
--
-- Before: the admin review wrote the site, the metering point, the contract,
-- the application row and the customer's intake state as five separate
-- statements. A failure in the middle left a site without metering point, or a
-- contract the application did not point to. After:
-- gridex_save_website_application_review_v1 locks the application row and
-- performs every write for the tenant in one transaction. Validation,
-- normalization and readiness stay in the application; this function only
-- writes whitelisted columns, always scoped to p_company_id and the
-- application's own customer.

set local client_min_messages = warning;

-- Internal: insert (p_id null) or update one row from whitelisted jsonb keys.
-- Postgres casts each value to the column type via jsonb_populate_record.
create or replace function public.gridex_internal_write_tenant_row_v1(
  p_table regclass,
  p_company_id uuid,
  p_id uuid,
  p_values jsonb,
  p_allowed text[]
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_cols text;
  v_id uuid;
begin
  select string_agg(format('%I', key), ',' order by key)
    into v_cols
    from jsonb_object_keys(coalesce(p_values, '{}'::jsonb)) as key
   where key = any(p_allowed);

  if p_id is null then
    if v_cols is null then
      raise exception using errcode = '22023', message = 'tenant_row_insert_without_columns';
    end if;
    execute format(
      'insert into %s (company_id,%s) select $1,%s from jsonb_populate_record(null::%s, $2) returning id',
      p_table, v_cols, v_cols, p_table)
      into v_id using p_company_id, p_values;
    return v_id;
  end if;

  if v_cols is not null then
    execute format(
      'update %s set (%s) = (select %s from jsonb_populate_record(null::%s, $3)) where id = $1 and company_id = $2 returning id',
      p_table, v_cols, v_cols, p_table)
      into v_id using p_id, p_company_id, p_values;
    if v_id is null then
      raise exception using errcode = 'P0002', message = 'tenant_row_not_found_for_company';
    end if;
  end if;
  return p_id;
end;
$function$;

revoke all on function public.gridex_internal_write_tenant_row_v1(regclass, uuid, uuid, jsonb, text[]) from public, anon, authenticated;

create or replace function public.gridex_save_website_application_review_v1(
  p_company_id uuid,
  p_application_id uuid,
  p_site jsonb default null,
  p_metering_point jsonb default null,
  p_contract jsonb default null,
  p_application jsonb default '{}'::jsonb,
  p_customer jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_app public.website_customer_applications%rowtype;
  v_site_id uuid;
  v_mp_id uuid;
  v_contract_id uuid;
  v_contract_created boolean := false;
  v_values jsonb;
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'website_application_review_service_role_required';
  end if;
  if p_company_id is null or p_application_id is null then
    raise exception using errcode = '22023', message = 'website_application_review_payload_invalid';
  end if;

  select * into v_app
    from public.website_customer_applications
   where id = p_application_id and company_id = p_company_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'website_application_not_found_for_company';
  end if;

  v_site_id := v_app.customer_site_id;
  v_mp_id := v_app.metering_point_id;
  v_contract_id := v_app.contract_id;

  if v_app.customer_id is not null then
    -- Site: update the linked site, or create it for the application's customer.
    if jsonb_typeof(p_site) = 'object' then
      v_values := p_site || jsonb_build_object('customer_id', v_app.customer_id, 'updated_at', now());
      v_site_id := public.gridex_internal_write_tenant_row_v1(
        'public.customer_sites', p_company_id, v_site_id, v_values,
        array['customer_id','site_name','site_type','status','facility_id','street','postal_code','city','country',
              'grid_owner_id','grid_area_code','price_area_code','resolution_status','facility_data_verified_at',
              'move_in_date','metadata','updated_at']);
    end if;

    -- Metering point: needs a site.
    if jsonb_typeof(p_metering_point) = 'object' and v_site_id is not null then
      v_values := p_metering_point || jsonb_build_object(
        'customer_id', v_app.customer_id, 'site_id', v_site_id, 'customer_site_id', v_site_id, 'updated_at', now());
      v_mp_id := public.gridex_internal_write_tenant_row_v1(
        'public.metering_points', p_company_id, v_mp_id, v_values,
        array['customer_id','site_id','customer_site_id','metering_point_id','meter_point_id','ediel_metering_point_id',
              'anlage_id','site_facility_id','measurement_type','reading_frequency','price_area_code','grid_area_code',
              'facility_data_verified_at','start_date','status','verification_status','onboarding_status',
              'data_quality_status','is_settlement_relevant','metadata','updated_at']);
    end if;

    -- Contract: only when the application has none yet; reuse one already
    -- created for this application (idempotent re-save).
    if v_contract_id is null and jsonb_typeof(p_contract) = 'object' and p_contract->>'mode' = 'existing' then
      -- A matching contract found by the application; it must be this customer's.
      select id into v_contract_id
        from public.customer_contracts
       where id = nullif(p_contract->>'contract_id', '')::uuid
         and company_id = p_company_id
         and customer_id = v_app.customer_id;
      if v_contract_id is null then
        raise exception using errcode = 'P0002', message = 'website_application_contract_not_found_for_customer';
      end if;
    end if;

    if v_contract_id is null and jsonb_typeof(p_contract) = 'object' then
      select id into v_contract_id
        from public.customer_contracts
       where company_id = p_company_id
         and customer_id = v_app.customer_id
         and (website_application_id = v_app.id or metadata->>'application_id' = v_app.id::text)
       order by created_at desc
       limit 1;

      if v_contract_id is null then
        v_values := (p_contract->'payload') || jsonb_build_object(
          'customer_id', v_app.customer_id,
          'site_id', v_site_id, 'customer_site_id', v_site_id,
          'metering_point_id', v_mp_id,
          'website_application_id', v_app.id);
        if p_contract->>'mode' = 'published' then
          -- Bound to the locked public offer through the canonical contract RPC.
          v_result := public.gridex_create_website_customer_contract(
            p_company_id, v_values, nullif(p_contract->>'customer_number', ''));
          v_contract_id := nullif(v_result->'contract'->>'id', '')::uuid;
          if v_contract_id is null then
            raise exception using errcode = 'P0001', message = 'website_contract_rpc_returned_no_id';
          end if;
        elsif p_contract->>'mode' = 'draft' then
          v_contract_id := public.gridex_internal_write_tenant_row_v1(
            'public.customer_contracts', p_company_id, null, v_values,
            array['customer_id','site_id','customer_site_id','metering_point_id','source_type','status','contract_name',
                  'contract_type','starts_at','expected_start_at','requested_start_date','requested_start_mode',
                  'calculated_earliest_start_date','price_area_used','grid_area_code_used','resolution_status',
                  'confirmed_start_date','actual_start_date','agreement_channel','metadata','website_application_id',
                  'updated_at']);
        else
          raise exception using errcode = '22023', message = 'website_application_contract_mode_invalid';
        end if;
        v_contract_created := true;
      end if;
    end if;

    if jsonb_typeof(p_customer) = 'object' then
      perform public.gridex_internal_write_tenant_row_v1(
        'public.customers', p_company_id, v_app.customer_id, p_customer || jsonb_build_object('updated_at', now()),
        array['intake_status','intake_missing_fields','intake_quality_score','intake_warnings','updated_at']);
    end if;
  end if;

  v_values := coalesce(p_application, '{}'::jsonb) || jsonb_build_object(
    'customer_site_id', v_site_id, 'metering_point_id', v_mp_id, 'contract_id', v_contract_id, 'updated_at', now());
  if jsonb_typeof(p_application->'audit_log') = 'array' and jsonb_array_length(p_application->'audit_log') > 0 then
    -- The review's own audit entry (the last one) records the ids actually written.
    v_values := v_values || jsonb_build_object('audit_log', jsonb_set(
      p_application->'audit_log',
      array[(jsonb_array_length(p_application->'audit_log') - 1)::text, 'new_values'],
      coalesce(p_application->'audit_log'->-1->'new_values', '{}'::jsonb) || jsonb_build_object(
        'customer_site_id', v_site_id, 'metering_point_id', v_mp_id, 'contract_id', v_contract_id)));
  end if;
  if jsonb_typeof(p_application->'response_payload') = 'object' then
    -- The API status response carries the same ids the application row does.
    v_values := v_values || jsonb_build_object('response_payload',
      (p_application->'response_payload') || jsonb_build_object(
        'customer_site_id', v_site_id, 'metering_point_id', v_mp_id, 'contract_id', v_contract_id));
  end if;
  perform public.gridex_internal_write_tenant_row_v1(
    'public.website_customer_applications', p_company_id, v_app.id, v_values,
    array['status','payload','response_payload','customer_site_id','metering_point_id','contract_id','missing_fields',
          'blocking_reasons','next_step','requested_start_date','confirmed_start_date','actual_start_date',
          'requested_start_mode','calculated_earliest_start_date','grid_area_code','price_area_code','resolution_status',
          'facility_data_verified_at','warnings','timeline','audit_log','assigned_to','admin_note','updated_at']);

  return jsonb_build_object(
    'ok', true,
    'application_id', v_app.id,
    'customer_site_id', v_site_id,
    'metering_point_id', v_mp_id,
    'contract_id', v_contract_id,
    'contract_created', v_contract_created);
end;
$function$;

revoke all on function public.gridex_save_website_application_review_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.gridex_save_website_application_review_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
