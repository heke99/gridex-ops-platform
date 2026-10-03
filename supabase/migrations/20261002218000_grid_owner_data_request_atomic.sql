-- Grid-owner data requests always belong to the tenant that owns the customer.
--
-- Before: two app helpers inserted grid_owner_data_requests directly. The one
-- used by the monthly metering autopilot never set company_id, so its rows had
-- no tenant, and the automation-key dedupe relied on a unique violation that no
-- index raised, so repeated runs could create duplicates.
-- After: gridex_create_grid_owner_data_request_v1 takes the tenant as a
-- parameter, proves the customer, site and metering point belong to it, and
-- dedupes on (company_id, automation_key) or operation scope under a lock.
-- company_id becomes NOT NULL and open automation keys are unique per tenant.

alter table public.grid_owner_data_requests alter column company_id set not null;

create unique index if not exists grid_owner_data_requests_open_automation_key_uidx
  on public.grid_owner_data_requests (company_id, automation_key)
  where automation_key is not null and status in ('pending', 'sent');

create or replace function public.gridex_create_grid_owner_data_request_v1(
  p_company_id uuid,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_customer_id uuid := nullif(p_request->>'customer_id', '')::uuid;
  v_site_id uuid := nullif(p_request->>'site_id', '')::uuid;
  v_point_id uuid := nullif(p_request->>'metering_point_id', '')::uuid;
  v_grid_owner_id uuid := nullif(p_request->>'grid_owner_id', '')::uuid;
  v_operation_id uuid := nullif(p_request->>'operation_id', '')::uuid;
  v_scope text := coalesce(nullif(p_request->>'request_scope', ''), 'customer_masterdata');
  v_key text := nullif(p_request->>'automation_key', '');
  v_existing public.grid_owner_data_requests%rowtype;
  v_row public.grid_owner_data_requests%rowtype;
  v_payload jsonb;
  v_columns text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'grid_owner_data_request_service_role_required';
  end if;
  if p_company_id is null or v_customer_id is null then
    raise exception using errcode = '22023', message = 'grid_owner_data_request_payload_invalid';
  end if;

  perform 1 from public.customers
  where id = v_customer_id and company_id = p_company_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_not_found_for_tenant';
  end if;
  if v_site_id is not null then
    perform 1 from public.customer_sites
    where id = v_site_id and company_id = p_company_id and customer_id = v_customer_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'site_not_found_for_customer';
    end if;
  end if;
  if v_point_id is not null then
    perform 1 from public.metering_points mp
    where mp.id = v_point_id
      and mp.company_id = p_company_id
      and (mp.customer_id = v_customer_id or mp.site_id = v_site_id
           or mp.site_id in (select s.id from public.customer_sites s
                             where s.customer_id = v_customer_id and s.company_id = p_company_id));
    if not found then
      raise exception using errcode = 'P0002', message = 'metering_point_not_found_for_customer';
    end if;
  end if;

  -- Serialise concurrent creates of the same logical request.
  if v_key is not null or v_operation_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'grid_owner_data_request:' || p_company_id::text || ':' || coalesce(v_key, v_operation_id::text || ':' || v_scope), 0));
  end if;

  if v_key is not null then
    select * into v_existing
    from public.grid_owner_data_requests
    where company_id = p_company_id and automation_key = v_key and status in ('pending', 'sent')
    order by created_at desc
    limit 1;
    if found then
      return jsonb_build_object('request', to_jsonb(v_existing), 'existing', true);
    end if;
  end if;

  if v_operation_id is not null then
    select * into v_existing
    from public.grid_owner_data_requests
    where company_id = p_company_id
      and operation_id = v_operation_id
      and customer_id = v_customer_id
      and request_scope = v_scope
      and site_id is not distinct from v_site_id
      and metering_point_id is not distinct from v_point_id
      and grid_owner_id is not distinct from v_grid_owner_id
    order by created_at desc
    limit 1;
    if found then
      return jsonb_build_object('request', to_jsonb(v_existing), 'existing', true);
    end if;
  end if;

  v_payload := (p_request - array['id', 'company_id', 'status', 'created_at', 'updated_at'])
    || jsonb_build_object('company_id', p_company_id, 'status', 'pending', 'request_scope', v_scope);
  select string_agg(quote_ident(key), ', ' order by key) into v_columns
  from jsonb_object_keys(v_payload) as key
  where key in (
    select attname from pg_attribute
    where attrelid = 'public.grid_owner_data_requests'::regclass and attnum > 0 and not attisdropped
  );
  execute format(
    'insert into public.grid_owner_data_requests (%1$s) select %1$s from jsonb_populate_record(null::public.grid_owner_data_requests, $1) returning *',
    v_columns
  ) into v_row using v_payload;

  return jsonb_build_object('request', to_jsonb(v_row), 'existing', false);
end
$function$;

revoke all on function public.gridex_create_grid_owner_data_request_v1(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.gridex_create_grid_owner_data_request_v1(uuid, jsonb) to service_role;
