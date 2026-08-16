-- Restore clean-replay parity for customer billing address fields required by
-- the canonical Partner API. These columns already exist in the live schema;
-- the migration is additive/idempotent so production application is a no-op
-- for existing columns while a fresh replay recreates the canonical shape.

alter table public.customers
  add column if not exists billing_street text,
  add column if not exists billing_postal_code text,
  add column if not exists billing_city text,
  add column if not exists billing_country text;

update public.customers
set billing_country = 'SE'
where billing_country is null;

alter table public.customers
  alter column billing_country set default 'SE',
  alter column billing_country set not null;

comment on column public.customers.billing_street is
'Canonical customer billing street used by Partner API and billing flows.';
comment on column public.customers.billing_postal_code is
'Canonical customer billing postal code used by Partner API and billing flows.';
comment on column public.customers.billing_city is
'Canonical customer billing city used by Partner API and billing flows.';
comment on column public.customers.billing_country is
'Canonical ISO country code for the customer billing address.';
