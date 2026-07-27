-- Close two remaining runtime bypasses:
-- 1. quote expiry and canonical identity are part of the immutable quote hash;
-- 2. contract events and their permitted status effects commit atomically.

begin;

alter table public.customer_contracts
  add column if not exists ended_at timestamptz,
  add column if not exists status_reason_code text;

alter table public.website_contract_quotes
  add column if not exists quote_hash_version text;

update public.website_contract_quotes
set quote_hash_version = 'v1_snapshot_only'
where quote_hash_version is null;

alter table public.website_contract_quotes
  alter column quote_hash_version set default 'v2_full_quote',
  alter column quote_hash_version set not null;
alter table public.website_contract_quotes
  drop constraint if exists website_contract_quotes_hash_version_check;
alter table public.website_contract_quotes
  add constraint website_contract_quotes_hash_version_check
  check (quote_hash_version in ('v1_snapshot_only', 'v2_full_quote'));

create or replace function public.gridex_reject_quote_snapshot_mutation()
returns trigger
language plpgsql
set search_path = public, extensions, pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.quote_hash_version <> 'v2_full_quote'
       or coalesce(new.quote_hash, '') !~ '^[0-9a-f]{64}$'
       or new.valid_until is null
       or new.valid_until <= new.created_at then
      raise exception using
        errcode = '23514',
        message = 'website_quote_v2_integrity_required';
    end if;
    return new;
  end if;

  if new.company_id is distinct from old.company_id
     or new.quote_reference is distinct from old.quote_reference
     or new.offer_reference is distinct from old.offer_reference
     or new.contract_product_id is distinct from old.contract_product_id
     or new.contract_product_version_id is distinct from old.contract_product_version_id
     or new.contract_publication_version_id is distinct from old.contract_publication_version_id
     or new.price_plan_id is distinct from old.price_plan_id
     or new.price_plan_version_id is distinct from old.price_plan_version_id
     or new.price_book_id is distinct from old.price_book_id
     or new.legal_bundle_version_id is distinct from old.legal_bundle_version_id
     or new.customer_type is distinct from old.customer_type
     or new.energy_direction is distinct from old.energy_direction
     or new.price_area is distinct from old.price_area
     or new.grid_area_code is distinct from old.grid_area_code
     or new.annual_consumption_kwh is distinct from old.annual_consumption_kwh
     or new.start_date is distinct from old.start_date
     or new.energy_resolution_id is distinct from old.energy_resolution_id
     or new.resolution_snapshot is distinct from old.resolution_snapshot
     or new.resolver_version is distinct from old.resolver_version
     or new.geodata_version is distinct from old.geodata_version
     or new.resolution_binding_status is distinct from old.resolution_binding_status
     or new.market_reference is distinct from old.market_reference
     or new.market_data_timestamp is distinct from old.market_data_timestamp
     or new.market_sources is distinct from old.market_sources
     or new.assumptions is distinct from old.assumptions
     or new.pricing_snapshot_schema_version is distinct from old.pricing_snapshot_schema_version
     or new.postal_code is distinct from old.postal_code
     or new.quote_snapshot is distinct from old.quote_snapshot
     or new.valid_until is distinct from old.valid_until
     or new.quote_hash is distinct from old.quote_hash
     or new.quote_hash_version is distinct from old.quote_hash_version then
    raise exception using
      errcode = '55000',
      message = 'website_quote_snapshot_immutable';
  end if;
  return new;
end
$$;

drop trigger if exists website_contract_quotes_snapshot_immutable
  on public.website_contract_quotes;
create trigger website_contract_quotes_snapshot_immutable
before insert or update on public.website_contract_quotes
for each row execute function public.gridex_reject_quote_snapshot_mutation();

create or replace function public.gridex_record_customer_contract_event_v1(
  p_company_id uuid,
  p_customer_contract_id uuid,
  p_customer_id uuid,
  p_event_type text,
  p_happened_at timestamptz default now(),
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_derived_ends_at timestamptz default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_contract public.customer_contracts%rowtype;
  v_event public.customer_contract_events%rowtype;
  v_previous_status text;
  v_new_status text;
  v_domain_event_id uuid;
  v_idempotency_key text := coalesce(
    nullif(btrim(p_idempotency_key), ''),
    encode(digest(
      concat_ws(
        ':',
        p_company_id,
        p_customer_contract_id,
        p_event_type,
        p_happened_at,
        coalesce(p_note, '')
      ),
      'sha256'
    ), 'hex')
  );
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'customer_contract_event_service_role_required';
  end if;
  if p_company_id is null
     or p_customer_contract_id is null
     or p_customer_id is null
     or p_event_type not in (
       'created', 'signature_requested', 'signed', 'activated', 'updated',
       'termination_notice_received', 'terminated', 'cancelled', 'note'
     ) then
    raise exception using
      errcode = '22023',
      message = 'customer_contract_event_payload_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_company_id::text || ':' || p_customer_contract_id::text, 0)
  );
  select *
  into v_contract
  from public.customer_contracts contract
  where contract.id = p_customer_contract_id
    and contract.company_id = p_company_id
    and contract.customer_id = p_customer_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'customer_contract_not_found_for_tenant';
  end if;

  select *
  into v_event
  from public.customer_contract_events event
  where event.company_id = p_company_id
    and event.customer_contract_id = p_customer_contract_id
    and event.metadata->>'idempotency_key' = v_idempotency_key
  order by event.created_at
  limit 1;
  if found then
    return jsonb_build_object(
      'event', to_jsonb(v_event),
      'contract_status', v_contract.status,
      'existing', true
    );
  end if;

  v_previous_status := v_contract.status;
  v_new_status := v_contract.status;

  if p_event_type = 'signed' then
    -- Only the canonical signature finalizer may transition a contract to
    -- signed. This event merely records that already-committed evidence.
    if v_contract.status <> 'signed'
       or v_contract.signed_at is null
       or v_contract.locked_at is null
       or nullif(v_contract.signature_snapshot_sha256, '') is null
       or v_contract.contract_publication_version_id is null
       or v_contract.contract_product_version_id is null
       or v_contract.legal_bundle_version_id is null
       or v_contract.contract_price_snapshot_id is null then
      raise exception using
        errcode = '23514',
        message = 'signed_event_requires_canonical_signature_evidence';
    end if;
  elsif p_event_type = 'activated' then
    -- Supply activation is a larger atomic graph and must use its dedicated
    -- command, which also writes the supply period and switch confirmation.
    raise exception using
      errcode = '23514',
      message = 'use_gridex_activate_customer_supply_v1';
  elsif p_event_type in ('terminated', 'cancelled') then
    v_new_status := case
      when p_event_type = 'terminated' then 'terminated'
      else 'cancelled'
    end;
    update public.customer_contracts
    set status = v_new_status,
        ended_at = coalesce(
          nullif(p_metadata->>'ended_at', '')::timestamptz,
          nullif(p_metadata->>'ends_at', '')::timestamptz,
          p_happened_at,
          ended_at
        ),
        termination_notice_date = coalesce(
          nullif(p_metadata->>'termination_notice_date', '')::timestamptz,
          termination_notice_date
        ),
        termination_reason = coalesce(
          nullif(p_metadata->>'termination_reason', ''),
          termination_reason
        ),
        withdrawal_requested_at = coalesce(
          nullif(p_metadata->>'withdrawal_requested_at', '')::timestamptz,
          withdrawal_requested_at
        ),
        rejected_reason = coalesce(
          nullif(p_metadata->>'rejected_reason', ''),
          rejected_reason
        ),
        status_reason_code = coalesce(
          nullif(p_metadata->>'reason_code', ''),
          status_reason_code,
          p_event_type
        ),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'status_reason_code',
            nullif(p_metadata->>'reason_code', '')
          ),
        updated_by = p_actor_user_id,
        updated_at = now()
    where id = p_customer_contract_id
      and company_id = p_company_id;
  elsif p_event_type = 'termination_notice_received' then
    update public.customer_contracts
    set termination_notice_date = p_happened_at,
        ended_at = coalesce(p_derived_ends_at, ended_at),
        updated_by = p_actor_user_id,
        updated_at = now()
    where id = p_customer_contract_id
      and company_id = p_company_id;
  end if;

  insert into public.customer_contract_events(
    company_id,
    customer_contract_id,
    customer_id,
    event_type,
    happened_at,
    note,
    metadata,
    actor_user_id
  ) values (
    p_company_id,
    p_customer_contract_id,
    p_customer_id,
    p_event_type,
    p_happened_at,
    p_note,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object('idempotency_key', v_idempotency_key),
    p_actor_user_id
  )
  returning * into v_event;

  insert into public.domain_events(
    company_id,
    event_type,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    source,
    idempotency_key,
    payload
  ) values (
    p_company_id,
    'contract.event.recorded',
    'customer_contract',
    p_customer_contract_id,
    p_actor_user_id,
    'gridex_record_customer_contract_event_v1',
    'customer-contract-event:' || v_idempotency_key,
    jsonb_build_object(
      'customer_contract_event_id', v_event.id,
      'customer_id', p_customer_id,
      'event_type', p_event_type,
      'previous_status', v_previous_status,
      'new_status', v_new_status
    )
  )
  on conflict do nothing
  returning id into v_domain_event_id;

  if v_domain_event_id is not null then
    insert into public.event_outbox(
      company_id,
      domain_event_id,
      destination_type,
      destination_key,
      payload
    ) values (
      p_company_id,
      v_domain_event_id,
      'webhook',
      'contract.event.recorded',
      jsonb_build_object(
        'domain_event_id', v_domain_event_id,
        'customer_contract_id', p_customer_contract_id,
        'event_type', p_event_type
      )
    ) on conflict do nothing;
  end if;

  return jsonb_build_object(
    'event', to_jsonb(v_event),
    'contract_status', v_new_status,
    'existing', false
  );
end
$$;

revoke all on function public.gridex_record_customer_contract_event_v1(
  uuid, uuid, uuid, text, timestamptz, text, jsonb, uuid, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.gridex_record_customer_contract_event_v1(
  uuid, uuid, uuid, text, timestamptz, text, jsonb, uuid, timestamptz, text
) to service_role;

comment on function public.gridex_record_customer_contract_event_v1(
  uuid, uuid, uuid, text, timestamptz, text, jsonb, uuid, timestamptz, text
) is
  'Atomic, tenant-scoped customer-contract event command. Signed events require pre-existing canonical evidence; activation is reserved for the supply activation graph.';

commit;
