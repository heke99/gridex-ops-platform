begin;

-- Supabase Storage sets this transaction-local flag before issuing DELETE.
-- Keeping the protection trigger enabled while setting the same flag exercises
-- the real DELETE RLS policy without performing unsupported direct deletion.
select set_config('storage.allow_delete_query', 'true', true);

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'customer-documents') then
    raise exception 'customer-documents bucket missing';
  end if;
end
$$;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
) values
  ('e0000000-0000-4000-8000-000000000001','authenticated','authenticated','aud001-writer-a@example.invalid','{}','{}',now(),now(),false,false),
  ('e0000000-0000-4000-8000-000000000002','authenticated','authenticated','aud001-reader-a@example.invalid','{}','{}',now(),now(),false,false),
  ('e0000000-0000-4000-8000-000000000003','authenticated','authenticated','aud001-writer-b@example.invalid','{}','{}',now(),now(),false,false);

insert into public.companies (id,name,slug,status,is_active) values
  ('a0000000-0000-4000-8000-000000000001','AUD-001 Company A','aud-001-company-a','active',true),
  ('a0000000-0000-4000-8000-000000000002','AUD-001 Company B','aud-001-company-b','active',true);

insert into public.company_memberships (
  id, company_id, user_id, membership_role, status, is_active, joined_at
) values
  ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','member','active',true,now()),
  ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002','member','active',true,now()),
  ('b0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000003','member','active',true,now());

insert into public.user_permissions (
  id, user_id, company_id, permission_id, permission_key, effect, status, is_active
)
select
  gen_random_uuid(),
  fixture.user_id,
  fixture.company_id,
  permission.id,
  permission.key,
  'allow',
  'active',
  true
from (
  values
    ('e0000000-0000-4000-8000-000000000001'::uuid,'a0000000-0000-4000-8000-000000000001'::uuid,'masterdata.read'),
    ('e0000000-0000-4000-8000-000000000001'::uuid,'a0000000-0000-4000-8000-000000000001'::uuid,'masterdata.write'),
    ('e0000000-0000-4000-8000-000000000002'::uuid,'a0000000-0000-4000-8000-000000000001'::uuid,'masterdata.read'),
    ('e0000000-0000-4000-8000-000000000003'::uuid,'a0000000-0000-4000-8000-000000000002'::uuid,'masterdata.read'),
    ('e0000000-0000-4000-8000-000000000003'::uuid,'a0000000-0000-4000-8000-000000000002'::uuid,'masterdata.write')
) as fixture(user_id, company_id, permission_key)
join public.permissions permission on permission.key = fixture.permission_key;

insert into public.customers (
  id, customer_type, status, full_name, company_id, is_test_data
) values
  ('c0000000-0000-4000-8000-000000000001','private','active','AUD-001 Customer A','a0000000-0000-4000-8000-000000000001',true),
  ('c0000000-0000-4000-8000-000000000002','private','active','AUD-001 Customer B','a0000000-0000-4000-8000-000000000002',true);

insert into public.customer_sites (
  id, customer_id, company_id, site_name, site_type, status, country, is_test_data
) values
  ('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','AUD-001 Site A','consumption','active','SE',true),
  ('d0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','AUD-001 Site B','consumption','active','SE',true);

insert into storage.objects (id,bucket_id,name,owner,metadata) values
  ('10000000-0000-4000-8000-000000000001','customer-documents','companies/a0000000-0000-4000-8000-000000000001/customers/c0000000-0000-4000-8000-000000000001/customer/power_of_attorney/a.pdf','e0000000-0000-4000-8000-000000000001','{"fixture":"a"}'),
  ('10000000-0000-4000-8000-000000000002','customer-documents','companies/a0000000-0000-4000-8000-000000000002/customers/c0000000-0000-4000-8000-000000000002/site-d0000000-0000-4000-8000-000000000002/complete_agreement/b.pdf','e0000000-0000-4000-8000-000000000003','{"fixture":"b"}'),
  ('10000000-0000-4000-8000-000000000003','customer-documents','companies/a0000000-0000-4000-8000-000000000001/customers/c0000000-0000-4000-8000-000000000002/customer/power_of_attorney/mismatch.pdf',null,'{"fixture":"mismatch"}'),
  ('10000000-0000-4000-8000-000000000004','customer-documents','companies/a0000000-0000-4000-8000-000000000001/customers/c0000000-0000-4000-8000-000000000001/authorizations/legacy.pdf',null,'{"fixture":"legacy"}');

set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

do $$
declare visible uuid[]; affected integer;
begin
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into visible
  from storage.objects
  where id between '10000000-0000-4000-8000-000000000001'
               and '10000000-0000-4000-8000-000000000004';
  if visible <> array['10000000-0000-4000-8000-000000000001'::uuid] then
    raise exception 'writer A visibility mismatch: %', visible;
  end if;

  update storage.objects set metadata='{"updated":"a"}'
  where id='10000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'writer A own update failed'; end if;

  update storage.objects set metadata='{"updated":"cross"}'
  where id='10000000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'writer A cross-tenant update succeeded'; end if;

  delete from storage.objects
  where id='10000000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'writer A cross-tenant delete succeeded'; end if;
end
$$;

insert into storage.objects (id,bucket_id,name,owner)
values (
  '10000000-0000-4000-8000-000000000005',
  'customer-documents',
  'companies/a0000000-0000-4000-8000-000000000001/customers/c0000000-0000-4000-8000-000000000001/site-d0000000-0000-4000-8000-000000000001/grid_invoice_suggested/writer-a.pdf',
  'e0000000-0000-4000-8000-000000000001'
);

do $$
begin
  begin
    insert into storage.objects (id,bucket_id,name,owner) values (
      '10000000-0000-4000-8000-000000000006',
      'customer-documents',
      'companies/a0000000-0000-4000-8000-000000000002/customers/c0000000-0000-4000-8000-000000000002/customer/power_of_attorney/denied.pdf',
      'e0000000-0000-4000-8000-000000000001'
    );
    raise exception 'writer A cross-tenant insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects (id,bucket_id,name,owner) values (
      '10000000-0000-4000-8000-000000000007',
      'customer-documents',
      'companies/a0000000-0000-4000-8000-000000000001/customers/c0000000-0000-4000-8000-000000000002/customer/power_of_attorney/mismatch-denied.pdf',
      'e0000000-0000-4000-8000-000000000001'
    );
    raise exception 'company/customer mismatch insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

delete from storage.objects where id='10000000-0000-4000-8000-000000000005';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);

do $$
declare affected integer;
begin
  if not exists (
    select 1 from storage.objects
    where id='10000000-0000-4000-8000-000000000001'
  ) then raise exception 'reader A cannot read own tenant object'; end if;

  update storage.objects set metadata='{"reader":"denied"}'
  where id='10000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'reader A update succeeded'; end if;

  delete from storage.objects
  where id='10000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'reader A delete succeeded'; end if;
end
$$;

do $$
begin
  begin
    insert into storage.objects (id,bucket_id,name,owner) values (
      '10000000-0000-4000-8000-000000000008',
      'customer-documents',
      'companies/a0000000-0000-4000-8000-000000000001/customers/c0000000-0000-4000-8000-000000000001/customer/power_of_attorney/reader-denied.pdf',
      'e0000000-0000-4000-8000-000000000002'
    );
    raise exception 'reader A insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claim.role','authenticated',true);

do $$
declare visible uuid[];
begin
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into visible
  from storage.objects
  where id between '10000000-0000-4000-8000-000000000001'
               and '10000000-0000-4000-8000-000000000004';
  if visible <> array['10000000-0000-4000-8000-000000000002'::uuid] then
    raise exception 'writer B visibility mismatch: %', visible;
  end if;
end
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

do $$
declare visible integer;
begin
  select count(*) into visible
  from storage.objects
  where id between '10000000-0000-4000-8000-000000000001'
               and '10000000-0000-4000-8000-000000000004';
  if visible <> 4 then
    raise exception 'service role must see canonical and quarantined legacy objects: %', visible;
  end if;
end
$$;

insert into storage.objects (id,bucket_id,name)
values ('10000000-0000-4000-8000-000000000009','customer-documents','legacy/service-role-quarantine.pdf');
delete from storage.objects where id='10000000-0000-4000-8000-000000000009';

reset role;

do $$
declare policy_count integer;
begin
  select count(*) into policy_count
  from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname in (
      'customer_documents_storage_read',
      'customer_documents_storage_insert',
      'customer_documents_storage_update',
      'customer_documents_storage_delete',
      'customer_documents_storage_service_role_all'
    );
  if policy_count <> 5 then
    raise exception 'expected five explicit AUD-001 policies, found %', policy_count;
  end if;
end
$$;

rollback;
