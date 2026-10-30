-- Finding 20261029-3f1a8ab1/claude-track5/006.
--
-- lib/staff-api/userHandlers.ts claims the customer-portal write ledger with
-- customer_id = NULL for staff-user invites and access changes. Invites used the
-- constant route '/api/v1/staff/users'; role change, disable and enable used
-- routes with the target user id embedded ('/api/v1/staff/users/<uuid>...'), so
-- no fixed allow-list could cover them and every such write failed (23502 before
-- 20261030130100, 23514 after it).
--
-- The handlers now record the public route templates from
-- lib/api/publicRouteRegistry.ts and carry the target user id in the hashed
-- payload, so a reused Idempotency-Key against another user is a 409 conflict
-- and a replay for the same user returns the stored response. This migration
-- adds exactly those four server-constant templates to the allow-list of
-- 20261030130100; every other route still requires a customer.

alter table public.customer_portal_write_idempotency
  drop constraint if exists customer_portal_write_idempotency_customer_required_check;

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
      '/api/v1/customer-portal/sync',
      '/api/v1/staff/users',
      '/api/v1/staff/users/[id]',
      '/api/v1/staff/users/[id]/disable',
      '/api/v1/staff/users/[id]/enable'
    )
  )
  not valid;

-- The new list is a superset of the previous one, so existing rows already
-- satisfy it; validation is a scan only.
alter table public.customer_portal_write_idempotency
  validate constraint customer_portal_write_idempotency_customer_required_check;
