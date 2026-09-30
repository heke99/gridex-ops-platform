\set ON_ERROR_STOP on
-- Genuine BEFORE-upgrade schema fixture in the pinned ae56ee0a disposable
-- Supabase stack. Deterministic identities are synthetic example.invalid data.
-- Commit is intentional: candidate migrations upgrade these existing rows.
begin;
do $old_schema$
begin
  if exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='customers' and column_name in ('billing_profile','profile_revision','address_book_revision'))
    or to_regprocedure('public.gridex_change_customer_billing_profile_v1(jsonb)') is not null then
    raise exception 'upgrade_fixture_did_not_start_from_pinned_old_schema';
  end if;
end;
$old_schema$;
insert into public.companies(id,name,status,billing_settings) values
 ('e4954930-0000-4000-8000-000000000001','Synthetic upgrade tenant A','active',
  '{"invoice_profile":{"distribution_method":"paper"}}'),
 ('e4954930-0000-4000-8000-000000000002','Synthetic upgrade tenant B','active',
  '{"invoice_profile":{"distribution_method":"email"}}');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,
 raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
select id,'authenticated','authenticated',id::text||'@example.invalid',now(),
 '{}','{}',now(),now(),false,false
from unnest(array['e4954930-0000-4000-8000-000000000011'::uuid,
 'e4954930-0000-4000-8000-000000000012'::uuid]) id;
insert into public.user_profiles(id,email,full_name,user_status)
select id,id::text||'@example.invalid','Synthetic upgrade operator','active'
from unnest(array['e4954930-0000-4000-8000-000000000011'::uuid,
 'e4954930-0000-4000-8000-000000000012'::uuid]) id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values
 ('e4954930-0000-4000-8000-000000000021','e4954930-0000-4000-8000-000000000011',now(),now(),now()+interval '6 hours'),
 ('e4954930-0000-4000-8000-000000000022','e4954930-0000-4000-8000-000000000012',now(),now(),now()+interval '6 hours');
insert into public.company_memberships(company_id,user_id,membership_role,status,
 accepted_at,role,is_active,joined_at,role_key)
select 'e4954930-0000-4000-8000-000000000001',id,'operations','active',
 now(),'operations',true,now(),'operations'
from unnest(array['e4954930-0000-4000-8000-000000000011'::uuid,
 'e4954930-0000-4000-8000-000000000012'::uuid]) id;
insert into public.permissions(key,name) values
 ('masterdata.write','Synthetic upgrade masterdata permission') on conflict(key) do nothing;
insert into public.user_permissions(user_id,company_id,permission_id,permission_key,effect)
select actor.id,'e4954930-0000-4000-8000-000000000001',p.id,p.key,actor.effect
from (values('e4954930-0000-4000-8000-000000000011'::uuid,'allow'),
 ('e4954930-0000-4000-8000-000000000012'::uuid,'deny')) actor(id,effect)
cross join public.permissions p where p.key='masterdata.write';

-- The exact old schema has no customers.invoice_email. Do not synthesize a
-- column to claim upgrade coverage; old contact email must remain contact only.
insert into public.customers(id,company_id,customer_number,name,customer_type,
 first_name,last_name,full_name,email,phone,preferred_language,billing_street,
 billing_postal_code,billing_city,billing_country,metadata) values
 ('e4954930-0000-4000-8000-000000000031','e4954930-0000-4000-8000-000000000001',
  'SYNTHETIC-UPGRADE-A','Synthetic Norwegian Customer','private','Synthetic','Norwegian',
  'Synthetic Norwegian Customer','contact-only@example.invalid','+4600000000','sv',
  'Synthetic Norway Street','0123','Synthetic Norway City','NO','{}'),
 ('e4954930-0000-4000-8000-000000000032','e4954930-0000-4000-8000-000000000002',
  'SYNTHETIC-UPGRADE-B','Synthetic Foreign Customer','private','Synthetic','Foreign',
  'Synthetic Foreign Customer','foreign-contact@example.invalid','+4600000001','sv',
  null,null,null,'SE','{}');
insert into public.customer_contacts(id,company_id,customer_id,type,is_primary,name,email,phone) values
 ('e4954930-0000-4000-8000-000000000041','e4954930-0000-4000-8000-000000000001',
  'e4954930-0000-4000-8000-000000000031','primary',true,'Synthetic Contact','contact-only@example.invalid','+4600000000');
insert into public.customer_addresses(id,company_id,customer_id,type,street_1,postal_code,city,country) values
 ('e4954930-0000-4000-8000-000000000042','e4954930-0000-4000-8000-000000000001',
  'e4954930-0000-4000-8000-000000000031','billing','Synthetic Norway Street','0123','Synthetic Norway City','NO');
insert into public.customer_sites(id,company_id,customer_id,facility_reference,status,street,postal_code,city,country) values
 ('e4954930-0000-4000-8000-000000000043','e4954930-0000-4000-8000-000000000001',
  'e4954930-0000-4000-8000-000000000031','facility_synthetic_upgrade_a','draft',
  'Synthetic Facility Street','12345','Synthetic Facility City','SE');
insert into public.customer_contracts(id,company_id,customer_id,customer_site_id,status,
 invoice_recipient,invoice_email,invoice_reference,billing_street,billing_postal_code,billing_city,billing_country) values
 ('e4954930-0000-4000-8000-000000000051','e4954930-0000-4000-8000-000000000001',
  'e4954930-0000-4000-8000-000000000031','e4954930-0000-4000-8000-000000000043','draft',
  'Synthetic Agency','agency-invoice@example.invalid','Synthetic agency reference',
  'Synthetic Norway Street','0123','Synthetic Norway City','NO'),
 ('e4954930-0000-4000-8000-000000000052','e4954930-0000-4000-8000-000000000001',
  'e4954930-0000-4000-8000-000000000031','e4954930-0000-4000-8000-000000000043','draft',
  null,null,null,null,null,null,null);
insert into public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,
 underlay_year,underlay_month,status,billing_configuration_snapshot,
 billing_configuration_snapshot_sha256,billing_configuration_snapshotted_at) values
 ('e4954930-0000-4000-8000-000000000061','e4954930-0000-4000-8000-000000000001',
  'e4954930-0000-4000-8000-000000000031','e4954930-0000-4000-8000-000000000051',
  'e4954930-0000-4000-8000-000000000051',2026,8,'pending',
  '{"schema":"billing_configuration_v1","invoice_email":"issued-snapshot@example.invalid","country":"NO"}',
  encode(extensions.digest('{"schema":"billing_configuration_v1","invoice_email":"issued-snapshot@example.invalid","country":"NO"}','sha256'),'hex'),now());
insert into public.customer_invoices(id,company_id,customer_id,contract_id,customer_contract_id,
 billing_underlay_id,status,invoice_number,period_start,period_end,issued_at,due_date,
 amount_ex_vat,vat_amount,amount_inc_vat,calculation_snapshot,calculation_snapshot_sha256,metadata) values
 ('e4954930-0000-4000-8000-000000000071','e4954930-0000-4000-8000-000000000001',
  'e4954930-0000-4000-8000-000000000031','e4954930-0000-4000-8000-000000000051',
  'e4954930-0000-4000-8000-000000000051','e4954930-0000-4000-8000-000000000061',
  'issued','SYNTHETIC-ISSUED-2026-08','2026-08-01','2026-09-01','2026-09-01T00:00:00Z','2026-09-30',
  100,25,125,'{"synthetic":true,"issued_country":"NO","issued_recipient":"Synthetic Agency"}',
  encode(extensions.digest('{"synthetic":true,"issued_country":"NO","issued_recipient":"Synthetic Agency"}','sha256'),'hex'),
  '{"synthetic":true,"delivery":"paper","document_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
insert into public.customer_invoice_documents(id,company_id,invoice_id,customer_id,
 storage_bucket,file_path,file_name,mime_type,metadata) values
 ('e4954930-0000-4000-8000-000000000072','e4954930-0000-4000-8000-000000000001',
  'e4954930-0000-4000-8000-000000000071','e4954930-0000-4000-8000-000000000031',
  'synthetic-invoice-documents','synthetic/issued-invoice.pdf','synthetic-issued.pdf','application/pdf',
  '{"synthetic":true,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
commit;
\echo TENANTSERVICE_UPGRADE_EXISTING_OLD_ROWS_SEEDED_PASS
