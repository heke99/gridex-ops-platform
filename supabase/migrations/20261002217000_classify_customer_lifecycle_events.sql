-- customer_lifecycle_events entered the canonical schema in
-- 20261002212000_atomic_customer_lifecycle_close.sql without a tenant
-- classification, which the F-6 invariant requires for every public table.
-- Only service_role holds privileges on it (anon/authenticated are revoked);
-- tenant scope is enforced by the SECURITY DEFINER lifecycle RPC that writes it.

insert into public.platform_table_classification (table_name, kind, rationale, classified_by)
values (
  'customer_lifecycle_events',
  'system',
  'Service-role only: written by gridex_close_customer_lifecycle_v1 with the tenant taken from its parameter; no client role holds any privilege.',
  'migration'
)
on conflict (table_name) do nothing;
