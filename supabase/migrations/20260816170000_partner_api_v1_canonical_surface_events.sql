begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local search_path = public, private, vault, extensions, pg_catalog;

-- Partner API v1.2 keeps webhook subscriptions server-managed and allows only
-- business-resource events documented by the canonical external API.
create or replace function public.gridex_create_partner_webhook_subscription_v1(
  p_company_id uuid,
  p_api_client_id uuid,
  p_name text,
  p_endpoint_url text,
  p_event_types text[],
  p_secret text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'vault', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_secret_id uuid;
  v_row public.webhook_subscriptions%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='partner_api_service_role_required';
  end if;
  if p_company_id is null or p_api_client_id is null then
    raise exception using errcode='22023', message='partner_api_webhook_identity_required';
  end if;
  if not exists (
    select 1 from public.integration_api_clients c
    where c.id = p_api_client_id and c.company_id = p_company_id and c.status = 'active'
  ) then
    raise exception using errcode='42501', message='partner_api_client_not_active_for_company';
  end if;
  if nullif(btrim(p_name),'') is null then
    raise exception using errcode='22023', message='partner_api_webhook_name_required';
  end if;
  if p_endpoint_url !~ '^https://[^[:space:]]+$' then
    raise exception using errcode='22023', message='partner_api_webhook_https_required';
  end if;
  if coalesce(cardinality(p_event_types),0) = 0 then
    raise exception using errcode='22023', message='partner_api_webhook_event_types_required';
  end if;
  if exists (
    select 1
    from unnest(p_event_types) event_type
    where event_type not in (
      'customer.created',
      'customer.updated',
      'site.created',
      'site.updated',
      'power_of_attorney.created',
      'contract.created',
      'contract.status_changed',
      'invoice.created',
      'invoice.updated',
      -- retained compatibility event for existing Partner API subscriptions
      'metering_values.updated'
    )
  ) then
    raise exception using errcode='22023', message='partner_api_webhook_event_type_invalid';
  end if;
  if nullif(p_secret,'') is null or char_length(p_secret) < 32 then
    raise exception using errcode='22023', message='partner_api_webhook_secret_too_short';
  end if;

  select vault.create_secret(
    p_secret,
    'gridex_webhook_' || replace(gen_random_uuid()::text,'-',''),
    'Gridex Partner API webhook signing secret'
  ) into v_secret_id;

  insert into public.webhook_subscriptions(
    company_id,
    api_client_id,
    name,
    description,
    endpoint_url,
    event_types,
    status,
    signing_algorithm,
    signing_secret_ref,
    signing_secret_hash,
    custom_headers,
    timeout_ms,
    max_attempts,
    metadata
  ) values (
    p_company_id,
    p_api_client_id,
    btrim(p_name),
    nullif(btrim(coalesce(p_description,'')),''),
    btrim(p_endpoint_url),
    p_event_types,
    'active',
    'HMAC-SHA256',
    v_secret_id::text,
    encode(extensions.digest(convert_to(p_secret,'utf8'),'sha256'),'hex'),
    '{}'::jsonb,
    10000,
    8,
    jsonb_build_object('source','partner_api','secret_store','supabase_vault')
  )
  returning * into v_row;

  return jsonb_build_object(
    'webhook_subscription_reference', v_row.webhook_subscription_reference,
    'name', v_row.name,
    'endpoint_url', v_row.endpoint_url,
    'event_types', to_jsonb(v_row.event_types),
    'status', v_row.status,
    'created_at', v_row.created_at
  );
exception
  when others then
    if v_secret_id is not null and not exists (
      select 1 from public.webhook_subscriptions
      where signing_secret_ref = v_secret_id::text
    ) then
      delete from vault.secrets where id = v_secret_id;
    end if;
    raise;
end
$function$;

revoke all on function public.gridex_create_partner_webhook_subscription_v1(uuid,uuid,text,text,text[],text,text)
  from public, anon, authenticated;
grant execute on function public.gridex_create_partner_webhook_subscription_v1(uuid,uuid,text,text,text[],text,text)
  to service_role;

create or replace function private.gridex_emit_partner_resource_event_v2(
  p_company_id uuid,
  p_customer_id uuid,
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_reference text,
  p_data jsonb,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = 'public', 'private', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_event_id uuid;
  v_tenant_reference text;
  v_customer_reference text;
  v_customer_number text;
  v_public_event_id text;
  v_public_payload jsonb;
begin
  if p_company_id is null
     or p_customer_id is null
     or nullif(btrim(coalesce(p_event_type,'')),'') is null
     or nullif(btrim(coalesce(p_aggregate_reference,'')),'') is null
     or nullif(btrim(coalesce(p_idempotency_key,'')),'') is null
  then
    return;
  end if;

  select c.external_tenant_reference
  into v_tenant_reference
  from public.companies c
  where c.id = p_company_id
  limit 1;

  select customer_reference, customer_number
  into v_customer_reference, v_customer_number
  from public.customers
  where id = p_customer_id and company_id = p_company_id
  limit 1;

  if nullif(btrim(coalesce(v_tenant_reference,'')),'') is null
     or nullif(btrim(coalesce(v_customer_reference,'')),'') is null
  then
    return;
  end if;

  insert into public.domain_events(
    company_id,
    event_type,
    aggregate_type,
    aggregate_id,
    subject_customer_id,
    source,
    idempotency_key,
    payload
  ) values (
    p_company_id,
    p_event_type,
    p_aggregate_type,
    p_aggregate_reference,
    p_customer_id,
    'partner_api_resource_trigger_v2',
    p_idempotency_key,
    coalesce(p_data,'{}'::jsonb)
  )
  on conflict do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select id into v_event_id
    from public.domain_events
    where company_id = p_company_id
      and idempotency_key = p_idempotency_key
    order by created_at desc
    limit 1;
  end if;

  if v_event_id is null then
    return;
  end if;

  v_public_event_id :=
    'event_' || substr(
      encode(
        extensions.digest(convert_to(p_company_id::text || ':' || v_event_id::text, 'utf8'), 'sha256'),
        'hex'
      ),
      1,
      32
    );

  v_public_payload := jsonb_strip_nulls(jsonb_build_object(
    'event_id', v_public_event_id,
    'event_type', p_event_type,
    'created_at', now(),
    'tenant_reference', v_tenant_reference,
    'aggregate', jsonb_build_object(
      'type', p_aggregate_type,
      'reference', p_aggregate_reference
    ),
    'customer', jsonb_build_object(
      'customer_reference', v_customer_reference,
      'customer_number', v_customer_number
    ),
    'data', coalesce(p_data,'{}'::jsonb),
    'contract_schema_version', '2026-08-16.2'
  ));

  insert into public.webhook_deliveries(
    company_id,
    webhook_subscription_id,
    domain_event_id,
    event_type,
    status,
    attempts,
    max_attempts,
    next_attempt_at,
    target_url,
    idempotency_key,
    payload
  )
  select
    subscription.company_id,
    subscription.id,
    v_event_id,
    p_event_type,
    'queued',
    0,
    subscription.max_attempts,
    now(),
    subscription.endpoint_url,
    'webhook:' || subscription.id::text || ':' || v_event_id::text,
    v_public_payload
  from public.webhook_subscriptions subscription
  where subscription.company_id = p_company_id
    and subscription.status = 'active'
    and (
      subscription.event_types @> array[p_event_type]::text[]
      or subscription.event_types @> array['*']::text[]
    )
  on conflict (idempotency_key) do nothing;
end
$function$;

revoke all on function private.gridex_emit_partner_resource_event_v2(uuid,uuid,text,text,text,jsonb,text)
  from public, anon, authenticated;

create or replace function private.gridex_partner_customer_event_v2()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_event_type text;
begin
  if coalesce(new.metadata->>'source_channel','') <> 'partner_api' then
    return new;
  end if;
  v_event_type := case when tg_op='INSERT' then 'customer.created' else 'customer.updated' end;
  perform private.gridex_emit_partner_resource_event_v2(
    new.company_id,
    new.id,
    v_event_type,
    'customer',
    new.customer_reference,
    jsonb_build_object('status',new.status,'customer_reference',new.customer_reference,'customer_number',new.customer_number),
    'partner:' || v_event_type || ':' || new.id::text || ':' || coalesce(new.updated_at::text,new.created_at::text,now()::text)
  );
  return new;
end
$function$;

create or replace function private.gridex_partner_site_event_v2()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_event_type text;
begin
  if coalesce(new.metadata->>'source_channel','') <> 'partner_api' then
    return new;
  end if;
  v_event_type := case when tg_op='INSERT' then 'site.created' else 'site.updated' end;
  perform private.gridex_emit_partner_resource_event_v2(
    new.company_id,
    new.customer_id,
    v_event_type,
    'site',
    new.facility_reference,
    jsonb_build_object('status',new.status,'site_reference',new.facility_reference,'data_quality_status',new.data_quality_status),
    'partner:' || v_event_type || ':' || new.id::text || ':' || coalesce(new.updated_at::text,new.created_at::text,now()::text)
  );
  return new;
end
$function$;

create or replace function private.gridex_partner_poa_event_v2()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_catalog', 'pg_temp'
as $function$
begin
  if coalesce(new.metadata->>'source_channel',new.source,'') <> 'partner_api' then
    return new;
  end if;
  perform private.gridex_emit_partner_resource_event_v2(
    new.company_id,
    new.customer_id,
    'power_of_attorney.created',
    'power_of_attorney',
    new.power_of_attorney_reference,
    jsonb_build_object('status',new.status,'power_of_attorney_reference',new.power_of_attorney_reference,'scope',new.scope),
    'partner:power_of_attorney.created:' || new.id::text
  );
  return new;
end
$function$;

create or replace function private.gridex_partner_invoice_event_v2()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_event_type text;
begin
  if not exists (
    select 1
    from public.customers customer
    where customer.id = new.customer_id
      and customer.company_id = new.company_id
      and coalesce(customer.metadata->>'source_channel','') = 'partner_api'
  ) then
    return new;
  end if;
  v_event_type := case when tg_op='INSERT' then 'invoice.created' else 'invoice.updated' end;
  perform private.gridex_emit_partner_resource_event_v2(
    new.company_id,
    new.customer_id,
    v_event_type,
    'invoice',
    new.invoice_reference,
    jsonb_build_object('status',new.status,'invoice_reference',new.invoice_reference,'due_date',new.due_date),
    'partner:' || v_event_type || ':' || new.id::text || ':' || coalesce(new.updated_at::text,new.created_at::text,now()::text)
  );
  return new;
end
$function$;

-- Keep the existing public trigger function name because the trigger already
-- points to it, but route the payload through the canonical v1.2 event helper.
create or replace function public.gridex_partner_contract_event_v1()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_event_type text;
  v_data jsonb;
begin
  if coalesce(new.metadata->>'source_channel','') <> 'partner_api' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_event_type := 'contract.created';
    v_data := jsonb_build_object(
      'contract_reference',new.customer_contract_reference,
      'status',new.status,
      'offer_reference',new.offer_reference
    );
  elsif new.status is distinct from old.status then
    v_event_type := 'contract.status_changed';
    v_data := jsonb_build_object(
      'contract_reference',new.customer_contract_reference,
      'status',new.status,
      'previous_status',old.status,
      'offer_reference',new.offer_reference
    );
  else
    return new;
  end if;

  perform private.gridex_emit_partner_resource_event_v2(
    new.company_id,
    new.customer_id,
    v_event_type,
    'contract',
    new.customer_contract_reference,
    v_data,
    'partner:' || v_event_type || ':' || new.id::text || ':' || coalesce(new.updated_at::text,new.created_at::text,now()::text)
  );
  return new;
end
$function$;

revoke all on function public.gridex_partner_contract_event_v1()
  from public, anon, authenticated;

-- Resource triggers emit notifications only for Partner API-originated data.
drop trigger if exists customers_partner_api_events_v2 on public.customers;
create trigger customers_partner_api_events_v2
after insert or update of status,first_name,last_name,company_name,email,phone,billing_street,billing_postal_code,billing_city,billing_country
on public.customers
for each row execute function private.gridex_partner_customer_event_v2();

drop trigger if exists customer_sites_partner_api_events_v2 on public.customer_sites;
create trigger customer_sites_partner_api_events_v2
after insert or update of status,facility_id,site_name,site_type,street,postal_code,city,country,price_area_code,grid_area_code,annual_consumption_kwh,data_quality_status
on public.customer_sites
for each row execute function private.gridex_partner_site_event_v2();

drop trigger if exists powers_of_attorney_partner_api_events_v2 on public.powers_of_attorney;
create trigger powers_of_attorney_partner_api_events_v2
after insert on public.powers_of_attorney
for each row execute function private.gridex_partner_poa_event_v2();

drop trigger if exists customer_invoices_partner_api_events_v2 on public.customer_invoices;
create trigger customer_invoices_partner_api_events_v2
after insert or update of status,due_date,paid_at,amount_inc_vat
on public.customer_invoices
for each row execute function private.gridex_partner_invoice_event_v2();

comment on function private.gridex_emit_partner_resource_event_v2(uuid,uuid,text,text,text,jsonb,text) is
'Canonical Partner API event fanout. Emits tenant-scoped domain events and public-reference webhook payloads without exposing internal UUIDs.';

commit;
