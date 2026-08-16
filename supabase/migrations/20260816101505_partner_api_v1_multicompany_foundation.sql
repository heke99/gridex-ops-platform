-- Gridex Partner API v1: repeatable multi-company external integration foundation.
-- Additive only: public opaque references, API offer resolver, Vault-backed webhook
-- subscription lifecycle, and transactional contract events.

alter table public.customers
  add column if not exists customer_reference text;

update public.customers
set customer_reference = public.gridex_new_public_resource_reference('customer')
where customer_reference is null or btrim(customer_reference) = '';

alter table public.customers
  alter column customer_reference set default public.gridex_new_public_resource_reference('customer'),
  alter column customer_reference set not null;

create unique index if not exists uq_customers_company_customer_reference
  on public.customers(company_id, customer_reference);

alter table public.powers_of_attorney
  add column if not exists power_of_attorney_reference text;

update public.powers_of_attorney
set power_of_attorney_reference = public.gridex_new_public_resource_reference('poa')
where power_of_attorney_reference is null or btrim(power_of_attorney_reference) = '';

alter table public.powers_of_attorney
  alter column power_of_attorney_reference set default public.gridex_new_public_resource_reference('poa'),
  alter column power_of_attorney_reference set not null;

create unique index if not exists uq_powers_of_attorney_company_reference
  on public.powers_of_attorney(company_id, power_of_attorney_reference);

alter table public.webhook_subscriptions
  add column if not exists webhook_subscription_reference text;

update public.webhook_subscriptions
set webhook_subscription_reference = public.gridex_new_public_resource_reference('webhook')
where webhook_subscription_reference is null or btrim(webhook_subscription_reference) = '';

alter table public.webhook_subscriptions
  alter column webhook_subscription_reference set default public.gridex_new_public_resource_reference('webhook'),
  alter column webhook_subscription_reference set not null;

create unique index if not exists uq_webhook_subscriptions_company_reference
  on public.webhook_subscriptions(company_id, webhook_subscription_reference);

create index if not exists idx_customer_contracts_company_public_reference
  on public.customer_contracts(company_id, customer_contract_reference);

create index if not exists idx_customer_sites_company_public_reference
  on public.customer_sites(company_id, facility_reference);

create index if not exists idx_customer_invoices_company_public_reference
  on public.customer_invoices(company_id, invoice_reference);

create index if not exists idx_metering_company_site_period
  on public.normalized_metering_values(company_id, customer_site_id, period_start desc, id);

-- Canonical API publications do not have to carry the legacy website
-- public_contract_offer_id. Bind directly to the immutable publication version
-- when it is supplied by a trusted server-side channel.
create or replace function public.gridex_bind_customer_contract_to_exact_publication()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v public.contract_publication_versions;
  pv public.contract_product_versions;
begin
  if new.contract_publication_version_id is not null then
    select cpv.*
    into v
    from public.contract_publication_versions cpv
    join public.contract_publications publication
      on publication.id = cpv.contract_publication_id
    join public.tenant_contract_assignments assignment
      on assignment.id = publication.assignment_id
    where cpv.id = new.contract_publication_version_id
      and assignment.company_id = new.company_id
      and assignment.status = 'active'
      and cpv.status = 'published'
      and cpv.locked_at is not null
      and (new.offer_reference is null or new.offer_reference = cpv.offer_reference)
    limit 1;
  elsif new.public_contract_offer_id is not null or new.offer_reference is not null then
    select cpv.*
    into v
    from public.contract_publication_versions cpv
    where cpv.offer_reference = new.offer_reference
      and cpv.legacy_public_contract_offer_id = new.public_contract_offer_id
      and cpv.status = 'published'
      and cpv.locked_at is not null
      and exists (
        select 1
        from public.public_contract_offers offer
        where offer.id = cpv.legacy_public_contract_offer_id
          and offer.company_id = new.company_id
      )
    limit 1;
  else
    return new;
  end if;

  if not found then
    raise exception using errcode='23514', message='exact_published_contract_version_required';
  end if;

  select *
  into pv
  from public.contract_product_versions
  where id = v.contract_product_version_id
    and locked_at is not null
    and status = 'approved';
  if not found then
    raise exception using errcode='23514', message='exact_approved_contract_product_version_required';
  end if;

  new.offer_reference := v.offer_reference;
  new.contract_publication_version_id := v.id;
  new.contract_product_version_id := pv.id;
  new.contract_product_id := pv.contract_product_id;
  new.legal_bundle_version_id := v.legal_bundle_version_id;
  new.price_plan_id := v.price_plan_id;
  new.price_plan_version_id := v.price_plan_version_id;
  new.price_book_id := v.price_book_id;
  new.commercial_snapshot := coalesce(
    v.publication_snapshot->'commercial_snapshot',
    pv.commercial_snapshot,
    '{}'::jsonb
  );
  new.legal_snapshot := coalesce(
    v.publication_snapshot->'legal_snapshot',
    (select rendered_snapshot from public.legal_bundle_versions where id = v.legal_bundle_version_id),
    '{}'::jsonb
  );
  return new;
end
$function$;

create or replace function public.gridex_resolve_partner_api_offer_v1(
  p_company_id uuid,
  p_offer_reference text,
  p_customer_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_result jsonb;
  v_customer_type text := nullif(lower(btrim(coalesce(p_customer_type, ''))), '');
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='partner_api_service_role_required';
  end if;
  if p_company_id is null or nullif(btrim(p_offer_reference), '') is null then
    raise exception using errcode='22023', message='partner_api_offer_reference_required';
  end if;
  if v_customer_type is not null and v_customer_type not in ('private','business','association') then
    raise exception using errcode='22023', message='partner_api_customer_type_invalid';
  end if;

  select jsonb_build_object(
    'offer_reference', pv.offer_reference,
    'publication_version_id', pv.id,
    'contract_product_id', product_version.contract_product_id,
    'contract_product_version_id', pv.contract_product_version_id,
    'price_plan_id', pv.price_plan_id,
    'price_plan_version_id', pv.price_plan_version_id,
    'price_book_id', pv.price_book_id,
    'legal_bundle_version_id', pv.legal_bundle_version_id,
    'energy_direction', coalesce(nullif(pv.energy_direction,''), nullif(product_version.energy_direction,''), 'consumption'),
    'contract_type', product_version.contract_type,
    'customer_type', pv.customer_type,
    'commercial_snapshot', coalesce(pv.publication_snapshot->'commercial_snapshot','{}'::jsonb),
    'legal_snapshot', coalesce(pv.publication_snapshot->'legal_snapshot','{}'::jsonb),
    'price_options', coalesce(pv.publication_snapshot->'price_options','[]'::jsonb),
    'publication_snapshot', pv.publication_snapshot
  )
  into v_result
  from public.contract_publication_versions pv
  join public.contract_publications publication
    on publication.id = pv.contract_publication_id
  join public.tenant_contract_assignments assignment
    on assignment.id = publication.assignment_id
  join public.tenant_contract_channels channel_row
    on channel_row.assignment_id = assignment.id
   and channel_row.channel = 'api'
  join public.contract_product_versions product_version
    on product_version.id = pv.contract_product_version_id
  join public.companies company
    on company.id = assignment.company_id
  where assignment.company_id = p_company_id
    and pv.offer_reference = btrim(p_offer_reference)
    and company.status = 'active'
    and nullif(btrim(company.external_tenant_reference),'') is not null
    and assignment.status = 'active'
    and assignment.api_publication_allowed
    and publication.channel = 'api'
    and publication.status = 'published'
    and pv.channel = 'api'
    and pv.status = 'published'
    and pv.locked_at is not null
    and pv.legal_bundle_version_id is not null
    and public.gridex_publication_legal_snapshot_json_v1(
      assignment.company_id, pv.legal_bundle_version_id
    ) is not null
    and pv.content_sha256 = encode(
      extensions.digest(pv.publication_snapshot::text,'sha256'),'hex'
    )
    and jsonb_array_length(coalesce(pv.publication_snapshot->'price_options','[]'::jsonb)) > 0
    and channel_row.status = 'active'
    and (assignment.valid_from is null or assignment.valid_from <= (now() at time zone 'Europe/Stockholm')::date)
    and (assignment.valid_to is null or assignment.valid_to >= (now() at time zone 'Europe/Stockholm')::date)
    and (channel_row.valid_from is null or channel_row.valid_from <= now())
    and (channel_row.valid_to is null or channel_row.valid_to > now())
    and (pv.valid_from is null or pv.valid_from <= now())
    and (pv.valid_to is null or pv.valid_to > now())
    and (v_customer_type is null or pv.customer_type = 'both' or pv.customer_type = v_customer_type)
    and exists (
      select 1
      from public.canonical_public_contract_diagnostics_v diagnostic
      where diagnostic.publication_version_id = pv.id
        and diagnostic.channel = 'api'
        and diagnostic.visible
        and diagnostic.snapshot_source_contract_offer_id = diagnostic.source_contract_offer_id::text
    )
  order by pv.published_at desc nulls last, pv.created_at desc
  limit 1;

  if v_result is null then
    raise exception using errcode='P0002', message='partner_api_offer_not_found';
  end if;
  return v_result;
end
$function$;

revoke all on function public.gridex_resolve_partner_api_offer_v1(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.gridex_resolve_partner_api_offer_v1(uuid,text,text)
  to service_role;

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
      'contract.created',
      'contract.status_changed',
      'invoice.created',
      'invoice.sent',
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
    'id', v_row.webhook_subscription_reference,
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

create or replace function public.gridex_read_webhook_signing_secret_v1(
  p_company_id uuid,
  p_subscription_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = 'public', 'vault', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_secret text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='partner_api_service_role_required';
  end if;

  select secret.decrypted_secret
  into v_secret
  from public.webhook_subscriptions subscription
  join vault.decrypted_secrets secret
    on secret.id::text = subscription.signing_secret_ref
  where subscription.id = p_subscription_id
    and subscription.company_id = p_company_id
    and subscription.status = 'active'
  limit 1;

  return v_secret;
end
$function$;

revoke all on function public.gridex_read_webhook_signing_secret_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.gridex_read_webhook_signing_secret_v1(uuid,uuid)
  to service_role;

create or replace function public.gridex_delete_partner_webhook_subscription_v1(
  p_company_id uuid,
  p_api_client_id uuid,
  p_subscription_reference text
)
returns boolean
language plpgsql
security definer
set search_path = 'public', 'vault', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_subscription public.webhook_subscriptions%rowtype;
  v_secret_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='partner_api_service_role_required';
  end if;

  select *
  into v_subscription
  from public.webhook_subscriptions
  where company_id = p_company_id
    and api_client_id = p_api_client_id
    and webhook_subscription_reference = btrim(p_subscription_reference)
  for update;

  if not found then
    return false;
  end if;

  begin
    v_secret_id := nullif(v_subscription.signing_secret_ref,'')::uuid;
  exception when invalid_text_representation then
    v_secret_id := null;
  end;

  delete from public.webhook_subscriptions
  where id = v_subscription.id
    and company_id = p_company_id
    and api_client_id = p_api_client_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
  return true;
end
$function$;

revoke all on function public.gridex_delete_partner_webhook_subscription_v1(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.gridex_delete_partner_webhook_subscription_v1(uuid,uuid,text)
  to service_role;

create or replace function public.gridex_partner_contract_event_v1()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_event_id uuid;
  v_event_type text;
  v_event_key text;
  v_payload jsonb;
begin
  if coalesce(new.metadata->>'source_channel','') <> 'partner_api' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_event_type := 'contract.created';
    v_event_key := 'partner-contract-created:' || new.id::text;
    v_payload := jsonb_build_object(
      'contract_reference', new.customer_contract_reference,
      'customer_number', new.customer_number,
      'offer_reference', new.offer_reference,
      'status', new.status
    );
  elsif new.status is distinct from old.status then
    v_event_type := 'contract.status_changed';
    v_event_key := 'partner-contract-status:' || new.id::text || ':' || new.status || ':' || coalesce(new.updated_at::text, now()::text);
    v_payload := jsonb_build_object(
      'contract_reference', new.customer_contract_reference,
      'customer_number', new.customer_number,
      'offer_reference', new.offer_reference,
      'status', new.status,
      'previous_status', old.status
    );
  else
    return new;
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
    new.company_id,
    v_event_type,
    'contract',
    new.id::text,
    new.customer_id,
    'partner_api_contract_trigger',
    v_event_key,
    v_payload
  )
  on conflict do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select id into v_event_id
    from public.domain_events
    where company_id = new.company_id
      and idempotency_key = v_event_key
    order by created_at desc
    limit 1;
  end if;

  if v_event_id is not null then
    insert into public.event_outbox(
      company_id,
      domain_event_id,
      destination_type,
      destination_key,
      status,
      attempts,
      max_attempts,
      available_at,
      payload
    ) values (
      new.company_id,
      v_event_id,
      'webhook',
      'webhook_fanout_v1',
      'queued',
      0,
      12,
      now(),
      jsonb_build_object(
        'event_type', v_event_type,
        'aggregate_type', 'contract',
        'aggregate_id', new.id::text
      )
    )
    on conflict do nothing;
  end if;
  return new;
end
$function$;

drop trigger if exists customer_contracts_partner_api_events_v1
  on public.customer_contracts;
create trigger customer_contracts_partner_api_events_v1
after insert or update of status on public.customer_contracts
for each row execute function public.gridex_partner_contract_event_v1();

revoke all on function public.gridex_partner_contract_event_v1()
  from public, anon, authenticated;
