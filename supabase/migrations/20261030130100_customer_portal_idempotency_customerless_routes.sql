-- Finding 20261029-3f1a8ab1/claude-track5/001.
--
-- 20260712100000:968 made customer_portal_write_idempotency.customer_id NOT NULL,
-- but the ledger is also the idempotency store for writes that run before a
-- customer exists: Partner API customer/contract/webhook creation and the
-- customer-portal identity sync. Their callers pass customer_id = NULL
-- (lib/partner-api/simple.ts, lib/partner-api/core.ts,
-- app/api/v1/customer-portal/sync/route.ts), so every such write failed with
-- 23502 and HTTP 500. Deduplication for those rows already exists in
-- customer_portal_write_idempotency_pre_resolution_uidx
-- (company_id, api_client_id, route, idempotency_key) WHERE customer_id IS NULL
-- (20260809180628), and lib/api/strictRequest.ts reads NULL rows explicitly.
--
-- Replace the blanket NOT NULL with an explicit allow-list: customer_id may be
-- NULL only for these seven server-constant routes. Every other route keeps the
-- customer requirement. Tenant binding is unchanged: the composite
-- (company_id, api_client_id) FK to integration_api_clients still applies.
-- RLS and grants are unchanged.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customer_portal_write_idempotency'::regclass
      and conname = 'customer_portal_write_idempotency_customer_required_check'
  ) then
    alter table public.customer_portal_write_idempotency
      add constraint customer_portal_write_idempotency_customer_required_check
      check (
        customer_id is not null
        or route in (
          '/api/partner/v1/customer',
          '/api/partner/v1/contract',
          '/api/partner/v1/webhook/subscription',
          '/api/partner/v1/customers',
          '/api/partner/v1/contracts',
          '/api/partner/v1/webhooks/subscriptions',
          '/api/v1/customer-portal/sync'
        )
      );
  end if;
end
$$;

alter table public.customer_portal_write_idempotency
  alter column customer_id drop not null;
