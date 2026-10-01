\set ON_ERROR_STOP on
do $upgrade$
declare customer public.customers%rowtype; copied public.customer_contracts%rowtype;
 inherited public.customer_contracts%rowtype;
begin
 select * into strict customer from public.customers where id='e4954930-0000-4000-8000-000000000031';
 select * into strict copied from public.customer_contracts where id='e4954930-0000-4000-8000-000000000051';
 select * into strict inherited from public.customer_contracts where id='e4954930-0000-4000-8000-000000000052';
 if (select count(*) from information_schema.columns where table_schema='public'
   and table_name='customers' and is_nullable='YES' and
   ((column_name='moved_out_at' and data_type='date')
    or (column_name='lifecycle_closed_at' and data_type='timestamp with time zone')
    or (column_name='lifecycle_closed_by' and data_type='uuid')
    or (column_name='lifecycle_status_reason' and data_type='text'))) <> 4
  or customer.moved_out_at is not null or customer.lifecycle_closed_at is not null
  or customer.lifecycle_closed_by is not null or customer.lifecycle_status_reason is not null then
  raise exception 'upgrade_historical_lifecycle_prerequisites_missing_or_closure_fabricated';
 end if;
 if customer.company_id <> 'e4954930-0000-4000-8000-000000000001'::uuid
  or customer.email is distinct from 'contact-only@example.invalid'
  or customer.invoice_email is not null or customer.billing_profile ? 'email'
  or customer.billing_profile ? 'distributionMethod'
  or customer.billing_profile->>'country' is distinct from 'NO'
  or customer.billing_country is distinct from 'NO'
  or customer.billing_profile->>'street' is distinct from 'Synthetic Norway Street'
  or customer.billing_profile_revision <> 0 or customer.profile_revision <> 0
  or customer.legal_profile_revision <> 0 or customer.lifecycle_revision <> 0
  or customer.address_book_revision <> 0 then
  raise exception 'upgrade_existing_customer_country_channel_contact_or_revision_changed';
 end if;
 if (select billing_settings#>>'{invoice_profile,distribution_method}' from public.companies
    where id=customer.company_id) is distinct from 'paper' then
  raise exception 'upgrade_existing_tenant_delivery_configuration_changed'; end if;
 if copied.customer_id is distinct from customer.id or copied.company_id is distinct from customer.company_id
  or copied.customer_site_id <> 'e4954930-0000-4000-8000-000000000043'::uuid
  or copied.invoice_email is distinct from 'agency-invoice@example.invalid'
  or copied.billing_profile_override->>'email' is distinct from 'agency-invoice@example.invalid'
  or copied.billing_profile_override->>'country' is distinct from customer.billing_profile->>'country'
  or not (copied.billing_profile_override ? 'country')
  or copied.billing_profile_override->>'street' is distinct from customer.billing_profile->>'street'
  or not (copied.billing_profile_override ? 'street')
  or copied.billing_profile_override_revision <> 0
  or inherited.billing_profile_override <> '{}'::jsonb then
  raise exception 'upgrade_explicit_equal_contract_copy_or_inherited_fields_lost'; end if;
 if not exists(select 1 from public.customer_contacts where id='e4954930-0000-4000-8000-000000000041'
    and company_id=customer.company_id and customer_id=customer.id and email=customer.email)
  or not exists(select 1 from public.customer_addresses where id='e4954930-0000-4000-8000-000000000042'
    and company_id=customer.company_id and customer_id=customer.id and country='NO')
  or not exists(select 1 from public.customer_sites where id='e4954930-0000-4000-8000-000000000043'
    and company_id=customer.company_id and customer_id=customer.id and country='SE' and address_revision=0)
  or not exists(select 1 from public.customer_invoices where id='e4954930-0000-4000-8000-000000000071'
    and company_id=customer.company_id and customer_id=customer.id and status='issued')
  or not exists(select 1 from public.customer_invoice_documents where id='e4954930-0000-4000-8000-000000000072'
    and invoice_id='e4954930-0000-4000-8000-000000000071') then
  raise exception 'upgrade_existing_customer_contract_invoice_document_relationship_lost'; end if;
end;
$upgrade$;
\echo TENANTSERVICE_UPGRADE_LEGACY_BILLING_COUNTRY_CHANNEL_CONTACT_SEPARATION_PASS
\echo TENANTSERVICE_UPGRADE_EXPLICIT_EQUAL_COPIES_AND_RELATIONSHIPS_PASS
\echo TENANTSERVICE_UPGRADE_HISTORICAL_LIFECYCLE_PREREQUISITES_PASS
