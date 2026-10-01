\set ON_ERROR_STOP on
\set QUIET on
set time zone 'UTC';
-- Entire issued invoice/document rows and locked old billing configuration.
-- Only one digest leaves psql; no raw identities or document data are logged.
with evidence as (
 select jsonb_build_object(
  'invoice',(select to_jsonb(i) from public.customer_invoices i where id='e4954930-0000-4000-8000-000000000071'),
  'document',(select to_jsonb(d) from public.customer_invoice_documents d where id='e4954930-0000-4000-8000-000000000072'),
  'billingSnapshot',(select jsonb_build_array(billing_configuration_snapshot,
    billing_configuration_snapshot_sha256,billing_configuration_snapshotted_at)
    from public.billing_underlays where id='e4954930-0000-4000-8000-000000000061')) body
)
select encode(extensions.digest(body::text,'sha256'),'hex') from evidence;
