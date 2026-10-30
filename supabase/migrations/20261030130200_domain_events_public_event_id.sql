-- Finding 20261029-3f1a8ab1/claude-track5/003.
--
-- Webhook and event-feed payloads exposed event_id as
-- 'event_' || sha256(tenant/company : domain_event.id)[:32]: a deterministic,
-- unsalted derivation of internal identifiers (lib/integrations/webhooks.ts
-- opaqueReference, and private.gridex_emit_partner_resource_event_v2 below).
-- Every new domain event now gets a random opaque reference, generated once by
-- the database and stored on the event, so all deliveries of the event, all of
-- their retries and GET /api/v1/events carry the same value. Existing events are
-- not backfilled: references that were already delivered stay as they were.

alter table public.domain_events add column if not exists public_event_id text;

-- Default only for rows inserted from now on (set separately from ADD COLUMN so
-- existing rows are not rewritten with new values).
alter table public.domain_events
  alter column public_event_id set default ('event_' || encode(extensions.gen_random_bytes(16), 'hex'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.domain_events'::regclass
      and conname = 'domain_events_public_event_id_format_check'
  ) then
    alter table public.domain_events
      add constraint domain_events_public_event_id_format_check
      check (public_event_id is null or public_event_id ~ '^event_[a-f0-9]{32}$');
  end if;
end
$$;

create unique index if not exists domain_events_public_event_id_uidx
  on public.domain_events(public_event_id)
  where public_event_id is not null;

-- Same function as 20260816170000, except that the public reference is read from
-- the stored column instead of being derived.
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

  -- Random opaque reference stored on the event (20261030130200). Events that
  -- predate the column keep the reference they were already delivered with.
  select coalesce(
      e.public_event_id,
      'event_' || substr(
        encode(
          extensions.digest(convert_to(p_company_id::text || ':' || v_event_id::text, 'utf8'), 'sha256'),
          'hex'
        ),
        1,
        32
      )
    )
  into v_public_event_id
  from public.domain_events e
  where e.id = v_event_id;

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
