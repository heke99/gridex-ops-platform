-- Website API/webhook contract hardening.
-- Additive only: keeps existing event statuses and historical payloads intact.

create extension if not exists pgcrypto;

-- API profile/scope backfill for clients created before website_applications.write became canonical.
do $$
begin
  if to_regclass('public.integration_api_clients') is not null then
    update public.integration_api_clients
       set scopes = (
         select array_agg(distinct case
           when scope_value = 'customer_applications.write' then 'website_applications.write'
           when scope_value = 'events.write' then 'website_events.write'
           else scope_value
         end)
         from unnest(scopes) as scope_value
       ),
       updated_at = now()
     where scopes && array['customer_applications.write','events.write'];
  end if;
end $$;

-- Webhook delivery hardening: snapshot target URL and claim locks prevent duplicate sends.
do $$
begin
  if to_regclass('public.webhook_deliveries') is not null then
    alter table public.webhook_deliveries
      add column if not exists target_url text,
      add column if not exists locked_at timestamptz,
      add column if not exists locked_by text;

    if to_regclass('public.webhook_subscriptions') is not null then
      update public.webhook_deliveries d
         set target_url = s.endpoint_url,
             updated_at = now()
        from public.webhook_subscriptions s
       where d.webhook_subscription_id = s.id
         and d.target_url is null;
    end if;

    create index if not exists webhook_deliveries_due_claim_idx
      on public.webhook_deliveries(status, next_attempt_at, created_at)
      where status in ('queued','failed');

    create index if not exists webhook_deliveries_company_event_idx
      on public.webhook_deliveries(company_id, event_type, created_at desc);

    create index if not exists webhook_deliveries_event_idx
      on public.webhook_deliveries(company_id, domain_event_id);

    update public.webhook_deliveries
       set status = 'failed',
           locked_at = null,
           locked_by = null,
           failure_reason = coalesce(failure_reason, 'Webhook delivery lock expired.'),
           next_attempt_at = now(),
           updated_at = now()
     where status = 'processing'
       and locked_at < now() - interval '15 minutes';

    comment on column public.webhook_deliveries.target_url is 'Webhook endpoint URL snapshot at enqueue/send time so delivery history remains accurate after subscription URL changes.';
    comment on column public.webhook_deliveries.locked_at is 'Server-side claim timestamp used to prevent concurrent webhook dispatchers from sending the same delivery twice.';
    comment on column public.webhook_deliveries.locked_by is 'Opaque dispatcher batch id that claimed the delivery.';
  end if;

  if to_regclass('public.webhook_subscriptions') is not null then
    create index if not exists webhook_subscriptions_company_active_idx
      on public.webhook_subscriptions(company_id, status, created_at desc)
      where status = 'active';
  end if;
end $$;

-- Public contract and API-client performance indexes. Guarded for environments that have not run all prior migrations.
do $$
begin
  if to_regclass('public.public_contract_offers') is not null then
    create index if not exists public_contract_offers_company_public_idx
      on public.public_contract_offers(company_id, publication_status, website_enabled, sort_order)
      where coalesce(is_archived, false) = false;
  end if;

  if to_regclass('public.integration_api_clients') is not null then
    create index if not exists integration_api_clients_company_active_scopes_idx
      on public.integration_api_clients(company_id, status)
      where status = 'active';
  end if;
end $$;
